/**
 * dsh-anti-ai-fiction — 插件主体（host 半）。
 *
 * 这个插件查的是**内容层面的 AI 味**：名字、事物、对话、景色。
 * 四维共 40 条雷区，全部落成可复核的判据（`lib/spec.js` 是单一事实源）。
 *
 * ## 分工：查 / 改 / 拦
 *
 *   `deai_audit`   查 —— 跑检测，产出**带原文证据与定位**的审计报告
 *   `deai_polish`  改 —— 渲染「只改这些点」的改写提示词（或给打回裁决）
 *   `deai_guard`   拦 —— 写作时的前置门禁：重灾区 / 工程词泄漏 / 截断 / 占位符
 *   `deai_rules`   查规则 —— 列出 40 条雷区与放行条件，不查具体文本
 *
 * ## 三条硬规矩
 *
 * **一、不自己调模型。** 和 `dsh-writing-slots` 一致：插件负责把判据算完、
 * 把提示词渲染好，模型只负责写和改。这样「有没有做到」是可验证的。
 *
 * **二、每条命中必须带原文证据和定位。** 指不出位置的命中会被降级标注，
 * 甚至直接导致打回 —— 见 `lib/audit.js` 的 `judge()`。
 *
 * **三、错误一律收口。** 工具永远返回 `{ ok, message }`，不把异常抛给调用方。
 * 检测引擎还没交付时，插件也要能加载、能给出「引擎未就绪」的明确说明，
 * 而不是让整个 profile 起不来。
 *
 * @module dsh-anti-ai-fiction
 */
import { defineTool } from '@deepseek-ai/dsh-tools'

import { SPECS, DIMENSIONS, BLOCK_THRESHOLD } from './spec.js'
import { buildReport, buildAuditResult, judge, reworkInstructions, specDigest } from './audit.js'
import { renderForcedDirective, renderChecklist, renderRewritePrompt, renderRulesDigest } from './prompt.js'

/** 插件名（HTTP 前缀与日志都用它）。 */
export const name = 'dsh-anti-ai-fiction'

/** HTTP 路由前缀。 */
const API_PREFIX = '/api/dsh-anti-ai-fiction'

/**
 * 统一的输出契约：ok + message。
 *
 * 与 writing-slots 保持一致 —— 工具的返回体永远是这两个字段，
 * 详细的报告、提示词、清单全部塞进 `message`（Markdown）。
 */
const OUTPUT = {
  schema: {
    type: 'object', additionalProperties: false,
    properties: {
      ok: { type: 'boolean', required: true },
      message: { type: 'string', required: true },
    },
  },
  render: (_a, v) => [{ type: 'text', text: v.message }],
}

/**
 * 工程词泄漏清单 —— 给作者看的词跑进了正文。
 *
 * 跟雷区表是两回事：雷区查的是「像 AI 写的句子」，这里查的是
 * 「写作过程本身漏进了稿子」。这类问题跟文笔无关，是纯粹的流程事故，
 * 但它一旦出现，稿子就不能用。
 *
 * 放在本文件而不是 `spec.js`：它不属于 40 条内容雷区，
 * 也不该占用雷区编号。
 */
const ENGINEERING_TERMS = [
  '本章', '伏笔', '爽点', '信息差', '钩子', '细纲', '大纲', '伏线',
  '节奏点', '情绪点', '人设', '设定集', '世界观', '章节任务', '下一章',
  '本章目标', '字数要求', '写作要求', '读者画像', '爽文', '打脸', '扮猪吃虎',
]

/** 占位符残留。 */
const PLACEHOLDER_PATTERNS = [
  /\{[^}\n]{1,40}\}/g,       // {xxx} {角色名} {待填}
  /\bTODO\b/gi,
  /\bFIXME\b/gi,
  /\bXXX\b/g,
  /待补/g,
  /此处[^，。！？\n]{0,6}(补充|填写|略)/g,
  /\.\.\.\.\.\./g,          // ......
]

/**
 * 加载检测引擎。
 *
 * `lib/detect.js` 由另一位队友实现，交付前这个文件可能不存在。
 * 用动态 import + try/catch 而不是静态 import，理由是：
 * 静态 import 缺失时**整个插件加载失败**，连带整个 profile 起不来；
 * 而动态 import 失败只影响「查」这件事，插件照样注册工具、
 * 照样能返回 40 条规则、照样能给出强制指令。
 *
 * 契约（联调时对齐这个）：
 *   detect(text, options) → {
 *     ok: boolean,
 *     chars: number,
 *     hits: Array<{ specId: string, evidence: string, where: string, note?: string }>,
 *     bySeverity: { block: number, warn: number },
 *     byDimension: Record<string, number>,
 *     blockCount: number,
 *     shouldReject: boolean,
 *   }
 *   options 可含：{ dims?: string[], specs?: string[] }
 *
 * @returns {Promise<{detect: Function|null, error: string|null}>}
 */
let engineCache = null
async function loadEngine() {
  if (engineCache !== null) return engineCache
  try {
    const mod = await import('./detect.js')
    const fn = typeof mod?.detect === 'function' ? mod.detect : null
    engineCache = fn === null
      ? { detect: null, error: 'lib/detect.js 没有导出 detect(text, options) 函数。' }
      : { detect: fn, error: null }
  } catch (e) {
    engineCache = {
      detect: null,
      error: `检测引擎未就绪：${e?.message ?? String(e)}`,
    }
  }
  return engineCache
}

/** 同步拿引擎（若已加载）。 */
function engineSync() {
  return engineCache
}

/**
 * 解析逗号/顿号分隔的列表参数。
 * @param {unknown} v
 * @returns {string[]}
 */
function splitList(v) {
  if (typeof v !== 'string') return []
  return v.split(/[,，、\n\s]+/).map((x) => x.trim()).filter((x) => x !== '')
}

/**
 * 校验维度名，给出可用清单。
 * @param {string[]} dims
 */
function validDims(dims) {
  const known = DIMENSIONS.map((d) => d.id)
  return dims.filter((d) => known.includes(d))
}

/**
 * 校验雷区 id，给出可用清单。
 * @param {string[]} specs
 */
function validSpecs(specs) {
  const known = SPECS.map((s) => s.id)
  return specs.filter((s) => known.includes(s))
}

/**
 * 跑一次检测，把所有失败都收口成结果对象。
 *
 * 这一层是所有工具的公共入口 —— 只要它不抛异常，
 * 上层工具就不会因为检测引擎的边界情况炸掉。
 *
 * @param {string} text
 * @param {object} opts
 * @returns {Promise<{ok:boolean, result:any|null, error:string|null}>}
 */
async function runDetect(text, opts = {}) {
  const eng = await loadEngine()
  if (eng.detect === null) {
    return { ok: false, result: null, error: eng.error ?? '检测引擎未就绪。' }
  }
  const options = {}
  const dims = validDims(opts.dims ?? [])
  const specs = validSpecs(opts.specs ?? [])
  if (dims.length > 0) options.dims = dims
  if (specs.length > 0) options.specs = specs
  try {
    const r = await eng.detect(text, options)
    if (r === null || typeof r !== 'object') {
      return { ok: false, result: null, error: '检测引擎返回的不是结果对象。' }
    }
    return { ok: true, result: r, error: null }
  } catch (e) {
    return { ok: false, result: null, error: `检测引擎抛错：${e?.message ?? String(e)}` }
  }
}

/**
 * 截断检查：结尾是不是完整句子。
 *
 * 判据两条：结尾有句末标点；中文引号成对。
 * 这两条是确定性的，不需要模型。
 * @param {string} text
 */
function checkTruncation(text) {
  const problems = []
  const t = String(text ?? '').trim()
  if (t === '') return { truncated: false, problems }

  const last = t[t.length - 1]
  if (!/[。！？…」』"”'）】…!?"'）]$/.test(last)) {
    problems.push('结尾没有句末标点 —— 正文可能是被截断的。')
  }
  const open = (t.match(/[「『（【]/g) ?? []).length
  const close = (t.match(/[」』）】]/g) ?? []).length
  if (open > close) {
    problems.push(`中文引号/括号不成对（开了 ${open} 个，只闭了 ${close} 个）—— 引号没关。`)
  }
  const quotes = (t.match(/"/g) ?? []).length
  if (quotes % 2 !== 0) {
    problems.push('英文双引号数量为奇数 —— 引号没关。')
  }
  return { truncated: problems.length > 0, problems }
}

/**
 * 工程词泄漏检查。
 * @param {string} text
 */
function checkEngineeringTerms(text) {
  const hits = []
  const t = String(text ?? '')
  for (const term of ENGINEERING_TERMS) {
    let idx = t.indexOf(term)
    while (idx !== -1) {
      const before = t.slice(Math.max(0, idx - 12), idx)
      const after = t.slice(idx + term.length, idx + term.length + 12)
      hits.push({ term, evidence: (before + term + after).replace(/\n/g, ' ').trim() })
      idx = t.indexOf(term, idx + term.length)
    }
  }
  return hits
}

/**
 * 占位符残留检查。
 * @param {string} text
 */
function checkPlaceholders(text) {
  const hits = []
  const t = String(text ?? '')
  for (const re of PLACEHOLDER_PATTERNS) {
    const m = t.match(re)
    if (m === null) continue
    for (const one of m.slice(0, 10)) {
      hits.push(one)
    }
  }
  return [...new Set(hits)]
}

/**
 * 门禁检查：把「写作时前置」的那几件事一次性查完。
 *
 * 顺序按**严重程度**排：重灾区 → 工程词 → 截断 → 占位符。
 * 顺序不是审美问题 —— 报告要让人从最要命的看起。
 *
 * @param {any} result detect 的结果
 * @param {string} text
 * @param {number|null} limit 字数下限
 */
function runGuard(result, text, limit) {
  const reasons = []
  const critical = []

  const blockHits = (Array.isArray(result?.hits) ? result.hits : [])
    .filter((h) => {
      const spec = SPECS.find((s) => s.id === h?.specId)
      return spec?.severity === 'block'
    })

  // 阈值按**不同雷区**算，不按处数算 —— 与 spec.js 的 judgeReject 同一口径。
  // 同一种病写三遍不拦；病得五花八门才拦。
  const distinctBlockSpecs = new Set(blockHits.map((h) => h?.specId)).size

  if (distinctBlockSpecs > 0) {
    critical.push(`命中 ${distinctBlockSpecs} 条重灾区（block 级）`)
    for (const h of blockHits) {
      const spec = SPECS.find((s) => s.id === h?.specId)
      reasons.push(`🔴 [${h.specId}] ${spec?.title ?? h.specId}${h?.where ? `（${h.where}）` : ''}：${h?.evidence ?? ''}`)
    }
  }

  if (distinctBlockSpecs >= BLOCK_THRESHOLD) {
    critical.push(`重灾区（不同雷区 ${distinctBlockSpecs} 条）达到打回阈值 ${BLOCK_THRESHOLD} 条`)
  }

  const engHits = checkEngineeringTerms(text)
  if (engHits.length > 0) {
    critical.push(`工程词泄漏 ${engHits.length} 处`)
    for (const h of engHits) {
      reasons.push(`⚠ 工程词「${h.term}」跑进正文：…${h.evidence}…`)
    }
  }

  const trunc = checkTruncation(text)
  if (trunc.truncated) {
    critical.push('正文疑似截断')
    for (const p of trunc.problems) reasons.push(`⚠ ${p}`)
  }

  const ph = checkPlaceholders(text)
  if (ph.length > 0) {
    critical.push(`占位符残留 ${ph.length} 处`)
    for (const p of ph) reasons.push(`⚠ 占位符未替换：${p}`)
  }

  const chars = Number(result?.chars ?? String(text ?? '').length)
  if (typeof limit === 'number' && Number.isFinite(limit) && limit > 0 && chars < limit) {
    critical.push(`字数不足（${chars} < ${limit}）`)
    reasons.push(`⚠ 字数 ${chars}，低于下限 ${limit}`)
  }

  const shouldReject = critical.length > 0
  return { shouldReject, critical, reasons, blockCount: distinctBlockSpecs, blockHits: blockHits.length, chars }
}

/**
 * 注册插件。
 *
 * @param {any} ctx
 * @param {object} [config]
 */
export function apply(ctx, config = {}) {
  const log = (level, msg) => ctx.logger?.[level]?.(`dsh-anti-ai-fiction: ${msg}`)

  // —— 工具 1：deai_audit（查） ——
  ctx.inject(['tools'], (agentCtx) => {
    try {
      agentCtx.tools.register(defineTool({
        name: 'deai_audit',
        description:
          '【查】AI 味审计。跑一遍 40 条雷区检测，产出**带原文证据与定位**的审计报告：'
          + '命中哪条雷区 → 原文证据 → 定位 → 病理分析（为什么这是 AI 味）→ 活人味修复方向。'
          + '最后给总判：能不能润色。命中重灾区达阈值时明确写「拒绝润色，要求打回重写」。'
          + '可按 dims / specs 缩小范围。',
        parameters: {
          text: { type: 'string', required: true, description: '待查正文' },
          projectDir: { type: 'string', description: '项目目录（可选，仅作上下文标注）' },
          dims: { type: 'string', description: '维度筛选，逗号分隔：name/object/dialogue/scenery' },
          specs: { type: 'string', description: '雷区 id 筛选，逗号分隔' },
        },
        output: OUTPUT,
        async execute(args) {
          const text = typeof args.text === 'string' ? args.text : ''
          if (text.trim() === '') {
            return { ok: false, message: '没有待查正文（text 是空的）。' }
          }
          const d = await runDetect(text, { dims: splitList(args.dims), specs: splitList(args.specs) })
          if (!d.ok) {
            return { ok: false, message: `审计没跑成：${d.error}\n\n（检测引擎尚未交付；规则清单仍可用 —— 调 deai_rules。）` }
          }
          const report = buildReport(d.result)
          return {
            ok: true,
            message: [
              'AI 味审计完成。',
              '',
              report,
            ].join('\n'),
          }
        },
      }))
      log('info', '已注册 deai_audit')
    } catch (e) {
      log('warn', `deai_audit 注册失败：${e?.message ?? String(e)}`)
    }
  })

  // —— 工具 2：deai_polish（改） ——
  ctx.inject(['tools'], (agentCtx) => {
    try {
      agentCtx.tools.register(defineTool({
        name: 'deai_polish',
        description:
          '【改】去 AI 味改写。**先查后改**：命中重灾区达到阈值且 strict=true 时'
          + '不做润色，直接返回打回重写裁决 + 逐条病理 + 每条雷区的活人味替换示范；'
          + '否则返回**渲染好的改写提示词**（不自己调模型），提示词里带：'
          + '命中的具体句子与位置、要改成什么样（附人工审过的 good 示范）、'
          + '必须保留的东西（人名一致性、伏笔、字数下限）、以及「不许把活人味改死」的禁令。',
        parameters: {
          text: { type: 'string', required: true, description: '待改写正文' },
          projectDir: { type: 'string', description: '项目目录（可选，仅作上下文标注）' },
          dims: { type: 'string', description: '维度筛选，逗号分隔' },
          specs: { type: 'string', description: '雷区 id 筛选，逗号分隔' },
          strict: { type: 'boolean', description: '严格模式（默认 true）：命中重灾区达阈值就拒绝润色、要求打回重写' },
          keep: { type: 'string', description: '必须保留的东西，逗号分隔' },
          wordMin: { type: 'number', description: '字数下限（写进改写提示词，防止改短了）' },
        },
        output: OUTPUT,
        async execute(args) {
          const text = typeof args.text === 'string' ? args.text : ''
          if (text.trim() === '') {
            return { ok: false, message: '没有待改写正文（text 是空的）。' }
          }
          const strict = args.strict !== false
          const d = await runDetect(text, { dims: splitList(args.dims), specs: splitList(args.specs) })
          if (!d.ok) {
            return { ok: false, message: `改写没组装成：${d.error}` }
          }

          const v = judge(d.result)
          const reworks = reworkInstructions(d.result)
          const keep = splitList(args.keep)

          // —— 打回路径 ——
          if (!v.canPolish && strict) {
            const lines = []
            lines.push('# ⛔ 拒绝润色 —— 打回重写')
            lines.push('')
            lines.push(`命中重灾区 ${v.distinctBlockSpecs} 条**不同雷区**（打回阈值 ${BLOCK_THRESHOLD} 条，命中处数 ${v.blockHits ?? 0} 处）。逐句润色改不动，必须重写命中的部分。`)
            lines.push('')
            lines.push('（阈值按不同雷区算：同一种病写三遍不拦；病得五花八门才拦。）')
            lines.push('')
            for (const r of v.reasons) lines.push(`- ${r}`)
            lines.push('')
            lines.push('## 逐条病理 + 活人味替换示范')
            lines.push('')
            for (const r of reworks) {
              lines.push(`### ${r.severity === 'block' ? '🔴' : '🟡'} ${r.title}　\`${r.specId}\``)
              lines.push('')
              if (r.where) lines.push(`- **定位**：${r.where}`)
              lines.push(`- **原文**：${r.evidence || r.badExample || '（证据缺失）'}`)
              lines.push(`- **病理**：${r.why}`)
              lines.push(`- **改成什么样**：${r.fix}`)
              lines.push(`- **活人味示范**：${r.good}`)
              lines.push('')
            }
            lines.push('---')
            lines.push('')
            lines.push(renderRewritePrompt({
              items: reworks.map((r) => ({
                specId: r.specId, title: r.title, where: r.where, evidence: r.evidence,
                why: r.why, fix: r.fix, good: r.good,
              })),
              keep,
              wordMin: args.wordMin,
              rework: true,
            }))
            return {
              ok: false,
              message: lines.join('\n'),
            }
          }

          // —— 润色路径：返回渲染好的改写提示词 ——
          const prompt = renderRewritePrompt({
            items: reworks.map((r) => ({
              specId: r.specId, title: r.title, where: r.where, evidence: r.evidence,
              why: r.why, fix: r.fix, good: r.good,
            })),
            keep,
            wordMin: args.wordMin,
          })
          const lines = []
          lines.push(`去 AI 味改写提示词已组装（命中 ${reworks.length} 处，涉及 ${v.distinctBlockSpecs} 条重灾区雷区）。`)
          lines.push('')
          lines.push(`裁决：${v.verdict === 'conditional' ? '⚠ 有条件放行 —— 下面这几条必须逐条改掉' : '✅ 放行'}`)
          for (const r of v.reasons) lines.push(`- ${r}`)
          lines.push('')
          lines.push('⚠ 人工门禁：改完自己按章节自查清单过一遍；打不上的勾如实写出来，不要假装全过。')
          lines.push('')
          lines.push('--- 提示词开始 ---')
          lines.push(prompt)
          lines.push('--- 提示词结束 ---')
          return { ok: true, message: lines.join('\n') }
        },
      }))
      log('info', '已注册 deai_polish')
    } catch (e) {
      log('warn', `deai_polish 注册失败：${e?.message ?? String(e)}`)
    }
  })

  // —— 工具 3：deai_guard（拦） ——
  ctx.inject(['tools'], (agentCtx) => {
    try {
      agentCtx.tools.register(defineTool({
        name: 'deai_guard',
        description:
          '【拦】写作时的前置门禁。在动笔前/交稿前跑一次：'
          + '查重灾区命中、工程词泄漏（「本章」「伏笔」「爽点」跑进正文）、截断（引号没关/结尾没收尾）、'
          + '占位符残留（{xxx}/TODO/XXX）、字数下限。'
          + '有问题就返回 ok:false 并逐条列出原因，同时附一份**可粘贴的强制指令**，'
          + '让写作方在下笔前就带着约束。',
        parameters: {
          text: { type: 'string', required: true, description: '待检查正文' },
          limit: { type: 'number', description: '字数下限（低于此值算违规）' },
          dims: { type: 'string', description: '维度筛选，逗号分隔' },
          specs: { type: 'string', description: '雷区 id 筛选，逗号分隔' },
          dim: { type: 'string', description: '强制指令针对哪个维度收紧：name/object/dialogue/scenery' },
          projectDir: { type: 'string', description: '项目目录（可选，仅作上下文标注）' },
        },
        output: OUTPUT,
        async execute(args) {
          const text = typeof args.text === 'string' ? args.text : ''
          if (text.trim() === '') {
            return { ok: false, message: '没有待检查正文（text 是空的）。' }
          }
          const d = await runDetect(text, { dims: splitList(args.dims), specs: splitList(args.specs) })
          if (!d.ok) {
            return { ok: false, message: `门禁没跑成：${d.error}` }
          }

          const g = runGuard(d.result, text, args.limit)
          const directive = renderForcedDirective({
            dim: validDims(splitList(args.dim))[0],
            wordMin: args.limit,
          })

          const lines = []
          if (g.shouldReject) {
            lines.push('# ⛔ 打回')
            lines.push('')
            lines.push(`正文不合规，共 ${g.critical.length} 类问题：`)
            lines.push('')
            for (const c of g.critical) lines.push(`- ${c}`)
            lines.push('')
            lines.push('## 逐条原因')
            lines.push('')
            for (const r of g.reasons) lines.push(r)
            lines.push('')
            lines.push(`正文 ${g.chars} 字。`)
            lines.push('')
          } else {
            lines.push('# ✅ 放行')
            lines.push('')
            lines.push(`正文 ${g.chars} 字，未命中重灾区，无工程词泄漏、无截断、无占位符残留。`)
            lines.push('')
          }

          lines.push('--- 可粘贴的强制指令开始 ---')
          lines.push(directive)
          lines.push('--- 可粘贴的强制指令结束 ---')
          lines.push('')
          lines.push('--- 章节自查清单开始 ---')
          lines.push(renderChecklist({ wordMin: args.limit }))
          lines.push('--- 章节自查清单结束 ---')

          return { ok: !g.shouldReject, message: lines.join('\n') }
        },
      }))
      log('info', '已注册 deai_guard')
    } catch (e) {
      log('warn', `deai_guard 注册失败：${e?.message ?? String(e)}`)
    }
  })

  // —— 工具 4：deai_rules（查规则） ——
  ctx.inject(['tools'], (agentCtx) => {
    try {
      agentCtx.tools.register(defineTool({
        name: 'deai_rules',
        description:
          '列出 40 条 AI 味雷区（四维：名字/事物/对话/景色）及其判据、放行条件、修复方向，'
          + '外加打回阈值与放行条件清单。不查具体文本 —— 想读全部规则的人用这个。',
        parameters: {},
        output: OUTPUT,
        async execute() {
          const lines = [
            renderRulesDigest(),
            '',
            '（每条雷区都配了 40 组 ❌AI味 / ✅活人写法 验收用例。',
            ' 检测器跑的就是这批用例：AI 味那半必须命中，活人那半必须放行。）',
          ]
          return { ok: true, message: lines.join('\n') }
        },
      }))
      log('info', '已注册 deai_rules')
    } catch (e) {
      log('warn', `deai_rules 注册失败：${e?.message ?? String(e)}`)
    }
  })

  // —— HTTP 接口 ——
  ctx.inject(['webServer'], (hostCtx) => {
    const handler = makeApiHandler()
    hostCtx.effect(
      () => hostCtx.webServer.register({ kind: 'prefix', path: API_PREFIX, handler }),
      'dsh-anti-ai-fiction: api routes',
    )
  })

  // 引擎加载失败只在启动时提示一次，不刷日志。
  loadEngine().then((eng) => {
    if (eng.detect === null) log('warn', eng.error ?? '检测引擎未就绪')
  })
}

/** 极简 JSON 响应。 */
function sendJson(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(text)
}

/** 读请求体。 */
function readBody(req, limit = 512 * 1024) {
  return new Promise((resolve) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > limit) { req.destroy(); resolve(null); return }
      chunks.push(c)
    })
    req.on('end', () => {
      if (chunks.length === 0) { resolve({}); return }
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) } catch { resolve(null) }
    })
    req.on('error', () => resolve(null))
  })
}

/**
 * API 路由。
 *
 * 只有两个：规则清单（GET）、审计（POST）。
 * 接口做的是**只读的事** —— 不落盘、不改稿、不调模型。
 */
function makeApiHandler() {
  return async function handler(req, res) {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const path = url.pathname.replace(API_PREFIX, '') || '/'

      if (req.method === 'GET' && path === '/spec') {
        sendJson(res, 200, { ok: true, ...specDigest() })
        return
      }

      if (req.method === 'POST' && path === '/audit') {
        const body = await readBody(req)
        if (body === null) { sendJson(res, 400, { error: '请求体不是合法 JSON' }); return }
        const text = typeof body.text === 'string' ? body.text : ''
        if (text.trim() === '') { sendJson(res, 400, { error: 'text 是空的' }); return }
        const d = await runDetect(text, {
          dims: Array.isArray(body.dims) ? body.dims : splitList(body.dims),
          specs: Array.isArray(body.specs) ? body.specs : splitList(body.specs),
        })
        if (!d.ok) { sendJson(res, 503, { ok: false, error: d.error }); return }
        sendJson(res, 200, buildAuditResult(d.result))
        return
      }

      // GET /prompt —— 去 AI 味强制指令（见 handlePrompt 的注释）。
      if (req.method === 'GET' && path === '/prompt') {
        await handlePrompt(req, res, url)
        return
      }

      sendJson(res, 404, { error: `没有这个接口：${req.method} ${url.pathname}` })
    } catch (e) {
      sendJson(res, 500, { error: `接口出错：${e?.message ?? String(e)}` })
    }
  }
}

/**
 * 去 AI 味强制指令（界面「复制强制指令」按钮用）。
 *
 * 这个端点原本缺，浏览器半只好在本地拼一份简版，并在代码里注明
 * 「需要 Lead 补端点」。现在补上 —— 理由不是「补个 API」这么简单：
 *
 * 本地拼的简版**不知道每条雷区的 `allow`（放行条件）**，于是会把
 * 「带身体反应就不算」这类关键豁免漏掉，导致复制出去的指令过度严格，
 * 模型会把「宿醉后阳光跟刀子一样扎眼」也当成违规改掉 —— 越改越假。
 * 所以这份指令必须由后端生成，它才知道全部判据。
 *
 * 支持 `?dim=` 只出某一维度的条款；`?text=` 针对具体正文定制（附改写指令）。
 */
async function handlePrompt(req, res, url) {
  const dim = url.searchParams.get('dim') ?? ''
  const text = url.searchParams.get('text') ?? ''
  const opts = {}
  if (dim !== '' && validDims([dim]).length > 0) opts.dim = dim

  let prompt = renderForcedDirective(opts)

  if (text.trim() !== '') {
    const d = await runDetect(text, {})
    if (d.ok) {
      const items = reworkInstructions(d.result).map((r) => ({
        specId: r.specId, title: r.title, where: r.where, evidence: r.evidence,
        why: r.why, fix: r.fix, good: r.good,
      }))
      const v = judge(d.result)
      prompt = [
        prompt,
        '',
        '---',
        '',
        `针对本次正文（命中 ${v.blockCount} 条重灾区，阈值 ${BLOCK_THRESHOLD} 条）：`,
        '',
        renderRewritePrompt({ items, rework: !v.canPolish }),
      ].join('\n')
    }
  }

  sendJson(res, 200, { ok: true, prompt })
}

export { SPECS, DIMENSIONS, BLOCK_THRESHOLD }
export { buildReport, judge, reworkInstructions, specDigest } from './audit.js'
export { renderForcedDirective, renderChecklist, renderRewritePrompt, renderRulesDigest } from './prompt.js'
export { engineSync }

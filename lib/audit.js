/**
 * dsh-anti-ai-fiction — 审计报告生成与打回裁决。
 *
 * 这一层**不检测**，只做两件事：
 *   1. 把 `detect()` 的结果整理成**人可读的审计报告**；
 *   2. 根据命中情况给出**能不能润色**的裁决。
 *
 * ## 报告格式：沿用三段式，但每条带真证据
 *
 * 参考模板（`templates/audit-report-template.md`）是三段式：
 *   🔍 词句扫描与拦截 / 🔪 强制手术 / 🏆 去 AI 味升级指令。
 * 但那个模板里全是**示例**（「比如这样改」），没有真证据 ——
 * 于是审的人无法判断模型是不是在编。
 *
 * 本插件的关键区别就在这里：**每条命中必须带原文证据和定位**
 * （哪一句、第几段）。指不出来的命中就不该出现在报告里 ——
 * 检测器拿不出证据的命中，本身就该被丢掉。
 *
 * ## 裁决为什么要单列一个函数
 *
 * 「能不能润色」是个**门槛判断**，不是文笔判断。
 * 门槛可以由数字定：命中几条 block 级、超过没超过阈值。
 * 把它写成一个独立函数，是为了让它**可复核、可测试**，
 * 也为了不让「报告写得好看」影响「该不该打回」。
 *
 * @module dsh-anti-ai-fiction/audit
 */
import { SPECS, DIMENSIONS, BLOCK_THRESHOLD, CASES, specOf, judgeReject } from './spec.js'

/** specId → spec 定义。 */
const SPEC_BY_ID = new Map(SPECS.map((s) => [s.id, s]))

/**
 * 取某雷区的一个活人味示范样本（good 侧）。
 *
 * 示范来自 `CASES` —— 那是插件的回归测试集，每条雷区都配了一组
 * ❌AI味 / ✅活人写法。拿它当示范有两个好处：
 *   1. 示范本身是**人工审过**的活人写法，不是模型现编的；
 *   2. 示范和检测器用的是同一份判据，改示范等于改检测器的期望值。
 *
 * @param {string} specId
 * @returns {string|null}
 */
export function goodSampleOf(specId) {
  const c = CASES.find((x) => x.specId === specId)
  if (!c || !Array.isArray(c.good) || c.good.length === 0) return null
  return c.good[0]
}

/**
 * 取该雷区的全部验收用例（用于报告里的「对照」）。
 * @param {string} specId
 */
export function casesOfSpec(specId) {
  const c = CASES.find((x) => x.specId === specId)
  if (!c) return null
  return c
}

/**
 * 把检测结果整理成规范形状。
 *
 * 检测器（`lib/detect.js`）返回的 `hits` 是数组，每项形如
 * `{ specId, evidence, where, note? }`。
 * 这里做**防御性归一**：字段缺失不让整份报告炸掉，
 * 缺证据的命中**降级为「未定位」**而不是伪造一个位置。
 *
 * 为什么要这么啰嗦：因为「带证据」是这个插件的立身之本，
 * 一旦为了省事就允许没证据的条目混进报告，整个插件就没意义了。
 *
 * @param {any} result
 * @returns {Array<object>}
 */
export function normalizeHits(result) {
  const raw = Array.isArray(result?.hits) ? result.hits : []
  const out = []
  for (const h of raw) {
    if (!h || typeof h !== 'object') continue
    const specId = typeof h.specId === 'string' ? h.specId : null
    if (specId === null) continue
    const spec = SPEC_BY_ID.get(specId) ?? null
    const evidence = typeof h.evidence === 'string' ? h.evidence.trim() : ''
    const where = typeof h.where === 'string' ? h.where.trim() : ''
    out.push({
      specId,
      title: spec?.title ?? h.title ?? specId,
      dim: spec?.dim ?? h.dim ?? 'unknown',
      severity: spec?.severity ?? (h.severity === 'block' ? 'block' : 'warn'),
      evidence,
      where,
      note: typeof h.note === 'string' ? h.note : '',
      // 定位不到就不算「可复核命中」—— 报告里会如实标出来。
      located: evidence !== '' && where !== '',
    })
  }
  return out
}

/**
 * 统计归一后的命中。
 * @param {Array<object>} hits
 */
function tally(hits) {
  const bySeverity = { block: 0, warn: 0 }
  const byDimension = {}
  const specIds = []
  for (const h of hits) {
    bySeverity[h.severity] = (bySeverity[h.severity] ?? 0) + 1
    byDimension[h.dim] = (byDimension[h.dim] ?? 0) + 1
    if (!specIds.includes(h.specId)) specIds.push(h.specId)
  }
  return { bySeverity, byDimension, specIds }
}

/**
 * 打回裁决：这份稿子能不能润色？
 *
 * ## 口径必须走 `spec.js` 的 `judgeReject`，不能自己写一套
 *
 * 阈值数的是「**不同的** block 级 specId 的个数」，不是命中处数。
 * 读法 A（命中 3 处就打回）是错的 —— 一段里把「残阳如血」写三遍是
 * **同一种病**写三遍，不该拦，而且改掉两处等于改好了。读法 B
 * （3 条不同雷区）才对得上「重灾区」：病得五花八门，才说明从根上塌了。
 *
 * 判定逻辑只有一处实现（`spec.js` 的 `judgeReject`），工具层、界面层、
 * 验证脚本共用 —— 否则三处会冒出三种结论。
 *
 * 口径：
 *   - `reject`     —— 不同的 block 级雷区达到阈值；**或**存在无法定位的 block 命中。
 *   - `conditional`—— 有 block 命中但未达阈值。放行，但必须在提示词里点名这些点。
 *   - `accept`     —— 没有 block 命中（或只有 warn）。
 *
 * 「无法定位的 block 命中算 reject」是本层额外加的：
 * 一条指不出原文位置的硬伤，模型改的时候会瞎改整段，风险比留着还大。
 *
 * @param {any} detectResult
 * @returns {{canPolish:boolean, verdict:'accept'|'reject'|'conditional', reasons:string[], blockCount:number, warnCount:number, unlocatedBlock:number, distinctBlockSpecs:number}}
 */
export function judge(detectResult) {
  const hits = normalizeHits(detectResult)
  const { bySeverity } = tally(hits)
  const warnCount = bySeverity.warn ?? 0

  // 交给 spec.js 的统一实现算阈值 —— 注意要传**归一后**的 hits：
  // `judgeReject` 从 hit 上读 `severity`，而归一后的 severity 来自雷区表，
  // 与检测器直接给出的 severity 是同一口径（表为准）。
  const j = judgeReject({ hits })

  const unlocatedBlock = hits.filter((h) => h.severity === 'block' && !h.located).length

  const reasons = []
  let verdict = 'accept'

  if (j.reject) {
    verdict = 'reject'
    reasons.push(j.reason)
    reasons.push(`（不同雷区 ${j.distinctBlockSpecs} 条，命中处数 ${j.blockHits} 处 —— 阈值按**不同雷区**算，不按处数算。）`)
  } else if (j.distinctBlockSpecs > 0) {
    verdict = 'conditional'
    reasons.push(j.reason)
    reasons.push('下面这几条必须逐条改掉，不许放过。')
  } else {
    reasons.push('没有命中重灾区，可以放行润色。')
  }

  if (unlocatedBlock > 0) {
    verdict = 'reject'
    reasons.push(`有 ${unlocatedBlock} 条 block 级命中**指不出原文位置** —— 无法定位就没法定向修改，盲改的风险比留着还大，直接打回。`)
  }

  if (warnCount > 0) {
    reasons.push(`另有 ${warnCount} 条建议级命中（warn），润色时一并处理。`)
  }

  return {
    canPolish: verdict !== 'reject',
    verdict,
    reasons,
    // blockCount 语义：**不同 block 级 specId 的个数**（与 detect() 的 blockCount 同口径）
    blockCount: j.distinctBlockSpecs,
    warnCount,
    unlocatedBlock,
    distinctBlockSpecs: j.distinctBlockSpecs,
    blockHits: j.blockHits,
  }
}

/**
 * 逐条「活人味替换示范」。
 *
 * 每条给三样东西：**病理**（为什么这是 AI 味）、**修复方向**（要改成什么样）、
 * **示范**（一段人工审过的活人写法）。
 *
 * 示范从 `CASES` 的 good 侧取，不现编 —— 现编的示范是模型自己给自己
 * 开的药方，等于没查。
 *
 * @param {any} detectResult
 * @param {Record<string, any>} [specById] specId → spec 定义（缺省用内置表）
 * @returns {Array<object>}
 */
export function reworkInstructions(detectResult, specById = SPEC_BY_ID) {
  const hits = normalizeHits(detectResult)
  const out = []
  for (const h of hits) {
    const spec = specById?.[h.specId] ?? SPEC_BY_ID.get(h.specId) ?? null
    const good = goodSampleOf(h.specId)
    const c = casesOfSpec(h.specId)
    out.push({
      specId: h.specId,
      title: h.title,
      dim: h.dim,
      severity: h.severity,
      where: h.where,
      evidence: h.evidence,
      why: spec?.why ?? '（这条雷区没有登记说明）',
      fix: spec?.fix ?? '（这条雷区没有登记修复方向）',
      good: good ?? '（没有登记活人味示范）',
      bad: c && Array.isArray(c.bad) ? c.bad[0] : null,
      // 示范里的 AI 味原句 —— 用来对照「你原来写成什么样」
      badExample: c && Array.isArray(c.bad) ? c.bad[0] : null,
    })
  }
  // block 级排前面：打回时先看硬伤。
  out.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'block' ? -1 : 1
    return 0
  })
  return out
}

/**
 * 生成 Markdown 审计报告。
 *
 * 三段式（沿用参考模板）：
 *   🔍 词句扫描与拦截 —— 命中清单，每条带**原文证据**和**定位**
 *   🔪 强制手术 —— Before & After 对照
 *   🏆 去 AI 味升级指令 —— 可直接粘贴的强制指令
 *
 * @param {any} detectResult
 * @param {object} [opts]
 * @param {Record<string, any>} [opts.specById]
 * @param {string} [opts.directive] 预渲染的强制指令（缺省现生成）
 * @returns {string}
 */
export function buildReport(detectResult, opts = {}) {
  const specById = opts.specById ?? SPEC_BY_ID
  const hits = normalizeHits(detectResult)
  const { bySeverity, byDimension } = tally(hits)
  const verdict = judge(detectResult)
  const reworks = reworkInstructions(detectResult, specById)
  const chars = Number(detectResult?.chars ?? 0)

  const lines = []
  lines.push('# AI 味审计报告')
  lines.push('')
  lines.push('## 总判')
  lines.push('')

  if (verdict.verdict === 'reject') {
    lines.push('### ⛔ **拒绝润色，要求打回重写**')
    lines.push('')
    lines.push('这份稿子的 AI 味不是「几处措辞」级别的，是**结构性**的 —— 逐句润色只会把 AI 味揉进句子的骨头里。')
    lines.push('')
    lines.push(`命中重灾区（block 级）**${verdict.distinctBlockSpecs} 条不同雷区**，打回阈值 ${BLOCK_THRESHOLD} 条。`)
    lines.push('')
    lines.push(`（命中处数 ${verdict.blockHits ?? hits.filter((x) => x.severity === 'block').length} 处 —— 阈值按**不同雷区**算：同一种病写三遍不拦，病得五花八门才拦。）`)
    lines.push('')
    lines.push('命中的重灾区：')
    lines.push('')
    const seenBlock = new Set()
    for (const h of hits.filter((x) => x.severity === 'block')) {
      const spec = specById?.[h.specId] ?? SPEC_BY_ID.get(h.specId)
      lines.push(`- \`${h.specId}\` **${h.title}**${h.where ? ` —— ${h.where}` : ''}${h.evidence ? `：${h.evidence}` : ''}`)
      if (spec) lines.push(`  - ${spec.why}`)
      seenBlock.add(h.specId)
    }
  } else if (verdict.verdict === 'conditional') {
    lines.push('### ⚠ **可以润色，但有条件**')
    lines.push('')
    lines.push(`命中重灾区 ${verdict.distinctBlockSpecs} 条不同雷区（未达打回阈值 ${BLOCK_THRESHOLD} 条），另有建议级 ${verdict.warnCount} 条。`)
    lines.push('润色时下面这几条**必须逐条改掉**，不许放过。')
  } else {
    lines.push('### ✅ **可以放行润色**')
    lines.push('')
    lines.push(`没有命中重灾区，另有建议级 ${verdict.warnCount} 条。`)
  }
  lines.push('')
  for (const r of verdict.reasons) lines.push(`- ${r}`)
  lines.push('')
  lines.push('| 指标 | 值 |')
  lines.push('|---|---|')
  lines.push(`| 正文字数 | ${chars} |`)
  lines.push(`| 命中总数 | ${hits.length} |`)
  lines.push(`| 重灾区（不同雷区数） | ${verdict.distinctBlockSpecs} |`)
  lines.push(`| 重灾区（命中处数） | ${verdict.blockHits ?? 0} |`)
  lines.push(`| 建议改（warn） | ${verdict.warnCount} |`)
  for (const d of DIMENSIONS) {
    lines.push(`| ${d.label}维度命中 | ${byDimension[d.id] ?? 0} |`)
  }
  lines.push('')

  // —— 第一段：词句扫描与拦截 ——
  lines.push('## 🔍 词句扫描与拦截')
  lines.push('')
  if (hits.length === 0) {
    lines.push('没有命中任何雷区。')
    lines.push('')
  } else {
    lines.push('每条命中都附**原文证据**与**定位** —— 指不出位置的不算数。')
    lines.push('')
    for (const h of hits) {
      const spec = specById?.[h.specId] ?? SPEC_BY_ID.get(h.specId)
      const sev = h.severity === 'block' ? '🔴 打回重写' : '🟡 建议改'
      lines.push(`### ${sev}｜${h.title}`)
      lines.push('')
      lines.push(`- **雷区 id**：\`${h.specId}\``)
      lines.push(`- **定位**：${h.where || '（⚠ 未定位 —— 这条命中不可复核）'}`)
      lines.push(`- **原文证据**：${h.evidence ? `> ${h.evidence}` : '（⚠ 无证据）'}`)
      if (h.note) lines.push(`- **补充**：${h.note}`)
      if (spec) {
        lines.push(`- **为什么这是 AI 味**：${spec.why}`)
        lines.push(`- **判据**：${spec.rule}`)
        lines.push(`- **放行条件**：${spec.allow}`)
      }
      lines.push('')
    }
  }

  // —— 第二段：强制手术 ——
  lines.push('## 🔪 强制手术')
  lines.push('')
  if (reworks.length === 0) {
    lines.push('无需手术。')
    lines.push('')
  } else {
    lines.push('Before & After 对照。**After 是人工审过的活人写法**，不是现编的。')
    lines.push('')
    for (const r of reworks) {
      lines.push(`### ${r.title}`)
      lines.push('')
      if (r.where) lines.push(`- **位置**：${r.where}`)
      lines.push('')
      lines.push('**Before（AI 味）**')
      lines.push('')
      lines.push('> ' + (r.evidence || r.badExample || '（原文证据缺失）'))
      lines.push('')
      lines.push('**After（活人味）**')
      lines.push('')
      lines.push('> ' + (r.good ?? '（没有登记示范）'))
      lines.push('')
      lines.push(`- **病理**：${r.why}`)
      lines.push(`- **要改成什么样**：${r.fix}`)
      lines.push('')
    }
  }

  // —— 第三段：去 AI 味升级指令 ——
  lines.push('## 🏆 去 AI 味升级指令')
  lines.push('')
  lines.push('下面这份可以直接粘给写作方或改写方。')
  lines.push('')
  lines.push('---')
  lines.push('')
  lines.push(opts.directive ?? '（未提供强制指令）')
  lines.push('')
  lines.push('---')
  lines.push('')

  return lines.join('\n')
}

/**
 * 把裁决 + 命中整理成 JSON（给 HTTP 接口用）。
 *
 * HTTP 接口要机器可读的结果，不只是 Markdown。
 * @param {any} detectResult
 * @param {object} [opts]
 */
export function buildAuditResult(detectResult, opts = {}) {
  const hits = normalizeHits(detectResult)
  const { bySeverity, byDimension } = tally(hits)
  const verdict = judge(detectResult)
  const reworks = reworkInstructions(detectResult, opts.specById ?? SPEC_BY_ID)
  return {
    ok: true,
    chars: Number(detectResult?.chars ?? 0),
    hits,
    bySeverity,
    byDimension,
    // blockCount 语义：**不同 block 级 specId 的个数** —— 与 detect() 的 blockCount、
    // spec.js 的 judgeReject 同一口径。不存在第二个含义。
    blockCount: verdict.distinctBlockSpecs,
    distinctBlockSpecs: verdict.distinctBlockSpecs,
    blockHits: verdict.blockHits ?? 0,
    warnCount: verdict.warnCount,
    shouldReject: verdict.verdict === 'reject',
    verdict: verdict.verdict,
    canPolish: verdict.canPolish,
    reasons: verdict.reasons,
    reworks,
    report: buildReport(detectResult, opts),
  }
}

/**
 * 规则清单的 JSON 形态（给 `GET /spec` 用）。
 */
export function specDigest() {
  return {
    dimensions: DIMENSIONS,
    // 两个名字都给：`blockThreshold` 是本插件内部一直用的叫法，
    // `threshold` 是浏览器半读的字段。同一个概念两种拼写会让界面
    // 悄悄 fallback 到硬编码常量 —— 那样将来改阈值时界面不会跟着变，
    // 而且没人会发现。所以这里显式对齐，而不是靠调用方兜底。
    blockThreshold: BLOCK_THRESHOLD,
    threshold: BLOCK_THRESHOLD,
    specs: SPECS.map((s) => ({
      id: s.id,
      dim: s.dim,
      no: s.no,
      title: s.title,
      why: s.why,
      rule: s.rule,
      severity: s.severity,
      allow: s.allow,
      fix: s.fix,
      good: goodSampleOf(s.id),
    })),
  }
}

/**
 * 取一条雷区的说明（供工具描述与报错用）。
 * @param {string} id
 */
export function describeSpec(id) {
  const s = specOf(id)
  return s === null ? null : `${s.title}（${s.rule}）`
}

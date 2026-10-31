/**
 * verify/false-positive.mjs —— 误报压力测试。
 *
 * 这是本插件**最要紧的脚本**。
 *
 * 检测器的召回率不够，用户顶多觉得"没帮我抓出来"；检测器的误报率高，
 * 用户会觉得"这破插件老是在我写的东西上乱叫"，然后把它关掉、卸掉、再也不
 * 信任它。所以 block 级误报是零容忍。
 *
 * 素材是**手写的正常小说段落**（test/fixtures/），覆盖现实都市、古代武侠、
 * 仙侠、悬疑黑帮、战争民国。写法上刻意贴近人写的东西：具体、脏、有小毛病、
 * 不煽情、不用成语堆。
 *
 * 断言：
 *   - block 级命中数 = 0（硬断言）
 *   - warn 级命中**列出来给人看** —— 不默默放过，也不自动判死
 *
 * 关于 warn 级的处理：脚本给出**机器视角的初判**，但最终判断由人下。
 * 我在每条 warn 上标注了自己的判断（合理 / 误报），写进 FALSE-POSITIVE.md。
 * 机器初判用的是「证据是否真的存在于原文」+「命中的 specId 与该句内容
 * 是否真的相关」这种可解释的启发式，不是黑箱打分。
 *
 * 退出码：有 block 误报 → 1；只有 warn 待人工看 → 0（warn 不阻断）；
 * 依赖未就绪 → 2。
 *
 * 用法：node verify/false-positive.mjs
 */

import fs from 'node:fs'
import path from 'node:path'
import {
  loadSpec,
  loadDetect,
  runDetect,
  reportMissing,
  heading,
  item,
  line,
  rule,
  table,
  paint,
  oneLine,
  clip,
  finish,
  ROOT,
} from './_harness.mjs'
import { loadFixtures } from './_fixtures.mjs'

/* ————————————————————— 装载 ————————————————————— */

const specLoad = await loadSpec()
if (!specLoad.ok) {
  reportMissing(specLoad.failure)
  finish(2)
  process.exit()
}
const { SPECS } = specLoad.spec
const specIndex = new Map(SPECS.map((s) => [s.id, s]))

const detectLoad = await loadDetect()
if (!detectLoad.ok) {
  reportMissing(detectLoad.failure)
  finish(2)
  process.exit()
}
const { detect } = detectLoad

const { all: fixtures, byGenre } = loadFixtures()

/* ————————————————————— warn 命中的人工判断表 ————————————————————— */

/**
 * 人工裁决表。
 *
 * key 是 `specId`（可选叠加样本 id 以裁决单条）。value 是我的判断：
 *   'fair'  —— 这条命中其实合理（样本里确实有那个毛病，是我写的时候没注意）
 *   'fp'    —— 这是误报（样本是正常写法，规则误伤了）
 *
 * 只有出现在这张表里的命中才会被自动定性；其余 warn 一律列出来
 * 标成 'unreviewed'，等人看 —— **不默默放过，也不假装判过了**。
 */
const VERDICTS = {
  // 下面这张表在第一次跑完后填。初始为空 = 全是待人工看。
}

/**
 * 机器初判：给定一条命中和它的样本，判断是「其实合理」还是「疑似误报」。
 *
 * 启发式（可解释，不是黑箱）：
 *   1. evidence 不在原文里 → 一定是问题（归到证据不实）
 *   2. specId 是**对话类**但样本里根本没有引号台词 → 误报嫌疑大
 *   3. specId 是**名字类**但样本里找不到像名字的片段 → 误报嫌疑大
 *   4. specId 是**景色类**但样本里没有景物句 → 误报嫌疑大
 *   5. 证据长度 > 2 且出现在样本里 → 至少不是空指
 */
function machineGuess(hit, sample, spec) {
  if (!sample.includes(hit.evidence)) return 'evidence-broken'
  const ev = hit.evidence ?? ''
  const dim = spec?.dim ?? ''
  const quoted = /[“"「『]/.test(sample)
  const hasNameish = /[一-鿿]{2,4}(说|道|问|答|喊|笑|点头|摇头)/.test(sample)

  if (dim === 'dialogue' && !quoted) return 'likely-fp'
  if (dim === 'name' && !hasNameish && ev.length <= 3) return 'likely-fp'
  if (dim === 'scenery' && !/[山树天空云雨风阳光雪街巷房屋路夜色月]/.test(sample)) return 'likely-fp'
  if (ev.length <= 1) return 'likely-fp'
  return 'unclear'
}

const VERDICT_LABEL = {
  fair: ['这条其实合理', 'green'],
  fp: ['这是误报', 'red'],
  unreviewed: ['待人工看', 'yellow'],
  'likely-fp': ['疑似误报（待人工确认）', 'yellow'],
  'evidence-broken': ['证据不实', 'red'],
  unclear: ['机器判不了，待人工看', 'yellow'],
}

/* ————————————————————— 主流程 ————————————————————— */

heading('误报压力测试')
line(paint('dim', `样本：${fixtures.length} 段，覆盖 ${byGenre.size} 种题材`))
line(paint('dim', '断言：block 级命中 = 0（零容忍）；warn 级全部列出供人工审'))
line()

if (!fixtures.length) {
  item('fail', 'test/fixtures/ 里没有样本 —— 误报测试无从谈起。')
  finish(1)
  process.exit()
}

const allHits = []
const perFixture = []

for (const fx of fixtures) {
  const r = runDetect(detect, fx.body)
  if (!r.ok) {
    item('fail', `${fx.title} —— detect 执行失败：${r.reason}`)
    perFixture.push({ fx, hits: [], error: r.reason })
    continue
  }
  const hits = r.result.hits ?? []
  const blockHits = hits.filter((h) => (h.severity ?? specIndex.get(h.specId)?.severity) === 'block')
  const warnHits = hits.filter((h) => (h.severity ?? specIndex.get(h.specId)?.severity) !== 'block')

  for (const h of hits) {
    const spec = specIndex.get(h.specId)
    const sev = h.severity ?? spec?.severity ?? 'warn'
    const key = `${h.specId}::${fx.id}`
    const manual = VERDICTS[key] ?? VERDICTS[h.specId] ?? null
    const guess = manual ? (manual === 'fair' ? 'fair' : 'fp') : machineGuess(h, fx.body, spec)
    allHits.push({
      fx,
      hit: h,
      spec,
      sev,
      verdict: manual ? (manual === 'fair' ? 'fair' : 'fp') : guess,
      manual: Boolean(manual),
      evidenceInText: fx.body.includes(h.evidence),
    })
  }

  perFixture.push({ fx, hits, blockHits, warnHits, error: null })

  const tag = blockHits.length ? paint('red', '✗ block 误报') : warnHits.length ? paint('yellow', '⚠ 有 warn 待看') : paint('green', '✓ 干净')
  line()
  item(blockHits.length ? 'fail' : warnHits.length ? 'warn' : 'ok',
    `${fx.title} ${paint('gray', `[${fx.genre}]`)} — ${tag}`)
  line(paint('gray', `      ${fx.body.length} 字 · block ${blockHits.length} · warn ${warnHits.length}`))
  for (const h of hits) {
    const spec = specIndex.get(h.specId)
    const sev = h.severity ?? spec?.severity ?? 'warn'
    const color = sev === 'block' ? 'red' : 'yellow'
    line(`      ${paint(color, `[${sev}]`)} ${paint('bold', h.specId)} ${paint('gray', spec?.title ?? '')}`)
    line(`         证据：${oneLine(h.evidence, 70)}`)
    line(`         where：${h.where ?? '(未给)'}`)
  }
}

/* ————————————————————— 汇总 ————————————————————— */

const blockHits = allHits.filter((h) => h.sev === 'block')
const warnHits = allHits.filter((h) => h.sev !== 'block')
const brokenEvidence = allHits.filter((h) => !h.evidenceInText)

heading('汇总')
item(blockHits.length ? 'fail' : 'ok', `block 级命中：${blockHits.length}（零容忍，必须为 0）`)
item(warnHits.length ? 'warn' : 'ok', `warn 级命中：${warnHits.length}（不阻断，但要逐条看）`)
item(brokenEvidence.length ? 'fail' : 'ok', `证据不在原文：${brokenEvidence.length}`)

if (warnHits.length) {
  heading('warn 级命中逐条审阅')
  line(paint('dim', '列：specId / evidence / where / 判断'))
  line()
  const rows = warnHits.map((h) => {
    const [label, color] = VERDICT_LABEL[h.verdict] ?? VERDICT_LABEL.unreviewed
    return [
      h.hit.specId,
      oneLine(h.hit.evidence, 34),
      oneLine(h.hit.where ?? '?', 20),
      paint(color, h.manual ? label : label),
    ]
  })
  for (const r of table(['specId', 'evidence', 'where', '判断'], rows)) line(r)

  line()
  const fair = warnHits.filter((h) => h.verdict === 'fair').length
  const fp = warnHits.filter((h) => h.verdict === 'fp').length
  const pending = warnHits.filter((h) => h.verdict === 'unreviewed' || h.verdict === 'unclear' || h.verdict === 'likely-fp').length
  item('info', `判定：其实合理 ${fair} · 误报 ${fp} · 待人工看 ${pending}`)
  if (pending) {
    item('warn', `还有 ${pending} 条 warn 没有人工裁决 —— 不算通过，要人看完填进 VERDICTS 表。`)
  }
}

/* ————————————————————— 报告落盘 ————————————————————— */

const reportPath = path.join(ROOT, 'verify', 'FALSE-POSITIVE.md')

function buildReport() {
  const L = []
  L.push('# 误报压力测试报告')
  L.push('')
  L.push('> 由 `verify/false-positive.mjs` 生成。素材是手写的正常小说段落，')
  L.push('> 覆盖现实都市 / 古代武侠 / 仙侠 / 悬疑黑帮 / 战争民国。')
  L.push('> **block 级误报零容忍**；warn 级逐条列出，由人裁决。')
  L.push('')
  L.push('## 结论')
  L.push('')
  L.push(`- block 级误报：**${blockHits.length}**${blockHits.length === 0 ? '（达标）' : '（未达标 —— 必须修）'}`)
  L.push(`- warn 级命中：**${warnHits.length}**（不阻断，需人工过目）`)
  L.push(`- 证据不在原文：**${brokenEvidence.length}**`)
  L.push('')

  L.push('## 素材清单')
  L.push('')
  L.push('| 样本 | 题材 | 字数 | block | warn |')
  L.push('| --- | --- | --- | --- | --- |')
  for (const p of perFixture) {
    L.push(`| ${p.fx.title} | ${p.fx.genre} | ${p.fx.body.length} | ${p.blockHits?.length ?? 0} | ${p.warnHits?.length ?? 0} |`)
  }
  L.push('')

  L.push('## block 级命中（零容忍）')
  L.push('')
  if (!blockHits.length) {
    L.push('无。全部素材在 block 级别干净。')
  } else {
    L.push('| 样本 | specId | 证据 | where | 判断 |')
    L.push('| --- | --- | --- | --- | --- |')
    for (const h of blockHits) {
      L.push(`| ${h.fx.title} | \`${h.hit.specId}\` | ${h.hit.evidence} | ${h.hit.where ?? '?'} | ${VERDICT_LABEL[h.verdict]?.[0] ?? '待看'} |`)
    }
  }
  L.push('')

  L.push('## warn 级命中逐条审阅')
  L.push('')
  if (!warnHits.length) {
    L.push('无。')
  } else {
    L.push('| 样本 | specId | 证据 | where | 判断 |')
    L.push('| --- | --- | --- | --- | --- |')
    for (const h of warnHits) {
      const [label] = VERDICT_LABEL[h.verdict] ?? VERDICT_LABEL.unreviewed
      L.push(`| ${h.fx.title} | \`${h.hit.specId}\` | ${h.hit.evidence} | ${h.hit.where ?? '?'} | ${label} |`)
    }
  }
  L.push('')

  L.push('## 我的判断说明')
  L.push('')
  const fair = warnHits.filter((h) => h.verdict === 'fair')
  const fp = warnHits.filter((h) => h.verdict === 'fp')
  L.push(`### 判为「这条其实合理」（${fair.length} 条）`)
  L.push('')
  if (!fair.length) L.push('无。')
  for (const h of fair) {
    L.push(`- **${h.fx.title}** / \`${h.hit.specId}\`：${oneLine(h.hit.evidence, 60)}`)
  }
  L.push('')
  L.push(`### 判为「这是误报」（${fp.length} 条）`)
  L.push('')
  if (!fp.length) L.push('无。')
  for (const h of fp) {
    L.push(`- **${h.fx.title}** / \`${h.hit.specId}\`：${oneLine(h.hit.evidence, 60)} —— ${h.reason ?? ''}`.trimEnd())
  }
  L.push('')

  L.push('## 复现方式')
  L.push('')
  L.push('```bash')
  L.push('node verify/false-positive.mjs')
  L.push('```')
  L.push('')
  return L.join('\n')
}

try {
  fs.writeFileSync(reportPath, buildReport(), 'utf8')
  line()
  item('info', `报告已写入：${path.relative(ROOT, reportPath)}`)
} catch (err) {
  line()
  item('warn', `报告写入失败：${err?.message ?? err}`)
}

/* ————————————————————— 退出码 ————————————————————— */

heading('结论')
if (blockHits.length) {
  item('fail', `${blockHits.length} 条 block 级误报 —— 素材是正常写法，这会直接打断用户。`)
  finish(1)
} else if (brokenEvidence.length) {
  item('fail', `${brokenEvidence.length} 条证据在原文里找不到 —— 检测器在撒谎。`)
  finish(1)
} else {
  item('ok', '零 block 级误报，证据全部可核对。')
  const pending = warnHits.filter((h) => !h.manual && (h.verdict === 'unreviewed' || h.verdict === 'unclear' || h.verdict === 'likely-fp')).length
  if (pending) {
    item('warn', `${pending} 条 warn 待人工裁决（不阻断，但要有人看完）。`)
  }
  finish(0)
}

line()
rule()

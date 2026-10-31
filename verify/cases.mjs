/**
 * verify/cases.mjs —— 40 组验收用例回放。
 *
 * 这是本插件的**回归测试集**。契约层 `lib/spec.js` 里的 CASES 是从用户
 * 原始材料逐字抄下来的，没有加工 —— AI 味那半（bad）必须命中，活人那半
 * （good）必须放行。
 *
 * 三类断言：
 *   1. **漏检**：bad 样本没有命中该 specId → 插件没用
 *   2. **误报**：good 样本命中了该 specId → 插件会被用户弃用（更致命）
 *   3. **证据不实**：命中的 evidence 在原文里找不到 → 插件在撒谎
 *
 * 注意断言范围：只断言**该 specId** 上有没有命中，不是「整个 hits 里不能有
 * 东西」—— 活人写的段落也完全可能触发别的雷区（比如某个 good 样本顺手
 * 写了个「林凡」，那该报的是 name.cliche-surname，不是被这条用例判死）。
 *
 * 退出码：有漏检或误报 → 1；全过 → 0；依赖未就绪 → 2。
 *
 * 用法：node verify/cases.mjs
 */

import {
  loadSpec,
  loadDetect,
  runDetect,
  hitsFor,
  reportMissing,
  heading,
  item,
  line,
  rule,
  table,
  paint,
  clip,
  oneLine,
  finish,
  mark,
  warnMark,
  infoMark,
} from './_harness.mjs'

/* ————————————————————— 主流程 ————————————————————— */

const specLoad = await loadSpec()
if (!specLoad.ok) {
  reportMissing(specLoad.failure)
  finish(2)
  process.exit()
}

const { SPECS, CASES } = specLoad.spec
const { judgeReject } = specLoad.spec
const specIndex = new Map(SPECS.map((s) => [s.id, s]))

/* ————————————————————— 0. judgeReject 口径断言 ————————————————————— */
/*
 * 这一段是**纯函数**断言，不依赖 lib/detect.js —— 所以即使检测器还没交付，
 * 它也能单独跑、单独给出结论。
 *
 * 口径（lead 定）：阈值数的是「**不同的** block 级 specId 的个数」，
 * 不是命中处数。同一个写景习惯的五次「残阳如血」+ 一次「阳光明媚」
 * 只有 2 条不同雷区 → 不拦。
 */

const judgeResults = []
/**
 * @param {string} label
 * @param {any} result
 * @param {{reject:boolean, distinctBlockSpecs:number}} expected
 */
function judgeCase(label, result, expected) {
  let j = null
  let err = null
  try {
    j = judgeReject(result)
  } catch (e) {
    err = e
  }
  const problems = []
  if (err) {
    problems.push(`judgeReject 抛错：${err?.message ?? err}`)
  } else {
    if (j.reject !== expected.reject) problems.push(`reject 应为 ${expected.reject}，实际 ${j.reject}`)
    if (j.distinctBlockSpecs !== expected.distinctBlockSpecs) {
      problems.push(`distinctBlockSpecs 应为 ${expected.distinctBlockSpecs}，实际 ${j.distinctBlockSpecs}`)
    }
  }
  const ok = problems.length === 0
  judgeResults.push({ label, ok, problems, actual: j })
  return ok
}

/** 造一条命中。 */
const mk = (specId, severity, i = 0) => ({ specId, severity, evidence: `证据${i}`, where: '测试' })

heading('0. judgeReject 判定口径断言')

if (typeof specLoad.spec.judgeReject !== 'function') {
  item('fail', '契约层没有导出 judgeReject —— 打回口径无法验证。')
  judgeResults.push({ label: 'judgeReject 存在', ok: false, problems: ['未导出 judgeReject'] })
} else {
  item('ok', '契约层已导出 judgeReject')

  // 1. 同一 specId 的 block 命中 5 次 + 另一个 specId 的 block 命中 1 次
  judgeCase(
    '同一 specId ×5 + 另一 specId ×1 → 不拦（distinct=2）',
    { hits: [
      ...Array.from({ length: 5 }, (_, i) => mk('scenery.blood-sunset', 'block', i)),
      mk('scenery.sunny-opening', 'block', 9),
    ] },
    { reject: false, distinctBlockSpecs: 2 },
  )

  // 2. 三个不同 specId 的 block 命中各 1 次 → 拦
  judgeCase(
    '三个不同 specId 的 block 各 1 次 → 拦（distinct=3）',
    { hits: [
      mk('scenery.blood-sunset', 'block', 0),
      mk('scenery.sunny-opening', 'block', 1),
      mk('scenery.idiom-stack', 'block', 2),
    ] },
    { reject: true, distinctBlockSpecs: 3 },
  )

  // 3. 三个不同 specId 的 warn 命中 → 不拦，distinct=0
  judgeCase(
    '三个不同 specId 的 warn → 不拦（distinct=0，warn 不计重灾区）',
    { hits: [
      mk('dialogue.exclamation', 'warn', 0),
      mk('dialogue.same-voice', 'warn', 1),
      mk('dialogue.no-subtext', 'warn', 2),
    ] },
    { reject: false, distinctBlockSpecs: 0 },
  )

  // 补充：混合 —— 2 个不同 block spec（其中一个重复多次）+ 1 个 warn
  judgeCase(
    '补充：2 个不同 block spec + warn → 不拦（distinct=2）',
    { hits: [
      mk('scenery.blood-sunset', 'block', 0),
      mk('scenery.blood-sunset', 'block', 1),
      mk('scenery.blood-sunset', 'block', 2),
      mk('object.hollow-epic', 'block', 3),
      mk('dialogue.exclamation', 'warn', 4),
    ] },
    { reject: false, distinctBlockSpecs: 2 },
  )

  // 补充：空 hits
  judgeCase(
    '补充：空 hits → 不拦（distinct=0）',
    { hits: [] },
    { reject: false, distinctBlockSpecs: 0 },
  )

  // 补充：恰好等于阈值 = 3 → 拦
  judgeCase(
    '补充：恰好 3 条不同 block spec → 拦（>= 阈值）',
    { hits: [
      mk('a.one', 'block', 0), mk('b.two', 'block', 1), mk('c.three', 'block', 2),
    ] },
    { reject: true, distinctBlockSpecs: 3 },
  )

  for (const r of judgeResults) {
    if (r.ok) {
      item('ok', r.label)
    } else {
      item('fail', r.label)
      for (const p of r.problems) line(`      ${p}`)
    }
  }
}

const judgeFailed = judgeResults.filter((r) => !r.ok).length
item(judgeFailed ? 'fail' : 'ok', `judgeReject 断言：${judgeResults.length - judgeFailed} / ${judgeResults.length} 通过`)

/* ————————————————————— 1. 40 组用例回放 ————————————————————— */

const detectLoad = await loadDetect()
if (!detectLoad.ok) {
  reportMissing(detectLoad.failure)
  line()
  item('warn', 'judgeReject 断言已在上方独立完成 —— 它们不依赖检测器。')
  line()
  item('fail', '用例回放无法进行：检测器未就绪。')
  finish(judgeFailed ? 1 : 2)
  process.exit()
}

const { detect } = detectLoad

heading('40 组验收用例回放')
line(paint('dim', `契约：${SPECS.length} 条雷区 / ${CASES.length} 组用例`))
line(paint('dim', `引擎：lib/detect.js`))

/* ————————————————————— 逐组回放 ————————————————————— */

/** @type {{specId:string, title:string, dim:string, severity:string, badTotal:number, badHit:number, goodTotal:number, goodFP:number, misses:any[], fps:any[], errors:any[], evidenceFakes:any[]}[]} */
const report = []
const globalMisses = []
const globalFPs = []
const globalEvidenceFakes = []
const globalErrors = []
const globalBlockCountMismatch = []

/**
 * 接口一致性检查：detect() 返回的 blockCount，语义应当是
 * 「不同 block 级 specId 的个数」，与 judgeReject().distinctBlockSpecs 一致。
 *
 * 如果两者不一致，说明 detect 与契约层的打回口径对不上 —— 这是接口 bug，
 * 不是用例 bug，必须报出来。
 */
function checkBlockCount(result, sample, specId) {
  if (typeof result?.blockCount !== 'number') return
  let j = null
  try {
    j = judgeReject(result)
  } catch { return }
  if (!j) return
  if (result.blockCount !== j.distinctBlockSpecs) {
    globalBlockCountMismatch.push({
      specId,
      sample,
      detectBlockCount: result.blockCount,
      judgeDistinct: j.distinctBlockSpecs,
    })
  }
}

for (const c of CASES) {
  const spec = specIndex.get(c.specId)
  const entry = {
    specId: c.specId,
    title: spec?.title ?? '(未知雷区)',
    dim: spec?.dim ?? '?',
    severity: spec?.severity ?? '?',
    badTotal: (c.bad ?? []).length,
    badHit: 0,
    goodTotal: (c.good ?? []).length,
    goodFP: 0,
    misses: [],
    fps: [],
    errors: [],
    evidenceFakes: [],
  }

  /* —— bad 样本：该命中 —— */
  for (const sample of c.bad ?? []) {
    const r = runDetect(detect, sample)
    if (!r.ok) {
      entry.errors.push({ sample, reason: r.reason })
      globalErrors.push({ specId: c.specId, sample, reason: r.reason })
      continue
    }
    checkBlockCount(r.result, sample, c.specId)
    const hits = hitsFor(r.result, c.specId)
    if (hits.length > 0) {
      entry.badHit++
      // 证据必须真实存在于原文
      for (const h of hits) {
        if (!sample.includes(h.evidence)) {
          entry.evidenceFakes.push({ sample, evidence: h.evidence, where: h.where })
          globalEvidenceFakes.push({ specId: c.specId, sample, evidence: h.evidence, where: h.where })
        }
      }
    } else {
      entry.misses.push(sample)
      globalMisses.push({ specId: c.specId, title: entry.title, severity: entry.severity, sample })
    }
  }

  /* —— good 样本：该放行 —— */
  for (const sample of c.good ?? []) {
    const r = runDetect(detect, sample)
    if (!r.ok) {
      entry.errors.push({ sample, reason: r.reason })
      globalErrors.push({ specId: c.specId, sample, reason: r.reason })
      continue
    }
    checkBlockCount(r.result, sample, c.specId)
    const hits = hitsFor(r.result, c.specId)
    if (hits.length > 0) {
      entry.goodFP++
      entry.fps.push({
        sample,
        evidence: hits.map((h) => h.evidence).join(' | '),
        where: hits.map((h) => h.where ?? '?').join(' | '),
      })
      globalFPs.push({ specId: c.specId, title: entry.title, severity: entry.severity, sample, evidence: entry.fps.at(-1).evidence })
    }
  }

  report.push(entry)
}

/* ————————————————————— 输出：逐条表 ————————————————————— */

heading('逐条结果')
line(paint('dim', '列含义：specId | bad命中数/bad总数 | good误报数 | 结论'))

const rows = report.map((e) => {
  const badCell = `${e.badHit}/${e.badTotal}`
  const verdict = e.errors.length
    ? 'ERROR'
    : e.misses.length
      ? '漏检'
      : e.goodFP
        ? '误报'
        : e.evidenceFakes.length
          ? '证据不实'
          : 'OK'
  const flag =
    verdict === 'OK'
      ? paint('green', 'OK')
      : verdict === 'ERROR'
        ? paint('yellow', 'ERROR')
        : paint('red', verdict)
  return [e.specId, badCell, String(e.goodFP), `${flag} ${e.title}`]
})

for (const r of table(['specId', 'bad命中', 'good误报', '结论'], rows)) line(r)

/* ————————————————————— 统计 ————————————————————— */

const totalBad = report.reduce((s, e) => s + e.badTotal, 0)
const totalBadHit = report.reduce((s, e) => s + e.badHit, 0)
const totalGood = report.reduce((s, e) => s + e.goodTotal, 0)
const totalGoodFP = report.reduce((s, e) => s + e.goodFP, 0)
const cleanSpecs = report.filter((e) => !e.misses.length && !e.goodFP && !e.errors.length && !e.evidenceFakes.length).length

heading('统计')
item(globalMisses.length ? 'fail' : 'ok', `漏检：${globalMisses.length} / ${totalBad} 个 bad 样本未被命中`)
item(globalFPs.length ? 'fail' : 'ok', `误报：${globalFPs.length} / ${totalGood} 个 good 样本被误判`)
item(globalEvidenceFakes.length ? 'fail' : 'ok', `证据不实：${globalEvidenceFakes.length} 条 evidence 在原文中找不到`)
item(globalErrors.length ? 'warn' : 'ok', `执行错误：${globalErrors.length} 次（detect 抛错或返回形状不合法）`)
item(globalBlockCountMismatch.length ? 'fail' : 'ok', `blockCount 接口不一致：${globalBlockCountMismatch.length} 处（detect().blockCount ≠ judgeReject().distinctBlockSpecs）`)
item(judgeFailed ? 'fail' : 'ok', `judgeReject 口径断言：${judgeResults.length - judgeFailed} / ${judgeResults.length} 通过`)
line()
item(
  globalMisses.length || globalFPs.length ? 'fail' : 'ok',
  `全清雷区：${cleanSpecs} / ${report.length}`,
)
const passRate = totalBad ? ((totalBadHit / totalBad) * 100).toFixed(1) : '—'
item(
  globalMisses.length ? 'fail' : 'ok',
  `bad 召回率：${totalBadHit}/${totalBad}（${passRate}%）`,
)

/* ————————————————————— 失败明细 ————————————————————— */

if (globalMisses.length) {
  heading('漏检明细（插件没用）')
  for (const m of globalMisses) {
    item('fail', `${paint('bold', m.specId)} ${m.title} ${paint('gray', `[${m.severity}]`)}`)
    line(`      样本：${oneLine(m.sample, 100)}`)
  }
}

if (globalFPs.length) {
  heading('误报明细（更致命）')
  for (const f of globalFPs) {
    item('fail', `${paint('bold', f.specId)} ${f.title} ${paint('gray', `[${f.severity}]`)}`)
    line(`      样本：${oneLine(f.sample, 100)}`)
    line(`      证据：${oneLine(f.evidence, 100)}`)
  }
}

if (globalEvidenceFakes.length) {
  heading('证据不实明细（插件在撒谎）')
  for (const e of globalEvidenceFakes) {
    item('fail', `${paint('bold', e.specId)}`)
    line(`      原文：${oneLine(e.sample, 100)}`)
    line(`      声称的 evidence：${paint('red', oneLine(e.evidence, 100))}`)
    line(`      where：${e.where ?? '(未给)'}`)
    line(`      ${paint('gray', '→ 该字符串在原文中不存在（可能是检测器改写了原文，或截取时错位）')}`)
  }
}

if (globalErrors.length) {
  heading('执行错误明细')
  for (const e of globalErrors) {
    item('warn', `${e.specId} — ${e.reason}`)
    line(`      样本：${oneLine(e.sample, 80)}`)
  }
}

/* ————————————————————— 结论 ————————————————————— */

heading('结论')
const failed = globalMisses.length > 0 || globalFPs.length > 0 || globalEvidenceFakes.length > 0
if (globalErrors.length && !failed) {
  item('warn', `用例执行不完整：${globalErrors.length} 次错误，结果仅供参考。`)
}
if (failed) {
  item('fail', '验收用例未通过 —— 存在漏检或误报，插件当前不可信。')
  line(paint('dim', '（这些是发现的问题，不是修改建议。请交给工程师队友修 lib/。）'))
  finish(1)
} else if (globalErrors.length) {
  item('fail', '验收用例未通过 —— 存在执行错误。')
  finish(1)
} else {
  item('ok', '全部 40 组验收用例通过：bad 全中、good 全放行、证据全部可核对。')
  finish(0)
}

line()
rule()

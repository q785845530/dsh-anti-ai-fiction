#!/usr/bin/env node
/**
 * dsh-anti-ai-fiction — 契约层自检。
 *
 * `lib/spec.js` 是全插件的单一事实源：40 条雷区、40 组验收用例、词表。
 * 它一旦漂移，后面所有检测器、提示词、界面都会跟着错，而且**错得静悄悄**。
 *
 * 所以这个脚本在每次改动契约后都要跑。它检查的是**结构性契约**：
 * 条数对不对、id 有没有重复、用例和雷区有没有一一对应、
 * 词表有没有重复项（重复项会让「命中计数」虚高，是隐形的 bug）。
 *
 * 检测器的**行为**正确性由 `verify/cases.mjs` 负责。两者分工：
 * 这里管「表长得对不对」，那里管「判得准不准」。
 */
import { SPECS, CASES, DIMENSIONS, RARITY, CLICHE_SURNAMES, CLICHE_GIVEN, CONCRETE_SENSORY } from '../lib/spec.js'

const problems = []
const notes = []

function dupOf(arr) {
  return arr.filter((x, i) => arr.indexOf(x) !== i)
}

// 1) 条数
if (SPECS.length !== 40) problems.push(`SPECS 应该是 40 条，实际 ${SPECS.length}`)
if (CASES.length !== 40) problems.push(`CASES 应该是 40 组，实际 ${CASES.length}`)
if (DIMENSIONS.length !== 4) problems.push(`DIMENSIONS 应该是 4 个维度，实际 ${DIMENSIONS.length}`)

// 2) id 唯一
const specIds = SPECS.map((s) => s.id)
for (const d of dupOf(specIds)) problems.push(`雷区 id 重复：${d}`)
const caseIds = CASES.map((c) => c.specId)
for (const d of dupOf(caseIds)) problems.push(`用例 specId 重复：${d}`)

// 3) 用例与雷区一一对应
const specIdSet = new Set(specIds)
for (const c of CASES) {
  if (!specIdSet.has(c.specId)) problems.push(`用例指向不存在的雷区：${c.specId}`)
}
for (const s of SPECS) {
  if (!caseIds.includes(s.id)) problems.push(`雷区没有验收用例：${s.id}`)
}

// 4) 每条雷区字段完整
const dimIds = new Set(DIMENSIONS.map((d) => d.id))
for (const s of SPECS) {
  for (const field of ['id', 'dim', 'no', 'title', 'why', 'rule', 'detector', 'severity', 'allow', 'fix']) {
    if (s[field] === undefined || s[field] === '') {
      problems.push(`雷区 ${s.id} 缺字段 ${field}`)
    }
  }
  if (!dimIds.has(s.dim)) problems.push(`雷区 ${s.id} 的维度非法：${s.dim}`)
  if (!['block', 'warn'].includes(s.severity)) problems.push(`雷区 ${s.id} 的 severity 非法：${s.severity}`)
}

// 5) 每条雷区的 detector 名唯一（同名会让两个雷区抢同一个检测器）
for (const d of dupOf(SPECS.map((s) => s.detector))) {
  problems.push(`detector 名重复（会互相抢）：${d}`)
}

// 6) 词表重复项
for (const [name, arr] of [['RARITY', RARITY], ['CLICHE_SURNAMES', CLICHE_SURNAMES], ['CLICHE_GIVEN', CLICHE_GIVEN], ['CONCRETE_SENSORY', CONCRETE_SENSORY]]) {
  for (const d of dupOf(arr)) problems.push(`${name} 有重复项：${d}`)
}

// 7) 每个维度的条数（应该是 10/10/10/10）
const byDim = {}
for (const s of SPECS) byDim[s.dim] = (byDim[s.dim] ?? 0) + 1
for (const d of DIMENSIONS) {
  if (byDim[d.id] !== 10) problems.push(`维度 ${d.id} 应该是 10 条，实际 ${byDim[d.id]}`)
}

// 8) 用例的 good / bad 都不能是空数组（否则这条雷区根本没被测过）
for (const c of CASES) {
  if (!Array.isArray(c.bad) || c.bad.length === 0) problems.push(`用例 ${c.specId} 没有 bad 样本`)
  if (!Array.isArray(c.good) || c.good.length === 0) problems.push(`用例 ${c.specId} 没有 good 样本`)
}

// 9) 原始编号应当**在维度内**是 1..10（对应用户原表四个小节各自从 1 编号）
for (const d of DIMENSIONS) {
  const nos = SPECS.filter((s) => s.dim === d.id).map((s) => s.no).sort((a, b) => a - b)
  for (let i = 0; i < nos.length; i += 1) {
    if (nos[i] !== i + 1) {
      problems.push(`维度 ${d.id} 的原始编号不连续：位置 ${i + 1} 是 ${nos[i]}`)
      break
    }
  }
}

notes.push(`雷区 ${SPECS.length} 条 / 用例 ${CASES.length} 组 / 维度分布 ${JSON.stringify(byDim)}`)
notes.push(`block 级 ${SPECS.filter((s) => s.severity === 'block').length} 条，warn 级 ${SPECS.filter((s) => s.severity === 'warn').length} 条`)

if (problems.length > 0) {
  console.log('✗ 契约自检未通过：')
  for (const p of problems) console.log(`  - ${p}`)
  process.exit(1)
}
for (const n of notes) console.log(`✓ ${n}`)
console.log('✓ 契约层自检通过')

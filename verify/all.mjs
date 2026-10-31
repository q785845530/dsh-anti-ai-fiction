#!/usr/bin/env node
/**
 * 一键跑全部验证。
 *
 *   node verify/all.mjs
 *
 * ## 为什么要串成一个入口
 *
 * 五个脚本各自有用，但**只有一起跑才有意义**。原因是它们互为盲区：
 *
 *   - `spec-integrity` 只查表长得对不对，不管检测器行不行；
 *   - `cases` 查检测器准不准，但**不查工具层**；
 *   - `false-positive` 查会不会冤枉正常稿子，但用的是自己写的素材；
 *   - `smoke` 查文件形状，不查行为；
 *   - `tools` 查工具端到端，但只用两段样本。
 *
 * 本轮真实事故就是证据：`lib/index.js` 里三处 `runDetect` 漏 `await`，
 * 导致所有工具都返回「审计没跑成：undefined」。当时
 * **cases 全绿、smoke 全绿** —— 两个脚本都没抓到，只有 `tools` 能抓。
 *
 * 反过来，如果只有 `tools`，那么 40 条规则里漏掉 17 条也发现不了。
 * 所以必须五个一起跑，任何一个红就是整体红。
 *
 * 退出码：全过 0；有失败 1。
 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const HERE = path.dirname(fileURLToPath(import.meta.url))

/** 顺序有意义：先查表，再查规则，再查误报，最后查能不能装、能不能用。 */
const SUITES = [
  { file: 'spec-integrity.mjs', title: '契约层自检', why: '40 条雷区表结构对不对' },
  { file: 'cases.mjs', title: '40 组验收用例回放', why: 'AI 味必中、活人写法必放行' },
  { file: 'false-positive.mjs', title: '误报压力测试', why: '正常小说段落不许被冤枉' },
  { file: 'smoke.mjs', title: '装载冒烟测试', why: '插件能不能装进 DSH' },
  { file: '_client.mjs', title: '浏览器半验证', why: '界面面板能不能注册出来' },
  { file: 'tools.mjs', title: '端到端工具验证', why: '四个工具真的能用、拦得住' },
]

const C = {
  ok: (s) => `\x1b[32m${s}\x1b[0m`,
  bad: (s) => `\x1b[31m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
}

const summary = []

for (const suite of SUITES) {
  const full = path.join(HERE, suite.file)
  console.log()
  console.log('═'.repeat(66))
  console.log(`  ${C.bold(suite.title)}  ${C.dim(`（${suite.why}）`)}`)
  console.log('═'.repeat(66))

  const r = spawnSync(process.execPath, [full], { stdio: 'inherit' })
  const code = r.status === null ? 1 : r.status
  summary.push({ ...suite, code, ok: code === 0 })
}

console.log()
console.log('═'.repeat(66))
console.log('  总览')
console.log('═'.repeat(66))
for (const s of summary) {
  const mark = s.ok ? C.ok('✓') : C.bad('✗')
  console.log(`  ${mark} ${s.title.padEnd(20, ' ')} ${C.dim(s.why)}`)
}

const failed = summary.filter((s) => !s.ok)
console.log()
if (failed.length === 0) {
  console.log(C.ok(`  ✓ 全部 ${summary.length} 个套件通过。`))
  console.log(C.dim('  注意：机器质检 ≠ 艺术验收。「不报错」不等于「写得好」。'))
  console.log('═'.repeat(66))
  process.exit(0)
}
console.log(C.bad(`  ✗ ${failed.length} / ${summary.length} 个套件失败：${failed.map((s) => s.title).join('、')}`))
console.log('═'.repeat(66))
process.exit(1)

#!/usr/bin/env node
/**
 * 端到端验证：**真的把工具跑起来**，而不是只测内部函数。
 *
 * ## 为什么需要这一层
 *
 * `cases.mjs` 测的是 `detect()` —— 引擎本身对不对。
 * `smoke.mjs` 测的是「文件形状对不对」—— 能不能装。
 * 但两者都**没有**覆盖「用户真的调用工具时会发生什么」。
 *
 * 这个缺口很致命：本轮就出过一次真实事故 ——
 * `lib/index.js` 里三处 `runDetect(...)` 漏了 `await`，
 * 于是 `d.ok` 恒为 `undefined`，所有工具都返回「审计没跑成：undefined」。
 * 而 `cases.mjs` 全绿、`smoke.mjs` 全绿 —— **两个脚本都没抓到**。
 *
 * 所以这一层必须存在：用 mock 的 Cordis ctx 跑一遍 `apply()`，
 * 然后真的 `execute()` 每个工具，检查返回体。
 *
 * ## 判据
 *
 * 不看「有没有报错」，看**行为对不对**：
 *   - AI 味稿 → `deai_audit` 必须给出「打回」裁决
 *   - AI 味稿 → `deai_guard` 必须 `ok: false`（真拦）
 *   - 干净稿 → `deai_guard` 必须 `ok: true`（不冤枉）
 *   - `deai_polish` 在 strict 下必须**拒绝润色**
 *   - 每条命中的 evidence 必须能在原文里找到
 *
 * @module dsh-anti-ai-fiction/verify/tools
 */
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const INDEX = path.join(ROOT, 'lib', 'index.js')

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
}
function line(s = '') { console.log(s) }
const C = {
  ok: (s) => `\x1b[32m${s}\x1b[0m`,
  bad: (s) => `\x1b[31m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
}

/** 用最小 mock 跑 apply()，收集注册的工具。 */
async function boot() {
  const registered = []
  const routes = []
  const mockCtx = {
    logger: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
    inject: (deps, fn) => {
      if (deps.includes('tools')) fn({ tools: { register: (t) => registered.push(t) } })
      if (deps.includes('webServer')) {
        fn({ effect: (f) => f(), webServer: { register: (r) => { routes.push(r); return () => {} } } })
      }
    },
    effect: (f) => f(),
    agent: { session: { header: { cwd: ROOT } } },
  }
  const mod = await import(`${pathToUrl(INDEX)}`)
  mod.apply(mockCtx, {})
  // 等 loadEngine 的异步导入落定
  await new Promise((r) => setTimeout(r, 400))
  return { registered, routes, mod }
}

function pathToUrl(p) {
  const abs = path.resolve(p)
  return `file://${abs.split(path.sep).map(encodeURIComponent).join('/')}`
}

/** 一段明确的 AI 味稿。 */
const AI_TEXT = [
  '清晨，阳光明媚，微风拂过树叶，鸟儿在枝头欢唱。',
  '',
  '远处的山峦层林尽染，云雾缭绕，宛如一幅泼墨山水画，令人心旷神怡。',
  '',
  '"你好，我叫林风，今年十八岁，是个孤儿，从小被师傅收养。我的梦想是成为一个伟大的修仙者。"',
  '',
  '"难道你觉得你还能赢吗？你以为你真的是天命之子吗？"',
  '',
  '他掏出一颗回气丹，吞了下去，法力瞬间恢复了三成。',
].join('\n')

/** 一段正常的小说段落（有身体反应、有潜台词、有质感）。 */
const CLEAN_TEXT = [
  '宿醉后的阳光跟刀子一样扎眼。他抓起枕头砸向窗户，玻璃裂了道缝，风灌进来，带着楼下早点摊的油烟味。',
  '',
  '他摸出半包烟，只剩一根，还是弯的。点着，抽了一口，喉咙发苦。',
  '',
  '"林风。"他耸了耸肩，"没爹没娘，师傅捡回来的。至于以后干嘛……能吃上饱饭再说吧。"',
  '',
  '她把一份名单推过来。他低头看，自己的名字被红笔圈着。',
  '"您这是……"他试探着问。',
  '"我不喜欢自己开口。"她喝了一口茶。',
].join('\n')

async function main() {
  line('═'.repeat(66))
  line('  端到端工具验证（真的 execute 每个工具）')
  line('═'.repeat(66))

  if (!fs.existsSync(INDEX)) {
    check('lib/index.js 存在', false, INDEX)
    return finish()
  }

  let booted
  try {
    booted = await boot()
  } catch (e) {
    check('apply() 能跑起来', false, e?.message ?? String(e))
    return finish()
  }
  check('apply() 能跑起来', true, '')

  const { registered } = booted
  const names = registered.map((t) => t.name)
  check('注册了 4 个工具', names.length === 4, names.join(', '))

  const tool = (n) => registered.find((t) => t.name === n)
  for (const n of ['deai_audit', 'deai_polish', 'deai_guard', 'deai_rules']) {
    check(`工具 ${n} 存在`, typeof tool(n)?.execute === 'function', '')
  }

  // ——— 1. deai_audit 对 AI 味稿：必须给出「打回」 ———
  line()
  line(C.dim('── deai_audit（AI 味稿） ──'))
  try {
    const r = await tool('deai_audit').execute({ text: AI_TEXT })
    const msg = String(r?.message ?? '')
    check('audit 返回 ok:true（报告生成成功）', r?.ok === true, `ok=${r?.ok}`)
    check('audit 报告里出现「打回重写」', msg.includes('打回重写'), msg.slice(0, 80))
    check('audit 报告带原文证据', msg.includes('阳光明媚') || msg.includes('层林尽染'), '')
    check('audit 报告带定位', /第 \d+ 段/.test(msg), '')
    // 关键回归：不能出现「undefined」这种被吞掉的错误
    check('audit 没有吞掉错误（无 undefined）', !msg.includes('审计没跑成：undefined'), msg.slice(0, 80))
    line(`  ${C.ok('✓')} 报告 ${msg.length} 字，判定正确`)
  } catch (e) {
    check('deai_audit 不抛异常', false, e?.message ?? String(e))
  }

  // ——— 2. deai_guard 对 AI 味稿：必须真拦 ———
  line()
  line(C.dim('── deai_guard（AI 味稿，应打回） ──'))
  try {
    const r = await tool('deai_guard').execute({ text: AI_TEXT })
    check('guard 对 AI 味稿 ok:false（真拦截）', r?.ok === false, `ok=${r?.ok}`)
    const msg = String(r?.message ?? '')
    check('guard 说明打回原因', msg.includes('打回') || msg.includes('不合规'), msg.slice(0, 80))
    check('guard 附了可粘贴的强制指令', msg.includes('强制指令') || msg.includes('去 AI 味'), '')
    check('guard 没有吞掉错误（无 undefined）', !msg.includes('门禁没跑成：undefined'), msg.slice(0, 80))
    line(`  ${C.ok('✓')} 正确打回`)
  } catch (e) {
    check('deai_guard 不抛异常（AI 味稿）', false, e?.message ?? String(e))
  }

  // ——— 3. deai_guard 对干净稿：必须放行 ———
  line()
  line(C.dim('── deai_guard（干净稿，应放行） ──'))
  try {
    const r = await tool('deai_guard').execute({ text: CLEAN_TEXT })
    check('guard 对干净稿 ok:true（不冤枉）', r?.ok === true, `ok=${r?.ok} ${String(r?.message ?? '').slice(0, 120)}`)
    line(`  ${C.ok('✓')} 正确放行`)
  } catch (e) {
    check('deai_guard 不抛异常（干净稿）', false, e?.message ?? String(e))
  }

  // ——— 4. deai_polish strict 下必须拒绝润色 ———
  line()
  line(C.dim('── deai_polish（AI 味稿，strict） ──'))
  try {
    const r = await tool('deai_polish').execute({ text: AI_TEXT, strict: true })
    const msg = String(r?.message ?? '')
    check('polish 在 strict 下拒绝润色（ok:false）', r?.ok === false, `ok=${r?.ok}`)
    check('polish 给出逐条病理', msg.includes('病理') || msg.includes('原文'), msg.slice(0, 100))
    check('polish 给出活人味示范', msg.includes('示范') || msg.includes('改成什么样'), '')
    line(`  ${C.ok('✓')} 拒绝润色并给出病理 + 示范`)
  } catch (e) {
    check('deai_polish 不抛异常', false, e?.message ?? String(e))
  }

  // ——— 5. deai_rules 列全 40 条 ———
  line()
  line(C.dim('── deai_rules ──'))
  try {
    const r = await tool('deai_rules').execute({})
    const msg = String(r?.message ?? '')
    check('rules 返回 ok:true', r?.ok === true, `ok=${r?.ok}`)
    check('rules 覆盖四个维度', ['名字', '事物', '对话', '景色'].every((d) => msg.includes(d)), '')
    check('rules 提到打回阈值', msg.includes('3') && (msg.includes('阈值') || msg.includes('打回')), '')
    check('rules 列出放行条件', msg.includes('放行'), '')
    line(`  ${C.ok('✓')} 规则清单 ${msg.length} 字`)
  } catch (e) {
    check('deai_rules 不抛异常', false, e?.message ?? String(e))
  }

  // ——— 6. 空文本 / 异常输入不该崩 ———
  line()
  line(C.dim('── 异常输入 ──'))
  for (const [label, args] of [
    ['空 text', { text: '' }],
    ['只有空格', { text: '   ' }],
    ['超长文本（5 万字）', { text: '他推开门，屋里有股霉味。'.repeat(2000) }],
  ]) {
    try {
      const r = await tool('deai_guard').execute(args)
      check(`异常输入「${label}」不抛异常`, typeof r?.ok === 'boolean', `ok=${r?.ok}`)
    } catch (e) {
      check(`异常输入「${label}」不抛异常`, false, e?.message ?? String(e))
    }
  }

  return finish()
}

function finish() {
  line()
  line('─'.repeat(66))
  const failed = results.filter((r) => !r.ok)
  for (const r of results) {
    if (!r.ok) line(`  ${C.bad('✗')} ${r.name}${r.detail ? C.dim(`  ${r.detail}`) : ''}`)
  }
  if (failed.length === 0) {
    line(C.ok(`  ✓ 全部 ${results.length} 项通过：四个工具端到端可用，拦截与放行行为正确。`))
    line('═'.repeat(66))
    process.exit(0)
  }
  line(C.bad(`  ✗ ${failed.length} / ${results.length} 项失败`))
  line('═'.repeat(66))
  process.exit(1)
}

main().catch((e) => {
  console.error('端到端验证脚本自身出错：', e)
  process.exit(2)
})

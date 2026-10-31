#!/usr/bin/env node
/**
 * 浏览器半（lib/client.js）验证。
 *
 * client.js 用的是 `window.__ModuleLoader__.load({...})`，**不能在 Node 里直接
 * import** —— 一 import 就报 `window is not defined`。所以 smoke.mjs 只能
 * 检查「文件在不在」「有没有 __ModuleLoader__ 字样」，查不到它到底能不能用。
 *
 * 这个脚本补上那个缺口：在 Node 里伪造出 ModuleLoader / window / document /
 * localStorage，真的把 factory 跑起来，然后：
 *   1. 确认注册的插件 id 对；
 *   2. 确认 `apply(ctx)` 能跑，并且往 `settings.section` 里注册了一个面板；
 *   3. 确认 label 是给人看的中文名。
 *
 * 这三件事任何一件坏了，界面就出不来 —— 而那是用户唯一能看到的部分。
 *
 * 退出码：全过 0，有失败 1。
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CLIENT = path.resolve(HERE, '..', 'lib', 'client.js')

const results = []
const check = (name, ok, detail = '') => results.push({ name, ok, detail })
const C = { ok: (s) => `\x1b[32m${s}\x1b[0m`, bad: (s) => `\x1b[31m${s}\x1b[0m`, dim: (s) => `\x1b[2m${s}\x1b[0m` }

// ——— 伪造浏览器环境 ———
const loaded = []
let plugin = null

globalThis.window = {
  __ModuleLoader__: {
    load: ({ id, factory }) => {
      loaded.push(id)
      const fakeRequire = (m) => {
        if (m === 'react') {
          return {
            createElement: () => null,
            useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
            useEffect: () => {},
            useCallback: (f) => f,
            useMemo: (f) => f(),
          }
        }
        throw new Error(`unexpected require: ${m}`)
      }
      plugin = factory(fakeRequire)
    },
  },
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
}
globalThis.document = {
  createElement: () => ({ setAttribute() {}, style: {}, appendChild() {}, removeChild() {}, select() {} }),
  head: { appendChild() {} },
  body: { appendChild() {}, removeChild() {} },
}
// Node 22 里 navigator 是只读全局（有 getter 没 setter），直接赋值会抛。
// 用 defineProperty 覆盖 —— 这个脚本只是为了跑通 client.js，不是要模拟浏览器。
try {
  Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true, writable: true })
} catch { /* 拿不到就算了，client.js 有 navigator?. 的容错 */ }

async function main() {
  try {
    await import(`file://${CLIENT.split(path.sep).map(encodeURIComponent).join('/')}`)
  } catch (e) {
    check('client.js 能被 ModuleLoader 解析', false, e?.message ?? String(e))
    return finish()
  }
  check('client.js 能被 ModuleLoader 解析', true, '')
  check('注册的插件 id 正确', loaded.includes('dsh-anti-ai-fiction'), loaded.join(', '))
  check('factory 返回 name', plugin?.name === 'dsh-anti-ai-fiction', String(plugin?.name))
  check('factory 声明 inject slots', Array.isArray(plugin?.inject) && plugin.inject.includes('slots'), JSON.stringify(plugin?.inject))
  check('apply 是函数', typeof plugin?.apply === 'function', typeof plugin?.apply)

  // 跑 apply(ctx)
  const slots = []
  const effects = []
  const mockCtx = {
    effect: (f) => { effects.push(f); return f() },
    slots: {
      inject: (name, fn) => fn(),
      register: (s) => { slots.push(s); return () => {} },
    },
  }
  try {
    plugin.apply(mockCtx)
  } catch (e) {
    check('apply(ctx) 能跑起来', false, e?.message ?? String(e))
    return finish()
  }
  check('apply(ctx) 能跑起来', true, '')
  check('注册了 styles effect', effects.length > 0, `${effects.length} 个 effect`)

  const sec = slots.find((s) => s.name === 'settings.section')
  check('注册了 settings.section', sec !== undefined, slots.map((s) => `${s.name}:${s.id}`).join(', '))
  check('面板 id 正确', sec?.id === 'anti-ai-fiction', String(sec?.id))
  let label = ''
  try { label = typeof sec?.label === 'function' ? sec.label() : String(sec?.label ?? '') } catch { label = '' }
  check('面板 label 是中文名', label.length > 0 && /[\u4e00-\u9fff]/.test(label), label)

  return finish()
}

function finish() {
  console.log('═'.repeat(60))
  console.log('  浏览器半验证（伪造 ModuleLoader 环境）')
  console.log('═'.repeat(60))
  const failed = results.filter((r) => !r.ok)
  for (const r of results) {
    if (r.ok) console.log(`  ${C.ok('✓')} ${r.name}${r.detail ? C.dim(`  ${r.detail}`) : ''}`)
    else console.log(`  ${C.bad('✗')} ${r.name}${r.detail ? C.dim(`  ${r.detail}`) : ''}`)
  }
  console.log()
  if (failed.length === 0) {
    console.log(C.ok(`  ✓ 全部 ${results.length} 项通过：界面面板能注册、能出标签。`))
    console.log('═'.repeat(60))
    process.exit(0)
  }
  console.log(C.bad(`  ✗ ${failed.length} / ${results.length} 项失败`))
  console.log('═'.repeat(60))
  process.exit(1)
}

main().catch((e) => {
  console.error('浏览器半验证脚本自身出错：', e)
  process.exit(2)
})

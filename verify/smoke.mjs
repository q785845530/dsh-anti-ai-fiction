/**
 * verify/smoke.mjs —— 装载冒烟测试。
 *
 * 检测器再准，插件装不上、工具没注册、浏览器半在 Node 里崩了，
 * 用户一样是「用不了」。这一层跟内容质量无关，但它是前置条件。
 *
 * 检查项：
 *   1. package.json —— name / type / main / exports / engines / dsh.bundle.patch
 *   2. cordis.patch.yml —— 存在且格式对
 *   3. lib/index.js —— 能 import（**不调用 apply()**）
 *   4. 工具注册 —— lib/index.js 里 `name: 'deai...'` 之类的工具名，数量 ≥ 3
 *   5. lib/client.js —— 文件存在 + 正则确认含 `__ModuleLoader__.load`
 *      （浏览器半用了 `window`，在 Node 里 import 会失败，**所以不真 import**）
 *
 * 退出码：全过 → 0；有失败项 → 1；缺关键文件 → 2。
 *
 * 用法：node verify/smoke.mjs
 */

import fs from 'node:fs'
import path from 'node:path'
import {
  ROOT,
  INDEX_PATH,
  CLIENT_PATH,
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
} from './_harness.mjs'

const checks = []
/**
 * @param {string} name
 * @param {boolean} ok
 * @param {string} detail
 * @param {'critical'|'normal'} [level]
 */
function check(name, ok, detail = '', level = 'normal') {
  checks.push({ name, ok, detail, level })
  return ok
}

/* ————————————————————— 1. package.json ————————————————————— */

heading('1. package.json')

const pkgPath = path.join(ROOT, 'package.json')
let pkg = null

if (!fs.existsSync(pkgPath)) {
  check('package.json 存在', false, `找不到 ${pkgPath}`, 'critical')
  item('fail', 'package.json 不存在 —— 插件无法安装。')
} else {
  check('package.json 存在', true, pkgPath)
  item('ok', `package.json 存在`)

  let raw
  try {
    raw = fs.readFileSync(pkgPath, 'utf8')
    pkg = JSON.parse(raw)
    check('package.json 是合法 JSON', true, '')
    item('ok', '是合法 JSON')
  } catch (err) {
    check('package.json 是合法 JSON', false, err?.message ?? String(err), 'critical')
    item('fail', `JSON 解析失败：${err?.message ?? err}`)
    pkg = null
  }
}

if (pkg) {
  // name
  const nameOk = typeof pkg.name === 'string' && /^[a-z0-9][\w.-]*$/i.test(pkg.name)
  check('name 合法', nameOk, String(pkg.name))
  item(nameOk ? 'ok' : 'fail', `name = ${JSON.stringify(pkg.name)}${nameOk ? '' : ' —— 缺失或不合 npm 命名规范'}`)

  // version
  const verOk = typeof pkg.version === 'string' && /^\d+\.\d+\.\d+/.test(pkg.version)
  check('version 存在且为 semver', verOk, String(pkg.version))
  item(verOk ? 'ok' : 'fail', `version = ${JSON.stringify(pkg.version)}`)

  // type
  const typeOk = pkg.type === 'module'
  check("type === 'module'", typeOk, String(pkg.type))
  item(typeOk ? 'ok' : 'fail', `type = ${JSON.stringify(pkg.type)} —— ESM 插件应为 'module'`)

  // main
  const mainOk = typeof pkg.main === 'string' && fs.existsSync(path.join(ROOT, pkg.main))
  check('main 存在且文件可解析', mainOk, String(pkg.main))
  item(mainOk ? 'ok' : 'fail', `main = ${JSON.stringify(pkg.main)}${mainOk ? '' : ' —— 文件不存在'}`)

  // exports
  const hasExports = pkg.exports !== undefined
  let exportsOk = false
  let exportsDetail = String(pkg.exports)
  if (hasExports) {
    if (typeof pkg.exports === 'string') {
      exportsOk = fs.existsSync(path.join(ROOT, pkg.exports))
    } else if (typeof pkg.exports === 'object' && pkg.exports !== null) {
      const keys = Object.keys(pkg.exports)
      exportsOk = keys.length > 0
      exportsDetail = keys.map((k) => `${k} → ${JSON.stringify(pkg.exports[k])}`).join('; ')
      // 每个值都得能解析到实际文件（.js / .mjs / 目录 / 包名除外）
      const unresolvable = keys.filter((k) => {
        const v = pkg.exports[k]
        if (typeof v === 'string') return !v.includes('*') && !fs.existsSync(path.join(ROOT, v))
        if (v && typeof v === 'object') {
          const s = v.import ?? v.default
          return typeof s === 'string' && !s.includes('*') && !fs.existsSync(path.join(ROOT, s))
        }
        return false
      })
      if (unresolvable.length) {
        exportsOk = false
        exportsDetail += ` —— 未解析到文件：${unresolvable.join(', ')}`
      }
    }
  }
  check('exports 存在且可解析', exportsOk, exportsDetail)
  item(exportsOk ? 'ok' : 'fail', `exports = ${exportsDetail}`)

  // engines
  const engOk = pkg.engines && typeof pkg.engines === 'object' && Object.keys(pkg.engines).length > 0
  check('engines 存在', engOk, JSON.stringify(pkg.engines))
  item(engOk ? 'ok' : 'fail', `engines = ${JSON.stringify(pkg.engines)}`)

  // dsh.bundle.patch
  const dshOk = !!(pkg.dsh && typeof pkg.dsh === 'object' && pkg.dsh.bundle && typeof pkg.dsh.bundle.patch === 'string' && pkg.dsh.bundle.patch.trim())
  check('dsh.bundle.patch 存在', dshOk, JSON.stringify(pkg.dsh))
  item(dshOk ? 'ok' : 'fail', `dsh.bundle.patch = ${JSON.stringify(pkg.dsh?.bundle?.patch)}`)

  // cordis.patch.yml 引用一致性（如果 dsh.bundle.patch 指向了它）
  const patchRef = pkg.dsh?.bundle?.patch
  if (typeof patchRef === 'string' && patchRef.trim()) {
    const refPath = path.isAbsolute(patchRef) ? patchRef : path.join(ROOT, patchRef)
    const refOk = fs.existsSync(refPath)
    check('dsh.bundle.patch 指向的文件存在', refOk, patchRef)
    item(refOk ? 'ok' : 'fail', `dsh.bundle.patch 指向 ${patchRef}${refOk ? '' : ' —— 文件不存在'}`)
  }
}

/* ————————————————————— 2. cordis.patch.yml ————————————————————— */

heading('2. cordis.patch.yml')

const patchPath = path.join(ROOT, 'cordis.patch.yml')
if (!fs.existsSync(patchPath)) {
  check('cordis.patch.yml 存在', false, patchPath, 'critical')
  item('fail', 'cordis.patch.yml 不存在 —— 插件无法注入 DSH 运行时。')
} else {
  check('cordis.patch.yml 存在', true, patchPath)
  item('ok', 'cordis.patch.yml 存在')

  const yaml = fs.readFileSync(patchPath, 'utf8')
  const lines = yaml.split(/\r?\n/)
  const nonEmpty = lines.filter((l) => l.trim() && !l.trim().startsWith('#'))

  // 基本 YAML 形态检查：不能是空文件、不能有 tab 缩进（YAML 不允许 tab 缩进）
  const hasTabIndent = /^\t+/m.test(yaml)
  // 顶层结构有两种合法形态：
  //   1. 映射：`key: value`          （顶层键）
  //   2. 列表：`- insert:` / `- id:` （cordis patch 的真实形态）
  // 第一版只认第 1 种，把 `- insert:` 判成「无顶层键」而报 FAIL ——
  // 但本机 writing-slots 的 patch 就是这个形状，是判据写窄了，不是文件错。
  const hasTopKey = /^[\w.-]+\s*:/m.test(yaml) || /^-\s+[\w.-]+\s*:/m.test(yaml)
  const ok = nonEmpty.length > 0 && !hasTabIndent && hasTopKey
  check('cordis.patch.yml 格式合法', ok, `${nonEmpty.length} 个有效行`)
  item(ok ? 'ok' : 'fail', ok
    ? `格式基本合法（${nonEmpty.length} 个有效行，顶层结构：${/^-\s+/m.test(yaml) ? '列表' : '映射'}）`
    : `格式可疑：${nonEmpty.length === 0 ? '空文件' : ''}${hasTabIndent ? ' 含 tab 缩进' : ''}${!hasTopKey ? ' 无顶层键' : ''}`)
}

/* ————————————————————— 3. lib/index.js 可 import ————————————————————— */

heading('3. 插件主入口 lib/index.js')

if (!fs.existsSync(INDEX_PATH)) {
  check('lib/index.js 存在', false, INDEX_PATH, 'critical')
  item('fail', 'lib/index.js 不存在 —— 插件没有主入口。')
} else {
  check('lib/index.js 存在', true, INDEX_PATH)
  item('ok', 'lib/index.js 存在')

  const src = fs.readFileSync(INDEX_PATH, 'utf8')

  // 导出检查
  const hasDefaultExport = /export\s+default/.test(src)
  const hasNamedExport = /export\s+(const|function|class|async\s+function)\s+\w+/.test(src)
  const exportOk = hasDefaultExport || hasNamedExport
  check('有 export 声明', exportOk, `default=${hasDefaultExport} named=${hasNamedExport}`)
  item(exportOk ? 'ok' : 'fail', exportOk
    ? `有 export（default=${hasDefaultExport ? '有' : '无'}，具名=${hasNamedExport ? '有' : '无'}）`
    : '没有任何 export —— 这个文件不能被加载')

  // import 检查（不调用 apply）
  let imported = null
  let importErr = null
  try {
    const url = new URL(`file://${INDEX_PATH.split(path.sep).map(encodeURIComponent).join('/')}`).href
    imported = await import(url)
    check('lib/index.js 可 import', true, '')
    item('ok', '可 import（未调用 apply()）')
  } catch (err) {
    importErr = err
    check('lib/index.js 可 import', false, err?.message ?? String(err), 'critical')
    item('fail', `import 失败：${err?.message ?? err}`)
  }

  // 导出形状
  if (imported) {
    const keys = Object.keys(imported)
    const shapeOk = keys.length > 0
    check('导出非空', shapeOk, keys.join(', '))
    item(shapeOk ? 'ok' : 'fail', `导出：${keys.join(', ') || '（空）'}`)

    // 插件工厂的合法形态。
    //
    // 本机 DSH 用的是 **Cordis 风格**：`export function apply(ctx, config)` +
    // `export const name = '...'`，**没有** default / plugin 导出。
    // 本机 writing-slots / toutiao-studio / novel-console 全是这个形状，
    // 而且都能正常装载。
    //
    // 第一版只认 default / plugin，会把所有本机插件都判成「DSH 装载不了」——
    // 那是拿别的框架的约定来量本机运行时，判据本身就是错的。
    const hasPlugin =
      typeof imported.apply === 'function' ||
      typeof imported.default === 'function' ||
      typeof imported.plugin === 'function'
    const shapeName = typeof imported.apply === 'function' ? 'apply(ctx, config)'
      : typeof imported.default === 'function' ? 'default'
        : typeof imported.plugin === 'function' ? 'plugin' : ''
    check('导出里有可调用的插件对象', hasPlugin, shapeName)
    item(hasPlugin ? 'ok' : 'fail', hasPlugin
      ? `有可调用的插件工厂：${shapeName}`
      : '没有可调用的插件工厂（apply / default / plugin 都不是函数）—— DSH 装载不了')
    if (hasPlugin && typeof imported.name !== 'string') {
      check('导出 name 是字符串', false, typeof imported.name, 'warn')
      item('warn', '没有导出 name 字符串 —— Cordis 插件通常需要它来标识自己')
    }
  }
}

/* ————————————————————— 4. 工具注册 ————————————————————— */

heading('4. 工具注册')

if (!fs.existsSync(INDEX_PATH)) {
  check('工具注册检查', false, 'lib/index.js 不存在', 'critical')
  item('fail', 'lib/index.js 不存在，无法检查工具注册。')
} else {
  const src = fs.readFileSync(INDEX_PATH, 'utf8')

  // 工具名通常形如 name: 'deai_check' / name: "deai-..." / name: `deai...`
  const toolNameRe = /name\s*:\s*['"`]([A-Za-z_][\w.-]*)['"`]/g
  const names = []
  let m
  while ((m = toolNameRe.exec(src)) !== null) names.push(m[1])

  // 只看像工具名的（deai / anti-ai / fiction / scan / check / polish 之类）
  const toolish = names.filter((n) => /deai|anti|ai|scan|check|polish|fiction|novel|smell|lint/i.test(n))

  const dedup = [...new Set(toolish)]
  const enough = dedup.length >= 3
  check('注册工具数 ≥ 3', enough, `找到 ${dedup.length}: ${dedup.join(', ') || '（无）'}`)
  item(enough ? 'ok' : 'fail', `工具名（deai/ai/scan/check 类）：${dedup.length} 个${dedup.length ? ` —— ${dedup.join(', ')}` : ''}`)

  if (dedup.length) {
    for (const n of dedup) item('info', `  ${n}`)
  }

  // 所有 name: 字段都列出来（不筛选），方便人工核对
  const allNames = [...new Set(names)]
  if (allNames.length) {
    line()
    line(paint('dim', '文件里全部 name: 字段（未筛选）：'))
    line(paint('gray', `  ${allNames.join(', ')}`))
  }

  // 工具注册 API。
  //
  // 清单要覆盖**本机 DSH 真实用的那一种**：`agentCtx.tools.register(defineTool(...))`。
  // 第一版的清单里只有 server.tool / registerTool 这些通用写法，
  // 结果对本机插件全都不匹配，误报「没识别到工具注册 API」。
  // 判据应该以真实运行时的 API 为准，而不是以「别的框架怎么叫」为准。
  const apiHits = []
  for (const api of [
    'tools.register',        // 本机 DSH：agentCtx.tools.register(...)
    'ctx.tools.register',
    'defineTool',            // @deepseek-ai/dsh-tools 的定义函数
    'server.tool', 'ctx.tool', 'plugin.tool', 'registerTool', 'addTool', 'tool(',
  ]) {
    if (src.includes(api)) apiHits.push(api)
  }
  check('识别到工具注册 API', apiHits.length > 0, apiHits.join(', '))
  item(apiHits.length ? 'ok' : 'fail', apiHits.length
    ? `识别到注册 API：${apiHits.join(', ')}`
    : '没识别到常见工具注册 API —— 工具可能没真的注册上')
}

/* ————————————————————— 5. lib/client.js ————————————————————— */

heading('5. 浏览器半 lib/client.js')

if (!fs.existsSync(CLIENT_PATH)) {
  check('lib/client.js 存在', false, CLIENT_PATH, 'critical')
  item('fail', 'lib/client.js 不存在 —— 设置页工作台没东西。')
} else {
  check('lib/client.js 存在', true, CLIENT_PATH)
  item('ok', 'lib/client.js 存在')

  const csrc = fs.readFileSync(CLIENT_PATH, 'utf8')

  // 关键：浏览器半用了 window，在 Node 里 import 会失败 —— 所以只做正则检查
  const hasLoader = /__ModuleLoader__\s*\.\s*load/.test(csrc)
  check('含 __ModuleLoader__.load', hasLoader, '')
  item(hasLoader ? 'ok' : 'fail', hasLoader
    ? '确认含 __ModuleLoader__.load（按要求未在 Node 里 import）'
    : '没找到 __ModuleLoader__.load —— 浏览器半没法加载模块')

  // 浏览器专用 API 的存在性（只提示，不判死）
  const browserApis = []
  if (/\bwindow\b/.test(csrc)) browserApis.push('window')
  if (/\bdocument\b/.test(csrc)) browserApis.push('document')
  if (browserApis.length) {
    item('info', `用到浏览器专用 API：${browserApis.join(', ')} —— 这就是不能在 Node 里 import 的原因`)
  }

  // 粗略看有没有 HTML 入口标记
  const hasHtml = /<script|<div|<template|innerHTML/.test(csrc)
  if (hasHtml) item('info', '含 HTML 片段')
}

/* ————————————————————— 汇总 ————————————————————— */

heading('汇总')

const rows = checks.map((c) => [
  c.ok ? mark(true) : mark(false),
  c.name,
  c.level === 'critical' && !c.ok ? paint('red', '关键') : '',
  oneLine(c.detail, 50),
])
for (const r of table(['', '检查项', '', '详情'], rows)) line(r)

const failed = checks.filter((c) => !c.ok)
const criticalFailed = failed.filter((c) => c.level === 'critical')

line()
item(failed.length ? 'fail' : 'ok', `通过 ${checks.length - failed.length} / ${checks.length} 项`)

heading('结论')
if (criticalFailed.length) {
  item('fail', `${criticalFailed.length} 项关键检查失败 —— 插件装不上或加载不了。`)
  finish(1)
} else if (failed.length) {
  item('fail', `${failed.length} 项检查失败。`)
  finish(1)
} else {
  item('ok', '冒烟测试全过：插件能装、能载、工具已注册。')
  finish(0)
}

line()
rule()

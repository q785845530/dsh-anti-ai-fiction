/**
 * verify/_harness.mjs —— 验证脚本共用的底座。
 *
 * 设计原则：
 *   1. **零外部依赖**：只用 Node 内置模块（node:fs / node:path / node:url / node:process）。
 *   2. **优雅降级**：插件代码此刻可能还没交付。检测器缺席时，
 *      脚本要报「依赖未就绪」并正常退出，而不是甩一堆栈。
 *   3. **给人看的输出**：TTY 下用 ANSI 上色，非 TTY（管道 / CI）下退化成
 *      `[OK] / [FAIL] / [WARN]` 文本标记 —— 两种情况下都读得懂。
 *
 * @module verify/_harness
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/* ————————————————————— 路径 ————————————————————— */

const HERE = path.dirname(fileURLToPath(import.meta.url))

/** 插件根目录（本文件在 <root>/verify/ 下）。 */
export const ROOT = path.resolve(HERE, '..')

/** 契约层路径。 */
export const SPEC_PATH = path.join(ROOT, 'lib', 'spec.js')

/** 检测器入口路径。 */
export const DETECT_PATH = path.join(ROOT, 'lib', 'detect.js')

/** 插件主入口路径。 */
export const INDEX_PATH = path.join(ROOT, 'lib', 'index.js')

/** 浏览器半路径。 */
export const CLIENT_PATH = path.join(ROOT, 'lib', 'client.js')

/** 样本目录。 */
export const FIXTURES_DIR = path.join(ROOT, 'test', 'fixtures')

/* ————————————————————— 颜色 ————————————————————— */

const useColor = process.stdout.isTTY === true && process.env.NO_COLOR === undefined

const C = {
  reset: '[0m',
  bold: '[1m',
  dim: '[2m',
  red: '[31m',
  green: '[32m',
  yellow: '[33m',
  blue: '[34m',
  magenta: '[35m',
  cyan: '[36m',
  gray: '[90m',
}

/** 给字符串上色（非 TTY 下原样返回）。 */
export function paint(color, text) {
  if (!useColor) return text
  return `${C[color] ?? ''}${text}${C.reset}`
}

/** 状态标记：TTY 下是符号，非 TTY 下是 [符号]。 */
export function mark(ok) {
  if (useColor) return ok ? paint('green', '✓') : paint('red', '✗')
  return ok ? '[OK]' : '[FAIL]'
}

/** 警告标记。 */
export function warnMark() {
  return useColor ? paint('yellow', '⚠') : '[WARN]'
}

/** 提示标记（信息类）。 */
export function infoMark() {
  return useColor ? paint('cyan', '•') : '[INFO]'
}

/** 跳过 / 未就绪标记。 */
export function skipMark() {
  return useColor ? paint('gray', '⊘') : '[SKIP]'
}

/* ————————————————————— 输出 ————————————————————— */

const BULLET = useColor ? '•' : '-'

/**
 * 打印一行。默认写到 stdout。
 * @param {string} line
 */
export function line(lineText = '') {
  process.stdout.write(`${lineText}\n`)
}

/**
 * 打印一条「带标记的条目」。
 * @param {'ok'|'fail'|'warn'|'info'|'skip'} kind
 * @param {string} text
 */
export function item(kind, text) {
  const m = {
    ok: () => mark(true),
    fail: () => mark(false),
    warn: () => warnMark(),
    info: () => infoMark(),
    skip: () => skipMark(),
  }[kind] ?? infoMark
  line(`${m()} ${text}`)
}

/** 段落标题。 */
export function heading(title) {
  line()
  line(paint('bold', paint('cyan', `── ${title} ${'─'.repeat(Math.max(0, 56 - title.length))}`)))
}

/** 分隔线。 */
export function rule(char = '─', n = 64) {
  line(paint('gray', char.repeat(n)))
}

/* ————————————————————— 依赖装载 ————————————————————— */

/**
 * 「依赖未就绪」的统一报告形状。
 *
 * @typedef {object} LoadFailure
 * @property {string} what     缺什么
 * @property {string} where    在哪找
 * @property {string} reason   为什么
 */

/**
 * 尝试装载契约层。
 * @returns {Promise<{ ok: true, spec: any } | { ok: false, failure: LoadFailure }>}
 */
export async function loadSpec() {
  if (!fs.existsSync(SPEC_PATH)) {
    return {
      ok: false,
      failure: {
        what: '契约层 lib/spec.js',
        where: SPEC_PATH,
        reason: '文件不存在 —— 40 条雷区定义与 40 组验收用例都住在这里，缺了它整个验证没有基准。',
      },
    }
  }
  try {
    const spec = await import(pathToUrl(SPEC_PATH))
    if (!spec || !Array.isArray(spec.SPECS) || !Array.isArray(spec.CASES)) {
      return {
        ok: false,
        failure: {
          what: '契约层 lib/spec.js',
          where: SPEC_PATH,
          reason: '能 import，但没有导出 SPECS / CASES 数组 —— 导出形状不符合契约。',
        },
      }
    }
    return { ok: true, spec }
  } catch (err) {
    return {
      ok: false,
      failure: {
        what: '契约层 lib/spec.js',
        where: SPEC_PATH,
        reason: `import 失败：${err && err.message ? err.message : String(err)}`,
      },
    }
  }
}

/**
 * 尝试装载检测器。
 *
 * 检测器可能还没交付、可能签名不同、可能抛错 —— 三种情况都要变成
 * 一句人话，而不是一个栈。
 *
 * @returns {Promise<{ ok: true, detect: Function, meta: any } | { ok: false, failure: LoadFailure }>}
 */
export async function loadDetect() {
  if (!fs.existsSync(DETECT_PATH)) {
    return {
      ok: false,
      failure: {
        what: '检测器 lib/detect.js',
        where: DETECT_PATH,
        reason: '文件不存在 —— 检测引擎还没交付，验收用例无法回放。',
      },
    }
  }
  let mod
  try {
    mod = await import(pathToUrl(DETECT_PATH))
  } catch (err) {
    return {
      ok: false,
      failure: {
        what: '检测器 lib/detect.js',
        where: DETECT_PATH,
        reason: `import 失败：${err && err.message ? err.message : String(err)}`,
      },
    }
  }
  const detect = mod.detect ?? mod.default?.detect ?? mod.default
  if (typeof detect !== 'function') {
    return {
      ok: false,
      failure: {
        what: '检测器 lib/detect.js',
        where: DETECT_PATH,
        reason: `能 import，但没有可用的 detect(text, options) 函数（导出的是：${Object.keys(mod).join(', ') || '（空）'}）。`,
      },
    }
  }
  return { ok: true, detect, meta: mod }
}

/**
 * 调用检测器并规整结果形状。
 *
 * 检测器返回的 `hits` 必须能拿到 specId / evidence；否则后面没法验证。
 * 这里不替它兜底 —— **兜底会掩盖问题**。形状不对就当失败报出来。
 *
 * @param {Function} detect
 * @param {string} text
 * @param {object} [options]
 * @returns {{ ok: true, result: any } | { ok: false, reason: string }}
 */
export function runDetect(detect, text, options = {}) {
  let raw
  try {
    raw = detect(text, options)
  } catch (err) {
    return { ok: false, reason: `detect() 抛错：${err && err.message ? err.message : String(err)}` }
  }
  if (!raw || typeof raw !== 'object') {
    return { ok: false, reason: `detect() 返回的不是对象：${typeof raw}` }
  }
  if (!Array.isArray(raw.hits)) {
    return { ok: false, reason: 'detect() 返回结果里没有 hits 数组。' }
  }
  const bad = []
  for (const [i, h] of raw.hits.entries()) {
    if (!h || typeof h !== 'object') {
      bad.push(`hits[${i}] 不是对象`)
      continue
    }
    if (typeof h.specId !== 'string' || !h.specId) bad.push(`hits[${i}] 缺少 specId`)
    if (typeof h.evidence !== 'string' || !h.evidence) bad.push(`hits[${i}] 缺少 evidence 字符串`)
  }
  if (bad.length) {
    return { ok: false, reason: `hits 形状不合法：${bad.slice(0, 5).join('；')}${bad.length > 5 ? ` ……（共 ${bad.length} 条）` : ''}` }
  }
  return { ok: true, result: raw }
}

/**
 * 某个 specId 在 hits 里出现了几次。
 * @param {any} result
 * @param {string} specId
 */
export function hitsFor(result, specId) {
  return (result?.hits ?? []).filter((h) => h.specId === specId)
}

/**
 * 命中的严重级别。检测器可能不给 severity，就退回契约里的定义。
 * @param {any} hit
 * @param {Map<string, any>} specIndex
 */
export function severityOf(hit, specIndex) {
  const s = hit.severity ?? specIndex.get(hit.specId)?.severity
  return s ?? 'warn'
}

/* ————————————————————— 小工具 ————————————————————— */

/** 绝对路径 → file:// URL。 */
export function pathToUrl(p) {
  return new URL(`file://${p.split(path.sep).map(encodeURIComponent).join('/')}`).href
}

/**
 * 截断长文本用于展示。
 * @param {string} s
 * @param {number} [n]
 */
export function clip(s, n = 60) {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim()
  if (t.length <= n) return t
  return `${t.slice(0, n)}…`
}

/**
 * 把一段中文文本压成单行摘要（用于报告里的证据展示）。
 * @param {string} s
 * @param {number} [n]
 */
export function oneLine(s, n = 80) {
  return clip(s, n)
}

/**
 * 表格渲染（等宽中文按 2 列宽算）。
 * @param {string[]} headers
 * @param {string[][]} rows
 */
export function table(headers, rows) {
  const width = (s) => {
    let w = 0
    for (const ch of String(s)) w += /[　-鿿＀-￯]/.test(ch) ? 2 : 1
    return w
  }
  const widths = headers.map((h, i) => Math.max(width(h), ...rows.map((r) => width(r[i] ?? ''))))
  const pad = (s, w) => {
    const txt = String(s ?? '')
    let d = w - width(txt)
    let out = txt
    while (d > 0) { out += ' '; d-- }
    return out
  }
  const lineRow = (cells) => cells.map((c, i) => pad(c, widths[i])).join('  ')
  const out = [paint('bold', lineRow(headers)), paint('gray', widths.map((w) => '─'.repeat(w)).join('  '))]
  for (const r of rows) out.push(lineRow(r))
  return out
}

/**
 * 「依赖未就绪」的统一样式报告。
 * @param {LoadFailure} f
 */
export function reportMissing(f) {
  heading('依赖未就绪')
  item('warn', `缺少：${f.what}`)
  item('info', `位置：${f.where}`)
  item('info', `原因：${f.reason}`)
  line()
  item('skip', '本次验证无法进行 —— 结论只能是「无法判定」，不是「通过」。')
  line()
}

/**
 * 统一的进程退出封装：把「未就绪」和「失败」区分开。
 *
 * @param {number} code
 */
export function finish(code) {
  process.exitCode = code
}

/** 是否只有 ANSI 可用（无 TTY）。 */
export const isTTY = useColor

/**
 * verify/_fixtures.mjs —— 读 test/fixtures/ 下的样本。
 *
 * 样本是带 YAML frontmatter 的 markdown：
 *
 *   ---
 *   id: realistic-modern
 *   genre: 现实向都市
 *   title: 早高峰
 *   ---
 *   正文……
 *
 * 解析刻意做得很朴素 —— 不引 YAML 库，只认 `key: value` 单行形式。
 * 样本是我们自己写的，不需要完整的 YAML 支持。
 *
 * @module verify/_fixtures
 */

import fs from 'node:fs'
import path from 'node:path'
import { FIXTURES_DIR } from './_harness.mjs'

/**
 * 读一个 fixture 文件。
 * @param {string} file
 * @returns {{ id: string, genre: string, title: string, body: string, file: string }}
 */
export function parseFixture(file) {
  const raw = fs.readFileSync(file, 'utf8')
  const meta = {}
  let body = raw

  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (m) {
    for (const ln of m[1].split(/\r?\n/)) {
      const kv = ln.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/)
      if (kv) meta[kv[1]] = kv[2].trim()
    }
    body = m[2]
  }
  return {
    id: meta.id ?? path.basename(file, path.extname(file)),
    genre: meta.genre ?? '未标注',
    title: meta.title ?? meta.id ?? path.basename(file, path.extname(file)),
    body: body.trim(),
    file,
  }
}

/**
 * 读整个 fixtures 目录，按 genre 分组。
 * @returns {{ all: any[], byGenre: Map<string, any[]> }}
 */
export function loadFixtures(dir = FIXTURES_DIR) {
  if (!fs.existsSync(dir)) return { all: [], byGenre: new Map() }
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md') || f.endsWith('.txt'))
    .sort()
  const all = files.map((f) => parseFixture(path.join(dir, f)))
  const byGenre = new Map()
  for (const fx of all) {
    if (!byGenre.has(fx.genre)) byGenre.set(fx.genre, [])
    byGenre.get(fx.genre).push(fx)
  }
  return { all, byGenre }
}

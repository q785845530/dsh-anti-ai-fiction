/**
 * 检测引擎的聚合层 —— 对外只有一个函数 `detect(text, options)`。
 *
 * ## 这一层负责什么
 *
 * 四个 `detectors/*.js` 各自只管「在我这个维度里，这段文字犯了哪些雷区」，
 * 返回一堆 `Hit`（带下标、证据、说明）。它们**不知道** spec 元信息、
 * 不知道严重级别、不知道阈值、也不知道该不该打回。
 *
 * 聚合层把三件事补齐：
 *   1. **补元信息** —— 从 `spec.js` 把 title / severity / rule / fix 贴到每条命中上，
 *      这样报告、提示词、界面都拿到同一份口径，不用各自去查表；
 *   2. **排序与去重** —— 按原文位置排，同一位置同一雷区只留一条；
 *   3. **统计与裁决** —— 数出「不同雷区」条数，交给 `judgeReject` 判定打回。
 *
 * ## 为什么统计口径必须在这里收口
 *
 * `blockCount` / `bySeverity` / `byDimension` 三个数字，工具层、界面层、
 * 验证脚本都要用。如果每层自己从 `hits` 里数，就会出现「同一份稿子，
 * 工具说命中 3 条打回、界面说 2 条放行」这种最伤信任的情况。
 *
 * 所以口径定死在这里，并且**和 `spec.js` 的 `judgeReject` 保持同一含义**：
 * 全部按 **distinct specId 的个数** 计，不按命中处数计。
 *
 * @module dsh-anti-ai-fiction/detect
 */
import { SPECS, DIMENSIONS, judgeReject, BLOCK_THRESHOLD } from './spec.js'
import { buildIndex } from './detectors/common.js'
import * as nameDet from './detectors/name.js'
import * as objectDet from './detectors/object.js'
import * as dialogueDet from './detectors/dialogue.js'
import * as sceneryDet from './detectors/scenery.js'

/** 维度 → 该维度的检测器模块。 */
const MODULES = {
  name: nameDet,
  object: objectDet,
  dialogue: dialogueDet,
  scenery: sceneryDet,
}

/** 雷区 id → 定义，启动时建一次。 */
const SPEC_BY_ID = new Map(SPECS.map((s) => [s.id, s]))

/** 维度 id 集合，用来校验 options.dims。 */
const DIM_IDS = new Set(DIMENSIONS.map((d) => d.id))

/**
 * 归一化 options 里的维度 / 雷区筛选。
 *
 * 传错（比如维度写成「名字」而不是 `name`）时**不报错、退回全跑**，
 * 因为这是给人用的工具：筛错了应该多查而不是查不到。
 * 但会在返回值里留一条 `notes` 说明筛选项被忽略了，便于排查。
 */
function normalizeFilter(options) {
  const notes = []
  let dims = null
  let specIds = null

  const rawDims = options?.dims
  if (Array.isArray(rawDims) && rawDims.length > 0) {
    const ok = rawDims.filter((d) => DIM_IDS.has(d))
    if (ok.length !== rawDims.length) {
      notes.push(`这些维度名无效，已忽略：${rawDims.filter((d) => !DIM_IDS.has(d)).join('、')}`)
    }
    if (ok.length > 0) dims = new Set(ok)
  }

  const rawSpecs = options?.specs
  if (Array.isArray(rawSpecs) && rawSpecs.length > 0) {
    const ok = rawSpecs.filter((s) => SPEC_BY_ID.has(s))
    if (ok.length !== rawSpecs.length) {
      notes.push(`这些雷区 id 无效，已忽略：${rawSpecs.filter((s) => !SPEC_BY_ID.has(s)).join('、')}`)
    }
    if (ok.length > 0) specIds = new Set(ok)
  }

  return { dims, specIds, notes }
}

/**
 * 跑一遍全部（或指定的）雷区。
 *
 * @param {string} text 正文。
 * @param {object} [options]
 * @param {string[]} [options.dims] 只跑这些维度（`name`/`object`/`dialogue`/`scenery`）。
 * @param {string[]} [options.specs] 只跑这些雷区 id。
 * @param {string[]} [options.allowedTerms] 项目本来就在用的词，命中后跳过。
 * @param {boolean} [options.allowModern] 项目是现代背景，放行「现代物件乱入」这条。
 * @returns {{
 *   ok: boolean,
 *   chars: number,
 *   hits: Array<object>,
 *   bySeverity: {block: number, warn: number},
 *   byDimension: {name: number, object: number, dialogue: number, scenery: number},
 *   blockCount: number,
 *   shouldReject: boolean,
 *   threshold: number,
 *   verdict: object,
 *   notes: string[],
 * }}
 */
export function detect(text, options = {}) {
  const source = typeof text === 'string' ? text : ''
  const { dims, specIds, notes } = normalizeFilter(options)

  // 空文本：不报错，返回一个「没东西可查」的结果。
  // 让调用方自己决定空文本算不算问题（deai_guard 会另外查「太短」）。
  if (source.trim() === '') {
    return {
      ok: true,
      chars: 0,
      hits: [],
      bySeverity: { block: 0, warn: 0 },
      byDimension: { name: 0, object: 0, dialogue: 0, scenery: 0 },
      blockCount: 0,
      shouldReject: false,
      threshold: BLOCK_THRESHOLD,
      verdict: judgeReject({ hits: [] }),
      notes: [...notes, '正文是空的，没有可查内容。'],
    }
  }

  // 段落 / 行索引只建一次，40 条规则共用 —— 各规则自己再切一遍不仅浪费，
  // 还会让同一次命中在不同规则里定位到不同段号，报告读起来自相矛盾。
  const idx = buildIndex(source)
  const ctx = {
    idx,
    allowModern: options?.allowModern === true,
  }

  const allowed = new Set(
    Array.isArray(options?.allowedTerms)
      ? options.allowedTerms.map((x) => String(x)).filter((x) => x !== '')
      : [],
  )

  const collected = []
  const seen = new Set()

  for (const spec of SPECS) {
    if (dims !== null && !dims.has(spec.dim)) continue
    if (specIds !== null && !specIds.has(spec.id)) continue

    const mod = MODULES[spec.dim]
    const fn = mod?.[spec.detector]
    if (typeof fn !== 'function') {
      // 检测器缺失不该让整次检测崩掉：记一条 note，继续查别的。
      // 这样「某一条规则写坏了」表现为「这条不报」，而不是「整个插件不可用」。
      notes.push(`雷区 ${spec.id} 的检测器 ${spec.detector} 未实现，已跳过。`)
      continue
    }

    let raw = []
    try {
      raw = fn(source, ctx) ?? []
    } catch (e) {
      notes.push(`雷区 ${spec.id} 的检测器抛错，已跳过：${e?.message ?? String(e)}`)
      continue
    }

    for (const h of raw) {
      if (h === null || h === undefined) continue
      const evidence = typeof h.evidence === 'string' ? h.evidence : ''
      if (evidence === '') continue
      // 证据必须真实存在于正文 —— 这是全插件的信任基础。
      if (!source.includes(evidence)) continue
      // 项目放行词：命中证据里带了这些词就跳过。
      if (allowed.size > 0 && [...allowed].some((t) => evidence.includes(t))) continue

      // 去重键：同一雷区 + 同一条证据，只留一条。
      // 不同检测器之间也可能报同一句（比如一句里既有成语堆砌又有拟人），
      // 那是**两条不同的病**，要都留着，所以键里必须带 spec.id。
      const key = `${spec.id}\u0000${evidence}\u0000${h.index ?? -1}`
      if (seen.has(key)) continue
      seen.add(key)

      collected.push({
        specId: spec.id,
        dim: spec.dim,
        dimLabel: DIMENSIONS.find((d) => d.id === spec.dim)?.label ?? spec.dim,
        no: spec.no,
        title: spec.title,
        severity: spec.severity,
        rule: spec.rule,
        why: spec.why,
        allow: spec.allow,
        fix: spec.fix,
        evidence,
        where: typeof h.where === 'string' ? h.where : '',
        note: typeof h.note === 'string' ? h.note : '',
        index: typeof h.index === 'number' ? h.index : source.indexOf(evidence),
      })
    }
  }

  // 按原文位置排序：报告按「读稿顺序」呈现，作者才能顺着改下去。
  // 同位置时 block 在前 —— 先看要命的。
  collected.sort((a, b) => {
    if (a.index !== b.index) return a.index - b.index
    if (a.severity !== b.severity) return a.severity === 'block' ? -1 : 1
    return a.specId.localeCompare(b.specId)
  })

  // —— 统计：全部按 distinct specId 计 ——
  const blockSpecs = new Set()
  const warnSpecs = new Set()
  const perDim = { name: new Set(), object: new Set(), dialogue: new Set(), scenery: new Set() }
  for (const h of collected) {
    if (h.severity === 'block') blockSpecs.add(h.specId)
    else warnSpecs.add(h.specId)
    perDim[h.dim]?.add(h.specId)
  }

  const verdict = judgeReject({ hits: collected })

  return {
    ok: true,
    chars: source.length,
    hits: collected,
    bySeverity: { block: blockSpecs.size, warn: warnSpecs.size },
    byDimension: {
      name: perDim.name.size,
      object: perDim.object.size,
      dialogue: perDim.dialogue.size,
      scenery: perDim.scenery.size,
    },
    // 口径：**不同 block 级雷区**的个数，不是命中处数。
    blockCount: blockSpecs.size,
    shouldReject: verdict.reject,
    threshold: BLOCK_THRESHOLD,
    verdict,
    notes,
  }
}

/** 供工具层直接取雷区表用。 */
export { SPECS, DIMENSIONS, BLOCK_THRESHOLD }

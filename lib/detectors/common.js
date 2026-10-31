/**
 * 检测器的公用零件。
 *
 * 这一层只解决三件事：
 *   1. **定位** —— 给一个字符下标，告诉我它在第几段、第几行、哪一句。
 *      没有定位，作者拿到「这里有 AI 味」也找不到地方改，等于没报。
 *   2. **切句 / 切段** —— 绝大多数雷区是「句级」或「段级」的，
 *      必须在正确的粒度上判断，否则要么整段一次性报，要么漏掉句中的命中。
 *   3. **成 hit** —— 把「我看到了什么」变成结构一致的 hit 对象，
 *      并且保证 `evidence` 一定是正文里真实出现的字串。
 *
 * ## 为什么 evidence 必须可回查
 *
 * 检测引擎最怕「报了个不存在的词」—— 作者一看正文里根本没有「璀璨」两个字，
 * 整条报告的可信度就归零了。所以 `mkHit` 只接受**从原文里切出来的片段**，
 * 绝不允许调用方凭空拼一个字符串进来。这条约束由 `mkHit` 内部强制：
 * 它会检查 `text.includes(evidence)`，不在正文里就直接丢弃这条 hit。
 *
 * @module dsh-anti-ai-fiction/detectors/common
 */

/** 一条命中。结构与 `lib/detect.js` 对外契约一致（除 spec 元信息由聚合层补齐）。 */
export class Hit {
  /**
   * @param {object} o
   * @param {number} o.index 命中在全文中的字符下标
   * @param {string} o.evidence 原文片段（必须能在原文里找到）
   * @param {string} o.note 一句话说明为什么算命中
   * @param {string} [o.where] 定位描述
   */
  constructor({ index, evidence, note, where }) {
    this.index = index;
    this.evidence = evidence;
    this.note = note;
    this.where = where;
  }
}

/**
 * 段 / 行 / 句的切分结果。
 *
 * 一次性算好，检测器里反复用 —— 40 条规则各自再切一遍纯属浪费，
 * 而且切法不一致会让「同一次命中在不同规则里定位到不同段落」，报告很难读。
 */
export function buildIndex(text) {
  const paragraphs = splitParagraphs(text);
  const lines = splitLines(text);
  return { paragraphs, lines };
}

/**
 * 按空行切段。
 *
 * 只用 `\n` 切是不够的：很多稿子整篇就是一段，中文里一句话动辄几十个字，
 * 段级规则（如同段里有没有物理细节）就完全失效了。所以这里把
 * 「换行」和「长段落按句号切」都算进段里，段号仍然按视觉上的换行/空行递增。
 */
export function splitParagraphs(text) {
  const out = [];
  let start = 0;
  let no = 1;
  const re = /\n[ \t]*\n|\n/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const body = text.slice(start, m.index);
    if (body.trim()) out.push({ no, start, end: m.index, text: body });
    start = m.index + m[0].length;
    no += 1;
  }
  const tail = text.slice(start);
  if (tail.trim()) out.push({ no, start, end: text.length, text: tail });
  return out;
}

/** 按行切。 */
export function splitLines(text) {
  const out = [];
  let start = 0;
  let no = 1;
  const re = /\n/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    out.push({ no, start, end: m.index, text: text.slice(start, m.index) });
    start = m.index + 1;
    no += 1;
  }
  out.push({ no, start, end: text.length, text: text.slice(start) });
  return out;
}

/**
 * 按句末标点切句。
 *
 * 只认中文/英文的终止标点，加上右引号/右括号收尾，避免把
 * 「"你好。"」切成半句。引号本身也算句界的一部分，
 * 因为很多雷区（「台词以难道开头」）需要拿到完整的引号内文本。
 */
export function splitSentences(text) {
  const out = [];
  const re = /[^。！？!?；;\n]*[。！？!?；;]+[”’」』"')）]?|[^。！？!?；;\n]+$/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const s = m[0];
    if (s.trim()) out.push({ start: m.index, end: m.index + s.length, text: s });
  }
  return out;
}

/**
 * 定位：给一个字符下标，返回「第 N 段」这类描述。
 *
 * @param {{paragraphs: Array, lines: Array}} idx
 * @param {number} index
 * @returns {string}
 */
export function locate(idx, index) {
  const p = idx.paragraphs.find((x) => index >= x.start && index < x.end)
    ?? idx.paragraphs[idx.paragraphs.length - 1];
  const l = idx.lines.find((x) => index >= x.start && index < x.end)
    ?? idx.lines[idx.lines.length - 1];
  if (!p) return '全文';
  return `第 ${p.no} 段（第 ${l?.no ?? 1} 行）`;
}

/**
 * 找到包含某个字符下标的那一段。
 * @param {{paragraphs: Array}} idx
 * @param {number} index
 */
export function paragraphAt(idx, index) {
  return idx.paragraphs.find((x) => index >= x.start && index < x.end)
    ?? idx.paragraphs[idx.paragraphs.length - 1]
    ?? null;
}

/**
 * 找到包含某个字符下标的那一句。
 * @param {{paragraphs: Array}} idx
 * @param {number} index
 * @param {string} text
 */
export function sentenceAt(text, index) {
  const sents = splitSentences(text);
  return sents.find((s) => index >= s.start && index < s.end)
    ?? sents.find((s) => s.start <= index)
    ?? null;
}

/**
 * 成一条 hit，并**校验 evidence 真的在正文里**。
 *
 * 校验不通过就返回 null（而不是造一个假证据）——
 * 一个检测器写错了，宁可漏报也不能报出作者改不动的东西。
 *
 * @param {string} text 全文
 * @param {{index: number, evidence: string, note: string, where?: string}} o
 * @returns {Hit|null}
 */
export function mkHit(text, { index, evidence, note, where }) {
  if (typeof evidence !== 'string' || !evidence) return null;
  if (!text.includes(evidence)) return null;
  const at = typeof index === 'number' && index >= 0 ? index : text.indexOf(evidence);
  return new Hit({ index: at, evidence, note, where });
}

/**
 * 在一段文字里找出所有词表词的出现位置。
 *
 * 返回的是**词组级**的位置，不做单字拆分 —— 中文没有词边界，
 * 「血煞」里的「血」不能单独当贬义词用，「白光」里的「白」也不是「如血」。
 * 所以这里一律按词表里的完整词去 `indexOf`。
 *
 * @param {string} text
 * @param {string[]} words
 * @returns {Array<{word: string, index: number}>}
 */
export function findWords(text, words) {
  const out = [];
  for (const w of words) {
    if (!w) continue;
    let from = 0;
    for (;;) {
      const i = text.indexOf(w, from);
      if (i < 0) break;
      out.push({ word: w, index: i });
      from = i + w.length;
    }
  }
  out.sort((a, b) => a.index - b.index);
  return out;
}

/**
 * 词表里有几个词出现在这段文字里（去重后的词数，不是出现次数）。
 * @param {string} text
 * @param {string[]} words
 */
export function countDistinctWords(text, words) {
  const set = new Set();
  for (const w of words) if (w && text.includes(w)) set.add(w);
  return set.size;
}

/**
 * 词表里有几个词出现在这段文字里（按出现次数）。
 * @param {string} text
 * @param {string[]} words
 */
export function countOccurrences(text, words) {
  let n = 0;
  for (const w of words) {
    if (!w) continue;
    let from = 0;
    for (;;) {
      const i = text.indexOf(w, from);
      if (i < 0) break;
      n += 1;
      from = i + w.length;
    }
  }
  return n;
}

/**
 * 抽出所有引号内的台词。
 *
 * 中英文引号都收。引号内是雷区最密集的地方（对话类 10 条里 8 条都在台词里）。
 * 没引号的段落级素材（景物、道具）另有各自信号的检测器负责。
 *
 * @param {string} text
 * @returns {Array<{start: number, end: number, text: string, quote: string}>}
 */
export function extractDialogues(text) {
  const out = [];
  const re = /[“「『"]([^”」』"]{1,200})[”」』"]/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    out.push({
      start: m.index,
      end: m.index + m[0].length,
      text: m[0],
      quote: m[1],
      quoteStart: m.index + m[0].indexOf(m[1]),
    });
  }
  return out;
}

/**
 * 取一段文字里的「附近窗口」（前后各若干字符）。
 *
 * 用于「紧跟在后面有没有人物感受」这类需要看上下文才能判定的规则。
 *
 * @param {string} text
 * @param {number} index
 * @param {number} before
 * @param {number} after
 */
export function window(text, index, before = 120, after = 160) {
  return text.slice(Math.max(0, index - before), Math.min(text.length, index + after));
}

/**
 * 判断一个字符是不是中文成字（用来区分「林」这种独立字和「林」在词中间）。
 * @param {string} ch
 */
export function isCjk(ch) {
  return /[\u3400-\u9fff\uf900-\ufaff]/.test(ch);
}

/**
 * 判断 `pos` 处的字符前面是否还有一个中文连续词（即该字是词的一部分）。
 *
 * 「血煞」这种词，如果只按单字查，「血」会被误当成独立贬义词。
 * 词表匹配本身已经是词组级的，这个函数只用于**单字词表**
 * （比如 VILLAIN_MARKERS 里的「冥」「血魔」）需要额外确认独立性的场合。
 *
 * @param {string} text
 * @param {number} pos
 */
export function isStandaloneChar(text, pos) {
  const prev = text[pos - 1] ?? '';
  const next = text[pos + (text[pos]?.length ?? 1)] ?? '';
  return !isCjk(prev) && !isCjk(next);
}

/**
 * 把一段话里的「枚举项」切出来：按中文/英文逗号、顿号、分号切。
 * @param {string} s
 */
export function splitList(s) {
  return s.split(/[，,、；;]/).map((x) => x.trim()).filter(Boolean);
}

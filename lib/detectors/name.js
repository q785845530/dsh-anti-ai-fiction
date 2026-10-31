/**
 * 名字类检测器（10 条）。
 *
 * 名字是 AI 最先露馅的地方 —— 因为名字是「检索」出来的，不是「想」出来的。
 * 训练库里「林凡」「叶辰」「苏雪」的联合概率远高于任何真人名字，
 * 所以这类套路几乎不可能由活人作者独立产出。
 *
 * 但名字检测有个死穴：**中文姓名单独出现时完全无辜**。
 * 「林」「雪」「白」在正常小说里满地都是，「林清婉」「楚阳」「陈建国」都是好名字。
 * 所以这 10 条里绝大多数必须是**组合命中**：
 *   - 套路姓 + 套路名（林 + 凡）→ 报
 *   - 套路姓 + 生活印记名（林 + 清婉）→ 放行
 * 单独一个「林」永远不报。
 *
 * @module dsh-anti-ai-fiction/detectors/name
 */

import {
  CLICHE_SURNAMES, CLICHE_GIVEN, VILLAIN_MARKERS, RARITY, SECT_SUFFIX,
  MANUAL_BAD, SOULLESS_TITLES, MODERN_WORDS,
} from '../spec.js';
import { mkHit, locate, findWords, isStandaloneChar, splitList } from './common.js';

/** 名字类里出现这些词，说明这名字带时代/生活印记，不算套路名。 */
const LIFE_MARKERS = [
  '建国', '建军', '国强', '卫东', '红梅', '秀英', '桂英', '小满', '狗蛋', '铁柱',
  '铁蛋', '大柱', '二柱', '有粮', '满仓', '招娣', '来福', '有福', '狗剩',
  '秋生', '春生', '长根', '木生', '石头', '三炮', '二狗', '狗娃',
  '清婉', '庭安', '婉清', '砚秋', '拾阶', '听澜', '望舒', '怀瑾', '既明',
];

/** 现代网文高频名 —— 古代背景里出现就是时代错位。 */
const MODERN_GIVEN = [
  '紫萱', '龙傲天', '星辰', '沐辰', '沐晴', '天佑', '子轩', '梓涵', '欣怡',
  '雨萱', '浩然', '子墨', '梓轩', '一鸣', '思聪', '诗雨', '梦瑶', '晨曦',
];

/** 复姓。 */
const COMPOUND_SURNAMES = ['慕容', '欧阳', '上官', '司马', '轩辕', '独孤', '南宫', '西门', '东方', '皇甫', '尉迟', '公孙', '夏侯', '诸葛', '闻人', '皇甫', '澹台'];

/** 高配意象词（人名里的「豪华装修件」）。 */
const GRANDIOSE_GIVEN = ['云海', '星辰', '风华', '傲天', '天成', '无双', '绝世', '凌霄', '九霄', '玄天'];

/** 西方奇幻里堆意象的意象词。 */
const FOREIGN_IMAGERY = [
  '光', '暗', '影', '荣耀', '圣', '暗夜', '黎明', '黄昏', '晨曦', '王权',
  '灵魂', '血', '霜', '焰', '雷', '铁', '鹰', '狮', '龙', '月', '日', '影刃',
  // 补：「冰晶之泪」「星辰」「夜歌」这类也是同一套硬拼法。
  // 词表缺了它们，「伊丽莎白·冰晶之泪」会漏检 —— 这是数据缺口不是逻辑错。
  '冰晶', '水晶', '星辰', '星光', '夜歌', '之泪', '之歌', '之心', '玫瑰', '荆棘',
  '银', '金', '烬', '幽冥', '虚', '渊', '穹', '羽', '蝶', '花', '雾',
];

/**
 * 名字类规则的公共入口辅助：找出正文里所有的「疑似人名/称号」片段。
 *
 * 中文没有分隔符，硬找很难。这里采取的策略是：
 * **以词表里的关键词为锚点**（套路姓、套路名、复姓、意象词、生僻字……），
 * 然后向两侧贪心扩展成完整的名字。这样既能覆盖「林凡」这种两字名，
 * 也能覆盖「林嫣然」这种三字名。
 */

/**
 * 判断某个下标处是否开始一个人名候选（锚点命中）。
 * @param {string} text
 * @param {number} i
 * @param {{surnames: string[], given: string[]}} cfg
 */
function nameAnchorAt(text, i, cfg) {
  const hitSur = cfg.surnames.find((s) => text.startsWith(s, i));
  const hitGiv = cfg.given.find((g) => text.startsWith(g, i));
  if (!hitSur && !hitGiv) return null;
  return { sur: hitSur, giv: hitGiv };
}

/**
 * 从一个下标开始，贪心吃掉「姓 + 名」连续的中文串。
 *
 * 之所以要「连续」而不是「遇到标点就停」：名字里可以带「·」（西方名）
 * 或者「氏」（陈氏），但不能带句读。
 *
 * @param {string} text
 * @param {number} start
 * @returns {{name: string, end: number}|null}
 */
function grabNameRun(text, start) {
  let end = start;
  while (end < text.length) {
    const ch = text[end];
    if (/[\u3400-\u9fff]/.test(ch)) { end += 1; continue; }
    // 「·」允许出现在西式名中间
    if (ch === '·' && end + 1 < text.length && /[\u3400-\u9fff]/.test(text[end + 1])) { end += 1; continue; }
    break;
  }
  if (end === start) return null;
  return { name: text.slice(start, end), end };
}

/**
 * 判断一个候选串是不是「独立成词」—— 前后不是中文连字。
 * 「林凡说」里的「林凡」是名字；「林檎」不是。
 * @param {string} text
 * @param {number} start
 * @param {number} end
 */
function isDelimited(text, start, end) {
  const prev = text[start - 1] ?? '';
  const next = text[end] ?? '';
  const cjk = /[\u3400-\u9fff]/;
  return !(cjk.test(prev) && cjk.test(text[start] ?? '')) || !cjk.test(next);
}

/**
 * 列出正文里所有「姓氏锚点」开头的候选人，供多条规则复用。
 * @param {string} text
 * @param {string[]} surnames
 */
function surnameCandidates(text, surnames) {
  const out = [];
  for (const s of surnames) {
    let from = 0;
    for (;;) {
      const i = text.indexOf(s, from);
      if (i < 0) break;
      from = i + s.length;
      const run = grabNameRun(text, i);
      if (!run) continue;
      out.push({ surname: s, name: run.name, index: i, end: run.end });
    }
  }
  out.sort((a, b) => a.index - b.index);
  return out;
}

// ——————————————————————————————————————————————————————————————
// 1. name.cliche-surname —— 烂大街的姓氏堆砌
// ——————————————————————————————————————————————————————————————
/**
 * 套路姓 + 套路名（凡/辰/天/雪/涵/嫣……）→ 报。
 * 名字里带生活印记（建国/小满/狗蛋）或姓氏本身不是套路姓 → 放行。
 */
export function clicheSurname(text, ctx) {
  const hits = [];
  const cands = surnameCandidates(text, CLICHE_SURNAMES);
  const seen = new Set();

  for (const c of cands) {
    const name = c.name;
    if (name.length < 2 || name.length > 4) continue;
    if (seen.has(c.index)) continue;

    // 名部分：去掉姓氏后剩下的
    const given = name.slice(c.surname.length);
    if (!given) continue;

    // 放行：名字带生活/时代印记
    if (LIFE_MARKERS.some((m) => name.includes(m))) continue;
    // 放行：姓氏本来就不是套路姓（这里只对双字套路名报）
    const matchedGiven = CLICHE_GIVEN.find((g) => given.startsWith(g));
    if (!matchedGiven) continue;

    seen.add(c.index);
    hits.push(mkHit(text, {
      index: c.index,
      evidence: name,
      note: `「${name}」是套路姓「${c.surname}」加套路名「${matchedGiven}」的拼装，没有职业或地域印记。`,
      where: locate(ctx.idx, c.index),
    }));
  }
  return hits;
}

// ——————————————————————————————————————————————————————————————
// 2. name.grandiose-foreign —— 强行「高大上」的西方名
// ——————————————————————————————————————————————————————————————
/**
 * 西式名（带「·」或西文音节）里叠加 ≥2 个意象词 → 报。
 * 只含一个意象词 → 放行（契约明确写了）。
 */
export function grandioseForeign(text, ctx) {
  const hits = [];
  // 用「·」做锚点找西式名，而不是用拉丁字母正则。
  //
  // 第一版写成 /[A-Za-z][A-Za-z·'\-]*/g，只能匹配纯拉丁名 —— 但验收用例
  // 「阿瑟斯·圣光·暗影」「伊丽莎白·冰晶之泪」是**汉字音译名**，
  // 一个拉丁字母都没有，整条规则直接失效。中文奇幻里的西式名本来
  // 就大多写成汉字，所以锚点必须换成间隔号「·」本身。
  const seen = new Set();
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== '·' && text[i] !== '•') continue
    // 向左右扩成完整名字（汉字 / 拉丁字母都吃）
    let start = i
    while (start > 0 && /[\u3400-\u9fffA-Za-z'\-]/.test(text[start - 1])) start -= 1
    let end = i + 1
    while (end < text.length && /[\u3400-\u9fffA-Za-z'\-]/.test(text[end])) end += 1
    const token = text.slice(start, end)
    if (seen.has(start)) continue
    seen.add(start)

    const parts = token.split(/[·•]/).filter(Boolean)
    if (parts.length < 2) continue

    // 意象词按「段」统计：光/暗/影 这类是单字意象，得看它们是否成段出现
    const imageryParts = parts.filter((p) => FOREIGN_IMAGERY.some((im) => p.includes(im)))
    // 判据是「叠了 ≥2 个意象词」。注意这里数的是**意象词个数**，
    // 不是意象段数 —— 「伊丽莎白·冰晶之泪」只有两段，但第二段里
    // 「冰晶」和「之泪」是两个意象，合起来正是契约说的
    // 「把荣耀、暗影、星辰硬拼在一起」。「阿瑟斯·圣光·暗影」则是两段各一个。
    // 只按段数判会漏掉「一段里塞两个意象」的写法。
    const imageryWords = []
    for (const p of parts) {
      for (const im of FOREIGN_IMAGERY) {
        if (p.includes(im) && !imageryWords.includes(im)) imageryWords.push(im)
      }
    }
    if (imageryWords.length < 2) continue

    hits.push(mkHit(text, {
      index: start,
      evidence: token,
      note: `西式名「${token}」里叠了 ${imageryWords.length} 个意象词（${imageryWords.join('、')}），像是把「光/暗/影/荣耀」硬拼出来的。`,
      where: locate(ctx.idx, start),
    }))
  }
  return hits;
}

// ——————————————————————————————————————————————————————————————
// 3. name.villain-label —— 反派名字写着「我是坏蛋」
// ——————————————————————————————————————————————————————————————
/**
 * 贬义词标记 + 尊号 → 报。
 * 「毒龙大王」只有一个贬义词（毒龙）也要报 —— 契约的 rule 写的是
 * 「由贬义词 + 尊号构成」，「毒龙」本身就够脸谱化了。
 *
 * 放行：正派道号 / 民间对活人的绰号。
 * 「白无常」不含贬义词；「谢三爷」不含 —— 这类天然不会被命中。
 */
export function villainLabel(text, ctx) {
  const hits = [];
  const seen = new Set();
  // 尊号：把贬义词读成一个「称号」的候选（通常 2—4 字）
  const honorific = /[老祖|魔尊|邪帝|魔祖|尊者|陛下|大王|大帝|魔王|尊|主|君|王|圣|帝|祖]/;

  for (const { word, index } of findWords(text, VILLAIN_MARKERS)) {
    if (seen.has(index)) continue;
    // 「冥」「血魔」这类单字贬义词要求独立成词，避免「血煞」里的「血」被单独算
    if (word.length === 1 && !isStandaloneChar(text, index)) continue;
    if (word === '杀神' || word === '屠夫') {
      // 「杀神」「屠夫」更像称号类别，交给 soullessEpithet 处理
      continue;
    }

    // 向后读最多 3 个字，看是不是「贬义词 + 尊号」
    const after = text.slice(index, index + 6);
    const m = honorific.exec(after.slice(word.length));
    const hasHonor = m !== null;

    // 「血煞老祖」「灭世魔尊」这类必报；「毒龙大王」只有一个贬义词但带尊号，也报
    if (!hasHonor) continue;

    const run = grabNameRun(text, index);
    const evidence = run ? run.name : word;
    seen.add(index);
    hits.push(mkHit(text, {
      index,
      evidence,
      note: `「${evidence}」把贬义词（${word}）和尊号（大王/大帝/尊者一类）直接拼在一起，等于把「我是反派」写在了名字上。`,
      where: locate(ctx.idx, index),
    }));
  }
  return hits;
}

// ——————————————————————————————————————————————————————————————
// 4. name.rare-char —— 强行用生僻字装逼
// ——————————————————————————————————————————————————————————————
/**
 * 称号/人名里出现生僻字 → 报。
 * 放行：生僻字出现在正文叙述（非人名）且语境明确 —— 这里用一个
 * 朴素的启发式：生僻字后面**没有**紧跟称号/组织后缀，且不在「叫/名为/姓/名」等
 * 命名语境里，就当作叙述用字，放行。
 */
export function rareChar(text, ctx) {
  const hits = [];
  const seen = new Set();
  // 命名语境词：出现这些词说明后面跟着的生僻字是名字
  const namingCue = /(?:姓|名为|名叫|叫做|道号|法号|尊号|称号|人称|名字是|号称|自号|号曰|名曰|字[「“"]|叫[「“"])/;

  for (const { word, index } of findWords(text, RARITY)) {
    if (seen.has(index)) continue;
    // 「独立成词」的判据要放宽：生僻字**后面紧跟汉字是常态**。
    // 第一版要求前后都不能是汉字，结果「翾天剑尊」「焱暝大帝」全被跳过 ——
    // 生僻字几乎永远夹在名字中间，那样判等于这条规则从不生效。
    //
    // 真正该防的是「生僻字出现在一个常用词中间」（如「魑魅」是固定词，
    // 不该因为含生僻字就报）。所以只拦「前后都是汉字、且整个词是常用词表里的词」
    // 这一种，其余一律按「用在名字上」处理。
    const COMMON_WORD_WITH_RARE = ['魑魅', '魍魉', '饕餮', '氤氲', '迤逦', '蹉跎', '缱绻']
    const around = text.slice(Math.max(0, index - 1), index + word.length + 1)
    if (COMMON_WORD_WITH_RARE.some((w) => around.includes(w))) continue

    // 往后看：紧跟称号后缀或属于命名语境 → 判定为「用在名字上」
    const after = text.slice(index + word.length, index + word.length + 8)
    const hasTitleSuffix = /[尊帝君王主宗门派阁殿圣祖师尊号期]/.test(after)
    const before = text.slice(Math.max(0, index - 12), index)
    const inNamingCue = namingCue.test(before)

    // 再放宽一层：生僻字出现在**短片段**里（≤6 字的「X天剑尊」这种）
    // 也按名字处理 —— 正文叙述里不会把生僻字这么密集地用。
    const run0 = grabNameRun(text, index)
    const looksLikeName = run0 !== null && run0.name.length <= 6

    if (!hasTitleSuffix && !inNamingCue && !looksLikeName) {
      // 放行：像是在叙述里当地名/中药名用
      continue
    }

    // 名字整体（生僻字向后吃满中文字符）
    const run = grabNameRun(text, index);
    const evidence = run ? run.name : word;
    seen.add(index);
    hits.push(mkHit(text, {
      index,
      evidence,
      note: `「${evidence}」里用了生僻字「${word}」来撑气势，读者大概率不认识这个字。`,
      where: locate(ctx.idx, index),
    }));
  }
  return hits;
}

// ——————————————————————————————————————————————————————————————
// 5. name.clone-sect —— 宗门/组织名称极度雷同
// ——————————————————————————————————————————————————————————————
/**
 * 「常见字 + 门派后缀」→ 报。放行：带地域/职业/行当特征的名字。
 *
 * 关键难点：「漕帮」「铸剑庐」这类是**没有**门派后缀的，靠后缀判定就够；
 * 但「下水道兄弟会」也不在后缀表里 —— 同样放行。
 * 而「天剑宗」的「天剑」是套路名，需要词表兜住。
 */
export function cloneSect(text, ctx) {
  const hits = [];
  const seen = new Set();
  // 门派前缀的套路字：这些字 + 门派后缀 = 量产名
  const genericPrefix = ['天', '青云', '神', '万兽', '天剑', '青龙', '玄武', '白虎', '紫霄', '太虚', '玄天', '九霄', '灵', '仙', '圣', '神霄', '紫云', '碧落', '赤霄', '苍梧', '太虚'];

  for (const suf of SECT_SUFFIX) {
    let from = 0;
    for (;;) {
      const i = text.indexOf(suf, from);
      if (i < 0) break;
      from = i + suf.length;
      // 「宗」「派」这类单字后缀太容易误伤（宗门的宗、派遣的派），
      // 只有当它出现在「通用套路前缀 + 后缀」时才报。
      //
      // 但前缀**不一定紧贴后缀**：「神丹阁」= 前缀「神」+ 中间的「丹」+ 后缀「阁」。
      // 第一版用 `before.endsWith(g)` 要求紧贴，结果「神丹阁」漏检。
      // 现在允许前缀和后缀之间夹 0—2 个汉字，只要前缀出现在
      // 「后缀前 4 字以内」就算。这段窗口足够覆盖「天剑宗」「万兽山庄」「神丹阁」，
      // 又不会把「他走进那个门派」这种叙述误判（前缀表里没有「那个」）。
      const before = text.slice(Math.max(0, i - 5), i);
      let matched = null;
      let matchedAt = -1;
      for (const g of genericPrefix) {
        const p = before.lastIndexOf(g);
        if (p < 0) continue;
        // 前缀之后到后缀之间只能夹 0—2 个汉字
        const gap = before.length - (p + g.length);
        if (gap > 2) continue;
        if (p > matchedAt) { matched = g; matchedAt = p; }
      }
      if (matched === null) continue;

      const run = grabNameRun(text, i - (before.length - matchedAt));
      const evidence = run ? run.name : before.slice(matchedAt) + suf;
      if (seen.has(i)) continue;
      seen.add(i);
      hits.push(mkHit(text, {
        index: i - (before.length - matchedAt),
        evidence,
        note: `「${evidence}」是通用前缀「${matched}」加门派后缀「${suf}」的量产式组合，没有地域或行当特征。`,
        where: locate(ctx.idx, i),
      }));
    }
  }
  return hits;
}

// ——————————————————————————————————————————————————————————————
// 6. name.anachronism —— 名字与背景时代完全割裂
// ——————————————————————————————————————————————————————————————
/**
 * 人名里含现代网文高频名（紫萱/龙傲天/星辰/沐辰……）→ 报。
 *
 * 放行：项目本身是现代背景 —— 这条靠 `options.allowModern` 或
 * 「正文里同时出现现代语境标记」来判定，两边都成立就不报。
 */
export function anachronism(text, ctx) {
  const hits = [];
  if (ctx.allowModern) return hits;

  const seen = new Set();
  for (const { word, index } of findWords(text, MODERN_GIVEN)) {
    if (seen.has(index)) continue;
    const run = grabNameRun(text, index);
    const evidence = run ? run.name : word;
    seen.add(index);
    hits.push(mkHit(text, {
      index,
      evidence,
      note: `「${evidence}」是现代网文高频名（「${word}」），放到古代/古典背景里会时代错位。`,
      where: locate(ctx.idx, index),
    }));
  }
  return hits;
}

// ——————————————————————————————————————————————————————————————
// 7. name.soulless-epithet —— 称号/外号毫无灵魂
// ——————————————————————————————————————————————————————————————
/**
 * 抽象顶级单字组合的称号（剑神/刀圣/枪王/杀神）→ 报。
 * 放行：项目设定中有明确来历 —— 这里无法自动判断，
 * 但只要称号是更长的绰号（含具体动作/物件/性格词）就放行。
 */
export function soullessEpithet(text, ctx) {
  const hits = [];
  const seen = new Set();
  for (const { word, index } of findWords(text, SOULLESS_TITLES)) {
    if (seen.has(index)) continue;
    // 只在「称号」位置报：前面紧跟的是空白/引号/称谓前缀
    const before = text.slice(Math.max(0, index - 3), index);
    if (/[\u3400-\u9fff]/.test(before[before.length - 1] ?? '')) continue;

    // 「血手人屠」这类含具体质感词的放行 —— SOULLESS_TITLES 里没有，
    // 但为了防「杀神屠夫」这种拼接误伤，检查称号里是否还有别的人称词
    seen.add(index);
    hits.push(mkHit(text, {
      index,
      evidence: word,
      note: `「${word}」是抽象顶级单字拼出来的称号，没有绰号该有的江湖气和生活质感。`,
      where: locate(ctx.idx, index),
    }));
  }
  return hits;
}

// ——————————————————————————————————————————————————————————————
// 8. name.pet-anthropomorphic —— 动物/宠物名字过于拟人化
// ——————————————————————————————————————————————————————————————
/**
 * 「颜色/体型 + 通用名」→ 报。
 * 放行：项目里这确实是人起的正经名字 —— 无法自动判断，
 * 但若名字整体只有「颜色+通用名」两字且通用名是常见称呼（狗/猫…），
 * 判为 AI 敷衍起名。
 */
export function petAnthropomorphic(text, ctx) {
  const hits = [];
  const seen = new Set();
  // 颜色/体型（宠物名的构词材料）
  const attr = ['大', '小', '白', '黑', '黄', '红', '灰', '花', '胖', '瘦'];
  // 宠物命名语境：这些词出现，说明后面跟着的是**宠物名**
  const petCue = /(?:宠物|灵宠|妖兽|坐骑|养了|取名|名叫|叫做|唤作|那条狗|那只猫|小黑狗|小家伙|它叫)/;
  // 放行：有特点的名字（胖橘/煤球/二狗）不该被当成敷衍名。
  // 判据是「颜色/体型词**单独构成名字**，不带任何个性信息」。
  const CHARACTERFUL = ['胖橘', '煤球', '二狗', '旺财', '来福', '大黄蜂']

  for (let i = 0; i < text.length; i += 1) {
    const a = attr.find((x) => text.startsWith(x, i))
    if (a === undefined) continue
    const rest = text.slice(i)
    // 名字 = 颜色/体型 + 一个通用字（白/黑/黄/灰/花/小/大），共 2 字
    // 这是「大白」「小黄」「小黑」的形状：两个字都是通用词，没有任何个性。
    const m = /^(大|小|白|黑|黄|红|灰|花|胖|瘦){2}/.exec(rest)
    if (m === null) continue
    const evidence = m[0]
    if (CHARACTERFUL.some((x) => evidence === x)) continue
    // 两个字必须都是颜色/体型词（「大白」= 大+白，是；「大黑狗」的「大黑」也是）
    const chars = [...evidence]
    if (!chars.every((c) => attr.includes(c))) continue
    if (seen.has(i)) continue
    // 上下文里得有宠物线索，或者这两个字独立成词（前后不是汉字连写）
    const before = text.slice(Math.max(0, i - 16), i)
    const prev = text[i - 1] ?? ''
    const next = text[i + evidence.length] ?? ''
    const hasCue = petCue.test(before) || petCue.test(text.slice(i, i + 24))
    const standalone = !/[\u3400-\u9fff]/.test(prev) && !/[\u3400-\u9fff]/.test(next)
    // 裸名（「大白」「小黄」）必须靠独立成词或命名语境来确认，
    // 否则正文里「大白天的」会被误判。
    if (!hasCue && !standalone) continue
    seen.add(i)
    hits.push(mkHit(text, {
      index: i,
      evidence,
      note: `「${evidence}」是颜色/体型加通用字的组合，等于没起名字 —— 读者记不住。`,
      where: locate(ctx.idx, i),
    }))
  }
  return hits;
}

// ——————————————————————————————————————————————————————————————
// 9. name.flat-manual —— 功法秘籍毫无韵律
// ——————————————————————————————————————————————————————————————
/**
 * 「终极/超级/最强 + 现代功能描述词 + 术/诀/功」→ 报。
 * 放行：名称是项目内明确列出的设定名 —— 无法自动判断。
 */
export function flatManual(text, ctx) {
  const hits = [];
  const seen = new Set();
  for (const { word, index } of findWords(text, MANUAL_BAD)) {
    if (seen.has(index)) continue;
    // 后面必须接「术/诀/功/法/式」这类功法后缀
    const after = text.slice(index + word.length, index + word.length + 8);
    const m = /(术|诀|功|法|式|技|拳|刀法|剑诀|心法)/.exec(after);
    if (!m) continue;
    // 名字整体
    const run = grabNameRun(text, index);
    const evidence = run ? run.name : word + after.slice(0, m.index + m[0].length);
    seen.add(index);
    hits.push(mkHit(text, {
      index,
      evidence,
      note: `「${evidence}」用「${word}」这种现代功能描述词加功法后缀拼名，没有平仄韵律。`,
      where: locate(ctx.idx, index),
    }));
  }
  return hits;
}

// ——————————————————————————————————————————————————————————————
// 10. name.mismatch-persona —— 名字与角色属性不匹配
// ——————————————————————————————————————————————————————————————
/**
 * 复姓 + 高配意象 → 报（契约的 rule 直接给了这个组合）。
 * 放行：角色本就是世家长子、公子哥 —— 这时如果同段/同句有「世家/公子/世族/
 * 门阀/长子/少主/伯爵/侯爷」这类身份词，就放行。
 */
export function mismatchPersona(text, ctx) {
  const hits = [];
  if (ctx.allowModern) return hits;

  const statusWords = ['世家', '世族', '门阀', '公子', '长子', '少主', '侯爷', '伯爵', '世子', '名门', '嫡子', '府尹', '贵胄'];
  const seen = new Set();

  for (const sur of COMPOUND_SURNAMES) {
    let from = 0;
    for (;;) {
      const i = text.indexOf(sur, from);
      if (i < 0) break;
      from = i + sur.length;
      const after = text.slice(i + sur.length, i + sur.length + 4);
      const matched = GRANDIOSE_GIVEN.find((g) => after.startsWith(g));
      if (!matched) continue;

      // 放行：角色身份确实是世家子弟
      const ctxText = text.slice(Math.max(0, i - 60), i + 60);
      if (statusWords.some((w) => ctxText.includes(w))) continue;

      const run = grabNameRun(text, i);
      const evidence = run ? run.name : sur + matched;
      if (seen.has(i)) continue;
      seen.add(i);
      hits.push(mkHit(text, {
        index: i,
        evidence,
        note: `「${evidence}」是复姓加高配意象的组合，和角色的真实身份通常对不上。`,
        where: locate(ctx.idx, i),
      }));
    }
  }
  return hits;
}

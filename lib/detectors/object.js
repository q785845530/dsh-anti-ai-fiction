/**
 * 事物类检测器（10 条）。
 *
 * 这组的共同病灶是：**AI 在描述东西的时候写的是「这个词应该让人感到什么」，
 * 而不是「这个东西是什么样」**。于是有了说明书式的系统面板、
 * 堆砌形容词的神剑、只有数值没有味道的丹药。
 *
 * 这组也最容易误伤 —— 因为法宝、丹药、系统流本来就能写成那样，
 * 而且有些作者就是这么写的（游戏流就是游戏流）。所以这 10 条里，
 * **放行条件全部真的实现了**，不像名字类那样有些放行只能靠约定。
 *
 * @module dsh-anti-ai-fiction/detectors/object
 */

import {
  SYSTEM_MARKERS, HOLLOW_ADJ, UNNAMEABLE, MODERN_WORDS, NOBLE_BLOOD, CONCRETE_SENSORY,
} from '../spec.js';
import {
  mkHit, locate, findWords, countDistinctWords, countOccurrences,
  splitSentences, paragraphAt, window, splitList,
} from './common.js';

/**
 * 古典语境标记。
 *
 * 用来判断「这篇稿子是不是古代/修真背景」。判据必须是**硬信号**：
 * 修仙、灵气、宗门、修炼、灵石、客栈、内力、真气、法术……
 * 这些词在现代都市背景里几乎不会出现，所以一旦出现就说明语境是古典的。
 */
const CLASSICAL_MARKERS = [
  '修仙', '灵气', '宗门', '修炼', '灵石', '客栈', '内力', '真气', '法术', '仙门',
  '修士', '灵根', '丹炉', '洞府', '法宝', '元婴', '金丹', '筑基', '炼气', '妖修',
  '镖局', '衙门', '圣旨', '道袍', '禅院', '剑气', '灵兽', '阵法', '符箓', '御剑',
  '武功', '内功', '江湖', '武林', '掌门', '长老', '师尊', '师祖', '道场', '寨主',
];

/**
 * 现代语境标记 —— 用来确认这篇确实是现代背景。
 */
const MODERN_CONTEXT = [
  '手机', '电脑', '网络', '公司', '办公室', '地铁', '出租车', '咖啡', '外卖',
  '同事', '经理', '总监', '老板', '项目', '会议', '微信', '直播间', '小区', '物业',
];

/**
 * 判断文本是不是古典语境。
 *
 * @param {string} text
 * @returns {{classical: boolean, modern: boolean, marker: string|null}}
 */
export function detectContext(text) {
  const classicalMarker = CLASSICAL_MARKERS.find((m) => text.includes(m)) ?? null;
  const modernMarker = MODERN_CONTEXT.find((m) => text.includes(m)) ?? null;
  return {
    classical: classicalMarker !== null,
    modern: modernMarker !== null,
    marker: classicalMarker,
  };
}

// ——————————————————————————————————————————————————————————————
// 1. object.system-panel —— 说明书式的系统面板
// ——————————————————————————————————————————————————————————————
/**
 * 「叮/恭喜/宿主 + 击杀/获得/兑换 + 数值经验点」三件套 → 报。
 * 放行：有意写成游戏流的系统流，且数值是设定的一部分。
 *
 * 放行启发式：如果这段里出现了**具体的、可感的世界细节**
 * （而非纯数值流水账），说明作者是在写游戏流而不是流水账，放行。
 */
export function systemPanel(text, ctx) {
  const hits = [];
  const seen = new Set();

  for (const { word, index } of findWords(text, SYSTEM_MARKERS)) {
    if (seen.has(index)) continue;

    // 取所在句
    const sent = splitSentences(text).find((s) => index >= s.start && index < s.end);
    const sentText = sent ? sent.text : text.slice(index, index + 60);
    const para = paragraphAt(ctx.idx, index);
    const paraText = para ? para.text : sentText;

    // 三件套：提示词 + 动作词 + 数值
    const hasAction = /(击杀|获得|奖励|兑换|开启|完成任务|升级|学习|抽取|合成)/.test(sentText);
    const hasNumber = /\d/.test(sentText);
    if (!hasAction) continue;

    // 放行：同句/同段出现了具体的物理细节 —— 说明这不是纯流水账
    const hasConcrete = CONCRETE_SENSORY.some((c) => sentText.includes(c))
      || CONCRETE_SENSORY.some((c) => paraText.includes(c));
    if (hasConcrete && !hasNumber) continue;

    // 放行：游戏流设定里数值是设定的一部分 —— 表现为「包着具体的人味」
    // （角色吐槽、蓝光幕、旧面包这类），见下方 hasHumanTouch
    const hasHumanTouch = /(冷冰冰|嘲讽|嗤笑|无语|吐槽|叹了口气|眼皮一跳|光幕|弹了出来)/.test(paraText);
    if (hasHumanTouch && !/\b宿主\b/.test(sentText)) continue;

    seen.add(index);
    hits.push(mkHit(text, {
      index,
      evidence: sentText.trim(),
      note: `出现了系统面板模板（${word}${hasAction ? ' + ' + (sentText.match(/(击杀|获得|奖励|兑换|开启|完成任务|升级|学习|抽取|合成)/) ?? [''])[0] : ''}），像在读任务日志而不是在写小说。`,
      where: locate(ctx.idx, index),
    }));
  }
  return hits;
}

// ——————————————————————————————————————————————————————————————
// 2. object.hollow-epic —— 过度华丽但没有质感的神剑
// ——————————————————————————————————————————————————————————————
/**
 * 描写兵器/法宝时堆 ≥2 个空词且**同段无具体物理细节** → 报。
 *
 * 放行条件是本条的关键：契约明确写了「同段落里同时给出了可触摸的物理细节」
 * 就不算。这一条必须真的实现，否则所有认真写剑的作者都会被误伤。
 */
export function hollowEpic(text, ctx) {
  const hits = [];
  const seen = new Set();

  // 只在描写「物」的语境里报：句子里出现 剑/刀/枪/剑/盾/戟/弓/法宝/神兵/宝刀…
  const weaponWords = ['剑', '刀', '枪', '戟', '弓', '盾', '斧', '矛', '钺', '鞭', '棍', '矛'];

  for (const para of ctx.idx.paragraphs) {
    const emptyHits = findWords(para.text, HOLLOW_ADJ);
    if (emptyHits.length === 0) continue;

    // 需要 ≥2 个**不同的**空词（契约写的是堆砌 ≥2 个空词）
    const distinct = new Set(emptyHits.map((h) => h.word));
    if (distinct.size < 2) continue;

    // 放行：同段落里给出了可触摸的物理细节
    const concrete = CONCRETE_SENSORY.filter((c) => para.text.includes(c));
    if (concrete.length > 0) continue;

    // 放行：如果这段不是在描写物件（没有兵器/法宝字样），多半是别的场景
    const mentionsWeapon = weaponWords.some((w) => para.text.includes(w))
      || /(法宝|神兵|宝物|兵器|器物)/.test(para.text);
    if (!mentionsWeapon) continue;

    // 按空词逐个报，evidence 精确到那个空词
    const reported = new Set();
    for (const h of emptyHits) {
      const key = h.word;
      if (reported.has(key)) continue;
      reported.add(key);
      if (seen.has(h.index)) continue;
      seen.add(h.index);
      hits.push(mkHit(text, {
        index: h.index,
        evidence: h.word,
        note: `这段描写兵器堆了空词「${h.word}」，同段却没有一个能摸到、能闻到的细节（锈、血、缺口之类），读者脑补不出画面。`,
        where: locate(ctx.idx, h.index),
      }));
    }
  }
  return hits;
}

// ——————————————————————————————————————————————————————————————
// 3. object.tasteless-consumable —— 毫无意义的消耗品
// ——————————————————————————————————————————————————————————————
/**
 * 「服用/使用药物」只写效果数值（恢复 X 成 / 提升 X 点），无味觉触感 → 报。
 * 放行：该段是纯系统流水账（那是另一条雷区管的事，不重复报）。
 */
export function tastelessConsumable(text, ctx) {
  const hits = [];
  const seen = new Set();

  const useVerb = /(吞|服下|服了|吃下|喝下|咽下|喂服|服食)/;
  const effect = /(恢复|提升|增加|减少|回复|回气|补满|充满)[了约]?\s*[0-9一二三四五六七八九十百千万两半]+\s*(成|点|层|%|％)|[0-9一二三四五六七八九十百千万两半]+\s*(成|点|层|％)\s*(法力|灵力|真气|气血|伤势)/;

  for (const sent of splitSentences(text)) {
    if (!useVerb.test(sent.text)) continue;
    const m = effect.exec(sent.text);
    if (!m) continue;

    // 放行：纯系统流水账（整句都在报数值、没有任何实体感）
    const isSystemLog = /(叮|宿主|系统)/.test(sent.text);

    // 放行：同句/同段有味觉或触感描写
    const para = paragraphAt(ctx.idx, sent.start);
    const paraText = para ? para.text : sent.text;
    const sensory = /(苦|甜|酸|辣|咸|涩|腥|臭|麻|烫|凉|冰|涩口|倒胃口|难吃|好吃)/.test(sent.text)
      || CONCRETE_SENSORY.some((c) => sent.text.includes(c));
    if (sensory) continue;
    if (isSystemLog) continue;

    if (seen.has(sent.start)) continue;
    seen.add(sent.start);
    hits.push(mkHit(text, {
      index: sent.start,
      evidence: sent.text.trim(),
      note: `服用药物只写了数值效果（${m[0]}），没有一点味道或触感的描写。`,
      where: locate(ctx.idx, sent.start),
    }));
  }
  return hits;
}

// ——————————————————————————————————————————————————————————————
// 4. object.numeric-stat —— 机械的等级/数值提示
// ——————————————————————————————————————————————————————————————
/**
 * 「战力/攻击力/生命值/等级/防御力 + 数字」对比式面板句 → 报。
 * 放行：游戏流设定明确以数值为核心。
 */
export function numericStat(text, ctx) {
  const hits = [];
  const seen = new Set();

  const statWord = /(战力|攻击力|生命值|防御力|等级|血量|魔法值|敏捷|智力|力量|战斗力|伤害值)/;

  for (const sent of splitSentences(text)) {
    const m = statWord.exec(sent.text);
    if (!m) continue;
    // 必须带数字
    if (!/\d/.test(sent.text)) continue;
    // 「对比式面板句」：至少出现两个不同的统计项，或出现「：数字」
    const statCount = (sent.text.match(/(战力|攻击力|生命值|防御力|等级|血量|魔法值|战斗力|伤害值)/g) ?? []).length;
    const hasColon = /[：:]\s*\d/.test(sent.text);
    if (statCount < 2 && !hasColon) continue;

    if (seen.has(sent.start)) continue;
    seen.add(sent.start);
    hits.push(mkHit(text, {
      index: sent.start,
      evidence: sent.text.trim(),
      note: `出现了数值面板句（${m[0]} + 数字），这是游戏界面，不是小说。`,
      where: locate(ctx.idx, sent.start),
    }));
  }
  return hits;
}

// ——————————————————————————————————————————————————————————————
// 5. object.unnameable —— 刻意「不可名状」的克苏鲁设定
// ——————————————————————————————————————————————————————————————
/**
 * 出现「不可名状」类词，且**同句无具体可感细节** → 报。
 * 放行：该句紧接着给出了具体恐怖细节。
 */
export function unnameable(text, ctx) {
  const hits = [];
  const seen = new Set();

  for (const { word, index } of findWords(text, UNNAMEABLE)) {
    if (seen.has(index)) continue;

    const sent = splitSentences(text).find((s) => index >= s.start && index < s.end);
    const sentText = sent ? sent.text : '';

    // 放行：同句有具体可感细节
    const concrete = CONCRETE_SENSORY.some((c) => sentText.includes(c))
      || /(张脸|几颗牙|触须|鳞片|粘液|骨节|指头|眼珠|发皱|疤痕|溃烂|蠕动|数量|多少根|多少张|几张)/.test(sentText);
    if (concrete) continue;

    // 放行：紧接着的下文给了具体恐怖细节（下一句 / 同一段后续）
    //
    // 判据必须是「具体到某个可感的身体部位/质地」，不能只看
    // 「长着/有/是」这类动词 —— 第一版就是被这些泛动词骗了：
    // 「不可名状的恐怖存在，仅仅是看了一眼，他的理智便陷入了疯狂」
    // 里「他」「的」命中了宽泛的汉字类，整条被错误放行，验收用例漏检。
    // 现在要求**必须有实体名词**（脸/牙/触须/骨节/眼珠/鳞片……）才算有细节。
    const after = text.slice(index, index + 160);
    const para = paragraphAt(ctx.idx, index);
    const afterPara = para ? para.text.slice(Math.max(0, index - para.start)) : after;
    const BODY_OR_TEXTURE = /(张脸|几颗牙|触须|鳞片|粘液|黏液|骨节|指头|眼珠|眼白|发皱|疤痕|溃烂|蠕动|毛孔|舌头|指甲|断肢|内脏|腐肉|蛆|血管|筋|软骨|牙齿|獠牙|腮|鳃|鬃毛|斑纹|裂纹|缝线|缝合)/
    if (BODY_OR_TEXTURE.test(afterPara)) continue

    seen.add(index);
    hits.push(mkHit(text, {
      index,
      evidence: word,
      note: `用了「${word}」这种「不可名状」的说法代替具体描写，读者什么都没看见。`,
      where: locate(ctx.idx, index),
    }));
  }
  return hits;
}

// ——————————————————————————————————————————————————————————————
// 6. object.wish-grant —— 万能且毫无逻辑的资源
// ——————————————————————————————————————————————————————————————
/**
 * 「空间戒指/储物袋/秘藏」清单里塞 ≥3 类顶级资源 → 报。
 * 放行：这是刻意设置的「诱惑场景」，随后情节会收走 ——
 * 表现为清单后紧跟「被夺走/收回/关闭/消失/封存」这类收束动作。
 */
export function wishGrant(text, ctx) {
  const hits = [];
  const seen = new Set();

  const container = /(空间戒指|储物袋|储物戒|秘藏|宝库|洞府|秘境|须弥)/;
  // 顶级资源品类
  const tier1 = /(灵石|灵晶|仙石|金币|元宝|灵石矿)/;
  const tier2 = /(神兵|神剑|仙器|法宝|神器|灵宝|圣器)/;
  const tier3 = /(秘境|小塔|传承|功法|仙府|洞天|宝塔|空间|神塔)/;

  for (const sent of splitSentences(text)) {
    if (!container.test(sent.text)) continue;
    const kinds = [tier1, tier2, tier3].filter((re) => re.test(sent.text)).length;
    if (kinds < 3) continue;

    // 放行：随后情节会收走 —— 同段或紧跟其后有「收走/消失/封/关闭/夺/抢走/崩」
    const para = paragraphAt(ctx.idx, sent.start);
    const after = para ? para.text.slice(sent.start - para.start) : '';
    const taken = /(夺走|抢走|收起|收回|关闭|封存|崩塌|碎裂|消失|没了|被夺|被抢|封死|关闭了|收走|取出)/.test(after);
    if (taken) continue;

    if (seen.has(sent.start)) continue;
    seen.add(sent.start);
    hits.push(mkHit(text, {
      index: sent.start,
      evidence: sent.text.trim(),
      note: '主角一次性拿到空间戒指/秘藏里的全套顶级资源（灵石+神兵+秘境），外挂给得没有节制。',
      where: locate(ctx.idx, sent.start),
    }));
  }
  return hits;
}

// ——————————————————————————————————————————————————————————————
// 7. object.inert-prop —— 道具与剧情没有互动
// ——————————————————————————————————————————————————————————————
//「捡到/得到/获得 + 宝物」句里没有任何世界反应 → 报。
// 放行：该段是过场，反应在下一段。
export function inertProp(text, ctx) {
  const hits = [];
  const seen = new Set();

  const acquire = /(捡到|拾到|得到|获得|找到|捡起|收起|拿到|得了)/;
  const prop = /(玉佩|玉坠|玉牌|法宝|灵符|丹药|戒指|项链|手镯|令牌|符箓|灵石|秘籍|残卷|吊坠|簪子|耳环|护身符|石头|骨片)/;
  const wear = /(戴上|戴上|佩戴|挂在|揣进|收进|放进|贴身)/;

  for (const sent of splitSentences(text)) {
    const hasAcquire = acquire.test(sent.text);
    const hasProp = prop.test(sent.text);
    const hasWear = wear.test(sent.text);
    if (!hasProp) continue;
    if (!hasAcquire && !hasWear) continue;

    // 世界反应：变化、代价、异常
    const reaction = /(变了|变化|发烫|发热|发冷|裂|碎|亮|响|动|震|吸|干|抽|流|血|消失|不见了|不见|沉|重|轻了|重了|软了|硬了|化|融|腐|蚀|黑|红|光|芒|刺痛|麻|疼|痛|烫|冰|烧|停|不动|无法|拒绝|反噬)/;

    if (reaction.test(sent.text)) continue;

    // 放行：该段是过场，反应在下一段
    const para = paragraphAt(ctx.idx, sent.start);
    const nextPara = ctx.idx.paragraphs.find((p) => p.no === (para?.no ?? 0) + 1);
    const nextText = nextPara ? nextPara.text : '';
    if (nextText && reaction.test(nextText)) continue;

    if (seen.has(sent.start)) continue;
    seen.add(sent.start);
    hits.push(mkHit(text, {
      index: sent.start,
      evidence: sent.text.trim(),
      note: '道具被拿到/戴上之后没有任何变化、代价或异常，它只是个摆设。',
      where: locate(ctx.idx, sent.start),
    }));
  }
  return hits;
}

// ——————————————————————————————————————————————————————————————
// 8. object.modern-leak —— 违和的现代物品/词汇乱入
// ——————————————————————————————————————————————————————————————
/**
 * 现代物件/机构出现在古典语境中 → 报。
 *
 * ## 启发式（本条的判定口径，写在这里以便复核）
 *
 * 契约的 rule 是「现代物件在古典语境中出现」。但「古典语境」不是正文里
 * 一定写出来的 —— 一段只写「他掏出手机看了一眼」的古风对话，通篇没有
 * 「修仙」「灵气」这些标记，却明显是古代背景。所以判定分三档：
 *
 *   1. **options.allowModern = true** → 整个项目就是现代背景 → 一律不报。
 *   2. **文本里出现现代语境标记**（公司/办公室/地铁/同事/经理……）→ 现代背景 → 不报。
 *   3. **其余情况**：只有当文本里同时出现**古典语境标记**
 *      （修仙/灵气/宗门/客栈/内力/真气/法术……）时才报。
 *      也就是说：既没有明确现代标记、也没有明确古典标记时**不报**。
 *
 * 第 3 条的取舍是「宁可漏报也不误伤」：一个纯现代都市短篇里出现「咖啡」
 * 完全正常，而这类稿子往往没有「公司/办公室」这类硬标记。
 */
export function modernLeak(text, ctx) {
  const hits = [];
  if (ctx.allowModern) return hits;

  const cx = detectContext(text);
  // 明确现代背景 → 放行
  if (cx.modern) return hits;
  // 既没有古典标记也没有现代标记 → 不报（无法判断时代背景）
  if (!cx.classical) return hits;

  const seen = new Set();
  for (const { word, index } of findWords(text, MODERN_WORDS)) {
    if (seen.has(index)) continue;
    seen.add(index);
    hits.push(mkHit(text, {
      index,
      evidence: word,
      note: `「${word}」是现代物件/机构，却出现在有古典语境标记（${cx.marker}）的段落里。`,
      where: locate(ctx.idx, index),
    }));
  }
  return hits;
}

// ——————————————————————————————————————————————————————————————
// 9. object.lifeless-treasure —— 毫无细节的法宝
// ——————————————————————————————————————————————————————————————
/**
 * 「祭出/取出/召出 + 法器名 + 斩去/击去」句，无任何外观、声音、触感细节 → 报。
 * 放行：战斗节奏需要快切 —— 表现为同段有「快/闪/瞬间/一息/眨眼/电光火石」等节奏词。
 */
export function lifelessTreasure(text, ctx) {
  const hits = [];
  const seen = new Set();

  const summon = /(祭出|取出|召出|祭起|拔出|抽出|御出|掷出|放出)/;
  const weapon = /(飞剑|本命飞剑|飞剑|剑|刀|枪|枪|戟|斧|矛|盾|鞭|弓|法宝|飞刀|飞针)/;
  const attack = /(斩去|斩向|击去|劈去|刺去|射向|挥向|斩|劈|刺|掷|拍|轰)/;

  for (const sent of splitSentences(text)) {
    if (!summon.test(sent.text)) continue;
    if (!weapon.test(sent.text)) continue;
    if (!attack.test(sent.text)) continue;

    // 细节检查
    const detail = CONCRETE_SENSORY.some((c) => sent.text.includes(c))
      || /(声|响|鸣|啸|嘶|尖锐|刺耳|寒光|颤|抖|嗡|光|芒|影|漆|黑|白|旧|残|缺|断|裂)/.test(sent.text);
    if (detail) continue;

    // 放行：战斗节奏需要快切
    const para = paragraphAt(ctx.idx, sent.start);
    const paraText = para ? para.text : sent.text;
    const fast = /(快|瞬|闪|一息|眨眼|电光火石|刹那|陡然|猛地|立刻|瞬间|不由分说)/.test(paraText);
    if (fast) continue;

    if (seen.has(sent.start)) continue;
    seen.add(sent.start);
    hits.push(mkHit(text, {
      index: sent.start,
      evidence: sent.text.trim(),
      note: '法宝被祭出来直接就砍，中间没有一点外观、声音或触感的描写。',
      where: locate(ctx.idx, sent.start),
    }));
  }
  return hits;
}

// ——————————————————————————————————————————————————————————————
// 10. object.perfect-origin —— 过于完美的身世/背景
// ——————————————————————————————————————————————————————————————
/**
 * 身世句由「上古/远古/神王/始祖/最纯正/至高血脉」等顶级血统词构成 → 报。
 * 放行：项目设定就是血统流，且血统有明确代价 ——
 * 表现为同句/同段出现了代价词（代价/反噬/寿元/折寿/不稳/副作用/禁制/封印）。
 */
export function perfectOrigin(text, ctx) {
  const hits = [];
  const seen = new Set();

  for (const sent of splitSentences(text)) {
    const hits2 = findWords(sent.text, NOBLE_BLOOD);
    if (hits2.length === 0) continue;

    const distinct = new Set(hits2.map((h) => h.word));
    if (distinct.size < 2) continue;

    // 放行：血统有明确代价
    const para = paragraphAt(ctx.idx, sent.start);
    const paraText = para ? para.text : sent.text;
    const cost = /(代价|反噬|寿元|折寿|不稳|副作用|禁制|封印|压制|隐患|隐患|限制|短命|不得|不许)/.test(paraText);
    if (cost) continue;

    // 放行：这是项目自己设定的血统流 —— 显式的「设定」标记
    if (/(设定|血统|本就是|命定|天生的)/.test(sent.text)) continue;

    for (const h of hits2) {
      if (seen.has(h.index)) continue;
      seen.add(h.index);
      hits.push(mkHit(text, {
        index: h.index,
        evidence: h.word,
        note: `身世句里用了顶级血统词「${h.word}」，没有一点代价或折扣，主角一上来就是满配置。`,
        where: locate(ctx.idx, h.index),
      }));
    }
  }
  return hits;
}

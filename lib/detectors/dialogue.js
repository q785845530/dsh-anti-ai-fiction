/**
 * 对话类检测器（10 条）。
 *
 * 台词是 AI 味最集中也最好认的地方 —— 因为**没有人会那样说话**。
 * 现实里没人会在被救之后说「谢谢你救了我」，没人会做自我介绍五件套，
 * 更没人会在拔刀之前先讲一段人生意义。
 *
 * 这组的判据一律落在**引号内的台词**上，而不是整段正文。
 * 这是刻意的：同一段里「他说'你难道不知道吗'」是台词雷区，
 * 而叙述部分「他迟疑了一下」是好的写法，两者不该混为一谈。
 *
 * 判定台词时的粒度是「一条台词」（一对引号之间的内容）。
 *
 * @module dsh-anti-ai-fiction/detectors/dialogue
 */

import { PREACH, RANT, RHETORICAL } from '../spec.js';
import {
  mkHit, locate, extractDialogues, splitSentences, paragraphAt, findWords,
} from './common.js';

/**
 * 取出一条台词前后的叙述部分（引号外的内容）。
 *
 * 「台词前后有没有动作/语气/迟疑的描写」是这组里好几条规则的放行条件，
 * 所以必须能稳定拿到「引号之外的东西」。
 *
 * @param {string} text
 * @param {{start: number, end: number}} dlg
 */
function narrationAround(text, dlg) {
  const before = text.slice(Math.max(0, dlg.start - 120), dlg.start);
  const after = text.slice(dlg.end, dlg.end + 120);
  return { before, after };
}

/**
 * 叙述里有没有「动作 / 语气 / 迟疑」这类身体表演。
 * 这是好几条规则的共同放行条件。
 */
const BEHAVIOR = [
  '说', '道', '问', '答', '喊', '吼', '笑', '哭', '沉默', '顿了顿', '顿住', '迟疑',
  '犹豫', '低头', '抬头', '皱眉', '挑眉', '耸肩', '摊手', '摇头', '点头', '看了',
  '看着', '盯着', '笑', '叹', '哼', '咬牙', '抿', '低声', '轻声', '提高嗓门',
  '声音', '语气', '脸色', '表情', '眼神', '顿了顿', '没说话', '不答', '别过脸',
  '手', '指', '脚', '身', '走', '停', '转身', '退', '扑', '抓', '拍', '推', '拉',
];

/**
 * 一条台词里是否含有动作/语气描写。
 * @param {string} s
 */
function hasBehavior(s) {
  return BEHAVIOR.some((b) => s.includes(b));
}

// ——————————————————————————————————————————————————————————————
// 1. dialogue.self-intro —— 自我剖析式念白
// ——————————————————————————————————————————————————————————————
/**
 * 台词连着交代「姓名 + 年龄 + 身份 + 出身 + 梦想」五件套 → 报。
 *
 * 判定：数台词里同时出现了几类「档案字段」。凑够 4 类才报 ——
 * 因为只有 2—3 项（"我叫林风，今年十八"）是正常自我介绍，不算 AI 味。
 *
 * 放行：角色在对调查/审讯/填表场景，本就该报备 ——
 * 表现为同句/同段出现「登记/报名/档案/审讯/笔录/身份证/入职/登记」。
 */
export function selfIntro(text, ctx) {
  const hits = [];

  const fields = [
    { name: '姓名', re: /(我叫|我是|敝人|在下)[一-龥A-Za-z]{1,4}[，。,\s]|名字叫|名叫/ },
    { name: '年龄', re: /[0-9一二三四五六七八九十百]+岁/ },
    { name: '身份', re: /(是个|乃是|是一名|职业是|身份是)/ },
    { name: '出身', re: /(孤儿|无父无母|没爹没娘|出生在|来自|出身|自幼|从小)/ },
    { name: '梦想', re: /(梦想|理想|目标是|想要成为|想成为|发誓要|立志)/ },
  ];
  const allowCue = /(登记|报名|档案|审讯|笔录|身份证|入职|入籍|报到|登记处|填表|简历|户籍|通关文牒)/;

  for (const dlg of extractDialogues(text)) {
    const q = dlg.quote;
    const found = fields.filter((f) => f.re.test(q));
    if (found.length < 4) continue;

    // 放行：调查/审讯/填表场景
    const para = paragraphAt(ctx.idx, dlg.start);
    const ctxText = (para ? para.text : '') + q;
    if (allowCue.test(ctxText)) continue;

    hits.push(mkHit(text, {
      index: dlg.start,
      evidence: dlg.text,
      note: `台词里一口气交代了${found.map((f) => f.name).join('、')}，像在念个人物档案。`,
      where: locate(ctx.idx, dlg.start),
    }));
  }
  return hits;
}

// ——————————————————————————————————————————————————————————————
// 2. dialogue.exposition —— 设定解说员
// ——————————————————————————————————————————————————————————————
/**
 * 台词出现「自 N 年前 / 历来 / 经过多次 / 最终导致 / 发生了无数次」等史书式结构 → 报。
 * 放行：确实是史官、老师、旁白在讲述。
 */
export function exposition(text, ctx) {
  const hits = [];

  const markers = [
    '自.*年前', '自.*以来', '历来', '历来', '经过多次', '经过多次', '最终导致',
    '最终导致', '发生了无数次', '无数次', '多年来', '一直以来', '自古以来',
    '数百年来', '千年来', '几百年间', '长期以来',
  ];
  const re = new RegExp(`(${markers.join('|')})`);
  const allowCue = /(史官|史书|老师|教师|夫子|讲学|说书| storyteller|历史|古籍|记载|方志|族谱|讲的是|课)/;

  for (const dlg of extractDialogues(text)) {
    const m = re.exec(dlg.quote);
    if (!m) continue;

    // 放行：史官/老师/说书人在讲述
    const para = paragraphAt(ctx.idx, dlg.start);
    const ctxText = (para ? para.text : '') + dlg.quote;
    if (allowCue.test(ctxText)) continue;

    hits.push(mkHit(text, {
      index: dlg.start,
      evidence: dlg.text,
      note: `台词用了史书式叙述结构（${m[0]}），角色在替作者背课文。`,
      where: locate(ctx.idx, dlg.start),
    }));
  }
  return hits;
}

// ——————————————————————————————————————————————————————————————
// 3. dialogue.philosopher —— 全员哲学家
// ——————————————————————————————————————————————————————————————
/**
 * 台词含「人生的意义/内心的平静/追求力量/…」等说教短语 → 报。
 * 放行：角色身份本就是导师/哲人。
 */
export function philosopher(text, ctx) {
  const hits = [];
  const allowCue = /(师父|师傅|师尊|道长|和尚|禅师|先生|导师|教父|智者|老者|道长|道长|圣人|夫子)/;

  for (const dlg of extractDialogues(text)) {
    const found = findWords(dlg.quote, PREACH);
    if (found.length === 0) continue;

    const para = paragraphAt(ctx.idx, dlg.start);
    const ctxText = (para ? para.text : '') + dlg.quote;
    if (allowCue.test(ctxText)) continue;

    hits.push(mkHit(text, {
      index: dlg.start,
      evidence: dlg.text,
      note: `台词里有说教短语「${found[0].word}」，屠夫和反派不会这样讲话。`,
      where: locate(ctx.idx, dlg.start),
    }));
  }
  return hits;
}

// ——————————————————————————————————————————————————————————————
// 4. dialogue.flat-emotion —— 毫无感情的机械反馈
// ——————————————————————————————————————————————————————————————
/**
 * 台词是「谢谢你/不用谢」这类纯功能性应答，且**前后没有任何动作、语气、迟疑的描写** → 报。
 *
 * 关键：放行条件是「前后没有任何动作/语气描写」。
 * 契约的 good 样例里前后有「她看着自己满身的血」「男主转身就走」，全都要算。
 */
export function flatEmotion(text, ctx) {
  const hits = [];

  const functional = [
    '谢谢你', '谢谢', '不用谢', '不客气', '没关系', '不碍事', '好的', '知道了',
    '明白', '行', '嗯', '是啊', '对', '没错', '随便', '都行', '无所谓',
    '对不起', '不好意思', '保重', '一路顺风', '再见',
  ];
  // 功能性应答：句首是功能短语即可，不要求整句只有功能短语。
  // 第一版要求「整句就是一个功能短语」，结果「谢谢你救了我。」漏检 ——
  // 但那正是最典型的 AI 平铺直叙：谢意是功能性的，后面跟个宾语而已。
  const PURE_HEAD = /^(谢谢[你你]*|不用谢|不客气|没关系|不碍事|好的|知道了|明白|行|嗯|是啊|对|没错|随便|都行|无所谓|对不起|不好意思|保重|一路顺风|再见)[。，,.!！?？~]*/

  // 「真正的表演」清单 —— **刻意不包含「说/道/问/答」**。
  //
  // 这是这条规则的关键：`BEHAVIOR` 是好几条规则共用的宽放行表，里面有
  // 「说」「道」「问」「答」，因为对大多数规则来说「他说」算行为。
  // 但对「机械反馈」这条，说话动词**恰恰是病灶**：
  // 「女主满脸感激地说」「男主面无表情地回答」—— 这不是表演，
  // 这是给台词贴标签。用它放行，这条规则就永远不会命中。
  // 所以这里用一份更严的清单，只认身体动作、神态细节、语气变化。
  const REAL_PERFORMANCE = [
    '顿了顿', '顿住', '迟疑', '犹豫', '低头', '抬头', '皱眉', '挑眉', '耸肩',
    '摊手', '摇头', '点头', '别过脸', '转过身', '攥', '捏', '握紧', '松开',
    '抿', '咬', '叹', '哼', '笑', '哭', '沉默', '没说话', '不答', '愣了', '怔',
    '看着', '盯着', '瞥', '扫了一眼', '咽', '深吸', '喘', '手抖', '发白', '发抖',
    '脸色', '眼眶', '声音', '嗓子', '低声', '轻声', '喃喃', '嘟囔',
  ]
  const perform = (s) => REAL_PERFORMANCE.some((b) => s.includes(b))

  for (const dlg of extractDialogues(text)) {
    const q = dlg.quote.trim()
    if (!PURE_HEAD.test(q)) continue
    // 必须确实是「功能短语」而不是碰巧包含
    const hitFn = functional.some((f) => q.includes(f));
    if (!hitFn) continue;

    const { before, after } = narrationAround(text, dlg);
    // 前后有真正的身体表演/神态细节才放行
    if (perform(before) || perform(after)) continue

    hits.push(mkHit(text, {
      index: dlg.start,
      evidence: dlg.text,
      note: '台词是纯功能性应答，前后又没有任何动作、神态或迟疑的描写 —— 只有「某某地说」这种标签，情绪被压平了。',
      where: locate(ctx.idx, dlg.start),
    }));
  }
  return hits;
}

// ——————————————————————————————————————————————————————————————
// 5. dialogue.villain-rant —— 反派废话连篇
// ——————————————————————————————————————————————————————————————
/**
 * 台词含宣判式套板 → 报。
 * 放行：角色是在演讲或宣读罪名。
 */
export function villainRant(text, ctx) {
  const hits = [];
  const allowCue = /(演说|演讲|宣读|宣判|罪状|檄文|宣告|宣示|布道|讲课|仪式|典礼)/;

  for (const dlg of extractDialogues(text)) {
    const found = findWords(dlg.quote, RANT);
    if (found.length === 0) continue;

    const para = paragraphAt(ctx.idx, dlg.start);
    const ctxText = (para ? para.text : '') + dlg.quote;
    if (allowCue.test(ctxText)) continue;

    hits.push(mkHit(text, {
      index: dlg.start,
      evidence: dlg.text,
      note: `台词是宣判式套板（${found[0].word}），反派在动手之前先讲了一段嘴炮。`,
      where: locate(ctx.idx, dlg.start),
    }));
  }
  return hits;
}

// ——————————————————————————————————————————————————————————————
// 6. dialogue.rhetorical —— 强行反问
// ——————————————————————————————————————————————————————————————
/**
 * 台词以「难道/你以为」开头，或含「你真以为/你以为自己」→ 报。
 * 放行：角色本就是靠辩论吃饭的人。
 */
export function rhetorical(text, ctx) {
  const hits = [];
  const allowCue = /(律师|辩手|辩士|辩论|法官|检察官|公诉|庭|审判|讲学|论道|嘴炮)/;

  for (const dlg of extractDialogues(text)) {
    const q = dlg.quote;
    const startsWith = /^[，。！？!?\s]*(难道|你以为)/.test(q);
    const contains = /(你真以为|你以为自己|难道你以为)/.test(q);
    if (!startsWith && !contains) continue;

    const para = paragraphAt(ctx.idx, dlg.start);
    const ctxText = (para ? para.text : '') + q;
    if (allowCue.test(ctxText)) continue;

    hits.push(mkHit(text, {
      index: dlg.start,
      evidence: dlg.text,
      note: startsWith
        ? '台词用「难道/你以为」起头，是 AI 最爱的强行反问。'
        : '台词里出现「你真以为/你以为自己」这类油腻反问。',
      where: locate(ctx.idx, dlg.start),
    }));
  }
  return hits;
}

// ——————————————————————————————————————————————————————————————
// 7. dialogue.exclamation —— 满篇的感叹号
// ——————————————————————————————————————————————————————————————
//「单句台词里感叹号 ≥2 个，或连续多个短句全部以感叹号收尾」→ 报。
// 放行：场景就是狂热欢呼/喊麦。
export function exclamation(text, ctx) {
  const hits = [];
  const allowCue = /(欢呼|喝彩|叫好|呐喊|喊麦|欢呼|振臂|狂吼|口号|应援|啦啦队|欢呼声)/;

  for (const dlg of extractDialogues(text)) {
    const q = dlg.quote;
    const bangs = (q.match(/[！!]/g) ?? []).length;
    if (bangs < 2) continue;

    const para = paragraphAt(ctx.idx, dlg.start);
    const ctxText = (para ? para.text : '') + q;
    if (allowCue.test(ctxText)) continue;

    hits.push(mkHit(text, {
      index: dlg.start,
      evidence: dlg.text,
      note: `一句台词里用了 ${bangs} 个感叹号来代替情绪描写。`,
      where: locate(ctx.idx, dlg.start),
    }));
  }
  return hits;
}

// ——————————————————————————————————————————————————————————————
// 8. dialogue.same-voice —— 所有人说话都像同一个人
// ——————————————————————————————————————————————————————————————
/**
 * 同一段内不同身份的台词长度与句式完全一致，且无人称/语气/用词差异 → 报。
 *
 * 启发式（契约的 rule 本身就写了「启发式」）：
 *   - 取同一段里至少 2 条台词；
 *   - 它们长度相近（差 ≤ 2 字）**且**句式一致（都以标点/称呼结尾的模式相同）；
 *   - 同时全段没有任何第一人称、语气词、身份用词差异。
 *
 * 放行：全场是同一个人在对谈（表现为全段只有一个人称，或全是同一说话人标记）。
 */
export function sameVoice(text, ctx) {
  const hits = [];
  // 身份/口癖标记：出现这些词，说明说话人身份不同，本该有语气差别
  const diffWords = ['我', '你', '您', '咱', '俺', '老子', '咱家', '兄弟', '哥们', '大人', '阁下', '您老', '小的', '属下', '在下']
  // 说话人身份词（叙述里出现，说明是不同角色）
  const ROLE_MARK = ['大佬', '手下', '老大', '师父', '弟子', '老板', '员工', '掌柜', '伙计', '将军', '士兵', '小姐', '丫鬟', '少爷', '管家', '摊贩', '老板']
  // 句末模式的差异（称呼、口头禅）
  const endingPattern = /([一-龥]{2,4})[。！？!?]$/

  for (const para of ctx.idx.paragraphs) {
    const dlgs = extractDialogues(para.text).map((d) => ({
      ...d,
      absStart: para.start + d.start,
    }))
    if (dlgs.length < 2) continue

    const all = para.text
    // 判定「这段里有没有两个不同身份的人」
    //
    // 第一版用「人称词 ≥2 个」当放行条件，结果验收用例
    // 「留着他。」大佬说。「我知道了。」手下说。 里只有「我」一个人称词，
    // 直接被放行 —— 但那恰恰是最典型的千人一面：
    // 大佬和手下说话都是四五个字的标准句，没有任何身份痕迹。
    // 现在改成：**叙述里出现了两个不同身份词**就算「不同人在对话」，
    // 再看他们的台词有没有差别。
    const roles = [...new Set(ROLE_MARK.filter((r) => all.includes(r)))]
    const usedDiff = diffWords.filter((w) => all.includes(w))
    // 至少两个身份词，或两个不同人称词，才算「多人对谈」
    if (roles.length < 2 && usedDiff.length < 2) continue

    // 取长度差异最小的一对
    let pair = null
    for (let i = 0; i < dlgs.length; i += 1) {
      for (let j = i + 1; j < dlgs.length; j += 1) {
        const a = dlgs[i].quote.length
        const b = dlgs[j].quote.length
        const diff = Math.abs(a - b)
        if (diff > 2) continue
        // 「句式一样」的判据不能太窄。
        //
        // 第一版要求两句末 2—4 字完全相同，结果验收用例
        // 「留着他。」vs「我知道了。」（末字完全不同）被漏掉 ——
        // 但它们恰恰是千人一面的典型：两个人说话都是**四五个字的
        // 标准陈述句**，没有任何口癖、省略、身份痕迹。
        //
        // 真正的判据应该是「短、齐、干净」：
        //   - 两句都不长（≤12 字）：长台词天然会有个人语气
        //   - 长度差 ≤2：齐整得可疑
        //   - 都是完整句（有主谓、以句号收尾），没有口语碎片
        // 满足这三条，就是「同一个人写的两句话」。
        const qa = dlgs[i].quote.trim()
        const qb = dlgs[j].quote.trim()
        if (qa.length > 12 || qb.length > 12) continue
        // 任一句里有口语痕迹（语气词/省略/破折号/省略号）就放行 ——
        // 那说明说话人是有个性的
        const ORAL_MARK = /[嘛呗啊呀哇哦唉诶哈嘿哟嘞啦]/;
        const FRAGMENT_MARK = /[—…~～]|\.{2,}/;
        if (ORAL_MARK.test(qa) || ORAL_MARK.test(qb)) continue
        if (FRAGMENT_MARK.test(qa) || FRAGMENT_MARK.test(qb)) continue
        // 两句都必须是「完整陈述句」：以句号/感叹号收尾
        if (!/[。！!]$/.test(qa) || !/[。！!]$/.test(qb)) continue
        if (!pair || diff < pair.diff) pair = { a: dlgs[i], b: dlgs[j], diff }
      }
    }
    if (!pair) continue

    hits.push(mkHit(text, {
      index: pair.a.absStart,
      evidence: pair.a.text,
      note: `同段里「${pair.a.quote.trim()}」和「${pair.b.quote.trim()}」长度与句式几乎一样，两个身份的人说话没有区别。`,
      where: locate(ctx.idx, pair.a.absStart),
    }))
  }
  return hits;
}

// ——————————————————————————————————————————————————————————————
// 9. dialogue.no-subtext —— 缺乏潜台词（字面意思沟通）
// ——————————————————————————————————————————————————————————————
//「纯字面提问 + 纯字面回答」的直接问答对，且无动作、无回避、无转移话题 → 报。
export function noSubtext(text, ctx) {
  const hits = [];

  const question = /[？?]/
  const literalAnswer = /^(是|对|不是|没有|好|好的|嗯|行|当然|可以|不行|别|不知道|知道|因为)/

  // —— 路径 A：字面问答对 ——
  const dlgs = extractDialogues(text)
  for (let i = 0; i < dlgs.length - 1; i += 1) {
    const q = dlgs[i]
    const a = dlgs[i + 1]
    if (!question.test(q.quote)) continue
    if (!literalAnswer.test(a.quote.trim())) continue

    // 前后有没有动作/回避/转移话题
    const { before, after } = narrationAround(text, { start: q.start, end: a.end })
    const mid = text.slice(q.end, a.start)
    if (hasBehavior(before) || hasBehavior(mid) || hasBehavior(after)) continue
    // 有动作插入就说明有潜台词空间
    if (/[一-龥]{2,}/.test(mid.trim()) && !/^[，,\s。]*$/.test(mid)) continue

    hits.push(mkHit(text, {
      index: q.start,
      evidence: q.text,
      note: '一句字面提问配一句字面回答，中间没有任何动作、回避或话外音——所有话都说死了。',
      where: locate(ctx.idx, q.start),
    }))
  }

  // —— 路径 B：单句「把话问穿」的直白提问 ——
  //
  // 验收用例给的是**单句**："你把我叫到办公室来有什么事？是不是想给我升职？"
  // 它没有后续回答，但本身就是典型的「字面沟通」：把心里猜测直接问出口，
  // 不留任何余地。第一版只做了路径 A（问答对），这种单句直接漏检。
  //
  // 判据：一句话里出现 ≥2 个问号（连着追问），且**没有**任何试探/回避的
  // 语言标记（「是不是」「是不是想」「想问」「不知道」这类不算回避，
  // 真正的潜台词是「把话咽回去」或「说半句」）。
  const SUBTEXT_MARK = ['您这是', '我不喜欢自己开口', '顿了顿', '话到嘴边', '欲言又止',
    '没敢说', '咽了回去', '避而不谈', '岔开', '换个话题', '沉默', '没说话',
    '试探着', '犹豫', '迟疑']
  for (const dlg of dlgs) {
    const q = dlg.quote.trim()
    const marks = (q.match(/[？?]/g) ?? []).length
    if (marks < 2) continue
    // 台词里有没有潜台词痕迹
    if (SUBTEXT_MARK.some((m) => q.includes(m))) continue
    // 叙述里有没有动作插入
    const { before, after } = narrationAround(text, dlg)
    if (SUBTEXT_MARK.some((m) => before.includes(m) || after.includes(m))) continue

    // 必须是真的「直白追问」：含「是不是/想/什么」这类把话问穿的词
    if (!/(是不是|想问|什么|为什么|怎么|能不能|要不要)/.test(q)) continue

    hits.push(mkHit(text, {
      index: dlg.start,
      evidence: dlg.text,
      note: '台词连着追问、把心里的猜测直接问出口，没有任何试探或回避——成年人对话不是这样沟通的。',
      where: locate(ctx.idx, dlg.start),
    }))
  }
  return hits;
}

// ——————————————————————————————————————————————————————————————
// 10. dialogue.abrupt-turn —— 极其突兀的拒绝/表白
// ——————————————————————————————————————————————————————————————
//「对不起 + 我不喜欢你/我不爱你 + 理由」的公式化拒绝 → 报。
export function abruptTurn(text, ctx) {
  const hits = [];

  const apology = /(对不起|抱歉|不好意思|对不住|我错了)/;
  const rejection = /(不喜欢你|不爱你|不想跟你|不会跟你|不能跟你|我拒绝|我们不合适|没有感觉)/;
  const reason = /(因为|所以|只是|我只想|我只想搞事业|我更想|我的事业|工作|事业|梦想)/;

  for (const dlg of extractDialogues(text)) {
    const q = dlg.quote;
    const a = apology.exec(q);
    const r = rejection.exec(q);
    if (!a || !r) continue;
    // 「+ 理由」：拒绝之后还带一个解释
    if (!reason.test(q)) continue;

    hits.push(mkHit(text, {
      index: dlg.start,
      evidence: dlg.text,
      note: '拒绝用了「道歉 + 不喜欢 + 理由」的公式三件套，像在填表。',
      where: locate(ctx.idx, dlg.start),
    }));
  }
  return hits;
}

/**
 * 景色维度检测器（10 条）。
 *
 * 景色类是四维里**最容易误报**的一类，因为「阳光」「月亮」「风」这些词在
 * 正常小说里本来就满地都是。所以这一组的写法有个统一原则：
 *
 *   **不是查「有没有这个词」，而是查「有没有脱离人」的写景。**
 *
 * 判据的核心是「人景关系」：
 *   - 景**先于**人出现、且不携带任何人的生理/心理反应 → AI 味（万能开场）
 *   - 景被当成**修辞材料**堆砌（成语、如血、拟人、哭泣）→ AI 味
 *   - 景与人**情绪相反**却没有交代（灭门后看美景心情平复）→ AI 味
 *   - 景被当成**摄影机**平扫（中间/左边/右边）→ AI 味
 *
 * 反过来，只要句子里有人的**具体生理介入**（扎眼、烫、喘不上气、想吐、
 * 手抖、耳鸣），就一律放行 —— 那恰恰是「活人味」的定义。
 *
 * @module dsh-anti-ai-fiction/detectors/scenery
 */
import {
  mkHit, locate, paragraphAt, splitSentences, window, findWords, countDistinctWords,
  splitParagraphs,
} from './common.js'
import {
  WEATHER_CLEICHE, IDIOM_STACK, GENERIC_CITY, BLOOD_SUNSET, WEEPING, PERSONIFY,
  CONCRETE_SENSORY,
} from '../spec.js'

/**
 * 人物「生理介入」的信号词。
 *
 * 这是景色维度最重要的放行清单。判据是：**这句话里有没有一个身体在反应**。
 * 有身体反应，就说明景是被人「感受到」的，不是被 AI「描述」的。
 *
 * 这份清单刻意收得宽 —— 宁可放过，不可错杀。因为把「宿醉后阳光跟刀子
 * 一样扎眼」判成 AI 味，比漏掉十句套话更伤：作者会觉得这工具不懂写作。
 */
const BODY_SIGNAL = [
  '扎眼', '刺眼', '睁不开', '眯眼', '眯起', '晃眼', '晃得',
  '烫', '烤', '冻', '冷得', '热得', '闷得', '喘', '窒息', '喘不过',
  '恶心', '想吐', '呕', '反胃', '干呕',
  '发抖', '打颤', '哆嗦', '手抖', '腿软', '发软', '站不住',
  '耳鸣', '嗡嗡', '头晕', '发晕', '头疼', '头痛', '眼黑', '发黑',
  '汗', '冒汗', '出汗', '冷汗', '湿透',
  '疼', '痛', '麻', '酸', '痒', '硌',
  '咽', '喉咙', '口干', '嘴干', '舔',
  '鼻子', '闻到', '气味', '味道', '腥', '臭', '呛',
  '耳朵', '听见', '吵', '烦', '吵得',
]

/** 心境总结词 —— 和写景贴在一起就是「情绪脱节」。 */
const MOOD_SUMMARY = [
  '心情平复', '心情渐渐', '渐渐平复', '平静下来', '安心', '心安', '感到一丝温暖',
  '感到温暖', '释然', '放下了', '轻松了许多', '舒畅', '愉悦', '心旷神怡',
  '豁然开朗', '心情大好', '心情愉悦', '感到宁静', '内心平静',
]

/** 惨剧信号 —— 用来判定「刚经历创伤却在赏景」。 */
const TRAGEDY = [
  '灭门', '满身是血', '血泊', '尸体', '死了', '惨死', '屠杀', '血洗',
  '断气', '咽气', '坟', '棺', '丧', '灵堂', '披麻戴孝', '逃难', '逃命',
  '伤痕', '重伤', '断臂', '断腿', '残肢',
]

/** 一句话里有没有「身体在反应」。 */
function hasBodySignal(sentence) {
  return BODY_SIGNAL.some((w) => sentence.includes(w))
}

/** 一句话里有没有「具体的、可触摸的物理细节」。 */
function hasConcreteDetail(sentence) {
  return CONCRETE_SENSORY.some((w) => sentence.includes(w))
}

/** 把一段话按句切开，带全局下标。 */
function sentencesWithIndex(text) {
  return splitSentences(text)
}

/**
 * 取某个下标所在的句子。
 * @param {Array} sents
 * @param {number} index
 */
function sentenceContaining(sents, index) {
  return sents.find((s) => index >= s.start && index < s.end) ?? null
}

// ——————————————————————————————————————————————————————————————
// 1. scenery.sunny-opening —— 万能的「阳光明媚」开场
// ——————————————————————————————————————————————————————————————
/**
 * 天气套语出现，且**同句没有人的生理反应介入** → 报。
 *
 * 放行：句子里有身体信号（「宿醉后的阳光跟刀子一样扎眼」就放行）。
 * 这条的放行条件是整组里最关键的 —— 因为「阳光」本身不是罪，
 * 「阳光被当成万能背景板」才是罪。
 */
export function sunnyOpening(text, ctx) {
  const hits = []
  const sents = sentencesWithIndex(text)
  for (const s of sents) {
    const sentence = s.text
    if (!WEATHER_CLEICHE.some((w) => sentence.includes(w))) continue
    // 放行：有身体反应 / 有具体细节
    if (hasBodySignal(sentence)) continue
    if (hasConcreteDetail(sentence)) continue
    const w = WEATHER_CLEICHE.find((x) => sentence.includes(x))
    const at = text.indexOf(w, s.start)
    const hit = mkHit(text, {
      index: at < 0 ? s.start : at,
      evidence: sentence.length <= 60 ? sentence : w,
      note: `「${w}」是万能天气开场，同句里没有任何人的生理反应。景没有被人「感受到」，只是被摆在那里。`,
      where: locate(ctx.idx, s.start),
    })
    if (hit !== null) hits.push(hit)
  }
  return hits
}

// ——————————————————————————————————————————————————————————————
// 2. scenery.idiom-stack —— 堆砌成语和修辞
// ——————————————————————————————————————————————————————————————
/**
 * 一句里叠 ≥2 个四字写景成语，或出现「宛如一幅…画 / 如诗如画 / 美不胜收 /
 * 令人心旷神怡」这类抒情套板 → 报。
 *
 * 放行：同句有身体信号或具体细节（「山全秃了，剩几棵歪脖子树挂着点黑雪」）。
 */
export function idiomStack(text, ctx) {
  const hits = []
  const sents = sentencesWithIndex(text)
  for (const s of sents) {
    const sentence = s.text
    const distinct = countDistinctWords(sentence, IDIOM_STACK)
    const hasPainting = /宛如一幅[^，。！？]{0,6}画|如诗如画|美不胜收|令人心旷神怡/.test(sentence)
    if (distinct < 2 && !hasPainting) continue
    if (hasBodySignal(sentence)) continue
    if (hasConcreteDetail(sentence)) continue
    const w = IDIOM_STACK.find((x) => sentence.includes(x)) ?? (sentence.match(/宛如一幅[^，。！？]{0,6}画|如诗如画|美不胜收|令人心旷神怡/)?.[0])
    const at = w ? text.indexOf(w, s.start) : s.start
    const hit = mkHit(text, {
      index: at < 0 ? s.start : at,
      evidence: sentence.length <= 60 ? sentence : (w ?? sentence.slice(0, 30)),
      note: distinct >= 2
        ? `一句话里堆了 ${distinct} 个写景成语（${IDIOM_STACK.filter((x) => sentence.includes(x)).join('、')}），像中学生作文。`
        : '「宛如一幅画 / 心旷神怡」是抒情套板，没有落到具体画面上。',
      where: locate(ctx.idx, s.start),
    })
    if (hit !== null) hits.push(hit)
  }
  return hits
}

// ——————————————————————————————————————————————————————————————
// 3. scenery.physical-error —— 物理常识错误
// ——————————————————————————————————————————————————————————————
/**
 * 时间与天体冲突 → 报。
 *
 * 判据是「正午/白天」与「圆月/明月/月光/繁星」同时出现在**同一句**里。
 * 放行：句中有超自然设定标记（幻境/结界/秘境/异象/妖/神通/法术），
 * 那可能是刻意写的异象。
 */
export function physicalError(text, ctx) {
  const hits = []
  const sents = sentencesWithIndex(text)
  const DAY = ['正午', '晌午', '中午', '大白天', '白日', '烈日当空', '日头当空']
  const NIGHT_BODY = ['圆月', '明月', '月亮', '月光', '繁星', '星空', '银河', '星辰满天']
  const SUPERNATURAL = ['幻境', '结界', '秘境', '异象', '妖', '神通', '法术', '阵法', '幻术', '天罚', '神迹']
  for (const s of sents) {
    const sentence = s.text
    const day = DAY.find((w) => sentence.includes(w))
    const night = NIGHT_BODY.find((w) => sentence.includes(w))
    if (day === undefined || night === undefined) continue
    if (SUPERNATURAL.some((w) => sentence.includes(w))) continue
    const at = text.indexOf(day, s.start)
    const hit = mkHit(text, {
      index: at < 0 ? s.start : at,
      evidence: sentence.length <= 60 ? sentence : `${day}……${night}`,
      note: `「${day}」和「${night}」出现在同一句里，是随机意象拼接（物理上不可能）。`,
      where: locate(ctx.idx, s.start),
    })
    if (hit !== null) hits.push(hit)
  }
  return hits
}

// ——————————————————————————————————————————————————————————————
// 4. scenery.personification —— 过度拟人化
// ——————————————————————————————————————————————————————————————
/**
 * 景物做人类动作（招手/点头微笑/打招呼/行礼/舞蹈/欢唱）→ 报。
 *
 * 放行：
 *   - 句子里有「像/似的/仿佛」这类**明喻**（那是修辞，不是把树写成人）
 *   - 动作主体其实是人（「她向我招手」）
 *   - 童话语体标记
 */
export function personification(text, ctx) {
  const hits = []
  const sents = sentencesWithIndex(text)
  const SCENERY_SUBJECT = ['树', '大树', '小草', '草', '花', '花儿', '柳', '枝', '叶', '云', '月', '风', '雨', '雪', '山', '河', '水', '星', '太阳', '阳光', '稻', '麦', '海浪', '波浪']
  const SIMILE = ['像', '似的', '仿佛', '如同', '好似', '宛如']
  const FAIRYTALE = ['童话', '精灵', '仙子', '会说话的', '魔法']

  for (const s of sents) {
    const sentence = s.text
    if (FAIRYTALE.some((w) => sentence.includes(w))) continue

    // 逐个动作查，而不是只查「第一个命中的动作」。
    // 「大树在向我们招手，小草在向我们点头微笑」一句里有两个拟人动作，
    // 只看第一个会把后半句漏掉。
    for (const act of PERSONIFY) {
      let from = 0
      for (;;) {
        const actAt = sentence.indexOf(act, from)
        if (actAt < 0) break
        from = actAt + act.length
        const before = sentence.slice(0, actAt)
        // 动作前面最近出现的景物主体
        let scenery = null
        let sceneryPos = -1
        for (const w of SCENERY_SUBJECT) {
          const p = before.lastIndexOf(w)
          if (p > sceneryPos) { scenery = w; sceneryPos = p }
        }
        if (scenery === null) continue
        // 放行：明喻（「树枝摩擦得像鬼叫」是修辞，不是把人写进景里）
        if (SIMILE.some((w) => before.includes(w))) continue
        // 注意：**不再用「人比景更近就放行」这条**。
        // 反例正是验收用例：「大树在向我们招手」——「我们」比「大树」更近，
        // 但主语明明是树，放行就成了漏检。拟人的判据是「景 + 人类动作」，
        // 宾语是不是人（向我们）恰恰是拟人的典型写法。
        const at = s.start + actAt
        const hit = mkHit(text, {
          index: at,
          evidence: sentence.length <= 60 ? sentence : `${scenery}……${act}`,
          note: `把「${scenery}」写成会「${act}」的人，是幼教文学式的过度拟人。`,
          where: locate(ctx.idx, at),
        })
        if (hit !== null) hits.push(hit)
        break
      }
    }
  }
  return hits
}

// ——————————————————————————————————————————————————————————————
// 5. scenery.emotion-detach —— 和剧情/情绪完全脱节
// ——————————————————————————————————————————————————————————————
/**
 * 写景 + 心境总结贴在一起，且**附近有惨剧信号** → 报。
 *
 * 这是景色维度里判据最「重」的一条：它要同时满足
 *   ① 有心境总结词（心情平复/释然/心旷神怡）
 *   ② 同段或前一段有惨剧信号（灭门/满身是血/尸体）
 * 才报。只满足 ① 不报 —— 普通段落里「他释然了」完全正常。
 *
 * 放行：心境总结前有过程交代（几天后/这些年/慢慢/终于）。
 */
export function emotionDetach(text, ctx) {
  const hits = []
  const paras = ctx.idx.paragraphs
  const RECOVERY_PROCESS = ['几天后', '几年后', '这些年', '慢慢', '终于', '过了很久', '时间', '渐渐才', '后来才']

  for (const para of paras) {
    const body = para.text
    const mood = MOOD_SUMMARY.find((w) => body.includes(w))
    if (mood === undefined) continue
    if (RECOVERY_PROCESS.some((w) => body.includes(w))) continue

    // 同段或相邻前一段有惨剧
    const prev = paras.find((p) => p.no === para.no - 1)
    const tragedyHere = TRAGEDY.find((w) => body.includes(w))
    const tragedyPrev = prev === undefined ? undefined : TRAGEDY.find((w) => prev.text.includes(w))
    const tragedy = tragedyHere ?? tragedyPrev
    if (tragedy === undefined) continue

    const at = body.indexOf(mood)
    const abs = para.start + (at < 0 ? 0 : at)
    const hit = mkHit(text, {
      index: abs,
      evidence: body.length <= 80 ? body : mood,
      note: `刚有「${tragedy}」这种创伤，转头就「${mood}」—— 情绪和景完全脱节。AI 不懂人的心理创伤不会这么快平复。`,
      where: locate(ctx.idx, abs),
    })
    if (hit !== null) hits.push(hit)
  }
  return hits
}

// ——————————————————————————————————————————————————————————————
// 6. scenery.weeping-cliche —— 滥用「仿佛在哭泣/预示」
// ——————————————————————————————————————————————————————————————
/**
 * 「老天/上天/苍天/命运 + 在哭/流泪/叹息」→ 报。
 *
 * 放行：句中有反讽标记（冷笑/嗤/讽刺/嘲讽/扯淡）—— 那可能是刻意反着写。
 */
export function weepingCliche(text, ctx) {
  const hits = []
  const sents = sentencesWithIndex(text)
  const IRONY = ['冷笑', '嗤', '讽刺', '嘲讽', '扯淡', '鬼话', '骗鬼']
  for (const s of sents) {
    const sentence = s.text
    const w = WEEPING.find((x) => sentence.includes(x))
    if (w === undefined) continue
    if (IRONY.some((x) => sentence.includes(x))) continue
    const at = text.indexOf(w, s.start)
    const hit = mkHit(text, {
      index: at < 0 ? s.start : at,
      evidence: sentence.length <= 60 ? sentence : w,
      note: `「${w}」是老天替人哭的老套写法，把自然现象直接当情绪旁白。`,
      where: locate(ctx.idx, s.start),
    })
    if (hit !== null) hits.push(hit)
  }
  return hits
}

// ——————————————————————————————————————————————————————————————
// 7. scenery.blood-sunset —— 夕阳/晚霞永远是「如血」
// ——————————————————————————————————————————————————————————————
/**
 * 「残阳如血 / 夕阳如血 / 晚霞如血 / 血色的晚霞」→ 报。
 *
 * 放行：句中同时给了别的具体颜色/质感（紫红/淤青/浑浊/灰），
 * 说明作者其实写了画面，只是顺手带了个套话。
 */
export function bloodSunset(text, ctx) {
  const hits = []
  const sents = sentencesWithIndex(text)
  const OTHER_COLOR = ['紫红', '淤青', '浑浊', '灰', '橙', '橘', '铅', '铁灰', '暗红', '焦黄']
  for (const s of sents) {
    const sentence = s.text
    const w = BLOOD_SUNSET.find((x) => sentence.includes(x))
    if (w === undefined) continue
    if (OTHER_COLOR.some((x) => sentence.includes(x))) continue
    const at = text.indexOf(w, s.start)
    const hit = mkHit(text, {
      index: at < 0 ? s.start : at,
      evidence: sentence.length <= 60 ? sentence : w,
      note: `「${w}」—— AI 对夕阳的认知只有「如血」。这是被写烂的比喻，读不出画面。`,
      where: locate(ctx.idx, s.start),
    })
    if (hit !== null) hits.push(hit)
  }
  return hits
}

// ——————————————————————————————————————————————————————————————
// 8. scenery.panorama —— 每个新场景都要详细写景
// ——————————————————————————————————————————————————————————————
/**
 * 方位词序列罗列陈设（中间/左边/右边/正对着 + 名词）≥3 项 → 报。
 *
 * 放行：同段有气味/声音/温度这类**非视觉**细节（「屋里有股很重的霉味」）。
 * 这是关键放行 —— 真正会写的人用气味破局，而不是靠罗列。
 */
export function panorama(text, ctx) {
  const hits = []
  // 方位词要收「屋子中间**有**一张桌子」这种写法 —— 真实稿子里「中间是」
  // 反而少，「中间有/中间摆着」才是常态。第一版只收「中间是」，
  // 结果验收用例直接漏检。
  const DIRECTIONS = [
    '中间是', '中间有', '中间摆', '中间放', '正中间', '正对着',
    '左边是', '左边有', '左边摆', '左边放', '左侧',
    '右边是', '右边有', '右边摆', '右边放', '右侧',
    '靠墙放着', '靠墙摆', '东边是', '西边是', '南边是', '北边是',
  ]
  const NON_VISUAL = ['霉味', '气味', '味道', '臭味', '腥', '香', '声音', '响', '冷', '热', '潮', '湿', '闷', '暗']

  for (const para of ctx.idx.paragraphs) {
    const body = para.text
    const found = DIRECTIONS.filter((w) => body.includes(w))
    // 去重：同一方位只算一次（「中间有」和「正中间」可能同时命中）
    const distinctDirs = new Set()
    for (const w of found) {
      if (w.startsWith('中间') || w === '正中间' || w === '正对着') distinctDirs.add('mid')
      else if (w.startsWith('左')) distinctDirs.add('left')
      else if (w.startsWith('右')) distinctDirs.add('right')
      else if (w.startsWith('靠墙')) distinctDirs.add('wall')
      else if (w.startsWith('东')) distinctDirs.add('east')
      else if (w.startsWith('西')) distinctDirs.add('west')
      else if (w.startsWith('南')) distinctDirs.add('south')
      else if (w.startsWith('北')) distinctDirs.add('north')
    }
    // 阈值：三个不同方位才算「全景扫描」。
    // 两个方位（「中间是桌，左边是书架」）是正常描写，不该报。
    if (distinctDirs.size < 3) continue
    if (NON_VISUAL.some((w) => body.includes(w))) continue
    const at = body.indexOf(found[0])
    const abs = para.start + (at < 0 ? 0 : at)
    const hit = mkHit(text, {
      index: abs,
      evidence: body.length <= 100 ? body : found.join('……'),
      note: `用 ${distinctDirs.size} 个方位平扫陈设（${found.join('、')}），像全景相机。人进门先闻到的是气味，不是先量尺寸。`,
      where: locate(ctx.idx, abs),
    })
    if (hit !== null) hits.push(hit)
  }
  return hits
}

// ——————————————————————————————————————————————————————————————
// 9. scenery.generic-city —— 缺乏独特视角
// ——————————————————————————————————————————————————————————————
/**
 * 「灯火通明/车水马龙/熙熙攘攘/人来人往/热闹非凡」→ 报。
 *
 * 放行：同段有**具体到某个地点/行业**的细节（大排档/下水道/霓虹灯/田螺），
 * 说明作者其实给了独特视角。
 */
export function genericCity(text, ctx) {
  const hits = []
  const sents = sentencesWithIndex(text)
  const SPECIFIC = ['大排档', '下水道', '霓虹', '田螺', '巷', '弄堂', '天桥', '公交', '站牌', '摊', '招牌', '垃圾桶', '井盖', '电线', '空调外机', '卷帘门']
  for (const s of sents) {
    const sentence = s.text
    const w = GENERIC_CITY.find((x) => sentence.includes(x))
    if (w === undefined) continue
    // 放行：同句或同段有具体地物
    const para = paragraphAt(ctx.idx, s.start)
    const scope = (para?.text ?? '') + sentence
    if (SPECIFIC.some((x) => scope.includes(x))) continue
    const at = text.indexOf(w, s.start)
    const hit = mkHit(text, {
      index: at < 0 ? s.start : at,
      evidence: sentence.length <= 60 ? sentence : w,
      note: `「${w}」是通用城市套语，放到任何一个城市都成立，等于没写。`,
      where: locate(ctx.idx, s.start),
    })
    if (hit !== null) hits.push(hit)
  }
  return hits
}

// ——————————————————————————————————————————————————————————————
// 10. scenery.mechanical-time —— 机械的时间过渡
// ——————————————————————————————————————————————————————————————
/**
 * 「N 天/年后」开头做时间跳跃，且紧跟「此时已经是 + 时间」→ 报。
 *
 * 放行：时间跳跃句里同时交代了**过程代价**（马快累死了/鞋磨破了/干粮吃完了），
 * 那是有质感的过渡。
 */
export function mechanicalTime(text, ctx) {
  const hits = []
  const JUMP = /(?:^|[。！？\n])\s*([0-9一二三四五六七八九十百千半两]+\s*(?:天|日|个月|年|周|个时辰|个月)(?:后|之后|以后|过去))/
  const THEN_TIME = ['此时已经是', '此时已是', '这时已经是', '已是', '已经是']
  const COST = ['累死', '磨破', '吃光', '吃完', '饿', '渴', '断了', '坏了', '用尽', '耗尽', '瘦了', '老了', '伤', '病']

  // 判据跨句：时间跳跃句 + 紧邻的下一句里出现「此时已经是……」。
  // 第一版绑在单句里，但这两半几乎永远被句号切开 —— 验收用例
  // 「三天后，他来到了城外的破庙。此时已经是深夜，月亮高悬。」就是两句。
  // 所以必须看**邻句**。
  const sents = sentencesWithIndex(text)
  for (let i = 0; i < sents.length; i += 1) {
    const sentence = sents[i].text
    const m = JUMP.exec(sentence)
    if (m === null) continue
    // 本句或下一句出现「此时已经是」
    const nextText = sents[i + 1]?.text ?? ''
    const scope = sentence + nextText
    const hasThen = THEN_TIME.some((w) => scope.includes(w))
    if (!hasThen) continue
    if (COST.some((w) => scope.includes(w))) continue
    const at = sents[i].start + (m.index ?? 0) + (m[0].length - m[1].length)
    // 证据取「跳跃句 + 下一句」的原文切片，保证 text.includes 成立。
    const end = sents[i + 1]?.end ?? sents[i].end
    const evidence = text.slice(sents[i].start, end).trim()
    const hit = mkHit(text, {
      index: at < 0 ? sents[i].start : at,
      evidence: evidence.length <= 80 ? evidence : m[1],
      note: `「${m[1].trim()}……此时已经是……」是机械转场，时间跳过去了但人和路没有代价。`,
      where: locate(ctx.idx, sents[i].start),
    })
    if (hit !== null) hits.push(hit)
  }
  return hits
}

/** 本维度的全部检测器（与 spec.js 的 detector 名一一对应）。 */
export const DETECTORS = {
  sunnyOpening,
  idiomStack,
  physicalError,
  personification,
  emotionDetach,
  weepingCliche,
  bloodSunset,
  panorama,
  genericCity,
  mechanicalTime,
}

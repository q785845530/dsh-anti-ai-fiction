/**
 * dsh-anti-ai-fiction — 去 AI 味的**强制指令层**。
 *
 * 这个文件只干一件事：把「AI 味 = 没有活人味」这件事翻译成**可执行的条款**。
 * 它不判断正文，也不自己调模型 —— 它把条款渲染成提示词，交给写作方或改写方。
 *
 * ## 为什么指令要写在这里，而不是散落在提示词里
 *
 * 「终极建议」那份材料如果只写一次、贴在某个提示词末尾，它就只是**建议**。
 * 模型会在字数压力下把它当背景音乐。真正的强制必须满足三点：
 *   1. **条款化** —— 「禁止说明书式设定讲解」是能被检查的，不是「写得有温度一点」；
 *   2. **可失败** —— 明写「做不到就打回重写」，让放弃比硬写更划算；
 *   3. **前置** —— 在动笔**之前**就带上，而不是写完再查。
 *
 * `deai_guard` 就是把这份指令前置到写作入口的工具。
 *
 * ## 词表不硬编码
 *
 * 下面的「禁用套话」清单**全部从 `spec.js` 的词表里取**。原因很实际：
 * 检测器查的是 `spec.js` 里的词，指令里若另抄一份，两边一漂移，
 * 就出现「指令禁的东西检测器不管」——模型白改，检测器还报。
 * 单一事实源必须是 `spec.js`。
 *
 * @module dsh-anti-ai-fiction/prompt
 */
import {
  SPECS, DIMENSIONS,
  WEATHER_CLEICHE, IDIOM_STACK, GENERIC_CITY, BLOOD_SUNSET, WEEPING, PERSONIFY,
  HOLLOW_ADJ, UNNAMEABLE, SYSTEM_MARKERS, MODERN_WORDS, NOBLE_BLOOD, PREACH, RANT,
  RHETORICAL, MANUAL_BAD, VILLAIN_MARKERS, SOULLESS_TITLES,
  CLICHE_SURNAMES, CLICHE_GIVEN, CONCRETE_SENSORY,
} from './spec.js'

/**
 * 取词表里的前 N 项，拼成一行。
 * @param {string[]} list
 * @param {number} [max]
 */
function topWords(list, max = 8) {
  const a = Array.isArray(list) ? list : []
  return a.slice(0, max).join('、')
}

/**
 * 汇总某维度下的全部禁用词条，供指令里按维度点名。
 *
 * 按维度列而不是一次全列，是因为模型对「太长的清单」的遵守率会直线下降。
 * 一次只给当前相关的这一组。
 * @param {string} dim
 */
function bannedByDimension(dim) {
  const specs = SPECS.filter((s) => s.dim === dim)
  const groups = {
    name: [
      ['套路姓氏（须与套路名连用才算命中，单独出现合法）', topWords(CLICHE_SURNAMES, 10)],
      ['套路名字', topWords(CLICHE_GIVEN, 10)],
      ['脸谱化反派称号词', topWords(VILLAIN_MARKERS, 8)],
      ['空洞顶级称号', topWords(SOULLESS_TITLES, 8)],
      ['现代网文名', '紫萱、龙傲天、星辰、沐辰'],
      ['无韵律功法名构词', topWords(MANUAL_BAD, 8)],
    ],
    object: [
      ['系统面板模板', topWords(SYSTEM_MARKERS, 8)],
      ['空洞华丽形容词', topWords(HOLLOW_ADJ, 8)],
      ['不可名状词', topWords(UNNAMEABLE, 6)],
      ['顶级血统词', topWords(NOBLE_BLOOD, 6)],
      ['现代物品/词汇', topWords(MODERN_WORDS, 10)],
    ],
    dialogue: [
      ['说教短语', topWords(PREACH, 8)],
      ['宣判式套板', topWords(RANT, 6)],
      ['强行反问', topWords(RHETORICAL, 4)],
    ],
    scenery: [
      ['天气套语', topWords(WEATHER_CLEICHE, 8)],
      ['抒情成语堆叠', topWords(IDIOM_STACK, 8)],
      ['通用城市套语', topWords(GENERIC_CITY, 8)],
      ['如血夕阳', topWords(BLOOD_SUNSET, 6)],
      ['哭诉拟人', topWords(WEEPING, 6)],
      ['景物拟人动作', topWords(PERSONIFY, 8)],
    ],
  }
  return groups[dim] ?? []
}

/**
 * 强制指令：写作前必须带上的去 AI 味条款。
 *
 * 结构是「总纲 → 六条硬条款 → 判定口径 → 失败处理」。
 * 关键在最后一段：**做不到就打回**。没有这一段，前面所有条款都只是建议。
 *
 * @param {object} [opts]
 * @param {string} [opts.dim] 只针对某维度收紧（写景章就只点名写景那组）
 * @param {string} [opts.chapterNo] 章号
 * @param {number} [opts.wordMin] 字数下限
 * @param {string[]} [opts.keep] 必须保留的东西（人名、伏笔、设定）
 * @param {string} [opts.genre] 题材
 * @returns {string}
 */
export function renderForcedDirective(opts = {}) {
  const dim = DIMENSIONS.find((d) => d.id === opts.dim) ?? null
  const dims = dim ? [dim] : DIMENSIONS

  const lines = []
  lines.push('# 去 AI 味强制指令（写作时必须遵守）')
  lines.push('')
  lines.push('> **AI 味 = 没有活人味。** 不是「辞藻不好」，是「这句话只有模型会写」。')
  lines.push('> 下面每一条都能被机器查出来。查出来就算你违规，不接受「我觉得还行」。')
  lines.push('')

  if (opts.genre) {
    lines.push(`题材：${opts.genre}`)
    lines.push('')
  }
  if (opts.chapterNo !== undefined && opts.chapterNo !== null) {
    lines.push(`当前：第 ${opts.chapterNo} 章${opts.wordMin ? `，正文不少于 ${opts.wordMin} 字` : ''}`)
    lines.push('')
  }

  lines.push('## 六条硬条款')
  lines.push('')
  lines.push('**一、禁止说明书式的设定讲解。**')
  lines.push('任何设定（力量体系、等级、历史、门派规矩）都不许由叙述者或角色「讲出来」。')
  lines.push('不许出现「自 N 年前……」「历来……」「经过多次……最终导致……」这类史书结构。')
  lines.push('设定只能**漏出来**：从角色的抱怨里、从别人的忌讳里、从一件用坏的器物上。')
  lines.push('')
  lines.push('**二、禁止套话。**')
  lines.push('以下是从雷区表里查出来的词，直接不许出现（带人物生理反应介入的除外）：')
  for (const d of dims) {
    const groups = bannedByDimension(d.id)
    if (groups.length === 0) continue
    lines.push('')
    lines.push(`- 【${d.label}】`)
    for (const [label, words] of groups) {
      if (!words) continue
      lines.push(`  - ${label}：${words}`)
    }
  }
  lines.push('')
  lines.push('**三、角色对话禁止长篇大论的自我剖析。**')
  lines.push('角色不许一次性交代「姓名 + 年龄 + 身份 + 出身 + 梦想」五件套；')
  lines.push('不许输出主流价值观（「人生的意义」「内心的平静」「追求力量」「做更好的自己」）；')
  lines.push('反派不许宣判（「你为什么必须死」「这就是你的下场」「我会让你后悔」）；')
  lines.push('不许用反问句开头（「难道……」「你以为……」）。')
  lines.push('**必须带口癖和潜台词**：说话有身份痕迹（大佬说半句、摊贩嘴碎、')
  lines.push('老兵省略主语），意思不直说，让读者自己听出第二层。')
  lines.push('')
  lines.push('**四、写物品必须写出质感，不能只写功能。**')
  lines.push('兵器、法宝、丹药、道具，一律要给出**可触摸的物理细节**：铁锈、霉味、粗糙、')
  lines.push('缺口、油污、发黑发臭的布条、硌手、扎手、粘手、湿。')
  lines.push('不许只写「它很锋利 / 散发着威压 / 令人心悸 / 璀璨夺目」这种读不出画面的空词。')
  lines.push('器物要**对世界有反应**：吸了血、烫了手、掉了一块渣。')
  lines.push('')
  lines.push('**五、写景色必须与人物当下的心理状态形成投射。**')
  lines.push('不许「阳光明媚」式万能开场，不许堆成语，不许全景相机式罗列陈设，')
  lines.push('不许「仿佛老天也在哭泣」，不许「夕阳如血」。')
  lines.push('景要带着**人此刻的生理状态**出现：宿醉后的阳光跟刀子一样扎眼；')
  lines.push('刚经历灭门的人看见油菜花会吐。人和景不对齐，就是**情绪脱节**，一样算违规。')
  lines.push('')
  lines.push('**六、名字与身世要落地。**')
  lines.push('人名带职业、地域、时代印记（楚阳、陈建国、顾小满、张屠），')
  lines.push('不要「林凡」「叶辰」「苏雪」这种量产地名；')
  lines.push('反派名字平静甚至带书卷气（谢三爷、白无常、老佛爷），不要「灭世魔尊」；')
  lines.push('秘籍名要有韵律（《大夏龙雀》《太阴化生经》），不要「终极神剑诀」；')
  lines.push('身世不要「上古神王的转世，拥有最纯正的神族血脉」这种完美血统。')
  lines.push('')

  lines.push('## 判定口径（机器怎么查）')
  lines.push('')
  lines.push(`雷区共 ${SPECS.length} 条，分四维：${DIMENSIONS.map((d) => `${d.label}（${d.hint}）`).join('；')}。`)
  lines.push('每条命中都必须能在原文里指出**哪一句**、**在第几段**。')
  lines.push('指出不出来的，就不算命中。')
  lines.push('')
  lines.push('## 做不到怎么办')
  lines.push('')
  lines.push('**如果这些条款做不到 —— 打回重写，不要交半成品。**')
  lines.push('写不出质感就少写形容词、写动作；写不出潜台词就让人物少说话、去做事；')
  lines.push('写不出名字就换成带职业印记的。')
  lines.push('**交一段自己都过不了检查的稿子，比交白纸更糟** —— 白纸能重写，')
  lines.push('假活人味的稿子会被当成真的写下去。')
  lines.push('')

  if (Array.isArray(opts.keep) && opts.keep.length > 0) {
    lines.push('## 必须保留（不许在改写中丢）')
    lines.push('')
    for (const k of opts.keep) lines.push(`- ${k}`)
    lines.push('')
  }

  return lines.join('\n')
}

/**
 * 章节级自查清单：写作时逐条打勾用的**短清单**。
 *
 * 跟强制指令分开，是因为两者给模型的时机不同：
 * 强制指令是长条款，写之前看；清单是短条目，写完自己过一遍。
 * 混在一起会把清单淹没。
 *
 * @param {object} [opts]
 * @param {string} [opts.dim]
 * @param {number} [opts.wordMin]
 * @param {number} [opts.wordMax]
 * @returns {string}
 */
export function renderChecklist(opts = {}) {
  const dim = DIMENSIONS.find((d) => d.id === opts.dim) ?? null
  const lines = []
  lines.push('# 章节自查清单（写完逐条打勾）')
  lines.push('')
  lines.push('⚠ 只要有一条打不上勾，就是 AI 味。**改不掉就交回重写，不要交半成品。**')
  lines.push('')

  if (opts.wordMin || opts.wordMax) {
    lines.push(`- [ ] 字数在 ${opts.wordMin ?? '不限'}—${opts.wordMax ?? '不限'} 之间（少字也算违规）`)
  }
  lines.push('- [ ] 没有「本章」「伏笔」「爽点」「信息差」这类给作者看的词跑进正文')
  lines.push('- [ ] 没有残留占位符（{xxx} / TODO / XXX）')
  lines.push('- [ ] 结尾是完整句子（引号关、句末有标点）')
  lines.push('')
  lines.push('## 四维速查')
  lines.push('')

  const dims = dim ? [dim] : DIMENSIONS
  for (const d of dims) {
    lines.push(`### ${d.label}`)
    lines.push('')
    for (const s of SPECS.filter((x) => x.dim === d.id)) {
      lines.push(`- [ ] ${s.title} —— ${s.rule}`)
    }
    lines.push('')
  }

  lines.push('## 三条最容易忘的')
  lines.push('')
  lines.push('- [ ] 写物品时，有没有一句能让人**摸到**它？（锈 / 霉味 / 粗糙 / 硌手）')
  lines.push('- [ ] 写景色时，人物的生理状态有没有**投进**景里？')
  lines.push('- [ ] 角色说话时，读者能不能听出**他是谁**、**他没说什么**？')
  lines.push('')
  return lines.join('\n')
}

/**
 * 改写指令模板：给模型执行「只改这些点」时用。
 *
 * 关键约束有两条，都是踩过坑才写上的：
 *   1. **只改列出的点** —— 没说改的地方一个字都不许动（不然模型会顺手重写全篇，
 *      把原本对的地方也改坏）；
 *   2. **不许把活人味改死** —— 去 AI 味最大的失败模式是把句子改得比原来更死：
 *      更短、更抽象、更没有人味。所以要显式给出「保留什么」。
 *
 * @param {object} [opts]
 * @param {Array<{specId?:string,title?:string,evidence?:string,where?:string,fix?:string,good?:string}>} [opts.items] 要改的条目
 * @param {string} [opts.text] 待改写正文
 * @param {string[]} [opts.keep] 必须保留
 * @param {number} [opts.wordMin]
 * @param {boolean} [opts.rework] true = 打回重写模式（不是局部改写）
 * @returns {string}
 */
export function renderRewritePrompt(opts = {}) {
  const items = Array.isArray(opts.items) ? opts.items : []
  const rework = opts.rework === true
  const lines = []

  lines.push(rework
    ? '# 打回重写指令（不是润色，是重写）'
    : '# 去 AI 味改写指令')
  lines.push('')
  lines.push('ROLE: deai_rewriter')
  lines.push('')

  if (rework) {
    lines.push('## 为什么是重写而不是润色')
    lines.push('')
    lines.push('这份稿子命中的重灾区太多，逐句修补会把 AI 味揉进句子的骨头里，')
    lines.push('改完还是不像人写的。**所以请重写命中的部分，保留其余部分。**')
    lines.push('')
  }

  lines.push('## 只改这些点')
  lines.push('')
  lines.push('**下面没列出来的句子，一个字都不许动。**')
  lines.push('（模型最常见的事故：顺手重写全篇，把原本对的地方也改坏。）')
  lines.push('')

  if (items.length === 0) {
    lines.push('（没有列出具体命中项 —— 若非如此，说明这一稿整体结构有问题，')
    lines.push('应按「重写整章」处理，而不是逐句打磨。）')
    lines.push('')
  } else {
    items.forEach((it, i) => {
      lines.push(`### ${i + 1}. ${it.title ?? it.specId ?? '（未命名雷区）'}${it.specId ? `　[${it.specId}]` : ''}`)
      lines.push('')
      if (it.where) lines.push(`- **位置**：${it.where}`)
      if (it.evidence) lines.push(`- **原文**：${it.evidence}`)
      if (it.why) lines.push(`- **病理**：${it.why}`)
      if (it.fix) lines.push(`- **改成什么样**：${it.fix}`)
      if (it.good) lines.push(`- **活人味示范**：${it.good}`)
      lines.push('')
    })
  }

  lines.push('## 必须保留')
  lines.push('')
  const keep = Array.isArray(opts.keep) ? opts.keep : [
    '人名与称呼的一致性（改了名字的读法要全篇一起改）',
    '已埋的伏笔与已交代的设定',
    '情节走向与人物行为动机',
  ]
  for (const k of keep) lines.push(`- ${k}`)
  if (opts.wordMin) lines.push(`- 字数下限 ${opts.wordMin} 字（改写后不得低于下限）`)
  lines.push('')

  lines.push('## 不许把活人味改死（这条最重要）')
  lines.push('')
  lines.push('去 AI 味最常见的失败不是没改，是**改过头**：')
  lines.push('- 不许把句子统一改成短句 —— 短句不等于人味，长短交错才是；')
  lines.push('- 不许把所有描写抽象化（把「铁锈、霉味」换成「岁月的气息」）；')
  lines.push('- 不许把人物的话改成同一种语气；')
  lines.push('- 不许删掉原本活生生的细节去「提纯」；')
  lines.push('- 不许为了让句子漂亮而加修辞。')
  lines.push('')
  lines.push('**判断标准**：改完之后，人读起来应该觉得「这人写的」，而不是「这人在避免写错」。')
  lines.push('')

  if (opts.text) {
    lines.push('## 待改写正文')
    lines.push('')
    lines.push('```')
    lines.push(opts.text)
    lines.push('```')
    lines.push('')
  }

  lines.push('## 交付')
  lines.push('')
  lines.push('1. 输出改写后的**完整正文**（不是片段，不是 diff 说明）；')
  lines.push('2. 另附一份清单：每条命中 → 改成了什么（一句话即可）；')
  lines.push('3. 改完自己再过一遍上面那份章节自查清单，打不上的勾**如实写出来**，')
  lines.push('   不要假装全过 —— 假过的稿子会被当成真的写下去。')
  lines.push('')

  return lines.join('\n')
}

/**
 * 完整规则清单：`deai_rules` 工具用。
 *
 * 只列规则，不查文本 —— 想读全部雷区的人看这个。
 * @returns {string}
 */
export function renderRulesDigest() {
  const lines = []
  lines.push('# 40 条 AI 味雷区（四维）')
  lines.push('')
  lines.push(`打回阈值：命中 **block 级**（重灾区）达到 ${SPECS.filter((s) => s.severity === 'block').length} 条中的任意 3 条 → 拒绝润色，要求打回重写。`)
  lines.push('')
  lines.push('## 放行条件总纲')
  lines.push('')
  lines.push('每条雷区都带「放行条件」—— 同样的特征在什么情况下是合法的。')
  lines.push('**一刀切报 AI 味会把正常稿子打成筛子**，所以放行条件不是可选项。')
  lines.push('')
  for (const d of DIMENSIONS) {
    lines.push(`## ${d.label}（${d.hint}）`)
    lines.push('')
    for (const s of SPECS.filter((x) => x.dim === d.id)) {
      lines.push(`### ${s.no}. ${s.title}　\`${s.id}\``)
      lines.push('')
      lines.push(`- **判据**：${s.rule}`)
      lines.push(`- **为什么是 AI 味**：${s.why}`)
      lines.push(`- **级别**：${s.severity === 'block' ? '🔴 打回重写' : '🟡 建议改'}`)
      lines.push(`- **放行**：${s.allow}`)
      lines.push(`- **修复方向**：${s.fix}`)
      lines.push('')
    }
  }
  lines.push('## 可感细节参考（写物品时用）')
  lines.push('')
  lines.push(`可用词：${topWords(CONCRETE_SENSORY, 40)}`)
  lines.push('')
  return lines.join('\n')
}

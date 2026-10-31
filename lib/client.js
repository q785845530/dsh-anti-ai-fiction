/**
 * dsh-anti-ai-fiction — browser half（手写 ModuleLoader bundle，无构建步骤）。
 *
 * 设置页里加一项「反AI味」，右侧是一个**扫雷工作台**：
 *   - 输入区：粘贴待检正文 + 四个维度的筛选开关
 *   - 判定区：最显眼的位置给出「能不能过」这一句结论
 *   - 命中清单：逐条列出雷区、原文证据、定位、病理分析、修复方向、放行条件
 *   - 规则手册：40 条雷区的可折叠全文（判据 + 放行条件）
 *   - 复制：命中清单 / 去AI味强制指令
 *
 * 数据走同源 `/api/dsh-anti-ai-fiction/*`（由 host 半提供），只用 shell 已经
 * 提供的 `react`，不依赖任何构建产物。颜色全部取自主题变量，明暗主题都不会坏。
 *
 * 一个刻意的取舍：**判定不靠颜色**。三档结论都带图标 + 文字标签
 * （✕ 打回重写 / △ 建议修改 / ○ 通过），色盲用户和深浅色主题都能分辨。
 * 这是质检工具，结论读错比读不出来更糟。
 */
window.__ModuleLoader__.load({
  id: 'dsh-anti-ai-fiction',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports

    const React = require('react')
    const { createElement: h, useState, useEffect, useCallback, useMemo } = React

    const NS = 'dsh-anti-ai-fiction'

    /**
     * 四个维度。顺序与 spec.js 的 DIMENSIONS 一致（名字/事物/对话/景色）。
     *
     * 这里写死一份，是为了让面板**在接口还没好的时候也能显示筛选开关** ——
     * 维度 id 与后端 spec.js 同名，不会对不上。
     */
    const DIMS = [
      { id: 'name', label: '名字', hint: '人名、称号、组织名、功法名、宠物名的套路化' },
      { id: 'object', label: '事物', hint: '道具、法宝、系统面板、消耗品的说明书式描写' },
      { id: 'dialogue', label: '对话', hint: 'NPC 式念白：自我剖析、设定解说、缺潜台词' },
      { id: 'scenery', label: '景色', hint: '脱离心境的写景：套话开场、全景相机、机械过渡' },
    ]
    const DIM_LABEL = Object.fromEntries(DIMS.map((d) => [d.id, d.label]))

    /**
     * 打回阈值。后端 spec 里是 BLOCK_THRESHOLD = 3；这里也写一份作为**兜底**，
     * 因为接口可能还没上线（那时整个判定区都该降级，而不是给个错的结论）。
     */
    const BLOCK_THRESHOLD = 3

    /** 处置等级 → 展示信息（图标 + 文字 + 颜色类）。 */
    const SEVERITY_META = {
      block: { label: '打回重写', icon: '✕', cls: 'daif_sev_block' },
      warn: { label: '建议修改', icon: '△', cls: 'daif_sev_warn' },
    }

    // ————————————————————————— 样式 —————————————————————————

    const STYLES = `
.daif_root { display:flex; flex-direction:column; gap:12px; font-size:13px; }
.daif_shell { display:flex; flex-direction:column; gap:10px; }
.daif_head {
  display:flex; gap:10px; align-items:center; flex-wrap:wrap;
  padding-bottom:8px; border-bottom:1px solid var(--dsh-border, rgba(128,128,128,.25));
}
.daif_headText { flex:1 1 auto; min-width:0; }
.daif_title { font-size:15px; font-weight:600; }
.daif_subtitle { font-size:11px; opacity:.62; margin-top:1px; }
.daif_body { display:flex; flex-direction:column; gap:12px; }

/* —— 输入区 —— */
.daif_inputbox {
  border:1px solid var(--dsh-border, rgba(128,128,128,.25)); border-radius:8px;
  padding:9px 11px; display:flex; flex-direction:column; gap:8px;
  background:var(--dsh-surface, rgba(128,128,128,.04));
}
.daif_area {
  border:1px solid var(--dsh-border, rgba(128,128,128,.35));
  background:var(--dsh-surface, rgba(128,128,128,.06)); color:inherit;
  border-radius:6px; padding:8px 10px; font-size:12px; width:100%; box-sizing:border-box;
  font-family:inherit; line-height:1.7; min-height:180px; resize:vertical;
}
.daif_area:focus { outline:none; border-color:var(--dsh-accent, #4a7dff); }
.daif_row { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
.daif_dimtoggles { display:flex; gap:5px; flex-wrap:wrap; align-items:center; }
.daif_dimtoggle {
  display:inline-flex; gap:5px; align-items:center; cursor:pointer;
  border:1px solid var(--dsh-border, rgba(128,128,128,.3));
  background:var(--dsh-surface, rgba(128,128,128,.07));
  border-radius:14px; padding:2px 10px; font-size:11px; user-select:none;
}
.daif_dimtoggle:hover { background:var(--dsh-surface-hover, rgba(128,128,128,.16)); }
.daif_dimtoggle[data-on="1"] {
  border-color:var(--dsh-accent, #4a7dff);
  background:color-mix(in srgb, var(--dsh-accent, #4a7dff) 16%, transparent);
  font-weight:600;
}
.daif_dimtoggle input { margin:0; }
.daif_btn {
  border:1px solid var(--dsh-border, rgba(128,128,128,.35));
  background:var(--dsh-surface, rgba(128,128,128,.08)); color:inherit;
  border-radius:6px; padding:4px 10px; font-size:12px; cursor:pointer;
}
.daif_btn:hover:not(:disabled) { background:var(--dsh-surface-hover, rgba(128,128,128,.16)); }
.daif_btn:disabled { opacity:.45; cursor:not-allowed; }
.daif_btn_primary { border-color:var(--dsh-accent, #4a7dff); }
.daif_btn_danger { border-color:#e05a5a; }
.daif_note { font-size:11px; opacity:.65; line-height:1.6; }
.daif_err {
  border:1px solid rgba(224,90,90,.45); border-radius:7px; padding:8px 11px;
  background:rgba(224,90,90,.08); font-size:12px; line-height:1.6;
  display:flex; flex-direction:column; gap:4px;
}
.daif_errHead { font-weight:600; }
.daif_errHint { font-size:11px; opacity:.8; }

/* —— 判定区（放最显眼） —— */
.daif_verdict {
  border:2px solid var(--dsh-border, rgba(128,128,128,.3)); border-radius:10px;
  padding:12px 15px; display:flex; flex-direction:column; gap:7px;
  background:var(--dsh-surface, rgba(128,128,128,.05));
}
.daif_verdict.v_block {
  border-color:rgba(224,90,90,.75);
  background:rgba(224,90,90,.10);
}
.daif_verdict.v_warn {
  border-color:rgba(224,144,42,.7);
  background:rgba(224,144,42,.09);
}
.daif_verdict.v_pass {
  border-color:rgba(63,164,106,.7);
  background:rgba(63,164,106,.09);
}
.daif_verdictHead { display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
.daif_verdictIcon { font-size:22px; line-height:1; font-weight:700; }
.daif_verdict.v_block .daif_verdictIcon { color:#e05a5a; }
.daif_verdict.v_warn .daif_verdictIcon { color:#e0902a; }
.daif_verdict.v_pass .daif_verdictIcon { color:#3fa46a; }
.daif_verdictText { font-size:17px; font-weight:700; letter-spacing:.02em; }
.daif_verdictWhy { font-size:12px; line-height:1.65; opacity:.9; }
.daif_verdictStats { display:flex; gap:8px; flex-wrap:wrap; margin-top:2px; }
.daif_stat {
  border:1px solid var(--dsh-border, rgba(128,128,128,.25)); border-radius:6px;
  padding:4px 11px; display:flex; flex-direction:column; align-items:center; min-width:66px;
  background:var(--dsh-surface, rgba(128,128,128,.05));
}
.daif_stat .n { font-size:16px; font-weight:700; }
.daif_stat .k { font-size:10px; opacity:.65; }

/* —— 命中清单 —— */
.daif_hits { display:flex; flex-direction:column; gap:5px; }
.daif_hit {
  border:1px solid var(--dsh-border, rgba(128,128,128,.25)); border-radius:7px;
  background:var(--dsh-surface, rgba(128,128,128,.04));
  overflow:hidden;
}
.daif_hit.sev_block { border-left:3px solid #e05a5a; }
.daif_hit.sev_warn { border-left:3px solid #e0902a; }
.daif_hitHead {
  display:flex; gap:8px; align-items:center; flex-wrap:wrap;
  padding:6px 10px; cursor:pointer;
}
.daif_hitHead:hover { background:var(--dsh-surface-hover, rgba(128,128,128,.14)); }
.daif_hitTitle { font-size:13px; font-weight:600; flex:1 1 auto; min-width:0; }
.daif_caret { opacity:.55; font-size:11px; }
.daif_tag {
  font-size:10px; padding:0 6px; border-radius:9px; white-space:nowrap;
  border:1px solid var(--dsh-border, rgba(128,128,128,.3));
  background:var(--dsh-surface, rgba(128,128,128,.08));
}
.daif_tag.dim { border-color:var(--dsh-accent, #4a7dff); color:var(--dsh-accent, #4a7dff); }
.daif_tag.sev_block { border-color:#e05a5a; color:#e05a5a; }
.daif_tag.sev_warn { border-color:#e0902a; color:#e0902a; }
.daif_hitBody {
  padding:8px 11px 11px 11px; display:flex; flex-direction:column; gap:7px;
  border-top:1px dashed var(--dsh-border, rgba(128,128,128,.25));
}
.daif_evidence {
  font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size:12px; line-height:1.7; white-space:pre-wrap; word-break:break-word;
  background:color-mix(in srgb, var(--dsh-accent, #4a7dff) 12%, var(--dsh-surface, rgba(128,128,128,.06)));
  border:1px solid color-mix(in srgb, var(--dsh-accent, #4a7dff) 35%, transparent);
  border-radius:6px; padding:7px 10px; margin:0;
}
.daif_field { display:flex; flex-direction:column; gap:2px; }
.daif_label {
  font-size:11px; font-weight:600; opacity:.7;
  display:flex; gap:6px; align-items:center;
}
.daif_label .tag { font-weight:400; }
.daif_text { font-size:12px; line-height:1.7; opacity:.92; }
.daif_text.fix { border-left:3px solid rgba(63,164,106,.65); padding-left:8px; }
.daif_text.allow { border-left:3px solid rgba(128,128,128,.55); padding-left:8px; opacity:.82; }

/* —— 规则手册 —— */
.daif_manual { display:flex; flex-direction:column; gap:8px; }
.daif_manual summary {
  cursor:pointer; font-size:13px; font-weight:600; padding:6px 2px;
  list-style:revert;
}
.daif_manualspec {
  border:1px solid var(--dsh-border, rgba(128,128,128,.22)); border-radius:6px;
  padding:7px 10px; display:flex; flex-direction:column; gap:3px;
  background:var(--dsh-surface, rgba(128,128,128,.035));
}
.daif_manualspecHead { display:flex; gap:7px; align-items:center; flex-wrap:wrap; font-size:12px; }
.daif_manualspecNo {
  font-family:ui-monospace,monospace; font-size:10px; opacity:.6;
  min-width:22px; text-align:center;
}
.daif_manualspecTitle { font-weight:600; }
.daif_manualspecRule { font-size:11px; line-height:1.65; opacity:.85; }
.daif_manualspecAllow { font-size:11px; line-height:1.6; opacity:.68; }
.daif_manualspecFix { font-size:11px; line-height:1.6; opacity:.72; }

/* —— 复制输出 —— */
.daif_pre {
  font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size:11px; line-height:1.6; white-space:pre-wrap; word-break:break-word;
  background:var(--dsh-surface, rgba(128,128,128,.07)); border-radius:6px;
  padding:9px 11px; max-height:34vh; overflow:auto; margin:0;
  border:1px solid var(--dsh-border, rgba(128,128,128,.2));
}
.daif_toast {
  position:fixed; right:20px; bottom:20px; z-index:9999; max-width:420px;
  border:1px solid var(--dsh-border, rgba(128,128,128,.35)); border-radius:8px;
  background:var(--dsh-surface, #2a2a2e); color:inherit; padding:11px 14px;
  font-size:13px; line-height:1.5; box-shadow:0 6px 24px rgba(0,0,0,.28); white-space:pre-wrap;
}
.daif_toast.ok { border-left:3px solid #3fa46a; }
.daif_toast.err { border-left:3px solid #e05a5a; }
@media (max-width: 760px) {
  .daif_verdictText { font-size:15px; }
  .daif_stat { min-width:56px; padding:3px 8px; }
}
`

    // ————————————————————————— 小工具 —————————————————————————

    /**
     * 调后端。
     *
     * 三层容错：网络异常、非 JSON 响应、业务错误，全都要变成一句人话。
     * 这个面板是「粘贴正文 → 点按钮」的一次性动作，崩了用户就没法用，
     * 所以宁可显示「后端没上线」也不要白屏。
     */
    async function api(path, payload) {
      const init = payload === undefined
        ? { cache: 'no-store' }
        : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }
      let res
      try {
        res = await fetch(`/api/dsh-anti-ai-fiction${path}`, init)
      } catch (err) {
        throw new Error(`无法连接 DSH 主机：${err?.message ?? String(err)}`)
      }
      let data = null
      try { data = await res.json() } catch { /* 非 JSON */ }
      if (data === null) {
        if (res.status === 404) throw new Error('后端接口还没上线（HTTP 404）')
        throw new Error(`请求失败（HTTP ${res.status}）`)
      }
      // 后端有时用 { error } 有时用 { reason }，两个都认
      if (data.error) throw new Error(String(data.error))
      if (data.ok === false && data.reason) throw new Error(String(data.reason))
      return data
    }

    /** 复制到剪贴板。navigator.clipboard 在非 HTTPS 下可能没有 —— 那就退回老办法。 */
    async function copyText(text) {
      if (text === '' || text === undefined || text === null) return false
      try {
        if (navigator?.clipboard?.writeText !== undefined) {
          await navigator.clipboard.writeText(text)
          return true
        }
      } catch { /* 落回 execCommand */ }
      try {
        const ta = document.createElement('textarea')
        ta.value = text
        ta.setAttribute('readonly', '')
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        const ok = document.execCommand('copy')
        document.body.removeChild(ta)
        return ok
      } catch { return false }
    }

    function Toast({ toast, onDone }) {
      useEffect(() => {
        if (toast === null) return undefined
        const t = setTimeout(() => onDone(), 5000)
        return () => clearTimeout(t)
      }, [toast, onDone])
      if (toast === null) return null
      return h('div', { className: `daif_toast ${toast.ok ? 'ok' : 'err'}` }, toast.text)
    }

    /** 小统计块。 */
    function Stat({ n, k }) {
      return h('div', { className: 'daif_stat' },
        h('div', { className: 'n' }, String(n ?? '—')),
        h('div', { className: 'k' }, k))
    }

    // ————————————————————————— 命中行 —————————————————————————

    /**
     * 一条命中的稳定标识。
     *
     * 优先用后端给的 id（若命中带 id 字段）；没有就退回「雷区 id + 定位 + 证据首段」。
     * 同一条雷区在正文里可能命中多次，所以要带上定位才区分得开。
     */
    function hitKey(hit, i) {
      const base = hit.id ?? hit.specId ?? hit.title ?? `hit-${i}`
      const where = hit.where !== undefined && hit.where !== null ? String(hit.where) : ''
      const ev = hit.evidence !== undefined && hit.evidence !== null ? String(hit.evidence).slice(0, 40) : ''
      return `${base}||${where}||${ev}`
    }

    /**
     * 一条命中。默认折叠，点了展开看证据与诊断。
     *
     * 折叠态也要能一眼看出「哪条雷、在哪一段」—— 否则四十条铺开根本没法用。
     */
    function HitRow({ hit, open, onToggle }) {
      const sev = hit.severity === 'block' ? 'block' : 'warn'
      const sevMeta = SEVERITY_META[sev]
      const dimLabel = DIM_LABEL[hit.dim] ?? hit.dim ?? '—'
      return h('div', { className: `daif_hit sev_${sev}` },
        h('div', { className: 'daif_hitHead', onClick: onToggle, title: open ? '收起' : '展开' },
          h('span', { className: 'daif_caret' }, open ? '▾' : '▸'),
          h('span', { className: 'daif_hitTitle' }, hit.title ?? hit.specId ?? '（无标题）'),
          h('span', { className: 'daif_tag dim' }, dimLabel),
          h('span', { className: `daif_tag sev_${sev}` }, `${sevMeta.icon} ${sevMeta.label}`),
          hit.where !== undefined && hit.where !== null && hit.where !== ''
            ? h('span', { className: 'daif_tag' }, hit.where)
            : null),
        open
          ? h('div', { className: 'daif_hitBody' },
            hit.evidence !== undefined && hit.evidence !== null && hit.evidence !== ''
              ? h('div', { className: 'daif_field' },
                h('div', { className: 'daif_label' }, '原文证据'),
                h('pre', { className: 'daif_evidence' }, String(hit.evidence)))
              : null,
            hit.note !== undefined && hit.note !== null && hit.note !== ''
              ? h('div', { className: 'daif_field' },
                h('div', { className: 'daif_label' }, '病理分析'),
                h('div', { className: 'daif_text' }, String(hit.note)))
              : null,
            hit.fix !== undefined && hit.fix !== null && hit.fix !== ''
              ? h('div', { className: 'daif_field' },
                h('div', { className: 'daif_label' }, '活人味修复方向'),
                h('div', { className: 'daif_text fix' }, String(hit.fix)))
              : null,
            hit.allow !== undefined && hit.allow !== null && hit.allow !== ''
              ? h('div', { className: 'daif_field' },
                h('div', { className: 'daif_label' },
                  '放行条件',
                  h('span', { className: 'daif_tag' }, '什么情况下这条不算问题')),
                h('div', { className: 'daif_text allow' }, String(hit.allow)))
              : null,
            hit.rule !== undefined && hit.rule !== null && hit.rule !== ''
              ? h('div', { className: 'daif_field' },
                h('div', { className: 'daif_label' }, '判据'),
                h('div', { className: 'daif_text' }, String(hit.rule)))
              : null)
          : null)
    }

    // ————————————————————————— 规则手册 —————————————————————————

    /**
     * 40 条雷区手册（可折叠）。
     *
     * 数据来自 `GET /api/dsh-anti-ai-fiction/spec`。接口没上线时**不假装有**：
     * 显示一句「规则手册还没加载」，而不是拿本地硬编一份 40 条 ——
     * 那会让两份契约各说各话，比没有更糟。
     */
    function SpecManual({ spec, specErr, onRetry }) {
      const specs = spec?.specs ?? null
      const threshold = spec?.threshold ?? BLOCK_THRESHOLD

      const grouped = useMemo(() => {
        if (specs === null) return null
        const out = {}
        for (const d of DIMS) out[d.id] = specs.filter((s) => s.dim === d.id)
        // 后端给了 dims 但维度表跟我本地不一致时，以本地四维为准，未归类的塞进「其他」
        const known = new Set(DIMS.map((d) => d.id))
        const other = specs.filter((s) => !known.has(s.dim))
        if (other.length > 0) out.__other = other
        return out
      }, [specs])

      if (specErr !== '') {
        return h('div', { className: 'daif_manual' },
          h('div', { className: 'daif_err' },
            h('div', { className: 'daif_errHead' }, '规则手册没加载出来'),
            h('div', { className: 'daif_errHint' }, specErr)),
          h('div', { className: 'daif_row' },
            h('button', { className: 'daif_btn', onClick: onRetry }, '重试加载')))
      }
      if (grouped === null) {
        return h('div', { className: 'daif_manual' },
          h('div', { className: 'daif_note' }, '规则手册读取中…'))
      }

      const total = specs.length
      return h('div', { className: 'daif_manual' },
        h('div', { className: 'daif_note' },
          `共 ${total} 条雷区，四组维度。命中「打回重写」级达到 ${threshold} 条即拒绝润色、直接打回重写。`),
        DIMS.map((d) => {
          const list = grouped[d.id] ?? []
          // 用原生 <details> 的开合（不受控）—— 浏览器自己管这个状态，
          // 比在 React 里复刻一份 open 状态可靠得多。
          return h('details', { key: d.id },
            h('summary', null, `${d.label}（${list.length}）`),
            h('div', { className: 'daif_note', style: { marginBottom: '6px' } }, d.hint),
            list.map((s) => h('div', { key: s.id, className: 'daif_manualspec' },
              h('div', { className: 'daif_manualspecHead' },
                h('span', { className: 'daif_manualspecNo' }, s.no !== undefined && s.no !== null ? `#${s.no}` : '—'),
                h('span', { className: 'daif_manualspecTitle' }, s.title ?? s.id),
                s.severity === 'block'
                  ? h('span', { className: 'daif_tag sev_block' }, '✕ 打回重写')
                  : h('span', { className: 'daif_tag sev_warn' }, '△ 建议修改')),
              s.rule !== undefined && s.rule !== ''
                ? h('div', { className: 'daif_manualspecRule' }, `判据：${s.rule}`)
                : null,
              s.allow !== undefined && s.allow !== ''
                ? h('div', { className: 'daif_manualspecAllow' }, `放行：${s.allow}`)
                : null,
              s.fix !== undefined && s.fix !== ''
                ? h('div', { className: 'daif_manualspecFix' }, `修复：${s.fix}`)
                : null)))
        }),
        grouped.__other !== undefined
          ? h('details', null,
            h('summary', null, `其他（${grouped.__other.length}）`),
            grouped.__other.map((s) => h('div', { key: s.id, className: 'daif_manualspec' },
              h('div', { className: 'daif_manualspecHead' },
                h('span', { className: 'daif_manualspecTitle' }, s.title ?? s.id)),
              s.rule !== undefined && s.rule !== '' ? h('div', { className: 'daif_manualspecRule' }, `判据：${s.rule}`) : null,
              s.allow !== undefined && s.allow !== '' ? h('div', { className: 'daif_manualspecAllow' }, `放行：${s.allow}`) : null)))
          : null)
    }

    // ————————————————————————— 主面板 —————————————————————————

    function Shell() {
      // —— 输入 ——
      const [text, setText] = useState('')
      // 维度筛选：默认全开。存的是「开着的维度集合」
      const [dimsOn, setDimsOn] = useState(() => new Set(DIMS.map((d) => d.id)))
      // 展示筛选：命中清单按维度过滤（与请求用的筛选分开 —— 用户可能想「全量扫描、只看名字」）
      const [showDim, setShowDim] = useState(() => new Set(DIMS.map((d) => d.id)))

      // —— 结果 ——
      const [result, setResult] = useState(null)
      const [busy, setBusy] = useState(false)
      const [err, setErr] = useState('')
      const [toast, setToast] = useState(null)
      const [openHit, setOpenHit] = useState(() => new Set())

      // —— 规则手册 ——
      const [spec, setSpec] = useState(null)
      const [specErr, setSpecErr] = useState('')

      // —— 复制输出 ——
      const [copyOut, setCopyOut] = useState(null)  // { label, text }

      const say = useCallback((t, okk = true) => setToast({ text: t, ok: okk }), [])

      // 规则手册：进来就拉一次，失败也给得出原因
      const loadSpec = useCallback(async () => {
        try {
          const r = await api('/spec')
          setSpec(r)
          setSpecErr('')
        } catch (e) {
          setSpec(null)
          setSpecErr(e?.message ?? String(e))
        }
      }, [])
      useEffect(() => { loadSpec() }, [loadSpec])

      const activeDims = DIMS.filter((d) => dimsOn.has(d.id)).map((d) => d.id)

      const toggleDim = (setter, id) => setter((prev) => {
        const n = new Set(prev)
        if (n.has(id)) n.delete(id); else n.add(id)
        return n
      })

      // —— 开始扫雷 ——
      const runAudit = useCallback(async () => {
        const body = text.trim()
        if (body === '') { say('先粘贴一段正文', false); return }
        if (activeDims.length === 0) { say('至少留一个维度', false); return }
        setBusy(true)
        setErr('')
        setOpenHit(new Set())
        try {
          const r = await api('/audit', { text: body, dims: activeDims })
          setResult(r)
          setCopyOut(null)
        } catch (e) {
          setErr(e?.message ?? String(e))
          say(e?.message ?? '扫雷失败', false)
        } finally {
          setBusy(false)
        }
      }, [text, activeDims, say])

      // —— 命中清单（按展示筛选过滤）——
      const allHits = Array.isArray(result?.hits) ? result.hits : []
      const shownHits = allHits.filter((x) => showDim.has(x.dim ?? ''))
      const dimCounts = useMemo(() => {
        const c = {}
        for (const d of DIMS) c[d.id] = 0
        for (const x of allHits) {
          const k = x.dim ?? ''
          c[k] = (c[k] ?? 0) + 1
        }
        return c
      }, [allHits])

      // —— 判定 ——
      const verdict = useMemo(() => {
        if (result === null) return null
        const blockCount = result.blockCount ?? result.bySeverity?.block ?? 0
        const warnCount = result.bySeverity?.warn ?? 0
        const threshold = result.threshold ?? spec?.threshold ?? BLOCK_THRESHOLD
        const reject = result.shouldReject ?? (blockCount >= threshold)
        if (reject) {
          return {
            cls: 'v_block', icon: '✕', text: '打回重写',
            why: `命中 ${blockCount} 条重灾区（阈值 ${threshold} 条），按插件铁律拒绝润色。`
              + '请先把重灾区改掉，改完再回来重扫；不要在重灾区还在的时候做局部润色。',
          }
        }
        if (blockCount > 0) {
          return {
            cls: 'v_warn', icon: '△', text: '建议修改',
            why: `命中 ${blockCount} 条重灾区（未达 ${threshold} 条阈值），另有 ${warnCount} 条建议项。`
              + '建议逐条改掉再定稿。',
          }
        }
        if (warnCount > 0) {
          return {
            cls: 'v_warn', icon: '△', text: '建议修改',
            why: `没有硬伤，但有 ${warnCount} 条建议项 —— 多半是 AI 味苗头，看上下文再定。`,
          }
        }
        return {
          cls: 'v_pass', icon: '○', text: '通过',
          why: '没有命中任何雷区。这一段没有 AI 味的硬伤。',
        }
      }, [result, spec])

      // —— 复制：命中清单 ——
      const buildHitListText = useCallback(() => {
        if (result === null) return ''
        const head = result.shouldReject === true || (result.blockCount ?? 0) >= (result.threshold ?? BLOCK_THRESHOLD)
          ? `结论：打回重写（命中 ${result.blockCount ?? 0} 条重灾区，阈值 ${result.threshold ?? BLOCK_THRESHOLD} 条）`
          : (result.blockCount ?? 0) > 0 || (result.bySeverity?.warn ?? 0) > 0
            ? `结论：建议修改（重灾区 ${result.blockCount ?? 0} 条，建议项 ${result.bySeverity?.warn ?? 0} 条）`
            : '结论：通过'
        const lines = [head, `正文 ${result.chars ?? 0} 字`, '']
        const list = shownHits.length > 0 ? shownHits : allHits
        if (list.length === 0) {
          lines.push('（无命中）')
        } else {
          list.forEach((x, i) => {
            lines.push(`${i + 1}. [${DIM_LABEL[x.dim] ?? x.dim ?? '—'}] ${x.title ?? x.specId ?? ''}`
              + `（${x.severity === 'block' ? '打回重写' : '建议修改'}）`)
            if (x.where !== undefined && x.where !== null && x.where !== '') lines.push(`   定位：${x.where}`)
            if (x.evidence !== undefined && x.evidence !== null && x.evidence !== '') {
              lines.push(`   证据：${x.evidence}`)
            }
            if (x.note !== undefined && x.note !== null && x.note !== '') lines.push(`   病理：${x.note}`)
            if (x.fix !== undefined && x.fix !== null && x.fix !== '') lines.push(`   修复方向：${x.fix}`)
            if (x.allow !== undefined && x.allow !== null && x.allow !== '') lines.push(`   放行条件：${x.allow}`)
            lines.push('')
          })
        }
        return lines.join('\n')
      }, [result, shownHits, allHits])

      /**
       * 复制：去AI味强制指令。
       *
       * 【降级说明 —— 需要 Lead 补端点】
       * 理想情况这个指令应由后端生成（`GET /api/dsh-anti-ai-fiction/prompt` 或
       * `/audit` 返回的 `prompt` 字段），因为它要跟着**实际命中的雷区**走。
       * 当前 spec 的接口约定里**没有这个端点**，所以这里本地拼一份简版：
       * 把命中的雷区、判据、放行条件、修复方向拼成一段可贴给模型的指令。
       * 若后端后来提供了该端点，应改成优先取后端结果，取不到再落到这份简版。
       */
      const buildForceText = useCallback(() => {
        if (result === null) return ''
        const blockCount = result.blockCount ?? result.bySeverity?.block ?? 0
        const threshold = result.threshold ?? BLOCK_THRESHOLD
        const reject = result.shouldReject ?? (blockCount >= threshold)
        const head = reject
          ? `【打回重写】本次扫雷命中 ${blockCount} 条重灾区（阈值 ${threshold} 条）。`
            + '不要做局部润色 —— 请按下面每一条的判据重写被点名的段落，改完再复检。'
          : '【去AI味】下面是被点名的 AI 味段落。请逐条改写，只改被点名的地方，别的别动。'
        const lines = [head, '']
        const list = shownHits.length > 0 ? shownHits : allHits
        if (list.length === 0) {
          lines.push('（本次没有命中任何雷区，不需要改写。）')
          return lines.join('\n')
        }
        lines.push('改写要求：')
        lines.push('1. 逐条对应下面的雷区改写，不要泛泛地「润色全文」。')
        lines.push('2. 保留原有情节、人物关系、视角与信息量，不许增删剧情。')
        lines.push('3. 改写后自检：命中条目的判据不能再出现在改后的文字里。')
        lines.push('4. 注意放行条件 —— 命中但满足放行条件的写法可以保留原样。')
        lines.push('')
        list.forEach((x, i) => {
          lines.push(`${i + 1}. [${DIM_LABEL[x.dim] ?? x.dim ?? '—'}] ${x.title ?? x.specId ?? ''}`
            + `（${x.severity === 'block' ? '打回重写' : '建议修改'}）`)
          if (x.rule !== undefined && x.rule !== null && x.rule !== '') lines.push(`   判据：${x.rule}`)
          if (x.evidence !== undefined && x.evidence !== null && x.evidence !== '') lines.push(`   原文：${x.evidence}`)
          if (x.fix !== undefined && x.fix !== null && x.fix !== '') lines.push(`   改成：${x.fix}`)
          if (x.allow !== undefined && x.allow !== null && x.allow !== '') lines.push(`   放行条件：${x.allow}`)
          lines.push('')
        })
        return lines.join('\n')
      }, [result, shownHits, allHits])

      const doCopy = useCallback(async (label, text) => {
        if (text === '') { say('没有可复制的内容', false); return }
        const ok = await copyText(text)
        say(ok ? `${label}已复制` : `${label}复制失败（浏览器拒绝了剪贴板权限）`, ok)
      }, [say])

      return h('div', { className: 'daif_root' },
        h('div', { className: 'daif_shell' },
          h('div', { className: 'daif_head' },
            h('div', { className: 'daif_headText' },
              h('div', { className: 'daif_title' }, '扫雷工作台'),
              h('div', { className: 'daif_subtitle' }, '粘贴正文 → 扫雷 → 按判定处理')),

          h('div', { className: 'daif_body' },

            // ———— 1. 输入区 ————
            h('div', { className: 'daif_inputbox' },
              h('textarea', {
                className: 'daif_area',
                placeholder: '把待检正文粘贴到这里（整段、整章都行）。\n判定只依据这段文字，不会上传别的东西。',
                value: text,
                onChange: (e) => setText(e.target.value),
              }),
              h('div', { className: 'daif_row' },
                h('span', { className: 'daif_note' }, '扫描维度：'),
                h('div', { className: 'daif_dimtoggles' },
                  DIMS.map((d) => h('label', {
                    key: d.id, className: 'daif_dimtoggle', 'data-on': dimsOn.has(d.id) ? '1' : '0',
                    title: d.hint,
                  },
                    h('input', {
                      type: 'checkbox', checked: dimsOn.has(d.id),
                      onChange: () => toggleDim(setDimsOn, d.id),
                    }),
                    d.label)))),
              h('div', { className: 'daif_row' },
                h('button', {
                  className: 'daif_btn daif_btn_primary',
                  onClick: runAudit,
                  disabled: busy || text.trim() === '' || activeDims.length === 0,
                }, busy ? '扫雷中…' : '开始扫雷'),
                h('span', { className: 'daif_note' },
                  `${text.trim().length} 字　已选 ${activeDims.length}/${DIMS.length} 个维度`),
                text.trim() !== ''
                  ? h('button', { className: 'daif_btn', onClick: () => { setText(''); setResult(null) } }, '清空')
                  : null)),

            err !== ''
              ? h('div', { className: 'daif_err' },
                h('div', { className: 'daif_errHead' }, `扫雷失败：${err}`),
                h('div', { className: 'daif_errHint' },
                  '后端接口可能还没上线，或者返回的不是预期格式。检查 DSH 是否重启、插件是否加载成功。'),
                h('div', { className: 'daif_row' },
                  h('button', { className: 'daif_btn', onClick: runAudit, disabled: busy }, '再试一次')))
              : null,

            // ———— 2. 判定区（最显眼） ————
            verdict !== null
              ? h('div', { className: `daif_verdict ${verdict.cls}` },
                h('div', { className: 'daif_verdictHead' },
                  h('span', { className: 'daif_verdictIcon' }, verdict.icon),
                  h('span', { className: 'daif_verdictText' }, verdict.text)),
                h('div', { className: 'daif_verdictWhy' }, verdict.why),
                h('div', { className: 'daif_verdictStats' },
                  h(Stat, { n: result.blockCount ?? result.bySeverity?.block ?? 0, k: '重灾区' }),
                  h(Stat, { n: result.bySeverity?.warn ?? 0, k: '建议项' }),
                  h(Stat, { n: allHits.length, k: '命中总数' }),
                  h(Stat, { n: result.chars ?? 0, k: '正文字数' }),
                  h(Stat, { n: result.threshold ?? spec?.threshold ?? BLOCK_THRESHOLD, k: '打回阈值' })))
              : h('div', { className: 'daif_note' }, '还没扫。粘上正文点「开始扫雷」，判定会出现在这里。'),

            // ———— 3. 命中清单 ————
            result !== null
              ? h('div', null,
                h('div', { className: 'daif_row' },
                  h('div', { className: 'daif_hitTitle' }, `命中清单（${shownHits.length}/${allHits.length}）`),
                  h('div', { className: 'daif_dimtoggles' },
                    DIMS.map((d) => h('label', {
                      key: d.id, className: 'daif_dimtoggle', 'data-on': showDim.has(d.id) ? '1' : '0',
                      title: `只看${d.label}（共 ${dimCounts[d.id] ?? 0} 条）`,
                    },
                      h('input', {
                        type: 'checkbox', checked: showDim.has(d.id),
                        onChange: () => toggleDim(setShowDim, d.id),
                      }),
                      `${d.label} ${dimCounts[d.id] ?? 0}`))),
                  h('button', {
                    className: 'daif_btn',
                    onClick: () => setShowDim((prev) => (prev.size === DIMS.length ? new Set() : new Set(DIMS.map((d) => d.id)))),
                  }, showDim.size === DIMS.length ? '全部收起' : '全部展开')),
                allHits.length === 0
                  ? h('div', { className: 'daif_note' }, '没有命中任何雷区。')
                  : shownHits.length === 0
                    ? h('div', { className: 'daif_note' }, '当前筛选下没有命中。')
                    : h('div', { className: 'daif_hits' },
                      shownHits.map((x, i) => {
                        // 用稳定 key 而不是下标 —— 下标会随「维度筛选」错位，
                        // 展开状态会张冠李戴到别的条目上。
                        const hk = hitKey(x, i)
                        return h(HitRow, {
                          key: hk,
                          hit: x,
                          open: openHit.has(hk),
                          onToggle: () => setOpenHit((prev) => {
                            const n = new Set(prev)
                            if (n.has(hk)) n.delete(hk); else n.add(hk)
                            return n
                          }),
                        })
                      })),
                h('div', { className: 'daif_row' },
                  h('button', {
                    className: 'daif_btn',
                    onClick: () => doCopy('命中清单', buildHitListText()),
                    disabled: allHits.length === 0,
                  }, '复制命中清单'),
                  h('button', {
                    className: 'daif_btn',
                    onClick: () => doCopy('去AI味强制指令', buildForceText()),
                    disabled: allHits.length === 0,
                  }, '复制去AI味强制指令'),
                  h('button', {
                    className: 'daif_btn',
                    onClick: () => {
                      setCopyOut({ label: '命中清单', text: buildHitListText() })
                    },
                    disabled: allHits.length === 0,
                  }, '预览命中清单'),
                  h('button', {
                    className: 'daif_btn',
                    onClick: () => {
                      setCopyOut({ label: '去AI味强制指令', text: buildForceText() })
                    },
                    disabled: allHits.length === 0,
                  }, '预览强制指令')),
                copyOut !== null
                  ? h('div', null,
                    h('div', { className: 'daif_row' },
                      h('span', { className: 'daif_label' }, copyOut.label),
                      h('button', { className: 'daif_btn', onClick: () => setCopyOut(null) }, '收起')),
                    h('pre', { className: 'daif_pre' }, copyOut.text))
                  : null)
              : null,

            // ———— 4. 规则手册 ————
            h('details', { className: 'daif_manual' },
              h('summary', null, `规则手册（40 条雷区）`),
              h(SpecManual, { spec, specErr, onRetry: loadSpec })),

            h('div', { className: 'daif_note' },
              '这个面板只做**判定与定位**：它把 AI 味的具体位置、判据和修复方向摆出来，'
              + '改写那一步由你或 agent 拿着清单去做。判定三档都带图标和文字，不靠颜色区分。'),

            h(Toast, { toast, onDone: () => setToast(null) }),
          ))))
    }

    // ————————————————————————— 插件入口 —————————————————————————

    function apply(ctx) {
      ctx.effect(() => {
        const tag = document.createElement('style')
        tag.setAttribute('data-plugin', NS)
        tag.textContent = STYLES
        document.head.appendChild(tag)
        return () => { if (tag.parentNode !== null) tag.parentNode.removeChild(tag) }
      }, `${NS}: styles`)

      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'anti-ai-fiction',
        order: 22,
        label: () => '反AI味',
      }, Shell))
    }

    module.exports = { name: NS, inject: ['slots'], apply }
    return module.exports
  },
})

/* ============================================================
   pages-core.js — 首页 / 综合总榜
   ============================================================ */
(function () {
  const t = window.I18N, U = window.U, M = window.MOCK, Ic = window.Icons, Pm = window.Params;
  /* 当前模型 = 六维：M1 纪录持有 / M2 领奖台 / M3 大赛破纪录 / M4 统治力 /
     M5 当前排名 / M6 突破幅度。旧七模块（含 M7）仅作描述性统计保留，不参与总分。 */
  const MOD = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'];
  const MODC = { m1: 'var(--m1)', m2: 'var(--m2)', m3: 'var(--m3)', m4: 'var(--m4)', m5: 'var(--m5)', m6: 'var(--m6)' };
  const SIXW = { m1: 0.28, m2: 0.24, m3: 0.12, m4: 0.18, m5: 0.08, m6: 0.10 };
  function sixWeights() { return sixW(); }
  /* 六维权重：优先取「评分原理说明 / 参数设置」页的用户自定义值（已归一化 Σ=1），
     没有自定义时回落到 ETL 下发的 meta.sixWeights。二者默认取值一致，
     所以没有调过参数时结果与旧行为完全相同。 */
  function sixW() {
    const pm = (typeof window !== 'undefined') ? window.Params : null;
    if (pm && typeof pm.weights === 'function') {
      try {
        const w = pm.weights();
        if (w && typeof w.m1 === 'number') return w;
      } catch (e) { /* 参数面板不可用时静默回落 */ }
    }
    return (M.meta && M.meta.sixWeights) || SIXW_DEF;
  }
  const esc = U.esc;
  const P = window.P || (window.P = {});

  /* ---------- 共享小工具 ---------- */
  function modName(k) { return t('m' + k[1] + '.name'); }
  /* 旗帜：本地 css/flags.css（flag-icons 4x3 内联 data URI，离线可用） */
  function flag(iso, cls) {
    if (!iso) return '';
    const code = String(iso).toUpperCase();
    const low = code.toLowerCase();
    const cname = (M.countriesZh && M.countriesZh[code]) || M.countries[code] || code;
    const extra = (cls || '').trim();
    return '<span class="fi f-sm' + (extra ? ' ' + esc(extra) : '') + ' fi-' + esc(low) + '" title="' + esc(cname) + '" aria-label="' + esc(cname) + '"></span>';
  }
  /* 头像：总榜列表已按要求不再展示头像；选手页 / PK 页仍可调用。
     WCA 官方头像拉取失败时回退为首字母底色（goatAvatarFallback）。 */
  function avatar(p, cls) {
    if (!p || cls === 'sm' || cls === 'lg') {
      const ini = U.initials(p ? p.name : ''), hue = p ? p.hue : 200;
      return '<span class="avatar ' + (cls || '') + '" style="background:hsl(' + hue + ',56%,48%)">' + esc(ini) + '</span>';
    }
    const ini = U.initials(p.name), hue = p.hue;
    const wca = p.wcaId ? 'https://www.worldcubeassociation.org/static/person-photo/' + encodeURIComponent(String(p.wcaId).toUpperCase()) + '.jpg' : '';
    if (!wca) return '<span class="avatar ' + (cls || '') + '" style="background:hsl(' + hue + ',56%,48%)">' + esc(ini) + '</span>';
    return '<img class="avatar ' + (cls || '') + '" src="' + wca + '" alt="' + esc(p.name) + '" loading="lazy" data-cls="' + (cls || '') + '" data-hue="' + hue + '" data-ini="' + esc(ini) + '" onerror="if(window.goatAvatarFallback)window.goatAvatarFallback(this)">';
  }
  /* 国家 / 地区名称：中文界面显示中文名 */
  function countryName(iso) {
    const code = String(iso || '').toUpperCase();
    if (t && t.isEn && t.isEn()) return M.countries[code] || code;
    return (M.countriesZh && M.countriesZh[code]) || M.countries[code] || code;
  }
  /* 性别归一化：兼容 'Male'/'Female'/'m'/'f' 等各种真实导出写法 */
  function genderOf(g) { if (!g) return ''; g = String(g).charAt(0).toUpperCase(); return g === 'F' ? 'F' : 'M'; }
  function playerLink(p) { return '<a class="linkish" href="#/player/' + p.id + '">' + esc(p.name) + '</a>'; }
  function evName(e) { return t.isEn() ? e.en : e.zh; }
  function contName(c) { const o = M.continents[c]; return o ? (t.isEn() ? o.en : o.zh) : (c || '—'); }
  function regionName(r) { const o = M.regions[r]; return o ? (t.isEn() ? o.en : o.zh) : (r || '—'); }
  /* 实力条（0.02~1）：改由六维的 M4 统治力维驱动（榜首=1），不再用旧 Elo 峰值。 */
  function strength(p) { return Math.max(0.02, Math.min(1, (p.six ? (p.six.m4 || 0) : 0) / 100)); }
  /* 成绩口径：总计 / 单次 / 平均 —— 只替换 M1 纪录分，其余模块不变 */
  function modsOf(p, tab, rt) {
    const mods = tab === 'peak' ? p.pk : p.m;
    if (rt !== 'single' && rt !== 'avg') return mods;
    const k = rt === 'single' ? 'm1s' : 'm1a';
    if (mods[k] == null) return mods;
    const c = {};
    for (const kk in mods) c[kk] = mods[kk];
    c.m1 = mods[k];
    return c;
  }
  /* 当前模型只有一个口径：六维加权总分 t = Σ_d(维度权重 × 维度分)，由 ETL 预置 p.six。
     旧模型的「生涯 / 巅峰 / 综合」三档拆分随七模块一并停用，
     这里三个键返回同一个六维总分，保证任何调用方都不会再取到旧口径数字。
     没有六维分的选手一律记 0（不回退旧 esum，避免同一张榜出现两套量纲）。 */
  /* 总分按**当前权重**实时重算（t = Σ_d w_d·s_d），而不是读 ETL 预置的 p.six.t ——
     否则「参数设置」页改了六维占比，榜单并不会跟着变。 */
  /* 按成绩口径取正确的六维向量：
       rt==='single' → 单次档 p.sixS（ETL 用 sixdim.js --track single 跑出）
       rt==='avg'    → 平均档 p.sixA
       其它（'all'/空/未传）→ 合并档 p.six
     三套同源同结构 {m1..m6,t}，仅维度分因口径不同而异（M1 纪录分、M5 当前排名受单次/平均影响最大）。 */
  function sixVec(p, rt) {
    if (!p) return null;
    if (rt === 'single') return p.sixS || p.six || null;
    if (rt === 'avg') return p.sixA || p.six || null;
    return p.six || null;
  }
  function sixT(p, rt) {
    const v = sixVec(p, rt);
    if (!v) return 0;
    const w = sixW();
    let t = 0;
    for (let i = 0; i < SIXD.length; i++) t += (w[SIXD[i]] || 0) * (v[SIXD[i]] || 0);
    return t;
  }
  function scoreOf(p, rt) {
    const t = sixT(p, rt);
    return { career: t, peak: t, overall: t, balance: 0 };
  }
  /* ── 六维按项目分解（项目筛选后重排的真源）─────────────────────────
     ETL 侧 sixdim_by_event.tsv 给出每位选手在**每个项目上**的六维分 s_d[ev]，
     与全站分同一归一分母，因此 Σ_ev s_d[ev] ≡ s_d、Σ_ev t_ev ≡ t：
       · 单项目筛选 → 直接取该项目那一组；
       · 多项目筛选 → 对所选项目逐维求和；
       · 不选项目     → 与全站 p.six 完全一致。
     旧版在项目筛选下改用 esum（Σ 100×世界名次^-γ×项目权重，只看当前成绩），
     与六维总分不是同一把尺子，这里整体替换。 */
  const SIXD = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'];
  const SIXW_DEF = { m1: 0.28, m2: 0.24, m3: 0.12, m4: 0.18, m5: 0.08, m6: 0.10 };
  /* 这份数据是否带按项目分解的六维分（老 data.js 没有 → 退回全站分，不静默出错） */
  let HAS_SIXEV = null;
  function hasSixEv() {
    if (HAS_SIXEV === null) {
      HAS_SIXEV = false;
      for (let i = 0; i < M.ranked.length; i++) if (M.ranked[i].sixEv) { HAS_SIXEV = true; break; }
    }
    return HAS_SIXEV;
  }
  /* 选手在项目集合 ids 内的六维分：返回 { s:[6], t, hit, parts:[{ev,t}] }；
     无 sixEv 或 ids 为空时返回 null（调用方据此退回全站分）。 */
  function sixIn(p, ids) {
    const se = p && p.sixEv;
    if (!se || !ids || !ids.length) return null;
    const s = [0, 0, 0, 0, 0, 0], parts = [];
    let hit = 0;
    for (let i = 0; i < ids.length; i++) {
      const a = se[ids[i]];
      if (!a) continue;
      for (let d = 0; d < 6; d++) s[d] += (a[d] || 0);
      parts.push({ ev: ids[i], t: a[6] || 0 });
      hit++;
    }
    const w = sixW();
    let t = 0;
    for (let d = 0; d < 6; d++) t += w[SIXD[d]] * s[d];
    return { s: s, t: t, hit: hit, parts: parts };
  }
  /* 六维贡献明细：raw=维度分、w=权重、v=加权贡献。
     vec 传入时用它覆盖维度分（项目筛选后只统计所选项目的那部分），
     使展开行里的「六维贡献」与榜单上的排序数字始终是同一把尺子。 */
  function contribs(p, tab, rt, vec) {
    const w = sixWeights();
    const src = vec || sixVec(p, rt) || null;
    return MOD.map(function (k, i) {
      const raw = src ? (vec ? (vec[i] || 0) : (src[k] || 0)) : 0;
      return { k: k, name: (M.meta && M.meta.sixNames && M.meta.sixNames[k]) || modName(k), raw: raw, w: w[k], v: w[k] * raw, color: MODC[k] };
    });
  }
  /* 行内迷你堆叠条（六维加权贡献） */
  function miniStack(p, tab, rt) {
    const cs = contribs(p, tab, rt);
    const tot = cs.reduce(function (a, c) { return a + c.v; }, 0) || 1;
    let s = '<div class="ministack" role="img" aria-label="' + esc(t('rank.contribution')) + '">';
    cs.forEach(function (c) {
      const pct = c.v / tot * 100;
      s += '<span style="width:' + pct.toFixed(1) + '%;background:' + c.color + '" title="' + esc(c.name) + ' ' + U.fmt(pct, 0) + '%"></span>';
    });
    s += '</div>';
    return s;
  }
  const EV_IX = {};
  (M.events || []).forEach(function (e, i) { EV_IX[e.id] = i; });
  /* ── 柱状图内部堆叠条：两种口径，由工具栏「堆叠方式」开关自由切换 ──────
     · ev  —— 按项目：色块＝各项目的六维小计 t_ev ÷ 合计（Σ 各段 = 榜上总分）
     · dim —— 按维度：色块＝各维度的加权贡献 w_d·s_d ÷ 合计（Σ 各段 = 榜上总分）
     两种口径的宽度合计都正好等于条长所代表的分数，永远与排序同一把尺子；
     旧的 100×世界名次^-γ×项目权重（esum）口径已停用。 */
  function stackModeOf(state, evMode, multiMode) {
    if (state.stackMode === 'ev' || state.stackMode === 'dim') return state.stackMode;
    /* 未显式选择时的自动默认：只有「显式多选了几个项目」时按项目才有信息量。
       · 单项目 → 按项目会退化成整条单色；
       · 未筛选/全项目 → 十几个项目各自一小段，色块碎成一地看不出结构；
       这两种情况都默认按维度堆叠。 */
    return (multiMode && !evMode) ? 'ev' : 'dim';
  }
  /* 按维度堆叠：色块＝六个维度的加权贡献占比 */
  function dimStackHtml(row, rt) {
    const w = sixW();
    const p = row.p;
    /* row.six 是「所选项目范围内」的逐维求和（项目筛选生效时），否则按成绩口径取对应档的六维向量；
       rt 为 single/avg 时用 p.sixS/p.sixA，保证堆叠条与排序同一把尺子。 */
    const vec = row.six || (sixVec(p, rt) ? SIXD.map(function (k) { return sixVec(p, rt)[k] || 0; }) : null);
    if (!vec) return '';
    const items = SIXD.map(function (k, i) {
      return { k: k, raw: vec[i] || 0, v: (w[k] || 0) * (vec[i] || 0), color: MODC[k] };
    });
    const tot = items.reduce(function (a, x) { return a + x.v; }, 0);
    if (!(tot > 0)) return '';
    items.sort(function (a, b) { return b.v - a.v; });
    return '<div class="ministack dimstack" role="img" aria-label="' + esc(t('rank.contribution')) + '">' +
      items.map(function (x) {
        if (!(x.v > 0)) return '';
        const nm = (M.meta && M.meta.sixNames && M.meta.sixNames[x.k]) || modName(x.k);
        return '<span style="width:' + (x.v / tot * 100).toFixed(1) + '%;background:' + x.color +
          '" title="' + esc(nm) + ' · ' + esc(t('rank.stackDimTip', {
          s: U.fmt(x.raw, 2), w: U.fmt(w[x.k] || 0, 2), v: U.fmt(x.v, 2), p: U.fmt(x.v / tot * 100, 1)
        })) + '"></span>';
      }).join('') + '</div>';
  }
  /* 按项目堆叠：色块＝各项目六维小计 t_ev 的占比；
     ids 为空表示不收窄（该选手全部有分的项目）。 */
  function evStackHtml(row, ids) {
    const p = row.p, se = p.sixEv;
    if (!se) {
      /* 老 data.js 没有按项目分解的六维分：退回旧的逐项目名次（esum 口径），
         至少不出现空条；再不行就退回六维贡献条。 */
      if (!p.evRk) return miniStack(p, null, null);
      const g = (M.meta && M.meta.evGamma) || 0.35;
      const items = [];
      String(p.evRk).split(';').forEach(function (seg) {
        const i = seg.indexOf(':');
        if (i < 0) return;
        const eid = seg.slice(0, i), rk = parseInt(seg.slice(i + 1), 10) || 0;
        if (!eid || rk <= 0) return;
        if (ids && ids.length && ids.indexOf(eid) < 0) return;
        const ev = M.EV[eid] || {};
        items.push({ eid: eid, rk: rk, v: 100 * Math.pow(rk, -g) * ((ev.w != null) ? ev.w : 0.8) });
      });
      const tot0 = items.reduce(function (a, x) { return a + x.v; }, 0);
      if (!(tot0 > 0)) return '';
      items.sort(function (a, b) { return b.v - a.v; });
      return '<div class="ministack evstack" role="img" aria-label="' + esc(t('rank.contribution')) + '">' +
        items.map(function (x) {
          const ev = M.EV[x.eid] || { zh: x.eid, en: x.eid };
          return '<span style="width:' + (x.v / tot0 * 100).toFixed(1) + '%;background:' + evColorOf(x.eid) +
            '" title="' + esc(evName(ev)) + ' No.' + x.rk + ' · ' + U.fmt(x.v, 2) + '"></span>';
        }).join('') + '</div>';
    }
    const keys = (ids && ids.length) ? ids : Object.keys(se);
    const all = keys.map(function (id) { return { ev: id, t: (se[id] && se[id][6]) || 0 }; })
      .filter(function (x) { return x.t > 0; })
      .sort(function (a, b) { return b.t - a.t; });
    const tot = all.reduce(function (a, x) { return a + x.t; }, 0);
    if (!(tot > 0)) return '';
    /* 项目太多时（未筛选的全项目可达 18 段）只保留头部，其余并成灰色「其他」，
       否则一堆不足 1% 的碎块挤在一起，既看不出结构也点不到 tooltip。 */
    let parts = all, other = null;
    if (all.length > 10) {
      parts = all.slice(0, 9);
      let ot = 0;
      for (let i = 9; i < all.length; i++) ot += all[i].t;
      other = { t: ot, n: all.length - 9 };
    }
    const seg = function (w, bg, ttl) {
      return '<span style="width:' + Math.max(0.5, w).toFixed(1) + '%;background:' + bg + '" title="' + esc(ttl) + '"></span>';
    };
    let out = '<div class="ministack evstack" role="img" aria-label="' + esc(t('rank.contribution')) + '">';
    parts.forEach(function (x) {
      out += seg(x.t / tot * 100, evColorOf(x.ev),
        evName(M.EV[x.ev] || { zh: x.ev, en: x.ev }) + ' · ' + t('rank.stackEvTip', {
          v: U.fmt(x.t, 2), p: U.fmt(x.t / tot * 100, 1)
        }));
    });
    if (other) {
      out += seg(other.t / tot * 100, '#9aa2b1',
        t('rank.stackOther', { n: other.n }) + ' · ' + t('rank.stackEvTip', {
          v: U.fmt(other.t, 2), p: U.fmt(other.t / tot * 100, 1)
        }));
    }
    return out + '</div>';
  }
  function stackHtml(row, mode, ids, rt) {
    return mode === 'dim' ? dimStackHtml(row, rt) : evStackHtml(row, ids);
  }
  function ecBox(type, data, opts, h) {
    const payload = { type: type, data: data, opts: opts || {} };
    return '<div class="ec" data-ec="' + esc(JSON.stringify(payload)) + '" style="height:' + (h || 320) + 'px"></div>';
  }
  function infoTip(text) {
    return '<span class="tip" tabindex="0" aria-label="' + esc(text) + '">' + Ic.glyph('info', 'tip-ic') + '<span class="tip-body">' + esc(text) + '</span></span>';
  }
  function fmtScore(x) { return U.fmt(x, 2); }

  P.util = {
    MOD: MOD, MODC: MODC, modName: modName, flag: flag, avatar: avatar, playerLink: playerLink,
    evName: evName, contName: contName, regionName: regionName, countryName: countryName,
    sixW: sixW, evColorOf: evColorOf, evColor: evColor,
    scoreOf: scoreOf, contribs: contribs, ecBox: ecBox, infoTip: infoTip, strength: strength, fmtScore: fmtScore,
    topicPool: topicPool
  };

  /* 另类统计页的候选池：套用顶部筛选条（国家 / 大洲 / 性别 / 年份区间 /
     预设分组 / 事件多选 / 停办项目），使全局筛选在该页同样生效 */
  function topicPool(state) {
    const pool = (state.group && state.group !== 'all') ? eventSet(state)
      : ((state.evSel && state.evSel.length) ? state.evSel
         : (state.topicEvent ? [state.topicEvent] : null));
    return M.ranked.filter(function (p) {
      if (state.geo) {
        if (state.geo.indexOf('cont:') === 0) { if (M.continentOf[p.country] !== state.geo.slice(5)) return false; }
        else if (p.country !== state.geo) return false;
      }
      if (state.gender && state.gender !== 'all' && genderOf(p.gender) !== state.gender) return false;
      if (state.y0 && p.end < state.y0) return false;
      if (state.y1 && p.start > state.y1) return false;
      if (pool && !(p.events || []).some(function (e) { return pool.indexOf(e) >= 0; })) return false;
      if (!state.retired && (p.events || []).some(function (e) { return (M.EV[e] || {}).retired; })
        && !(p.events || []).some(function (e) { return !(M.EV[e] || {}).retired; })) return false;
      return true;
    });
  }

  /* 快速入口：按需求移除「三阶 GOAT / 盲拧 GOAT / 无冕之王 / 选手 PK」，
     这四项均可由顶部筛选条（项目分组 / 地区）或导航栏直接到达。 */
  P.home = function () {
    const feats = [
      { k: 'rank', href: '#/rank', ic: 'trophy' },
      { k: 'cn', href: '#/rank?country=CN', ic: 'flag' },
      { k: 'timeline', href: '#/timeline', ic: 'timeline' },
      { k: 'topics', href: '#/topics', ic: 'medal' },
      { k: 'model', href: '#/model', ic: 'book' }
    ];
    const hot = M.ranked.slice(0, 5).map(function (p) {
      return '<button class="chip" data-goto="#/player/' + p.id + '">' + esc(p.name) + '</button>';
    }).join('');

    let h = '';
    h += '<section class="hero reveal">';
    h += '<h1 class="hero-title">' + esc(t('home.title')) + '</h1>';
    h += '<p class="hero-sub">' + esc(t('home.sub')) + '</p>';
    h += '<form class="bigsearch" id="homeSearchForm" onsubmit="return false;">';
    h += '<span class="bs-ic">' + Ic.glyph('search') + '</span>';
    h += '<input type="search" id="homeSearch" placeholder="' + esc(t('home.searchPh')) + '" aria-label="' + esc(t('home.searchPh')) + '">';
    h += '<button class="btn btn-primary" type="submit" id="homeSearchBtn">' + esc(t('home.search')) + '</button>';
    h += '</form>';
    h += '<div class="sugg"><span class="tiny muted">' + esc(t('home.hot')) + '</span>' + hot + '</div>';
    h += '<div id="homeSearchResult" class="home-result"></div>';
    h += '</section>';

    const sc = M.meta;
    /* 选手总数用WCA 全量人数（js/data.js 只带可排名的头部，长尾在懒加载名册里） */
    const nPlayers = sc.players || M.ranked.length;
    h += '<div class="sec-head reveal"><h2>' + esc(t('home.overview')) + '</h2></div>';
    h += '<div class="card reveal"><div class="grid grid-4">';
    h += '<div class="stat" title="' + esc(t('home.stat.playersTip')) + '"><div class="k">' + esc(t('home.stat.players')) + '</div><div class="v hc1" data-count="' + nPlayers + '" data-dec="0">0</div></div>';
    h += '<div class="stat"><div class="k">' + esc(t('home.stat.comps')) + '</div><div class="v hc2" data-count="' + sc.comps + '" data-dec="0">0</div></div>';
    h += '<div class="stat"><div class="k">' + esc(t('home.stat.wr')) + '</div><div class="v hc3" data-count="' + sc.wr + '" data-dec="0">0</div></div>';
    h += '<div class="stat"><div class="k">' + esc(t('home.stat.records')) + '</div><div class="v hc4" data-count="' + sc.records + '" data-dec="0">0</div></div>';
    h += '</div></div>';

    h += '<div class="sec-head reveal" style="margin-top:18px"><h2>' + esc(t('home.feat')) + '</h2></div>';
    h += '<div class="grid grid-3">';
    feats.forEach(function (f, i) {
      h += '<a class="feat reveal" style="--d:' + (i * 45) + 'ms" href="' + f.href + '">';
      h += '<span class="feat-ic">' + Ic.glyph(f.ic) + '</span>';
      h += '<h3>' + esc(t('feat.' + f.k)) + '</h3>';
      h += '<p>' + esc(t('feat.' + f.k + '.d')) + '</p>';
      h += '<span class="feat-go">' + Ic.glyph('arrow') + '</span>';
      h += '</a>';
    });
    h += '</div>';
    return h;
  };

  /* ================= 综合总榜 ================= */
  /* 三榜顺序：综合能力 → 生涯累计 → 巅峰高度 */
  const RANK_TABS = ['overall'];
  /* 榜单只统计前 N 名：300227 名全量逐条渲染没有意义，
     且成绩口径/项目筛选下真正有竞争力的就是头部。 */
  const RANK_TOP = 1000;
  const COLS = [
    { k: 'rank', label: 'col.rank', cls: 'tl' },
    { k: 'player', label: 'col.player', cls: 'tl' },
    { k: 'gender', label: 'col.gender', cls: 'tl gcol' },
    { k: 'country', label: 'col.region', cls: 'tl' },
    { k: 'bars', label: 'col.total', cls: 'bars-full' },
    { k: 'exp', label: '', cls: 'tl' }
  ];

  function genderBadge(p) {
    if (genderOf(p.gender) === 'F') return '<span class="gpill g-f">' + esc(t('f.gender.f')) + '</span>';
    return '<span class="gpill g-m">' + esc(t('f.gender.m')) + '</span>';
  }

  /* 项目集合：多选事件 / 预设分组 / 单个项目 / 停办开关 */
  function eventSet(state) {
    const incRetired = state.retired;
    let ids = null;
    if (state.evSel && state.evSel.length) {
      ids = state.evSel.slice();
    } else if (state.group === 'custom') {
      ids = (state.customIds && state.customIds.length) ? state.customIds.slice() : null;
    } else if (state.group && M.EV[state.group]) {
      ids = [state.group];
    } else if (state.group && state.group !== 'all') {
      const g = M.presetGroups.filter(x => x.id === state.group)[0];
      if (g) ids = g.ids.slice();
    }
    let pool = ids || M.events.map(function (e) { return e.id; });
    if (!incRetired) {
      const keep = pool.filter(function (id) { return !M.EV[id].retired; });
      if (keep.length) pool = keep;
    }
    return pool;
  }

  /* 当前激活分组的事件集合（用于筛选条图标联动：点分组→下方图标选中） */
  P.groupEventIds = function (state) {
    if (!state.group || state.group === 'all') return null;
    if (state.evSel && state.evSel.length) return null;
    if (M.EV[state.group]) return [state.group];
    const g = M.presetGroups.filter(function (x) { return x.id === state.group; })[0];
    if (g && g.ids) return g.ids.slice();
    const cg = (window.EvGroups && window.EvGroups.all && window.EvGroups.all().filter(function (x) { return x.id === state.group; })[0]);
    if (cg && cg.ids) return cg.ids.slice();
    return null;
  };

  /* 当前生效的项目集合（显式多选 / 预设分组 / 自定义分组），用于「按项目成绩排名」 */
  function modeEvents(state) {
    const sel = state.evSel || [];
    if (sel.length >= 2) return sel;
    if (sel.length === 1) return sel.slice();
    if (state.group === 'custom') {
      const c = state.customIds || [];
      return c.length ? c.slice() : [];
    }
    if (state.group && state.group !== 'all' && !M.EV[state.group]) {
      const g = M.presetGroups.filter(function (x) { return x.id === state.group; })[0];
      if (g && g.ids && g.ids.length >= 2) return g.ids.slice();
    }
    return [];
  }
  /* 单项目模式：恰好只选中一个项目 → 按该项目成绩单独排名 */
  function singleEvent(state) {
    const evs = modeEvents(state);
    return evs.length === 1 ? evs[0] : '';
  }
  /* 每项目榜单（ETL 预计算，按该项目世界排名） */
  const _boardCache = {};
  function eventBoard(ev) {
    if (_boardCache[ev]) return _boardCache[ev];
    const arr = (M.eventBoards || {})[ev];
    const idx = {};
    if (arr) arr.forEach(function (e) { idx[e.id] = e; });
    _boardCache[ev] = { list: arr || [], idx: idx, len: arr ? arr.length : 0 };
    return _boardCache[ev];
  }
  /* 色条宽度：按世界排名对数缩放，使不同页面的相对位置可见 */
  function evBarPct(r, len) {
    if (!r || r <= 0) return 6;
    return Math.max(6, Math.min(100, 100 * (1 - Math.log(r) / Math.log((len || 2000) + 1))));
  }
  function evWeight(ev) { return (M.EV[ev] && M.EV[ev].w) || 0.8; }
  /* 项目配色：调色板必须 ≥ 事件总数（本站 21 个，含停办），否则序号取模会撞色——
     之前只有 10 色，全项目堆叠时三阶和多盲、二阶和最少步等会画成同一个颜色，
     看起来就像「堆叠条没渲染出来」。颜色一律由 evColor(EV_IX[ev]) 给出，
     条形与图例共用同一函数，保证两处颜色始终一致。 */
  const EVCOL = [
    '#5b8cff', '#ff7a5c', '#3ecf8e', '#c084fc', '#f5c542', '#4dd0e1', '#ff8fb1', '#9ccc65',
    '#ffb74d', '#7e9cff', '#f472b6', '#2dd4bf', '#a78bfa', '#facc15', '#38bdf8', '#fb7185',
    '#84cc16', '#22d3ee', '#e879f9', '#fbbf24', '#34d399', '#60a5fa', '#f97316', '#818cf8'
  ];
  function evColor(i) { return EVCOL[((i % EVCOL.length) + EVCOL.length) % EVCOL.length]; }
  function evColorOf(eid) { return evColor(EV_IX[eid] != null ? EV_IX[eid] : 0); }

  /* 项目口径：只有**显式选择**（多选事件 / 单个项目 / 预设分组 / 自定义分组）
     才按所选项目重新计分；默认的「不显示停办项目」只收窄选手池，不改变总分口径——
     否则总榜算的是「剔除停办项目后的分」，选手页显示的却是含停办项目的 p.six，两处对不上。
     返回值 null 表示不收窄（用全站六维总分）。 */
  function evScopeIds(state) {
    let sel = null;
    if (state.evSel && state.evSel.length) sel = state.evSel.slice();
    else if (state.group === 'custom') sel = (state.customIds && state.customIds.length) ? state.customIds.slice() : null;
    else if (state.group && state.group !== 'all') {
      if (M.EV[state.group]) sel = [state.group];
      else {
        const g = M.presetGroups.filter(function (x) { return x.id === state.group; })[0];
        sel = (g && g.ids) ? g.ids.slice() : null;
      }
    }
    if (!sel || !sel.length) return null;
    if (!state.retired) {
      const keep = sel.filter(function (id) { return !(M.EV[id] && M.EV[id].retired); });
      /* 全被滤掉＝选的就是停办项目本身，保留原选择 */
      if (keep.length) return keep;
    }
    return sel;
  }
  P.filtered = function (state) {
    const pool = eventSet(state);
    const rt = state.recType || 'all';
    const scoped = (state.group && state.group !== 'all') || (state.evSel && state.evSel.length);
    let rows = M.ranked.filter(function (p) {
      if (state.geo) {
        if (state.geo.indexOf('cont:') === 0) {
          if (M.continentOf[p.country] !== state.geo.slice(5)) return false;
        } else if (p.country !== state.geo) return false;
      }
      if (state.country && p.country !== state.country) return false;
      if (state.continent && M.continentOf[p.country] !== state.continent) return false;
      if (state.region && M.regionOf[M.continentOf[p.country]] !== state.region) return false;
      if (state.gender && state.gender !== 'all' && genderOf(p.gender) !== state.gender) return false;
      if (state.y0 && p.end < state.y0) return false;
      if (state.y1 && p.start > state.y1) return false;
      if ((state.evSel && state.evSel.length) || (state.group === 'custom' && state.customIds && state.customIds.length)) {
        const sel = (state.evSel && state.evSel.length) ? state.evSel : state.customIds;
        if (!p.events.some(function (e) { return sel.indexOf(e) >= 0; })) return false;
      } else if (scoped && state.group !== 'custom') {
        if (!p.events.some(function (e) { return pool.indexOf(e) >= 0; })) return false;
      }
      return true;
    });
    const sev = singleEvent(state);
    const evs = sev ? [] : modeEvents(state);
    const bd = sev ? eventBoard(sev) : null;
    const bdM = evs.length >= 2 ? evs.map(function (ev) { return { ev: ev, b: eventBoard(ev), w: evWeight(ev) }; }) : null;
    /* 项目口径：显式选了项目就只统计这些项目上的六维分，名次与条尾数字随之重排。 */
    const scope = evScopeIds(state);
    const useEv = !!scope && hasSixEv();
    rows = rows.map(function (p) {
      const sc = scoreOf(p, rt);
      let score = sc.overall, vec = null, inEv = null;
      if (useEv) {
        inEv = sixIn(p, scope);
        score = inEv ? inEv.t : 0;
        vec = inEv ? inEv.s : null;
      }
      const row = { p: p, score: score, sc: sc, six: vec, ev: sev || '', be: bd ? (bd.idx[p.id] || null) : null, bdLen: bd ? bd.len : 0, evs: null, evHit: inEv ? inEv.hit : 0, evSum: 0, orderVal: score };
      /* 多项目：额外算出每个所选项目上的世界名次，用于「色块」展示与排序。 */
      if (bdM) {
        let sw = 0, sv = 0, hit = 0;
        const cells = bdM.map(function (o) {
          const e = o.b.idx[p.id] || null;
          sw += o.w;
          if (e) { const v = o.w * evBarPct(e.r, o.b.len); sv += v; hit++; }
          return { ev: o.ev, e: e, w: o.w, len: o.b.len };
        });
        row.evs = cells;
        row.evHit = hit;
        row.evSum = sw > 0 ? sv / sw : 0;
      }
      /* 排序键：row.score ＝ 所选项目范围内的六维总分（未收窄时＝全站六维总分），
         单项目 / 多项目 / 全部项目共用同一把尺子，名次与条尾数字永远一致。 */
      return row;
    });
    /* 项目筛选下，在该范围内没有任何六维得分的选手不进榜（分数为 0 无意义） */
    if (useEv) rows = rows.filter(function (r) { return r.score > 0; });
    if (bdM) rows = rows.filter(function (r) { return r.evHit > 0; });
    return sortRows(rows, state);
  };

  function sortRows(rows, state) {
    const k = state.sortKey || 'score';
    const dir = state.sortDir === 'asc' ? 1 : -1;
    const val = function (row) {
      const p = row.p;
      switch (k) {
      case 'score':
      case 'total':
        return row.score;
      case 'player': return p.name;
      case 'country': return p.country;
      case 'gender': return p.gender;
        default:
          /* 单维排名取六维维度分；项目筛选生效时用「所选项目范围内」的维度分
             （row.six 由 sixIn 逐维求和得到），保证与榜单总分同一口径。 */
          if (MOD.indexOf(k) >= 0) {
            const ix = SIXD.indexOf(k);
            if (row.six && ix >= 0) return row.six[ix] || 0;
            return (p.six && p.six[k] != null) ? p.six[k] : 0;
          }
          if (k === 'wr') return p.wr;
          if (k === 'wc') return p.wcGold;
          if (k === 'months') return p.months1;
          if (k === 'dom') {
            if (row.six) return row.six[3] || 0;
            return (p.six && p.six.m4 != null) ? p.six.m4 : 0;
          }
          return 0;
      }
    };
    return rows.slice().sort(function (a, b) {
      const va = val(a), vb = val(b);
      if (typeof va === 'string') return va.localeCompare(vb) * dir;
      return (va - vb) * dir;
    });
  }

  P.rank = function (state) {
    const allRows = P.filtered(state);
    /* 仅统计前 1000 名（排序已在 filtered 内完成，这里截断） */
    const rowsAll = allRows.length > RANK_TOP ? allRows.slice(0, RANK_TOP) : allRows;
    const rt = state.recType || 'all';
    const per = 20;
    const evMode = rowsAll.length ? (rowsAll[0].ev || '') : '';
    const firstRow = rowsAll[0] || null;
    const multiMode = !!(firstRow && firstRow.evs && firstRow.evs.length >= 2);
    const evsShown = multiMode ? firstRow.evs.map(function (c) { return c.ev; }) : [];
    const maxScore = Math.max(1, rowsAll.reduce(function (m, r) { return Math.max(m, r.score); }, 0));
    const pages = Math.max(1, Math.ceil(rowsAll.length / per));
    const pg = Math.min(pages, Math.max(1, state.page));
    const rows = rowsAll.slice((pg - 1) * per, pg * per);

    let h = '<div class="page-head reveal"><h1>' + esc(t('rank.title')) + '</h1><p class="sub">' + esc(t('rank.sub')) + '</p></div>';

    h += '<div class="rank-toolbar reveal">';
    if (evMode || multiMode) {
      const label = evMode ? evName(M.EV[evMode]) : evsShown.map(function (e) { return evName(M.EV[e] || { zh: e, en: e }); }).join(' + ');
      h += '<span class="tag acc ev-tag">' + esc(label) + ' · ' + esc(t('rank.evMode')) + '</span>';
      h += '<span class="tiny muted">' + esc(t('rank.evNote', { ev: label })) + '</span>';
    } else {
      h += '<div class="seg" id="tabSeg">';
      RANK_TABS.forEach(function (tb) {
        h += '<button data-tab="' + tb + '" class="' + (state.tab === tb ? 'on' : '') + '">' + esc(t('rank.tab.' + tb)) + '</button>';
      });
      h += '</div>';
      h += '<span class="tiny muted">' + esc(t('rank.tab.' + state.tab + '.d')) + '</span>';
    }
    /* 柱状图堆叠方式开关：按项目（各项目六维小计相加）/ 按维度（六维加权贡献相加）。
       两者只是「把总分拆成几段的切法」不同，段宽合计都等于该行总分。 */
    const scopeIds = evScopeIds(state);
    const useEv = !!scopeIds && hasSixEv();
    const stackMode = stackModeOf(state, evMode, multiMode);
    h += '<span class="tiny muted">' + esc(t('rank.stackLabel')) + '</span>';
    h += '<div class="seg stack-seg" id="stackSeg" title="' + esc(t('rank.stackTip')) + '" role="group" aria-label="' + esc(t('rank.stackLabel')) + '">';
    h += '<button data-stack="ev" class="' + (stackMode === 'ev' ? 'on' : '') + '" aria-pressed="' + (stackMode === 'ev' ? 'true' : 'false') + '">' + esc(t('rank.stackEv')) + '</button>';
    h += '<button data-stack="dim" class="' + (stackMode === 'dim' ? 'on' : '') + '" aria-pressed="' + (stackMode === 'dim' ? 'true' : 'false') + '">' + esc(t('rank.stackDim')) + '</button>';
    h += '</div>';
    h += '<span class="spacer"></span>';
    /* 成绩口径（总计 / 单次 / 平均）已由顶部筛选条统一提供，
       此处不再重复放一套，避免两处控件看起来互相独立却只有一个生效。 */
    if (rt !== 'all') {
      h += '<span class="tag acc">' + esc(t('rank.type')) + ' · ' + esc(t('rank.type.' + rt)) + '</span>';
    }
    h += '<span class="tiny muted">' + esc(t('rank.perPage')) + '</span>';
    h += '<a class="btn" href="#/model">' + Ic.glyph('sliders') + ' ' + esc(t('rank.params')) + '</a>';
    h += '</div>';
    if (multiMode || evMode) {
      /* 口径说明：三种选择方式统一按「历史地位分」排序，项目筛选只影响选手池与广度折减 */
      h += '<div class="note-box reveal">' + Ic.glyph('info') + '<div>' + esc(t('rank.ruleNote')) + '</div></div>';
    }
    if (stackMode === 'dim') {
      /* 维度图例：色块＝六维加权贡献（段宽合计 = 该行总分） */
      h += '<div class="ev-legend reveal">';
      SIXD.forEach(function (k) {
        const nm = (M.meta && M.meta.sixNames && M.meta.sixNames[k]) || modName(k);
        h += '<span class="ev-lg"><i style="background:' + MODC[k] + '"></i>' + esc(nm) + '</span>';
      });
      h += '<span class="tiny muted">' + esc(t('rank.stackDimNote')) + '</span></div>';
    } else if (multiMode) {
      h += '<div class="ev-legend reveal">';
      evsShown.forEach(function (ev, i) {
        h += '<span class="ev-lg"><i style="background:' + evColorOf(ev) + '"></i>' + esc(evName(M.EV[ev] || { zh: ev, en: ev })) + '</span>';
      });
      h += '<span class="tiny muted">' + esc(t('rank.evMultiNote')) + '</span></div>';
    }
    if (!evMode && !multiMode && state.tab === 'peak') h += '<div class="warnbox reveal" style="margin-bottom:12px">' + esc(t('rank.peakNote')) + '</div>';

    h += '<div class="table-wrap reveal"><table class="data rank-table"><thead><tr>';
    COLS.forEach(function (c) {
      const isSorted = (state.sortKey || 'score') === c.k;
      const arw = isSorted ? (state.sortDir === 'asc' ? '▲' : '▼') : '';
      if (c.k === 'exp') { h += '<th class="tl exp-col"></th>'; return; }
      if (c.k === 'bars') { h += '<th class="bars-head bars-full">' + esc(t(evMode ? 'rank.evScore' : c.label)) + '</th>'; return; }
      h += '<th class="' + (c.cls || '') + (isSorted ? ' sorted' : '') + '" data-sort="' + c.k + '">' +
        esc(c.label ? t(c.label) : '') + '<span class="arw">' + arw + '</span></th>';
    });
    h += '</tr></thead><tbody>';

    const startNo = (pg - 1) * per;
    rows.forEach(function (row, i) {
      const p = row.p, no = startNo + i + 1;
      const score = row.score;
      const cap = (window.GOAT && typeof window.GOAT.barMax === 'number') ? window.GOAT.barMax : 100;
      const bw = Math.max(6, Math.min(score / maxScore * 100, cap));
      const topCls = no === 1 ? 'top1' : (no === 2 ? 'top2' : (no === 3 ? 'top3' : ''));
      h += '<tr data-pid="' + p.id + '" data-prow="' + p.id + '" class="' + (topCls ? topCls + '-row' : '') + '" style="cursor:pointer">';
      h += '<td class="tl"><div class="rank-cell"><span class="rank-no ' + topCls + '">' + no + '</span></div></td>';
      h += '<td class="tl"><div class="pname">' + playerLink(p) + '</div></td>';
      h += '<td class="tl gcol">' + genderBadge(p) + '</td>';
      h += '<td class="tl"><span class="region-cell">' + flag(p.country) + '<span class="rname">' + esc(countryName(p.country)) + '</span></span></td>';
      /* 柱状图：条长＝分数占榜首比例；内部堆叠条按工具栏「堆叠方式」开关二选一──
         · ev  —— 各项目的六维小计相加（段宽 = t_ev ÷ 合计）
         · dim —— 六维加权贡献相加（段宽 = w_d·s_d ÷ 合计）
         段宽合计都等于条长所代表的分数，与排序/条尾数字永远同一把尺子。
         单项目模式下「按项目」必然只有一段（整条单色），所以默认走「按维度」，
         这样只看一个项目时也能看清是 M1…M6 哪几维在撑着这个分数。 */
      const stack = stackHtml(row, stackMode, useEv ? scopeIds : null, rt);
      h += '<td class="barcell bars-full"><div class="bar-row' + (evMode || multiMode ? ' evmode' : '') + '"><div class="bar-track">' +
        '<div class="bar-grow" style="width:' + bw.toFixed(1) + '%">' + stack + '</div></div>' +
        '<span class="bar-total">' + U.fmt(score, 2) + '</span>' +
        /* 世界名次只作参考（排序按六维分），放在 tooltip 里避免又被读成排序依据 */
        (evMode && row.be ? '<span class="ev-rank" title="' + esc(t('rank.evRankTip')) + '">No.' + row.be.r + '</span>' : '') +
        (multiMode ? '<span class="ev-hitnote">' + row.evHit + '/' + evsShown.length + '</span>' : '') +
        '</div></td>';
      h += '<td class="tl exp-col"><button class="expand-btn" data-expand="' + p.id + '" aria-label="' + esc(t('ui.more')) + '">›</button></td>';
      h += '</tr>';
      h += '<tr class="exp-row" data-expfor="' + p.id + '" hidden><td colspan="' + COLS.length + '"><div class="exp-slot" data-body="' + p.id + '"></div></td></tr>';
    });
    h += '</tbody></table></div>';

    h += '<div class="pager">';
    h += '<button data-page="1"' + (pg === 1 ? ' disabled' : '') + '>«</button>';
    h += '<button data-page="' + (pg - 1) + '"' + (pg === 1 ? ' disabled' : '') + '>‹</button>';
    h += '<div class="pages">';
    const from = Math.max(1, pg - 2), to = Math.min(pages, from + 4);
    for (let i = from; i <= to; i++) h += '<button data-page="' + i + '" class="' + (i === pg ? 'on' : '') + '">' + i + '</button>';
    h += '</div>';
    h += '<button data-page="' + (pg + 1) + '"' + (pg === pages ? ' disabled' : '') + '>›</button>';
    h += '<button data-page="' + pages + '"' + (pg === pages ? ' disabled' : '') + '">»</button>';
    h += '<span class="info">' + esc(t('rank.pager', { a: startNo + 1, b: Math.min(startNo + per, rowsAll.length), n: rowsAll.length })) + '</span>';
    const tot = (M.meta && M.meta.players) || rowsAll.length;
    /* 达到 1000 名上限时说明是「按上限截断」，否则说明是筛选后的真实人数 */
    if (allRows.length > rowsAll.length) {
      h += '<span class="info tiny muted">' + esc(t('rank.topCap', { n: U.num(rowsAll.length) })) + '</span>';
    } else if (tot > rowsAll.length) {
      h += '<span class="info tiny muted">' + esc(t('rank.coverage', { n: U.num(rowsAll.length), t: U.num(tot) })) + '</span>';
    }
    h += '</div>';
    return h;
  };

  /* 展开行：身份 + 六维总分 + 六维贡献（带条形）+ 成绩速览
     布局重构为「上：身份与总分条／中：模块贡献（横向条，最直观）／下：成绩速览」三层，
     取代旧版左右两栏里数字堆叠的排布。 */
  P.expandBody = function (p, state) {
    const rt = (state && state.recType) || 'all';
    /* 项目筛选生效时，展开行也要显示「所选项目范围内」的六维分，
       否则榜上数字与展开明细对不上（旧版这里恒显示全站分）。 */
    const evPool = (state && hasSixEv()) ? evScopeIds(state) : null;
    const inEv = evPool ? sixIn(p, evPool) : null;
    const sc = scoreOf(p, rt);
    const tab = (state && state.tab === 'peak') ? 'peak' : 'career';
    const cs = contribs(p, tab, rt, inEv ? inEv.s : null);
    const tot = cs.reduce(function (a, c) { return a + c.v; }, 0) || 1;
    const st = M.stats(p);
    const wcaUrl = 'https://www.worldcubeassociation.org/persons/' + encodeURIComponent(String(p.wcaId || p.id).toUpperCase());
    const worldNo = (M.ranked.indexOf(p) + 1) || p.rank || 0;

    /* 模块按贡献从大到小排，条形长度即贡献占比，扫一眼就知道靠什么进的榜 */
    const csDesc = cs.slice().sort(function (a, b) { return b.v - a.v; });

    let h = '<div class="exp-inner exp-v3">';

    /* ── 顶部：国旗 + 姓名 + 三个总分 ───────────────────────── */
    h += '<div class="exp-v3-top">';
    h += '<div class="exp-v3-id">' +
      '<span class="exp-v3-flag">' + flag(p.country, 'f-lg') + '</span>' +
      '<div class="exp-v3-idtxt">' +
      '<div class="exp-v3-nameline"><b class="exp-v3-name">' + esc(p.name) + '</b>' +
        '<span class="exp-v3-wca">WCA · <code>' + esc(String(p.wcaId || p.id)) + '</code></span></div>' +
      '<div class="exp-v3-meta">' +
      '<span class="m-country">' + esc(countryName(p.country)) + '</span>' +
      '<span class="m-gender">' + (genderOf(p.gender) === 'F' ? esc(t('f.gender.f')) : esc(t('f.gender.m'))) + '</span>' +
      '<span class="m-years">' + p.start + '–' + p.end + '</span>' +
      '</div>' +
      '</div></div>';
    h += '<div class="exp-v3-scores">';
    /* 只展示一个口径：六维加权总分（旧模型的生涯 / 巅峰拆分已停用）。
       项目筛选生效时显示所选项目范围内的总分，与榜单名次一致。 */
    h += '<div class="exp-v3-score lead"><span class="k">' + esc(inEv ? t('rank.evScore') : t('rank.tab.overall')) + '</span>' +
      '<span class="v grad">' + U.fmt(inEv ? inEv.t : sc.overall, 2) + '</span></div>';
    h += '<div class="exp-v3-score"><span class="k">' + esc(t('player.rankWorld')) + '</span>' +
      '<span class="v">No.' + worldNo + '</span></div>';
    h += '</div></div>';

    /* ── 中部：六维贡献（横向条） ─────────────────────────── */
    h += '<div class="exp-v3-mods">';
    h += '<div class="exp-v3-mods-h"><span>' + esc(t('rank.sixContrib')) + (inEv ? ' · ' + esc(t('rank.evScope')) : '') + '</span>' +
      '<span class="tiny muted">' + esc(t('player.contrib')) + ' · Σ = ' + U.fmt(tot, 2) + '</span></div>';
    /* 列头：让右侧四列数字（原始分 / 权重 / 加权贡献 / 占比）各自有名字，
       否则展开后只剩一串「100.0 51% 50.78 67.0%」看不出含义。 */
    h += '<div class="exp-v3-mod exp-v3-mod-head">' +
      '<span class="nm">' + esc(t('rank.dimCol')) + '</span>' +
      '<span class="track"></span>' +
      '<span class="raw" title="' + esc(t('expCol.rawD')) + '">' + esc(t('player.raw')) + '</span>' +
      '<span class="w" title="' + esc(t('expCol.wD')) + '">' + esc(t('player.weight')) + '</span>' +
      '<span class="v" title="' + esc(t('expCol.vD')) + '">' + esc(t('player.contrib')) + '</span>' +
      '<span class="pc" title="' + esc(t('expCol.pcD')) + '">' + esc(t('player.pct')) + '</span></div>';
    csDesc.forEach(function (c) {
      const pct = c.v / tot * 100;
      h += '<div class="exp-v3-mod">' +
        '<span class="nm"><i style="background:' + c.color + '"></i>' + esc(c.name) + '</span>' +
        '<span class="track"><i style="width:' + Math.max(1.5, pct).toFixed(1) + '%;background:' + c.color + '"></i></span>' +
        '<span class="raw" title="' + esc(t('player.raw')) + '">' + U.fmt(c.raw, 2) + '</span>' +
        '<span class="w" title="' + esc(t('player.weight')) + '">' + U.fmt(c.w * 100, 0) + '%</span>' +
        '<span class="v">' + U.fmt(c.v, 2) + '</span>' +
        '<span class="pc">' + U.fmt(pct, 1) + '%</span></div>';
    });
    h += '</div>';

    /* ── 底部：成绩速览 + 纪录亮点 + 操作 ───────────────────── */
    h += '<div class="exp-v3-foot">';
    h += '<div class="exp-v3-chips">';
    h += '<span class="exp-v3-chip"><span class="k">' + esc(t('player.comps')) + '</span><b>' + U.num(p.comps) + '</b></span>';
    h += '<span class="exp-v3-chip"><span class="k">' + esc(t('stat.podiumTotal')) + '</span><b>' + U.num(st.podiumTotal || p.podTotal || 0) + '</b></span>';
    h += '<span class="exp-v3-chip"><span class="k">' + esc(t('player.rankWorld')) + '</span><b>No.' + worldNo + '</b></span>';
    h += '</div>';
    h += '<div class="exp-v3-recs">';
    /* WR/CR/NR 只在此处出现一次，并按所选项目（单/多）收窄；
       未筛选项目时统计全部项目（即全站口径）。 */
    const recs = (p.records && p.records.length)
      ? ((evPool && evPool.length) ? p.records.filter(function (r) { return evPool.indexOf(r.ev) >= 0; }) : p.records)
      : [];
    if (recs.length) {
      const byLv = { WR: 0, CR: 0, NR: 0 };
      let longest = null;
      recs.forEach(function (r) {
        if (byLv[r.level] != null) byLv[r.level] = (byLv[r.level] || 0) + 1;
        if (!longest || r.held > longest.held) longest = r;
      });
      ['WR', 'CR', 'NR'].forEach(function (lv) {
        if (!byLv[lv]) return;
        h += '<span class="rec-chip lv-' + lv + '">' + lv + ' ×' + byLv[lv] + '</span>';
      });
      if (longest) h += '<span class="rec-chip"><b>' + esc(t('rec.heldLongest')) + '</b> ' + esc(heldText(longest.held)) + '</span>';
      if (evPool && evPool.length) h += '<span class="rec-chip rec-scope">' + esc(t('rank.evScope')) + '</span>';
    }
    h += '</div>';
    h += '<div class="exp-actions">' +
      '<a class="btn btn-primary" href="#/player/' + p.id + '">' + esc(t('player.title')) + '</a>' +
      '<button class="btn" data-pkadd="' + p.id + '">' + esc(t('player.compare')) + '</button>' +
      '<a class="btn" href="' + wcaUrl + '" target="_blank" rel="noopener">WCA ↗</a></div>';
    h += '</div>';

    h += '</div>';
    return h;
  };

  /* 保持时长：精确到月份 */
  function heldText(days) {
    const d = Math.max(0, Math.round(days || 0));
    const m = Math.round(d / 30.4375);
    if (m < 1) return d + ' ' + (t.isEn() ? 'days' : '天');
    if (m < 12) return m + ' ' + (t.isEn() ? 'mo' : '个月');
    const y = Math.floor(m / 12), mo = m % 12;
    return y + ' ' + (t.isEn() ? 'y' : '年') + (mo ? ' ' + mo + (t.isEn() ? 'mo' : '个月') : '');
  }
  P.heldText = heldText;
  P.util.heldText = heldText;
})();

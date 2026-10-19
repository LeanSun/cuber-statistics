/* ============================================================
   pages-core.js — 首页 / 综合总榜
   ============================================================ */
(function () {
  const t = window.I18N, U = window.U, M = window.MOCK, Ic = window.Icons, Pm = window.Params;
  const MOD = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7'];
  const MODC = { m1: 'var(--m1)', m2: 'var(--m2)', m3: 'var(--m3)', m4: 'var(--m4)', m5: 'var(--m5)', m6: 'var(--m6)', m7: 'var(--m7)' };
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
  function strength(p) { return Math.max(0.02, Math.min(1, (p.eloPeak - 1400) / 900)); }
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
  function scoreOf(p, rt) {
    const c = Pm.weighted(modsOf(p, 'career', rt)), pk = Pm.weighted(modsOf(p, 'peak', rt));
    return { career: c, peak: pk, overall: Pm.overall(c, pk), balance: Math.log(Math.max(c, 0.01) / Math.max(pk, 0.01)) };
  }
  function contribs(p, tab, rt) {
    const w = Pm.weights();
    const mods = modsOf(p, tab, rt);
    return MOD.map(function (k) { return { k: k, name: modName(k), raw: mods[k] || 0, w: w[k], v: w[k] * (mods[k] || 0), color: MODC[k] }; });
  }
  /* 行内迷你堆叠条（七模块加权贡献） */
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
  function ecBox(type, data, opts, h) {
    const payload = { type: type, data: data, opts: opts || {} };
    return '<div class="ec" data-ec="' + esc(JSON.stringify(payload)) + '" style="height:' + (h || 320) + 'px"></div>';
  }
  function infoTip(text) {
    return '<span class="tip" tabindex="0" aria-label="' + esc(text) + '">' + Ic.glyph('info', 'tip-ic') + '<span class="tip-body">' + esc(text) + '</span></span>';
  }
  function fmtScore(x) { return U.fmt(x, 1); }

  P.util = {
    MOD: MOD, MODC: MODC, modName: modName, flag: flag, avatar: avatar, playerLink: playerLink,
    evName: evName, contName: contName, regionName: regionName, countryName: countryName,
    scoreOf: scoreOf, contribs: contribs, ecBox: ecBox, infoTip: infoTip, strength: strength, fmtScore: fmtScore,
    topicPool: topicPool
  };

  /* 另类统计页的候选池：套用顶部筛选条（国家 / 大洲 / 性别 / 年份区间 /
     预设分组 / 事件多选 / 停办项目），使全局筛选在该页同样生效 */
  function topicPool(state) {
    const pool = (state.group && state.group !== 'all') ? eventSet(state)
      : ((state.evSel && state.evSel.length) ? state.evSel : null);
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

  /* ================= 首页 ================= */
  P.home = function () {
    const feats = [
      { k: 'rank', href: '#/rank', ic: 'trophy' },
      { k: 'speed', href: '#/rank?g=speed', ic: 'speed' },
      { k: 'blind', href: '#/rank?g=blind', ic: 'blind' },
      { k: 'unknown', href: '#/topics?tab=other', ic: 'king' },
      { k: 'cn', href: '#/rank?country=CN', ic: 'flag' },
      { k: 'timeline', href: '#/timeline', ic: 'timeline' },
      { k: 'topics', href: '#/topics', ic: 'medal' },
      { k: 'model', href: '#/model', ic: 'book' },
      { k: 'pk', href: '#/pk', ic: 'pk' }
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
    h += '<div class="sec-head reveal"><h2>' + esc(t('home.overview')) + '</h2></div>';
    h += '<div class="card reveal"><div class="grid grid-4">';
    h += '<div class="stat"><div class="k">' + esc(t('home.stat.players')) + '</div><div class="v hc1" data-count="' + sc.players + '" data-dec="0">0</div></div>';
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
  const RANK_TABS = ['overall', 'career', 'peak'];
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
  /* 多项目模式配色：按项目在事件表中的次序稳定取色 */
  const EVCOL = ['#5b8cff', '#ff7a5c', '#3ecf8e', '#c084fc', '#f5c542', '#4dd0e1', '#ff8fb1', '#9ccc65', '#ffb74d', '#7e9cff'];
  function evColor(i) { return EVCOL[i % EVCOL.length]; }

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
    rows = rows.map(function (p) {
      const sc = scoreOf(p, rt);
      let score = sc[state.tab] || sc.overall;
      if (state.group === 'custom' && state.customIds && state.customIds.length) {
        const hit = p.events.filter(function (e) { return state.customIds.indexOf(e) >= 0; }).length;
        score = score * (0.45 + 0.55 * (hit / state.customIds.length));
      } else if (scoped && state.group !== 'custom') {
        const hit = p.events.filter(function (e) { return pool.indexOf(e) >= 0; }).length;
        score = score * (0.45 + 0.55 * (hit / pool.length));
      }
      const row = { p: p, score: score, sc: sc, ev: sev || '', be: bd ? (bd.idx[p.id] || null) : null, bdLen: bd ? bd.len : 0, evs: null, evHit: 0, evSum: 0 };
      /* 多项目模式：按选手在「所选各项目世界名次」上的加权表现重新排名 */
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
        if (hit > 0) row.score = row.evSum;
      }
      return row;
    });
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
        /* 单项目模式同样按历史地位分排序（该项目世界名次仅作条尾参考列） */
        return row.score;
      case 'player': return p.name;
      case 'country': return p.country;
      case 'gender': return p.gender;
        default:
          if (MOD.indexOf(k) >= 0) return (state.tab === 'peak' ? p.pk : p.m)[k];
          if (k === 'wr') return p.wr;
          if (k === 'wc') return p.wcGold;
          if (k === 'months') return p.months1;
          if (k === 'elo') return p.eloPeak;
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
    const rowsAll = P.filtered(state);
    const rt = state.recType || 'all';
    const per = 50;
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
    h += '<span class="spacer"></span>';
    /* 成绩口径：总计 / 单次 / 平均（只影响 M1 纪录分） */
    h += '<div class="seg" id="typeSeg" title="' + esc(t('rank.type.d')) + '">';
    [['all', 'rank.type.all'], ['single', 'rank.type.single'], ['avg', 'rank.type.avg']].forEach(function (x) {
      h += '<button data-type="' + x[0] + '" class="' + (rt === x[0] ? 'on' : '') + '">' + esc(t(x[1])) + '</button>';
    });
    h += '</div>';
    h += '<span class="tiny muted">' + esc(t('rank.perPage')) + '</span>';
    h += '<a class="btn" href="#/model">' + Ic.glyph('sliders') + ' ' + esc(t('rank.params')) + '</a>';
    h += '</div>';
    if (multiMode) {
      h += '<div class="ev-legend reveal">';
      evsShown.forEach(function (ev, i) {
        h += '<span class="ev-lg"><i style="background:' + evColor(i) + '"></i>' + esc(evName(M.EV[ev] || { zh: ev, en: ev })) + '</span>';
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
      const modTab = state.tab === 'peak' ? p.pk : p.m;
      const score = row.score;
      const cap = (window.GOAT && typeof window.GOAT.barMax === 'number') ? window.GOAT.barMax : 100;
      const bw = Math.max(6, Math.min(score / maxScore * 100, cap));
      const topCls = no === 1 ? 'top1' : (no === 2 ? 'top2' : (no === 3 ? 'top3' : ''));
      h += '<tr data-pid="' + p.id + '" data-prow="' + p.id + '" class="' + (topCls ? topCls + '-row' : '') + '" style="cursor:pointer">';
      h += '<td class="tl"><div class="rank-cell"><span class="rank-no ' + topCls + '">' + no + '</span></div></td>';
      h += '<td class="tl"><div class="pname">' + playerLink(p) + '</div></td>';
      h += '<td class="tl gcol">' + genderBadge(p) + '</td>';
      h += '<td class="tl"><span class="region-cell">' + flag(p.country) + '<span class="rname">' + esc(countryName(p.country)) + '</span></span></td>';
      if (multiMode && row.evs) {
        /* 多项目：堆叠条＝各所选项目的加权贡献（色块即项目，越满＝该项目世界名次越靠前） */
        const wSum = evsShown.reduce(function (a, ev) { return a + evWeight(ev); }, 0) || 1;
        let segs = '';
        row.evs.forEach(function (c, ci) {
          if (!c.e) return;
          const val = c.w * evBarPct(c.e.r, c.len) / wSum;
          const rel = row.evSum > 0 ? val / row.evSum * 100 : 0;
          segs += '<span style="width:' + Math.max(1.5, Math.min(100, rel)).toFixed(1) + '%;background:' + evColor(ci) + '" title="' +
            esc(evName(M.EV[c.ev] || { zh: c.ev, en: c.ev })) + ' #' + c.e.r + '"></span>';
        });
        h += '<td class="barcell bars-full"><div class="bar-row evmode">' +
          '<div class="bar-grow" style="width:' + bw.toFixed(1) + '%"><div class="ministack evstack">' + segs + '</div></div>' +
          '<span class="ev-res">' + U.fmt(row.evSum, 1) + '</span>' +
          '<span class="bar-total ev-rank">' + esc(t('rank.evMulti')) + ' ' + row.evHit + '/' + evsShown.length + '</span></div></td>';
      } else if (evMode) {
        /* 单项目：保留七模块堆叠条（说明分值构成），并显示该项目成绩与世界名次 */
        const be = row.be;
        const w = be ? evBarPct(be.r, row.bdLen) : 6;
        h += '<td class="barcell bars-full"><div class="bar-row evmode">' +
          '<div class="bar-grow" style="width:' + w.toFixed(1) + '%">' + miniStack(p, modTab, rt) + '</div>' +
          '<span class="ev-res">' + (be ? esc(be.s) + (be.af ? ' <i>/</i> ' + esc(be.af) : '') : '<span class="muted">—</span>') + '</span>' +
          '<span class="bar-total ev-rank"' + (be ? ' title="' + esc(t('player.rankWorld')) + '">#' + be.r : ' class="bar-total muted">—') + '</span></div></td>';
      } else {
        h += '<td class="barcell bars-full"><div class="bar-row"><div class="bar-grow" style="width:' + bw.toFixed(1) + '%">' + miniStack(p, modTab, rt) + '</div><span class="bar-total">' + U.fmt(score, 1) + '</span></div></td>';
      }
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
    if (tot > rowsAll.length) {
      h += '<span class="info tiny muted">' + esc(t('rank.coverage', { n: U.num(rowsAll.length), t: U.num(tot) })) + '</span>';
    }
    h += '</div>';
    return h;
  };

  /* 展开行：每模块 分值 / 权重 / 加权贡献（#10） */
  P.expandBody = function (p, state) {
    const rt = (state && state.recType) || 'all';
    const sc = scoreOf(p, rt);
    const tab = (state && state.tab === 'peak') ? 'peak' : 'career';
    const cs = contribs(p, tab, rt);
    const tot = cs.reduce(function (a, c) { return a + c.v; }, 0) || 1;
    const st = M.stats(p);
    const wcaUrl = 'https://www.worldcubeassociation.org/persons/' + encodeURIComponent(String(p.wcaId || p.id).toUpperCase());

    let h = '<div class="exp-inner exp-v2">';

    /* 左：选手身份 + 三个总分大数字 */
    h += '<div class="exp-v2-side">';
    h += '<div class="exp-v2-who"><span class="exp-v2-flag">' + flag(p.country, 'f-lg') + '</span>' +
      '<div><b>' + esc(p.name) + '</b><div class="tiny muted">' + esc(countryName(p.country)) + ' · ' +
      (genderOf(p.gender) === 'F' ? esc(t('f.gender.f')) : esc(t('f.gender.m'))) + ' · ' + p.start + '–' + p.end + '</div></div></div>';
    h += '<div class="exp-v2-scores">';
    [['overall', sc.overall], ['career', sc.career], ['peak', sc.peak]].forEach(function (s) {
      h += '<div class="exp-v2-score"><span class="k">' + esc(t('rank.tab.' + s[0])) + '</span><span class="v">' + U.fmt(s[1], 1) + '</span></div>';
    });
    h += '</div>';
    h += '<div class="exp-v2-facts">';
    const facts = [
      [t('col.wr'), p.wr], [t('col.cr') || 'CR', p.cr], [t('col.nr') || 'NR', p.nr],
      [t('col.comps') || '参赛', p.comps], [t('col.months') || '项目', (p.events || []).length],
      [t('player.rankWorld'), (M.ranked.indexOf(p) + 1) || p.rank || '—']
    ];
    facts.forEach(function (f) {
      h += '<div class="exp-v2-fact"><span>' + esc(f[0]) + '</span><b>' + esc(String(f[1])) + '</b></div>';
    });
    h += '</div>';
    h += '</div>';

    /* 右：七模块贡献表 + 纪录 / 领奖台摘要 */
    h += '<div class="exp-v2-main">';
    h += '<div class="exp-modtable">';
    h += '<div class="exp-modrow bk-head"><span>' + esc(t('rank.module')) + '</span><span class="bk-num">' + esc(t('player.raw')) + '</span><span class="bk-num">' + esc(t('player.weight')) + '</span><span class="bk-num">' + esc(t('player.contrib')) + '</span><span class="bk-num">' + esc(t('player.pct')) + '</span></div>';
    cs.forEach(function (c) {
      h += '<div class="exp-modrow"><span class="bk-name"><i style="background:' + c.color + '"></i>' + esc(c.name) + '</span>' +
        '<span class="bk-num">' + U.fmt(c.raw, 1) + '</span>' +
        '<span class="bk-num">' + U.fmt(c.w * 100, 1) + '%</span>' +
        '<span class="bk-num"><b>' + U.fmt(c.v, 2) + '</b></span>' +
        '<span class="bk-num">' + U.fmt(c.v / tot * 100, 1) + '%</span></div>';
    });
    h += '</div>';

    /* 纪录亮点：按层级统计 + 保持最久的一条 */
    if (p.records && p.records.length) {
      const byLv = { WR: 0, CR: 0, NR: 0 };
      let longest = null;
      p.records.forEach(function (r) { byLv[r.level] = (byLv[r.level] || 0) + 1; if (!longest || r.held > longest.held) longest = r; });
      h += '<div class="exp-v2-chips">';
      ['WR', 'CR', 'NR'].forEach(function (lv) {
        if (!byLv[lv]) return;
        h += '<span class="rec-chip lv-' + lv + '">' + lv + ' ×' + byLv[lv] + '</span>';
      });
      if (longest) h += '<span class="rec-chip">' + esc(t('rec.held')) + ' ' + esc(heldText(longest.held)) + '</span>';
      h += '</div>';
    }
    h += '</div>';

    h += '<div class="exp-actions">' +
      '<a class="btn btn-primary" href="#/player/' + p.id + '">' + esc(t('player.title')) + '</a>' +
      '<button class="btn" data-pkadd="' + p.id + '">' + esc(t('player.compare')) + '</button>' +
      '<a class="btn" href="' + wcaUrl + '" target="_blank" rel="noopener">WCA ↗</a></div>';
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

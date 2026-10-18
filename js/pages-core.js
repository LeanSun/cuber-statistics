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
  /* 旗帜：优先使用国内可达的 jsDelivr 镜像（flag-icons），失败时回退为文字代码 */
  function flag(iso, cls) {
    if (!iso) return '';
    iso = String(iso).toLowerCase();
    const url = 'https://cdn.jsdelivr.net/gh/lipis/flag-icons@7.5.0/flags/4x3/' + iso + '.svg';
    return '<img class="flag ' + (cls || '') + '" src="' + url + '" alt="' + esc(iso) + '" title="' + esc(M.countries[iso] || iso) + '" loading="lazy" onerror="this.onerror=null;this.outerHTML=\'<span class=&quot;flag-fb&quot;>' + esc(iso.toUpperCase()) + '</span>\'">';
  }
  /* 头像：优先拉取 WCA 官方头像，失败则回退为首字母底色（由 app.js 注入的 goatAvatarFallback 处理） */
  function avatar(p, cls) {
    const ini = U.initials(p.name), hue = p.hue;
    const wca = p.wcaId ? 'https://www.worldcubeassociation.org/static/person-photo/' + encodeURIComponent(String(p.wcaId).toUpperCase()) + '.jpg' : '';
    if (!wca) return '<span class="avatar ' + (cls || '') + '" style="background:hsl(' + hue + ',56%,48%)">' + esc(ini) + '</span>';
    return '<img class="avatar ' + (cls || '') + '" src="' + wca + '" alt="' + esc(p.name) + '" loading="lazy" data-cls="' + (cls || '') + '" data-hue="' + hue + '" data-ini="' + esc(ini) + '" onerror="if(window.goatAvatarFallback)window.goatAvatarFallback(this)">';
  }
  /* 性别归一化：兼容 'Male'/'Female'/'m'/'f' 等各种真实导出写法 */
  function genderOf(g) { if (!g) return ''; g = String(g).charAt(0).toUpperCase(); return g === 'F' ? 'F' : 'M'; }
  function playerLink(p) { return '<a class="linkish" href="#/player/' + p.id + '">' + esc(p.name) + '</a>'; }
  function evName(e) { return t.isEn() ? e.en : e.zh; }
  function contName(c) { const o = M.continents[c]; return o ? (t.isEn() ? o.en : o.zh) : (c || '—'); }
  function regionName(r) { const o = M.regions[r]; return o ? (t.isEn() ? o.en : o.zh) : (r || '—'); }
  function countryName(iso) { return M.countries[iso] || iso; }
  function strength(p) { return Math.max(0.02, Math.min(1, (p.eloPeak - 1400) / 900)); }
  function scoreOf(p) {
    const c = Pm.weighted(p.m), pk = Pm.weighted(p.pk);
    return { career: c, peak: pk, overall: Pm.overall(c, pk), balance: Math.log(Math.max(c, 0.01) / Math.max(pk, 0.01)) };
  }
  function contribs(p, tab) {
    const w = Pm.weights();
    const mods = tab === 'peak' ? p.pk : p.m;
    return MOD.map(function (k) { return { k: k, name: modName(k), raw: mods[k], w: w[k], v: w[k] * mods[k], color: MODC[k] }; });
  }
  /* 行内迷你堆叠条（七模块加权贡献） */
  function miniStack(p, tab) {
    const cs = contribs(p, tab);
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
    scoreOf: scoreOf, contribs: contribs, ecBox: ecBox, infoTip: infoTip, strength: strength, fmtScore: fmtScore
  };

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
  const COLS = [
    { k: 'rank', label: 'col.rank', cls: 'tl' },
    { k: 'player', label: 'col.player', cls: 'tl' },
    { k: 'gender', label: 'col.gender', cls: 'tl gcol' },
    { k: 'country', label: 'col.country', cls: 'tl' },
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

  /* 单项目模式：筛选条件恰好只选中一个项目时，按该项目成绩单独排名 */
  function singleEvent(state) {
    if (state.evSel && state.evSel.length === 1) return state.evSel[0];
    if (state.evSel && state.evSel.length > 1) return '';
    if (state.group === 'custom') return '';
    const pool = eventSet(state);
    return pool.length === 1 ? pool[0] : '';
  }
  /* 每项目榜单（ETL 预计算，按该项目世界排名） */
  function eventBoard(ev) {
    const arr = (M.eventBoards || {})[ev];
    if (!arr || !arr.length) return { list: [], idx: {}, len: 0 };
    const idx = {};
    arr.forEach(function (e) { idx[e.id] = e; });
    return { list: arr, idx: idx, len: arr.length };
  }
  /* 色条宽度：按世界排名对数缩放，使不同页面的相对位置可见 */
  function evBarPct(r, len) {
    if (!r || r <= 0) return 6;
    return Math.max(6, Math.min(100, 100 * (1 - Math.log(r) / Math.log((len || 2000) + 1))));
  }

  P.filtered = function (state) {
    const pool = eventSet(state);
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
    const bd = sev ? eventBoard(sev) : null;
    rows = rows.map(function (p) {
      const sc = scoreOf(p);
      let score = sc[state.tab] || sc.overall;
      if (state.group === 'custom' && state.customIds && state.customIds.length) {
        const hit = p.events.filter(function (e) { return state.customIds.indexOf(e) >= 0; }).length;
        score = score * (0.45 + 0.55 * (hit / state.customIds.length));
      } else if (scoped && state.group !== 'custom') {
        const hit = p.events.filter(function (e) { return pool.indexOf(e) >= 0; }).length;
        score = score * (0.45 + 0.55 * (hit / pool.length));
      }
      return { p: p, score: score, sc: sc, ev: sev || '', be: bd ? (bd.idx[p.id] || null) : null, bdLen: bd ? bd.len : 0 };
    });
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
        /* 单项目模式：按该项目世界排名排序（升序即从好到差） */
        if (row.ev) return row.be ? -row.be.r : -1e9;
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
    const per = 50;
    const evMode = rowsAll.length ? (rowsAll[0].ev || '') : '';
    const maxScore = Math.max(1, rowsAll.reduce(function (m, r) { return Math.max(m, r.score); }, 0));
    const pages = Math.max(1, Math.ceil(rowsAll.length / per));
    const pg = Math.min(pages, Math.max(1, state.page));
    const rows = rowsAll.slice((pg - 1) * per, pg * per);

    let h = '<div class="page-head reveal"><h1>' + esc(t('rank.title')) + '</h1><p class="sub">' + esc(t('rank.sub')) + '</p></div>';

    h += '<div class="rank-toolbar reveal">';
    if (evMode) {
      h += '<span class="tag acc ev-tag">' + esc(evName(M.EV[evMode])) + ' · ' + esc(t('rank.evMode')) + '</span>';
      h += '<span class="tiny muted">' + esc(t('rank.evNote', { ev: evName(M.EV[evMode]) })) + '</span>';
    } else {
      h += '<div class="seg" id="tabSeg">';
      ['career', 'peak', 'overall'].forEach(function (tb) {
        h += '<button data-tab="' + tb + '" class="' + (state.tab === tb ? 'on' : '') + '">' + esc(t('rank.tab.' + tb)) + '</button>';
      });
      h += '</div>';
      h += '<span class="tiny muted">' + esc(t('rank.tab.' + state.tab + '.d')) + '</span>';
    }
    h += '<span class="spacer"></span>';
    h += '<span class="tiny muted">' + esc(t('rank.perPage')) + '</span>';
    h += '<a class="btn" href="#/model">' + Ic.glyph('sliders') + ' ' + esc(t('rank.params')) + '</a>';
    h += '</div>';
    if (!evMode && state.tab === 'peak') h += '<div class="warnbox reveal" style="margin-bottom:12px">' + esc(t('rank.peakNote')) + '</div>';

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
      h += '<td class="tl"><div class="pname">' + avatar(p) + playerLink(p) + '</div></td>';
      h += '<td class="tl gcol">' + genderBadge(p) + '</td>';
      h += '<td class="tl">' + flag(p.country) + '</td>';
      if (evMode) {
        /* 单项目模式：显示该项目最佳成绩（单次 / 平均）与该项目世界排名 */
        const be = row.be;
        if (be) {
          const w = evBarPct(be.r, row.bdLen);
          h += '<td class="barcell bars-full"><div class="bar-row evmode">' +
            '<div class="bar-grow" style="width:' + w.toFixed(1) + '%"></div>' +
            '<span class="ev-res">' + esc(be.s) + (be.af ? ' <i>/</i> ' + esc(be.af) : '') + '</span>' +
            '<span class="bar-total ev-rank" title="' + esc(t('player.rankWorld')) + '">#' + be.r + '</span></div></td>';
        } else {
          h += '<td class="barcell bars-full"><div class="bar-row evmode">' +
            '<div class="bar-grow" style="width:6%"></div>' +
            '<span class="ev-res muted">—</span>' +
            '<span class="bar-total muted">—</span></div></td>';
        }
      } else {
        h += '<td class="barcell bars-full"><div class="bar-row"><div class="bar-grow" style="width:' + bw.toFixed(1) + '%">' + miniStack(p, modTab) + '</div><span class="bar-total">' + U.fmt(score, 1) + '</span></div></td>';
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
    h += '</div>';
    return h;
  };

  /* 展开行：每模块 分值 / 权重 / 加权贡献（#10） */
  P.expandBody = function (p, state) {
    const sc = scoreOf(p);
    const tab = (state && state.tab === 'peak') ? 'peak' : 'career';
    const cs = contribs(p, tab);
    const tot = cs.reduce(function (a, c) { return a + c.v; }, 0) || 1;
    let h = '<div class="exp-inner">';
    h += '<div class="exp-summary">' +
      '<span><b>' + esc(t('rank.tab.career')) + '</b> ' + U.fmt(sc.career, 1) + '</span>' +
      '<span><b>' + esc(t('rank.tab.peak')) + '</b> ' + U.fmt(sc.peak, 1) + '</span>' +
      '<span><b>' + esc(t('rank.tab.overall')) + '</b> ' + U.fmt(sc.overall, 1) + '</span>' +
      '<span><b>' + esc(t('col.balance')) + '</b> ' + U.fmt(sc.balance, 2) + '</span></div>';
    /* 单项目模式：补充该项目最佳成绩 */
    if (state && state.evSel && state.evSel.length === 1) {
      const be = ((M.eventBoards || {})[state.evSel[0]] || []).filter(function (x) { return x.id === p.id; })[0];
      if (be) {
        h += '<div class="exp-summary exp-evsum">' +
          '<span><b>' + esc(t('rank.evScore')) + '</b> ' + esc(be.s) + (be.af ? ' <i>/</i> ' + esc(be.af) : '') + '</span>' +
          '<span><b>' + esc(t('player.rankWorld')) + '</b> #' + be.r + '</span></div>';
      }
    }
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
    h += '<div class="exp-actions"><a class="btn" href="#/player/' + p.id + '">' + esc(t('player.title')) + '</a>' +
      '<button class="btn" data-pkadd="' + p.id + '">' + esc(t('player.compare')) + '</button></div>';
    h += '</div>';
    return h;
  };
})();

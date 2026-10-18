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
  function flag(iso, cls) {
    if (!iso) return '';
    return '<img class="flag ' + (cls || '') + '" src="https://flagcdn.com/w40/' + iso.toLowerCase() + '.png" alt="' + esc(iso) + '" title="' + esc(M.countries[iso] || iso) + '" loading="lazy" onerror="this.outerHTML=\'<span class=&quot;flag-fb&quot;>' + esc(iso) + '</span>\'">';
  }
  function avatar(p, cls) {
    return '<span class="avatar ' + (cls || '') + '" style="background:hsl(' + p.hue + ',56%,48%)">' + esc(U.initials(p.name)) + '</span>';
  }
  function playerLink(p) { return '<a class="linkish" href="#/player/' + p.id + '">' + esc(p.name) + '</a>'; }
  function evName(e) { return t.isEn() ? e.en : e.zh; }
  function contName(c) { const o = M.continents[c]; return o ? (t.isEn() ? o.en : o.zh) : c; }
  function regionName(r) { const o = M.regions[r]; return o ? (t.isEn() ? o.en : o.zh) : r; }
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

    h += '<div class="sec-head reveal"><h2>' + esc(t('home.feat')) + '</h2></div>';
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

    const sc = M.meta;
    h += '<div class="card reveal" style="margin-top:16px"><div class="grid grid-4">';
    h += '<div class="stat"><div class="k">' + esc(t('home.stat.players')) + '</div><div class="v hc1" data-count="' + sc.players + '" data-dec="0">0</div></div>';
    h += '<div class="stat"><div class="k">' + esc(t('home.stat.comps')) + '</div><div class="v hc2" data-count="' + sc.comps + '" data-dec="0">0</div></div>';
    h += '<div class="stat"><div class="k">' + esc(t('home.stat.wr')) + '</div><div class="v hc3" data-count="' + sc.wr + '" data-dec="0">0</div></div>';
    h += '<div class="stat"><div class="k">' + esc(t('home.stat.records')) + '</div><div class="v hc4" data-count="' + sc.records + '" data-dec="0">0</div></div>';
    h += '</div></div>';
    return h;
  };

  /* ================= 综合总榜 ================= */
  const COLS = [
    { k: 'rank', label: 'col.rank', cls: 'tl' },
    { k: 'player', label: 'col.player', cls: 'tl' },
    { k: 'bars', label: 'col.contrib', cls: '' },
    { k: 'country', label: 'col.country', cls: 'tl' },
    { k: 'total', label: 'col.total' },
    { k: 'm1', label: 'col.m1', cls: 'hidden-sm' }, { k: 'm2', label: 'col.m2', cls: 'hidden-sm' },
    { k: 'm3', label: 'col.m3', cls: 'hidden-sm' }, { k: 'm4', label: 'col.m4', cls: 'hidden-sm' },
    { k: 'm5', label: 'col.m5', cls: 'hidden-sm' }, { k: 'm6', label: 'col.m6', cls: 'hidden-sm' },
    { k: 'm7', label: 'col.m7', cls: 'hidden-sm' },
    { k: 'wr', label: 'col.wr' }, { k: 'wc', label: 'col.wc' },
    { k: 'months', label: 'col.months', cls: 'hidden-sm' }, { k: 'elo', label: 'col.elo' },
    { k: 'exp', label: '', cls: 'tl' }
  ];

  /* 项目集合：预设分组 / 自定义分组 / 单个项目 / 停办开关 */
  function eventSet(state) {
    const incRetired = state.retired;
    let ids = null;
    if (state.group === 'custom') {
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

  P.filtered = function (state) {
    const pool = eventSet(state);
    const scoped = !!state.group && state.group !== 'all';
    let rows = M.ranked.filter(function (p) {
      if (state.country && p.country !== state.country) return false;
      if (state.continent && M.continentOf[p.country] !== state.continent) return false;
      if (state.region && M.regionOf[M.continentOf[p.country]] !== state.region) return false;
      if (state.gender && state.gender !== 'all' && p.gender !== state.gender) return false;
      if (state.y0 && p.end < state.y0) return false;
      if (state.y1 && p.start > state.y1) return false;
      if (state.group === 'custom' && state.customIds && state.customIds.length) {
        if (!p.events.some(function (e) { return state.customIds.indexOf(e) >= 0; })) return false;
      } else if (scoped && state.group !== 'custom') {
        if (!p.events.some(function (e) { return pool.indexOf(e) >= 0; })) return false;
      }
      return true;
    });
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
      return { p: p, score: score, sc: sc };
    });
    return sortRows(rows, state);
  };

  function sortRows(rows, state) {
    const k = state.sortKey || 'score';
    const dir = state.sortDir === 'asc' ? 1 : -1;
    const val = function (row) {
      const p = row.p;
      switch (k) {
        case 'score': return row.score;
        case 'player': return p.name;
        case 'country': return p.country;
        case 'total': return row.score;
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
    const pages = Math.max(1, Math.ceil(rowsAll.length / per));
    const pg = Math.min(pages, Math.max(1, state.page));
    const rows = rowsAll.slice((pg - 1) * per, pg * per);

    let h = '<div class="page-head reveal"><h1>' + esc(t('rank.title')) + '</h1><p class="sub">' + esc(t('rank.sub')) + '</p></div>';

    h += '<div class="rank-toolbar reveal">';
    h += '<div class="seg" id="tabSeg">';
    ['career', 'peak', 'overall'].forEach(function (tb) {
      h += '<button data-tab="' + tb + '" class="' + (state.tab === tb ? 'on' : '') + '">' + esc(t('rank.tab.' + tb)) + '</button>';
    });
    h += '</div>';
    h += '<span class="tiny muted">' + esc(t('rank.tab.' + state.tab + '.d')) + '</span>';
    h += '<span class="spacer"></span>';
    h += '<span class="tiny muted">' + esc(t('rank.perPage')) + '</span>';
    h += '<a class="btn" href="#/model">' + Ic.glyph('sliders') + ' ' + esc(t('rank.params')) + '</a>';
    h += '</div>';
    if (state.tab === 'peak') h += '<div class="warnbox reveal" style="margin-bottom:12px">' + esc(t('rank.peakNote')) + '</div>';

    h += '<div class="table-wrap reveal"><table class="data"><thead><tr>';
    COLS.forEach(function (c) {
      const isSorted = (state.sortKey || 'score') === c.k;
      const arw = isSorted ? (state.sortDir === 'asc' ? '▲' : '▼') : '';
      if (c.k === 'exp') { h += '<th class="tl"></th>'; return; }
      if (c.k === 'bars') { h += '<th class="bars-head">' + esc(t(c.label)) + '</th>'; return; }
      h += '<th class="' + (c.cls || '') + (isSorted ? ' sorted' : '') + '" data-sort="' + c.k + '">' +
        esc(c.label ? t(c.label) : '') + '<span class="arw">' + arw + '</span></th>';
    });
    h += '</tr></thead><tbody>';

    const startNo = (pg - 1) * per;
    rows.forEach(function (row, i) {
      const p = row.p, no = startNo + i + 1;
      const modTab = state.tab === 'peak' ? p.pk : p.m;
      const topCls = no === 1 ? 'top1' : (no === 2 ? 'top2' : (no === 3 ? 'top3' : ''));
      h += '<tr data-pid="' + p.id + '" data-prow="' + p.id + '" style="cursor:pointer">';
      h += '<td class="tl"><div class="rank-cell"><span class="rank-no ' + topCls + '">' + no + '</span></div></td>';
      h += '<td class="tl"><div class="pname">' + avatar(p) + playerLink(p) + '</div></td>';
      h += '<td class="barcell">' + miniStack(p, modTab) + '</td>';
      h += '<td class="tl">' + flag(p.country) + '</td>';
      h += '<td class="num"><b>' + U.fmt(row.score, 1) + '</b></td>';
      MOD.forEach(function (k) { h += '<td class="num hidden-sm">' + U.fmt(modTab[k], 1) + '</td>'; });
      h += '<td class="num">' + p.wr + '</td><td class="num">' + p.wcGold + '</td>';
      h += '<td class="num hidden-sm">' + p.months1 + '</td><td class="num">' + p.eloPeak + '</td>';
      h += '<td class="tl"><button class="expand-btn" data-expand="' + p.id + '" aria-label="' + esc(t('ui.more')) + '">›</button></td>';
      h += '</tr>';
      h += '<tr class="exp-row" data-expfor="' + p.id + '" hidden><td colspan="' + COLS.length + '"><div class="exp-slot" data-body="' + p.id + '"></div></td></tr>';
    });
    h += '</tbody></table></div>';

    /* 堆叠柱状图 */
    if (rows.length) {
      const chartRows = rows.slice(0, 25).map(function (r) {
        const cs = contribs(r.p, state.tab);
        return { name: r.p.name, values: cs.map(function (c) { return c.v; }), total: cs.reduce(function (a, c) { return a + c.v; }, 0) };
      });
      const max = Math.max.apply(null, chartRows.map(function (d) { return d.total; })) * 1.05;
      h += '<div class="card reveal" style="margin-top:14px">';
      h += '<div class="card-head"><h2>' + esc(t('rank.chartTitle')) + '</h2><span class="tiny muted">' + esc(t('rank.contribution')) + '</span></div>';
      h += '<p class="tiny muted" style="margin-bottom:10px">' + esc(t('rank.chartNote')) + '</p>';
      h += ecBox('stacked', chartRows, {
        max: Math.round(max * 10) / 10, legend: true,
        series: MOD.map(function (k, i) { return { name: modName(k), color: MODC[k] }; })
      }, Math.max(300, chartRows.length * 22 + 90));
      h += '</div>';
    }

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

  /* 展开行：每模块分值 / 权重 / 加权贡献 */
  P.expandBody = function (p, state) {
    const w = Pm.weights();
    const sc = scoreOf(p);
    const cs = contribs(p, state.tab);
    const tot = cs.reduce(function (a, c) { return a + c.v; }, 0) || 1;

    let h = '<div class="exp-inner">';
    h += '<div class="exp-col">';
    h += '<div class="tiny muted" style="margin-bottom:8px">' + esc(t('rank.contribution')) + '</div>';
    h += ecBox('stacked', [{ name: p.name, values: cs.map(function (c) { return c.v; }) }], {
      max: Math.round(tot * 1.02 * 10) / 10,
      series: MOD.map(function (k) { return { name: modName(k), color: MODC[k] }; })
    }, 92);
    h += '<div class="modlegend">' + MOD.map(function (k) {
      return '<span title="' + esc(t('m' + k[1] + '.d')) + '"><i style="background:' + MODC[k] + '"></i>' + esc(modName(k)) + '</span>';
    }).join('') + '</div>';
    h += '</div>';

    h += '<div class="exp-col">';
    h += '<div class="breakdown-row bk-head"><span>' + esc(t('m1.name')) + '</span><span>' + esc(t('player.raw')) + '</span><span class="bk-num">' + esc(t('player.weight')) + '</span><span class="bk-num">' + esc(t('player.contrib')) + '</span><span class="bk-num">' + esc(t('player.pct')) + '</span></div>';
    cs.forEach(function (c) {
      h += '<div class="breakdown-row">';
      h += '<span class="bk-name"><i style="background:' + c.color + '"></i>' + esc(c.name) + '</span>';
      h += '<span class="bk-bar"><i style="width:' + Math.min(100, c.raw) + '%;background:' + c.color + '"></i></span>';
      h += '<span class="bk-num">' + U.fmt(c.raw, 1) + '</span>';
      h += '<span class="bk-num">' + U.fmt(c.w * 100, 1) + '%</span>';
      h += '<span class="bk-num"><b>' + U.fmt(c.v, 2) + '</b></span>';
      h += '<span class="bk-num">' + U.fmt(c.v / tot * 100, 1) + '%</span>';
      h += '</div>';
    });
    h += '<div class="tiny muted" style="margin-top:8px">' +
      esc(t('rank.tab.career')) + ' ' + U.fmt(sc.career, 1) +
      ' · ' + esc(t('rank.tab.peak')) + ' ' + U.fmt(sc.peak, 1) +
      ' · ' + esc(t('col.balance')) + ' ' + U.fmt(sc.balance, 2) + '</div>';
    h += '<div style="margin-top:10px"><a class="btn" href="#/player/' + p.id + '">' + esc(t('player.title')) + '</a> ' +
      '<button class="btn" data-pkadd="' + p.id + '">' + esc(t('player.compare')) + '</button></div>';
    h += '</div></div>';
    return h;
  };
})();

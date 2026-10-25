/* ============================================================
   app.js — 状态 / 路由 / 主题 / 语言 / 交互
   ============================================================ */
(function () {
  const t = window.I18N, U = window.U, M = window.MOCK, P = window.P, Pm = window.Params;
  const view = document.getElementById('view');
  const navEl = document.getElementById('nav');
  const fbEl = document.getElementById('filterbar');
  const toastEl = document.getElementById('toast');
  const esc = U.esc;

  /* ---------- 长尾名册（懒加载） ----------
     js/data.js 只带可排名的头部选手；其余选手（全部 30 万 WCA 注册者）压缩在
     js/roster.js 里，首屏不阻塞，用户开始搜索时才按需载入并合并进搜索索引，
     保证「选手总数」与「搜得到人」覆盖全量 300227。 */
  let roster = null;        // Map<lowerName|id, [轻量选手对象]>
  let rosterLoading = null;
  function rosterURL() {
    const b = document.getElementsByTagName('base')[0];
    const base = b ? b.getAttribute('href') : './';
    return (base || './') + 'js/roster.js';
  }
  function loadRoster() {
    if (roster) return Promise.resolve(roster);
    if (rosterLoading) return rosterLoading;
    rosterLoading = new Promise(function (res, rej) {
      const s = document.createElement('script');
      s.src = rosterURL();
      s.async = true;
      s.onload = function () {
        const R = window.WCA_ROSTER;
        if (!R || !R.rows) { res(null); return; }
        const map = new Map();
        R.rows.split('\n').forEach(function (line) {
          if (!line) return;
          const f = line.split('~');
          const o = {
            id: f[0], wcaId: f[0], name: f[1], nameZh: null,
            country: f[2], gender: f[3], overall: +f[4] || 0,
            start: +f[5] || 0, end: +f[6] || 0, comps: +f[7] || 0,
            events: f[8] ? f[8].split(',') : [],
            roster: 1, slim: 1, records: [], podiums: [],
            m: {}, pk: {}, yearly: {}, yearlyS: {}, yearlyA: {},
            wr: 0, cr: 0, nr: 0, recTotal: 0, podTotal: 0, nrW: 0,
            months1: 0, months10: 0, months100: 0, peakSpan: 0, peakAge: 0,
            wcGold: 0, ccGold: 0, ncGold: 0, eloPeak: 1500
          };
          o.career = o.overall; o.peak = o.overall;
          o.hue = 0; o.mainEvent = o.events[0] || '';
          o.cities = 0; o.dnf = 0; o.resultRows = 0; o.attempts = 0; o.solves = 0;
          o.maxEventsPerComp = 0; o.multiEventComp = 0;
          const push = function (k) {
            const kk = k.toLowerCase();
            let a = map.get(kk); if (!a) { a = []; map.set(kk, a); }
            a.push(o);
          };
          push(o.id); push(o.name);
        });
        roster = map;
        res(roster);
      };
      s.onerror = function () { res(null); };
      document.head.appendChild(s);
    });
    return rosterLoading;
  }
  /* 在已有选手 + 名册里搜索；名册未载入时先载入再搜 */
  function searchAll(q, q2, limit) {
    const hit = function (src) {
      return src.filter(function (p) {
        if (String(p.wcaId || p.id).toLowerCase().indexOf(q2) >= 0) return true;
        if (p.name.toLowerCase().indexOf(q) >= 0) return true;
        if (p.country.toLowerCase() === q) return true;
        if ((M.countries[p.country] || '').toLowerCase().indexOf(q) >= 0) return true;
        if ((M.countriesZh && (M.countriesZh[p.country] || '').indexOf(q) >= 0)) return true;
        return p.events.some(function (e) {
          const E = M.EV[e]; if (!E) return false;
          return (E.zh && E.zh.indexOf(q) >= 0) || (E.en && E.en.toLowerCase().indexOf(q) >= 0);
        });
      }).sort(function (a, b) { return b.overall - a.overall; }).slice(0, limit || 12);
    };
    const local = hit(M.ranked);
    if (!roster) return Promise.resolve(local);
    /* 先看名册里有没有更靠前的命中 */
    const tail = [];
    roster.forEach(function (arr, k) {
      if (k.indexOf(q2) >= 0 || k.indexOf(q) >= 0) tail.push.apply(tail, arr);
    });
    const seen = {};
    const all = local.concat(tail);
    all.forEach(function (p) { seen[p.id] = 1; });
    return Promise.resolve(Object.keys(seen).map(function (id) {
      return all.filter(function (p) { return p.id === id; })[0];
    }).sort(function (a, b) { return b.overall - a.overall; }).slice(0, limit || 12));
  }
  window.WB_roster = { load: loadRoster, search: searchAll, has: function () { return !!roster; } };

  const state = {
    tab: 'overall', sortKey: 'score', sortDir: 'desc', page: 1,
    group: 'all', customIds: [], evSel: [], country: '', continent: '', region: '',
    gender: 'all', y0: null, y1: null, retired: false, recType: 'all',
    scope: 'country', geo: '',
    pk: [], tlView: 'race', tlMode: 'cumulative', tlFy: 2025, tlStep: 'day', tlMetric: 'overall', tlLane: 'single', tlSmooth: false, tlPlaying: false, tlRegion: '', tlCountry: '', msPopOpen: false,
    topicTab: 'rec', topicStat: '', otherTab: 'king', nationMetric: 'total', counterZero: 'wr', topicBoard: ''
  };

  /* 播放原点（天索引 / 起始毫秒），供拖动时间轴实时跳转而保留连续播放 */
  let tlPlayIdx = 0, tlPlayMs = 0;

  /* ---------- 数字跳动动画（首页统计） ---------- */
  function countUp(el) {
    if (!el) return;
    const target = parseFloat(el.getAttribute('data-count')) || 0;
    const dec = parseInt(el.getAttribute('data-dec') || '0', 10);
    const dur = 1150;
    const t0 = performance.now();
    function step(now) {
      const k = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      const v = target * e;
      el.textContent = dec ? v.toFixed(dec) : Math.round(v).toLocaleString('en-US');
      if (k < 1) requestAnimationFrame(step);
      else el.textContent = dec ? target.toFixed(dec) : Math.round(target).toLocaleString('en-US');
    }
    requestAnimationFrame(step);
  }
  function animateHomeStats() {
    view.querySelectorAll('.stat .v[data-count]').forEach(countUp);
  }

  /* ---------- 头像加载失败回退（首字母底色） ---------- */
  window.goatAvatarFallback = function (img) {
    if (!img || !img.parentNode) return;
    var s = document.createElement('span');
    s.className = 'avatar ' + (img.getAttribute('data-cls') || '');
    s.style.background = 'hsl(' + (img.getAttribute('data-hue') || 0) + ',56%,48%)';
    s.textContent = img.getAttribute('data-ini') || '';
    img.parentNode.replaceChild(s, img);
  };

  /* ---------- 首页随机渐变彩蛋（#1 #2）：每次刷新打乱六色渐变顺序 ---------- */
  function applyGradientEgg() {
    try {
      var root = document.documentElement;
      var cs = getComputedStyle(root);
      var keys = ['--m1', '--m2', '--m3', '--m4', '--m5', '--m6'];
      var cols = keys.map(function (k) { return cs.getPropertyValue(k).trim(); });
      for (var i = cols.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var t = cols[i]; cols[i] = cols[j]; cols[j] = t;
      }
      var stops = cols.map(function (c, idx) { return c + ' ' + Math.round(idx * 100 / (cols.length - 1)) + '%'; }).join(',');
      root.style.setProperty('--grad-egg', 'linear-gradient(100deg,' + stops + ')');
    } catch (e) { }
  }

  /* ---------- 总榜行展开 / 折叠 ---------- */
  function toggleRow(id) {
    const row = view.querySelector('[data-expfor="' + id + '"]');
    if (!row) return;
    row.hidden = !row.hidden;
    const tr = view.querySelector('tr[data-pid="' + id + '"]');
    if (tr) tr.classList.toggle('expanded', !row.hidden);
    const btn = view.querySelector('.expand-btn[data-expand="' + id + '"]');
    if (btn) btn.textContent = row.hidden ? '›' : '⌄';
    if (!row.hidden) {
      const slot = row.querySelector('[data-body="' + id + '"]');
      if (slot && !slot.innerHTML) {
        const p = M.ranked.filter(function (x) { return x.id === id; })[0];
        if (p && P.expandBody) { slot.innerHTML = P.expandBody(p, state); window.Charts.mount(slot); }
      }
    }
  }
  let tlTimer = null;
  /* 播放用的动画帧句柄（rAF 驱动，逐帧推进时间轴） */
  let tlRaf = 0;
  let lastRoute = '';
  let lastScroll = 0;

  /* ---------- 主题 ---------- */
  function initTheme() {
    let th = null;
    try { th = localStorage.getItem('goat-theme'); } catch (e) { }
    if (!th) th = (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
    applyTheme(th);
    applyGradientEgg();
  }
  function applyTheme(th) {
    document.documentElement.setAttribute('data-theme', th);
    const ic = document.getElementById('themeIcon');
    if (ic) ic.textContent = th === 'dark' ? '☾' : '☀';
    if (window.Charts) window.Charts.refresh();
  }
  function toggleTheme() {
    const cur = document.documentElement.getAttribute('data-theme');
    const next = cur === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    try { localStorage.setItem('goat-theme', next); } catch (e) { }
    render(true);
  }

  /* ---------- 语言 ---------- */
  function initLang() {
    let lg = 'zh';
    try { lg = localStorage.getItem('goat-lang') || 'zh'; } catch (e) { }
    applyLang(lg);
  }
  function applyLang(lg) {
    t.set(lg);
    document.documentElement.lang = lg === 'en' ? 'en' : 'zh-CN';
    const b = document.getElementById('langBtn');
    if (b) b.textContent = lg === 'zh' ? 'EN' : '中';
  }
  function toggleLang() {
    const next = t.get() === 'zh' ? 'en' : 'zh';
    applyLang(next);
    try { localStorage.setItem('goat-lang', next); } catch (e) { }
    render(true);
  }
  function applyStaticI18n() {
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      el.textContent = t(el.getAttribute('data-i18n'));
    });
  }

  /* ---------- 路由 ---------- */
  /* URL 查询参数只在「地址栏真的变了」时套用一次。
     此前 render() 每次都重新读取 ?country=xx，于是用户在筛选条里换地区后，
     state.geo 刚改完就被 URL 里的旧值覆盖回去，表现为页面被「定格」在原筛选上。 */
  let hashConsumed = null;
  function applyRouteQuery(route, q, rawHash) {
    const fresh = rawHash !== hashConsumed;
    hashConsumed = rawHash;
    if (!fresh) return;
    if (route === 'rank') {
      if (q.g) state.group = q.g;
      if (q.country) state.geo = q.country;
    }
    if (route === 'topics' && q.tab) state.topicTab = q.tab;
  }

  function parseHash() {
    const raw = (location.hash || '').replace(/^#/, '') || '/home';
    const anchor = (raw.indexOf('#') >= 0) ? raw.split('#').pop() : '';
    const main = anchor ? raw.slice(0, raw.lastIndexOf('#')) : raw;
    const parts = main.split('?');
    const seg = parts[0].split('/').filter(Boolean);
    const q = {};
    if (parts[1]) {
      parts[1].split('&').forEach(function (kv) {
        const p = kv.split('=');
        if (p[0]) q[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || '');
      });
    }
    return { seg: seg, q: q, anchor: anchor };
  }

  function renderNav(route) {
    const items = [
      ['rank', '#/rank'], ['timeline', '#/timeline'],
      ['topics', '#/topics'], ['model', '#/model']
    ];
    navEl.innerHTML = items.map(function (x) {
      const active = (route === x[0] || (x[0] === 'rank' && route === 'player')) ? ' class="active"' : '';
      return '<a href="' + x[1] + '"' + active + '>' + esc(t('nav.' + x[0])) + '</a>';
    }).join('');
  }

  /* ---------- 顺序：语言感知置顶 ---------- */
  function orderedCountries() {
    const en = t.isEn();
    const list = M.nations.slice();
    const priIso = en ? 'US' : 'CN';
    const priCont = en ? 'NAm' : 'As';
    return list.sort(function (a, b) {
      const pa = a.iso === priIso ? 0 : (a.continent === priCont ? 1 : 2);
      const pb = b.iso === priIso ? 0 : (b.continent === priCont ? 1 : 2);
      if (pa !== pb) return pa - pb;
      return a.name.localeCompare(b.name);
    });
  }
  function orderedContinents() {
    const en = t.isEn();
    const keys = Object.keys(M.continents);
    return keys.sort(function (a, b) {
      const pa = (en ? a === 'NAm' : a === 'As') ? 0 : M.continents[a].pri;
      const pb = (en ? b === 'NAm' : b === 'As') ? 0 : M.continents[b].pri;
      return pa - pb;
    });
  }
  function orderedRegions() {
    const en = t.isEn();
    const keys = Object.keys(M.regions);
    return keys.sort(function (a, b) {
      const pa = (en ? a === 'NAR' : a === 'AsR') ? 0 : 1;
      const pb = (en ? b === 'NAR' : b === 'AsR') ? 0 : 1;
      if (pa !== pb) return pa - pb;
      return M.regions[a].en.localeCompare(M.regions[b].en);
    });
  }

  /* ---------- 筛选条 ---------- */
  function groupList() {
    const preset = M.presetGroups.filter(function (g) { return g.id !== 'all'; });
    return preset.concat(window.EvGroups.all());
  }

  function renderFilterBar(route) {
    if (route !== 'rank' && route !== 'timeline' && route !== 'topics') { fbEl.hidden = true; fbEl.innerHTML = ''; return; }
    fbEl.hidden = false;
    let h = '<div class="filterbar-inner">';

    /* ---------- 预设分组（快速筛选） + 事件图标多选（仅总榜 / 图表可视化；趣味统计页用页面内筛选） ---------- */
    if (route !== 'topics') {
      h += '<div class="fgroup ev-fgroup">';
      h += '<div class="fctl presets" id="fgGroup">';
      const presets = [{ id: 'all', zh: t('f.all'), en: t('f.all') }].concat(M.presetGroups.filter(function (g) { return g.id !== 'all'; }));
      presets.forEach(function (g) {
        const on = state.group === g.id && !(state.evSel && state.evSel.length);
        h += '<button class="chip' + (on ? ' on' : '') + '" data-group="' + g.id + '">' + esc(t.isEn() ? g.en : g.zh) + '</button>';
      });
      h += '</div>';
      /* 趣味统计页用页面内的「项目筛选」(data-topicev) 作为唯一项目筛选，
         顶部不再重复渲染项目图标条，避免上下两套互相打架。 */
      h += '<div class="ev-strip" id="fgEvents" role="group" aria-label="' + esc(t('f.events')) + '">';
      const evSel = state.evSel || [];
      const gids = (P.groupEventIds ? P.groupEventIds(state) : null);
      const inSet = function (id) { return evSel.indexOf(id) >= 0 || (gids && gids.indexOf(id) >= 0); };
      const activeEv = M.events.filter(function (e) { return !e.retired; });
      const retiredEv = M.events.filter(function (e) { return e.retired; });
      h += '<div class="ev-row">';
      activeEv.forEach(function (e) {
        const on = inSet(e.id);
        h += '<button class="ev-tab' + (on ? ' on' : '') + '" data-evtab="' + e.id + '" title="' + esc(t.isEn() ? e.en : e.zh) + '">' + window.Icons.event(e.id) + '</button>';
      });
      h += '</div>';
      h += '<div class="ev-row ev-row-retired">';
      retiredEv.forEach(function (e) {
        const on = inSet(e.id);
        const dis = !state.retired;
        h += '<button class="ev-tab' + (on ? ' on' : '') + (dis ? ' disabled' : '') + '" data-evtab="' + e.id + '" title="' + esc(t.isEn() ? e.en : e.zh) + '">' + window.Icons.event(e.id) + '</button>';
      });
      h += '</div>';
      h += '</div>';
      h += '</div>';
    }

    /* ---------- 国家 / 大洲 合并为单一下拉（总榜 + 图表可视化 + 另类统计；已移除 WCA 地区分组） ---------- */
    if (route === 'rank' || route === 'timeline' || route === 'topics') {
      h += '<div class="fgroup"><span class="flabel">' + esc(t('f.region')) + '</span><div class="fctl">';
      h += '<select id="fgGeo" class="sel">';
      h += '<option value="">' + esc(t('f.all')) + '</option>';
      const contOrder = ['As', 'NAm', 'SAm', 'Eu', 'Af', 'Oc'];
      h += '<optgroup label="' + esc(t.isEn() ? 'Continents' : '大洲') + '">';
      contOrder.forEach(function (c) {
        const v = 'cont:' + c;
        h += '<option value="' + v + '"' + (state.geo === v ? ' selected' : '') + '>' + esc(t.isEn() ? M.continents[c].en : M.continents[c].zh) + '</option>';
      });
      h += '</optgroup>';
      h += '<optgroup label="' + esc(t.isEn() ? 'Countries' : '国家 / 地区') + '">';
      const fixed = ['CN', 'HK', 'MO', 'TW'];
      const cn = P.util.countryName;
      const optLabel = function (iso) {
        const zh = (M.countriesZh && M.countriesZh[iso]) || cn(iso) || iso;
        return t.isEn() ? (M.countries[iso] || iso) : zh;
      };
      fixed.concat(M.countryList.slice().sort()).filter(function (iso, i, a) { return a.indexOf(iso) === i; }).forEach(function (iso) {
        h += '<option value="' + iso + '"' + (state.geo === iso ? ' selected' : '') + '>' + esc(optLabel(iso)) + '</option>';
      });
      h += '</optgroup>';
      h += '</select></div></div>';
    }

    if (route === 'rank' || route === 'timeline' || route === 'topics') {
      h += '<div class="fgroup"><span class="flabel">' + esc(t('f.gender')) + '</span><div class="fctl">';
      [['all', 'f.gender.all'], ['M', 'f.gender.m'], ['F', 'f.gender.f']].forEach(function (g) {
        h += '<button class="chip' + (state.gender === g[0] ? ' on' : '') + '" data-gender="' + g[0] + '">' + esc(t(g[1])) + '</button>';
      });
      h += '</div></div>';
    }

    if (route === 'rank' || route === 'timeline') {
      /* 成绩口径：总计 / 单次 / 平均（只影响纪录分 M1） */
      h += '<div class="fgroup"><span class="flabel">' + esc(t('rank.type')) + '</span><div class="fctl">';
      [['all', 'rank.type.all'], ['single', 'rank.type.single'], ['avg', 'rank.type.avg']].forEach(function (x) {
        h += '<button class="chip' + ((state.recType || 'all') === x[0] ? ' on' : '') + '" data-type="' + x[0] + '" title="' + esc(t('rank.type.d')) + '">' + esc(t(x[1])) + '</button>';
      });
      h += '</div></div>';

      h += '<div class="fgroup"><span class="flabel">' + esc(t('f.period')) + '</span><div class="fctl">';
      h += '<select id="fgY0"><option value="">1982</option>';
      for (let y = 2003; y <= 2025; y++) h += '<option value="' + y + '"' + (state.y0 === y ? ' selected' : '') + '>' + y + '</option>';
      h += '</select><span class="tiny muted">–</span>';
      h += '<select id="fgY1">';
      for (let y = 2003; y <= 2025; y++) h += '<option value="' + y + '"' + ((state.y1 === y || (state.y1 == null && y === 2025)) ? ' selected' : '') + '>' + y + '</option>';
      h += '</select></div></div>';

      h += '<div class="fgroup"><span class="flabel">' + esc(t('f.retired')) + '</span><div class="fctl">';
      h += '<button class="chip' + (state.retired ? ' on' : '') + '" data-retired="1">' + esc(state.retired ? t('f.include') : t('f.exclude')) + '</button>';
      h += '</div></div>';
    } else if (route === 'topics') {
      h += '<div class="fgroup"><span class="flabel">' + esc(t('f.period')) + '</span><div class="fctl">';
      h += '<select id="fgY0"><option value="">1982</option>';
      for (let y = 2003; y <= 2025; y++) h += '<option value="' + y + '"' + (state.y0 === y ? ' selected' : '') + '>' + y + '</option>';
      h += '</select><span class="tiny muted">–</span>';
      h += '<select id="fgY1">';
      for (let y = 2003; y <= 2025; y++) h += '<option value="' + y + '"' + ((state.y1 === y || (state.y1 == null && y === 2025)) ? ' selected' : '') + '>' + y + '</option>';
      h += '</select></div></div>';

      h += '<div class="fgroup"><span class="flabel">' + esc(t('f.retired')) + '</span><div class="fctl">';
      h += '<button class="chip' + (state.retired ? ' on' : '') + '" data-retired="1">' + esc(state.retired ? t('f.include') : t('f.exclude')) + '</button>';
      h += '</div></div>';
    }

    h += '<button class="btn" id="fgReset">' + esc(t('f.reset')) + '</button>';
    h += '<span class="filter-summary" id="fgSummary"></span>';
    h += '</div>';

    fbEl.innerHTML = h;
  }

  function updateSummary(route) {
    const el = document.getElementById('fgSummary');
    if (!el) return;
    /* 透明化计数：把「WCA 全量注册人数」与「评分体系实际收录并参与排名的人数」两个口径都摆出来，
       避免用户误以为我们只统计了其中一部分。排名榜单始终只覆盖「评分体系收录」的选手，
       因为只有这部分选手拥有可计算 GOAT 分的完整成绩；WCA 全量 30 万+ 人里绝大多数只有零星参赛记录。 */
    const total = (M.meta && M.meta.players) || M.ranked.length;   // WCA 全量注册
    const rated = M.ranked.length;                                  // 评分体系收录并参与排名
    const allEvents = Object.keys(M.EV || {});
    const evAll = (state.evSel && state.evSel.length) ? state.evSel.length >= allEvents.length : true;
    const noFilt = !state.geo && (!state.gender || state.gender === 'all') && !state.y0 && !state.y1
      && evAll && (!state.group || state.group === 'all') && !state.retired;
    let matched = rated;
    if (route === 'rank' || route === 'timeline') matched = noFilt ? rated : P.filtered(state).length;
    else if (route === 'topics') matched = P.util.topicPool(state).length;
    let geoLabel = '';
    if (state.region) geoLabel = P.util.regionName(state.region);
    else if (state.geo) {
      if (state.geo.indexOf('cont:') === 0) geoLabel = P.util.contName(state.geo.slice(5));
      else geoLabel = P.util.countryName(state.geo) || state.geo;
    }
    let main, note;
    if (noFilt && (route === 'rank' || route === 'timeline')) {
      main = t('f.summaryAll', { n: U.num(total), rated: U.num(rated) });
    } else {
      main = t('f.summary', { n: U.num(matched) });
      note = t('f.summaryNote', { rated: U.num(rated), total: U.num(total) });
    }
    el.innerHTML = (geoLabel ? '<b>' + esc(geoLabel) + '</b> · ' : '') + esc(main) + (note ? ' <span class="muted">' + esc(note) + '</span>' : '');
  }

  /* ---------- 主渲染 ---------- */
  function render(keepScroll) {
    const r = parseHash();
    const route = r.seg[0] || 'home';
    const prev = lastRoute;
    if (route === 'model' && r.anchor) state.mdSection = r.anchor;
    applyRouteQuery(route, r.q, location.hash || '');

    const sy = window.scrollY;
    applyStaticI18n();
    renderNav(route);
    renderFilterBar(route);

    let html = '';
    if (route === 'home') { applyGradientEgg(); html = P.home(); }
    else if (route === 'rank') html = P.rank(state);
    else if (route === 'player') html = P.player(r.seg[1] || '');
    else if (route === 'pk') html = P.pk(state);
    else if (route === 'timeline') html = P.timeline(state);
    else if (route === 'topics') html = P.topics(state);
    else if (route === 'model') html = P.model(state);
    else html = P.home();

    view.innerHTML = html;
    updateSummary(route);
    bindReset();
    mount(route);
    renderTray();

    window.requestAnimationFrame(function () {
      if (window.Charts) window.Charts.mount(view);
      if (route === 'timeline') {
        const box = document.getElementById('tlChart');
        if (box && P.drawTimeline) P.drawTimeline(box);
      }
      if (route === 'model' || route === 'player') typeset();
      if (keepScroll || prev === route) { window.scrollTo(0, sy); }
      else window.scrollTo(0, 0);
      lastRoute = route;
    });
    if (route === 'model' && r.anchor) {
      setTimeout(function () { scrollToAnchor(r.anchor); }, 60);
    }
  }

  /* ---------- LaTeX 排版（含离线降级） ---------- */
  let mjReady = false;
  function markMjMissing() {
    if (!mjReady) document.body.classList.add('no-mjx');
  }
  function typeset(scope) {
    const root = scope || view;
    if (!window.MathJax || !window.MathJax.typesetPromise) {
      setTimeout(function () { typeset(scope); }, 400);
      return;
    }
    Promise.resolve(window.MathJax.startup.promise).then(function () {
      return window.MathJax.typesetPromise([root]);
    }).then(function () { mjReady = true; }).catch(function () { });
  }
  setTimeout(markMjMissing, 6000);

  function scrollToAnchor(id) {
    const el = document.getElementById('md-' + id);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
  }

  /* ---------- 页面交互挂载 ---------- */
  function mount(route) {
    if (route === 'home') {
      const inp = document.getElementById('homeSearch');
      const box = document.getElementById('homeSearchResult');
      const form = document.getElementById('homeSearchForm');
      function doSearch() {
        const q = (inp.value || '').trim().toLowerCase();
        if (!q) { box.innerHTML = ''; return; }
        /* 搜索范围＝全量 WCA 选手：data.js 的可排名选手 +懒加载的长尾名册 */
        const q2 = q.replace(/^#/, '');
        box.innerHTML = '<p class="tiny muted">' + esc(t('home.searching')) + '</p>';
        searchAll(q, q2, 12).then(function (hits) {
          if (!hits.length) { box.innerHTML = '<p class="tiny muted">' + esc(t('ui.noresult')) + '</p>'; return; }
          box.innerHTML = '<div class="card" style="padding:10px">' + hits.map(function (p) {
            return '<div class="row" style="gap:10px;padding:5px 0;border-bottom:1px solid var(--border)">' +
              '<a href="#/player/' + p.id + '" style="flex:1">' + esc(p.name) + '</a>' +
              P.util.flag(p.country) + '<span class="tiny muted">' + esc(P.util.countryName(p.country)) + '</span>' +
              '<span class="tiny muted">' + U.fmt(p.overall, 1) + '</span></div>';
          }).join('') + '</div>';
        });
      }
      if (inp) {
        /* 首次输入时才拉取长尾名册，避免首屏加载 30 万条 */
        inp.addEventListener('focus', function () { loadRoster(); }, { once: true });
        inp.addEventListener('input', doSearch);
      }
      if (form) form.addEventListener('submit', function (e) { e.preventDefault(); doSearch(); });
      view.querySelectorAll('.stat .v[data-count]').forEach(countUp);
    }

    if (route === 'pk') {
      const inp = document.getElementById('pkSearch');
      const res = document.getElementById('pkResult');
      function search() {
        const q = (inp.value || '').trim().toLowerCase();
        if (!q) { res.innerHTML = ''; return; }
        const hits = M.ranked.filter(function (p) { return p.name.toLowerCase().indexOf(q) >= 0; }).slice(0, 8);
        res.innerHTML = hits.map(function (p) {
          return '<button class="chip" data-pkadd="' + p.id + '">+ ' + esc(p.name) + '</button>';
        }).join('') || '<span class="tiny muted">' + esc(t('ui.noresult')) + '</span>';
      }
      if (inp) inp.addEventListener('input', search);
      const clr = document.getElementById('pkClear');
      if (clr) clr.addEventListener('click', function () { state.pk = []; render(true); });
    }

    if (route === 'timeline') {
      const range = document.getElementById('tlRange');
      const play = document.getElementById('tlPlay');
      const box = document.getElementById('tlChart');
      const lab = document.getElementById('tlYear');
      /* 重大事件到达提示：跨过某事件的日期时，在竞速图右下角弹出一张卡片。
         用「上一步日期 → 当前日期」的区间判断，拖到哪都会只提示一次。 */
      let lastMsDate = null;
      function msToastFor(prevDate, curDate) {
        const wrap = document.getElementById('msToast');
        if (!wrap || !P.tlMsCrossed || !curDate) return;
        const hits = P.tlMsCrossed(prevDate, curDate);
        if (!hits.length) return;
        hits.slice(0, 3).forEach(function (m, i) {
          const label = t.isEn() ? (m.en || m.zh) : m.zh;
          const card = document.createElement('div');
          card.className = 'ms-toast-card' + (m.custom ? ' ms-custom' : '');
          card.style.animationDelay = (i * 90) + 'ms';
          card.innerHTML = '<span class="ms-toast-ic">' + (window.Icons ? window.Icons.glyph('star') : '') + '</span>' +
            '<div class="ms-toast-b"><b>' + esc(m.date || m.year) + '</b><span>' + esc(String(label)) + '</span></div>';
          wrap.appendChild(card);
          setTimeout(function () { card.classList.add('out'); }, 4200);
          setTimeout(function () { if (card.parentNode) card.parentNode.removeChild(card); }, 4900);
        });
      }
      function setFyFromRange(rg) {
        const idx = +rg.value;
        const info = P.tlIdxToInfo(idx, state.tlStep);
        /* 播放中拖动 / 点击时间轴：把播放原点重置到当前位置，播放从这一刻继续（可实时跳转） */
        if (state.tlPlaying) { tlPlayIdx = idx; tlPlayMs = (window.performance && performance.now) ? performance.now() : Date.now(); }
        const curDate = P.tlDateAtFy ? P.tlDateAtFy(info.fy) : (P.tlDateAt ? P.tlDateAt(idx, state.tlStep) : null);
        if (lastMsDate && curDate && curDate !== lastMsDate) msToastFor(lastMsDate, curDate);
        if (curDate) lastMsDate = curDate;
        state.tlFy = info.fy;
        if (lab) lab.textContent = info.label;
        if (box) { box.setAttribute('data-fy', state.tlFy); P.drawTimeline(box); }
        if (P.tlHighlightRail) P.tlHighlightRail(info.fy);
      }
      if (range) range.addEventListener('input', function () { setFyFromRange(range); });
      if (play) play.addEventListener('click', function () {
        if (state.tlPlaying) { stopPlay(); return; }
        if (!range) return;
        state.tlPlaying = true; play.textContent = t('tl.pause');
        /* 播放改用 requestAnimationFrame 逐帧推进：
           每帧按真实经过的时间算出「应该走到第几天」的小数位置，
           · 日期标签每天变一次（整数天跨过去才更新）；
           · 图表拿小数天去算分数，因此条形长度是连续变化的，不再一格一格跳；
           · 名次换位时图表自己用很短的过渡补间，不会拖慢整体速度。
           播放原点（tlPlayIdx / tlPlayMs）独立保存，拖动时间轴时实时重置，
           因此播放中也能点击 / 拖动滑块跳到任意时间点并继续播放。 */
        const rate = (P.tlRate ? P.tlRate() : { jump: 30, anim: 200, fps: 300 });
        const daysPerSec = Math.max(0.5, rate.jump || 30);
        tlPlayIdx = +range.value;
        tlPlayMs = (window.performance && performance.now) ? performance.now() : Date.now();
        lastMsDate = P.tlDateAtFy ? P.tlDateAtFy(P.tlIdxToInfo(tlPlayIdx, state.tlStep).fy) : null;
        let lastIdx = tlPlayIdx;
        function frame(nowMs) {
          const elapsed = (nowMs - tlPlayMs) / 1000;
          const pos = tlPlayIdx + elapsed * daysPerSec;
          const sl = P.tlSlider(state.tlStep, state.tlFy);
          const idx = Math.min(sl.max, Math.floor(pos));
          const frac = Math.max(0, Math.min(0.999, pos - idx));
          if (idx !== lastIdx) {
            lastIdx = idx;
            range.value = idx;
            const info = P.tlIdxToInfo(idx, state.tlStep);
            if (lab) lab.textContent = info.label;
            if (P.tlHighlightRail) P.tlHighlightRail(info.fy);
          }
          /* 小数天：让分数在两天之间连续插值 */
          const fy = P.tlFyAt ? P.tlFyAt(idx, frac, state.tlStep) : (P.tlIdxToInfo(idx, state.tlStep).fy);
          state.tlFy = fy;
          if (box) { box.setAttribute('data-fy', fy); P.drawTimeline(box); }
          /* 每帧按图表真实时间（小数年→日期）精确检测里程碑跨越，弹窗时间与竞速图严格对应 */
          const curDate = P.tlDateAtFy ? P.tlDateAtFy(fy) : (P.tlDateAt ? P.tlDateAt(idx, state.tlStep) : null);
          if (lastMsDate && curDate && curDate !== lastMsDate) msToastFor(lastMsDate, curDate);
          if (curDate) lastMsDate = curDate;
          if (pos >= sl.max) { stopPlay(); return; }
          tlRaf = requestAnimationFrame(frame);
        }
        tlRaf = requestAnimationFrame(frame);
      });
      function stopPlay() {
        state.tlPlaying = false;
        clearInterval(tlTimer);
        if (tlRaf) { cancelAnimationFrame(tlRaf); tlRaf = 0; }
        const pb = document.getElementById('tlPlay'); if (pb) pb.textContent = t('tl.play');
      }
      /* 动画速率自定义：时间跳跃（天/秒）/ 动画时长 / 刷新间隔。
         滑杆（…Cap）与数字输入框共用同一份状态，互相同步；
         数字框失焦或按回车时按 min/max 夹紧并回写，避免出现 0 天/秒这类无效值。 */
      function syncRateUI(key, val) {
        const cap = document.getElementById('tlRate' + key + 'Cap');
        const num = document.getElementById('tlRate' + key);
        if (cap) cap.value = val;
        if (num && document.activeElement !== num) num.value = val;
        const lab = cap ? cap.parentNode.querySelector('b') : null;
        if (lab) {
          const mt = (P.tlRateMeta && P.tlRateMeta[key]) || null;
          lab.textContent = val + (mt ? mt.unit() : 'ms');
        }
      }
      function applyRate(key, raw, fromNumber) {
        const r = (P.tlRate ? P.tlRate() : { jump: 30, anim: 200, fps: 300 });
        const val = (P.tlClampRate ? P.tlClampRate(key, raw) : parseInt(raw, 10));
        if (isNaN(val)) return;
        r[key] = val;
        try { localStorage.setItem('goat-tlrate-v1', JSON.stringify(r)); } catch (e) { }
        syncRateUI(key, val);
        if (fromNumber) {
          const num = document.getElementById('tlRate' + key);
          if (num && document.activeElement === num) num.value = val;
        }
        /* 任一参数变化都立即重绘当前帧（播放时下一帧也会自然采用新参数），
           不再需要手动刷新页面才生效 */
        if (box) P.drawTimeline(box);
      }
      ['jump', 'anim', 'fps'].forEach(function (key) {
        const cap = document.getElementById('tlRate' + key + 'Cap');
        if (cap) cap.addEventListener('input', function () { applyRate(key, cap.value, false); });
        const num = document.getElementById('tlRate' + key);
        if (num) {
          num.addEventListener('input', function () { applyRate(key, num.value, true); });
          num.addEventListener('change', function () { applyRate(key, num.value, true); });
          num.addEventListener('blur', function () { applyRate(key, num.value, true); });
          num.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); num.blur(); } });
        }
      });
      const rateReset = document.getElementById('tlRateReset');
      if (rateReset) rateReset.addEventListener('click', function () {
        try { localStorage.removeItem('goat-tlrate-v1'); } catch (e) { }
        render(true);
      });
      /* 重大事件弹窗：默认收起，点右下角标签展开/收起（状态跨渲染保持） */
      const msTab = document.getElementById('msPopTab');
      const msBody = document.getElementById('msPopBody');
      if (msTab && msBody) {
        const open = !!state.msPopOpen;
        msBody.hidden = !open;
        msTab.setAttribute('aria-expanded', open ? 'true' : 'false');
        msTab.classList.toggle('on', open);
        msTab.addEventListener('click', function (e) {
          e.stopPropagation();
          state.msPopOpen = msBody.hidden;
          msBody.hidden = !state.msPopOpen;
          msTab.setAttribute('aria-expanded', state.msPopOpen ? 'true' : 'false');
          msTab.classList.toggle('on', state.msPopOpen);
          if (window.Charts && box) { try { window.Charts.render; P.drawTimeline(box); } catch (err) { } }
        });
      }
      const regSel = document.getElementById('tlRegion');
      if (regSel) regSel.addEventListener('change', function () {
        state.tlRegion = regSel.value; state.tlCountry = '';
        render(true);
      });
      const cSel = document.getElementById('tlCountry');
      if (cSel) cSel.addEventListener('change', function () {
        state.tlCountry = cSel.value; render(true);
      });

      /* 竞速图点击选手条 / 姓名 → 跳转本站选手主页 */
      if (box) {
        let inst = null;
        try { inst = P.drawTimeline(box); } catch (e) { inst = null; }
        if (inst && inst.on) {
          inst.on('click', function (params) {
            let id = (params.data && params.data.id) || '';
            if (!id && params.componentType === 'yAxis') {
              const nm = params.value;
              const hit = M.ranked.filter(function (x) { return x.name === nm; })[0];
              if (hit) id = hit.id;
            }
            if (id) location.hash = '#/player/' + id;
          });
        }
        if (P.tlHighlightRail) P.tlHighlightRail(state.tlFy || 2025);
      }
    }

    if (route === 'topics') {
      const sel = document.getElementById('counterSel');
      if (sel) sel.addEventListener('change', function () { state.counterZero = sel.value; render(true); });
    }

    if (route === 'model') {
      const ps = document.getElementById('presetSel');
      if (ps) ps.addEventListener('change', function () {
        if (!ps.value) return;
        Pm.applyPreset(ps.value); render(true); toast(t('ui.ok'));
      });
      const rs = document.getElementById('pReset');
      if (rs) rs.addEventListener('click', function () { Pm.reset(); render(true); toast(t('ui.ok')); });
      const mcr = document.getElementById('mColorReset');
      if (mcr) mcr.addEventListener('click', function () { Pm.resetColors(); render(true); toast(t('ui.ok')); });
      /* 模块配色：点击色块弹出取色菜单（RGB 滑杆 + 16 进制 + 取消/确认），确认才写入 */
      document.querySelectorAll('[data-cmod]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          const k = btn.getAttribute('data-cmod');
          openColorPopup({
            current: (Pm.colors && Pm.colors()[k]) || '#000000',
            label: btn.getAttribute('data-cmod-label') || k,
            anchor: btn,
            onConfirm: function (hex) {
              if (Pm.setColor) { Pm.setColor(k, hex); btn.style.background = hex; toast(t('md.colorsOk')); }
            }
          });
        });
      });
      /* 国家配色：同样点击色块弹窗编辑 */
      document.querySelectorAll('[data-ccmod]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          const iso = btn.getAttribute('data-ccmod');
          openColorPopup({
            current: (P.countryColor ? P.countryColor(iso) : '#000000'),
            label: (countryName(iso) || iso),
            anchor: btn,
            onConfirm: function (hex) {
              if (P.setCountryColor) { P.setCountryColor(iso, hex); btn.style.background = hex; toast(t('md.countryColorsOk')); }
            }
          });
        });
      });
      const ccR = document.getElementById('ccReset');
      if (ccR) ccR.addEventListener('click', function () {
        if (P.resetCountryColors) P.resetCountryColors();
        render(true); toast(t('ui.ok'));
      });
      document.querySelectorAll('.md-tgl').forEach(function (b) {
        b.addEventListener('click', function () {
          const sec = b.closest('.md-sec');
          if (!sec) return;
          sec.querySelectorAll('.md-tgl').forEach(function (x) { x.classList.remove('on'); });
          b.classList.add('on');
          const detail = b.getAttribute('data-mdtgl') === 'detail';
          const sd = sec.querySelector('.md-simple'), dd = sec.querySelector('.md-detail');
          if (sd) sd.hidden = detail;
          if (dd) dd.hidden = !detail;
          state.mdDetail = state.mdDetail || {};
          state.mdDetail[sec.id.slice(3)] = detail ? 'detail' : 'simple';
          typeset();
        });
      });
    }

    /* 卡片鼠标光晕 */
    view.querySelectorAll('.feat').forEach(function (card) {
      card.addEventListener('mousemove', function (e) {
        const r = card.getBoundingClientRect();
        card.style.setProperty('--mx', ((e.clientX - r.left) / r.width * 100) + '%');
        card.style.setProperty('--my', ((e.clientY - r.top) / r.height * 100) + '%');
      });
    });
  }

  /* ---------- Toast ---------- */
  let toastT = null;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    void toastEl.offsetWidth;
    toastEl.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(function () { toastEl.classList.remove('show'); }, 1700);
  }

  /* ---------- 对比托盘（全局，跨路由持久） ---------- */
  const pkTrayEl = document.getElementById('pkTray');
  const pkTrayList = document.getElementById('pkTrayList');
  const pkTrayGo = document.getElementById('pkTrayGo');
  const pkTrayCount = document.getElementById('pkTrayCount');
  function renderTray() {
    if (!pkTrayEl || !pkTrayList) return;
    const ps = state.pk.map(function (id) {
      return M.ranked.filter(function (x) { return x.id === id; })[0];
    }).filter(Boolean);
    pkTrayCount.textContent = ps.length;
    pkTrayEl.hidden = ps.length === 0;
    pkTrayGo.hidden = ps.length < 2;
    pkTrayList.innerHTML = ps.map(function (p) {
      return '<span class="pk-tray-chip">' + P.util.avatar(p, 'sm') +
        '<span class="pk-tray-name">' + esc(p.name) + '</span>' +
        '<button class="pk-tray-rm" data-pktrayrm="' + p.id + '" aria-label="移除">×</button></span>';
    }).join('');
  }

  /* ---------- 自定义重大事件：三输入框（项目 / 时间 / 事件内容） ---------- */
  const MS_KEY = 'goat-milestones-custom';
  function msList() { try { const a = JSON.parse(localStorage.getItem(MS_KEY)); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
  function msImport() {
    const ev = document.getElementById('msEv');
    const yr = document.getElementById('msYear');
    const tx = document.getElementById('msText');
    if (!tx) return;
    const text = (tx.value || '').trim();
    const raw = (yr && yr.value || '').trim();
    const ym = raw.match(/^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?/);
    if (!text || !ym) { toast(t('tl.msEmpty')); return; }
    const y = parseInt(ym[1], 10);
    const date = ym[2] ? (ym[1] + '-' + (ym[2].length < 2 ? '0' + ym[2] : ym[2]) + (ym[3] ? '-' + (ym[3].length < 2 ? '0' + ym[3] : ym[3]) : '-01')) : (ym[1] + '-01-01');
    const evId = (ev && ev.value) || '';
    const evNameTxt = evId && M.EV[evId] ? (t.isEn() ? M.EV[evId].en : M.EV[evId].zh) : '';
    const zh = evNameTxt ? evNameTxt + ' · ' + text : text;
    const en = evId && M.EV[evId] ? M.EV[evId].en + ' · ' + text : text;
    /* 编辑模式：把覆盖写进 goat-milestones-edit（按原始键定位），渲染时套用 */
    const ek = document.getElementById('msEditKey');
    const editKey = ek ? ek.value : '';
    if (editKey) {
      const o = (function () { try { return JSON.parse(localStorage.getItem('goat-milestones-edit')) || {}; } catch (e) { return {}; } })();
      o[editKey] = { date: date, zh: zh, en: en, ev: evId || '' };
      try { localStorage.setItem('goat-milestones-edit', JSON.stringify(o)); } catch (e) { }
      if (ek) ek.value = '';
      const hint = document.getElementById('msEditHint');
      if (hint) hint.textContent = '';
      const addBtn = document.getElementById('msImportBtn');
      if (addBtn) addBtn.textContent = t('tl.msAdd');
      if (tx) tx.value = '';
      if (yr) yr.value = '';
      if (ev) ev.value = '';
      toast(t('tl.msOk'));
      render(true); return;
    }
    const list = msList();
    list.push({ year: y, date: date, zh: zh, en: en, ev: evId || '' });
    try { localStorage.setItem(MS_KEY, JSON.stringify(list)); } catch (e) { }
    if (tx) tx.value = '';
    if (yr) yr.value = '';
    toast(t('tl.msOk'));
    render(true);
  }
  function msReset() { try { localStorage.removeItem(MS_KEY); localStorage.removeItem('goat-milestones-edit'); localStorage.removeItem('goat-milestones-hidden'); } catch (e) { } toast(t('tl.msReset')); render(true); }
  /* 编辑内置 / 自定义事件：把原始键与当前时间 / 标题 / 项目回填到表单，进入编辑模式 */
  function msEdit(btn) {
    const key = btn.getAttribute('data-msedit');
    const ev = btn.getAttribute('data-msedit-ev') || '';
    const ym = btn.getAttribute('data-msedit-date') || '';
    const zh = btn.getAttribute('data-msedit-zh') || '';
    /* 事件标题在存储时是「项目名 · 内容」的合成串，回填时要把项目名前缀剥掉，
       否则再次保存会二次拼接，变成「三阶 · 三阶 · 内容」。 */
    const txt = (P.msSplitText ? P.msSplitText(zh, ev) : zh);
    const evSel = document.getElementById('msEv');
    const yr = document.getElementById('msYear');
    const tx = document.getElementById('msText');
    const ek = document.getElementById('msEditKey');
    if (evSel) evSel.value = ev;
    if (yr) yr.value = ym;
    if (tx) tx.value = txt;
    if (ek) ek.value = key || '';
    const hint = document.getElementById('msEditHint');
    if (hint) hint.textContent = '编辑中：' + zh + '（改完点「保存修改」覆盖原事件）';
    const addBtn = document.getElementById('msImportBtn');
    if (addBtn) addBtn.textContent = t('tl.msSaveEdit') || '保存修改';
    /* 表单在页面下方，点 ✎ 后必须让用户看见「确实进入了编辑态」：
       滚动到表单并聚焦内容框，同时给表单加一层高亮。 */
    const form = evSel && evSel.closest ? evSel.closest('.ms-form') : null;
    if (form) {
      try { form.classList.add('ms-editing'); } catch (e) { }
      try { form.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) { }
      setTimeout(function () { try { form.classList.remove('ms-editing'); } catch (e) { } }, 1800);
    }
    if (tx && tx.focus) { try { tx.focus(); } catch (e) { } }
    toast(t('tl.msEditing'));
  }
  /* 内置事件的隐藏列表（让默认事件也能删除 / 恢复） */
  const MS_HIDE_KEY = 'goat-milestones-hidden';
  function msHidden() { try { const a = JSON.parse(localStorage.getItem(MS_HIDE_KEY)); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
  function msSaveHidden(a) { try { localStorage.setItem(MS_HIDE_KEY, JSON.stringify(a)); } catch (e) { } }
  /* 16 进制颜色输入：接受 #RGB / #RRGGBB / 不带 # 的写法，统一补成 #rrggbb */
  function hexVal(raw) {
    let s = String(raw || '').trim();
    if (!s) return '';
    if (s.charAt(0) !== '#') s = '#' + s;
    if (/^#[0-9a-fA-F]{3}$/.test(s)) s = '#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3];
    if (!/^#[0-9a-fA-F]{6}$/.test(s)) return '';
    return s.toLowerCase();
  }
  /* 自定义取色弹窗：点击颜色色块后弹出，内含 RGB 三滑杆、16 进制输入框（位于 RGB 下方）
     以及「取消 / 确认」按钮（位于最下方）。确认才写入，取消不改动。 */
  function rgbToHex(r, g, b) {
    function h(n) { const s = Math.max(0, Math.min(255, Math.round(n))).toString(16); return s.length === 1 ? '0' + s : s; }
    return '#' + h(r) + h(g) + h(b);
  }
  let _colorPop = null;
  function ensureColorPopup() {
    if (_colorPop) return _colorPop;
    const pop = document.createElement('div');
    pop.className = 'color-pop';
    pop.hidden = true;
    pop.innerHTML =
      '<div class="cp-head"><span class="cp-label"></span><button type="button" class="cp-close" aria-label="关闭">×</button></div>' +
      '<div class="cp-preview"><span class="cp-prev"></span><b class="cp-hexprev"></b></div>' +
      '<div class="cp-rgb">' +
      ['R', 'G', 'B'].map(function (c, i) {
        return '<div class="cp-ch"><label>' + c + '</label>' +
          '<input type="range" min="0" max="255" class="cp-sl" data-ch="' + i + '">' +
          '<input type="number" min="0" max="255" class="cp-num" data-ch="' + i + '"></div>';
      }).join('') +
      '</div>' +
      '<div class="cp-hexrow"><label>HEX</label><input type="text" class="cp-hex" maxlength="7" spellcheck="false" placeholder="#RRGGBB"><span class="cp-hexerr"></span></div>' +
      '<div class="cp-actions"><button type="button" class="btn btn-ghost cp-cancel">' + esc(t('ui.cancel')) + '</button>' +
      '<button type="button" class="btn btn-primary cp-ok">' + esc(t('ui.confirm')) + '</button></div>';
    document.body.appendChild(pop);
    _colorPop = pop;
    const prev = pop.querySelector('.cp-prev');
    const hexPrev = pop.querySelector('.cp-hexprev');
    const hexIn = pop.querySelector('.cp-hex');
    const hexErr = pop.querySelector('.cp-hexerr');
    const sliders = [0, 1, 2].map(function (i) { return pop.querySelector('.cp-sl[data-ch="' + i + '"]'); });
    const nums = [0, 1, 2].map(function (i) { return pop.querySelector('.cp-num[data-ch="' + i + '"]'); });
    let onConfirm = null;
    function paint() {
      const rgb = [+sliders[0].value, +sliders[1].value, +sliders[2].value];
      const hex = rgbToHex(rgb[0], rgb[1], rgb[2]);
      prev.style.background = hex; hexPrev.textContent = hex;
      hexIn.value = hex; hexErr.textContent = '';
    }
    function fromHex(v) {
      const hx = hexVal(v);
      if (!hx) { hexErr.textContent = '格式应为 #RRGGBB'; return; }
      const r = parseInt(hx.slice(1, 3), 16), g = parseInt(hx.slice(3, 5), 16), b = parseInt(hx.slice(5, 7), 16);
      sliders.forEach(function (s, i) { s.value = [r, g, b][i]; });
      nums.forEach(function (n, i) { n.value = [r, g, b][i]; });
      prev.style.background = hx; hexPrev.textContent = hx; hexErr.textContent = '';
    }
    sliders.forEach(function (s, i) { s.addEventListener('input', function () { nums[i].value = s.value; paint(); }); });
    nums.forEach(function (n, i) { n.addEventListener('input', function () { const v = Math.max(0, Math.min(255, +n.value || 0)); sliders[i].value = v; paint(); }); });
    hexIn.addEventListener('input', function () { fromHex(hexIn.value); });
    function closePop() { pop.hidden = true; onConfirm = null; }
    pop.querySelector('.cp-cancel').addEventListener('click', closePop);
    pop.querySelector('.cp-close').addEventListener('click', closePop);
    pop.querySelector('.cp-ok').addEventListener('click', function () { if (onConfirm) onConfirm(hexIn.value); closePop(); });
    document.addEventListener('mousedown', function (e) {
      if (!_colorPop || _colorPop.hidden) return;
      if (_colorPop.contains(e.target)) return;
      if (e.target.closest && e.target.closest('[data-cmod],[data-ccmod]')) return;
      closePop();
    });
    _colorPop._open = function (opts) {
      onConfirm = opts.onConfirm || null;
      pop.querySelector('.cp-label').textContent = opts.label || '';
      fromHex(hexVal(opts.current) || '#000000');
      pop.hidden = false;
      const a = opts.anchor;
      if (a) {
        const r = a.getBoundingClientRect();
        const pw = pop.offsetWidth || 250, ph = pop.offsetHeight || 260;
        let left = window.scrollX + r.left;
        if (left + pw > window.scrollX + document.documentElement.clientWidth - 8) left = window.scrollX + document.documentElement.clientWidth - pw - 8;
        left = Math.max(8, left);
        let top = window.scrollY + r.bottom + 6;
        if (top + ph > window.scrollY + document.documentElement.clientHeight - 8) top = window.scrollY + r.top - ph - 6;
        pop.style.left = left + 'px';
        pop.style.top = Math.max(8, top) + 'px';
      }
    };
    return pop;
  }
  function openColorPopup(opts) { ensureColorPopup()._open(opts); }
  function msSampleFill() { }

  /* ---------- 自定义设置（速率 / 宽度 / 颜色） ---------- */
  const SETTINGS_KEY = 'goat-settings';
  const PALETTES = {
    vibrant: ['#ff2d8e', '#ff8a1f', '#ffd21f', '#1fd07a', '#13b9f0', '#8b5cf6', '#ef4444'],
    pastel: ['#f472b6', '#fbbf24', '#a3e635', '#34d399', '#38bdf8', '#a78bfa', '#fb7185'],
    ocean: ['#0ea5e9', '#06b6d4', '#14b8a6', '#22c55e', '#3b82f6', '#6366f1', '#0d9488'],
    sunset: ['#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16', '#ec4899', '#d946ef']
  };
  const PALETTE_NAMES = { vibrant: '活力', pastel: '柔和', ocean: '海洋', sunset: '日落' };
  let SET = loadSettings();
  function loadSettings() { try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch (e) { return {}; } }
  function saveSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(SET)); } catch (e) { } }
  function applySettings(s) {
    const root = document.documentElement;
    if (s.accent) {
      root.style.setProperty('--accent', s.accent);
      root.style.setProperty('--accent-soft', 'color-mix(in srgb,' + s.accent + ' 16%,transparent)');
      root.style.setProperty('--accent-2', s.accent);
    }
    /* 用户在评分系统里自定义过模块配色时，预置调色板不再覆盖 */
    const hasCustom = (window.Params && window.Params.hasCustomColors) ? window.Params.hasCustomColors() : false;
    if (s.palette && PALETTES[s.palette] && !hasCustom) {
      PALETTES[s.palette].forEach(function (c, i) { root.style.setProperty('--m' + (i + 1), c); });
    } else if (hasCustom && window.Params && window.Params.applyColors) {
      window.Params.applyColors();
    }
    const barMax = (typeof s.barMax === 'number') ? s.barMax : 100;
    const anim = (typeof s.anim === 'number') ? s.anim : 1;
    root.style.setProperty('--bar-max', barMax + '%');
    root.style.setProperty('--anim-rate', String(anim));
    window.GOAT = window.GOAT || {};
    window.GOAT.barMax = barMax; window.GOAT.anim = anim;
  }
  function openSettings() {
    const modal = document.getElementById('settingsModal');
    if (!modal) return;
    const palSel = document.getElementById('setPalette');
    if (palSel && !palSel.options.length) {
      Object.keys(PALETTES).forEach(function (k) {
        const o = document.createElement('option');
        o.value = k; o.textContent = PALETTE_NAMES[k] || k;
        palSel.appendChild(o);
      });
    }
    const a = document.getElementById('setAccent'); if (a) a.value = SET.accent || '#2f6feb';
    const p = document.getElementById('setPalette'); if (p) p.value = SET.palette || 'vibrant';
    const b = document.getElementById('setBar'); if (b) { b.value = (typeof SET.barMax === 'number') ? SET.barMax : 100; const v = document.getElementById('setBarVal'); if (v) v.textContent = b.value + '%'; }
    const an = document.getElementById('setAnim'); if (an) { an.value = (typeof SET.anim === 'number') ? SET.anim : 1; const v = document.getElementById('setAnimVal'); if (v) v.textContent = an.value + '×'; }
    modal.hidden = false; requestAnimationFrame(function () { modal.classList.add('open'); });
  }
  function closeSettings() {
    const modal = document.getElementById('settingsModal');
    if (!modal) return;
    modal.classList.remove('open');
    setTimeout(function () { modal.hidden = true; }, 180);
  }
  function bindSettings() {
    const a = document.getElementById('setAccent');
    const p = document.getElementById('setPalette');
    const b = document.getElementById('setBar');
    const an = document.getElementById('setAnim');
    if (a) a.addEventListener('input', function () { SET.accent = a.value; applySettings(SET); saveSettings(); });
    if (p) p.addEventListener('change', function () { SET.palette = p.value; applySettings(SET); saveSettings(); });
    if (b) b.addEventListener('input', function () { SET.barMax = +b.value; const v = document.getElementById('setBarVal'); if (v) v.textContent = b.value + '%'; applySettings(SET); saveSettings(); });
    if (an) an.addEventListener('input', function () { SET.anim = +an.value; const v = document.getElementById('setAnimVal'); if (v) v.textContent = an.value + '×'; applySettings(SET); saveSettings(); });
    const reset = document.querySelector('[data-setreset]');
    if (reset) reset.addEventListener('click', function () { SET = {}; localStorage.removeItem(SETTINGS_KEY); applySettings(SET); if (a) a.value = '#2f6feb'; if (p) p.value = 'vibrant'; if (b) { b.value = 100; const v = document.getElementById('setBarVal'); if (v) v.textContent = '100%'; } if (an) { an.value = 1; const v = document.getElementById('setAnimVal'); if (v) v.textContent = '1×'; } toast(t('f.reset')); });
  }

  /* ---------- 全局事件委托 ---------- */
  const DELEGATE = '[data-sort],[data-page],[data-expand],[data-prow],[data-tab],[data-type],[data-pkadd],[data-pkrm],[data-pktrayrm],[data-pktrayclear],[data-toggle],[data-expandall],[data-goto],[data-group],[data-gender],[data-retired],[data-tlmode],[data-tlview],[data-tlstep],[data-tlmetric],[data-tllane],[data-topic],[data-topicev],[data-topicboard],[data-other],[data-nation],[data-scope],[data-continent],[data-evpick],[data-evtab],[data-evtoggle],[data-evall],[data-evnone],[data-evsave],[data-gload],[data-gdel],[data-reclevel],[data-rectype],[data-podtier],[data-mdanchor],[data-mdsec],[data-msimport],[data-msreset],[data-msdel],[data-msedit],[data-msunhide],[data-msjump]';

  document.addEventListener('click', function (e) {
    const el = e.target.closest ? e.target.closest(DELEGATE) : null;

    /* 锚点跳转（模型章节） */
    const anchorEl = e.target.closest ? e.target.closest('a[href*="#/model#"]') : null;
    if (anchorEl) {
      const id = anchorEl.getAttribute('href').split('#').pop();
      if (location.hash.indexOf('#/model') === 0) {
        e.preventDefault();
        scrollToAnchor(id);
        return;
      }
    }

    if (!el) return;
    if (el.hasAttribute('data-goto')) { location.hash = el.getAttribute('data-goto'); return; }

    if (el.hasAttribute('data-msimport')) { msImport(); return; }
    if (el.hasAttribute('data-msreset')) { msReset(); return; }
    if (el.hasAttribute('data-msedit')) { msEdit(el); return; }
    if (el.hasAttribute('data-msunhide')) {
      if (P.msUnhideAll) P.msUnhideAll();
      toast(t('tl.msRestored')); render(true); return;
    }
    if (el.hasAttribute('data-msdel')) {
      const key = el.getAttribute('data-msdel');
      /* 按「原始键」定位，避免排序 / 覆盖后索引错位（内置事件进隐藏列表，自定义项直接删） */
      const evSel = state.evSel || [];
      const singleEv = evSel.length === 1 ? evSel[0] : (state.group && M.EV[state.group] ? state.group : '');
      const baseAll = singleEv ? M.eventMilestones(singleEv) : M.milestones;
      const hidden = msHidden();
      const builtin = baseAll.filter(function (m) { return P.msKeyOf(m) === key; })[0];
      if (builtin) { hidden.push(key); msSaveHidden(hidden); toast(t('tl.msDelOk')); render(true); return; }
      const list = msList();
      const ci = list.findIndex ? list.findIndex(function (m) { return P.msKeyOf(m) === key; }) : -1;
      if (ci >= 0) { list.splice(ci, 1); try { localStorage.setItem(MS_KEY, JSON.stringify(list)); } catch (e) { } render(true); }
      return;
    }

    if (el.hasAttribute('data-tab')) {
      state.tab = el.getAttribute('data-tab'); state.page = 1; state.sortKey = 'score'; state.sortDir = 'desc';
      render(); return;
    }
    if (el.hasAttribute('data-type')) {
      state.recType = el.getAttribute('data-type'); state.page = 1;
      render(true); return;
    }
    if (el.hasAttribute('data-msjump')) {
      const idx = (P.tlDateToIdx ? P.tlDateToIdx(el.getAttribute('data-msjump')) : 0);
      const r = document.getElementById('tlRange');
      if (r) { r.value = idx; r.dispatchEvent(new Event('input')); }
      return;
    }
    if (el.hasAttribute('data-sort')) {
      const k = el.getAttribute('data-sort');
      if (state.sortKey === k) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
      else { state.sortKey = k; state.sortDir = (k === 'player' || k === 'country') ? 'asc' : 'desc'; }
      state.page = 1; render(); return;
    }
    if (el.hasAttribute('data-page')) {
      const p = parseInt(el.getAttribute('data-page'), 10);
      if (!isNaN(p)) { state.page = p; render(); }
      return;
    }
    if (el.hasAttribute('data-expand') || el.hasAttribute('data-prow')) {
      if (el.hasAttribute('data-prow') && e.target.closest && e.target.closest('a[href]')) return;
      const id = el.getAttribute('data-expand') || el.getAttribute('data-prow');
      toggleRow(id);
      return;
    }
    if (el.hasAttribute('data-toggle')) {
      const a = el.closest('.ach') || el.closest('.rec-item');
      if (!a) return;
      const open = !a.classList.contains('open');
      a.classList.toggle('open', open);
      if (open) fillAchBody(a);
      return;
    }
    if (el.hasAttribute('data-expandall')) {
      const kind = el.getAttribute('data-expandall');
      const list = view.querySelectorAll('.rec-item[data-ach="' + kind + '"]');
      const anyClosed = Array.prototype.some.call(list, function (a) { return !a.classList.contains('open'); });
      Array.prototype.forEach.call(list, function (a) {
        a.classList.toggle('open', anyClosed);
        if (anyClosed) fillAchBody(a);
      });
      el.textContent = anyClosed ? t('ui.collapseAll') : t('ui.expandAll');
      return;
    }
    if (el.hasAttribute('data-pkadd')) {
      const id = el.getAttribute('data-pkadd');
      if (state.pk.indexOf(id) < 0) {
        if (state.pk.length >= 4) { toast(t('pk.full')); return; }
        state.pk.push(id);
        toast(t('pk.added'));
      } else {
        toast(t('pk.added'));
      }
      renderTray();
      if (location.hash.indexOf('#/pk') === 0) render(true);
      return;
    }
    if (el.hasAttribute('data-pkrm')) {
      const id = el.getAttribute('data-pkrm');
      state.pk = state.pk.filter(function (x) { return x !== id; });
      renderTray(); render(true); return;
    }
    if (el.hasAttribute('data-pktrayrm')) {
      const id = el.getAttribute('data-pktrayrm');
      state.pk = state.pk.filter(function (x) { return x !== id; });
      renderTray(); if (location.hash.indexOf('#/pk') === 0) render(true);
      return;
    }
    if (el.hasAttribute('data-pktrayclear')) {
      state.pk = [];
      renderTray(); if (location.hash.indexOf('#/pk') === 0) render(true);
      return;
    }
    if (el.hasAttribute('data-group')) {
      state.group = el.getAttribute('data-group');
      state.evSel = []; state.page = 1;
      syncFilterUrl(true); return;
    }
    if (el.hasAttribute('data-evtab')) {
      const id = el.getAttribute('data-evtab');
      if (M.EV[id] && M.EV[id].retired && !state.retired) return;
      state.evSel = state.evSel || [];
      const i = state.evSel.indexOf(id);
      if (i >= 0) state.evSel.splice(i, 1); else state.evSel.push(id);
      state.group = 'all'; state.page = 1;
      render(true); return;
    }
    if (el.hasAttribute('data-scope')) {
      state.scope = el.getAttribute('data-scope');
      state.country = ''; state.continent = ''; state.region = ''; state.page = 1;
      render(true); return;
    }
    if (el.hasAttribute('data-continent')) {
      state.continent = el.getAttribute('data-continent') || ''; state.page = 1; render(true); return;
    }
    if (el.hasAttribute('data-gender')) { state.gender = el.getAttribute('data-gender'); state.page = 1; render(true); return; }
    if (el.hasAttribute('data-retired')) { state.retired = !state.retired; state.page = 1; render(true); return; }
    if (el.hasAttribute('data-tlmode')) { state.tlMode = el.getAttribute('data-tlmode'); render(true); return; }
    if (el.hasAttribute('data-tlview')) {
      state.tlView = el.getAttribute('data-tlview');
      if (state.tlView === 'lane') { state.tlPlaying = false; clearInterval(tlTimer); }
      render(true); return;
    }
    if (el.hasAttribute('data-tlstep')) {
      state.tlStep = el.getAttribute('data-tlstep'); state.tlPlaying = false; clearInterval(tlTimer);
      render(true); return;
    }
    if (el.hasAttribute('data-tlmetric')) { state.tlMetric = el.getAttribute('data-tlmetric'); render(true); return; }
    if (el.hasAttribute('data-tllane')) { state.tlLane = el.getAttribute('data-tllane'); render(true); return; }
    if (el.hasAttribute('data-topic')) { state.topicTab = el.getAttribute('data-topic'); state.topicBoard = ''; render(true); return; }
    if (el.hasAttribute('data-topicev')) { state.topicEvent = el.getAttribute('data-topicev'); state.evSel = []; render(true); return; }
    if (el.hasAttribute('data-topicboard')) { state.topicBoard = el.getAttribute('data-topicboard'); render(true); return; }
    if (el.hasAttribute('data-other')) { state.otherTab = el.getAttribute('data-other'); render(true); return; }
    if (el.hasAttribute('data-nation')) { state.nationMetric = el.getAttribute('data-nation'); render(true); return; }
    if (el.hasAttribute('data-reclevel')) {
      const v = el.getAttribute('data-reclevel');
      view.querySelectorAll('[data-reclevel]').forEach(function (b) { b.classList.toggle('on', b === el); });
      applyRecFilter('level', v); return;
    }
    if (el.hasAttribute('data-rectype')) {
      const v = el.getAttribute('data-rectype');
      view.querySelectorAll('[data-rectype]').forEach(function (b) { b.classList.toggle('on', b === el); });
      applyRecFilter('type', v); return;
    }
    if (el.hasAttribute('data-podtier')) {
      const v = el.getAttribute('data-podtier');
      view.querySelectorAll('[data-podtier]').forEach(function (b) { b.classList.toggle('on', b === el); });
      applyPodFilter(v); return;
    }
    if (el.hasAttribute('data-mdanchor')) { scrollToAnchor(el.getAttribute('data-mdanchor')); return; }
    if (el.hasAttribute('data-mdsec')) {
      state.mdSection = el.getAttribute('data-mdsec');
      state.mdDetail = state.mdDetail || {};
      render(true); return;
    }
  });

  /* ---------- 明细 body 懒填充 ---------- */
  function fillAchBody(item) {
    if (!item || !P.achBody) return;
    const kind = item.getAttribute('data-ach');
    const pid = item.getAttribute('data-pid');
    const idx = +item.getAttribute('data-idx');
    if (!kind || !pid) return;
    const slot = item.querySelector('[data-body="' + kind + '-' + idx + '"]');
    if (!slot || slot.innerHTML) return;
    slot.innerHTML = P.achBody(pid, kind, idx);
    if (window.MathJax && window.MathJax.typesetPromise) typeset(slot);
  }

  function applyRecFilter(kind, v) {
    const f = view.__recFilter || (view.__recFilter = { level: 'all', type: 'all' });
    f[kind] = v;
    view.querySelectorAll('.rec-item[data-ach="rec"]').forEach(function (it) {
      const okL = f.level === 'all' || it.getAttribute('data-level') === f.level;
      const okT = f.type === 'all' || it.getAttribute('data-type') === f.type;
      it.style.display = (okL && okT) ? '' : 'none';
    });
  }
  function applyPodFilter(v) {
    view.querySelectorAll('.rec-item[data-ach="pod"]').forEach(function (it) {
      const ok = v === 'all' || it.getAttribute('data-tier') === v;
      it.style.display = ok ? '' : 'none';
    });
  }

  document.addEventListener('change', function (e) {
    const el = e.target;
    if (el.id === 'fgGeo') {
      const v = el.value || '';
      if (v.indexOf('reg:') === 0) { state.region = v.slice(4); state.geo = ''; }
      else { state.geo = v; state.region = ''; }
      state.country = ''; state.continent = ''; state.page = 1;
      syncFilterUrl(true);
    }
    if (el.id === 'fgCountry') { state.country = el.value; state.page = 1; render(true); }
    if (el.id === 'fgRegion') { state.region = el.value; state.page = 1; render(true); }
    if (el.id === 'fgY0') { state.y0 = el.value ? +el.value : null; state.page = 1; render(true); }
    if (el.id === 'fgY1') { state.y1 = el.value ? +el.value : null; state.page = 1; render(true); }
    if (el.id === 'recSort') {
      const mode = el.value;
      const wrap = el.closest('.card');
      if (!wrap) return;
      const items = Array.prototype.slice.call(wrap.querySelectorAll('.rec-item[data-ach="rec"]'));
      const val = function (it) {
        const idx = it.getAttribute('data-idx');
        return idx == null ? 0 : +idx;
      };
      items.sort(function (a, b) {
        if (mode === 'date') return (b.getAttribute('data-date') || '').localeCompare(a.getAttribute('data-date') || '');
        if (mode === 'held') return (+b.getAttribute('data-held') || 0) - (+a.getAttribute('data-held') || 0);
        return (+b.getAttribute('data-score') || 0) - (+a.getAttribute('data-score') || 0);
      });
      items.forEach(function (it) { wrap.appendChild(it); });
      toast(t('ui.ok'));
      return;
    }
    if (el.classList && el.classList.contains('pr-input')) {
      const k = el.getAttribute('data-pk');
      const v = parseFloat(el.value);
      if (k && !isNaN(v)) {
        Pm.set(k, v);
        clearTimeout(window.__prT);
        window.__prT = setTimeout(function () { render(true); toast(t('ui.ok')); }, 420);
      }
    }
  });

  function bindReset() {
    const b = document.getElementById('fgReset');
    if (!b) return;
    b.addEventListener('click', function () {
      state.group = 'all'; state.customIds = []; state.evSel = []; state.geo = '';
      state.country = ''; state.continent = ''; state.region = '';
      state.gender = 'all'; state.y0 = null; state.y1 = null; state.recType = 'all'; state.page = 1;
      state.topicBoard = ''; state.topicEvent = '';
      const base = location.hash.split('?')[0] || '#/rank';
      hashConsumed = base;
      location.hash = base;
      render();
    });
  }

  /* 把当前筛选写回地址栏（可分享 / 可刷新保持）。
     keepScroll=true 时保留滚动位置；hash 未变化时不重复写，避免触发多余 hashchange。 */
  function syncFilterUrl(keepScroll) {
    const q = [];
    if (state.group && state.group !== 'all' && !state.group.match(/^u[0-9a-z]+$/)) q.push('g=' + state.group);
    if (state.geo) q.push('country=' + state.geo);
    const base = location.hash.split('?')[0] || '#/rank';
    const next = base + (q.length ? '?' + q.join('&') : '');
    if (next === location.hash) { render(!!keepScroll); return; }
    hashConsumed = next;
    location.hash = next;
    render(!!keepScroll);
  }

  document.getElementById('themeBtn').addEventListener('click', toggleTheme);
  document.getElementById('langBtn').addEventListener('click', toggleLang);
  const sb = document.getElementById('settingsBtn');
  if (sb) sb.addEventListener('click', openSettings);
  document.addEventListener('click', function (e) {
    const cm = e.target.closest ? e.target.closest('[data-closemodal]') : null;
    if (cm) closeSettings();
  });
  document.getElementById('navToggle').addEventListener('click', function () {
    const open = navEl.classList.toggle('open');
    this.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  navEl.addEventListener('click', function () { navEl.classList.remove('open'); });

  window.addEventListener('hashchange', function () {
    const r = parseHash();
    const route = r.seg[0] || 'home';
    if (route !== 'timeline') { state.tlPlaying = false; clearInterval(tlTimer); }
    render();
  });
  window.addEventListener('resize', function () {
    if (!window.echarts) return;
    view.querySelectorAll('.ec').forEach(function (el) {
      try { const inst = window.echarts.getInstanceByDom(el); if (inst) inst.resize(); } catch (e) { }
    });
  });

  /* ---------- 真实 / 演示数据模式 ---------- */
  function applyDataMode() {
    const banner = document.getElementById('demoBanner');
    const real = M && M.meta && M.meta.demo === false;
    if (real) {
      if (banner) banner.style.display = 'none';
      const fd = document.querySelector('[data-i18n="foot.data"]');
      if (fd) {
        fd.removeAttribute('data-i18n');
        fd.textContent = '数据来源：World Cube Association 官方成绩导出（' +
          (M.meta.updated || '') + '，v' + (M.meta.exportVersion || '') + '）';
      }
      const wc = document.getElementById('wcaCredit');
      if (wc) wc.textContent = 'This information is based on competition results owned and maintained by the World Cube Association, published at https://worldcubeassociation.org/results as of ' + (M.meta.updated || '') + '.';
    } else {
      if (banner) banner.style.display = '';
    }
  }

  /* ---------- 启动 ---------- */
  SET = loadSettings();
  applySettings(SET);   /* 先应用配色，initTheme 的渐变彩蛋才能读到自定义色 */
  if (window.Params && window.Params.applyColors) window.Params.applyColors();
  bindSettings();
  initTheme();
  initLang();
  applyDataMode();
  if (!location.hash) location.hash = '#/home';
  const gh = document.getElementById('ghLink');
  if (gh) { gh.href = 'https://github.com/LeanSun/cuber-statistics'; }
  render();
})();

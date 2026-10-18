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

  const state = {
    tab: 'overall', sortKey: 'score', sortDir: 'desc', page: 1,
    group: 'all', customIds: [], evSel: [], country: '', continent: '', region: '',
    gender: 'all', y0: null, y1: null, retired: false,
    scope: 'country', geo: '',
    pk: [], tlView: 'rank', tlMode: 'active', tlFy: 2025, tlStep: 'year', tlMetric: 'overall', tlLane: 'single', tlSmooth: false, tlPlaying: false, tlRegion: '', tlCountry: '',
    topicTab: 'rec', topicStat: '', otherTab: 'king', nationMetric: 'total', counterZero: 'wr', topicBoard: ''
  };

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
  let lastRoute = '';
  let lastScroll = 0;

  /* ---------- 主题 ---------- */
  function initTheme() {
    let th = null;
    try { th = localStorage.getItem('goat-theme'); } catch (e) { }
    if (!th) th = (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
    applyTheme(th);
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
      ['rank', '#/rank'], ['pk', '#/pk'], ['timeline', '#/timeline'],
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

    /* ---------- 项目范围：预设分组（快速筛选） + 事件图标多选 ---------- */
    h += '<div class="fgroup ev-fgroup"><span class="flabel">' + esc(t('f.events')) + '</span>';
    h += '<div class="fctl presets" id="fgGroup">';
    const presets = [{ id: 'all', zh: t('f.all'), en: t('f.all') }].concat(M.presetGroups.filter(function (g) { return g.id !== 'all'; }));
    presets.forEach(function (g) {
      const on = state.group === g.id && !(state.evSel && state.evSel.length);
      h += '<button class="chip' + (on ? ' on' : '') + '" data-group="' + g.id + '">' + esc(t.isEn() ? g.en : g.zh) + '</button>';
    });
    h += '</div>';
    h += '<div class="ev-strip" id="fgEvents" role="group" aria-label="' + esc(t('f.events')) + '">';
    const evSel = state.evSel || [];
    const activeEv = M.events.filter(function (e) { return !e.retired; });
    const retiredEv = M.events.filter(function (e) { return e.retired; });
    h += '<div class="ev-row">';
    activeEv.forEach(function (e) {
      const on = evSel.indexOf(e.id) >= 0;
      h += '<button class="ev-tab' + (on ? ' on' : '') + '" data-evtab="' + e.id + '" title="' + esc(t.isEn() ? e.en : e.zh) + '">' + window.Icons.event(e.id) + '</button>';
    });
    h += '</div>';
    h += '<div class="ev-row ev-row-retired">';
    retiredEv.forEach(function (e) {
      const on = evSel.indexOf(e.id) >= 0;
      const dis = !state.retired;
      h += '<button class="ev-tab' + (on ? ' on' : '') + (dis ? ' disabled' : '') + '" data-evtab="' + e.id + '" title="' + esc(t.isEn() ? e.en : e.zh) + '">' + window.Icons.event(e.id) + '</button>';
    });
    h += '</div>';
    h += '</div>';
    h += '</div>';

    /* ---------- 国家 / 地区 / 大洲 合并为单一下拉（总榜 + 动态演变） ---------- */
    if (route === 'rank' || route === 'timeline') {
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
      h += '<optgroup label="' + esc(t.isEn() ? 'Regions & countries' : '地区') + '">';
      const fixed = ['CN', 'HK', 'MO', 'TW'];
      fixed.forEach(function (iso) {
        h += '<option value="' + iso + '"' + (state.geo === iso ? ' selected' : '') + '>' + esc(M.countries[iso]) + '</option>';
      });
      const others = M.countryList.slice().sort();
      others.forEach(function (iso) {
        if (fixed.indexOf(iso) >= 0) return;
        h += '<option value="' + iso + '"' + (state.geo === iso ? ' selected' : '') + '>' + esc(M.countries[iso]) + '</option>';
      });
      h += '</optgroup>';
      h += '</select></div></div>';
    }

    if (route === 'rank') {
      h += '<div class="fgroup"><span class="flabel">' + esc(t('f.gender')) + '</span><div class="fctl">';
      [['all', 'f.gender.all'], ['M', 'f.gender.m'], ['F', 'f.gender.f']].forEach(function (g) {
        h += '<button class="chip' + (state.gender === g[0] ? ' on' : '') + '" data-gender="' + g[0] + '">' + esc(t(g[1])) + '</button>';
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
    }

    h += '<button class="btn" id="fgReset">' + esc(t('f.reset')) + '</button>';
    h += '<span class="filter-summary" id="fgSummary"></span>';
    h += '</div>';

    fbEl.innerHTML = h;
  }

  function updateSummary(route) {
    const el = document.getElementById('fgSummary');
    if (!el) return;
    let n = M.ranked.length;
    if (route === 'rank') n = P.filtered(state).length;
    el.textContent = t('f.summary', { n: n });
  }

  /* ---------- 主渲染 ---------- */
  function render(keepScroll) {
    const r = parseHash();
    const route = r.seg[0] || 'home';
    const prev = lastRoute;
    if (route === 'model' && r.anchor) state.mdSection = r.anchor;

    if (route === 'rank') {
      if (r.q.g) state.group = r.q.g;
      if (r.q.country) state.geo = r.q.country;
    }
    if (route === 'topics' && r.q.tab) state.topicTab = r.q.tab;

    const sy = window.scrollY;
    applyStaticI18n();
    renderNav(route);
    renderFilterBar(route);

    let html = '';
    if (route === 'home') html = P.home();
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
        const hits = M.ranked.filter(function (p) {
          return p.name.toLowerCase().indexOf(q) >= 0 || p.country.toLowerCase() === q ||
            (M.countries[p.country] || '').indexOf(q) >= 0 ||
            p.events.some(function (e) { return (M.EV[e].zh.indexOf(q) >= 0) || M.EV[e].en.toLowerCase().indexOf(q) >= 0; });
        }).slice(0, 12);
        if (!hits.length) { box.innerHTML = '<p class="tiny muted">' + esc(t('ui.noresult')) + '</p>'; return; }
        box.innerHTML = '<div class="card" style="padding:10px">' + hits.map(function (p) {
          return '<div class="row" style="gap:10px;padding:5px 0;border-bottom:1px solid var(--border)">' +
            P.util.avatar(p) + '<a href="#/player/' + p.id + '" style="flex:1">' + esc(p.name) + '</a>' +
            P.util.flag(p.country) + '<span class="tiny muted">' + U.fmt(P.util.scoreOf(p).overall, 1) + '</span></div>';
        }).join('') + '</div>';
      }
      if (inp) inp.addEventListener('input', doSearch);
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
      const sm = document.getElementById('tlSmooth');
      const box = document.getElementById('tlChart');
      const lab = document.getElementById('tlYear');
      function setFyFromRange(rg) {
        const idx = +rg.value;
        const info = P.tlIdxToInfo(idx, state.tlStep);
        state.tlFy = info.fy;
        if (lab) lab.textContent = info.label;
        if (box) { box.setAttribute('data-fy', state.tlFy); P.drawTimeline(box); }
      }
      if (range) range.addEventListener('input', function () { setFyFromRange(range); });
      if (sm) sm.addEventListener('change', function () {
        state.tlSmooth = sm.checked;
        if (box) { box.setAttribute('data-smooth', state.tlSmooth ? '1' : '0'); P.drawTimeline(box); }
      });
      if (play) play.addEventListener('click', function () {
        if (state.tlPlaying) { stopPlay(); return; }
        if (!range) return;
        state.tlPlaying = true; play.textContent = t('tl.pause');
        const inc = state.tlStep === 'week' ? 3 : 1;
        tlTimer = setInterval(function () {
          const sl = P.tlSlider(state.tlStep, state.tlFy);
          let idx = +range.value;
          if (idx >= sl.max) { stopPlay(); return; }
          idx = Math.min(sl.max, idx + inc);
          range.value = idx;
          setFyFromRange(range);
          if (idx >= sl.max) stopPlay();
        }, state.tlStep === 'week' ? 240 : 460);
      });
      function stopPlay() {
        state.tlPlaying = false; clearInterval(tlTimer);
        const pb = document.getElementById('tlPlay'); if (pb) pb.textContent = t('tl.play');
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
      return '<span class="pk-tray-chip">' + U.avatar(p, 'sm') +
        '<span class="pk-tray-name">' + esc(p.name) + '</span>' +
        '<button class="pk-tray-rm" data-pktrayrm="' + p.id + '" aria-label="移除">×</button></span>';
    }).join('');
  }

  /* ---------- 全局事件委托 ---------- */
  const DELEGATE = '[data-sort],[data-page],[data-expand],[data-prow],[data-tab],[data-pkadd],[data-pkrm],[data-pktrayrm],[data-pktrayclear],[data-toggle],[data-expandall],[data-goto],[data-group],[data-gender],[data-retired],[data-tlmode],[data-tlview],[data-tlstep],[data-tlmetric],[data-tllane],[data-topic],[data-topicev],[data-topicboard],[data-other],[data-nation],[data-scope],[data-continent],[data-evpick],[data-evtab],[data-evtoggle],[data-evall],[data-evnone],[data-evsave],[data-gload],[data-gdel],[data-reclevel],[data-rectype],[data-podtier],[data-mdanchor],[data-mdsec]';

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

    if (el.hasAttribute('data-tab')) {
      state.tab = el.getAttribute('data-tab'); state.page = 1; state.sortKey = 'score'; state.sortDir = 'desc';
      render(); return;
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
      syncFilterUrl(); return;
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
    if (el.hasAttribute('data-topicev')) { state.topicEvent = el.getAttribute('data-topicev'); render(true); return; }
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
    if (el.id === 'fgGeo') { state.geo = el.value || ''; state.country = ''; state.continent = ''; state.region = ''; state.page = 1; render(true); }
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
      state.gender = 'all'; state.y0 = null; state.y1 = null; state.page = 1;
      state.topicBoard = ''; state.topicEvent = '';
      location.hash = (location.hash.split('?')[0] || '#/rank');
      render();
    });
  }

  function syncFilterUrl() {
    const q = [];
    if (state.group && state.group !== 'all' && !state.group.match(/^u[0-9a-z]+$/)) q.push('g=' + state.group);
    if (state.geo) q.push('country=' + state.geo);
    const base = location.hash.split('?')[0] || '#/rank';
    location.hash = base + (q.length ? '?' + q.join('&') : '');
    render();
  }

  document.getElementById('themeBtn').addEventListener('click', toggleTheme);
  document.getElementById('langBtn').addEventListener('click', toggleLang);
  document.getElementById('navToggle').addEventListener('click', function () {
    const open = navEl.classList.toggle('open');
    this.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  navEl.addEventListener('click', function () { navEl.classList.remove('open'); });

  window.addEventListener('hashchange', function () {
    const r = parseHash();
    const route = r.seg[0] || 'home';
    if (route === 'rank') { state.group = r.q.g || state.group; if (r.q.country) state.geo = r.q.country; }
    if (route !== 'timeline') { state.tlPlaying = false; clearInterval(tlTimer); }
    render();
  });
  window.addEventListener('resize', function () {
    if (!window.echarts) return;
    view.querySelectorAll('.ec').forEach(function (el) {
      try { const inst = window.echarts.getInstanceByDom(el); if (inst) inst.resize(); } catch (e) { }
    });
  });

  /* ---------- 启动 ---------- */
  initTheme();
  initLang();
  if (!location.hash) location.hash = '#/home';
  const gh = document.getElementById('ghLink');
  if (gh) { gh.href = 'https://github.com/LeanSun/cuber-statistics'; }
  render();
})();

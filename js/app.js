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

  /* ---------- 注入展示用项目 FTO ----------
     WCA 官方导出里没有 FTO 数据，故它不计入任何榜单 / 评分；
     这里仅为让「项目领域」「筛选项目」「趣味统计筛选项」与官方项目口径一致地出现 FTO，
     所有选手在 FTO 上均显示「未参与（—）」。如日后有数据源，只需在 build.js 的 events Map 里补数据即可。
     2026-10-29：用户要求不再叫「八面体」，一律用官方简称 FTO（图标走 cubing-icon unofficial-fto）。 */
  const FTO_NAME = { zh: 'FTO', en: 'FTO' };
  (function injectFTO() {
    if (!M || !M.EV) return;
    if (!M.EV.fto) {
      M.EV.fto = { id: 'fto', zh: FTO_NAME.zh, en: FTO_NAME.en, format: '', w: 0.5, rank: 99, retired: false };
    } else { M.EV.fto.zh = FTO_NAME.zh; M.EV.fto.en = FTO_NAME.en; }
    if (M.events && !M.events.some(function (e) { return e.id === 'fto'; })) {
      M.events.push({ id: 'fto', zh: FTO_NAME.zh, en: FTO_NAME.en, format: '', w: 0.5, rank: 99, retired: false });
    }
    if (M.events) M.events.forEach(function (e) { if (e.id === 'fto') { e.zh = FTO_NAME.zh; e.en = FTO_NAME.en; } });
  })();

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
    /* 停办项目默认「计入」（用户 2026-11-01 指定全局默认）：
       早年脚拧 / 八板 / 四板 / 三阶多盲的成绩同样算数，不默认藏起来。
       想排除时在筛选条点一下「不计入」即可。 */
    gender: 'all', y0: null, y1: null, retired: true, recType: 'all',
    /* 总榜柱状图的堆叠方式：'' = 自动（只看单项目时按维度、其余按项目），'ev' / 'dim' = 显式选择 */
    stackMode: '',
    scope: 'country', geo: '',
    pk: [], tlView: 'race', tlMode: 'cumulative', tlFy: 0, tlStep: 'day', tlMetric: 'overall', tlLane: 'single', tlSmooth: false, tlPlaying: false, tlRegion: '', tlCountry: '', tlDim: '', msPopOpen: false,
    topicTab: 'rec', topicStat: '', otherTab: 'king', nationMetric: 'total', counterZero: 'wr', topicBoard: '', dimSel: ''
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
    /* 箭头不再换字符（换字符无法过渡）：保留 › 只旋转 90°，靠 CSS transition 平滑转开 */
    if (btn) btn.setAttribute('aria-expanded', row.hidden ? 'false' : 'true');
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

  /* ---------- 主题 ----------
     主题有三个来源：用户在「参数设置 → 外观与交互」里选的偏好（Prefs.theme：auto/light/dark）、
     系统 prefers-color-scheme、以及首轮上线时留下的 goat-theme（仅作迁移兜底）。
     auto 模式下监听系统切换，白天/夜里自动跟随。 */
  function sysDark() { return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches); }
  function themePref() {
    try { if (window.Prefs) return Prefs.get('theme') || 'auto'; } catch (e) { }
    return 'auto';
  }
  function effectiveTheme() {
    const p = themePref();
    return (p === 'light' || p === 'dark') ? p : (sysDark() ? 'dark' : 'light');
  }
  function initTheme() {
    /* 老版本只存了 goat-theme（没有偏好体系）：升级后第一次进来把它迁移成显式偏好，
       否则原本设成深色的用户会突然变成「跟随系统」。之后就以 Prefs 为准。 */
    try {
      if (window.Prefs && !localStorage.getItem('goat-prefs-v1')) {
        const old = localStorage.getItem('goat-theme');
        if (old === 'light' || old === 'dark') Prefs.set('theme', old);
      }
    } catch (e) { }
    applyTheme(effectiveTheme());
    applyGradientEgg();
    if (window.matchMedia) {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const onSys = function () { if (themePref() === 'auto') switchTheme(sysDark() ? 'dark' : 'light', true, 'center'); };
      if (mq.addEventListener) mq.addEventListener('change', onSys);
      else if (mq.addListener) mq.addListener(onSys);
    }
  }
  /* 圆形扩散期间先别重绘图表：View Transition 拍的是「改完主题那一瞬」的快照，
     若此刻就把 canvas 换成新配色，快照里图表是新色、VT 结束后又拿旧画面淡出，
     会出现「先变新 → 退回旧 → 再化开」的闪回。留到 VT 结束再走 crossFadeCharts。 */
  let deferCharts = false;
  function applyTheme(th) {
    document.documentElement.setAttribute('data-theme', th);
    const ic = document.getElementById('themeIcon');
    if (ic) ic.textContent = th === 'dark' ? '☾' : '☀';
    if (window.Charts && !deferCharts) window.Charts.refresh();
  }
  /* 是否要「不动画」：偏好里选了减弱，或系统开了减少动效 */
  function prefersReduce() {
    try { if (window.Prefs && Prefs.get('motion') === 'reduced') return true; } catch (e) { }
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }
  /* ★ 深浅色切换（2026-11-05 第十四轮再次重做）
     用户两次反馈「切换生硬」。上一版写的是 CSS 变量插值，逻辑本身没错，但有两个坑：
       ① 系统开了「减少动画效果」（Windows 辅助功能里很常见）时，CSS 的
          `@media (prefers-reduced-motion:reduce)` 把过渡整个关成 none，JS 里也
          直接 return —— 于是这类机器上根本没有任何过渡，就是硬切。
          现在改为：仍然过渡，只是把时长压到 280ms。
       ② 图表是 canvas，颜色画在位图上，CSS 过渡管不到 —— 之前等颜色跑完再
          `render(true)`，canvas 在那一帧整体跳色，观感像「啪」地闪一下。
          现在改成：先把旧画面快照成一张位图盖在新图表上，再让它淡出，
          图表颜色是「化开」过去的（见 crossFadeCharts）。
     主路径仍是变量插值（一组动画、不掉帧）；不支持的浏览器退回逐元素过渡（.theme-fade）。 */
  const THEME_MS = 900;        /* 正常时长（2026-11-05 用户要求稍放慢：620 → 900） */
  const THEME_MS_QUICK = 280;  /* 系统要求减少动效时的时长：仍然过渡，只是更快 */
  /* 能否让「变量本身」过渡：支持 CSS @property 的浏览器可以，
     此时全站只需一组动画（:root 上的 --bg/--text/...），不掉帧；
     不支持的退回逐元素过渡（.theme-fade），慢一点但同样不是硬切。 */
  let varAnimOK = null;
  function canAnimateVars() {
    if (varAnimOK !== null) return varAnimOK;
    try { varAnimOK = !!(window.CSS && typeof window.CSS.registerProperty === 'function'); }
    catch (e) { varAnimOK = false; }
    return varAnimOK;
  }
  function themeMs() { return prefersReduce() ? THEME_MS_QUICK : THEME_MS; }

  /* ---- canvas 交叉淡化 ----
     思路：切换过程中先把每个 canvas 的当前画面 drawImage 到一张离屏 canvas，
     等颜色过渡到一半、图表用新配色重绘之后，把离屏图按原位置盖回去（opacity 1），
     下一帧开始淡出。用户看到的是「旧图淡出、新图浮现」，而不是位图整体跳色。
     只在页面真的有图表时才做（.ec / .chart-box 里没有 canvas 就直接跳过）。 */
  function captureCanvases() {
    const list = [];
    document.querySelectorAll('canvas').forEach(function (cv) {
      const w = cv.width, h = cv.height;
      if (!w || !h) return;
      const r = cv.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) return;
      let g = null;
      try {
        g = document.createElement('canvas');
        g.width = w; g.height = h;
        g.getContext('2d').drawImage(cv, 0, 0);
      } catch (e) { return; }   /* 跨域污染等：放弃这一张，不影响其它 */
      list.push({ ghost: g, cv: cv });
    });
    return list;
  }
  function crossFadeCharts(dur) {
    const old = captureCanvases();
    if (!old.length) { settlePage(); return; }
    /* 记下「第几个 canvas」而不是节点引用：重绘会换掉节点，按序号对上就行 */
    const all = Array.prototype.slice.call(document.querySelectorAll('canvas'));
    const snap = old.map(function (o) { return { g: o.ghost, i: all.indexOf(o.cv) }; })
      .filter(function (o) { return o.i >= 0; });
    try { render(true); } catch (e) { return; }
    const now = Array.prototype.slice.call(document.querySelectorAll('canvas'));
    snap.forEach(function (s) {
      const cv = now[s.i];
      if (!cv || !cv.parentNode) return;
      const p = cv.parentNode;
      const cr = cv.getBoundingClientRect(), pr = p.getBoundingClientRect();
      if (cr.width < 4 || cr.height < 4) return;
      const g = s.g;
      g.className = 'theme-ghost';
      g.style.cssText = 'position:absolute;pointer-events:none;z-index:6;opacity:1;' +
        'left:' + (cr.left - pr.left + p.scrollLeft) + 'px;top:' + (cr.top - pr.top + p.scrollTop) + 'px;' +
        'width:' + cr.width + 'px;height:' + cr.height + 'px;' +
        'transition-property:opacity;transition-timing-function:linear;transition-duration:' + dur + 'ms';
      if (getComputedStyle(p).position === 'static') p.style.position = 'relative';
      p.appendChild(g);
      requestAnimationFrame(function () { g.style.opacity = '0'; });
      setTimeout(function () { if (g.parentNode) g.parentNode.removeChild(g); }, dur + 60);
    });
    settlePage();
  }
  /* 参数设置页的分段控件与真实偏好对齐（顶栏 ☀/☾ 改主题后同步高亮）。 */
  function syncPrefSegs() {
    if (!window.Prefs) return;
    document.querySelectorAll('.pz-seg[data-pref]').forEach(function (seg) {
      const key = seg.getAttribute('data-pref');
      const cur = String(Prefs.get(key));
      seg.querySelectorAll('[data-pv]').forEach(function (b) {
        b.classList.toggle('on', b.getAttribute('data-pv') === cur);
      });
    });
  }
  /* ---- 深浅色切换：浅→深收缩、深→浅扩散（2026-11-05 晚二次调整） ----
     更早一版也用过 View Transitions，但当时把新主题渲染成整页静态截图，
     clip-path 是一条硬圆边，扫过瞬间整页定型 → 用户反馈「唰一下、很生硬」。
     这一版保留「从鼠标点下的地方」这个空间原点，改掉三处硬感：
       ① 新层不用硬 clip-path，改用 radial-gradient 羽化遮罩（边缘渐隐带）；
       ② 新层自身 opacity .88 → 1，扫过的区域是「化开」而不是「啪」地换掉；
       ③ 圆周挂一圈目标主题色的柔光（drop-shadow），吃掉新旧色差的硬边界。
     方向由「当前主题 → 目标主题」决定（2026-11-05 晚用户二次调整，与上一版相反）：
       浅 → 深：新层（深色）圆外可见、圆内透明（露出旧浅色），
               r 从覆盖全屏缩到 1px = 浅色圆向点击点收拢消失、深色从外围合拢；
       深 → 浅：新层（浅色）圆内可见，r 从 1px 长到覆盖全屏 = 浅色扩散。
     两条路径共用 --reveal-r，只是起止值与 CSS 遮罩渐变方向相反。
     图表是 canvas：切换期间先不重绘，VT 结束后再走 crossFadeCharts 的旧画面
     快照淡出（见 deferCharts），否则会出现「先变新 → 退回旧 → 再化开」的闪回。
     不支持 View Transitions 的浏览器 → 回退到下面的变量插值 / .theme-fade；
     系统开了「减少动效」→ 只把时长压到 280ms，绝不关成 none。 */
  let lastPointer = null;
  document.addEventListener('pointerdown', function (e) {
    if (e.clientX > 0 || e.clientY > 0) lastPointer = { x: e.clientX, y: e.clientY };
  }, true);
  function revealOrigin(hint) {
    if (hint && typeof hint === 'object' && hint.x > 0 && hint.y > 0) return hint;
    if (hint !== 'center' && lastPointer) return lastPointer;
    const b = document.getElementById('themeBtn');
    if (b) {
      const r = b.getBoundingClientRect();
      if (r.width) return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }
    return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  }
  let revealSeq = 0;
  function clearReveal(seq) {
    if (seq != null && seq !== revealSeq) return;  /* 连点时别清掉后一次的参数 */
    const r = document.documentElement;
    ['--reveal-r', '--reveal-x', '--reveal-y', '--reveal-max',
      '--reveal-feather', '--reveal-glow'].forEach(function (k) {
      try { r.style.removeProperty(k); } catch (e) { }
    });
    r.classList.remove('theme-reveal-clip', 'theme-reveal-contract', 'theme-switching');
    try { r.style.removeProperty('--theme-dur'); } catch (e) { }
  }
  function circleReveal(next, apply, o, ms) {
    const root = document.documentElement;
    const seq = ++revealSeq;
    const W = window.innerWidth, H = window.innerHeight;
    /* 半径取到四角最远点，保证圆能覆盖整屏 */
    const R = Math.hypot(Math.max(o.x, W - o.x), Math.max(o.y, H - o.y)) + 48;
    const contract = root.getAttribute('data-theme') !== 'dark' && next === 'dark';
    const maskOK = canAnimateVars();  /* @property 可用 → 羽化遮罩；否则硬圆 clip 兜底 */
    /* 无 @property 只能做「圆内可见」的硬圆 clip-path，做不出收缩需要的
       「圆外可见」反向遮罩，首帧会整屏跳色 —— 该方向直接回退颜色插值。
       现在「收缩」落在浅→深，所以老浏览器里浅→深走颜色插值、深→浅走硬圆扩散。 */
    if (!maskOK && contract) return false;
    try {
      /* 首帧半径必须是动画起点：扩散 0、收缩 R（否则收缩先闪一下目标主题整屏） */
      root.style.setProperty('--reveal-r', contract ? R + 'px' : '0px');
      root.style.setProperty('--reveal-x', o.x + 'px');
      root.style.setProperty('--reveal-y', o.y + 'px');
      root.style.setProperty('--reveal-max', R + 'px');
      root.style.setProperty('--reveal-feather', (ms <= 300 ? 12 : 38) + 'px');
      root.style.setProperty('--reveal-glow',
        next === 'dark' ? 'rgba(13,17,23,.30)' : 'rgba(255,255,255,.55)');
    } catch (e) { }
    root.classList.toggle('theme-reveal-contract', contract);
    if (!maskOK) root.classList.add('theme-reveal-clip');
    /* ★ 2026-11-06：切换期间关掉 DOM 里的逐元素 CSS transition。
       .ev-tab 等图标按钮常驻 `border-color/background/color/box-shadow .16s`
       （本来只给 hover 用），主题变量一变就同时触发 500+ 条过渡 —— 用户看到
       整排图标「边框闪一下又消失」。视觉过渡由 VT 圆形揭示独占，DOM 层应当硬切。
       类在 clearReveal 里移除；crossFadeCharts 的 ghost 淡出在移除之后才创建，
       所以它自己的 opacity 过渡不受影响。 */
    root.classList.add('theme-switching');
    deferCharts = true;
    let vt;
    try { vt = document.startViewTransition(function () { apply(); }); }
    catch (e) {
      deferCharts = false; clearReveal(seq);
      return false;
    }
    vt.ready.then(function () {
      const r0 = contract ? R + 'px' : '1px';
      const r1 = contract ? '1px' : R + 'px';
      const kf = maskOK
        ? [{ '--reveal-r': r0, opacity: '.88' }, { '--reveal-r': r1, opacity: '1' }]
        : [{ clipPath: 'circle(0px at ' + o.x + 'px ' + o.y + 'px)' },
           { clipPath: 'circle(' + R + 'px at ' + o.x + 'px ' + o.y + 'px)' }];
      try {
        root.animate(kf, {
          duration: ms,
          easing: 'cubic-bezier(.22,.61,.36,1)',
          fill: 'forwards',
          pseudoElement: '::view-transition-new(root)'
        });
      } catch (e) { }
    }).catch(function () { });
    const done = function () {
      if (seq !== revealSeq) return;
      deferCharts = false;
      clearReveal(seq);
      clearTimeout(switchTheme._t3);
      crossFadeCharts(Math.max(240, Math.round(ms * 0.7)));
    };
    vt.finished.then(done).catch(function () {
      if (seq !== revealSeq) return;
      deferCharts = false; clearReveal(seq); clearTimeout(switchTheme._t3);
    });
    /* 兜底：页面被隐藏等情况下 finished 可能不 resolve，别把 deferCharts 卡住 */
    switchTheme._t3 = setTimeout(function () {
      if (deferCharts && seq === revealSeq) done();
    }, ms + 900);
    return true;
  }
  function switchTheme(next, animate, origin) {
    const root = document.documentElement;
    const cur = root.getAttribute('data-theme');
    if (cur === next && !animate) return;
    const apply = function () {
      applyTheme(next);
      try { localStorage.setItem('goat-theme', next); } catch (e) { }
      syncPrefSegs();
    };
    if (animate === false) {
      root.classList.remove('theme-anim', 'theme-fade', 'theme-switching');
      apply();
      settleCharts();
      return;
    }
    clearTimeout(switchTheme._t);
    clearTimeout(switchTheme._t2);
    clearTimeout(switchTheme._t3);
    const ms = themeMs();
    /* 时长交给 CSS 变量，reduced-motion 的媒体查询也只读它，两边永远一致 */
    try { root.style.setProperty('--theme-dur', ms + 'ms'); } catch (e) { }
    if (cur !== next && typeof document.startViewTransition === 'function' &&
        circleReveal(next, apply, revealOrigin(origin), ms)) return;
    /* 回退路径（老浏览器 / VT 不可用）：仍是原来的颜色插值，功能不丢 */
    const cls = canAnimateVars() ? 'theme-anim' : 'theme-fade';
    root.classList.remove('theme-anim', 'theme-fade');
    root.classList.add(cls);
    /* 先按旧值算一次样式，保证过渡有「起点」；否则某些浏览器会把两帧合并成硬切 */
    void root.offsetWidth;
    apply();
    /* 图表在过渡走到一半时换成新配色：此时变量已接近终值，叠加旧画面淡出，
       视觉上是「化开」，不会在全站颜色定型的同一瞬间再闪一下。 */
    switchTheme._t = setTimeout(function () { crossFadeCharts(Math.max(240, Math.round(ms * 0.75))); },
      Math.round(ms * 0.5));
    switchTheme._t2 = setTimeout(function () {
      root.classList.remove(cls);
      root.style.removeProperty('--theme-dur');
    }, ms + 40);
  }
  /* 页面重排 / 重建的统一收尾：只有真的画了图才需要重渲染（图表配色写在 canvas 里）。
     纯文字页面重渲染只是白费一次 DOM 重建。 */
  function settlePage() {
    const v = document.getElementById('view');
    if (!v) return;
    v.classList.remove('theme-settle');
    void v.offsetWidth;
    v.classList.add('theme-settle');
    clearTimeout(settlePage._t);
    settlePage._t = setTimeout(function () { v.classList.remove('theme-settle'); }, 340);
  }
  /* 无动画路径（首次加载 / 语言切换等）用：只重绘图表，不做淡化 */
  function settleCharts() {
    if (!document.querySelector('.ec')) return;
    if (!window.Charts || !window.Charts.has || !window.Charts.has()) return;
    try { render(true); } catch (e) { return; }
    settlePage();
  }
  /* 顶栏按钮：在「浅色 ⇄ 深色」之间翻转，并把结果写进偏好（auto 被显式选择覆盖，
     与主流站点一致；想回到跟随系统就去参数设置页选「跟随系统」）。 */
  function toggleTheme(evt) {
    const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
    try { if (window.Prefs) Prefs.set('theme', next); } catch (e) { }
    /* 鼠标点击 → 从点击处扩散；键盘触发的 click 坐标恒为 0，交给 revealOrigin 回退 */
    const o = (evt && evt.clientX > 0 && evt.clientY > 0)
      ? { x: evt.clientX, y: evt.clientY } : 'center';
    switchTheme(next, true, o);
  }
  /* 供参数设置页的「主题」分段控件调用：偏好已写好，这里只负责带过渡地应用。
     扩散原点用最近一次指针位置（就是用户刚点下的那个分段按钮）。 */
  window.AppTheme = {
    apply: function () { switchTheme(effectiveTheme(), true); },
    current: effectiveTheme,
    pref: themePref
  };

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
    /* 三个榜单页共用同一套筛选条，所以 g=（预设分组）/ country=（地区）也统一生效；
       此前只有 rank 解析，趣味统计页刷新后 URL 里的分组会被丢掉。 */
    if (route === 'rank' || route === 'timeline' || route === 'topics') {
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

  /* 地区筛选的显示名（state.geo = '' | ISO2 | 'cont:XX' | 'reg:xx'） */
  function geoLabel(v) {
    if (!v) return t('f.all');
    if (v.indexOf('cont:') === 0) {
      const o = M.continents[v.slice(5)];
      return o ? (t.isEn() ? o.en : o.zh) : v;
    }
    if (v.indexOf('reg:') === 0) {
      const k = v.slice(4);
      const r = (M.regions || {})[k];
      if (r) return t.isEn() ? (r.en || r.zh) : (r.zh || r.en);
      return k.toUpperCase();
    }
    const iso = (window.Calc && window.Calc.isoNorm) ? window.Calc.isoNorm(v) : v;
    if (t.isEn()) return (M.countries && M.countries[iso]) || iso;
    return (M.countriesZh && M.countriesZh[iso]) || P.util.countryName(iso) || iso;
  }

  /* 地区 combobox：打开 / 过滤 / 选中 / 关闭。全部走 body 级委托，
     render() 换掉整条筛选栏后不需要重新绑定。 */
  function openGeo(inp) {
    const box = inp && inp.closest ? inp.closest('.geo-combo') : null;
    if (!box) return;
    /* ★ 2026-11-02 用户要求：点开输入框就把「已选中的地区名」清掉，
       不用先手动删几个字才能搜索。名字仍记在 data-label 上 ——
       没选新项直接关掉（Esc / 点空白）时 closeGeo 会把它写回去。 */
    const label = inp.getAttribute('data-label') || '';
    if ((inp.value || '') === label) inp.value = '';
    document.querySelectorAll('.geo-combo[data-open="1"]').forEach(function (b) { if (b !== box) closeGeo(b); });
    box.setAttribute('data-open', '1');
    inp.setAttribute('aria-expanded', 'true');
    geoFilter(inp);
    /* ★ 2026-11-02（第二轮用户要求）：点开后列表一律回到顶部，
       不再把当前选中项滚到可见位置 —— 记住上次翻到的位置，下次打开会「接着往下看」，
       用户找「中国」却停在大洋洲，反而更难用。 */
    const menu = box.querySelector('.geo-menu');
    if (menu) menu.scrollTop = 0;
  }
  function closeGeo(box) {
    if (!box || !box.getAttribute) return;
    box.setAttribute('data-open', '0');
    const inp = box.querySelector('.geo-input');
    if (inp) {
      inp.setAttribute('aria-expanded', 'false');
      inp.value = inp.getAttribute('data-label') || '';
    }
  }
  function closeGeoAll() {
    document.querySelectorAll('.geo-combo[data-open="1"]').forEach(closeGeo);
  }
  function geoFilter(inp) {
    const box = inp.closest('.geo-combo');
    if (!box) return;
    const q = (inp.value || '').trim().toLowerCase();
    const label = inp.getAttribute('data-label') || '';
    /* 输入框里显示的就是当前选中项的名字时视为「未输入」，列出全部 */
    const on = q && q !== label.toLowerCase() ? q : '';
    let shown = 0;
    const grpSeen = {};
    box.querySelectorAll('.geo-opt').forEach(function (o) {
      const hit = !on || (o.getAttribute('data-s') || '').indexOf(on) >= 0;
      o.hidden = !hit;
      if (hit) {
        shown++;
        const prev = o.previousElementSibling;
        if (prev && prev.classList.contains('geo-grp')) grpSeen[prev] = 1;
      }
    });
    /* 分组标题：该组下面一个可见项都没有就藏起来 */
    box.querySelectorAll('.geo-grp').forEach(function (g) {
      let n = 0, s = g.nextElementSibling;
      while (s && !s.classList.contains('geo-grp')) { if (!s.hidden) n++; s = s.nextElementSibling; }
      g.hidden = !n;
    });
    box.setAttribute('data-empty', shown ? '0' : '1');
  }
  function pickGeo(btn) {
    const v = btn.getAttribute('data-geo') || '';
    if (v.indexOf('reg:') === 0) { state.region = v.slice(4); state.geo = ''; }
    else { state.geo = v; state.region = ''; }
    state.country = ''; state.continent = ''; state.page = 1;
    closeGeoAll();
    syncFilterUrl(true);
  }

  function renderFilterBar(route) {
    if (route !== 'rank' && route !== 'timeline' && route !== 'topics') { fbEl.hidden = true; fbEl.innerHTML = ''; return; }
    fbEl.hidden = false;
    /* 年份下拉原本硬编码到 2025，导致「数据进入 2026 年后就没有变动」的错觉：
       既选不到 2026，默认值还停在 2025。这里改成按数据实际最新年份动态生成。 */
    const YMAX = (function () {
      const u = (M.meta && M.meta.updated) || '';
      const m = String(u).match(/^(\d{4})/);
      return m ? +m[1] : new Date().getFullYear();
    })();
    /* ★ 2026-11-05（第十五轮）：三个榜单页共用**同一套**筛选条。
       以前趣味统计页只有第二行的一半（缺预设分组 / 项目图标 / 成绩口径），
       把「按项目筛选」单独塞在正文里做成两行带文字的按钮，既不同构也不同操作
       （那边是单选 state.topicEvent，这边是多选 state.evSel + 预设组）。
       现在三页都渲染相同的两行：
         第一行 = 预设分组 chips + 项目图标多选；
         第二行 = 地区 · 性别 · 成绩口径 · 时间区间 · 停办项目 · 重置 · 计数。
       项目状态统一走 state.group / state.evSel，URL 里也用同一套 g= 参数。 */
    let h = '<div class="filterbar-inner">';
    h += '<div class="frow frow-ev">';

    /* ---------- 预设分组（快速筛选） + 事件图标多选 ---------- */
    h += '<div class="fgroup ev-fgroup">';
    h += '<div class="fctl presets" id="fgGroup">';
    const presets = [{ id: 'all', zh: t('f.all'), en: t('f.all') }].concat(M.presetGroups.filter(function (g) { return g.id !== 'all'; }));
    presets.forEach(function (g) {
      const on = state.group === g.id && !(state.evSel && state.evSel.length);
      h += '<button class="chip' + (on ? ' on' : '') + '" data-group="' + g.id + '">' + esc(t.isEn() ? g.en : g.zh) + '</button>';
    });
    h += '</div>';
    h += '<div class="ev-strip" id="fgEvents" role="group" aria-label="' + esc(t('f.events')) + '">';
    const evSel = state.evSel || [];
    const gids = (P.groupEventIds ? P.groupEventIds(state) : null);
    const inSet = function (id) { return evSel.indexOf(id) >= 0 || (gids && gids.indexOf(id) >= 0); };
    const activeEv = M.events.filter(function (e) { return !e.retired; });
    const retiredEv = M.events.filter(function (e) { return e.retired; });
    /* 停办的四个项目与现行项目放在**同一行**、排在最后（用户要求：不要再单独占一行）。
       未勾选「含停办项目」时仍可悬停看名字，但点击无效（由 click 处理器拦截）。 */
    h += '<div class="ev-row">';
    const evBtn = function (e) {
      const on = inSet(e.id);
      const nm = t.isEn() ? e.en : e.zh;
      /* 项目名称浮层：原生 title 有 1 秒延迟且位置由系统决定，
         这里改用 body 级浮层，并指定出现在**鼠标上方**（data-tip-pos="top"）。
         排除态：停办项目且当前「不计入」时打 excluded 标记，由 CSS 给虚线边框 + 更淡 + 斜杠。 */
      const excluded = e.retired && !state.retired;
      const tip = excluded ? (nm + (t.isEn() ? ' · discontinued · currently excluded' : ' · 停办项目 · 当前不计入')) :
        (e.retired ? (nm + (t.isEn() ? ' · discontinued' : ' · 停办项目')) : nm);
      return '<button class="ev-tab' + (on ? ' on' : '') + (e.retired ? ' retired' : '') + (excluded ? ' excluded' : '') + '" data-evtab="' + e.id + '"' +
        ' data-tip="' + esc(tip) + '" data-tip-pos="top" aria-label="' + esc(nm) + '">' + window.Icons.event(e.id) + '</button>';
    };
    activeEv.forEach(function (e) { h += evBtn(e); });
    if (retiredEv.length) {
      h += '<span class="ev-sep" aria-hidden="true"></span>';
      retiredEv.forEach(function (e) { h += evBtn(e); });
    }
    h += '</div>';
    h += '</div>';
    h += '</div>';
    h += '</div>';   /* /frow-ev */

    h += '<div class="frow frow-meta">';

    /* ---------- 地区（大洲 / 国家合并为单一下拉；支持手动输入搜索） ----------
       自绘 combobox：输入框 + 下拉列表，匹配串同时包含中文名 / 英文名 / ISO2，
       中英文界面下都能搜（原生 select 只认当前语言的首字母）。 */
    h += '<div class="fgroup"><span class="flabel">' + esc(t('f.region')) + '</span><div class="fctl">';
    h += '<div class="geo-combo" id="fgGeoBox" data-open="0">';
    h += '<input id="fgGeoQ" class="geo-input" type="text" autocomplete="off" spellcheck="false" role="combobox" aria-expanded="false" aria-autocomplete="list" aria-controls="fgGeoMenu" placeholder="' + esc(t('f.searchPh')) + '" value="' + esc(geoLabel(state.geo)) + '" data-label="' + esc(geoLabel(state.geo)) + '" data-geo="' + esc(state.geo || '') + '">';
    h += '<span class="geo-caret" aria-hidden="true"></span>';
    h += '<div class="geo-menu" id="fgGeoMenu" role="listbox">';
    const contOrder = ['As', 'NAm', 'SAm', 'Eu', 'Af', 'Oc'];
    const cn = P.util.countryName;
    const mt = function (zh, en, iso) {
      return esc((zh + ' ' + en + ' ' + iso + ' ' + iso.toLowerCase()).toLowerCase());
    };
    h += '<button type="button" class="geo-opt' + (!state.geo ? ' on' : '') + '" data-geo="" data-s="' + mt(t('f.all'), 'all', '') + '">' + esc(t('f.all')) + '</button>';
    h += '<div class="geo-grp">' + esc(t.isEn() ? 'Continents' : '大洲') + '</div>';
    contOrder.forEach(function (c) {
      const v = 'cont:' + c;
      const zh = M.continents[c].zh, en = M.continents[c].en;
      h += '<button type="button" class="geo-opt' + (state.geo === v ? ' on' : '') + '" data-geo="' + v + '" data-s="' + mt(zh, en, c) + '">' + esc(t.isEn() ? en : zh) + '</button>';
    });
    h += '<div class="geo-grp">' + esc(t.isEn() ? 'Countries / regions' : '国家 / 地区') + '</div>';
    const fixed = ['CN', 'HK', 'MO', 'TW'];
    fixed.concat(M.countryList.slice().sort()).filter(function (iso, i, a) { return a.indexOf(iso) === i; }).forEach(function (iso) {
      const zh = (M.countriesZh && M.countriesZh[iso]) || cn(iso) || iso;
      const en = M.countries[iso] || iso;
      h += '<button type="button" class="geo-opt' + (state.geo === iso ? ' on' : '') + '" data-geo="' + iso + '" data-s="' + mt(zh, en, iso) + '">' + esc(t.isEn() ? en : zh) + '</button>';
    });
    h += '<div class="geo-none">' + esc(t.isEn() ? 'No matching region' : '没有匹配的地区') + '</div>';
    h += '</div></div></div></div>';

    /* ---------- 性别 ---------- */
    h += '<div class="fgroup"><span class="flabel">' + esc(t('f.gender')) + '</span><div class="fctl">';
    [['all', 'f.gender.all'], ['M', 'f.gender.m'], ['F', 'f.gender.f']].forEach(function (g) {
      h += '<button class="chip' + (state.gender === g[0] ? ' on' : '') + '" data-gender="' + g[0] + '">' + esc(t(g[1])) + '</button>';
    });
    h += '</div></div>';

    /* ---------- 成绩口径：总计 / 单次 / 平均 ----------
       总榜 / 图表可视化切换六维轨（p.sixS / p.sixA）；趣味统计页按轨重算纪录类
       指标（calc.statsTrack）。三页都是「切口径 → 数值变、人数不变」。 */
    h += '<div class="fgroup"><span class="flabel">' + esc(t('rank.type')) + '</span><div class="fctl">';
    [['all', 'rank.type.all'], ['single', 'rank.type.single'], ['avg', 'rank.type.avg']].forEach(function (x) {
      h += '<button class="chip' + ((state.recType || 'all') === x[0] ? ' on' : '') + '" data-type="' + x[0] + '" title="' + esc(t('rank.type.d')) + '">' + esc(t(x[1])) + '</button>';
    });
    h += '</div></div>';

    /* ---------- 时间区间 ---------- */
    h += '<div class="fgroup"><span class="flabel">' + esc(t('f.period')) + '</span><div class="fctl">';
    h += '<select id="fgY0"><option value="">1982</option>';
    for (let y = 2003; y <= YMAX; y++) h += '<option value="' + y + '"' + (state.y0 === y ? ' selected' : '') + '>' + y + '</option>';
    h += '</select><span class="tiny muted">–</span>';
    h += '<select id="fgY1"><option value=""' + (state.y1 == null ? ' selected' : '') + '>' + esc(t('f.now')) + '</option>';
    for (let y = 2003; y <= YMAX; y++) h += '<option value="' + y + '"' + (state.y1 === y ? ' selected' : '') + '>' + y + '</option>';
    h += '</select></div></div>';

    /* ---------- 停办项目 ---------- */
    h += '<div class="fgroup"><span class="flabel">' + esc(t('f.retired')) + '</span><div class="fctl">';
    h += '<button class="chip' + (state.retired ? ' on' : '') + '" data-retired="1">' + esc(state.retired ? t('f.include') : t('f.exclude')) + '</button>';
    h += '</div></div>';

    h += '<button class="btn" id="fgReset">' + esc(t('f.reset')) + '</button>';
    h += '<span class="filter-summary" id="fgSummary"></span>';
    h += '</div>';   /* /frow-meta */
    h += '</div>';   /* /filterbar-inner */

    fbEl.innerHTML = h;
  }

  function updateSummary(route) {
    const el = document.getElementById('fgSummary');
    if (!el) return;
    /* 透明化计数：WCA 注册人数 / 六维评分覆盖人数 / 本页可翻页人数，三个口径分开摆。
       注意 rated 与 listed 不是一回事：六维引擎对全量选手都算过分（约 29.9 万），
       但 data.js 只为体积下发前 6 万名（--slim-max），榜单只能翻这部分。
       以前两者混用，页面写「评分体系收录 6 万」，看起来像另外 24 万人压根没被统计。 */
    const total = (M.meta && M.meta.players) || M.ranked.length;   // WCA 全量注册
    const rated = (M.meta && M.meta.sixAll) || M.ranked.length;    // 六维引擎实际算过分（全量）
    const listed = M.ranked.length;                                // data.js 下发、榜单可翻页
    const allEvents = Object.keys(M.EV || {});
    const evAll = (state.evSel && state.evSel.length) ? state.evSel.length >= allEvents.length : true;
    const noFilt = !state.geo && (!state.gender || state.gender === 'all') && !state.y0 && !state.y1
      && evAll && (!state.group || state.group === 'all') && !state.retired;
    let matched = listed;
    if (route === 'rank' || route === 'timeline') matched = noFilt ? listed : P.filtered(state).length;
    else if (route === 'topics') matched = P.util.topicPool(state).length;
    let geoLabel = '';
    if (state.region) geoLabel = P.util.regionName(state.region);
    else if (state.geo) {
      if (state.geo.indexOf('cont:') === 0) geoLabel = P.util.contName(state.geo.slice(5));
      else geoLabel = P.util.countryName(state.geo) || state.geo;
    }
    let main, note;
    if (noFilt && (route === 'rank' || route === 'timeline')) {
      main = t('f.summaryAll', { n: U.num(total), rated: U.num(rated), shown: U.num(listed) });
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
    /* 「六维分数细则」是参数设置页的子页面：#/model/sixdim。
       沿用 model 路由的好处是导航高亮、参数页口径都保持不变。 */
    else if (route === 'model') html = (r.seg[1] === 'sixdim' && P.sixdim) ? P.sixdim(state) : P.model(state);
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
        /* 纪录持有图：缩放 / 平移（ctrl+滚轮 / alt+滚轮 / 拖动）+ 恢复默认按钮 */
        if (box && P.bindLaneZoom) P.bindLaneZoom(box);
        const zbtn = document.getElementById('tlZoomReset');
        if (zbtn) zbtn.addEventListener('click', function () {
          const b2 = document.getElementById('tlChart');
          if (b2 && P.tlResetZoom) P.tlResetZoom(b2);
        });
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
              '<span class="tiny muted">' + U.fmt(p.overall, 2) + '</span></div>';
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
      const railFill = document.getElementById('tlRailFill');
      /* 时间轴进度填充：原生 range 不暴露「已走比例」，所以自己按 value 折算成百分比，
         由 .tl-rail-fill 画强调色进度条。播放每帧 / 拖动 / 按键统一走这里。 */
      function syncRail() {
        if (!railFill || !range) return;
        const mn = +range.min || 0, mx = +range.max || 1;
        const pct = mx > mn ? ((+range.value) - mn) / (mx - mn) * 100 : 0;
        railFill.style.width = Math.max(0, Math.min(100, pct)).toFixed(3) + '%';
      }
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
        syncRail();
        if (box) { box.setAttribute('data-fy', state.tlFy); P.drawTimeline(box); }
        if (P.tlHighlightRail) P.tlHighlightRail(info.fy);
      }
      /* 播放按钮形态：播放中=暂停图标，停在结尾=重播图标，其余=播放图标。
         图标形状由 CSS 用同一枚 clip-path 多边形插值（▶ ⇄ ❙❙），这里只管状态与文案。 */
      function tlAtEnd() {
        /* 先看滑块位置：最权威。刚挂载时 state.tlFy 还是 0，但时间轴已经渲染在最后一天，
           只比 tlFy 会得出「没到结尾」→ 按钮显示播放，点一下瞬间结束又变回重播，
           用户必须点两次才能真正开始播放。 */
        try {
          if (range) {
            const sl = P.tlSlider(state.tlStep, P.tlEndFy ? P.tlEndFy() : state.tlFy);
            if (+range.value >= sl.max - 1) return true;
          }
        } catch (e) { }
        return state.tlFy >= (P.tlEndFy ? P.tlEndFy() : 0) - 1e-6;
      }
      function setPlayBtn() {
        const pb = document.getElementById('tlPlay'); if (!pb) return;
        const st = state.tlPlaying ? 'pause' : (tlAtEnd() ? 'replay' : 'play');
        pb.setAttribute('data-state', st);
        const tx = pb.querySelector('.tl-play-tx');
        if (tx) tx.textContent = st === 'pause' ? t('tl.pause') : (st === 'replay' ? t('tl.replay') : t('tl.play'));
      }
      if (range) range.addEventListener('input', function () { setFyFromRange(range); setPlayBtn(); });
      /* ★ 播放循环抽成具名函数（2026-11-01 用户反馈「播放中改筛选，竞速图就停住了」）：
         render() 会把整页 innerHTML 换掉，range / box / lab 全部变成新节点，而旧的
         rAF 循环闭包里还攥着上一批**已经脱离文档**的节点 —— 它仍在跑，但画的、写的
         都不是屏幕上那套 DOM，看起来就是「停在原地」。
         现在每次 mount 都按 state.tlPlaying 决定是否用新 DOM 重新起循环，
         起点取新滑块的当前值，于是页面从同一时刻、按新口径继续播下去。 */
      function startPlay() {
        if (!range) return;
        if (tlRaf) { cancelAnimationFrame(tlRaf); tlRaf = 0; }   /* 先掐掉上一轮 */
        state.tlPlaying = true;
        /* 按钮内容是「图标 + 文字」两块，不能直接 textContent（会把图标抹掉） */
        setPlayBtn();
        /* 播放改用 requestAnimationFrame 逐帧推进：
           每帧按真实经过的时间算出「应该走到第几天」的小数位置，
           · 日期标签每天变一次（整数天跨过去才更新）；
           · 图表拿小数天去算分数，因此条形长度是连续变化的，不再一格一格跳；
           · 名次换位时图表自己用很短的过渡补间，不会拖慢整体速度。
           播放原点（tlPlayIdx / tlPlayMs）独立保存，拖动时间轴时实时重置，
           因此播放中也能点击 / 拖动滑块跳到任意时间点并继续播放。 */
        const rate = (P.tlRate ? P.tlRate() : { jump: 60, anim: 200, fps: 100 });
        const daysPerSec = Math.max(0.5, rate.jump || 30);
        /* 重绘间隔（rate.fps，毫秒）：0 = 逐帧重绘；>0 时每 fps 毫秒才重画一次图表。
           重绘是播放中最贵的一步（整张竞速图要重算明细并重排），但日期标签、滑块位置、
           里程碑提示仍逐帧更新 —— 节流只降低画面刷新率，不拖慢时间推进本身。 */
        const redrawGap = Math.max(0, rate.fps || 0);
        let lastDrawMs = 0;
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
            syncRail();
            const info = P.tlIdxToInfo(idx, state.tlStep);
            if (lab) lab.textContent = info.label;
            if (P.tlHighlightRail) P.tlHighlightRail(info.fy);
          }
          /* 小数天：让分数在两天之间连续插值 */
          const fy = P.tlFyAt ? P.tlFyAt(idx, frac, state.tlStep) : (P.tlIdxToInfo(idx, state.tlStep).fy);
          state.tlFy = fy;
          /* 到了结尾一定要画最后一帧，否则节流会把最终名次吞掉 */
          if (box && (!redrawGap || nowMs - lastDrawMs >= redrawGap || pos >= sl.max)) {
            lastDrawMs = nowMs;
            box.setAttribute('data-fy', fy); P.drawTimeline(box);
          }
          /* 每帧按图表真实时间（小数年→日期）精确检测里程碑跨越，弹窗时间与竞速图严格对应 */
          const curDate = P.tlDateAtFy ? P.tlDateAtFy(fy) : (P.tlDateAt ? P.tlDateAt(idx, state.tlStep) : null);
          if (lastMsDate && curDate && curDate !== lastMsDate) msToastFor(lastMsDate, curDate);
          if (curDate) lastMsDate = curDate;
          if (pos >= sl.max) {
            /* 走完时把时间轴与整数位置精确对齐到最后一格，
               否则 tlAtEnd() 会因为末尾的小数误差认不出「已到结尾」，按钮不变成重播。 */
            try {
              range.value = sl.max;
              const info = P.tlIdxToInfo(sl.max, state.tlStep);
              state.tlFy = info.fy;
              if (lab) lab.textContent = info.label;
              if (box) { box.setAttribute('data-fy', info.fy); P.drawTimeline(box); }
            } catch (e2) { }
            stopPlay(); return;
          }
          tlRaf = requestAnimationFrame(frame);
        }
        tlRaf = requestAnimationFrame(frame);
      }
      if (play) play.addEventListener('click', function () {
        if (state.tlPlaying) { stopPlay(); return; }
        if (!range) return;
        /* 停在结尾时按钮是「重播」：先把时间轴拨回起点再播，否则会立刻再次结束。 */
        if (tlAtEnd()) {
          const slog = P.tlSlider(state.tlStep, state.tlFy);
          range.value = slog.min;
          setFyFromRange(range);
        }
        startPlay();
      });
      function stopPlay() {
        state.tlPlaying = false;
        clearInterval(tlTimer);
        if (tlRaf) { cancelAnimationFrame(tlRaf); tlRaf = 0; }
        setPlayBtn();   /* 走完自动停在结尾时会变成「重播」图标 */
      }
      setPlayBtn();     /* 首次挂载时同步一次（默认停在结尾 → 显示重播） */
      syncRail();       /* 首帧就把进度条画到当前时刻 */
      /* ★ 重渲染后接续播放：筛选一变就整页重渲染，这里用**新**的 DOM 从当前时刻重新起循环，
         于是「播放中改筛选」不会中断，时间轴也不会被拨回起点。 */
      if (state.tlPlaying) {
        if (range) startPlay();
        else state.tlPlaying = false;   /* 切到纪录持有图：没有播放控件，直接停下 */
      } else if (tlRaf) { cancelAnimationFrame(tlRaf); tlRaf = 0; }
      /* 时间跳跃（天/秒）：2026-11-04 起是唯一保留的速率项 —— 动画时长与重绘间隔
         回落到内部默认（100ms / 20ms），不再暴露给用户，滑杆也一并去掉。
         输入即生效（播放中下一帧就采用新值）；失焦 / 回车时按 min/max 夹紧并回写，
         避免出现 0 天/秒或 999 天/秒这类无效值。 */
      const jumpNum = document.getElementById('tlRatejump');
      if (jumpNum) {
        const applyJump = function (raw, force) {
          const r = (P.tlRate ? P.tlRate() : { jump: 60 });
          const val = (P.tlClampRate ? P.tlClampRate('jump', raw) : parseInt(raw, 10));
          if (isNaN(val)) return;
          r.jump = val;
          try { localStorage.setItem('goat-tlrate-v1', JSON.stringify(r)); } catch (e) { }
          if (force) jumpNum.value = val;
          /* 立即重绘当前帧（播放时下一帧自然会用新值），不必手动刷新 */
          if (box) P.drawTimeline(box);
        };
        jumpNum.addEventListener('input', function () { applyJump(jumpNum.value, false); });
        jumpNum.addEventListener('change', function () { applyJump(jumpNum.value, true); });
        jumpNum.addEventListener('blur', function () { applyJump(jumpNum.value, true); });
        jumpNum.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); jumpNum.blur(); } });
      }
      /* ★ 2026-11-05 晚（第十五轮）：全局 ← / → 调时间。
         · 进度条被选中（鼠标点/拖过轨道、或它持有焦点）→ 每次 **1 天**；
         · 其余情况（点在图表 / 页面空白处）→ 每次 **1 年（365 天）**。
         两种步长都「保持原有状态」：原本在演进就从新位置继续演进（速度不变），
         原本暂停就仍然暂停。只在「本页 + 竞速图（存在 #tlRange）」时生效；
         每次 mount 先摘掉上一轮的监听器（否则重渲染一次就多挂一个，一次跳好几年）。

         ⚠ 以前对 INPUT 一律 return，交给 range 的原生键盘行为按 step=1 走一天，
         但那样只改 DOM 的 value、不会同步 state.tlFy / 图表 / 播放状态；而且用户
         点完轨道再按左右键时焦点常常已经不在滑杆上，体感就是「选中了进度条
         却还是一次跳一年」。现在这一步统一由这里接管，并 preventDefault 掉原生
         步进（不挡就会一次走两格）。 */
      /* 进度条「选中态」跨重渲染保存：点轨道内置 true，点页面其它地方置 false。
         捕获阶段挂一次即可，旧的先摘掉，避免每 render 一层叠加。 */
      window.__tlRailPicked = false;
      if (window.__tlRailPickHandler) document.removeEventListener('pointerdown', window.__tlRailPickHandler, true);
      window.__tlRailPickHandler = function (ev) {
        const t = ev.target;
        window.__tlRailPicked = !!(t && range &&
          (t === range || (range.parentNode && range.parentNode.contains(t))));
      };
      document.addEventListener('pointerdown', window.__tlRailPickHandler, true);
      if (range) range.addEventListener('focus', function () { window.__tlRailPicked = true; });
      function onTlArrow(e) {
        if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        const tg = e.target;
        if (tg && tg !== range &&
          (tg.tagName === 'INPUT' || tg.tagName === 'TEXTAREA' || tg.tagName === 'SELECT' || tg.isContentEditable)) return;
        if (!range || !document.body.contains(range)) return;
        const onRail = tg === range || document.activeElement === range || window.__tlRailPicked;
        const dayStep = onRail ? 1 : 365;
        const max = +range.max;
        const next = Math.max(+range.min, Math.min(max, (+range.value) + (e.key === 'ArrowRight' ? dayStep : -dayStep)));
        e.preventDefault();
        if (next === +range.value) return;            /* 已经在头 / 尾，无处可去 */
        const wasPlaying = !!state.tlPlaying;
        range.value = next;
        setFyFromRange(range);
        if (wasPlaying) {
          if (next >= max) stopPlay();                /* 正好走到终点：正常收尾，不再空转 */
          else startPlay();                           /* 继续演进 */
        } else {
          setPlayBtn();                               /* 保持暂停，只更新按钮形态 */
        }
      }
      if (window.__tlArrowHandler) document.removeEventListener('keydown', window.__tlArrowHandler);
      window.__tlArrowHandler = onTlArrow;
      document.addEventListener('keydown', onTlArrow);

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
            /* 竞速图条形上的 data 字段是 id，纪录持有图色块上的是 pid（选手 id，用于区分同名） */
            let id = (params.data && (params.data.id || params.data.pid)) || '';
            if (!id && params.componentType === 'yAxis') {
              const nm = params.value;
              const hit = M.ranked.filter(function (x) { return x.name === nm; })[0];
              if (hit) id = hit.id;
            }
            /* 只跳「本站确实有档案」的选手：泳道里的纪录持有者可能是排名很靠后、
               没有收录进 ranked 的人，跳过去只会看到空页面。 */
            if (id && M.ranked.some(function (x) { return x.id === id; })) location.hash = '#/player/' + id;
          });
        }
        if (P.tlHighlightRail) P.tlHighlightRail(state.tlFy || (P.tlEndFy ? P.tlEndFy() : 2026));
      }
    }

    if (route === 'topics') {
      const sel = document.getElementById('counterSel');
      if (sel) sel.addEventListener('change', function () { state.counterZero = sel.value; render(true); });
    }

    if (route === 'model') {
      /* 预设：2026-11-04 晚从 <select> 改成 chips（.pz-chip[data-preset]） */
      document.querySelectorAll('[data-preset]').forEach(function (b) {
        b.addEventListener('click', function () {
          const v = b.getAttribute('data-preset');
          if (!v) return;
          Pm.applyPreset(v); render(true); toast(t('ui.ok'));
        });
      });
      const rs = document.getElementById('pReset');
      if (rs) rs.addEventListener('click', function () { Pm.reset(); render(true); toast(t('ui.ok')); });
      const mcr = document.getElementById('mColorReset');
      if (mcr) mcr.addEventListener('click', function () { Pm.resetColors(); render(true); toast(t('ui.ok')); });

      /* ---- 「外观与交互」板块已按用户 2026-11-05 要求删除：
         这里不再有 .pz-seg[data-pref] / #prefReset 的绑定。主题仍由顶栏 ☀/☾ 控制，
         Prefs 的 density / motion / perPage 保留默认值（cozy / full / 20）。 ---- */

      /* ---- 六维占比（2026-11-05 第十四轮去掉滑杆，改为卡片 + 步进器）----
         控件：数字框（直接输入，0.1%）与 −/+ 按钮（一次 1%），外加一条只读进度条。
         改任一维时其余五维**按原比例**分摊剩下的权重，六维合计恒为 100%。 */
      const WK = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'];
      const wNum = function (k) { return document.querySelector('.wc-num[data-wdim="' + k + '"]'); };
      const syncWdim = function (src) {
        const w = (Pm.weights ? Pm.weights() : {}) || {};
        let sum = 0;
        WK.forEach(function (k) {
          const pct = (w[k] || 0) * 100;
          sum += pct;
          const el = wNum(k);
          if (el && el !== src) el.value = pct.toFixed(1);
          const bar = document.querySelector('[data-wbar="' + k + '"]');
          if (bar) bar.style.width = pct.toFixed(2) + '%';
          const seg = document.querySelector('[data-wseg="' + k + '"]');
          if (seg) seg.style.width = pct.toFixed(2) + '%';
        });
        const s = document.getElementById('wSum');
        if (s) s.textContent = t('md.weightsSum', { s: sum.toFixed(1) });
      };
      const applyW = function (k, pctValue) {
        const f = Math.max(0, Math.min(1, (Number(pctValue) || 0) / 100));
        const norm = (Pm.weights ? Pm.weights() : {}) || {};
        const sumOthers = 1 - (norm[k] || 0);
        WK.forEach(function (j) {
          const vj = (j === k) ? f
            : (sumOthers > 0 ? (1 - f) * (norm[j] || 0) / sumOthers : 0);
          Pm.set('b' + j.slice(1), vj);
        });
      };
      const scheduleW = function () {
        clearTimeout(window.__wdT);
        window.__wdT = setTimeout(function () { render(true); }, 420);
      };
      document.querySelectorAll('.wc-num[data-wdim]').forEach(function (el) {
        el.addEventListener('input', function () {
          const k = el.getAttribute('data-wdim');
          const v = parseFloat(el.value);
          if (!k || isNaN(v)) return;
          applyW(k, v); syncWdim(el); scheduleW();
        });
        /* 失焦时按当前真实权重回填，避免输入「999」后框里留着不可能的数值 */
        el.addEventListener('blur', function () { syncWdim(null); });
      });
      document.querySelectorAll('[data-wstep]').forEach(function (b) {
        b.addEventListener('click', function () {
          const k = b.getAttribute('data-wstep');
          const dir = Number(b.getAttribute('data-dir')) || 1;
          if (!k) return;
          const cur = ((Pm.weights ? Pm.weights() : {}) || {})[k] || 0;
          applyW(k, Math.max(0, Math.min(100, cur * 100 + dir)));
          syncWdim(null); scheduleW();
        });
      });
      syncWdim(null);
      const wSumEl = document.getElementById('wSum');
      if (wSumEl) {
        const ww = (Pm.weights ? Pm.weights() : {}) || {};
        let s = 0;
        WK.forEach(function (j) { s += (ww[j] || 0) * 100; });
        wSumEl.textContent = t('md.weightsSum', { s: s.toFixed(1) });
      }
      const wR = document.getElementById('wReset');
      if (wR) wR.addEventListener('click', function () {
        ['b1', 'b2', 'b3', 'b4', 'b5', 'b6'].forEach(function (k) { Pm.set(k, Pm.defaults[k]); });
        render(true); toast(t('ui.ok'));
      });
      const wE = document.getElementById('wEven');
      if (wE) wE.addEventListener('click', function () {
        ['b1', 'b2', 'b3', 'b4', 'b5', 'b6'].forEach(function (k) { Pm.set(k, 1 / 6); });
        render(true); toast(t('ui.ok'));
      });
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
      /* 国家配色已按用户要求整块删除（2026-11-04 晚），这里不再有 [data-ccmod] 绑定。
         国家取色仍由 pages-extra.js 的 countryColor() 按国码稳定自动生成。 */
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
      /* 六维分数细则子页面：容器内自行判断，没有 #sdRoot 时立即返回，
         7MB 数据表只在真正进入该子页面时才动态加载。 */
      if (P.sixdimMount) P.sixdimMount();
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

  /* ---------- 全局事件委托 ---------- */
  /* ⚠ 这里少一个选择器，对应的按钮就「点了没反应」——2026-10-27 的六维筛选按钮
     正是因为漏了 [data-dim]/[data-tldim]，事件委托根本收不到点击，才表现为「加了按钮但没功能」。 */
  const DELEGATE = '[data-sort],[data-page],[data-expand],[data-prow],[data-tab],[data-type],[data-stack],[data-dim],[data-tldim],[data-pkadd],[data-pkrm],[data-pktrayrm],[data-pktrayclear],[data-toggle],[data-expandall],[data-goto],[data-group],[data-gender],[data-retired],[data-tlmode],[data-tlview],[data-tlstep],[data-tlmetric],[data-tllane],[data-topic],[data-topicboard],[data-other],[data-nation],[data-scope],[data-continent],[data-evpick],[data-evtab],[data-evtoggle],[data-evall],[data-evnone],[data-evsave],[data-gload],[data-gdel],[data-reclevel],[data-rectype],[data-podtier],[data-mdanchor],[data-mdsec],[data-msimport],[data-msreset],[data-msdel],[data-msedit],[data-msunhide],[data-msjump],[data-copy]';

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
    if (el.hasAttribute('data-copy')) { copyText(el.getAttribute('data-copy')); return; }
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
    /* 六维单独筛选（总榜）：选某一维后榜单按该维度分重排 */
    if (el.hasAttribute('data-dim')) {
      state.dimSel = el.getAttribute('data-dim') || ''; state.page = 1; state.sortKey = 'score'; state.sortDir = 'desc';
      render(); return;
    }
    if (el.hasAttribute('data-type')) {
      state.recType = el.getAttribute('data-type'); state.page = 1;
      render(true); return;
    }
    /* 总榜柱状图堆叠方式：按项目（各项目六维小计）/ 按维度（六维加权贡献） */
    if (el.hasAttribute('data-stack')) {
      state.stackMode = el.getAttribute('data-stack');
      render(); return;
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
      /* 切到纪录持有图 / 换步进：没有播放控件，停掉循环（老循环不清会一直空转往旧容器里画） */
      if (state.tlView === 'lane') { state.tlPlaying = false; clearInterval(tlTimer); if (tlRaf) { cancelAnimationFrame(tlRaf); tlRaf = 0; } }
      render(true); return;
    }
    if (el.hasAttribute('data-tlstep')) {
      state.tlStep = el.getAttribute('data-tlstep'); state.tlPlaying = false; clearInterval(tlTimer);
      if (tlRaf) { cancelAnimationFrame(tlRaf); tlRaf = 0; }
      render(true); return;
    }
    if (el.hasAttribute('data-tlmetric')) { state.tlMetric = el.getAttribute('data-tlmetric'); render(true); return; }
    if (el.hasAttribute('data-tllane')) { state.tlLane = el.getAttribute('data-tllane'); render(true); return; }
    if (el.hasAttribute('data-tldim')) { state.tlDim = el.getAttribute('data-tldim') || ''; render(true); return; }
    if (el.hasAttribute('data-topic')) { state.topicTab = el.getAttribute('data-topic'); state.topicBoard = ''; render(true); return; }
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

  /* ── 空格键播放 / 暂停 / 重播（2026-11-02 第二轮用户要求）──
     只在「分数演进图」页（#tlPlay 存在）生效，等价于点一下播放按钮。
     以下情况不劫持，交还给浏览器 / 原生控件：
       ① 正在文本框里打字（空格是字符）；② 焦点在别的按钮 / 链接上（空格本该激活它）；
       ③ 带修饰键（Ctrl/⌘/Alt）。滑杆（range）例外放行 —— 空格对 range 无原生行为。
     焦点在播放按钮上时**必须 preventDefault**：否则原生会在 keyup 再触发一次 click，
     加上我们自己这一次 = 播放/暂停连打两下，等于没反应。 */
  document.addEventListener('keydown', function (e) {
    if (e.key !== ' ' && e.code !== 'Space' && e.keyCode !== 32) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const tg = e.target;
    if (tg && tg.tagName === 'INPUT') {
      /* 只有滑杆（range）放行：空格对 range 本来就没有原生行为，而「拖完时间轴
         焦点停在滑杆上」是最常见的状态，这时用户按空格就是想播/停。
         其它 input（文本框 / 数字框 / 复选 / 单选）里空格要么是字符、要么是原生激活，一律让开。 */
      if (String(tg.type || 'text').toLowerCase() !== 'range') return;
    }
    if (tg && (tg.tagName === 'TEXTAREA' || tg.tagName === 'SELECT' || tg.isContentEditable)) return;
    const btn = document.getElementById('tlPlay');
    if (!btn) return;
    if (tg && (tg.tagName === 'BUTTON' || tg.tagName === 'A') && tg !== btn) return;
    e.preventDefault();
    btn.click();
  });

  /* ── 地区 combobox 的交互（body 级委托：render() 换掉筛选栏也不用重绑）── */
  document.addEventListener('focusin', function (e) {
    if (e.target && e.target.id === 'fgGeoQ') openGeo(e.target);
  });
  document.addEventListener('input', function (e) {
    if (e.target && e.target.id === 'fgGeoQ') geoFilter(e.target);
  });
  document.addEventListener('keydown', function (e) {
    if (!e.target || e.target.id !== 'fgGeoQ') return;
    const box = e.target.closest('.geo-combo');
    if (e.key === 'Escape') { closeGeo(box); e.target.blur(); return; }
    if (e.key === 'Enter') {
      const first = box && box.querySelector('.geo-opt:not([hidden])');
      if (first) { e.preventDefault(); pickGeo(first); }
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const opts = Array.prototype.slice.call(box.querySelectorAll('.geo-opt:not([hidden])'));
      if (!opts.length) return;
      e.preventDefault();
      let i = opts.indexOf(document.activeElement);
      i = e.key === 'ArrowDown' ? (i + 1) % opts.length : (i <= 0 ? opts.length - 1 : i - 1);
      opts[i].focus();
    }
  });
  document.addEventListener('click', function (e) {
    const opt = e.target.closest ? e.target.closest('.geo-opt') : null;
    if (opt) { e.preventDefault(); pickGeo(opt); return; }
    const box = e.target.closest ? e.target.closest('#fgGeoBox') : null;
    if (box) { const inp = box.querySelector('#fgGeoQ'); if (inp && document.activeElement !== inp) openGeo(inp); return; }
    closeGeoAll();
  });

  document.addEventListener('change', function (e) {
    const el = e.target;
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
      state.topicBoard = '';
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

  /* ---------- 通用悬浮提示（data-tip） ----------
     为什么不用原生 title：浏览器有 ~1 秒延迟、样式随系统、触屏设备根本不弹，
     用户反馈「鼠标移到『最长纪录保持』胶囊上什么都不显示」就是它。
     这里用一个 body 级的单例浮层接管所有 [data-tip]，内容统一走 textContent（天然防注入），
     换行用 white-space:pre-line 呈现。 */
  let TIP_BOX = null;
  let TIP_ANCHOR = null, TIP_SIZE = { w: 0, h: 0 };
  function tipBox() {
    if (TIP_BOX && TIP_BOX.parentNode) return TIP_BOX;
    TIP_BOX = document.createElement('div');
    TIP_BOX.className = 'wb-tip';
    document.body.appendChild(TIP_BOX);
    return TIP_BOX;
  }
  function hideTip() { TIP_ANCHOR = null; if (TIP_BOX) TIP_BOX.classList.remove('on'); }
  /* 定位：四种模式
     · data-tip-follow="x" —— **只跟随横坐标**：横向跟着光标走，纵向吸附到元素外侧
       （优先元素上方，上方装不下才翻下方，最后夹进视口），因此永远不会压在被悬停的
       卡片 / 项目格子上。卡片、项目领域这类「内容是卡片本身」的目标用这个模式。
     · data-tip-follow（="1"）—— 整块浮在鼠标上方并水平居中，随光标移动；堆叠分段用。
     · data-tip-pos="top"    —— 挂在元素上方，横向随鼠标（筛选栏那一排项目图标用）。
     · 默认                  —— 挂在元素正下方，放不下翻到上方。 */
  function placeTip(anchor, cx, cy) {
    const el = tipBox();
    const r = anchor.getBoundingClientRect();
    const followMode = anchor.getAttribute('data-tip-follow');
    const follow = followMode != null;
    const top = anchor.getAttribute('data-tip-pos') === 'top';
    /* 尺寸只在内容变化时量一次，避免每次 mousemove 都触发重排 */
    const w = TIP_SIZE.w, hh = TIP_SIZE.h;
    const vw = window.innerWidth || 1024, vh = window.innerHeight || 768;
    const clampX = (px) => Math.max(8, Math.min(px - w / 2, vw - w - 8));
    let x, y;
    if (followMode === 'x') {
      x = clampX(cx != null ? cx : r.left + r.width / 2);
      y = r.top - hh - 10;                       /* 默认贴在被悬停元素的上沿之上 */
      if (y < 8) y = r.bottom + 10;              /* 上方出界才翻到元素下方 */
      if (y + hh > vh - 8) y = Math.max(8, vh - hh - 8);   /* 仍放不下就收进视口 */
    } else if (follow) {
      /* 跟随模式：浮在鼠标**上方**并水平居中（堆叠条那一段涨高后，正上方是最不挡视线、
         也最贴近「这一段是什么」的位置），随光标移动；贴顶时翻到下方。 */
      const px = (cx != null ? cx : r.left + r.width / 2);
      const py = (cy != null ? cy : r.top + r.height / 2);
      x = px - w / 2;
      y = py - hh - 14;
      if (y < 8) y = py + 22;                       /* 上方放不下才翻到光标下方 */
      /* 翻下去也可能顶到视口底部（项目领域那种 8 行的大浮层），再夹一次，保证整块可见 */
      if (y + hh > vh - 8) y = Math.max(8, vh - hh - 8);
      x = Math.max(8, Math.min(x, vw - w - 8));
    } else {
      const mid = (cx != null && top) ? cx : (r.left + r.width / 2);
      x = mid - w / 2;
      x = Math.max(8, Math.min(x, vw - w - 8));
      if (top) {
        y = r.top - hh - 10;
        if (y < 8) y = r.bottom + 10;          /* 顶到视口上沿才翻到下方 */
        if (y + hh > vh - 8) y = Math.max(8, vh - hh - 8);
      } else {
        y = r.bottom + 8;
        if (y + hh > vh - 8) y = Math.max(8, r.top - hh - 8);
      }
    }
    el.style.left = x + 'px'; el.style.top = y + 'px';
  }
  if (document.addEventListener) {
    document.addEventListener('mouseover', function (e) {
      const a = e.target.closest ? e.target.closest('[data-tip]') : null;
      if (!a) return;
      const txt = a.getAttribute('data-tip') || '';
      if (!txt) return;
      const el = tipBox();
      /* 首行当标题加粗、其余按行铺开（全部用 textContent 写入，天然防注入） */
      const parts = txt.split('\n');
      el.textContent = '';
      if (parts.length > 1) {
        const b = document.createElement('b');
        b.className = 'wb-tip-t';
        b.textContent = parts[0];
        el.appendChild(b);
        const rest = document.createElement('span');
        rest.textContent = parts.slice(1).join('\n');
        el.appendChild(rest);
      } else {
        el.textContent = txt;
      }
      el.classList.add('on');
      /* 先归零再量尺寸，否则会用上一次的内容宽度算位置 */
      el.style.left = '0px'; el.style.top = '0px';
      TIP_SIZE = { w: el.offsetWidth, h: el.offsetHeight };
      TIP_ANCHOR = a;
      placeTip(a, e.clientX, e.clientY);
    });
    /* 跟随鼠标：data-tip-follow（堆叠条 / 卡片）与 data-tip-pos="top"（项目图标）都需要 */
    document.addEventListener('mousemove', function (e) {
      if (!TIP_ANCHOR) return;
      if (!TIP_ANCHOR.hasAttribute('data-tip-follow') && TIP_ANCHOR.getAttribute('data-tip-pos') !== 'top') return;
      placeTip(TIP_ANCHOR, e.clientX, e.clientY);
    });
    document.addEventListener('mouseout', function (e) {
      const a = e.target.closest ? e.target.closest('[data-tip]') : null;
      if (!a) return;
      const to = e.relatedTarget;
      if (to && a.contains(to)) return; /* 仍在同一胶囊内部移动 */
      hideTip();
    });
    /* 页面滚动 / 重新渲染后，浮层若还停在原位就会「飘」在无关内容上，直接收起 */
    window.addEventListener('scroll', hideTip, true);
  }

  /* ---------- 顶栏：平时完全透明，滚动后叠一层极淡毛玻璃保证文字可读 ---------- */
  (function topbarScrim() {
    const bar = document.querySelector ? document.querySelector('.topbar') : null;
    if (!bar) return;
    let last = null;
    const sync = function () {
      const on = (window.scrollY || window.pageYOffset || 0) > 4;
      if (on === last) return;
      last = on;
      bar.classList.toggle('scrolled', on);
    };
    window.addEventListener('scroll', sync, { passive: true });
    sync();
  })();

  /* ---------- 轻提示（复制成功等） ---------- */
  let TOAST_TIMER = 0;
  function toast(msg) {
    let el = document.getElementById('wbToast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'wbToast';
      el.className = 'wb-toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.remove('on');
    /* 强制重排后再加类，保证同一个 toast 连续点击也有入场动画 */
    void el.offsetWidth;
    el.classList.add('on');
    clearTimeout(TOAST_TIMER);
    TOAST_TIMER = setTimeout(function () { el.classList.remove('on'); }, 1600);
  }
  /* 复制文本：优先 Clipboard API（需要 https / localhost），失败时退回 execCommand */
  function copyText(txt) {
    const done = function () { toast(t('ui.copied')); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(done, function () { legacyCopy(txt) ? done() : toast(t('ui.copyFail')); });
      return;
    }
    legacyCopy(txt) ? done() : toast(t('ui.copyFail'));
  }
  function legacyCopy(txt) {
    try {
      const ta = document.createElement('textarea');
      ta.value = txt;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand && document.execCommand('copy');
      document.body.removeChild(ta);
      return !!ok;
    } catch (e) { return false; }
  }

  document.getElementById('themeBtn').addEventListener('click', toggleTheme);
  document.getElementById('langBtn').addEventListener('click', toggleLang);
  /* 「自定义设置」面板已按用户 2026-11-04 要求整块删除（右上角 ⚙ 与 #settingsModal）：
     主题强调色 / 模块配色 / 柱宽 / 动画倍速四项随之退役，配色统一走参数设置页的
     Params.applyColors()，其余回到 css 里的默认值。 */
  document.getElementById('navToggle').addEventListener('click', function () {
    const open = navEl.classList.toggle('open');
    this.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  navEl.addEventListener('click', function () { navEl.classList.remove('open'); });

  window.addEventListener('hashchange', function () {
    const r = parseHash();
    const route = r.seg[0] || 'home';
    if (route !== 'timeline') { state.tlPlaying = false; clearInterval(tlTimer); if (tlRaf) { cancelAnimationFrame(tlRaf); tlRaf = 0; } }
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
    } else if (window.__DEMO) {
      // 用户显式要求的演示模式：保留「演示数据」横幅
      if (banner) banner.style.display = '';
    } else {
      // 真实数据加载失败：明确报错，绝不静默显示虚构样本
      if (banner) {
        banner.style.display = '';
        banner.textContent = '⚠ 真实 WCA 数据加载失败，请刷新页面或检查网络。本站不使用虚构样本。';
      }
    }
  }

  /* ---------- 启动 ---------- */
  if (window.Params && window.Params.applyColors) window.Params.applyColors();
  initTheme();
  initLang();
  applyDataMode();
  if (!location.hash) location.hash = '#/home';
  const gh = document.getElementById('ghLink');
  if (gh) { gh.href = 'https://github.com/LeanSun/cuber-statistics'; }
  // 真实数据未能加载且非演示模式：显示明确错误页，避免白屏 / 避免误显示虚构数据
  if (!window.__REAL_OK && !window.__DEMO) {
    const appEl = document.getElementById('app');
    if (appEl) appEl.innerHTML = '<div style="max-width:680px;margin:72px auto;padding:24px;'
      + 'font:15px/1.7 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#c0392b">'
      + '<h2>⚠ 真实 WCA 数据加载失败</h2>'
      + '<p>本站的真实成绩数据文件 <code>js/data.js</code>（约数十 MB）未能加载完成，通常是网络不稳定或连接过慢导致。</p>'
      + '<p style="color:#555">请检查网络后<strong>刷新页面</strong>重试。本站坚持使用真实 WCA 数据、不使用虚构样本；'
      + '如需预览演示版，可在网址后加 <code>?demo=1</code>。</p></div>';
    return;
  }
  /* 暴露重渲染入口：单次/平均的逐项目精确档是懒加载的（pages-core 的 ensureSixEv），
     数据到位后需要在不改路由状态的前提下重画当前页。 */
  window.GOAT = window.GOAT || {};
  window.GOAT.render = render;
  render();
})();

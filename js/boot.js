/* ============================================================
   boot.js — 非阻塞启动器
   ------------------------------------------------------------
   以前 index.html 把 65MB 的 data.js 放在一串同步 <script> 中间：
   HTML 解析在那里停住，主内容只剩一个转圈，直到整包下载 + 解析完。

   现在：
   ① 首屏骨架由 index.html 静态渲染，浏览器立刻可见；
   ② 首次访问用 fetch 流式取数据，实时显示已接收字节；
   ③ 数据就绪后再按序挂载页面模块与 app.js（app.js 的 IIFE 立即
      执行 render()，骨架被替换）；
   ④ 体积最大的「选手明细层」由 data_detail.js 后台补入，不阻塞首屏；
   ⑤ Service Worker 让二次访问直接命中本地缓存。

   2026-11-12 启动加速（解决「每次都提示首次下载、等待过久」）：
   ⑥ registerSW() 移到 boot 一开始就执行，并且首次取数时**主动写入
      Cache Storage**。以前只在 afterData() 之后注册，首次访问的数据请求
      根本没被 SW 接管，缓存里始终没有 30MB 主包 → 第二次访问依旧是冷启动。
   ⑦ 回访命中数据缓存时改用 <script src> 加载：走 SW/HTTP 缓存与 V8
      编译缓存，省掉 fetch → Uint8Array → TextDecoder → inline script 的
      三次 30MB 内存拷贝与一次完整重编译；骨架也收成一行提示，不再出现
      「首次访问需下载完整成绩数据」。
   ⑧ 5 个页面模块用 <link rel=preload> 与数据下载并行预热，数据一到即可
      按序执行，不再串行等 5 个 RTT。
  ⑨ sw.js 命中后的后台刷新改为 HEAD 轻量校验，不再每次回访后台重下几十 MB。
  ⑩ 2026-11-12 首屏最小集：ETL 把只有次级页面才读的 10 列（sy / evRk /
     原始统计计数等）拆到 js/data_cols.js，core 主包瘦身约 1/4。boot 在页面
     模块加载的同时并行取回，按 id 原地合并进 M.ranked，到位后重绘一次。
     core 已给这些列预置合法默认值，分片缺失 / 加载失败都只降级、不崩。
  旧格式的 data.js（没有 __WCA_DETAIL_PENDING / __WCA_COLS_PENDING）
  依然可用，便于回滚：无标志就完全不走新路径。
   ============================================================ */
(function () {
  'use strict';
  if (window.__WCA_BOOTED) return;
  window.__WCA_BOOTED = true;

  var BASE = (function () {
    var b = document.getElementsByTagName('base')[0];
    return b ? (b.getAttribute('href') || './') : './';
  })();
  var $ = function (id) { return document.getElementById(id); };
  var panelEl = $('bootPanel'), noteEl = $('bootNote');
  var msgEl = $('bootMsg'), fillEl = $('bootFill'), trackEl = $('bootTrack');
  var pctEl = $('bootPct'), sizeEl = $('bootSize'), retryEl = $('bootRetry');

  /* 与 sw.js 的 DATA_VER 保持一致：主动写缓存时复用同一个 Cache Storage */
  var DATA_CACHE = 'goat-data-v1';
  var DATA_URL = BASE + 'js/data.js';

  /* 骨架比 app.js 更早出现，语言必须提前设好；判定口径与 app.js initLang 一致 */
  (function () {
    try {
      var lg = 'zh';
      try { lg = localStorage.getItem('goat-lang') || 'zh'; } catch (e) { }
      if (window.I18N && window.I18N.set) window.I18N.set(lg);
    } catch (e) { }
  })();
  var T = window.I18N || function (k) { return k; };

  function setBusy(on) {
    if (trackEl) trackEl.className = 'boot-track' + (on ? ' busy' : '');
  }
  function say(text) { if (msgEl) msgEl.textContent = text; }
  function setNote(text) {
    if (!noteEl) return;
    noteEl.textContent = text || '';
    noteEl.hidden = !text;
  }
  /* 回访时把大进度卡收成一行小字：数据已在本地，没必要再展示下载进度 */
  function setWarm(on) {
    if (panelEl) panelEl.className = 'boot-panel' + (on ? ' boot-warm' : '');
  }
  function setPct(p) {
    if (pctEl) pctEl.textContent = p == null ? '—' : (p + '%');
    if (trackEl) trackEl.setAttribute('aria-valuenow', String(p == null ? 0 : p));
    if (fillEl && p != null) fillEl.style.width = p + '%';
  }
  function setBytes(n) {
    if (sizeEl) sizeEl.textContent = (n / 1048576).toFixed(1) + T('boot.mb');
  }
  function fail(text) {
    setWarm(false); setBusy(false); setPct(0); say(text); setNote('');
    if (retryEl) { retryEl.hidden = false; retryEl.onclick = function () { location.reload(); }; }
  }
  function done() { setBusy(false); setPct(100); say(T('boot.ready')); }

  /* ---------- 数据缓存：只探测元数据，不读取 30MB body ---------- */
  function hasCachedData() {
    if (typeof caches === 'undefined' || typeof Request === 'undefined') return Promise.resolve(false);
    try {
      return caches.open(DATA_CACHE).then(function (c) {
        return c.match(new Request(DATA_URL)).then(function (r) { return !!r; });
      }).catch(function () { return false; });
    } catch (e) { return Promise.resolve(false); }
  }
  /* 首次取数时主动写缓存：SW 首次注册往往赶不上这一次请求，不能只靠 SW 拦截 */
  function putCache(url, resp) {
    if (typeof caches === 'undefined' || !resp) return;
    try {
      caches.open(DATA_CACHE)
        .then(function (c) { return c.put(new Request(url), resp); })
        .catch(function () { });
    } catch (e) { }
  }

  /* 国旗 CSS 与图表库都不该挡住首屏：取数开始时异步插入 */
  function injectCSS(href) {
    var l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = BASE + href;
    document.head.appendChild(l);
  }

  /* 流式 fetch：进度按「已接收的解压字节」显示，不用会被 gzip 差量骗到的百分比。
     cacheResponse=true 时克隆一份 Response 交给 Cache Storage 消费（clone 必须在读 body 前）。
     pre = index.html 里提前发出的 fetch Promise；命中就省掉整个往返，失败则自己重取。 */
  function fetchText(url, onChunk, cacheResponse, pre) {
    var ready = pre ? pre.catch(function () { return null; }) : Promise.resolve(null);
    return ready.then(function (first) {
      if (first && first.ok) return first;
      return fetch(url, { credentials: 'same-origin' }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r;
      });
    }).then(function (r) {
      if (cacheResponse) putCache(url, r.clone());
      if (!r.body || !r.body.getReader || typeof TextDecoder === 'undefined') return r.text();
      var reader = r.body.getReader(), chunks = [], total = 0;
      function pump(res, rej) {
        reader.read().then(function (x) {
          if (x.done) {
            var out = new Uint8Array(total), off = 0;
            for (var i = 0; i < chunks.length; i++) { out.set(chunks[i], off); off += chunks[i].length; }
            res(new TextDecoder('utf-8').decode(out));
            return;
          }
          chunks.push(x.value); total += x.value.length;
          if (onChunk) onChunk(total);
          pump(res, rej);
        }).catch(rej);
      }
      return new Promise(function (res, rej) { pump(res, rej); });
    });
  }

  /* 用真实 <script> 节点执行生成的数据包，保持与 src= 完全相同的全局作用域 */
  function execJS(text, label) {
    var s = document.createElement('script');
    s.setAttribute('data-wca', label || 'data');
    s.textContent = text;
    document.head.appendChild(s);
    s.parentNode.removeChild(s);
  }

  function loadScript(src, opts) {
    opts = opts || {};
    return new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = BASE + src; s.async = false;
      if (opts.integrity) { s.integrity = opts.integrity; s.crossOrigin = 'anonymous'; }
      s.onload = function () { res(); };
      s.onerror = function () { rej(new Error('load failed: ' + src)); };
      document.head.appendChild(s);
    });
  }

  function loadChain(list) {
    return list.reduce(function (p, name) {
      return p.then(function () { return loadScript('js/' + name); });
    }, Promise.resolve());
  }

  /* 页面模块全部独立（各自 `window.P || (window.P = {})` 守卫），只有 app.js 必须在最后
     —— 它启动时要读 window.P。以前串行链要 5 个来回，现在 4 个并行 + app 收尾。 */
  function loadModules(list) {
    var head = list.slice(0, list.length - 1), tail = list[list.length - 1];
    return Promise.all(head.map(function (name) { return loadScript('js/' + name); }))
      .then(function () { return loadScript('js/' + tail); });
  }

  /* 空闲执行：requestIdleCallback 优先，max 毫秒兜底（Safari 无 rIC） */
  function whenIdle(fn, max) {
    var fired = false;
    function run() { if (fired) return; fired = true; fn(); }
    if (typeof requestIdleCallback === 'function') {
      var h = setTimeout(run, max);
      requestIdleCallback(function () { clearTimeout(h); run(); }, { timeout: max });
    } else {
      setTimeout(run, Math.min(max, 1200));
    }
  }

  /* 页面模块与 30MB 数据并行预热，避免数据就绪后再串行等 5 个 RTT。
     URL 与 loadScript 完全一致，后续 <script src> 会直接命中 preload 缓存。 */
  function preloadModules() {
    if (location.protocol === 'file:') return;
    ['pages-core.js', 'pages-player.js', 'pages-extra.js', 'pages-sixdim.js', 'app.js']
      .forEach(function (name) {
        var l = document.createElement('link');
        l.rel = 'preload'; l.as = 'script'; l.href = BASE + 'js/' + name;
        document.head.appendChild(l);
      });
  }

  /* ---------- 列增量分片：首屏最小集 → 后台补齐次级页面专用列 ---------- */
  function attachCols(D) {
    var M = window.MOCK;
    if (!M || !M.ranked || !D || !D.keys || !D.rows) return;
    var byId = Object.create(null);
    M.ranked.forEach(function (p) { byId[p.id] = p; });
    var keys = D.keys;
    D.rows.forEach(function (r) {
      var p = byId[r[0]];
      if (!p) return;
      for (var i = 0; i < keys.length; i++) p[keys[i]] = r[i + 1];
    });
    window.__WCA_COLS_READY = true;
    document.body.classList.add('cols-ready');
    /* 首屏可能已经画完：补入的列只影响次级页面，重绘一次让它们立刻生效。
       render(true) 保留滚动位置，避免用户在读榜单时被打断。 */
    if (window.GOAT && window.GOAT.render) { try { window.GOAT.render(true); } catch (e) { } }
  }

  function loadCols() {
    /* 旧格式 core 没有这个标志：完全跳过，功能本来就是完整的 */
    if (!window.__WCA_COLS_PENDING) return Promise.resolve();
    var url = BASE + 'js/data_cols.js';
    var get = location.protocol === 'file:'
      ? loadScript('js/data_cols.js').then(function () { return window.WCA_COLS; })
      : fetchText(url, null, true).then(function (txt) {
        execJS(txt, 'cols');
        return window.WCA_COLS;
      });
    return get.then(function (D) {
      if (D) attachCols(D);
      window.WCA_COLS = null;   /* 释放这一份数组引用 */
      window.__WCA_COLS_PENDING = false;
    }).catch(function () { /* 列增量缺失：core 已预置默认值，页面不崩，静默降级 */ });
  }

  /* ---------- 明细分片：core 先让全站可浏览，detail 后台补齐 ---------- */
  function attachDetail(list) {
    var M = window.MOCK;
    if (!M || !M.ranked || !list || !list.length) return;
    var byId = Object.create(null);
    M.ranked.forEach(function (p) { byId[p.id] = p; });
    list.forEach(function (d) {
      var p = byId[d.id];
      if (!p) return;
      Object.keys(d).forEach(function (k) { p[k] = d[k]; });
      /* 明细层选手在 core 里只是普通精简档，补入明细后恢复 !p.slim 语义 */
      delete p.slim;
    });
    window.__WCA_DETAIL_READY = true;
    document.body.classList.add('detail-ready');
    /* 页面可能已经渲染：把依赖纪录明细的列重画一次 */
    if (window.GOAT && window.GOAT.render) { try { window.GOAT.render(); } catch (e) { } }
  }
  window.GOAT = window.GOAT || {};
  window.GOAT.attachCols = attachCols;
  window.GOAT.attachDetail = attachDetail;

  /* ---------- 逐项目六维分片：默认榜用不到，按项目筛选时才需要 ---------- */
  function attachSixEv(D) {
    var M = window.MOCK;
    if (!M || !M.ranked || !D || !D.ids) return;
    var scale = D.scale || 1;
    var map = Object.create(null);
    for (var i = 0; i < D.ids.length; i++) map[D.ids[i]] = D.vals[i];
    for (var j = 0; j < M.ranked.length; j++) {
      var p = M.ranked[j], v = map[p.id];
      if (!v) continue;
      var se = {};
      String(v).split(';').forEach(function (seg) {
        var q = seg.indexOf(':');
        if (q < 0) return;
        se[seg.slice(0, q)] = seg.slice(q + 1).split(',').map(function (x) { return Number(x) / scale; });
      });
      p.sixEv = se;
    }
    window.__WCA_SIXEV_READY = true;
    if (window.P && window.P.markSixEv) { try { window.P.markSixEv(); } catch (e) { } }
    if (window.GOAT.render) { try { window.GOAT.render(true); } catch (e) { } }
  }
  window.GOAT.attachSixEv = attachSixEv;

  var sixevPromise = null;
  function loadSixEv() {
    if (!window.__WCA_SIXEV_PENDING) return Promise.resolve();
    if (window.__WCA_SIXEV_READY) return Promise.resolve();
    if (sixevPromise) return sixevPromise;
    var get = location.protocol === 'file:'
      ? loadScript('js/data_sixev.js').then(function () { return window.WCA_SIXEV; })
      : fetchText(BASE + 'js/data_sixev.js', null, true).then(function (txt) {
        execJS(txt, 'sixev');
        return window.WCA_SIXEV;
      });
    sixevPromise = get.then(function (D) { attachSixEv(D); }).catch(function () {
      /* 分片缺失：项目筛选退回全站分近似，不影响其它页面 */
      window.__WCA_SIXEV_READY = false;
    });
    return sixevPromise;
  }
  window.GOAT.loadSixEv = loadSixEv;

  function loadDetail() {
    if (!window.__WCA_DETAIL_PENDING) return Promise.resolve();
    /* file:// 下 fetch 会被 CORS 拦住，改用普通 <script src> 读取本地分片 */
    var get = location.protocol === 'file:'
      ? loadScript('js/data_detail.js').then(function () { return window.WCA_DETAIL; })
      : fetchText(BASE + 'js/data_detail.js', null, true).then(function (txt) {
        execJS(txt, 'detail');
        return window.WCA_DETAIL;
      });
    return get.then(function (D) {
      if (D && D.length) attachDetail(D);
      window.WCA_DETAIL = null;   /* 释放这一份大数组引用 */
    }).catch(function () { /* 明细缺失不影响榜单主体，静默降级 */ });
  }

  /* ---------- MathJax：只在公式页按需加载，固定版本 + SRI ---------- */
  var MJ_URL = 'https://cdn.jsdelivr.net/npm/mathjax@3.2.2/es5/tex-mml-chtml.js';
  var MJ_SRI = 'sha384-Wuix6BuhrWbjDBs24bXrjf4ZQ5aFeFWBuKkFekO2t8xFU0iNaLQfp2K6/1Nxveei';
  var mjInjected = false;
  function routeNeedsMath() {
    var seg = (location.hash || '').replace(/^#\/?/, '').split(/[?#]/)[0].split('/')[0];
    return seg === 'model' || seg === 'player';
  }
  /* 选手页要 p.records / p.podiums，另类统计的纪录榜也读 p.records；
     其余页面用不到明细，等空闲再补。 */
  function routeNeedsDetail() {
    var seg = (location.hash || '').replace(/^#\/?/, '').split(/[?#]/)[0].split('/')[0];
    return seg === 'player' || seg === 'topics';
  }
  var detailAsked = false;
  function scheduleDetail() {
    if (detailAsked) return;
    detailAsked = true;
    if (routeNeedsDetail()) { loadDetail(); return; }
    /* 首屏稳定后 2.5 秒内必取；用户先跳去选手页则立刻取 */
    whenIdle(function () { loadDetail(); }, 2500);
    window.addEventListener('hashchange', function () {
      if (routeNeedsDetail()) loadDetail();
    });
  }
  function ensureMathJax() {
    /* 双击本地预览时完全离线：不注入外部 CDN，公式保持等宽文本降级 */
    if (mjInjected || location.protocol === 'file:' || !routeNeedsMath()) return;
    mjInjected = true;
    window.MathJax = {
      tex: { inlineMath: [['\\(', '\\)'], ['$', '$']], displayMath: [['\\[', '\\]'], ['$$', '$$']], processEscapes: true },
      options: { skipHtmlTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code'] },
      startup: { typeset: false }
    };
    var s = document.createElement('script');
    s.src = MJ_URL; s.integrity = MJ_SRI; s.crossOrigin = 'anonymous'; s.async = true;
    s.onload = function () {
      try {
        if (window.MathJax && window.MathJax.typesetPromise && window.MathJax.startup) {
          Promise.resolve(window.MathJax.startup.promise).then(function () {
            document.body.classList.remove('no-mjx');
            return window.MathJax.typesetPromise([document.getElementById('view') || document.body]);
          }).catch(function () { });
        }
      } catch (e) { }
    };
    s.onerror = function () { document.body.classList.add('no-mjx'); };
    document.head.appendChild(s);
  }

  /* ---------- Service Worker ---------- */
  var swRegistered = false;
  function registerSW() {
    if (swRegistered) return;
    swRegistered = true;
    if (location.protocol !== 'https:' && location.hostname !== 'localhost' &&
      location.hostname !== '127.0.0.1' && location.hostname !== '::1') return;
    /* manifest 动态挂载：静态写在 index.html 里会让 file:// 预览报 CORS 错误 */
    var mf = document.createElement('link');
    mf.rel = 'manifest'; mf.href = BASE + 'manifest.json';
    document.head.appendChild(mf);
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register(BASE + 'sw.js').catch(function () { });
  }

  /* ---------- 主流程 ---------- */
  function markReal() {
    var M = window.MOCK;
    window.__REAL_OK = !!(M && M.meta && M.meta.demo === false);
    if (!window.__REAL_OK && window.__DEMO) {
      return loadScript('js/mock.js').then(function () { window.__REAL_OK = true; });
    }
  }

  function afterData() {
    if (!window.__REAL_OK && !window.__DEMO) {
      throw new Error(T('boot.noReal'));
    }
    say(T('boot.init'));
    /* 首屏只等 core 主包。列增量 / 逐项目六维 / 明细三片全部退到首屏渲染之后：
       以前它们和 5 个页面模块抢同一条带宽，慢网下等于把首屏往后推 2~3 秒。 */
    return loadModules(['pages-core.js', 'pages-player.js', 'pages-extra.js', 'pages-sixdim.js', 'app.js'])
      .then(function () {
        setBusy(false); setPct(100);
        registerSW();
        ensureMathJax();
        window.addEventListener('hashchange', ensureMathJax);
        if (window.__WCA_DETAIL_READY && window.GOAT.render) {
          try { window.GOAT.render(); } catch (e) { }
        }
        /* 画面已经能用了，剩下的按优先级排队：列增量 → 逐项目六维 → 明细 */
        whenIdle(function () { loadCols(); }, 400);
        whenIdle(function () { loadSixEv(); }, 2200);
        scheduleDetail();
      });
  }

  function failText(e) {
    var en = !!(T.isEn && T.isEn());
    var err = (e && e.message ? e.message : T('boot.netErr'));
    return T('boot.fail') + (en ? ': ' : '：') + err +
      (en ? '. ' : '。') + T('boot.retryTip');
  }

  function boot() {
    if (retryEl) {
      retryEl.hidden = true; retryEl.onclick = null;
      retryEl.textContent = T('boot.retry');
    }
    setBusy(true); setPct(null);
    injectCSS('css/flags.css');
    window.__DEMO = /[?&]demo=1\b/.test(location.search);

    /* 这两件事与 30MB 数据下载并行：SW 越早注册越早接管，模块越早预热越省 RTT */
    registerSW();
    preloadModules();

    /* 双击 index.html 的 file:// 预览：fetch 不可用，退回 <script src>。
       失去字节进度，但站点功能完整 —— 这条路径以前就能用，不能因为改造而弄坏。 */
    if (location.protocol === 'file:') {
      say(T('boot.local'));
      setNote('');
      loadScript('js/data.js').then(markReal).then(afterData).catch(function (e) {
        fail(failText(e));
      });
      return;
    }

    hasCachedData().then(function (warm) {
      if (warm) {
        /* 快速路径：<script src> 命中 SW 缓存并复用 V8 编译缓存；
           不再把 30MB 文本搬进 JS 字符串、不再注入 inline script、不显示下载卡片 */
        setWarm(true); setBusy(false);
        say(T('boot.warm')); setNote('');
        return loadScript('js/data.js').then(markReal).then(afterData);
      }
      /* 首次路径：流式字节进度 + 主动写缓存，保证第二次访问就是 warm。
         index.html 已在 HTML 解析阶段先发了一手 fetch，这里直接复用（省掉整段等待）。 */
      say(T('boot.fetching'));
      setNote(T('boot.firstNote'));
      return fetchText(DATA_URL, function (n) {
        setBytes(n);
        if (pctEl) pctEl.textContent = T('boot.loading');
      }, true, window.__DATA_PRE).then(function (txt) {
        done();
        execJS(txt, 'core');
        return markReal();
      }).then(afterData);
    }).catch(function (e) {
      fail(failText(e));
    });
  }

  boot();
})();

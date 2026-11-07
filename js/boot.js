/* ============================================================
   boot.js — 非阻塞启动器
   ------------------------------------------------------------
   以前 index.html 把 65MB 的 data.js 放在一串同步 <script> 中间：
   HTML 解析在那里停住，主内容只剩一个转圈，直到整包下载 + 解析完。

   现在：
   ① 首屏骨架由 index.html 静态渲染，浏览器立刻可见；
   ② 这里用 fetch 流式取数据，实时显示已接收字节；
   ③ 数据就绪后再按序挂载页面模块与 app.js（app.js 的 IIFE 立即
      执行 render()，骨架被替换）；
   ④ 体积最大的「选手明细层」由 data_detail.js 后台补入，不阻塞首屏；
   ⑤ Service Worker 让二次访问直接命中本地缓存。
   旧格式的 data.js（没有 __WCA_DETAIL_PENDING）依然可用，便于回滚。
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
  var msgEl = $('bootMsg'), fillEl = $('bootFill'), trackEl = $('bootTrack');
  var pctEl = $('bootPct'), sizeEl = $('bootSize'), retryEl = $('bootRetry');

  function setBusy(on) {
    if (trackEl) trackEl.className = 'boot-track' + (on ? ' busy' : '');
  }
  function say(text) { if (msgEl) msgEl.textContent = text; }
  function setPct(p) {
    if (pctEl) pctEl.textContent = p == null ? '—' : (p + '%');
    if (trackEl) trackEl.setAttribute('aria-valuenow', String(p == null ? 0 : p));
    if (fillEl && p != null) fillEl.style.width = p + '%';
  }
  function setBytes(n) {
    if (sizeEl) sizeEl.textContent = (n / 1048576).toFixed(1) + ' MB 已接收';
  }
  function fail(text) {
    setBusy(false); setPct(0); say(text);
    if (retryEl) { retryEl.hidden = false; retryEl.onclick = function () { location.reload(); }; }
  }
  function done() { setBusy(false); setPct(100); say('数据就绪，正在构建页面…'); }

  /* 国旗 CSS 与图表库都不该挡住首屏：取数开始时异步插入 */
  function injectCSS(href) {
    var l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = BASE + href;
    document.head.appendChild(l);
  }

  /* 流式 fetch：进度按「已接收的解压字节」显示，不用会被 gzip 差量骗到的百分比 */
  function fetchText(url, onChunk) {
    return fetch(url, { credentials: 'same-origin' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
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
      s.onerror = function () { rej(new Error('无法加载 ' + src)); };
      document.head.appendChild(s);
    });
  }

  function loadChain(list) {
    return list.reduce(function (p, name) {
      return p.then(function () { return loadScript('js/' + name); });
    }, Promise.resolve());
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
  window.GOAT.attachDetail = attachDetail;

  function loadDetail() {
    if (!window.__WCA_DETAIL_PENDING) return Promise.resolve();
    /* file:// 下 fetch 会被 CORS 拦住，改用普通 <script src> 读取本地分片 */
    var get = location.protocol === 'file:'
      ? loadScript('js/data_detail.js').then(function () { return window.WCA_DETAIL; })
      : fetchText(BASE + 'js/data_detail.js').then(function (txt) {
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
  function registerSW() {
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
      throw new Error('真实 WCA 数据未能加载');
    }
    say('正在初始化界面…');
    return loadChain(['pages-core.js', 'pages-player.js', 'pages-extra.js', 'pages-sixdim.js', 'app.js'])
      .then(function () {
        setBusy(false); setPct(100);
        registerSW();
        ensureMathJax();
        window.addEventListener('hashchange', ensureMathJax);
        if (window.__WCA_DETAIL_READY && window.GOAT.render) {
          try { window.GOAT.render(); } catch (e) { }
        }
        /* 明细层不阻塞任何交互：后台取回后原地合并并重绘 */
        loadDetail();
      });
  }

  function boot() {
    if (retryEl) { retryEl.hidden = true; retryEl.onclick = null; }
    setBusy(true); setPct(null);
    injectCSS('css/flags.css');
    window.__DEMO = /[?&]demo=1\b/.test(location.search);

    /* 双击 index.html 的 file:// 预览：fetch 不可用，退回 <script src>。
       失去字节进度，但站点功能完整 —— 这条路径以前就能用，不能因为改造而弄坏。 */
    if (location.protocol === 'file:') {
      say('正在加载本地 WCA 成绩数据…');
      loadScript('js/data.js').then(markReal).then(afterData).catch(function (e) {
        fail('数据加载失败：' + (e && e.message ? e.message : '本地文件不可读') + '。');
      });
      return;
    }

    say('正在获取 WCA 成绩数据…');
    fetchText(BASE + 'js/data.js', function (n) {
      setBytes(n);
      if (pctEl) pctEl.textContent = '加载中…';
    }).then(function (txt) {
      done();
      execJS(txt, 'core');
      return markReal();
    }).then(afterData).catch(function (e) {
      fail('数据加载失败：' + (e && e.message ? e.message : '网络错误') + '。请检查网络后重试。');
    });
  }

  boot();
})();

/* ============================================================
   sw.js — Cube GOAT 离线 / 二次访问加速
   ------------------------------------------------------------
   两套缓存分开管理：
   · SHELL_VER：代码壳（HTML/CSS/小 JS）。network-first，保证发布后用户
     立刻拿到新代码；断网时回退缓存，导航请求回退首页。
   · DATA_VER：巨型数据文件（data.js / data_detail.js / roster.js /
     sixdim_data.js）。stale-while-revalidate —— 先秒开本地副本，再在后台
     静默更新，避免每次回访都重下十几 MB。
   修改前端代码时请 bump SHELL_VER；数据每周由 CI 更新，无需改版本号。
   ============================================================ */
const SHELL_VER = 'goat-shell-20261107a';
const DATA_VER = 'goat-data-v1';
const SHELL = [
  './', './index.html', './404.html', './manifest.json', './favicon.svg', './favicon.ico',
  './css/style.css', './css/flags.css',
  './vendor/cubing-icons.css', './vendor/cubing-icons.woff2', './vendor/echarts.min.js',
  './js/i18n.js', './js/boot.js', './js/calc.js', './js/params.js', './js/groups.js',
  './js/country-table.js', './js/icons.js', './js/top10years.js', './js/charts.js',
  './js/pages-core.js', './js/pages-player.js', './js/pages-extra.js',
  './js/pages-sixdim.js', './js/app.js', './js/mock.js'
];
const DATA_RE = /\/(data|data_detail|roster|sixdim_data)\.js$/;

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(SHELL_VER).then(function (c) {
      /* 单个资源 404 不应让整个 SW 装不上（例如 favicon.ico 尚未生成） */
      return Promise.allSettled(SHELL.map(function (u) { return c.add(u); }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) {
        return k.indexOf('goat-shell-') === 0 && k !== SHELL_VER;
      }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

async function networkFirst(req) {
  const cache = await caches.open(SHELL_VER);
  try {
    const r = await fetch(req);
    if (r && r.ok) cache.put(req, r.clone()).catch(function () { });
    return r;
  } catch (err) {
    const hit = await cache.match(req);
    if (hit) return hit;
    if (req.mode === 'navigate') {
      const idx = await cache.match('./index.html');
      if (idx) return idx;
    }
    return new Response('Offline', { status: 503, statusText: 'Offline' });
  }
}

async function staleWhileRevalidate(req, e) {
  const cache = await caches.open(DATA_VER);
  const hit = await cache.match(req);
  const net = fetch(req).then(function (r) {
    if (r && r.ok) cache.put(req, r.clone()).catch(function () { });
    return r;
  }).catch(function () { return null; });
  /* 后台刷新要挂在事件上，否则 SW 可能在处理完响应后被回收 */
  if (e && e.waitUntil) e.waitUntil(net.then(function () { }));
  if (hit) return hit;
  const r = await net;
  return r || new Response('Offline', { status: 503, statusText: 'Offline' });
}

self.addEventListener('fetch', function (e) {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   /* CDN / WCA 外链不拦截 */
  if (DATA_RE.test(url.pathname)) {
    e.respondWith(staleWhileRevalidate(req, e));
  } else {
    e.respondWith(networkFirst(req));
  }
});

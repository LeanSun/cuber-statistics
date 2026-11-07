#!/usr/bin/env node
/* ============================================================
   etl/check_static.js — 静态站点体检（CI 里跑，不依赖浏览器 / 不依赖数据）
   ------------------------------------------------------------
   检查项：
     ① 中英文案键完全对齐（历史上多次出现「中文删了英文留着」）
     ② 代码壳体积预算（首屏不该被巨型资源拖住）
     ③ 所有数据表头有 scope="col"
     ④ 入口 HTML 没有同步加载巨型数据 / 外链固定版本 + SRI
     ⑤ SEO 产物齐备且每张静态页都有 canonical
   任何一项失败都以非零码退出，让 CI 直接拦住回归。
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const exists = (f) => fs.existsSync(path.join(ROOT, f));
let bad = 0;
function check(cond, label, extra) {
  if (cond) { console.log('  ok   ' + label + (extra ? ' (' + extra + ')' : '')); }
  else { console.error('  FAIL ' + label + (extra ? ' (' + extra + ')' : '')); bad++; }
}

/* ① i18n 键对齐 */
const lang = read('js/i18n.js');
const iZ = lang.indexOf('const ZH = {'), iE = lang.indexOf('const EN = {'), iX = lang.indexOf('window.I18N');
const keysOf = (s) => new Set((s.match(/'([A-Za-z0-9_.\-]+)'\s*:/g) || [])
  .map((x) => x.split("'")[1]));
const zh = keysOf(lang.slice(iZ, iE)), en = keysOf(lang.slice(iE, iX));
const miss = [].concat([...zh].filter((k) => !en.has(k)), [...en].filter((k) => !zh.has(k)));
check(!miss.length, '中英文案键对齐', zh.size + ' / ' + en.size + (miss.length ? ' 差异: ' + miss.join(',') : ''));

/* ② 首屏代码壳预算：不含 data/roster/sixdim_data/flags（后三者已改为按需/延后） */
const shell = ['index.html', 'css/style.css', 'vendor/cubing-icons.css', 'vendor/echarts.min.js',
  'js/i18n.js', 'js/boot.js', 'js/calc.js', 'js/params.js', 'js/groups.js', 'js/country-table.js',
  'js/icons.js', 'js/top10years.js', 'js/charts.js', 'js/pages-core.js', 'js/pages-player.js',
  'js/pages-extra.js', 'js/pages-sixdim.js', 'js/app.js'];
const bytes = shell.reduce((a, f) => a + (exists(f) ? fs.statSync(path.join(ROOT, f)).size : 0), 0);
const BUDGET = 2.5 * 1024 * 1024;
check(bytes > 0 && bytes < BUDGET, '代码壳体积预算',
  (bytes / 1048576).toFixed(2) + ' MB / ' + (BUDGET / 1048576).toFixed(1) + ' MB');

/* ③ 数据表头语义 */
const tableSrc = ['js/pages-core.js', 'js/pages-extra.js', 'js/pages-sixdim.js'].map(read).join('');
const thAll = (tableSrc.match(/<th(?=[\s>])/g) || []).length;
const thScope = (tableSrc.match(/<th scope="col"/g) || []).length;
check(thAll > 0 && thAll === thScope, '表头 scope="col"', thScope + '/' + thAll);

/* ④ 加载链与第三方依赖 */
const html = read('index.html'), boot = read('js/boot.js');
check(!/<script src="js\/data\.js"/.test(html) && /js\/boot\.js" defer/.test(html),
  '入口不阻塞式加载巨型数据');
check(/mathjax@3\.2\.2/.test(boot) && /integrity/.test(boot) && /crossOrigin/.test(boot),
  'MathJax 固定版本 + SRI');
check(!/flagcdn\.com/.test(html), '无引用的 preconnect 已删除');
check(/<meta charset="utf-8">/.test(html) && /rel="canonical"/.test(html) && /<noscript>/.test(html),
  '入口 HTML 基础 meta / noscript');

/* ⑤ SEO 产物 */
const need = ['robots.txt', 'sitemap.xml', '404.html', 'manifest.json', 'sw.js',
  'favicon.svg', 'favicon.ico', 'seo/rank.html', 'seo/timeline.html',
  'seo/topics.html', 'seo/model.html'];
check(need.every(exists), 'SEO / PWA 产物齐备', need.length + ' 个文件');
check(['rank', 'timeline', 'topics', 'model'].every((s) =>
  /rel="canonical"/.test(read('seo/' + s + '.html'))), '静态页都有 canonical');
check(/top 20|前 20 名/i.test(read('seo/rank.html')), '静态榜单含真实前 20 名摘要');

console.log(bad ? '\n❌ 静态体检失败 ' + bad + ' 项' : '\n✅ 静态体检全部通过');
process.exit(bad ? 1 : 0);

/* 2026-10-27 临时校验：① 单/多项目竞速图随年份演化 ② 竞速图序号对齐且无 #
   ③ 展开行身份顺序（国旗→国名→性别→参赛时间）+ 表头无空柱状图。跑完即删。 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const store = {};
const localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
const document = {
  documentElement: { style: { setProperty() { } }, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; } },
  body: { appendChild() { } },
  createElement: () => ({ style: {}, setAttribute() { }, classList: { add() { } } }),
  getElementById: () => null, querySelectorAll: () => [], addEventListener() { }
};
const win = { localStorage, document, getComputedStyle: () => ({ backgroundImage: '' }), navigator: { language: 'zh-CN' }, location: { hash: '#/rank' }, addEventListener() { }, setTimeout, clearTimeout, setInterval, clearInterval };
win.window = win;
global.window = win; global.document = document; global.localStorage = localStorage;
global.getComputedStyle = win.getComputedStyle; global.navigator = win.navigator;
const ROOT = path.resolve(__dirname, '..');
function load(f) { vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f }); }
['js/country-table.js', 'js/i18n.js', 'js/groups.js', 'js/params.js', 'js/calc.js'].forEach(load);
global.Calc = win.Calc; global.U = win.U; global.Params = win.Params; global.I18N = win.I18N;
[process.env.SMOKE_DATA || 'js/data.js', 'js/icons.js', 'js/charts.js', 'js/pages-core.js', 'js/pages-player.js', 'js/pages-extra.js'].forEach(load);
const M = win.MOCK, P = win.P;
let fail = 0;
function ok(c, m) { if (!c) { console.error('FAIL:', m); fail++; } else console.log('  ok  ', m); }

console.log('== ① 单 / 多项目竞速图是否随时间演化 ==');
{
  const years = [2005, 2010, 2015, 2020, 2025];
  [['单项目 333', ['333']], ['多项目 333+222', ['333', '222']], ['全项目', []]].forEach(function (cse) {
    const evs = cse[1];
    const seq = years.map(function (y) { return P.tlSnapshot(evs, y, 'all', 'all', ''); });
    /* 榜首分数序列 + 上榜人数序列：任一随时间变化即说明「会动」 */
    const tops = seq.map((s) => (s.length ? Math.round(s[0].value * 100) / 100 : 0));
    const cnts = seq.map((s) => s.length);
    const moving = tops.some((v, i) => i > 0 && Math.abs(v - tops[i - 1]) > 0.05);
    const grew = cnts[cnts.length - 1] >= cnts[0];
    console.log('   ' + cse[0] + ' → 榜首分 ' + tops.join(' / ') + '；人数 ' + cnts.join(' / '));
    ok(moving, cse[0] + ' 随年份推进分数有变化（播放会动）');
    ok(grew, cse[0] + ' 上榜人数随年份不减');
    /* 抽查一个人：早年的分必须 ≤ 晚年的分（进度单调） */
    if (seq[4].length) {
      const nm = seq[4][0].name;
      const vals = seq.map((s) => { const r = s.find((x) => x.name === nm); return r ? r.value : null; });
      const mono = vals.every((v, i) => i === 0 || v == null || vals[i - 1] == null || v + 1e-6 >= vals[i - 1]);
      ok(mono, cse[0] + ' · ' + nm + ' 分数随年份单调不减: ' + vals.map((v) => (v == null ? '-' : v.toFixed(1))).join(' → '));
    }
  });
}

console.log('== ② 竞速图序号：对齐 + 无 # ==');
{
  const opt = win.Charts.barRace([
    { id: 'a', name: 'A', iso: 'CN', flag: '', color: '#c00', value: 10, rank: 1, no: 1 },
    { id: 'b', name: 'B', iso: 'US', flag: '', color: '#00c', value: 8, rank: 2, no: 2 },
    { id: 'c', name: 'C', iso: 'JP', flag: '', color: '#0c0', value: 6, rank: 3, no: 3 }
  ], { top: 3 });
  const y = opt.yAxis;
  ok(y.min === 1 && y.max === 3, 'Y 轴范围 = 1..n（刻度落在整数名次上，与条形同一条水平线）: ' + y.min + '..' + y.max);
  const labels = [1, 2, 3].map((v) => y.axisLabel.formatter(v));
  ok(labels.join(',') === '1,2,3', '序号渲染为 1,2,3（无 #）: ' + labels.join(','));
  ok(opt.grid.top >= 16 && opt.grid.bottom >= 16, '上下留白够（首末条不被裁）: top=' + opt.grid.top + ' bottom=' + opt.grid.bottom);
  /* renderItem 里不应再自画一份序号 */
  const src = fs.readFileSync(path.join(ROOT, 'js/charts.js'), 'utf8');
  const seg = src.slice(src.indexOf('function barRace'), src.indexOf('/* ---------- WR 泳道'));
  ok(!/text:\s*String\(d\.no/.test(seg), 'renderItem 不再自画第二份序号（避免两套坐标错位）');
}

console.log('== ③ 展开行：身份顺序 + 表头空柱 ==');
{
  const p = M.ranked.find((x) => x.six && !x.slim) || M.ranked[0];
  const h = P.expandBody(p, { recType: 'all', tab: 'career' });
  const meta = (h.match(/<div class="exp-v3-meta">([\s\S]*?)<\/div>/) || [])[1] || '';
  const iFlag = meta.indexOf('class="m-country"');
  const iFi = meta.indexOf('class="fi');
  const iCname = meta.indexOf('m-cname');
  const iGender = meta.indexOf('m-gender');
  const iYears = meta.indexOf('m-years');
  ok(iFlag >= 0 && iFi > iFlag && iCname > iFi, '国家胶囊内：国旗在国名之前');
  ok(iGender > iCname && iYears > iGender, '顺序为 国旗/国名 → 性别 → 参赛时间');
  ok(!/exp-v3-flag/.test(h), '姓名左侧的大国旗已移除');
  const head = (h.match(/<div class="exp-v3-mod exp-v3-mod-head">([\s\S]*?)<\/div>/) || [])[1] || '';
  ok(!/class="track"/.test(head), '六维贡献表头不再有空柱状图（track）');
  ok(/track-slot/.test(head), '表头保留无样式占位格（网格对齐不变）');
}

console.log('== ④ 六维贡献条：方案 A（相对最大归一） ==');
{
  const p = M.ranked.find((x) => x.six && !x.slim) || M.ranked[0];
  const h = P.expandBody(p, { recType: 'all', tab: 'career' });
  const rows = h.match(/<div class="exp-v3-mod">([\s\S]*?)<\/div>/g) || [];
  const widths = [];
  const pcts = [];
  rows.forEach(function (r) {
    const wm = r.match(/<i style="width:([\d.]+)%/);
    const pm = r.match(/class="pc">([\d.]+)%/);
    if (wm) widths.push(parseFloat(wm[1]));
    if (pm) pcts.push(parseFloat(pm[1]));
  });
  ok(widths.length === 6, '六维各有一条: ' + widths.length);
  ok(Math.abs(widths[0] - 100) < 0.05, '贡献最大的那条撑满轨道: ' + widths[0] + '%');
  const desc = widths.every((w, i) => i === 0 || w <= widths[i - 1] + 1e-6);
  ok(desc, '条长按贡献降序递减: ' + widths.join(' / '));
  const pctSum = pcts.reduce((a, b) => a + b, 0);
  ok(Math.abs(pctSum - 100) < 0.5, '右侧占比仍是真实百分比（合计≈100）: ' + pcts.join(' / '));
  ok(widths[5] < 100 && pcts[0] < 100, '条长与占比是两把尺（不混为一谈）');
}

console.log('== ⑤ 重绘间隔（fps）已接线 ==');
{
  const meta = P.tlRateMeta;
  ok(meta && meta.fps && meta.fps.min === 0, 'fps 下限为 0（0 = 逐帧）: ' + (meta && meta.fps && meta.fps.min));
  const src = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
  ok(/redrawGap/.test(src) && /nowMs - lastDrawMs >= redrawGap/.test(src), '播放循环按 fps 节流重绘');
  ok(/pos >= sl\.max/.test(src), '结尾强制画最后一帧（节流不吞最终名次）');
  ok(/fps: 100/.test(src), 'app.js 兜底默认值同步为 100ms');
}

console.log(fail ? ('\n❌ 失败 ' + fail + ' 项') : '\n✅ 全部通过');
process.exit(fail ? 1 : 0);

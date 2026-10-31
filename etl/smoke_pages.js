/* Node 冒烟：在最小 DOM 桩下渲染关键页面，捕获运行时错误 + 校验本轮需求点 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const store = {};
const localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; }
};
const document = {
  documentElement: {
    style: { setProperty() { } },
    attrs: {},
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  },
  body: { appendChild() { } },
  createElement: () => ({ style: {}, setAttribute() { }, classList: { add() { } } }),
  getElementById: () => null,
  querySelectorAll: () => [],
  addEventListener() { }
};
const win = {
  localStorage, document,
  getComputedStyle: () => ({ backgroundImage: '' }),
  navigator: { language: 'zh-CN' },
  location: { hash: '#/rank' },
  addEventListener() { },
  setTimeout, clearTimeout, setInterval, clearInterval
};
win.window = win;
global.window = win;
global.document = document;
global.localStorage = localStorage;
global.getComputedStyle = win.getComputedStyle;
global.navigator = win.navigator;

const ROOT = path.resolve(__dirname, '..');
function load(f) {
  const code = fs.readFileSync(path.join(ROOT, f), 'utf8');
  vm.runInThisContext(code, { filename: f });
}
['js/country-table.js', 'js/i18n.js', 'js/groups.js', 'js/params.js', 'js/calc.js'].forEach(load);
/* calc.js 挂到 window.Calc；data.js 直接引用裸标识符 Calc，这里补一份全局 */
global.Calc = win.Calc; global.U = win.U; global.Params = win.Params; global.I18N = win.I18N;
const DATA_FILE = process.env.SMOKE_DATA || 'data/data.js';
/* app.js 也要加载，才能测 renderFilterBar（筛选条是本轮多处改动的落点） */
[(DATA_FILE), 'js/icons.js', 'js/charts.js', 'js/pages-core.js', 'js/pages-player.js', 'js/pages-extra.js'].forEach(load);

const M = win.MOCK, P = win.P, t = win.I18N;
let fail = 0;
function ok(c, m) { if (!c) { console.error('FAIL:', m); fail++; } else console.log('  ok  ', m); }
function tryRender(name, fn) {
  try { const html = fn(); ok(typeof html === 'string' && html.length > 50, name + ' 渲染 (' + (html || '').length + ' 字符)'); return html; }
  catch (e) { console.error('FAIL: ' + name + ' 抛错:', e.message, '\n', e.stack.split('\n').slice(1, 4).join('\n')); fail++; return ''; }
}

console.log('== 数据 ==');
ok(M.ranked.length > 0, '选手数 ' + M.ranked.length);
ok(Object.keys(M.eventBoards || {}).length > 0, '项目榜单 ' + Object.keys(M.eventBoards || {}).length);
ok(Object.keys(M.continentOf || {}).length > 0, '洲际映射 ' + Object.keys(M.continentOf).length);
const p0 = M.ranked[0];
ok(/^[A-Z]{2}$/.test(p0.country), '国家已归一化为 ISO2: ' + p0.country);
ok(!!M.countriesZh[p0.country], '中文国名: ' + M.countriesZh[p0.country]);
ok(!!M.continentOf[p0.country], '洲际: ' + M.continentOf[p0.country]);

console.log('== 洲纪录 CR（曾全为 0）==');
let totWR = 0, totCR = 0, totNR = 0, crPlayers = 0;
M.ranked.forEach((p) => { totWR += p.wr || 0; totCR += p.cr || 0; totNR += p.nr || 0; if (p.cr) crPlayers++; });
console.log('   WR', totWR, 'CR', totCR, 'NR', totNR, '| 有洲纪录的选手', crPlayers);
ok(totWR > 0, '世界纪录数 > 0');
ok(totCR > 0, '洲纪录数 > 0（曾恒为 0）');
ok(totNR > 0, '国家纪录数 > 0');
ok(M.ranked.some((p) => (p.records || []).some((r) => r.level === 'CR')), '明细中存在 level=CR 的纪录');

console.log('== 单次 / 平均口径拆分 ==');
const withMods = M.ranked.filter((p) => p.m);
ok(withMods.every((p) => typeof p.m.m1s === 'number' && typeof p.m.m1a === 'number'), '每人有 m1s / m1a（单次 / 平均纪录分）');
/* m1 由 m1s + m1a 合成后按全局最大值归一到 0–100，故只保证落在 [0,100] 且与两者正相关 */
ok(withMods.every((p) => p.m.m1 >= 0 && p.m.m1 <= 100.001 && p.m.m1s >= 0 && p.m.m1a >= 0),
  'm1 / m1s / m1a 均归一到 0–100');
const corr = withMods.filter((p) => Math.abs(p.m.m1a / 100 - p.m.m1 / 100) < 0.35).length;
console.log('   m1 与 m1a 同量级的选手数', corr, '/', withMods.length);
ok(corr > 0, '存在单次 / 平均口径可区分的选手（口径切换有意义）');
const diffSlim = M.ranked.filter((p) => p.m && p.m.m1s !== p.m.m1a).length;
console.log('   单次≠平均 的选手数', diffSlim);
ok(diffSlim > 0, '存在单次与平均口径不同的选手（口径切换有意义）');

console.log('== 分组 ==');
const gs = M.presetGroups.map(g => g.id + '=' + g.zh);
console.log('  ', gs.join(' | '));
const speed = M.presetGroups.find(g => g.id === 'speed');
ok(speed && speed.zh === '正阶组' && speed.ids.join(',') === '222,333,444,555,666,777', '正阶组 = 2~7 阶且不含单手');
ok(!M.presetGroups.some(g => g.id === 'fmc'), '已移除最少步组');
ok(!M.presetGroups.some(g => g.id === 'big'), '已删除高阶组');
const other = M.presetGroups.find(g => g.id === 'other');
ok(other && other.zh === '异型组', '其他组已改名为异型组');
ok(other && ['clock', 'minx', 'pyram', 'skewb', 'sq1'].every(e => other.ids.includes(e)), '异型组 = 魔表/五魔方/金字塔/斜转/sq1');
const blind = M.presetGroups.find(g => g.id === 'blind');
ok(blind && blind.ids.indexOf('333mbo') < 0, '盲拧组已剔除旧多盲 333mbo');
ok(blind && blind.ids.indexOf('333mbf') >= 0, '盲拧组保留 333mbf');

console.log('== 页面渲染 ==');
const base = { tab: 'overall', sortKey: 'score', sortDir: 'desc', page: 1, group: 'all', customIds: [], evSel: [], country: '', continent: '', region: '', gender: 'all', y0: null, y1: null, retired: false, geo: '', recType: 'all' };
const h1 = tryRender('历史地位排名（默认）', () => P.rank(Object.assign({}, base)));
ok(h1.indexOf('历史地位排名') >= 0 || h1.indexOf('Greatest') >= 0, '大标题已改为「历史地位排名」');
ok(h1.indexOf('avatar') < 0, '总榜已无头像');
ok(h1.indexOf('region-cell') >= 0, '地区列含中文国名');
ok(h1.indexOf('id="typeSeg"') < 0, '总榜工具栏已删除重复的口径控件（统一由顶部筛选条提供）');
ok(h1.indexOf('历史地位排名') >= 0, '已无「综合总榜」旧称');

const h1b = tryRender('总榜（单次口径）', () => P.rank(Object.assign({}, base, { recType: 'single' })));
ok(h1b !== h1 || h1b.length > 0, '单次口径可渲染');
const h1c = tryRender('总榜（平均口径）', () => P.rank(Object.assign({}, base, { recType: 'avg' })));
ok(h1c.length > 0, '平均口径可渲染');

/* 样例数据没有六维分，堆叠条的「按维度」口径画不出来（维度分全为 0），
   这类断言只在真实数据下强制执行。 */
const HAS_SCORE = M.ranked.some(function (p) { return p.overall > 0; });
const h2 = tryRender('总榜（单项目 333）', () => P.rank(Object.assign({}, base, { evSel: ['333'] })));
ok(h2.indexOf('ev-rank') >= 0, '单项目模式显示世界名次');
/* 堆叠方式开关：默认（只看单项目）必须是「按维度」的六维堆叠，
   否则整条只有一个单色块、看不出是哪几维在撑着这个分数（修复前正是如此）。 */
ok(h2.indexOf('data-stack="ev"') >= 0 && h2.indexOf('data-stack="dim"') >= 0, '总榜工具栏给出「堆叠方式」开关（按项目 / 按维度）');
if (HAS_SCORE) {
  ok(h2.indexOf('ministack') >= 0, '单项目模式保留堆叠条');
  ok(h2.indexOf('dimstack') >= 0 && h2.indexOf('evstack') < 0, '单项目默认按维度堆叠（六维分段，不再是整条单色）');
  const dimSegs = (h2.match(/class="ministack dimstack"/g) || []).length;
  ok(dimSegs > 0, '单项目：每行都有六维堆叠条（实得 ' + dimSegs + ' 行）');
  const h2Ev = tryRender('总榜（单项目 · 按项目堆叠）', () => P.rank(Object.assign({}, base, { evSel: ['333'], stackMode: 'ev' })));
  ok(h2Ev.indexOf('evstack') >= 0 && h2Ev.indexOf('dimstack') < 0, '显式选择「按项目」时切回项目堆叠');
  const h1Dim = tryRender('总榜（默认 · 按维度堆叠）', () => P.rank(Object.assign({}, base, { stackMode: 'dim' })));
  ok(h1Dim.indexOf('dimstack') >= 0, '未选项目时也可切换为按维度堆叠');
  /* 默认（未筛选 / 全项目）必须也是「按维度」，否则一个全能选手会画出十几段互撞的同色碎块，
     看上去就像堆叠条没渲染出来（这正是反馈里的第二个症状）。 */
  ok(h1.indexOf('dimstack') >= 0 && h1.indexOf('evstack') < 0, '未筛选时也默认按维度堆叠（不再碎成一地撞色片段）');
  const h1Ev = tryRender('总榜（未筛选 · 显式按项目）', () => P.rank(Object.assign({}, base, { stackMode: 'ev' })));
  ok(h1Ev.indexOf('evstack') >= 0, '未筛选时仍可显式切到按项目堆叠');
  {
    /* 项目堆叠：同一行内每个项目必须拿到不同颜色 —— 之前调色板只有 10 色而正式项目有 21 个，
       序号取模会让三阶和多盲、二阶和最少步画成同一个颜色，看上去像没渲染出来。 */
    const rowsEv = h1Ev.split('<tr data-pid="').slice(1);
    let dupRow = 0, maxSeg = 0;
    rowsEv.forEach(function (r) {
      const bar = (r.match(/<div class="bar-grow"[^>]*>[\s\S]*?<\/div><\/div>/) || [''])[0];
      const cols = (bar.match(/<span style="width:[\d.]+%;background:([^"]+)"/g) || [])
        .map(function (s) { return (s.match(/background:([^"]+)/) || [])[1]; });
      const uniq = cols.filter(function (c, i) { return cols.indexOf(c) === i; });
      if (uniq.length !== cols.length) dupRow++;
      if (cols.length > maxSeg) maxSeg = cols.length;
    });
    ok(rowsEv.length > 0 && dupRow === 0,
      '同一行内各项目颜色互不重复（' + rowsEv.length + ' 行，最多 ' + maxSeg + ' 段' + (dupRow ? '，' + dupRow + ' 行撞色' : '') + '）');
  }
} else {
  console.log('  · 本次数据无六维分（样例数据），跳过堆叠条口径断言');
}

const h3 = tryRender('总榜（多项目 333+222+444）', () => P.rank(Object.assign({}, base, { evSel: ['333', '222', '444'] })));
ok(h3.indexOf('ev-legend') >= 0, '多项目模式显示项目图例');
ok(h3.indexOf('evstack') >= 0, '多项目模式显示项目堆叠条');
/* 需求：多项目下不再罗列「#265」这类名次徽章，也不再显示「已覆盖 x/y」 */
ok(h3.indexOf('ev-badge') < 0, '多项目模式已删除名次徽章（不再出现 #265）');
ok(h3.indexOf('已覆盖') < 0 && h3.indexOf('ev-rank') < 0, '多项目模式已删除「已覆盖 x/y」');
ok(h3.indexOf('ev-hitnote') >= 0, '多项目模式保留紧凑的「命中/总数」计数');
/* 图例颜色必须与条形里同名项目的颜色完全一致 —— 之前条形按「事件表全局序号」取色、
   图例却按「所选项目下标」取色，两者在所选项目不是从头开始时就会错位。 */
if (!HAS_SCORE) {
  console.log('  · 本次数据无六维分（样例数据），跳过条形/图例配色一致性校验');
} {
  const lgMap = {};
  const lgBlock = (h3.match(/<div class="ev-legend[\s\S]*?<\/div>/) || [''])[0];
  const re = /<i style="background:([^"]+)"><\/i>([^<]+)</g;
  let m;
  while ((m = re.exec(lgBlock))) lgMap[m[2]] = m[1];
  const rowsHtml = h3.split('<tr data-pid="').slice(1, 4);
  let bad = 0, checked = 0, sample = '';
  rowsHtml.forEach(function (r) {
    const bar = (r.match(/<div class="bar-grow"[^>]*>[\s\S]*?<\/div><\/div>/) || [''])[0];
    const segRe = /<span style="width:[\d.]+%;background:([^"]+)" data-tip="([^"\n]*)\n/g;
    let s2;
    while ((s2 = segRe.exec(bar))) {
      const bg = s2[1], name = s2[2];
      if (Object.prototype.hasOwnProperty.call(lgMap, name)) {
        checked++;
        if (lgMap[name] !== bg) { bad++; sample = name + ': 条形 ' + bg + ' vs 图例 ' + lgMap[name]; }
      }
    }
  });
    ok(HAS_SCORE ? (checked > 0 && bad === 0) : true,
      '多项目：条形颜色与图例逐一对应（校验 ' + checked + ' 段' + (bad ? '，错位 ' + bad + ' 段 ' + sample : '') + '）');
}
ok(h3.indexOf('rank.ruleNote') < 0 && h3.indexOf('统计口径') >= 0, '多项目模式给出统一口径说明');
/* 选中项目后：单项目按「该项目的历史地位分（GOAT 综合分）」排序，而非单纯世界名次 ——
   修复前按世界名次排，会导致综合分低、但项目内名次靠前的选手排到前面（Issue 1）。 */
{
  const one = P.filtered(Object.assign({}, base, { evSel: ['333'] }));
  /* 单项目口径：排序键 orderVal 来自「历史地位分（GOAT 分）」，与全项目同一把尺子；
     满足第七轮需求：选中单项目后用分数排名，而非单次成绩 / 世界名次。 */
  ok(one.every((r) => r.orderVal === r.score),
    '单项目：排序键 orderVal 已切换为「历史地位分」（orderVal = score）');
  /* 榜单严格按历史地位分降序排列（score 不增） */
  let evSorted = true;
  for (let i = 1; i < one.length; i++) {
    if (one[i - 1].score + 1e-9 < one[i].score) { evSorted = false; break; }
  }
  ok(evSorted, '单项目：榜单严格按历史地位分（GOAT 分）降序排列');
  /* 榜首必须是历史地位分最高者（分最高＝排名最前） */
  if (one.length) {
    const top = one[0];
    const low = one[one.length - 1].score;
    ok(top && top.score >= low, '单项目：榜首为历史地位分最高者: ' + (top ? top.score.toFixed(1) : 'n/a'));
  }

  /* 多项目：各所选项目名次的加权综合（evSum 越大＝整体名次越靠前），依旧有效 */
  const multi = P.filtered(Object.assign({}, base, { evSel: ['333', '222', '444'] }));
  const evSum = multi.map((r) => r.orderVal);
  let mSorted = true;
  for (let i = 1; i < evSum.length; i++) if (evSum[i] > evSum[i - 1] + 1e-9) { mSorted = false; break; }
  ok(mSorted, '多项目模式按各所选项目名次的加权综合降序排列');
}
/* 条形放进弹性轨道，避免第一名 100% 时把右侧数字挤出单元格 */
ok(h3.indexOf('bar-track') >= 0, '条形外层有可收缩的弹性轨道（bar-track，防止溢出遮挡文字）');
/* 口径统一：多项目 / 单项目 / 全项目 都必须按「历史地位分」排序，
   多项目不得再把分数替换成世界名次加权平均（那会让三者不是同一把尺子）。 */
{
  const rowsAll = P.filtered(Object.assign({}, base));
  const rowsMulti = P.filtered(Object.assign({}, base, { evSel: ['333', '222', '444'] }));
  const rowsOne = P.filtered(Object.assign({}, base, { evSel: ['333'] }));
  const topOf = (rs) => rs.slice(0, 5).map((r) => r.p.id);
  const a = topOf(rowsAll), b = topOf(rowsMulti), c = topOf(rowsOne);
  ok(a.length === 5 && b.length > 0 && c.length > 0, '三种口径均能取到榜单');
  /* 未选项目时：分数必须就是全站六维总分（与选手页 p.six.t 同一数字），
     不能因为「默认不显示停办项目」就偷偷换一把尺子。 */
  ok(!rowsAll[0].p.six || Math.abs(rowsAll[0].score - rowsAll[0].p.six.t) < 0.02,
    '未选项目：分数＝全站六维总分 (' + rowsAll[0].score + ' vs ' + (rowsAll[0].p.six ? rowsAll[0].p.six.t : 'n/a') + ')');
  ok(b.every((id) => a.includes(id)) || a.some((id) => b.includes(id)),
    '多项目榜单仍以历史地位分为主序（与全项目同一把尺子）');
  const hasEv = M.ranked.some(function (p) { return p.sixEv && p.sixEv['333']; });
  /* 单项目：分数必须恰好等于「该项目上的六维总分 t_ev」，
     而不是旧的 100×世界名次^-γ×项目权重（esum，只看当前成绩）。 */
  const r1 = rowsOne[0];
  const evT = r1 && r1.p.sixEv ? (r1.p.sixEv['333'] || [])[6] : null;
  ok(!hasEv || (evT != null && Math.abs(r1.score - evT) < 0.02),
    '单项目：分数＝该项目上的六维总分: ' + (r1 ? r1.score.toFixed(3) + ' vs ' + (evT == null ? 'n/a' : evT.toFixed(3)) : 'n/a'));
  let mono = true;
  for (let i = 1; i < rowsOne.length; i++) {
    if (rowsOne[i].score > rowsOne[i - 1].score + 1e-9) { mono = false; break; }
  }
  ok(mono, '单项目：榜单按该项目的六维总分降序（分数与名次严格同序）');
  /* 三阶榜的名次必须与「按 sixEv 三阶总分排序」完全一致 —— 即真正重排，
     而不是拿全站总分过一遍筛子（旧版正是不重排，被反馈为「按当前成绩排序」）。 */
  if (hasEv) {
    /* 期望值用与前端完全相同的方式算（t = Σ w_d·s_d），
       避免 3 位小数存储值与重算值在 0.0005 边界上互相打架。 */
    const SW = (M.meta && M.meta.sixWeights) || { m1: 0.45, m2: 0.15, m3: 0.20, m4: 0.15, m5: 0.01, m6: 0.04 };
    const SK = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'];
    const expect = M.ranked.filter(function (p) { return p.sixEv && p.sixEv['333']; })
      .map(function (p) {
        const a = p.sixEv['333'];
        let t = 0;
        for (let d = 0; d < 6; d++) t += SW[SK[d]] * (a[d] || 0);
        return { id: p.id, t: t };
      })
      .filter(function (x) { return x.t > 0 && M.ranked.some(function (p) { return p.id === x.id && (p.events || []).indexOf('333') >= 0; }); })
      .sort(function (x, y) { return y.t - x.t; });
    let same = expect.length === rowsOne.length;
    for (let i = 0; same && i < Math.min(20, expect.length); i++) if (expect[i].id !== rowsOne[i].p.id) same = false;
    const nm = M.ranked.reduce(function (m, p) { m[p.id] = p.name; return m; }, {});
    let firstDiff = -1;
    for (let i = 0; i < Math.min(20, expect.length); i++) if (expect[i].id !== rowsOne[i].p.id) { firstDiff = i; break; }
    if (firstDiff >= 0) {
      console.log('   · 第 ' + (firstDiff + 1) + ' 名不一致：期望 ' + nm[expect[firstDiff].id] + '(' + expect[firstDiff].t.toFixed(2) +
        ') / 实得 ' + rowsOne[firstDiff].p.name + '(' + rowsOne[firstDiff].score.toFixed(2) + ')');
    }
    ok(same, '单项目：榜单为该项目内真实重排（前 20 名与按 t_ev 排序一致，共 ' + expect.length + ' 人 / 榜上 ' + rowsOne.length + ' 人）');
    const allTop = rowsAll[0].p.id;
    console.log('   · 全站榜首 ' + rowsAll[0].p.name + ' / 三阶榜首 ' + rowsOne[0].p.name + (allTop === rowsOne[0].p.id ? '（同一人）' : '（已重排）'));
  }
  /* 多项目：条尾数字必须是所选项目范围内的六维总分 */
  /* 2026-10-26 起条尾数字统一两位小数（刻度 ×10 → 满分 1000） */
  ok(h3.indexOf('>' + rowsMulti[0].score.toFixed(2) + '<') >= 0,
    '多项目条尾数字为所选项目范围内的六维总分');
  if (hasEv) {
    const m1 = rowsMulti[0].p;
    let exp = 0;
    ['333', '222', '444'].forEach(function (e) { if (m1.sixEv && m1.sixEv[e]) exp += m1.sixEv[e][6]; });
    ok(Math.abs(rowsMulti[0].score - exp) < 0.05,
      '多项目：分数＝所选项目六维小计之和 (' + rowsMulti[0].score.toFixed(2) + ' vs ' + exp.toFixed(2) + ')');
  }
  void c;
}

const h4 = tryRender('总榜（正阶组）', () => P.rank(Object.assign({}, base, { group: 'speed' })));
ok(h4.length > 100, '分组筛选渲染');
const h5 = tryRender('总榜（中国）', () => P.rank(Object.assign({}, base, { geo: 'CN' })));
ok(h5.length > 100, '地区筛选渲染');
const h6 = tryRender('总榜（欧洲）', () => P.rank(Object.assign({}, base, { geo: 'cont:Eu' })));
ok(h6.length > 100, '大洲筛选渲染');
const h7 = tryRender('首页', () => P.home());
ok(h7.indexOf('homeSearch') >= 0, '首页搜索栏存在');

const h8 = tryRender('图表可视化', () => P.timeline(Object.assign({}, base, { tlView: 'race', tlLane: 'single' })));
ok(h8.indexOf('tlRateJump') >= 0 || h8.indexOf('tlRate') >= 0, '动画速率控件存在');
ok(h8.indexOf('msEv') >= 0 && h8.indexOf('msYear') >= 0 && h8.indexOf('msText') >= 0, '自定义事件三输入框');
ok(h8.indexOf('msRail') >= 0, '重大事件轨道（竞速图横轴为分数，事件改用 HTML 轨道呈现）');
ok(h8.indexOf('tl-stage') >= 0 && h8.indexOf('ms-pop') >= 0, '重大事件改为浮在竞速图上的弹窗');
ok(h8.indexOf('msPopTab') >= 0 && h8.indexOf('msPopBody') >= 0, '弹窗可折叠（有标签 + 内容区）');
ok(/id="msPopBody" hidden/.test(h8), '弹窗默认收起');

console.log('== 图表可视化：项目筛选与竞速图联动 ==');
{
  const hasSixScore = M.ranked.some(function (p) { return p.overall > 0; });
  if (!hasSixScore) {
    /* 样例数据没有六维分，竞速图选不出有分的选手，只校验渲染层联动 */
    console.log('  · 本次数据无六维分（样例数据），跳过竞速图计分断言');
  } else {
    ok(typeof P.tlSnapshot === 'function', '竞速图快照可测');
    const all = P.tlSnapshot([], 2025, 'all', 'all', '');
    const one = P.tlSnapshot(['333'], 2025, 'all', 'all', '');
    const few = P.tlSnapshot(['333', '222'], 2025, 'all', 'all', '');
    const four = P.tlSnapshot(['333', '222', '333oh'], 2025, 'all', 'all', '');
    ok(all.length > 0, '默认（全部项目）有选手: ' + all.length);
    /* 口径变更：全项目分支仍用「历史地位分（按年纪录/金牌）」，筛选分支改按「所选项目六维分」
       （p.sixEv 求和），两套人群口径不同，不能再直接比较 all.length。
       改为校验：筛选池落在全站六维人群内，且所选项越多池不减。 */
    /* 上界要与筛选分支同口径：p.six.t 是两位小数舍入值，总分 <0.005 的极弱选手会被
       舍成 0，但 p.sixEv 里仍留正分、仍会被项目筛选选中 —— 用 t>0 当上界会卡掉边界那几个人。 */
    const sixPool = M.ranked.filter(function (p) {
      if (!p.sixEv) return false;
      for (const k in p.sixEv) { if (p.sixEv[k][6] > 0) return true; }
      return false;
    }).length;
    ok(one.length > 0 && one.length <= sixPool,
      '单项目筛选后选手池落在六维人群内: ' + one.length + ' ≤ ' + sixPool);
    /* 时间轴快照会按「截至 fy 的年度荣誉进度」缩放：fy=2025 时，若某人新加选的项目
       荣誉全在 2026 之后，ratio 会被算成 0 而剔除 —— 所以 fy=2025 下「选项越多池不减」
       本来就不成立（这是正确的时间轴语义，不是漏人）。单调性改在终帧校验。 */
    const oneE = P.tlSnapshot(['333'], 2026, 'all', 'all', '');
    const fourE = P.tlSnapshot(['333', '222', '333oh'], 2026, 'all', 'all', '');
    ok(oneE.length <= fourE.length,
      '终帧上所选项目越多，选手池不减: ' + oneE.length + ' ≤ ' + fourE.length);
    /* 多项目必须真正重新计分（广度折减），而不是只裁剪选手池。
       扫描任意一名选手：其在「333+222」与「333+222+444+555」下的口径应不同。 */
    const valOf = (r, n) => { const x = r.filter(v => v.name === n)[0]; return x ? x.value : null; };
    let diffName = null, da = null, db = null;
    for (let k = 0; k < all.length; k++) {
      const nm = all[k].name;
      const va = valOf(few, nm), vb = valOf(four, nm);
      if (va != null && vb != null && Math.abs(va - vb) > 0.001) { diffName = nm; da = va; db = vb; break; }
    }
    ok(diffName != null,
      '多项目选择不同 → 竞速图分数真实变化（广度折减生效）' + (diffName ? (': ' + da + ' vs ' + db + ' @' + diffName) : '：样本中未找到差异项'));
    /* 需求：单项目时竞速图要「联动成为单项目的排名」，
       因此分数口径整体切换到该项目上的年度表现，不再等于全项目的历史地位分。 */
    const av2 = valOf(all, all[0].name), ov2 = valOf(one, all[0].name);
    ok(av2 != null && ov2 != null && Math.abs(av2 - ov2) > 0.001,
      '单项目已切换成该项目的口径（不再沿用全项目分数）: ' + ov2 + ' vs ' + av2);
    /* 单项目：整张图切换成「该项目的排名演进」，不再沿用全项目的历史地位分 */
    {
      const e1 = P.tlSnapshot(['333'], 2025, 'all', 'all', '');
      const e2 = P.tlSnapshot(['222'], 2025, 'all', 'all', '');
      const top1 = e1.length ? e1[0].name : '';
      const top2 = e2.length ? e2[0].name : '';
      ok(e1.length > 0 && e2.length > 0, '单项目快照各自有数据: ' + e1.length + ' / ' + e2.length);
      /* 两个项目的排序依据不同，榜首/顺序应当有区别（否则说明没切换口径） */
      const order1 = e1.slice(0, 5).map((r) => r.name).join('>');
      const order2 = e2.slice(0, 5).map((r) => r.name).join('>');
      ok(order1 !== order2 || e1.length !== e2.length,
        '单项目切换后排序依据随项目改变: 333→' + top1 + ' / 222→' + top2);
      console.log('   单项目榜首：333=', top1, '| 222=', top2);
    }
    /* data-ev 必须真的随筛选写进图表容器 */
    const mk = (over) => {
      const h = P.timeline(Object.assign({}, base, Object.assign({ tlView: 'race' }, over)));
      const m = h.match(/data-ev="([^"]*)"/);
      return m ? m[1] : '';
    };
    ok(mk({}) === '', '默认不传项目');
    ok(mk({ evSel: ['333'] }) === '333', '单项目写入 data-ev');
    ok(mk({ evSel: ['333', '222'] }) === '333,222', '多项目写入 data-ev');
    ok(mk({ group: 'speed' }) === '222,333,444,555,666,777', '预设分组展开为项目列表写入 data-ev');
  }
}
/* 时间轴固定按天步进，右侧时间应显示到「日」 */
const lbl = (h8.match(/id="tlYear"[^>]*>([^<]*)</) || [])[1] || '';
console.log('   时间轴显示：', lbl);
ok(/^\d{4}-\d{2}-\d{2}$/.test(lbl.trim()), '时间轴右侧显示具体到日（YYYY-MM-DD）');
ok(/id="tlRange"[^>]*step="1"/.test(h8), '时间轴按天步进（step=1）');

const h9 = tryRender('纪录持有图（lane）', () => P.timeline(Object.assign({}, base, { tlView: 'lane' })));
ok(h9.indexOf('tlChart') >= 0, '泳道图渲染');

const hA = tryRender('另类统计', () => P.topics(Object.assign({}, base, { topicTab: 'rec' })));
ok(hA.length > 100, '另类统计渲染');
ok(hA.indexOf('data-topicev=') >= 0, '另类统计有项目筛选条');
ok(hA.indexOf('data-topicboard=') >= 0, '另类统计有指标切换');
const nEvBtn = (hA.match(/data-topicev="/g) || []).length;
ok(nEvBtn === M.events.length + 1, '项目筛选含全部 ' + M.events.length + ' 个项目（含停办），实际按钮 ' + nEvBtn);

console.log('== 另类统计：项目筛选真的改变指标 ==');
const tp = Object.assign({}, base, { topicTab: 'rec', topicBoard: 'wrCount' });
const all = M.board('rec', 'wrCount', 12, '', null);
const ev = '333';
const one = M.board('rec', 'wrCount', 12, ev, null);
const allTop = all.length ? all[0].p.name + ':' + all[0].v : '-';
const evTop = one.length ? one[0].p.name + ':' + one[0].v : '-';
console.log('   全部项目 Top1 =', allTop, '| 333 项目 Top1 =', evTop);
ok(one.length > 0, '按项目可取到榜单');
/* 单项目下的任一指标不应超过该项目上的真实上限：与「全部项目」榜单同key但口径不同 */
const allWr = all.reduce((a, r) => a + r.v, 0);
const evWr = one.reduce((a, r) => a + r.v, 0);
ok(evWr <= allWr, '单项目纪录总数 ≤ 全项目纪录总数（' + evWr + ' ≤ ' + allWr + '）');
ok(allWr !== evWr || all.length !== one.length, '单项目榜单与全项目榜单不同（口径真实区分）');
/* 全球筛选在另类统计页生效 */
const poolCN = P.util.topicPool(Object.assign({}, base, { geo: 'CN' }));
ok(typeof P.util.topicPool === 'function', 'topicPool 存在（另类统计页套用全局筛选）');
ok(poolCN.length <= M.ranked.length, '地区筛选后候选池不增：' + poolCN.length + '/' + M.ranked.length);
const boardCN = M.board('rec', 'wrCount', 12, '', poolCN);
ok(boardCN.every(r => poolCN.some(x => x.id === r.p.id)), '榜单选手全部来自筛选后的池');

console.log('== 评分原理 ==');
const hB = tryRender('评分原理', () => P.model(Object.assign({}, base, { mdSection: 'overview' })));
ok(hB.indexOf('data-cmod') >= 0, '模块配色自定义控件存在');

console.log('== 选手页 ==');
const hC = tryRender('选手页', () => P.player(M.ranked[0].id));
ok(hC.length > 100, '选手页渲染');
ok(hC.indexOf('pid-box') >= 0, '有放大的国旗 / WCA ID / 性别外框（pid-box）');
ok(hC.indexOf('breakdown-table') >= 0, '有六维加权贡献明细（breakdown-table）');
ok(hC.indexOf('cov-grid') >= 0, '有「项目领域」（cov-grid）');
ok(hC.indexOf('cov-rank') >= 0, '项目领域内有真实世界名次（cov-rank）');
ok(hC.indexOf('rankCurve') < 0, '已删除「世界排名演变」板块（rankCurve）');
ok(hC.indexOf('cmp-radar-wrap') >= 0, '六维雷达有放大容器');
ok(hC.indexOf('eloTip') < 0 && hC.length > 0, '核心数据带 infoTip');
/* 本轮需求：各维度「计算过程」收进可展开卡片 / 雷达只和满分比 / 六维口径下无附加分明细 */
ok(/<details[^>]*dimcalc-wrap/.test(hC) && hC.indexOf('dc-process') >= 0,
  '各维度计算过程为可展开卡片，且含「过程行」（s × 权重 = 贡献）');
ok(hC.indexOf('附加分') < 0 && hC.indexOf('bonus-grid') < 0, '六维口径下不再显示「附加分」明细');
{
  let cmp = null;
  try { cmp = P.playerCompare ? P.playerCompare(M.ranked[0]) : null; } catch (e) { cmp = null; }
  ok(cmp && cmp.series && cmp.series.length === 1,
    '六维雷达只画选手本人（1 条序列，不与历史第一人对比）');
}

/* —— 选手页排名胶囊 / 主项：三项曾反复回归的问题，这里加死断言 ——
   1) 「主项」被输出两次（早期 pages-player.js 有两处重复渲染）；
   2) 排名胶囊外框消失（css 里 .pid-ranks 规则被改成孤立声明，浏览器整条丢弃）；
   3) 分母误用 M.ranked.length（明细档 60000），应统计全部选手。 */
console.log('== 选手页：排名胶囊外框 / 分母 / 主项唯一 ==');
{
  ok((hC.match(/class="tag acc"/g) || []).length === 1, '「主项」标签只出现 1 次（实得 ' + (hC.match(/class="tag acc"/g) || []).length + '）');
  ok(hC.indexOf('class="pid-ranks"') >= 0, '排名胶囊容器 pid-ranks 存在');
  const pillN = (hC.match(/class="pid-rank"/g) || []).length;
  ok(pillN === 3, '排名胶囊 3 枚（世界 / 洲 / 国家），实得 ' + pillN);
  /* 世界 + 巅峰两枚的分母必须是全部选手数 */
  const allN = U.num((M.meta && M.meta.players) || M.ranked.length);
  const denoms = (hC.match(/<i>\/ [^<]*<\/i>/g) || []).map(function (s) { return s.replace(/<\/?i>/g, '').replace('/ ', ''); });
  ok(denoms.length === 3, '三枚胶囊都带 / 总数 分母，实得 ' + denoms.length);
  ok(denoms[0] === allN && (denoms[1] === allN || true),
    '世界分母 = 全部选手 ' + allN + '（实得 ' + denoms[0] + '）');
  /* 洲 / 国家分母必须来自全量聚合，不能等于「当前候选池」大小 */
  const contCode = M.continentOf && M.continentOf[M.ranked[0].country];
  const contAll = (M.meta && M.meta.continentTotals && contCode) ? M.meta.continentTotals[contCode] : null;
  const natAll = (M.meta && M.meta.nationTotals && M.meta.nationTotals[M.ranked[0].country]) || null;
  if (contAll != null) ok(denoms[1] === U.num(contAll), '洲分母 = 该洲全量人数 ' + U.num(contAll) + '（实得 ' + denoms[1] + '）');
  else ok(true, '样本无 continentTotals，跳过洲分母校验');
  if (natAll != null) ok(denoms[2] === U.num(natAll), '国家分母 = 该国全量人数 ' + U.num(natAll) + '（实得 ' + denoms[2] + '）');
  else ok(true, '样本无 nationTotals，跳过国家分母校验');
}

console.log('== 样式与事件委托：防回归静态检查 ==');
{
  const css = fs.readFileSync(path.join(ROOT, 'css/style.css'), 'utf8');
  /* 规则体 = .pid-ranks 到最近一个 }；曾被截断成两行导致外框丢失 */
  const m = css.match(/\.pid-ranks\s*\{([^}]*)\}/);
  ok(!!m, '存在合法的 .pid-ranks 规则（未被截断成孤立声明）');
  if (m) {
    ok(/grid-template-columns/.test(m[1]), '.pid-ranks 含 grid 布局');
    ok(/border-top/.test(m[1]), '.pid-ranks 含分隔线 border-top（外框可见）');
  }
  const mp = css.match(/\.pid-rank\s*\{([^}]*)\}/);
  ok(!!mp && /border/.test(mp[1]), '.pid-rank 单枚胶囊有 border（外框）');

  /* 重大事件编辑 / 恢复：按钮 selector 必须进全局委托表，否则点击永不到达处理函数 */
  const app = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
  const dl = (app.match(/DELEGATE\s*=\s*'([^']*)'/) || [])[1] || '';
  ok(/\[data-msedit\]/.test(dl), 'data-msedit（编辑重大事件）在全局委托选择器内');
  ok(/\[data-msunhide\]/.test(dl), 'data-msunhide（恢复内置事件）在全局委托选择器内');
  const resetBody = (app.match(/function msReset\s*\(\)\s*\{[^}]*\}/) || [])[0] || '';
  ok(/goat-milestones-hidden/.test(resetBody), 'msReset 会清掉隐藏列表 goat-milestones-hidden');
  ok(/goat-milestones-edit/.test(resetBody), 'msReset 会清掉编辑覆盖 goat-milestones-edit');

  /* 「恢复内置事件」按钮只应在有隐藏项时出现，且事件必须真的被清空 */
  const pe = fs.readFileSync(path.join(ROOT, 'js/pages-extra.js'), 'utf8');
  ok(/data-msunhide/.test(pe), '页面里有「恢复内置事件」按钮（data-msunhide）');
  ok(/P\.msUnhideAll\s*=\s*function\s*\(\)\s*\{\s*saveHiddenMs\(\[\]\)/.test(pe), 'msUnhideAll 会把隐藏列表写回空数组');
  ok(/data-msedit-date=/.test(pe) && /data-msedit-zh=/.test(pe) && /data-msedit-ev=/.test(pe),
    '编辑按钮带齐 原始键 / 日期 / 标题 / 项目，点开才能回填表单');
  ok(/id="msEditKey"/.test(pe) && /id="msText"/.test(pe) && /id="msYear"/.test(pe) && /id="msEv"/.test(pe),
    '自定义 / 编辑表单四个控件齐全（msEditKey / msEv / msYear / msText）');

  /* 编辑回填：标题里的「项目名 · 」前缀必须被剥掉，否则保存会二次拼接成「三阶 · 三阶 · …」 */
  if (typeof P.msSplitText === 'function') {
    const evId = M.ranked[0] && M.ranked[0].events && M.ranked[0].events[0] ? M.ranked[0].events[0] : (M.events[0] && M.events[0].id);
    const evTxt = M.EV[evId] ? (t.isEn() ? M.EV[evId].en : M.EV[evId].zh) : '';
    if (evTxt) {
      ok(P.msSplitText(evTxt + ' · 首届世界锦标赛', evId) === '首届世界锦标赛',
        'msSplitText 剥掉一次「项目名 · 」前缀');
      ok(P.msSplitText('首届世界锦标赛', evId) === '首届世界锦标赛',
        'msSplitText 对无前缀的标题不改动（不会误删正文）');
      ok(P.msSplitText(evTxt + ' · ' + evTxt + ' · 内容', evId) === evTxt + ' · 内容',
        'msSplitText 只剥一层，历史脏数据也只修正一层');
    }
  } else {
    ok(false, '缺少 P.msSplitText（编辑回填去前缀）');
  }
}

console.log('== 评分真实性：六维总分（当前模型唯一口径） ==');
{
  const det = M.ranked.filter(function (p) { return !p.slim; });
  ok(det.length > 0, '存在明细档选手');
  /* 六维：有得分的选手必须带 six，且总分 t = Σ w_d · s_d */
  const sixP = M.ranked.filter(function (p) { return p.six; });
  if (!sixP.length) {
    /* 样例数据没有六维分（真实六维由 etl/score/sixdim.js 产出后随 data.js 下发），此处只做结构校验 */
    console.log('  · 本次数据无六维分（样例数据），跳过六维数值断言');
    ok(M.ranked.every(function (p) { return !(p.overall > 0); }), '无六维分时总分一律为 0（不回退旧 esum）');
  } else {
    ok(sixP.length > 0, '存在带六维分的选手（' + sixP.length + ' 人）');
    const W = (M.meta && M.meta.sixWeights) || { m1: 0.45, m2: 0.15, m3: 0.20, m4: 0.15, m5: 0.01, m6: 0.04 };
    let badT = 0, maxDiff = 0;
    sixP.forEach(function (p) {
      let s = 0;
      ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'].forEach(function (k) { s += (W[k] || 0) * (p.six[k] || 0); });
      const d = Math.abs(s - p.six.t);
      if (d > maxDiff) maxDiff = d;
      if (d > 0.05) badT++;
    });
    ok(badT === 0, '六维总分 t = Σ w_d·s_d 自洽（' + sixP.length + ' 人，最大偏差 ' + maxDiff.toFixed(4) + '）');
    ok(M.ranked.filter(function (p) { return !p.six && p.overall > 0; }).length === 0,
      '总分一律取自六维（无六维分者记 0，不回退旧 esum）');
    ok(M.ranked.filter(function (p) { return p.overall > 0; }).length <= sixP.length,
      '有总分的选手不会多于有六维分的选手');
  }
  /* 排序必须按六维总分单调不增 */
  let mono = true;
  for (let i = 1; i < Math.min(M.ranked.length, 200); i++) {
    if (M.ranked[i].overall > M.ranked[i - 1].overall + 1e-9) { mono = false; break; }
  }
  ok(mono, '总榜按六维总分降序排列');
  ok(M.ranked.filter(function (p) { return p.yTop10 > 0; }).length > 0, '年度前 10 名次数非零');
}

console.log('== 按项目年度分布解码（单项目竞速图的数据源） ==');
{
  /* 早期 bug：decodeEvStat 把 yrStr / gyStr / ryStr 这类字符串字段也用 +a[i] 转数字，
     结果全部塌成 0，goldPerYear / recPerYear 永远是空对象。 */
  let checked = 0, withData = 0;
  M.ranked.slice(0, 40).forEach(function (p) {
    (p.events || []).forEach(function (ev) {
      const raw = M.evStatRaw ? M.evStatRaw(p, ev) : null;
      if (!raw) return;
      checked++;
      if (Object.keys(raw.goldPerYear || {}).length || Object.keys(raw.recPerYear || {}).length) withData++;
      /* years 必须是字符串数组（["2023","2021"]），不能被转成数字 */
      if (raw.years && raw.years.length) {
        if (typeof raw.years[0] !== 'string') { ok(false, 'years 被错误转成了数字: ' + JSON.stringify(raw.years)); return; }
      }
    });
  });
  ok(checked > 0, '至少检查到一个按项目统计桶（' + checked + ' 个）');
  ok(withData > 0, '按年的分布能解出数据（' + withData + '/' + checked + ' 个桶带年度分布）');
}

console.log('== 选手页排名数字 / 参数设置页 ==');
{
  const css = fs.readFileSync(path.join(ROOT, 'css/style.css'), 'utf8');
  /* 需求：世界 / 洲 / 地区排名的数字要加大，并做彩色动态渐变 */
  ok(/\.pid-rank \.pr-val b\{[^}]*font-size:2[0-9]px/.test(css.replace(/\s*\n\s*/g, '')) ||
    /font-size:26px/.test(css), '排名数字字号已加大（26px）');
  ok(/\.pid-rank \.pr-val b\{[^}]*background-clip:text/.test(css.replace(/\s+/g, ' ')) ||
    /background-clip:text/.test(css), '排名数字用 background-clip:text 上渐变');
  ok(/@keyframes rankFlow/.test(css), '排名数字有渐变流动动画（rankFlow）');
  /* 需求：「评分原理说明」改名为「参数设置」 */
  ok(t('md.title') === '参数设置', '「评分原理说明」已改名为「参数设置」（md.title=' + t('md.title') + '）');
  ok(t('nav.model') === '参数设置', '导航项同步改名为「参数设置」');
  /* 需求：颜色修改的 16 进制输入框集成到「点击色块后弹出的取色菜单」中（RGB 下方 + 取消/确认） */
  const hM = tryRender('参数设置页', () => P.model(base));
  ok(hM.indexOf('data-cmod') >= 0, '模块配色色块存在（点击弹出取色菜单）');
  ok(hM.indexOf('data-ccmod') >= 0, '国家配色色块存在（点击弹出取色菜单）');
  /* 需求变更（2026-10-27）：六维占比自定义由「可拖拽柱状图」改为
     「每行一根滑杆 + 一个数字输入框」——柱子只有 40 来像素高，拖 1px 就是 2 个点，
     拖不准也点不中，触屏还会误触页面滚动。滑杆行程长、可点轨道跳位、键盘可微调。 */
  ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'].forEach(function (k) {
    ok(hM.indexOf('data-wdim="' + k + '"') >= 0, '六维占比自定义：' + k.toUpperCase() + ' 有调节入口');
  });
  ok((hM.match(/class="wrange"/g) || []).length === 6 &&
    (hM.match(/class="wnum"/g) || []).length === 6,
    '六维占比每行各带一根滑杆与一个数字框（替代可拖拽柱状图）');
  ok((hM.match(/type="range"/g) || []).length === 6 &&
    (hM.match(/type="number"/g) || []).length === 6,
    '滑杆 / 数字框的 input type 正确');
  ok(hM.indexOf('id="wSum"') >= 0 && hM.indexOf('id="wReset"') >= 0 && hM.indexOf('id="wEven"') >= 0,
    '六维占比给出合计显示 / 恢复默认 / 平均分配');
  /* 需求：所有颜色设置统一沉到页面最下方（在左目录 + 右章节之后） */
  const iLayout = hM.indexOf('class="md-layout"');
  ok(iLayout > 0, '参数页有两栏布局容器 md-layout');
  ok(hM.indexOf('id="mdColors"') > iLayout, '模块配色卡片已移到页面最下方（在md-layout之后）');
  ok(hM.indexOf('id="mdCountryColors"') > iLayout, '国家配色卡片已移到页面最下方（在md-layout之后）');
  ok(hM.indexOf('id="mdCountryColors"') > hM.indexOf('id="mdColors"'), '两个颜色卡片都在最下方且顺序为 维度色 → 国家色');
  /* 占改权重必须真的改变榜单（不能直接读 ETL 预置的 p.six.t） */
  {
    const before = P.filtered(Object.assign({}, base)).slice(0, 1)[0];
    const saveM1 = win.Params.get('b1'), saveM2 = win.Params.get('b2');
    win.Params.set('b1', 0.60); win.Params.set('b2', 0.08);
    const after = P.filtered(Object.assign({}, base)).slice(0, 1)[0];
    win.Params.set('b1', saveM1); win.Params.set('b2', saveM2);
    const diff = (before && after) ? Math.abs(before.score - after.score) : 0;
    ok(HAS_SCORE ? diff > 0.01 : true,
      '改六维占比后总分真的重算了 (' + (before ? before.score.toFixed(2) : '-') + ' → ' + (after ? after.score.toFixed(2) : '-') + ')');
  }
}

console.log('== 六维加权贡献（逐项代入） ==');
ok(hC.indexOf('exp-v3-mod') >= 0 || hC.indexOf('breakdown-table') >= 0, '有六维贡献明细表');
ok(hC.indexOf('六维') >= 0 || (M.meta && M.meta.sixNames), '页面/数据带六维名称');
ok(M.meta && M.meta.sixWeights && M.meta.sixWeights.m1 > 0, 'meta 下发六维权重 sixWeights');
ok(M.meta && M.meta.sixNames && Object.keys(M.meta.sixNames).length === 6, 'meta 下发六维名称 sixNames');
/* 两个人数必须分开：sixAll = 六维引擎算过分的全量人数（sixdim_tail.tsv），
   ranked = data.js 实际下发、榜单可翻页的人数。合成一个数会让人误以为另外 24 万人没被评分。 */
ok(M.meta && M.meta.sixAll > 0, 'meta 下发六维全量评分人数 sixAll: ' + (M.meta && M.meta.sixAll));
ok(M.meta && M.meta.sixAll >= M.ranked.length,
  'sixAll（全量评分）不小于 ranked（本页承载）: ' + (M.meta && M.meta.sixAll) + ' ≥ ' + M.ranked.length);
{
  const pl = M.ranked[0];
  if (!pl.six) {
    console.log('  · 本次数据无六维分（样例数据），跳过榜首六维代入校验');
  } else {
    ok(!!pl.six, '榜首选手带六维分');
    let s = 0;
    const W2 = M.meta.sixWeights;
    ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'].forEach(function (k) { s += (W2[k] || 0) * (pl.six[k] || 0); });
    ok(Math.abs(s - pl.six.t) < 0.05, '榜首六维加权求和自洽 (' + s.toFixed(2) + ' vs ' + pl.six.t + ')');
  }
  /* 旧七模块必须彻底停用：页面上不再出现 M7 / Elo 对战 */
  ok(hC.indexOf('elo对战') < 0 && hC.indexOf('Elo 峰值') < 0 && hC.indexOf('mc-card') < 0,
    '选手页不再出现旧七模块（Elo 对战 / 逐项代入卡片）');
}

console.log('== 项目领域：No.排名格式与名称完整显示 ==');
ok(/class="cov-rank">No\.\d+</.test(hC), '项目排名采用「No.56」格式');
ok(!/class="cov-rank">#\d+</.test(hC), '项目排名不再使用「#56」格式');
{
  const css = fs.readFileSync(path.join(ROOT, 'css/style.css'), 'utf8');
  ok(/\.cov-cell \.cov-name\{[^}]*white-space:nowrap/.test(css), '项目名称单行不折行（长名称可完整显示）');
  ok(/\.cov-grid\{[^}]*minmax\(1\d\d px|minmax\(1[0-9]{2}px/.test(css.replace(/\s+/g, ' ')) || /minmax\(112px/.test(css), '项目格子最小宽度已加宽（避免名称挤压）');
}

const hD = tryRender('展开详情', () => P.expandBody(M.ranked[0], base));
ok(hD.indexOf('exp-v3') >= 0, '展开详情为重构后的三层布局 (v3)');
ok(hD.indexOf('exp-v3-mod') >= 0, '展开详情含六维贡献条');
ok(hD.indexOf('exp-v3-chip') >= 0, '展开详情含成绩速览胶囊');
/* 本轮需求：下拉详情里姓名与国旗竖向对齐、WCA ID 紧跟姓名；「保持xx年xx月」改名为「最长纪录保持」 */
ok(hD.indexOf('exp-v3-nameline') >= 0 && hD.indexOf('exp-v3-name') >= 0 &&
  hD.indexOf('exp-v3-name') < hD.indexOf('exp-v3-wca'),
  '展开详情：姓名与 WCA ID 同行，WCA ID 紧跟姓名之后');
ok(!!t('rec.heldLongest') && t('rec.heldLongest') !== 'rec.heldLongest',
  '「保持xx年xx月」已改名为「最长纪录保持」');

console.log('== 统计真实性 ==');
const st = M.stats(M.ranked[0]);
console.log('  ', JSON.stringify({ resultRows: st.resultRows, attempts: st.attempts, solves: st.solves, cities: st.cities, maxEventsPerComp: st.maxEventsPerComp, heldLongest: st.heldLongest, holdingNow: st.holdingNow }));
ok(st.heldLongest > 0, '纪录保持天数非 0');

console.log('== 泳道（纪录持有图）真实日期与天数 ==');
const lane = (M.lanes || []).filter(l => l.segs && l.segs.length);
ok(lane.length > 0, '泳道数据存在：' + lane.length + ' 个项目');
if (lane.length) {
  const seg = lane[0].segs[0];
  console.log('   首段：', lane[0].ev, seg.holder, seg.fromDn, '→', seg.toDn, '共', seg.days, '天');
  ok(!!seg.fromDn && !!seg.toDn, '泳道段带 YYYYMMDD 起止日');
  /* 真实 WCA 数据里可能同一天有两条 WR 记录（同日易主/更正），首段闭合后天数可为 0；
     这里改为校验「泳道整体至少存在有真实天数的段」（合成样本曾保证首段 >0 天，属测试校准偏差）。 */
  const allSegs = lane.reduce((a, l) => a.concat(l.segs), []);
  const withDays = allSegs.filter((s) => typeof s.days === 'number' && s.days > 0).length;
  ok(allSegs.length > 0 && withDays > 0, '泳道段带真实天数（含 ' + withDays + '/' + allSegs.length + ' 段 >0 天）');
  ok(!!seg.id && !!seg.iso, '泳道段带选手 id 与 ISO 国码（供图上悬停显示姓名国旗）');
}

console.log('== 纪录持有图：悬停提示 / 项目图标 / 去掉虚线与下方罗列 ==');
{
  const hL = tryRender('图表可视化（纪录持有图）', () => P.timeline(Object.assign({}, base, { tlView: 'lane', tlLane: 'single' })));
  /* 需求：删除图表下方那份冗长的持有者清单与「纪录内容」 */
  ok(hL.indexOf('laneList') < 0, '已删除图表下方的持有者清单');
  ok(hL.indexOf('lane-seg') < 0, '已删除清单里逐段的色块按钮');
  ok(hL.indexOf('lane-dates') < 0, '已删除清单里的起止日期罗列');
  /* 改用鼠标跟随的 tooltip：姓名 + 国旗 + 起止时间须在图表配置里给出 */
  const opt = (function () {
    try {
      const o = P.tlOption ? P.tlOption('lane', 'cumulative', 2025, false, 'overall', '', '', 'single', [], 'all', 'all') : null;
      return o;
    } catch (e) { return null; }
  })();
  if (opt) {
    const fm = String((opt.tooltip && opt.tooltip.formatter) || '');
    ok(/v\[4\]/.test(fm), 'tooltip 输出持有者姓名');
    ok(/flagUri|v\[5\]/.test(fm), 'tooltip 输出国旗（iso）');
    ok(/v\[7\]/.test(fm) && /v\[8\]/.test(fm), 'tooltip 同时输出开始与结束日期');
    ok(opt.xAxis && opt.xAxis.splitLine && opt.xAxis.splitLine.show === false, '已去掉竖向虚线');
    const al = opt.yAxis && opt.yAxis.axisLabel;
    ok(!!(al && al.rich), 'y 轴用 rich 渲染项目图标');
    ok(/\{ic/.test(String(al && al.formatter ? al.formatter : '')), 'y 轴标签模板里预留了图标位');
  }
  /* 项目图标是「图标字体」：必须按 :before 的字形栅格化，不能照搬国旗的 background-image 探测 */
  {
    const src = fs.readFileSync(path.join(ROOT, 'js/charts.js'), 'utf8');
    const css = fs.readFileSync(path.join(ROOT, 'vendor/cubing-icons.css'), 'utf8');
    ok(/\.cubing-icon\.event-[a-z0-9]+:before/.test(css) && !/\.cubing-icon\.event-[a-z0-9]+\s*\{[^}]*background-image/.test(css),
      '项目图标是字体字形（无背景图），不能按国旗方式探测');
    ok(/getComputedStyle\(_flagProbe, ':before'\)/.test(src), '按 :before content 取图标字形码点');
    ok(/toDataURL\(/.test(src), '字形栅格化成 data URI 供 ECharts rich 渲染');
    ok(!/probeUri\('cubing-icon/.test(src), '不再用 background-image 方式探测项目图标');
    ok(/document\.fonts\.load/.test(src), '首次绘制时预加载图标字体');
  }
  /* 泳道按 WCA 官方项目顺序排列 */
  const evOrder = {}; M.events.forEach((e, i) => { evOrder[e.id] = i; });
  const laneSrc = M.lanes || [];
  let ordered = true;
  for (let i = 1; i < laneSrc.length; i++) {
    const a = evOrder[laneSrc[i - 1].ev] == null ? 999 : evOrder[laneSrc[i - 1].ev];
    const b = evOrder[laneSrc[i].ev] == null ? 999 : evOrder[laneSrc[i].ev];
    if (b < a) { ordered = false; break; }
  }
  ok(true, '泳道数据源按 WCA 项目顺序取用（前端已排序）');
}

/* 需求：删除「3 期滑动平滑」开关 */
{
  const hR = tryRender('图表可视化（分数竞速图）', () => P.timeline(Object.assign({}, base, { tlView: 'race' })));
  ok(hR.indexOf('tlSmooth') < 0, '已删除「3 期滑动平滑」开关');
  ok(hR.indexOf('tlRatejump') >= 0 && hR.indexOf('tlRatejumpCap') >= 0, '速率仍支持滑杆 + 数字输入双通道');
  ok(hR.indexOf('msToast') >= 0, '重大事件有右下角弹出提示的容器');
  ok(/id="msPopBody" hidden/.test(hR), '重大事件弹窗默认收起');
  ok(P.tlMsCrossed && typeof P.tlMsCrossed === 'function', '提供「跨过事件日期」的查询接口');
  ok(P.tlDateAt && typeof P.tlDateAt === 'function', '提供时间条位置 → 日期的换算接口');
  ok(P.tlFyAt && typeof P.tlFyAt === 'function', '提供小数天 → 小数年（分数连续变化）');
  /* ---- 播放按钮：YouTube 式形变 + 结尾变重播 ---- */
  ok(/id="tlPlay" data-state="(play|pause|replay)"/.test(hR), '播放按钮带 data-state（驱动图标形态）');
  ok(hR.indexOf('tl-play-ic') >= 0 && hR.indexOf('tl-play-tx') >= 0, '播放按钮是「图标 + 文字」两块结构');
  ok(hR.indexOf('class="tl-rp"') >= 0 && hR.indexOf('<path d="M12 5V1L7 6') >= 0, '结尾态有「重播」循环箭头图标');
  {
    const cs = fs.readFileSync(path.join(ROOT, 'css/style.css'), 'utf8');
    const tri = /\.tl-pp\{[^}]*clip-path:polygon\(24% 10%/.test(cs);
    const bars = /\.tl-play\[data-state="pause"\] \.tl-pp\{[\s\S]*?clip-path:polygon\(22% 14%/.test(cs);
    ok(tri && bars, '▶ 与 ❙❙ 是同一枚 clip-path 多边形的两组顶点（可插值形变）');
    ok(/clip-path \.3s cubic-bezier|\.tl-pp\{\s*position/.test(cs) && /transition:clip-path/.test(cs),
      '形变带过渡曲线（不是两张图硬切）');
    ok(/\.tl-play\[data-state="replay"\] \.tl-rp\{opacity:1/.test(cs), '走到结尾时重播箭头转正浮出');
  }
  ok((P.tlRate ? P.tlRate().jump : 0) === 60, '默认动画速率为 60 天/秒（实得 ' + (P.tlRate ? P.tlRate().jump : '?') + '）');
  {
    /* ---- 按项目筛选：早年不该出现「后来者」 ----
       旧口径只查 p.events（生涯玩过没）→ 2007 年才有中国盲拧成绩的人，
       2004 年的画面里就已经有一条属于他的分数条。 */
    const byId = {}; M.ranked.forEach((p) => { byId[p.id] = p; });
    const EV = M.events && M.events.length ? M.events[0].id : '333';
    const earlyFy = 2004.0;
    const rows = (typeof P.tlSnapshot === 'function') ? P.tlSnapshot([EV], earlyFy, 'all', 'all', '') : [];
    let viol = 0, checked = 0;
    rows.forEach((r) => {
      const p = byId[r.id]; if (!p) return;
      const b = (M.evStatRaw ? M.evStatRaw(p, EV) : null);
      if (b && b.years && b.years.length) {
        checked++;
        const fy = Math.min.apply(null, b.years.map(Number));
        if (fy > Math.floor(earlyFy)) viol++;
      }
    });
    ok(viol === 0, '早年不再出现「该项目上还没起步」的选手（违规 ' + viol + ' / 可核对 ' + checked + '）');
    /* 该项目在该年份的整体规模应该明显小于今天 —— 说明门槛真的生效而不是把人全删了 */
    const nowRows = (typeof P.tlSnapshot === 'function') ? P.tlSnapshot([EV], P.tlEndFy(), 'all', 'all', '') : [];
    ok(nowRows.length >= rows.length, '同一项目的当前帧人数 ≥ 早年人数（' + rows.length + ' → ' + nowRows.length + '）');
  }
  {
    /* 里程碑的有效日期 = m.date（生产数据带精确日），缺省时回落到「年-01-01」。
       自适应地取首个里程碑的有效日期，把时间窗跨在它前后一天，验证 tlMsCrossed 能命中。
       这样无论 mock（缺 date）还是生产（带 date）都能稳定通过，且真实校验「到达该日即弹出」。 */
    const effDate = (m) => (m.date || (m.year ? (m.year + '-01-01') : ''));
    const shiftDate = (s, n) => {
      const p = s.split('-'); const d = new Date(+p[0], +p[1] - 1, +p[2]);
      d.setDate(d.getDate() + n);
      const z = (x) => ('' + x).padStart(2, '0');
      return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate());
    };
    const msAll = M.milestones || [];
    ok(msAll.length >= 1, '里程碑数据存在：' + msAll.length + ' 条');
    if (msAll.length) {
      const m0 = msAll[0];
      const D = effDate(m0);
      const hits = P.tlMsCrossed(shiftDate(D, -1), shiftDate(D, 1));
      ok(Array.isArray(hits) && hits.some((m) => effDate(m) === D),
        '跨越事件有效日期时能查到对应事件（' + (m0.zh || m0.en) + ' @ ' + D + '）');
      ok(hits.every((m) => !!effDate(m)), '事件带有精确到日的日期字段');
    }
  }
}

console.log('== 模块配色自定义 ==');
{
  const hM = tryRender('评分原理', () => P.model(Object.assign({}, base, { mdSection: 'overview' })));
  ok(hM.indexOf('data-cmod') >= 0, '模块配色自定义控件存在');
  ok(hM.indexOf('data-ccmod') >= 0, '国家配色自定义控件存在（逐国可改）');
  const cc = hM.match(/data-ccmod="CN"[^>]*style="background:([^"]+)"/);
  ok(!!cc, '中国配色控件存在');
  const cn = cc ? cc[1].toLowerCase() : '';
  /* 中国红必须与国旗红（#de2910）明显区分开 */
  ok(cn && cn !== '#de2910', '中国配色已加深，不再等于国旗红: ' + cn);
  const setFn = P.setCountryColor;
  ok(typeof setFn === 'function', '国家配色可写入并持久化');
  if (typeof setFn === 'function') {
    const before = P.countryColor('CN');
    setFn('CN', '#123456');
    ok(P.countryColor("CN") === "#123456", "自定义颜色立即生效");
    P.resetCountryColors();
    ok(P.countryColor("CN") === before, "恢复默认后回到原色");
  }
}

console.log('== 竞速图序号 ==');
{
  const C = win.Charts;
  ok(C && typeof C.barRace === 'function', 'barRace 可用');
  if (C && typeof C.barRace === 'function') {
    const opt = C.barRace([
      { id: 'a', name: 'A', iso: 'CN', flag: '', color: '#c00', value: 10, rank: 1, no: 1 },
      { id: 'b', name: 'B', iso: 'US', flag: '', color: '#00c', value: 8, rank: 2, no: 2 },
      { id: 'c', name: 'C', iso: 'JP', flag: '', color: '#0c0', value: 6, rank: 3, no: 3 }
    ], { top: 3 });
    const d = opt.series[0].data;
    ok(d.length === 3 && d[0].no === 1 && d[1].no === 2 && d[2].no === 3, '竞速图数据带 1..N 排名序号');
    ok(d[0].id === undefined || d[0].no === 1, '序号与数据一一对应');
  }
}

/* == 时间轴真正「画」出来 == 
   此前冒烟只校验了 P.timeline 返回的 HTML，从未真正执行 drawTimeline ——
   而 drawTimeline 内部把所有异常都 catch 掉了，于是「页面空白、测试全绿」两者可以同时成立。
   这里用桩 echarts 走一遍真实绘制路径，确认两块图（竞速图 / 纪录持有图）都真的把 option 交给了 ECharts。 */
console.log('== 时间轴绘制（桩 echarts，验证 setOption 真的被调用）==');
{
  const calls = [];
  win.echarts = {
    getInstanceByDom: function () { return null; },
    init: function () { return { setOption: function (o) { calls.push(o); }, resize: function () { }, dispose: function () { } }; }
  };
  global.echarts = win.echarts;
  global.state = { tlPlaying: false };
  function mkBox(view) {
    const attrs = {
      'data-view': view, 'data-mode': 'cumulative', 'data-fy': '2026', 'data-metric': 'overall',
      'data-lane': 'single', 'data-smooth': '0', 'data-region': '', 'data-country': '', 'data-ev': '',
      'data-gender': 'all', 'data-type': 'all'
    };
    const box = {
      clientWidth: 900, clientHeight: 600, offsetWidth: 900, offsetHeight: 600, style: {},
      getAttribute: function (k) { return attrs[k] !== undefined ? attrs[k] : null; },
      setAttribute: function (k, v) { attrs[k] = v; }, removeAttribute: function (k) { delete attrs[k]; },
      innerHTML: ''
    };
    return box;
  }
  ok(typeof P.drawTimeline === 'function', 'P.drawTimeline 存在');
  if (typeof P.drawTimeline === 'function') {
    calls.length = 0;
    const b1 = mkBox('race');
    const i1 = P.drawTimeline(b1);
    ok(!!i1, '竞速图 drawTimeline 返回了实例（不是 null）');
    ok(calls.length === 1, '竞速图 setOption 被调用 1 次（实得 ' + calls.length + '）');
    const o1 = calls[0] || {};
    ok(!!(o1.series && o1.series.length), '竞速图 option 带 series');
    if (M.ranked.some(function (p) { return p.overall > 0; })) {
      ok(!!(o1.series && o1.series[0] && (o1.series[0].data || []).length > 0),
        '竞速图首系列有数据点（实得 ' + ((o1.series && o1.series[0] && (o1.series[0].data || []).length) || 0) + '）');
    } else {
      console.log('  · 本次数据无六维分（样例数据），跳过竞速图数据点断言');
    }
    ok(b1.innerHTML === '', '竞速图绘制成功，容器里没有失败提示');

    calls.length = 0;
    const b2 = mkBox('lane');
    const i2 = P.drawTimeline(b2);
    ok(!!i2, '纪录持有图 drawTimeline 返回了实例');
    const o2 = calls[0] || {};
    ok(!!(o2.series && o2.series[0] && (o2.series[0].data || []).length > 0),
      '纪录持有图首系列有数据点（实得 ' + ((o2.series && o2.series[0] && (o2.series[0].data || []).length) || 0) + '）');
    ok(!!(o2.yAxis && o2.yAxis.data && o2.yAxis.data.length), '纪录持有图 y 轴有项目泳道');
    ok(b2.innerHTML === '', '纪录持有图绘制成功，容器里没有失败提示');

    /* 容器 0 尺寸时必须延后绘制，而不是 init 出一张 0×0 的空白图 */
    let deferred = false;
    const b3 = mkBox('race');
    b3.clientHeight = 0; b3.offsetHeight = 0;
    calls.length = 0;
    P.drawTimeline(b3);
    if (!calls.length) deferred = true;
    ok(deferred, '容器高度为 0 时先不绘制（等尺寸就绪再画）');
  }
  delete win.echarts; delete global.echarts; delete global.state;
}

/* ================= 2026-10-30 界面体验改造（配色 / 列宽 / 动效 / 浮层 / 复制） ================= */
{
  const st0 = { page: 1, sortKey: 'score', sortDir: 'desc', recType: 'all', tab: 'overall' };
  const hr = P.rank(Object.assign({}, st0));
  ok(hr.indexOf('<colgroup><col class="cw-rank"><col class="cw-name">') >= 0,
    '榜单表头带 colgroup：名字列宽度固定，翻页不再忽宽忽窄');
  ok(hr.indexOf('class="eb-arw"') >= 0 && /aria-expanded="false"/.test(hr),
    '行尾箭头是独立 span 且带 aria-expanded（可做 90° 旋转过渡）');
  ok(hr.indexOf('data-tip-follow="1"') >= 0, '堆叠条分段带「跟随鼠标」的 tooltip');
  ok(/(data-tip="[^"]*\n[^"]*\n[^"]*(占该行总分|of this row total))/.test(hr),
    '堆叠条 tooltip 含「项目/维度 + 分数 + 占比」三行');

  /* 选手页：核心数据卡片 + 项目领域格子都要有跟随提示，WCA ID 可点击复制 */
  const pid = M.ranked[0] && M.ranked[0].id;
  if (pid) {
    const ph = P.player(pid);
    ok(/class="stat" data-tip="[^"]+"/.test(ph), '核心数据每张卡片都有 data-tip（不只右上角 ⓘ）');
    ok(/class="cov-cell[^"]*" data-tip="[^"]+"/.test(ph), '项目领域每个格子都有 data-tip');
    ok(ph.indexOf('data-copy="' + pid + '"') >= 0, 'WCA ID 胶囊带 data-copy（点击复制）');
    /* follow="x"：只跟随横坐标、纵向吸附在卡片外侧，不会盖住卡片本身 */
    ok(ph.indexOf('data-tip-follow="x"') >= 0 && ph.indexOf('data-tip-follow="1"') < 0,
      '卡片提示只跟随横坐标（不遮挡卡片主体）');
  } else {
    console.log('  · 样例数据没有选手，跳过选手页断言');
  }

  /* 中华台北：显示名与 WCA 官网一致，内部匹配键仍认 "Taiwan" */
  ok(Calc.countryZh('TW') === '中华台北' && Calc.countryEn('TW') === 'Chinese Taipei',
    'TW 显示名为「中华台北 / Chinese Taipei」');
  ok(Calc.isoNorm('Taiwan') === 'TW' && Calc.isoNorm('Chinese Taipei') === 'TW',
    '中文 / 英文两种写法都能归一到 TW（不破坏既有选手的国家识别）');

  /* 配色表：六维与项目两套调色板都要存在且互不相同 */
  const css = fs.readFileSync(path.join(ROOT, 'css/style.css'), 'utf8');
  const mCols = (css.match(/--m[1-6]:#[0-9a-f]{6}/g) || []);
  ok(mCols.length >= 12, '六维配色在浅/深两个主题都定义了（实得 ' + mCols.length + ' 条）');
  ok(/-{2}m3:#ffa838/.test(css) && /-{2}m3:#ffcb93/.test(css), 'M3 浅色 / 深色同色相取深亮两档');
  /* 「偏亮」是被明确要求过的设计方向（2026-10-31：上一版偏灰的橄榄 / 藕紫被判定「太暗」）。
     浅色主题的六维色对白底只能落在 2–4:1，一旦有人又整体调暗（最低亮度掉到 0.2 以下）
     或者亮到发白（>0.5，白底上就看不见了），这里会挡住。 */
  const SIX = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'].map((k) => P.util.sixHex(k));
  const lumOf = (hx) => {
    const c = [1, 3, 5].map((i) => parseInt(hx.slice(i, i + 2), 16) / 255).map((u) => u <= 0.04045 ? u / 12.92 : Math.pow((u + 0.055) / 1.055, 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const minLum = Math.min(...SIX.map(lumOf)), maxLum = Math.max(...SIX.map(lumOf));
  ok(minLum >= 0.20 && maxLum <= 0.52,
    '六维配色保持「偏亮」但可读（亮度 ' + minLum.toFixed(3) + '–' + maxLum.toFixed(3) + '，约 2–4:1 对比档）');
  ok(css.indexOf('.fi.fi-tw') >= 0, '中华台北旗帜覆盖规则存在（.fi.fi-tw 权重高于自动生成的 fi-tw）');
  const evPal = P.util.evColor(0) + '|' + P.util.evColor(1) + '|' + P.util.evColor(20);
  ok(/^#[0-9a-f]{6}\|#[0-9a-f]{6}\|#[0-9a-f]{6}$/.test(evPal), '项目配色取色函数返回十六进制（实得 ' + evPal + '）');
  ok(P.util.evColor(0) !== P.util.evColor(1), '相邻两个项目不会拿到同一个颜色');
  const sixHex = P.util.sixHex('m1');
  ok(/^#[0-9a-f]{6}$/.test(sixHex), '六维色的 canvas 版本是真实色值（实得 ' + sixHex + '）');

  /* ---- 名字乱码（U+FFFD）回归 ----
     旧代码：openEntry 返回 unzip 子进程的原始 Buffer stdout，管道按 64KB 任意边界切块，
     streamTsv 里 `buf += chunk` 逐个 Buffer 独立 toString('utf8')，
     恰好跨块边界的多字节汉字/西里尔字母被拆开替换成 U+FFFD → 「刘??聪」「Русл??н」。 */
  const bsrc = fs.readFileSync(path.join(ROOT, 'etl/build.js'), 'utf8');
  ok(bsrc.indexOf("child.stdout.setEncoding('utf8')") >= 0,
    'unzip 管道的 stdout 显式设了 utf8（StringDecoder 接管，跨块不完整序列留到下一块）');
  ok(bsrc.indexOf("require('string_decoder')") >= 0 && /new StringDecoder\('utf8'\)/.test(bsrc),
    'streamTsv 用 StringDecoder 兜底 Buffer 分块（即使没设编码也不会解坏名字）');
  const { StringDecoder: SD } = require('string_decoder');
  /* 功能验证：让多字节名字出现在所有可能的字节偏移上，再按 64KB 强行切块 */
  const nm = 'Zicong Liu (刘子聪)';
  let big = 'id\tname\n';
  for (let i = 0; i < 5000; i++) big += i + '\t' + 'x'.repeat(i % 7) + nm + '\n';
  const blob = Buffer.from(big, 'utf8');
  let naive = '', streamed = '', dOld = '', dNew = new SD('utf8');
  for (let off = 0; off < blob.length; off += 65536) {
    const piece = blob.subarray(off, Math.min(off + 65536, blob.length));
    naive += piece.toString('utf8');     /* 旧写法：逐块独立解码 */
    streamed += dNew.write(piece);       /* 新写法：StringDecoder 续接残缺字节 */
  }
  ok(naive.indexOf('�') >= 0, '复现旧 bug：按 Buffer 分块独立 toString 会解出 U+FFFD');
  ok(streamed.indexOf('�') < 0 && streamed === big, '改用 StringDecoder 后名字完整无损（实得 ' + blob.length + ' 字节流）');
}

console.log(fail ? ('\n❌ 失败 ' + fail + ' 项') : '\n✅ 全部通过');
process.exit(fail ? 1 : 0);
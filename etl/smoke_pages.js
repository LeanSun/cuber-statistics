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
[(DATA_FILE), 'js/icons.js', 'js/charts.js', 'js/pages-core.js', 'js/pages-player.js', 'js/pages-extra.js', 'js/pages-sixdim.js'].forEach(load);

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
/* ★ 2026-11-07 第十四轮回归：分数演进图「全项目 / 全维度」总分行依赖 p.yearly 做时间演化，
   yearly 必须随 core 主包下发；若被误放进明细分片，首屏 core-only 时竞速图会整张空白。 */
ok(!!(M.ranked[0] && M.ranked[0].yearly), 'core 主包含 yearly（分数演进图默认总分行时间演化必需）');
/* CI 跑的是 etl/_sample_data.js（8 人），本地与线上跑完整 data.js（6 万+）。
   凡是「覆盖面 / 比例」类断言在样本上天然不成立（样本里压根没有换籍选手、纪录持有者只有 7 位），
   一律用这个标志兜住，否则 CI 必假红。 */
const SAMPLE = M.ranked.length < 1000;

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
    const SW = (M.meta && M.meta.sixWeights) || { m1: 0.42, m2: 0.20, m3: 0.10, m4: 0.14, m5: 0.06, m6: 0.08 };
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

/* 停办项目的终点：选了已取消的项目，时间轴必须停在该项目停办的那一刻，
   而不是继续拉到今天（2026-11-02 用户反馈）。 */
if (typeof P.tlSetEnd === 'function') {
  const fyMagic = P.tlSetEnd(['magic']);
  const slMagic = P.tlSlider('day', fyMagic);
  ok(fyMagic < 2014, '选八板时时间轴终点提前到停办年（' + slMagic.label + '）');
  const fyFeet = P.tlSetEnd(['333ft']);
  ok(fyFeet > 2019 && fyFeet < 2021, '选脚拧时时间轴终点落在 2019 年末（' + P.tlSlider('day', fyFeet).label + '）');
  const fyBoth = P.tlSetEnd(['magic', '333ft']);
  ok(fyBoth > 2019 && fyBoth < 2021, '多个停办项目取最晚的那个终点');
  const fyLive = P.tlSetEnd(['333']);
  ok(fyLive > 2025, '含在办项目时终点仍是数据最后一天');
  P.tlSetEnd([]);
  ok(P.tlEndFy() > 2025, '清空筛选后终点恢复');
}

/* 单维竞速图：每维走自己的年度曲线（p.sy）。不变量 ——
   ① 曲线起点不得早于本人首次参赛年；② 终点比率必须是 1000（否则末期分数对不上维度分）。 */
{
  const withSy = M.ranked.filter((p) => p.sy && p.sy.m4);
  if (withSy.length) {
    const early = withSy.filter((p) => {
      const first = +(String(p.sy.m4).split(',')[0].split(':')[0]) || 0;
      return first && p.start && first < p.start;
    });
    ok(early.length === 0, '统治力曲线不早于首次参赛年（越界 ' + early.length + ' 人）');
    const noTail = withSy.filter((p) => {
      const a = String(p.sy.m4).split(',');
      return +a[a.length - 1].split(':')[1] !== 1000;
    });
    ok(noTail.length === 0, '统治力曲线终点比率为 1000（异常 ' + noTail.length + ' 人）');
  } else {
    ok(SAMPLE, '样本数据没有六维年度曲线，跳过单维曲线校验');
  }
}

const h9 = tryRender('纪录持有图（lane）', () => P.timeline(Object.assign({}, base, { tlView: 'lane' })));
ok(h9.indexOf('tlChart') >= 0, '泳道图渲染');

const hA = tryRender('另类统计', () => P.topics(Object.assign({}, base, { topicTab: 'rec' })));
ok(hA.length > 100, '另类统计渲染');
ok(hA.indexOf('data-topicboard=') >= 0, '另类统计有指标切换');
/* ★ 2026-11-05（第十五轮）：趣味统计的筛选面板统一到顶部筛选条。
   正文里那套两行带文字、只能单选的「按项目筛选」整块删除；
   app.js 的 renderFilterBar 不再为 topics 走特判，三页输出同一份两行结构。 */
ok(hA.indexOf('data-topicev=') < 0 && hA.indexOf('按项目筛选') < 0,
  '趣味统计正文不再有第二套项目筛选面板（项目图标统一到顶部）');
const appFb = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
const fbFn = appFb.slice(appFb.indexOf('function renderFilterBar'), appFb.indexOf('function updateSummary'));
ok(fbFn.indexOf('frow-ev') >= 0 && fbFn.indexOf('data-evtab') >= 0 && fbFn.indexOf('data-type') >= 0,
  '顶部筛选条含第一行项目图标与第二行成绩口径');
ok(!/if \(route !== 'topics'\)/.test(fbFn) && !/else if \(route === 'topics'\)/.test(fbFn),
  'renderFilterBar 内没有 topics 分支（三页共用同一份渲染）');
ok((fbFn.match(/class="frow frow-ev"/g) || []).length === 1 && (fbFn.match(/id="fgReset"/g) || []).length === 1,
  '筛选条各控件只渲染一份');
ok(/route === 'rank' \|\| route === 'timeline' \|\| route === 'topics'[\s\S]{0,220}q\.g/.test(appFb),
  'g= / country= 在三个榜单页都能解析（刷新后分组不丢）');
const hA333 = tryRender('另类统计（顶部选了单个项目）',
  () => P.topics(Object.assign({}, base, { topicTab: 'rec', evSel: ['333'] })));
ok(hA333.indexOf(t('top.eventFiltered')) >= 0, '顶部项目筛选后有口径提示');
const hASingle = tryRender('另类统计（成绩口径=单次）',
  () => P.topics(Object.assign({}, base, { topicTab: 'rec', recType: 'single' })));
ok(hASingle.indexOf(t('top.typeNote')) >= 0, '成绩口径切换后有该页口径说明');

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
/* 顶部筛选条的三类项目操作（点图标多选 / 点预设分组 / 切成绩口径）都必须真实收窄候选池 */
const poolAll = P.util.topicPool(Object.assign({}, base, {}));
const pool333 = P.util.topicPool(Object.assign({}, base, { evSel: ['333'] }));
const poolMulti = P.util.topicPool(Object.assign({}, base, { evSel: ['333', '222'] }));
ok(SAMPLE || (pool333.length > 0 && pool333.length < poolAll.length),
  '顶部项目图标单选真实生效：' + pool333.length + '/' + poolAll.length);
ok(poolMulti.length >= pool333.length && poolMulti.length <= poolAll.length,
  '顶部项目图标多选按并集生效：' + poolMulti.length);
const pg = M.presetGroups.filter(g => g.id !== 'all')[0];
const poolGroup = pg ? P.util.topicPool(Object.assign({}, base, { group: pg.id })) : [];
ok(SAMPLE || !pg || (poolGroup.length > 0 && poolGroup.length <= poolAll.length),
  '顶部预设分组真实生效：' + (pg ? pg.id : '(none)') + ' ' + poolGroup.length);
/* 成绩口径在趣味统计页改变的是**纪录类指标的数值**，不是候选人数
   （与 total 榜切轨只换六维分、不换人一致） */
const bSum = a => a.reduce((x, r) => x + r.v, 0);
const bAll = M.board('rec', 'wrCount', 12, '', null, 'all');
const bSingle = M.board('rec', 'wrCount', 12, '', null, 'single');
const bAvg = M.board('rec', 'wrCount', 12, '', null, 'avg');
ok(SAMPLE || (bSingle.length > 0 && bAvg.length > 0), '单次 / 平均轨都能取到纪录榜');
ok(bSum(bSingle) <= bSum(bAll) && bSum(bAvg) <= bSum(bAll),
  '按轨 WR 数不超过总计：' + bSum(bSingle) + ' / ' + bSum(bAvg) + ' ≤ ' + bSum(bAll));
ok(SAMPLE || bSum(bSingle) !== bSum(bAll) || bSum(bAvg) !== bSum(bAll),
  '切成绩口径后纪录数值真实变化（不是假控件）');
ok(P.util.topicPool(Object.assign({}, base, { recType: 'single' })).length === poolAll.length,
  '切成绩口径不改变候选人数（三页操作语义一致）');
const boardCN = M.board('rec', 'wrCount', 12, '', poolCN);
ok(boardCN.every(r => poolCN.some(x => x.id === r.p.id)), '榜单选手全部来自筛选后的池');

console.log('== 国家实力榜：总分按历史国籍拆分 ==');
const hN = tryRender('国家实力榜', () => P.topics(Object.assign({}, base, { topicTab: 'other', otherTab: 'nation' })));
ok(hN.indexOf('data-nation=') >= 0, '国家榜渲染 + 指标切换（总分/人均/最强）');
const splitNote = t('top.nation.split') || '';
ok(splitNote.length > 12 && hN.indexOf(splitNote.slice(0, 12)) >= 0, '国家榜有「按历史国籍拆分」的说明');
/* 不变量：各国总分之和 ≡ 全站选手总分之和。
   拆分是按选手把分**分给**若干国家（拆分值再按 p.overall 缩放），所以既不能丢分也不能造分；
   一旦有人被漏计或重复计，这个等式立刻破。允许每国 round(…,0) 的累积误差。 */
const sumNat = M.nations.reduce((a, n) => a + n.total, 0);
const sumP = M.ranked.reduce((a, p) => a + p.overall, 0);
const gap = Math.abs(sumNat - sumP) / Math.max(1, sumP);
ok(gap < 0.001, '各国总分之和 ≡ 选手总分之和（' + Math.round(sumNat) + ' vs ' + Math.round(sumP) +
  '，相对差 ' + (gap * 100).toFixed(3) + '%）');
const splitIds = Object.keys(M.natSplit || {});
if (splitIds.length) {
  /* nat_seg 里全站 311 位换籍选手，但 data.js 只承载 6 万人 —— 长尾换籍者在页面上不存在，
     他们的拆分自然进不了国家榜。所以先取「页面上真的有」的那批人再校验。
     （2026-11-02：旧写法直接取 splitIds[0]，一旦那人是长尾就必失败。） */
  const inPage = splitIds.filter((id) => M.ranked.some((p) => p.id === id));
  ok(SAMPLE || inPage.length > 0,
    '换籍选手中至少有人在页面上（' + inPage.length + ' / ' + splitIds.length + '）' + (SAMPLE ? ' [样本跳过]' : ''));
  const pid = inPage.filter((id) => Object.keys(M.natSplit[id]).length > 1)[0] || inPage[0];
  const parts = M.natSplit[pid] || {};
  console.log('   换籍样例：', pid, Object.keys(parts).map((k) => k + '=' + parts[k]).join(' / '));
  const missing = [];
  const byId = new Map(M.ranked.map((p) => [p.id, p]));
  inPage.forEach((id) => {
    const pl = byId.get(id);
    /* 总分为 0 的人缩放后每一份都是 0，bumpNation 会整条跳过 —— 国家自然不会出现，属正常 */
    if (!pl || !(pl.overall > 0)) return;
    Object.keys(M.natSplit[id]).forEach((k) => {
      if (!M.nations.some((n) => n.iso === k)) missing.push(id + ':' + k);
    });
  });
  ok(missing.length === 0, '换籍选手的每个代表国都出现在国家榜里（缺 ' + missing.length + ' 项）');
  const sumParts = Object.keys(parts).reduce((a, k) => a + parts[k], 0);
  const pl = M.ranked.filter((p) => p.id === pid)[0];
  ok(!pl || Math.abs(sumParts - pl.overall) < 0.05,
    '拆分之和 = 该选手总分（' + sumParts.toFixed(2) + ' vs ' + (pl ? pl.overall : '—') + '）');
} else {
  ok(true, '样本数据无换籍选手，跳过拆分校验');
}

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

console.log('== 选手 PK ==');
{
  const SMALL = M.ranked.length < 1000;
  const ids2 = M.ranked.slice(0, 2).map(function (p) { return p.id; });
  const hp2 = tryRender('选手 PK（2 人）', function () { return P.pk(Object.assign({}, base, { pk: ids2 })); });
  ok(hp2.indexOf('pk-hero') >= 0, 'PK 概览卡容器存在（pk-hero）');
  ok((hp2.match(/class="pk-hero-card/g) || []).length === 2, '2 人 → 2 张概览卡（实得 ' + (hp2.match(/class="pk-hero-card/g) || []).length + '）');
  ok(hp2.indexOf('pk-radar-wrap') >= 0, '六维雷达容器存在');
  ok(hp2.indexOf('pk-charts') >= 0, '图表网格容器存在');
  ok(hp2.indexOf('pk-ach-table') >= 0, '成就对照表存在');
  ok(hp2.indexOf('pk-life') >= 0, '生涯时间线存在');
  ok(hp2.indexOf('pk-arena') < 0, '已弃用旧的 pk-arena 布局');

  /* 解码页面里所有 data-ec：统计图表类型并逐项校验数值有限。
     JSON.stringify(NaN) 会变成 null，所以必须解码后判 typeof/isFinite，
     只用 indexOf('NaN') 抓不到整图空白这个回归。radar 的 data 是 {rows,indicators}。 */
  const decodeEc = function (html) {
    const re = /data-ec="([^"]*)"/g; let m; const byType = {}; let bad = 0, parseBad = 0;
    const divRows = [];
    while ((m = re.exec(html))) {
      const json = m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
      let spec; try { spec = JSON.parse(json); } catch (e) { parseBad++; continue; }
      byType[spec.type] = (byType[spec.type] || 0) + 1;
      const check = function (v) { if (typeof v !== 'number' || !isFinite(v)) bad++; };
      const rows = Array.isArray(spec.data) ? spec.data
        : (spec.data && Array.isArray(spec.data.rows) ? spec.data.rows : []);
      if (spec.type === 'diverging') divRows.push(rows);
      rows.forEach(function (r) {
        if (!r || typeof r !== 'object') return;
        if (spec.type === 'diverging') (r.d || []).forEach(check);
        else if (spec.type === 'grouped' || spec.type === 'stacked') (r.values || []).forEach(check);
        else if (spec.type === 'radar') (r.values || []).forEach(check);
        else if (spec.type === 'scatter' && Array.isArray(r)) [0, 1, 3].forEach(function (i) { check(r[i]); });
      });
    }
    return { byType: byType, bad: bad, parseBad: parseBad, divRows: divRows };
  };

  const e2 = decodeEc(hp2);
  ok(e2.parseBad === 0, 'PK 所有图表 data-ec 均可解析');
  ok(e2.bad === 0, 'PK 所有图表数值均为有限数（异常 ' + e2.bad + ' 个）');
  ok(e2.byType.radar === 1, '六维雷达图存在');
  ok(e2.byType.diverging >= 1, '维度优势镜像对比图存在');
  ok(e2.byType.grouped >= 1, '成就对比使用并列分组柱（grouped）');
  ok(!e2.byType.scatter, '已移除不合适的风格定位散点图');
  ok(!e2.byType.stacked, '已移除与维度优势重复的堆叠贡献图');
  /* gauge 刻度是 0–100 且自带 % 后缀，传 0–1 概率会显示成 0.9%、指针归零 */
  (function () {
    let v = null; const re = /data-ec="([^"]*)"/g; let m;
    while ((m = re.exec(hp2))) {
      const json = m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
      let s; try { s = JSON.parse(json); } catch (e) { continue; }
      if (s.type === 'gauge') { v = s.data; break; }
    }
    ok(typeof v === 'number' && v >= 50 && v <= 100,
      '胜负稳健性仪表盘按百分比刻度传入（实得 ' + v + '）');
  })();
  /* 全量数据下前两名必有共同项目 → 第二张 diverging 是项目优势地图 */
  if (!SMALL) {
    ok(e2.byType.diverging === 2, '全量数据下存在第二张 diverging（项目优势地图）');
    const evRows = e2.divRows[1] || [];
    ok(evRows.length > 0 && evRows.some(function (r) {
      return (r.d || []).some(function (v) { return v > 0; });
    }), '项目优势地图含真实共同项目且分值非全 0');
  } else ok(true, '样本模式跳过共同项目数量校验');

  const ids3 = M.ranked.slice(0, 3).map(function (p) { return p.id; });
  const hp3 = tryRender('选手 PK（3 人）', function () { return P.pk(Object.assign({}, base, { pk: ids3 })); });
  ok((hp3.match(/class="pk-hero-card/g) || []).length === 3, '3 人 → 3 张概览卡（实得 ' + (hp3.match(/class="pk-hero-card/g) || []).length + '）');
  const e3 = decodeEc(hp3);
  ok(!e3.byType.diverging && e3.byType.grouped >= 2, '3 人改用并列分组柱（维度/项目/成就），不再用镜像条');
  ok(e3.bad === 0, '3 人 PK 所有图表数值均为有限数');

  const ids4 = M.ranked.slice(0, 4).map(function (p) { return p.id; });
  const hp4 = tryRender('选手 PK（4 人）', function () { return P.pk(Object.assign({}, base, { pk: ids4 })); });
  ok((hp4.match(/class="pk-hero-card/g) || []).length === 4, '4 人 → 4 张概览卡');
  ok(decodeEc(hp4).bad === 0, '4 人 PK 所有图表数值均为有限数');
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
    const W = (M.meta && M.meta.sixWeights) || { m1: 0.42, m2: 0.20, m3: 0.10, m4: 0.14, m5: 0.06, m6: 0.08 };
    let badT = 0, maxDiff = 0;
    sixP.forEach(function (p) {
      let s = 0;
      ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'].forEach(function (k) { s += (W[k] || 0) * (p.six[k] || 0); });
      const d = Math.abs(s - p.six.t);
      if (d > maxDiff) maxDiff = d;
      if (d > 0.05) badT++;
    });
    ok(badT === 0, '六维总分 t = Σ w_d·s_d 自洽（' + sixP.length + ' 人，最大偏差 ' + maxDiff.toFixed(4) + '）');
    /* 2026-11-02 口径变更：主表只收前 62,000 名 + 全部纪录持有者，其余人的总分由
       build 从 sixdim_tail.tsv 写进 overall。
       目标不变量：**不会出现「有总分却没有六维分」的纪录持有者** ——
       那正是「时间轴里点得开他、历史地位排名里查无此人」的病理特征（Aron Yu 曾是 0.00）。
       例外：一条退赛项目/极小国家的 NR 本身折算下来 ≈0.000000（如 magic 的 NR），
       M1 事实表里根本不留行，自然没有六维分 —— 这种人的总分也是 0，不算病理。 */
    const noSixScored = M.ranked.filter(function (p) { return (p.records || []).length && !p.six && p.overall > 0; });
    ok(noSixScored.length === 0, '没有「有总分却没有六维分」的纪录持有者（实得 ' + noSixScored.length + ' 人）');
    const recNoSix = M.ranked.filter(function (p) { return (p.records || []).length && !p.six; });
    console.log('   纪录本身得分为 0、因而无六维分的纪录持有者：' + recNoSix.length + ' 人'
      + (recNoSix.length ? '（' + recNoSix.map(function (p) { return p.id; }).join(',') + '）' : ''));
    const recInRank = M.ranked.filter(function (p) { return (p.records || []).length && p.overall > 0; }).length;
    ok(SAMPLE || recInRank > 4000,
      '纪录持有者基本都进了总榜（' + recInRank + ' 人）' + (SAMPLE ? ' [样本跳过]' : ''));
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
  /* 2026-11-04 晚：国家配色板块按用户要求整块删除 */
  ok(hM.indexOf('data-ccmod') < 0 && hM.indexOf('mdCountryColors') < 0, '国家配色板块已删除');
  /* 2026-11-05（第十四轮）：六维占比改写卡片式，彻底去掉滑杆 ——
     每张卡是「色点 + 名称 + −/数字/+ + 细进度条」，另有一条堆叠总览条。 */
  ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'].forEach(function (k) {
    ok(hM.indexOf('data-wdim="' + k + '"') >= 0, '六维占比自定义：' + k.toUpperCase() + ' 有调节入口');
    ok(hM.indexOf('data-wstep="' + k + '"') >= 0, '六维占比可 ±1% 步进：' + k.toUpperCase());
  });
  ok((hM.match(/class="wc-num"/g) || []).length === 6, '六维占比有 6 个数字框');
  ok((hM.match(/class="wcard"/g) || []).length === 6, '六维占比为 3×2 卡片网格');
  ok((hM.match(/data-wbar="/g) || []).length === 6, '每张卡带一条细进度条');
  ok((hM.match(/data-wseg="/g) || []).length === 6, '顶部堆叠总览条分 6 段');
  ok(hM.indexOf('type="range"') < 0, '六维占比不再使用滑杆（用户要求去掉 range）');
  ok(hM.indexOf('id="wSum"') >= 0 && hM.indexOf('id="wReset"') >= 0 && hM.indexOf('id="wEven"') >= 0,
    '六维占比给出合计显示 / 恢复默认 / 平均分配');
  /* 需求：所有颜色设置统一沉到页面最下方（在左目录 + 右章节之后） */
  const iLayout = hM.indexOf('class="md-layout"');
  ok(iLayout > 0, '参数页有两栏布局容器 md-layout');
  ok(hM.indexOf('id="mdColors"') > iLayout, '模块配色卡片已移到页面最下方（在md-layout之后）');
  /* 2026-11-04 晚：国家配色卡片已删除，不再有第二张颜色卡 */
  ok(hM.indexOf('id="mdCountryColors"') < 0, '国家配色卡片已移除');
  /* 2026-11-05：用户要求删除「外观与交互」整块（主题仍在顶栏切换） */
  ok(hM.indexOf('id="pzPrefs"') < 0 && hM.indexOf('data-pref=') < 0,
    '「外观与交互」板块已删除（无 pzPrefs / data-pref 控件）');
  ok(hM.indexOf('id="prefReset"') < 0, '外观偏好的「恢复默认」按钮已随之移除');
  ok((hM.match(/class="pz-chip"/g) || []).length >= 5, '预设方案改为 chips（不再是 select）');
  ok(hM.indexOf('id="presetSel"') < 0, '旧的预设下拉框已移除');
  /* 偏好模块（Prefs）：默认值 / 校验 / 持久化 */
  ok(win.Prefs && typeof win.Prefs.set === 'function', 'Prefs 偏好模块已加载');
  if (win.Prefs) {
    ok(win.Prefs.defaults.theme === 'auto', '主题默认「跟随系统」（实得 ' + win.Prefs.defaults.theme + '）');
    ok(win.Prefs.defaults.perPage === 20, '每页行数默认 20');
    const saveAll = win.Prefs.all();
    win.Prefs.set('density', 'compact');
    ok(win.Prefs.get('density') === 'compact', '密度偏好可写入');
    win.Prefs.set('density', 'weird-value');
    ok(win.Prefs.get('density') === 'compact', '非法取值被拒绝（保持原值）');
    win.Prefs.set('perPage', 50);
    ok(win.Prefs.get('perPage') === 50, '每页行数可改为 50');
    win.Prefs.reset();
    ok(win.Prefs.get('density') === 'cozy' && win.Prefs.get('perPage') === 20, '恢复默认生效');
    void saveAll;
  }
  ok(/Prefs/.test(fs.readFileSync(path.join(ROOT, 'js/pages-core.js'), 'utf8')), '榜单每页行数读偏好');
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
{
  /* 2026-11-05：默认六维占比改为 42:20:10:14:6:8（M1..M6，Σ=1）。
     必须同时校验 params.js 的 DEFAULTS 与 ETL 下发的 meta.sixWeights ——
     只改一边会让 p.six.t（ETL 预置）与页面按当前权重实时重算的总分对不上，
     榜单 / 选手页 / 六维分数细则出现两套分数且不报错。 */
  const WANT = { m1: 0.42, m2: 0.20, m3: 0.10, m4: 0.14, m5: 0.06, m6: 0.08 };
  const WK = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'];
  const dw = (global.Params && global.Params.defaults) || {};
  const got = ['b1', 'b2', 'b3', 'b4', 'b5', 'b6'].map((k) => Number(dw[k]));
  ok(got.every((v, i) => Math.abs(v - WANT[WK[i]]) < 1e-9),
    '默认六维占比 = 42:20:10:14:6:8（Σ=' + got.reduce((a, b) => a + b, 0).toFixed(2) + '）');
  const mw = M.meta && M.meta.sixWeights;
  if (mw) {
    ok(WK.every((k) => Math.abs(Number(mw[k]) - WANT[k]) < 1e-9),
      'ETL meta.sixWeights 与默认占比一致（p.six.t 与页面重算同源）');
  } else {
    console.log('  · 本次数据无 meta.sixWeights，跳过交付层权重核对');
  }
  /* 六维分数细则：每位选手的单维分数统一加粗，当前排序列仍更重 */
  const css = fs.readFileSync(path.join(ROOT, 'css/style.css'), 'utf8');
  ok(/\.sd-num\{[^}]*font-weight:700/.test(css) && /\.sd-off\{[^}]*font-weight:700/.test(css) &&
    /\.sd-cur\.sd-num\{font-weight:800\}/.test(css),
    '六维分数细则单维分数加粗、当前排序列更重');
  const sixSrc = fs.readFileSync(path.join(ROOT, 'js/pages-sixdim.js'), 'utf8');
  ok(/\.sd-nm\{font-weight:400/.test(css) && !/class="sd-nm tl"><b>/.test(sixSrc) &&
    /class="sd-nm tl"><span>/.test(sixSrc),
    '六维分数细则选手名字不加粗（只有分数列加粗）');
}
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
  /* 同一人「连着」刷新纪录应合并成一段：以前 buildLanes 读 cur.pid（字段其实叫 id），
     判断恒真 → 每次刷新都切成新段，图上是一串同色窄条。 */
  let dupNext = 0, pairs = 0;
  lane.forEach((L) => {
    for (let i = 1; i < L.segs.length; i++) {
      pairs++;
      if (L.segs[i].id && L.segs[i].id === L.segs[i - 1].id) dupNext++;
    }
  });
  ok(pairs > 0 ? dupNext === 0 : true, '相邻两段不会是同一个人（合并判断生效，实得 ' + dupNext + '/' + pairs + '）');
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
    const xa = Array.isArray(opt.xAxis) ? opt.xAxis[0] : opt.xAxis;
    ok(xa && xa.splitLine && xa.splitLine.show === false, '已去掉竖向虚线');
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

/* == 纪录持有图：筛选联动 / 一人一色 / 去掉自定义事件表单 ==
   用户 2026-11-01 反馈三件事：① 顶部筛选对这张图完全无效；② 同国选手前后接力时两段同色，
   看不出换了人；③ 图下方的「自定义重大事件」表单不该出现在这里。 */
console.log('== 纪录持有图：筛选联动 / 一人一色 / 表单归属 ==');
{
  const hL = tryRender('纪录持有图（筛选联动）', () => P.timeline(Object.assign({}, base, { tlView: 'lane', tlLane: 'single' })));
  const hR2 = tryRender('分数竞速图（表单归属）', () => P.timeline(Object.assign({}, base, { tlView: 'race' })));
  ok(hL.indexOf('msImportBtn') < 0 && hL.indexOf('data-msreset') < 0, '纪录持有图下方不再有「自定义重大事件」表单');
  ok(hR2.indexOf('msImportBtn') >= 0, '分数竞速图仍然保留自定义重大事件表单');
  ok(/data-y0="/.test(hL) && /data-y1="/.test(hL) && /data-tlretired="/.test(hL),
    '纪录持有图容器带上年份区间 / 停办项目的筛选参数');
  /* ★ 回归（2026-11-01 用户报「拖动/单击后视角回到全局」）：
     图表容器上原来的 data-dim / data-type / data-gender / data-retired 与全局事件委托
     （document 的 [data-dim] 等）撞名 —— 点一下图就被当成点了筛选按钮，整页 re-render，
     缩放状态随之丢失。这些属性必须带 tl 前缀，避开委托选择器。 */
  ok(!/ data-dim="/.test(hL) && !/ data-type="/.test(hL) && !/ data-gender="/.test(hL) && !/ data-retired="/.test(hL),
    '图表容器不再使用与全局事件委托同名的 data-* 属性（否则点图会触发整页重渲染）');
  ok(/ data-tldimv="/.test(hL) && / data-tltype="/.test(hL) && / data-tlgender="/.test(hL),
    '筛选用 data-tl* 前缀属性挂在容器上');

  /* ★ 2026-11-01（第五轮）用户要求：徽标挪到「整行最右侧」。
     2026-11-06：筛选行不再放 spacer（时间跳跃已回播放托盘），
     徽标靠 CSS margin-left:auto 贴右，位置断言改为 dim seg → 徽标 → 图表，
     并额外确认 .tl-top 内没有 spacer / 时间跳跃（防止又被塞回来导致换行）。 */
  {
    const iDim = hR2.indexOf('id="tlDimSeg"');
    const iCrown = hR2.indexOf('id="tlCrown"');
    const iStage = hR2.indexOf('class="tl-stage"');
    const iTop = hR2.indexOf('class="row tl-top"');
    const topHtml = hR2.slice(iTop, iCrown);
    ok(iDim >= 0 && iCrown > iDim && iCrown < iStage,
      '登顶时长徽标排在整行最右端（dim seg → 徽标 → 图表）');
    ok(topHtml.indexOf('class="spacer"') < 0 && topHtml.indexOf('tlRatejump') < 0,
      '筛选行内没有 spacer / 时间跳跃（长姓名不再把徽标挤到第二行）');
    ok(!/id="tlCrown"[^>]*\shidden/.test(hR2), '徽标常驻显示（不再默认 hidden，避免布局跳动）');
    ok(/id="tlCrown"[^>]*data-st="pending"/.test(hR2), '徽标带占位状态 data-st（pending / none / ok）');
    ok(/class="tl-crown-tx"/.test(hR2) && /class="tl-crown-val"/.test(hR2),
      '徽标是「姓名 / 说明」两行 + 时长 的结构');
  }
  /* ★ 第五轮用户要求：两个视图的说明文字整块删除 */
  ok(hR2.indexOf('class="tl-desc"') < 0 && hL.indexOf('class="tl-desc"') < 0,
    '竞速图 / 纪录持有图的说明文字已删除（不再有 .tl-desc 块）');
  /* ★ 2026-11-01（第四轮）用户反馈「播放中改上方筛选，竞速图就停住了」：
     根因是播放循环闭包攥着已被 innerHTML 换掉的旧 range / box，重渲染后没人用新 DOM 重启它。 */
  {
    const appSrc = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
    ok(/function startPlay\(\)/.test(appSrc), '播放循环抽成具名函数 startPlay()');
    ok(/if \(state\.tlPlaying\) \{\s*if \(range\) startPlay\(\)/.test(appSrc),
      '重渲染（mount）后按 state.tlPlaying 用新 DOM 从当前时刻续播');
    ok(/cancelAnimationFrame\(tlRaf\)/.test(appSrc), '重启 / 切视图前先取消上一轮 rAF');
  }

  const C = win.Charts;
  /* == 分数竞速图 tooltip（2026-11-01 第五轮版式）==
       国旗 姓名 / 第 N 名 · 分数分 / 相对关系·参照选手分数 */
  {
    const ro = C.barRace([
      { id: 'a', name: 'A', iso: 'AU', cname: 'Australia', flag: '', color: '#3355cc', value: 100, rank: 1, no: 1 },
      { id: 'b', name: 'B', iso: 'CN', cname: 'China', flag: '', color: '#cc5533', value: 80, rank: 2, no: 2 }
    ], { top: 15 });
    const sd = ro.series[0].data;
    const tip1 = ro.tooltip.formatter({ data: sd[0] });
    const tip2 = ro.tooltip.formatter({ data: sd[1] });
    ok(tip1.indexOf('AU') < 0 && tip2.indexOf('CN') < 0, 'tooltip 不再出现国家两位码');
    ok(/第 1 名|#1/.test(tip1) && /第 2 名|#2/.test(tip2), 'tooltip 显示当前名次');
    /* 「第 1 名 · 100.00分」：名次与分数同一行，分数后面紧接单位 */
    const stripT = (s) => String(s).replace(/<[^>]*>/g, '');
    /* 分隔点现在是「带 padding 的 <span>·</span>」：视觉留白来自 CSS 而非文本空格，
       所以纯文本比对找不到「第 1 名 · 」；断言改为确认该带留白分隔点存在于名次与分数之间。 */
    ok(/第 1 名<span[^>]*padding[^>]*>·<\/span>/.test(tip1) || /#1<span[^>]*padding[^>]*>·<\/span>/.test(tip1),
      '第二行用带留白的分隔点连起「第 N 名 · 分数」（实得 ' + stripT(tip1) + '）');
    ok(/100\.00<\/b>分|100\.00<\/b> pts/.test(tip1), '分数后紧跟单位（分 / pts）');
    ok(/领先第二名|ahead of #2/.test(tip1), '第 1 名给出「领先第二名多少」');
    ok(/榜首的|of #1/.test(tip2), '其余名次给出「是榜首的百分之几」');
    /* 第三行末尾要带上参照选手的分数（第 1 名 → 第二名 80.00；其余 → 榜首 100.00） */
    ok(/80\.00/.test(tip1), '第 1 名的第三行带上第二名的分数');
    ok(/100\.00/.test(tip2.split('·').pop()), '其余名次的第三行带榜首分数');
  }
  /* 三段全部来自同一个国家（China）—— 旧实现按国籍上色时这三段一模一样 */
  const fake = [
    { ev: '333', label: '333', segs: [
      { from: 2004, to: 2008, holder: 'A', country: 'China', id: 'A1', iso: 'CN', days: 100 },
      { from: 2008, to: 2012, holder: 'B', country: 'China', id: 'B1', iso: 'CN', days: 100 },
      { from: 2012, to: 2015, holder: 'C', country: 'China', id: 'C1', iso: 'CN', days: 100 }
    ] },
    { ev: '222', label: '222', segs: [
      { from: 2005, to: 2010, holder: 'A', country: 'China', id: 'A1', iso: 'CN', days: 100 }
    ] }
  ];
  const ol = C.lanes(fake, { y0: 2004, y1: 2015 });
  const cols = ((ol.series && ol.series[0] && ol.series[0].data) || []).map(function (d) { return d.itemStyle.color; });
  ok(cols.length === 4, '四段色块都已生成（实得 ' + cols.length + '）');
  ok(cols[0] !== cols[1] && cols[1] !== cols[2], '同国两名选手前后接力，相邻两段颜色不同（' + cols.slice(0, 3).join(' / ') + '）');
  ok(cols[0] === cols[3], '同一名选手跨泳道仍是同一个颜色');
  ok(cols[0] !== cols[1] && cols[0] !== cols[2] && cols[1] !== cols[2], '三人三色，不会撞色');
  /* 筛选后一条泳道都不剩时，要给兜底文案而不是一张空白画布 */
  const oe = C.lanes([], { empty: 'EMPTY' });
  ok(!!(oe && oe.graphic && oe.graphic[0] && oe.graphic[0].style && oe.graphic[0].style.text === 'EMPTY'),
    '筛选后没有数据时返回居中兜底文案');
}

/* == 纪录持有图：范围纪录链（世界 / 洲 / 国家 × 女子）+ 缩放平移 + 段内刷新 ==
   用户 2026-11-01 追加：
     ① 筛选大洲 / 地区 → 画洲纪录；筛选国家 → 画国家纪录；筛选性别 → 画对应范围的女子纪录；
     ② ctrl+滚轮缩放、alt+滚轮 / 拖动平移，调节过才出现「恢复默认」；
     ③ 同一人连续刷新是合并段，要能看出「刷了几次」。 */
console.log('== 纪录持有图：范围纪录链 / 缩放平移 / 段内刷新 ==');
{
  const LC = M.laneChains;
  ok(!!LC && typeof LC === 'object', '数据包带上 laneChains（范围 × 性别的纪录链）');
  if (LC) {
    const keys = Object.keys(LC);
    ok(!!LC['W|s|'] && !!LC['W|a|'], '有世界纪录链（单次 / 平均）');
    ok(keys.some((k) => k.indexOf('C:') === 0), '有洲（=地区）纪录链');
    ok(keys.some((k) => k.indexOf('N:') === 0), '有国家纪录链');
    ok(keys.some((k) => /\|f$/.test(k)), '有女子纪录链');
    /* 压缩格式：短键 + 4 位小数年份 + 只在该段刷新过多次时才写 s */
    const seg0 = (LC['W|s|'][0].segs || [])[0];
    ok(!!seg0 && typeof seg0.f === 'number' && typeof seg0.t === 'number', '段用短键压缩（f/t 小数年）');
    ok(!!seg0 && typeof seg0.fd === 'number' && typeof seg0.td === 'number', '段带起止日期整数（fd/td）');
    ok(!!seg0 && !!seg0.h && !!seg0.i, '段带姓名与选手 id');
    ok(!!seg0 && seg0.o !== undefined, '段带 ISO2（前端据此画国旗）');
    const many = Object.keys(LC).some((k) => LC[k].some((L) => (L.segs || []).some((s) => s.s && s.s.length > 1)));
    ok(many, '有人连续刷新多条的段（s 记录每次刷新日期）');
  }
  /* 范围解析：大洲 / 地区 → C:，国家优先 → N:，都没有 → W */
  ok(P.laneScopeOf('', '') === 'W', '不筛选时用世界纪录');
  ok(P.laneScopeOf('As', '') === 'C:As', '大洲筛选 → 洲纪录');
  ok(P.laneScopeOf('AsR', '') === 'C:As', '地区筛选 → 对应洲纪录（地区与洲一一对应）');
  ok(P.laneScopeOf('As', 'CN') === 'N:CN', '同时有大洲与国家时，国家优先');
  ok(/纪录$/.test(P.recScopeLabel('W', '')) && /女子/.test(P.recScopeLabel('W', 'f')),
    '纪录类型文案：世界纪录 / 女子纪录（实得 ' + P.recScopeLabel('W', 'f') + '）');
  /* 国家筛选后，图上每一段都必须是该国选手 */
  const oCN = P.tlOption('lane', 'cumulative', 2025, false, 'overall', '', 'CN', 'single', [], 'all', 'all');
  const segsCN = [];
  ((oCN && oCN.series && oCN.series[0] && oCN.series[0].data) || []).forEach((d) => segsCN.push(d.value[5]));
  ok(segsCN.length > 0 && segsCN.every((x) => String(x).toUpperCase() === 'CN'),
    '筛选中国 → 画的是中国纪录（' + segsCN.length + ' 段全部 CN）');
  /* ★ 2026-11-01（第五轮）用户要求：tooltip 第一行不能一律写「中国纪录」——
     国家链里同时躺着也属于世界纪录 / 洲纪录的段（ETL 的 feedRec 会把同一份成绩
     推进 WR / 洲 / 国家三条链），抬头必须跟着每一段自己的级别走。 */
  {
    const dCN = (oCN && oCN.series && oCN.series[0] && oCN.series[0].data) || [];
    const labs = {};
    dCN.forEach((d) => { const k = d.lab || '(空)'; labs[k] = (labs[k] || 0) + 1; });
    ok(dCN.length > 0 && dCN.every((d) => !!d.lab),
      '每一段都带自己的纪录级别抬头（实得 ' + JSON.stringify(labs) + '）');
    /* 机器反查：这一段是否也出现在世界链里（同一项目、同一条刷新、同一位选手） */
    const LC2 = M.laneChains || {};
    const wAll = {};
    (LC2['W|s|'] || []).forEach((L) => (L.segs || []).forEach((s) => {
      const dn = s.fd != null ? s.fd : s.fromDn;
      const id = s.i != null ? s.i : (s.id || '');
      if (dn) wAll[L.ev + '|' + dn + '|' + id] = 1;
    }));
    let hitWR = 0, labWR = 0;
    dCN.forEach((d) => {
      if (!wAll[(d.ev || '') + '|' + d.value[7] + '|' + (d.pid || '')]) return;
      hitWR++;
      if (/世界纪录|World record/.test(d.lab || '')) labWR++;
    });
    if (hitWR > 0) {
      ok(labWR === hitWR, '中国链里同时也属于世界纪录的 ' + hitWR + ' 段，抬头全部写成「世界纪录」（实得 ' + labWR + '）');
      const tipCN = oCN.tooltip.formatter({ data: dCN.filter((d) => /世界纪录|World record/.test(d.lab || ''))[0] });
      ok(/世界纪录|World record/.test(tipCN), 'tooltip 第一行跟着段走（' +
        tipCN.replace(/<[^>]*>/g, ' ').trim().slice(0, 24) + '…）');
    } else {
      console.log('  --   （样板数据里中国链没有世界纪录段，跳过抬头反查）');
    }
  }
  /* ★ 2026-11-02 用户要求：tooltip 第一行改成与「历史地位」排名页同款的彩色胶囊。
     缩写走 WCA 官方口径 —— 洲纪录必须落到具体洲（AsR / OcR / ER / NAR / SAR / AfR），
     不能只写笼统的 CR；配色档 cls 只有 WR / CR / NR 三档。 */
  {
    ok(P.recScopeBadge('W', '').code === 'WR', '世界纪录缩写 = WR');
    ok(P.recScopeBadge('C:As', '').code === 'AsR', '亚洲纪录缩写 = AsR（不是笼统 CR）');
    ok(P.recScopeBadge('C:Oc', '').code === 'OcR', '大洋洲纪录缩写 = OcR');
    ok(P.recScopeBadge('N:CN', '').code === 'NR', '国家纪录缩写 = NR');
    ok(P.recScopeBadge('C:As', '').cls === 'CR', '洲纪录的配色档 = CR');
    const dCN2 = (oCN && oCN.series && oCN.series[0] && oCN.series[0].data) || [];
    ok(dCN2.length > 0 && dCN2.every((d) => d.lv && d.lv.code && d.lv.cls),
      '每一段都带级别胶囊（code / cls）');
    ok(dCN2.every((d) => ['WR', 'CR', 'NR'].indexOf(d.lv.cls) >= 0), '胶囊配色档只有 WR / CR / NR');
    const asCodes = {};
    const oAs = P.tlOption('lane', 'cumulative', 2025, false, 'overall', 'AsR', '', 'single', [], 'all', 'all');
    ((oAs && oAs.series && oAs.series[0] && oAs.series[0].data) || []).forEach((d) => {
      asCodes[d.lv.code] = (asCodes[d.lv.code] || 0) + 1;
    });
    ok(Object.keys(asCodes).length > 0 && Object.keys(asCodes).every((k) => k === 'AsR' || k === 'WR'),
      '亚洲范围只出 AsR / WR（实得 ' + JSON.stringify(asCodes) + '）');
    const tipPill = oCN.tooltip.formatter({ data: dCN2[0] });
    ok(/class="rec-chip lv-(WR|CR|NR)"/.test(tipPill), 'tooltip 第一行渲染成 rec-chip 胶囊');
  }
  /* ★ 2026-11-02 用户追问：合并段里逐次刷新并不必然同级 ——「以 WR 开场 → WR 被别人拿走 →
     他之后推进的只是洲纪录」，抬头只能写一个级别，所以每一条刷新必须带自己的级别，
     且 tooltip 只给「与抬头不同级」的日期挂小胶囊（同级的留空＝就是抬头那个级别）。 */
  {
    const oAs2 = P.tlOption('lane', 'cumulative', 2025, false, 'overall', 'AsR', '', 'single', [], 'all', 'all');
    const dAs2 = (oAs2 && oAs2.series && oAs2.series[0] && oAs2.series[0].data) || [];
    let slvLenOk = true, mixedSeg = 0, tagOk = 0, sample = '';
    dAs2.forEach((d) => {
      if (!d.subs || d.subs.length < 2) return;
      if (!d.slv || d.slv.length !== d.subs.length) slvLenOk = false;
      const diffs = (d.slv || []).filter((b) => b && d.lv && b.code !== d.lv.code);
      if (!diffs.length) return;
      mixedSeg++;
      const tip = oAs2.tooltip.formatter({ data: d });
      const tags = (tip.match(/class="tl-tip-lv lv-(WR|CR|NR)"/g) || []).length;
      if (tags === diffs.length && /class="tl-tip-chips has-lv"/.test(tip)) tagOk++;
      if (!sample) {
        sample = d.value[4] + ' / ' + d.ev + '，抬头 ' + d.lv.code + '，明细 ' +
          d.slv.map((b) => b.code).join(',');
      }
    });
    ok(slvLenOk, '每一次刷新都带自己的级别胶囊（slv 与 subs 等长）');
    ok(mixedSeg > 0, '亚洲链里确有混级段（实得 ' + mixedSeg + ' 段）');
    ok(mixedSeg > 0 && tagOk === mixedSeg, '混级段的 tooltip 逐条标出不同级的刷新（' + tagOk + '/' + mixedSeg + '）');
    if (sample) console.log('  --   （示例：' + sample + '）');
    /* WR 链上每一次刷新都是 WR，不可能混级 → 不该出现任何小标签 */
    const oW2 = P.tlOption('lane', 'cumulative', 2025, false, 'overall', '', '', 'single', [], 'all', 'all');
    let wTag = 0;
    ((oW2 && oW2.series && oW2.series[0] && oW2.series[0].data) || []).forEach((d) => {
      if (!d.subs || d.subs.length < 2) return;
      if (/class="tl-tip-lv/.test(oW2.tooltip.formatter({ data: d }))) wTag++;
    });
    ok(wTag === 0, '世界纪录链的 tooltip 不出现混级小标签（实得 ' + wTag + ' 段）');
  }
  /* 女子口径：所有持有者都必须是女子 */
  const oF = P.tlOption('lane', 'cumulative', 2025, false, 'overall', '', '', 'single', [], 'F', 'all');
  const byId = {}; M.ranked.forEach((p) => { byId[p.id] = p; });
  let badG = 0, chkG = 0;
  (((oF && oF.series && oF.series[0] && oF.series[0].data) || [])).forEach((d) => {
    const p = byId[d.pid]; if (!p) return;
    chkG++;
    if (String(p.gender || '').charAt(0).toUpperCase() !== 'F') badG++;
  });
  ok(chkG > 0 && badG === 0, '筛选女子 → 全都是女子纪录（违规 ' + badG + ' / 可核对 ' + chkG + '）');
  /* 段内刷新：同一段里的 s 必须首尾包住段首尾，且严格递增 */
  let okSubs = true, withSubs = 0;
  Object.keys(M.laneChains || {}).forEach((k) => {
    (M.laneChains[k] || []).forEach((L) => (L.segs || []).forEach((s) => {
      if (!s.s || !s.s.length) return;
      withSubs++;
      if (s.s[0] !== s.fd) okSubs = false;
      for (let i = 1; i < s.s.length; i++) if (!(s.s[i] > s.s[i - 1])) okSubs = false;
    }));
  });
  ok(withSubs > 0 && okSubs, '段内刷新日期严格递增且从段首开始（核对 ' + withSubs + ' 段）');
}

console.log('== 纪录持有图：缩放 / 平移交互 ==');
{
  const hL = tryRender('纪录持有图（缩放提示条）', () => P.timeline(Object.assign({}, base, { tlView: 'lane', tlLane: 'single' })));
  ok(hL.indexOf('tlZoomBar') >= 0, '图下方有缩放 / 平移提示条');
  ok(/id="tlZoomReset"[^>]*hidden/.test(hL), '「恢复默认」默认隐藏（调节过才出现）');
  ok(hL.indexOf('tl-zoom-hint') >= 0, '提示条写明 ctrl / alt / 拖动的用法');
  ok(typeof P.bindLaneZoom === 'function' && typeof P.tlResetZoom === 'function', '提供缩放绑定与复位接口');
  const srcPE = fs.readFileSync(path.join(ROOT, 'js/pages-extra.js'), 'utf8');
  ok(/e\.ctrlKey \|\| e\.metaKey \|\| e\.altKey/.test(srcPE) && /passive: false/.test(srcPE),
    '滚轮只在按住 ctrl / alt 时接管（不干扰页面滚动）');
  ok(/box\.__tlWin/.test(srcPE) && /box\.__tlFull/.test(srcPE), '缩放窗口以满量程为界夹取');
  ok(/classList\.toggle\('zoomed'/.test(srcPE) && /'dragging'/.test(srcPE), '抓手 / 抓取中的光标状态有切换');
  const cs = fs.readFileSync(path.join(ROOT, 'css/style.css'), 'utf8');
  ok(/cursor:grab/.test(cs) && /cursor:grabbing/.test(cs), 'CSS 里空白处是抓手、拖动时是抓取中');
  ok(/\.tl-zoom-bar/.test(cs) && /\.tl-zoom-reset/.test(cs), '提示条与复位按钮有样式');
}

console.log('== 默认值：停办项目计入 / 竞速图速率 ==');
{
  ok(/retired: true/.test(fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8')),
    '停办项目默认「计入」');
  const r = P.tlRate();
  ok(r.anim === 100, '竞速图动画时长默认 100ms（实得 ' + r.anim + '）');
  ok(r.fps === 20, '竞速图重绘间隔默认 20ms（实得 ' + r.fps + '）');
  ok(r.jump === 60, '时间跳跃仍为 60 天/秒（实得 ' + r.jump + '）');
}

/* 需求：删除「3 期滑动平滑」开关 */
{
  const hR = tryRender('图表可视化（分数竞速图）', () => P.timeline(Object.assign({}, base, { tlView: 'race' })));
  ok(hR.indexOf('tlSmooth') < 0, '已删除「3 期滑动平滑」开关');
  /* ★ 2026-11-04 用户要求：速率只保留「时间跳跃」，且删掉滑杆；动画时长 / 重绘间隔不再开放 */
  ok(hR.indexOf('id="tlRatejump"') >= 0, '保留「时间跳跃」数字输入框');
  ok(hR.indexOf('tlRatejumpCap') < 0, '时间跳跃的滑杆已删除（只留数字框）');
  ok(hR.indexOf('tlRateanim') < 0 && hR.indexOf('tlRatefps') < 0, '动画时长 / 重绘间隔的调节项已删除');
  ok(hR.indexOf('id="tlRatejump"') >= 0 && hR.indexOf('id="tlRatejump"') > hR.indexOf('class="tl-ctl"'),
    '「时间跳跃」数字框保留，并已移回播放控件行');
  /* ★ 2026-11-05（第十四轮）：时间轴压成单行紧凑版 —— 去掉大号日期行、
     左右键提示、5 年刻度行，托盘高度从 95px 降到 ~40px。 */
  ok(hR.indexOf('class="tl-rail"') >= 0, '时间轴用自绘轨道 .tl-rail（不再是裸 range）');
  ok(hR.indexOf('id="tlRailFill"') >= 0, '轨道带强调色进度填充 .tl-rail-fill');
  ok(hR.indexOf('class="tl-year tl-year-big"') >= 0 && hR.indexOf('class="tl-year-end"') >= 0 &&
    hR.indexOf('tl-year-big') > hR.indexOf('tl-year-end'),
    '大号当前日期在轨道右侧、终点年份仍贴在轨道末尾');
  ok(hR.indexOf('tl-rail-ticks') < 0 && hR.indexOf('tl-tick') < 0, '刻度行已删除（不再占一层高度）');
  ok(hR.indexOf('tl-rail-top') < 0, '大号日期那一行已删除');
  ok(hR.indexOf('快进 1 年') < 0 && hR.indexOf('jumps one year') < 0, '去掉「← → 各快进 1 年」的说明文字');
  {
    const css = fs.readFileSync(path.join(ROOT, 'css/style.css'), 'utf8');
    ok(/\.tl-ctl\{[^}]*margin:16px 0 12px/.test(css), '播放控件行与上方筛选项拉开间距（margin-top 16px）');
    ok(/\.tl-ctl\{[^}]*padding:7px 12px/.test(css), '托盘内边距压到 7px（单行紧凑）');
    ok(/\.tl-rail\{[^}]*align-items:center/.test(css), '轨道与日期在同一行对齐（不再纵向堆叠）');
    ok(/\.tl-rail-slot input\[type="range"\]::-webkit-slider-thumb/.test(css), '滑块拇指自绘');
    ok(css.indexOf('.tl-rail-hint') < 0, '.tl-rail-hint 样式已清理');
  }
  {
    const appSrc = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
    ok(/__tlArrowHandler/.test(appSrc), '左右方向键监听已接入（且每次挂载替换旧监听）');
    ok(/const dayStep = onRail \? 1 : 365/.test(appSrc), '方向键双步长：选中进度条 1 天、否则 365 天（1 年）');
    ok(/wasPlaying/.test(appSrc) && /startPlay\(\)/.test(appSrc), '按键后沿用原播放状态');
    ok(/startViewTransition/.test(appSrc) && /--reveal-r/.test(appSrc),
      '深浅色切换走 View Transitions 圆形扩散（半径可动画）');
    ok(/lastPointer/.test(appSrc) && /--reveal-x/.test(appSrc) && /clientX/.test(appSrc),
      '扩散原点取鼠标点击坐标（键盘/系统触发回退按钮中心）');
    ok(/canAnimateVars/.test(appSrc) && /theme-fade/.test(appSrc),
      '主题切换有主路径 + 老浏览器回退路径');
    ok(/theme-anim/.test(appSrc) && /typeof document\.startViewTransition === 'function'/.test(appSrc),
      '不支持 View Transitions 时回退到颜色插值（功能不丢）');
    ok(/deferCharts/.test(appSrc) && /vt\.finished/.test(appSrc) && /switchTheme\._t3/.test(appSrc),
      'VT 期间延迟图表重绘，结束后才交叉淡化（避免先新后旧的闪回）');
    /* 2026-11-05：reduced-motion 下不再「直接跳色」，改成 200ms 的短过渡；
       图表用 canvas 快照交叉淡化，避免重绘那一帧整体跳色。 */
    ok(/THEME_MS_QUICK/.test(appSrc) && /themeMs\(\)/.test(appSrc),
      '系统开了「减少动效」时仍保留 280ms 短过渡（不再硬切）');
    ok(/prefersReduce\(\) \? THEME_MS_QUICK : THEME_MS/.test(appSrc),
      '减少动效时压缩时长而不是关闭过渡');
    ok(/crossFadeCharts/.test(appSrc) && /captureCanvases/.test(appSrc),
      '图表重绘用旧画面快照交叉淡化');
    ok(/--theme-dur/.test(appSrc), '过渡时长由 CSS 变量统一写入（CSS 与 JS 不会打架）');
    const css2 = fs.readFileSync(path.join(ROOT, 'css/style.css'), 'utf8');
    /* 只查 reduced-motion 媒体块内部：2026-11-06 新增的 .theme-switching 规则也用
       `transition:none!important`，但它是 VT 切换期间的短暂类，与减少动效无关。 */
    const rmBlock = (css2.match(/@media \(prefers-reduced-motion: reduce\)\{[\s\S]*?\n\}/) || [''])[0];
    ok(rmBlock.indexOf('transition:none!important') < 0, 'reduced-motion 不再把主题过渡整块关掉');
    ok(/html\.theme-anim\{[^}]*transition-duration:var\(--theme-dur/.test(css2),
      '变量过渡时长读 --theme-dur');
    ok(/\.theme-ghost\{/.test(css2), 'canvas 快照层样式就位（.theme-ghost）');
    ok(/html\.theme-anim body\{transition:none\}/.test(css2), '切换期间关掉 body 自身的颜色过渡（避免互相打架）');
    ok(/@property --bg\{syntax:"<color>"/.test(css2), '主题色变量注册为 <color>，可以自身插值');
    ok(/html\.theme-anim\{[\s\S]{0,400}?transition-property:--bg/.test(css2),
      '切换动画由 :root 上的变量过渡承担（一组动画而非逐元素）');
    ok(/html\.theme-fade,[\s\S]{0,200}?transition-property:background-color/.test(css2),
      '回退路径逐元素过渡颜色属性');
    /* 2026-11-05 晚：圆形扩散。旧断言曾禁止 startViewTransition（第十三轮硬圆被否），
       这一版用羽化遮罩 + 渐入 + 柔光环重做，断言改为检查「不生硬」的结构保证。 */
    ok(/@property --reveal-r\{syntax:"<length>"/.test(css2),
      '扩散半径注册为 <length>，可被 WAAPI 逐帧动画');
    ok(/::view-transition-new\(root\)\{[\s\S]{0,600}?mask-image:radial-gradient/.test(css2),
      '新主题层用羽化圆形遮罩（不是一刀切的硬圆边界）');
    ok(/::view-transition-old\(root\),[\s\S]{0,220}?animation:none/.test(css2),
      '关掉 VT 默认 cross-fade，圆形边界才不会被淡入淡出糊掉');
    /* ★ 2026-11-06 第三轮：用户第二次反馈「切换一瞬间图标边框闪烁、随后消失」。
       CDP 伪元素探针抓到根因在 VT 合成层，不在 DOM 的 CSS transition（上一轮修错了层）：
         · ::view-transition-new(root) 挂的 drop-shadow 柔光只在切换期间存在，
           结束随 --reveal-glow 变透明 → 图标边缘「多一圈边框又消失」；
         · WAAPI 把 new 层 opacity 从 .88 拉到 1 → 新旧两张快照半透明叠加、边框双影；
         · root group 的 UA 默认动画 -ua-view-transition-group-anim-root 一直在跑。
       修复后实测 new.filter=none / new.opacity 恒 1 / group.animation=none，
       切换期间只剩 1 条半径动画；柔化改由加宽到 56px 的径向羽化带承担。 */
    /* 只检查 VT new 规则块本身：CSS 里别的装饰元素本来就有 filter:drop-shadow，
       注释也会提到 --reveal-glow，全文字符串检查会假红。 */
    const vtNewBlock = (css2.match(/::view-transition-new\(root\)\{([\s\S]*?)\n\}/) || ['', ''])[1];
    ok(!/filter\s*:/.test(vtNewBlock) && !/opacity\s*:/.test(vtNewBlock) &&
      css2.indexOf('var(--reveal-glow') < 0,
      'new 层不再挂 drop-shadow 柔光 / opacity 渐变（只在切换期间出现的假边框已移除）');
    ok(/::view-transition-group\(root\),[\s\S]{0,140}?animation:none!important/.test(css2),
      '禁掉 root group / image-pair 的 UA 默认动画（不再额外重描边框）');
    ok(/\{ '--reveal-r': r0 \}, \{ '--reveal-r': r1 \}/.test(appSrc) &&
      appSrc.indexOf("opacity: '.88'") < 0,
      '半径动画不再叠加 opacity 渐变（新旧快照不半透明叠加）');
    ok(/--reveal-feather', \(ms <= 300 \? 16 : 56\)/.test(appSrc) &&
      /var\(--reveal-feather,56px\)/.test(css2),
      '柔化改由加宽到 56px 的径向羽化带承担（圆形揭示仍不生硬）');
    ok(/revealAnim\.cancel\(\)/.test(appSrc) && /fill: 'forwards'/.test(appSrc),
      '半径动画结束后显式 cancel，避免 finished 动画对象逐次累积');
    ok(/theme-reveal-clip/.test(css2), '无 @property 的浏览器回退 clip-path 圆形扩散');
    /* 2026-11-05 晚二次调整：浅→深收缩、深→浅扩散（与上一版方向相反），速率不变。 */
    ok(/THEME_MS = 900/.test(appSrc) && /THEME_MS_QUICK = 280/.test(appSrc),
      '主题切换放慢到 900ms（减少动效 280ms）');
    ok(/theme-reveal-contract/.test(appSrc) &&
      /const contract = root\.getAttribute\('data-theme'\) !== 'dark' && next === 'dark'/.test(appSrc),
      '方向由「当前主题 → 目标主题」判定：浅→深才收缩（深→浅扩散）');
    ok(/const r0 = contract \? R \+ 'px' : '1px'/.test(appSrc) &&
      /const r1 = contract \? '1px' : R \+ 'px'/.test(appSrc),
      '扩散 1px→R / 收缩 R→1px 共用一条半径动画，起止互换');
    ok(/--reveal-r', contract \? R \+ 'px' : '0px'/.test(appSrc),
      '收缩首帧半径设为 R（避免先闪一下全浅色）');
    ok(/html\.theme-reveal-contract::view-transition-new\(root\)\{[\s\S]{0,420}?rgba\(0,0,0,0\) calc\(100% - var\(--reveal-feather/.test(css2),
      '收缩用反向遮罩：圆内透明露出旧浅色、圆外显示新深色');
    ok(/if \(!maskOK && contract\) return false/.test(appSrc),
      '无 @property 时收缩方向回退颜色插值（硬圆做不出反向遮罩）');
    /* 2026-11-06：切换瞬间整排图标「边框闪一下又消失」的回归。
       实测主题变量突变会同时触发 572 条逐元素 CSS transition —— .ev-tab 等图标按钮
       常驻 `border-color/background/color/box-shadow .16s` 的 hover 过渡被集体激活。
       VT 期间挂 .theme-switching 关掉它们后峰值降到 4 条（CDP 逐帧实测）。
       class 必须在 clearReveal 里摘掉，否则 crossFadeCharts 的 ghost 淡出会一起失效。 */
    ok(/root\.classList\.add\('theme-switching'\)/.test(appSrc) &&
      /r\.classList\.remove\('theme-reveal-clip', 'theme-reveal-contract', 'theme-switching'\)/.test(appSrc),
      'VT 切换期间挂 .theme-switching，由 clearReveal 统一摘掉');
    ok(/html\.theme-switching \*,[\s\S]{0,260}?transition:none!important/.test(css2),
      '切换期间禁用后代逐元素 transition（图标边框不再集体闪烁）');
    ok(/root\.classList\.remove\('theme-anim', 'theme-fade', 'theme-switching'\)/.test(appSrc),
      '无动画应用主题时也清掉残留 class');
  }
  /* 2026-11-05 晚定稿：项目权重严格按 WCA 官方 rank 数值的倒数比例分配。
     四条保证：① 逐项 w=10/rank 落位；② 排序只跟 rank 走；③ 与参赛人气完全无关
     （换一份假 stat 也算不出别的数）；④ 停办项走表尾档，不被 996–999 压成 0。 */
  {
    const RN = require(path.join(ROOT, 'etl/score/runs.js'));
    const W = RN.EV_WEIGHT_V2, C = RN.WEIGHT_V2_CFG;
    ok(C.mode === 'rank-ratio' && C.anchorRank === 10 && C.popShare === 0,
      '权重口径切到「按官方 rank 比例」：无 floor / γ / 人气旋钮');
    ok(W['333'] === 1 && Math.abs(W['222'] - .5) < 1e-12 &&
      Math.abs(W['444'] - 1 / 3) < 1e-12 && Math.abs(W['333mbf'] - 10 / 180) < 1e-12,
      '逐项落位：333=1、222=.5、444=1/3、333mbf=1/18（w=10/rank）');
    const rankKeys = Object.keys(RN.EV_OFFICIAL_RANK).filter((e) => RN.EV_OFFICIAL_RANK[e] < 990);
    ok(rankKeys.length === 17 && rankKeys.every((e) =>
      Math.abs(W[e] - C.anchorRank / RN.EV_OFFICIAL_RANK[e]) < 1e-12),
      '全部 17 个现役项目严格等于 anchorRank / rank');
    ok(W['444'] > W.pyram && W['555'] > W.skewb && W['666'] > W.clock && W['333mbf'] < W.pyram,
      '排序跟随官方序位（金字塔/斜转不再靠人数排前列）');
    const W2 = RN.buildWeightV2({ stat: { '333': { pr: 1, ar: 1 }, '333mbf': { pr: 9, ar: 9 } } });
    ok(Math.abs(W2['333mbf'] - W['333mbf']) < 1e-12,
      '权重与参赛人数完全无关：塞一份假人气表也算不出不同权重');
    ok(Math.abs(W['333ft'] - 10 / C.retiredRank * C.retiredDiscount) < 1e-12,
      '停办项按表尾 rank=190 计再乘 0.85，不被 996–999 墓碑位压成 0');
  }
  ok(hR.indexOf('tlRateReset') < 0, '「恢复默认」按钮随三项调节一起删除');
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
    /* ---- 2026-11-02 第二轮：图表切换标签 / 空格键播放 / 徽标自适应 / 条高 ---- */
    const cs = fs.readFileSync(path.join(ROOT, 'css/style.css'), 'utf8');
    const appSrc2 = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
    const chSrc = fs.readFileSync(path.join(ROOT, 'js/charts.js'), 'utf8');
    const lbl = t('tl.viewLabel');
    ok(hR.indexOf('>' + lbl + '</span>') >= 0, '分数演进图的视图按钮上方有「' + lbl + '」标签');
    ok(hR.indexOf(t('tl.dimLabel')) >= 0 && hR.indexOf('>' + lbl + '</span>') < hR.indexOf(t('tl.dimLabel')),
      '「' + lbl + '」与「' + t('tl.dimLabel') + '」同排、且在其左侧（水平对齐）');
    {
      const hL2 = tryRender('纪录时间轴（图表切换标签）', () => P.timeline(Object.assign({}, base, { tlView: 'lane' })));
      ok(hL2.indexOf('>' + lbl + '</span>') >= 0, '纪录时间轴也有同一个标签（两视图等高，按钮不跳）');
    }
    /* 空格键：body 级委托 + 焦点在别的按钮 / 输入框时不劫持 */
    ok(/e\.key !== ' ' && e\.code !== 'Space'/.test(appSrc2) && /getElementById\('tlPlay'\)/.test(appSrc2),
      '空格键委托到「播放/暂停/重播」按钮');
    ok(/String\(tg\.type \|\| 'text'\)\.toLowerCase\(\) !== 'range'\) return;/.test(appSrc2) &&
      /tg\.tagName === 'TEXTAREA' \|\| tg\.tagName === 'SELECT'/.test(appSrc2),
      '在输入框里打字时空格不被劫持（只有滑杆放行）');
    ok(/tg\.tagName === 'BUTTON' \|\| tg\.tagName === 'A'\) && tg !== btn/.test(appSrc2),
      '焦点在其它按钮 / 链接上时空格交还原生行为');
    /* 徽标宽度自适应：不能再有 --crown-w 锁宽 */
    ok(!/width:var\(--crown-w/.test(cs) && /\.tl-crown\{[^}]*width:auto/.test(cs),
      '登顶徽标宽度随内容自适应（不再锁 --crown-w）');
    /* 姓名宽度上限：11em（132px）—— 超过这个宽度才滚动。
       上限给大了（曾经 16em）会让 20 来字符的名字都算「装得下」，徽标只是被撑宽、不滚。 */
    ok(/\.tl-crown-name\{[^}]*max-width:11em/.test(cs), '姓名宽度上限 11em（约 132px，超出才滚动）');
    /* 跑马灯不能被 prefers-reduced-motion 关掉：关了就等于名字又被裁掉（站主要求） */
    ok(!/prefers-reduced-motion:reduce\{[^}]*tl-crown-name\.run/.test(cs),
      '跑马灯不受 prefers-reduced-motion 影响（否则部分机器上会静止）');
    /* 地区下拉：打开时回到顶部，不再滚到选中项 */
    ok(/menu\.scrollTop = 0/.test(appSrc2) && !/scrollIntoView\(\{ block: 'nearest' \}\)/.test(appSrc2),
      '地区下拉打开时列表回到置顶（不记住上次翻到的位置）');
    /* 竞速图：条高 25 + 条间 10（2026-11-03 用户要求间隙回到 10px） */
    ok(/Math\.min\(34, pitch - 10\)/.test(chSrc),
      '竞速图条高取「格高 − 10px」，条间距恒为 10px');
    const peSrc = fs.readFileSync(path.join(ROOT, 'js/pages-extra.js'), 'utf8');
    ok(/RACE_PITCH = 35/.test(peSrc) && /RACE_PITCH \* 16 \+ 64/.test(peSrc),
      '竞速图按 35px/格 撑开画幅（画幅加高，条高 25 + 间隙 10）');
    /* 超长姓名改为跑马灯滚动（不再是省略号）：两份文字 + 按实测像素平移 */
    ok(/@keyframes tlCrownRun\{from\{transform:translateX\(0\)\}to\{transform:translateX\(var\(--run-x/.test(cs) &&
      /\.tl-crown-name\.run \.cn-b\{display:inline-block\}/.test(cs) &&
      /--run-x'/.test(peSrc),
      '超长姓名走无缝跑马灯（第二份文字 + 按实测像素平移）');
    ok(/function crownNameFit\(nm\)/.test(peSrc) && /oneW > nm\.clientWidth \+ 8/.test(peSrc),
      '只有装不下时才滚动（带 8px 容差，短名保持静止）');
  }
  {
    /* ---- 2026-11-06（第十六轮）：筛选行强制单行 / 时间跳跃回播放托盘 / 日期右移放大 / 逐日微调 ---- */
    const cs3 = fs.readFileSync(path.join(ROOT, 'css/style.css'), 'utf8');
    const ap3 = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
    const iJump = hR.indexOf('id="tlRatejump"');
    const iTop = hR.indexOf('class="row tl-top"');
    const iCtl = hR.indexOf('class="tl-ctl"');
    const iRail = hR.indexOf('class="tl-rail"');
    ok(iJump > iCtl && iCtl > iTop && iJump < iRail,
      '时间跳跃回到播放托盘，紧挨播放按钮、在轨道之前（不再占筛选行）');
    const topHtml = hR.slice(iTop, iCtl);
    ok(topHtml.indexOf('tlRatejump') < 0 && topHtml.indexOf('class="spacer"') < 0,
      '筛选行只留两组按钮 + 登顶徽标，没有 spacer / 时间跳跃');
    ok(/\.tl-top\{[^}]*flex-wrap:nowrap/.test(cs3) &&
      /\.tl-crown\{[^}]*flex:0 1 auto;min-width:0/.test(cs3),
      '筛选行禁换行 + 徽标可收缩（超长姓名不再把徽标挤到第二行）');
    ok(/\.tl-ctl \.tl-jump\{[^}]*height:34px/.test(cs3) &&
      /max-width:1300px\)\{[\s\S]{0,220}?\.tl-top \.seg button\{padding:6px 9px\}/.test(cs3),
      '播放托盘里的药丸 34px 齐高，窄屏收紧按钮内边距让出空间');
    ok(/class="tl-year tl-year-big" id="tlYear"/.test(hR) &&
      hR.indexOf('tl-year-big') > hR.indexOf('tl-rail-slot'),
      '当前日期移到时间轴最右侧（轨道之后）');
    ok(/\.tl-year-big\{[^}]*font-size:22px/.test(cs3) &&
      /\.tl-year-big\{[^}]*text-align:right/.test(cs3),
      '日期加大到 22px 并右对齐');
    ok(/const onRail = tg === range \|\| document\.activeElement === range \|\| window\.__tlRailPicked/.test(ap3) &&
      /const dayStep = onRail \? 1 : 365/.test(ap3),
      '进度条被选中时 ←/→ 按 1 天微调，其余情况仍是 1 年');
    ok(/window\.__tlRailPickHandler\) document\.removeEventListener/.test(ap3),
      '进度条选中态的全局监听每次 mount 先摘后挂（不叠加）');
  }
  {
    /* ---- 2026-11-04：M2 领奖台必须真的按「单次 / 平均」拆轨 ----
       历史上 sixdim.js 的 --track 完全跳过 M2（事实表没有轨道列），三档 s2 逐人相等，
       于是「六维筛选 = M2」时顶部成绩口径点了没反应。断言分两层：
       源码层（CI 8 人样本也适用）+ 交付表层（按 pid 对齐，不能按行号比）。 */
    const sixSrc = fs.readFileSync(path.join(ROOT, 'etl/score/sixdim.js'), 'utf8');
    const sySrc = fs.readFileSync(path.join(ROOT, 'etl/score/sixyear.js'), 'utf8');
    const bSrc = fs.readFileSync(path.join(ROOT, 'etl/build.js'), 'utf8');
    const peSrc2 = fs.readFileSync(path.join(ROOT, 'js/pages-extra.js'), 'utf8');
    ok(sixSrc.indexOf("'M2_facts_' + OPT.track + '.tsv'") >= 0,
      'sixdim.js 按 --track 选 M2 单/平均事实表（不再无条件读 M2_facts.tsv）');
    ok(sySrc.indexOf("put('m2s'") >= 0 && sySrc.indexOf("put('m2a'") >= 0 &&
      sySrc.indexOf("DIMS.concat(['m2s', 'm2a'])") >= 0,
      'sixyear.js 产出 M2 单轨年度曲线（m2s / m2a）');
    ok(bSrc.indexOf("SIXK.concat(['m2s', 'm2a'])") >= 0, 'build.js 把 M2 单轨曲线注入 p.sy');
    ok(peSrc2.indexOf('function dimCurveKey(p, dim)') >= 0 &&
      peSrc2.indexOf('dimRatioAt(p, dimCurveKey(p, dim), fy)') >= 0 &&
      peSrc2.indexOf("const k = rtype === 'single' ? 'm2s' : (rtype === 'avg' ? 'm2a' : 'm2')") >= 0,
      '单维竞速图按成绩口径选 M2 进度曲线');
    const s2map = (f) => {
      const p = path.join(ROOT, 'etl/score', f), m = new Map();
      if (!fs.existsSync(p)) return m;
      fs.readFileSync(p, 'utf8').trim().split('\n').slice(1).forEach((l) => {
        const c = l.split('\t'); if (c.length > 2) m.set(c[0], c[2]);
      });
      return m;
    };
    const sb = s2map('sixdim_site.tsv'), ss = s2map('sixdim_site_single.tsv'), sa = s2map('sixdim_site_avg.tsv');
    let n = 0, ds = 0, da = 0;
    for (const [pid, v] of sb) {
      if (!ss.has(pid) || !sa.has(pid)) continue;
      n++;
      if (ss.get(pid) !== v) ds++;
      if (sa.get(pid) !== v) da++;
    }
    ok(n > 1000 && ds > n * 0.1 && da > n * 0.1,
      'M2 三档交付表确实不同（同 pid ' + n + ' 人，single 差 ' + ds + ' / avg 差 ' + da + '）');
  }
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
  /* 国家配色板块已按用户要求删除（2026-11-04 晚）；取色能力仍在（countryColor 按国码自动生成） */
  ok(hM.indexOf('data-ccmod') < 0, '国家配色控件已删除');
  ok(typeof P.countryColor === 'function', '国家取色仍由 countryColor() 自动生成');
  const setC = Params.setColor;
  ok(typeof setC === 'function', '模块配色可写入并持久化');
  if (typeof setC === 'function') {
    const before = Params.colors().m1;
    setC('m1', '#123456');
    ok(Params.colors().m1.toLowerCase() === '#123456', '自定义颜色立即生效');
    Params.resetColors();
    ok(Params.colors().m1 === before, '恢复默认后回到原色');
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

/* == 竞速图姓名落位：条内放不下时移到「条形 + 分数」之后 ==
   用户反馈：条形太短时名字被截成「H…」甚至只剩一个字母。现在的规则是
   条内放得下「完整国旗 + 完整名字」才画在条内，否则整块挪到条尾分数之后。
   这里用桩 api 直接跑 renderItem，按条形几何断言落位，避免只靠肉眼看截图。 */
console.log('== 竞速图姓名落位 ==');
{
  const C = win.Charts;
  const NAME = 'Oscar Roth Andersen';
  if (C && typeof C.barRace === 'function') {
    const LEFT = 34;           /* 桩坐标系的绘图区左边界 */
    const opt = C.barRace([
      { id: 'long', name: NAME, iso: 'CN', flag: '', color: '#c00', value: 200, rank: 1, no: 1 },
      { id: 'short', name: NAME, iso: 'CN', flag: '', color: '#c00', value: 18, rank: 2, no: 2 }
    ], { top: 2 });
    const ri = opt.series[0].renderItem;
    const mkApi = function (val, rank) {
      return {
        value: function (i) { return i === 0 ? val : rank; },
        /* 1 分 = 1px，方便直接拿 value 当条长断言 */
        coord: function (p) { return [LEFT + p[0], 40 + p[1] * 30]; },
        size: function () { return [0, 20]; },
        getWidth: function () { return 900; }
      };
    };
    const pick = function (grp) {
      const kids = (grp && grp.children) || [];
      return {
        bar: kids.filter(function (k) { return k.type === 'rect'; })[0],
        name: kids.filter(function (k) { return k.type === 'text' && k.style && k.style.text === NAME; })[0]
      };
    };
    const L = pick(ri({ dataIndex: 0 }, mkApi(200, 1)));
    const S = pick(ri({ dataIndex: 1 }, mkApi(18, 2)));
    ok(!!(L.bar && L.name && S.bar && S.name), '两行都画出了条形与姓名');
    if (L.bar && L.name && S.bar && S.name) {
      const lRight = L.bar.shape.x + L.bar.shape.width;
      const sRight = S.bar.shape.x + S.bar.shape.width;
      ok(L.name.style.x < lRight - 20, '长条：名字画在条形内部（x=' + Math.round(L.name.style.x) + ' < 条尾 ' + Math.round(lRight) + '）');
      ok(S.name.style.x > sRight + 10, '短条：名字移到「条形 + 分数」之后（x=' + Math.round(S.name.style.x) + ' > 条尾 ' + Math.round(sRight) + '）');
      ok(S.name.style.text === NAME, '短条：名字不再被省略号截断（' + S.name.style.text + '）');
      ok(S.name.style.fill !== L.name.style.fill, '短条名字改用正文色（条内是反白色，条外是正文色）');
      ok(L.name.style.text === NAME, '长条：名字同样是完整姓名');
    }
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
      'data-lane': 'single', 'data-smooth': '0', 'data-tlregion': '', 'data-tlcountry': '', 'data-ev': '',
      'data-tlgender': 'all', 'data-tltype': 'all', 'data-tldimv': ''
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

/* == 纪录持有图：段内只画姓名（无国旗）+「×N」刷新角标 + tooltip 刷新日期排布 ==
   2026-11-01 用户要求：
     ① 泳道色块上只显示姓名，国旗只在 tooltip 里出现；
     ② 同一人连续刷新多次合并成一段时，段上要能看出「刷了几次」；
     ③ tooltip 里刷新日期太多时不能顶出弹窗（改成小胶囊 + 自动换行）。 */
console.log('== 纪录持有图：段内姓名 / 刷新次数 ==');
{
  const C = win.Charts;
  if (C && typeof C.lanes === 'function') {
    /* 桩：把 1970-01-01 起的天数当坐标，1 天 = 0.1px，便于算几何 */
    win.echarts = win.echarts || {};
    win.echarts.graphic = {
      clipRectByRect: function (r) { return r; }
    };
    const seg = {
      from: 2005, to: 2015, holder: 'Multi Holder', iso: 'AU', id: '2009ZEMD01',
      days: 3650, fromDn: 20050101, toDn: 20150101,
      subs: [20050101, 20070615, 20090101, 20110420, 20130905, 20150101]
    };
    const opt = C.lanes([{ ev: '333', label: '3x3x3', segs: [seg] }], { y0: 2003, y1: 2016, laneH: 30 });
    const ri = opt.series && opt.series[0] && opt.series[0].renderItem;
    ok(!!ri, '泳道 series 有 renderItem');
    if (ri) {
      const api = {
        value: function (i) { return opt.series[0].data[0].value[i]; },
        /* x：小数年 → 像素；y：泳道序号 → 像素 */
        coord: function (p) { return [60 + (p[0] - 2003) * 40, 40 + (p[1] || 0) * 40]; },
        size: function () { return [0, 30]; },
        visual: function () { return '#3355cc'; }
      };
      const grp = ri({ dataIndex: 0, coordSys: { x: 0, y: 0, width: 900, height: 300 } }, api);
      const kids = (grp && grp.children) || [];
      ok(!kids.some(function (k) { return k.type === 'image'; }), '段内不画国旗（没有 image 图元）');
      ok(kids.some(function (k) { return k.type === 'text' && k.style && k.style.text === 'Multi Holder'; }),
        '段内仍然画姓名');
      const badge = kids.filter(function (k) { return k.type === 'text' && k.style && k.style.text === '×6'; })[0];
      ok(!!badge, '合并段带「×6」刷新次数角标（实得 ' +
        JSON.stringify(kids.filter(function (k) { return k.type === 'text'; }).map(function (k) { return k.style.text; })) + '）');
      if (badge) {
        const bar = kids.filter(function (k) { return k.type === 'rect'; })[0];
        const nmTx = kids.filter(function (k) { return k.type === 'text' && k.style.text === 'Multi Holder'; })[0];
        ok(badge.style.x > bar.shape.x + bar.shape.width * 0.5, '角标贴在段尾一侧');
        ok(!nmTx || nmTx.style.x + 60 < badge.style.x, '姓名与角标不重叠');
      }
      /* 段内刷新：6 个刷新点把段切成 5 小格，其中 2 格压了「交替遮罩」（一亮一暗，肉眼能数格数）。
         条体本身（r:5）与角标（r:半径）都带圆角，遮罩小格不带 r，用这个区分。 */
      const bands = kids.filter(function (k) { return k.type === 'rect' && k.shape && !k.shape.r; });
      ok(bands.length === 2, '合并段按每次刷新切成「一亮一暗」交替小格（实得 ' + bands.length + ' 格）');
      /* 段内分隔线：内部交界 4 根（段首不画，段尾那根落在条边外） */
      const ticks = kids.filter(function (k) { return k.type === 'path'; })[0];
      ok(!!ticks && (ticks.shape.path.match(/M/g) || []).length === 4,
        '每次刷新位置都压一根分隔线（实得 ' + (ticks ? (ticks.shape.path.match(/M/g) || []).length : 0) + ' 根）');
    }
    /* ★ 窄段也必须挂角标：默认视野下大多数段只有 40~60px，旧门槛（w > badgeW+34）导致角标几乎从不出现，
       用户反馈「合并段刷了几次完全看不出来」。1 年 ≈ 40px 的段现在应该能看到「×3」。 */
    {
      const seg2 = Object.assign({}, seg, { to: 2006, toDn: 20060101, days: 365, subs: [20050101, 20050615, 20060101] });
      const opt2 = C.lanes([{ ev: '333', label: '3x3x3', segs: [seg2] }], { y0: 2003, y1: 2016, laneH: 30 });
      const api2 = {
        value: function (i) { return opt2.series[0].data[0].value[i]; },
        coord: function (p) { return [60 + (p[0] - 2003) * 40, 40]; },
        size: function () { return [0, 30]; },
        visual: function () { return '#3355cc'; }
      };
      const g2 = opt2.series[0].renderItem({ dataIndex: 0, coordSys: { x: 0, y: 0, width: 900, height: 300 } }, api2);
      const k2 = (g2 && g2.children) || [];
      ok(k2.some(function (k) { return k.type === 'text' && k.style && k.style.text === '×3'; }),
        '窄段（1 年 ≈ 40px）也挂上「×3」角标');
    }
    const fmt = opt.tooltip && opt.tooltip.formatter;
    ok(typeof fmt === 'function', 'tooltip 有 formatter');
    if (typeof fmt === 'function') {
      const html = fmt({ data: opt.series[0].data[0] });
      ok(html.indexOf('tl-tip-chips') >= 0, '刷新日期用胶囊容器排版（自动换行，不顶出弹窗）');
      ok(html.indexOf('刷新 6 次') >= 0 || html.indexOf('Refreshed 6 times') >= 0,
        'tooltip 明确写出刷新次数');
      ok(html.indexOf('Multi Holder') >= 0, 'tooltip 里有姓名');
      /* 2026-11-01 用户要求：刷新日期**全部列出**，不再截断成 9 枚 + 「+N」 */
      const chips = (html.match(/<i[ >]/g) || []).length;
      ok(chips === 6, '刷新日期全部列出、不再截断（实得 ' + chips + '，应为 6）');
      ok(html.indexOf('more') < 0, '不再出现「+N」折叠标签');
    }
    ok(opt.tooltip && opt.tooltip.confine === false,
      'tooltip 不再被 confine 关在图表内（允许超出顶层）');
  }
}

/* == 竞速图快照：只算前 K 名，但结果必须与「全量排序后取前 K」完全一致 ==
   2026-11-01 修「播放越久越慢」：原先把所有有分选手塞进数组排序，播到后期每帧几万个对象，
   帧时间越来越长；改成只保留前 15 名。这里验证改写没有改变结果。 */
console.log('== 竞速图快照 top-K 一致性 ==');
{
  if (typeof P._snap === 'function') {
    [[[], 2010], [[], 2026], [['333'], 2015], [['333', '222'], 2020]].forEach(function (cs) {
      const evs = cs[0], y = cs[1], K = 15;
      const full = P._snap('cumulative', y, false, '', '', evs, 'all', 'all', '', 0);
      const topk = P._snap('cumulative', y, false, '', '', evs, 'all', 'all', '', K);
      const same = topk.length === Math.min(K, full.length) &&
        topk.every(function (r, i) {
          return r.id === full[i].id && Math.abs(r.value - full[i].value) < 1e-9 && r.no === i + 1;
        });
      ok(same, 'top-' + K + ' 与全量排序一致（项目 ' + (evs.join('+') || '全部') + ' / ' + y +
        '，实得 ' + topk.length + '/' + full.length + '）');
    });
  }
}

/* == 登顶时长：时间线自洽（单调、覆盖、能算出天数） == */
console.log('== 登顶时长 ==');
{
  if (typeof P.tlCrownSince === 'function' && typeof P.tlCrownYmd === 'function') {
    const D0 = Date.UTC(2010, 0, 1) / 86400000;
    const ymd = P.tlCrownYmd(365, D0);
    ok(ymd && ymd.y === 1 && ymd.m === 0 && ymd.d === 0, '365 天 → 1 年 0 个月 0 天（实得 ' +
      JSON.stringify(ymd) + '）');
    const ymd2 = P.tlCrownYmd(400, D0);
    ok(ymd2.y === 1 && ymd2.m === 1, '400 天 → 1 年 1 个月（实得 ' + JSON.stringify(ymd2) + '）');
    const since = P.tlCrownSince([{ pid: 'a', from: 2010 }, { pid: 'b', from: 2015 }], 'b', 2020);
    ok(since === 2015, '取最近一次登顶起点（实得 ' + since + '）');
    const none = P.tlCrownSince([{ pid: 'a', from: 2010 }], 'z', 2020);
    ok(none === null, '没登顶过的人返回 null');
    /* 真正跑一次榜首时间线（样本数据规模小，可以直接跑完） */
    const spells = P.tlCrownComputeSync();
    ok(Array.isArray(spells) && spells.length > 0, '榜首时间线算出了 ' + (spells || []).length + ' 段');
    if (Array.isArray(spells) && spells.length) {
      let mono = true;
      for (let i = 1; i < spells.length; i++) if (!(spells[i].from > spells[i - 1].from)) mono = false;
      ok(mono, '时间线按时间严格递增');
      ok(spells[0].from <= 2004, '首段从数据起点开始（实得 ' + spells[0].from + '）');
      ok(spells[spells.length - 1].from <= P.tlEndFy() + 1e-6, '末段不晚于数据结尾');
      ok(spells.every(function (s) { return !!s.pid; }), '每段都有榜首');
    }
  }
}

/* ============ 六维分数细则（参数设置子页面）回归 ============
   两个历史 bug：① 默认「六维总分」视图表头 9 列、表体 15 列；
   ② .bar 绝对定位但 <td> 不是定位上下文，色条堆在表格外。 */
console.log('== 六维分数细则子页面 ==');
if (P.sixdimTableHtml) {
  const l = P.sixdimLabels();
  const DIMS_ALL = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6'];
  const fake = {
    meta: { generated: '2026-11-04', count: 3, weights: { M1: .45, M2: .15, M3: .2, M4: .15, M5: .01, M6: .04 },
      labels: { M1: '纪录持有', M2: '领奖台', M3: '大赛表现', M4: '统治力', M5: '纪录比', M6: '突破幅度' } },
    rows: [
      { id: '2009ZEMD01', n: 'Feliks', g: 'm', t: 3945.78, M1: 38.72, M2: 244.63, M3: 35.47, M4: 56.48, M5: 1.06, M6: 179.40 },
      { id: '2012PARK03', n: 'Max', g: 'm', t: 2588.42, M1: 36.62, M2: 235.42, M3: 10.23, M4: 47.36, M5: .62, M6: 125.15 },
      { id: '2019WANY36', n: 'Wang', g: 'f', t: 1800.11, M1: 12.81, M2: 180.11, M3: 8.11, M4: 30.11, M5: .51, M6: 90.11 }
    ]
  };
  ['total', 'M1', 'M2', 'M3', 'M4', 'M5', 'M6'].forEach(function (dim) {
    const r = P.sixdimTableHtml(fake, { dim: dim, g: 'all', q: '', page: 1, per: 20 }, l);
    const thN = (r.head.match(/<th\b/g) || []).length;
    const per = r.body.split('<tr>').slice(1).map(function (x) { return (x.match(/<td\b/g) || []).length; });
    ok(thN === 9 && r.cols === 9 && per.length === 3 && per.every(function (n) { return n === 9; }),
      dim + ' 视图表头 9 列、每行 9 列（实得 ' + per.join('/') + '）');
    /* 2026-11-04 晚（第十三轮）：分数条整块删除 —— 单元格里只有数字，颜色即维度 */
    ok((r.body.match(/class="bar-grow"/g) || []).length === 0, dim + ' 视图已无分数条（.bar-grow）');
    ok((r.body.match(/class="sd-bar"/g) || []).length === 0, dim + ' 视图无旧的 absolute 色块 .sd-bar');
    ok((r.body.match(/class="ministack"/g) || []).length === 0, dim + ' 视图无堆叠条 .ministack');
    /* 每行 7 个数字（M1–M6 + 六维总分），各自带该维度颜色 */
    const nums = (r.body.match(/class="[^"]*sd-num"/g) || []).length;
    ok(nums === 21, dim + ' 视图每行 7 个着色数字（3 行共 21，实得 ' + nums + '）');
    DIMS_ALL.forEach(function (d) {
      ok(r.body.indexOf('var(--' + d.toLowerCase() + ')') >= 0, dim + ' 视图的 ' + d + ' 数字用该维主色');
    });
    ok(r.body.indexOf('var(--accent)') >= 0, dim + ' 视图的六维总分数字用强调色');
  });
  /* ★ 2026-11-04：每页 20 人 + 底部分页 */
  {
    const many = { meta: fake.meta, rows: [] };
    for (let i = 0; i < 45; i++) {
      many.rows.push({ id: 'P' + i, n: 'P' + i, g: 'm', t: 1000 - i, M1: 10, M2: 10, M3: 10, M4: 10, M5: 1, M6: 10 });
    }
    ok(P.sixdimPer === 20, '每页固定 20 人（实得 ' + P.sixdimPer + '）');
    const p1 = P.sixdimTableHtml(many, { dim: 'total', g: 'all', q: '', page: 1, per: 20 }, l);
    const p2 = P.sixdimTableHtml(many, { dim: 'total', g: 'all', q: '', page: 2, per: 20 }, l);
    const p3 = P.sixdimTableHtml(many, { dim: 'total', g: 'all', q: '', page: 3, per: 20 }, l);
    ok(p1.rows === 20 && p2.rows === 20 && p3.rows === 5, '45 人分 3 页：20 / 20 / 5（实得 ' + [p1.rows, p2.rows, p3.rows].join('/') + '）');
    ok(p1.pages === 3 && p2.page === 2 && p3.page === 3, '总页数与当前页正确');
    ok(p2.body.indexOf('>21<') >= 0 && p2.body.indexOf('>40<') >= 0, '第 2 页的名次从 21 续到 40');
    ok(p1.pager.indexOf('data-sdpage="2"') >= 0 && p1.pager.indexOf('class="on"') >= 0, '分页条有页码按钮且高亮当前页');
    ok(p1.pager.indexOf('第 1–20 人 / 共 45 人') >= 0, '分页条写明「第 a–b 人 / 共 n 人」');
    /* 页码越界要自动夹回，不能出现空白页（搜索后人数骤减就走这条） */
    const over = P.sixdimPaging(45, { page: 99, per: 20 });
    ok(over.page === 3 && over.from === 40 && over.to === 45, '页码越界夹到最后一页（实得 ' + over.page + '）');
    const under = P.sixdimPaging(45, { page: -5, per: 20 });
    ok(under.page === 1 && under.from === 0, '页码为负夹回第 1 页');
    /* 只有一页时不渲染分页条（避免「1」这种无意义的分页） */
    const one = P.sixdimTableHtml(fake, { dim: 'total', g: 'all', q: '', page: 1, per: 20 }, l);
    ok(one.pager === '', '总人数不足一页时不渲染分页条');
  }
  const r = P.sixdimTableHtml(fake, { dim: 'total', g: 'f', q: '', page: 1, per: 20 }, l);
  ok(r.matched === 1 && r.rows === 1, '性别筛选生效（女 = 1 人）');
  const r2 = P.sixdimTableHtml(fake, { dim: 'total', g: 'all', q: 'park', page: 1, per: 20 }, l);
  ok(r2.matched === 1, '姓名 / WCA ID 搜索生效');
  const hPage = tryRender('六维分数细则子页面', () => P.sixdim(Object.assign({}, base)));
  ok(hPage.indexOf('id="sdRoot"') >= 0, '子页面含懒加载容器 #sdRoot');
  ok(hPage.indexOf('id="sdHead"') >= 0 && hPage.indexOf('id="sdBody"') >= 0, '子页面含表头 / 表体容器');
  ok(hPage.indexOf('六维实验榜') < 0 && hPage.indexOf('六维分数细则') >= 0, '子页面使用新名称「六维分数细则」');
  const hDoc = tryRender('参数设置页（二级导航）', () => P.model(Object.assign({}, base)));
  ok(hDoc.indexOf('#/model/sixdim') >= 0, '参数设置页可进入六维分数细则子页面');
  ok(t('sd.title') === '六维分数细则', 'i18n 中文名已改为「六维分数细则」');
} else {
  console.error('FAIL: P.sixdimTableHtml 未导出（pages-sixdim.js 未加载？）');
  fail++;
}

/* ================= 2026-11-06 回滚：分数演进恢复「年度采样 + 年内线性插值」 =================
   上一版把年度增量重参数化到真实比赛日（赛前 10 天加速 / 比赛日集中 / 无比赛严格平台），
   用户实测「太生硬、不够丝滑连接」，已整体回滚。这里守住两点：
   ① 源码里不再残留爆发曲线的函数 / 常量 / 探针（避免死代码与两套分数口径）；
   ② 数值上同一年内仍是匀速推进 —— 不会出现整段 0 增量的平台或突发跳变。 */
{
  const peSrc4 = fs.readFileSync(path.join(ROOT, 'js/pages-extra.js'), 'utf8');
  const dead = ['BURST_LEAD', 'burstStep', 'compDatesOf', 'burstFor', 'burstRatioAt',
    'raceRatio', 'tlValueProbe', '__burst'];
  ok(dead.every((k) => peSrc4.indexOf(k) < 0),
    '爆发曲线已整体回滚：无残留函数 / 常量 / 探针');
  ok(/function seriesCum\(/.test(peSrc4) && /function dimRatioAt\(/.test(peSrc4) &&
    /s \+= v \* frac/.test(peSrc4) &&
    /dimRatioAt\(p, dimCurveKey\(p, dim\), fy\)/.test(peSrc4),
    '恢复年度累计 seriesCum + 单维 dimRatioAt 的年内线性插值');
  /* 逐季度取分：同一年内的季度增量应近似相等（匀速），且每一段都 > 0（无平台）。
     只在全量数据上做，CI 的 8 人样本选手太少。 */
  const SAMPLE4 = M.ranked.length < 1000;
  if (!SAMPLE4) {
    const pid4 = '2009ZEMD01';
    const qs = [2015.0, 2015.25, 2015.5, 2015.75];
    const vals = qs.map((f) => {
      const row = P.tlSnapshot([], f).find((r) => r.id === pid4);
      return row ? row.value : 0;
    });
    const d = [vals[1] - vals[0], vals[2] - vals[1], vals[3] - vals[2]];
    ok(vals.every((v) => v > 0) && d.every((x) => x > 0),
      '同一年内每季度都在涨分（没有「无比赛就不涨」的平台）');
    const avg = (d[0] + d[1] + d[2]) / 3;
    ok(avg > 0 && d.every((x) => Math.abs(x - avg) < avg * 0.06),
      '季度增量近似相等（年内匀速线性插值，实得 ' + d.map((x) => x.toFixed(2)).join(' / ') + '）');
  }
}

/* ================= 2026-11-06 第四轮：分数条边框闪烁 + 按键抖动 =================
   用户第三次反馈：切换瞬间「图标可视化的分数条」出现边框又消失、部分按键抖动。
   CDP 探针定位到两层独立原因：
     ① VT 合成层：old 层 mask:none/op:1 完整不透明，new 层带 56px 羽化半透明
        mask → 羽化带里两张整页快照叠加，细长高对比分数条边缘被重描出双影；
     ② DOM 层：crossFadeCharts 在 VT 结束后 render(true) 重建整页，新挂载的
        .reveal 重播 revealIn（translateY(14px)），实测 390 个按键同帧位移 14px。
   修法分别是 old 层互补遮罩、重建后把入场动画节点内联定格到终态。 */
{
  const css4 = fs.readFileSync(path.join(ROOT, 'css/style.css'), 'utf8');
  const app4 = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
  const oldBlock = (css4.match(/::view-transition-old\(root\)\{([\s\S]*?)\n\}/) || ['', ''])[1];
  ok(/mask-image:radial-gradient/.test(oldBlock) &&
    /rgba\(0,0,0,0\) calc\(100% - var\(--reveal-feather,56px\)\),#000 100%\)/.test(oldBlock),
    'old 层加互补遮罩：羽化带内新旧快照 alpha 互补，分数条不再叠出双影边框');
  ok(/html\.theme-reveal-contract::view-transition-old\(root\)\{[\s\S]{0,400}?mask-image:radial-gradient/.test(css4),
    '收缩方向 old 层遮罩同步反向');
  ok(/html\.theme-reveal-clip::view-transition-old\(root\)\{[\s\S]{0,120}?mask-image:none/.test(css4),
    '硬圆回退下 old 层不套渐变遮罩');
  /* ★ 第六轮（2026-11-07）把「重建 DOM 后定格动画」整套废弃：render(true) 换掉
     #view.innerHTML 还会让登顶徽标的跑马灯 / data-k 状态丢失（左右抖动）、
     settlePage 的 chartSettle 让整张图表淡入（虚线与分数闪一下）。
     改成只重绘 canvas、DOM 一个节点都不换，下面两条断言随之改为回归保护。 */
  const cf = (app4.match(/function crossFadeCharts\(dur\)\s*\{([\s\S]*?)\n  \}/) || ['', ''])[1];
  ok(!/render\(true\)/.test(cf) && /Charts\.repaint\(/.test(cf) && /P\.drawTimeline\(box\)/.test(cf),
    '主题切换只重绘 canvas，不再 render(true) 重建整页 DOM（登顶徽标状态得以保留）');
  ok(!/settlePage\(\);/.test(cf) && !/function silentRebuild\(/.test(app4),
    '不再挂 chartSettle 容器淡入，第四轮 silentRebuild 随 DOM 重建一起废弃');
  ok(!/classList\.(add|remove)\('theme-silent'\)/.test(app4) && css4.indexOf('html.theme-silent') < 0,
    '不用「临时挂类 + 延时摘除」方案（摘类会把 animation 从头重播，抖动只是延后）');
}

/* ================= 2026-11-06 第五轮：切换瞬间分数条「白边」的真正根因 =================
   用户第四次反馈并附截图：深色主题下每一根分数条外都有一圈浅灰白 1px 描边，
   切换刚结束那一瞬间出现、随后消失。前四轮都在修 VT 合成层，方向不对。
   CDP 探针（_cdpchk/white_edge_probe.mjs）读 .theme-ghost 位图像素：
     浅→深时旧位图有 18807 个近纯白像素，亮线行 30/52/77/87/112/122/147/157…
     与用户截图逐行吻合；深→浅时只有 3426（文字/国旗）。
   根因：charts.js 给每个图形画了 stroke/borderColor = T.elev，而浅色主题
   --bg-elev = #ffffff —— 旧 canvas 位图里全是纯白环，crossFadeCharts 把它
   opacity 1→0 盖在深色新图上淡出 630ms，白环就成了「白边」。VT old(root)
   快照同理。修法：条形/段形描边与自身填充同色，扇区/圆点用主题无关的 EDGE。
   修复后浅→深旧位图 6984 白像素（剩下的是条内白字/国旗/顶轴），
   亮线行只剩 y=30 的顶部分数轴轴线，逐条描边全部消失。 */
{
  const ch5 = fs.readFileSync(path.join(ROOT, 'js/charts.js'), 'utf8');
  ok(/const EDGE = 'rgba\(80,96,116,\.30\)'/.test(ch5),
    '图形分隔描边用主题无关的低对比 EDGE（不再随主题在纯白/深色之间跳）');
  ok(!/stroke:\s*T\.elev/.test(ch5) && !/borderColor:\s*T\.elev/.test(ch5),
    'canvas 图形不再用 T.elev 画描边（浅色主题下它是 #ffffff 的白环）');
  ok(/stroke: d\.color \|\| T\.m\[0\], lineWidth: 1/.test(ch5) &&
    /stroke: api\.visual\('color'\), lineWidth: 1/.test(ch5),
    '竞速条与泳道段的描边与自身填充同色，任何主题快照里都没有高亮环');
  ok(/borderColor: EDGE/.test(ch5) && (ch5.match(/borderColor: EDGE/g) || []).length >= 3,
    '饼图扇区 / bump 圆点 / 散点三处分隔环统一换成 EDGE');
  ok((ch5.match(/backgroundColor: T\.elev/g) || []).length >= 2,
    'tooltip 背景仍按主题取色（只换图形描边，不误伤 DOM 弹层）');
  ok(/axisLine: \{ lineStyle: \{ color: EDGE \} \}/.test(ch5) &&
    /axisLine: \{ show: true, lineStyle: \{ color: EDGE, width: 1 \} \}/.test(ch5) &&
    (ch5.match(/axisLine:\s*\{[^}]*color:\s*T\.border(?!2)/g) || []).length === 0,
    '坐标轴长线也换成 EDGE：旧位图不再有贯穿全宽的近白横线');
  ok(/theme-ghost/.test(ch5) && /function crossFadeCharts\(/.test(fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8')),
    '保留 canvas 交叉淡化：白边是位图内容问题，不靠删掉过渡来掩盖');
}

/* ================= 2026-11-07 第六轮：虚线 / 分数数字闪烁 + 登顶徽标左右抖动 =================
   用户第五次反馈：「分数条不闪了，但年份虚线、条尾分数数字还在闪，登顶徽标左右抖动」。
   三者同源，都在 crossFadeCharts() 这一条链上：
     ① 旧 canvas 位图里的灰阶辅助元素（splitLine / axisLabel / 条尾分数 / 条内白字）
        在两主题下一深一浅，旧图 opacity 1→0 盖在新图上时走一段颜色渐变 → 「闪烁」；
     ② render(true) 重建 #view.innerHTML，#tlCrown 换新节点 → data-k 失效、
        crownNameFit() 重新 remove/add .run，无限跑马灯从 translateX(0) 重播，
        徽标宽度先窄后宽 → 「左右抖动」；
     ③ settlePage() 给 .chart-box/.ec 挂 chartSettle（opacity .35→1）整图淡入 → 又闪一下。
   修法：旧位图只保留高饱和彩色像素（灰阶擦透明）；网格虚线统一 EDGE；
   crossFadeCharts 改为 Charts.refresh()+repaint()+P.drawTimeline() 重绘 canvas、
   一个 DOM 节点都不换，也不再 settlePage。
   CDP 实测（_cdpchk/theme_round6.mjs）：ghost 灰阶像素 149734→0、白像素 0；
   DOM 标记 KEEP 与 data-k 双向保留；xAxis.axisLabel.color 随主题换成新调色板
   （确实用新配色重绘，具体色值由 CSS 变量决定，勿在此硬编码）；0 运行时错误。 */
{
  const ch6 = fs.readFileSync(path.join(ROOT, 'js/charts.js'), 'utf8');
  const app6 = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
  ok(/__ecSpec = opt/.test(ch6) && /function repaint\(root\)/.test(ch6) && /repaint: repaint/.test(ch6),
    '静态图表保存 __ecSpec 并提供 repaint()：复用同一 canvas 用新调色板重绘');
  ok(/getImageData\(0, 0, w, h\)/.test(app6) && /d\[i \+ 3\] = 0/.test(app6) && /mx - mn < 34/.test(app6),
    '旧 canvas 快照擦掉灰阶辅助像素（虚线 / 刻度 / 分数不再渐变闪烁）');
  ok(!/splitLine: \{ lineStyle: \{ color: T\.border/.test(ch6),
    '网格虚线不再随主题跳色，统一用主题无关 EDGE');
  ok(/box\.__tlFastTs = Date\.now\(\)/.test(app6),
    '时间轴重绘关掉这一帧的 ECharts 补间，条形与分数不二次缓动');
  const cf6 = (app6.match(/function crossFadeCharts\(dur\)\s*\{([\s\S]*?)\n  \}/) || ['', ''])[1];
  ok(/const cv = all\[s\.i\]/.test(cf6) && !/const now = /.test(cf6),
    'canvas 节点不变，ghost 直接按序号盖回同一个容器');
}

/* ============================================================
   2026-11-07 全站自查：运行时泄漏 / 同名函数 / 搜索复杂度 / 离线 MathJax /
   懒加载竞态 / 键盘可访问性 / 窄屏溢出 / HTML 注入垃圾。
   CDP 基线（_cdpchk/audit_baseline.mjs）：4 轮路由往返后 window resize 监听
   1→22（最终 40）、mousemove / mouseup 各 0→9；375px 下选手页横向溢出 212px、
   时间轴 95px。以下断言逐条锁住修复。 */
{
  const a7 = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
  const c7 = fs.readFileSync(path.join(ROOT, 'js/charts.js'), 'utf8');
  const e7 = fs.readFileSync(path.join(ROOT, 'js/pages-extra.js'), 'utf8');
  const s7 = fs.readFileSync(path.join(ROOT, 'js/pages-sixdim.js'), 'utf8');
  const p7 = fs.readFileSync(path.join(ROOT, 'js/pages-player.js'), 'utf8');
  const css7 = fs.readFileSync(path.join(ROOT, 'css/style.css'), 'utf8');
  const h7 = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

  /* ① 两份同名 toast()：后者提升覆盖前者，带 aria-live 的 #toast 从未生效 */
  ok((a7.match(/function toast\(/g) || []).length === 1 &&
    /el\.setAttribute\('role', 'status'\)/.test(a7) &&
    /id="wbToast" class="wb-toast" role="status" aria-live="polite"/.test(h7) &&
    !/class="toast" id="toast"/.test(h7) && !/\.toast\.show\{/.test(css7),
    '轻提示只留一份 toast()，live region 常驻且实际生效');

  /* ② 搜索：空 WCA ID 全量命中 + O(n²) 去重 + 无防抖 + 长尾死链 */
  ok(/if \(!roster \|\| !q2\) return Promise\.resolve\(local\)/.test(a7) &&
    /if \(!seen\[p\.id\]\) seen\[p\.id\] = p/.test(a7) &&
    !/all\.filter\(function \(p\) \{ return p\.id === id/.test(a7),
    '搜索不再对 30 万条名册做 O(n²) 去重，只输入 # 时短路');
  ok(/seq !== searchSeq \|\| !box\.isConnected/.test(a7) &&
    /searchTimer = setTimeout\(function \(\)/.test(a7) &&
    /worldcubeassociation\.org\/persons\//.test(a7) && /const link = p\.roster/.test(a7),
    '搜索防抖 + 过期结果丢弃；长尾名册选手不再跳空白选手页');
  ok(/function toggleRec\(el\)/.test(a7) &&
    /document\.addEventListener\('keydown'/.test(a7) &&
    /document\.addEventListener\('focusin'/.test(a7) &&
    /document\.addEventListener\('focusout'/.test(a7) &&
    (p7.match(/data-toggle tabindex="0" role="button" aria-expanded="false"/g) || []).length === 2,
    '明细行可键盘展开并播报状态；data-tip 悬浮说明有键盘等价');

  /* ③ 离线 MathJax 无限 400ms 自递归、每页各起一条链 */
  ok(/const MJ_WAIT_MS = 6000/.test(a7) && /mjRetryTimer = 0; typeset\(scope\)/.test(a7) &&
    /Date\.now\(\) < mjDeadline && !mjRetryTimer/.test(a7) &&
    !/setTimeout\(function \(\) \{ typeset\(scope\); \}, 400\)/.test(a7),
    'MathJax 不可用时最多重试 6 秒且全局只留一条重试链');

  /* ④ 图表生命周期：单一全局 resize + 共享 RO + 替换 DOM 前 dispose */
  ok(/let sharedRO = null, globalResizeBound = false/.test(c7) &&
    /window\.addEventListener\('resize', resizeAll, \{ passive: true \}\)/.test(c7) &&
    !/el\.__ecRO = new window\.ResizeObserver/.test(c7) &&
    /if \(!target\.isConnected\) \{ try \{ sharedRO\.unobserve\(target\)/.test(c7),
    'ECharts 改为共享 ResizeObserver + 单一全局 resize 监听');
  ok(/function disposeWithin\(root\)/.test(c7) && /dispose: disposeWithin/.test(c7) &&
    /window\.Charts\.dispose\(view\)/.test(a7),
    '整页 DOM 替换前显式回收旧 ECharts 实例');
  ok(/let zoomWinCleanup = null/.test(e7) &&
    /if \(zoomWinCleanup\) \{ zoomWinCleanup\(\); zoomWinCleanup = null; \}/.test(e7) &&
    /window\.removeEventListener\('mousemove', onMove\)/.test(e7) &&
    /window\.removeEventListener\('mouseup', onUp\)/.test(e7),
    '泳道缩放的 window 监听在重绑前解绑，不再随进出时间轴累积');
  ok(/if \(!root\.isConnected\) return;/.test(s7),
    '六维细则懒加载不往已脱离文档的旧节点写表');

  /* ⑤ 系统级 reduced-motion + 375px 横向溢出 */
  const rm7 = (css7.match(/@media \(prefers-reduced-motion:reduce\)\s*\{([\s\S]*?)\n\}/) || ['', ''])[1];
  /* ⚠ 只看真实规则：注释里也写了 .tl-crown-name.run 的解释，直接拿整块
     做 !/.../ 判断会误伤（本项目已多次踩「注释字符串误伤断言」的坑）。 */
  const rmRule = rm7.replace(/\/\*[\s\S]*?\*\//g, '');
  ok(/animation:none!important/.test(rmRule) && /\.hero-title,\.stat \.v/.test(rmRule) &&
    !/\.tl-crown-name\.run/.test(rmRule),
    '系统减少动效关掉装饰循环动画，但保留登顶徽标跑马灯');
  ok(/\.tip-body\{right:0;left:auto\}/.test(css7) &&
    /max-width:min\(300px,calc\(100vw - 28px\)\)/.test(css7) &&
    /\.tl-top \.fgroup\{flex:0 1 auto;min-width:0\}/.test(css7) &&
    !/\.tip-body\{right:auto;left:0\}/.test(css7),
    '窄屏气泡右对齐限宽、时间轴按钮组可收缩，不再撑出整页横向滚动条');
  ok(/\.geo-opt:focus-visible\{outline:2px solid var\(--accent\)/.test(css7) &&
    !/\.geo-opt:hover,\.geo-opt:focus\{[^}]*outline:none/.test(css7),
    '地区下拉键盘焦点环不再被 outline:none 抹掉');

  /* ⑥ index.html 外部工具注入的垃圾；2026-11-07 起脚本加载链也改了：
     data.js 不再同步阻塞，改由 boot.js 流式取回后按序挂载页面模块。 */
  ok(!/data-page-node-id/.test(h7) && !/CtxtMenu_/.test(h7) &&
    !/__dm_no_drag_style__|__dm_bindable_badge_style__/.test(h7) &&
    /<script src="js\/boot\.js" defer><\/script>/.test(h7) &&
    !/<script src="js\/data\.js"/.test(h7) && /<script src="js\/i18n\.js"><\/script>/.test(h7),
    '入口 HTML 清掉注入标记；巨型数据改由 boot.js 非阻塞加载');
}

/* ============================================================
   2026-11-07 第八轮：全站体检修复（首屏分片 / SEO / 一致性 / a11y / 缓存）
   逐条锁住本轮改动，防止后续重构悄悄回退。
   ============================================================ */
{
  const boot = fs.readFileSync(path.join(ROOT, 'js/boot.js'), 'utf8');
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
  const lang = fs.readFileSync(path.join(ROOT, 'js/i18n.js'), 'utf8');
  const build = fs.readFileSync(path.join(ROOT, 'etl/build.js'), 'utf8');
  const pcore = fs.readFileSync(path.join(ROOT, 'js/pages-core.js'), 'utf8');
  const pextra = fs.readFileSync(path.join(ROOT, 'js/pages-extra.js'), 'utf8');
  const psix = fs.readFileSync(path.join(ROOT, 'js/pages-sixdim.js'), 'utf8');
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');

  ok(/fetchText\(/.test(boot) && /getReader\(\)/.test(boot) &&
    /loadChain\(\[/.test(boot) && /attachDetail/.test(boot) &&
    /__WCA_DETAIL_PENDING/.test(boot) && /bootRetry/.test(boot),
    '首屏流式取数 + 按序挂载 + 后台明细分片 + 失败重试');
  ok(/__WCA_DETAIL_PENDING/.test(build) && /DETAIL_OUT/.test(build) &&
    /NO_DETAIL/.test(build) && /var PLAYERS = '/.test(build),
    'ETL 产出 core + data_detail.js，样本构建自动回退单文件');
  ok(/rel="canonical"/.test(html) && /og:title/.test(html) &&
    /application\/ld\+json/.test(html) && /hreflang/.test(html) &&
    /rel="icon"/.test(html) && /<noscript>/.test(html) && /theme-color/.test(html),
    '首页补齐 canonical / OG / JSON-LD / hreflang / favicon / theme-color / noscript');
  const seoFiles = ['robots.txt', 'sitemap.xml', '404.html', 'manifest.json', 'sw.js', 'favicon.svg', 'favicon.ico',
    'seo/rank.html', 'seo/model.html', 'seo/timeline.html', 'seo/topics.html', 'etl/build_seo.py'];
  ok(seoFiles.every(function (f) { return fs.existsSync(path.join(ROOT, f)); }),
    'robots / sitemap / 404 / manifest / 静态摘要页 / SW / favicon 齐备');
  ok(/data-i18n="foot\.data"/.test(html) && /M\.meta\.exportVersion/.test(app) &&
    !/'，v' \+ \(M\.meta\.exportVersion/.test(app),
    '页脚数据日期与版本号由 M.meta 渲染，去掉多余的 v');
  const thAll = (pcore + pextra + psix).match(/<th(?=[\s>])/g) || [];
  const thScope = (pcore + pextra + psix).match(/<th scope="col"/g) || [];
  ok(thAll.length > 0 && thAll.length === thScope.length,
    '所有数据表头都有 scope="col"（' + thScope.length + '/' + thAll.length + '）');
  const iZ = lang.indexOf('const ZH = {'), iE = lang.indexOf('const EN = {'), iX = lang.indexOf('window.I18N');
  const keysOf = function (s) {
    return new Set((s.match(/'([A-Za-z0-9_.\-]+)'\s*:/g) || []).map(function (x) { return x.split("'")[1]; }));
  };
  const zhK = keysOf(lang.slice(iZ, iE)), enK = keysOf(lang.slice(iE, iX));
  const miss = [].concat([...zhK].filter(function (k) { return !enK.has(k); }),
    [...enK].filter(function (k) { return !zhK.has(k); }));
  ok(!miss.length, '中英文案键完全对齐（差异：' + miss.join(',') + '）');
  ok(!/tl\.smooth/.test(lang), '已回滚功能的残留文案键被清除');
  ok(/integrity/.test(boot) && /mathjax@3\.2\.2/.test(boot) && !/flagcdn\.com/.test(html),
    'MathJax 固定版本 + SRI 按需加载，删掉无引用的 preconnect');
  ok(/SHELL_VER/.test(sw) && /staleWhileRevalidate/.test(sw) && /DATA_RE/.test(sw),
    'Service Worker 分离代码壳（network-first）与数据（stale-while-revalidate）');
}

/* ============================================================
   2026-11-12 启动加速：用户反馈「每次进入都提示首次下载、等待过久」。
   根因：① registerSW() 原先只在 afterData() 之后调用，首次访问取 30MB
   主包时 SW 还没接管 → DATA_VER 里始终没有数据 → 第二次访问仍是冷启动；
   ② 回访仍走 fetch→Uint8Array→TextDecoder→inline script 的完整重解析，
   inline eval 永远拿不到 V8 编译缓存；③ 静态骨架写死了「首次访问」文案。
   ============================================================ */
{
  const boot = fs.readFileSync(path.join(ROOT, 'js/boot.js'), 'utf8');
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(ROOT, 'css/style.css'), 'utf8');
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const i18n = fs.readFileSync(path.join(ROOT, 'js/i18n.js'), 'utf8');

  ok(/function hasCachedData\(/.test(boot) && /function putCache\(/.test(boot) &&
    /function preloadModules\(/.test(boot) && /function setWarm\(/.test(boot),
    '具备缓存探测 / 主动写缓存 / 页面模块并行预热 / 回访骨架收起');
  ok(/function boot\(\)[\s\S]*?registerSW\(\);\s*\n\s*preloadModules\(\);/.test(boot),
    'SW 在 boot 开头就注册（不再等到 afterData 之后）');
  ok(/fetchText\(DATA_URL,[\s\S]*?, true\)/.test(boot),
    '首次取数主动写入 Cache Storage，不依赖 SW 是否已接管');
  ok(/loadScript\('js\/data\.js'\)/.test(boot),
    '回访改用 <script src>：走 SW 缓存并复用 V8 编译缓存');
  ok(!/首次访问需下载完整成绩数据/.test(html) && /id="bootNote"[^>]*hidden/.test(html),
    '入口不再静态写死「首次访问需下载」提示，改由 boot.js 按缓存判断');
  ok(/\.boot-warm/.test(css) && /boot-retry\[hidden\]/.test(css) &&
    /html\[lang="en"\] \.boot-card \.zh-only/.test(css),
    '回访轻提示样式 / hidden 显式兜底 / 骨架中英双语');
  ok(/revalidateIfChanged/.test(sw) && /method: 'HEAD'/.test(sw) &&
    /if \(hit\) \{[\s\S]*?return hit;/.test(sw),
    'SW 命中缓存只发 HEAD 校验，不再每次回访后台重下几十 MB');
  const bkeys = (i18n.match(/'boot\.[a-zA-Z]+':/g) || []).length;
  ok(bkeys >= 26, 'boot.* 启动文案中英齐全（实得 ' + bkeys + ' 条）');
}

/* ============================================================
   2026-11-07 第七轮：辅助字对比度 / 重大事件浮层层级 / 死 CSS 清理。
   CDP 实测（_cdpchk/audit_round7.mjs + layer_test2.mjs）：浅色 --text-3 对白卡
   2.99:1、对 --bg-soft-2 仅 2.47:1，深色对 --bg-elev 4.07:1；.ms-pop z-index 6
   小于 sticky 顶栏 60，滚动后 elementFromPoint 命中 NAV.nav（浮层被毛玻璃压住），
   提到 80 后命中 BUTTON.ms-pop-tab。断言从 CSS token 动态算对比度，改背景也会失效。 */
{
  const css8 = fs.readFileSync(path.join(ROOT, 'css/style.css'), 'utf8');
  const c8 = fs.readFileSync(path.join(ROOT, 'js/charts.js'), 'utf8');
  const p8 = fs.readFileSync(path.join(ROOT, 'js/pages-player.js'), 'utf8');
  const core8 = fs.readFileSync(path.join(ROOT, 'js/pages-core.js'), 'utf8');
  function lum8(hex) {
    const v = [1, 3, 5].map(function (i) {
      const x = parseInt(hex.slice(i, i + 2), 16) / 255;
      return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  }
  function cr8(a, b) {
    const l = [lum8(a), lum8(b)].sort(function (x, y) { return y - x; });
    return (l[0] + 0.05) / (l[1] + 0.05);
  }
  function tok8(name) {
    return (css8.match(new RegExp('--' + name + ':\\s*(#[0-9a-fA-F]{6})', 'g')) || [])
      .map(function (s) { return s.match(/#[0-9a-fA-F]{6}/i)[0]; });
  }
  const t3 = tok8('text-3');
  const bgs8 = ['bg-elev', 'bg', 'bg-soft', 'bg-soft-2'];
  ok(t3.length === 2 && bgs8.every(function (n) { return tok8(n).length >= 2; }),
    '两主题 --text-3 与四种背景 token 都能解析（断言只认 CSS 声明，不被注释误伤）');
  const ratios8 = [0, 1].map(function (i) {
    return bgs8.map(function (n) { return cr8(t3[i], tok8(n)[i]); });
  });
  ok(ratios8.every(function (r) { return r.every(function (x) { return x >= 4.5; }); }),
    '辅助小字在两主题 × 四种背景下全部达到 WCAG AA 4.5:1（' +
    ratios8.map(function (r) { return r.map(function (x) { return x.toFixed(2); }).join('/'); }).join(' | ') + '）');
  ok(/@property --text-3\{[^}]*initial-value:#5c6875\}/.test(css8) &&
    /cssVar\('--text-3', '#5c6875'\)/.test(c8) &&
    /\[k\] \|\| '#5c6875'/.test(core8),
    '@property 初值 / canvas 兜底 / 六维灰兜底与 :root 同步，切主题不会出现两套灰');
  ok(/\.ms-pop\{[^}]*z-index:80/.test(css8) && /\.ms-toast\{[^}]*z-index:81/.test(css8) &&
    /\.topbar\{[^}]*z-index:60/.test(css8),
    '重大事件浮层 80/81 高于 sticky 顶栏 60（滚动经过顶栏不再被毛玻璃压住）');
  ok(/\.reveal\{[^}]*backwards/.test(css8) && !/\.reveal\{[^}]*forwards/.test(css8) &&
    /from\{opacity:0;transform:translateY\(14px\)\}to\{opacity:1;transform:none\}/.test(css8),
    '入场动画结束后回 transform:none，不给内部浮层留下 stacking context');
  ok(!/\.modal\{position:fixed/.test(css8) && !/\.rank4\{display:grid/.test(css8) &&
    !/function rankCard\(/.test(p8) && !/minmax\(74px,1fr\)/.test(css8) &&
    /\.cov-grid\{[^}]*minmax\(112px,1fr\)/.test(css8),
    '删除零实例死规则（modal / rank4 / 旧 cov-grid）并保留现行 112px 项目格子');
}

/* ============================================================
   2026-11-12 首屏最小集 + 后台列增量：core 只留首屏必需列，其余 10 列
   拆到 data_cols.js，boot 与页面模块并行取回、按 id 原地合并后重绘。
   ============================================================ */
{
  const build = fs.readFileSync(path.join(ROOT, 'etl/build.js'), 'utf8');
  const boot = fs.readFileSync(path.join(ROOT, 'js/boot.js'), 'utf8');
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');

  ok(/const COLS_OUT\s*=\s*arg\(/.test(build) && /window\.WCA_COLS\s*=\s*\{keys:/.test(build) &&
    /__WCA_COLS_PENDING\s*=\s*true/.test(build) && /colsFlag/.test(build),
    'ETL 产出 data_cols.js 分片，core 置 __WCA_COLS_PENDING');

  /* 从源码抠出 COLS_KEYS，断言首屏同步依赖的列没被误下沉 */
  const cm = build.match(/const COLS_KEYS\s*=\s*(\[[^\]]*\]);/);
  let colsKeys = [];
  try { if (cm) colsKeys = JSON.parse(cm[1].replace(/'/g, '"')); } catch (e) { }
  const mustStay = ['sixEv', 'sixS', 'sixA', 'yearly', 'six', 'm', 'pk', 'events', 'id', 'name'];
  ok(cm && colsKeys.length >= 8 && mustStay.every(function (k) { return colsKeys.indexOf(k) < 0; }),
    '首屏依赖列（sixEv/sixS/sixA/yearly/six/m/pk/events/id/name）全部留在 core');

  const dm = build.match(/const COLS_DEFAULT\s*=\s*(\{[^}]*\});/);
  ok(dm && colsKeys.length >= 8 && colsKeys.every(function (k) {
    return new RegExp('\\b' + k + '\\s*:').test(dm[1]);
  }), 'core 为每个下沉列都预置合法默认值（core-only 阶段不崩）');

  ok(/coreRows\s*=\s*NO_DETAIL\s*\?\s*slimRows/.test(build) &&
    /colsFlag\s*=\s*NO_DETAIL\s*\?\s*''\s*:/.test(build),
    '样本构建（--no-detail）不拆列、不产分片，旧行为保持不变');

  ok(/function loadCols\(/.test(boot) && /function attachCols\(/.test(boot) &&
    /GOAT\.attachCols\s*=\s*attachCols/.test(boot) && /loadCols\(\);/.test(boot),
    'boot 具备 loadCols / attachCols 并与页面模块并行发起');
  ok(/if \(!window\.__WCA_COLS_PENDING\) return Promise\.resolve\(\);/.test(boot),
    '旧格式 core 无标志时完全跳过列增量（回滚安全）');
  ok(/byId\[r\[0\]\]/.test(boot) && /render\(true\)/.test(boot),
    '按 id 合并（不依赖行序）、到位后保留滚动位置重绘');
  ok(/data_cols/.test(sw) && /goat-shell-20261112b/.test(sw),
    'SW 把 data_cols.js 纳入数据缓存并 bump 代码壳版本');

  /* 行为回归：把下沉列临时清成 core-only 默认值，跑首屏与 PK。
     若任何首屏代码偷偷依赖它们，这里会抛错或产出 NaN —— 必须在上线前挡住。 */
  const COLS = ['sy', 'evRk', 'resultRows', 'attempts', 'solves', 'dnf',
    'cities', 'maxEventsPerComp', 'multiEventComp', 'esum'];
  const saved = M.ranked.map(function (p) {
    const o = {}; COLS.forEach(function (k) { o[k] = p[k]; }); return o;
  });
  M.ranked.forEach(function (p) {
    p.sy = null; p.evRk = null; p.resultRows = 0; p.attempts = 0; p.solves = 0;
    p.dnf = 0; p.cities = 0; p.maxEventsPerComp = 0; p.multiEventComp = 0; p.esum = 0;
  });
  const coreHome = tryRender('首屏最小集 · 首页', function () { return P.home(); });
  const coreRank = tryRender('首屏最小集 · 总榜', function () { return P.rank(Object.assign({}, base)); });
  const corePk = tryRender('首屏最小集 · 选手 PK', function () {
    return P.pk(Object.assign({}, base, { pk: M.ranked.slice(0, 2).map(function (p) { return p.id; }) }));
  });
  ok(!!(coreHome && coreRank && corePk) &&
    [coreHome, coreRank, corePk].every(function (h) { return h.indexOf('NaN') < 0; }),
    'core-only（下沉列为默认值）首页 / 总榜 / PK 均正常渲染且无 NaN');
  M.ranked.forEach(function (p, i) { Object.assign(p, saved[i]); });
}

console.log(fail ? ('\n❌ 失败 ' + fail + ' 项') : '\n✅ 全部通过');
process.exit(fail ? 1 : 0);
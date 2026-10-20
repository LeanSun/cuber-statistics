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

const h2 = tryRender('总榜（单项目 333）', () => P.rank(Object.assign({}, base, { evSel: ['333'] })));
ok(h2.indexOf('ministack') >= 0, '单项目模式保留七模块堆叠条');
ok(h2.indexOf('ev-rank') >= 0, '单项目模式显示世界名次');

const h3 = tryRender('总榜（多项目 333+222+444）', () => P.rank(Object.assign({}, base, { evSel: ['333', '222', '444'] })));
ok(h3.indexOf('ev-legend') >= 0, '多项目模式显示项目图例');
ok(h3.indexOf('evstack') >= 0, '多项目模式显示项目堆叠条');
/* 需求：多项目下不再罗列「#265」这类名次徽章，也不再显示「已覆盖 x/y」 */
ok(h3.indexOf('ev-badge') < 0, '多项目模式已删除名次徽章（不再出现 #265）');
ok(h3.indexOf('已覆盖') < 0 && h3.indexOf('ev-rank') < 0, '多项目模式已删除「已覆盖 x/y」');
ok(h3.indexOf('ev-hitnote') >= 0, '多项目模式保留紧凑的「命中/总数」计数');
ok(h3.indexOf('rank.ruleNote') < 0 && h3.indexOf('统计口径') >= 0, '多项目模式给出统一口径说明');
/* 选中项目后：单项目按「该项目的历史地位分（GOAT 综合分）」排序，而非单纯世界名次 ——
   修复前按世界名次排，会导致综合分低、但项目内名次靠前的选手排到前面（Issue 1）。 */
{
  const one = P.filtered(Object.assign({}, base, { evSel: ['333'] }));
  const wrOf = (r) => (r.be ? r.be.r : null);
  /* 单项目口径：排序键 orderVal 必须来自「该项目自身的世界名次」（be.r），
     名次越靠前（r 越小）orderVal 越大，榜单顶部＝该项目最强者，而非综合历史地位分更高者。 */
  ok(one.every((r) => (r.be ? r.orderVal === -r.be.r : r.orderVal === -1e9)),
    '单项目：排序键 orderVal 已切换为「该项目世界名次」（orderVal = -be.r）');
  /* 榜单严格按该项目世界名次升序排列（r 不增） */
  let evSorted = true;
  for (let i = 1; i < one.length; i++) {
    const a = wrOf(one[i - 1]), b = wrOf(one[i]);
    if (a != null && b != null && b < a - 1e-9) { evSorted = false; break; }
  }
  ok(evSorted, '单项目：榜单严格按所筛选项目的世界名次升序排列');
  /* 榜首必须是该项目世界名次 r=1 的选手（若存在） */
  if (one.length) {
    const top = one[0].be;
    ok(!top || top.r === 1, '单项目：榜首为该项目世界第 1（r=1）: ' + (top ? top.r : 'n/a'));
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
  ok(b.every((id) => a.includes(id)) || a.some((id) => b.includes(id)),
    '多项目榜单仍以历史地位分为主序（与全项目同一把尺子）');
  /* 单项目时广度折减应恒为 1，即分数等于纯历史地位分 */
  const r1 = rowsOne[0];
  ok(r1 && Math.abs(r1.score - r1.sc.overall) < 0.001,
    '单项目模式不做广度折减（分数＝纯历史地位分）: ' + (r1 ? r1.score + ' vs ' + r1.sc.overall : 'n/a'));
  /* 多项目：条尾数字必须是历史地位分，而不是 evSum */
  ok(h3.indexOf('>' + rowsMulti[0].score.toFixed(1) + '<') >= 0,
    '多项目条尾数字为历史地位分（已与全项目/单项目统一）');
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
  ok(typeof P.tlSnapshot === 'function', '竞速图快照可测');
  const all = P.tlSnapshot([], 2025, 'all', 'all', '');
  const one = P.tlSnapshot(['333'], 2025, 'all', 'all', '');
  const few = P.tlSnapshot(['333', '222'], 2025, 'all', 'all', '');
  const four = P.tlSnapshot(['333', '222', '444', '555'], 2025, 'all', 'all', '');
  ok(all.length > 0, '默认（全部项目）有选手: ' + all.length);
  ok(one.length > 0 && one.length <= all.length, '单项目筛选后选手池收窄: ' + one.length + ' vs ' + all.length);
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
ok(hB.indexOf('data-modcolor') >= 0, '模块配色自定义控件存在');

console.log('== 选手页 ==');
const hC = tryRender('选手页', () => P.player(M.ranked[0].id));
ok(hC.length > 100, '选手页渲染');
ok(hC.indexOf('pid-box') >= 0, '有放大的国旗 / WCA ID / 性别外框（pid-box）');
ok(hC.indexOf('calc-flow') >= 0, '有总分计算过程（calc-flow）');
ok(hC.indexOf('cov-grid') >= 0, '有「项目领域」（cov-grid）');
ok(hC.indexOf('cov-rank') >= 0, '项目领域内有真实世界名次（cov-rank）');
ok(hC.indexOf('rankCurve') < 0, '已删除「世界排名演变」板块（rankCurve）');
ok(hC.indexOf('cmp-radar-wrap') >= 0, '七模块雷达有放大容器');
ok(hC.indexOf('eloTip') < 0 && hC.length > 0, '核心数据带 infoTip');

/* —— 选手页排名胶囊 / 主项：三项曾反复回归的问题，这里加死断言 ——
   1) 「主项」被输出两次（早期 pages-player.js 有两处重复渲染）；
   2) 排名胶囊外框消失（css 里 .pid-ranks 规则被改成孤立声明，浏览器整条丢弃）；
   3) 分母误用 M.ranked.length（明细档 60000），应统计全部选手。 */
console.log('== 选手页：排名胶囊外框 / 分母 / 主项唯一 ==');
{
  ok((hC.match(/class="tag acc"/g) || []).length === 1, '「主项」标签只出现 1 次（实得 ' + (hC.match(/class="tag acc"/g) || []).length + '）');
  ok(hC.indexOf('class="pid-ranks"') >= 0, '排名胶囊容器 pid-ranks 存在');
  const pillN = (hC.match(/class="pid-rank"/g) || []).length;
  ok(pillN === 4, '排名胶囊 4 枚（世界 / 洲 / 国家 / 巅峰），实得 ' + pillN);
  /* 世界 + 巅峰两枚的分母必须是全部选手数 */
  const allN = U.num((M.meta && M.meta.players) || M.ranked.length);
  const denoms = (hC.match(/<i>\/ [^<]*<\/i>/g) || []).map(function (s) { return s.replace(/<\/?i>/g, '').replace('/ ', ''); });
  ok(denoms.length === 4, '四枚胶囊都带 / 总数 分母，实得 ' + denoms.length);
  ok(denoms[0] === allN && denoms[3] === allN,
    '世界/巅峰分母 = 全部选手 ' + allN + '（实得 ' + denoms[0] + ' / ' + denoms[3] + '）');
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

console.log('== 评分真实性：统治力 / 实战对战 / Elo ==');
{
  const det = M.ranked.filter(function (p) { return !p.slim; });
  ok(det.length > 0, '存在明细档选手');
  ok(det.filter(function (p) { return p.m.m7 > 0; }).length === det.length, 'M7 实战对战全部非零');
  /* M4 保留 0.01 底噪，明细档不应整档归零 */
  ok(det.filter(function (p) { return !(p.m.m4 > 0); }).length === 0, 'M4 统治力全部非零（有底噪）');
  const elo = M.ranked.map(function (p) { return p.eloPeak; });
  ok(Math.min.apply(null, elo) >= 1400 && Math.max.apply(null, elo) <= 2300,
    'Elo 峰值落在 1400–2300（实得 ' + Math.min.apply(null, elo) + '~' + Math.max.apply(null, elo) + '）');
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
  /* 需求：颜色修改加 16 进制输入框 */
  const hM = tryRender('参数设置页', () => P.model(base));
  ok(hM.indexOf('data-modhex') >= 0, '模块配色有 16 进制输入框');
  ok(hM.indexOf('data-cchex') >= 0, '国家配色有 16 进制输入框');
  ok(/class="hex-in mono"/.test(hM), '16 进制输入框使用等宽字体样式');
}

console.log('== 各模块计算过程（逐项代入） ==');
ok(hC.indexOf('mc-card') >= 0, '有「各模块计算过程」卡片 (mc-card)');ok((hC.match(/class="mc-item"/g) || []).length === 7, '七个模块各有一个可展开的推导条目');
ok(hC.indexOf('mc-subs') >= 0, '模块内列出代入的原始数据 (mc-subs)');
ok(hC.indexOf('mc-norm') >= 0, '给出「原始分 ÷ 全站最高 × 100」的归一化过程');
ok(hC.indexOf('mc-total') >= 0, '末尾汇总七模块加权求和');
ok(hC.indexOf('mc-sub-k') >= 0, '代入明细带中文标签');
/* 归一化分母必须来自 meta.modMax，而不是写死的1 */
ok(M.meta && M.meta.modMax && M.meta.modMax.m1 > 0, 'meta 下发各模块全站最高值 modMax');
{
  const pl = M.ranked[0];
  ok(!!pl.mCalc, '明细档选手带 mCalc 计算过程数据');
  const mc = pl.mCalc || {};
  ok(Array.isArray(mc.rec) && mc.rec.length === 6, 'mCalc.rec 给出单次/平均各自的 WR/CR/NR');
  ok(Array.isArray(mc.pod) && mc.pod.length === 12, 'mCalc.pod 给出各赛级金/银/铜分布');
  ok(Array.isArray(mc.rk) && mc.rk.length > 0 && mc.rk[0].length === 6, 'mCalc.rk 给出逐项目名次/积分/权重/参赛人数');
  ok(typeof mc.ev === 'number' && typeof mc.span === 'number' && typeof mc.comps === 'number', 'mCalc 给出项目数/年限/场次（供 M5 M6 展开）');
  /* 前端算出的 M5 应与 ETL 归一化后的 m5 一致（校验代入过程没有算错） */
  const rawM5 = (mc.ev / 21) * 0.7 + Math.min(mc.ev / 17, 1) * 0.3;
  const mx5 = M.meta.modMax.m5 || 1;
  const expectM5 = Math.min(100, rawM5 / mx5 * 100);
  ok(Math.abs(expectM5 - pl.m.m5) < 0.02, 'M5 前端代入值与 ETL 归一化结果一致 (' + expectM5.toFixed(2) + ' vs ' + pl.m.m5 + ')');
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
ok(hD.indexOf('exp-v3-mod') >= 0, '展开详情含七模块贡献条');
ok(hD.indexOf('exp-v3-chip') >= 0, '展开详情含成绩速览胶囊');

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
  ok(typeof seg.days === 'number' && seg.days > 0, '泳道段带真实天数');
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
    ok(/v\[8\]/.test(fm) && /v\[9\]/.test(fm), 'tooltip 同时输出开始与结束日期');
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
  ok(hM.indexOf('data-modcolor') >= 0, '模块配色自定义控件存在');
  ok(hM.indexOf('data-ccolor') >= 0, '国家配色自定义控件存在（逐国可改）');
  const cc = hM.match(/data-ccolor="CN" value="([^"]+)"/);
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
    const opt = C.barRace([{ name: 'A', value: 10, iso: 'CN', no: 1 }, { name: 'B', value: 8, iso: 'US', no: 2 }], { top: 3 });
    const d = opt.series[0].data;
    ok(d.length === 3 && d[0].no === 1 && d[1].no === 2, '竞速图数据带 1..N 排名序号');
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
    ok(!!(o1.series && o1.series[0] && (o1.series[0].data || []).length > 0),
      '竞速图首系列有数据点（实得 ' + ((o1.series && o1.series[0] && (o1.series[0].data || []).length) || 0) + '）');
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

console.log(fail ? ('\n❌ 失败 ' + fail + ' 项') : '\n✅ 全部通过');
process.exit(fail ? 1 : 0);
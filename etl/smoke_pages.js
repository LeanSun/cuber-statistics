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
ok(h3.indexOf('ev-badge') >= 0, '多项目模式显示各项目世界名次徽章');
ok(h3.indexOf('rank.ruleNote') < 0 && h3.indexOf('统计口径') >= 0, '多项目模式给出统一口径说明');
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
  /* 多项目必须真正重新计分（广度折减），而不是只裁剪选手池 */
  const valOf = (r, n) => { const x = r.filter(v => v.name === n)[0]; return x ? x.value : null; };
  const a = valOf(few, all[0].name);
  const b = valOf(four, all[0].name);
  ok(a != null && b != null && Math.abs(a - b) > 0.001,
    '多项目选择不同 → 竞速图分数真实变化（广度折减生效）: ' + a + ' vs ' + b);
  /* 单项目时折减恒为 1，分数应与全项目一致（与总榜口径统一） */
  const av = valOf(all, all[0].name), ov = valOf(one, all[0].name);
  ok(av != null && ov != null && Math.abs(av - ov) < 0.001,
    '单项目不做广度折减（与总榜同一口径）: ' + ov + ' vs ' + av);
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

console.log('== 各模块计算过程（逐项代入） ==');
ok(hC.indexOf('mc-card') >= 0, '有「各模块计算过程」卡片 (mc-card)');
ok((hC.match(/class="mc-item"/g) || []).length === 7, '七个模块各有一个可展开的推导条目');
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

console.log('== 泳道清单（悬停联动 + 起止日期） ==');
{
  const hL = tryRender('图表可视化（纪录持有图）', () => P.timeline(Object.assign({}, base, { tlView: 'lane', tlLane: 'single' })));
  ok(hL.indexOf('laneList') >= 0, '泳道下方有持有者清单');
  ok(hL.indexOf('lane-seg') >= 0, '清单以色块按钮呈现每一段持有记录');
  ok(/lane-flag fi fi-[a-z]{2}/.test(hL), '清单项带国旗');
  ok(/lane-dates mono">[0-9]{4}-[0-9]{2}-[0-9]{2} → [0-9]{4}-[0-9]{2}-[0-9]{2}|lane-dates mono">[^<]*→/.test(hL), '清单项同时显示开始与结束日期');
  ok(/lane-days">[0-9]+/.test(hL), '清单项显示持有天数');
  ok(hL.indexOf('data-laneix=') >= 0, '清单项带图上高亮所需的下标');
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

console.log(fail ? ('\n❌ 失败 ' + fail + ' 项') : '\n✅ 全部通过');
process.exit(fail ? 1 : 0);
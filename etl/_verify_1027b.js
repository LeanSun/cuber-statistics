/* 2026-10-27 第二批校验：
   ⑥ 展开行 WCA ID 胶囊（去掉「WCA ·」前缀）+ 国旗不再被 CSS 抹掉
   ⑦ 竞速图分数两位小数 / 不裁切 / 上下留白
   ⑧ 竞速图在单 / 多项目下「单次 / 平均」筛选真的生效
   ⑨ 参数设置页六维占比 = 滑杆 + 数字框
   ⑩ 选手页雷达逐轴满分、信息栏顺序、六维贡献真实占比、项目格子居中、在位月数/国家赛口径
   跑法：SMOKE_DATA=js/data.js node etl/_verify_1027b.js */
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
const M = win.MOCK, P = win.P, Ch = win.Charts;
let fail = 0;
function ok(c, m) { if (!c) { console.error('FAIL:', m); fail++; } else console.log('  ok  ', m); }

const css = fs.readFileSync(path.join(ROOT, 'css', 'style.css'), 'utf8');

console.log('== ⑥ 展开行：WCA ID 胶囊 + 国旗不被 CSS 抹掉 ==');
{
  const p = M.ranked.find((x) => x.six && !x.slim);
  const h = P.expandBody(p, { recType: 'all', tab: 'career' });
  ok(h.indexOf('WCA ·') < 0 && h.indexOf('WCA&nbsp;·') < 0, '姓名后不再有「WCA ·」前缀');
  const m = h.match(/<span class="exp-v3-wca"[^>]*>([^<]*)<\/span>/);
  ok(!!m, 'WCA ID 单独成胶囊: ' + (m ? m[1] : '(无)'));
  ok(m && m[1].trim() === String(p.wcaId || p.id).trim(), '胶囊内容就是完整 WCA ID（未被截断）: ' + (m ? m[1] : ''));
  ok(/class="exp-v3-meta"/.test(h) && /<span class="m-country">/.test(h), 'meta 行仍在（国旗 → 国名 → 性别 → 参赛时间）');
  /* 根因：`.exp-v3-meta span{background:...}` 是后代选择器 + background 简写，
     会把 .fi-xx 的 background-image 重置成 none → 国旗整片空白。 */
  ok(/\.exp-v3-meta>span\{[^}]*background-color/.test(css.replace(/\s+/g, ' ')) ||
    /\.exp-v3-meta>span\{/.test(css.replace(/\s+/g, ' ')), '胶囊样式只作用于 meta 的直接子项（>span）');
  ok(!/\.exp-v3-meta span\{/.test(css), '不再有会命中 .fi 的后代选择器 .exp-v3-meta span');
}

console.log('== ⑦ 竞速图：两位小数 / 不裁切 / 上下留白 ==');
{
  const rows = P.tlSnapshot([], 2025, 'all', 'all', '').slice(0, 8).map((r, i) => ({
    id: r.id, name: r.name, iso: r.country, value: r.value, rank: i + 1, no: i + 1, color: '#888', flag: ''
  }));
  const opt = Ch.barRace ? Ch.barRace(rows, { top: 8, duration: 0 }) : null;
  if (!opt) { console.log('  (Charts.barRace 未导出，跳过)'); }
  else {
    const s = opt.series[0];
    ok(s.clip === false, 'series.clip = false（首末名不再被裁成半条）');
    ok(opt.grid.top >= 30 && opt.grid.bottom >= 30, '上下留白 ≥30: top=' + opt.grid.top + ' bottom=' + opt.grid.bottom);
    /* 直接跑 renderItem 拿条尾文字 */
    let txt = '';
    try {
      const api = {
        value: (i) => (i === 0 ? rows[0].value : 1),
        coord: (a) => [a[0], 40],
        size: () => [300, 40]
      };
      const g = s.renderItem({ dataIndex: 0 }, api);
      const t = (g.children || []).filter((c) => c.type === 'text');
      txt = t.length ? String(t[t.length - 1].style.text) : '';
    } catch (e) { txt = 'ERR ' + e.message; }
    ok(/^\d+\.\d{2}$/.test(txt), '条尾分数保留两位小数: "' + txt + '"');
  }
}

console.log('== ⑧ 竞速图：单 / 多项目下「单次 / 平均」筛选生效 ==');
{
  [['单项目 333', ['333']], ['多项目 333+222', ['333', '222']]].forEach(function (cse) {
    const evs = cse[1];
    const A = P.tlSnapshot(evs, 2025, 'all', 'all', '');
    const S = P.tlSnapshot(evs, 2025, 'single', 'all', '');
    const G = P.tlSnapshot(evs, 2025, 'avg', 'all', '');
    const key = (a) => a.slice(0, 10).map((x) => x.id + ':' + x.value.toFixed(2)).join('|');
    const kA = key(A), kS = key(S), kG = key(G);
    ok(kS !== kA, cse[0] + ' 单次口径与总计不同');
    ok(kG !== kA, cse[0] + ' 平均口径与总计不同');
    ok(kS !== kG, cse[0] + ' 单次与平均彼此不同');
    const topA = A.length ? A[0].value.toFixed(2) : '-';
    const topS = S.length ? S[0].value.toFixed(2) : '-';
    const topG = G.length ? G[0].value.toFixed(2) : '-';
    console.log('      ' + cse[0] + ' 榜首：总计 ' + topA + ' / 单次 ' + topS + ' / 平均 ' + topG);
  });
  /* 演化仍然有效（不能因为改了取值口径就变成静态） */
  const seq = [2005, 2012, 2019, 2025].map((y) => {
    const s = P.tlSnapshot(['333'], y, 'all', 'all', '');
    return s.length ? Math.round(s[0].value * 100) / 100 : 0;
  });
  ok(seq.some((v, i) => i > 0 && Math.abs(v - seq[i - 1]) > 0.05), '单项目仍随年份推进: ' + seq.join(' / '));
}

console.log('== ⑨ 参数设置页：六维占比 = 滑杆 + 数字框 ==');
{
  const h = P.model({ mdSection: 'overview' });
  ok((h.match(/class="wrange"/g) || []).length === 6, '六行各一根滑杆');
  ok((h.match(/class="wnum"/g) || []).length === 6, '六行各一个数字框');
  ok((h.match(/type="range"/g) || []).length === 6, '滑杆 input type=range');
  ok(h.indexOf('wcol-fill') < 0, '旧的「可拖拽柱状图」已移除');
  ok(h.indexOf('id="wSum"') >= 0 && h.indexOf('id="wReset"') >= 0 && h.indexOf('id="wEven"') >= 0,
    '合计 / 恢复默认 / 平均分配 三个控件仍在');
}

console.log('== ⑩ 选手页：雷达满分 / 信息栏 / 贡献条 / 格子居中 ==');
{
  const p = M.ranked.find((x) => x.six && !x.slim);
  const h = P.player(p.id);
  /* 信息栏：姓名下面紧跟 pid-box（国籍 / WCA ID / 性别） */
  const iName = h.indexOf('pcard-h1');
  const iPid = h.indexOf('class="pid-box"');
  const iScore = h.indexOf('class="pcard-score"');
  const iTags = h.indexOf('class="p-tags"');
  ok(iName > 0 && iPid > iName, 'pid-box 在姓名之后');
  ok(iPid < iTags, 'pid-box 在标签行之前（即紧邻姓名下方）');
  ok(iScore > iName, '综合能力分与身份块同排（右列）');
  ok(/class="pcard-topline"[\s\S]{0,400}class="pcard-idcol"/.test(h), '左列有独立容器 pcard-idcol');
  /* 雷达：逐轴满分 */
  const cmp = P.playerCompare(p);
  ok(!!cmp, 'playerCompare 可用（sixK 已定义）');
  const opt = Ch.radar({ rows: cmp.series, indicators: cmp.indicators },
    { radius: '46%', max: [1154, 2574, 1958, 1439, 1158, 1564], capAt: 2 });
  /* PK 页雷达此前读 p.m（旧七模块）+ sixK 未定义 → 一进来就抛错；顺手回归一下 */
  let pkOk = true, pkErr = '';
  try { const hp = P.pk({ pk: [p.id, M.ranked[1].id] }); pkOk = hp.indexOf('pk-radar-wrap') > 0; }
  catch (e) { pkOk = false; pkErr = e.message; }
  ok(pkOk, 'PK 页可渲染且含雷达（sixK 已定义）' + (pkErr ? ' — ' + pkErr : ''));
  const inds = opt.radar.indicator;
  ok(inds.length === 6 && inds[0].max === 1154 && inds[1].max === 2574, '逐轴满分生效: ' + inds.map((x) => x.max).join('/'));
  const vals = opt.series[0].data[0].value;
  const real = opt.series[0].data[0].real;
  ok(real[2] > inds[2].max, '真实值允许超出满分（M3 ' + real[2].toFixed(0) + ' > 满分 ' + inds[2].max + '）');
  ok(vals[2] <= inds[2].max * 2 + 1e-6, '超出的部分被封顶在 2 倍以内: ' + vals[2].toFixed(0));
  ok(Math.abs(real[2] - vals[2]) > 1, '封顶只在图形上生效，real 仍保留真实值');
  /* 六维贡献条 = 真实占比 */
  const iBk = h.indexOf('breakdown-table');
  const seg = h.slice(iBk, iBk + 3000);
  const ws = (seg.match(/class="bk-bar"[^>]*><i style="width:([\d.]+)%/g) || [])
    .map((s) => parseFloat(s.match(/width:([\d.]+)%/)[1]));
  const ps = (seg.match(/class="bk-num">([\d.]+)%<\/span>/g) || [])
    .map((s) => parseFloat(s.replace(/[^\d.]/g, '')));
  ok(ws.length >= 6, '六维贡献条数量: ' + ws.length);
  const wsum = ws.reduce((a, b) => a + b, 0);
  ok(Math.abs(wsum - 100) < 2, '条形合计 ≈100%（真实占比，不再全部撑满）: ' + wsum.toFixed(1));
  ok(ws.every((w) => w <= 100.01), '没有任何一条被撑满 100%: ' + ws.join('/'));
  /* 在位月数 / 国家赛口径 */
  ok(h.indexOf('在任一项目上位居世界第一的累计月数') >= 0, '「在位月数」给出了含义说明');
  const TT = win.I18N;
  ok(h.indexOf(TT('pod.level.NC')) >= 0 && h.indexOf(TT('col.months')) >= 0,
    '核心数据含国家赛 / 在位月数两栏（' + TT('pod.level.NC') + '、' + TT('col.months') + '）');
  /* 项目格子：垂直居中 */
  ok(/\.cov-cell\{[^}]*justify-content:center/.test(css.replace(/\s+/g, ' ')), '项目格子内容垂直居中（justify-content:center）');
}

console.log(fail ? ('\n❌ 失败 ' + fail + ' 项') : '\n✅ 全部通过');
process.exit(fail ? 1 : 0);

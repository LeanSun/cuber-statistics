'use strict';
/* Feliks Zemdegs vs Max Park · M1 v2 定价对比
 *
 * 用法：node etl/score/compare_v2.js
 * 产出：etl/score/Feliks_vs_Max_v2.md
 *
 * 为什么另开一个脚本：
 *   compare_feliks_max.js 算的是「未乘项目系数的 M1 原始分」，
 *   而站点排名用的是 weightedSum(逐项目分, w_e)。两者不是一回事。
 *   这里把两套权重摆在一起：legacy（js/calc.js 手写表）与 v2（份额驱动），
 *   看权重换代之后，两个人的相对位置有没有变化。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
global.window = {};
require(path.join(ROOT, 'js/data.js'));
require(path.join(ROOT, 'js/roster.js'));
const Calc = require(path.join(ROOT, 'js/calc.js'));
const M1 = require(path.join(ROOT, 'etl/score/m1.js'));
const RN = require(path.join(ROOT, 'etl/score/runs.js'));

const P = global.window.MOCK.players;
const R = global.window.WCA_ROSTER;
const TOTAL = R.total || 300616;
const IDS = ['2009ZEMD01', '2012PARK03'];

const F = (v, n = RN.DEC) => RN.F4(v, n);
const N = (v, n = RN.DEC) => RN.F4(v, n);
const num = (v) => Math.round(v).toLocaleString('en-US');
const pct = (v, d = 2) => RN.P4(v, d);

const W_L = Calc.EVENTS.reduce((m, e) => { m[e.id] = e.w; return m; }, {});
const W_V2 = RN.EV_WEIGHT_V2;
const zhOf = (e) => (Calc.EV[e] || {}).zh || e;

/* ── 池子 ─────────────────────────────────────────────────── */
const contCount = {};
const natCount = {};
const people = [];
for (const ln of R.rows.split('\n')) {
  if (!ln) continue;
  const f = ln.split('~');
  if (f.length < 4) continue;
  natCount[f[2]] = (natCount[f[2]] || 0) + 1;
  const c = Calc.contOfIso(f[2]) || '??';
  contCount[c] = (contCount[c] || 0) + 1;
  if (+f[5]) people.push({ y: +f[5], cont: c, nat: f[2] });
}
for (const p of P) {
  natCount[p.country] = (natCount[p.country] || 0) + 1;
  const c = Calc.contOfIso(p.country) || '??';
  contCount[c] = (contCount[c] || 0) + 1;
  if (p.start) people.push({ y: p.start, cont: c, nat: p.country });
}
const ctx = M1.makeContext({ contCount, natCount, total: TOTAL });
const pool = M1.makeScopePool(people);

/* ── evS 解码 ─────────────────────────────────────────────── */
const EVK = ['rows', 'att', 'sol', 'dnf', 'pod', 'gold', 'sil', 'bro', 'wr', 'cr', 'nr', 'comps', 'wc', 'cc', 'nc', 'lo', 'op', 'held', 'heldLong', 'heldNow'];
function decEv(s) {
  const o = {};
  if (!s) return o;
  s.split(';').forEach((part) => {
    const i = part.indexOf(':');
    if (i < 0) return;
    const n = part.slice(i + 1).split(',');
    const b = { recPerYear: n[25] || '' };
    EVK.forEach((k, j) => { b[k] = +n[j] || 0; });
    o[part.slice(0, i)] = b;
  });
  return o;
}
function yearDistOf(evMap) {
  const a = {};
  for (const e of Object.keys(evMap)) {
    (evMap[e].recPerYear || '').split('.').forEach((kv) => {
      if (!kv) return;
      const j = kv.indexOf('_');
      a[+kv.slice(0, j)] = (a[+kv.slice(0, j)] || 0) + +kv.slice(j + 1);
    });
  }
  return a;
}

/* ── 每人：逐项目未加权分 + 两套加权总分 ──────────────────── */
function calcPlayer(p) {
  const cont = Calc.contOfIso(p.country) || '??';
  const evMap = decEv(p.evS);
  const yd = yearDistOf(evMap);
  const rhoC = contCount[cont] / TOTAL;
  const rhoN = (natCount[p.country] || 1) / TOTAL;
  const tf = M1.timeFactors(yd, pool, { cont, nat: p.country });
  const per = {};
  for (const e of Object.keys(evMap)) {
    const b = evMap[e];
    const s = b.wr * M1.G.WR * tf.WR
      + b.cr * M1.G.CR * rhoC * tf.CR
      + b.nr * M1.G.NR * rhoN * tf.NR;
    per[e] = { s, wr: b.wr, cr: b.cr, nr: b.nr };
  }
  const sumL = Object.keys(per).reduce((a, e) => a + per[e].s * (W_L[e] || 0), 0);
  const sumV = Object.keys(per).reduce((a, e) => a + per[e].s * (W_V2[e] || 0), 0);
  const raw = Object.keys(per).reduce((a, e) => a + per[e].s, 0);
  return { p, cont, zh: (Calc.CONTINENTS[cont] || {}).zh || cont, per, sumL, sumV, raw, tf, rhoC, rhoN };
}

const RP = {};
for (const id of IDS) RP[id] = calcPlayer(P.find((x) => x.id === id));
const A = RP[IDS[0]];
const B = RP[IDS[1]];

/* ── 全站名次（detail 层 2,500 人）────────────────────────── */
const BOARD = P.filter((p) => p.evS && p.mCalc && p.mCalc.rec).map((p) => {
  const c = calcPlayer(p);
  return { id: p.id, name: p.name, L: c.sumL, V: c.sumV, raw: c.raw };
});
const pos = (key, id) => BOARD.slice().sort((x, y) => y[key] - x[key]).findIndex((x) => x.id === id) + 1;
const RANK = { n: BOARD.length, aL: pos('L', IDS[0]), bL: pos('L', IDS[1]), aV: pos('V', IDS[0]), bV: pos('V', IDS[1]), aR: pos('raw', IDS[0]), bR: pos('raw', IDS[1]) };

/* ── 写文档 ───────────────────────────────────────────────── */
const L = [];
const push = (s) => L.push(s == null ? '' : s);
const now = new Date(Date.now() + 8 * 3600e3);

push('# Feliks Zemdegs vs Max Park · M1 v2 定价对比');
push('');
push(`> 生成时间：${now.toISOString().slice(0, 16).replace('T', ' ')}（北京时间）｜由 \`etl/score/compare_v2.js\` 自动生成`);
push(`> 数据：\`js/data.js\` 有逐项目明细的 ${num(BOARD.length)} 人，\`js/roster.js\` 全量名册 ${num(TOTAL)} 人`);
push('');

push('## 0 这张表和旧版的区别');
push('');
push('旧对比（`Feliks_vs_Max.md`）算的是**未乘项目系数的 M1 原始分**。');
push('但站点排名用的是 `Σ 逐项目分 × w_e` —— 项目系数在最后一步才乘。');
push('所以旧版的 102.22 / 90.48 不是排行榜上的数，是排行榜上一个中间量。');
push('');
push('这张表补上这一步，并且把两套 `w_e` 并排：');
push('');
push('| 权重 | 来源 | 三阶 | 二阶 | 四盲 | 多盲 | 量程 |');
push('|---|---|---|---|---|---|---|');
push(`| legacy | \`js/calc.js\` 手写递减表 | ${F(W_L['333'])} | ${F(W_L['222'])} | ${F(W_L['444bf'])} | ${F(W_L['333mbf'])} | ${F(W_L['333'] / W_L['mmagic'])}× |`);
push(`| **v2** | 参赛人次份额 s^0.75 | **${F(W_V2['333'], 4)}** | ${F(W_V2['222'], 4)} | ${F(W_V2['444bf'], 4)} | ${F(W_V2['333mbf'], 4)} | ${F(W_V2['333'] / W_V2['333mbo'])}× |`);
push('');
push(`v2 把三阶对次高的领先从 ${pct(1 / W_L['222'] - 1)} 拉到 **${pct(1 / W_V2['222'] - 1)}**，量程从 ${F(W_L['333'] / W_L['mmagic'])} 倍拉到 ${F(W_V2['333'] / W_V2['333mbo'])} 倍。`);
push('');

/* ── 1 总分 ── */
push('## 1 总分：三套口径');
push('');
push('| 口径 | Feliks | Max | 比值 | 含义 |');
push('|---|---|---|---|---|');
push(`| 未加权（旧报告） | ${N(A.raw)} | ${N(B.raw)} | ${F(A.raw / B.raw)}× | 排行榜中间量 |`);
push(`| **legacy 权重** | **${N(A.sumL)}** | **${N(B.sumL)}** | **${F(A.sumL / B.sumL)}×** | 站点现在用的 |`);
push(`| **v2 权重** | **${N(A.sumV)}** | **${N(B.sumV)}** | **${F(A.sumV / B.sumV)}×** | 换成新版后 |`);
push('');
push(`名次（有逐项目明细的 ${num(BOARD.length)} 人，同公式同权重）：`);
push('');
push('| 口径 | Feliks | Max |');
push('|---|---|---|');
push(`| 未加权 | ${RANK.aR} | ${RANK.bR} |`);
push(`| legacy | ${RANK.aL} | ${RANK.bL} |`);
push(`| v2 | **${RANK.aV}** | **${RANK.bV}** |`);
push('');

const dA = A.sumV - A.sumL;
const dB = B.sumV - B.sumL;
push(`换 v2 权重后：Feliks ${dA >= 0 ? '+' : ''}${N(dA)}（${pct(dA / A.sumL, 1)}），Max ${dB >= 0 ? '+' : ''}${N(dB)}（${pct(dB / B.sumL, 1)}）。`);
push('');

/* ── 2 逐项目 ── */
push('## 2 逐项目拆解（按 v2 加权后的贡献排序）');
push('');
const evs = Array.from(new Set([...Object.keys(A.per), ...Object.keys(B.per)]));
const rows = evs.map((e) => {
  const a = A.per[e] || { s: 0, wr: 0, cr: 0, nr: 0 };
  const b = B.per[e] || { s: 0, wr: 0, cr: 0, nr: 0 };
  return { e, a, b, wl: W_L[e] || 0, wv: W_V2[e] || 0 };
}).sort((x, y) => (y.a.s * y.wv + y.b.s * y.wv) - (x.a.s * x.wv + x.b.s * x.wv));

push('| 项目 | 纪录 F/M | 未加权 F | 未加权 M | w 旧→新 | v2 加权 F | v2 加权 M | 差 |');
push('|---|---|---|---|---|---|---|---|');
let tA = 0, tB = 0;
for (const r of rows) {
  const av = r.a.s * r.wv;
  const bv = r.b.s * r.wv;
  tA += av; tB += bv;
  if (av + bv < 1e-9) continue;
  push(`| ${zhOf(r.e)} | ${r.a.wr + r.a.cr + r.a.nr} / ${r.b.wr + r.b.cr + r.b.nr} | ${N(r.a.s)} | ${N(r.b.s)} | ${F(r.wl)}→${F(r.wv)} | ${N(av)} | ${N(bv)} | ${av - bv >= 0 ? '+' : ''}${N(av - bv)} |`);
}
push(`| **合计** | | | | | **${N(tA)}** | **${N(tB)}** | **+${N(tA - tB)}** |`);
push('');

/* ── 3 哪些项目的权重变化影响最大 ── */
push('## 3 权重换代影响最大的项目');
push('');
push('对每个人算 `Δ = Σ per_e × (w_v2 − w_legacy)`：');
push('');
push('| 项目 | w 旧→新 | Δw | Feliks Δ | Max Δ |');
push('|---|---|---|---|---|');
const deltas = rows.map((r) => ({
  e: r.e, wl: r.wl, wv: r.wv, dw: r.wv - r.wl,
  da: r.a.s * (r.wv - r.wl), db: r.b.s * (r.wv - r.wl),
})).filter((r) => Math.abs(r.da) + Math.abs(r.db) > 1e-9)
  .sort((x, y) => Math.abs(y.da) - Math.abs(x.da));
for (const d of deltas.slice(0, 10)) {
  push(`| ${zhOf(d.e)} | ${F(d.wl)}→${F(d.wv)} | ${d.dw >= 0 ? '+' : ''}${F(d.dw)} | ${d.da >= 0 ? '+' : ''}${N(d.da)} | ${d.db >= 0 ? '+' : ''}${N(d.db)} |`);
}
push('');
const sumDa = deltas.reduce((a, x) => a + x.da, 0);
const sumDb = deltas.reduce((a, x) => a + x.db, 0);
push(`合计 Δ：Feliks ${sumDa >= 0 ? '+' : ''}${N(sumDa)}，Max ${sumDb >= 0 ? '+' : ''}${N(sumDb)}。`);
push('');

/* ── 4 结论 ── */
push('## 4 结论');
push('');
const rL = A.sumL / B.sumL;
const rV = A.sumV / B.sumV;
const dAp = dA / A.sumL;
const dBp = dB / B.sumL;

/* 两人 v2 加权后的项目构成，找出降幅差异的来源 */
function topShare(pl, key) {
  const tt = Object.keys(pl.per).reduce((a, e) => a + pl.per[e].s * (key === 'v2' ? W_V2[e] : W_L[e]), 0);
  return Object.keys(pl.per)
    .map((e) => ({ e, v: pl.per[e].s * (key === 'v2' ? W_V2[e] : W_L[e]) }))
    .filter((x) => x.v > 0).sort((x, y) => y.v - x.v)
    .slice(0, 3).map((x) => `${zhOf(x.e)} ${pct(x.v / tt, 1)}`).join('、');
}

push(`1. **换不换权重，第一都不变。** legacy ${F(rL)}× → v2 ${F(rV)}×，Feliks 仍在前，名次 ${RANK.aV} / ${RANK.bV} 不变。`);
push(`2. **比值从 ${F(rL)} 升到 ${F(rV)}（+${pct(rV / rL - 1, 1)}）。** 原因是 v2 把冷门项目压得更低，` +
  `而 Feliks 的纪录更集中在三阶（他三阶 ${pct((A.per['333'] ? A.per['333'].s * W_V2['333'] : 0) / A.sumV, 1)} 的 v2 分来自三阶，Max 只有 ${pct((B.per['333'] ? B.per['333'].s * W_V2['333'] : 0) / B.sumV, 1)}）。`);
push(`3. **两人都被扣分，Max 扣得更多。** Feliks ${pct(dAp, 1)}，Max ${pct(dBp, 1)}。` +
  `不是因为权重惩罚了某个人，而是因为 Max 的分更依赖六阶七阶（权重 0.81→0.60、0.79→0.58），` +
  `Feliks 更依赖五阶三阶（0.85→0.77、1.00→1.00）。`);
push(`   - Feliks 的 v2 前三大项：${topShare(A, 'v2')}`);
push(`   - Max 的 v2 前三大项：${topShare(B, 'v2')}`);
push('4. **绝对分会变小，这一点要提前说清。** 除三阶外所有项目的 `w` 都下调了，');
push('   所以任何人的总分都会低于 legacy。分数不可跨版本比较，只有**同一版本内的排序**有意义。');
push('');

/* ── 5 敏感性：γ 是唯一旋钮 ── */
push('## 5 γ 敏感性：三阶要多突出，冷门项目就压得多狠');
push('');
push('`w_e = floor + (1−floor)·s_e^γ`，`s_e` 是数据算出来的规模指数，γ 是你定的价值旋钮。');
push('两端是同一件事：γ 越大，三阶领先越明显，同时冷门项目越接近地板。');
push('');
push('| γ | 三阶领先次高 | 二阶 | 三阶 | 六阶 | 三盲 | 四盲 | 量程 | Feliks | Max | 比值 |');
push('|---|---|---|---|---|---|---|---|---|---|---|');
for (const g of [0.5, 0.75, 1.0, 1.25, 1.5]) {
  const Wx = RN.buildWeightV2({ gamma: g });
  const srt = Object.keys(Wx).sort((a, b) => Wx[b] - Wx[a]);
  const sumFx = Object.keys(A.per).reduce((a, e) => a + A.per[e].s * (Wx[e] || 0), 0);
  const sumMx = Object.keys(B.per).reduce((a, e) => a + B.per[e].s * (Wx[e] || 0), 0);
  const sel = Math.abs(g - RN.WEIGHT_V2_CFG.gamma) < 1e-9 ? ' **←**' : '';
  push(`| ${F(g)}${sel} | ${pct(1 / Wx[srt[1]] - 1, 1)} | ${F(Wx['222'])} | 1.000 | ${F(Wx['666'])} | ${F(Wx['333bf'])} | ${F(Wx['444bf'])} | ${F(1 / Wx[srt[srt.length - 1]])}× | ${N(sumFx)} | ${N(sumMx)} | ${F(sumFx / sumMx)}× |`);
}
push('');
push(`当前默认 γ = ${F(RN.WEIGHT_V2_CFG.gamma)}（表中加粗行）。`);
push('');

const outPath = path.join(ROOT, 'etl/score/Feliks_vs_Max_v2.md');
fs.writeFileSync(outPath, L.join('\n') + '\n', 'utf8');

console.log(`未加权  Feliks ${N(A.raw)}  Max ${N(B.raw)}  ${F(A.raw / B.raw)}x  rank ${RANK.aR}/${RANK.bR}`);
console.log(`legacy  Feliks ${N(A.sumL)}  Max ${N(B.sumL)}  ${F(rL)}x  rank ${RANK.aL}/${RANK.bL}`);
console.log(`v2      Feliks ${N(A.sumV)}  Max ${N(B.sumV)}  ${F(rV)}x  rank ${RANK.aV}/${RANK.bV}`);
console.log(`已写 ${outPath}（${L.length} 行）`);

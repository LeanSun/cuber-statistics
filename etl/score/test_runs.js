'use strict';
/* runs.js 回归测试
 *
 * 校验两件事：
 *   1. 全部纪录条目都能被 parseResult 读出（含多盲 a/b m:ss、最少步步数、小时级时间）；
 *   2. 拆分中性严格成立：同一段拆 1/2/4/7/20 次，credit 一字不差。
 *
 * 运行：node etl/score/test_runs.js
 */
const path = require('path');
global.window = {};
require('E:/WorkBuddy/魔方10.18/js/data.js');
const RN = require(path.join(__dirname, 'runs.js'));
const M1 = require(path.join(__dirname, 'm1.js'));
const P = global.window.MOCK.players;

let bad = 0;
const fail = {};
let n = 0;
for (const p of P) {
  for (const x of p.records || []) {
    n++;
    if (!RN.parseResult(x.ev, x.type, x.value)) {
      const k = `${x.ev}|${x.type}`;
      (fail[k] = fail[k] || []).push(x.value);
    }
  }
}
const nFail = Object.values(fail).reduce((a, b) => a + b.length, 0);
console.log(`[1] 解析覆盖 ${n - nFail} / ${n}`, nFail ? '✗' : '✓');
Object.entries(fail).forEach(([k, v]) => { bad++; console.log('   FAIL', k, v.slice(0, 5)); });

/* 拆分中性 */
const V0 = 9.5;
const V1 = 9.0;
const T = 365;
const G = Math.log(V0 / V1);
const out = [];
[1, 2, 4, 7, 20].forEach((k) => {
  const step = G / k;
  const subs = [];
  let v = V0;
  for (let i = 1; i <= k; i++) {
    v = v * Math.exp(-step);
    subs.push({ pid: 'X', name: 'X', day: 1000 + Math.round((T / k) * (i - 1)), value: v.toFixed(6), held: 0 });
  }
  const all = [{ pid: 'Q', name: 'Q', day: 500, value: String(V0), held: 500 }]
    .concat(subs, [{ pid: 'Z', name: 'Z', day: 1365, value: '8.90', held: 0 }]);
  const b = RN.buildLadder(all, { ev: '333', type: 'single' });
  const run = b.runs.find((x) => x.pid === 'X');
  const c = RN.runCredit(run, {});
  out.push({ k, subs: run.subs.length, gain: c.gain, days: c.days, credit: c.credit });
});
const ref = out[0].credit;
const same = out.every((o) => Math.abs(o.credit - ref) < 1e-12 && o.days === T);
console.log(`[2] 拆分中性 k=1..20 credit 全部 = ${ref.toFixed(6)}`, same ? '✓' : '✗');
if (!same) { bad++; out.forEach((o) => console.log('   ', o)); }

/* 回归重算：被抢回后开新段，G 以抢走者的值为基准 */
const chain = [
  { pid: 'A', name: 'A', day: 100, value: '10.00', held: 200 },
  { pid: 'B', name: 'B', day: 300, value: '9.80', held: 100 },
  { pid: 'A', name: 'A', day: 400, value: '9.60', held: 365 },
  { pid: 'C', name: 'C', day: 765, value: '9.50', held: 0 },
];
const b3 = RN.buildLadder(chain, { ev: '333', type: 'single' });
const aRuns = b3.runs.filter((x) => x.pid === 'A');
const gOk = aRuns.length === 2
  && Math.abs(aRuns[0].gain - 0) < 1e-12
  && Math.abs(aRuns[1].gain - Math.log(9.80 / 9.60)) < 1e-12;
console.log('[3] 回归重算 A 两段，第二段 G = ln(9.80/9.60)', gOk ? '✓' : '✗');
if (!gOk) { bad++; console.log('   ', aRuns.map((x) => x.gain)); }

/* 只赢在时间：主指标相同、次指标更好 → 也算破纪录 */
const tie = [
  { pid: 'A', name: 'A', day: 100, value: '10/10 44:09', held: 100 },
  { pid: 'B', name: 'B', day: 200, value: '10/10 42:06', held: 100 },
  { pid: 'C', name: 'C', day: 300, value: '11/11 50:00', held: 0 },
];
const b4 = RN.buildLadder(tie, { ev: '333mbf', type: 'single' });
/* 同分快时间算一次真实纪录，但它推进的主指标是 0。
   旧实现给 G=0（等于"这条纪录不算"），现改为 TIE_WEIGHT 折扣价：
   封段照旧，G 是一个远小于主指标推进的小正数。 */
const b4legacy = RN.buildLadder(tie, { ev: '333mbf', type: 'single' }, { tieWeight: 0 });
const tieG = b4.runs[1].gain;
const tieOk = b4.runs.length === 3
  && b4.runs[1].tEnd === 300                       // 仍然终结前一位的段
  && tieG > 0 && tieG < 0.02                       // 有分，但是折扣价
  && Math.abs(b4legacy.runs[1].gain) < 1e-12;      // 传 tieWeight:0 可复现旧行为
console.log(`[4] 多盲并列：封段✓，G=${tieG.toFixed(5)}（旧口径 0）`, tieOk ? '✓' : '✗');
if (!tieOk) { bad++; console.log('   ', b4.runs.map((x) => [x.pid, x.gain, x.tEnd])); }

/* held 修段尾：中间几任持有人被截断时，仍能还原真实段尾 */
const gapChain = [
  { pid: 'F', name: 'F', day: 100, value: '10.00', held: 50 },
  { pid: 'F', name: 'F', day: 150, value: '9.00', held: 400 },   // 真实段尾 = 150+400 = 550
  { pid: 'M', name: 'M', day: 900, value: '8.50', held: 30 },    // M 之前的持有者被截掉了
];
const EXPORT = 2000;
const b5 = RN.buildLadder(gapChain, { ev: '333', type: 'single' }, { endFromHeld: true, exportDay: EXPORT });
const f5 = b5.runs.find((x) => x.pid === 'F');
const naive = RN.buildLadder(gapChain, { ev: '333', type: 'single' });
const f5n = naive.runs.find((x) => x.pid === 'F');
const heldOk = f5.tEnd === 550 && f5.clean === true && f5.prevGap === null
  && f5n.tEnd === 900 && f5n.clean === false;   // 不用 held 就会拉到 900
console.log(`[5] held 修段尾：${f5.tEnd}（直接取下一条是 ${f5n.tEnd}），clean=${f5.clean}`, heldOk ? '✓' : '✗');
if (!heldOk) { bad++; console.log('   ', f5.tEnd, f5.clean, f5n.tEnd); }

/* held 指到导出日 → 仍保持中，必须是开放段 */
const liveChain = [
  { pid: 'A', name: 'A', day: 100, value: '10.00', held: 100 },
  { pid: 'B', name: 'B', day: 1900, value: '9.00', held: 100 },   // 1900+100 = 2000 = 导出日
];
const b6 = RN.buildLadder(liveChain, { ev: '333', type: 'single' }, { endFromHeld: true, exportDay: EXPORT });
const liveOk = b6.runs[1].tEnd === null && b6.runs[1].tEndHeld === null
  && Math.abs(RN.runCredit(b6.runs[1], { snapshotDay: 2010 }).days - 110) < 1e-9;
console.log('[6] held 到导出日 → 开放段（用快照日封口）', liveOk ? '✓' : '✗');
if (!liveOk) { bad++; console.log('   ', b6.runs[1].tEnd, b6.runs[1].tEndHeld); }

/* ══ 项目定价：三阶必须是最高含金量 ═════════════════════════════ */

/* [7] EV_WEIGHT 必须与 js/calc.js 的 EVENTS[].w 完全一致。
       手抄过就会错（曾把金字塔 0.90 写成 0.75），所以用断言锁死。 */
const Calc = require('E:/WorkBuddy/魔方10.18/js/calc.js');
let wMismatch = [];
for (const ev of Calc.EVENTS) {
  const a = RN.EV_WEIGHT[ev.id];
  if (a == null) { wMismatch.push(ev.id + ':缺失'); continue; }
  if (Math.abs(a - ev.w) > 1e-9) wMismatch.push(ev.id + ':' + a + '≠' + ev.w);
}
const wOk = wMismatch.length === 0;
console.log(`[7] EV_WEIGHT 与 calc.js 一致（${Calc.EVENTS.length} 项）`, wOk ? '✓' : '✗ ' + wMismatch.join(', '));
if (!wOk) bad++;

/* [8] 单价排序：三阶必须是严格最高，且排序与 w_e 完全一致。
       这是「三阶含金量最高」的硬断言 —— 与 G 的实测分布无关。 */
const evsW = Object.keys(RN.EV_WEIGHT).sort((a, b) => RN.EV_WEIGHT[b] - RN.EV_WEIGHT[a]);
const unitOk = evsW[0] === '333' && evsW.every((e, i) => i === 0 || RN.EV_WEIGHT[evsW[i - 1]] >= RN.EV_WEIGHT[e]);
const capOk = Calc.EVENTS.every((e) => RN.NORM_CAP * RN.EV_WEIGHT['333'] >= RN.NORM_CAP * RN.evWeightOf(e.id));
console.log(
  `[8] 三阶单价严格最高：典型段 1.000 vs 次高 ${RN.EV_WEIGHT[evsW[1]].toFixed(2)}（${evsW[1]}），`
  + `单段上界 ${RN.NORM_CAP}×w 亦恒为最高`,
  unitOk && capOk ? '✓' : '✗'
);
if (!(unitOk && capOk)) bad++;

/* [9] 归一恒等式：Σ G_i/mean(G) = n。这是「一段」跨项目同质化的数学依据。 */
const sample = [0.02, 0.05, 0.81, 0.13, 0.004, 0.27];   // 含长尾
const mu = sample.reduce((a, b) => a + b, 0) / sample.length;
const sumR = sample.reduce((a, b) => a + b / mu, 0);
const idOk = Math.abs(sumR - sample.length) < 1e-12 && Math.abs(RN.refOf(sample, { trim: 0 }) - mu) < 1e-12;
console.log(`[9] 归一恒等式 Σr = n：${sumR.toFixed(12)} vs n=${sample.length}`, idOk ? '✓' : '✗');
if (!idOk) bad++;

/* [10] 向后兼容：不传 ref 时 credit 与旧口径逐位相同；传 ref 后三阶不被冷门项目翻盘 */
const legRun = { gain: 0.30, tStart: 0, tEnd: 365, tEndHeld: 365, subs: [] };
const oldC = RN.runCredit(legRun, { snapshotDay: 1000 });
const ref4bf = 0.3287, ref333 = 0.0814;
const c4bf = RN.runCredit(legRun, { ref: ref4bf, snapshotDay: 1000 });
const c333 = RN.runCredit({ ...legRun, gain: ref333 }, { ref: ref333, snapshotDay: 1000 });
const compatOk = Math.abs(oldC.credit - 0.30) < 1e-12
  && Math.abs(c333.credit - 1.0) < 1e-12                      // 三阶典型段 = 1.000
  && RN.evWeightOf('333') > RN.evWeightOf('444bf')
  && c4bf.ratio > 0.9 && c4bf.gainNorm <= RN.NORM_CAP;        // 四盲大 G 仍受截顶约束
console.log(
  `[10] 向后兼容 credit=${oldC.credit.toFixed(6)}｜三阶典型段=${c333.credit.toFixed(3)}`
  + `｜四盲 r=${c4bf.ratio.toFixed(3)}→截顶 ${c4bf.gainNorm.toFixed(3)}`,
  compatOk ? '✓' : '✗'
);
if (!compatOk) bad++;

/* ══ v2 定价：三项修复的结构保证 ══════════════════════════════ */

/* [11] v2 权重：三阶恒为 1.000、严格最高；排序 ≡ 份额排序；量程 ≥ 3 倍。
       公式 w = floor + (1-floor)·s^γ 在 s=1 处取上界，所以「最高」是结构性的，
       不是调参调出来的。 */
const W2 = RN.EV_WEIGHT_V2;
const w2Sorted = Object.keys(W2).sort((a, b) => W2[b] - W2[a]);
const shareSorted = Object.keys(W2).sort((a, b) => (RN.EV_SHARE[b] === undefined ? -1 : RN.EV_SHARE[b]) - (RN.EV_SHARE[a] === undefined ? -1 : RN.EV_SHARE[a]));
const w2Ok = W2['333'] === 1
  && w2Sorted[0] === '333'
  && w2Sorted.every((e, i) => i === 0 || W2[w2Sorted[i - 1]] >= W2[e])
  /* 排序一致性只对**活跃项目**成立：停办项目额外乘了 retiredDiscount，
     会被有意压到比同份额项目更低，那是设计而非缺陷。 */
  && w2Sorted.filter((e) => !RN.EV_RETIRED.has(e))
       .every((e, i, arr) => i === 0 || W2[arr[i - 1]] > W2[e])
  && 1 / W2[w2Sorted[w2Sorted.length - 1]] >= 3              // 量程至少 3 倍
  && W2[w2Sorted[w2Sorted.length - 1]] >= RN.WEIGHT_V2_CFG.floor * 0.8;   // 地板没被击穿
console.log(
  `[11] v2 权重：三阶 1.000 领先次高 ${w2Sorted[1]} ${(W2[w2Sorted[1]]).toFixed(3)}`
  + `（${((1 / W2[w2Sorted[1]] - 1) * 100).toFixed(0)}%），量程 ${(1 / W2[w2Sorted[w2Sorted.length - 1]]).toFixed(2)} 倍`,
  w2Ok ? '✓' : '✗'
);
if (!w2Ok) bad++;

/* [12] 时长口径：v2 线性不折价，cap 只是 30 年的数据边界；
       饱和函数作为可选工具仍需正确（无拐点、有上界）。 */
const dsat = 1826;
const longRun = { gain: 0.1, tStart: 0, tEnd: 7300, subs: [] };   // 20 年
const midRun = { gain: 0.1, tStart: 0, tEnd: 1456, subs: [] };    // P90 段长
const cLongV2 = RN.runCredit(longRun, { capDays: RN.CAP_DAYS_V2 });
const cMidV2 = RN.runCredit(midRun, { capDays: RN.CAP_DAYS_V2 });
const cSat = RN.runCredit(longRun, { dsat });
const satOk = cLongV2.daysUsed === 7300                             // 20 年一分不少
  && cMidV2.daysUsed === 1456                                       // P90 也不折价
  && cSat.daysUsed < dsat * 1.01 && cSat.daysUsed / dsat > 0.98     // 饱和版渐近上界 dsat
  && RN.runCredit(longRun, { capDays: 3650 }).daysUsed === 3650;    // 旧口径 10 年硬顶仍在
console.log(
  `[12] 时长：v2 线性（20 年→${cLongV2.daysUsed} 天，不折价），cap=${RN.CAP_DAYS_V2 / 365} 年只防数据异常；`
  + `饱和可选版渐近 ${dsat} 天`,
  satOk ? '✓' : '✗'
);
if (!satOk) bad++;

/* [13] scoreRunsV2 三项默认全开：归一 + v2 权重 + 饱和时长，且三阶段 > 四盲同构段 */
const mkRun = (gain, days) => ({ gain, tStart: 0, tEnd: days, subs: [{ day: 0 }] });
const refSame = 0.10;
const s333 = RN.scoreRunsV2([mkRun(refSame, 730)], { ev: '333', level: 'WR', rho: 1, ref: refSame }, { snapshotDay: 1000 })[0];
const s4bf = RN.scoreRunsV2([mkRun(refSame, 730)], { ev: '444bf', level: 'WR', rho: 1, ref: refSame }, { snapshotDay: 1000 })[0];
const v2Ok = Math.abs(s333.gainNorm - 1) < 1e-12             // 典型段 r=1
  && s333.w === 1 && Math.abs(s4bf.w - W2['444bf']) < 1e-12  // 权重默认已乘
  && s333.daysUsed === 730                                    // 时长线性不折价
  && s333.score > s4bf.score * 2.2;                           // 三阶领先 2.28 倍
console.log(
  `[13] scoreRunsV2 默认全开（归一+v2 权重）：三阶 ${s333.score.toFixed(4)} vs 四盲 ${s4bf.score.toFixed(4)}`
  + `（${(s333.score / s4bf.score).toFixed(2)}×）`,
  v2Ok ? '✓' : '✗'
);
if (!v2Ok) bad++;

/* [14] 真实案例：Kai Jiptner 2009-04-25 用 10/10 42:06 打破 Dennis Strehlau 的 10/10 44:09。
       同分、快 123 秒，是一條真纪录。旧口径 G=0，现在应该是 0.01~0.02 量级。 */
const jip = [
  { pid: 'dennis', name: 'Dennis Strehlau', day: RN.dayOf('2008-07-12'), value: '10/10 44:09', held: 0 },
  { pid: 'kai', name: 'Kai Jiptner', day: RN.dayOf('2009-04-25'), value: '10/10 42:06', held: 0 },
];
const bJ = RN.buildLadder(jip, { ev: '333mbf', type: 'single' });
const gJ = bJ.runs[1] ? bJ.runs[1].gain : NaN;
const caseOk = bJ.runs.length === 2 && gJ > 0.005 && gJ < 0.03;
console.log(`[14] 多盲同分快 123 秒：G=${Number.isFinite(gJ) ? gJ.toFixed(5) : gJ}（旧口径 0）`, caseOk ? '✓' : '✗');
if (!caseOk) bad++;

/* [15] 停办项目封口：magic 在 2013 年废除，末段不能被快照日无限延长。
       旧多盲 2006 年的 24/24 曾因此被记成守 6753 天，冲进全站单段 Top3。 */
const mgc = [
  { pid: 'a', name: 'A', day: RN.dayOf('2003-08-23'), value: '1.50', held: 0 },
  { pid: 'b', name: 'B', day: RN.dayOf('2004-06-01'), value: '0.90', held: 0 },
];
const bM = RN.buildLadder(mgc, { ev: 'magic', type: 'single' }, { mode: 'level', endFromHeld: true, exportDay: RN.SNAPSHOT_DAY });
const lastM = bM.runs[bM.runs.length - 1];
const retDay = RN.EV_RETIRED_DAY['magic'];
const liveB = RN.buildLadder(
  [{ pid: 'c', name: 'C', day: RN.dayOf('2020-01-01'), value: '5.00', held: 0 }],
  { ev: '333', type: 'single' }, { mode: 'level', endFromHeld: true, exportDay: RN.SNAPSHOT_DAY });
const retOk = lastM.tEnd === retDay
  && RN.dateOfDay(lastM.tEnd) === '2013-01-01'
  && liveB.runs[0].tEnd === null;   // 活项目仍是开放段，不受影响
console.log(
  `[15] 停办封口：magic 末段止于 ${lastM.tEnd == null ? '至今' : RN.dateOfDay(lastM.tEnd)}`
  + `（${Math.round((lastM.tEnd - lastM.tStart) / 365 * 10) / 10} 年，不是 ${Math.round((RN.SNAPSHOT_DAY - lastM.tStart) / 365)} 年）；`
  + `在办项目仍开放`,
  retOk ? '✓' : '✗'
);
if (!retOk) bad++;

/* [16] 时代折算：必须参与计分，且随年代严格上升。
       2026-10-24 用户决定「保留」，这条断言防它被当成可选开关悄悄摘掉。 */
const ppl = [];
for (let i = 0; i < 800; i++) ppl.push({ y: 2005, cont: 'Xx', nat: 'XA' });
for (let i = 0; i < 120000; i++) ppl.push({ y: 2021, cont: 'Xx', nat: 'XA' });
const poolT = M1.makeScopePool(ppl);
const D = (s0) => RN.dayOf(s0);
const fOld = RN.avgFactor(poolT, 'WR', { cont: 'Xx', nat: 'XA' }, D('2006-01-01'), D('2007-01-01'), RN.SNAPSHOT_DAY);
const fNew = RN.avgFactor(poolT, 'WR', { cont: 'Xx', nat: 'XA' }, D('2023-01-01'), D('2024-01-01'), RN.SNAPSHOT_DAY);
const noPool = RN.avgFactor(null, 'WR', {}, D('2006-01-01'), D('2007-01-01'), RN.SNAPSHOT_DAY);
const fOk = fNew > fOld && fOld > 0 && fOld < 0.75 && fNew > 0.9 && noPool === 1;
console.log(
  `[16] 时代折算：2006 年 f=${RN.F4(fOld)} < 2023 年 f=${RN.F4(fNew)}，`
  + `无池时退化为中性 ${RN.F4(noPool)}`,
  fOk ? '✓' : '✗'
);
if (!fOk) bad++;

console.log(bad ? `\n${bad} 项未通过` : '\n全部通过');
process.exit(bad ? 1 : 0);

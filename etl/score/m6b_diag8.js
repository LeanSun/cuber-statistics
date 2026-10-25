'use strict';
/* =============================================================================
 * M6 候选新口径 · 诊断 v8：M1 重叠的根因与解法
 * -----------------------------------------------------------------------------
 * v7 关键发现：**ρ(新M6, M1) = 0.73（仅WR口径）→ 重复计分 ❌**
 *
 * 根因（数学层面）：
 *   M1 的 r 分量 = gainOf(prev, cur) = ln(前值/现值) —— **正是用户要的领先幅度**
 *   M1 得分 = r × 持有时长/365 × V_L × ρ_s × f_L × w_e
 *   新 M6 得分 = r（单独）
 *   → 两者共用同一个 r，只是 M1 乘了时长等因子。
 *   → r 相同的样本必然同向排序 → 高相关是结构性的，不是调参能解决的。
 *
 * 本脚本要回答的关键问题：**有没有办法把「领先幅度」从 M1 里剥出来而不重复计分？**
 *
 * 候选解法：
 *   S1 剥离法：把 M1 的 r 换成 1，只留时长 → M1' 与新 M6 的 ρ 应降到很低
 *         （若成立，说明两者是可分离的两个正交因子，不是重复计分）
 *   S2 残差法：新 M6 = r − median(r | 同项目同年代) → 扣掉「常态领先幅度」
 *   S3 相对法：新 M6 = r / G_ref(项目) → 与 M1 归一后的 r 对比
 *   S4 独占法：新 M6 只算「夺权型突破」（不是自我连续刷新）→ 已测过
 *   S5 组合法：M1 去掉 r 分量，新 M6 补上 —— 结构性解耦
 *
 * 运行：node --max-old-space-size=8192 etl/score/m6b_diag8.js
 * ============================================================================= */
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '../..');
global.window = {};
require(path.join(ROOT, 'js/data.js'));
const RN = require(path.join(ROOT, 'etl/score/runs.js'));
const CL = require(path.join(ROOT, 'js/calc.js'));
const D = path.join(ROOT, 'etl/score');

const F = (x, n = 4) => Number(x).toFixed(n);
const num = (x) => Number(x).toLocaleString('en-US');

function rankArr(a) {
  const idx = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]);
  const r = new Array(a.length); let i = 0;
  while (i < idx.length) {
    let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const av = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[idx[k][1]] = av;
    i = j + 1;
  }
  return r;
}
function pearson(x, y) {
  const n = x.length; if (n < 3) return null;
  let mx = 0, my = 0;
  for (let i = 0; i < n; i++) { mx += x[i]; my += y[i]; }
  mx /= n; my /= n;
  let nu = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { const a = x[i] - mx, b = y[i] - my; nu += a * b; dx += a * a; dy += b * b; }
  return (dx === 0 || dy === 0) ? null : nu / Math.sqrt(dx * dy);
}
const spearman = (x, y) => pearson(rankArr(x), rankArr(y));

/* ═══ 载入数据 ═══ */
/* ★ 各封存 TSV 的 pid 列位不一致：
 *   M1_full.tsv / M4_seats.tsv / M5_seats.tsv / M6_seats.tsv → pid 在 c[0]
 *   M2_ranking.tsv → 有 rank 列，pid 在 c[1]，total 在 c[3]
 */
function loadTsv(file, col, pidCol) {
  const m = new Map();
  const lines = fs.readFileSync(path.join(D, file), 'utf8').trim().split('\n');
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split('\t');
    const pid = c[pidCol == null ? 0 : pidCol], v = +c[col];
    if (pid && Number.isFinite(v)) m.set(pid, v);
  }
  return m;
}
const M1 = loadTsv('M1_full.tsv', 2, 0);
const M2 = loadTsv('M2_ranking.tsv', 3, 1);
const M4 = loadTsv('M4_seats.tsv', 2, 0);
const M5 = loadTsv('M5_seats.tsv', 2, 0);
const M6old = loadTsv('M6_seats.tsv', 2, 0);

/* 载入刷新事件（v6 产出） */
const EVENTS = [];
{
  const lines = fs.readFileSync(path.join(D, 'm6b_events.tsv'), 'utf8').trim().split('\n');
  for (const ln of lines) {
    const c = ln.split('\t');
    EVENTS.push({
      pid: c[0], name: c[1], eid: c[2], kind: c[3], level: c[4], scope: c[5],
      date: c[6], prevCost: +c[7], newCost: +c[8], gain: +c[9], same: c[10] === '1',
      yr: +c[6].slice(0, 4),
    });
  }
}
console.log(`事件=${num(EVENTS.length)} M1=${num(M1.size)} M2=${num(M2.size)} M4=${num(M4.size)} M5=${num(M5.size)}`);

/* ═══ 构造 M1 的「纯时长版」：score = 持有时长（去掉 r 分量）═══
 * 这需要重建 M1 的阶梯。做法：复用 score_record.js 的建梯逻辑，但把 runCredit 的
 * gainNorm 强制为 1（只留天数）。
 */
console.log('\n' + '='.repeat(84));
console.log('S1 剥离检验：M1 去掉 r 分量后（纯持有时长），与新 M6 的相关');
console.log('='.repeat(84));

const P = global.window.MOCK.players;
const rows = [];
for (const p of P) {
  for (const x of p.records || []) {
    if (!x.date || !x.ev || !x.type || !x.level) continue;
    rows.push({ pid: p.id, name: p.name, country: p.country, ev: x.ev, type: x.type, level: x.level, day: RN.dayOf(x.date), value: x.value, held: x.held || 0 });
  }
}
const buckets = {};
for (const r of rows) {
  const cont = CL.contOfIso(r.country) || '??';
  const scope = r.level === 'WR' ? 'WW' : (r.level === 'CR' ? cont : r.country);
  const k = r.ev + '|' + r.type + '|' + r.level + '|' + scope;
  (buckets[k] = buckets[k] || { ev: r.ev, type: r.type, level: r.level, subs: [] }).subs.push(r);
}
const LAD = {};
for (const k of Object.keys(buckets)) {
  const b = buckets[k];
  const lad = RN.buildLadder(b.subs, { ev: b.ev, type: b.type }, { mode: 'level' });
  LAD[k] = lad.runs;
}

/* M1'：只按「持有天数」聚合（r=1），同时算 M1 的原始 r 加权版做对照 */
const m1Dur = new Map();      // 纯时长
const m1GainWeighted = new Map(); // gain × 时长（M1 的核心部分，不含 V_L/ρ/f/w）
const m1GainSum = new Map();   // Σ gain（不带时长）
for (const k of Object.keys(LAD)) {
  const b = buckets[k];
  for (const r of LAD[k]) {
    const days = r.tEnd == null ? 0 : (r.tEnd - r.tStart);
    const yrs = Math.min(days, RN.CAP_DAYS_V2 || 10950) / 365;
    let a = m1Dur.get(r.pid); if (!a) { a = 0; m1Dur.set(r.pid, a); }
    m1Dur.set(r.pid, m1Dur.get(r.pid) + yrs);
    const g = r.gain > 0 ? r.gain : 0;
    let b2 = m1GainWeighted.get(r.pid); if (b2 == null) { b2 = 0; m1GainWeighted.set(r.pid, b2); }
    m1GainWeighted.set(r.pid, m1GainWeighted.get(r.pid) + g * yrs);
    let c2 = m1GainSum.get(r.pid); if (c2 == null) { c2 = 0; m1GainSum.set(r.pid, c2); }
    m1GainSum.set(r.pid, m1GainSum.get(r.pid) + g);
  }
}
console.log(`M1'(纯时长) 人数=${num(m1Dur.size)}  M1的gain×时长分量 人数=${num(m1GainWeighted.size)}  M1的Σgain 人数=${num(m1GainSum.size)}`);

/* 新 M6 的各口径 */
function aggBy(fn) {
  const m = new Map();
  for (const e of EVENTS) {
    const v = fn(e);
    if (v == null || !Number.isFinite(v) || v <= 0) continue;
    let a = m.get(e.pid); if (!a) { a = { s: 0, n: 0 }; m.set(e.pid, a); }
    a.s += v; a.n++;
  }
  return m;
}
function rho(mapA, mapB, valA) {
  const ids = [];
  for (const [p, a] of mapA) if (mapB.has(p)) ids.push(p);
  if (ids.length < 10) return null;
  const x = ids.map((p) => valA ? valA(mapA.get(p)) : mapA.get(p));
  const y = ids.map((p) => mapB.get(p));
  return { rho: spearman(x, y), n: ids.length };
}

const NEW = {
  'C 仅WR原始': aggBy((e) => (e.level === 'WR' ? e.gain : 0)),
  'D 仅WR截顶': aggBy((e) => (e.level === 'WR' ? Math.min(e.gain, 0.5) : 0)),
  'A 全级别原始': aggBy((e) => e.gain),
  'E WR+CR截顶': aggBy((e) => (e.level === 'WR' || e.level === 'CR' ? Math.min(e.gain, 0.5) : 0)),
};

console.log('\n  新M6 各口径 与 三个 M1 变体的 ρ：');
console.log('  ' + '新M6口径'.padEnd(16) + 'M1(原,含r×时长)'.padStart(20) + 'M1_gain×时长'.padStart(18) + 'M1_纯时长'.padStart(16) + 'M1_Σgain'.padStart(16));
for (const [nm, m] of Object.entries(NEW)) {
  const a = rho(m, M1, (v) => v.s);
  const b = rho(m, m1GainWeighted);
  const c = rho(m, m1Dur);
  const d = rho(m, m1GainSum);
  const fmt = (r) => r ? `${F(r.rho, 4)} n=${r.n}` : 'n/a';
  console.log('  ' + nm.padEnd(16) + fmt(a).padStart(20) + fmt(b).padStart(18) + fmt(c).padStart(16) + fmt(d).padStart(16));
}

/* ═══ S2/S3 残差法与相对法 ═══ */
console.log('\n' + '='.repeat(84));
console.log('S2/S3 残差法与相对法：扣掉「同项目同年代的常态领先幅度」');
console.log('='.repeat(84));

/* 按 (项目, 轨, 年代段) 计算 gain 的中位数，作为基线 */
function cellKey(e) { return e.eid + '|' + e.kind + '|' + e.level + '|' + Math.floor(e.yr / 5) * 5; }
function buildBaseline(quantile) {
  const g = new Map();
  for (const e of EVENTS) {
    if (!(e.gain > 0)) continue;
    const k = cellKey(e);
    let a = g.get(k); if (!a) { a = []; g.set(k, a); }
    a.push(e.gain);
  }
  const base = new Map();
  for (const [k, a] of g) {
    a.sort((x, y) => x - y);
    base.set(k, quantile === 'median' ? a[Math.floor(a.length / 2)] : a[Math.floor(a.length * 0.5)]);
  }
  return base;
}
const BASE = buildBaseline('median');

const RESID = aggBy((e) => {
  if (e.level !== 'WR') return 0;
  const b = BASE.get(cellKey(e));
  if (b == null) return 0;
  return e.gain - b;
});
/* 相对法：gain / 同项目所有 gain 的中位 */
{
  const g = new Map();
  for (const e of EVENTS) if (e.level === 'WR' && e.gain > 0) {
    const k = e.eid + '|' + e.kind;
    let a = g.get(k); if (!a) { a = []; g.set(k, a); }
    a.push(e.gain);
  }
  const evBase = new Map();
  for (const [k, a] of g) { a.sort((x, y) => x - y); evBase.set(k, a[Math.floor(a.length / 2)]); }
  var REL = aggBy((e) => {
    if (e.level !== 'WR') return 0;
    const b = evBase.get(e.eid + '|' + e.kind);
    if (!b) return 0;
    return e.gain / b;
  });
}

console.log('\n  新M6 变体 与 M1 / M1纯时长 / M4 的 ρ：');
console.log('  ' + '变体'.padEnd(24) + 'M1'.padStart(18) + 'M1纯时长'.padStart(16) + 'M4'.padStart(16) + 'M5'.padStart(16));
const VARIANTS2 = {
  'C 仅WR原始': NEW['C 仅WR原始'],
  'D 仅WR截顶': NEW['D 仅WR截顶'],
  'S2 仅WR残差(减年代中位)': RESID,
  'S3 仅WR相对(除项目中位)': REL,
};
for (const [nm, m] of Object.entries(VARIANTS2)) {
  const a = rho(m, M1, (v) => v.s), b = rho(m, m1Dur), c = rho(m, M4), d = rho(m, M5);
  const fmt = (r) => r ? `${F(r.rho, 4)} n=${r.n}` : 'n/a';
  console.log('  ' + nm.padEnd(24) + fmt(a).padStart(18) + fmt(b).padStart(16) + fmt(c).padStart(16) + fmt(d).padStart(16));
}

/* ═══ S4 结构性解耦检验 ═══ */
console.log('\n' + '='.repeat(84));
console.log('S4 结构性解耦：若 M1 去掉 r 分量，两者是否正交？');
console.log('='.repeat(84));
console.log('  M1 原版 = r × 时长 × V_L × ρ_s × f_L × w_e');
console.log('  M1\'(去掉r) = 1 × 时长 × V_L × ρ_s × f_L × w_e   ← 纯「守得稳」');
console.log('  新M6 = r（纯「打得狠」）');
console.log('');
const a1 = rho(NEW['D 仅WR截顶'], M1, (v) => v.s);
const a2 = rho(NEW['D 仅WR截顶'], m1Dur);
const a3 = rho(m1Dur, M1);
console.log(`  ρ(新M6, M1原版)      = ${a1 ? F(a1.rho, 4) + ' n=' + a1.n : 'n/a'}   ← 高：M1 已含 r`);
console.log(`  ρ(新M6, M1纯时长)    = ${a2 ? F(a2.rho, 4) + ' n=' + a2.n : 'n/a'}   ← 若低 → 两者本质正交 ✓`);
console.log(`  ρ(M1纯时长, M1原版)  = ${a3 ? F(a3.rho, 4) + ' n=' + a3.n : 'n/a'}   ← M1内部 r 的贡献占比`);

/* ═══ S5 各口径的最终对照表 ═══ */
console.log('\n' + '='.repeat(84));
console.log('S5 完整对照表（候选口径 × 各维 ρ）');
console.log('='.repeat(84));
const DIMS2 = [['M1', M1], ['M1纯时长', m1Dur], ['M2', M2], ['M4', M4], ['M5', M5], ['M6-F1', M6old]];
console.log('  ' + '口径'.padEnd(24) + DIMS2.map((d) => (d[0] + ' ρ').padStart(15)).join(''));
for (const [nm, m] of Object.entries(VARIANTS2)) {
  const cells = DIMS2.map(([dn, om]) => {
    const r = rho(m, om, (v) => (typeof v === 'object' ? v.s : v));
    if (!r) return 'n/a'.padStart(15);
    const mark = Math.abs(r.rho) > 0.7 ? '❌' : (Math.abs(r.rho) > 0.5 ? '⚠️' : '✅');
    return `${F(r.rho, 4)}${mark}`.padStart(15);
  });
  console.log('  ' + nm.padEnd(24) + cells.join(''));
}
console.log('\n  （n 见上方分项输出；M2 只有 1000 人，交集可能不足）');

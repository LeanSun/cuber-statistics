'use strict';
/* =============================================================================
 * M6 高度类候选 · 裁决诊断 v2（m6d_diag2.js）
 * -----------------------------------------------------------------------------
 * 问题：C2「第二人间隔」是否只是 M1 持有时长的复述？
 *   逻辑：WR 成绩 v 于 d 达成后，「第二个人类达成 ≤ v」的时刻 = 这条 WR 被
 *         打破/追平的时刻（因为此前无人 ≤ v，第一个 ≤ v 的就是破纪录者）。
 *         → C2 gap ≡ M1 的持有天数（近似恒等）。
 *   检验：ρ(C2, M1纯时长版) 应极高 → 判死 C2。
 *   对照：ρ(C1, M1纯时长版) = −0.056（diag8 已测，这里复核）。
 *
 * 另：C3 里程碑首破的浓度诊断（每 (项目,轨道) 的档位归属集中度）。
 *
 * 运行：node --max-old-space-size=8192 etl/score/m6d_diag2.js
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

/* ── 居中 Spearman（★ 上一版余弦公式已废弃） ── */
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
function crossRho(A, B) {
  const x = [], y = [];
  for (const [pid, va] of A) { const vb = B.get(pid); if (vb !== undefined) { x.push(va); y.push(vb); } }
  if (x.length < 10) return { rho: NaN, n: x.length };
  return { rho: spearman(x, y), n: x.length };
}

/* ═══ M1'（纯时长版）重建 —— 与 diag8 逐字一致 ═══ */
const P = global.window.MOCK.players;
const rows = [];
for (const p of P) {
  for (const x of p.records || []) {
    if (!x.date || !x.ev || !x.type || !x.level) continue;
    rows.push({ pid: p.id, country: p.country, ev: x.ev, type: x.type, level: x.level, day: RN.dayOf(x.date), value: x.value, held: x.held || 0 });
  }
}
const buckets = {};
for (const r of rows) {
  const cont = CL.contOfIso(r.country) || '??';
  const scope = r.level === 'WR' ? 'WW' : (r.level === 'CR' ? cont : r.country);
  const k = r.ev + '|' + r.type + '|' + r.level + '|' + scope;
  (buckets[k] = buckets[k] || { ev: r.ev, type: r.type }, 0);
  (buckets[k].subs = buckets[k].subs || []).push(r);
}
const m1Dur = new Map();     // 全级别（WR+CR+NR）
const m1DurWR = new Map();   // ★ 仅 WR —— 与 C1/C2 的覆盖面对齐
for (const k of Object.keys(buckets)) {
  const b = buckets[k];
  const isWR = b.ev !== undefined && k.split('|')[2] === 'WR';
  const lad = RN.buildLadder(b.subs, { ev: b.ev, type: b.type }, { mode: 'level' });
  for (const r of lad.runs) {
    const days = r.tEnd == null ? 0 : (r.tEnd - r.tStart);
    const yrs = Math.min(days, RN.CAP_DAYS_V2 || 10950) / 365;
    m1Dur.set(r.pid, (m1Dur.get(r.pid) || 0) + yrs);
    if (isWR) m1DurWR.set(r.pid, (m1DurWR.get(r.pid) || 0) + yrs);
  }
}
console.log(`M1'(纯时长) 人数=${num(m1Dur.size)}   M1'WR-only 人数=${num(m1DurWR.size)}`);

/* ═══ 载入各候选 ═══ */
function loadTsv(file, pc, vc) {
  const m = new Map();
  const lines = fs.readFileSync(path.join(D, file), 'utf8').trim().split('\n');
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split('\t');
    const v = +c[vc];
    if (c[pc] && Number.isFinite(v)) m.set(c[pc], v);
  }
  return m;
}
const M1 = loadTsv('M1_full.tsv', 0, 2);
const M4 = loadTsv('M4_seats.tsv', 0, 2);
const C1 = new Map();   // m6b_aggs tag D
{
  const L = fs.readFileSync(path.join(D, 'm6b_aggs.tsv'), 'utf8').trim().split('\n');
  for (const ln of L) { const c = ln.split('\t'); if (c[0] === 'D' && Number.isFinite(+c[3])) C1.set(c[1], +c[3]); }
}
const C2s = loadTsv('m6d_c2.tsv', 0, 2);   // sum_years
const C2x = loadTsv('m6d_c2.tsv', 0, 3);   // max_years
const C2n = loadTsv('m6d_c2.tsv', 0, 4);   // n
const C3 = loadTsv('m6d_c3.tsv', 0, 2);

/* ═══ 裁决 ═══ */
console.log('\n' + '='.repeat(76));
console.log('S1 · 裁决：各候选 与 M1 纯时长版（守得稳分量）的相关');
console.log('='.repeat(76));
console.log('  ρ(M1纯时长, M1原版) = ' + F(crossRho(m1Dur, M1).rho) + `  n=${crossRho(m1Dur, M1).n}`);
console.log('  ρ(M1纯时长WR-only, M1原版) = ' + F(crossRho(m1DurWR, M1).rho) + `  n=${crossRho(m1DurWR, M1).n}`);
const TESTS = [['C1 领先幅度', C1], ['C2 间隔sum', C2s], ['C2 间隔max', C2x], ['C2 条数n', C2n], ['C3 首破', C3]];
for (const [nm, m] of TESTS) {
  const r1 = crossRho(m, m1DurWR), r1b = crossRho(m, m1Dur), r2 = crossRho(m, M1), r3 = crossRho(m, M4);
  const mark = (v) => Math.abs(v) > 0.7 ? '❌' : (Math.abs(v) > 0.5 ? '⚠️ ' : '✅');
  console.log(`  ${nm.padEnd(14)} ×M1'WR-only ${F(r1.rho)}${mark(r1.rho)}(n=${r1.n})   ×M1'全级别 ${F(r1b.rho)}(n=${r1b.n})   ×M1原版 ${F(r2.rho)}(n=${r2.n})   ×M4 ${F(r3.rho)}(n=${r3.n})`);
}
console.log('\n  判读：C2 若 ×M1\'WR-only 高相关 → C2 ≡ WR 持有时长的复述，判死。');
console.log('        C1 ×M1\'WR-only 的读数 = 领先幅度与持有时间这两个量的真实分离度。');

'use strict';
/* =============================================================================
 * M6 候选新口径 · 诊断 v7：正交性检验（对封存后的 M1/M2/M4/M5）
 * -----------------------------------------------------------------------------
 * 输入：m6b_aggs.tsv（v6 产出的 7 个口径）× 各维封存产出
 *   M1  → M1_full.tsv（pid, name, m1）      ← 全量 4,952 人
 *   M2  → M2_ranking.tsv（rank,pid,name,total）
 *   M4  → M4_seats.tsv（pid, name, m4）
 *   M5  → M5_seats.tsv（pid, name, m5）
 *
 * 判定线：|ρ| > 0.7 = 重复计分；> 0.5 = 中等相关；< 0.25 = 安全
 *
 * 运行：node --max-old-space-size=8192 etl/score/m6b_diag7.js
 * ============================================================================= */
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '../..');
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
const spearman = (x, y) => { const rx = rankArr(x), ry = rankArr(y); return pearson(rx, ry); };

/* ── 载入新口径 ── */
const VARIANTS = {};
{
  const lines = fs.readFileSync(path.join(D, 'm6b_aggs.tsv'), 'utf8').trim().split('\n');
  for (const ln of lines) {
    const c = ln.split('\t');
    if (c.length < 4) continue;
    const tag = c[0];
    if (!VARIANTS[tag]) VARIANTS[tag] = new Map();
    VARIANTS[tag].set(c[1], { name: c[2], s: +c[3], n: +c[4], wr: +c[5], cr: +c[6], nr: +c[7] });
  }
}

/* ── 载入各维 ── */
function loadTsv(file, col) {
  const m = new Map();
  const lines = fs.readFileSync(path.join(D, file), 'utf8').trim().split('\n');
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split('\t');
    const pid = c[0], v = +c[col];
    if (pid && Number.isFinite(v)) m.set(pid, v);
  }
  return m;
}
const M1 = loadTsv('M1_full.tsv', 2);
const M2 = loadTsv('M2_ranking.tsv', 3);
const M4 = loadTsv('M4_seats.tsv', 2);
const M5 = loadTsv('M5_seats.tsv', 2);
console.log(`M1=${num(M1.size)} M2=${num(M2.size)} M4=${num(M4.size)} M5=${num(M5.size)}`);

/* M6-F1 对手强度（对照） */
const M6old = loadTsv('M6_seats.tsv', 2);
console.log(`M6-F1(对手强度)=${num(M6old.size)}`);

/* ── 相关性计算 ── */
function rhoWith(vmap, omap) {
  const ids = [];
  for (const [pid, v] of vmap) if (omap.has(pid)) ids.push(pid);
  if (ids.length < 10) return null;
  const x = ids.map((p) => vmap.get(p).s != null ? vmap.get(p).s : vmap.get(p));
  const y = ids.map((p) => omap.get(p));
  return { rho: spearman(x, y), n: ids.length };
}
function rhoPlain(vmap, omap) {
  const ids = [];
  for (const [pid, v] of vmap) if (omap.has(pid)) ids.push(pid);
  if (ids.length < 10) return null;
  const x = ids.map((p) => (typeof vmap.get(p) === 'object' ? vmap.get(p).s : vmap.get(p)));
  const y = ids.map((p) => omap.get(p));
  return { rho: spearman(x, y), n: ids.length };
}

const NAMES = {
  A: 'A 全级别原始sum', B: 'B 全级别截顶0.5', C: 'C 仅WR原始', D: 'D 仅WR截顶',
  E: 'E WR+CR截顶', F: 'F WR权重2+CR+截顶', G: 'G 只算夺权(非自我)',
};
const DIMS = [
  ['M1 纪录', M1], ['M2 领奖台', M2], ['M4 统治力', M4], ['M5 当前排名', M5],
  ['M6-F1 对手强度', M6old],
];

console.log('\n' + '='.repeat(88));
console.log('正交性矩阵（Spearman ρ，对封存后的各维）');
console.log('='.repeat(88));
console.log('  口径'.padEnd(22) + DIMS.map((d) => (d[0] + ' ρ').padStart(16)).join(''));
for (const tag of Object.keys(VARIANTS)) {
  const vm = VARIANTS[tag];
  const cells = DIMS.map(([nm, om]) => {
    const r = rhoPlain(vm, om);
    if (!r) return 'n/a'.padStart(16);
    const mark = Math.abs(r.rho) > 0.7 ? '❌' : (Math.abs(r.rho) > 0.5 ? '⚠️' : '✅');
    return `${F(r.rho, 4)}${mark} n=${r.n}`.padStart(16);
  });
  console.log('  ' + (NAMES[tag] || tag).padEnd(22) + cells.join(''));
}

/* ── 与「刷新次数」的相关性（自洽性检查）── */
console.log('\n' + '='.repeat(88));
console.log('自洽性检查：与「刷新条数」的相关性（应高，说明是同源信号）');
console.log('='.repeat(88));
for (const tag of Object.keys(VARIANTS)) {
  const vm = VARIANTS[tag];
  const ids = [...vm.keys()];
  const x = ids.map((p) => vm.get(p).s), y = ids.map((p) => vm.get(p).n);
  console.log(`  ${(NAMES[tag] || tag).padEnd(22)} ρ(sum, 条数) = ${F(spearman(x, y), 4)}`);
}

/* ── Top25 重合 ── */
console.log('\n' + '='.repeat(88));
console.log('Top25 与各维的重合数');
console.log('='.repeat(88));
for (const tag of Object.keys(VARIANTS)) {
  const vm = VARIANTS[tag];
  const top = [...vm.entries()].sort((a, b) => b[1].s - a[1].s).slice(0, 25).map(([p]) => p);
  const S = new Set(top);
  const cells = DIMS.map(([nm, om]) => {
    const ids = [...om.keys()].filter((p) => S.has(p));
    return `${String(ids.length).padStart(3)}/25`;
  });
  console.log('  ' + (NAMES[tag] || tag).padEnd(22) + cells.join(''));
}

/* ── 锚点检验：官方 WR 持有者 / M2 Top / M4 Top 是否在新榜前列 ── */
console.log('\n' + '='.repeat(88));
console.log('锚点检验（各口径 Top30 内命中数）');
console.log('='.repeat(88));
const anchorSets = {
  '曾刷新WR(281人)': new Set([...VARIANTS.C.keys()]),
  'M2 Top100': new Set([...M2.entries()].sort((a, b) => b[1] - a[1]).slice(0, 100).map(([p]) => p)),
  'M4 Top100': new Set([...M4.entries()].sort((a, b) => b[1] - a[1]).slice(0, 100).map(([p]) => p)),
  'M5 Top100': new Set([...M5.entries()].sort((a, b) => b[1] - a[1]).slice(0, 100).map(([p]) => p)),
};
for (const tag of Object.keys(VARIANTS)) {
  const vm = VARIANTS[tag];
  const top = new Set([...vm.entries()].sort((a, b) => b[1].s - a[1].s).slice(0, 30).map(([p]) => p));
  const cells = Object.entries(anchorSets).map(([nm, S]) => {
    let h = 0; for (const p of S) if (top.has(p)) h++;
    return `${nm}:${h}`.padStart(20);
  });
  console.log('  ' + (NAMES[tag] || tag).padEnd(22) + cells.join(''));
}

/* ── 单项目分离度：WR 口径下各项目的独立榜首 ── */
console.log('\n' + '='.repeat(88));
console.log('单项目分离度（用 m6b_events.tsv 算每个 WR 项目的独立榜首）');
console.log('='.repeat(88));
{
  const lines = fs.readFileSync(path.join(D, 'm6b_events.tsv'), 'utf8').trim().split('\n');
  const perEv = new Map();
  for (const ln of lines) {
    const c = ln.split('\t');
    if (c[4] !== 'WR') continue;
    const k = c[2] + '|' + c[3];
    const g = +c[9];
    let a = perEv.get(k);
    if (!a) { a = new Map(); perEv.set(k, a); }
    a.set(c[0], (a.get(c[0]) || 0) + g);
  }
  const tops = new Set();
  let n = 0;
  for (const [k, m] of perEv) {
    const best = [...m.entries()].sort((a, b) => b[1] - a[1])[0];
    tops.add(best[0]); n++;
  }
  console.log(`  WR 项目/轨数 = ${n}  独立榜首 = ${tops.size}`);
  const byEv = new Map();
  for (const [k, m] of perEv) {
    const best = [...m.entries()].sort((a, b) => b[1] - a[1])[0];
    const nm = [...m.keys()];
    const who = byEv.get(k);
    byEv.set(k, best);
  }
  let i = 0;
  for (const [k, [pid, s]] of byEv) {
    i++;
    if (i > 25) break;
    console.log(`    ${k.padEnd(14)} 榜首 pid=${pid}  sum=${F(s)}`);
  }
}

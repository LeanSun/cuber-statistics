'use strict';
/* ═══════════════════════════════════════════════════════════════════════
 * M6-c 诊断 2 · 窗口统治力的正交性检验 + 锚点检验
 *   读 m6c_seats.tsv（diag1 产出）与封存的 M1/M2/M4/M5，
 *   实测 Spearman；锚点用 wca_id 查。
 * 用法：node --max-old-space-size=8192 etl/score/m6c_diag2.js
 */
const fs = require('fs');
const path = require('path');
const D = __dirname;

function loadTsv(file, pidCol, valCol) {
  const lines = fs.readFileSync(path.join(D, file), 'utf8').trim().split('\n');
  const m = new Map();
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split('\t');
    const pid = c[pidCol], v = +c[valCol];
    if (pid && Number.isFinite(v)) m.set(pid, v);
  }
  return m;
}

function spearman(pairs) {
  const n = pairs.length;
  if (n < 10) return { n, rho: NaN };
  const rank = (arr) => {
    const idx = arr.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
    const r = new Float64Array(n);
    let i = 0;
    while (i < n) {
      let j = i;
      while (j + 1 < n && arr[idx[j + 1][1]] === arr[idx[i][1]]) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
      i = j + 1;
    }
    return r;
  };
  const ra = rank(pairs.map((p) => p[0])), rb = rank(pairs.map((p) => p[1]));
  let sx = 0, sy = 0, sxy = 0;
  for (let i = 0; i < n; i++) { const dx = ra[i], dy = rb[i]; sx += dx * dx; sy += dy * dy; sxy += dx * dy; }
  return { n, rho: sxy / Math.sqrt(sx * sy) };
}

/* ── 载入 ── */
const M1 = loadTsv('M1_full.tsv', 0, 2);
const M2 = loadTsv('M2_ranking.tsv', 1, 3);
const M4 = loadTsv('M4_seats.tsv', 0, 2);
const M5 = loadTsv('M5_seats.tsv', 0, 2);
const V = loadTsv('m6c_seats.tsv', 0, 2);   // year_strict
const R = loadTsv('m6c_seats.tsv', 0, 3);   // year_rel
const QS = loadTsv('m6c_seats.tsv', 0, 4);  // quarter_strict
const QR = loadTsv('m6c_seats.tsv', 0, 5);  // quarter_rel

/* ── 领奖台条数（M2 的 n 榜代理）── 用 M6_seats 的 n_podiums? 不必，略 */

const VARIANTS = { year_strict: V, year_rel: R, quarter_strict: QS, quarter_rel: QR };
const DIMS = { M1, M2, M4, M5 };

console.log('=== 正交性矩阵（Spearman） ===');
console.log('维度'.padEnd(16), ...Object.keys(DIMS).map((d) => d.padEnd(9)), '条数代理'.padEnd(9));
for (const [vn, vm] of Object.entries(VARIANTS)) {
  const row = [vn.padEnd(16)];
  for (const [dn, dm] of Object.entries(DIMS)) {
    const pairs = [];
    for (const [pid, v] of vm) { const o = dm.get(pid); if (o !== undefined) pairs.push([v, o]); }
    const { n, rho } = spearman(pairs);
    row.push((rho.toFixed(4) + '/n' + n).padEnd(9));
  }
  console.log(...row);
}

/* 占席条数与参赛窗口数的关系（窗口=nw 列）——诊断「长生涯偏差」 */
const lines = fs.readFileSync(path.join(D, 'm6c_seats.tsv'), 'utf8').trim().split('\n');
const nwPairs = [];
for (let i = 1; i < lines.length; i++) {
  const c = lines[i].split('\t');
  nwPairs.push([+c[2], +c[6]]);   // year_strict vs year_nw
}
console.log('\nρ(year_strict, 活跃年窗口数) =', spearman(nwPairs).rho.toFixed(4));

/* ── 锚点（wca_id） ── */
console.log('\n=== 锚点检验 ===');
const nameLines = lines;
const ANCH = [
  ['2009ZEMD01', 'Feliks'], ['2012PARK03', 'Max'], ['2016KOLA02', 'Tymon'],
  ['2017WANY36', 'Yiheng(?)'], ['2016CHAP04', 'Stanley'], ['2013EGDA02', 'Egdal'],
];
for (const [vn, vm] of Object.entries(VARIANTS)) {
  const arr = [...vm.entries()].sort((a, b) => b[1] - a[1]);
  const rankOf = new Map();
  arr.forEach(([pid], i) => rankOf.set(pid, i + 1));
  const parts = ANCH.map(([pid, nm]) => {
    const r = rankOf.get(pid);
    const v = vm.get(pid);
    return nm + ' #' + (r || '-') + '(' + (v ? v.toFixed(1) : '-') + ')';
  });
  console.log(' ', vn.padEnd(15), parts.join('  '));
}

/* Yiheng 的真实 id 确认：查 m6c_seats 里 2017WANY36 的姓名 */
for (let i = 1; i < Math.min(lines.length, 200000); i++) {
  const c = lines[i].split('\t');
  if (c[0] === '2017WANY36') console.log('\n2017WANY36 =', c[1], '| year_strict =', c[2], '| 窗口数 =', c[6]);
}

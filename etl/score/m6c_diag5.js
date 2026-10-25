'use strict';
/* M6-c 诊断 5 · 收口检验
 *   ① 各占席变体 vs M6-F1（对手强度）的相关性
 *   ② 残差版：peakSq / top3sq 对 M4 在秩空间回归取残差 → 再测正交性 + 锚点
 * 用法：node --max-old-space-size=8192 etl/score/m6c_diag5.js
 */
const fs = require('fs');
const path = require('path');
const D = __dirname;

function loadTsv(file, pc, vc) {
  const L = fs.readFileSync(path.join(D, file), 'utf8').trim().split('\n');
  const m = new Map();
  for (let i = 1; i < L.length; i++) { const c = L[i].split('\t'); const v = +c[vc]; if (c[pc] && Number.isFinite(v)) m.set(c[pc], v); }
  return m;
}
function spearman(pairs) {
  const n = pairs.length;
  if (n < 10) return { n, rho: NaN };
  const rank = (arr) => {
    const idx = arr.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
    const r = new Float64Array(n); let i = 0;
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
  for (let i = 0; i < n; i++) { sx += ra[i] * ra[i]; sy += rb[i] * rb[i]; sxy += ra[i] * rb[i]; }
  return { n, rho: sxy / Math.sqrt(sx * sy) };
}
/* 秩空间线性残差 */
function rankResidual(pairs) {
  const n = pairs.length;
  const rank = (arr) => {
    const idx = arr.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
    const r = new Float64Array(n); let i = 0;
    while (i < n) {
      let j = i;
      while (j + 1 < n && arr[idx[j + 1][1]] === arr[idx[i][1]]) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
      i = j + 1;
    }
    return r;
  };
  const x = rank(pairs.map((p) => p[0])), y = rank(pairs.map((p) => p[1]));
  let mx = 0, my = 0;
  for (let i = 0; i < n; i++) { mx += x[i]; my += y[i]; }
  mx /= n; my /= n;
  let sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) * (x[i] - mx); }
  const beta = sxy / sxx;
  const resid = new Map();   // 返回 pairs 的 index → 残差
  for (let i = 0; i < n; i++) resid.set(i, (y[i] - my) - beta * (x[i] - mx));
  return { beta, resid };
}

const DIMS = {
  M1: loadTsv('M1_full.tsv', 0, 2), M2: loadTsv('M2_ranking.tsv', 1, 3),
  M4: loadTsv('M4_seats.tsv', 0, 2), M5: loadTsv('M5_seats.tsv', 0, 2),
  M6F1: loadTsv('M6_seats.tsv', 0, 2),
};
const ANCH = { '2009ZEMD01': 'Feliks', '2012PARK03': 'Max', '2016KOLA02': 'Tymon', '2019WANY36': 'Yiheng', '2016CHAP04': 'Chapel', '2005AKKE01': 'Akke', '2013EGDA02': 'Egdal', '2019TARA09': 'Timofei' };

/* v3: y_peakET=col5, y_top3sq=col6；v4: peakSq=col6 */
const SRC = {
  y_peakET: loadTsv('m6c_seats_v3.tsv', 0, 5),
  y_top3sq: loadTsv('m6c_seats_v3.tsv', 0, 6),
  peakSq: loadTsv('m6c_seats_v4.tsv', 0, 6),
};

console.log('=== ① 占席变体 × 各维（含 M6-F1） ===');
for (const [vn, vm] of Object.entries(SRC)) {
  const row = [vn.padEnd(10)];
  for (const [dn, dm] of Object.entries(DIMS)) {
    const pairs = [];
    for (const [pid, v] of vm) { const o = dm.get(pid); if (o !== undefined) pairs.push([v, o]); }
    const { n, rho } = spearman(pairs);
    row.push((dn + ' ' + rho.toFixed(4) + '/n' + n).padEnd(17));
  }
  console.log(...row);
}

console.log('\n=== ② 残差版：秩空间对 M4 回归取残差 ===');
for (const [vn, vm] of Object.entries(SRC)) {
  const pairs4 = [];
  const idxPid = [];
  for (const [pid, v] of vm) { const o = DIMS.M4.get(pid); if (o !== undefined) { pairs4.push([v, o]); idxPid.push(pid); } }
  const { beta, resid } = rankResidual(pairs4);
  const rm = new Map();
  for (let i = 0; i < idxPid.length; i++) rm.set(idxPid[i], resid.get(i));
  const row = [(vn + '_resM4').padEnd(16)];
  for (const [dn, dm] of Object.entries(DIMS)) {
    const pairs = [];
    for (const [pid, v] of rm) { const o = dm.get(pid); if (o !== undefined) pairs.push([v, o]); }
    const { n, rho } = spearman(pairs);
    row.push((dn + ' ' + rho.toFixed(4) + '/n' + n).padEnd(17));
  }
  console.log(...row, ' (β=' + beta.toFixed(3) + ')');
  const sorted = [...rm.entries()].sort((a, b) => b[1] - a[1]);
  const rk = new Map(); sorted.forEach(([pid], i) => rk.set(pid, i + 1));
  console.log('   锚点:', Object.entries(ANCH).map(([pid, nm]) => nm + ' #' + (rk.get(pid) || '-')).join('  '));
}

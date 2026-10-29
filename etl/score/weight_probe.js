#!/usr/bin/env node
/* 权重方案探针：读六维站点表，对各候选权重方案做分布/排名/敏感度体检。
   用法：node --max-old-space-size=6144 etl/score/weight_probe.js
   只读，不写任何交付表。 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');

const src = fs.readFileSync(path.join(ROOT, 'js/sixdim_data.js'), 'utf8');
const i0 = src.indexOf('{');
const SD = JSON.parse(src.slice(i0, src.lastIndexOf('}') + 1));
const nameOf = new Map(SD.rows.map((r) => [r.id, r.n]));

const K = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6'];
const W0 = SD.meta.weights;

/* 分数取 sixdim_site.tsv 的 s_d（已归一：s_d = Σ_ev (v/mx)·evW·FULL/wSum），
   不取 sixdim_data.js 的 M1..M6（那是原始维度值，量纲差几个数量级）。 */
const rows = [];
for (const ln of fs.readFileSync(path.join(__dirname, 'sixdim_site.tsv'), 'utf8').trim().split('\n').slice(1)) {
  const c = ln.split('\t');
  rows.push({
    id: c[0], n: nameOf.get(c[0]) || c[0],
    M1: +c[1], M2: +c[2], M3: +c[3], M4: +c[4], M5: +c[5], M6: +c[6], t: +c[7],
  });
}

const pct = (a, q) => {
  const b = [...a].sort((x, y) => x - y);
  return b[Math.min(b.length - 1, Math.floor(q * (b.length - 1)))];
};
const stat = (a) => {
  const n = a.length;
  let s = 0;
  for (const v of a) s += v;
  const m = s / n;
  let v2 = 0;
  for (const v of a) v2 += (v - m) * (v - m);
  return { n, mean: m, sd: Math.sqrt(v2 / n), p50: pct(a, 0.5), p90: pct(a, 0.9), p99: pct(a, 0.99), max: Math.max(...a.slice(0, 0).concat(a.reduce((x, y) => (y > x ? y : x), 0))) };
};

console.log(`样本 ${rows.length} 人（站点交付表口径）`);
console.log('\n── 各维分布（s_d，已归一，单位：分）──');
console.log('dim   mean    sd     p50     p90     p99     max     有分人数');
for (const k of K) {
  const a = rows.map((r) => r[k] || 0);
  const nz = a.filter((v) => v > 0);
  const s = stat(a);
  console.log(`${k}  ${s.mean.toFixed(1).padStart(7)} ${s.sd.toFixed(1).padStart(7)} ${s.p50.toFixed(1).padStart(7)} ${s.p90.toFixed(1).padStart(7)} ${s.p99.toFixed(1).padStart(7)} ${s.max.toFixed(1).padStart(7)}  ${nz.length}`);
}

/* 相关性（Pearson，log1p 压缩长尾） */
const L = (v) => Math.log1p(Math.max(0, v));
function pear(a, b) {
  const n = a.length;
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let sa = 0, sb = 0, sab = 0;
  for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; sa += x * x; sb += y * y; sab += x * y; }
  return sab / Math.sqrt(sa * sb || 1);
}
console.log('\n── 相关性（log1p 后的 Pearson）──');
console.log('     ' + K.map((k) => k.padStart(6)).join(''));
for (const k1 of K) {
  const line = K.map((k2) => pear(rows.map((r) => L(r[k1] || 0)), rows.map((r) => L(r[k2] || 0))).toFixed(2).padStart(6)).join('');
  console.log(k1 + ' ' + line);
}

/* ── 候选方案 ── */
const PLANS = JSON.parse(process.argv[2] || 'null') || [
  { id: 'A 现行', w: { M1: 0.28, M2: 0.24, M3: 0.12, M4: 0.18, M5: 0.08, M6: 0.10 } },
  { id: 'B 温和', w: { M1: 0.36, M3: 0.20, M2: 0.16, M4: 0.12, M6: 0.10, M5: 0.06 } },
  { id: 'C 集中', w: { M1: 0.42, M3: 0.22, M2: 0.14, M4: 0.10, M6: 0.08, M5: 0.04 } },
  { id: 'D 强集中', w: { M1: 0.48, M3: 0.22, M2: 0.12, M4: 0.08, M6: 0.07, M5: 0.03 } },
  { id: 'E 极端', w: { M1: 0.55, M3: 0.20, M2: 0.11, M4: 0.07, M6: 0.05, M5: 0.02 } },
];
const score = (r, w) => {
  const sw = K.reduce((s, k) => s + w[k], 0);
  let t = 0;
  for (const k of K) t += w[k] * (r[k] || 0);
  return t / sw;
};
function rank(rows, w) {
  const arr = rows.map((r) => ({ id: r.id, n: r.n, s: score(r, w), r }));
  arr.sort((a, b) => b.s - a.s);
  return arr;
}
const base = rank(rows, W0);const basePos = new Map(base.map((x, i) => [x.id, i + 1]));
/* 各维单维前 100（用于判断「总分是否退化成某一维的榜」） */
const dimTop = {};
for (const k of K) {
  dimTop[k] = new Set(rows.slice().sort((a, b) => (b[k] || 0) - (a[k] || 0)).slice(0, 100).map((r) => r.id));
}
function spearman(w) {
  const cur = rank(rows, w);
  const n = cur.length;
  let d2 = 0;
  for (let i = 0; i < n; i++) { const d = i + 1 - basePos.get(cur[i].id); d2 += d * d; }
  return 1 - (6 * d2) / (n * (n * n - 1));
}

console.log('\n── 方案对比 ──');
for (const P of PLANS) {
  const w = P.w;
  const sw = K.reduce((s, k) => s + w[k], 0);
  const order = ['M1', 'M3', 'M2', 'M4', 'M6', 'M5'];
  const okOrd = order.every((k, i) => i === 0 || w[order[i - 1]] > w[k]);
  const rk = rank(rows, w);
  const top100 = new Set(rk.slice(0, 100).map((x) => x.id));
  const overlap = base.slice(0, 100).filter((x) => top100.has(x.id)).length;
  const sumW = K.map((k) => `${k} ${(w[k] * 100).toFixed(0)}%`).join(' ');
  console.log(`\n【${P.id}】${sumW}  合计 ${(sw * 100).toFixed(0)}%  排序合规=${okOrd}`);
  console.log(`  Top100 重合 ${overlap}/100  Spearman(vs 现行) ${spearman(w).toFixed(4)}`);
  console.log('  总分Top100 与各维前100 的交集: ' + K.map((k) => `${k} ${rk.slice(0, 100).filter((x) => dimTop[k].has(x.id)).length}`).join(' '));
  console.log('  Top10:');
  rk.slice(0, 10).forEach((x, i) => {
    const prev = basePos.get(x.id);
    const mv = prev - (i + 1);
    const tag = mv > 0 ? `↑${mv}` : mv < 0 ? `↓${-mv}` : '—';
    console.log(`   ${String(i + 1).padStart(2)} ${x.n.padEnd(22).slice(0, 22)} ${x.s.toFixed(1).padStart(7)}  现#${String(prev).padStart(3)} ${tag}`);
  });
  /* 各维贡献占比（Top100 平均） */
  const meanTop = K.map((k) => {
    let a = 0;
    for (const x of rk.slice(0, 100)) a += x.r[k] || 0;
    return a / 100;
  });
  const contrib = K.map((k, i) => w[k] * meanTop[i]);
  const tot = contrib.reduce((a, b) => a + b, 0);
  console.log('  Top100 各维均值: ' + K.map((k, i) => `${k} ${meanTop[i].toFixed(0)}`).join(' '));
  console.log('  Top100 各维贡献: ' + K.map((k, i) => `${k} ${((contrib[i] / tot) * 100).toFixed(1)}%`).join(' '));
  if (P.id !== 'A 现行') {
    const inSet = new Set(rk.slice(0, 100).map((x) => x.id));
    const gone = base.slice(0, 100).filter((x) => !inSet.has(x.id));
    const came = rk.slice(0, 100).filter((x) => basePos.get(x.id) > 100);
    console.log(`  掉出前100(${gone.length}): ` + gone.slice(0, 12).map((x) => `${x.n}(#${basePos.get(x.id)})`).join('、'));
    console.log(`  新进前100(${came.length}): ` + came.slice(0, 12).map((x) => `${x.n}(#${basePos.get(x.id)}→#${rk.indexOf(x) + 1})`).join('、'));
  }
}

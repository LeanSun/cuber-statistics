/**
 * M5 · 「去衰减」对照探针（只读诊断，不改主口径）
 * ═══════════════════════════════════════════════════════════════════════
 * 动因：用户主张「时间衰减毫无意义」，要求去掉 M5 里的全部 decay。
 * 本脚本**完全不碰主脚本**，只用冻结产物 `M5_by_event.tsv` 反算：
 *
 *   none 口径分数 = Σ (score / decay) ≡ Σ w_e · rank^-1.0 · track_weight
 *
 * （`M5_by_event.tsv` 的 score 列是 dual 口径乘积，decay = dR×dP，除法即可还原裸分）
 *
 * 回答四个问题：
 *   1. 去掉衰减后，人口 / 总量 / Top25 变成什么样
 *   2. 谁受益、谁受损（名次漂移）
 *   3. P1 病灶（活跃但 PB 陈旧）与「退役化石」复活到什么程度
 *   4. 正交性会不会崩（×M4 / ×M2 / ×M6）
 *
 * 用法：node etl/score/m5_nodecay_probe.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const RN = require('./runs.js');

const DIR = __dirname;
const F4 = RN.F4;
const readTsv = (f) => fs.readFileSync(path.join(DIR, f), 'utf8').trim().split('\n')
  .map((l) => l.split('\t'));
const headMap = (rows) => rows[0].reduce((m, k, i) => (m[k] = i, m), {});
const F = (v) => F4(v);
const P4 = (v) => (v * 100).toFixed(2) + '%';

/* ── 1. 读 M5 明细，还原四种口径 ──────────────────────────────────── */
const rowsRaw = readTsv('M5_by_event.tsv');
const H = headMap(rowsRaw);
const rows = rowsRaw.slice(1).map((c) => ({
  pid: c[H.pid], name: c[H.name], ev: c[H.event], tr: c[H.track],
  wr: +c[H.world_rank], w: +c[H.w_e],
  gapR: +c[H.gapR_years], gapP: +c[H.gapP_years],
  decay: +c[H.decay], score: +c[H.score],
}));

/* TSV 只保留 4 位小数，用 score 反除会有 ~1e-3 噪声，故这里校验
   「重算分 vs TSV 记录的 score」是否一致（阈值 5e-4 = 半个最小位） */
let maxDelta = 0;
for (const r of rows) {
  const rebuilt = r.w * Math.pow(r.wr, -1.0) * r.decay;
  const d = Math.abs(rebuilt - r.score);
  if (d > maxDelta) maxDelta = d;
}

/* 四种口径 */
const MODES = ['none', 'retire', 'pb', 'dual'];
const decayOf = (gap) => Math.max(0.2, 1 - (gap / 5) * 0.8);   // 与冻结脚本同参数
const combo = (mode, gR, gP) => {
  const dR = decayOf(gR), dP = decayOf(gP);
  if (mode === 'none') return 1;
  if (mode === 'pb') return dP;
  if (mode === 'dual') return dR * dP;
  return dR;
};

const agg = {};      // mode → Map(pid → {name, s, evs:Set, rank1, best, n})
const comboRows = {}; // mode → 明细（复算自对称微粒）
for (const m of MODES) {
  const per = new Map(); const det = [];
  for (const r of rows) {
    const d = combo(m, r.gapR, r.gapP);
    const s = r.w * Math.pow(r.wr, -1.0) * d;
    if (s <= 0) continue;
    det.push({ ...r, s });
    let q = per.get(r.pid);
    if (!q) { q = { pid: r.pid, name: r.name, s: 0, evs: new Set(), rank1: 0, best: 1e9, oldestPB: 0 }; per.set(r.pid, q); }
    q.s += s; q.evs.add(r.ev);
    if (r.wr === 1) q.rank1++;
    if (r.wr < q.best) q.best = r.wr;
    if (r.gapP > q.oldestPB) q.oldestPB = r.gapP;
  }
  const arr = [...per.values()].sort((a, b) => b.s - a.s || a.name.localeCompare(b.name));
  // 名次必须在 map 里固化：arr 之后会被别的排序逻辑复用
  const rank = new Map(); arr.forEach((p, i) => rank.set(p.pid, i + 1));
  agg[m] = { arr, per, rank, det, total: arr.reduce((a, p) => a + p.s, 0) };
}

const L = [];
L.push('# M5「去衰减」对照探针');
L.push('');
L.push('> 数据：`M5_by_event.tsv`（M5-F1 冻结产物，' + rows.length + ' 条）');
L.push('> `none` 口径 = Σ w_e · rank^-1.0（无任何时间项）；其余三档为对照');
L.push('> 自洽校验：重算的 `w·wr^-1.0·decay` 与 TSV 记录的 `score` 最大偏差 = **'
  + maxDelta.toExponential(2) + '**' + (maxDelta < 5e-4 ? ' ✓（TSV 保留 4 位小数的舍入噪声）' : ' ⚠'));
L.push('');

/* ── 2. 总量对照 ─────────────────────────────────────────────────── */
L.push('## 1 四口径总量');
L.push('');
L.push('| 口径 | 计分人数 | 全站总量 | 相对 none |');
L.push('|---|---:|---:|---:|');
for (const m of MODES) {
  const a = agg[m];
  L.push('| ' + (m === 'dual' ? '**dual（现口径）**' : m) + ' | ' + a.arr.length
    + ' | ' + (m === 'dual' ? '**' + F(a.total) + '**' : F(a.total))
    + ' | ' + (m === 'none' ? '—' : P4(a.total / agg.none.total - 1)) + ' |');
}
L.push('');

/* ── 3. none Top25 vs dual 名次 ───────────────────────────────────── */
const topN = (m, n) => agg[m].arr.slice(0, n);
L.push('## 2 none 口径 Top25（对照现口径名次）');
L.push('');
L.push('| # | 选手 | none 分 | 现口径名次 | 漂移 | 覆盖项目 | 最旧 PB |');
L.push('|---:|---|---:|---:|---:|---:|---:|');
topN('none', 25).forEach((p, i) => {
  const dr = agg.dual.rank.get(p.pid);
  const move = dr == null ? '新入' : (dr - (i + 1) === 0 ? '—' : (dr - (i + 1) > 0 ? '↑' + (dr - (i + 1)) : '↓' + ((i + 1) - dr)));
  L.push('| ' + (i + 1) + ' | ' + p.name + ' | ' + F(p.s) + ' | ' + (dr == null ? '未计分' : '#' + dr)
    + ' | ' + move + ' | ' + p.evs.size + ' | ' + F(p.oldestPB) + 'y |');
});
L.push('');

L.push('## 3 排名漂移最大的 15 人（none 相对现口径）');
L.push('');
L.push('| 选手 | 现口径 # | none # | 变化 | 现分 | none 分 |');
L.push('|---|---:|---:|---|---:|---:|');
const allPid = new Set([...agg.dual.per.keys(), ...agg.none.per.keys()]);
const drift = [...allPid].map((pid) => {
  const rd = agg.dual.rank.get(pid), rn = agg.none.rank.get(pid);
  return {
    name: (agg.dual.per.get(pid) || agg.none.per.get(pid)).name,
    rd: rd || 9999, rn: rn || 9999, d: (rd || 9999) - (rn || 9999),
    sd: agg.dual.per.has(pid) ? agg.dual.per.get(pid).s : 0,
    sn: agg.none.per.has(pid) ? agg.none.per.get(pid).s : 0,
  };
}).sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
drift.slice(0, 15).forEach((x) => {
  L.push('| ' + x.name + ' | #' + x.rd + ' | #' + x.rn + ' | ' + (x.d > 0 ? '↑' + x.d : x.d < 0 ? '↓' + (-x.d) : '—')
    + ' | ' + F(x.sd) + ' | ' + F(x.sn) + ' |');
});
L.push('');

/* ── 4. 病灶对照 ─────────────────────────────────────────────────── */
const sumIf = (m, fn) => {
  let s = 0, n = 0;
  for (const r of agg[m].det) if (fn(r)) { s += r.s; n++; }
  return { s, n };
};
const P1 = (r) => r.gapR < 1 && r.gapP >= 2;      // 还在参赛，但 PB ≥2 年未刷新
const FOSSIL = (r) => r.gapR >= 3;                 // 该项目内 ≥3 年没参赛
L.push('## 4 病灶：去掉衰减后复活多少');
L.push('');
L.push('| 病灶 | 判据 | 条目 | none 贡献 | 现口径贡献 | 回升 |');
L.push('|---|---|---:|---:|---:|---:|');
for (const [label, fn] of [['**P1：活跃但 PB 陈旧**', P1], ['退役化石：该项目 ≥3 年未参赛', FOSSIL]]) {
  const a = sumIf('none', fn), b = sumIf('dual', fn);
  L.push('| ' + label + ' | — | ' + a.n + ' | ' + F(a.s) + '（' + P4(a.s / agg.none.total) + '） | '
    + F(b.s) + '（' + P4(b.s / agg.dual.total) + '） | **+' + P4(a.s / b.s - 1) + '** |');
}
L.push('');

/* 只看「化石」最受益的人 */
const fossilGain = new Map();
for (const r of rows) {
  const dNone = 1, dDual = combo('dual', r.gapR, r.gapP);
  const g = r.w * Math.pow(r.wr, -1.0) * (dNone - dDual);
  fossilGain.set(r.pid, (fossilGain.get(r.pid) || 0) + g);
}
L.push('**去掉衰减后增量最大的 10 人**（绝对值，即「谁靠僵尸名次回血」）：');
L.push('');
L.push('| # | 选手 | 增量 | none 分 | 备注 |');
L.push('|---:|---|---:|---:|---|');
[...fossilGain.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).forEach(([pid, g], i) => {
  const p = agg.none.per.get(pid);
  const mx = rows.filter((r) => r.pid === pid).sort((a, b) => b.gapP - a.gapP)[0];
  L.push('| ' + (i + 1) + ' | ' + p.name + ' | +' + F(g) + ' | ' + F(p.s)
    + ' | 最旧 PB ' + F(mx.gapP) + 'y @ ' + mx.ev + '|' + mx.tr + ' #' + mx.wr + ' |');
});
L.push('');

/* ── 5. 榜内「僵尸率」 ────────────────────────────────────────────── */
const zombie = (m) => {
  const top = topN(m, 25);
  const old = top.filter((p) => p.oldestPB >= 5).length;
  const avgOld = top.reduce((a, p) => a + p.oldestPB, 0) / top.length;
  return { old, avgOld };
};
const zn = zombie('none'), zd = zombie('dual');
L.push('## 5 Top25 的「名次新鲜度」');
L.push('');
L.push('| 口径 | Top25 中有人 ≥5 年未刷 PB 的人数 | Top25 最旧 PB 均值 |');
L.push('|---|---:|---:|');
L.push('| none（去衰减） | ' + zn.old + ' / 25 | ' + F(zn.avgOld) + 'y |');
L.push('| dual（现口径） | ' + zd.old + ' / 25 | ' + F(zd.avgOld) + 'y |');
L.push('');

/* ── 6. 正交性 ───────────────────────────────────────────────────── */
function spearmanPairs(pairs) {
  const n = pairs.length;
  if (n < 3) return null;
  const rx = {}, ry = {};
  const sx = pairs.map((p) => p[0]).sort((a, b) => a - b);
  const sy = pairs.map((p) => p[1]).sort((a, b) => a - b);
  const mapOf = (s) => { const m = new Map(); let i = 0; while (i < s.length) { let j = i; while (j + 1 < s.length && s[j + 1] === s[i]) j++; const r = (i + j) / 2 + 1; for (let k = i; k <= j; k++) m.set(s[k], r); i = j + 1; } return m; };
  const mx = mapOf(sx), my = mapOf(sy);
  const X = pairs.map((p) => mx.get(p[0])), Y = pairs.map((p) => my.get(p[1]));
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const mX = mean(X), mY = mean(Y);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { num += (X[i] - mX) * (Y[i] - mY); dx += (X[i] - mX) ** 2; dy += (Y[i] - mY) ** 2; }
  return num / Math.sqrt(dx * dy);
}

const loadSeats = (f, key, valIdx) => {
  const r = readTsv(f); const h = headMap(r); const m = new Map(); const order = new Map();
  r.slice(1).forEach((c, i) => { m.set(c[h[key]], +c[h[valIdx]]); if (!order.has(c[h[key]])) order.set(c[h[key]], i + 1); });
  return { val: m, order };
};
const M4 = loadSeats('M4_seats.tsv', 'pid', 'm4');
const M2 = loadSeats('M2_ranking.tsv', 'pid', 'total');
const M6 = loadSeats('M6_seats.tsv', 'pid', 'm6');

L.push('## 6 正交性（Spearman，取该口径 Top100 ∩ 对照榜）');
L.push('');
L.push('| 配对 | none 样本 | none ρ | 现口径样本 | 现口径 ρ |');
L.push('|---|---:|---:|---:|---:|');
for (const [label, S] of [['× M4 统治力', M4], ['× M2 领奖台', M2], ['× M6 领先幅度', M6]]) {
  const out = [];
  for (const m of ['none', 'dual']) {
    const top = topN(m, 100);
    const pairs = [];
    for (const p of top) {
      /* 与封存 §4.7 同口径：对照榜也只取 Top100 内，再取交集 */
      const rOut = S.order.get(p.pid);
      if (rOut == null || rOut > 100) continue;
      pairs.push([agg[m].rank.get(p.pid), rOut]);
    }
    out.push({ n: pairs.length, r: pairs.length >= 3 ? spearmanPairs(pairs) : null });
  }
  L.push('| ' + label + ' | ' + out[0].n + ' | ' + (out[0].r == null ? '—' : out[0].r.toFixed(4))
    + ' | ' + out[1].n + ' | ' + (out[1].r == null ? '—' : out[1].r.toFixed(4)) + ' |');
}
L.push('');

/* ── 7. 关键选手 ─────────────────────────────────────────────────── */
L.push('## 7 关键选手位次');
L.push('');
const KEY = ['2009ZEMD01', '2016KOLA02', '2019TARA09', '2012PARK03', '2016CHAP01', '2017WANG44'];
L.push('| 选手 | 现口径 # / 分 | none # / 分 |');
L.push('|---|---|---|');
for (const pid of KEY) {
  const a = agg.dual.per.get(pid), b = agg.none.per.get(pid);
  if (!a && !b) continue;
  const name = (a || b).name;
  L.push('| ' + name + ' | ' + (a ? '#' + agg.dual.rank.get(pid) + ' / ' + F(a.s) : '未计分')
    + ' | ' + (b ? '#' + agg.none.rank.get(pid) + ' / ' + F(b.s) : '未计分') + ' |');
}
L.push('');
L.push('> 探针结论仅供决策，主口径未改。要落地请把 `CFG.DECAY_MODE` 设为 `none` 并重跑冻结回归。');

const out = path.join(DIR, 'M5_去衰减对照探针.md');
fs.writeFileSync(out, L.join('\n'), 'utf8');
console.log(L.join('\n'));
console.log('\n[written] ' + out);

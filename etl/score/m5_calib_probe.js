/**
 * m5_calib_probe.js · M5「按项目标定 · 分段比值法」只读全站探针
 * -----------------------------------------------------------------------------
 * 需求（用户 2026-10-29 定稿）：
 *   第 1 名 = 1000 满分；第 1% 名 ≈ 700~800（不要全挤在 1000）；之后衰减越快越好
 *
 * 公式（基于成绩比值，不用名次 → 跨项目公平）：
 *   cost  = 成绩（多盲解码为 cost，统一「越小越强」）
 *   WR_ev = 该项目世界最佳 cost
 *   P1_ev = 该项目第 1% 分位 cost
 *   D0_ev = 1 - WR/P1                       ← 每个项目各自标定（各项目分布差异达 9 倍）
 *   d     = 1 - WR/cost                     ← 该选手相对落后度，0 = 世界纪录
 *   d ≤ D0（前1%内）: score = 1000 × (1 - (1 - TARGET/1000) · d/D0)   1000 → TARGET，线性有梯度
 *   d > D0（长尾）  : score = TARGET × (D0/d)^TAIL_H                  断崖衰减
 *
 * 聚合（与 sixdim 同构，量级可与现有 s5 直接比较）：
 *   v_ev = score_single + score_avg（各 0~1000，和 0~2000）
 *   s5   = Σ_ev (v_ev / max_v_ev) × evW(ev) × FULL / wSum     FULL=1000, wSum=1.0
 *
 * 只读：WCA_export_ranks_*.tsv / persons.tsv / sixdim_site.tsv。不改任何业务表。
 * 运行：node --max-old-space-size=8192 etl/score/m5_calib_probe.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '../..');
const D = __dirname;
const OC = path.join(ROOT, '.workbuddy/tmp/oc');
const RN = require(path.join(D, 'runs.js'));
const EVW = RN.EV_WEIGHT_V2;
const FULL = 1000;

/* ── 旋钮 ── */
const TARGET = 750;      // 第1%名的分数（用户要 700~800）
const TAIL_H = 8;        // 长尾衰减指数
const PCT = 0.01;        // 标定分位（前1%）

/* ── multi 解码 → cost（越小越强）── */
function decodeMulti(v) {
  if (v < 1e9) {                       // new: 0DDTTTTTMM
    const s = String(v).padStart(9, '0');
    const diff = +s.slice(1, 3), sec = +s.slice(3, 8);
    return (99 - diff) * 1e5 + sec;
  }
  const s = String(v);                 // old: 1SSAATTTTT
  const solved = +s.slice(1, 3), att = +s.slice(3, 5), sec = +s.slice(5, 10);
  const diff = solved - (att - solved);
  return (99 - diff) * 1e5 + sec;
}
const toCost = (ev, best) => {
  const b = +best;
  if (!Number.isFinite(b) || b <= 0) return null;
  if (ev === '333mbf' || ev === '333mbo') return decodeMulti(b);
  return b;
};

function loadRanks(file) {
  const m = new Map();
  for (const ln of fs.readFileSync(path.join(OC, file), 'utf8').split('\n')) {
    if (!ln) continue;
    const c = ln.split('\t');
    if (c.length < 4 || c[2] === 'event_id') continue;
    const cost = toCost(c[2], c[0]);
    if (cost == null) continue;
    if (!m.has(c[1])) m.set(c[1], new Map());
    m.get(c[1]).set(c[2], cost);
  }
  return m;
}
console.log('# 读取 ranks …');
const RS = loadRanks('WCA_export_ranks_single.tsv');
const RA = loadRanks('WCA_export_ranks_average.tsv');
console.log(`  单次 ${RS.size} 人 / 平均 ${RA.size} 人`);

/* ── 每个 (ev,track)：WR + 第1%分位 → D0 ── */
function calibrate(rankMap) {
  const byEt = new Map();
  for (const [, em] of rankMap) for (const [ev, c] of em) {
    let a = byEt.get(ev); if (!a) { a = []; byEt.set(ev, a); }
    a.push(c);
  }
  const cal = new Map();
  for (const [ev, a] of byEt) {
    a.sort((x, y) => x - y);
    const wr = a[0];
    const p1 = a[Math.max(0, Math.floor(a.length * PCT))];
    cal.set(ev, { wr, p1, D0: p1 > 0 ? 1 - wr / p1 : 0, n: a.length });
  }
  return cal;
}
const CALS = calibrate(RS), CALA = calibrate(RA);

/* ── 形状函数 ── */
function shape(cost, cal) {
  if (!cal || !(cost > 0) || !(cal.wr > 0)) return 0;
  const d = 1 - cal.wr / cost;
  if (d <= 0) return 1000;
  if (cal.D0 <= 0) return 1000;
  if (d <= cal.D0) return 1000 * (1 - (1 - TARGET / 1000) * (d / cal.D0));
  return TARGET * Math.pow(cal.D0 / d, TAIL_H);
}

/* ── ① 三阶单次验证（第1名 / 第1%名）── */
console.log('\n=== ① 三阶单次标定验证 ===');
{
  const cal = CALS.get('333');
  console.log(`  三阶单次: ${cal.n.toLocaleString()} 人, WR=${(cal.wr / 100).toFixed(2)}s, 第1%分位=${(cal.p1 / 100).toFixed(2)}s, D0=${cal.D0.toFixed(4)}`);
  const arr = [];
  for (const [pid, em] of RS) { const c = em.get('333'); if (c != null) arr.push({ pid, c }); }
  arr.sort((a, b) => a.c - b.c);
  const N = arr.length;
  const picks = [[1, '第1名'], [4, '王艺衡(第4)'], [55, 'Feliks(第55)'], [1000, '第1000名'],
    [Math.floor(N * PCT), '★第1%名'], [Math.floor(N * 0.05), '前5%'],
    [Math.floor(N * 0.10), '前10%'], [Math.floor(N * 0.5), '中位数']];
  for (const [rk, label] of picks) {
    const it = arr[Math.max(0, rk - 1)];
    console.log(`  ${label.padEnd(14)} 名次${String(rk).padStart(7)}  成绩 ${(it.c / 100).toFixed(2).padStart(6)}s  → ${shape(it.c, cal).toFixed(1).padStart(7)}`);
  }
}

/* ── ② 全站 M5 ── */
console.log('\n# 计算全站 M5 …');
const pids = new Set([...RS.keys(), ...RA.keys()]);
const vEv = new Map();      // pid → Map(ev → v)
const maxEv = new Map();
for (const pid of pids) {
  const s = RS.get(pid), a = RA.get(pid);
  const evs = new Set([...(s ? s.keys() : []), ...(a ? a.keys() : [])]);
  const em = new Map();
  for (const ev of evs) {
    const cs = s && s.get(ev), ca = a && a.get(ev);
    const v = shape(cs, CALS.get(ev)) + shape(ca, CALA.get(ev));
    if (v <= 0) continue;
    em.set(ev, v);
    if (v > (maxEv.get(ev) || 0)) maxEv.set(ev, v);
  }
  if (em.size) vEv.set(pid, em);
}
const evW = (ev) => (EVW[ev] == null ? RN.WEIGHT_V2_CFG.floor : EVW[ev]);
const M5 = new Map();
for (const [pid, em] of vEv) {
  let acc = 0;
  for (const [ev, v] of em) {
    const mx = maxEv.get(ev) || 0;
    if (mx > 0) acc += (v / mx) * evW(ev) * FULL;
  }
  M5.set(pid, acc);
}
const arr = [...M5.values()].sort((x, y) => y - x);
const sum = arr.reduce((a, b) => a + b, 0);
let c1 = 0; const n1 = Math.floor(arr.length * 0.01);
for (let i = 0; i < n1; i++) c1 += arr[i];
console.log(`\n=== ② 全站分布 ===`);
console.log(`  人数 ${arr.length.toLocaleString()}   总量 ${sum.toFixed(1)}`);
console.log(`  中位数 ${arr[Math.floor(arr.length / 2)].toFixed(2)}   最高 ${arr[0].toFixed(1)}   最低 ${arr[arr.length - 1].toFixed(4)}`);
console.log(`  前1%占总量 ${(c1 / sum * 100).toFixed(1)}%`);

/* ── ③ 相关性（是否和 M6 重复）── */
const old = new Map();
for (const ln of fs.readFileSync(path.join(D, 'sixdim_site.tsv'), 'utf8').split('\n')) {
  if (!ln) continue;
  const c = ln.split('\t');
  if (c[0] === 'pid') continue;
  old.set(c[0], { s1: +c[1], s4: +c[4], s5: +c[5], s6: +c[6] });
}
function pearson(xs, ys) {
  const n = xs.length; if (n < 3) return NaN;
  let sx = 0, sy = 0; for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; }
  const mx = sx / n, my = sy / n; let a = 0, b = 0, c = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; a += dx * dy; b += dx * dx; c += dy * dy; }
  return (b && c) ? a / Math.sqrt(b * c) : NaN;
}
const common = [...M5.keys()].filter((p) => old.has(p));
console.log(`\n=== ③ 相关性（共同样本 ${common.length} 人）===`);
console.log('  维度      旧M5(名次制)×Dim   新M5(标定分段)×Dim');
for (const [dim, key] of [['M1', 's1'], ['M4', 's4'], ['M6', 's6']]) {
  const xo = [], xn = [], ys = [];
  for (const p of common) { const o = old.get(p); xo.push(o.s5); xn.push(M5.get(p)); ys.push(o[key]); }
  console.log(`  ×${dim.padEnd(3)}     ${pearson(xo, ys).toFixed(4)}            ${pearson(xn, ys).toFixed(4)}`);
}

/* ── ④ 关键选手 + Top20 ── */
const names = new Map();
for (const ln of fs.readFileSync(path.join(OC, 'WCA_export_persons.tsv'), 'utf8').split('\n')) {
  if (!ln) continue;
  const c = ln.split('\t');
  if (c.length > 2) names.set(c[2], c[0]);
}
console.log('\n=== ④ 关键选手：旧M5 vs 新M5 vs M6 ===');
for (const pid of ['2023GENG02', '2019WANY36', '2009ZEMD01', '2012PARK03', '2016KOLA02', '2019TARAT01', '2012CHAP02', '1982THAI01']) {
  const o = old.get(pid); if (!o) continue;
  console.log(`  ${(names.get(pid) || pid).padEnd(26).slice(0, 26)} 旧M5=${o.s5.toFixed(1).padStart(8)}  新M5=${(M5.get(pid) || 0).toFixed(1).padStart(8)}  M6=${o.s6.toFixed(1).padStart(8)}`);
}
console.log('\n=== ⑤ 新 M5 Top20 ===');
[...M5.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).forEach(([pid, v], i) => {
  const o = old.get(pid);
  console.log(`  ${String(i + 1).padStart(2)} ${(names.get(pid) || pid).padEnd(26).slice(0, 26)} 新M5=${v.toFixed(1).padStart(8)}  旧M5=${o ? o.s5.toFixed(1).padStart(8) : '     -  '}  M6=${o ? o.s6.toFixed(1).padStart(7) : '   -'}`);
});
console.log('\n# 探针结束（未写任何业务文件）');

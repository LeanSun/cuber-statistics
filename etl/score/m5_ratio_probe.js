/**
 * m5_ratio_probe.js · M5「成绩比值法」只读探针（不写任何业务表）
 *
 * 背景：用户 2026-10-29 提出改口径——放弃名次制，改用成绩比值：
 *      M5(项目) = (该项目世界最佳成绩 / 该选手成绩) × 1000
 *   例（三阶单次，WR=2.51）：
 *      耿暄一 2.51 → (2.51/2.51)×1000 = 1000
 *      王艺衡 2.77 → (2.51/2.77)×1000 = 906.13
 *      Feliks 4.12 → (2.51/4.12)×1000 = 609.22
 *
 * 本探针回答三件事：
 *   ① 用真实 WCA 数据复算上面三个数，验证公式
 *   ② 全站按新法算 M5，看分布（集中度 / 长尾）
 *   ③ 重点：新 M5 与 M6（突破幅度）的相关性 → 是否语义重复
 *      并与「旧 M5（名次制 rank^-0.5）」× M6 做对照
 *
 * 只读：WCA_export_ranks_*.tsv / WCA_export_persons.tsv / sixdim_site.tsv
 * 运行：node --max-old-space-size=8192 etl/score/m5_ratio_probe.js
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

/* ── multi 解码：统一成 cost，越小越强（与 M6-F2 同法）── */
function decodeMulti(raw) {
  const v = +raw;
  if (!Number.isFinite(v) || v <= 0) return null;
  if (v < 1e9) {                       // new: 0DDTTTTTMM
    const s = String(v).padStart(9, '0');
    const diff = +s.slice(1, 3);
    const sec = +s.slice(3, 8);
    return (99 - diff) * 1e5 + sec;
  } else {                             // old: 1SSAATTTTT
    const s = String(v);
    const solved = +s.slice(1, 3);
    const att = +s.slice(3, 5);
    const sec = +s.slice(5, 10);
    const diff = solved - (att - solved);
    return (99 - diff) * 1e5 + sec;
  }
}
/* 越小越强的 cost：计时/步数直接用，多盲解码 */
const toCost = (ev, best) => {
  const b = +best;
  if (!Number.isFinite(b) || b <= 0) return null;
  if (ev === '333mbf' || ev === '333mbo') return decodeMulti(b);
  return b;
};

/* ── 读 ranks ── */
function loadRanks(file) {
  const m = new Map();                 // pid → Map(ev → cost)
  const txt = fs.readFileSync(path.join(OC, file), 'utf8');
  for (const ln of txt.split('\n')) {
    if (!ln) continue;
    const c = ln.split('\t');
    if (c.length < 4) continue;
    const best = c[0], pid = c[1], ev = c[2];
    if (ev === 'event_id') continue;
    const cost = toCost(ev, best);
    if (cost == null) continue;
    if (!m.has(pid)) m.set(pid, new Map());
    m.get(pid).set(ev, cost);
  }
  return m;
}
console.log('# 读取 WCA ranks …');
const RS = loadRanks('WCA_export_ranks_single.tsv');
const RA = loadRanks('WCA_export_ranks_average.tsv');
console.log(`  单次 ${RS.size} 人 / 平均 ${RA.size} 人`);

/* ── 每个 (ev,track) 的世界最佳 cost ── */
const wrS = new Map(), wrA = new Map();
for (const [, em] of RS) for (const [ev, c] of em) {
  const cur = wrS.get(ev); if (cur == null || c < cur) wrS.set(ev, c);
}
for (const [, em] of RA) for (const [ev, c] of em) {
  const cur = wrA.get(ev); if (cur == null || c < cur) wrA.set(ev, c);
}

const ratio = (ev, cost, wr) => (wr != null && cost != null && cost > 0) ? wr / cost : 0;

/* ── ① 验证用户给的三个数（三阶单次）── */
console.log('\n=== ① 验证用户例子：三阶单次（WR=2.51）===');
{
  const wr333 = wrS.get('333');
  console.log(`  三阶单次世界最佳 cost = ${wr333}（${(wr333 / 100).toFixed(2)}s）`);
  const cases = [
    ['2023GENG02', '耿暄一', 2.51],
    ['2019WANY36', '王艺衡', 2.77],
    ['2009ZEMD01', 'Feliks', 4.12],
  ];
  for (const [pid, name, claimed] of cases) {
    const em = RS.get(pid);
    const cost = em && em.get('333');
    if (cost == null) { console.log(`  ${name}: 无三阶单次成绩`); continue; }
    const r = ratio('333', cost, wr333);
    console.log(`  ${name.padEnd(8)} 成绩 ${(cost / 100).toFixed(2)}s → M5 = ${(r * 1000).toFixed(2)}` +
      `   用户给的 ${(claimed).toFixed(2)}s 预期 ${(wr333 / (claimed * 100) * 1000).toFixed(2)}`);
  }
}

/* ── ② 全站新 M5（与 sixdim 同构：同一 ev 的 single+avg 比值累加，按 ev 榜首归一）── */
console.log('\n# 计算全站新 M5 …');
const pids = new Set([...RS.keys(), ...RA.keys()]);
const rawEv = new Map();               // pid → Map(ev → v)
const rawPair = new Map();             // pid → Map(ev → [rs, ra]) 供幂次扫描
const maxEv = new Map();               // ev → max v（榜首）
for (const pid of pids) {
  const em = new Map(), pm = new Map();
  const s = RS.get(pid), a = RA.get(pid);
  const evs = new Set([...(s ? s.keys() : []), ...(a ? a.keys() : [])]);
  for (const ev of evs) {
    const cs = s && s.get(ev), ca = a && a.get(ev);
    const rs = ratio(ev, cs, wrS.get(ev)), ra = ratio(ev, ca, wrA.get(ev));
    const v = rs + ra;
    if (v <= 0) continue;
    em.set(ev, v);
    pm.set(ev, [rs, ra]);
    if (v > (maxEv.get(ev) || 0)) maxEv.set(ev, v);
  }
  if (em.size) { rawEv.set(pid, em); rawPair.set(pid, pm); }
}
const evW = (ev) => (EVW[ev] == null ? RN.WEIGHT_V2_CFG.floor : EVW[ev]);
const newM5 = new Map();
for (const [pid, em] of rawEv) {
  let acc = 0;
  for (const [ev, v] of em) {
    const mx = maxEv.get(ev) || 0;
    if (mx > 0) acc += (v / mx) * evW(ev) * FULL;   // wSum=1.0（与 sixdim 一致）
  }
  newM5.set(pid, acc);
}

/* ── 分布 ── */
const arr = [...newM5.values()].sort((x, y) => y - x);
const sum = arr.reduce((a, b) => a + b, 0);
const med = arr[Math.floor(arr.length / 2)];
let acc5 = 0; const n5 = Math.floor(arr.length * 0.05);
for (let i = 0; i < n5; i++) acc5 += arr[i];
console.log(`\n=== ② 新 M5 全站分布（比值法）===`);
console.log(`  人数 ${arr.length}   总量 ${sum.toFixed(4)}`);
console.log(`  中位数 ${med.toFixed(4)}   前5%占总量 ${(acc5 / sum * 100).toFixed(1)}%`);
console.log(`  最高 ${arr[0].toFixed(2)}   最低 ${arr[arr.length - 1].toFixed(4)}`);

/* ── 读现有六维（旧 M5 / M6 / M1 / M4）── */
const old = new Map();                 // pid → {s1,s4,s5,s6,name}
for (const ln of fs.readFileSync(path.join(D, 'sixdim_site.tsv'), 'utf8').split('\n')) {
  if (!ln) continue;
  const c = ln.split('\t');
  if (c[0] === 'pid') continue;
  old.set(c[0], { s1: +c[1], s2: +c[2], s3: +c[3], s4: +c[4], s5: +c[5], s6: +c[6] });
}
const names = new Map();
for (const ln of fs.readFileSync(path.join(OC, 'WCA_export_persons.tsv'), 'utf8').split('\n')) {
  if (!ln) continue;
  const c = ln.split('\t');
  if (c.length > 2) names.set(c[2], c[0]);
}

/* ── ③ 相关性（核心：是否和 M6 重复）── */
function pearson(xs, ys) {
  const n = xs.length; if (n < 3) return NaN;
  let sx = 0, sy = 0; for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; }
  const mx = sx / n, my = sy / n;
  let a = 0, b = 0, c = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; a += dx * dy; b += dx * dx; c += dy * dy; }
  return (b && c) ? a / Math.sqrt(b * c) : NaN;
}
const pairs = { M1: 's1', M4: 's4', M6: 's6' };
const common = [...newM5.keys()].filter((p) => old.has(p));
console.log(`\n=== ③ 相关性（共同样本 ${common.length} 人）===`);
console.log('  维度      旧M5(名次制)×Dim   新M5(比值法)×Dim   变化');
for (const [dim, key] of Object.entries(pairs)) {
  const xsOld = [], xsNew = [], ys = [];
  for (const p of common) {
    const o = old.get(p);
    xsOld.push(o.s5); xsNew.push(newM5.get(p)); ys.push(o[key]);
  }
  const rOld = pearson(xsOld, ys), rNew = pearson(xsNew, ys);
  console.log(`  ×${dim.padEnd(3)}     ${rOld.toFixed(4)}            ${rNew.toFixed(4)}           ${rNew > rOld ? '↑' : '↓'} ${(rNew - rOld).toFixed(4)}`);
}
/* 新M5 与 旧M5 自身 */
{
  const a = [], b = [];
  for (const p of common) { a.push(newM5.get(p)); b.push(old.get(p).s5); }
  console.log(`  新M5 × 旧M5 自身 = ${pearson(a, b).toFixed(4)}`);
}

/* ── ④ 关键选手对照 ── */
console.log('\n=== ④ 关键选手：旧 M5 vs 新 M5 vs M6 ===');
const keys = ['2023GENG02', '2019WANY36', '2009ZEMD01', '2012PARK03', '2016KOLA02',
  '2019TARAT01', '2012CHAP02', '1982THAI01', '2011LIN02'];
console.log('  选手                    旧M5(名次)   新M5(比值)   M6(突破)');
for (const pid of keys) {
  const o = old.get(pid); if (!o) continue;
  const nm = names.get(pid) || pid;
  console.log(`  ${nm.padEnd(22).slice(0, 22)}  ${o.s5.toFixed(1).padStart(9)}   ${(newM5.get(pid) || 0).toFixed(1).padStart(9)}   ${o.s6.toFixed(1).padStart(8)}`);
}

/* ── ⑤ Top15（新法）── */
console.log('\n=== ⑤ 新 M5 Top15 ===');
const top = [...newM5.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
top.forEach(([pid, v], i) => {
  const nm = names.get(pid) || pid;
  const o = old.get(pid);
  console.log(`  ${String(i + 1).padStart(2)} ${nm.padEnd(26).slice(0, 26)} 新M5=${v.toFixed(1).padStart(8)}  旧M5=${o ? o.s5.toFixed(1).padStart(8) : '     -  '}  M6=${o ? o.s6.toFixed(1).padStart(7) : '   -'}`);
});
/* ── ⑥ 幂次硬化扫描：ratio^k（k=1 即用户原案）── */
console.log('\n=== ⑥ 幂次硬化扫描（区分度修复方案）===');
{
  const wr333c = wrS.get('333');
  const trio = [['2023GENG02', '耿暄一'], ['2019WANY36', '王艺衡'], ['2009ZEMD01', 'Feliks']];
  console.log('  k   三阶单次 耿/王/Felik    计分人数   中位数   前5%占比   最高     ×M6');
  for (const k of [1, 2, 3, 4]) {
    /* 三阶单次 trio */
    const t = trio.map(([pid]) => {
      const em = RS.get(pid); const c = em && em.get('333');
      const r = ratio('333', c, wr333c);
      return (Math.pow(r, k) * 1000).toFixed(0);
    }).join('/');
    /* 全站：每 ev 取 (rs^k + ra^k)，按 ev 榜首归一 */
    const maxK = new Map(), perK = new Map();
    for (const [pid, pm] of rawPair) {
      const em = new Map();
      for (const [ev, [rs, ra]] of pm) {
        const v = Math.pow(rs, k) + Math.pow(ra, k);
        if (v <= 0) continue;
        em.set(ev, v);
        if (v > (maxK.get(ev) || 0)) maxK.set(ev, v);
      }
      if (em.size) perK.set(pid, em);
    }
    const m5k = new Map();
    for (const [pid, em] of perK) {
      let acc = 0;
      for (const [ev, v] of em) { const mx = maxK.get(ev) || 0; if (mx > 0) acc += (v / mx) * evW(ev) * FULL; }
      m5k.set(pid, acc);
    }
    const a2 = [...m5k.values()].sort((x, y) => y - x);
    const sum2 = a2.reduce((x, y) => x + y, 0);
    const med2 = a2[Math.floor(a2.length / 2)];
    let c5 = 0; const n5b = Math.floor(a2.length * 0.05);
    for (let i = 0; i < n5b; i++) c5 += a2[i];
    /* ×M6 */
    const xs = [], ys = [];
    for (const p of common) { xs.push(m5k.get(p) || 0); ys.push(old.get(p).s6); }
    const r6 = pearson(xs, ys);
    console.log(`  ${k}   ${t.padEnd(18)}  ${String(a2.length).padStart(7)}   ${med2.toFixed(1).padStart(7)}   ${(c5 / sum2 * 100).toFixed(1).padStart(6)}%  ${a2[0].toFixed(0).padStart(6)}   ${r6.toFixed(4)}`);
  }
}
console.log('\n# 探针结束（未写任何业务文件）');

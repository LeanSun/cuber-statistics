#!/usr/bin/env node
/**
 * M5 衰减口径诊断（只读，不写任何产出表）
 *
 * 目的：量化「双新鲜度衰减是否过度惩罚老选手」，对比若干衰减方案。
 *
 * 数据源：etl/score/M5_by_event.tsv（已是 DEPTH<=100 的计分全集，3,346 条席位）
 *         该表含 world_rank / w_e / gapR_years / gapP_years / decay / score
 *         其中 score = w_e * rank^-1 * decay  ⇒  raw = score / decay（无损反推）
 *
 * 方案（结构一律保持「乘法」，不改 D3；只动窗口年数与地板，或软化指数）：
 *   F3   现状：gapR 5y/0.2  × gapP 5y/0.2          （封存定稿）
 *   A    gapP 窗口拉长 10y，地板 0.2
 *   B    gapP 窗口拉长 10y，地板 0.4
 *   C    仅抬地板 0.4（窗口仍 5y）
 *   D    几何软化 sqrt(dR·dP)（等效两层指数各 0.5）
 *   E    retire 模式（只乘 dR）—— D1 明令禁止，仅作上限对照
 *
 * 用法：node etl/score/m5_decay_diag.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const SRC = path.join(ROOT, 'etl/score/M5_by_event.tsv');

const dec = (gap, years, floor) => Math.max(floor, 1 - (gap / years) * (1 - floor));

const PLANS = [
  { id: 'F3', name: '现状 dual 5y/0.2 × 5y/0.2', yR: 5, fR: 0.2, yP: 5, fP: 0.2, mode: 'mul' },
  { id: 'A', name: 'gapP 窗口 10y（地板 0.2）', yR: 5, fR: 0.2, yP: 10, fP: 0.2, mode: 'mul' },
  { id: 'B', name: 'gapP 10y + 地板 0.4', yR: 5, fR: 0.2, yP: 10, fP: 0.4, mode: 'mul' },
  { id: 'C', name: '仅抬地板 0.4（窗口 5y）', yR: 5, fR: 0.2, yP: 5, fP: 0.4, mode: 'mul' },
  { id: 'D', name: '几何软化 sqrt(dR·dP)', yR: 5, fR: 0.2, yP: 5, fP: 0.2, mode: 'geo' },
  { id: 'E', name: 'retire 只乘 dR（上限对照）', yR: 5, fR: 0.2, yP: 5, fP: 0.2, mode: 'retire' },
  { id: 'F', name: '分段：活跃者 gapP 10y/0.4，离场者 5y/0.2', yR: 5, fR: 0.2, yP: 5, fP: 0.2, mode: 'seg' },
];

function comboDecay(pl, gR, gP) {
  const dR = dec(gR, pl.yR, pl.fR);
  if (pl.mode === 'seg') {
    // 仍活跃（该项目 1 年内有参赛）→ PB 层宽容：10 年窗口 + 地板 0.4
    // 已离场（该项目 >1 年未参赛）→ PB 层维持 5 年 / 0.2
    const active = gR <= 1;
    const dP = active ? dec(gP, 10, 0.4) : dec(gP, 5, 0.2);
    return dR * dP;
  }
  const dP = dec(gP, pl.yP, pl.fP);
  if (pl.mode === 'retire') return dR;
  if (pl.mode === 'geo') return Math.sqrt(dR * dP);
  return dR * dP;
}

/* ── 读入席位 ─────────────────────────────────────────────────────── */
const lines = fs.readFileSync(SRC, 'utf8').trim().split('\n');
const head = lines[0].split('\t');
const I = {};
head.forEach((h, i) => { I[h] = i; });

const seats = [];
for (let i = 1; i < lines.length; i++) {
  const c = lines[i].split('\t');
  const score = +c[I.score];
  const decay = +c[I.decay];
  if (!(score > 0) || !(decay > 0)) continue;
  seats.push({
    pid: c[I.pid],
    name: c[I.name],
    ev: c[I.event],
    track: c[I.track],
    rank: +c[I.world_rank],
    w: +c[I.w_e],
    gR: +c[I.gapR_years],
    gP: +c[I.gapP_years],
    raw: score / decay,          // 无衰减原始分 = w_e · rank^-1
    oldScore: score,
    decayOld: decay,
  });
}
console.error('席位数 ' + seats.length);

/* ── 逐方案重算 ───────────────────────────────────────────────────── */
function run(pl) {
  // 1) 每席位新分
  const cell = new Map();   // pid|ev -> 合计
  const evW = new Map();
  const perPid = new Map();
  let totalRaw = 0;
  let p1Contrib = 0;
  let p1Items = 0;
  for (const s of seats) {
    const nd = comboDecay(pl, s.gR, s.gP);
    const sc = s.raw * nd;
    totalRaw += sc;
    // P1 病灶：仍在参赛（gapR<=1）但 PB 已 >=2 年未刷新
    if (s.gR <= 1 && s.gP >= 2) { p1Contrib += sc; p1Items++; }
    const k = s.pid + '\u0001' + s.ev;
    cell.set(k, (cell.get(k) || 0) + sc);
    evW.set(s.ev, s.w);
    if (!perPid.has(s.pid)) perPid.set(s.pid, { name: s.name, raw: 0, s5: 0, n: 0 });
    const p = perPid.get(s.pid);
    p.raw += sc; p.n++;
  }
  // 2) 每格榜首
  const maxEv = new Map();
  for (const [k, v] of cell) {
    const ev = k.split('\u0001')[1];
    if (v > (maxEv.get(ev) || 0)) maxEv.set(ev, v);
  }
  // 3) 归一化 s5 = Σ_ev (v_ev/max_ev) × w_e × 1000
  for (const [k, v] of cell) {
    const [pid, ev] = k.split('\u0001');
    const mx = maxEv.get(ev) || 0;
    if (!(mx > 0)) continue;
    const p = perPid.get(pid);
    p.s5 += (v / mx) * (evW.get(ev) || 0) * 1000;
  }
  const rank = [...perPid.entries()]
    .map(([pid, v]) => ({ pid, name: v.name, raw: v.raw, s5: v.s5, n: v.n, oldScore: 0 }))
    .sort((a, b) => b.s5 - a.s5);
  rank.forEach((x, i) => { x.pos = i + 1; });
  return {
    pl, totalRaw, rank,
    people: rank.length,
    p1Contrib, p1Items,
    p1Share: totalRaw > 0 ? p1Contrib / totalRaw : 0,
  };
}

const results = PLANS.map(run);
const base = results[0];
const basePos = new Map(base.rank.map((x) => [x.pid, x.pos]));
const baseS5 = new Map(base.rank.map((x) => [x.pid, x.s5]));

/* ── 输出 ─────────────────────────────────────────────────────────── */
const F = (v, d = 4) => Number(v).toFixed(d);
const pct = (v) => (v * 100).toFixed(2) + '%';

console.log('\n================ 1. 全站口径对比 ================');
console.log('方案  说明                                总量raw   人数   P1条目  P1贡献%  ');
for (const r of results) {
  console.log(
    '  ' + r.pl.id.padEnd(4) + r.pl.name.padEnd(36) +
    F(r.totalRaw, 2).padStart(9) + String(r.people).padStart(6) +
    String(r.p1Items).padStart(8) + pct(r.p1Share).padStart(9)
  );
}

// 复现校验：现状方案总量应接近封存基线 76.8139
console.log('\n[校验] 封存基线全站总量 76.8139（F3），本次重算 ' + F(base.totalRaw, 4) +
  '，偏差 ' + pct(Math.abs(base.totalRaw - 76.8139) / 76.8139));

const WATCH = [
  ['2009ZEMD01', 'Feliks Zemdegs'],
  ['2023GENG02', '耿暄一'],
  ['2019TARA09', 'Timofei Tarasenko'],
  ['2016KOLA02', 'Tymon Kolasiński'],
  ['2012PARK03', 'Max Park'],
  ['2019WANY36', '王艺衡'],
];

console.log('\n================ 2. 关键选手 s5 对比 ================');
console.log('选手                  ' + results.map((r) => r.pl.id.padStart(10)).join(''));
for (const [pid, nm] of WATCH) {
  const cells = results.map((r) => {
    const x = r.rank.find((y) => y.pid === pid);
    return (x ? F(x.s5, 2) : '-').padStart(10);
  });
  console.log(nm.padEnd(22) + cells.join(''));
}
console.log('\n（s5 为千分制维度分；站点总分贡献 = 0.08 × s5）');
console.log('选手                  ' + results.map((r) => r.pl.id.padStart(10)).join('') + '   ← 总分贡献 0.08×s5');
for (const [pid, nm] of WATCH) {
  const cells = results.map((r) => {
    const x = r.rank.find((y) => y.pid === pid);
    return (x ? F(0.08 * x.s5, 2) : '-').padStart(10);
  });
  console.log(nm.padEnd(22) + cells.join(''));
}

console.log('\n================ 3. Feliks 的衰减究竟罚掉多少 ================');
const fel = seats.filter((s) => s.pid === '2009ZEMD01');
const felRawNoDecay = fel.reduce((z, s) => z + s.raw, 0);
const felNow = fel.reduce((z, s) => z + s.oldScore, 0);
console.log('  Feliks 席位数            ' + fel.length);
console.log('  名次项 Σ w_e·1/r（无衰减）' + F(felRawNoDecay));
console.log('  双衰减后的 M5 raw        ' + F(felNow));
console.log('  衰减整体吃掉             ' + pct(1 - felNow / felRawNoDecay));
console.log('  其中踩地板(<0.25)的席位   ' + fel.filter((s) => s.decayOld < 0.25).length + ' / ' + fel.length);
console.log('  他的 gapP 区间           ' + F(Math.min(...fel.map((s) => s.gP)), 1) + ' ~ ' + F(Math.max(...fel.map((s) => s.gP)), 1) + ' 年');

const gen = seats.filter((s) => s.pid === '2023GENG02');
const genRawNoDecay = gen.reduce((z, s) => z + s.raw, 0);
console.log('\n  （对照）耿暄一席位数 ' + gen.length + '，名次项 Σ w/r = ' + F(genRawNoDecay) +
  '，衰减后 ' + F(gen.reduce((z, s) => z + s.oldScore, 0)) + ' → 衰减仅吃掉 ' +
  pct(1 - gen.reduce((z, s) => z + s.oldScore, 0) / genRawNoDecay));

console.log('\n================ 4. Top10 稳定性（各方案相对 F3 的名次漂移）===============');
console.log('方案   Top10 与 F3 重合   Top25 重合   与 F3 s5 的 Spearman');
for (const r of results) {
  const t10 = r.rank.slice(0, 10).filter((x) => basePos.get(x.pid) <= 10).length;
  const t25 = r.rank.slice(0, 25).filter((x) => basePos.get(x.pid) <= 25).length;
  // 名次向量相关（共同 pid）
  const common = r.rank.map((x) => x.pid).filter((p) => basePos.has(p));
  const pr = new Map(r.rank.map((x, i) => [x.pid, i + 1]));
  const n = common.length;
  const ar = common.map((p) => pr.get(p));
  const br = common.map((p) => basePos.get(p));
  const ma = ar.reduce((a, b) => a + b, 0) / n;
  const mb = br.reduce((a, b) => a + b, 0) / n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) { const x = ar[i] - ma, y = br[i] - mb; sab += x * y; saa += x * x; sbb += y * y; }
  const rho = sab / Math.sqrt(saa * sbb);
  console.log('  ' + r.pl.id.padEnd(4) + String(t10 + '/10').padStart(16) + String(t25 + '/25').padStart(13) + F(rho, 4).padStart(18));
}

console.log('\n================ 5. 各方案 Top8 ================');
for (const r of results) {
  console.log('\n  【' + r.pl.id + '】' + r.pl.name);
  for (let i = 0; i < 8; i++) {
    const x = r.rank[i];
    const d = baseS5.get(x.pid);
    const delta = d > 0 ? (x.s5 / d - 1) * 100 : 0;
    console.log('    ' + String(i + 1).padStart(2) + '. ' + (x.name || x.pid).padEnd(24) +
      F(x.s5, 2).padStart(9) + '  (vs F3 ' + (delta >= 0 ? '+' : '') + delta.toFixed(1) + '%)');
  }
}

/* ── 6. 老将分组统计：按 gapP 分层看衰减倍率 ───────────────────────── */
console.log('\n================ 6. 按「PB 陈旧度」分层的平均衰减倍率 ================');
console.log('  gapP 区间     席位   F3衰减  A衰减   B衰减   C衰减   D衰减   E衰减');
const BUCKETS = [[0, 1], [1, 2], [2, 3], [3, 5], [5, 8], [8, 12], [12, 99]];
for (const [lo, hi] of BUCKETS) {
  const g = seats.filter((s) => s.gP >= lo && s.gP < hi);
  if (!g.length) continue;
  const avg = (pl) => g.reduce((z, s) => z + comboDecay(pl, s.gR, s.gP), 0) / g.length;
  console.log('  ' + (lo + '~' + hi + ' 年').padEnd(13) + String(g.length).padStart(5) +
    PLANS.map((pl) => F(avg(pl), 3).padStart(7)).join(''));
}

/* ── 7. 关注选手的 M5 维度名次变化 ─────────────────────────────────── */
console.log('\n================ 7. 关注选手的 M5 维度名次 ================');
console.log('选手                  ' + results.map((r) => r.pl.id.padStart(9)).join(''));
for (const [pid, nm] of WATCH) {
  const cells = results.map((r) => {
    const x = r.rank.find((y) => y.pid === pid);
    return (x ? '#' + x.pos : '-').padStart(9);
  });
  console.log(nm.padEnd(22) + cells.join(''));
}


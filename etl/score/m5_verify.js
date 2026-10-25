/**
 * M5 最终验证 · 官方 ranks 与重建 PB 的一致性 + 完整正交性
 * 只读，不改任何主脚本
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const ZIP = fs.readdirSync(path.join(ROOT, 'data/raw')).filter((f) => f.endsWith('.zip'))[0];
const ZIP_PATH = path.join(ROOT, 'data/raw', ZIP);
const SNAPSHOT = '2026-10-15';

function streamTsv(name, onRow) {
  return new Promise((resolve, reject) => {
    const ps = spawn('unzip', ['-p', ZIP_PATH, name]);
    let buf = ''; let head = true;
    ps.on('error', reject);
    ps.stdout.on('data', (d) => {
      buf += d.toString('utf8');
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const ln = buf.slice(0, i); buf = buf.slice(i + 1);
        if (head) { head = false; continue; }
        if (ln) onRow(ln.split('\t'));
      }
    });
    ps.on('close', () => resolve());
  });
}
const dayOf = (s) => Math.floor(Date.parse(s + 'T00:00:00Z') / 86400000);
const SNAP_DAY = dayOf(SNAPSHOT);
const F4 = (v) => Number(v).toFixed(4);

(async () => {
  const RN = require('./runs.js');
  const W = RN.EV_WEIGHT_V2, RETIRED = RN.EV_RETIRED_DAY;

  /* ── 1. 官方 ranks 的 best 值 vs 从 results.tsv 重建的 PB ── */
  console.log('═══════ 1. 官方 ranks.best 与重建 PB 的一致性 ═══════');
  const officialBest = new Map();   // pid|ev|tr → best
  const officialRank = new Map();   // pid|ev|tr → wr
  for (const [tr, file] of [['single', 'WCA_export_ranks_single.tsv'], ['average', 'WCA_export_ranks_average.tsv']]) {
    await streamTsv(file, (r) => {
      if (!r[0]) return;
      officialBest.set(r[1] + '|' + r[2] + '|' + tr, +r[0]);
      officialRank.set(r[1] + '|' + r[2] + '|' + tr, +r[3]);
    });
  }
  const compDay = new Map();
  await streamTsv('WCA_export_competitions.tsv', (r) => {
    if (!r[0] || r[10] === '1') return;
    const y = +r[17] || +r[14]; if (!y) return;
    const m = +r[18] || +r[15] || 1, d = +r[19] || +r[16] || 1;
    compDay.set(r[0], dayOf(y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0')));
  });
  const evFmt = new Map();
  await streamTsv('WCA_export_events.tsv', (r) => { if (r[0]) evFmt.set(r[0], r[1]); });
  function decodeMulti(v) {
    if (v < 1e9) {
      const s = String(v).padStart(9, '0');
      const dd = +s.slice(0, 2), tt = +s.slice(2, 7), mm = +s.slice(7, 9);
      return (99 - dd) * 1e5 + Math.min(tt, 99999);
    }
    const s = String(v);
    const ss = +s.slice(1, 3), aa = +s.slice(3, 5), tt = +s.slice(5, 10);
    return (99 - (99 - ss - aa)) * 1e5 + Math.min(tt, 99999);
  }
  const pb = new Map();   // pid|ev|tr → best
  await streamTsv('WCA_export_results.tsv', (r) => {
    const pid = r[8], ev = r[6];
    if (!pid || !ev) return;
    const fmt = evFmt.get(ev) || 'time';
    const vs = +r[2], va = +r[3];
    if (vs > 0) {
      const val = fmt === 'multi' ? decodeMulti(vs) : vs;
      const k = pid + '|' + ev + '|single';
      if (pb.get(k) == null || val < pb.get(k)) pb.set(k, val);
    }
    if (va > 0) {
      const val = fmt === 'multi' ? decodeMulti(va) : va;
      const k = pid + '|' + ev + '|average';
      if (pb.get(k) == null || val < pb.get(k)) pb.set(k, val);
    }
  });
  let checked = 0, mismatch = 0, onlyOff = 0, onlyPb = 0, multiSkip = 0;
  const mmSamples = [];
  for (const [k, v] of officialBest) {
    const p = pb.get(k);
    if (p == null) { onlyOff++; continue; }
    /* multi 项目：官方 best 存的是**编码值**，我们重建的是**解码后成本**，
       两者本就不可直接比 —— 跳过（M4 也有同样的已知口径差）。 */
    const p1 = k.indexOf('|'), p2 = k.indexOf('|', p1 + 1);
    if (evFmt.get(k.slice(p1 + 1, p2)) === 'multi') { multiSkip++; continue; }
    checked++;
    if (p !== v) { mismatch++; if (mmSamples.length < 10) mmSamples.push(`${k}: official=${v} rebuilt=${p}`); }
  }
  for (const k of pb.keys()) if (!officialBest.has(k)) onlyPb++;
  console.log(`  可比组合（非 multi）: ${checked}；best 值不一致: ${mismatch} 个`);
  console.log(`  multi 组合（口径不同，跳过比对）: ${multiSkip}；仅官方有: ${onlyOff}；仅重建有: ${onlyPb}`);
  if (mmSamples.length) { console.log('  不一致样本:'); mmSamples.forEach((s) => console.log('    ', s)); }

  /* ── 2. 用重建 PB 重排，与官方 world_rank 的名次差 ── */
  console.log('\n═══════ 2. 用重建 PB 重排 vs 官方 world_rank（抽查各组合 Top50）═══════');
  console.log('ev|track\t官方Top50人数\t重建Top50人数\t名次完全一致数\t最大名次差');
  const perCombo = new Map();
  for (const [k, v] of officialBest) {
    /* key = pid|ev|tr；pid 本身不含 '|'
       ⚠️ 注意：String.lastIndexOf(sub, from) 的 from 是**闭区间**，
       用 lastIndexOf('|', i) 会在 i 位置命中自身 → 切错 pid。
       统一用 indexOf 顺序切分。 */
    const p1 = k.indexOf('|');
    const p2 = k.indexOf('|', p1 + 1);
    const pid = k.slice(0, p1), ev = k.slice(p1 + 1, p2), tr = k.slice(p2 + 1);
    const combo = ev + '|' + tr;
    if (!perCombo.has(combo)) perCombo.set(combo, []);
    perCombo.get(combo).push({ pid, ev, tr, best: v, off: officialRank.get(k) });
  }
  let totSame = 0, totN = 0;
  for (const [combo, arr] of [...perCombo.entries()].sort()) {
    if (combo === '333mbf|average' || combo === '333mbo|average' || combo === 'fto|single' || combo === 'fto|average') continue;
    const sorted = [...arr].sort((a, b) => a.best - b.best || a.pid.localeCompare(b.pid));
    const offTop = arr.filter((x) => x.off <= 50);
    const rebTop = sorted.slice(0, offTop.length);
    /* 名次完全一致的：按 best 升序，同 best 按 pid —— 但官方对同 best 用同名次 */
    let same = 0, maxDiff = 0;
    for (let i = 0; i < offTop.length; i++) {
      const o = offTop.find((x) => x.pid === rebTop[i].pid);
      if (o) { const d = Math.abs(o.off - (i + 1)); if (d === 0) same++; if (d > maxDiff) maxDiff = d; }
    }
    totSame += same; totN += offTop.length;
    console.log(`${combo}\t${offTop.length}\t${rebTop.length}\t${same}\t${maxDiff}`);
  }
  console.log(`合计：官方 Top50 名次与重建序位完全一致 ${totSame}/${totN}`);

  /* ── 3. M5 主口径 + 完整正交性 ── */
  console.log('\n═══════ 3. M5 主口径（深度100 / r^-1 / 衰减A / 排除停办 / 双轨）═══════');
  const nameOf = new Map();
  await streamTsv('WCA_export_persons.tsv', (r) => { if (r[2]) nameOf.set(r[2], r[0]); });
  const lastByEv = new Map();
  await streamTsv('WCA_export_results.tsv', (r) => {
    if (!r[8]) return;
    const day = compDay.get(r[4]); if (day === undefined) return;
    const k = r[8] + '|' + r[6];
    if (lastByEv.get(k) == null || day > lastByEv.get(k)) lastByEv.set(k, day);
  });
  const decayA = (g) => Math.max(0.2, 1 - (g / 5) * 0.8);
  const sc = new Map();
  const detail = new Map();
  for (const [k, off] of officialRank) {
    const p1 = k.indexOf('|'), p2 = k.indexOf('|', p1 + 1);
    const pid = k.slice(0, p1), ev = k.slice(p1 + 1, p2), tr = k.slice(p2 + 1);
    if (off > 100) continue;
    if (RETIRED[ev] != null) continue;
    const lc = lastByEv.get(pid + '|' + ev);
    const gap = lc == null ? 99 : (SNAP_DAY - lc) / 365.25;
    const w = W[ev] == null ? RN.WEIGHT_V2_CFG.floor : W[ev];
    const v = w * Math.pow(off, -1) * decayA(gap);
    if (v <= 0) continue;
    sc.set(pid, (sc.get(pid) || 0) + v);
    if (!detail.has(pid)) detail.set(pid, []);
    detail.get(pid).push({ ev, tr, off, w, gap, v });
  }
  const arr = [...sc.entries()].map(([pid, s]) => ({ pid, s, name: nameOf.get(pid) || pid })).sort((a, b) => b.s - a.s);
  console.log(`人数 ${arr.length}，总量 ${F4(arr.reduce((a, b) => a + b.s, 0))}`);
  console.log('\nTop25:');
  arr.slice(0, 25).forEach((x, i) => console.log(`  #${i + 1} ${x.name.padEnd(26)} ${F4(x.s)}`));

  /* 正交性 */
  function loadTsv(p, nameCol, valCol) {
    const m = new Map();
    if (!fs.existsSync(p)) return m;
    for (const ln of fs.readFileSync(p, 'utf8').trim().split('\n').slice(1)) {
      const c = ln.split('\t'); m.set(c[nameCol], +c[valCol]);
    }
    return m;
  }
  const m4 = loadTsv(path.join(__dirname, 'M4_seats.tsv'), 1, 2);
  const m2 = loadTsv(path.join(__dirname, 'M2_ranking.tsv'), 2, 3);
  const m6p = path.join(__dirname, 'M6_strength.tsv');
  const m6 = loadTsv(m6p, 1, 2);
  console.log('\nM6 文件存在:', fs.existsSync(m6p), ' M6 人数:', m6.size);
  function rho(arr, src, limit) {
    const top = [...arr].slice(0, limit);
    const idx = top.map((x, i) => [x, i]); idx.sort((a, b) => b[0].s - a[0].s);
    const ra = new Map(); for (let i = 0; i < idx.length; i++) ra.set(idx[i][0].name, i + 1);
    const srcArr = [...src.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
    const rb = new Map(); for (let i = 0; i < srcArr.length; i++) rb.set(srcArr[i][0], i + 1);
    const names = top.map((x) => x.name).filter((n) => rb.has(n));
    if (names.length < 3) return null;
    const xs = names.map((n) => ra.get(n)), ys = names.map((n) => rb.get(n));
    const n = xs.length, mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
    let num = 0, dx = 0, dy = 0;
    for (let i = 0; i < n; i++) { const a = xs[i] - mx, b = ys[i] - my; num += a * b; dx += a * a; dy += b * b; }
    return { n, rho: num / Math.sqrt(dx * dy) };
  }
  console.log('\n正交性（Spearman，Top100 内）：');
  for (const [lbl, src] of [['M4 统治力', m4], ['M2 领奖台', m2], ['M6 对手强度', m6]]) {
    const r = rho(arr, src, 100);
    console.log(`  M5 × ${lbl}: ${r ? `n=${r.n} ρ=${r.rho.toFixed(4)}` : '样本不足'}`);
  }
  const m1md = fs.readFileSync(path.join(__dirname, '纪录分_全站.md'), 'utf8');
  const m1 = new Map();
  for (const ln of m1md.split('\n')) {
    const c = ln.split('|').map((s) => s.trim());
    if (c.length < 12 || !/^\d+$/.test(c[2])) continue;
    const v = parseFloat(c[10].replace(/\*/g, ''));
    if (isFinite(v)) m1.set(c[3], v);
  }
  const r1 = rho(arr, m1, 100);
  console.log(`  M5 × M1 纪录分: ${r1 ? `n=${r1.n} ρ=${r1.rho.toFixed(4)}` : '样本不足'}`);

  /* M5 vs M4 Top10 重合 */
  const m4Top = [...m4.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map((x) => x[0]);
  const m5Top = arr.slice(0, 10).map((x) => x.name);
  console.log(`\nM5 Top10 与 M4 Top10 重合: ${m5Top.filter((x) => m4Top.includes(x)).length}/10`);
  console.log('M5 Top10:', m5Top.join(' | '));
  console.log('M4 Top10:', m4Top.join(' | '));

  /* M5 单项目榜首 */
  console.log('\n═══════ 4. M5 单项目（只看单次轨道）榜首 ═══════');
  const byEv = new Map();
  for (const [pid, list] of detail) {
    for (const d of list) {
      if (d.tr !== 'single') continue;
      if (!byEv.has(d.ev)) byEv.set(d.ev, []);
      byEv.get(d.ev).push({ pid, name: nameOf.get(pid) || pid, ...d });
    }
  }
  const evName = new Map();
  await streamTsv('WCA_export_events.tsv', (r) => { if (r[0]) evName.set(r[0], r[2] || r[0]); });
  for (const [ev, list] of [...byEv.entries()].sort()) {
    const top = [...list].sort((a, b) => a.off - b.off)[0];
    console.log(`  ${ev.padEnd(8)} ${(evName.get(ev) || '').padEnd(28)} #${String(top.off).padEnd(5)} ${top.name}`);
  }
})();

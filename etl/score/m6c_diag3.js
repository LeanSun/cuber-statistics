'use strict';
/* ═══════════════════════════════════════════════════════════════════════
 * M6-c 诊断 3 · 聚合变体裁决
 *   diag2 实证：Σ窗口占席 与 活跃窗口数 ρ=0.9996、与 M1 ρ=0.88 → sum 失败。
 *   本脚本改测「巅峰统治」聚合：
 *     max    : 巅峰窗口的跨项目占席总数  max_W Σ_(e,t) occ
 *     top3   : 巅峰 3 窗口平均
 *     sq     : Σ_W (Σ_(e,t) occ)²        （保留多窗口，但重仓霸榜年）
 *     peakET : 单(项目,轨道,窗口)占席峰值
 *     top3sq : 巅峰 3 窗口的 Σocc² 平均
 *   以及 quarter 窗口版 max/top3（窗更细 → 巅峰更尖锐）
 * 用法：node --max-old-space-size=8192 etl/score/m6c_diag3.js
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const RN = require('./runs.js');

const ROOT = path.resolve(__dirname, '../..');
const ZIP = fs.readdirSync(path.join(ROOT, 'data/raw')).filter((f) => f.endsWith('.zip'))[0];
const ZIP_PATH = path.join(ROOT, 'data/raw', ZIP);
const F = (v, d) => Number(v).toFixed(d === undefined ? 4 : d);
const num = (v) => Number(v).toLocaleString('en-US');
const log = (...a) => console.log(...a);

function decodeMulti(v) {
  if (v < 1e9) {
    const S = String(v).padStart(10, '0');
    const DD = +S.slice(1, 3); const TT = Math.min(+S.slice(3, 8), 99999);
    return { cost: (99 - (99 - DD)) * 1e5 + TT };
  }
  const S = String(v);
  const SS = +S.slice(1, 3); const AA = +S.slice(3, 5); const TT = Math.min(+S.slice(5, 10), 99999);
  const solved = 99 - SS;
  return { cost: (99 - (solved - (AA - solved))) * 1e5 + TT };
}
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

const RETIRED = RN.EV_RETIRED_DAY;
const TOP = 100;

async function main() {
  const t0 = Date.now();
  const pidIdx = new Map(); const idxName = [];
  const idxOf = (p) => {
    let i = pidIdx.get(p);
    if (i === undefined) { i = idxName.length; pidIdx.set(p, i); idxName.push(p); }
    return i;
  };
  const evInfo = new Map();
  await streamTsv('WCA_export_events.tsv', (r) => { if (r[0]) evInfo.set(r[0], { format: r[1] }); });
  const fmtOf = (ev) => (evInfo.get(ev) || {}).format || 'time';
  const compDay = new Map(); const compIdx = new Map();
  await streamTsv('WCA_export_competitions.tsv', (r) => {
    if (!r[0] || r[10] === '1') return;
    const y = +r[17] || +r[14]; if (!y) return;
    const m = +r[18] || +r[15] || 1, d = +r[19] || +r[16] || 1;
    compDay.set(r[0], RN.dayOf(y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0')));
    compIdx.set(r[0], compIdx.size);
  });

  const buckets = new Map();
  const bucketOf = (k) => {
    let b = buckets.get(k);
    if (!b) { b = { days: [], pids: [], comps: [], vals: [] }; buckets.set(k, b); }
    return b;
  };
  await streamTsv('WCA_export_results.tsv', (r) => {
    const ev = r[6], pid = r[8], compId = r[4];
    if (!ev || !pid) return;
    const day = compDay.get(compId);
    if (day === undefined) return;
    const rd = RETIRED[ev];
    if (rd != null && day >= rd) return;
    const p = idxOf(pid), c = compIdx.get(compId);
    const fmt = fmtOf(ev);
    const vs = +r[2], va = +r[3];
    if (vs > 0) { const b = bucketOf(ev + '|single'); b.days.push(day); b.pids.push(p); b.comps.push(c); b.vals.push(fmt === 'multi' ? decodeMulti(vs).cost : vs); }
    if (va > 0) { const b = bucketOf(ev + '|average'); b.days.push(day); b.pids.push(p); b.comps.push(c); b.vals.push(fmt === 'multi' ? decodeMulti(va).cost : va); }
  });
  log('[1/3] 成绩收集', ((Date.now() - t0) / 1000).toFixed(1) + 's');

  /* 窗口桶 */
  const winRows = new Map();
  for (const [k, b] of buckets) {
    for (let i = 0; i < b.days.length; i++) {
      const day = b.days[i];
      const y = RN.yearOfDay(day) | 0;
      /* 季窗口 */
      let q = 0;
      if (day >= RN.dayOf(y + '-10-01')) q = 3; else if (day >= RN.dayOf(y + '-07-01')) q = 2; else if (day >= RN.dayOf(y + '-04-01')) q = 1;
      const push = (key) => {
        let w = winRows.get(key);
        if (!w) { w = []; winRows.set(key, w); }
        w.push(b.pids[i] * 1048576 + b.comps[i], b.vals[i]);
      };
      push(k + '|Y|' + y);
      push(k + '|Q|' + (y * 4 + q));
    }
  }
  log('[2/3] 窗口分组', winRows.size, ((Date.now() - t0) / 1000).toFixed(1) + 's');

  /* ── 席位统计 → 每窗口每人的 Σ_(e,t) occ 与逐 (e,t) occ ──
     结构：accY / accQ : pidIdx → Map(winId → {tot, sq}) */
  const mkAcc = () => new Map();
  const accY = mkAcc(), accQ = mkAcc();
  let done = 0;
  for (const [key, flat] of winRows) {
    const parts = key.split('|');
    const acc = parts[2] === 'Y' ? accY : accQ;
    const win = parts[3];
    const n = flat.length / 2;
    /* 同人同场取最好 */
    const dedup = new Map();
    for (let i = 0; i < n; i++) {
      const k2 = flat[i * 2], v = flat[i * 2 + 1];
      const old = dedup.get(k2);
      if (old === undefined || v < old) dedup.set(k2, v);
    }
    const arr = [...dedup.entries()];
    arr.sort((a, b) => a[1] - b[1]);
    const take = Math.min(TOP, arr.length);
    const occ = new Map();
    for (let i = 0; i < take; i++) {
      const pid = Math.floor(arr[i][0] / 1048576);
      occ.set(pid, (occ.get(pid) || 0) + 1);
    }
    for (const [pid, c] of occ) {
      let m = acc.get(pid);
      if (!m) { m = new Map(); acc.set(pid, m); }
      const e = m.get(win);
      if (e) { e.tot += c; e.sq += c * c; }
      else m.set(win, { tot: c, sq: c * c });
    }
    if (++done % 3000 === 0) log('    …', num(done), '/', num(winRows.size), ((Date.now() - t0) / 1000).toFixed(1) + 's');
  }
  log('[3/3] 席位统计完成', ((Date.now() - t0) / 1000).toFixed(1) + 's');

  /* ── 聚合变体 ── */
  function aggFrom(accMap) {
    const max = new Float64Array(idxName.length), top3 = new Float64Array(idxName.length),
      sq = new Float64Array(idxName.length), peakET = new Float64Array(idxName.length),
      top3sq = new Float64Array(idxName.length);
    for (let p = 0; p < idxName.length; p++) {
      const m = accMap.get(p);
      if (!m) continue;
      const tots = [], sqs = [];
      let sqSum = 0;
      for (const { tot, sq: s } of m.values()) { tots.push(tot); sqs.push(s); sqSum += s; }
      tots.sort((a, b) => b - a); sqs.sort((a, b) => b - a);
      max[p] = tots[0] || 0;
      top3[p] = tots.slice(0, 3).reduce((a, b) => a + b, 0) / Math.min(3, tots.length);
      sq[p] = sqSum;
      peakET[p] = sqs[0] || 0;
      top3sq[p] = sqs.slice(0, 3).reduce((a, b) => a + b, 0) / Math.min(3, sqs.length);
    }
    return { max, top3, sq, peakET, top3sq };
  }
  const AG = { year: aggFrom(accY), quarter: aggFrom(accQ) };

  /* ── 正交性 ── */
  function loadTsv(file, pc, vc) {
    const L = fs.readFileSync(path.join(__dirname, file), 'utf8').trim().split('\n');
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
  const DIMS = { M1: loadTsv('M1_full.tsv', 0, 2), M2: loadTsv('M2_ranking.tsv', 1, 3), M4: loadTsv('M4_seats.tsv', 0, 2), M5: loadTsv('M5_seats.tsv', 0, 2) };

  const nameOf = (i) => idxName[i];
  const ANCH = ['2009ZEMD01', '2012PARK03', '2016KOLA02', '2019WANY36', '2016CHAP04', '2005AKKE01'];

  console.log('\n=== 聚合变体 × 正交性 ===');
  for (const [sch, ag] of Object.entries(AG)) {
    for (const [vn, arr] of Object.entries(ag)) {
      const vm = new Map();
      for (let p = 0; p < idxName.length; p++) if (arr[p] > 0) vm.set(nameOf(p), arr[p]);
      const row = [(sch + '/' + vn).padEnd(16)];
      for (const [dn, dm] of Object.entries(DIMS)) {
        const pairs = [];
        for (const [pid, v] of vm) { const o = dm.get(pid); if (o !== undefined) pairs.push([v, o]); }
        const { n, rho } = spearman(pairs);
        row.push((rho.toFixed(4) + '/n' + n).padEnd(13));
      }
      console.log(...row);
      /* 锚点 */
      const sorted = [...vm.entries()].sort((a, b) => b[1] - a[1]);
      const rk = new Map(); sorted.forEach(([pid], i) => rk.set(pid, i + 1));
      console.log('   锚点:', ANCH.map((pid) => {
        const r = rk.get(pid);
        return (pid === '2009ZEMD01' ? 'Feliks' : pid === '2012PARK03' ? 'Max' : pid === '2016KOLA02' ? 'Tymon' : pid === '2019WANY36' ? 'Yiheng' : pid === '2016CHAP04' ? 'Chapel' : 'Akke') + ' #' + (r || '-');
      }).join('  '));
    }
  }

  /* ── 主候选榜 Top25（year/max 与 year/top3sq）── */
  for (const [sch, vn] of [['year', 'max'], ['year', 'top3sq'], ['quarter', 'max']]) {
    const arr = AG[sch][vn];
    const idxs = [];
    for (let p = 0; p < idxName.length; p++) if (arr[p] > 0) idxs.push(p);
    idxs.sort((a, b) => arr[b] - arr[a]);
    console.log('\n── ' + sch + '/' + vn + ' Top25（人数 ' + num(idxs.length) + '）──');
    for (let r = 0; r < Math.min(25, idxs.length); r++) {
      const p = idxs[r];
      console.log(String(r + 1).padStart(2), nameOf(p).padEnd(13), F(arr[p], 1));
    }
  }

  /* 导出 */
  const out = ['pid\tname\ty_max\ty_top3\ty_sq\ty_peakET\ty_top3sq\tq_max\tq_top3\tq_sq\tq_peakET\tq_top3sq'];
  for (let p = 0; p < idxName.length; p++) {
    if (AG.year.max[p] <= 0 && AG.quarter.max[p] <= 0) continue;
    out.push([idxName[p], nameOf(p).replace(/\t/g, ' '),
      F(AG.year.max[p], 1), F(AG.year.top3[p], 2), F(AG.year.sq[p], 1), F(AG.year.peakET[p], 1), F(AG.year.top3sq[p], 1),
      F(AG.quarter.max[p], 1), F(AG.quarter.top3[p], 2), F(AG.quarter.sq[p], 1), F(AG.quarter.peakET[p], 1), F(AG.quarter.top3sq[p], 1)].join('\t'));
  }
  fs.writeFileSync(path.join(__dirname, 'm6c_seats_v3.tsv'), out.join('\n') + '\n', 'utf8');
  log('\n→ m6c_seats_v3.tsv（', num(out.length - 1), '人）总耗时', ((Date.now() - t0) / 1000).toFixed(1) + 's');
}

main().catch((e) => { console.error(e); process.exit(1); });

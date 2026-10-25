'use strict';
/* ═══════════════════════════════════════════════════════════════════════
 * M6-c 诊断 4 · 份额化重构（统治份额 vs 覆盖面剥离）
 *   diag3 实证：占席条数无论怎么聚合，ρ(×M1/M2/M4) 全 0.84–0.91，
 *   根因 = 跨项目覆盖面是公共因子。
 *   本脚本把信号改定义为「统治份额」：
 *     对窗口 W、(项目 e, 轨道 t)：
 *       share(pid|e,t,W) = occ(pid|e,t,W) / top1occ(e,t,W)   ∈ (0,1]
 *   聚合候选：
 *     shareSum  = Σ_(e,t) max_W share            （各项目取巅峰份额求和）
 *     shareSumW = Σ_(e,t) w_e · max_W share      （w_e = EV_WEIGHT_V2 加权）
 *     shareSqrt = Σ_(e,t) w_e · max_W sqrt(share)（压缩非榜首份额）
 *     domYears  = Σ_(e,t) #{W : pid 是该(e,t,W)的占席榜一}  （称霸计数）
 *     peakShare = Σ_(e,t) max_W (occ/top1)²      （平方加强霸榜）
 * 用法：node --max-old-space-size=8192 etl/score/m6c_diag4.js
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
    return { cost: DD * 1e5 + TT };
  }
  const S = String(v);
  const SS = +S.slice(1, 3); const AA = +S.slice(3, 5); const TT = Math.min(+S.slice(5, 10), 99999);
  const solved = 99 - SS;
  const diff = 2 * solved - AA;
  return { cost: (99 - diff) * 1e5 + TT };
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
const WEIGHT = RN.EV_WEIGHT_V2 || {};

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

  const winRows = new Map();
  for (const [k, b] of buckets) {
    for (let i = 0; i < b.days.length; i++) {
      const day = b.days[i];
      const y = RN.yearOfDay(day) | 0;
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

  /* ── 席位 → 份额 ──
     perPid : pidIdx → { share: Map(et → max share), shareW, shareSqrt, dom, peakSq }
     存 per (pid, et) 的 max_W share；dom 需逐窗口计数。 */
  const etList = []; const etIdx = new Map();
  const etKey = (k) => { let i = etIdx.get(k); if (i === undefined) { i = etList.length; etIdx.set(k, i); etList.push(k); } return i; };
  const pidAgg = new Map();   // pidIdx → Map(etIdx → {maxShare, dom, maxSq})
  let done = 0;
  for (const [key, flat] of winRows) {
    const parts = key.split('|');
    if (parts[2] !== 'Y') continue;          // 主口径：年窗口（季窗口对照随后另算，先省内存）
    const et = etKey(parts[0] + '|' + parts[1]);
    const n = flat.length / 2;
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
    let top1 = 0;
    for (const c of occ.values()) if (c > top1) top1 = c;
    if (top1 <= 0) continue;
    for (const [pid, c] of occ) {
      let m = pidAgg.get(pid);
      if (!m) { m = new Map(); pidAgg.set(pid, m); }
      let e = m.get(et);
      if (!e) { e = { maxShare: 0, dom: 0, maxSq: 0 }; m.set(et, e); }
      const s = c / top1;
      if (s > e.maxShare) e.maxShare = s;
      if (c === top1) e.dom++;
      if (s * s > e.maxSq) e.maxSq = s * s;
    }
    if (++done % 2000 === 0) log('    …', num(done), '年窗口', ((Date.now() - t0) / 1000).toFixed(1) + 's');
  }
  log('[3/3] 份额统计完成（年窗口）', ((Date.now() - t0) / 1000).toFixed(1) + 's');

  /* ── 聚合 ── */
  const N = idxName.length;
  const A = { shareSum: new Float64Array(N), shareSumW: new Float64Array(N), shareSqrt: new Float64Array(N), domYears: new Float64Array(N), peakSq: new Float64Array(N) };
  for (const [pid, m] of pidAgg) {
    for (const [et, e] of m) {
      const w = WEIGHT[etList[et].split('|')[0]] || 0;
      A.shareSum[pid] += e.maxShare;
      A.shareSumW[pid] += w * e.maxShare;
      A.shareSqrt[pid] += w * Math.sqrt(e.maxShare);
      A.domYears[pid] += e.dom;
      A.peakSq[pid] += e.maxSq;
    }
  }

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
  const ANCH = { '2009ZEMD01': 'Feliks', '2012PARK03': 'Max', '2016KOLA02': 'Tymon', '2019WANY36': 'Yiheng', '2016CHAP04': 'Chapel', '2005AKKE01': 'Akke', '2013EGDA02': 'Egdal' };

  console.log('\n=== 份额化聚合 × 正交性（年窗口） ===');
  for (const [vn, arr] of Object.entries(A)) {
    const vm = new Map();
    for (let p = 0; p < N; p++) if (arr[p] > 0) vm.set(idxName[p], arr[p]);
    const row = [vn.padEnd(12)];
    for (const [dn, dm] of Object.entries(DIMS)) {
      const pairs = [];
      for (const [pid, v] of vm) { const o = dm.get(pid); if (o !== undefined) pairs.push([v, o]); }
      const { n, rho } = spearman(pairs);
      row.push((rho.toFixed(4) + '/n' + n).padEnd(13));
    }
    console.log(...row);
    const sorted = [...vm.entries()].sort((a, b) => b[1] - a[1]);
    const rk = new Map(); sorted.forEach(([pid], i) => rk.set(pid, i + 1));
    console.log('   锚点:', Object.entries(ANCH).map(([pid, nm]) => nm + ' #' + (rk.get(pid) || '-')).join('  '));
  }

  /* Top25 主候选 */
  for (const vn of ['shareSumW', 'shareSqrt', 'domYears']) {
    const arr = A[vn];
    const idxs = [];
    for (let p = 0; p < N; p++) if (arr[p] > 0) idxs.push(p);
    idxs.sort((a, b) => arr[b] - arr[a]);
    console.log('\n── ' + vn + ' Top25（人数 ' + num(idxs.length) + '）──');
    for (let r = 0; r < Math.min(25, idxs.length); r++) console.log(String(r + 1).padStart(2), idxName[idxs[r]].padEnd(13), F(arr[idxs[r]], 2));
  }

  /* 导出 */
  const out = ['pid\tname\tshareSum\tshareSumW\tshareSqrt\tdomYears\tpeakSq'];
  for (let p = 0; p < N; p++) {
    if (A.shareSum[p] <= 0) continue;
    out.push([idxName[p], idxName[p], F(A.shareSum[p], 3), F(A.shareSumW[p], 3), F(A.shareSqrt[p], 3), A.domYears[p], F(A.peakSq[p], 3)].join('\t'));
  }
  fs.writeFileSync(path.join(__dirname, 'm6c_seats_v4.tsv'), out.join('\n') + '\n', 'utf8');
  log('\n→ m6c_seats_v4.tsv（', num(out.length - 1), '人）总耗时', ((Date.now() - t0) / 1000).toFixed(1) + 's');
}

main().catch((e) => { console.error(e); process.exit(1); });

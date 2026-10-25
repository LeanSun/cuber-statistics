/**
 * M5 深度诊断 2 · 案例挖掘 + 与 esum 的重复度检验
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

  const evInfo = new Map();
  await streamTsv('WCA_export_events.tsv', (r) => { if (r[0]) evInfo.set(r[0], r[2] || r[0]); });
  const compDay = new Map();
  await streamTsv('WCA_export_competitions.tsv', (r) => {
    if (!r[0] || r[10] === '1') return;
    const y = +r[17] || +r[14]; if (!y) return;
    const m = +r[18] || +r[15] || 1, d = +r[19] || +r[16] || 1;
    compDay.set(r[0], dayOf(y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0')));
  });
  const nameOf = new Map();
  await streamTsv('WCA_export_persons.tsv', (r) => { if (r[2]) nameOf.set(r[2], r[0]); });

  /* 每人的：末次参赛（全局）、每项目末次参赛 */
  const lastAll = new Map();
  const lastByEv = new Map();   // pid|ev → day
  const cntByEv = new Map();
  await streamTsv('WCA_export_results.tsv', (r) => {
    if (!r[8]) return;
    const day = compDay.get(r[4]); if (day === undefined) return;
    const pid = r[8], ev = r[6];
    if (lastAll.get(pid) == null || day > lastAll.get(pid)) lastAll.set(pid, day);
    const k = pid + '|' + ev;
    if (lastByEv.get(k) == null || day > lastByEv.get(k)) lastByEv.set(k, day);
    cntByEv.set(k, (cntByEv.get(k) || 0) + 1);
  });
  console.log('[1] 有成绩的人:', lastAll.size);

  /* 排名 */
  const ranks = [];
  for (const [tr, file] of [['single', 'WCA_export_ranks_single.tsv'], ['average', 'WCA_export_ranks_average.tsv']]) {
    await streamTsv(file, (r) => { if (r[0]) ranks.push({ pid: r[1], ev: r[2], tr, wr: +r[3] }); });
  }

  /* ════ 1. 停办项目的真实停办日（修正 bug：按项目取） ════ */
  console.log('\n═══════ 1. 停办项目的「该项目内」最后参赛日 ════');
  console.log('项目\tEV_RETIRED_DAY\t实际末次(该项目)\t判定一致?');
  for (const ev of ['333ft', 'magic', 'mmagic', '333mbo']) {
    let mx = 0;
    for (const [k, d] of lastByEv) { if (k.endsWith('|' + ev) && d > mx) mx = d; }
    const declared = RETIRED[ev] ? new Date(RETIRED[ev] * 86400000).toISOString().slice(0, 10) : '（无）';
    const actual = mx ? new Date(mx * 86400000).toISOString().slice(0, 10) : '无';
    console.log(`${ev}\t${declared}\t${actual}\t${RETIRED[ev] && mx <= RETIRED[ev] ? '✓ 一致' : '✗ 不一致'}`);
  }

  /* ════ 2. 「僵尸榜」量化：榜单里的僵尸 ════ */
  console.log('\n═══════ 2. 榜单僵尸（该组合内末次参赛距今 > 2 年）═══════');
  console.log('ev\ttrack\tTop10僵尸\tTop50僵尸\tTop100僵尸\tTop100中僵尸占比');
  const zst = new Map();
  for (const x of ranks) {
    const k = x.ev + '|' + x.tr;
    let z = zst.get(k); if (!z) { z = { t10: 0, t50: 0, t100: 0, n100: 0 }; zst.set(k, z); }
    const lc = lastByEv.get(x.pid + '|' + x.ev);
    const gap = lc == null ? 999 : (SNAP_DAY - lc) / 365.25;
    if (gap > 2) {
      if (x.wr <= 10) z.t10++;
      if (x.wr <= 50) z.t50++;
      if (x.wr <= 100) { z.t100++; z.n100++; }
    } else if (x.wr <= 100) z.n100++;
  }
  for (const [k, z] of [...zst.entries()].sort()) {
    if (z.n100 === 0) continue;
    console.log(`${k}\t${z.t10}\t${z.t50}\t${z.t100}\t${(z.t100 / z.n100 * 100).toFixed(1)}%`);
  }

  /* ════ 3. 案例：Timofei Tarasenko 为什么第一 ════ */
  console.log('\n═══════ 3. 案例拆解 ════');
  const decayA = (g) => Math.max(0.2, 1 - (g / 5) * 0.8);
  const gaps = [];
  for (const [pid, d] of lastAll) gaps.push((SNAP_DAY - d) / 365.25);
  gaps.sort((a, b) => a - b);
  console.log('全站「距末次参赛」分位: p10=' + gaps[Math.floor(gaps.length * 0.1)].toFixed(2) +
    '  p50=' + gaps[Math.floor(gaps.length * 0.5)].toFixed(2) +
    '  p90=' + gaps[Math.floor(gaps.length * 0.9)].toFixed(2) +
    '  p99=' + gaps[Math.floor(gaps.length * 0.99)].toFixed(2));

  const CASES = ['Timofei Tarasenko', 'Tymon Kolasiński', 'Max Park', 'Feliks Zemdegs', 'Yiheng Wang (王艺衡)'];
  const pidOf = new Map();
  for (const [pid, nm] of nameOf) if (CASES.includes(nm)) pidOf.set(nm, pid);
  console.log('\n选手\t末次参赛\t距今\t该组合名次(单次/平均)\t组合分');
  for (const nm of CASES) {
    const pid = pidOf.get(nm);
    if (!pid) { console.log(nm + '\t（未找到）'); continue; }
    const lc = lastAll.get(pid);
    const g = (SNAP_DAY - lc) / 365.25;
    const mine = ranks.filter((x) => x.pid === pid).sort((a, b) => a.ev.localeCompare(b.ev) || a.tr.localeCompare(b.tr));
    const detail = mine.map((x) => {
      const w = W[x.ev] == null ? 0.3 : W[x.ev];
      const evLast = lastByEv.get(pid + '|' + x.ev);
      const gap = evLast == null ? 999 : (SNAP_DAY - evLast) / 365.25;
      const dec = decayA(gap);
      const s = w * Math.pow(x.wr, -1) * dec;
      return `${x.ev}/${x.tr}:#${x.wr}(w=${w.toFixed(2)},dec=${dec.toFixed(2)},s=${s.toFixed(4)})`;
    });
    console.log(`\n${nm}  末次 ${new Date(lc * 86400000).toISOString().slice(0, 10)}  距今 ${g.toFixed(2)}y  组合数 ${mine.length}`);
    for (const d of detail) console.log('   ', d);
  }

  /* ════ 4. 与 esum 的重复度：M5 vs 站点 esum 公式 ════ */
  console.log('\n═══════ 4. M5 与站点 esum（100×rank^-γ×w）的结构重复度 ════');
  const EV_GAMMA = 0.35;   // build.js 的 EV_GAMMA（需核对）
  console.log('build.js 的 EV_GAMMA 实际值：');
  const bjsrc = fs.readFileSync(path.join(ROOT, 'etl/build.js'), 'utf8');
  const gm = bjsrc.match(/EV_GAMMA\s*=\s*([\d.]+)/);
  console.log('  ', gm ? gm[0] : '未找到（可能来自别处）');
  const esum = new Map();
  for (const x of ranks) {
    const w = W[x.ev] == null ? 0.3 : W[x.ev];
    esum.set(x.pid, (esum.get(x.pid) || 0) + 100 * Math.pow(x.wr, -(gm ? +gm[1] : 0.35)) * w);
  }
  const m5 = new Map();
  for (const x of ranks) {
    if (x.wr > 100) continue;
    if (RETIRED[x.ev] != null) continue;
    const lc = lastByEv.get(x.pid + '|' + x.ev);
    const gap = lc == null ? 999 : (SNAP_DAY - lc) / 365.25;
    const w = W[x.ev] == null ? 0.3 : W[x.ev];
    const v = w * Math.pow(x.wr, -1) * decayA(gap);
    m5.set(x.pid, (m5.get(x.pid) || 0) + v);
  }
  function spearman(mapA, mapB, limitA, limitB) {
    const A = [...mapA.entries()].sort((a, b) => b[1] - a[1]).slice(0, limitA);
    const B = [...mapB.entries()].sort((a, b) => b[1] - a[1]).slice(0, limitB);
    /* rankOf 必须以 pid 为 key —— 早前误用数组下标，导致交集为空 */
    const rankOf = (arr) => {
      const idx = arr.map((v, i) => [v[1], v[0]]).sort((a, b) => a[0] - b[0]);
      const r = new Map();
      for (let i = 0; i < idx.length; i++) r.set(idx[i][1], i + 1);
      return r;
    };
    const ra = rankOf(A), rb = rankOf(B);
    const ids = A.map((x) => x[0]).filter((id) => rb.has(id));
    if (ids.length < 3) return null;
    const xs = ids.map((id) => ra.get(id)), ys = ids.map((id) => rb.get(id));
    const n = xs.length, mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
    let num = 0, dx = 0, dy = 0;
    for (let i = 0; i < n; i++) { const a = xs[i] - mx, b = ys[i] - my; num += a * b; dx += a * a; dy += b * b; }
    return { n, rho: num / Math.sqrt(dx * dy) };
  }
  const cmp = spearman(m5, esum, 100, 100);
  console.log(`M5 Top100 vs esum Top100（名次 Spearman）: n=${cmp.n} ρ=${cmp.rho.toFixed(4)}`);
  console.log('M5 Top20:'); [...m5.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).forEach(([pid, s], i) => console.log(`  #${i + 1} ${(nameOf.get(pid) || pid).padEnd(26)} M5=${F4(s)}  esum=${F4(esum.get(pid) || 0)}`));
})();

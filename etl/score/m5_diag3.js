/**
 * M5 口径实验 · 关键选项的实测后果
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

  const compDay = new Map();
  await streamTsv('WCA_export_competitions.tsv', (r) => {
    if (!r[0] || r[10] === '1') return;
    const y = +r[17] || +r[14]; if (!y) return;
    const m = +r[18] || +r[15] || 1, d = +r[19] || +r[16] || 1;
    compDay.set(r[0], dayOf(y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0')));
  });
  const nameOf = new Map();
  await streamTsv('WCA_export_persons.tsv', (r) => { if (r[2]) nameOf.set(r[2], r[0]); });
  const lastByEv = new Map();
  await streamTsv('WCA_export_results.tsv', (r) => {
    if (!r[8]) return;
    const day = compDay.get(r[4]); if (day === undefined) return;
    const k = r[8] + '|' + r[6];
    if (lastByEv.get(k) == null || day > lastByEv.get(k)) lastByEv.set(k, day);
  });
  const ranks = [];
  for (const [tr, file] of [['single', 'WCA_export_ranks_single.tsv'], ['average', 'WCA_export_ranks_average.tsv']]) {
    await streamTsv(file, (r) => { if (r[0]) ranks.push({ pid: r[1], ev: r[2], tr, wr: +r[3] }); });
  }

  /* ════ 1. 并列名次：有多少人并列在 #1 ════ */
  console.log('═══════ 1. 并列名次的影响：各组合「并列在 #1 的人数」═══════');
  console.log('ev|track\t总人数\t#1并列人数\t#1占该组合人数比');
  const cnt = new Map();
  for (const x of ranks) {
    const k = x.ev + '|' + x.tr;
    let o = cnt.get(k); if (!o) { o = { n: 0, one: 0 }; cnt.set(k, o); }
    o.n++;
    if (x.wr === 1) o.one++;
  }
  const tieList = [...cnt.entries()].filter(([, o]) => o.one > 1).sort((a, b) => b[1].one - a[1].one);
  for (const [k, o] of tieList) console.log(`${k}\t${o.n}\t${o.one}\t${(o.one / o.n * 100).toFixed(1)}%`);
  console.log('（并列 #1 的组合数：' + tieList.length + ' / ' + cnt.size + '）');

  /* ════ 2. 排名深度上限 × 人口 × 与各维度正交性 ════ */
  const DECAYS = {
    '线性→0.2 (A)': (g) => Math.max(0.2, 1 - (g / 5) * 0.8),
    '线性→0.5 (B)': (g) => Math.max(0.5, 1 - (g / 5) * 0.5),
    '指数 0.5^(g/5) (C)': (g) => Math.pow(0.5, g / 5),
  };
  const RANKFN = {
    'r^-1': (r) => Math.pow(r, -1),
    'r^-0.5': (r) => Math.pow(r, -0.5),
    'domScore(站点)': (r) => r <= 1 ? 1 : r <= 3 ? 0.85 : r <= 10 ? ((11 - r) / 10) * 0.7 : r <= 100 ? 0.15 * (1 - (r - 10) / 90) * 0.85 + 0.02 : 0.01,
  };

  function compute(cfg) {
    const sc = new Map();
    for (const x of ranks) {
      if (x.wr > cfg.cap) continue;
      if (cfg.skipRetired && RETIRED[x.ev] != null) continue;
      if (cfg.trackW[x.tr] == null || cfg.trackW[x.tr] === 0) continue;
      const lc = lastByEv.get(x.pid + '|' + x.ev);
      const gap = lc == null ? 99 : (SNAP_DAY - lc) / 365.25;
      const w = W[x.ev] == null ? RN.WEIGHT_V2_CFG.floor : W[x.ev];
      const v = w * cfg.rankFn(x.wr) * cfg.decay(gap) * cfg.trackW[x.tr];
      if (v <= 0) continue;
      sc.set(x.pid, (sc.get(x.pid) || 0) + v);
    }
    return [...sc.entries()].map(([pid, s]) => ({ pid, s, name: nameOf.get(pid) || pid }))
      .sort((a, b) => b.s - a.s);
  }

  function loadTsv(p, nameCol, valCol) {
    const m = new Map();
    if (!fs.existsSync(p)) return m;
    for (const ln of fs.readFileSync(p, 'utf8').trim().split('\n').slice(1)) {
      const c = ln.split('\t');
      m.set(c[nameCol], +c[valCol]);
    }
    return m;
  }
  const m4 = loadTsv(path.join(__dirname, 'M4_seats.tsv'), 1, 2);
  const m2 = loadTsv(path.join(__dirname, 'M2_ranking.tsv'), 2, 3);

  function spearmanPairs(arr, src, limit) {
    const top = arr.slice(0, limit);
    const idx = top.map((x, i) => [x, i]);
    idx.sort((a, b) => b[0].s - a[0].s);
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

  console.log('\n═══════ 2. 主口径候选（深度100 / 排除停办 / 双轨）═══════');
  console.log('方案\t人数\t总量\tTop5\t×M4\t×M2');
  const cands = [];
  for (const [dk, df] of Object.entries(DECAYS)) {
    for (const [rk, rf] of Object.entries(RANKFN)) {
      cands.push({ key: `${dk} × ${rk}`, cfg: { cap: 100, rankFn: rf, decay: df, trackW: { single: 1, average: 1 }, skipRetired: true } });
    }
  }
  for (const c of cands) {
    const arr = compute(c.cfg);
    const s4 = spearmanPairs(arr, m4, 100), s2 = spearmanPairs(arr, m2, 100);
    const top5 = arr.slice(0, 5).map((x) => x.name).join(', ');
    console.log(`${c.key}\t${arr.length}\t${F4(arr.reduce((a, b) => a + b.s, 0))}\t${top5}\t${s4 ? s4.rho.toFixed(4) : '—'}(n=${s4 ? s4.n : 0})\t${s2 ? s2.rho.toFixed(4) : '—'}(n=${s2 ? s2.n : 0})`);
  }

  console.log('\n═══════ 3. 深度上限的影响（主口径：r^-1 × 衰减A × 排除停办）═══════');
  console.log('深度\t人数\t总量\tTop10\t×M4ρ\t×M2ρ');
  for (const cap of [50, 100, 200, 500, 1000]) {
    const cfg = { cap, rankFn: RANKFN['r^-1'], decay: DECAYS['线性→0.2 (A)'], trackW: { single: 1, average: 1 }, skipRetired: true };
    const arr = compute(cfg);
    const s4 = spearmanPairs(arr, m4, 100), s2 = spearmanPairs(arr, m2, 100);
    console.log(`${cap}\t${arr.length}\t${F4(arr.reduce((a, b) => a + b.s, 0))}\t${arr.slice(0, 10).map((x) => x.name.split(' ')[0]).join(' ')}\t${s4 ? s4.rho.toFixed(4) : '—'}\t${s2 ? s2.rho.toFixed(4) : '—'}`);
  }

  console.log('\n═══════ 4. 单次/平均双轨 vs 只单次（主口径）═══════');
  for (const tw of [{ single: 1, average: 1 }, { single: 1, average: 0 }, { single: 0, average: 1 }, { single: 1, average: 0.5 }]) {
    const cfg = { cap: 100, rankFn: RANKFN['r^-1'], decay: DECAYS['线性→0.2 (A)'], trackW: tw, skipRetired: true };
    const arr = compute(cfg);
    const s4 = spearmanPairs(arr, m4, 100), s2 = spearmanPairs(arr, m2, 100);
    console.log(`单次${tw.single} 平均${tw.average}\t人数${arr.length}\t总量${F4(arr.reduce((a, b) => a + b.s, 0))}\tTop5: ${arr.slice(0, 5).map((x) => x.name).join(', ')}\t×M4 ${s4 ? s4.rho.toFixed(4) : '—'}\t×M2 ${s2 ? s2.rho.toFixed(4) : '—'}`);
  }

  console.log('\n═══════ 5. 停办项目：保留 vs 排除 的实际后果（深度100）════�═══');
  for (const skip of [false, true]) {
    const cfg = { cap: 100, rankFn: RANKFN['r^-1'], decay: DECAYS['线性→0.2 (A)'], trackW: { single: 1, average: 1 }, skipRetired: skip };
    const arr = compute(cfg);
    const s4 = spearmanPairs(arr, m4, 100);
    console.log(`skipRetired=${skip}\t人数${arr.length}\t总量${F4(arr.reduce((a, b) => a + b.s, 0))}\tTop8: ${arr.slice(0, 8).map((x) => x.name).join(' | ')}\t×M4 ${s4 ? s4.rho.toFixed(4) : '—'}`);
  }

  console.log('\n═══════ 6. 「按项目内末次参赛」vs 「按选手全局末次参赛」的衰减差异 ════');
  {
    const lastAll = new Map();
    for (const [k, d] of lastByEv) {
      const pid = k.slice(0, k.lastIndexOf('|'));
      if (lastAll.get(pid) == null || d > lastAll.get(pid)) lastAll.set(pid, d);
    }
    const mk = (useAll) => {
      const sc = new Map();
      for (const x of ranks) {
        if (x.wr > 100 || RETIRED[x.ev] != null) continue;
        const lc = useAll ? lastAll.get(x.pid) : lastByEv.get(x.pid + '|' + x.ev);
        const gap = lc == null ? 99 : (SNAP_DAY - lc) / 365.25;
        const w = W[x.ev] == null ? 0.3 : W[x.ev];
        const v = w * Math.pow(x.wr, -1) * DECAYS['线性→0.2 (A)'](gap);
        sc.set(x.pid, (sc.get(x.pid) || 0) + v);
      }
      return [...sc.entries()].map(([pid, s]) => ({ pid, s, name: nameOf.get(pid) || pid })).sort((a, b) => b.s - a.s);
    };
    const a1 = mk(false), a2 = mk(true);
    console.log('按项目内衰减 Top8:', a1.slice(0, 8).map((x) => `${x.name}(${F4(x.s)})`).join(' | '));
    console.log('按全局衰减   Top8:', a2.slice(0, 8).map((x) => `${x.name}(${F4(x.s)})`).join(' | '));
    const s1 = new Set(a1.slice(0, 25).map((x) => x.name));
    const ov = a2.slice(0, 25).filter((x) => s1.has(x.name)).length;
    console.log('Top25 重合:', ov, '/25');
  }
})();

/**
 * M5 口径诊断 · 四个待决选项的实际影响
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

function spearman(xs, ys) {
  const n = xs.length;
  if (n < 3) return null;
  const rx = rankOf(xs), ry = rankOf(ys);
  const mx = rx.reduce((a, b) => a + b, 0) / n, my = ry.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { const a = rx[i] - mx, b = ry[i] - my; num += a * b; dx += a * a; dy += b * b; }
  return dx && dy ? num / Math.sqrt(dx * dy) : null;
}
function rankOf(arr) {
  const idx = arr.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const r = new Array(arr.length);
  for (let i = 0; i < idx.length; i++) r[idx[i][1]] = i + 1;
  return r;
}

(async () => {
  const RN = require('./runs.js');

  /* 事件表 + 权重 */
  const evInfo = new Map();
  await streamTsv('WCA_export_events.tsv', (r) => { if (r[0]) evInfo.set(r[0], { name: r[2] || r[0] }); });
  const RETIRED = RN.EV_RETIRED_DAY;
  const W = RN.EV_WEIGHT_V2;

  /* 比赛日 + 末次参赛 */
  const compDay = new Map();
  await streamTsv('WCA_export_competitions.tsv', (r) => {
    if (!r[0] || r[10] === '1') return;
    const y = +r[17] || +r[14]; if (!y) return;
    const m = +r[18] || +r[15] || 1, d = +r[19] || +r[16] || 1;
    compDay.set(r[0], dayOf(y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0')));
  });
  const lastComp = new Map();
  const nameOf = new Map();
  await streamTsv('WCA_export_persons.tsv', (r) => { if (r[2]) nameOf.set(r[2], r[0]); });
  await streamTsv('WCA_export_results.tsv', (r) => {
    if (!r[8]) return;
    const day = compDay.get(r[4]);
    if (day === undefined) return;
    const pid = r[8];
    if (lastComp.get(pid) == null || day > lastComp.get(pid)) lastComp.set(pid, day);
  });
  console.log('[1] 有成绩的人:', lastComp.size);

  /* 排名 */
  const ranks = [];
  for (const [tr, file] of [['single', 'WCA_export_ranks_single.tsv'], ['average', 'WCA_export_ranks_average.tsv']]) {
    await streamTsv(file, (r) => { if (r[0]) ranks.push({ pid: r[1], ev: r[2], tr, wr: +r[3] }); });
  }
  console.log('[2] 排名条目:', ranks.length);

  /* ════ 选项 A：排名深度上限 → 人口规模 ════ */
  console.log('\n═══════ A. 排名深度上限对人口的影响 ═══════');
  console.log('上限\t条目数\t独立人数\t占全站300057比');
  for (const cap of [10, 50, 100, 200, 500, 1000, 5000, 999999]) {
    const sub = ranks.filter((x) => x.wr <= cap);
    const ppl = new Set(sub.map((x) => x.pid));
    console.log(`${cap}\t${sub.length}\t${ppl.size}\t${(ppl.size / lastComp.size * 100).toFixed(2)}%`);
  }

  /* ════ 选项 B：停办项目 ════ */
  console.log('\n═══════ B. 停办项目（magic / mmagic / 333mbo）的榜单状态 ═══════');
  console.log('项目\t组合数\tTop10中距今>2年人数\tTop100中距今>2年人数\t最后正式比赛');
  for (const ev of ['magic', 'mmagic', '333mbo', '333ft']) {
    const sub = ranks.filter((x) => x.ev === ev);
    let old10 = 0, old100 = 0, lastDay = 0;
    for (const x of sub) {
      const lc = lastComp.get(x.pid);
      const gap = lc == null ? 999 : (SNAP_DAY - lc) / 365.25;
      if (x.wr <= 10 && gap > 2) old10++;
      if (x.wr <= 100 && gap > 2) old100++;
      if (lc > lastDay) lastDay = lc;
    }
    console.log(`${ev}\t${sub.length}\t${old10}\t${old100}\t${new Date(lastDay * 86400000).toISOString().slice(0, 10)}`);
  }

  /* ════ 选项 C：退役衰减函数形态 ════ */
  console.log('\n═══════ C. 退役衰减函数（gap = 距末次参赛年数）═══════');
  console.log('gap\\方案\tA线性到0.2\tB线性到0.5\tC指数0.5^gap\tD前2年恒1后线性');
  const decays = {
    A: (g) => Math.max(0.2, 1 - (g / 5) * 0.8),
    B: (g) => Math.max(0.5, 1 - (g / 5) * 0.5),
    C: (g) => Math.pow(0.5, g / 5),
    D: (g) => g <= 2 ? 1 : Math.max(0.2, 1 - ((g - 2) / 3) * 0.8),
  };
  for (const g of [0, 0.5, 1, 2, 3, 4, 5, 7, 10]) {
    const row = Object.keys(decays).map((k) => decays[k](g).toFixed(3)).join('\t');
    console.log(`${g}\t${row}`);
  }

  /* ════ 选项 D：名次 → 分值函数 ════ */
  console.log('\n═══════ D. 名次 → 分值函数候选（归一到 r=1 时为 1.0）═══════');
  const rankFns = {
    '幂律 r^-1': (r) => Math.pow(r, -1),
    '幂律 r^-0.5': (r) => Math.pow(r, -0.5),
    '幂律 r^-1.5': (r) => Math.pow(r, -1.5),
    '对数 1/ln(1+r)': (r) => 1 / Math.log(1 + r),
    '分段(站点domScore)': (r) => r <= 1 ? 1 : r <= 3 ? 0.85 : r <= 10 ? ((11 - r) / 10) * 0.7 : r <= 100 ? 0.15 * (1 - (r - 10) / 90) * 0.85 + 0.02 : 0.01,
  };
  console.log('r\t' + Object.keys(rankFns).join('\t'));
  for (const r of [1, 2, 3, 5, 10, 20, 50, 100, 200, 500]) {
    console.log(`${r}\t` + Object.keys(rankFns).map((k) => rankFns[k](r).toFixed(4)).join('\t'));
  }

  /* ════ 试算：不同组合的榜单 ════ */
  console.log('\n═══════ E. 试算榜对比 ════');
  const gapOf = (pid) => { const lc = lastComp.get(pid); return lc == null ? 99 : (SNAP_DAY - lc) / 365.25; };

  function compute(cfg) {
    const scores = new Map();
    for (const x of ranks) {
      if (x.wr > cfg.cap) continue;
      if (cfg.skipRetired && RETIRED[x.ev] != null) continue;
      const g = gapOf(x.pid);
      if (cfg.activeOnly && g >= 1) continue;
      const dec = cfg.decay(g);
      const w = W[x.ev] == null ? RN.WEIGHT_V2_CFG.floor : W[x.ev];
      const base = cfg.rankFn(x.wr);
      const val = w * base * dec * (cfg.trackW[x.tr] || 0);
      if (val <= 0) continue;
      scores.set(x.pid, (scores.get(x.pid) || 0) + val);
    }
    return [...scores.entries()].map(([pid, s]) => ({ pid, s, name: nameOf.get(pid) || pid })).sort((a, b) => b.s - a.s);
  }

  const variants = [
    { key: 'V1 基础(幂律r^-1, 衰减A, 深度100, 含停办)', cfg: { cap: 100, rankFn: rankFns['幂律 r^-1'], decay: decays.A, trackW: { single: 1, average: 1 }, skipRetired: false } },
    { key: 'V2 +排除停办项目', cfg: { cap: 100, rankFn: rankFns['幂律 r^-1'], decay: decays.A, trackW: { single: 1, average: 1 }, skipRetired: true } },
    { key: 'V3 +只算近1年活跃者', cfg: { cap: 100, rankFn: rankFns['幂律 r^-1'], decay: decays.A, trackW: { single: 1, average: 1 }, skipRetired: true, activeOnly: true } },
    { key: 'V4 单次轨道 only', cfg: { cap: 100, rankFn: rankFns['幂律 r^-1'], decay: decays.A, trackW: { single: 1, average: 0 }, skipRetired: true } },
    { key: 'V5 深度500 + 排除停办', cfg: { cap: 500, rankFn: rankFns['幂律 r^-1'], decay: decays.A, trackW: { single: 1, average: 1 }, skipRetired: true } },
  ];
  for (const v of variants) {
    const arr = compute(v.cfg);
    console.log(`\n--- ${v.key} ---  人数 ${arr.length}  总量 ${arr.reduce((a, b) => a + b.s, 0).toFixed(4)}`);
    arr.slice(0, 12).forEach((x, i) => console.log(`  #${i + 1} ${x.name.padEnd(26)} ${F4(x.s)}`));
  }

  /* ════ 与 M4 / M2 的正交性 ════ */
  console.log('\n═══════ F. 与 M4 的正交性（Spearman）═══════');
  const m4 = new Map();
  if (fs.existsSync(path.join(__dirname, 'M4_seats.tsv'))) {
    for (const ln of fs.readFileSync(path.join(__dirname, 'M4_seats.tsv'), 'utf8').trim().split('\n').slice(1)) {
      const c = ln.split('\t');
      m4.set(c[1], +c[2]);
    }
  }
  const m2 = new Map();
  if (fs.existsSync(path.join(__dirname, 'M2_ranking.tsv'))) {
    for (const ln of fs.readFileSync(path.join(__dirname, 'M2_ranking.tsv'), 'utf8').trim().split('\n').slice(1)) {
      const c = ln.split('\t');
      m2.set(c[2], +c[3]);
    }
  }
  for (const v of variants) {
    const arr = compute(v.cfg);
    const idx = new Map(arr.map((x, i) => [x.name, i]));
    for (const [label, src] of [['M4', m4], ['M2', m2]]) {
      const xs = [], ys = [];
      for (const x of arr) {
        const mv = src.get(x.name);
        if (mv == null) continue;
        xs.push(x.s); ys.push(mv);
      }
      const r = spearman(xs, ys);
      console.log(`  ${v.key.slice(0, 4)} × ${label}: n=${xs.length}  ρ=${r == null ? '—' : r.toFixed(4)}`);
    }
  }
})();

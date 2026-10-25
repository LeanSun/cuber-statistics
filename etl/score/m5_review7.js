/**
 * M5 口径审阅 · 第七轮（收口）
 *   T. 核心问题的精确量化：「decay=1.0 但 PB 已过期」的人 —— 公式完全没惩罚的化石选手
 *   U. 人口覆盖率对比（M5 只有 1257 人有分，M2/M4 覆盖多少）
 *   V. 「近1年窗口」口径对 M5 榜的实际影响（正确实现）
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const RN = require('./runs.js');

const ROOT = path.resolve(__dirname, '../..');
const ZIP = fs.readdirSync(path.join(ROOT, 'data/raw')).filter((f) => f.endsWith('.zip'))[0];
const ZIP_PATH = path.join(ROOT, 'data/raw', ZIP);
const SNAPSHOT_DAY = RN.SNAPSHOT_DAY;
const dayOf = (s) => Math.floor(Date.parse(s + 'T00:00:00Z') / 86400000);
const F = (v) => Number(v).toFixed(4);
const num = (v) => Number(v).toLocaleString('en-US');

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

const ACTIVE = ['222', '333', '333bf', '333fm', '333mbf', '333oh', '444', '444bf',
  '555', '555bf', '666', '777', 'clock', 'minx', 'pyram', 'skewb', 'sq1'];
const decayOf = (gap) => Math.max(0.2, 1 - (gap / 5) * 0.8);

(async () => {
  const W = RN.EV_WEIGHT_V2;
  const FLOOR = RN.WEIGHT_V2_CFG.floor;

  const compDay = new Map();
  await streamTsv('WCA_export_competitions.tsv', (r) => {
    if (!r[0] || r[10] === '1') return;
    const y = +r[17] || +r[14]; if (!y) return;
    const m = +r[18] || +r[15] || 1;
    const d = +r[19] || +r[16] || 1;
    compDay.set(r[0], dayOf(y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0')));
  });
  const pName = new Map();
  await streamTsv('WCA_export_persons.tsv', (r) => { if (r[2]) pName.set(r[2], r[0]); });

  const lastByEv = new Map();
  /* PB 达成日：pid|ev|tr → PB 成绩的达成日 */
  const pbDate = new Map();
  const pbVal = new Map();
  /* 近365天最好成绩 */
  const winBest = new Map();
  await streamTsv('WCA_export_results.tsv', (r) => {
    if (!r[8]) return;
    const day = compDay.get(r[4]);
    if (day === undefined) return;
    const pid = r[8], ev = r[6];
    const k = pid + '|' + ev;
    if (lastByEv.get(k) == null || day > lastByEv.get(k)) lastByEv.set(k, day);
    const vs = +r[2], va = +r[3];
    const tracks = [];
    if (vs > 0) tracks.push(['single', vs]);
    if (va > 0) tracks.push(['average', va]);
    for (const [tr, val] of tracks) {
      const kk = k + '|' + tr;
      if (!pbVal.has(kk) || val < pbVal.get(kk)) { pbVal.set(kk, val); pbDate.set(kk, day); }
      if (SNAPSHOT_DAY - day <= 365) {
        if (!winBest.has(kk) || val < winBest.get(kk)) winBest.set(kk, val);
      }
    }
  });

  const ranks = [];
  for (const [tr, file] of [['single', 'WCA_export_ranks_single.tsv'],
    ['average', 'WCA_export_ranks_average.tsv']]) {
    await streamTsv(file, (r) => {
      if (!r[0]) return;
      ranks.push({ pid: r[1], ev: r[2], tr, wr: +r[3] });
    });
  }

  /* ── T. 「公式未惩罚的化石选手」 ── */
  console.log('═══════ T. 核心问题量化：decay=1.0 但 PB 已过期的选手 ═══════');
  console.log('（还在参赛 → decay=1.0，但那个名次是几年前的成绩挣来的）');
  let t1 = 0, t2 = 0, t3 = 0, tot = 0;
  let contribTot = 0, contribStale = 0;
  const staleTop = [];
  for (const x of ranks) {
    if (x.wr > 100) continue;
    if (!ACTIVE.includes(x.ev)) continue;
    tot++;
    const k = x.pid + '|' + x.ev;
    const lc = lastByEv.get(k);
    const gap = lc == null ? 99 : (SNAPSHOT_DAY - lc) / 365.25;
    const pd = pbDate.get(k + '|' + x.tr);
    const pbAge = pd == null ? 99 : (SNAPSHOT_DAY - pd) / 365.25;
    const w = W[x.ev] == null ? FLOOR : W[x.ev];
    const s = w * Math.pow(x.wr, -1) * decayOf(gap);
    contribTot += s;
    /* 还在活跃（gap≤1）但 PB 已 ≥2 年没刷新 */
    if (gap <= 1 && pbAge >= 2) {
      t1++; contribStale += s;
      if (staleTop.length < 10) staleTop.push({ k, name: pName.get(x.pid) || x.pid, wr: x.wr, pbAge, s });
    }
    if (gap <= 1 && pbAge >= 3) t2++;
    if (gap <= 1 && pbAge >= 5) t3++;
  }
  console.log(`前100 条目 ${num(tot)}`);
  console.log(`「仍在活跃期(gap≤1y) 但 PB 已 ≥2 年未刷新」: ${t1} 条 (${(t1 / tot * 100).toFixed(1)}%)`);
  console.log(`   ≥3 年未刷新: ${t2} 条；≥5 年未刷新: ${t3} 条`);
  console.log(`这些条目贡献了 M5 总量的 ${(contribStale / contribTot * 100).toFixed(1)}% —— decay 对它们完全无效（gap 小 → decay≈1）`);
  console.log('\n典型案例（名次高、PB 老、但人还在参赛）：');
  for (const s of staleTop) {
    console.log(`   ${s.k.padEnd(16)} #${String(s.wr).padStart(3)}  PB 已 ${s.pbAge.toFixed(1)} 年未刷新  贡献 ${F(s.s)}  ${String(s.name).slice(0, 24)}`);
  }

  /* ── V. 窗口口径的实际影响 ── */
  console.log('\n═══════ V. 「近1年窗口」重排名对 M5 榜的影响（正确实现）═══════');
  {
    /* 每个组合按窗口内最好成绩排名（只有窗口内有成绩的人） */
    const combo = new Map();
    for (const [kk, val] of winBest) {
      const parts = kk.split('|');
      const pid = parts[0], ev = parts[1], tr = parts[2];
      const key = ev + '|' + tr;
      if (!combo.has(key)) combo.set(key, []);
      combo.get(key).push({ pid, val });
    }
    const winRank = new Map();
    for (const [key, arr] of combo) {
      arr.sort((a, b) => a.val - b.val);
      arr.forEach((a, i) => winRank.set(a.pid + '|' + key, i + 1));
    }
    const build = (mode) => {
      const per = new Map();
      for (const x of ranks) {
        if (!ACTIVE.includes(x.ev)) continue;
        const key = x.ev + '|' + x.tr;
        let wr = x.wr;
        if (mode === 'win') {
          const nr = winRank.get(x.pid + '|' + key);
          if (nr == null) continue;
          wr = nr;
        } else if (x.wr > 100) continue;
        const lc = lastByEv.get(x.pid + '|' + x.ev);
        const gap = lc == null ? 99 : (SNAPSHOT_DAY - lc) / 365.25;
        const w = W[x.ev] == null ? FLOOR : W[x.ev];
        const s = w * Math.pow(wr, -1) * decayOf(gap);
        if (s <= 0) continue;
        let p = per.get(x.pid);
        if (!p) { p = { name: pName.get(x.pid) || x.pid, m5: 0, n: 0 }; per.set(x.pid, p); }
        p.m5 += s; p.n++;
      }
      return [...per.values()].sort((a, b) => b.m5 - a.m5);
    };
    const base = build('off');
    const win = build('win');
    const setB = new Set(base.slice(0, 25).map((p) => p.name));
    console.log(`现状 Top25 ∩ 窗口口径 Top25 = ${win.slice(0, 25).filter((p) => setB.has(p.name)).length}/25`);
    console.log(`窗口口径人数 ${num(win.length)}（现状 ${num(base.length)}）—— 窗口口径下深度不再截断在 100`);
    console.log('现状 Top10 : ' + base.slice(0, 10).map((p) => p.name.split(' ')[0]).join(' | '));
    console.log('窗口 Top10 : ' + win.slice(0, 10).map((p) => p.name.split(' ')[0]).join(' | '));
  }

  /* ── U. 人口覆盖率 ── */
  console.log('\n═══════ U. 各维度人口覆盖率对比 ═══════');
  const m4n = fs.readFileSync(path.join(__dirname, 'M4_seats.tsv'), 'utf8').trim().split('\n').length - 1;
  const m5n = fs.readFileSync(path.join(__dirname, 'M5_seats.tsv'), 'utf8').trim().split('\n').length - 1;
  console.log(`M4 统治力：${num(m4n)} 人有分（真正进过前十的）`);
  console.log(`M5 当前排名：${num(m5n)} 人有分（进过任一项目前100）`);
  console.log(`全站有成绩选手：300,057 人（含只打1-2场的）`);
  console.log(`→ M5 覆盖率 ${(m5n / 300057 * 100).toFixed(2)}%；M4 ${(m4n / 300057 * 100).toFixed(2)}%`);
  console.log('  M5 的「前100」比 M4 的「前十」宽 10 倍，但仍是极小的头部。');
})();

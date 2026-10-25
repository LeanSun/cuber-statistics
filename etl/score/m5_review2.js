/**
 * M5 口径审阅 · 第二轮：三个关键问题的实测
 *   A. 退役衰减在**非停办项目**上到底起多大作用（gap 分布）
 *   B. 与站点 esum 的重复度（从 js/data.js 读）
 *   C. 硬截断 DEPTH=100 的影响：被截断的人损失多少、边界是否平滑
 *   D. w_e（EV_WEIGHT_V2）对「当前排名」是否合适 —— 它是为「历史含金量」设计的
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
  await streamTsv('WCA_export_results.tsv', (r) => {
    if (!r[8]) return;
    const day = compDay.get(r[4]);
    if (day === undefined) return;
    const k = r[8] + '|' + r[6];
    if (lastByEv.get(k) == null || day > lastByEv.get(k)) lastByEv.set(k, day);
  });

  const ranks = [];
  for (const [tr, file] of [['single', 'WCA_export_ranks_single.tsv'],
    ['average', 'WCA_export_ranks_average.tsv']]) {
    await streamTsv(file, (r) => {
      if (!r[0]) return;
      ranks.push({ pid: r[1], ev: r[2], tr, wr: +r[3] });
    });
  }

  const decayOf = (gap) => Math.max(0.2, 1 - (gap / 5) * 0.8);

  /* ── A. gap 分布（非停办项目，depth<=100） ── */
  console.log('═══════ A. 退役衰减的实际影响力（非停办项目，深度≤100）═══════');
  const gaps = [];
  let totalW = 0, decW = 0;
  for (const x of ranks) {
    if (x.wr > 100) continue;
    if (!ACTIVE.includes(x.ev)) continue;
    const lc = lastByEv.get(x.pid + '|' + x.ev);
    const gap = lc == null ? 99 : (SNAPSHOT_DAY - lc) / 365.25;
    gaps.push(gap);
    const w = W[x.ev] == null ? FLOOR : W[x.ev];
    const wgt = w * Math.pow(x.wr, -1);
    totalW += wgt;
    decW += wgt * decayOf(gap);
  }
  gaps.sort((a, b) => a - b);
  const q = (p) => gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * p))];
  console.log(`样本 ${num(gaps.length)} 个（人,项目,轨道）条目`);
  console.log(`gap 分布: p10=${q(0.1).toFixed(3)}y  p50=${q(0.5).toFixed(3)}y  p90=${q(0.9).toFixed(3)}y  p99=${q(0.99).toFixed(3)}y  max=${gaps[gaps.length - 1].toFixed(3)}y`);
  const over1 = gaps.filter((g) => g > 1).length;
  const over2 = gaps.filter((g) => g > 2).length;
  const over5 = gaps.filter((g) => g > 5).length;
  console.log(`gap>1y: ${over1} 条 (${(over1 / gaps.length * 100).toFixed(1)}%)  |  >2y: ${over2} (${(over2 / gaps.length * 100).toFixed(1)}%)  |  >5y: ${over5} (${(over5 / gaps.length * 100).toFixed(1)}%)`);
  console.log(`衰减对总量的影响: ${F(totalW)} → ${F(decW)}  (${((decW / totalW - 1) * 100).toFixed(2)}%)`);
  console.log(`→ 结论：非停办项目上「官方榜=终身化石榜」的问题 ${over2 === 0 ? '几乎不存在' : '存在但有限'}；`);

  /* ── C. 硬截断的影响 ── */
  console.log('\n═══════ C. DEPTH=100 硬截断的影响 ═══════');
  for (const DEPTH of [50, 100, 200, 500, 1000]) {
    const per = new Map();
    let n = 0;
    for (const x of ranks) {
      if (x.wr > DEPTH) continue;
      if (!ACTIVE.includes(x.ev)) continue;
      const lc = lastByEv.get(x.pid + '|' + x.ev);
      const gap = lc == null ? 99 : (SNAPSHOT_DAY - lc) / 365.25;
      const w = W[x.ev] == null ? FLOOR : W[x.ev];
      const s = w * Math.pow(x.wr, -1) * decayOf(gap);
      if (s <= 0) continue;
      n++;
      let p = per.get(x.pid);
      if (!p) { p = { name: pName.get(x.pid) || x.pid, m5: 0 }; per.set(x.pid, p); }
      p.m5 += s;
    }
    const arr = [...per.values()].sort((a, b) => b.m5 - a.m5);
    const tot = arr.reduce((a, p) => a + p.m5, 0);
    console.log(`DEPTH=${String(DEPTH).padStart(4)}: 条目 ${num(n)}, 人数 ${num(arr.length)}, 总量 ${F(tot)}, Top5 = ${arr.slice(0, 5).map((p) => p.name.split(' ')[0] + ' ' + F(p.m5)).join(' | ')}`);
  }

  /* ── B. esum 重复度 ── */
  console.log('\n═══════ B. 与站点 esum 的重复度（从 js/data.js 读）═══════');
  try {
    const raw = fs.readFileSync(path.join(ROOT, 'js/data.js'), 'utf8');
    const m = raw.match(/var PLAYERS = (\[.*?\]);/s);
    const players = JSON.parse(m[1]);
    const esum = new Map();
    for (const p of players) if (p.esum != null) esum.set(p.name, p.esum);
    console.log(`esum 样本 ${num(esum.size)} 人`);

    const per = new Map();
    for (const x of ranks) {
      if (x.wr > 100) continue;
      if (!ACTIVE.includes(x.ev)) continue;
      const lc = lastByEv.get(x.pid + '|' + x.ev);
      const gap = lc == null ? 99 : (SNAPSHOT_DAY - lc) / 365.25;
      const w = W[x.ev] == null ? FLOOR : W[x.ev];
      const s = w * Math.pow(x.wr, -1) * decayOf(gap);
      if (s <= 0) continue;
      let p = per.get(x.pid);
      if (!p) { p = { name: pName.get(x.pid) || x.pid, m5: 0 }; per.set(x.pid, p); }
      p.m5 += s;
    }
    const arr = [...per.values()].sort((a, b) => b.m5 - a.m5);
    const names = arr.slice(0, 40).map((p) => p.name);
    const xs = [], ys = [];
    for (const n of names) {
      const v = esum.get(n);
      if (v == null) continue;
      xs.push(arr.find((p) => p.name === n).m5); ys.push(v);
    }
    const pear = (a, b) => {
      const n2 = a.length;
      const ma = a.reduce((x, y) => x + y, 0) / n2, mb = b.reduce((x, y) => x + y, 0) / n2;
      let nu = 0, da = 0, db = 0;
      for (let i = 0; i < n2; i++) { const u = a[i] - ma, v = b[i] - mb; nu += u * v; da += u * u; db += v * v; }
      return nu / Math.sqrt(da * db);
    };
    console.log(`M5 × esum  Pearson ρ = ${pear(xs, ys).toFixed(4)} (n=${xs.length})`);
    /* 也看 Top20 的名次重叠 */
    const m5Top = arr.slice(0, 20).map((p) => p.name);
    const esumTop = [...esum.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map((e) => e[0]);
    const setE = new Set(esumTop);
    console.log(`M5 Top20 与 esum Top20 重合 ${m5Top.filter((n) => setE.has(n)).length}/20`);
  } catch (e) { console.log('esum 读取失败:', e.message); }

  /* ── D. w_e 对「当前排名」是否合适 ── */
  console.log('\n═══════ D. w_e（EV_WEIGHT_V2）对当前排名的适配性 ═══════');
  console.log('EV_WEIGHT_V2 是按「历史参赛规模」算的项目权重：');
  const rows = Object.keys(W).map((ev) => ({ ev, w: W[ev] }));
  rows.sort((a, b) => b.w - a.w);
  console.log('项目\t权重\tM5 中该项目的组合数');
  const cnt = new Map();
  for (const x of ranks) {
    if (x.wr > 100) continue;
    if (!ACTIVE.includes(x.ev)) continue;
    cnt.set(x.ev, (cnt.get(x.ev) || 0) + 1);
  }
  for (const r of rows) console.log(`${r.ev.padEnd(8)}\t${F(r.w)}\t${cnt.get(r.ev) || 0}`);
})();

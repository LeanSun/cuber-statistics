/**
 * M5 口径审阅 · 第五轮：核心改进方案的实测
 *   N. 「近 N 个月最好成绩重排名」替代/校正官方终身榜 —— 对 M5 榜的实际影响
 *   O. 「双轨去重」方案：single/average 归一（取两轨较优者或平均）
 *   P. w_e 双重衰减的量化
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

  /* 收集：每人每项目每轨的「终身最好」与「近 N 月最好」 */
  const life = new Map();   // pid|ev|tr → val
  const lastByEv = new Map();
  const recent = new Map(); // pid|ev|tr → {val, day}
  await streamTsv('WCA_export_results.tsv', (r) => {
    if (!r[8]) return;
    const day = compDay.get(r[4]);
    if (day === undefined) return;
    const pid = r[8], ev = r[6];
    const k = pid + '|' + ev;
    if (lastByEv.get(k) == null || day > lastByEv.get(k)) lastByEv.set(k, day);
    const vs = +r[2], va = +r[3];
    if (vs > 0) {
      const kk = k + '|single';
      if (life.get(kk) == null || vs < life.get(kk)) life.set(kk, vs);
    }
    if (va > 0) {
      const kk = k + '|average';
      if (life.get(kk) == null || va < life.get(kk)) life.set(kk, va);
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

  /* ── N. 「近 N 月最好成绩」重排名 ── */
  console.log('═══════ N. 用「近 N 个月最好成绩」重排名（替代官方终身榜）═══════');
  for (const WIN of [180, 365, 730]) {
    /* 每个组合：收集近窗口内有成绩的人，按成绩排序 → 新名次 */
    const buckets = new Map();
    for (const [kk, val] of life) {
      const parts = kk.split('|');
      const pid = parts[0], ev = parts[1], tr = parts[2];
      /* 取该 (pid,ev,tr) 最近一次出现的日期近似 */
      const k2 = pid + '|' + ev;
      const lc = lastByEv.get(k2);
      if (lc == null) continue;
      /* 用最后一次参赛日期判断是否在窗口内 —— 近似：只要近窗口参赛过就纳入 */
      if (SNAPSHOT_DAY - lc > WIN) continue;
      const key = ev + '|' + tr;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push({ pid, val });
    }
    let diff = 0, tot = 0;
    const examples = [];
    for (const [key, arr] of buckets) {
      if (!ACTIVE.includes(key.split('|')[0])) continue;
      arr.sort((a, b) => a.val - b.val);
      tot++;
      const newTop = arr[0].pid;
      const off = ranks.find((x) => x.ev + '|' + x.tr === key && x.wr === 1);
      if (off && off.pid !== newTop) {
        diff++;
        if (examples.length < 8) {
          examples.push({
            key,
            off: pName.get(off.pid) || off.pid,
            offR: arr.findIndex((a) => a.pid === off.pid) + 1,
            nw: pName.get(newTop) || newTop,
          });
        }
      }
    }
    console.log(`\n窗口 ${WIN} 天：${diff}/${tot} 个组合的「窗口内最快者」≠ 官方终身榜#1`);
    for (const e of examples) {
      console.log(`   ${e.key.padEnd(14)} 官方#1=${String(e.off).slice(0, 20).padEnd(20)}（窗口内排第 ${e.offR}）→ 窗口#1=${String(e.nw).slice(0, 20)}`);
    }
  }

  /* ── N2. 若用「窗口内名次」重算 M5，Top25 变化多大 ── */
  console.log('\n═══════ N2. 用窗口名次重算 M5（窗口=365天）的榜单变化 ═══════');
  {
    const WIN = 365;
    const buckets = new Map();
    for (const [kk, val] of life) {
      const parts = kk.split('|');
      const pid = parts[0], ev = parts[1], tr = parts[2];
      const lc = lastByEv.get(pid + '|' + ev);
      if (lc == null || SNAPSHOT_DAY - lc > WIN) continue;
      const key = ev + '|' + tr;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push({ pid, val });
    }
    const newRank = new Map();   // pid|ev|tr → 新名次
    for (const [key, arr] of buckets) {
      arr.sort((a, b) => a.val - b.val);
      arr.forEach((a, i) => newRank.set(a.pid + '|' + key, i + 1));
    }
    const build = (useNew) => {
      const per = new Map();
      for (const x of ranks) {
        if (!ACTIVE.includes(x.ev)) continue;
        const key = x.ev + '|' + x.tr;
        let wr = x.wr;
        if (useNew) {
          const nr = newRank.get(x.pid + '|' + key);
          if (nr == null) continue;      // 窗口内没成绩 → 不计
          wr = nr;
        } else {
          if (x.wr > 100) continue;
        }
        const lc = lastByEv.get(x.pid + '|' + x.ev);
        const gap = lc == null ? 99 : (SNAPSHOT_DAY - lc) / 365.25;
        const w = W[x.ev] == null ? FLOOR : W[x.ev];
        const s = w * Math.pow(wr, -1) * decayOf(gap);
        if (s <= 0) continue;
        let p = per.get(x.pid);
        if (!p) { p = { name: pName.get(x.pid) || x.pid, m5: 0 }; per.set(x.pid, p); }
        p.m5 += s;
      }
      return [...per.values()].sort((a, b) => b.m5 - a.m5);
    };
    const base = build(false);
    const nw = build(true);
    const setB = new Set(base.slice(0, 25).map((p) => p.name));
    console.log(`现状 Top25 ∩ 窗口口径 Top25 = ${nw.slice(0, 25).filter((p) => setB.has(p.name)).length}/25`);
    console.log('现状 Top10 : ' + base.slice(0, 10).map((p) => p.name.split(' ')[0]).join(' | '));
    console.log('窗口 Top10 : ' + nw.slice(0, 10).map((p) => p.name.split(' ')[0]).join(' | '));
    console.log('窗口口径人数: ' + num(nw.length) + '（现状 ' + num(base.length) + '）');
    console.log('窗口口径总量: ' + F(nw.reduce((a, p) => a + p.m5, 0)));
  }

  /* ── O. 双轨去重 ── */
  console.log('\n═══════ O. single/average 双轨去重方案对比═══');
  {
    const build = (tw) => {
      const per = new Map();
      for (const x of ranks) {
        if (x.wr > 100) continue;
        if (!ACTIVE.includes(x.ev)) continue;
        const lc = lastByEv.get(x.pid + '|' + x.ev);
        const gap = lc == null ? 99 : (SNAPSHOT_DAY - lc) / 365.25;
        const w = W[x.ev] == null ? FLOOR : W[x.ev];
        const s = w * Math.pow(x.wr, -1) * decayOf(gap) * (tw[x.tr] || 0);
        if (s <= 0) continue;
        let p = per.get(x.pid);
        if (!p) { p = { name: pName.get(x.pid) || x.pid, m5: 0 }; per.set(x.pid, p); }
        p.m5 += s;
      }
      return [...per.values()].sort((a, b) => b.m5 - a.m5);
    };
    const variants = [
      { label: '双轨各1.0（现状）', tw: { single: 1, average: 1 } },
      { label: '双轨各0.5', tw: { single: 0.5, average: 0.5 } },
      { label: '只单次', tw: { single: 1, average: 0 } },
      { label: '只平均', tw: { single: 0, average: 1 } },
    ];
    const base = build(variants[0].tw);
    const setB = new Set(base.slice(0, 25).map((p) => p.name));
    for (const v of variants) {
      const arr = build(v.tw);
      const ov = arr.slice(0, 25).filter((p) => setB.has(p.name)).length;
      console.log(`${v.label.padEnd(18)} 人数 ${String(arr.length).padStart(5)}  Top25∩现状 ${String(ov).padStart(2)}/25  Top6=${arr.slice(0, 6).map((p) => p.name.split(' ')[0]).join('/')}`);
    }
  }

  /* ── P. w_e 双重衰减 ── */
  console.log('\n═══════ P. w_e 与 γ 的「双重衰减」量化 ═══════');
  {
    /* 对每个组合，贡献 = w_e × r^-1：冷门项目 + 靠后名次 → 接近 0 */
    const combo = new Map();
    for (const x of ranks) {
      if (x.wr > 100) continue;
      if (!ACTIVE.includes(x.ev)) continue;
      const key = x.ev + '|' + x.tr;
      const w = W[x.ev] == null ? FLOOR : W[x.ev];
      const c = w * Math.pow(x.wr, -1);
      if (!combo.has(key)) combo.set(key, { sum: 0, n: 0, max: 0 });
      const o = combo.get(key);
      o.sum += c; o.n++; if (c > o.max) o.max = c;
    }
    const rows = [...combo.entries()].map(([k, v]) => ({ k, avg: v.sum / v.n, max: v.max })).sort((a, b) => b.avg - a.avg);
    console.log('组合\t平均贡献(#1值)\t最高贡献');
    for (const r of rows.slice(0, 8)) console.log(`${r.k.padEnd(14)}\t${F(r.avg)}\t${F(r.max)}`);
    console.log('...');
    for (const r of rows.slice(-8)) console.log(`${r.k.padEnd(14)}\t${F(r.avg)}\t${F(r.max)}`);
    const ratio = rows[0].avg / rows[rows.length - 1].avg;
    console.log(`最强/最弱组合的单名次贡献比 = ${ratio.toFixed(1)}×（同在深度100内）`);
  }
})();

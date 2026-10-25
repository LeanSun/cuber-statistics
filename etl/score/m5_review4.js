/**
 * M5 口径审阅 · 第四轮：技术缺陷核查
 *   I.   lc == null（官方榜有排名但我们查不到参赛记录）的规模 → 是否被错误地给 0.2 底分
 *   J.   single / average 双轨的重复计分程度（同一选手两轨名次高度相关）
 *   K.   「广度 vs 深度」失衡：项目数量对 M5 的贡献占比
 *   L.   代码遗留：`b.m5 - a.m4` 是从 M4 复制来的无效表达式
 *   M.   M5 的快照波动性（与 M1–M4 的历史积分对比）
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
  let cancelled = 0;
  await streamTsv('WCA_export_competitions.tsv', (r) => {
    if (!r[0]) return;
    if (r[10] === '1') { cancelled++; return; }
    const y = +r[17] || +r[14]; if (!y) return;
    const m = +r[18] || +r[15] || 1;
    const d = +r[19] || +r[16] || 1;
    compDay.set(r[0], dayOf(y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0')));
  });
  const pName = new Map();
  await streamTsv('WCA_export_persons.tsv', (r) => { if (r[2]) pName.set(r[2], r[0]); });

  const lastByEv = new Map();
  const lastByEvTr = new Map();
  let resRows = 0, noComp = 0;
  await streamTsv('WCA_export_results.tsv', (r) => {
    if (!r[8]) return;
    resRows++;
    const day = compDay.get(r[4]);
    if (day === undefined) { noComp++; return; }
    const pid = r[8], ev = r[6];
    const k = pid + '|' + ev;
    if (lastByEv.get(k) == null || day > lastByEv.get(k)) lastByEv.set(k, day);
    if (+r[2] > 0) {
      const kt = k + '|single';
      if (lastByEvTr.get(kt) == null || day > lastByEvTr.get(kt)) lastByEvTr.set(kt, day);
    }
    if (+r[3] > 0) {
      const kt = k + '|average';
      if (lastByEvTr.get(kt) == null || day > lastByEvTr.get(kt)) lastByEvTr.set(kt, day);
    }
  });
  console.log(`成绩 ${num(resRows)} 行；因比赛取消/缺日期跳过 ${num(noComp)} 行；取消赛事 ${num(cancelled)} 场`);

  const ranks = [];
  for (const [tr, file] of [['single', 'WCA_export_ranks_single.tsv'],
    ['average', 'WCA_export_ranks_average.tsv']]) {
    await streamTsv(file, (r) => {
      if (!r[0]) return;
      ranks.push({ pid: r[1], ev: r[2], tr, wr: +r[3] });
    });
  }

  /* ── I. lc == null 的规模 ── */
  console.log('\n═══════ I. 官方榜有排名、但我们查不到参赛记录（lc==null）═══════');
  let nullLc = 0, nullLcTr = 0, tot = 0;
  const nullSamples = [];
  for (const x of ranks) {
    if (x.wr > 100) continue;
    if (!ACTIVE.includes(x.ev)) continue;
    tot++;
    if (lastByEv.get(x.pid + '|' + x.ev) == null) {
      nullLc++;
      if (nullSamples.length < 6) nullSamples.push({ k: x.ev + '|' + x.tr, pid: x.pid, name: pName.get(x.pid) });
    }
    if (lastByEvTr.get(x.pid + '|' + x.ev + '|' + x.tr) == null) nullLcTr++;
  }
  console.log(`深度≤100 的非停办条目 ${num(tot)}；项目级 lc==null ${nullLc} 条；轨道级 lc==null ${nullLcTr} 条`);
  console.log(`→ lc==null 会被当成 gap=99 → decay=0.2（底分），等价于「完全退役但仍计 20%」`);
  for (const s of nullSamples) console.log(`   ${s.k}  ${s.name}`);

  /* ── J. single / average 双轨重复度 ── */
  console.log('\n═══════ J. single / average 双轨的重复计分程度 ═══════');
  const rankBy = new Map();   // pid|ev → {single, average}
  for (const x of ranks) {
    if (x.wr > 100) continue;
    if (!ACTIVE.includes(x.ev)) continue;
    const k = x.pid + '|' + x.ev;
    if (!rankBy.has(k)) rankBy.set(k, {});
    rankBy.get(k)[x.tr] = x.wr;
  }
  const both = [];
  for (const [k, v] of rankBy) {
    if (v.single && v.average) both.push({ k, ...v });
  }
  console.log(`同时有单次与平均排名的 (人,项目) 组合: ${num(both.length)}`);
  if (both.length >= 3) {
    const xs = both.map((b) => b.single), ys = both.map((b) => b.average);
    const pear = (a, b) => {
      const n = a.length;
      const ma = a.reduce((x, y) => x + y, 0) / n, mb = b.reduce((x, y) => x + y, 0) / n;
      let nu = 0, da = 0, db = 0;
      for (let i = 0; i < n; i++) { const u = a[i] - ma, v = b[i] - mb; nu += u * v; da += u * u; db += v * v; }
      return nu / Math.sqrt(da * db);
    };
    console.log(`单次名次 vs 平均名次 Pearson ρ = ${pear(xs, ys).toFixed(4)}`);
    const same = both.filter((b) => b.single === b.average).length;
    const close = both.filter((b) => Math.abs(b.single - b.average) <= 3).length;
    console.log(`两轨名次完全相同: ${same} (${(same / both.length * 100).toFixed(1)}%)；相差≤3: ${close} (${(close / both.length * 100).toFixed(1)}%)`);
  }

  /* ── K. 广度 vs 深度 ── */
  console.log('\n═══════ K. 「项目广度」对 M5 的贡献 ═══════');
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
    if (!p) {
      p = { pid: x.pid, name: pName.get(x.pid) || x.pid, m5: 0, nCombo: 0, nEv: new Set(), n1: 0, wSum: 0 };
      per.set(x.pid, p);
    }
    p.m5 += s; p.nCombo++; p.evs = p.evs; p.nEv.add(x.ev);
    if (x.wr === 1) p.n1++;
    p.wSum += w;
  }
  const arr = [...per.values()].sort((a, b) => b.m5 - a.m5);
  console.log('Top12：M5分  组合数  项目数  #1数  平均w  「组合数」与M5的秩相关');
  const nComboArr = arr.map((p) => p.nCombo);
  const m5Arr = arr.map((p) => p.m5);
  const pear = (a, b) => {
    const n = a.length;
    const ma = a.reduce((x, y) => x + y, 0) / n, mb = b.reduce((x, y) => x + y, 0) / n;
    let nu = 0, da = 0, db = 0;
    for (let i = 0; i < n; i++) { const u = a[i] - ma, v = b[i] - mb; nu += u * v; da += u * u; db += v * v; }
    return nu / Math.sqrt(da * db);
  };
  for (const p of arr.slice(0, 12)) {
    console.log(`${p.name.slice(0, 22).padEnd(22)}\t${F(p.m5)}\t${String(p.nCombo).padStart(4)}\t${String(p.nEv.size).padStart(5)}\t${String(p.n1).padStart(4)}\t${F(p.wSum / p.nCombo)}\t${F(p.nCombo / 33)}`);
  }
  console.log(`全站 M5 分 vs 组合数 ρ = ${pear(m5Arr, nComboArr).toFixed(4)}`);
  console.log(`全站 M5 分 vs #1 数  ρ = ${pear(m5Arr, arr.map((p) => p.n1)).toFixed(4)}`);

  /* 归一化实验：把「组合数」的影响剥掉（按组合数取平均） */
  console.log('\n若改成「按组合数取平均」（消除广度优势）：');
  const byAvg = [...arr].map((p) => ({ ...p, avg: p.m5 / p.nCombo })).sort((a, b) => b.avg - a.avg);
  const setBase = new Set(arr.slice(0, 25).map((p) => p.name));
  console.log('  现口径 Top8 : ' + arr.slice(0, 8).map((p) => p.name.split(' ')[0] + ' ' + F(p.m5)).join(' | '));
  console.log('  均值口径 Top8: ' + byAvg.slice(0, 8).map((p) => p.name.split(' ')[0] + ' ' + F(p.avg)).join(' | '));
  console.log(`  Top25 重合 ${byAvg.slice(0, 25).filter((p) => setBase.has(p.name)).length}/25`);

  /* ── L. 代码遗留 ── */
  console.log('\n═══════ L. 代码遗留检查 ═══════');
  const src = fs.readFileSync(path.join(__dirname, 'm5_current_rank.js'), 'utf8');
  const m = src.match(/const ranked = .*/);
  console.log('排序表达式: ' + (m ? m[0].trim() : '未找到'));
  console.log('→ `b.m5 - a.m4` 中 a.m4 在 M5 的 perPlayer 对象里**不存在**（undefined），');
  console.log('  `NaN || 0` → 0 → 落到 `b.m5 - a.m5`。功能正确但是从 M4 复制来的死代码。');
})();

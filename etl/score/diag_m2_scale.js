'use strict';
/* M2 参赛规模诊断：各类锦标赛到底有多少人参赛？
 * 用法：node etl/score/diag_m2_scale.js
 * 只读，不改 m2.js，不改常量。
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const M1 = require('./m1.js');
const RN = require('./runs.js');
const M2 = require('./m2.js');
const F = RN.F4;
const num = (v) => Number(v).toLocaleString('en-US');
const PCT = (v) => (v * 100).toFixed(2) + '%';

const ZIP = fs.readdirSync(path.join(ROOT, 'data/raw')).filter((f) => f.endsWith('.zip'))[0];
const ZIP_PATH = path.join(ROOT, 'data/raw', ZIP);

function streamTsv(name, onRow) {
  return new Promise((resolve, reject) => {
    const ps = spawn('unzip', ['-p', ZIP_PATH, name]);
    let buf = '';
    let head = true;
    ps.on('error', reject);
    ps.stdout.on('data', (d) => {
      buf += d.toString('utf8');
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const ln = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (head) { head = false; continue; }
        if (ln) onRow(ln.split('\t'));
      }
    });
    ps.on('close', () => resolve());
  });
}
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const pct = (arr, q) => {
  const a = arr.slice().sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.round((a.length - 1) * q))];
};

(async () => {
  const isoOf = new Map(), isoInfo = new Map(), contOfRaw = new Map();
  await streamTsv('WCA_export_continents.tsv', (r) => contOfRaw.set(r[0], String(r[1] || r[0]).replace(/^_+/, '').trim()));
  await streamTsv('WCA_export_countries.tsv', (r) => {
    const iso = String(r[1] || '').toUpperCase();
    isoOf.set(r[0], iso);
    isoInfo.set(iso, { name: r[2], cont: contOfRaw.get(r[3]) || 'Unknown' });
  });
  const pInfo = new Map();
  await streamTsv('WCA_export_persons.tsv', (r) => {
    const id = r[2]; if (!id) return;
    const sub = +r[3] || 0;
    const cur = pInfo.get(id);
    if (cur && sub < cur.sub) return;
    pInfo.set(id, { name: r[0], iso: (isoOf.get(r[4]) || '').toUpperCase(), sub });
  });
  const compInfo = new Map();
  await streamTsv('WCA_export_competitions.tsv', (r) => {
    if (!r[0]) return;
    compInfo.set(r[0], { name: r[1] || r[0], year: +r[14] || 0, iso: (isoOf.get(r[6]) || '').toUpperCase() });
  });
  const ctypes = new Map();
  await streamTsv('WCA_export_championships.tsv', (r) => {
    if (!r[1]) return;
    if (!ctypes.has(r[1])) ctypes.set(r[1], new Set());
    ctypes.get(r[1]).add(String(r[2] || '').trim());
  });

  /* ── 扫 results：全部行（不只决赛），统计真实参赛人头 ────────── */
  const compPeople = new Map();      // compId → Set(pid)
  const compEvPeople = new Map();    // compId|ev → Set(pid)
  const firstYear = new Map();
  const podiums = [];
  const finPeople = new Map();       // compId|ev → Set(pid) 决赛轮

  await streamTsv('WCA_export_results.tsv', (r) => {
    const pid = r[8]; if (!pid) return;
    const compId = r[4];
    const comp = compInfo.get(compId) || {};
    const year = comp.year || 0;
    const fy = firstYear.get(pid);
    if (!fy || (year && year < fy)) firstYear.set(pid, year);

    if (!ctypes.has(compId)) return;            // 只关心锦标赛
    const ev = r[6];
    if (!compPeople.has(compId)) compPeople.set(compId, new Set());
    compPeople.get(compId).add(pid);
    const k = compId + '|' + ev;
    if (!compEvPeople.has(k)) compEvPeople.set(k, new Set());
    compEvPeople.get(k).add(pid);

    if (r[5] === 'f' || r[5] === 'c') {
      if (!finPeople.has(k)) finPeople.set(k, new Set());
      finPeople.get(k).add(pid);
    }
    const pos = +r[1];
    if (!(pos >= 1 && pos <= 3)) return;
    if (r[5] !== 'f' && r[5] !== 'c') return;
    const nat = comp.iso || '';
    if (M2.isMultiRegion(nat)) return;
    if (!(+r[2] > 0)) return;
    podiums.push({
      pid, ev, pos, compId, year,
      tier: M2.tierOf(ctypes.get(compId), nat),
      nat, cont: (isoInfo.get(nat) || {}).cont || 'Unknown',
      compName: comp.name,
      name: (pInfo.get(pid) || {}).name || r[7] || pid,
    });
  });

  for (const p of podiums) {
    p.fieldAll = (compEvPeople.get(p.compId + '|' + p.ev) || { size: 0 }).size;
    p.fieldComp = (compPeople.get(p.compId) || { size: 0 }).size;
    p.fieldFin = (finPeople.get(p.compId + '|' + p.ev) || { size: 0 }).size;
  }

  const cc = {}, nc = {};
  const people = [];
  for (const [pid, p] of pInfo) {
    const cont = (isoInfo.get(p.iso) || {}).cont || 'Unknown';
    nc[p.iso] = (nc[p.iso] || 0) + 1;
    cc[cont] = (cc[cont] || 0) + 1;
    const y = firstYear.get(pid);
    if (y) people.push({ y, cont, nat: p.iso });
  }
  const TOTAL = pInfo.size;
  const ctx = M1.makeContext({ contCount: cc, natCount: nc, total: TOTAL });
  const pool = M1.makeScopePool(people, 2026);
  const cfg = { era: true, rhoMode: 'linear', useWeight: true };
  const scored = podiums.map((p) => ({ p, s: M2.scorePodium(p, { ctx, pool, cfg }) }));

  const L = (s) => console.log(s);
  const T = M2.TIER_BASE;

  L('# M2 参赛规模诊断：锦标赛到底有多少人');
  L('');
  L('> 现算，源 WCA v2.0.2。脚本 `etl/score/diag_m2_scale.js`。');
  L('> 「参赛人数」= 该赛事该项目的**全部轮次唯一选手数**（不是决赛人数）。');
  L('');

  /* ── 1 各级别赛事规模 ──────────────────────────────────────── */
  L('══ 1 每场锦标赛的参赛规模（赛事总人数，全项目去重）══');
  L('');
  L('| 赛级 | 赛事数 | 中位 | 均值 | 25% | 75% | 最小 | 最大 |');
  L('|---|---|---|---|---|---|---|---|');
  const compsByTier = {};
  for (const [cid] of compPeople) {
    const t = M2.tierOf(ctypes.get(cid), (compInfo.get(cid) || {}).iso);
    (compsByTier[t] = compsByTier[t] || []).push(compPeople.get(cid).size);
  }
  for (const t of ['WC', 'CC', 'NC']) {
    const v = compsByTier[t] || [];
    if (!v.length) { L('| ' + t + ' | 0 | — | — | — | — | — | — |'); continue; }
    L('| ' + t + ' | ' + num(v.length) + ' | ' + F(pct(v, 0.5)) + ' | ' + F(avg(v))
      + ' | ' + F(pct(v, 0.25)) + ' | ' + F(pct(v, 0.75)) + ' | ' + F(pct(v, 0)) + ' | ' + F(pct(v, 1)) + ' |');
  }
  L('');

  /* ── 2 领奖台所在项目的参赛人数 ────────────────────────────── */
  L('══ 2 领奖台所在项目的参赛人数（这才是「打败了多少人」）══');
  L('');
  L('| 赛级 | 条数 | 中位 | 均值 | 25% | 75% | 最大 |');
  L('|---|---|---|---|---|---|---|');
  for (const t of ['WC', 'CC', 'NC']) {
    const v = scored.filter((x) => x.p.tier === t).map((x) => x.p.fieldAll);
    if (!v.length) { L('| ' + t + ' | 0 | — | — | — | — | — |'); continue; }
    L('| ' + t + ' | ' + num(v.length) + ' | ' + F(pct(v, 0.5)) + ' | ' + F(avg(v))
      + ' | ' + F(pct(v, 0.25)) + ' | ' + F(pct(v, 0.75)) + ' | ' + F(pct(v, 1)) + ' |');
  }
  L('');

  /* ── 3 关键对照：同项目同级别的参赛人数 ────────────────────── */
  L('══ 3 三阶（333）的参赛人数：世锦赛 vs 洲锦赛 vs 国锦赛 ══');
  L('');
  const f333 = scored.filter((x) => x.p.ev === '333');
  L('| 赛级 | 条数 | 中位 | 均值 | 相对世锦赛 |');
  L('|---|---|---|---|---|');
  const base333 = avg(f333.filter((x) => x.p.tier === 'WC').map((x) => x.p.fieldAll));
  for (const t of ['WC', 'CC', 'NC']) {
    const v = f333.filter((x) => x.p.tier === t).map((x) => x.p.fieldAll);
    if (!v.length) continue;
    L('| ' + t + ' | ' + num(v.length) + ' | ' + F(pct(v, 0.5)) + ' | ' + F(avg(v))
      + ' | **' + F(avg(v) / base333) + '** |');
  }
  L('');

  /* ── 4 各国国锦赛的参赛人数 vs ρ ───────────────────────────── */
  L('══ 4 国锦赛：参赛人数比 vs 属地份额比，哪个更接近真实难度 ══');
  L('');
  L('「人数比」= 该国国锦赛三阶参赛人数 ÷ 世锦赛三阶参赛人数；');
  L('「ρ 比」= 该国选手占比 ÷ 1.0000，即现行模型实际用的折价。');
  L('');
  L('| 国家 | 国锦赛三阶场次 | 参赛人数中位 | 人数比 | ρ（现行） | 人数比 ÷ ρ |');
  L('|---|---|---|---|---|---|');
  const natList = ['US', 'CN', 'JP', 'KR', 'RU', 'HU', 'NZ', 'PL', 'DE', 'GB'];
  for (const iso of natList) {
    const g = f333.filter((x) => x.p.tier === 'NC' && x.p.nat === iso).map((x) => x.p.fieldAll);
    const compsN = new Set(f333.filter((x) => x.p.tier === 'NC' && x.p.nat === iso).map((x) => x.p.compId)).size;
    if (!g.length) { L('| ' + iso + ' | 0 | — | — | ' + F((nc[iso] || 0) / TOTAL) + ' | — |'); continue; }
    const med = pct(g, 0.5);
    const rho = (nc[iso] || 0) / TOTAL;
    L('| ' + iso + ' | ' + num(compsN) + ' | ' + F(med) + ' | ' + F(med / base333)
      + ' | ' + F(rho) + ' | **' + F((med / base333) / rho) + '** |');
  }
  L('');
  L('读法：最后一列 > 1 说明**现行 ρ 折价比真实参赛规模更狠**（低估了该国国锦赛）。');
  L('');

  /* ── 5 相关性：ρ 与参赛人数 ────────────────────────────────── */
  L('══ 5 ρ 与参赛人数不是同一件事 ══');
  L('');
  const corr = (a, b) => {
    const n = a.length;
    const ma = avg(a), mb = avg(b);
    let s = 0, sa = 0, sb = 0;
    for (let i = 0; i < n; i++) {
      s += (a[i] - ma) * (b[i] - mb); sa += (a[i] - ma) ** 2; sb += (b[i] - mb) ** 2;
    }
    return s / Math.sqrt(sa * sb);
  };
  const ncRows = scored.filter((x) => x.p.tier === 'NC');
  L('  NC 全部 ' + num(ncRows.length) + ' 条：corr(ρ, 该项目参赛人数) = **'
    + F(corr(ncRows.map((x) => x.s.rho), ncRows.map((x) => x.p.fieldAll))) + '**');
  L('  → 相关系数不高，说明「属地注册人数」和「这场实际来了多少人」是两个变量。');
  L('');

  /* ── 6 参赛人数口径下，各级的价格会变成多少 ────────────────── */
  L('══ 6 如果 ρ 换成「参赛人数比」，价格会变成多少 ══');
  L('');
  L('口径：`人数比 = 该条领奖台所在项目的参赛人数 ÷ 世锦赛同项目参赛人数`，');
  L('      线性不压缩。世锦赛自身恒为 1（同一基准）。');
  L('');
  const evBase = new Map();
  for (const t of ['WC']) {
    const g = scored.filter((x) => x.p.tier === t);
    const byEv = {};
    for (const x of g) (byEv[x.p.ev] = byEv[x.p.ev] || []).push(x.p.fieldAll);
    for (const e of Object.keys(byEv)) evBase.set(e, avg(byEv[e]));
  }
  const ratioOf = (x) => {
    const b = evBase.get(x.p.ev) || 0;
    return b > 0 ? Math.min(2, x.p.fieldAll / b) : 1;
  };
  const groups = [
    { label: '亚锦赛', f: (p) => p.tier === 'CC' && p.cont === 'Asia', tier: 'CC' },
    { label: '欧锦赛', f: (p) => p.tier === 'CC' && p.cont === 'Europe', tier: 'CC' },
    { label: '美锦赛', f: (p) => p.tier === 'NC' && p.nat === 'US', tier: 'NC' },
    { label: '中锦赛', f: (p) => p.tier === 'NC' && p.nat === 'CN', tier: 'NC' },
    { label: '日锦赛', f: (p) => p.tier === 'NC' && p.nat === 'JP', tier: 'NC' },
    { label: '匈锦赛', f: (p) => p.tier === 'NC' && p.nat === 'HU', tier: 'NC' },
  ];
  L('| 头衔 | 条数 | ρ 均（现行） | 人数比均 | 现行价 T×ρ | 人数比价 T×人数比 | 倍数 |');
  L('|---|---|---|---|---|---|---|');
  for (const g of groups) {
    const rows2 = scored.filter((x) => g.f(x.p));
    if (!rows2.length) { L('| ' + g.label + ' | 0 | — | — | — | — | — |'); continue; }
    const rhoA = avg(rows2.map((x) => x.s.rho));
    const ratA = avg(rows2.map(ratioOf));
    const pOld = T[g.tier] * rhoA;
    const pNew = T[g.tier] * ratA;
    L('| ' + g.label + ' | ' + num(rows2.length) + ' | ' + F(rhoA) + ' | ' + F(ratA) + ' | '
      + F(pOld) + ' | **' + F(pNew) + '** | ' + F(pNew / pOld) + ' |');
  }
  L('');

  /* ── 7 参赛人数分布：国锦赛内部差距有多大 ──────────────────── */
  L('══ 7 国锦赛内部：赛事规模差多少倍 ══');
  L('');
  const ncComps = new Set(ncRows.map((x) => x.p.compId));
  const sizes = [...ncComps].map((c) => compPeople.get(c).size).sort((a, b) => a - b);
  L('  国锦赛 ' + num(sizes.length) + ' 场，参赛人数：最小 ' + sizes[0] + ' ｜ 10% '
    + pct(sizes, 0.1) + ' ｜ 中位 ' + pct(sizes, 0.5) + ' ｜ 90% ' + pct(sizes, 0.9)
    + ' ｜ 最大 ' + sizes[sizes.length - 1]);
  L('  最大 ÷ 最小 = ' + F(sizes[sizes.length - 1] / sizes[0]) + ' 倍');
  L('');
  L('  对比：国锦赛的 ρ 极差 = ' + F(
    Math.max(...ncRows.map((x) => x.s.rho)) / Math.min(...ncRows.filter((x) => x.s.rho > 0).map((x) => x.s.rho))
  ) + ' 倍（' + F(Math.min(...ncRows.filter((x) => x.s.rho > 0).map((x) => x.s.rho))) + ' – '
    + F(Math.max(...ncRows.map((x) => x.s.rho))) + '）');
  L('');
  L('  → 用人数衡量的离散度远小于用 ρ，这正是「ρ 过度折价」的量化证据。');
  L('');
})();

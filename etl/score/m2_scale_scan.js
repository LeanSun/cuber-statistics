'use strict';
/* M2 参赛规模折算：参数扫描
 * 用法：node etl/score/m2_scale_scan.js
 * 公式：ρ_new = ρ_属地^(1-k) × ratio^k
 *   ratio = 该场该项目参赛人数 ÷ 世锦赛同项目平均参赛人数
 *   k = 0 → 现行；k = 1 → 纯参赛人数
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

  const compEvPeople = new Map();
  const firstYear = new Map();
  const podiums = [];
  await streamTsv('WCA_export_results.tsv', (r) => {
    const pid = r[8]; if (!pid) return;
    const compId = r[4];
    const comp = compInfo.get(compId) || {};
    const year = comp.year || 0;
    const fy = firstYear.get(pid);
    if (!fy || (year && year < fy)) firstYear.set(pid, year);
    if (!ctypes.has(compId)) return;
    const ev = r[6];
    const k = compId + '|' + ev;
    if (!compEvPeople.has(k)) compEvPeople.set(k, new Set());
    compEvPeople.get(k).add(pid);

    const pos = +r[1];
    if (!(pos >= 1 && pos <= 3)) return;
    if (r[5] !== 'f' && r[5] !== 'c') return;
    const nat = comp.iso || '';
    if (M2.isMultiRegion(nat)) return;
    if (!(+r[2] > 0)) return;
    const types = ctypes.get(compId);
    const tArr = [...types].map((t) => String(t).toLowerCase());
    const hasGC = tArr.includes('greater_china');
    const hasCont = tArr.some((t) => t.charAt(0) === '_') || tArr.includes('world');
    podiums.push({
      pid, ev, pos, compId, year,
      tier: M2.tierOf(types, nat),
      nat, cont: (isoInfo.get(nat) || {}).cont || 'Unknown',
      compName: comp.name, isGC: hasGC, pureGC: hasGC && !hasCont,
      name: (pInfo.get(pid) || {}).name || r[7] || pid,
    });
  });
  for (const p of podiums) p.fieldAll = (compEvPeople.get(p.compId + '|' + p.ev) || { size: 0 }).size;

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

  const base = podiums.map((p) => {
    const s = M2.scorePodium(p, { ctx, pool, cfg });
    return { p, s, ratio: 1 };
  });

  /* 世锦赛同项目参考人数 */
  const evRef = new Map();
  const wcAll = base.filter((x) => x.p.tier === 'WC');
  const byEv = {};
  for (const x of wcAll) (byEv[x.p.ev] = byEv[x.p.ev] || []).push(x.p.fieldAll);
  for (const e of Object.keys(byEv)) evRef.set(e, avg(byEv[e]));
  const globalRef = avg(wcAll.map((x) => x.p.fieldAll));
  for (const x of base) {
    const ref = evRef.get(x.p.ev) || globalRef;
    x.ratio = (ref > 0 ? x.p.fieldAll / ref : 1);
    x.ref = ref;
  }

  const L = (s) => console.log(s);
  const T = M2.TIER_BASE;

  L('# M2 参赛规模折算：参数扫描');
  L('');
  L('> 现算，脚本 `etl/score/m2_scale_scan.js`。');
  L('> 公式：ρ_new = ρ_属地^(1-k) × ratio^k，ratio = 该项目参赛人数 ÷ 世锦赛同项目均值。');
  L('> k=0 是现行定稿；k 越大越看重「这场实际来了多少人」。');
  L('');

  /* ── 参考人数 ──────────────────────────────────────────────── */
  L('══ 0 世锦赛各项目的参考参赛人数 ══');
  L('');
  const evList = [...evRef.entries()].sort((a, b) => b[1] - a[1]);
  L('| 项目 | 世锦赛领奖台条数 | 平均参赛人数 |');
  L('|---|---|---|');
  for (const [ev, v] of evList) {
    const n = wcAll.filter((x) => x.p.ev === ev).length;
    L('| ' + ev + ' | ' + n + ' | ' + F(v) + ' |');
  }
  L('');
  L('全局参考（有项目未在世锦赛出现时回退用）：' + F(globalRef) + ' 人');
  L('');

  /* ── 扫描 ─────────────────────────────────────────────────── */
  const KS = process.argv[2]
    ? process.argv[2].split(',').map(Number).filter((x) => !isNaN(x))
    : [0, 0.2, 0.3, 0.4, 0.5, 0.6, 0.8, 1.0];

  const run = (k) => {
    const rows = base.map((x) => {
      const rhoNew = Math.pow(Math.max(1e-9, x.s.rho), 1 - k) * Math.pow(x.ratio, k);
      return { ...x, rhoNew, scoreNew: x.s.score * (rhoNew / x.s.rho) };
    });
    const byP = new Map();
    for (const r of rows) {
      const a = byP.get(r.p.pid) || { pid: r.p.pid, name: r.p.name, nat: r.p.nat, total: 0, n: 0 };
      a.total += r.scoreNew; a.n += 1;
      byP.set(r.p.pid, a);
    }
    const list = [...byP.values()].sort((a, b) => b.total - a.total);
    const total = list.reduce((s, x) => s + x.total, 0);
    const share = { WC: 0, CC: 0, NC: 0 };
    const cnt = { WC: 0, CC: 0, NC: 0 };
    for (const r of rows) { share[r.p.tier] += r.scoreNew; cnt[r.p.tier] += 1; }
    return { k, rows, list, total, share, cnt };
  };
  const results = KS.map(run);
  const r0 = results[0];

  /* ── 1 总量与赛级占比 ─────────────────────────────────────── */
  L('══ 1 总量与赛级占比 ══');
  L('');
  L('| k | 总量 | vs 现行 | 世界占比 | 洲际占比 | 全国占比 | 中位单人 |');
  L('|---|---|---|---|---|---|---|');
  for (const r of results) {
    const med = r.list[Math.floor(r.list.length / 2)].total;
    L('| ' + String(r.k) + ' | ' + F(r.total) + ' | ' + (r.k === 0 ? '—' : F(r.total / r0.total))
      + ' | ' + PCT(r.share.WC / r.total) + ' | ' + PCT(r.share.CC / r.total)
      + ' | ' + PCT(r.share.NC / r.total) + ' | ' + F(med) + ' |');
  }
  L('');

  /* ── 2 头衔价格 ───────────────────────────────────────────── */
  L('══ 2 各头衔的价格（值几个世锦赛）══');
  L('');
  const titles = [
    { label: '亚锦赛', f: (p) => p.tier === 'CC' && p.cont === 'Asia', tier: 'CC' },
    { label: '欧锦赛', f: (p) => p.tier === 'CC' && p.cont === 'Europe', tier: 'CC' },
    { label: '美锦赛', f: (p) => p.tier === 'NC' && p.nat === 'US', tier: 'NC' },
    { label: '日锦赛', f: (p) => p.tier === 'NC' && p.nat === 'JP', tier: 'NC' },
    { label: '韩锦赛', f: (p) => p.tier === 'NC' && p.nat === 'KR', tier: 'NC' },
    { label: '匈锦赛', f: (p) => p.tier === 'NC' && p.nat === 'HU', tier: 'NC' },
    { label: '新锦赛', f: (p) => p.tier === 'NC' && p.nat === 'NZ', tier: 'NC' },
    { label: '国锦赛中位', f: (p) => p.tier === 'NC', tier: 'NC' },
  ];
  L('| 头衔 | ' + KS.map((k) => 'k=' + String(k)).join(' | ') + ' |');
  L('|---|' + KS.map(() => '---').join('|') + '|');
  for (const t of titles) {
    const cells = results.map((r) => {
      const g = r.rows.filter((x) => t.f(x.p));
      if (!g.length) return '—';
      if (t.label === '国锦赛中位') {
        const a = g.map((x) => x.rhoNew).sort((x, y) => x - y);
        return F(T[t.tier] * a[Math.floor(a.length / 2)]);
      }
      return F(T[t.tier] * avg(g.map((x) => x.rhoNew)));
    });
    L('| ' + t.label + ' | ' + cells.join(' | ') + ' |');
  }
  L('');

  /* ── 3 Top 15 变动 ────────────────────────────────────────── */
  const cand = KS.length >= 3
    ? [KS[0], KS[Math.floor(KS.length / 2)], KS[KS.length - 1]]
    : [KS[0], KS[KS.length - 1]];
  L('══ 3 Top 15（k=0 现行 / k=0.3 / k=0.5）══');
  L('');
  const maps = {};
  for (const k of cand) {
    const r = results.find((x) => x.k === k);
    maps[k] = new Map();
    r.list.forEach((x, i) => maps[k].set(x.pid, i + 1));
  }
  L('| # | ' + cand.map((k) => 'k=' + k + ' 名次 | 选手 | M2').join(' | ') + ' |');
  L('|---|' + cand.map(() => '---|---|---').join('|') + '|');
  const order = results.find((x) => x.k === 0.3).list.slice(0, 15).map((x) => x.pid);
  for (const pid of order) {
    const parts = [];
    for (const k of cand) {
      const r = results.find((x) => x.k === k);
      const rk = maps[k].get(pid);
      const it = rk ? r.list[rk - 1] : null;
      parts.push(rk ? rk + ' | ' + it.name + ' | ' + F(it.total) : '— | — | —');
    }
    L('| ' + (maps[cand[0]].get(pid) || '—') + ' | ' + parts.join(' | ') + ' |');
  }
  L('');

  /* ── 4 关键人：Bence Barát 与国锦赛依赖者 ─────────────────── */
  L('══ 4 国锦赛依赖者会怎么动 ══');
  L('');
  const findName = (nm) => {
    for (const r of results) {
      const it = r.list.find((x) => (x.name || '').indexOf(nm) >= 0);
      if (it) return it.pid;
    }
    return null;
  };
  const watch = ['Bence', 'Feliks', 'Max Park', 'Tymon'];
  L('| 选手 | 领奖台 | ' + KS.map((k) => 'k=' + k + ' 名次/分').join(' | ') + ' |');
  L('|---|---|' + KS.map(() => '---').join('|') + '|');
  for (const nm of watch) {
    const pid = findName(nm);
    if (!pid) continue;
    const cells = KS.map((k) => {
      const r = results.find((x) => x.k === k);
      const rank = r.list.findIndex((x) => x.pid === pid) + 1;
      return rank + ' / ' + F(r.list[rank - 1].total);
    });
    const rk0 = results[0].list.findIndex((x) => x.pid === pid);
    const n = results[0].list[rk0].n;
    L('| ' + results[0].list[rk0].name + ' | ' + num(n) + ' | ' + cells.join(' | ') + ' |');
  }
  L('');

  /* ── 5 谁受益最多 / 谁受损最多（Top100 内）─────────────────── */
  const kx = cand[Math.min(1, cand.length - 1)] || 0.5;
  L('══ 5 名次变动最大的 10 人（k=' + kx + ' vs k=0）══');
  L('');
  const r5 = results.find((x) => x.k === kx);
  const m5 = new Map();
  r5.list.forEach((x, i) => m5.set(x.pid, i + 1));
  const mv = [];
  for (const it of r0.list.slice(0, 200)) {
    const nw = m5.get(it.pid) || 9999;
    mv.push({ name: it.name, old: r0.list.findIndex((x) => x.pid === it.pid) + 1, nw, n: it.n, nat: it.nat });
  }
  mv.sort((a, b) => (a.nw - a.old) - (b.nw - b.old));
  L('| 选手 | 国家 | 领奖台 | 原名次 | 新名次 | 变动 |');
  L('|---|---|---|---|---|---|');
  for (const x of mv.slice(0, 6)) L('| ' + x.name + ' | ' + x.nat + ' | ' + num(x.n) + ' | ' + x.old + ' | ' + x.nw + ' | +' + (x.old - x.nw) + ' |');
  L('| … | | | | | |');
  for (const x of mv.slice(-4).reverse()) L('| ' + x.name + ' | ' + x.nat + ' | ' + num(x.n) + ' | ' + x.old + ' | ' + x.nw + ' | ' + (x.old - x.nw) + ' |');
  L('');

  /* ── 7 greater_china 反事实 ────────────────────────────────── */
  L('══ 7 反事实：greater_china 那几场若改判国锦赛 ══');
  L('');
  const gcRows = base.filter((x) => x.p.pureGC);
  const gcComps = new Set(gcRows.map((x) => x.p.compId));
  L('  pureGC 赛事 ' + gcComps.size + ' 场 / 领奖台 ' + num(gcRows.length)
    + ' 条，现按洲锦赛（T=0.4000，ρ=亚洲 0.3222）计价。');
  L('');
  if (gcRows.length) {
    const rhoCN = nc.CN / TOTAL;
    const evG = {};
    for (const x of gcRows) (evG[x.p.ev] = evG[x.p.ev] || []).push(x.p.fieldAll);
    L('  中国 333 参赛人数实测：');
    const byComp = new Map();
    for (const x of gcRows) {
      if (x.p.ev !== '333') continue;
      if (!byComp.has(x.p.compId)) byComp.set(x.p.compId, x.p.fieldAll);
    }
    for (const [cid, n] of byComp) {
      L('    · ' + cid + '  ' + (compInfo.get(cid) || {}).name + '  333 ' + n + ' 人'
        + '  ratio=' + F(n / (evRef.get('333') || globalRef)));
    }
    L('');
    L('  | k | 单价（T×ρ_new） | vs 现行 CC 价 0.1289 | 总额 | vs 现行总额 |');
    L('  |---|---|---|---|---|');
    const gcNow = gcRows.reduce((s, x) => s + x.s.score, 0);
    for (const k of KS) {
      const rows2 = gcRows.map((x) => {
        const rhoNew = Math.pow(rhoCN, 1 - k) * Math.pow(x.ratio, k);
        return x.s.score * (rhoNew / x.s.rho);
      });
      const tot = rows2.reduce((s, v) => s + v, 0);
      const unit = T.NC * Math.pow(rhoCN, 1 - k) * Math.pow(avg(gcRows.map((x) => x.ratio)), k);
      L('  | ' + k + ' | ' + F(unit) + ' | ' + F(unit / (T.CC * cc.Asia / TOTAL))
        + ' | ' + F(tot) + ' | ' + F(tot / gcNow) + ' |');
    }
    L('');
    L('  参考：现行（不改判、k 任意）总额 ' + F(gcNow) + '；按纯 NC 且不看人数为 '
      + F(T.NC * rhoCN * gcNow / (T.CC * (cc.Asia / TOTAL))) + '。');
    L('');
    const ratioAvg = avg(gcRows.map((x) => x.ratio));
    L('  这批赛事的平均 ratio = **' + F(ratioAvg) + '**（' + F(ratioAvg)
      + ' × 世锦赛同项目人数）—— 中国冠军赛的规模确实接近世锦赛。');
    L('');
  }

  /* ── 8 结论建议 ───────────────────────────────────────────── */
  L("══ 8 各 k 的副作用对照 ══");
  L('');
  L('| k | 国锦赛占分 | 洲锦赛+国锦赛占分 | 美锦赛/亚锦赛 | 说明 |');
  L('|---|---|---|---|---|');
  for (const r of results) {
    const g = (f) => {
      const x = r.rows.filter((q) => f(q.p));
      return x.length ? T[x[0].p.tier] * avg(x.map((q) => q.rhoNew)) : 0;
    };
    const us = g((p) => p.tier === 'NC' && p.nat === 'US');
    const as = g((p) => p.tier === 'CC' && p.cont === 'Asia');
    L('| ' + String(r.k) + ' | ' + PCT(r.share.NC / r.total) + ' | '
      + PCT((r.share.CC + r.share.NC) / r.total) + ' | ' + (as ? F(us / as) : '—')
      + ' | ' + (r.k === 0 ? '现行定稿' : r.k < 0.4 ? '温和抬高' : r.k < 0.8 ? '显著抬高' : '纯人数口径') + ' |');
  }
  L('');
})();

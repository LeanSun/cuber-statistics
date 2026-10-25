'use strict';
/* 四个计价方案的全量对照
 *
 * A0  现行       = P × T_L × ρ_人口 × f × w            （M2-F3 定稿）
 * A1  级内份额   = P × T_L × ρ_级内 × f × w            （ρ 换成「该场人数 ÷ 该级别中位」）
 * A2  A1 + 校准  = P × T'_L × ρ_级内 × f × w           （T' 由赛事深度反解：WC 1.00 / CC 0.76 / NC 0.15）
 * B   统一规模   = P × k_L × (该场人数 ÷ 世锦赛人数)^0.80 × f × w   （不分赛级，只有国内/国际两档系数）
 *
 * 用法：node --max-old-space-size=6144 etl/score/m2_plans.js
 * 只读。不改 m2.js。
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
    let buf = '', head = true;
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
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const med = (a) => {
  if (!a.length) return 0;
  const b = a.slice().sort((x, y) => x - y);
  const m = b.length >> 1;
  return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2;
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
    podiums.push({
      pid, ev, pos, compId, year,
      tier: M2.tierOf(ctypes.get(compId), nat),
      nat, cont: (isoInfo.get(nat) || {}).cont || 'Unknown',
      name: (pInfo.get(pid) || {}).name || r[7] || pid,
    });
  });
  for (const p of podiums) p.field = (compEvPeople.get(p.compId + '|' + p.ev) || { size: 0 }).size;

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

  const scored = podiums.map((p) => {
    const s = M2.scorePodium(p, { ctx, pool, cfg: { era: true, rhoMode: 'linear', useWeight: true } });
    return { p, s };
  });

  const T = M2.TIER_BASE;
  const PW = (x) => M2.PLACE_W[x.s.place] || 0;
  /* 每级参赛人数中位 —— 必须按项目分开：
   * 冷门项目（如 444bf）一场只有十几人，混在一起会把基准拉低，
   * 导致热门项目的 ρ_级内 被系统性放大（上一版就是这个 bug）。 */
  const fByTier = { WC: [], CC: [], NC: [] };
  const fByKE = new Map();      // "tier|ev" → [field]
  for (const x of scored) {
    if (!fByTier[x.p.tier]) continue;
    fByTier[x.p.tier].push(x.p.field);
    const k = x.p.tier + '|' + x.p.ev;
    if (!fByKE.has(k)) fByKE.set(k, []);
    fByKE.get(k).push(x.p.field);
  }
  const medF = { WC: med(fByTier.WC), CC: med(fByTier.CC), NC: med(fByTier.NC) };
  const medKE = new Map();
  for (const [k, a] of fByKE) if (a.length >= 3) medKE.set(k, med(a));
  const medOf = (tier, ev) => medKE.get(tier + '|' + ev) || medF[tier];
  /* 世锦赛同项目参考人数 */
  const evRef = new Map();
  const byEv = {};
  for (const x of scored) if (x.p.tier === 'WC') (byEv[x.p.ev] = byEv[x.p.ev] || []).push(x.p.field);
  for (const e of Object.keys(byEv)) evRef.set(e, avg(byEv[e]));
  const globalRef = avg(scored.filter((x) => x.p.tier === 'WC').map((x) => x.p.field)) || 423;

  /* 方案参数 */
  const T2 = { WC: 1.0000, CC: 0.7612, NC: 0.1500 };
  const GAMMA = 0.8015;
  const KB = { WC: 1.0000, CC: 1.0476, NC: 0.6351 };   // 由深度应得反解，WC=1 归一

  const plans = [
    { id: 'A0', name: '现行（T×ρ_人口）', f: (x) => x.s.score },
    { id: 'A1', name: '级内份额（ρ→该级同项目中位）', f: (x) => PW(x) * T[x.p.tier] * (x.p.field / medOf(x.p.tier, x.p.ev)) * x.s.f * x.s.w },
    { id: 'A2', name: 'A1 + CC 校准', f: (x) => PW(x) * T2[x.p.tier] * (x.p.field / medOf(x.p.tier, x.p.ev)) * x.s.f * x.s.w },
    { id: 'B', name: '统一规模（两档系数）', f: (x) => PW(x) * KB[x.p.tier] * Math.pow(x.p.field / (evRef.get(x.p.ev) || globalRef), GAMMA) * x.s.f * x.s.w },
  ];

  const out = {};
  for (const pl of plans) {
    const rows = scored.map((x) => ({ pid: x.p.pid, name: x.p.name, tier: x.p.tier, score: pl.f(x), n: 1 }));
    const byP = new Map();
    for (const r of rows) {
      let a = byP.get(r.pid);
      if (!a) { a = { pid: r.pid, name: r.name, total: 0, n: 0, t: { WC: 0, CC: 0, NC: 0 } }; byP.set(r.pid, a); }
      a.total += r.score; a.n++; a.t[r.tier] += r.score;
    }
    const list = [...byP.values()].sort((a, b) => b.total - a.total);
    const tot = list.reduce((s, x) => s + x.total, 0);
    const tierSum = { WC: 0, CC: 0, NC: 0 };
    for (const r of rows) tierSum[r.tier] += r.score;
    out[pl.id] = { list, tot, tierSum, name: pl.name };
  }

  const L = (s) => console.log(s);
  L('# M2 四种计价方案全量对照');
  L('');
  L('> 现算，源 WCA v2.0.2，脚本 `etl/score/m2_plans.js`。只读，不改 m2.js。');
  L('> 输入：32,810 条有效领奖台（927 场冠军赛，已排除多区赛与 DNF）。');
  L('');
  L('| 方案 | 定义 |');
  L('|---|---|');
  for (const pl of plans) L('| **' + pl.id + '** | ' + pl.name + ' |');
  L('');
  L('各级参赛人数中位：WC ' + medF.WC + '，CC ' + medF.CC + '，NC ' + medF.NC + ' 人');
  L('世锦赛各项目参考人数（未出现项回退）' + F(globalRef) + ' 人');
  L('');

  /* ── 1 总量与份额 ─────────────────────────────────────────── */
  L('══ 1 总量与赛级分配 ══');
  L('');
  L('| 方案 | 总量 | 世界 | 洲际 | 全国 | 全国占比 |');
  L('|---|---|---|---|---|---|');
  for (const pl of plans) {
    const o = out[pl.id];
    L('| **' + pl.id + '** | ' + F(o.tot) + ' | ' + F(o.tierSum.WC) + ' | ' + F(o.tierSum.CC)
      + ' | ' + F(o.tierSum.NC) + ' | ' + PCT(o.tierSum.NC / o.tot) + ' |');
  }
  L('');

  /* ── 2 Top 15 ─────────────────────────────────────────────── */
  L('══ 2 Top 15 ══');
  L('');
  const maps = {};
  for (const pl of plans) {
    maps[pl.id] = new Map();
    out[pl.id].list.forEach((x, i) => maps[pl.id].set(x.pid, i + 1));
  }
  const shown = new Set();
  for (const pl of plans) for (const x of out[pl.id].list.slice(0, 15)) shown.add(x.pid);
  // 以 A0 顺序为主轴，A0 未进前 15 的补在后面
  const order = [...out.A0.list.slice(0, 15).map((x) => x.pid)];
  for (const x of out.B.list.slice(0, 15)) if (!order.includes(x.pid)) order.push(x.pid);

  L('| # | 选手 | A0 | A1 | A2 | B |');
  L('|---|---|---|---|---|---|');
  let rk = 0;
  for (const pid of order) {
    rk++;
    let nm = '';
    for (const pl of plans) {
      const it = out[pl.id].list.find((x) => x.pid === pid);
      if (it) { nm = it.name; break; }
    }
    const cell = (id) => {
      const r = maps[id].get(pid);
      const it = out[id].list.find((x) => x.pid === pid);
      return r ? r + ' · ' + F(it.total) : '—';
    };
    L('| ' + rk + ' | ' + nm + ' | ' + cell('A0') + ' | ' + cell('A1') + ' | ' + cell('A2') + ' | ' + cell('B') + ' |');
  }
  L('');

  /* ── 3 重点选手 ───────────────────────────────────────────── */
  L('══ 3 重点选手的名次变化 ══');
  L('');
  const watch = ['Feliks Zemdegs', 'Max Park', 'Tymon Kolasiński', 'Bence Barát', 'Seung Hyuk Nahm', 'Kevin Hays'];
  L('| 选手 | 领奖台 | A0 名次/分 | A1 | A2 | B |');
  L('|---|---|---|---|---|---|');
  for (const w of watch) {
    const it0 = out.A0.list.find((x) => x.name === w);
    if (!it0) { L('| ' + w + ' | — | 未上榜 | — | — | — |'); continue; }
    const cell = (id) => {
      const r = maps[id].get(it0.pid);
      const it = out[id].list.find((x) => x.pid === it0.pid);
      return r ? r + ' / ' + F(it.total) : '—';
    };
    L('| ' + w + ' | ' + num(it0.n) + ' | ' + cell('A0') + ' | ' + cell('A1') + ' | ' + cell('A2') + ' | ' + cell('B') + ' |');
  }
  L('');

  /* ── 4 头衔价格 ───────────────────────────────────────────── */
  L('══ 4 各头衔的价格（冠军，值几个世锦赛冠军）══');
  L('');
  L('按公式直接算，不取实测均值。');
  L('');
  const natPop = nc;
  const rhoPop = (iso) => (natPop[iso] || 0) / TOTAL;
  const rhoPopCont = (c) => (cc[c] || 0) / TOTAL;
  /* 头衔价格固定用 333 对比，避免项目构成不同导致的不可比 */
  const HEV = '333';
  const medFof = (iso) => {
    const a = scored.filter((x) => x.p.tier === 'NC' && x.p.nat === iso && x.p.ev === HEV).map((x) => x.p.field);
    return a.length ? med(a) : medOf('NC', HEV);
  };
  L('| 头衔 | A0 | A1 | A2 | B |');
  L('|---|---|---|---|---|');
  const titles = [
    ['美锦赛', 'NC', 'US'],
    ['中锦赛', 'NC', 'CN'],
    ['日锦赛', 'NC', 'JP'],
    ['匈锦赛', 'NC', 'HU'],
    ['纽锦赛', 'NC', 'NZ'],
  ];
  for (const [nm, tier, iso] of titles) {
    const a0 = T[tier] * rhoPop(iso);
    const a1 = T[tier] * (medFof(iso) / medOf('NC', HEV));
    const a2 = T2[tier] * (medFof(iso) / medOf('NC', HEV));
    const b = KB[tier] * Math.pow(medFof(iso) / (evRef.get(HEV) || globalRef), GAMMA);
    L('| ' + nm + ' | ' + F(a0) + ' | ' + F(a1) + ' | ' + F(a2) + ' | ' + F(b) + ' |');
  }
  for (const [nm, cont] of [['亚锦赛', 'Asia'], ['欧锦赛', 'Europe'], ['美锦赛(洲)', 'North America']]) {
    const a0 = T.CC * rhoPopCont(cont);
    const fcc = scored.filter((x) => x.p.tier === 'CC' && x.p.cont === cont && x.p.ev === HEV).map((x) => x.p.field);
    const mf = fcc.length ? med(fcc) : medOf('CC', HEV);
    const a1 = T.CC * (mf / medOf('CC', HEV));
    const a2 = T2.CC * (mf / medOf('CC', HEV));
    const b = KB.CC * Math.pow(mf / (evRef.get(HEV) || globalRef), GAMMA);
    L('| ' + nm + ' | ' + F(a0) + ' | ' + F(a1) + ' | ' + F(a2) + ' | ' + F(b) + ' |');
  }
  L('');
  L('（世锦赛自身：A0 ' + F(T.WC) + ' ｜ A1 ' + F(T.WC) + ' ｜ A2 ' + F(T2.WC) + ' ｜ B ' + F(KB.WC) + '）');
  L('');

  /* ── 5 名次稳定性 ─────────────────────────────────────────── */
  L('══ 5 与 A0 的名次相关性 ══');
  L('');
  L('| 方案 | 与 A0 的 Spearman 相关 | Top10 重合 | Top50 重合 | Top100 重合 |');
  L('|---|---|---|---|---|');
  const topSet = (id, n) => new Set(out[id].list.slice(0, n).map((x) => x.pid));
  const rankOf = (id, pid) => maps[id].get(pid) || 1e9;
  const common = [...out.A0.list.map((x) => x.pid)].filter((pid) => maps.A1.has(pid));
  for (const pl of plans) {
    if (pl.id === 'A0') continue;
    const a = common.map((pid) => rankOf('A0', pid));
    const b = common.map((pid) => rankOf(pl.id, pid));
    const ma = avg(a), mb = avg(b);
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < a.length; i++) {
      const dx = a[i] - ma, dy = b[i] - mb;
      sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
    }
    const rho = sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0;
    const inter = (n) => {
      const s0 = topSet('A0', n), s1 = topSet(pl.id, n);
      let c = 0;
      for (const x of s1) if (s0.has(x)) c++;
      return c + '/' + n;
    };
    L('| **' + pl.id + '** | ' + F(rho) + ' | ' + inter(10) + ' | ' + inter(50) + ' | ' + inter(100) + ' |');
  }
  L('');
  L('Spearman 用全榜名次（共同选手 ' + num(common.length) + ' 人）近似计算。');
  L('');
})();

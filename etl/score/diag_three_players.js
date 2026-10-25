'use strict';
/* 三人分数拆解（当前口径 = S4 落地后的融合内核）
 *
 * 内核与 `m2m3_balance.js` 完全一致（同一份加载代码 + 同一套常量）：
 *   分 = P(pos) × K_级 × (hill(field) / hill(同时代 REF))^0.8015 × f × w × (普通赛 ? β × n^-0.5 : 1)
 *   hill(N) = 500 × ln(1 + N/500)
 * 自校验：本脚本算出的 β 与三人总分必须等于定稿的 0.2782 /
 *         Tymon 305.2607 / Max 282.3442 / Feliks 303.6459，不等就是复制走了样。
 *
 * 用法：node --max-old-space-size=6144 etl/score/diag_three_players.js
 * 只读，不改 m2.js / m1.js / m2m3_balance.js。
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
const med = (a) => {
  if (!a.length) return 0;
  const b = a.slice().sort((x, y) => x - y);
  const m = b.length >> 1;
  return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2;
};

const ZIP = fs.readdirSync(path.join(ROOT, 'data/raw')).filter((f) => f.endsWith('.zip'))[0];
const ZIP_PATH = path.join(ROOT, 'data/raw', ZIP);

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

const GAMMA = 0.8015;
const ALPHA = 0.5;
const K_OF = { OP: 1.0000, NC: 1.0000, CC: 1.6000, WC: 1.6000 };
const TIER_CN = { OP: '普通赛', NC: '国锦赛', CC: '洲锦赛', WC: '世锦赛' };
const PLACE_CN = { 1: '金', 2: '银', 3: '铜' };
const WANT = ['Tymon Kolasiński', 'Max Park', 'Feliks Zemdegs'];
const NSAT = 500;
const hill = (x) => NSAT * Math.log(1 + Math.max(x, 0) / NSAT);

(async () => {
  /* ── 加载（与 m2m3_balance.js 一致） ─────────────────────────── */
  const isoOf = new Map(); const isoInfo = new Map(); const contOfRaw = new Map();
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
  const rows = [];
  await streamTsv('WCA_export_results.tsv', (r) => {
    const pid = r[8]; if (!pid) return;
    const compId = r[4];
    const comp = compInfo.get(compId) || {};
    const year = comp.year || 0;
    const fy = firstYear.get(pid);
    if (!fy || (year && year < fy)) firstYear.set(pid, year);
    const ev = r[6];
    const k = compId + '|' + ev;
    let st = compEvPeople.get(k);
    if (!st) { st = new Set(); compEvPeople.set(k, st); }
    st.add(pid);
    const pos = +r[1];
    if (!(pos >= 1 && pos <= 3)) return;
    if (r[5] !== 'f' && r[5] !== 'c') return;
    if (!(+r[2] > 0)) return;
    rows.push({ pid, ev, pos, compId, year, nat: comp.iso || '' });
  });

  const cc = {}; const nc = {};
  const people = [];
  for (const [pid, p] of pInfo) {
    const cont = (isoInfo.get(p.iso) || {}).cont || 'Unknown';
    nc[p.iso] = (nc[p.iso] || 0) + 1;
    cc[cont] = (cc[cont] || 0) + 1;
    const y = firstYear.get(pid);
    if (y) people.push({ y, cont, nat: p.iso });
  }
  const TOTAL = pInfo.size;
  const pool = M1.makeScopePool(people, 2026);

  const items = [];
  for (const r of rows) {
    const multi = M2.isMultiRegion(r.nat);
    const tier = multi ? 'OP' : M2.tierOf(ctypes.get(r.compId), r.nat);
    const cont = (isoInfo.get(r.nat) || {}).cont || 'Unknown';
    const field = (compEvPeople.get(r.compId + '|' + r.ev) || { size: 1 }).size;
    const who = { nat: r.nat, cont };
    const fNat = pool ? pool.valueOf('NR', who, +r.year || 2026) : 1;
    const fGlb = pool ? pool.valueOf('WR', who, +r.year || 2026) : 1;
    const w = RN.EV_WEIGHT_V2[r.ev] == null ? RN.WEIGHT_V2_CFG.floor : RN.EV_WEIGHT_V2[r.ev];
    items.push({
      pid: r.pid, ev: r.ev, tier, pos: r.pos, year: r.year, field, fNat, fGlb, w,
      compId: r.compId, nat: r.nat, cont,
      compName: (compInfo.get(r.compId) || {}).name || r.compId,
      name: (pInfo.get(r.pid) || {}).name || r.pid,
    });
  }

  const F_POOL = { OP: 'WR', NC: 'NR', CC: 'NR', WC: 'WR' };
  const fOf = (it) => (F_POOL[it.tier] === 'WR' ? it.fGlb : it.fNat);

  const opByEv = new Map();
  for (const it of items) {
    if (it.tier !== 'OP') continue;
    if (!opByEv.has(it.ev)) opByEv.set(it.ev, []);
    opByEv.get(it.ev).push({ year: it.year, field: it.field });
  }
  const REF = new Map();
  for (const [ev, a] of opByEv) if (a.length >= 30) REF.set(ev, med(a.map((x) => x.field)));
  const refAll = med([...opByEv].filter(([, a]) => a.length >= 30).map(([, a]) => med(a.map((x) => x.field))));
  const refOfG = (ev) => REF.get(ev) || refAll;
  const WIN = [2, 3, 5, 8, 15];
  const MIN_SAMPLES = 20;
  const eraCache = new Map();
  const refOfEra = (ev, year) => {
    const key = ev + '|' + year;
    if (eraCache.has(key)) return eraCache.get(key);
    const list = opByEv.get(ev) || [];
    let best = null; let usedW = -1;
    for (const w of WIN) {
      const l = list.filter((x) => Math.abs(x.year - year) <= w).map((x) => x.field);
      if (l.length >= MIN_SAMPLES) { best = med(l); usedW = w; break; }
    }
    if (best == null) {
      const l = list.filter((x) => Math.abs(x.year - year) <= 15).map((x) => x.field);
      if (l.length) { best = med(l); usedW = 15; } else { best = refOfG(ev); usedW = -1; }
    }
    eraCache.set(key, best);
    eraCache.set(key + '#w', usedW);
    return best;
  };

  for (const it of items) {
    const P = M2.PLACE_W[it.pos] || 0;
    const K = K_OF[it.tier];
    it.ref = refOfEra(it.ev, it.year);
    it.scale = Math.pow(hill(it.field) / hill(it.ref), GAMMA);
    it.f = fOf(it);
    it.base = P * K * it.scale * it.f * it.w;
    it.baseOld = P * K * Math.pow(it.field / refOfG(it.ev), GAMMA)
      * (it.tier === 'OP' ? it.fGlb : it.fNat) * it.w;
    it.n = 1;
  }

  const grp = new Map();
  for (const it of items) {
    if (it.tier !== 'OP') continue;
    const k = it.pid + '|' + it.ev;
    if (!grp.has(k)) grp.set(k, []);
    grp.get(k).push(it);
  }
  for (const [, a] of grp) {
    a.sort((x, y) => (x.year - y.year) || String(x.compId).localeCompare(String(y.compId)));
    a.forEach((it, i) => { it.n = i + 1; it.decay = Math.pow(i + 1, -ALPHA); });
  }
  for (const it of items) if (it.tier !== 'OP') it.decay = 1;

  /* ── β（总量等分） ─────────────────────────────────────────── */
  const S = { OP: 0, NC: 0, CC: 0, WC: 0 };
  const SO = { OP: 0, NC: 0, CC: 0, WC: 0 };
  for (const it of items) {
    S[it.tier] += it.base * it.decay;
    SO[it.tier] += it.baseOld * it.decay;
  }
  const S2 = S.NC + S.CC + S.WC;
  const BETA = S2 / S.OP;
  const S2O = SO.NC + SO.CC + SO.WC;
  const BETA_O = S2O / SO.OP;
  const vOf = (it, old) => (old ? it.baseOld : it.base) * it.decay * (it.tier === 'OP' ? (old ? BETA_O : BETA) : 1);

  /* ── 全站聚合 + 三人 ────────────────────────────────────────── */
  const by = new Map();
  for (const it of items) {
    let a = by.get(it.pid);
    if (!a) { a = { pid: it.pid, name: it.name, total: 0, m2: 0, m3: 0, n: 0 }; by.set(it.pid, a); }
    const v = vOf(it, false);
    a.total += v; a.n++;
    if (it.tier === 'OP') a.m3 += v; else a.m2 += v;
  }
  const rankList = [...by.values()].filter((x) => x.total > 0).sort((a, b) => b.total - a.total);
  rankList.forEach((x, i) => { x.rank = i + 1; });
  const findPid = (nm) => {
    for (const [, p] of pInfo) if (p.name === nm) return [...pInfo.entries()].find(([, q]) => q === p)[0];
    const hit = [...pInfo.entries()].find(([, p]) => p.name && p.name.toLowerCase().includes(nm.toLowerCase()));
    return hit ? hit[0] : null;
  };

  const OUT = [];
  const L = (s) => { console.log(s); OUT.push(s); };

  L('# 三人分数拆解：Tymon / Max / Feliks（当前口径 = S4 · hill(' + NSAT + ')）');
  L('');
  L('> 现算，源 WCA v2.0.2，脚本 `etl/score/diag_three_players.js`。只读。');
  L('> 内核与 `m2m3_balance.js` 逐行一致：年代本地 REF + WC 全球池 + hill(' + NSAT + ') 人数封顶 + α = ' + F(ALPHA) + ' + β = ' + F(BETA) + '（总量等分）。');
  L('');
  L('```');
  L('单条分 = P(pos) × K_级 × (hill(到场人数) ÷ hill(同时代 REF))^' + F(GAMMA) + ' × f × w × (普通赛再乘 β × n^-' + F(ALPHA) + ')');
  L('hill(N) = ' + NSAT + ' × ln(1 + N/' + NSAT + ')；P = 金 1.0000 / 银 0.6000 / 铜 0.4000');
  L('K_级 = 普通赛 1.0000 / 国锦赛 1.0000 / 洲锦赛 1.6000 / 世锦赛 1.6000');
  L('```');
  L('');

  /* ═══ 1 总览 ═══ */
  const three = [];
  for (const nm of WANT) {
    const pid = findPid(nm);
    if (!pid) { L('**未找到选手：' + nm + '**'); continue; }
    const a = rankList.find((x) => x.pid === pid);
    three.push({ nm, pid, a });
  }
  L('══ 1 总览 ══');
  L('');
  L('| 选手 | 名次 | 融合总分 | 锦标赛（M2） | 普通赛（M3） | M3 占比 | 领奖台条数 | 单条均分 |');
  L('|---|---|---|---|---|---|---|---|');
  for (const t of three) {
    const a = t.a;
    L('| ' + a.name + ' | #' + a.rank + ' | **' + F(a.total) + '** | ' + F(a.m2) + ' | ' + F(a.m3)
      + ' | ' + PCT(a.m3 / a.total) + ' | ' + num(a.n) + ' | ' + F(a.total / a.n) + ' |');
  }
  L('');
  L('全站 ' + num(rankList.length) + ' 人有分（共 ' + num(TOTAL) + ' 人），总分 ' + F(S2 + S.OP * BETA) + '；');
  L('三人合计 ' + F(three.reduce((s, t) => s + t.a.total, 0)) + '，占全站 '
    + PCT(three.reduce((s, t) => s + t.a.total, 0) / (S2 + S.OP * BETA)) + '。');
  L('');

  /* ═══ 2 按赛级 ═══ */
  L('══ 2 按赛级拆解 ══');
  L('');
  for (const t of three) {
    const its = items.filter((it) => it.pid === t.pid);
    L('**' + t.a.name + '**（# ' + t.a.rank + '，总分 ' + F(t.a.total) + '，' + num(its.length) + ' 条领奖台）');
    L('');
    L('| 赛级 | 条数 | 金/银/铜 | 分 | 占本人 | 单条均分 | 平均场次 | 平均 f |');
    L('|---|---|---|---|---|---|---|---|');
    for (const tier of ['WC', 'CC', 'NC', 'OP']) {
      const g = its.filter((it) => it.tier === tier);
      if (!g.length) { L('| ' + TIER_CN[tier] + ' | 0 | — | 0.0000 | 0.00% | — | — | — |'); continue; }
      const v = g.reduce((s, x) => s + vOf(x, false), 0);
      const gold = g.filter((x) => x.pos === 1).length;
      const silver = g.filter((x) => x.pos === 2).length;
      const bronze = g.filter((x) => x.pos === 3).length;
      const avgF = g.reduce((s, x) => s + x.field, 0) / g.length;
      const avgEra = g.reduce((s, x) => s + x.f, 0) / g.length;
      L('| ' + TIER_CN[tier] + ' | ' + num(g.length) + ' | ' + gold + '/' + silver + '/' + bronze
        + ' | **' + F(v) + '** | ' + PCT(v / t.a.total) + ' | ' + F(v / g.length)
        + ' | ' + num(Math.round(avgF)) + ' | ' + F(avgEra) + ' |');
    }
    L('| **合计** | **' + num(its.length) + '** | | **' + F(t.a.total) + '** | 100.00% | | | |');
    L('');
  }

  /* ═══ 3 按项目 ═══ */
  L('══ 3 按项目拆解（每人得分最高的 8 个项目）══');
  L('');
  for (const t of three) {
    const its = items.filter((it) => it.pid === t.pid);
    const byEv = new Map();
    for (const it of its) {
      if (!byEv.has(it.ev)) byEv.set(it.ev, []);
      byEv.get(it.ev).push(it);
    }
    const rows3 = [...byEv.entries()].map(([ev, g]) => ({
      ev, n: g.length,
      v: g.reduce((s, x) => s + vOf(x, false), 0),
      champ: g.filter((x) => x.tier !== 'OP').length,
      w: g[0].w,
    })).sort((a, b) => b.v - a.v);
    L('**' + t.a.name + '**');
    L('');
    L('| 项目 | 条数 | 其中锦标赛 | 项目权重 w | 分 | 占本人 |');
    L('|---|---|---|---|---|---|');
    for (const r of rows3.slice(0, 8)) {
      L('| ' + r.ev + ' | ' + num(r.n) + ' | ' + num(r.champ) + ' | ' + F(r.w)
        + ' | **' + F(r.v) + '** | ' + PCT(r.v / t.a.total) + ' |');
    }
    const rest = rows3.slice(8);
    if (rest.length) {
      L('| 其余 ' + rest.length + ' 个项目 | ' + num(rest.reduce((s, x) => s + x.n, 0))
        + ' | ' + num(rest.reduce((s, x) => s + x.champ, 0)) + ' | | '
        + F(rest.reduce((s, x) => s + x.v, 0)) + ' | '
        + PCT(rest.reduce((s, x) => s + x.v, 0) / t.a.total) + ' |');
    }
    L('');
  }

  /* ═══ 4 单条最高 ═══ */
  L('══ 4 每人单条最高的 8 条领奖台 ══');
  L('');
  for (const t of three) {
    const its = items.filter((it) => it.pid === t.pid)
      .map((it) => ({ it, v: vOf(it, false) }))
      .sort((a, b) => b.v - a.v).slice(0, 8);
    L('**' + t.a.name + '**');
    L('');
    L('| 年 | 赛事 | 项目 | 名次 | 赛级 | 场次 | 规模项 | f | w | 分 |');
    L('|---|---|---|---|---|---|---|---|---|---|');
    for (const x of its) {
      const it = x.it;
      L('| ' + it.year + ' | ' + it.compName.replace(/\|/g, '/').slice(0, 32) + ' | ' + it.ev + ' | '
        + PLACE_CN[it.pos] + ' | ' + TIER_CN[it.tier] + ' | ' + num(it.field) + ' | ' + F(it.scale)
        + ' | ' + F(it.f) + ' | ' + F(it.w) + ' | **' + F(x.v) + '** |');
    }
    L('');
  }

  /* ═══ 5 按年代 ═══ */
  L('══ 5 按年代拆解 ══');
  L('');
  const eraKeys = ['≤2009', '2010-2014', '2015-2019', '2020-2026'];
  const eraOf = (y) => (y <= 2009 ? '≤2009' : y <= 2014 ? '2010-2014' : y <= 2019 ? '2015-2019' : '2020-2026');
  L('| 年代 | ' + three.map((t) => t.a.name).join(' | ') + ' |');
  L('|---|---|---|---|');
  for (const k of eraKeys) {
    const cells = three.map((t) => {
      const g = items.filter((it) => it.pid === t.pid && eraOf(it.year) === k);
      const v = g.reduce((s, x) => s + vOf(x, false), 0);
      return F(v) + '（' + num(g.length) + ' 条）';
    });
    L('| ' + k + ' | ' + cells.join(' | ') + ' |');
  }
  L('');

  /* ═══ 6 口径变迁前后 ═══ */
  L('══ 6 旧定稿 → S4（含 hill 封顶）的累计变化 ══');
  L('');
  L('| 选手 | 旧定稿总分 | 旧名次 | S4 总分 | 新名次 | Δ 总分 | Δ 锦标赛分 |');
  L('|---|---|---|---|---|---|---|');
  const oldBy = new Map();
  for (const it of items) {
    let a = oldBy.get(it.pid);
    if (!a) { a = { pid: it.pid, name: it.name, total: 0, m2: 0 }; oldBy.set(it.pid, a); }
    const v = vOf(it, true);
    a.total += v;
    if (it.tier !== 'OP') a.m2 += v;
  }
  const oldRank = [...oldBy.values()].filter((x) => x.total > 0).sort((a, b) => b.total - a.total);
  oldRank.forEach((x, i) => { x.rank = i + 1; });
  for (const t of three) {
    const o = oldRank.find((x) => x.pid === t.pid);
    L('| ' + t.a.name + ' | ' + F(o.total) + ' | #' + o.rank + ' | **' + F(t.a.total) + '** | #' + t.a.rank
      + ' | ' + (t.a.total - o.total >= 0 ? '+' : '') + F(t.a.total - o.total)
      + ' | ' + (t.a.m2 - o.m2 >= 0 ? '+' : '') + F(t.a.m2 - o.m2) + ' |');
  }
  L('');
  L('β：' + F(BETA_O) + ' → ' + F(BETA) + '。旧定稿 = 全局 REF + 锦标赛一律举办国池；');
  L('S4 = 年代本地 REF + WC 全球池 + hill(' + NSAT + ') 人数封顶。Δ 包含 S2 与 S4 两步的累计效果。');
  L('');

  /* ═══ 7 边界 ═══ */
  L('══ 7 诚实的边界 ══');
  L('');
  L('- 场次人数 = 该赛事该项目**全部参赛者**（含预赛淘汰者），不是决赛人数。');
  L('- hill(' + NSAT + ') 人数封顶：超过 ' + NSAT + ' 人的场次边际递减；1982/2003/2005 三届世锦赛（19/88/149 人）不受影响。');
  L('- 普通赛有重复衰减 β × n^-' + F(ALPHA) + '（同人同项目第 n 次 × n^-0.5），锦标赛不衰减、全额累加。');
  L('- 三人中有人参加过被判为洲际赛的 greater_china 场次（China Championship），该 5 场仍按 CC 计，未处置。');
  L('- CC / NC 的 f 仍用举办国池；若改成洲 / 全球池，三人分数会再变（见《M2M3_融合_定稿》第 9 节敏感性行）。');
  L('');

  fs.writeFileSync(path.join(__dirname, 'M2M3_三人分数拆解.md'), OUT.join('\n') + '\n');
  console.error('[selfcheck] beta=' + F(BETA) + ' betaOld=' + F(BETA_O)
    + ' | ' + three.map((t) => t.a.name + ' ' + F(t.a.total)).join(' / '));
})().catch((e) => { console.error(e); process.exit(1); });

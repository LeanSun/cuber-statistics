'use strict';
/* 三阶专项：Tymon Kolasiński 为什么强于 Feliks Zemdegs
 *
 * 只看 333 一本账（w=1.0000，两人同权重，无项目权重差异）。
 * β 是**全局**价格常量（全站所有项目求出 = 0.2782），本脚本用全站求 β 后只分析 333。
 * 内核与 m2m3_balance.js / diag_event_split.js 完全一致（S4 口径）。
 *
 * 自校验：β=0.2782；Tymon 333 = 78.1962；Feliks 333 = 59.6928
 *
 * 用法：node --max-old-space-size=6144 etl/score/diag_333_tf.js
 * 只读。
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
const NSAT = 500;
const hill = (x) => NSAT * Math.log(1 + Math.max(x, 0) / NSAT);
const NAMES = ['Tymon Kolasiński', 'Feliks Zemdegs'];

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

  const people = [];
  for (const [pid, p] of pInfo) {
    const cont = (isoInfo.get(p.iso) || {}).cont || 'Unknown';
    const y = firstYear.get(pid);
    if (y) people.push({ y, cont, nat: p.iso });
  }
  const pool = M1.makeScopePool(people, 2026);

  /* 加载全部项目（β 是全局价格常量，必须全站求），分析时只看 333 */
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

  /* REF：必须用全站 333 普通赛（不能只用两人的） */
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
    let best = null;
    for (const w of WIN) {
      const l = list.filter((x) => Math.abs(x.year - year) <= w).map((x) => x.field);
      if (l.length >= MIN_SAMPLES) { best = med(l); break; }
    }
    if (best == null) {
      const l = list.filter((x) => Math.abs(x.year - year) <= 15).map((x) => x.field);
      if (l.length) { best = med(l); } else { best = refOfG(ev); }
    }
    eraCache.set(key, best);
    return best;
  };

  for (const it of items) {
    const P = M2.PLACE_W[it.pos] || 0;
    const K = K_OF[it.tier];
    it.ref = refOfEra(it.ev, it.year);
    it.scale = Math.pow(hill(it.field) / hill(it.ref), GAMMA);
    it.f = fOf(it);
    it.P = P; it.K = K;
    it.base = P * K * it.scale * it.f * it.w;
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

  const S = { OP: 0, NC: 0, CC: 0, WC: 0 };
  for (const it of items) S[it.tier] += it.base * it.decay;
  const S2 = S.NC + S.CC + S.WC;
  const BETA = S2 / S.OP;
  const vOf = (it) => it.base * it.decay * (it.tier === 'OP' ? BETA : 1);

  /* ── 两人 333 条目（分析只看三阶；β 已用全站求出） ───────── */
  const pidOf = (name) => {
    for (const [id, p] of pInfo) if (p.name === name) return id;
    return null;
  };
  const tPid = pidOf('Tymon Kolasiński');
  const fPid = pidOf('Feliks Zemdegs');
  const t3 = items.filter((it) => it.pid === tPid && it.ev === '333');
  const f3 = items.filter((it) => it.pid === fPid && it.ev === '333');
  const sum = (a) => a.reduce((s, x) => s + vOf(x), 0);

  const OUT = [];
  const L = (s) => { console.log(s); OUT.push(s); };

  L('# 三阶专项：Tymon 为什么强于 Feliks');
  L('');
  L('> 现算，源 WCA v2.0.2，脚本 `etl/score/diag_333_tf.js`。只读。');
  L('> 只看 333 一本账（w = 1.0000 两人相同），S4 口径（年代本地 REF + hill(500) + WC 全球池）。');
  L('');
  L('**一句话**：Feliks 条数更多（158 vs 151）、金牌更多（131 vs 127）、**世锦赛金牌也更多（2 金 vs 0 金）**，');
  L('普通赛两人几乎打平（7.12 vs 6.89）；差距全在锦标赛（Tymon 71.07 vs Feliks 52.80），');
  L('而且集中在**洲锦赛**（31.04 vs 13.56）。归因：Tymon 赢在**单条价格**——');
  L('场子更大、年代更新；名次 P 反而站在 Feliks 一边。');
  L('');

  /* ── 0 自校验 ───────────────────────────────────────────────── */
  L('══ 0 自校验 ══');
  L('');
  L('| 项 | 本脚本 | 定稿值 | 状态 |');
  L('|---|---|---|---|');
  const ok = (a, b) => (Math.abs(a - b) < 5e-4 ? '✅' : '❌ **不一致**');
  L('| β | ' + F(BETA) + ' | 0.2782 | ' + ok(BETA, 0.2782) + ' |');
  L('| Tymon 333 | ' + F(sum(t3)) + ' | 78.1962 | ' + ok(sum(t3), 78.1962) + ' |');
  L('| Feliks 333 | ' + F(sum(f3)) + ' | 59.6928 | ' + ok(sum(f3), 59.6928) + ' |');
  L('');

  /* ── 1 总量与条数 ───────────────────────────────────────────── */
  L('══ 1 条数更多，分数更少 ══');
  L('');
  const tS = sum(t3); const fS = sum(f3);
  L('| | Tymon | Feliks | Tymon ÷ Feliks |');
  L('|---|---|---|---|');
  const cnt = (a, fn) => a.filter(fn).length;
  const avg = (a) => (a.length ? sum(a) / a.length : 0);
  L('| 三阶总分 | **' + F(tS) + '** | ' + F(fS) + ' | ' + F(tS / fS) + ' |');
  L('| 领奖台条数 | ' + num(t3.length) + ' | **' + num(f3.length) + '** | ' + F(t3.length / f3.length) + ' |');
  L('| 金/银/铜 | ' + cnt(t3, (x) => x.pos === 1) + '/' + cnt(t3, (x) => x.pos === 2) + '/' + cnt(t3, (x) => x.pos === 3)
    + ' | ' + cnt(f3, (x) => x.pos === 1) + '/' + cnt(f3, (x) => x.pos === 2) + '/' + cnt(f3, (x) => x.pos === 3) + ' | |');
  L('| **单条均分** | **' + F(avg(t3)) + '** | ' + F(avg(f3)) + ' | ' + F(avg(t3) / avg(f3)) + ' |');
  L('| 锦标赛条数 | ' + num(cnt(t3, (x) => x.tier !== 'OP')) + ' | ' + num(cnt(f3, (x) => x.tier !== 'OP')) + ' | |');
  L('| 普通赛条数 | ' + num(cnt(t3, (x) => x.tier === 'OP')) + ' | ' + num(cnt(f3, (x) => x.tier === 'OP')) + ' | |');
  L('');
  L('差距全在**单条均分**（' + F(avg(t3)) + ' vs ' + F(avg(f3)) + '，' + F(avg(t3) / avg(f3)) + ' 倍），不在条数。');
  L('');

  /* ── 2 按赛级拆 ─────────────────────────────────────────────── */
  L('══ 2 按赛级拆开看 ══');
  L('');
  L('| 赛级 | | 条数 | 金/银/铜 | 平均场次 | 平均 f | 平均单条 | 小计 |');
  L('|---|---|---|---|---|---|---|---|');
  for (const t of ['WC', 'CC', 'NC', 'OP']) {
    const a = t3.filter((x) => x.tier === t);
    const b = f3.filter((x) => x.tier === t);
    for (const [who, g] of [['Tymon', a], ['Feliks', b]]) {
      if (!g.length) { L('| ' + TIER_CN[t] + ' | ' + who + ' | 0 | — | — | — | — | 0 |'); continue; }
      L('| ' + TIER_CN[t] + ' | ' + who + ' | ' + num(g.length)
        + ' | ' + cnt(g, (x) => x.pos === 1) + '/' + cnt(g, (x) => x.pos === 2) + '/' + cnt(g, (x) => x.pos === 3)
        + ' | ' + num(Math.round(g.reduce((s, x) => s + x.field, 0) / g.length))
        + ' | ' + F(g.reduce((s, x) => s + x.f, 0) / g.length)
        + ' | ' + F(avg(g))
        + ' | **' + F(sum(g)) + '** |');
    }
    L('| | | | | | | | |');
  }
  L('**读法**：普通赛 Feliks 条数更多（' + num(cnt(f3, (x) => x.tier === 'OP')) + ' vs '
    + num(cnt(t3, (x) => x.tier === 'OP')) + '）但小计只差 '
    + F(sum(t3.filter((x) => x.tier === 'OP')) - sum(f3.filter((x) => x.tier === 'OP')))
    + '；锦标赛才是拉开的地方（' + F(sum(t3.filter((x) => x.tier !== 'OP')) - sum(f3.filter((x) => x.tier !== 'OP'))) + '）。');
  L('');

  /* ── 3 锦标赛逐条（两人三阶锦标赛全列表） ───────────────────── */
  L('══ 3 三阶锦标赛逐条（这才是战场）══');
  L('');
  L('| 年 | 赛事 | 赛级 | 名次 | 场次 | 同时代 REF | 规模项 | f | 分 |');
  L('|---|---|---|---|---|---|---|---|---|');
  const tCh = t3.filter((x) => x.tier !== 'OP').sort((a, b) => a.year - b.year || b.field - a.field);
  const fCh = f3.filter((x) => x.tier !== 'OP').sort((a, b) => a.year - b.year || b.field - a.field);
  const dump = (who, a) => {
    L('**' + who + '**（' + num(a.length) + ' 条，合计 ' + F(sum(a)) + '）');
    L('');
    for (const it of a) {
      L('| ' + it.year + ' | ' + it.compName.replace(/\|/g, '/').slice(0, 28) + ' | ' + TIER_CN[it.tier]
        + ' | ' + PLACE_CN[it.pos] + ' | ' + num(it.field) + ' | ' + num(Math.round(it.ref))
        + ' | ' + F(it.scale) + ' | ' + F(it.f) + ' | **' + F(vOf(it)) + '** |');
    }
    L('');
  };
  dump('Tymon', tCh);
  dump('Feliks', fCh);
  L('**规模项** = (hill(场次) ÷ hill(同时代 REF))^0.8015 —— 这场比同时代典型比赛深多少倍。');
  L('**f** = 时代折算（锦标赛取举办国池 / 世锦赛全球池）。');
  L('');

  /* ── 4 归因：三个因子的贡献 ─────────────────────────────────── */
  L('══ 4 归因：差距从哪来 ══');
  L('');
  L('把单条分拆成四个因子：P（名次）× K（赛级）× 规模项 × f。逐个关掉看影响。');
  L('');
  const variant = (a, mut) => a.reduce((s, it) => {
    let v = it.P * it.K * it.scale * it.f * it.w;
    v = mut(it, v);
    return s + v * it.decay * (it.tier === 'OP' ? BETA : 1);
  }, 0);
  const VARIANTS = [
    ['现行（全部因子）', (it, v) => v],
    ['关掉 f（都当 1.0）', (it, v) => v / (it.f || 1)],
    ['关掉规模项（都当 1.0）', (it, v) => v / (it.scale || 1)],
    ['关掉赛级差 K（都当 1.0）', (it, v) => v / (it.K || 1)],
    ['关掉名次差 P（都当 1.0）', (it, v) => v / (it.P || 1e-9)],
    ['关掉普通赛重复衰减（n^-0.5 → 1）', (it, v) => v / (it.decay || 1)],
    ['关掉 β（普通赛不再打折）', (it, v) => (it.tier === 'OP' ? v / BETA : v)],
  ];
  L('| 口径 | Tymon | Feliks | Tymon ÷ Feliks | 相对基准 |');
  L('|---|---|---|---|---|');
  let baseRatio = 0;
  for (const [cn, mut] of VARIANTS) {
    const a = variant(t3, mut); const b = variant(f3, mut);
    const r = a / b;
    if (!baseRatio) baseRatio = r;
    const rel = cn.startsWith('现行') ? '（基准）' : F(r / baseRatio);
    L('| ' + cn + ' | ' + F(a) + ' | ' + F(b) + ' | ' + F(r) + ' | ' + rel + ' |');
  }
  L('');
  L('读法：看「相对基准」列。**倍数掉得最狠的那一行，就是 Tymon 的主优势**；');
  L('倍数反而升高的因子（如名次 P），说明它其实站在 Feliks 一边。');
  L('');

  /* ── 5 少数几条贡献了多少 ───────────────────────────────────── */
  L('══ 5 集中度：前几条扛了多少 ══');
  L('');
  const topShare = (a, k) => {
    const s = a.slice().sort((x, y) => vOf(y) - vOf(x)).slice(0, k).reduce((p, x) => p + vOf(x), 0);
    return s;
  };
  L('| | Tymon | Feliks |');
  L('|---|---|---|');
  for (const k of [1, 3, 5, 10]) {
    L('| 前 ' + k + ' 条单条合计 | ' + F(topShare(t3, k)) + '（' + PCT(topShare(t3, k) / tS) + '） | '
      + F(topShare(f3, k)) + '（' + PCT(topShare(f3, k) / fS) + '） |');
  }
  L('| 最高单条 | ' + F(topShare(t3, 1)) + ' | ' + F(topShare(f3, 1)) + ' |');
  L('');
  L('**Feliks 的分反而更集中**（前 10 条占 ' + PCT(topShare(f3, 10) / fS) + '，Tymon 只占 '
    + PCT(topShare(t3, 10) / tS) + '）——他靠少数几条世锦赛/洲锦赛撑住，普通赛被 β 和 n^-0.5 压得很低；');
  L('Tymon 的分更「摊开」，因为他的锦标赛条数更多、场子更大、单条都贵。');
  L('');

  /* ── 6 年代分布 ─────────────────────────────────────────────── */
  L('══ 6 年代分布（f 的来源）══');
  L('');
  L('| 年代 | Tymon 条数 | Tymon 分 | Tymon 平均 f | Feliks 条数 | Feliks 分 | Feliks 平均 f |');
  L('|---|---|---|---|---|---|---|');
  const buckets = [[2003, 2009], [2010, 2014], [2015, 2019], [2020, 2026]];
  for (const [a, b] of buckets) {
    const x = t3.filter((it) => it.year >= a && it.year <= b);
    const y = f3.filter((it) => it.year >= a && it.year <= b);
    const fAvg = (g) => (g.length ? g.reduce((s, it) => s + it.f, 0) / g.length : 0);
    L('| ' + a + '–' + b + ' | ' + num(x.length) + ' | ' + F(sum(x)) + ' | ' + F(fAvg(x))
      + ' | ' + num(y.length) + ' | ' + F(sum(y)) + ' | ' + F(fAvg(y)) + ' |');
  }
  const wAvg = (g) => (g.length ? g.reduce((s, it) => s + vOf(it) * it.f, 0) / Math.max(sum(g), 1e-9) : 0);
  L('| **加权平均 f** | | | **' + F(wAvg(t3)) + '** | | | **' + F(wAvg(f3)) + '** |');
  L('');
  L('Feliks 的三阶成绩集中在 2010–2019，f 系统性低于 Tymon 的 2019–2026。');
  L('');

  /* ── 7 诚实的边界 ───────────────────────────────────────────── */
  L('══ 7 诚实的边界 ══');
  L('');
  L('- 本对比**只看 333**。两人的全站总分差距（305.26 vs 303.65）是另一个问题，见《M2M3_分项目拆解》。');
  L('- 场次人数 = 该赛事该项目**全部参赛者**（含预赛淘汰者）。');
  L('- 规模项用 hill(500) 封顶，1,100 人场与 600 人场的差距已被压缩（见《M2M3_融合_定稿》第 10 节）。');
  L('- f 对锦标赛取举办国池（CC/NC）或全球池（WC），与 M2-F3 的分池口径不同，见《M2_早年含金量诊断》。');
  L('');

  fs.writeFileSync(path.join(__dirname, 'M2M3_三阶_Tymon_vs_Feliks.md'), OUT.join('\n') + '\n');
  console.error('[done] -> etl/score/M2M3_三阶_Tymon_vs_Feliks.md');
})();

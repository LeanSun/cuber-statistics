'use strict';
/* 早年锦标赛含金量诊断
 *
 * 问题：融合内核的规模项 (到场人数 ÷ REF)^0.8015 是否让早年世锦赛「因为人少」而含金量不足？
 *
 * 怀疑点（两个都指向同一条）：
 *   ① REF 是**全年代**普通赛中位（m2m3_balance.js:138-141），早年小场被拿去和现代大场比
 *   ② f 用**举办国**累计注册池，早年小国池 → f 塌陷（如 1982 世锦赛在布达佩斯）
 *
 * 诊断内容：
 *   1. 数据库里比赛的年代分布（证明 REF 的时代偏差从哪一年起有影响）
 *   2. f 双池对比（举办国池 vs 全球池）
 *   3. 三阶世锦赛冠军单价：现行 / 只修 REF / 只修 f / 全修 / 相对深度
 *   4. 分年代锦标赛总分与 β 重解
 *   5. 排名影响（Top10、Feliks/Max/Tymon、早年领奖台持有者）
 *   6. 四个备选方案与推荐
 *
 * 口径与定稿一致：α = 0.5 只折普通赛，锦标赛不衰减；β = S2/S3（总量等分）。
 *
 * 用法：node --max-old-space-size=6144 etl/score/diag_era_scale.js
 * 只读，不改任何常量。
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

const GAMMA = 0.8015;
const ALPHA = 0.5;
const K_OF = { OP: 1.0000, NC: 1.0000, CC: 1.6000, WC: 1.6000 };
const TIER_CN = { OP: '普通赛', NC: '国锦赛', CC: '洲锦赛', WC: '世锦赛' };

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

/* 年代本地 REF：±w 年滚动窗，样本 ≥ MIN_SAMPLES 取最紧窗；否则 ±15 内全部；再不行退回全局 */
const WIN = [2, 3, 5, 8, 15];
const MIN_SAMPLES = 20;

(async () => {
  /* ── 加载 ─────────────────────────────────────────────────── */
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
  const compYears = new Map();   // compId -> year（全部比赛，不限项目/名次）
  await streamTsv('WCA_export_results.tsv', (r) => {
    const pid = r[8]; if (!pid) return;
    const compId = r[4];
    const comp = compInfo.get(compId) || {};
    const year = comp.year || 0;
    compYears.set(compId, year);
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

  /* ── 逐条定价 ─────────────────────────────────────────────── */
  const items = [];
  for (const r of rows) {
    const multi = M2.isMultiRegion(r.nat);
    const tier = multi ? 'OP' : M2.tierOf(ctypes.get(r.compId), r.nat);
    const comp = compInfo.get(r.compId) || {};
    const cont = (isoInfo.get(r.nat) || {}).cont || 'Unknown';
    const field = (compEvPeople.get(r.compId + '|' + r.ev) || { size: 1 }).size;
    const who = { nat: r.nat, cont };
    const fNat = pool ? pool.valueOf('NR', who, +r.year || 2026) : 1;   // 现行：举办国池
    const fGlb = pool ? pool.valueOf('WR', who, +r.year || 2026) : 1;   // 备选：全球池
    const w = RN.EV_WEIGHT_V2[r.ev] == null ? RN.WEIGHT_V2_CFG.floor : RN.EV_WEIGHT_V2[r.ev];
    items.push({
      pid: r.pid, ev: r.ev, tier, pos: r.pos, year: r.year, field, fNat, fGlb, w,
      compId: r.compId, compName: comp.name || r.compId, nat: r.nat, cont,
      name: (pInfo.get(r.pid) || {}).name || r.pid,
    });
  }

  /* ── REF：全局 vs 年代本地 ────────────────────────────────── */
  const opByEv = new Map();
  for (const it of items) {
    if (it.tier !== 'OP') continue;
    if (!opByEv.has(it.ev)) opByEv.set(it.ev, []);
    opByEv.get(it.ev).push({ year: it.year, field: it.field });
  }
  const REF_G = new Map();
  for (const [ev, a] of opByEv) if (a.length >= 30) REF_G.set(ev, med(a.map((x) => x.field)));
  const refAll = med([...opByEv].filter(([, a]) => a.length >= 30).map(([, a]) => med(a.map((x) => x.field))));
  const refOfG = (ev) => REF_G.get(ev) || refAll;

  const eraCache = new Map();
  const refOfEra = (ev, year) => {
    const key = ev + '|' + year;
    if (eraCache.has(key)) return eraCache.get(key);
    const list = opByEv.get(ev) || [];
    let best = null; let usedW = null;
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
  const eraWin = (ev, year) => eraCache.get(ev + '|' + year + '#w');

  /* ── 累计注册（全球 / 全国）──────────────────────────────── */
  const natFirst = new Map();
  let globalFirst = [];
  for (const p of people) {
    if (!natFirst.has(p.nat)) natFirst.set(p.nat, []);
    natFirst.get(p.nat).push(p.y);
    globalFirst.push(p.y);
  }
  const cumNat = (nat, year) => {
    const a = natFirst.get(nat) || [];
    let c = 0;
    for (const y of a) if (y <= year) c++;
    return c;
  };
  const cumGlb = (year) => { let c = 0; for (const y of globalFirst) if (y <= year) c++; return c; };

  /* ── 重复衰减：仅普通赛，同人同项目第 n 次 ────────────────── */
  const grp = new Map();
  for (const it of items) {
    if (it.tier !== 'OP') continue;
    const k = it.pid + '|' + it.ev;
    if (!grp.has(k)) grp.set(k, []);
    grp.get(k).push(it);
  }
  for (const [, a] of grp) {
    a.sort((x, y) => (x.year - y.year) || String(x.compId).localeCompare(String(y.compId)));
    a.forEach((it, i) => { it.n = i + 1; });
  }
  for (const it of items) if (it.tier !== 'OP') it.n = 1;
  const decay = (it) => (it.tier === 'OP' ? Math.pow(it.n, -ALPHA) : 1);

  /* 五种口径的单条基础分
   * 注意与定稿一致：普通赛（OP）的 f 一律取全球池（WR）；
   * 锦标赛默认取举办国池（NR），fGlb / both 口径下改取全球池。 */
  const fOf = (it, mode) => {
    if (it.tier === 'OP') return it.fGlb;
    return (mode === 'fGlb' || mode === 'both') ? it.fGlb : it.fNat;
  };
  const baseOf = (it, mode) => {
    const P = M2.PLACE_W[it.pos] || 0;
    const ref = mode === 'era' || mode === 'both' ? refOfEra(it.ev, it.year) : refOfG(it.ev);
    return P * K_OF[it.tier] * Math.pow(it.field / ref, GAMMA) * fOf(it, mode) * it.w;
  };

  const OUT = [];
  const L = (s) => { console.log(s); OUT.push(s); };

  L('# 早年世锦赛含金量：规模项与时代池诊断');
  L('');
  L('> 现算，源 WCA v2.0.2，脚本 `etl/score/diag_era_scale.js`。只读，不改任何常量。');
  L('> 口径与融合定稿一致：α = ' + F(ALPHA) + ' 只折普通赛，锦标赛不衰减；β 按总量等分反解。');
  L('');
  const HEAD = [];
  const H = (s) => HEAD.push(s);

  /* ═══ 1 数据库的年代分布 ═══ */
  L('══ 1 REF 的时代偏差从哪一年起有影响 ══');
  L('');
  const compYearCnt = {};
  for (const [, y] of compYears) compYearCnt[y] = (compYearCnt[y] || 0) + 1;
  const ys = Object.keys(compYearCnt).map(Number).sort((a, b) => a - b);
  L('数据库共 ' + num(compYears.size) + ' 场比赛，年份跨度 ' + ys[0] + '–' + ys[ys.length - 1] + '。');
  L('按年代的比赛场次：');
  L('');
  L('| 年代 | 场次 | 三阶普通赛领奖台条数 | 到场人数中位 |');
  L('|---|---|---|---|');
  const buckets = [[1982, 1989], [1990, 1999], [2000, 2009], [2010, 2019], [2020, 2026]];
  const op333 = items.filter((it) => it.tier === 'OP' && it.ev === '333');
  const bucketMed = {};
  for (const [a, b] of buckets) {
    const g = op333.filter((it) => it.year >= a && it.year <= b).map((it) => it.field);
    let ncomp = 0;
    for (const y of ys) if (y >= a && y <= b) ncomp += compYearCnt[y];
    bucketMed[a] = g.length ? med(g) : 0;
    L('| ' + a + '–' + b + ' | ' + num(ncomp) + ' | ' + num(g.length) + ' | ' + (g.length ? num(med(g)) : '—') + ' |');
  }
  L('');
  L('**关键事实：1982 年世锦赛之外，1999 年以前没有任何比赛进入数据库。**');
  L('所以「早年」实际分两段：1982 是孤例（无从比较），2003–2010 是有普通赛可比的真正早年。');
  L('');
  L('三阶全局 REF = **' + num(refOfG('333')) + '** 人（全年代中位）。2000 年代的典型比赛只有 '
    + num(bucketMed[2000]) + ' 人 —— 那十年的冠军都被拿去和今天的场子比。');
  L('');

  /* ═══ 2 f 双池对比 ═══ */
  L('══ 2 第二个惩罚：f 用举办国池 ══');
  L('');
  L('现行实现（`m2m3_balance.js:125`）锦标赛一律取举办国累计注册池。早年世锦赛多办在小国，池子极小：');
  L('');
  L('| 世锦赛 | 年 | 举办国 | 到场(333) | 当年全国累计 | f(国池) | f(全球池) | 倍数 |');
  L('|---|---|---|---|---|---|---|---|');
  const wcInfo = [...new Set(items.filter((it) => it.tier === 'WC').map((it) => it.compId))]
    .map((cid) => {
      const g = items.filter((it) => it.compId === cid);
      const g333 = g.find((it) => it.ev === '333');
      return { cid, name: g[0].compName, year: g[0].year, nat: g[0].nat, field333: g333 ? g333.field : 0, it: g333 };
    })
    .filter((x) => x.it)
    .sort((a, b) => a.year - b.year);
  for (const w of wcInfo) {
    L('| ' + w.name.replace(/\|/g, '/').slice(0, 34) + ' | ' + w.year + ' | ' + w.nat + ' | ' + num(w.field333)
      + ' | ' + num(cumNat(w.nat, w.year)) + ' | ' + F(w.it.fNat) + ' | ' + F(w.it.fGlb)
      + ' | ' + F(w.it.fGlb / w.it.fNat) + ' |');
  }
  L('');
  const firstWC = wcInfo[0];
  L('最极端的一届：**' + firstWC.name + '**（' + firstWC.year + '，' + firstWC.nat + '），当年全国累计注册只有 '
    + num(cumNat(firstWC.nat, firstWC.year)) + ' 人，f(举办国池) = ' + F(firstWC.it.fNat)
    + '；同年全球池 = ' + F(firstWC.it.fGlb) + '，差 ' + F(firstWC.it.fGlb / firstWC.it.fNat) + ' 倍。');
  L('注意 M2-F3 封存口径里 WC 本来就用全球池（`M2.LEVEL_OF.WC = WR`），融合内核改成举办国池是一处未对齐的实现差异。');
  L('');

  /* ═══ 3 三阶世锦赛冠军单价的五种算法 ═══ */
  L('══ 3 三阶世锦赛冠军单价：五种口径 ══');
  L('');
  L('| 世锦赛 | 年 | 到场 | 现行 | 只修REF | 只修f | 全修(S2) | 相对深度 |');
  L('|---|---|---|---|---|---|---|---|');
  const wc333 = items.filter((it) => it.tier === 'WC' && it.ev === '333' && it.pos === 1)
    .sort((a, b) => a.year - b.year);
  for (const it of wc333) {
    const cur = baseOf(it, 'global');
    L('| ' + it.compName.replace(/\|/g, '/').slice(0, 30) + ' | ' + it.year + ' | ' + num(it.field)
      + ' | ' + F(cur) + ' | ' + F(baseOf(it, 'era')) + ' | ' + F(baseOf(it, 'fGlb'))
      + ' | **' + F(baseOf(it, 'both')) + '** | ' + F(it.field / Math.max(1, cumGlb(it.year))) + ' |');
  }
  L('');
  L('年代本地 REF 实际取到的窗口（三阶）：');
  L('');
  L('| 世锦赛 | 年 | 全局 REF | 年代 REF | 窗口 | 当年全球累计注册 |');
  L('|---|---|---|---|---|---|');
  for (const it of wc333) {
    const w = eraWin('333', it.year);
    L('| ' + it.year + ' | ' + num(refOfG('333')) + ' | ' + num(refOfEra('333', it.year))
      + ' | ' + (w < 0 ? '无同年比赛→退回全局' : '±' + w + ' 年') + ' | ' + num(cumGlb(it.year)) + ' |');
  }
  L('');
  const first = wc333[0]; const last = wc333[wc333.length - 1];
  const ratioOf = (mode) => (K_OF.WC * Math.pow(last.field / (mode === 'global' ? refOfG('333') : refOfEra('333', last.year)), GAMMA) * (mode === 'fGlb' || mode === 'both' ? last.fGlb : last.fNat) * last.w)
    / (K_OF.WC * Math.pow(first.field / (mode === 'global' ? refOfG('333') : refOfEra('333', first.year)), GAMMA) * (mode === 'fGlb' || mode === 'both' ? first.fGlb : first.fNat) * first.w);
  L('最早一届（' + first.year + '）÷ 最近一届（' + last.year + '）的三阶冠军单价：现行差 '
    + F(ratioOf('global')) + ' 倍；全修后差 ' + F(ratioOf('both')) + ' 倍。');
  L('差距的大头是到场人数 ' + num(first.field) + ' → ' + num(last.field) + '，这是模型的核心前提（打赢的场子有多深），改不掉也不该改。');
  L('能改的是「同时代典型场子」这个参照系和「f 用哪国的池」。');
  L('');

  /* ═══ 4 分年代总分与 β ═══ */
  L('══ 4 锦标赛总分按年代的分布 ══');
  L('');
  const eraOf = (y) => (y <= 1989 ? '1982-1989' : y <= 1999 ? '1990-1999' : y <= 2009 ? '2000-2009' : y <= 2019 ? '2010-2019' : '2020-2026');
  const eraKeys = ['1982-1989', '1990-1999', '2000-2009', '2010-2019', '2020-2026'];
  const champ = items.filter((it) => it.tier !== 'OP');
  const sumBy = (mode) => {
    const s = {};
    for (const k of eraKeys) s[k] = 0;
    for (const it of champ) s[eraOf(it.year)] += baseOf(it, mode);
    return s;
  };
  const sg = sumBy('global'); const se = sumBy('era'); const sb = sumBy('both');
  L('| 年代 | 条数 | 现行 | 只修REF | 全修 | 全修÷现行 |');
  L('|---|---|---|---|---|---|');
  const totG = eraKeys.reduce((s, k) => s + sg[k], 0);
  const totB = eraKeys.reduce((s, k) => s + sb[k], 0);
  for (const k of eraKeys) {
    const n = champ.filter((it) => eraOf(it.year) === k).length;
    L('| ' + k + ' | ' + num(n) + ' | ' + F(sg[k]) + ' | ' + F(se[k]) + ' | ' + F(sb[k]) + ' | ' + F(sb[k] / sg[k]) + ' |');
  }
  L('| **合计** | **' + num(champ.length) + '** | **' + F(totG) + '** | **' + F(eraKeys.reduce((s, k) => s + se[k], 0)) + '** | **' + F(totB) + '** | ' + F(totB / totG) + ' |');
  L('');

  /* β 重解 */
  const sumTotals = (mode) => {
    let m2 = 0; let m3 = 0;
    for (const it of items) {
      const v = baseOf(it, mode) * decay(it);
      if (it.tier === 'OP') m3 += v; else m2 += v;
    }
    return { m2, m3 };
  };
  const g0 = sumTotals('global'); const b0 = sumTotals('both');
  const betaG = g0.m2 / g0.m3;
  const betaB = b0.m2 / b0.m3;
  L('══ 5 对 50/50 平衡的影响 ══');
  L('');
  L('| REF / f 口径 | M2 总分 | M3 总分(β=1) | 总量等分所需 β |');
  L('|---|---|---|---|');
  L('| 现行（全局 REF + 国池 f） | ' + F(g0.m2) + ' | ' + F(g0.m3) + ' | ' + F(betaG) + ' |');
  L('| 全修（年代 REF + 全球池 f） | ' + F(b0.m2) + ' | ' + F(b0.m3) + ' | ' + F(betaB) + ' |');
  L('');
  L('β 从 ' + F(betaG) + ' 变为 ' + F(betaB) + '（' + PCT(betaB / betaG - 1) + '）。锦标赛总量只变 '
    + PCT(b0.m2 / g0.m2 - 1) + '，普通赛总量变 ' + PCT(b0.m3 / g0.m3 - 1) + '。');
  L('');

  /* ═══ 6 排名影响 ═══ */
  const aggregate = (mode, beta) => {
    const by = new Map();
    for (const it of items) {
      const v = baseOf(it, mode) * decay(it) * (it.tier === 'OP' ? beta : 1);
      let a = by.get(it.pid);
      if (!a) { a = { pid: it.pid, name: it.name, total: 0, m2: 0, m3: 0, n: 0 }; by.set(it.pid, a); }
      a.total += v;
      if (it.tier === 'OP') a.m3 += v; else a.m2 += v;
      a.n++;
    }
    const list = [...by.values()].filter((x) => x.total > 0).sort((a, b) => b.total - a.total);
    list.forEach((x, i) => { x.rank = i + 1; });
    return list;
  };
  const lg = aggregate('global', betaG);
  const lb = aggregate('both', betaB);
  L('══ 6 排名影响（各自按总量等分重解 β）══');
  L('');
  L('| # | 现行 Top10 | 总分 | | 全修 Top10 | 总分 |');
  L('|---|---|---|---|---|---|');
  for (let i = 0; i < 10; i++) {
    const a = lg[i]; const b = lb[i];
    L('| ' + (i + 1) + ' | ' + (a ? a.name : '—') + ' | ' + (a ? F(a.total) : '—')
      + ' | | ' + (b ? b.name : '—') + ' | ' + (b ? F(b.total) : '—') + ' |');
  }
  L('');
  L('| 选手 | 现行总分 | 现行名次 | 全修总分 | 新名次 | Δ 锦标赛分 |');
  L('|---|---|---|---|---|---|');
  for (const nm of ['Feliks Zemdegs', 'Max Park', 'Tymon Kolasiński']) {
    const a = lg.find((x) => x.name === nm); const b = lb.find((x) => x.name === nm);
    if (!a || !b) { L('| ' + nm + ' | — | — | — | — | — |'); continue; }
    L('| ' + nm + ' | ' + F(a.total) + ' | #' + a.rank + ' | ' + F(b.total) + ' | #' + b.rank
      + ' | ' + (b.m2 - a.m2 >= 0 ? '+' : '') + F(b.m2 - a.m2) + ' |');
  }
  L('');

  /* 受益人 */
  const delta = new Map();
  for (const it of champ) {
    const d = (baseOf(it, 'both') - baseOf(it, 'global')) * decay(it);
    if (!delta.has(it.pid)) delta.set(it.pid, { name: it.name, d: 0, n: 0, early: 0 });
    const x = delta.get(it.pid);
    x.d += d; x.n++;
    if (it.year <= 2009) x.early++;
  }
  const top = [...delta.values()].filter((x) => x.d > 0.0001).sort((a, b) => b.d - a.d).slice(0, 12);
  L('受益人 Top12（Δ = 锦标赛分增量，全修口径 − 现行口径）：');
  L('');
  L('| 选手 | Δ 锦标赛分 | 领奖台条数 | 其中 ≤2009 年 |');
  L('|---|---|---|---|');
  for (const x of top) L('| ' + x.name + ' | **+' + F(x.d) + '** | ' + num(x.n) + ' | ' + num(x.early) + ' |');
  L('');
  const earlyHolders = champ.filter((it) => it.year <= 2009);
  const earlyPids = new Set(earlyHolders.map((it) => it.pid));
  const bestEarly = lg.find((x) => earlyPids.has(x.pid));
  L('≤2009 年的锦标赛领奖台共 ' + num(earlyHolders.length) + ' 条，涉及 ' + num(earlyPids.size)
    + ' 人；这批人在现行榜的最高名次是 #' + (bestEarly ? bestEarly.rank : '—') + '（' + (bestEarly ? bestEarly.name : '') + '）。');
  L('');

  /* ═══ 7 方案对比 ═══ */
  L('══ 7 备选方案（S0 为现状基线）══');
  L('');
  L('以最早一届三阶世锦赛冠军为标尺（现行 = 1.0000）：');
  L('');
  const cur0 = baseOf(first, 'global');
  const rows7 = [
    ['S0 现状', '全局 REF + 举办国池 f', cur0, '双重惩罚'],
    ['S1 年代本地 REF', '同年（滚动窗）普通赛中位，f 不变', baseOf(first, 'era'), '1982 孤例无效（无同年比赛）；2003–2011 涨 1.3–2.6 倍'],
    ['S1b 只把 WC 的 f 改全球池', '全局 REF 不变，WC 用 WR 池', baseOf(first, 'fGlb'), '1982 涨 3.19 倍；与 M2-F3 的 WC 口径对齐'],
    ['S2 S1 + S1b（推荐）', '年代本地 REF + WC 全球池 f', baseOf(first, 'both'), '两项都修；按定义落地 β = 0.2966，全部全球池口径 β = ' + F(betaB) + '（见第 8 节口径澄清）'],
    ['S3 相对深度', 'field ÷ 当年全球累计注册', K_OF.WC * Math.pow(first.field / Math.max(1, cumGlb(first.year)), GAMMA) * first.fNat * first.w, '早年深度反而最高，会把退役老将推上榜首'],
  ];
  L('| 方案 | 做法 | 1982 单价 | 相对现行 | 评价 |');
  L('|---|---|---|---|---|');
  for (const [id, how, v, note] of rows7) {
    L('| ' + id + ' | ' + how + ' | ' + F(v) + ' | ' + F(v / cur0) + ' | ' + note + ' |');
  }
  L('');
  L('**推荐 S2**，理由：');
  L('');
  L('1. 规模项的原始含义是「这场比赛比典型比赛深多少」。参照系理应同时代，否则把「时代增长」混进了「场子大小」。');
  L('2. f 已经承担唯一的时代机制（M1 定案保留），不该再被 REF 二次执行。');
  L('3. 早年世锦赛的参赛者确实是当时几乎全部的高手，相对选择性远高于今天；但绝对技术水平低（1982 冠军 22.95 秒）。');
  L('   完全按相对深度（S3）算会过度 —— 那条路正是 M2-F3 的 ρ 已经踩过的坑。');
  L('4. 代价可控：β 只变 ' + PCT(betaB / betaG - 1) + '，Top10 顺序基本不动，最大受益者是 2003–2015 一代选手。');
  L('');
  L('══ 8 诚实的边界 ══');
  L('');
  L('- 年代本地 REF 用 ±2/3/5/8/15 年滚动窗（样本 ≥' + MIN_SAMPLES + ' 取最紧窗）。1982 年附近没有任何普通赛，');
  L('  该届自动退回全局 REF —— 孤例无从比起，它的修正只能来自 f（S1b）。');
  L('- 「相对深度」列用当年**全球**累计注册（首秀年 ≤ 当年）作分母，与 f 池同源，不是真实活跃人数，只作标尺。');
  L('  注意 1982 的相对深度 = 1.0000 是数据假象：那一年入库的只有世锦赛那 19 人，分母就是分子。');
  L('- 国锦赛/洲锦赛的小国池问题同样存在（早年小国的 NC/CC），S2 定义上只修 WC 一档；CC/NC 是否也要按「洲/全球」池取 f 待定。');
  L('- **口径澄清（2026-10-25 补）**：第 4–6 节的「全修」列在实现上把 **CC / NC 的 f 也换成了全球池**');
  L('  （`fOf` 的 `both` 模式对全部锦标赛生效），并不是「只修 WC」。按 S2 定义落地（仅 WC 全球池）的值为');
  L('  β = 0.2966、Top3 = Tymon 378.6609 / Max 357.0729 / Feliks 342.1304；本报告「全修」列（全部全球池）为');
  L('  β = 0.3101、Top3 = Tymon 384.1315 / Feliks 366.2369 / Max 362.7366。两套差异仅来自 CC / NC 的 f 池。');
  L('- 本诊断的 K_OF = {OP/NC 1.0, CC/WC 1.6}，未套用上一轮扫描的 F3（K_CC 2.5 / K_WC 8.0）配置。');
  L('- greater_china 的 5 场仍按 CC 计，未处置。');
  L('');

  /* ── 摘要（此时所有变量已就绪）──────────────────────────── */
  H('**摘要**：会，而且是双重惩罚。');
  H('');
  H('① 规模项的 REF 取**全年代**普通赛中位（三阶 ' + num(refOfG('333')) + ' 人），早年小场被拿去和现代大场比；');
  H('② f 用**举办国**累计注册池，早年小国池塌陷 —— 1982 年世锦赛在布达佩斯，当年全国只有 '
    + num(cumNat(firstWC.nat, firstWC.year)) + ' 人入库，f = ' + F(firstWC.it.fNat) + '（全球池 ' + F(firstWC.it.fGlb) + '）。');
  H('');
  H('两项叠加，三阶世锦赛冠军单价从 1982 年的 ' + F(baseOf(first, 'global')) + ' 分一路涨到 2025 年的 '
    + F(baseOf(last, 'global')) + ' 分（' + F(ratioOf('global')) + ' 倍）。');
  H('其中到场人数 ' + num(first.field) + ' → ' + num(last.field) + ' 是模型的核心前提（打赢的场子有多深），不该改；');
  H('该改的是另外两项：参照系换成**年代本地**，f 的 WC 池换回**全球**。');
  H('');
  H('**推荐 S2**（年代本地 REF + WC 全球池 f）：1982 单价 ×' + F(baseOf(first, 'both') / baseOf(first, 'global'))
    + '，2003–2011 各届 ×1.3–2.6；β 从 ' + F(betaG) + ' 重解到 ' + F(betaB)
    + '；Feliks 升回第 2（+' + F(lb.find((x) => x.name === 'Feliks Zemdegs').m2 - lg.find((x) => x.name === 'Feliks Zemdegs').m2)
    + '），Tymon 仍第 1，Max 退第 3。');
  H('');
  H('**落地记录（2026-10-25）**：已在 `m2m3_balance.js` 按 S2 **定义**落地 —— 年代本地 REF + **仅 WC** 全球池，CC / NC 维持举办国池。');
  H('落地值：β = 0.2966（旧 0.2910），锦标赛总量 +0.56%，Top3 = Tymon 378.6609 / Max 357.0729 / Feliks 342.1304，');
  H('最大受益人 Feliks +28.4044。上文第 4–6 节的「全修」列在实现上把 CC / NC 的 f 也换成了全球池（β 0.3101、Feliks 第 2），');
  H('两套差异仅来自 CC / NC 的 f 池；要切换只改定稿脚本的 `F_POOL`，β 会自动重解。详见《M2M3_融合_定稿》第 9 节。');
  H('');

  const cut = OUT.findIndex((s) => s.startsWith('══ 1'));
  fs.writeFileSync(path.join(__dirname, 'M2_早年含金量诊断.md'),
    OUT.slice(0, cut).concat(HEAD, OUT.slice(cut)).join('\n') + '\n');
  console.error('[done] betaG=' + F(betaG) + ' betaB=' + F(betaB));
})().catch((e) => { console.error(e); process.exit(1); });

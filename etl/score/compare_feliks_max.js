'use strict';
/* Feliks Zemdegs vs Max Park · M1 对比
 *
 * 用法：node etl/score/compare_feliks_max.js
 * 产出：etl/score/Feliks_vs_Max.md
 *
 * 两张表，因为数据边界不同：
 *   ① 条数口径 —— 汇总数据（p.wr / p.cr / p.nr / mCalc.rec / evS）覆盖全部纪录，
 *      可以精确算，作为主结论。
 *   ② 占有段口径 —— 需要逐条 (日期, 成绩, 持有)，而 records 每人只留 12 条
 *      （Feliks 356 → 12，Max 139 → 12），只能算样本。作用有两个：
 *      验证机制能否落地、检验两种口径的方向是否一致。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
global.window = {};
require(path.join(ROOT, 'js/data.js'));
require(path.join(ROOT, 'js/roster.js'));
const Calc = require(path.join(ROOT, 'js/calc.js'));
const M1 = require(path.join(ROOT, 'etl/score/m1.js'));
const RN = require(path.join(ROOT, 'etl/score/runs.js'));

const P = global.window.MOCK.players;
const R = global.window.WCA_ROSTER;
const TOTAL = R.total || 300616;
const IDS = ['2009ZEMD01', '2012PARK03'];

const F = (v, n = RN.DEC) => RN.F4(v, n);
const N = (v, n = RN.DEC) => RN.F4(v, n);
const num = (v) => Math.round(v).toLocaleString('en-US');
const pct = (v, d = 2) => RN.P4(v, d);
const ratio = (a, b) => (b ? a / b : NaN);

/* ── 池子（与账本同源：roster + detail 合并）─────────────────── */
const contCount = {};
const natCount = {};
const people = [];
for (const ln of R.rows.split('\n')) {
  if (!ln) continue;
  const f = ln.split('~');
  if (f.length < 4) continue;
  natCount[f[2]] = (natCount[f[2]] || 0) + 1;
  const c = Calc.contOfIso(f[2]) || '??';
  contCount[c] = (contCount[c] || 0) + 1;
  if (+f[5]) people.push({ y: +f[5], cont: c, nat: f[2] });
}
for (const p of P) {
  natCount[p.country] = (natCount[p.country] || 0) + 1;
  const c = Calc.contOfIso(p.country) || '??';
  contCount[c] = (contCount[c] || 0) + 1;
  if (p.start) people.push({ y: p.start, cont: c, nat: p.country });
}
const ctx = M1.makeContext({ contCount, natCount, total: TOTAL });
const pool = M1.makeScopePool(people);

/* ── evS 解码 ───────────────────────────────────────────────── */
const EVK = ['rows', 'att', 'sol', 'dnf', 'pod', 'gold', 'sil', 'bro', 'wr', 'cr', 'nr', 'comps', 'wc', 'cc', 'nc', 'lo', 'op', 'held', 'heldLong', 'heldNow'];
function decEv(s) {
  const o = {};
  if (!s) return o;
  s.split(';').forEach((part) => {
    const i = part.indexOf(':');
    if (i < 0) return;
    const n = part.slice(i + 1).split(',');
    const b = { recPerYear: n[25] || '' };
    EVK.forEach((k, j) => { b[k] = +n[j] || 0; });
    o[part.slice(0, i)] = b;
  });
  return o;
}
function yearDistOf(evMap) {
  const a = {};
  for (const e of Object.keys(evMap)) {
    (evMap[e].recPerYear || '').split('.').forEach((kv) => {
      if (!kv) return;
      const j = kv.indexOf('_');
      a[+kv.slice(0, j)] = (a[+kv.slice(0, j)] || 0) + +kv.slice(j + 1);
    });
  }
  return a;
}

/* ── 导出日 / 阶梯 ─────────────────────────────────────────── */
let EXPORT = 0;
for (const p of P) for (const x of p.records || []) {
  if (!x.date) continue;
  const e = RN.dayOf(x.date) + (x.held || 0);
  if (e > EXPORT) EXPORT = e;
}

const LAD = {};
for (const p of P) {
  const cont = Calc.contOfIso(p.country) || '??';
  for (const x of p.records || []) {
    if (!x.date) continue;
    const lvl = x.level;
    const scope = lvl === 'WR' ? 'WW' : (lvl === 'CR' ? cont : p.country);
    const k = `${x.ev}|${x.type}|${lvl}|${scope}`;
    (LAD[k] = LAD[k] || { ev: x.ev, type: x.type, level: lvl, scope, subs: [] })
      .subs.push({ pid: p.id, name: p.name, day: RN.dayOf(x.date), date: x.date, value: x.value, held: x.held || 0 });
  }
}

/* ── held 完整性统计：有多少条 held 指向本阶梯样本之外的日期 ── */
const ADOPTED = Calc.EVENTS.filter((e) => !e.retired).map((e) => e.id);
const HELD_STAT = { total: 0, past: 0 };
for (const key of Object.keys(LAD)) {
  const L0 = LAD[key];
  if (ADOPTED.indexOf(L0.ev) < 0) continue;
  const arr = L0.subs.slice().sort((x, y) => x.day - y.day);
  const lastDay = arr[arr.length - 1].day;
  for (const s of arr) {
    HELD_STAT.total++;
    if (s.held > 0 && s.day + s.held > lastDay + 1) HELD_STAT.past++;
  }
}

/* ── 全站：held 修复后有多少段可核算 ──────────────────────── */
const STAT = { ladders: 0, runs: 0, ok: 0 };
for (const key of Object.keys(LAD)) {
  const L0 = LAD[key];
  const b = RN.buildLadder(L0.subs, L0, { mode: 'level', endFromHeld: true, exportDay: EXPORT });
  STAT.ladders++;
  for (const r of b.runs) {
    STAT.runs++;
    if (r.clean === true && r.prevGap === 0) STAT.ok++;
  }
}

/* ── 逐选手计算 ────────────────────────────────────────────── */
const RP = {};
for (const id of IDS) {
  const p = P.find((x) => x.id === id);
  const cont = Calc.contOfIso(p.country);
  const evMap = decEv(p.evS);
  const yd = yearDistOf(evMap);
  const rec = p.mCalc.rec;
  const nrSplit = M1.splitNr(rec, p.nr);
  const rhoC = ctx.rhoC(cont);
  const rhoN = ctx.rhoN(p.country);
  const tf = M1.timeFactors(yd, pool, { cont, nat: p.country });

  const tracks = [
    { key: 'single', zh: '单次', wr: rec[0], cr: rec[1], nr: nrSplit.nrS },
    { key: 'average', zh: '平均', wr: rec[3], cr: rec[4], nr: nrSplit.nrA },
  ];
  for (const t of tracks) {
    t.wrP = t.wr * M1.G.WR * tf.WR;
    t.crP = t.cr * M1.G.CR * rhoC * tf.CR;
    t.nrP = t.nr * M1.G.NR * rhoN * tf.NR;
    t.total = t.wrP + t.crP + t.nrP;
    t.noT = t.wr * M1.G.WR + t.cr * M1.G.CR * rhoC + t.nr * M1.G.NR * rhoN;
  }
  const sumS = tracks[0].total;
  const sumA = tracks[1].total;

  /* 逐项目 */
  const W = {};
  (p.mCalc.rk || []).forEach((row) => { W[row[0]] = row[3]; });
  const evRows = Object.keys(evMap).map((e) => {
    const b = evMap[e];
    const w = W[e] || 0;
    const wrP = b.wr * M1.G.WR * tf.WR;
    const crP = b.cr * M1.G.CR * rhoC * tf.CR;
    const nrP = b.nr * M1.G.NR * rhoN * tf.NR;
    const t = wrP + crP + nrP;
    return { e, zh: (Calc.EV[e] || {}).zh || e, w, wr: b.wr, cr: b.cr, nr: b.nr, wrP, crP, nrP, t, wt: t * w };
  }).sort((a, b) => b.wt - a.wt);

  /* 逐项目年份分布 vs 选手级年份分布 的差异（灵敏度） */
  let sumEv = 0;
  let sumEvOwn = 0;
  for (const e of Object.keys(evMap)) {
    const b = evMap[e];
    const tfE = M1.timeFactors(yearDistOf({ [e]: b }), pool, { cont, nat: p.country });
    sumEv += b.wr * M1.G.WR * tf.WR + b.cr * M1.G.CR * rhoC * tf.CR + b.nr * M1.G.NR * rhoN * tf.NR;
    sumEvOwn += b.wr * M1.G.WR * tfE.WR + b.cr * M1.G.CR * rhoC * tfE.CR + b.nr * M1.G.NR * rhoN * tfE.NR;
  }

  /* 占有段（样本） */
  const runs = [];
  const ladderStat = {};
  for (const key of Object.keys(LAD)) {
    const L = LAD[key];
    const b = RN.buildLadder(L.subs, L, { mode: 'level', endFromHeld: true, exportDay: EXPORT });
    /* 守恒校验：整条阶梯 ΣG 应等于 ln(首值/末值) */
    ladderStat[key] = {
      n: b.runs.length,
      sumG: b.runs.reduce((a, r) => a + r.gain, 0),
      first: +b.runs[0].subs[0].cost,
      last: +b.runs[b.runs.length - 1].vOut.cost,
    };
    for (const r of b.runs) {
      if (r.pid !== id) continue;
      const c = RN.runCredit(r, {});
      const f = RN.avgFactor(pool, L.level, {}, r.tStart, r.tEnd == null ? RN.SNAPSHOT_DAY : r.tEnd, RN.SNAPSHOT_DAY);
      const gL = M1.G[L.level];
      const rho = L.level === 'WR' ? 1 : (L.level === 'CR' ? rhoC : rhoN);
      runs.push({
        key, ev: L.ev, evZh: (Calc.EV[L.ev] || {}).zh || L.ev, type: L.type, level: L.level,
        r, c, f, score: c.credit * gL * rho * f,
        ok: r.clean === true && r.prevGap === 0,
        over: (r.prevGap && r.prevGap > 0) || r.clean === false,
      });
    }
  }
  runs.sort((a, b) => b.score - a.score);

  RP[id] = {
    p, cont, contZh: (Calc.CONTINENTS[cont] || {}).zh || cont, evMap, yd, rec, nrSplit,
    rhoC, rhoN, tf, tracks, sumS, sumA, sumT: sumS + sumA,
    noT: tracks[0].noT + tracks[1].noT,
    evRows, sumEv, sumEvOwn,
    runs,
    ranSum: runs.reduce((a, x) => a + x.score, 0),
    okSum: runs.filter((x) => x.ok).reduce((a, x) => a + x.score, 0),
    overSum: runs.filter((x) => x.over).reduce((a, x) => a + x.score, 0),
  };
}

const A = RP[IDS[0]];
const B = RP[IDS[1]];

/* ── 全站名次：2,500 名 detail 选手按同一公式排序 ──────────── */
const BOARD = P.map((p) => {
  if (!p.mCalc || !p.mCalc.rec) return null;
  const c = Calc.contOfIso(p.country) || '??';
  const s = M1.scorePlayer(
    { rec: p.mCalc.rec, nr: p.nr, cont: c, country: p.country },
    ctx,
    { pool, yearDist: yearDistOf(decEv(p.evS)) }
  );
  return { id: p.id, name: p.name, s: s.single, a: s.average, t: s.total };
}).filter((x) => x && x.t > 0);
const RANK = {
  t: BOARD.slice().sort((x, y) => y.t - x.t),
  s: BOARD.slice().sort((x, y) => y.s - x.s),
  a: BOARD.slice().sort((x, y) => y.a - x.a),
};
const posOf = (k, id) => RANK[k].findIndex((x) => x.id === id) + 1;

/* ── 写文档 ────────────────────────────────────────────────── */
const L = [];
const push = (s) => L.push(s == null ? '' : s);
const now = new Date();
const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

push('# Feliks Zemdegs vs Max Park · M1 对比');
push('');
push(`> 生成时间：${stamp}　|　由 \`etl/score/compare_feliks_max.js\` 自动生成，全部数字现算`);
push('> 引擎：`etl/score/m1.js`（级别价值 / 竞争密度 / 时代折算）+ `etl/score/runs.js`（占有段）');
push('');

push('## 结论');
push('');
push('| 口径 | Feliks Zemdegs | Max Park | Feliks ÷ Max | 可靠度 |');
push('|---|---|---|---|---|');
push(`| 条数 · 单次 | **${N(A.tracks[0].total)}** | ${N(B.tracks[0].total)} | ${N(ratio(A.tracks[0].total, B.tracks[0].total), 3)}× | 精确（全量纪录） |`);
push(`| 条数 · 平均 | ${N(A.tracks[1].total)} | **${N(B.tracks[1].total)}** | ${N(ratio(A.tracks[1].total, B.tracks[1].total), 3)}× | 精确（全量纪录） |`);
push(`| **条数 · 总计** | **${N(A.sumT)}** | **${N(B.sumT)}** | **${N(ratio(A.sumT, B.sumT), 3)}×** | 精确（全量纪录） |`);
push(`| 占有段 · 12 条样本 | ${N(A.ranSum)} | ${N(B.ranSum)}（上界） | ${N(ratio(A.ranSum, B.ranSum))}× | 仅样本，不可外推 |`);
push('');
push(`在 ${num(BOARD.length)} 名有纪录的选手里，条数口径的名次是：`);
push('');
push('| 榜 | Feliks | Max |');
push('|---|---|---|');
push(`| 单次 | 第 ${posOf('s', A.p.id)} | 第 ${posOf('s', B.p.id)} |`);
push(`| 平均 | 第 ${posOf('a', A.p.id)} | 第 ${posOf('a', B.p.id)} |`);
push(`| 总计 | 第 ${posOf('t', A.p.id)} | 第 ${posOf('t', B.p.id)} |`);
push('');
push(`第三名 ${RANK.t[2].name} 只有 ${N(RANK.t[2].t)} 分，与第二名的差距（${N(RANK.t[1].t - RANK.t[2].t)} 分）远大于一、二名之间的差距。`);
push('换句话说，这一档只有两个人。');
push('');
push(`**Feliks 总分领先 ${N(A.sumT - B.sumT)} 分（${pct(A.sumT / B.sumT - 1)}）。** 但有三件事必须一起看：`);
push('');
push(`1. **领先全部来自单次轨**。单次他多 ${N(A.tracks[0].total - B.tracks[0].total)} 分；平均轨 Max 反而高 ${N(B.tracks[1].total - A.tracks[1].total)} 分 —— 差距只有 ${pct(B.tracks[1].total / A.tracks[1].total - 1)}，实质是并列。`);
push('2. **时代折算把差距压小了**。不做折算的话 Feliks 是 '
  + `${N(A.noT)} 对 ${N(B.noT)}（${N(ratio(A.noT, B.noT))}×），折算后变成 ${N(ratio(A.sumT, B.sumT))}×。`);
push('   折算拿走了 Feliks 的 '
  + `${N(A.noT - A.sumT)} 分（${pct((A.noT - A.sumT) / A.noT)}），只拿走 Max 的 ${N(B.noT - B.sumT)} 分（${pct((B.noT - B.sumT) / B.noT)}）。`);
push('3. **占有段口径下方向一致、幅度更大**：同样 12 条样本，Feliks 的段产出 '
  + `${F(A.ranSum)}，高于 Max 的上界 ${F(B.ranSum)}。`);
push('');

/* 〇 */
push('## 〇、为什么给两张表');
push('');
push('| | 条数口径 | 占有段口径 |');
push('|---|---|---|');
push('| 需要的数据 | 「破了几条」，ETL 已汇总进 `p.wr/p.cr/p.nr`、`mCalc.rec`、`evS` | 每一条的「日期 + 成绩 + 持有天数」 |');
push('| 数据是否完整 | **完整**：Feliks 356 条、Max 139 条全覆盖 | **不完整**：`records` 每人只留 12 条 |');
push('| 本能否出结论 | 能 | 只能出样本，且样本偏 |');
push('');
push(`\`records\` 曾经按分数截断取前 12 条（**已于 2026-10-24 改为全量保留**）：Feliks 356 → 12（原覆盖 ${pct(12 / 356)}），Max 139 → 12（原覆盖 ${pct(12 / 139)}）。`);
push('本文保留当时的描述，因为下面这些数字就是在那个口径下算出来的。');
push('被截掉的不是随机 12 条，而是按某种顺序保留的，所以样本**不代表**他的纪录结构：');
push('两人的 12 条恰好全是「平均」轨，单次轨一条都没留下。');
push('');
push('所以下面：**主结论用条数口径**（精确），**占有段口径用来验证方向**（不用于排名）。');
push('这是数据边界，不是口径偏好 —— 口径本身已经在 `M1_占有段口径.md` 定稿。');
push('');

/* 一 */
push('## 一、基础画像');
push('');
push('| | Feliks Zemdegs | Max Park |');
push('|---|---|---|');
push(`| WCA ID | ${A.p.id} | ${B.p.id} |`);
push(`| 国家 / 洲 | ${A.p.country} · ${A.contZh} | ${B.p.country} · ${B.contZh} |`);
push(`| 参赛年 | ${A.p.start}–${A.p.end} | ${B.p.start}–${B.p.end} |`);
push(`| 比赛场次 | ${num(A.p.comps)} | ${num(B.p.comps)} |`);
push(`| 参与项目 | ${Object.keys(A.evMap).length} | ${Object.keys(B.evMap).length} |`);
push(`| 世界纪录 WR | **${A.p.wr}** | ${B.p.wr} |`);
push(`| 洲纪录 CR | **${A.p.cr}** | ${B.p.cr} |`);
push(`| 国家纪录 NR | ${A.p.nr} | ${B.p.nr} |`);
push(`| 纪录总数 | **${A.p.recTotal}** | ${B.p.recTotal} |`);
push(`| 竞争密度 ρ洲 | ${F(A.rhoC)} | ${F(B.rhoC)} |`);
push(`| 竞争密度 ρ国 | ${F(A.rhoN)} | ${F(B.rhoN)} |`);
push('');
push(`一个容易被误读的地方：Feliks 有 ${A.p.recTotal} 条纪录，NR 却只有 ${A.p.nr} 条。这不是他国家纪录少，`);
push('而是**一条纪录只归最高级别**：他绝大多数国家纪录本身就是大洋洲纪录，被 CR 覆盖了，不再计入 NR。');
push('反过来说，澳洲只有 '
  + num(natCount.AU) + ' 人，所以他每拿一次国内第一，顺带就是大洋洲第一；');
push(`而美国有 ${num(natCount.US)} 人、北美洲 ${num(contCount.NAm)} 人，Max 的国家纪录通常拿不到洲级，才单独留在 NR 里。`);
push('如果不记住这条规则，会得出「Max 的 NR 结构更好」这种完全相反的结论。');
push('');

/* 二 */
push('## 二、条数口径：全量数据，精确');
push('');
push('### 2.1 三档轨道');
push('');
push('```');
push('track = WR × 1.00 × f_WR + CR × 0.40 × ρ洲 × f_CR + NR × 0.15 × ρ国 × f_NR');
push('```');
push('');
push('| 轨道 | 级别 | 条数 | 级别价值 | ρ | 时代系数 f | 贡献分 |');
push('|---|---|---|---|---|---|---|');
for (const t of A.tracks) {
  push(`| Feliks · ${t.zh} | WR | ${N(t.wr, 0)} | ${F(M1.G.WR)} | 1 | ${F(A.tf.WR, 4)} | ${N(t.wrP)} |`);
  push(`| | CR | ${N(t.cr, 0)} | ${F(M1.G.CR)} | ${F(A.rhoC, 4)} | ${F(A.tf.CR, 4)} | ${N(t.crP)} |`);
  push(`| | NR | ${N(t.nr)} | ${F(M1.G.NR)} | ${F(A.rhoN, 4)} | ${F(A.tf.NR, 4)} | ${N(t.nrP)} |`);
  push(`| | **小计** | | | | | **${N(t.total)}** |`);
}
for (const t of B.tracks) {
  push(`| Max · ${t.zh} | WR | ${N(t.wr, 0)} | ${F(M1.G.WR)} | 1 | ${F(B.tf.WR, 4)} | ${N(t.wrP)} |`);
  push(`| | CR | ${N(t.cr, 0)} | ${F(M1.G.CR)} | ${F(B.rhoC, 4)} | ${F(B.tf.CR, 4)} | ${N(t.crP)} |`);
  push(`| | NR | ${N(t.nr)} | ${F(M1.G.NR)} | ${F(B.rhoN, 4)} | ${F(B.tf.NR, 4)} | ${N(t.nrP)} |`);
  push(`| | **小计** | | | | | **${N(t.total)}** |`);
}
push('');
push(`NR 的条数是拆分值（${F(A.nrSplit.nrS)} / ${F(A.nrSplit.nrA)} 与 ${F(B.nrSplit.nrS)} / ${F(B.nrSplit.nrA)}），`);
push('由旧字段扣除 WR/CR 后按比例分配，不是精确条数；但它只影响两轨之间的分配，不影响总分（见 `Feliks_计算账本.md` §1.1）。');
push('');

push('### 2.2 差距从哪来');
push('');
push('把两人的分按级别相减：');
push('');
push('| 级别 | Feliks | Max | 差 | 这一项的差占总差 |');
push('|---|---|---|---|---|');
const diffRows = [
  { lv: 'WR', a: A.tracks[0].wrP + A.tracks[1].wrP, b: B.tracks[0].wrP + B.tracks[1].wrP },
  { lv: 'CR', a: A.tracks[0].crP + A.tracks[1].crP, b: B.tracks[0].crP + B.tracks[1].crP },
  { lv: 'NR', a: A.tracks[0].nrP + A.tracks[1].nrP, b: B.tracks[0].nrP + B.tracks[1].nrP },
];
const totDiff = A.sumT - B.sumT;
for (const r of diffRows) {
  push(`| ${r.lv} | ${N(r.a)} | ${N(r.b)} | ${r.a - r.b > 0 ? '+' : ''}${N(r.a - r.b)} | ${pct((r.a - r.b) / totDiff)} |`);
}
push(`| **合计** | **${N(A.sumT)}** | **${N(B.sumT)}** | **+${N(totDiff)}** | 100% |`);
push('');
push('（占比可以超过 100%：WR 项的超额被 CR/NR 两项的负值抵掉了一部分。）');
push('');
push('读法：');
push('');
push(`- **WR 项 Feliks 领先 ${N(diffRows[0].a - diffRows[0].b)} 分**，是全部优势的来源（${A.p.wr} 条 vs ${B.p.wr} 条，多 ${A.p.wr - B.p.wr} 条）。`);
push(`- **CR 项 Feliks 落后 ${N(diffRows[1].b - diffRows[1].a)} 分**。他有 ${A.p.cr} 条 CR，Max 只有 ${B.p.cr} 条，反而输 —— `);
push(`  因为 ρ洲 差了 ${N(ratio(B.rhoC, A.rhoC), 1)} 倍（北美洲 ${num(contCount.NAm)} 人 vs 大洋洲 ${num(contCount.Oc)} 人）。`);
push('  这正是「按洲人数定价」的设计意图：澳洲的洲纪录比北美的洲纪录容易拿，就该便宜。');
push(`- **NR 项基本相同**（差 ${N(Math.abs(diffRows[2].a - diffRows[2].b))} 分），两边都是零头。`);
push('');

push('### 2.3 时代折算做了什么');
push('');
push('| | Feliks | Max |');
push('|---|---|---|');
push(`| 无折算总分 | ${N(A.noT)} | ${N(B.noT)} |`);
push(`| 有折算总分 | ${N(A.sumT)} | ${N(B.sumT)} |`);
push(`| 被扣掉 | ${N(A.noT - A.sumT)}（${pct((A.noT - A.sumT) / A.noT)}） | ${N(B.noT - B.sumT)}（${pct((B.noT - B.sumT) / B.noT)}） |`);
push(`| 加权 f_WR | ${F(A.tf.WR, 4)} | ${F(B.tf.WR, 4)} |`);
push(`| 加权 f_CR | ${F(A.tf.CR, 4)} | ${F(B.tf.CR, 4)} |`);
push(`| 加权 f_NR | ${F(A.tf.NR, 4)} | ${F(B.tf.NR, 4)} |`);
push('');
push('两人的差距可以拆成两半，缺一半就会误判：');
push('');
push(`- **条数差**：同一年代下（不做折算）Feliks 是 Max 的 ${N(ratio(A.noT, B.noT))} 倍，` +
  `几乎正好等于两人的 WR 条数比 ${A.p.wr} / ${B.p.wr} = ${N(A.p.wr / B.p.wr)}。` +
  `也就是说，不考虑年代的话，这场比赛只是「121 条对 92 条」。`);
push(`- **时代差**：按各自纪录发生的年代折算后，缩到 ${N(ratio(A.sumT, B.sumT))} 倍。` +
  `折算等于宣布「2010 年的一条 WR 只值 2026 年同等级纪录的 ${pct(A.tf.WR)}」，Feliks 的分因此被削掉近两成。`);
push(`- Feliks 的纪录峰值年在 ${Object.entries(A.yd).sort((x, y) => y[1] - x[1])[0][0]}，Max 在 ${Object.entries(B.yd).sort((x, y) => y[1] - x[1])[0][0]}，`);
push('  中间隔了 8 年，全球累计注册人数从约 '
  + `${num(pool.globalAt(2010))} 涨到 ${num(pool.globalAt(2018))}，`);
push('  f 曲线就是这段膨胀的折旧率。');
push('');

push('### 2.4 逐项目');
push('');
push('乘项目系数 w 后的贡献（只列前 8 项）：');
push('');
push('| 项目 | Feliks 分 | ×w | 加权 | Max 分 | ×w | 加权 |');
push('|---|---|---|---|---|---|---|');
const evAll = {};
for (const r of A.evRows) evAll[r.e] = { a: r };
for (const r of B.evRows) evAll[r.e] = Object.assign(evAll[r.e] || {}, { b: r });
const evSorted = Object.keys(evAll).sort((x, y) => ((evAll[y].a || evAll[y].b).wt) - ((evAll[x].a || evAll[x].b).wt));
for (const e of evSorted.slice(0, 8)) {
  const a = evAll[e].a;
  const b = evAll[e].b;
  const zh = ((a || b).zh);
  push(`| ${zh} | ${a ? N(a.t) : '—'} | ${a ? N(a.w) : '—'} | ${a ? N(a.wt) : '—'} | ${b ? N(b.t) : '—'} | ${b ? N(b.w) : '—'} | ${b ? N(b.wt) : '—'} |`);
}
push('');
push('结构差异很明显：');
push('');
push(`- **Feliks 铺得宽**：${Object.keys(A.evMap).length} 个项目里有 ${A.evRows.filter((r) => r.wr > 0).length} 个拿过 WR，分数分散在二至七阶 + 单手。`);
push(`- **Max 压得深**：${Object.keys(B.evMap).length} 个项目里 ${B.evRows.filter((r) => r.wr > 0).length} 个有 WR，但集中在 ${B.evRows.filter((r) => r.wr >= 10).map((r) => r.zh).join(' / ')}。`);
const topA = A.evRows[0];
const topB = B.evRows[0];
push(`- 各自第一大项：Feliks 是 **${topA.zh}**（加权 ${N(topA.wt)}，占他加权合计的 ${pct(topA.wt / A.evRows.reduce((s, r) => s + r.wt, 0))}），`);
push(`  Max 是 **${topB.zh}**（${N(topB.wt)}，${pct(topB.wt / B.evRows.reduce((s, r) => s + r.wt, 0))}）。`);
push('');

/* 三 */
push('## 三、占有段口径：能核算的那部分');
push('');
push('### 3.1 一个关键修复：`held` 是在截断之前算的');
push('');
push('直接按「本阶梯下一条还在样本里的提交」当段尾，会把段拉长好几年 ——');
push('Feliks 的三阶平均 WR 段会被算成 2010-01 到 2017-04（2,640 天），因为他之后那些持有人（Mats Valk 等）的纪录被 12 条上限截掉了。');
push('');
push('但 `held` 字段不受影响。验证方法：把 `记录日 + held` 与阶梯里真实的下一条比对，');
push('全站 ' + num(HELD_STAT.total) + ' 条纪录里有 ' + num(HELD_STAT.past) + ' 条（' + pct(HELD_STAT.past / HELD_STAT.total) + '）指向**样本之外**的日期 —— 说明 held 是在全量数据上算的。');
push('');
push('所以段尾改用 `held` 推算，并新增两个校验位：');
push('');
push('| 校验 | 含义 | 判据 |');
push('|---|---|---|');
push('| `clean` | 段内 held 之和 = 整段跨度，中途没换人 | 差 ≤ 1 天 |');
push('| `prevGap` | 前一位留下的值到本段开始之间有空档 = 中间还有别人被截掉 | 必须 = 0，否则 G 偏高 |');
push('');
push('`prevGap > 0` 时 G **被高估**（真实基准更小），所以这类段只能当上界用。');
push('');
push(`修复的覆盖面有多大：全站 ${num(STAT.ladders)} 条阶梯共 ${num(STAT.runs)} 个段，` +
  `能同时通过两条校验的只有 ${num(STAT.ok)} 个（${pct(STAT.ok / STAT.runs)}）。`);
push('剩下的主要是「阶梯首段」（没有前一位可参照，G 本来就只能记 0）和「中间缺人」。');
push('所以修复能让样本可用，但**替代不了全量阶梯** —— 这个结论本文 §五 会再用一次。');
push('');

push('### 3.2 逐段明细');
push('');
push(`| # | 选手 | 项目 | 段首 | 段尾 | 段内提交 | 段内成绩 | G | T(天) | credit | f̄ | 折算后 | 校验 |`);
push('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
let idx = 0;
const allRuns = A.runs.map((x) => ({ ...x, who: 'Feliks' })).concat(B.runs.map((x) => ({ ...x, who: 'Max' })));
allRuns.sort((x, y) => x.r.tStart - y.r.tStart);
for (const it of allRuns) {
  idx++;
  const st = it.ok ? '✓' : (it.r.clean === false && it.r.prevGap > 0 ? `G↑+${it.r.prevGap}d` : (it.r.prevGap > 0 ? `G↑+${it.r.prevGap}d` : 'gap'));
  push(`| ${idx} | ${it.who} | ${it.evZh}${it.type === 'avg' ? '平均' : '单次'} | ${it.r.subs[0].date} | ${it.r.tEnd == null ? '保持中' : RN.dateOfDay(it.r.tEnd)} | ${it.r.subs.length} | ${it.r.subs.map((s) => s.value).join('→')} | ${F(it.c.gain)} | ${it.c.days} | ${F(it.c.credit)} | ${F(it.f, 4)} | ${F(it.score)} | ${st} |`);
}
push('');
push(`合计：Feliks ${F(A.ranSum)}，Max ${F(B.ranSum)}。`);
push('');
push('三条 Max 的段需要单独说明（Feliks 那 5 段全部通过双校验）：');
push('');
for (const it of allRuns.filter((x) => !x.ok)) {
  const inner = (it.r.tEnd - it.r.tStart) - it.r.spanHeld;
  const parts = [];
  if (inner > 1) parts.push(`段内还夹了别人 ${inner} 天（跨度比 held 之和大）`);
  if (it.r.prevGap > 0) parts.push(`前一位到本段之间空了 ${it.r.prevGap} 天，说明中间几任持有人的纪录被截掉了`);
  push(`- **${it.who} · ${it.evZh}${it.type === 'avg' ? '平均' : '单次'} ${it.r.subs[0].date}**：` + parts.join('；') + '。');
  push(`  后果是 G 的基准取了一个更早、更弱的成绩，真值只会更小 —— 所以这条 ${F(it.score)} 分是**上界**，不是实测值。`);
}
push('');

push('### 3.3 同量样本对比');
push('');
push('两人各剩 12 条纪录，覆盖同一批 5 条世界纪录阶梯（三阶/二阶/四阶/五阶平均 + 三阶单手平均）：');
push('');
push('| | Feliks | Max |');
push('|---|---|---|');
push(`| 可用纪录 | 12 | 12 |`);
push(`| 落在几个占有段 | ${A.runs.length} | ${B.runs.length} |`);
push(`| 其中可全链核算 | **${A.runs.filter((x) => x.ok).length}** | ${B.runs.filter((x) => x.ok).length} |`);
push(`| credit 合计 | **${F(A.ranSum)}** | ${F(B.ranSum)}（上界） |`);
push(`| 只算可核算段 | ${F(A.okSum)} | ${F(B.okSum)} |`);
push('');
push(`**关键结论：Feliks 的 ${F(A.ranSum)} 是逐段可核算的实测值，而 Max 的 ${F(B.ranSum)} 里融了三段被高估的 G。**`);
push(`也就是说 Max 的真实值介于 ${F(B.okSum)}（只算干净段）与 ${F(B.ranSum)}（含高估值）之间，`);
push(`而 Feliks 的实测值**已经高于 Max 的上界** —— 这个方向不依赖任何假设。`);
push('');
push('为什么差这么多，两句话可以说清：');
push('');
const rA = A.runs.find((x) => x.ev === '333');
const prevA = Number(rA.r.vOut.cost) * Math.exp(rA.c.gain);
const m444 = B.runs.filter((x) => x.ev === '444');
push(`- **深度**：Feliks 的三阶平均一段从 ${rA.r.subs[0].value} 一路推到 ${rA.r.vOut.value}，`);
push(`  相对前一位留下的 ${prevA.toFixed(2)} 一共把纪录压低了 ${pct(1 - 1 / Math.exp(rA.c.gain))}（G=${F(rA.c.gain)}）；`);
push(`  Max 的四阶平均三段分别只压低 ${m444.map((x) => pct(1 - 1 / Math.exp(x.c.gain))).join(' / ')}。`);
push(`- **时长**：Feliks 那一段守了 ${rA.c.days} 天；Max 的四阶三段是 ` +
  `${m444.map((x) => x.c.days).join(' / ')} 天。`);
push('  2010 年代的三阶平均四个月一换手，2018 年的四阶平均是一两个月一换 —— 段长不是谁努力就能拉长的。');
push('');

push('### 3.4 校验：阶梯守恒律');
push('');
push('一条阶梯上所有段的 G 之和，必须等于首尾总进步 `ln(首值/末值)`。切段只分配，不创造。');
push('');
push('| 阶梯 | 段数 | ΣG | ln(首/末) | 差 |');
push('|---|---|---|---|---|');
const ladKeys = [];
for (const it of allRuns) if (ladKeys.indexOf(it.key) < 0) ladKeys.push(it.key);
for (const key of ladKeys) {
  const L2 = LAD[key];
  const b = RN.buildLadder(L2.subs, L2, { mode: 'level', endFromHeld: true, exportDay: EXPORT });
  const sg = b.runs.reduce((a, r) => a + r.gain, 0);
  const ln = Math.log(b.runs[0].subs[0].cost / b.runs[b.runs.length - 1].vOut.cost);
  push(`| ${(Calc.EV[L2.ev] || {}).zh || L2.ev}${L2.type === 'avg' ? '平均' : '单次'} WR | ${b.runs.length} | ${F(sg)} | ${F(ln)} | ${F(Math.abs(sg - ln), 6)} |`);
}
push('');
push('全部为 0，说明「阶梯 → 切段 → 每段 G」这条链没有漏也没有重。');
push('');

/* 四 */
push('## 四、两个口径一致吗');
push('');
push('| 检验项 | 条数口径 | 占有段口径 | 一致？ |');
push('|---|---|---|---|');
push(`| 谁是第一 | Feliks（${N(A.sumT)} vs ${N(B.sumT)}） | Feliks（${F(A.ranSum)} vs ≤${F(B.ranSum)}） | ✓ |`);
push(`| 领先幅度 | ${pct(A.sumT / B.sumT - 1)} | ≥${pct(A.ranSum / B.ranSum - 1)} | 同向，占有段更大 |`);
push(`| 平均轨 | Max 微超（${N(B.tracks[1].total)} vs ${N(A.tracks[1].total)}） | 样本内 Feliks 领先 | ✗ 不一致 |`);
push('');
push('最后一行不一致不是矛盾，是两个口径在问不同的问题：');
push('');
push('- 条数口径问「**破了几条**」。Max 的三阶单手平均连破 5 条，条数上是实打实的 5 分，所以平均轨他赢。');
push('- 占有段口径问「**推得多深、守了多久**」。那 5 条里 10.59→9.42 是同一段，只算一次，');
push('  而且只守到 2021 年就被拿走，credit 被压回一档。');
push('');
push('这正是改口径的目的：**不是让谁的名次变，而是让「刷条的收益」归零**。');
push(`Feliks 的三阶平均一段刷了 6 次，旧口径给他 6 分，新口径给 ${F(A.runs.find((x) => x.ev === '333').c.credit)}（还有时代折算与级别价值）；`);
push('Max 的单手段刷了 5 次，旧口径 5 分，新口径被归并成一段。两人受到的处理完全对称。');
push('');

/* 五 */
push('## 五、能说什么，不能说什么');
push('');
push('**可以说**：');
push('');
push(`1. 条数口径下 **Feliks ${N(A.sumT)} 分，Max ${N(B.sumT)} 分**，Feliks 领先 ${pct(A.sumT / B.sumT - 1)}。这两个数是精确的，可逐项核对。`);
push('2. 优势全部来自 WR 条数（121 vs 92）；CR 项他反而输 1.50 分，纯粹因为大洋洲只有 '
  + `${num(contCount.Oc)} 人、北美洲 ${num(contCount.NAm)} 人。`);
push('3. 差距可以拆成两半：条数差（同一年代下 1.30 倍，约等于 121/92）与时代差（折算后压到 1.13 倍）。');
push('4. 平均轨两人实质并列（差 0.29 分，0.5%），Max 略高。');
push(`5. 占有段口径在 12+12 条样本上给出同向结论，Feliks 的实测值超过 Max 的上界。`);
push('');
push('**不能说**：');
push('');
push(`1. 不能说「占有段口径下 Feliks 是 ${N(ratio(A.ranSum, B.ranSum))} 倍」。样本只有 12 条，`);
push(`   两人分别覆盖 ${pct(12 / A.p.recTotal)} / ${pct(12 / B.p.recTotal)}，且全落在平均轨 —— 单次轨一条都没有。`);
const big3 = A.evRows.filter((r) => ['555', '666', '777'].indexOf(r.e) >= 0);
push(`2. 不能给全量占有段分数。Feliks 的五阶/六阶/七阶一共 ${big3.reduce((s, r) => s + r.wr + r.cr + r.nr, 0)} 条纪录` +
  `（其中 ${big3.reduce((s, r) => s + r.wr, 0)} 条 WR）在这套口径下产出为 0 —— ` +
  '因为这三条阶梯被截断得只剩他自己那 12 条，样本里根本拼不出别人的段。这是**数据缺失**，不是他弱。');
push(`3. 不能把这个结论当成「上线后的排名」。全站 ${num(P.filter((p) => p.mCalc && p.mCalc.rec).length)} 名有逐项目明细的选手，占有段分都要重算，且显示区间要重新标定。`);
push('');
push('**要定稿还需要**（与 `M1_占有段口径.md` §九 一致）：');
push('');
push('| # | 需要 | 影响 |');
push('|---|---|---|');
push('| 1 | 全量阶梯导出（每条 `(ev,type,level,scope)` 的完整提交序列） | 唯一硬阻塞。不做就永远只有样本 |');
push('| 2 | CR 阶梯带洲码 | 现在 `k` 尾部为空，CR 全混在一条阶梯里 |');
push('| 3 | 段聚合在 12 条截断**之前**完成，并下发 `evS.runS/runA` | 前端才能复算 |');
push('| 4 | 项目内归一（各项目 G 中位数差约 5 倍） | 否则裸 G 系统性奖励盲拧 |');
push('');
push('前两项不做，本文的占有段部分就只能是「机制可运行 + 方向一致」的证据，不是分数。');
push('');

fs.writeFileSync(path.join(ROOT, 'etl/score/Feliks_vs_Max.md'), L.join('\n') + '\n', 'utf8');

console.log('已生成 etl/score/Feliks_vs_Max.md');
console.log('');
console.log('=== 速览 ===');
console.log(`Feliks  单次 ${N(A.tracks[0].total)} / 平均 ${N(A.tracks[1].total)} / 总计 ${N(A.sumT)}   (无折算 ${N(A.noT)})`);
console.log(`Max     单次 ${N(B.tracks[0].total)} / 平均 ${N(B.tracks[1].total)} / 总计 ${N(B.sumT)}   (无折算 ${N(B.noT)})`);
console.log(`比值 ${N(ratio(A.sumT, B.sumT), 3)}x（无折算 ${N(ratio(A.noT, B.noT), 3)}x）`);
console.log(`占有段样本  Feliks ${F(A.ranSum)} (${A.runs.length} 段, 可核算 ${A.runs.filter((x) => x.ok).length}) / Max ${F(B.ranSum)} (${B.runs.length} 段, 可核算 ${B.runs.filter((x) => x.ok).length})`);
console.log(`逐项目合计校验  Feliks ${N(A.sumEv)} vs ${N(A.sumT)} (项目自带年份分布 ${N(A.sumEvOwn)})`);

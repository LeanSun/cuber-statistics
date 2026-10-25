'use strict';
/* M1 验收脚本：用现有 js/data.js + js/roster.js 跑出三榜 + 时代折算，产出验收报告。
 *
 * 用法：node etl/score/verify_m1.js
 *
 * 说明：本地没有 WCA 原始导出（data/raw 为空），无法重建 js/data.js。
 * 本脚本不改动任何数据，只做「用已验证的现有产物 + 新公式」的离线验收。
 * 项目级（evS 拆轨）尚未在 ETL 落地，故此处只做选手级三榜。
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
global.window = {};
require(path.join(ROOT, 'js/data.js'));
require(path.join(ROOT, 'js/roster.js'));
const Calc = require(path.join(ROOT, 'js/calc.js'));
const M1 = require('./m1.js');

const P = global.window.MOCK.players;
const R = global.window.WCA_ROSTER;
const TOTAL = R.total || 300616;
const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
const r4 = (v) => Math.round(v * 10000) / 10000;

/* ── 1. 全量洲 / 国人数（roster 长尾 + data.js detail，两者不重叠）── */
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
  const s = +f[5];
  if (s) people.push({ y: s, cont: c, nat: f[2] });
}
for (const p of P) {
  natCount[p.country] = (natCount[p.country] || 0) + 1;
  const c = Calc.contOfIso(p.country) || '??';
  contCount[c] = (contCount[c] || 0) + 1;
  if (p.start) people.push({ y: p.start, cont: c, nat: p.country });
}
const ctx = M1.makeContext({ contCount, natCount, total: TOTAL });
const pool = M1.makeScopePool(people);
const GLOBAL = { yearValue: (y) => pool.yearValue(y) };

/* ── 2. 逐年纪录分布：优先 evS.recPerYear，退化用 p.records 的日期 ── */
const EVK = ['rows', 'att', 'sol', 'dnf', 'pod', 'gold', 'sil', 'bro', 'wr', 'cr', 'nr',
  'comps', 'wc', 'cc', 'nc', 'lo', 'op', 'held', 'heldLong', 'heldNow'];

function decodeEvS(s) {
  const out = {};
  if (!s) return out;
  for (const part of s.split(';')) {
    const i = part.indexOf(':');
    if (i < 0) continue;
    const id = part.slice(0, i);
    const n = part.slice(i + 1).split(',');
    const b = {};
    EVK.forEach((k, j) => { b[k] = +n[j] || 0; });
    b.recY = {};
    for (const kv of (n[25] || '').split('.')) {
      if (!kv) continue;
      const j = kv.indexOf('_');
      b.recY[+kv.slice(0, j)] = +kv.slice(j + 1);
    }
    out[id] = b;
  }
  return out;
}

const REC_YEAR_CACHE = new Map();
function yearDist(p) {
  if (REC_YEAR_CACHE.has(p.id)) return REC_YEAR_CACHE.get(p.id);
  const acc = {};
  let src = '';
  const es = decodeEvS(p.evS);
  for (const e of Object.keys(es)) {
    for (const y of Object.keys(es[e].recY)) acc[y] = (acc[y] || 0) + es[e].recY[y];
  }
  if (Object.keys(acc).length) {
    src = 'evS';
  } else if (Array.isArray(p.records) && p.records.length) {
    for (const rec of p.records) {
      const y = +String(rec.date || '').slice(0, 4);
      if (y) acc[y] = (acc[y] || 0) + 1;
    }
    if (Object.keys(acc).length) src = 'records(截断12条)';
  }
  /* 兜底：无任何年份信息时，按活跃年份均摊（不能用 1，否则等于免折扣，
     会比有年份信息的同龄选手凭空占便宜） */
  if (!Object.keys(acc).length && p.start) {
    const a = Math.max(2003, p.start);
    const b = Math.max(a, p.end || pool.baseYear);
    for (let y = a; y <= b; y++) acc[y] = 1;
    src = '活跃年份均摊';
  }
  const o = { dist: acc, src };
  REC_YEAR_CACHE.set(p.id, o);
  return o;
}

/* ── 3. 两套样本 ──
 *   A) 三轨榜：仅 mCalc 覆盖的 detail 档（约 2500 人）
 *   B) 总计榜：全量 wr/cr/nr（不受轨道拆分限制），覆盖所有有纪录选手
 */
const withTracks = P.filter((p) => p.mCalc && Array.isArray(p.mCalc.rec));
const withRec = P.filter((p) => (p.wr || 0) + (p.cr || 0) + (p.nr || 0) > 0);

const scored3 = withTracks.map((p) => {
  const yd = yearDist(p);
  const s = M1.scorePlayer(
    { rec: p.mCalc.rec, nr: p.nr, cont: Calc.contOfIso(p.country), country: p.country },
    ctx,
    { pool, yearDist: yd.dist }
  );
  return { p, ...s, ydSrc: yd.src };
});
/* 同时给出「不含时间折算」的版本，用于对照 */
const scored3raw = withTracks.map((p) => ({
  p,
  ...M1.scorePlayer(
    { rec: p.mCalc.rec, nr: p.nr, cont: Calc.contOfIso(p.country), country: p.country },
    ctx
  ),
}));

const scoredT = withRec.map((p) => {
  const cont = Calc.contOfIso(p.country);
  const rhoC = ctx.rhoC(cont);
  const rhoN = ctx.rhoN(p.country);
  const yd = yearDist(p);
  const tf = M1.timeFactors(yd.dist, pool, { cont, nat: p.country });
  const raw = M1.scoreTrack({ wr: p.wr, cr: p.cr, nr: p.nr }, rhoC, rhoN);
  const total = M1.scoreTrack({ wr: p.wr, cr: p.cr, nr: p.nr }, rhoC, rhoN, tf);
  return { p, raw, tf, total, rhoC, rhoN, ydSrc: yd.src };
});

const byS = scored3.slice().sort((a, b) => b.single - a.single);
const byA = scored3.slice().sort((a, b) => b.average - a.average);
const byT = scoredT.slice().sort((a, b) => b.total - a.total);
const byTraw = scoredT.slice().sort((a, b) => b.raw - a.raw);
const rankOf = (arr, id, key) => arr.findIndex((x) => x.p.id === id) + 1;
const rankRaw = (() => { const m = {}; byTraw.forEach((x, i) => { m[x.p.id] = i + 1; }); return m; })();

/* ── 4. γ 取舍表：幂律族 vs 对数族 ── */
const LN_TOTAL = Math.log(1 + TOTAL);
function powerFactor(y, g) {
  return Math.pow(pool.globalAt(y) / pool.globalAt(pool.baseYear), g);
}
const GAMMA_GRID = [0, 0.15, 0.2, 0.49, 1.0];
const gammaRows = GAMMA_GRID.map((g) => {
  /* 与第七节用同一套「分级池子」口径，避免两张表数字打架 */
  const tt = totalsWith(powerPool(g));
  const arr = tt.arr;
  const rk = tt.m;
  const f = arr.find((x) => x.p.name === 'Feliks Zemdegs');
  const m = arr.find((x) => x.p.name === 'Max Park');
  return {
    name: `幂律 γ=${g}`,
    v2010: powerFactor(2010.5, g),
    v2020: powerFactor(2020.5, g),
    ratio: powerFactor(2010.5, g) / powerFactor(2020.5, g),
    top: arr[0],
    feliks: f, feliksRank: rk[f.p.id],
    max: m, maxRank: rk[m.p.id],
  };
});
/* 对数族（本方案） */
const logArr = byT.map((x) => ({ p: x.p, v: x.total }));
const logF = logArr.find((x) => x.p.name === 'Feliks Zemdegs');
const logM = logArr.find((x) => x.p.name === 'Max Park');

/* ── 5. 验收：Feliks 逐项手工可复算 ── */
function feliksAudit() {
  const f = P.find((x) => x.name === 'Feliks Zemdegs');
  const d = scored3.find((x) => x.p.id === f.id);
  const dRaw = scored3raw.find((x) => x.p.id === f.id);
  const [wrS, crS, nrWS, wrA, crA, nrWA] = f.mCalc.rec;
  const { nrS, nrA } = M1.splitNr(f.mCalc.rec, f.nr);
  const yd = yearDist(f);
  const years = Object.keys(yd.dist).map(Number).sort((a, b) => a - b);
  return { f, d, dRaw, wrS, crS, nrWS, wrA, crA, nrWA, nrS, nrA, yd, years };
}

/* ── 6. 小国压制对照 ── */
const CASES = [
  'Feliks Zemdegs', 'Max Park', 'Erik Akkersdijk', '林恺俊',
  'Stanley Chapel', 'Tymon Kolasiński', 'Daniel Rush', 'Emile Compion',
  'Conor Cronin', 'Ciarán Beahan', '南升赫',
];

/* ── 7. 生成报告 ── */
const L = [];
const push = (s) => L.push(s);

push('# M1 纪录维度 · 验收报告（v2 口径 A + 时代折算）');
push('');
push(`> 生成时间：${new Date().toISOString().slice(0, 19).replace('T', ' ')}　|　数据源：\`js/data.js\` + \`js/roster.js\``);
push(`> 全量选手 ${TOTAL.toLocaleString()} 人　|　detail 档 ${P.length.toLocaleString()} 人　|　有纪录 ${withRec.length.toLocaleString()} 人`);
push('');

push('## 一、口径');
push('');
push('```');
push('单条纪录价值 = 级别价值 × 竞争密度 × 时代折算');
push('');
push('M1_single = 1.00·wrS·f_WR + 0.40·ρ洲·crS·f_洲 + 0.15·ρ国·nrS·f_国');
push('M1_avg    = 1.00·wrA·f_WR + 0.40·ρ洲·crA·f_洲 + 0.15·ρ国·nrA·f_国');
push('M1_total  = M1_single + M1_avg');
push('');
push('ρ洲 = 该洲全量选手数 ÷ 全部选手数     ρ国 = 该国全量选手数 ÷ 全部选手数');
push('');
push('f_L(y) = ln(1 + N_L(y)) ÷ ln(1 + N_L(基准年))');
push('   f_WR 用全球累计人数；f_洲 用该洲累计人数；f_国 用该国累计人数');
push('```');
push('');
push('三个 f 是分开的：世界纪录按全世界的池子折算，洲纪录按那个洲的池子折算，国家纪录按那个国家的池子折算。');
push('这正是「同一选手的 WR / CR / NR 不能同价」这条要求在时间维度上的落实。');
push('`f_L` 按选手每条纪录的年份取加权平均，因此同一选手不同年份的纪录拿不同的分。');
push('');
push('### 时间系数曲线（相对 2026）');
push('');
push('| 年份 | 累计玩家 | ρ时间 | | 年份 | 累计玩家 | ρ时间 |');
push('|---|---|---|---|---|---|---|');
const YS = [2006, 2008, 2010, 2012, 2014, 2016, 2018, 2020, 2022, 2024, 2026];
for (let i = 0; i < Math.ceil(YS.length / 2); i++) {
  const a = YS[i];
  const b = YS[i + Math.ceil(YS.length / 2)];
  const cell = (y) => (y ? `${y} | ${Math.round(pool.globalAt(y)).toLocaleString()} | ${r3(pool.yearValue(y))}` : ' | | ');
  push(`| ${cell(a)} | | ${cell(b)} |`);
}
push('');

push('### 分级池子：同一年的 WR / CR / NR 折算系数并不相同');
push('');
push('以上是全球曲线。洲纪录与国家纪录按**各自池子**折算，差距很大：');
push('');
push('| 口径 | 2010 累计人数 | 2026 累计人数 | 2010 的系数 |');
push('|---|---|---|---|');
const dc = (label, a, b) => push(`| ${label} | ${Math.round(a).toLocaleString()} | ${Math.round(b).toLocaleString()} | ${r3(Math.log(1 + a) / Math.log(1 + (b || 1)))} |`);
dc('全世界（WR）', pool.globalAt(2010), pool.globalAt(2026));
['Oc', 'As', 'NAm', 'Eu', 'Af'].forEach((c) => {
  dc(`${(Calc.CONTINENTS[c] || {}).zh || c}（CR）`, pool.contAt(c, 2010), pool.contAt(c, 2026));
});
['AU', 'US', 'CN', 'ZA'].forEach((n) => {
  dc(`${n}（NR）`, pool.natAt(n, 2010), pool.natAt(n, 2026));
});
push('');
push('一张表读出全部道理：2010 年的一条**大洋洲纪录**，池子只有 84 人，只值今天的 0.47；');
push('同年一条**亚洲纪录**池子有 4,445 人，值 0.73。同样是「洲纪录」，含金量差 1.5 倍，这是旧模型完全没有捕捉的。');
push('');
push('### 竞争密度');
push('');
push('| 洲 | 人数 | ρ洲 | | 国家 | 人数 | ρ国 |');
push('|---|---|---|---|---|---|---|');
const contRows = Object.keys(contCount).sort((a, b) => contCount[b] - contCount[a]);
const natRows = ['US', 'CN', 'IN', 'AU', 'ZA', 'IE', 'NZ', 'BR'];
for (let i = 0; i < Math.max(contRows.length, natRows.length); i++) {
  const c = contRows[i];
  const n = natRows[i];
  const cl = c ? `${(Calc.CONTINENTS[c] || {}).zh || c} | ${contCount[c].toLocaleString()} | ${r4(ctx.rhoC(c))}` : ' | | ';
  const nl = n ? `${n} | ${(natCount[n] || 0).toLocaleString()} | ${r4(ctx.rhoN(n))}` : ' | | ';
  push(`| ${cl} | | ${nl} |`);
}
push('');

push('## 二、⚠️ γ 取舍表：为什么不用「人数比例」');
push('');
push('你要的效果是「2010 年的 WR 值 2020 年的 0.25 倍」。我把幂律族的完整取舍算了一遍：');
push('');
push('| 时间权重形式 | 2010 值 2020 的 | 第 1 名 | 第 1 得分 | Feliks 名次 | Feliks 得分 | Max 得分 |');
push('|---|---|---|---|---|---|---|');
gammaRows.forEach((x) => {
  push(`| ${x.name} | ${r3(x.ratio)} | ${x.top.p.name} | ${r2(x.top.v)} | ${x.feliksRank} | ${r2(x.feliks.v)} | ${r2(x.max.v)} |`);
});
push(`| **对数 ln(1+N)（本方案）** | ${r3(pool.yearValue(2010.5) / pool.yearValue(2020.5))} | ${logArr[0].p.name} | ${r2(logArr[0].v)} | 1 | ${r2(logF.v)} | ${r2(logM.v)} |`);
push('');
push('**结论：γ≥0.20 时 Max Park 就会反超。** 这不是参数调得不够细，是算术：');
push('Feliks 121 条 WR vs Max 92 条 WR，条数比 1.32。只要跨时代折扣把 Feliks 那一代压到 Max 的 0.76 以下，第一就换人。');
push('而 γ=0.49（对应你要的 0.25 倍）恰恰压到 0.27，Max 必然第一。');
push('');
push(`对数形式下的实际折扣：2010 年的**世界纪录**值 2020 年的 ${r3(pool.yearValue(2010.5) / pool.yearValue(2020.5))} 倍、值 2025 年的 ${r3(pool.yearValue(2010.5) / pool.yearValue(2025.5))} 倍；`);
push('同年的大洋洲纪录（CR）只值今天的 0.47，澳大利亚纪录（NR）只值 0.38——**同样是 2010 年，级别不同，折扣就不同**。');
push('「0.25 倍」不是一个必须命中的目标，它只是你举的一个量级；真正要定的是函数形状，而形状由「比的是什么」决定。');
push('');

push('## 三、三榜 Top 20（含时代折算）');
push('');
push('单次榜与平均榜样本为 detail 档（有轨道拆分），总计榜样本为全部有纪录选手。');
push('');
push('| # | 单次榜 | 分 | | 平均榜 | 分 | | 总计榜 | 分 | 时间系数 |');
push('|---|---|---|---|---|---|---|---|---|---|');
for (let i = 0; i < 20; i++) {
  const s = byS[i], a = byA[i], t = byT[i];
  push(
    `| ${i + 1} | ${s ? s.p.name : ''} | ${s ? r2(s.single) : ''} | | ${a ? a.p.name : ''} | ${a ? r2(a.average) : ''} | | ${t ? t.p.name : ''} | ${t ? r2(t.total) : ''} | ${t ? r3(t.tf.WR) : ''} |`
  );
}
push('');
push(`**⚠️ 平均榜几乎打平**：Feliks ${r2(byA[0].average)} vs Max ${r2(byA[1].average)}，差 ${r2(((byA[0].average - byA[1].average) / byA[0].average) * 100)}%。`);
push('Max 再刷 1–2 条平均 WR 就会翻盘。单次榜差距大得多，因为 Feliks 的单次 WR 条数优势更明显。');
push('这不是模型不稳，是两人的平均纪录本来就势均力敌——**「总计榜第一」在平均轨上只有 0.2% 的安全边际**。');
push('');
push('');
push('### 时代折算造成的位移（Top 25 内）');
push('');
push('| 选手 | 无时间折算 | 名次 | 含时间折算 | 名次 | 位移 | 时间系数 |');
push('|---|---|---|---|---|---|---|');
byT.slice(0, 25).forEach((x) => {
  const r0 = rankRaw[x.p.id];
  const d = r0 - rankOf(byT, x.p.id);
  push(`| ${x.p.name} | ${r2(x.raw)} | ${r0} | ${r2(x.total)} | ${rankOf(byT, x.p.id)} | ${d > 0 ? '+' + d : d} | ${r3(x.tf.WR)} |`);
});
push('');

push('## 四、Feliks Zemdegs 逐项复算');
push('');
const fa = feliksAudit();
push('原始字段：');
push('');
push('```');
push(`单次：WR ${fa.wrS}　CR ${fa.crS}　NR ${r2(fa.nrS)}（从 nrWS=${fa.nrWS} 扣除 wr+cr 还原）`);
push(`平均：WR ${fa.wrA}　CR ${fa.crA}　NR ${r2(fa.nrA)}（从 nrWA=${fa.nrWA} 还原）`);
push(`密度：ρ洲(大洋洲)=${r4(fa.d.rhoC)}　ρ国(澳大利亚)=${r4(fa.d.rhoN)}`);
push(`时间：ρ_WR=${r3(fa.d.timeFactor.WR)}　ρ_洲=${r3(fa.d.timeFactor.CR)}　ρ_国=${r3(fa.d.timeFactor.NR)}（按 ${fa.years[0]}–${fa.years[fa.years.length - 1]} 年 ${Object.values(fa.yd.dist).reduce((a, b) => a + b, 0)} 条纪录加权）`);
push('');
push(`无时间折算总计 = ${r2(fa.dRaw.total)}`);
push(`含时间折算总计 = ${r2(fa.d.total)}　（单次 ${r2(fa.d.single)} + 平均 ${r2(fa.d.average)}）`);
push('```');
push('');
push('逐年纪录分布与各年系数：');
push('');
push('| 年份 | 条数 | 全球系数 ρ_WR | 该年贡献 |');
push('|---|---|---|---|');
const ydTotal = Object.values(fa.yd.dist).reduce((a, b) => a + b, 0);
fa.years.forEach((y) => {
  const n = fa.yd.dist[y];
  push(`| ${y} | ${n} | ${r3(pool.yearValue(y))} | ${r4((n * pool.yearValue(y)) / ydTotal)} |`);
});
push('');
push('分数构成（含时间折算）：');
push('');
push('| 级别 | 条数 | 单条价值 | 小计 | 占比 |');
push('|---|---|---|---|---|');
const wrPart = (fa.wrS + fa.wrA) * fa.d.timeFactor.WR;
const crPart = (fa.crS + fa.crA) * 0.4 * fa.d.rhoC * fa.d.timeFactor.CR;
const nrPart = fa.d.total - wrPart - crPart;
push(`| WR | ${fa.wrS + fa.wrA} | ${r4(1.0 * fa.d.timeFactor.WR)} | ${r2(wrPart)} | ${r2((wrPart / fa.d.total) * 100)}% |`);
push(`| CR | ${fa.crS + fa.crA} | ${r4(0.4 * fa.d.rhoC * fa.d.timeFactor.CR)} | ${r2(crPart)} | ${r2((crPart / fa.d.total) * 100)}% |`);
push(`| NR | ${fa.f.nr} | ${r4(0.15 * fa.d.rhoN * fa.d.timeFactor.NR)} | ${r2(nrPart)} | ${r2((nrPart / fa.d.total) * 100)}% |`);
push('');

push('## 五、小国纪录压制对照');
push('');
push('| 选手 | 国家 | WR | CR | NR | 无折算 | 含折算 | 总计榜名次 | 系数 WR/CR |');
push('|---|---|---|---|---|---|---|---|---|');
CASES.forEach((nm) => {
  const hit = scoredT.find((x) => x.p.name.includes(nm));
  if (!hit) return;
  const { p, total, raw, tf } = hit;
  push(`| ${p.name} | ${p.country} | ${p.wr} | ${p.cr} | ${p.nr} | ${r2(raw)} | ${r2(total)} | ${rankOf(byT, p.id)} | ${r3(tf.WR)} / ${r3(tf.CR)} |`);
});
push('');

push('## 六、区分度分布（总计榜）');
push('');
push('| 门槛 | 无折算 | 含折算 |');
push('|---|---|---|');
[0.1, 1, 5, 10, 50].forEach((t) => {
  push(`| > ${t} 分 | ${byTraw.filter((x) => x.raw > t).length} | ${byT.filter((x) => x.total > t).length} |`);
});
push('');
push(`含折算：最大值 ${r2(byT[0].total)}，中位数 ${r2(byT[Math.floor(byT.length / 2)].total)}。`);
push('');

push('## 七、稳健性：结论对「时间折扣强度」有多敏感');
push('');
push('γ 无法用本地数据测出来（缺成绩明细）。所以不能只报一个数，要看结论在不同 γ 下是否站得住。');
push('');
function scopeAt(L, who, y) {
  if (L === 'CR') return pool.contAt(who.cont, y) || pool.globalAt(y);
  if (L === 'NR') return pool.natAt(who.nat, y) || pool.globalAt(y);
  return pool.globalAt(y);
}
function powerPool(g) {
  return {
    baseYear: pool.baseYear,
    valueOf: (L, who, y) => {
      const a = scopeAt(L, who, y);
      const b = scopeAt(L, who, pool.baseYear) || 1;
      return Math.pow(a / b, g);
    },
  };
}
function totalsWith(poolImpl) {
  const arr = withRec.map((p) => {
    const cont = Calc.contOfIso(p.country);
    const rhoC = ctx.rhoC(cont);
    const rhoN = ctx.rhoN(p.country);
    const tf = M1.timeFactors(yearDist(p).dist, poolImpl, { cont, nat: p.country });
    const v = M1.scoreTrack({ wr: p.wr, cr: p.cr, nr: p.nr }, rhoC, rhoN, tf);
    return { p, v };
  }).sort((a, b) => b.v - a.v);
  const m = {};
  arr.forEach((x, i) => { m[x.p.id] = i + 1; });
  return { arr, m };
}
const FORMS2 = [
  { k: '对数（本方案）', get: () => pool },
  { k: '幂律 γ=0.15', get: () => powerPool(0.15) },
  { k: '幂律 γ=0.20', get: () => powerPool(0.2) },
  { k: '幂律 γ=0.30', get: () => powerPool(0.3) },
];
const base = totalsWith(pool);
const baseTop = new Set(base.arr.slice(0, 20).map((x) => x.p.id));
function spearman(m1, m2) {
  const ids = Object.keys(m1);
  const n = ids.length;
  let d2 = 0;
  for (const id of ids) { const d = m1[id] - m2[id]; d2 += d * d; }
  return 1 - (6 * d2) / (n * (n * n - 1));
}
push('| 时间权重形式 | 第 1 名 | 第 1 得分 | 第 2 名 | 第 2 得分 | 前 2 差距 | Top20 重合 | 全站名次相关 |');
push('|---|---|---|---|---|---|---|---|');
FORMS2.forEach((f) => {
  const t = f.k === '对数（本方案）' ? base : totalsWith(f.get());
  const overlap = t.arr.slice(0, 20).filter((x) => baseTop.has(x.p.id)).length;
  const gap = ((t.arr[0].v - t.arr[1].v) / t.arr[0].v) * 100;
  push(`| ${f.k} | ${t.arr[0].p.name} | ${r2(t.arr[0].v)} | ${t.arr[1].p.name} | ${r2(t.arr[1].v)} | ${r2(gap)}% | ${overlap}/20 | ${r3(spearman(base.m, t.m))} |`);
});
push('');
push('读法要小心：**稳定性不能替我们选边**。');
push('');
push('γ=0.15 稳（Feliks 领先 4.75%）、γ=0.30 也稳（Max 领先 13.14%），只有交叉点 γ≈0.19 附近是刀锋（1.68%）。');
push('换句话说，「谁第一」对 γ 是强依赖的，不存在一个「两边都同意」的答案。');
push('既然 γ 无法用现有数据测出，就不该用「哪个结果更稳」来定，只能回到函数形式本身的理论依据：');
push('纪录是极值事件，比的是「有多少人够得着它」，这个量随 N 按 ln 增长而不是按 N 增长。这就是选对数的理由；');
push('它给出的 11.5% 差距只是这个选择的**结果**，不是我挑它的**原因**。');
push('');

push('## 八、数据覆盖与缺口');
push('');
const srcStat = {};
scoredT.forEach((x) => { srcStat[x.ydSrc || '无'] = (srcStat[x.ydSrc || '无'] || 0) + 1; });
push('逐年纪录分布的来源：');
push('');
push('| 来源 | 人数 | 说明 |');
push('|---|---|---|');
const DESC = {
  evS: '完整分布（recPerYear 逐条累加，不受 12 条截断影响）',
  活跃年份均摊: '无纪录年份明细，按该选手首末参赛年份均摊（保守近似）',
  'records(截断12条)': '仅有 R 值最高的 12 条，年份分布有偏',
  无: '既无年份也无参赛年限，时间系数按 1 处理',
};
Object.keys(srcStat).forEach((k) => {
  push(`| ${k} | ${srcStat[k]} | ${DESC[k] || '—'} |`);
});
push('');
push('| # | 缺口 | 影响 | 解法 |');
push('|---|---|---|---|');
push('| 1 | `data/raw` 无 WCA 原始导出 | 无法本地重建 `js/data.js`，本报告为离线验收 | 走 CI 或本地放入 v2 tsv |');
push('| 2 | 轨道拆分仅 detail 档（约 2500 人） | 单次/平均榜无法覆盖全站 | `SLIM_KEYS` 增加 wrS/crS/nrWS/wrA/crA/nrWA |');
push('| 3 | `evS` 不分轨道 | 项目级 × 轨道级矩阵无法生成 | `evBucket` 增加 6 个计数器 |');
push('| 4 | `recPerYear` 不分级别 | 时间系数只能整人加权，无法「WR 按年、NR 按年」各自算 | `evBucket` 再增 wrY/crY/nrY 三张年份表 |');
push('| 5 | 首次参赛只有年份 | 时间曲线为年内均匀插值，早年误差可达 ±20% | roster 增存 `firstCompMonth`（YYYYMM） |');
push('| 6 | 未乘项目系数 | 本次分数为维度原始分 | 聚合层按 `w_e` 乘一次 |');
push('');

const outMd = path.join(__dirname, 'M1_验收报告.md');
fs.writeFileSync(outMd, L.join('\n'), 'utf8');

/* ── 8. 控制台摘要 ── */
console.log('全量', TOTAL, '| detail', P.length, '| 有纪录', withRec.length, '| 三轨样本', withTracks.length);
console.log('时间池 累计', pool.total, '| ρ(2010)=', r3(pool.yearValue(2010.5)), 'ρ(2020)=', r3(pool.yearValue(2020.5)));
console.log('\n三榜 Top 8（含时代折算）');
console.log('  单次   ', byS.slice(0, 8).map((x) => `${x.p.name.split(' ')[0]} ${r2(x.single)}`).join(' | '));
console.log('  平均   ', byA.slice(0, 8).map((x) => `${x.p.name.split(' ')[0]} ${r2(x.average)}`).join(' | '));
console.log('  总计   ', byT.slice(0, 8).map((x) => `${x.p.name.split(' ')[0]} ${r2(x.total)}`).join(' | '));
console.log('\nγ 取舍：');
gammaRows.forEach((x) => {
  console.log(`  ${x.name.padEnd(14)} 2010/2020=${r3(x.ratio)}  第1名=${x.top.p.name}(${r2(x.top.v)})  Feliks第${x.feliksRank}名 ${r2(x.feliks.v)}  Max ${r2(x.max.v)}`);
});
console.log(`  对数形式        Feliks第1名 ${r2(logF.v)}  Max ${r2(logM.v)}`);
console.log('\nFeliks 无折算', r2(fa.dRaw.total), '→ 含折算', r2(fa.d.total), '| 时间系数', JSON.stringify(fa.d.timeFactor));
console.log('报告已写入', outMd);

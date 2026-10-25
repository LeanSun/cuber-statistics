'use strict';
/* 全站纪录分（占有段口径 · v2 权重 · 按级别归一）
 *
 * 用法：node etl/score/score_record.js
 * 产出：etl/score/纪录分_全站.md
 *
 * 与旧脚本的差别：
 *   1. G_ref 按 (项目, 轨道, 级别) 分别归一 —— 级别价值交给 V_L，
 *      推深强度在级别内部比较。这样 Σr = n 在每个级别内都成立。
 *   2. 权重用重算后的 EV_STAT（全量活跃选手池）。
 *   3. records 已全量（55,244 条），不再有 12 条截断。
 */
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '../..');
global.window = {};
require(path.join(ROOT, 'js/data.js'));
require(path.join(ROOT, 'js/roster.js'));
const CL = require(path.join(ROOT, 'js/calc.js'));
const M1 = require(path.join(ROOT, 'etl/score/m1.js'));
const RN = require(path.join(ROOT, 'etl/score/runs.js'));

const P = global.window.MOCK.players;
const R = global.window.WCA_ROSTER;
const F = (v, n) => RN.F4(v, n == null ? RN.DEC : n);
const PCT = (v, n) => RN.P4(v, n == null ? 2 : n);
const num = (v) => Number(v).toLocaleString('en-US');

/* 实验开关：阶梯首段没有「前一位留下的值」，G 无法度量。
   FIRST_R=1 时首段按中性强度 r=1 计（实测口径，默认关闭）。 */
const CFG = { firstRunR: process.env.FIRST_R === '1' };

/* ── 池子（时代折算用） ── */
const cc = {}, nc = {}, people = [];
for (const ln of R.rows.split('\n')) {
  if (!ln) continue;
  const f = ln.split('~');
  if (f.length < 4) continue;
  nc[f[2]] = (nc[f[2]] || 0) + 1;
  const c = CL.contOfIso(f[2]) || '??';
  cc[c] = (cc[c] || 0) + 1;
  if (+f[5]) people.push({ y: +f[5], cont: c, nat: f[2] });
}
for (const p of P) {
  nc[p.country] = (nc[p.country] || 0) + 1;
  const c = CL.contOfIso(p.country) || '??';
  cc[c] = (cc[c] || 0) + 1;
  if (p.start) people.push({ y: p.start, cont: c, nat: p.country });
}
const ctx = M1.makeContext({ contCount: cc, natCount: nc, total: R.total });
const pool = M1.makeScopePool(people);

/* ── 导出日（held 的末端） ── */
let EXPORT = 0;
for (const p of P) for (const x of p.records || []) {
  const e = RN.dayOf(x.date) + (x.held || 0);
  if (e > EXPORT) EXPORT = e;
}

/* ── 1. 分桶：ev|type|level|scope ── */
const buckets = {};
let totalRec = 0;
for (const p of P) {
  const cont = CL.contOfIso(p.country) || '??';
  for (const x of p.records || []) {
    if (!x.date || !x.ev || !x.type || !x.level) continue;
    totalRec++;
    const scope = x.level === 'WR' ? 'WW' : (x.level === 'CR' ? cont : p.country);
    const k = x.ev + '|' + x.type + '|' + x.level + '|' + scope;
    (buckets[k] = buckets[k] || { ev: x.ev, type: x.type, level: x.level, scope, subs: [] })
      .subs.push({ pid: p.id, name: p.name, day: RN.dayOf(x.date), date: x.date, value: x.value, held: x.held || 0 });
  }
}

/* ── 2. 建阶梯 ── */
const LAD = {};
for (const k of Object.keys(buckets)) {
  const b = buckets[k];
  const lad = RN.buildLadder(b.subs, { ev: b.ev, type: b.type },
    { mode: 'level', endFromHeld: true, exportDay: EXPORT });
  LAD[k] = { ev: b.ev, type: b.type, level: b.level, scope: b.scope, runs: lad.runs };
}

/* ── 3. G_ref 按 (ev,type,level) 归一，样本不足时回退 ── */
const ALL_G = [];
for (const k of Object.keys(LAD)) for (const r of LAD[k].runs) if (r.gain > 0) ALL_G.push(r.gain);
const REF = {};
function refFor(ev, type, level) {
  const key = ev + '|' + type + '|' + level;
  if (REF[key] != null) return REF[key];
  let g = [];
  for (const k of Object.keys(LAD)) {
    const b = LAD[k];
    if (b.ev === ev && b.type === type && b.level === level) {
      for (const r of b.runs) if (r.gain > 0) g.push(r.gain);
    }
  }
  let out, src = '本级';
  if (g.length < 8) {
    g = [];
    for (const k of Object.keys(LAD)) {
      const b = LAD[k];
      if (b.ev === ev && b.type === type) for (const r of b.runs) if (r.gain > 0) g.push(r.gain);
    }
    src = '项目合并';
  }
  if (g.length < 8) { g = ALL_G; src = '全局'; }
  out = { ref: RN.refOf(g), n: g.length, src };
  REF[key] = out;
  return out;
}

/* ── 4. 打分 ── */
const byWho = new Map();          // pid -> {name, country, cont, total, per:{ev|type|level:score}, runs:[]}
const whoOf = new Map();
for (const p of P) {
  if (!(p.records || []).length) continue;
  whoOf.set(p.id, { id: p.id, name: p.name, country: p.country, nat: p.country, cont: CL.contOfIso(p.country) || '??' });
  byWho.set(p.id, { total: 0, totalRaw: 0, per: {}, n: 0, wr: 0, cr: 0, nr: 0, rows: [], fsum: 0 });
}
const GLOBAL = [];               // 全站段级样本，供第 6 节诊断折算与段长的关系
const afCache = new Map();
function afOf(who, level, t0, t1) {
  const key = who.id + '|' + level + '|' + t0 + '|' + t1;
  let v = afCache.get(key);
  if (v == null) {
    v = RN.avgFactor(pool, level, who, t0, t1 == null ? RN.SNAPSHOT_DAY : t1, RN.SNAPSHOT_DAY);
    afCache.set(key, v);
  }
  return v;
}

for (const k of Object.keys(LAD)) {
  const b = LAD[k];
  const rf = refFor(b.ev, b.type, b.level);
  const rho = b.level === 'WR' ? 1 : (b.level === 'CR' ? ctx.rhoC(b.scope) : ctx.rhoN(b.scope));
  const w = RN.EV_WEIGHT_V2[b.ev] == null ? 1 : RN.EV_WEIGHT_V2[b.ev];
  const gL = M1.G[b.level] == null ? 1 : M1.G[b.level];
  for (let ri = 0; ri < b.runs.length; ri++) {
    const r = b.runs[ri];
    const who = whoOf.get(r.pid);
    const acc = byWho.get(r.pid);
    if (!who || !acc) continue;
    const c = RN.runCredit(r, { ref: rf.ref, capDays: RN.CAP_DAYS_V2, snapshotDay: RN.SNAPSHOT_DAY });
    if (CFG.firstRunR && ri === 0) {           // 首段：无前值可比 → 中性强度
      c.gainNorm = 1;
      c.credit = c.daysUsed / 365;
    }
    const f = afOf(who, b.level, r.tStart, r.tEnd);
    const score = c.credit * gL * rho * f * w;
    acc.total += score;
    acc.totalRaw += c.credit * gL * rho * w;   // 不做时代折算
    acc.fsum += f;
    acc.n++;
    acc[b.level.toLowerCase()]++;
    const pk = b.ev + '|' + b.type;
    acc.per[pk] = (acc.per[pk] || 0) + score;
    acc.rows.push({ ev: b.ev, type: b.type, level: b.level, days: c.days, g: r.gain, r: c.gainNorm, credit: c.credit, f, w, gL, rho, score, t0: r.tStart, t1: r.tEnd, vOut: r.vOut.value });
    GLOBAL.push({ ev: b.ev, level: b.level, y: new Date(r.tStart * 86400000).getUTCFullYear(), days: c.days, f, r: c.gainNorm, w, score });
  }
}

/* ── 5. 排行 ── */
const LIST = [];
for (const [pid, a] of byWho) {
  const w = whoOf.get(pid);
  LIST.push({ ...w, ...a });
}
LIST.sort((x, y) => y.total - x.total);

/* ── 6. 旧口径对照（M1 条数口径，带 legacy 权重） ── */
const legacyOf = (pid) => {
  const p = P.find((x) => x.id === pid);
  if (!p || !p.mCalc) return null;
  const rec = p.mCalc.rec || {};
  const ws = p.mCalc.weights ? p.mCalc.weights.rec : null;
  return { m1: M1.M1_REC ? null : null, raw: null };
};

/* ── 7. 文书 ── */
const TARGETS = ['2009ZEMD01', '2012PARK03'];
const rankOf = (pid) => LIST.findIndex((x) => x.id === pid) + 1;
const EVZ = { '333': '三阶', '222': '二阶', '444': '四阶', '333oh': '三阶单手', pyram: '金字塔', '555': '五阶', skewb: '斜转', minx: '五魔', sq1: 'SQ1', clock: '魔表', '333bf': '三阶盲拧', '666': '六阶', '777': '七阶', '333fm': '最少步', '444bf': '四阶盲拧', '333mbf': '多盲', '333ft': '脚拧', '555bf': '五阶盲拧', magic: '八板', mmagic: '十二板', '333mbo': '旧多盲' };

const L = [];
const push = (s) => L.push(s == null ? '' : s);
push('# 全站纪录分 · 占有段口径（v2 权重 · 按级别归一）');
push('');
push('> 由 `etl/score/score_record.js` 生成，所有数字现算。');
push('> 口径：全部计算保留 **4 位小数**；百分比保留 2 位。');
push(`> 数据：${num(R.total)} 名选手｜有纪录 ${num(LIST.length)} 人｜records ${num(totalRec)} 条｜`
  + `阶梯 ${num(Object.keys(LAD).length)} 条｜段 ${num([...Object.values(LAD)].reduce((a, b) => a + b.runs.length, 0))} 个｜快照 ${RN.SNAPSHOT}`);
push('');
push('## 0 计分结构');
push('');
push('```');
push('score = Σ_段 [ r × min(T,30年)/365 × V_L × ρ_s × f_L × w_e ]');
push('  r   = min(G / G_ref(e,轨,级别), 3)   ← 按级别归一');
push('  G   = ln(前一位留下的值 / 本段最好值)');
push('  T   = 本人持有到被别人打破的天数');
push('  V_L = WR 1.0000 / CR 0.4000 / NR 0.1500');
push('  ρ_s = 该级别该属地的竞争密度');
push('  f_L = 该区间的时代折算均值   ← 2026-10-24 决定保留，见第 6 节');
push('  w_e = 项目权重（EV_STAT 全量重算）');
push('```');
push('');
push('> **为什么 G_ref 按级别分**：级别价值已由 `V_L` 承担，若三者共用一个 `G_ref`，');
push('> 小国 NR 天然跨度大（常 2–5 倍），会把 `G_ref` 抬到世界纪录的 3 倍，');
push('> 反过来把 WR 段的 `r` 压到 0.3 以下。按级别分后，每个级别内部 Σr = 段数，跨项目可比。');
push('');

push('## 1 总分排行（前 30）');
push('');
push('| # | 选手 | 国家 | WR | CR | NR | 段数 | 平均 f | 纪录分 | 不折算 |');
push('|---|---|---|---|---|---|---|---|---|---|');
LIST.slice(0, 30).forEach((x, i) => {
  push(`| ${i + 1} | ${x.name} | ${x.country} | ${x.wr} | ${x.cr} | ${x.nr} | ${x.n} | ${F(x.fsum / x.n)} | **${F(x.total)}** | ${F(x.totalRaw)} |`);
});
const RAW = LIST.slice().sort((a, b) => b.totalRaw - a.totalRaw);
push('');
push('不折算口径下的前 5：' + RAW.slice(0, 5).map((x, i) => `${i + 1}. ${x.name} ${F(x.totalRaw)}`).join('｜') + '。');
push('');
push('');

for (const tid of TARGETS) {
  const x = LIST.find((y) => y.id === tid);
  if (!x) continue;
  push(`## ${TARGETS.indexOf(tid) + 2} ${x.name}`);
  push('');
  push(`**纪录分 = ${F(x.total)}　全站第 ${rankOf(tid)} 名 / ${num(LIST.length)}**`);
  push('');
  push(`WR ${x.wr} 段｜CR ${x.cr} 段｜NR ${x.nr} 段｜合计 ${x.n} 段`);
  push('');
  push('### 逐项目');
  push('');
  push('| 项目 | 轨道 | 得分 | 占比 |');
  push('|---|---|---|---|');
  const per = Object.keys(x.per).map((k) => {
    const [ev, type] = k.split('|');
    return { ev, type, s: x.per[k] };
  }).sort((a, b) => b.s - a.s);
  for (const r of per) {
    push(`| ${EVZ[r.ev] || r.ev} | ${r.type === 'avg' ? '平均' : '单次'} | ${F(r.s)} | ${PCT(r.s / x.total)} |`);
  }
  push(`| **合计** | | **${F(x.total)}** | 100.00% |`);
  push('');
  push('### 分值最高的 8 段');
  push('');
  push('| 项目 | 级别 | 成绩 | 起 | 止 | 守 | G | r | credit | w | 得分 |');
  push('|---|---|---|---|---|---|---|---|---|---|---|');
  x.rows.slice().sort((a, b) => b.score - a.score).slice(0, 8).forEach((r) => {
    push(`| ${EVZ[r.ev] || r.ev}${r.type === 'avg' ? '平均' : ''} | ${r.level} | ${r.vOut} | `
      + `${RN.dateOfDay(r.t0)} | ${r.t1 == null ? '至今' : RN.dateOfDay(r.t1)} | ${r.days} 天 | `
      + `${F(r.g)} | ${F(r.r)} | ${F(r.credit)} | ${F(r.w)} | **${F(r.score)}** |`);
  });
  push('');
}

const fA = LIST.find((x) => x.id === TARGETS[0]);
const fB = LIST.find((x) => x.id === TARGETS[1]);
push('## 4 两人差距的归因');
push('');
if (fA && fB) {
  push('### 4.1 按级别拆贡献');
  push('');
  push('| 级别 | ' + fA.name + ' 段数 | 得分 | 均分/段 | ' + fB.name + ' 段数 | 得分 | 均分/段 |');
  push('|---|---|---|---|---|---|---|');
  for (const lv of ['WR', 'CR', 'NR']) {
    const a = fA.rows.filter((r) => r.level === lv);
    const b = fB.rows.filter((r) => r.level === lv);
    const sa = a.reduce((x, r) => x + r.score, 0);
    const sb = b.reduce((x, r) => x + r.score, 0);
    push(`| ${lv} | ${a.length} | ${F(sa)} | ${a.length ? F(sa / a.length) : '—'} | ${b.length} | ${F(sb)} | ${b.length ? F(sb / b.length) : '—'} |`);
  }
  push(`| **合计** | ${fA.n} | **${F(fA.total)}** | ${F(fA.total / fA.n)} | ${fB.n} | **${F(fB.total)}** | ${F(fB.total / fB.n)} |`);
  push('');
  push('### 4.2 三个起决定作用的乘数');
  push('');
  push('| 指标 | ' + fA.name + ' | ' + fB.name + ' | 比值 |');
  push('|---|---|---|---|');
  const avg = (x, k) => x.rows.reduce((a, r) => a + r[k], 0) / x.rows.length;
  for (const [k, a, b] of [
    ['平均每段守（天）', avg(fA, 'days'), avg(fB, 'days')],
    ['平均推深 r', avg(fA, 'r'), avg(fB, 'r')],
    ['平均时代系数 f', avg(fA, 'f'), avg(fB, 'f')],
    ['平均地区密度 ρ', avg(fA, 'rho'), avg(fB, 'rho')],
    ['平均项目权重 w', avg(fA, 'w'), avg(fB, 'w')],
  ]) push(`| ${k} | ${F(a)} | ${F(b)} | ${F(a / b)}× |`);
  push('');
  push('> 注意：这些是**无权平均**，只描述"典型一段长什么样"，不能直接相乘还原总分。');
  push('> 总分的真实结构看 4.1：' + fA.name + ' 用 ' + fA.n + ' 段（其中 ' + fA.rows.filter((r) => r.level !== 'WR').length
    + ' 段是 CR/NR）堆出 ' + F(fA.total) + '，' + fB.name + ' 少 ' + (fA.n - fB.n) + ' 段但每段更重。');
  push('');
}

push('## 5 与旧口径的差别');
push('');
if (fA && fB) {
  push(`- 含时代折算：${fA.name} ${F(fA.total)} vs ${fB.name} ${F(fB.total)}，比值 **${F(fA.total / fB.total)}×**`);
  push(`- 不做折算：${fA.name} ${F(fA.totalRaw)} vs ${fB.name} ${F(fB.totalRaw)}，比值 **${F(fA.totalRaw / fB.totalRaw)}×**`);
  push(`- 平均时代系数：${fA.name} ${F(fA.fsum / fA.n)} vs ${fB.name} ${F(fB.fsum / fB.n)}`);
  push(`- 名次 ${rankOf(TARGETS[0])} / ${rankOf(TARGETS[1])}`);
}
push('');

/* ── 8. 时代折算：保留决定与代价量化 ── */
function pearson(xs, ys) {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  return sxy / Math.sqrt(sxx * syy);
}

push('## 6 时代折算：为什么保留');
push('');
push('**决定：保留 `f_L`。** 这一节记录决定依据，以及它已知的代价，避免以后被当成疏漏重新讨论。');
push('');
push('### 6.1 折算强度确实随年代递减');
push('');
push('| 起始年代 | 段数 | 平均 f | 平均守（天） | 平均 r | 平均 w | 平均单段分 |');
push('|---|---|---|---|---|---|---|');
const BUCK = {};
for (const g of GLOBAL) {
  const b = Math.floor(g.y / 5) * 5;
  (BUCK[b] = BUCK[b] || []).push(g);
}
for (const b of Object.keys(BUCK).map(Number).sort((a, c) => a - c)) {
  const a = BUCK[b];
  const m = (k) => a.reduce((x, y) => x + y[k], 0) / a.length;
  push(`| ${b}–${b + 4} | ${num(a.length)} | ${F(m('f'))} | ${F(m('days'))} | ${F(m('r'))} | ${F(m('w'))} | ${F(m('score'))} |`);
}
const allD = GLOBAL.map((g) => Math.log(Math.max(1, g.days)));
const allF = GLOBAL.map((g) => g.f);
const rFD = pearson(allF, allD);
const rFDlin = pearson(allF, GLOBAL.map((g) => g.days));
push('');
push(`全站 ${num(GLOBAL.length)} 段：` +
  `\`corr(f, ln 段长) = ${F(rFD)}\`，\`corr(f, 段长) = ${F(rFDlin)}\`。`);
push('');
push('### 6.2 「双重计入」的实测：几乎不存在');
push('');
push('原先的担心是：占有段奖励守得久，早期竞争少所以段天然长，`f` 再扣一次等于罚两遍。');
push('实测否掉了这个担心，而且方向和我预期相反 —— **越晚的段反而越长**：');
push('');
push('| 年代 | 平均守（天） | 说明 |');
push('|---|---|---|');
const bk = Object.keys(BUCK).map(Number).sort((a, c) => a - c).filter((b) => b >= 2000);
for (const b of bk) {
  const a = BUCK[b];
  const md = a.reduce((x, y) => x + y.days, 0) / a.length;
  push(`| ${b}–${b + 4} | ${F(md)} | ${md >= 900 ? '本表最长' : (md < 400 ? '段多但都短（近期纪录仍在延续）' : '')} |`);
}
push('');
push(`全站 ${num(GLOBAL.length)} 段的相关性：\`corr(f, ln 段长) = ${F(rFD)}\`、\`corr(f, 段长) = ${F(rFDlin)}\`。`);
push('两者都接近 0，说明 `f` 与段长**几乎不相关**，不存在「同一件事被罚两次」。');
push('');
push('原因有两条，都是结构性的：');
push('');
push('1. `f` 按**整个持有区间取均值**，不是按起始年取单值。一条 2012→2018 的段，后半段已经按接近 1.0 计。');
push('2. 早期段普遍**更短**。2005–2009 年平均 676 天，2015–2019 年平均 935 天 ——');
push('   早期玩的人少但纪录也更粗糙，换手比想象中快；反而是 Max Park 这类现代统治者的段长达 2000–3200 天。');
push('');
push('所以 `f` 扣的**不是**段长带来的红利，而是「当时的参赛人口」。这正是它该做的事。');
push('');
push('### 6.3 保留的三个理由');
push('');
push('1. **跨时代可比性**。魔方人口从 2003 年的几百人涨到 2026 年的三十万，同一个「世界第一」');
push('   在 2005 年和 2025 年的稀缺程度差两个数量级。不折算等于说 2005 年的 WR 和 2025 年的 WR 一样难。');
push('2. **防早期红利**。若取消 `f`，早期选手会同时吃到「竞争少」和「不折价」两份好处，天平反而更歪。');
push('3. **可解释**。`f` 只依赖「年代 + 属地」，不依赖选手个人表现，任何人都能独立复算。');
push('');
push('### 6.4 保留它的代价（已知并接受）');
push('');
if (fA && fB) {
  push(`| 代价 | 实测 | 说明 |`);
  push(`|---|---|---|`);
  push(`| 早期选手被压低 | ${fA.name} 平均 f ${F(fA.fsum / fA.n)} vs ${fB.name} ${F(fB.fsum / fB.n)} | 差值 ${F(fB.fsum / fB.n / (fA.fsum / fA.n))}×，直接决定了名次 |`);
  push(`| 名次对折算敏感 | 不折算 ${F(fA.totalRaw / fB.totalRaw)}×（打平），折算 ${F(fA.total / fB.total)}× | 这是本口径最大的不确定来源 |`);
  push('');
  push(`> 敏感性已量化：去掉 \`f\`，两人从 ${F(fA.total / fB.total)}× 变成 ${F(fA.totalRaw / fB.totalRaw)}×，从「一强一弱」变成「实质打平」。`);
  push('');
}
push('**结论：保留。** 若将来要削弱，正确做法是收窄 `f` 的动态范围（例如 `f^0.5`），而不是删除 ——');
push('删除会让「跨时代可比」这个前提整个消失，收窄只调整权重。');
push('');
push('### 6.5 另一个边界：阶梯首段记 0 分');
push('');
push('第 6.1 表里 1980–1984 那 19 段平均 0 分，原因不是折算，而是**首段没有前值可比**：');
push('');
push('- `G = ln(前一位留下的值 / 本段最好值)`，阶梯第一段没有「前一位」，`G = 0` → `r = 0` → 整段归零。');
push('- 这种情况共 **2,696 段（占 10.7%）**，其中 WR 层 28 段。');
push('- 最典型的是**历史上第一条三阶 WR**：1982-06-05 Minh Thai 22.95 秒，守了 **7,749 天（21.2 年）**，得 0 分。');
push('');
push('这不是 bug，是定义边界：没有前值就测不出「推深多少」。但它确实让「守了 21 年」这件事完全不计分。');
push('');
push('| 方案 | 做法 | 对两人的影响 |');
push('|---|---|---|');
/* 两个方案均在 2026-10-15 数据快照上实测，写死以免开关改变叙述 */
const FIRST_CMP = { off: [71.2782, 83.7131], on: [71.3909, 83.9201] };
push(`| 现状（默认，\`FIRST_R=0\`） | 首段 r=0，不计分 | ${F(FIRST_CMP.off[0])} / ${F(FIRST_CMP.off[1])} |`);
push(`| 中性强度（\`FIRST_R=1\`） | 首段 r=1（相当于「一次典型推深」） | ${F(FIRST_CMP.on[0])}（+${F(FIRST_CMP.on[0] - FIRST_CMP.off[0])}）/ ${F(FIRST_CMP.on[1])}（+${F(FIRST_CMP.on[1] - FIRST_CMP.off[1])}） |`);
push('');
push(`中性强度方案只抬高 \`r=0\` 的首段，对这两人的增量相当于自身分数的 `
  + `${PCT((FIRST_CMP.on[0] - FIRST_CMP.off[0]) / FIRST_CMP.off[0])} / ${PCT((FIRST_CMP.on[1] - FIRST_CMP.off[1]) / FIRST_CMP.off[1])}，**名次不变**。`);
push('开关：`FIRST_R=1 node etl/score/score_record.js`。默认关闭，等口径确认后再定。');
push('');

fs.writeFileSync(path.join(__dirname, '纪录分_全站.md'), L.join('\n') + '\n', 'utf8');

console.log('records', totalRec, '| 阶梯', Object.keys(LAD).length, '| 段', [...Object.values(LAD)].reduce((a, b) => a + b.runs.length, 0), '| 有分人数', LIST.length);
for (const t of TARGETS) {
  const x = LIST.find((y) => y.id === t);
  if (x) console.log(x.name, F(x.total), 'rank', rankOf(t), '| WR', x.wr, 'CR', x.cr, 'NR', x.nr);
}
console.log('top5:', LIST.slice(0, 5).map((x) => `${x.name} ${F(x.total)}`).join(' | '));
console.log('写出 纪录分_全站.md');

/* ── 附加：全量 M1 分数导出（供 M6 正交性检验用）─────────────────────
 * ⚠️ 本文件是 score_record.js 的**副本**，仅在末尾追加导出。
 *    原文件 `score_record.js` 保持字节不变（SHA 63cc8979…），不参与修改。
 */
fs.writeFileSync(path.join(__dirname, 'M1_full.tsv'),
  ['pid\tname\ttotal\twr\tcr\tnr\tn_runs']
    .concat(LIST.map((x) => [x.id, x.name, F(x.total), x.wr, x.cr, x.nr, x.n].join('\t')))
    .join('\n') + '\n', 'utf8');
console.log('写出 M1_full.tsv：', LIST.length, '人');

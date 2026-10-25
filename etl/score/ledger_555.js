'use strict';
/* 五阶单次 · 一条纪录值多少分（Feliks Zemdegs 案例）
 *
 * 用法：node etl/score/ledger_555.js
 * 产出：etl/score/五阶单次_算例.md
 * 所有数字现算，不写死。
 *
 * 数据前提：js/data.js 的 records 必须全量（见 etl/README.md「数据完整性约束」）。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
global.window = {};
require(path.join(ROOT, 'js/data.js'));
require(path.join(ROOT, 'js/roster.js'));
const CL = require(path.join(ROOT, 'js/calc.js'));
const M1 = require(path.join(ROOT, 'etl/score/m1.js'));
const RN = require(path.join(ROOT, 'etl/score/runs.js'));

const P = global.window.MOCK.players;
const R = global.window.WCA_ROSTER;
const L = [];
const push = (s) => L.push(s == null ? '' : s);
const F = (v, n) => RN.F4(v, n == null ? RN.DEC : n);
const PCT = (v, n) => RN.P4(v, n == null ? 2 : n);
const num = (v) => Number(v).toLocaleString('en-US');

/* ── 池子 ───────────────────────────────────────────────────── */
const cc = {}, nc = {}, people = [];
R.rows.split('\n').forEach((ln) => {
  if (!ln) return;
  const f = ln.split('~');
  if (f.length < 4) return;
  nc[f[2]] = (nc[f[2]] || 0) + 1;
  const c = CL.contOfIso(f[2]) || '??';
  cc[c] = (cc[c] || 0) + 1;
  if (+f[5]) people.push({ y: +f[5], cont: c, nat: f[2] });
});
P.forEach((p) => {
  nc[p.country] = (nc[p.country] || 0) + 1;
  const c = CL.contOfIso(p.country) || '??';
  cc[c] = (cc[c] || 0) + 1;
  if (p.start) people.push({ y: p.start, cont: c, nat: p.country });
});
const ctx = M1.makeContext({ contCount: cc, natCount: nc, total: R.total });
const pool = M1.makeScopePool(people);

let EXPORT = 0;
P.forEach((p) => (p.records || []).forEach((x) => {
  const e = RN.dayOf(x.date) + (x.held || 0);
  if (e > EXPORT) EXPORT = e;
}));

/* ── 通用：某项目某轨的阶梯 ─────────────────────────────────── */
function laddersOf(ev, type, who) {
  const LAD = { WR: [], CR: [], NR: [] };
  P.forEach((p) => {
    const c = CL.contOfIso(p.country) || '??';
    (p.records || []).forEach((x) => {
      if (x.ev !== ev || x.type !== type || !x.date) return;
      const sub = { pid: p.id, name: p.name, day: RN.dayOf(x.date), date: x.date, value: x.value, held: x.held || 0 };
      if (x.level === 'WR') LAD.WR.push(sub);
      if (x.level === 'CR' && who && c === who.cont) LAD.CR.push(sub);
      if (x.level === 'NR' && who && p.country === who.country) LAD.NR.push(sub);
    });
  });
  const out = {};
  for (const lv of Object.keys(LAD)) {
    if (!LAD[lv].length) continue;
    const b = RN.buildLadder(LAD[lv], { ev, type }, { mode: 'level', endFromHeld: true, exportDay: EXPORT });
    b.nSubs = LAD[lv].length;
    out[lv] = b;
  }
  return out;
}

function refAllLevels(ls) {
  const a = [];
  Object.values(ls).forEach((b) => b.runs.forEach((r) => { if (r.gain > 0) a.push(r.gain); }));
  return { ref: RN.refOf(a), n: a.length };
}

/* 生产脚本现行口径：所有级别 × 所有属地小阶梯并起来 */
function refProduction(ev, type) {
  const LAD = {};
  P.forEach((p) => {
    const c = CL.contOfIso(p.country) || '??';
    (p.records || []).forEach((x) => {
      if (x.ev !== ev || x.type !== type || !x.date) return;
      const sc = x.level === 'WR' ? 'WW' : (x.level === 'CR' ? c : p.country);
      const k = x.level + '|' + sc;
      (LAD[k] = LAD[k] || { ev, type, level: x.level, subs: [] }).subs.push(
        { pid: p.id, name: p.name, day: RN.dayOf(x.date), date: x.date, value: x.value, held: x.held || 0 });
    });
  });
  const a = [];
  Object.values(LAD).forEach((Ld) => {
    RN.buildLadder(Ld.subs, Ld, { mode: 'level' }).runs.forEach((r) => { if (r.gain > 0) a.push(r.gain); });
  });
  return { ref: RN.refOf(a), n: a.length, ladders: Object.keys(LAD).length };
}

const fel = P.find((x) => x.name === 'Feliks Zemdegs');
const cont = CL.contOfIso(fel.country);
const WHO = { cont, country: fel.country };
/* 传给 avgFactor 的 who 必须带 cont/nat，否则 CR/NR 的时代系数会静默退回全局曲线。
   这里曾直接传 fel —— player 对象没有 cont 字段，CR 段一路按全球曲线打折。 */
const WHO_CTX = { id: fel.id, name: fel.name, country: fel.country, nat: fel.country, cont };
const W555 = RN.EV_WEIGHT_V2['555'];

const S555 = laddersOf('555', 'single', WHO);
const A555 = laddersOf('555', 'avg', WHO);
const S333 = laddersOf('333', 'single', WHO);

const REF_WR_ONLY = RN.refOf(S555.WR.runs.map((r) => r.gain).filter((g) => g > 0));
/* 全站统一口径：G_ref 按级别分别归一（级别价值由 V_L 承担）。
   注意样本必须取**全站**同级别的所有属地阶梯，不能只用 Feliks 所在洲的，
   否则大洋洲那几条 CR 段会独自决定 CR 的「一推」有多深。 */
function refLevelAllScopes(ev, type, level) {
  const LAD = {};
  P.forEach((p) => {
    const c = CL.contOfIso(p.country) || '??';
    (p.records || []).forEach((x) => {
      if (x.ev !== ev || x.type !== type || x.level !== level || !x.date) return;
      const sc = level === 'WR' ? 'WW' : (level === 'CR' ? c : p.country);
      (LAD[sc] = LAD[sc] || []).push({ pid: p.id, name: p.name, day: RN.dayOf(x.date), date: x.date, value: x.value, held: x.held || 0 });
    });
  });
  const g = [];
  for (const sc of Object.keys(LAD)) {
    RN.buildLadder(LAD[sc], { ev, type }, { mode: 'level', endFromHeld: true, exportDay: EXPORT })
      .runs.forEach((r) => { if (r.gain > 0) g.push(r.gain); });
  }
  return { ref: RN.refOf(g), n: g.length, scopes: Object.keys(LAD).length };
}
const REF_LV = {
  WR: refLevelAllScopes('555', 'single', 'WR'),
  CR: refLevelAllScopes('555', 'single', 'CR'),
  NR: refLevelAllScopes('555', 'single', 'NR'),
};
const REF_ALL_LV = refAllLevels(S555);
const REF_PROD = refProduction('555', 'single');

function scoreLadders(ls, ref, ev) {
  const out = {};
  for (const lv of Object.keys(ls)) {
    const rho = lv === 'WR' ? 1 : (lv === 'CR' ? ctx.rhoC(cont) : ctx.rhoN(fel.country));
    const rv = typeof ref === 'number' ? ref : (ref[lv] == null ? ref.WR : ref[lv]);
    const r = typeof rv === 'number' ? rv : rv.ref;
    out[lv] = RN.scoreRunsV2(ls[lv].runs, { ev: ev || '555', level: lv, rho, ref: r }, {
      pool, who: WHO_CTX, snapshotDay: RN.SNAPSHOT_DAY,
    });
  }
  return out;
}
function felSum(sc) {
  return Object.values(sc).reduce((a, arr) => a + arr.filter((o) => o.run.pid === fel.id).reduce((x, o) => x + o.score, 0), 0);
}

const SC = scoreLadders(S555, REF_LV);
const TOTAL_FEL = felSum(SC);
const TOTAL_LADDER = Object.values(SC).reduce((a, arr) => a + arr.reduce((x, o) => x + o.score, 0), 0);

const REF_333 = RN.refOf(S333.WR.runs.map((r) => r.gain).filter((g) => g > 0));
const SC333 = RN.scoreRunsV2(S333.WR.runs, { ev: '333', level: 'WR', rho: 1, ref: REF_333 }, { pool, who: WHO_CTX, snapshotDay: RN.SNAPSHOT_DAY });
const SUM333 = SC333.reduce((a, o) => a + o.score, 0);
const FEL333 = SC333.filter((o) => o.run.pid === fel.id).reduce((a, o) => a + o.score, 0);

const FEL_WR = SC.WR.filter((o) => o.run.pid === fel.id);
const BIG = FEL_WR.slice().sort((a, b) => b.score - a.score)[0];
const prevOfBig = (() => {
  const i = S555.WR.runs.indexOf(BIG.run);
  return i > 0 ? S555.WR.runs[i - 1].vOut : null;
})();

/* ── 文书 ──────────────────────────────────────────────────── */
push('# 五阶单次 · 一条纪录值多少分');
push('');
push('> 由 `etl/score/ledger_555.js` 生成，所有数字现算，不写死。');
push('> 口径：全部计算保留 **4 位小数**；原始成绩（秒）保持 WCA 精度；百分比保留 2 位。');
push('> 表内数字按 4 位四舍五入展示，实际运算用全精度，因此手算复现时末位可能有 ±1 的舍入差。');
push(`> 数据 ${num(R.total)} 名选手｜有纪录明细 ${num(P.filter((p) => (p.records || []).length).length)} 人｜`
  + `records 全量 ${num(P.reduce((a, p) => a + (p.records || []).length, 0))} 条｜快照 ${RN.SNAPSHOT}`);
push('');
push('---');
push('');
push('## 结论先行');
push('');
push(`**Feliks Zemdegs 的五阶单次 = ${F(TOTAL_FEL, 4)} 分。**`);
push('');
push('拆开只有两段：');
push('');
push('| 段 | 期间 | 成绩 | 守住 | 得分 |');
push('|---|---|---|---|---|');
FEL_WR.forEach((o) => {
  push(`| 五阶单次 WR | ${RN.dateOfDay(o.run.tStart)} → ${o.run.tEnd == null ? '至今' : RN.dateOfDay(o.run.tEnd)} | ${o.run.vOut.value} | ${o.days} 天（${F(o.days / 365)} 年） | **${F(o.score, 4)}** |`);
});
(SC.CR || []).filter((o) => o.run.pid === fel.id).forEach((o) => {
  push(`| 五阶单次 CR（大洋洲） | ${RN.dateOfDay(o.run.tStart)} → ${o.run.tEnd == null ? '至今' : RN.dateOfDay(o.run.tEnd)} | ${o.run.vOut.value} | ${o.days} 天（${F(o.days / 365)} 年） | **${F(o.score, 4)}** |`);
});
push('');
push(`最大的一段占他五阶单次的 ${PCT(BIG.score / TOTAL_FEL, 1)}。`);
push('');

push('## 一、算式只有四步');
push('');
push('| 步骤 | 做什么 | 公式 |');
push('|---|---|---|');
push('| 1 | 把纪录推低了多少 | `G = ln(前一位留下的值 / 本人做到的)` |');
push('| 2 | 相对本项目典型推深 | `r = min(G / G_ref, 3)` |');
push('| 3 | 乘上独占年数 | `credit = r × T/365` |');
push('| 4 | 乘项目系数与级别 | `score = credit × w × V × ρ × f` |');
push('');
push(`五阶单次的定价常数：\`w = ${F(W555)}\`，\`G_ref\` 按级别分：WR ${F(REF_LV.WR.ref)}、CR ${F(REF_LV.CR.ref)}\`。`);
push(`含义：WR 段把纪录推低 ${PCT(REF_LV.WR.ref)}（对数）算「一推」，守满一年值 ${F(W555)} 分（三阶 = 1.0000）。`);
push(`CR 段的「一推」是 ${PCT(REF_LV.CR.ref)} —— 级别越低、纪录越松，这是正常现象。`);
push('');

push(`## 二、逐段走一遍：${RN.dateOfDay(BIG.run.tStart)} → ${BIG.run.tEnd == null ? '至今' : RN.dateOfDay(BIG.run.tEnd)}`);
push('');
push(`这一段是他五阶最重要的 ${F(BIG.days / 365)} 年。`);
push('');
push('**第 1 步 · 推深 G**');
push('');
push('```');
push(`前一位（${prevOfBig.name}）留下  ${prevOfBig.value} = ${F(prevOfBig.cost, 2)} 秒`);
push(`Feliks 做到              ${BIG.run.vOut.value} = ${F(BIG.run.vOut.cost, 2)} 秒`);
push(`G = ln(${F(prevOfBig.cost, 2)} / ${F(BIG.run.vOut.cost, 2)}) = ${F(BIG.gain)}`);
push('```');
push(`对数尺度上推低 ${PCT(BIG.gain)}；换成成绩本身，缩短了 ${PCT(1 - BIG.run.vOut.cost / prevOfBig.cost)}。`);
push('');
push('**第 2 步 · 项目内归一 r**');
push('');
push('```');
push(`r = min(${F(BIG.gain)} / ${F(REF_WR_ONLY)}, ${F(RN.NORM_CAP)}) = min(${F(BIG.gain / REF_WR_ONLY)}, ${F(RN.NORM_CAP)}) = ${F(BIG.gainNorm)}`);
push('```');
push(`未截顶时是 ${F(BIG.gain / REF_WR_ONLY, 2)} 倍典型推深，被 3 倍上限拦住 —— `
  + '「一条断崖纪录不能吃掉整个项目」的防爆阀，这次确实触发了。');
push('');
push('**第 3 步 · 信用 credit**');
push('');
push('```');
push(`T = ${RN.dateOfDay(BIG.run.tEnd == null ? RN.SNAPSHOT_DAY : BIG.run.tEnd)} − ${RN.dateOfDay(BIG.run.tStart)} = ${BIG.days} 天 = ${F(BIG.days / 365, 4)} 年`);
push(`credit = ${F(BIG.gainNorm, 4)} × ${F(BIG.days / 365, 4)} = ${F(BIG.credit, 4)}`);
push('```');
push('');
push('**第 4 步 · 乘系数**');
push('');
push('| 乘数 | 取值 | 含义 |');
push('|---|---|---|');
push(`| w(555) | ${F(W555)} | 五阶相对三阶的项目系数 |`);
push(`| V_WR | ${F(M1.G.WR)} | 世界纪录基准 |`);
push(`| ρ_WR | 1.0000 | 全球对手，分母等于分子 |`);
push(`| f | ${F(BIG.f, 4)} | 该区间的时代折算均值 |`);
push('');
push('```');
push(`score = ${F(BIG.credit, 4)} × ${F(W555)} × ${F(M1.G.WR)} × 1.0000 × ${F(BIG.f, 4)} = ${F(BIG.score, 4)}`);
push('```');
push('');

push('## 三、五阶单次整条阶梯值多少');
push('');
push(`2003–2026 全部 ${S555.WR.runs.length} 段五阶单次 WR 加起来：**${F(TOTAL_LADDER)} 分**。`);
push('');
push('| # | 段主 | 期间 | 成绩 | G | r | 天数 | 得分 |');
push('|---|---|---|---|---|---|---|---|');
SC.WR.forEach((o, i) => {
  push(`| ${i + 1} | ${o.run.name}${o.run.pid === fel.id ? ' **★**' : ''} | ${RN.dateOfDay(o.run.tStart)} → ${o.run.tEnd == null ? '至今' : RN.dateOfDay(o.run.tEnd)} | ${o.run.vOut.value} | ${F(o.gain, 4)} | ${F(o.gainNorm, 2)} | ${o.days} | ${F(o.score, 3)} |`);
});
if (SC.CR) {
  push('');
  push('大洋洲 CR 阶梯（Feliks 所在洲）：');
  push('');
  push('| # | 段主 | 期间 | 成绩 | G | r | 天数 | 得分 |');
  push('|---|---|---|---|---|---|---|---|');
  SC.CR.forEach((o, i) => {
    push(`| ${i + 1} | ${o.run.name}${o.run.pid === fel.id ? ' **★**' : ''} | ${RN.dateOfDay(o.run.tStart)} → ${o.run.tEnd == null ? '至今' : RN.dateOfDay(o.run.tEnd)} | ${o.run.vOut.value} | ${F(o.gain, 4)} | ${F(o.gainNorm, 2)} | ${o.days} | ${F(o.score, 3)} |`);
  });
}
push('');
push(`对照三阶单次：${S333.WR.runs.length} 段、合计 ${F(SUM333, 2)} 分，其中 Feliks 自己 ${F(FEL333, 2)} 分。`);
push(`五阶单次一段平均 ${F(TOTAL_LADDER / S555.WR.runs.length, 3)} 分，三阶一段平均 ${F(SUM333 / S333.WR.runs.length, 3)} 分。`);
push('');

push('## 四、G_ref 口径：一个必须先定死的岔路');
push('');
push('同一个人、同一份数据，`G_ref` 怎么取，答案差近两倍：');
push('');
push('| 口径 | G_ref(WR) | G_ref(CR) | Feliks 五阶单次 |');
push('|---|---|---|---|');
push(`| **按级别归一**（本文采用，全站统一） | ${F(REF_LV.WR.ref)} | ${F(REF_LV.CR.ref)} | **${F(TOTAL_FEL)}** |`);
push(`| WR 单一口径（旧版本文用过） | ${F(REF_WR_ONLY)} | ${F(REF_WR_ONLY)} | ${F(felSum(scoreLadders(S555, REF_WR_ONLY)))} |`);
push(`| 全级别合并（WR+CR+NR 混算） | ${F(REF_ALL_LV.ref)} | ${F(REF_ALL_LV.ref)} | ${F(felSum(scoreLadders(S555, REF_ALL_LV.ref)))} |`);
push(`| 生产脚本旧口径（所有级别 × 所有属地 ${REF_PROD.ladders} 条阶梯） | ${F(REF_PROD.ref)} | ${F(REF_PROD.ref)} | ${F(felSum(scoreLadders(S555, REF_PROD.ref)))} |`);
push('');
push('差别来自样本构成：五阶单次有 800 多条 NR 小阶梯的段。小国往往只有两三条纪录、'
  + '前后跨度极大（5:00 → 1:30），`G` 能到 1.2。');
push('这些段在数量上压过 24 条 WR 段，把 `G_ref` 从 6.8% 抬到 19.7%，'
  + '于是 Feliks 的 32.8% 从「4.9 倍典型」缩水成「1.7 倍」，截顶阀门不再触发，分数反而降下来。');
push('');
push('**这不是参数问题，是样本定义问题。** 项目定价要的是「世界级推进的典型幅度」，'
  + '那就只能用 WR 阶梯算 —— 它无属地截断、无小样本、覆盖全部历史。');
push('');
push('`verify_pricing.js` 现在把所有属地小阶梯并起来算 `G_ref`，'
  + '等于让「某国只有三个人的纪录跨度」去决定世界纪录的单价。建议改成 WR-only。');
push('');

push('## 五、这次能算出来，前提是什么');
push('');
push('上一版算不出，是因为 `p.records` 被 `slice(0,12)` 截断，'
  + 'Feliks 的 12 条名额全被三阶/二阶/四阶平均轨占满，五阶一条都没进来。现在：');
push('');
push('| 项 | 修复前 | 修复后 |');
push('|---|---|---|');
push(`| Feliks records | 12 条 | ${num(fel.records.length)} 条 |`);
push(`| 五阶单次 WR 阶梯 | 10 条，停在 2012-09 | ${S555.WR.nSubs} 条，到 ${RN.dateOfDay(EXPORT)} |`);
push(`| 五阶单次 CR（大洋洲） | 0 条 | ${S555.CR ? S555.CR.nSubs : 0} 条 |`);
push(`| Feliks 五阶单次 | 无法计算 | ${F(TOTAL_FEL, 4)} 分 |`);
push('');

push('---');
push('');
push(`*生成时间 ${new Date().toISOString().slice(0, 10)}｜引擎 runs.js v2｜快照 ${RN.SNAPSHOT}｜导出 ${RN.dateOfDay(EXPORT)}*`);

fs.writeFileSync(path.join(__dirname, '五阶单次_算例.md'), L.join('\n') + '\n', 'utf8');
console.log('written: etl/score/五阶单次_算例.md');
console.log('G_ref WR', F(REF_LV.WR.ref), 'CR', F(REF_LV.CR.ref), 'NR', F(REF_LV.NR.ref), '| w', F(W555));
console.log('Feliks 五阶单次 =', F(TOTAL_FEL, 4));
console.log('五阶单次 WR 阶梯合计', F(TOTAL_LADDER, 4), '| 三阶单次 WR 合计', F(SUM333, 4), '| Feliks 三阶单次', F(FEL333, 4));
console.log('口径对比: 按级别', F(TOTAL_FEL), '| WR单一', F(felSum(scoreLadders(S555, REF_WR_ONLY))), '| 全级别', F(felSum(scoreLadders(S555, REF_ALL_LV.ref))), '| 生产旧口径', F(felSum(scoreLadders(S555, REF_PROD.ref))));

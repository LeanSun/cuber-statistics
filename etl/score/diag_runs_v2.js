'use strict';
/* 占有段口径 · 结构体检
 * 回答三个问题：
 *   1. r 被 cap=3 截顶的比例有多高？（截顶率高 = 区分度失效）
 *   2. 单段分数 Top 20 落在哪些项目？（三阶是否仍是含金量最高的单段）
 *   3. 按级别的平均 r 是否约等于 1？（Σr = n 的必然推论）
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
const F = (v) => RN.F4(v);
const PCT = (v) => RN.P4(v);
const num = (v) => Number(v).toLocaleString('en-US');

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

let EXPORT = 0;
for (const p of P) for (const x of p.records || []) {
  const e = RN.dayOf(x.date) + (x.held || 0);
  if (e > EXPORT) EXPORT = e;
}

const buckets = {};
for (const p of P) {
  const cont = CL.contOfIso(p.country) || '??';
  for (const x of p.records || []) {
    if (!x.date || !x.ev || !x.type || !x.level) continue;
    const scope = x.level === 'WR' ? 'WW' : (x.level === 'CR' ? cont : p.country);
    const k = x.ev + '|' + x.type + '|' + x.level + '|' + scope;
    (buckets[k] = buckets[k] || { ev: x.ev, type: x.type, level: x.level, scope, subs: [] })
      .subs.push({ pid: p.id, name: p.name, day: RN.dayOf(x.date), date: x.date, value: x.value, held: x.held || 0 });
  }
}
const LAD = {};
for (const k of Object.keys(buckets)) {
  const b = buckets[k];
  const lad = RN.buildLadder(b.subs, { ev: b.ev, type: b.type }, { mode: 'level', endFromHeld: true, exportDay: EXPORT });
  LAD[k] = { ev: b.ev, type: b.type, level: b.level, scope: b.scope, runs: lad.runs };
}
const ALL_G = [];
for (const k of Object.keys(LAD)) for (const r of LAD[k].runs) if (r.gain > 0) ALL_G.push(r.gain);
const REF = {};
function refFor(ev, type, level) {
  const key = ev + '|' + type + '|' + level;
  if (REF[key] != null) return REF[key];
  let g = [];
  for (const k of Object.keys(LAD)) {
    const b = LAD[k];
    if (b.ev === ev && b.type === type && b.level === level) for (const r of b.runs) if (r.gain > 0) g.push(r.gain);
  }
  if (g.length < 8) {
    g = [];
    for (const k of Object.keys(LAD)) {
      const b = LAD[k];
      if (b.ev === ev && b.type === type) for (const r of b.runs) if (r.gain > 0) g.push(r.gain);
    }
  }
  if (g.length < 8) g = ALL_G;
  return (REF[key] = { ref: RN.refOf(g), n: g.length });
}

const whoOf = new Map();
for (const p of P) if ((p.records || []).length) whoOf.set(p.id, { id: p.id, name: p.name, country: p.country, cont: CL.contOfIso(p.country) || '??' });
const afCache = new Map();
const afOf = (who, level, t0, t1) => {
  const key = who.id + '|' + level + '|' + t0 + '|' + t1;
  let v = afCache.get(key);
  if (v == null) { v = RN.avgFactor(pool, level, who, t0, t1 == null ? RN.SNAPSHOT_DAY : t1, RN.SNAPSHOT_DAY); afCache.set(key, v); }
  return v;
};

const SEG = [];
for (const k of Object.keys(LAD)) {
  const b = LAD[k];
  const rf = refFor(b.ev, b.type, b.level);
  const rho = b.level === 'WR' ? 1 : (b.level === 'CR' ? ctx.rhoC(b.scope) : ctx.rhoN(b.scope));
  const w = RN.EV_WEIGHT_V2[b.ev] == null ? 1 : RN.EV_WEIGHT_V2[b.ev];
  const gL = M1.G[b.level] == null ? 1 : M1.G[b.level];
  for (const r of b.runs) {
    const who = whoOf.get(r.pid);
    if (!who) continue;
    const c = RN.runCredit(r, { ref: rf.ref, capDays: RN.CAP_DAYS_V2, snapshotDay: RN.SNAPSHOT_DAY });
    const f = afOf(who, b.level, r.tStart, r.tEnd);
    SEG.push({
      ev: b.ev, type: b.type, level: b.level, who: who.name, pid: r.pid,
      g: r.gain, r: c.gainNorm, ratio: c.ratio, cap: c.weightCapped, days: c.days,
      credit: c.credit, w, gL, rho, f, score: c.credit * gL * rho * f * w,
      t0: r.tStart, vOut: r.vOut.value,
    });
  }
}

const L = [];
const push = (s) => L.push(s == null ? '' : s);
push('# 占有段口径 · 结构体检');
push('');
push(`> 由 \`etl/score/diag_runs_v2.js\` 生成。段 ${num(SEG.length)} 个，阶梯 ${num(Object.keys(LAD).length)} 条。`);
push('');

/* 1 截顶率 */
const capped = SEG.filter((s) => s.cap).length;
push('## 1 r 截顶率（cap = 3）');
push('');
push(`| 级别 | 段数 | 截顶 | 占比 | 平均 r | 中位 r |`);
push('|---|---|---|---|---|---|');
for (const lv of ['WR', 'CR', 'NR']) {
  const a = SEG.filter((s) => s.level === lv);
  if (!a.length) continue;
  const rs = a.map((s) => s.r).sort((x, y) => x - y);
  push(`| ${lv} | ${num(a.length)} | ${num(a.filter((s) => s.cap).length)} | ${PCT(a.filter((s) => s.cap).length / a.length)} | ${F(a.reduce((x, s) => x + s.r, 0) / a.length)} | ${F(rs[Math.floor(rs.length / 2)])} |`);
}
push(`| **合计** | ${num(SEG.length)} | ${num(capped)} | ${PCT(capped / SEG.length)} | ${F(SEG.reduce((a, s) => a + s.r, 0) / SEG.length)} | |`);
push('');
push('> 截顶率高说明「深推」被一刀切平 —— 超过 3 倍的段彼此不再有区别。');
push('');

/* 2 单段 Top 20 */
push('## 2 单段分数 Top 20');
push('');
push('| # | 项目 | 级别 | 选手 | 成绩 | 守 | G | r | 得分 |');
push('|---|---|---|---|---|---|---|---|---|');
const EVZ = { '333': '三阶', '222': '二阶', '444': '四阶', '333oh': '三阶单手', pyram: '金字塔', '555': '五阶', skewb: '斜转', minx: '五魔', sq1: 'SQ1', clock: '魔表', '333bf': '三阶盲拧', '666': '六阶', '777': '七阶', '333fm': '最少步', '444bf': '四阶盲拧', '333mbf': '多盲', '333ft': '脚拧', '555bf': '五阶盲拧', magic: '八板', mmagic: '十二板', '333mbo': '旧多盲' };
SEG.slice().sort((a, b) => b.score - a.score).slice(0, 20).forEach((s, i) => {
  push(`| ${i + 1} | ${EVZ[s.ev] || s.ev}${s.type === 'avg' ? '平均' : ''} | ${s.level} | ${s.who} | ${s.vOut} | ${s.days} 天 | ${F(s.g)} | ${F(s.r)} | **${F(s.score)}** |`);
});
push('');
const topEv = {};
SEG.slice().sort((a, b) => b.score - a.score).slice(0, 20).forEach((s) => { topEv[s.ev] = (topEv[s.ev] || 0) + 1; });
push(`Top 20 的项目分布：${Object.keys(topEv).map((e) => `${EVZ[e] || e} ${topEv[e]}`).join('、')}。`);
push('');

/* 3 项目单段上界 */
push('## 3 各项目「单段理论最高分」 vs 「实际最高段」');
push('');
push('| 项目 | w | 单段上界 3×w | 实际最高段 | 实际/上界 | 段数 |');
push('|---|---|---|---|---|---|');
const byEv = {};
SEG.forEach((s) => { (byEv[s.ev] = byEv[s.ev] || []).push(s); });
const evRows = Object.keys(byEv).map((e) => {
  const a = byEv[e];
  const mx = a.reduce((x, s) => Math.max(x, s.score), 0);
  const w = RN.EV_WEIGHT_V2[e] || 1;
  return { e, n: a.length, mx, w, ub: 3 * w };
}).sort((x, y) => y.mx - x.mx);
for (const r of evRows) {
  push(`| ${EVZ[r.e] || r.e} | ${F(r.w)} | ${F(r.ub)} | ${F(r.mx)} | ${PCT(r.mx / r.ub)} | ${num(r.n)} |`);
}
push('');
push('> 「单段上界 3×w」是 `r=3` 且守满一年、`V_L=1`、`ρ=1`、`f=1` 的理想值。');
push('> 三阶上界 3.0000 全站最高，是结构性的（w=1 且 V_L=1）。');
push('');

/* 4 级别平均 r 之和检验 */
push('## 4 归一恒等式的实证：Σr ≈ 段数');
push('');
push('| 项目·轨·级别 | 段数 n | Σr | Σr − n | 偏差 |');
push('|---|---|---|---|---|');
const gkey = {};
SEG.forEach((s) => {
  const k = s.ev + '|' + s.type + '|' + s.level;
  (gkey[k] = gkey[k] || { n: 0, sum: 0 });
  gkey[k].n++;
  gkey[k].sum += s.r;
});
const gk = Object.keys(gkey).sort((a, b) => gkey[b].n - gkey[a].n).slice(0, 8);
for (const k of gk) {
  const o = gkey[k];
  push(`| ${k} | ${o.n} | ${F(o.sum)} | ${F(o.sum - o.n)} | ${PCT(Math.abs(o.sum - o.n) / o.n)} |`);
}
push('');

/* 5 rho / f 分布 */
push('## 5 两个乘数的实际分布');
push('');
push('| 乘数 | 最小 | 中位 | 最大 | 平均 |');
push('|---|---|---|---|---|');
for (const key of ['rho', 'f']) {
  const a = SEG.map((s) => s[key]).sort((x, y) => x - y);
  push(`| ${key} | ${F(a[0])} | ${F(a[Math.floor(a.length / 2)])} | ${F(a[a.length - 1])} | ${F(a.reduce((x, y) => x + y, 0) / a.length)} |`);
}
push('');

fs.writeFileSync(path.join(__dirname, '占有段_体检.md'), L.join('\n') + '\n', 'utf8');

console.log('段', SEG.length, '| 截顶', capped, PCT(capped / SEG.length));
console.log('平均 r', F(SEG.reduce((a, s) => a + s.r, 0) / SEG.length));
console.log('单段 Top5:');
SEG.slice().sort((a, b) => b.score - a.score).slice(0, 5).forEach((s) => {
  console.log(' ', EVZ[s.ev] || s.ev, s.type, s.level, s.who, s.vOut, s.days + '天', 'r=' + F(s.r), 'score=' + F(s.score));
});
console.log('写出 占有段_体检.md');

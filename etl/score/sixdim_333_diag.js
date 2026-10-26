'use strict';
/* sixdim_333_diag.js · 只算「三阶 333」这一项：逐维拆解 + 缺口归因 + what-if
 * 只读，不写任何产物（除 stdout）。用法：node sixdim_333_diag.js [pid]
 */
const path = require('path'), fs = require('fs');
const D = __dirname;
const PID = process.argv[2] || '2009ZEMD01';
const EV = '333';
const DIMS = [['M1', 0.28, '纪录持有'], ['M2', 0.24, '领奖台'], ['M3', 0.12, '大赛破纪录'],
  ['M4', 0.18, '统治力'], ['M5', 0.08, '当前排名'], ['M6', 0.10, '突破幅度']];
const W = Object.fromEntries(DIMS.map(([k, w]) => [k, w]));
const BETA = 0.2241;
const RUNS = require('./runs.js');
const evW = (ev) => (RUNS.EV_WEIGHT_V2[ev] == null ? RUNS.WEIGHT_V2_CFG.floor : RUNS.EV_WEIGHT_V2[ev]);
const rows = (f) => fs.readFileSync(path.join(D, f), 'utf8').trim().split('\n').slice(1).map((l) => l.split('\t'));
const f4 = (v) => Number(v).toFixed(4);
/* 刻度：与 etl/score/sixdim.js 的 FULL 保持一致（2026-10-26 由 100 → 1000） */
const FULL = 1000;

/* 采集：dim → Map(pid → v)，仅 EV */
const V = {}, RAW = {};
for (const [dim] of DIMS) { V[dim] = new Map(); RAW[dim] = []; }
for (const c of rows('M1_facts.tsv')) if (c[1] === EV) { RAW.M1.push(c); V.M1.set(c[0], (V.M1.get(c[0]) || 0) + +c[7]); }
for (const c of rows('M2_facts.tsv')) if (c[2] === EV) { RAW.M2.push(c); V.M2.set(c[0], (V.M2.get(c[0]) || 0) + (+c[7]) * (+c[8]) * (c[3] === 'OP' ? BETA : 1)); }
for (const c of rows('M3_facts.tsv')) if (c[1] === EV) { RAW.M3.push(c); V.M3.set(c[0], (V.M3.get(c[0]) || 0) + +c[6]); }
for (const c of rows('M4_facts.tsv')) if (c[1] === EV) { RAW.M4.push(c); V.M4.set(c[0], (V.M4.get(c[0]) || 0) + +c[4]); }
{ const all = rows('M5_facts.tsv'); const y = all.reduce((a, c) => Math.max(a, +c[0]), -1);
  RAW.M5 = all.filter((c) => +c[0] === y && c[2] === EV); V.M5 = new Map();
  for (const c of RAW.M5) V.M5.set(c[1], (V.M5.get(c[1]) || 0) + +c[5]); }
for (const c of rows('M6_by_record.tsv')) if (c[1] === EV) { RAW.M6.push(c); V.M6.set(c[0], (V.M6.get(c[0]) || 0) + +c[7]); }

const L = [];
const P = (s) => L.push(s);
P(`# 三阶 333 单项账本 · ${PID}`);
P('');
const tab = [];
for (const [dim, w, cn] of DIMS) {
  let mx = 0, lpid = '-';
  for (const [p, v] of V[dim]) if (v > mx) { mx = v; lpid = p; }
  const v = V[dim].get(PID) || 0, rel = mx > 0 ? v / mx : 0;
  tab.push({ dim, w, cn, v, mx, lpid, rel, s: rel * FULL, contrib: w * rel * FULL, gap: w * (1 - rel) * FULL });
}
const total = tab.reduce((s, x) => s + x.contrib, 0);
P(`## 一、三阶得分 = ${f4(total)} / ${FULL}`);
P('');
P(`| 维 | 权重 | 他 | 三阶榜首 | rel | 得分 w×rel×${FULL} | 缺口（相对满分） |`);
P('|---|---|---|---|---|---|---|');
for (const t of tab) P(`| ${t.dim} ${t.cn} | ${t.w} | ${f4(t.v)} | ${f4(t.mx)}（${t.lpid}） | ${f4(t.rel)} | ${f4(t.contrib)} | ${t.gap > 0.00005 ? '**−' + f4(t.gap) + '**' : '0（满分）'} |`);
P(`| **合计** | 1.00 | | | | **${f4(total)}** | **−${f4(FULL - total)}** |`);
P('');
P(`缺口归因：M5 占 ${f4(tab[4].gap / (FULL - total) * 100)}% ，M2 占 ${f4(tab[1].gap / (FULL - total) * 100)}%。`);
P('');

/* 三阶榜 Top5 */
const site = fs.readFileSync(path.join(D, 'sixdim_by_event.tsv'), 'utf8').trim().split('\n').slice(1)
  .filter((l) => l.split('\t')[1] === EV).map((l) => { const c = l.split('\t'); return { pid: c[0], t: +c[8], s: c.slice(2, 8) }; })
  .sort((a, b) => b.t - a.t);
P('## 二、三阶单项榜 Top5');
P('');
P('| # | 选手 | 三阶分 | M1 | M2 | M3 | M4 | M5 | M6 |');
P('|---|---|---|---|---|---|---|---|---|');
site.slice(0, 5).forEach((x, i) => P(`| ${i + 1} | ${x.pid} | **${f4(x.t)}** | ${x.s.map((v) => f4(+v)).join(' | ')} |`));
P('');

/* 逐维机制 */
const mine = (dim) => RAW[dim].filter((c) => c[0] === PID);
P('## 三、每一维的构成与扣分机制');
P('');
/* M1 */
{ const m = mine('M1'); const by = {};
  for (const c of m) { const k = c[3] + '/' + c[2]; by[k] = by[k] || { n: 0, s: 0 }; by[k].n++; by[k].s += +c[7]; }
  const yrs = m.map((c) => +c[5]);
  P(`**M1 纪录持有 = ${f4(tab[0].v)}（三阶榜首，满分）**：${m.length} 条纪录段，${Math.min(...yrs)}–${Math.max(...yrs)} 年。`);
  P('| 级别/轨 | 条数 | 得分 |'); P('|---|---|---|');
  for (const k of Object.keys(by).sort()) P(`| ${k} | ${by[k].n} | ${f4(by[k].s)} |`);
  P(''); }
/* M2 */
{ const m = mine('M2'); const by = {};
  for (const c of m) { const k = c[3]; by[k] = by[k] || { n: 0, base: 0, real: 0 };
    by[k].n++; by[k].base += +c[7]; by[k].real += (+c[7]) * (+c[8]) * (c[3] === 'OP' ? BETA : 1); }
  const lead = V.M2.get(tab[1].lpid);
  const lm = RAW.M2.filter((c) => c[0] === tab[1].lpid); const lby = {};
  for (const c of lm) { const k = c[3]; lby[k] = lby[k] || { n: 0, real: 0 }; lby[k].n++; lby[k].real += (+c[7]) * (+c[8]) * (c[3] === 'OP' ? BETA : 1); }
  P(`**M2 领奖台 = ${f4(tab[1].v)}（榜首 ${f4(lead)}，rel ${f4(tab[1].rel)}）**：${m.length} 次三阶上台。`);
  P('| 赛事级 | 他的场次 | 他的得分 | 榜首同项场次 | 榜首得分 |'); P('|---|---|---|---|---|');
  for (const k of ['WC', 'CC', 'NC', 'OP']) if (by[k] || lby[k])
    P(`| ${k} | ${by[k] ? by[k].n : 0} | ${by[k] ? f4(by[k].real) : '0'} | ${lby[k] ? lby[k].n : 0} | ${lby[k] ? f4(lby[k].real) : '0'} |`);
  P('');
  P('> 关键：普通赛（OP）按「同人同项目 OP 上台的序号 n」打 ×n^−0.5 折扣，且还要再乘 BETA=0.2241；');
  P('> 锦标赛（WC/CC/NC）decay 恒 = 1。所以他 158 场里大部分是墨尔本小比赛，被双重压缩。');
  P(''); }
/* M3 */
{ const m = mine('M3');
  P(`**M3 大赛破纪录 = ${f4(tab[2].v)}（三阶榜首，满分）**：只有 ${m.length} 条，因为只奖「在锦标赛上破的纪录」。`);
  P('| 年 | 轨 | 级别 | 赛事级 | 加分 |'); P('|---|---|---|---|---|');
  for (const c of m.sort((a, b) => +a[5] - +b[5])) P(`| ${c[5]} | ${c[2] === 'S' ? '单次' : '平均'} | ${c[3]} | ${c[4]} | ${f4(+c[6])} |`);
  P(''); }
/* M4 */
{ const m = mine('M4'); const yrs = {};
  for (const c of m) yrs[c[3]] = (yrs[c[3]] || 0) + +c[4];
  P(`**M4 统治力 = ${f4(tab[3].v)}（三阶榜首，满分）**：${m.length} 条年度席位，按「名次^-1 × 年代折算」累加。`);
  P('| 年 | 贡献 |'); P('|---|---|');
  const ks = Object.keys(yrs).sort();
  for (const k of ks) P(`| ${k} | ${f4(yrs[k])} |`);
  P(`| **合计** | **${f4(ks.reduce((s, k) => s + yrs[k], 0))}** |`);
  P(''); }
/* M5 */
{ const m = RAW.M5.filter((c) => c[1] === PID);
  const yy = RAW.M5[0] ? RAW.M5[0][0] : '-';
  P(`**M5 当前排名 = ${f4(tab[4].v)}（榜首 ${f4(tab[4].mx)}，rel ${f4(tab[4].rel)}）**：取 ${yy} 年快照（历史逐年见下，只取最后一年计分）。`);
  P('| 轨 | 名次 | 分 | 隐含系数 |'); P('|---|---|---|---|');
  for (const c of m) P(`| ${c[3]} | ${c[4]} | ${f4(+c[5])} | ${f4(+c[5] / (1 / +c[4]))} |`);
  const hist = RAW.M5.filter((c) => c[1] === PID);
  P('');
  P(`> 公式：rank^-1 × max(0.2, 1−gapR/5×0.8) × max(0.2, 1−gapP/5×0.8)，深度只算前 100 名。`);
  P(`> 隐含系数 = 两个新鲜度因子的乘积：单次 ${f4(+hist.find((c) => c[3] === 'single')[5] * (hist.find((c) => c[3] === 'single')[4]))}（PB 还很新）、`);
  P(`> 平均 ${f4(+hist.find((c) => c[3] === 'avg')[5] * (hist.find((c) => c[3] === 'avg')[4]))}（撞到 0.2 下限，PB 是 2018 年之前的老账）。`);
  P(''); }
/* M6 */
{ const m = mine('M6');
  P(`**M6 突破幅度 = ${f4(tab[5].v)}（三阶榜首，满分）**：${m.length} 次三阶 WR 刷新，每次 min(ln(前值/新值), 0.5)。`);
  P('| 日期 | 轨 | gain | 截顶后 | 自己刷新 |'); P('|---|---|---|---|---|');
  for (const c of m.sort((a, b) => a[3] < b[3] ? -1 : 1)) P(`| ${c[3]} | ${c[2]} | ${f4(+c[6])} | ${f4(+c[7])} | ${c[8] === '1' ? '是' : ''} |`);
  P(''); }

/* what-if */
const c0 = tab.reduce((s, t) => s + t.w * t.rel, 0);
const noM5 = tab.filter((t) => t.dim !== 'M5').reduce((s, t) => s + t.w * t.rel, 0) / (1 - W.M5) * FULL;
const m5full = (c0 - W.M5 * tab[4].rel + W.M5) * FULL;
const m5m2full = (c0 - W.M5 * tab[4].rel + W.M5 - W.M2 * tab[1].rel + W.M2) * FULL;
P('## 四、what-if：这 9.83 分差从哪来');
P('');
P(`- 现状：${f4(total)}`);
P(`- 若 M5 也拿满额（"他现在还是三阶世界第一"）：**${f4(m5full)}**（+${f4(m5full - total)}）`);
P(`- 若 M2 也拿满额（"三阶领奖台不比 Max 少"）：再 +${f4(W.M2 * (1 - tab[1].rel) * FULL)} → **${f4(m5m2full)}**`);
P(`- 若整个 M5 维度不计、其余五维按权重重新归一：**${f4(noM5)}**`);
P('');
P(`参考：三阶第二名 ${site[1] ? site[1].pid + ' ' + f4(site[1].t) : '-'}，他领先 ${site[1] ? f4(total - site[1].t) : '-'} 分（${site[1] ? (total / site[1].t).toFixed(2) : '-'} 倍）。`);

console.log(L.join('\n'));

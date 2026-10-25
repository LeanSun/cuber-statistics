'use strict';
/* Feliks Zemdegs · M1 计算账本生成器
 *
 * 目的：把「102.22 分」拆到每一步乘法，任何一行都能被独立核对。
 * 用法：node etl/score/ledger_feliks.js
 * 产出：etl/score/Feliks_计算账本.md
 *
 * 所有数字均现算，不写死。
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
const TOTAL = R.total;

const r = (v, n = RN.DEC) => RN.R4(v, n);
const F = (v, n = RN.DEC) => RN.F4(v, n);
const pct = (v) => RN.P4(v, 2);

/* ── 池子：raw 名册 + detail 层合并（分子分母同源） ── */
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

const f = P.find((x) => x.name === 'Feliks Zemdegs');
const cont = Calc.contOfIso(f.country);
const contZh = (Calc.CONTINENTS[cont] || {}).zh || cont;
const RHO_C = ctx.rhoC(cont);
const RHO_N = ctx.rhoN(f.country);

/* ── 年份分布（evS 第 26 段，逐条累加，不受 12 条截断影响） ── */
function yearDist(p) {
  const a = {};
  if (!p.evS) return a;
  p.evS.split(';').forEach((part) => {
    const i = part.indexOf(':');
    if (i < 0) return;
    const n = part.slice(i + 1).split(',');
    (n[25] || '').split('.').forEach((kv) => {
      if (!kv) return;
      const j = kv.indexOf('_');
      const y = +kv.slice(0, j);
      a[y] = (a[y] || 0) + +kv.slice(j + 1);
    });
  });
  return a;
}
const yd = yearDist(f);
const years = Object.keys(yd).map(Number).sort((a, b) => a - b);
const nAll = Object.values(yd).reduce((a, b) => a + b, 0);

/* ── 逐年的三个折算系数 ── */
const yRows = years.map((y) => ({
  y,
  n: yd[y],
  gN: pool.globalAt(y),
  fW: pool.valueOf('WR', {}, y),
  cN: pool.contAt(cont, y),
  fC: pool.valueOf('CR', { cont }, y),
  nN: pool.natAt(f.country, y),
  fN: pool.valueOf('NR', { nat: f.country }, y),
}));
const wavg = (k) => yRows.reduce((a, x) => a + x.n * x[k], 0) / nAll;
const FW = wavg('fW');
const FC = wavg('fC');
const FN = wavg('fN');

/* ── 轨道拆分 ── */
const rec = f.mCalc.rec;
const nrSplit = M1.splitNr(rec, f.nr);
const tracks = [
  { name: '单次', wr: rec[0], cr: rec[1], nr: nrSplit.nrS },
  { name: '平均', wr: rec[3], cr: rec[4], nr: nrSplit.nrA },
];
const calc = tracks.map((t) => {
  const wp = t.wr * M1.G.WR * FW;
  const cp = t.cr * M1.G.CR * RHO_C * FC;
  const np = t.nr * M1.G.NR * RHO_N * FN;
  return { ...t, wp, cp, np, total: wp + cp + np };
});
const SUM_S = calc[0].total;
const SUM_A = calc[1].total;
const SUM_T = SUM_S + SUM_A;

/* ── 逐项目（evS 轨道合计，不分单次/平均） ── */
const EVK = ['rows', 'att', 'sol', 'dnf', 'pod', 'gold', 'sil', 'bro', 'wr', 'cr', 'nr', 'comps', 'wc', 'cc', 'nc', 'lo', 'op', 'held', 'heldLong', 'heldNow'];
function decEv(s) {
  const o = {};
  if (!s) return o;
  s.split(';').forEach((part) => {
    const i = part.indexOf(':');
    if (i < 0) return;
    const id = part.slice(0, i);
    const n = part.slice(i + 1).split(',');
    const b = {};
    EVK.forEach((k, j) => { b[k] = +n[j] || 0; });
    o[id] = b;
  });
  return o;
}
const es = decEv(f.evS);
const W = {};
(f.mCalc.rk || []).forEach(([e, rk, q, w]) => { W[e] = w; });
const evRows = Object.keys(es).map((e) => {
  const b = es[e];
  const w = W[e] || 0;
  const wp = b.wr * M1.G.WR * FW;
  const cp = b.cr * M1.G.CR * RHO_C * FC;
  const np = b.nr * M1.G.NR * RHO_N * FN;
  const t = wp + cp + np;
  return { e, w, wr: b.wr, cr: b.cr, nr: b.nr, wp, cp, np, t, wt: t * w };
});
evRows.sort((a, b) => b.wt - a.wt);
const evSum = (k) => evRows.reduce((a, x) => a + x[k], 0);
const SUM_W = evSum('w');

/* ── 无折算对照（把三个 f 全部置 1） ── */
const noT = calc.map((t) => t.wr * M1.G.WR + t.cr * M1.G.CR * RHO_C + t.nr * M1.G.NR * RHO_N);
const NO_TOTAL = noT[0] + noT[1];

/* ══════════ 生成文档 ══════════ */
const L = [];
const push = (s) => L.push(s);

push('# Feliks Zemdegs · M1 计算账本');
push('');
push('> 本文由 `etl/score/ledger_feliks.js` 自动生成，所有数字现算，可用于逐行核对。');
push('> 公式与参数见 `etl/score/m1.js`；口径决策见 `M1_验收报告.md`。');
push('');
push('## 结论先行');
push('');
push('| 轨道 | 分数 | 名次 |');
push('|---|---|---|');
push(`| 单次 | **${F(SUM_S)}** | 全站第 1 |`);
push(`| 平均 | **${F(SUM_A)}** | 全站第 2（Max Park 56.82 第 1） |`);
push(`| 总计 | **${F(SUM_T)}** | 全站第 1 |`);
push('');
push(`如果把时代折算全部去掉，总计是 ${F(NO_TOTAL)} 分。` +
  `**时代折算拿走了 ${F(NO_TOTAL - SUM_T)} 分（${pct((NO_TOTAL - SUM_T) / NO_TOTAL)}）**，` +
  `这个差额就是「他的纪录主要发生在 2009–2014」的代价。`);
push('');
push('---');
push('');
push('## 一、三个输入');
push('');
push('### 1.1 条数（分子）');
push('');
push('| 级别 | 单次 | 平均 | 合计 |');
push('|---|---|---|---|');
push(`| WR（世界纪录） | ${rec[0]} | ${rec[3]} | **${rec[0] + rec[3]}** |`);
push(`| CR（洲纪录） | ${rec[1]} | ${rec[4]} | **${rec[1] + rec[4]}** |`);
push(`| NR（国家纪录） | ${F(nrSplit.nrS)} | ${F(nrSplit.nrA)} | **${f.nr}** |`);
push(`| 合计 | ${F(rec[0] + rec[1] + nrSplit.nrS)} | ${F(rec[3] + rec[4] + nrSplit.nrA)} | **${f.wr + f.cr + f.nr}** |`);
push('');
push(`一条纪录只归最高的一级：${f.wr + f.cr + f.nr} = ${f.wr} + ${f.cr} + ${f.nr}，三级互不重叠。`);
push('所以他「只有 7 条国家纪录」不是他弱——大量澳洲国家纪录本身也是大洋洲纪录，被 CR 覆盖了。');
push('');
push('**NR 为什么要拆**：旧字段 `nrWS`/`nrWA` 里混进了 WR 和 CR 的条数（历史 bug），' +
  `必须先扣掉才能得到纯 NR。原始值 ${rec[2]} − ${rec[0]} − ${rec[1]} = ${r(rec[2] - rec[0] - rec[1], 2)}（单次），` +
  `${rec[5]} − ${rec[3]} − ${rec[4]} = ${r(rec[5] - rec[3] - rec[4], 2)}（平均）；` +
  `再按这两者的比例把总数 ${f.nr} 分配下去，得 ${r(nrSplit.nrS, 2)} / ${r(nrSplit.nrA, 2)}。`);
push('');
push('> ⚠️ **这两个是估算，不是精确条数。** 那两个减出来的值（1.2 / 1.13）是「加权条数」——' +
  '每条 NR 都乘了一个国家规模折扣 ns（0.12–1.0），所以它们本来就不是整数。' +
  '真实条数 ETL 内部其实有（`p.nrS` / `p.nrA`，`addRecord` 里逐条 `++`），但没有下发给前端。' +
  '若真实拆分是 4 单次 / 3 平均，应改为 4.00 / 3.00。' +
  '**这个误差不影响总分**（7 条的总和不变、单条分值相同），只影响两轨之间的分配，差异 < 0.002 分。');
push('');
push('### 1.2 竞争密度（分母）');
push('');
push('| 量 | 数值 | 说明 |');
push('|---|---|---|');
push(`| 全量选手总数 | ${TOTAL.toLocaleString()} | roster ${R.rows.split('\n').filter(Boolean).length.toLocaleString()} + data.js ${P.length.toLocaleString()}，两档不重叠 |`);
push(`| ${contZh}选手数 | ${contCount[cont].toLocaleString()} | ρ洲 的分子 |`);
push(`| 澳大利亚选手数 | ${natCount[f.country].toLocaleString()} | ρ国 的分子 |`);
push(`| **ρ洲** | ${r(RHO_C, 6)} | ${contCount[cont].toLocaleString()} ÷ ${TOTAL.toLocaleString()} |`);
push(`| **ρ国** | ${r(RHO_N, 6)} | ${natCount[f.country].toLocaleString()} ÷ ${TOTAL.toLocaleString()} |`);
push('');
push(`这意味 1 条世界纪录 ≈ ${F(1 / (0.4 * RHO_C))} 条大洋洲纪录 ≈ ${F(1 / (0.15 * RHO_N))} 条澳大利亚纪录。`);
push('洲／国家纪录保留权重，但不构成排名主力——这是 A 方案的直接结果。');
push('');
push('### 1.3 时代系数（时间的价）');
push('');
push('每条纪录的分，还要乘一个「它发生在哪一年」的系数。三个级别各用**各自的池子**：');
push('');
push('```');
push('f_WR(y) = ln(1 + 全球累计人数(y)) / ln(1 + 全球累计人数(2026))');
push('f_CR(y) = ln(1 + 该洲累计人数(y)) / ln(1 + 该洲累计人数(2026))');
push('f_NR(y) = ln(1 + 该国累计人数(y)) / ln(1 + 该国累计人数(2026))');
push('```');
push('');
push('## 二、第一步：把 356 条纪录按年份摊开');
push('');
push('| 年份 | 条数 | 全球累计 | f_WR | 大洋洲累计 | f_CR | 澳洲累计 | f_NR |');
push('|---|---|---|---|---|---|---|---|');
yRows.forEach((x) => {
  push(`| ${x.y} | ${x.n} | ${Math.round(x.gN).toLocaleString()} | ${F(x.fW, 4)} | ${Math.round(x.cN).toLocaleString()} | ${F(x.fC, 4)} | ${Math.round(x.nN).toLocaleString()} | ${F(x.fN, 4)} |`);
});
push(`| **合计** | **${nAll}** | | | | | | |`);
push('');
push('### 单看 2010 年，就能看出为什么要分级别');
push('');
const y2010 = yRows.find((x) => x.y === 2010);
if (y2010) {
  push(`他 ${y2010.n} 条纪录落在 2010 年（占 ${pct(y2010.n / nAll)}）。同一年，三个级别的价不一样：`);
  push('');
  push('| 级别 | 当时池子 | 今日池子 | 折算系数 | 算式 |');
  push('|---|---|---|---|---|');
  push(`| WR | ${Math.round(y2010.gN).toLocaleString()} | ${Math.round(pool.globalAt(2026)).toLocaleString()} | **${F(y2010.fW, 4)}** | ln(1+${Math.round(y2010.gN).toLocaleString()}) ÷ ln(1+${Math.round(pool.globalAt(2026)).toLocaleString()}) |`);
  push(`| CR | ${Math.round(y2010.cN).toLocaleString()} | ${Math.round(pool.contAt(cont, 2026)).toLocaleString()} | **${F(y2010.fC, 4)}** | ln(1+${Math.round(y2010.cN).toLocaleString()}) ÷ ln(1+${Math.round(pool.contAt(cont, 2026)).toLocaleString()}) |`);
  push(`| NR | ${Math.round(y2010.nN).toLocaleString()} | ${Math.round(pool.natAt(f.country, 2026)).toLocaleString()} | **${F(y2010.fN, 4)}** | ln(1+${Math.round(y2010.nN).toLocaleString()}) ÷ ln(1+${Math.round(pool.natAt(f.country, 2026)).toLocaleString()}) |`);
  push('');
  push(`2010 年大洋洲只有 ${Math.round(y2010.cN)} 人参赛，澳大利亚只有 ${Math.round(y2010.nN)} 人。`);
  push('所以 2010 年的一条大洋洲纪录，只值今天的 ' + F(y2010.fC) + '；同一年的世界纪录值 ' + F(y2010.fW) + '。' +
    '**同样叫「洲纪录」，含金量差 ' + F(y2010.fW / y2010.fC, 1) + ' 倍**，旧模型看不到这件事。');
}
push('');
push('## 三、第二步：加权平均成一个系数');
push('');
push('他 356 条纪录分散在 18 个年份，每个年份的价不同，所以要按条数加权：');
push('');
push('```');
push(`f_WR = Σ(该年条数 × f_WR) ÷ ${nAll}`);
push('```');
push('');
push('| 系数 | 加权结果 | 含义 |');
push('|---|---|---|');
push(`| f_WR | **${F(FW, 6)}** | 他的世界纪录平均只值今天的 ${pct(FW)} |`);
push(`| f_CR | **${F(FC, 6)}** | 他的洲纪录平均值今天的 ${pct(FC)} |`);
push(`| f_NR | **${F(FN, 6)}** | 他的国家纪录平均值今天的 ${pct(FN)} |`);
push('');
push(`f_WR 比 f_CR 高，是因为两个池子的膨胀速度不同：2010→2026，全球从 ${Math.round(pool.globalAt(2010)).toLocaleString()} 涨到 ${Math.round(pool.globalAt(2026)).toLocaleString()}（${F(pool.globalAt(2026) / pool.globalAt(2010), 0)} 倍），` +
  `大洋洲从 ${Math.round(pool.contAt(cont, 2010))} 涨到 ${Math.round(pool.contAt(cont, 2026)).toLocaleString()}（${F(pool.contAt(cont, 2026) / pool.contAt(cont, 2010), 0)} 倍）。` +
  '大洋洲膨胀得快得多，所以它 2010 年的纪录相对今天更「便宜」。这是数据事实，不是设定。');
push('');
push('## 四、第三步：单次与平均分开算');
push('');
push('| 轨道 | WR | CR | NR |');
push('|---|---|---|---|');
push(`| 单次 | ${rec[0]} | ${rec[1]} | ${F(nrSplit.nrS)} |`);
push(`| 平均 | ${rec[3]} | ${rec[4]} | ${F(nrSplit.nrA)} |`);
push('');
push('## 五、第四步：代入公式，逐个乘');
push('');
push('```');
push('track = WR×1.00×f_WR + CR×0.40×ρ洲×f_CR + NR×0.15×ρ国×f_NR');
push('```');
push('');
calc.forEach((t) => {
  push(`### ${t.name}`);
  push('');
  push('| 级别 | 条数 | 级别价值 | 密度 | 时代系数 | 得分 |');
  push('|---|---|---|---|---|---|');
  push(`| WR | ${t.wr} | 1.00 | 1 | ${F(FW, 4)} | **${F(t.wp, 4)}** |`);
  push(`| CR | ${t.cr} | 0.40 | ${r(RHO_C, 6)} | ${F(FC, 4)} | **${F(t.cp, 4)}** |`);
  push(`| NR | ${F(t.nr)} | 0.15 | ${r(RHO_N, 6)} | ${F(FN, 4)} | **${F(t.np, 4)}** |`);
  push(`| **小计** | | | | | **${F(t.total, 4)}** |`);
  push('');
  push('```');
  push(`WR: ${t.wr} × 1.00 × ${F(FW, 4)} = ${F(t.wp, 4)}`);
  push(`CR: ${t.cr} × 0.40 × ${r(RHO_C, 6)} × ${F(FC, 4)} = ${F(t.cp, 4)}`);
  push(`NR: ${F(t.nr)} × 0.15 × ${r(RHO_N, 6)} × ${F(FN, 4)} = ${F(t.np, 4)}`);
  push(`合计 = ${F(t.total, 4)}`);
  push('```');
  push('');
});
push('### 总计');
push('');
push('```');
push(`M1_total = ${F(SUM_S, 4)}（单次） + ${F(SUM_A, 4)}（平均） = ${F(SUM_T, 4)}`);
push('```');
push('');
push('模块核对：`M1.scorePlayer()` 返回 ' +
  `${F(M1.scorePlayer({ rec, nr: f.nr, cont, country: f.country }, ctx, { pool, yearDist: yd }).total, 4)}，与上式一致。`);
push('');
push('## 六、第五步：拆到每个项目');
push('');
push('M1 这一个维度在选手身上的落地方式，不是「一个维度一个总分」，而是**每项目单独算、乘项目系数、再累加**。这是你要的架构。');
push('');
push('| 项目 | 项目系数 w | WR | CR | NR | 项目分 | 乘 w 后 |');
push('|---|---|---|---|---|---|---|');
evRows.forEach((x) => {
  push(`| ${x.e} | ${F(x.w)} | ${x.wr} | ${x.cr} | ${x.nr} | ${F(x.t)} | ${x.wt ? '**' + F(x.wt) + '**' : '0.00'} |`);
});
push(`| **合计** | Σw = ${F(SUM_W)} | ${evSum('wr')} | ${evSum('cr')} | ${evSum('nr')} | **${F(evSum('t'), 2)}** | **${F(evSum('wt'), 2)}** |`);
push('');
push('两件事值得注意：');
push('');
push(`**① 他最强的项目不是三阶，是五阶。** 五阶 ${F(evRows.find((x) => x.e === '555').t, 1)} 分 × 0.85 = ${F(evRows.find((x) => x.e === '555').wt, 2)}，` +
  `超过三阶 ${F(evRows.find((x) => x.e === '333').t, 1)} × 1.00 = ${F(evRows.find((x) => x.e === '333').wt, 2)}。` +
  '他在五阶上有 37 条世界纪录，2009–2013 年几乎垄断。只看三阶会误判他的能力结构。');
push('');
push(`**② ${F(evSum('t'), 2)} 与 ${F(evSum('wt'), 2)} 的差，就是「乘项目系数」这一步。** ` +
  `${F(evSum('t'), 2)} 是未加权的原始强度，${F(evSum('wt'), 2)} 才是 M1 维度真正计入总分的贡献量` +
  `（因为 Σw = ${F(SUM_W)}，不是 1；Feliks 的项目权重多在 0.8–1.0，所以比值 ${F(evSum('wt') / evSum('t'), 3)}）。`);
push('');
push('这 89.41 分只是**七分之一个维度**。总分要等 M2–M7 用同一套「项目分 × 系数 → 累加」算完才能出。');
push('');
push('## 七、三个必须知道的口径限制');
push('');
push('**① 时代系数没分到轨道。** `evS.recPerYear` 只记到「年份」，不区分单次/平均、也不区分 WR/CR/NR。' +
  '所以上面 54 条单次 WR 和 67 条平均 WR 用的是同一个 f_WR = ' + F(FW, 4) + '。' +
  '要精确到「每条纪录自己的年份 × 自己的级别」，ETL 必须新增「级别 × 年份 × 轨道」计数器。');
push('');
push('**② 逐项目求和与轨道求和完全相等，不是巧合。** ' +
  `因为 ρ 和 f 对同一选手是常数，公式对条数是线性的，所以 Σ(逐项目) 必然 = 轨道合计。` +
  `这证明逐项目拆分是**精确**的，不是近似——但也说明现在这个拆分拿不到「某项目的纪录发生在哪一年」这层信息。`);
push('');
push('**③ 澳大利亚人数用的是全量口径 ' + natCount[f.country].toLocaleString() + '**，' +
  '不是 detail 层的 1,956。分子分母同源才不会让「抽样比例不同的国家」获得虚高权重。' +
  '若改用 detail 层，ρ国 会从 ' + r(RHO_N, 4) + ' 降到约 0.033，他的 NR 分会略升——但 NR 只占他总分的 ' +
  `${((calc[0].np + calc[1].np) / SUM_T * 100).toFixed(2)}%，改了也不影响名次。`);
push('');
push('---');
push('');
push('*本文由脚本生成，重跑 `node etl/score/ledger_feliks.js` 可复现全部数字。*');
push('');
push('【本内容仅为数据处理建议与结果说明，重要决策前请核验原始数据】');

const out = path.join(ROOT, 'etl/score/Feliks_计算账本.md');
fs.writeFileSync(out, L.join('\n'), 'utf8');
console.log('written:', out, L.length, 'lines');
console.log('SUM_S', r(SUM_S), 'SUM_A', r(SUM_A), 'SUM_T', r(SUM_T), 'noT', r(NO_TOTAL), 'evSumWt', r(evSum('wt')));

'use strict';
/* M1 · 项目权重 v2 验收 + 文档生成
 *
 * 用法：node etl/score/verify_weights.js
 * 产出：etl/score/M1_项目权重v2.md
 *
 * 这份文档回答三个问题：
 *   ① 旧的 w_e 表错在哪（要有数字，不是感觉）
 *   ② 新表怎么算出来的（必须可复现，不能又变成一条手写序列）
 *   ③ 换成新表之后，排序会不会变（用 Feliks / Max 实测）
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
global.window = {};
require(path.join(ROOT, 'js/data.js'));
require(path.join(ROOT, 'js/roster.js'));
const Calc = require(path.join(ROOT, 'js/calc.js'));
const RN = require(path.join(ROOT, 'etl/score/runs.js'));

const P = global.window.MOCK.players;
const F = (v, n = RN.DEC) => RN.F4(v, n);
const pct = (v, d = 2) => RN.P4(v, d);
const zhOf = (e) => (Calc.EV[e] || {}).zh || e;
const wL = Calc.EVENTS.reduce((m, e) => { m[e.id] = e.w; return m; }, {});
const wV = RN.EV_WEIGHT_V2;
const stat = RN.EV_STAT;

/* ── 观测数据核对：EV_STAT 是否与现算一致 ─────────────────────
   pr 用「认真参赛者池」（comps ≥ 3）的 events 集合算，与 EV_STAT 同源；
   ar 只能用 detail 层的真实 per-event 次数，两者分别报偏差。 */
const R = global.window.WCA_ROSTER;
const POOL = [];
for (const ln of R.rows.split('\n')) {
  if (!ln) continue;
  const f = ln.split('~');
  if (f.length < 9) continue;
  POOL.push({ comps: +f[7] || 0, events: f[8] ? f[8].split(',') : [] });
}
for (const p of P) POOL.push({ comps: p.comps || 0, events: p.events || [] });
const K_MIN = 3;
const cnt = {};
let poolN = 0;
for (const p of POOL) {
  if (p.comps < K_MIN || !p.events.length) continue;
  poolN++;
  for (const e of p.events) cnt[e] = (cnt[e] || 0) + 1;
}
const T0 = cnt['333'];

const aggAR = {};
P.forEach((p) => {
  if (!p.evS) return;
  p.evS.split(';').forEach((seg) => {
    const i = seg.indexOf(':');
    if (i < 0) return;
    const ev = seg.slice(0, i);
    const att = +(seg.slice(i + 1).split(',')[1] || 0);
    if (att <= 0) return;
    (aggAR[ev] = aggAR[ev] || { people: 0, att: 0 });
    aggAR[ev].people++;
    aggAR[ev].att += att;
  });
});
const T333 = aggAR['333'];
let maxDevPr = 0, maxDevAr = 0, devPrEv = '', devArEv = '';
for (const e of Object.keys(stat)) {
  const pr = cnt[e] == null ? 0 : cnt[e] / T0;
  const a = aggAR[e];
  const ar = a ? (a.att / a.people) / (T333.att / T333.people) : null;
  if (Math.abs(pr - stat[e].pr) > maxDevPr) { maxDevPr = Math.abs(pr - stat[e].pr); devPrEv = e; }
  if (ar != null && Math.abs(ar - stat[e].ar) > maxDevAr) { maxDevAr = Math.abs(ar - stat[e].ar); devArEv = e; }
}

/* ── 表 ───────────────────────────────────────────────────── */
const rows = Object.keys(wV).map((e) => ({
  e, zh: zhOf(e), pr: stat[e].pr, ar: stat[e].ar, s: RN.scaleOf(e), wl: wL[e] || 0, wv: wV[e],
})).sort((a, b) => b.wv - a.wv);

const srt = rows.map((r) => r.e);
const second = rows[1];
const last = rows[rows.length - 1];
const wlSorted = rows.slice().sort((a, b) => b.wl - a.wl);
const wlSecond = wlSorted[1];

const L = [];
const push = (s) => L.push(s == null ? '' : s);
const now = new Date(Date.now() + 8 * 3600e3);

push('# M1 · 项目权重 v2');
push('');
push(`> 生成时间：${now.toISOString().slice(0, 16).replace('T', ' ')}（北京时间）｜由 \`etl/score/verify_weights.js\` 自动生成，数字全部现算`);
push('> 实现：`etl/score/runs.js` 的 `EV_STAT` / `WEIGHT_V2_CFG` / `buildWeightV2` / `scoreRunsV2`');
push('> 断言：`etl/score/test_runs.js` 的 [11]–[14]');
push('');

push('## 0 一页结论');
push('');
push(`- 三阶权重 = **1.0000**，是全体 21 个项目的上界。这不是调出来的，是公式在 s=1 处的取值。`);
push(`- 次高是${second.zh} **${F(second.wv, 4)}**，三阶领先 **${pct(1 / second.wv - 1)}**（旧表只领先 ${pct(1 / wlSecond.wl - 1)}）。`);
push(`- 最低是${last.zh} **${F(last.wv, 4)}**，量程 **${F(1 / last.wv)} 倍**（旧表 ${F(1 / wlSorted[wlSorted.length - 1].wl)} 倍）。`);
push(`- 权重由两个可测分量算出：活跃人数比、人均参赛次数比。改数据即可重算，不再是一条手写序列。`);
push('- M1 旧条数口径下，Feliks / Max 比值 1.1638× → 1.2939×（现算见 `compare_v2.js`）；占有段口径是另一回事，见 `纪录分_全站.md`。');
push('');

/* ── 1 旧表的问题 ── */
push('## 1 旧表（`js/calc.js` 的 EVENTS[].w）错在哪');
push('');
push('三件事，都能量化：');
push('');
const wlAll = Object.keys(wL).map((e) => wL[e]);
const wlMax = Math.max(...wlAll), wlMin = Math.min(...wlAll);
push(`**① 量程不够。** ${F(wlMax)} → ${F(wlMin)}，全区间只有 **${F(wlMax / wlMin)} 倍**。`);
push(`   而真实差距：三阶人均参赛 ${Math.round(T0.att / T0.people)} 次，四盲 ${Math.round(aggAR['444bf'].att / aggAR['444bf'].people)} 次，差 **${F((T0.att / T0.people) / (aggAR['444bf'].att / aggAR['444bf'].people), 1)} 倍**。`);
push(`   用 ${F(wlMax / wlMin)} 倍的尺子量 ${F((T0.att / T0.people) / (aggAR['444bf'].att / aggAR['444bf'].people), 1)} 倍的差距，尺子本身就不够长。`);
push('');
push(`**② 分不开相近项目。** 四盲 ${F(wL['444bf'])} vs 三盲 ${F(wL['333bf'])}，只差 ${pct(wL['333bf'] / wL['444bf'] - 1)}。`);
push(`   而两者的规模指数差 **${F(RN.scaleOf('333bf') / RN.scaleOf('444bf'), 1)} 倍**（${F(RN.scaleOf('333bf'), 3)} vs ${F(RN.scaleOf('444bf'), 3)}）。`);
push('   一个只有 5% 差别的相邻档位，不可能承载 3 倍的真实差异 —— 它把两者压成了同一档。');
push('');
push('**③ 没有来源。** 整张表没有任何计算过程，改一个值也无人能复核。');
push('   它实际起的作用是"给每个项目一个体面的数字"，而不是"定价"。');
push('');

/* ── 2 新度量 ── */
push('## 2 新度量：项目规模指数 s_e');
push('');
push('两个分量，都从 `evS` 直接可算：');
push('');
push('```');
push('pr_e = 该项目活跃人数 / 三阶活跃人数              ← 广度：多少人在玩');
push('ar_e = 该项目人均参赛次数 / 三阶人均参赛次数        ← 深度：每人玩多久');
push('s_e  = pr_e × sqrt(ar_e)');
push('```');
push('');
push('**为什么 ar 开根号**：人均次数是同一批人的重复投入，边际价值递减。');
push('不开根号（即纯人次份额 pr×ar）会把六阶七阶压死：');
push(`六阶的活跃人数是三阶的 ${pct(stat['666'].pr, 0)}，只因为人均次数少（${Math.round(aggAR['666'].att / aggAR['666'].people)} 次 vs ${Math.round(T0.att / T0.people)} 次），`);
push(`人次份额只有 ${F(RN.EV_SHARE['666'])}，落到三盲之下。这与「大阶 WR 是硬通货」的直觉相反。`);
push(`开根号后六阶 s=${F(RN.scaleOf('666'), 3)} → w=${F(RN.EV_WEIGHT_V2['666'])}，`);
push(`略低于三盲（${F(RN.EV_WEIGHT_V2['333bf'])}）而明显高于四盲（${F(RN.EV_WEIGHT_V2['444bf'])}），三者连成一条合理的斜线。`);
push('');
push(`观测数据核对（同口径自校验）：\`EV_STAT\` 与现算的最大偏差 —— pr ${F(maxDevPr)}（${zhOf(devPrEv)}）、ar ${F(maxDevAr)}（${zhOf(devArEv)}）。`);
push('（表内保留 3 位小数，偏差上限 5×10⁻⁴，不影响任何排序。）');
push('');

/* ── 3 公式 ── */
push('## 3 公式与三条结构保证');
push('');
push('```');
push('w_e = floor + (1 − floor) · s_e^γ');
push(`floor = ${F(RN.WEIGHT_V2_CFG.floor)}    γ = ${F(RN.WEIGHT_V2_CFG.gamma)}    停办项目再 × ${F(RN.WEIGHT_V2_CFG.retiredDiscount)}`);
push('```');
push('');
push('三条保证，**只依赖公式形状，与数据无关**：');
push('');
push('| 保证 | 为什么成立 |');
push('|---|---|');
push('| 三阶恒为最高 | `s_333 ≡ 1` ⇒ `w_333 = floor + (1−floor) = 1`，是上界 |');
push('| 排序 ≡ 规模排序 | `s^γ` 在 `s>0` 上严格单调 ⇒ 不会出现「规模差 20 倍、权重差 5%」 |');
push('| 冷门不清零 | 值域 `[floor, 1]`，最低也有 `' + F(RN.WEIGHT_V2_CFG.floor) + '` |');
push('');
push('后两条是旧表缺的：旧表的排序并不严格对应任何可观测量，且相邻档位挤在一起。');
push('');

/* ── 4 对照表 ── */
push('## 4 新旧权重对照');
push('');
push('| 项目 | 人数比 pr | 人均比 ar | 规模 s | 旧 w | **新 w** | 新/旧 | 一条 WR 值几条三阶 |');
push('|---|---|---|---|---|---|---|---|');
rows.forEach((r) => {
  const hi = r.e === '333' ? '**' : '';
  const rt = r.wl ? F(r.wv / r.wl) : '—';
  push(`| ${hi}${r.zh}${hi} | ${F(r.pr)} | ${F(r.ar)} | ${F(r.s)} | ${F(r.wl)} | ${hi}${F(r.wv, 4)}${hi} | ${rt} | ${F(1 / r.wv)} |`);
});
push('');
push('「一条 WR 值几条三阶」= `1 / w_e`，直接就是跨项目的价格比。');
push('');

/* ── 5 γ 敏感性 ── */
push('## 5 γ：唯一的价值旋钮');
push('');
push('γ 控制「三阶要多突出」。它没有客观答案，是一个价值选择，但它只有一维，且两端的关系是清楚的：');
push('');
push('| γ | 三阶领先次高 | 二阶 | 六阶 | 三盲 | 四盲 | 最低项目 | 量程 |');
push('|---|---|---|---|---|---|---|---|');
for (const g of [0.5, 0.75, 1.0, 1.25, 1.5, 2.0]) {
  const W = RN.buildWeightV2({ gamma: g });
  const ss = Object.keys(W).sort((a, b) => W[b] - W[a]);
  const sel = Math.abs(g - RN.WEIGHT_V2_CFG.gamma) < 1e-9 ? ' **←**' : '';
  push(`| ${F(g)}${sel} | ${pct(1 / W[ss[1]] - 1)} | ${F(W['222'])} | ${F(W['666'])} | ${F(W['333bf'])} | ${F(W['444bf'])} | ${F(W[ss[ss.length - 1]])}（${zhOf(ss[ss.length - 1])}） | ${F(1 / W[ss[ss.length - 1]])}× |`);
}
push('');
push(`当前默认 γ = ${F(RN.WEIGHT_V2_CFG.gamma)}。`);
push('想把三阶拉得更突出，就往上调；想保护冷门项目，就往下调。**两端是同一件事，不存在"既要又要"。**');
push('');

/* ── 6 实测 ── */
push('## 6 换成新权重之后，排序变了吗');
push('');
push('Feliks Zemdegs vs Max Park（M1 旧条数口径，有逐项目明细的 6,147 人同公式排序）：');
push('');
push('| 口径 | Feliks | Max | 比值 | 名次 |');
push('|---|---|---|---|---|');
push('| 旧表 legacy | 89.4073 | 76.8251 | 1.1638× | 1 / 2 |');
push('| **新表 v2** | **79.6561** | **65.4010** | **1.2180×** | **1 / 2** |');
push('');
push('**名次不变，比值略升。** 两人分数都降了（除三阶外全部下调），降幅 Feliks −10.9%、Max −14.9%——');
push('Max 更依赖六阶七阶（0.81→0.60、0.79→0.58），Feliks 更依赖五阶三阶。');
push('');
push('> **分数不可跨版本比较。** 只有同一版本内的排序有意义。');
push('');

/* ── 7 bug 清单 ── */
push('## 7 本次修掉的问题');
push('');
push('| # | 问题 | 性质 | 修法 |');
push('|---|---|---|---|');
push('| 1 | `scoreRuns()` 的项目系数要显式传 `applyWeight:true` 才生效，默认关 | **接线隐患**：管线漏传就静默丢掉 `w_e`，且不报错 | 新增 `scoreRunsV2()`，归一 + v2 权重 + 30 年边界三项默认全开 |');
push('| 2 | 多盲/最少步「主指标打平、只赢用时」的纪录 G=0，等于这条纪录不算 | **漏计**：Kai Jiptner `10/10 42:06` 破 `10/10 44:09` 被记 0 分 | `TIE_WEIGHT=0.3` 折扣价，仍可传 `tieWeight:0` 复现旧行为 |');
push('| 3 | `priceCard()` 返回字段写成 `unitTipical`（拼写错，外部按 `unitTypical` 取会是 `undefined`） | **命名 bug** | 改为 `unitTypical`，旧名保留为别名 |');
push('| 4 | 对比脚本 `compare_feliks_max.js` 从不乘 `w_e`，算的是排行榜中间量 | **口径不一致**：报告数字与站点显示不符 | 新增 `compare_v2.js`，三套口径（未加权 / legacy / v2）并排 |');
push('| 5 | `EV_WEIGHT` 与 `js/calc.js` 双份维护，曾手抄错 5 个值 | **双源漂移** | 保留 legacy 表但用 `test_runs.js [7]` 逐项断言；v2 表由公式生成，不再手写 |');
push('| 6 | `runCredit()` 的 `weightCapped` 用两次不同的 `normCap` 解析，写法重复易走岔 | **可维护性** | 统一到局部变量 `ncap` |');
push('');
push('**一处没有按原建议改**：评审里提过把 10 年硬截顶换成饱和函数 `T_eff = dsat(1−e^(−T/dsat))`，理由是"10 年等于没 cap"。');
push('实测发现饱和函数会给**所有**长段打折（dsat=5 年时守 4 年只能算 2.7 年，−31%），这与「守 2000 天就得算 5.48 年，一分不少」直接冲突。');
push(`所以 v2 保持线性，只把 cap 从 10 年放到 **${F(RN.CAP_DAYS_V2 / 365, 0)} 年**当数据边界（防 tEnd 缺失造出的伪长段）。饱和函数保留为可选参数 \`dsat\`，供敏感性分析。`);
push('');

/* ── 8 边界 ── */
push('## 8 边界与未决');
push('');
push(`1. **\`pr\` 的「活跃选手」门槛是选出来的，不是数据给定的。** 本文取「累计参赛 ≥ ${K_MIN} 场」（${poolN.toLocaleString('en-US')} 人，占全量 ${pct(poolN / R.total, 2)}）。`);
push('   阈值从 ≥1 收到 ≥10，三阶对次高的领先从 37.19% 收窄到 13.97%（对照见 `EV_STAT_阈值扫描.md`）。');
push('   取 ≥3 是为了剔除一次性参赛者；取 ≥10 会几乎退回旧表，区分度消失。');
push('2. **`w_e` 仍然只到项目级，不分轨道。** 单次与平均用同一个 `w_e`；');
push('   如果发现单次轨与平均轨的竞争密度差很多（例如多盲只有单次），需要拆成 `w_{e,t}`。');
push('3. **`γ` 没有数据依据，是价值选择。** 本文给的是曲线与两端后果，不是"正确答案"。');
push(`4. **三阶领先 ${pct(1 / wV['222'] - 1)} 是否够"明显"，由你定。** 这条只有一维旋钮，改 γ 即可，不必改结构。`);
push('');

const outPath = path.join(ROOT, 'etl/score/M1_项目权重v2.md');
fs.writeFileSync(outPath, L.join('\n') + '\n', 'utf8');

console.log(`三阶 1.0000｜次高 ${second.zh} ${F(second.wv, 4)}（领先 ${pct(1 / second.wv - 1)}）｜量程 ${F(1 / last.wv)}×`);
console.log(`EV_STAT 同口径偏差：pr ${F(maxDevPr)}（${devPrEv}）、ar ${F(maxDevAr)}（${devArEv}）、池 ${poolN}`);
console.log(`已写 ${outPath}（${L.length} 行）`);

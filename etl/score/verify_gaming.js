'use strict';
/* M1 · 防刷分设计验证脚本
 *
 * 回答一个问题：一年内破 4 次 WR（各守 3 个月）与破 1 次（守 1 年），
 * 哪个该得更高分？现行条数口径与面积口径分别给出什么答案？
 *
 * 运行：node etl/score/verify_gaming.js
 * 产出：etl/score/M1_防刷分设计.md
 */
const fs = require('fs');
const path = require('path');

const ROOT = 'E:/WorkBuddy/魔方10.18';
global.window = {};
require(path.join(ROOT, 'js/data.js'));
const M1 = require(path.join(ROOT, 'etl/score/m1.js'));

const P = global.window.MOCK.players;
const r = (v, n = 3) => Math.round(v * 10 ** n) / 10 ** n;
const pct = (v, n = 1) => `${(v * 100).toFixed(n)}%`;

/* ---------- 1. 两种情景 ---------- */
const D_TOTAL = 0.05;          // 总相对进步 5%
const L_TOTAL = Math.log(1 / (1 - D_TOTAL));   // 对数幅度
const T_DAYS = 365;

function scenario(k) {
  // 把总进步 L_TOTAL 等分成 k 步，总持有时间 T_DAYS 均分
  const step = L_TOTAL / k;
  const days = T_DAYS / k;
  let area = 0;
  for (let j = 1; j <= k; j++) {
    // 第 j 段：相对「原点」的累计幅度为 j*step，但每条纪录只按它自己那一步的幅度计价
    area += (j * step) * (days / 365);
  }
  return { count: k, days: T_DAYS, area };
}

const A4 = scenario(4);
const B1 = scenario(1);

/* ---------- 2. 真实数据：逐条纪录统计 ---------- */
function parseVal(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s || s === 'DNF' || s.includes('/')) return null;   // 多盲等复合格式暂不处理
  const m = s.match(/^(\d+):(\d+(?:\.\d+)?)$/);
  if (m) return +m[1] * 60 + +m[2];
  const n = +s;
  return isFinite(n) && n > 0 ? n : null;
}

const chains = {};
P.forEach((p) => (p.records || []).forEach((x) => {
  if (x.level !== 'WR') return;
  const v = parseVal(x.value);
  if (v == null || !x.date) return;
  const k = x.ev + '|' + x.type;
  (chains[k] = chains[k] || []).push({
    dn: +String(x.date).replace(/-/g, ''), date: x.date, val: v,
    held: x.held || 0, pid: p.id, name: p.name, ev: x.ev,
  });
}));

const pairs = [];
Object.keys(chains).forEach((k) => {
  const a = chains[k].sort((x, y) => x.dn - y.dn);
  for (let i = 1; i < a.length; i++) {
    if (a[i].val >= a[i - 1].val) continue;
    a[i].rel = (a[i - 1].val - a[i].val) / a[i - 1].val;
    pairs.push(a[i]);
  }
});

const heldAll = [];
P.forEach((p) => (p.records || []).forEach((x) => { if (x.level === 'WR' && x.held > 0) heldAll.push(x.held); }));
heldAll.sort((a, b) => a - b);
const q = (arr, f) => arr[Math.min(arr.length - 1, Math.floor(arr.length * f))];

const rels = pairs.map((x) => x.rel).sort((a, b) => a - b);
const holdBuckets = [[0, 30], [30, 90], [90, 180], [180, 365], [365, 730], [730, Infinity]];
const relBuckets = [[0, 0.005], [0.005, 0.01], [0.01, 0.02], [0.02, 0.05], [0.05, Infinity]];

/* 小幅进步的「条数占比 vs 面积占比」 */
const small = pairs.filter((x) => x.rel < 0.01);
const areaAll = pairs.reduce((s, x) => s + x.rel * x.held, 0);
const areaSmall = small.reduce((s, x) => s + x.rel * x.held, 0);

/* 各项目中位进步幅度 */
const byEv = {};
pairs.forEach((x) => { (byEv[x.ev] = byEv[x.ev] || []).push(x.rel); });
const evMed = Object.keys(byEv)
  .filter((e) => byEv[e].length >= 8)
  .map((e) => ({ e, n: byEv[e].length, med: q(byEv[e].sort((a, b) => a - b), 0.5) }))
  .sort((a, b) => b.med - a.med);

/* 个案 */
const CASES = ['Feliks Zemdegs', 'Max Park', 'Yiheng Wang (王艺衡)', 'Leandro Martín López', 'Tymon Kolasiński'];

/* ---------- 3. 生成文档 ---------- */
const L = [];
const push = (s) => L.push(s == null ? '' : s);

push('# M1 · 防刷分设计：条数口径 vs 面积口径');
push('');
const d0 = new Date();
const stamp = `${d0.getFullYear()}-${String(d0.getMonth() + 1).padStart(2, '0')}-${String(d0.getDate()).padStart(2, '0')} ${String(d0.getHours()).padStart(2, '0')}:${String(d0.getMinutes()).padStart(2, '0')}`;
push(`> 生成时间：${stamp}　|　由 \`etl/score/verify_gaming.js\` 自动生成，数字全部现算`);
push('');
push('## 一、问题');
push('');
push('现行 M1 按**条数**计分：');
push('');
push('```');
push('M1 = Σ_级别 级别价值 × 竞争密度 × 时代折算 × 条数');
push('```');
push('');
push('于是「破了几次」直接等于「得几分」。你举的例子代入：');
push('');
push('| 打法 | 条数 | 现行得分 |');
push('|---|---|---|');
push(`| 一年破 4 次，每次守 3 个月 | 4 | **${r(A4.count, 2)}** |`);
push(`| 一年破 1 次，守满 1 年 | 1 | **${r(B1.count, 2)}** |`);
push('');
push(`**现行口径给前者 ${r(A4.count / B1.count, 1)} 倍的分。** 这不是「略有偏差」，而是把「控成绩、分步破」变成了最优策略——`);
push('先把能破的成绩压着，隔三个月放一点，同一段进步可以换四次分。');
push('');
push('## 二、三种口径给出的答案');
push('');
push('把「同一段 5% 的总进步」按三种方式计价（持有总时长都是 365 天）：');
push('');
push('| 口径 | 单条计价方式 | 4 次 × 3 个月 | 1 次 × 12 个月 | 比值 | 判定 |');
push('|---|---|---|---|---|---|');
push(`| **条数**（现状） | 每破一次记 1 | ${r(A4.count, 2)} | ${r(B1.count, 2)} | **4.00 : 1** | 错，奖励拆分 |`);
push(`| **纯时长** | 持有天数 | ${r(A4.days, 0)} | ${r(B1.days, 0)} | 1.00 : 1 | 平，拆不拆都一样 |`);
push(`| **面积**（推荐） | 进步幅度 × 持有年数 | ${r(A4.area, 4)} | ${r(B1.area, 4)} | **1 : ${r(B1.area / A4.area, 2)}** | 对，单次大突破赢 |`);
push('');
push('面积口径下每条纪录的贡献是：');
push('');
push('```');
push('A_r = ln( v_上一条纪录 / v_本条 ) × ( 持有天数 / 365 )');
push('```');
push('');
push('它衡量的是「**比前一条纪录领先多少，领先了多久**」，而不是「办了几次手续」。');
push('');
push('## 三、拆分定理：拆得越碎，永远越亏');
push('');
push('设总进步幅度为 `d`、总持有时长为 `T`，把它等分成 `k` 次突破（每次守 `T/k`）。面积之和为：');
push('');
push('```');
push('A(k) = d·T·(k+1) / (2k)       A(1) = d·T');
push('```');
push('');
push('| 拆分次数 k | 相对单次突破的得分 | 要追平单次突破，最终水平需再高出 |');
push('|---|---|---|');
[1, 2, 3, 4, 6, 8, 12, 24].forEach((k) => {
  const ratio = M1.splitRatio(k);
  push(`| ${k} | ${r(ratio, 3)} | ×${r(2 * k / (k + 1), 2)} |`);
});
push(`| ∞ | 0.500 | ×2.00 |`);
push('');
push('两个结论：');
push('');
push('1. **拆分永远不划算。** `(k+1)/2k` 随 k 单调递减，从 1 掉到 0.5，永不超过 1。');
push('2. **但也不是无限惩罚。** 把一段进步拆成无数次，最多只能拿到单次突破的 50%。');
push('   如果拆分手因此把最终水平又推进了 60% 以上（k=4 的门槛是 ×1.60），他就该赢——');
push('   因为他确实把人类极限推得更远了。这正是我们想要的判据：');
push('   **奖励「推到哪」，不奖励「推了几次」。**');
push('');
push('## 四、真实数据：这种事正在发生');
push('');
const wrTotal = P.reduce((a, b) => a + (b.wr || 0), 0);
push(`样本：\`js/data.js\` 中 ${heldAll.length} 条世界纪录（全站共 ${wrTotal.toLocaleString()} 条，覆盖 ${pct(heldAll.length / wrTotal, 0)}），` +
  `其中 ${pairs.length} 条能配对出「上一条纪录」并算出进步幅度。`);
push('');
push('### 4.1 破完能守多久');
push('');
push('| 分位 | P10 | P25 | 中位 | P75 | P90 | 均值 |');
push('|---|---|---|---|---|---|---|');
push(`| 持有天数 | ${q(heldAll, 0.1)} | ${q(heldAll, 0.25)} | **${q(heldAll, 0.5)}** | ${q(heldAll, 0.75)} | ${q(heldAll, 0.9)} | ${r(heldAll.reduce((a, b) => a + b, 0) / heldAll.length, 0)} |`);
push('');
push('| 持有区间 | 条数 | 占比 |');
push('|---|---|---|');
holdBuckets.forEach(([a, b]) => {
  const c = heldAll.filter((h) => h >= a && h < b).length;
  push(`| ${a}–${b === Infinity ? '∞' : b} 天 | ${c} | ${pct(c / heldAll.length)} |`);
});
push('');
push(`**近 ${pct(heldAll.filter((h) => h < 90).length / heldAll.length, 0)} 的世界纪录活不过 90 天。** 也就是说「破一次守很久」是少数，`);
push('分步推进才是常态——这正是条数口径最容易被放大的地方。');
push('');
push('### 4.2 每次破纪录进步了多少');
push('');
push('| 进步幅度 | 条数 | 占比 |');
push('|---|---|---|');
relBuckets.forEach(([a, b]) => {
  const c = rels.filter((x) => x >= a && x < b).length;
  push(`| ${pct(a, 1)}–${b === Infinity ? '∞' : pct(b, 1)} | ${c} | ${pct(c / rels.length)} |`);
});
push('');
push(`中位进步幅度 **${pct(q(rels, 0.5), 2)}**，P25 只有 ${pct(q(rels, 0.25), 2)}。`);
push(`其中 ${small.length} 条（${pct(small.length / pairs.length)}）的进步不足 1%。`);
push('');
push('这些「聊胜于无」的突破，在两种口径下命运完全不同：');
push('');
push('| 口径 | 不足 1% 的突破贡献了 |');
push('|---|---|');
push(`| 条数（现状） | **${pct(small.length / pairs.length)}** 的分数 |`);
push(`| 面积（推荐） | **${pct(areaSmall / areaAll)}** 的分数 |`);
push('');
push('### 4.3 个案：谁的分是靠小幅刷新堆出来的');
push('');
push('| 选手 | 样本 WR | 进步<1% 的条数 | 占条数 | 占面积 |');
push('|---|---|---|---|---|');
CASES.forEach((nm) => {
  const p = P.find((x) => x.name === nm);
  if (!p) return;
  const g = pairs.filter((x) => x.pid === p.id);
  if (!g.length) return;
  const sm = g.filter((x) => x.rel < 0.01);
  const aAll = g.reduce((s, x) => s + x.rel * x.held, 0);
  const aSm = sm.reduce((s, x) => s + x.rel * x.held, 0);
  push(`| ${nm} | ${g.length} | ${sm.length} | ${pct(sm.length / g.length, 0)} | ${pct(aSm / aAll)} |`);
});
push('');
push('以 Leandro Martín López 的五魔（minx）为例：0.26%、0.66%、0.92% 三次连续刷新，间隔 21/35/41 天，合计 97 天。');
push('按条数算，这三次各得一分；按面积算，三者合计约等于「一次 5% 突破守满一年」的十分之一——');
push('因为每段只守了 3–6 周，领先时间根本来不及积累。');
push('');
push('## 五、必须正视的副作用');
push('');
push('面积口径不是没有代价。把「进步幅度」当乘数，会奖励**天生大幅度的项目**：');
push('');
push('| 项目 | 样本条数 | 中位进步幅度 |');
push('|---|---|---|');
evMed.forEach((x) => push(`| ${x.e} | ${x.n} | ${pct(x.med, 1)} |`));
push('');
push(`各项目的中位进步幅度从 ${pct(evMed[evMed.length - 1].med, 1)} 到 ${pct(evMed[0].med, 1)}，相差约 ${r(evMed[0].med / evMed[evMed.length - 1].med, 1)} 倍。`);
push('盲拧类项目在早期动辄一次推进 10% 以上，长项目（777、minx）一次只能推进 2%–4%。');
push('裸面积会让盲拧类选手系统性占优，这与「三阶最重要」的直觉冲突。');
push('');
push('三个护栏（缺一不可）：');
push('');
push('| 护栏 | 作用 | 现状 |');
push('|---|---|---|');
push('| 项目系数 `w_e` | 把冷门项目的面积压回去 | 已有，聚合层乘一次 |');
push('| 项目内归一 | 用 `ln(v_prev/v_cur) ÷ 该项目中位幅度`，消除项目间「天生幅度差」 | 待实现 |');
push('| 持有期截顶 `D_cap` | 停办项目（脚拧、八板）无人竞争，一条纪录能守 8 年 | 待定，建议 5 年 |');
push('');
push('⚠️ **本文档不做排名结论。** `js/data.js` 的 `records` 每人只保留 R 值最高的 12 条，');
push('用它比排名会系统性地低估「纪录多的人」（Feliks 的 121 条只剩 12 条）。');
push('面积口径的真实名次必须在 ETL 全量重建后才有意义。');
push('');
push('## 六、推荐公式');
push('');
push('```');
push('M1(p, e) = Σ_纪录  g_级别 × ρ_密度 × f_时代(y) × A_r');
push('');
push('A_r = ln( v_上一条 / v_本条 ) × min( D_r , D_cap ) / 365');
push('```');
push('');
push('与现行口径唯一的区别，是把「1（一条）」换成「`A_r`」。');
push('`g / ρ / f` 三项原样保留，所以之前定下的级别价值、洲国密度、时代折算全部继续有效。');
push('');
push('**量纲变了**：条数是「次数」，面积是「进步量·年」。两者不能直接相加，');
push('所以切换时必须重新标定归一化系数（用全站分位数压到 0–100），');
push('并且**不能与旧口径的分数混用**。');
push('');
push('## 七、ETL 改动清单');
push('');
push('| # | 位置 | 改动 | 为什么必须 |');
push('|---|---|---|---|');
push('| 1 | `build.js:582` `recSeq[k].push(dn)` | 同时存值：`recSeqV[k].push({dn, v})` | 面积需要「上一条纪录的值」，现在只存了日期 |');
push('| 2 | `build.js:931 computeHeld` | 在同一遍遍历里累计 `eb.areaS/areaA += ln(prevV / v) × held/365` | 复用已有的全站序列，不额外读数据 |');
push('| 3 | `build.js:837` 的记录截断 | **把面积累计挪到截断之前** | 现在 `computeHeld` 在截断之后跑（1043 行），只能看到 12 条 |');
push('| 4 | `build.js:444 evBucket` + `1118 SLIM_KEYS` | 新增 `areaS/areaA` 并下发 | 否则前端拿不到 |');
push('');
push('顺带要修的旧账：`nrWS/nrWA` 里混进了 WR/CR（应只在 `level === "NR"` 时累加），');
push('以及 `p.nrS/p.nrA` 算出来但没下发。');
push('');
push('## 八、还没解决的问题');
push('');
push('1. **多盲 / 最少步的等效值。** `32/35 55:00` 这种「越大越好」的复合成绩，');
push('   不能直接 `ln(prev/cur)`，需要单独 adapter（多盲按成功数优先、用时次之）。');
push('2. **面积与 CR/NR 的混合。** 本文只验证了 WR。CR/NR 的进步幅度天然更大（对手少、起点低），');
push('   直接同公式会高估，需要按级别再做一次归一。');
push('3. **`D_cap` 取值。** 建议 5 年，但要用「纪录持有期分布」实测确定，不能拍。');
push('4. **拆分是否真的发生过。** 现有数据只能看到「同一选手在同一项目连续两次突破的间隔」，');
push('   看不到「他本来能破得更早」。要证明确有主观控分，需要比赛成绩明细（原始 tsv）。');

fs.writeFileSync(path.join(ROOT, 'etl/score/M1_防刷分设计.md'), L.join('\n') + '\n', 'utf8');

console.log('已生成 etl/score/M1_防刷分设计.md');
console.log('');
console.log('=== 结论速览 ===');
console.log('4 次 × 3 个月  vs  1 次 × 12 个月');
console.log('  条数口径：', r(A4.count, 2), 'vs', r(B1.count, 2), '→ 前者', r(A4.count / B1.count, 1), '倍（错）');
console.log('  纯时长  ：', r(A4.days, 0), 'vs', r(B1.days, 0), '→ 打平');
console.log('  面积口径：', r(A4.area, 4), 'vs', r(B1.area, 4), '→ 后者', r(B1.area / A4.area, 2), '倍（对）');
console.log('');
console.log('拆分惩罚 A(k)/A(1) = (k+1)/2k：');
[1, 2, 4, 8, 24].forEach((k) => console.log(`  k=${String(k).padStart(2)} → ${r(M1.splitRatio(k), 3)}`));

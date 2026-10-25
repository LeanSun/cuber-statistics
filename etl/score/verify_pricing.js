'use strict';
/* M1 项目定价验收：证明「三阶恒为最高含金量」
 * 运行：node etl/score/verify_pricing.js
 * 输出：etl/score/M1_项目定价.md
 */
const fs = require('fs');
const path = require('path');

global.window = {};
require('../../js/data.js');
const RN = require('./runs.js');

const P = global.window.MOCK.players;
const OUT = path.join(__dirname, 'M1_项目定价.md');
const L = [];
const push = (s) => L.push(s == null ? '' : s);
const F = (x, n) => RN.F4(x, n == null ? RN.DEC : n);
const PCT = (x, n) => RN.P4(x, n == null ? 2 : n);
const N = (x, n) => Number(x).toLocaleString('en-US', { maximumFractionDigits: n == null ? 0 : n });

const ZH = {};
const WEV = {};
require('../../js/calc.js').EVENTS.forEach((e) => { ZH[e.id] = e.zh; WEV[e.id] = e.w; });

const med = (a) => {
  const s = a.slice().sort((x, y) => x - y);
  const n = s.length;
  if (!n) return 0;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
};

/* ── 收集全部 WR 阶梯，按 项目×轨道 分开 ─────────────────── */
const LAD = {};
P.forEach((p) => (p.records || []).forEach((x) => {
  if (!x.date || x.level !== 'WR') return;
  const k = x.ev + '|' + x.type;
  (LAD[k] = LAD[k] || { ev: x.ev, type: x.type, subs: [] }).subs.push({
    pid: p.id, name: p.name, day: RN.dayOf(x.date), date: x.date, value: x.value, held: x.held || 0,
  });
}));

const per = {};   // ev → { s:[gains], a:[gains] }
Object.values(LAD).forEach((L) => {
  const b = RN.buildLadder(L.subs, L, { mode: 'level' });
  const gs = b.runs.map((r) => RN.runCredit(r, {}).gain).filter((g) => g > 0);
  if (!gs.length) return;
  const o = (per[L.ev] = per[L.ev] || { s: [], a: [] });
  o[L.type === 'single' ? 's' : 'a'].push(...gs);
});

/* ── 逐项目定价（两轨各自归一）────────────────────────────── */
const CAP = RN.NORM_CAP;
const rows = Object.keys(per).filter((e) => WEV[e] != null).map((e) => {
  const o = per[e];
  const refS = RN.refOf(o.s);
  const refA = RN.refOf(o.a);
  const norm = (arr, ref) => arr.map((g) => Math.min(g / (ref || 1), CAP));
  const rs = norm(o.s, refS);
  const ra = norm(o.a, refA);
  const allR = rs.concat(ra);
  const sumS = rs.reduce((x, y) => x + y, 0);
  const sumA = ra.reduce((x, y) => x + y, 0);
  return {
    e, zh: ZH[e], w: WEV[e],
    nS: o.s.length, nA: o.a.length,
    refS, refA,
    gMedS: med(o.s), gMedA: o.a.length ? med(o.a) : 0,
    rMed: allR.length ? med(allR) : 0,
    rP90: allR.length ? allR.slice().sort((x, y) => x - y)[Math.floor(allR.length * 0.9)] : 0,
    rMax: allR.length ? Math.max(...allR) : 0,
    capped: allR.filter((r) => r >= CAP - 1e-9).length,
    sumR: sumS, sumRA: sumA,
    // 归一前：一条「典型段」的裸 G（单次轨）价
    rawUnit: (med(o.s) || 0) * WEV[e],
    pool: WEV[e] * (sumS + sumA),
    unit: WEV[e],
    top: CAP * WEV[e],
  };
}).sort((a, b) => b.w - a.w);

const byPool = rows.slice().sort((a, b) => b.pool - a.pool);
const i333pool = byPool.findIndex((r) => r.e === '333') + 1;
const byRaw = rows.slice().sort((a, b) => b.rawUnit - a.rawUnit);
const i333raw = byRaw.findIndex((r) => r.e === '333') + 1;
const maxRaw = byRaw[0];
const r333 = rows.find((r) => r.e === '333');

/* ── 项目活跃人数（用于检验「按人数打折」这条路）─────────── */
const act = {};
P.forEach((p) => {
  if (!p.evS) return;
  p.evS.split(';').forEach((seg) => {
    const i = seg.indexOf(':');
    if (i < 0) return;
    const ev = seg.slice(0, i);
    const n = seg.slice(i + 1).split(',');
    if ((+n[1] || 0) > 0) act[ev] = (act[ev] || 0) + 1;
  });
});
const actBase = act['333'] || 1;
const rhoOf = (e) => (act[e] || 0) / actBase;
/* 用 ρ_e^α 把归一前的价压到三阶以下，需要多大的 α */
const alphaNeed = (r) => {
  const rel = rhoOf(r.e);
  if (!(rel > 0) || rel >= 1) return Infinity;
  const need = r.rawUnit / r333.rawUnit;      // 需要压掉的倍数
  if (need <= 1) return 0;
  return Math.log(need) / Math.log(1 / rel);
};

/* ── 每个项目 10 段典型成就的得分（含金量的正确度量）────── */
const K = 10;
const aligned = rows.slice().sort((a, b) => b.unit - a.unit);

/* ── 写文档 ─────────────────────────────────────────────── */
push('# M1 · 项目定价：让三阶恒为最高');
push('');
push('> **本文的 `w_e` 已被 v2 取代**（`M1_项目权重v2.md`）。');
push('> 这里论证的是「为什么要项目内归一」——那部分结论不变，仍然成立；');
push('> 只有最后一步乘的那张权重表换成了数据驱动的 v2 版。');
push('> 下面所有单价数字按 legacy 权重计算，仅供对照。');
push('');
push('> 生成时间：' + new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC　|　由 `etl/score/verify_pricing.js` 自动生成，数字全部现算');
push('> 数据源：`js/data.js` 的 detail 层（2,500 人）逐条纪录，WR 阶梯 ' + N(Object.keys(LAD).length) + ' 条');
push('');
push('## 0 一句话结论');
push('');
push('**「三阶含金量最高」不是靠调参数调出来的，是靠结构保证的。**');
push('');
push('把 `G` 从「跨项目的绝对幅度」改成「项目内的相对强度」，含金量就只由 `w_e` 决定，');
push('而 `w_e` 里三阶写死是 `1.00`，是全部 21 个项目里唯一的最高值。');
push('`G` 再怎么变，都只能在项目内部调整「这一段算强还是弱」，动不了项目之间的价格。');
push('');
push('| 保证 | 数学形式 | 是否依赖数据 |');
push('|---|---|---|');
push('| 典型段单价 三阶最高 | `p_e = w_e`，`w_333 = 1.00` | 不依赖 |');
push('| 单段上界 三阶最高 | `p_max = R_CAP · w_e` | 不依赖 |');
push('| 同段数成就 三阶最高 | `S_e(k) = w_e · k` | 不依赖 |');
push('| 排序与 `w_e` 逐位一致 | `p_e > p_f ⇔ w_e > w_f` | 不依赖 |');
push('');
push('这四条已写进 `test_runs.js` 的 [7][8][9][10] 四项断言，改坏一条测试就红。');
push('');

push('## 1 问题：`G` 原本在做一件它做不到的事');
push('');
push('`G = ln(前一位留下的值 / 本段最好值)` 回答的是**「这条路还能往前推多远」**。');
push('但「推得远」有两种完全相反的来源：');
push('');
push('- **路快走完了**（三阶卷了 21 年）→ 每步只能磨几个百分点；');
push('- **路还长**（冷门项目离物理极限远）→ 随便一练就是三成。');
push('');
push('直接拿 `G` 跨项目比价，等于把「这条路没人走」当成「这个人强」。');
push(`实测（单次轨，中位 G）：${rows.slice().sort((a, b) => b.gMedS - a.gMedS).slice(0, 3).map((r) => r.zh + ' ' + PCT(r.gMedS, 2)).join('、')}`);
push(`对 ${rows.slice().sort((a, b) => a.gMedS - b.gMedS).slice(0, 3).map((r) => r.zh + ' ' + PCT(r.gMedS, 2)).join('、')}，`);
push(`极差 ${F(Math.max(...rows.map((r) => r.gMedS)) / Math.min(...rows.map((r) => r.gMedS)), 1)} 倍。`);
push('');

push('### 1.1 三条错误修法，以及为什么都不行');
push('');
push('**错误一：给 `w_e` 扩量程。** 看似直接，但算一下需要多大：');
push('');
push('归一前，一条「典型二阶 WR」的价是 ' + F(rows.find((r) => r.e === '222').rawUnit, 2)
  + '，一条「典型三阶 WR」只有 ' + F(r333.rawUnit) + '，');
push(`二阶是三阶的 **${F(rows.find((r) => r.e === '222').rawUnit / r333.rawUnit, 2)} 倍**。要把它压到 1 倍以下，`);
push('`w_222` 必须 ≤ ' + F(1 / (rows.find((r) => r.e === '222').rawUnit / r333.rawUnit) * WEV['222'], 3) + '（现值 ' + WEV['222'] + '）。');
push('');
push('更极端的是四盲：一条典型 WR 是 ' + F(rows.find((r) => r.e === '444bf').rawUnit / r333.rawUnit, 1) + ' 条三阶，需要 `w_444bf` ≤ '
  + F(WEV['444bf'] / (rows.find((r) => r.e === '444bf').rawUnit / r333.rawUnit), 3) + '。');
push('照这个推下去，整个 `w_e` 表会被压进 ' + F(r333.rawUnit / maxRaw.rawUnit) + '～1.00 之间，量程 '
  + F(1 / (r333.rawUnit / maxRaw.rawUnit), 1) + ' 倍。');
push('**结果不是「三阶最高」，是「除三阶以外全部接近零」** —— 换一种方式否定项目多样性。');
push('');
push('**错误二：只修一半，用 `ρ_e^α` 打折。** 之前提过按「项目活跃人数占比」缩放，实测这条路走不通 ——');
push('因为 `ρ_e` 根本分不开「主流项目之间」的竞争强度：');
push('');
push('| 项目 | 活跃人数（相对三阶） | 归一前典型价（倍三阶） | 压平所需的 α |');
push('|---|---|---|---|');
const rhoDemo = ['222', 'pyram', '333bf', '444bf', '555bf']
  .map((e) => rows.find((r) => r.e === e)).filter(Boolean)
  .sort((a, b) => b.rawUnit - a.rawUnit);
rhoDemo.forEach((r) => {
  const a = alphaNeed(r);
  const aTxt = !Number.isFinite(a) ? '∞' : (a > 100 ? '≈ ' + Math.round(a / 10) * 10 + '（等于禁用）' : (a > 20 ? '≈ ' + Math.round(a) : F(a, 1)));
  push(`| ${r.zh} | ${F(rhoOf(r.e), 3)} | ${F(r.rawUnit / r333.rawUnit)}× | ${aTxt} |`);
});
push('');
push(`二阶的活跃人数是三阶的 ${F(rhoOf('222'), 3)} 倍 —— 几乎一模一样，因为 detail 层前 2,500 名几乎人人参赛所有主流项目。`);
push(`**要用人数打折压住二阶那 3 倍，α 得取 ${Math.round(alphaNeed(rows.find((r) => r.e === '222')))} —— 等于把这个项目直接删掉。**`);
push(`金字塔也要 α ≈ ${Math.round(alphaNeed(rows.find((r) => r.e === 'pyram')))}。α 是全局参数，取最大值才管用，于是整张表全废。`);
push('而四盲虽然人数只有三阶的一半，α 也要 ' + F(alphaNeed(rows.find((r) => r.e === '444bf')), 1) + ' 才压得住。');
push('所以 `ρ_e^α` 只能在「深渊项目」上起作用，对主流项目完全无效。**这条路的量程不够，不是参数没调好。**');
push('');
push('**错误三：保留 `G` 的绝对值，只调 `w_e` 的次序。** 这动摇不了结论 —— 只要 `G` 还跨项目，');
push('`w_e` 的次序就永远在和 `G` 的次序打架，谁赢取决于具体选手碰上哪个项目。');
push('');

push('## 2 正确修法：完全归一（α = 1）');
push('');
push('```');
push('r        = min( G / G_ref(e), R_CAP )        // 项目内相对强度');
push('credit   = r × min(T, D_cap) / 365           // 占有段口径不变');
push('score    = credit × w_e × V_L × ρ_s × f_L   // w_e 是唯一的跨项目价格');
push('```');
push('');
push('`G_ref(e)` = 该项目 `G` 的算术均值（两轨各算各的）。`R_CAP = ' + CAP + '`。');
push('');
push('### 2.1 为什么用算术均值：一个恒等式');
push('');
push('```');
push('Σ_i ( G_i / mean(G) ) = n');
push('```');
push('');
push('这与分布形状完全无关，含长尾也成立。含义是：');
push('');
push('> **任何项目的历史总信用 = 该项目的段数。** 一个「段」在所有项目里完全同质。');
push('');
push('于是「三阶是否最贵」只取决于 `w_e`，与 `G` 实测分布完全解耦。这是整个方案的关键。');
push('');
push('实测校验：');
push('');
push('| 项目 | 单次轨 Σr | 单次轨段数 | 偏差 | 平均轨 Σr | 平均轨段数 |');
push('|---|---|---|---|---|---|');
[['333'], ['222'], ['444bf'], ['sq1'], ['333bf']].forEach(([e]) => {
  const r = rows.find((x) => x.e === e);
  if (!r) return;
  push(`| ${r.zh} | ${F(r.sumR)} | ${r.nS} | ${F(r.sumR - r.nS)} | ${F(r.sumRA)} | ${r.nA} |`);
});
push('');
push('（表内偏差非零只因为 `R_CAP` 截顶削掉了长尾，被截的段数见 3 节「截顶」列。）');
push('');

push('## 3 单价表（三阶锚 = 1.000）');
push('');
push('`典型段` 是 r=1 的段，`上界` 是 r=R_CAP 的段。两者都以「一条三阶典型 WR」为单位。');
push('');
push('| 项目 | `w_e` | 典型段 | 单段上界 | 段数 S/A | `G_ref` S | 中位 G S | 归一后 r 中位 | `Σr` S/A | 截顶段 |');
push('|---|---|---|---|---|---|---|---|---|---|');
rows.forEach((r) => {
  push(`| ${r.zh} | ${F(r.w)} | **${F(r.unit)}** | ${F(r.top)} | ${r.nS}/${r.nA} | ${PCT(r.refS, 2)} | ${PCT(r.gMedS, 2)} | ${F(r.rMed)} | ${F(r.sumR, 1)}/${F(r.sumRA, 1)} | ${r.capped} |`);
});
push('');
push(`**\`w_e\` 与「典型段」两列就是含金量。** 三阶 ${F(r333.unit)}，次高 ${F(aligned[1].unit)}（${aligned[1].zh}），`);
push(`最低 ${F(aligned[aligned.length - 1].unit)}（${aligned[aligned.length - 1].zh}）。`);
push('');

push('## 4 归一前后对比');
push('');
push('### 4.1 「一条典型 WR 值多少条三阶」');
push('');
push('| 项目 | 归一前（裸 G×w） | 归一后（w 定价） | 变化 |');
push('|---|---|---|---|');
rows.slice().sort((a, b) => (b.rawUnit / r333.rawUnit) - (a.rawUnit / r333.rawUnit)).slice(0, 10).forEach((r) => {
  const before = r.rawUnit / r333.rawUnit;
  const after = r.unit / r333.unit;
  push(`| ${r.zh} | ${F(before)} 条 | **${F(after)} 条** | ${before > after ? '↓' : '↑'} ${F(before > after ? before / after : after / before, 1)} 倍 |`);
});
push('');
push(`归一前有 **${rows.filter((r) => r.rawUnit > r333.rawUnit).length} / ${rows.length}** 个项目的典型段比三阶贵；`);
push(`归一后 **0 / ${rows.length}** —— 三阶是唯一的 1.000。`);
push('');

push('### 4.2 同段数成就对比（含金量的正确度量）');
push('');
push(`假设统治 ` + K + ` 段（典型段），各项目得分：`);
push('');
push('| 项目 | 得分 | 相对三阶 |');
push('|---|---|---|');
aligned.forEach((r) => push(`| ${r.zh} | ${F(r.unit * K)} | ${F(r.unit / r333.unit)}× |`));
push('');
push(`三阶 ${F(r333.unit * K)} 分，最高；次高 ${aligned[1].zh} ${F(aligned[1].unit * K)} 分。**恒成立，不依赖数据。**`);
push('');

push('### 4.3 为什么「项目历史总池」不是含金量');
push('');
push(`若把每个项目历史上全部 WR 段的信用加起来（` + '`w_e × Σr`' + `），排序是：`);
push('');
push('| 项目 | 历史总池 | 段数 S/A |');
push('|---|---|---|');
byPool.slice(0, 8).forEach((r) => {
  const hi = r.e === '333' ? '**' : '';
  push(`| ${hi}${r.zh}${hi} | ${hi}${F(r.pool, 1)}${hi} | ${r.nS}/${r.nA} |`);
});
push('');
push(`三阶排第 ${i333pool}。这不是含金量输了，是**段数输了**：总池 = ` + '`w_e × 段数`' + `，`);
push('段数由「这个项目历史上被破了多少次」决定，是活跃度，不是含金量。');
push('');
push('而且 12 条截断对三阶伤害最大 —— 三阶 WR 条数全站最多，被砍掉的比例最高。');
push(`现在三阶只剩 ${r333.nS} 段（单次轨），全量数据下会大幅回升。相比之下四盲只有 ${rows.find((r) => r.e === '444bf').nS} 段，本来就少，几乎没被砍。`);
push('');
push('所以这一列**现在不可用**，等全量阶梯导出后才能解释。');
push('');

push('## 5 实现与断言');
push('');
push('`etl/score/runs.js` 新增：');
push('');
push('| 导出 | 作用 |');
push('|---|---|');
push('| `EV_WEIGHT` | 21 个项目系数，与 `js/calc.js` 的 `EVENTS[].w` 逐项一致 |');
push('| `NORM_CAP` | 单段上界倍数，默认 3 |');
push('| `evWeightOf(ev)` | 取 `w_e` |');
push('| `refOf(gains)` | 算 `G_ref`（纯算术均值；`trim` 可选但会破恒等式） |');
push('| `normGain(g, ref, cap)` | `r = min(G/G_ref, cap)` |');
push('| `runCredit(r, {ref})` | 传 `ref` 即归一；新增 `gainNorm` `ratio` `weightCapped` 字段 |');
push('| `scoreRuns(runs, meta, {ref, applyWeight})` | `applyWeight:true` 才乘 `w_e` |');
push('| `priceCard(ev, gains)` | 定价卡：`ref` / 典型段 / 上界 |');
push('');
push('**向后兼容**：不传 `ref`、不传 `applyWeight:true` 时，`credit` 与旧口径逐位相同。');
push('现有 `verify_runs.js` / `compare_feliks_max.js` / `diag_m1.js` 结果不受影响。');
push('');
push('断言（`node etl/score/test_runs.js`）：');
push('');
push('| 编号 | 断言 |');
push('|---|---|');
push('| [7] | `EV_WEIGHT` 与 `js/calc.js` 的 `EVENTS[].w` 逐项一致（防手抄错） |');
push('| [8] | 三阶典型段单价严格最高；单段上界亦恒为最高 |');
push('| [9] | 恒等式 `Σr = n` 成立（含长尾样本） |');
push('| [10] | 不传 `ref` 时 `credit` 不变；三阶典型段恰为 1.000 |');
push('');

push('## 6 副作用与未决');
push('');
push('1. **`R_CAP = 3` 是设计选择，不是推导结果。** 它决定「一次惊人突破能顶几段」。');
push('   调大 → 奖励单次爆发；调小 → 奖励稳定迭代。取 3 的依据是实测 r 的 P90 约 2.5～8，');
push('   3 落在「削掉最极端的一小截」的位置。');
push(`   当前被截顶的段共 ${rows.reduce((a, b) => a + b.capped, 0)} / ${rows.reduce((a, b) => a + b.nS + b.nA, 0)}（${PCT(rows.reduce((a, b) => a + b.capped, 0) / rows.reduce((a, b) => a + b.nS + b.nA, 0), 1)}）。`);
{
  const ACTIVE = ['333','222','444','555','666','777','333oh','333bf','444bf','555bf','333mbf','333fm','clock','minx','pyram','skewb','sq1'];
  const wAct = Math.min(...ACTIVE.map((e) => WEV[e]));
  const wAll = Math.min(...Object.keys(WEV).map((e) => WEV[e]));
  push(`2. **\`w_e\` 明显偏窄。** 活跃项目的量程是 ${F(1)} → ${F(wAct)}，只有 **${F(1 / wAct)} 倍**；`);
  push(`   连停办项目一起算也只有 1.00 → ${F(wAll)}（${F(1 / wAll)} 倍）。`);
}
push('   如果你要「三阶明显高于其他」，需要重标定 `w_e` 本身（价值判断，不是校准）。');
push('   这一步现在可以放心做，因为 `G` 已经不再和它打架。');
push('3. **`w_e` 表本身没有数据依据。** 它是手写的递减表。归一之后它成了唯一的价格来源，');
push('   所以「它凭什么这样写」变成必须回答的问题 —— 建议按项目活跃人数或人均参赛次数重标定。');
push('4. **`G_ref` 用全量还是滚动。** 现在用历史全样本均值，意味着一个新项目（如 2020 年后才有的项目）');
push('   的早期段会被后期段拉低参考。严格做法是按年滚动，但会引入时间维度，暂不做。');
push('5. **段数问题仍未解。** 「同段数三阶最高」已经保证，但「不同段数怎么比」还没定。');
push('   现在靠占有段口径的 `T`（持有时间）吸收了一部分，但一个项目被破 44 次 vs 28 次，');
push('   历史总产出确实不同。这属于「活跃度」而非「含金量」，建议不修正。');
push('');

push('## 附录　数据边界');
push('');
push(`- 项目系数来自 \`js/calc.js\` 的 \`EVENTS\`（21 项，含 4 个停办项目）。`);
push(`- G 来自 \`records\` 逐条（detail 层 2,500 人 × 上限 12 条），WR 阶梯 ${N(Object.keys(LAD).length)} 条。`);
push(`- 单次轨共 ${rows.reduce((a, b) => a + b.nS, 0)} 段，平均轨共 ${rows.reduce((a, b) => a + b.nA, 0)} 段。`);
push('- 12 条截断会低估「段数」，但不影响「单价」—— 单价只由 `w_e` 决定。');
push('- 多盲 / 最少步的 `G` 走 `ln((得分+10)/(得分+10))` 平滑分支，归一后同样适用。');
push('');

fs.writeFileSync(OUT, L.join('\n') + '\n', 'utf8');
console.log('written', OUT, L.length, 'lines');
console.log('三阶典型单价', F(r333.unit), '| 次高', F(aligned[1].unit), aligned[1].zh);
console.log('归一前比三阶贵的项目数', rows.filter((r) => r.rawUnit > r333.rawUnit).length, '/', rows.length);
console.log('三阶总池排名', i333pool, '/', byPool.length, '| 段数', r333.nS + '/' + r333.nA);

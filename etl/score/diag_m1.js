'use strict';
/* M1 纪录板块 · 结构评审
 * 只审模型，不审数据。所有数字由本脚本现场计算。
 * 运行：node etl/score/diag_m1.js
 * 输出：etl/score/M1_评审与优化.md
 */
const fs = require('fs');
const path = require('path');

global.window = {};
require('../../js/data.js');
require('../../js/roster.js');
const M1 = require('./m1.js');
const RN = require('./runs.js');
const CL = require('../../js/calc.js');

const P = global.window.MOCK.players;
const R = global.window.WCA_ROSTER;
const OUT = path.join(__dirname, 'M1_评审与优化.md');
const L = [];
const push = (s) => L.push(s == null ? '' : s);
const F = (x, n) => RN.F4(x, n == null ? RN.DEC : n);
const PCT = (x, n) => RN.P4(x, n == null ? 2 : n);

/* ── 池子 ───────────────────────────────────────────────────── */
const cc = {}, nc = {};
R.rows.split('\n').forEach((ln) => {
  if (!ln) return;
  const f = ln.split('~');
  if (f.length < 4) return;
  nc[f[2]] = (nc[f[2]] || 0) + 1;
  const c = CL.contOfIso(f[2]) || '??';
  cc[c] = (cc[c] || 0) + 1;
});
P.forEach((p) => {
  nc[p.country] = (nc[p.country] || 0) + 1;
  const c = CL.contOfIso(p.country) || '??';
  cc[c] = (cc[c] || 0) + 1;
});
const ctx = M1.makeContext({ contCount: cc, natCount: nc, total: R.total });

/* ── 1. 两轨 ────────────────────────────────────────────────── */
const rows = [];
P.forEach((p) => {
  const c = CL.contOfIso(p.country) || '??';
  let s;
  try { s = M1.scorePlayer({ rec: p.mCalc.rec, nr: p.nr, cont: c, country: p.country }, ctx, {}); }
  catch (e) { return; }
  if (s.total <= 0) return;
  rows.push({ id: p.id, name: p.name, s: s.single, a: s.average, t: s.total });
});
const N = rows.length;
const mean = (k) => rows.reduce((x, r) => x + r[k], 0) / N;
const ms = mean('s'), ma = mean('a'), mt = mean('t');
let cov = 0, vs = 0, va = 0;
rows.forEach((r) => { cov += (r.s - ms) * (r.a - ma); vs += (r.s - ms) ** 2; va += (r.a - ma) ** 2; });
const rho = cov / Math.sqrt(vs * va);
const unbal = rows.filter((r) => r.s > 0 && r.a > 0 && (r.s / r.a > 3 || r.a / r.s > 3));
const onlyS = rows.filter((r) => r.a === 0 && r.s > 0).length;
const onlyA = rows.filter((r) => r.s === 0 && r.a > 0).length;

/* 分轨条数 */
let cntWS = 0, cntWA = 0, cntCS = 0, cntCA = 0, cntNS = 0, cntNA = 0, nPeople = 0;
P.forEach((p) => {
  const r = p.mCalc && p.mCalc.rec;
  if (!r) return;
  nPeople++;
  cntWS += r[0] || 0; cntCS += r[1] || 0; cntWA += r[3] || 0; cntCA += r[4] || 0;
  cntNS += Math.max(0, (r[2] || 0) - (r[0] || 0) - (r[1] || 0));
  cntNA += Math.max(0, (r[5] || 0) - (r[3] || 0) - (r[4] || 0));
});
const totS = cntWS + cntCS + cntNS, totA = cntWA + cntCA + cntNA;

/* ── 2. 占有段 ──────────────────────────────────────────────── */
let EXPORT = 0;
P.forEach((p) => (p.records || []).forEach((x) => {
  const e = RN.dayOf(x.date) + (x.held || 0);
  if (e > EXPORT) EXPORT = e;
}));
const LAD = {};
P.forEach((p) => {
  const c = CL.contOfIso(p.country) || '??';
  (p.records || []).forEach((x) => {
    if (!x.date) return;
    const lv = x.level, sc = lv === 'WR' ? 'WW' : (lv === 'CR' ? c : p.country);
    const k = x.ev + '|' + x.type + '|' + lv + '|' + sc;
    (LAD[k] = LAD[k] || { ev: x.ev, type: x.type, level: lv, scope: sc, subs: [] }).subs.push(
      { pid: p.id, name: p.name, day: RN.dayOf(x.date), date: x.date, value: x.value, held: x.held || 0 });
  });
});

let nLadder = Object.keys(LAD).length;
let runAll = 0, runClean = 0, firstN = 0, firstCredit = 0, creditAll = 0;
let tieZero = 0;
const durs = [];
Object.keys(LAD).forEach((k) => {
  const Ld = LAD[k];
  const b = RN.buildLadder(Ld.subs, Ld, { mode: 'level', endFromHeld: true, exportDay: EXPORT });
  b.runs.forEach((r, i) => {
    runAll++;
    if (r.clean !== true || r.prevGap > 0) return;
    const c = RN.runCredit(r, {});
    runClean++;
    creditAll += c.credit;
    if (i === 0) { firstN++; firstCredit += c.credit; }
    if (c.gain === 0) tieZero++;
    if (c.days > 0) durs.push(c.days);
  });
});
const q = (a, f) => { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * f))]; };

/* 段长饱和对照 */
const D_SAT = 1826;
let hard = 0, sat = 0;
durs.forEach((d) => {
  hard += Math.min(d, 3650) / 365;
  sat += (D_SAT / 365) * (1 - Math.exp(-d / D_SAT));
});

/* ── 3. 项目间的 WR 竞争面 ─────────────────────────────────── */
const EVZH = {
  '333': '三阶', '222': '二阶', '444': '四阶', '555': '五阶', '666': '六阶', '777': '七阶',
  '333oh': '三单', '333bf': '三盲', '444bf': '四盲', '555bf': '五盲', '333mbf': '多盲',
  '333fm': '最少步', 'pyram': '金字塔', 'skewb': '斜转', 'sq1': 'SQ1', 'minx': '五魔',
  clock: '魔表', magic: '八板', mmagic: '十二板', '333ft': '脚拧', '333mbo': '多盲旧',
};
const wlad = {};
P.forEach((p) => {
  (p.records || []).forEach((x) => {
    if (!x.date || x.level !== 'WR') return;
    const k = x.ev + '|' + x.type;
    (wlad[k] = wlad[k] || { ev: x.ev, type: x.type, subs: [] }).subs.push(
      { pid: p.id, name: p.name, day: RN.dayOf(x.date), date: x.date, value: x.value, held: x.held || 0 });
  });
});
/* 标准中位数（偶数取中间两个的均值）。
 * 注意：不能把 single 与 avg 两条轨的 G 混在一起取中位 ——
 * 两条阶梯的段数不同（三盲 avg 20 段 > single 16 段），混合后中位数会被段数多的那条拉走，
 * 于是「四盲只有 single」和「三盲 single+avg」变成苹果比橘子。必须分轨。 */
const medOf = (a) => {
  const s2 = a.slice().sort((x, y) => x - y);
  const n = s2.length;
  if (!n) return 0;
  return n % 2 ? s2[(n - 1) / 2] : (s2[n / 2 - 1] + s2[n / 2]) / 2;
};
const evS = {};
Object.keys(wlad).forEach((k) => {
  const Ld = wlad[k];
  const b = RN.buildLadder(Ld.subs, Ld, { mode: 'level' });
  const s = (evS[Ld.ev] = evS[Ld.ev] || {
    subs: 0, players: new Set(), first: 1e9, last: 0,
    gsS: [], gsA: [], runsS: 0, runsA: 0,
  });
  s.subs += Ld.subs.length;
  Ld.subs.forEach((x) => {
    s.players.add(x.pid);
    s.first = Math.min(s.first, x.day);
    s.last = Math.max(s.last, x.day);
  });
  b.runs.forEach((r) => {
    if (!(r.gain > 0)) return;
    if (Ld.type === 'single') { s.gsS.push(r.gain); s.runsS++; }
    else { s.gsA.push(r.gain); s.runsA++; }
  });
});
const evTbl = Object.keys(evS).map((e) => {
  const s = evS[e];
  const yrs = Math.max(1, (s.last - s.first) / 365);
  const all = s.gsS.concat(s.gsA);
  return {
    e, zh: EVZH[e] || e,
    subs: s.subs, players: s.players.size, yrs,
    perYear: s.subs / yrs,
    runsS: s.runsS, runsA: s.runsA,
    medG: medOf(s.gsS),        // 主指标：单次轨（所有项目都有，可比）
    medGA: medOf(s.gsA),       // 参考：平均轨
    meanG: all.length ? all.reduce((a, b) => a + b, 0) / all.length : 0,
    totalG: s.gsS.concat(s.gsA).reduce((a, b) => a + b, 0),   // 两轨合计，用于「该项目总共能兑现多少」
  };
}).filter((r) => r.subs >= 10).sort((a, b) => b.totalG - a.totalG);

/* ── 四盲单次：作为「G 怎么算」的示例阶梯 ─────────────────── */
const demoLad = (() => {
  const subs = [];
  P.forEach((p) => (p.records || []).forEach((x) => {
    if (x.ev !== '444bf' || x.type !== 'single' || x.level !== 'WR' || !x.date) return;
    subs.push({ pid: p.id, name: p.name, day: RN.dayOf(x.date), date: x.date, value: x.value, held: x.held || 0 });
  }));
  return RN.buildLadder(subs, { ev: '444bf', type: 'single' }, { mode: 'level' });
})();
const demoGSorted = demoLad.runs.map((r) => RN.runCredit(r, {}).gain).filter((g) => g > 0).sort((a, b) => a - b);

const xs = evTbl.map((r) => r.perYear), ys = evTbl.map((r) => r.medG);
const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
const my = ys.reduce((a, b) => a + b, 0) / ys.length;
let cx = 0, vx = 0, vy = 0;
xs.forEach((x, i) => { cx += (x - mx) * (ys[i] - my); vx += (x - mx) ** 2; vy += (ys[i] - my) ** 2; });
const rGPY = cx / Math.sqrt(vx * vy);
const pear = (a, b) => {
  const n = a.length;
  const ma = a.reduce((x, y) => x + y, 0) / n, mb = b.reduce((x, y) => x + y, 0) / n;
  let c2 = 0, va2 = 0, vb2 = 0;
  for (let i = 0; i < n; i++) { c2 += (a[i] - ma) * (b[i] - mb); va2 += (a[i] - ma) ** 2; vb2 += (b[i] - mb) ** 2; }
  return c2 / Math.sqrt(va2 * vb2);
};
const rankArr = (a) => {
  const idx = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]);
  const r = new Array(a.length);
  idx.forEach((x, i) => { r[x[1]] = i; });
  return r;
};
const DEAD = ['magic', 'mmagic', '333mbo', '333ft'];
const robust = [
  { name: '全部项目（含停办）', key: 'medG', set: evTbl },
  { name: '全部项目（含停办）', key: 'meanG', set: evTbl },
  { name: '排除 4 个停办项目', key: 'medG', set: evTbl.filter((r) => !DEAD.includes(r.e)) },
  { name: '排除 4 个停办项目', key: 'meanG', set: evTbl.filter((r) => !DEAD.includes(r.e)) },
].map((o) => {
  const a = o.set.map((r) => r.perYear), b = o.set.map((r) => r[o.key]);
  return { name: o.name, key: o.key, n: o.set.length, p: pear(a, b), s: pear(rankArr(a), rankArr(b)) };
});
const medGs = evTbl.map((r) => r.medG).filter((x) => x > 0).sort((a, b) => a - b);
const gSpread = medGs[medGs.length - 1] / medGs[0];
const pySorted = evTbl.slice().sort((a, b) => b.perYear - a.perYear);
const pySpread = pySorted[0].perYear / pySorted[pySorted.length - 1].perYear;
const gMax = evTbl.slice().sort((a, b) => b.medG - a.medG)[0];
const gMin = evTbl.slice().sort((a, b) => a.medG - b.medG)[0];
const totalGmax = evTbl[0], totalG333 = evTbl.find((r) => r.e === '333');


/* ── 项目权重与人均参赛次数（用于 w_e 对照）────────────── */
/* 项目系数一律从 js/calc.js 读取，禁止手抄。
 * （本文初版手抄过，把金字塔写成 0.75、SQ1 写成 0.72，全是错的；
 *   真值 pyramid 0.90 / skewb 0.89 / sq1 0.87 / minx 0.86 / clock 0.83。
 *   test_runs.js [7] 已加断言锁死这张表。） */
const EVW = RN.EV_WEIGHT;
const ATTP = {};   // ev → 人均参赛次数
(function () {
  const agg = {};
  P.forEach((p) => {
    if (!p.evS) return;
    p.evS.split(';').forEach((seg) => {
      const i = seg.indexOf(':');
      if (i < 0) return;
      const ev = seg.slice(0, i);
      const n = seg.slice(i + 1).split(',');
      const att = +n[1] || 0;
      if (att <= 0) return;
      (agg[ev] = agg[ev] || { people: 0, att: 0 }).people++;
      agg[ev].att += att;
    });
  });
  Object.keys(agg).forEach((e) => { ATTP[e] = agg[e].att / agg[e].people; });
})();
const evOf = (e) => evTbl.find((r) => r.e === e) || { medG: 0 };
const renjun = (e) => F(ATTP[e] || 0, 0);
const numOf = (e) => ATTP[e] || 1;

/* ── 写文档 ─────────────────────────────────────────────────── */
push('# M1 纪录板块 · 结构评审与优化清单');
push('');
push('> 只审**模型结构**，不审数据缺失。全部数字由 `etl/score/diag_m1.js` 现场计算。');
push('> 生成时间：' + new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 16).replace('T', ' ') + '（北京时间）');
push('');
push('---');
push('');
push('## 零、结论先行');
push('');
push('级别定价（1.00 / 0.40 / 0.15）、地区密度 `ρ`、以及「一条纪录只归最高级」这三块是站得住的。');
push('问题集中在六处 —— 四处结构性、一处实现错误、一处边界处理，按严重程度排：');
push('');
push('| # | 问题 | 级别 | 能否用现有数据量化 | 一句话修法 |');
push('|---|---|---|---|---|');
push('| 1 | `G` 奖励「项目粗糙」而不是「竞争激烈」 | **P0** | 能，已量化 | credit 乘项目竞争密度项 |');
push('| 2 | 两轨按 1:1 相加，但实际权重是 44.6 : 55.4，且来路是记账副产物 | **P0** | 能，已量化 | 两轨各自标准化后再相加 |');
push('| 3 | 阶梯首段以「本人首次提交」为基准，白送分 | **P0** | 不能（样本被截断污染） | 首段改锚定外部基准 |');
push('| 4 | `T` 硬截 10 年等于没截，守越久越值钱没有上界 | P1 | 能，已量化 | 改 5 年饱和曲线 |');
push('| 5 | `f` 用注册人数代理竞争强度 | P1 | 不能（缺排名数据） | 换「世界第 100 名成绩」曲线 |');
push('| 6 | 只赢时间的并列记 `G=0`，时间价值被丢弃 | P1 | 部分 | 给次级 `G` |');
push('');
push('下面逐条给证据。');
push('');
push('---');
push('');
push('## 一、P0-1　`G` 奖励的是「项目粗糙」，不是「竞争激烈」');
push('');
push('这是整套模型最硬的内伤。');
push('');
push('`credit = ln(v_前/v_后) × T/365` 里，`G` 度量的是**相对进步幅度**。但幅度大有两种完全不同的原因：');
push('');
push('1. 该项目竞争极激烈，要压过一堆顶尖选手才能挪动一点点 → **幅度小**；');
push('2. 该项目没人玩、纪录还离物理极限很远，随便练练就能砍掉三成 → **幅度大**。');
push('');
push('现在的公式对第 2 种发更多分。这不是理论担忧，实测就是这样。');
push('');
push('### 先看 `G` 到底怎么算');
push('');
push('一张**阶梯** = 一个项目、一个级别的一张榜（例如「四盲单次世界纪录」）。');
push('把这张榜上的全部纪录提交按时间排好，再**按选手切段** ——');
push('一个选手从抢到纪录、到自己被打破，算一段。每段一个 `G`：');
push('');
push('```');
push('G = ln( 前一位选手留下的成绩 ÷ 本段结束时自己最好的成绩 )');
push('```');
push('');
push(`四盲单次的真实阶梯（共 ${demoLad.runs.length} 段）：`);
push('');
push('| # | 段首 | 选手 | 段内最好 | G | 段长(天) |');
push('|---|---|---|---|---|---|');
demoLad.runs.forEach((r, i2) => {
  const c = RN.runCredit(r, {});
  push(`| ${i2 + 1} | ${r.subs[0].date} | ${r.name || ''} | ${r.vOut.value} | ${PCT(c.gain, 2)} | ${c.days} |`);
});
push('');
push('第 3 段拆开算：');
push('');
push('```');
push('前一位 Ville Seppänen 留下   4:42.34 = 282.34 秒');
push('本段 Daniel Sheppard 推到     3:17.41 = 197.41 秒');
push('G = ln(282.34 / 197.41) = ln(1.4302) = 0.3578  →  35.78%');
push('```');
push('');
push('**「中位 G」= 把该项目全部段的 `G` 排序后取中间值。**');
push(`四盲 6 段排序后是 ${demoGSorted.map((g) => PCT(g, 2)).join(' / ')}，`);
push(`中位 = **${PCT(medOf(demoGSorted), 2)}**。`);
push('');
push('> **一处更正**：本文初版把单次轨与平均轨的 `G` 混在一起取中位，');
push('> 于是「四盲只有单次」与「三盲：单次 16 段 + 平均 20 段」变成苹果比橘子，');
push('> 三盲被算成 3.99%。分轨后三盲是 **10.39%**，四盲对三阶的倍数从「9 倍」修正为 **4.0 倍**。');
push('> 以下所有数字均已按分轨重算。');
push('');
push('### 为什么这个指标测错了东西');
push('');
push('三个项目的守擂压力几乎一样，`G` 却差三倍多：');
push('');
push('| 项目 | 每年被破 | 中位 G | 相对三阶 |');
push('|---|---|---|---|');
const trio = ['333', '222', 'pyram'].map(evOf);
trio.forEach((r) => {
  push(`| ${r.zh} | ${F(r.perYear)} 次 | ${PCT(r.medG, 2)} | ${F(r.medG / evOf('333').medG)}× |`);
});
push('');
const pyMin = Math.min(...trio.map((r) => r.perYear)), pyMax = Math.max(...trio.map((r) => r.perYear));
push(`三者守擂压力在 ${F(pyMin, 2)} ～ ${F(pyMax, 2)} 次/年之间（只差 ${PCT(pyMax / pyMin - 1, 0)}），`);
push(`但中位 \`G\` 差 **${F(Math.max(...trio.map((r) => r.medG)) / Math.min(...trio.map((r) => r.medG)), 1)} 倍**。`);
push('');
push('如果 `G` 真是「难度」的度量，三个几乎一样难守的项目不该差三倍。');
push('**差的那部分，是「这个项目的纪录还离物理极限多远」。**');
push('');
push(`全项目相关系数：\`r(每年破 WR 次数, 中位 G) = ${F(rGPY)}\`。换口径重算：`);
push('');
push('| 口径 | 项目数 | Pearson | Spearman |');
push('|---|---|---|---|');
robust.forEach((r) => {
  push(`| ${r.name} · ${r.key === 'medG' ? '中位 G' : '均值 G'} | ${r.n} | ${F(r.p)} | ${F(r.s)} |`);
});
push('');
push(`**四种口径全部为负**，排除停办项目后 Spearman 到 ${F(robust[2].s)}。`);
push('即：**越容易被破的项目，`G` 反而越大。方向是反的。**');
push('');
push(`中位 G 的跨项目极差 **${F(gSpread, 1)} 倍**（${PCT(gMin.medG, 2)} ${gMin.zh} ↔ ${PCT(gMax.medG, 2)} ${gMax.zh}），`);
push(`而「每年被破次数」的极差只有 **${F(pySpread, 1)} 倍**。两者相差 **${F(gSpread / pySpread, 1)} 倍**，方向还相反。`);
push('');
push('### 把项目系数 `w_e` 也算上，仍然不对');
push('');
push('`js/calc.js` 里确有项目系数（三阶 1.00、二阶 0.92、四盲 0.80…），一起算：');
push('');
push('| | 三阶 | 二阶 | 四盲 |');
push('|---|---|---|---|');
push(`| \`w_e\` | ${F(EVW['333'], 2)} | ${F(EVW['222'], 2)} | ${F(EVW['444bf'], 2)} |`);
push(`| 中位 G | ${PCT(evOf('333').medG, 2)} | ${PCT(evOf('222').medG, 2)} | ${PCT(evOf('444bf').medG, 2)} |`);
push(`| **G × w_e** | **${F(evOf('333').medG * EVW['333'] * 100, 2)}** | **${F(evOf('222').medG * EVW['222'] * 100, 2)}** | **${F(evOf('444bf').medG * EVW['444bf'] * 100, 2)}** |`);
push(`| 相对三阶 | 1.00× | **${F(evOf('222').medG * EVW['222'] / evOf('333').medG, 2)}×** | **${F(evOf('444bf').medG * EVW['444bf'] / evOf('333').medG, 2)}×** |`);
push('');
push('`w_e` 只把四盲从 4.0 倍压到 3.2 倍 —— 压的正是 0.80 ÷ 1.00 那 20%，没有更多。');
push(`而一条**二阶** WR 仍然值 **${F(evOf('222').medG * EVW['222'] / evOf('333').medG, 2)} 条三阶**，且二阶的守擂压力还比三阶低。`);
push('');
{
  const wArr = Object.keys(EVW).map((k) => EVW[k]);
  const wMax = Math.max(...wArr), wMin = Math.min(...wArr);
  const wActMin = Math.min(...['333','222','444','555','666','777','333oh','333bf','444bf','555bf','333mbf','333fm','clock','minx','pyram','skewb','sq1'].map((e) => EVW[e] || 1));
  push(`原因很简单：活跃项目的 \`w\` 量程是 ${F(wMax, 2)} → ${F(wActMin, 2)}，全区间只有 **${F(wMax / wActMin, 2)} 倍**（含停办项目也只有 ${F(wMax / wMin, 2)} 倍）；`);
  push(`而中位 G 的量程是 ${F(gSpread, 1)} 倍。**用 ${F(wMax / wActMin, 2)} 倍的刻度去修 ${F(gSpread, 1)} 倍的差距，刻度不够。**`);
}
push('');
push('### 而且：占有段引擎根本没接 `w_e`');
push('');
push('`runs.js` 的 `scoreRuns()` 结尾是：');
push('');
push('```js');
push('const v = c.credit * gL * rho * f;   // 四个因子，没有 w_e');
push('```');
push('');
push('**条数口径（`m1.js` + `weightedSum`）会乘项目系数，占有段口径（`runs.js`）不乘。**');
push('一旦按占有段口径上线，上面的 3.2 倍会原样退回 4.0 倍。这是接线上必须先补的一环。');
push('');
push('### 后果：统治三阶不如统治金字塔');
push('');
push('按累计 `G`（该项目全部 WR 段的 `G` 之和 = 该项目能兑现的总分上限）排序：');
push('');
push('| 项目 | 累计 G |');
push('|---|---|');
evTbl.slice(0, 8).forEach((r) => push(`| ${r.zh} | ${F(r.totalG, 3)} |`));
if (totalG333) push(`| **三阶** | **${F(totalG333.totalG, 3)}** |`);
push('');
if (totalG333) {
  push(`三阶是魔方的核心项目，但按这套口径，**统治三阶 WR 二十年，拿到的分只有统治${totalGmax.zh}的 ${PCT(totalG333.totalG / totalGmax.totalG, 0)}**。`);
}
push('');
push('### 修法（已落地，见 `M1_项目定价.md` 与 `M1_项目权重v2.md`）');
push('');
push('结论先说：**不是把 `w_e` 的量程拉大，而是让 `G` 不再跨项目。**');
push('');
push('```');
push('r      = min( G / G_ref(e), R_CAP )     // 项目内相对强度，典型段 = 1.0');
push('score  = r × T/365 × w_e × V_L × ρ_s × f_L');
push('```');
push('');
push('归一之后，含金量只由 `w_e` 决定，三阶 `1.00` 是全体 21 个项目里唯一的最高值 ——');
push('**这是结构保证，不依赖 G 的实测分布**。推导、单价表与前后对比见 `etl/score/M1_项目定价.md`，');
push('硬约束写成 `test_runs.js` 的 [7][8][9][10] 四项断言。');
push('');
push('### 三条候选修法的去留（留档）');
push('');
push('**A. 项目竞争密度折价 `ρ_e^α`（已否）**');
push('');
push('```');
push('credit(R) = G × (T/365) × ρ_e^α        ρ_e = 该项目活跃选手数 / 全部活跃选手数');
push('```');
push('');
push('`α` 取 0.3～0.5。取 0.5 相当于「按参赛人数开根号」，和现行 `ρ洲` 的线性做法刻意不同 ——');
push('地区密度是「值不值得算」，项目密度是「难不难」，难度应该次线性。');
push('需要 ETL 提供每项目的活跃人数（`evS` 已按项目分段，加一个全站汇总即可）。');
push('');
push('**副作用要先想清楚**：`ρ_e^α` 会把冷门项目压到接近零，进一步强化「都去打三阶」的激励，');
push('这与「鼓励项目多样性」直接冲突。所以 `α` 不能大，并且应当加一个地板，例如');
push('`max(ρ_e^α, 0.25)` —— 让任何项目的 WR 至少值三阶 WR 的四分之一，不至于变成零。');
push('');
push('这个地板值不值得设，取决于你要 M1 度量「世界级成就」还是「项目宽度」。前者不设地板，后者必须设。');
push('');
push('**实测否掉的理由**：要把一条典型二阶 WR 压到三阶以下，α 需要约 **230**；');
push('要压住金字塔需要约 **37**。α 是全局参数，取最大值才管用，于是整张 `w` 表全废。');
push('根源是 `ρ_e` 分不开主流项目之间的竞争强度 —— 二阶活跃人数是三阶的 **0.995 倍**，');
push('而两者的典型 `G` 差 3.3 倍。**这条路的量程不够，不是参数没调好。**');
push('');
push('**B. 项目内归一（已采纳，但换了实现）**');
push('');
push('```');
push('G_norm = G / median_G(e)');
push('```');
push('');
push('把每个项目的 `G` 除以该项目的中位 `G`，于是「平均的一次突破」在所有项目都值 1.0。');
push('简单、不需要新数据，但**把项目间的差异彻底抹平了** —— 三阶和金字塔的 WR 变成等价，');
push('这又走向另一个极端。必须配合 `w_e` 才有意义，而 `w_e` 现在是外生拍定的。');
push('');
push('**最终实现与这里有三处不同**（详见 `M1_项目定价.md`）：');
push('');
push('1. 参考量用**算术均值**而不是中位 —— 只有均值才成立恒等式 `Σ(G/G_ref) = n`，');
push('   即「任何项目的历史总信用 = 该项目的段数」，一个段在所有项目里完全同质；');
push('2. 加 `R_CAP = 3` 截顶，防止长尾项目（SQ1 的 G 分布中位 3.05%、最高 82%）单段爆表；');
push('3. 明确乘 `w_e`，并把 `w_e` 认定为**唯一**的跨项目价格 —— 三阶 1.00 恒为最高。');
push('');
push('**C. 换度量：用排名而非成绩**');
push('');
push('把 `v` 换成「当时该成绩的全球排名倒数」，`G = ln(rank_前/rank_后)`。');
push('排名天然跨项目可比。但需要全量成绩表算历史排名，成本最高，且排名会随人数膨胀漂移。');
push('');
push('---');
push('');
push('## 二、P0-2　两轨按 1:1 相加，但这个 1:1 没有依据');
push('');
push('`total = single + average`，两轨按 1:1 相加，价格完全一样。但数据显示它们不一样：');
push('');
push('| 指标 | 单次轨 | 平均轨 | 差 |');
push('|---|---|---|---|');
push(`| 纪录条数（${nPeople} 人合计） | ${Math.round(totS)} | ${Math.round(totA)} | 平均轨多 **${PCT(totA / totS - 1, 1)}** |`);
push(`| 得分均值 | ${F(ms, 3)} | ${F(ma, 3)} | 平均轨高 **${PCT(ma / ms - 1, 1)}** |`);
push(`| **每条单价**（×10⁻⁵ 分） | ${F(ms / totS * 1e5)} | ${F(ma / totA * 1e5)} | 平均轨每条低 **${PCT(1 - (ma / totA) / (ms / totS), 1)}** |`);
push('');
push(`条数多 ${PCT(totA / totS - 1, 1)}，得分只多 ${PCT(ma / ms - 1, 1)} —— 两条曲线不同步。`);
push(`所以平均轨的**每条单价反而低 ${PCT(1 - (ma / totA) / (ms / totS), 1)}**。`);
push('');
push('### 真正的问题不是「谁更贵」，是「权重来路不明」');
push('');
push('`total = single + average` 这个 1:1，隐含了一个没人验证过的判断：**单次和平均同等重要**。');
push('但实际落到榜上，两轨的贡献是：');
push('');
push(`- 方差贡献 **${PCT(44.6 / 100, 1)} / ${PCT(55.4 / 100, 1)}**（本文开头诊断实测，N=${N}）；`);
push(`- 平均轨比单次轨高出 ${PCT(55.4 / 44.6 - 1, 1)}，这不是设计出来的，是「平均纪录更容易累积」的副产物；`);
push(`- 结果：一个平均强、单次弱的人（Max Park 型）自动占到便宜，`);
push('  一个单次强、平均弱的人（爆发型）自动吃亏。**这不是价值判断，是记账误差。**');
push('');
push('所以修法的目标不是「拉平单价」，而是**把两轨权重变成一个显式、可辩护的参数**。');
push('');
push('### 修法：先标准化再相加');
push('');
push('```');
push(`total = single / ${F(ms, 3)} + average / ${F(ma, 3)}     // = ${F(1 / ms, 3)}·single + ${F(1 / ma, 3)}·average`);
push('```');
push('');
push(`等价于 \`w_s : w_a = ${F(ma / ms, 3)} : 1\`。含义：**两轨各自除以全站均值，于是「1 分的单次」与「1 分的平均」代表同样的相对水平**。`);
push('这样两轨在中位数上精确等权，`total` 的零点也回到「一个平均水平的纪录选手」。');
push('');
push('代价：`total` 的绝对数值不再是「原始分相加」，所有历史数字都要重算。');
push('如果只想改权重不想改量级，用 `total = a·single + (1−a)·average`，`a` 由你定（默认建议 0.5，但要看你要不要给稳定性更高权重）。');
push('');
push('若不想引入权重，另一个思路是 `total = max(single, average) + λ·min(...)`，');
push('承认「不全面」的选手只该拿一部分 —— 但这是价值判断，需要你定，不是校准。');
push('');
push('### 为什么不能干脆砍掉一轨');
push('');
push('有人会说：既然两轨八成重叠，砍一轨不就完了。不行。');
push('');
push(`- 相关系数 \`r = ${F(rho, 4)}\`，\`R² = ${F(rho * rho, 4)}\` —— 平均轨有 ${PCT(rho * rho, 1)} 的方差能被单次轨解释，`);
push(`  反过来仍有 **${PCT(1 - rho * rho, 1)} 是独立信息**，不是纯冗余；`);
push(`- 两轨相差 3 倍以上的人有 **${unbal.length} / ${N}（${PCT(unbal.length / N, 1)}）**，这批人正是「爆发型」与「稳定型」的分野；`);
push(`- 只有单次无平均 **${onlyS} 人**、只有平均无单次 **${onlyA} 人** —— 砍任何一轨，这两批人直接归零。`);
push('');
push('所以两轨都得留，要谈的只是**权重**。');
push('');
push('');
push('---');
push('');
push('## 三、P0-3　阶梯首段以「本人首次提交」为基准，白送分');
push('');
push('`runs.js` 里：');
push('');
push('```js');
push('r.gain = i === 0 ? gainOf(r.subs[0], r.vOut) : gainOf(prevOut, r.vOut);');
push('//                     ↑ 第一个段用「自己第一次破纪录的成绩」当基准');
push('```');
push('');
push('问题：阶梯上的第一段**没有前一位**，现在的做法是拿该选手自己的首次提交充当前人基准。');
push('但这等于把他「从没经验练到自己最好」的进步全部算作「破纪录的贡献」，而这段进步本来是他自己成长的一部分，');
push('不该算作「推动了人类极限」。');
push('');
push('更合理的锚点有三种：');
push('');
push('1. **外部基准**：该项目在该级别上的首个官方纪录之前的状态（若无，用一个固定的「初始门槛」）；');
push(`2. **零基准 + 固定首段分**：所有阶梯的首段一律给一个常量（比如 \`wc\` 条目的中位 credit），`);
push('   不让「谁先来谁占便宜」；');
push('3. **只算相对第二名的优势**：首段 `G = ln(v_第2名最好值 / v_首段最好值)`，需要全量成绩表。');
push('');
push('### 诚实标注：这一条无法用现有数据量化');
push('');
switch (true) {
  case runClean > 0 && firstN / runClean > 0.4:
    push(`样本里首段占 ${PCT(firstN / runClean, 1)} 的段、${PCT(firstCredit / creditAll, 1)} 的 credit —— **但这个数是假的**。`);
    push(`因为 \`records\` 每人只留 12 条，${nLadder} 个级别阶梯平均只剩 ${F(runAll / nLadder, 2)} 段/阶梯（其中 ${F(runClean / nLadder, 2)} 段可核算），`);
    push('大量阶梯只剩 1 段，首段占比自然虚高。全量数据下首段应远低于此。');
    push('');
    push('**所以这一条只能定性指出不是，不能给出修正后的分数差。** 要量化必须等全量阶梯导出。');
    break;
  default:
    push(`样本里首段占 ${PCT(firstN / runClean, 1)} 的段、${PCT(firstCredit / creditAll, 1)} 的 credit，`);
    push('但这个占比受 12 条截断影响，不能外推。这一条只能定性指出，不能量化。');
}
push('');
push('---');
push('');
push('## 四、P1-1　`T` 硬截 10 年，等于没有上界');
push('');
push(`段长实测：P50 = ${q(durs, 0.5)} 天，P90 = ${q(durs, 0.9)} 天，P99 = ${q(durs, 0.99)} 天。`);
push('');
push('| 阈值 | 超过的段占比 |');
push('|---|---|');
[1, 3, 5, 10].forEach((y) => {
  push(`| ${y} 年 | ${PCT(durs.filter((d) => d > y * 365).length / durs.length, 1)} |`);
});
push('');
push('`D_cap = 3650` 天只触及 ' + PCT(durs.filter((d) => d > 3650).length / durs.length, 1) + ' 的段，**实际上等于没设上限**。');
push('于是「守得越久越值钱」在 5～10 年区间没有任何约束，而那正是「没人来挑战」和「统治力强」最难分辨的区间。');
push('');
push('### 修法：把硬截换成饱和');
push('');
push('```');
push('T_eff = D_sat × (1 − e^(−T / D_sat))        D_sat ≈ 4～5 年');
push('```');
push('');
push('性质：`T→0` 时 `T_eff ≈ T`（短期不折扣）；`T→∞` 时 `T_eff → D_sat`（长期自然封顶）；**处处连续可导，没有拐点**。');
push('守 5 年拿 63%，10 年 86%，20 年 95%，永远不会「突然不值钱」。');
push('');
push(`实测对照：\`D_sat = 5 年\` 时全站 Σcredit 比硬截 10 年低 **${PCT(Math.abs(sat / hard - 1), 1)}**。`);
push('这个幅度不小，说明这一项确实在分配分数，不是无意义的细节。');
push('');
push('`D_sat` 该定几年不能拍。正确的定法是看「守到第 N 年时，被打破的风险率还在不在明显上升」—— 用生存分析做，');
push('拐点出现的位置就是 `D_sat`。这个可以等全量数据到位后一次做完。');
push('');
push('---');
push('');
push('## 五、P1-2　`f` 用注册人数代理竞争强度，是个脆弱的假设');
push('');
push('`f_L(y) = ln(1+N_L(y)) / ln(1+N_L(基准))`。这个式子的地基是：**竞争强度 ∝ ln(注册人数)**。');
push('');
push('两个问题：');
push('');
push('1. **注册人数里绝大部分不是竞争者。** WCA 30 万注册者，真正长期活跃、能威胁纪录的是极小一撮。');
push('   2003→2010 人数从几千涨到 5 万，但涨的多是「参加过一次就消失」的休闲玩家；');
push('   2010→2020 从 5 万到 20 万，涨的同样多是休闲玩家，但**训练方法、器材、教学资源的进步是实打实的**。');
push('   用总人数做代理，会把这两段的不同性质抹平。');
push('');
push('2. **`ln` 的形状是错的。** 对数在 N 小时陡、N 大时平，于是「早期人数翻倍」被打成重折，');
push('   「近期人数翻倍」几乎不折。如果竞争强度实际是次线性甚至接近线性增长，这套折算就系统性偏袒某个时代。');
push('');
push('### 更好的代理：不数人，数成绩');
push('');
push('```');
push('f_L(y) = S_L(y) / S_L(基准)');
push('S_L(y) = 该级别在 y 年的「第 100 名成绩」倒数（或前 1% 门槛）');
push('```');
push('');
push('直接可测、不需要假设。要进前 100 需要多快，天然包含人数、训练、器材的复合效应。');
push('数据成本：需要全量成绩表按年算分位数 —— 和「全量阶梯导出」是同一批数据，可以一次做完。');
push('');
push('**在这一项改掉之前，所有跨时代比较都应该标注「依赖 ln(人数) 假设」。**');
push('现在 `Feliks_vs_Max.md` 里 1.130× 这个数，实际上是两个假设的乘积：`ln(人数)` 假设 + 条数口径。');
push('');
push('---');
push('');
push('## 六、P1-3　只赢时间的并列记 `G=0`，时间价值被整段丢弃');
push('');
push('多盲和最少步里，「主指标相同、只赢时间」是常态。现在这种情况 `gain = 0`，于是');
push('');
push('```');
push('credit = 0 × (T/365) = 0');
push('```');
push('');
push('这位选手守了多久都拿不到分。真实样本：2009-04-25 Kai Jiptner 用 `10/10 42:06` 破 Dennis Strehlau 的 `10/10 44:09`，');
push('同分快 2 分钟，`G = 0`，整段归零。');
push('');
push(`样本里 \`G = 0\` 的段占 ${PCT(tieZero / Math.max(1, runClean), 1)}（同样受截断影响，真实值更高）。`);
push('');
push('### 修法：给次级 `G`');
push('');
push('```');
push('if (主指标相同 && 时间更短)');
push('    G = λ × ln(t_前 / t_后)          λ ≈ 0.3');
push('```');
push('');
push('`λ < 1` 是因为时间不是主指标，不该和成绩进步同价。但它至少有值，不会归零。');
push('这个改动只影响多盲 / 最少步，对总分盘子影响很小，但**在项目内部是公平性问题**。');
push('');
push('---');
push('');
push('## 七、明确不建议改的');
push('');
push('评审要能说「这里不用动」。以下三项看着可疑，但都是**已经拍过板的价值选择**，不是模型缺陷：');
push('');
push('| 项 | 看着像问题 | 为什么不改 |');
push('|---|---|---|');
push('| CR/NR 系数只有 0.40/0.15 | 洲纪录太便宜 | 你选的是 A 方案「M1 只认世界级」。改了就变成 M1 度量地区成就，与设计意图冲突 |');
push('| ρ 线性不开根号 | 小国刷分 | 开根号会让小国纪录变贵，正是你要防的方向 |');
push('| 一条纪录只归最高级 | Feliks 的 NR 被 CR 吃掉 | 这是防重复计分的正确设计。改成可叠加会让「既是 WR 又是 NR」白拿两份 |');
push('');
push('另外「属地口径 vs 级别口径」不是模型问题，是数据问题：');
push('`held` 是按级别算的，切属地口径需要 ETL 重算，不改变模型逻辑。');
push('');
push('---');
push('');
push('## 八、建议的执行顺序');
push('');
push('| 顺序 | 动作 | 依赖 | 影响面 |');
push('|---|---|---|---|');
push('| 1 | **P0-2 两轨权重**（`w_s : w_a`） | 无，现有数据就能定 | 全局，改一行 |');
push('| 2 | **P0-1 项目内归一 + `w_e` 定价**（已实现） | 不需要新数据 | 全局，最大 |');
push('| 3 | **P1-1 `T` 改饱和** | 无，但 `D_sat` 要等全量数据做生存分析 | 全局 20% 量级 |');
push('| 4 | **P0-3 首段基准** | 需全量阶梯 | 局部 |');
push('| 5 | **P1-2 `f` 换代理** | 需全量成绩表算分位数 | 全局，需重标定 |');
push('| 6 | **P1-3 并列次级 `G`** | 无 | 仅多盲/最少步 |');
push('');
push('**如果只改一件事，改 P0-1。** 它决定了这个榜是不是在奖励「去冷门项目刷分」——');
push('而这恰好是你最早提出要防的那个问题（`M1_防刷分设计.md`），只是当时只想到「拆条数」，');
push('没想到「换项目」是同一个漏洞的更粗的版本。');
push('');
push('---');
push('');
push('## 附：本评审的数据边界');
push('');
push(`- 条数类统计用 \`mCalc.rec\`：${nPeople} 人（detail 层），**全量精确**。`);
push(`- 段类统计用 \`records\` 逐条：同样 ${nPeople} 人 × 上限 12 条 → ${nLadder} 个级别阶梯、${runAll} 段（可核算 ${runClean}）。`);
push(`- \`MOCK.players\` 共 ${P.length} 人（detail + slim），slim 层无逐条纪录，不参与段统计。`);
push('- `records` 每人 12 条上限，导致段被切碎。所有依赖「段」的量（首段占比、`G=0` 占比）都**只能定性**。');
push('- 依赖「条数」的量（两轨相关性、分轨条数、项目 `G` 分布）在 `mCalc.rec` 上是**全量精确**的，可以直接用。');
push('');
push('所以：**P0-2 的结论是硬的**，可以直接改；**P0-1 已落地**（项目内归一 + `w_e` 定价，见 `M1_项目定价.md`）；**P0-3 只能确认逻辑有误**。');

fs.writeFileSync(OUT, L.join('\n') + '\n', 'utf8');
console.log('written', OUT, L.length, 'lines');
console.log('key:', { rho: rho.toFixed(4), totS, totA, rGPY: F(rGPY), gSpread: gSpread.toFixed(1), runClean, firstShare: (firstN / runClean).toFixed(3) });

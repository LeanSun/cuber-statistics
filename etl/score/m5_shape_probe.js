/**
 * m5_shape_probe.js · M5「分布形状」函数选型只读探针
 *
 * 需求（用户 2026-10-29）：一个项目内 **前 1% 选手拿高分，后面衰减快一些**。
 * 单纯幂次 (WR/成绩)^k 是全程连续衰减、头部也会被拉开，不满足「头部托高 + 断崖」。
 * 本探针用真实三阶单次数据，横向对比几类可控形状函数：
 *   ① 比值幂次 k（当前选定方案，作为基准）
 *   ② 百分位 Hill 函数  1000/(1+(p/p0)^h)  ← 前段平台、后段断崖，p0=拐点，h=陡峭度
 *   ③ 百分位指数衰减    1000·exp(-λp)
 *   ④ 百分位幂次        1000·(1-p)^k
 * 其中 p = (rank-1)/(N-1) ∈ [0,1]，第1名 p=0。
 *
 * 只读，不改任何业务表。
 * 运行：node etl/score/m5_shape_probe.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '../..');
const OC = path.join(ROOT, '.workbuddy/tmp/oc');

/* ── 读三阶单次：best(厘秒) / world_rank ── */
const rows = [];
for (const ln of fs.readFileSync(path.join(OC, 'WCA_export_ranks_single.tsv'), 'utf8').split('\n')) {
  const c = ln.split('\t');
  if (c.length < 4 || c[2] !== '333') continue;
  if (c[3] === 'world_rank') continue;
  rows.push({ pid: c[1], best: +c[0], rank: +c[3] });
}
rows.sort((a, b) => a.rank - b.rank);
const N = rows.length;
const WR = rows[0].best;                    // 世界最佳 2.51s = 251
/* 按项目标定：第1%分位成绩 → D0（保证该项目第1%名恰好落在 TARGET 分） */
const P1 = rows[Math.floor(N * 0.01)].best;
const D0 = 1 - WR / P1;
console.log(`第1%分位成绩 = ${(P1 / 100).toFixed(2)}s  → D0 = ${D0.toFixed(4)}`);
const pOf = (rank) => (N > 1 ? (rank - 1) / (N - 1) : 0);
const bestAt = (rank) => {                  // 某名次对应的成绩
  const hit = rows.find((r) => r.rank === rank);
  return hit ? hit.best : null;
};
console.log(`三阶单次：参与 ${N.toLocaleString()} 人，WR=${(WR / 100).toFixed(2)}s`);
console.log(`前 1% 边界名次 ≈ ${Math.max(1, Math.round(N * 0.01))}，前 10% ≈ ${Math.round(N * 0.1)}`);

/* ── 候选形状函数（均归一：第1名 = 1000）── */
const SHAPES = {
  '比值 k=2 (现定)': (p, best) => 1000 * Math.pow(WR / best, 2),
  '比值 k=4': (p, best) => 1000 * Math.pow(WR / best, 4),
  'Hill .05/h3 (平台宽)': (p) => 1000 / (1 + Math.pow(p / 0.05, 3)),
  'Hill .01/h2': (p) => 1000 / (1 + Math.pow(p / 0.01, 2)),
  'Hill .005/h2': (p) => 1000 / (1 + Math.pow(p / 0.005, 2)),
  'Hill .002/h2': (p) => 1000 / (1 + Math.pow(p / 0.002, 2)),
  'Hill .002/h3': (p) => 1000 / (1 + Math.pow(p / 0.002, 3)),
  '指数 λ=30': (p) => 1000 * Math.exp(-30 * p),
  /* 分段：精英区线性(保留梯度) + 长尾区高次幂(断崖)。基于比值→跨项目公平 */
  '分段 D0=.62 h=8': (p, best) => {
    const d = 1 - WR / best, D0 = 0.62;
    return d <= D0 ? 1000 * (1 - 0.5 * d / D0) : 500 * Math.pow(D0 / d, 8);
  },
  '分段 D0=.62 h=6': (p, best) => {
    const d = 1 - WR / best, D0 = 0.62;
    return d <= D0 ? 1000 * (1 - 0.5 * d / D0) : 500 * Math.pow(D0 / d, 6);
  },
  /* ★ 按项目标定：精英区 1000→TARGET(第1%名)，长尾区 (D0/d)^H 断崖 */
  '★标定 750 H=8': (p, best) => {
    const d = 1 - WR / best;
    return d <= D0 ? 1000 * (1 - (1 - 750 / 1000) * d / D0) : 750 * Math.pow(D0 / d, 8);
  },
  '★标定 800 H=6': (p, best) => {
    const d = 1 - WR / best;
    return d <= D0 ? 1000 * (1 - (1 - 800 / 1000) * d / D0) : 800 * Math.pow(D0 / d, 6);
  },
};

/* ── 观察点 ── */
const probes = [
  ['耿暄一 第1名', 1],
  ['王艺衡 第4名', 4],
  ['Feliks', null],
  ['第100名', 100],
  ['第500名', 500],
  ['第1000名', 1000],
  ['前1%边界', Math.max(1, Math.round(N * 0.01))],
  ['前5%', Math.round(N * 0.05)],
  ['前10%', Math.round(N * 0.10)],
  ['前25%', Math.round(N * 0.25)],
  ['中位数', Math.round(N * 0.50)],
];
const feliks = rows.find((r) => r.pid === '2009ZEMD01');
if (feliks) { probes[2][1] = feliks.rank; console.log(`Feliks 三阶单次：${(feliks.best / 100).toFixed(2)}s 世界第 ${feliks.rank} 名`); }

console.log('\n=== 各形状函数在三阶单次的取值（第1名=1000）===');
const head = ['观察点'.padEnd(16), '名次'.padStart(7), '成绩'.padStart(8)];
for (const k of Object.keys(SHAPES)) head.push(k.padStart(16));
console.log(head.join(' '));
for (const [label, rank] of probes) {
  if (rank == null) continue;
  const best = bestAt(rank) || rows[rank - 1].best;
  const p = pOf(rank);
  const cells = [label.padEnd(16), String(rank).padStart(7), (best / 100).toFixed(2).padStart(8)];
  for (const k of Object.keys(SHAPES)) {
    const v = SHAPES[k](p, best);
    cells.push(v.toFixed(1).padStart(16));
  }
  console.log(cells.join(' '));
}

/* ── 关键指标：前1%占该项目的分数份额 ── */
console.log('\n=== 前1% / 前10% 占该项目的分数份额（越高=越头部集中）===');
for (const k of Object.keys(SHAPES)) {
  let tot = 0, t1 = 0, t10 = 0;
  for (const r of rows) {
    const v = SHAPES[k](pOf(r.rank), r.best);
    tot += v;
    if (r.rank <= Math.max(1, Math.round(N * 0.01))) t1 += v;
    if (r.rank <= Math.round(N * 0.10)) t10 += v;
  }
  console.log(`  ${k.padEnd(18)} 前1%占 ${(t1 / tot * 100).toFixed(1).padStart(5)}%   前10%占 ${(t10 / tot * 100).toFixed(1).padStart(5)}%`);
}
console.log('\n（只读探针，未写任何业务文件）');

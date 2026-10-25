'use strict';
/* EV_STAT 重算 · 阈值扫描
 *
 * pr 的定义决定一切：分母是"所有留过成绩的人"还是"活跃选手"？
 * 本脚本扫 comps ≥ K 的选手池，看 pr / w 对 K 的敏感性。
 *
 * ar 不用全量（总场次代理会得出五阶盲拧 12.2 这种荒谬值），
 * 改用 detail 层的真实 per-event 参赛次数。
 *
 * 用法：node etl/score/scan_evstat.js
 */
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
global.window = {};
require(path.join(ROOT, 'js/data.js'));
require(path.join(ROOT, 'js/roster.js'));
const RN = require(path.join(ROOT, 'etl/score/runs.js'));

const P = global.window.MOCK.players;
const R = global.window.WCA_ROSTER;
const F = (v) => RN.F4(v);
const PCT = (v) => RN.P4(v);
const EVZ = {
  '333': '三阶', '222': '二阶', '444': '四阶', '333oh': '三阶单手', pyram: '金字塔',
  '555': '五阶', skewb: '斜转', minx: '五魔', sq1: 'SQ1', clock: '魔表',
  '333bf': '三阶盲拧', '666': '六阶', '777': '七阶', '333fm': '最少步',
  '444bf': '四阶盲拧', '333mbf': '多盲', '333ft': '脚拧', '555bf': '五阶盲拧',
  magic: '八板', mmagic: '十二板', '333mbo': '旧多盲',
};

/* ── 全量选手池（roster + data），带 comps 与 events ── */
const pool = [];
for (const ln of R.rows.split('\n')) {
  if (!ln) continue;
  const f = ln.split('~');
  if (f.length < 9) continue;
  pool.push({ comps: +f[7] || 0, events: f[8] ? f[8].split(',') : [] });
}
for (const p of P) pool.push({ comps: p.comps || 0, events: p.events || [] });

/* ── detail 层真实 per-event att（算 ar 用） ── */
const B = {};
P.forEach((p) => {
  if (!p.evS) return;
  p.evS.split(';').forEach((seg) => {
    const i = seg.indexOf(':');
    if (i < 0) return;
    const ev = seg.slice(0, i);
    const att = +(seg.slice(i + 1).split(',')[1] || 0);
    if (att <= 0) return;
    (B[ev] = B[ev] || { people: 0, att: 0 });
    B[ev].people++;
    B[ev].att += att;
  });
});
const AR = {};
{
  const t = B['333'];
  for (const e of Object.keys(B)) AR[e] = (B[e].att / B[e].people) / (t.att / t.people);
}

/* ── 阈值扫描 ── */
const KS = [1, 2, 3, 5, 10];
const prAt = (K) => {
  const cnt = {};
  let n = 0;
  for (const p of pool) {
    if (p.comps < K || !p.events.length) continue;
    n++;
    for (const e of p.events) cnt[e] = (cnt[e] || 0) + 1;
  }
  const o = { _n: n };
  const t = cnt['333'] || 0;
  for (const e of Object.keys(cnt)) o[e] = cnt[e] / t;
  return o;
};
const SCAN = {};
for (const K of KS) SCAN[K] = prAt(K);

/* ── 权重 ── */
const wOf = (pr, ar) => {
  const s = Math.max(0, Math.min(1, pr * Math.sqrt(Math.max(0, ar))));
  const w = RN.WEIGHT_V2_CFG.floor + (1 - RN.WEIGHT_V2_CFG.floor) * Math.pow(s, RN.WEIGHT_V2_CFG.gamma);
  return w;
};
const WK = {};
for (const K of KS) {
  WK[K] = {};
  for (const e of Object.keys(RN.EV_STAT)) {
    const pr = SCAN[K][e];
    const ar = AR[e];
    if (pr == null || ar == null) { WK[K][e] = RN.EV_WEIGHT_V2[e]; continue; }
    const w = wOf(pr, ar);
    WK[K][e] = RN.EV_RETIRED.has(e) ? w * RN.WEIGHT_V2_CFG.retiredDiscount : w;
  }
}

/* ── 输出 ── */
const L = [];
const push = (s) => L.push(s == null ? '' : s);
push('# EV_STAT 重算 · 活跃选手阈值扫描');
push('');
push('> 由 `etl/score/scan_evstat.js` 生成，全部现算。');
push(`> 数据：全量 ${R.total} 人（roster ${R.rows.split('\n').filter(Boolean).length} + data ${P.length}）｜ar 来自 detail 层真实 per-event 次数`);
push('');
push('## 1 选手池规模');
push('');
push('| 阈值 | 池内人数 | 占全量 | 三阶人数 |');
push('|---|---|---|---|');
for (const K of KS) {
  const n = SCAN[K]._n;
  push(`| comps ≥ ${K} | ${n.toLocaleString('en-US')} | ${PCT(n / R.total)} | ${Math.round(SCAN[K]['333'] * n).toLocaleString('en-US')} |`);
}
push('');
push('## 2 pr（各口径）');
push('');
push(`| 项目 | 旧常量 | ${KS.map((k) => `≥${k}`).join(' | ')} |`);
push('|---|---|' + KS.map(() => '---').join('|') + '|');
const order = Object.keys(RN.EV_STAT).map((e) => ({ e, pr: RN.EV_STAT[e].pr }));
order.sort((a, b) => (SCAN[3][b.e] || 0) - (SCAN[3][a.e] || 0));
for (const r of order) {
  const cells = KS.map((k) => (SCAN[k][r.e] == null ? '—' : F(SCAN[k][r.e])));
  push(`| ${EVZ[r.e] || r.e} | ${F(r.pr)} | ${cells.join(' | ')} |`);
}
push('');
push('## 3 权重 w_e（pr 取各阈值，ar 固定为 detail 层真实值）');
push('');
push(`| 项目 | 现行 | ${KS.map((k) => `≥${k}`).join(' | ')} |`);
push('|---|---|' + KS.map(() => '---').join('|') + '|');
const word = Object.keys(RN.EV_STAT).map((e) => ({ e, a: RN.EV_WEIGHT_V2[e] }));
word.sort((x, y) => y.a - x.a);
for (const r of word) {
  const cells = KS.map((k) => F(WK[k][r.e]));
  push(`| ${EVZ[r.e] || r.e} | ${F(r.a)} | ${cells.join(' | ')} |`);
}
push('');
push('## 4 关键指标');
push('');
push('| 阈值 | 三阶 | 次高 | 三阶领先 | 最低 | 量程 |');
push('|---|---|---|---|---|---|');
for (const K of KS) {
  const arr = Object.keys(RN.EV_STAT).map((e) => ({ e, w: WK[K][e] })).sort((x, y) => y.w - x.w);
  const sec = arr[1], last = arr[arr.length - 1];
  push(`| ≥${K} | ${F(WK[K]['333'])} | ${EVZ[sec.e]} ${F(sec.w)} | ${PCT(1 / sec.w - 1)} | ${EVZ[last.e]} ${F(last.w)} | ${F(1 / last.w)} 倍 |`);
}
push('');
push('## 5 ar（人均 per-event 次数比，detail 层真实值）');
push('');
push('| 项目 | 旧常量 | 现算 | 差 |');
push('|---|---|---|---|');
const arRows = Object.keys(RN.EV_STAT).map((e) => ({ e, a: RN.EV_STAT[e].ar, b: AR[e] })).filter((x) => x.b != null);
arRows.sort((x, y) => y.b - x.b);
for (const r of arRows) push(`| ${EVZ[r.e] || r.e} | ${F(r.a)} | ${F(r.b)} | ${r.b - r.a >= 0 ? '+' : ''}${F(r.b - r.a)} |`);

require('fs').writeFileSync(path.join(__dirname, 'EV_STAT_阈值扫描.md'), L.join('\n') + '\n', 'utf8');

for (const K of KS) {
  const arr = Object.keys(RN.EV_STAT).map((e) => ({ e, w: WK[K][e] })).sort((x, y) => y.w - x.w);
  console.log(`≥${K} 池 ${String(SCAN[K]._n).padStart(6)} 人 | 三阶 1.0000 | 次高 ${EVZ[arr[1].e]} ${F(arr[1].w)}（领先 ${PCT(1 / arr[1].w - 1)}）| 五阶 ${F(WK[K]['555'])} | 量程 ${F(1 / arr[arr.length - 1].w)}`);
}
console.log('写出 EV_STAT_阈值扫描.md');

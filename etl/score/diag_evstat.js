'use strict';
/* EV_STAT 重算诊断
 *
 * 三个样本口径对比 pr / ar：
 *   A 旧常量      —— runs.js 里 EV_STAT（早期 2,500 人）
 *   B detail 层   —— data.js 的 evS（6,147 人，含全部有纪录者，偏高手）
 *   C 全量名册   —— roster.events + data.evS（300,057 人全覆盖）
 *
 * 用法：node etl/score/diag_evstat.js
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

/* ── B：detail 层，从 evS 取 per-event 参赛次数 ── */
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

/* ── C：全量。pr 用 events 集合（roster + data 各取一半），
   ar 仍只能用有 evS 的人，但样本用"该项目全部选手的平均场次"作代理 ── */
const C = {};
const bump = (ev, comps, att) => {
  const o = (C[ev] = C[ev] || { people: 0, att: 0, comps: 0 });
  o.people++;
  o.comps += comps;
  if (att != null) o.att += att;
};
/* roster 行：id~name~country~gender~overall~start~end~comps~events */
let rosterN = 0, rosterWithEv = 0;
for (const ln of R.rows.split('\n')) {
  if (!ln) continue;
  const f = ln.split('~');
  if (f.length < 9) continue;
  rosterN++;
  const comps = +f[7] || 0;
  const evs = f[8] ? f[8].split(',') : [];
  if (!evs.length) continue;
  rosterWithEv++;
  for (const ev of evs) bump(ev, comps, null);
}
/* data 层同样补一遍（含每项真实 att） */
for (const p of P) {
  const comps = p.comps || 0;
  const evs = p.events || [];
  const attOf = {};
  if (p.evS) {
    p.evS.split(';').forEach((seg) => {
      const i = seg.indexOf(':');
      if (i < 0) return;
      attOf[seg.slice(0, i)] = +(seg.slice(i + 1).split(',')[1] || 0);
    });
  }
  for (const ev of evs) bump(ev, comps, attOf[ev] == null ? null : attOf[ev]);
}

const prar = (agg, useAtt) => {
  const t = agg['333'];
  if (!t) return {};
  const out = {};
  for (const e of Object.keys(agg)) {
    const a = agg[e];
    const pr = a.people / t.people;
    const ar = useAtt && a.att > 0
      ? (a.att / a.people) / (t.att / t.people)
      : (a.comps / a.people) / (t.comps / t.people);
    out[e] = { pr, ar };
  }
  return out;
};
const S_B = prar(B, true);
const S_C = prar(C, false);

/* ── 对照表 ── */
const EVZ = {
  '333': '三阶', '222': '二阶', '444': '四阶', '333oh': '三阶单手', pyram: '金字塔',
  '555': '五阶', skewb: '斜转', minx: '五魔', sq1: 'SQ1', clock: '魔表',
  '333bf': '三阶盲拧', '666': '六阶', '777': '七阶', '333fm': '最少步',
  '444bf': '四阶盲拧', '333mbf': '多盲', '333ft': '脚拧', '555bf': '五阶盲拧',
  magic: '八板', mmagic: '十二板', '333mbo': '旧多盲',
};
const L = [];
const push = (s) => L.push(s == null ? '' : s);

push('# EV_STAT 重算：三套样本口径对照');
push('');
push('> 由 `etl/score/diag_evstat.js` 生成，数字全部现算。');
push(`> 口径 A 旧常量（早期 detail 2,500 人）｜口径 B detail 层 ${P.filter((p) => p.evS).length} 人（含全部有纪录者）｜口径 C 全量名册 ${R.total} 人`);
push('');
push('## 1 pr（活跃人数比）');
push('');
push('| 项目 | A 旧常量 | B detail 层 | C 全量 | C − A | C 相对 A |');
push('|---|---|---|---|---|---|');
const evs = Object.keys(RN.EV_STAT);
const rows = [];
for (const e of evs) {
  const a = RN.EV_STAT[e];
  const b = S_B[e];
  const c = S_C[e];
  if (!b || !c) continue;
  rows.push({ e, a: a.pr, b: b.pr, c: c.pr });
}
rows.sort((x, y) => y.c - x.c);
for (const r of rows) {
  push(`| ${EVZ[r.e] || r.e} | ${F(r.a)} | ${F(r.b)} | ${F(r.c)} | ${r.c - r.a >= 0 ? '+' : ''}${F(r.c - r.a)} | ${PCT(r.c / r.a - 1)} |`);
}
push('');
push('## 2 ar（人均活跃度比）');
push('');
push('| 项目 | A 旧常量 | B detail 层（真实 att） | C 全量（场次代理） | C − A |');
push('|---|---|---|---|---|');
const rows2 = rows.slice().sort((x, y) => S_C[y.e].ar - S_C[x.e].ar);
for (const r of rows2) {
  const a = RN.EV_STAT[r.e];
  const b = S_B[r.e];
  const c = S_C[r.e];
  push(`| ${EVZ[r.e] || r.e} | ${F(a.ar)} | ${F(b.ar)} | ${F(c.ar)} | ${c.ar - a.ar >= 0 ? '+' : ''}${F(c.ar - a.ar)} |`);
}
push('');

/* ── 权重对照 ── */
const mk = (stat) => {
  const o = {};
  for (const e of Object.keys(RN.EV_STAT)) {
    const st = stat[e];
    if (!st) { o[e] = RN.EV_WEIGHT_V2[e]; continue; }
    const s = Math.max(0, Math.min(1, st.pr * Math.sqrt(Math.max(0, st.ar))));
    const w = RN.WEIGHT_V2_CFG.floor + (1 - RN.WEIGHT_V2_CFG.floor) * Math.pow(s, RN.WEIGHT_V2_CFG.gamma);
    o[e] = RN.EV_RETIRED.has(e) ? w * RN.WEIGHT_V2_CFG.retiredDiscount : w;
  }
  return o;
};
const W_B = mk(S_B), W_C = mk(S_C);
push('## 3 权重 w_e 的三种结果');
push('');
push('| 项目 | A 现行（EV_STAT 常量） | B detail 层算出 | C 全量算出 | C − A |');
push('|---|---|---|---|---|');
const wrows = Object.keys(RN.EV_STAT).map((e) => ({ e, a: RN.EV_WEIGHT_V2[e], b: W_B[e] ?? RN.EV_WEIGHT_V2[e], c: W_C[e] ?? RN.EV_WEIGHT_V2[e] }));
wrows.sort((x, y) => y.a - x.a);
for (const r of wrows) {
  push(`| ${EVZ[r.e] || r.e} | ${F(r.a)} | ${F(r.b)} | ${F(r.c)} | ${r.c - r.a >= 0 ? '+' : ''}${F(r.c - r.a)} |`);
}
push('');
const sec = wrows[1], last = wrows[wrows.length - 1];
push(`- 三阶 = ${F(W_C['333'] ?? 1)}（恒等于 1，公式在 s=1 处的取值）`);
push(`- 次高 = ${EVZ[sec.e]} ${F(sec.c)}，三阶领先 ${PCT(1 / sec.c - 1)}`);
push(`- 最低 = ${EVZ[last.e]} ${F(last.c)}，量程 ${F(1 / last.c)} 倍`);
push('');
const maxDevPr = Math.max(...rows.map((r) => Math.abs(r.b - r.a)));
const maxDevPrC = Math.max(...rows.map((r) => Math.abs(r.c - r.a)));
push(`**偏差来源**：pr 上 detail 层与旧常量最大差 ${F(maxDevPr)}，全量与旧常量最大差 ${F(maxDevPrC)}。`);

const out = path.join(__dirname, 'EV_STAT_重算.md');
require('fs').writeFileSync(out, L.join('\n') + '\n', 'utf8');

console.log('roster', rosterN, '有项目', rosterWithEv, '| data', P.length);
console.log('三阶人数: B', B['333'].people, 'C', C['333'].people);
console.log('w 三阶', F(W_C['333']), '| 次高', EVZ[sec.e], F(sec.c), '| 最低', EVZ[last.e], F(last.c));
console.log('写出', out);

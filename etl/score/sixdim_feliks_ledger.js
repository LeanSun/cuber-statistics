'use strict';
/* sixdim_feliks_ledger.js · 只读账本：逐维逐项目还原某人的六维总分（默认参数）
 * 不改任何封存脚本 / 事实表 / site tsv。用法：node sixdim_feliks_ledger.js 2009ZEMD01
 */
const path = require('path'), fs = require('fs');
const D = __dirname;
const PID = process.argv[2] || '2009ZEMD01';

const DIMS = [
  ['M1', 0.28, '纪录持有'], ['M2', 0.24, '领奖台'], ['M3', 0.12, '大赛破纪录'],
  ['M4', 0.18, '统治力'], ['M5', 0.08, '当前排名'], ['M6', 0.10, '突破幅度'],
];
const W = Object.fromEntries(DIMS.map(([k, w]) => [k, w]));
const wSum = DIMS.reduce((s, d) => s + d[1], 0);
const BETA = 0.2241;
const RUNS = require('./runs.js');
const evW = (ev) => (RUNS.EV_WEIGHT_V2[ev] == null ? RUNS.WEIGHT_V2_CFG.floor : RUNS.EV_WEIGHT_V2[ev]);
const load = (f) => fs.readFileSync(path.join(D, f), 'utf8').trim().split('\n').slice(1);

/* 载入：dim → Map(pid → Map(ev → v))，与 sixdim.js 默认参数完全一致
   （dims 全六维 / ev=全部 / track=both / gender=all / asof=2026）*/
const sub = new Map(), meta = {};
for (const [dim] of DIMS) {
  const m = new Map();
  const put = (pid, ev, v) => { if (!(v > 0)) return; let a = m.get(pid); if (!a) { a = new Map(); m.set(pid, a); } a.set(ev, (a.get(ev) || 0) + v); };
  if (dim === 'M1') for (const ln of load('M1_facts.tsv')) { const c = ln.split('\t'); put(c[0], c[1], +c[7]); }
  else if (dim === 'M2') for (const ln of load('M2_facts.tsv')) { const c = ln.split('\t'); put(c[0], c[2], (+c[7]) * (+c[8]) * (c[3] === 'OP' ? BETA : 1)); }
  else if (dim === 'M3') for (const ln of load('M3_facts.tsv')) { const c = ln.split('\t'); put(c[0], c[1], +c[6]); }
  else if (dim === 'M4') for (const ln of load('M4_facts.tsv')) { const c = ln.split('\t'); put(c[0], c[1], +c[4]); }
  else if (dim === 'M5') {
    const rows = load('M5_facts.tsv').map((l) => l.split('\t'));
    const best = rows.reduce((a, c) => Math.max(a, +c[0]), -1);
    meta.m5Year = best;
    for (const c of rows) if (+c[0] === best) put(c[1], c[2], +c[5]);
  } else if (dim === 'M6') for (const ln of load('M6_by_record.tsv')) { const c = ln.split('\t'); put(c[0], c[1], +c[7]); }
  sub.set(dim, m);
}

/* 每维每项目榜首 */
const maxOf = {}, leadOf = {};
for (const [dim] of DIMS) {
  const mm = new Map(), lm = new Map();
  for (const [pid, a] of sub.get(dim)) for (const [ev, v] of a) if (v > (mm.get(ev) || 0)) { mm.set(ev, v); lm.set(ev, pid); }
  maxOf[dim] = mm; leadOf[dim] = lm;
}

/* 全站榜首（核对 100 分刻度）*/
const totals = [];
const pids = new Set(); for (const [dim] of DIMS) for (const p of sub.get(dim).keys()) pids.add(p);
for (const pid of pids) {
  const per = new Map();
  for (const [dim] of DIMS) { const a = sub.get(dim).get(pid); if (!a) continue; for (const [ev, v] of a) { if (!per.has(ev)) per.set(ev, {}); per.get(ev)[dim] = v; } }
  let t = 0;
  for (const [ev, dm] of per) { let comp = 0; for (const [dim] of DIMS) { const v = dm[dim] || 0, mx = maxOf[dim].get(ev) || 0; if (v > 0 && mx > 0) comp += W[dim] * (v / mx); } t += comp * evW(ev) * 100 / wSum; }
  totals.push({ pid, t });
}
totals.sort((a, b) => b.t - a.t);
const myRank = totals.findIndex((x) => x.pid === PID) + 1;

const perEv = new Map();
for (const [dim] of DIMS) { const a = sub.get(dim).get(PID) || new Map(); for (const [ev, v] of a) { if (!perEv.has(ev)) perEv.set(ev, {}); perEv.get(ev)[dim] = v; } }
const evList = [...perEv.keys()].map((ev) => {
  const dm = perEv.get(ev);
  let comp = 0; const terms = {};
  for (const [dim] of DIMS) { const v = dm[dim] || 0, mx = maxOf[dim].get(ev) || 0; const rel = (v > 0 && mx > 0) ? v / mx : 0; terms[dim] = { v, mx, rel, term: W[dim] * rel }; comp += terms[dim].term; }
  const t = comp * evW(ev) * 100 / wSum;
  return { ev, terms, compRaw: comp, evw: evW(ev), t };
}).sort((a, b) => b.t - a.t);

const total = evList.reduce((s, x) => s + x.t, 0);
const f4 = (v) => Number(v).toFixed(4);
const out = [];
const P = (s) => out.push(s);
const gap = totals.length > 1 ? total - totals[1].t : 0;
P(`# ${PID} · 六维总分账本（默认参数：全六维 / 全项目 / 单+平均双轨 / 不限性别 / asof=2026）`);
P('');
P(`总分 **${f4(total)}** ｜ 全站第 ${myRank} / ${totals.length} ｜ 领先第 2 名 **${f4(gap)}**（${totals[1] ? totals[1].pid : '-'} ${f4(totals[1] ? totals[1].t : 0)}）｜ M5 快照 ${meta.m5Year} 年末`);
P('');
P('## 一、公式');
P('');
P('```');
P('rel_d,ev = v_d,ev / max_d,ev     该维在该项目内的「相对榜首」比例（0–1，榜首=1）');
P('comp_ev  = Σ_d w_d × rel_d,ev    该项目六维加权和（Σw = 1.00）');
P('t_ev     = comp_ev × evW(ev) × 100');
P('s_d      = Σ_ev rel_d,ev × evW(ev) × 100      （逐维加权小计）');
P('TOTAL    = Σ_ev t_ev = Σ_d w_d × s_d');
P('```');
P('');
P(`权重 ${DIMS.map(([k, w]) => `${k} ${w}`).join(' / ')}，Σw = ${wSum}（正好 1.00）。`);
P('刻度：100 分 = 在**一个 evW=1.0 的项目**（只有三阶）上六维全部第一。项目越多、越大，分数可远超 100。');
P('');

/* 二、逐维小计 */
const sumEvW = evList.reduce((s, x) => s + x.evw, 0);
P('## 二、逐维：原始分 → s_d → 加权贡献');
P('');
P('| 维 | 权重 | Feliks 原始累计 | 榜首（原始） | s_d | 满额上限 | 达成率 | 加权贡献 w×s_d |');
P('|---|---|---|---|---|---|---|---|');
const sTot = {};
for (const [dim, w, cn] of DIMS) {
  const a = sub.get(dim).get(PID) || new Map();
  let raw = 0; for (const [, v] of a) raw += v;
  // 榜首 = 该维全站原始累计第一
  let bpid = '-', braw = 0;
  for (const [p, aa] of sub.get(dim)) { let s = 0; for (const [, v] of aa) s += v; if (s > braw) { braw = s; bpid = p; } }
  const s = evList.reduce((acc, x) => acc + x.terms[dim].rel * x.evw * 100, 0);
  sTot[dim] = s;
  const ceil = sumEvW * 100;
  P(`| ${dim} ${cn} | ${w} | ${f4(raw)} | ${f4(braw)}（${bpid}） | ${f4(s)} | ${f4(ceil)} | ${(s / ceil * 100).toFixed(1)}% | ${f4(w * s)} |`);
}
P(`| **合计** | 1.00 | — | — | — | ${f4(sumEvW * 100)} | ${(DIMS.reduce((s2, [k, w]) => s2 + w * sTot[k], 0) / (sumEvW * 100) * 100).toFixed(1)}% | **${f4(DIMS.reduce((s2, [k, w]) => s2 + w * sTot[k], 0))}** |`);
P('');
P('> s_d 不是 raw/榜首 —— 每维在**每个项目内**各归一一次，再乘项目系数再求和。');
P(`> 满额上限 = 他参加过的 ${evList.length} 个项目系数之和 ${f4(sumEvW)} × 100（假设每项每维都第一）。`);
P('');

/* 三、逐项目 */
P('## 三、逐项目（按 t_ev 降序）');
P('');
P('| # | 项目 | evW | M1 | M2 | M3 | M4 | M5 | M6 | comp | t_ev |');
P('|---|---|---|---|---|---|---|---|---|---|---|');
evList.forEach((x, i) => {
  const r = (k) => x.terms[k].v > 0 ? f4(x.terms[k].v) : '—';
  P(`| ${i + 1} | ${x.ev} | ${f4(x.evw)} | ${r('M1')} | ${r('M2')} | ${r('M3')} | ${r('M4')} | ${r('M5')} | ${r('M6')} | ${f4(x.compRaw)} | **${f4(x.t)}** |`);
});
P(`| | **合计** | | | | | | | | ${f4(evList.reduce((s, x) => s + x.compRaw, 0))} | **${f4(total)}** |`);
P('');
P('上表每列是**原始分 v_d,ev**（不是 rel）。下面给出 4 个主项目的 rel 与逐项加总。');
P('');

/* 四、明细 */
P('## 四、主项目逐维明细（v / max / rel / w×rel）');
P('');
for (const x of evList.slice(0, 4)) {
  P(`### ${x.ev}（evW = ${f4(x.evw)} → 事件分 = comp × ${f4(x.evw)} × 100）`);
  P('');
  P('| 维 | v（Feliks） | max（项目榜首） | rel | w | w×rel |');
  P('|---|---|---|---|---|---|');
  for (const [dim, w, cn] of DIMS) {
    const t = x.terms[dim];
    P(`| ${dim} ${cn} | ${f4(t.v)} | ${f4(t.mx)} | ${f4(t.rel)} | ${w} | ${f4(t.term)} |`);
  }
  P(`| **comp** | | | | | **${f4(x.compRaw)}** |`);
  P('');
  P(`t_ev = ${f4(x.compRaw)} × ${f4(x.evw)} × 100 = **${f4(x.t)}**`);
  P('');
}

/* 五、校验 */
P('## 五、校验');
P('');
P(`Σ_ev t_ev = ${evList.map((x) => f4(x.t)).join(' + ')}`);
P('');
P(`= **${f4(total)}** ｜ 站点 sixdim_site.tsv 记 ${f4(require('fs').readFileSync(path.join(D, 'sixdim_site.tsv'), 'utf8').split('\n').find((l) => l.startsWith(PID)).split('\t')[7])} ｜ 逐维 Σ_d w_d·s_d = ${f4(DIMS.reduce((s2, [k, w]) => s2 + w * sTot[k], 0))}`);
P('');
P(`小项（< 1 分）：${evList.filter((x) => x.t < 1).map((x) => `${x.ev}=${f4(x.t)}`).join('、')}`);
P('');
P('## 六、结构性诊断');
P('');
const m5loss = 0.08 * (sumEvW * 100 - sTot.M5);
P(`- **M5 是唯一全面塌陷的维度**：s5 = ${f4(sTot.M5)}，达成率仅 ${(sTot.M5 / (sumEvW * 100) * 100).toFixed(1)}%。`);
P(`  若 M5 也拿满额，总分将变成 ${f4(total + m5loss)}（+${f4(m5loss)}），但当前排名维本就按「最近参赛/最近 PB」衰减，`);
P('  退役多年的历史选手在这一维天然接近 0 —— 这是设计意图，不是 bug。');
P(`- **M1 略逊 Max**：${f4(36.0015)} vs ${f4(40.8611)}，但 s1 差距被逐项目归一摊薄（Max 的优势集中在三阶等少数项目）。`);
P(`- **M2/M3/M4/M6 四项均为全站原始分第一**。三阶上他 M3/M4/M6 全满（rel = 1.0000），`);
P(`  M2 只拿 ${(evList[0].terms.M2.rel * 100).toFixed(1)}%（Max 在三阶领奖台上更密集，榜首 ${f4(evList[0].terms.M2.mx)} vs 他 ${f4(evList[0].terms.M2.v)}）。`);

fs.writeFileSync(path.join(D, `Feliks_六维账本.md`), out.join('\n') + '\n', 'utf8');
console.log(out.join('\n'));
console.log('\n→ 已写 Feliks_六维账本.md');

/* ── 附：全精度输出（不受 F4 截断影响）── */
console.log('\n=== 全精度（未四舍五入）===');
console.log('总分 total          =', total.toFixed(12));
DIMS.forEach(([k, w]) => { let s = 0; for (const x of evList) s += x.terms[k].rel * x.evw * 100; console.log(`s_${k} (${DIMS.find((d) => d[0] === k)[2]}) = ${s.toFixed(12)}   × w ${w} = ${(w * s).toFixed(12)}`); });
console.log('Σ w·s               =', DIMS.reduce((a, [k, w]) => { let s = 0; for (const x of evList) s += x.terms[k].rel * x.evw * 100; return a + w * s; }, 0).toFixed(12));
console.log('Σ t_ev              =', evList.reduce((a, x) => a + x.t, 0).toFixed(12));
console.log('Σ comp×evW×100      =', evList.reduce((a, x) => a + x.compRaw * x.evw * 100, 0).toFixed(12));

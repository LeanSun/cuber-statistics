'use strict';
/* =============================================================================
 * M6 候选新口径 · 诊断 v1：「领先性」（Leading Margin）
 * -----------------------------------------------------------------------------
 * 用户 2026-10-25 提出：M6「对手强度」不合适，改换思考方式 ——
 *   「该选手在刷新 WR 时，这个成绩领先原先的 WR 的幅度，即领先性」
 *
 * 本脚本只做诊断，不定稿、不改任何已封存文件。
 *
 * 核心问题：能不能从现有数据重建出「每一次刷新纪录时，领先前纪录多少」？
 *
 * 数据源候选：
 *   A) js/data.js 的 p.records（55,244 条，每人每 ev|type|level 最多 29 条）
 *      —— WCA 官方纪录表，粒度 = 持有段边界，value 是格式化字符串
 *   B) WCA_export_results.tsv（6,976,879 行）
 *      —— 逐场逐轮原始成绩，可重建完整链条，但 665MB 需流式扫
 *
 * 本脚本先走 A（快），验证链条与语义；B 在 v2 里做（重扫）。
 *
 * 关键设计点（与 M1 的区别）：
 *   M1 = Σ段 [ gain(G/G_ref) × 持有时长/365 × V_L × ρ_s × f_L × w_e ]
 *        → 量「守得多稳」（持续性）
 *   新M6 = Σ刷新 [ ln(前纪录 / 新纪录) ]  ← 只量「突破瞬间的力度」
 *        → 量「打得狠」（一次性冲击）
 *   两者共用 gainOf 数学，但剥离了时长因子 → 预期正交而非重复计分
 *
 * 运行：node --max-old-space-size=8192 etl/score/m6b_diag1.js
 * ============================================================================= */
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '../..');
global.window = {};
require(path.join(ROOT, 'js/data.js'));
const RN = require(path.join(ROOT, 'etl/score/runs.js'));
const CL = require(path.join(ROOT, 'js/calc.js'));

const P = global.window.MOCK.players;
const F = (x, n = 4) => Number(x).toFixed(n);
const num = (x) => Number(x).toLocaleString('en-US');

/* ── 1. 收集全部 records ── */
const rows = [];
for (const p of P) {
  for (const x of p.records || []) {
    if (!x.date || !x.ev || !x.type || !x.level) continue;
    rows.push({
      pid: p.id, name: p.name, country: p.country,
      ev: x.ev, type: x.type, level: x.level, rr: x.rr,
      day: RN.dayOf(x.date), date: x.date, value: x.value,
      held: x.held || 0, current: !!x.current, comp: x.comp,
    });
  }
}
console.log(`records 总数 = ${num(rows.length)}`);

/* ── 2. 建「刷新链条」：key = ev|type|level|scope ──
 *   scope：WR → 'WW'（全球）；CR → 洲；NR → 国家
 *   与 M1 score_record.js 的 buckets 完全一致，保证可比
 */
const buckets = {};
for (const r of rows) {
  const cont = CL.contOfIso(r.country) || '??';
  const scope = r.level === 'WR' ? 'WW' : (r.level === 'CR' ? cont : r.country);
  const k = r.ev + '|' + r.type + '|' + r.level + '|' + scope;
  (buckets[k] = buckets[k] || { ev: r.ev, type: r.type, level: r.level, scope, subs: [] }).subs.push(r);
}

console.log(`链条桶数 = ${num(Object.keys(buckets).length)}`);

/* ── 3. 每个桶内按时间排序，解析 cost，算「每次刷新」的领先幅度 ── */
const chains = [];
for (const k of Object.keys(buckets)) {
  const b = buckets[k];
  const list = b.subs.map((s) => {
    const pr = RN.parseResult ? RN.parseResult(b.ev, b.type, s.value) : null;
    return pr ? { ...s, cost: pr.cost, tie: pr.tie, score: pr.score, kind: pr.kind } : null;
  }).filter(Boolean);
  if (!list.length) continue;
  list.sort((x, y) => x.day - y.day || x.cost - y.cost || x.tie - y.tie);

  /* 去重 + 剔除噪声（同日取更好；非进步条目剔除）——与 buildLadder 同源 */
  const kept = [];
  for (const s of list) {
    const last = kept[kept.length - 1];
    if (last && last.day === s.day) {
      if (s.cost < last.cost || (s.cost === last.cost && s.tie < last.tie)) kept[kept.length - 1] = s;
      continue;
    }
    if (last && !(s.cost < last.cost || (s.cost === last.cost && s.tie < last.tie))) continue;
    kept.push(s);
  }
  if (kept.length < 2) continue;

  /* ★ 关键：每一条 kept 都是一次「刷新」，其 gain = ln(前纪录 / 新纪录) */
  const events = [];
  for (let i = 1; i < kept.length; i++) {
    const g = RN.gainOf(kept[i - 1], kept[i], { tieWeight: 1 });
    events.push({
      pid: kept[i].pid, name: kept[i].name, country: kept[i].country,
      ev: b.ev, type: b.type, level: b.level, scope: b.scope,
      day: kept[i].day, date: kept[i].date, comp: kept[i].comp,
      prevVal: kept[i - 1].value, newVal: kept[i].value,
      gain: g, kind: kept[i].kind,
      samePerson: kept[i].pid === kept[i - 1].pid,
    });
  }
  chains.push({ key: k, ev: b.ev, type: b.type, level: b.level, scope: b.scope, nKept: kept.length, events });
}

/* ── 4. 规模统计 ── */
const allEvents = [];
for (const c of chains) for (const e of c.events) allEvents.push(e);
console.log(`\n=== 规模 ===`);
console.log(`链条（有 >=2 次刷新）= ${num(chains.length)}`);
console.log(`刷新事件总数 = ${num(allEvents.length)}`);
const byLv = {};
for (const e of allEvents) byLv[e.level] = (byLv[e.level] || 0) + 1;
console.log('按级别:', byLv);
const selfRefresh = allEvents.filter((e) => e.samePerson).length;
console.log(`其中「自我连续刷新」(同一人接着刷自己的纪录) = ${num(selfRefresh)} (${F(selfRefresh / allEvents.length * 100, 2)}%)`);

/* ── 5. gain 分布 ── */
const gains = allEvents.map((e) => e.gain).filter((g) => Number.isFinite(g) && g > 0);
gains.sort((a, b) => a - b);
const pct = (p) => gains[Math.min(gains.length - 1, Math.floor(gains.length * p))];
console.log(`\n=== 领先幅度 gain = ln(前纪录/新纪录) 分布 (n=${num(gains.length)}) ===`);
console.log(`  min=${F(gains[0], 6)}  p1=${F(pct(0.01), 6)}  p10=${F(pct(0.10), 6)}  p25=${F(pct(0.25), 6)}`);
console.log(`  中位=${F(pct(0.5), 6)}  p75=${F(pct(0.75), 6)}  p90=${F(pct(0.90), 6)}  p99=${F(pct(0.99), 6)}  max=${F(gains[gains.length - 1], 6)}`);
console.log(`  含义：中位 ${F((Math.exp(pct(0.5)) - 1) * 100, 3)}% / p90 ${F((Math.exp(pct(0.90)) - 1) * 100, 3)}% / max ${F((Math.exp(gains[gains.length - 1]) - 1) * 100, 2)}%`);

/* ── 6. 按项目看 chain 数与中位 gain ── */
console.log(`\n=== 各项目链条与中位领先幅度 ===`);
const byEv = {};
for (const c of chains) {
  const g = c.events.map((e) => e.gain).filter((x) => x > 0).sort((a, b) => a - b);
  if (!g.length) continue;
  const k = c.ev + '|' + c.type + '|' + c.level;
  (byEv[k] = byEv[k] || { ev: c.ev, type: c.type, level: c.level, chains: 0, evs: 0, gains: [] });
  byEv[k].chains++; byEv[k].evs += c.events.length; byEv[k].gains.push(...g);
}
const evRows = Object.values(byEv).map((x) => {
  const s = x.gains.sort((a, b) => a - b);
  return { ...x, med: s[Math.floor(s.length / 2)], max: s[s.length - 1] };
}).sort((a, b) => b.evs - a.evs);
for (const x of evRows) {
  console.log(`  ${x.ev.padEnd(8)} ${x.type.padEnd(6)} ${x.level}  链=${String(x.chains).padStart(3)}  刷新=${String(x.evs).padStart(4)}  中位gain=${F(x.med, 5)} (${F((Math.exp(x.med) - 1) * 100, 3)}%)  max=${F(x.max, 5)}`);
}

/* ── 7. 按选手聚合（sum 口径，先看原始量级）── */
const agg = new Map();
for (const e of allEvents) {
  if (!(e.gain > 0)) continue;
  let a = agg.get(e.pid);
  if (!a) { a = { pid: e.pid, name: e.name, country: e.country, sum: 0, n: 0, wr: 0, cr: 0, nr: 0, max: 0 }; agg.set(e.pid, a); }
  a.sum += e.gain; a.n++;
  if (e.level === 'WR') a.wr++; else if (e.level === 'CR') a.cr++; else a.nr++;
  if (e.gain > a.max) a.max = e.gain;
}
const ranked = [...agg.values()].sort((a, b) => b.sum - a.sum);
console.log(`\n=== 领先性 sum 聚合 · 全站 Top30 (有分 ${num(ranked.length)} 人) ===`);
console.log(`  总量 = ${F(ranked.reduce((s, a) => s + a.sum, 0), 4)}`);
console.log(`  #  选手                          领先性sum   刷新数  WR/CR/NR        最大单次`);
for (let i = 0; i < Math.min(30, ranked.length); i++) {
  const a = ranked[i];
  console.log(`  ${String(i + 1).padStart(2)}. ${(a.name || '').padEnd(28).slice(0, 28)} ${F(a.sum).padStart(10)}  ${String(a.n).padStart(5)}   ${String(a.wr).padStart(3)}/${String(a.cr).padStart(3)}/${String(a.nr).padStart(3)}   ${F(a.max, 5)}`);
}

/* ── 8. 锚点：官方 WR 持有者是否居前？ ── */
const wrHolders = new Set();
for (const e of allEvents) if (e.level === 'WR') wrHolders.add(e.pid);
console.log(`\n=== 锚点检验 ===`);
console.log(`  曾刷新过 WR 的人数 = ${num(wrHolders.size)}`);
const top25 = new Set(ranked.slice(0, 25).map((a) => a.pid));
let hit = 0;
for (const p of wrHolders) if (top25.has(p)) hit++;
console.log(`  WR 刷新者落在领先性 Top25 的 = ${hit} / ${Math.min(wrHolders.size, 25)}`);

/* 三大顶流选手的位置 */
for (const nm of ['Feliks', 'Max', 'Tymon']) {
  const a = ranked.find((x) => (x.name || '').includes(nm));
  if (a) {
    const rk = ranked.indexOf(a) + 1;
    console.log(`  ${nm}: #${rk}  sum=${F(a.sum)}  刷新=${a.n} (WR ${a.wr}/CR ${a.cr}/NR ${a.nr})  最大单次=${F(a.max, 5)}`);
  } else {
    console.log(`  ${nm}: 未上榜`);
  }
}

/* ── 9. 最猛的单次突破 TOP20（诊断用）── */
const byGain = allEvents.filter((e) => e.gain > 0).sort((a, b) => b.gain - a.gain);
console.log(`\n=== 单次最猛突破 TOP20 ===`);
for (let i = 0; i < Math.min(20, byGain.length); i++) {
  const e = byGain[i];
  console.log(`  ${String(i + 1).padStart(2)}. ${(e.name || '').padEnd(26).slice(0, 26)} ${e.ev}/${e.type}/${e.level}  ${e.date}  ${e.prevVal} → ${e.newVal}  gain=${F(e.gain, 5)} (${F((Math.exp(e.gain) - 1) * 100, 2)}%)`);
}

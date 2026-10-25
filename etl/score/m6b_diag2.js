'use strict';
/* =============================================================================
 * M6 候选新口径 · 诊断 v2：链条完整性审计 + WR 专项
 * -----------------------------------------------------------------------------
 * v1 发现的问题：
 *   ① 单次 gain 出现 3614% / 2171% 等荒谬值 → 疑似链条断裂（中间持有者缺失）
 *   ② sum 聚合被「大量小 NR 刷新」支配 → Antonie Paterakis (334 次 NR) 榜首，
 *      而 Feliks (111 次 WR) 只排 #3，WR 刷新者落 Top25 仅 5/25
 *   ③ 自我连续刷新占 56.35% → 需确认是真实（一人多刷）还是数据噪声
 *
 * 本脚本：审计链条完整性 → 量化伪增益 → WR 专项 → 层级拆分
 *
 * 运行：node --max-old-space-size=8192 etl/score/m6b_diag2.js
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

/* ── 建链条（与 v1 同逻辑，提取为函数）── */
function buildChains() {
  const rows = [];
  for (const p of P) {
    for (const x of p.records || []) {
      if (!x.date || !x.ev || !x.type || !x.level) continue;
      rows.push({
        pid: p.id, name: p.name, country: p.country,
        ev: x.ev, type: x.type, level: x.level,
        day: RN.dayOf(x.date), date: x.date, value: x.value,
        held: x.held || 0, current: !!x.current, comp: x.comp,
      });
    }
  }
  const buckets = {};
  for (const r of rows) {
    const cont = CL.contOfIso(r.country) || '??';
    const scope = r.level === 'WR' ? 'WW' : (r.level === 'CR' ? cont : r.country);
    const k = r.ev + '|' + r.type + '|' + r.level + '|' + scope;
    (buckets[k] = buckets[k] || { ev: r.ev, type: r.type, level: r.level, scope, subs: [] }).subs.push(r);
  }
  const chains = [];
  for (const k of Object.keys(buckets)) {
    const b = buckets[k];
    const list = b.subs.map((s) => {
      const pr = RN.parseResult(b.ev, b.type, s.value);
      return pr ? { ...s, cost: pr.cost, tie: pr.tie, score: pr.score, kind: pr.kind } : null;
    }).filter(Boolean);
    if (!list.length) continue;
    list.sort((x, y) => x.day - y.day || x.cost - y.cost || x.tie - y.tie);
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
    const events = [];
    for (let i = 1; i < kept.length; i++) {
      events.push({
        pid: kept[i].pid, name: kept[i].name, country: kept[i].country,
        ev: b.ev, type: b.type, level: b.level, scope: b.scope,
        day: kept[i].day, date: kept[i].date, comp: kept[i].comp,
        prevVal: kept[i - 1].value, newVal: kept[i].value,
        prevCost: kept[i - 1].cost, newCost: kept[i].cost,
        gain: RN.gainOf(kept[i - 1], kept[i], { tieWeight: 1 }),
        samePerson: kept[i].pid === kept[i - 1].pid,
        prevName: kept[i - 1].name, prevDate: kept[i - 1].date,
      });
    }
    chains.push({ key: k, ev: b.ev, type: b.type, level: b.level, scope: b.scope, kept, events });
  }
  return { chains, rows };
}

const { chains, rows } = buildChains();
const allEv = [];
for (const c of chains) for (const e of c.events) allEv.push(e);

/* ═══ 审计 1：伪增益 —— 单步 gain 超过阈值 = 链条断了 ═══ */
console.log('═'.repeat(78));
console.log('审计 1 · 伪增益（单步 gain 异常大 = 链条中间缺环）');
console.log('═'.repeat(78));
const TH = [0.10, 0.20, 0.50, 1.00];
console.log('  单步 gain 阈值 | 事件数 | 占比 | 其中 WR | 其中 CR | 其中 NR');
for (const t of TH) {
  const hit = allEv.filter((e) => e.gain > t);
  const w = hit.filter((e) => e.level === 'WR').length;
  const c = hit.filter((e) => e.level === 'CR').length;
  const n = hit.filter((e) => e.level === 'NR').length;
  console.log(`  > ${F(t * 100, 0).padStart(4)}%        | ${String(hit.length).padStart(6)} | ${F(hit.length / allEv.length * 100, 2).padStart(5)}% | ${String(w).padStart(7)} | ${String(c).padStart(7)} | ${String(n).padStart(7)}`);
}

/* WR 链条里最大的几步 —— 逐条看是否合理 */
const wrBig = allEv.filter((e) => e.level === 'WR').sort((a, b) => b.gain - a.gain).slice(0, 15);
console.log('\n  WR 链最大的 15 步（人工核验合理性）：');
for (const e of wrBig) {
  console.log(`    ${e.ev}/${e.type}  ${e.date}  ${e.prevVal} → ${e.newVal}  gain=${F(e.gain, 5)} (${F((Math.exp(e.gain) - 1) * 100, 2)}%)  ${e.prevName} → ${e.name}`);
}

/* ═══ 审计 2：抽查一条断裂链条的原始条目 ═══ */
console.log('\n' + '='.repeat(78));
console.log('审计 2 · 链条完整性抽查（找 gain>100% 的链条，打印其全部 kept 条目）');
console.log('='.repeat(78));
const brokenChains = chains.filter((c) => c.events.some((e) => e.gain > 1.0));
console.log(`  含 >100% 单步的链条 = ${brokenChains.length} / ${chains.length}`);
for (const c of brokenChains.slice(0, 3)) {
  console.log(`\n  ▸ ${c.key}  (kept=${c.kept.length})`);
  for (const s of c.kept) {
    console.log(`      ${s.date}  ${(s.name || '').padEnd(26).slice(0, 26)}  ${String(s.value).padEnd(10)}  cost=${s.cost}  held=${s.held}`);
  }
}

/* ═══ 审计 3：NR 链条的 scope 是否完整 —— 同国条目是否被拆散 ═══ */
console.log('\n' + '='.repeat(78));
console.log('审计 3 · 「held」字段 vs 链条相邻差（held 应 ≈ 到下一条的间隔）');
console.log('='.repeat(78));
let ok = 0, bad = 0, samples = [];
for (const c of chains) {
  for (let i = 0; i < c.kept.length - 1; i++) {
    const a = c.kept[i], b = c.kept[i + 1];
    const gap = b.day - a.day;
    if (Math.abs(gap - (a.held || 0)) <= 2) ok++;
    else { bad++; if (samples.length < 8) samples.push({ c: c.key, a, b, gap }); }
  }
}
console.log(`  held 与链条间隔一致 = ${num(ok)}，不一致 = ${num(bad)} (${F(bad / (ok + bad) * 100, 2)}%)`);
for (const s of samples) {
  console.log(`    ${s.c}: ${s.a.date} ${s.a.name}(held=${s.a.held}) → ${s.b.date} ${s.b.name}  实际间隔=${s.gap}`);
}

/* ═══ 审计 4：WR 专项 —— 用户明确说的是「刷新 WR」 ═══ */
console.log('\n' + '='.repeat(78));
console.log('审计 4 · WR 专项（用户原话：刷新WR时领先原先WR的幅度）');
console.log('='.repeat(78));
const wrEv = allEv.filter((e) => e.level === 'WR' && e.gain > 0);
const wrAgg = new Map();
for (const e of wrEv) {
  let a = wrAgg.get(e.pid);
  if (!a) { a = { pid: e.pid, name: e.name, country: e.country, sum: 0, n: 0, max: 0, evs: new Set() }; wrAgg.set(e.pid, a); }
  a.sum += e.gain; a.n++; a.evs.add(e.ev + '|' + e.type);
  if (e.gain > a.max) a.max = e.gain;
}
const wrRank = [...wrAgg.values()].sort((a, b) => b.sum - a.sum);
console.log(`  WR 刷新事件 = ${num(wrEv.length)}，参与人数 = ${num(wrRank.length)}`);
console.log(`  gain 分布：中位 ${F(wrEv.map((e) => e.gain).sort((a, b) => a - b)[Math.floor(wrEv.length / 2)], 5)}  max ${F(Math.max(...wrEv.map((e) => e.gain)), 5)}`);
console.log(`\n  WR 领先性 Top30:`);
console.log(`  #  选手                          sum      刷新数  项目数   最大单次   中位单次`);
for (let i = 0; i < Math.min(30, wrRank.length); i++) {
  const a = wrRank[i];
  const mine = wrEv.filter((e) => e.pid === a.pid).map((e) => e.gain).sort((x, y) => x - y);
  console.log(`  ${String(i + 1).padStart(2)}. ${(a.name || '').padEnd(28).slice(0, 28)} ${F(a.sum).padStart(9)}  ${String(a.n).padStart(5)}  ${String(a.evs.size).padStart(5)}   ${F(a.max, 5)}   ${F(mine[Math.floor(mine.length / 2)], 5)}`);
}

/* ═══ 审计 5：层级贡献占比 —— sum 是否被 NR 淹没 ═══ */
console.log('\n' + '='.repeat(78));
console.log('审计 5 · 层级贡献（若做 sum，NR 占比多少？）');
console.log('='.repeat(78));
const byLvAgg = {};
for (const e of allEv) {
  if (!(e.gain > 0)) continue;
  (byLvAgg[e.level] = byLvAgg[e.level] || { sum: 0, n: 0, ppl: new Set() });
  byLvAgg[e.level].sum += e.gain; byLvAgg[e.level].n++; byLvAgg[e.level].ppl.add(e.pid);
}
const tot = Object.values(byLvAgg).reduce((s, x) => s + x.sum, 0);
for (const L of ['WR', 'CR', 'NR']) {
  const x = byLvAgg[L];
  console.log(`  ${L}: sum=${F(x.sum).padStart(10)} (${F(x.sum / tot * 100, 2)}%)  事件=${String(x.n).padStart(6)}  人数=${num(x.ppl.size)}`);
}

/* ═══ 审计 6：三种聚合口径横向对照（顶层 20 的重合）═══ */
console.log('\n' + '='.repeat(78));
console.log('审计 6 · 聚合口径横向对照');
console.log('='.repeat(78));
function aggBy(fn) {
  const m = new Map();
  for (const e of allEv) {
    const v = fn(e);
    if (v == null || !Number.isFinite(v) || v <= 0) continue;
    let a = m.get(e.pid);
    if (!a) { a = { pid: e.pid, name: e.name, sum: 0, n: 0 }; m.set(e.pid, a); }
    a.sum += v; a.n++;
  }
  return [...m.values()].sort((a, b) => b.sum - a.sum);
}
const CAP = 0.5;   // 单次上限：ln(1.5)=0.405 附近，砍掉 >150% 的伪增益
const variants = {
  'A 原始sum': (e) => e.gain,
  'B 单次截顶0.5': (e) => Math.min(e.gain, CAP),
  'C 截顶+仅WR': (e) => (e.level === 'WR' ? Math.min(e.gain, CAP) : 0),
  'D 截顶+WR权重2': (e) => (e.level === 'WR' ? Math.min(e.gain, CAP) * 2 : Math.min(e.gain, CAP)),
  'E 只算夺权(非自我)': (e) => (e.samePerson ? 0 : Math.min(e.gain, CAP)),
};
const tops = {};
for (const [k, fn] of Object.entries(variants)) {
  const r = aggBy(fn);
  tops[k] = r;
  console.log(`  ${k.padEnd(22)} 人数=${String(r.length).padStart(6)}  总量=${F(r.reduce((s, a) => s + a.sum, 0)).padStart(11)}  Top5: ${r.slice(0, 5).map((a) => (a.name || '').split(' ')[0]).join(', ')}`);
}
console.log('\n  两两 Top20 重合数：');
const ks = Object.keys(tops);
for (let i = 0; i < ks.length; i++) {
  for (let j = i + 1; j < ks.length; j++) {
    const A = new Set(tops[ks[i]].slice(0, 20).map((a) => a.pid));
    const B = new Set(tops[ks[j]].slice(0, 20).map((a) => a.pid));
    let h = 0; for (const x of A) if (B.has(x)) h++;
    console.log(`    ${ks[i].padEnd(22)} vs ${ks[j].padEnd(22)} = ${h}/20`);
  }
}

/* ═══ 审计 7：WR-only 口径下的锚点 ═══ */
console.log('\n' + '='.repeat(78));
console.log('审计 7 · WR-only 口径的锚点检验');
console.log('='.repeat(78));
const wrTop = tops['C 截顶+仅WR'];
const top20 = new Set(wrTop.slice(0, 20).map((a) => a.pid));
console.log(`  WR 刷新者共 ${num(wrAgg.size)} 人，其中落在 WR 领先性 Top20 = ${[...wrAgg.keys()].filter((p) => top20.has(p)).length}`);
for (const nm of ['Feliks', 'Max', 'Tymon', 'Stanley', 'Kimberley']) {
  const a = wrTop.find((x) => (x.name || '').includes(nm));
  if (a) console.log(`  ${nm}: #${wrTop.indexOf(a) + 1}  sum=${F(a.sum)}  刷新=${a.n}`);
  else {
    const b = wrAgg.get([...wrAgg.keys()].find((k) => (wrAgg.get(k).name || '').includes(nm)));
    console.log(`  ${nm}: 不在 WR 领先性榜（WR 刷新 ${b ? b.n : 0} 次，sum ${b ? F(b.sum) : '-'}${b ? '，rank #' + (wrRank.indexOf(b) + 1) : ''}）`);
  }
}

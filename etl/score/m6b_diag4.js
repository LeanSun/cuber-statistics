'use strict';
/* =============================================================================
 * M6 候选新口径 · 诊断 v4：单位修正 + 轮次排序 + 全级别（WR/CR/NR）
 * -----------------------------------------------------------------------------
 * v3 的两个 bug：
 *   [bugA] **单位错**：results.tsv 的 best/average 是**毫秒 / 步数 / multi编码值**，
 *          不是 js/data.js 里的格式化文本（"1:08.05"）。v3 用 clockSec 解析
 *          "3897" 得到 3897 秒（实际 3897 ms = 3.897 秒）。
 *          → 比率 gain 不受影响（同单位），但绝对值展示错、multi 完全错。
 *   [bugB] **同场多轮次排序**：同一(比赛,项目)可能有多条 WR 标记（分轮），
 *          v3 用 `date, cost` 排序，同日同场会错序 → 产生 104 条非单调。
 *          → 必须按 (日期, 轮次序) 排序，轮次内再按 cost。
 *
 * 本脚本：
 *   1) 修正归一：time→ms 原值、moves→原值、multi→decodeMulti
 *   2) 修正排序：按 (比赛日期, 轮次先后, cost)
 *   3) 扩展到全级别（WR / 洲纪录 ER/AsR/SAR/OcR/AfR / NR）
 *      —— 洲纪录和国纪录的链条在 records 里缺环（v2 已证），必须从原始重建
 *   4) 对比 v1/v3 结果，做回归校验
 *
 * 运行：node --max-old-space-size=8192 etl/score/m6b_diag4.js
 * ============================================================================= */
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const ROOT = path.resolve(__dirname, '../..');
const ZIP = path.join(ROOT, 'data/raw/WCA_export_v2_288_20261015T000017Z.tsv.zip');
const TMP = path.join(ROOT, '.workbuddy/tmp/oc');

const t0 = Date.now();
const stamp = (l) => console.log(`  [${((Date.now() - t0) / 1000).toFixed(1)}s] ${l}`);
const mem = () => (process.memoryUsage().heapUsed / 1048576).toFixed(0) + ' MB';
const F = (x, n = 4) => Number(x).toFixed(n);
const num = (x) => Number(x).toLocaleString('en-US');

function zipStream(entry, onLine) {
  return new Promise((resolve, reject) => {
    const child = spawn('unzip', ['-p', ZIP, entry], { stdio: ['ignore', 'pipe', 'ignore'] });
    let buf = '', head = true;
    child.stdout.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, '');
        buf = buf.slice(nl + 1);
        if (head) { head = false; continue; }
        if (line.trim()) onLine(line.split('\t'));
      }
    });
    child.stdout.on('end', resolve);
    child.on('error', reject);
  });
}

/* multi 解码 —— 与 m4_dominance.js / m6_strength.js 逐字一致 */
function decodeMulti(v) {
  if (v < 1e9) {
    const S = String(v).padStart(10, '0');
    const DD = +S.slice(1, 3), TT = Math.min(+S.slice(3, 8), 99999);
    const diff = 99 - DD;
    return (99 - diff) * 1e5 + TT;
  }
  const S = String(v);
  const SS = +S.slice(1, 3), AA = +S.slice(3, 5), TT = Math.min(+S.slice(5, 10), 99999);
  const solved = 99 - SS, missed = AA - solved, diff = solved - missed;
  return (99 - diff) * 1e5 + TT;
}

/* ★ 轮次先后序：同一场比赛里，资格赛 → 一轮 → 二轮 → 三轮 → 决赛
 *   WCA round_type：0 资格 / h 资格 / d 一轮 / 1 一轮 / e 二轮 / 2 二轮
 *                   3 半决赛 / g 半决赛 / b B组决赛 / c 决赛 / f 决赛
 *   同一 final 标记的 c/f 只会有一个用于该赛事。 */
const RT_ORDER = {
  '0': 0, 'h': 0, 'd': 1, '1': 1, 'e': 2, '2': 2, '3': 3, 'g': 3, 'b': 4, 'c': 5, 'f': 5,
};

/* 纪录标记 → 级别 + 范围 */
const MARK_LEVEL = {
  'WR': { level: 'WR', scope: 'WW' },
  'ER': { level: 'CR', scope: 'EU' },
  'AsR': { level: 'CR', scope: 'AS' },
  'SAR': { level: 'CR', scope: 'SA' },
  'OcR': { level: 'CR', scope: 'OC' },
  'AfR': { level: 'CR', scope: 'AF' },
  'NAR': { level: 'NR', scope: 'NA' },
  'NR': { level: 'NR', scope: 'NR' },
};

async function main() {
  /* ═══ S0 元信息 ═══ */
  const compDate = new Map(), compYear = new Map(), compCtry = new Map();
  {
    const lines = fs.readFileSync(path.join(TMP, 'WCA_export_competitions.tsv'), 'utf8').split('\n');
    const ix = {}; lines[0].split('\t').forEach((c, i) => ix[c] = i);
    for (let i = 1; i < lines.length; i++) {
      const p = lines[i].split('\t');
      if (!p[ix.id]) continue;
      const d = p[ix.day] && p[ix.month] && p[ix.year]
        ? `${p[ix.year]}-${String(p[ix.month]).padStart(2, '0')}-${String(p[ix.day]).padStart(2, '0')}`
        : `${p[ix.year]}-01-01`;
      compDate.set(p[ix.id], d);
      compYear.set(p[ix.id], +p[ix.year]);
      compCtry.set(p[ix.id], p[ix.country_id]);
    }
  }
  const EV_FMT = new Map();
  {
    const lines = fs.readFileSync(path.join(TMP, 'WCA_export_events.tsv'), 'utf8').trim().split('\n');
    const ix = {}; lines[0].split('\t').forEach((c, i) => ix[c] = i);
    for (let i = 1; i < lines.length; i++) EV_FMT.set(lines[i][ix.id], lines[i][ix.format]);
  }
  const pname = new Map(), pctr = new Map();
  await zipStream('WCA_export_persons.tsv', (p) => { if (p[2]) { pname.set(p[2], p[0]); pctr.set(p[2], p[7]); } });
  stamp(`S0 比赛=${num(compDate.size)} persons=${num(pname.size)}`);

  /* ★ 归一标量：lower = better。
   *   time   → 毫秒（results.tsv 原值就是 ms）
   *   moves  → 步数（原值）
   *   multi  → decodeMulti（编码值不同向，必须解码）*/
  const normVal = (eid, raw) => {
    const v = +raw;
    if (!(v > 0)) return null;
    const f = EV_FMT.get(eid);
    if (f === 'multi') return decodeMulti(v);
    return v;
  };

  /* ═══ S1 扫 results：取所有带纪录标记的行 ═══ */
  const recs = [];
  let nRows = 0;
  await zipStream('WCA_export_results.tsv', (p) => {
    nRows++;
    const pid = p[8], eid = p[6], cid = p[4], rt = p[5];
    if (!pid || !eid || !cid) return;
    const c = compDate.get(cid);
    if (!c) return;
    const yr = compYear.get(cid);
    const ms = p[10], ma = p[11];
    if (ms && ms !== 'NULL') {
      const mk = MARK_LEVEL[ms];
      if (mk) {
        const cost = normVal(eid, p[2]);
        if (cost != null) recs.push({ pid, eid, cid, rt, date: c, yr, kind: 'single', raw: p[2], cost, mark: ms, level: mk.level, scope: mk.scope, ctry: pctr.get(pid) });
      }
    }
    if (ma && ma !== 'NULL') {
      const mk = MARK_LEVEL[ma];
      if (mk) {
        const cost = normVal(eid, p[3]);
        if (cost != null) recs.push({ pid, eid, cid, rt, date: c, yr, kind: 'avg', raw: p[3], cost, mark: ma, level: mk.level, scope: mk.scope, ctry: pctr.get(pid) });
      }
    }
  });
  stamp(`S1 rows=${num(nRows)} 标记行=${num(recs.length)} 堆=${mem()}`);

  /* ═══ S2 建链条 ═══
   * key：
   *   WR → ev|kind|WR|WW
   *   CR → ev|kind|CR|scope(洲)
   *   NR → ev|kind|NR|国家
   */
  const chains = new Map();
  for (const r of recs) {
    let scope = r.scope;
    if (r.level === 'NR') scope = r.ctry || '??';
    const k = r.eid + '|' + r.kind + '|' + r.level + '|' + scope;
    let a = chains.get(k);
    if (!a) { a = []; chains.set(k, a); }
    a.push(r);
  }
  console.log(`\n链条数 = ${num(chains.size)}`);

  /* 排序：(比赛日期, 轮次序, cost) —— 同日多轮按比赛先后 */
  const allEvents = [];
  let nonMono = 0;
  for (const [k, arr] of chains) {
    arr.sort((x, y) => {
      if (x.date !== y.date) return x.date < y.date ? -1 : 1;
      const ro = (RT_ORDER[x.rt] == null ? 9 : RT_ORDER[x.rt]) - (RT_ORDER[y.rt] == null ? 9 : RT_ORDER[y.rt]);
      if (ro !== 0) return ro;
      return x.cost - y.cost;
    });
    for (let i = 1; i < arr.length; i++) {
      const prev = arr[i - 1], cur = arr[i];
      if (!(cur.cost < prev.cost)) { nonMono++; continue; }
      allEvents.push({
        pid: cur.pid, name: pname.get(cur.pid) || '', eid: cur.eid, kind: cur.kind,
        level: cur.level, scope: cur.scope, date: cur.date, yr: cur.yr, rt: cur.rt, cid: cur.cid,
        prevCost: prev.cost, newCost: cur.cost,
        gain: Math.log(prev.cost / cur.cost),
        samePerson: cur.pid === prev.pid,
        prevName: pname.get(prev.pid) || '', prevDate: prev.date,
        prevRt: prev.rt, curRt: cur.rt,
      });
    }
  }
  console.log(`非单调跳过 = ${num(nonMono)}`);
  console.log(`★ 刷新事件总数 = ${num(allEvents.length)}`);
  const byLv = {};
  for (const e of allEvents) byLv[e.level] = (byLv[e.level] || 0) + 1;
  console.log('按级别:', byLv);

  /* ═══ S3 WR 专项（用户原话的核心）═══ */
  console.log('\n' + '='.repeat(76));
  console.log('S3 · WR 专项：刷新 WR 时的领先幅度');
  console.log('='.repeat(76));
  const wrEv = allEvents.filter((e) => e.level === 'WR');
  const wrG = wrEv.map((e) => e.gain).filter((g) => g > 0).sort((a, b) => a - b);
  const wp = (p) => wrG[Math.min(wrG.length - 1, Math.floor(wrG.length * p))];
  console.log(`  WR 事件 = ${num(wrEv.length)}`);
  console.log(`  gain: min=${F(wrG[0], 6)} p25=${F(wp(0.25), 6)} 中位=${F(wp(0.5), 6)} p75=${F(wp(0.75), 6)} p95=${F(wp(0.95), 6)} p99=${F(wp(0.99), 6)} max=${F(wrG[wrG.length - 1], 6)}`);
  console.log(`  百分比：中位 ${F((Math.exp(wp(0.5)) - 1) * 100, 3)}%  p95 ${F((Math.exp(wp(0.95)) - 1) * 100, 2)}%  max ${F((Math.exp(wrG[wrG.length - 1]) - 1) * 100, 2)}%`);

  /* 同场多轮次的情况 */
  const sameDay = wrEv.filter((e) => e.prevDate === e.date).length;
  const sameComp = wrEv.filter((e) => e.cid === e.prevCid).length;
  console.log(`  其中「与前一条同日」= ${num(sameDay)}，「与前一条同场」= ${num(wrEv.length - sameDay)}`);

  /* ═══ S4 聚合榜单：三种口径 ═══ */
  console.log('\n' + '='.repeat(76));
  console.log('S4 · 聚合口径横向对照');
  console.log('='.repeat(76));
  function aggBy(fn) {
    const m = new Map();
    for (const e of allEvents) {
      const v = fn(e);
      if (v == null || !Number.isFinite(v) || v <= 0) continue;
      let a = m.get(e.pid);
      if (!a) { a = { pid: e.pid, name: e.name, sum: 0, n: 0, max: 0, wr: 0, cr: 0, nr: 0, evs: new Set() }; m.set(e.pid, a); }
      a.sum += v; a.n++; a.evs.add(e.eid + '|' + e.kind);
      if (e.level === 'WR') a.wr++; else if (e.level === 'CR') a.cr++; else a.nr++;
      if (v > a.max) a.max = v;
    }
    return [...m.values()].sort((a, b) => b.sum - a.sum);
  }
  const CAP = 0.5;
  const VARIANTS = {
    'A 全级别原始sum': (e) => e.gain,
    'B 全级别截顶0.5': (e) => Math.min(e.gain, CAP),
    'C 仅WR': (e) => (e.level === 'WR' ? e.gain : 0),
    'D 仅WR+截顶': (e) => (e.level === 'WR' ? Math.min(e.gain, CAP) : 0),
    'E WR权重3+截顶': (e) => (e.level === 'WR' ? Math.min(e.gain, CAP) * 3 : Math.min(e.gain, CAP)),
    'F 只算夺权(非自我)': (e) => (e.samePerson ? 0 : Math.min(e.gain, CAP)),
  };
  const tops = {};
  for (const [k, fn] of Object.entries(VARIANTS)) {
    const r = aggBy(fn);
    tops[k] = r;
    console.log(`  ${k.padEnd(20)} 人数=${String(r.length).padStart(6)} 总量=${F(r.reduce((s, a) => s + a.sum, 0)).padStart(11)}  Top5: ${r.slice(0, 5).map((a) => (a.name || '').split(' ')[0]).join(', ')}`);
  }

  console.log('\n  三大顶流在各口径下的位置：');
  for (const nm of ['Feliks', 'Max', 'Tymon', 'Stanley Chapel', 'Akkersdijk', 'Kaijun']) {
    const line = [];
    for (const k of Object.keys(VARIANTS)) {
      const r = tops[k];
      const a = r.find((x) => (x.name || '').includes(nm));
      line.push(`${k.split(' ')[0]}=${a ? '#' + (r.indexOf(a) + 1) : '-'}`);
    }
    console.log(`    ${nm.padEnd(16)} ${line.join('  ')}`);
  }

  console.log('\n  两两 Top20 重合：');
  const ks = Object.keys(tops);
  for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++) {
    const A = new Set(tops[ks[i]].slice(0, 20).map((a) => a.pid));
    const B = new Set(tops[ks[j]].slice(0, 20).map((a) => a.pid));
    let h = 0; for (const x of A) if (B.has(x)) h++;
    console.log(`    ${ks[i].padEnd(20)} vs ${ks[j].padEnd(20)} = ${h}/20`);
  }

  /* ═══ S5 单次最猛 TOP20（v4 修正后，人工核验）═══ */
  console.log('\n' + '='.repeat(76));
  console.log('S5 · 单次最猛突破 TOP20（修正单位后）');
  console.log('='.repeat(76));
  const bg = allEvents.slice().sort((a, b) => b.gain - a.gain);
  for (let i = 0; i < Math.min(20, bg.length); i++) {
    const e = bg[i];
    console.log(`  ${String(i + 1).padStart(2)}. ${(e.name || '').padEnd(22).slice(0, 22)} ${e.eid}/${e.kind}/${e.level}  ${e.date}  ${e.prevCost} → ${e.newCost}  gain=${F(e.gain, 5)} (${F((Math.exp(e.gain) - 1) * 100, 2)}%)  ${e.prevName}→${e.name}`);
  }

  /* ═══ S6 自我连续刷新 vs 夺权 ═══ */
  const self = allEvents.filter((e) => e.samePerson).length;
  console.log(`\n自我连续刷新 = ${num(self)} / ${num(allEvents.length)} (${F(self / allEvents.length * 100, 2)}%)`);

  /* ═══ S7 全站榜（口径 D：仅WR+截顶）明细 ═══ */
  console.log('\n' + '='.repeat(76));
  console.log('S7 · 仅WR 领先性 完整榜 Top30');
  console.log('='.repeat(76));
  const d = tops['D 仅WR+截顶'];
  console.log(`  #  选手                          sum      刷新数  项目/轨  最大单次`);
  for (let i = 0; i < Math.min(30, d.length); i++) {
    const a = d[i];
    console.log(`  ${String(i + 1).padStart(2)}. ${(a.name || '').padEnd(28).slice(0, 28)} ${F(a.sum).padStart(9)}  ${String(a.n).padStart(5)}  ${String(a.evs.size).padStart(5)}   ${F(a.max, 5)}`);
  }

  /* ═══ S8 层级贡献 ═══ */
  console.log('\n' + '='.repeat(76));
  console.log('S8 · 层级贡献占比');
  console.log('='.repeat(76));
  const byLvAgg = {};
  for (const e of allEvents) {
    if (!(e.gain > 0)) continue;
    (byLvAgg[e.level] = byLvAgg[e.level] || { sum: 0, n: 0, ppl: new Set() });
    byLvAgg[e.level].sum += e.gain; byLvAgg[e.level].n++; byLvAgg[e.level].ppl.add(e.pid);
  }
  const tot = Object.values(byLvAgg).reduce((s, x) => s + x.sum, 0);
  for (const L of ['WR', 'CR', 'NR']) {
    const x = byLvAgg[L];
    console.log(`  ${L}: sum=${F(x.sum).padStart(10)} (${F(x.sum / tot * 100, 2)}%)  事件=${String(x.n).padStart(6)}  人数=${num(x.ppl.size)}`);
  }

  /* 导出给 v5 做正交性检验 */
  const dump = [];
  for (const [k, r] of Object.entries(VARIANTS)) {
    const tag = k.split(' ')[0];
    for (const a of r) {
      dump.push(`${tag}\t${a.pid}\t${(a.name || '').replace(/\t/g, ' ')}\t${F(a.sum, 6)}\t${a.n}\t${a.wr}\t${a.cr}\t${a.nr}`);
    }
  }
  fs.writeFileSync(path.join(__dirname, 'm6b_aggs.tsv'), dump.join('\n') + '\n', 'utf8');
  console.log('\n→ 已写出 m6b_aggs.tsv 供正交性检验');
}

main().catch((e) => { console.error(e); process.exit(1); });

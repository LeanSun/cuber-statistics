'use strict';
/* =============================================================================
 * M6 候选新口径 · 诊断 v6：修正国家列 + bestOnly，产出各口径分数
 * -----------------------------------------------------------------------------
 * v5 查明三个根因（全部修掉）：
 *
 *  [bug1] **persons.tsv 国家列取错**
 *         表头：name | gender | wca_id | sub_id | country_id
 *         v4/v5 用了 p[7]（不存在 → undefined）→ 所有 NR 塌成一条 `|NR|??`
 *         假链（2,703 条），造成 9359% 假增益 + 28,389 次非单调跳过。
 *         修正：p[4] = country_id。
 *
 *  [bug2] **同场多条标记 ≠ 多次刷新**
 *         同一场比赛里，**不同国家/洲的纪录同时成立**，每条标记各属一条范围线。
 *         例：PolishOpen2007|mmagic|avg 三条标记 = WR(WR线) + NR(波兰) + NR(法国)。
 *         它们分属不同链条 key，不该在同一条链里相邻比较。
 *         修正：范围 key 正确后自然分离；同 key 同场仍多条的，取该场最佳一条。
 *
 *  [bug3] **NAR ≠ NR**
 *         NAR = North American Record（北美纪录），不是 National Record。
 *         它是洲级以下、国级以上的独立层级。
 *         修正：NAR 单列为独立层级，不并入 NR。
 *
 *  ★ 交叉验证：修正后 WR 事件 = 1,193，与 js/data.js records 重建完全一致（误差 0）✓
 *
 * 运行：node --max-old-space-size=8192 etl/score/m6b_diag6.js
 * ============================================================================= */
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const ROOT = path.resolve(__dirname, '../..');
const ZIP = path.join(ROOT, 'data/raw/WCA_export_v2_288_20261015T000017Z.tsv.zip');
const TMP = path.join(ROOT, '.workbuddy/tmp/oc');

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

/* ★ 标记 → (层级, 范围键)
 *   WR  → ('WR','WW')         全球
 *   ER  → ('CR','EU')         欧洲
 *   AsR → ('CR','AS')         亚洲
 *   SAR → ('CR','SA')         南美
 *   OcR → ('CR','OC')         大洋洲
 *   AfR → ('CR','AF')         非洲
 *   NAR → ('NAR','NA')        北美（独立层级，不并入 NR）
 *   NR  → ('NR', <国家>)       国家
 */
function scopeOf(mark, ctry) {
  switch (mark) {
    case 'WR': return { level: 'WR', scope: 'WW' };
    case 'ER': return { level: 'CR', scope: 'EU' };
    case 'AsR': return { level: 'CR', scope: 'AS' };
    case 'SAR': return { level: 'CR', scope: 'SA' };
    case 'OcR': return { level: 'CR', scope: 'OC' };
    case 'AfR': return { level: 'CR', scope: 'AF' };
    case 'NAR': return { level: 'NAR', scope: 'NA' };
    case 'NR': return { level: 'NR', scope: ctry || '??' };
    default: return null;
  }
}

async function main() {
  /* ═══ S0 元信息 ═══ */
  const compDate = new Map(), compYear = new Map();
  {
    const lines = fs.readFileSync(path.join(TMP, 'WCA_export_competitions.tsv'), 'utf8').split('\n');
    const ix = {}; lines[0].split('\t').forEach((c, i) => ix[c] = i);
    for (let i = 1; i < lines.length; i++) {
      const p = lines[i].split('\t');
      if (!p[ix.id]) continue;
      const d = p[ix.day] && p[ix.month] && p[ix.year]
        ? `${p[ix.year]}-${String(p[ix.month]).padStart(2, '0')}-${String(p[ix.day]).padStart(2, '0')}`
        : `${p[ix.year]}-01-01`;
      compDate.set(p[ix.id], d); compYear.set(p[ix.id], +p[ix.year]);
    }
  }
  const EV_FMT = new Map();
  {
    const lines = fs.readFileSync(path.join(TMP, 'WCA_export_events.tsv'), 'utf8').trim().split('\n');
    const ix = {}; lines[0].split('\t').forEach((c, i) => ix[c] = i);
    for (let i = 1; i < lines.length; i++) EV_FMT.set(lines[i][ix.id], lines[i][ix.format]);
  }
  const pname = new Map(), pctr = new Map();
  await zipStream('WCA_export_persons.tsv', (p) => {
    /* 表头：name | gender | wca_id | sub_id | country_id  → 国家是 p[4] */
    if (p[2]) { pname.set(p[2], p[0]); pctr.set(p[2], p[4]); }
  });
  console.log(`persons=${num(pname.size)}  样例国家: ${[...pctr.entries()].slice(0, 3).map(([k, v]) => k + '=' + v).join(', ')}`);

  /* ═══ S1 扫 results ═══ */
  const recs = [];
  let nRows = 0;
  await zipStream('WCA_export_results.tsv', (p) => {
    nRows++;
    const pid = p[8], eid = p[6], cid = p[4];
    if (!pid || !eid || !cid) return;
    const c = compDate.get(cid); if (!c) return;
    const yr = compYear.get(cid);
    const ctry = pctr.get(pid);
    for (const [mkRaw, raw, kind] of [[p[10], p[2], 'single'], [p[11], p[3], 'avg']]) {
      if (!mkRaw || mkRaw === 'NULL') continue;
      const sc = scopeOf(mkRaw, ctry); if (!sc) continue;
      const v = +raw; if (!(v > 0)) continue;
      const cost = EV_FMT.get(eid) === 'multi' ? decodeMulti(v) : v;
      recs.push({ pid, eid, cid, date: c, yr, kind, cost, mark: mkRaw, level: sc.level, scope: sc.scope });
    }
  });
  console.log(`rows=${num(nRows)}  标记行=${num(recs.length)}`);

  /* ═══ S2 建链条：范围 key 正确后，同场多条自然分属不同链 ═══ */
  const chains = new Map();
  for (const r of recs) {
    const k = r.eid + '|' + r.kind + '|' + r.level + '|' + r.scope;
    let a = chains.get(k); if (!a) { a = []; chains.set(k, a); }
    a.push(r);
  }
  const lvChain = {};
  for (const k of chains.keys()) { const p = k.split('|')[2]; lvChain[p] = (lvChain[p] || 0) + 1; }
  console.log(`链条数=${num(chains.size)}  按级别=${JSON.stringify(lvChain)}`);

  /* 同 key 同场多条 → 只取该场最佳一条 */
  const events = [];
  let skipped = 0, dedup = 0;
  for (const [k, arr] of chains) {
    /* 先按 (日期, 场) 归并：同场取最佳 */
    const byDayComp = new Map();
    for (const r of arr) {
      const ck = r.date + '|' + r.cid;
      const cur = byDayComp.get(ck);
      if (!cur) { byDayComp.set(ck, r); continue; }
      dedup++;
      if (r.cost < cur.cost) byDayComp.set(ck, r);
    }
    const seq = [...byDayComp.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.cost - b.cost));
    for (let i = 1; i < seq.length; i++) {
      const prev = seq[i - 1], cur = seq[i];
      if (!(cur.cost < prev.cost)) { skipped++; continue; }
      events.push({
        pid: cur.pid, name: pname.get(cur.pid) || '', eid: cur.eid, kind: cur.kind,
        level: cur.level, scope: cur.scope, date: cur.date, yr: cur.yr,
        prevCost: prev.cost, newCost: cur.cost,
        gain: Math.log(prev.cost / cur.cost),
        samePerson: cur.pid === prev.pid,
        prevName: pname.get(prev.pid) || '', prevDate: prev.date,
      });
    }
  }
  console.log(`同场去重=${num(dedup)}  非单调跳过=${num(skipped)}  ★刷新事件=${num(events.length)}`);
  const byLv = {};
  for (const e of events) byLv[e.level] = (byLv[e.level] || 0) + 1;
  console.log('按级别:', byLv);
  console.log(`\n★ 交叉验证：WR 事件 = ${events.filter((e) => e.level === 'WR').length}（js/data.js records 重建 = 1,193）`);

  /* ═══ S3 gain 分布 ═══ */
  console.log('\n' + '='.repeat(76));
  console.log('S3 · 各层级 gain 分布');
  console.log('='.repeat(76));
  for (const L of ['WR', 'CR', 'NAR', 'NR']) {
    const g = events.filter((e) => e.level === L).map((e) => e.gain).sort((a, b) => a - b);
    if (!g.length) continue;
    const p = (x) => g[Math.min(g.length - 1, Math.floor(g.length * x))];
    console.log(`  ${L.padEnd(4)} n=${String(g.length).padStart(6)}  min=${F(g[0], 5)} p25=${F(p(0.25), 5)} 中位=${F(p(0.5), 5)} p75=${F(p(0.75), 5)} p95=${F(p(0.95), 5)} p99=${F(p(0.99), 5)} max=${F(g[g.length - 1], 5)}`);
    console.log(`       百分比：中位 ${F((Math.exp(p(0.5)) - 1) * 100, 2)}%  p95 ${F((Math.exp(p(0.95)) - 1) * 100, 2)}%  max ${F((Math.exp(g[g.length - 1]) - 1) * 100, 1)}%`);
  }

  /* ═══ S4 聚合口径对照 ═══ */
  console.log('\n' + '='.repeat(76));
  console.log('S4 · 聚合口径横向对照');
  console.log('='.repeat(76));
  function aggBy(fn) {
    const m = new Map();
    for (const e of events) {
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
  const V = {
    'A 全级别原始sum': (e) => e.gain,
    'B 全级别截顶0.5': (e) => Math.min(e.gain, CAP),
    'C 仅WR原始': (e) => (e.level === 'WR' ? e.gain : 0),
    'D 仅WR截顶': (e) => (e.level === 'WR' ? Math.min(e.gain, CAP) : 0),
    'E WR+CR截顶': (e) => (e.level === 'WR' || e.level === 'CR' ? Math.min(e.gain, CAP) : 0),
    'F WR权重2+CR+截顶': (e) => (e.level === 'WR' ? Math.min(e.gain, CAP) * 2 : e.level === 'CR' ? Math.min(e.gain, CAP) : 0),
    'G 只算夺权(非自我)': (e) => (e.samePerson ? 0 : Math.min(e.gain, CAP)),
  };
  const tops = {};
  for (const [k, fn] of Object.entries(V)) {
    const r = aggBy(fn);
    tops[k] = r;
    console.log(`  ${k.padEnd(20)} 人数=${String(r.length).padStart(6)} 总量=${F(r.reduce((s, a) => s + a.sum, 0)).padStart(11)}  Top5: ${r.slice(0, 5).map((a) => (a.name || '').split(' ')[0]).join(', ')}`);
  }

  console.log('\n  三大顶流位置：');
  for (const nm of ['Feliks', 'Max', 'Tymon', 'Stanley Chapel', 'Akkersdijk', 'Kaijun', 'Weyer']) {
    const line = [];
    for (const k of Object.keys(V)) {
      const r = tops[k];
      const a = r.find((x) => (x.name || '').includes(nm));
      line.push(`${k.split(' ')[0]}=${a ? '#' + (r.indexOf(a) + 1) : '-'}`);
    }
    console.log(`    ${nm.padEnd(15)} ${line.join('  ')}`);
  }

  console.log('\n  两两 Top20 重合：');
  const ks = Object.keys(tops);
  for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++) {
    const A = new Set(tops[ks[i]].slice(0, 20).map((a) => a.pid));
    const B = new Set(tops[ks[j]].slice(0, 20).map((a) => a.pid));
    let h = 0; for (const x of A) if (B.has(x)) h++;
    console.log(`    ${ks[i].padEnd(20)} vs ${ks[j].padEnd(20)} = ${h}/20`);
  }

  /* ═══ S5 导出 ═══ */
  const TAGS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
  const dump = [];
  Object.keys(V).forEach((k, i) => {
    const tag = TAGS[i];
    for (const a of tops[k]) dump.push(`${tag}\t${a.pid}\t${(a.name || '').replace(/\t/g, ' ')}\t${F(a.sum, 6)}\t${a.n}\t${a.wr}\t${a.cr}\t${a.nr}`);
  });
  fs.writeFileSync(path.join(__dirname, 'm6b_aggs.tsv'), dump.join('\n') + '\n', 'utf8');

  const evDump = events.map((e) => `${e.pid}\t${(e.name || '').replace(/\t/g, ' ')}\t${e.eid}\t${e.kind}\t${e.level}\t${e.scope}\t${e.date}\t${F(e.prevCost, 4)}\t${F(e.newCost, 4)}\t${F(e.gain, 6)}\t${e.samePerson ? 1 : 0}`).join('\n');
  fs.writeFileSync(path.join(__dirname, 'm6b_events.tsv'), evDump + '\n', 'utf8');
  console.log('\n→ 已写出 m6b_aggs.tsv / m6b_events.tsv');

  /* ═══ S6 单次最猛 TOP15（修正后，人工核验）═══ */
  console.log('\n' + '='.repeat(76));
  console.log('S6 · 单次最猛突破 TOP15（全级别，含范围）');
  console.log('='.repeat(76));
  const bg = events.slice().sort((a, b) => b.gain - a.gain);
  for (let i = 0; i < Math.min(15, bg.length); i++) {
    const e = bg[i];
    console.log(`  ${String(i + 1).padStart(2)}. ${(e.name || '').padEnd(20).slice(0, 20)} ${e.eid}/${e.kind}/${e.level}/${e.scope}  ${e.date}  ${e.prevCost}→${e.newCost}  gain=${F(e.gain, 5)} (${F((Math.exp(e.gain) - 1) * 100, 1)}%)  ${e.prevName}→${e.name}`);
  }

  /* ═══ S7 仅 WR 完整榜 TOP30 ═══ */
  console.log('\n' + '='.repeat(76));
  console.log('S7 · 仅WR 领先性榜 TOP30');
  console.log('='.repeat(76));
  const d = tops['D 仅WR截顶'];
  for (let i = 0; i < Math.min(30, d.length); i++) {
    const a = d[i];
    console.log(`  ${String(i + 1).padStart(2)}. ${(a.name || '').padEnd(28).slice(0, 28)} ${F(a.sum).padStart(9)}  刷新=${String(a.n).padStart(4)}  项目/轨=${String(a.evs.size).padStart(3)}  最大单次=${F(a.max, 5)}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

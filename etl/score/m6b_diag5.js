'use strict';
/* =============================================================================
 * M6 候选新口径 · 诊断 v5：链条排序与非单调跳过量的根因
 * -----------------------------------------------------------------------------
 * v4 发现：
 *   - 非单调跳过 28,573（占 55,244 标记行的 52%！）→ 排序逻辑可能有问题
 *   - NR 链条出现 9359% 的假增益 → NR 范围（国家）判定可能错
 *   - 全级别 sum 下 NR 占 96.63% → 若要全级别，NR 必须单独处理
 *
 * 本脚本定位：
 *   1) 非单调跳过的分布：按级别 / 是否同场 / 是否同日 / cost 是否真的更差
 *   2) NR 链条 key 判定：NAR vs NR 的区别、ctry 字段是否可靠
 *   3) 抽一条 NR 链条打印全部条目，人工核验
 *
 * 运行：node --max-old-space-size=8192 etl/score/m6b_diag5.js
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
    return (99 - (99 - DD)) * 1e5 + TT;
  }
  const S = String(v);
  const SS = +S.slice(1, 3), AA = +S.slice(3, 5), TT = Math.min(+S.slice(5, 10), 99999);
  const solved = 99 - SS, missed = AA - solved, diff = solved - missed;
  return (99 - diff) * 1e5 + TT;
}
const RT_ORDER = { '0': 0, 'h': 0, 'd': 1, '1': 1, 'e': 2, '2': 2, '3': 3, 'g': 3, 'b': 4, 'c': 5, 'f': 5 };
const MARK_LEVEL = {
  'WR': { level: 'WR', scope: 'WW' }, 'ER': { level: 'CR', scope: 'EU' },
  'AsR': { level: 'CR', scope: 'AS' }, 'SAR': { level: 'CR', scope: 'SA' },
  'OcR': { level: 'CR', scope: 'OC' }, 'AfR': { level: 'CR', scope: 'AF' },
  'NAR': { level: 'NR', scope: 'NA' }, 'NR': { level: 'NR', scope: 'NR' },
};

async function main() {
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
  await zipStream('WCA_export_persons.tsv', (p) => { if (p[2]) { pname.set(p[2], p[0]); pctr.set(p[2], p[7]); } });

  const recs = [];
  await zipStream('WCA_export_results.tsv', (p) => {
    const pid = p[8], eid = p[6], cid = p[4], rt = p[5];
    if (!pid || !eid || !cid) return;
    const c = compDate.get(cid); if (!c) return;
    const yr = compYear.get(cid);
    const ms = p[10], ma = p[11];
    for (const [mkRaw, raw, kind] of [[ms, p[2], 'single'], [ma, p[3], 'avg']]) {
      if (!mkRaw || mkRaw === 'NULL') continue;
      const mk = MARK_LEVEL[mkRaw]; if (!mk) continue;
      const v = +raw; if (!(v > 0)) continue;
      const cost = EV_FMT.get(eid) === 'multi' ? decodeMulti(v) : v;
      recs.push({ pid, eid, cid, rt, date: c, yr, kind, raw: v, cost, mark: mkRaw, level: mk.level, scope: mk.scope, ctry: pctr.get(pid) });
    }
  });
  console.log(`标记行 = ${num(recs.length)}`);

  /* ── 1. 标记值 × 轨道 交叉表 ── */
  console.log('\n=== 标记值 × 轨道 ===');
  const cross = {};
  for (const r of recs) {
    const k = r.mark + '|' + r.kind;
    cross[k] = (cross[k] || 0) + 1;
  }
  for (const k of Object.keys(cross).sort()) console.log(`  ${k.padEnd(12)} ${String(cross[k]).padStart(7)}`);

  /* ── 2. persons.tsv 的国家列到底是哪一列？ ── */
  console.log('\n=== persons.tsv 表头 ===');
  {
    const lines = fs.readFileSync(path.join(TMP, 'WCA_export_persons.tsv'), 'utf8').split('\n');
    console.log('  ' + lines[0].split('\t').join(' | '));
    console.log('  样例: ' + lines[1].split('\t').join(' | '));
  }

  /* ── 3. 建链条 + 逐条分析非单调 ── */
  const chains = new Map();
  for (const r of recs) {
    let scope = r.scope;
    if (r.level === 'NR') scope = r.ctry || '??';
    const k = r.eid + '|' + r.kind + '|' + r.level + '|' + scope;
    let a = chains.get(k); if (!a) { a = []; chains.set(k, a); }
    a.push(r);
  }
  console.log(`\n链条数 = ${num(chains.size)}`);
  const byLvChain = {};
  for (const k of chains.keys()) {
    const p = k.split('|');
    byLvChain[p[2]] = (byLvChain[p[2]] || 0) + 1;
  }
  console.log('按级别链条数:', byLvChain);

  const skipStats = { sameDay: 0, sameComp: 0, worseCost: 0, betterButSkipped: 0, byLv: {} };
  const samples = [];
  for (const [k, arr] of chains) {
    arr.sort((x, y) => {
      if (x.date !== y.date) return x.date < y.date ? -1 : 1;
      const ro = (RT_ORDER[x.rt] == null ? 9 : RT_ORDER[x.rt]) - (RT_ORDER[y.rt] == null ? 9 : RT_ORDER[y.rt]);
      if (ro !== 0) return ro;
      return x.cost - y.cost;
    });
    const lv = k.split('|')[2];
    for (let i = 1; i < arr.length; i++) {
      const prev = arr[i - 1], cur = arr[i];
      if (cur.cost < prev.cost) continue;
      skipStats.byLv[lv] = (skipStats.byLv[lv] || 0) + 1;
      if (cur.date === prev.date) skipStats.sameDay++;
      if (cur.cid === prev.cid) skipStats.sameComp++;
      if (!(cur.cost < prev.cost)) skipStats.worseCost++;
      if (samples.length < 12) {
        samples.push({ k, prev: { ...prev, name: pname.get(prev.pid) }, cur: { ...cur, name: pname.get(cur.pid) } });
      }
    }
  }
  console.log('\n=== 非单调跳过分析 ===');
  console.log('  总跳过 =', Object.values(skipStats.byLv).reduce((a, b) => a + b, 0));
  console.log('  按级别:', skipStats.byLv);
  console.log('  同日 =', skipStats.sameDay, ' 同场 =', skipStats.sameComp);

  console.log('\n  抽样（前 12 条被跳过的相邻对）：');
  for (const s of samples) {
    console.log(`    ${s.k}`);
    console.log(`      prev: ${s.prev.date} rt=${s.prev.rt} ${(s.prev.name || '').slice(0, 20)} cost=${s.prev.cost} mark=${s.prev.mark} cid=${s.prev.cid}`);
    console.log(`      cur : ${s.cur.date} rt=${s.cur.rt} ${(s.cur.name || '').slice(0, 20)} cost=${s.cur.cost} mark=${s.cur.mark} cid=${s.cur.cid}`);
  }

  /* ── 4. 抽一条 NR 链条完整打印，人工核验范围与顺序 ── */
  console.log('\n=== 抽一条 NR 链条（最多 20 条）===');
  const nrChainKey = [...chains.keys()].find((k) => k.includes('|NR|'));
  const nrArr = chains.get(nrChainKey).slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.cost - b.cost));
  console.log(`  链条 = ${nrChainKey}  条数 = ${nrArr.length}`);
  for (const s of nrArr.slice(0, 20)) {
    console.log(`    ${s.date} rt=${s.rt} ${(pname.get(s.pid) || '').slice(0, 22).padEnd(22)} cost=${String(s.cost).padStart(8)} mark=${s.mark} ctry=${s.ctry} cid=${s.cid}`);
  }

  /* ── 5. 关键：同一人同场多轮标记 —— 是否该只取该场最佳？ ── */
  console.log('\n=== 同(比赛,项目,轨道)多标记的明细抽样 ===');
  const perComp = new Map();
  for (const r of recs) {
    const k = r.cid + '|' + r.eid + '|' + r.kind;
    let a = perComp.get(k); if (!a) { a = []; perComp.set(k, a); }
    a.push(r);
  }
  let shown = 0;
  for (const [k, a] of perComp) {
    if (a.length < 3 || shown >= 8) continue;
    shown++;
    console.log(`  ▸ ${k}  (${a.length} 条标记)`);
    for (const r of a.slice().sort((x, y) => (RT_ORDER[x.rt] ?? 9) - (RT_ORDER[y.rt] ?? 9))) {
      console.log(`      rt=${r.rt} ${(pname.get(r.pid) || '').slice(0, 22).padEnd(22)} cost=${String(r.cost).padStart(8)} mark=${r.mark} date=${r.date}`);
    }
  }

  /* ── 6. 若「每场只取最佳一条」，链条会变成什么样 ── */
  console.log('\n=== 方案对比：同场多标记时「只取最佳」vs「全取」 ===');
  for (const mode of ['all', 'bestOnly']) {
    const ev2 = [];
    for (const [k, arr] of chains) {
      // 先按场聚合
      const byC = new Map();
      for (const r of arr) {
        const ck = r.cid;
        const cur = byC.get(ck);
        if (!cur || r.cost < cur.cost) byC.set(ck, r);
      }
      const seq = mode === 'all' ? arr.slice().sort((x, y) => {
        if (x.date !== y.date) return x.date < y.date ? -1 : 1;
        const ro = (RT_ORDER[x.rt] ?? 9) - (RT_ORDER[y.rt] ?? 9);
        if (ro !== 0) return ro;
        return x.cost - y.cost;
      }) : [...byC.values()].sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : x.cost - y.cost));
      for (let i = 1; i < seq.length; i++) {
        const prev = seq[i - 1], cur = seq[i];
        if (!(cur.cost < prev.cost)) continue;
        ev2.push({ level: cur.level, gain: Math.log(prev.cost / cur.cost), pid: cur.pid });
      }
    }
    const wr = ev2.filter((e) => e.level === 'WR');
    const g = wr.map((e) => e.gain).sort((a, b) => a - b);
    const pct = (p) => g[Math.min(g.length - 1, Math.floor(g.length * p))];
    const big = ev2.filter((e) => e.gain > 1).length;
    console.log(`  ${mode.padEnd(9)}: 事件=${num(ev2.length)}  WR事件=${num(wr.length)}  WR中位gain=${F(pct(0.5), 5)}  WR p95=${F(pct(0.95), 5)}  WR max=${F(g[g.length - 1], 5)}  全级别>100%的事件=${num(big)}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

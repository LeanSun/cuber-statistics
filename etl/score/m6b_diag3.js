'use strict';
/* =============================================================================
 * M6 候选新口径 · 诊断 v3：从 results.tsv 原始数据重建 WR 链条
 * -----------------------------------------------------------------------------
 * v2 查明的根因：
 *   js/data.js 只有 4,952 人保留 records（DETAIL_MAX=2500 + 回填），
 *   其余 295,105 人的纪录被丢弃 → 从 records 重建的链条**必然缺环**
 *   → v1 看到的 3614% / 2171% 荒谬 gain 是缺环假象，不是真实突破。
 *
 * v3 改从原始 results.tsv 重建：
 *   WCA 官方在每行带 `regional_single_record` / `regional_average_record` 标记，
 *   值域：WR / ER / NR / NAR / AsR / SAR / OcR / AfR（NULL = 非纪录）
 *   这是**权威事实**：该行成绩在该时刻刷新了对应级别的纪录。
 *
 * ★ 关键粒度问题：
 *   一场比赛有多轮（round_type: 1/2/3/f/c/d），WCA 对**每个刷新纪录的轮次**都打标记吗？
 *   如果是，则同一选手同场可有多条 WR 标记 → 「一场刷多次」能精确还原。
 *   如果只标最终轮，则链条粒度 = 场级。
 *   本脚本先量化这个分布。
 *
 * 运行：node --max-old-space-size=8192 etl/score/m6b_diag3.js
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

/* multi 解码（与 m6_strength.js / m4_dominance.js 逐字一致）—— 记录值是文本，用另一种 */
function decodeMultiText(s) {
  const v = +s;
  if (!Number.isFinite(v) || v <= 0) return null;
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
/* 时间文本 → 秒 */
function clockSec(s) {
  if (!s) return null;
  const p = String(s).trim().split(':');
  if (p.length === 3) return +p[0] * 3600 + +p[1] * 60 + +p[2];
  if (p.length === 2) return +p[0] * 60 + +p[1];
  const v = +p[0];
  return Number.isFinite(v) ? v : null;
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
      compDate.set(p[ix.id], d);
      compYear.set(p[ix.id], +p[ix.year]);
    }
  }
  const EV_FMT = new Map();
  {
    const lines = fs.readFileSync(path.join(TMP, 'WCA_export_events.tsv'), 'utf8').trim().split('\n');
    const ix = {}; lines[0].split('\t').forEach((c, i) => ix[c] = i);
    for (let i = 1; i < lines.length; i++) EV_FMT.set(lines[i][ix.id], lines[i][ix.format]);
  }
  const pname = new Map();
  await zipStream('WCA_export_persons.tsv', (p) => { if (p[2]) pname.set(p[2], p[0]); });
  stamp(`S0 比赛=${num(compDate.size)} persons=${num(pname.size)}`);

  /* ═══ S1 扫 results：只取带纪录标记的行 ═══ */
  const recs = [];          // {pid, eid, cid, rt, date, yr, kind:'single'|'avg', val, cost, mark}
  const rtCount = {};       // 标记行的轮次分布
  const markCount = {};     // 标记值分布
  const perCompMark = new Map();  // cid|eid|kind -> 标记行数
  let nRows = 0;
  await zipStream('WCA_export_results.tsv', (p) => {
    nRows++;
    const pid = p[8], eid = p[6], cid = p[4], rt = p[5];
    if (!pid || !eid || !cid) return;
    const ms = p[10], ma = p[11];
    if (ms && ms !== 'NULL') {
      const mark = ms;
      markCount[mark] = (markCount[mark] || 0) + 1;
      rtCount[rt] = (rtCount[rt] || 0) + 1;
      const c = compDate.get(cid);
      if (c) {
        const cost = EV_FMT.get(eid) === 'multi' ? decodeMultiText(p[2]) : clockSec(p[2]);
        if (cost != null) {
          recs.push({ pid, eid, cid, rt, date: c, yr: compYear.get(cid), kind: 'single', val: p[2], cost, mark });
          const k = cid + '|' + eid + '|single';
          perCompMark.set(k, (perCompMark.get(k) || 0) + 1);
        }
      }
    }
    if (ma && ma !== 'NULL') {
      markCount[ma] = (markCount[ma] || 0) + 1;
      rtCount[rt] = (rtCount[rt] || 0) + 1;
      const c = compDate.get(cid);
      if (c) {
        const cost = EV_FMT.get(eid) === 'multi' ? decodeMultiText(p[3]) : clockSec(p[3]);
        if (cost != null) {
          recs.push({ pid, eid, cid, rt, date: c, yr: compYear.get(cid), kind: 'avg', val: p[3], cost, mark: ma });
          const k = cid + '|' + eid + '|avg';
          perCompMark.set(k, (perCompMark.get(k) || 0) + 1);
        }
      }
    }
  });
  stamp(`S1 rows=${num(nRows)}  标记行=${num(recs.length)}  堆=${mem()}`);

  console.log('\n=== 纪录标记值分布 ===');
  for (const [k, v] of Object.entries(markCount).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(6)} ${String(v).padStart(7)}`);
  }
  console.log('\n=== 标记行的轮次分布（粒度问题）===');
  for (const [k, v] of Object.entries(rtCount).sort((a, b) => b[1] - a[1])) {
    console.log(`  round_type=${k}  ${String(v).padStart(7)}`);
  }

  /* 同一场同一项目被标记多次的分布 */
  const multi = [...perCompMark.values()];
  const dist = {};
  for (const v of multi) dist[v] = (dist[v] || 0) + 1;
  console.log('\n=== 同一(比赛,项目,轨道)被标记的条数分布 ===');
  for (const k of Object.keys(dist).sort((a, b) => a - b)) {
    console.log(`  ${String(k).padStart(3)} 条标记 : ${String(dist[k]).padStart(6)} 场`);
  }
  const oneRound = multi.filter((v) => v === 1).length;
  console.log(`  → 只有 1 条标记的场 = ${num(oneRound)} / ${num(multi.length)} (${F(oneRound / multi.length * 100, 2)}%)`);
  console.log(`  → 多于 1 条标记的场 = ${num(multi.length - oneRound)}（同一场多次刷新被保留）`);

  /* ═══ S2 重建 WR 链条 ═══ */
  /* 只用 WR 标记。链条 key = ev|kind（WR 是全球唯一） */
  const wr = recs.filter((r) => r.mark === 'WR');
  console.log(`\n=== WR 标记行 = ${num(wr.length)} ===`);

  const chains = new Map();
  for (const r of wr) {
    const k = r.eid + '|' + r.kind;
    let a = chains.get(k);
    if (!a) { a = []; chains.set(k, a); }
    a.push(r);
  }
  console.log(`WR 链条数 = ${num(chains.size)}`);

  const allEvents = [];
  let chainIssue = 0;
  for (const [k, arr] of chains) {
    arr.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : x.cost - y.cost));
    /* 同日多条：按 cost 升序，链条应单调下降 */
    for (let i = 1; i < arr.length; i++) {
      const prev = arr[i - 1], cur = arr[i];
      if (!(cur.cost < prev.cost)) { chainIssue++; continue; }  // 同日/乱序 → 跳过
      const gain = Math.log(prev.cost / cur.cost);
      allEvents.push({
        pid: cur.pid, name: pname.get(cur.pid) || '', eid: cur.eid, kind: cur.kind,
        date: cur.date, yr: cur.yr, rt: cur.rt, cid: cur.cid,
        prevVal: prev.val, newVal: cur.val, prevCost: prev.cost, newCost: cur.cost,
        gain, samePerson: cur.pid === prev.pid,
        prevName: pname.get(prev.pid) || '', prevDate: prev.date,
      });
    }
  }
  console.log(`链条中非单调（应跳过）= ${num(chainIssue)}`);
  console.log(`★ WR 刷新事件总数 = ${num(allEvents.length)}`);

  const gains = allEvents.map((e) => e.gain).filter((g) => g > 0).sort((a, b) => a - b);
  const pct = (p) => gains[Math.min(gains.length - 1, Math.floor(gains.length * p))];
  console.log('\n=== WR 领先幅度 gain = ln(前WR/新WR) 分布 ===');
  console.log(`  n=${num(gains.length)}  min=${F(gains[0], 6)}  p25=${F(pct(0.25), 6)}  中位=${F(pct(0.5), 6)}  p75=${F(pct(0.75), 6)}  p95=${F(pct(0.95), 6)}  p99=${F(pct(0.99), 6)}  max=${F(gains[gains.length - 1], 6)}`);
  console.log(`  百分比：中位 ${F((Math.exp(pct(0.5)) - 1) * 100, 3)}%  p95 ${F((Math.exp(pct(0.95)) - 1) * 100, 2)}%  max ${F((Math.exp(gains[gains.length - 1]) - 1) * 100, 2)}%`);

  /* ═══ S3 与 v1 的 records 链条对照：差距有多大？═══ */
  console.log('\n=== 与 js/data.js records 链条对照 ===');
  console.log(`  records 重建（v1）的 WR 事件 = 1,193`);
  console.log(`  results 重建（v3）的 WR 事件 = ${num(allEvents.length)}`);
  console.log(`  → 相差 ${F((allEvents.length / 1193 - 1) * 100, 1)}%，v1 漏掉了大量中间持有者`);

  /* ═══ S4 聚合与榜单 ═══ */
  const agg = new Map();
  for (const e of allEvents) {
    if (!(e.gain > 0)) continue;
    let a = agg.get(e.pid);
    if (!a) { a = { pid: e.pid, name: e.name, sum: 0, n: 0, max: 0, maxEv: '', evs: new Set() }; agg.set(e.pid, a); }
    a.sum += e.gain; a.n++; a.evs.add(e.eid + '|' + e.kind);
    if (e.gain > a.max) { a.max = e.gain; a.maxEv = e.eid + '/' + e.kind + ' ' + e.date; }
  }
  const ranked = [...agg.values()].sort((a, b) => b.sum - a.sum);
  console.log(`\n=== WR 领先性 sum 榜 · 有分 ${num(ranked.length)} 人 · 总量 ${F(ranked.reduce((s, a) => s + a.sum, 0))} ===`);
  console.log(`  #  选手                          sum      刷新数  项目/轨  最大单次`);
  for (let i = 0; i < Math.min(30, ranked.length); i++) {
    const a = ranked[i];
    console.log(`  ${String(i + 1).padStart(2)}. ${(a.name || '').padEnd(28).slice(0, 28)} ${F(a.sum).padStart(9)}  ${String(a.n).padStart(5)}  ${String(a.evs.size).padStart(5)}   ${F(a.max, 5)} (${a.maxEv})`);
  }

  for (const nm of ['Feliks', 'Max', 'Tymon', 'Stanley Chapel', 'Kimberley', 'Yiheng']) {
    const a = ranked.find((x) => (x.name || '').includes(nm));
    if (a) console.log(`  ▸ ${nm}: #${ranked.indexOf(a) + 1}  sum=${F(a.sum)}  刷新=${a.n}  项目/轨=${a.evs.size}  最大单次=${F(a.max, 5)}`);
    else console.log(`  ▸ ${nm}: 不在榜（未刷新过 WR）`);
  }

  /* ═══ S5 单次最猛突破 ═══ */
  const byGain = allEvents.slice().sort((a, b) => b.gain - a.gain);
  console.log('\n=== 单次最猛 WR 突破 TOP20 ===');
  for (let i = 0; i < Math.min(20, byGain.length); i++) {
    const e = byGain[i];
    console.log(`  ${String(i + 1).padStart(2)}. ${(e.name || '').padEnd(24).slice(0, 24)} ${e.eid}/${e.kind}  ${e.date}  ${e.prevVal} → ${e.newVal}  gain=${F(e.gain, 5)} (${F((Math.exp(e.gain) - 1) * 100, 2)}%)  ${e.prevName}→${e.name}`);
  }

  /* ═══ S6 自我连续刷新占比 ═══ */
  const self = allEvents.filter((e) => e.samePerson).length;
  console.log(`\n=== 自我连续刷新（同一人接着刷自己的 WR）= ${num(self)} / ${num(allEvents.length)} (${F(self / allEvents.length * 100, 2)}%) ===`);
}

main().catch((e) => { console.error(e); process.exit(1); });

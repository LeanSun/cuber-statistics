'use strict';
/* ═══════════════════════════════════════════════════════════════════════
 * M6-c 诊断 1 · 窗口统治力（WR100 席位占用）
 * ────────────────────────────────────────────────────────────────────
 * 用户新思路（2026-10-25）：「一定周期内，该选手该项目所创造的单次、
 * 平均成绩在 WR100 榜内占据了多少个。」
 *
 * 口径草案：
 *   对每个窗口 W（年 或 季）× 每个 (项目 e, 轨道 t)：
 *     ① 取窗口内该项目轨道的全部正式成绩行（multi 解码，越小越强）
 *     ② 同一人同一场比赛取最好一条（去重，防止一轮多轮刷席）
 *     ③ 升序取前 100 条 = 该窗口的「WR100 成绩榜」
 *     ④ 统计每人在前 100 中占据的条数 occ(pid|e,t|W)
 *   聚合：M6 = Σ_W Σ_(e,t) occ
 *
 * 两个池深变体：
 *   strict   : 窗口内 (e,t) 去重后不足 100 人 → 该窗口不计（WR100 无意义）
 *   relative : occ 归一为 occ / min(100, 池人数)（小池按比例折算）
 *
 * 两个窗口对照：year（4 季合并）/ quarter（3 个月）
 * ────────────────────────────────────────────────────────────────────
 * 复用 M4-F1 冻结基建：streamTsv / decodeMulti / EV_RETIRED_DAY（只读）
 * 用法：node --max-old-space-size=8192 etl/score/m6c_diag1.js
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const RN = require('./runs.js');

const ROOT = path.resolve(__dirname, '../..');
const ZIP = fs.readdirSync(path.join(ROOT, 'data/raw')).filter((f) => f.endsWith('.zip'))[0];
const ZIP_PATH = path.join(ROOT, 'data/raw', ZIP);
const F = (v, d) => Number(v).toFixed(d === undefined ? 4 : d);
const num = (v) => Number(v).toLocaleString('en-US');
const log = (...a) => console.log(...a);

/* ── multi 解码（与 M4-F1 逐字一致）────────────────────────────────── */
function decodeMulti(v) {
  if (v < 1e9) {
    const S = String(v).padStart(10, '0');
    const DD = +S.slice(1, 3);
    const TT = Math.min(+S.slice(3, 8), 99999);
    const diff = 99 - DD;
    return { cost: (99 - diff) * 1e5 + TT };
  }
  const S = String(v);
  const SS = +S.slice(1, 3);
  const AA = +S.slice(3, 5);
  const TT = Math.min(+S.slice(5, 10), 99999);
  const solved = 99 - SS;
  const diff = solved - (AA - solved);
  return { cost: (99 - diff) * 1e5 + TT };
}

/* ── TSV 流式读取（与 M4-F1 逐字一致）──────────────────────────────── */
function streamTsv(name, onRow) {
  return new Promise((resolve, reject) => {
    const ps = spawn('unzip', ['-p', ZIP_PATH, name]);
    let buf = ''; let head = true;
    ps.on('error', reject);
    ps.stdout.on('data', (d) => {
      buf += d.toString('utf8');
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const ln = buf.slice(0, i); buf = buf.slice(i + 1);
        if (head) { head = false; continue; }
        if (ln) onRow(ln.split('\t'));
      }
    });
    ps.on('close', () => resolve());
  });
}

/* ── 可增长 typed array ───────────────────────────────────────────── */
class Grow {
  constructor(Type, cap) { this.T = Type; this.a = new Type(cap || 1 << 16); this.n = 0; }
  push(v) {
    if (this.n === this.a.length) { const b = new this.T(this.a.length * 2); b.set(this.a); this.a = b; }
    this.a[this.n++] = v;
  }
}

/* ── 窗口 id：年 / 季 ─────────────────────────────────────────────── */
const qDay = [];   // [y][q] → 该季首日
function buildQuarters(minY, maxY) {
  for (let y = minY; y <= maxY; y++) {
    const bounds = [0,
      RN.dayOf(y + '-04-01'), RN.dayOf(y + '-07-01'), RN.dayOf(y + '-10-01')];
    qDay[y] = bounds;
  }
}
function winIds(day) {
  const y = RN.yearOfDay(day) | 0;
  const b = qDay[y];
  if (!b) return [y, -1];
  let q = 3;
  if (day >= b[3]) q = 3; else if (day >= b[2]) q = 2; else if (day >= b[1]) q = 1; else q = 0;
  return [y, y * 4 + q];
}

const TRACKS = ['single', 'average'];
const RETIRED = RN.EV_RETIRED_DAY;
const FOCUS = ['Feliks Zemdegs', 'Max Park', 'Tymon Kolasiński', 'Yiheng Wang', 'Stanley Chapel'];

async function main() {
  const t0 = Date.now();
  /* pid 索引 */
  const pidIdx = new Map(); const idxName = [];
  const idxOf = (p) => {
    let i = pidIdx.get(p);
    if (i === undefined) { i = idxName.length; pidIdx.set(p, i); idxName.push(p); }
    return i;
  };

  /* ── S1 项目格式 + 比赛日 ── */
  const evInfo = new Map();
  await streamTsv('WCA_export_events.tsv', (r) => {
    if (!r[0]) return;
    evInfo.set(r[0], { name: r[2] || r[0], format: r[1] });
  });
  const compDay = new Map(); const compIdx = new Map(); const compArr = [];
  await streamTsv('WCA_export_competitions.tsv', (r) => {
    if (!r[0]) return;
    if (r[10] === '1') return;                    // cancelled
    const y = +r[17] || +r[14];
    if (!y) return;
    const m = +r[18] || +r[15] || 1;
    const d = +r[19] || +r[16] || 1;
    compDay.set(r[0], RN.dayOf(y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0')));
    compIdx.set(r[0], compArr.length); compArr.push(r[0]);
  });
  log('[1/5] 比赛日:', num(compDay.size), ((Date.now() - t0) / 1000).toFixed(1) + 's');

  /* 项目的 format（time/number/multi）——来自 WCA_export_events.tsv */
  const fmtOf = (ev) => (evInfo.get(ev) || {}).format || 'time';

  /* ── S2 成绩收集（按 ev|track 分桶）── */
  const buckets = new Map();   // ev|tr → {days,pids,comps,vals}
  const bucketOf = (k) => {
    let b = buckets.get(k);
    if (!b) { b = { days: new Grow(Int32Array), pids: new Grow(Int32Array), comps: new Grow(Int32Array), vals: new Grow(Float64Array) }; buckets.set(k, b); }
    return b;
  };
  let rows = 0;
  await streamTsv('WCA_export_results.tsv', (r) => {
    rows++;
    const ev = r[6], pid = r[8], compId = r[4];
    if (!ev || !pid) return;
    const day = compDay.get(compId);
    if (day === undefined) return;
    const rd = RETIRED[ev];
    if (rd != null && day >= rd) return;
    const p = idxOf(pid), c = compIdx.get(compId);
    const fmt = fmtOf(ev);
    const vs = +r[2], va = +r[3];
    if (vs > 0) {
      const b = bucketOf(ev + '|single');
      b.days.push(day); b.pids.push(p); b.comps.push(c);
      b.vals.push(fmt === 'multi' ? decodeMulti(vs).cost : vs);
    }
    if (va > 0) {
      const b = bucketOf(ev + '|average');
      b.days.push(day); b.pids.push(p); b.comps.push(c);
      b.vals.push(fmt === 'multi' ? decodeMulti(va).cost : va);
    }
  });
  let nRows = 0; for (const b of buckets.values()) nRows += b.days.n;
  log('[2/5] 成绩扫描:', num(rows), '行 →', num(nRows), '条有效轨道行，桶', buckets.size, ((Date.now() - t0) / 1000).toFixed(1) + 's');

  /* 年份范围 */
  let minY = 9999, maxY = 0;
  for (let i = 0; i < buckets.get('333|single').days.n; i++) {
    const y = RN.yearOfDay(buckets.get('333|single').days.a[i]) | 0;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  buildQuarters(minY, maxY + 1);
  log('    年份范围', minY, '-', maxY);

  /* ── S3 窗口 × 桶 → top100 席位统计 ── */
  /* 聚合器：4 个变体 = {year,quarter} × {strict,relative} */
  const mkAgg = () => ({
    s: new Float64Array(idxName.length),        // strict 累计（占席条数）
    r: new Float64Array(idxName.length),        // relative 累计
    nw: new Int32Array(idxName.length),         // 有占席的窗口数
    bestWin: new Array(idxName.length),         // 最好窗口 {win, ev, occ}
    bestOcc: new Float64Array(idxName.length),
  });
  const AGG = { year_strict: mkAgg(), year_rel: mkAgg(), quarter_strict: mkAgg(), quarter_rel: mkAgg() };
  const TOP = 100;

  /* 集中度诊断：每个窗口榜一的占席条数 */
  const conc = { year: [], quarter: [] };

  /* 窗口缓存：key = ev|tr|winScheme|winId */
  const winRows = new Map();
  const wbufOf = (key) => {
    let w = winRows.get(key);
    if (!w) { w = []; winRows.set(key, w); }
    return w;
  };

  for (const [k, b] of buckets) {
    const [ev, tr] = k.split('|');
    for (let i = 0; i < b.days.n; i++) {
      const day = b.days.a[i];
      const [wy, wq] = winIds(day);
      const row = { pid: b.pids.a[i], comp: b.comps.a[i], v: b.vals.a[i] };
      wbufOf(k + '|Y|' + wy).push(row);
      if (wq >= 0) wbufOf(k + '|Q|' + wq).push(row);
    }
  }
  log('[3/5] 窗口分组完成:', winRows.size, '个窗口桶', ((Date.now() - t0) / 1000).toFixed(1) + 's');

  function processWindow(scheme, ev, tr, win, wbuf) {
    /* 同人同场取最好 */
    const dedup = new Map();
    for (const row of wbuf) {
      const key = row.pid * 1048576 + row.comp;
      const old = dedup.get(key);
      if (old === undefined || row.v < old) dedup.set(key, row.v);
    }
    if (dedup.size === 0) return;
    const pool = new Set();
    for (const row of wbuf) pool.add(row.pid);
    const nPool = pool.size;
    /* 升序取前 100 */
    const arr = [...dedup.entries()];
    arr.sort((a, b) => a[1] - b[1]);
    const take = Math.min(TOP, arr.length);
    /* 席位统计：pid → 条数 */
    const occ = new Map();
    for (let i = 0; i < take; i++) {
      const key = arr[i][0];
      const pid = Math.floor(key / 1048576);
      occ.set(pid, (occ.get(pid) || 0) + 1);
    }
    if (occ.size === 0) return;
    const relScale = Math.min(100, nPool) / 100;
    const label = ev + '/' + tr;
    for (const [pid, c] of occ) {
      const A = AGG[scheme + '_strict'], B = AGG[scheme + '_rel'];
      A.s[pid] += c; B.r[pid] += c / relScale;
      A.nw[pid]++; B.nw[pid]++;
      if (c > A.bestOcc[pid]) { A.bestOcc[pid] = c; A.bestWin[pid] = win + ' ' + label + ' ×' + c; }
      if (c / relScale > B.bestOcc[pid]) { B.bestOcc[pid] = c / relScale; B.bestWin[pid] = win + ' ' + label + ' ×' + c; }
    }
    conc[scheme].push({ win, ev, tr, nPool, top1: Math.max(...occ.values()) });
  }

  let done = 0;
  for (const [key, wbuf] of winRows) {
    const parts = key.split('|');
    const scheme = parts[2] === 'Y' ? 'year' : 'quarter';
    processWindow(scheme, parts[0], parts[1], parts[3], wbuf);
    if (++done % 5000 === 0) log('    …', num(done), '/', num(winRows.size), ((Date.now() - t0) / 1000).toFixed(1) + 's');
  }
  log('[4/5] 席位统计完成', ((Date.now() - t0) / 1000).toFixed(1) + 's');

  /* ── S4 输出 ── */
  const nameOf = (i) => idxName[i] || ('#' + i);
  function top25(tag) {
    const A = AGG[tag];
    const idxs = [];
    for (let i = 0; i < idxName.length; i++) if (A.s[i] > 0 || A.r[i] > 0) idxs.push(i);
    const keyF = tag.endsWith('rel') ? (i) => A.r[i] : (i) => A.s[i];
    idxs.sort((a, b) => keyF(b) - keyF(a));
    log('\n── ' + tag + ' Top25（人数 ' + num(idxs.length) + '）──');
    for (let r = 0; r < Math.min(25, idxs.length); r++) {
      const i = idxs[r];
      log(String(r + 1).padStart(2), nameOf(i).padEnd(24), 'strict=' + F(A.s[i], 1), 'rel=' + F(A.r[i], 2), '窗口=' + A.nw[i], '最佳=' + (A.bestWin[i] || ''));
    }
    return idxs;
  }
  const tops = {};
  tops.year_strict = top25('year_strict');
  tops.year_rel = top25('year_rel');
  tops.quarter_strict = top25('quarter_strict');
  tops.quarter_rel = top25('quarter_rel');

  /* 集中度：窗口榜一占席分布 */
  for (const sch of ['year', 'quarter']) {
    const a = conc[sch];
    a.sort((x, y) => y.top1 - x.top1);
    log('\n── ' + sch + ' 窗口榜一占席最狠 Top10 ──');
    for (let i = 0; i < Math.min(10, a.length); i++) log(' ', a[i].win, (a[i].ev + '/' + a[i].tr).padEnd(16), '榜一占 ' + a[i].top1 + '/100（池 ' + a[i].nPool + '）');
  }

  /* 锚点 */
  log('\n── 锚点检验 ──');
  const nameIdx = new Map(); for (let i = 0; i < idxName.length; i++) nameIdx.set(idxName[i], i);
  for (const tag of ['year_strict', 'year_rel', 'quarter_strict', 'quarter_rel']) {
    const A = AGG[tag];
    const keyF = tag.endsWith('rel') ? (i) => A.r[i] : (i) => A.s[i];
    const idxs = [];
    for (let i = 0; i < idxName.length; i++) if (keyF(i) > 0) idxs.push(i);
    idxs.sort((a, b) => keyF(b) - keyF(a));
    const parts = [];
    for (const nm of FOCUS) {
      const i = nameIdx.get(nm);
      const r = i === undefined ? -1 : idxs.indexOf(i) + 1;
      parts.push(nm.split(' ')[0] + ' #' + r + '(' + (i === undefined ? '-' : F(keyF(i), 1)) + ')');
    }
    log(' ', tag.padEnd(12), parts.join('  '));
  }

  /* ── S5 导出 seats 供正交性检验 ── */
  const out = ['pid\tname\tyear_strict\tyear_rel\tquarter_strict\tquarter_rel\tyw_nw\tyr_nw\tqs_nw\tqr_nw'];
  for (let i = 0; i < idxName.length; i++) {
    const A = AGG;
    if (A.year_strict.s[i] <= 0 && A.quarter_strict.s[i] <= 0) continue;
    out.push([idxName[i], nameOf(i).replace(/\t/g, ' '), F(A.year_strict.s[i], 2), F(A.year_rel.r[i], 4),
      F(A.quarter_strict.s[i], 2), F(A.quarter_rel.r[i], 4),
      A.year_strict.nw[i], A.year_rel.nw[i], A.quarter_strict.nw[i], A.quarter_rel.nw[i]].join('\t'));
  }
  fs.writeFileSync(path.join(__dirname, 'm6c_seats.tsv'), out.join('\n') + '\n', 'utf8');
  log('\n→ 已写出 m6c_seats.tsv（', num(out.length - 1), '人）');
  log('总耗时', ((Date.now() - t0) / 1000).toFixed(1) + 's');
}

main().catch((e) => { console.error(e); process.exit(1); });

'use strict';
/* =============================================================================
 * M6 高度类三候选 · 联合诊断 v1（m6d_diag1.js）
 * -----------------------------------------------------------------------------
 * 背景：用户否决了「对手强度 M6-F1」（榜单直觉差）与「WR100 占席」（ρ×M4≈0.90），
 *       确立 M6 应为「高度类」——量「你把人类极限推多远」，不量对手/环境。
 *       三个候选一起实测，从中挑 M6：
 *
 *   C1 领先幅度   突破瞬间相对原 WR 跳多远：gain = ln(prev/new)，WR-only + 截顶 0.5
 *                 → 直接复用 m6b_aggs.tsv 的 tag D（已与 M1 records 链验证一致）
 *
 *   C2 第二人间隔 你的 WR 成绩 v 达成于 d，第二个人类达成 ≤ v 是什么时候？
 *                 gapYears = (t2 − d)/365.25；无人达成 → 用快照日封口。
 *                 语义：领先时代多久（整条前沿追平你所需的时间）
 *
 *   C3 里程碑首破 每 (项目,轨道) 以 final_WR × 几何因子分档（24 档），
 *                 每档「人类第一次达到」者得 1 分。绝对门槛，不依赖对手。
 *
 * 运行：node --max-old-space-size=8192 etl/score/m6d_diag1.js
 * ============================================================================= */
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const ROOT = path.resolve(__dirname, '../..');
const ZIP = path.join(ROOT, 'data/raw/WCA_export_v2_288_20261015T000017Z.tsv.zip');
const TMP = path.join(ROOT, '.workbuddy/tmp/oc');
const D = __dirname;
const SNAPSHOT = Date.UTC(2026, 9, 15) / 86400000;   // 导出日，封口用

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
function dayNum(iso) { return Math.round(Date.parse(iso + 'T00:00:00Z') / 86400000); }
function isoOf(dn) { return new Date(dn * 86400000).toISOString().slice(0, 10); }

/* ── 统计基建 ── */
function spearman(pairs) {
  const n = pairs.length;
  if (n < 10) return { n, rho: NaN };
  const rank = (arr) => {
    const idx = arr.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
    const r = new Float64Array(n);
    let i = 0;
    while (i < n) {
      let j = i;
      while (j + 1 < n && idx[j + 1][0] === idx[i][0]) j++;   // idx 元素是 [v,i]，直接比值
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
      i = j + 1;
    }
    return r;
  };
  const ra = rank(pairs.map((p) => p[0])), rb = rank(pairs.map((p) => p[1]));
  /* ★ 必须中心化：不减均值的 Σra·rb/√(Σra²·Σrb²) 是余弦，
     对全正秩向量恒偏高（本文件第一版因此全表虚高 0.75+） */
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += ra[i]; mb += rb[i]; }
  ma /= n; mb /= n;
  let sxy = 0, sxa = 0, syb = 0;
  for (let i = 0; i < n; i++) { const a = ra[i] - ma, b = rb[i] - mb; sxy += a * b; sxa += a * a; syb += b * b; }
  return { n, rho: sxy / Math.sqrt(sxa * syb) };
}
function crossRho(A, B) {
  const pairs = [];
  for (const [pid, va] of A) { const vb = B.get(pid); if (vb !== undefined) pairs.push([va, vb]); }
  return spearman(pairs);
}

/* ═══ 主流程 ═══ */
async function main() {
  const t0 = Date.now();
  const log = (...a) => console.log(...a);

  /* S0 元信息 */
  const compDate = new Map();
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
  log(`persons=${num(pname.size)}  [${((Date.now() - t0) / 1000).toFixed(1)}s]`);

  /* S1 扫 results：全量成绩池 + WR 标记查询 */
  const pidIdx = new Map(); const pidName = [];
  const idxOf = (p) => {
    let i = pidIdx.get(p);
    if (i === undefined) { i = pidName.length; pidIdx.set(p, i); pidName.push(p); }
    return i;
  };
  const pool = new Map();          // eid|kind → [[cost, day, pidIdx], …]
  const wrQ = new Map();           // eid|kind → [{c, day, pi}]（同(人,成绩)去重）
  let nRows = 0, nPool = 0, nMark = 0;
  const seenQ = new Set();
  await zipStream('WCA_export_results.tsv', (p) => {
    nRows++;
    const pid = p[8], eid = p[6], cid = p[4];
    if (!pid || !eid || !cid) return;
    const dIso = compDate.get(cid); if (!dIso) return;
    const dn = dayNum(dIso);
    const fmt = EV_FMT.get(eid);
    const pi = idxOf(pid);
    for (const [mkRaw, raw, kind] of [[p[10], p[2], 's'], [p[11], p[3], 'a']]) {
      const v = +raw;
      if (!(v > 0)) continue;
      const cost = fmt === 'multi' ? decodeMulti(v) : v;
      /* 全量池（两个轨道都收） */
      const key = eid + '|' + kind;
      let arr = pool.get(key); if (!arr) { arr = []; pool.set(key, arr); }
      arr.push([cost, dn, pi]); nPool++;
      /* WR 标记 → C2 查询 */
      if (mkRaw === 'WR') {
        const qk = pid + '|' + eid + '|' + kind + '|' + cost;
        if (!seenQ.has(qk)) {
          seenQ.add(qk); nMark++;
          let qs = wrQ.get(key); if (!qs) { qs = []; wrQ.set(key, qs); }
          qs.push({ c: cost, day: dn, pi });
        }
      }
    }
  });
  log(`rows=${num(nRows)}  池条目=${num(nPool)}  WR查询=${num(nMark)}  [${((Date.now() - t0) / 1000).toFixed(1)}s]`);

  /* S2 · C2 第二人间隔：值升序扫描，维护「最早达成日期」的最小两元组 */
  log('\n' + '='.repeat(76));
  log('S2 · C2 第二人间隔（第二个人类达成 ≤ v 需要多久）');
  log('='.repeat(76));
  const c2 = new Map();            // pidIdx → {sum, max, n}
  let negGap = 0, capped = 0, nQ = 0;
  const c2Events = [];
  for (const [key, results] of pool) {
    const qs = wrQ.get(key);
    if (!qs || !qs.length) continue;
    /* 合并扫描：结果按 cost 升序，查询插在同 cost 之前需要「≤ 查询值的结果先入池」
       → 排序键 (cost, isQuery)；同 cost 结果在前 */
    const items = [];
    for (const r of results) items.push([r[0], 0, r[1], r[2]]);
    for (const q of qs) items.push([q.c, 1, q.day, q.pi]);
    items.sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
    /* 扫描状态 */
    const firstDate = new Map();   // pidIdx → 最早达成日
    let b1 = { d: Infinity, p: -1 }, b2 = { d: Infinity, p: -1 };
    const upd = (p, d) => {
      const cur = firstDate.get(p);
      if (cur !== undefined && cur <= d) return;
      firstDate.set(p, d);
      if (p === b1.p) { b1.d = d; }
      else if (d < b1.d) { b2 = { d: b1.d, p: b1.p }; b1 = { d, p }; }
      else if (p === b2.p) { if (d < b2.d) b2.d = d; }
      else if (d < b2.d) { b2 = { d, p }; }
    };
    for (const [c, isQ, day, pi] of items) {
      if (!isQ) { upd(pi, day); continue; }
      nQ++;
      let ans;
      if (b1.p >= 0 && b1.p !== pi) ans = b1.d;
      else if (b2.p >= 0 && b2.p !== pi) ans = b2.d;
      else ans = Infinity;
      let gapD = ans === Infinity ? (SNAPSHOT - day) : (ans - day);
      if (ans !== Infinity && gapD < 0) { negGap++; gapD = 0; }
      if (ans === Infinity) capped++;
      const yrs = gapD / 365.25;
      let a = c2.get(pi);
      if (!a) { a = { sum: 0, max: 0, n: 0 }; c2.set(pi, a); }
      a.sum += yrs; a.n++; if (yrs > a.max) a.max = yrs;
      c2Events.push({ pi, eid: key.split('|')[0], kind: key.split('|')[1], day, c, yrs });
    }
  }
  log(`查询=${num(nQ)}  负间隔(钳0)=${num(negGap)}  无人达成封口=${num(capped)}`);
  const c2Arr = [...c2.entries()].map(([pi, a]) => ({ pid: pidName[pi], pi, sum: a.sum, max: a.max, n: a.n, avg: a.sum / a.n }))
    .sort((x, y) => y.sum - x.sum);
  log(`C2 人数=${num(c2Arr.length)}  总量=${F(c2Arr.reduce((s, a) => s + a.sum, 0), 1)} 年`);
  log('  C2-sum Top15:');
  c2Arr.slice(0, 15).forEach((a, i) => log(`   ${String(i + 1).padStart(2)}. ${(pname.get(a.pid) || a.pid).padEnd(26).slice(0, 26)} sum=${F(a.sum, 2).padStart(8)}  max=${F(a.max, 2).padStart(7)}  n=${a.n}`));
  const c2ByMax = [...c2Arr].sort((x, y) => y.max - x.max);
  log('  C2-max Top10（单条最超前）:');
  c2ByMax.slice(0, 10).forEach((a, i) => log(`   ${String(i + 1).padStart(2)}. ${(pname.get(a.pid) || a.pid).padEnd(26).slice(0, 26)} max=${F(a.max, 2).padStart(7)} 年`));

  /* S3 · C3 里程碑首破 */
  log('\n' + '='.repeat(76));
  log('S3 · C3 里程碑首破（final_WR × 几何因子分档，每档首破者 +1）');
  log('='.repeat(76));
  const FACTORS = [5, 4, 3, 2.5, 2, 1.75, 1.5, 1.4, 1.3, 1.25, 1.2, 1.15, 1.1, 1.075, 1.05, 1.04, 1.03, 1.02, 1.015, 1.01, 1.0075, 1.005, 1.003, 1.0];
  const c3 = new Map();            // pidIdx → count
  let nThr = 0;
  for (const [key, results] of pool) {
    if (!results.length) continue;
    results.sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
    const finW = results[0][0];
    /* 阈值降序 = 扫描顺序；先于同 cost 结果关闭（结果 ≤ 阈值者已入池） */
    const thrs = FACTORS.map((f) => finW * f).sort((a, b) => b - a);
    let ti = 0;
    let bestD = Infinity, bestP = -1, bestC = Infinity;
    for (const [c, day, pi] of results) {
      while (ti < thrs.length && c > thrs[ti]) {
        /* 结果 c 已超当前阈值 → 该档归属 = 目前最早达成者 */
        if (bestP >= 0) { c3.set(bestP, (c3.get(bestP) || 0) + 1); nThr++; }
        ti++;
      }
      if (ti >= thrs.length) break;
      if (day < bestD || (day === bestD && c < bestC)) { bestD = day; bestP = pi; bestC = c; }
    }
    while (ti < thrs.length) { if (bestP >= 0) { c3.set(bestP, (c3.get(bestP) || 0) + 1); nThr++; } ti++; }
  }
  const c3Arr = [...c3.entries()].map(([pi, n]) => ({ pid: pidName[pi], count: n }))
    .sort((x, y) => y.count - x.count);
  log(`档位总数=${num(nThr)}  C3 人数=${num(c3Arr.length)}`);
  log('  C3 Top15:');
  c3Arr.slice(0, 15).forEach((a, i) => log(`   ${String(i + 1).padStart(2)}. ${(pname.get(a.pid) || a.pid).padEnd(26).slice(0, 26)} ${a.count} 档`));

  /* S4 · C1 领先幅度（复用 m6b_aggs.tsv tag D） */
  const c1 = new Map();
  {
    const L = fs.readFileSync(path.join(D, 'm6b_aggs.tsv'), 'utf8').trim().split('\n');
    for (const ln of L) {
      const c = ln.split('\t');
      if (c[0] !== 'D') continue;
      const v = +c[3];
      if (Number.isFinite(v)) c1.set(c[1], v);
    }
  }
  log(`\nC1 复用 tag D：${num(c1.size)} 人`);

  /* S5 · 六维参照载入 */
  function loadTsv(file, pc, vc) {
    const L = fs.readFileSync(path.join(D, file), 'utf8').trim().split('\n');
    const m = new Map();
    for (let i = 1; i < L.length; i++) {
      const c = L[i].split('\t');
      const v = +c[vc];
      if (c[pc] && Number.isFinite(v)) m.set(c[pc], v);
    }
    return m;
  }
  const M1 = loadTsv('M1_full.tsv', 0, 2);
  const M2 = loadTsv('M2_ranking.tsv', 1, 3);
  const M4 = loadTsv('M4_seats.tsv', 0, 2);
  const M5 = loadTsv('M5_seats.tsv', 0, 2);
  const M6F1 = loadTsv('M6_seats.tsv', 0, 2);

  /* S6 · 正交性矩阵 */
  log('\n' + '='.repeat(76));
  log('S6 · 正交性矩阵（Spearman，交集样本）');
  log('='.repeat(76));
  const C1m = new Map([...c1].map(([k, v]) => [k, v]));
  const C2s = new Map(c2Arr.map((a) => [a.pid, a.sum]));
  const C2x = new Map(c2Arr.map((a) => [a.pid, a.max]));
  const C2v = new Map(c2Arr.map((a) => [a.pid, a.avg]));
  const C3m = new Map(c3Arr.map((a) => [a.pid, a.count]));
  const DIMS = { C1领先: C1m, C2间隔sum: C2s, C2间隔max: C2x, C2间隔avg: C2v, C3首破: C3m, M1: M1, M2: M2, M4: M4, M5: M5, 'M6F1对手': M6F1 };
  const names = Object.keys(DIMS);
  const hdr = '            ' + names.map((n) => n.slice(0, 9).padStart(10)).join('');
  console.log(hdr);
  for (const a of names) {
    const line = [a.padEnd(12)];
    for (const b of names) {
      if (a === b) { line.push('     —    '); continue; }
      const r = crossRho(DIMS[a], DIMS[b]);
      line.push((Number.isFinite(r.rho) ? r.rho.toFixed(3) + `(${r.n})` : 'n/a').padStart(10));
    }
    console.log(line.join(''));
  }

  /* S7 · 锚点检验 */
  log('\n' + '='.repeat(76));
  log('S7 · 锚点检验（各候选下的名次）');
  log('='.repeat(76));
  const ANCH = ['Feliks Zemdegs', 'Max Park', 'Yiheng Wang', 'Tymon Kolasiński', 'Stanley Chapel', 'Mats Valk', 'Feliks'];
  const rankOf = (m, pid) => {
    const arr = [...m.entries()].sort((x, y) => y[1] - x[1]);
    const i = arr.findIndex(([p]) => p === pid);
    return i >= 0 ? '#' + (i + 1) : '—';
  };
  /* C2/C3 表 keyed by pid-name，其它 keyed by pid */
  const keyFor = (m, nm) => (m === C2s || m === C2x || m === C2v || m === C3m ? nm : null);
  /* pid→name 反查 */
  const nameToPid = new Map([...pname].map(([p, n]) => [n, p]));
  for (const nm of ['Feliks Zemdegs', 'Max Park', 'Yiheng Wang', 'Tymon Kolasi', 'Stanley Chapel', 'Mats Valk', 'Erik Akkersdijk']) {
    /* persons 全名可能带中文后缀（如 "Yiheng Wang (王艺衡)"）→ 用 includes 匹配 */
    let hit = null;
    for (const [p, n] of pname) { if (n.includes(nm)) { hit = p; break; } }
    const pid = hit;
    const line = [nm.padEnd(20)];
    for (const dn of names) {
      const m = DIMS[dn];
      let r = '—';
      if (m.has(pid)) r = rankOf(m, pid);
      else if (m.has(nm)) r = rankOf(m, nm);
      line.push(r.padStart(10));
    }
    console.log(line.join(''));
  }

  /* S8 · 导出 */
  fs.writeFileSync(path.join(D, 'm6d_c2.tsv'),
    'pid\tname\tsum_years\tmax_years\tn\tevents\n' +
    c2Arr.map((a) => `${a.pid}\t${(pname.get(a.pid) || '').replace(/\t/g, ' ')}\t${F(a.sum, 4)}\t${F(a.max, 4)}\t${a.n}`).join('\n') + '\n', 'utf8');
  fs.writeFileSync(path.join(D, 'm6d_c3.tsv'),
    'pid\tname\tmilestones\n' +
    c3Arr.map((a) => `${a.pid}\t${(pname.get(a.pid) || '').replace(/\t/g, ' ')}\t${a.count}`).join('\n') + '\n', 'utf8');
  fs.writeFileSync(path.join(D, 'm6d_c2_events.tsv'),
    'pid\tname\tevent\tkind\tday\tcost\tgap_years\n' +
    c2Events.sort((a, b) => b.yrs - a.yrs).map((e) => `${pidName[e.pi]}\t${(pname.get(pidName[e.pi]) || '').replace(/\t/g, ' ')}\t${e.eid}\t${e.kind === 's' ? 'single' : 'average'}\t${isoOf(e.day)}\t${F(e.c, 2)}\t${F(e.yrs, 3)}`).join('\n') + '\n', 'utf8');
  log('\n→ 已写出 m6d_c2.tsv / m6d_c3.tsv / m6d_c2_events.tsv');
  log(`总耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main().catch((e) => { console.error(e); process.exit(1); });

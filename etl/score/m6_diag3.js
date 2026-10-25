/* =============================================================================
 * M6 诊断 v3：定稿前最后审问
 * =============================================================================
 * v2 的关键发现：
 *   ① 333fm 方向反了（原版把「步数多」当强）
 *   ② multi 的「当年最好成绩」100% 选错
 *   ③ 18,311 条（4.19%）记录「无对手可击败」被记成负基线 = 最重惩罚
 *   ④ ★ 原文档的 ρ(M6,M2)=−0.0106 是**对错误对照物**算的
 *      → 对封存后 M2-F1 实测 ρ=0.2672（修后）
 *   ⑤ ★ 收缩均值变体（C）正交性大幅改善：
 *      ×M1 0.5448→0.0941、×M2 0.2672→0.1584、×M4 0.3346→0.2603、×M5 0.2484→0.1279
 *      但 Top10 与原版只重合 1/10 —— 榜单变了，需要审慎
 *
 * 本脚本：
 *   A  用 M1 全量（4,952 人）重算正交性
 *   B  深入分析 C 变体为何正交性更好、榜单是否合理
 *   C  试更细的收缩参数 k（1/3/5/10/20/50/100）
 *   D  检查「负分占 69%」是否合理 + 一个候选：中心化到 [0,1] 的替代口径
 *   E  检查 M6 与 M1 的相关性来源（为什么 M1 会相关）
 * ============================================================================= */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..', '..');
const ZIP = process.env.M6_ZIP || path.join(ROOT, 'data/raw/WCA_export_v2_288_20261015T000017Z.tsv.zip');
const TMP = process.env.M6_TMP || path.join(ROOT, '.workbuddy/tmp/oc');

const t0 = Date.now();
const stamp = (l) => console.log(`  [${((Date.now() - t0) / 1000).toFixed(1)}s] ${l}`);
const F = (x, n = 4) => Number(x).toFixed(n);
const num = (x) => Number(x).toLocaleString('en-US');

function rankArr(a) {
  const idx = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]);
  const r = new Array(a.length); let i = 0;
  while (i < idx.length) {
    let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const av = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[idx[k][1]] = av;
    i = j + 1;
  }
  return r;
}
function pearson(x, y) {
  const n = x.length; if (n < 3) return null;
  let mx = 0, my = 0;
  for (let i = 0; i < n; i++) { mx += x[i]; my += y[i]; }
  mx /= n; my /= n;
  let nu = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { const a = x[i] - mx, b = y[i] - my; nu += a * b; dx += a * a; dy += b * b; }
  return (dx === 0 || dy === 0) ? null : nu / Math.sqrt(dx * dy);
}
const spearman = (x, y) => { const rx = rankArr(x), ry = rankArr(y); return pearson(rx, ry); };
function median(a) {
  if (!a.length) return null;
  const s = a.slice().sort((x, y) => x - y);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}

function decodeMulti(v) {
  if (v < 1e9) {
    const S = String(v).padStart(10, '0');
    const DD = +S.slice(1, 3), TT = Math.min(+S.slice(3, 8), 99999);
    const diff = 99 - DD;
    return { cost: (99 - diff) * 1e5 + TT, diff, time: TT };
  }
  const S = String(v);
  const SS = +S.slice(1, 3), AA = +S.slice(3, 5), TT = Math.min(+S.slice(5, 10), 99999);
  const solved = 99 - SS, missed = AA - solved, diff = solved - missed;
  return { cost: (99 - diff) * 1e5 + TT, diff, time: TT, solved, attempted: AA };
}

const EVENTS = fs.readFileSync(path.join(TMP, 'WCA_export_events.tsv'), 'utf8').trim().split('\n').map((l) => l.split('\t'));
const EV_FMT = new Map(), EV_NAME = new Map();
{
  const ix = {}; EVENTS[0].forEach((x, i) => ix[x] = i);
  for (let i = 1; i < EVENTS.length; i++) {
    EV_FMT.set(EVENTS[i][ix.id], EVENTS[i][ix.format]);
    EV_NAME.set(EVENTS[i][ix.id], EVENTS[i][ix.name]);
  }
}
const MULTI = new Set([...EV_FMT].filter(([, f]) => f === 'multi').map(([e]) => e));
const NUMBER = new Set([...EV_FMT].filter(([, f]) => f === 'number').map(([e]) => e));
function normVal(eid, v) {
  if (!(v > 0)) return null;
  return EV_FMT.get(eid) === 'multi' ? decodeMulti(v).cost : v;
}

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

async function main() {
  /* S0 */
  const compYear = new Map(), champWC = new Set(), champCC = new Set();
  {
    const lines = fs.readFileSync(path.join(TMP, 'WCA_export_competitions.tsv'), 'utf8').split('\n');
    const ix = {}; lines[0].split('\t').forEach((c, i) => ix[c] = i);
    for (let i = 1; i < lines.length; i++) {
      const p = lines[i].split('\t');
      if (!p[ix.id]) continue;
      compYear.set(p[ix.id], { y: +p[ix.year] });
    }
    const cl = fs.readFileSync(path.join(TMP, 'WCA_export_championships.tsv'), 'utf8').split('\n');
    const ci = {}; cl[0].split('\t').forEach((c, i) => ci[c] = i);
    for (let i = 1; i < cl.length; i++) {
      const p = cl[i].split('\t');
      const t = String(p[ci.championship_type] || '').toLowerCase();
      if (t === 'world') champWC.add(p[ci.competition_id]);
      else if (t) champCC.add(p[ci.competition_id]);
    }
  }
  const pname = new Map();
  await zipStream('WCA_export_persons.tsv', (p) => { if (p[2]) pname.set(p[2], p[0]); });

  /* S1 */
  const finals = new Map(), peyNorm = new Map();
  let nRows = 0;
  await zipStream('WCA_export_results.tsv', (p) => {
    nRows++;
    const pid = p[8], eid = p[6], cid = p[4], rt = p[5];
    if (!pid || !eid || !cid) return;
    const best = +p[2], pos = +p[1];
    if (rt === 'f' || rt === 'c') {
      const key = cid + '|' + eid;
      let arr = finals.get(key); if (!arr) { arr = []; finals.set(key, arr); }
      arr.push({ pid, pos });
    }
    const c = compYear.get(cid); const yr = c ? c.y : 0; if (!yr) return;
    const k = pid + '|' + eid + '|' + yr;
    const nv = normVal(eid, best);
    if (nv !== null) { const cur = peyNorm.get(k); if (cur === undefined || nv < cur) peyNorm.set(k, nv); }
  });
  stamp(`S1 rows=${num(nRows)}`);

  /* S2 实力池（全部修正版：lower=better 统一标量） */
  const poolMap = new Map();
  for (const [k, v] of peyNorm) {
    if (v == null || !(v > 0)) continue;
    const i1 = k.lastIndexOf('|'), i2 = k.lastIndexOf('|', i1 - 1);
    const eid = k.slice(i2 + 1, i1), yr = k.slice(i1 + 1);
    const pk = eid + '|' + yr;
    let arr = poolMap.get(pk); if (!arr) { arr = []; poolMap.set(pk, arr); }
    arr.push({ pid: k.slice(0, i2), v, eid });
  }
  const st = new Map();
  for (const [pk, arr] of poolMap) {
    arr.sort((a, b) => a.v - b.v);          // 统一：小的在前 = 强的在前
    const n = arr.length;
    for (let i = 0; i < n; i++) st.set(arr[i].pid + '|' + pk, n > 1 ? 1 - i / (n - 1) : 1);
  }
  stamp(`S2 实力池 ${num(st.size)}`);

  /* S3 oppQ */
  const podRows = [];
  for (const [key, arr] of finals) {
    const [cid, eid] = key.split('|');
    const c = compYear.get(cid); if (!c) continue;
    const yr = c.y;
    const sorted = arr.slice().sort((a, b) => a.pos - b.pos);
    const podium = sorted.filter((x) => x.pos >= 1 && x.pos <= 3);
    if (!podium.length) continue;
    const tier = champWC.has(cid) ? 'WC' : (champCC.has(cid) ? 'CC' : 'OP');
    for (const p of podium) {
      let qh = 0, nh = 0;
      for (const o of sorted) {
        if (o.pos <= p.pos) continue;
        const q = st.get(o.pid + '|' + eid + '|' + yr);
        if (q !== undefined) { qh += q; nh++; }
      }
      podRows.push({ pid: p.pid, eid, cid, pos: p.pos, tier, year: yr, oppQ: nh ? qh / nh : 0, nOpp: nh });
    }
  }
  /* cell 基线 */
  const cellMap = new Map();
  for (const r of podRows) {
    const k = r.eid + '|' + r.year + '|' + r.tier;
    let a = cellMap.get(k); if (!a) { a = []; cellMap.set(k, a); }
    a.push(r.oppQ);
  }
  const base = new Map();
  for (const [k, a] of cellMap) base.set(k, median(a));
  /* 每条记录的 excess */
  for (const r of podRows) {
    const b = base.get(r.eid + '|' + r.year + '|' + r.tier);
    r.w = r.pos === 1 ? 1 : r.pos === 2 ? 0.6 : 0.4;
    r.ex = r.nOpp === 0 ? 0 : r.oppQ - (b === undefined ? r.oppQ : b);
  }
  stamp(`S3 领奖台记录=${num(podRows.length)}`);

  /* 各种聚合口径 */
  function agg(mode, k) {
    const out = new Map();
    for (const r of podRows) {
      let g = out.get(r.pid); if (!g) { g = { s: 0, n: 0, w: 0 }; out.set(r.pid, g); }
      g.s += r.ex * r.w; g.n++; g.w += r.w;
    }
    if (mode === 'sum') {
      const m = new Map(); for (const [p, v] of out) m.set(p, v.s); return m;
    }
    if (mode === 'shrink') {
      const m = new Map(); for (const [p, v] of out) m.set(p, v.w > 0 ? v.s / (v.w + k) : 0); return m;
    }
    if (mode === 'mean') {
      const m = new Map(); for (const [p, v] of out) m.set(p, v.n > 0 ? v.s / v.n : 0); return m;
    }
    if (mode === 'sqrt') {
      /* Σex·w / n^0.5 —— 介于 sum 与 mean 之间 */
      const m = new Map(); for (const [p, v] of out) m.set(p, v.s / Math.sqrt(v.n)); return m;
    }
    if (mode === 'pos') {
      /* 只保留正 excess（只奖励「击败了强于常态的对手」） */
      const m = new Map();
      for (const r of podRows) {
        if (r.ex <= 0) continue;
        m.set(r.pid, (m.get(r.pid) || 0) + r.ex * r.w);
      }
      return m;
    }
    throw new Error('bad mode');
  }

  /* 外部维度 */
  const ext = {};
  {
    const ld = (file, key, val) => {
      const lines = fs.readFileSync(path.join(__dirname, file), 'utf8').trim().split('\n');
      const hdr = lines[0].split('\t'); const ix = {}; hdr.forEach((h, i) => ix[h] = i);
      const m = new Map();
      for (let i = 1; i < lines.length; i++) { const p = lines[i].split('\t'); m.set(p[ix[key]], +p[ix[val]]); }
      return m;
    };
    ext.M1 = ld('M1_full.tsv', 'pid', 'total');
    ext.M2 = ld('M2_ranking.tsv', 'pid', 'total');
    ext.M4 = ld('M4_seats.tsv', 'pid', 'm4');
    ext.M5 = ld('M5_seats.tsv', 'pid', 'm5');
  }
  stamp(`外部维度：M1=${ext.M1.size} M2=${ext.M2.size} M4=${ext.M4.size} M5=${ext.M5.size}`);

  function corrRow(map, label) {
    const out = [`M6(${label})`.padEnd(18)];
    for (const k of ['M1', 'M2', 'M4', 'M5']) {
      const e = ext[k];
      const ids = [], xv = [], yv = [];
      for (const [pid, v] of map) {
        const ev = e.get(pid);
        if (ev === undefined || !Number.isFinite(ev)) continue;
        ids.push(pid); xv.push(v); yv.push(ev);
      }
      out.push(`×${k} ρ=${F(spearman(xv, yv), 3)} (n=${ids.length})`);
    }
    /* 与领奖台条数 */
    const cnt = new Map();
    for (const r of podRows) cnt.set(r.pid, (cnt.get(r.pid) || 0) + 1);
    const ids = [...map.keys()];
    const x = ids.map((p) => map.get(p));
    const y = ids.map((p) => cnt.get(p) || 0);
    out.push(`×条数 ρ=${F(spearman(x, y), 3)}`);
    console.log('  ' + out.join('  '));
  }

  /* ===== A 口径族对照 ===== */
  console.log('\n========== A  聚合口径族对照（全部基于修正后的实力池 + 无对手记 0） ==========');
  const variants = [];
  variants.push(['sum（原口径）', agg('sum', 0)]);
  for (const k of [1, 3, 5, 10, 20, 50, 100]) variants.push([`shrink k=${k}`, agg('shrink', k)]);
  variants.push(['mean', agg('mean', 0)]);
  variants.push(['sqrt', agg('sqrt', 0)]);
  variants.push(['pos-only', agg('pos', 0)]);
  for (const [lab, m] of variants) corrRow(m, lab);

  /* ===== B 冠军榜对照 ===== */
  console.log('\n========== B  冠军榜对照 ==========');
  const baseTop = [...agg('sum', 0)].sort((a, b) => b[1] - a[1]).slice(0, 15).map((x) => x[0]);
  for (const [lab, m] of variants) {
    const t = [...m].sort((a, b) => b[1] - a[1]).slice(0, 10);
    const ov = t.filter((x) => baseTop.includes(x[0])).length;
    const neg = [...m.values()].filter((v) => v < 0).length;
    console.log(`  ${lab.padEnd(16)} Top10 重合 ${String(ov).padStart(2)}/10  负分 ${String(num(neg)).padStart(6)}/${num(m.size)}  Top5 = ${t.slice(0, 5).map((x) => (pname.get(x[0]) || x[0])).join(', ')}`);
  }

  /* ===== C 正交性最优者的榜单合理性 ===== */
  console.log('\n========== C  shrink 变体的榜单合理性（Top20 全名单） ==========');
  for (const k of [3, 10, 30]) {
    const m = agg('shrink', k);
    const t = [...m].sort((a, b) => b[1] - a[1]).slice(0, 20);
    console.log(`  ── k=${k} ──`);
    t.forEach((x, i) => {
      const cnt = podRows.filter((r) => r.pid === x[0]).length;
      console.log(`    ${String(i + 1).padStart(2)}. ${(pname.get(x[0]) || x[0]).padEnd(26)} ${F(x[1], 3).padStart(8)}  领奖台 ${cnt}`);
    });
  }

  /* ===== D 负分问题 ===== */
  console.log('\n========== D  负分分布诊断 ==========');
  {
    const m = agg('sum', 0);
    const vals = [...m.values()].sort((a, b) => a - b);
    console.log(`  sum 口径：${num(vals.length)} 人，负分 ${num(vals.filter((v) => v < 0).length)}（${F(vals.filter((v) => v < 0).length / vals.length * 100, 1)}%）`);
    console.log(`  中位 ${F(median(vals))}｜p1 ${F(vals[Math.floor(vals.length * 0.01)])}｜p25 ${F(vals[Math.floor(vals.length * 0.25)])}｜p75 ${F(vals[Math.floor(vals.length * 0.75)])}｜p99 ${F(vals[Math.floor(vals.length * 0.99)])}｜max ${F(vals[vals.length - 1])}`);
    console.log('  → 残差口径天然有负分（击败弱于常态的对手 = 负贡献），这是设计使然');
    console.log('  → 但若要进六维总分，负分需要处理（截断 / 平移 / 秩变换）');
    /* 秩变换版 */
    const rk = new Map();
    const sorted = [...m.entries()].sort((a, b) => a[1] - b[1]);
    sorted.forEach((x, i) => rk.set(x[0], (i + 1) / sorted.length));
    console.log('  秩变换后（0~1，无负分）正交性：');
    corrRow(rk, 'rank-sum');
  }

  /* ===== E M1 相关性的来源 ===== */
  console.log('\n========== E  M1 相关性来源诊断 ==========');
  {
    const m = agg('sum', 0);
    const ids = [...m.keys()].filter((p) => ext.M1.has(p));
    const x = ids.map((p) => m.get(p)), y = ids.map((p) => ext.M1.get(p));
    console.log(`  ρ(M6 sum, M1 全量) = ${F(spearman(x, y))}  (n=${num(ids.length)})`);
    /* 分层：按领奖台条数看 */
    const cnt = new Map();
    for (const r of podRows) cnt.set(r.pid, (cnt.get(r.pid) || 0) + 1);
    const strata = [[1, 5], [6, 20], [21, 100], [101, 500], [501, 99999]];
    console.log('  按领奖台条数分层（层内 ρ）：');
    for (const [lo, hi] of strata) {
      const sub = ids.filter((p) => { const c = cnt.get(p) || 0; return c >= lo && c <= hi; });
      if (sub.length < 20) { console.log(`    条数 ${lo}-${hi}：n=${sub.length} 样本不足`); continue; }
      const r = spearman(sub.map((p) => m.get(p)), sub.map((p) => ext.M1.get(p)));
      console.log(`    条数 ${lo}-${hi}：n=${String(sub.length).padStart(5)}  ρ=${F(r)}`);
    }
    console.log('  → 若层内 ρ 显著下降，说明 M6×M1 的相关主要来自「两者都随参赛量增长」，不是内容重复');
  }

  fs.writeFileSync(path.join(TMP, 'm6_diag3_out.json'), JSON.stringify({
    sum: [...agg('sum', 0)].map(([p, v]) => [p, +v.toFixed(6)]),
    shrink10: [...agg('shrink', 10)].map(([p, v]) => [p, +v.toFixed(6)]),
  }));
  stamp(`落盘 m6_diag3_out.json`);
  console.log(`\n--- 总耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s ---`);
}
main().catch((e) => { console.error(e); process.exit(1); });

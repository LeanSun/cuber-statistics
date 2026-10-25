/* =============================================================================
 * M6 结构化诊断 v2（只读）
 * =============================================================================
 * v1 发现的三个问题：
 *   ① 333fm 方向反了（Fewest Moves 步数越少越好，原版按「越多越强」排）
 *   ② multi 项目的 peyBest 用原始编码值比较 → 「当年最好成绩」选错
 *   ③ 强度池只用单次成绩
 *
 * 本脚本做四件事：
 *   A  用「统一归一标量」重扫（time/number/multi 全部 lower=better）→ 天然消除方向类 bug
 *   B  枚举 M6 的口径变体（原版 / 修正 / 修+收缩均值 / 修+对手池变体）做横向对照
 *   C  用**封存后**的 M1-F1 / M2-F1 / M4-F1 / M5-F1 重算正交性矩阵
 *   D  边界情况审计（无对手的记录、负分占比、n 与分数的关系、cell 基线样本量）
 *
 * 运行：node --max-old-space-size=8192 etl/score/m6_diag2.js
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

/* ── 统计 ────────────────────────────────────────────────────────────── */
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

/* ── multi 解码（M4 已封存实现，保证一致）───────────────────────────── */
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

/* ── 事件表 ──────────────────────────────────────────────────────────── */
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

/** 归一标量：lower = better。time(ms) / number(moves) 直接用；multi 解码成 cost */
function normVal(eid, v) {
  if (!(v > 0)) return null;
  const fmt = EV_FMT.get(eid);
  if (fmt === 'multi') return decodeMulti(v).cost;
  return v;
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
  /* ---------- S0 ---------- */
  const compYear = new Map(), champWC = new Set(), champCC = new Set();
  {
    const lines = fs.readFileSync(path.join(TMP, 'WCA_export_competitions.tsv'), 'utf8').split('\n');
    const ix = {}; lines[0].split('\t').forEach((c, i) => ix[c] = i);
    for (let i = 1; i < lines.length; i++) {
      const p = lines[i].split('\t');
      if (!p[ix.id]) continue;
      compYear.set(p[ix.id], { y: +p[ix.year], c: p[ix.country_id], n: p[ix.name] });
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
  stamp(`S0 赛事=${compYear.size} WC=${champWC.size} CC=${champCC.size} persons=${pname.size}`);

  /* ---------- S1 扫 results（一次扫，三套归一）---------- */
  const finals = new Map();       // "cid|event" -> [{pid,pos}]
  const peyNorm = new Map();      // pid|event|year -> 归一标量（lower=better）
  const peyRaw = new Map();       // pid|event|year -> 原始 best（复现原版选择逻辑）
  const peyRawMulti = new Map();  // pid|event|year -> 原始 best（multi 用 cost 选）
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

    /* 原版逻辑：直接比原始值 */
    const curR = peyRaw.get(k);
    if (curR === undefined) peyRaw.set(k, best);
    else if (best > 0 && (curR === 0 || best < curR)) peyRaw.set(k, best);

    /* 修正逻辑：multi 按 cost 选，其余按原值 */
    const nv = normVal(eid, best);
    if (nv !== null) {
      const cur = peyNorm.get(k);
      if (cur === undefined || nv < cur) peyNorm.set(k, nv);
    }
  });
  stamp(`S1 rows=${num(nRows)} 决赛场=${num(finals.size)}`);

  /* multi 选择差异量化 */
  {
    let diff = 0, tot = 0;
    for (const [k, v] of peyNorm) {
      const i1 = k.lastIndexOf('|'), i2 = k.lastIndexOf('|', i1 - 1);
      if (!MULTI.has(k.slice(i2 + 1, i1))) continue;
      tot++;
      const raw = peyRaw.get(k);
      if (raw !== undefined && Math.abs(raw - v) > 1e-9) diff++;
    }
    console.log(`\n【修复②】multi 池条目 ${num(tot)}，其中「当年最好成绩」选择与原版不同：${num(diff)} 条（${F(diff / Math.max(tot, 1) * 100, 1)}%）`);
  }

  /* =====================================================================
   * 强度池构建（可切换）
   * ===================================================================== */
  function buildPool(pey, mode) {
    const pm = new Map();
    for (const [k, v] of pey) {
      if (v == null || !(v > 0)) continue;
      const i1 = k.lastIndexOf('|'), i2 = k.lastIndexOf('|', i1 - 1);
      const eid = k.slice(i2 + 1, i1), yr = k.slice(i1 + 1);
      const pk = eid + '|' + yr;
      let arr = pm.get(pk); if (!arr) { arr = []; pm.set(pk, arr); }
      arr.push({ pid: k.slice(0, i2), v, eid });
    }
    const st = new Map();
    for (const [pk, arr] of pm) {
      const eid = arr[0].eid;
      const isMulti = MULTI.has(eid), isNum = NUMBER.has(eid);
      arr.sort((a, b) => {
        if (isMulti) {
          if (mode === 'orig') return multiScalar(b.v) - multiScalar(a.v);
          return a.v - b.v;                       // cost 越小越强 → 升序
        }
        if (isNum) return mode === 'orig' ? (b.v - a.v) : (a.v - b.v);
        return a.v - b.v;
      });
      const n = arr.length;
      for (let i = 0; i < n; i++) st.set(arr[i].pid + '|' + pk, n > 1 ? 1 - i / (n - 1) : 1);
    }
    return st;
  }
  function multiScalar(v) {
    const s = String(v).padStart(10, '0');
    let solved, t;
    if (s[0] === '1') { solved = 99 - parseInt(s.slice(1, 3), 10); t = parseInt(s.slice(5, 10), 10); }
    else {
      const dd = parseInt(s.slice(1, 3), 10);
      t = parseInt(s.slice(3, 8), 10);
      const mm = parseInt(s.slice(8, 10), 10);
      solved = (99 - dd) + mm;
    }
    if (t >= 99999) t = 0;
    return solved * 1e9 - t;
  }

  /* =====================================================================
   * M6 计算引擎（可切换变体）
   * ===================================================================== */
  function computeM6(st, opt = {}) {
    const shrink = opt.shrink || 0;      // 收缩均值：Σex·w / (Σw + shrink)
    const dropNoOpp = opt.dropNoOpp !== false;  // 无对手的记录：excess 记 0（而非 -base）
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
    /* 聚合 */
    const Tglob = new Map(), Tev = new Map(), m2proxy = new Map();
    for (const r of podRows) {
      const w = r.pos === 1 ? 1 : r.pos === 2 ? 0.6 : 0.4;
      const b = base.get(r.eid + '|' + r.year + '|' + r.tier);
      let ex;
      if (r.nOpp === 0 && dropNoOpp) ex = 0;
      else ex = r.oppQ - (b === undefined ? r.oppQ : b);
      let g = Tglob.get(r.pid); if (!g) { g = { s: 0, n: 0, w: 0 }; Tglob.set(r.pid, g); }
      g.s += ex * w; g.n++; g.w += w;
      const ek = r.pid + '|' + r.eid;
      let e2 = Tev.get(ek); if (!e2) { e2 = { s: 0, n: 0, w: 0 }; Tev.set(ek, e2); }
      e2.s += ex * w; e2.n++; e2.w += w;
      let m = m2proxy.get(r.pid); if (!m) { m = { s: 0, n: 0 }; m2proxy.set(r.pid, m); }
      m.s += w; m.n++;
    }
    /* 收缩均值变体 */
    const Tshrink = new Map();
    for (const [p, v] of Tglob) Tshrink.set(p, v.w > 0 ? v.s / (v.w + shrink) : 0);
    return { podRows, Tglob, Tev, Tshrink, m2proxy, base, cellMap };
  }

  const stOrig = buildPool(peyRaw, 'orig');
  const stFix = buildPool(peyNorm, 'fix');
  stamp(`S2 实力池 orig=${num(stOrig.size)} fix=${num(stFix.size)}`);

  const V = {
    /* A = 完全复现原版（含 333fm 反向 + multi 原始值比较 + 无对手记负基线） */
    A_orig: computeM6(stOrig, { dropNoOpp: false }),
    /* B = 修方向（333fm + multi），保留「无对手记负基线」的原行为 */
    B_fix: computeM6(stFix, { dropNoOpp: false }),
    /* C = 修方向 + 收缩均值（k=10），修方向 + 无对手记 0 */
    C_shrink: computeM6(stFix, { shrink: 10, dropNoOpp: true }),
    D_noOpp: computeM6(stFix, { dropNoOpp: true }),
  };
  V.C_shrink.TshrinkMap = V.C_shrink.Tshrink;
  stamp(`S3 领奖台记录=${num(V.B_fix.podRows.length)}`);

  /* =====================================================================
   * B  变体横向对照
   * ===================================================================== */
  console.log('\n========== B  口径变体横向对照 ==========');
  const valOf = (val) => (val && typeof val === 'object' && val.s !== undefined) ? val.s : val;
  const topOf = (M, n, map) => {
    const src = map || M.Tglob;
    const arr = [];
    for (const [k, val] of src) arr.push([k, valOf(val)]);
    return arr.sort((a, b) => b[1] - a[1]).slice(0, n);
  };
  const A10 = topOf(V.A_orig, 10).map((x) => x[0]);
  for (const [tag, M, map] of [
    ['A 原版', V.A_orig, null],
    ['B 修方向', V.B_fix, null],
    ['C 修+收缩k=10', V.C_shrink, V.C_shrink.Tshrink],
    ['D 修+无对手记0', V.D_noOpp, null]]) {
    const t = topOf(M, 10, map);
    const ov = t.filter((x) => A10.includes(x[0])).length;
    let tot = 0;
    for (const x of (map || M.Tglob)) tot += valOf(x[1]);
    console.log(`  ${tag.padEnd(16)} Top10 与原版重合 ${ov}/10  总量 ${F(tot, 2).padStart(12)}  Top3 = ${t.slice(0, 3).map((x) => (pname.get(x[0]) || x[0])).join(', ')}`);
  }

  /* =====================================================================
   * D  边界情况审计
   * ===================================================================== */
  console.log('\n========== D  边界情况审计（用 B 修后） ==========');
  {
    const rows = V.B_fix.podRows;
    const noOpp = rows.filter((r) => r.nOpp === 0);
    console.log(`  领奖台记录 ${num(rows.length)} 条，其中「无对手可击败」${num(noOpp.length)} 条（${F(noOpp.length / rows.length * 100, 2)}%）`);
    const byPos = new Map();
    for (const r of noOpp) byPos.set(r.pos, (byPos.get(r.pos) || 0) + 1);
    console.log(`    按名次：${[...byPos.entries()].sort().map(([p, n]) => `${p}名 ${num(n)} 条`).join('，')}`);
    console.log('    → 原版给这些记录 oppQ=0，excess = 0 - base = **负的基线**（最重惩罚）');
    console.log('      修正后记 0（无信息 = 不加分不扣分）');

    /* cell 基线样本量 */
    const cellSizes = [...V.B_fix.cellMap.values()].map((a) => a.length).sort((a, b) => a - b);
    console.log(`  基线 cell ${num(cellSizes.length)} 个，样本量：中位 ${median(cellSizes)}，p10 ${cellSizes[Math.floor(cellSizes.length * 0.1)]}，最小 ${cellSizes[0]}，最大 ${cellSizes[cellSizes.length - 1]}`);
    console.log(`    样本量 ≤ 3 的 cell：${num(cellSizes.filter((s) => s <= 3).length)} 个（基线不稳）`);

    /* 分数分布 */
    for (const [tag, M] of [['A 原版', V.A_orig], ['B 修后', V.B_fix], ['C 收缩', V.C_shrink]]) {
      const vals = [...M.Tglob.values()].map((v) => v.s).sort((a, b) => a - b);
      const neg = vals.filter((v) => v < 0).length;
      console.log(`  ${tag.padEnd(8)} 有分 ${num(vals.length)}｜负分 ${num(neg)}（${F(neg / vals.length * 100, 1)}%）｜中位 ${F(median(vals))}｜p99 ${F(vals[Math.floor(vals.length * 0.99)])}｜max ${F(vals[vals.length - 1])}`);
    }
  }

  /* =====================================================================
   * C  正交性矩阵（用封存后的 M1/M2/M4/M5）
   * ===================================================================== */
  console.log('\n========== C  正交性矩阵（封存后 M1-F1 / M2-F1 / M4-F1 / M5-F1） ==========');
  const M4 = new Map(), M5 = new Map(), M2 = new Map(), M1 = new Map();
  {
    const ld = (file, key, val) => {
      const lines = fs.readFileSync(path.join(__dirname, file), 'utf8').trim().split('\n');
      const hdr = lines[0].split('\t'); const ix = {}; hdr.forEach((h, i) => ix[h] = i);
      const m = new Map();
      for (let i = 1; i < lines.length; i++) { const p = lines[i].split('\t'); m.set(p[ix[key]], +p[ix[val]]); }
      return m;
    };
    for (const [p, v] of ld('M4_seats.tsv', 'pid', 'm4')) M4.set(p, v);
    for (const [p, v] of ld('M5_seats.tsv', 'pid', 'm5')) M5.set(p, v);
    for (const [p, v] of ld('M2_ranking.tsv', 'pid', 'total')) M2.set(p, v);
    for (const ln of fs.readFileSync(path.join(__dirname, '纪录分_全站.md'), 'utf8').split('\n')) {
      const m = ln.match(/^\|\s*\d+\s*\|([^|]+)\|\s*[^|]*\|\s*[^|]*\|\s*[^|]*\|\s*[^|]*\|\s*[^|]*\|\s*[^|]*\|\s*\*{0,2}(\d+\.\d+)\*{0,2}\s*\|/);
      if (m) M1.set(m[1].trim(), +m[2]);
    }
  }
  const nameToPid = new Map();
  for (const [pid, nm] of pname) if (!nameToPid.has(nm)) nameToPid.set(nm, pid);
  const M1pid = new Map();
  for (const [nm, v] of M1) { const pid = nameToPid.get(nm); if (pid) M1pid.set(pid, v); }
  stamp(`C 外部维度：M1=${M1pid.size} M2=${M2.size} M4=${M4.size} M5=${M5.size}`);

  function corr(M, map, ext, label) {
    const src = map || M.Tglob;
    const ids = [], xv = [], yv = [];
    for (const [pid, val] of src) {
      const v = valOf(val);
      const e = ext.get(pid);
      if (e === undefined || !Number.isFinite(e)) continue;
      ids.push(pid); xv.push(v); yv.push(e);
    }
    if (ids.length < 10) { console.log(`    M6 × ${label.padEnd(5)} n=${ids.length} 样本不足`); return null; }
    const rho = spearman(xv, yv);
    const m6top = [...src].map(([k, val]) => [k, valOf(val)])
      .sort((a, b) => b[1] - a[1]).slice(0, 25).map((x) => x[0]);
    const etop = [...ext.entries()].filter((x) => Number.isFinite(x[1])).sort((a, b) => b[1] - a[1]).slice(0, 25).map((x) => x[0]);
    const es = new Set(etop);
    console.log(`    M6 × ${label.padEnd(5)} ρ = ${F(rho)}  n=${num(ids.length)}  Top25∩ = ${m6top.filter((p) => es.has(p)).length}/25`);
    return rho;
  }
  for (const [tag, M, map] of [
    ['A 原版', V.A_orig, null],
    ['B 修后', V.B_fix, null],
    ['C 收缩k=10', V.C_shrink, V.C_shrink.Tshrink]]) {
    console.log(`  【${tag}】`);
    corr(M, map, M1pid, 'M1');
    corr(M, map, M2, 'M2');
    corr(M, map, M4, 'M4');
    corr(M, map, M5, 'M5');
    /* 与领奖台条数 */
    const ids = [...M.Tglob.keys()];
    const x = ids.map((p) => M.Tglob.get(p).s);
    const y = ids.map((p) => M.m2proxy.get(p).n);
    console.log(`    M6 × 领奖台条数 ρ = ${F(spearman(x, y))}   （验证「次数不归 M6」）`);
    const champ = new Map();
    for (const r of M.podRows) if (r.pos === 1) champ.set(r.pid, (champ.get(r.pid) || 0) + 1);
    console.log(`    M6 × 冠军数     ρ = ${F(spearman(x, ids.map((p) => champ.get(p) || 0)))}`);
  }

  /* =====================================================================
   * E  单项目分离度（B 修后）
   * ===================================================================== */
  console.log('\n========== E  单项目分离度（B 修后） ==========');
  {
    const byEv = new Map();
    for (const [k, v] of V.B_fix.Tev) {
      const eid = k.slice(k.lastIndexOf('|') + 1);
      let a = byEv.get(eid); if (!a) { a = []; byEv.set(eid, a); }
      a.push({ pid: k.slice(0, k.lastIndexOf('|')), s: v.s });
    }
    const tops = [];
    for (const [eid, a] of [...byEv.entries()].sort()) {
      const t = a.slice().sort((x, y) => y.s - x.s);
      tops.push(t[0].pid);
      console.log(`  ${eid.padEnd(8)} ${(EV_NAME.get(eid) || '').padEnd(28)} ${(pname.get(t[0].pid) || t[0].pid).padEnd(22)} ${F(t[0].s)}`);
    }
    console.log(`  → ${byEv.size} 个项目产出 ${new Set(tops).size} 个不同榜首`);
  }

  /* ---------- 落盘 ---------- */
  fs.writeFileSync(path.join(TMP, 'm6_diag2_out.json'), JSON.stringify({
    Tglob_A: [...V.A_orig.Tglob].map(([p, v]) => [p, +v.s.toFixed(6), v.n]),
    Tglob_B: [...V.B_fix.Tglob].map(([p, v]) => [p, +v.s.toFixed(6), v.n]),
    Tev_B: [...V.B_fix.Tev].map(([k, v]) => [k, +v.s.toFixed(6), v.n]),
    Tglob_C: [...V.C_shrink.Tglob].map(([p, v]) => [p, +v.s.toFixed(6), v.n]),
  }));
  stamp(`落盘 m6_diag2_out.json  峰值堆 ${(process.memoryUsage().heapUsed / 1048576).toFixed(0)}MB`);
  console.log(`\n--- 总耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s ---`);
}
main().catch((e) => { console.error(e); process.exit(1); });

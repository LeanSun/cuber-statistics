/* =============================================================================
 * M6 深度诊断脚本（只读）
 * =============================================================================
 * 目的：M6 口径 T 已在 2026-10-25 下午定稿，但那份实证是在
 *       M1/M2/M4/M5 尚未定稿时做的（相关矩阵算的是「旧口径 M2 代理」「M4 历史版」）。
 *       本脚本做三件事：
 *         Q1  实现正确性审查（333fm 方向 / multi 编码 / pos 语义 / 强度池口径）
 *         Q2  用**封存后**的 M1-F1 / M2-F1 / M4-F1 / M5-F1 重算正交性
 *         Q3  口径参数敏感性 + 单项目分离度
 *
 * 运行：node --max-old-space-size=8192 etl/score/m6_diag.js
 * ============================================================================= */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..', '..');
const ZIP = process.env.M6_ZIP ||
  path.join(ROOT, 'data/raw/WCA_export_v2_288_20261015T000017Z.tsv.zip');
const TMP = process.env.M6_TMP || path.join(ROOT, '.workbuddy/tmp/oc');

const t0 = Date.now();
const stamp = (l) => console.log(`  [${((Date.now() - t0) / 1000).toFixed(1)}s] ${l}`);
const F = (x, n = 4) => Number(x).toFixed(n);
const num = (x) => Number(x).toLocaleString('en-US');

/* ── 统计工具 ────────────────────────────────────────────────────────── */
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
  let num_ = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { const a = x[i] - mx, b = y[i] - my; num_ += a * b; dx += a * a; dy += b * b; }
  if (dx === 0 || dy === 0) return null;
  return num_ / Math.sqrt(dx * dy);
}
const spearman = (x, y) => { const rx = rankArr(x), ry = rankArr(y); return pearson(rx, ry); };
function median(a) {
  if (!a.length) return null;
  const s = a.slice().sort((x, y) => x - y);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}

/* ── multi 解码（M4 已封存实现，抄过来保证一致）─────────────────────── */
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
const EVENTS = fs.readFileSync(path.join(TMP, 'WCA_export_events.tsv'), 'utf8')
  .trim().split('\n').map((l) => l.split('\t'));
const EV_FMT = new Map();       // eid → format
const EV_NAME = new Map();
{
  const c = EVENTS[0]; const ix = {}; c.forEach((x, i) => ix[x] = i);
  for (let i = 1; i < EVENTS.length; i++) {
    const p = EVENTS[i];
    EV_FMT.set(p[ix.id], p[ix.format]);
    EV_NAME.set(p[ix.id], p[ix.name]);
  }
}
const MULTI = new Set([...EV_FMT].filter(([, f]) => f === 'multi').map(([e]) => e));
const NUMBER = new Set([...EV_FMT].filter(([, f]) => f === 'number').map(([e]) => e));
console.log(`事件表：${EV_FMT.size} 个；multi = [${[...MULTI].join(',')}]；number = [${[...NUMBER].join(',')}]`);

/* ── zip 流式读 ──────────────────────────────────────────────────────── */
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

/* ── 外部维度载入（封存后的口径）────────────────────────────────────── */
function loadTsv(file, pick) {
  const lines = fs.readFileSync(path.join(__dirname, file), 'utf8').trim().split('\n');
  const hdr = lines[0].split('\t'); const ix = {}; hdr.forEach((h, i) => ix[h] = i);
  const m = new Map();
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split('\t');
    const v = pick(p, ix); if (v == null) continue;
    m.set(p[ix.pid], v);
  }
  return m;
}

async function main() {
  /* ---------- S0 元信息 ---------- */
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

  /* ---------- S1 扫 results ---------- */
  const finals = new Map();      // "cid|event" -> [{pid,pos,best,avg}]
  const peyBest = new Map();     // "pid|event|year" -> bestRaw
  let nRows = 0;
  const fmtSeen = new Map();     // eid → 出现次数（验证 format 覆盖）
  await zipStream('WCA_export_results.tsv', (p) => {
    nRows++;
    const pid = p[8], eid = p[6], cid = p[4], rt = p[5];
    if (!pid || !eid || !cid) return;
    const best = +p[2], avg = +p[3], pos = +p[1];
    fmtSeen.set(eid, (fmtSeen.get(eid) || 0) + 1);
    if (rt === 'f' || rt === 'c') {
      const key = cid + '|' + eid;
      let arr = finals.get(key); if (!arr) { arr = []; finals.set(key, arr); }
      arr.push({ pid, pos, best, avg });
    }
    const c = compYear.get(cid); const yr = c ? c.y : 0; if (!yr) return;
    const k = pid + '|' + eid + '|' + yr;
    const cur = peyBest.get(k);
    if (cur === undefined) peyBest.set(k, best);
    else if (best > 0 && (cur === 0 || best < cur)) peyBest.set(k, best);
  });
  stamp(`S1 rows=${num(nRows)} 决赛场=${num(finals.size)} 堆=${(process.memoryUsage().heapUsed / 1048576).toFixed(0)}MB`);

  /* =======================================================================
   * Q1-A  333fm 方向审查
   * ======================================================================= */
  console.log('\n========== Q1-A  333fm（Fewest Moves，步数越少越好）方向审查 ==========');
  {
    /* 抽样：333fm 决赛里的 pos 与 best（步数）对应关系 */
    let n = 0; const sample = [];
    for (const [key, arr] of finals) {
      const eid = key.split('|')[1];
      if (eid !== '333fm') continue;
      const s = arr.slice().sort((a, b) => a.pos - b.pos);
      const f = s.filter((x) => x.pos >= 1 && x.pos <= 3 && x.best > 0);
      if (f.length >= 2) { sample.push(f.map((x) => x.pos + '→' + x.best).join(' ')); }
      if (++n >= 4) break;
    }
    console.log('  333fm 决赛 pos→步数（冠军步数应最小）：');
    for (const s of sample) console.log('    ' + s);

    /* 全局统计：pos=1 的 best 与 pos=2/3 的 best 谁更小？ */
    let c1 = 0, c2 = 0, tie = 0;
    for (const [key, arr] of finals) {
      const eid = key.split('|')[1];
      if (eid !== '333fm') continue;
      const s = arr.slice().sort((a, b) => a.pos - b.pos);
      const w = s.find((x) => x.pos === 1 && x.best > 0);
      const l = s.find((x) => x.pos === 2 && x.best > 0);
      if (!w || !l) continue;
      if (w.best < l.best) c1++; else if (w.best > l.best) c2++; else tie++;
    }
    console.log(`  冠军步数 < 亚军步数：${num(c1)} 场；> ：${num(c2)} 场；= ：${num(tie)} 场`);
    console.log(`  → 333fm 的 best 值是「步数」，**越小越强**（Fewest Moves）`);
    console.log(`  ⚠️ m6_strength.js 把 333fm 归入 NUMBER_FMT，排序用 \`isNum ? b.v - a.v\`（降序）`);
    console.log(`     即「步数多的排前面 = 强」→ **333fm 实力池强弱完全颠倒**`);
  }

  /* =======================================================================
   * Q1-B  multi 编码值在 peyBest 里的比较
   * ======================================================================= */
  console.log('\n========== Q1-B  multi 项目 peyBest 用原始编码值比较 ==========');
  {
    let nBad = 0, nTot = 0; const examples = [];
    for (const [k, raw] of peyBest) {
      const i1 = k.lastIndexOf('|'), i2 = k.lastIndexOf('|', i1 - 1);
      const eid = k.slice(i2 + 1, i1);
      if (!MULTI.has(eid)) continue;
      nTot++;
      const d = decodeMulti(raw);
      if (examples.length < 5) examples.push(`${eid} ${k.slice(0, i2)} raw=${raw} → cost=${d.cost} diff=${d.diff}`);
    }
    console.log(`  multi 的 (pid,event,year) 池条目：${num(nTot)}`);
    console.log('  样例：' + examples.join(' | '));
    /* 关键：peyBest 用 `best < cur` 比较原始编码值，但编码值不是单调的 */
    console.log('  ⚠️ S1 里 peyBest 的更新条件是 `best < cur`（比较**原始编码值**），');
    console.log('     而 multi 编码值与实际成绩**不同向**（未解少 → 编码值更大但成绩更好）');
    console.log('     → multi 项目「当年最好成绩」选错，强度池的分位也就跟着错');
  }

  /* =======================================================================
   * Q1-C  强度池只用了 best（单次），没管 average
   * ======================================================================= */
  console.log('\n========== Q1-C  强度池只用单次成绩 ==========');
  {
    console.log('  strength[pid|event|year] 只取 best（单次）列 → 平均轨完全没进实力池');
    console.log('  M5 双轨各计 1.0；M6 这里平均轨的「对手强度」实际是用单次成绩衡量的');
  }

  /* =======================================================================
   * S2 实力池（口径 T 原版，含 333fm 方向 bug）
   * ======================================================================= */
  const poolMap = new Map();
  for (const [k, best] of peyBest) {
    if (best <= 0) continue;
    const i1 = k.lastIndexOf('|'), i2 = k.lastIndexOf('|', i1 - 1);
    const eid = k.slice(i2 + 1, i1), yr = k.slice(i1 + 1);
    const pk = eid + '|' + yr;
    let arr = poolMap.get(pk); if (!arr) { arr = []; poolMap.set(pk, arr); }
    arr.push({ pid: k.slice(0, i2), v: best, eid });
  }
  /* 可插拔的池排序方向 */
  const buildStrength = (fix333fm) => {
    const strength = new Map();
    for (const [pk, arr] of poolMap) {
      const eid = arr[0].eid;
      const isMulti = MULTI.has(eid);
      const isNum = NUMBER.has(eid);
      arr.sort((a, b) => {
        if (isMulti) return decodeMulti(b.v).cost - decodeMulti(a.v).cost;  // cost 越小越强 → 降序
        if (isNum) return fix333fm ? (a.v - b.v) : (b.v - a.v);             // 步数越小越强
        return a.v - b.v;                                                   // 时间越小越强
      });
      const n = arr.length;
      for (let i = 0; i < n; i++) strength.set(arr[i].pid + '|' + pk, n > 1 ? 1 - i / (n - 1) : 1);
    }
    return strength;
  };
  const strengthBug = buildStrength(false);
  const strengthFix = buildStrength(true);
  stamp(`S2 实力池 池数=${num(poolMap.size)} 条目=${num(strengthBug.size)}`);

  /* =======================================================================
   * S3 oppQ + S4 口径 T（可切换强度池）
   * ======================================================================= */
  function computeM6(strength, opts = {}) {
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
          const q = strength.get(o.pid + '|' + eid + '|' + yr);
          if (q !== undefined) { qh += q; nh++; }
        }
        podRows.push({ pid: p.pid, eid, cid, pos: p.pos, tier, year: yr, oppQ: nh ? qh / nh : 0, nOpp: nh });
      }
    }
    /* 赛级基线 */
    const cellMap = new Map();
    for (const r of podRows) {
      const k = r.eid + '|' + r.year + '|' + r.tier;
      let a = cellMap.get(k); if (!a) { a = []; cellMap.set(k, a); }
      a.push(r.oppQ);
    }
    const base = new Map();
    for (const [k, a] of cellMap) base.set(k, median(a));
    const Tglob = new Map(), Tev = new Map(), m2proxy = new Map();
    for (const r of podRows) {
      const w = r.pos === 1 ? 1 : r.pos === 2 ? 0.6 : 0.4;
      const b = base.get(r.eid + '|' + r.year + '|' + r.tier);
      const ex = r.oppQ - (b === undefined ? r.oppQ : b);
      let g = Tglob.get(r.pid); if (!g) { g = { s: 0, n: 0 }; Tglob.set(r.pid, g); }
      g.s += ex * w; g.n++;
      const ek = r.pid + '|' + r.eid;
      let e2 = Tev.get(ek); if (!e2) { e2 = { s: 0, n: 0 }; Tev.set(ek, e2); }
      e2.s += ex * w; e2.n++;
      let m = m2proxy.get(r.pid); if (!m) { m = { s: 0, n: 0 }; m2proxy.set(r.pid, m); }
      m.s += w; m.n++;
    }
    return { podRows, Tglob, Tev, m2proxy, base, cellMap };
  }
  const M6bug = computeM6(strengthBug);
  const M6fix = computeM6(strengthFix);
  stamp(`S3/S4 领奖台记录=${num(M6fix.podRows.length)}`);

  /* ---------- Q1-D 修复前后差异 ---------- */
  console.log('\n========== Q1-D  333fm 方向修复前后对比 ==========');
  {
    const top = (M, n = 15) => [...M.Tglob.entries()]
      .map(([p, v]) => ({ p, v: v.s, n: v.n, name: pname.get(p) || p }))
      .sort((a, b) => b.v - a.v).slice(0, n);
    const A = top(M6bug), B = top(M6fix);
    const setA = new Set(A.map((x) => x.p)), setB = new Set(B.map((x) => x.p));
    console.log('  Top15 重合：' + A.filter((x) => setB.has(x.p)).length + '/15');
    const tA = [...M6bug.Tglob.values()].reduce((a, v) => a + v.s, 0);
    const tB = [...M6fix.Tglob.values()].reduce((a, v) => a + v.s, 0);
    console.log(`  全站总量：原版 ${F(tA)} → 修正 ${F(tB)}（差 ${F(tA - tB)}）`);
    /* 333fm 单独的影响 */
    const fmA = [...M6bug.Tev.entries()].filter(([k]) => k.endsWith('|333fm'));
    const fmB = [...M6fix.Tev.entries()].filter(([k]) => k.endsWith('|333fm'));
    const fmSetA = new Set(fmA.map(([k, v]) => [k, v.s])), fmSetB = new Map(fmB.map(([k, v]) => [k, v.s]));
    let same = 0, diff = 0;
    for (const [k, v] of fmA) { if (fmSetB.has(k)) { if (Math.abs(fmSetB.get(k) - v) < 1e-9) same++; else diff++; } }
    console.log(`  333fm 单项目：条目 ${fmA.length}，分数不变 ${same}，分数改变 ${diff}`);
    console.log('  原版 333fm Top5：');
    for (const x of fmA.map(([k, v]) => ({ k, v: v.s, name: pname.get(k.split('|')[0]) || k.split('|')[0] }))
      .sort((a, b) => b.v - a.v).slice(0, 5)) console.log(`    ${x.name.padEnd(22)} ${F(x.v)}`);
    console.log('  修正 333fm Top5：');
    for (const x of fmB.map(([k, v]) => ({ k, v: v.s, name: pname.get(k.split('|')[0]) || k.split('|')[0] }))
      .sort((a, b) => b.v - a.v).slice(0, 5)) console.log(`    ${x.name.padEnd(22)} ${F(x.v)}`);
  }

  /* =======================================================================
   * Q2  用封存后的 M1/M2/M4/M5 重算正交性
   * ======================================================================= */
  console.log('\n========== Q2  与封存后 M1-F1 / M2-F1 / M4-F1 / M5-F1 的正交性 ==========');
  const M4 = loadTsv('M4_seats.tsv', (p, ix) => +p[ix.m4]);
  const M5 = loadTsv('M5_seats.tsv', (p, ix) => +p[ix.m5]);
  const M2 = new Map();
  {
    const lines = fs.readFileSync(path.join(__dirname, 'M2_ranking.tsv'), 'utf8').trim().split('\n');
    const hdr = lines[0].split('\t'); const ix = {}; hdr.forEach((h, i) => ix[h] = i);
    for (let i = 1; i < lines.length; i++) {
      const p = lines[i].split('\t');
      M2.set(p[ix.pid], +p[ix.total]);
    }
  }
  const M1 = new Map();
  {
    /* M1 纪录分_全站.md：| 名次 | 选手 | 国家 | WR | CR | NR | 段数 | 平均f | 纪录分 | 不折算 |
       —— 关键：**跳过 8 列才落到「纪录分」列**，且 key 是**姓名**不是 pid */
    const f = path.join(__dirname, '纪录分_全站.md');
    if (fs.existsSync(f)) {
      for (const ln of fs.readFileSync(f, 'utf8').split('\n')) {
        const m = ln.match(/^\|\s*\d+\s*\|([^|]+)\|\s*[^|]*\|\s*[^|]*\|\s*[^|]*\|\s*[^|]*\|\s*[^|]*\|\s*[^|]*\|\s*\*{0,2}(\d+\.\d+)\*{0,2}\s*\|/);
        if (m) M1.set(m[1].trim(), +m[2]);
      }
    }
  }
  /* 姓名 → pid 反查（供 M1 用） */
  const nameToPid = new Map();
  for (const [pid, nm] of pname) if (!nameToPid.has(nm)) nameToPid.set(nm, pid);
  const M1byPid = new Map();
  for (const [nm, v] of M1) { const pid = nameToPid.get(nm); if (pid) M1byPid.set(pid, v); }
  stamp(`Q2 外部维度载入：M1=${M1.size}(→pid ${M1byPid.size}) M2=${M2.size} M4=${M4.size} M5=${M5.size}`);

  function corrWith(M6res, ext, label) {
    const ids = [];
    const xv = [], yv = [];
    for (const [pid, v] of M6res.Tglob) {
      const e = ext.get(pid);
      if (e === undefined || !Number.isFinite(e)) continue;
      ids.push(pid); xv.push(v); yv.push(e);
    }
    if (ids.length < 10) { console.log(`  M6 × ${label.padEnd(6)}  n=${ids.length} → 样本不足，跳过`); return null; }
    const rho = spearman(xv, yv);
    /* Top25 重合 */
    const m6top = [...M6res.Tglob.entries()].sort((a, b) => b[1].s - a[1].s).slice(0, 25).map((x) => x[0]);
    const etop = [...ext.entries()].filter((x) => Number.isFinite(x[1]))
      .sort((a, b) => b[1] - a[1]).slice(0, 25).map((x) => x[0]);
    const es = new Set(etop);
    const overlap = m6top.filter((p) => es.has(p)).length;
    console.log(`  M6 × ${label.padEnd(6)}  ρ = ${rho === null ? 'n/a' : F(rho)}  (n=${num(ids.length)})  Top25∩ = ${overlap}/25`);
    return { rho, n: ids.length, overlap };
  }
  console.log('  【原版实现（333fm 方向未修）】');
  corrWith(M6bug, M1byPid, 'M1');
  corrWith(M6bug, M2, 'M2');
  corrWith(M6bug, M4, 'M4');
  corrWith(M6bug, M5, 'M5');
  console.log('  【333fm 方向修正后】');
  corrWith(M6fix, M1byPid, 'M1');
  corrWith(M6fix, M2, 'M2');
  corrWith(M6fix, M4, 'M4');
  corrWith(M6fix, M5, 'M5');

  /* ---------- Q2-B  M6 内部：与领奖台条数的关系 ---------- */
  console.log('\n  【M6 与「领奖台条数」的关系（验证「次数不归 M6」）】');
  {
    const ids = [...M6fix.Tglob.keys()];
    const x = ids.map((p) => M6fix.Tglob.get(p).s);
    const y = ids.map((p) => M6fix.m2proxy.get(p).n);
    console.log(`    ρ(M6分, 领奖台条数) = ${F(spearman(x, y))}  (n=${num(ids)})`);
    const xw = ids.map((p) => M6fix.m2proxy.get(p).s);
    console.log(`    ρ(M6分, 名次加权领奖台) = ${F(spearman(x, xw))}`);
    /* 冠军数 */
    const champ = new Map();
    for (const r of M6fix.podRows) if (r.pos === 1) champ.set(r.pid, (champ.get(r.pid) || 0) + 1);
    const yc = ids.map((p) => champ.get(p) || 0);
    console.log(`    ρ(M6分, 冠军数) = ${F(spearman(x, yc))}`);
  }

  /* =======================================================================
   * Q3  参数敏感性
   * ======================================================================= */
  console.log('\n========== Q3  参数敏感性 ==========');
  {
    const topN = (M, n) => [...M.Tglob.entries()].sort((a, b) => b[1].s - a[1].s).slice(0, n).map((x) => x[0]);
    const baseTop10 = topN(M6fix, 10);
    console.log('  基准（口径 T 原样 + 333fm 修正）Top10：');
    baseTop10.forEach((p, i) => console.log(`    ${String(i + 1).padStart(2)}. ${(pname.get(p) || p).padEnd(24)} ${F(M6fix.Tglob.get(p).s)}`));

    /* Q3-A  强度池「年代」粒度：年 vs 3年窗口
       ⚠️ 窗口模式下 strength 的 key 必须仍能按「原始年份」查到：
          S3 里查的是 strength.get(pid|event|year)，所以窗口池要**按原始年份展开登记**。 */
    const buildStrengthWindow = (win) => {
      const pm = new Map();
      for (const [k, best] of peyBest) {
        if (best <= 0) continue;
        const i1 = k.lastIndexOf('|'), i2 = k.lastIndexOf('|', i1 - 1);
        const eid = k.slice(i2 + 1, i1), yr = +k.slice(i1 + 1);
        const pk = eid + '|' + Math.floor(yr / win);
        let arr = pm.get(pk); if (!arr) { arr = []; pm.set(pk, arr); }
        arr.push({ pid: k.slice(0, i2), v: best, eid, yr });
      }
      const st = new Map();
      for (const [pk, arr] of pm) {
        const eid = arr[0].eid;
        const isMulti = MULTI.has(eid), isNum = NUMBER.has(eid);
        arr.sort((a, b) => {
          if (isMulti) return decodeMulti(b.v).cost - decodeMulti(a.v).cost;
          if (isNum) return a.v - b.v;
          return a.v - b.v;
        });
        const n = arr.length;
        for (let i = 0; i < n; i++) {
          const q = n > 1 ? 1 - i / (n - 1) : 1;
          /* 同一窗口内的每一年都登记同一个分位值 */
          st.set(arr[i].pid + '|' + eid + '|' + arr[i].yr, q);
        }
      }
      return st;
    };
    for (const win of [1, 3, 5]) {
      const st = win === 1 ? strengthFix : buildStrengthWindow(win);
      const M = computeM6(st);
      const t = [...M.Tglob.entries()].sort((a, b) => b[1].s - a[1].s);
      const t10 = t.slice(0, 10).map((x) => x[0]);
      const ov = t10.filter((p) => baseTop10.includes(p)).length;
      const tot = t.reduce((a, x) => a + x[1].s, 0);
      console.log(`  强度池窗口 ${win}y：Top10 与基准重合 ${ov}/10，总量 ${F(tot)}，榜首 ${(pname.get(t[0][0]) || t[0][0])}`);
    }

    /* Q3-B  名次权重 w(r) */
    console.log('\n  名次权重敏感性：');
    for (const [w1, w2, w3, tag] of [[1, 0.6, 0.4, '基准 1/0.6/0.4'], [1, 0.5, 0.25, '1/0.5/0.25'],
      [1, 0.8, 0.6, '1/0.8/0.6'], [1, 0.3, 0.1, '1/0.3/0.1']]) {
      const cellMap = new Map();
      for (const r of M6fix.podRows) {
        const k = r.eid + '|' + r.year + '|' + r.tier;
        let a = cellMap.get(k); if (!a) { a = []; cellMap.set(k, a); }
        a.push(r.oppQ);
      }
      const base = new Map(); for (const [k, a] of cellMap) base.set(k, median(a));
      const agg = new Map();
      for (const r of M6fix.podRows) {
        const w = r.pos === 1 ? w1 : r.pos === 2 ? w2 : w3;
        const b = base.get(r.eid + '|' + r.year + '|' + r.tier);
        const ex = r.oppQ - (b === undefined ? r.oppQ : b);
        agg.set(r.pid, (agg.get(r.pid) || 0) + ex * w);
      }
      const t = [...agg.entries()].sort((a, b) => b[1] - a[1]);
      const t10 = t.slice(0, 10).map((x) => x[0]);
      const ov = t10.filter((p) => baseTop10.includes(p)).length;
      console.log(`    ${tag.padEnd(16)} Top10 重合 ${ov}/10，Top3 = ${t.slice(0, 3).map((x) => (pname.get(x[0]) || x[0])).join(', ')}`);
    }
  }

  /* ---------- Q3-C  单项目分离度 ---------- */
  console.log('\n========== Q3-C  单项目分离度（修正后） ==========');
  {
    const byEv = new Map();
    for (const [k, v] of M6fix.Tev) {
      const eid = k.slice(k.lastIndexOf('|') + 1);
      let a = byEv.get(eid); if (!a) { a = []; byEv.set(eid, a); }
      a.push({ pid: k.slice(0, k.lastIndexOf('|')), s: v.s, n: v.n });
    }
    const tops = [];
    for (const [eid, a] of [...byEv.entries()].sort()) {
      const t = a.slice().sort((x, y) => y.s - x.s);
      tops.push(t[0].pid);
      console.log(`  ${eid.padEnd(8)} ${(EV_NAME.get(eid) || '').padEnd(28)} 榜首 ${(pname.get(t[0].pid) || t[0].pid).padEnd(22)} ${F(t[0].s)}  n=${t[0].n}`);
    }
    console.log(`  → ${byEv.size} 个项目产出 ${new Set(tops).size} 个不同榜首`);
  }

  /* ---------- Q3-D  负分与异常 ---------- */
  console.log('\n========== Q3-D  分数分布 ==========');
  {
    const vals = [...M6fix.Tglob.values()].map((v) => v.s).sort((a, b) => a - b);
    console.log(`  有分人数 ${num(vals.length)}；负分 ${num(vals.filter((v) => v < 0).length)}；零分 ${num(vals.filter((v) => v === 0).length)}`);
    console.log(`  分位：p1=${F(vals[Math.floor(vals.length * 0.01)])} p25=${F(vals[Math.floor(vals.length * 0.25)])} 中位=${F(median(vals))} p75=${F(vals[Math.floor(vals.length * 0.75)])} p99=${F(vals[Math.floor(vals.length * 0.99)])} max=${F(vals[vals.length - 1])}`);
    /* 极端案例 */
    const top = [...M6fix.Tglob.entries()].sort((a, b) => b[1].s - a[1].s).slice(0, 8);
    console.log('  Top8 与其领奖台条数 n：');
    for (const [p, v] of top) console.log(`    ${(pname.get(p) || p).padEnd(24)} ${F(v.s).padStart(9)}  n=${v.n}`);
  }

  /* ---------- Q3-E  与 esum（站点现行总分）的关系 ---------- */
  console.log('\n========== Q3-E  M6 与站点 esum 的关系 ==========');
  {
    /* esum 忠实复刻（V1 权重 + 单次轨 canonical 名次）—— 与 m5_current_rank.js 同口径 */
    const Calc = require(path.join(ROOT, 'js/calc.js'));
    const SITE_W = (ev) => (Calc.EV[ev] ? Calc.EV[ev].w : 0.8);
    const ranks = [];
    for (const [tr, file] of [['single', 'WCA_export_ranks_single.tsv'], ['average', 'WCA_export_ranks_average.tsv']]) {
      await zipStream(file, (p) => {
        if (!p[0]) return;
        ranks.push({ pid: p[1], ev: p[2], tr, wr: +p[3] });
      });
    }
    const siteRank = new Map();
    for (const x of ranks) {
      if (x.wr <= 0) continue;
      let mm = siteRank.get(x.pid); if (!mm) { mm = new Map(); siteRank.set(x.pid, mm); }
      const cur = mm.get(x.ev);
      if (cur == null) mm.set(x.ev, { s: x.tr === 'single' ? x.wr : 0, a: x.tr === 'average' ? x.wr : 0 });
      else if (x.tr === 'single') { if (cur.s === 0 || x.wr < cur.s) cur.s = x.wr; }
      else { if (cur.a === 0 || x.wr < cur.a) cur.a = x.wr; }
    }
    const esum = new Map();
    for (const [pid, mm] of siteRank) {
      let s = 0;
      for (const [ev, o] of mm) { const r = o.s > 0 ? o.s : o.a; if (r <= 0) continue; s += 100 * Math.pow(r, -0.35) * SITE_W(ev); }
      esum.set(pid, s);
    }
    corrWith(M6fix, esum, 'esum');
  }

  /* ---------- 落盘 ---------- */
  const out = {
    Tglob_fix: [...M6fix.Tglob].map(([p, v]) => [p, +v.s.toFixed(6), v.n]),
    Tev_fix: [...M6fix.Tev].map(([k, v]) => [k, +v.s.toFixed(6), v.n]),
    Tglob_bug: [...M6bug.Tglob].map(([p, v]) => [p, +v.s.toFixed(6), v.n]),
  };
  fs.writeFileSync(path.join(TMP, 'm6_diag_out.json'), JSON.stringify(out));
  stamp(`落盘 m6_diag_out.json  峰值堆 ${(process.memoryUsage().heapUsed / 1048576).toFixed(0)}MB`);
  console.log(`\n--- 总耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s ---`);
}
main().catch((e) => { console.error(e); process.exit(1); });

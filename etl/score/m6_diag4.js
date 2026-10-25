/* =============================================================================
 * M6 诊断 v4：口径裁决 —— 以「单项目评价能力」为准绳
 * =============================================================================
 * v3 结果：
 *   sum（原口径）   ×M1 0.174 ×M2 0.270 ×M4 0.350 ×M5 0.245  ×条数 −0.119
 *   sqrt           ×M1 0.215 ×M2 0.229 ×M4 0.321 ×M5 0.198  ×条数 −0.016  Top10重合 7/10
 *   shrink k=1     ×M1 0.247 ×M2 0.143 ×M4 0.195 ×M5 0.060  ×条数 +0.079  Top10重合 0/10
 *   mean           ×M1 0.257 ×M2 0.147 ×M4 0.194 ×M5 0.069  ×条数 +0.172  Top10重合 0/10
 *   pos-only       ×条数 0.757 ← 被次数完全驱动，不可用
 *
 * M6 的原始定位（用户 2026-10-25）：「适合单项目的评价」
 *   → 裁决准绳应该是：**这个口径在单项目内能否识别出该项目的公认强者**，
 *     而不是全站总榜的 ρ 数字好看。
 *
 * 本脚本：
 *   A  三个口径的「项目集中度」对比（sum 会奖励「项目铺得开」的人）
 *   B  单项目榜人工核对：各口径下每个项目的 Top5
 *   C  用「全站公认强者」做锚点检验（各项目历史公认第一是谁）
 *   D  深度上限检验：一个人在一个项目里刷 500 场普通赛，是否能靠 sum 挤进全局榜
 *   E  最终裁决表
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
  const compYear = new Map(), champWC = new Set(), champCC = new Set();
  {
    const lines = fs.readFileSync(path.join(TMP, 'WCA_export_competitions.tsv'), 'utf8').split('\n');
    const ix = {}; lines[0].split('\t').forEach((c, i) => ix[c] = i);
    for (let i = 1; i < lines.length; i++) { const p = lines[i].split('\t'); if (p[ix.id]) compYear.set(p[ix.id], { y: +p[ix.year] }); }
    const cl = fs.readFileSync(path.join(TMP, 'WCA_export_championships.tsv'), 'utf8').split('\n');
    const ci = {}; cl[0].split('\t').forEach((c, i) => ci[c] = i);
    for (let i = 1; i < cl.length; i++) {
      const p = cl[i].split('\t');
      const t = String(p[ci.championship_type] || '').toLowerCase();
      if (t === 'world') champWC.add(p[ci.competition_id]); else if (t) champCC.add(p[ci.competition_id]);
    }
  }
  const pname = new Map();
  await zipStream('WCA_export_persons.tsv', (p) => { if (p[2]) pname.set(p[2], p[0]); });

  const finals = new Map(), peyNorm = new Map();
  await zipStream('WCA_export_results.tsv', (p) => {
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
  const poolMap = new Map();
  for (const [k, v] of peyNorm) {
    if (v == null || !(v > 0)) continue;
    const i1 = k.lastIndexOf('|'), i2 = k.lastIndexOf('|', i1 - 1);
    const pk = k.slice(i2 + 1, i1) + '|' + k.slice(i1 + 1);
    let arr = poolMap.get(pk); if (!arr) { arr = []; poolMap.set(pk, arr); }
    arr.push({ pid: k.slice(0, i2), v, eid: k.slice(i2 + 1, i1) });
  }
  const st = new Map();
  for (const [pk, arr] of poolMap) {
    arr.sort((a, b) => a.v - b.v);
    const n = arr.length;
    for (let i = 0; i < n; i++) st.set(arr[i].pid + '|' + pk, n > 1 ? 1 - i / (n - 1) : 1);
  }
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
      podRows.push({ pid: p.pid, eid, pos: p.pos, tier, year: yr, oppQ: nh ? qh / nh : 0, nOpp: nh });
    }
  }
  const cellMap = new Map();
  for (const r of podRows) {
    const k = r.eid + '|' + r.year + '|' + r.tier;
    let a = cellMap.get(k); if (!a) { a = []; cellMap.set(k, a); }
    a.push(r.oppQ);
  }
  const base = new Map();
  for (const [k, a] of cellMap) base.set(k, median(a));
  for (const r of podRows) {
    const b = base.get(r.eid + '|' + r.year + '|' + r.tier);
    r.w = r.pos === 1 ? 1 : r.pos === 2 ? 0.6 : 0.4;
    r.ex = r.nOpp === 0 ? 0 : r.oppQ - (b === undefined ? r.oppQ : b);
  }
  stamp(`S3 记录 ${num(podRows.length)}`);

  /* 三口径：sum / sqrt / shrink1 */
  const MODES = {
    sum: (g) => g.s,
    sqrt: (g) => g.s / Math.sqrt(g.n),
    shrink1: (g) => g.s / (g.w + 1),
  };
  const aggs = {};
  for (const mode of Object.keys(MODES)) {
    const m = new Map();
    for (const r of podRows) {
      let g = m.get(r.pid); if (!g) { g = { s: 0, n: 0, w: 0 }; m.set(r.pid, g); }
      g.s += r.ex * r.w; g.n++; g.w += r.w;
    }
    aggs[mode] = new Map([...m].map(([p, g]) => [p, MODES[mode](g)]));
  }
  /* 单项目版 */
  const evAgg = {};
  for (const mode of Object.keys(MODES)) {
    const m = new Map();
    for (const r of podRows) {
      const k = r.pid + '|' + r.eid;
      let g = m.get(k); if (!g) { g = { s: 0, n: 0, w: 0 }; m.set(k, g); }
      g.s += r.ex * r.w; g.n++; g.w += r.w;
    }
    evAgg[mode] = new Map([...m].map(([k, g]) => [k, MODES[mode](g)]));
  }

  /* ===== A 项目集中度 ===== */
  console.log('\n========== A  项目集中度（Top20 选手的领奖台分布在几个项目上） ==========');
  {
    const byPidEv = new Map();
    for (const r of podRows) {
      const k = r.pid + '|' + r.eid;
      byPidEv.set(k, (byPidEv.get(k) || 0) + 1);
    }
    const evsOf = (pid) => {
      const s = new Set();
      for (const k of byPidEv.keys()) if (k.startsWith(pid + '|')) s.add(k.slice(pid.length + 1));
      return s;
    };
    for (const mode of Object.keys(MODES)) {
      const t = [...aggs[mode]].sort((a, b) => b[1] - a[1]).slice(0, 20);
      const nEv = t.map((x) => evsOf(x[0]).size);
      const nRec = t.map((x) => podRows.filter((r) => r.pid === x[0]).length);
      console.log(`  ${mode.padEnd(8)} Top20 的项目数：中位 ${median(nEv)}（min ${Math.min(...nEv)} max ${Math.max(...nEv)}）｜领奖台条数：中位 ${median(nRec)}`);
    }
    console.log('  → sum 会奖励「在多个项目反复刷分」的人，正是 M2/M1 已经覆盖的量');
  }

  /* ===== B 单项目榜 ===== */
  console.log('\n========== B  单项目榜 Top3（三口径并列） ==========');
  {
    const evIds = [...new Set([...podRows].map((r) => r.eid))].sort();
    for (const eid of evIds) {
      const line = [];
      for (const mode of Object.keys(MODES)) {
        const arr = [...evAgg[mode]].filter(([k]) => k.endsWith('|' + eid))
          .map(([k, v]) => [k.split('|')[0], v]).sort((a, b) => b[1] - a[1]).slice(0, 3);
        line.push(`${mode}: ${arr.map((x) => (pname.get(x[0]) || x[0])).join('/')}`);
      }
      console.log(`  ${eid.padEnd(8)} ${(EV_NAME.get(eid) || '').padEnd(28)}`);
      for (const l of line) console.log(`      ${l}`);
    }
  }

  /* ===== C 锚点检验：各项目公认第一 ===== */
  console.log('\n========== C  锚点检验 —— 与该项目的世界纪录保持者/公认第一交叉核对 ==========');
  {
    /* 用官方 ranks_single 的 #1 作为「当前公认第一」锚点 */
    const anchors = new Map();
    for (const line of fs.readFileSync(path.join(TMP, 'WCA_export_ranks_single.tsv'), 'utf8').trim().split('\n').slice(1)) {
      const p = line.split('\t');
      if (p[3] && +p[3] === 1) anchors.set(p[2], p[1]);
    }
    const evAggSum = evAgg.sum;
    let hit = 0, tot = 0;
    for (const [eid, pid] of anchors) {
      const arr = [...evAggSum].filter(([k]) => k.endsWith('|' + eid))
        .map(([k, v]) => [k.split('|')[0], v]).sort((a, b) => b[1] - a[1]);
      if (arr.length < 3) continue;
      const rank = arr.findIndex((x) => x[0] === pid) + 1;
      tot++;
      const ok = rank <= 3;
      if (ok) hit++;
      console.log(`  ${eid.padEnd(8)} 官方#1 = ${(pname.get(pid) || pid).padEnd(24)} 在 M6 单项目榜第 ${rank} 名 ${ok ? '✓' : ''}`);
    }
    console.log(`  → sum 口径：官方 #1 落在单项目 M6 前 3 的比例 = ${hit}/${tot}`);
  }

  /* ===== D 刷分抵抗 ===== */
  console.log('\n========== D  刷分抵抗：靠普通赛堆量能否挤进全局榜 ==========');
  {
    const opCnt = new Map(), wcCnt = new Map();
    for (const r of podRows) {
      if (r.tier === 'OP') opCnt.set(r.pid, (opCnt.get(r.pid) || 0) + 1);
      if (r.tier === 'WC') wcCnt.set(r.pid, (wcCnt.get(r.pid) || 0) + 1);
    }
    for (const mode of Object.keys(MODES)) {
      const t = [...aggs[mode]].sort((a, b) => b[1] - a[1]).slice(0, 20);
      const op = t.map((x) => opCnt.get(x[0]) || 0);
      const wc = t.map((x) => wcCnt.get(x[0]) || 0);
      console.log(`  ${mode.padEnd(8)} Top20：普通赛领奖台 中位 ${median(op)}｜世锦赛领奖台 中位 ${median(wc)}｜WC 最多 ${Math.max(...wc)} 条`);
    }
    console.log('  → sum 会让「普通赛刷得多」的人占优（OP 领奖台占全站 92%）；');
    console.log('    shrink/mean 抑制单场大额 excess 的影响，更看「平均质量」');
  }

  /* ===== E 裁决表 ===== */
  console.log('\n========== E  三口径综合裁决表 ==========');
  {
    const ext = {};
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
    const cnt = new Map();
    for (const r of podRows) cnt.set(r.pid, (cnt.get(r.pid) || 0) + 1);
    console.log('  口径        ×M1    ×M2    ×M4    ×M5    ×条数   负分%   单项目榜首数');
    for (const mode of Object.keys(MODES)) {
      const m = aggs[mode];
      const rs = [];
      for (const k of ['M1', 'M2', 'M4', 'M5']) {
        const e = ext[k];
        const ids = [], xv = [], yv = [];
        for (const [pid, v] of m) { const ev = e.get(pid); if (ev === undefined) continue; ids.push(pid); xv.push(v); yv.push(ev); }
        rs.push(spearman(xv, yv));
      }
      const ids = [...m.keys()];
      const rc = spearman(ids.map((p) => m.get(p)), ids.map((p) => cnt.get(p) || 0));
      const neg = [...m.values()].filter((v) => v < 0).length / m.size * 100;
      const tops = new Set();
      for (const eid of new Set([...podRows].map((r) => r.eid))) {
        const arr = [...evAgg[mode]].filter(([k]) => k.endsWith('|' + eid)).sort((a, b) => b[1] - a[1]);
        if (arr.length) tops.add(arr[0][0]);
      }
      console.log(`  ${mode.padEnd(10)} ${F(rs[0], 3)}  ${F(rs[1], 3)}  ${F(rs[2], 3)}  ${F(rs[3], 3)}  ${F(rc, 3)}  ${F(neg, 1)}%   ${tops.size}/21`);
    }
  }

  console.log(`\n--- 总耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s ---`);
}
main().catch((e) => { console.error(e); process.exit(1); });

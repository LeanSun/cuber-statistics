/* =============================================================================
 * M6 诊断 v5：对手池构造的语义审查
 * =============================================================================
 * v4 发现：锚点检验只有 5/21（官方 #1 落在单项目 M6 前 3）。
 *
 * 假说：现行 oppQ 构造有**方向性语义错误**
 *   现行： oppQ(p) = mean{ q(o) : o.pos > p.pos }    ← 只算「排在他后面的人」
 *   问题①：冠军的对手池 = 决赛第 2 名及以后**所有人**（含大量无名之辈），
 *          分位很低 → 拉低冠军 oppQ；而季军的对手池只剩第 4 名之后。
 *          → **名次越好，oppQ 反而越低**（系统性反向）
 *   问题②：被击败的「真正对手」应是**同场领奖台的人**（亚军/季军），
 *          而不是完胜的一堆无名之辈
 *
 * 本脚本对比 4 种对手池定义：
 *   P1 现行     oppQ = mean{ q(o) : o.pos > p.pos }
 *   P2 领奖台池 oppQ = mean{ q(o) : o 是同场领奖台且 o != p }
 *   P3 前二池   oppQ = mean{ q(o) : o.pos < p.pos }   ← 反向（排他前面的）
 *   P4 全场池   oppQ = mean{ q(o) : o != p, o 有 strength }  ← 决赛全体平均
 *
 * 用「谁在同场更靠前」这个对称性 + 锚点检验来裁决。
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
  stamp(`S2 实力池 ${num(st.size)}`);

  /* ── 四种对手池 ── */
  const POOLS = ['P1_beaten', 'P2_podium', 'P3_above', 'P4_all'];
  const rowsBy = {};
  for (const pool of POOLS) rowsBy[pool] = [];

  for (const [key, arr] of finals) {
    const [cid, eid] = key.split('|');
    const c = compYear.get(cid); if (!c) continue;
    const yr = c.y;
    const sorted = arr.slice().sort((a, b) => a.pos - b.pos);
    const podium = sorted.filter((x) => x.pos >= 1 && x.pos <= 3);
    if (!podium.length) continue;
    const tier = champWC.has(cid) ? 'WC' : (champCC.has(cid) ? 'CC' : 'OP');
    const qof = (pid) => st.get(pid + '|' + eid + '|' + yr);
    for (const p of podium) {
      /* P1: 排在他后面的人 */
      let s = 0, n = 0;
      for (const o of sorted) { if (o.pos <= p.pos) continue; const q = qof(o.pid); if (q !== undefined) { s += q; n++; } }
      rowsBy.P1_beaten.push({ pid: p.pid, eid, pos: p.pos, tier, year: yr, oppQ: n ? s / n : 0, nOpp: n });
      /* P2: 同场领奖台的其他人 */
      s = 0; n = 0;
      for (const o of podium) { if (o.pid === p.pid) continue; const q = qof(o.pid); if (q !== undefined) { s += q; n++; } }
      rowsBy.P2_podium.push({ pid: p.pid, eid, pos: p.pos, tier, year: yr, oppQ: n ? s / n : 0, nOpp: n });
      /* P3: 排在他前面的人（反向） */
      s = 0; n = 0;
      for (const o of sorted) { if (o.pos >= p.pos) continue; const q = qof(o.pid); if (q !== undefined) { s += q; n++; } }
      rowsBy.P3_above.push({ pid: p.pid, eid, pos: p.pos, tier, year: yr, oppQ: n ? s / n : 0, nOpp: n });
      /* P4: 全场除自己 */
      s = 0; n = 0;
      for (const o of sorted) { if (o.pid === p.pid) continue; const q = qof(o.pid); if (q !== undefined) { s += q; n++; } }
      rowsBy.P4_all.push({ pid: p.pid, eid, pos: p.pos, tier, year: yr, oppQ: n ? s / n : 0, nOpp: n });
    }
  }
  stamp(`S3 四种对手池记录：${POOLS.map((p) => num(rowsBy[p].length)).join(' / ')}`);

  /* ── 各池的 oppQ 按名次分布（检验「名次越好 oppQ 越低」的反向假说）── */
  console.log('\n========== 反向假说检验：oppQ 按最终名次的均值 ==========');
  for (const pool of POOLS) {
    const by = new Map();
    for (const r of rowsBy[pool]) {
      let a = by.get(r.pos); if (!a) { a = []; by.set(r.pos, a); }
      a.push(r.oppQ);
    }
    const line = [1, 2, 3].map((p) => {
      const a = by.get(p) || [];
      return `${p}名 ${F(median(a))}`;
    }).join('  ｜  ');
    console.log(`  ${pool.padEnd(12)} ${line}`);
  }
  console.log('  → 若「1名」的中位 oppQ **低于**「3名」，说明现行池把名次越好算得越弱');
  console.log('  → 期望：1名 oppQ ≥ 2名 ≥ 3名（击败了更强的对手）');

  /* ── 各池做完整 M6 + 评估 ── */
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
  /* 官方 #1 锚点 */
  const anchors = new Map();
  for (const line of fs.readFileSync(path.join(TMP, 'WCA_export_ranks_single.tsv'), 'utf8').trim().split('\n').slice(1)) {
    const p = line.split('\t');
    if (p[3] && +p[3] === 1) anchors.set(p[2], p[1]);
  }

  console.log('\n========== 四种对手池的 M6 全量评估 ==========');
  const results = {};
  for (const pool of POOLS) {
    const rows = rowsBy[pool];
    /* cell 基线 */
    const cellMap = new Map();
    for (const r of rows) {
      const k = r.eid + '|' + r.year + '|' + r.tier;
      let a = cellMap.get(k); if (!a) { a = []; cellMap.set(k, a); }
      a.push(r.oppQ);
    }
    const base = new Map();
    for (const [k, a] of cellMap) base.set(k, median(a));
    /* 聚合（sum 口径） */
    const g = new Map(), gev = new Map();
    for (const r of rows) {
      const b = base.get(r.eid + '|' + r.year + '|' + r.tier);
      const w = r.pos === 1 ? 1 : r.pos === 2 ? 0.6 : 0.4;
      const ex = r.nOpp === 0 ? 0 : r.oppQ - (b === undefined ? r.oppQ : b);
      let o = g.get(r.pid); if (!o) { o = { s: 0, n: 0 }; g.set(r.pid, o); }
      o.s += ex * w; o.n++;
      const ek = r.pid + '|' + r.eid;
      let e2 = gev.get(ek); if (!e2) { e2 = { s: 0, n: 0 }; gev.set(ek, e2); }
      e2.s += ex * w; e2.n++;
    }
    const M = new Map([...g].map(([p, o]) => [p, o.s]));
    results[pool] = { M, gev };

    const rs = [];
    for (const k of ['M1', 'M2', 'M4', 'M5']) {
      const e = ext[k]; const ids = [], xv = [], yv = [];
      for (const [pid, v] of M) { const ev = e.get(pid); if (ev === undefined) continue; ids.push(pid); xv.push(v); yv.push(ev); }
      rs.push(spearman(xv, yv));
    }
    /* 锚点命中 */
    let hit3 = 0, hit10 = 0, tot = 0;
    for (const [eid, pid] of anchors) {
      const arr = [...gev].filter(([k]) => k.endsWith('|' + eid)).sort((a, b) => b[1].s - a[1].s);
      if (arr.length < 5) continue;
      const rank = arr.findIndex((x) => x[0].split('|')[0] === pid) + 1;
      tot++;
      if (rank <= 3) hit3++;
      if (rank <= 10) hit10++;
    }
    /* 榜首数 */
    const evs = [...new Set(rows.map((r) => r.eid))];
    const tops = new Set();
    for (const eid of evs) {
      const arr = [...gev].filter(([k]) => k.endsWith('|' + eid)).sort((a, b) => b[1].s - a[1].s);
      if (arr.length) tops.add(arr[0][0].split('|')[0]);
    }
    /* 与领奖台条数 */
    const cnt = new Map();
    for (const r of rows) cnt.set(r.pid, (cnt.get(r.pid) || 0) + 1);
    const ids = [...M.keys()];
    const rc = spearman(ids.map((p) => M.get(p)), ids.map((p) => cnt.get(p) || 0));

    console.log(`  ${pool.padEnd(12)} ×M1 ${F(rs[0], 3)} ×M2 ${F(rs[1], 3)} ×M4 ${F(rs[2], 3)} ×M5 ${F(rs[3], 3)} ×条数 ${F(rc, 3)}  锚点 ${hit3}/${tot}(前3) ${hit10}/${tot}(前10)  榜首 ${tops.size}/${evs.length}`);
  }

  /* ── 冠军榜对比 ── */
  console.log('\n========== 四种对手池的全局 Top10 ==========');
  for (const pool of POOLS) {
    const t = [...results[pool].M].sort((a, b) => b[1] - a[1]).slice(0, 10);
    console.log(`  ${pool.padEnd(12)} ${t.map((x) => (pname.get(x[0]) || x[0])).join(', ')}`);
  }

  /* ── 锚点明细（最优的那个）── */
  console.log('\n========== 锚点明细对比（P1 现行 vs P2 领奖台池）==========');
  for (const pool of ['P1_beaten', 'P2_podium']) {
    console.log(`  ── ${pool} ──`);
    const gev = results[pool].gev;
    for (const [eid, pid] of anchors) {
      const arr = [...gev].filter(([k]) => k.endsWith('|' + eid)).sort((a, b) => b[1].s - a[1].s);
      if (arr.length < 5) continue;
      const rank = arr.findIndex((x) => x[0].split('|')[0] === pid) + 1;
      const top = arr.slice(0, 3).map((x) => (pname.get(x[0].split('|')[0]) || x[0]));
      console.log(`    ${eid.padEnd(8)} #1=${(pname.get(pid) || pid).padEnd(22)} 第${String(rank).padStart(4)}名  榜前三: ${top.join(' / ')}`);
    }
  }

  console.log(`\n--- 总耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s ---`);
}
main().catch((e) => { console.error(e); process.exit(1); });

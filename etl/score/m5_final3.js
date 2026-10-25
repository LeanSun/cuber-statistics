/**
 * M5 · 第三轮定稿检验（决定性）
 * ═══════════════════════════════════════════════════════════════════════
 * 前两轮结论：
 *   一轮：F1 窗口重排名的「样本量偏差」是脚本 bug 造成的误判（修正后 corr = -0.1107）。
 *         F1 真正的问题是语义脱钩（222|single 与官方榜 ρ 仅 0.2456）
 *         + 555bf|average 窗口仅 68 人导致深度截断失效。
 *   二轮：F4(max) ≡ F2 —— 因为「PB 达成日 ≤ 末次参赛日」恒成立，故 gP ≥ gR，
 *         max(gR,gP) ≡ gP。真正的分歧只有「乘」还是「替换」。
 *
 * 本轮要回答的决定性问题：
 *   ★ Q1  F3（双衰减相乘）会不会把**现役的世界第一**错误地压到同项目第二名之下？
 *         —— 这是 F2/F3 唯一的语义风险（官方榜说他是 #1，模型说不是）。
 *   ★ Q2  官方 #1 的 PB 年龄分布到底如何？多少 #1 的名次是「化石」？
 *   ★ Q3  F1 窗口口径是否真的修正了「官方 #1 是化石」？
 *         —— 若成立，说明「PB 年龄」确实是需要的信号量。
 *   ★ Q4  M5 × esum 的 0.444 相关究竟来自哪里？
 *         —— 若主要来自「同用官方名次 × 同用 w_e」，则 esum 必须被 M5 取代
 *            （M5 是 esum 的严格细化），而不是两者并存。
 *
 * 只读脚本。
 * 用法：node --max-old-space-size=12288 etl/score/m5_final3.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const RN = require('./runs.js');

const ROOT = path.resolve(__dirname, '../..');
const ZIP = fs.readdirSync(path.join(ROOT, 'data/raw')).filter((f) => f.endsWith('.zip'))[0];
const ZIP_PATH = path.join(ROOT, 'data/raw', ZIP);
const SNAPSHOT_DAY = RN.SNAPSHOT_DAY;
const F = (v) => Number(v).toFixed(4);
const num = (v) => Number(v).toLocaleString('en-US');
const log = (...a) => console.log(...a);

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
const dayOf = (s) => Math.floor(Date.parse(s + 'T00:00:00Z') / 86400000);
function decodeMulti(v) {
  if (v < 1e9) {
    const S = String(v).padStart(10, '0');
    const DD = +S.slice(1, 3), TT = Math.min(+S.slice(3, 8), 99999);
    return { cost: DD * 1e5 + TT };
  }
  const S = String(v);
  const SS = +S.slice(1, 3), AA = +S.slice(3, 5), TT = Math.min(+S.slice(5, 10), 99999);
  const solved = 99 - SS, attempted = AA, missed = attempted - solved;
  return { cost: (99 - (solved - missed)) * 1e5 + TT };
}
function pearson(xs, ys) {
  const n = xs.length; if (n < 3) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let nu = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { const a = xs[i] - mx, b = ys[i] - my; nu += a * b; dx += a * a; dy += b * b; }
  return dx && dy ? nu / Math.sqrt(dx * dy) : null;
}
function rankRho(a, b) {
  const ra = new Map(); for (let i = 0; i < a.length; i++) ra.set(a[i], i + 1);
  const rb = new Map(); for (let i = 0; i < b.length; i++) rb.set(b[i], i + 1);
  const ids = a.filter((x) => rb.has(x));
  if (ids.length < 3) return null;
  return { n: ids.length, rho: pearson(ids.map((x) => ra.get(x)), ids.map((x) => rb.get(x))) };
}
const DEPTH = 100, GAMMA = 1.0, TRACK_W = { single: 1, average: 1 };
const WIN = 365;

(async () => {
  const t0 = Date.now();
  const W = RN.EV_WEIGHT_V2, RETIRED = RN.EV_RETIRED_DAY, FLOOR = RN.WEIGHT_V2_CFG.floor;
  const wOf = (ev) => (W[ev] == null ? FLOOR : W[ev]);

  const evFmt = new Map();
  await streamTsv('WCA_export_events.tsv', (r) => { if (r[0]) evFmt.set(r[0], r[1] || 'time'); });
  const compDay = new Map();
  await streamTsv('WCA_export_competitions.tsv', (r) => {
    if (!r[0] || r[10] === '1') return;
    const y = +r[17] || +r[14]; if (!y) return;
    const m = +r[18] || +r[15] || 1, d = +r[19] || +r[16] || 1;
    compDay.set(r[0], dayOf(y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0')));
  });
  const pName = new Map();
  await streamTsv('WCA_export_persons.tsv', (r) => { if (r[2]) pName.set(r[2], r[0]); });
  log('[1] 基础表就绪');

  const lastByEv = new Map();
  const pbDay = new Map(), pbVal = new Map();
  const win = new Map();       // ev|tr → Map(pid → {v, day})
  const CUT = SNAPSHOT_DAY - WIN;
  let rows = 0;
  await streamTsv('WCA_export_results.tsv', (r) => {
    if (!r[8]) return;
    rows++;
    const day = compDay.get(r[4]);
    if (day === undefined) return;
    const pid = r[8], ev = r[6], isMulti = evFmt.get(ev) === 'multi';
    const k = pid + '|' + ev;
    if (lastByEv.get(k) == null || day > lastByEv.get(k)) lastByEv.set(k, day);
    for (const [tr, raw] of [['single', +r[2]], ['average', +r[3]]]) {
      if (raw <= 0) continue;
      const v = isMulti ? decodeMulti(raw).cost : raw;
      const k3 = pid + '|' + ev + '|' + tr;
      const cur = pbVal.get(k3);
      if (cur == null || v < cur) { pbVal.set(k3, v); pbDay.set(k3, day); }
      else if (v === cur) { const d0 = pbDay.get(k3); if (d0 != null && day < d0) pbDay.set(k3, day); }
      if (day > CUT) {
        const key = ev + '|' + tr;
        let mm = win.get(key); if (!mm) { mm = new Map(); win.set(key, mm); }
        const c = mm.get(pid);
        if (c == null || v < c.v) mm.set(pid, { v, day });
      }
    }
  });
  log('[2] results 扫描完成', num(rows), '行', ((Date.now() - t0) / 1000).toFixed(1) + 's');

  const official = new Map();
  for (const [tr, file] of [['single', 'WCA_export_ranks_single.tsv'],
                             ['average', 'WCA_export_ranks_average.tsv']]) {
    await streamTsv(file, (r) => {
      if (!r[0]) return;
      const key = r[2] + '|' + tr;
      if (!official.has(key)) official.set(key, []);
      official.get(key).push({ pid: r[1], wr: +r[3], best: +r[0] });
    });
  }
  log('[3] 官方榜组合', official.size);

  const dec = (gap, years = 5, floor = 0.2) =>
    Math.max(floor, 1 - (gap / years) * (1 - floor));
  const rankScore = (r) => Math.pow(r, -GAMMA);
  const yrs = (day) => (SNAPSHOT_DAY - day) / 365.25;

  /* ── Q1/Q2：官方 #1 的 PB 年龄 + F3 是否把 #1 压到 #2 之下 ────── */
  log('\n═══════ Q1/Q2 官方 #1 的名次新鲜度，以及 F3 是否把 #1 压到 #2 之下 ═══════');
  log('组合'.padEnd(16) + '#1'.padEnd(22) + 'PBage'.padStart(7) + '参赛gap'.padStart(8) +
      '  #2'.padEnd(22) + 'PBage'.padStart(7) + '  F3后#1排名');
  let demoted = 0, nCombo = 0;
  const demoteList = [];
  for (const [key, arr] of [...official.entries()].sort()) {
    const ev = key.split('|')[0];
    if (RETIRED[ev] != null) continue;
    const tr = key.split('|')[1];
    const w = wOf(ev);
    const ones = arr.filter((x) => x.wr === 1);
    if (!ones.length) continue;
    nCombo++;
    /* 官方 #1 可能多人并列 —— 取并列中 PB 最老的那位（最不利情形） */
    const scored = ones.map((x) => {
      const pd = pbDay.get(x.pid + '|' + ev + '|' + tr);
      const lc = lastByEv.get(x.pid + '|' + ev);
      const gP = pd == null ? 99 : yrs(pd);
      const gR = lc == null ? 99 : yrs(lc);
      const sV0 = w * rankScore(1) * dec(gR);
      const sF3 = w * rankScore(1) * dec(gR) * dec(gP);
      return { x, pd, gP, gR, sV0, sF3 };
    });
    const first = scored.slice().sort((a, b) => b.gP - a.gP)[0];
    const two = arr.filter((x) => x.wr === 2)[0];
    let twoInfo = null;
    if (two) {
      const pd2 = pbDay.get(two.pid + '|' + ev + '|' + tr);
      const lc2 = lastByEv.get(two.pid + '|' + ev);
      const gP2 = pd2 == null ? 99 : yrs(pd2);
      const gR2 = lc2 == null ? 99 : yrs(lc2);
      twoInfo = { name: pName.get(two.pid) || two.pid, gP: gP2, gR: gR2,
        sF3: w * rankScore(2) * dec(gR2) * dec(gP2), sV0: w * rankScore(2) * dec(gR2) };
    }
    /* F3 后 #1 在本组合内的实际名次 */
    const inCombo = arr.filter((x) => x.wr <= DEPTH).map((x) => {
      const pd = pbDay.get(x.pid + '|' + ev + '|' + tr);
      const lc = lastByEv.get(x.pid + '|' + ev);
      const gP = pd == null ? 99 : yrs(pd);
      const gR = lc == null ? 99 : yrs(lc);
      return { pid: x.pid, wr: x.wr, s: w * rankScore(x.wr) * dec(gR) * dec(gP) };
    }).sort((a, b) => b.s - a.s);
    const rankAfter = inCombo.findIndex((z) => z.pid === first.x.pid) + 1;
    const lost = rankAfter > 1;
    if (lost) { demoted++; demoteList.push({ key, first, twoInfo, rankAfter, n: inCombo.length }); }
    log(key.padEnd(16) + (pName.get(first.x.pid) || first.x.pid).slice(0, 21).padEnd(22) +
      F(first.gP).padStart(7) + 'y' + F(first.gR).padStart(7) + 'y' +
      '  ' + (twoInfo ? twoInfo.name.slice(0, 21).padEnd(22) : '—'.padEnd(22)) +
      (twoInfo ? F(twoInfo.gP).padStart(7) : '—'.padStart(7)) + 'y' +
      '  ' + (lost ? '↓ 第' + rankAfter + '名' : '保持 #1'));
  }
  log('\n  组合数 ' + nCombo + '｜F3 后官方 #1 被压出本项目第一的组合：' + demoted);
  for (const d of demoteList) {
    log('    ' + d.key.padEnd(16) + '#1 ' + (pName.get(d.first.x.pid) || d.first.x.pid) +
      '（PB ' + F(d.first.gP) + 'y / 参赛 ' + F(d.first.gR) + 'y）→ F3 后第 ' + d.rankAfter + ' 名' +
      (d.twoInfo ? '｜原 #2 ' + d.twoInfo.name + '（PB ' + F(d.twoInfo.gP) + 'y）' : ''));
  }

  /* ── Q3：F1 窗口口径是否真的修正了「官方 #1 是化石」 ─────────── */
  log('\n═══════ Q3 窗口重排名是否真的修正「官方 #1 是化石」═══════');
  {
    let same = 0, diff = 0;
    const diffList = [];
    for (const [key, mm] of win) {
      const ev = key.split('|')[0];
      if (RETIRED[ev] != null) continue;
      const tr = key.split('|')[1];
      const list = [...mm.entries()].map(([pid, o]) => ({ pid, v: o.v, day: o.day }));
      if (!list.length) continue;
      list.sort((a, b) => a.v - b.v || a.day - b.day
        || (pName.get(a.pid) || '').localeCompare(pName.get(b.pid) || ''));
      const w1 = list[0].pid;
      const off = official.get(key) || [];
      const o1 = off.filter((x) => x.wr === 1).map((x) => x.pid);
      if (!o1.length) continue;
      if (o1.includes(w1)) { same++; continue; }
      diff++;
      const pd = pbDay.get(w1 + '|' + ev + '|' + tr);
      const lc = lastByEv.get(w1 + '|' + ev);
      diffList.push({
        key, w1name: pName.get(w1) || w1, w1v: list[0].v,
        w1gP: pd == null ? 99 : yrs(pd), w1gR: lc == null ? 99 : yrs(lc),
        off1: o1.map((p) => ({ name: pName.get(p) || p, gP: (() => { const d = pbDay.get(p + '|' + ev + '|' + tr); return d == null ? 99 : yrs(d); })() })),
        offRankOfW1: (off.find((x) => x.pid === w1) || {}).wr,
      });
    }
    log('  窗口 #1 仍是官方 #1 的组合：' + same + '｜不同的组合：' + diff);
    for (const d of diffList) {
      log('    ' + d.key.padEnd(16) + '窗口#1 = ' + d.w1name.slice(0, 22).padEnd(23) +
        '（官方 #' + d.offRankOfW1 + '，PB ' + F(d.w1gP) + 'y，参赛 ' + F(d.w1gR) + 'y）');
      for (const o of d.off1) {
        log('        官方#1 ' + o.name.slice(0, 22).padEnd(23) + ' PB ' + F(o.gP) + 'y');
      }
    }
    log('\n  → 若「窗口 #1 ≠ 官方 #1」的组合里，官方 #1 的 PB 年龄普遍很大，');
    log('    则说明「PB 年龄」确实捕捉到了「名次已陈旧」这一信号。');
  }

  /* ── Q4：M5 × esum 的 0.44 来自哪里 ─────────────────────────── */
  log('\n═══════ Q4 M5 × esum 的相关性来源拆解 ═══════');
  {
    const dec2 = (g) => dec(g);
    const mkEsum = (useDepth, useDecay) => {
      const m = new Map();
      for (const [key, arr] of official) {
        const ev = key.split('|')[0];
        const w = wOf(ev);
        for (const x of arr) {
          if (useDepth && x.wr > DEPTH) continue;
          if (x.wr <= 0) continue;
          const nm = pName.get(x.pid) || x.pid;
          let s = 100 * Math.pow(x.wr, -0.35) * w;
          if (useDecay) {
            const lc = lastByEv.get(x.pid + '|' + ev);
            const gR = lc == null ? 99 : yrs(lc);
            s *= dec2(gR);
          }
          m.set(nm, (m.get(nm) || 0) + s);
        }
      }
      return m;
    };
    const mkM5 = (mode) => {
      const m = new Map();
      for (const [key, arr] of official) {
        const ev = key.split('|')[0];
        if (RETIRED[ev] != null) continue;
        const tr = key.split('|')[1];
        const w = wOf(ev);
        for (const x of arr) {
          if (x.wr > DEPTH) continue;
          const lc = lastByEv.get(x.pid + '|' + ev);
          const gR = lc == null ? 99 : yrs(lc);
          const pd = pbDay.get(x.pid + '|' + ev + '|' + tr);
          const gP = pd == null ? 99 : yrs(pd);
          let d = dec(gR);
          if (mode === 'F3') d = dec(gR) * dec(gP);
          const s = w * Math.pow(x.wr, -1.0) * d;
          const nm = pName.get(x.pid) || x.pid;
          m.set(nm, (m.get(nm) || 0) + s);
        }
      }
      return m;
    };
    const rho = (A, B) => {
      const a = [...A.entries()].sort((x, y) => y[1] - x[1]).slice(0, 100);
      const b = [...B.entries()].sort((x, y) => y[1] - x[1]).slice(0, 100);
      const ra = new Map(); a.forEach((z, i) => ra.set(z[0], i + 1));
      const rb = new Map(); b.forEach((z, i) => rb.set(z[0], i + 1));
      const names = [...ra.keys()].filter((n) => rb.has(n));
      return { n: names.length, rho: pearson(names.map((n) => ra.get(n)), names.map((n) => rb.get(n))) };
    };
    const m5v0 = mkM5('V0'), m5f3 = mkM5('F3');
    const esumRaw = mkEsum(false, false);
    const esumDepth = mkEsum(true, false);
    const esumDepthDecay = mkEsum(true, true);
    for (const [tag, m] of [['esum 原始（现行站点口径）', esumRaw],
                           ['esum + 深度100', esumDepth],
                           ['esum + 深度100 + 退役衰减', esumDepthDecay]]) {
      const r0 = rho(m5v0, m), r3 = rho(m5f3, m);
      log('  ' + tag.padEnd(28) + '×M5(V0) ρ=' + (r0 ? F(r0.rho) : '—') +
        '（n=' + (r0 ? r0.n : '—') + '）｜×M5(F3) ρ=' + (r3 ? F(r3.rho) : '—') +
        '（n=' + (r3 ? r3.n : '—') + '）');
    }
    log('\n  → esum 与 M5 的同源性来自「同一份官方名次 + 同一套 w_e」。');
    log('    M5 是 esum 的严格细化（加了深度截断 + 双衰减 + γ 从 0.35 收到 1.0）。');
  }

  /* ── 5. F3 最终基线与榜 ─────────────────────────────────────── */
  log('\n═══════ F3 最终基线 ═══════');
  const mkF3 = () => {
    const m = new Map();
    for (const [key, arr] of official) {
      const ev = key.split('|')[0];
      if (RETIRED[ev] != null) continue;
      const tr = key.split('|')[1];
      const w = wOf(ev);
      for (const x of arr) {
        if (x.wr > DEPTH) continue;
        const lc = lastByEv.get(x.pid + '|' + ev);
        const gR = lc == null ? 99 : yrs(lc);
        const pd = pbDay.get(x.pid + '|' + ev + '|' + tr);
        const gP = pd == null ? 99 : yrs(pd);
        const s = w * rankScore(x.wr) * dec(gR) * dec(gP);
        if (s <= 0) continue;
        m.set(x.pid, (m.get(x.pid) || 0) + s);
      }
    }
    return [...m.entries()].map(([pid, s]) => ({ pid, s, name: pName.get(pid) || pid }))
      .sort((a, b) => b.s - a.s || a.name.localeCompare(b.name));
  };
  const A3 = mkF3();
  log('  人数 ' + num(A3.length) + '｜总量 ' + F(A3.reduce((a, b) => a + b.s, 0)));
  log('  Top25：');
  A3.slice(0, 25).forEach((p, i) => log('   ' + String(i + 1).padStart(3) + ' ' + p.name.padEnd(28) + F(p.s)));

  log('\n耗时', ((Date.now() - t0) / 1000).toFixed(1) + 's');
})();

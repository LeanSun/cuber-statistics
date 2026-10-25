/**
 * M5 · F1 窗口重排名 · 决策版全量对照
 * ═══════════════════════════════════════════════════════════════════════
 * 上一轮发现的关键问题：窗口内成绩**并列极密集**，同名次口径会让
 * DEPTH=100 的截断失效（33 组合产出 12,227 条 > 3,300 上限）。
 *   → 本脚本改用**序号口径**（第 i 名 = 序号 i，深度截断严格生效）。
 *
 * 对照口径：
 *   V0   官方终身榜 × 衰减(项目内末次参赛)          ← 现状
 *   F1s  窗口重排名(序号口径) × 无衰减
 *   F1b  窗口重排名(序号口径) × 衰减(项目内末次参赛)
 *   F2   官方名次 × 衰减(PB 首次达成日)              ← 最小改动方案
 *
 * 附加指标：与站点 esum 的重复度、各口径的「第一名占位合理性」抽查。
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

const DEPTH = 100, GAMMA = 1.0, DECAY_YEARS = 5, DECAY_FLOOR = 0.2;
const TRACK_W = { single: 1, average: 1 };
const decayOf = (gap) => Math.max(DECAY_FLOOR, 1 - (gap / DECAY_YEARS) * (1 - DECAY_FLOOR));
const rankScore = (r) => Math.pow(r, -GAMMA);

function pearson(xs, ys) {
  const n = xs.length; if (n < 3) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let nu = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { const a = xs[i] - mx, b = ys[i] - my; nu += a * b; dx += a * a; dy += b * b; }
  return dx && dy ? nu / Math.sqrt(dx * dy) : null;
}
/** 已是名次的两组数据 → Pearson(=Spearman) */
function rankRho(a, b) {
  const ra = new Map(); for (let i = 0; i < a.length; i++) ra.set(a[i], i + 1);
  const rb = new Map(); for (let i = 0; i < b.length; i++) rb.set(b[i], i + 1);
  const ids = a.filter((x) => rb.has(x));
  if (ids.length < 3) return null;
  return { n: ids.length, rho: pearson(ids.map((x) => ra.get(x)), ids.map((x) => rb.get(x))) };
}

(async () => {
  const t0 = Date.now();
  const log = (...a) => console.log(...a);

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

  /* ── 扫 results ─────────────────────────────────────────────────── */
  const lastByEv = new Map(), lastAll = new Map();
  const pbDay = new Map(), pbVal = new Map();
  const WIN = 365, CUT = SNAPSHOT_DAY - WIN;
  const win = new Map();          // ev|tr → Map(pid → {v, day})
  let rows = 0;
  await streamTsv('WCA_export_results.tsv', (r) => {
    if (!r[8]) return;
    rows++;
    const day = compDay.get(r[4]);
    if (day === undefined) return;
    const pid = r[8], ev = r[6], isMulti = evFmt.get(ev) === 'multi';
    const k = pid + '|' + ev;
    if (lastByEv.get(k) == null || day > lastByEv.get(k)) lastByEv.set(k, day);
    if (lastAll.get(pid) == null || day > lastAll.get(pid)) lastAll.set(pid, day);
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
  log('[1] 成绩行', num(rows), '；耗时', ((Date.now() - t0) / 1000).toFixed(1) + 's');

  /* ── 官方榜 ─────────────────────────────────────────────────────── */
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
  log('[2] 官方组合', official.size);

  /* ── 计分 ───────────────────────────────────────────────────────── */
  const scV0 = new Map(), scF2 = new Map(), scF1s = new Map(), scF1b = new Map();
  const partsF1 = new Map();     // pid → [{ev,tr,wr,...}]（F1s 口径，用于明细）

  for (const [key, arr] of official) {
    const ev = key.split('|')[0];
    if (RETIRED[ev] != null) continue;
    const tr = key.split('|')[1], tw = TRACK_W[tr]; if (!tw) continue;
    const w = wOf(ev);
    for (const x of arr) {
      if (x.wr > DEPTH) continue;
      const lc = lastByEv.get(x.pid + '|' + ev);
      const gap = lc == null ? 99 : (SNAPSHOT_DAY - lc) / 365.25;
      const s = w * rankScore(x.wr) * decayOf(gap) * tw;
      if (s > 0) scV0.set(x.pid, (scV0.get(x.pid) || 0) + s);
      const pd = pbDay.get(x.pid + '|' + ev + '|' + tr);
      const gap2 = pd == null ? 99 : (SNAPSHOT_DAY - pd) / 365.25;
      const s2 = w * rankScore(x.wr) * decayOf(gap2) * tw;
      if (s2 > 0) scF2.set(x.pid, (scF2.get(x.pid) || 0) + s2);
    }
  }

  /* F1：窗口重排名 —— 序号口径（深度严格生效） */
  let nEntries = 0;
  for (const [key, mm] of win) {
    const ev = key.split('|')[0];
    if (RETIRED[ev] != null) continue;
    const tr = key.split('|')[1], tw = TRACK_W[tr]; if (!tw) continue;
    const w = wOf(ev);
    const list = [...mm.entries()].map(([pid, o]) => ({ pid, v: o.v, day: o.day }));
    list.sort((a, b) => a.v - b.v || a.day - b.day || (pName.get(a.pid) || '').localeCompare(pName.get(b.pid) || ''));
    for (let i = 0; i < Math.min(DEPTH, list.length); i++) {
      const it = list[i];
      const rank = i + 1;                       // 序号口径
      const lc = lastByEv.get(it.pid + '|' + ev);
      const gap = lc == null ? 99 : (SNAPSHOT_DAY - lc) / 365.25;
      const base = w * rankScore(rank) * tw;
      scF1s.set(it.pid, (scF1s.get(it.pid) || 0) + base);
      scF1b.set(it.pid, (scF1b.get(it.pid) || 0) + base * decayOf(gap));
      nEntries++;
      if (!partsF1.has(it.pid)) partsF1.set(it.pid, []);
      partsF1.get(it.pid).push({ ev, tr, wr: rank, v: it.v, w, gap, dec: decayOf(gap), score: base });
    }
  }
  log('[3] F1 窗口条目（≤' + DEPTH + '）', num(nEntries));

  const toArr = (sc) => [...sc.entries()]
    .map(([pid, s]) => ({ pid, s, name: pName.get(pid) || pid }))
    .sort((a, b) => b.s - a.s || a.name.localeCompare(b.name));

  const A0 = toArr(scV0), A2 = toArr(scF2), A1s = toArr(scF1s), A1b = toArr(scF1b);

  /* ── esum 参照（站点口径） ──────────────────────────────────────── */
  const esum = new Map();
  {
    const EV_GAMMA = 0.35;
    for (const [key, arr] of official) {
      const ev = key.split('|')[0];
      const w = wOf(ev);
      for (const x of arr) {
        if (x.wr <= 0) continue;
        esum.set(x.pid, (esum.get(x.pid) || 0) + 100 * Math.pow(x.wr, -EV_GAMMA) * w);
      }
    }
  }
  /* esum 的 key 是 pid，需转成 name 才能与榜单对齐 */
  const esumByName = new Map();
  for (const [pid, v] of esum) esumByName.set(pName.get(pid) || pid, v);

  /* ── 外部参照 ───────────────────────────────────────────────────── */
  const m4 = new Map();
  for (const ln of fs.readFileSync(path.join(__dirname, 'M4_seats.tsv'), 'utf8').trim().split('\n').slice(1)) {
    const c = ln.split('\t'); m4.set(c[1], +c[2]);
  }
  const m2 = new Map();
  for (const ln of fs.readFileSync(path.join(__dirname, 'M2_ranking.tsv'), 'utf8').trim().split('\n').slice(1)) {
    const c = ln.split('\t'); m2.set(c[2], +c[3]);
  }
  const rhoWith = (arr, src, limit) => {
    const ra = new Map(); for (let i = 0; i < Math.min(limit, arr.length); i++) ra.set(arr[i].name, i + 1);
    const srcArr = [...src.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
    const rb = new Map(); for (let i = 0; i < srcArr.length; i++) rb.set(srcArr[i][0], i + 1);
    return rankRho(arr.slice(0, limit).map((x) => x.name), srcArr.map((x) => x[0]));
  };

  /* ── 汇总 ───────────────────────────────────────────────────────── */
  log('\n═══════ 四个口径总览（序号口径 F1）═══════');
  log('口径'.padEnd(14) + '人数'.padStart(7) + '总量'.padStart(11) + '×M4'.padStart(9) + '×M2'.padStart(9) +
    '×esum'.padStart(9) + '  Top10');
  for (const [tag, arr] of [['V0 现状', A0], ['F1s 窗口(无衰减)', A1s], ['F1b 窗口(+衰减)', A1b], ['F2 PB新鲜度', A2]]) {
    const s4 = rhoWith(arr, m4, 100), s2 = rhoWith(arr, m2, 100), se = rhoWith(arr, esumByName, 100);
    log(tag.padEnd(14) + String(arr.length).padStart(7) +
      F(arr.reduce((a, b) => a + b.s, 0)).padStart(11) +
      (s4 ? F(s4.rho) : '—').padStart(9) + (s2 ? F(s2.rho) : '—').padStart(9) +
      (se ? F(se.rho) : '—').padStart(9) + '  ' +
      arr.slice(0, 10).map((x) => x.name.split(' ')[0]).join(' '));
  }

  log('\n═══════ Top 重合度（vs V0）═══════');
  const n0 = new Set(A0.slice(0, 25).map((x) => x.name));
  const t0n = A0.slice(0, 10).map((x) => x.name);
  for (const [tag, arr] of [['F1s', A1s], ['F1b', A1b], ['F2', A2]]) {
    const tn = arr.slice(0, 10).map((x) => x.name);
    log(tag.padEnd(6) + ' Top25 重合 ' + arr.slice(0, 25).filter((x) => n0.has(x.name)).length + '/25' +
      '　Top10 重合 ' + arr.slice(0, 10).filter((x) => n0.has(x.name)).length + '/10' +
      '　Top10 进出：进 ' + (tn.filter((x) => !t0n.includes(x)).join(', ') || '无') +
      '｜出 ' + (t0n.filter((x) => !tn.includes(x)).join(', ') || '无'));
  }

  log('\n═══════ 头部选手逐口径 ═══════');
  const FOCUS = ['Feliks Zemdegs', 'Max Park', 'Tymon Kolasiński', 'Timofei Tarasenko',
    'Stanley Chapel', 'Xuanyi Geng (耿暄一)', 'Yiheng Wang (王艺衡)', 'Ziyu Wu (吴梓宇)'];
  log('选手'.padEnd(24) + 'V0'.padStart(9) + 'F1s'.padStart(9) + 'F1b'.padStart(9) + 'F2'.padStart(9) +
    '   V0名次 F1s F1b  F2');
  for (const nm of FOCUS) {
    const idx = (A) => { const i = A.findIndex((x) => x.name === nm); return i < 0 ? null : i; };
    const i0 = idx(A0), i1 = idx(A1s), i1b = idx(A1b), i2 = idx(A2);
    const val = (A, i) => (i == null ? '—' : F(A[i].s));
    const rk = (i) => (i == null ? '—' : '#' + (i + 1));
    log(nm.padEnd(24) + val(A0, i0).padStart(9) + val(A1s, i1).padStart(9) +
      val(A1b, i1b).padStart(9) + val(A2, i2).padStart(9) + '   ' +
      rk(i0).padStart(6) + rk(i1).padStart(5) + rk(i1b).padStart(5) + rk(i2).padStart(4));
  }

  log('\n═══════ Feliks 在各口径下的构成（F1s 前 12 项）═══════');
  {
    const fid = [...partsF1.keys()].find((p) => pName.get(p) === 'Feliks Zemdegs');
    if (fid) {
      const ps = partsF1.get(fid).sort((a, b) => b.score - a.score);
      for (const d of ps.slice(0, 12)) {
        log('  ' + d.ev.padEnd(8) + d.tr.padEnd(9) + '窗口名次 #' + String(d.wr).padStart(3) +
          '  v=' + String(d.v).padStart(9) + '  w=' + F(d.w) + '  gap=' + d.gap.toFixed(2) + 'y  贡献=' + F(d.score));
      }
      log('  合计 ' + F(ps.reduce((a, b) => a + b.score, 0)) + '（' + ps.length + ' 个组合）');
    } else log('  Feliks 不在 F1 窗口榜内');
  }

  /* ── 关键案例：333fm|single —— 当前真正的最快是谁 ─────────────── */
  log('\n═══════ 案例：333fm|single 当前第一（各口径）═══════');
  {
    const key = '333fm|single';
    const off = official.get(key).filter((x) => x.wr <= 6).sort((a, b) => a.wr - b.wr || a.pid.localeCompare(b.pid));
    log('  官方终身榜 Top（world_rank / PB首次日 / 365天窗口内最好成绩）：');
    for (const x of off.slice(0, 6)) {
      const pd = pbDay.get(x.pid + '|333fm|single');
      const w365 = win.get(key) ? win.get(key).get(x.pid) : null;
      log('    官方#' + String(x.wr).padStart(2) + ' ' + (pName.get(x.pid) || x.pid).padEnd(26) +
        ' PB首次=' + (pd ? new Date(pd * 86400000).toISOString().slice(0, 10) : '—') +
        '  窗口内=' + (w365 ? 'v=' + w365.v : '无'));
    }
    const mm = win.get(key);
    if (mm) {
      const arr = [...mm.entries()].map(([pid, o]) => ({ pid, v: o.v })).sort((a, b) => a.v - b.v);
      log('  F1 窗口榜 Top5：');
      for (let i = 0; i < Math.min(5, arr.length); i++) {
        const offR = official.get(key).find((x) => x.pid === arr[i].pid);
        log('    窗口#' + (i + 1) + ' ' + (pName.get(arr[i].pid) || arr[i].pid).padEnd(26) +
          ' v=' + String(arr[i].v).padStart(4) + '  官方名次=' + (offR ? '#' + offR.wr : '榜外'));
      }
    }
  }

  /* ── 人口结构 ───────────────────────────────────────────────────── */
  log('\n═══════ 人口结构（vs V0）═══════');
  {
    const s0 = new Set(A0.map((x) => x.pid));
    for (const [tag, arr] of [['F1s', A1s], ['F1b', A1b], ['F2', A2]]) {
      const sX = new Set(arr.map((x) => x.pid));
      let both = 0, only0 = 0, onlyX = 0;
      for (const p of s0) { if (sX.has(p)) both++; else only0++; }
      for (const p of sX) { if (!s0.has(p)) onlyX++; }
      log('  ' + tag.padEnd(5) + ' 共有 ' + String(both).padStart(5) + ' ｜ 仅 V0 有 ' +
        String(only0).padStart(5) + ' ｜ 仅 ' + tag + ' 有 ' + String(onlyX).padStart(5));
    }
  }

  /* ── P1 核心条目：活跃但 PB 陈旧的条目，各口径如何处理 ─────────── */
  log('\n═══════ P1 核心条目：仍在活跃期但 PB 已陈旧（gap≤1y 且 PB 年龄≥2y）═══════');
  {
    const stale = [];
    for (const [key, arr] of official) {
      const ev = key.split('|')[0];
      if (RETIRED[ev] != null) continue;
      const tr = key.split('|')[1];
      for (const x of arr) {
        if (x.wr > DEPTH) continue;
        const lc = lastByEv.get(x.pid + '|' + ev);
        if (lc == null) continue;
        const gap = (SNAPSHOT_DAY - lc) / 365.25;
        if (gap > 1) continue;                       // 仍在活跃期
        const pd = pbDay.get(x.pid + '|' + ev + '|' + tr);
        if (pd == null) continue;
        const pbAge = (SNAPSHOT_DAY - pd) / 365.25;
        if (pbAge < 2) continue;                    // PB 至少 2 年未刷新
        stale.push({ pid: x.pid, name: pName.get(x.pid) || x.pid, ev, tr, wr: x.wr, gap, pbAge });
      }
    }
    log('  命中条目：' + num(stale.length));
    // 各口径下的贡献变化
    const contrib = (ev, tr, pid, mode) => {
      const w = wOf(ev);
      if (mode === 'V0') {
        const lc = lastByEv.get(pid + '|' + ev);
        const gap = (SNAPSHOT_DAY - lc) / 365.25;
        return w * rankScore(official.get(ev + '|' + tr).find((x) => x.pid === pid).wr) * decayOf(gap);
      }
      if (mode === 'F2') {
        const pd = pbDay.get(pid + '|' + ev + '|' + tr);
        const gap = (SNAPSHOT_DAY - pd) / 365.25;
        return w * rankScore(official.get(ev + '|' + tr).find((x) => x.pid === pid).wr) * decayOf(gap);
      }
      return null;
    };
    let sV0 = 0, sF2 = 0;
    for (const st of stale) {
      const c0 = contrib(st.ev, st.tr, st.pid, 'V0');
      const c2 = contrib(st.ev, st.tr, st.pid, 'F2');
      if (c0) sV0 += c0; if (c2) sF2 += c2;
    }
    log('  这些条目的总贡献：V0 = ' + F(sV0) + ' ｜ F2 = ' + F(sF2) +
      ' （降幅 ' + (sV0 ? F((1 - sF2 / sV0) * 100) : '—') + '%）');
    log('  示例（按 PB 年龄排序）：');
    stale.sort((a, b) => b.pbAge - a.pbAge);
    for (const st of stale.slice(0, 8)) {
      const c0 = contrib(st.ev, st.tr, st.pid, 'V0');
      const c2 = contrib(st.ev, st.tr, st.pid, 'F2');
      log('    ' + st.name.padEnd(24) + st.ev.padEnd(8) + st.tr.padEnd(9) +
        ' 官方#' + String(st.wr).padStart(3) + '  PB年龄=' + st.pbAge.toFixed(1) + 'y' +
        '  V0贡献=' + F(c0) + '  F2贡献=' + F(c2));
    }
  }

  /* ── 「窗口 #1 的官方名次分布」─────────────────────────────────── */
  log('\n═══════ 窗口 #1 的官方名次分布（365天，33 组合）═══════');
  {
    const dist = new Map();
    for (const [key, mm] of win) {
      const ev = key.split('|')[0];
      if (RETIRED[ev] != null) continue;
      const arr = [...mm.entries()].map(([pid, o]) => ({ pid, v: o.v })).sort((a, b) => a.v - b.v);
      if (!arr.length) continue;
      const off = official.get(key);
      const o = off ? off.find((x) => x.pid === arr[0].pid) : null;
      const r = o ? o.wr : 9999;
      dist.set(r, (dist.get(r) || 0) + 1);
    }
    const keys = [...dist.keys()].sort((a, b) => a - b);
    log('  ' + keys.map((k) => (k === 9999 ? '榜外' : '#' + k) + '×' + dist.get(k)).join('　'));
  }

  log('\n耗时', ((Date.now() - t0) / 1000).toFixed(1) + 's');
})();

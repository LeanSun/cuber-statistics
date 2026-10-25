/**
 * M5 · 定稿口径最终实证
 * ═══════════════════════════════════════════════════════════════════════
 * 目的：为 M5 封存前的最终拍板提供一次性全量数据。
 *
 * 回答的问题
 *   Q-A  窗口重排名在**每个组合**上是否健康（深度截断是否失效、是否被小样本主导）
 *   Q-B  「一年只参赛一次」的人是否在窗口榜里过度获利（样本量偏差）
 *   Q-C  窗口口径下 single / average 两轨的重复度
 *   Q-D  窗口重排名的排序与官方榜（multi 解码后）是否自洽
 *   Q-E  F1s（窗口，无衰减）完整榜单 + 与 official / F2 的逐位对照
 *   Q-F  与 M4 / M2 / 站点 esum 的正交性
 *
 * 只读脚本：不改动 m5_current_rank.js，不写任何生产数据。
 *
 * 用法：node --max-old-space-size=12288 etl/score/m5_final_probe.js
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

/** multi 编码值 → cost（越小越好）。与 m4_dominance.js / m5_current_rank.js 同款实现。 */
function decodeMulti(v) {
  if (v < 1e9) {
    const S = String(v).padStart(10, '0');
    const DD = +S.slice(1, 3);
    const TT = Math.min(+S.slice(3, 8), 99999);
    const diff = 99 - DD;
    return { cost: (99 - diff) * 1e5 + TT, diff, time: TT };
  }
  const S = String(v);
  const SS = +S.slice(1, 3);
  const AA = +S.slice(3, 5);
  const TT = Math.min(+S.slice(5, 10), 99999);
  const solved = 99 - SS;
  const attempted = AA;
  const missed = attempted - solved;
  const diff = solved - missed;
  return { cost: (99 - diff) * 1e5 + TT, diff, time: TT, solved, attempted };
}

function pearson(xs, ys) {
  const n = xs.length; if (n < 3) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
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

/* ── 口径常量 ─────────────────────────────────────────────────────── */
const DEPTH = 100, GAMMA = 1.0, DECAY_YEARS = 5, DECAY_FLOOR = 0.2;
const TRACK_W = { single: 1, average: 1 };
const WIN = 365;
const decayOf = (gap) => Math.max(DECAY_FLOOR, 1 - (gap / DECAY_YEARS) * (1 - DECAY_FLOOR));
const rankScore = (r) => Math.pow(r, -GAMMA);

(async () => {
  const t0 = Date.now();
  const W = RN.EV_WEIGHT_V2, RETIRED = RN.EV_RETIRED_DAY, FLOOR = RN.WEIGHT_V2_CFG.floor;
  const wOf = (ev) => (W[ev] == null ? FLOOR : W[ev]);

  /* ── 基础表 ───────────────────────────────────────────────────── */
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
  log('[1] 基础表就绪', ((Date.now() - t0) / 1000).toFixed(1) + 's');

  /* ── 扫 results ───────────────────────────────────────────────── */
  const lastByEv = new Map(), lastAll = new Map();
  const pbDay = new Map(), pbVal = new Map();
  /* win: ev|tr → Map(pid → {v, day, n})
   * ⚠️ n = 该选手在该组合窗口内的**参赛次数**（results 行数），
   *    不是「达到最好成绩的次数」。早期版本写错了（只在 v===c.v 时 ++），
   *    导致「只参赛1次」占比虚高到 97.75%，据此拍板会得出错误结论。 */
  const win = new Map();
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
        if (c == null || v < c.v) mm.set(pid, { v, day, n: 1 });
        else if (v === c.v) c.n++;
        else c.n++;                          /* 成绩更差的一次参赛也要计入次数 */
      }
    }
  });
  log('[2] results 扫描完成', num(rows), '行', ((Date.now() - t0) / 1000).toFixed(1) + 's');

  /* ── 官方榜 ───────────────────────────────────────────────────── */
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

  /* ── 三口径计分 ───────────────────────────────────────────────── */
  const scV0 = new Map(), scF2 = new Map(), scF1s = new Map(), scF1b = new Map();
  const winRankOf = new Map();   // ev|tr → Map(pid → rank)
  const winParts = new Map();   // pid → [{ev,tr,wr,v,w,score,n}]

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

  /* F1：窗口重排名（序号口径） */
  const comboStats = [];
  let nEntries = 0;
  for (const [key, mm] of win) {
    const ev = key.split('|')[0];
    if (RETIRED[ev] != null) continue;
    const tr = key.split('|')[1], tw = TRACK_W[tr]; if (!tw) continue;
    const w = wOf(ev);
    const list = [...mm.entries()].map(([pid, o]) => ({ pid, v: o.v, day: o.day, n: o.n }));
    list.sort((a, b) => a.v - b.v || a.day - b.day
      || (pName.get(a.pid) || '').localeCompare(pName.get(b.pid) || ''));
    const lim = Math.min(DEPTH, list.length);
    const rmap = new Map();
    for (let i = 0; i < lim; i++) {
      const it = list[i], rank = i + 1;
      rmap.set(it.pid, rank);
      const lc = lastByEv.get(it.pid + '|' + ev);
      const gap = lc == null ? 99 : (SNAPSHOT_DAY - lc) / 365.25;
      const base = w * rankScore(rank) * tw;
      scF1s.set(it.pid, (scF1s.get(it.pid) || 0) + base);
      scF1b.set(it.pid, (scF1b.get(it.pid) || 0) + base * decayOf(gap));
      if (!winParts.has(it.pid)) winParts.set(it.pid, []);
      winParts.get(it.pid).push({ ev, tr, wr: rank, v: it.v, w, n: it.n, base, dec: decayOf(gap) });
      nEntries++;
    }
    winRankOf.set(key, rmap);
    /* 组合统计 */
    const offArr = official.get(key) || [];
    const offTop = offArr.filter((x) => x.wr <= DEPTH).length;
    const win1 = list[0];
    const off1 = offArr.filter((x) => x.wr === 1)[0];
    /* 窗口 top100 里有几人是「只参赛 1 次」 */
    const oneShot = list.slice(0, lim).filter((x) => x.n === 1).length;
    const oneShotScore = list.slice(0, lim).filter((x) => x.n === 1)
      .reduce((a, x, i) => a + w * rankScore(list.slice(0, lim).indexOf(x) + 1) * tw, 0);
    const totalScore = list.slice(0, lim).reduce((a, x, i) => a + w * rankScore(i + 1) * tw, 0);
    comboStats.push({
      key, ev, tr, pop: mm.size, lim, offTop,
      truncated: list.length > DEPTH,
      win1: win1 ? { name: pName.get(win1.pid) || win1.pid, v: win1.v, n: win1.n,
        offRank: offArr.find((x) => x.pid === win1.pid)?.wr ?? 9999 } : null,
      off1: off1 ? { name: pName.get(off1.pid) || off1.pid, v: off1.best } : null,
      oneShot, oneShotScore, oneShotRatio: totalScore ? oneShotScore / totalScore : 0,
    });
  }
  log('[4] 窗口条目', num(nEntries));

  const toArr = (sc) => [...sc.entries()]
    .map(([pid, s]) => ({ pid, s, name: pName.get(pid) || pid }))
    .sort((a, b) => b.s - a.s || a.name.localeCompare(b.name));

  const A0 = toArr(scV0), A2 = toArr(scF2), A1s = toArr(scF1s), A1b = toArr(scF1b);

  /* ── Q-A 组合健康度 ───────────────────────────────────────────── */
  log('\n═══════ Q-A 窗口重排名 · 组合健康度 ═══════');
  log('组合'.padEnd(18) + '窗口人数'.padStart(9) + '截取'.padStart(6) +
      '官方Top'.padStart(8) + '仅1次'.padStart(7) + '占分'.padStart(8) +
      '  窗口#1（官方名次） / 官方#1');
  comboStats.sort((a, b) => a.key.localeCompare(b.key));
  for (const c of comboStats) {
    log(c.key.padEnd(18) + String(c.pop).padStart(9) + String(c.lim).padStart(6) +
      String(c.offTop).padStart(8) + String(c.oneShot).padStart(7) +
      F(c.oneShotRatio * 100).padStart(8) + '%' +
      '  ' + (c.win1 ? c.win1.name.split(' ')[0] + '(#' + c.win1.offRank + ')' : '—') +
      ' / ' + (c.off1 ? c.off1.name.split(' ')[0] : '—'));
  }
  const trunc = comboStats.filter((c) => c.truncated).length;
  const small = comboStats.filter((c) => c.pop < DEPTH);
  log('\n  组合总数 ' + comboStats.length + '｜深度截断生效 ' + trunc +
      '｜未截断(窗口人数<100) ' + small.length +
      (small.length ? ' → ' + small.map((c) => c.key + '(' + c.pop + ')').join(', ') : ''));
  const avgOneShot = comboStats.reduce((a, c) => a + c.oneShotRatio, 0) / comboStats.length;
  log('  「窗口内只参赛 1 次」者占该组合前 100 分数的平均比重：' + F(avgOneShot * 100) + '%');

  /* ── Q-B 样本量偏差（全局） ───────────────────────────────────── */
  log('\n═══════ Q-B 样本量偏差：窗口内参赛次数 vs 窗口名次 ═══════');
  {
    /* 关键问题：窗口重排名里，**参赛次数多的人是否系统性占优**？
     * 若「一年跑 30 场」比「一年跑 1 场」更容易拿到窗口名次，
     * 则 F1 在奖励「参赛频率」而非「当前实力」。 */
    const xs = [], ys = [], xsAll = [];
    for (const [key, mm] of win) {
      const ev = key.split('|')[0];
      if (RETIRED[ev] != null) continue;
      const rmap = winRankOf.get(key); if (!rmap) continue;
      for (const [pid, o] of mm) {
        const r = rmap.get(pid);
        if (r == null) continue;               // 窗口前 100
        xs.push(Math.log(o.n)); ys.push(r);
      }
      /* 对照：全体窗口参赛者（含窗口外名次） */
      for (const [pid, o] of mm) xsAll.push(Math.log(o.n));
    }
    const r1 = pearson(xs, ys);
    log('  窗口前 100 条目：n=' + num(xs.length) + '｜corr(ln参赛次数, 窗口名次) = ' +
      (r1 == null ? '—' : F(r1)));
    /* 分组：按参赛次数分档，看平均窗口名次 */
    const bucket = new Map();
    for (const [key, mm] of win) {
      const ev = key.split('|')[0];
      if (RETIRED[ev] != null) continue;
      const rmap = winRankOf.get(key); if (!rmap) continue;
      for (const [pid, o] of mm) {
        const r = rmap.get(pid); if (r == null) continue;
        const b = o.n === 1 ? '1' : o.n <= 3 ? '2-3' : o.n <= 10 ? '4-10' : '11+';
        let a = bucket.get(b); if (!a) { a = { n: 0, r: 0 }; bucket.set(b, a); }
        a.n++; a.r += r;
      }
    }
    log('  按参赛次数分档的平均窗口名次（名次越小越好）：');
    for (const b of ['1', '2-3', '4-10', '11+']) {
      const a = bucket.get(b);
      if (!a) continue;
      log('    参赛 ' + b.padEnd(5) + '次：条目 ' + String(a.n).padStart(5) +
        '｜平均窗口名次 ' + F(a.r / a.n));
    }
    /* 全站视角：只参赛一次 vs 多次的人，各自的平均 M5 分 */
    let onePeople = 0, oneScore = 0, allScore = 0;
    const top25one = [];
    for (const p of A1s) {
      const ps = winParts.get(p.pid) || [];
      if (!ps.length) continue;
      const onecnt = ps.filter((x) => x.n === 1).length;
      if (onecnt / ps.length > 0.99) { onePeople++; oneScore += p.s; }
      allScore += p.s;
    }
    for (const [i, p] of A1s.slice(0, 25).entries()) {
      const ps = winParts.get(p.pid) || [];
      if (!ps.length) continue;
      if (ps.filter((x) => x.n === 1).length / ps.length > 0.99) top25one.push('#' + (i + 1) + ' ' + p.name);
    }
    log('  「全部组合都只参赛 1 次」的人：' + num(onePeople) + ' 人，合计 ' + F(oneScore) +
      ' 分（全站 ' + F(allScore) + ' 的 ' + F((oneScore / allScore) * 100) + '%）');
    log('  Top25 中属此类：' + (top25one.length ? top25one.join(' | ') : '无'));
  }

  /* ── Q-C single / average 重复度 ──────────────────────────────── */
  log('\n═══════ Q-C 窗口口径下 single / average 两轨重复度 ═══════');
  {
    const pairs = [];
    for (const [key, mm] of win) {
      const ev = key.split('|')[0];
      if (RETIRED[ev] != null) continue;
      const tr = key.split('|')[1];
      const other = tr === 'single' ? 'average' : 'single';
      const rmap = winRankOf.get(key);
      if (!rmap) continue;
      const ormp = winRankOf.get(ev + '|' + other);
      if (!ormp) continue;
      for (const [pid, r] of rmap) {
        const o = ormp.get(pid);
        if (o != null) pairs.push([r, o]);
      }
    }
    const r = pearson(pairs.map((x) => x[0]), pairs.map((x) => x[1]));
    const same = pairs.filter((x) => x[0] === x[1]).length;
    const near = pairs.filter((x) => Math.abs(x[0] - x[1]) <= 3).length;
    log('  同组合两轨都有窗口名次的人-组合：' + num(pairs.length) +
      '｜Pearson ρ = ' + (r == null ? '—' : F(r)));
    log('  两轨名次完全相同：' + num(same) + '（' + F((same / pairs.length) * 100) + '%）' +
      '｜相差 ≤3：' + num(near) + '（' + F((near / pairs.length) * 100) + '%）');
  }

  /* ── Q-D 窗口榜与官方榜的自洽（multi 解码后排序比对） ────────── */
  log('\n═══════ Q-D 窗口榜 vs 官方榜：同一组合的排序一致性 ═══════');
  {
    const rs = [];
    for (const c of comboStats) {
      const rmap = winRankOf.get(c.key); if (!rmap) continue;
      const offArr = (official.get(c.key) || []).filter((x) => x.wr <= DEPTH);
      if (offArr.length < 10 || rmap.size < 10) continue;
      const names = [];
      for (const [pid, r] of rmap) {
        const o = offArr.find((x) => x.pid === pid);
        if (o) names.push([r, o.wr]);
      }
      if (names.length < 10) continue;
      rs.push([c.key, pearson(names.map((x) => x[0]), names.map((x) => x[1])), names.length]);
    }
    const good = rs.filter((x) => x[1] != null);
    const avg = good.reduce((a, x) => a + x[1], 0) / good.length;
    log('  组合数 ' + rs.length + '｜平均 Pearson ρ = ' + F(avg));
    const worst = good.slice().sort((a, b) => a[1] - b[1]).slice(0, 5);
    log('  一致性最差的 5 个组合：');
    for (const w of worst) log('    ' + w[0].padEnd(16) + 'ρ = ' + F(w[1]) + '  (n=' + w[2] + ')');
  }

  /* ── Q-E 榜单总览 ─────────────────────────────────────────────── */
  log('\n═══════ Q-E 四口径总览 ═══════');
  const m4m = new Map();
  for (const ln of fs.readFileSync(path.join(__dirname, 'M4_seats.tsv'), 'utf8').trim().split('\n').slice(1)) {
    const c = ln.split('\t'); m4m.set(c[1], +c[2]);
  }
  const m2m = new Map();
  for (const ln of fs.readFileSync(path.join(__dirname, 'M2_ranking.tsv'), 'utf8').trim().split('\n').slice(1)) {
    const c = ln.split('\t'); m2m.set(c[2], +c[3]);
  }
  const esumByName = new Map();
  {
    const EV_GAMMA = 0.35;
    for (const [key, arr] of official) {
      const ev = key.split('|')[0];
      const w = wOf(ev);
      for (const x of arr) {
        if (x.wr <= 0) continue;
        const nm = pName.get(x.pid) || x.pid;
        esumByName.set(nm, (esumByName.get(nm) || 0) + 100 * Math.pow(x.wr, -EV_GAMMA) * w);
      }
    }
  }
  const rhoWith = (arr, src, limit) => {
    const ra = new Map(); for (let i = 0; i < Math.min(limit, arr.length); i++) ra.set(arr[i].name, i + 1);
    const srcArr = [...src.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
    const rb = new Map(); for (let i = 0; i < srcArr.length; i++) rb.set(srcArr[i][0], i + 1);
    return rankRho(arr.slice(0, limit).map((x) => x.name), srcArr.map((x) => x[0]));
  };
  log('口径'.padEnd(16) + '人数'.padStart(7) + '总量'.padStart(11) + '×M4'.padStart(9) +
      '×M2'.padStart(9) + '×esum'.padStart(9) + '  Top10');
  const variants = [['V0 官方终身榜', A0], ['F1s 窗口(无衰减)', A1s], ['F1b 窗口(+衰减)', A1b], ['F2 PB新鲜度', A2]];
  for (const [tag, arr] of variants) {
    const s4 = rhoWith(arr, m4m, 100), s2 = rhoWith(arr, m2m, 100), se = rhoWith(arr, esumByName, 100);
    log(tag.padEnd(16) + String(arr.length).padStart(7) +
      F(arr.reduce((a, b) => a + b.s, 0)).padStart(11) +
      (s4 ? F(s4.rho) : '—').padStart(9) + (s2 ? F(s2.rho) : '—').padStart(9) +
      (se ? F(se.rho) : '—').padStart(9) + '  ' +
      arr.slice(0, 10).map((x) => x.name.split(' ')[0]).join(' '));
  }
  const n0 = new Set(A0.slice(0, 25).map((x) => x.name));
  const t0n = A0.slice(0, 10).map((x) => x.name);
  log('\nTop25 重合（vs V0）：');
  for (const [tag, arr] of variants.slice(1)) {
    const tn = arr.slice(0, 10).map((x) => x.name);
    log('  ' + tag.padEnd(16) + 'Top25 ' + arr.slice(0, 25).filter((x) => n0.has(x.name)).length + '/25' +
      '｜Top10 ' + arr.slice(0, 10).filter((x) => n0.has(x.name)).length + '/10' +
      '｜Top10 进 ' + (tn.filter((x) => !t0n.includes(x)).join(', ') || '无') +
      '｜出 ' + (t0n.filter((x) => !tn.includes(x)).join(', ') || '无'));
  }

  /* ── Q-F 头部选手逐口径 ───────────────────────────────────────── */
  log('\n═══════ Q-F 头部选手逐口径 ═══════');
  const FOCUS = ['Feliks Zemdegs', 'Max Park', 'Tymon Kolasiński', 'Timofei Tarasenko',
    'Stanley Chapel', 'Xuanyi Geng (耿暄一)', 'Yiheng Wang (王艺衡)', 'Brian Johnson',
    'Ziyu Wu (吴梓宇)', 'Lachlan Gibson'];
  log('选手'.padEnd(24) + 'V0'.padStart(9) + 'F1s'.padStart(9) + 'F1b'.padStart(9) + 'F2'.padStart(9) +
    '   名次 V0/F1s/F1b/F2');
  for (const nm of FOCUS) {
    const idx = (A) => { const i = A.findIndex((x) => x.name === nm); return i < 0 ? null : i; };
    const i0 = idx(A0), i1 = idx(A1s), i1b = idx(A1b), i2 = idx(A2);
    const val = (A, i) => (i == null ? '—' : F(A[i].s));
    const rk = (i) => (i == null ? '—' : '#' + (i + 1));
    log(nm.padEnd(24) + val(A0, i0).padStart(9) + val(A1s, i1).padStart(9) +
      val(A1b, i1b).padStart(9) + val(A2, i2).padStart(9) +
      '   ' + rk(i0).padStart(5) + rk(i1).padStart(6) + rk(i1b).padStart(6) + rk(i2).padStart(6));
  }

  /* ── 逐位对照 V0 vs F1s ───────────────────────────────────────── */
  log('\n═══════ 逐位对照：V0 Top25 → F1s Top25 ═══════');
  log('#'.padStart(3) + 'V0 选手'.padEnd(26) + 'V0分'.padStart(9) + '   F1s 选手'.padEnd(26) + 'F1s分'.padStart(9));
  for (let i = 0; i < 25; i++) {
    const a = A0[i], b = A1s[i];
    log(String(i + 1).padStart(3) + (a ? a.name.slice(0, 25) : '—').padEnd(26) +
      (a ? F(a.s) : '—').padStart(9) + '   ' + (b ? b.name.slice(0, 25) : '—').padEnd(26) +
      (b ? F(b.s) : '—').padStart(9));
  }

  /* ── 人口结构 ─────────────────────────────────────────────────── */
  log('\n═══════ 人口结构（vs V0）═══════');
  const s0 = new Set(A0.map((x) => x.pid));
  for (const [tag, arr] of variants.slice(1)) {
    const sX = new Set(arr.map((x) => x.pid));
    let both = 0, only0 = 0, onlyX = 0;
    for (const p of s0) { if (sX.has(p)) both++; else only0++; }
    for (const p of sX) { if (!s0.has(p)) onlyX++; }
    log('  ' + tag.padEnd(16) + '共有 ' + String(both).padStart(5) + '｜仅V0有 ' +
      String(only0).padStart(5) + '｜仅该口径有 ' + String(onlyX).padStart(5));
  }

  /* ── 极值检查：F1s 头部是否有「一次参赛即登顶」的异常 ─────────── */
  log('\n═══════ 头部 15 名的窗口构成明细（F1s）═══════');
  for (const [i, p] of A1s.slice(0, 15).entries()) {
    const ps = (winParts.get(p.pid) || []).sort((a, b) => b.base - a.base);
    const ones = ps.filter((x) => x.n === 1).length;
    log('#' + String(i + 1) + ' ' + p.name + '  ' + F(p.s) + '｜组合 ' + ps.length +
      '｜其中只参赛1次 ' + ones + ' 个');
    for (const d of ps.slice(0, 3)) {
      log('    ' + d.ev.padEnd(8) + d.tr.padEnd(9) + '窗口#' + String(d.wr).padStart(3) +
        '  n=' + String(d.n).padStart(3) + '  w=' + F(d.w) + '  贡献=' + F(d.base));
    }
  }

  log('\n耗时', ((Date.now() - t0) / 1000).toFixed(1) + 's');
})();

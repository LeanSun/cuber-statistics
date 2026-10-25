/**
 * M5 · F1/F2 口径对照实验
 * ═══════════════════════════════════════════════════════════════════════
 * 背景（审阅 P1）：M5 用官方 `ranks_*.tsv` 的 world_rank，但那是「按 PB 排序的
 * **终身榜**」。退役衰减只惩罚「不参赛的人」，完全不惩罚「还在参赛、但名次是
 * 几年前刷出来的」—— 深度≤100 的 3,346 条目里，这类有 617 条（18.4%），占贡献 15.9%。
 *
 * 本脚本对比三个口径：
 *   V0 现状    官方终身榜名次 × 衰减(gap = 项目内末次参赛)
 *   F1 窗口榜  近 N 天窗口内**实际最好成绩**重排名（退役者自动出局，无需衰减）
 *   F2 PB新鲜度 官方名次不变，衰减 gap 改为「PB 首次刷出日」
 *
 * 只读诊断，不改 M5 主脚本。
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
  const attempted = AA;
  const missed = attempted - solved;
  const diff = solved - missed;
  return { cost: (99 - diff) * 1e5 + TT };
}

const WINDOWS = [365, 730, 1095];
const DEPTH = 100;
const GAMMA = 1.0;
const DECAY_YEARS = 5;
const DECAY_FLOOR = 0.2;
const TRACK_W = { single: 1, average: 1 };

const decayOf = (gap) => Math.max(DECAY_FLOOR, 1 - (gap / DECAY_YEARS) * (1 - DECAY_FLOOR));
const rankScore = (r) => Math.pow(r, -GAMMA);

function pearson(xs, ys) {
  const n = xs.length;
  if (n < 3) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let nu = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { const a = xs[i] - mx, b = ys[i] - my; nu += a * b; dx += a * a; dy += b * b; }
  return dx && dy ? nu / Math.sqrt(dx * dy) : null;
}

(async () => {
  const t0 = Date.now();
  const log = (...a) => console.log(...a);

  const W = RN.EV_WEIGHT_V2;
  const RETIRED = RN.EV_RETIRED_DAY;
  const FLOOR = RN.WEIGHT_V2_CFG.floor;
  const wOf = (ev) => (W[ev] == null ? FLOOR : W[ev]);

  /* ── 1. 项目表 / 比赛日 / 姓名 ──────────────────────────────────── */
  const evFmt = new Map();
  await streamTsv('WCA_export_events.tsv', (r) => { if (r[0]) evFmt.set(r[0], r[1] || 'time'); });

  const compDay = new Map();
  await streamTsv('WCA_export_competitions.tsv', (r) => {
    if (!r[0] || r[10] === '1') return;
    const y = +r[17] || +r[14]; if (!y) return;
    const m = +r[18] || +r[15] || 1;
    const d = +r[19] || +r[16] || 1;
    compDay.set(r[0], dayOf(y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0')));
  });

  const pName = new Map();
  await streamTsv('WCA_export_persons.tsv', (r) => { if (r[2]) pName.set(r[2], r[0]); });
  log('[1] 项目', evFmt.size, '；比赛', compDay.size, '；选手', pName.size);

  /* ── 2. 扫 results：末次参赛 + PB 首次达成日 + 窗口内最好成绩 ─────── */
  const lastByEv = new Map();   // pid|ev → day
  const lastAll = new Map();    // pid → day
  const pbDay = new Map();      // pid|ev|tr → day（PB 首次刷出日）
  const winBest = new Map();    // W||ev|tr → Map(pid → {v, day})
  for (const w of WINDOWS) for (const tr of ['single', 'average']) winBest.set(w + '|' + tr, new Map());
  const cutoffs = WINDOWS.map((w) => SNAPSHOT_DAY - w);

  const pbVal = new Map();      // pid|ev|tr → best value（自建，用于校验）
  let rowCount = 0;
  await streamTsv('WCA_export_results.tsv', (r) => {
    if (!r[8]) return;
    rowCount++;
    const day = compDay.get(r[4]);
    if (day === undefined) return;
    const pid = r[8], ev = r[6];
    const isMulti = evFmt.get(ev) === 'multi';
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
      for (let i = 0; i < WINDOWS.length; i++) {
        if (day <= cutoffs[i]) continue;
        const m = winBest.get(WINDOWS[i] + '|' + tr);
        const mk = ev + '|' + tr;
        let mm = m.get(mk);
        if (!mm) { mm = new Map(); m.set(mk, mm); }
        const c = mm.get(pid);
        if (c == null || v < c.v) mm.set(pid, { v, day });
      }
    }
  });
  log('[2] 成绩行', num(rowCount), '；PB 条目', num(pbVal.size), '；耗时', ((Date.now() - t0) / 1000).toFixed(1) + 's');

  /* ── 3. 官方榜 ──────────────────────────────────────────────────── */
  const official = new Map();   // ev|tr → [{pid, wr, best}]
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

  /* ── 4. 三个口径的计分 ──────────────────────────────────────────── */
  const scoreV0 = new Map();    // pid → {s, parts}
  const scoreF2 = new Map();
  const scoreF1 = new Map();
  const winRank = new Map();    // W → ev|tr → [{pid, wr}]

  for (const [key, arr] of official) {
    const ev = key.split('|')[0];
    if (RETIRED[ev] != null) continue;                    // 停办项目整体排除
    const tr = key.split('|')[1];
    const tw = TRACK_W[tr]; if (!tw) continue;
    const w = wOf(ev);

    /* V0：官方名次 × 衰减(末次参赛) */
    for (const x of arr) {
      if (x.wr > DEPTH) continue;
      const lc = lastByEv.get(x.pid + '|' + ev);
      const gap = lc == null ? 99 : (SNAPSHOT_DAY - lc) / 365.25;
      const s = w * rankScore(x.wr) * decayOf(gap) * tw;
      if (s <= 0) continue;
      scoreV0.set(x.pid, (scoreV0.get(x.pid) || 0) + s);
    }
    /* F2：官方名次 × 衰减(PB 首次达成日) */
    for (const x of arr) {
      if (x.wr > DEPTH) continue;
      const pd = pbDay.get(x.pid + '|' + ev + '|' + tr);
      const gap = pd == null ? 99 : (SNAPSHOT_DAY - pd) / 365.25;
      const s = w * rankScore(x.wr) * decayOf(gap) * tw;
      if (s <= 0) continue;
      scoreF2.set(x.pid, (scoreF2.get(x.pid) || 0) + s);
    }
  }

  /* F1：窗口内最好成绩重排名（同值同名次）
   * 注意 winBest 内部 key 是 `ev|tr`，此处必须按轨道分别取，不能混用。
   */
  for (const w of WINDOWS) {
    const perCombo = new Map();
    for (const tr of ['single', 'average']) {
      const m = winBest.get(w + '|' + tr);        // Map(ev|tr → Map(pid → {v,day}))
      if (!m) continue;
      for (const [comboKey, mm] of m) {
        const ev = comboKey.split('|')[0];
        if (RETIRED[ev] != null) continue;        // 停办项目排除
        if (!mm || !mm.size) continue;
        const list = [...mm.entries()].map(([pid, o]) => ({ pid, v: o.v }));
        list.sort((a, b) => a.v - b.v);
        // 同值同名次
        let rank = 0, prev = null;
        for (const it of list) {
          if (prev === null || it.v !== prev) { rank++; prev = it.v; }
          it.wr = rank;
        }
        perCombo.set(comboKey, list);
      }
    }
    winRank.set(w, perCombo);
    for (const [withDecay, store] of [[false, 'F1'], [true, 'F1b']]) {
      const sc = new Map();
      for (const [key, list] of perCombo) {
        const ev = key.split('|')[0], tr = key.split('|')[1];
        const tw = TRACK_W[tr]; if (!tw) continue;
        const wgt = wOf(ev);
        for (const it of list) {
          if (it.wr > DEPTH) continue;
          let s = wgt * rankScore(it.wr) * tw;
          if (withDecay) {
            const lc = lastByEv.get(it.pid + '|' + ev);
            const gap = lc == null ? 99 : (SNAPSHOT_DAY - lc) / 365.25;
            s *= decayOf(gap);
          }
          if (s <= 0) continue;
          sc.set(it.pid, (sc.get(it.pid) || 0) + s);
        }
      }
      if (w === 365) {
        if (!withDecay) scoreF1.set('F1', sc); else scoreF1.set('F1b', sc);
      }
    }
  }

  const toArr = (sc) => [...sc.entries()]
    .map(([pid, s]) => ({ pid, s, name: pName.get(pid) || pid }))
    .sort((a, b) => b.s - a.s || a.name.localeCompare(b.name));

  const A0 = toArr(scoreV0), A2 = toArr(scoreF2);
  const A1 = toArr(scoreF1.get('F1'));
  const A1b = toArr(scoreF1.get('F1b'));
  const A1_730 = toArr((() => {
    const sc = new Map();
    const perCombo = winRank.get(730);
    for (const [key, list] of perCombo) {
      const ev = key.split('|')[0], tr = key.split('|')[1];
      const tw = TRACK_W[tr]; if (!tw) continue;
      const wgt = wOf(ev);
      for (const it of list) {
        if (it.wr > DEPTH) continue;
        const s = wgt * rankScore(it.wr) * tw;
        sc.set(it.pid, (sc.get(it.pid) || 0) + s);
      }
    }
    return sc;
  })());

  log('[4] V0', A0.length, '人 /', F(A0.reduce((a, b) => a + b.s, 0)),
    '｜F1-365', A1.length, '人 /', F(A1.reduce((a, b) => a + b.s, 0)),
    '｜F1b-365', A1b.length, '人 /', F(A1b.reduce((a, b) => a + b.s, 0)),
    '｜F2', A2.length, '人 /', F(A2.reduce((a, b) => a + b.s, 0)));

  /* ── 5. 外部参照（M4 / M2 / esum） ─────────────────────────────── */
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
    const names = arr.slice(0, limit).map((x) => x.name).filter((n) => rb.has(n));
    if (names.length < 3) return null;
    return { n: names.length, rho: pearson(names.map((n) => ra.get(n)), names.map((n) => rb.get(n))) };
  };

  /* ── 6. 对照表 ─────────────────────────────────────────────────── */
  log('\n═══════ 三个口径总览 ═══════');
  log('口径'.padEnd(12) + '人数'.padStart(7) + '总量'.padStart(11) + '×M4 ρ'.padStart(10) + '×M2 ρ'.padStart(10) + '  Top10');
  for (const [tag, arr] of [['V0 现状', A0], ['F1-365', A1], ['F1b-365', A1b], ['F1-730', A1_730], ['F2 PB新鲜度', A2]]) {
    const s4 = rhoWith(arr, m4, 100), s2 = rhoWith(arr, m2, 100);
    log(tag.padEnd(12) + String(arr.length).padStart(7) +
      F(arr.reduce((a, b) => a + b.s, 0)).padStart(11) +
      (s4 ? F(s4.rho) : '—').padStart(10) + (s2 ? F(s2.rho) : '—').padStart(10) + '  ' +
      arr.slice(0, 10).map((x) => x.name.split(' ')[0]).join(' '));
  }

  log('\n═══════ Top25 对照（V0 现状 vs F1-365 vs F1b-365 vs F2）══════');
  const n0 = new Set(A0.slice(0, 25).map((x) => x.name));
  const n1 = new Set(A1.slice(0, 25).map((x) => x.name));
  const n1b = new Set(A1b.slice(0, 25).map((x) => x.name));
  const n2 = new Set(A2.slice(0, 25).map((x) => x.name));
  log('F1-365 与 V0 的 Top25 重合：' + A1.slice(0, 25).filter((x) => n0.has(x.name)).length + '/25');
  log('F1b-365 与 V0 的 Top25 重合：' + A1b.slice(0, 25).filter((x) => n0.has(x.name)).length + '/25');
  log('F2    与 V0 的 Top25 重合：' + A2.slice(0, 25).filter((x) => n0.has(x.name)).length + '/25');
  log('F1-365 与 V0 的 Top10 重合：' + A1.slice(0, 10).filter((x) => n0.has(x.name)).length + '/10');
  log('F1b-365 与 V0 的 Top10 重合：' + A1b.slice(0, 10).filter((x) => n0.has(x.name)).length + '/10');
  log('F2    与 V0 的 Top10 重合：' + A2.slice(0, 10).filter((x) => n0.has(x.name)).length + '/10');
  const t0n = A0.slice(0, 10).map((x) => x.name);
  for (const [tag, arr] of [['F1-365', A1], ['F1b-365', A1b], ['F2', A2]]) {
    const tn = arr.slice(0, 10).map((x) => x.name);
    log(tag + ' Top10 进出 V0：进 ' + (tn.filter((x) => !t0n.includes(x)).join(', ') || '（无）') +
      '｜出 ' + (t0n.filter((x) => !tn.includes(x)).join(', ') || '（无）'));
  }

  log('\n═══════ 头部选手逐口径明细 ═══════');
  const FOCUS = ['Feliks Zemdegs', 'Max Park', 'Tymon Kolasiński', 'Timofei Tarasenko',
    'Stanley Chapel', 'Xuanyi Geng (耿暄一)', 'Yiheng Wang (王艺衡)'];
  log('选手'.padEnd(24) + 'V0'.padStart(9) + 'F1-365'.padStart(9) + 'F1b-365'.padStart(9) + 'F2'.padStart(9) +
    '   V0名次 F1名次 F1b名次 F2名次');
  for (const nm of FOCUS) {
    const i0 = A0.findIndex((x) => x.name === nm);
    const i1 = A1.findIndex((x) => x.name === nm);
    const i1b = A1b.findIndex((x) => x.name === nm);
    const i2 = A2.findIndex((x) => x.name === nm);
    log(nm.padEnd(24) +
      (i0 < 0 ? '—' : F(A0[i0].s)).padStart(9) +
      (i1 < 0 ? '—' : F(A1[i1].s)).padStart(9) +
      (i1b < 0 ? '—' : F(A1b[i1b].s)).padStart(9) +
      (i2 < 0 ? '—' : F(A2[i2].s)).padStart(9) + '   ' +
      (i0 < 0 ? '—' : '#' + (i0 + 1)).padStart(6) +
      (i1 < 0 ? '—' : '#' + (i1 + 1)).padStart(6) +
      (i1b < 0 ? '—' : '#' + (i1b + 1)).padStart(6) +
      (i2 < 0 ? '—' : '#' + (i2 + 1)).padStart(6));
  }

  /* ── 7. 关键案例：333fm 化石榜 ────────────────────────────────── */
  log('\n═══════ 案例：333fm|single 官方 #1 是谁 ═══════');
  {
    const arr = official.get('333fm|single');
    const top = arr.filter((x) => x.wr <= 5).sort((a, b) => a.wr - b.wr);
    for (const x of top) {
      const pd = pbDay.get(x.pid + '|333fm|single');
      const lc = lastByEv.get(x.pid + '|333fm');
      const w365 = winBest.get('365|single').get('333fm|single');
      const inWin = w365 && w365.get(x.pid);
      log('  官方#' + x.wr + ' ' + (pName.get(x.pid) || x.pid) +
        '  PB首次=' + (pd ? new Date(pd * 86400000).toISOString().slice(0, 10) : '—') +
        '  末次参赛=' + (lc ? new Date(lc * 86400000).toISOString().slice(0, 10) : '—') +
        '  365天窗口内=' + (inWin ? '有（v=' + inWin.v + '）' : '无'));
    }
  }

  /* ── 8. F1 人口与 esum 重复度 ──────────────────────────────────── */
  log('\n═══════ F1 与「终身榜」的人口结构对比 ═══════');
  const set0 = new Set(A0.map((x) => x.pid)), set1 = new Set(A1.map((x) => x.pid));
  let both = 0, only0 = 0, only1 = 0;
  for (const p of set0) { if (set1.has(p)) both++; else only0++; }
  for (const p of set1) { if (!set0.has(p)) only1++; }
  log('  两版都有：' + num(both) + '；仅 V0 有：' + num(only0) + '；仅 F1 有：' + num(only1));

  log('\n耗时', ((Date.now() - t0) / 1000).toFixed(1) + 's');
})();

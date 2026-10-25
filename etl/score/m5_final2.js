/**
 * M5 · 定稿口径二轮实证（F3 / F4 双衰减方案）
 * ═══════════════════════════════════════════════════════════════════════
 * 一轮实证（m5_final_probe.js）的结论：
 *   ① F1 窗口重排名的「样本量偏差」是**误判**（脚本 bug 造成），修正后
 *      corr(ln参赛次数, 窗口名次) = -0.1107，只参赛1次者仅占全站 1.87% 分。
 *   ② F1 真正的问题是**语义脱钩**：窗口榜 vs 官方榜 平均 ρ 仅 0.8222，
 *      `222|single` 低至 0.2456 —— 即 M5 分与「世界排名」这个概念脱节。
 *   ③ F1 另有工程缺陷：`555bf|average` 窗口仅 68 人 → 深度截断失效，
 *      该组合 68 人全部计分，跨组合量纲不一致。
 *   ④ F1 人口换血 20%（257 出 / 239 进）→ M5 退化为纯快照。
 *
 * 本轮检验的候选：
 *   V0   官方名次 × decay(距末次参赛)                    ← 现状
 *   F2   官方名次 × decay(距 PB 达成日)                  ← 一轮提出
 *   F3   官方名次 × decay(距末次参赛) × decay(距 PB 达成)  ← 双因子（乘）
 *   F4   官方名次 × decay(max(距末次参赛, 距 PB 达成))     ← 双因子（并）
 *
 * 另测：衰减下限、衰减年数、累加 vs 按权重平均（广度口径）、与 M1/M2/M4/esum 的正交性。
 *
 * 只读脚本：不改动 m5_current_rank.js，不写任何生产数据。
 *
 * 用法：node --max-old-space-size=12288 etl/score/m5_final2.js
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

function pearson(xs, ys) {
  const n = xs.length; if (n < 3) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
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

const DEPTH = 100, GAMMA = 1.0;
const TRACK_W = { single: 1, average: 1 };

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

  /* ── 扫 results ───────────────────────────────────────────────── */
  const lastByEv = new Map();
  const pbDay = new Map(), pbVal = new Map();
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

  /* ── 口径引擎 ─────────────────────────────────────────────────── */
  /* decay(gap) = max(floor, 1 - gap/years × (1-floor)) */
  const mkDecay = (years, floor) => (gap) =>
    Math.max(floor, 1 - (gap / years) * (1 - floor));
  const rankScore = (r) => Math.pow(r, -GAMMA);

  /**
   * @param {string} mode  'retire' | 'pb' | 'mul' | 'max'
   * @param {number} years 衰减年数
   * @param {number} floor 衰减下限
   * @param {boolean} avgMode  true = 按项目权重平均（而非累加）
   */
  const compute = (mode, years, floor, avgMode) => {
    const dec = mkDecay(years, floor);
    const sc = new Map();
    const perW = new Map();      // pid → Σw（用于平均口径）
    for (const [key, arr] of official) {
      const ev = key.split('|')[0];
      if (RETIRED[ev] != null) continue;
      const tr = key.split('|')[1], tw = TRACK_W[tr]; if (!tw) continue;
      const w = wOf(ev);
      for (const x of arr) {
        if (x.wr > DEPTH) continue;
        const lc = lastByEv.get(x.pid + '|' + ev);
        const gR = lc == null ? 99 : (SNAPSHOT_DAY - lc) / 365.25;
        const pd = pbDay.get(x.pid + '|' + ev + '|' + tr);
        const gP = pd == null ? 99 : (SNAPSHOT_DAY - pd) / 365.25;
        let d;
        if (mode === 'retire') d = dec(gR);
        else if (mode === 'pb') d = dec(gP);
        else if (mode === 'mul') d = dec(gR) * dec(gP);
        else d = dec(Math.max(gR, gP));
        const s = w * rankScore(x.wr) * d * tw;
        if (s <= 0) continue;
        sc.set(x.pid, (sc.get(x.pid) || 0) + s);
        perW.set(x.pid, (perW.get(x.pid) || 0) + w * tw);
      }
    }
    if (avgMode) {
      for (const [pid, s] of sc) {
        const ws = perW.get(pid) || 1;
        sc.set(pid, s / ws * wOf('333'));   // 归一到三阶权重尺度，便于与累加口径对比
      }
    }
    return [...sc.entries()].map(([pid, s]) => ({ pid, s, name: pName.get(pid) || pid }))
      .sort((a, b) => b.s - a.s || a.name.localeCompare(b.name));
  };

  /* ── 外部参照 ─────────────────────────────────────────────────── */
  const m4m = new Map();
  for (const ln of fs.readFileSync(path.join(__dirname, 'M4_seats.tsv'), 'utf8').trim().split('\n').slice(1)) {
    const c = ln.split('\t'); m4m.set(c[1], +c[2]);
  }
  const m2m = new Map();
  for (const ln of fs.readFileSync(path.join(__dirname, 'M2_ranking.tsv'), 'utf8').trim().split('\n').slice(1)) {
    const c = ln.split('\t'); m2m.set(c[2], +c[3]);
  }
  /* M1：从全站报告的排行榜解析（必须跳 7 列才落到「纪录分」列） */
  const m1m = new Map();
  try {
    const md = fs.readFileSync(path.join(__dirname, '纪录分_全站.md'), 'utf8');
    for (const ln of md.split('\n')) {
      const m = ln.match(/^\|\s*\d+\s*\|([^|]+)\|\s*[^|]*\|\s*[^|]*\|\s*[^|]*\|\s*[^|]*\|\s*[^|]*\|\s*[^|]*\|\s*\*{0,2}(\d+\.\d+)\*{0,2}\s*\|/);
      if (m) m1m.set(m[1].trim(), +m[2]);
    }
  } catch (e) { /* 缺失则跳过 */ }
  /* esum（站点现行总分口径）：Σ 100 × rank^-0.35 × w，无深度上限、无衰减 */
  const esumM = new Map();
  {
    for (const [key, arr] of official) {
      const ev = key.split('|')[0];
      const w = wOf(ev);
      for (const x of arr) {
        if (x.wr <= 0) continue;
        const nm = pName.get(x.pid) || x.pid;
        esumM.set(nm, (esumM.get(nm) || 0) + 100 * Math.pow(x.wr, -0.35) * w);
      }
    }
  }
  const rhoWith = (arr, src, limit) => {
    const ra = new Map(); for (let i = 0; i < Math.min(limit, arr.length); i++) ra.set(arr[i].name, i + 1);
    const srcArr = [...src.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
    const rb = new Map(); for (let i = 0; i < srcArr.length; i++) rb.set(srcArr[i][0], i + 1);
    return rankRho(arr.slice(0, limit).map((x) => x.name), srcArr.map((x) => x[0]));
  };

  /* ── 1. 四口径总览 ───────────────────────────────────────────── */
  log('\n═══════ 1. 四口径总览（衰减 5 年 / 下限 0.2）═══════');
  const A0 = compute('retire', 5, 0.2, false);
  const A2 = compute('pb', 5, 0.2, false);
  const A3 = compute('mul', 5, 0.2, false);
  const A4 = compute('max', 5, 0.2, false);
  const VARIANTS = [['V0 退役衰减（现状）', A0], ['F2 PB 新鲜度', A2],
                    ['F3 双衰减（乘）', A3], ['F4 双衰减（max）', A4]];
  log('口径'.padEnd(20) + '人数'.padStart(7) + '总量'.padStart(11) + '×M1'.padStart(9) +
      '×M2'.padStart(9) + '×M4'.padStart(9) + '×esum'.padStart(9) + '  Top10');
  for (const [tag, arr] of VARIANTS) {
    const s1 = rhoWith(arr, m1m, 100), s2 = rhoWith(arr, m2m, 100),
          s4 = rhoWith(arr, m4m, 100), se = rhoWith(arr, esumM, 100);
    log(tag.padEnd(20) + String(arr.length).padStart(7) +
      F(arr.reduce((a, b) => a + b.s, 0)).padStart(11) +
      (s1 ? F(s1.rho) : '—').padStart(9) + (s2 ? F(s2.rho) : '—').padStart(9) +
      (s4 ? F(s4.rho) : '—').padStart(9) + (se ? F(se.rho) : '—').padStart(9) +
      '  ' + arr.slice(0, 10).map((x) => x.name.split(' ')[0]).join(' '));
  }

  const n0 = new Set(A0.slice(0, 25).map((x) => x.name));
  const t0n = A0.slice(0, 10).map((x) => x.name);
  log('\nTop25 重合（vs V0）：');
  for (const [tag, arr] of VARIANTS.slice(1)) {
    const tn = arr.slice(0, 10).map((x) => x.name);
    log('  ' + tag.padEnd(20) + 'Top25 ' + arr.slice(0, 25).filter((x) => n0.has(x.name)).length + '/25' +
      '｜Top10 ' + arr.slice(0, 10).filter((x) => n0.has(x.name)).length + '/10' +
      '｜进 ' + (tn.filter((x) => !t0n.includes(x)).join(', ') || '无') +
      '｜出 ' + (t0n.filter((x) => !tn.includes(x)).join(', ') || '无'));
  }

  /* ── 2. 参数敏感性 ───────────────────────────────────────────── */
  log('\n═══════ 2. 参数敏感性（以 F3 双衰减为基准）═══════');
  log('模式'.padEnd(22) + '人数'.padStart(7) + '总量'.padStart(11) + '×M4'.padStart(9) + '  Top5');
  for (const [mode, nm] of [['retire', '退役'], ['pb', 'PB'], ['mul', '乘'], ['max', 'max']]) {
    for (const [years, floor] of [[3, 0.2], [5, 0.2], [8, 0.2], [5, 0.0], [5, 0.1], [5, 0.3], [10, 0.2]]) {
      const arr = compute(mode, years, floor, false);
      const s4 = rhoWith(arr, m4m, 100);
      log((nm + ' ' + years + '年 下限' + floor.toFixed(1)).padEnd(22) +
        String(arr.length).padStart(7) + F(arr.reduce((a, b) => a + b.s, 0)).padStart(11) +
        (s4 ? F(s4.rho) : '—').padStart(9) + '  ' + arr.slice(0, 5).map((x) => x.name.split(' ')[0]).join(' '));
    }
  }

  /* ── 3. 广度口径：累加 vs 按权重平均 ─────────────────────────── */
  log('\n═══════ 3. 广度口径（累加 vs 按权重平均）═══════');
  log('口径'.padEnd(20) + '人数'.padStart(7) + 'Top25重合'.padStart(10) + '  Top8');
  for (const [mode, nm] of [['retire', 'V0 退役衰减'], ['mul', 'F3 双衰减']]) {
    const sumArr = compute(mode, 5, 0.2, false);
    const avgArr = compute(mode, 5, 0.2, true);
    const s = new Set(sumArr.slice(0, 25).map((x) => x.name));
    log(nm.padEnd(20) + '累加'.padStart(4) + String(sumArr.length).padStart(4) +
      '      —    ' + sumArr.slice(0, 8).map((x) => x.name.split(' ')[0]).join(' '));
    log(''.padEnd(20) + '平均'.padStart(4) + String(avgArr.length).padStart(4) +
      String(avgArr.slice(0, 25).filter((x) => s.has(x.name)).length + '/25').padStart(10) +
      '  ' + avgArr.slice(0, 8).map((x) => x.name.split(' ')[0]).join(' '));
  }

  /* ── 4. 头部选手逐口径 ───────────────────────────────────────── */
  log('\n═══════ 4. 头部选手逐口径 ═══════');
  const FOCUS = ['Feliks Zemdegs', 'Max Park', 'Tymon Kolasiński', 'Timofei Tarasenko',
    'Stanley Chapel', 'Xuanyi Geng (耿暄一)', 'Yiheng Wang (王艺衡)', 'Brian Johnson',
    'Lachlan Gibson', 'Seung Hyuk Nahm (남승혁)'];
  log('选手'.padEnd(24) + 'V0'.padStart(9) + 'F2'.padStart(9) + 'F3'.padStart(9) + 'F4'.padStart(9) +
    '   名次 V0/F2/F3/F4');
  for (const nm of FOCUS) {
    const idx = (A) => { const i = A.findIndex((x) => x.name === nm); return i < 0 ? null : i; };
    const is = [idx(A0), idx(A2), idx(A3), idx(A4)];
    const val = (A, i) => (i == null ? '—' : F(A[i].s));
    const rk = (i) => (i == null ? '—' : '#' + (i + 1));
    log(nm.padEnd(24) + val(A0, is[0]).padStart(9) + val(A2, is[1]).padStart(9) +
      val(A3, is[2]).padStart(9) + val(A4, is[3]).padStart(9) + '   ' +
      is.map((i) => rk(i).padStart(6)).join(''));
  }

  /* ── 5. P1 病灶量化：活跃但 PB 陈旧的条目，各口径贡献 ─────────── */
  log('\n═══════ 5. P1 病灶量化（活跃但 PB ≥2 年未刷新的条目）═══════');
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
        const gR = (SNAPSHOT_DAY - lc) / 365.25;
        if (gR > 1) continue;                     // 仍在活跃期
        const pd = pbDay.get(x.pid + '|' + ev + '|' + tr);
        if (pd == null) continue;
        const gP = (SNAPSHOT_DAY - pd) / 365.25;
        if (gP < 2) continue;                    // PB 至少 2 年未刷新
        stale.push({ pid: x.pid, name: pName.get(x.pid) || x.pid, ev, tr, wr: x.wr, gR, gP });
      }
    }
    log('  命中条目：' + num(stale.length));
    const dec = mkDecay(5, 0.2);
    let sV0 = 0, sF2 = 0, sF3 = 0, sF4 = 0;
    for (const st of stale) {
      const w = wOf(st.ev);
      const base = w * rankScore(st.wr);
      sV0 += base * dec(st.gR);
      sF2 += base * dec(st.gP);
      sF3 += base * dec(st.gR) * dec(st.gP);
      sF4 += base * dec(Math.max(st.gR, st.gP));
    }
    log('  这些条目的总贡献：V0 = ' + F(sV0) + ' ｜ F2 = ' + F(sF2) +
      ' ｜ F3 = ' + F(sF3) + ' ｜ F4 = ' + F(sF4));
    log('  相对 V0 的降幅：F2 ' + F((1 - sF2 / sV0) * 100) + '% ｜ F3 ' +
      F((1 - sF3 / sV0) * 100) + '% ｜ F4 ' + F((1 - sF4 / sV0) * 100) + '%');
    /* 全站占比 */
    const tot = (arr) => arr.reduce((a, b) => a + b.s, 0);
    log('  占全站：V0 ' + F((sV0 / tot(A0)) * 100) + '% ｜ F2 ' + F((sF2 / tot(A2)) * 100) +
      '% ｜ F3 ' + F((sF3 / tot(A3)) * 100) + '% ｜ F4 ' + F((sF4 / tot(A4)) * 100) + '%');
    log('  示例（按 PB 年龄排序）：');
    stale.sort((a, b) => b.gP - a.gP);
    for (const st of stale.slice(0, 8)) {
      const w = wOf(st.ev);
      const base = w * rankScore(st.wr);
      log('    ' + st.name.padEnd(24) + st.ev.padEnd(8) + st.tr.padEnd(9) +
        '官方#' + String(st.wr).padStart(3) + '  参赛gap=' + st.gR.toFixed(2) + 'y  PBage=' + st.gP.toFixed(2) + 'y' +
        '  V0=' + F(base * dec(st.gR)) + ' F3=' + F(base * dec(st.gR) * dec(st.gP)));
    }
  }

  /* ── 6. 化石榜惩罚：退役者的残留 ─────────────────────────────── */
  log('\n═══════ 6. 退役化石条目（停赛 ≥3 年）各口径处理 ═══════');
  {
    const fos = [];
    for (const [key, arr] of official) {
      const ev = key.split('|')[0];
      if (RETIRED[ev] != null) continue;
      const tr = key.split('|')[1];
      for (const x of arr) {
        if (x.wr > DEPTH) continue;
        const lc = lastByEv.get(x.pid + '|' + ev);
        const gR = lc == null ? 99 : (SNAPSHOT_DAY - lc) / 365.25;
        if (gR < 3) continue;
        const pd = pbDay.get(x.pid + '|' + ev + '|' + tr);
        fos.push({ ev, tr, pid: x.pid, name: pName.get(x.pid) || x.pid, wr: x.wr, gR,
          gP: pd == null ? 99 : (SNAPSHOT_DAY - pd) / 365.25 });
      }
    }
    log('  命中条目：' + num(fos.length));
    const dec = mkDecay(5, 0.2);
    let v0 = 0, f2 = 0, f3 = 0, f4 = 0;
    for (const st of fos) {
      const base = wOf(st.ev) * rankScore(st.wr);
      v0 += base * dec(st.gR); f2 += base * dec(st.gP);
      f3 += base * dec(st.gR) * dec(st.gP); f4 += base * dec(Math.max(st.gR, st.gP));
    }
    log('  总贡献：V0 = ' + F(v0) + ' ｜ F2 = ' + F(f2) + ' ｜ F3 = ' + F(f3) + ' ｜ F4 = ' + F(f4));
    log('  占全站：V0 ' + F((v0 / tot(A0)) * 100) + '% ｜ F2 ' + F((f2 / tot(A2)) * 100) +
      '% ｜ F3 ' + F((f3 / tot(A3)) * 100) + '% ｜ F4 ' + F((f4 / tot(A4)) * 100) + '%');
  }

  /* ── 7. 逐位对照 V0 → F3 ─────────────────────────────────────── */
  log('\n═══════ 7. 逐位对照：V0 Top25 → F3 Top25 ═══════');
  log('#'.padStart(3) + 'V0 选手'.padEnd(26) + 'V0分'.padStart(9) + '   F3 选手'.padEnd(26) + 'F3分'.padStart(9));
  for (let i = 0; i < 25; i++) {
    const a = A0[i], b = A3[i];
    log(String(i + 1).padStart(3) + (a ? a.name.slice(0, 25) : '—').padEnd(26) +
      (a ? F(a.s) : '—').padStart(9) + '   ' + (b ? b.name.slice(0, 25) : '—').padEnd(26) +
      (b ? F(b.s) : '—').padStart(9));
  }

  /* ── 8. 人口结构 ─────────────────────────────────────────────── */
  log('\n═══════ 8. 人口结构（vs V0）═══════');
  const s0 = new Set(A0.map((x) => x.pid));
  for (const [tag, arr] of VARIANTS.slice(1)) {
    const sX = new Set(arr.map((x) => x.pid));
    let both = 0, only0 = 0, onlyX = 0;
    for (const p of s0) { if (sX.has(p)) both++; else only0++; }
    for (const p of sX) { if (!s0.has(p)) onlyX++; }
    log('  ' + tag.padEnd(20) + '共有 ' + String(both).padStart(5) + '｜仅V0有 ' +
      String(only0).padStart(5) + '｜仅该口径有 ' + String(onlyX).padStart(5));
  }

  log('\n耗时', ((Date.now() - t0) / 1000).toFixed(1) + 's');
})();

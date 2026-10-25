/**
 * M5 · F1 窗口重排名 · 数据探查
 * ═══════════════════════════════════════════════════════════════════════
 * 目的：落地前先确认三件事
 *   ① 每个 (项目,轨道) 组合在近 N 天窗口内的**参赛人数**是否够撑起名次
 *   ② 窗口内「最快者」与官方终身榜 #1 的差异有多大
 *   ③ multi / average 轨道的窗口成绩能否正确解码排序
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

/** multi 编码值 → 可比 cost（与 m4_dominance.js 同款） */
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

const WINDOWS = [365, 730, 1095];

(async () => {
  const t0 = Date.now();
  const log = (...a) => console.log(...a);
  const F = (v) => Number(v).toFixed(4);

  /* ── 1. 项目表（format 决定是否 multi） ─────────────────────────── */
  const evFmt = new Map();
  await streamTsv('WCA_export_events.tsv', (r) => { if (r[0]) evFmt.set(r[0], r[1] || 'time'); });

  /* ── 2. 比赛结束日 ───────────────────────────────────────────────── */
  const compDay = new Map();
  await streamTsv('WCA_export_competitions.tsv', (r) => {
    if (!r[0] || r[10] === '1') return;
    const y = +r[17] || +r[14]; if (!y) return;
    const m = +r[18] || +r[15] || 1;
    const d = +r[19] || +r[16] || 1;
    compDay.set(r[0], dayOf(y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0')));
  });
  log('[1] 项目', evFmt.size, '；比赛', compDay.size);

  /* ── 3. 官方榜（终身 PB 榜） ─────────────────────────────────────── */
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
  log('[2] 官方榜组合', official.size);

  /* ── 4. 扫 results：窗口内每人的最好成绩 ─────────────────────────── */
  // win[ev|tr] → Map(pid → {v, day})  窗口内最好成绩
  const win = new Map();
  for (const w of WINDOWS) {
    for (const key of official.keys()) win.set(w + '||' + key, new Map());
  }
  const allTime = new Map();   // ev|tr → Map(pid → best 全时段)
  let rowCount = 0, skipped = 0;
  const cutoffs = WINDOWS.map((w) => SNAPSHOT_DAY - w);

  await streamTsv('WCA_export_results.tsv', (r) => {
    if (!r[8]) return;
    rowCount++;
    const day = compDay.get(r[4]);
    if (day === undefined) { skipped++; return; }
    const pid = r[8], ev = r[6];
    const isMulti = evFmt.get(ev) === 'multi';
    const vs = +r[2], va = +r[3];
    for (const [tr, raw] of [['single', vs], ['average', va]]) {
      if (raw <= 0) continue;                       // DNF/DNS/无成绩
      const v = isMulti ? decodeMulti(raw).cost : raw;
      const key = ev + '|' + tr;
      // 全时段
      if (!allTime.has(key)) allTime.set(key, new Map());
      const am = allTime.get(key);
      const cur = am.get(pid);
      if (cur == null || v < cur) am.set(pid, v);
      // 窗口内
      for (let i = 0; i < WINDOWS.length; i++) {
        if (day <= cutoffs[i]) continue;
        const m = win.get(WINDOWS[i] + '||' + key);
        if (!m) continue;
        const c = m.get(pid);
        if (c == null || v < c.v) m.set(pid, { v, day });
      }
    }
  });
  log('[3] 成绩行', rowCount, '；比赛未匹配', skipped, '；耗时', ((Date.now() - t0) / 1000).toFixed(1) + 's');

  /* ── 5. 窗口内参赛人数分布 ─────────────────────────────────────── */
  log('\n═══════ ① 各组合窗口内参赛人数 ═══════');
  const comboKeys = [...official.keys()].sort();
  const width = Math.max(...comboKeys.map((k) => k.length));
  for (const w of WINDOWS) {
    log(`\n--- 窗口 ${w} 天 ---`);
    log('组合'.padEnd(width + 2) + '官方人数  365   730  1095   窗口内#1(1095)');
    let tooFew365 = 0, tooFew730 = 0, tooFew1095 = 0;
    for (const key of comboKeys) {
      const c365 = win.get(365 + '||' + key), c730 = win.get(730 + '||' + key), c1095 = win.get(1095 + '||' + key);
      const off = official.get(key);
      // 窗口内 #1（1095）
      let top1095 = '—';
      if (c1095 && c1095.size) {
        const arr = [...c1095.entries()].sort((a, b) => a[1].v - b[1].v);
        const offTop = off.find((x) => x.pid === arr[0][0]);
        top1095 = (offTop ? '官方#' + offTop.wr : '官方榜外');
      }
      if (c365.size < 20) tooFew365++;
      if (c730.size < 20) tooFew730++;
      if (c1095.size < 20) tooFew1095++;
      log(key.padEnd(width + 2) + String(off.length).padStart(8) +
        String(c365.size).padStart(6) + String(c730.size).padStart(6) + String(c1095.size).padStart(6) +
        '   ' + top1095);
    }
    log(`  → 窗口内参赛 < 20 人的组合数：365天=${tooFew365}  730天=${tooFew730}  1095天=${tooFew1095}`);
  }

  /* ── 6. 窗口内最快者 vs 官方 #1 ────────────────────────────────── */
  log('\n═══════ ② 窗口内最快者 ≠ 官方终身榜 #1 的组合 ═══════');
  for (const w of WINDOWS) {
    log(`\n--- 窗口 ${w} 天 ---`);
    let diff = 0;
    for (const key of comboKeys) {
      const m = win.get(w + '||' + key);
      if (!m || !m.size) continue;
      const off = official.get(key);
      if (!off || !off.length) continue;
      const arr = [...m.entries()].sort((a, b) => a[1].v - b[1].v);
      const offTop = off.find((x) => x.pid === arr[0][0]);
      if (!offTop || offTop.wr !== 1) {
        diff++;
        const nm = arr[0][0];
        log('  ' + key.padEnd(16) + ' 窗口#1 官方#' + (offTop ? offTop.wr : '—') +
          '  (窗口内第 ' + (off.findIndex((x) => x.pid === nm) + 1) + ' 名 / 官方面 #' +
          (off.findIndex((x) => x.pid === nm) + 1) + ')');
      }
    }
    log('  → 差异组合数：' + diff + ' / ' + comboKeys.length);
  }

  /* ── 7. multi / average 轨道的窗口成绩 sanity ───────────────────── */
  log('\n═══════ ③ multi / average 窗口数据 sanity ═══════');
  for (const key of comboKeys) {
    if (!key.includes('mbf') && !key.includes('mbo') && !key.endsWith('average')) continue;
    const c1095 = win.get(1095 + '||' + key);
    const at = allTime.get(key);
    log('  ' + key.padEnd(16) + ' 全时段人数=' + String(at ? at.size : 0).padStart(7) +
      '  1095天窗口人数=' + String(c1095 ? c1095.size : 0).padStart(6));
  }

  /* ── 8. 全时段重建 PB vs 官方 best 一致性（抽样验证） ───────────── */
  log('\n═══════ ④ 全时段重建 PB vs 官方 best（抽样核对）══════');
  let checked = 0, mismatch = 0, samples = [];
  for (const key of comboKeys) {
    if (key.includes('mbf') || key.includes('mbo')) continue;   // multi 编码口径不同
    const am = allTime.get(key); const off = official.get(key);
    if (!am || !off) continue;
    for (const o of off.slice(0, 200)) {
      const mine = am.get(o.pid);
      if (mine == null) continue;
      checked++;
      if (mine !== o.best) { mismatch++; if (samples.length < 8) samples.push(`${key} ${o.pid}: 官方=${o.best} 重建=${mine}`); }
    }
  }
  log(`  比对 ${checked} 条，不一致 ${mismatch} 条`);
  samples.forEach((s) => log('    ' + s));

  log('\n耗时', ((Date.now() - t0) / 1000).toFixed(1) + 's');
})();

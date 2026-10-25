/**
 * M5 · F1 深度截断与并列的相互作用（诊断）
 * 现象：F1 人口 5,043 > 33 组合 × DEPTH(100) = 3,300 上限
 * 怀疑：窗口内同成绩密集，同名次导致「同名的所有人都算进前 100」
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
const DEPTH = 100;

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
    return { cost: (99 - (99 - DD)) * 1e5 + TT };
  }
  const S = String(v);
  const SS = +S.slice(1, 3), AA = +S.slice(3, 5), TT = Math.min(+S.slice(5, 10), 99999);
  const solved = 99 - SS, attempted = AA, missed = attempted - solved;
  return { cost: (99 - (solved - missed)) * 1e5 + TT };
}

(async () => {
  const t0 = Date.now();
  const log = (...a) => console.log(...a);
  const evFmt = new Map();
  await streamTsv('WCA_export_events.tsv', (r) => { if (r[0]) evFmt.set(r[0], r[1] || 'time'); });
  const compDay = new Map();
  await streamTsv('WCA_export_competitions.tsv', (r) => {
    if (!r[0] || r[10] === '1') return;
    const y = +r[17] || +r[14]; if (!y) return;
    const m = +r[18] || +r[15] || 1, d = +r[19] || +r[16] || 1;
    compDay.set(r[0], dayOf(y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0')));
  });
  const W = 365, CUT = SNAPSHOT_DAY - W;
  const win = new Map();     // ev|tr → Map(pid → {v})
  await streamTsv('WCA_export_results.tsv', (r) => {
    if (!r[8]) return;
    const day = compDay.get(r[4]);
    if (day === undefined || day <= CUT) return;
    const pid = r[8], ev = r[6];
    const isMulti = evFmt.get(ev) === 'multi';
    for (const [tr, raw] of [['single', +r[2]], ['average', +r[3]]]) {
      if (raw <= 0) continue;
      const v = isMulti ? decodeMulti(raw).cost : raw;
      const key = ev + '|' + tr;
      let mm = win.get(key);
      if (!mm) { mm = new Map(); win.set(key, mm); }
      const c = mm.get(pid);
      if (c == null || v < c.v) mm.set(pid, { v, day });
    }
  });
  log('窗口 365 天，组合数', win.size, '耗时', ((Date.now() - t0) / 1000).toFixed(1) + 's');

  log('\n组合'.padEnd(18) + '窗口人数'.padStart(9) + '并列人数'.padStart(9) + '≤100名次条目'.padStart(14) + '序号≤100条目'.padStart(14));
  let sumSame = 0, sumOrd = 0;
  for (const [key, mm] of [...win.entries()].sort()) {
    const list = [...mm.entries()].map(([pid, o]) => ({ pid, v: o.v })).sort((a, b) => a.v - b.v);
    // 同名次
    let rank = 0, prev = null, nSame = 0;
    for (const it of list) {
      if (prev === null || it.v !== prev) { rank++; prev = it.v; }
      it.wr = rank;
      if (rank <= DEPTH) nSame++;
    }
    const nOrd = Math.min(DEPTH, list.length);
    sumSame += nSame; sumOrd += nOrd;
    log(key.padEnd(18) + String(list.length).padStart(9) + String(nSame).padStart(9) +
      String(nSame).padStart(14) + String(nOrd).padStart(14));
  }
  log(`\n合计：同名次口径 ${sumSame} 条 ｜ 序号口径 ${sumOrd} 条 ｜ 差 ${sumSame - sumOrd} 条`);
  log('去重后人数上限约 ' + sumSame + '（实际会因一人多组合而更少）');
})();

'use strict';
/* 诊断：M3 加分里「本属地赛事 vs 客场赛事」的贡献拆分（三选手）
 * 复用 m3_record_bonus.js 的判定逻辑；额外叠加 S5 属地门槛的主/客场判定。
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const M2 = require('./m2.js');

const W_REC = { WR: 1.0, CR: 0.4, NR: 0.15 };
const W_TIER = { WC: 1.0, CC: 0.6, NC: 0.4 };
const CONT_CODES = new Set(['AfR', 'AsR', 'ER', 'NAR', 'OcR', 'SAR']);

function levelOf(v) {
  if (!v || v === 'NULL') return null;
  if (v === 'WR') return 'WR';
  if (v === 'NR') return 'NR';
  if (CONT_CODES.has(v)) return 'CR';
  return null;
}

const ZIP = fs.readdirSync(path.join(ROOT, 'data/raw')).filter((f) => f.endsWith('.zip'))[0];
const ZIP_PATH = path.join(ROOT, 'data/raw', ZIP);

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

(async () => {
  const isoOf = new Map();
  const contOfISO = new Map();
  await streamTsv('WCA_export_countries.tsv', (r) => {
    if (!r[0]) return;
    const iso = String(r[1] || '').toUpperCase();
    isoOf.set(r[0], iso);
    contOfISO.set(iso, String(r[3] || '').replace(/^_+/, '').trim());
  });

  const pInfo = new Map();
  await streamTsv('WCA_export_persons.tsv', (r) => {
    if (!r[2]) return;
    // 注意：persons.tsv 的 country_id 是**国家名**，必须经 isoOf 转成 ISO2，
    // 才能与 competitions.tsv 的举办国（同样是 ISO2）比较。
    pInfo.set(r[2], { name: r[0], iso: (isoOf.get(r[4]) || '').toUpperCase() });
  });

  const compInfo = new Map();
  await streamTsv('WCA_export_competitions.tsv', (r) => {
    if (!r[0]) return;
    // competitions.tsv 的 country_id 也是国家名 → 转 ISO2
    compInfo.set(r[0], {
      name: r[1] || r[0], year: +r[14] || 0, iso: (isoOf.get(r[6]) || '').toUpperCase()
    });
  });

  const ctypes = new Map();
  await streamTsv('WCA_export_championships.tsv', (r) => {
    if (!r[1]) return;
    if (!ctypes.has(r[1])) ctypes.set(r[1], new Set());
    ctypes.get(r[1]).add(String(r[2] || '').trim());
  });

  const TARGETS = ['Feliks Zemdegs', 'Max Park', 'Tymon Kolasiński'];
  const targetPid = new Map();
  for (const [id, p] of pInfo) {
    if (TARGETS.includes(p.name) && !targetPid.has(p.name)) targetPid.set(p.name, id);
  }
  const pidByName = new Map([...targetPid].map(([n, p]) => [p, n]));

  const seen = new Set();
  const acc = {};
  for (const n of TARGETS) acc[n] = { home: 0, away: 0, homeN: 0, awayN: 0, byEvent: new Map() };

  await streamTsv('WCA_export_results.tsv', (r) => {
    const pid = r[8]; if (!pid) return;
    const nm = pidByName.get(pid); if (!nm) return;
    const cid = r[4];
    const comp = compInfo.get(cid) || {};
    const iso = comp.iso || '';
    if (M2.isMultiRegion(iso)) return;
    const tier = M2.tierOf(ctypes.get(cid), iso);
    if (tier !== 'WC' && tier !== 'CC' && tier !== 'NC') return;
    const ev = r[6];
    for (const [type, raw] of [['S', r[10]], ['A', r[11]]]) {
      const L = levelOf(raw); if (!L) continue;
      const key = pid + '|' + cid + '|' + ev + '|' + type + '|' + L;
      if (seen.has(key)) continue;
      seen.add(key);
      const add = W_REC[L] * W_TIER[tier];
      const playerISO = (pInfo.get(pid) || {}).iso || '';
      let home;
      if (tier === 'WC') home = true;
      else if (tier === 'CC') home = (contOfISO.get(iso) === contOfISO.get(playerISO));
      else home = (iso === playerISO);
      const a = acc[nm];
      if (home) { a.home += add; a.homeN++; } else { a.away += add; a.awayN++; }
      const k2 = tier + '|' + (home ? '本属地' : '客场');
      a.byEvent.set(k2, (a.byEvent.get(k2) || 0) + add);
    }
  });

  console.log('选手'.padEnd(22) + '总M3'.padStart(10) + '本属地'.padStart(10) + '客场'.padStart(10) + '   条数 本/客');
  for (const n of TARGETS) {
    const a = acc[n];
    console.log(n.padEnd(20) + (a.home + a.away).toFixed(4).padStart(10) +
      a.home.toFixed(4).padStart(10) + a.away.toFixed(4).padStart(10) +
      '   ' + a.homeN + '/' + a.awayN);
    console.log('    分解: ' + [...a.byEvent].map(([k, v]) => k + '=' + v.toFixed(4)).join('   '));
  }
})();

'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const ROOT = path.resolve(__dirname, '../..');
const M2 = require('./m2.js');
const ZIP = fs.readdirSync(path.join(ROOT, 'data/raw')).filter((f) => f.endsWith('.zip'))[0];
const ZIP_PATH = path.join(ROOT, 'data/raw', ZIP);
function streamTsv(name, onRow) {
  return new Promise((resolve, reject) => {
    const ps = spawn('unzip', ['-p', ZIP_PATH, name]);
    let buf = ''; let head = true;
    ps.on('error', reject);
    ps.stdout.on('data', (d) => { buf += d.toString('utf8'); let i; while ((i = buf.indexOf('\n')) >= 0) { const ln = buf.slice(0, i); buf = buf.slice(i + 1); if (head) { head = false; continue; } if (ln) onRow(ln.split('\t')); } });
    ps.on('close', () => resolve());
  });
}
(async () => {
  const contRaw = new Map();
  await streamTsv('WCA_export_continents.tsv', (r) => contRaw.set(r[0], String(r[1] || r[0]).replace(/^_+/, '').trim()));
  const isoOf = new Map(); const isoInfo = new Map();
  await streamTsv('WCA_export_countries.tsv', (r) => { const iso = String(r[1] || '').toUpperCase(); isoOf.set(r[0], iso); isoInfo.set(iso, { name: r[2], cont: contRaw.get(r[3]) || 'Unknown' }); });
  const pInfo = new Map();
  await streamTsv('WCA_export_persons.tsv', (r) => { const id = r[2]; if (!id) return; pInfo.set(id, { name: r[0], iso: (isoOf.get(r[4]) || '').toUpperCase() }); });
  const compInfo = new Map();
  await streamTsv('WCA_export_competitions.tsv', (r) => { if (!r[0]) return; compInfo.set(r[0], { name: r[1] || r[0], year: +r[14] || 0, iso: (isoOf.get(r[6]) || '').toUpperCase() }); });
  const ctypes = new Map();
  await streamTsv('WCA_export_championships.tsv', (r) => { if (!r[1]) return; if (!ctypes.has(r[1])) ctypes.set(r[1], new Set()); ctypes.get(r[1]).add(String(r[2] || '').trim()); });
  const homeOf = (pid) => { const p = pInfo.get(pid); if (!p || !p.iso) return { nat: '', cont: 'Unknown' }; const info = isoInfo.get(p.iso) || {}; return { nat: p.iso, cont: info.cont || 'Unknown' }; };
  const rows = [];
  await streamTsv('WCA_export_results.tsv', (r) => {
    const pid = r[8]; if (!pid) return;
    const pos = +r[1]; const best = +r[2];
    if (!(pos >= 1 && pos <= 3) || !(best > 0)) return;
    if (r[5] !== 'f' && r[5] !== 'c') return;
    const compId = r[4]; const iso = (compInfo.get(compId) || {}).iso;
    if (M2.isMultiRegion(iso)) return;
    const tier = M2.tierOf(ctypes.get(compId), iso);
    if (tier === 'OP') return;
    rows.push({ pid, compId, ev: r[6], pos, tier });
  });
  let feliksPid = null; for (const [id, p] of pInfo) if (p.name === 'Feliks Zemdegs') { feliksPid = id; break; }
  const home = homeOf(feliksPid);
  console.log('Feliks home:', home);
  const events = ['ChinaChampionship2015', 'OC2022', 'AustralianNationals2010', 'USNationals2014', 'Euro2016', 'AsianChampionship2010'];
  for (const cid of events) {
    const c = compInfo.get(cid); if (!c) { console.log(cid, 'NOT FOUND'); continue; }
    const t = M2.tierOf(ctypes.get(cid), c.iso);
    const cont = (isoInfo.get(c.iso) || {}).cont;
    let aff = true;
    if (t === 'CC') aff = home.cont === cont;
    else if (t === 'NC') aff = home.nat === c.iso;
    const n = rows.filter((x) => x.pid === feliksPid && x.compId === cid).length;
    console.log(`${cid.padEnd(24)} host=${c.iso}(${cont}) 原赛级=${t} -> 门槛后=${aff ? t : 'OP(降M3)'} | Feliks领奖台=${n}`);
  }
})().catch((e) => { console.error(e); process.exit(1); });

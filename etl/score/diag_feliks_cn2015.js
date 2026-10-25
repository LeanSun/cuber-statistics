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
  // 1. Feliks pid
  const pInfo = new Map();
  await streamTsv('WCA_export_persons.tsv', (r) => {
    const id = r[2]; if (!id) return;
    pInfo.set(id, { name: r[0], iso: (r[4] || '').toUpperCase() });
  });
  let feliksPid = null, feliksName = null;
  for (const [id, p] of pInfo) if (p.name === 'Feliks Zemdegs') { feliksPid = id; feliksName = p; break; }
  console.log('Feliks pid =', feliksPid, 'iso =', feliksName && feliksName.iso);

  // 2. competitions: find China-related 2015
  const compInfo = new Map();
  await streamTsv('WCA_export_competitions.tsv', (r) => {
    if (!r[0]) return;
    compInfo.set(r[0], { name: r[1] || r[0], year: +r[14] || 0, iso: (r[6] || '').toUpperCase() });
  });
  console.log('\n--- 名称含 China/中 的 2015 赛事 ---');
  for (const [cid, c] of compInfo) {
    if (c.year === 2015 && /china|中/i.test(c.name)) console.log(cid, '|', c.name, '| iso=', c.iso);
  }

  // 3. championship_type for those comps
  const ctypes = new Map();
  await streamTsv('WCA_export_championships.tsv', (r) => {
    if (!r[1]) return;
    if (!ctypes.has(r[1])) ctypes.set(r[1], new Set());
    ctypes.get(r[1]).add(String(r[2] || '').trim());
  });
  console.log('\n--- 上述赛事的 championship_type ---');
  for (const [cid, c] of compInfo) {
    if (c.year === 2015 && /china|中/i.test(c.name)) {
      console.log(cid, '|', c.name, '| types=', JSON.stringify([...(ctypes.get(cid) || [])]));
    }
  }

  // 4. Feliks's podiums at any 2015 China comp
  const rows = [];
  await streamTsv('WCA_export_results.tsv', (r) => {
    if (r[8] !== feliksPid) return;
    rows.push({ compId: r[4], ev: r[6], pos: +r[1], best: +r[2], name: (compInfo.get(r[4]) || {}).name, year: (compInfo.get(r[4]) || {}).year });
  });
  console.log('\n--- Feliks 在所有 2015 名称含 China 赛事里的领奖台(pos1-3, best>0) ---');
  for (const x of rows) {
    if (x.year === 2015 && /china|中/i.test(x.name || '') && x.pos >= 1 && x.pos <= 3 && x.best > 0) {
      const types = ctypes.get(x.compId);
      const iso = (compInfo.get(x.compId) || {}).iso;
      const tier = M2.isMultiRegion(iso) ? 'OP' : M2.tierOf(types, iso);
      console.log(x.compId, '|', x.name, '| ev=', x.ev, '| pos=', x.pos, '| types=', JSON.stringify([...(types || [])]), '| iso=', iso, '| tierOf=>', tier);
    }
  }

  // 5. 对比：Feliks 全部被当前代码归类为 NC 的领奖台
  console.log('\n--- Feliks 当前被归类为 NC(国锦赛) 的所有领奖台（参赛国 != 澳大利亚AU 的，即"外国国锦赛"）---');
  let nNC = 0, nForeignNC = 0;
  for (const x of rows) {
    if (!(x.pos >= 1 && x.pos <= 3 && x.best > 0)) continue;
    const iso = (compInfo.get(x.compId) || {}).iso;
    const types = ctypes.get(x.compId);
    const tier = M2.isMultiRegion(iso) ? 'OP' : M2.tierOf(types, iso);
    if (tier === 'NC') {
      nNC++;
      const isForeign = iso !== 'AU';
      if (isForeign) nForeignNC++;
      console.log(x.compId, '|', x.name, '| iso=', iso, '| ev=', x.ev, '| pos=', x.pos, '| 外国国锦赛=', isForeign);
    }
  }
  console.log('\nFeliks 的 NC 领奖台总数 =', nNC, '，其中"在外国参赛"的 =', nForeignNC);
})().catch((e) => { console.error(e); process.exit(1); });

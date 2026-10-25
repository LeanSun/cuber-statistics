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
  const contRaw = new Map();
  await streamTsv('WCA_export_continents.tsv', (r) => contRaw.set(r[0], String(r[1] || r[0]).replace(/^_+/, '').trim()));
  const isoOf = new Map();
  const isoInfo = new Map();
  await streamTsv('WCA_export_countries.tsv', (r) => {
    const iso = String(r[1] || '').toUpperCase();
    isoOf.set(r[0], iso);
    isoInfo.set(iso, { name: r[2], cont: contRaw.get(r[3]) || 'Unknown' });
  });
  const pInfo = new Map();
  await streamTsv('WCA_export_persons.tsv', (r) => {
    const id = r[2]; if (!id) return;
    const iso = (isoOf.get(r[4]) || '').toUpperCase();
    pInfo.set(id, { name: r[0], iso });
  });
  const compInfo = new Map();
  await streamTsv('WCA_export_competitions.tsv', (r) => {
    if (!r[0]) return;
    compInfo.set(r[0], { name: r[1] || r[0], year: +r[14] || 0, iso: (isoOf.get(r[6]) || '').toUpperCase() });
  });
  const ctypes = new Map();
  await streamTsv('WCA_export_championships.tsv', (r) => {
    if (!r[1]) return;
    if (!ctypes.has(r[1])) ctypes.set(r[1], new Set());
    ctypes.get(r[1]).add(String(r[2] || '').trim());
  });

  // how many greater_china championships exist (data quirk probe)
  const gcComps = [];
  for (const [cid, c] of compInfo) {
    const t = ctypes.get(cid);
    if (t && [...t].some((x) => x === 'greater_china')) gcComps.push(cid);
  }
  console.log('=== greater_china 标记的赛事数 =', gcComps.length, '===');
  for (const cid of gcComps.slice(0, 40)) {
    const c = compInfo.get(cid);
    console.log('  ', cid, '|', c.name, '|', c.year, '| host=', c.iso);
  }
  console.log('（该类型在 m2.js 的 isContinentalType 中返回 true → 一律当 CC 洲锦赛处理）\n');

  // player home (continent) from person iso
  const homeOf = (pid) => {
    const iso = (pInfo.get(pid) || {}).iso || '';
    const cont = (isoInfo.get(iso) || {}).cont || 'Unknown';
    return { nat: iso, cont };
  };
  // event scope for a podium
  const scopeOf = (cid, tier) => {
    const c = compInfo.get(cid) || {};
    if (tier === 'NC') return { kind: 'nat', val: c.iso || '??' };
    if (tier === 'CC') return { kind: 'cont', val: (isoInfo.get(c.iso) || {}).cont || '??' };
    return { kind: 'global', val: 'WW' };
  };
  // does the player belong to this championship's scope?
  const affiliated = (home, scope) => {
    if (scope.kind === 'global') return true;
    if (scope.kind === 'nat') return home.nat === scope.val;
    if (scope.kind === 'cont') return home.cont === scope.val;
    return false;
  };

  // collect all podiums with current tier + foreign flag
  const rows = [];
  await streamTsv('WCA_export_results.tsv', (r) => {
    const pid = r[8]; if (!pid) return;
    const pos = +r[1]; const best = +r[2];
    if (!(pos >= 1 && pos <= 3) || !(best > 0)) return;
    const compId = r[4];
    const iso = (compInfo.get(compId) || {}).iso;
    if (M2.isMultiRegion(iso)) return; // OP, skip (multi-region goes to M3 anyway)
    const tier = M2.tierOf(ctypes.get(compId), iso);
    if (tier === 'OP') return;
    rows.push({ pid, compId, ev: r[6], pos, tier });
  });

  const globalCnt = { WC: 0, CC: 0, NC: 0 };
  const globalForeign = { WC: 0, CC: 0, NC: 0 };
  for (const x of rows) {
    globalCnt[x.tier]++;
    const home = homeOf(x.pid);
    const scope = scopeOf(x.compId, x.tier);
    if (!affiliated(home, scope)) globalForeign[x.tier]++;
  }
  console.log('=== 全站 M2 领奖台（WC/CC/NC）及其"外籍"比例（玩家不属于该锦标赛属地）===');
  for (const t of ['WC', 'CC', 'NC']) {
    const f = globalForeign[t]; const tot = globalCnt[t];
    console.log(`  ${t}: 总 ${tot} 条，其中外籍 ${f} 条（${tot ? (f / tot * 100).toFixed(2) : 0}%）`);
  }
  const gf = globalForeign.WC + globalForeign.CC + globalForeign.NC;
  const gt = globalCnt.WC + globalCnt.CC + globalCnt.NC;
  console.log(`  合计：${gt} 条，外籍 ${gf} 条（${gt ? (gf / gt * 100).toFixed(2) : 0}%）\n`);

  // Feliks detail
  let feliksPid = null;
  for (const [id, p] of pInfo) if (p.name === 'Feliks Zemdegs') { feliksPid = id; break; }
  const feliksRows = rows.filter((x) => x.pid === feliksPid);
  console.log('=== Feliks Zemdegs 的 M2 领奖台（按赛级 + 是否外籍）===');
  const byTier = { WC: { tot: 0, f: 0 }, CC: { tot: 0, f: 0 }, NC: { tot: 0, f: 0 } };
  const foreignEvs = new Map();
  for (const x of feliksRows) {
    const home = homeOf(x.pid);
    const scope = scopeOf(x.compId, x.tier);
    const f = !affiliated(home, scope);
    byTier[x.tier].tot++; if (f) byTier[x.tier].f++;
    if (f) {
      const c = compInfo.get(x.compId);
      foreignEvs.set(x.compId, (foreignEvs.get(x.compId) || 0) + 1);
    }
  }
  for (const t of ['WC', 'CC', 'NC']) {
    console.log(`  ${t}: ${byTier[t].tot} 条，其中外籍 ${byTier[t].f} 条`);
  }
  console.log('  Feliks 的"外籍"锦标赛领奖台来自这些赛事：');
  for (const [cid, n] of foreignEvs) {
    const c = compInfo.get(cid);
    const t = M2.tierOf(ctypes.get(cid), c.iso);
    console.log(`    ${cid} | ${c.name} | ${c.year} | host=${c.iso} | 当前赛级=${t} | Feliks领奖台=${n} 条`);
  }
})().catch((e) => { console.error(e); process.exit(1); });

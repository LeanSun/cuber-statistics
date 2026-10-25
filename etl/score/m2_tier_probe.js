'use strict';
/* M2 赛级分类体检：用原始 championships.tsv 的真实类型重算领奖台分层。
 *
 * 现行 build.js:294 的写法是
 *   if (t === 'world') champWC.add(); else champCC.add();
 * 但 championship_type 的真实取值只有三类：
 *   world / _Europe|_Asia|_South America|_Oceania|_North America|_Africa / 国家代码（SE、IT、GB…）
 * 于是 870 多场国家锦标赛全被当成洲际赛，按 0.7 计入 M2（本应 0.4 计入 M3）。
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const ROOT = path.resolve(__dirname, '../..');

const ZIP = fs.readdirSync(path.join(ROOT, 'data/raw')).filter((f) => f.endsWith('.zip'))[0];
const zipPath = path.join(ROOT, 'data/raw', ZIP);

function readTsv(name) {
  return new Promise((resolve) => {
    const ps = spawn('unzip', ['-p', zipPath, name]);
    let buf = '';
    const out = [];
    ps.stdout.on('data', (d) => {
      buf += d.toString('utf8');
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        out.push(buf.slice(0, i).split('\t'));
        buf = buf.slice(i + 1);
      }
    });
    ps.on('close', () => resolve(out));
  });
}

function streamTsv(name, onRow) {
  return new Promise((resolve) => {
    const ps = spawn('unzip', ['-p', zipPath, name]);
    let buf = '';
    let head = true;
    ps.stdout.on('data', (d) => {
      buf += d.toString('utf8');
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const ln = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (head) { head = false; continue; }
        if (ln) onRow(ln.split('\t'));
      }
    });
    ps.on('close', resolve);
  });
}

const placeW = (p) => (p === 1 ? 1 : (p === 2 ? 0.6 : 0.4));

(async () => {
  const champ = await readTsv('WCA_export_championships.tsv');
  const compInfo = await readTsv('WCA_export_competitions.tsv');
  const countryRows = await readTsv('WCA_export_countries.tsv');
  const nameToIso = new Map();
  for (const r of countryRows) {
    if (r[0] === 'id') continue;
    nameToIso.set(r[0], r[1]);
    nameToIso.set(r[2], r[1]);
  }
  const compCountry = new Map();      // compId -> 国家全名
  for (const r of compInfo) {
    if (r[0] === 'id') continue;
    compCountry.set(r[0], r[6]);
  }
  /* 同一赛事可以有多行类型（如 WC2019 既是 world 又是别的），必须收集全部 */
  const ctypes = new Map();           // compId -> Set(类型)
  for (const r of champ) {
    if (r[0] === 'id') continue;
    if (!ctypes.has(r[1])) ctypes.set(r[1], new Set());
    ctypes.get(r[1]).add(r[2]);
  }
  const isCont = (t) => t.startsWith('_') || t === 'greater_china';
  const tierOf = (compId) => {
    const set = ctypes.get(compId);
    if (!set) return 'OP';
    if (set.has('world')) return 'WC';
    for (const t of set) if (isCont(t)) return 'CC';
    const iso = nameToIso.get(compCountry.get(compId));
    for (const t of set) if (t === iso) return 'NC';
    return 'OP';
  };
  console.log('赛事按正确赛级：WC', [...ctypes.keys()].filter((k) => tierOf(k) === 'WC').length,
    '｜CC', [...ctypes.keys()].filter((k) => tierOf(k) === 'CC').length,
    '｜NC', [...ctypes.keys()].filter((k) => tierOf(k) === 'NC').length,
    '｜OP', [...ctypes.keys()].filter((k) => tierOf(k) === 'OP').length);

  const byOld = { WC: 0, CC: 0, NC: 0, OP: 0 };
  const byNew = { WC: 0, CC: 0, NC: 0, OP: 0 };
  const per = new Map();   // pid -> {name, o2, o3, n2, n3, wc, cc, nc, op}
  const got = (pid, name) => {
    let a = per.get(pid);
    if (!a) { a = { name, o2: 0, o3: 0, n2: 0, n3: 0, wc: 0, cc: 0, nc: 0, op: 0 }; per.set(pid, a); }
    return a;
  };

  let rows = 0;
  await streamTsv('WCA_export_results.tsv', (r) => {
    const rt = r[5];
    if (rt !== 'f' && rt !== 'c') return;
    const pos = +r[1];
    if (!(pos >= 1 && pos <= 3)) return;
    const compId = r[4];
    const pid = r[8];
    const name = r[7];
    if (!ctypes.has(compId)) return;        // 不是任何级别的冠军赛
    rows++;
    const oldTier = 'CC';                   // 现行逻辑：非 world 一律 CC
    const newTier = tierOf(compId);
    byOld[oldTier]++;
    byNew[newTier]++;
    const a = got(pid, name);
    const w = placeW(pos);
    a.o2 += w * 0.7;
    a.o3 += w * 0.4;
    if (newTier === 'WC') { a.n2 += w * 1.0; a.wc++; }
    else if (newTier === 'CC') { a.n2 += w * 0.7; a.cc++; }
    else if (newTier === 'NC') { a.n3 += w * 0.4; a.nc++; }
    else { a.n3 += w * 0.4; a.op++; }
  });

  console.log('冠军赛决赛领奖台行数', rows);
  console.log('现行分层', JSON.stringify(byOld));
  console.log('正确分层', JSON.stringify(byNew));
  console.log('');
  const A = [...per.values()];
  const top = (k) => A.slice().sort((x, y) => y[k] - x[k]).slice(0, 12);
  const line = (t, x, i) => `${String(i + 1).padStart(2)} ${x.name.padEnd(26)} `
    + `旧 m2 ${x.o2.toFixed(2).padStart(7)} → 新 m2 ${x.n2.toFixed(2).padStart(7)} `
    + `｜WC ${x.wc} CC ${x.cc} NC ${x.nc}`;
  console.log('=== 现行口径 m2 前 12 ===');
  top('o2').forEach((x, i) => console.log(line('old', x, i)));
  console.log('');
  console.log('=== 正确赛级 m2 前 12 ===');
  top('n2').forEach((x, i) => console.log(line('new', x, i)));
  console.log('');
  console.log('=== 正确赛级 m3 前 8 ===');
  top('n3').slice(0, 8).forEach((x, i) =>
    console.log(`${String(i + 1).padStart(2)} ${x.name.padEnd(26)} m3 ${x.n3.toFixed(2).padStart(7)} ｜NC ${x.nc} 其他 ${x.op}`));
})();

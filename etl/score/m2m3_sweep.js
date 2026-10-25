'use strict';
/* α 扫描：不引入 β，只看「重复衰减」这一根杠杆能把两维配比推到哪
 *
 * 目的：验证「只用 α、不用 β」能否既平衡总量，又保住深度定价的跨级比例。
 * 用法：node --max-old-space-size=6144 etl/score/m2m3_sweep.js
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const M1 = require('./m1.js');
const RN = require('./runs.js');
const M2 = require('./m2.js');

const F = RN.F4;
const num = (v) => Number(v).toLocaleString('en-US');
const PCT = (v) => (v * 100).toFixed(1) + '%';
const ZIP = fs.readdirSync(path.join(ROOT, 'data/raw')).filter((f) => f.endsWith('.zip'))[0];

function streamTsv(name, onRow) {
  return new Promise((resolve, reject) => {
    const ps = spawn('unzip', ['-p', path.join(ROOT, 'data/raw', ZIP), name]);
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
const med = (a) => {
  if (!a.length) return 0;
  const b = a.slice().sort((x, y) => x - y);
  const m = b.length >> 1;
  return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2;
};

const GAMMA = 0.8015;
const K_OF = { OP: 1.0000, NC: 1.0000, CC: 1.6000, WC: 1.6000 };

(async () => {
  const isoOf = new Map(); const isoInfo = new Map(); const contOfRaw = new Map();
  await streamTsv('WCA_export_continents.tsv', (r) => contOfRaw.set(r[0], String(r[1] || r[0]).replace(/^_+/, '').trim()));
  await streamTsv('WCA_export_countries.tsv', (r) => {
    const iso = String(r[1] || '').toUpperCase();
    isoOf.set(r[0], iso);
    isoInfo.set(iso, { name: r[2], cont: contOfRaw.get(r[3]) || 'Unknown' });
  });
  const pInfo = new Map();
  await streamTsv('WCA_export_persons.tsv', (r) => {
    const id = r[2]; if (!id) return;
    const sub = +r[3] || 0;
    const cur = pInfo.get(id);
    if (cur && sub < cur.sub) return;
    pInfo.set(id, { name: r[0], iso: (isoOf.get(r[4]) || '').toUpperCase(), sub });
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

  const compEvPeople = new Map(); const firstYear = new Map(); const rows = [];
  await streamTsv('WCA_export_results.tsv', (r) => {
    const pid = r[8]; if (!pid) return;
    const compId = r[4];
    const comp = compInfo.get(compId) || {};
    const year = comp.year || 0;
    const fy = firstYear.get(pid);
    if (!fy || (year && year < fy)) firstYear.set(pid, year);
    const ev = r[6];
    const k = compId + '|' + ev;
    let st = compEvPeople.get(k);
    if (!st) { st = new Set(); compEvPeople.set(k, st); }
    st.add(pid);
    const pos = +r[1];
    if (!(pos >= 1 && pos <= 3)) return;
    if (r[5] !== 'f' && r[5] !== 'c') return;
    if (!(+r[2] > 0)) return;
    rows.push({ pid, ev, pos, compId, year, nat: comp.iso || '' });
  });

  const cc = {}; const nc = {}; const people = [];
  for (const [pid, p] of pInfo) {
    const cont = (isoInfo.get(p.iso) || {}).cont || 'Unknown';
    nc[p.iso] = (nc[p.iso] || 0) + 1;
    cc[cont] = (cc[cont] || 0) + 1;
    const y = firstYear.get(pid);
    if (y) people.push({ y, cont, nat: p.iso });
  }
  const pool = M1.makeScopePool(people, 2026);

  const items = [];
  for (const r of rows) {
    const tier = M2.isMultiRegion(r.nat) ? 'OP' : M2.tierOf(ctypes.get(r.compId), r.nat);
    const cont = (isoInfo.get(r.nat) || {}).cont || 'Unknown';
    const field = (compEvPeople.get(r.compId + '|' + r.ev) || { size: 1 }).size;
    const f = pool ? pool.valueOf(tier === 'OP' ? 'WR' : 'NR', { nat: r.nat, cont }, +r.year || 2026) : 1;
    const w = RN.EV_WEIGHT_V2[r.ev] == null ? RN.WEIGHT_V2_CFG.floor : RN.EV_WEIGHT_V2[r.ev];
    items.push({ pid: r.pid, ev: r.ev, tier, pos: r.pos, year: r.year, field, f, w, compId: r.compId,
      name: (pInfo.get(r.pid) || {}).name || r.pid });
  }

  const opF = new Map();
  for (const it of items) {
    if (it.tier !== 'OP') continue;
    if (!opF.has(it.ev)) opF.set(it.ev, []);
    opF.get(it.ev).push(it.field);
  }
  const REF = new Map();
  for (const [ev, a] of opF) if (a.length >= 30) REF.set(ev, med(a));
  const refAll = med([...opF].filter(([, a]) => a.length >= 30).map(([, a]) => med(a)));
  const refOf = (ev) => REF.get(ev) || refAll;

  for (const it of items) {
    it.base = (M2.PLACE_W[it.pos] || 0) * K_OF[it.tier]
      * Math.pow(it.field / refOf(it.ev), GAMMA) * it.f * it.w;
    it.n = 1;
  }
  const grp = new Map();
  for (const it of items) {
    if (it.tier !== 'OP') continue;
    const k = it.pid + '|' + it.ev;
    if (!grp.has(k)) grp.set(k, []);
    grp.get(k).push(it);
  }
  for (const [, a] of grp) {
    a.sort((x, y) => (x.year - y.year) || String(x.compId).localeCompare(String(y.compId)));
    a.forEach((it, i) => { it.n = i + 1; });
  }

  const agg = (alpha) => {
    const by = new Map();
    for (const it of items) {
      const d = it.tier === 'OP' ? Math.pow(it.n, -alpha) : 1;
      const v = it.base * d;
      let a = by.get(it.pid);
      if (!a) { a = { pid: it.pid, name: it.name, total: 0, m2: 0, m3: 0, n: 0 }; by.set(it.pid, a); }
      a.total += v;
      if (it.tier === 'OP') a.m3 += v; else a.m2 += v;
      a.n++;
    }
    const list = [...by.values()].filter((x) => x.total > 0).sort((a, b) => b.total - a.total);
    list.forEach((x, i) => { x.rank = i + 1; });
    return list;
  };

  const S2 = items.filter((it) => it.tier !== 'OP').reduce((s, it) => s + it.base, 0);
  const pure = agg(0);
  const pureTop = new Map();
  pure.slice(0, 200).forEach((x) => pureTop.set(x.pid, x.rank));

  const ALPHAS = [0, 0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 2.5, 3.0];
  const L = (s) => console.log(s);

  L('# α 扫描：只用重复衰减，不用 β');
  L('');
  L('单价不动：普通赛 1.0000 / 国锦赛 1.3042 / 洲锦赛 5.8787 / 世锦赛 7.3221。');
  L('α 只作用于普通赛，`第 n 次同人同项目领奖台 × n^-α`。');
  L('');
  L('| α | M3 占比(全局) | Top10 的 M3 中位 | Top100 的 M3 中位 | 总量 |');
  L('|---|---|---|---|---|');
  const res = [];
  for (const a of ALPHAS) {
    const list = agg(a);
    const S3 = list.reduce((s, x) => s + x.m3, 0);
    const share = S3 / (S3 + S2);
    const t10 = med(list.slice(0, 10).map((x) => x.m3 / x.total));
    const t100 = med(list.slice(0, 100).map((x) => x.m3 / x.total));
    res.push({ a, list, share, t10, t100, tot: S3 + S2 });
    L('| ' + F(a) + ' | ' + PCT(share) + ' | ' + PCT(t10) + ' | ' + PCT(t100) + ' | ' + F(S3 + S2) + ' |');
  }
  L('');

  L('## 各 α 的 Top8');
  L('');
  for (const r of res) {
    L('**α = ' + F(r.a) + '**（M3 全局 ' + PCT(r.share) + '）');
    L('');
    L('| # | 选手 | 总分 | M2 | M3 | M3 占比 |');
    L('|---|---|---|---|---|---|');
    for (let i = 0; i < 8; i++) {
      const x = r.list[i]; if (!x) break;
      L('| ' + (i + 1) + ' | ' + x.name + ' | ' + F(x.total) + ' | ' + F(x.m2) + ' | ' + F(x.m3) + ' | ' + PCT(x.m3 / x.total) + ' |');
    }
    L('');
  }

  /* 关键选手追踪 */
  const watch = ['Luke Garrett', 'Bence Barát', 'Feliks Zemdegs', 'Tymon Kolasiński', 'Max Park',
    'Martin Vædele Egdal', 'Daniel Wallin', 'Stanley Chapel', '王艺衡', 'Yiheng Wang'];
  L('## 关键选手在 α 上的名次轨迹');
  L('');
  const findPid = (nm) => {
    const hit = [...pInfo.entries()].find(([, p]) => p.name && p.name.includes(nm));
    return hit ? hit[0] : null;
  };
  L('| 选手 | ' + ALPHAS.map((a) => 'α=' + a).join(' | ') + ' |');
  L('|---|' + ALPHAS.map(() => '---').join('|') + '|');
  const ids = [];
  for (const nm of watch) {
    const pid = findPid(nm);
    if (!pid) continue;
    ids.push([nm, pid]);
  }
  for (const [nm, pid] of ids) {
    const cells = res.map((r) => {
      const x = r.list.find((y) => y.pid === pid);
      return x ? x.rank + ' (' + F(x.total) + ')' : '—';
    });
    L('| ' +nm + ' | ' + cells.join(' | ') + ' |');
  }
  L('');

  /* Spearman vs 纯 M2 */
  L('## 与「纯 M2 排名」的一致性（Top200，Spearman）');
  L('');
  L('| α | Spearman | Top20 重合 |');
  L('|---|---|---|');
  for (const r of res) {
    let s = 0; let n = 0;
    for (const x of r.list.slice(0, 200)) {
      const pr = pureTop.get(x.pid);
      if (!pr) continue;
      s += (pr - x.rank) ** 2; n++;
    }
    const rho = 1 - (6 * s) / (n * (n * n - 1));
    const o20 = r.list.slice(0, 20).filter((x) => pureTop.get(x.pid) <= 20).length;
    L('| ' + F(r.a) + ' | ' + F(rho) + ' | ' + o20 + '/20 |');
  }
  L('');
  L('纯 M2 榜首 ' + F(pure[0].total) + '（' + pure[0].name + '）→ #2 ' + F(pure[1].total)
    + '（' + pure[1].name + '）→ #3 ' + F(pure[2].total) + '（' + pure[2].name + '）');
  L('纯 M2 榜首的口径下，国锦赛/普通赛/洲锦赛/世锦赛 四级的实际单条均分比 = 1.0000 / 1.3042 / 5.8787 / 7.3221，与实测深度 1.29 / 6.00 / 7.89 一致。');
})().catch((e) => { console.error(e); process.exit(1); });

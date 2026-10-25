'use strict';
/* 对照：Feliks(大洋洲) vs Tymon(欧洲) 的洲锦赛机会与计分
 * 复用 m2m3_balance.js 内核（α=0.5），只做 CC 维度拆解。 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const ROOT = path.resolve(__dirname, '../..');
const RN = require('./runs.js');
const M1 = require('./m1.js');
const M2 = require('./m2.js');
const F = RN.F4;

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
const med = (a) => { if (!a.length) return 0; const b = a.slice().sort((x, y) => x - y); const m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; };
const GAMMA = 0.8015, NSAT = 500;
const K_OF = { OP: 1.0, NC: 1.0, CC: 1.6, WC: 1.6 };
const hill = (x) => NSAT * Math.log(1 + Math.max(x, 0) / NSAT);
const ALPHA = 0.5;

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
    const sub = +r[3] || 0; const cur = pInfo.get(id);
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
  const compEvPeople = new Map(); const rows = []; const firstYear = new Map();
  await streamTsv('WCA_export_results.tsv', (r) => {
    const pid = r[8]; if (!pid) return;
    const compId = r[4]; const comp = compInfo.get(compId) || {}; const year = comp.year || 0;
    const fy = firstYear.get(pid);
    if (!fy || (year && year < fy)) firstYear.set(pid, year);
    const ev = r[6]; const k = compId + '|' + ev;
    let st = compEvPeople.get(k); if (!st) { st = new Set(); compEvPeople.set(k, st); } st.add(pid);
    const pos = +r[1];
    if (!(pos >= 1 && pos <= 3)) return;
    if (r[5] !== 'f' && r[5] !== 'c') return;
    if (!(+r[2] > 0)) return;
    rows.push({ pid, ev, pos, compId, year, nat: comp.iso || '' });
  });
  const people = [];
  for (const [pid, p] of pInfo) {
    const cont = (isoInfo.get(p.iso) || {}).cont || 'Unknown';
    const y = firstYear.get(pid);
    if (y) people.push({ y, cont, nat: p.iso });
  }
  const pool = M1.makeScopePool(people, 2026);
  const items = [];
  for (const r of rows) {
    const multi = M2.isMultiRegion(r.nat);
    const tier = multi ? 'OP' : M2.tierOf(ctypes.get(r.compId), r.nat);
    const cont = (isoInfo.get(r.nat) || {}).cont || 'Unknown';
    const field = (compEvPeople.get(r.compId + '|' + r.ev) || { size: 1 }).size;
    const who = { nat: r.nat, cont };
    const fNat = pool ? pool.valueOf('NR', who, r.year || 2026) : 1;
    const fGlb = pool ? pool.valueOf('WR', who, r.year || 2026) : 1;
    const w = RN.EV_WEIGHT_V2[r.ev] == null ? RN.WEIGHT_V2_CFG.floor : RN.EV_WEIGHT_V2[r.ev];
    items.push({ pid: r.pid, ev: r.ev, tier, pos: r.pos, year: r.year, field, fNat, fGlb, w, compId: r.compId, nat: r.nat, cont });
  }
  /* CC DEBUG */
  let ccShould = 0; const ccBad = [];
  for (const it of items) {
    const t = ctypes.get(it.compId) || new Set();
    if ([...t].some((x) => M2.isContinentalType(x))) {
      ccShould++;
      if (it.tier !== 'CC') { if (ccBad.length < 5) ccBad.push({ compId: it.compId, tier: it.tier, types: [...t], nat: it.nat }); }
    }
  }
  console.log('CCDEBUG continental-in-ctypes items=', ccShould, 'of which tier!=CC=', ccBad.length, JSON.stringify(ccBad));
  const HOME = new Map();
  const homeOf = (pid) => {
    if (HOME.has(pid)) return HOME.get(pid);
    const p = pInfo.get(pid); let h = { nat: '', cont: 'Unknown' };
    if (p && p.iso) { const info = isoInfo.get(p.iso) || {}; h = { nat: p.iso, cont: info.cont || 'Unknown' }; }
    HOME.set(pid, h); return h;
  };
  let GATE_CC = 0, GATE_NC = 0;
  for (const it of items) {
    if (it.tier === 'WC') continue;
    it.origTier = it.tier;
    const home = homeOf(it.pid); let aff = true;
    if (it.tier === 'CC') { if (home.cont !== it.cont) aff = false; }
    else if (it.tier === 'NC') { if (home.nat !== it.nat) aff = false; }
    if (!aff) it.tier = 'OP';
  }
  console.log('GATEDEBUG GATE_CC=', GATE_CC, 'GATE_NC=', GATE_NC);
  let shown = 0;
  for (const it of items) {
    if (it.tier !== 'CC') continue;
    const home = homeOf(it.pid);
    if (shown < 5) { console.log('  CC kept:', it.compId, 'home=', home.cont, 'it.cont=', it.cont, 'pid=', it.pid); shown++; }
  }
  shown = 0;
  for (const it of items) {
    if (it.origTier !== 'CC') continue;
    const home = homeOf(it.pid);
    if (shown < 5) { console.log('  CC gated:', it.compId, 'home=', home.cont, 'it.cont=', it.cont, 'pid=', it.pid); shown++; }
  }
  const F_POOL = { OP: 'WR', NC: 'NR', CC: 'NR', WC: 'WR' };
  const fOf = (it) => (F_POOL[it.tier] === 'WR' ? it.fGlb : it.fNat);
  const opByEv = new Map();
  for (const it of items) { if (it.tier !== 'OP') continue; if (!opByEv.has(it.ev)) opByEv.set(it.ev, []); opByEv.get(it.ev).push({ year: it.year, field: it.field }); }
  const REF = new Map();
  for (const [ev, a] of opByEv) if (a.length >= 30) REF.set(ev, med(a.map((x) => x.field)));
  const refAll = med([...opByEv].filter(([, a]) => a.length >= 30).map(([, a]) => med(a.map((x) => x.field))));
  const refOfG = (ev) => REF.get(ev) || refAll;
  const WIN = [2, 3, 5, 8, 15]; const MIN_SAMPLES = 20; const eraCache = new Map();
  const refOfEra = (ev, year) => {
    const key = ev + '|' + year; if (eraCache.has(key)) return eraCache.get(key);
    const list = opByEv.get(ev) || []; let best = null;
    for (const w of WIN) { const l = list.filter((x) => Math.abs(x.year - year) <= w).map((x) => x.field); if (l.length >= MIN_SAMPLES) { best = med(l); break; } }
    if (best == null) { const l = list.filter((x) => Math.abs(x.year - year) <= 15).map((x) => x.field); if (l.length) best = med(l); else best = refOfG(ev); }
    eraCache.set(key, best); return best;
  };
  for (const it of items) {
    const P = M2.PLACE_W[it.pos] || 0; const K = K_OF[it.tier]; const refEra = refOfEra(it.ev, it.year);
    it.base = P * K * Math.pow(hill(it.field) / hill(refEra), GAMMA) * fOf(it) * it.w;
    it.n = 1;
  }
  const grp = new Map();
  for (const it of items) { if (it.tier !== 'OP') continue; const k = it.pid + '|' + it.ev; if (!grp.has(k)) grp.set(k, []); grp.get(k).push(it); }
  for (const [, a] of grp) { a.sort((x, y) => (x.year - y.year) || String(x.compId).localeCompare(String(y.compId))); a.forEach((it, i) => { it.n = i + 1; it.decay = Math.pow(i + 1, -ALPHA); }); }
  for (const it of items) if (it.tier !== 'OP') it.decay = 1;

  // 1) 全站各洲「洲锦赛历史届数」（按 comp 去重，且 championship_type 含 continental）
  const ccByCont = {}; const ccComps = {};
  for (const compId of compInfo.keys()) {
    const types = ctypes.get(compId) || new Set();
    if (![...types].some((t) => M2.isContinentalType(t))) continue;
    const comp = compInfo.get(compId); const cont = (isoInfo.get(comp.iso) || {}).cont || 'Unknown';
    const hostCont = (isoInfo.get(comp.iso) || {}).cont || 'Unknown';
    ccByCont[hostCont] = ccByCont[hostCont] || new Set(); ccByCont[hostCont].add(compId);
  }
  console.log('══ 全站各洲「洲锦赛历史届数」（按 comp 去重）══');
  for (const [c, s] of Object.entries(ccByCont).sort((a, b) => b[1].size - a[1].size))
    console.log(`  ${c}: ${s.size} 届`);

  // 2) 三位选手：本人 home 洲 / 参加的洲锦赛（home 口径）届数 & 领奖台数 & CC 计分
  const names = ['Feliks Zemdegs', 'Tymon Kolasiński', 'Max Park'];
  console.log('\n══ 三选手：本洲洲锦赛（home 口径）══');
  for (const nm of names) {
    let pid = null; for (const [id, p] of pInfo) if (p.name === nm) { pid = id; break; }
    if (!pid) { console.log('  未找到', nm); continue; }
    const home = homeOf(pid);
    const ccItems = items.filter((it) => it.pid === pid && it.tier === 'CC');
    if (ccItems.length) {
      const s = ccItems[0];
      const refEra = refOfEra(s.ev, s.year);
      console.log(`    [dbg] sample: pos=${s.pos} K=${K_OF[s.tier]} field=${s.field} refEra=${refEra} fNat=${s.fNat} fGlb=${s.fGlb} fOf=${fOf(s)} w=${s.w} base=${s.base} decay=${s.decay}`);
    }
    const comps = new Set(ccItems.map((it) => it.compId));
    const score = ccItems.reduce((s, it) => s + it.base * it.decay, 0);
    const byYear = {};
    ccItems.forEach((it) => { byYear[it.year] = (byYear[it.year] || 0) + 1; });
    console.log(`\n  ${nm}（home 洲=${home.cont}，国=${home.nat}）`);
    console.log(`    本洲洲锦赛参赛届数=${comps.size}，领奖台条数=${ccItems.length}，CC 计分=${F(score)}`);
    console.log(`    分届：${Object.keys(byYear).sort().map((y) => y + ':' + byYear[y]).join('  ')}`);
    // 列出具体赛事
    const detail = {};
    ccItems.forEach((it) => { const c = compInfo.get(it.compId); const k = `${it.year} ${c.name}`; detail[k] = (detail[k] || 0) + 1; });
    console.log('    赛事：' + Object.entries(detail).map(([k, v]) => `${k}(${v})`).join('、'));
  }

  // 3) 反事实：若取消属地门槛（外籍 CC 也计），Tymon/Feliks 的 CC 计分涨多少
  console.log('\n══ 反事实：取消属地门槛（外籍洲锦赛也计）══');
  for (const nm of names) {
    let pid = null; for (const [id, p] of pInfo) if (p.name === nm) { pid = id; break; }
    if (!pid) continue;
    const home = homeOf(pid);
    // 重算未门槛的 CC（仅用于展示差距）：从原始 items 但忽略 gate
    // 用原始 rows 重判 tier（不 gate）
    const rawCC = items.filter((it) => it.pid === pid && it.tier === 'CC'); // 已 gate 后的 home CC
    const allCC = [];
    for (const r of rows) {
      const multi = M2.isMultiRegion(r.nat);
      const tier = multi ? 'OP' : M2.tierOf(ctypes.get(r.compId), r.nat);
      if (tier !== 'CC') continue;
      if (r.pid !== pid) continue;
      const cont = (isoInfo.get(r.nat) || {}).cont || 'Unknown';
      const field = (compEvPeople.get(r.compId + '|' + r.ev) || { size: 1 }).size;
      const who = { nat: r.nat, cont };
      const fNat = pool ? pool.valueOf('NR', who, r.year || 2026) : 1;
      const fGlb = pool ? pool.valueOf('WR', who, r.year || 2026) : 1;
      const w = RN.EV_WEIGHT_V2[r.ev] == null ? RN.WEIGHT_V2_CFG.floor : RN.EV_WEIGHT_V2[r.ev];
      const P = M2.PLACE_W[r.pos] || 0; const K = K_OF.CC;
      const refEra = refOfEra(r.ev, r.year);
      const f = fNat;
      const base = P * K * Math.pow(hill(field) / hill(refEra), GAMMA) * f * w;
      allCC.push(base);
    }
    const sHome = rawCC.reduce((s, it) => s + it.base * it.decay, 0);
    const sAll = allCC.reduce((s, v) => s + v, 0);
    console.log(`  ${nm}: home CC=${F(sHome)}，含外籍 CC=${F(sAll)}（差 ${F(sAll - sHome)}）`);
  }
})();

#!/usr/bin/env node
'use strict';
/* ============================================================
   etl/build.js — WCA 官方导出 → js/data.js（真实 GOAT 数据）
   ------------------------------------------------------------
   零依赖。从 WCA v2 TSV 导出（zip 或已解压目录）解析：
     persons / competitions / championships / countries /
     continents / events / ranks_single / ranks_average / results
   计算七模块评分、纪录 / 领奖台明细、WR 泳道、单项目里程碑、
   国家聚合、洲际映射，并调用 js/calc.js 的 Calc.assemble 产出
   window.MOCK 兼容对象，写入 js/data.js。

   用法：
     node etl/build.js --zip data/raw/wca_v2.tsv.zip --out js/data.js
     node etl/build.js --dir  data/raw/extracted
     node etl/build.js --zip ... --emit-max 25000     （仅输出综合榜前 N）
     node etl/build.js --dir sample --out /tmp/data.js --date 2026-10-18 --ver v2.0.2
   ============================================================ */
const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const Calc = require('../js/calc.js');
const ROOT = path.resolve(__dirname, '..');

/* ---------------- 参数 ---------------- */
const argv = process.argv.slice(2);
function arg(name, def) {
  const i = argv.indexOf(name);
  if (i >= 0 && i + 1 < argv.length) return argv[i + 1];
  return def;
}
const ZIP = arg('--zip', null);
const DIR = arg('--dir', null);
const OUT = arg('--out', path.join(ROOT, 'js', 'data.js'));
const EMIT_MAX = parseInt(arg('--emit-max', '0'), 10) || 0;
const SLIM_MAX = parseInt(arg('--slim-max', '30000'), 10) || 0;
const DETAIL_MAX = parseInt(arg('--detail-max', '2500'), 10) || 0;
const KEEP_YEARLY = 3000;
let KEEP_YEARLY_N = KEEP_YEARLY;
const HELP = argv.indexOf('--help') >= 0 || argv.indexOf('-h') >= 0;

if (HELP || (!ZIP && !DIR)) {
  console.log('Usage: node etl/build.js --zip <WCA_export.tsv.zip> | --dir <extracted_dir> [--out js/data.js] [--emit-max N] [--date YYYY-MM-DD] [--ver vX.Y.Z]');
  process.exit(HELP ? 0 : 1);
}

const log = (...a) => console.log('[etl]', ...a);

/* ---------------- 读取 TSV（zip 或目录） ---------------- */
// WCA v1/v2 文件名有差异，这里同时兼容多种写法：
//   WCA_persons.tsv / WCA_export_Persons.tsv / WCA_export_persons.tsv 等
function candidates(base) {
  const caps = base.split('_').map((s) => s[0].toUpperCase() + s.slice(1)).join('');
  return [
    'WCA_' + base + '.tsv',
    'WCA_export_' + caps + '.tsv',
    'WCA_export_' + base + '.tsv',
    base + '.tsv'
  ];
}

function findEntry(base) {
  const out = execFileSync('unzip', ['-l', ZIP]).toString();
  const lines = out.split('\n');
  const names = lines.map((l) => l.trim().split(/\s+/).pop()).filter(Boolean);
  for (const cand of candidates(base)) {
    const idx = names.findIndex((n) => n.toLowerCase().endsWith(cand.toLowerCase()) || n === cand);
    if (idx >= 0) {
      const entry = names[idx];
      log('zip entry matched', base, '=>', entry);
      return entry;
    }
  }
  throw new Error('entry not found in zip: ' + base + '\nAvailable names (sample): ' + names.slice(0, 20).join(', '));
}

function openEntry(base) {
  if (DIR) {
    const files = [];
    const walk = (d) => {
      for (const f of fs.readdirSync(d)) {
        const p = path.join(d, f);
        const st = fs.statSync(p);
        if (st.isDirectory()) walk(p);
        else files.push(p);
      }
    };
    walk(DIR);
    for (const cand of candidates(base)) {
      const fp = files.find((p) => path.basename(p).toLowerCase() === cand.toLowerCase());
      if (fp) { log('dir entry matched', base, '=>', fp); return fs.createReadStream(fp, { encoding: 'utf8' }); }
    }
    throw new Error('file not found for base: ' + base + ' in ' + DIR);
  }
  const entry = findEntry(base);
  const child = spawn('unzip', ['-p', ZIP, entry], { stdio: ['ignore', 'pipe', 'ignore'] });
  return child.stdout;
}

function streamTsv(base, onRow) {
  return new Promise((resolve, reject) => {
    const stream = openEntry(base);
    let buf = '';
    let cols = null;
    let rowN = 0;
    stream.on('data', (chunk) => {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, '');
        buf = buf.slice(nl + 1);
        if (cols === null) { cols = line.split('\t'); continue; }
        if (!line.trim()) continue;
        const parts = line.split('\t');
        rowN++;
        const obj = {};
        for (let i = 0; i < cols.length; i++) obj[cols[i]] = parts[i];
        onRow(obj, rowN);
      }
    });
    stream.on('end', () => {
      if (buf.trim()) {
        const parts = buf.replace(/\r$/, '').split('\t');
        if (cols) { const obj = {}; for (let i = 0; i < cols.length; i++) obj[cols[i]] = parts[i]; onRow(obj, ++rowN); }
      }
      resolve(rowN);
    });
    stream.on('error', reject);
  });
}

/* ---------------- 工具 ---------------- */
function toInt(v) { const n = parseInt(v, 10); return isNaN(n) ? 0 : n; }
/* 秒 → mm:ss / h:mm:ss */
function fmtDur(t) {
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  const mm = String(m).padStart(2, '0'), ss = String(s).padStart(2, '0');
  return (h > 0 ? h + ':' : '') + mm + ':' + ss;
}
function fmtResult(eventId, value, type) {
  const ev = Calc.EV[eventId] || { format: 'time' };
  const fmt = ev.format || 'time';
  const v = toInt(value);
  if (v <= 0) return '—';
  if (fmt === 'time') {
    const sec = v / 100;
    if (sec >= 60) {
      const m = Math.floor(sec / 60);
      const s = (sec - m * 60).toFixed(2).padStart(5, '0');
      return m + ':' + s;
    }
    return sec.toFixed(2);
  }
  if (fmt === 'number') {
    if (type === 'avg') return (v / 100).toFixed(2);
    return String(v);
  }
  if (fmt === 'multi') {
    const s = String(v).padStart(10, '0');
    let solved, attempted, t;
    if (s[0] === '1') {
      // 旧编码 1SSAATTTTT（旧多盲 333mbo，2006–2011）
      solved = 99 - toInt(s.slice(1, 3));
      attempted = toInt(s.slice(3, 5));
      t = toInt(s.slice(5, 10));
    } else {
      // 新编码 0DDTTTTTMM
      const dd = toInt(s.slice(1, 3));
      t = toInt(s.slice(3, 8));
      const mm = toInt(s.slice(8, 10));
      const diff = 99 - dd;
      solved = diff + mm;
      attempted = solved + mm;
    }
    const ts = (t > 0 && t !== 99999) ? ' ' + fmtDur(t) : '';
    return solved + '/' + attempted + ts;
  }
  return String(v);
}

/* ---------------- 维度表 ---------------- */
const persons = new Map();
const comps = new Map();
const champWC = new Set(), champCC = new Set();
const countryName = {};
const continentShort = {};
const events = new Map();
const worldRank = new Map();
const EVENT_BOARDS = {};           // event_id -> [{id, r, b, a, s, af}] 每项目世界排名榜（前 N）
const eventCounts = {};
const continents = {};
/* 国家-项目参赛规模：'eventId|ISO2' -> 该国在该项目上有成绩的人数（取 country_rank 最大值） */
const natEventSize = {};
/* 纪录演进序列：'eventId|single|avg|WR|CR|NR|ISO2' -> [YYYYMMDD, ...]（升序）
   用于计算每条纪录的「保持天数」：本条创立 → 下一条同口径纪录创立（或至今） */
const recSeq = {};
let recSeqCount = 0;
const REC_SEQ_MAX = 2500000;   /* 纪录序列条目上限（约 20MB 内存），超出后不再计算保持天数 */

async function loadDimensions() {
  log('加载 persons …');
  await streamTsv('persons', (r) => {
    const id = r.wca_id; if (!id) return;
    const sub = toInt(r.sub_id);
    const cur = persons.get(id);
    if (!cur || sub >= cur.sub_id) persons.set(id, { name: r.name, country_id: r.country_id, gender: r.gender, sub_id: sub });
  });
  log('persons:', persons.size);

  log('加载 competitions …');
  const pad2 = (n) => String(n).padStart(2, '0');
  await streamTsv('competitions', (r) => {
    if (!r.id) return;
    const y = toInt(r.year);
    const mo = toInt(r.month), d = toInt(r.day);
    const date = (y ? (y + '-' + pad2(mo || 1) + '-' + pad2(d || 1)) : '');
    comps.set(r.id, { name: r.name, country_id: r.country_id, year: y, date: date, city: r.cityName || '' });
  });
  log('competitions:', comps.size);

  log('加载 championships …');
  await streamTsv('championships', (r) => {
    if (!r.competition_id) return;
    const t = (r.championship_type || '').toLowerCase();
    if (t === 'world') champWC.add(r.competition_id);
    else champCC.add(r.competition_id);
  });
  log('championships WC/CC:', champWC.size, champCC.size);

  log('加载 countries / continents …');
  await streamTsv('continents', (r) => { if (r.id) continents[r.id] = Calc.CONTINENT_CODE[r.id] || null; });
  await streamTsv('countries', (r) => {
    if (!r.id) return;
    countryName[r.id] = r.name;
    continentShort[r.id] = continents[r.continent_id] || null;
  });
  log('countries:', Object.keys(countryName).length);

  log('加载 events …');
  await streamTsv('events', (r) => {
    if (!r.id) return;
    events.set(r.id, { name: (r.name || r.id), format: r.format, w: (Calc.EV[r.id] || { w: 0.8 }).w, rank: toInt(r.rank) });
  });
  log('events:', events.size);

  log('加载 ranks_single / ranks_average …');
  let rankRows = 0;
  /* 每选手每项目：{r: 世界排名, b: 官方最佳单次原始值, a: 官方最佳平均原始值}
     成绩直接取 ranks 表的 best 列（权威值），避免从 results 重新取 min——
     旧/新多盲编码跨格式数值不可比（新格式缺前导 1，数值恒小），只有 ranks 表
     的排序是 WCA 官方口径；展示时按前导位自动选择旧/新编码解码。 */
  const ingestRank = (r, isAvg) => {
    const pid = r.person_id, eid = r.event_id;
    if (!pid || !eid) return;
    rankRows++;
    const wr = toInt(r.world_rank);
    const best = toInt(r.best);
    /* 国家 / 大洲参赛规模：country_rank 的最大值 ≈ 该国在该项目上有过成绩的人数。
       用于按「刷新 NR 的难度」给 NR 记分加权（人数越少的国家，NR 越容易拿到）。 */
    if (!isAvg) {
      const ciso = Calc.isoNorm((persons.get(pid) || {}).country_id || '');
      if (ciso) {
        const ck = eid + '|' + ciso;
        const cr = toInt(r.country_rank);
        if (cr > (natEventSize[ck] || 0)) natEventSize[ck] = cr;
      }
    }
    let m = worldRank.get(pid); if (!m) { m = {}; worldRank.set(pid, m); }
    if (!(eid in m)) m[eid] = { r: 0, b: 0, a: 0 };
    if (isAvg) {
      /* 平均成绩：存最佳平均；世界排名仅在该选手无单次排名时兜底
         （单次名次是该项目 canonical 排名，ranks_single 先于 ranks_average 加载） */
      if (best > 0 && (m[eid].a === 0 || best < m[eid].a)) m[eid].a = best;
      if (m[eid].r === 0 && wr > 0) m[eid].r = wr;
    } else {
      if (wr > 0 && (m[eid].r === 0 || wr < m[eid].r)) m[eid].r = wr;
      if (best > 0 && (m[eid].b === 0 || best < m[eid].b)) m[eid].b = best;
    }
    eventCounts[eid] = (eventCounts[eid] || 0) + 1;
  };
  await streamTsv('ranks_single', (r) => ingestRank(r, false));
  await streamTsv('ranks_average', (r) => ingestRank(r, true));
  log('rank rows:', rankRows);
}

/* ---------------- results（大表） ---------------- */
const players = new Map();
const finalCounts = new Map();      // "comp|event" -> Set(person_id)
const wrSingleG = {};               // event -> [{date,name,country}]
const wrAvgG = {};                  // event -> [{date,name,country}]
const msGlobal = {};                // event -> {threshold: earliestYear}

function getPlayer(id) {
  let p = players.get(id);
  if (!p) {
    p = {
      wcaId: id, name: (persons.get(id) || { name: id }).name,
      country: (persons.get(id) || { country_id: '??' }).country_id,
      gender: (persons.get(id) || { gender: 'M' }).gender,
      eventsSet: new Set(), compsSet: new Set(),
      start: 9999, end: 0, wr: 0, cr: 0, nr: 0, nrW: 0,
      resultRows: 0, attempts: 0, solves: 0, dnf: 0,
      podiums: [], records: [], yearly: {},
      activeStreak: 1
    };
    players.set(id, p);
  }
  return p;
}

function trackMilestone(eid, best, year) {
  const bars = Calc.EV_BARRIERS[eid]; if (!bars) return;
  const fmt = (events.get(eid) || {}).format || 'time';
  const v = toInt(best); if (v <= 0) return;
  if (!msGlobal[eid]) msGlobal[eid] = {};
  const mp = msGlobal[eid];
  bars.forEach((b) => {
    if (mp[b[0]] != null) return;
    const thr = parseFloat(b[0]);
    let ok = false;
    if (fmt === 'time') ok = v < thr * 100;
    else if (fmt === 'number') ok = v <= thr;
    else if (fmt === 'multi') {
      const s = String(v).padStart(10, '0');
      /* 旧编码 1SSAATTTTT：解出 = 99-SS；新编码 0DDTTTTTMM：解出 = (99-DD)+MM */
      const solved = s[0] === '1' ? (99 - toInt(s.slice(1, 3))) : ((99 - toInt(s.slice(1, 3))) + toInt(s.slice(8, 10)));
      ok = solved >= thr;
    }
    if (ok) mp[b[0]] = year;
  });
}

/* NR 记分参考规模：该国该项目参赛人数达到该量级时 NR 记满分；人数越少，NR 越贬值。
   采用平方根律（(N/REF)^0.5），既避免小国 NR 完全归零，也显著压低「刷 NR」的收益。 */
const NR_REF = 20000;
const NR_FLOOR = 0.12;
function nrScaleOf(eid, ciso) {
  const n = natEventSize[eid + '|' + ciso] || 0;
  if (n <= 0) return NR_FLOOR;
  return Math.max(NR_FLOOR, Math.min(1, Math.sqrt(n / NR_REF)));
}
function recKey(eid, type, level, country) {
  return eid + '|' + type + '|' + level + '|' + (level === 'NR' ? Calc.isoNorm(country) : '');
}
function dateNum(d) {
  if (!d) return 0;
  const m = String(d).match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return 0;
  return toInt(m[1]) * 10000 + toInt(m[2]) * 100 + toInt(m[3]);
}
function numToDate(n) {
  const s = String(n);
  return s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8);
}
function daysBetween(a, b) {
  if (!a || !b) return 0;
  const A = new Date(numToDate(a) + 'T00:00:00Z'), B = new Date(numToDate(b) + 'T00:00:00Z');
  return Math.max(0, Math.round((B - A) / 86400000));
}

function addRecord(p, eid, type, level, value, comp, year) {
  if (level === 'WR') p.wr++; else if (level === 'CR') p.cr++; else p.nr++;
  /* NR 按「该国该项目参赛人数」加权：参赛人数越少的国家，拿到 NR 越容易，记分越低 */
  const ciso = Calc.isoNorm(p.country);
  const ns = level === 'NR' ? nrScaleOf(eid, ciso) : 1;
  p.nrW += ns;
  const ev = events.get(eid) || { w: 0.8 };
  const S = Math.max(0.6, Math.min(2.2, 2.2 - (year - 2003) * 0.04));
  const T = type === 'single' ? 0.62 : 0.85;
  const K = (eid === '333mbf' || eid === '333mbo') ? 1.41 : 1;
  const G = (level === 'WR' ? 1.0 : (level === 'CR' ? 0.45 : 0.18)) * ns;
  const A = Math.max(0.4, Math.min(3.2, 3.2 - (year - 2003) * 0.07));
  const O = 1.2;
  const R = Math.round(100 * ev.w * S * T * K * G * A * O * 10) / 10;
  const dn = dateNum(comp ? comp.date : (year + '-01-01')) || (year * 10000 + 101);
  const k = recKey(eid, type, level, p.country);
  /* 保护：纪录序列总量过大时停止收集（退回 held=0），避免 CI 内存溢出 */
  if (recSeqCount < REC_SEQ_MAX) {
    if (!recSeq[k]) recSeq[k] = [];
    recSeq[k].push(dn);
    recSeqCount++;
  }
  p.records.push({
    ev: eid, type: type, level: level,
    date: comp ? comp.date : (year + '-01-01'),
    value: fmtResult(eid, value, type),
    comp: comp ? comp.name : '', held: 0, current: false, dn: dn, k: k,
    factors: { we: Math.round(ev.w * 100) / 100, S: Math.round(S * 100) / 100, T: T, K: K, G: Math.round(G * 1000) / 1000, A: Math.round(A * 100) / 100, O: O, z: 0, NRS: Math.round(ns * 100) / 100, natN: natEventSize[eid + '|' + ciso] || 0 },
    R: R
  });
}

async function processResults() {
  log('处理 results（最大表，流式）…');
  let rows = 0;
  await streamTsv('results', (r) => {
    rows++;
    const pid = r.person_id; if (!pid) return;
    const eid = r.event_id; if (!eid) return;
    const compId = r.competition_id;
    const comp = comps.get(compId);
    const year = comp ? comp.year : 2003;
    const p = getPlayer(pid);
    p.eventsSet.add(eid);
    if (compId) p.compsSet.add(compId);
    if (year < p.start) p.start = year;
    if (year > p.end) p.end = year;
    p.resultRows++;
    for (let vi = 1; vi <= 5; vi++) {
      const vv = toInt(r['value' + vi]);
      if (vv === 0 || vv === -2) continue;   // 空 / DNS 不计入尝试
      p.attempts++;
      if (vv === -1) p.dnf++; else p.solves++;
    }

    const rtype = r.round_type_id;
    const isFinal = rtype === 'f' || rtype === 'c';
    const pos = toInt(r.pos);
    if (isFinal && pos >= 1 && pos <= 3) {
      const tier = champWC.has(compId) ? 'WC' : (champCC.has(compId) ? 'CC' : (comp && comp.country_id === p.country ? 'NC' : 'OP'));
      const key = compId + '|' + eid;
      let fs = finalCounts.get(key); if (!fs) { fs = new Set(); finalCounts.set(key, fs); }
      fs.add(pid);
      p.podiums.push({ ev: eid, tier: tier, place: pos, comp: comp ? comp.name : compId, compId: compId, year: year, field: 0, factors: null, R: 0 });
    }

    const rsr = r.regional_single_record, rar = r.regional_average_record;
    if (rsr === 'WR' || rsr === 'CR' || rsr === 'NR') addRecord(p, eid, 'single', rsr, r.best, comp, year);
    if (rar === 'WR' || rar === 'CR' || rar === 'NR') addRecord(p, eid, 'avg', rar, r.average, comp, year);

    if (rsr === 'WR') (wrSingleG[eid] = wrSingleG[eid] || []).push({ date: year, name: p.name, country: p.country });
    if (rar === 'WR') (wrAvgG[eid] = wrAvgG[eid] || []).push({ date: year, name: p.name, country: p.country });

    trackMilestone(eid, r.best, year);

    if (isFinal && pos >= 1 && pos <= 3) {
      const tier = champWC.has(compId) ? 'WC' : (champCC.has(compId) ? 'CC' : 'OP');
      const tw = tier === 'WC' ? 1 : (tier === 'CC' ? 0.7 : 0.4);
      const pw = pos === 1 ? 1 : (pos === 2 ? 0.6 : 0.4);
      p.yearly[year] = (p.yearly[year] || 0) + pw * tw * 2;
    }
    if (rsr === 'WR' || rsr === 'CR' || rsr === 'NR' || rar === 'WR' || rar === 'CR' || rar === 'NR') {
      p.yearly[year] = (p.yearly[year] || 0) + 1;
    }
  });
  log('results rows:', rows, 'players:', players.size);
}

/* ---------------- 模块计算 ---------------- */
function domScore(r) {
  if (r <= 1) return 1;
  if (r <= 3) return 0.85;
  if (r <= 10) return ((11 - r) / 10) * 0.7;
  if (r <= 50) return 0.15 * (1 - (r - 10) / 40);
  return 0;
}
function placeW(pos) { return pos === 1 ? 1 : (pos === 2 ? 0.6 : 0.4); }

function computeModules() {
  log('计算七模块评分…');
  const raw = {};
  const MAXMOD = { m1: 0, m2: 0, m3: 0, m4: 0, m5: 0, m6: 0, m7: 0 };
  const list = [];
  players.forEach((p, id) => {
    /* NR 按国家参赛规模加权后的等效数量（p.nr 仍为原始次数，用于展示） */
    const m1 = p.wr * 3 + p.cr * 1.5 + (p.nrW || 0) * 0.8;
    let m2 = 0, m3 = 0;
    p.podiums.forEach((pod) => {
      const tw = pod.tier === 'WC' ? 1 : (pod.tier === 'CC' ? 0.7 : 0.4);
      if (pod.tier === 'WC' || pod.tier === 'CC') m2 += placeW(pod.place) * tw;
      else m3 += placeW(pod.place) * tw;
    });
    let m4 = 0, m7sum = 0, m7n = 0;
    const wr = worldRank.get(id) || {};
    Object.keys(wr).forEach((eid) => {
      const rk = wr[eid];
      const w = (events.get(eid) || { w: 0.8 }).w;
      m4 += domScore(rk) * w;
      const cnt = eventCounts[eid] || 1;
      m7sum += (cnt - rk) / cnt; m7n++;
    });
    const m7 = m7n ? m7sum / m7n : 0;
    const evCount = p.eventsSet.size;
    const m5 = (evCount / 21) * 0.7 + Math.min(evCount / 17, 1) * 0.3;
    const span = Math.max(1, p.end - p.start + 1);
    const m6 = (span / 22) * 0.5 + (Math.min(p.compsSet.size, 300) / 300) * 0.3 + (p.activeStreak || 1) / 15 * 0.2;
    raw[id] = { m1, m2, m3, m4, m5, m6, m7 };
    ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7'].forEach((k) => { if (raw[id][k] > MAXMOD[k]) MAXMOD[k] = raw[id][k]; });
    list.push(p);
  });

  // 连续参赛年
  list.forEach((p) => {
    const ys = Object.keys(p.yearly).map(Number).sort((a, b) => a - b);
    let streak = 1, mx = 1;
    for (let i = 1; i < ys.length; i++) { if (ys[i] === ys[i - 1] + 1) { streak++; mx = Math.max(mx, streak); } else streak = 1; }
    p.activeStreak = mx;
  });

  const norm = (v, k) => MAXMOD[k] > 0 ? Math.max(0, Math.min(100, v / MAXMOD[k] * 100)) : 0;
  list.forEach((p) => {
    const r = raw[p.wcaId];
    const m = {}, pk = {};
    ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7'].forEach((k) => { m[k] = Math.round(norm(r[k], k) * 100) / 100; });
    const ys = Object.keys(p.yearly).map(Number).sort((a, b) => a - b);
    let total = 0; ys.forEach((y) => total += p.yearly[y]);
    const avgAnnual = ys.length ? total / ys.length : 0;
    let best3 = 0;
    for (let i = 0; i + 2 < ys.length; i++) {
      const s = (p.yearly[ys[i]] || 0) + (p.yearly[ys[i + 1]] || 0) + (p.yearly[ys[i + 2]] || 0);
      if (s > best3) best3 = s;
    }
    const conc = avgAnnual > 0 ? best3 / (3 * avgAnnual) : 1;
    const peakFactor = Math.max(0.85, Math.min(1.15, conc));
    ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7'].forEach((k) => { pk[k] = Math.round(Math.min(100, m[k] * peakFactor) * 100) / 100; });

    p.m = m; p.pk = pk;
    p.eloPeak = Math.round(1400 + m.m7 * 900);
    p.career = Math.round(Calc.weighted(m) * 10) / 10;
    p.peak = Math.round(Calc.weighted(pk) * 10) / 10;
    p.overall = Math.round(Calc.overall(p.career, p.peak) * 10) / 10;

    // 领奖台补 field / factors / R
    p.podiums.forEach((pod) => {
      const fs = finalCounts.get(pod.compId + '|' + pod.ev);
      pod.field = fs ? fs.size : 0;
      const ev = events.get(pod.ev) || { w: 0.8 };
      const Cw = pod.tier === 'WC' ? 1.6 : (pod.tier === 'CC' ? 1.4 : (pod.tier === 'NC' ? 1.25 : 1.0));
      const V = Math.pow(pod.place, -1.1);
      const CSI = Math.max(0.35, Math.min(3.0, Math.pow(Math.max(pod.field, 1) / 90, 0.5)));
      pod.factors = { we: Math.round(ev.w * 100) / 100, S: 1.0, Tpod: 1.0, V: Math.round(V * 1000) / 1000, C: Cw, CSI: Math.round(CSI * 100) / 100, z: 0, margin: 0 };
      pod.R = Math.round(100 * ev.w * 1.0 * 1.0 * V * Cw * CSI * 10) / 10;
    });
    p.recTotal = p.records.length;
    p.records.sort((a, b) => b.R - a.R);
    if (p.records.length > 12) p.records = p.records.slice(0, 12);
    p.podTotal = p.podiums.length;
    p.podiums.sort((a, b) => b.R - a.R);
    if (p.podiums.length > 10) p.podiums = p.podiums.slice(0, 10);

    const wr = worldRank.get(p.wcaId) || {};
    let bestEv = null, bestRk = 1e9;
    Object.keys(wr).forEach((eid) => { if (wr[eid].r < bestRk) { bestRk = wr[eid].r; bestEv = eid; } });
    if (!bestEv) { let bestN = -1; p.eventsSet.forEach((eid) => { if ((eventCounts[eid] || 0) > bestN) { bestN = eventCounts[eid]; bestEv = eid; } }); if (!bestEv) bestEv = '333'; }
    p.mainEvent = bestEv;

    p.wcGold = p.podiums.filter((x) => x.place === 1 && x.tier === 'WC').length;
    p.ccGold = p.podiums.filter((x) => x.place === 1 && x.tier === 'CC').length;
    p.ncGold = p.podiums.filter((x) => x.place === 1 && x.tier === 'NC').length;
    p.months1 = 0; p.months10 = 0; p.months100 = 0; p.peakSpan = 0; p.peakAge = 0;

    p.events = Array.from(p.eventsSet).sort((a, b) => ((events.get(a) || { rank: 99 }).rank) - ((events.get(b) || { rank: 99 }).rank));
    p.comps = p.compsSet.size;
    /* 参赛城市数：由该选手参加过的赛事去重城市名得到（真实值，不再是估算） */
    const citySet = new Set();
    p.compsSet.forEach((cid) => { const c = comps.get(cid); if (c && c.city) citySet.add(c.city + '|' + (c.country_id || '')); });
    p.cities = citySet.size;
    p.start = p.start === 9999 ? 2003 : p.start;
    if (p.end === 0) p.end = p.start;
    p.hue = Calc.U.hue(p.name);
    p.id = p.wcaId;
    p.nameZh = null;
  });

  /* ---------------- 每项目榜单（按该项目世界排名取前 N） ----------------
     供前端"筛选单个项目后按该项目成绩单独排名"使用；
     成绩取 ranks_single/ranks_average 的官方 best 列（WCA 权威口径，
     旧/新多盲编码由此自动正确解码）；未入榜者在该项目上必然弱于入榜者，
     前端追加在榜尾即可保证整体次序正确。 */
  const EVENT_BOARD_MAX = 2000;
  list.forEach((p) => {
    const wr = worldRank.get(p.wcaId) || {};
    Object.keys(wr).forEach((eid) => {
      if (!Calc.EV[eid]) return;
      const o = wr[eid];
      if (o.r > EVENT_BOARD_MAX || o.r <= 0) return;
      const arr = EVENT_BOARDS[eid] || (EVENT_BOARDS[eid] = []);
      arr.push({
        id: p.wcaId, r: o.r, b: o.b || 0, a: o.a || 0,
        s: o.b > 0 ? fmtResult(eid, o.b, 'single') : '',
        af: o.a > 0 ? fmtResult(eid, o.a, 'avg') : ''
      });
    });
  });
  Object.keys(EVENT_BOARDS).forEach((eid) => {
    EVENT_BOARDS[eid].sort((x, y) => x.r - y.r);
    if (EVENT_BOARDS[eid].length > EVENT_BOARD_MAX) EVENT_BOARDS[eid] = EVENT_BOARDS[eid].slice(0, EVENT_BOARD_MAX);
  });
  log('每项目榜单:', Object.keys(EVENT_BOARDS).length, '个项目, 最大深度', EVENT_BOARD_MAX);

  /* 释放中间结构：榜单已独立持有所需数据，worldRank/finalCounts 不再需要 */
  worldRank.clear(); finalCounts.clear();

  return list;
}

/* ---------------- 二次扫描：真实「单场最多项目数 / 多项目参赛场次」 ----------------
   第一遍无法在有限内存内为每个选手保存 (赛事 → 项目数) 明细，
   因此只对最终要输出的选手做一次定向扫描，得到真实值（不再用估算值）。 */
async function enrichCompStats(ids) {
  if (!ids || !ids.size) return;
  log('二次扫描 results（仅输出选手）…');
  const cnt = new Map();          // pid -> Map(compId -> 项目数)
  await streamTsv('results', (r) => {
    const pid = r.person_id; if (!pid || !ids.has(pid)) return;
    const cid = r.competition_id; if (!cid) return;
    let m = cnt.get(pid); if (!m) { m = new Map(); cnt.set(pid, m); }
    m.set(cid, (m.get(cid) || 0) + 1);
  });
  cnt.forEach((m, pid) => {
    const p = players.get(pid); if (!p) return;
    let mx = 0, multi = 0;
    m.forEach((n) => { if (n > mx) mx = n; if (n >= 5) multi++; });
    p.maxEventsPerComp = mx;
    p.multiEventComp = multi;
  });
  log('二次扫描完成:', cnt.size, '人');
}

/* ---------------- 纪录保持天数 ----------------
   recSeq 已按 (项目|单/均|层级|国家) 收集了全部纪录的创立日期；
   某条纪录的保持天数 = 创立日 → 同口径下一条纪录的创立日（没有则到数据导出日）。 */
function computeHeld(list, asOf) {
  const today = dateNum(asOf) || dateNum(new Date().toISOString().slice(0, 10));
  Object.keys(recSeq).forEach((k) => {
    const a = recSeq[k];
    a.sort((x, y) => x - y);
    for (let i = a.length - 1; i > 0; i--) if (a[i] === a[i - 1]) a.splice(i, 1);
  });
  let n = 0;
  list.forEach((p) => {
    p.records.forEach((rec) => {
      const a = recSeq[rec.k];
      if (!a || !a.length) { rec.held = 0; rec.current = false; return; }
      let lo = 0, hi = a.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (a[mid] <= rec.dn) lo = mid + 1; else hi = mid; }
      const next = a[lo];
      rec.held = daysBetween(rec.dn, next || today);
      rec.current = !next;
      n++;
    });
  });
  log('纪录保持天数已计算:', n, '条');
}

/* ---------------- WR 泳道 ---------------- */
function buildLanes(store) {
  return Object.keys(store).sort().map((eid) => {
    const arr = store[eid].slice().sort((a, b) => a.date - b.date);
    const segs = [];
    let cur = null;
    arr.forEach((e) => {
      if (!cur || cur.holder !== e.name) {
        if (cur) cur.to = e.date;
        cur = { from: e.date, to: 2026, holder: e.name, country: e.country, id: null, days: 0, color: 'hsl(' + Calc.U.hue(e.name) + ',58%,52%)' };
        segs.push(cur);
      }
    });
    if (cur) cur.to = 2026;
    return { ev: eid, zh: (Calc.EV[eid] || { zh: eid }).zh, en: (Calc.EV[eid] || { en: eid }).en, segs: segs };
  });
}

/* ---------------- 单项目里程碑（真实首次突破） ---------------- */
function buildEventMilestones() {
  const map = {};
  Object.keys(msGlobal).forEach((eid) => {
    const bars = Calc.EV_BARRIERS[eid]; if (!bars) return;
    const e = Calc.EV[eid]; if (!e) return;
    const arr = bars.filter((b) => msGlobal[eid][b[0]] != null).map((b) => {
      const y = msGlobal[eid][b[0]];
      let zh, en;
      if (eid === '333fm') { zh = e.zh + ' 最少步单次首次 ≤' + b[0] + ' 步'; en = e.en + ' FMC single first ≤' + b[0] + ' moves'; }
      else if (eid === '333mbf') { zh = e.zh + ' 多盲单次首次 ≥' + b[0] + ' 个'; en = e.en + ' MBLD single first ≥' + b[0]; }
      else { zh = e.zh + ' 单次首次 sub ' + b[0] + ' 秒'; en = e.en + ' single first sub-' + b[0]; }
      return { year: y, zh: zh, en: en };
    });
    if (arr.length) map[eid] = arr;
  });
  return map;
}

/* ---------------- 主流程 ---------------- */
(async function main() {
  const t0 = Date.now();
  await loadDimensions();
  await processResults();
  const list = computeModules();
  list.sort((a, b) => b.overall - a.overall);

  log('排序 …');
  /* 分层输出：DETAIL_MAX 名以内保留纪录 / 领奖台明细，
     SLIM_MAX 名以内保留可排名可筛选的精简档案（无明细），
     其余选手不随包下发（数据量所限），但排序 / 聚合仍按全量计算。 */
  const detail = DETAIL_MAX > 0 ? list.slice(0, DETAIL_MAX) : list;
  const slim = SLIM_MAX > DETAIL_MAX ? list.slice(DETAIL_MAX, SLIM_MAX) : [];
  const emit = detail.concat(slim);
  const emitIds = new Set();
  emit.forEach((p) => emitIds.add(p.wcaId));
  KEEP_YEARLY_N = Math.min(emit.length, KEEP_YEARLY);
  emit.forEach((p, i) => { if (i >= KEEP_YEARLY_N) p.yearly = {}; });
  list.forEach((p) => { if (!emitIds.has(p.wcaId)) p.yearly = {}; });

  /* 定向二次扫描：仅对输出选手求真实「单场最多项目数 / 多项目参赛场次」 */
  await enrichCompStats(emitIds);

  /* 纪录保持天数（真实：创立 → 被刷新，或至今） */
  computeHeld(detail, arg('--date', '') || new Date().toISOString().slice(0, 10));

  const NATIONS_RAW = {};
  list.forEach((p) => {
    if (!NATIONS_RAW[p.country]) NATIONS_RAW[p.country] = { iso: p.country, total: 0, count: 0, best: 0, bestName: '' };
    const n = NATIONS_RAW[p.country]; n.total += p.overall; n.count++;
    if (p.overall > n.best) { n.best = p.overall; n.bestName = p.name; }
  });

  let totWR = 0, totRec = 0, totPod = 0;
  list.forEach((p) => { totWR += p.wr; totRec += p.records.length; totPod += p.podiums.length; });
  const meta = {
    demo: false,
    updated: (arg('--date', '') || new Date().toISOString().slice(0, 10)),
    exportVersion: arg('--ver', 'v2.0.2'),
    players: list.length, events: events.size, comps: comps.size,
    wr: totWR, records: totRec, podiums: totPod, nations: Object.keys(NATIONS_RAW).length,
    emitted: emit.length, detailMax: DETAIL_MAX, slimMax: SLIM_MAX
  };

  const base = (p) => ({
    id: p.id, wcaId: p.wcaId, name: p.name, nameZh: p.nameZh, country: p.country, gender: p.gender,
    start: p.start, end: p.end, comps: p.comps, mainEvent: p.mainEvent, events: p.events, hue: p.hue,
    m: p.m, pk: p.pk, career: p.career, peak: p.peak, overall: p.overall,
    balance: Math.round(Math.log(Math.max(p.career, 0.01) / Math.max(p.peak, 0.01)) * 1000) / 1000,
    wr: p.wr, cr: p.cr, nr: p.nr, nrW: Math.round((p.nrW || 0) * 100) / 100,
    recTotal: p.recTotal || 0, podTotal: p.podTotal || 0,
    wcGold: p.wcGold, ccGold: p.ccGold, ncGold: p.ncGold,
    months1: 0, months10: 0, months100: 0, eloPeak: p.eloPeak, peakSpan: 0, peakAge: 0,
    resultRows: p.resultRows || 0, attempts: p.attempts || 0, solves: p.solves || 0, dnf: p.dnf || 0,
    cities: p.cities || 0, maxEventsPerComp: p.maxEventsPerComp || 0, multiEventComp: p.multiEventComp || 0,
    yearly: p.yearly
  });
  const emitPlayers = detail.map((p) => Object.assign(base(p), { records: p.records, podiums: p.podiums }))
    .concat(slim.map((p) => {
      const o = base(p);
      /* 精简档案：去掉恒 0 / null / 空的字段，显著降低体积（28k 名选手） */
      ['nameZh', 'months1', 'months10', 'months100', 'peakSpan', 'peakAge', 'balance', 'yearly'].forEach((k) => { delete o[k]; });
      o.records = []; o.podiums = []; o.slim = 1;
      return o;
    }));

  const CFG = {
    countries: countryName, continentOf: continentShort, meta: meta,
    years: (function () { const a = []; for (let y = 2003; y <= new Date().getFullYear(); y++) a.push(y); return a; })(),
    milestones: Calc.MILESTONES, eventMilestonesMap: buildEventMilestones(),
    lanes: buildLanes(wrSingleG), lanesAvg: buildLanes(wrAvgG),
    eventBoards: EVENT_BOARDS
  };

  const header = '/* AUTO-GENERATED by etl/build.js — 真实 WCA 数据。请勿手动编辑。 */\n' +
    '(function () {\n  var PLAYERS = ' + JSON.stringify(emitPlayers) + ';\n' +
    '  var CFG = ' + JSON.stringify(CFG) + ';\n' +
    '  var CalcRef = (typeof Calc !== "undefined") ? Calc : (typeof require !== "undefined" ? require("../js/calc.js") : null);\n' +
    '  window.MOCK = CalcRef.assemble(PLAYERS, CFG);\n})();\n';
  fs.writeFileSync(OUT, header, 'utf8');
  log('写出', OUT, '| 玩家', emitPlayers.length, '| 总耗时', ((Date.now() - t0) / 1000).toFixed(1) + 's');
})().catch((e) => { console.error('[etl] ERROR', e); process.exit(1); });

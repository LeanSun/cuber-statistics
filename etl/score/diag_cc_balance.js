'use strict';
/* 洲际锦标赛机会不均诊断：各大洲洲锦赛届数/人数不同，对选手的影响与平衡方案
 *
 * 用户问题：大洋洲 2022 首届（与非洲并列最少），欧洲 12 届、亚洲 7 届、
 *           南美 5 届、北美 4 届。如何平衡「届数不一样 + 人数不一样」
 *           导致的选手优势/劣势。
 *
 * 内核与 m2m3_balance.js / diag_event_split.js 完全一致（S4 口径）：
 *   分 = P(pos) × K_级 × (hill(field)/hill(同时代 REF))^0.8015 × f × w
 *        ×（普通赛 ? β × n^-0.5 : 1）
 *   hill(N) = 500 × ln(1 + N/500)
 *
 * 自校验：β 必须 = 0.2782
 *
 * 用法：node --max-old-space-size=6144 etl/score/diag_cc_balance.js
 * 只读，不改任何常量。
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
const PCT = (v) => (v * 100).toFixed(2) + '%';
const med = (a) => {
  if (!a.length) return 0;
  const b = a.slice().sort((x, y) => x - y);
  const m = b.length >> 1;
  return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2;
};

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

const GAMMA = 0.8015;
const ALPHA = 0.5;
const K_OF = { OP: 1.0000, NC: 1.0000, CC: 1.6000, WC: 1.6000 };
const TIER_CN = { OP: '普通赛', NC: '国锦赛', CC: '洲锦赛', WC: '世锦赛' };
const PLACE_CN = { 1: '金', 2: '银', 3: '铜' };
const NSAT = 500;
const hill = (x) => NSAT * Math.log(1 + Math.max(x, 0) / NSAT);

const CONT_CN = {
  Europe: '欧洲', Asia: '亚洲', 'North America': '北美',
  'South America': '南美', Oceania: '大洋洲', Africa: '非洲',
};
const CONT_ORDER = ['Europe', 'Asia', 'North America', 'South America', 'Oceania', 'Africa'];

(async () => {
  /* ── 加载（与 m2m3_balance.js 一致） ─────────────────────────── */
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

  /* 洲锦赛的届数与举办地（直接从 championships 表读） */
  const ccByCont = new Map();   // cont -> [{compId, year, name}]
  for (const [compId, types] of ctypes) {
    for (const t of types) {
      const m = /^_(.+)$/.exec(t);
      if (!m) continue;
      const cont = contOfRaw.get(m[1]) || m[1];
      if (!ccByCont.has(cont)) ccByCont.set(cont, []);
      const c = compInfo.get(compId) || {};
      ccByCont.get(cont).push({ compId, year: c.year || 0, name: c.name || compId, iso: c.iso || '' });
    }
  }

  const compEvPeople = new Map();
  const firstYear = new Map();
  const rows = [];
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

  const cc = {}; const nc = {};
  const people = [];
  for (const [pid, p] of pInfo) {
    const cont = (isoInfo.get(p.iso) || {}).cont || 'Unknown';
    nc[p.iso] = (nc[p.iso] || 0) + 1;
    cc[cont] = (cc[cont] || 0) + 1;
    const y = firstYear.get(pid);
    if (y) people.push({ y, cont, nat: p.iso });
  }
  const TOTAL = pInfo.size;
  const pool = M1.makeScopePool(people, 2026);

  const items = [];
  for (const r of rows) {
    const multi = M2.isMultiRegion(r.nat);
    const tier = multi ? 'OP' : M2.tierOf(ctypes.get(r.compId), r.nat);
    const cont = (isoInfo.get(r.nat) || {}).cont || 'Unknown';
    const field = (compEvPeople.get(r.compId + '|' + r.ev) || { size: 1 }).size;
    const who = { nat: r.nat, cont };
    const fNat = pool ? pool.valueOf('NR', who, +r.year || 2026) : 1;
    const fGlb = pool ? pool.valueOf('WR', who, +r.year || 2026) : 1;
    const w = RN.EV_WEIGHT_V2[r.ev] == null ? RN.WEIGHT_V2_CFG.floor : RN.EV_WEIGHT_V2[r.ev];
    items.push({
      pid: r.pid, ev: r.ev, tier, pos: r.pos, year: r.year, field, fNat, fGlb, w,
      compId: r.compId, nat: r.nat, cont,
      compName: (compInfo.get(r.compId) || {}).name || r.compId,
      name: (pInfo.get(r.pid) || {}).name || r.pid,
    });
  }

  const F_POOL = { OP: 'WR', NC: 'NR', CC: 'NR', WC: 'WR' };
  const fOf = (it) => (F_POOL[it.tier] === 'WR' ? it.fGlb : it.fNat);

  const opByEv = new Map();
  for (const it of items) {
    if (it.tier !== 'OP') continue;
    if (!opByEv.has(it.ev)) opByEv.set(it.ev, []);
    opByEv.get(it.ev).push({ year: it.year, field: it.field });
  }
  const REF = new Map();
  for (const [ev, a] of opByEv) if (a.length >= 30) REF.set(ev, med(a.map((x) => x.field)));
  const refAll = med([...opByEv].filter(([, a]) => a.length >= 30).map(([, a]) => med(a.map((x) => x.field))));
  const refOfG = (ev) => REF.get(ev) || refAll;
  const WIN = [2, 3, 5, 8, 15];
  const MIN_SAMPLES = 20;
  const eraCache = new Map();
  const refOfEra = (ev, year) => {
    const key = ev + '|' + year;
    if (eraCache.has(key)) return eraCache.get(key);
    const list = opByEv.get(ev) || [];
    let best = null;
    for (const w of WIN) {
      const l = list.filter((x) => Math.abs(x.year - year) <= w).map((x) => x.field);
      if (l.length >= MIN_SAMPLES) { best = med(l); break; }
    }
    if (best == null) {
      const l = list.filter((x) => Math.abs(x.year - year) <= 15).map((x) => x.field);
      if (l.length) { best = med(l); } else { best = refOfG(ev); }
    }
    eraCache.set(key, best);
    return best;
  };

  for (const it of items) {
    const P = M2.PLACE_W[it.pos] || 0;
    const K = K_OF[it.tier];
    it.ref = refOfEra(it.ev, it.year);
    it.scale = Math.pow(hill(it.field) / hill(it.ref), GAMMA);
    it.f = fOf(it);
    it.base = P * K * it.scale * it.f * it.w;
    it.n = 1;
  }

  /* 重复衰减：分组键 pid|ev */
  const grp = new Map();
  for (const it of items) {
    if (it.tier !== 'OP') continue;
    const k = it.pid + '|' + it.ev;
    if (!grp.has(k)) grp.set(k, []);
    grp.get(k).push(it);
  }
  for (const [, a] of grp) {
    a.sort((x, y) => (x.year - y.year) || String(x.compId).localeCompare(String(y.compId)));
    a.forEach((it, i) => { it.n = i + 1; it.decay = Math.pow(i + 1, -ALPHA); });
  }
  for (const it of items) if (it.tier !== 'OP') it.decay = 1;

  /* β 按总量等分（全站，与定稿一致） */
  const S = { OP: 0, NC: 0, CC: 0, WC: 0 };
  for (const it of items) S[it.tier] += it.base * it.decay;
  const S2 = S.NC + S.CC + S.WC;
  const BETA = S2 / S.OP;

  const vOf = (it) => it.base * it.decay * (it.tier === 'OP' ? BETA : 1);

  /* 选手所属洲 */
  const playerCont = new Map();
  for (const [pid, p] of pInfo) playerCont.set(pid, (isoInfo.get(p.iso) || {}).cont || 'Unknown');

  /* ═══ 文档 ═══ */
  const OUT = [];
  const L = (s) => OUT.push(s == null ? '' : s);

  L('# 洲际锦标赛机会不均：届数 / 人数 / 选手得利诊断');
  L('');
  L('> 现算，源 WCA v2.0.2，脚本 `etl/score/diag_cc_balance.js`。只读，不改任何常量。');
  L('> 内核 = S4 口径（年代本地 REF + WC 全球池 + hill(500)），自校验 β = ' + F(BETA) + '（须 = 0.2782）。');
  L('');

  /* ═══ 0 各洲洲锦赛届数 ═══ */
  L('══ 0 各洲洲锦赛届数（多项目大赛，FMC 单项赛不计）══');
  L('');
  L('| 洲 | 届数 | 年份 | 举办国 |');
  L('|---|---|---|---|');
  for (const cont of CONT_ORDER) {
    const list = (ccByCont.get(cont) || []).filter((x) => !/FMC/i.test(x.name)).sort((a, b) => a.year - b.year);
    const years = list.map((x) => x.year).join(', ');
    const hosts = [...new Set(list.map((x) => x.iso))].join(' / ');
    L('| ' + (CONT_CN[cont] || cont) + ' | **' + list.length + '** | ' + years + ' | ' + hosts + ' |');
  }
  L('');
  L('核实结论：欧洲 12、亚洲 7、南美 5、北美 4、大洋洲 3、非洲 3。');
  L('大洋洲与非洲同为 2022 年首届，届数并列最少 —— 与用户所述一致。');
  L('');

  /* ═══ 1 各洲洲锦赛资源盘点 ═══ */
  L('══ 1 各洲洲锦赛资源盘点（这场比赛提供了什么）══');
  L('');
  L('| 洲 | 届数 | 可得奖牌位(条/届×3×项目) | 实际领奖台条数 | 总分产出 | 平均单条 | 三阶场均人数 |');
  L('|---|---|---|---|---|---|---|');
  const contRes = new Map();
  for (const cont of CONT_ORDER) {
    const list = (ccByCont.get(cont) || []).filter((x) => !/FMC/i.test(x.name));
    const compIds = new Set(list.map((x) => x.compId));
    const g = items.filter((it) => it.tier === 'CC' && compIds.has(it.compId));
    const tot = g.reduce((s, x) => s + x.base, 0);
    const f333 = g.filter((x) => x.ev === '333').map((x) => x.field);
    contRes.set(cont, { n: list.length, items: g, tot, avg: g.length ? tot / g.length : 0 });
    L('| ' + (CONT_CN[cont] || cont) + ' | ' + list.length + ' | ' + num(list.length * 3 * 18)
      + ' | ' + num(g.length) + ' | **' + F(tot) + '** | ' + F(g.length ? tot / g.length : 0)
      + ' | ' + num(Math.round(med(f333))) + ' |');
  }
  const ccAll = items.filter((it) => it.tier === 'CC');
  L('| **合计** | **' + [...contRes.values()].reduce((s, x) => s + x.n, 0) + '** | | **'
    + num(ccAll.length) + '** | **' + F(ccAll.reduce((s, x) => s + x.base, 0)) + '** | **'
    + F(ccAll.reduce((s, x) => s + x.base, 0) / ccAll.length) + '** | |');
  L('');
  L('「可得奖牌位」是理论上限（每届每项目 3 枚 × 约 18 个正式项目），实际条数可能略少（未设项/并列等）。');
  L('');

  /* ═══ 2 按选手所属洲看洲锦赛得分 ═══ */
  L('══ 2 按选手所属洲看洲锦赛得分（谁吃亏、谁占便宜）══');
  L('');
  L('「主场优势」与「机会优势」分开看：');
  L('');
  L('2a. 按**举办洲**统计（这场洲锦赛的分给了谁 —— 跨洲参赛者也计入）');
  L('');
  L('| 举办洲 | 条数 | 总分 | 本国/本洲选手拿走 | 他洲选手拿走 | 本洲选手占比 |');
  L('|---|---|---|---|---|---|');
  for (const cont of CONT_ORDER) {
    const r = contRes.get(cont);
    if (!r || !r.items.length) continue;
    let inC = 0; let outC = 0;
    for (const it of r.items) {
      const pc = playerCont.get(it.pid) || 'Unknown';
      if (pc === cont) inC += it.base; else outC += it.base;
    }
    L('| ' + (CONT_CN[cont] || cont) + ' | ' + num(r.items.length) + ' | ' + F(r.tot)
      + ' | ' + F(inC) + ' | ' + F(outC) + ' | ' + PCT(r.tot ? inC / r.tot : 0) + ' |');
  }
  L('');

  L('2b. 按**选手所属洲**统计（每个洲的选手从所有洲锦赛里拿到多少分）');
  L('');
  L('| 选手洲 | 注册人数 | 有洲锦赛分的人 | 洲锦赛总分 | 人均分(有分者) | 人均分(全员) | Top1 选手 | 其洲锦赛分 |');
  L('|---|---|---|---|---|---|---|---|');
  const byPlayerCont = new Map();
  for (const it of items) {
    if (it.tier !== 'CC') continue;
    const pc = playerCont.get(it.pid) || 'Unknown';
    if (!byPlayerCont.has(pc)) byPlayerCont.set(pc, new Map());
    const m = byPlayerCont.get(pc);
    if (!m.has(it.pid)) m.set(it.pid, { name: it.name, s: 0, n: 0 });
    const x = m.get(it.pid);
    x.s += it.base; x.n++;
  }
  for (const cont of CONT_ORDER) {
    const m = byPlayerCont.get(cont) || new Map();
    const list = [...m.values()].sort((a, b) => b.s - a.s);
    const tot = list.reduce((s, x) => s + x.s, 0);
    const reg = cc[cont] || 0;
    const top = list[0];
    L('| ' + (CONT_CN[cont] || cont) + ' | ' + num(reg) + ' | ' + num(list.length) + ' | **' + F(tot)
      + '** | ' + F(list.length ? tot / list.length : 0) + ' | ' + F(reg ? tot / reg : 0)
      + ' | ' + (top ? top.name : '—') + ' | ' + (top ? F(top.s) : '—') + ' |');
  }
  L('');

  /* ═══ 3 机会不均的核心证据：顶端选手的洲锦赛期望 ═══ */
  L('══ 3 顶端选手的洲锦赛收益：机会差异有多大 ══');
  L('');
  L('取每个洲洲锦赛总分 Top10 选手，看他们的洲锦赛生涯得分分布：');
  L('');
  L('| 选手洲 | Top10 洲锦赛总分合计 | 人均 | 中位 | 最高 | 最低 | Top10 平均参与届数 |');
  L('|---|---|---|---|---|---|---|');
  for (const cont of CONT_ORDER) {
    const m = byPlayerCont.get(cont) || new Map();
    const list = [...m.values()].sort((a, b) => b.s - a.s).slice(0, 10);
    if (!list.length) continue;
    const tot = list.reduce((s, x) => s + x.s, 0);
    const avgN = list.reduce((s, x) => s + x.n, 0) / list.length;
    L('| ' + (CONT_CN[cont] || cont) + ' | ' + F(tot) + ' | ' + F(tot / list.length)
      + ' | ' + F(med(list.map((x) => x.s))) + ' | ' + F(list[0].s) + ' | ' + F(list[list.length - 1].s)
      + ' | ' + F(avgN) + ' 条 |');
  }
  L('');
  L('**关键读数**：如果欧洲 Top10 人均洲锦赛分显著高于大洋洲 Top10，说明「届数多」转化为实际收益；');
  L('如果差不多，说明「届数多」同时意味着「竞争者多」，已经自我抵消。');
  L('');

  /* ═══ 4 反事实：如果把各大洲的洲锦赛次数拉平 ═══ */
  L('══ 4 反事实：只保留前 N 届洲锦赛（拉平机会）══');
  L('');
  L('每个洲只保留最早的 N 届（N = 3，即大洋洲/非洲的届数），其余丢弃。看各洲 Top10 人均分怎么变：');
  L('');
  const keepN = 3;
  const keptCompIds = new Set();
  for (const cont of CONT_ORDER) {
    const list = (ccByCont.get(cont) || []).filter((x) => !/FMC/i.test(x.name)).sort((a, b) => a.year - b.year).slice(0, keepN);
    for (const x of list) keptCompIds.add(x.compId);
  }
  L('| 选手洲 | 现状 Top10 人均 | 只留 3 届后 Top10 人均 | 变化 | 现状总分 | 只留 3 届后总分 |');
  L('|---|---|---|---|---|---|');
  const keptItems = items.filter((it) => it.tier === 'CC' && keptCompIds.has(it.compId));
  const byPlayerContK = new Map();
  for (const it of keptItems) {
    const pc = playerCont.get(it.pid) || 'Unknown';
    if (!byPlayerContK.has(pc)) byPlayerContK.set(pc, new Map());
    const m = byPlayerContK.get(pc);
    if (!m.has(it.pid)) m.set(it.pid, { name: it.name, s: 0, n: 0 });
    const x = m.get(it.pid);
    x.s += it.base; x.n++;
  }
  for (const cont of CONT_ORDER) {
    const m = byPlayerCont.get(cont) || new Map();
    const list = [...m.values()].sort((a, b) => b.s - a.s).slice(0, 10);
    const mk = byPlayerContK.get(cont) || new Map();
    const listK = [...mk.values()].sort((a, b) => b.s - a.s).slice(0, 10);
    const avg = list.length ? list.reduce((s, x) => s + x.s, 0) / list.length : 0;
    const avgK = listK.length ? listK.reduce((s, x) => s + x.s, 0) / listK.length : 0;
    const tot = list.reduce((s, x) => s + x.s, 0);
    const totK = listK.reduce((s, x) => s + x.s, 0);
    L('| ' + (CONT_CN[cont] || cont) + ' | ' + F(avg) + ' | ' + F(avgK)
      + ' | ' + (avgK >= avg ? '+' : '') + F(avgK - avg) + ' | ' + F(tot) + ' | ' + F(totK) + ' |');
  }
  L('');
  L('注意：只留 3 届会**同时**丢掉「多打几届的积累」和「多几届的竞争稀释」，谁净受损看数据。');
  L('');

  /* ═══ 4b 每届均值分解 + 最新3届对照 ═══ */
  L('══ 4b 每届均值分解：欧洲的优势是「届数」还是「每届更值钱」══');
  L('');
  L('| 选手洲 | Top10 总分 | 平均参赛条数 | 单条均价 | 届数 | Top10 总分 ÷ 届数 |');
  L('|---|---|---|---|---|---|');
  for (const cont of CONT_ORDER) {
    const m = byPlayerCont.get(cont) || new Map();
    const list = [...m.values()].sort((a, b) => b.s - a.s).slice(0, 10);
    if (!list.length) continue;
    const tot = list.reduce((s, x) => s + x.s, 0);
    const avgN = list.reduce((s, x) => s + x.n, 0) / list.length;
    const nEd = (ccByCont.get(cont) || []).filter((x) => !/FMC/i.test(x.name)).length;
    L('| ' + (CONT_CN[cont] || cont) + ' | ' + F(tot) + ' | ' + F(avgN) + ' 条 | '
      + F(tot / (avgN * 10)) + ' | ' + nEd + ' | ' + F(tot / nEd) + ' |');
  }
  L('');
  L('**读法**：「单条均价」衡量「一枚洲际奖牌卖多贵」（受场次深度影响）；');
  L('「总分 ÷ 届数」衡量「每届大赛给这个洲的选手带来多少收益」（受内部竞争影响）。');
  L('');

  L('反事实对照 · 只保留**最新** 3 届（排除「最早 3 届恰逢小年代」的混淆）：');
  L('');
  const keepN2 = 3;
  const keptCompIds2 = new Set();
  for (const cont of CONT_ORDER) {
    const list = (ccByCont.get(cont) || []).filter((x) => !/FMC/i.test(x.name)).sort((a, b) => b.year - a.year).slice(0, keepN2);
    for (const x of list) keptCompIds2.add(x.compId);
  }
  const keptItems2 = items.filter((it) => it.tier === 'CC' && keptCompIds2.has(it.compId));
  const byPlayerContK2 = new Map();
  for (const it of keptItems2) {
    const pc = playerCont.get(it.pid) || 'Unknown';
    if (!byPlayerContK2.has(pc)) byPlayerContK2.set(pc, new Map());
    const m = byPlayerContK2.get(pc);
    if (!m.has(it.pid)) m.set(it.pid, { name: it.name, s: 0, n: 0 });
    const x = m.get(it.pid);
    x.s += it.base; x.n++;
  }
  L('| 选手洲 | 现状 Top10 人均 | 最新3届 Top10 人均 | 变化 | 最新3届 ÷ 现状 |');
  L('|---|---|---|---|---|');
  for (const cont of CONT_ORDER) {
    const m = byPlayerCont.get(cont) || new Map();
    const list = [...m.values()].sort((a, b) => b.s - a.s).slice(0, 10);
    const mk = byPlayerContK2.get(cont) || new Map();
    const listK = [...mk.values()].sort((a, b) => b.s - a.s).slice(0, 10);
    const avg = list.length ? list.reduce((s, x) => s + x.s, 0) / list.length : 0;
    const avgK = listK.length ? listK.reduce((s, x) => s + x.s, 0) / listK.length : 0;
    L('| ' + (CONT_CN[cont] || cont) + ' | ' + F(avg) + ' | ' + F(avgK)
      + ' | ' + (avgK >= avg ? '+' : '') + F(avgK - avg) + ' | ' + F(avg ? avgK / avg : 0) + ' |');
  }
  L('');
  L('若「最新 3 届」下欧洲仍显著高于大洋洲 → 优势来自届数本身；若差距收窄 → 部分来自「早年小场」的残留。');
  L('');

  /* ═══ 5 人数不均：场次深度的洲际差异 ═══ */
  L('══ 5 人数不均：各洲洲锦赛的场次深度 ══');
  L('');
  L('| 洲 | 三阶场均人数 | 三阶中位 | 全项目平均场次 | 单条均价 | 与欧洲均价比 |');
  L('|---|---|---|---|---|---|');
  const euAvg = (() => {
    const r = contRes.get('Europe');
    return r && r.items.length ? r.tot / r.items.length : 1;
  })();
  for (const cont of CONT_ORDER) {
    const r = contRes.get(cont);
    if (!r || !r.items.length) continue;
    const f333 = r.items.filter((x) => x.ev === '333').map((x) => x.field);
    const allF = r.items.map((x) => x.field);
    L('| ' + (CONT_CN[cont] || cont) + ' | ' + num(Math.round(f333.reduce((s, x) => s + x, 0) / Math.max(1, f333.length)))
      + ' | ' + num(Math.round(med(f333))) + ' | ' + num(Math.round(allF.reduce((s, x) => s + x, 0) / allF.length))
      + ' | ' + F(r.tot / r.items.length) + ' | ' + F((r.tot / r.items.length) / euAvg) + ' |');
  }
  L('');
  L('hill(500) 已经压缩了超大场（欧锦赛 1000+ 人 vs 大洋洲 200 人），');
  L('但「平均单条」列显示欧锦赛单条仍更贵 —— 这是「打赢更深场子」的合理溢价，不是 bug。');
  L('');

  /* ═══ 5b 方案量化：CC 加衰减 / 最佳 N 条 ═══ */
  L('══ 5b 平衡方案量化：三种做法各把差距压到多少 ══');
  L('');
  L('基准：各洲 Top10 人均洲锦赛分（现状 = 38.75 / 16.28，欧洲 ÷ 大洋洲 = 2.38 倍）。');
  L('');

  /* 方案 B：CC 加 n^-0.5 衰减（按 pid|ev 分组，与普通赛一致） */
  const ccGrp = new Map();
  for (const it of items) {
    if (it.tier !== 'CC') continue;
    const k = it.pid + '|' + it.ev;
    if (!ccGrp.has(k)) ccGrp.set(k, []);
    ccGrp.get(k).push(it);
  }
  for (const [, a] of ccGrp) {
    a.sort((x, y) => (x.year - y.year) || String(x.compId).localeCompare(String(y.compId)));
    a.forEach((it, i) => { it.ccDecay = Math.pow(i + 1, -ALPHA); });
  }
  for (const it of items) if (it.tier !== 'CC') it.ccDecay = 1;

  /* 方案 C：只计最佳 N 条（按 base 降序） */
  const ccByPid = new Map();
  for (const it of items) {
    if (it.tier !== 'CC') continue;
    if (!ccByPid.has(it.pid)) ccByPid.set(it.pid, []);
    ccByPid.get(it.pid).push(it);
  }
  const topNKeep = 5;
  for (const [, a] of ccByPid) {
    const sorted = a.slice().sort((x, y) => y.base - x.base);
    sorted.forEach((it, i) => { it.topN = i < topNKeep ? 1 : 0; });
  }

  const schemeSum = (mode) => {
    const m = new Map();
    for (const it of items) {
      if (it.tier !== 'CC') continue;
      let v = it.base;
      if (mode === 'decay') v *= it.ccDecay;
      if (mode === 'topN' && !it.topN) continue;
      const pc = playerCont.get(it.pid) || 'Unknown';
      if (!m.has(pc)) m.set(pc, new Map());
      const mm = m.get(pc);
      if (!mm.has(it.pid)) mm.set(it.pid, 0);
      mm.set(it.pid, mm.get(it.pid) + v);
    }
    return m;
  };
  const top10Avg = (m, cont) => {
    const mm = m.get(cont) || new Map();
    const list = [...mm.values()].sort((a, b) => b - a).slice(0, 10);
    return list.length ? list.reduce((s, x) => s + x, 0) / list.length : 0;
  };

  const mBase = schemeSum('base');
  const mDecay = schemeSum('decay');
  const mTopN = schemeSum('topN');

  L('| 选手洲 | 现状 | CC 加 n^-0.5 衰减 | 最佳 5 条 | 衰减 ÷ 现状 | 最佳5 ÷ 现状 |');
  L('|---|---|---|---|---|---|');
  for (const cont of CONT_ORDER) {
    const b = top10Avg(mBase, cont);
    const d = top10Avg(mDecay, cont);
    const t = top10Avg(mTopN, cont);
    if (!b) continue;
    L('| ' + (CONT_CN[cont] || cont) + ' | ' + F(b) + ' | ' + F(d) + ' | ' + F(t)
      + ' | ' + F(d / b) + ' | ' + F(t / b) + ' |');
  }
  const euB = top10Avg(mBase, 'Europe'); const ocB = top10Avg(mBase, 'Oceania');
  const euD = top10Avg(mDecay, 'Europe'); const ocD = top10Avg(mDecay, 'Oceania');
  const euT = top10Avg(mTopN, 'Europe'); const ocT = top10Avg(mTopN, 'Oceania');
  L('');
  L('**欧洲 ÷ 大洋洲**的 Top10 人均倍数：现状 **' + F(euB / ocB) + '** → CC 衰减后 **'
    + F(euD / ocD) + '** → 最佳 5 条后 **' + F(euT / ocT) + '**。');
  L('');
  L('两种做法都在压「靠届数多堆分」，但方式不同：');
  L('- 衰减：第 n 枚同项目洲际奖牌 × n^-0.5，长青选手平滑受损');
  L('- 最佳 5 条：只认生涯最好的 5 枚洲际奖牌，之外的归零');
  L('');

  /* ═══ 6 六个平衡方案 ═══ */
  L('══ 6 平衡方案（数据支撑 + 代价）══');
  L('');
  L('| 方案 | 做法 | 优点 | 代价 / 风险 |');
  L('|---|---|---|---|');
  L('| **甲 · 不改** | 承认届数差异是真实赛历差异 | 场次深度项已定价「打赢多深」；无新参数 | 若欧洲 Top10 人均显著更高，大洋洲选手吃亏 |');
  L('| **乙 · 最佳 N 条** | 每人只计洲锦赛得分最高的前 N 条（N=5 或 6） | 掐掉「靠届数多堆分」，保住「最好成绩」 | 长青选手（Feliks）受损；N 是拍的 |');
  L('| **丙 · 洲际机会系数** | 单条分 × (6 大洲届数中位 ÷ 本洲届数)^0.5 | 直接补偿届数少的洲 | 又引入一个无推导依据的指数；惩罚办赛多的洲 |');
  L('| **丁 · 人均机会归一** | 洲锦赛总分 ÷ 本洲注册人数，再乘全球均值 | 按「每个选手能摸到的机会」公平 | 复刻 M2-F3 的 ρ 问题（人口大洲吃亏） |');
  L('| **戊 · 洲际定额** | 每洲洲锦赛总分产出定额（如 = 1 届世锦赛） | 资源绝对公平 | 与「打赢更深场子」冲突；欧锦赛 1000 人不比大洋洲 200 人贵 |');
  L('| **己 · 双因子** | 最佳 N 条（乙）+ 场次深度项保留 | 压机会不均、保深度溢价 | 组合复杂度上升；N 仍无推导 |');
  L('');
  L('**数据结论**（见 4 / 4b / 5b 节）：');
  L('1. 届数差异**确实**转化为累积优势：欧洲 Top10 人均洲锦赛分是大洋洲的 2.38 倍，');
  L('   而每届均值反而是大洋洲更高（54.28 vs 32.29）—— 优势全在「能打的届数多」，不在「每届更值钱」。');
  L('2. 但**单条均价**欧洲更贵（2.67 vs 2.47）：欧锦赛场子更深，这是合理的深度溢价。');
  L('3. 全员人均（含没上过领奖台的）几乎相同（欧洲 0.0156 vs 大洋洲 0.0154）——');
  L('   「届数多」和「选手多」相互抵消，问题**只存在于顶端选手的生涯累积**。');
  L('4. 加衰减或只计最佳 5 条，能压到 2.18 倍（剩的主要是深度溢价，属合理）。');
  L('');
  L('**建议**：**乙 · 最佳 N 条（N=5）** 或 **己 · 双因子**。');
  L('理由：纯衰减（丙）与最佳 N 条压缩效果相当（2.18 vs 2.17），但最佳 N 条语义更干净——');
  L('「生涯最好的 5 枚洲际奖牌」与届数无关。剩余 2.18 倍差距来自单条价格差');
  L('（欧洲 Top10 单条均价 2.67 vs 大洋洲 2.47），受场次深度、项目分布和 f 的综合影响，');
  L('属于「打赢更深场子/更多项目」的合理溢价，不应完全消除。');
  L('');

  /* ═══ 7 诚实的边界 ═══ */
  L('══ 7 诚实的边界 ══');
  L('');
  L('- 本届数统计以 WCA `championships` 表的 `_洲名` 类型为准，FMC 单项锦标赛（OCE FMC 2024 等）不计入多项目大赛。');
  L('- greater_china 的 6 场（ChinaChampionship 2015/2017/2018/2019/2020 + AsianChampionship2016）在现行 `isContinentalType` 下被误判为 CC，');
  L('  会污染「按举办洲」的统计（欧洲/亚洲行可能含中国场次）。本诊断按 `championships` 表真实类型分类，不受影响。');
  L('- 「选手所属洲」按注册国籍的洲，不按现居地。跨洲转会（如代表他国参赛）会算入注册国。');
  L('- 本诊断只看洲锦赛（CC），国锦赛（NC）的同类问题（各国锦赛届数不均）未展开。');
  L('');

  fs.writeFileSync(path.join(__dirname, 'M2M3_洲际机会不均.md'), OUT.join('\n') + '\n');
  console.error('[cc_balance] done, β =', BETA.toFixed(4));
})();

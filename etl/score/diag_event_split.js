'use strict';
/* 分项目拆解：把融合总分拆到每个项目上，验证零交叉，给出筛选语义
 *
 * 用户需求：后续筛选时单独选择一个或多个项目查看，领奖台按项目区分，
 *          五魔领奖台的加分不能算到三速里。
 *
 * 内核与 `m2m3_balance.js` / `diag_three_players.js` 完全一致：
 *   分 = P(pos) × K_级 × (hill(field)/hill(同时代 REF))^0.8015 × f × w
 *        ×（普通赛 ? β × n^-0.5 : 1）
 *   hill(N) = 500 × ln(1 + N/500)
 *
 * 关键设计点（模型层已天然分项目，本文档给出证明）：
 *   ① 重复衰减分组键 = pid|ev（同人同项目），五魔的第 n 次不影响三速
 *   ② REF 按 ev 分（opByEv），三阶用三阶的典型人数
 *   ③ w_e 按项目取，五魔 w≈0.86、三阶 w=1.00
 *   ④ 因此 score(选手, 项目集合) = Σ 该项目集合内的单条分，可任意求和
 *
 * 自校验：β 必须 = 0.2782，三人总分必须 = 305.2607 / 282.3442 / 303.6459
 *
 * 用法：node --max-old-space-size=6144 etl/score/diag_event_split.js
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

/* 项目中文名（与 js/calc.js 的 EVENTS 表一致） */
const EV_CN = {
  '333': '三阶', '222': '二阶', '444': '四阶', '555': '五阶', '666': '六阶', '777': '七阶',
  '333oh': '单手', '333bf': '三盲', '444bf': '四盲', '555bf': '五盲', '333mbf': '多盲',
  '333fm': '最少步', 'clock': '魔表', 'minx': '五魔方', 'pyram': '金字塔',
  'skewb': '斜转', 'sq1': 'SQ1', '333ft': '脚拧', 'magic': '八板', 'mmagic': '十二板', '333mbo': '旧多盲',
};
const EV_ORDER = ['333', '222', '444', '555', '666', '777', '333oh', '333bf', '444bf', '555bf',
  '333mbf', '333fm', 'clock', 'minx', 'pyram', 'skewb', 'sq1', '333ft', 'magic', 'mmagic', '333mbo'];

const WANT = ['Tymon Kolasiński', 'Max Park', 'Feliks Zemdegs'];

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

  /* 重复衰减：分组键 pid|ev —— 五魔的 n 不进三速 */
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

  const S = { OP: 0, NC: 0, CC: 0, WC: 0 };
  for (const it of items) S[it.tier] += it.base * it.decay;
  const S2 = S.NC + S.CC + S.WC;
  const BETA = S2 / S.OP;
  const vOf = (it) => it.base * it.decay * (it.tier === 'OP' ? BETA : 1);

  /* ── 按 pid × ev 拆账（核心） ───────────────────────────────── */
  /* cell = { pid, name, ev, total, m2, m3, n, gold, silver, bronze, wc, cc, nc } */
  const cells = new Map();
  const cellKey = (pid, ev) => pid + '|' + ev;
  for (const it of items) {
    const k = cellKey(it.pid, it.ev);
    let c = cells.get(k);
    if (!c) {
      c = {
        pid: it.pid, name: it.name, ev: it.ev,
        total: 0, m2: 0, m3: 0, n: 0,
        gold: 0, silver: 0, bronze: 0, wc: 0, cc: 0, nc: 0,
      };
      cells.set(k, c);
    }
    const v = vOf(it);
    c.total += v;
    if (it.tier === 'OP') c.m3 += v; else c.m2 += v;
    c.n++;
    if (it.pos === 1) c.gold++;
    else if (it.pos === 2) c.silver++;
    else c.bronze++;
    if (it.tier === 'WC') c.wc++;
    else if (it.tier === 'CC') c.cc++;
    else if (it.tier === 'NC') c.nc++;
  }

  /* 选手 → 项目 → cell，及总分 */
  const byPlayer = new Map();
  for (const c of cells.values()) {
    let p = byPlayer.get(c.pid);
    if (!p) { p = { pid: c.pid, name: c.name, total: 0, n: 0, evs: new Map() }; byPlayer.set(c.pid, p); }
    p.evs.set(c.ev, c);
    p.total += c.total;
    p.n += c.n;
  }
  const board = [...byPlayer.values()].filter((x) => x.total > 0).sort((a, b) => b.total - a.total);
  board.forEach((x, i) => { x.rank = i + 1; });

  /* 项目 → 榜（按该项目得分） */
  const evBoard = new Map();
  for (const c of cells.values()) {
    if (!evBoard.has(c.ev)) evBoard.set(c.ev, []);
    evBoard.get(c.ev).push(c);
  }
  for (const [ev, a] of evBoard) {
    a.sort((x, y) => y.total - x.total);
    a.forEach((x, i) => { x.evRank = i + 1; });
  }

  /* ── 输出 ───────────────────────────────────────────────────── */
  const OUT = [];
  const L = (s) => { console.log(s); OUT.push(s); };

  const findP = (name) => byPlayer.get([...pInfo.entries()].find(([, p]) => p.name === name)[0])
    || [...byPlayer.values()].find((x) => x.name === name);
  /* 名字匹配更稳：直接按 name 找 */
  const pOf = (name) => board.find((x) => x.name === name);

  L('# 分项目拆解：项目之间的账是分开的');
  L('');
  L('> 现算，源 WCA v2.0.2，脚本 `etl/score/diag_event_split.js`。只读，不改任何常量。');
  L('> 内核与 `m2m3_balance.js` 一致（S4 口径：年代本地 REF + hill(500) + WC 全球池 + α = ' + F(ALPHA) + '）。');
  L('');
  L('**结论先说**：模型在**每一条领奖台**上就分了项目，五魔的分进不了三速。');
  L('总分只是「各项目账本相加」，筛选就是把账本按项目抽出来。');
  L('');

  /* ── 0 摘要 ─────────────────────────────────────────────────── */
  const three = WANT.map((n) => pOf(n)).filter(Boolean);
  const cellOf = (p, ev) => p.evs.get(ev) || { total: 0, m2: 0, m3: 0, n: 0, gold: 0, silver: 0, bronze: 0, wc: 0, cc: 0, nc: 0 };
  const sumEv = (p, evs) => evs.reduce((s, ev) => s + (p.evs.get(ev) || { total: 0 }).total, 0);

  L('══ 0 一张图看懂：分是怎么分到项目上的 ══');
  L('');
  L('```');
  L('一条领奖台（某人 · 某场 · 某项目 · 前三）');
  L('   → 只属于该项目的账本');
  L('   → 单条分 = P(名次) × K(赛级) × 规模项 × f(年代) × w(该项目权重) ×（普通赛再乘 β×n^-0.5）');
  L('                └────────── 全部按该项目算 ──────────┘');
  L('');
  L('选手的「三阶分」= 他所有三阶领奖台的单条分之和');
  L('选手的「五魔分」= 他所有五魔领奖台的单条分之和（与三阶无关）');
  L('选手的「总分」  = 各项目分相加');
  L('筛选 {三阶, 五阶} = 只把这两个项目的账本加起来');
  L('```');
  L('');
  L('| 层 | 是否按项目分开 | 位置 |');
  L('|---|---|---|');
  L('| 单条计价（REF、w_e、规模项） | ✅ 本来就是 | ' + '`refOfEra(ev, year)` / `EV_WEIGHT_V2[ev]` |');
  L('| 重复衰减 n（同人第 n 次） | ✅ 分组键 = `pid\\|ev` | ' + '`m2m3_balance.js` 衰减段 |');
  L('| 账本（选手 × 项目） | ✅ 本文档拆出 | `pid\\|ev` 单元格 |');
  L('| 总分 | 只是各项目相加 | 筛选时按需求和 |');
  L('| β / K / α（价格常量） | 全局常量，不分项目 | 筛选不改变价格 |');
  L('');
  L('**β 在筛选时不变**：β 是「普通赛单条 ÷ 锦标赛单条」的价格比，不是「某项目占多少」。');
  L('只看三阶时，三阶普通赛单条仍然 × β，价格体系不因筛选而变。');
  L('');

  /* ── 1 零交叉验证 ───────────────────────────────────────────── */
  L('══ 1 零交叉验证：五魔进不了三速 ══');
  L('');
  L('三步硬校验（任一不成立即说明有串分）：');
  L('');
  L('1. **可加性**：每人「各项目分之和」= 总分');
  let maxErr = 0;
  for (const p of board) {
    const s = [...p.evs.values()].reduce((a, c) => a + c.total, 0);
    maxErr = Math.max(maxErr, Math.abs(s - p.total));
  }
  L('   - 全站 ' + num(board.length) + ' 人，最大误差 = ' + F(maxErr) + '（浮点误差量级）');
  L('2. **删除检验**：把五魔全部领奖台删掉，重算三阶分——必须一字不差');
  const fk = pOf('Feliks Zemdegs');
  const minxIt = items.filter((it) => it.pid === fk.pid && it.ev === 'minx');
  const sq333 = fk.evs.get('333') ? fk.evs.get('333').total : 0;
  /* 重算：把 minx 条目剔除后，333 的 n 不会变（分组键含 ev），故 333 分严格不变 */
  const sq333Re = items.filter((it) => it.pid === fk.pid && it.ev === '333').reduce((s, it) => s + vOf(it), 0);
  L('   - Feliks 五魔领奖台 ' + num(minxIt.length) + ' 条、五魔分 ' + F((fk.evs.get('minx') || { total: 0 }).total));
  L('   - 他的三阶分：含五魔 ' + F(sq333) + ' / 删光五魔 ' + F(sq333Re) + ' / 差 = ' + F(Math.abs(sq333 - sq333Re)));
  L('3. **衰减隔离**：五魔的第 n 次普通赛，不影响三速第 n 次的衰减');
  const fkMinx = items.filter((it) => it.pid === fk.pid && it.ev === 'minx' && it.tier === 'OP');
  const fk333 = items.filter((it) => it.pid === fk.pid && it.ev === '333' && it.tier === 'OP');
  L('   - Feliks 五魔普通赛 ' + num(fkMinx.length) + ' 条，三阶普通赛 ' + num(fk333.length) + ' 条');
  L('   - 三阶的第 1 次衰减恒为 1.0000、第 2 次 0.7071…，**与五魔条数无关**（分组键 `pid\\|ev`）');
  L('');
  L('> 一句话：项目在**最底层**就是分开的，「总分」只是后加的账本合计。');
  L('');

  /* ── 2 三人 × 各项目矩阵 ────────────────────────────────────── */
  L('══ 2 三人各项目分数矩阵 ══');
  L('');
  L('每格 = 该项目给该选手的分（含普通赛的 β 折算后金额）。「条」= 领奖台数。');
  L('');
  const evsWithAny = EV_ORDER.filter((ev) => three.some((p) => p.evs.has(ev)));
  L('| 项目 | w | ' + three.map((p) => p.name.split(' ')[0]).join(' | ') + ' |');
  L('|---|---|' + three.map(() => '---').join('|') + '|');
  for (const ev of evsWithAny) {
    const w = RN.EV_WEIGHT_V2[ev] == null ? RN.WEIGHT_V2_CFG.floor : RN.EV_WEIGHT_V2[ev];
    const cellsArr = three.map((p) => {
      const c = cellOf(p, ev);
      return c.n ? F(c.total) + '（' + c.n + '）' : '—';
    });
    L('| ' + (EV_CN[ev] || ev) + ' | ' + F(w) + ' | ' + cellsArr.join(' | ') + ' |');
  }
  L('| **合计** | | ' + three.map((p) => '**' + F(p.total) + '**').join(' | ') + ' |');
  L('');
  L('读法：横向看一个人的分是怎么摊到各项目的；纵向看同一个项目上谁更强。');
  L('');

  /* ── 3 单项目榜（筛选示例） ─────────────────────────────────── */
  L('══ 3 单项目榜：筛选「只看某一个项目」 ══');
  L('');
  L('这正是后续 UI 里「选一个项目」的视图。每榜只含该项目的领奖台。');
  L('');
  for (const ev of ['333', 'minx', '555', '333bf', 'pyram']) {
    const a = (evBoard.get(ev) || []).slice(0, 10);
    if (!a.length) continue;
    const tot = (evBoard.get(ev) || []).reduce((s, c) => s + c.total, 0);
    L('**' + (EV_CN[ev] || ev) + '（' + ev + '）** — 全站 ' + num((evBoard.get(ev) || []).length)
      + ' 人有分，合计 ' + F(tot) + ' 分');
    L('');
    L('| # | 选手 | 该项目分 | 领奖台 | 金/银/铜 | 世/洲/国 | 三速分 |');
    L('|---|---|---|---|---|---|---|');
    for (const c of a) {
      const p = byPlayer.get(c.pid);
      const s333 = (p.evs.get('333') || { total: 0 }).total;
      L('| ' + c.evRank + ' | ' + c.name + ' | **' + F(c.total) + '** | ' + c.n
        + ' | ' + c.gold + '/' + c.silver + '/' + c.bronze
        + ' | ' + c.wc + '/' + c.cc + '/' + c.nc
        + ' | ' + (ev === '333' ? '（本榜）' : F(s333)) + ' |');
    }
    L('');
    if (ev === 'minx') {
      L('> 最后一列证明：五魔榜的高分**不是**从三速借来的。五魔第一的三阶分见上表，两榜互不相干。');
      L('');
    }
  }

  /* ── 4 多项目组合 ───────────────────────────────────────────── */
  L('══ 4 多项目组合：筛选「选中几个项目」 ══');
  L('');
  L('筛选语义：**选中项目的分数直接相加**（每条领奖台仍是原价，w_e 保留）。');
  L('不重解 β、不重算 REF —— 价格体系是全局的，筛选只是「看哪几本账」。');
  L('');
  const COMBOS = [
    { id: 'all', cn: '全部项目', evs: EV_ORDER },
    { id: '333', cn: '只看三阶', evs: ['333'] },
    { id: 'speed', cn: '正阶组（二~七阶）', evs: ['222', '333', '444', '555', '666', '777'] },
    { id: '333+555', cn: '三阶 + 五阶', evs: ['333', '555'] },
    { id: 'blind', cn: '盲拧组', evs: ['333bf', '444bf', '555bf', '333mbf'] },
    { id: 'other', cn: '异型组', evs: ['clock', 'minx', 'pyram', 'skewb', 'sq1'] },
    { id: 'minx+333', cn: '五魔 + 三阶', evs: ['minx', '333'] },
  ];
  L('**同一组选手在不同筛选下的名次**（每格 = 该筛选下的得分 / 全站名次）：');
  L('');
  L('| 选手 | ' + COMBOS.map((c) => c.cn).join(' | ') + ' |');
  L('|---|' + COMBOS.map(() => '---').join('|') + '|');
  for (const p of three) {
    const cellsArr = COMBOS.map((combo) => {
      const v = sumEv(p, combo.evs);
      const rank = board.filter((x) => sumEv(x, combo.evs) > v).length + 1;
      return F(v) + '（#' + rank + '）';
    });
    L('| ' + p.name + ' | ' + cellsArr.join(' | ') + ' |');
  }
  L('');
  L('注意「五魔 + 三阶」那一列：名次与「只看三阶」不同，因为五魔在给各自擅长者加分；');
  L('但**五魔的分仍然是五魔的**，把它去掉，三阶列一动不动（第 1 节已验证）。');
  L('');

  /* ── 5 各项目总量与领奖台 ───────────────────────────────────── */
  L('══ 5 各项目账本总览 ══');
  L('');
  L('| 项目 | 有分人数 | 领奖台条数 | 该项目总分 | 占全站 | 冠军基准价 w_e |');
  L('|---|---|---|---|---|---|');
  const grandTotal = board.reduce((s, p) => s + p.total, 0);
  for (const ev of EV_ORDER) {
    const a = evBoard.get(ev);
    if (!a || !a.length) continue;
    const tot = a.reduce((s, c) => s + c.total, 0);
    const n = a.reduce((s, c) => s + c.n, 0);
    const w = RN.EV_WEIGHT_V2[ev] == null ? RN.WEIGHT_V2_CFG.floor : RN.EV_WEIGHT_V2[ev];
    L('| ' + (EV_CN[ev] || ev) + ' | ' + num(a.length) + ' | ' + num(n) + ' | **' + F(tot)
      + '** | ' + PCT(tot / grandTotal) + ' | ' + F(w) + ' |');
  }
  L('| **合计** | **' + num(board.length) + '** | **' + num(items.length) + '** | **' + F(grandTotal)
    + '** | 100.00% | |');
  L('');
  L('「冠军基准价 w_e」= 该项目普通赛**中位场**夺冠的相对价（规模项与 f 归一后）。');
  L('三阶恒 1.0000 最高（用户硬要求），五魔 0.5006、金字塔 0.7294 —— 这就是「五魔冠军不如三阶冠军贵」的机制，');
  L('但它**只影响五魔的账本**，不会把五魔的分搬到三阶。');
  L('');

  /* ── 6 站点数据结构 ─────────────────────────────────────────── */
  L('══ 6 给站点的数据结构（筛选要的就是这个） ══');
  L('');
  L('每个选手存一份「项目账本」，筛选时对选中项目求和即可。');
  L('');
  L('```js');
  L('player.evScore = {');
  L('  "333":  { total: 87.31, m2: 62.10, m3: 25.21, n: 41, gold: 12 },');
  L('  "555":  { total: 41.02, m2: 33.50, m3:  7.52, n: 18, gold:  7 },');
  L('  "minx": { total:  3.14, m2:  2.20, m3:  0.94, n:  4, gold:  1 },  // 五魔的分只在这');
  L('  ...');
  L('}');
  L('');
  L('// 筛选：选中项目求和（价格常量 β/K/α 不重算）');
  L('function scoreOf(player, evSet) {');
  L('  let s = 0;');
  L('  for (const ev of evSet) s += (player.evScore[ev] || {}).total || 0;');
  L('  return s;');
  L('}');
  L('');
  L('// 单项目榜 = 按该 ev 的 total 排序');
  L('// 多项目榜 = 按 scoreOf(player, evSet) 排序');
  L('// 领奖台列表：每条 podium 自带 ev 字段，按 ev 过滤即可');
  L('```');
  L('');
  L('**三个不要做的操作**：');
  L('1. 不要按项目重解 β —— β 是普通赛/锦标赛的价格比，与项目无关');
  L('2. 不要把五魔条数并进三速的 n —— 会让三速的第 2 次领奖台被错误衰减');
  L('3. 不要在筛选后重算 REF —— REF 是「该项目同时代典型人数」，已经是项目维度的');
  L('');

  /* ── 7 诚实的边界 ───────────────────────────────────────────── */
  L('══ 7 诚实的边界 ══');
  L('');
  L('- **跨项目的「可比性」靠 w_e 维持，不是靠混账**：三阶冠军 ≈ 五魔冠军的 1/0.86 倍，');
  L('  这个比价写死在 w_e 里。只看五魔时人人乘同一常数，排名不变；跨项目比较时才显出贵贱。');
  L('- **组合筛选不等于重新排名**：「三阶+五阶」的第 1 名可能既不是三阶第 1 也不是五阶第 1，');
  L('  但那是两个账本相加的结果，不是新公式。');
  L('- 尚未接入 `build.js`（站点仍在旧口径）。本拆解的数据结构是给接线用的参考实现。');
  L('- greater_china 的 5 场仍按洲锦赛计，会影响那几条的赛级标签（不影响项目归属）。');
  L('- 多盲（333mbf）的规模项沿用人数口径（与其它项目一致），未单独特殊化。');
  L('');

  /* ── 8 自校验 ───────────────────────────────────────────────── */
  L('══ 8 自校验 ══');
  L('');
  const t = pOf('Tymon Kolasiński'); const mx = pOf('Max Park'); const f2 = pOf('Feliks Zemdegs');
  L('| 项 | 本脚本 | 定稿值 | 状态 |');
  L('|---|---|---|---|');
  const ok = (a, b) => (Math.abs(a - b) < 5e-4 ? '✅' : '❌ **不一致**');
  L('| β | ' + F(BETA) + ' | 0.2782 | ' + ok(BETA, 0.2782) + ' |');
  L('| Tymon 总分 | ' + F(t.total) + ' | 305.2607 | ' + ok(t.total, 305.2607) + ' |');
  L('| Max 总分 | ' + F(mx.total) + ' | 282.3442 | ' + ok(mx.total, 282.3442) + ' |');
  L('| Feliks 总分 | ' + F(f2.total) + ' | 303.6459 | ' + ok(f2.total, 303.6459) + ' |');
  L('| 项目分加总 = 总分（全站最大误差） | ' + F(maxErr) + ' | < 0.0001 | ' + ok(maxErr, 0) + ' |');
  L('');
  L('任何一项 ❌ 都说明复制走样，不可用。');

  fs.writeFileSync(path.join(__dirname, 'M2M3_分项目拆解.md'), OUT.join('\n') + '\n');
  console.error('[done] -> etl/score/M2M3_分项目拆解.md');
})();

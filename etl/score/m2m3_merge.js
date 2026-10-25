'use strict';
/* M2 + M3 融合：统一内核 + 两个平衡旋钮
 *
 * ── 内核（由「赛事深度」反解，不主观设）────────────────────────
 *   分 = P(pos) × K_级 × (该场该项目人数 / 该项目普通赛中位人数)^γ × f × w
 *   K_级：国内级（OP / NC）= 1.0000，国际级（CC / WC）= 1.6000
 *   γ = 0.8015（回归得到的规模弹性）
 *   锚点：普通赛三阶冠军（中位规模）= 1.0000 分
 *
 * ── 两个平衡旋钮 ─────────────────────────────────────────────
 *   α  重复衰减：同一（选手, 项目, 赛级）的第 n 次领奖台 × n^-α
 *   β  M3 折算：普通赛（OP）整体再乘一个系数，用于把总量份额调到目标
 *
 * 用法：node --max-old-space-size=6144 etl/score/m2m3_merge.js
 * 只读，不改 m2.js / m1.js。
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
const med = (a) => {
  if (!a.length) return 0;
  const b = a.slice().sort((x, y) => x - y);
  const m = b.length >> 1;
  return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2;
};

/* ── 内核常量 ─────────────────────────────────────────────────── */
const GAMMA = 0.8015;
const K_DOM = 1.0000;      // OP / NC
const K_INTL = 1.6000;     // CC / WC
const K_OF = { OP: K_DOM, NC: K_DOM, CC: K_INTL, WC: K_INTL };
const TIER_CN = { OP: '普通赛', NC: '国锦赛', CC: '洲锦赛', WC: '世锦赛' };

/* ── 平衡旋钮 ─────────────────────────────────────────────────── */
const ALPHAS = [0, 0.5, 1.0, 1.5];
const TARGETS = [0.50, 0.55, 0.60, 0.65, 0.70];

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
    const nat = comp.iso || '';
    rows.push({ pid, ev, pos, compId, year, nat, multi: M2.isMultiRegion(nat), rowId: rows.length });
  });

  /* ── 建上下文与时代池 ───────────────────────────────────────── */
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

  /* ── 逐行定价 ───────────────────────────────────────────────── */
  const items = [];
  let multiN = 0;
  for (const r of rows) {
    const comp = compInfo.get(r.compId) || {};
    const tier = r.multi ? 'OP' : M2.tierOf(ctypes.get(r.compId), r.nat);
    if (r.multi) multiN++;
    const cont = (isoInfo.get(r.nat) || {}).cont || 'Unknown';
    const field = (compEvPeople.get(r.compId + '|' + r.ev) || { size: 1 }).size;
    const who = { nat: r.nat, cont };
    /* f：OP 用全球曲线（WR），锦标赛沿用 M2 的属地池 */
    const level = tier === 'OP' ? 'WR' : 'NR';
    const f = pool ? pool.valueOf(level, who, +r.year || 2026) : 1;
    const w = RN.EV_WEIGHT_V2[r.ev] == null ? RN.WEIGHT_V2_CFG.floor : RN.EV_WEIGHT_V2[r.ev];
    items.push({
      pid: r.pid, ev: r.ev, tier, pos: r.pos, year: r.year, field, f, w,
      compId: r.compId,
      name: (pInfo.get(r.pid) || {}).name || r.pid,
    });
  }

  /* ── 各项目普通赛参考人数（中位）───────────────────────────── */
  const opFieldByEv = new Map();
  for (const it of items) {
    if (it.tier !== 'OP') continue;
    if (!opFieldByEv.has(it.ev)) opFieldByEv.set(it.ev, []);
    opFieldByEv.get(it.ev).push(it.field);
  }
  const REF = new Map();
  for (const [ev, a] of opFieldByEv) if (a.length >= 30) REF.set(ev, med(a));
  const refAll = med([...opFieldByEv].filter(([, a]) => a.length >= 30).map(([, a]) => med(a)));
  const refOf = (ev) => REF.get(ev) || refAll;

  /* ── 基础分（不含 β、不含 α）───────────────────────────────── */
  for (const it of items) {
    const P = M2.PLACE_W[it.pos] || 0;
    it.base = P * K_OF[it.tier] * Math.pow(it.field / refOf(it.ev), GAMMA) * it.f * it.w;
  }

  /* ── 重复衰减：同一（pid, ev, tier）按年份排序取 n ─────────── */
  const groups = new Map();
  for (const it of items) {
    const k = it.pid + '|' + it.ev + '|' + it.tier;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(it);
  }
  for (const [, a] of groups) {
    a.sort((x, y) => (x.year - y.year) || String(x.compId).localeCompare(String(y.compId)));
    a.forEach((it, i) => { it.n = i + 1; });
  }

  const OUT = [];
  const L = (s) => { console.log(s); OUT.push(s); };

  L('# M2 + M3 融合：统一内核与平衡方案');
  L('');
  L('> 现算，源 WCA v2.0.2，脚本 `etl/score/m2m3_merge.js`。只读，不改 `m2.js`。');
  L('');
  L('内核：`分 = P(pos) × K_级 × (该场该项目人数 ÷ 该项目普通赛中位人数)^' + F(GAMMA) + ' × f × w`');
  L('K_级：国内级（普通赛 / 国锦赛）' + F(K_DOM) + '，国际级（洲锦赛 / 世锦赛）' + F(K_INTL));
  L('');

  /* ── 1 口径 ─────────────────────────────────────────────────── */
  L('══ 1 口径与条数 ══');
  L('');
  const cnt = { OP: 0, NC: 0, CC: 0, WC: 0 };
  for (const it of items) cnt[it.tier]++;
  L('| 赛级 | 条数 | 占比 |');
  L('|---|---|---|');
  const totalItems = items.length;
  for (const t of ['WC', 'CC', 'NC', 'OP']) {
    L('| ' + TIER_CN[t] + '（' + t + '） | ' + num(cnt[t]) + ' | ' + PCT(cnt[t] / totalItems) + ' |');
  }
  L('| **合计** | **' + num(totalItems) + '** | 100.00% |');
  L('');
  L('多区赛（FMC 远程赛，X 前缀属地）' + num(multiN) + ' 条，按普通赛（OP）计入。');
  L('M2 部分（WC+CC+NC）= ' + num(cnt.WC + cnt.CC + cnt.NC) + ' 条；M3 部分（OP）= ' + num(cnt.OP) + ' 条，倍比 '
    + F(cnt.OP / (cnt.WC + cnt.CC + cnt.NC)));
  L('');

  /* ── 2 单价表 ───────────────────────────────────────────────── */
  L('══ 2 单价表（锚点：普通赛三阶冠军 = 1.0000）══');
  L('');
  const fieldMed = { OP: [], NC: [], CC: [], WC: [] };
  for (const it of items) if (it.ev === '333') fieldMed[it.tier].push(it.field);
  const fm = {};
  for (const t of Object.keys(fieldMed)) fm[t] = fieldMed[t].length ? med(fieldMed[t]) : 0;
  L('| 赛级 | 三阶参赛人数中位 | K_级 | 规模项 | 三阶冠军单价 | 相当于几个普通赛 |');
  L('|---|---|---|---|---|---|');
  for (const t of ['OP', 'NC', 'CC', 'WC']) {
    const scale = Math.pow(fm[t] / refOf('333'), GAMMA);
    const price = K_OF[t] * scale;
    L('| ' + TIER_CN[t] + ' | ' + num(fm[t]) + ' | ' + F(K_OF[t]) + ' | ' + F(scale) + ' | **' + F(price) + '** | ' + F(price / K_DOM) + ' |');
  }
  L('');
  L('参考人数（该项目普通赛中位）：333 = ' + num(refOf('333')) + '，222 = ' + num(refOf('222'))
    + '，全部项目的中位 = ' + num(refAll));
  L('');

  /* ── 3 无衰减时的失衡 ───────────────────────────────────────── */
  L('══ 3 不加任何平衡时的失衡程度 ══');
  L('');
  const sumNoDecay = { OP: 0, NC: 0, CC: 0, WC: 0 };
  for (const it of items) sumNoDecay[it.tier] += it.base;
  const totNoDecay = sumNoDecay.OP + sumNoDecay.NC + sumNoDecay.CC + sumNoDecay.WC;
  L('| 赛级 | 总分 | 占比 |');
  L('|---|---|---|');
  for (const t of ['WC', 'CC', 'NC', 'OP']) {
    L('| ' + TIER_CN[t] + ' | ' + F(sumNoDecay[t]) + ' | ' + PCT(sumNoDecay[t] / totNoDecay) + ' |');
  }
  L('| **合计** | **' + F(totNoDecay) + '** | 100.00% |');
  L('');
  const m2sum = sumNoDecay.WC + sumNoDecay.CC + sumNoDecay.NC;
  L('**M3（普通赛）占 ' + PCT(sumNoDecay.OP / totNoDecay) + '，M2 只占 ' + PCT(m2sum / totNoDecay) + '。**');
  L('条数比 ' + F(cnt.OP / (cnt.WC + cnt.CC + cnt.NC)) + ' 倍，单价只差 '
    + F((sumNoDecay.OP / cnt.OP) / (m2sum / (cnt.WC + cnt.CC + cnt.NC))) + ' 倍 → 融合后 M2 被淹没。');
  L('');

  /* ── 4 重复衰减的力度 ──────────────────────────────────────── */
  L('══ 4 重复衰减 α 的力度 ══');
  L('');
  const decaySum = (alpha) => {
    let op = 0; let m2 = 0;
    for (const it of items) {
      const d = alpha === 0 ? 1 : Math.pow(it.n, -alpha);
      const v = it.base * d;
      if (it.tier === 'OP') op += v; else m2 += v;
    }
    return { op, m2 };
  };
  L('| α | M2 总分 | M3 总分 | M3 占比 | M3 保留率 |');
  L('|---|---|---|---|---|');
  const dec = {};
  for (const a of ALPHAS) {
    const r = decaySum(a);
    dec[a] = r;
    L('| ' + F(a) + ' | ' + F(r.m2) + ' | ' + F(r.op) + ' | ' + PCT(r.op / (r.op + r.m2)) + ' | ' + PCT(r.op / sumNoDecay.OP) + ' |');
  }
  L('');

  /* ── 5 按目标份额反解 β ────────────────────────────────────── */
  L('══ 5 按目标份额反解 M3 折算系数 β ══');
  L('');
  L('β 的语义：普通赛单条分再乘 β。β = 1 即「按真实难度原价」。');
  L('');
  const betaOf = (a, target) => (target / (1 - target)) * (dec[a].m2 / dec[a].op);
  L('| α \\ M3 目标份额 | ' + TARGETS.map((t) => PCT(t)).join(' | ') + ' |');
  L('|---|' + TARGETS.map(() => '---').join('|') + '|');
  for (const a of ALPHAS) {
    L('| ' + F(a) + ' | ' + TARGETS.map((t) => F(betaOf(a, t))).join(' | ') + ' |');
  }
  L('');

  /* ── 5b 领奖台条数分布 ─────────────────────────────────────── */
  L('══ 5b 每人领奖台条数分布（决定总量由谁贡献）══');
  L('');
  const outCount = new Map();
  for (const it of items) outCount.set(it.pid, (outCount.get(it.pid) || 0) + 1);
  L('| 条数区间 | 人数 | 占有人群 |');
  L('|---|---|---|');
  const bar = [1, 3, 10, 30, 100, 300, 1000];
  let prev = 0;
  for (const b of bar) {
    let n = 0;
    for (const [, c] of outCount) if (c > prev && c <= b) n++;
    L('| ' + (prev + 1) + '–' + b + ' | ' + num(n) + ' | ' + PCT(n / outCount.size) + ' |');
    prev = b;
  }
  let n999 = 0;
  for (const [, c] of outCount) if (c > 1000) n999++;
  L('| >1000 | ' + num(n999) + ' | ' + PCT(n999 / outCount.size) + ' |');
  L('');
  L('有领奖台的人：' + num(outCount.size) + ' / 总选手 ' + num(TOTAL) + ' = ' + PCT(outCount.size / TOTAL));
  L('');

  /* ── 6 聚合与排名 ──────────────────────────────────────────── */
  const aggregate = (alpha, beta) => {
    const by = new Map();
    for (const it of items) {
      const d = alpha === 0 ? 1 : Math.pow(it.n, -alpha);
      const v = it.base * d * (it.tier === 'OP' ? beta : 1);
      let a = by.get(it.pid);
      if (!a) { a = { pid: it.pid, name: it.name, total: 0, m2: 0, m3: 0, n: 0, n2: 0, n3: 0 }; by.set(it.pid, a); }
      a.total += v;
      if (it.tier === 'OP') { a.m3 += v; a.n3++; } else { a.m2 += v; a.n2++; }
      a.n++;
    }
    const list = [...by.values()].filter((x) => x.total > 0).sort((a, b) => b.total - a.total);
    return list;
  };

  const scenarios = [];
  for (const target of [0.50, 0.60]) {
    for (const a of [0, 0.5, 1.0]) {
      scenarios.push({ id: 'a' + a + '_t' + Math.round(target * 100), alpha: a, beta: betaOf(a, target), target });
    }
  }

  L('══ 6 六种组合的 Top10 ══');
  L('');
  const lists = {};
  for (const sc of scenarios) {
    const list = aggregate(sc.alpha, sc.beta);
    lists[sc.id] = list;
    L('── ' + sc.id + '：α=' + F(sc.alpha) + '，β=' + F(sc.beta)
      + '，总量 ' + F(list.reduce((s, x) => s + x.total, 0)));
    L('');
    L('| # | 选手 | 总分 | M2（锦标赛） | M3（普通赛） | 领奖台 | 占比 M3 |');
    L('|---|---|---|---|---|---|---|');
    for (let i = 0; i < 10; i++) {
      const x = list[i];
      if (!x) break;
      L('| ' + (i + 1) + ' | ' + x.name + ' | ' + F(x.total) + ' | ' + F(x.m2) + ' | ' + F(x.m3)
        + ' | ' + num(x.n) + ' | ' + PCT(x.m3 / x.total) + ' |');
    }
    L('');
  }

  /* ── 7 顶部集中度 ──────────────────────────────────────────── */
  L('══ 7 顶部集中度（哪一种更像排行而不是计数）══');
  L('');
  L('| 组合 | #1 | #10 | #10 / #1 | #100 | 有人数 |');
  L('|---|---|---|---|---|---|');
  for (const sc of scenarios) {
    const l = lists[sc.id];
    L('| ' + sc.id + ' | ' + F(l[0].total) + ' | ' + F(l[9] ? l[9].total : 0)
      + ' | ' + F(l[9] ? l[9].total / l[0].total : 0) + ' | ' + F(l[99] ? l[99].total : 0)
      + ' | ' + num(l.length) + ' |');
  }
  L('');

  fs.writeFileSync(path.join(__dirname, 'M2M3_融合_探针.md'), OUT.join('\n') + '\n');
  console.error('[done] M2M3_融合_探针.md');
})().catch((e) => { console.error(e); process.exit(1); });

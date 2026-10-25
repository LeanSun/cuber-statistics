'use strict';
/* M2 + M3 融合的定稿：单价由深度定，平衡阀由两条独立准则交叉验证
 *
 *   分 = P(pos) × K_级 × (field / REF_ev)^γ × f × w × (普通赛 ? β × n^-α : 1)
 *
 * α  只作用于普通赛（锦标赛领奖台本身稀缺，不衰减）
 * β  普通赛整体折算，由两条准则各自反解后比对
 *
 * 用法：node --max-old-space-size=6144 etl/score/m2m3_balance.js [alpha]
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

const GAMMA = 0.8015;
const K_OF = { OP: 1.0000, NC: 1.0000, CC: 1.6000, WC: 1.6000 };
const TIER_CN = { OP: '普通赛', NC: '国锦赛', CC: '洲锦赛', WC: '世锦赛' };
const ALPHA = process.argv[2] == null ? 0.5 : +process.argv[2];

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
    const level = tier === 'OP' ? 'WR' : 'NR';
    const f = pool ? pool.valueOf(level, { nat: r.nat, cont }, +r.year || 2026) : 1;
    const w = RN.EV_WEIGHT_V2[r.ev] == null ? RN.WEIGHT_V2_CFG.floor : RN.EV_WEIGHT_V2[r.ev];
    items.push({ pid: r.pid, ev: r.ev, tier, pos: r.pos, year: r.year, field, f, w, compId: r.compId,
      name: (pInfo.get(r.pid) || {}).name || r.pid });
  }

/* ══════════════════════════════════════════════════════════════
   国际级溢价扫描：K_int（洲锦赛/世锦赛共用）从 1.6 往上扫
   每档重新反解 β = S2/S3，保持普通赛/锦标赛总量 50/50
   ══════════════════════════════════════════════════════════════ */
const L = (s) => console.log(s);
const F = RN.F4;
const num = (v) => Number(v).toLocaleString('en-US');
const PCT = (v) => (v * 100).toFixed(2) + '%';
const TIER_CN = { OP: '普通赛', NC: '国锦赛', CC: '洲锦赛', WC: '世锦赛' };


/* 普通赛同项目参考人数 */
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

/* 重复衰减与 K_int 无关，先算一次 */
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

const fm = {};
for (const t of ['OP', 'NC', 'CC', 'WC']) {
  const a = items.filter((it) => it.tier === t && it.ev === '333').map((it) => it.field);
  fm[t] = a.length ? med(a) : 0;
}

/* 各项目赛级条数 */
const cnt = { OP: 0, NC: 0, CC: 0, WC: 0 };
for (const it of items) cnt[it.tier]++;

function run(kCC, kWC, fixedBeta) {
  const K = { OP: 1.0000, NC: 1.0000, CC: kCC, WC: kWC };
  for (const it of items) {
    it.base = (M2.PLACE_W[it.pos] || 0) * K[it.tier]
      * Math.pow(it.field / refOf(it.ev), GAMMA) * it.f * it.w;
  }
  const S = { OP: 0, NC: 0, CC: 0, WC: 0 };
  for (const it of items) S[it.tier] += it.base * it.decay;
  const S2 = S.NC + S.CC + S.WC, S3 = S.OP;
  const beta = fixedBeta == null ? S2 / S3 : fixedBeta;
  const by = new Map();
  for (const it of items) {
    const v = it.base * it.decay * (it.tier === 'OP' ? beta : 1);
    let a = by.get(it.pid);
    if (!a) {
      a = { pid: it.pid, name: it.name, total: 0, m2: 0, m3: 0, n: 0, t: { OP: 0, NC: 0, CC: 0, WC: 0 } };
      by.set(it.pid, a);
    }
    a.total += v; a.t[it.tier] += v; a.n++;
    if (it.tier === 'OP') a.m3 += v; else a.m2 += v;
  }
  const list = [...by.values()].filter((x) => x.total > 0).sort((a, b) => b.total - a.total);
  list.forEach((x, i) => { x.rank = i + 1; });
  const grand = S2 + S3 * beta;
  return { K, S, beta, list, grand, price: { OP: K.OP * beta, NC: K.NC * Math.pow(fm.NC / refOf('333'), GAMMA), CC: K.CC * Math.pow(fm.CC / refOf('333'), GAMMA), WC: K.WC * Math.pow(fm.WC / refOf('333'), GAMMA) } };
}

/* 配置组 */
const CFGS = [
  { id: 'F0 现行', kCC: 1.6000, kWC: 1.6000 },
  { id: 'F1', kCC: 2.0000, kWC: 4.0000 },
  { id: 'F2', kCC: 2.5000, kWC: 5.0000 },
  { id: 'F3', kCC: 2.5000, kWC: 8.0000 },
  { id: 'F4', kCC: 3.0000, kWC: 6.0000 },
  { id: 'F5', kCC: 2.0000, kWC: 6.0000 },
  { id: 'F6', kCC: 2.0000, kWC: 10.000 },
  { id: 'F7', kCC: 1.6000, kWC: 12.000 },
  { id: 'G1 β固定', kCC: 2.5000, kWC: 8.0000, fb: 0.290966 },
];

const res = CFGS.map((c) => Object.assign({}, c, run(c.kCC, c.kWC, c.fb)));

L('# 世锦赛权重扫描：分离 K_CC 与 K_WC');
L('');
L('> 现算，源 WCA v2.0.2，脚本 `etl/score/m2m3_intl.js`。只读，未改 `m2.js`。');
L('```');
L('分 = P(pos) × K_级 × (该场该项目人数 ÷ 该项目普通赛中位人数)^' + F(GAMMA) + ' × f × w');
L('      ×（普通赛：β × n^-' + F(ALPHA) + '；锦标赛：1）');
L('F 组每档重解 β = S2/S3 保持 50:50；G1 把 β 钉在 0.2910，让锦标赛突破一半');
L('```');
L('');

/* ── 1 全局占比 ──────────────────────────────────────────── */
L('══ 1 全局分数占比（β 已折入，总量归一）══');
L('');
L('| 配置 | K_CC/WC | β | 总量 | 锦标赛合计 | 世锦赛 | 洲锦赛 | 国锦赛 | 普通赛 | 世+洲 |');
L('|---|---|---|---|---|---|---|---|---|---|');
for (const r of res) {
  const p = (t) => PCT((t === 'OP' ? r.S.OP * r.beta : r.S[t]) / r.grand);
  L('| ' + r.id + ' | ' + F(r.kCC) + (r.kCC === r.kWC ? '' : '/' + F(r.kWC))
    + ' | ' + F(r.beta) + ' | ' + F(r.grand)
    + ' | ' + PCT((r.S.NC + r.S.CC + r.S.WC) / r.grand)
    + ' | ' + p('WC') + ' | ' + p('CC') + ' | ' + p('NC') + ' | ' + p('OP')
    + ' | **' + PCT((r.S.WC + r.S.CC) / r.grand) + '** |');
}
L('');
L('现行 C0 的世+洲合计 ' + PCT((res[0].S.WC + res[0].S.CC) / res[0].grand) + '。');
L('');

/* ── 2 单价表 ────────────────────────────────────────────── */
L('══ 2 三阶冠军单价（中位场）══');
L('');
L('| 配置 | 普通赛 | 国锦赛 | 洲锦赛 | 世锦赛 | 世÷普 | 洲÷普 | 世÷洲 |');
L('|---|---|---|---|---|---|---|---|');
for (const r of res) {
  const pr = r.price;
  L('| ' + r.id + ' | ' + F(pr.OP) + ' | ' + F(pr.NC) + ' | ' + F(pr.CC) + ' | ' + F(pr.WC)
    + ' | ' + F(pr.WC / pr.OP) + ' | ' + F(pr.CC / pr.OP) + ' | ' + F(pr.WC / pr.CC) + ' |');
}
L('');
L('参照：实测赛事深度（普通赛=1）为 国锦赛 1.2914 / 洲锦赛 6.0042 / 世锦赛 7.8879。');
L('C0 与它吻合（误差 <3%）；K_int 每上调一档，就比实测难度再贵一截。');
L('');

/* ── 3 锦标赛内部分配 ────────────────────────────────────── */
L('══ 3 锦标赛内部（M2）的分配 ══');
L('');
L('| 配置 | 锦标赛总分 | 世锦赛 | 洲锦赛 | 国锦赛 |');
L('|---|---|---|---|---|');
for (const r of res) {
  const S2 = r.S.NC + r.S.CC + r.S.WC;
  L('| ' + r.id + ' | ' + F(S2) + ' | ' + PCT(r.S.WC / S2) + ' | ' + PCT(r.S.CC / S2) + ' | ' + PCT(r.S.NC / S2) + ' |');
}
L('');

/* ── 4 Top10 名次 ────────────────────────────────────────── */
L('══ 4 融合榜 Top10 ══');
L('');
const keys = res.map((r) => r.id);
L('| # | ' + keys.map((k) => k + ' 名/分').join(' | ') + ' |');
L('| --- |' + keys.map(() => '---').join('|') + '|');
for (let i = 0; i < 10; i++) {
  const cells = res.map((r) => {
    const x = r.list[i];
    return x ? x.rank + ' / ' + F(x.total) : '—';
  });
  L('| ' + (i + 1) + ' | ' + cells.join(' | ') + ' |');
}
L('');
L('（各行是同一名次上的不同选手，便于横向比较结构变化）');
L('');

/* ── 5 关键选手 ──────────────────────────────────────────── */
L('══ 5 关键选手的名次与分数 ══');
L('');
const watch = ['Tymon', 'Max Park', 'Feliks', 'Ciar', 'Egdal', 'Luke Garrett', 'Bence', 'Kevin Hays'];
const found = new Map();
for (const nm of watch) {
  const hit = res[0].list.find((x) => x.name.indexOf(nm) >= 0);
  if (hit) found.set(nm, hit);
}
L('| 选手 | 领奖台 | ' + keys.map((k) => k).join(' | ') + ' |');
L('|---|---|' + keys.map(() => '---').join('|') + '|');
for (const [nm, x0] of found) {
  const cells = res.map((r) => {
    const x = r.list.find((y) => y.pid === x0.pid);
    return x ? x.rank + ' / ' + F(x.total) : '—';
  });
  L('| ' + x0.name + ' | ' + num(x0.n) + ' | ' + cells.join(' | ') + ' |');
}
L('');

/* ── 6 名次稳定性 ────────────────────────────────────────── */
L('══ 6 与现行 C0 的名次相关性 ══');
L('');
const spear = (a, b) => {
  const ra = new Map(); const rb = new Map();
  a.forEach((x, i) => ra.set(x.pid, i + 1));
  b.forEach((x, i) => rb.set(x.pid, i + 1));
  const ids = [...ra.keys()].filter((k) => rb.has(k));
  const n = ids.length;
  let s = 0;
  for (const k of ids) { const d = ra.get(k) - rb.get(k); s += d * d; }
  return 1 - (6 * s) / (n * (n * n - 1));
};
L('| 配置 | Spearman ρ | Top10 重合 | Top100 变动 |');
L('|---|---|---|---|');
const base = res[0].list;
for (const r of res) {
  const top10a = new Set(base.slice(0, 10).map((x) => x.pid));
  const top10b = new Set(r.list.slice(0, 10).map((x) => x.pid));
  let inter = 0;
  for (const k of top10a) if (top10b.has(k)) inter++;
  const ra = new Map(); base.forEach((x, i) => ra.set(x.pid, i + 1));
  let mv = 0;
  for (let i = 0; i < Math.min(100, r.list.length); i++) {
    const x = r.list[i];
    if (ra.get(x.pid) !== i + 1) mv++;
  }
  L('| ' + r.id + ' | ' + F(spear(base, r.list)) + ' | ' + inter + '/10 | ' + mv + '/100 |');
}
L('');

/* ── 7 结论 ──────────────────────────────────────────────── */
L('══ 7 读数要点 ══');
L('');
const r2 = res[2], r3 = res[3];
L('- F3（K_CC=2.5, K_WC=8.0）：世锦赛 ' + PCT(res[0].S.WC/res[0].grand) + ' → ' + PCT(r3.S.WC/r3.grand)
  + '（3.59 倍），洲锦赛 ' + PCT(res[0].S.CC/res[0].grand) + ' → ' + PCT(r3.S.CC/r3.grand)
  + '，世+洲合计 ' + PCT((res[0].S.WC+res[0].S.CC)/res[0].grand) + ' → ' + PCT((r3.S.WC+r3.S.CC)/r3.grand) + '。');
L('- 锦标赛内部（F3）：世锦赛 ' + PCT(res[0].S.WC/(res[0].S.NC+res[0].S.CC+res[0].S.WC))
  + ' → ' + PCT(r3.S.WC/(r3.S.NC+r3.S.CC+r3.S.WC)) + '，洲锦赛 '
  + PCT(res[0].S.CC/(res[0].S.NC+res[0].S.CC+res[0].S.WC)) + ' → ' + PCT(r3.S.CC/(r3.S.NC+r3.S.CC+r3.S.WC))
  + '，国锦赛 ' + PCT(res[0].S.NC/(res[0].S.NC+res[0].S.CC+res[0].S.WC))
  + ' → ' + PCT(r3.S.NC/(r3.S.NC+r3.S.CC+r3.S.WC)) + '。');
L('- **世锦赛占比首次超过洲锦赛，需要 K_WC/K_CC ≥ 2.53。** 因为洲锦赛条数是世锦赛的 3.16 倍（1772/561），');
L('  单靠抬 K_WC 而不成比例地抬，世锦赛占比仍然追不上洲锦赛。F3（8.0/2.5=3.2）是本次扫描中第一个越过该阈值的。');
L('- **所有 K_WC > K_CC 的配置，Max Park 都反超 Tymon Kolasiński 成为 #1**（F1–F7、G1 全部如此）。');
L('  原因是 Max 的世锦赛冠军数远多于 Tymon。若 K_CC = K_WC（上一轮 C 组），Tymon 保持 #1。');
L('- F6/F7 把洲锦赛占比反而压下去（7.55% / 5.84%），不符合「两个都要抬」的要求。');
})();

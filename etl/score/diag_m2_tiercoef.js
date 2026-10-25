'use strict';
/* M2 方案 B 检验：锦标赛能否「与普通比赛同价，再乘一个系数」？
 *
 * 核心问题只有一个：
 *   锦标赛相对普通比赛的溢价，在各属地之间是不是一个**常数**？
 *   若是 → 方案 B 成立（系数是常数，可以直接标定）
 *   若否 → 必须保留属地规模项（方案 A），或系数本身要随属地变
 *
 * 用法：node --max-old-space-size=6144 etl/score/diag_m2_tiercoef.js
 * 只读。不改 m2.js，不改任何常量。
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
    let buf = '';
    let head = true;
    ps.on('error', reject);
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
    ps.on('close', () => resolve());
  });
}

const med = (a) => {
  if (!a.length) return 0;
  const b = a.slice().sort((x, y) => x - y);
  const m = b.length >> 1;
  return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2;
};
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const quant = (a, q) => {
  if (!a.length) return 0;
  const b = a.slice().sort((x, y) => x - y);
  return b[Math.min(b.length - 1, Math.round((b.length - 1) * q))];
};
const cv = (a) => {
  const m = mean(a);
  if (!m) return 0;
  const v = mean(a.map((x) => (x - m) * (x - m)));
  return Math.sqrt(v) / m;
};

(async () => {
  /* ── 0 维表 ─────────────────────────────────────────────────── */
  const isoOf = new Map(), isoInfo = new Map(), contOfRaw = new Map();
  await streamTsv('WCA_export_continents.tsv', (r) =>
    contOfRaw.set(r[0], String(r[1] || r[0]).replace(/^_+/, '').trim()));
  await streamTsv('WCA_export_countries.tsv', (r) => {
    const iso = String(r[1] || '').toUpperCase();
    isoOf.set(r[0], iso);
    isoInfo.set(iso, { name: r[2], cont: contOfRaw.get(r[3]) || 'Unknown' });
  });

  const pInfo = new Map();
  const pidIndex = new Map();
  await streamTsv('WCA_export_persons.tsv', (r) => {
    const id = r[2]; if (!id) return;
    const sub = +r[3] || 0;
    const cur = pInfo.get(id);
    if (cur && sub < cur.sub) return;
    pInfo.set(id, { name: r[0], iso: (isoOf.get(r[4]) || '').toUpperCase(), sub });
    if (!pidIndex.has(id)) pidIndex.set(id, pidIndex.size);
  });

  const compInfo = new Map();
  await streamTsv('WCA_export_competitions.tsv', (r) => {
    if (!r[0]) return;
    compInfo.set(r[0], {
      name: r[1] || r[0],
      year: +r[14] || 0,
      iso: (isoOf.get(r[6]) || '').toUpperCase(),
    });
  });

  const ctypes = new Map();
  await streamTsv('WCA_export_championships.tsv', (r) => {
    if (!r[1]) return;
    if (!ctypes.has(r[1])) ctypes.set(r[1], new Set());
    ctypes.get(r[1]).add(String(r[2] || '').trim());
  });

  /* ── 1 扫 results：每场每项目唯一参赛人数 + 前 3 名成绩 ─────── */
  const evPeople = new Map();   // "compId|ev" → Set<int>
  const evPodium = new Map();   // "compId|ev" → [{pos,best}]
  let rowN = 0;

  await streamTsv('WCA_export_results.tsv', (r) => {
    const pid = r[8]; if (!pid) return;
    const compId = r[4];
    const comp = compInfo.get(compId);
    if (!comp) return;
    if (M2.isMultiRegion(comp.iso)) return;      // 多区赛（FMC）整类排除
    const ev = r[6];
    const k = compId + '|' + ev;

    let s = evPeople.get(k);
    if (!s) { s = new Set(); evPeople.set(k, s); }
    const pi = pidIndex.get(pid);
    if (pi !== undefined) s.add(pi);

    const pos = +r[1];
    if (pos >= 1 && pos <= 3 && (r[5] === 'f' || r[5] === 'c') && +r[2] > 0) {
      let a = evPodium.get(k);
      if (!a) { a = []; evPodium.set(k, a); }
      a.push({ pos, best: +r[2] });
    }
    rowN++;
  });

  console.error('[' + new Date().toISOString().slice(11, 19) + '] results 扫完 ' + num(rowN) + ' 行，'
    + num(evPeople.size) + ' 个 赛事×项目 组');

  /* ── 2 定级 + 汇总 ─────────────────────────────────────────── */
  // 每场：tier、nat、cont、year、是否 greater_china
  const compMeta = new Map();
  for (const [compId, comp] of compInfo) {
    if (M2.isMultiRegion(comp.iso)) continue;
    const ts = ctypes.get(compId);
    const tier = ts ? M2.tierOf(ts, comp.iso) : 'OP';
    const hasGC = ts ? [...ts].some((t) => String(t).toLowerCase() === 'greater_china') : false;
    compMeta.set(compId, {
      tier, nat: comp.iso, cont: (isoInfo.get(comp.iso) || {}).cont || 'Unknown',
      year: comp.year, gc: hasGC, name: comp.name,
    });
  }

  // 只在 333 上做主检验（样本最厚，且是权重最高的项目），全项目做辅助校验
  const MAIN_EV = '333';
  const rec = [];   // {tier, nat, cont, year, ev, field}
  for (const [k, s] of evPeople) {
    const i = k.indexOf('|');
    const compId = k.slice(0, i);
    const ev = k.slice(i + 1);
    const m = compMeta.get(compId);
    if (!m) continue;
    rec.push({ tier: m.tier, nat: m.nat, cont: m.cont, year: m.year, ev, field: s.size, gc: m.gc, compId });
  }
  console.error('[' + new Date().toISOString().slice(11, 19) + '] 组数 ' + num(rec.length));

  const L = (s) => console.log(s);
  const T = M2.TIER_BASE;

  L('# M2 方案 B 检验：锦标赛能不能「同价 + 系数」');
  L('');
  L('> 现算，源 WCA v2.0.2。脚本 `etl/score/diag_m2_tiercoef.js`。');
  L('> 主检验用 333（样本最厚）；辅助校验用全项目。');
  L('> **普通比赛（OP）** = 不在 championships.tsv 里的所有赛事（已排除多区赛）。');
  L('');

  /* ── 3 规模对照：锦标赛 vs 同属地普通比赛 ─────────────────── */
  const main = rec.filter((x) => x.ev === MAIN_EV);
  const opAll = main.filter((x) => x.tier === 'OP');
  const opGlobalMed = med(opAll.map((x) => x.field));

  L('══ 1 规模基线（333，每场唯一参赛人数）══');
  L('');
  L('| 赛级 | 场次 | 中位 | 均值 | 25% | 75% | 相对全球普通比赛 |');
  L('|---|---|---|---|---|---|---|');
  L('| OP 全球 | ' + num(opAll.length) + ' | ' + F(opGlobalMed) + ' | ' + F(mean(opAll.map((x) => x.field)))
    + ' | ' + F(quant(opAll.map((x) => x.field), 0.25)) + ' | ' + F(quant(opAll.map((x) => x.field), 0.75)) + ' | 1.0000 |');
  for (const t of ['WC', 'CC', 'NC']) {
    const g = main.filter((x) => x.tier === t);
    if (!g.length) { L('| ' + t + ' | 0 | — | — | — | — | — |'); continue; }
    const f = g.map((x) => x.field);
    const m = med(f);
    L('| ' + t + ' | ' + num(g.length) + ' | **' + F(m) + '** | ' + F(mean(f))
      + ' | ' + F(quant(f, 0.25)) + ' | ' + F(quant(f, 0.75))
      + ' | **' + F(m / opGlobalMed) + '** |');
  }
  L('');

  /* ── 4 关键检验：同属地内，锦标赛 / 普通比赛 的规模溢价 ──── */
  L('══ 2 关键检验：溢价在属地之间是常数吗 ══');
  L('');
  L('算法：对每个国家，分别取该国 NC 场次与 OP 场次的 333 参赛人数中位，');
  L('两者相除得到「该国的国锦赛溢价」；再看这些溢价在国家之间差多少。');
  L('');

  const natNC = new Map(), natOP = new Map();
  for (const x of main) {
    if (x.tier === 'NC') {
      if (!natNC.has(x.nat)) natNC.set(x.nat, []);
      natNC.get(x.nat).push(x.field);
    } else if (x.tier === 'OP') {
      if (!natOP.has(x.nat)) natOP.set(x.nat, []);
      natOP.get(x.nat).push(x.field);
    }
  }
  const natRatio = [];
  for (const [nat, a] of natNC) {
    const b = natOP.get(nat);
    if (!b || b.length < 10 || a.length < 3) continue;   // 样本太薄不做
    const mn = med(a), mo = med(b);
    if (!mo) continue;
    natRatio.push({ nat, nc: a.length, nop: b.length, fNC: mn, fOP: mo, r: mn / mo });
  }
  natRatio.sort((x, y) => y.r - x.r);

  const rs = natRatio.map((x) => x.r);
  L('满足样本门槛（NC≥3 场、OP≥10 场）的国家：**' + natRatio.length + '** 个');
  L('');
  L('| 指标 | 国锦赛溢价（NC 规模 ÷ 该国 OP 规模） |');
  L('|---|---|');
  L('| 中位 | **' + F(med(rs)) + '** |');
  L('| 均值 | ' + F(mean(rs)) + ' |');
  L('| 25% | ' + F(quant(rs, 0.25)) + ' |');
  L('| 75% | ' + F(quant(rs, 0.75)) + ' |');
  L('| 最小 | ' + F(quant(rs, 0)) + ' |');
  L('| 最大 | ' + F(quant(rs, 1)) + ' |');
  L('| **变异系数 CV** | **' + F(cv(rs)) + '** |');
  L('| 最大 ÷ 最小 | **' + F(quant(rs, 1) / Math.max(1e-9, quant(rs, 0))) + '** |');
  L('');
  L('溢价最高 8 国与最低 8 国：');
  L('');
  L('| 国家 | NC 场 | OP 场 | NC 中位人数 | OP 中位人数 | 溢价 |');
  L('|---|---|---|---|---|---|');
  for (const x of [...natRatio.slice(0, 8), ...natRatio.slice(-8)]) {
    L('| ' + x.nat + ' | ' + x.nc + ' | ' + num(x.nop) + ' | ' + F(x.fNC) + ' | ' + F(x.fOP)
      + ' | **' + F(x.r) + '** |');
  }
  L('');

  // 洲层面
  const contCC = new Map(), contOP = new Map();
  for (const x of main) {
    if (x.tier === 'CC') {
      if (!contCC.has(x.cont)) contCC.set(x.cont, []);
      contCC.get(x.cont).push(x.field);
    } else if (x.tier === 'OP') {
      if (!contOP.has(x.cont)) contOP.set(x.cont, []);
      contOP.get(x.cont).push(x.field);
    }
  }
  const contRatio = [];
  for (const [c, a] of contCC) {
    const b = contOP.get(c);
    if (!b || b.length < 30 || a.length < 5) continue;
    contRatio.push({ cont: c, n: a.length, fCC: med(a), fOP: med(b), r: med(a) / med(b) });
  }
  contRatio.sort((x, y) => y.r - x.r);

  L('洲锦赛溢价（CC 规模 ÷ 该洲 OP 规模）：');
  L('');
  L('| 洲 | CC 场 | CC 中位人数 | 该洲 OP 中位人数 | 溢价 |');
  L('|---|---|---|---|---|');
  for (const x of contRatio) {
    L('| ' + x.cont + ' | ' + num(x.n) + ' | ' + F(x.fCC) + ' | ' + F(x.fOP)
      + ' | **' + F(x.r) + '** |');
  }
  const crs = contRatio.map((x) => x.r);
  L('');
  L('洲际溢价 中位 **' + F(med(crs)) + '**，极差 ' + F(quant(crs, 0) || 0) + ' – ' + F(quant(crs, 1))
    + '，CV **' + F(cv(crs)) + '**');
  L('');

  // 世界赛溢价
  const wc = main.filter((x) => x.tier === 'WC').map((x) => x.field);
  L('世界赛溢价：WC 中位 ' + F(med(wc)) + ' ÷ 全球 OP 中位 ' + F(opGlobalMed)
    + ' = **' + F(med(wc) / opGlobalMed) + '**');
  L('');

  /* ── 5 用实测溢价反推系数 ──────────────────────────────────── */
  L('══ 3 若采用方案 B：系数该定多少 ══');
  L('');
  L('方案 B 的定义是 `分数 = P(pos) × ρ × f × w × 系数_L`，其中普通比赛 系数_OP = 1。');
  L('要让锦标赛与「同等规模的普通比赛」持平，系数就等于溢价：');
  L('');
  L('| 赛级 | 现行 T_L | 实测规模溢价（相对全球 OP） | 现行 T_L ÷ 溢价 |');
  L('|---|---|---|---|');
  const prem = { WC: med(wc) / opGlobalMed, CC: med(crs), NC: med(rs) };
  for (const t of ['WC', 'CC', 'NC']) {
    L('| ' + t + ' | ' + F(T[t]) + ' | **' + F(prem[t]) + '** | ' + F(T[t] / prem[t]) + ' |');
  }
  L('');
  L('最后一列的含义：**现行 T_L 相当于「按真实规模算完之后，再额外乘的倍数」。**');
  L('');

  /* ── 6 数学等价性 ─────────────────────────────────────────── */
  L('══ 4 方案 B 与方案 A 的数学关系 ══');
  L('');
  L('设普通比赛与国锦赛同属一个国家，那么两者的属地项 ρ 完全相同：');
  L('');
  L('```');
  L('方案 A（现行）  NC = P × T_NC × ρ × f × w');
  L('方案 B（系数）  NC = P × T_OP × ρ × f × w × 系数_NC');
  L('               OP = P × T_OP × ρ × f × w');
  L('               → 系数_NC = T_NC / T_OP');
  L('```');
  L('');
  L('**两者完全同构。** ρ 在「国锦赛 ÷ 普通比赛」的比值里被约掉了 ——');
  L('因为国锦赛和普通比赛发生在同一个国家，用的是同一个 ρ。');
  L('所以方案 B 本身**不能**修正 ρ 对国锦赛的过度折价：它只是把 T_L 拆成两个常数相乘。');
  L('');

  /* ── 7 竞争强度校验：规模不是唯一维度 ─────────────────────── */
  L('══ 5 规模之外：前 3 名的绝对水平 ══');
  L('');
  L('如果「同价 + 系数」成立，前提是锦标赛的难度差异全部由系数表达，');
  L('而系数是常数。但规模已经证明不是常数（CV ' + F(cv(rs)) + '）。再看一层：');
  L('同一级别内部，冠军成绩的离散度有多大。');
  L('');

  const champBest = new Map();   // tier → [best]
  for (const [k, arr] of evPodium) {
    const i = k.indexOf('|');
    const compId = k.slice(0, i);
    if (k.slice(i + 1) !== MAIN_EV) continue;
    const m = compMeta.get(compId);
    if (!m) continue;
    const g = arr.filter((x) => x.pos === 1);
    if (g.length !== 1) continue;
    if (!champBest.has(m.tier)) champBest.set(m.tier, []);
    champBest.get(m.tier).push(g[0].best / 100);
  }
  L('| 赛级 | 冠军数 | 冠军成绩中位 | 25% | 75% | IQR ÷ 中位 |');
  L('|---|---|---|---|---|---|');
  for (const t of ['WC', 'CC', 'NC', 'OP']) {
    const a = champBest.get(t) || [];
    if (!a.length) continue;
    const m = med(a), q1 = quant(a, 0.25), q3 = quant(a, 0.75);
    L('| ' + t + ' | ' + num(a.length) + ' | ' + m.toFixed(2) + ' 秒 | '
      + q1.toFixed(2) + ' | ' + q3.toFixed(2) + ' | ' + F((q3 - q1) / m) + ' |');
  }
  L('');

  /* ── 8 结论素材：普通比赛总量有多大 ───────────────────────── */
  L('══ 6 若把普通比赛纳入，规模有多大 ══');
  L('');
  const opCount = new Map();
  for (const x of rec) {
    if (x.tier !== 'OP') continue;
    opCount.set(x.ev, (opCount.get(x.ev) || 0) + 1);
  }
  let opTotal = 0;
  for (const [, v] of opCount) opTotal += v;
  const tierCount = { WC: 0, CC: 0, NC: 0 };
  for (const x of rec) if (tierCount[x.tier] !== undefined) tierCount[x.tier]++;
  L('| 类别 | 赛事×项目 组数 | 占比 |');
  L('|---|---|---|');
  L('| OP 普通比赛 | ' + num(opTotal) + ' | ' + PCT(opTotal / rec.length) + ' |');
  L('| WC | ' + num(tierCount.WC) + ' | ' + PCT(tierCount.WC / rec.length) + ' |');
  L('| CC | ' + num(tierCount.CC) + ' | ' + PCT(tierCount.CC / rec.length) + ' |');
  L('| NC | ' + num(tierCount.NC) + ' | ' + PCT(tierCount.NC / rec.length) + ' |');
  L('| 合计 | ' + num(rec.length) + ' | 100.00% |');
  L('');
  L('普通比赛占 **' + PCT(opTotal / rec.length) + '** 的赛事×项目组。');
  L('方案 B 要把这些全部定价，等于先做完 M3，才能谈锦标赛系数。');
  L('');
})();

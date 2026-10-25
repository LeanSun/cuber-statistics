'use strict';
/* M2 / k 的真正来路：用「赛事深度」当外部标准，反解 k
 *
 * 问题：k 是 ρ_new = ρ_属地^(1-k) × ratio^k 里的插值权重。
 *      上一版 k=0.30 是从扫描表里挑的，没有推导。
 *
 * 这里给出一个有推导的做法：
 *   外部标准 = 赛事深度（该场前三名当年全球百分位，越小越难）
 *   k 的正当值 = 「让 ρ_new 对 ln(1/深度) 解释力最强」的那个 k
 *
 * 同时回答方案 B：
 *   若 注册人口 的解释力接近 0，说明人口是错代理，规模才是 → 方案 B 成立
 *   若 两者都有解释力，说明需要混合 → 方案 A 的 k 有意义
 *
 * 用法：node --max-old-space-size=6144 etl/score/diag_m2_kgain.js
 * 只读。
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
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
    let buf = '', head = true;
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
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const quant = (a, q) => {
  if (!a.length) return 0;
  const b = a.slice().sort((x, y) => x - y);
  return b[Math.min(b.length - 1, Math.round((b.length - 1) * q))];
};

function pctOf(sorted, v) {
  let lo = 0, hi = sorted.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] < v) lo = m + 1; else hi = m; }
  return sorted.length ? lo / sorted.length : 1;
}
function corr(a, b) {
  const n = a.length; if (n < 3) return 0;
  const ma = mean(a), mb = mean(b);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = a[i] - ma, dy = b[i] - mb;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0;
}
/* 二元最小二乘：y = a + b1 x1 + b2 x2 */
function ols2(y, x1, x2) {
  const n = y.length;
  const X = [[1, x1[0], x2[0]]];
  let A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], B = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const v = [1, x1[i], x2[i]];
    for (let r = 0; r < 3; r++) {
      B[r] += v[r] * y[i];
      for (let c = 0; c < 3; c++) A[r][c] += v[r] * v[c];
    }
  }
  // 高斯消元
  const M = A.map((row, i) => [...row, B[i]]);
  for (let c = 0; c < 3; c++) {
    let p = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c] || 1e-12;
    for (let j = c; j < 4; j++) M[c][j] /= d;
    for (let r = 0; r < 3; r++) {
      if (r === c) continue;
      const f = M[r][c];
      if (!f) continue;
      for (let j = c; j < 4; j++) M[r][j] -= f * M[c][j];
    }
  }
  return [M[0][3], M[1][3], M[2][3]];
}

(async () => {
  const isoOf = new Map(), isoInfo = new Map(), contOfRaw = new Map();
  await streamTsv('WCA_export_continents.tsv', (r) =>
    contOfRaw.set(r[0], String(r[1] || r[0]).replace(/^_+/, '').trim()));
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

  const compMeta = new Map();
  for (const [compId, comp] of compInfo) {
    if (M2.isMultiRegion(comp.iso)) continue;
    const ts = ctypes.get(compId);
    compMeta.set(compId, {
      tier: ts ? M2.tierOf(ts, comp.iso) : 'OP',
      nat: comp.iso, cont: (isoInfo.get(comp.iso) || {}).cont || 'Unknown',
      year: comp.year,
    });
  }

  const best = new Map(), podi = new Map();
  await streamTsv('WCA_export_results.tsv', (r) => {
    const pid = r[8]; if (!pid) return;
    const compId = r[4];
    if (!compMeta.has(compId)) return;
    const b = +r[2]; if (!(b > 0)) return;
    const ev = r[6];
    const k3 = compId + '|' + ev + '|' + pid;
    const cur = best.get(k3);
    if (cur === undefined || b < cur) best.set(k3, b);
    const pos = +r[1];
    if (pos >= 1 && pos <= 3 && (r[5] === 'f' || r[5] === 'c')) {
      const k2 = compId + '|' + ev;
      let a = podi.get(k2); if (!a) { a = []; podi.set(k2, a); }
      a.push({ pos, best: b });
    }
  });

  const fieldOf = new Map();
  const pool = new Map();
  const EV = '333';
  for (const [k] of best) {
    const i = k.indexOf('|'); const j = k.indexOf('|', i + 1);
    const compId = k.slice(0, i), ev = k.slice(i + 1, j);
    const k2 = compId + '|' + ev;
    fieldOf.set(k2, (fieldOf.get(k2) || 0) + 1);
    if (ev !== EV) continue;
    const m = compMeta.get(compId);
    if (!m || !m.year) continue;
    const pk = ev + '|' + m.year;
    let a = pool.get(pk); if (!a) { a = []; pool.set(pk, a); }
    a.push(best.get(k));
  }
  for (const [, a] of pool) a.sort((x, y) => x - y);

  // 各国注册人数占比
  const natCount = {};
  for (const [, p] of pInfo) natCount[p.iso] = (natCount[p.iso] || 0) + 1;
  const TOTAL = pInfo.size;

  // 采样：每个 333 场次算深度 + 人数 + 人口占比
  const samples = [];
  for (const [k2, arr] of podi) {
    const i = k2.indexOf('|');
    const compId = k2.slice(0, i);
    if (k2.slice(i + 1) !== EV) continue;
    const m = compMeta.get(compId);
    if (!m || !m.year) continue;
    const p = pool.get(EV + '|' + m.year);
    if (!p || p.length < 50) continue;
    const depth = med(arr.map((x) => pctOf(p, x.best)));
    if (!(depth > 0)) continue;
    const field = fieldOf.get(k2) || 0;
    if (!field) continue;
    samples.push({ tier: m.tier, nat: m.nat, year: m.year, field, depth, pop: (natCount[m.nat] || 1) / TOTAL });
  }

  const L = (s) => console.log(s);
  const T = M2.TIER_BASE;

  L('# k 的真正来路：用赛事深度反解');
  L('');
  L('> 现算，源 WCA v2.0.2。脚本 `etl/score/diag_m2_kgain.js`。333 项目。');
  L('> 外部标准：**深度** = 前三名成绩在当年全球分布中的百分位（越小 = 越难）。');
  L('> 目标量：`y = ln(1 ÷ 深度)`，即「这场有多难」的对数。');
  L('');

  const nc = samples.filter((x) => x.tier === 'NC');
  L('══ 1 NC 样本 ══');
  L('');
  L('| 项目 | 值 |');
  L('|---|---|');
  L('| 场次 | ' + num(nc.length) + ' |');
  L('| 参赛人数 中位 / 范围 | ' + med(nc.map((x) => x.field)) + ' / '
    + quant(nc.map((x) => x.field), 0) + '–' + quant(nc.map((x) => x.field), 1) + ' |');
  L('| 注册占比 中位 / 范围 | ' + F(med(nc.map((x) => x.pop))) + ' / '
    + F(quant(nc.map((x) => x.pop), 0)) + '–' + F(quant(nc.map((x) => x.pop), 1)) + ' |');
  L('| 深度 中位 / 范围 | ' + F(med(nc.map((x) => x.depth))) + ' / '
    + F(quant(nc.map((x) => x.depth), 0)) + '–' + F(quant(nc.map((x) => x.depth), 1)) + ' |');
  L('');

  const y = nc.map((x) => Math.log(1 / x.depth));
  const lpop = nc.map((x) => Math.log(Math.max(1e-9, x.pop)));
  const lfld = nc.map((x) => Math.log(Math.max(1, x.field)));

  L('══ 2 单变量解释力 ══');
  L('');
  L('| 自变量 | 与 ln(1/深度) 的相关系数 | R² |');
  L('|---|---|---|');
  const cPop = corr(lpop, y), cFld = corr(lfld, y);
  L('| ln(注册人口占比) | **' + F(cPop) + '** | ' + F(cPop * cPop) + ' |');
  L('| ln(该场参赛人数) | **' + F(cFld) + '** | ' + F(cFld * cFld) + ' |');
  L('');
  L('哪个绝对值大，哪个就是更好的「难度代理」。');
  L('');

  L('══ 3 二元回归：两个代理各占多少 ══');
  L('');
  const [a, b1, b2] = ols2(y, lpop, lfld);
  L('```');
  L('ln(1/深度) = ' + F(a) + ' + ' + F(b1) + ' · ln(注册占比) + ' + F(b2) + ' · ln(参赛人数)');
  L('```');
  L('');
  L('弹性之和 = ' + F(b1 + b2) + '；其中参赛人数占 **' + F(b2 / (b1 + b2)) + '**，注册人口占 '
    + F(b1 / (b1 + b2)));
  L('');
  L('若「弹性占比」就是 k，则：**k = ' + F(b2 / (b1 + b2)) + '**');
  L('');

  L('══ 4 直接扫 k：哪个 k 让 ρ_new 与真实难度最吻合 ══');
  L('');
  L('ρ_new(k) = 注册占比^(1-k) × (参赛人数 ÷ 世锦赛人数)^k');
  L('');
  const wcFld = med(samples.filter((x) => x.tier === 'WC').map((x) => x.field)) || 373.5;
  L('世锦赛 333 人数基准 = ' + wcFld + ' 人（' + samples.filter((x) => x.tier === 'WC').length + ' 场中位）');
  L('');
  L('| k | ρ_new 与 ln(1/深度) 的相关 | R² | RMSE（对数尺度） |');
  L('|---|---|---|---|');
  const rows = [];
  for (let ki = 0; ki <= 20; ki++) {
    const k = ki / 20;
    const lr = nc.map((x) => (1 - k) * Math.log(Math.max(1e-9, x.pop)) + k * Math.log(Math.max(1e-9, x.field / wcFld)));
    const c = corr(lr, y);
    // RMSE：把 lr 线性映射到 y 后取残差
    const ml = mean(lr), my = mean(y);
    const bl = corr(lr, y) * Math.sqrt(mean(y.map((v) => (v - my) ** 2)) / Math.max(1e-12, mean(lr.map((v) => (v - ml) ** 2))));
    const al = my - bl * ml;
    let ss = 0;
    for (let i = 0; i < y.length; i++) ss += (y[i] - (al + bl * lr[i])) ** 2;
    const rmse = Math.sqrt(ss / y.length);
    rows.push({ k, c, r2: c * c, rmse });
    if (ki % 2 === 0) {
      L('| ' + k.toFixed(2) + ' | ' + F(c) + ' | ' + F(c * c) + ' | ' + F(rmse) + ' |');
    }
  }
  const bestRow = rows.reduce((p, q) => (q.r2 > p.r2 ? q : p), rows[0]);
  L('');
  L('**R² 最大的是 k = ' + bestRow.k.toFixed(2) + '（R² = ' + F(bestRow.r2) + '，相关 '
    + F(bestRow.c) + '）**');
  L('');
  L('对照：');
  L('');
  const row = (k) => rows.find((r) => Math.abs(r.k - k) < 1e-9) || rows.reduce((p, q) => (Math.abs(q.k - k) < Math.abs(p.k - k) ? q : p), rows[0]);
  L('| k | 含义 | R² | 与最优的差距 |');
  L('|---|---|---|---|');
  L('| 0.00 | 纯注册人口（现行） | ' + F(row(0).r2) + ' | ' + F(row(0).r2 - bestRow.r2) + ' |');
  L('| 0.30 | 上一版挑的值 | ' + F(row(0.3).r2) + ' | ' + F(row(0.3).r2 - bestRow.r2) + ' |');
  L('| 1.00 | 纯参赛人数 | ' + F(row(1).r2) + ' | ' + F(row(1).r2 - bestRow.r2) + ' |');
  L('');

  L('══ 5 方案 B 检验：系数是不是常数 ══');
  L('');
  L('方案 B：锦标赛 = 同规模普通比赛 × 系数_L。');
  L('若系数是常数，则「锦标赛价格 ÷ 同规模普通比赛价格」在各国应当一致。');
  L('用真实难度当尺子：某级别的应得价格 ∝ 1/深度。');
  L('');
  L('| 赛级 | 场次 | 参赛人数中位 | 深度中位 | 应得价（WC=1） | 规模溢价（÷全球OP） | 系数 = 应得 ÷ 规模 |');
  L('|---|---|---|---|---|---|---|');
  const opSamp = samples.filter((x) => x.tier === 'OP');
  const dOP = med(opSamp.map((x) => x.depth));
  const fOP = med(opSamp.map((x) => x.field));
  const dWC = med(samples.filter((x) => x.tier === 'WC').map((x) => x.depth));
  for (const t of ['NC', 'CC', 'WC']) {
    const g = samples.filter((x) => x.tier === t);
    if (!g.length) continue;
    const d = med(g.map((x) => x.depth));
    const f = med(g.map((x) => x.field));
    const deserved = dWC / d;           // 以 WC=1
    const prem = f / fOP;               // 相对全球普通比赛
    L('| ' + t + ' | ' + num(g.length) + ' | ' + f + ' | ' + F(d) + ' | ' + F(deserved)
      + ' | ' + F(prem) + ' | **' + F(deserved / prem) + '** |');
  }
  L('');
  L('最后一列若各级一致 → 系数是常数，方案 B 成立。');
  L('');

  L('══ 6 结论素材：三个 k 对应的价格 ══');
  L('');
  L('| 赛级 | k=0（现行 ρ） | k=0.30 | k=' + bestRow.k.toFixed(2) + '（最优） | k=1.00 | 深度应得 |');
  L('|---|---|---|---|---|---|');
  for (const t of ['NC', 'CC', 'WC']) {
    const g = samples.filter((x) => x.tier === t);
    if (!g.length) continue;
    const pop = med(g.map((x) => x.pop));
    const fld = med(g.map((x) => x.field));
    const cell = (k) => {
      const rho = Math.pow(pop, 1 - k) * Math.pow(fld / wcFld, k);
      return F(T[t] * (t === 'WC' ? 1 : rho));
    };
    const d = med(g.map((x) => x.depth));
    L('| ' + t + ' | ' + cell(0) + ' | ' + cell(0.3) + ' | **' + cell(bestRow.k) + '** | '
      + cell(1) + ' | ' + F(dWC / d) + ' |');
  }
  L('');
  L('（WC 恒为 1.0000，因为 ρ 对它不起作用；「深度应得」以 WC=1 为基准。）');
  L('');

  /* ── 7 决定性检验：控制规模后，锦标赛还更难吗 ───────────── */
  L('══ 7 决定性检验：同规模下，锦标赛是否额外更难 ══');
  L('');
  L('方案 B 若需「锦标赛系数」，前提是：**规模相同**时，锦标赛的前三名仍强于普通比赛。');
  L('若同规模下毫无差异，则赛级差异全部由规模解释，系数是多余的。');
  L('');
  const BINS = [[0, 40], [40, 60], [60, 90], [90, 140], [140, 220], [220, 350], [350, 2000]];
  L('| 人数区间 | OP 场次 | OP 深度 | NC 场次 | NC 深度 | CC 场次 | CC 深度 | WC 场次 | WC 深度 |');
  L('|---|---|---|---|---|---|---|---|---|');
  for (const [lo, hi] of BINS) {
    const inBin = (t) => samples.filter((x) => x.tier === t && x.field >= lo && x.field < hi);
    const cells = [];
    let any = false;
    for (const t of ['OP', 'NC', 'CC', 'WC']) {
      const g = inBin(t);
      if (g.length >= 3) { any = true; cells.push(num(g.length) + ' | ' + F(med(g.map((x) => x.depth)))); }
      else cells.push(g.length ? g.length + ' | —' : '— | —');
    }
    if (any) L('| ' + lo + '–' + (hi > 1000 ? '∞' : hi) + ' | ' + cells.join(' | ') + ' |');
  }
  L('');
  L('读法：在同一行（规模相同）里横向比深度。若锦标赛的深度显著更小，说明有额外价值。');
  L('');

  // 控制规模后的偏效应：以 ln(1/深度) 对 ln(人数) + 是否锦标赛 做回归
  const ctrl = samples.filter((x) => x.tier === 'OP' || x.tier === 'NC');
  const yc = ctrl.map((x) => Math.log(1 / x.depth));
  const xf = ctrl.map((x) => Math.log(Math.max(1, x.field)));
  const xt = ctrl.map((x) => (x.tier === 'NC' ? 1 : 0));
  const [ca, cb1, cb2] = ols2(yc, xf, xt);
  L('控制规模后的回归（只用 OP + NC，样本 ' + num(ctrl.length) + '）：');
  L('');
  L('```');
  L('ln(1/深度) = ' + F(ca) + ' + ' + F(cb1) + ' · ln(人数) + ' + F(cb2) + ' · 是否国锦赛');
  L('```');
  L('');
  L('规模弹性 ' + F(cb1) + '；**国锦赛的额外效应 ' + F(cb2) + '（对数尺度）**');
  L('换算成倍数：同规模下，国锦赛的难度是普通比赛的 **' + F(Math.exp(cb2)) + ' 倍**。');
  L('');
  L('若这个倍数接近 1.0000，则「锦标赛系数」确实多余；');
  L('若明显大于 1，则需要在规模之外再乘一个系数。');
  L('');
})();

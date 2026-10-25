'use strict';
/* M2 赛事深度检验：一场比赛的前 3 名，放到当年全球是什么水平？
 *
 * 为什么不用「参赛人数」当含金量：
 *   一场 300 人的比赛，如果 290 人是新手，冠军仍然是全国前 5；
 *   一场 80 人的比赛，如果 20 人是世界前 50，冠军比前者难得多。
 *   参赛人数只回答「有多少人」，不回答「多强的人在比」。
 *
 * 这里的指标：**前三名深度** = 该场前三名的成绩，在「该项目当年全球全部成绩」
 * 分布中的百分位（越小越靠前）。取前三名的中位。
 *
 * 用法：node --max-old-space-size=6144 etl/score/diag_m2_depth.js
 * 只读。不改 m2.js，不改任何常量。
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
  return Math.sqrt(mean(a.map((x) => (x - m) * (x - m)))) / m;
};

/* 在已排序数组里二分，返回「有多少个值严格小于 v」的比例 */
function pctOf(sorted, v) {
  let lo = 0, hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < v) lo = mid + 1; else hi = mid;
  }
  return sorted.length ? lo / sorted.length : 1;
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
    compInfo.set(r[0], {
      name: r[1] || r[0], year: +r[14] || 0,
      iso: (isoOf.get(r[6]) || '').toUpperCase(),
    });
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
      year: comp.year, name: comp.name,
    });
  }

  /* ── 扫 results ─────────────────────────────────────────────
   * pool:  "ev|year" → [best]        当年该项目全球全部成绩（用于算百分位）
   * podi:  "compId|ev" → [{pos,best,pid}]
   * 同一 (compId, ev, pid) 只保留最好的一次，避免多轮重复计入。
   */
  const best = new Map();     // "compId|ev|pid" → best（分）
  const podi = new Map();     // "compId|ev" → [{pos,best,pid}]
  let rows = 0;

  await streamTsv('WCA_export_results.tsv', (r) => {
    const pid = r[8]; if (!pid) return;
    const compId = r[4];
    if (!compMeta.has(compId)) return;
    const b = +r[2];
    if (!(b > 0)) return;
    const ev = r[6];
    const k3 = compId + '|' + ev + '|' + pid;
    const cur = best.get(k3);
    if (cur === undefined || b < cur) best.set(k3, b);

    const pos = +r[1];
    if (pos >= 1 && pos <= 3 && (r[5] === 'f' || r[5] === 'c')) {
      const k2 = compId + '|' + ev;
      let a = podi.get(k2);
      if (!a) { a = []; podi.set(k2, a); }
      a.push({ pos, best: b, pid });
    }
    rows++;
  });
  console.error('[1] results ' + num(rows) + ' 行，唯一成绩 ' + num(best.size));

  /* 全球当年池 */
  const pool = new Map();     // "ev|year" → [best]（已去重到人）
  const evs = ['333', '222', '444', '555', '666', '777', '333oh', '333bf', 'pyram', 'skewb'];
  const evSet = new Set(evs);
  for (const [k, b] of best) {
    const i = k.indexOf('|');
    const compId = k.slice(0, i);
    const rest = k.slice(i + 1);
    const j = rest.indexOf('|');
    const ev = rest.slice(0, j);
    if (!evSet.has(ev)) continue;
    const m = compMeta.get(compId);
    if (!m || !m.year) continue;
    const pk = ev + '|' + m.year;
    let a = pool.get(pk);
    if (!a) { a = []; pool.set(pk, a); }
    a.push(b);
  }
  for (const [, a] of pool) a.sort((x, y) => x - y);
  console.error('[2] 全球池 ' + num(pool.size) + ' 个 项目×年');

  /* 每场每项目的参赛人数：best 的键按 compId|ev 聚合即可（已去重到人） */
  const fieldOf = new Map();     // "compId|ev" → 人数
  for (const k of best.keys()) {
    const i = k.indexOf('|');
    const j = k.indexOf('|', i + 1);
    const k2 = k.slice(0, i) + '|' + k.slice(i + 1, j);
    fieldOf.set(k2, (fieldOf.get(k2) || 0) + 1);
  }

  const L = (s) => console.log(s);
  const MAIN = '333';

  L('# M2 赛事深度检验：锦标赛的「含金量」到底差多少');
  L('');
  L('> 现算，源 WCA v2.0.2。脚本 `etl/score/diag_m2_depth.js`。');
  L('> **深度** = 该场前三名成绩在「该项目当年全球全部成绩」中的百分位中位。');
  L('> 百分位 0.0010 表示「比当年全球前 0.1% 还快」；0.1000 表示「全球前 10%」。');
  L('');

  /* ── 1 各级别的深度 ─────────────────────────────────────── */
  const rowsOut = [];
  for (const [k2, arr] of podi) {
    const i = k2.indexOf('|');
    const compId = k2.slice(0, i);
    const ev = k2.slice(i + 1);
    if (ev !== MAIN) continue;
    const m = compMeta.get(compId);
    if (!m || !m.year) continue;
    const p = pool.get(ev + '|' + m.year);
    if (!p || p.length < 50) continue;
    const ps = arr.map((x) => pctOf(p, x.best));
    if (!ps.length) continue;
    rowsOut.push({
      tier: m.tier, nat: m.nat, cont: m.cont, year: m.year,
      depth: med(ps), best3: med(arr.map((x) => x.best / 100)),
      n: fieldOf.get(k2) || 0,
      top3: arr.filter((x) => x.pos <= 3).length,
    });
  }
  console.error('[3] 有效场次（333）' + num(rowsOut.length));

  L('══ 1 各级别深度（333，前三名全球百分位中位）══');
  L('');
  L('| 赛级 | 场次 | 深度（中位） | 均值 | 25% | 75% | 冠军成绩中位 |');
  L('|---|---|---|---|---|---|---|');
  L('| **OP 普通比赛** | ' + num(rowsOut.filter((x) => x.tier === 'OP').length) + ' | **'
    + F(med(rowsOut.filter((x) => x.tier === 'OP').map((x) => x.depth))) + '** | '
    + F(mean(rowsOut.filter((x) => x.tier === 'OP').map((x) => x.depth))) + ' | '
    + F(quant(rowsOut.filter((x) => x.tier === 'OP').map((x) => x.depth), 0.25)) + ' | '
    + F(quant(rowsOut.filter((x) => x.tier === 'OP').map((x) => x.depth), 0.75)) + ' | '
    + med(rowsOut.filter((x) => x.tier === 'OP').map((x) => x.best3)).toFixed(2) + ' 秒 |');
  for (const t of ['NC', 'CC', 'WC']) {
    const g = rowsOut.filter((x) => x.tier === t);
    if (!g.length) { L('| ' + t + ' | 0 | — | — | — | — | — |'); continue; }
    const d = g.map((x) => x.depth);
    L('| **' + t + '** | ' + num(g.length) + ' | **' + F(med(d)) + '** | ' + F(mean(d))
      + ' | ' + F(quant(d, 0.25)) + ' | ' + F(quant(d, 0.75))
      + ' | ' + med(g.map((x) => x.best3)).toFixed(2) + ' 秒 |');
  }
  L('');

  const dOP = med(rowsOut.filter((x) => x.tier === 'OP').map((x) => x.depth));
  const dOf = (t) => med(rowsOut.filter((x) => x.tier === t).map((x) => x.depth));

  L('深度越**小**越难（百分位越靠前）。各级别相对普通比赛：');
  L('');
  L('| 赛级 | 深度 | 相对 OP | 解读 |');
  L('|---|---|---|---|');
  for (const t of ['NC', 'CC', 'WC']) {
    const d = dOf(t);
    L('| ' + t + ' | ' + F(d) + ' | ' + F(d / dOP) + ' | 前三名水平相当于普通比赛前 '
      + F(d / dOP * 100) + '% 的位置 |');
  }
  L('');

  /* ── 2 换算成「该值多少分」 ─────────────────────────────── */
  L('══ 2 用深度反推「含金量倍数」══');
  L('');
  L('口径：含金量 ∝ 1 ÷ 深度（越难 = 越值钱）。以普通比赛 = 1.0000 为基准。');
  L('');
  L('| 赛级 | 深度 | 含金量倍数（1÷深度，再对 OP 归一） | 现行 T_L | 现行 T_L ÷ 应得 |');
  L('|---|---|---|---|---|');
  const T = M2.TIER_BASE;
  const mOP = 1 / dOP;
  const gain = { OP: 1 };
  for (const t of ['NC', 'CC', 'WC']) {
    const g = (1 / dOf(t)) / mOP;
    gain[t] = g;
    L('| ' + t + ' | ' + F(dOf(t)) + ' | **' + F(g) + '** | ' + F(T[t]) + ' | '
      + (t === 'OP' ? '—' : '**' + F(T[t] / g) + '**') + ' |');
  }
  L('');
  L('**这张表就是「是否过度降低洲/国锦赛含金量」的正面回答。**');
  L('最后一列接近 1.0000 说明现行定价合理；小于 1 说明给少了。');
  L('');

  /* ── 3 国与国之间：溢价是常数吗 ─────────────────────────── */
  L('══ 3 国锦赛：各国深度差异有多大 ══');
  L('');
  const natNC = new Map();
  for (const x of rowsOut) {
    if (x.tier !== 'NC') continue;
    if (!natNC.has(x.nat)) natNC.set(x.nat, []);
    natNC.get(x.nat).push(x);
  }
  const natList = [];
  for (const [nat, a] of natNC) {
    if (a.length < 3) continue;
    natList.push({ nat, n: a.length, depth: med(a.map((x) => x.depth)) });
  }
  natList.sort((x, y) => x.depth - y.depth);
  L('满足 ≥3 场门槛的国家：**' + natList.length + '** 个');
  L('');
  L('| 指标 | 国锦赛深度 |');
  L('|---|---|');
  const dv = natList.map((x) => x.depth);
  L('| 中位 | ' + F(med(dv)) + ' |');
  L('| 最小（最难） | ' + F(quant(dv, 0)) + ' |');
  L('| 最大（最易） | ' + F(quant(dv, 1)) + ' |');
  L('| 最大 ÷ 最小 | **' + F(quant(dv, 1) / Math.max(1e-9, quant(dv, 0))) + '** |');
  L('| 变异系数 CV | ' + F(cv(dv)) + ' |');
  L('');
  L('最难 10 国与最易 10 国：');
  L('');
  L('| 国家 | 场次 | 深度 | 相当于普通比赛的 |');
  L('|---|---|---|---|');
  for (const x of [...natList.slice(0, 10), ...natList.slice(-10)]) {
    L('| ' + x.nat + ' | ' + x.n + ' | ' + F(x.depth) + ' | ' + F(x.depth / dOP * 100) + '% |');
  }
  L('');

  /* ── 4 洲际 ─────────────────────────────────────────────── */
  L('══ 4 洲锦赛：各洲深度 ══');
  L('');
  const contCC = new Map();
  for (const x of rowsOut) {
    if (x.tier !== 'CC') continue;
    if (!contCC.has(x.cont)) contCC.set(x.cont, []);
    contCC.get(x.cont).push(x.depth);
  }
  L('| 洲 | 场次 | 深度 | 相对 OP |');
  L('|---|---|---|---|');
  for (const [c, a] of [...contCC].sort((x, y) => med(x[1]) - med(y[1]))) {
    L('| ' + c + ' | ' + a.length + ' | ' + F(med(a)) + ' | ' + F(med(a) / dOP) + ' |');
  }
  L('');

  /* ── 5 人数 vs 深度：谁更能解释难度 ─────────────────────── */
  L('══ 5 参赛人数还是赛事深度：谁才是含金量 ══');
  L('');
  L('对同一批场次，算「参赛人多」和「前三名强」的相关性。若两者高度相关，');
  L('用人数当代理就够了；若弱相关，人数就是错的代理。');
  L('');
  const both = rowsOut.filter((x) => x.n > 0);
  const corr = (a, b) => {
    const n = a.length;
    if (n < 3) return 0;
    const ma = mean(a), mb = mean(b);
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < n; i++) {
      const dx = a[i] - ma, dy = b[i] - mb;
      sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
    }
    return sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0;
  };
  const lnDepth = both.map((x) => Math.log(Math.max(1e-9, x.depth)));
  const lnBest = both.map((x) => Math.log(Math.max(1, x.best3)));
  L('| 关系 | 相关系数 |');
  L('|---|---|');
  L('| ln(参赛人数) vs ln(深度) | **' + F(corr(both.map((x) => Math.log(Math.max(1, x.n))), lnDepth)) + '** |');
  L('| ln(冠军成绩) vs ln(深度) | **' + F(corr(lnBest, lnDepth)) + '** |');
  L('| ln(参赛人数) vs ln(冠军成绩) | ' + F(corr(both.map((x) => Math.log(Math.max(1, x.n))), lnBest)) + ' |');
  L('');
  L('注：深度是「成绩在全球分布的位置」，冠军成绩越快深度越小，所以后两行应为强正相关。');
  L('第一行才是关键：如果参赛人数与深度只有弱相关，那「按人数定价」就抓错了维度。');
  L('');

  /* ── 6 结论素材 ─────────────────────────────────────────── */
  L('══ 6 三种口径的对照 ══');
  L('');
  L('| 口径 | NC 相对 WC | CC 相对 WC | 说明 |');
  L('|---|---|---|---|');
  const byTier = (t) => rowsOut.filter((x) => x.tier === t);
  const nOf = (t) => byTier(t).length ? med(byTier(t).map((x) => x.n)) : 0;
  L('| 口径 | NC 相对 WC | CC 相对 WC | 说明 |');
  L('|---|---|---|---|');
  L('| 现行 T_L × ρ（注册人数） | ' + F((T.NC * 0.0073) / T.WC) + ' | ' + F((T.CC * 0.2375) / T.WC) + ' | 当前实际单价 |');
  L('| 纯参赛人数 | ' + F(nOf('NC') / nOf('WC')) + ' | ' + F(nOf('CC') / nOf('WC')) + ' | 三阶中位人数比 |');
  L('| 纯赛事深度 | ' + F(dOf('WC') / dOf('NC')) + ' | ' + F(dOf('WC') / dOf('CC')) + ' | 前三名水平比 |');
  L('');
  L('三种口径给出的答案差了几个量级。这就是这次要定的事。');
  L('');
})();

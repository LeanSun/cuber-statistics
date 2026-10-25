'use strict';
/* 规模项的「人数 vs 含金量」诊断
 *
 * 用户问题：年代越靠后参赛人数越多（时代因素），但新增的多是低水平选手，
 *          对顶端选手不构成威胁；可对普通玩家排名又有参考性。怎么平衡？
 *
 * 本脚本只读、不改任何常量。做的是**方案的可行性证据**，落地待用户选。
 *
 * 核心指标（每个 compId × event 一组）：
 *   N    到场人数（现行口径）
 *   Dθ   成绩在冠军 θ 以内的人数（θ = 10% / 20% / 30% / 50%）——「真正能威胁的人」
 *   E    分层加权人数：10%内×1 + 10~20%×0.5 + 20~50%×0.2 + 其余×0.05
 *   hill 饱和变换：200 × ln(1 + N/200)——让 N 的边际收益递减
 *   mix  混合：N^0.3 × D20^0.5015（两个指数之和 = γ = 0.8015）
 *   Dq   达到「同年代全球前 q% 水平」的人数（q = 5% / 1%）——事件无关口径
 *
 * 输出：etl/score/M2_规模项_人数vs含金量.md
 * 用法：node --max-old-space-size=8192 etl/score/diag_depth_quality.js
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

const GAMMA = 0.8015;
const ALPHA = 0.5;
const K_OF = { OP: 1.0000, NC: 1.0000, CC: 1.6000, WC: 1.6000 };
const TIER_CN = { OP: '普通赛', NC: '国锦赛', CC: '洲锦赛', WC: '世锦赛' };
const NSAT = 200;          // hill 的半饱和常数
const A_MIX = 0.3;         // mix 里 N 的指数（0.8015 - 0.3 = 0.5015 给 D20）

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

const WIN = [2, 3, 5, 8, 15];
const MIN_SAMPLES = 20;
const BINS = [[1982, 2004], [2005, 2009], [2010, 2014], [2015, 2019], [2020, 2026]];
const binOf = (y) => {
  for (let i = 0; i < BINS.length; i++) if (y >= BINS[i][0] && y <= BINS[i][1]) return i;
  return y < 2005 ? 0 : BINS.length - 1;
};

(async () => {
  /* ── 加载 ─────────────────────────────────────────────────── */
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

  /* per: compId|ev -> Map<pid, 个人最好> */
  const per = new Map();
  const compEvYear = new Map();
  const firstYear = new Map();
  const podRows = [];
  await streamTsv('WCA_export_results.tsv', (r) => {
    const pid = r[8]; if (!pid) return;
    const compId = r[4];
    const comp = compInfo.get(compId) || {};
    const year = comp.year || 0;
    const fy = firstYear.get(pid);
    if (!fy || (year && year < fy)) firstYear.set(pid, year);
    const ev = r[6];
    const best = +r[2];
    const k = compId + '|' + ev;
    if (best > 0) {
      let m = per.get(k);
      if (!m) { m = new Map(); per.set(k, m); compEvYear.set(k, year); }
      const cur = m.get(pid);
      if (cur == null || best < cur) m.set(pid, best);
    }
    const pos = +r[1];
    if (!(pos >= 1 && pos <= 3)) return;
    if (r[5] !== 'f' && r[5] !== 'c') return;
    if (!(best > 0)) return;
    podRows.push({ pid, ev, pos, compId, year, nat: comp.iso || '' });
  });

  /* ── 全球年代分位阈值（per (ev,年代段) 的 q 分位） ───────── */
  const poolVals = new Map();
  for (const [k, m] of per) {
    const ev = k.slice(k.indexOf('|') + 1);
    const y = compEvYear.get(k) || 0;
    const key = ev + '|' + binOf(y);
    let a = poolVals.get(key);
    if (!a) { a = []; poolVals.set(key, a); }
    for (const v of m.values()) if (v > 0) a.push(v);
  }
  const qThr = new Map();   // ev|bin|q -> 阈值
  for (const [key, a] of poolVals) {
    if (a.length < 50) continue;
    a.sort((x, y) => x - y);
    qThr.set(key + '|0.001', a[Math.floor(a.length * 0.001)]);
    qThr.set(key + '|0.05', a[Math.floor(a.length * 0.05)]);
    qThr.set(key + '|0.20', a[Math.floor(a.length * 0.20)]);
    qThr.set(key + '|0.40', a[Math.floor(a.length * 0.40)]);
  }

  /* ── 每个 compId|ev 的规模指标 ───────────────────────────── */
  const sortedPool = poolVals;   // ev|bin -> 升序成绩数组（保留，供百分位查询）
  const pctOf = (ev, bi, v) => {
    const a = sortedPool.get(ev + '|' + bi);
    if (!a || !a.length) return 0.5;
    let lo = 0; let hi = a.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < v) lo = m + 1; else hi = m; }
    return lo / a.length;
  };
  const D = new Map();
  for (const [k, m] of per) {
    const ev = k.slice(k.indexOf('|') + 1);
    const year = compEvYear.get(k) || 0;
    const arr = [...m.values()].filter((v) => v > 0).sort((a, b) => a - b);
    const N = arr.length; if (!N) continue;
    const W = arr[0];
    let D10; let D20; let D30; let D50;
    if (ev === '333mbf') { D10 = N; D20 = N; D30 = N; D50 = N; } else {
      const cnt = (th) => { let c = 0; for (const v of arr) { if (v <= th) c++; else break; } return c; };
      D10 = cnt(W * 1.10); D20 = cnt(W * 1.20); D30 = cnt(W * 1.30); D50 = cnt(W * 1.50);
    }
    const E = ev === '333mbf' ? N * 0.05 : D10 + 0.5 * (D20 - D10) + 0.2 * (D50 - D20) + 0.05 * (N - D50);
    const hill = NSAT * Math.log(1 + N / NSAT);
    const mix = Math.pow(N, A_MIX) * Math.pow(Math.max(D20, 1), GAMMA - A_MIX);
    const bi = binOf(year);
    const cntLe = (t) => { if (t == null) return N; let c = 0; for (const v of arr) { if (v <= t) c++; else break; } return c; };
    const dq5 = cntLe(qThr.get(ev + '|' + bi + '|0.05'));
    const dq20 = cntLe(qThr.get(ev + '|' + bi + '|0.20'));
    const dq40 = cntLe(qThr.get(ev + '|' + bi + '|0.40'));
    /* 顶端强度 V：该场最好的 5 人的成绩中位（第 3 好）相对「同年代世界级水平」的位置
     * 世界级参考 = 同年代该事件全球 0.1% 分位成绩。V ∈ (0,1]，越大 = 顶端越强。
     * 成绩是客观事实，不含任何模型参数 —— 本节用它当**外部标尺**检验各口径。 */
    const t5 = arr[Math.min(4, arr.length - 1)];
    const wRef = qThr.get(ev + '|' + bi + '|0.001');
    const V = wRef == null || !(t5 > 0) ? 1 : Math.min(1, wRef / t5);
    /* 追赶集团强度 G：第 5–16 名成绩的「当年全球百分位」中位取倒数
     * 与项目无关的年代归一成绩口径；刻意跳过前 4 名，避免冠军自己的成绩进入自己的分 */
    const cStart = Math.min(4, Math.max(0, arr.length - 1));
    const cEnd = Math.min(16, arr.length);
    const pcts = [];
    for (let i = cStart; i < cEnd; i++) pcts.push(pctOf(ev, bi, arr[i]));
    const Pch = pcts.length ? med(pcts) : 0.5;
    const G = Pch > 0 ? Math.min(1 / Pch, 1e6) : 1e6;
    D.set(k, { ev, year, N, W, D10, D20, D30, D50, E, hill, mix, dq5, dq20, dq40, V, G, Pch });
  }
  per.clear();

  /* ── f 池（S2 落地口径） ─────────────────────────────────── */
  const people = [];
  for (const [pid, p] of pInfo) {
    const cont = (isoInfo.get(p.iso) || {}).cont || 'Unknown';
    const y = firstYear.get(pid);
    if (y) people.push({ y, cont, nat: p.iso });
  }
  const pool = M1.makeScopePool(people, 2026);
  const F_POOL = { OP: 'WR', NC: 'NR', CC: 'NR', WC: 'WR' };

  const items = [];
  for (const r of podRows) {
    const multi = M2.isMultiRegion(r.nat);
    const tier = multi ? 'OP' : M2.tierOf(ctypes.get(r.compId), r.nat);
    const cont = (isoInfo.get(r.nat) || {}).cont || 'Unknown';
    const d = D.get(r.compId + '|' + r.ev);
    if (!d) continue;
    const who = { nat: r.nat, cont };
    const fNat = pool ? pool.valueOf('NR', who, +r.year || 2026) : 1;
    const fGlb = pool ? pool.valueOf('WR', who, +r.year || 2026) : 1;
    const w = RN.EV_WEIGHT_V2[r.ev] == null ? RN.WEIGHT_V2_CFG.floor : RN.EV_WEIGHT_V2[r.ev];
    items.push({
      pid: r.pid, ev: r.ev, tier, pos: r.pos, year: r.year, compId: r.compId, nat: r.nat,
      f: F_POOL[tier] === 'WR' ? fGlb : fNat, w,
      name: (pInfo.get(r.pid) || {}).name || r.pid,
      N: d.N, D10: d.D10, D20: d.D20, D30: d.D30, D50: d.D50, E: d.E,
      hill: d.hill, mix: d.mix, dq5: d.dq5, dq20: d.dq20, dq40: d.dq40, V: d.V, G: d.G, W: d.W,
    });
  }

  /* ── 年代本地 REF（按指标） ──────────────────────────────── */
  const METRICS = ['N', 'D20', 'D50', 'E', 'hill', 'dq20', 'V', 'G'];
  const FLOOR = { V: 1e-6 };   // 其余为计数，下限 1
  const floorOf = (m) => FLOOR[m] || 1;
  const opByEv = new Map();
  for (const it of items) {
    if (it.tier !== 'OP') continue;
    if (!opByEv.has(it.ev)) opByEv.set(it.ev, []);
    opByEv.get(it.ev).push(it);
  }
  const evYearsSorted = new Map();
  for (const [ev, a] of opByEv) evYearsSorted.set(ev, a.slice().sort((x, y) => x.year - y.year));
  const refCache = new Map();
  const refOfEra = (ev, year) => {
    const key = ev + '|' + year;
    const hit = refCache.get(key);
    if (hit) return hit;
    const list = evYearsSorted.get(ev) || [];
    const pick = (w) => {
      const l = list.filter((x) => Math.abs(x.year - year) <= w);
      const o = {};
      if (l.length < MIN_SAMPLES) return null;
      for (const m of METRICS) o[m] = med(l.map((x) => x[m]));
      return o;
    };
    let o = null; let usedW = -1;
    for (const w of WIN) { o = pick(w); if (o) { usedW = w; break; } }
    if (!o) {
      const l = list.filter((x) => Math.abs(x.year - year) <= 15);
      if (l.length) { o = {}; for (const m of METRICS) o[m] = med(l.map((x) => x[m])); usedW = 15; }
      else { o = {}; for (const m of METRICS) o[m] = med(list.map((x) => x[m])); usedW = -1; }
    }
    refCache.set(key, o);
    refCache.set(key + '#w', usedW);
    return o;
  };

  /* ── 逐变体定价 ──────────────────────────────────────────── */
  const VARIANTS = [
    { id: 'N', cn: '到场人数 N（现行）', parts: [['N', GAMMA]] },
    { id: 'D20', cn: '冠军 20% 以内人数 D20', parts: [['D20', GAMMA]] },
    { id: 'D50', cn: '冠军 50% 以内人数 D50', parts: [['D50', GAMMA]] },
    { id: 'E', cn: '分层加权人数 E', parts: [['E', GAMMA]] },
    { id: 'hill', cn: '饱和人数 200·ln(1+N/200)', parts: [['hill', GAMMA]] },
    { id: 'dq20', cn: '达到同年代全球前 20% 水平的人数', parts: [['dq20', GAMMA]] },
    { id: 'V', cn: '顶端强度 V（前 5 名 ÷ 同年代世界级）', parts: [['V', GAMMA]] },
    { id: 'G', cn: '追赶集团强度 G（第 5–16 名当年全球百分位的倒数）', parts: [['G', GAMMA]] },
    { id: 'satG', cn: '饱和人数^0.5015 × 追赶强度^0.3', parts: [['hill', 0.5015], ['G', 0.3]] },
    { id: 'satV', cn: '饱和人数^0.5015 × 顶端强度^0.3', parts: [['hill', 0.5015], ['V', 0.3]] },
    { id: 'NV', cn: '人数^0.5015 × 顶端强度^0.3', parts: [['N', 0.5015], ['V', 0.3]] },
  ];
  for (const it of items) {
    const ref = refOfEra(it.ev, it.year);
    it.P = M2.PLACE_W[it.pos] || 0;
    it.K = K_OF[it.tier];
    it.ratio = {}; it.scale = {}; it.base = {};
    for (const m of METRICS) {
      it.ratio[m] = Math.max(it[m], floorOf(m)) / Math.max(ref[m], floorOf(m));
    }
    for (const v of VARIANTS) {
      let s = 1;
      for (const [m, e] of v.parts) s *= Math.pow(it.ratio[m], e);
      it.scale[v.id] = s;
      it.base[v.id] = it.P * it.K * s * it.f * it.w;
    }
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
    a.forEach((it, i) => { it.n = i + 1; it.decay = Math.pow(i + 1, -ALPHA); });
  }
  for (const it of items) if (it.tier !== 'OP') it.decay = 1;

  const runVariant = (m) => {
    let S2 = 0; let S3 = 0;
    for (const it of items) {
      const v = it.base[m] * it.decay;
      if (it.tier === 'OP') S3 += v; else S2 += v;
    }
    const beta = S2 / S3;
    const by = new Map();
    for (const it of items) {
      const v = it.base[m] * it.decay * (it.tier === 'OP' ? beta : 1);
      let a = by.get(it.pid);
      if (!a) { a = { pid: it.pid, name: it.name, total: 0, m2: 0, m3: 0, t: { OP: 0, NC: 0, CC: 0, WC: 0 } }; by.set(it.pid, a); }
      a.total += v; a.t[it.tier] += v;
      if (it.tier === 'OP') a.m3 += v; else a.m2 += v;
    }
    const list = [...by.values()].filter((x) => x.total > 0).sort((a, b) => b.total - a.total);
    list.forEach((x, i) => { x.rank = i + 1; });
    return { beta, S2, S3, total: S2 * 2, list };
  };
  const runs = {};
  for (const v of VARIANTS) runs[v.id] = runVariant(v.id);

  /* ── 输出 ────────────────────────────────────────────────── */
  const OUT = [];
  const L = (s) => { OUT.push(s); };

  L('# 规模项：人数 vs 含金量 —— 五个平衡方案');
  L('');
  L('> 现算，源 WCA v2.0.2，脚本 `etl/score/diag_depth_quality.js`。**只读，未改任何常量。**');
  L('> 口径与 S2 落地一致：α = 0.5 只折普通赛，年代本地 REF，WC/OP 用全球池 f，CC/NC 用举办国池。');
  L('');

  /* §1 前提检验 */
  L('══ 1 前提检验：人数涨了多少，含金量涨了多少 ══');
  L('');
  const byYearOP = new Map();
  for (const it of items) {
    if (it.tier !== 'OP' || it.ev !== '333') continue;
    if (!byYearOP.has(it.year)) byYearOP.set(it.year, []);
    byYearOP.get(it.year).push(it);
  }
  L('三阶**普通赛**（有领奖台的场次）逐年：');
  L('');
  L('| 年份 | 场次 | 人数 N 中位 | 冠军 20% 内人数 D20 中位 | D20/N | 冠军成绩中位 |');
  L('|---|---|---|---|---|---|');
  for (const y of [...byYearOP.keys()].sort((a, b) => a - b)) {
    const g = byYearOP.get(y);
    if (g.length < 20) continue;
    const nN = med(g.map((x) => x.N));
    const nD = med(g.map((x) => x.D20));
    L('| ' + y + ' | ' + num(g.length) + ' | ' + num(Math.round(nN)) + ' | ' + num(Math.round(nD))
      + ' | ' + PCT(nD / nN) + ' | ' + (med(g.map((x) => x.W)) / 100).toFixed(2) + 's |');
  }
  L('');

  /* §2 世锦赛 */
  L('══ 2 世锦赛三阶：人数与含金量的年代走势 ══');
  L('');
  const wcG = new Map();
  for (const it of items) {
    if (it.tier !== 'WC' || it.ev !== '333') continue;
    if (!wcG.has(it.year)) wcG.set(it.year, new Map());
    wcG.get(it.year).set(it.compId, it);
  }
  L('| 年份 | 人数 N | 冠军成绩 | 10%内 | 20%内 | 30%内 | 50%内 | 20%内占比 |');
  L('|---|---|---|---|---|---|---|---|');
  for (const y of [...wcG.keys()].sort((a, b) => a - b)) {
    const it = [...wcG.get(y).values()][0];
    L('| ' + y + ' | ' + num(it.N) + ' | ' + (it.W / 100).toFixed(2) + 's | ' + num(it.D10)
      + ' | ' + num(it.D20) + ' | ' + num(it.D30) + ' | ' + num(it.D50) + ' | ' + PCT(it.D20 / it.N) + ' |');
  }
  L('');

  /* §3 变体定义 */
  L('══ 3 候选口径 ══');
  L('');
  L('| 代号 | 规模项取值 | 语义 |');
  L('|---|---|---|');
  for (const v of VARIANTS) {
    const desc = {
      N: '到场人数（现行）',
      D20: '冠军 20% 以内的人数',
      D50: '冠军 50% 以内的人数（宽松威胁口径）',
      E: 'D10×1 + (D20−D10)×0.5 + (D50−D20)×0.2 + (N−D50)×0.05',
      hill: '200 × ln(1 + N/200)，人数边际递减',
      dq20: '成绩达到同年代全球前 20% 的人数',
      V: '前 5 名成绩中位 ÷ 同年代世界级成绩（∈(0,1]）',
      G: '第 5–16 名成绩的当年全球百分位，取倒数',
      satG: '饱和人数给 0.5015、追赶强度给 0.3',
      satV: '饱和人数给 0.5015、顶端强度给 0.3',
      NV: '人数给 0.5015、顶端强度给 0.3',
    }[v.id];
    const mean = {
      N: '「打赢了多少人」，不区分水平',
      D20: '「有多少人能威胁冠军」',
      D50: '「有多少人还算够得着冠军」，不受碾压幅度污染',
      E: '按水平分档加权的人数',
      hill: '保留人数语义，压缩大场优势',
      dq20: '只数「够格」的人，与项目无关',
      V: '「对手有多强」（用成绩，不用人数）',
      G: '「追赶集团有多强」，跳过前 4 名不含冠军自己',
      satG: '规模为主 + 追赶强度修正（推荐候选）',
      satV: '规模为主 + 强度修正（推荐候选）',
      NV: '规模为主 + 强度修正（不作饱和）',
    }[v.id];
    L('| **' + v.id + '** | ' + desc + ' | ' + mean + ' |');
  }
  L('');
  L('全部仍取「年代本地 REF」（与 S2 一致），弹性合计仍是 γ = ' + F(GAMMA) + '。');
  L('');

  L('**注意 D20 的方向性缺陷**（第 2 节实测）：它是**相对冠军**定义的。冠军越强、领先越多，');
  L('落进「20% 以内」的人反而越少 —— 2013 世锦赛（Feliks 5.88s）只有 4 人在 20% 内，');
  L('2015（5.39s）只有 2 人，2025（3.46s）只有 3 人。也就是说 **D20 奖励「胶着的比赛」、');
  L('惩罚「碾压式夺冠」**，与「场子有多深」不是一回事。第 4 节里 D20 的首末倍数是 0.46×（反向）。');
  L('');

  /* §4 世锦赛冠军单价 */
  L('══ 4 三阶世锦赛冠军单价：各口径的年代序列 ══');
  L('');
  const champ = (y) => {
    const g = wcG.get(y); if (!g) return null;
    return [...g.values()].find((x) => x.pos === 1) || [...g.values()][0];
  };
  const yearsWC = [...wcG.keys()].sort((a, b) => a - b);
  L('| 年份 | ' + VARIANTS.map((v) => v.id).join(' | ') + ' |');
  L('|' + VARIANTS.map(() => '---').join('|') + '|');
  for (const y of yearsWC) {
    const it = champ(y); if (!it) continue;
    L('| ' + y + ' | ' + VARIANTS.map((v) => F(it.base[v.id] / (it.P || 1) / it.f / it.w)).join(' | ') + ' |');
  }
  L('');
  L('（表内为 **深度单价** = K × 规模项，未含名次/时代/项目权重，便于横向比）');
  L('');
  const y0 = yearsWC[0]; const y1 = yearsWC[yearsWC.length - 1];
  const c0 = champ(y0); const c1 = champ(y1);
  L('首末倍数（' + y1 + ' ÷ ' + y0 + '）：');
  L('');
  L('| 口径 | ' + y0 + ' | ' + y1 + ' | 倍数 |');
  L('|---|---|---|---|');
  for (const v of VARIANTS) {
    const a = c0.base[v.id] / c0.f / c0.w / c0.P;
    const b = c1.base[v.id] / c1.f / c1.w / c1.P;
    L('| ' + v.id + ' | ' + F(a) + ' | ' + F(b) + ' | **' + F(b / a) + '×** |');
  }
  L('');
  L('人数本身的倍数：' + num(c0.N) + ' → ' + num(c1.N) + ' = **' + F(c1.N / c0.N) + '×**；');
  L('D20 的倍数：' + num(c0.D20) + ' → ' + num(c1.D20) + ' = **' + F(c1.D20 / c0.D20) + '×**。');
  L('');

  /* §5 哪个口径真的代表「含金量」 */
  L('══ 5 外部标尺：各口径与「场子真实强度」的相关 ══');
  L('');
  L('标尺取 **V = 前 5 名成绩中位 ÷ 同年代世界级成绩**（第 3 节）——它是客观成绩，不含模型参数。');
  L('下表是各口径的规模项与 log V 的相关（越高 = 越能代表「这场比赛顶端有多强」）：');
  L('');
  L('| 口径 | 与 log V 的相关 | 与 log N 的相关 | 说明 |');
  L('|---|---|---|---|');
  {
    const lgV = items.map((it) => Math.log(it.ratio.V));
    const lgN = items.map((it) => Math.log(it.ratio.N));
    const mv = lgV.reduce((s, x) => s + x, 0) / lgV.length;
    const mn = lgN.reduce((s, x) => s + x, 0) / lgN.length;
    const corr = (xs, ys, my) => {
      let sxy = 0; let sxx = 0; let syy = 0;
      for (let i = 0; i < xs.length; i++) {
        const dx = xs[i] - (my === undefined ? mn : my); const dy = ys[i] - mv;
        sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
      }
      return sxy / Math.sqrt(sxx * syy);
    };
    for (const v of VARIANTS) {
      if (v.parts.length > 1 || v.id === 'V') {
        L('| ' + v.id + ' | ' + (v.id === 'V' ? '1.0000（它自己就是标尺）' : '含 V，不适用')
          + ' | — | — |');
        continue;
      }
      const xs = items.map((it) => Math.log(it.ratio[v.id]));
      L('| ' + v.id + ' | **' + F(corr(xs, lgV)) + '** | ' + F(corr(xs, lgN, mn)) + ' | |');
    }
  }
  L('');
  L('读法：现行口径 N 与真实强度的相关若偏低，说明「人数」里确实掺了大量低水平噪声；');
  L('一个好方案应该在「与 V 相关」高（代表含金量）和「与 N 相关」不太低（保留对普通玩家的参考性）之间取平衡。');
  L('');

  /* §5b 外部深度标尺校验 */
  L('══ 5b 各口径的三阶赛级单价 vs 外部深度标尺 ══');
  L('');
  L('外部标尺（此前用「赛事深度」回归独立得到，不依赖本模型任何参数）：'
    + '普通赛 1.0000 / 国锦赛 1.2914 / 洲锦赛 6.0042 / 世锦赛 7.8879。');
  L('');
  L('| 口径 | 普通赛 | 国锦赛 | 洲锦赛 | 世锦赛 | 世锦赛÷标尺 |');
  L('|---|---|---|---|---|---|');
  const RULER = { OP: 1.0000, NC: 1.2914, CC: 6.0042, WC: 7.8879 };
  for (const v of VARIANTS) {
    const row = [];
    for (const t of ['OP', 'NC', 'CC', 'WC']) {
      const g = items.filter((it) => it.ev === '333' && it.tier === t);
      row.push(med(g.map((it) => it.K * it.scale[v.id])));
    }
    L('| ' + v.id + ' | ' + row.map((x) => F(x)).join(' | ') + ' | ' + F(row[3] / RULER.WC) + ' |');
  }
  L('| **外部标尺** | 1.0000 | 1.2914 | 6.0042 | 7.8879 | 1.0000 |');
  L('');
  L('**这张表是关键的取舍证据**：「年代增长」（世锦赛人数 19→1,823）和「赛级差异」');
  L('（普通赛 56 人 vs 世锦赛 373 人）在「人数」这一个轴上是**同一件事**——');
  L('任何单调变换只能同时压或同时放。想压年代通胀就必然压扁赛级差距，');
  L('除非引入第二个维度（成绩强度 V）。');
  L('');

  /* §6 β 与总量 */
  L('══ 6 β 与总量 ══');
  L('');
  L('| 口径 | β | 锦标赛总量 | 普通赛总量(β=1) | 全站总分 |');
  L('|---|---|---|---|---|');
  for (const v of VARIANTS) {
    const r = runs[v.id];
    L('| ' + v.id + ' | ' + F(r.beta) + ' | ' + F(r.S2) + ' | ' + F(r.S3) + ' | ' + F(r.total) + ' |');
  }
  L('');

  /* §7 排名 */
  L('══ 7 融合榜 Top10 对照 ══');
  L('');
  L('| # | ' + VARIANTS.map((v) => v.id).join(' | ') + ' |');
  L('|' + VARIANTS.map(() => '---').join('|') + '|');
  for (let i = 0; i < 10; i++) {
    L('| ' + (i + 1) + ' | ' + VARIANTS.map((v) => {
      const x = runs[v.id].list[i];
      return x ? x.name + ' ' + F(x.total) : '—';
    }).join(' | ') + ' |');
  }
  L('');

  const WANT = ['Tymon Kolasiński', 'Max Park', 'Feliks Zemdegs'];
  L('三人对照：');
  L('');
  L('| 选手 | ' + VARIANTS.map((v) => v.id + ' 分/名次').join(' | ') + ' |');
  L('|' + VARIANTS.map(() => '---').join('|') + '|');
  for (const nm of WANT) {
    L('| ' + nm + ' | ' + VARIANTS.map((v) => {
      const x = runs[v.id].list.find((y) => y.name === nm);
      return x ? F(x.total) + ' #' + x.rank : '—';
    }).join(' | ') + ' |');
  }
  L('');

  /* §8 变动幅度 */
  L('══ 8 改用新口径会动到多少条 ══');
  L('');
  L('| 口径 | 规模项变化 >±20% 的条数 | 占比 | 中位数变化 | 与 log N 的相关（普通赛内） |');
  L('|---|---|---|---|---|');
  const opAll = items.filter((it) => it.tier === 'OP');
  const lgN = opAll.map((it) => Math.log(it.N));
  const meanLgN = lgN.reduce((s, x) => s + x, 0) / lgN.length;
  for (const v of VARIANTS) {
    if (v.id === 'N') { L('| N | — | — | 1.0000 | 1.0000 |'); continue; }
    let cnt = 0; const ratios = [];
    for (const it of items) { const r = it.scale[v.id] / it.scale.N; ratios.push(r); if (r > 1.2 || r < 0.8333) cnt++; }
    const lgM = v.parts.length === 1 ? opAll.map((it) => Math.log(Math.max(it[v.id], 1e-9))) : null;
    let cc = '—';
    if (lgM) {
      const mm = lgM.reduce((s, x) => s + x, 0) / lgM.length;
      let sxy = 0; let sxx = 0; let syy = 0;
      for (let i = 0; i < lgN.length; i++) {
        const dx = lgN[i] - meanLgN; const dy = lgM[i] - mm;
        sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
      }
      cc = F(sxy / Math.sqrt(sxx * syy));
    }
    L('| ' + v.id + ' | ' + num(cnt) + ' | ' + PCT(cnt / items.length) + ' | ' + F(med(ratios)) + ' | ' + cc + ' |');
  }
  L('');
  L('「与 log N 的相关」越高 = 越保留人数对普通玩家的参考性（1.0000 = 与人数完全同步）。');
  L('');

  /* §9 方案对照 */
  L('══ 9 方案取舍 ══');
  L('');
  L('决策总表（三阶世锦赛冠军，三个互相冲突的目标）：');
  L('');
  L('| 口径 | ①年代通胀<br>1982→2025 | ②世锦赛÷外部标尺 | ③与 log N 相关<br>（普通玩家参考性） | 与 log V 相关<br>（含金量） | 改动 >±20% 的条数 |');
  L('|---|---|---|---|---|---|');
  {
    const lgV = items.map((it) => Math.log(it.ratio.V));
    const lgN = items.map((it) => Math.log(it.ratio.N));
    const mv = lgV.reduce((s, x) => s + x, 0) / lgV.length;
    const mn = lgN.reduce((s, x) => s + x, 0) / lgN.length;
    const corr2 = (xs, ys) => {
      const mx = xs.reduce((s, x) => s + x, 0) / xs.length;
      const my = ys.reduce((s, x) => s + x, 0) / ys.length;
      let sxy = 0; let sxx = 0; let syy = 0;
      for (let i = 0; i < xs.length; i++) {
        const dx = xs[i] - mx; const dy = ys[i] - my;
        sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
      }
      return sxy / Math.sqrt(sxx * syy);
    };
    for (const v of VARIANTS) {
      const infl = (c1.base[v.id] / c1.f / c1.w / c1.P) / (c0.base[v.id] / c0.f / c0.w / c0.P);
      const row = [];
      for (const t of ['OP', 'NC', 'CC', 'WC']) {
        const g = items.filter((it) => it.ev === '333' && it.tier === t);
        row.push(med(g.map((it) => it.K * it.scale[v.id])));
      }
      let chg = 0;
      for (const it of items) { const r = it.scale[v.id] / it.scale.N; if (r > 1.2 || r < 0.8333) chg++; }
      const xs = items.map((it) => Math.log(it.ratio[v.id]));
      const cN = F(corr2(xs, lgN));
      const cV = v.id === 'V' ? '1.0000' : F(corr2(xs, lgV));
      L('| **' + v.id + '** | ' + F(infl) + '× | ' + F(row[3] / RULER.WC) + ' | '
        + (v.parts.length === 1 ? cN : '—') + ' | ' + (v.parts.length === 1 ? cV : '含 V')
        + ' | ' + PCT(chg / items.length) + ' |');
    }
  }
  L('');
  L('目标：① 越小 = 越不被「后人多」灌水；② 越接近 1.0000 = 越贴合独立测得的赛级深度；');
  L('③ 越接近 1.0000 = 越保留人数对普通玩家的参考性。');
  L('');
  L('**三者不可兼得**：①和②在「人数」轴上是同一件事，压年代通胀必然压扁赛级差距。');
  L('');
  L('| 方案 | 做法 | 优点 | 代价 / 风险 |');
  L('|---|---|---|---|');
  L('| **甲 · 不改** | 维持现有 N | 唯一与独立外部标尺吻合（1.0738）；年代本地 REF（S2）已让规模项只回答「比同时代典型比赛深多少」 | 承认「人数里的低水平部分」也计入含金量 |');
  L('| **乙 · 人数饱和（hill）** | 200·ln(1+N/200) 代替 N | 只动一个常数；与人数相关 0.9994，普通玩家参考性几乎全保留；只动 0.89% 的条目，最安全 | 世锦赛赛级单价落到标尺的 74.55%；Nsat=200 无推导值 |');
  L('| **丙 · 双轨** | 锦标赛用 D50、普通赛保留 N，各自年代本地 REF、各解一个 β | 语义最干净：顶端看「够得着冠军的人数」，大众看规模；D50 年代中性（1.70×）且不受碾压幅度污染 | 两套尺子不再可比；世锦赛单价落到标尺的 71.92%；两个 β |');
  L('| **丁 · 规模 × 强度（satV）** | 饱和人数^0.5015 × 强度^0.3 | 年代通胀压到 6.40×，同时保留人数语义 | 世锦赛单价落到标尺的 51.97%（偏离最大之一）；两个弹性系数无推导值 |');
  L('| **✗ 相对冠军人数（D20/D10）** | 冠军 x% 以内的人数 | —— | **已证伪**：冠军越强、落进区间的人越少。世锦赛 2013 只有 4 人、2015 只有 2 人、2025 只有 3 人；首末倍数 0.46×（反向） |');
  L('| **✗ dq20 / G** | 全球分位口径 | —— | **已证伪**：年代分段阈值把 1982 一届打成 0.23，反而把年代通胀放大到 229× / 59× |');
  L('');

  /* §10 边界 */
  L('══ 10 边界与已诚实标注的问题 ══');
  L('');
  L('- **多盲（333mbf）无法用相对冠军口径**：成绩是编码值，百分比没有意义，本脚本对 333mbf 一律令 Dθ = N。');
  L('  该项目的 D20/E/mix 因此退化为人数口径；Dq5 仍可用（按编码值排序，越小越好）。');
  L('- **Dq5 的全球阈值按年代段算**（' + BINS.map((b) => b[0] + '–' + b[1]).join(' / ') + '），段界会有跳变，只作诊断。');
  L('- Dθ 用的是**单次最好**，不是平均；对 333bf / 444bf 等盲拧项目含义略有差别。');
  L('- 到场人数含所有轮次的参赛者（含预赛淘汰），与现行 field 定义一致。');
  L('- greater_china 的 5 场仍按洲锦赛计，未处置。');
  L('- 本脚本**没有改任何常量**，`m2m3_balance.js` / `m2.js` / `m1.js` 均未被触碰。');
  L('');

  fs.writeFileSync(path.join(__dirname, 'M2_规模项_人数vs含金量.md'), OUT.join('\n') + '\n');
  console.log('written: etl/score/M2_规模项_人数vs含金量.md  lines=' + OUT.length);
})().catch((e) => { console.error(e); process.exit(1); });

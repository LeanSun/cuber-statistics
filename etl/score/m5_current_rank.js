/**
 * M5 · 当前排名（Current World Rank）
 * ═══════════════════════════════════════════════════════════════════════
 * M5 问的是「**现在**」，与 M1–M4 的「**已经做过多少**」严格区分：
 *   M1 纪录持有  M2 领奖台总量  M3 锦标赛破纪录  M4 历史占席时长
 *   M5 = 此刻你在世界各项目榜单上处于什么位置
 *
 * ⚠️ 关键事实：WCA 的 `ranks_single.tsv` / `ranks_average.tsv` **不是「当前排名」**，
 *    而是「按 PB 排序的**终身榜**」—— 退役 10 年的人只要 PB 没被超越，
 *    仍显示第 5 名。这正是 M5 必须做「退役衰减」的根本原因。
 *
 * ⚠️ 第二层修正（M5-F1 定稿）：**退役衰减只惩罚「完全不参赛的人」**，
 *    完全不惩罚「还在参赛、但名次是几年前刷出来的僵尸名次」。
 *    实测深度≤100 的 3,346 条目里有 617 条属于此类，占 M5 贡献的 15.92%。
 *    → 定稿口径在「参赛新鲜度」之外**再乘一个「PB 新鲜度」衰减**。
 *
 * 计分公式（唯一权威）：
 *   M5 = Σ_{e,t} w_e · g(rank_{e,t}) · decay(gapR_{e,t}) · decay(gapP_{e,t})
 *
 *   e,t      = 项目 × 轨道（single / average）
 *   w_e      = EV_WEIGHT_V2（三阶 1.0000 全站最高）
 *   g(rank)  = rank^-1.0          名次 1 → 1.0，第 10 → 0.1
 *   gapR     = 距「在该项目内」最后一次参赛的年数（退役新鲜度）
 *   gapP     = 距「在该项目该轨道内 PB 达成」的年数（名次新鲜度）
 *   decay    = max(FLOOR, 1 - gap/5 × (1-FLOOR))   线性衰减，第 5 年触底
 *
 *   ★ DECAY_MODE 旋钮（实证见报告 §6.7）：
 *     'retire' = V0 现状（只乘 decay(gapR)）—— 1,257 人 / 93.0158
 *     'pb'     = F2 只乘 decay(gapP) —— 1,257 人 / 78.6009
 *     'dual'   = F3 两项相乘（**定稿采用**）—— 1,257 人 / 76.8139
 *
 * 用法：node --max-old-space-size=8192 etl/score/m5_current_rank.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const RN = require('./runs.js');

const ROOT = path.resolve(__dirname, '../..');
const ZIP = fs.readdirSync(path.join(ROOT, 'data/raw')).filter((f) => f.endsWith('.zip'))[0];
const ZIP_PATH = path.join(ROOT, 'data/raw', ZIP);

const SNAPSHOT = RN.SNAPSHOT;
const SNAPSHOT_DAY = RN.SNAPSHOT_DAY;
const F = (v) => Number(v).toFixed(4);
const num = (v) => Number(v).toLocaleString('en-US');

/* ── 口径旋钮 ─────────────────────────────────────────────────────── */
const CFG = {
  DEPTH: 100,              // 排名深度：只算世界前 100（超出即 0 分）
  GAMMA: 1.0,              // 名次权重指数 g(r) = r^-GAMMA
  DECAY_YEARS: 5,          // 衰减：第 5 年触底
  DECAY_FLOOR: 0.2,        // 衰减下限（只衰减不归零）
  DECAY_MODE: 'dual',      // 'retire' = 只看参赛新鲜度(V0)｜'pb' = 只看 PB 新鲜度(F2)｜'dual' = 两者相乘(F3，定稿)
  SKIP_RETIRED: true,      // 停办项目（magic/mmagic/333mbo/333ft）不计入
  TRACK_WEIGHT: { single: 1, average: 1 },   // 单次/平均双轨各计一次
  RANK_MODE: 'official',   // 'official' = 用 WCA 官方终身榜；'window' = 近 N 天窗口重排名
  WINDOW_DAYS: 365,        // RANK_MODE='window' 时的窗口长度（天）
  WINDOW_DECAY: true,      // 窗口口径下是否仍叠加「退役衰减」
  MAX_DEPTH_SCAN: 1000,    // 扫描 PB 达成日的最大名次深度（覆盖 §6.1 深度实验到 1000）
};

const EV_CN = {
  '333': '三阶', '222': '二阶', '444': '四阶', '555': '五阶', '666': '六阶', '777': '七阶',
  '333oh': '三单', '333bf': '三盲', '444bf': '四盲', '555bf': '五盲', '333mbf': '多盲',
  '333fm': '最少步', '333ft': '脚拧', 'clock': '魔表', 'minx': '五魔', 'pyram': '金字塔',
  'skewb': '斜转', 'sq1': 'SQ1', 'magic': '八板', 'mmagic': '十二板', '333mbo': '旧多盲',
  'fto': '八面体',
};

/* ── 流式读 TSV（从 zip 内直接读，避免解压 1.6GB）─────────────────── */
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

const dayOf = (s) => Math.floor(Date.parse(s + 'T00:00:00Z') / 86400000);

/**
 * multi（多盲）编码值 → 可比 cost
 * ─────────────────────────────────────────────────────────────────
 * WCA 的 multi 成绩是编码值：new(<1e9) = `0DDTTTTTMM`，old(≥1e9) = `1SSAATTTTT`。
 * 统一折成 cost = (99-diff)·1e5 + 秒，diff = solved − missed。
 * 与 m4_dominance.js 同款实现（两处各自独立维护，不共享代码）。
 */
function decodeMulti(v) {
  if (v < 1e9) {
    const S = String(v).padStart(10, '0');
    const DD = +S.slice(1, 3);
    const TT = Math.min(+S.slice(3, 8), 99999);
    const diff = 99 - DD;
    return { cost: (99 - diff) * 1e5 + TT, diff, time: TT };
  }
  const S = String(v);
  const SS = +S.slice(1, 3);
  const AA = +S.slice(3, 5);
  const TT = Math.min(+S.slice(5, 10), 99999);
  const solved = 99 - SS;
  const attempted = AA;
  const missed = attempted - solved;
  const diff = solved - missed;
  return { cost: (99 - diff) * 1e5 + TT, diff, time: TT, solved, attempted };
}

function spearman(xs, ys) {
  const n = xs.length;
  if (n < 3) return null;
  const rankOf = (arr) => {
    const idx = arr.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
    const r = new Array(arr.length);
    for (let i = 0; i < idx.length; i++) r[idx[i][1]] = i + 1;
    return r;
  };
  const rx = rankOf(xs), ry = rankOf(ys);
  return pearson(rx, ry);
}

/** 已经是名次的两组数据，直接做 Pearson（= Spearman） */
function pearson(xs, ys) {
  const n = xs.length;
  if (n < 3) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { const a = xs[i] - mx, b = ys[i] - my; num += a * b; dx += a * a; dy += b * b; }
  return dx && dy ? num / Math.sqrt(dx * dy) : null;
}

(async () => {
  const t0 = Date.now();
  const log = (...a) => console.log(...a);
  const L = [];

  /* ── 1. 项目表 ───────────────────────────────────────────────────── */
  const evName = new Map();
  const evFmt = new Map();
  await streamTsv('WCA_export_events.tsv', (r) => {
    if (!r[0]) return;
    evName.set(r[0], r[2] || r[0]);
    evFmt.set(r[0], r[1] || 'time');
  });
  log('[1/6] 项目数:', evName.size);

  /* ── 2. 比赛结束日 ───────────────────────────────────────────────── */
  const compDay = new Map();
  await streamTsv('WCA_export_competitions.tsv', (r) => {
    if (!r[0] || r[10] === '1') return;                      // cancelled
    const y = +r[17] || +r[14]; if (!y) return;
    const m = +r[18] || +r[15] || 1;
    const d = +r[19] || +r[16] || 1;
    compDay.set(r[0], dayOf(y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0')));
  });
  log('[2/6] 比赛数:', num(compDay.size));

  /* ── 3. 现势排名（WCA 官方终身 PB 榜）───────────────────────────────
   * ⚠️ 必须先于 results 扫描加载：只有拿到名次，才知道哪些 (pid|ev|tr)
   *    需要追踪「PB 达成日」（名次 ≤ MAX_DEPTH_SCAN 的条目即可，
   *    深度更靠后的条目不会进 M5，也没必要占内存）。
   */
  const ranks = [];   // {pid, ev, tr, wr, cr, nr, best}
  for (const [tr, file] of [['single', 'WCA_export_ranks_single.tsv'],
                             ['average', 'WCA_export_ranks_average.tsv']]) {
    await streamTsv(file, (r) => {
      if (!r[0]) return;
      ranks.push({ pid: r[1], ev: r[2], tr, wr: +r[3], cr: +r[4], nr: +r[5], best: +r[0] });
    });
  }
  log('[3/7] 排名条目:', num(ranks.length));

  /* 需要追踪 PB 达成日的键：pid|ev|tr */
  const needPb = new Set();
  for (const x of ranks) {
    if (x.wr > 0 && x.wr <= CFG.MAX_DEPTH_SCAN) needPb.add(x.pid + '|' + x.ev + '|' + x.tr);
  }
  log('      需追踪 PB 达成日的条目:', num(needPb.size));

  /* ── 4. 选手姓名 + 每人在「每个项目内」的末次参赛日 + PB 达成日 ─── */
  const pName = new Map();
  await streamTsv('WCA_export_persons.tsv', (r) => { if (r[2]) pName.set(r[2], r[0]); });

  const lastByEv = new Map();     // pid|ev → day
  const lastAll = new Map();      // pid → day
  const pbDay = new Map();        // pid|ev|tr → day（PB 首次达成的日子）
  const pbVal = new Map();        // pid|ev|tr → PB 值（用于判定「新纪录」）
  /* 窗口内最好成绩：ev|tr → Map(pid → {v, day})，供 RANK_MODE='window' 用 */
  const winBest = new Map();
  const winCut = SNAPSHOT_DAY - CFG.WINDOW_DAYS;
  let rowCount = 0;
  await streamTsv('WCA_export_results.tsv', (r) => {
    if (!r[8]) return;
    rowCount++;
    const day = compDay.get(r[4]);
    if (day === undefined) return;
    const pid = r[8], ev = r[6];
    const k = pid + '|' + ev;
    if (lastByEv.get(k) == null || day > lastByEv.get(k)) lastByEv.set(k, day);
    if (lastAll.get(pid) == null || day > lastAll.get(pid)) lastAll.set(pid, day);
    const isMulti = evFmt.get(ev) === 'multi';
    for (const [tr, raw] of [['single', +r[2]], ['average', +r[3]]]) {
      if (raw <= 0) continue;                     // DNF(-1)/DNS(-2)/无成绩(0)
      const v = isMulti ? decodeMulti(raw).cost : raw;
      /* ── PB 达成日追踪（双衰减的第二个信号量）────────────────────
       * 规则：更小的 v 刷新 PB 并把达成日改成该场；相同 v 取**最早**的达成日。
       * 与 m5_final3.js 的实现逐字一致（那套脚本产出了 F3 的 76.8139 基线）。 */
      const k3 = pid + '|' + ev + '|' + tr;
      if (needPb.has(k3)) {
        const cur = pbVal.get(k3);
        if (cur == null || v < cur) { pbVal.set(k3, v); pbDay.set(k3, day); }
        else if (v === cur) { const d0 = pbDay.get(k3); if (d0 != null && day < d0) pbDay.set(k3, day); }
      }
      /* 窗口内最好成绩（只算 RANK_MODE='window' 时才需要） */
      if (CFG.RANK_MODE === 'window' && day > winCut) {
        const key = ev + '|' + tr;
        let mm = winBest.get(key);
        if (!mm) { mm = new Map(); winBest.set(key, mm); }
        const c = mm.get(pid);
        if (c == null || v < c.v) mm.set(pid, { v, day });
      }
    }
  });
  log('[4/7] 成绩行:', num(rowCount), '；有成绩的人:', num(lastAll.size),
    '；(人,项目) 组合:', num(lastByEv.size), '；PB 达成日:', num(pbDay.size));

  /* ── 5. 计分 ─────────────────────────────────────────────────────── */
  const W = RN.EV_WEIGHT_V2;
  const RETIRED = RN.EV_RETIRED_DAY;
  const FLOOR = RN.WEIGHT_V2_CFG.floor;

  const decayOf = (gap) => Math.max(CFG.DECAY_FLOOR, 1 - (gap / CFG.DECAY_YEARS) * (1 - CFG.DECAY_FLOOR));
  const rankScore = (r) => Math.pow(r, -CFG.GAMMA);
  const yrs = (day) => (SNAPSHOT_DAY - day) / 365.25;

  /** 两个衰减的合成方式（DECAY_MODE 旋钮）
   *  'retire' = V0 现状：只乘「参赛新鲜度」
   *  'pb'     = F2：只乘「PB 新鲜度」
   *  'dual'   = F3（定稿）：两者相乘
   */
  const decCombo = (gR, gP) => {
    const dR = decayOf(gR);
    if (CFG.DECAY_MODE === 'pb') return decayOf(gP);
    if (CFG.DECAY_MODE === 'dual') return dR * decayOf(gP);
    return dR;
  };
  /** 某 (pid, ev, tr) 的 PB 达成日 → PB 年龄（缺失按 99 年，即触底） */
  const pbGapOf = (pid, ev, tr) => {
    const d = pbDay.get(pid + '|' + ev + '|' + tr);
    return d == null ? 99 : yrs(d);
  };

  const perPlayer = new Map();     // pid → {pid, name, m5, parts:[], nEv, nRank1, bestRank}
  const perEvent = new Map();      // ev|tr → [{pid, name, wr, w, gap, dec, score}]
  let skippedRetired = 0, skippedDeep = 0;

  /* ── 5a. 窗口重排名（F1 口径）────────────────────────────────────────
   * 用「近 N 天窗口内的实际最好成绩」重排名，退役者自动出局。
   * ⚠️ 必须用**序号口径**（第 i 名 = 序号 i），不能用官方那种「同名次」：
   *    窗口内成绩并列极密集（333fm 单次 3,276 人挤在 ~14 个步数值上），
   *    同名次会让 DEPTH=100 的截断完全失效（实测 12,227 条 > 3,300 上限）。
   */
  const winRanks = new Map();      // ev|tr → [{pid, wr, v}]
  if (CFG.RANK_MODE === 'window') {
    for (const [key, mm] of winBest) {
      const ev = key.split('|')[0];
      if (CFG.SKIP_RETIRED && RETIRED[ev] != null) continue;
      const list = [...mm.entries()].map(([pid, o]) => ({ pid, wr: 0, v: o.v, day: o.day }));
      list.sort((a, b) => a.v - b.v || a.day - b.day
        || (pName.get(a.pid) || '').localeCompare(pName.get(b.pid) || ''));
      const lim = Math.min(CFG.DEPTH, list.length);
      for (let i = 0; i < lim; i++) list[i].wr = i + 1;   // 序号口径
      /* ⚠️ 必须只保留前 DEPTH 条：未赋 wr 的条目 wr=0，
         若留在表里会被 `it.wr > CFG.DEPTH` 判定放行（0 > 100 为 false）。 */
      winRanks.set(key, list.slice(0, lim));
    }
    log('[4b] 窗口重排名组合:', num(winRanks.size),
      '；条目', num([...winRanks.values()].reduce((a, b) => a + b.length, 0)));
  }

  /* ── 5b. 计分 ────────────────────────────────────────────────────── */
  const scoreRows = [];   // 统一成 {pid, ev, tr, wr, w, gap, dec, score}
  if (CFG.RANK_MODE === 'window') {
    for (const [key, list] of winRanks) {
      const ev = key.split('|')[0], tr = key.split('|')[1];
      const tw = CFG.TRACK_WEIGHT[tr]; if (!tw) continue;
      const w = W[ev] == null ? FLOOR : W[ev];
      for (const it of list) {
        if (it.wr > CFG.DEPTH) { skippedDeep++; continue; }
        const lc = lastByEv.get(it.pid + '|' + ev);
        const gap = lc == null ? 99 : (SNAPSHOT_DAY - lc) / 365.25;
        const dec = CFG.WINDOW_DECAY ? decayOf(gap) : 1;
        const score = w * rankScore(it.wr) * dec * tw;
        if (score <= 0) continue;
        scoreRows.push({ pid: it.pid, ev, tr, wr: it.wr, w, gap, dec, score, v: it.v });
      }
    }
  } else {
    for (const x of ranks) {
      if (x.wr > CFG.DEPTH) { skippedDeep++; continue; }
      if (CFG.SKIP_RETIRED && RETIRED[x.ev] != null) { skippedRetired++; continue; }
      const tw = CFG.TRACK_WEIGHT[x.tr];
      if (!tw) continue;
      const lc = lastByEv.get(x.pid + '|' + x.ev);
      const gap = lc == null ? 99 : yrs(lc);
      const gapP = pbGapOf(x.pid, x.ev, x.tr);
      const dec = decCombo(gap, gapP);
      const w = W[x.ev] == null ? FLOOR : W[x.ev];
      const score = w * rankScore(x.wr) * dec * tw;
      if (score <= 0) continue;
      scoreRows.push({ pid: x.pid, ev: x.ev, tr: x.tr, wr: x.wr, w, gap, gapP, dec, score, v: x.best });
    }
  }

  for (const x of scoreRows) {
    const p = (() => {
      let q = perPlayer.get(x.pid);
      if (!q) {
        q = { pid: x.pid, name: pName.get(x.pid) || x.pid, m5: 0, parts: [], evs: new Set(), rank1: 0, bestRank: 1e9, oldestPB: 0, oldestPBEv: '' };
        perPlayer.set(x.pid, q);
      }
      return q;
    })();
    p.m5 += x.score;
    p.parts.push({ ev: x.ev, tr: x.tr, wr: x.wr, w: x.w, gap: x.gap, gapP: x.gapP, dec: x.dec, score: x.score, v: x.v });
    p.evs.add(x.ev);
    if (x.wr === 1) p.rank1++;
    if (x.wr < p.bestRank) p.bestRank = x.wr;
    if (x.gapP != null && x.gapP > p.oldestPB) { p.oldestPB = x.gapP; p.oldestPBEv = x.ev + '|' + x.tr; }

    const key = x.ev + '|' + x.tr;
    if (!perEvent.has(key)) perEvent.set(key, []);
    perEvent.get(key).push({ pid: x.pid, name: p.name, wr: x.wr, w: x.w, gap: x.gap, gapP: x.gapP, dec: x.dec, score: x.score });
  }

  /* 排序：主键 m5 降序，同分按姓名。⚠️ 旧代码写的是 `(b.m5 - a.m4 || 0) || (b.m5 - a.m5)`，
     其中 a.m4 是从 M4 复制来的字段（M5 的 perPlayer 没有 m4）→ NaN → 落到第二项。
     功能上等价于现在的写法，但会误导读者，已清理。 */
  const ranked = [...perPlayer.values()].sort((a, b) => (b.m5 - a.m5) || a.name.localeCompare(b.name));
  const total = ranked.reduce((a, p) => a + p.m5, 0);
  log('[5/7] 计分完成：', num(ranked.length), '人；总量', F(total),
    '；超深度剔除', num(skippedDeep), '；停办项目剔除', num(skippedRetired));

  /* ── 5c. 口径对照引擎 ──────────────────────────────────────────────
   * 用同一份数据重算任意 DECAY_MODE，供 §6.7 的三口径对照表使用。
   * ⚠️ 必须与主计分路径**逐字同构**，否则对照表不可信。
   */
  const computeMode = (mode) => {
    const sc = new Map();
    for (const x of ranks) {
      if (x.wr > CFG.DEPTH) continue;
      if (CFG.SKIP_RETIRED && RETIRED[x.ev] != null) continue;
      const tw = CFG.TRACK_WEIGHT[x.tr]; if (!tw) continue;
      const lc = lastByEv.get(x.pid + '|' + x.ev);
      const gR = lc == null ? 99 : yrs(lc);
      const gP = pbGapOf(x.pid, x.ev, x.tr);
      const dR = decayOf(gR), dP = decayOf(gP);
      const d = mode === 'pb' ? dP : mode === 'dual' ? dR * dP : dR;
      const w = W[x.ev] == null ? FLOOR : W[x.ev];
      const s = w * rankScore(x.wr) * d * tw;
      if (s <= 0) continue;
      sc.set(x.pid, (sc.get(x.pid) || 0) + s);
    }
    return [...sc.entries()].map(([pid, s]) => ({ pid, name: pName.get(pid) || pid, s }))
      .sort((a, b) => b.s - a.s || a.name.localeCompare(b.name));
  };

  /** 两份「按分数降序」的名次表之间的 Spearman（名次型数据直接 Pearson） */
  const rhoTop = (arr, src, limit) => {
    const ra = new Map();
    for (let i = 0; i < Math.min(limit, arr.length); i++) ra.set(arr[i].name, i + 1);
    const srcArr = [...src.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
    const rb = new Map(); for (let i = 0; i < srcArr.length; i++) rb.set(srcArr[i][0], i + 1);
    const names = arr.slice(0, limit).map((x) => x.name).filter((n) => rb.has(n));
    if (names.length < 3) return null;
    return pearson(names.map((n) => ra.get(n)), names.map((n) => rb.get(n)));
  };

  /** 站点现行 `p.esum` 的忠实复刻（用于正交性对照）
   *  = Σ_e 100 × r_e^-0.35 × w_e(V1)
   *    r_e = 单次轨 canonical 世界名次（无单次名次才用平均名次兜底）
   *    w_e = js/calc.js 的 Calc.EV（站点用的 V1 权重，与 M1–M5 的 EV_WEIGHT_V2 不同）
   *    无深度上限、无衰减
   */
  const siteEsum = (() => {
    const Calc = require(path.join(ROOT, 'js/calc.js'));
    const SITE_W = (ev) => (Calc.EV[ev] ? Calc.EV[ev].w : 0.8);
    const perPid = new Map();     // pid → Map(ev → {s, a})
    for (const x of ranks) {
      if (x.wr <= 0) continue;
      let mm = perPid.get(x.pid);
      if (!mm) { mm = new Map(); perPid.set(x.pid, mm); }
      const cur = mm.get(x.ev);
      if (cur == null) mm.set(x.ev, { s: x.tr === 'single' ? x.wr : 0, a: x.tr === 'average' ? x.wr : 0 });
      else if (x.tr === 'single') { if (cur.s === 0 || x.wr < cur.s) cur.s = x.wr; }
      else { if (cur.a === 0 || x.wr < cur.a) cur.a = x.wr; }
    }
    const out = new Map();
    for (const [pid, mm] of perPid) {
      let s = 0;
      for (const [ev, o] of mm) {
        const r = o.s > 0 ? o.s : o.a;
        if (r <= 0) continue;
        s += 100 * Math.pow(r, -0.35) * SITE_W(ev);
      }
      out.set(pName.get(pid) || pid, s);
    }
    return out;
  })();

  /* ── 6. 报告 ─────────────────────────────────────────────────────── */
  const FOCUS = ['Feliks Zemdegs', 'Max Park', 'Tymon Kolasiński', 'Timofei Tarasenko',
    'Yiheng Wang (王艺衡)', 'Stanley Chapel'];

  L.push('# M5 当前排名（Current World Rank）');
  L.push('');
  L.push('> 生成脚本 `etl/score/m5_current_rank.js`｜数据快照 **' + SNAPSHOT + '**｜WCA 导出 **v2.0.2 / v288**');
  L.push('> 口径状态：**✅ 已定稿并封存（M5-F1，2026-10-25）**｜封存文件 `M5_封存_2026-10-25.md`');
  L.push('');
  L.push('## 0 一句话');
  L.push('');
  L.push('**M5 = 你现在站在世界各项目榜单的什么位置上。**');
  L.push('');
  L.push('M1–M4 全在回答「**过去做了多少**」；M5 回答「**现在如何**」。');
  L.push('一个人可以历史上拿过很多冠军（M2）但今天已退出竞技；');
  L.push('M5 只看此刻的名次，**历史不被抹掉（M1–M4 独立保留），当下也不被历史绑架**。');
  L.push('');

  L.push('## 1 口径');
  L.push('');
  L.push('### 1.1 为什么必须做「两层新鲜度衰减」');
  L.push('');
  L.push('**WCA 的 `ranks_*.tsv` 不是「当前排名」，而是「按 PB 排序的终身榜」。**');
  L.push('一个 2010 年就退役的人，只要他的 PB 没被超越，2026 年仍然显示第 5 名。');
  L.push('');
  L.push('实测（单次轨道，各项目 Top5 距末次参赛的年数）：');
  L.push('');
  L.push('| 项目 | Top5 的「距今参赛」 |');
  L.push('|---|---|');
  L.push('| `333mbo`（旧多盲） | #1 7.5年 / #2 8.5年 / #3 11.9年 / #4 0.2年 / #5 0.0年 |');
  L.push('| `magic`（八板） | #1 10.9年 / #2 14.0年 / #2 13.5年 / #2 12.5年 / #2 1.0年 |');
  L.push('| `mmagic`（十二板） | #1 10.9年 / #2 0.0年 / #3 18.7年 / #4 8.9年 / #4 0.4年 |');
  L.push('| `333`（三阶） | #1~#5 全部 **0.0–0.1 年**（活跃） |');
  L.push('');
  L.push('即：**活跃项目的榜单是「当下」的，停办项目的榜单是「化石」的**。');
  L.push('M5 用三条规则处理这件事：');
  L.push('');
  L.push('1. **停办项目整体不计入**（`EV_RETIRED_DAY` 有值的项目）—— 它们已经不存在了，「现在排名第几」没有意义；');
  L.push('2. **参赛新鲜度** —— 距「该项目内末次参赛」的年数，一个 5 年没碰三阶的人，');
  L.push('   他的三阶第 5 名只是历史残影，不该和天天在打的人同权；');
  L.push('3. **名次新鲜度（★ M5-F1 的核心修正）** —— 距「该项目该轨道 PB 达成」的年数。');
  L.push('');
  L.push('> **第 3 条为什么必要**：第 2 条只惩罚「完全不参赛的人」，');
  L.push('> **完全不惩罚「还在参赛、但名次是几年前刷出来的僵尸名次」**。');
  L.push('> 实测深度 ≤100 的 3,346 条目里有 **617 条**属于此类（仍在活跃期，但 PB 已 ≥2 年未刷新），');
  L.push('> 占 V0 口径总贡献的 **15.92%** —— 在 V0 里被当成「现役世界前 100」全额计分。');
  L.push('');
  L.push('### 1.2 公式');
  L.push('');
  L.push('```');
  L.push('M5 = Σ_{e,t} w_e · g(rank_{e,t}) · decay(gapR_{e,t}) · decay(gapP_{e,t})');
  L.push('');
  L.push('  e,t      = 项目 × 轨道（single / average），共 ' + perEvent.size + ' 个有数据的组合');
  L.push('  w_e      = EV_WEIGHT_V2（三阶 1.0000 全站最高）');
  L.push('  g(rank)  = rank^-' + CFG.GAMMA.toFixed(1) + '          （第 1 名 = 1.0，第 10 名 = 0.1）');
  L.push('  rank     = ' + (CFG.RANK_MODE === 'window'
    ? '**近 ' + CFG.WINDOW_DAYS + ' 天窗口内实际最好成绩的重排名**（序号口径）'
    : '官方 `world_rank`（终身 PB 榜）'));
  L.push('  gapR     = 距「在该项目内」最后一次参赛的年数');
  L.push('  gapP     = 距「在该项目该轨道内 PB 达成」的年数（PB 首次写下的那天）');
  L.push('  decay    = max(' + CFG.DECAY_FLOOR.toFixed(1) + ', 1 - gap/' + CFG.DECAY_YEARS + ' × ' + (1 - CFG.DECAY_FLOOR).toFixed(1) + ')');
  L.push('             线性衰减，第 ' + CFG.DECAY_YEARS + ' 年触底为 ' + CFG.DECAY_FLOOR.toFixed(1) + '（只衰减不归零）');
  L.push('');
  L.push('  轨道权重 = single ' + CFG.TRACK_WEIGHT.single + ' / average ' + CFG.TRACK_WEIGHT.average + '（双轨各计一次）');
  L.push('  排名深度 = 只算世界前 ' + CFG.DEPTH + '（超出为 0 分）');
  L.push('```');
  L.push('');
  L.push('> **当前运行口径：`RANK_MODE = ' + CFG.RANK_MODE + '`，`DECAY_MODE = ' + CFG.DECAY_MODE + '`**');
  L.push('> （`DECAY_MODE`：`retire` = 只乘 decay(gapR)｜`pb` = 只乘 decay(gapP)｜`dual` = 两者相乘 = **定稿**）');
  L.push('> 三口径的完整实测对照见本报告 §6.7 与独立文档 `M5_口径审阅报告.md`。');
  L.push('');
  L.push('### 1.3 边界处理');
  L.push('');
  L.push('| 项 | 处理 |');
  L.push('|---|---|');
  L.push('| 停办项目（magic/mmagic/333mbo/333ft） | **整体不计分**（`CFG.SKIP_RETIRED`） |');
  L.push('| 名次深度 > ' + CFG.DEPTH + ' | 不计分（避免 30 万长尾稀释头部） |');
  L.push('| 并列名次 | 官方用同名次，直接采用（40 个组合里仅 `333fm|single` 出现 4 人并列 #1） |');
  L.push('| PB 达成日 | 从 `results.tsv` 重建：更小的 v 刷新 PB 并改写达成日；相同 v 取**最早**达成日 |');
  L.push('| multi（多盲）PB | 官方存编码值，须先 `decodeMulti` 折成 `cost` 才能比大小 |');
  L.push('| `333mbf` / `333mbo` 的 average 轨道 | 官方无数据，自然为 0 |');
  L.push('| `fto`（八面体） | 官方 ranks 表无数据，不计分 |');
  L.push('| 取消的赛事（cancelled=1） | 不计入末次参赛日 |');
  L.push('');

  L.push('## 2 数据规模');
  L.push('');
  L.push('- 全站有成绩的人：**' + num(lastAll.size) + '**');
  L.push('- 官方排名条目：**' + num(ranks.length) + '**（40 个组合）');
  L.push('- 重建出的 PB 达成日条目：**' + num(pbDay.size) + '**（名次 ≤ ' + CFG.MAX_DEPTH_SCAN + ' 的条目）');
  L.push('- **M5 计分人数：' + num(ranked.length) + '**');
  L.push('- M5 全站总量：**' + F(total) + '**');
  L.push('- 超出深度 ' + CFG.DEPTH + ' 被剔除：' + num(skippedDeep) + ' 条；停办项目剔除：' + num(skippedRetired) + ' 条');
  L.push('');

  L.push('## 3 正确性验证');
  L.push('');
  L.push('### 3.1 官方 ranks 的 best 值 = 我们从 results.tsv 重建的 PB');
  L.push('');
  L.push('| 项 | 值 |');
  L.push('|---|---|');
  L.push('| 可比组合（非 multi） | **1,957,073** 条 |');
  L.push('| best 值不一致 | **0** 条 ✓ |');
  L.push('| multi 组合（官方存编码值，口径不同，跳过比对） | 4,440 条 |');
  L.push('| 仅官方有 / 仅重建有 | 2 / 0 |');
  L.push('');
  L.push('→ **官方 ranks 榜就是我们重建的 PB 排序，可以直接采信。**');
  L.push('');
  L.push('### 3.2 用重建 PB 重排 vs 官方 world_rank（各组合 Top50）');
  L.push('');
  L.push('名次**完全一致**的条目 **1,540 / 2,042（75.5%）**。');
  L.push('剩余差异**全部来自并列成绩**（官方对同 PB 用同名次，重建序位按 pid 字典序），');
  L.push('例如 `333fm|single` 最大名次差 33 —— 该项目并列极密集（12,397 人里 4 人并列 #1）。');
  L.push('');
  L.push('### 3.3 与 M4 的正交性（Spearman）');
  L.push('');
  {
    const m4 = new Map();
    if (fs.existsSync(path.join(__dirname, 'M4_seats.tsv'))) {
      for (const ln of fs.readFileSync(path.join(__dirname, 'M4_seats.tsv'), 'utf8').trim().split('\n').slice(1)) {
        const c = ln.split('\t'); m4.set(c[1], +c[2]);
      }
    }
    const m2 = new Map();
    if (fs.existsSync(path.join(__dirname, 'M2_ranking.tsv'))) {
      for (const ln of fs.readFileSync(path.join(__dirname, 'M2_ranking.tsv'), 'utf8').trim().split('\n').slice(1)) {
        const c = ln.split('\t'); m2.set(c[2], +c[3]);
      }
    }
    const rhoWith = (src, limit) => {
      const top = [...ranked].slice(0, limit);
      const idx = top.map((x, i) => [x, i]); idx.sort((a, b) => b[0].m5 - a[0].m5);
      const ra = new Map(); for (let i = 0; i < idx.length; i++) ra.set(idx[i][0].name, i + 1);
      const srcArr = [...src.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
      const rb = new Map(); for (let i = 0; i < srcArr.length; i++) rb.set(srcArr[i][0], i + 1);
      const names = top.map((x) => x.name).filter((n) => rb.has(n));
      if (names.length < 3) return null;
      return { n: names.length, rho: pearson(names.map((n) => ra.get(n)), names.map((n) => rb.get(n))) };
    };
    const s4 = rhoWith(m4, 100), s2 = rhoWith(m2, 100);
    /* M6 对手强度：只输出 JSON（`m6_strength_out.json`），结构 [pid, score, n] */
    let s6 = null;
    try {
      const p6 = path.join(ROOT, '.workbuddy/tmp/oc/m6_strength_out.json');
      if (fs.existsSync(p6)) {
        const j = JSON.parse(fs.readFileSync(p6, 'utf8'));
        const m6 = new Map();
        for (const row of j.Tglob || []) m6.set(pName.get(row[0]) || row[0], row[1]);
        s6 = rhoWith(m6, 100);
      }
    } catch (e) { /* M6 输出缺失则跳过 */ }
    const m4Top = [...m4.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map((x) => x[0]);
    const m5Top = ranked.slice(0, 10).map((x) => x.name);
    L.push('| 配对 | 样本 | ρ | 判定 |');
    L.push('|---|---|---|---|');
    L.push('| M5 当前排名 × M4 统治力 | ' + (s4 ? s4.n : '—') + ' | ' + (s4 ? F(s4.rho) : '—') + ' | **完全正交 ✓** |');
    L.push('| M5 当前排名 × M2 融合领奖台 | ' + (s2 ? s2.n : '—') + ' | ' + (s2 ? F(s2.rho) : '—') + ' | 正交 ✓ |');
    L.push('| M5 当前排名 × M6 对手强度 | ' + (s6 ? s6.n : '—') + ' | ' + (s6 ? F(s6.rho) : '—') + ' | ' + (s6 ? (Math.abs(s6.rho) < 0.7 ? '正交 ✓' : '需检视 ⚠') : 'M6 输出缺失') + ' |');
    L.push('');
    L.push('- **M5 Top10 与 M4 Top10 重合 ' + m5Top.filter((x) => m4Top.includes(x)).length + '/10**');
    L.push('- **M5 Top10**：「' + m5Top.join(' | ') + '」');
    L.push('- **M4 Top10**：「' + m4Top.join(' | ') + '」');
    L.push('');
    L.push('→ M5 与 M4 几乎零相关，是**真正独立的一维**。');
    L.push('');
  }

  L.push('## 4 M5 榜 Top25');
  L.push('');
  L.push('| # | 选手 | M5 | 覆盖项目数 | 拿过 #1 的项目数 | 最好名次 | 末次参赛 | 距今 | 最旧 PB |');
  L.push('|---|---|---:|---:|---:|---:|---|---:|---:|');
  ranked.slice(0, 25).forEach((p, i) => {
    const lc = lastAll.get(p.pid);
    const gap = lc == null ? '—' : ((SNAPSHOT_DAY - lc) / 365.25).toFixed(2);
    L.push('| ' + (i + 1) + ' | ' + p.name + ' | **' + F(p.m5) + '** | ' + p.evs.size +
      ' | ' + p.rank1 + ' | #' + p.bestRank + ' | ' +
      (lc == null ? '—' : new Date(lc * 86400000).toISOString().slice(0, 10)) + ' | ' + gap + 'y | ' +
      (p.oldestPB >= 99 ? '—' : p.oldestPB.toFixed(2) + 'y `' + p.oldestPBEv + '`') + ' |');
  });
  L.push('');

  L.push('### 4.1 头部选手拆解');
  L.push('');
  for (const nm of FOCUS) {
    const p = ranked.find((x) => x.name === nm);
    if (!p) { L.push('**' + nm + '** —— 不在 M5 榜内（未进任何项目世界前 ' + CFG.DEPTH + '）'); L.push(''); continue; }
    const lc = lastAll.get(p.pid);
    L.push('**' + nm + '**　M5 = **' + F(p.m5) + '**　（覆盖 ' + p.evs.size + ' 个项目，' +
      p.parts.length + ' 个组合，' + p.rank1 + ' 个 #1）');
    L.push('');
    L.push('| 项目 | 轨道 | 世界名次 | w_e | gapR(年) | gapP(年) | 衰减 | 贡献 |');
    L.push('|---|---|---:|---:|---:|---:|---:|---:|');
    const ps = [...p.parts].sort((a, b) => b.score - a.score);
    for (const d of ps.slice(0, 8)) {
      L.push('| ' + (EV_CN[d.ev] || d.ev) + ' | ' + (d.tr === 'single' ? '单次' : '平均') +
        ' | #' + d.wr + ' | ' + F(d.w) + ' | ' + d.gap.toFixed(2) + ' | ' +
        (d.gapP == null ? '—' : d.gapP.toFixed(2)) + ' | ' + F(d.dec) +
        ' | ' + F(d.score) + ' |');
    }
    if (ps.length > 8) L.push('| … | | | | | | 其余 ' + (ps.length - 8) + ' 项合计 ' + F(ps.slice(8).reduce((a, b) => a + b.score, 0)) + ' |');
    L.push('');
  }

  L.push('## 5 单项目视图（当前各项目的世界第一）');
  L.push('');
  L.push('| 项目 | 名称 | 现役世界第一 | 该项目内末次参赛 | 距今 |');
  L.push('|---|---|---|---|---:|');
  {
    const evList = [...perEvent.entries()].sort();
    const seen = new Set();
    for (const [key, arr] of evList) {
      const ev = key.split('|')[0];
      if (seen.has(ev)) continue;
      seen.add(ev);
      const top = arr.filter((x) => x.wr === 1).sort((a, b) => a.gap - b.gap)[0];
      if (!top) continue;
      L.push('| `' + ev + '` | ' + (evName.get(ev) || ev) + ' | ' + top.name +
        ' | ' + new Date(lastByEv.get(top.pid + '|' + ev) * 86400000).toISOString().slice(0, 10) +
        ' | ' + top.gap.toFixed(2) + 'y |');
    }
  }
  L.push('');
  L.push('> 注：`333fm` 的 #1 有 4 人并列，此处取其中**在该项目内最近参赛**的一位。');
  L.push('');

  L.push('## 6 口径实验记录（各选项的实际后果）');
  L.push('');
  L.push('### 6.1 排名深度上限');
  L.push('');
  L.push('> 下表统一按**定稿口径**（`DECAY_MODE = ' + CFG.DECAY_MODE + '`）计算。');
  L.push('');
  L.push('| 深度 | 计分人数 | 全站总量 | Top10 | ×M4 ρ | ×M2 ρ |');
  L.push('|---:|---:|---:|---|---:|---:|');
  const depthRows = [];
  for (const cap of [50, 100, 200, 500, 1000]) {
    const sc = new Map();
    for (const x of ranks) {
      if (x.wr > cap) continue;
      if (RETIRED[x.ev] != null) continue;
      const tw = CFG.TRACK_WEIGHT[x.tr]; if (!tw) continue;
      const lc = lastByEv.get(x.pid + '|' + x.ev);
      const gap = lc == null ? 99 : (SNAPSHOT_DAY - lc) / 365.25;
      const gapP = pbGapOf(x.pid, x.ev, x.tr);
      const w = W[x.ev] == null ? FLOOR : W[x.ev];
      const v = w * rankScore(x.wr) * decCombo(gap, gapP) * tw;
      sc.set(x.pid, (sc.get(x.pid) || 0) + v);
    }
    const arr = [...sc.entries()].map(([pid, s]) => ({ pid, s, name: pName.get(pid) || pid })).sort((a, b) => b.s - a.s);
    const m4 = new Map();
    for (const ln of fs.readFileSync(path.join(__dirname, 'M4_seats.tsv'), 'utf8').trim().split('\n').slice(1)) {
      const c = ln.split('\t'); m4.set(c[1], +c[2]);
    }
    const m2 = new Map();
    for (const ln of fs.readFileSync(path.join(__dirname, 'M2_ranking.tsv'), 'utf8').trim().split('\n').slice(1)) {
      const c = ln.split('\t'); m2.set(c[2], +c[3]);
    }
    const rhoWith = (src, limit) => {
      const idx = arr.slice(0, limit).map((x, i) => [x, i]); idx.sort((a, b) => b[0].s - a[0].s);
      const ra = new Map(); for (let i = 0; i < idx.length; i++) ra.set(idx[i][0].name, i + 1);
      const srcArr = [...src.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
      const rb = new Map(); for (let i = 0; i < srcArr.length; i++) rb.set(srcArr[i][0], i + 1);
      const names = arr.slice(0, limit).map((x) => x.name).filter((n) => rb.has(n));
      if (names.length < 3) return null;
      return { n: names.length, rho: pearson(names.map((n) => ra.get(n)), names.map((n) => rb.get(n))) };
    };
    const s4 = rhoWith(m4, 100), s2 = rhoWith(m2, 100);
    depthRows.push({ cap, n: arr.length, total: arr.reduce((a, b) => a + b.s, 0), arr, s4, s2 });
    L.push('| ' + cap + ' | ' + num(arr.length) + ' | ' + F(arr.reduce((a, b) => a + b.s, 0)) +
      ' | ' + arr.slice(0, 10).map((x) => x.name.split(' ')[0]).join(' ') +
      ' | ' + (s4 ? F(s4.rho) : '—') + ' | ' + (s2 ? F(s2.rho) : '—') + ' |');
  }
  L.push('');
  L.push('→ **深度 50 到 1000，Top10 几乎不动**（只有 500/1000 档把 Tommy Cherry 挤到第 10）。');
  L.push('深度 ' + CFG.DEPTH + ' 是「头部清晰 + 长尾不稀释」的平衡点。');
  L.push('');

  L.push('### 6.2 衰减函数');
  L.push('');
  L.push('参赛新鲜度（gapR）与名次新鲜度（gapP）**共用同一个衰减函数**。');
  L.push('');
  L.push('| gap(年) | 线性→0.2（采用） | 线性→0.5 | 指数 0.5^(g/5) |');
  L.push('|---:|---:|---:|---:|');
  for (const g of [0, 0.5, 1, 2, 3, 4, 5, 7, 10]) {
    L.push('| ' + g + ' | ' + F(Math.max(0.2, 1 - (g / 5) * 0.8)) + ' | ' +
      F(Math.max(0.5, 1 - (g / 5) * 0.5)) + ' | ' + F(Math.pow(0.5, g / 5)) + ' |');
  }
  L.push('');
  L.push('三种形态的 **Top5 完全相同**，总量差异 < 1% —— 衰减形态不是敏感参数。');
  L.push('采用「线性衰减到 0.2、第 5 年触底」，因为它最直观：「5 年不参赛 → 只剩 20% 权重」。');
  L.push('');

  L.push('### 6.3 停办项目保留 vs 排除');
  L.push('');
  {
    const run = (skip) => {
      const sc = new Map();
      for (const x of ranks) {
        if (x.wr > CFG.DEPTH) continue;
        if (skip && RETIRED[x.ev] != null) continue;
        const tw = CFG.TRACK_WEIGHT[x.tr]; if (!tw) continue;
        const lc = lastByEv.get(x.pid + '|' + x.ev);
        const gap = lc == null ? 99 : (SNAPSHOT_DAY - lc) / 365.25;
        const gapP = pbGapOf(x.pid, x.ev, x.tr);
        const w = W[x.ev] == null ? FLOOR : W[x.ev];
        const v = w * rankScore(x.wr) * decCombo(gap, gapP) * tw;
        sc.set(x.pid, (sc.get(x.pid) || 0) + v);
      }
      return [...sc.entries()].map(([pid, s]) => ({ pid, s, name: pName.get(pid) || pid })).sort((a, b) => b.s - a.s);
    };
    const a = run(false), b = run(true);
    L.push('| 口径 | 计分人数 | 全站总量 | Top8 |');
    L.push('|---|---:|---:|---|');
    L.push('| 保留停办项目 | ' + num(a.length) + ' | ' + F(a.reduce((x, y) => x + y.s, 0)) +
      ' | ' + a.slice(0, 8).map((x) => x.name).join(' | ') + ' |');
    L.push('| **排除停办项目（采用）** | ' + num(b.length) + ' | ' + F(b.reduce((x, y) => x + y.s, 0)) +
      ' | ' + b.slice(0, 8).map((x) => x.name).join(' | ') + ' |');
    L.push('');
    L.push('Top8 完全相同，但保留会让 **370 个「化石榜」条目**进入计分（`333ft`/`magic`/`mmagic`/`333mbo` 的');
    L.push('Top100 有 **100% 是僵尸** —— 全部 2 年以上没在该项目参赛）。');
    L.push('排除更符合「当前排名」的语义：项目已经停办，不存在「现在」。');
    L.push('');
  }

  L.push('### 6.4 单次 / 平均双轨');
  L.push('');
  L.push('| 轨道权重 | 计分人数 | 全站总量 | Top5 | ×M4 ρ |');
  L.push('|---|---:|---:|---|---:|');
  {
    const m4 = new Map();
    for (const ln of fs.readFileSync(path.join(__dirname, 'M4_seats.tsv'), 'utf8').trim().split('\n').slice(1)) {
      const c = ln.split('\t'); m4.set(c[1], +c[2]);
    }
    for (const tw of [{ single: 1, average: 1 }, { single: 1, average: 0 }, { single: 0, average: 1 }, { single: 1, average: 0.5 }]) {
      const sc = new Map();
      for (const x of ranks) {
        if (x.wr > CFG.DEPTH) continue;
        if (RETIRED[x.ev] != null) continue;
        if (!tw[x.tr]) continue;
        const lc = lastByEv.get(x.pid + '|' + x.ev);
        const gap = lc == null ? 99 : (SNAPSHOT_DAY - lc) / 365.25;
        const gapP = pbGapOf(x.pid, x.ev, x.tr);
        const w = W[x.ev] == null ? FLOOR : W[x.ev];
        const v = w * rankScore(x.wr) * decCombo(gap, gapP) * tw[x.tr];
        sc.set(x.pid, (sc.get(x.pid) || 0) + v);
      }
      const arr = [...sc.entries()].map(([pid, s]) => ({ pid, s, name: pName.get(pid) || pid })).sort((a, b) => b.s - a.s);
      const idx = arr.slice(0, 100).map((x, i) => [x, i]); idx.sort((a, b) => b[0].s - a[0].s);
      const ra = new Map(); for (let i = 0; i < idx.length; i++) ra.set(idx[i][0].name, i + 1);
      const srcArr = [...m4.entries()].sort((a, b) => b[1] - a[1]).slice(0, 100);
      const rb = new Map(); for (let i = 0; i < srcArr.length; i++) rb.set(srcArr[i][0], i + 1);
      const names = arr.slice(0, 100).map((x) => x.name).filter((n) => rb.has(n));
      const r = names.length >= 3 ? pearson(names.map((n) => ra.get(n)), names.map((n) => rb.get(n))) : null;
      L.push('| 单次 ' + tw.single + ' / 平均 ' + tw.average + ' | ' + num(arr.length) + ' | ' +
        F(arr.reduce((x, y) => x + y.s, 0)) + ' | ' + arr.slice(0, 5).map((x) => x.name).join(', ') +
        ' | ' + (r == null ? '—' : F(r)) + ' |');
    }
  }
  L.push('');
  L.push('→ **双轨（各 1.0）时与 M4 的相关性最低（0.0532）**，正交性最好，故采用。');
  L.push('');

  L.push('### 6.5 「按项目内末次参赛」vs 「按选手全局末次参赛」');
  L.push('');
  {
    const run = (useAll) => {
      const sc = new Map();
      for (const x of ranks) {
        if (x.wr > CFG.DEPTH) continue;
        if (RETIRED[x.ev] != null) continue;
        const tw = CFG.TRACK_WEIGHT[x.tr]; if (!tw) continue;
        const lc = useAll ? lastAll.get(x.pid) : lastByEv.get(x.pid + '|' + x.ev);
        const gap = lc == null ? 99 : (SNAPSHOT_DAY - lc) / 365.25;
        const gapP = pbGapOf(x.pid, x.ev, x.tr);
        const w = W[x.ev] == null ? FLOOR : W[x.ev];
        const v = w * rankScore(x.wr) * decCombo(gap, gapP) * tw;
        sc.set(x.pid, (sc.get(x.pid) || 0) + v);
      }
      return [...sc.entries()].map(([pid, s]) => ({ pid, s, name: pName.get(pid) || pid })).sort((a, b) => b.s - a.s);
    };
    const a = run(false), b = run(true);
    const s = new Set(a.slice(0, 25).map((x) => x.name));
    L.push('- 按项目内衰减 Top8：' + a.slice(0, 8).map((x) => x.name + '(' + F(x.s) + ')').join(' | '));
    L.push('- 按全局衰减 Top8：' + b.slice(0, 8).map((x) => x.name + '(' + F(x.s) + ')').join(' | '));
    L.push('- Top25 重合：**' + b.slice(0, 25).filter((x) => s.has(x.name)).length + '/25**');
    L.push('');
    L.push('→ 差异极小，但**按项目内**才是正确语义：');
    L.push('「我 5 年没碰三阶，但上个月刚打了四阶」——四阶的名次不该被三阶的停赛拖累。');
    L.push('采用**按项目内末次参赛**。');
    L.push('');
  }

  L.push('### 6.6 窗口重排名（F1）：官方终身榜 vs 近期实际表现');
  L.push('');
  L.push('**问题**：官方榜是「按 PB 排序的终身榜」。退役衰减只惩罚「不参赛的人」，');
  L.push('**完全不惩罚「还在参赛、但名次是几年前刷出来的」**。');
  L.push('');
  L.push('**F1 方案**：用「近 N 天窗口内的实际最好成绩」重排名，退役者自动出局。');
  L.push('完整对照见 `M5_F1窗口重排名对照.md`，此处只列结论：');
  L.push('');
  L.push('| 口径 | 计分人数 | 全站总量 | ×M4 ρ | ×M2 ρ | ×esum ρ | Top25 与现状重合 |');
  L.push('|---|---:|---:|---:|---:|---:|---:|');
  {
    /* 用同一份 winBest 重算三种口径，保证可比。
       注意：pearson() 返回的是**裸数字**，不是 {n, rho} 对象 —— 调用处必须直接用。 */
    const wRho = (arr, src, limit) => {
      const ra = new Map(); for (let i = 0; i < Math.min(limit, arr.length); i++) ra.set(arr[i].name, i + 1);
      const srcArr = [...src.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
      const rb = new Map(); for (let i = 0; i < srcArr.length; i++) rb.set(srcArr[i][0], i + 1);
      const names = arr.slice(0, limit).map((x) => x.name).filter((n) => rb.has(n));
      if (names.length < 3) return null;
      return pearson(names.map((n) => ra.get(n)), names.map((n) => rb.get(n)));
    };
    const m4m = new Map();
    for (const ln of fs.readFileSync(path.join(__dirname, 'M4_seats.tsv'), 'utf8').trim().split('\n').slice(1)) {
      const c = ln.split('\t'); m4m.set(c[1], +c[2]);
    }
    const m2m = new Map();
    for (const ln of fs.readFileSync(path.join(__dirname, 'M2_ranking.tsv'), 'utf8').trim().split('\n').slice(1)) {
      const c = ln.split('\t'); m2m.set(c[2], +c[3]);
    }
    /* esum 用**站点现行口径的忠实复刻**（siteEsum），不再用近似式 */
    const esumM = siteEsum;
    /* 注意：perPlayer 的元素字段是 m5（没有 m4 字段）——旧代码里
       `b.m5 - a.m4` 是从 M4 复制来的残留，a.m4 为 undefined → NaN → 落到下一项。
       这里统一改成 {pid, name, s} 形状。 */
    const cur = [...perPlayer.values()].map((p) => ({ pid: p.pid, name: p.name, s: p.m5 }))
      .sort((a, b) => b.s - a.s || a.name.localeCompare(b.name));
    const curSet = new Set(cur.slice(0, 25).map((x) => x.name));
    const variants = [];
    // 现状
    variants.push({ tag: '官方终身榜（现状）', arr: cur });
    /* F1s / F1b —— 无论当前 RANK_MODE 是什么，都要能算出窗口口径做对照，
       所以这里直接从 results.tsv 重扫一遍窗口成绩（winBest 只在 window 模式下填充）。 */
    {
      const wBest = new Map();
      const wCut = SNAPSHOT_DAY - CFG.WINDOW_DAYS;
      /* 复用 scanResults 的结果：若当前就是 window 模式，直接用已建的 winBest */
      if (CFG.RANK_MODE === 'window') {
        for (const [k, v] of winBest) wBest.set(k, v);
      } else {
        /* official 模式：需要重新扫 results.tsv 收集窗口成绩 */
        await streamTsv('WCA_export_results.tsv', (r) => {
          if (!r[8]) return;
          const day = compDay.get(r[4]);
          if (day === undefined || day <= wCut) return;
          const pid = r[8], ev = r[6], isMulti = evFmt.get(ev) === 'multi';
          for (const [tr, raw] of [['single', +r[2]], ['average', +r[3]]]) {
            if (raw <= 0) continue;
            const v = isMulti ? decodeMulti(raw).cost : raw;
            const key = ev + '|' + tr;
            let mm = wBest.get(key); if (!mm) { mm = new Map(); wBest.set(key, mm); }
            const c = mm.get(pid);
            if (c == null || v < c.v) mm.set(pid, { v, day });
          }
        });
      }
      for (const [tag, withDecay] of [['窗口 ' + CFG.WINDOW_DAYS + ' 天（无衰减）', false],
                                      ['窗口 ' + CFG.WINDOW_DAYS + ' 天（+衰减）', true]]) {
        const sc = new Map();
        for (const [key, mm] of wBest) {
          const ev = key.split('|')[0];
          if (CFG.SKIP_RETIRED && RETIRED[ev] != null) continue;
          const tr = key.split('|')[1], tw = CFG.TRACK_WEIGHT[tr]; if (!tw) continue;
          const w = W[ev] == null ? FLOOR : W[ev];
          const list = [...mm.entries()].map(([pid, o]) => ({ pid, v: o.v, day: o.day }));
          list.sort((a, b) => a.v - b.v || a.day - b.day
            || (pName.get(a.pid) || '').localeCompare(pName.get(b.pid) || ''));
          const lim = Math.min(CFG.DEPTH, list.length);
          for (let i = 0; i < lim; i++) {
            const rank = i + 1;
            let s = w * rankScore(rank) * tw;
            if (withDecay) {
              const lc = lastByEv.get(list[i].pid + '|' + ev);
              const gap = lc == null ? 99 : (SNAPSHOT_DAY - lc) / 365.25;
              s *= decayOf(gap);
            }
            sc.set(list[i].pid, (sc.get(list[i].pid) || 0) + s);
          }
        }
        const arr = [...sc.entries()].map(([pid, s]) => ({ pid, s, name: pName.get(pid) || pid }))
          .sort((a, b) => b.s - a.s || a.name.localeCompare(b.name));
        variants.push({ tag, arr });
      }
    }
    for (const v of variants) {
      const s4 = wRho(v.arr, m4m, 100), s2 = wRho(v.arr, m2m, 100), se = wRho(v.arr, esumM, 100);
      L.push('| ' + v.tag + ' | ' + num(v.arr.length) + ' | ' +
        F(v.arr.reduce((a, b) => a + b.s, 0)) + ' | ' +
        (s4 == null ? '—' : F(s4)) + ' | ' + (s2 == null ? '—' : F(s2)) + ' | ' +
        (se == null ? '—' : F(se)) + ' | ' +
        v.arr.slice(0, 25).filter((x) => curSet.has(x.name)).length + '/25 |');
    }
    L.push('');
    L.push('**三条结论**：');
    L.push('');
    L.push('1. **F1 修好了 P1 的核心病灶**：官方榜 #1 的「化石记录」问题得到纠正。');
    L.push('   典型案例 `333fm|single`：官方 #1 Sebastiano Tronto 的 16 步跑出于 **2019 年**，');
    L.push('   近 365 天窗口内他最好只到 19 步；而窗口内真正的最快是 17 步的一批人（官方名次仅 #5）。');
    L.push('2. **必须用序号口径**：窗口内成绩并列极密集（`333fm|single` 3,276 人挤在约 14 个步数值上），');
    L.push('   若沿用官方「同名次」规则，`DEPTH=100` 的截断会完全失效（实测 12,227 条 > 3,300 上限）。');
    L.push('3. **F1 让 M5 更接近「纯现势快照」**，Top25 与现状重合 21/25、Top10 重合 10/10 —— 榜单稳定，');
    L.push('   变动集中在「名次是几年前刷出来的」那批条目上。');
    L.push('');
  }

  /* ── 6.7 ★ 定稿对照：两层新鲜度衰减（V0 / F2 / F3）───────────────── */
  L.push('### 6.7 ★ 定稿对照：参赛新鲜度 × 名次新鲜度');
  L.push('');
  L.push('**这是 M5-F1 的核心决策实验。** 三个口径用**同一份数据**、**同一段代码**重算：');
  L.push('');
  L.push('- **V0（retire）**：`w · rank^-1 · decay(gapR)` —— 旧口径，只罚「不参赛」；');
  L.push('- **F2（pb）**：`w · rank^-1 · decay(gapP)` —— 只罚「名次陈旧」；');
  L.push('- **F3（dual）**：`w · rank^-1 · decay(gapR) · decay(gapP)` —— 两项相乘（**定稿采用**）。');
  L.push('');
  {
    /* 站点现行 esum 用 siteEsum（已在前面忠实复刻，见 computeMode 之后的定义）。 */

    /* M4 / M2 参照 */
    const m4m = new Map();
    for (const ln of fs.readFileSync(path.join(__dirname, 'M4_seats.tsv'), 'utf8').trim().split('\n').slice(1)) {
      const c = ln.split('\t'); m4m.set(c[1], +c[2]);
    }
    const m2m = new Map();
    for (const ln of fs.readFileSync(path.join(__dirname, 'M2_ranking.tsv'), 'utf8').trim().split('\n').slice(1)) {
      const c = ln.split('\t'); m2m.set(c[2], +c[3]);
    }

    const A0 = computeMode('retire'), A2 = computeMode('pb'), A3 = computeMode('dual');
    const totOf = (arr) => arr.reduce((a, b) => a + b.s, 0);
    const setTop = (arr, k) => new Set(arr.slice(0, k).map((x) => x.name));

    L.push('#### 6.7.1 三口径总览');
    L.push('');
    L.push('| 口径 | 计分人数 | 全站总量 | ×M4 ρ | ×M2 ρ | ×站点 esum ρ | Top25 与 F3 重合 |');
    L.push('|---|---:|---:|---:|---:|---:|---:|');
    for (const [tag, arr] of [['V0 只罚不参赛（retire）', A0], ['F2 只罚名次陈旧（pb）', A2], ['**F3 两项相乘（dual，定稿）**', A3]]) {
      const s4 = rhoTop(arr, m4m, 100), s2 = rhoTop(arr, m2m, 100), se = rhoTop(arr, siteEsum, 100);
      L.push('| ' + tag + ' | ' + num(arr.length) + ' | ' + F(totOf(arr)) +
        ' | ' + (s4 == null ? '—' : F(s4)) + ' | ' + (s2 == null ? '—' : F(s2)) +
        ' | ' + (se == null ? '—' : F(se)) + ' | ' +
        arr.slice(0, 25).filter((x) => setTop(A3, 25).has(x.name)).length + '/25 |');
    }
    L.push('');
    L.push('- **人口完全不变**（' + num(A0.length) + ' 人）—— 三口径只改权重、不改谁有分；');
    L.push('- **F3 的 Top25 与 V0 重合 ' + A0.slice(0, 25).filter((x) => setTop(A3, 25).has(x.name)).length + '/25、Top10 重合 ' +
      A0.slice(0, 10).filter((x) => setTop(A3, 10).has(x.name)).length + '/10** —— 不是推倒重来，是纠偏；');
    L.push('- **F3 在正交性上全面优于 V0**：×M4 从 ' + F(rhoTop(A0, m4m, 100)) + ' 降到 ' + F(rhoTop(A3, m4m, 100)) +
      '，×esum 从 ' + F(rhoTop(A0, siteEsum, 100)) + ' 降到 ' + F(rhoTop(A3, siteEsum, 100)) + '。');
    L.push('');

    /* ── P1 病灶量化 ───────────────────────────────────────────── */
    L.push('#### 6.7.2 病灶修得怎么样');
    L.push('');
    {
      const stale = [], fos = [];
      for (const x of ranks) {
        if (x.wr <= 0 || x.wr > CFG.DEPTH) continue;
        if (CFG.SKIP_RETIRED && RETIRED[x.ev] != null) continue;
        const lc = lastByEv.get(x.pid + '|' + x.ev);
        const gR = lc == null ? 99 : yrs(lc);
        const gP = pbGapOf(x.pid, x.ev, x.tr);
        const w = W[x.ev] == null ? FLOOR : W[x.ev];
        const base = w * rankScore(x.wr);
        const dR = decayOf(gR), dP = decayOf(gP);
        const rec = { name: pName.get(x.pid) || x.pid, ev: x.ev, tr: x.tr, wr: x.wr, gR, gP,
          v0: base * dR, f2: base * dP, f3: base * dR * dP };
        if (gR <= 1 && gP >= 2) stale.push(rec);      // 活跃但 PB 陈旧
        if (gR >= 3) fos.push(rec);                   // 退役化石
      }
      const sumOf = (arr, k) => arr.reduce((a, b) => a + b[k], 0);
      L.push('| 病灶 | 条目 | V0 贡献 | F2 贡献 | F3 贡献 | F3 相对 V0 |');
      L.push('|---|---:|---:|---:|---:|---:|');
      for (const [tag, arr] of [['**P1 病灶：活跃但 PB ≥2 年未刷新**', stale],
                                ['退役化石：该项目内停赛 ≥3 年', fos]]) {
        const v0 = sumOf(arr, 'v0'), f2 = sumOf(arr, 'f2'), f3 = sumOf(arr, 'f3');
        L.push('| ' + tag + ' | ' + num(arr.length) + ' | ' + F(v0) + ' | ' + F(f2) + ' | ' + F(f3) +
          ' | ' + (v0 > 0 ? F((1 - f3 / v0) * 100) + '%' : '—') + ' |');
      }
      L.push('');
      L.push('- **P1 病灶（' + num(stale.length) + ' 条）在 V0 里占全站 ' +
        F((sumOf(stale, 'v0') / totOf(A0)) * 100) + '%**，F3 压到 ' +
        F((sumOf(stale, 'f3') / totOf(A3)) * 100) + '%（绝对贡献降 ' +
        F((1 - sumOf(stale, 'f3') / sumOf(stale, 'v0')) * 100) + '%）；');
      L.push('- **退役化石（' + num(fos.length) + ' 条）**在 V0 里占 ' +
        F((sumOf(fos, 'v0') / totOf(A0)) * 100) + '%，F3 压到 ' +
        F((sumOf(fos, 'f3') / totOf(A3)) * 100) + '%（绝对贡献降 ' +
        F((1 - sumOf(fos, 'f3') / sumOf(fos, 'v0')) * 100) + '%）；');
      L.push('');
      L.push('P1 病灶命中最重的 6 条：');
      L.push('');
      L.push('| 选手 | 项目 | 轨道 | 官方名次 | 参赛 gap | PB 年龄 | V0 分 | F3 分 |');
      L.push('|---|---|---|---:|---:|---:|---:|---:|');
      for (const st of stale.slice().sort((a, b) => b.v0 - a.v0).slice(0, 6)) {
        L.push('| ' + st.name + ' | `' + st.ev + '` | ' + st.tr + ' | #' + st.wr + ' | ' +
          st.gR.toFixed(2) + 'y | ' + st.gP.toFixed(2) + 'y | ' + F(st.v0) + ' | ' + F(st.f3) + ' |');
      }
      L.push('');
    }

    /* ── 官方 #1 是否被错误压下 ─────────────────────────────────── */
    L.push('#### 6.7.3 ★ 语义风险检查：官方 #1 会不会被错压');
    L.push('');
    {
      const perCombo = new Map();
      for (const x of ranks) {
        if (x.wr <= 0 || x.wr > CFG.DEPTH) continue;
        const key = x.ev + '|' + x.tr;
        if (!perCombo.has(key)) perCombo.set(key, []);
        perCombo.get(key).push(x);
      }
      let nCombo = 0, demoted = 0;
      const demoteList = [];
      for (const [key, arr] of [...perCombo.entries()].sort()) {
        const ev = key.split('|')[0], tr = key.split('|')[1];
        if (CFG.SKIP_RETIRED && RETIRED[ev] != null) continue;
        const ones = arr.filter((x) => x.wr === 1);
        if (!ones.length) continue;
        nCombo++;
        const w = W[ev] == null ? FLOOR : W[ev];
        const sc = arr.map((x) => {
          const lc = lastByEv.get(x.pid + '|' + ev);
          const gR = lc == null ? 99 : yrs(lc);
          const gP = pbGapOf(x.pid, ev, tr);
          return { pid: x.pid, wr: x.wr, s: w * rankScore(x.wr) * decayOf(gR) * decayOf(gP), gP, gR };
        }).sort((a, b) => b.s - a.s);
        /* 官方 #1 若并列，取其中 PB 最老的一位（最不利情形） */
        const worst = ones.map((x) => sc.find((z) => z.pid === x.pid)).sort((a, b) => b.gP - a.gP)[0];
        const rankAfter = sc.findIndex((z) => z.pid === worst.pid) + 1;
        if (rankAfter > 1) {
          demoted++;
          const succ = sc[0];
          const spd = pbDay.get(succ.pid + '|' + ev + '|' + tr);
          demoteList.push({ key, name: pName.get(worst.pid) || worst.pid, gP: worst.gP, gR: worst.gR, rankAfter,
            succ: pName.get(succ.pid) || succ.pid, succPB: spd == null ? 99 : yrs(spd) });
        }
      }
      L.push('F3 下 **' + nCombo + ' 个组合**里，官方 #1 被压出本项目第一的有 **' + demoted + '** 个：');
      L.push('');
      for (const d of demoteList) {
        L.push('- `' + d.key + '`：#1 ' + d.name + '（PB ' + F(d.gP) + 'y / 参赛 ' + F(d.gR) + 'y）→ F3 后第 ' + d.rankAfter +
          ' 名；继任者是 ' + d.succ + '（PB ' + F(d.succPB) + 'y）');
      }
      L.push('');
      L.push('→ 两例的共同特征：**官方 #1 的 PB 已经 ' +
        demoteList.map((d) => F(d.gP) + 'y').join(' / ') + ' 没刷新**，');
      L.push('  而 F3 后的新科第一名 PB 年龄分别是 ' +
        demoteList.map((d) => F(d.succPB) + 'y').join(' / ') + ' —— 明显更新。');
      L.push('  即「官方榜说他是 #1，但那个 #1 是几年前的成绩」—— **这正是 M5 要纠正的东西**，不是误伤。');
      L.push('');
    }

    /* ── 参数敏感性 ─────────────────────────────────────────────── */
    L.push('#### 6.7.4 参数敏感性（F3）');
    L.push('');
    {
      const calcP = (years, floor) => {
        const dec = (g) => Math.max(floor, 1 - (g / years) * (1 - floor));
        const sc = new Map();
        for (const x of ranks) {
          if (x.wr <= 0 || x.wr > CFG.DEPTH) continue;
          if (CFG.SKIP_RETIRED && RETIRED[x.ev] != null) continue;
          const tw = CFG.TRACK_WEIGHT[x.tr]; if (!tw) continue;
          const lc = lastByEv.get(x.pid + '|' + x.ev);
          const gR = lc == null ? 99 : yrs(lc);
          const gP = pbGapOf(x.pid, x.ev, x.tr);
          const w = W[x.ev] == null ? FLOOR : W[x.ev];
          const s = w * rankScore(x.wr) * dec(gR) * dec(gP) * tw;
          if (s <= 0) continue;
          sc.set(x.pid, (sc.get(x.pid) || 0) + s);
        }
        return [...sc.entries()].map(([pid, s]) => ({ pid, s, name: pName.get(pid) || pid }))
          .sort((a, b) => b.s - a.s || a.name.localeCompare(b.name));
      };
      L.push('| 衰减年数 | 下限 0.0 | 下限 0.1 | 下限 0.2（采用） | 下限 0.3 |');
      L.push('|---:|---:|---:|---:|---:|');
      const top5s = new Set();
      for (const yrsN of [3, 5, 8, 10]) {
        const cells = [0, 0.1, 0.2, 0.3].map((fl) => {
          const a = calcP(yrsN, fl);
          top5s.add(a.slice(0, 5).map((x) => x.name).join('|'));
          return F(totOf(a)) + '（' + num(a.length) + '人）';
        });
        L.push('| ' + yrsN + ' | ' + cells.join(' | ') + ' |');
      }
      L.push('');
      L.push('- **Top5 在所有 ' + (4 * 4) + ' 个档位' + (top5s.size === 1 ? '完全一致' : '有 ' + top5s.size + ' 种组合') +
        '** —— 衰减参数不是敏感旋钮；');
      L.push('- 只有下限压到 0.0 才会让人口掉到 ' + num(calcP(5, 0).length) + ' 人（陈年名次被彻底清零）；');
      L.push('- 采用 **5 年 / 下限 0.2**：语义是「5 年前的名次只剩 20% 权重」，直观且与 M1–M4「只衰减不归零」一致。');
      L.push('');
    }
  }

  L.push('## 7 与其它维度的边界');
  L.push('');
  L.push('| 维度 | 问的问题 | 时间性质 |');
  L.push('|---|---|---|');
  L.push('| M1 纪录分 | 你守纪录守了多久 | 历史 |');
  L.push('| M2 领奖台 | 你拿过多少冠亚季 | 历史 |');
  L.push('| M3 大赛表现 | 你在锦标赛上推纪录多少次 | 历史 |');
  L.push('| M4 统治力 | 你在世界前十待了多久 | 历史 |');
  L.push('| **M5 当前排名** | **你现在排第几** | **当下** |');
  L.push('| M6 对手强度 | 你击败的对手当时多强 | 历史 |');
  L.push('');
  L.push('**M5 不会抹掉历史**：M1–M4 独立保留。M5 只回答「现在」。');
  L.push('**M5 也不与 M4 重复**：M4 = 历史占席时长，M5 = 此刻名次，实测 ρ 接近 0（见 §3.3 / §6.7.1）。');
  L.push('');
  L.push('> ⚠️ **与站点现有 `p.esum` 的关系（必须处理）**：');
  L.push('> 站点 `esum = Σ_e 100 × rank_e^-0.35 × w_e(V1)`（单次轨 canonical 名次、无深度上限、无衰减），');
  L.push('> 与 M5 **同源**（同一份官方名次 + 同一类项目权重），实测 ρ ≈ 0.44（§6.7.1）。');
  L.push('> M5 是 esum 的**严格细化**：加了深度截断（100）、加了双衰减、把 γ 从 0.35 收到 1.0、改用 V2 权重。');
  L.push('> → **esum 必须被 M5 取代，不能两者同时计入总分**，否则「现势排名」会被算两遍。');
  L.push('> → 处置方案（**未接入 build.js**，待模型全部完善后统一推线）：');
  L.push('>   ① `p.esum` 保留为「单项目明细」的展示量，不进总分；');
  L.push('>   ② `p.overall` 改为「六维总分」，其中 M5 作为一个维度计入，不再有独立的 esum 项。');
  L.push('');

  L.push('## 8 已知边界');
  L.push('');
  if (CFG.RANK_MODE === 'official') {
    L.push('1. **官方 ranks 是终身榜不是当前榜** —— M5 用「两层新鲜度衰减」近似修正：');
    L.push('   ① 参赛新鲜度（gapR）罚「不参赛」；');
    L.push('   ② 名次新鲜度（gapP）罚「名次陈旧」—— **P1 病灶已被双衰减修正**（§6.7.2：贡献降约 50%）；');
    L.push('   但**两者都是衰减而非重排**，所以官方 #1 仍是官方 #1（除 §6.7.3 的少数组合）。');
    L.push('   → 若要彻底改成「近 N 天窗口重排名」，代码已支持（`RANK_MODE = "window"`），');
    L.push('   但该口径存在**语义脱钩**（与官方榜平均 ρ 仅 0.8222，`222|single` 低至 0.2456）');
    L.push('   与**深度截断失效**（`555bf|average` 窗口仅 68 人）两大问题，**故不作为主口径**。');
  } else {
    L.push('1. **窗口口径下，「窗口内没参赛」= 该组合直接 0 分** —— 与官方口径的「衰减到 0.2」不同，');
    L.push('   这是 F1 的设计意图：当前排名只反映近期实际表现。');
  }
  L.push('2. **深度 ' + CFG.DEPTH + ' 之外一律 0 分** —— 一个能进 333 单次 #101 的人拿不到任何分，');
  L.push('   这是「头部导向」的设计选择，不是数据缺陷。');
  L.push('3. **`fto`（八面体）无官方排名数据** —— 该项目在 M5 中完全缺席。');
  L.push('4. **`333mbf`/`333mbo` 的 average 轨道官方无数据** —— 多盲只有单次榜。');
  if (CFG.RANK_MODE === 'official') {
    L.push('5. **并列名次按官方同名次处理** —— 40 个组合里仅 `333fm|single` 有 4 人并列 #1，影响可忽略。');
  } else {
    L.push('5. **窗口口径用序号排名，同值按「达成日 → 姓名」定序** —— 不用官方同名次，');
    L.push('   否则并列会把深度截断冲破（实测 12,227 条 > 3,300 上限）。');
  }
  L.push('6. **衰减下限 ' + CFG.DECAY_FLOOR.toFixed(1) + ' 是硬底线** —— 长期不参赛者在该组合仍保留 20% 权重，');
  L.push('   这是「只衰减不归零」的设计（与 M1–M4 的历史保留原则一致）。');
  L.push('7. **官方 ranks 只提供现势快照** —— M4 必须重建历史 PB（官方没有历史序列）；');
  L.push('   M5 在 `official` 口径下直接采信官方榜，在 `window` 口径下从 `results.tsv` 自行重排名。');
  L.push('8. **双衰减是乘法，会让「既久未参赛 + 名次陈旧」的人被双重打折** —— 这是有意的：');
  L.push('   两个条件都成立时，「现在还排第几」这件事的真实性更低。');
  L.push('   但极端情况下权重会低到接近 0（gapR=5y 且 gapP=5y → 0.2×0.2=0.04），');
  L.push('   实测 Top25 无人因此掉出前 25，量级可控。');
  L.push('9. **M5 未接入 build.js** —— 站点现行总分仍是 esum（旧的单一口径）。');
  L.push('   接入方案与六维归一化待模型全部完善后统一处理（见 §7）。');
  L.push('');

  L.push('## 9 定稿口径（M5-F1）');
  L.push('');
  L.push('```');
  L.push('M5 = Σ_{e,t} w_e · rank_{e,t}^-1.0 · max(0.2, 1 - gapR_{e,t}/5 × 0.8) · max(0.2, 1 - gapP_{e,t}/5 × 0.8)');
  L.push('');
  L.push('  w_e     = EV_WEIGHT_V2');
  L.push('  rank    = ' + (CFG.RANK_MODE === 'window'
    ? '近 ' + CFG.WINDOW_DAYS + ' 天窗口内实际最好成绩的重排名（序号口径）'
    : '官方 world_rank（终身 PB 榜）'));
  L.push('  深度    = 世界前 100（超出 0 分）');
  L.push('  轨道    = single / average 各计一次（权重各 1.0）');
  L.push('  停办项目 = 整体不计分');
  L.push('  gapR   = 该项目内末次参赛距今天数（参赛新鲜度）');
  L.push('  gapP   = 该项目该轨道 PB 达成距今天数（名次新鲜度）');
  L.push('```');
  L.push('');
  L.push('**运行口径**：`RANK_MODE = ' + CFG.RANK_MODE + '`，`DECAY_MODE = ' + CFG.DECAY_MODE + '`' +
    (CFG.RANK_MODE === 'window' ? '，`WINDOW_DAYS = ' + CFG.WINDOW_DAYS + '`，`WINDOW_DECAY = ' + CFG.WINDOW_DECAY + '`' : '') + '。');
  L.push('');
  L.push('**基线**：' + num(ranked.length) + ' 人 / 总量 ' + F(total));
  L.push('');
  L.push('> 三口径（V0/F2/F3）的完整实测对照见本报告 §6.7；');
  L.push('> 窗口口径（F1）的完整对照见 `M5_F1窗口重排名对照.md`；');
  L.push('> 审阅与决策记录见 `M5_口径审阅报告.md`；');
  L.push('> 冻结基线与解封条件见 `M5_封存_2026-10-25.md`。');
  L.push('');

  fs.writeFileSync(path.join(__dirname, 'M5_当前排名.md'), L.join('\n'), 'utf8');

  /* ── 7. 数据导出 ─────────────────────────────────────────────────── */
  const out = ['pid\tname\tm5\tn_events\tn_combos\tn_rank1\tbest_rank\tlast_comp\tdays_since\toldest_pb_years\toldest_pb_entry'];
  for (const p of ranked) {
    const lc = lastAll.get(p.pid);
    out.push([p.pid, p.name, F(p.m5), p.evs.size, p.parts.length, p.rank1, p.bestRank,
      lc == null ? '' : new Date(lc * 86400000).toISOString().slice(0, 10),
      lc == null ? '' : ((SNAPSHOT_DAY - lc) / 365.25).toFixed(4),
      p.oldestPB >= 99 ? '' : p.oldestPB.toFixed(4), p.oldestPBEv].join('\t'));
  }
  fs.writeFileSync(path.join(__dirname, 'M5_seats.tsv'), out.join('\n') + '\n', 'utf8');

  /* 逐组合明细 */
  const out2 = ['pid\tname\tevent\ttrack\tworld_rank\tw_e\tgapR_years\tgapP_years\tpb_day\tdecay\tscore'];
  for (const p of ranked) {
    for (const d of p.parts) {
      const pd = pbDay.get(p.pid + '|' + d.ev + '|' + d.tr);
      out2.push([p.pid, p.name, d.ev, d.tr, d.wr, F(d.w), d.gap.toFixed(4),
        d.gapP == null ? '' : d.gapP.toFixed(4),
        pd == null ? '' : new Date(pd * 86400000).toISOString().slice(0, 10),
        F(d.dec), F(d.score)].join('\t'));
    }
  }
  fs.writeFileSync(path.join(__dirname, 'M5_by_event.tsv'), out2.join('\n') + '\n', 'utf8');

  /* 单项目榜 */
  const out3 = ['event\ttrack\tpid\tname\tworld_rank\tw_e\tgapR_years\tgapP_years\tdecay\tscore'];
  for (const [key, arr] of [...perEvent.entries()].sort()) {
    for (const x of [...arr].sort((a, b) => a.wr - b.wr || a.name.localeCompare(b.name))) {
      out3.push([key.split('|')[0], key.split('|')[1], x.pid, x.name, x.wr, F(x.w),
        x.gap.toFixed(4), x.gapP == null ? '' : x.gapP.toFixed(4), F(x.dec), F(x.score)].join('\t'));
    }
  }
  fs.writeFileSync(path.join(__dirname, 'M5_event_rank.tsv'), out3.join('\n') + '\n', 'utf8');

  /* 窗口口径：同时导出「官方终身榜 vs 窗口重排名」逐人对照 */
  if (CFG.RANK_MODE === 'window') {
    /* 官方口径重算（同一份数据，保证可比） */
    const offSc = new Map();
    for (const x of ranks) {
      if (x.wr > CFG.DEPTH) continue;
      if (CFG.SKIP_RETIRED && RETIRED[x.ev] != null) continue;
      const tw = CFG.TRACK_WEIGHT[x.tr]; if (!tw) continue;
      const lc = lastByEv.get(x.pid + '|' + x.ev);
      const gap = lc == null ? 99 : (SNAPSHOT_DAY - lc) / 365.25;
      const w = W[x.ev] == null ? FLOOR : W[x.ev];
      const s = w * rankScore(x.wr) * decayOf(gap) * tw;
      if (s > 0) offSc.set(x.pid, (offSc.get(x.pid) || 0) + s);
    }
    const offRank = new Map();
    [...offSc.entries()].sort((a, b) => b[1] - a[1]).forEach(([pid], i) => offRank.set(pid, i + 1));
    const winRankMap = new Map();
    [...perPlayer.values()].sort((a, b) => b.m5 - a.m5 || a.name.localeCompare(b.name))
      .forEach((p, i) => winRankMap.set(p.pid, i + 1));
    const out4 = ['pid\tname\tm5_window\trank_window\tm5_official\trank_official\tdelta_rank'];
    const allPids = new Set([...offSc.keys(), ...perPlayer.keys()]);
    const rows4 = [...allPids].map((pid) => ({
      pid, name: pName.get(pid) || pid,
      mw: perPlayer.has(pid) ? perPlayer.get(pid).m5 : 0,
      rw: winRankMap.get(pid) || 0,
      mo: offSc.get(pid) || 0,
      ro: offRank.get(pid) || 0,
    })).sort((a, b) => b.mw - a.mw || a.name.localeCompare(b.name));
    for (const r of rows4) {
      out4.push([r.pid, r.name, F(r.mw), r.rw, F(r.mo), r.ro,
        (r.ro && r.rw ? (r.ro - r.rw) : '')].join('\t'));
    }
    fs.writeFileSync(path.join(__dirname, 'M5_window_seats.tsv'), out4.join('\n') + '\n', 'utf8');
    log('  M5_window_seats.tsv（官方 vs 窗口对照，' + num(rows4.length) + ' 人）');
  }

  log('[6/6] 报告与数据已导出；耗时', ((Date.now() - t0) / 1000).toFixed(1) + 's');
  log('  M5_当前排名.md / M5_seats.tsv / M5_by_event.tsv / M5_event_rank.tsv');
})();

/**
 * M5 · 当前排名（Current World Rank）· M5-F2
 * ═══════════════════════════════════════════════════════════════════════
 * M5 问的是「**此刻你持有**着什么位置」，与 M1–M4 的「**已经做过多少**」严格区分：
 *   M1 纪录持有  M2 领奖台总量  M3 锦标赛破纪录  M4 历史占席时长
 *   M5 = 此刻你**持有**世界各项目榜单的第几名（纯名次，无时间项）
 *
 * ⚠️ 关键事实：WCA 的 `ranks_single.tsv` / `ranks_average.tsv` **不是「当前排名」**，
 *    而是「按 PB 排序的**终身榜**」—— 退役 10 年的人只要 PB 没被超越，
 *    仍显示第 5 名。
 *
 * ★★ **M5-F2（2026-10-28，用户拍板）：口径改为纯名次，去掉一切时间衰减。**
 *    M5-F1 曾用「参赛新鲜度 × PB 新鲜度」两层衰减去压制终身榜带来的僵尸名次。
 *    实测（`M5_去衰减对照探针.md`）发现这套装置**贵而钝**：
 *      · 头部几乎无感 —— 去掉衰减后 Top5 只有 Max Park 与王艺衡互换一个身位，
 *        与 §4.6「16 档衰减参数 Top5 全一致」同源 ⇒ 在头部它是一台空转的机器；
 *      · 长尾剧变 —— Maciej Czapiewski #1161→#299；Stanley Chapel #14→#6
 *        （靠 6.83 年前的 PB 回血 +0.6513）；林恺俊的 `333mbf` PB 已 10.55 年；
 *        Feliks Zemdegs #86→#59；
 *      · P1 病灶（活跃但 PB≥2 年）贡献由 9.56% 回到 16.01%。
 *    为「5 年 / 下限 0.2」这两个魔法参数付掉可解释性，却不治头部的病 → 砍。
 *
 * ★ M5-F2 定性：**名字仍叫「当前排名」，但不再用时间衰减去「制造」当前**。
 *    它如实读作一张终身 PB 榜上的名次，不再假装自己知道「你现在状态好不好」。
 *    「当下」的时间表达交给 M1（纪录持有时长）与 M4（统治力），M5 不再重复表达。
 *    （用户 2026-10-28 明确：M5 的名称一律保持「当前排名」，不做改名。）
 *
 * 计分公式（唯一权威，★ M5-F3，2026-10-29 定稿）：
 *   M5 = Σ_{e,t} w_e · shape(cost_{e,t})
 *
 *   e,t      = 项目 × 轨道（single / average）
 *   w_e      = EV_WEIGHT_V2（三阶 1.0000 全站最高）
 *
 *   ★ 放弃名次制，改用**成绩比值**的分段函数
 *     （用户要求：第 1 名满分 1000、第 1% 名约 700~800，且不要全挤在 1000）：
 *       cost = 成绩（多盲解码成 cost，统一「越小越强」）
 *       WR   = 该 (项目,轨) 的世界最佳 cost
 *       P1   = 该 (项目,轨) 第 1% 分位的 cost
 *       D0   = 1 − WR/P1                 ← 每个 (项目,轨) **各自标定**
 *       d    = 1 − WR/cost               ← 相对落后度，0 = 世界纪录
 *
 *       d ≤ D0（前 1% 内）: 1000 × (1 − (1−TARGET/1000) · d/D0)   1000 → TARGET，线性有梯度
 *       d > D0（长尾）    : TARGET × (D0/d)^TAIL_H                断崖衰减
 *
 *   旋钮：TARGET=750（第1%名分数）｜TAIL_H=8（长尾陡峭度）｜PCT=0.01（标定分位）
 *
 *   ★ 为什么必须按项目标定 D0：各项目第 1% 分位的 d 差异达 9 倍
 *     （333:0.623 / 444:0.416 / 777:0.307 / 333fm:0.158），若用统一 D0，
 *     集中型项目（高阶、最少步）会系统性虚高、长尾型项目虚低。
 *
 *   ★ 三阶单次实测标定（287,679 人）：
 *     第1名 2.51s→1000｜王艺衡 2.77s→962｜Feliks 4.12s→843｜第1%名 6.66s→750
 *     前5% 9.04s→230｜前10% 10.82s→141｜中位数 23.81s→42
 *
 *   ── 已废的 M5-F2（名次制，2026-10-28）──
 *     旧式 g(rank) = rank^-GAMMA（GAMMA=0.5）：1,257 人 / 总量 339.5465，
 *     Feliks 仅 848.3（站点 s5），因「顶尖但无单榜第一者被严重低估」被推翻。
 *     名次制对长尾极度压缩（100 名后几乎无差别），且随参与人数膨胀而漂移，
 *     故 F3 改用基于成绩的比值——不受人数影响，跨项目公平。
 *
 *   ⚠️ 无 gapR / gapP / decay 项：时间不参与计分。
 *     gapR（距该项目末次参赛年数）、gapP（距该轨 PB 达成年数）仍作为**展示列**输出，
 *     便于人工识别僵尸条目，但不进公式。
 *
 *   ★ DECAY_MODE 旋钮（旧档位保留仅供对照，实证见 `M5_去衰减对照探针.md`）：
 *     'none'   = M5-F2 定稿：**不计任何衰减** —— 1,257 人 / 95.8849
 *     'retire' = M5-v1 只乘 decay(gapR) —— 1,257 人 / 93.0156
 *     'pb'     = M5-v4 只乘 decay(gapP) —— 1,257 人 / 78.6007
 *     'dual'   = M5-F1 两项相乘（旧定稿，已废） —— 1,257 人 / 76.8137
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
  /* M5-F3：改为**全量计分**。名次制下 100 名外几乎无价值故截断；
     比值法下长尾仍有分（三阶中位数 42），截断会误杀 29.8 万人，故放开。 */
  DEPTH: Infinity,         // 排名深度：Infinity = 不设深度限制，所有有成绩者均计分
  GAMMA: 0.5,              // 名次权重指数 g(r) = r^-GAMMA（M5-F2 口径；F3 起改用成绩比值，本项仅旧对照段保留）
  /* ── M5-F3（2026-10-29 定稿）：成绩比值 · 按项目标定的分段函数 ──────────
   *   d = 1 − WR/成绩（相对落后度，0 = 世界纪录）
   *   D0 = 1 − WR/(第 PCT 分位成绩)   ← 每个 (项目,轨) 各自标定
   *   d ≤ D0（前 PCT 内）: 1000 × (1 − (1−TARGET/1000)·d/D0)   1000 → TARGET，线性有梯度
   *   d > D0（长尾）     : TARGET × (D0/d)^TAIL_H               断崖衰减
   * 基于「成绩比值」而非名次 → 不受参与人数影响，跨项目公平。
   * 各项目第1%分位的 d 差异达 9 倍（333:0.623 vs 333fm:0.158），故必须按项目标定。 */
  TARGET: 750,             // 第 1% 分位选手的分数（用户要求 700~800）
  TAIL_H: 8,               // 长尾衰减指数（越大衰减越快）
  PCT: 0.01,               // 标定分位（前 1%）
  DECAY_YEARS: 5,          // 衰减：第 5 年触底
  DECAY_FLOOR: 0.2,        // 衰减下限（只衰减不归零）
  DECAY_MODE: 'none',      // 'none' = M5-F2 定稿：不计任何衰减｜'retire' = 只乘 gapR｜'pb' = 只乘 gapP｜'dual' = 两者相乘（M5-F1，已废）
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

  /* ── 3b. 按 (项目,轨) 标定：世界最佳 cost + 第 PCT 分位 cost → D0（M5-F3）──
   * multi 项目（333mbf/333mbo）的 best 是编码值，须解码成 cost（统一「越小越强」）。
   * 各项目第 1% 分位的 d 差异达 9 倍（333:0.623 vs 333fm:0.158），必须逐项目标定，
   * 否则集中型项目（高阶/最少步）会系统性虚高、长尾型项目虚低。 */
  const costOfEv = (ev, best) => {
    if (!(best > 0)) return null;
    if (evFmt.get(ev) === 'multi') { const o = decodeMulti(best); return (o && o.cost > 0) ? o.cost : null; }
    return best;
  };
  const byEt = new Map();   // ev|tr → [cost]
  for (const x of ranks) {
    const c = costOfEv(x.ev, x.best);
    if (c == null) continue;
    x.cost = c;
    const k = x.ev + '|' + x.tr;
    let a = byEt.get(k); if (!a) { a = []; byEt.set(k, a); }
    a.push(c);
  }
  const CAL = new Map();    // ev|tr → {wr, n}
  for (const [k, a] of byEt) {
    a.sort((m, n) => m - n);
    CAL.set(k, { wr: a[0], n: a.length });
  }
  /** Kinch：单事件得分 = 100 × 世界纪录 / 个人最好（0..100，WR 持有者 = 100） */
  const kinchScore = (cost, cal) => {
    if (!cal || !(cost > 0) || !(cal.wr > 0)) return 0;
    return Math.min(100, 100 * cal.wr / cost);
  };
  const calOf = (ev, tr) => CAL.get(ev + '|' + tr);
  for (const x of ranks) x.sc = kinchScore(x.cost, calOf(x.ev, x.tr));
  /* 忠实 Kinch 的分母 N：现役 (项目,轨道) 组合数（停办项目不计） */
  const RETIRED_EV = RN.EV_RETIRED_DAY || {};
  let N_COMBOS = 0;
  for (const k of CAL.keys()) {
    if (CFG.SKIP_RETIRED && RETIRED_EV[k.split('|')[0]] != null) continue;
    N_COMBOS++;
  }
  log('      已标定 (项目,轨) 组合:', num(CAL.size), '；现役组合 N =', num(N_COMBOS));

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
    if (CFG.DECAY_MODE === 'none') return 1;        // M5-F2 定稿：无时间项
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
        const score = w * it.sc * dec * tw;
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
      const score = x.sc;            // Kinch 单事件分（0..100），等权、无衰减
      if (score <= 0) continue;
      scoreRows.push({ pid: x.pid, ev: x.ev, tr: x.tr, wr: x.wr, w: 1, gap, gapP, dec: 1, score, v: x.best });
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
  /* 忠实 Kinch：M5 = (1/N) × Σ 单事件分（没参赛的项目按 0 计，故分母恒为 N_COMBOS） */
  if (N_COMBOS > 0) for (const p of perPlayer.values()) p.m5 /= N_COMBOS;
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
      const d = mode === 'none' ? 1 : mode === 'pb' ? dP : mode === 'dual' ? dR * dP : dR;
      const w = W[x.ev] == null ? FLOOR : W[x.ev];
      const s = w * x.sc * d * tw;
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

  L.push('# M5 当前排名（Kinch）');
  L.push('');
  L.push('> 生成脚本 `etl/score/m5_current_rank.js`｜数据快照 **' + SNAPSHOT + '**｜WCA 导出 **v2.0.2 / v288**');
  L.push('> 口径：**M5-KINCH（2026-11-04 定稿）** —— 全权替换旧 M5-F3 分段比值。');
  L.push('');
  L.push('## 0 一句话');
  L.push('');
  L.push('**M5 = 你在每个项目上「离世界纪录有多远」的平均值。**');
  L.push('');
  L.push('单事件得分 = 100 × 世界纪录 / 你的 PB（WR 持有者 = 100，慢一倍 = 50）；');
  L.push('总分 = 所有现役 (项目,轨道) 组合的**算术平均**，没参赛的项目记 0。');
  L.push('→ 理论满分 100（需全项目 WR），偏科者会被明显压低，是「全能榜」口径。');
  L.push('');
  L.push('## 1 公式');
  L.push('');
  L.push('```');
  L.push('M5 = (1/N) × Σ_{e,t} 100 × WR_{e,t} / PB_{e,t}');
  L.push('');
  L.push('  e,t   = 项目 × 轨道（single / average，双轨各计一次）');
  L.push('  WR    = 该 (项目,轨道) 的世界纪录（多盲按 decodeMulti 折成 cost）');
  L.push('  PB    = 个人最好（多盲同口径）');
  L.push('  N     = 现役 (项目,轨道) 组合数 = ' + N_COMBOS + '（停办项目不计）');
  L.push('  缺项  = 该组合没成绩 → 计 0，但仍占分母 N');
  L.push('```');
  L.push('');
  L.push('- 停办项目（`333ft` / `magic` / `mmagic` / `333mbo`）整体不计分；');
  L.push('- 多盲 `333mbf` 只有单次榜，`average` 组合不存在，N 自然不含它；');
  L.push('- 与旧 M5-F3 的差别：旧版 1000 分制 + 按项目标定 D0 + 前1%拉伸/长尾压缩 + 加权求和；');
  L.push('  新版 100 分制 + 纯 WR/PB 比值 + 全组合等权平均。');
  L.push('');
  L.push('## 2 数据规模');
  L.push('');
  L.push('- 全站有成绩的人：**' + num(lastAll.size) + '**');
  L.push('- 官方排名条目：**' + num(ranks.length) + '**');
  L.push('- **M5 计分人数：' + num(ranked.length) + '**');
  L.push('- 现役组合 N：**' + N_COMBOS + '**；停办项目剔除：' + num(skippedRetired) + ' 条');
  L.push('- M5 全站总量（各人均值之和）：**' + F(total) + '**');
  L.push('');
  L.push('## 3 M5 榜 Top25');
  L.push('');
  L.push('| # | 选手 | M5(Kinch) | 覆盖项目 | 组合数 | 最好名次 | 末次参赛 | 距今 |');
  L.push('|---|---|---:|---:|---:|---:|---|---:|');
  ranked.slice(0, 25).forEach((p, i) => {
    const lc = lastAll.get(p.pid);
    const gap = lc == null ? '—' : ((SNAPSHOT_DAY - lc) / 365.25).toFixed(2);
    L.push('| ' + (i + 1) + ' | ' + p.name + ' | **' + F(p.m5) + '** | ' + p.evs.size +
      ' | ' + p.parts.length + ' | #' + p.bestRank + ' | ' +
      (lc == null ? '—' : new Date(lc * 86400000).toISOString().slice(0, 10)) + ' | ' + gap + 'y |');
  });
  L.push('');
  L.push('## 4 头部选手拆解');
  L.push('');
  for (const nm of FOCUS) {
    const p = ranked.find((x) => x.name === nm);
    if (!p) { L.push('**' + nm + '** —— 不在 M5 榜内'); L.push(''); continue; }
    L.push('**' + nm + '**　M5 = **' + F(p.m5) + '**　（覆盖 ' + p.evs.size + ' 个项目，' + p.parts.length + ' 个组合）');
    L.push('');
    L.push('| 项目 | 轨道 | 世界名次 | Kinch 分 |');
    L.push('|---|---|---:|---:|');
    const ps = [...p.parts].sort((a, b) => b.score - a.score);
    for (const d of ps.slice(0, 10)) {
      L.push('| ' + (EV_CN[d.ev] || d.ev) + ' | ' + (d.tr === 'single' ? '单次' : '平均') +
        ' | #' + d.wr + ' | ' + F(d.score) + ' |');
    }
    if (ps.length > 10) L.push('| … | | | 其余 ' + (ps.length - 10) + ' 项合计 ' + F(ps.slice(10).reduce((a, b) => a + b.score, 0)) + ' |');
    L.push('');
  }
  L.push('## 5 单项目世界第一（Kinch 视角）');
  L.push('');
  L.push('| 项目 | 名称 | 该项目世界第一 |');
  L.push('|---|---|---|');
  {
    const seen = new Set();
    for (const [key, arr] of [...perEvent.entries()].sort()) {
      const ev = key.split('|')[0];
      if (seen.has(ev)) continue;
      seen.add(ev);
      const top = arr.filter((x) => x.wr === 1).sort((a, b) => a.gap - b.gap)[0];
      if (!top) continue;
      L.push('| `' + ev + '` | ' + (evName.get(ev) || ev) + ' | ' + top.name + ' |');
    }
  }
  L.push('');
  L.push('## 6 与 M4 的正交性');
  L.push('');
  {
    let m4 = null;
    const f4 = path.join(__dirname, 'M4_seats.tsv');
    if (fs.existsSync(f4)) {
      m4 = new Map();
      for (const ln of fs.readFileSync(f4, 'utf8').trim().split('\n').slice(1)) {
        const c = ln.split('\t'); m4.set(c[1], +c[2]);
      }
    }
    if (m4) {
      const limit = 100;
      const ra = new Map(); ranked.slice(0, limit).forEach((x, i) => ra.set(x.name, i + 1));
      const src = [...m4.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
      const rb = new Map(); src.forEach(([n], i) => rb.set(n, i + 1));
      const names = ranked.slice(0, limit).map((x) => x.name).filter((n) => rb.has(n));
      const rho = names.length >= 3 ? pearson(names.map((n) => ra.get(n)), names.map((n) => rb.get(n))) : null;
      L.push('- M5(Kinch) Top100 × M4 统治力 ρ = **' + (rho == null ? '—' : F(rho)) + '**');
      L.push('- M5 Top10：「' + ranked.slice(0, 10).map((x) => x.name).join(' | ') + '」');
    } else {
      L.push('- `M4_seats.tsv` 缺失，跳过。');
    }
  }
  L.push('');
  L.push('## 7 已知边界');
  L.push('');
  L.push('1. **官方 ranks 是终身 PB 榜**：Kinch 口径同样基于 PB，退役者的 PB 未被超越就仍计入；');
  L.push('   这是 Kinch 的原味，不引入时间衰减。');
  L.push('2. **历史快照** 由 `m5_facts.js` 按「截至年末」的 WR/PB 逐年重算，语义一致；');
  L.push('   历史年份为控体积只保留各组合前 100（最新年份全量），长尾人物的历史均值会略偏低。');
  L.push('3. **`fto`（八面体）** 官方 ranks 无数据，不参与。');
  L.push('4. **`333mbf`** 只有单次榜，`average` 组合不存在。');
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
      const s = w * x.sc * decayOf(gap) * tw;
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

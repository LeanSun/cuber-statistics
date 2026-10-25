'use strict';
/* M1 · 纪录维度评分模块（v2 口径）
 *
 * ── 定稿口径（2026-10-24）──────────────────────────────────────
 *   级别价值   WR 1.00 / CR 0.40 / NR 0.15     三级全打折
 *   竞争密度   ρ洲 = 该洲全量选手数 ÷ 全量选手总数
 *              ρ国 = 该国全量选手数 ÷ 全量选手总数
 *              线性比例，不开根号（避免小国刷纪录）
 *   轨道分离   单次 / 平均各自独立计分；总计 = 单次 + 平均
 *   时代折算   f_L(y) = ln(1+N_L(y)) / ln(1+N_L(基准年))
 *              N_L 按**级别各自的口径**取人数：
 *                WR → 全世界累计注册人数
 *                CR → 该洲累计人数
 *                NR → 该国累计人数
 *              年内按月插值取均值；对数形式，非人数比例（理由见文件末尾）
 *   项目系数   不在此处乘，由上层聚合时乘一次（避免重复加权）
 *
 * ── 一条公式 ────────────────────────────────────────────────
 *   单条纪录价值 = 级别价值 × 竞争密度 × 时代折算
 *   track(wr, cr, nr) = 1.0·wr·f_WR + 0.4·ρ洲·cr·f_洲 + 0.15·ρ国·nr·f_国
 *
 *   注意 f 是分开的三个：2010 年的一条大洋洲纪录按 2010 年大洋洲的池子折算，
 *   不按 2010 年全球的池子折算。这是「WR / CR / NR 不能同价」在时间维度上的落实。
 *
 * ── 设计取向（A 方案）──────────────────────────────────────────
 *   CR/NR 在此口径下只剩符号性权重：全球 30 万选手，大洋洲 ρ≈0.048，
 *   即 1 条 WR ≈ 52 条洲纪录。M1 因此主要度量「世界级成就」，
 *   洲/国家纪录保留但不构成排名主力。这是有意为之，不是缺陷。
 *
 * ── 一条纪录只归一级 ──────────────────────────────────────────
 *   既是 WR 又是 CR/NR 的纪录，只按 WR 计入，不重复计数。
 *
 * ── 条数 vs 占有段（防刷分）─────────────────────────────────────
 *   上面 track() 里的 wr/cr/nr 是**条数**。条数口径有一个公开漏洞：
 *   同样一段进步，拆成 4 次破纪录得分是 1 次的 4 倍，等于奖励控成绩。
 *
 *   替代口径已在 etl/score/runs.js 落地：**占有段（Ownership-Run）**。
 *   把阶梯按选手切成段，段 = 从破纪录到被他人打破；段内刷几次不进公式。
 *       credit(R) = ln(v_前值 / v_段内最好值) × min(T, D_cap)/365
 *   性质、证明、真实数据与算例见 M1_占有段口径.md。
 *
 *   本文件里的 recordArea / splitRatio 是上一版过渡方案（按条计面积），
 *   已被 runs.js 取代，保留仅为对照，**不要在新代码里调用**。
 */

/** 级别基础价值 */
const G = Object.freeze({ WR: 1.0, CR: 0.4, NR: 0.15 });

/** 三档轨道 */
const TRACKS = Object.freeze(['single', 'average', 'total']);

/**
 * 构造评分上下文（洲/国人数表 + 全量总数）
 * @param {{contCount:Object<string,number>, natCount:Object<string,number>, total:number}} src
 */
function makeContext(src) {
  const total = Math.max(1, src.total || 0);
  const contCount = src.contCount || {};
  const natCount = src.natCount || {};
  return {
    total,
    rhoC: (cont) => (contCount[cont] || 0) / total,
    rhoN: (nat) => (natCount[nat] || 0) / total,
  };
}

/**
 * 构造「累计注册人数」时间池
 * 输入是全量玩家（detail + roster 合并去重前）的首次参赛年份数组。
 * @param {number[]} startYears 每位选手的首次参赛年
 * @param {number} [baseYear] 基准年（默认取数据中的最大年份）
 */
function makePool(startYears, baseYear) {
  const ys = startYears || [];
  let mn = 9999;
  let mx = 0;
  for (const s of ys) {
    if (!s) continue;
    if (s < mn) mn = s;
    if (s > mx) mx = s;
  }
  if (mn > mx) { mn = 2003; mx = baseYear || 2026; }
  const last = baseYear || mx;
  /* cum[y] = 截至 y 年（含）已注册的累计人数 */
  const cum = {};
  for (let y = mn - 1; y <= last; y++) cum[y] = 0;
  for (const s of ys) {
    if (!s) continue;
    for (let y = Math.max(mn, s); y <= last; y++) cum[y]++;
  }
  const total = cum[last] || 1;
  /** 年内按月均匀插值后的平均累计人数（记录在一年内大致均匀分布） */
  function cumAt(y) {
    const yy = Math.max(mn, Math.min(last, Math.floor(y)));
    const a = cum[yy - 1] || 0;
    const b = cum[yy] || a;
    let s = 0;
    for (let m = 1; m <= 12; m++) s += a + ((b - a) * m) / 12;
    return s / 12;
  }
  const lnTotal = Math.log(1 + (cumAt(last) || total));
  return {
    total,
    baseYear: last,
    cumAt,
    /** 时代折算系数：该年的纪录相对「基准年」的价值，基准年 = 1 */
    yearValue: (y) => Math.log(1 + cumAt(y)) / lnTotal,
  };
}

/**
 * 构造「分级别、分口径」的累计人数池。
 *
 * 为什么需要它：WR / CR / NR 的竞争池不是同一个。
 *   世界纪录的池子是全世界的注册选手；
 *   洲纪录的池子是那个洲的选手；
 *   国家纪录的池子是那个国家的选手。
 * 所以「把当时的人数考虑进去」这句话，对三级纪录要分别执行：
 *   2010 年的一条大洋洲纪录，该按 2010 年大洋洲的池子折算，
 *   而不是按 2010 年全球的池子折算。
 *
 * @param {Array<{y:number, cont?:string, nat?:string}>} people 每位选手的首次参赛年与所属洲/国
 * @param {number} [baseYear] 基准年（默认取最大年份）
 */
function makeScopePool(people, baseYear) {
  const arr = people || [];
  let mn = 9999;
  let mx = 0;
  for (const p of arr) {
    const y = +p.y;
    if (!y) continue;
    if (y < mn) mn = y;
    if (y > mx) mx = y;
  }
  if (mn > mx) { mn = 2003; mx = baseYear || 2026; }
  const last = baseYear || mx;
  const lo = Math.max(1900, mn);

  const g = {};
  const byC = {};
  const byN = {};
  for (let y = lo - 1; y <= last; y++) g[y] = 0;
  function bump(map, key, y) {
    let a = map[key];
    if (!a) { a = {}; for (let t = lo - 1; t <= last; t++) a[t] = 0; map[key] = a; }
    for (let t = y; t <= last; t++) a[t]++;
  }
  for (const p of arr) {
    const y = +p.y;
    if (!y) continue;
    const s = Math.max(lo, y);
    for (let t = s; t <= last; t++) g[t]++;
    if (p.cont) bump(byC, p.cont, s);
    if (p.nat) bump(byN, p.nat, s);
  }

  /** 年内按月均匀插值后的平均累计人数（记录在一年内大致均匀分布） */
  function mid(map, y) {
    const yy = Math.max(lo, Math.min(last, Math.floor(y)));
    const a = map[yy - 1] || 0;
    const b = map[yy] || a;
    let s = 0;
    for (let m = 1; m <= 12; m++) s += a + ((b - a) * m) / 12;
    return s / 12;
  }
  const lnOf = (map) => Math.log(1 + (mid(map, last) || 1));
  const lnG = lnOf(g);
  const lnC = {};
  const lnN = {};

  /**
   * 指定级别与口径的时代折算系数（相对基准年，基准年 = 1）
   * @param {'WR'|'CR'|'NR'} level
   * @param {{cont?:string, nat?:string}} who
   * @param {number} y
   */
  function valueOf(level, who, y) {
    const w = who || {};
    if (level === 'CR' && w.cont && byC[w.cont]) {
      if (!lnC[w.cont]) lnC[w.cont] = lnOf(byC[w.cont]);
      return Math.log(1 + mid(byC[w.cont], y)) / lnC[w.cont];
    }
    if (level === 'NR' && w.nat && byN[w.nat]) {
      if (!lnN[w.nat]) lnN[w.nat] = lnOf(byN[w.nat]);
      return Math.log(1 + mid(byN[w.nat], y)) / lnN[w.nat];
    }
    return Math.log(1 + mid(g, y)) / lnG;
  }

  return {
    baseYear: last,
    total: g[last] || 1,
    globalAt: (y) => mid(g, y),
    contAt: (cont, y) => (byC[cont] ? mid(byC[cont], y) : 0),
    natAt: (nat, y) => (byN[nat] ? mid(byN[nat], y) : 0),
    valueOf,
    /** 兼容旧的单曲线接口 */
    yearValue: (y) => Math.log(1 + mid(g, y)) / lnG,
  };
}

/**
 * 按「年份 → 条数」分布求加权平均时代系数
 * @param {Object<string,number>} yd 例：{2010:3, 2011:5}
 * @param {ReturnType<typeof makePool>} pool
 */
function tFactor(yd, pool) {
  if (!yd || !pool) return 1;
  let num = 0;
  let den = 0;
  for (const y of Object.keys(yd)) {
    const n = +yd[y] || 0;
    if (!n) continue;
    den += n;
    num += n * pool.yearValue(+y);
  }
  return den > 0 ? num / den : 1;
}

/**
 * 按级别分别求时代系数：WR 用全球池、CR 用洲池、NR 用国家池
 * @param {Object<string,number>} yd 年份 → 条数
 * @param {ReturnType<typeof makeScopePool>} pool
 * @param {{cont?:string, nat?:string}} who
 */
function timeFactors(yd, pool, who) {
  if (!yd || !pool || !pool.valueOf) return { WR: 1, CR: 1, NR: 1 };
  const acc = { WR: 0, CR: 0, NR: 0 };
  let den = 0;
  for (const y of Object.keys(yd)) {
    const n = +yd[y] || 0;
    if (!n) continue;
    den += n;
    for (const L of ['WR', 'CR', 'NR']) acc[L] += n * pool.valueOf(L, who, +y);
  }
  if (!den) return { WR: 1, CR: 1, NR: 1 };
  return { WR: acc.WR / den, CR: acc.CR / den, NR: acc.NR / den };
}

/**
 * 单条轨道的分数（含时代折算）
 * @param {{wr?:number, cr?:number, nr?:number}} t
 * @param {number} rhoC
 * @param {number} rhoN
 * @param {number|{WR:number,CR:number,NR:number}} timeFactor 标量或分级系数
 */
function scoreTrack(t, rhoC, rhoN, timeFactor) {
  const wr = t.wr || 0;
  const cr = t.cr || 0;
  const nr = t.nr || 0;
  const tf = timeFactor == null
    ? { WR: 1, CR: 1, NR: 1 }
    : (typeof timeFactor === 'number' ? { WR: timeFactor, CR: timeFactor, NR: timeFactor } : timeFactor);
  return wr * G.WR * tf.WR + cr * G.CR * rhoC * tf.CR + nr * G.NR * rhoN * tf.NR;
}

/**
 * 从旧的 mCalc.rec 还原单次/平均的 NR 条数。
 * 旧字段 nrWS/nrWA 里混入了 wr+cr（历史 bug），必须扣掉才是纯 NR。
 * @param {number[]} rec [wrS, crS, nrWS, wrA, crA, nrWA]
 * @param {number} nrTotal 纯 NR 总条数
 */
function splitNr(rec, nrTotal) {
  const rawS = Math.max(0, (rec[2] || 0) - (rec[0] || 0) - (rec[1] || 0));
  const rawA = Math.max(0, (rec[5] || 0) - (rec[3] || 0) - (rec[4] || 0));
  const sum = rawS + rawA;
  if (sum <= 0) return { nrS: 0, nrA: 0 };
  return { nrS: (nrTotal * rawS) / sum, nrA: (nrTotal * rawA) / sum };
}

/**
 * 选手级评分（不区分项目）
 * @param {{rec:number[], nr:number, cont:string, country:string}} p
 * @param {ReturnType<typeof makeContext>} ctx
 * @param {{pool?:ReturnType<typeof makePool>, yearDist?:Object<string,number>}} [opt]
 *        yearDist 为该选手「年份 → 纪录条数」的完整分布（ETL 由 evS.recPerYear 汇总）
 */
function scorePlayer(p, ctx, opt) {
  const o = opt || {};
  const rec = p.rec || [0, 0, 0, 0, 0, 0];
  const { nrS, nrA } = splitNr(rec, p.nr || 0);
  const rhoC = ctx.rhoC(p.cont);
  const rhoN = ctx.rhoN(p.country);
  let tf = { WR: 1, CR: 1, NR: 1 };
  if (o.pool) {
    tf = o.pool.valueOf
      ? timeFactors(o.yearDist, o.pool, { cont: p.cont, nat: p.country })
      : { WR: tFactor(o.yearDist, o.pool), CR: tFactor(o.yearDist, o.pool), NR: tFactor(o.yearDist, o.pool) };
  }
  const single = scoreTrack({ wr: rec[0], cr: rec[1], nr: nrS }, rhoC, rhoN, tf);
  const average = scoreTrack({ wr: rec[3], cr: rec[4], nr: nrA }, rhoC, rhoN, tf);
  return { single, average, total: single + average, rhoC, rhoN, timeFactor: tf };
}

/**
 * 项目级评分：输入已是「项目 × 轨道 × 级别」的计数矩阵时使用。
 * ETL 完成 evS 拆轨后，直接按此计算即可。
 * @param {Object<string,{wrS?:number,crS?:number,nrS?:number,wrA?:number,crA?:number,nrA?:number}>} evMap
 * @param {{cont:string, country:string}} who
 * @param {ReturnType<typeof makeContext>} ctx
 * @param {{pool?:ReturnType<typeof makePool>, yearDist?:Object<string,Object<string,number>>}} [opt]
 *        yearDist 可给 {single:{y:n}, average:{y:n}}，缺省则两轨同用一份
 */
function scoreEvents(evMap, who, ctx, opt) {
  const o = opt || {};
  const rhoC = ctx.rhoC(who.cont);
  const rhoN = ctx.rhoN(who.country);
  const ydAll = o.yearDist || null;
  const ydS = (ydAll && ydAll.single) || ydAll;
  const ydA = (ydAll && ydAll.average) || ydAll;
  const who2 = { cont: who.cont, nat: who.country };
  const one = { WR: 1, CR: 1, NR: 1 };
  let tfS = one;
  let tfA = one;
  if (o.pool) {
    if (o.pool.valueOf) {
      tfS = timeFactors(ydS, o.pool, who2);
      tfA = timeFactors(ydA, o.pool, who2);
    } else {
      const a = tFactor(ydS, o.pool);
      const b = tFactor(ydA, o.pool);
      tfS = { WR: a, CR: a, NR: a };
      tfA = { WR: b, CR: b, NR: b };
    }
  }
  const out = {};
  for (const eid of Object.keys(evMap || {})) {
    const t = evMap[eid];
    const s = scoreTrack({ wr: t.wrS, cr: t.crS, nr: t.nrS }, rhoC, rhoN, tfS);
    const a = scoreTrack({ wr: t.wrA, cr: t.crA, nr: t.nrA }, rhoC, rhoN, tfA);
    out[eid] = { single: s, average: a, total: s + a };
  }
  return out;
}

/* ── 防刷分：把「破了几次」换成「领先多久」───────────────────────
 *
 * ⚠️ 本节两个函数属于上一版过渡方案，已被 runs.js 的占有段口径取代。
 *    它们把人一段连续的持有切成 k 个独立持有期，会罚拆分罚过头
 *    （同一段进步拆 4 次只剩 1/4）。占有段口径则把 k 彻底消掉：
 *    段内刷几次，G 与 T 都不变。保留此处只为对照历史结论，
 *    新代码请用 runs.js。
 */

/**
 * 一条纪录的进步幅度（对数比，可跨项目相加）
 * @param {number} vPrev 被打破的那条纪录的值
 * @param {number} vCur 新纪录的值
 * @returns {number} ln(vPrev/vCur)；非进步返回 0
 */
function recordGain(vPrev, vCur) {
  const a = +vPrev;
  const b = +vCur;
  if (!(a > 0) || !(b > 0) || b >= a) return 0;
  return Math.log(a / b);
}

/**
 * 面积贡献 = 进步幅度 × 持有期（年）
 * @param {number} vPrev
 * @param {number} vCur
 * @param {number} heldDays 该纪录保持了多少天（ETL 的 rec.held）
 * @param {{capYears?:number}} [opt] capYears 截顶，防止停办项目靠「无人竞争」无限得分
 * @returns {number} 单位：相对进步量·年
 */
function recordArea(vPrev, vCur, heldDays, opt) {
  const o = opt || {};
  const cap = o.capYears == null ? Infinity : o.capYears;
  const years = Math.min(Math.max(0, heldDays || 0) / 365, cap);
  return recordGain(vPrev, vCur) * years;
}

/**
 * 拆分惩罚：k 次等距小幅突破相对单次突破的得分比值
 * k=1 → 1.00，k=2 → 0.75，k=4 → 0.625，k→∞ → 0.50
 * @param {number} k 拆分次数
 */
function splitRatio(k) {
  if (!(k >= 1)) return 0;
  return (k + 1) / (2 * k);
}

/**
 * 汇总项目级分数：乘项目系数后累加（上层聚合用）
 * @param {Object<string,{total:number}>} evScores
 * @param {Object<string,number>} evWeight
 */
function weightedSum(evScores, evWeight, track) {
  const k = track || 'total';
  let sum = 0;
  for (const eid of Object.keys(evScores)) {
    sum += (evScores[eid][k] || 0) * (evWeight[eid] || 0);
  }
  return sum;
}

module.exports = {
  G,
  TRACKS,
  makeContext,
  makePool,
  makeScopePool,
  tFactor,
  timeFactors,
  scoreTrack,
  splitNr,
  scorePlayer,
  scoreEvents,
  weightedSum,
  recordGain,
  recordArea,
  splitRatio,
};

/* ── 为什么时代折算用 ln 而不是人数比例 ────────────────────────────
 *
 * 直觉上「2010 年 8 千人里最强」应值「2020 年 14 万人里最强」的 1/17。
 * 但纪录是极值事件，不是平均事件。极值理论：从同一分布抽 N 个样本，
 * 最大值的期望位置约按 ln(N) 上移（Gumbel 型），不是按 N 上移。
 * 也就是说，参赛人数涨 17 倍，可达到的最高水平只上移约 ln17 ≈ 2.8 倍
 * 的「尺度单位」，而不是 17 倍难度。
 *
 * 更关键的是：纪录的难度取决于「有多少人够得着这条纪录」，
 * 而不是「注册簿上有多少人」。30 万注册者里，常年有实力冲击 WR 的
 * 是极少数；随运动普及，长尾（休闲玩家）增长远快于精英层增长。
 * 用一个远慢于 N 的函数，才符合「精英深度」的真实增长。
 *
 * 实测：ln 形式下 2010 年记录值 2020 年的 0.78 倍、2025 年的 0.74 倍。
 * 若要按人数比例（γ=1），2010 只值 2020 的 0.07 倍，等于宣布
 * 「2008–2014 年的所有纪录几乎无价值」——那不是修正时代差异，
 * 是删除一段历史。
 */

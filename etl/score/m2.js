'use strict';
/* M2 · 赛会领奖台维度（M2-F3 · 2026-10-24）
 *
 * F3 变更（用户 2026-10-24 决定）：
 *   ① **取消单次 / 平均双榜**，M2 领奖台 = 官方名次前三。
 *      理由：锦标赛的「名次」只有一个，官方 `results.pos` 就是它；
 *      自己按 best / avg 各排一遍，会让同一场同一项目产生两个领奖台。
 *   ② 项目分项保留（`per[ev]`），但不再有 `ev|single` / `ev|avg` 两级。
 *   ③ 多区赛（举办国为 X 前缀伪代码，如 XE / XA / XW / XO）归 M3，不进 M2。
 *   F1 的公式与全部常量一个都没动。
 *
 * ── 一句话 ────────────────────────────────────────────────────
 *   一个领奖台值多少分 = 名次折价 × 赛级价格 × 属地规模 × 时代折算 × 项目权重。
 *   四个乘数全部与 M1 共用同一套函数，不另立口径。
 *
 * ── 与 M1 的对应关系（这是本文件唯一的设计原则）─────────────────
 *
 *   M1（纪录）                         M2（领奖台）
 *   ─────────────────────────────────  ─────────────────────────────
 *   赛道：WR / CR / NR                 赛级：世 / 洲 / 国
 *   级别价值 V_L  1 / 0.4 / 0.15  ───▶ 赛级价格 T_L  1 / 0.4 / 0.15   ← 同一张表
 *   竞争密度 ρ_s  洲/国人数占比    ───▶ 属地规模 ρ_s  完全同一函数
 *   时代折算 f_L  按级别分池        ───▶ 完全同一函数，改「区间均值」为「当日值」
 *   项目权重 w_e  EV_STAT v2        ───▶ 完全同一张表
 *   项目分项 per[ev]                ───▶ 项目分项 per[ev]              ← 同一个键
 *
 *   新增的只有一样 M1 没有的东西：名次折价 P(pos) —— 纪录只有一条，没有第二第三。
 *
 * ── 为什么直接用官方 pos（F3 的取舍）──────────────────────────
 *   WCA 每一轮只发一个名次，排序依据由 `format.sort_by` 决定（平均格式按 average、
 *   Best of N 按 best）。这就是「官方排名」，也是唯一被 WCA 承认的排名。
 *   F2 曾自己按 best / avg 各排一遍取前三，结果同一人同一场同一项目会占据两个榜，
 *   总计里拿两份分，口径上不好解释 —— 故 F3 撤回，改为只认官方 pos。
 *   代价：不再区分「单次强 / 平均稳」。这个维度在 M1（纪录）里已经完整存在，
 *   M2 只需回答「谁站上过领奖台」。
 *
 * ── 为什么赛级价格直接抄 M1 ────────────────────────────────────
 *   因为「世界冠军」和「世界纪录」是同一个层级的成就，站内若给两个价格，
 *   用户会发现两套模型互相打架。层级价格表全站只能有一张。
 *
 * ── 为什么不设「每届最多计 N 个」/「每项目只取最优」────────────────
 *   2026-10-24 决定：线性累加。多次登台是实力的证据，不是漏洞。
 *   仅「参赛」不得分 —— 必须进决赛前三，这是本模型唯一的入口条件。
 *   防止「堆小赛」的是 ρ_s：小国冠军的价格本身就接近 0，不需要额外规则。
 */

const M1 = require('./m1.js');
const RN = require('./runs.js');

/* ── 赛级价格 ────────────────────────────────────────────────────
 * 与 M1 的 M1.G（WR 1.0 / CR 0.4 / NR 0.15）逐位相同。
 * OP = 非冠军赛的普通赛事，M2-F1 不把 OP 计入 M2，仅为 M3 预留一个价格位。
 *
 * 三级差 6.6667 倍，相邻档 2.5× / 2.6667×，与 M1 的层级折扣完全一致。
 */
const TIER_BASE = Object.freeze({
  WC: 1.0000,
  CC: 0.4000,
  NC: 0.1500,
  OP: 0.0500,
});

/* ── 名次折价 ────────────────────────────────────────────────────
 * 冠军是完整的一次「站上最高处」，亚军/季军是同一场赛事的次级结果。
 * 1 / 0.6 / 0.4 沿用站内既有口径（build.js:702），本次不改：
 * 它只影响同级内部的相对关系，不在 M2 的争议范围内。 */
const PLACE_W = Object.freeze({ 1: 1.0000, 2: 0.6000, 3: 0.4000 });

/* ── 领奖台的入口口径 ────────────────────────────────────────────
 * 只有一条：**该轮官方名次 1 / 2 / 3，且成绩有效**。
 *
 * 「成绩有效」指 `best > 0`。WCA 用 `best = −1` 表示 DNF、`−2` 表示 DNS，
 * 这些人官方仍可能发 `pos`（尤其多盲：一轮里解出 0 个照样有排名）。
 * 让他们拿领奖台分等于奖励「参赛但没完成」，与「一定要有成绩」冲突。
 * 实测影响的轮次占全部决赛轮 < 0.5%，且只发生在人数不足 3 人的小场次。
 */
const PLACE_MIN = 1;
const PLACE_MAX = 3;

/* ── 属地规模 ρ 的取法 ───────────────────────────────────────────
 * linear  ：ρ = 该属地人数 / 全球人数（M1 口径，默认）
 * one     ：ρ ≡ 1，即只按赛级定价、不按属地（对照组）
 * sqrt    ：ρ = sqrt(线性)，削弱属地差异（敏感性分析用，非默认）
 */
const RHO_MODE = 'linear';

/* ── 模块归属 ────────────────────────────────────────────────────
 * M2 = 三级冠军赛领奖台（世 / 洲 / 国）
 * M3 = 非冠军赛的普通赛事领奖台（草案，未定稿）
 *
 * 注意：这改变了 M3 的含义。旧 M3 是「国内赛事 + 海外赛事」的混合体，
 * 新 M3 只剩「非冠军赛」。876 场国家锦标赛从 M2 的 CC（0.7）移到 M2 的 NC，
 * 其余十万级普通赛事领奖台全部归 M3。 */
const MODULE_OF = Object.freeze({ WC: 'm2', CC: 'm2', NC: 'm2', OP: 'm3' });

const M2_CFG = Object.freeze({
  tierBase: TIER_BASE,
  placeW: PLACE_W,
  rhoMode: RHO_MODE,
  era: true,
  useWeight: true,
  field: false,
});

/* ── 决赛人数折价（只用于稳健性检验，不进定稿）───────────────────
 * 担心：「场上只有 3 个人，前三名等于保底」。
 * 实测（M2_诊断 4.1）：全站 ≤3 人决赛只占 2.81%，加权后总量变化 < 6%，名次不变。
 * 保留为可选开关，默认关闭。 */
const FIELD_REF = 16;
const FIELD_GAMMA = 0.35;
function fieldFactor(n) {
  const x = Math.max(1, +n || 1);
  return Math.min(1, Math.pow(x / FIELD_REF, FIELD_GAMMA));
}

/* ── 赛级分类 ────────────────────────────────────────────────────
 * championships.tsv 的 championship_type 只有三类真实取值：
 *   'world'                        → 世界锦标赛
 *   '_Europe' 'greater_china' …    → 洲际 / 区域锦标赛
 *   'HU' 'US' 'SE' …（ISO2）        → 国家锦标赛
 * 旧实现把「非 world」一律当 CC，是 M2 现行排序错误的根因。
 *
 * @param {Set<string>} types 该赛事的全部 championship_type
 * @param {string} compIso    该赛事举办国的 ISO2（大写）
 */
function isContinentalType(t) {
  const s = String(t || '').toLowerCase();
  return s.charAt(0) === '_' || s === 'greater_china';
}

function tierOf(types, compIso) {
  if (!types || !types.size) return 'OP';
  for (const t of types) if (String(t).toLowerCase() === 'world') return 'WC';
  for (const t of types) if (isContinentalType(t)) return 'CC';
  const iso = String(compIso || '').toUpperCase();
  if (iso) for (const t of types) if (String(t).toUpperCase() === iso) return 'NC';
  /* 有冠军赛标记但没匹配上国家代码：仍按国家级处理，只是它的属地取举办国。
     宁可少算一级，也不要退回「非 world 即洲际」的旧错误。 */
  return 'NC';
}

/**
 * 多区赛（multi-region）。M2-F3 起**归 M3，不进 M2**。
 *
 * ── 判据 ──────────────────────────────────────────────────────
 * WCA 用 `X` 开头的两位伪代码表示「不落在单一国家」的属地：
 *   XE 欧洲 ｜ XA 亚洲 ｜ XW 世界 ｜ XO 大洋洲 ｜ XS 南美 …
 * 真正的 ISO 3166-1 国家代码里没有 X 开头的，所以前缀 X 就是唯一可靠的标记。
 *
 * ── 命中什么 ──────────────────────────────────────────────────
 * 全部是 **FMC（最少步）远程锦标赛**：同一套题目在几十个国家分站同步比，
 * 赛事在 competitions 里登记为 XE / XA / XW，而 championship_type 仍写具体国别
 * （如 `FMCEurope2026` 有 CH / CY / GR / NL / UA / EE 六行）。
 *
 * ── 为什么必须排除出 M2 ───────────────────────────────────────
 * M2 的 ρ_s 是「该属地玩家占全球的比例」。多区赛没有单一属地：
 * 取 XE 会把欧洲当成一个国家、人数翻十倍；取 CH 又只算瑞士。
 * 任一种取法都会给出一个与其他赛事不可比的价格，所以整类移出。
 * 用户决定：这类赛事归 M3（普通赛事），M2 只留属地明确的锦标赛。
 *
 * @param {string} compIso 赛事举办国的 ISO2 / 伪代码（大写）
 */
function isMultiRegion(compIso) {
  return /^X[A-Z]$/.test(String(compIso || '').toUpperCase());
}

/* ── 属地 scope ──────────────────────────────────────────────────
 * 与 M1 的「阶梯属地」同构：
 *   WC → 全球 ｜ CC → 该洲 ｜ NC → 该国 ｜ OP → 该国
 */
function scopeOf(tier, who) {
  const w = who || {};
  if (tier === 'WC') return 'WW';
  if (tier === 'CC') return w.cont || '??';
  return w.nat || '??';
}

/* M1 的级别代号 ↔ M2 的赛级代号：只为复用 makeScopePool.valueOf() */
const LEVEL_OF = Object.freeze({ WC: 'WR', CC: 'CR', NC: 'NR', OP: 'NR' });

/**
 * 属地规模 ρ_s。
 * @param {string} tier
 * @param {{cont?:string, nat?:string}} who 属地（洲锦标赛取举办洲，国家赛取举办国）
 * @param {ReturnType<typeof M1.makeContext>} ctx
 */
function rhoOf(tier, who, ctx, mode) {
  const m = mode || M2_CFG.rhoMode;
  if (tier === 'WC' || m === 'one') return 1;
  const w = who || {};
  const v = tier === 'CC' ? ctx.rhoC(w.cont) : ctx.rhoN(w.nat);
  return m === 'sqrt' ? Math.sqrt(Math.max(0, v)) : v;
}

/**
 * 时代折算 f。与 M1 的 avgFactor 用同一个池、同一个 valueOf，
 * 但取「赛事当年」的单点值而不是区间均值 ——
 * M1 的段是随时间累积的连续量，M2 的领奖台是某一天发生的瞬时事件。
 * @param {{valueOf?:Function, yearValue?:Function}} pool makeScopePool 的产物
 * @param {string} tier
 * @param {{cont?:string, nat?:string}} who
 * @param {number} y 赛事年份（可用小数年）
 */
function eraFactor(pool, tier, who, y) {
  if (!pool) return 1;
  const level = LEVEL_OF[tier] || 'NR';
  if (typeof pool.valueOf === 'function') return pool.valueOf(level, who || {}, y);
  if (typeof pool.yearValue === 'function') return pool.yearValue(y);
  return 1;
}

/**
 * 从一轮决赛的全部行里取出「领奖台」。
 *
 * ── 口径（M2-F3 定案）──────────────────────────────────────────
 *   官方 pos ∈ {1,2,3}，且成绩有效（best > 0）。
 * 就这么简单。不重排、不拆维度、不并列全取。
 *
 * ── 为什么不再自己排 ──────────────────────────────────────────
 * WCA 每一轮只有一个 pos，它就是官方名次；排序依据由 format.sort_by 决定
 * （a/m 按 average，1/2/3/5 按 best）。F2 曾按 best / avg 各排一遍取前三，
 * 造成同一场同一项目出两个领奖台、总计重复计分。F3 撤回，只认官方。
 *
 * ── 为什么仍要过滤 DNF ────────────────────────────────────────
 * 官方会给 DNF 的人发名次（多盲一轮解出 0 个也可能拿 pos 1）。
 * 「参加但没完成」不该等于「站上领奖台」，故要求 best > 0。
 *
 * @param {Array<{pid:string, pos:number, best:number}>} rows 该轮全部行
 * @param {{n?:number}} [opt]
 * @returns {Array} 每条 { ...原行, place }，按 place 升序
 */
function podiumOf(rows, opt) {
  const o = opt || {};
  const n = o.n == null ? PLACE_MAX : o.n;
  return rows
    .filter((r) => r.pos >= PLACE_MIN && r.pos <= n && r.best > 0)
    .sort((a, b) => a.pos - b.pos)
    .map((r) => ({ ...r, place: r.pos }));
}


/**
 * 一个领奖台的分值（逐项可复核）。
 *
 *   score = P(pos) × T_L × ρ_s × f_L × w_e
 *
 * @param {{pos:number, tier:string, ev:string, year:number,
 *          cont?:string, nat?:string}} pod
 * @param {{ctx:object, pool?:object, cfg?:object, weights?:object}} env
 * @returns {{place:number, tier:string, tierBase:number, rho:number,
 *            f:number, w:number, score:number}}
 */
function scorePodium(pod, env) {
  const e = env || {};
  const c = { ...M2_CFG, ...(e.cfg || {}) };
  const tier = pod.tier || 'OP';
  const place = pod.pos >= 1 && pod.pos <= 3 ? pod.pos : 3;
  const p = c.placeW[place] == null ? 0 : c.placeW[place];
  const t = c.tierBase[tier] == null ? 0 : c.tierBase[tier];
  const rho = rhoOf(tier, pod, e.ctx, c.rhoMode);
  const f = c.era ? eraFactor(e.pool, tier, pod, +pod.year || 2026) : 1;
  const w = c.useWeight ? ((e.weights || RN.EV_WEIGHT_V2)[pod.ev] == null
    ? RN.WEIGHT_V2_CFG.floor
    : (e.weights || RN.EV_WEIGHT_V2)[pod.ev]) : 1;
  const ff = c.field ? fieldFactor(pod.field) : 1;
  return {
    place, tier, tierBase: t, rho, f, w, fieldFactor: ff,
    score: p * t * rho * f * w * ff,
    exact: p * t * rho * f * w * ff,
  };
}

/**
 * 一次算完全部变体，用于敏感性对照。
 * 顺序即「从现行口径逐项加回」：
 *   v0 现行：赛级 WC1.0/CC0.7/OP0.4，无 ρ / f / w，且不修分类 bug
 *   v1 修分类（WC/CC/NC 分开），价格仍用旧 1.0/0.7/0.4
 *   v2 + M1 赛级价格 1.0/0.4/0.15
 *   v3 + ρ_s
 *   v4 + f_L
 *   v5 + w_e   ← 定稿
 */
const VARIANTS = Object.freeze([
  { id: 'v0', tierBase: { WC: 1.0, CC: 0.7, NC: 0.4, OP: 0.4 }, rhoMode: 'one', era: false, useWeight: false, legacyTier: true },
  { id: 'v1', tierBase: { WC: 1.0, CC: 0.7, NC: 0.4, OP: 0.4 }, rhoMode: 'one', era: false, useWeight: false },
  { id: 'v2', tierBase: { WC: 1.0, CC: 0.4, NC: 0.15, OP: 0.05 }, rhoMode: 'one', era: false, useWeight: false },
  { id: 'v3', tierBase: { WC: 1.0, CC: 0.4, NC: 0.15, OP: 0.05 }, rhoMode: 'linear', era: false, useWeight: false },
  { id: 'v4', tierBase: { WC: 1.0, CC: 0.4, NC: 0.15, OP: 0.05 }, rhoMode: 'linear', era: true, useWeight: false },
  { id: 'v5', tierBase: { WC: 1.0, CC: 0.4, NC: 0.15, OP: 0.05 }, rhoMode: 'linear', era: true, useWeight: true },
  { id: 'v6', tierBase: { WC: 1.0, CC: 0.4, NC: 0.15, OP: 0.05 }, rhoMode: 'linear', era: true, useWeight: true, field: true },
]);

const VARIANT_CN = Object.freeze({
  v0: '现行口径（分类 bug 未修）',
  v1: '修分类，价格仍 1/.7/.4',
  v2: '+ M1 赛级价 1/.4/.15',
  v3: '+ ρ 属地规模',
  v4: '+ f 时代折算',
  v5: '+ w 项目权重（**定稿**）',
  v6: 'v5 + 决赛人数折价（稳健性，不采用）',
});

module.exports = {
  TIER_BASE,
  PLACE_W,
  PLACE_MIN,
  PLACE_MAX,
  RHO_MODE,
  MODULE_OF,
  M2_CFG,
  FIELD_REF,
  FIELD_GAMMA,
  fieldFactor,
  VARIANTS,
  VARIANT_CN,
  LEVEL_OF,
  isContinentalType,
  tierOf,
  isMultiRegion,
  scopeOf,
  rhoOf,
  eraFactor,
  podiumOf,
  scorePodium,
};

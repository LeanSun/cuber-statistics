'use strict';
/* ═══════════════════════════════════════════════════════════════
 * M1-F1 已封存（2026-10-24）
 * 本文件与 m1.js / score_record.js / test_runs.js 共同构成 M1 的
 * 冻结基线。改动前请先读 `M1_封存_2026-10-24.md` 的「解封条件」，
 * 并在改完后重跑 test_runs.js（16 项断言必须全绿）与
 * score_record.js（关键数字必须与封存记录一致）。
 * ═══════════════════════════════════════════════════════════════ */
/* M1 · 纪录维度 · 占有段口径（Ownership-Run）
 *
 * ── 一句话 ────────────────────────────────────────────────────
 *   一条纪录值多少分，不看「破了几次」，看「把纪录推低了多深」×
 *   「从破的那一刻起，独占这条纪录多少天，直到被别人打破」。
 *
 * ── 为什么不是「固定 1 年」────────────────────────────────────
 *   1 年只是举例，不是尺度。真实情况是：三阶 WR 平均 4 个月一换，
 *   小国 NR 可能十年没人碰。用同一个窗口去卡，等于给快节奏项目
 *   和慢节奏项目套同一把尺子。占有段把窗口交给**事实**决定：
 *   窗口长度 = 这位选手连续持有的真实时长。
 *
 * ── 三段论 ────────────────────────────────────────────────────
 *   阶梯 ℓ = (项目 e, 轨道 t, 级别 L, 属地 s)
 *     L = WR → s = 全球；L = CR → s = 该洲；L = NR → s = 该国
 *   阶梯上按时间排列所有「被官方承认的纪录提交」r_1 … r_n，值单调变好。
 *   把它们按选手切段：连续同属一人的若干提交 = 一个占有段 R。
 *
 *     τ_start(R) = 段内第一次提交的日期
 *     τ_end(R)   = 下一位选手的第一次提交日期（= 被他人打破的那天）
 *                  若段在阶梯末端且仍有效，取快照日
 *     G(R)       = ln( v_前一位留下的值 / v_段内最好值 )
 *     T(R)       = min( τ_end - τ_start , D_cap )
 *     credit(R)  = G(R) × T(R)/365         单位：对数进步量 · 年
 *
 * ── 五条性质（这是它能替代条数口径的全部理由）──────────────────
 *   ① 拆分中性  段内刷 k 次，G 由望远镜求和恒等于「一次到位」，
 *                T 从段首算起也不变 ⇒ 得分完全相同。k 不进公式。
 *   ② 被破即停  τ_end 由**别人**决定，本人无法延长自己的段。
 *   ③ 回归重算  被抢走后再次抢回 = 新段，G 以「抢走者留下的值」为基准，
 *                T 从抢回日重新计时，不继承旧段的余温。
 *   ④ 不重叠    所有段的 [τ_start, τ_end) 在时间轴上互不相交
 *                ⇒ 同一阶梯的总分有上界，不因参与人数变多而膨胀。
 *   ⑤ 级别一致  WR / CR / NR 走同一套算法，只有三处不同：
 *                阶梯的属地范围、ρ 竞争密度、f 时代折算。
 *                「CR 按洲切段、NR 按国切段」是自动的，不需要特判。
 *
 * ── 与条数口径的唯一差别 ──────────────────────────────────────
 *   把公式里的「1」换成「G × T/365」。级别价值 G_L、竞争密度 ρ、
 *   时代折算 f 三项原样保留，可以逐项对照。
 *
 * ── 取值口径（越大越好的项目）──────────────────────────────────
 *   多盲 333mbf：得分 = 成功数 − 失败数 = 2×成功 − 尝试；同分比时间，短者优先。
 *   最少步 333fm：步数少者优先；同步数比时间，短者优先。
 *   这类项目不能直接用 ln(前值/现值)，见 parseResult / gainOf 的分支。
 */

const M1 = require('./m1.js');

/* ── 显示精度：全局唯一约定 ──────────────────────────────────────
 *   所有「计算量」（G / r / credit / 分数 / 权重 / 系数 / 参考值 / 天数折算年）
 *   一律保留 4 位小数。百分比是派生展示，保留 2 位。
 *   不要在各脚本里再写 toFixed —— 统一从这里取，避免各处精度打架。 */
const DEC = 4;
const R4 = (v, n = DEC) => Math.round(Number(v) * 10 ** n) / 10 ** n;
const F4 = (v, n = DEC) => {
  const x = Number(v);
  return v == null || !Number.isFinite(x) ? '—' : x.toFixed(n);
};
const P4 = (v, n = 2) => {
  const x = Number(v);
  return v == null || !Number.isFinite(x) ? '—' : (x * 100).toFixed(n) + '%';
};

const DAY = 86400000;
/** 数据快照日：所有「仍未被打破」的段截到这一天。
 *  必须与 ETL 的 --date 一致（= WCA 导出日），否则开放段会凭空多出/少掉几天。 */
const SNAPSHOT = '2026-10-15';
const SNAPSHOT_DAY = dayOf(SNAPSHOT);

/** 'YYYY-MM-DD' → 距 1970-01-01 的天数 */
function dayOf(s) {
  const t = Date.parse(String(s).slice(0, 10) + 'T00:00:00Z');
  return Number.isFinite(t) ? Math.round(t / DAY) : NaN;
}
/** 天数 → 小数年（用于时代折算） */
function yearOfDay(d) {
  const dt = new Date(d * DAY);
  return dt.getUTCFullYear() + dt.getUTCMonth() / 12;
}
/** 天数 → 'YYYY-MM-DD' */
function dateOfDay(d) {
  return new Date(d * DAY).toISOString().slice(0, 10);
}

/* ── 成绩解析 ─────────────────────────────────────────────────
 * 统一成「cost 越小越好」的主指标 + tie 次指标：
 *   time   → cost = 秒
 *   moves  → cost = 步数（单次整数、平均带小数）
 *   points → cost = −得分（得分 = 成功−失败）
 * 次指标 tie 只在主指标相等时决定谁更好（WCA 的并列规则）。
 */
const MBF_SHIFT = 10;   // 多盲得分的平滑常数，见 gainOf
/** 只靠次级判据（时间）赢下并列时的折算权重。
 *  多盲比的是「成功数−失败数」，同分再比用时。10/10 42:06 打破 10/10 44:09
 *  是真实纪录（Kai Jiptner, 2009-04-25），但它推进的主指标是 0。
 *  旧实现直接给 G=0，等于"这条纪录不算"。这里给一个折扣价：
 *  G = TIE_WEIGHT · ln(前用时 / 后用时)。0.3 是保守取值 —— 主指标赢的
 *  1 分，靠时间赢只值 0.3 分，但不再是 0。 */
const TIE_WEIGHT = 0.3;

function kindOf(ev, type) {
  if (ev === '333mbf' || ev === '333mbo') return 'points';
  if (ev === '333fm') return 'moves';
  return 'time';
}

function parseClock(s) {
  const p = s.split(':');
  if (p.length === 3) return +p[0] * 3600 + +p[1] * 60 + +p[2];
  if (p.length === 2) return +p[0] * 60 + +p[1];
  return +p[0];
}

/**
 * @returns {null|{kind:string, cost:number, score:number, tie:number, raw:string}}
 */
function parseResult(ev, type, value) {
  const s = String(value == null ? '' : value).trim();
  if (!s || /DNF/i.test(s)) return null;
  const kind = kindOf(ev, type);

  if (kind === 'points') {
    /* "32/35 55:00" 或 "49/56 1:00:00" → 成功 / 尝试 / 用时
       得分 = 成功 − 失败；同分时用时短者更好。
       2013 年前的多盲旧项目（333mbo）常写成 "2/2" 不带用时，
       此时 tie 记 Infinity：同分情况下「没记时」不构成任何优势。 */
    const m = s.match(/^(\d+)\s*\/\s*(\d+)(?:\s+(?:(\d+):)?(\d+):(\d+(?:\.\d+)?))?$/);
    if (!m) return null;
    const solved = +m[1];
    const att = +m[2];
    const sec = m[4] == null ? null : (+m[3] || 0) * 3600 + +m[4] * 60 + +m[5];
    const score = solved - (att - solved);
    return { kind, cost: -score, score, tie: sec == null ? Infinity : sec, raw: s };
  }

  if (kind === 'moves') {
    const n = +s;
    if (!(n > 0)) return null;
    return { kind, cost: n, score: -n, tie: 0, raw: s };
  }

  const sec = parseClock(s);
  if (!(sec > 0)) return null;
  return { kind, cost: sec, score: -sec, tie: 0, raw: s };
}

/** cur 是否真的比 prev 更好（含「同分更快」这种只赢在次指标的进步） */
function isBetter(prev, cur) {
  if (!prev) return true;
  if (cur.cost !== prev.cost) return cur.cost < prev.cost;
  return cur.tie < prev.tie;
}

/**
 * 进步幅度（对数，可跨项目相加）
 *   time / moves → ln(前值 / 现值)
 *   points       → ln((现值+a)/(前值+a))，a=MBF_SHIFT
 *
 * 主指标没推进、只靠次级判据（用时）赢下的，走 TIE_WEIGHT 折扣价。
 * 这类提交照样**终结前一位的占有段**，只是拿到的 G 很小而非 0。
 * @param {object} prev 前一位留下的最好提交
 * @param {object} cur  本段结束时的最好提交
 * @param {{tieWeight?:number}} [opt] tieWeight 传 0 可退回旧行为（G=0）
 */
function gainOf(prev, cur, opt) {
  if (!prev || !cur) return 0;
  const tw = opt && opt.tieWeight != null ? opt.tieWeight : TIE_WEIGHT;
  if (cur.kind === 'points') {
    const a = MBF_SHIFT;
    const x = prev.score + a;
    const y = cur.score + a;
    if (!(x > 0) || !(y > 0)) return 0;
    if (y > x) return Math.log(y / x);
    /* 得分相同（或更低）：只要用时更短，仍是一次并列纪录 */
    if (y === x && tw > 0 && prev.tie > 0 && cur.tie > 0 && cur.tie < prev.tie) {
      return tw * Math.log(prev.tie / cur.tie);
    }
    return 0;
  }
  const a = prev.cost;
  const b = cur.cost;
  if (!(a > 0) || !(b > 0)) return 0;
  if (b < a) return Math.log(a / b);
  /* 时间类项目 cost 就是成绩本身，tie 通常是 0，这里仍留一条通路：
     步数相同、用时更短的最少步成绩。 */
  if (b === a && tw > 0 && prev.tie > 0 && cur.tie > 0 && cur.tie < prev.tie) {
    return tw * Math.log(prev.tie / cur.tie);
  }
  return 0;
}

/* ── 阶梯与分段 ─────────────────────────────────────────────── */

/**
 * 把一组提交按时间排成阶梯并切成占有段。
 *
 * @param {Array<{pid:any, name?:string, day:number, value:any, level?:string, held?:number}>} subs
 * @param {{ev:string, type:string}} meta
 * @param {{mode?:'level'|'scope', endFromHeld?:boolean, exportDay?:number}} [opt]
 *        level（默认）：阶梯 = WCA 纪录表里对应的那张表，只含同一级别的提交。
 *                       与现有 `held` 字段口径一致，可做链路校验。
 *        scope        ：阶梯 = 属地范围内的全部纪录提交（含更高级别）。
 *                       更贴近「本国人用 CR/WR 成绩刷掉你的 NR」这一事实，
 *                       但现有 held 不是按这个口径算的，校验会失效。
 *        endFromHeld  ：用 `held`（全量数据口径）推算段尾，而不是「本阶梯下一条
 *                       仍在样本里的提交」。records 每人只留 12 条，直接取
 *                       「下一位选手」会把段拉长好几年；held 是在截断**之前**
 *                       算的，所以它能给出真实段尾。仍然保持中的纪录，
 *                       held 截到导出日，此时 tEnd 记为 null（开放段）。
 * @returns {{runs:Array, dropped:number, raw:number, kept:number}}
 */
function buildLadder(subs, meta, opt) {
  const o = opt || {};
  const mode = o.mode || 'level';
  const ev = meta.ev;
  const type = meta.type;
  const list = [];
  for (const s of subs || []) {
    const p = parseResult(ev, type, s.value);
    if (!p) continue;
    if (!Number.isFinite(s.day)) continue;
    list.push({
      pid: s.pid,
      name: s.name,
      day: s.day,
      date: s.date || dateOfDay(s.day),
      value: s.value,
      level: s.level || '',
      held: s.held || 0,
      cost: p.cost,
      tie: p.tie,
      score: p.score,
      kind: p.kind,
    });
  }
  /* 时间升序；同日取更好的一条（同一天多次提交只算一次） */
  list.sort((x, y) => x.day - y.day || x.cost - y.cost || x.tie - y.tie);
  const kept = [];
  let dropped = 0;
  let tied = 0;
  for (const s of list) {
    const last = kept[kept.length - 1];
    if (last && last.day === s.day) {
      if (isBetter(last, s)) kept[kept.length - 1] = s;
      else dropped++;
      continue;
    }
    if (last && !isBetter(last, s)) {
      /* ★ opt.allowTie（2026-10-31 新增，默认 false = 保持 M4/M6 原行为）
       *   主指标 cost 完全相同 = **追平纪录**，不是数据噪声。WCA 会把追平也标为
       *   WR（333fm 单次 19 步被 6 人先后追平），旧逻辑把这类条目整条丢弃，
       *   导致追平者拿不到任何持有段（董百强因此丢掉 2 条 WR）。
       *   打开后：追平者成为新的持有段，原持有者的独占期在追平当天结束。 */
      if (!(o.allowTie && s.cost === last.cost)) { dropped++; continue; }
      tied++;
    }
    kept.push(s);
  }

  /* 切段：同一人 + 同一级别连续提交算一段（级别升档要切开，否则 NR 的时长会被
     按 WR 的价格计价） */
  const runs = [];
  for (const s of kept) {
    const last = runs[runs.length - 1];
    const same = last && last.pid === s.pid && (mode === 'level' || last.level === s.level);
    if (same) {
      last.subs.push(s);
      last.vOut = s;
    } else {
      runs.push({ pid: s.pid, name: s.name, level: s.level, tStart: s.day, vIn: s, vOut: s, subs: [s] });
    }
  }
  let prevOut = null;
  let prevLast = null;
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i];
    r.gain = i === 0
      ? gainOf(r.subs[0], r.vOut, { tieWeight: o.tieWeight })
      : gainOf(prevOut, r.vOut, { tieWeight: o.tieWeight });
    r.tEnd = i + 1 < runs.length ? runs[i + 1].tStart : null;
    /* 数据自检：段内最后一条的 held 应等于「到下一位选手」的天数，
       不等说明阶梯缺条（被数据截断或漏采），该段的 G 与 T 都不可信。
       仅 level 模式下 hold 与 held 同源，才可比。 */
    const lastSub = r.subs[r.subs.length - 1];
    r.linkOk = (r.tEnd == null || mode !== 'level')
      ? (r.tEnd == null ? null : undefined)
      : Math.abs((r.tEnd - lastSub.day) - (lastSub.held || 0)) <= 1;

    /* held 版段尾：held 是在「每人 12 条」截断**之前**算的，
       所以即使阶梯被切碎，它仍指向真正的下一位打破者。
       仍然保持中的纪录，held 截到导出日 → 记为开放段（tEnd = null）。 */
    r.spanHeld = r.subs.reduce((a, s) => a + (s.held || 0), 0);
    r.tEndHeld = lastSub.held > 0 ? lastSub.day + lastSub.held : null;
    if (r.tEndHeld != null && o.exportDay && r.tEndHeld >= o.exportDay - 1) r.tEndHeld = null;
    if (o.endFromHeld) r.tEnd = r.tEndHeld;
    /* 停办项目：项目被废除后纪录再也不会被打破，「守到今天」是伪长段。
       末段一律封在项目终止日（见 EV_RETIRED_DAY），否则白赚十几年。 */
    const retDay = EV_RETIRED_DAY[ev];
    if (retDay != null && (r.tEnd == null || r.tEnd > retDay)) r.tEnd = retDay;
    /* 段内 held 之和应等于整段跨度；若小于跨度，说明中间还有别人持有一段
       （那条提交被 12 条上限截掉了），此时该段其实是两段，G 的基准偏低 */
    r.clean = r.tEnd == null ? null : Math.abs((r.tEnd - r.tStart) - r.spanHeld) <= 1;
    /* 前一位留下的值到本段开始之间若有空档，说明中间还夹着别人被截掉的提交，
       那么 G 的基准偏高（真实基准更小，G 被高估）。>0 即不可信。 */
    r.prevGap = prevLast == null ? null
      : Math.round(r.tStart - (prevLast.day + (prevLast.held || 0)));
    prevOut = r.vOut;
    prevLast = lastSub;
  }
  return { runs, dropped, tied, raw: list.length, kept: kept.length };
}

/* ── 项目定价：w_e 是唯一的跨项目价格 ────────────────────────────
 *
 * 为什么必须归一：
 *   `G = ln(前值/本段最好值)` 只回答「这条路还能走多远」，不回答
 *   「有多少人在走」。冷门项目离物理极限远，随便一练就是 30% 的 G；
 *   三阶卷了二十年，一次只能磨 8%。直接拿 G 跨项目比，等于奖励冷门。
 *
 * 归一口径（α = 1 完全归一）：
 *   r    = G / G_ref(e)          —— 项目内相对强度，"该项目典型一段" = 1.0
 *   price = r × w_e              —— 项目间价差全部由 w_e 承担
 *
 * 用**算术均值**做 G_ref 有一个干净的恒等式：
 *   Σ_i (G_i / mean(G)) = n        （与分布形状无关，含长尾也成立）
 * 即：任何项目的历史总信用 = 该项目的段数，一个"段"在所有项目里
 * 完全同质。三阶是否最贵，只取决于 w_e，与 G 的实测分布无关。
 *
 * 本表与 js/calc.js 的 EVENTS[].w 必须逐项一致（test_runs.js 有断言）。
 */
const EV_WEIGHT = {
  '333': 1.00, '222': 0.92, '444': 0.88, '555': 0.85, '666': 0.81, '777': 0.79,
  '333oh': 0.90, '333bf': 0.84, '444bf': 0.80, '555bf': 0.77, '333mbf': 0.78,
  '333fm': 0.82, clock: 0.83, minx: 0.86, pyram: 0.90, skewb: 0.89, sq1: 0.87,
  '333ft': 0.66, magic: 0.60, mmagic: 0.58, '333mbo': 0.62,
};
/** 单段最高能拿到「典型段的几倍」。3 表示一个惊人突破最多值 3 段。 */
const NORM_CAP = 3;

/* ── 项目权重 v2 ────────────────────────────────────────────────
 *
 * 为什么换掉上面那张手写表：
 *   1. 它没有任何数据依据，是一条凭手感递减的序列；
 *   2. 量程只有 1.72 倍，而项目之间的实际投入差距是几十倍；
 *   3. 它分不开"相近项目"：四盲 0.80 vs 三盲 0.84 只差 5%。
 *
 * v2 的度量：**项目规模指数** s_e，由两个可测分量合成
 *
 *     pr_e = 该项目活跃人数 / 三阶活跃人数          ← 广度：多少人在玩
 *     ar_e = 该项目人均参赛次数 / 三阶人均参赛次数   ← 深度：每人玩多久
 *     s_e  = pr_e × sqrt(ar_e)
 *
 * 为什么 ar 开根号：人均次数是"同一批人的重复投入"，边际价值递减。
 * 为什么不用纯人次份额（pr×ar）：那会把六阶七阶压死 —— 六阶的活跃
 * 人数是三阶的 95%，只因为人均次数少（83 次 vs 738 次）就被打到
 * 0.43，低于三盲的 0.47，这与「大阶 World Record 是硬通货」的直觉相反。
 * 开根号是广度与深度之间的折中：六阶落在 0.60 附近，介于二阶与盲拧之间。
 *
 * 映射：w_e = floor + (1 - floor) · s_e^γ
 *
 *   三条结构保证（与数据无关，只依赖公式形状）：
 *   ① s_333 ≡ 1 → w_333 ≡ 1，且是全局上界。**三阶恒为最高。**
 *   ② s^γ 在 s>0 上严格单调 ⇒ 权重排序 ≡ 规模排序，不会出现
 *      "份额差 20 倍、权重只差 5%" 的断裂。
 *   ③ 值域 [floor, 1]，冷门项目不会被压到 0（压到 0 等于取消这个项目）。
 *
 * γ 是唯一的价值旋钮：
 *   γ 小 → 贴近旧表（三阶只领先一点，冷门项目受保护）
 *   γ 大 → 三阶领先明显，冷门项目被压得更狠
 * 两端是同一件事，取值见 WEIGHT_V2_CFG。敏感性对照由 verify_weights.js 生成。
 *
 * 停办项目（脚拧 / 八板 / 十二板 / 旧多盲）单独乘 retiredDiscount：
 * 它们的历史份额是"当年"的，今天已不再产出新纪录，含金量应再降一档。
 */
const WEIGHT_V2_CFG = {
  floor: 0.30,          // 地板：最冷门项目的权重
  gamma: 0.75,          // 规模弹性
  retiredDiscount: 0.85,
};

/** 原始观测量（相对三阶），**全量重算于 2026-10-24**。
 *
 *  pr = 活跃人数比：在「认真参赛者池」里玩过该项目的人 / 玩过三阶的人。
 *       池的定义：累计参赛 ≥ 3 场（92,473 人，占全量 300,057 的 30.8%）。
 *       不取全量 300,057，因为其中约一半只打过 1–2 场，不构成纪录竞争；
 *       不取 ≥10 场（23,368 人），那几乎等于旧表，区分度消失。
 *  ar = 人均参赛次数比：该项目人均出赛次数 / 三阶人均出赛次数。
 *       只用 detail 层（6,147 人有逐项目明细）的真实 per-event 次数；
 *       不能用「该项目选手的总场次」代理（会得出五阶盲拧 12.3 这种荒谬值）。
 *
 *  旧表（早期 detail 2,500 人，全是顶尖高手）已废弃，见 EV_STAT_V1。
 *  扫描过程见 `etl/score/EV_STAT_阈值扫描.md`（由 scan_evstat.js 生成）。
 *  历史上三处明显失真：四盲 pr 0.5050（称一半人玩四盲）、三阶单手 0.9970、
 *  金字塔 0.9820 —— 都是「顶尖选手样本」冒充全体人口的结果。
 */
const EV_STAT = {
  '333': { pr: 1.0000, ar: 1.0000 },
  '222': { pr: 0.9102, ar: 0.6283 },
  pyram: { pr: 0.7450, ar: 0.4896 },
  '444': { pr: 0.6445, ar: 0.5139 },
  '333oh': { pr: 0.5853, ar: 0.4658 },
  skewb: { pr: 0.5460, ar: 0.4508 },
  '555': { pr: 0.3903, ar: 0.3743 },
  minx: { pr: 0.3448, ar: 0.3001 },
  clock: { pr: 0.3131, ar: 0.3419 },
  sq1: { pr: 0.2544, ar: 0.3164 },
  '666': { pr: 0.1962, ar: 0.1435 },
  '333bf': { pr: 0.1927, ar: 0.2226 },
  '777': { pr: 0.1663, ar: 0.1299 },
  '333fm': { pr: 0.1642, ar: 0.0651 },
  '333mbf': { pr: 0.0722, ar: 0.0345 },
  '444bf': { pr: 0.0396, ar: 0.0801 },
  '333ft': { pr: 0.0394, ar: 0.0631 },
  magic: { pr: 0.0364, ar: 0.0937 },
  '555bf': { pr: 0.0237, ar: 0.0651 },
  mmagic: { pr: 0.0185, ar: 0.0896 },
  '333mbo': { pr: 0.0019, ar: 0.0095 },
};
/** 旧表（废弃）：早期 detail 2,500 人样本。仅留作对照，不参与任何计算。 */
const EV_STAT_V1 = {
  '333': { pr: 1.000, ar: 1.000 }, '222': { pr: 0.995, ar: 0.605 },
  '444': { pr: 0.996, ar: 0.501 }, '333oh': { pr: 0.997, ar: 0.437 },
  pyram: { pr: 0.982, ar: 0.442 }, '555': { pr: 0.988, ar: 0.347 },
  skewb: { pr: 0.948, ar: 0.362 }, minx: { pr: 0.971, ar: 0.260 },
  sq1: { pr: 0.930, ar: 0.249 }, clock: { pr: 0.908, ar: 0.256 },
  '333bf': { pr: 0.868, ar: 0.175 }, '666': { pr: 0.952, ar: 0.113 },
  '777': { pr: 0.938, ar: 0.101 }, '333fm': { pr: 0.918, ar: 0.049 },
  '444bf': { pr: 0.505, ar: 0.053 }, '333mbf': { pr: 0.659, ar: 0.023 },
  '333ft': { pr: 0.440, ar: 0.042 }, '555bf': { pr: 0.384, ar: 0.042 },
  magic: { pr: 0.149, ar: 0.071 }, mmagic: { pr: 0.115, ar: 0.063 },
  '333mbo': { pr: 0.020, ar: 0.007 },
};
/* 人次份额（pr×ar），保留导出供诊断脚本对照，不参与权重计算 */
const EV_SHARE = Object.keys(EV_STAT).reduce((m, e) => {
  m[e] = EV_STAT[e].pr * EV_STAT[e].ar;
  return m;
}, {});
const EV_RETIRED = new Set(['333ft', 'magic', 'mmagic', '333mbo']);

/** 停办项目的真实终止日（WCA 最后一场比赛的次日）。
 *
 *  旧口径的漏洞：停办项目的末段因为「再也没人打破」而被算成开放段，
 *  一路延到快照日，白赚 5000–6500 天的持有时长。
 *  实测：旧多盲 2006-09 的 24/24 被记成守 6753 天（18.5 年），
 *  直接冲进全站单段 Top3 —— 那不是守出来的，是项目被废掉了。
 *
 *  日期依据（数据里各项目最后一条纪录）：
 *    333ft  末条 2019-12-28 → 2020-01-01 移除
 *    magic  末条 2012-12-30 ┐2013-01-01 移除
 *    mmagic 末条 2012-12-29 ┘
 *    333mbo 末条 2009-01-31 → 2009-02-01 改规则（旧格式废止）
 */
const EV_RETIRED_DAY = {
  '333ft': dayOf('2020-01-01'),
  magic: dayOf('2013-01-01'),
  mmagic: dayOf('2013-01-01'),
  '333mbo': dayOf('2009-02-01'),
};

/** 规模指数 s_e = pr × sqrt(ar)，截到 [0,1]，三阶恒为 1 */
function scaleOf(ev, stat) {
  const st = (stat || EV_STAT)[ev];
  if (!st) return 0;
  return Math.max(0, Math.min(1, st.pr * Math.sqrt(Math.max(0, st.ar))));
}

/**
 * 由规模指数算出 v2 权重。纯函数，可任意改 cfg 做敏感性分析。
 * @param {{floor?:number, gamma?:number, retiredDiscount?:number, stat?:object}} [cfg]
 */
function buildWeightV2(cfg) {
  const c = { ...WEIGHT_V2_CFG, ...(cfg || {}) };
  const stat = c.stat || EV_STAT;
  const out = {};
  for (const ev of Object.keys(stat)) {
    let w = c.floor + (1 - c.floor) * Math.pow(scaleOf(ev, stat), c.gamma);
    if (EV_RETIRED.has(ev)) w *= c.retiredDiscount;
    out[ev] = ev === '333' ? 1 : w;      // 三阶钉死 1.000，不吃浮点误差
  }
  return out;
}

const EV_WEIGHT_V2 = buildWeightV2();

/**
 * 取项目权重。
 * @param {string} ev
 * @param {'legacy'|'v2'} [ver] 默认 legacy（与 js/calc.js 同步，保持旧口径）
 */
function evWeightOf(ev, ver) {
  if (ver === 'v2') {
    const w2 = EV_WEIGHT_V2[ev];
    return w2 == null ? WEIGHT_V2_CFG.floor : w2;
  }
  const w = EV_WEIGHT[ev];
  return w == null ? 1 : w;
}

/**
 * 项目内参考幅度 G_ref(e)。
 * 默认纯算术均值 —— 因为只有这样才成立恒等式 Σr = n。
 * 长尾（SQ1 的 G 分布中位 3.05%、最高 82%）由 NORM_CAP 单独压制，
 * 不再用截尾去动分母，否则恒等式破掉、总池不可解释。
 * 需要稳健版时可显式传 `trim: 0.1`（会放弃恒等式）。
 */
function refOf(gains, opt) {
  const o = opt || {};
  const a = (gains || []).filter((g) => Number.isFinite(g) && g > 0).slice().sort((x, y) => x - y);
  if (!a.length) return 0;
  const trim = o.trim == null ? 0 : o.trim;
  const k = trim > 0 && a.length >= 8 ? Math.floor(a.length * trim) : 0;
  const kept = k ? a.slice(0, a.length - k) : a;
  let s = 0;
  for (const g of kept) s += g;
  return s / kept.length;
}

/**
 * 把一条段的 G 换成项目内相对强度 r = G/G_ref，并截顶。
 * ref 缺省或为 0 时返回原值（向后兼容旧口径）。
 */
function normGain(gain, ref, cap) {
  if (!(ref > 0)) return gain;
  const c = cap == null ? NORM_CAP : cap;
  return Math.min(gain / ref, c);
}

/**
 * 段的得分。
 * @param {object} r buildLadder 产出的段
 * @param {{capDays?:number, dsat?:number, snapshotDay?:number,
 *          ref?:number, normCap?:number}} [opt]
 *        `ref`  传入即启用项目内归一；不传则保持原口径（credit = G × 年数）。
 *        `dsat` 传正数则用饱和函数代替硬截顶：
 *                 T_eff = dsat · (1 − e^(−T/dsat))
 *               守满 dsat 年得 63.2%，2×dsat 得 86.5%，渐近 100%。
 *               硬截顶（capDays）在 cap 处有拐点，且 cap 内的长度全部
 *               按实际计，长尾段会单点爆表；饱和版没有拐点。
 */
function runCredit(r, opt) {
  const o = opt || {};
  const cap = o.capDays == null ? 3650 : o.capDays;      // 默认 10 年：只拦停办项目/无人区的极端段
  /* 注意：这个默认值只服务于旧口径。v2 用 CAP_DAYS_V2（30 年）。 */
  const snap = o.snapshotDay == null ? SNAPSHOT_DAY : o.snapshotDay;
  const end = r.tEnd == null ? snap : r.tEnd;
  const days = Math.max(0, end - r.tStart);
  const dsat = o.dsat > 0 ? o.dsat : 0;
  const daysUsed = dsat ? dsat * (1 - Math.exp(-days / dsat)) : Math.min(days, cap);
  const norm = o.ref > 0;
  const ncap = o.normCap == null ? NORM_CAP : o.normCap;
  const gNorm = norm ? normGain(r.gain, o.ref, ncap) : r.gain;
  const ratio = norm ? r.gain / o.ref : null;
  return {
    gain: r.gain,                 // 原始 G，旧脚本读这个字段，保持不变
    gainNorm: gNorm,              // 归一后的相对强度 r
    ref: norm ? o.ref : null,
    ratio,
    capped: dsat ? days > dsat * 3 : days > cap,
    days,
    daysUsed,
    years: daysUsed / 365,
    credit: gNorm * (daysUsed / 365),
    open: r.tEnd == null,
    weightCapped: norm && ratio > ncap,
  };
}

/**
 * 时代折算在占有区间内的平均值（按月采样）
 * 段的得分是「随时间均匀累积」的，所以该用区间均值，而不是某一个年份的系数。
 */
function avgFactor(pool, level, who, t0, t1, snapshotDay) {
  if (!pool) return 1;
  const end = t1 == null ? (snapshotDay == null ? SNAPSHOT_DAY : snapshotDay) : t1;
  const f = (d) => (pool.valueOf
    ? pool.valueOf(level, who || {}, yearOfDay(d))
    : pool.yearValue(yearOfDay(d)));
  if (!(end > t0)) return f(t0);
  const n = Math.max(1, Math.min(120, Math.round((end - t0) / 30.44)));
  let s = 0;
  for (let i = 0; i < n; i++) s += f(t0 + ((end - t0) * (i + 0.5)) / n);
  return s / n;
}

/**
 * 整条阶梯评分：每段乘上 级别价值 × 竞争密度 × 时代均值
 * @param {Array} runs
 * @param {{ev?:string, level:'WR'|'CR'|'NR', rho:number, rhoScale?:number, w?:number}} meta
 * @param {{capDays?:number, pool?:object, who?:object, snapshotDay?:number,
 *          ref?:number, normCap?:number, applyWeight?:boolean}} [env]
 *        `ref`         传项目 G_ref 即启用项目内归一
 *        `applyWeight` 传 true 才乘项目系数 w_e（默认 false 保持旧口径）
 */
function scoreRuns(runs, meta, env) {
  const e = env || {};
  const gL = M1.G[meta.level] == null ? 1 : M1.G[meta.level];
  const rho = meta.rho || 0;
  const wv = e.weightVersion === 'v2' ? 'v2' : 'legacy';
  const wE = meta.w == null ? evWeightOf(meta.ev, wv) : meta.w;
  const useW = e.applyWeight === true;
  const out = [];
  for (const r of runs) {
    const c = runCredit(r, e);
    const f = avgFactor(e.pool, meta.level, e.who, r.tStart, r.tEnd == null ? e.snapshotDay : r.tEnd, e.snapshotDay);
    const v = c.credit * gL * rho * f * (useW ? wE : 1);
    out.push({ run: r, ...c, f, w: useW ? wE : null, weightVersion: useW ? wv : null, score: v });
  }
  return out;
}

/* 时长口径：线性，不折价。
 *
 * 曾经讨论过用饱和函数 T_eff = dsat·(1−e^(−T/dsat)) 替代硬截顶，理由是
 * 「硬截顶在 cap 处有拐点」。但它同时会给**所有**长段打折：dsat=5 年时
 * 守 4 年只能算 2.7 年（−31%），守 10 年只能算 8.65 年。
 * 这与「守得久就该值钱」直接冲突 —— 守 2000 天就得算 5.48 年，一分不少。
 *
 * 所以 v2 保持线性，cap 只做数据边界（防 tEnd 缺失造出的伪长段），
 * 定在 30 年 —— 远超真实上界（>10 年的段只占 0.5%），不影响任何真实成绩。
 * 饱和函数保留为可选项，`dsat` 显式传入才生效，用于敏感性分析。
 */
const DSAT_DEFAULT = 0;
/** v2 的数据边界截顶：30 年 */
const CAP_DAYS_V2 = 10950;

/**
 * v2 完整定价：项目内归一 + v2 项目系数 + 饱和时长，三项默认全开。
 *
 *   score = min(G / G_ref(e), R_CAP) × T_eff/365 × w_e^v2 × V_L × ρ_s × f_L
 *   T_eff = D_sat · (1 − e^(−T/D_sat))
 *
 * 与旧 `scoreRuns` 的区别：旧函数三项默认全关（为了保证旧报告逐位不变），
 * 这个函数默认全开。管线一律用它。
 *
 * @param {Array} runs
 * @param {{ev:string, level:'WR'|'CR'|'NR', rho:number, ref?:number, w?:number}} meta
 *        `ref` 缺省时按 meta.gains 现算（传了 meta.gains 就用 refOf）。
 * @param {{pool?:object, who?:object, snapshotDay?:number, dsat?:number,
 *          capDays?:number, normCap?:number, stat?:object}} [env]
 *        `stat` 传入可临时替换规模表，做敏感性分析。
 */
function scoreRunsV2(runs, meta, env) {
  const e = env || {};
  const ref = meta.ref != null ? meta.ref : refOf(meta.gains || []);
  const w = meta.w != null ? meta.w : (e.stat ? buildWeightV2({ stat: e.stat })[meta.ev] : evWeightOf(meta.ev, 'v2'));
  return scoreRuns(runs, { ...meta, w }, {
    ...e,
    ref: ref > 0 ? ref : null,
    capDays: e.capDays == null ? CAP_DAYS_V2 : e.capDays,
    dsat: e.dsat == null ? DSAT_DEFAULT : e.dsat,
    applyWeight: true,
    weightVersion: 'v2',
  });
}

/**
 * 一个项目的定价卡：G_ref、典型段单价、单段上界。
 * 单价以「一条三阶典型 WR」= 1.000 为锚。
 */
function priceCard(ev, gains, opt) {
  const o = opt || {};
  const ref = o.ref == null ? refOf(gains, o) : o.ref;
  const wv = o.weightVersion === 'v2' ? 'v2' : 'legacy';
  const w = o.w == null ? evWeightOf(ev, wv) : o.w;
  const cap = o.normCap == null ? NORM_CAP : o.normCap;
  return {
    ev, w, ref, normCap: cap, weightVersion: wv,
    unitTypical: w,             // 典型段（r=1）单价
    unitMax: cap * w,           // 单段上界（r=cap）
    unitTipical: w,             // 兼容旧拼写，勿在新代码使用
  };
}

/**
 * 拆分中性验算：同一段内把 L 的总进步拆成 k 步
 * 返回 {countCredit, runCredit} —— 旧口径按条数，新口径按段
 */
function splitCheck(totalGain, days, k, capDays) {
  const cap = capDays == null ? 1826 : capDays;
  const T = Math.min(days, cap) / 365;
  return { countCredit: k, runCredit: totalGain * T };
}

module.exports = {
  SNAPSHOT,
  EV_STAT_V1,
  DEC,
  R4,
  F4,
  P4,
  SNAPSHOT_DAY,
  MBF_SHIFT,
  TIE_WEIGHT,
  EV_WEIGHT,
  NORM_CAP,
  WEIGHT_V2_CFG,
  EV_STAT,
  EV_SHARE,
  scaleOf,
  EV_RETIRED,
  EV_RETIRED_DAY,
  EV_WEIGHT_V2,
  DSAT_DEFAULT,
  CAP_DAYS_V2,
  buildWeightV2,
  evWeightOf,
  refOf,
  normGain,
  priceCard,
  dayOf,
  dateOfDay,
  yearOfDay,
  kindOf,
  parseResult,
  isBetter,
  gainOf,
  buildLadder,
  runCredit,
  avgFactor,
  scoreRuns,
  scoreRunsV2,
  splitCheck,
};

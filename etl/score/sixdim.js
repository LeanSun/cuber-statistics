'use strict';
/* =============================================================================
 * sixdim.js · 六维统一查询引擎（M1-F2 / M2-F1 / M3-F1 / M4-F1 / M5快照 / M6-F2）
 * -----------------------------------------------------------------------------
 * 功能（对应用户 2026-10-25 的六条要求）：
 *   ① 六维每维可按 单次/平均/双轨 筛选              → --track single|avg|both
 *      （M2 自 2026-11-04 起按「决赛轮用 best / average 重排前三」拆轨，见 m2_tracks.js）
 *   ② 所有维度可按单项目筛选                      → --ev 333|all
 *   ③ 总分 = 各项目小计 × 项目系数 后累加          → EV_WEIGHT_V2 统一项目系数
 *   ④ 自定义时间截取（"至2010年的世界第一人"）      → --asof 2010
 *      语义：M1/M2/M3/M4/M6 = 累计维，取 y/date ≤ asOf 求和；
 *            M5 = 位置维，取 year ≤ asOf 的**最近年末快照**（不跨年求和）
 *   ⑤ 单维度独立排名（耦合以上全部筛选）           → --dim M1 等
 *   ⑥ 性别筛选                                    → --gender m|f|all
 *   ⑦ 六维累加 = 乘维度系数：M1 .42 / M2 .20 / M3 .10 / M4 .14 / M5 .06 / M6 .08
 *      （2026-11-05 起默认；旧值 .45/.15/.20/.15/.01/.04 已废止）
 *
 * 归一化：每个 (维度 × 项目) 在**当前筛选范围**内以榜首为 1（leader=1），
 *   消除六维量纲差（15,506 vs 77 差 200 倍的问题在合成层解决）。
 * 合成：  comp_e(pid) = EV_W(e) × Σ_d w_d × rel_d(pid, e)
 *         total(pid)  = Σ_e comp_e(pid) × FULL / Σ_{选中维} w_d  → 全维时榜首≈FULL
 *
 * 刻度 FULL（2026-10-26 用户要求「倍数翻十倍，看着分数多一些显得厉害」）：
 *   原 100 → 现 1000。**纯线性换算**，只改乘数，不改任何权重 / 归一 / 截顶 / 阈值。
 *   因此所有分数（维度分 s_d、单项目分 t_ev、总分 t）整体 ×10，
 *   名次、占比、结构比例全部不变。改这里即可，全站唯一真源。
 *
 * 数据源（各封存脚本的纯写出型事实表）：
 *   M1_facts.tsv  (pid,ev,type,level,scope,year,frac,score)      ← m1_hold.js
 *   M2_facts.tsv  (pid,name,ev,tier,pos,year,compId,base,decay)  ← m2m3_balance.js（both 轨）
 *                   ※ --track both→M2_facts.tsv / single→M2_facts_single.tsv / avg→M2_facts_avg.tsv
 *                     （← m2_tracks.js，按决赛轮 best / average 重排前三；both 轨逐字不变）※
 *   M3_facts.tsv  (pid,ev,type,lvl,tier,year,add)                ← m3_record_bonus.js
 *   M4_facts.tsv  (pid,ev,track,year,contrib)                    ← m4_dominance.js
 *   M5_facts.tsv  (year,pid,ev,kind,rank,score,k_single,k_avg)   ← m5_facts.js
 *                   ※ --track both→score / single→k_single / avg→k_avg（2026-11-04 起）※
 *   M6_by_record.tsv (pid,event,kind,date,prev,new,gain,capped_gain,ref,raw_norm,final_norm,same) ← m6_lead.js
 *                   ※ M6 取 c[10]=final_norm（时代平权版）；c[7]=capped_gain 为旧口径，勿用 ※
 *
 * 另读一张「换籍时间线」nat_seg.tsv（← nat_seg.js），仅用于把国家总分按历史国籍拆分：
 *   每条事实行按「发生年份所代表的国家」归集，合计层逐国求和（六维总分对事实行线性，
 *   所以 Σ_国 ≡ 个人总分，不做任何比例分摊），结果写 sixdim_nat.tsv 供 build.js 读。
 *   ⚠ WCA 导出更新后必须重跑 nat_seg.js，否则新换籍选手会被按当前国籍全额计入。
 *
 * 用法示例：
 *   node sixdim.js                                              # 六维全量总分榜
 *   node sixdim.js --asof 2010 --top 15                         # 至2010年的世界第一人
 *   node sixdim.js --ev 333 --track avg --asof 2020             # 至2020三阶平均
 *   node sixdim.js --dim M1 --track single                      # M1 单次轨独立排名
 *   node sixdim.js --gender f --top 10                          # 女子总分榜
 *   node sixdim.js --ev 333 --asof 2010 --csv out               # 另存 TSV
 * ============================================================================= */
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '../..');
global.window = {};
require(path.join(ROOT, 'js/roster.js'));

/* ── CLI（支持 --key=value 与 --key value 两种形式）── */
const argv = {};
for (let i = 2; i < process.argv.length; i++) {
  const m = process.argv[i].match(/^--(\w+)(?:=(.*)|$)$/);
  if (!m) continue;
  if (m[2] !== undefined) argv[m[1]] = m[2];
  else if (i + 1 < process.argv.length && !process.argv[i + 1].startsWith('--')) argv[m[1]] = process.argv[++i];
  else argv[m[1]] = true;
}
const OPT = {
  dims: (argv.dims ? String(argv.dims).toUpperCase().split(',') : ['M1', 'M2', 'M3', 'M4', 'M5', 'M6']),
  ev: argv.ev && argv.ev !== 'all' ? String(argv.ev) : null,
  track: argv.track ? String(argv.track) : 'both',            // single | avg | both（六维全部生效）
  gender: argv.gender ? String(argv.gender).toLowerCase() : 'all',  // m | f | all
  asof: argv.asof ? +argv.asof : 2026,
  top: argv.top ? +argv.top : 20,
  csv: argv.csv ? String(argv.csv) : null,
};

/* ── 维度权重（2026-11-05 起默认 42:20:10:14:6:8，即
   M1 .42 / M2 .20 / M3 .10 / M4 .14 / M5 .06 / M6 .08，Σ=1）────────────
   M1 纪录持有 .42（历史硬通货，仍是第一主币但不再近半壁）
   M2 领奖台   .20（覆盖面最宽、区分度最好，升为第二主币）
   M3 大赛表现 .10
   M4 统治力   .14
   M5 纪录比   .06（Kinch 绝对刻度；原名义 1% 被量纲放大，现直接给到 6%）
   M6 突破幅度 .08
   ⚠ 名义权重 ≠ 实际贡献：各维覆盖率差异极大（M5≈100%，其他维 0.5%–30.8%），
     且 s5 的量纲与其余维不同。默认值属产品决策，调前先核算各维实际覆盖率。
   ⚠ 改这里必须同步 etl/build.js SIX_W、js/params.js DEFAULTS 及前端全部兜底，
     再跑 rebuild_sixdim.js 重建交付表 —— 否则 ETL 预置的 p.six.t 与页面按当前
     权重实时重算的总分对不上（榜单 / 选手页 / 六维细则会出现两套分数）。 */
const DIMS = {
  M1: { w: 0.42, cn: '纪录持有' },
  M2: { w: 0.20, cn: '领奖台' },
  M3: { w: 0.10, cn: '大赛表现' },
  M4: { w: 0.14, cn: '统治力' },
  M5: { w: 0.06, cn: '纪录比' },
  M6: { w: 0.08, cn: '突破幅度' },
};
const BETA = 0.2241;                    // M2 普通赛折算（M2-F1 冻结常量）
/* 刻度：单项目「六维全满」= FULL 分（原 100，2026-10-26 用户要求 ×10 → 1000）。
   只影响显示量级，不影响排序与结构（纯线性换算）。 */
const FULL = 1000;
/* 站点三张交付表（sixdim_site / sixdim_by_event / js/sixdim_data.js）只保留总分前 N 名。
   这个上限对齐 js/data.js 的承载能力（--slim-max 60000 + 明细层回填），
   属于体积约束、不是评分口径的截断：全量 298,719 人的总分另见 sixdim_tail.tsv。
   2026-10-29 前这一步靠跑完手工截断，重建时会悄悄退回全量（19MB / 90MB），故收进代码。 */
const SITE_MAX = 62000;
/* ★ 2026-11-02：截断必须把**所有纪录持有者**捞回来。
   build.js 会把「有纪录但排不进前 6 万」的选手补进 data.js 明细层（时间轴要能点开他们），
   而六维主表若只按总分截前 62,000，这些人在站点上 p.six = null →
   总分显示 0、雷达空白、历史地位排名里查无此人，可纪录时间轴里明明有他。
   典型：2007YUAR01 Aron Yu（2007 年中国首个三盲 NR）、2007YUGU01 Guanyang Yu。
   全集取 **data.js 里有 records 的选手**（4,952 人；M1_facts 只有 4,890 —— 差的那几十人
   是 M1 恰好 0 分但仍持有纪录的人，漏掉就又会出现「时间轴有他、总榜没他」）。 */
const REC_HOLDERS = new Set();
const TRACK_OF = { single: 'single', avg: 'avg' };

/* ── 姓名 + 性别：data.js 全量玩家为主源，roster 长尾名册兜底 ── */
require(path.join(ROOT, 'js/data.js'));
const R = global.window.WCA_ROSTER;
const genderOf = new Map(), nameOf = new Map();
for (const ln of R.rows.split('\n')) {
  if (!ln) continue;
  const f = ln.split('~');
  if (f.length < 4) continue;
  if (!genderOf.has(f[0])) genderOf.set(f[0], f[3] === 'f' ? 'f' : 'm');
  if (!nameOf.has(f[0])) nameOf.set(f[0], f[1]);
}
for (const p of global.window.MOCK.players) {
  genderOf.set(p.id, p.gender === 'f' ? 'f' : 'm');
  nameOf.set(p.id, p.name);
  if ((p.records || []).length) REC_HOLDERS.add(p.id);
}
/* M1_facts 里出现过、但 data.js 里没 records 的（理论上没有）也一并保住 */
for (const ln of fs.readFileSync(path.join(__dirname, 'M1_facts.tsv'), 'utf8').split('\n').slice(1)) {
  const pid = ln.slice(0, ln.indexOf('\t'));
  if (pid) REC_HOLDERS.add(pid);
}

/* ── 载入事实表 → dim → Map(pid → Map(ev → score)) ──
   track: 'single' | 'avg' | null(both/不适用) */
const D = path.join(__dirname);
function load(file) {
  const lines = fs.readFileSync(path.join(D, file), 'utf8').trim().split('\n');
  return lines;
}

/* ── 换籍时间线（etl/score/nat_seg.js 产出）────────────────────────────
   国家**总分榜**不能按当前国籍一人只计一次：换籍选手在 A 国期间刷的分要算给 A，
   换到 B 国之后才算 B（与纪录归属同一条原则）。这里只载入几十~几百人的段表，
   不影响任何排名归一 —— 每维每项目的榜首（maxOf）仍是全站口径，拆分只在合计层做加法。
   缺这张表时静默退回「按当前国籍聚合」的旧行为，并在结尾说明。 */
const DAYMS = 86400000;
const NATSEG = new Map();          // pid → [{iso, from, to}]（from/to = 距 1970-01-01 的天数）
(function loadNatSeg() {
  const f = path.join(D, 'nat_seg.tsv');
  if (!fs.existsSync(f)) return;
  const d = (s) => Math.round(Date.parse(String(s).slice(0, 10) + 'T00:00:00Z') / DAYMS);
  const lines = fs.readFileSync(f, 'utf8').trim().split('\n');
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split('\t');
    if (c.length < 4) continue;
    let a = NATSEG.get(c[0]);
    if (!a) { a = []; NATSEG.set(c[0], a); }
    a.push({ iso: c[1], from: d(c[2]), to: d(c[3]) });
  }
  if (NATSEG.size) console.log(`# 换籍时间线：${NATSEG.size} 人（国家总分按历史国籍拆分）`);
})();
const ctyYearCache = new Map();
/** 某选手在某年代表时间最长的国家（能正确处理年中换籍） */
function ctyOfYear(pid, y) {
  const segs = NATSEG.get(pid);
  if (!segs) return null;
  const k = pid + '|' + y;
  if (ctyYearCache.has(k)) return ctyYearCache.get(k);
  const y0 = Math.round(Date.UTC(y, 0, 1) / DAYMS);
  const y1 = Math.round(Date.UTC(y, 11, 31) / DAYMS);
  let best = segs[segs.length - 1].iso, bestD = -1;
  for (const s of segs) {
    const d = Math.min(y1, s.to) - Math.max(y0, s.from) + 1;
    if (d > bestD) { bestD = d; best = s.iso; }
  }
  ctyYearCache.set(k, best);
  return best;
}
/** 某一天代表的国家 */
function ctyOfDay(pid, day) {
  const segs = NATSEG.get(pid);
  if (!segs) return null;
  for (const s of segs) if (day >= s.from && day <= s.to) return s.iso;
  return day < segs[0].from ? segs[0].iso : segs[segs.length - 1].iso;
}
/** 只有换过籍的选手才需要算；其他人一律返回 null（快路径，M5 有 200 万行） */
const isCross = (pid) => NATSEG.size > 0 && NATSEG.has(pid);

const asofEnd = OPT.asof >= 2026 ? Infinity : Date.parse(OPT.asof + '-12-31T00:00:00Z') / 86400000;
const sub = new Map();                    // dim → Map(pid → Map(ev → score))
/* 换籍选手的按国原始分量：pid → iso → `维度|项目` → 值。
   只对 NATSEG 里那几百人建，体积可忽略；合成后 Σ_国 t 必须逐位等于总分。 */
const natRaw = new Map();
/* ── 项目系数（EV_WEIGHT_V2）── 提前定义：M5 的 Kinch 均值编码要用到 evW */
const RUNS = require(path.join(ROOT, 'etl/score/runs.js'));
const EVW = RUNS.EV_WEIGHT_V2;
const evW = (ev) => (EVW[ev] == null ? RUNS.WEIGHT_V2_CFG.floor : EVW[ev]);
for (const dim of OPT.dims) {
  const m = new Map();
  const put = (pid, ev, v, cty) => {
    if (!(v > 0)) return;
    if (OPT.gender !== 'all' && genderOf.get(pid) !== OPT.gender) return;
    let a = m.get(pid); if (!a) { a = new Map(); m.set(pid, a); }
    a.set(ev, (a.get(ev) || 0) + v);
    if (cty) {
      let s = natRaw.get(pid); if (!s) { s = new Map(); natRaw.set(pid, s); }
      let t = s.get(cty); if (!t) { t = new Map(); s.set(cty, t); }
      const k = dim + '|' + ev;
      t.set(k, (t.get(k) || 0) + v);
    }
  };
  if (dim === 'M1') {
    for (const ln of load('M1_facts.tsv').slice(1)) {
      const c = ln.split('\t');
      const y = +c[5]; if (y > OPT.asof) continue;
      const type = c[2] === 'avg' ? 'avg' : 'single';
      if (OPT.track !== 'both' && type !== OPT.track) continue;
      if (OPT.ev && c[1] !== OPT.ev) continue;
      /* 归属国：NR 的 scope 列本身就是**纪录刷新时**的 ISO2（m1_hold 由 records[].cty 写入，
         是权威值，比按年份反推更准）；WR/CR 的 scope 是 WW / 洲名，只能按年份归。
         ⚠ 不能用「看起来像两个大写字母」来判断国家 —— WR 的 scope 就是 'WW'，
         会把世界纪录误记到一个叫 WW 的「国家」名下（实测多算了 5 人的 100+ 分）。
         只认该选手自己段表里出现过的国家。 */
      let cty = null;
      if (isCross(c[0])) {
        const segs = NATSEG.get(c[0]);
        cty = segs.some((s) => s.iso === c[4]) ? c[4] : ctyOfYear(c[0], y);
      }
      put(c[0], c[1], +c[7], cty);
    }
  } else if (dim === 'M2') {
    /* 三轨事实表：both 用原表；single / avg 用 m2_tracks.js 按决赛轮
       best / average 重排前三得到的表。缺文件时必须明确告警再退回合并档 ——
       静默退回正是「选了单次/平均却毫无变化」的老毛病。 */
    let mf = 'M2_facts.tsv';
    if (OPT.track === 'single' || OPT.track === 'avg') {
      const cand = 'M2_facts_' + OPT.track + '.tsv';
      if (fs.existsSync(path.join(D, cand))) mf = cand;
      else console.warn(`⚠ 缺 ${cand}，--track ${OPT.track} 的 M2 退回合并档（先跑 m2_tracks.js）`);
    }
    for (const ln of load(mf).slice(1)) {
      const c = ln.split('\t');
      if (+c[5] > OPT.asof) continue;
      if (OPT.ev && c[2] !== OPT.ev) continue;
      const v = (+c[7]) * (+c[8]) * (c[3] === 'OP' ? BETA : 1);
      put(c[0], c[2], v, isCross(c[0]) ? ctyOfYear(c[0], +c[5]) : null);
    }
  } else if (dim === 'M3') {
    for (const ln of load('M3_facts.tsv').slice(1)) {
      const c = ln.split('\t');
      if (+c[5] > OPT.asof) continue;
      const type = c[2] === 'A' ? 'avg' : 'single';
      if (OPT.track !== 'both' && type !== OPT.track) continue;
      if (OPT.ev && c[1] !== OPT.ev) continue;
      put(c[0], c[1], +c[6], isCross(c[0]) ? ctyOfYear(c[0], +c[5]) : null);
    }
  } else if (dim === 'M4') {
    for (const ln of load('M4_facts.tsv').slice(1)) {
      const c = ln.split('\t');
      if (+c[3] > OPT.asof) continue;
      const tr = c[2] === 'average' ? 'avg' : 'single';
      if (OPT.track !== 'both' && tr !== OPT.track) continue;
      if (OPT.ev && c[1] !== OPT.ev) continue;
      put(c[0], c[1], +c[4], isCross(c[0]) ? ctyOfYear(c[0], +c[3]) : null);
    }
  } else if (dim === 'M5') {
    /* 快照维：取 year ≤ asof 的最近快照 */
    let bestYear = -1;
    const rows = [];
    for (const ln of load('M5_facts.tsv').slice(1)) {
      const c = ln.split('\t');
      const y = +c[0]; if (y > OPT.asof) continue;
      rows.push(c); if (y > bestYear) bestYear = y;
    }
    if (bestYear >= 0) {
      /* 严格 Kinch：M5 = (1/N) × Σ_e (k/100)，N = 现役项目数（17），缺项按 0 计。
         ★ 2026-11-04：M5_facts.tsv 新增 c[6]=k_single / c[7]=k_avg，
           --track 现在**真正**切换 M5：both→c[5]、single→c[6]、avg→c[7]。
           三套共用同一个分母 N（口径只换分子，不换刻度），
           否则 avg 档因 333mbf 无平均榜会让 N 从 17 掉到 16、全员虚高。
         ⚠ 分母的项目集合取自**综合档**（c[5]>0），与 --track 无关；
           --ev 单项目查询仍沿用既有的 N=1 行为（诊断用）。
         ★★ 方案 A（2026-11-04，用户拍板「统一量纲」）：
           旧编码 v = EVSUM·(k/100)/N/evW(ev) 会得到 s5 = EVSUM·FULL·K/100 = 90.817×K，
           整维满分被抬到 9081.7，与其他维（榜首 3400–5600）不是同一把尺，
           名义 1% 的权重实际占全站加权贡献 74.1%。
           现**去掉 EVSUM 因子**：v = (k/100)/N/evW(ev)，则
             s5 = Σ_ev v·evW·FULL/Σw = (1/N)Σ(k/100)·FULL = 10 × K（K=0..100）
           → 整维满分 = FULL = 1000，逐项目满分 = FULL/N = 58.8235；
           与官方 0–100 的 Kinch 只差 10 倍刻度（÷10 即可核对）。
         ⚠ maxOf['M5'] 仍必须压成 1：若按「该项目本站榜首」归一，
           s5[ev] 会正比于 evW(ev)，破坏 Kinch 的 17 项等权。 */
      const kCol = OPT.track === 'single' ? 6 : OPT.track === 'avg' ? 7 : 5;
      const fr = rows.filter((c) => +c[0] === bestYear
        && (!OPT.ev || c[2] === OPT.ev));
      const denomEvs = new Set();
      if (OPT.ev) denomEvs.add(OPT.ev);
      else for (const c of rows) {
        if (+c[0] === bestYear && (+c[5] || 0) > 0) denomEvs.add(c[2]);
      }
      const N = denomEvs.size || 1;
      for (const c of fr) {
        const k = +c[kCol] || 0;
        if (!(k > 0)) continue;
        const v = (k / 100) / N / evW(c[2]);
        put(c[1], c[2], v, isCross(c[1]) ? ctyOfYear(c[1], +c[0]) : null);
      }
      console.log(`# M5 快照取 ${bestYear} 年末（track=${OPT.track} → c[${kCol}]，N=${N} 个现役项目；方案A：s5=10×Kinch均值，整维满分=FULL=1000）`);
    }
  } else if (dim === 'M6') {
    for (const ln of load('M6_by_record.tsv').slice(1)) {
      const c = ln.split('\t');
      const d = Date.parse(c[3] + 'T00:00:00Z') / 86400000;
      if (d > asofEnd) continue;
      const kind = c[2] === 'avg' ? 'avg' : 'single';
      if (OPT.track !== 'both' && kind !== OPT.track) continue;
      if (OPT.ev && c[1] !== OPT.ev) continue;
      /* M6 的事实行带**精确日期**，直接按当天所属国籍归，不需要按年份近似 */
      put(c[0], c[1], +c[10], isCross(c[0]) ? ctyOfDay(c[0], d) : null);   // c[10]=final_norm（时代平权版 M6）；c[7]=capped_gain 为旧口径，勿用
    }
  }
  sub.set(dim, m);
}

/* ── 合成 ── */
const selDims = OPT.dims;
const wSum = selDims.reduce((s, d) => s + DIMS[d].w, 0) || 1;
/* 每维每项目的榜首（范围内归一基准） */
const maxOf = {};   // dim → Map(ev → max)
for (const dim of selDims) {
  const mm = new Map();
  for (const [, a] of sub.get(dim)) for (const [ev, v] of a) if (v > (mm.get(ev) || 0)) mm.set(ev, v);
  maxOf[dim] = mm;
}
/* M5 已用 Kinch 均值编码（方案 A：v=(k/100)/N/evW，不含 EVSUM），归一基准固定为 1。
   若改成按「该项目本站榜首」归一，s5[ev] 会正比于 evW(ev)、17 项等权即失效。 */
if (maxOf['M5']) for (const ev of maxOf['M5'].keys()) maxOf['M5'].set(ev, 1);
/* 汇总 pids */
const pids = new Set();
for (const dim of selDims) for (const pid of sub.get(dim).keys()) pids.add(pid);
const rowsOut = [];
for (const pid of pids) {
  const perEv = new Map();   // ev → { dim → sub }
  let hasAny = false;
  for (const dim of selDims) {
    const a = sub.get(dim).get(pid);
    if (!a) continue;
    hasAny = true;
    for (const [ev, v] of a) {
      if (!perEv.has(ev)) perEv.set(ev, {});
      perEv.get(ev)[dim] = v;
    }
  }
  if (!hasAny) continue;
  let total = 0, evParts = 0;
  for (const [ev, dmap] of perEv) {
    let comp = 0;
    for (const dim of selDims) {
      const v = dmap[dim] || 0;
      const mx = maxOf[dim].get(ev) || 0;
      if (v > 0 && mx > 0) comp += DIMS[dim].w * (v / mx);
    }
    comp = comp * evW(ev) * FULL / wSum;
    total += comp; evParts++;
  }
  rowsOut.push({ pid, name: nameOf.get(pid) || pid, gender: genderOf.get(pid) || '?', total, evParts, perEv });
}
rowsOut.sort((a, b) => b.total - a.total);

/* ── 单维排名（耦合全部筛选） ── */
function dimRanking(dim) {
  const list = [];
  for (const [pid, a] of sub.get(dim)) {
    let s = 0; for (const [, v] of a) s += v;
    list.push({ pid, name: nameOf.get(pid) || pid, s, evs: a.size });
  }
  list.sort((x, y) => y.s - x.s);
  return list;
}

/* ── 输出 ── */
const F = (v, n = 2) => Number(v).toFixed(n);
const tag = `dims=${selDims.join('+')} ev=${OPT.ev || '全部'} track=${OPT.track} gender=${OPT.gender} asof=${OPT.asof}`;
console.log(`\n=== 六维总分 · ${tag} ===`);
console.log(`权重: ${selDims.map((d) => `${d}(${DIMS[d].cn}) ${DIMS[d].w}`).join(' / ')}`);
console.log(`人数 ${rowsOut.length}`);
console.log('\n#  选手                          性别  项目数 | ' + selDims.map((d) => d.padStart(6)).join(' ') + ' |   总分');
rowsOut.slice(0, OPT.top).forEach((x, i) => {
  const cols = selDims.map((d) => {
    let s = 0;
    for (const [, dmap] of x.perEv) s += dmap[d] || 0;
    return F(s, 1).padStart(6);
  }).join(' ');
  console.log(`${String(i + 1).padStart(2)} ${x.name.padEnd(26).slice(0, 26)}  ${x.gender}   ${String(x.evParts).padStart(3)}  | ${cols} | ${F(x.total)}`);
});
console.log('\n── 单维榜首 ──');
for (const dim of selDims) {
  const r = dimRanking(dim)[0];
  if (r) console.log(`  ${dim} ${DIMS[dim].cn}: ${r.name} ${F(r.s)}（${r.evs} 项目）`);
}
if (OPT.csv) {
  const out = ['rank\tpid\tname\tgender\ttotal\t' + selDims.join('\t')];
  rowsOut.forEach((x, i) => {
    const cols = selDims.map((d) => {
      let s = 0;
      for (const [, dmap] of x.perEv) s += dmap[d] || 0;
      return s.toFixed(4);
    });
    out.push([i + 1, x.pid, x.name, x.gender, x.total.toFixed(4), ...cols].join('\t'));
  });
  fs.writeFileSync(path.join(D, `${OPT.csv}.tsv`), out.join('\n') + '\n', 'utf8');
  console.log(`\n→ 已写 ${OPT.csv}.tsv（全量 ${rowsOut.length} 行）`);
}
/* ── 六维分数细则页面数据（仅在无筛选的全量口径下写出，避免覆盖成局部快照）──
   track=both     → sixdim_site.tsv / sixdim_by_event.tsv（主交付，build.js 直接依赖）
   track=single/avg → sixdim_site_single.tsv / sixdim_by_event_single.tsv（成绩口径拆分用） */
const DIM_KEYS = Object.keys(DIMS);
const noFilter = !OPT.ev && OPT.gender === 'all' && OPT.asof === 2026 && DIM_KEYS.every((k) => OPT.dims.includes(k));
const trk = (OPT.track === 'both' || !OPT.track) ? '' : '_' + OPT.track;   // '' | '_single' | '_avg'
if (OPT.csv && noFilter) {
  /* 站点接入用：s_d = Σ_ev (v/mx) × evW × FULL / wSum，满足 总分 = Σ_d w_d × s_d */
  const site = ['pid\ts1\ts2\ts3\ts4\ts5\ts6\tt'];
  /* 前 SITE_MAX 名 ∪ 纪录持有者（见 REC_HOLDERS 注释）；rowsOut 已按总分降序，
     filter 保序，所以并入的人依旧按总分插在原位，rank 不乱。 */
  const siteRows = rowsOut.filter((x, i) => i < SITE_MAX || REC_HOLDERS.has(x.pid));
  const rescued = siteRows.length - Math.min(SITE_MAX, rowsOut.length);
  if (rescued > 0) console.log(`  纪录持有者补录 ${rescued} 人（总分在 ${SITE_MAX} 名之外，但时间轴要能点开他们）`);
  for (const x of siteRows) {
    const s = selDims.map((dim) => {
      let acc = 0;
      for (const [ev, dmap] of x.perEv) {
        const v = dmap[dim] || 0, mx = maxOf[dim].get(ev) || 0;
        if (v > 0 && mx > 0) acc += (v / mx) * evW(ev) * FULL / wSum;
      }
      return acc.toFixed(4);
    });
    site.push([x.pid, ...s, x.total.toFixed(4)].join('\t'));
  }
  fs.writeFileSync(path.join(D, 'sixdim_site' + trk + '.tsv'), site.join('\n') + '\n', 'utf8');
  console.log(`→ 已写 etl/score/sixdim_site${trk}.tsv（前 ${siteRows.length} / 全量 ${rowsOut.length} 人，SITE_MAX=${SITE_MAX}）`);
  /* ── 全量总分轻表（sixdim_tail.tsv）──
     站点主表 sixdim_site.tsv 为控制仓库体积只保留前 62,000 名，剩下 23 万人
     在长尾名册里查不到分，页面就会显示「总分 0」，看起来像没被统计。
     这里额外落一张只含 pid + 总分的轻表（全量，约 6.5MB），
     build.js 读它给长尾名册补真实总分；主表仍保持 62,000 行不变。
     只写 both 口径（trk === ''）：名册展示的就是综合总分，单/双轨拆分用不上。 */
  if (!trk) {
    const tailT = ['pid\tt'];
    for (const x of rowsOut) tailT.push(x.pid + '\t' + x.total.toFixed(4));
    fs.writeFileSync(path.join(D, 'sixdim_tail.tsv'), tailT.join('\n') + '\n', 'utf8');
    console.log(`→ 已写 etl/score/sixdim_tail.tsv（全量 ${rowsOut.length} 行，供长尾名册补总分）`);
  }
  /* ── 按项目分解的六维分（站点「项目筛选后按六维总分排序」用）──
     s_d[ev] = (v_d,ev / max_d,ev) × evW(ev) × FULL / wSum，与 sixdim_site.tsv 同一归一分母，
     因此 Σ_ev s_d[ev] ≡ s_d、Σ_d w_d·s_d[ev] ≡ t_ev，全项目求和可精确复原全站分。 */
  const byEv = ['pid\tev\ts1\ts2\ts3\ts4\ts5\ts6\tt'];
  let beLines = 0;
  for (const x of siteRows) {
    for (const [ev, dmap] of x.perEv) {
      const s = DIM_KEYS.map((dim) => {
        const v = dmap[dim] || 0, mx = maxOf[dim].get(ev) || 0;
        return (v > 0 && mx > 0) ? (v / mx) * evW(ev) * FULL / wSum : 0;
      });
      let t = 0;
      DIM_KEYS.forEach((k, i) => { t += DIMS[k].w * s[i]; });
      byEv.push([x.pid, ev, ...s.map((v) => v.toFixed(4)), t.toFixed(4)].join('\t'));
      beLines++;
    }
  }
  fs.writeFileSync(path.join(D, 'sixdim_by_event' + trk + '.tsv'), byEv.join('\n') + '\n', 'utf8');
  console.log(`→ 已写 etl/score/sixdim_by_event${trk}.tsv（${beLines} 条 选手×项目 记录）`);

  /* ── 国家总分的历史拆分（sixdim_nat.tsv）──────────────────────────
     国家榜的「总分」= Σ 选手总分。但换籍选手不是只属于一个国家：他在 A 国刷的分
     应算 A，换籍后的分才算 B（与纪录归属同一条原则）。六维总分对事实行是**线性**的
     （comp = w_d · v/mx · evW · FULL/Σw，逐行相加），所以按事实行的归属国分组求和
     就能得到精确拆分，不需要按年份拍脑袋分摊 —— Σ_国 t ≡ 该选手总分。
     只写 both 口径；没换籍的人不出现（占比 99.9%，写了纯属浪费）。 */
  if (!trk && natRaw.size) {
    const natTot = (pid, isoMap) => {
      let t = 0;
      for (const [k, v] of isoMap) {
        const i = k.indexOf('|');
        const dim = k.slice(0, i), ev = k.slice(i + 1);
        const mx = maxOf[dim].get(ev) || 0;
        if (v > 0 && mx > 0) t += DIMS[dim].w * (v / mx) * evW(ev) * FULL / wSum;
      }
      return t;
    };
    const natRows = ['pid\tiso\tt'];
    const totalOf = new Map(rowsOut.map((x) => [x.pid, x.total]));
    let worst = 0, worstPid = '', nPid = 0;
    for (const [pid, byIso] of natRaw) {
      const parts = [];
      let sum = 0;
      for (const [iso, isoMap] of byIso) {
        const t = natTot(pid, isoMap);
        if (!(t > 0)) continue;
        parts.push([iso, t]);
        sum += t;
      }
      if (!parts.length) continue;
      nPid++;
      const ref = totalOf.get(pid) || 0;
      const diff = Math.abs(sum - ref) / Math.max(1, ref);
      if (diff > worst) { worst = diff; worstPid = pid; }
      parts.sort((a, b) => b[1] - a[1]);
      for (const [iso, t] of parts) natRows.push([pid, iso, t.toFixed(4)].join('\t'));
    }
    fs.writeFileSync(path.join(D, 'sixdim_nat.tsv'), natRows.join('\n') + '\n', 'utf8');
    console.log(`→ 已写 etl/score/sixdim_nat.tsv（${nPid} 位换籍选手 / ${natRows.length - 1} 段，`
      + `拆分后与总分最大相对偏差 ${(worst * 100).toFixed(4)}%${worstPid ? ' @' + worstPid : ''}）`);
  }
  const compact = siteRows.map((x, i) => {
    const d = {};
    for (const dim of DIM_KEYS) {
      let s = 0;
      for (const [, dmap] of x.perEv) s += dmap[dim] || 0;
      d[dim] = +s.toFixed(4);
    }
    return { r: i + 1, id: x.pid, n: x.name, g: x.gender, t: +x.total.toFixed(4), ...d };
  });
  if (OPT.track === 'both') {
    const page = {
      meta: {
        generated: new Date().toISOString().slice(0, 10),
        count: compact.length,
        weights: Object.fromEntries(DIM_KEYS.map((k) => [k, DIMS[k].w])),
        labels: Object.fromEntries(DIM_KEYS.map((k) => [k, DIMS[k].cn])),
        /* truncated = 全量人数（本页只放前 SITE_MAX 名 + 纪录持有者）。缺这两个字段时，
           页面看不出「62,000 是截断后的展示量，不是评分总量」。 */
        truncated: rowsOut.length,
        note: `仅展示前 ${SITE_MAX} 人 + 全部纪录持有者（与 js/data.js 的承载范围一致）；全量 ${rowsOut.length} 人的总分见 sixdim_tail.tsv`,
      },
      rows: compact,
    };
    fs.writeFileSync(path.join(__dirname, '..', '..', 'js', 'sixdim_data.js'),
      '/* 自动生成：etl/score/sixdim.js → 六维分数细则数据。勿手改。 */\nwindow.SIXDIM = ' + JSON.stringify(page) + ';\n', 'utf8');
    console.log(`→ 已写 js/sixdim_data.js（${compact.length} 人，实验榜页面数据）`);
  }
}

'use strict';
/* =============================================================================
 * M1-F2 · 纪录持有价值（纯持有版 · r 分量已剥离）
 * -----------------------------------------------------------------------------
 * 2026-10-25 解封改造（M1-F1 → M1-F2）：
 *
 *   用户拍板：六维引入 M6-F2「领先幅度」（gain=ln(前值/现值) 单独成维）后，
 *   M1 里的 r 分量（min(G/G_ref,3)）与 M6-F2 是同一份数学，必须剥离避免双计。
 *
 *   M1-F2 = Σ_段 [ min(T,30年)/365 × V_L × ρ_s × f_L × w_e ]      ← r ≡ 1
 *     T   = 本人持有到被别人打破的天数（CAP_DAYS_V2=30 年封顶）
 *     V_L = WR 1.0 / CR 0.4 / NR 0.15
 *     ρ_s = 级别属地竞争密度（★ 2026-10-26 方案 B：按年，见 §ρ 口径）
 *     f_L = 持有区间时代折算均值（沿用 M1-F1 的 2026-10-24 保留决定）
 *     w_e = EV_WEIGHT_V2
 *
 *   ★ 2026-10-26 用户拍板（方案 B）：ρ 从「当期快照比」改为「按年竞争密度」。
 *     理由：数据每周从 WCA 官网更新，全站人数只增不减 —— 旧口径的分母 R.total
 *     每期都变，会让**所有历史 CR/NR 分数**整体等比漂移（一次重建就漂 1.88 倍）。
 *     新口径分子分母同年取自同一池子，历史年份的 ρ 只受「该年之前注册的新增」影响，
 *     每周刷新几乎不动。详见 §ρ 口径 与 M1_封存_2026-10-24.md §F2c。
 *
 *   ★ 副作用（语义改善）：M1-F1 的「阶梯首段 r=0 不计分」边界随之消失 ——
 *     首段没有前值可比但持有是真实事件，纯持有口径下 Minh Thai 守 7,749 天正常得分。
 *
 *   r 分量（领先幅度）的归宿：M6-F2，见 m6_lead.js / M6_封存_2026-10-25.md
 *
 * 运行：node --max-old-space-size=8192 etl/score/m1_hold.js
 * 产出：etl/score/纪录分_纯持有.md / M1_hold_full.tsv
 * ============================================================================= */
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '../..');
global.window = {};
require(path.join(ROOT, 'js/data.js'));
require(path.join(ROOT, 'js/roster.js'));
const CL = require(path.join(ROOT, 'js/calc.js'));
const M1 = require(path.join(ROOT, 'etl/score/m1.js'));
const RN = require(path.join(ROOT, 'etl/score/runs.js'));

const P = global.window.MOCK.players;
const R = global.window.WCA_ROSTER;
const F = (v, n) => RN.F4(v, n == null ? RN.DEC : n);
const num = (v) => Number(v).toLocaleString('en-US');

/* ── 池子（时代折算用）——与 M1-F1 完全一致 ── */
const cc = {}, nc = {}, people = [];
for (const ln of R.rows.split('\n')) {
  if (!ln) continue;
  const f = ln.split('~');
  if (f.length < 4) continue;
  nc[f[2]] = (nc[f[2]] || 0) + 1;
  const c = CL.contOfIso(f[2]) || '??';
  cc[c] = (cc[c] || 0) + 1;
  if (+f[5]) people.push({ y: +f[5], cont: c, nat: f[2] });
}
for (const p of P) {
  nc[p.country] = (nc[p.country] || 0) + 1;
  const c = CL.contOfIso(p.country) || '??';
  cc[c] = (cc[c] || 0) + 1;
  if (p.start) people.push({ y: p.start, cont: c, nat: p.country });
}
const ctx = M1.makeContext({ contCount: cc, natCount: nc, total: R.total });
const pool = M1.makeScopePool(people);

/* =============================================================================
 * §ρ 口径（★ 2026-10-26 方案 B）
 * -----------------------------------------------------------------------------
 *  A（旧，已停用）：ρ_s = 属地全量人数 ÷ R.total
 *      一个标量，取「当前快照」；分母 R.total 每期随数据刷新而变
 *      → 所有历史 CR/NR 分数按同一比例整体漂移（非平稳）。
 *
 *  B（今，默认）：ρ_s(t) = 属地当年累计人数 ÷ 全球当年累计人数
 *      时间函数，与 f_L 一起在持有区间上积分：
 *          score = min(T,30y)/365 × V_L × w_e × ⟨ f_L(t) · ρ_s(t) ⟩_区间
 *      性质：
 *        · ρ_WR(t) ≡ 1（分子分母同池）→ **WR 段数值与旧口径逐位相同**
 *        · 无基准年归一，天然尺度无关：分子分母同年取自同一池子
 *        · 历史年份的 ρ 只受「首次参赛年 ≤ 该年」的新增影响，每周刷新几乎不动
 *        · 语义 = 「当年这条纪录在多大池子里稀缺」，而非「相对今天多稀缺」
 *
 *  切换：M1_RHO=snapshot 可退回旧口径（仅供对比，不作为生产口径）。
 * ========================================================================== */
const RHO_MODE = process.env.M1_RHO === 'snapshot' ? 'snapshot' : 'time';
/* NR 的时代折算必须用「该国池」；旧代码把 who 直接传进 pool.valueOf，
 * 而 valueOf 读的是 w.nat（who 里只有 country）→ 静默落到全球池，
 * 导致 f_NR ≡ f_WR（CN/AU/US/JP/IN 在 2010 年全是 0.7340）。
 * M1_NR_F=world 可退回该 bug 行为，仅供对比。 */
const NR_F_MODE = process.env.M1_NR_F === 'world' ? 'world' : 'country';

const rhoYear = new Map();   // level|scope|year → ρ
function rhoAt(level, scope, y) {
  if (level === 'WR') return 1;
  if (RHO_MODE === 'snapshot') return level === 'CR' ? ctx.rhoC(scope) : ctx.rhoN(scope);
  const k = level + '|' + scope + '|' + y;
  let v = rhoYear.get(k);
  if (v == null) {
    const den = pool.globalAt(y);
    const num = level === 'CR' ? pool.contAt(scope, y) : pool.natAt(scope, y);
    v = den > 0 ? num / den : 0;
    rhoYear.set(k, v);
  }
  return v;
}
/* f_L 按「日历年份」缓存：mid() 内部 floor，f 是年阶梯函数，故按年缓存无损 */
const fYear = new Map();
function fAt(who, level, y) {
  const who2 = NR_F_MODE === 'world' ? who : { cont: who.cont, nat: who.country };
  const k = (who2.cont || '') + '|' + (who2.nat || '') + '|' + level + '|' + y;
  let v = fYear.get(k);
  if (v == null) {
    v = pool.valueOf ? pool.valueOf(level, who2, y) : pool.yearValue(y);
    fYear.set(k, v);
  }
  return v;
}
const yOfDay = (d) => new Date(d * 86400000).getUTCFullYear();
/**
 * ⟨f_L · ρ_s⟩：持有区间上「时代折算 × 竞争密度」的乘积均值。
 *
 * 为什么这样算：f 与 ρ 都是**按日历年分段的常数**（m1.js 的 mid() 内部 floor），
 * 所以区间积分 = Σ_y 天数_y × f_y × ρ_y —— 精确，不是采样近似。
 * 同一切片同时用于「段合计」与「facts 年度行」，拆分恒等在浮点级闭合。
 */
function frAvg(who, level, scope, t0, t1) {
  const end = t1 == null ? RN.SNAPSHOT_DAY : t1;
  if (!(end > t0)) { const y = yOfDay(t0); return fAt(who, level, y) * rhoAt(level, scope, y); }
  let s = 0;
  for (const p of frYears(who, level, scope, t0, end)) s += p.days * p.fr;
  return s / (end - t0);
}
/**
 * 把持有区间按日历年切片，给出每年的天数与 f·ρ。
 * @returns {Array<{y:number, days:number, fr:number}>}
 */
const yStartCache = new Map();
function yStart(y) {
  let v = yStartCache.get(y);
  if (v == null) { v = RN.dayOf(y + '-01-01'); yStartCache.set(y, v); }
  return v;
}
function frYears(who, level, scope, t0, end) {
  const out = [];
  const yA = yOfDay(t0), yB = yOfDay(end);
  for (let y = yA; y <= yB; y++) {
    const s0 = Math.max(t0, yStart(y));
    const s1 = Math.min(end, yStart(y + 1));
    const days = s1 - s0;
    if (days <= 0) continue;
    out.push({ y, days, fr: fAt(who, level, y) * rhoAt(level, scope, y) });
  }
  return out;
}

/* ── 导出日 ── */
let EXPORT = 0;
for (const p of P) for (const x of p.records || []) {
  const e = RN.dayOf(x.date) + (x.held || 0);
  if (e > EXPORT) EXPORT = e;
}

/* ── 1. 分桶 ── */
const buckets = {};
let totalRec = 0;
for (const p of P) {
  const cont = CL.contOfIso(p.country) || '??';
  for (const x of p.records || []) {
    if (!x.date || !x.ev || !x.type || !x.level) continue;
    totalRec++;
    const scope = x.level === 'WR' ? 'WW' : (x.level === 'CR' ? cont : p.country);
    const k = x.ev + '|' + x.type + '|' + x.level + '|' + scope;
    (buckets[k] = buckets[k] || { ev: x.ev, type: x.type, level: x.level, scope, subs: [] })
      .subs.push({ pid: p.id, name: p.name, day: RN.dayOf(x.date), date: x.date, value: x.value, held: x.held || 0 });
  }
}

/* ── 2. 建阶梯 ── */
const LAD = {};
for (const k of Object.keys(buckets)) {
  const b = buckets[k];
  const lad = RN.buildLadder(b.subs, { ev: b.ev, type: b.type },
    { mode: 'level', endFromHeld: true, exportDay: EXPORT });
  LAD[k] = { ev: b.ev, type: b.type, level: b.level, scope: b.scope, runs: lad.runs };
}

/* ── 3. 打分（r ≡ 1，无 G_ref） ── */
const byWho = new Map();
const whoOf = new Map();
for (const p of P) {
  if (!(p.records || []).length) continue;
  whoOf.set(p.id, { id: p.id, name: p.name, country: p.country, cont: CL.contOfIso(p.country) || '??' });
  byWho.set(p.id, { total: 0, n: 0, wr: 0, cr: 0, nr: 0, rows: [], fsum: 0, ysum: 0 });
}
let nFirst = 0, sFirst = 0;   // 首段统计（M1-F1 边界消失的量化）
let segMismatch = 0;          // 年度分解恒等校验计数
const facts1 = [];            // sixdim 事实表：年度分解
const Y0 = (d) => new Date(d * 86400000).getUTCFullYear();
for (const k of Object.keys(LAD)) {
  const b = LAD[k];
  const w = RN.EV_WEIGHT_V2[b.ev] == null ? 1 : RN.EV_WEIGHT_V2[b.ev];
  const gL = M1.G[b.level] == null ? 1 : M1.G[b.level];
  for (const r of b.runs) {
    const who = whoOf.get(r.pid);
    const acc = byWho.get(r.pid);
    if (!who || !acc) continue;
    const c = RN.runCredit(r, { capDays: RN.CAP_DAYS_V2, snapshotDay: RN.SNAPSHOT_DAY });
    const years = c.years;                       // ★ r ≡ 1：credit = years
    const t1d = r.tEnd == null ? RN.SNAPSHOT_DAY : r.tEnd;
    /* ★ 方案 B：把区间按年切片，f 与 ρ 都是年阶梯常数 → 切片即精确积分。
     *   同一切片同时用于「段合计」与「facts 年度行」，因此拆分恒等在浮点级闭合。 */
    const parts = frYears(who, b.level, b.scope, r.tStart, t1d);
    /* 30 年封顶：若段长超过 cap，按比例缩放切片天数，使 Σdays/365 ≡ years */
    const rawDays = parts.reduce((s, p) => s + p.days, 0);
    const scale = rawDays > 0 && years * 365 < rawDays ? (years * 365) / rawDays : 1;
    let score = 0, fw = 0, fsum = 0, frsum = 0;
    for (const p of parts) {
      const frac = (p.days * scale) / 365;
      score += frac * gL * p.fr * w;
      fw += frac;
      frsum += frac * p.fr;
    }
    const fr = fw > 0 ? frsum / fw : 0;           // ⟨f·ρ⟩：段内加权均值（进 score）
    /* 纯 f 的段内均值（不含 ρ），仅用于报表/诊断展示；ρ̄ 由 fr/̄f 反解 */
    let fp = 0;
    for (const p of parts) { const frac = (p.days * scale) / 365; fp += frac * fAt(who, b.level, p.y); }
    const f = fw > 0 ? fp / fw : 0;
    const rhoBar = f > 0 ? fr / f : 0;
    acc.total += score;
    acc.fsum += fr;
    acc.ysum += years;
    acc.n++;
    acc[b.level.toLowerCase()]++;
    if (r.gain === 0) { nFirst++; sFirst += score; }
    acc.rows.push({ ev: b.ev, type: b.type, level: b.level, days: c.days, credit: years, f, fr, rho: rhoBar, w, gL, score, t0: r.tStart, t1: r.tEnd, vOut: r.vOut.value });
    /* ── 年度分解（sixdim as-of 用）：与上面同一切片、同一乘子 → 恒等可拆 ── */
    for (const p of parts) {
      const frac = (p.days * scale) / 365;
      facts1.push({ pid: r.pid, ev: b.ev, type: b.type, level: b.level, scope: b.scope, y: p.y, frac, score: frac * gL * p.fr * w });
    }
    if (Math.abs(fw - years) > 1e-9) segMismatch++;
  }
}

/* ── 4. 排行 ── */
/* ── 3.5 事实表导出（sixdim 查询引擎用）：as-of 截取 = Σ_{y ≤ asOf} ── */
fs.writeFileSync(path.join(__dirname, 'M1_facts.tsv'),
  'pid\tev\ttype\tlevel\tscope\tyear\tfrac\tscore\n' +
  facts1.map((x) => [x.pid, x.ev, x.type, x.level, x.scope, x.y, x.frac.toFixed(6), x.score.toFixed(6)].join('\t')).join('\n') + '\n', 'utf8');
console.log('已写 M1_facts.tsv（', facts1.length, '行）| 年度分解失配段数', segMismatch);
const LIST = [];
for (const [pid, a] of byWho) LIST.push({ ...whoOf.get(pid), ...a });
LIST.sort((x, y) => y.total - x.total);
const rankOf = (pid) => LIST.findIndex((x) => x.id === pid) + 1;

/* ── 5. 导出全量 TSV ── */
fs.writeFileSync(path.join(__dirname, 'M1_hold_full.tsv'),
  'pid\tname\tm1_hold\tn_segs\n' +
  LIST.map((x) => `${x.id}\t${x.name.replace(/\t/g, ' ')}\t${F(x.total)}\t${x.n}`).join('\n') + '\n', 'utf8');

/* ── 6. 报告 ── */
const TARGETS = ['2009ZEMD01', '2012PARK03'];
const EVZ = { '333': '三阶', '222': '二阶', '444': '四阶', '333oh': '三阶单手', pyram: '金字塔', '555': '五阶', skewb: '斜转', minx: '五魔', sq1: 'SQ1', clock: '魔表', '333bf': '三阶盲拧', '666': '六阶', '777': '七阶', '333fm': '最少步', '444bf': '四阶盲拧', '333mbf': '多盲', '333ft': '脚拧', '555bf': '五阶盲拧', magic: '八板', mmagic: '十二板', '333mbo': '旧多盲' };
const L = [];
L.push('# M1-F2 · 纪录持有价值（纯持有版）');
L.push('');
L.push('> 由 `etl/score/m1_hold.js` 生成。r 分量（领先幅度）已剥离 → M6-F2，');
L.push('> 本维只回答一件事：**你的纪录守了多久、守得多稳**。');
L.push('');
L.push('## 口径');
L.push('');
L.push('```');
L.push('M1 = Σ_段 [ min(T,30年)/365 × V_L × w_e × ⟨f_L·ρ_s⟩ ]    ← r ≡ 1');
L.push('  T   = 持有天数（被打破即止，未破按快照日）');
L.push('  V_L = WR 1.0 / CR 0.4 / NR 0.15');
L.push('  ρ_s = 竞争密度：WR ≡ 1；CR/NR = 属地当年累计 ÷ 全球当年累计（方案 B，按年）');
L.push('  f_L = 时代折算：ln(1+属地当年累计) / ln(1+属地基准年累计)');
L.push('  ⟨·⟩ = 持有区间上的乘积均值（按月中点采样）');
L.push('  w_e = EV_WEIGHT_V2');
L.push('```');
L.push('');
L.push(`> ρ 口径：**${RHO_MODE === 'time' ? 'B · 按年（生产）' : 'A · 当期快照（对比用）'}**｜` +
  `NR 时代池：**${NR_F_MODE === 'country' ? '国家池（已修）' : '全球池（旧 bug）'}**`);
L.push('');
L.push(`数据：${num(R.total)} 选手｜有分 ${num(LIST.length)} 人｜records ${num(totalRec)} 条｜阶梯 ${num(Object.keys(LAD).length)}｜段 ${num([...Object.values(LAD)].reduce((a, b) => a + b.runs.length, 0))}`);
L.push('');
L.push(`★ M1-F1 的「首段 r=0 不计分」边界已消失：${num(nFirst)} 个首段共得分 ${F(sFirst)}（Minh Thai 守 7,749 天正常计分）。`);
L.push('');
L.push('## 总分排行（前 30）');
L.push('');
L.push('| # | 选手 | 国家 | WR | CR | NR | 段数 | 平均 f×ρ | M1-F2 |');
L.push('|---|---|---|---|---|---|---|---|---|');
for (let i = 0; i < Math.min(30, LIST.length); i++) {
  const x = LIST[i];
  L.push(`| ${i + 1} | ${x.name} | ${x.country} | ${x.wr} | ${x.cr} | ${x.nr} | ${x.n} | ${F(x.fsum / x.n)} | **${F(x.total)}** |`);
}
L.push('');
for (const tid of TARGETS) {
  const x = LIST.find((y) => y.id === tid);
  if (!x) continue;
  L.push(`## ${x.name}`);
  L.push('');
  L.push(`**M1-F2 = ${F(x.total)}　全站第 ${rankOf(tid)} 名 / ${num(LIST.length)}**　（WR ${x.wr} / CR ${x.cr} / NR ${x.nr}，${x.n} 段）`);
  L.push('');
  L.push('| 项目 | 轨道 | 得分 | 占比 |');
  L.push('|---|---|---|---|');
  const per = Object.keys(x.per || {}).length ? null : null;
  const byPk = {};
  for (const r of x.rows) {
    const pk = r.ev + '|' + r.type;
    byPk[pk] = (byPk[pk] || 0) + r.score;
  }
  for (const pk of Object.keys(byPk).sort((a, b2) => byPk[b2] - byPk[a])) {
    const [ev, type] = pk.split('|');
    L.push(`| ${EVZ[ev] || ev} | ${type === 'avg' ? '平均' : '单次'} | ${F(byPk[pk])} | ${(byPk[pk] / x.total * 100).toFixed(2)}% |`);
  }
  L.push(`| **合计** | | **${F(x.total)}** | 100.00% |`);
  L.push('');
}
L.push('## 与 M1-F1 的关系');
L.push('');
L.push('- M1-F1 = (领先幅度 r) × (持有年数) × 其它乘数；M1-F2 去掉 r，M6-F2 接管 r。');
L.push('- 两维理论上正交（「打得狠」vs「守得稳」），实测见 M6-F2 封存文件的正交性矩阵。');
L.push('- M1-F1 的基线数字（Max 83.7131 / Feliks 71.2782）因站点 data.js 重建已漂移，');
L.push('  且口径已被 M1-F2 取代 —— M1-F1 数字仅作历史存档，不再作为回归基准。');
L.push('');
fs.writeFileSync(path.join(__dirname, '纪录分_纯持有.md'), L.join('\n') + '\n', 'utf8');

console.log('records', totalRec, '| 阶梯', Object.keys(LAD).length, '| 段', [...Object.values(LAD)].reduce((a, b) => a + b.runs.length, 0), '| 有分人数', LIST.length);
console.log('首段', nFirst, '个 共得分', F(sFirst));
for (const t of TARGETS) {
  const x = LIST.find((y) => y.id === t);
  if (x) console.log(x.name, F(x.total), 'rank', rankOf(t), '| WR', x.wr, 'CR', x.cr, 'NR', x.nr, '| 段', x.n);
}
console.log('top5:', LIST.slice(0, 5).map((x) => `${x.name} ${F(x.total)}`).join(' | '));
console.log('写出 纪录分_纯持有.md / M1_hold_full.tsv');

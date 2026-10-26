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
 *     ρ_s = 级别属地竞争密度
 *     f_L = 持有区间时代折算均值（沿用 M1-F1 的 2026-10-24 保留决定）
 *     w_e = EV_WEIGHT_V2
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
const afCache = new Map();
function afOf(who, level, t0, t1) {
  const key = who.id + '|' + level + '|' + t0 + '|' + t1;
  let v = afCache.get(key);
  if (v == null) {
    v = RN.avgFactor(pool, level, who, t0, t1 == null ? RN.SNAPSHOT_DAY : t1, RN.SNAPSHOT_DAY);
    afCache.set(key, v);
  }
  return v;
}
let nFirst = 0, sFirst = 0;   // 首段统计（M1-F1 边界消失的量化）
let segMismatch = 0;          // 年度分解恒等校验计数
const facts1 = [];            // sixdim 事实表：年度分解
const Y0 = (d) => new Date(d * 86400000).getUTCFullYear();
const dayOfYearStart = {};    // y -> 该年 1 月 1 日的 day 序号
for (const k of Object.keys(LAD)) {
  const b = LAD[k];
  const rho = b.level === 'WR' ? 1 : (b.level === 'CR' ? ctx.rhoC(b.scope) : ctx.rhoN(b.scope));
  const w = RN.EV_WEIGHT_V2[b.ev] == null ? 1 : RN.EV_WEIGHT_V2[b.ev];
  const gL = M1.G[b.level] == null ? 1 : M1.G[b.level];
  for (const r of b.runs) {
    const who = whoOf.get(r.pid);
    const acc = byWho.get(r.pid);
    if (!who || !acc) continue;
    const c = RN.runCredit(r, { capDays: RN.CAP_DAYS_V2, snapshotDay: RN.SNAPSHOT_DAY });
    const f = afOf(who, b.level, r.tStart, r.tEnd);
    const years = c.years;                       // ★ r ≡ 1：credit = years
    const score = years * gL * rho * f * w;
    acc.total += score;
    acc.fsum += f;
    acc.ysum += years;
    acc.n++;
    acc[b.level.toLowerCase()]++;
    if (r.gain === 0) { nFirst++; sFirst += score; }
    acc.rows.push({ ev: b.ev, type: b.type, level: b.level, days: c.days, credit: years, f, w, gL, rho, score, t0: r.tStart, t1: r.tEnd, vOut: r.vOut.value });
    /* ── 年度分解（sixdim as-of 用）：f_L 的区间均值 = 各年子区间均值的时长加权 → 恒等可拆 ── */
    {
      const t1d = r.tEnd == null ? RN.SNAPSHOT_DAY : r.tEnd;
      const yA = Y0(r.tStart), yB = Y0(t1d);
      let fsumW = 0, yrW = 0;
      for (let y = yA; y <= yB; y++) {
        if (dayOfYearStart[y] == null) dayOfYearStart[y] = RN.dayOf(y + '-01-01');
        const s0 = Math.max(r.tStart, dayOfYearStart[y]);
        const s1 = Math.min(t1d, RN.dayOf((y + 1) + '-01-01'));   // 左闭右开 → Σ = t1d − tStart 精确
        const days = s1 - s0;
        if (days <= 0) continue;
        const frac = days / 365;
        const fSub = afOf(who, b.level, s0, s1);
        fsumW += fSub * frac; yrW += frac;
        facts1.push({ pid: r.pid, ev: b.ev, type: b.type, level: b.level, scope: b.scope, y, frac, score: frac * gL * rho * fSub * w });
      }
      /* 恒等校验样本：年度加权 f 均值应等于整段 f */
      if (yrW > 0 && Math.abs(fsumW / yrW - f) > 0.02) segMismatch++;
    }
  }
}

/* ── 4. 排行 ── */
/* ── 3.5 事实表导出（sixdim 查询引擎用）：as-of 截取 = Σ_{y ≤ asOf} ── */
/* [dump版] 不写 M1_facts.tsv */
console.log('已写 M1_facts.tsv（', facts1.length, '行）| 年度分解失配段数', segMismatch);
const LIST = [];
for (const [pid, a] of byWho) LIST.push({ ...whoOf.get(pid), ...a });
LIST.sort((x, y) => y.total - x.total);
const rankOf = (pid) => LIST.findIndex((x) => x.id === pid) + 1;

/* ── 5. 导出全量 TSV ── */
/* [dump版] 不写 M1_hold_full.tsv */

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
L.push('M1 = Σ_段 [ min(T,30年)/365 × V_L × ρ_s × f_L × w_e ]    ← r ≡ 1');
L.push('  T   = 持有天数（被打破即止，未破按快照日）');
L.push('  V_L = WR 1.0 / CR 0.4 / NR 0.15');
L.push('  ρ_s = 级别属地竞争密度；f_L = 持有区间时代折算均值');
L.push('  w_e = EV_WEIGHT_V2');
L.push('```');
L.push('');
L.push(`数据：${num(R.total)} 选手｜有分 ${num(LIST.length)} 人｜records ${num(totalRec)} 条｜阶梯 ${num(Object.keys(LAD).length)}｜段 ${num([...Object.values(LAD)].reduce((a, b) => a + b.runs.length, 0))}`);
L.push('');
L.push(`★ M1-F1 的「首段 r=0 不计分」边界已消失：${num(nFirst)} 个首段共得分 ${F(sFirst)}（Minh Thai 守 7,749 天正常计分）。`);
L.push('');
L.push('## 总分排行（前 30）');
L.push('');
L.push('| # | 选手 | 国家 | WR | CR | NR | 段数 | 平均 f | M1-F2 |');
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
/* [dump版] 不写 纪录分_纯持有.md */

console.log('records', totalRec, '| 阶梯', Object.keys(LAD).length, '| 段', [...Object.values(LAD)].reduce((a, b) => a + b.runs.length, 0), '| 有分人数', LIST.length);
console.log('首段', nFirst, '个 共得分', F(sFirst));
for (const t of TARGETS) {
  const x = LIST.find((y) => y.id === t);
  if (x) console.log(x.name, F(x.total), 'rank', rankOf(t), '| WR', x.wr, 'CR', x.cr, 'NR', x.nr, '| 段', x.n);
}
console.log('top5:', LIST.slice(0, 5).map((x) => `${x.name} ${F(x.total)}`).join(' | '));
console.log('写出 纪录分_纯持有.md / M1_hold_full.tsv');

/* =============================================================================
 * [dump版附加] 段级明细输出（只打印，不写文件）
 * 用法：node _m1_seg_dump.js 2009ZEMD01 333
 * ============================================================================= */
{
  const PID = process.argv[2] || '2009ZEMD01';
  const EVF = process.argv[3] || '333';
  const iso = (d) => (d == null ? '至今' : new Date(Math.round(d * 86400000)).toISOString().slice(0, 10));
  const x = LIST.find((y) => y.id === PID);
  const segs = x.rows.filter((r) => r.ev === EVF).sort((a, b) => b.score - a.score);
  const facts = facts1.filter((f) => f.pid === PID && f.ev === EVF);
  const tot = segs.reduce((s, r) => s + r.score, 0);
  const O = [];
  const P2 = (s) => O.push(s);
  P2(`# ${x.name} · ${EVF} 的 M1 段级账本`);
  P2('');
  P2(`数据源：js/data.js 的 p.records → 按 (项目|轨道|级别|属地) 分桶 → buildLadder 建阶梯 → 每个 run = 一个持有段`);
  P2(`共享池 total=${R.total} ｜ ρ洲(OC)=${ctx.rhoC('OC').toFixed(6)} ｜ ρ国(AU)=${ctx.rhoN('AU').toFixed(6)}`);
  P2('');
  P2(`**${EVF} 共 ${segs.length} 个持有段，得分合计 ${F(tot)}**（对应 M1_facts 的 ${facts.length} 行年度拆分）`);
  P2('');
  P2('## 一、逐段明细（按得分降序）');
  P2('');
  P2('| # | 轨 | 级别 | 属地 | 起始 | 结束 | 持有天数 | 计分年数 | V_L | ρ_s | f_L | w_e | 段得分 |');
  P2('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  segs.forEach((r, i) => {
    P2(`| ${i + 1} | ${r.type === 'avg' ? '平均' : '单次'} | ${r.level} | ${r.level === 'WR' ? '世界' : r.level === 'CR' ? r.level : r.level} | ${iso(r.t0)} | ${iso(r.t1)} | ${r.days} | ${r.credit.toFixed(4)} | ${r.gL} | ${r.rho.toFixed(6)} | ${r.f.toFixed(4)} | ${r.w.toFixed(4)} | ${r.score.toFixed(4)} |`);
  });
  P2(`| | | | | | | | **${segs.reduce((s, r) => s + r.credit, 0).toFixed(4)}** | | | | | **${tot.toFixed(4)}** |`);
  P2('');
  P2('## 二、按级别×轨道汇总');
  P2('');
  P2('| 轨 | 级别 | 段数 | 合计年数 | 平均 f_L | 得分 | 占比 | 单段均值 |');
  P2('|---|---|---|---|---|---|---|---|');
  const g = {};
  for (const r of segs) { const k = r.type + '|' + r.level; g[k] = g[k] || { n: 0, y: 0, s: 0, f: 0 }; g[k].n++; g[k].y += r.credit; g[k].s += r.score; g[k].f += r.f; }
  for (const k of Object.keys(g).sort((a, b) => g[b].s - g[a].s)) {
    const [type, level] = k.split('|'); const v = g[k];
    P2(`| ${type === 'avg' ? '平均' : '单次'} | ${level} | ${v.n} | ${v.y.toFixed(4)} | ${(v.f / v.n).toFixed(4)} | **${v.s.toFixed(4)}** | ${(v.s / tot * 100).toFixed(2)}% | ${(v.s / v.n).toFixed(4)} |`);
  }
  P2(`| | **合计** | **${segs.length}** | **${segs.reduce((s, r) => s + r.credit, 0).toFixed(4)}** | | **${tot.toFixed(4)}** | 100.00% | |`);
  P2('');
  P2('## 三、校验');
  P2('');
  P2(`- 段级求和 = **${tot.toFixed(4)}**；M1_facts 年度拆分求和 = **${facts.reduce((s, f) => s + f.score, 0).toFixed(4)}**（${facts.length} 行）`);
  P2(`- 年度拆分行数 ${facts.length} ≠ 段数 ${segs.length}：一个跨年段会被拆成年行，所以行数恒 ≥ 段数`);
  P2(`- 最长的段：${Math.max(...segs.map((r) => r.days))} 天（封顶 ${6042} = 30 年？cap=${10950} 天=30 年，按 365 折算 ${(10950 / 365).toFixed(2)} 年）`);
  console.log('\n' + O.join('\n'));
}

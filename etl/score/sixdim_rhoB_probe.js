'use strict';
/* =============================================================================
 * 方案 B 影响评估（只读）· ρ 由「静态快照比」改为「按年竞争密度」
 * -----------------------------------------------------------------------------
 * 现行（A）: ρ_s = 属地全量人数 ÷ 全站总人数            ← 一个数，取 2026 快照
 * 方案 B   : ρ_s(t) = 属地当年累计人数 ÷ 全球当年累计人数  ← 时间函数，参与积分
 *
 * 本脚本不写任何文件，只打印曲线与量级，用于拍板前核对。
 * 运行：node --max-old-space-size=8192 sixdim_rhoB_probe.js
 * ============================================================================= */
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
global.window = {};
require(path.join(ROOT, 'js/data.js'));
require(path.join(ROOT, 'js/roster.js'));
const CL = require(path.join(ROOT, 'js/calc.js'));
const M1 = require(path.join(ROOT, 'etl/score/m1.js'));
const RN = require(path.join(ROOT, 'etl/score/runs.js'));

const P = global.window.MOCK.players;
const R = global.window.WCA_ROSTER;

/* ── 复刻 m1_hold.js 的池子构造（含 roster 尾部 + 明细，两者不相交）── */
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

const f4 = (v) => v.toFixed(4);
const f6 = (v) => v.toFixed(6);
const out = [];
const L = (s) => out.push(s);

L('# 方案 B 影响评估 · ρ 时间化');
L('');
L(`全站 R.total = ${R.total}｜池内有效（有 start 年）= ${people.length}｜` +
  `池末累计 = ${Math.round(pool.globalAt(pool.baseYear))}（基准年 ${pool.baseYear}）`);
L('');
L('> 静态 A 的口径 = 该洲人数 ÷ R.total；动态 B 的口径 = 该洲当年累计 ÷ 全球当年累计。');
L('> 两者在基准年应接近但不必相等（分母来源不同：R.total 含无 start 年者）。');
L('');

/* ── 一、ρ 曲线 ── */
const scopes = [
  { k: 'Oc', label: '大洋洲', level: 'CR' },
  { k: 'NAm', label: '北美洲', level: 'CR' },
  { k: 'Eu', label: '欧洲', level: 'CR' },
  { k: 'As', label: '亚洲', level: 'CR' },
  { k: 'SAm', label: '南美洲', level: 'CR' },
  { k: 'Af', label: '非洲', level: 'CR' },
  { k: 'AU', label: '澳大利亚', level: 'NR' },
  { k: 'US', label: '美国', level: 'NR' },
  { k: 'CN', label: '中国', level: 'NR' },
];
L('## 一、ρ 随年份的变化（每 2 年取样）');
L('');
const yrs = [];
for (let y = 2003; y <= pool.baseYear; y += 2) yrs.push(y);
yrs.push(pool.baseYear);
L('| 口径 | 静态 A（2026 快照） | ' + yrs.map((y) => y).join(' | ') + ' |');
L('|---|---|' + yrs.map(() => '---').join('|') + '|');
for (const s of scopes) {
  const stat = s.level === 'CR' ? ctx.rhoC(s.k) : ctx.rhoN(s.k);
  const cells = yrs.map((y) => {
    const num = s.level === 'CR' ? pool.contAt(s.k, y) : pool.natAt(s.k, y);
    const den = pool.globalAt(y);
    return den > 0 ? f4(num / den) : '-';
  });
  L(`| ${s.label} ${s.level} | ${f6(stat)} | ${cells.join(' | ')} |`);
}
L('');

/* ── 二、区间均值对比（对真实持有段）── */
L('## 二、真实持有段上的区间均值（按段长加权）');
L('');
L('对每条 CR/NR 段计算：`ρ̄ = 段内按月中点采样均值`，与静态 A 相除得倍数。');
L('');

/* 复刻分桶 + 阶梯（只读） */
let EXPORT = 0;
for (const p of P) for (const x of p.records || []) {
  const e = RN.dayOf(x.date) + (x.held || 0);
  if (e > EXPORT) EXPORT = e;
}
const buckets = {};
for (const p of P) {
  const cont = CL.contOfIso(p.country) || '??';
  for (const x of p.records || []) {
    if (!x.date || !x.ev || !x.type || !x.level) continue;
    const scope = x.level === 'WR' ? 'WW' : (x.level === 'CR' ? cont : p.country);
    const k = x.ev + '|' + x.type + '|' + x.level + '|' + scope;
    (buckets[k] = buckets[k] || { ev: x.ev, type: x.type, level: x.level, scope, cont, subs: [] })
      .subs.push({ pid: p.id, name: p.name, day: RN.dayOf(x.date), date: x.date, value: x.value, held: x.held || 0 });
  }
}
const LAD = {};
for (const k of Object.keys(buckets)) {
  const b = buckets[k];
  LAD[k] = { ...b, runs: RN.buildLadder(b.subs, { ev: b.ev, type: b.type }, { mode: 'level', endFromHeld: true, exportDay: EXPORT }).runs };
}

/** 时间化 ρ 的区间均值（月中点采样，与 RN.avgFactor 同粒度） */
function rhoAvgB(level, scope, cont, t0, t1) {
  const end = t1 == null ? RN.SNAPSHOT_DAY : t1;
  if (!(end > t0)) return 0;
  if (level === 'WR') return 1;
  const n = Math.max(1, Math.min(120, Math.round((end - t0) / 30.44)));
  let s = 0;
  for (let i = 0; i < n; i++) {
    const d = t0 + ((end - t0) * (i + 0.5)) / n;
    const y = new Date(d * 86400000).getUTCFullYear();
    const num = level === 'CR' ? pool.contAt(scope, y) : pool.natAt(scope, y);
    const den = pool.globalAt(y);
    s += den > 0 ? num / den : 0;
  }
  return s / n;
}

const rows = [];
for (const k of Object.keys(LAD)) {
  const b = LAD[k];
  if (b.level === 'WR') continue;
  const w = RN.EV_WEIGHT_V2[b.ev] == null ? 1 : RN.EV_WEIGHT_V2[b.ev];
  const gL = M1.G[b.level];
  for (const r of b.runs) {
    const c = RN.runCredit(r, { capDays: RN.CAP_DAYS_V2, snapshotDay: RN.SNAPSHOT_DAY });
    const rA = b.level === 'CR' ? ctx.rhoC(b.scope) : ctx.rhoN(b.scope);
    const rB = rhoAvgB(b.level, b.scope, b.cont, r.tStart, r.tEnd);
    rows.push({ level: b.level, scope: b.scope, ev: b.ev, years: c.years, rA, rB, gL, w, r: rB / (rA || 1) });
  }
}
const agg = {};
for (const x of rows) {
  const key = x.level + '|' + x.scope;
  const a = agg[key] = agg[key] || { n: 0, y: 0, sA: 0, sB: 0, wsum: 0 };
  a.n++; a.y += x.years;
  a.sA += x.years * x.gL * x.rA * x.w;
  a.sB += x.years * x.gL * x.rB * x.w;
}
L('| 级别 | 属地 | 段数 | 合计年数 | 静态A贡献 | 动态B贡献 | B/A |');
L('|---|---|---|---|---|---|---|');
let TA = 0, TB = 0;
for (const key of Object.keys(agg).sort((a, b) => agg[b].sA - agg[a].sA)) {
  const v = agg[key];
  const [lv, sc] = key.split('|');
  TA += v.sA; TB += v.sB;
  L(`| ${lv} | ${sc} | ${v.n} | ${f4(v.y)} | ${f4(v.sA)} | ${f4(v.sB)} | ${(v.sB / (v.sA || 1)).toFixed(3)} |`);
}
L(`| **合计** | | **${rows.length}** | **${f4(rows.reduce((s, x) => s + x.years, 0))}** | **${f4(TA)}** | **${f4(TB)}** | **${(TB / (TA || 1)).toFixed(3)}** |`);
L('');
L(`> CR/NR 部分总分：A ${f4(TA)} → B ${f4(TB)}（${TA ? ((TB / TA - 1) * 100).toFixed(1) : '0'}%）；WR 部分不受影响（ρ≡1）。`);
L('');

/* ── 三、按项目看最大变化 ── */
L('## 三、按项目看 CR/NR 分项变化（静态A → 动态B）');
L('');
const evAgg = {};
for (const x of rows) {
  const a = evAgg[x.ev] = evAgg[x.ev] || { sA: 0, sB: 0 };
  a.sA += x.years * x.gL * x.rA * x.w;
  a.sB += x.years * x.gL * x.rB * x.w;
}
L('| 项目 | 静态A | 动态B | 差 | 比例 |');
L('|---|---|---|---|---|');
for (const ev of Object.keys(evAgg).sort((a, b) => Math.abs(evAgg[b].sB - evAgg[b].sA) - Math.abs(evAgg[a].sB - evAgg[a].sA))) {
  const v = evAgg[ev];
  L(`| ${ev} | ${f4(v.sA)} | ${f4(v.sB)} | ${(v.sB - v.sA >= 0 ? '+' : '') + f4(v.sB - v.sA)} | ${(v.sB / (v.sA || 1)).toFixed(3)} |`);
}
L('');
L('## 四、稳定性说明');
L('');
L('- B 的分子分母都取自「同一年」的累计池 → 无基准年归一，天然尺度无关；');
L('- 每周新增数据只会改动「首次参赛年 ≤ 该年」的累计数，历史年份的 ρ 变动极小（新增多为近年）；');
L('- 而 A 的分母 R.total 每期都变，会让**所有历史 CR/NR 分数**整体等比漂移，这正是本次要消除的。');

console.log(out.join('\n'));

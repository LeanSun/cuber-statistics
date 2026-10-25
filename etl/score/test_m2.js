'use strict';
/* M2-F3 模型断言：纯函数 + 全量结果双重校验
 *
 * 用法：node etl/score/test_m2.js
 * 依赖：etl/score/m2_result.json（由 m2_build.js 生成）
 * 要求：全部通过，任何一条失败即视为口径被改坏。
 *
 * F3 口径要点：入口 = 官方名次 1–3 且 best > 0；不拆单次 / 平均；多区赛归 M3。
 */
const fs = require('fs');
const path = require('path');
const M1 = require('./m1.js');
const RN = require('./runs.js');
const M2 = require('./m2.js');

const DEC = 4;
const R4 = (v) => Math.round(Number(v) * 10 ** DEC) / 10 ** DEC;
let pass = 0;
let fail = 0;
const eq = (name, got, want, tol) => {
  const gn = Number(got);
  const wn = Number(want);
  const numeric = Number.isFinite(gn) && Number.isFinite(wn)
    && typeof got !== 'boolean' && typeof want !== 'boolean';
  const okv = numeric
    ? Math.abs(gn - wn) <= (tol == null ? 1e-9 : tol)
    : String(got) === String(want);
  if (okv) { pass++; console.log(`  ✓ ${name}`); } else {
    fail++; console.log(`  ✗ ${name}  got ${got}  want ${want}`);
  }
};
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); } else {
    fail++; console.log(`  ✗ ${name}${detail ? '  ' + detail : ''}`);
  }
};

console.log('\n[M1] 赛级价格必须与 M1 的级别价值逐位相同');
eq('T_WC = M1.G.WR', M2.TIER_BASE.WC, M1.G.WR);
eq('T_CC = M1.G.CR', M2.TIER_BASE.CC, M1.G.CR);
eq('T_NC = M1.G.NR', M2.TIER_BASE.NC, M1.G.NR);
eq('三级量程 = 1/0.15', M2.TIER_BASE.WC / M2.TIER_BASE.NC, 1 / 0.15, 1e-12);

console.log('\n[M2] 赛级分类');
{
  const S = (...a) => new Set(a);
  eq('world → WC', M2.tierOf(S('world'), 'US'), 'WC');
  eq('_Europe → CC', M2.tierOf(S('_Europe'), 'DE'), 'CC');
  eq('_South America → CC', M2.tierOf(S('_South America'), 'BR'), 'CC');
  eq('greater_china → CC', M2.tierOf(S('greater_china'), 'CN'), 'CC');
  eq('HU + 举办国 HU → NC', M2.tierOf(S('HU'), 'HU'), 'NC');
  eq('world 与国别并存 → WC 优先', M2.tierOf(S('world', 'US'), 'US'), 'WC');
  eq('洲与国别并存 → CC 优先', M2.tierOf(S('_Asia', 'CN'), 'CN'), 'CC');
  eq('未知类型 → NC（不退回 CC）', M2.tierOf(S('XX'), 'US'), 'NC');
  eq('空集 → OP（非冠军赛）', M2.tierOf(new Set(), 'US'), 'OP');
}

console.log('\n[M2b] 多区赛识别（X 前缀伪代码）');
ok('XE 是多区赛', M2.isMultiRegion('XE'));
ok('XA 是多区赛', M2.isMultiRegion('XA'));
ok('XW / XO / XS / XF 都是', ['XW', 'XO', 'XS', 'XF'].every(M2.isMultiRegion));
ok('小写也认', M2.isMultiRegion('xe'));
ok('普通国家代码不是', ['US', 'CN', 'NZ', 'FI', 'ES'].every((c) => !M2.isMultiRegion(c)));
ok('空值 / 三字符不是', !M2.isMultiRegion('') && !M2.isMultiRegion('USA'));

console.log('\n[M3] 名次折价');
eq('冠军 1.0000', M2.PLACE_W[1], 1);
eq('亚军 0.6000', M2.PLACE_W[2], 0.6);
eq('季军 0.4000', M2.PLACE_W[3], 0.4);
ok('名次序严格递减', M2.PLACE_W[1] > M2.PLACE_W[2] && M2.PLACE_W[2] > M2.PLACE_W[3]);
eq('入口只到第 3 名', M2.PLACE_MAX, 3);
eq('入口从第 1 名起', M2.PLACE_MIN, 1);

console.log('\n[M4] 属地规模 ρ');
{
  const ctx = M1.makeContext({ contCount: { Europe: 30, Asia: 70 }, natCount: { NZ: 1, US: 50 }, total: 100 });
  eq('世锦赛 ρ ≡ 1', M2.rhoOf('WC', { cont: 'Europe', nat: 'NZ' }, ctx), 1);
  eq('洲锦赛 ρ = 洲占比', M2.rhoOf('CC', { cont: 'Europe' }, ctx), 0.3);
  eq('国锦赛 ρ = 国占比', M2.rhoOf('NC', { nat: 'NZ' }, ctx), 0.01);
  eq("rhoMode='one' 强制 1", M2.rhoOf('NC', { nat: 'NZ' }, ctx, 'one'), 1);
  eq("rhoMode='sqrt' 开根", M2.rhoOf('NC', { nat: 'NZ' }, ctx, 'sqrt'), Math.sqrt(0.01));
  ok('线性 <= sqrt（小属地线性更便宜）',
    M2.rhoOf('NC', { nat: 'NZ' }, ctx, 'linear') < M2.rhoOf('NC', { nat: 'NZ' }, ctx, 'sqrt'));
}

console.log('\n[M5] 时代折算');
{
  const people = [];
  for (let i = 0; i < 100; i++) people.push({ y: 2003 + (i % 20), cont: 'Europe', nat: 'HU' });
  const pool = M1.makeScopePool(people, 2026);
  eq('基准年 f = 1', M2.eraFactor(pool, 'WC', {}, 2026), 1, 1e-9);
  ok('早期 f < 1', M2.eraFactor(pool, 'WC', {}, 2005) < 1);
  ok('f 随年份单调不减', (() => {
    let last = -1;
    for (let y = 2004; y <= 2026; y += 2) {
      const v = M2.eraFactor(pool, 'WC', {}, y);
      if (v < last - 1e-12) return false;
      last = v;
    }
    return true;
  })());
  eq('无池时退化为 1', M2.eraFactor(null, 'WC', {}, 2005), 1);
}

console.log('\n[M6] 决赛人数折价（可选）');
eq('16 人 = 1.0000', M2.fieldFactor(16), 1);
eq('>16 人仍 1.0000', M2.fieldFactor(40), 1);
ok('3 人 < 1', M2.fieldFactor(3) < 1);
ok('人数越多折价越少（单调）', M2.fieldFactor(3) < M2.fieldFactor(8) && M2.fieldFactor(8) < M2.fieldFactor(16));

console.log('\n[M7] 单条得分 = 五个乘数之积');
{
  const ctx = M1.makeContext({ contCount: { Asia: 40 }, natCount: { CN: 20 }, total: 100 });
  const people = [{ y: 2010, cont: 'Asia', nat: 'CN' }];
  const pool = M1.makeScopePool(people, 2026);
  const pod = { pos: 2, tier: 'CC', ev: '555', year: 2010, cont: 'Asia', nat: 'CN', field: 10 };
  const s = M2.scorePodium(pod, { ctx, pool, cfg: { field: true } });
  const want = 0.6 * 0.4 * 0.4 * s.f * RN.EV_WEIGHT_V2['555'] * M2.fieldFactor(10);
  eq('乘数链正确', s.score, want, 1e-12);
  ok('tier/rho/f/w 均被记录，可逐项复核',
    s.tierBase === 0.4 && Math.abs(s.rho - 0.4) < 1e-12 && s.f > 0 && s.w > 0);
  ok('返回值里没有 typeW（F3 已删除成绩维度）', !('typeW' in s));
}

console.log('\n[M8] 同一条领奖台的赛级单调性（WC 必最贵）');
{
  const ctx = M1.makeContext({ contCount: { Europe: 30 }, natCount: { HU: 5 }, total: 100 });
  const people = [{ y: 2020, cont: 'Europe', nat: 'HU' }];
  const pool = M1.makeScopePool(people, 2026);
  const base = { pos: 1, ev: '333', year: 2020, cont: 'Europe', nat: 'HU' };
  const wc = M2.scorePodium({ ...base, tier: 'WC' }, { ctx, pool }).score;
  const cc = M2.scorePodium({ ...base, tier: 'CC' }, { ctx, pool }).score;
  const nc = M2.scorePodium({ ...base, tier: 'NC' }, { ctx, pool }).score;
  ok('WC > CC > NC', wc > cc && cc > nc, `${wc} / ${cc} / ${nc}`);
  ok('国锦赛不为 0（仍可得分）', nc > 0);
}

console.log('\n[M9] podiumOf：只认官方名次 1–3 + 有效成绩');
{
  const rows = [
    { pid: 'A', pos: 1, best: 800, avg: 1000 },
    { pid: 'B', pos: 2, best: 900, avg: 950 },
    { pid: 'C', pos: 3, best: 700, avg: 1100 },
    { pid: 'D', pos: 4, best: 600, avg: 900 },   // 单次更快，但官方第 4
  ];
  const r = M2.podiumOf(rows);
  eq('只取官方前三', r.length, 3);
  eq('名单 = 官方 pos 1/2/3', r.map((x) => x.pid).join(','), 'A,B,C');
  eq('名次沿用官方 pos', r.map((x) => x.place).join(','), '1,2,3');
  ok('单次最快但官方第 4 的人不得分（F3 与 F2 的关键差别）', !r.some((x) => x.pid === 'D'));

  /* 一人一场只可能有一个领奖台 */
  ok('没有 type 字段（不拆维度）', r.every((x) => !('type' in x)));

  /* DNF / DNS：pos 在 1–3 但 best ≤ 0 */
  const dnf = [
    { pid: 'P', pos: 1, best: -1, avg: -1 },
    { pid: 'Q', pos: 2, best: 1000, avg: 0 },
    { pid: 'R', pos: 3, best: 1200, avg: 0 },
  ];
  const d = M2.podiumOf(dnf);
  eq('DNF 被剔除（3 人只留 2）', d.length, 2);
  eq('剔除后 Q 是第 2（名次不重排）', d[0].pid, 'Q');
  eq('保留官方名次 2', d[0].place, 2);

  /* 人数不足 3 的轮次 */
  eq('只有 2 人 → 只有 2 个领奖台', M2.podiumOf([{ pid: 'X', pos: 1, best: 10 }, { pid: 'Y', pos: 2, best: 20 }]).length, 2);
  eq('空轮 → 空', M2.podiumOf([]).length, 0);
  eq('pos = 0（无排名）不得分', M2.podiumOf([{ pid: 'Z', pos: 0, best: 10 }]).length, 0);
}

console.log('\n[M10] 全量结果（m2_result.json）');
const JSON_PATH = path.join(__dirname, 'm2_result.json');
if (!fs.existsSync(JSON_PATH)) {
  fail++; console.log('  ✗ 缺少 m2_result.json，请先跑 m2_build.js');
} else {
  const J = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
  const v0 = J.variants.find((v) => v.id === 'v0');
  const v5 = J.variants.find((v) => v.id === 'v5');
  const v6 = J.variants.find((v) => v.id === 'v6');

  /* 历史口径复现：换了入口口径后仍能对齐诊断报告 */
  eq('v0s 复现总量 16,286.08', J.repro.total, 16286.08, 5e-3);
  eq('v0s 复现 Feliks 127.5800', J.repro.feliks, 127.58, 1e-4);
  eq('v0s 复现 Bence 217.3400', J.repro.bence, 217.34, 1e-4);

  /* 入口口径的减法必须逐项对得上 */
  eq('官方名次全集 34,563', J.podiumStat.official, 34563);
  eq('− 多区赛 30', J.podiumStat.excludedMulti, 30);
  eq('− 无效成绩 1,723', J.podiumStat.excludedDnf, 1723);
  eq('= M2 输入 32,810', J.podiumStat.total, 32810);
  ok('减法自洽：official − multi − dnf = total',
    J.podiumStat.official - J.podiumStat.excludedMulti - J.podiumStat.excludedDnf === J.podiumStat.total);
  const bp = J.podiumStat.byPlace;
  ok('金+银+铜 = 输入总数',
    bp[1] + bp[2] + bp[3] === J.podiumStat.total, `${bp[1]}+${bp[2]}+${bp[3]}`);
  eq('决赛轮 11,309', J.podiumStat.rounds, 11309);

  /* 定稿口径 */
  eq('v5 Feliks 12.4753', v5.top5[0].score, 12.4753, 1e-4);
  eq('v5 Max 9.4744', v5.top5[1].score, 9.4744, 1e-4);
  eq('v5 第一名是 Feliks', /Feliks/.test(v5.top5[0].name), true);
  eq('v0 Bence 211.7400（分类 bug 下的第 1）', v0.top5[0].score, 211.74, 1e-4);
  eq('v0 Feliks 122.9600', v0.top5.find((x) => /Feliks/.test(x.name)).score, 122.96, 1e-4);
  ok('v6（人数折价）总分低于 v5', v6.total < v5.total);

  ok('top60 无 NaN', J.top.every((x) => Number.isFinite(x.score)));
  ok('top60 名次严格递减', J.top.every((x, i) => i === 0 || J.top[i - 1].score >= x.score));
  let sumOk = true;
  for (const x of J.top) {
    const s = x.tiers.WC + x.tiers.CC + x.tiers.NC;
    if (Math.abs(s - x.score) > 2e-4) { sumOk = false; console.log('    off:', x.name, s, x.score); }
  }
  ok('每人 WC+CC+NC = 总分（±2e-4）', sumOk);
  ok('单项均非负', J.top.every((x) => x.tiers.WC >= 0 && x.tiers.CC >= 0 && x.tiers.NC >= 0));

  /* 赛级规模：多区赛已剔除 */
  eq('WC 12 场', J.tierStat.WC.comps, 12);
  eq('CC 39 场（原 43，剔 4 场多区赛）', J.tierStat.CC.comps, 39);
  eq('NC 876 场（原 882，剔 6 场多区赛）', J.tierStat.NC.comps, 876);
  ok('WC + CC + NC = 927 场冠军赛', J.tierStat.WC.comps + J.tierStat.CC.comps + J.tierStat.NC.comps === 927);
  ok('决赛人数 WC > CC > NC',
    J.tierStat.WC.avgFinal > J.tierStat.CC.avgFinal && J.tierStat.CC.avgFinal > J.tierStat.NC.avgFinal);

  /* ── 项目分项（F3 只有 ev 一级）── */
  console.log('\n[M11] 项目分项（全量）');
  eq('全站项目数 21', Object.keys(J.byEvent).length, 21);
  let evSum = 0;
  for (const g of Object.values(J.byEvent)) evSum += g.total;
  eq('全站分项加总 = 定稿总分', evSum, v5.total, 2e-3);
  ok('每人 per 加总 = 总分', J.top.every((x) => {
    let s = 0;
    for (const k of Object.keys(x.per)) s += x.per[k];
    return Math.abs(s - x.score) < 5e-3;   // per 是 4 位小数，21 项累积误差上限 1.1e-3
  }));
  ok('per 的键全部是项目代号（无 |single / |avg）',
    J.top.every((x) => Object.keys(x.per).every((k) => !k.includes('|'))));
  ok('三阶是分项最大项', (() => {
    const a = Object.entries(J.byEvent).sort((p, q) => q[1].total - p[1].total);
    return a[0][0] === '333';
  })(), JSON.stringify(Object.entries(J.byEvent).sort((p, q) => q[1].total - p[1].total)[0]));
  ok('每个项目的榜次 ≥ 金牌数', Object.values(J.byEvent).every((g) => g.n >= g.gold));
  ok('所有项目总分非负', Object.values(J.byEvent).every((g) => g.total >= 0));

  /* 个人名次构成 */
  ok('每人 金+银+铜 = 榜次', J.top.every((x) =>
    x.place.first + x.place.second + x.place.third === x.n),
  JSON.stringify(J.top.filter((x) => x.place.first + x.place.second + x.place.third !== x.n).map((x) => x.name)));
  eq('Feliks 金 139 / 银 32 / 铜 22', `${J.top[0].place.first}/${J.top[0].place.second}/${J.top[0].place.third}`, '139/32/22');
}

console.log(`\n${fail ? '✗' : '✓'} ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);

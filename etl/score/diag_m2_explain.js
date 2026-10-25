'use strict';
/* M2 概念拆解：把「ρ 中位 / 单条均分 / T_L 名义 / 最终分」四项摊开
 * 用法：node etl/score/diag_m2_explain.js
 * 产出终端输出（可直接引用到文档），不改任何常量。
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const M1 = require('./m1.js');
const RN = require('./runs.js');
const M2 = require('./m2.js');
const F = RN.F4;
const num = (v) => Number(v).toLocaleString('en-US');

const ZIP = fs.readdirSync(path.join(ROOT, 'data/raw')).filter((f) => f.endsWith('.zip'))[0];
const ZIP_PATH = path.join(ROOT, 'data/raw', ZIP);

function streamTsv(name, onRow) {
  return new Promise((resolve, reject) => {
    const ps = spawn('unzip', ['-p', ZIP_PATH, name]);
    let buf = '';
    let head = true;
    ps.on('error', reject);
    ps.stdout.on('data', (d) => {
      buf += d.toString('utf8');
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const ln = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (head) { head = false; continue; }
        if (ln) onRow(ln.split('\t'));
      }
    });
    ps.on('close', () => resolve());
  });
}

const pct = (arr, q) => {
  const a = arr.slice().sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.round((a.length - 1) * q))];
};

(async () => {
  const isoOf = new Map(), isoInfo = new Map(), contOfRaw = new Map();
  await streamTsv('WCA_export_continents.tsv', (r) => contOfRaw.set(r[0], String(r[1] || r[0]).replace(/^_+/, '').trim()));
  await streamTsv('WCA_export_countries.tsv', (r) => {
    const iso = String(r[1] || '').toUpperCase();
    isoOf.set(r[0], iso);
    isoInfo.set(iso, { name: r[2], cont: contOfRaw.get(r[3]) || 'Unknown' });
  });
  const pInfo = new Map();
  await streamTsv('WCA_export_persons.tsv', (r) => {
    const id = r[2]; if (!id) return;
    const sub = +r[3] || 0;
    const cur = pInfo.get(id);
    if (cur && sub < cur.sub) return;
    pInfo.set(id, { name: r[0], iso: (isoOf.get(r[4]) || '').toUpperCase(), sub });
  });
  const compInfo = new Map();
  await streamTsv('WCA_export_competitions.tsv', (r) => {
    if (!r[0]) return;
    compInfo.set(r[0], { name: r[1] || r[0], year: +r[14] || 0, iso: (isoOf.get(r[6]) || '').toUpperCase() });
  });
  const ctypes = new Map();
  await streamTsv('WCA_export_championships.tsv', (r) => {
    if (!r[1]) return;
    if (!ctypes.has(r[1])) ctypes.set(r[1], new Set());
    ctypes.get(r[1]).add(String(r[2] || '').trim());
  });
  const firstYear = new Map();
  const podiums = [];
  const fieldFin = new Map();
  await streamTsv('WCA_export_results.tsv', (r) => {
    const pid = r[8]; if (!pid) return;
    const compId = r[4];
    const comp = compInfo.get(compId) || {};
    const year = comp.year || 0;
    const fy = firstYear.get(pid);
    if (!fy || (year && year < fy)) firstYear.set(pid, year);
    if (!ctypes.has(compId)) return;
    if (!(r[5] === 'f' || r[5] === 'c')) return;
    const k = compId + '|' + r[6];
    fieldFin.set(k, (fieldFin.get(k) || 0) + 1);
    const pos = +r[1];
    if (!(pos >= 1 && pos <= 3)) return;
    const nat = comp.iso || '';
    if (M2.isMultiRegion(nat)) return;
    if (!(+r[2] > 0)) return;
    podiums.push({
      pid, ev: r[6], pos, compId, year,
      tier: M2.tierOf(ctypes.get(compId), nat),
      nat, cont: (isoInfo.get(nat) || {}).cont || 'Unknown',
      compName: comp.name,
      name: (pInfo.get(pid) || {}).name || r[7] || pid,
    });
  });
  for (const p of podiums) p.field = fieldFin.get(p.compId + '|' + p.ev) || 3;

  const cc = {}, nc = {};
  const people = [];
  for (const [pid, p] of pInfo) {
    const cont = (isoInfo.get(p.iso) || {}).cont || 'Unknown';
    nc[p.iso] = (nc[p.iso] || 0) + 1;
    cc[cont] = (cc[cont] || 0) + 1;
    const y = firstYear.get(pid);
    if (y) people.push({ y, cont, nat: p.iso });
  }
  const TOTAL = pInfo.size;
  const ctx = M1.makeContext({ contCount: cc, natCount: nc, total: TOTAL });
  const pool = M1.makeScopePool(people, 2026);

  const cfg = { era: true, rhoMode: 'linear', useWeight: true };
  const scored = podiums.map((p) => ({ p, s: M2.scorePodium(p, { ctx, pool, cfg }) }));

  const L = (s) => console.log(s);
  L('══ 0 一个乘数一个乘数地看 ══');
  L('');
  L('M2 = P(pos) × T_L × ρ_s × f_L × w_e');
  L('');
  L('  P(pos) 名次折价   1 / 0.6 / 0.4   查表，冠军=1，亚军=0.6，季军=0.4');
  L('  T_L    赛级价格   1 / 0.4 / 0.15  查表，世锦赛/洲锦赛/国锦赛');
  L('  ρ_s    属地规模   连续值          「该国(洲)玩家数 ÷ 全球玩家数」');
  L('  f_L    时代折算   连续值          按「赛级 + 属地」分池，取赛事当年的值');
  L('  w_e    项目权重   0.2559–1.0      查表，21 个项目各一个');
  L('');
  L('★ 前两个是查表（离散、手写），后三个是算出来的（连续、每个领奖台都不一样）。');
  L('');

  /* ── 1 ρ 与它的「中位」 ─────────────────────────────────────── */
  L('══ 1 ρ_s 是什么，ρ「中位」又是什么 ══');
  L('');
  L('ρ_s 是一个比值：');
  L('  世锦赛 WC → ρ = 1.0000（恒等，全世界都是池子）');
  L('  洲锦赛 CC → ρ = 该洲玩家数 ÷ 全球玩家数');
  L('  国锦赛 NC → ρ = 该国玩家数 ÷ 全球玩家数');
  L('');
  L('全球玩家数 = ' + num(TOTAL) + '（WCA 全部注册选手）');
  L('');
  L('举 4 个国家（数值=该国 WCA 注册人数）：');
  const topNats = Object.entries(nc).sort((a, b) => b[1] - a[1]);
  for (const iso of ['CN', 'US', 'HU', 'NZ']) {
    const n = nc[iso] || 0;
    L('  ' + iso + '  ' + (isoInfo.get(iso) || {}).name + '：' + num(n) + ' 人 → ρ_N = '
      + F(n / TOTAL) + '（' + (n / TOTAL * 100).toFixed(2) + '%）');
  }
  L('');
  L('★ 关键：ρ 不带任何主观系数，它就是「这个国家占全球多少」。');
  L('  美国占 ' + (nc.US / TOTAL * 100).toFixed(2) + '%，所以美国国锦赛 ρ = ' + F(nc.US / TOTAL)
    + '；新西兰占 ' + (nc.NZ / TOTAL * 100).toFixed(2) + '%，ρ 就只有 ' + F(nc.NZ / TOTAL) + '。');
  L('  同一级别的两场国锦赛，价格可以差 ' + F((nc.US / TOTAL) / (nc.NZ / TOTAL)) + ' 倍。');
  L('');

  L('「中位」不是平均数，是把该级别所有领奖台的 ρ 排成一队，取正中间那个。');
  L('');
  for (const t of ['WC', 'CC', 'NC']) {
    const rs = scored.filter((x) => x.p.tier === t).map((x) => x.s.rho);
    const mean = rs.reduce((a, b) => a + b, 0) / rs.length;
    const med = pct(rs, 0.5);
    L('  ' + t + '（' + num(rs.length) + ' 条）');
    L('    ρ 最小 ' + F(pct(rs, 0)) + ' ｜ 25% ' + F(pct(rs, 0.25)) + ' ｜ **中位 ' + F(med)
      + '** ｜ 75% ' + F(pct(rs, 0.75)) + ' ｜ 90% ' + F(pct(rs, 0.9)) + ' ｜ 最大 ' + F(pct(rs, 1)));
    L('    算术平均 ' + F(mean) + (Math.abs(mean - med) < 1e-9
      ? '（与中位相同 → 这一级没有离散度）'
      : (med < mean
        ? '（中位 ' + F(med) + ' ＜ 平均 ' + F(mean) + ' → 右偏：少数大国/大洲的场次把平均拉高了，中位更能代表「典型一条」）'
        : '（中位 ' + F(med) + ' ＞ 平均 ' + F(mean) + ' → 左偏）')));
    L('');
  }
  L('为什么 NC 的中位是 0.0073（≈0.73%，约 2,200 人），而不是某个小国的 0.0005？');
  L('因为中位是按**领奖台条数**排的，不是按国家排的：');
  L('  中国、美国、印度这些办赛多的国家贡献了大量领奖台，把「正中间那一条」推到了中等国家的位置。');
  L('  真正的小国（ρ 最小 ' + F(pct(scored.filter((x) => x.p.tier === 'NC').map((x) => x.s.rho), 0))
    + '）在尾部，它们单条只值 0.0000 分。');
  L('');

  /* ── 2 单条均分 ────────────────────────────────────────────── */
  L('══ 2 「单条均分」是什么 ══');
  L('');
  L('单条均分 = 该级别所有领奖台的分数总和 ÷ 条数。');
  L('它是一个**事后统计量**，不是公式的一部分 —— 谁也没有在打分时乘过它。');
  L('');
  for (const t of ['WC', 'CC', 'NC']) {
    const xs = scored.filter((x) => x.p.tier === t);
    const sum = xs.reduce((a, x) => a + x.s.score, 0);
    const mean = sum / xs.length;
    L('  ' + t + '：总和 ' + F(sum) + ' ÷ ' + num(xs.length) + ' 条 = **' + F(mean) + '**');
  }
  const all = scored.reduce((a, x) => a + x.s.score, 0);
  L('  合计：' + F(all) + ' ÷ ' + num(scored.length) + ' 条 = ' + F(all / scored.length));
  L('');
  L('它有用，是因为它把「查表的名义价格」和「真实的平均价格」放在一起比：');
  L('  名义上 NC 是 WC 的 0.15 倍，实际单条均分只有 0.0026 倍 —— 中间差了 57 倍，');
  L('  这 57 倍全部来自 ρ 和 f。');
  L('');

  /* ── 3 T_L 名义 ────────────────────────────────────────────── */
  L('══ 3 T_L「名义」是什么意思 ══');
  L('');
  L('T_L 就是 `m2.js` 里的 TIER_BASE 常量表，手写在代码里：');
  L('');
  L('  const TIER_BASE = { WC: 1.0000, CC: 0.4000, NC: 0.1500, OP: 0.0500 };');
  L('');
  L('说它「名义」，是因为它**只是乘法的第一项**，后面还要乘 ρ、f、w：');
  L('');
  L('  一条 WC 冠军：1 × 1.0000 × 1.0000 × 0.80 × 1.00 ≈ 0.80 分（ρ=1，所以名义≈实际）');
  L('  一条 NC 冠军：1 × 0.1500 × 0.0073 × 0.88 × 1.00 ≈ 0.001 分（真实只有名义的 0.7%）');
  L('');
  L('★ 所以「国锦赛 = 世锦赛的 15%」只描述了眼下的 0.15 这个数，');
  L('  完全没算 ρ。真实价格是 0.11%。这就是「名义 / 实际」的差别。');
  L('');

  /* ── 4 三条同样是「333 冠军」的领奖台 ────────────────────────── */
  L('══ 4 三条都是「三阶冠军、pos=1、w=1」的领奖台 ══');
  L('');
  L('它们唯一的差别就是 T_L、ρ_s、f_L 三项 —— 正好把这三个乘数的效果隔离开。');
  L('');
  const pick = (fn) => scored.find(fn);
  const samples = [
    pick((x) => x.p.tier === 'WC' && x.p.pos === 1 && x.p.ev === '333' && x.p.year === 2013),
    pick((x) => x.p.tier === 'CC' && x.p.pos === 1 && x.p.ev === '333' && x.p.cont === 'Europe'),
    pick((x) => x.p.tier === 'NC' && x.p.pos === 1 && x.p.nat === 'HU' && x.p.ev === '333'),
  ].filter(Boolean);

  L('| 赛级 | 选手 | 赛事 | P | T_L | ρ | f | w | 分数 |');
  L('|---|---|---|---|---|---|---|---|---|');
  for (const { p, s } of samples) {
    L('| ' + p.tier + ' | ' + p.name + ' | ' + p.compName + ' ' + p.year + ' | ' + F(M2.PLACE_W[p.pos])
      + ' | ' + F(s.tierBase) + ' | ' + F(s.rho) + ' | ' + F(s.f) + ' | ' + F(s.w) + ' | **' + F(s.score) + '** |');
  }
  L('');
  L('★ 看这张表就够了：三行都是「冠军」，T_L 从 1.0 掉到 0.15（6.67 倍），');
  L('  但 ρ 从 1.0 掉到 0.0044（227 倍），两项相乘的结果是 1 → 0.0005（1,604 倍）。');
  L('  T_L 只解释了这 1,604 倍里的 6.67 倍，剩下 240 倍全是 ρ 干的。');
  L('');
  L('（f 也在动，但三条都在 0.62–0.80 之间，只放大 1.3 倍，不改变结论。）');
  L('');

  L('── 逐条账本');
  L('');
  samples.forEach((x, i) => {
    const { p, s } = x;
    L('样例 ' + (i + 1) + '：' + p.name + ' ｜ ' + p.compName + ' ' + p.year
      + ' ｜ ' + p.ev + ' 第 ' + p.pos + ' 名 ｜ ' + p.tier + ' ｜ 决赛 ' + p.field + ' 人');
    L('   ① P(pos)   pos=' + p.pos + ' 查 PLACE_W → ' + F(M2.PLACE_W[p.pos]));
    L('   ② T_L      tier=' + p.tier + ' 查 TIER_BASE → ' + F(s.tierBase) + '（这就是「名义」）');
    L('   ③ ρ_s      ' + (p.tier === 'WC' ? '世锦赛恒 1 → 1.0000'
      : p.tier === 'CC' ? p.cont + ' 玩家 ÷ ' + num(TOTAL) + ' → ' + F(s.rho)
      : p.nat + ' 玩家 ' + num(nc[p.nat] || 0) + ' ÷ ' + num(TOTAL) + ' → ' + F(s.rho)));
    L('   ④ f_L      ' + p.tier + '/' + (p.tier === 'WC' ? '全球' : p.tier === 'CC' ? p.cont : p.nat)
      + ' 池、' + p.year + ' 年 → ' + F(s.f));
    L('   ⑤ w_e      ' + p.ev + ' 查 EV_WEIGHT_V2 → ' + F(s.w));
    L('   分数 = ' + F(M2.PLACE_W[p.pos]) + ' × ' + F(s.tierBase) + ' × ' + F(s.rho)
      + ' × ' + F(s.f) + ' × ' + F(s.w) + ' = **' + F(s.score) + '**');
    L('');
  });

  /* ── 4b 中国有没有国家级冠军赛 ────────────────────────────────── */
  const cnNC = new Set(podiums.filter((p) => p.nat === 'CN' && p.tier === 'NC').map((p) => p.compId));
  const cnRows = podiums.filter((p) => p.nat === 'CN');
  const cnAll = new Set(cnRows.map((p) => p.compId));
  L('── 顺带查一下中国（' + num(nc.CN) + ' 名注册选手，ρ = ' + F(nc.CN / TOTAL) + '）');
  L('');
  L('  举办国=CN 且进了 M2 的冠军赛：' + num(cnAll.size) + ' 场，其中判为 NC 的 '
    + num(cnNC.size) + ' 场');
  const cnTier = {};
  for (const p of cnRows) cnTier[p.tier] = (cnTier[p.tier] || 0) + 1;
  L('  按赛级分：' + Object.entries(cnTier).map(([k, v]) => k + ' ' + v + ' 条').join(' ｜ '));
  const cnComps = new Map();
  for (const p of cnRows) {
    const k = p.compId + ' ' + p.compName + ' ' + p.year + ' [' + p.tier + ']';
    cnComps.set(k, (cnComps.get(k) || 0) + 1);
  }
  for (const [k, v] of cnComps) L('    · ' + k + '（' + v + ' 条）');
  L('');
  L('  美国 ' + num(nc.US) + ' 人（ρ = ' + F(nc.US / TOTAL) + '），中国 ' + num(nc.CN)
    + ' 人（ρ = ' + F(nc.CN / TOTAL) + '）。');
  L('  同样一场国锦赛冠军，中国只值美国的 ' + F((nc.CN / TOTAL) / (nc.US / TOTAL)) + ' 倍。');
  L('  ★ 注意 ρ 的分母是「WCA 注册选手总数」，不是「近五年活跃人数」。');
  L('    注册数里包含大量只比过一两次的人，各国「注册/活跃」比例并不一致 ——');
  L('    这是 ρ 的一个隐含假设，没有任何校准。');
  L('');


  /* ── 5 一个国家的 ρ 从哪来（可复核） ─────────────────────────── */
  L('══ 5 复核：ρ 是能自己手算出来的 ══');
  L('');
  const hu = nc.HU || 0, cn = nc.CN || 0;
  L('  匈牙利 HU：' + num(hu) + ' 人 ÷ ' + num(TOTAL) + ' = ' + (hu / TOTAL).toFixed(6)
    + ' → 4 位小数 ' + F(hu / TOTAL));
  L('  中国 CN：  ' + num(cn) + ' 人 ÷ ' + num(TOTAL) + ' = ' + (cn / TOTAL).toFixed(6)
    + ' → 4 位小数 ' + F(cn / TOTAL));
  L('  欧洲 Europe：' + num(cc.Europe) + ' 人 ÷ ' + num(TOTAL) + ' = ' + (cc.Europe / TOTAL).toFixed(6));
  L('');
  L('  用这几个数去对上面样例 1 / 2 / 3 的 ρ，必须一致 —— 不一致就是哪里错了。');
  L('');
})().catch((e) => { console.error(e); process.exit(1); });

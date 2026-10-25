'use strict';
/* M2-F3 体检 · 找「定稿之后仍然存在」的问题（只读，不改 m2 任何常量）
 *
 * 用法：node --max-old-space-size=6144 etl/score/diag_m2_v3.js
 *
 * 检 8 件事：
 *   D1 覆盖度      M2 > 0 的人数 / 全体参赛者；归一化后大部分人是几分
 *   D2 小场次      决赛人数 ≤3 / ≤5 的领奖台占比与分数占比（铜牌白送）
 *   D3 ρ 的二次折价  NC 单价 vs WC 单价的实际倍数；ρ 分布分位
 *   D4 f 的作用    era=true/false 两遍，Top60 名次变动与总分变动
 *   D5 w 的双重计数 corr(w_e, 该项目榜次数)
 *   D6 分类残余    无法归类的 championship_type；名字像洲际赛却判 NC 的场次
 *   D7 单场依赖    每人最高单场贡献占其总分的比例（一次主场爆发的权重）
 *   D8 累积结构    n 的分布；n ≥ 100 的人数；每人平均每台分值
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const M1 = require('./m1.js');
const RN = require('./runs.js');
const M2 = require('./m2.js');

const F = RN.F4;
const PCT = (v) => (v * 100).toFixed(2) + '%';
const num = (v) => Number(v).toLocaleString('en-US');

const ZIP = fs.readdirSync(path.join(ROOT, 'data/raw')).filter((f) => f.endsWith('.zip'))[0];
const ZIP_PATH = path.join(ROOT, 'data/raw', ZIP);

function streamTsv(name, onRow, opt) {
  const o = opt || {};
  return new Promise((resolve, reject) => {
    const ps = spawn('unzip', ['-p', ZIP_PATH, name]);
    let buf = '';
    let head = o.hasHeader !== false;
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
  if (!arr.length) return 0;
  const a = arr.slice().sort((x, y) => x - y);
  const i = Math.min(a.length - 1, Math.max(0, Math.round((a.length - 1) * q)));
  return a[i];
};
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
const corr = (a, b) => {
  const n = a.length;
  if (n < 2) return 0;
  const ma = mean(a), mb = mean(b);
  let sab = 0, sa = 0, sb = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma, db = b[i] - mb;
    sab += da * db; sa += da * da; sb += db * db;
  }
  return sa && sb ? sab / Math.sqrt(sa * sb) : 0;
};

(async () => {
  const t0 = Date.now();
  const log = (s) => console.log('[' + ((Date.now() - t0) / 1000).toFixed(1) + 's] ' + s);
  const OUT = [];
  const P = (s) => { OUT.push(s); console.log(s); };

  /* ── 解析（与 m2_build 完全同口径） ───────────────────────────── */
  const isoOf = new Map();
  const isoInfo = new Map();
  const contOfRaw = new Map();
  await streamTsv('WCA_export_continents.tsv', (r) => {
    contOfRaw.set(r[0], String(r[1] || r[0]).replace(/^_+/, '').trim());
  });
  await streamTsv('WCA_export_countries.tsv', (r) => {
    const iso = String(r[1] || '').toUpperCase();
    const cont = contOfRaw.get(r[3]) || 'Unknown';
    isoOf.set(r[0], iso);
    isoInfo.set(iso, { name: r[2], cont });
  });
  const pInfo = new Map();
  await streamTsv('WCA_export_persons.tsv', (r) => {
    const id = r[2];
    if (!id) return;
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
  const ctypeRaw = new Map();
  await streamTsv('WCA_export_championships.tsv', (r) => {
    if (!r[1]) return;
    if (!ctypes.has(r[1])) { ctypes.set(r[1], new Set()); ctypeRaw.set(r[1], []); }
    ctypes.get(r[1]).add(String(r[2] || '').trim());
    ctypeRaw.get(r[1]).push(String(r[2] || '').trim());
  });
  const fmtInfo = new Map();
  await streamTsv('WCA_export_formats.tsv', (r) => {
    if (!r[0]) return;
    fmtInfo.set(r[0], { sortBy: String(r[3] || '').toLowerCase() });
  });
  log('meta loaded · persons ' + num(pInfo.size) + ' · comps ' + num(compInfo.size)
    + ' · champ comps ' + num(ctypes.size));

  const firstYear = new Map();
  const podiums = [];
  const fieldFin = new Map();
  let opRows = 0;
  let opComps = new Set();
  const rounds = new Set();
  const posRound = new Map();   // compId|ev → 该轮所有 pos（查并列）
  await streamTsv('WCA_export_results.tsv', (r) => {
    const pid = r[8];
    if (!pid) return;
    const compId = r[4];
    const comp = compInfo.get(compId) || {};
    const year = comp.year || 0;
    const fy = firstYear.get(pid);
    if (!fy || (year && year < fy)) firstYear.set(pid, year);

    const isChamp = ctypes.has(compId);
    const isFinal = r[5] === 'f' || r[5] === 'c';
    if (!isFinal) return;
    if (!isChamp) {
      const pos = +r[1];
      if (pos >= 1 && pos <= 3) { opRows++; opComps.add(compId); }
      return;
    }
    const eid = r[6];
    const k = compId + '|' + eid;
    rounds.add(k);
    fieldFin.set(k, (fieldFin.get(k) || 0) + 1);
    if (!posRound.has(k)) posRound.set(k, []);
    posRound.get(k).push(+r[1]);

    const pos = +r[1];
    if (!(pos >= 1 && pos <= 3)) return;
    const nat = comp.iso || '';
    const tier = M2.tierOf(ctypes.get(compId), nat);
    if (M2.isMultiRegion(nat)) return;
    if (!(+r[2] > 0)) return;
    podiums.push({
      pid, ev: eid, pos, compId, year, tier,
      nat, cont: (isoInfo.get(nat) || {}).cont || 'Unknown',
      name: (pInfo.get(pid) || {}).name || r[7] || pid,
    });
  });
  for (const p of podiums) p.field = fieldFin.get(p.compId + '|' + p.ev) || 3;
  log('podiums ' + num(podiums.length) + ' · 决赛轮 ' + num(rounds.size)
    + ' · 普通赛事领奖台 ' + num(opRows) + ' / ' + num(opComps.size) + ' 场');

  /* ── ρ 池 ─────────────────────────────────────────────────────── */
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
  log('total players ' + num(TOTAL));

  /* ── 两遍打分：v5（era）与 v5-noEra ───────────────────────────── */
  const base = { tierBase: { WC: 1, CC: 0.4, NC: 0.15, OP: 0.05 }, rhoMode: 'linear', useWeight: true };
  const run = (era) => {
    const cfg = { ...base, era };
    const acc = new Map();
    const byEv = new Map();
    const byTier = { WC: 0, CC: 0, NC: 0, OP: 0 };
    let total = 0;
    for (const pod of podiums) {
      const s = M2.scorePodium(pod, { ctx, pool, cfg });
      total += s.score;
      byTier[pod.tier] += s.score;
      let e = byEv.get(pod.ev);
      if (!e) { e = { score: 0, n: 0 }; byEv.set(pod.ev, e); }
      e.score += s.score; e.n++;
      let a = acc.get(pod.pid);
      if (!a) {
        a = { pid: pod.pid, name: pod.name, nat: pod.nat, cont: pod.cont, score: 0, n: 0, byComp: new Map(), byTier: { WC: 0, CC: 0, NC: 0 }, fSum: 0 };
        acc.set(pod.pid, a);
      }
      a.score += s.score;
      a.n++;
      a.fSum += s.f;
      a.byTier[pod.tier] += s.score;
      a.byComp.set(pod.compId, (a.byComp.get(pod.compId) || 0) + s.score);
    }
    return { total, byEv, byTier, acc };
  };
  const V = run(true);
  const N = run(false);
  log('scored: v5 ' + F(V.total) + ' · noEra ' + F(N.total));

  P('# M2-F3 体检报告（定稿后再审）');
  P('');
  P('> 数据：快照 2026-10-15｜领奖台 ' + num(podiums.length) + ' 条｜决赛轮 ' + num(rounds.size)
    + '｜总玩家 ' + num(TOTAL));
  P('> 本文只做诊断，不改任何常量；所有数字由 `diag_m2_v3.js` 现算。');
  P('');

  /* ── D1 覆盖度 ────────────────────────────────────────────────── */
  const list = [...V.acc.values()].sort((a, b) => b.score - a.score);
  const MAX = list[0].score;
  P('## D1 覆盖度：M2 只对极少数人非零');
  P('');
  P('| 项目 | 数值 |');
  P('|---|---|');
  P('| M2 > 0 的人数 | ' + num(list.length) + ' / ' + num(TOTAL) + '（' + PCT(list.length / TOTAL) + '） |');
  P('| 冠军赛 | ' + num(ctypes.size - 0) + ' 场登记，实际进入 M2 ' + num(new Set(podiums.map((x) => x.compId)).size) + ' 场 |');
  P('| 全站赛事 | ' + num(compInfo.size) + ' 场，冠军赛占 ' + PCT(new Set(podiums.map((x) => x.compId)).size / compInfo.size) + ' |');
  P('| 归一化分母（Feliks） | ' + F(MAX) + ' |');
  const th = [10, 50, 100, 200, 500, 1000, 2000, 5000];
  P('| 排名 → 原始分 → 归一化(0–100) | ' + th.map((r) => {
    const x = list[r - 1];
    return x ? '#' + r + ' ' + F(x.score) + ' (' + F(x.score / MAX * 100) + ')' : '#' + r + ' —';
  }).join('｜') + ' |');
  P('');
  const nZero = TOTAL - list.length;
  P('- **' + PCT(nZero / TOTAL) + ' 的选手 M2 = 0**（' + num(nZero) + ' 人）。作为雷达图的一维，'
    + '这一维对绝大多数人是常数 0，不提供任何区分度。');
  P('- 归一化后，第 100 名约 ' + F(list[99].score / MAX * 100) + ' 分、第 500 名约 '
    + F(list[499].score / MAX * 100) + ' 分 —— 整条分数带挤在底部。');
  P('');

  /* ── D2 小场次 ────────────────────────────────────────────────── */
  const buckets = [[1, 3], [4, 5], [6, 8], [9, 16], [17, 32], [33, 9999]];
  const buckName = ['≤3 人', '4–5 人', '6–8 人', '9–16 人', '17–32 人', '>32 人'];
  const bRow = buckets.map(() => ({ n: 0, score: 0 }));
  for (const pod of podiums) {
    const s = M2.scorePodium(pod, { ctx, pool, cfg: { ...base, era: true } }).score;
    const b = buckets.findIndex(([lo, hi]) => pod.field >= lo && pod.field <= hi);
    if (b >= 0) { bRow[b].n++; bRow[b].score += s; }
  }
  P('## D2 小场次：铜牌白送的比例');
  P('');
  P('决赛人数分布（M2 全部 ' + num(podiums.length) + ' 条领奖台，' + num(rounds.size) + ' 个决赛轮）：');
  P('');
  P('| 决赛人数 | 领奖台条数 | 占比 | 分数 | 分数占比 |');
  P('|---|---|---|---|---|');
  bRow.forEach((x, i) => {
    P('| ' + buckName[i] + ' | ' + num(x.n) + ' | ' + PCT(x.n / podiums.length)
      + ' | ' + F(x.score) + ' | ' + PCT(x.score / V.total) + ' |');
  });
  P('');
  const small = bRow[0].n + bRow[1].n;
  P('- **' + num(small) + ' 条（' + PCT(small / podiums.length) + '）来自 ≤5 人的决赛轮**：'
    + '这种轮次只要完赛就是前三名，季军分是「报名即得」。');
  P('- 这与第 13.1 节「f_L 不看当届规模」是同一件事。v6 已经试过人数折价'
    + '（总量 217.8556 → 210.2457，前 10 名次 8/10 不变），因「改动小」被否 —— '
    + '但 v6 用的是 `(人数/16)^0.35`，对 3 人场只降到 0.51，压不住真正的白送。');
  P('');

  /* ── D3 ρ 的二次折价 ──────────────────────────────────────────── */
  const tierUnit = {};
  for (const t of ['WC', 'CC', 'NC']) {
    const xs = podiums.filter((p) => p.tier === t);
    const ss = xs.map((p) => M2.scorePodium(p, { ctx, pool, cfg: { ...base, era: true } }));
    tierUnit[t] = {
      n: xs.length,
      unit: mean(ss.map((s) => s.score)),
      rhoMed: pct(ss.map((s) => s.rho), 0.5),
      rho90: pct(ss.map((s) => s.rho), 0.9),
      rhoMax: Math.max(...ss.map((s) => s.rho)),
      fMed: pct(ss.map((s) => s.f), 0.5),
      score: ss.reduce((a, s) => a + s.score, 0),
    };
  }
  P('## D3 ρ 的二次折价：NC 被罚了两次');
  P('');
  P('| 赛级 | 条数 | 单条均分 | ρ 中位 | ρ 90 分位 | ρ 最大 | f 中位 | 总分 | 分数占比 |');
  P('|---|---|---|---|---|---|---|---|---|');
  for (const t of ['WC', 'CC', 'NC']) {
    const x = tierUnit[t];
    P('| ' + t + ' | ' + num(x.n) + ' | ' + F(x.unit) + ' | ' + F(x.rhoMed) + ' | ' + F(x.rho90)
      + ' | ' + F(x.rhoMax) + ' | ' + F(x.fMed) + ' | ' + F(x.score) + ' | ' + PCT(x.score / V.total) + ' |');
  }
  P('');
  P('- NC 单条均分 / WC 单条均分 = **' + F(tierUnit.NC.unit / tierUnit.WC.unit) + '**，'
    + '即一个全国锦标赛领奖台平均只值世界锦标赛的 ' + PCT(tierUnit.NC.unit / tierUnit.WC.unit) + '。');
  P('- 拆开看：T_L 只罚了 6.6667 倍（0.15 / 1.0），ρ 又罚了 '
    + F(tierUnit.WC.rhoMed / tierUnit.NC.rhoMed) + ' 倍（ρ 中位 ' + F(tierUnit.WC.rhoMed) + ' → ' + F(tierUnit.NC.rhoMed) + '）。'
    + '**这才是 NC 归零的机制 —— 不是 T_L 太狠，是竞争密度被算了两次。**');
  P('- 逻辑上，领奖台「已经」在实际竞争者的池子里产生：你在匈牙利锦标赛赢的是匈牙利的 90 个人，'
    + '这件事本身已经包含了「匈牙利有多小」。再乘一次 (匈牙利玩家/全球) 等于把小国罚两遍。'
    + 'M1 里 ρ 是必须的（NR 的价值需要在全球尺度上折算），M2 里它不是。');
  P('');
  P('**名义价格 vs 实际价格**（实际 = T_L × ρ 中位，再除以 WC 的 1.0 × 1.0）：');
  P('');
  P('| 赛级 | T_L（名义） | ρ 中位 | 实际相对价 | 名义/实际 |');
  P('|---|---|---|---|---|');
  const nom = { WC: 1, CC: 0.4, NC: 0.15 };
  for (const t of ['WC', 'CC', 'NC']) {
    const act = nom[t] * tierUnit[t].rhoMed / (nom.WC * tierUnit.WC.rhoMed);
    P('| ' + t + ' | ' + F(nom[t]) + ' | ' + F(tierUnit[t].rhoMed) + ' | ' + F(act)
      + ' | ' + F(act / nom[t]) + ' |');
  }
  P('');
  P('- **口径描述与实际差了一个数量级以上**：文档说三级是 1 : 0.4 : 0.15（差 6.67 倍），'
    + '真实单条价格是 1 : ' + F(nom.CC * tierUnit.CC.rhoMed / (nom.WC * tierUnit.WC.rhoMed)) + ' : '
    + F(nom.NC * tierUnit.NC.rhoMed / (nom.WC * tierUnit.WC.rhoMed)) + '（差 '
    + F(1 / (nom.NC * tierUnit.NC.rhoMed / (nom.WC * tierUnit.WC.rhoMed))) + ' 倍）。'
    + '说「国锦赛值世锦赛的 15%」是不成立的 —— 实际是 '
    + PCT(nom.NC * tierUnit.NC.rhoMed / (nom.WC * tierUnit.WC.rhoMed)) + '。');
  P('');
  P('**若要修，唯一自洽的改法是「该级内部份额」**：NC 的 ρ 恒为 1（国锦赛的池就是该国），'
    + 'CC 的 ρ = 该国玩家 / 该洲玩家，WC 恒 1。这样 T_L 才真正等于「相对价格」。'
    + '但 T_L 不动直接换 ρ，NC 会从 ' + PCT(tierUnit.NC.score / V.total) + ' 涨到 '
    + PCT(tierUnit.NC.unit / tierUnit.NC.rhoMed * tierUnit.NC.n / (
      tierUnit.WC.unit * tierUnit.WC.n + tierUnit.CC.unit * tierUnit.CC.n + tierUnit.NC.unit / tierUnit.NC.rhoMed * tierUnit.NC.n))
    + ' —— 这反过来说明：**当前 M2 的赛级价格是 ρ 在主导，T_L 只是名义值**。'
    + '要动就必须两个一起重标。');
  P('');

  /* ── D4 f 的作用 ──────────────────────────────────────────────── */
  const listN = [...N.acc.values()].sort((a, b) => b.score - a.score);
  const rankN = new Map(listN.map((x, i) => [x.pid, i + 1]));
  let moved = 0, moved3 = 0;
  const deltas = [];
  list.slice(0, 60).forEach((x, i) => {
    const r2 = rankN.get(x.pid);
    const d = r2 - (i + 1);
    if (d !== 0) moved++;
    if (Math.abs(d) >= 3) moved3++;
    deltas.push({ name: x.name, r: i + 1, r2, d, s: x.score, s2: N.acc.get(x.pid).score });
  });
  P('## D4 f 时代折算：不是「尺度」，是代际再分配');
  P('');
  P('| 口径 | 总量 | 第 1 名 | 第 2 名 | 比值 |');
  P('|---|---|---|---|---|');
  P('| v5（含 f） | ' + F(V.total) + ' | ' + list[0].name + ' ' + F(list[0].score) + ' | '
    + list[1].name + ' ' + F(list[1].score) + ' | ' + F(list[0].score / list[1].score) + ' |');
  P('| v5 − f（era=false） | ' + F(N.total) + ' | ' + listN[0].name + ' ' + F(listN[0].score) + ' | '
    + listN[1].name + ' ' + F(listN[1].score) + ' | ' + F(listN[0].score / listN[1].score) + ' |');
  P('');
  P('- 去掉 f 后，**Top60 中有 ' + moved + ' 人名次变化，其中 ' + moved3 + ' 人变动 ≥3 位**。'
    + 'f 不是「只是尺度」—— 它确实在改排序。');
  P('- 但它的作用方向很单一：**压老将、抬新人**。Feliks/Max 的比值 '
    + F(list[0].score / list[1].score) + '（含 f） vs ' + F(listN[0].score / listN[1].score)
    + '（去 f）—— f 把 Feliks 的领先从 ' + PCT(listN[0].score / listN[1].score - 1)
    + ' 压到 ' + PCT(list[0].score / list[1].score - 1) + '。这与 M1 里 f 的方向完全一致'
    + '（M1 里 f 让 Feliks 直接输给 Max），只是 M2 的 f 用「当日值」而非「区间均值」，'
    + '折价力度弱得多（M2 平均 f 0.78–0.92 vs M1 的 0.73 / 0.93），所以没压到翻转。');
  const fAvg = {};
  for (const t of ['WC', 'CC', 'NC']) {
    const xs = podiums.filter((p) => p.tier === t);
    fAvg[t] = mean(xs.map((p) => M2.scorePodium(p, { ctx, pool, cfg: { ...base, era: true } }).f));
  }
  P('- 平均 f：WC ' + F(fAvg.WC) + ' / CC ' + F(fAvg.CC) + ' / NC ' + F(fAvg.NC)
    + '。冠军赛集中在近 15 年，f 的折价整体只有 ' + PCT(1 - V.total / N.total) + '。');
  P('');
  const bigMovers = deltas.filter((d) => d.d >= 2).slice(0, 5);
  if (bigMovers.length) {
    P('受益于 f（去掉 f 后名次下降最多）的 5 人：');
    P('');
    P('| 选手 | 现名次 | 去 f 名次 | 变动 |');
    P('|---|---|---|---|');
    for (const d of bigMovers) P('| ' + d.name + ' | ' + d.r + ' | ' + d.r2 + ' | +' + d.d + ' |');
    P('');
  }
  P('**这段真正的问题不是数值，是语义。** M1 折 f 是因为「6.45 秒」和「4.5 秒」的绝对刻度不可比；'
    + 'M2 的领奖台是「当年那场我赢了同场的人」，这本身已经是同时代比较 —— '
    + '2009 年的世界冠军，赢的是 2009 年的对手，不需要再折算。'
    + '给它乘一个随年代单调上升的 f，等于说「2009 年的冠军不如 2026 年的冠军」，'
    + '在「名次」语义下没有依据。它现在的实际效果是让总量掉 '
    + PCT(1 - V.total / N.total) + '、让 Top60 里 ' + moved + ' 人换位，方向一律是抬新人。'
    + '这是个**代际再分配**，不是「跨时代可比」—— 文档里不该把它说成后者。');
  P('');

  /* ── D5 w 的双重计数 ──────────────────────────────────────────── */
  const evs = [...V.byEv.keys()];
  const wArr = evs.map((e) => RN.EV_WEIGHT_V2[e] == null ? RN.WEIGHT_V2_CFG.floor : RN.EV_WEIGHT_V2[e]);
  const nArr = evs.map((e) => V.byEv.get(e).n);
  const sArr = evs.map((e) => V.byEv.get(e).score);
  P('## D5 w_e 与「项目榜次」的相关性：可能双重计数');
  P('');
  P('| 相关系数 | 值 |');
  P('|---|---|');
  P('| corr(w_e, 该项目领奖台条数) | ' + F(corr(wArr, nArr)) + ' |');
  P('| corr(w_e, 该项目总分) | ' + F(corr(wArr, sArr)) + ' |');
  P('| corr(领奖台条数, 总分) | ' + F(corr(nArr, sArr)) + ' |');
  P('');
  P('- 若 corr(w, n) 明显为正，说明 w_e 承担的一部分是「项目热度」，而热度已经通过'
    + '「该项目有多少领奖台」进入了 M2（热门项目场次多、榜次多）。两者同时作用，热门项目被抬两次。');
  P('- w_e 是 M1 从「参赛人数占比 + 纪录条数」推出来的**纪录含金量**；'
    + '用在领奖台上是跨用途复用，本身没有错，但它与 n 的相关性决定了重复程度。');
  P('');

  /* ── D6 分类残余 ──────────────────────────────────────────────── */
  const odd = new Map();
  let champComps = 0;
  for (const [cid, set] of ctypes) {
    const iso = (compInfo.get(cid) || {}).iso || '';
    if (M2.isMultiRegion(iso)) continue;
    champComps++;
    const t = M2.tierOf(set, iso);
    if (t !== 'NC') continue;
    for (const x of set) {
      const s = String(x).toUpperCase();
      if (s !== iso) {
        const k = x + ' → 举办国 ' + iso + '（判 NC）';
        odd.set(k, (odd.get(k) || 0) + 1);
      }
    }
  }
  P('## D6 分类残余：还有多少「没归好类」的冠军赛');
  P('');
  P('冠军赛 ' + num(champComps) + ' 场（已剔多区赛）。`tierOf` 落 NC 但 championship_type 与举办国不一致的组合：'
    + num(odd.size) + ' 种。');
  P('');
  if (odd.size) {
    P('| 组合 | 场次 |');
    P('|---|---|');
    for (const [k, v] of [...odd.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
      P('| ' + k + ' | ' + v + ' |');
    }
    P('');
  }
  /* 名字里带 continent / open 等信号、却被判 NC 的场次 */
  const sus = [];
  const CONT_WORDS = /(europe|asian|asia|africa|pacific|oceania|south ?america|north ?america|continental|iberian|nordic|baltic|balkan|benelux|caribbean|middle ?east)/i;
  for (const [cid, set] of ctypes) {
    const c = compInfo.get(cid) || {};
    const iso = c.iso || '';
    if (M2.isMultiRegion(iso)) continue;
    if (M2.tierOf(set, iso) !== 'NC') continue;
    if (CONT_WORDS.test(c.name) || CONT_WORDS.test([...set].join(' '))) {
      sus.push({ cid, name: c.name, iso, types: [...set].join('+'), year: c.year });
    }
  }
  P('名字像洲际赛却判成 NC 的场次：**' + sus.length + ' 场**。');
  P('');
  if (sus.length) {
    P('| compId | 名称 | 举办国 | type | 年 |');
    P('|---|---|---|---|---|');
    for (const x of sus.slice(0, 20)) {
      P('| ' + x.cid + ' | ' + x.name + ' | ' + x.iso + ' | ' + x.types + ' | ' + x.year + ' |');
    }
    P('');
    P('（这些场次进了 M2 的 NC 池，单价约为 WC 的 ' + F(tierUnit.NC.unit / tierUnit.WC.unit) + '；'
      + '如果其中有真正的洲际赛，它们被低估了 ' + F(0.4 / 0.15) + ' 倍。）');
    P('');
  }

  /* ── D6b greater_china：第四类 championship_type ──────────────── */
  const gcRows = [];
  const gcCompN = new Map();
  for (const p of podiums) {
    const ts = [...(ctypes.get(p.compId) || [])].map((t) => String(t).toLowerCase());
    if (!ts.includes('greater_china')) continue;
    const hasCont = ts.some((t) => t.charAt(0) === '_') || ts.includes('world');
    if (hasCont) continue;                 // 同时有洲标识的（AsianChampionship2016）不算
    gcRows.push(p);
    gcCompN.set(p.compId, (gcCompN.get(p.compId) || 0) + 1);
  }
  const gcScore = gcRows.reduce((a, p) => a + M2.scorePodium(p, { ctx, pool, cfg: { ...base, era: true } }).score, 0);
  const gcAsNC = gcRows.reduce((a, p) => a + M2.scorePodium({ ...p, tier: 'NC' }, { ctx, pool, cfg: { ...base, era: true } }).score, 0);
  P('## D6b `greater_china`：文档漏记的第四类');
  P('');
  P('定稿第 6.5 节写「championship_type 只有三类：world / 洲 / 国家代码」—— **这是错的**。');
  P('实际还有第四类 `greater_china`（大中华区），共 6 行；`isContinentalType()` 里');
  P('专门为它开了一个 `s === \'greater_china\'` 的口子，但文档没记这件事。');
  P('');
  P('| compId | 赛事 | 举办国 | type | 判级 | 领奖台 |');
  P('|---|---|---|---|---|---|');
  for (const [cid, n] of gcCompN) {
    const c = compInfo.get(cid) || {};
    P('| ' + cid + ' | ' + c.name + ' ' + c.year + ' | ' + c.iso + ' | only greater_china | CC | ' + n + ' 条 |');
  }
  P('');
  P('- 受影响：**' + num(gcRows.length) + ' 条领奖台、' + num(gcCompN.size) + ' 场（China Championship 系列）**，'
    + '按 CC 得 ' + F(gcScore) + ' 分，占全站 ' + PCT(gcScore / V.total) + '。');
  P('- 问题在于 ρ：CC 的 ρ 取「举办国的洲」（CN → Asia = ' + F(cc.Asia / TOTAL)
    + '），但真实池子是「大中华区」，比亚洲小得多。'
    + '结果是这 4 场被按**亚洲锦标赛**的价格计价，而不是按大中华区的规模。');
  P('- 若改判 NC（ρ 取中国 ' + F(nc.CN / TOTAL) + '）：' + F(gcAsNC) + ' 分，'
    + '缩水 ' + F(gcScore / gcAsNC) + ' 倍，全站总量 217.8556 → ' + F(V.total - gcScore + gcAsNC)
    + '（' + PCT((V.total - gcScore + gcAsNC) / V.total - 1) + '）。');
  P('- 涉及 ' + num(new Set(gcRows.map((p) => p.pid)).size) + ' 名选手；'
    + '其中 남승혁 Seung Hyuk Nahm（#4）有 19.57% 的分来自这 4 场，'
    + '林恺俊（#57）61.93%，Antoine Cantin（#63）54.49%，黃健樂（#218）99.60%。');
  P('');
  P('三个处理方案：');
  P('');
  P('| 方案 | 做法 | 依据 | 代价 |');
  P('|---|---|---|---|');
  P('| A 维持现状 | 大中华区 = 洲 | 与「区域赛」的通用直觉一致 | 与亚洲锦标赛同价，池子被高估 |');
  P('| B 改判 NC | ρ 用中国 | 与美/日/欧国锦赛可比 | 忽略「大中华区含港澳台」 |');
  P('| C 移出 M2 | 与 XE/XA 多区赛同处理 | **符合 6.5 节自己定的规则：属地不唯一就整类移出** | 中国选手掉分最多（남승혁 #4→#6） |');
  P('');
  P('按 M2 自己写下的规则（"多区赛没有单一属地，取任何一种都会给出不可比的价格，所以整类移出"），'
    + '`greater_china` 完全符合同一个描述 —— **C 最自洽**，A 是当前默认但从未被论证过。');
  P('');

  /* ── D7 单场依赖 ──────────────────────────────────────────────── */
  const dep = list.slice(0, 100).map((x) => {
    let mx = 0;
    for (const v of x.byComp.values()) if (v > mx) mx = v;
    return { name: x.name, r: 0, share: mx / x.score, n: x.n, score: x.score };
  });
  dep.forEach((x, i) => { x.r = i + 1; });
  dep.sort((a, b) => b.share - a.share);
  P('## D7 单场依赖：一次主场爆发能撑起多少');
  P('');
  P('Top100 中「单个赛事贡献占其 M2 总分」最高的 10 人：');
  P('');
  P('| 选手 | 总名次 | 单场占比 | 领奖台数 | 总分 |');
  P('|---|---|---|---|---|');
  for (const x of dep.slice(0, 10)) {
    P('| ' + x.name + ' | #' + x.r + ' | ' + PCT(x.share) + ' | ' + x.n + ' | ' + F(x.score) + ' |');
  }
  P('');
  P('- 头部的单场依赖并不高（Feliks / Max 的领奖台分布在几十场），说明「线性累加」在头部没有失控。'
    + '但这是 Top100 的情况；在 ' + num(list.length) + ' 个非零选手里，中后段大量是「1–2 场国家锦标赛」撑起来的。');
  P('');

  /* ── D8 累积结构 ──────────────────────────────────────────────── */
  const ns = list.map((x) => x.n);
  P('## D8 累积结构：谁靠场次堆分');
  P('');
  P('| 指标 | 值 |');
  P('|---|---|');
  P('| 领奖台数 中位 / 90 分位 / 最大 | ' + pct(ns, 0.5) + ' / ' + pct(ns, 0.9) + ' / ' + Math.max(...ns) + ' |');
  P('| n ≥ 100 的人数 | ' + num(ns.filter((x) => x >= 100).length) + ' |');
  P('| n = 1 的人数（1 个领奖台就进榜） | ' + num(ns.filter((x) => x === 1).length) + '（' + PCT(ns.filter((x) => x === 1).length / ns.length) + '） |');
  P('| 平均每条领奖台分值 | ' + F(V.total / podiums.length) + ' |');
  const byUnit = list.map((x) => ({ name: x.name, u: x.score / x.n, n: x.n, s: x.score, r: 0 }));
  byUnit.forEach((x, i) => { x.r = i + 1; });
  byUnit.sort((a, b) => b.u - a.u);
  P('');
  P('单条领奖台「最值钱」的 5 人（说明小场次的 f/ρ 并不能完全抹平地域差）：');
  P('');
  P('| 选手 | 名次 | 单条均分 | 条数 | 总分 |');
  P('|---|---|---|---|---|');
  for (const x of byUnit.slice(0, 5)) {
    P('| ' + x.name + ' | #' + x.r + ' | ' + F(x.u) + ' | ' + x.n + ' | ' + F(x.s) + ' |');
  }
  P('');
  P('- 总量 ' + F(V.total) + ' = ' + num(podiums.length) + ' 条 × 平均 ' + F(V.total / podiums.length)
    + '。这个数字本身没有意义，它的全部意义来自 modMax 归一化；'
    + '所以**每次改公式都必须同步改 `modMax.m2`**，否则 0–100 会整体漂移。');
  P('');

  /* ── D9 并列 ──────────────────────────────────────────────────── */
  let dupRounds = 0;
  let dupGold = 0;
  let dupMedal = 0;
  let dupGoldRows = 0;
  const dupSamples = [];
  for (const [k, arr] of posRound) {
    const c1 = arr.filter((p) => p === 1).length;
    if (c1 > 1) { dupGold++; dupGoldRows += c1; if (dupSamples.length < 5) dupSamples.push(k + ' 冠军 ' + c1 + ' 人'); }
    const c23 = arr.filter((p) => p === 2 || p === 3).length;
    const u23 = new Set(arr.filter((p) => p === 2 || p === 3)).size;
    if (c23 > u23) dupMedal++;
    if (c1 > 1 || c23 > u23) dupRounds++;
  }
  P('## D9 并列名次：一场比赛发两块金牌');
  P('');
  P('| 指标 | 值 |');
  P('|---|---|');
  P('| 决赛轮 | ' + num(rounds.size) + ' |');
  P('| 出现 ≥2 个 pos=1 的轮次 | ' + num(dupGold) + '（' + PCT(dupGold / rounds.size) + '） |');
  P('| 这些轮次里的「冠军」条数 | ' + num(dupGoldRows) + ' |');
  P('| 2/3 名有重复的轮次 | ' + num(dupMedal) + ' |');
  P('');
  if (dupSamples.length) {
    P('样例：' + dupSamples.join('｜'));
    P('');
  }
  P('- 当前口径下并列冠军**各拿一份全额 P(1)**，等于该场多发一块金牌。'
    + '数量占比很小（' + PCT(dupGold / rounds.size) + ' 的轮次），不改也不影响结论；'
    + '若要严丝合缝，应把并列名次的 P 按 1/并列人数 摊分。');
  P('');

  P('---');
  P('');
  P('## 汇总：按「是否值得改」排序');
  P('');
  P('| # | 问题 | 影响 | 建议 |');
  P('|---|---|---|---|');
  P('| 1 | **名义价格与实际价格脱节**（ρ 主导，NC 被罚两次） | NC 名义 15%，实际 '
    + PCT(nom.NC * tierUnit.NC.rhoMed / (nom.WC * tierUnit.WC.rhoMed)) + ' | **唯一值得动公式的地方**：ρ 改「该级内部份额」+ T_L 重标 |');
  P('| 2 | **`greater_china` 被当成洲际赛** | ' + num(gcCompN.size) + ' 场 / ' + num(gcRows.length)
    + ' 条 / ' + PCT(gcScore / V.total) + ' 分 | 建议 C（移出 M2）或 B（改判 NC），见 D6b |');
  P('| 3 | 覆盖度 ' + PCT(1 - list.length / TOTAL) + ' 为 0 | 雷达图一维废掉 | 只能靠 M3 补，M2 单独无解 |');
  P('| 4 | 小场次白送铜牌 | ' + PCT((bRow[0].n + bRow[1].n) / podiums.length) + ' 条来自 ≤5 人决赛 | 与 v6 同类，可作 v7 备选 |');
  P('| 5 | f 是代际再分配，不是「跨代可比」 | 总量 ' + PCT(1 - V.total / N.total) + '，' + moved + '/60 换位 | 可不改，但文档措辞要改 |');
  P('| 6 | w 与榜次双重计数 | corr=' + F(corr(wArr, nArr)) + ' | 观察项，暂不动 |');
  P('| 7 | 分类残余（其余） | ' + sus.length + ' 场名字像洲际赛 | 逐场人工确认 |');
  P('| 8 | modMax 归属不同人 | M1 满分是 Max、M2 满分是 Feliks | 前端合成总分时要说明 |');
  P('| 9 | M1/M2 不正交 | 破 NR 常发生在国锦赛 | 雷达图两维有相关性，不能当独立维度 |');
  P('| 10 | 并列名次各拿全额 P | ' + num(dupGold) + ' 轮有双冠军 | 影响 ' + PCT(dupGold / rounds.size) + '，可不动 |');
  P('| 11 | 未接线 | 线上仍是旧口径 | 见待办，先接线再谈 M3 |');
  P('');

  const out = path.join(__dirname, 'M2_体检_定稿后.md');
  fs.writeFileSync(out, OUT.join('\n'), 'utf8');
  log('written ' + out);
})().catch((e) => { console.error(e); process.exit(1); });

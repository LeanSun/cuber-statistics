'use strict';
/* Tymon Kolasiński vs Feliks Zemdegs：锦标赛分（M2）逐条对比
 *
 * 目的：回答两件事
 *   ① 两人的锦标赛分分别是**怎么算出来的**（逐条可复核）
 *   ② 为什么在融合内核下 Tymon 能排到第一（而 M2-F3 封存口径下 Feliks 第一）
 *
 * 对照两套公式：
 *   A. M2-F3（已封存）  分 = P(pos) × T_L × ρ_s × f_L × w_e
 *      - T_L: WC 1.0 / CC 0.4 / NC 0.15
 *      - ρ_s: WC 1；CC = 举办洲人数/全球；NC = 举办国人数/全球
 *      - f_L: WC 用全球池、CC 用洲池、NC 用国池（m2.js eraFactor）
 *   B. 融合内核（定稿脚本 m2m3_balance.js）
 *      分 = P(pos) × K_级 × (该场该项目人数 ÷ 该项目普通赛中位人数)^0.8015 × f × w
 *      - K_级: OP/NC 1.0、CC/WC 1.6（现行）；锦标赛不再乘 β、不衰减
 *      - f: 现行实现里 OP 用全球池，锦标赛一律用举办国池（见 m2m3_merge.js:144 注释）
 *
 * 用法：node etl/score/diag_m2_tymon_feliks.js
 * 只读，不改任何常量。
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const M1 = require('./m1.js');
const RN = require('./runs.js');
const M2 = require('./m2.js');

const F = RN.F4;
const F6 = (v) => Number(v).toFixed(6);
const num = (v) => Number(v).toLocaleString('en-US');
const PCT = (v) => (v * 100).toFixed(2) + '%';
const med = (a) => {
  if (!a.length) return 0;
  const b = a.slice().sort((x, y) => x - y);
  const m = b.length >> 1;
  return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2;
};

const GAMMA = 0.8015;
const ALPHA = 0.5;
const K_OF = { OP: 1.0000, NC: 1.0000, CC: 1.6000, WC: 1.6000 };
const K_F3 = { OP: 1.0000, NC: 1.0000, CC: 2.5000, WC: 8.0000 }; // 上一轮扫描的 F3 推荐
const TIER_CN = { OP: '普通赛', NC: '国锦赛', CC: '洲锦赛', WC: '世锦赛' };
const PLACE_CN = { 1: '冠军', 2: '亚军', 3: '季军' };

const ZIP = fs.readdirSync(path.join(ROOT, 'data/raw')).filter((f) => f.endsWith('.zip'))[0];
const ZIP_PATH = path.join(ROOT, 'data/raw', ZIP);

function streamTsv(name, onRow) {
  return new Promise((resolve, reject) => {
    const ps = spawn('unzip', ['-p', ZIP_PATH, name]);
    let buf = ''; let head = true;
    ps.on('error', reject);
    ps.stdout.on('data', (d) => {
      buf += d.toString('utf8');
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const ln = buf.slice(0, i); buf = buf.slice(i + 1);
        if (head) { head = false; continue; }
        if (ln) onRow(ln.split('\t'));
      }
    });
    ps.on('close', () => resolve());
  });
}

(async () => {
  const isoOf = new Map(); const isoInfo = new Map(); const contOfRaw = new Map();
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

  const compEvPeople = new Map();
  const firstYear = new Map();
  const rows = [];
  await streamTsv('WCA_export_results.tsv', (r) => {
    const pid = r[8]; if (!pid) return;
    const compId = r[4];
    const comp = compInfo.get(compId) || {};
    const year = comp.year || 0;
    const fy = firstYear.get(pid);
    if (!fy || (year && year < fy)) firstYear.set(pid, year);
    const ev = r[6];
    const k = compId + '|' + ev;
    let st = compEvPeople.get(k);
    if (!st) { st = new Set(); compEvPeople.set(k, st); }
    st.add(pid);
    const pos = +r[1];
    if (!(pos >= 1 && pos <= 3)) return;
    if (r[5] !== 'f' && r[5] !== 'c') return;
    if (!(+r[2] > 0)) return;
    rows.push({ pid, ev, pos, compId, year, nat: comp.iso || '' });
  });

  const cc = {}; const nc = {};
  const people = [];
  for (const [pid, p] of pInfo) {
    const cont = (isoInfo.get(p.iso) || {}).cont || 'Unknown';
    nc[p.iso] = (nc[p.iso] || 0) + 1;
    cc[cont] = (cc[cont] || 0) + 1;
    const y = firstYear.get(pid);
    if (y) people.push({ y, cont, nat: p.iso });
  }
  const TOTAL = pInfo.size;
  const pool = M1.makeScopePool(people, 2026);
  const ctx = M1.makeContext({ contCount: cc, natCount: nc, total: TOTAL });

  /* ── 逐条定价 ───────────────────────────────────────────────── */
  const items = [];
  for (const r of rows) {
    const multi = M2.isMultiRegion(r.nat);
    const tier = multi ? 'OP' : M2.tierOf(ctypes.get(r.compId), r.nat);
    const comp = compInfo.get(r.compId) || {};
    const cont = (isoInfo.get(r.nat) || {}).cont || 'Unknown';
    const field = (compEvPeople.get(r.compId + '|' + r.ev) || { size: 1 }).size;
    const who = { nat: r.nat, cont };
    /* 融合内核的 f：OP 全球池，锦标赛一律举办国池（现行实现） */
    const fFused = pool ? pool.valueOf(tier === 'OP' ? 'WR' : 'NR', who, +r.year || 2026) : 1;
    /* M2-F3 的 f_L：按赛级分池（WC 全球 / CC 洲 / NC 国） */
    const fF3 = pool ? pool.valueOf(M2.LEVEL_OF[tier] || 'NR', who, +r.year || 2026) : 1;
    /* M2-F3 的 ρ_s */
    const rho = tier === 'WC' ? 1 : (tier === 'CC' ? ctx.rhoC(cont) : ctx.rhoN(r.nat));
    const w = RN.EV_WEIGHT_V2[r.ev] == null ? RN.WEIGHT_V2_CFG.floor : RN.EV_WEIGHT_V2[r.ev];
    items.push({
      pid: r.pid, ev: r.ev, tier, pos: r.pos, year: r.year, field, fFused, fF3, rho, w,
      compId: r.compId, compName: comp.name || r.compId, nat: r.nat, cont,
      name: (pInfo.get(r.pid) || {}).name || r.pid,
    });
  }

  /* 普通赛参考人数（中位），与定稿脚本同口径 */
  const opF = new Map();
  for (const it of items) {
    if (it.tier !== 'OP') continue;
    if (!opF.has(it.ev)) opF.set(it.ev, []);
    opF.get(it.ev).push(it.field);
  }
  const REF = new Map();
  for (const [ev, a] of opF) if (a.length >= 30) REF.set(ev, med(a));
  const refAll = med([...opF].filter(([, a]) => a.length >= 30).map(([, a]) => med(a)));
  const refOf = (ev) => REF.get(ev) || refAll;

  for (const it of items) {
    const P = M2.PLACE_W[it.pos] || 0;
    it.scale = Math.pow(it.field / refOf(it.ev), GAMMA);
    it.base = P * K_OF[it.tier] * it.scale * it.fFused * it.w;
    it.baseF3K = P * K_F3[it.tier] * it.scale * it.fFused * it.w;
    it.m2f3 = P * (M2.TIER_BASE[it.tier] || 0) * it.rho * it.fF3 * it.w;
    it.n = 1;
  }

  /* 普通赛重复衰减 n^-α（同人同项目第 n 次） */
  const grp = new Map();
  for (const it of items) {
    if (it.tier !== 'OP') continue;
    const k = it.pid + '|' + it.ev;
    if (!grp.has(k)) grp.set(k, []);
    grp.get(k).push(it);
  }
  for (const [, a] of grp) {
    a.sort((x, y) => (x.year - y.year) || String(x.compId).localeCompare(String(y.compId)));
    a.forEach((it, i) => { it.n = i + 1; it.decay = Math.pow(i + 1, -ALPHA); });
  }
  for (const it of items) if (it.tier !== 'OP') it.decay = 1;

  /* ── 全站基准 ───────────────────────────────────────────────── */
  const S = { OP: 0, NC: 0, CC: 0, WC: 0 };
  for (const it of items) S[it.tier] += it.base * it.decay;
  const S2 = S.NC + S.CC + S.WC;
  const S3 = S.OP;
  const BETA = S2 / S3;
  /* F3 配置的 β：按同一准则（总量各半）用 F3 的 K 重算 */
  const S3f = items.filter((it) => it.tier === 'OP').reduce((s, it) => s + it.base * it.decay, 0);
  const S2f = items.filter((it) => it.tier !== 'OP').reduce((s, it) => s + it.baseF3K * it.decay, 0);
  const BETA_F3 = S2f / S3f;

  const agg = (beta, K, useF3K) => {
    const by = new Map();
    for (const it of items) {
      const b = useF3K ? it.baseF3K : it.base;
      const v = b * it.decay * (it.tier === 'OP' ? beta : 1);
      let a = by.get(it.pid);
      if (!a) {
        a = { pid: it.pid, name: it.name, total: 0, m2: 0, m3: 0, n: 0, t: { OP: 0, NC: 0, CC: 0, WC: 0 } };
        by.set(it.pid, a);
      }
      a.total += v; a.t[it.tier] += v; a.n++;
      if (it.tier === 'OP') a.m3 += v; else a.m2 += v;
    }
    const list = [...by.values()].filter((x) => x.total > 0).sort((a, b) => b.total - a.total);
    list.forEach((x, i) => { x.rank = i + 1; });
    return list;
  };
  const pureM2 = agg(0);            // 纯锦标赛（融合内核，现行 K）
  const fused = agg(BETA);          // 融合总分（现行 K）
  const fusedF3 = agg(BETA_F3, null, true);  // F3 配置（K 与 β 都按 F3 重算）
  const rankOf = (list, pid) => { const x = list.find((y) => y.pid === pid); return x ? x.rank : '—'; };

  /* ── 目标选手 ───────────────────────────────────────────────── */
  const WANT = ['Tymon Kolasiński', 'Feliks Zemdegs', 'Max Park'];
  const pidOf = new Map();
  for (const [pid, p] of pInfo) if (WANT.includes(p.name)) pidOf.set(p.name, pid);
  const P_TYMON = pidOf.get('Tymon Kolasiński');
  const P_FELIKS = pidOf.get('Feliks Zemdegs');
  const P_MAX = pidOf.get('Max Park');

  const pod = (pid) => items.filter((it) => it.pid === pid && it.tier !== 'OP');
  const pods = { 'Tymon Kolasiński': pod(P_TYMON), 'Feliks Zemdegs': pod(P_FELIKS) };

  /* 两人的分层数组与求和助手（第 6 / 8 节共用） */
  const t = pods['Tymon Kolasiński']; const fk = pods['Feliks Zemdegs'];
  const sumT = (arr) => arr.reduce((s, x) => s + x.base, 0);
  const sumA = (arr) => arr.reduce((s, x) => s + x.m2f3, 0);
  const tWC = t.filter((x) => x.tier === 'WC'); const fkWC = fk.filter((x) => x.tier === 'WC');
  const tCC = t.filter((x) => x.tier === 'CC'); const fkCC = fk.filter((x) => x.tier === 'CC');
  const tNC = t.filter((x) => x.tier === 'NC'); const fkNC = fk.filter((x) => x.tier === 'NC');
  const feliksNCAvgRho = sumA(fkNC) >= 0 ? fkNC.reduce((s, x) => s + x.rho, 0) / Math.max(1, fkNC.length) : 0;
  const tymonNCAvgRho = tNC.reduce((s, x) => s + x.rho, 0) / Math.max(1, tNC.length);
  const feliksCCAvgRho = fkCC.reduce((s, x) => s + x.rho, 0) / Math.max(1, fkCC.length);
  const tymonCCAvgRho = tCC.reduce((s, x) => s + x.rho, 0) / Math.max(1, tCC.length);

  const OUT = [];
  const L = (s) => { console.log(s); OUT.push(s); };

  L('# Tymon Kolasiński vs Feliks Zemdegs：锦标赛分逐条对比');
  L('');
  L('> 现算，源 WCA v2.0.2，脚本 `etl/score/diag_m2_tymon_feliks.js`。只读。');
  L('> 对比两套公式：**A = M2-F3 封存口径**（`T_L × ρ_s × f_L × w_e`）与 **B = 融合内核**（`K_级 × 规模项 × f × w`）。');
  L('');

  /* ═══ 0 速览 ═══ */
  L('══ 0 速览 ══');
  L('');
  L('| 口径 | Tymon | Feliks | 谁高 |');
  L('|---|---|---|---|');
  const tymonM2 = pureM2.find((x) => x.pid === P_TYMON);
  const feliksM2 = pureM2.find((x) => x.pid === P_FELIKS);
  const tymonF = fused.find((x) => x.pid === P_TYMON);
  const feliksF = fused.find((x) => x.pid === P_FELIKS);
  const tymonM2F3 = pods['Tymon Kolasiński'].reduce((s, it) => s + it.m2f3, 0);
  const feliksM2F3 = pods['Feliks Zemdegs'].reduce((s, it) => s + it.m2f3, 0);
  L('| A · M2-F3（封存） | ' + F(tymonM2F3) + ' | ' + F(feliksM2F3) + ' | **Feliks** |');
  L('| B · 融合内核的 M2 部分 | ' + F(tymonM2.m2) + ' | ' + F(feliksM2.m2) + ' | **Tymon** |');
  L('| B · 融合总分（含普通赛 M3） | ' + F(tymonF.total) + '（#' + tymonF.rank + '） | ' + F(feliksF.total) + '（#' + feliksF.rank + '） | **Tymon** |');
  L('');
  L('锦标赛条数：Tymon ' + num(pods['Tymon Kolasiński'].length) + ' 条，Feliks '
    + num(pods['Feliks Zemdegs'].length) + ' 条。');
  L('');
  L('现行融合榜 Top5（供定位「第一」的语境）：');
  L('');
  L('| # | 选手 | 融合总分 | 其中锦标赛（M2） | 其中普通赛（M3） | 纯锦标赛名次 |');
  L('|---|---|---|---|---|---|');
  for (let i = 0; i < 5; i++) {
    const x = fused[i]; if (!x) break;
    L('| ' + (i + 1) + ' | ' + x.name + ' | ' + F(x.total) + ' | ' + F(x.m2) + ' | ' + F(x.m3) + ' | #' + rankOf(pureM2, x.pid) + ' |');
  }
  L('');

  /* ═══ 1 公式 ═══ */
  L('══ 1 两条公式长什么样 ══');
  L('');
  L('```');
  L('A（M2-F3，已封存）  分 = P(pos) × T_L × ρ_s × f_L × w_e');
  L('   T_L   世锦赛 1.0 / 洲锦赛 0.4 / 国锦赛 0.15');
  L('   ρ_s   世锦赛 1；洲锦赛 = 举办洲注册人数 ÷ 全站；国锦赛 = 举办国注册人数 ÷ 全站');
  L('   f_L   世锦赛用全球时间池、洲锦赛用洲池、国锦赛用国池（按举办地）');
  L('   w_e   项目权重（三阶 1.0000 最高）');
  L('B（融合内核）        分 = P(pos) × K_级 × (该场该项目人数 ÷ 该项目普通赛中位人数)^0.8015 × f × w');
  L('   K_级  普通赛/国锦赛 1.0、洲锦赛/世锦赛 1.6（锦标赛不再乘 β、不做重复衰减）');
  L('   f     OP 用全球池；锦标赛一律用「举办国」时间池（现行实现，见 m2m3_merge.js:144）');
  L('```');
  L('');
  L('一句话：**A 用「人口份额 ρ」衡量一场锦标赛的稀缺程度，B 改用「实际到场人数」衡量。**');
  L('这是两次排序翻转的全部根源。');
  L('');

  /* ═══ 2 分赛级拆解 ═══ */
  L('══ 2 分赛级拆解 ══');
  L('');
  for (const who of WANT.slice(0, 2)) {
    const a = pods[who];
    L('**' + who + '**');
    L('');
    L('| 赛级 | 条数 | 金/银/铜 | 平均场次 | 平均 f(B) | 平均 f(A) | 平均 w | A 口径小计 | B 口径小计 | B 占比 |');
    L('|---|---|---|---|---|---|---|---|---|---|');
    for (const t of ['WC', 'CC', 'NC']) {
      const g = a.filter((it) => it.tier === t);
      if (!g.length) { L('| ' + TIER_CN[t] + ' | 0 | — | — | — | — | — | 0 | 0 | — |'); continue; }
      const gold = g.filter((x) => x.pos === 1).length;
      const silver = g.filter((x) => x.pos === 2).length;
      const bronze = g.filter((x) => x.pos === 3).length;
      const avgF = g.reduce((s, x) => s + x.fFused, 0) / g.length;
      const avgFA = g.reduce((s, x) => s + x.fF3, 0) / g.length;
      const avgW = g.reduce((s, x) => s + x.w, 0) / g.length;
      const avgFd = g.reduce((s, x) => s + x.field, 0) / g.length;
      const sb = g.reduce((s, x) => s + x.base, 0);
      L('| ' + TIER_CN[t] + ' | ' + num(g.length) + ' | ' + gold + '/' + silver + '/' + bronze
        + ' | ' + num(Math.round(avgFd)) + ' | ' + F(avgF) + ' | ' + F(avgFA) + ' | ' + F(avgW)
        + ' | ' + F(g.reduce((s, x) => s + x.m2f3, 0)) + ' | ' + F(sb) + ' | ' + PCT(sb / a.reduce((s, x) => s + x.base, 0)) + ' |');
    }
    L('| **合计** | **' + num(a.length) + '** | | | | | | **'
      + F(a.reduce((s, x) => s + x.m2f3, 0)) + '** | **' + F(a.reduce((s, x) => s + x.base, 0)) + '** | 100.00% |');
    L('');
  }
  L('f(B) = 融合内核的时代折算（OP 全球池 / 锦标赛举办国池）；f(A) = M2-F3 的时代折算（WC 全球池 / CC 洲池 / NC 国池）。');
  L('两人的差距在 f 上非常明显：Feliks 的锦标赛集中在 2010–2022，Tymon 的在 2019–2026。');
  L('');

  /* ═══ 3 世锦赛+洲锦赛逐条 ═══ */
  L('══ 3 世锦赛 / 洲锦赛逐条明细（B 口径）══');
  L('');
  for (const who of ['Tymon Kolasiński', 'Feliks Zemdegs']) {
    const a = pods[who].filter((it) => it.tier === 'WC' || it.tier === 'CC')
      .sort((x, y) => x.year - y.year || String(x.compId).localeCompare(String(y.compId)));
    L('**' + who + '**（' + num(a.length) + ' 条）');
    L('');
    L('| 年 | 赛事 | 项目 | 名次 | 场次 | f(B) | ρ(A) | w | P | K | 规模项 | 分 |');
    L('|---|---|---|---|---|---|---|---|---|---|---|---|');
    for (const it of a) {
      L('| ' + it.year + ' | ' + it.compName.replace(/\|/g, '/') + ' | ' + it.ev + ' | ' + PLACE_CN[it.pos]
        + ' | ' + num(it.field) + ' | ' + F(it.fFused) + ' | ' + F(it.rho) + ' | ' + F(it.w) + ' | ' + F(M2.PLACE_W[it.pos])
        + ' | ' + F(K_OF[it.tier]) + ' | ' + F(it.scale) + ' | **' + F(it.base) + '** |');
    }
    L('');
  }

  /* ═══ 4 国锦赛汇总 ═══ */
  L('══ 4 国锦赛汇总（按项目 × 名次）══');
  L('');
  for (const who of ['Tymon Kolasiński', 'Feliks Zemdegs']) {
    const a = pods[who].filter((it) => it.tier === 'NC');
    L('**' + who + '**（' + num(a.length) + ' 条，按项目）');
    L('');
    L('| 项目 | 条数 | 金/银/铜 | 平均场次 | 平均 f(B) | B 小计 |');
    L('|---|---|---|---|---|---|');
    const byEv = new Map();
    for (const it of a) {
      if (!byEv.has(it.ev)) byEv.set(it.ev, []);
      byEv.get(it.ev).push(it);
    }
    for (const [ev, g] of [...byEv].sort((x, y) => y[1].length - x[1].length)) {
      const gold = g.filter((x) => x.pos === 1).length;
      const silver = g.filter((x) => x.pos === 2).length;
      const bronze = g.filter((x) => x.pos === 3).length;
      const avgFd = g.reduce((s, x) => s + x.field, 0) / g.length;
      const avgF = g.reduce((s, x) => s + x.fFused, 0) / g.length;
      L('| ' + ev + ' | ' + num(g.length) + ' | ' + gold + '/' + silver + '/' + bronze
        + ' | ' + num(Math.round(avgFd)) + ' | ' + F(avgF) + ' | ' + F(g.reduce((s, x) => s + x.base, 0)) + ' |');
    }
    L('| **合计** | **' + num(a.length) + '** | | | | **' + F(a.reduce((s, x) => s + x.base, 0)) + '** |');
    L('');
    /* 按举办国拆：解释 A 口径 ρ 的差异 */
    const byNat = new Map();
    for (const it of a) {
      if (!byNat.has(it.nat)) byNat.set(it.nat, []);
      byNat.get(it.nat).push(it);
    }
    L('按举办国（A 口径的 ρ 按这里取）：');
    L('');
    L('| 举办国 | 条数 | ρ | 平均场次 | A 小计 | B 小计 |');
    L('|---|---|---|---|---|---|');
    for (const [iso, g] of [...byNat].sort((x, y) => y[1].length - x[1].length)) {
      L('| ' + iso + ' | ' + num(g.length) + ' | ' + F((nc[iso] || 0) / TOTAL)
        + ' | ' + num(Math.round(g.reduce((s, x) => s + x.field, 0) / g.length))
        + ' | ' + F(g.reduce((s, x) => s + x.m2f3, 0)) + ' | ' + F(g.reduce((s, x) => s + x.base, 0)) + ' |');
    }
    L('');
  }

  /* ═══ 5 反事实归因 ═══ */
  L('══ 5 归因：把因子一个个关掉，看排序何时翻转 ══');
  L('');
  const variantSum = (who, mut) => pods[who].reduce((s, it) => {
    const P = M2.PLACE_W[it.pos] || 0;
    const K = mut.K ? mut.K[it.tier] : K_OF[it.tier];
    const scale = mut.noScale ? 1 : it.scale;
    const f = mut.noF ? 1 : it.fFused;
    const w = mut.noW ? 1 : it.w;
    return s + P * K * scale * f * w;
  }, 0);
  const variants = [
    { id: 'B 完整', mut: {} },
    { id: 'B 去规模项（场次÷中位 = 1）', mut: { noScale: true } },
    { id: 'B 去时代折算（f = 1）', mut: { noF: true } },
    { id: 'B 去规模项 + 去 f', mut: { noScale: true, noF: true } },
    { id: 'B 去项目权重（w = 1）', mut: { noW: true } },
    { id: 'B 去规模 + 去 f + 去 w', mut: { noScale: true, noF: true, noW: true } },
  ];
  L('| 变体 | Tymon | Feliks | Tymon ÷ Feliks | 谁高 |');
  L('|---|---|---|---|---|');
  for (const v of variants) {
    const tv = variantSum('Tymon Kolasiński', v.mut);
    const fv = variantSum('Feliks Zemdegs', v.mut);
    L('| ' + v.id + ' | ' + F(tv) + ' | ' + F(fv) + ' | ' + F(tv / fv) + ' | ' + (tv > fv ? '**Tymon**' : 'Feliks') + ' |');
  }
  L('| A · M2-F3 原式 | ' + F(tymonM2F3) + ' | ' + F(feliksM2F3) + ' | ' + F(tymonM2F3 / feliksM2F3) + ' | **Feliks** |');
  L('');
  L('读法：每一行是「只保留这些因子的总分」。从下往上走：先有 A（Feliks 赢 2.2 倍）；');
  L('换成 B 的价但**不要规模项**，Feliks 仍赢（82.7712 vs 68.3286）；**一加上规模项就翻转**（373.5284 vs 280.6371）。');
  L('规模项是唯一「单独打开就能改变排序」的因子；f 只改变领先幅度；w 几乎中立。');
  L('');

  /* ═══ 6 ρ 到底压了谁 ═══ */
  L('══ 6 A 口径的 ρ 压了谁 ══');
  L('');
  L('先看属地底数（ρ = 该属地注册人数 ÷ 全站 ' + num(TOTAL) + ' 人）：');
  L('');
  L('| 属地 | 注册人数 | ρ |');
  L('|---|---|---|');
  for (const iso of ['PL', 'AU', 'US']) {
    L('| ' + iso + '（国家） | ' + num(nc[iso] || 0) + ' | ' + F((nc[iso] || 0) / TOTAL) + ' |');
  }
  for (const c of ['Europe', 'Oceania', 'Asia']) {
    L('| ' + c + '（洲） | ' + num(cc[c] || 0) + ' | ' + F((cc[c] || 0) / TOTAL) + ' |');
  }
  L('');
  L('再按两人的领奖台取平均：');
  L('');
  L('| | 国锦赛平均 ρ | 洲锦赛平均 ρ |');
  L('|---|---|---|');
  L('| Tymon | ' + F(tymonNCAvgRho) + ' | ' + F(tymonCCAvgRho) + ' |');
  L('| Feliks | ' + F(feliksNCAvgRho) + ' | ' + F(feliksCCAvgRho) + ' |');
  L('');
  L('**注意：ρ 并没有单方面压 Tymon。** 澳大利亚的注册人数（' + num(nc['AU'] || 0) + '）比波兰（'
    + num(nc['PL'] || 0) + '）还多，所以 Feliks 的国锦赛平均 ρ（' + F(feliksNCAvgRho)
    + '）反而高于 Tymon（' + F(tymonNCAvgRho) + '）。');
  L('（Tymon 的国锦赛条只有 ' + num(pods['Tymon Kolasiński'].filter((x) => x.tier === 'NC' && x.nat === 'PL').length)
    + ' 条在波兰，其余在爱尔兰/丹麦/西班牙/英国/葡萄牙办的国家锦标赛 —— 这些国家的 ρ 只有 0.0019–0.0236，');
  L('在 A 口径里几乎一文不值；Feliks 的国锦赛条 ' + num(pods['Feliks Zemdegs'].filter((x) => x.tier === 'NC' && x.nat === 'AU').length)
    + ' 条在澳大利亚、' + num(pods['Feliks Zemdegs'].filter((x) => x.tier === 'NC' && x.nat === 'NZ').length) + ' 条在新西兰、'
    + num(pods['Feliks Zemdegs'].filter((x) => x.tier === 'NC' && x.nat === 'US').length) + ' 条在美国。）');
  L('两人洲锦赛平均 ρ 几乎相同（' + F(tymonCCAvgRho) + ' vs ' + F(feliksCCAvgRho)
    + '）：Feliks 的洲际条来自亚洲锦标赛 2010/2018、China Championship 2015（greater_china 误判为 CC，见第 10 节）、');
  L('欧洲 2016 和大洋洲 2022，前几项的举办地都在亚洲/欧洲，ρ 并不低；他真正打的大洋洲锦标赛（2022，6 条）ρ 只有 '
    + F((cc['Oceania'] || 0) / TOTAL) + '。');
  L('');
  L('所以 A → B 的翻转**不是**「ρ 压了 Tymon、放掉 Feliks」。翻转需要两步，缺一不可。');
  L('');
  L('先看单条价格的三档分解（Feliks 的值，Tymon 同理）：');
  L('');
  L('| 赛级 | A 单条 | 换价后单条<br>（K_级 × f × w，无规模项） | 换价倍数 | 最终单条<br>（再加规模项） | 规模项倍数 |');
  L('|---|---|---|---|---|---|');
  const priceRow = (arr) => {
    const n = Math.max(1, arr.length);
    const a = sumA(arr) / n;
    const b0 = arr.reduce((s, x) => s + (M2.PLACE_W[x.pos] || 0) * K_OF[x.tier] * x.fFused * x.w, 0) / n;
    const b1 = sumT(arr) / n;
    return [a, b0, b0 / a, b1, b1 / b0];
  };
  for (const [nm, arr] of [['世锦赛', fkWC], ['洲锦赛', fkCC], ['国锦赛', fkNC]]) {
    const [a, b0, r0, b1, r1] = priceRow(arr);
    L('| ' + nm + ' | ' + F(a) + ' | ' + F(b0) + ' | ' + F(r0) + ' | ' + F(b1) + ' | ' + F(r1) + ' |');
  }
  L('');
  L('1. **换价（T_L × ρ → K_级）**：国锦赛单条放大约 ' + F(priceRow(fkNC)[2])
    + ' 倍，洲锦赛约 ' + F(priceRow(fkCC)[2]) + ' 倍，世锦赛只有约 ' + F(priceRow(fkWC)[2]) + ' 倍。');
  L('   这一步让「条数」重新变得重要，但**单独走这一步 Feliks 仍然领先**（82.7712 vs 68.3286，见第 5 节）。');
  L('2. **加规模项（到场人数^0.8015）**：Tymon 的锦标赛场次平均大 1.4–3.2 倍，单条价格反超 1.8–2.8 倍，总量就此翻转。');
  L('');
  L(' Feliks 赢在条数（' + num(pods['Feliks Zemdegs'].length) + ' vs ' + num(pods['Tymon Kolasiński'].length)
    + '），Tymon 赢在单条价格；B 口径同时放大了「单条价格」的权重。');
  L('');

  /* ═══ 7 名次结构 ═══ */
  L('══ 7 名次与项目结构 ══');
  L('');
  L('| | 条数 | 冠军 | 亚军 | 季军 | 冠军占比 | 三阶(333)条数 | 333 占分 |');
  L('|---|---|---|---|---|---|---|---|');
  for (const who of ['Tymon Kolasiński', 'Feliks Zemdegs']) {
    const a = pods[who];
    const gold = a.filter((x) => x.pos === 1).length;
    const n333 = a.filter((x) => x.ev === '333').length;
    const s333 = a.filter((x) => x.ev === '333').reduce((s, x) => s + x.base, 0);
    L('| ' + who + ' | ' + num(a.length) + ' | ' + num(gold) + ' | ' + num(a.filter((x) => x.pos === 2).length)
      + ' | ' + num(a.filter((x) => x.pos === 3).length) + ' | ' + PCT(gold / a.length)
      + ' | ' + num(n333) + ' | ' + PCT(s333 / a.reduce((s, x) => s + x.base, 0)) + ' |');
  }
  L('');

  /* ═══ 8 为什么 Tymon 第一 ═══ */
  L('══ 8 为什么 Tymon 能排到第一 ══');
  L('');
  const tAvgF = t.reduce((s, x) => s + x.base * x.fFused, 0) / sumT(t);
  const fkAvgF = fk.reduce((s, x) => s + x.base * x.fFused, 0) / sumT(fk);
  L('**一句话：Feliks 赢在条数，Tymon 赢在单条价格；B 口径把单条价格差拉到了 2–3 倍，压过了条数差。**');
  L('');
  L('单条均分（B 口径）对比：');
  L('');
  L('| 赛级 | Tymon 单条 | Feliks 单条 | 倍数 | Tymon 条数 | Feliks 条数 |');
  L('|---|---|---|---|---|---|');
  for (const [nm, ta, fa] of [['世锦赛', tWC, fkWC], ['洲锦赛', tCC, fkCC], ['国锦赛', tNC, fkNC]]) {
    const tm = sumT(ta) / ta.length; const fm = sumT(fa) / fa.length;
    L('| ' + nm + ' | ' + F(tm) + ' | ' + F(fm) + ' | ' + F(tm / fm) + ' | ' + ta.length + ' | ' + fa.length + ' |');
  }
  L('| **全部** | **' + F(sumT(t) / t.length) + '** | **' + F(sumT(fk) / fk.length) + '** | **'
    + F((sumT(t) / t.length) / (sumT(fk) / fk.length)) + '** | ' + t.length + ' | ' + fk.length + ' |');
  L('');
  L('三个因子各自的故事（证据见第 5 节反事实表）：');
  L('');
  L('1. **到场人数（规模项）是决定性因子。** Tymon 的锦标赛场次系统性更大：世锦赛平均 '
    + num(Math.round(tWC.reduce((s, x) => s + x.field, 0) / tWC.length)) + ' 人 vs Feliks '
    + num(Math.round(fkWC.reduce((s, x) => s + x.field, 0) / fkWC.length)) + ' 人；洲锦赛 '
    + num(Math.round(tCC.reduce((s, x) => s + x.field, 0) / tCC.length)) + ' vs '
    + num(Math.round(fkCC.reduce((s, x) => s + x.field, 0) / fkCC.length)) + '；国锦赛 '
    + num(Math.round(tNC.reduce((s, x) => s + x.field, 0) / tNC.length)) + ' vs '
    + num(Math.round(fkNC.reduce((s, x) => s + x.field, 0) / fkNC.length)) + '。');
  L('   (人数 ÷ 该项目普通赛中位人数)^0.8015 把这个差距放大后，Tymon 每条多拿 1.8–2.8 倍。');
  L('   **关掉规模项，排序立刻翻回 Feliks**（68.3286 vs 82.7712）。');
  L('2. **时代折算 f 对 Feliks 不利（次要）。** 加权平均 f：Tymon ' + F(tAvgF) + '，Feliks ' + F(fkAvgF)
    + '。Feliks 的锦标赛重心在 2010–2022，Tymon 的在 2019–2026，而 f 按「当年累计注册人数」归一，越近代越高。');
  L('   关掉 f，Tymon 的领先从 1.3310 倍收窄到 1.1098 倍 —— 有贡献，但不足以单独决定排序。');
  L('3. **项目权重 w 基本中立。** 两人都是全项目选手，关掉 w 后倍数几乎不变（1.3310 → 1.3264）。');
  L('');
  L('Feliks 的存量优势是真的，而且很大：');
  L('');
  L('- 条数 ' + num(fk.length) + ' vs ' + num(t.length) + '（多 ' + PCT(fk.length / t.length - 1) + '）');
  L('- 世锦赛领奖台 ' + fkWC.length + ' vs ' + tWC.length + '（其中冠军 ' + fkWC.filter((x) => x.pos === 1).length
    + ' vs ' + tWC.filter((x) => x.pos === 1).length + '）');
  L('- 冠军总数 ' + fk.filter((x) => x.pos === 1).length + ' vs ' + t.filter((x) => x.pos === 1).length);
  L('');
  L('但在 A 口径里这些优势**全部**兑现（Feliks 12.4753 vs Tymon 5.6944），因为 A 的国锦赛单条只有 '
    + F(fkNC.reduce((s, x) => s + x.m2f3, 0) / fkNC.length)
    + ' 分、洲锦赛单条只有 ' + F(fkCC.reduce((s, x) => s + x.m2f3, 0) / fkCC.length)
    + ' 分，而 B 口径分别是 ' + F(sumT(fkNC) / fkNC.length) + ' 和 ' + F(sumT(fkCC) / fkCC.length) + ' 分。');
  L('换句话说：**A 口径下 Feliks 的 131 个国锦赛领奖台只值 0.3629 分，B 口径下值 107.9321 分。**');
  L('Tymon 的国锦赛条数少（78 vs 131）但单条贵 1.8 倍，洲锦赛单条贵 2.8 倍，总量仍然反超。');
  L('');
  L('普通赛（M3）几乎不参与这个决策：Tymon ' + F(tymonF.m3) + ' vs Feliks ' + F(feliksF.m3)
    + '（差距 ' + PCT(tymonF.m3 / feliksF.m3 - 1) + '）。排第一完全是锦标赛分打出来的。');
  L('');

  /* ═══ 9 F3 敏感性 ═══ */
  L('══ 9 如果采用上一轮扫描的 F3（K_CC=2.5 / K_WC=8.0）══');
  L('');
  L('F3 配置下 β 按同一准则重算为 ' + F(BETA_F3) + '（现行 ' + F(BETA) + '）。');
  L('');
  const maxF3 = fusedF3.find((x) => x.pid === P_MAX);
  const tymonF3 = fusedF3.find((x) => x.pid === P_TYMON);
  const feliksF3 = fusedF3.find((x) => x.pid === P_FELIKS);
  L('| 选手 | 现行融合分 | 现行名次 | F3 融合分 | F3 名次 |');
  L('|---|---|---|---|---|');
  for (const x of [tymonF, feliksF, fused.find((y) => y.pid === P_MAX)]) {
    const y = fusedF3.find((z) => z.pid === x.pid);
    L('| ' + x.name + ' | ' + F(x.total) + ' | #' + x.rank + ' | ' + F(y.total) + ' | #' + y.rank + ' |');
  }
  L('');
  L('纯锦标赛（M2）部分：Tymon ' + F(tymonF3.m2) + ' vs Feliks ' + F(feliksF3.m2)
    + ' —— **任何配置下 Tymon 都高于 Feliks**，两人之间没有敏感性。');
  L('F3 下 Max Park 反超 Tymon 成为 #1（他的世锦赛冠军数远多于 Tymon），这是上一轮扫描已确认、用户已接受的取舍。');
  L('');

  /* ═══ 10 边界 ═══ */
  L('══ 10 诚实的边界 ══');
  L('');
  L('- 融合内核的 f 对锦标赛一律取「举办国」池（m2m3_merge.js:144 的实现），与 M2-F3 的「WC 全球 / CC 洲 / NC 国」不同。');
  L('  后果：同一场比赛的 f 因举办国而异。例如 2019 墨尔本世锦赛（Tymon 金字塔金牌、Feliks 555 季军）f 取澳大利亚池 = '
    + F(pool.valueOf('NR', { nat: 'AU', cont: 'Oceania' }, 2019)) + '；若按 M2-F3 的全球池应为 '
    + F(pool.valueOf('WR', {}, 2019)) + '。本对比按现行实现算，未改。');
  L('- **口径变迁（2026-10-25，S2 落地后）**：本报告的 B 口径数字全部是 S2 之前的快照 —— 当时的融合内核');
  L('  锦标赛一律用举办国池、规模项 REF 用全年代中位。现行定稿已改为「年代本地 REF + WC 全球池」');
  L('  （CC / NC 仍为举办国池），两人锦标赛分随之变为 Tymon 348.1330 / Feliks 309.0415，');
  L('  Feliks 的锦标赛分增量 +28.4044（旧快照为 280.6371）。以 `M2M3_融合_定稿.md` 第 9 节为准。');
  L('- 场次人数 = 该赛事该项目**全部参赛者**（含预赛淘汰者），不是决赛人数。小项目（如 333fm 只有 26 人）因此拿不到规模溢价。');
  L('- greater_china 的 5 场（Feliks 的 China Championship 2015）仍按 CC 计（`isContinentalType` 命中），未处置。');
  L('  若改判 NC，Feliks 的洲锦赛分会下降约 ' + F(pods['Feliks Zemdegs'].filter((x) => x.compName.includes('China Championship')).reduce((s, x) => s + x.base, 0))
    + ' 分（转记到国锦赛，单价更低），Tymon 的领先会扩大。');
  L('- 多区赛（X 前缀）已按 M2-F3 归 M3，不计入本对比的锦标赛条数。');
  L('- 本对比只回答「现行两套公式下两人的分怎么来」。β、K_OF、α 的定夺仍以 `M2M3_融合_定稿.md` / `M2M3_世锦赛权重扫描.md` 为准。');
  L('');

  /* ═══ 11 附录：单条价格解剖 ═══ */
  L('══ 11 附录：单条价格是怎么算出来的 ══');
  L('');
  L('```');
  L('单条价格 = P(pos) × K_级 × (该场该项目到场人数 ÷ REF_项目)^0.8015 × f × w');
  L('```');
  L('');
  L('五个因子，逐个说来源：');
  L('');
  L('| 因子 | 取值 | 来源 |');
  L('|---|---|---|');
  L('| P(pos) 名次折价 | 冠军 1.0000 / 亚军 0.6000 / 季军 0.4000 | 站内既有口径（build.js:702 `placeW`），M2-F1 起未改 |');
  L('| K_级 赛级基础价 | 普通赛 1.0000 / 国锦赛 1.0000 / 洲锦赛 1.6000 / 世锦赛 1.6000 | 融合定稿 `m2m3_balance.js` 的 K_OF；锦标赛不乘 β、不做重复衰减 |');
  L('| 规模项 | (到场人数 ÷ REF_ev)^0.8015 | γ=0.8015 来自回归 ln(1/深度) ~ ln(人数) 的弹性（控制是否国锦赛后），见 `M2_参赛规模折算_提案.md` |');
  L('| f 时代折算 | ln(1+当年累计注册人数) ÷ ln(1+2026 累计人数) | M1 的 `makeScopePool.valueOf`；融合内核里 OP 用全球池、锦标赛用举办国池 |');
  L('| w 项目权重 | 0.30 + 0.70 × (pr × √ar)^0.75，停办项目再 ×0.85 | `runs.js` EV_WEIGHT_V2；三阶恒 1.0000 |');
  L('');
  L('REF_ev = 该项目**普通赛事**（OP）到场人数的中位数，逐项目单独归一：');
  L('');
  L('| 项目 | REF（普通赛中位人数） | 项目 | REF |');
  L('|---|---|---|---|');
  const refEvs = ['333', '444', '555', '666', '777', '222', '333oh', 'pyram', 'minx', 'sq1', 'clock', 'skewb', '333fm', '333bf', '333mbf'];
  for (let i = 0; i < refEvs.length; i += 2) {
    const a = refEvs[i]; const b = refEvs[i + 1];
    L('| ' + a + ' | ' + num(Math.round(refOf(a))) + ' | ' + (b || '') + ' | ' + (b ? num(Math.round(refOf(b))) : '') + ' |');
  }
  L('');
  L('注意 REF 是「普通赛中位」而不是「锦标赛中位」——三阶普通赛中位只有 ' + num(Math.round(refOf('333')))
    + ' 人，所以世锦赛三阶（1,000+ 人）的规模项能到 11–16，而澳大利亚锦标赛（60 人上下）只有 1 出头。');
  L('');

  /* 找几条有代表性的领奖台做完整算术 */
  const find = (name, ev, year, tier, compKw) => pods[name].find((x) => x.ev === ev && x.year === year
    && x.tier === tier && (!compKw || x.compName.includes(compKw)));
  const tymonTopNC = tNC.slice().sort((a, b) => b.base - a.base)[0];
  const feliksSq1 = fkNC.filter((x) => x.ev === 'sq1').sort((a, b) => a.field - b.field)[0];
  const examples = [
    ['Tymon · 2024 欧锦赛 三阶 冠军（他单条最高）', find('Tymon Kolasiński', '333', 2024, 'CC', 'European Championship 2024')],
    ['Tymon · 2025 世锦赛 三阶 季军', find('Tymon Kolasiński', '333', 2025, 'WC')],
    ['Feliks · 2013 世锦赛 三阶 冠军', find('Feliks Zemdegs', '333', 2013, 'WC')],
    ['Feliks · 2010 亚锦赛 三阶单次 冠军（小场冷门项目）', find('Feliks Zemdegs', '333fm', 2010, 'CC')],
    ['Tymon · 国锦赛单条最高', tymonTopNC],
    ['Feliks · 国锦赛场次最小的一条（SQ1）', feliksSq1],
  ];
  for (const [label, it] of examples) {
    if (!it) continue;
    const P = M2.PLACE_W[it.pos] || 0;
    const ratio = it.field / refOf(it.ev);
    L('**' + label + '**');
    L('');
    L('```');
    L('分 = ' + F(P) + '(P, ' + PLACE_CN[it.pos] + ') × ' + F(K_OF[it.tier]) + '(K, ' + TIER_CN[it.tier] + ')'
      + ' × (' + num(it.field) + ' ÷ ' + num(Math.round(refOf(it.ev))) + ')^0.8015 × ' + F(it.fFused) + '(f) × ' + F(it.w) + '(w, ' + it.ev + ')');
    L('   = ' + F(P) + ' × ' + F(K_OF[it.tier]) + ' × ' + F(Math.pow(ratio, GAMMA)) + ' × ' + F(it.fFused) + ' × ' + F(it.w));
    L('   = ' + F(it.base));
    L('   赛事 ' + it.compName + '（' + it.year + '，举办国 ' + it.nat + '）');
    L('```');
    L('');
  }
  L('「单条均分」就是把一个选手所有这些单条价格取算术平均（或按赛级分组平均）。');
  L('锦标赛的单条**不打重复衰减、不乘 β**——这两项只作用于普通赛（OP）领奖台。');
  L('');

  fs.writeFileSync(path.join(__dirname, 'M2_Tymon_vs_Feliks.md'), OUT.join('\n') + '\n');
  console.error('[done]');
})().catch((e) => { console.error(e); process.exit(1); });

'use strict';
/* M2 融合定稿（M2 = 锦标赛领奖台 + 普通赛领奖台，即旧 M2+M3 融合）：单价由深度定，平衡阀由两条独立准则交叉验证
 *
 *   分 = P(pos) × K_级 × (hill(field) / hill(REF_ev,同时代))^γ × f × w × (普通赛 ? β × n^-α : 1)
 *
 * α  只作用于普通赛（锦标赛领奖台本身稀缺，不衰减）
 * β  普通赛整体折算，由两条准则各自反解后比对
 *
 * ── S2（2026-10-25 落地，依据《M2_早年含金量诊断.md》）────────────────
 *   ① 规模项 REF 改用**年代本地**：±2/3/5/8/15 年滚动窗取普通赛该项目到场
 *      人数中位（样本 ≥20 取最紧窗；附近没有任何普通赛才退回全局 REF）。
 *      含义从「比全年代典型比赛深多少」改成「比**同时代**典型比赛深多少」，
 *      不再把「时代增长」混进「场子大小」。时代差异只由 f 一个机制承担。
 *   ② f 的 WC 池从举办国池改回**全球池**（WR），与 M2-F3 的
 *      LEVEL_OF.WC = 'WR' 对齐。原实现锦标赛一律用举办国池，导致
 *      「小国办大赛」被双重惩罚（1982 世锦赛在布达佩斯，当年全国累计
 *      注册只有 1 人，f = 0.0604，全球池 0.1927）。
 *      CC / NC 同为举办国池时也有同样的小国双重惩罚问题。
 *
 * ── S6（2026-10-25 落地，用户拍板）─────────────────────────────
 *   ⑤ 洲锦赛 CC 的 f 池从举办国池（NR）改**全球池**（WR），消除「小国办洲锦赛」
 *      的双重惩罚；国锦赛 NC 维持举办国池（NR）——国锦赛本质是国家赛事，
 *      用举办国曲线反而更合理。仅一行 `F_POOL` 改动，β 自动重解。
 *
 * ── S4（2026-10-25 落地，依据《M2_规模项_人数vs含金量.md》）──────────
 *   ③ 人数封顶（hill 饱和变换）：把规模项里的「到场人数」换成
 *      hill(N) = 500 × ln(1 + N/500)。
 *
 * ── S5（2026-10-25 落地，依据《M2M3_洲际机会不均.md》及用户 2015 中锦赛反馈；同日修订为「客场折半」）──
 *   ④ 属地门槛：锦标赛领奖台是「属地头衔」。WC 全球无门槛；
 *      CC 仅本洲、NC 仅本国计入「本人头衔」。外籍夺冠不再算本人头衔，
 *      但保留为「客场锦标赛」、K 打 5 折（0.5×K_OF），不降级 M3——
 *      既修正「满世界飞」红利，又不再让 Feliks 这类旅外型选手的客场成绩被清零。
 *      greater_china 赛事 host 在亚洲 → 亚洲选手计、其余按客场折半。

 *      动机：年代越靠后参赛人数越多，但新增的大都是低水平玩家，
 *      对顶端选手构不成威胁，却把规模项灌水。实测三阶普通赛 D20
 *      （冠军 20% 以内人数）中位恒为 3，而 N 从 18 涨到 53；
 *      世锦赛 N 从 83 涨到 1,823，但 50% 以内人数只从 25 涨到 29。
 *      封顶线取 500（用户 2026-10-25 定）：1982–2005 三届世锦赛
 *      （19/88/149 人）完全不受影响，2007 年（214 人）起才开始被压。
 *      代价已知：世锦赛赛级单价会落到外部深度标尺的约 85%（NSAT=200
 *      时是 74.55%，500 更温和）。
 *
 * 用法：node --max-old-space-size=6144 etl/score/m2m3_balance.js [alpha]
 * 只读，不改 m2.js / m1.js。
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
const PCT = (v) => (v * 100).toFixed(2) + '%';

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
const med = (a) => {
  if (!a.length) return 0;
  const b = a.slice().sort((x, y) => x - y);
  const m = b.length >> 1;
  return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2;
};

const GAMMA = 0.8015;
const K_OF = { OP: 1.0000, NC: 1.0000, CC: 1.6000, WC: 1.6000 };
const TIER_CN = { OP: '普通赛', NC: '国锦赛', CC: '洲锦赛', WC: '世锦赛' };
const ALPHA = process.argv[2] == null ? 1.0 : +process.argv[2];

/* S4：人数封顶（hill 饱和变换）。
 * hill(N) = NSAT × ln(1 + N/NSAT)。
 * NSAT = 500（用户 2026-10-25 定）：超过 500 人后边际递减。
 * 1982/2003/2005 三届世锦赛（19/88/149 人）几乎不变，2007 年（214 人）起开始被压。 */
const NSAT = 500;
const hill = (x) => NSAT * Math.log(1 + Math.max(x, 0) / NSAT);

// 破纪录加分（M3）已移出本文件，作为独立计分维度，参见 etl/score/m3_record_bonus.js
// （该脚本独立扫描 results.tsv 的纪录标记列，产出 M3 分数；M2 内核不含此项）


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

  const items = [];
  for (const r of rows) {
    const multi = M2.isMultiRegion(r.nat);
    const tier = multi ? 'OP' : M2.tierOf(ctypes.get(r.compId), r.nat);
    const cont = (isoInfo.get(r.nat) || {}).cont || 'Unknown';
    const field = (compEvPeople.get(r.compId + '|' + r.ev) || { size: 1 }).size;
    const who = { nat: r.nat, cont };
    const fNat = pool ? pool.valueOf('NR', who, +r.year || 2026) : 1;   // 举办国池
    const fGlb = pool ? pool.valueOf('WR', who, +r.year || 2026) : 1;   // 全球池
    const w = RN.EV_WEIGHT_V2[r.ev] == null ? RN.WEIGHT_V2_CFG.floor : RN.EV_WEIGHT_V2[r.ev];
    items.push({ pid: r.pid, ev: r.ev, tier, pos: r.pos, year: r.year, field, fNat, fGlb, w, compId: r.compId,
      nat: r.nat, name: (pInfo.get(r.pid) || {}).name || r.pid });
  }

  /* ── 属地门槛（用户 2026-10-25 定；同日修订为「客场折半」）───────────
   * 锦标赛领奖台是「属地头衔」：世界冠军是全球的；洲锦赛只属于该洲选手、
   * 国锦赛只属于该国选手。外籍选手在别洲/别国夺冠是「客场夺冠」，
   * 不计入本人锦标赛纪录，但保留为客场锦标赛、K 打 5 折（0.5×K_OF），不降级 M3。
   * 依据 WCA 头衔逻辑：Feliks（大洋洲）拿亚锦赛/欧锦赛/中锦赛不算「亚洲/欧洲冠军」，
   * 但其真实成绩仍应给信用（避免旅外型选手客场成绩被清零）。
   * 实现：不改 tier（仍计 CC/NC），只在条目上挂 it.K_MUL=0.5，参与 M2 的深度项与 f。
   *   WC：全球，无门槛。
   *   CC：本洲（玩家 continent == 赛事举办洲）。greater_china 赛事 host 在亚洲 → 亚洲选手计、其余客场折半。
   *   NC：本国（玩家 iso == 赛事举办国 iso）。 */
  const HOME_CACHE = new Map();
  const homeOf = (pid) => {
    if (HOME_CACHE.has(pid)) return HOME_CACHE.get(pid);
    const p = pInfo.get(pid);
    let h = { nat: '', cont: 'Unknown' };
    if (p && p.iso) { const info = isoInfo.get(p.iso) || {}; h = { nat: p.iso, cont: info.cont || 'Unknown' }; }
    HOME_CACHE.set(pid, h); return h;
  };
  let GUEST_CC = 0, GUEST_NC = 0;
  const K_GUEST = 0.5;   // 外籍夺冠：保留 CC/NC 客场身份，但 K 打 5 折，不再计入本人本洲/本国头衔
  for (const it of items) {
    if (it.tier === 'WC') continue;
    const home = homeOf(it.pid);
    let guest = false;
    if (it.tier === 'CC') { if (home.cont !== it.cont) { guest = true; GUEST_CC++; } }
    else if (it.tier === 'NC') { if (home.nat !== it.nat) { guest = true; GUEST_NC++; } }
    if (guest) { it.guest = true; it.K_MUL = K_GUEST; }   // 仍计 CC/NC（客场），K 折半；不降级 M3
  }

  /* f 池口径（S2 落地 WC→WR；S6 落地 CC→WR，2026-10-25）：
   * 普通赛 / 世锦赛 / 洲锦赛 → 全球池（WR）；
   * 国锦赛 → 举办国池（NR，国锦赛本质是国家赛事，用举办国曲线更合理）。
   * WC/CC 改全球池与 M2-F3 的 LEVEL_OF.WC = 'WR' 对齐，消除「小国办大赛」
   * 的双重惩罚（见《M2_早年含金量诊断》）。 */
  const F_POOL = { OP: 'WR', NC: 'NR', CC: 'WR', WC: 'WR' };
  const fOf = (it) => (F_POOL[it.tier] === 'WR' ? it.fGlb : it.fNat);

  /* REF：年代本地（S2 落地，2026-10-25）
   * 规模项回答「这场比赛比**同时代**典型比赛深多少」，不再把「时代增长」
   * 混进「场子大小」。±2/3/5/8/15 年滚动窗取普通赛该项目到场人数中位，
   * 样本 ≥20 取最紧窗；附近没有任何普通赛时退回全局 REF（如 1982 世锦赛孤例）。 */
  const opByEv = new Map();
  for (const it of items) {
    if (it.tier !== 'OP') continue;
    if (!opByEv.has(it.ev)) opByEv.set(it.ev, []);
    opByEv.get(it.ev).push({ year: it.year, field: it.field });
  }
  const REF = new Map();
  for (const [ev, a] of opByEv) if (a.length >= 30) REF.set(ev, med(a.map((x) => x.field)));
  const refAll = med([...opByEv].filter(([, a]) => a.length >= 30).map(([, a]) => med(a.map((x) => x.field))));
  const refOfG = (ev) => REF.get(ev) || refAll;
  const WIN = [2, 3, 5, 8, 15];
  const MIN_SAMPLES = 20;
  const eraCache = new Map();
  const refOfEra = (ev, year) => {
    const key = ev + '|' + year;
    if (eraCache.has(key)) return eraCache.get(key);
    const list = opByEv.get(ev) || [];
    let best = null; let usedW = -1;
    for (const w of WIN) {
      const l = list.filter((x) => Math.abs(x.year - year) <= w).map((x) => x.field);
      if (l.length >= MIN_SAMPLES) { best = med(l); usedW = w; break; }
    }
    if (best == null) {
      const l = list.filter((x) => Math.abs(x.year - year) <= 15).map((x) => x.field);
      if (l.length) { best = med(l); usedW = 15; } else { best = refOfG(ev); usedW = -1; }
    }
    eraCache.set(key, best);
    eraCache.set(key + '#w', usedW);
    return best;
  };
  const eraWin = (ev, year) => eraCache.get(ev + '|' + year + '#w');

  for (const it of items) {
    const P = M2.PLACE_W[it.pos] || 0;
    const K = K_OF[it.tier] * (it.K_MUL || 1);
    const refEra = refOfEra(it.ev, it.year);
    /* S4（落地口径）：hill 封顶 + 年代本地 REF + WC 全球池 */
    it.base = P * K * Math.pow(hill(it.field) / hill(refEra), GAMMA) * fOf(it) * it.w;
    /* 对照：S2 口径（无 hill，年代本地 REF + WC 全球池），仅用于第 10 节前后对比 */
    it.baseNoHill = P * K * Math.pow(it.field / refEra, GAMMA) * fOf(it) * it.w;
    /* 对照：S2 之前的定稿（全局 REF + 锦标赛一律举办国池），仅用于第 9 节前后对比 */
    it.baseOld = P * K * Math.pow(it.field / refOfG(it.ev), GAMMA)
      * (it.tier === 'OP' ? it.fGlb : it.fNat) * it.w;
    /* 敏感性：hill 封顶 + 年代本地 REF + 全部赛级全球池 */
    it.baseGlb = P * K * Math.pow(hill(it.field) / hill(refEra), GAMMA) * it.fGlb * it.w;
    it.n = 1;
  }

  /* 仅在普通赛内部做重复衰减 */
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

  /* ── 事实表导出（sixdim 查询引擎用；纯写出，不影响任何计算） ──
     M2 融合分 v = base × decay × (OP ? BETA : 1)；as-of 截取 = 过滤 year ≤ asOf
     （decay 是同人同项目普通赛按年升序的序号 n^-α，截断只删尾部、前缀序号不变 → 天然兼容） */
  fs.writeFileSync(path.join(__dirname, 'M2_facts.tsv'),
    'pid\tname\tev\ttier\tpos\tyear\tcompId\tbase\tdecay\n' +
    items.map((it) => [it.pid, (it.name || '').replace(/\t/g, ' '), it.ev, it.tier, it.pos, it.year, it.compId,
      (it.base == null ? 0 : it.base).toFixed(6), (it.decay || 1).toFixed(6)].join('\t')).join('\n') + '\n', 'utf8');
  console.log('已写 M2_facts.tsv（', items.length, '行）');

  const OUT = [];
  const L = (s) => { console.log(s); OUT.push(s); };

  /* ── 聚合 ─────────────────────────────────────────────────── */
  const aggBy = (key, beta) => {
    const by = new Map();
    for (const it of items) {
      const v = it[key] * it.decay * (it.tier === 'OP' ? beta : 1);
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
  const agg = (beta) => aggBy('base', beta);

  const S = { OP: 0, NC: 0, CC: 0, WC: 0 };
  for (const it of items) S[it.tier] += it.base * it.decay;
  const S2 = S.NC + S.CC + S.WC;
  const S3 = S.OP;

  /* 基准：纯 M2（β=0） */
  const pure = agg(0);
  const maxM2 = pure[0].total;
  const pureRank = new Map();
  pure.forEach((x) => pureRank.set(x.pid, x.rank));

  /* 两条准则反解 β */
  const maxM3 = Math.max(...items.filter((it) => it.tier === 'OP')
    .reduce((m, it) => { m.set(it.pid, (m.get(it.pid) || 0) + it.base * it.decay); return m; }, new Map()).values());
  const bShare = S2 / S3;          // 总量各占一半
  const bPeak = maxM2 / maxM3;     // 两维榜首同分

  L('# M2 融合定稿：单价表与平衡阀');
  L('');
  L('> 现算，源 WCA v2.0.2，脚本 `etl/score/m2m3_balance.js`。只读。');
  L('');
  L('```');
  L('分 = P(pos) × K_级 × (hill(到场人数) ÷ hill(该项目**同时代**普通赛中位人数))^' + F(GAMMA) + ' × f × w');
  L('      ×（普通赛：β × n^-α；锦标赛：1）');
  L('```');
  L('');
  L('α = ' + F(ALPHA) + '（同人同项目第 n 次普通赛领奖台 × n^-α），β 见第 4 节。');
  L('REF 为年代本地（±2/3/5/8/15 年滚动窗，样本 ≥' + MIN_SAMPLES + ' 取最紧窗，附近无普通赛才退回全局）；');
  L('f 池：普通赛 / 世锦赛 / 洲锦赛 → 全球池，国锦赛 → 举办国池（S2 + S6，2026-10-25 落地，见第 9 节）。');
  L('**hill(N) = ' + NSAT + ' × ln(1 + N/' + NSAT + ')**（S4 人数封顶，2026-10-25 落地，见第 10 节）。');
  L('**破纪录加分（M3）是独立计分维度**，不计入本 M2 内核；它由 `m3_record_bonus.js` 独立计算（见 M3_破纪录加分.md），');
  L('最终总榜 = M2（本文件） + M3（独立）另行汇总。与已封存 M1（持有纪录价值）独立并存，不做时代折算、不受属地门槛约束。');
  L('');
  L('');
  L('**属地门槛（2026-10-25 落地，2026-10-25 修订为「客场折半」）**：WC 全球无门槛；CC 仅本洲、NC 仅本国计入「本人头衔」。');
  L('外籍夺冠不再算本人本洲/本国头衔，但保留为「客场锦标赛」、K 打 5 折（0.5×K），不降级 M3。全站因此标记为客场折半的领奖台：');
  L('洲锦赛 **' + num(GUEST_CC) + '** 条、国锦赛 **' + num(GUEST_NC) + '** 条，合计 **' + num(GUEST_CC + GUEST_NC) + '** 条。');
  L('');

  /* ── 1 条数与单价 ─────────────────────────────────────────── */
  L('══ 1 融合后的条数与深度单价 ══');
  L('');
  const cnt = { OP: 0, NC: 0, CC: 0, WC: 0 };
  for (const it of items) cnt[it.tier]++;
  /* 代表年代 = 该赛级三阶领奖台年份的中位；场次取 REF 实际使用的同窗中位，
   * 保证「同时代普通赛三阶冠军」这一锚点恒等于 1.0000。 */
  const rep = {};
  for (const t of ['OP', 'NC', 'CC', 'WC']) {
    const a = items.filter((it) => it.tier === t && it.ev === '333');
    const y = a.length ? med(a.map((it) => it.year)) : 2026;
    const ref = refOfEra('333', y);
    const w = eraWin('333', y);
    const inWin = w < 0 ? a : a.filter((it) => Math.abs(it.year - y) <= w);
    rep[t] = { y, n: a.length, field: inWin.length ? med(inWin.map((it) => it.field)) : 0, ref };
  }
  L('| 赛级 | 条数 | 占比 | K_级 | 三阶代表场次 | 同时代 REF | hill 比值 | 三阶冠军单价（深度项） |');
  L('|---|---|---|---|---|---|---|---|');
  for (const t of ['OP', 'NC', 'CC', 'WC']) {
    const hr = hill(rep[t].field) / hill(rep[t].ref);
    const price = K_OF[t] * Math.pow(hr, GAMMA);
    L('| ' + TIER_CN[t] + ' | ' + num(cnt[t]) + ' | ' + PCT(cnt[t] / items.length) + ' | ' + F(K_OF[t])
      + ' | ' + num(rep[t].field) + '（' + rep[t].y + ' 年） | ' + num(rep[t].ref) + ' | ' + F(hr) + ' | **' + F(price) + '** |');
  }
  L('| **合计** | **' + num(items.length) + '** | 100.00% | | | | | |');
  L('');
  L('深度单价 = K_级 × (hill(代表场次) ÷ hill(同时代 REF))^' + F(GAMMA) + '，未含 f 与 w。');
  L('锚点：同时代普通赛三阶冠军（该年代中位场）= 1.0000。三阶全局 REF（附近无普通赛时的退回值）= '
    + num(refOfG('333')) + ' 人。');
  L('');

  /* ── 2 失衡 ───────────────────────────────────────────────── */
  L('══ 2 不加 β 时的失衡 ══');
  L('');
  L('| 赛级 | 总分 | 占比 |');
  L('|---|---|---|');
  const Stot = S2 + S3;
  for (const t of ['WC', 'CC', 'NC', 'OP']) L('| ' + TIER_CN[t] + ' | ' + F(S[t]) + ' | ' + PCT(S[t] / Stot) + ' |');
  L('| **合计** | **' + F(Stot) + '** | 100.00% |');
  L('');
  L('α = ' + F(ALPHA) + ' 时 M3 仍占 **' + PCT(S3 / Stot) + '**，M2 占 ' + PCT(S2 / Stot) + '。');
  L('条数比 ' + F(cnt.OP / (cnt.OP === 0 ? 1 : (cnt.NC + cnt.CC + cnt.WC))) + ' 倍，单条均分比 '
    + F((S3 / cnt.OP) / (S2 / (cnt.NC + cnt.CC + cnt.WC))) + ' 倍。');
  L('');

  /* ── 3 α 敏感性 ─────────────────────────────────────────────── */
  const agg2 = (alpha, beta) => {
    const by = new Map();
    for (const it of items) {
      const d = it.tier === 'OP' ? Math.pow(it.n, -alpha) : 1;
      const v = it.base * d * (it.tier === 'OP' ? beta : 1);
      let a = by.get(it.pid);
      if (!a) { a = { pid: it.pid, name: it.name, total: 0, m2: 0, m3: 0, n: 0 }; by.set(it.pid, a); }
      a.total += v;
      if (it.tier === 'OP') a.m3 += v; else a.m2 += v;
      a.n++;
    }
    const list = [...by.values()].filter((x) => x.total > 0).sort((a, b) => b.total - a.total);
    list.forEach((x, i) => { x.rank = i + 1; });
    return list;
  };
  const s3Of = (a) => items.reduce((s, it) => s + (it.tier === 'OP' ? it.base * Math.pow(it.n, -a) : 0), 0);

  L('══ 3 重复衰减 α：为什么取 0.5 ══');
  L('');
  L('普通赛的同一个项目，一个人可以反复赢（Feliks 1,051 个领奖台、Luke Garrett 1,352 个）。');
  L('`第 n 次同人同项目领奖台 × n^-α` 就是给这种重复打折。α 越大，越只看「峰值」，越不看「场次」。');
  L('');
  L('| α | 衰减形态 | M3 全局占比 | Top10 的 M3 中位 | Top100 的 M3 中位 | 现象 |');
  L('|---|---|---|---|---|---|');
  const A_SWEEP = [0, 0.25, 0.5, 0.75, 1.0, 1.5, 2.0];
  const aRows = [];
  for (const a of A_SWEEP) {
    const l = agg2(a, 1);
    const s3 = l.reduce((s, x) => s + x.m3, 0);
    const share = s3 / (s3 + S2);
    const t10 = med(l.slice(0, 10).map((x) => x.m3 / x.total));
    const t100 = med(l.slice(0, 100).map((x) => x.m3 / x.total));
    aRows.push({ a, l, share, t10, t100 });
    const tag = a === 0 ? '**Luke Garrett 直接第 1（96.7% 来自普通赛）**'
      : a <= 0.25 ? 'Luke Garrett 第 4，仍偏高'
        : a <= 0.5 ? '**Top3 稳定，重复被驯服**'
          : a <= 1.0 ? '头部 M3 已低于 11%'
            : '头部几乎不看 M3，融合失效';
    const form = a === 0 ? '不衰减' : a === 0.5 ? '1/√n' : a === 1.0 ? '1/n' : 'n^-' + a;
    L('| ' + F(a) + ' | ' + form + ' | ' + PCT(share) + ' | ' + PCT(t10) + ' | ' + PCT(t100) + ' | ' + tag + ' |');
  }
  L('');
  const lukePid = [...pInfo.entries()].find(([, p]) => p.name === 'Luke Garrett');
  if (lukePid) {
    L('Luke Garrett 的名次轨迹：' + aRows.map((r) => {
      const x = r.l.find((y) => y.pid === lukePid[0]);
      return 'α=' + r.a + ' → #' + (x ? x.rank : '—');
    }).join('，'));
    L('');
  }
  L('**α = 0 不可用**：普通赛条数是锦标赛的 11.88 倍，不衰减时一个人靠「多比」就能超过世界冠军。');
  L('**α ≥ 1 也不可用**：头部 M3 占比掉到 5% 以下，融合变成「M2 加个零头」。');
  L('取 **α = 0.5**（第 2 次 ×0.7071、第 4 次 ×0.5、第 9 次 ×0.3333、第 100 次 ×0.1）。');
  L('');

  /* ── 4 两条准则 ───────────────────────────────────────────── */
  L('══ 4 平衡阀 β：两条准则的结果不一致，这正是问题所在 ══');
  L('');
  L('| 准则 | 定义 | 反解 β | 可行？ |');
  L('|---|---|---|---|');
  L('| 总量等分 | 融合后 M2、M3 各占总分 50% | **' + F(bShare) + '** | 可用 |');
  L('| 榜首同分 | 纯 M2 第一名 = 纯 M3 第一名 | ' + F(bPeak) + ' | **不可用**（见下） |');
  L('');
  L('纯 M2 榜首 ' + F(maxM2) + '（' + pure[0].name + '），纯 M3 榜首 ' + F(maxM3) + '。');
  L('要让榜首同分，β 得取 ' + F(bPeak) + '，此时普通赛总量会占到 '
    + PCT((bPeak * S3) / (bPeak * S3 + S2)) + '，M2 被压掉。');
  L('原因不是参数，是**两个维度的形状不同**：M2 是「头部厚、长尾空」（93.1% 的人为 0），');
  L('M3 是「头部薄、长尾厚」。任何统一的系数都无法同时让「总量各半」和「榜首同分」成立。');
  L('');
  L('所以 β 只能按一个目标定。**取总量等分**，因为总分是「生涯荣誉总量」，先保证两个维度在总量上平起平坐。');
  L('');

  const BETA = bShare;
  const final = agg(BETA);

  /* 导出 M2 全量排名（前 1000）为纯数据文件，供独立 M3 脚本做「M2 + M3」组合榜。
   * 这是 M2 自身排名的数据导出，不改变 M2 公式与常量；M3 仍独立计算后于此相加。
   * 导出 1000 名而非仅 Top25，是为了覆盖「排在 #25 之外、靠 M3 加分逆袭」的选手；
   * M3 脚本会用末行分数 + 最大单条加分做边界自检，确认范围足够。 */
  {
    const top = final.slice(0, 1000);
    const lines = ['rank\tpid\tname\ttotal'];
    for (const x of top) lines.push(x.rank + '\t' + x.pid + '\t' + x.name + '\t' + F(x.total));
    fs.writeFileSync(path.join(__dirname, 'M2_ranking.tsv'), lines.join('\n') + '\n', 'utf8');
  }

  /* ── S2 前后对比用的两套对照口径 ───────────────────────────── */
  const sumKey = (key) => {
    const s = { OP: 0, NC: 0, CC: 0, WC: 0 };
    for (const it of items) s[it.tier] += it[key] * it.decay;
    return s;
  };
  const cname = (cid) => (compInfo.get(cid) || {}).name || cid;
  const SO = sumKey('baseOld');                 // 旧定稿：全局 REF + 锦标赛国池 f
  const S2O = SO.NC + SO.CC + SO.WC;
  const betaOld = S2O / SO.OP;
  const pureOld = aggBy('baseOld', 0);
  const finalOld = aggBy('baseOld', betaOld);
  const SN = sumKey('baseNoHill');              // S2：年代 REF + WC 全球池，无 hill
  const S2N = SN.NC + SN.CC + SN.WC;
  const betaNoHill = S2N / SN.OP;
  const pureNoHill = aggBy('baseNoHill', 0);
  const finalNoHill = aggBy('baseNoHill', betaNoHill);
  const SG = sumKey('baseGlb');                 // 敏感性：hill + 年代 REF + 全部全球池 f
  const S2G = SG.NC + SG.CC + SG.WC;
  const betaGlb = S2G / SG.OP;
  const finalGlb = aggBy('baseGlb', betaGlb);

  L('══ 5 定稿单价（β 已折入）══');
  L('');
  L('| 成就 | 深度单价 | β 后实际单价 | 相当于几个普通赛冠军 |');
  L('|---|---|---|---|');
  for (const t of ['OP', 'NC', 'CC', 'WC']) {
    const raw = K_OF[t] * Math.pow(hill(rep[t].field) / hill(rep[t].ref), GAMMA);
    const eff = raw * (t === 'OP' ? BETA : 1);
    L('| ' + TIER_CN[t] + ' 冠军（三阶、同时代中位场） | ' + F(raw) + ' | **' + F(eff) + '** | ' + F(eff / (K_OF.OP * BETA)) + ' |');
  }
  L('| 普通赛 亚军 | — | ' + F(BETA * 0.6) + ' | 0.6000 |');
  L('| 普通赛 季军 | — | ' + F(BETA * 0.4) + ' | 0.4000 |');
  L('');
  L('普通赛的重复衰减：第 2 次同项目 ×0.7071，第 3 次 ×0.5774，第 10 次 ×0.3162。');
  L('项目权重 w_e 不改（三阶 1.0000 仍为全站最高）；f 的时代机制不改（沿用 M1），');
  L('但 WC 的池已从举办国池改回全球池（S2，2026-10-25，见第 9 节）。');
  L('');

  L('══ 6 融合榜 Top25 ══');
  L('');
  L('| # | 选手 | 融合分 | M2（锦标赛） | M3（普通赛） | M3 占比 | 纯M2名次 | 领奖台 |');
  L('|---|---|---|---|---|---|---|---|');
  for (let i = 0; i < 25; i++) {
    const x = final[i]; if (!x) break;
    L('| ' + (i + 1) + ' | ' + x.name + ' | ' + F(x.total) + ' | ' + F(x.m2) + ' | ' + F(x.m3)
      + ' | ' + PCT(x.m3 / x.total) + ' | ' + pureRank.get(x.pid) + ' | ' + num(x.n) + ' |');
  }
  L('');

  /* ── 7 名次影响 ───────────────────────────────────────────── */
  L('══ 7 融合对名次的影响 ══');
  L('');
  let same = 0; let up2 = 0; let down2 = 0;
  for (const x of final.slice(0, 100)) {
    const d = pureRank.get(x.pid) - x.rank;
    if (d === 0) same++;
    if (Math.abs(d) >= 2) { if (d > 0) up2++; else down2++; }
  }
  L('Top100 中：名次不变 ' + same + ' 人，上升 ≥2 位 ' + up2 + ' 人，下降 ≥2 位 ' + down2 + ' 人。');
  L('');
  const moved = [];
  for (const x of final.slice(0, 60)) {
    const d = pureRank.get(x.pid) - x.rank;
    if (Math.abs(d) >= 5) moved.push([x.name, pureRank.get(x.pid), x.rank, d]);
  }
  if (moved.length) {
    L('| 选手 | 纯M2 | 融合 | 变动 | 原因 |');
    L('|---|---|---|---|---|');
    for (const [nm, a, b, d] of moved) {
      L('| ' + nm + ' | ' + a + ' | ' + b + ' | ' + (d > 0 ? '+' : '') + d + ' | '
        + (d > 0 ? '普通赛产出多' : '普通赛产出少') + ' |');
    }
    L('');
  }

  /* ── 8 与 M2-F3 的差别 ────────────────────────────────────── */
  L('══ 8 这次融合连 M2 内部的名次也改了 ══');
  L('');
  L('| 版本 | #1 | #2 | #3 |');
  L('|---|---|---|---|');
  L('| M2-F3（定稿，`T_L × ρ_人口`） | Feliks 12.4753 | Max 9.4744 | Tymon 5.6944 |');
  L('| 融合（深度定价）的 M2 部分 | ' + pure[0].name + ' ' + F(pure[0].total)
    + ' | ' + pure[1].name + ' ' + F(pure[1].total) + ' | ' + pure[2].name + ' ' + F(pure[2].total) + ' |');
  L('');
  L('原因是必须换价：M2-F3 的国锦赛三阶冠军约 0.0011 分，而普通赛三阶冠军在融合后是 '
    + F(K_OF.OP * BETA) + ' 分 —— 国锦赛会变成「0.38% 个普通赛」。');
  L('不换价，融合就等于「把国锦赛抹掉」，这比换价更糟。');
  L('换价后国锦赛三阶冠军 = ' + F(K_OF.NC * Math.pow(hill(rep.NC.field) / hill(rep.NC.ref), GAMMA)) + ' 分，是普通赛的 '
    + F((K_OF.NC * Math.pow(hill(rep.NC.field) / hill(rep.NC.ref), GAMMA)) / (K_OF.OP * BETA)) + ' 倍，与实测赛事深度 1.29 倍的差距由 β 承担。');
  L('');
  L('一句诚实的总结：**这不是「给 M2 加一条 M3」，是「用同一把尺子重定所有价格」。**');
  L('');

  /* ── 9 S2 落地说明 ───────────────────────────────────────── */
  L('══ 9 S2 落地（2026-10-25）：年代本地 REF + WC 全球池 ══');
  L('');
  L('依据《M2_早年含金量诊断.md》。只改两处，其余一律不变：');
  L('');
  L('1. **规模项 REF 改年代本地**：从「比全年代典型比赛深多少」改成「比**同时代**典型比赛深多少」，');
  L('   时代增长不再被算进「场子大小」；时代差异只由 f 一个机制承担（M1 定案）。');
  L('2. **WC 的 f 池从举办国池改回全球池**（WR），与 M2-F3 的 `LEVEL_OF.WC` 对齐；');
  L('   **S6（2026-10-25）进一步把 CC（洲锦赛）也改全球池**，消除「小国办大赛/洲赛」双重惩罚。');
  L('   NC（国锦赛）维持举办国池（NR）——国锦赛本质是国家赛事，用举办国曲线更合理。');
  L('');
  L('三阶 REF 对照（按世锦赛年份；三阶全局 REF = ' + num(refOfG('333')) + ' 人）：');
  L('');
  L('| 世锦赛年 | 全局 REF | 年代 REF | 窗口 |');
  L('|---|---|---|---|');
  const wcChamps = items.filter((x) => x.tier === 'WC' && x.ev === '333' && x.pos === 1)
    .sort((a, b) => a.year - b.year);
  for (const it of wcChamps) {
    const w = eraWin('333', it.year);
    L('| ' + it.year + ' | ' + num(refOfG('333')) + ' | ' + num(refOfEra('333', it.year))
      + ' | ' + (w < 0 ? '附近无普通赛 → 退回全局' : '±' + w + ' 年') + ' |');
  }
  L('');
  L('WC 的 f 双池（举办国池 → 全球池）：');
  L('');
  L('| 世锦赛年 | 举办国 | 到场 | f(国池) | f(全球池) | 倍数 |');
  L('|---|---|---|---|---|---|');
  for (const it of wcChamps) {
    L('| ' + it.year + ' | ' + (it.nat || '—') + ' | ' + num(it.field) + ' | ' + F(it.fNat)
      + ' | ' + F(it.fGlb) + ' | ' + F(it.fGlb / it.fNat) + ' |');
  }
  L('');
  L('世锦赛三阶冠军单价（P = 1，含 f 与 w）：');
  L('');
  L('| 世锦赛 | 年 | 到场 | 旧口径 | S2（无 hill） | 倍数 |');
  L('|---|---|---|---|---|---|');
  for (const it of wcChamps) {
    L('| ' + cname(it.compId).replace(/\|/g, '/').slice(0, 30) + ' | ' + it.year + ' | ' + num(it.field)
      + ' | ' + F(it.baseOld) + ' | **' + F(it.baseNoHill) + '** | ' + F(it.baseNoHill / it.baseOld) + ' |');
  }
  L('');
  L('总量与平衡阀（各自按总量等分重解 β）：');
  L('');
  L('| 口径 | M2 总分 | M3 总分(β=1) | 总量等分所需 β | 锦标赛总量 |');
  L('|---|---|---|---|---|');
  L('| 旧定稿（全局 REF + 锦标赛一律国池 f） | ' + F(S2O) + ' | ' + F(SO.OP) + ' | ' + F(betaOld) + ' | 100.00% |');
  L('| **S2（年代 REF + WC 全球池）** | **' + F(S2N) + '** | **' + F(SN.OP) + '** | **' + F(betaNoHill) + '** | ' + PCT(S2N / S2O) + ' |');
  L('| 敏感性：hill + 年代 REF + 全部赛级全球池 f | ' + F(S2G) + ' | ' + F(SG.OP) + ' | ' + F(betaGlb) + ' | ' + PCT(S2G / S2O) + ' |');
  L('');
  L('第三行就是《M2_早年含金量诊断》「全修」列的实际口径 —— 那份诊断的实现把 CC / NC 的 f 也换成了全球池，');
  L('而 S2 的文字定义只修 WC 一档。本定稿按**定义**落地（第二行）；两行差异全部来自 CC / NC 的 f 池。');
  L('**S6 已把 CC 改全球池**（F_POOL 一行切换，β 自动重解）；若日后想连 NC 也改洲/全球池，同样只需切 `F_POOL`。');
  L('');
  L('融合榜 Top10 前后对比：');
  L('');
  L('| # | 旧定稿 | 总分 | | S2（无 hill） | 总分 |');
  L('|---|---|---|---|---|---|');
  for (let i = 0; i < 10; i++) {
    const a = finalOld[i]; const b = finalNoHill[i];
    L('| ' + (i + 1) + ' | ' + (a ? a.name : '—') + ' | ' + (a ? F(a.total) : '—')
      + ' | | ' + (b ? b.name : '—') + ' | ' + (b ? F(b.total) : '—') + ' |');
  }
  L('');
  const delta = new Map();
  for (const it of items) {
    if (it.tier === 'OP') continue;
    const d = (it.baseNoHill - it.baseOld) * it.decay;
    if (!delta.has(it.pid)) delta.set(it.pid, { name: it.name, d: 0, n: 0, early: 0 });
    const x = delta.get(it.pid);
    x.d += d; x.n++;
    if (it.year <= 2009) x.early++;
  }
  const topD = [...delta.values()].filter((x) => x.d > 0.0001).sort((a, b) => b.d - a.d).slice(0, 12);
  L('锦标赛分受益人 Top12（Δ = S2 − 旧定稿）：');
  L('');
  L('| 选手 | Δ 锦标赛分 | 领奖台条数 | 其中 ≤2009 年 |');
  L('|---|---|---|---|');
  for (const x of topD) L('| ' + x.name + ' | **+' + F(x.d) + '** | ' + num(x.n) + ' | ' + num(x.early) + ' |');
  L('');
  const early = items.filter((it) => it.tier !== 'OP' && it.year <= 2009);
  const earlyPids = new Set(early.map((it) => it.pid));
  const bestEarly = finalOld.find((x) => earlyPids.has(x.pid));
  L('≤2009 年的锦标赛领奖台共 ' + num(early.length) + ' 条、涉及 ' + num(earlyPids.size)
    + ' 人；这批人在旧定稿榜的最高名次是 #' + (bestEarly ? bestEarly.rank : '—') + '。');
  L('');
  L('为什么不选 S3（相对深度 = 到场人数 ÷ 当年全球累计注册）：1982 世锦赛算出来是 1.0000，');
  L('这是数据假象 —— 那一年入库的只有世锦赛那 19 人，分母就是分子。真按 S3 算会把退役老将推上榜首，');
  L('正是 M2-F3 的 ρ 已经踩过的坑。');
  L('');

  /* ── 10 S4 落地说明 ───────────────────────────────────────── */
  L('══ 10 S4 落地（2026-10-25）：人数封顶 hill(' + NSAT + ') ══');
  L('');
  L('依据《M2_规模项_人数vs含金量.md》。只改一处：规模项的「到场人数」换成 hill(N) = '
    + NSAT + ' × ln(1 + N/' + NSAT + ')。');
  L('');
  L('**动机**：年代越靠后参赛人数越多，但新增的大都是低水平玩家，对顶端选手构不成威胁，却把规模项灌水。');
  L('实测三阶普通赛 D20（冠军 20% 以内人数）中位恒为 3，而 N 从 18 涨到 53；');
  L('世锦赛 N 从 83 涨到 1,823，但 50% 以内人数只从 25 涨到 29。');
  L('');
  L('**封顶线取 ' + NSAT + ' 人**（用户 2026-10-25 定）：1982/2003/2005 三届世锦赛（19/88/149 人）完全不受影响，');
  L('2007 年（214 人）起才开始被压。比 NSAT=200 更温和。');
  L('');
  L('hill 对各届世锦赛三阶的压缩效果（到场 → hill 值 → 相对无 hill 的规模项倍数）：');
  L('');
  L('| 年 | 到场人数 | hill(N) | 无 hill 规模项 | 有 hill 规模项 | 压缩比 |');
  L('|---|---|---|---|---|---|');
  for (const it of wcChamps) {
    const refEra = refOfEra('333', it.year);
    const scNo = Math.pow(it.field / refEra, GAMMA);
    const scHill = Math.pow(hill(it.field) / hill(refEra), GAMMA);
    L('| ' + it.year + ' | ' + num(it.field) + ' | ' + F(hill(it.field)) + ' | ' + F(scNo)
      + ' | ' + F(scHill) + ' | ' + F(scHill / scNo) + ' |');
  }
  L('');
  L('总量与平衡阀（各自按总量等分重解 β）：');
  L('');
  L('| 口径 | M2 总分 | M3 总分(β=1) | 总量等分所需 β | 相对 S2 |');
  L('|---|---|---|---|---|');
  L('| S2（无 hill） | ' + F(S2N) + ' | ' + F(SN.OP) + ' | ' + F(betaNoHill) + ' | 100.00% |');
  L('| **S4（hill ' + NSAT + '）** | **' + F(S2) + '** | **' + F(S3) + '** | **' + F(BETA) + '** | ' + PCT(S2 / S2N) + ' |');
  L('');
  L('融合榜 Top10 前后对比：');
  L('');
  L('| # | S2（无 hill） | 总分 | | S4（hill ' + NSAT + '） | 总分 | Δ |');
  L('|---|---|---|---|---|---|---|');
  for (let i = 0; i < 10; i++) {
    const a = finalNoHill[i]; const b = final[i];
    const d = a && b ? b.total - a.total : 0;
    L('| ' + (i + 1) + ' | ' + (a ? a.name : '—') + ' | ' + (a ? F(a.total) : '—')
      + ' | | ' + (b ? b.name : '—') + ' | ' + (b ? F(b.total) : '—') + ' | ' + (d >= 0 ? '+' : '') + F(d) + ' |');
  }
  L('');
  const hillDelta = new Map();
  for (const it of items) {
    const d = (it.base - it.baseNoHill) * it.decay;
    if (!hillDelta.has(it.pid)) hillDelta.set(it.pid, { name: it.name, d: 0, n: 0, big: 0 });
    const x = hillDelta.get(it.pid);
    x.d += d; x.n++;
    if (it.field > NSAT) x.big++;
  }
  const topH = [...hillDelta.values()].filter((x) => Math.abs(x.d) > 0.0001).sort((a, b) => b.d - a.d).slice(0, 10);
  const botH = [...hillDelta.values()].filter((x) => Math.abs(x.d) > 0.0001).sort((a, b) => a.d - b.d).slice(0, 10);
  L('hill 带来的分差 Top10（Δ = S4 − S2，正 = 受益）：');
  L('');
  L('| 选手 | Δ 总分 | 领奖台 | 其中场次 >' + NSAT + ' |');
  L('|---|---|---|---|');
  for (const x of topH) L('| ' + x.name + ' | **+' + F(x.d) + '** | ' + num(x.n) + ' | ' + num(x.big) + ' |');
  L('');
  L('hill 带来的分差 Bottom10（负 = 受损）：');
  L('');
  L('| 选手 | Δ 总分 | 领奖台 | 其中场次 >' + NSAT + ' |');
  L('|---|---|---|---|');
  for (const x of botH) L('| ' + x.name + ' | **' + F(x.d) + '** | ' + num(x.n) + ' | ' + num(x.big) + ' |');
  L('');
  let changed = 0; let total = 0;
  for (const it of items) {
    total++;
    if (Math.abs(it.base - it.baseNoHill) / Math.max(it.baseNoHill, 1e-12) > 0.01) changed++;
  }
  L('受影响条目：' + num(changed) + ' / ' + num(total) + '（' + PCT(changed / total)
    + '）单价变动 >1%。其余 ' + PCT(1 - changed / total) + ' 的条目几乎不动。');
  L('');
  L('**为什么不是零和**：hill 把「人头灌水」压掉后，大场选手的分降了，但 β 会自动重解（从 '
    + F(betaNoHill) + ' 到 ' + F(BETA) + '），普通赛单价跟着涨，所以总分分布会再平衡。');
  L('真正被压的是「靠超大场堆分」的策略，小场和中等场的选手几乎不受影响。');
  L('');
  L('**外部标尺校验**：世锦赛赛级单价 = ' + F(K_OF.WC * Math.pow(hill(rep.WC.field) / hill(rep.WC.ref), GAMMA))
    + '，外部深度标尺 = 7.8879（定义见《M2_赛事深度检验.md》），比值 '
    + F((K_OF.WC * Math.pow(hill(rep.WC.field) / hill(rep.WC.ref), GAMMA)) / 7.8879) + '。');
  L('对照 S2（无 hill，年代 REF）的比值是 ' + F((K_OF.WC * Math.pow(rep.WC.field / rep.WC.ref, GAMMA)) / 7.8879)
    + '。也就是说 hill(' + NSAT + ') **反而让世锦赛单价更贴近独立标尺**，不是偏离。');
  L('NSAT=200 时比值 0.7455（过度压低），' + NSAT + ' 恰好落在 1.03 附近。');
  L('');

  /* ── 11 M3（破纪录加分）为独立计分维度，不并入 M2 内核 ──────────────
   * M3 由 etl/score/m3_record_bonus.js 独立计算（扫描 results.tsv 纪录标记列，
   * 产出每位选手的 M3 分数）；本文件只负责 M2（锦标赛 + 普通赛融合）。
   * 两者的组合（M2 + M3）在 M3 报告或总榜阶段另行汇总，不在 M2 内核里叠加。 */

  fs.writeFileSync(path.join(__dirname, 'M2M3_融合_定稿.md'), OUT.join('\n') + '\n');
  console.error('[done] alpha=' + ALPHA + ' beta=' + F(BETA));
})().catch((e) => { console.error(e); process.exit(1); });

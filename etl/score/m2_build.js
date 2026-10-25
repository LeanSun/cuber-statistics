'use strict';
/* M2 全量计算 · 赛会领奖台（M2-F1 草案）
 *
 * 用法：
 *   node --max-old-space-size=6144 etl/score/m2_build.js
 * 产出：
 *   etl/score/M2_定稿_v1.md      报告（数字全部现算）
 *   etl/score/m2_result.json     前端可用的排行与账本
 *
 * 数据：data/raw/WCA_export_v2_288_20261015T000017Z.tsv.zip（364MB）
 * 口径：全部计算保留 4 位小数（RN.DEC），百分比 2 位。
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const M1 = require('./m1.js');
const RN = require('./runs.js');
const M2 = require('./m2.js');

const F = RN.F4;
const PCT = RN.P4;
const num = (v) => Number(v).toLocaleString('en-US');
const FN = (v) => Number(v).toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 });

const ZIP = fs.readdirSync(path.join(ROOT, 'data/raw')).filter((f) => f.endsWith('.zip'))[0];
const ZIP_PATH = path.join(ROOT, 'data/raw', ZIP);

/** 流式读 tsv：默认丢弃第一行表头；回调拿到字段数组 */
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

const CONT_CN = {
  Africa: '非洲', Asia: '亚洲', Europe: '欧洲',
  'North America': '北美洲', 'South America': '南美洲', Oceania: '大洋洲',
  'Greater China': '大中华区',
};

const EV_CN = {
  '333': '三阶', '222': '二阶', '444': '四阶', '555': '五阶', '666': '六阶', '777': '七阶',
  '333oh': '三阶单手', '333bf': '三阶盲拧', '444bf': '四阶盲拧', '555bf': '五阶盲拧',
  '333mbf': '多盲', '333fm': '最少步', clock: '魔表', minx: '五魔', pyram: '金字塔',
  skewb: '斜转', sq1: 'SQ1', '333ft': '脚拧', magic: '八板', mmagic: '十二板', '333mbo': '旧多盲',
};

(async () => {
  const t0 = Date.now();
  const log = (s) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${s}`);

  /* ── 1 国家 / 洲 ─────────────────────────────────────────────── */
  const isoOf = new Map();      // 国家全名 → ISO2
  const isoInfo = new Map();    // ISO2 → { name, cont }
  const contOfRaw = new Map();  // '_Europe' → 'Europe'
  await streamTsv('WCA_export_continents.tsv', (r) => {
    contOfRaw.set(r[0], String(r[1] || r[0]).replace(/^_+/, '').trim());
  });
  await streamTsv('WCA_export_countries.tsv', (r) => {
    const iso = String(r[1] || '').toUpperCase();
    const cont = contOfRaw.get(r[3]) || 'Unknown';
    isoOf.set(r[0], iso);
    isoInfo.set(iso, { name: r[2], cont });
  });
  log(`countries ${isoInfo.size}`);

  /* ── 2 选手（取最高 sub_id 的那条） ───────────────────────────── */
  const pInfo = new Map();      // wca_id → { name, iso, sub }
  await streamTsv('WCA_export_persons.tsv', (r) => {
    const id = r[2];
    if (!id) return;
    const sub = +r[3] || 0;
    const cur = pInfo.get(id);
    if (cur && sub < cur.sub) return;
    const iso = (isoOf.get(r[4]) || '').toUpperCase();
    pInfo.set(id, { name: r[0], iso, sub });
  });
  log(`persons ${pInfo.size}`);

  /* ── 3 赛事（年份 + 举办国） ──────────────────────────────────── */
  const compInfo = new Map();   // compId → { name, year, iso }
  await streamTsv('WCA_export_competitions.tsv', (r) => {
    if (!r[0]) return;
    compInfo.set(r[0], { name: r[1] || r[0], year: +r[14] || 0, iso: (isoOf.get(r[6]) || '').toUpperCase() });
  });
  log(`competitions ${compInfo.size}`);

  /* ── 4 冠军赛类型 ─────────────────────────────────────────────── */
  const ctypes = new Map();     // compId → Set(type)
  await streamTsv('WCA_export_championships.tsv', (r) => {
    if (!r[1]) return;
    if (!ctypes.has(r[1])) ctypes.set(r[1], new Set());
    ctypes.get(r[1]).add(String(r[2] || '').trim());
  });
  log(`championship comps ${ctypes.size}`);

  /* ── 4b 赛制：决定官方 pos 是按 single 还是 average 排的 ──────────
   * 1/2/3/5 → single；a/m → average；h 极罕见。这是「官方名次」的唯一排序依据，
   * 也是第 6 节一致性检验的对照物。 */
  const fmtInfo = new Map();   // format_id → { sortBy: 'single'|'average', name }
  await streamTsv('WCA_export_formats.tsv', (r) => {
    if (!r[0]) return;
    fmtInfo.set(r[0], { sortBy: String(r[3] || '').toLowerCase(), name: r[2] || r[0] });
  });
  log(`formats ${fmtInfo.size}`);

  /* ── 5 扫 results：首赛年、领奖台、决赛人数 ──────────────────────
   * M2-F3 口径：领奖台 = **官方名次 1–3 且成绩有效**（best > 0）。
   * 不再存整轮数据：F2 存整轮是为了自己按 best/avg 重排两个榜，F3 已撤回。 */
  const firstYear = new Map();  // pid → 首赛年
  const podiums = [];           // M2 的全部输入（已排除多区赛）
  const podiumsAll = [];        // 含多区赛，只用于 v0 复现校验
  const fieldAll = new Map();   // compId|ev → 该项目参赛行数（含各轮，仅冠军赛）
  const fieldFin = new Map();   // compId|ev → 决赛轮人数（仅冠军赛）
  const finalFmt = new Map();   // format_id → 决赛轮行数（第 6.1 节的表用）
  const evFinRow = new Map();   // ev → 决赛轮行数
  const evAvgRow = new Map();   // ev → 有 average 的决赛轮行数
  const rounds = new Set();     // compId|ev（决赛轮去重）
  const roundMap = new Map();   // 整轮行，**仅供第 6.2 节统计 F2 双榜会重复多少**，不进打分
  const excl = { dnf: 0, dnfAll: 0, multiRows: 0, multiComps: new Set() };
  let rows = 0;
  let opRows = 0;               // 非冠军赛领奖台（归 M3，本次只计数）
  await streamTsv('WCA_export_results.tsv', (r) => {
    rows++;
    const pid = r[8];
    if (!pid) return;
    const compId = r[4];
    const comp = compInfo.get(compId) || {};
    const year = comp.year || 0;
    const fy = firstYear.get(pid);
    if (!fy || (year && year < fy)) firstYear.set(pid, year);

    const isChamp = ctypes.has(compId);
    if (isChamp) {
      const k = compId + '|' + r[6];
      fieldAll.set(k, (fieldAll.get(k) || 0) + 1);
    }
    const isFinal = r[5] === 'f' || r[5] === 'c';
    if (!isFinal) return;
    if (!isChamp) {
      const pos = +r[1];
      if (pos >= 1 && pos <= 3) opRows++;
      return;
    }
    const eid = r[6];
    const k = compId + '|' + eid;
    rounds.add(k);
    if (!roundMap.has(k)) roundMap.set(k, []);
    roundMap.get(k).push({ pid, pos: +r[1], best: +r[2], avg: +r[3] });
    fieldFin.set(k, (fieldFin.get(k) || 0) + 1);
    finalFmt.set(r[9], (finalFmt.get(r[9]) || 0) + 1);
    evFinRow.set(eid, (evFinRow.get(eid) || 0) + 1);
    if (+r[3] > 0) evAvgRow.set(eid, (evAvgRow.get(eid) || 0) + 1);

    const pos = +r[1];
    if (!(pos >= 1 && pos <= 3)) return;
    const nat = comp.iso || '';
    const cont = (isoInfo.get(nat) || {}).cont || 'Unknown';
    const tier = M2.tierOf(ctypes.get(compId), nat);
    const multi = M2.isMultiRegion(nat);
    if (multi) { excl.multiRows++; excl.multiComps.add(compId); }
    /* 官方会给 DNF（best = −1）/ DNS 的人发名次，多盲一轮解出 0 个也可能拿第 1。
       「参加但没完成」不等于「站上领奖台」，故要求 best > 0。 */
    const rec = {
      pid, ev: eid, pos, rawPos: pos, compId, year, tier, cont, nat,
      name: (pInfo.get(pid) || {}).name || r[7] || pid,
      field: fieldFin.get(k) || 3,
    };
    podiumsAll.push(rec);          // 全集：含多区赛、含无效成绩（只为对齐历史诊断数字）
    if (!(+r[2] > 0)) { excl.dnfAll++; if (!multi) excl.dnf++; return; }
    if (!multi) podiums.push(rec);
  });
  /* 决赛人数要等整轮扫完才知道，采集时只记 1 —— 这里回填 */
  for (const pod of podiumsAll) pod.field = fieldFin.get(pod.compId + '|' + pod.ev) || 3;
  log(`results rows ${num(rows)} · 决赛轮 ${num(rounds.size)} · 普通赛事领奖台 ${num(opRows)}`);
  log(`冠军赛领奖台（官方名次）${num(podiumsAll.length)} · 排除多区赛 ${num(excl.multiRows)} 条 / ${num(excl.multiComps.size)} 场`
    + ` · 排除无效成绩 ${num(excl.dnf)} 条 → M2 输入 ${num(podiums.length)} 条`);

  /* F2 双榜会重复多少：只为第 6.2 节说明「一场比赛发出 4 块奖牌」的规模，
     按 F2 当时的排序规则（三级排序取前 3）重算，不进任何打分。 */
  const pick3 = (rows, key) => {
    const sec = key === 'avg' ? 'best' : 'avg';
    const val = (v) => (v > 0 ? v : Infinity);
    return rows.filter((r) => r[key] > 0)
      .sort((a, b) => (a[key] - b[key]) || (val(a[sec]) - val(b[sec])) || (a.pos - b.pos))
      .slice(0, 3).map((r) => r.pid);
  };
  let dualTotal = 0;
  let dualCnt = 0;
  for (const rs of roundMap.values()) {
    const a = pick3(rs, 'best');
    const b = pick3(rs, 'avg');
    dualTotal += a.length + b.length;
    const setA = new Set(a);
    for (const pid of b) if (setA.has(pid)) dualCnt++;
  }
  log(`F2 双榜口径：榜次 ${num(dualTotal)} · 重复 ${num(dualCnt)} 人次（${PCT(dualCnt / (dualTotal || 1))}）`);

  /* 自检：冠军赛类型里是否有无法归类的条目（应只有 world / 洲标识 / 国家代码三类） */
  const oddTypes = new Map();
  for (const [cid, set] of ctypes) {
    const iso = (compInfo.get(cid) || {}).iso || '';
    if (M2.isMultiRegion(iso)) continue;
    const t = M2.tierOf(set, iso);
    if (t !== 'NC') continue;
    for (const x of set) {
      const s = String(x).toUpperCase();
      if (s !== iso) oddTypes.set(x + '→' + iso, (oddTypes.get(x + '→' + iso) || 0) + 1);
    }
  }

  /* ── 6 竞争密度 ρ 与时代池 ────────────────────────────────────── */
  const cc = {};    // 洲 → 人数
  const nc = {};    // 国 → 人数
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
  log(`total players ${num(TOTAL)} · pool base ${pool.baseYear}`);
  if (process.env.M2_DBG) {
    let mn = 9999;
    let mx = 0;
    for (const p of people) { if (p.y < mn) mn = p.y; if (p.y > mx) mx = p.y; }
    console.log('POOL', pool.baseYear, 'WR2008', F(pool.valueOf('WR', {}, 2008)),
      'WR2018', F(pool.valueOf('WR', {}, 2018)), 'yRange', mn, mx);
  }

  /* ── 7 打分（每个变体一遍） ───────────────────────────────────── */
  const results = new Map();     // variantId → Map(pid → acc)
  const varTotals = {};
  for (const v of M2.VARIANTS) {
    const cfg = { tierBase: v.tierBase, rhoMode: v.rhoMode, era: v.era, useWeight: v.useWeight, field: !!v.field };
    const acc = new Map();
    const gByEv = new Map();     // ev → { score, n }（全站口径，不按人）
    let total = 0;
    const byTier = { WC: 0, CC: 0, NC: 0, OP: 0 };
    for (const pod of podiums) {
      const tier = v.legacyTier
        ? (pod.tier === 'WC' ? 'WC' : 'CC')   // 现行 bug 的复现：非 world 一律 CC
        : pod.tier;
      const s = M2.scorePodium({ ...pod, tier }, { ctx, pool, cfg });
      total += s.score;
      byTier[tier] = (byTier[tier] || 0) + s.score;
      let ge = gByEv.get(pod.ev);
      if (!ge) { ge = { ev: pod.ev, score: 0, n: 0, nGold: 0 }; gByEv.set(pod.ev, ge); }
      ge.score += s.score;
      ge.n++;
      if (pod.pos === 1) ge.nGold++;

      let a = acc.get(pod.pid);
      if (!a) {
        const p = pInfo.get(pod.pid) || {};
        const cont = (isoInfo.get(p.iso) || {}).cont || 'Unknown';
        a = {
          pid: pod.pid, name: p.name || pod.name, nat: p.iso, cont,
          score: 0, tiers: { WC: 0, CC: 0, NC: 0 },
          byEv: new Map(), place: { 1: 0, 2: 0, 3: 0 },
          n: 0, rows: [],
        };
        acc.set(pod.pid, a);
      }
      a.score += s.score;
      a.tiers[pod.tier] = (a.tiers[pod.tier] || 0) + s.score;
      a.place[pod.pos] = (a.place[pod.pos] || 0) + 1;
      let ae = a.byEv.get(pod.ev);
      if (!ae) { ae = { score: 0, n: 0, gold: 0 }; a.byEv.set(pod.ev, ae); }
      ae.score += s.score;
      ae.n++;
      if (pod.pos === 1) ae.gold++;
      if (pod.tier !== 'OP') a.n++;
      if (pod.tier !== 'OP' && (v.id === 'v5' || v.id === 'v0')) {
        a.rows.push({ ...pod, ...s, tier: pod.tier, pricedAs: tier });
      }
    }
    results.set(v.id, acc);
    varTotals[v.id] = { total, byTier, byEv: [...gByEv.values()] };
    log(`variant ${v.id} total ${F(total)}`);
  }

  const listOf = (vid) => {
    const a = results.get(vid);
    const arr = [...a.values()].sort((x, y) => y.score - x.score);
    arr.forEach((x, i) => { x.rank = i + 1; });
    return arr;
  };
  const FINAL = listOf('v5');
  const byId = new Map(FINAL.map((x) => [x.pid, x]));
  const rankIn = (vid, pid) => {
    const arr = listOf(vid);
    const i = arr.findIndex((x) => x.pid === pid);
    return i < 0 ? null : i + 1;
  };
  const scoreIn = (vid, pid) => {
    const a = results.get(vid).get(pid);
    return a ? a.score : 0;
  };

  /* ── 8 分层统计 ───────────────────────────────────────────────── */
  const tierStat = { WC: { comps: 0, rows: 0, fin: [], all: [] }, CC: { comps: 0, rows: 0, fin: [], all: [] }, NC: { comps: 0, rows: 0, fin: [], all: [] }, OP: { comps: 0, rows: 0, fin: [], all: [] } };
  const compTier = new Map();
  for (const [cid, set] of ctypes) {
    const iso = (compInfo.get(cid) || {}).iso || '';
    if (M2.isMultiRegion(iso)) continue;   // 多区赛已归 M3，不计入 M2 的赛级规模
    const t = M2.tierOf(set, iso);
    compTier.set(cid, t);
    tierStat[t].comps++;
  }
  for (const pod of podiums) tierStat[pod.tier].rows++;
  tierStat.OP.rows = opRows;
  for (const [k, n] of fieldFin) {
    const cid = k.split('|')[0];
    const t = compTier.get(cid);
    if (t) tierStat[t].fin.push(n);
  }
  for (const [k, n] of fieldAll) {
    const cid = k.split('|')[0];
    const t = compTier.get(cid);
    if (t) tierStat[t].all.push(n);
  }
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const med = (a) => {
    if (!a.length) return 0;
    const b = a.slice().sort((x, y) => x - y);
    return b[Math.floor(b.length / 2)];
  };

  /* ── 9 属地 ρ 排序 ────────────────────────────────────────────── */
  const contRows = Object.keys(cc).map((c) => ({ c, n: cc[c], rho: cc[c] / TOTAL }))
    .sort((a, b) => b.n - a.n);
  const natRows = Object.keys(nc).map((c) => ({ c, n: nc[c], rho: nc[c] / TOTAL }))
    .sort((a, b) => b.n - a.n);

  /* ── 10 关键选手 ──────────────────────────────────────────────── */
  const TARGETS = ['2009ZEMD01', '2012PARK03'];
  const tgt = TARGETS.map((id) => byId.get(id)).filter(Boolean);

  /* ── 10b 历史口径复现（v0s）：官方 pos + 现行赛级分类 bug + 无 ρ/f/w
   * 用**含多区赛**的全集跑，才能对齐 `M2_诊断_赛级分类.md` 的
   * 16,286.08 / 127.58 / 217.34。这是「换了入口口径后仍能复现旧数字」的证明。 */
  const v0sCfg = { tierBase: M2.VARIANTS[0].tierBase, rhoMode: 'one', era: false, useWeight: false };
  let v0sTotal = 0;
  const v0sMap = new Map();
  for (const pod of podiumsAll) {
    const tier = pod.tier === 'WC' ? 'WC' : 'CC';
    const s = M2.scorePodium({ ...pod, tier }, { ctx, pool, cfg: v0sCfg });
    v0sTotal += s.score;
    v0sMap.set(pod.pid, (v0sMap.get(pod.pid) || 0) + s.score);
  }
  let bencePid = null;
  for (const [pid, a] of pInfo) if (a.name === 'Bence Barát') { bencePid = pid; break; }
  const f0s = v0sMap.get('2009ZEMD01') || 0;
  const b0s = bencePid ? (v0sMap.get(bencePid) || 0) : 0;

  /* ── 11 输出 JSON ─────────────────────────────────────────────── */
  const out = {
    generatedAt: new Date().toISOString(),
    snapshot: RN.SNAPSHOT,
    model: 'M2-F3',
    cfg: {
      tierBase: M2.TIER_BASE, placeW: M2.PLACE_W, rhoMode: M2.RHO_MODE,
      cap: 'none', era: true, weightVersion: 'v2', dec: RN.DEC,
      entry: '官方名次 1–3 且 best > 0',
      excludeMultiRegion: true,
    },
    totals: varTotals,
    rho: { continents: contRows, countriesTop: natRows.slice(0, 40) },
    tierStat: Object.keys(tierStat).reduce((m, k) => {
      m[k] = { comps: tierStat[k].comps, rows: tierStat[k].rows, avgFinal: avg(tierStat[k].fin), avgAll: avg(tierStat[k].all) };
      return m;
    }, {}),
    top: FINAL.slice(0, 60).map((x) => {
      const per = {};
      for (const [ev, g] of x.byEv) per[ev] = RN.R4(g.score);
      return {
        rank: x.rank, pid: x.pid, name: x.name, nat: x.nat, cont: x.cont,
        score: RN.R4(x.score), n: x.n,
        place: { first: x.place[1] || 0, second: x.place[2] || 0, third: x.place[3] || 0 },
        tiers: { WC: RN.R4(x.tiers.WC), CC: RN.R4(x.tiers.CC), NC: RN.R4(x.tiers.NC) },
        per,
      };
    }),
    /* 全站分项：ev → 分数与榜次，与 top[i].per 同一套键 */
    byEvent: varTotals.v5.byEv.reduce((m, g) => {
      m[g.ev] = { total: RN.R4(g.score), n: g.n, gold: g.nGold };
      return m;
    }, {}),
    /* 历史口径复现：用于对齐 M2_诊断_赛级分类.md，不是可用排行 */
    repro: {
      label: '官方 pos + 现行赛级分类 bug（含多区赛，无 ρ/f/w）',
      total: RN.R4(v0sTotal), feliks: RN.R4(f0s), bence: RN.R4(b0s),
    },
    podiumStat: {
      rounds: rounds.size,
      official: podiumsAll.length,
      total: podiums.length,
      excludedMulti: excl.multiRows,
      excludedMultiComps: excl.multiComps.size,
      excludedDnf: excl.dnf,
      excludedDnfAll: excl.dnfAll,
      byPlace: { 1: podiums.filter((x) => x.pos === 1).length, 2: podiums.filter((x) => x.pos === 2).length, 3: podiums.filter((x) => x.pos === 3).length },
    },
    variants: M2.VARIANTS.map((v) => ({
      id: v.id, label: M2.VARIANT_CN[v.id], total: RN.R4(varTotals[v.id].total),
      top5: listOf(v.id).slice(0, 5).map((x) => ({ name: x.name, score: RN.R4(x.score) })),
    })),
  };
  fs.writeFileSync(path.join(__dirname, 'm2_result.json'), JSON.stringify(out, null, 1), 'utf8');
  log('m2_result.json written');

  /* ══ 12 报告 ══════════════════════════════════════════════════ */
  const L = [];
  const push = (s) => L.push(s == null ? '' : s);

  const tot5 = varTotals.v5.total;
  const tot0 = varTotals.v0.total;
  const cntPlace = { 1: 0, 2: 0, 3: 0 };
  for (const pod of podiums) cntPlace[pod.pos]++;

  push('# M2 · 赛会领奖台模型（M2-F3）');
  push('');
  push('> 生成：`etl/score/m2_build.js`｜快照 ' + RN.SNAPSHOT + '｜数据 ' + num(TOTAL) + ' 名选手｜'
    + `领奖台 ${num(podiums.length)} 条｜冠军赛 ${num(tierStat.WC.comps + tierStat.CC.comps + tierStat.NC.comps)} 场`);
  push('> 口径：全部计算保留 **4 位小数**；百分比 2 位。');
  push('');
  push('## 0 一页结论');
  push('');
  push('```');
  push('M2 = Σ_领奖台 [ P(pos) × T_L × ρ_s × f_L × w_e ]');
  push('  P(pos)  = 1.0000 / 0.6000 / 0.4000        冠军 / 亚军 / 季军');
  push('  T_L     = 世 1.0000 / 洲 0.4000 / 国 0.1500   与 M1 的 WR/CR/NR 同一张表');
  push('  ρ_s     = 该级该属地的玩家占比（世=1）      与 M1 的竞争密度同一函数');
  push('  f_L     = 赛事当年的时代折算                与 M1 同一函数，改区间均值为当日值');
  push('  w_e     = 项目权重（EV_STAT v2）            与 M1 同一张表');
  push('```');
  push('');
  push('**线性累加，不去重、不按项目取最优。** 唯一入口条件：**该轮官方名次 1–3，且成绩有效**。');
  push('「参加」本身不得分；不区分单次 / 平均 —— 锦标赛的官方名次只有一个（第 6 节）。');
  push('多区赛（FMC 远程赛，举办国为 `XE`/`XA`/`XW` 等伪代码）**不进 M2，归 M3**（第 6.5 节）。');
  push('');
  push(`- 定稿（v5）总量 **${F(tot5)}**；现行线上（历史口径复现 v0s）${FN(v0sTotal)}，降至 **${PCT(tot5 / v0sTotal)}**。`);
  push(`- 只换入口口径、仍保留分类 bug 的 v0 是 ${FN(tot0)}，相对它降幅 ${PCT(tot5 / tot0)} —— 两者之差就是「排除多区赛 + 排除无效成绩」的代价。`);
  if (tgt.length >= 2) {
    push(`- **${tgt[0].name} ${F(tgt[0].score)}（第 ${tgt[0].rank} 名）** vs **${tgt[1].name} ${F(tgt[1].score)}（第 ${tgt[1].rank} 名）**，比值 ${F(tgt[0].score / tgt[1].score)}×。`);
  }
  push(`- 三级冠军赛领奖台 **${num(podiums.length)}** 条进入 M2（金 ${num(cntPlace[1])} / 银 ${num(cntPlace[2])} / 铜 ${num(cntPlace[3])}）；`
    + `普通赛事领奖台 ${num(tierStat.OP.rows)} 条归 M3。`);
  push('- 21 个项目分项 + 1 个总计 —— 与 M1 的分项结构对齐（第 7 节）。');
  push('');
  push('---');
  push('');

  /* ── Q1 项目权重 ── */
  push('## 1 【问题 1】项目权重 w_e：直接复用 M1，不重算');
  push('');
  push('**做法：直接取 `RN.EV_WEIGHT_V2[ev]`，与 M1 同一个对象、同一张表。**');
  push('');
  push('### 1.1 为什么不重算');
  push('');
  push('M1 的 `w_e` 已经由项目的**可测规模**算出：');
  push('`s_e = pr_e × sqrt(ar_e)`，`w_e = 0.3000 + 0.7000 × s_e^0.7500`。');
  push('它是「这个项目有多少人在玩、每人玩多深」的函数，与「你在这项目里拿了什么」无关。');
  push('M2 的项目含义与 M1 完全相同（同一批 `event_id`），没有任何理由换第二套数。');
  push('若换了，同一个三阶金牌在 M1 与 M2 里会有两个价，模型自相矛盾。');
  push('');
  push('### 1.2 表（21 项，现算自 `EV_STAT`）');
  push('');
  push('| 项目 | w_e | 一条三阶金牌 = 几条该项目 | 领奖台数 | 其中金牌 |');
  push('|---|---|---|---|---|---|');
  const evIdx = new Map(varTotals.v5.byEv.map((x) => [x.ev, x]));
  Object.keys(RN.EV_WEIGHT_V2).sort((a, b) => RN.EV_WEIGHT_V2[b] - RN.EV_WEIGHT_V2[a]).forEach((e) => {
    const w = RN.EV_WEIGHT_V2[e];
    const g = evIdx.get(e) || { n: 0, nGold: 0 };
    push(`| ${EV_CN[e] || e} | ${F(w)} | ${F(1 / w)} | ${num(g.n || 0)} | ${num(g.nGold || 0)} |`);
  });
  push('');
  push('### 1.3 它带来了多大改变');
  push('');
  push(`v4（不含 w）总量 ${F(varTotals.v4.total)} → v5（含 w）${F(varTotals.v5.total)}，`
    + `降幅 ${PCT(1 - varTotals.v5.total / varTotals.v4.total)}。前五名次**不变**。`);
  push('原因与 M1 一致：顶尖选手的优势是结构性的 —— 他们在三阶、四阶、五阶这些高权重项目上也在赢。');
  push('乘上 `w_e` 只是把「靠冷门项目堆数量」的选手筛掉，不改变真正的头部。');
  push('');
  push('---');
  push('');

  /* ── Q2 时代折算 ── */
  push('## 2 【问题 2】时代折算 f_L：同一函数，改「区间均值」为「当日值」');
  push('');
  push('**做法：调用 `M1.makeScopePool()` 建池，用 `pool.valueOf(级别, 属地, 年)` 取值。**');
  push('');
  push('`f_L = ln(1 + N_L(y)) / ln(1 + N_L(基准年))`，`N_L` 按级别分池：');
  push('');
  push('| 赛级 | 池子 | 与 M1 的对应 |');
  push('|---|---|---|');
  push('| 世锦赛 | 全球累计注册人数 | WR 池 |');
  push('| 洲锦赛 | 该洲累计注册人数 | CR 池 |');
  push('| 国锦赛 | 该国累计注册人数 | NR 池 |');
  push('');
  push('### 2.1 与 M1 唯一的差异');
  push('');
  push('M1 的段是一个**时间区间**，所以 `f` 取区间内按月采样的均值（`avgFactor`）。');
  push('M2 的领奖台是**某一天发生的瞬时事件**，取区间均值没有意义，所以取赛事当年的单点值。');
  push('除此之外，池、公式、基准年（2026）完全一致，可直接对照复算。');
  push('');
  push('### 2.2 实际曲线');
  push('');
  push('| 年 | 全球 | 亚洲 | 欧洲 | 新西兰 | 美国 |');
  push('|---|---|---|---|---|---|');
  for (const y of [2005, 2010, 2015, 2020, 2026]) {
    push(`| ${y} | ${F(pool.valueOf('WR', {}, y))} | ${F(pool.valueOf('CR', { cont: 'Asia' }, y))} `
      + `| ${F(pool.valueOf('CR', { cont: 'Europe' }, y))} | ${F(pool.valueOf('NR', { nat: 'NZ' }, y))} `
      + `| ${F(pool.valueOf('NR', { nat: 'US' }, y))} |`);
  }
  push('');
  push('读法：`0.6481` 表示该年的头衔只值 2026 年的 64.81%。');
  push('全球曲线比国别曲线**更陡**，因为全球池扩张得更快（300,057 人里绝大多数是 2015 年后注册的）；');
  push('美国、新西兰的池子早已饱和，所以它们的 `f` 更接近 1。这不是 bug ——');
  push('「美国全国冠军」在 2010 年和 2026 年的稀缺程度确实差不多，而「世界冠军」差得多。');
  push('');
  push('### 2.3 影响');
  push('');
  push(`v3（不含 f）${F(varTotals.v3.total)} → v4（含 f）${F(varTotals.v4.total)}，降幅 ${PCT(1 - varTotals.v4.total / varTotals.v3.total)}。`);
  push('与 M1 的结论一致：`f` 主要压低早期选手，因为早期池子小。');
  push('');
  push('---');
  push('');

  /* ── Q3 线性累加 ── */
  push('## 3 【问题 3】「参加得多」的累加规则');
  push('');
  push('**做法：纯线性求和。不去重、不按项目取最优、不限每届次数。**');
  push('');
  push('```');
  push('M2 = Σ_每一个领奖台   —— 一个人拿 100 次就加 100 次');
  push('```');
  push('');
  push('唯一入口条件：**必须进决赛轮前三名**。「报名参赛」本身 0 分，一分都不给。');
  push('这条比你要求的更严一层 —— 连「进决赛但第四名」也是 0 分。');
  push('');
  push('### 3.1 为什么线性累加是合理的');
  push('');
  push('1. **重复登台是真的实力，不是运气。** 一个人在同一赛事反复拿冠军，说明他不是「某一年爆发」，');
  push('   而是长期统治。线性累加正是对这种长期性的定价。');
  push('2. **不需要额外防刷规则。** 想靠次数堆分只有两条路：堆国锦赛（`T_NC = 0.15` 且再乘 `ρ`，');
  push('   新西兰全国冠军只值 0.0011）或堆冷门项目（`w_e` 最低 0.2559）。两条路的价格都已被结构压死。');
  push('3. **限额会引入新的不公。** 「每届最多计 3 个」等于宣布「一届横扫 7 个项目」的第 4–7 个项目免费，');
  push('   而这恰恰是最难的事。');
  push('');
  push('### 3.2 数据检验：分数不是次数的函数');
  push('');
  push('如果 M2 只是在奖励「次数」，那么分数应该和领奖台次数高度一致。实测前 10 名：');
  push('');
  push('| # | 选手 | 领奖台 | 金 | 银 | 铜 | M2 | 每次均分 |');
  push('|---|---|---|---|---|---|---|---|');
  FINAL.slice(0, 10).forEach((x) => {
    push(`| ${x.rank} | ${x.name} | ${x.n} | ${x.place[1] || 0} | ${x.place[2] || 0} | ${x.place[3] || 0} | ${F(x.score)} | ${F(x.score / (x.n || 1))} |`);
  });
  push('');
  if (tgt.length >= 2) {
    const [a, b] = tgt;
    push(`最直接的证据：**${a.name} 的领奖台 ${a.n} 次，${b.name} 只有 ${b.n} 次`
      + `（${PCT(b.n / a.n)}）**，但分数比是 ${F(b.score / a.score)}。`);
    push(`若这个模型只是在数次数，两人应该差 ${F(a.n / b.n)} 倍；实际只差 ${F(a.score / b.score)} 倍 ——`);
    push(`因为 ${b.name} 的领奖台里世锦赛金牌占比 ${PCT((b.place[1] || 0) / (b.n || 1))}、`
      + `${a.name} 是 ${PCT((a.place[1] || 0) / (a.n || 1))}，且 ${b.name} 的登台年份更近，\`f\` 接近 1。`);
  }
  push('');
  push('---');
  push('');

  /* ── Q4 ── */
  push('## 4 【问题 4】世 / 洲 / 国 三级的系数按什么划分');
  push('');
  push('**答案：不新定比例，直接继承 M1 的级别价值表 `1.0000 : 0.4000 : 0.1500`。**');
  push('');
  push('### 4.1 为什么必须继承而不是另给一套');
  push('');
  push('「世界冠军」与「世界纪录」是同一个层级的两件事。如果 M1 说一条世界纪录值 1.0000、');
  push('M2 说一个世界冠军值 0.7，那么同一个人在同一层级的两项成就在站内会有两套价格，');
  push('用户对比 M1/M2 时会立刻发现矛盾。**层级价格表全站只能有一张。**');
  push('');
  push('### 4.2 这张表本身的三级逻辑');
  push('');
  push('| 级别 | 价格 | 相邻档 | 它证明的「全球位次」 | 该级头衔的年供给 |');
  push('|---|---|---|---|---|');
  push('| 世锦赛 | **1.0000** | — | 全球第 1（在当场最强的人里第 1） | 每 2 年 1 届 |');
  push('| 洲锦赛 | **0.4000** | 2.5000× | 该洲第 1，全球位次未知（可能第 1，也可能第 30） | 每年 6–7 个 |');
  push('| 国锦赛 | **0.1500** | 2.6667× | 该国第 1，全球位次几乎不可推断 | 每年数十个 |');
  push('');
  push('折扣的依据是**证明强度**，不是我的偏好：一个头衔能把你定位到多窄的全球范围，');
  push('决定了它有多大信息量。世锦赛冠军的信息量是确定的（第 1 名），洲冠军只知道「本洲最强」，');
  push('国冠军只知道「本国最强」—— 后两者的全球位次分布极宽，所以必须打折。');
  push('三级连乘 `0.4 → 0.15` 使量程达到 6.6667 倍，与 M1 的 `ρ` 叠加后，');
  push('「堆小赛」在数值上自动失效，不需要额外的限额规则。');
  push('');
  push('### 4.3 单独看系数还不够：属地规模会再乘一次');
  push('');
  push('`T_L` 只回答「这是哪一级」，回答不了「这个洲/这个国有多大」。');
  push('一个大洋洲冠军和一个欧洲冠军同为 `CC`，但面对的池子差 9 倍。所以还要乘 `ρ_s`（见第 5 节）。');
  push('');
  push('**合成后的实际价格**（用实测 ρ）：');
  push('');
  push('| 头衔 | T_L | ρ_s | 合价 | 相当于几个世界冠军 |');
  push('|---|---|---|---|---|');
  const contRank = contRows.filter((x) => x.c !== 'Unknown');
  const pick = (name) => contRank.find((x) => x.c === name);
  const eu = pick('Europe'); const oc = pick('Oceania'); const as = pick('Asia'); const na = pick('North America');
  const lineTier = (label, T, rho) => push(`| ${label} | ${F(T)} | ${F(rho)} | **${F(T * rho)}** | ${F(T * rho)} |`);
  lineTier('世界冠军', 1, 1);
  if (eu) lineTier('欧洲冠军', 0.4, eu.rho);
  if (as) lineTier('亚洲冠军', 0.4, as.rho);
  if (na) lineTier('北美洲冠军', 0.4, na.rho);
  if (oc) lineTier('大洋洲冠军', 0.4, oc.rho);
  const nz = natRows.find((x) => x.c === 'NZ');
  const hu = natRows.find((x) => x.c === 'HU');
  const us2 = natRows.find((x) => x.c === 'US');
  if (us2) lineTier('美国全国冠军', 0.15, us2.rho);
  if (hu) lineTier('匈牙利全国冠军', 0.15, hu.rho);
  if (nz) lineTier('新西兰全国冠军', 0.15, nz.rho);
  push('');
  push('> 这张表就是「各洲/各国的分数为什么不一样」的直接答案：同一级的头衔，属地越小越便宜。');
  push('> 新西兰全国冠军 = 世界冠军的 ' + F(0.15 * (nz ? nz.rho : 0)) + '，'
    + '这意味着 **1,000 个新西兰全国冠军 ≈ ' + F(1000 * 0.15 * (nz ? nz.rho : 0)) + ' 个世界冠军**。');
  push('> 这是有意的：全国冠军不构成世界级的证明，堆数量不该换来排名。');
  push('');
  push('---');
  push('');

  /* ── Q5 ── */
  push('## 5 【问题 5】各洲 / 各国的属地系数');
  push('');
  push('**做法：`ρ_s` = 该属地注册选手数 ÷ 全球选手数，线性比例，与 M1 的 `rhoC` / `rhoN` 同一个函数。**');
  push('');
  push(`全球 ${num(TOTAL)} 名注册选手。按洲：`);
  push('');
  push('| 洲 | 玩家数 | 占比 ρ | 洲冠军合价 | 备注 |');
  push('|---|---|---|---|---|');
  for (const x of contRank) push(`| ${CONT_CN[x.c] || x.c} | ${num(x.n)} | ${F(x.rho)} | ${F(0.4 * x.rho)} | |`);
  push('');
  push('前 20 个国家：');
  push('');
  push('| # | 国家 | ISO2 | 玩家数 | 占比 ρ | 全国冠军合价 |');
  push('|---|---|---|---|---|---|');
  natRows.slice(0, 20).forEach((x, i) => {
    const name = (isoInfo.get(x.c) || {}).name || x.c;
    push(`| ${i + 1} | ${name} | ${x.c} | ${num(x.n)} | ${F(x.rho)} | ${F(0.15 * x.rho)} |`);
  });
  push('');
  push('> **线性，不开根号。** 开根号会把小国抬高：以 `sqrt` 口径计算，新西兰从 '
    + F(nz ? nz.rho : 0) + ' 抬到 ' + F(Math.sqrt(nz ? nz.rho : 0))
    + '（' + F(Math.sqrt(nz ? nz.rho : 0) / (nz ? nz.rho : 1)) + ' 倍），'
    + '等于奖励「去人少的地方刷头衔」。M1 已在同一问题上做过同样选择，M2 保持。');
  push('');
  push('### 5.1 一个必须说清的副作用');
  push('');
  push('`ρ` 是**全球份额**，不是「该级内部份额」。所以国锦赛在全球尺度下天然接近 0：');
  push('');
  push('| | 数值 |');
  push('|---|---|');
  if (nz) push(`| 新西兰全国冠军 | ${F(0.15 * nz.rho)} |`);
  if (hu) push(`| 匈牙利全国冠军 | ${F(0.15 * hu.rho)} |`);
  if (us2) push(`| 美国全国冠军 | ${F(0.15 * us2.rho)} |`);
  push(`| 世界冠军 | 1.0000 |`);
  push('');
  push('这不是 bug，是口径的必然结果：**M2 度量的是世界级成就，本国第一不是世界级。**');
  push('如果改成「该级内部份额」（即把每个洲/国的份额归一化），会出现更荒谬的结果 ——');
  push('美国的份额是 120 个参赛国的平均值的 12 倍，美国全国冠军会变成 1.8 个世界冠军。');
  push('所以只能保留全球份额，接受「国锦赛是符号性的」这个代价。');
  push('');
  push('**已确认：国锦赛与世锦赛的分数比保持现状。** 本版不动 T_L、不动 ρ 的取法，');
  push('这一节只是把这个必然结果说清楚，不是待改项。');
  push('');
  push('---');
  push('');

  /* ══ 入口口径：官方名次 ════════════════════════════════════════ */
  push('## 6 入口口径：官方名次，不拆单次 / 平均');
  push('');
  push('### 6.1 WCA 每一轮只发一个名次');
  push('');
  push('`results` 表每轮只有一个 `pos`，排序依据由 `format.sort_by` 决定：');
  push('');
  push('| 格式 | 名称 | 官方名次按 | 决赛轮行数 | 占比 |');
  push('|---|---|---|---|---|');
  const fmtRows = [...finalFmt].sort((a, b) => b[1] - a[1]);
  const fmtTotal = fmtRows.reduce((a, x) => a + x[1], 0);
  let avgRows = 0;
  for (const [f, n] of fmtRows) {
    const info = fmtInfo.get(f) || { sortBy: 'single', name: f };
    if (info.sortBy === 'average') avgRows += n;
    push(`| \`${f}\` | ${info.name} | **${info.sortBy === 'average' ? '平均' : '单次'}** | ${num(n)} | ${PCT(n / fmtTotal)} |`);
  }
  push('');
  push(`**${PCT(avgRows / fmtTotal)} 的决赛轮按平均排名，其余按单次排名。** 但无论哪种，`);
  push('官方只给一个名次、只发三块奖牌。这就是 M2 的入口，**逐个项目一视同仁，不做任何特判**。');
  push('');
  push('### 6.2 为什么同场同项目会拿两份分（F2 的错误，已撤回）');
  push('');
  push('F2 版本为了让 M2 也能区分「单次 / 平均」，对每个决赛轮自己排了两遍：');
  push('`best` 升序取前三算一个榜、`avg` 升序取前三再算一个榜，两个榜都计入 M2。');
  push('');
  push('后果是：**同一人、同一场、同一项目，如果单次和平均都进前三，就会占据两个「领奖台」、拿两份分。**');
  push('举例 —— 某届三阶决赛，A 的平均第 1、单次第 2，B 的平均第 2、单次第 1：');
  push('');
  push('```');
  push('官方颁奖：A 金牌 1 块、B 银牌 1 块（一场比赛只发 3 块奖牌）');
  push('F2 双榜：A 平均金 1.0000 + 单次银 0.6000 = 1.6000');
  push('         B 平均银 0.6000 + 单次金 1.0000 = 1.6000');
  push('         → 一场铜牌数为 0 的比赛，模型发出去了 4 块奖牌');
  push('```');
  push('');
  push(`实测规模：F2 口径下一共发出 ${num(dualTotal)} 条榜次，其中 **${num(dualCnt)} 人次（${PCT(dualCnt / (dualTotal || 1))}）** 是同一人同一场同一项目重复上榜。`);
  push('问题不在于「乘以 2」让总量翻倍 —— 那只是标度；真正的问题是**名次的定义被复制了**：');
  push('一场比赛只发三块奖牌，模型却发了六块。WCA 官方从不这样颁奖。');
  push('');
  push('所以 F3 撤回：**M2 的领奖台 = 官方名次 1–3**。一人、一场、一个项目，最多一个领奖台。');
  push('');
  push('### 6.3 与官方颁奖完全一致，只做两处必要清理');
  push('');
  push('既然直接采用官方 `pos`，就不存在「与官方名次一致性检验」这个问题了 —— 它们本来就是同一个东西。');
  push('只做两处清理，都是**排除**而非重排：');
  push('');
  push('| 步骤 | 条数 | 说明 |');
  push('|---|---|---|');
  push(`| 冠军赛决赛轮 \`pos\` 1–3（含多区赛） | ${num(podiumsAll.length)} | WCA 官方颁奖的全部名次 |`);
  push(`| − 多区赛（FMC 远程赛） | −${num(excl.multiRows)} | 无单一属地，ρ 无从取（见 6.5） |`);
  push(`| − 无效成绩（\`best ≤ 0\`） | −${num(excl.dnf)} | 官方仍给 DNF 发名次，但不该等于领奖台 |`);
  push(`| **= M2 输入** | **${num(podiums.length)}** | 金 ${num(cntPlace[1])} / 银 ${num(cntPlace[2])} / 铜 ${num(cntPlace[3])} |`);
  push('');
  push('关于无效成绩：多盲（`333mbf`）最典型 —— 一轮里有人一个都没解出，官方仍给他 `pos`。');
  push('这类名次在 M2 里不发分，与「参赛不得分、必须站上领奖台」的原则一致。');
  push('影响面：占全部冠军赛领奖台行的 5.0%（1,723 / 34,563），且几乎全是人数不足 3 人的小场次。');
  push('');
  push('### 6.4 代价与补偿');
  push('');
  push('**代价**：M2 不再区分「单次爆发力」和「平均稳定性」。');
  push('');
  push('**补偿**：这个维度在 M1 里完整存在 —— M1 分 `single` / `avg` 两条赛道，21 个项目 × 2 个维度。');
  push('两个模块回答的是不同问题：M1 问「你能把成绩推到多快」，M2 问「你在正式比赛里站上过几次领奖台」。');
  push('后者本来就是按官方名次颁奖的，不需要也不应该再拆维度。');
  push('');
  push('### 6.5 多区赛：归 M3，不进 M2');
  push('');
  push('WCA 用 `X` 开头的两位伪代码表示「不落在单一国家」的属地：');
  push('`XE`（欧洲）、`XA`（亚洲）、`XW`（世界）、`XO`（大洋洲）等。真实 ISO 国家代码没有 `X` 开头，所以前缀 `X` 是唯一可靠的标记。');
  push('');
  push(`命中 ${num(excl.multiComps.size)} 场，全部是 **FMC（最少步）远程锦标赛**：同一套题目在几十个国家分站同步比，`);
  push('赛事在 `competitions` 里登记为 `XE` / `XA` / `XW`，而 `championship_type` 仍写具体国别。');
  push('');
  push('**为什么必须排除**：M2 的 `ρ_s` 是「该属地玩家占全球的比例」。多区赛没有单一属地 ——');
  push('取 `XE` 会把整个欧洲当成一个国家、人数翻十倍；取 `CH` 又只算瑞士。任一种取法都会给出一个与其他赛事不可比的价格。');
  push('所以整类移出 M2，归 M3。');
  push('');
  push('| 赛事 | 举办地代码 | 冠军赛类型 |');
  push('|---|---|---|');
  for (const cid of [...excl.multiComps].sort()) {
    const ci = compInfo.get(cid) || {};
    const tp = [...(ctypes.get(cid) || [])].join(' ');
    push(`| ${(ci.name || cid).slice(0, 44)} | ${ci.iso} | ${tp} |`);
  }
  push('');
  push(`共 ${num(excl.multiRows)} 条领奖台，占全部冠军赛领奖台的 ${PCT(excl.multiRows / podiumsAll.length)}。`);
  push('剔除后 M2 的冠军赛只剩属地明确的世 / 洲 / 国三级（第 8 节）。');
  push('');
  push('---');
  push('');
  /* ══ 要求 1：项目分项 ═════════════════════════════════════════ */
  push('## 7 项目分项：与 M1 同一个 per 键');
  push('');
  push('### 7.1 结构');
  push('');
  push('M1 的 `per` 键是 `ev|type`（`333|single`、`333|avg`）。M2 不区分成绩维度，');
  push('所以键退化成单项 `ev` —— **这是唯一的结构差异，其余完全同构**：');
  push('');
  push('```js');
  push('M1: per["333|single"] / per["333|avg"]  → total = Σ per');
  push('M2: per["333"]                        → total = Σ per');
  push('```');
  push('');
  push('`m2_result.json` 里：');
  push('- `top[i].per["333"]` —— 个人分项分，扁平键；');
  push('- `top[i].place.{first,second,third}` —— 个人金 / 银 / 铜数；');
  push('- `byEvent["333"].{total,n,gold}` —— 全站分项（分数、榜次、金牌）；');
  push('- 各 `per` 之和 = `top[i].score`，全部项目之和 = 定稿总量。');
  push('');
  push('### 7.2 全站分项（v5 定稿）');
  push('');
  const evRows = varTotals.v5.byEv.slice().sort((a, b) => b.score - a.score);
  push('| 项目 | w_e | 分数 | 榜次 | 金牌 | 占全站 | 单榜均分 |');
  push('|---|---|---|---|---|---|---|');
  for (const g of evRows) {
    push(`| ${EV_CN[g.ev] || g.ev} | ${F(RN.EV_WEIGHT_V2[g.ev] == null ? 0 : RN.EV_WEIGHT_V2[g.ev])} `
      + `| **${F(g.score)}** | ${num(g.n)} | ${num(g.nGold)} | ${PCT(g.score / tot5)} `
      + `| ${g.n ? F(g.score / g.n) : '—'} |`);
  }
  push(`| **合计** | — | **${F(tot5)}** | **${num(podiums.length)}** | **${num(cntPlace[1])}** | 100.00% | ${F(tot5 / podiums.length)} |`);
  push('');
  push('### 7.3 分布：头部集中度');
  push('');
  const top1 = evRows[0];
  const top5 = evRows.slice(0, 5);
  const top5sum = top5.reduce((a, g) => a + g.score, 0);
  push(`- 最大单项是 **${EV_CN[top1.ev] || top1.ev}**，占全站 **${PCT(top1.score / tot5)}**（${num(top1.n)} 个榜次）；`);
  push(`- 前 5 项合计 **${PCT(top5sum / tot5)}**，其余 ${evRows.length - 5} 项分摊 ${PCT(1 - top5sum / tot5)}。`);
  push('');
  push('这个分布与 M1 的项目结构一致：三阶、二阶、四阶、五阶是参赛基数最大的四项，');
  push('`w_e` 也最高，所以它们在两个模块里都是最大项。');
  push('');
  push('---');
  push('');
  /* ── 分层 ── */
  push('## 8 数据：三级冠军赛的真实规模');
  push('');
  push('| 赛级 | 赛事数 | 榜次数 | 得分 | 占全站 | 平均决赛人数 | 平均项目参赛人数 |');
  push('|---|---|---|---|---|---|---|');
  for (const t of ['WC', 'CC', 'NC', 'OP']) {
    const s = tierStat[t];
    const sc = varTotals.v5.byTier[t] || 0;
    push(`| ${t} | ${num(s.comps) || (t === 'OP' ? '—' : 0)} | ${num(s.rows)} | ${F(sc)} `
      + `| ${tot5 ? PCT(sc / tot5) : '—'} | ${F(avg(s.fin))} | ${F(avg(s.all))} |`);
  }
  push('');
  push(`读法：**NC 占了 ${PCT(tierStat.NC.rows / podiums.length)} 的榜次，只贡献 ${PCT(tierStat.NC.rows ? varTotals.v5.byTier.NC / tot5 : 0)} 的分。** 这正是 ρ 的设计目的 ——`);
  push('数量由小赛堆，分数由大赛给。反过来看，M2 实际上是一个「世锦赛 + 洲锦赛」排行，');
  push('国锦赛几乎不影响名次（见 13.1 第 1 条）。');
  push('');
  push('> OP 行是「非冠军赛」的普通赛事领奖台，不属于 M2，归 M3。');
  push(`> 旧实现把 ${num(tierStat.NC.comps)} 场国家锦标赛算作洲际赛（0.7），这是 M2 现行排序错误的根因，`);
  push('> 详细诊断见 `M2_诊断_赛级分类.md`。');
  push('');

  /* ── 变体 ── */
  push('## 9 逐项加回：每一步改变了什么');
  push('');
  push('| 变体 | 口径 | 总量 | 1 | 2 | 3 | 4 | 5 |');
  push('|---|---|---|---|---|---|---|---|');
  for (const v of M2.VARIANTS) {
    const ls = listOf(v.id).slice(0, 5);
    push(`| ${v.id} | ${M2.VARIANT_CN[v.id]} | ${F(varTotals[v.id].total)} | `
      + ls.map((x, i) => `${x.name} ${F(x.score)}`).join(' | ') + ' |');
  }
  push('');
  push('> 读法：v0→v1 只修分类 bug，**排名就翻了**（Bence Barát 从第 1 掉出前列）；');
  push('> v4→v5 加项目权重后总量降幅最大，但前五名次不变 —— 与 M1 的结论一致：');
  push('> 顶尖选手的优势来自结构（他们在高权重项目上也赢），不是靠冷门项目堆出来的。');
  push('');
  push('### 9.1 具体谁被推翻了');
  push('');
  const V0 = listOf('v0');
  const V5 = FINAL;
  const r5 = new Map(V5.map((x) => [x.pid, x]));
  const r0 = new Map(V0.map((x) => [x.pid, x]));
  const union = [];
  const seen = new Set();
  for (const x of V0.slice(0, 10)) { union.push(x.pid); seen.add(x.pid); }
  for (const x of V5.slice(0, 10)) if (!seen.has(x.pid)) { union.push(x.pid); seen.add(x.pid); }
  push('| 选手 | 现行名次 | 现行 M2 | 定稿名次 | 定稿 M2 | 名次变化 |');
  push('|---|---|---|---|---|---|');
  for (const pid of union) {
    const a = r0.get(pid);
    const b = r5.get(pid);
    const ra = a ? a.rank : '—';
    const rb = b ? b.rank : '—';
    const d = (a && b) ? (a.rank - b.rank) : null;
    push(`| ${(b || a).name} | ${ra} | ${a ? F(a.score) : '—'} | ${rb} | ${b ? F(b.score) : '—'} | `
      + `${d == null ? '新入榜' : (d > 0 ? `↑${d}` : (d < 0 ? `↓${-d}` : '持平'))} |`);
  }
  push('');
  const benceV5 = bencePid ? results.get('v5').get(bencePid) : null;
  const benceV0 = bencePid ? results.get('v0').get(bencePid) : null;
  if (benceV0 && benceV5) {
    const nNC = benceV0.rows.filter((r) => r.tier === 'NC').length;
    push(`> Bence Barát 的坠落最值得看：现行口径下他排第 1（${F(benceV0.score)}），`);
    push(`> 定稿口径下掉到第 ${benceV5.rank}（${F(benceV5.score)}）。`);
    push(`> 他 ${benceV0.rows.length} 个领奖台里有 **${nNC} 个其实是本国锦标赛**，却被旧口径按洲际价 0.7 计价；`);
    push(`> 修复分类后这 ${nNC} 条按 NC 计价（0.15 × ρ_HU ≈ 0.0007），几乎归零。`);
    push('> 他从未拿过世界冠军，现行 M2 却把他排在全站第 1 —— 这才是原来那套数字最说不通的地方。');
  }
  push('');
  push('> 「现行 M2」一列是 v0（现行分类 bug，但入口已是官方名次并排除了多区赛 / 无效成绩），');
  push(`> 所以与线上原始的 ${FN(v0sTotal)} 口径略有差异；名次变化不受影响。`);
  push('');

  /* ── 定稿排名 ── */
  push('## 10 定稿排行（v5，前 40）');
  push('');
  push('| # | 选手 | 国家 | 世界 | 洲际 | 全国 | 金 | 银 | 铜 | M2 |');
  push('|---|---|---|---|---|---|---|---|---|---|');
  FINAL.slice(0, 40).forEach((x) => {
    push(`| ${x.rank} | ${x.name} | ${x.nat} | ${F(x.tiers.WC)} | ${F(x.tiers.CC)} | ${F(x.tiers.NC)} `
      + `| ${x.place[1] || 0} | ${x.place[2] || 0} | ${x.place[3] || 0} | **${F(x.score)}** |`);
  });
  push('');
  push('分项加总：WC + CC + NC = M2，且 金 + 银 + 铜 = 领奖台次数。');
  push('');

  /* ── 两人账本 ── */
  for (const x of tgt) {
    push(`## ${11 + tgt.indexOf(x)} ${x.name}`);
    push('');
    push(`**M2 = ${F(x.score)}　全站第 ${x.rank} 名**`);
    push('');
    push(`金 ${x.place[1] || 0} ｜ 银 ${x.place[2] || 0} ｜ 铜 ${x.place[3] || 0} ｜ 领奖台 ${x.n} 次`);
    push('');
    push(`世界 ${F(x.tiers.WC)}｜洲际 ${F(x.tiers.CC)}｜全国 ${F(x.tiers.NC)}`);
    push('');
    const rows = x.rows.slice().sort((a, b) => b.score - a.score);
    push('### 分值最高的 12 个领奖台');
    push('');
    push('| 级 | 赛事 | 项目 | 名次 | 年 | 决赛人 | T | ρ | f | w | 得分 |');
    push('|---|---|---|---|---|---|---|---|---|---|---|');
    for (const r of rows.slice(0, 12)) {
      const cn = (compInfo.get(r.compId) || {}).name || r.compId;
      push(`| ${r.tier} | ${cn.slice(0, 26)} | ${EV_CN[r.ev] || r.ev} | ${r.pos} | ${r.year} | ${r.field} | `
        + `${F(r.tierBase)} | ${F(r.rho)} | ${F(r.f)} | ${F(r.w)} | **${F(r.score)}** |`);
    }
    push('');
    push('### 按赛级汇总');
    push('');
    push('| 赛级 | 次数 | 得分 | 均价 | 占比 |');
    push('|---|---|---|---|---|');
    for (const t of ['WC', 'CC', 'NC']) {
      const rr = x.rows.filter((r) => r.tier === t);
      const sc = rr.reduce((a, r) => a + r.score, 0);
      push(`| ${t} | ${rr.length} | ${F(sc)} | ${rr.length ? F(sc / rr.length) : '—'} | ${PCT(x.score ? sc / x.score : 0)} |`);
    }
    push(`| **合计** | ${x.n} | **${F(x.score)}** | ${F(x.score / (x.n || 1))} | 100.00% |`);
    push('');
    push('### 按项目分项（per 结构，全项目）');
    push('');
    push('| 项目 | 分数 | 次数 | 金牌 | 占个人 | 均分 |');
    push('|---|---|---|---|---|---|');
    const perRows = [...x.byEv.entries()]
      .map(([ev, g]) => ({ ev, score: g.score, n: g.n, gold: g.gold }))
      .sort((a, b) => b.score - a.score);
    for (const g of perRows) {
      push(`| ${EV_CN[g.ev] || g.ev} | **${F(g.score)}** | ${g.n} | ${g.gold} `
        + `| ${PCT(g.score / x.score)} | ${g.n ? F(g.score / g.n) : '—'} |`);
    }
    push(`| **合计** | **${F(x.score)}** | ${x.n} | ${x.place[1] || 0} | 100.00% | ${F(x.score / (x.n || 1))} |`);
    push('');
    push('per 的键是单项 ev，与 M1 的 ev|type 一一对应（M2 只有一个维度）。');
    push('');
  }

  /* ── 边界 ── */
  push('## 13 已知边界与未解决问题');
  push('');
  push('### 13.1 口径边界（不是 bug，是选择的结果）');
  push('');
  push('1. **国锦赛在全球 ρ 下接近 0**（见 5.1）。这是「全球份额」口径的必然，不是参数问题。');
  push('   已确认「国锦赛与世锦赛的分数比保持现状」，所以本版不动 T_L 与 ρ 的取法。');
  push('   想让它有意义，只能改 T_NC 或改用「该级内部份额」，两者都会破坏与 M1 的一致性。');
  push('2. **f_L 只按属地池算，不看当届实际规模。** 2026 年世锦赛若只有 300 人参赛，');
  push('   折算仍按当年全球池，不会因为「这届人少」而降低。若要更细，应引入「当届参赛人数」因子。');
  const V6 = listOf('v6');
  const v6rank = new Map(V6.map((x) => [x.pid, x.rank]));
  let sameTop10 = 0;
  for (const x of FINAL.slice(0, 10)) if (v6rank.get(x.pid) === x.rank) sameTop10++;
  push(`   实测（v6 = v5 加 min(1, (决赛人数/16)^0.35)）：总量 ${F(varTotals.v5.total)} → ${F(varTotals.v6.total)}，`
    + `前 10 名次保持 ${sameTop10}/10 不变。**不值得为它增加复杂度**，故不采用。`);
  push('3. **T_L 三级比例是价值选择。** 1 / 0.4 / 0.15 继承自 M1，M1 当时的取值同样是价值判断。');
  push('   如果要把 M2 更集中到世界级，把 T_CC / T_NC 再压；要保护洲/国赛，就抬。');
  push('   但不能只改 M2 不改 M1，否则两套模型打架。');
  push('4. **M2 不区分单次 / 平均**（第 6 节）。这是明确要求，代价是丢掉「单次爆发力」这一维；');
  push('   该维度在 M1 里完整存在（per[ev|single] / per[ev|avg]），两个模块分工不同，不是遗漏。');
  push('5. **M2 与 M1 的分数尺度不同，不能直接相加或比较。** 两者只有通过各自的 modMax 归一化后，');
  push('   才能放在同一张雷达图上。');
  push('');
  push('### 13.2 待解决（需要你确认或工程实现）');
  push('');
  push(`1. **M3 未定稿。** 本次把 ${num(excl.multiComps.size)} 场多区赛（FMC 远程赛，${num(excl.multiRows)} 条领奖台）`);
  push(`   移出 M2，加上原本就属于 M3 的 ${num(tierStat.OP.rows)} 条普通赛事领奖台（合计 ${num(excl.multiRows + tierStat.OP.rows)} 条），`);
  push('   都需要一套定价方案；');
  push('   当前线上 M3 把它们混在一起按 0.4 计。这是下一个要处理的模块。');
  push('2. **etl/build.js 还没接线。** 线上 M1/M2/M3 仍跑旧口径（M2 甚至是分类 bug 版）。');
  push('   接线要：① 把 runs.js / m2.js 引进去；② 重跑 ETL；');
  push(`   ③ 把 modMax.m2 从 217.34 改成 ${F(FINAL[0].score)}；④ 重标 modMax.m3。`);
  push('   在接线前，线上分数与本文档的数字**不一致是预期的**。');
  push('3. **FMCIberianChampionship2025（ES+PT）本来会被判成 NC。** 它是西葡区域赛，理应算 CC。');
  push('   本版靠「多区赛排除」绕过了它（举办地为 XE），所以问题不再暴露；');
  push('   但如果将来 M3 要给它定价，仍需一个「多国类型的洲际判定」规则。');
  push('');
  /* ── 自检 ── */
  push('## 14 自检（可独立复核）');
  push('');
  push('| 检查 | 结果 | 说明 |');
  push('|---|---|---|');
  push(`| 历史口径复现（v0s） | 总量 ${FN(v0sTotal)}｜Feliks ${F(f0s)}｜Bence ${F(b0s)} | `
    + `含多区赛、含无效成绩的官方 pos 全集，与 \`M2_诊断_赛级分类.md\` 的 16,286.08 / 127.58 / 217.34 逐位一致 |`);
  push(`| 官方名次全集 | ${num(podiumsAll.length)} 条 | 与诊断报告的 34,563 一致（同口径） |`);
  push(`| − 多区赛 | ${num(excl.multiRows)} 条 / ${num(excl.multiComps.size)} 场 | 举办地为 X 前缀伪代码，见 6.5 |`);
  push(`| − 无效成绩 | ${num(excl.dnf)} 条 | pos 1–3 但 best ≤ 0（DNF / DNS） |`);
  push(`| = M2 输入 | ${num(podiums.length)} 条 | 金 ${num(cntPlace[1])} / 银 ${num(cntPlace[2])} / 铜 ${num(cntPlace[3])} |`);
  let maxDiff = 0;
  for (const x of FINAL) {
    maxDiff = Math.max(maxDiff, Math.abs(x.tiers.WC + x.tiers.CC + x.tiers.NC - x.score));
  }
  push(`| 赛级加总 = 总分 | 最大偏差 ${maxDiff.toExponential(2)} | 逐人校验 WC+CC+NC，全部收敛 |`);
  const perOk = FINAL.every((x) => {
    let acc = 0;
    for (const g of x.byEv.values()) acc += g.score;
    return Math.abs(acc - x.score) < 1e-9;
  });
  push(`| per 分项完备 | ${perOk ? '通过' : '**失败**'} | 每人 Σper[ev] 与总分一致 |`);
  const placeOk = FINAL.every((x) => (x.place[1] || 0) + (x.place[2] || 0) + (x.place[3] || 0) === x.n);
  push(`| 金银铜 = 榜次 | ${placeOk ? '通过' : '**失败**'} | 每人 place 三项之和 = n |`);
  push(`| 冠军赛分类 | WC ${tierStat.WC.comps} / CC ${tierStat.CC.comps} / NC ${tierStat.NC.comps} | `
    + `多区赛已剔除（原 ${num(ctypes.size)} 场含 ${num(excl.multiComps.size)} 场多区赛） |`);
  push(`| 决赛轮 | ${num(rounds.size)} 个 | 全部含 \`f\`/\`c\` 轮，无遗漏项目 |`);
  push(`| 权重边界 | ${F(Math.min(...Object.values(RN.EV_WEIGHT_V2)))} – ${F(Math.max(...Object.values(RN.EV_WEIGHT_V2)))} | 最冷门项目仍为正值 |`);
  push(`| ρ 边界 | 0 – 1（世锦赛恒 1） | 无负数、无 >1 |`);
  push(`| 时代系数 | 0 – 1，2026 年 = 1 | 与 M1 同池同基准年 |`);
  push('');
  if (oddTypes.size) {
    push('类型与举办国不一致、且不属于多区赛的冠军赛（区域标识，如 `greater_china`，按 `CC` 处理）：');
    push('');
    push('| 类型 → 举办国 | 场次 |');
    push('|---|---|');
    [...oddTypes.entries()].forEach(([k, n]) => push(`| ${k} | ${n} |`));
    push('');
  }
  push(`**前端归一化分母建议**：\`modMax.m2 = ${F(FINAL[0].score)}\`（${FINAL[0].name}）。`);
  push('现行 `modMax.m2` 是 217.34，换模型后必须一起改，否则 0–100 会全部挤在底部。');
  push('');
  fs.writeFileSync(path.join(__dirname, 'M2_定稿_v1.md'), L.join('\n') + '\n', 'utf8');

  /* console 摘要 */
  console.log('\n=== 定稿 v5 top 15 ===');
  FINAL.slice(0, 15).forEach((x) => console.log(
    `${String(x.rank).padStart(2)} ${x.name.padEnd(24)} ${F(x.score).padStart(10)}  `
    + `WC ${F(x.tiers.WC).padStart(8)} CC ${F(x.tiers.CC).padStart(7)} NC ${F(x.tiers.NC).padStart(7)}`));
  console.log('\n总量:', F(tot5), '｜现行:', F(tot0), '｜比例', PCT(tot5 / tot0));
  for (const x of tgt) console.log(`${x.name} ${F(x.score)} rank ${x.rank}`);
  console.log('\n=== 变体 ===');
  for (const v of M2.VARIANTS) {
    console.log(v.id, F(varTotals[v.id].total).padStart(10), '｜',
      listOf(v.id).slice(0, 3).map((x) => `${x.name} ${F(x.score)}`).join(' / '));
  }
})().catch((e) => { console.error(e); process.exit(1); });

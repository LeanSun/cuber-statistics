'use strict';
/* =============================================================================
 * sixdim.js · 六维统一查询引擎（M1-F2 / M2-F1 / M3-F1 / M4-F1 / M5快照 / M6-F2）
 * -----------------------------------------------------------------------------
 * 功能（对应用户 2026-10-25 的六条要求）：
 *   ① 除 M2 外每维可按 单次/平均/双轨 筛选        → --track single|avg|both
 *   ② 所有维度可按单项目筛选                      → --ev 333|all
 *   ③ 总分 = 各项目小计 × 项目系数 后累加          → EV_WEIGHT_V2 统一项目系数
 *   ④ 自定义时间截取（"至2010年的世界第一人"）      → --asof 2010
 *      语义：M1/M2/M3/M4/M6 = 累计维，取 y/date ≤ asOf 求和；
 *            M5 = 位置维，取 year ≤ asOf 的**最近年末快照**（不跨年求和）
 *   ⑤ 单维度独立排名（耦合以上全部筛选）           → --dim M1 等
 *   ⑥ 性别筛选                                    → --gender m|f|all
 *   ⑦ 六维累加 = 乘维度系数：M1 .28 / M2 .24 / M4 .18 / M3 .12 / M6 .10 / M5 .08
 *
 * 归一化：每个 (维度 × 项目) 在**当前筛选范围**内以榜首为 1（leader=1），
 *   消除六维量纲差（15,506 vs 77 差 200 倍的问题在合成层解决）。
 * 合成：  comp_e(pid) = EV_W(e) × Σ_d w_d × rel_d(pid, e)
 *         total(pid)  = Σ_e comp_e(pid) × 100 / Σ_{选中维} w_d   → 全维时榜首≈100
 *
 * 数据源（各封存脚本的纯写出型事实表）：
 *   M1_facts.tsv  (pid,ev,type,level,scope,year,frac,score)      ← m1_hold.js
 *   M2_facts.tsv  (pid,name,ev,tier,pos,year,compId,base,decay)  ← m2m3_balance.js
 *   M3_facts.tsv  (pid,ev,type,lvl,tier,year,add)                ← m3_record_bonus.js
 *   M4_facts.tsv  (pid,ev,track,year,contrib)                    ← m4_dominance.js
 *   M5_facts.tsv  (year,pid,ev,kind,rank,score)                  ← m5_facts.js
 *   M6_by_record.tsv (pid,event,kind,date,…)                     ← m6_lead.js
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
  track: argv.track ? String(argv.track) : 'both',            // single | avg | both（M2 不受影响）
  gender: argv.gender ? String(argv.gender).toLowerCase() : 'all',  // m | f | all
  asof: argv.asof ? +argv.asof : 2026,
  top: argv.top ? +argv.top : 20,
  csv: argv.csv ? String(argv.csv) : null,
};

/* ── 维度权重（用户 2026-10-25 委托定夺，M1/M2 为主）──
   M1 纪录持有 .28 + M2 领奖台 .24 = .52 主货币（历史地位的第一句问话）
   M4 统治力 .18（在榜时长，与 M1 部分联动 0.58 已知）
   M3 大赛破纪录 .12（锦标赛破纪录加成）
   M6 突破幅度 .10（巅峰质量，单跳多远）
   M5 当前排名 .08（现势，天然随时间衰减，历史地位权重最低） */
const DIMS = {
  M1: { w: 0.28, cn: '纪录持有' },
  M2: { w: 0.24, cn: '领奖台' },
  M3: { w: 0.12, cn: '大赛破纪录' },
  M4: { w: 0.18, cn: '统治力' },
  M5: { w: 0.08, cn: '当前排名' },
  M6: { w: 0.10, cn: '突破幅度' },
};
const BETA = 0.2241;                    // M2 普通赛折算（M2-F1 冻结常量）
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
}

/* ── 载入事实表 → dim → Map(pid → Map(ev → score)) ──
   track: 'single' | 'avg' | null(both/不适用) */
const D = path.join(__dirname);
function load(file) {
  const lines = fs.readFileSync(path.join(D, file), 'utf8').trim().split('\n');
  return lines;
}
const asofEnd = OPT.asof >= 2026 ? Infinity : Date.parse(OPT.asof + '-12-31T00:00:00Z') / 86400000;
const sub = new Map();                    // dim → Map(pid → Map(ev → score))
for (const dim of OPT.dims) {
  const m = new Map();
  const put = (pid, ev, v) => {
    if (!(v > 0)) return;
    if (OPT.gender !== 'all' && genderOf.get(pid) !== OPT.gender) return;
    let a = m.get(pid); if (!a) { a = new Map(); m.set(pid, a); }
    a.set(ev, (a.get(ev) || 0) + v);
  };
  if (dim === 'M1') {
    for (const ln of load('M1_facts.tsv').slice(1)) {
      const c = ln.split('\t');
      const y = +c[5]; if (y > OPT.asof) continue;
      const type = c[2] === 'avg' ? 'avg' : 'single';
      if (OPT.track !== 'both' && type !== OPT.track) continue;
      if (OPT.ev && c[1] !== OPT.ev) continue;
      put(c[0], c[1], +c[7]);
    }
  } else if (dim === 'M2') {
    for (const ln of load('M2_facts.tsv').slice(1)) {
      const c = ln.split('\t');
      if (+c[5] > OPT.asof) continue;
      if (OPT.ev && c[2] !== OPT.ev) continue;
      const v = (+c[7]) * (+c[8]) * (c[3] === 'OP' ? BETA : 1);
      put(c[0], c[2], v);
    }
  } else if (dim === 'M3') {
    for (const ln of load('M3_facts.tsv').slice(1)) {
      const c = ln.split('\t');
      if (+c[5] > OPT.asof) continue;
      const type = c[2] === 'A' ? 'avg' : 'single';
      if (OPT.track !== 'both' && type !== OPT.track) continue;
      if (OPT.ev && c[1] !== OPT.ev) continue;
      put(c[0], c[1], +c[6]);
    }
  } else if (dim === 'M4') {
    for (const ln of load('M4_facts.tsv').slice(1)) {
      const c = ln.split('\t');
      if (+c[3] > OPT.asof) continue;
      const tr = c[2] === 'average' ? 'avg' : 'single';
      if (OPT.track !== 'both' && tr !== OPT.track) continue;
      if (OPT.ev && c[1] !== OPT.ev) continue;
      put(c[0], c[1], +c[4]);
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
      for (const c of rows) {
        if (+c[0] !== bestYear) continue;
        if (OPT.track !== 'both' && c[3] !== OPT.track) continue;
        if (OPT.ev && c[2] !== OPT.ev) continue;
        put(c[1], c[2], +c[5]);
      }
      console.log(`# M5 快照取 ${bestYear} 年末`);
    }
  } else if (dim === 'M6') {
    for (const ln of load('M6_by_record.tsv').slice(1)) {
      const c = ln.split('\t');
      const d = Date.parse(c[3] + 'T00:00:00Z') / 86400000;
      if (d > asofEnd) continue;
      const kind = c[2] === 'avg' ? 'avg' : 'single';
      if (OPT.track !== 'both' && kind !== OPT.track) continue;
      if (OPT.ev && c[1] !== OPT.ev) continue;
      put(c[0], c[1], +c[7]);
    }
  }
  sub.set(dim, m);
}

/* ── 项目系数（EV_WEIGHT_V2）── */
const RUNS = require(path.join(ROOT, 'etl/score/runs.js'));
const EVW = RUNS.EV_WEIGHT_V2;
const evW = (ev) => (EVW[ev] == null ? RUNS.WEIGHT_V2_CFG.floor : EVW[ev]);

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
    comp = comp * evW(ev) * 100 / wSum;
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
/* ── 六维实验榜页面数据（仅在无筛选的全量口径下写出，避免覆盖成局部快照） ── */
const DIM_KEYS = Object.keys(DIMS);
const noFilter = !OPT.ev && OPT.track === 'both' && OPT.gender === 'all' && OPT.asof === 2026 && DIM_KEYS.every((k) => OPT.dims.includes(k));
if (OPT.csv && noFilter) {
  /* 站点接入用：s_d = Σ_ev (v/mx) × evW × 100 / wSum，满足 总分 = Σ_d w_d × s_d */
  const site = ['pid\ts1\ts2\ts3\ts4\ts5\ts6\tt'];
  for (const x of rowsOut) {
    const s = selDims.map((dim) => {
      let acc = 0;
      for (const [ev, dmap] of x.perEv) {
        const v = dmap[dim] || 0, mx = maxOf[dim].get(ev) || 0;
        if (v > 0 && mx > 0) acc += (v / mx) * evW(ev) * 100 / wSum;
      }
      return acc.toFixed(4);
    });
    site.push([x.pid, ...s, x.total.toFixed(4)].join('\t'));
  }
  fs.writeFileSync(path.join(D, 'sixdim_site.tsv'), site.join('\n') + '\n', 'utf8');
  const compact = rowsOut.map((x, i) => {
    const d = {};
    for (const dim of DIM_KEYS) {
      let s = 0;
      for (const [, dmap] of x.perEv) s += dmap[dim] || 0;
      d[dim] = +s.toFixed(4);
    }
    return { r: i + 1, id: x.pid, n: x.name, g: x.gender, t: +x.total.toFixed(4), ...d };
  });
  const page = {
    meta: {
      generated: new Date().toISOString().slice(0, 10),
      count: compact.length,
      weights: Object.fromEntries(DIM_KEYS.map((k) => [k, DIMS[k].w])),
      labels: Object.fromEntries(DIM_KEYS.map((k) => [k, DIMS[k].cn])),
    },
    rows: compact,
  };
  fs.writeFileSync(path.join(__dirname, '..', '..', 'js', 'sixdim_data.js'),
    '/* 自动生成：etl/score/sixdim.js → 六维实验榜（sixdim.html）数据。勿手改。 */\nwindow.SIXDIM = ' + JSON.stringify(page) + ';\n', 'utf8');
  console.log(`→ 已写 js/sixdim_data.js（${compact.length} 人，实验榜页面数据）`);
}

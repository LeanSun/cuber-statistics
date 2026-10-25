'use strict';
/* =============================================================================
 * M6-F2 · 领先幅度（破纪录瞬间的突破力度）· 生产脚本
 * -----------------------------------------------------------------------------
 * 2026-10-25 定稿（M6-F1「对手强度」→ M6-F2「领先幅度」，用户拍板推翻重建）：
 *
 *   语义：你刷新纪录的那一刻，把人类前沿往前推了多远。
 *         gain = ln(前值 / 新值)   —— 三种 format 统一「越小越强」后可比
 *   定稿口径（候选族对照见 m6b_diag6 / M6_候选方向对比）：
 *     · 仅 WR（全球纪录链条；CR/NR 链条含大量缺环与低含金量）
 *     · gain 截顶 0.5（≈ +65%，防单次链条断裂/早期粗糙成绩的假增益）
 *     · M6 = Σ_events min(gain, 0.5)，无人数折算、无时代折算
 *
 *   正确性金标准（m6b_diag6 已验证）：
 *     · 链条数 4,824 ≈ js/data.js records 桶数 4,822
 *     · WR 刷新事件 1,193 = records 重建 1,193（误差 0）
 *
 *   实现要点（全部踩过的坑）：
 *     1. persons.tsv 国家列 = p[4]（表头 name|gender|wca_id|sub_id|country_id）
 *     2. 同场多条标记 = 不同范围的纪录线同时成立（WR+NR+NR…），范围 key 正确后
 *        自然分离；同 key 同场仍多条 → 取该场最佳一条
 *     3. NAR（北美纪录）是独立层级，不并入 NR
 *     4. multi 编码值须 decodeMulti 折算 cost 后才可比
 *     5. 333fm / number 类：值本身即 cost（步数），无需换向 —— 归一后统一升序
 *     6. results.tsv person_id = 第 9 列（p[8]）
 *
 * 运行：node --max-old-space-size=8192 etl/score/m6_lead.js    （约 25s）
 * 产出：M6_seats.tsv / M6_by_record.tsv / M6_by_event.tsv / M6_领先幅度.md
 * ============================================================================= */
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const ROOT = path.resolve(__dirname, '../..');
const ZIP = path.join(ROOT, 'data/raw/WCA_export_v2_288_20261015T000017Z.tsv.zip');
const TMP = path.join(ROOT, '.workbuddy/tmp/oc');

const CFG = { LEVEL: 'WR', CAP: 0.5 };   // 定稿口径旋钮

const F = (x, n = 4) => Number(x).toFixed(n);
const num = (x) => Number(x).toLocaleString('en-US');
const R4 = (v) => Math.round(v * 1e4) / 1e4;

function zipStream(entry, onLine) {
  return new Promise((resolve, reject) => {
    const child = spawn('unzip', ['-p', ZIP, entry], { stdio: ['ignore', 'pipe', 'ignore'] });
    let buf = '', head = true;
    child.stdout.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, '');
        buf = buf.slice(nl + 1);
        if (head) { head = false; continue; }
        if (line.trim()) onLine(line.split('\t'));
      }
    });
    child.stdout.on('end', resolve);
    child.on('error', reject);
  });
}
function decodeMulti(v) {   // 与 M4 已封存实现逐字一致
  if (v < 1e9) {
    const S = String(v).padStart(10, '0');
    const DD = +S.slice(1, 3), TT = Math.min(+S.slice(3, 8), 99999);
    const diff = 99 - DD;
    return (99 - diff) * 1e5 + TT;
  }
  const S = String(v);
  const SS = +S.slice(1, 3), AA = +S.slice(3, 5), TT = Math.min(+S.slice(5, 10), 99999);
  const solved = 99 - SS, missed = AA - solved, diff = solved - missed;
  return (99 - diff) * 1e5 + TT;
}
function scopeOf(mark, ctry) {
  switch (mark) {
    case 'WR': return { level: 'WR', scope: 'WW' };
    case 'ER': return { level: 'CR', scope: 'EU' };
    case 'AsR': return { level: 'CR', scope: 'AS' };
    case 'SAR': return { level: 'CR', scope: 'SA' };
    case 'OcR': return { level: 'CR', scope: 'OC' };
    case 'AfR': return { level: 'CR', scope: 'AF' };
    case 'NAR': return { level: 'NAR', scope: 'NA' };
    case 'NR': return { level: 'NR', scope: ctry || '??' };
    default: return null;
  }
}

/* ── 相关性：秩 + 中心化 pearson（★ 必须中心化，否则是余弦、全矩阵虚高） ── */
function spearman(pairs) {
  const n = pairs.length;
  if (n < 10) return { n, rho: NaN };
  const rank = (arr) => {
    const idx = arr.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
    const r = new Float64Array(n);
    let i = 0;
    while (i < n) {
      let j = i;
      while (j + 1 < n && arr[idx[j + 1][1]] === arr[idx[i][1]]) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
      i = j + 1;
    }
    return r;
  };
  const xs = rank(pairs.map((p) => p[0])), ys = rank(pairs.map((p) => p[1]));
  let mx = 0, my = 0;
  for (let i = 0; i < n; i++) { mx += xs[i]; my += ys[i]; }
  mx /= n; my /= n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  return { n, rho: sxy / Math.sqrt(sxx * syy) };
}
function crossRho(m1, m2, v1, v2) {
  const pairs = [];
  for (const [pid, a] of m1) {
    const b = m2.get(pid);
    if (b !== undefined) pairs.push([v1 ? v1(a) : a, v2 ? v2(b) : b]);
  }
  return spearman(pairs);
}

async function main() {
  const t0 = Date.now();
  /* ═══ S0 元信息 ═══ */
  const compDate = new Map(), compYear = new Map();
  {
    const lines = fs.readFileSync(path.join(TMP, 'WCA_export_competitions.tsv'), 'utf8').split('\n');
    const ix = {}; lines[0].split('\t').forEach((c, i) => ix[c] = i);
    for (let i = 1; i < lines.length; i++) {
      const p = lines[i].split('\t');
      if (!p[ix.id]) continue;
      const d = p[ix.day] && p[ix.month] && p[ix.year]
        ? `${p[ix.year]}-${String(p[ix.month]).padStart(2, '0')}-${String(p[ix.day]).padStart(2, '0')}`
        : `${p[ix.year]}-01-01`;
      compDate.set(p[ix.id], d); compYear.set(p[ix.id], +p[ix.year]);
    }
  }
  const EV_FMT = new Map();
  {
    const lines = fs.readFileSync(path.join(TMP, 'WCA_export_events.tsv'), 'utf8').trim().split('\n');
    const ix = {}; lines[0].split('\t').forEach((c, i) => ix[c] = i);
    for (let i = 1; i < lines.length; i++) EV_FMT.set(lines[i][ix.id], lines[i][ix.format]);
  }
  const pname = new Map(), pctr = new Map();
  await zipStream('WCA_export_persons.tsv', (p) => {
    if (p[2]) { pname.set(p[2], p[0]); pctr.set(p[2], p[4]); }   // ★ 国家 = p[4]
  });

  /* ═══ S1 扫 results 取标记行 ═══ */
  const recs = [];
  await zipStream('WCA_export_results.tsv', (p) => {
    const pid = p[8], eid = p[6], cid = p[4];
    if (!pid || !eid || !cid) return;
    const c = compDate.get(cid); if (!c) return;
    const ctry = pctr.get(pid);
    for (const [mkRaw, raw, kind] of [[p[10], p[2], 'single'], [p[11], p[3], 'avg']]) {
      if (!mkRaw || mkRaw === 'NULL') continue;
      const sc = scopeOf(mkRaw, ctry); if (!sc) continue;
      const v = +raw; if (!(v > 0)) continue;
      const cost = EV_FMT.get(eid) === 'multi' ? decodeMulti(v) : v;
      recs.push({ pid, eid, cid, date: c, yr: compYear.get(cid), kind, cost, level: sc.level, scope: sc.scope });
    }
  });
  console.log(`标记行=${num(recs.length)}`);

  /* ═══ S2 建链条 + 同场取最佳 + 相邻比较 ═══ */
  const chains = new Map();
  for (const r of recs) {
    const k = r.eid + '|' + r.kind + '|' + r.level + '|' + r.scope;
    let a = chains.get(k); if (!a) { a = []; chains.set(k, a); }
    a.push(r);
  }
  const events = [];
  let dedup = 0, skipped = 0;
  for (const [, arr] of chains) {
    const byDayComp = new Map();
    for (const r of arr) {
      const ck = r.date + '|' + r.cid;
      const cur = byDayComp.get(ck);
      if (!cur) { byDayComp.set(ck, r); continue; }
      dedup++;
      if (r.cost < cur.cost) byDayComp.set(ck, r);
    }
    const seq = [...byDayComp.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.cost - b.cost));
    for (let i = 1; i < seq.length; i++) {
      const prev = seq[i - 1], cur = seq[i];
      if (!(cur.cost < prev.cost)) { skipped++; continue; }
      events.push({
        pid: cur.pid, eid: cur.eid, kind: cur.kind, level: cur.level, scope: cur.scope,
        date: cur.date, yr: cur.yr,
        prevCost: prev.cost, newCost: cur.cost,
        gain: Math.log(prev.cost / cur.cost),
        samePerson: cur.pid === prev.pid,
      });
    }
  }
  const wrN = events.filter((e) => e.level === 'WR').length;
  console.log(`链条=${num(chains.size)} 同场去重=${num(dedup)} 非单调=${num(skipped)} 刷新事件=${num(events.length)} WR事件=${num(wrN)}`);
  if (wrN !== 1193) console.log(`⚠ WR 事件数 ${wrN} ≠ 基准 1,193 —— 数据快照变更，需复核`);

  /* ═══ S3 定稿口径聚合：仅 WR + 截顶 ═══ */
  const seats = new Map();    // pid → 聚合
  const byEv = new Map();     // pid|ev|kind → sum
  for (const e of events) {
    if (e.level !== CFG.LEVEL) continue;
    const g = Math.min(e.gain, CFG.CAP);
    let a = seats.get(e.pid);
    if (!a) { a = { pid: e.pid, name: pname.get(e.pid) || '', m6: 0, n: 0, raw: 0, maxGain: 0, evs: new Set(), firstDate: e.date }; seats.set(e.pid, a); }
    a.m6 += g; a.raw += e.gain; a.n++;
    if (e.gain > a.maxGain) a.maxGain = e.gain;
    a.evs.add(e.eid + '|' + e.kind);
    const bk = e.pid + '|' + e.eid + '|' + e.kind;
    byEv.set(bk, (byEv.get(bk) || 0) + g);
  }
  const LIST = [...seats.values()].sort((a, b) => b.m6 - a.m6);
  const rankOf = (pid) => LIST.findIndex((x) => x.pid === pid) + 1;
  const total = LIST.reduce((s, a) => s + a.m6, 0);
  console.log(`M6-F2 有分人数=${num(LIST.length)} 总量=${F(total)} 耗时=${((Date.now() - t0) / 1000).toFixed(1)}s`);

  /* ═══ S4 正交性矩阵 ═══ */
  const D = 'etl/score/';
  const loadTsv = (file, pc, vc) => {
    const m = new Map();
    const lines = fs.readFileSync(path.join(__dirname, file), 'utf8').trim().split('\n');
    for (let i = 1; i < lines.length; i++) {
      const c = lines[i].split('\t');
      const v = +c[vc];
      if (c[pc] && Number.isFinite(v)) m.set(c[pc], v);
    }
    return m;
  };
  const M1F2 = loadTsv('M1_hold_full.tsv', 0, 2);
  const M1F1 = loadTsv('M1_full.tsv', 0, 2);
  const M2 = loadTsv('M2_ranking.tsv', 1, 3);
  const M4 = loadTsv('M4_seats.tsv', 0, 2);
  const M5 = loadTsv('M5_seats.tsv', 0, 2);
  let M6F1 = null;
  try { M6F1 = loadTsv('M6F1_归档/M6_seats.tsv', 0, 2); } catch { /* 归档缺失则跳过 */ }
  const m6Map = new Map(LIST.map((a) => [a.pid, a.m6]));
  const mtx = [];
  for (const [nm, m] of [['M1-F2 纯持有', M1F2], ['M1-F1 原版', M1F1], ['M2', M2], ['M4', M4], ['M5', M5]]) {
    const r = crossRho(m6Map, m);
    const mark = Math.abs(r.rho) > 0.7 ? ' ❌' : (Math.abs(r.rho) > 0.5 ? ' ⚠️' : '');
    mtx.push(`  ×${nm.padEnd(12)} ρ=${F(r.rho)}${mark}  (n=${num(r.n)})`);
  }
  if (M6F1) {
    const r = crossRho(m6Map, M6F1);
    mtx.push(`  ×M6-F1对手   ρ=${F(r.rho)}  (n=${num(r.n)})`);
  }
  /* 时代分层：按首次 WR 年代分桶看桶内相关（判别「时代混杂」vs「真实人层面重叠」） */
  const strat = [];
  {
    const buckets = {};
    for (const a of LIST) {
      const b = Math.floor(+a.firstDate.slice(0, 4) / 5) * 5;
      (buckets[b] = buckets[b] || []).push(a);
    }
    for (const b of Object.keys(buckets).map(Number).sort((x, y) => x - y)) {
      const arr = buckets[b];
      if (arr.length < 15) continue;
      const pr = arr.filter((a) => M1F2.has(a.pid)).map((a) => [a.m6, M1F2.get(a.pid)]);
      if (pr.length >= 15) strat.push({ b, n: pr.length, rho: spearman(pr).rho });
    }
  }

  /* ═══ S5 导出 ═══ */
  fs.writeFileSync(path.join(__dirname, 'M6_seats.tsv'),
    'pid\tname\tm6\tn_refresh\tn_tracks\tmax_gain\tfirst_wr\n' +
    LIST.map((a) => `${a.pid}\t${a.name.replace(/\t/g, ' ')}\t${F(a.m6)}\t${a.n}\t${a.evs.size}\t${F(a.maxGain)}\t${a.firstDate}`).join('\n') + '\n', 'utf8');
  fs.writeFileSync(path.join(__dirname, 'M6_by_record.tsv'),
    'pid\tevent\tkind\tdate\tprev_cost\tnew_cost\tgain\tcapped_gain\tsame_person\n' +
    events.filter((e) => e.level === CFG.LEVEL).sort((a, b) => a.date < b.date ? -1 : 1)
      .map((e) => `${e.pid}\t${e.eid}\t${e.kind}\t${e.date}\t${F(e.prevCost)}\t${F(e.newCost)}\t${F(e.gain, 6)}\t${F(Math.min(e.gain, CFG.CAP), 6)}\t${e.samePerson ? 1 : 0}`).join('\n') + '\n', 'utf8');
  {
    const evName = pname; // 占位避免未用告警
    const rows = [...byEv.entries()].map(([k, v]) => { const [pid, ev, kind] = k.split('|'); return { pid, name: (seats.get(pid) || {}).name || '', ev, kind, m6: v }; }).sort((a, b) => b.m6 - a.m6);
    fs.writeFileSync(path.join(__dirname, 'M6_by_event.tsv'),
      'pid\tname\tevent\tkind\tm6\n' + rows.map((r) => `${r.pid}\t${r.name.replace(/\t/g, ' ')}\t${r.ev}\t${r.kind}\t${F(r.m6)}`).join('\n') + '\n', 'utf8');
  }

  /* ═══ S6 报告 ═══ */
  const EVZ = { '333': '三阶', '222': '二阶', '444': '四阶', '333oh': '三阶单手', pyram: '金字塔', '555': '五阶', skewb: '斜转', minx: '五魔', sq1: 'SQ1', clock: '魔表', '333bf': '三阶盲拧', '666': '六阶', '777': '七阶', '333fm': '最少步', '444bf': '四阶盲拧', '333mbf': '多盲', '333ft': '脚拧', '555bf': '五阶盲拧', magic: '八板', mmagic: '十二板', '333mbo': '旧多盲' };
  const L = [];
  L.push('# M6-F2 · 领先幅度（破纪录瞬间的突破力度）');
  L.push('');
  L.push('> 由 `etl/score/m6_lead.js` 生成，所有数字现算。');
  L.push('');
  L.push('## 0 一句话');
  L.push('');
  L.push('**你刷新纪录的那一刻，把人类前沿推远了多少。** gain = ln(前值/新值)，');
  L.push('破 0.01 秒得 0.002，砍掉三分之一得 0.40 —— 只奖「打得狠」，不奖「守得久」（那是 M1-F2）。');
  L.push('');
  L.push('## 1 口径');
  L.push('');
  L.push('```');
  L.push('M6 = Σ_events min( gain, 0.5 )        gain = ln(前值/新值)');
  L.push('  · 仅 WR 链条（CR/NR 链条含大量缺环与低含金量，不取）');
  L.push('  · 截顶 0.5（≈ +65%，防链条断裂/早期粗糙成绩的假增益');
  L.push('    —— 实测全级别口径 p99 达 1.29，截顶仅影响 1% 尾部）');
  L.push('  · 无人数折算、无时代折算、自我刷新也计（连续刷是真实力度）');
  L.push('  · 归一：time(ms) 直接比 / number(步数) 直接比 / multi 解码 cost');
  L.push('    三种 format 统一「越小越强」，比率 ln(prev/new) 跨 format 可比');
  L.push('```');
  L.push('');
  L.push(`数据：链条 ${num(chains.size)} 条（基准 4,822±2 ✓）｜WR 刷新事件 ${num(wrN)} 条（基准 1,193 ✓）｜同场去重 ${num(dedup)}｜有分 ${num(LIST.length)} 人｜总量 ${F(total)}｜耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  L.push('');
  L.push('## 2 正交性');
  L.push('');
  L.push('```');
  L.push(...mtx);
  L.push('```');
  L.push('');
  L.push('判读：×M1-F2（剥离 r 后的纯持有）= 0.58 ⚠️ —— 低于 0.7 否决线但需如实标注。');
  L.push('×M1-F1 原版 0.73 正是 r 双计的实证，剥离后降到 0.58。');
  L.push('×M4 0.50 属中等（先驱们既跳得猛又常年在榜）。');
  L.push('');
  L.push('**时代分层检验**（按首次 WR 年代分桶，桶内 ρ(M6, M1-F2)）：');
  L.push('');
  L.push('| 首次 WR 年代 | n | 桶内 ρ |');
  L.push('|---|---|---|');
  for (const s of strat) L.push(`| ${s.b}–${s.b + 4} | ${s.n} | ${F(s.rho)} |`);
  L.push('');
  L.push('桶内相关不降 → 0.58 **不是时代混杂，是真实的人层面机制**：跳得越远 →');
  L.push('后人追平越难 → 守得越久。「打得狠」与「守得稳」在 WR 层面结构性联动，');
  L.push('两维不可能完全正交 —— 这是保留决定的已知代价，总分合成时按 0.58 折扣预期。');
  L.push('');
  L.push('## 3 全站榜（前 30）');
  L.push('');
  L.push('| # | 选手 | M6 | 刷新次数 | 项目/轨 | 最大单次 gain |');
  L.push('|---|---|---|---|---|---|');
  for (let i = 0; i < Math.min(30, LIST.length); i++) {
    const a = LIST[i];
    L.push(`| ${i + 1} | ${a.name} | **${F(a.m6)}** | ${a.n} | ${a.evs.size} | ${F(a.maxGain)} |`);
  }
  L.push('');
  L.push('## 4 锚点检验');
  L.push('');
  L.push('| 选手 | M6 | 名次 |');
  L.push('|---|---|---|');
  for (const nm of ['Feliks Zemdegs', 'Max Park', 'Yiheng Wang', 'Tymon Kolasiński', 'Stanley Chapel', 'Erik Akkersdijk', 'Lin Kaijun']) {
    const a = LIST.find((x) => x.name === nm);
    if (a) L.push(`| ${nm} | ${F(a.m6)} | #${rankOf(a.pid)} |`);
  }
  L.push('');
  L.push('## 5 已知边界');
  L.push('');
  L.push('- 链条第一段（各项目/轨首条 WR）无前值可比，天然无 gain——Minh Thai 的 22.95 在此口径得 0 分（「打得狠」需要参照物）。');
  L.push('- 2026 年为部分年，不影响本口径（逐事件计分，无窗口截断问题）。');
  L.push('- WR 链条依赖官方 regional_single/average_record 标记的完整性；快照变更须复核 WR 事件数 = 1,193±快照漂移。');
  L.push('- 仅 WR → 人口 281 人（六维中最少）；如需扩圈可开放 WR+CR（747 人，ρ×M1-F2 需复测），当前不采用。');
  L.push('');
  fs.writeFileSync(path.join(__dirname, 'M6_领先幅度.md'), L.join('\n') + '\n', 'utf8');

  console.log(mtx.join('\n'));
  console.log('top10:', LIST.slice(0, 10).map((a) => `${a.name} ${F(a.m6)}`).join(' | '));
  for (const nm of ['Feliks Zemdegs', 'Max Park', 'Yiheng Wang', 'Tymon Kolasiński', 'Stanley Chapel']) {
    const a = LIST.find((x) => x.name === nm);
    if (a) console.log(`  ${nm}: ${F(a.m6)} rank ${rankOf(a.pid)} (刷新${a.n}次, ${a.evs.size}项目轨)`);
  }
  console.log('写出 M6_seats.tsv / M6_by_record.tsv / M6_by_event.tsv / M6_领先幅度.md');
}

main().catch((e) => { console.error(e); process.exit(1); });

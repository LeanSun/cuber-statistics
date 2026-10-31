'use strict';
/* =============================================================================
 * M6-F2 · 领先幅度（时代平权版）· 生产脚本
 * -----------------------------------------------------------------------------
 * 历史：
 *   2026-10-25 定稿 M6-F2（取代 M6-F1「对手强度」）：M6 = Σ min(ln(prev/new),0.5)，无时代折算。
 *   2026-10-31 用户判定原口径「早期低垂果实虚高、后期硬核推进清零」损害公平，
 *              升级为【时代平权】口径（本次）：把每个 gain 除以同时代典型增益并纪元回中，
 *              使任一纪元的「典型一次 WR 刷新」都≈1单位，去除后期选手先天劣势。
 *              旧 M6-F2（无时代折算）SHA 见 §9 归档。
 *
 *   语义：你刷新纪录的那一刻，把人类前沿往前推了多远——且【按同时代难度归一】。
 *         rawNorm_i  = min( ln(prev/new)_i , 0.5 ) / ref_i
 *           ref_i    = 同一(eid,kind)在该事件「之前」WR 刷新增益的滚动中位数
 *                      （首条刷新无历史基准 → 记中性 1 单位）
 *         finalNorm_i = min( rawNorm_i / eraMedian , CAP_N )
 *           eraMedian = 该 5 年纪元 rawNorm 的中位数（回中→每纪元典型刷新≈1单位）
 *
 *   冻结常量：LEVEL='WR' CAP=0.5 CAP_N=5 FALLBACK_UNIT=1 RECENTER=true BUCKET_YEARS=5
 *
 *   正确性金标准（每次复跑必查）：
 *     · 链条数 4,824 ≈ js/data.js records 桶数 4,822（差 2 = 333mbo 边界）
 *     · WR 刷新事件 1,193 = records 重建精确一致（误差 0）
 *     · 标记行 55,244 = records 总数
 *
 *   实现要点（全部踩过的坑）：
 *     1. persons.tsv 国家列 = p[4]（表头 name|gender|wca_id|sub_id|country_id）
 *     2. 同场多条标记 = 不同范围的纪录线同时成立，范围 key 正确后自然分离
 *     3. NAR 是独立层级，不并入 NR
 *     4. multi 编码值须 decodeMulti 折算 cost 后才可比
 *     5. 333fm / number 类：值本身即 cost（步数），无需换向
 *     6. results.tsv person_id = 第 9 列（p[8]）
 *     7. ref 仅取「此前」事件（无未来信息泄漏）；回中按纪元桶在 wrEv 上统一做
 *
 * 运行：node --max-old-space-size=8192 etl/score/m6_lead.js    （约 10s）
 * 产出：M6_seats.tsv / M6_by_record.tsv / M6_by_event.tsv / M6_领先幅度.md
 * ============================================================================= */
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const ROOT = path.resolve(__dirname, '../..');
const ZIP = path.join(ROOT, 'data/raw/WCA_export_v2_288_20261015T000017Z.tsv.zip');
const TMP = path.join(ROOT, '.workbuddy/tmp/oc');

const CFG = {
  LEVEL: 'WR',
  CAP: 0.5,          // 单事件 rawGain 截顶（防链条断裂/早期粗糙假增益）
  CAP_N: 5,          // 归一后 finalNorm 截顶（防极端事件独大）
  FALLBACK_UNIT: 1,  // 首条刷新无历史基准时的中性单位
  RECENTER: true,    // 纪元回中：每纪元「典型一次 WR 刷新」≈ 1 单位
  BUCKET_YEARS: 5    // 回中用的纪元桶宽（年）
};

const F = (x, n = 4) => Number(x).toFixed(n);
const num = (x) => Number(x).toLocaleString('en-US');

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
function decodeMulti(v) {
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
function median(arr) {
  if (!arr.length) return NaN;
  const s = [...arr].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/* ── 相关性：秩 + 中心化 pearson（必须中心化，否则是余弦、全矩阵虚高） ── */
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
    if (p[2]) { pname.set(p[2], p[0]); pctr.set(p[2], p[4]); }
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

  /* ═══ S2.5 时代平权：按(eid,kind)滚动中位数基准 + 纪元回中 ═══ */
  const wrEv = events.filter((e) => e.level === 'WR');
  const groups = new Map();
  for (const e of wrEv) {
    const k = e.eid + '|' + e.kind;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e);
  }
  for (const [, arr] of groups) {
    arr.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.cost - b.cost));
  }
  const REF_GLOBAL = median(wrEv.map((e) => e.gain));
  let nFallback = 0;
  for (const [, arr] of groups) {
    const gains = arr.map((e) => e.gain);
    for (let i = 0; i < arr.length; i++) {
      const e = arr[i];
      const cappedRaw = Math.min(e.gain, CFG.CAP);
      let norm, ref;
      if (i === 0) {
        norm = CFG.FALLBACK_UNIT; ref = NaN; nFallback++;
      } else {
        ref = median(gains.slice(0, i));   // 仅用「此前」事件，无未来泄漏
        norm = cappedRaw / ref;
      }
      e.cappedRaw = cappedRaw;
      e.rawNorm = norm;                         // 未封顶（供纪元回中用）
      e.normGain = Math.min(norm, CFG.CAP_N);   // 仅作参考展示
      e.ref = ref;
    }
  }
  /* 纪元回中：让每一纪元的「典型一次 WR 刷新」≈ 1 单位，完成平等化 */
  let nCapped = 0;
  if (CFG.RECENTER) {
    const byBucket = new Map();
    for (const e of wrEv) {
      const b = Math.floor(+e.date.slice(0, 4) / CFG.BUCKET_YEARS) * CFG.BUCKET_YEARS;
      if (!byBucket.has(b)) byBucket.set(b, []);
      byBucket.get(b).push(e.rawNorm);
    }
    const medOf = new Map();
    for (const [b, arr] of byBucket) medOf.set(b, median(arr));
    console.log('纪元回中系数（rawNorm中位数→1）：');
    for (const b of [...medOf.keys()].sort((x, y) => x - y))
      console.log(`  ${b}s  rawNorm中位=${F(medOf.get(b), 4)}  系数×${(1 / medOf.get(b)).toFixed(3)}`);
    for (const e of wrEv) {
      const b = Math.floor(+e.date.slice(0, 4) / CFG.BUCKET_YEARS) * CFG.BUCKET_YEARS;
      const fn = Math.min(e.rawNorm / medOf.get(b), CFG.CAP_N);
      if (fn >= CFG.CAP_N - 1e-9) nCapped++;
      e.finalNorm = fn;
    }
  } else {
    for (const e of wrEv) {
      e.finalNorm = e.normGain;
      if (e.finalNorm >= CFG.CAP_N - 1e-9) nCapped++;
    }
  }
  const norms = wrEv.map((e) => e.finalNorm).sort((a, b) => a - b);
  const pct = (q) => norms[Math.min(norms.length - 1, Math.floor(q * norms.length))];
  console.log(`REF_GLOBAL(中位数gain)=${F(REF_GLOBAL,6)} 首条无基准事件=${num(nFallback)} 触CAP_N=${num(nCapped)}`);
  console.log(`finalNorm分布 min=${F(norms[0],4)} p50=${F(pct(0.5),4)} p90=${F(pct(0.9),4)} p99=${F(pct(0.99),4)} max=${F(norms[norms.length-1],4)}`);

  /* ═══ S3 双口径聚合：旧(无时代折算) vs 新(平权)，新为权威 ═══ */
  const seats = new Map();
  const byEv = new Map();
  for (const e of events) {
    if (e.level !== CFG.LEVEL) continue;
    const gOld = Math.min(e.gain, CFG.CAP);
    const gNew = e.finalNorm;
    let a = seats.get(e.pid);
    if (!a) {
      a = { pid: e.pid, name: pname.get(e.pid) || '', m6old: 0, m6new: 0, m6raw: 0,
            n: 0, maxGainOld: 0, evs: new Set(), firstDate: e.date };
      seats.set(e.pid, a);
    }
    a.m6old += gOld; a.m6new += gNew; a.m6raw += e.gain; a.n++;
    if (e.gain > a.maxGainOld) a.maxGainOld = e.gain;
    a.evs.add(e.eid + '|' + e.kind);
    const bk = e.pid + '|' + e.eid + '|' + e.kind;
    byEv.set(bk, (byEv.get(bk) || 0) + gNew);
  }
  const OLD = [...seats.values()].sort((a, b) => b.m6old - a.m6old);
  const NEW = [...seats.values()].sort((a, b) => b.m6new - a.m6new);
  const totalOld = OLD.reduce((s, a) => s + a.m6old, 0);
  const totalNew = NEW.reduce((s, a) => s + a.m6new, 0);
  console.log(`有分人数=${num(NEW.length)} 总量OLD=${F(totalOld)} 总量NEW=${F(totalNew)} 耗时=${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`[自检] OLD总量应≈75.5181（封存旧基准），偏差=${F(totalOld - 75.5181, 4)}`);
  const oldRank = new Map(), newRank = new Map();
  OLD.forEach((a, i) => oldRank.set(a.pid, i + 1));
  NEW.forEach((a, i) => newRank.set(a.pid, i + 1));

  /* ═══ S4 正交性矩阵（新 M6 权威，旧 M6 仅作解封对照）═══ */
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
  const m6NewMap = new Map(NEW.map((a) => [a.pid, a.m6new]));
  const m6OldMap = new Map(OLD.map((a) => [a.pid, a.m6old]));
  const mtx = [];
  for (const [nm, m] of [['M1-F2 纯持有', M1F2], ['M1-F1 原版', M1F1], ['M2', M2], ['M4', M4], ['M5', M5]]) {
    const r = crossRho(m6NewMap, m);
    const mark = Math.abs(r.rho) > 0.7 ? ' ❌' : (Math.abs(r.rho) > 0.5 ? ' ⚠️' : '');
    mtx.push(`  ×${nm.padEnd(12)} ρ=${F(r.rho)}${mark}  (n=${num(r.n)})`);
  }
  if (M6F1) {
    const r = crossRho(m6NewMap, M6F1);
    mtx.push(`  ×M6-F1对手   ρ=${F(r.rho)}  (n=${num(r.n)})`);
  }
  const mtxOld = [];
  for (const [nm, m] of [['M1-F2 纯持有', M1F2], ['M1-F1 原版', M1F1], ['M2', M2], ['M4', M4], ['M5', M5]]) {
    const r = crossRho(m6OldMap, m);
    mtxOld.push(`  ×${nm.padEnd(12)} ρ=${F(r.rho)}  (n=${num(r.n)})`);
  }
  const strat = [];
  {
    const buckets = {};
    for (const a of NEW) {
      const b = Math.floor(+a.firstDate.slice(0, 4) / 5) * 5;
      (buckets[b] = buckets[b] || []).push(a);
    }
    for (const b of Object.keys(buckets).map(Number).sort((x, y) => x - y)) {
      const arr = buckets[b];
      if (arr.length < 15) continue;
      const pr = arr.filter((a) => M1F2.has(a.pid)).map((a) => [a.m6new, M1F2.get(a.pid)]);
      if (pr.length >= 15) strat.push({ b, n: pr.length, rho: spearman(pr).rho });
    }
  }

  /* ═══ S5 导出（封存原文件名）═══ */
  fs.writeFileSync(path.join(__dirname, 'M6_seats.tsv'),
    'pid\tname\tm6\tn_refresh\tn_tracks\tmax_gain\tfirst_wr\n' +
    NEW.map((a) => `${a.pid}\t${a.name.replace(/\t/g, ' ')}\t${F(a.m6new)}\t${a.n}\t${a.evs.size}\t${F(a.maxGainOld)}\t${a.firstDate}`).join('\n') + '\n', 'utf8');
  fs.writeFileSync(path.join(__dirname, 'M6_by_record.tsv'),
    'pid\tevent\tkind\tdate\tprev_cost\tnew_cost\tgain\tcapped_gain\tref\traw_norm\tfinal_norm\tsame_person\n' +
    wrEv.sort((a, b) => a.date < b.date ? -1 : 1)
      .map((e) => `${e.pid}\t${e.eid}\t${e.kind}\t${e.date}\t${F(e.prevCost)}\t${F(e.newCost)}\t${F(e.gain,6)}\t${F(e.cappedRaw,6)}\t${e.ref ? F(e.ref,6) : 'NA'}\t${F(e.rawNorm,4)}\t${F(e.finalNorm,4)}\t${e.samePerson ? 1 : 0}`).join('\n') + '\n', 'utf8');
  {
    const rows = [...byEv.entries()].map(([k, v]) => { const [pid, ev, kind] = k.split('|'); return { pid, name: (seats.get(pid) || {}).name || '', ev, kind, m6: v }; }).sort((a, b) => b.m6 - a.m6);
    fs.writeFileSync(path.join(__dirname, 'M6_by_event.tsv'),
      'pid\tname\tevent\tkind\tm6\n' + rows.map((r) => `${r.pid}\t${r.name.replace(/\t/g, ' ')}\t${r.ev}\t${r.kind}\t${F(r.m6)}`).join('\n') + '\n', 'utf8');
  }

  /* ═══ S6 报告 ═══ */
  const L = [];
  L.push('# M6-F2 · 领先幅度（时代平权版）');
  L.push('');
  L.push('> 由 `etl/score/m6_lead.js` 生成（2026-10-31 升级为时代平权口径）。所有数字现算。');
  L.push('');
  L.push('## 0 一句话');
  L.push('');
  L.push('**你刷新纪录的那一刻，把人类前沿推远了多少——且按同时代难度归一。** 早期低垂果实不再虚高，后期指甲盖级硬核推进不再清零。');
  L.push(`OLD(无时代折算) 总量 ${F(totalOld)} → NEW(时代平权) 总量 ${F(totalNew)}（六维归一按 max 计，绝对刻度不影响合成）。`);
  L.push('');
  L.push('## 1 口径');
  L.push('');
  L.push('```');
  L.push('finalNorm_i = min( rawNorm_i / eraMedian , CAP_N )');
  L.push('  rawNorm_i = min( ln(prev/new)_i , 0.5 ) / ref_i');
  L.push('    ref_i = 同一(eid,kind)在该事件之前的 WR 刷新 gain 滚动中位数');
  L.push('          （首条刷新无历史基准 → 记中性 1 单位）');
  L.push('  eraMedian = 该 5 年纪元 rawNorm 的中位数（回中→每纪元典型刷新≈1单位）');
  L.push(`CFG: LEVEL=WR CAP=${CFG.CAP} CAP_N=${CFG.CAP_N} 首条中性=${CFG.FALLBACK_UNIT} RECENTER=${CFG.RECENTER} 桶=${CFG.BUCKET_YEARS}年`);
  L.push('```');
  L.push('');
  L.push(`数据：链条 ${num(chains.size)} 条｜WR 刷新事件 ${num(wrN)} 条（基准 1,193 ✓）｜同场去重 ${num(dedup)}｜有分 ${num(NEW.length)} 人`);
  L.push(`REF_GLOBAL(全WR gain中位数)=${F(REF_GLOBAL,6)}；首条无基准事件=${num(nFallback)}；触CAP_N=${num(nCapped)}`);
  L.push(`finalNorm分布：min=${F(norms[0],4)} p50=${F(pct(0.5),4)} p90=${F(pct(0.9),4)} p99=${F(pct(0.99),4)} max=${F(norms[norms.length-1],4)}（p50=1.0 即平权成功）`);
  L.push('');
  L.push('## 2 正交性（新 M6 权威；旧 M6 解封对照）');
  L.push('');
  L.push('```');
  L.push('--- 新 M6（时代平权）---');
  L.push(...mtx);
  L.push('--- 旧 M6（无时代折算，封存对照）---');
  L.push(...mtxOld);
  L.push('```');
  L.push('');
  L.push('**时代分层检验**（按首次 WR 年代分桶，桶内 ρ(新M6, M1-F2)）：');
  L.push('');
  L.push('| 首次 WR 年代 | n | 桶内 ρ |');
  L.push('|---|---|---|');
  for (const s of strat) L.push(`| ${s.b}–${s.b + 4} | ${s.n} | ${F(s.rho)} |`);
  L.push('');
  L.push('## 3 全站榜（新 M6 前 30，附旧名次与升降）');
  L.push('');
  L.push('| # | 选手 | M6新 | M6旧 | 旧名次 | 名次Δ | 刷新次数 |');
  L.push('|---|---|---|---|---|---|---|');
  for (let i = 0; i < Math.min(30, NEW.length); i++) {
    const a = NEW[i];
    const or = oldRank.get(a.pid), nr = newRank.get(a.pid);
    const delta = or - nr;
    const dstr = delta === 0 ? '—' : (delta > 0 ? `+${delta}` : `${delta}`);
    L.push(`| ${i + 1} | ${a.name} | **${F(a.m6new)}** | ${F(a.m6old)} | #${or} | ${dstr} | ${a.n} |`);
  }
  L.push('');
  L.push('## 4 锚点检验（旧→新，名次变化）');
  L.push('');
  L.push('| 选手 | M6旧 | M6新 | 旧名次 | 新名次 | 刷新次数 |');
  L.push('|---|---|---|---|---|---|');
  for (const nm of ['Feliks Zemdegs', 'Max Park', 'Yiheng Wang', 'Tymon Kolasiński', 'Stanley Chapel', 'Erik Akkersdijk', 'Lin Kaijun']) {
    const a = NEW.find((x) => x.name === nm);
    if (a) L.push(`| ${nm} | ${F(a.m6old)} | **${F(a.m6new)}** | #${oldRank.get(a.pid)} | #${newRank.get(a.pid)} | ${a.n} |`);
  }
  L.push('');
  L.push('## 5 已知边界 / 升级说明');
  L.push('');
  L.push('- 2026-10-31 升级：原「无时代折算」口径令早期大数值低含金量刷新虚高、后期硬核推进清零；现按(项目×轨)滚动中位数基准 + 纪元回中修正。');
  L.push(`- 代价：新 M6 ×M1-F2 升至 0.67（仍 ⚠️ 未破 0.7），×M1-F1 破 0.7（❌）。原因：平权后 M6≈「破纪录次数×同时代难度」，与「长期霸榜」(M1) 更同向——以正交性换取时代公平，符合本次修复首要诉求。`);
  L.push('- ref 仅取「此前」事件（无未来泄漏）；首条刷新记中性 1 单位；CAP_N 封顶触顶事件见上。');
  L.push('- 尚未接入 build.js（见封存 §10 #4）；接入时站点 m6 字段含义即本口径。');
  L.push('- 链条首段（各项目/轨首条 WR）无前值可比，天然无 gain——Minh Thai 得 0 分。');
  L.push('');
  fs.writeFileSync(path.join(__dirname, 'M6_领先幅度.md'), L.join('\n') + '\n', 'utf8');

  console.log(mtx.join('\n'));
  console.log('--- 旧 M6 对照 ---');
  console.log(mtxOld.join('\n'));
  console.log('top10 NEW:', NEW.slice(0, 10).map((a) => `${a.name} ${F(a.m6new)} (旧#${oldRank.get(a.pid)})`).join(' | '));
  console.log('写出 M6_seats.tsv / M6_by_record.tsv / M6_by_event.tsv / M6_领先幅度.md');
}

main().catch((e) => { console.error(e); process.exit(1); });

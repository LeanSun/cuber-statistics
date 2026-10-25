/* M4「竞争密度折算」方案的敏感性与影响面分析
 *
 * 配合 m4_alt_eras.js 使用：评估方案 C（时代折算 × 竞争密度）
 *   ① ACT_REF 阈值敏感性
 *   ② 谁受益、谁受损（有没有误伤）
 *   ③ 与 M1 的口径一致性检查
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const RN = require(path.join(ROOT, 'etl/score/runs.js'));
const M1 = require(path.join(ROOT, 'etl/score/m1.js'));

const zip = fs.readdirSync(path.join(ROOT, 'data/raw')).find((f) => f.endsWith('.zip'));

function streamTsv(name, onLine) {
  return new Promise((res, rej) => {
    const ps = spawn('unzip', ['-p', path.join(ROOT, 'data/raw', zip), name], { maxBuffer: 1 << 29 });
    let buf = '', head = true;
    ps.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        if (head) { head = false; continue; }
        if (line) onLine(line.split('\t'));
      }
    });
    ps.on('close', res);
    ps.on('error', rej);
  });
}

(async () => {
  /* ── 赛事日期 ── */
  const compDay = new Map();
  await streamTsv('WCA_export_competitions.tsv', (r) => {
    if (!r[0] || r[10] === '1') return;
    const y = +r[17] || +r[14], m = +r[18] || +r[15] || 1, d = +r[19] || +r[16] || 1;
    compDay.set(r[0], RN.dayOf(y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0')));
  });

  /* ── 逐年各项目活跃人数 ── */
  const actSets = new Map();   // "ev|year" -> Set(pid)
  const firstYear = new Map();
  await streamTsv('WCA_export_results.tsv', (r) => {
    const ev = r[6], pid = r[8], compId = r[4];
    if (!ev || !pid) return;
    const day = compDay.get(compId);
    if (day === undefined) return;
    const y = RN.yearOfDay(day) | 0;
    const key = ev + '|' + y;
    let s = actSets.get(key);
    if (!s) { s = new Set(); actSets.set(key, s); }
    s.add(pid);
    const c = firstYear.get(pid);
    if (c === undefined || y < c) firstYear.set(pid, y);
  });

  const ACT = new Map();
  for (const [k, s] of actSets) ACT.set(k, s.size);

  /* ── 时代系数（复刻 M4 的 fGlobal）── */
  const people = [];
  let baseYear = Infinity;
  for (const y of firstYear.values()) { people.push({ y }); if (y < baseYear) baseYear = y; }
  for (const p of people) if (p.y > baseYear) baseYear = p.y;
  const gpool = M1.makeScopePool(people, baseYear);
  const fGlobal = (y) => gpool.valueOf('WR', {}, y);

  /* ── M4 逐年席位天 ── */
  const rows = fs.readFileSync(path.join(__dirname, 'M4_by_year.tsv'), 'utf8')
    .trim().split('\n').slice(1).map((l) => {
      const c = l.split('\t');
      return { ev: c[0], tr: c[1], pid: c[2], name: c[3], year: +c[4], seat: +c[5] };
    });

  const W = RN.EV_WEIGHT_V2;
  const wOf = (ev) => (W[ev] == null ? RN.WEIGHT_V2_CFG.floor : W[ev]);

  const scoreWith = (ref) => {
    const m = new Map();
    for (const r of rows) {
      const f = fGlobal(r.year);
      const n = ACT.get(r.ev + '|' + r.year) || 0;
      const c = n <= 0 ? 0 : Math.min(1, n / ref);
      if (!c) continue;
      const v = wOf(r.ev) * r.seat * f * c / 365;
      m.set(r.pid, (m.get(r.pid) || 0) + v);
    }
    return m;
  };

  const base = new Map();
  for (const r of rows) {
    const v = wOf(r.ev) * r.seat * fGlobal(r.year) / 365;
    base.set(r.pid, (base.get(r.pid) || 0) + v);
  }
  const nameOf = new Map();
  for (const r of rows) nameOf.set(r.pid, r.name);

  /* ── ① 阈值敏感性 ── */
  console.log('════ ① ACT_REF 阈值敏感性 ════');
  console.log('ref | 全站合计 | Top10 与现状重合 | Minh Thai | Minh Thai 排名 | 受影响人数(变动>5%)');
  const baseTop10 = [...base.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map((x) => x[0]);
  for (const ref of [3, 5, 10, 20, 30, 50]) {
    const m = scoreWith(ref);
    const arr = [...m.entries()].sort((a, b) => b[1] - a[1]);
    const t10 = arr.slice(0, 10).map((x) => x[0]);
    const ov = t10.filter((x) => baseTop10.includes(x)).length;
    const mt = arr.find((x) => nameOf.get(x[0]) === 'Minh Thai');
    let affected = 0;
    for (const [pid, v] of m) {
      const b = base.get(pid) || 0;
      if (b > 0.5 && Math.abs(v - b) / b > 0.05) affected++;
    }
    console.log('  ' + String(ref).padStart(3) + ' | ' +
      arr.reduce((a, b) => a + b[1], 0).toFixed(4).padStart(10) + ' | ' +
      String(ov + '/10').padStart(14) + ' | ' +
      (mt ? mt[1].toFixed(4) : '—').padStart(9) + ' | ' +
      (mt ? ('#' + (arr.findIndex((x) => x[0] === mt[0]) + 1)) : '—').padStart(11) + ' | ' +
      String(affected).padStart(8));
  }
  console.log('');
  console.log('  现状（无密度折算）：全站合计 = ' +
    [...base.values()].reduce((a, b) => a + b, 0).toFixed(4) + '，Minh Thai = 5.0935 / #30');
  console.log('');

  /* ── ② ref=10 下的受益/受损 ── */
  const REF = 10;
  const m10 = scoreWith(REF);
  console.log('════ ② ref=' + REF + '：谁受益、谁受损 ════');
  const diff = [];
  for (const [pid, v] of m10) {
    const b = base.get(pid) || 0;
    diff.push({ pid, name: nameOf.get(pid), b, c: v, d: v - b, pct: b > 0 ? (v - b) / b : 0 });
  }
  diff.sort((a, b) => a.d - b.d);
  console.log('  ▼ 受损最大（原本靠停滞期占位得分）：');
  for (const d of diff.slice(0, 12)) {
    console.log('    ' + d.name.padEnd(26) + d.b.toFixed(4).padStart(8) + ' → ' + d.c.toFixed(4).padStart(8) +
      '   (' + (d.pct * 100).toFixed(1) + '%)');
  }
  console.log('');
  console.log('  ▲ 受益最大（密度折算让他们的有效竞争期权重更高）：');
  for (const d of diff.slice(-8).reverse()) {
    if (d.d <= 0) continue;
    console.log('    ' + d.name.padEnd(26) + d.b.toFixed(4).padStart(8) + ' → ' + d.c.toFixed(4).padStart(8) +
      '   (+' + (d.pct * 100).toFixed(1) + '%)');
  }
  console.log('');

  /* ── ③ 全站 Top25 对照 ── */
  console.log('════ ③ 全站 Top25：现状 vs 方案C(ref=' + REF + ') ════');
  const bArr = [...base.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25);
  const cArr = [...m10.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25);
  console.log('  # | 现状 | 分 | | 方案C | 分');
  for (let i = 0; i < 25; i++) {
    const b = bArr[i], c = cArr[i];
    console.log('  ' + String(i + 1).padStart(2) + ' | ' + (b ? nameOf.get(b[0]).padEnd(24) : '—').padEnd(24) +
      (b ? b[1].toFixed(4) : '—').padStart(9) + ' | | ' +
      (c ? nameOf.get(c[0]).padEnd(24) : '—').padEnd(24) + (c ? c[1].toFixed(4) : '—').padStart(9) +
      (b && c && b[0] !== c[0] ? '   ⚠ 变动' : ''));
  }
  console.log('');
  const ov25 = bArr.filter((x) => cArr.some((y) => y[0] === x[0])).length;
  console.log('  Top25 重合 = ' + ov25 + '/25');

  /* ── ④ 各项目的「停滞年」清单（低密度年份）── */
  console.log('');
  console.log('════ ④ 各项目「停滞年」（活跃人数 < 10）════');
  const stallByEv = new Map();
  for (const [k, n] of ACT) {
    if (n >= 10) continue;
    const [ev, y] = k.split('|');
    if (!stallByEv.has(ev)) stallByEv.set(ev, []);
    stallByEv.get(ev).push({ y: +y, n });
  }
  for (const [ev, arr] of [...stallByEv.entries()].sort((a, b) => b[1].length - a[1].length)) {
    arr.sort((a, b) => a.y - b.y);
    const seg = [];
    for (const a of arr) {
      const last = seg[seg.length - 1];
      if (last && a.y === last.to + 1) { last.to = a.y; last.n += a.n; last.years++; }
      else seg.push({ from: a.y, to: a.y, n: a.n, years: 1 });
    }
    console.log('  ' + (RN.EV_CN && RN.EV_CN[ev] ? RN.EV_CN[ev] : ev).padEnd(8) + ' `' + ev + '`  ' +
      seg.map((s) => s.from + (s.to > s.from ? '–' + s.to : '') + '（' + s.n + '人/年）').join('、'));
  }

  /* ── ⑤ M1 口径一致性 ── */
  console.log('');
  console.log('════ ⑤ 与 M1 的一致性 ════');
  console.log('  M1 里 Minh Thai 的 21.2 年三阶持有段得分 = 0（首段无前值 → r=0 → 0 分）');
  console.log('  M4 现状给他 ' + (base.get([...base.keys()].find((k) => nameOf.get(k) === 'Minh Thai')) || 0).toFixed(4) +
    '，方案C 给他 ' +
    (m10.get([...m10.keys()].find((k) => nameOf.get(k) === 'Minh Thai')) || 0).toFixed(4));
})();

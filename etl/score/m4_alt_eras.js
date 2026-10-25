/* M4 折算方案试算器（诊断脚本，不改动 M4 主脚本）
 *
 * 背景：Minh Thai 三阶单次折算后仍排全站 #30。根因是
 *   1982-2002 这 21 年「全球没有任何新的三阶单次成绩」，
 *   所谓「世界第一」是在一个静止的世界上保持的 —— 没人参赛。
 *
 * 本脚本读取 M4_by_year.tsv（逐年名次加权席位天）与原始成绩，
 * 试算若干替代折算方案对榜单的影响。
 *
 * 用法：node etl/score/m4_alt_eras.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const RN = require(path.join(ROOT, 'etl/score/runs.js'));

const TRACKS = ['single', 'average'];
/* 与主脚本一致：多盲只有单次 */
const MULTI_ONLY = new Set(['333mbf', '333mbo']);

const zip = fs.readdirSync(path.join(ROOT, 'data/raw')).find((f) => f.endsWith('.zip'));
if (!zip) throw new Error('找不到 WCA 导出 zip');

function streamTsv(name, onLine) {
  return new Promise((res, rej) => {
    const ps = spawn('unzip', ['-p', path.join(ROOT, 'data/raw', zip), name], {
      maxBuffer: 1024 * 1024 * 512,
    });
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
  /* ── 1. 赛事日期表 ── */
  const compDay = new Map();
  await streamTsv('WCA_export_competitions.tsv', (r) => {
    if (!r[0] || r[10] === '1') return;                 // 取消的赛事不计
    const y = +r[17] || +r[14], m = +r[18] || +r[15] || 1, d = +r[19] || +r[16] || 1;
    compDay.set(r[0], RN.dayOf(y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0')));
  });

  /* ── 2. 逐年「该项目该轨道」的活跃人数（当年出过成绩的人数）── */
  const activeByComboYear = new Map();   // "ev|tr|year" -> Set(pid)
  await streamTsv('WCA_export_results.tsv', (r) => {
    const ev = r[6], pid = r[8], compId = r[4];
    if (!ev || !pid) return;
    const day = compDay.get(compId);
    if (day === undefined) return;
    const tr = (ev === '333mbf' || ev === '333mbo') ? 'single' : 'single';
    /* 平均轨道的活跃人数用「该年有 ≥5 次成绩的选手」近似过重，
       这里统一用「单次成绩参与人数」作为竞争密度代理，够用 */
    const key = ev + '|single|' + (RN.yearOfDay(day) | 0);
    let s = activeByComboYear.get(key);
    if (!s) { s = new Set(); activeByComboYear.set(key, s); }
    s.add(pid);
  });
  void TRACKS; void MULTI_ONLY;

  const ACT = new Map();   // "ev|tr|year" -> 人数
  for (const [k, s] of activeByComboYear) ACT.set(k, s.size);

  /* ── 3. 读 M4_by_year.tsv ── */
  const byYear = fs.readFileSync(path.join(__dirname, 'M4_by_year.tsv'), 'utf8')
    .trim().split('\n').slice(1);
  const rows = byYear.map((l) => {
    const c = l.split('\t');
    return { ev: c[0], tr: c[1], pid: c[2], name: c[3], year: +c[4], seat: +c[5] };
  });

  /* ── 4. 各折算方案 ── */
  const W = RN.EV_WEIGHT_V2;
  const wOf = (ev) => (W[ev] == null ? RN.WEIGHT_V2_CFG.floor : W[ev]);

  /* 直接重算时代系数：统计「每年首次出成绩的选手数」→ 累计人数 → f */
  const firstYearByPid = new Map();
  await streamTsv('WCA_export_results.tsv', (r) => {
    const pid = r[8], compId = r[4];
    if (!pid) return;
    const day = compDay.get(compId);
    if (day === undefined) return;
    const y = RN.yearOfDay(day) | 0;
    const c = firstYearByPid.get(pid);
    if (c === undefined || y < c) firstYearByPid.set(pid, y);
  });
  const M1 = require(path.join(ROOT, 'etl/score/m1.js'));
  const people = [];
  let baseYear = Infinity;
  for (const y of firstYearByPid.values()) {
    people.push({ y });
    if (y < baseYear) baseYear = y;
  }
  for (const p of people) if (p.y > baseYear) baseYear = p.y;
  const gpool = M1.makeScopePool(people, baseYear);
  const fGlobal = (y) => gpool.valueOf('WR', {}, y);

  /* 方案 B：竞争密度折算 —— 席位的价值取决于「当年该项目有多少人在竞争」
     c(y) = min(1, 活跃人数 / ACT_REF) */
  const ACT_REF = 10;   // 当年活跃人数 ≥10 人即视为「正常竞争」

  /* 方案 C：竞争密度 + 时代折算（双折算）*/
  /* 方案 D：只按竞争密度，不做时代折算 */

  const schemes = {
    A_current: (ev, tr, y) => fGlobal(y),
    B_density: (ev, tr, y) => Math.min(1, (ACT.get(ev + '|single|' + y) || 0) / ACT_REF),
    C_both: (ev, tr, y) => fGlobal(y) * Math.min(1, (ACT.get(ev + '|single|' + y) || 0) / ACT_REF),
    D_densityOnly_ln: (ev, tr, y) => {
      const n = ACT.get(ev + '|single|' + y) || 0;
      return n <= 0 ? 0 : Math.log(1 + n) / Math.log(1 + ACT_REF * 4);
    },
  };

  const results = {};
  for (const k of Object.keys(schemes)) results[k] = new Map();

  for (const r of rows) {
    const w = wOf(r.ev);
    for (const [k, fn] of Object.entries(schemes)) {
      const f = fn(r.ev, r.tr, r.year);
      if (!f) continue;
      const v = w * r.seat * f / 365;
      const m = results[k];
      m.set(r.pid, (m.get(r.pid) || 0) + v);
    }
  }

  /* ── 5. 打印对比 ── */
  const nameOf = new Map();
  for (const r of rows) nameOf.set(r.pid, r.name);

  console.log('════ 折算方案对比（Top12）════');
  console.log('方案 A = 现行（M1 全局池 ln）');
  console.log('方案 B = 只按竞争密度：min(1, 当年该项目活跃人数 / ' + ACT_REF + ')');
  console.log('方案 C = 时代折算 × 竞争密度');
  console.log('方案 D = 只按竞争密度（ln 版）');
  console.log('');

  for (const [k, m] of Object.entries(results)) {
    const arr = [...m.entries()].sort((a, b) => b[1] - a[1]);
    console.log('── ' + k + ' ── 全站合计 = ' +
      arr.reduce((a, b) => a + b[1], 0).toFixed(4) + '，人数 = ' + arr.length);
    arr.slice(0, 12).forEach((x, i) => {
      console.log('   ' + String(i + 1).padStart(2) + '. ' + String(nameOf.get(x[0])).padEnd(26) + x[1].toFixed(4));
    });
    const mt = arr.findIndex((x) => nameOf.get(x[0]) === 'Minh Thai');
    console.log('     Minh Thai 排名 = ' + (mt < 0 ? '未上榜' : '#' + (mt + 1) + '  ' + arr[mt][1].toFixed(4)));
    console.log('');
  }

  /* ── 6. 关键案例：Minh Thai 三阶单次逐年拆解 ── */
  console.log('════ Minh Thai · 三阶单次：逐年拆解 ════');
  console.log('年份 | 名次加权席位天 | 当年活跃人数 | f(时代) | c(密度) | A 贡献 | C 贡献');
  const mt = rows.filter((r) => r.name === 'Minh Thai' && r.ev === '333' && r.tr === 'single')
    .sort((a, b) => a.year - b.year);
  let sa = 0, sc = 0;
  for (const r of mt) {
    const act = ACT.get('333|single|' + r.year) || 0;
    const f = fGlobal(r.year);
    const c = Math.min(1, act / ACT_REF);
    const w = wOf(r.ev);
    const ca = w * r.seat * f / 365, cc = w * r.seat * f * c / 365;
    sa += ca; sc += cc;
    console.log('  ' + r.year + ' | ' + r.seat.toFixed(0).padStart(10) + ' | ' +
      String(act).padStart(12) + ' | ' + f.toFixed(4) + ' | ' + c.toFixed(4) + ' | ' +
      ca.toFixed(4).padStart(7) + ' | ' + cc.toFixed(4).padStart(7));
  }
  console.log('  合计: A = ' + sa.toFixed(4) + '   C = ' + sc.toFixed(4));

  /* ── 7. 三阶单次榜在方案 C 下的变化 ── */
  console.log('');
  console.log('════ 三阶单次榜：方案 A vs 方案 C ════');
  const build = (fn) => {
    const m = new Map();
    for (const r of rows) {
      if (r.ev !== '333' || r.tr !== 'single') continue;
      const f = fn(r.ev, r.tr, r.year);
      if (!f) continue;
      const v = wOf(r.ev) * r.seat * f / 365;
      m.set(r.pid, (m.get(r.pid) || 0) + v);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };
  const a3 = build(schemes.A_current), c3 = build(schemes.C_both);
  console.log('A Top8: ' + a3.slice(0, 8).map((x) => nameOf.get(x[0]) + ' ' + x[1].toFixed(4)).join(' | '));
  console.log('C Top8: ' + c3.slice(0, 8).map((x) => nameOf.get(x[0]) + ' ' + x[1].toFixed(4)).join(' | '));
  const ov = a3.slice(0, 10).filter((x) => c3.slice(0, 10).some((y) => y[0] === x[0])).length;
  console.log('Top10 重合 = ' + ov + '/10');
})();

'use strict';
/* 专项：greater_china（大中华区冠军赛）被当成洲际赛 CC 的问题
 *
 * 事实：WCA 的 championship_type 有第四类，不是「世界/洲/国家」三种 ——
 *   还有 greater_china（大中华区），6 行。tierOf 把它归到 CC。
 *   受影响的赛事是 ChinaChampionship 系列（中国最高级别赛事）。
 *
 * 用法：node etl/score/diag_m2_greaterchina.js
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
    let buf = '', head = true;
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
    const types = ctypes.get(compId);
    /* 只 greater_china、且没有任何洲级标识 → 才是「被当成洲际赛的区域赛」。
       AsianChampionship2016 同时有 _Asia 和 greater_china，它本来就是洲际赛，不算。 */
    const tArr = [...types].map((t) => String(t).toLowerCase());
    const hasGC = tArr.includes('greater_china');
    const hasCont = tArr.some((t) => t.charAt(0) === '_') || tArr.includes('world');
    podiums.push({
      pid, ev: r[6], pos, compId, year,
      tier: M2.tierOf(types, nat),
      nat, cont: (isoInfo.get(nat) || {}).cont || 'Unknown',
      compName: comp.name, isGC: hasGC, pureGC: hasGC && !hasCont,
      name: (pInfo.get(pid) || {}).name || r[7] || pid,
    });
  });

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

  const gcAll = podiums.filter((p) => p.isGC);
  const gcN = new Set(podiums.filter((p) => p.pureGC).map((p) => p.compId)).size;
  const gcRows = podiums.filter((p) => p.pureGC);
  const gcComps = new Set(gcAll.map((p) => p.compId));

  console.log('══ greater_china 命中什么 ══\n');
  console.log('championship_type 含 greater_china 的赛事：' + gcComps.size + ' 场');
  const byComp = new Map();
  for (const p of gcAll) {
    if (!byComp.has(p.compId)) byComp.set(p.compId, { n: 0, pure: p.pureGC });
    byComp.get(p.compId).n++;
  }
  for (const [cid, o] of byComp) {
    const c = compInfo.get(cid) || {};
    const curTier = M2.tierOf(ctypes.get(cid), c.iso);
    console.log('  · ' + cid + '  ' + c.name + ' ' + c.year + '  举办国 ' + c.iso
      + '  type=' + [...ctypes.get(cid)].join('+')
      + '  → 判 ' + curTier + ' ｜ 领奖台 ' + o.n + ' 条'
      + (o.pure ? '  ← 只有 greater_china，判 CC 存疑' : '  ← 另有洲标识，判 CC 正确'));
  }
  console.log('');
  console.log('★ 真正有问题的只有 ' + num(new Set(gcRows.map((p) => p.compId)).size)
    + ' 场（' + num(gcRows.length) + ' 条）：China Championship 系列。');
  console.log('  AsianChampionship2016 虽然也挂了 greater_china，但它同时是 _Asia，判 CC 没问题。');
  console.log('');

  /* 现状：全部按现有 tier 算 */
  const sumOf = (rows) => rows.reduce((a, p) => a + M2.scorePodium(p, { ctx, pool, cfg }).score, 0);
  const curGC = sumOf(gcRows);
  const total = sumOf(podiums);
  console.log('这 ' + num(gcRows.length) + ' 条领奖台：按当前口径（CC）得 **' + F(curGC) + '** 分，'
    + '占全站 ' + F(total) + ' 的 ' + PCT(curGC / total));
  console.log('若按 NC（ρ 取中国 ' + F(nc.CN / TOTAL) + '）重算：'
    + F(sumOf(gcRows.map((p) => ({ ...p, tier: 'NC' })))) + ' 分，'
    + '缩水 ' + F(curGC / sumOf(gcRows.map((p) => ({ ...p, tier: 'NC' })))) + ' 倍');
  console.log('');

  /* 影响谁：Top60 里谁靠这 5 场 */
  const acc = new Map();
  for (const p of podiums) {
    const s = M2.scorePodium(p, { ctx, pool, cfg }).score;
    let a = acc.get(p.pid);
    if (!a) { a = { pid: p.pid, name: p.name, nat: p.nat, score: 0, gc: 0, n: 0 }; acc.set(p.pid, a); }
    a.score += s; a.n++;
    if (p.pureGC) a.gc += s;
  }
  const list = [...acc.values()].sort((a, b) => b.score - a.score);
  const hadGC = list.filter((x) => x.gc > 0);
  console.log('受影响的选手：' + num(hadGC.length) + ' 人（在 ' + num(list.length) + ' 个非零选手里）');
  console.log('');
  hadGC.sort((a, b) => b.gc - a.gc);
  console.log('| 选手 | 现名次 | 总分 | 大中华区贡献 | 占比 | 条数 |');
  console.log('|---|---|---|---|---|---|');
  for (const x of hadGC.slice(0, 12)) {
    const r = list.findIndex((y) => y.pid === x.pid) + 1;
    console.log('| ' + x.name + ' | #' + r + ' | ' + F(x.score) + ' | ' + F(x.gc)
      + ' | ' + PCT(x.gc / x.score) + ' | ' + x.n + ' |');
  }
  console.log('');

  /* 反事实：改判 NC 后的排名 */
  const acc2 = new Map();
  for (const p of podiums) {
    const pp = p.pureGC ? { ...p, tier: 'NC' } : p;
    const s = M2.scorePodium(pp, { ctx, pool, cfg }).score;
    let a = acc2.get(p.pid);
    if (!a) { a = { pid: p.pid, name: p.name, nat: p.nat, score: 0 }; acc2.set(p.pid, a); }
    a.score += s;
  }
  const list2 = [...acc2.values()].sort((a, b) => b.score - a.score);
  const rank2 = new Map(list2.map((x, i) => [x.pid, i + 1]));
  const tot2 = [...acc2.values()].reduce((a, x) => a + x.score, 0);
  console.log('反事实（这 ' + gcN + ' 场改判 NC）：总量 ' + F(total) + ' → ' + F(tot2)
    + '（' + PCT(tot2 / total - 1) + '）');
  console.log('');
  console.log('| 选手 | 现名次 | 改判后 | 变动 |');
  console.log('|---|---|---|---|');
  list.slice(0, 20).forEach((x, i) => {
    const r2 = rank2.get(x.pid);
    if (r2 !== i + 1) console.log('| ' + x.name + ' | #' + (i + 1) + ' | #' + r2 + ' | ' + (r2 - i - 1 > 0 ? '+' : '') + (r2 - i - 1) + ' |');
  });
  console.log('');
  console.log('（只列出前 20 名里真的移动了的）');
  console.log('');

  /* 第三方案：整类移出 M2 */
  const acc3 = new Map();
  for (const p of podiums) {
    if (p.pureGC) continue;
    const s = M2.scorePodium(p, { ctx, pool, cfg }).score;
    let a = acc3.get(p.pid);
    if (!a) { a = { pid: p.pid, score: 0 }; acc3.set(p.pid, a); }
    a.score += s;
  }
  const tot3 = [...acc3.values()].reduce((a, x) => a + x.score, 0);
  console.log('反事实 II（这 ' + gcN + ' 场整类移出 M2，归 M3）：总量 ' + F(tot3)
    + '（' + PCT(tot3 / total - 1) + '）');
  console.log('');

  console.log('══ 结论 ══');
  console.log('');
  console.log('1. WCA 的 championship_type 有**第四类**：greater_china（大中华区）。');
  console.log('   定稿文档写的是「只有三类真实取值」，这句是错的 —— 代码里 isContinentalType');
  console.log('   单独为 greater_china 开了口子，但文档没记。');
  console.log('2. 后果：ChinaChampionship（中国最高级别赛事）被当成**洲际赛**定价，');
  console.log('   单价按「亚洲」的 ρ（' + F(cc.Asia / TOTAL) + '）算，而真实池子是「大中华区」。');
  console.log('   池子被高估，价格被高估 ' + F(curGC / sumOf(gcRows.map((p) => ({ ...p, tier: 'NC' })))) + ' 倍（相对 NC）。');
  console.log('3. 三个方案：');
  console.log('   A 维持 CC（现状）：把「大中华区」等同于「洲」，与亚洲锦标赛同价');
  console.log('   B 改判 NC：ρ 用中国 ' + F(nc.CN / TOTAL) + '，与美/日/欧国锦赛可比，但忽略「大中华区含港澳台」');
  console.log('   C 移出 M2：与多区赛（XE/XA）同一处理，因为属地不唯一');
  console.log('   → 按 M2 自己的规则（6.5 节：属地不唯一的整类移出），C 最自洽。');
})().catch((e) => { console.error(e); process.exit(1); });

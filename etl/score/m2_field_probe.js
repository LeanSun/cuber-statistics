'use strict';
/* M2 全面体检：赛级分类 + 决赛人数 + 项目结构
 *
 * 三件事：
 *   1. 按 championships.tsv 的真实类型重建赛级（WC / CC / NC / OP）
 *   2. 统计每个决赛的参赛人数（field），看「3 人决赛 = 保底上台」有多普遍
 *   3. 给出按 field 修正后的 M2，用于讨论口径
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const ROOT = path.resolve(__dirname, '../..');
const ZIP = fs.readdirSync(path.join(ROOT, 'data/raw')).filter((f) => f.endsWith('.zip'))[0];
const zipPath = path.join(ROOT, 'data/raw', ZIP);

function readTsv(name) {
  return new Promise((resolve) => {
    const ps = spawn('unzip', ['-p', zipPath, name]);
    let buf = '';
    const out = [];
    ps.stdout.on('data', (d) => {
      buf += d.toString('utf8');
      let i;
      while ((i = buf.indexOf('\n')) >= 0) { out.push(buf.slice(0, i).split('\t')); buf = buf.slice(i + 1); }
    });
    ps.on('close', () => resolve(out));
  });
}
function streamTsv(name, onRow) {
  return new Promise((resolve) => {
    const ps = spawn('unzip', ['-p', zipPath, name]);
    let buf = '';
    let head = true;
    ps.stdout.on('data', (d) => {
      buf += d.toString('utf8');
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const ln = buf.slice(0, i); buf = buf.slice(i + 1);
        if (head) { head = false; continue; }
        if (ln) onRow(ln.split('\t'));
      }
    });
    ps.on('close', resolve);
  });
}
const placeW = (p) => (p === 1 ? 1 : (p === 2 ? 0.6 : 0.4));
const RN = require(path.join(ROOT, 'etl/score/runs.js'));
const EVW = RN.EV_WEIGHT_V2;

(async () => {
  const [champ, compInfo, countryRows] = await Promise.all([
    readTsv('WCA_export_championships.tsv'),
    readTsv('WCA_export_competitions.tsv'),
    readTsv('WCA_export_countries.tsv'),
  ]);
  const nameToIso = new Map();
  for (const r of countryRows) { if (r[0] === 'id') continue; nameToIso.set(r[0], r[1]); nameToIso.set(r[2], r[1]); }
  const compCountry = new Map();
  for (const r of compInfo) { if (r[0] === 'id') continue; compCountry.set(r[0], r[6]); }
  const ctypes = new Map();
  for (const r of champ) {
    if (r[0] === 'id') continue;
    if (!ctypes.has(r[1])) ctypes.set(r[1], new Set());
    ctypes.get(r[1]).add(r[2]);
  }
  const isCont = (t) => t.startsWith('_') || t === 'greater_china';
  const tierOf = (compId) => {
    const set = ctypes.get(compId);
    if (!set) return 'OP';
    if (set.has('world')) return 'WC';
    for (const t of set) if (isCont(t)) return 'CC';
    const iso = nameToIso.get(compCountry.get(compId));
    for (const t of set) if (t === iso) return 'NC';
    return 'OP';
  };

  const field = new Map();     // comp|ev -> 决赛人数
  const pods = [];             // 冠军赛领奖台
  await streamTsv('WCA_export_results.tsv', (r) => {
    const rt = r[5];
    if (rt !== 'f' && rt !== 'c') return;
    const compId = r[4], ev = r[6];
    const k = compId + '|' + ev;
    field.set(k, (field.get(k) || 0) + 1);
    const pos = +r[1];
    if (!(pos >= 1 && pos <= 3)) return;
    if (!ctypes.has(compId)) return;
    pods.push({ pid: r[8], name: r[7], compId, ev, pos, k, year: (r[4].match(/(\d{4})/) || [])[1] });
  });

  const byTier = {};
  for (const p of pods) {
    p.tier = tierOf(p.compId);
    p.field = field.get(p.k) || 0;
    const a = (byTier[p.tier] = byTier[p.tier] || { n: 0, small: 0, fieldSum: 0 });
    a.n++; a.fieldSum += p.field;
    if (p.field <= 5) a.small++;
  }
  console.log('=== 冠军赛领奖台：赛级 × 决赛人数 ===');
  for (const t of ['WC', 'CC', 'NC', 'OP']) {
    const a = byTier[t];
    if (!a) continue;
    console.log(`${t} 领奖台 ${String(a.n).padStart(6)}｜决赛≤5 人 ${String(a.small).padStart(6)}`
      + ` (${(a.small / a.n * 100).toFixed(2)}%)｜平均决赛人数 ${(a.fieldSum / a.n).toFixed(2)}`);
  }
  const small = pods.filter((p) => p.field <= 5);
  console.log(`\n全站冠军赛领奖台 ${pods.length}｜其中决赛≤5 人 ${small.length} (${(small.length / pods.length * 100).toFixed(2)}%)`);
  const f3 = pods.filter((p) => p.field <= 3);
  console.log(`决赛≤3 人（等于全员上台）${f3.length} (${(f3.length / pods.length * 100).toFixed(2)}%)，全部属于 `
    + `${[...new Set(f3.map((p) => p.tier))].join('/')} 级`);

  const per = new Map();
  for (const p of pods) {
    if (p.tier !== 'WC' && p.tier !== 'CC') continue;      // 只看 M2 范围
    let a = per.get(p.pid);
    if (!a) { a = { name: p.name, cur: 0, fix: 0, n: 0, wc: 0, cc: 0 }; per.set(p.pid, a); }
    const w = placeW(p.pos);
    const tw = p.tier === 'WC' ? 1.0 : 0.7;
    a.cur += w * tw;
    a.fix += w * tw * (EVW[p.ev] == null ? 1 : EVW[p.ev]);
    a.n++;
    if (p.tier === 'WC') a.wc++; else a.cc++;
  }
  const A = [...per.values()];
  const rankFix = new Map(A.slice().sort((x, y) => y.fix - x.fix).map((x, i) => [x, i + 1]));
  console.log('\n=== M2 前 12：只修赛级 vs 再乘项目权重 w_e ===');
  A.slice().sort((x, y) => y.cur - x.cur).slice(0, 12).forEach((x, i) => {
    console.log(`${String(i + 1).padStart(2)} ${x.name.padEnd(26)} 赛级修复 ${x.cur.toFixed(2).padStart(7)}`
      + ` ｜乘 w_e ${x.fix.toFixed(2).padStart(7)}（排名 ${String(rankFix.get(x)).padStart(3)}）`
      + `｜WC ${String(x.wc).padStart(3)} CC ${String(x.cc).padStart(3)}`);
  });
  console.log('\n=== 乘 w_e 后前 10 ===');
  A.slice().sort((x, y) => y.fix - x.fix).slice(0, 10).forEach((x, i) =>
    console.log(`${String(i + 1).padStart(2)} ${x.name.padEnd(26)} ${x.fix.toFixed(2).padStart(7)}`
      + `（赛级修复 ${x.cur.toFixed(2)}）`));
  const tCur = A.reduce((a, x) => a + x.cur, 0);
  const tFix = A.reduce((a, x) => a + x.fix, 0);
  console.log(`\nM2 总量：赛级修复 ${tCur.toFixed(2)} → 乘 w_e ${tFix.toFixed(2)}（降至 ${(tFix / tCur * 100).toFixed(2)}%）`);
  console.log(`有 M2 分的人数 ${A.length}`);
})();

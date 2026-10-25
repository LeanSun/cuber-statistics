'use strict';
/* =============================================================================
 * 年度榜去重回归测试（yTop100 / yTop10）
 * =============================================================================
 *
 * 用法：node etl/score/test_annual_top.js
 *
 * 背景（2026-10-25 修的真 bug）：
 *   build.js 的 annualOffer() 把每个 results 行都往年度榜插一次，
 *   而一个选手在同一年同一项目会有多行（多轮次 × 多场比赛），
 *   于是同一人占据多个名次槽位 → ①「年度前100 次数」按人头重复计数；
 *   ② 按数组下标算名次时，后面的人被挤出 100 名 → 榜单错排。
 *   实测：Feliks yTop100 由真实的 165 被算成 975（5.91×），
 *   站点 6,147 人里 87.9% 的该字段是错的，Top20 榜单错排 9 个位置。
 *
 * 本测试锁定三件事：
 *   [1] 同一 (年,项目,选手) 在年度榜里只占一个槽位
 *   [2] 数组下标 = 真实名次（没有重复占位）
 *   [3] 端到端：build.js 产出的 yTop100 与独立重建口径一致
 *
 * 依赖：data/raw/WCA_export_v2_*.tsv.zip（用 WCA_ZIP 环境变量可覆盖）
 * ========================================================================== */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..', '..');
const TMP = path.join(ROOT, '.workbuddy', 'tmp', 'oc');
const ZIP = process.env.WCA_ZIP
  || path.join(ROOT, 'data', 'raw', 'WCA_export_v2_288_20261015T000017Z.tsv.zip');

let pass = 0, fail = 0;
const eq = (name, got, want, tol) => {
  const gn = Number(got), wn = Number(want);
  const numeric = Number.isFinite(gn) && Number.isFinite(wn);
  const okv = numeric ? Math.abs(gn - wn) <= (tol == null ? 1e-9 : tol) : String(got) === String(want);
  if (okv) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}  got ${got}  want ${want}`); }
};
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail ? '  ' + detail : ''}`); }
};

if (!fs.existsSync(ZIP)) {
  console.error(`找不到 WCA 导出 zip: ${ZIP}`);
  process.exit(2);
}

/* ---------- 载入 competitions（competition_id -> year） ---------- */
const compYear = new Map();
{
  const f = path.join(TMP, 'WCA_export_competitions.tsv');
  if (!fs.existsSync(f)) { console.error(`缺少 ${f}，先跑一次 unzip 提取`); process.exit(2); }
  const lines = fs.readFileSync(f, 'utf8').split('\n');
  const cols = lines[0].split('\t'); const ix = {}; cols.forEach((c, i) => ix[c] = i);
  for (let i = 1; i < lines.length; i++) {
    const L = lines[i]; if (!L) continue;
    const p = L.split('\t');
    compYear.set(p[ix.id], +p[ix.year]);
  }
}

/* ---------- 独立重建：pid|eid|yr -> 最好一次成绩 ---------- */
const dedup = new Map();
function streamResults(onRow) {
  return new Promise((resolve, reject) => {
    const child = spawn('unzip', ['-p', ZIP, 'WCA_export_results.tsv'], { stdio: ['ignore', 'pipe', 'ignore'] });
    let buf = '';
    child.stdout.on('data', (chunk) => {
      buf += chunk; let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, ''); buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        onRow(line.split('\t'));
      }
    });
    child.stdout.on('end', resolve); child.on('error', reject);
  });
}

(async function main() {
  console.log('\n[准备] 扫 results.tsv 构建「选手-项目-年 → 最好成绩」…');
  let nRows = 0;
  await streamResults((p) => {
    nRows++;
    const pid = p[8], eid = p[6], cid = p[4];
    if (!pid || !eid || !cid) return;
    const yr = compYear.get(cid); if (!yr) return;
    const bs = +p[2], ba = +p[3];
    const best = bs > 0 && ba > 0 ? Math.min(bs, ba) : (bs || ba);
    if (!(best > 0)) return;
    const k = pid + '|' + eid + '|' + yr;
    const c = dedup.get(k); if (c === undefined || best < c) dedup.set(k, best);
  });
  console.log(`  rows=${nRows.toLocaleString()}  去重键=${dedup.size.toLocaleString()}`);

  /* 重建年度榜：'year|eid' -> 按 best 升序的前 200 名 */
  const boards = new Map();
  for (const [k, best] of dedup) {
    const i1 = k.lastIndexOf('|'), i2 = k.lastIndexOf('|', i1 - 1);
    const bk = k.slice(i2 + 1, i1) + '|' + k.slice(i1 + 1);
    let arr = boards.get(bk); if (!arr) { arr = []; boards.set(bk, arr); }
    arr.push({ pid: k.slice(0, i2), best });
  }
  for (const arr of boards.values()) arr.sort((a, b) => a.best - b.best);

  const yFix = {}, yFix10 = {};
  for (const [, arr] of boards) {
    arr.slice(0, 200).forEach((e, i) => {
      const r = i + 1;
      if (r > 100) return;
      yFix[e.pid] = (yFix[e.pid] || 0) + 1;
      if (r <= 10) yFix10[e.pid] = (yFix10[e.pid] || 0) + 1;
    });
  }

  /* ---------- [1] 同一格内不得有重复 pid ---------- */
  console.log('\n[1] 年度榜去重：同一 (年,项目) 内不得有重复选手');
  let dupGrids = 0, worstDup = 0, worstCell = '';
  for (const [bk, arr] of boards) {
    const seen = new Set(); let d = 0;
    for (const e of arr.slice(0, 200)) { if (seen.has(e.pid)) d++; seen.add(e.pid); }
    if (d > 0) { dupGrids++; if (d > worstDup) { worstDup = d; worstCell = bk; } }
  }
  eq('重复占位的格子数', dupGrids, 0);
  ok('最大重复槽位数 = 0', worstDup === 0, worstCell);

  /* ---------- [2] 数组下标 = 真实名次（成绩严格非降） ---------- */
  console.log('\n[2] 数组下标必须等于真实名次（成绩单调非降）');
  let disorder = 0, badCell = '';
  for (const [bk, arr] of boards) {
    const top = arr.slice(0, 200);
    for (let i = 1; i < top.length; i++) {
      if (top[i].best < top[i - 1].best) { disorder++; badCell = bk; break; }
    }
  }
  eq('成绩非单调的格子数', disorder, 0, badCell);

  /* ---------- [3] 端到端：build.js 产物 vs 独立重建 ---------- */
  console.log('\n[3] 端到端：js/data.js 的 yTop100 / yTop10 vs 独立重建口径');
  const dataFile = path.join(ROOT, 'js', 'data.js');
  if (!fs.existsSync(dataFile)) {
    console.log('  (跳过) js/data.js 不存在');
  } else {
    const s = fs.readFileSync(dataFile, 'utf8');
    const m = s.match(/var PLAYERS = (\[[\s\S]*?\]);\s*\n/);
    if (!m) { console.log('  (跳过) data.js 里找不到 PLAYERS'); }
    else {
      const arr = JSON.parse(m[1]);
      let n = 0, bad = 0, badEx = [];
      for (const p of arr) {
        const got = p.yTop100 || 0, want = yFix[p.id] || 0;
        const got10 = p.yTop10 || 0, want10 = yFix10[p.id] || 0;
        n++;
        if (got !== want || got10 !== want10) {
          bad++;
          if (badEx.length < 5) badEx.push(`${p.name}: yTop100 ${got}≠${want} / yTop10 ${got10}≠${want10}`);
        }
      }
      eq(`全部 ${n} 人的 yTop10/yTop100 与独立重建一致`, bad, 0);
      badEx.forEach(e => console.log('      ' + e));

      /* 已知回归值（2026-10-15 快照）：修复后 Feliks 必须是 165，不是 975 */
      const fel = arr.find(p => p.id === '2009ZEMD01');
      if (fel) {
        eq('Feliks yTop100 = 165（修复前误为 975）', fel.yTop100, 165);
        eq('Feliks yTop10  = 95 （修复前误为 229）', fel.yTop10, 95);
      }
    }
  }

  console.log(`\n${fail === 0 ? '全部通过' : '存在失败'}（${pass} 通过 / ${fail} 失败）`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });

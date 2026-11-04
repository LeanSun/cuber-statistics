#!/usr/bin/env node
'use strict';
/* =============================================================================
 * m2_tracks.js · 生成「单次 / 平均」口径的 M2 领奖台事实表
 * -----------------------------------------------------------------------------
 * 为什么需要它：
 *   六维引擎 sixdim.js 的 --track single|avg 对 M1/M3/M4/M5/M6 都有对应事实，
 *   唯独 M2_facts.tsv 没有单/平均标记 —— 于是「六维筛选 = M2 领奖台」时，
 *   顶部「总计 / 单次 / 平均」点了完全不动（三档 s2 逐人逐位相等，实测 62,351 人零差异）。
 *
 * 口径定义（与 M5 的 k_single / k_avg 同一思路：口径换的是「用哪份成绩」，
 *   不是把同一批事实按比例分摊）：
 *     · both   → 原 M2_facts.tsv，官方名次 1/2/3（由该轮赛制决定的那一列排出来）
 *     · single → 每个决赛轮按 WCA_results.best（单次最好成绩）重排前三
 *     · avg    → 每个决赛轮按 WCA_results.average 重排前三（无平均成绩则该轮不计）
 *   三轮共用同一个决赛轮集合、同一套 base（名次单价 × 赛级 × 场地规模 × 时代 × 项目权重），
 *   只换「谁站上第 1/2/3 名」，因此：
 *     ① 三档都是同一套 M2 公式，没有引入新分数；
 *     ② 主流项目（三阶等平均制决赛）在两种口径下都还在，不会整片消失；
 *     ③ both 轨逐字节不变 —— 主榜、总分、国家拆分、长尾分完全零风险。
 *
 * 实现要点：
 *   · 决赛轮 = round_type_id ∈ {f, c} 且 best > 0（与 m2m3_balance.js 完全同源）；
 *     实测每个 (competition_id, event_id) 恰好一个决赛轮，143,086 个。
 *   · WCA 把多盲成绩也编码成「越小越强」（333mbf 的 980259002 < 990093701 正是冠军），
 *     最少步是步数、越小越好 —— 所以两轨一律按数值升序排即可，不用按项目特判。
 *   · average 无成绩时 WCA 写 -1（DNF）/ -2（DNS）/ 0（该赛制不产生平均），只收 > 0。
 *   · 并列：数值相同则按官方名次、再按 pid 定序，保证任何机器上结果稳定。
 *   · decay（同人同项目普通赛第 n 次领奖台 × n^-α，α=1.0 封存值）必须按
 *     **新口径自己的领奖台序列**重算，不能照抄官方那一行的序号。
 *   · base 里唯一与「人」有关的项是洲锦/国锦客场折半 K_MUL=0.5；重排后新人的
 *     客场身份理论上可能不同。这类条目只占锦标赛领奖台的一小部分，此处沿用
 *     官方行的 base（轮次级信息），并在文件头注释里如实标注。
 *
 * 输入：data/raw/WCA_export_v2_*.tsv.zip 里的 WCA_export_results.tsv
 *       etl/score/M2_facts.tsv（m2m3_balance.js 产出，both 轨，不会被改动）
 * 输出：etl/score/M2_facts_single.tsv / M2_facts_avg.tsv（与 both 同 9 列结构）
 *
 * 用法：node --max-old-space-size=8192 etl/score/m2_tracks.js
 * 说明：这两个文件是 ETL 中间产物（*.tsv 已被 .gitignore 忽略），CI 不需要它们 ——
 *       CI 只跑 build.js，读的是入库的 sixdim_site*.tsv / sixyear.tsv。
 * ============================================================================= */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const D = __dirname;
const ROOT = path.resolve(D, '../..');
const RAW = path.join(ROOT, 'data', 'raw');
const zip = fs.readdirSync(RAW).filter((f) => f.endsWith('.zip'))[0];
if (!zip) { console.error('[m2_tracks] 缺少 data/raw/*.zip'); process.exit(1); }
const ZIP_PATH = path.join(RAW, zip);

/* ── 1. 官方领奖台：轮次级信息 + 每个名次的 base ───────────────────────── */
const factsPath = path.join(D, 'M2_facts.tsv');
if (!fs.existsSync(factsPath)) { console.error('[m2_tracks] 缺少 M2_facts.tsv，请先跑 m2m3_balance.js'); process.exit(1); }
const official = new Map();       // compId|ev → {year,tier,ev,compId,base:{1,2,3}}
const names = new Map();          // pid → 显示名（只用于事实表第 2 列，sixdim 不读）
const lines = fs.readFileSync(factsPath, 'utf8').trim().split('\n');
for (let i = 1; i < lines.length; i++) {
  const c = lines[i].split('\t');
  if (c.length < 9) continue;
  const key = c[6] + '|' + c[2];
  let o = official.get(key);
  if (!o) {
    o = { year: +c[5], tier: c[3], ev: c[2], compId: c[6], base: {} };
    official.set(key, o);
  }
  const pos = +c[4];
  if (pos >= 1 && pos <= 3 && o.base[pos] === undefined) o.base[pos] = +c[7];
  if (!names.has(c[0])) names.set(c[0], c[1]);
}
console.log('[m2_tracks] 官方领奖台轮次', official.size, '｜选手名', names.size);

/* ── 2. 扫决赛轮，每轮只保留 best / average 各自的前三（不落全量，省内存）── */
const rounds = new Map();         // compId|ev → {best3, avg3}
const cmpBest = (a, b) => (a.best - b.best) || (a.pos - b.pos) || (a.pid < b.pid ? -1 : a.pid > b.pid ? 1 : 0);
const cmpAvg = (a, b) => (a.avg - b.avg) || (a.pos - b.pos) || (a.pid < b.pid ? -1 : a.pid > b.pid ? 1 : 0);
function insert3(arr, item, cmp) {
  let at = arr.length;
  for (let i = 0; i < arr.length; i++) if (cmp(item, arr[i]) < 0) { at = i; break; }
  arr.splice(at, 0, item);
  if (arr.length > 3) arr.pop();
}

const ps = spawn('unzip', ['-p', ZIP_PATH, 'WCA_export_results.tsv']);
ps.on('error', (e) => { console.error('[m2_tracks] unzip 启动失败', e.message); process.exit(1); });
let buf = '', head = true, readRows = 0;
ps.stdout.on('data', (d) => {
  buf += d.toString('utf8');
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const ln = buf.slice(0, i); buf = buf.slice(i + 1);
    if (head) { head = false; continue; }
    if (!ln) continue;
    const c = ln.split('\t');
    if (c[5] !== 'f' && c[5] !== 'c') continue;          // 只认决赛 / 合并决赛
    const best = +c[2];
    if (!(best > 0)) continue;                            // 与官方事实表同口径：排除 DNF/DNS
    const avg = +c[3];
    const key = c[4] + '|' + c[6];
    let r = rounds.get(key);
    if (!r) { r = { best3: [], avg3: [] }; rounds.set(key, r); }
    const item = { pid: c[8], best: best, avg: avg, pos: +c[1] };
    insert3(r.best3, item, cmpBest);
    if (avg > 0) insert3(r.avg3, item, cmpAvg);
    readRows++;
  }
});

ps.on('close', (code) => {
  if (code !== 0) { console.error('[m2_tracks] unzip 退出码', code); process.exit(1); }
  console.log('[m2_tracks] 决赛成绩行', readRows, '｜决赛轮', rounds.size);

  /* ── 3. 生成两轨事实行 ─────────────────────────────────────────────── */
  const out = { single: [], avg: [] };
  let missed = 0;
  for (const [key, o] of official) {
    const r = rounds.get(key);
    if (!r) { missed++; continue; }
    for (const track of ['single', 'avg']) {
      const arr = track === 'single' ? r.best3 : r.avg3;
      for (let k = 0; k < arr.length; k++) {
        const pos = k + 1;
        const b = o.base[pos];
        if (!(b > 0)) continue;                            // 官方只有 2 个有效名次时第 3 名无单价
        const pid = arr[k].pid;
        out[track].push({
          pid: pid, name: names.get(pid) || pid, ev: o.ev, tier: o.tier,
          pos: pos, year: o.year, compId: o.compId, base: b, decay: 1
        });
      }
    }
  }
  console.log('[m2_tracks] 官方轮次无决赛成绩:', missed, '（多为早期缺 best 的轮次）');

  /* ── 4. 按新口径自己的领奖台序列重算 decay（α = 1.0，与封存口径一致）── */
  const HEADER = 'pid\tname\tev\ttier\tpos\tyear\tcompId\tbase\tdecay\n';
  for (const track of ['single', 'avg']) {
    const grp = new Map();
    for (const it of out[track]) {
      if (it.tier !== 'OP') continue;
      const k = it.pid + '|' + it.ev;
      let a = grp.get(k); if (!a) { a = []; grp.set(k, a); }
      a.push(it);
    }
    for (const a of grp.values()) {
      a.sort((x, y) => (x.year - y.year) || String(x.compId).localeCompare(String(y.compId)) || (x.pos - y.pos));
      a.forEach((it, i) => { it.decay = 1 / (i + 1); });
    }
    const dst = path.join(D, 'M2_facts_' + track + '.tsv');
    const body = out[track].map((it) => [
      it.pid, String(it.name).replace(/\t/g, ' '), it.ev, it.tier, it.pos, it.year, it.compId,
      it.base.toFixed(6), it.decay.toFixed(6)
    ].join('\t')).join('\n');
    fs.writeFileSync(dst, HEADER + body + '\n', 'utf8');
    console.log('[m2_tracks] 已写', path.basename(dst), out[track].length, '行',
      (fs.statSync(dst).size / 1048576).toFixed(1) + 'MB');
  }
});

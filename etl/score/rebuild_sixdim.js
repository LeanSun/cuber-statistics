#!/usr/bin/env node
'use strict';
/* =============================================================================
 * rebuild_sixdim.js · 六维交付物一键重建
 * -----------------------------------------------------------------------------
 * 为什么需要它：
 *   「单项目 + 单次/平均」的逐项目六维分由两步产出，第二步极易漏掉——
 *     ① sixdim.js ×3（单次 / 平均 / 合计）→ sixdim_site*.tsv、sixdim_by_event*.tsv
 *     ② make_sixev_lazy.js              → sixev_single.tsvz / sixev_avg.tsvz（前端懒加载）
 *   只做①不做②：线上仍是旧包，页面继续用旧排序，且**不报错**（静默故障）。
 *   本脚本把两步绑成一条命令，并在结束时自检产物，从机制上消灭这个漏项。
 *
 *   ⑤ 六维年度曲线（sixyear.js，含 M2 单轨曲线 m2s/m2a）
 *   另加一道自检：三张交付表的 s2（M2 领奖台）不得完全相同 —— 历史上 M2 不受
 *   --track 影响，三档逐行相等，用户选「M2 + 单次/平均」时按钮形同虚设。
 *   步骤 ⓪ 只是把既有领奖台按单/平均成绩重排（复用官方 base，不重算维度），
 *   需要 data/raw/*.zip；没有导出时跳过，沿用已生成的中间表。
 *
 * 前置：各维度的事实表已是最新（M1_facts / M2_facts / M3_facts / M4_facts / M5_facts / M6_by_record）。
 *       本脚本只重建「六维合成 → 站点交付表 → 前端包」，不重算任何维度。
 *       ⚠ 换籍时间线 nat_seg.tsv 也属于前置：WCA 导出换了一版就要先跑
 *         `node etl/score/nat_seg.js`（约 10 秒，扫一遍 results.tsv），否则国家总分
 *         会把新出现的换籍选手按今天的国籍全额计入（本脚本不会替你重扫）。
 *
 * 用法：
 *   node --max-old-space-size=8192 etl/score/rebuild_sixdim.js
 *   node --max-old-space-size=8192 etl/score/rebuild_sixdim.js --skip-pack   # 只算分（调试）
 *
 * 顺序说明：合计轨必须放最后。three 轨都写 sixdim_site*.tsv，合计轨负责把
 *   9 列主表（pid s1..s6 t）覆盖回 sixdim_site.tsv；顺序乱了 build.js 的 loadSix() 会解析失败。
 * ============================================================================= */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const D = __dirname;
const SKIP_PACK = process.argv.includes('--skip-pack');
const MEM = '--max-old-space-size=8192';

const sixdim = (track, csv, label) => ({
  label,
  file: path.join(D, 'sixdim.js'),
  args: track ? [MEM, path.join(D, 'sixdim.js'), '--track', track, '--csv', csv]
              : [MEM, path.join(D, 'sixdim.js'), '--csv', csv],
});

const STEPS = [];
/* ⓪ M2 的单次 / 平均领奖台事实表（2026-11-04 起，与 M5 的 k_single/k_avg 同一思路）。
   sixdim.js 的 --track 会按轨选表，缺表会静默退回合并档 —— 那正是「M2 切口径没反应」
   的老毛病，所以只要有 WCA 导出就先重建一遍。CI 不跑本脚本（只跑 build.js），
   没有导出时沿用仓库里已生成好的交付表即可。 */
const RAW = path.join(D, '../..', 'data', 'raw');
const hasZip = fs.existsSync(RAW) && fs.readdirSync(RAW).some((f) => f.endsWith('.zip'));
if (hasZip) {
  STEPS.push({
    label: '⓪ M2 单次/平均领奖台事实表（m2_tracks.js）',
    file: path.join(D, 'm2_tracks.js'),
    args: [MEM, path.join(D, 'm2_tracks.js')],
  });
} else {
  console.log('· 未发现 data/raw/*.zip，跳过 m2_tracks.js（沿用已有 M2_facts_single/avg.tsv）');
}
STEPS.push(
  sixdim('single', 'sixdim_site_single', '① 六维 · 单次轨'),
  sixdim('avg', 'sixdim_site_avg', '② 六维 · 平均轨'),
  sixdim(null, 'sixdim_site', '③ 六维 · 合计轨（最后跑，恢复 9 列主表）')
);
if (!SKIP_PACK) {
  STEPS.push({
    label: '④ 打包前端精确档（这一步最容易忘）',
    file: path.join(D, 'make_sixev_lazy.js'),
    args: [MEM, path.join(D, 'make_sixev_lazy.js')],
  });
  /* ⑤ 六维年度曲线：每维自己的时间演进（图表可视化页「维度」筛选用）。
     必须放在 three 轨之后 —— 它按 sixdim_site.tsv 的白名单出表。 */
  STEPS.push({
    label: '⑤ 六维年度曲线（sixyear.tsv，单维竞速图用）',
    file: path.join(D, 'sixyear.js'),
    args: [MEM, path.join(D, 'sixyear.js')],
  });
}

const t0 = Date.now();
for (const s of STEPS) {
  process.stdout.write(`\n▶ ${s.label}\n`);
  const r = spawnSync(process.execPath, s.args, { cwd: path.join(D, '../..'), stdio: 'inherit' });
  if (r.status !== 0) {
    console.error(`\n✗ 失败于「${s.label}」（exit ${r.status}）。后续步骤未执行。`);
    process.exit(r.status || 1);
  }
}

/* ── 自检：产物必须存在且格式正确 ── */
const problems = [];
const header = (f) => {
  const p = path.join(D, f);
  if (!fs.existsSync(p)) { problems.push(`${f} 不存在`); return []; }
  return fs.readFileSync(p, 'utf8').split('\n')[0].split('\t');
};
/* 交付表真实列数为 8：pid + s1..s6 + t（build.js loadSix 按 c[7] 取总分）。
   曾按「9 列」写断言导致误报，此处固定 8 列校验表头首尾字段，避免只数个数。 */
const COL8 = ['pid', 's1', 's2', 's3', 's4', 's5', 's6', 't'];
for (const f of ['sixdim_site.tsv', 'sixdim_site_single.tsv', 'sixdim_site_avg.tsv']) {
  const h = header(f);
  if (!h.length) continue;
  const bad = h.length !== 8 || h[0] !== COL8[0] || h[7] !== COL8[7];
  if (bad) problems.push(`${f} 表头为 [${h.join(',')}]，应为 pid,s1..s6,t 共 8 列`);
}
if (!SKIP_PACK) {
  for (const f of ['sixev_single.tsvz', 'sixev_avg.tsvz']) {
    const p = path.join(D, f);
    if (!fs.existsSync(p)) { problems.push(`${f} 不存在（打包步骤没生效）`); continue; }
    const mb = fs.statSync(p).size / 1048576;
    if (mb < 1) problems.push(`${f} 只有 ${mb.toFixed(2)}MB，可能是空包`);
  }
  const sy = path.join(D, 'sixyear.tsv');
  if (!fs.existsSync(sy)) problems.push('sixyear.tsv 不存在（六维年度曲线没生成，单维竞速图会退回旧曲线）');
  else if (fs.statSync(sy).size / 1048576 < 1) problems.push('sixyear.tsv 过小，可能是空表');
  const syHead = header('sixyear.tsv');
  if (syHead.length && (syHead[7] !== 'm2s' || syHead[8] !== 'm2a')) {
    problems.push(`sixyear.tsv 表头缺 m2s/m2a 两列（实为 [${syHead.join(',')}]）`);
  }
}

/* M2 口径自检：三张交付表的 s2 列必须真的不一样。
   ⚠ 必须按 pid 对齐，不能按行号 —— 三档都按各自总分排序，同名次不是同一人，
   按行比会「因为人不同」而假绿。 */
const s2map = (f) => {
  const p = path.join(D, f), m = new Map();
  if (!fs.existsSync(p)) return m;
  for (const l of fs.readFileSync(p, 'utf8').split('\n').slice(1)) {
    const c = l.split('\t');
    if (c.length > 2) m.set(c[0], c[2]);
  }
  return m;
};
const s2b = s2map('sixdim_site.tsv'), s2s = s2map('sixdim_site_single.tsv'), s2a = s2map('sixdim_site_avg.tsv');
if (s2b.size && s2s.size && s2a.size) {
  let n = 0, diffS = 0, diffA = 0;
  for (const [pid, v] of s2b) {
    if (!s2s.has(pid) || !s2a.has(pid)) continue;
    n++;
    if (s2s.get(pid) !== v) diffS++;
    if (s2a.get(pid) !== v) diffA++;
  }
  if (!diffS || !diffA) problems.push(`M2 单次/平均轨未生效（同 pid ${n} 人中 single 差异 ${diffS}、avg 差异 ${diffA}）`);
  else console.log(`· M2 三轨自检：同 pid ${n} 人中 single 差异 ${diffS}、avg 差异 ${diffA}`);
}

const sec = ((Date.now() - t0) / 1000).toFixed(0);
if (problems.length) {
  console.error(`\n✗ 自检未通过（用时 ${sec}s）：`);
  problems.forEach((p) => console.error('  · ' + p));
  process.exit(1);
}
console.log(`\n✓ 全部完成，用时 ${sec}s。产物自检通过。`);
console.log('  下一步：git status 看产物是否变化 → 有变化才需要提交推送（js/data.js 由 CI 重建）。');

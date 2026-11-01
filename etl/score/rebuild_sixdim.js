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
 * 前置：各维度的事实表已是最新（M1_facts / M2_facts / M3_facts / M4_facts / M5_facts / M6_by_record）。
 *       本脚本只重建「六维合成 → 站点交付表 → 前端包」，不重算任何维度。
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

const STEPS = [
  sixdim('single', 'sixdim_site_single', '① 六维 · 单次轨'),
  sixdim('avg', 'sixdim_site_avg', '② 六维 · 平均轨'),
  sixdim(null, 'sixdim_site', '③ 六维 · 合计轨（最后跑，恢复 9 列主表）'),
];
if (!SKIP_PACK) {
  STEPS.push({
    label: '④ 打包前端精确档（这一步最容易忘）',
    file: path.join(D, 'make_sixev_lazy.js'),
    args: [MEM, path.join(D, 'make_sixev_lazy.js')],
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
}

const sec = ((Date.now() - t0) / 1000).toFixed(0);
if (problems.length) {
  console.error(`\n✗ 自检未通过（用时 ${sec}s）：`);
  problems.forEach((p) => console.error('  · ' + p));
  process.exit(1);
}
console.log(`\n✓ 全部完成，用时 ${sec}s。产物自检通过。`);
console.log('  下一步：git status 看产物是否变化 → 有变化才需要提交推送（js/data.js 由 CI 重建）。');

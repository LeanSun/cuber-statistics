'use strict';
/* 量化 records 12 条上限的代价
 * 用法：node etl/score/diag_records_cap.js
 */
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
global.window = {};
require(path.join(ROOT, 'js/data.js'));
require(path.join(ROOT, 'js/roster.js'));
const CL = require(path.join(ROOT, 'js/calc.js'));
const RN = require(path.join(ROOT, 'etl/score/runs.js'));

const P = global.window.MOCK.players;
const withRec = P.filter((p) => (p.records || []).length);
const totalRec = P.reduce((a, p) => a + (p.recTotal || 0), 0);
const kept = P.reduce((a, p) => a + (p.records || []).length, 0);

console.log('有明细的选手:', withRec.length, '/', P.length);
console.log('生涯纪录总条数 recTotal 合计:', totalRec.toLocaleString());
console.log('实际保留明细:', kept.toLocaleString(), '→ 覆盖率', ((kept / totalRec) * 100).toFixed(2) + '%');

// 按级别：假设全量时各级别条数
const lvTotal = { WR: 0, CR: 0, NR: 0 };
P.forEach((p) => { lvTotal.WR += p.wr || 0; lvTotal.CR += p.cr || 0; lvTotal.NR += p.nr || 0; });
console.log('全站纪录按级别（来自 p.wr/cr/nr）:', JSON.stringify(lvTotal));
const lvKept = { WR: 0, CR: 0, NR: 0 };
P.forEach((p) => (p.records || []).forEach((x) => { lvKept[x.level] = (lvKept[x.level] || 0) + 1; }));
console.log('保留明细按级别:', JSON.stringify(lvKept));

// 分层方案体积估算：WR 全留 + CR 每人 12 + NR 每人 12
const proj = { WR: lvTotal.WR, CR: lvKept.CR, NR: lvKept.NR };
const projTotal = proj.WR + proj.CR + proj.NR;
console.log('\n分层方案(WR全留, CR/NR 各 12):', JSON.stringify(proj), '合计', projTotal.toLocaleString());

// 单条 record 的平均字节
const sample = JSON.stringify(withRec[0].records);
console.log('单条 record JSON 约', Math.round(sample.length / withRec[0].records.length), '字节（含 factors）');
const perRec = sample.length / withRec[0].records.length;
console.log('当前 records 总字节约', ((kept * perRec) / 1048576).toFixed(1), 'MB');
console.log('分层方案 records 总字节约', ((projTotal * perRec) / 1048576).toFixed(1), 'MB');
console.log('全量方案 records 总字节约', ((totalRec * perRec) / 1048576).toFixed(1), 'MB');

// 阶梯断裂统计
let EXPORT = 0;
P.forEach((p) => (p.records || []).forEach((x) => { const e = RN.dayOf(x.date) + (x.held || 0); if (e > EXPORT) EXPORT = e; }));
const LAD = {};
P.forEach((p) => {
  const c = CL.contOfIso(p.country) || '??';
  (p.records || []).forEach((x) => {
    if (!x.date) return;
    const sc = x.level === 'WR' ? 'WW' : (x.level === 'CR' ? c : p.country);
    const k = x.ev + '|' + x.type + '|' + x.level + '|' + sc;
    (LAD[k] = LAD[k] || { ev: x.ev, type: x.type, level: x.level, subs: [] }).subs.push({ pid: p.id, name: p.name, day: RN.dayOf(x.date), value: x.value, held: x.held || 0 });
  });
});
let nRun = 0, nGap = 0, nUnclean = 0, nOpen = 0;
const byLevel = {};
Object.keys(LAD).forEach((k) => {
  const Ld = LAD[k];
  const b = RN.buildLadder(Ld.subs, Ld, { mode: 'level', endFromHeld: true, exportDay: EXPORT });
  b.runs.forEach((r) => {
    nRun++;
    const s = (byLevel[Ld.level] = byLevel[Ld.level] || { run: 0, gap: 0, open: 0 });
    s.run++;
    if (r.prevGap > 0) { nGap++; s.gap++; }
    if (r.clean === false) nUnclean++;
    if (r.tEnd == null) { nOpen++; s.open++; }
  });
});
console.log('\n阶梯数:', Object.keys(LAD).length, '段数:', nRun);
console.log('prevGap>0（前面缺条，G 被高估）:', nGap, '→', ((nGap / nRun) * 100).toFixed(1) + '%');
console.log('clean=false（段内夹了别人，段长被低估）:', nUnclean, '→', ((nUnclean / nRun) * 100).toFixed(1) + '%');
console.log('开放段（至今无人打破，段长截到快照日）:', nOpen, '→', ((nOpen / nRun) * 100).toFixed(1) + '%');
console.log('按级别:', JSON.stringify(byLevel));

// 每个选手被截掉的条数分布
const cut = withRec.map((p) => ({ n: p.name, tot: p.recTotal, keep: p.records.length, lost: p.recTotal - p.records.length })).sort((a, b) => b.lost - a.lost);
console.log('\n截断最狠的前 8 人:');
cut.slice(0, 8).forEach((x) => console.log(`  ${x.n}: ${x.tot} → ${x.keep}（丢 ${x.lost}）`));
console.log('平均每人丢:', (cut.reduce((a, x) => a + x.lost, 0) / cut.length).toFixed(1), '条');

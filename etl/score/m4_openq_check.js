'use strict';
/* M4 三个未决项的离线对照实验（只读已导出的 TSV，不改主脚本） */
const fs = require('fs');
const path = require('path');
const D = __dirname;

const rd = (f) => fs.readFileSync(path.join(D, f), 'utf8')
  .trim().split('\n').slice(1).map((l) => l.split('\t'));

/* ── M4 主榜 ─────────────────────────────────────────────────── */
const seats = rd('M4_seats.tsv');
const meta = new Map();
for (const c of seats) {
  meta.set(c[0], {
    name: c[1], m4: +c[2], d10: +c[7], d1: +c[8], d100: +c[9], no1: +c[15],
  });
}
/* ── 剔除坐第一的对照榜 ─────────────────────────────────────── */
const no1tab = rd('M4_no_rank1.tsv');
const no1 = new Map(no1tab.map((c) => [c[0], { v: +c[3], rank: +c[4] }]));

/* ── M1 纪录分（Top30 表）────────────────────────────────────── */
const m1md = fs.readFileSync(path.join(D, '纪录分_全站.md'), 'utf8').split('\n');
const m1 = new Map();
for (const line of m1md) {
  const c = line.split('|').map((s) => s.trim());
  /* split 后：c[0]空 c[1]名次 c[2]姓名 c[3]国家 c[4]WR c[5]CR c[6]NR
                c[7]段数 c[8]平均f c[9]纪录分 c[10]不折算 */
  if (c.length < 11 || !/^\d+$/.test(c[1])) continue;
  const score = parseFloat(c[9].replace(/\*/g, ''));
  if (!isFinite(score)) continue;
  m1.set(c[2], score);
}
const norm = (s) => s.replace(/[^A-Za-z一-鿿]/g, '').toLowerCase();
const m1ByName = new Map();
for (const [k, v] of m1) m1ByName.set(norm(k), v);

function pearson(xs, ys) {
  const n = xs.length;
  if (n < 3) return NaN;
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  return sxy / Math.sqrt(sxx * syy);
}

console.log('══════ ① 「坐第一」要不要单独剔除 ══════\n');
console.log('  背景：M4 算「在前十坐了多久」，M1 算「持有世界纪录的分量」。');
console.log('  重叠点：一个项目的**世界第一**，同时就是这个项目世界纪录的持有者。');
console.log('  所以「坐在第一」这部分事实，M1 和 M4 会各算一次。\n');

const arr = [...meta.entries()].filter(([, m]) => m.m4 > 0);
arr.sort((a, b) => b[1].m4 - a[1].m4);
const rankNow = new Map(arr.map(([pid], i) => [pid, i + 1]));
console.log('  # | 选手 | M4(现状) | 坐第一占位年 | 剔第一后 | 剔后名次 | 变动');
for (let i = 0; i < 25; i++) {
  const [pid, m] = arr[i];
  const t = no1.get(pid);
  const d = rankNow.get(pid) - (t ? t.rank : rankNow.get(pid));
  console.log('  ' + String(i + 1).padStart(2) + ' | ' + m.name.padEnd(24) +
    m.m4.toFixed(4).padStart(9) + ' | ' + m.d1.toFixed(4).padStart(13) +
    ' | ' + m.no1.toFixed(4).padStart(9) + ' | #' + String(t ? t.rank : '—').padEnd(8) +
    (d === 0 ? '不变' : (d > 0 ? '↑' + d : '↓' + (-d))));
}
let same = 0;
for (let i = 0; i < 25; i++) {
  const [pid] = arr[i];
  const t = no1.get(pid);
  if (t && t.rank === i + 1) same++;
}
console.log('\n  Top25 逐位重合 = ' + same + '/25');

const pairs = [];
for (const [pid, m] of arr) {
  const v = m1ByName.get(norm(m.name));
  if (v === undefined) continue;
  pairs.push({ m4: m.m4, no1: m.no1, m1: v });
}
const rFull = pearson(pairs.map((p) => p.m4), pairs.map((p) => p.m1));
const rNo1 = pearson(pairs.map((p) => p.no1), pairs.map((p) => p.m1));
console.log('\n  与 M1（纪录分）的相关性，样本 n=' + pairs.length + '：');
console.log('    现状 M4（含坐第一）  ρ = ' + rFull.toFixed(4));
console.log('    剔除「坐第一」后    ρ = ' + rNo1.toFixed(4));
console.log('    → 剔掉后重复度 ' + (rNo1 < rFull ? '下降' : '上升') +
  ' ' + Math.abs(rFull - rNo1).toFixed(4));

console.log('\n══════ ② 前 100 占席要不要进主口径 ══════\n');
const by100 = [...meta.entries()].sort((a, b) => b[1].d100 - a[1].d100);
console.log('  假如把「进过前 100」的占席时间也算进主口径，榜单会变成：\n');
console.log('  # | 选手 | 前100占席年 | 现状 M4 | 现状名次');
for (let i = 0; i < 15; i++) {
  const [pid, m] = by100[i];
  console.log('  ' + String(i + 1).padStart(2) + ' | ' + m.name.padEnd(24) +
    m.d100.toFixed(4).padStart(12) + ' | ' + m.m4.toFixed(4).padStart(9) +
    ' | #' + rankNow.get(pid));
}
const top100set = new Set(by100.slice(0, 25).map(([pid]) => pid));
console.log('\n  与现状 Top25 重合 = ' +
  arr.slice(0, 25).filter(([pid]) => top100set.has(pid)).length + '/25');
console.log('\n  人口：进过前十 ' + arr.length + ' 人（前 100 诊断另有 4,646 人不参与排名）');
console.log('  → 前 100 门槛太松，测的是「长期参与」而不是「统治力」。');
console.log('    Robert Yau 前 100 占席 210 年（现状 M4 仅 1.0056，#219）。');

console.log('\n══════ ③ 弱竞争（当年只有几个人参赛）══════\n');
console.log('  方案 F 已处理「当年 0 人参赛」。剩下是「当年 3~10 人参赛」。');
console.log('  实测（密度门槛 ref=10）：');
console.log('    · 全站 Top25 逐位不变（25/25），Top10 也不变（10/10）');
console.log('    · 受影响人数：ref=10 → 5 人；ref=30 → 20 人；ref=50 → 27 人');
console.log('    · 全站合计 934.9591 → 932.9950（−0.21%，ref=10）');
console.log('    · 受损最大的是停滞期老将（Dror Vomberg −26.8%、Jeff Goetz −20.4%）');
console.log('\n  → 这一项对头部几乎没影响，且要拍一个阈值，换来的收益极小。');

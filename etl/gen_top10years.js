/* 一次性生成器：由 etl/score/M4_facts.tsv（M4 统治力引擎的逐年占席事实表）派生出
   「世界前十年数」——**不跨项目累加**，只统计该选手有多少个自然年里
   至少有一个项目（单次或平均）待在世界前十。
   产出 js/top10years.js（约 20KB），供选手页读取。
   ⚠ 该文件是 M4 的派生量：一旦重跑 m4_dominance.js 重新生成 M4_facts.tsv，
     需要重新执行本脚本。 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'etl/score/M4_facts.tsv');
const OUT = path.join(ROOT, 'js/top10years.js');

const txt = fs.readFileSync(SRC, 'utf8').split('\n');
const head = txt[0].split('\t');
const iPid = head.indexOf('pid'), iYear = head.indexOf('year');
if (iPid < 0 || iYear < 0) throw new Error('M4_facts.tsv 缺少 pid/year 列');

const years = new Map(); // pid -> Set(year)
for (let i = 1; i < txt.length; i++) {
  const line = txt[i];
  if (!line) continue;
  const c = line.split('\t');
  const pid = c[iPid];
  const y = +c[iYear];
  if (!pid || !y) continue;
  let s = years.get(pid);
  if (!s) { s = new Set(); years.set(pid, s); }
  s.add(y);
}

const out = {};
const arr = [...years.entries()].sort((a, b) => a[0].localeCompare(b[0]));
for (const [pid, s] of arr) {
  const list = [...s].sort((a, b) => a - b);
  out[pid] = list.length;
}

const json = JSON.stringify(out);
fs.writeFileSync(OUT,
  '/* AUTO-GENERATED from etl/score/M4_facts.tsv — 世界前十年数（按年去重，不跨项目累加）。\n' +
  '   重新生成：node etl/gen_top10years.js */\n' +
  'window.T10Y = ' + json + ';\n', 'utf8');
console.log('写出', OUT, '| 选手数', Object.keys(out).length, '| 字节', json.length);
console.log('抽样 Feliks(2009ZEMD01):', out['2009ZEMD01'], '| Max(2012PARK03):', out['2012PARK03']);

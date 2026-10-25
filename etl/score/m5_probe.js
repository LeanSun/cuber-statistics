/**
 * M5 探查 · 现势排名数据结构与规模
 * 只读，不改任何主脚本
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const ZIP = fs.readdirSync(path.join(ROOT, 'data/raw')).filter((f) => f.endsWith('.zip'))[0];
const ZIP_PATH = path.join(ROOT, 'data/raw', ZIP);

function streamTsv(name, onRow) {
  return new Promise((resolve, reject) => {
    const ps = spawn('unzip', ['-p', ZIP_PATH, name]);
    let buf = ''; let head = true;
    ps.on('error', reject);
    ps.stdout.on('data', (d) => {
      buf += d.toString('utf8');
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const ln = buf.slice(0, i); buf = buf.slice(i + 1);
        if (head) { head = false; continue; }
        if (ln) onRow(ln.split('\t'));
      }
    });
    ps.on('close', () => resolve());
  });
}

(async () => {
  /* 1. 事件表 */
  const evInfo = new Map();
  await streamTsv('WCA_export_events.tsv', (r) => {
    if (!r[0]) return;
    evInfo.set(r[0], { name: r[2] || r[0], format: r[1] });
  });
  console.log('=== 事件表 ===');
  for (const [k, v] of evInfo) console.log('  ', k, '|', v.name, '|', v.format);

  /* 2. ranks：每个 (event,track) 的名次深度、覆盖人数 */
  const stats = new Map();   // key: ev|track → {people, maxRank, rankSet}
  const personRank = new Map(); // pid|ev|track → {wr, cr, nr}
  const rankCounts = new Map();

  for (const [tr, file] of [['single', 'WCA_export_ranks_single.tsv'], ['average', 'WCA_export_ranks_average.tsv']]) {
    await streamTsv(file, (r) => {
      if (!r[0]) return;
      const [, pid, ev, wr, cr, nr] = r;
      const key = ev + '|' + tr;
      let s = stats.get(key);
      if (!s) { s = { people: new Set(), maxRank: 0, ranks: new Set() }; stats.set(key, s); }
      s.people.add(pid);
      s.maxRank = Math.max(s.maxRank, +wr || 0);
      s.ranks.add(+wr);
      personRank.set(pid + '|' + key, { wr: +wr, cr: +cr, nr: +nr });
      rankCounts.set(key, (rankCounts.get(key) || 0) + 1);
    });
  }

  console.log('\n=== 现势排名：每个 (项目,轨道) 的名次深度 ===');
  console.log('ev\ttrack\trows\tpeople\tmaxRank\trankGaps');
  const evList = [...evInfo.keys()].sort();
  for (const ev of evList) {
    for (const tr of ['single', 'average']) {
      const s = stats.get(ev + '|' + tr);
      if (!s) { console.log(`${ev}\t${tr}\t0\t0\t0\t-`); continue; }
      /* 连续性检查：1..maxRank 中缺哪些名次 */
      const gaps = [];
      for (let i = 1; i <= s.maxRank; i++) if (!s.ranks.has(i)) gaps.push(i);
      console.log(`${ev}\t${tr}\t${rankCounts.get(ev + '|' + tr)}\t${s.people.size}\t${s.maxRank}\t${gaps.length ? gaps.slice(0, 8).join(',') : '无'}`);
    }
  }

  /* 3. 覆盖人口 */
  const withAny = new Set();
  const withBoth = new Set();
  const withSingle = new Set();
  const withAvg = new Set();
  for (const [key] of personRank) {
    const pid = key.slice(0, key.lastIndexOf('|'));
    withAny.add(pid);
    const [ev, tr] = key.slice(pid.length + 1).split('|');
    if (tr === 'single') withSingle.add(pid); else withAvg.add(pid);
    if (withSingle.has(pid) && withAvg.has(pid)) withBoth.add(pid);
  }
  console.log('\n=== 覆盖人口 ===');
  console.log('  至少一个 (项目,轨道) 有排名的人：', withAny.size);
  console.log('  单次榜有人：', withSingle.size, ' 平均榜有人：', withAvg.size);
  console.log('  两种轨道都有人：', withBoth.size);

  /* 4. 一个人最多有几个项目的排名 */
  const perPerson = new Map();
  for (const key of personRank.keys()) {
    const pid = key.slice(0, key.lastIndexOf('|'));
    perPerson.set(pid, (perPerson.get(pid) || 0) + 1);
  }
  const dist = new Map();
  for (const v of perPerson.values()) dist.set(v, (dist.get(v) || 0) + 1);
  console.log('\n=== 每人拥有的 (项目,轨道) 排名条目数分布 ===');
  [...dist.entries()].sort((a, b) => a[0] - b[0]).slice(0, 25)
    .forEach(([k, v]) => console.log(`  ${k} 个条目: ${v} 人`));

  /* 5. 排名最大值分布 */
  const wrAll = [];
  for (const v of personRank.values()) wrAll.push(v.wr);
  wrAll.sort((a, b) => b - a);
  console.log('\n=== world_rank 分布 ===');
  console.log('  最大 world_rank:', wrAll[0]);
  console.log('  前 10 名内的人数次:', wrAll.filter((x) => x <= 10).length);
  console.log('  前 100 名内的人数次:', wrAll.filter((x) => x <= 100).length);
  console.log('  前 1000 名内的人数次:', wrAll.filter((x) => x <= 1000).length);
  console.log('  全部条目数:', wrAll.length);

  fs.writeFileSync(path.join(__dirname, 'm5_probe_ranks.tsv'),
    ['pid\tev\ttrack\twr\tcr\tnr'].join('\t') + '\n' +
    [...personRank.entries()].map(([k, v]) => {
      const i = k.lastIndexOf('|');
      return [k.slice(0, i), k.slice(i + 1).split('|')[0], k.slice(i + 1).split('|')[1], v.wr, v.cr, v.nr].join('\t');
    }).join('\n') + '\n', 'utf8');
  console.log('\n→ m5_probe_ranks.tsv 已导出');
})();

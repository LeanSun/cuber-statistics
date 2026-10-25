/**
 * M5 探查 2 · 活跃度与退役衰减的量化
 * 只读，不改任何主脚本
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const ZIP = fs.readdirSync(path.join(ROOT, 'data/raw')).filter((f) => f.endsWith('.zip'))[0];
const ZIP_PATH = path.join(ROOT, 'data/raw', ZIP);
const SNAPSHOT = '2026-10-15';

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
const dayOf = (s) => Math.floor(Date.parse(s + 'T00:00:00Z') / 86400000);
const SNAP_DAY = dayOf(SNAPSHOT);

(async () => {
  /* 1. 比赛结束日 */
  const compDay = new Map();
  await streamTsv('WCA_export_competitions.tsv', (r) => {
    if (!r[0] || r[10] === '1') return;
    const y = +r[17] || +r[14]; if (!y) return;
    const m = +r[18] || +r[15] || 1;
    const d = +r[19] || +r[16] || 1;
    compDay.set(r[0], dayOf(y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0')));
  });
  console.log('[1] 比赛数:', compDay.size);

  /* 2. 每人的最后参赛日 + 参赛场次数 */
  const lastComp = new Map();     // pid → day
  const compCount = new Map();    // pid → 次数
  const firstComp = new Map();
  const evSet = new Map();        // pid → Set(ev)
  let rows = 0, skipped = 0;
  await streamTsv('WCA_export_results.tsv', (r) => {
    if (!r[0]) return;
    rows++;
    const compId = r[4], pid = r[8], ev = r[6];
    if (!pid) return;
    const day = compDay.get(compId);
    if (day === undefined) { skipped++; return; }
    if (lastComp.get(pid) == null || day > lastComp.get(pid)) lastComp.set(pid, day);
    if (firstComp.get(pid) == null || day < firstComp.get(pid)) firstComp.set(pid, day);
    compCount.set(pid, (compCount.get(pid) || 0) + 1);
    let s = evSet.get(pid);
    if (!s) { s = new Set(); evSet.set(pid, s); }
    s.add(ev);
  });
  console.log('[2] results 行数:', rows, ' 未匹配比赛:', skipped);
  console.log('    有成绩的人:', lastComp.size);

  /* 3. 现势排名 */
  const ranks = [];   // {pid, ev, tr, wr, cr, nr}
  for (const [tr, file] of [['single', 'WCA_export_ranks_single.tsv'], ['average', 'WCA_export_ranks_average.tsv']]) {
    await streamTsv(file, (r) => {
      if (!r[0]) return;
      ranks.push({ pid: r[1], ev: r[2], tr, wr: +r[3], cr: +r[4], nr: +r[5] });
    });
  }
  console.log('[3] 排名条目:', ranks.length);

  /* 4. 关键问题：排名榜里的人，有多少已经「退役」？ */
  const gapYears = (pid) => {
    const lc = lastComp.get(pid);
    if (lc == null) return null;
    return (SNAP_DAY - lc) / 365.25;
  };

  console.log('\n=== 排名榜的「距最后参赛」分布（按名次分档）===');
  const bands = [
    [1, 1], [2, 3], [4, 10], [11, 20], [21, 50], [51, 100], [101, 200], [201, 500], [501, 1000], [1001, 999999],
  ];
  console.log('名次档\t条目数\t有参赛记录\t无记录\t距今<1年\t1-2年\t2-3年\t3-5年\t5年+\t距今中位数');
  for (const [lo, hi] of bands) {
    const sub = ranks.filter((x) => x.wr >= lo && x.wr <= hi);
    let has = 0, none = 0;
    const buckets = [0, 0, 0, 0, 0];
    const gaps = [];
    for (const x of sub) {
      const g = gapYears(x.pid);
      if (g == null) { none++; continue; }
      has++; gaps.push(g);
      if (g < 1) buckets[0]++;
      else if (g < 2) buckets[1]++;
      else if (g < 3) buckets[2]++;
      else if (g < 5) buckets[3]++;
      else buckets[4]++;
    }
    gaps.sort((a, b) => a - b);
    const med = gaps.length ? gaps[gaps.length >> 1].toFixed(2) : '—';
    console.log(`${lo}-${hi}\t${sub.length}\t${has}\t${none}\t${buckets[0]}\t${buckets[1]}\t${buckets[2]}\t${buckets[3]}\t${buckets[4]}\t${med}`);
  }

  /* 5. 头部：各项目 world_rank 前 10 的活跃度 */
  console.log('\n=== 各项目单次 world_rank 前 5 的「距最后参赛」 ===');
  const byEv = new Map();
  for (const x of ranks) {
    if (x.tr !== 'single') continue;
    if (!byEv.has(x.ev)) byEv.set(x.ev, []);
    byEv.get(x.ev).push(x);
  }
  for (const [ev, arr] of [...byEv.entries()].sort()) {
    const top = arr.filter((x) => x.wr <= 5).sort((a, b) => a.wr - b.wr);
    const desc = top.map((x) => {
      const g = gapYears(x.pid);
      return `#${x.wr}:${g == null ? '无记录' : g.toFixed(1) + 'y'}`;
    }).join('  ');
    console.log(`  ${ev.padEnd(8)} ${desc}`);
  }

  /* 6. 「现势排名」与「当前活跃者排名」的差距有多大？ */
  console.log('\n=== 若只取「近 1 年内参赛过的人」重排，与官方终身榜的差距 ===');
  console.log('ev\t官方Top5\t活跃榜Top5\tTop10重合\tTop100重合');
  for (const [ev, arr] of [...byEv.entries()].sort()) {
    const act = arr.filter((x) => { const g = gapYears(x.pid); return g != null && g < 1; });
    const actSorted = [...act].sort((a, b) => a.wr - b.wr);
    const actTop5 = actSorted.slice(0, 5).map((x) => x.pid).join(',');
    const offTop5 = arr.filter((x) => x.wr <= 5).sort((a, b) => a.wr - b.wr).map((x) => x.pid).join(',');
    const actSet = new Set(actSorted.slice(0, 10).map((x) => x.pid));
    const offSet = new Set(arr.filter((x) => x.wr <= 10).map((x) => x.pid));
    const actSet100 = new Set(actSorted.slice(0, 100).map((x) => x.pid));
    const offSet100 = new Set(arr.filter((x) => x.wr <= 100).map((x) => x.pid));
    const ov10 = [...actSet].filter((x) => offSet.has(x)).length;
    const ov100 = [...actSet100].filter((x) => offSet100.has(x)).length;
    console.log(`${ev}\t${offTop5 === actTop5 ? '同' : '不同'}\t${actTop5 ? '有' : '无'}\t${ov10}/10\t${ov100}/100`);
  }

  /* 7. 导出 */
  const out = ['pid\tname\tlast_comp_day\tlast_comp_year\tgap_years\tcomp_count\tn_events'];
  const names = new Map();
  await streamTsv('WCA_export_persons.tsv', (r) => { if (r[2]) names.set(r[2], r[0]); });
  const rankTop = new Map();
  for (const x of ranks) {
    let o = rankTop.get(x.pid);
    if (!o) { o = { best: 1e9, n: 0, evs: new Set() }; rankTop.set(x.pid, o); }
    if (x.wr < o.best) o.best = x.wr;
    o.n++; o.evs.add(x.ev);
  }
  for (const [pid, lc] of lastComp) {
    const o = rankTop.get(pid);
    if (!o) continue;
    out.push([pid, names.get(pid) || '', lc, new Date(lc * 86400000).toISOString().slice(0, 10),
      ((SNAP_DAY - lc) / 365.25).toFixed(4), compCount.get(pid) || 0, o.evs.size].join('\t'));
  }
  fs.writeFileSync(path.join(__dirname, 'm5_probe_activity.tsv'), out.join('\n') + '\n', 'utf8');
  console.log('\n→ m5_probe_activity.tsv 已导出（含每人最后参赛日 / 距今天数 / 场次 / 项目数）');
})();

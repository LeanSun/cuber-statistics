/**
 * M5 口径审阅 · 专项诊断
 *
 * 检验四个疑点：
 *   Q1 「衰减降权但不重排名次」→ 退役僵尸仍占着 #1 的问题有多严重
 *   Q2 各项目的排名覆盖深度（深度 100 对小项目是否够/是否溢出）
 *   Q3 头部分数由什么主导：名次 vs 项目权重 w_e
 *   Q4 与站点现有 esum / M4 / M2 的重复度
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const RN = require('./runs.js');

const ROOT = path.resolve(__dirname, '../..');
const ZIP = fs.readdirSync(path.join(ROOT, 'data/raw')).filter((f) => f.endsWith('.zip'))[0];
const ZIP_PATH = path.join(ROOT, 'data/raw', ZIP);
const SNAPSHOT_DAY = RN.SNAPSHOT_DAY;
const dayOf = (s) => Math.floor(Date.parse(s + 'T00:00:00Z') / 86400000);
const F = (v) => Number(v).toFixed(4);
const num = (v) => Number(v).toLocaleString('en-US');

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
  const W = RN.EV_WEIGHT_V2;
  const RETIRED = RN.EV_RETIRED_DAY;
  const FLOOR = RN.WEIGHT_V2_CFG.floor;

  /* 比赛日 */
  const compDay = new Map();
  await streamTsv('WCA_export_competitions.tsv', (r) => {
    if (!r[0] || r[10] === '1') return;
    const y = +r[17] || +r[14]; if (!y) return;
    const m = +r[18] || +r[15] || 1;
    const d = +r[19] || +r[16] || 1;
    compDay.set(r[0], dayOf(y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0')));
  });

  /* 人名 */
  const pName = new Map();
  await streamTsv('WCA_export_persons.tsv', (r) => { if (r[2]) pName.set(r[2], r[0]); });

  /* 每人在每项目的末次参赛 */
  const lastByEv = new Map();
  await streamTsv('WCA_export_results.tsv', (r) => {
    if (!r[8]) return;
    const day = compDay.get(r[4]);
    if (day === undefined) return;
    const k = r[8] + '|' + r[6];
    if (lastByEv.get(k) == null || day > lastByEv.get(k)) lastByEv.set(k, day);
  });

  /* 官方排名 */
  const ranks = [];
  for (const [tr, file] of [['single', 'WCA_export_ranks_single.tsv'],
    ['average', 'WCA_export_ranks_average.tsv']]) {
    await streamTsv(file, (r) => {
      if (!r[0]) return;
      ranks.push({ pid: r[1], ev: r[2], tr, wr: +r[3], cr: +r[4], nr: +r[5] });
    });
  }

  /* 每个组合的所有排名条目（不限深度） */
  const comboAll = new Map();
  for (const x of ranks) {
    const k = x.ev + '|' + x.tr;
    if (!comboAll.has(k)) comboAll.set(k, []);
    comboAll.get(k).push(x);
  }

  console.log('═══════ Q2 各组合的排名覆盖深度（官方 ranks 有多少条目）═══════');
  console.log('组合\t\t总条目\t最大名次\t#1人数\t深度100覆盖率');
  const depthStat = [];
  for (const [k, arr] of comboAll) {
    let maxR = 0;
    for (const x of arr) if (x.wr > maxR) maxR = x.wr;
    const n1 = arr.filter((x) => x.wr === 1).length;
    const c100 = arr.filter((x) => x.wr <= 100).length;
    depthStat.push({ k, total: arr.length, maxR, n1, c100 });
  }
  depthStat.sort((a, b) => a.maxR - b.maxR);
  for (const d of depthStat) {
    console.log(`${d.k}\t\t${d.total}\t${d.maxR}\t${d.n1}\t${(d.c100 / d.total * 100).toFixed(1)}%`);
  }

  console.log('\n═══════ Q1 退役僵尸占 #1 的规模 ═══════');
  console.log('（只看非停办项目，depth<=100）');
  const ACTIVE = ['222', '333', '333bf', '333fm', '333mbf', '333oh', '444', '444bf',
    '555', '555bf', '666', '777', 'clock', 'minx', 'pyram', 'skewb', 'sq1'];
  const comboInfo = new Map();
  for (const x of ranks) {
    if (x.wr > 100) continue;
    if (!ACTIVE.includes(x.ev)) continue;
    const k = x.ev + '|' + x.tr;
    if (!comboInfo.has(k)) comboInfo.set(k, []);
    comboInfo.get(k).push(x);
  }
  let zombieTop = 0, totalTop = 0;
  const zombieList = [];
  const rank1Gap = [];
  for (const [k, arr] of comboInfo) {
    const top = arr.filter((x) => x.wr === 1);
    for (const t of top) {
      totalTop++;
      const lc = lastByEv.get(t.pid + '|' + t.ev);
      const gap = lc == null ? 99 : (SNAPSHOT_DAY - lc) / 365.25;
      rank1Gap.push(gap);
      if (gap >= 2) {
        zombieTop++;
        zombieList.push({ k, name: pName.get(t.pid) || t.pid, gap });
      }
    }
  }
  rank1Gap.sort((a, b) => a - b);
  console.log(`非停办组合的 #1 共 ${totalTop} 个`);
  console.log(`其中已 2 年以上未在该项目参赛的「僵尸 #1」: ${zombieTop} 个`);
  console.log(`#1 的 gap 分布: 中位 ${rank1Gap[Math.floor(rank1Gap.length / 2)].toFixed(2)}y  ` +
    `最大 ${rank1Gap[rank1Gap.length - 1].toFixed(2)}y  ≥2y 占 ${(zombieTop / totalTop * 100).toFixed(1)}%`);
  console.log('\n最典型的僵尸 #1（gap 最大 12 个）：');
  zombieList.sort((a, b) => b.gap - a.gap);
  for (const z of zombieList.slice(0, 12)) {
    console.log(`  ${z.k}\t${z.name}\tgap=${z.gap.toFixed(1)}y`);
  }

  /* Q1b：模拟「在活跃选手中重新排名」 */
  console.log('\n═══════ Q1b 若改用「活跃选手重排名」（活跃窗口 1 年）═══════');
  console.log('组合\t官方#1\t官方#1名次(gap)  |  活跃重排#1  |  活跃重排后名次变化');
  let changed = 0, tot = 0;
  const sampleChanges = [];
  for (const [k, arr] of comboInfo) {
    tot++;
    const offTop = arr.filter((x) => x.wr === 1).sort((a, b) => a.wr - b.wr)[0];
    const withGap = arr.map((x) => {
      const lc = lastByEv.get(x.pid + '|' + x.ev);
      const gap = lc == null ? 99 : (SNAPSHOT_DAY - lc) / 365.25;
      return { ...x, gap };
    });
    const active = withGap.filter((x) => x.gap <= 1);
    if (!active.length || !offTop) continue;
    const actTop = active[0];
    if (actTop.pid !== offTop.pid) {
      changed++;
      if (sampleChanges.length < 10) {
        sampleChanges.push({
          k,
          off: pName.get(offTop.pid) || offTop.pid,
          offGap: offTop.gap,
          act: pName.get(actTop.pid) || actTop.pid,
          actWr: actTop.wr,
        });
      }
    }
  }
  console.log(`${changed}/${tot} 个组合的「活跃 #1」≠「官方 #1」`);
  for (const s of sampleChanges) {
    console.log(`  ${s.k}\t官方#1=${s.off}(gap ${s.offGap.toFixed(1)}y)  →  活跃#1=${s.act}(官方名次 ${s.actWr})`);
  }

  /* Q3：头部分数由什么主导 */
  console.log('\n═══════ Q3 头部选手的分数构成：名次贡献 vs 项目权重贡献 ═══════');
  const decayOf = (gap) => Math.max(0.2, 1 - (gap / 5) * 0.8);
  const perPlayer = new Map();
  for (const x of ranks) {
    if (x.wr > 100) continue;
    if (!ACTIVE.includes(x.ev)) continue;
    const lc = lastByEv.get(x.pid + '|' + x.ev);
    const gap = lc == null ? 99 : (SNAPSHOT_DAY - lc) / 365.25;
    const dec = decayOf(gap);
    const w = W[x.ev] == null ? FLOOR : W[x.ev];
    const tw = 1;
    const score = w * Math.pow(x.wr, -1) * dec * tw;
    if (score <= 0) continue;
    let p = perPlayer.get(x.pid);
    if (!p) {
      p = { pid: x.pid, name: pName.get(x.pid) || x.pid, m5: 0, parts: [] };
      perPlayer.set(x.pid, p);
    }
    p.m5 += score;
    p.parts.push({ ev: x.ev, tr: x.tr, wr: x.wr, w, gap, dec, score });
  }
  const ranked = [...perPlayer.values()].sort((a, b) => b.m5 - a.m5);
  console.log('选手\t\tM5\t组合数\t#1数\t名次项贡献\t权重项贡献\t平均w');
  for (const p of ranked.slice(0, 12)) {
    /* 拆解：score = w × rankScore × dec，把 w 归到「权重项」，rankScore×dec 归到「名次项」 */
    let wPart = 0, rPart = 0;
    for (const q of p.parts) {
      wPart += q.w * Math.pow(q.wr, -1) * q.dec;
      rPart += 1 * Math.pow(q.wr, -1) * q.dec;
    }
    const avgW = p.parts.reduce((a, q) => a + q.w, 0) / p.parts.length;
    console.log(`${p.name.slice(0, 20).padEnd(20)}\t${F(p.m5)}\t${p.parts.length}\t${p.parts.filter((q) => q.wr === 1).length}\t${F(rPart)}\t${F(wPart)}\t${F(avgW)}`);
  }

  /* Q4：与站点 esum 的重复度 */
  console.log('\n═══════ Q4 与站点 esum 的重复度 ═══════');
  try {
    const js = fs.readFileSync(path.join(ROOT, 'data/site/players.json'), 'utf8');
    const arr = JSON.parse(js);
    const esum = new Map();
    for (const p of arr) {
      if (p.esum != null) esum.set(p.name, p.esum);
    }
    const names = ranked.slice(0, 30).map((p) => p.name);
    const xs = [], ys = [];
    for (const n of names) {
      const v = esum.get(n);
      if (v == null) continue;
      xs.push(ranked.find((p) => p.name === n).m5); ys.push(v);
    }
    if (xs.length >= 3) {
      const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
      const my = ys.reduce((a, b) => a + b, 0) / ys.length;
      let nu = 0, dx = 0, dy = 0;
      for (let i = 0; i < xs.length; i++) {
        const a = xs[i] - mx, b = ys[i] - my;
        nu += a * b; dx += a * a; dy += b * b;
      }
      console.log(`M5 × esum Pearson ρ = ${(nu / Math.sqrt(dx * dy)).toFixed(4)} (n=${xs.length})`);
    } else console.log('esum 匹配样本不足：', xs.length);
  } catch (e) { console.log('esum 数据读取失败:', e.message); }
})();

#!/usr/bin/env node
/* ============================================================================
   sixyear.js —— 六维「年度曲线」（每维自己的时间演进）

   问题（2026-11-02 用户反馈）：图表可视化页的「维度」筛选选中某一维后，
   竞速图里的人员与起始时间不对：
     · 统治力（M4）：有人在自己的首次参赛年之前就已经出现；
     · 当前排名（M5）：2003 年就有一整屏「当前排名」高分选手（其实那批人 2020 年代才出道）；
     · 根因是旧实现拿**通用年度曲线**（p.yearly＝领奖台 + 纪录次数）当所有维度的进度，
       并且在这条曲线为空时直接把 ratio 记成 1 —— 于是「快照型 / 席位型」维度
       从 2003 年起就顶着最终分站在原地。

   本脚本为每个维度单独算一条曲线：直接读六维引擎的**事实现表**（M1/M2/M3/M4/M5/M6），
   按 (pid, dim, year) 汇总，再折算成「占本人该维最终值的千分比」：
       ratio(pid, dim, y) = 1000 × cum(y) / cum(最后一年)      （M1/M2/M3/M4/M6，累计型）
       ratio(pid, dim, y) = 1000 × lvl(y) / lvl(最后一年)      （M5，快照型；缺失年份沿用上一年的读数）
   前端用 `p.six[dim] × ratio/1000` 还原分数，因此**最后一年恒等于该维的真实分**，
   历史形状则由维度自己的事实决定 —— 起始时间、人员构成、增长节奏全部随之纠正。

   输出 sixyear.tsv：  pid \t dim \t "2007:120,2009:340"        （ratio 为 0..1000 的整数）
   只保留 sixdim_site.tsv 里那批人（其余选手没有 p.six，单维竞速图本来就不展示他们）。

   用法：node etl/score/sixyear.js
   ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const D = __dirname;
const SITE = path.join(D, 'sixdim_site.tsv');
const OUT = path.join(D, 'sixyear.tsv');

/* 每行事实 → 该行对本维的贡献（与 sixdim.js 逐字节同源，别在这里改魔法数） */
const BETA = 0.2241;                 // M2 普通赛折算（M2-F1 冻结常量）

function log(...a) { console.log('[sixyear]', ...a); }

/* ── 1 白名单：站点主表里的选手 ── */
if (!fs.existsSync(SITE)) {
  console.error('[sixyear] 缺少 ' + SITE + ' —— 先跑 etl/score/rebuild_sixdim.js');
  process.exit(1);
}
const keep = new Set();
for (const ln of fs.readFileSync(SITE, 'utf8').trim().split('\n').slice(1)) {
  const pid = ln.slice(0, ln.indexOf('\t'));
  if (pid) keep.add(pid);
}
log('站点主表选手:', keep.size);

/* ── 2 累计容器：dim → pid → Map(year → raw) ── */
const DIMS = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'];
const acc = {};
DIMS.forEach((d) => { acc[d] = new Map(); });
function put(dim, pid, year, v) {
  if (!pid || !year || !(v > 0)) return;
  if (!keep.has(pid)) return;
  let m = acc[dim].get(pid);
  if (!m) { m = new Map(); acc[dim].set(pid, m); }
  m.set(year, (m.get(year) || 0) + v);
}

function stream(file, onRow) {
  const f = path.join(D, file);
  if (!fs.existsSync(f)) { console.warn('[sixyear] ⚠ 缺少 ' + file + '，该维曲线留空'); return Promise.resolve(); }
  return new Promise((res, rej) => {
    const r = readline.createInterface({ input: fs.createReadStream(f), crlfDelay: Infinity });
    let first = true;
    r.on('line', (ln) => {
      if (first) { first = false; return; }          // 表头
      if (!ln) return;
      try { onRow(ln.split('\t')); } catch (e) { /* 单行异常不影响整体 */ }
    });
    r.on('close', res);
    r.on('error', rej);
  });
}

(function main() {
  /* M1 纪录持有：pid,ev,type,level,scope,year,frac,score */
  const p1 = stream('M1_facts.tsv', (c) => put('m1', c[0], +c[5], +c[7] || 0))
    /* M2 领奖台：pid,name,ev,tier,pos,year,compId,base,decay */
    .then(() => stream('M2_facts.tsv', (c) => put('m2', c[0], +c[5], (+c[7] || 0) * (+c[8] || 0) * (c[3] === 'OP' ? BETA : 1))))
    /* M3 大赛表现：pid,ev,type,lvl,tier,year,add,pioneer,f */
    .then(() => stream('M3_facts.tsv', (c) => put('m3', c[0], +c[5], +c[6] || 0)))
    /* M4 统治力：pid,ev,track,year,contrib */
    .then(() => stream('M4_facts.tsv', (c) => put('m4', c[0], +c[3], +c[4] || 0)))
    /* M5 当前排名：year,pid,ev,kind,rank,score —— 快照型，逐 (年, 人) 求和即为当年读数 */
    .then(() => stream('M5_facts.tsv', (c) => put('m5', c[1], +c[0], +c[5] || 0)))
    /* M6 突破幅度：pid,event,kind,date,…,final_norm（第 11 列，别再退回 capped_gain） */
    .then(() => stream('M6_by_record.tsv', (c) => put('m6', c[0], +String(c[3]).slice(0, 4), +c[10] || 0)));

  p1.then(() => {
    /* M5 的逐年「满分」：当年各项目榜单覆盖数不一样（2003 年只有 333 单次一个榜，
       2016 年后有 30 多个），直接拿 Σscore 比会得出「2003 年的人已经站在巅峰」的假象。
       先按当年全站最高分归一，再比「占自己最终读数的比例」，跨年才可比。 */
    const m5YearMax = new Map();
    acc.m5.forEach((m) => {
      m.forEach((v, y) => { if (v > (m5YearMax.get(y) || 0)) m5YearMax.set(y, v); });
    });
    const out = [];
    let pairs = 0, pids = 0;
    for (const pid of keep) {
      const cell = {};
      let any = false;
      for (const dim of DIMS) {
        const m = acc[dim].get(pid);
        if (!m || !m.size) continue;
        const ys = [...m.keys()].sort((a, b) => a - b);
        const parts = [];
        if (dim === 'm5') {
          /* 快照型：缺失年份沿用上一年读数（M5 封存口径：名次被持有，不会自己消失），
             每年先按当年满分为 1 归一，再折成「占自己最后一年读数的千分比」。 */
          const norm = new Map();
          ys.forEach((y) => {
            const mx = m5YearMax.get(y) || 0;
            norm.set(y, mx > 0 ? m.get(y) / mx : 0);
          });
          const lastY = ys[ys.length - 1];
          const last = norm.get(lastY) || 0;
          if (!(last > 0)) continue;
          let carry = 0;
          for (const y of ys) {
            const v = norm.get(y) || 0;
            if (v > 0) carry = v;
            const r = Math.round(1000 * Math.min(1, carry / last));
            parts.push(y + ':' + r);
          }
        } else {
          /* 累计型：先做前缀和，再按「占最终值的千分比」折算 */
          let total = 0;
          for (const y of ys) total += m.get(y);
          if (!(total > 0)) continue;
          let cum = 0;
          for (const y of ys) {
            cum += m.get(y);
            const r = Math.round(1000 * Math.min(1, cum / total));
            parts.push(y + ':' + r);
          }
        }
        if (!parts.length) continue;
        /* 去掉与上一年相同的比率（节省体积）：只留真正增长的点，但必须保留最后一点 */
        const slim = [];
        let prev = -1;
        for (let i = 0; i < parts.length; i++) {
          const r = +parts[i].split(':')[1];
          if (r === prev && i !== parts.length - 1) continue;
          slim.push(parts[i]); prev = r;
        }
        cell[dim] = slim.join(',');
        pairs += slim.length;
        any = true;
      }
      if (any) { out.push([pid].concat(DIMS.map((d) => cell[d] || '')).join('\t')); pids++; }
    }
    /* 定长 7 列：pid + m1..m6（该维没有事实就留空），build.js 直接按列取 */
    const head = ['pid'].concat(DIMS).join('\t') + '\n';
    fs.writeFileSync(OUT, head + out.join('\n') + '\n', 'utf8');
    log('写出', path.basename(OUT), '|', pids, '人 |', pairs, '个 (年,比率) 点 |',
      (fs.statSync(OUT).size / 1048576).toFixed(2), 'MB');
  }).catch((e) => { console.error(e); process.exit(1); });
})();

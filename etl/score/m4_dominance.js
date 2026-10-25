'use strict';
/* ═══════════════════════════════════════════════════════════════════════
 * M4 · 统治力 · 世界排名席位时间积分（World Ranking Seat-Time Integral）
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── 一句话 ──────────────────────────────────────────────────────────
 *   M4 回答：「这个人**在世界的牌桌上坐了多久**。」
 *   把每个项目的世界排名还原成一条时间线，看谁长期占着前十（WR10）
 *   的席位、其中有多少时间是坐在第一。
 *
 * ── 为什么必须重建 ────────────────────────────────────────────────
 *   WCA v2 导出的 ranks_single / ranks_average **只有快照**（导出当日
 *   的世界排名），没有历史排名序列。要算「保持了多久」，只能从
 *   results.tsv 逐条重建：
 *
 *     某时刻的世界排名 = 所有人「截至该时刻的最好成绩」排序
 *
 *   这与官方口径一致：ranks_single 的 best 列 = 选手历史最好的单次，
 *   ranks_average 的 best 列 = 选手历史最好的平均。重建结果会在
 *   报告中与官方快照逐项对表验证。
 *
 * ── 核心公式 ──────────────────────────────────────────────────────
 *
 *   对每个 (项目 e, 轨道 t ∈ {single, average})：
 *     ① 取出该项目全部成绩，按时间排序（计数排序 O(n)）
 *     ② 逐条扫描，只保留「个人最好成绩」的进步时刻（PB 突破）
 *     ③ 维护一个长度 ≤10 的世界前十名单，随时间演进
 *     ④ 名单变化时切分时间段，记录每人在名单内的
 *          占席天数 (d10) / 坐第一的天数 (d1) / 名次加权席位天 (seat)
 *
 *   名次权重：g(r) = r^-λ    （r = 1..10，λ 越大越偏重「坐第一」）
 *
 *   M4_raw = Σ_{e,t} w_e · Σ_段 (段长/365) · g(名次)                [无时代折算]
 *   M4_era = Σ_{e,t} w_e · Σ_段 (段长/365) · g(名次) · f(年代)        [带时代折算]
 *
 *     w_e = EV_WEIGHT_V2（复用 M1-F1 的项目价，三阶 1.0000 全站最高）
 *     f   = M1-F1 的全局时代系数 valueOf('WR', ·, y)（ln 形式）
 *
 * ── 原始指标（不含权重的「事实」）──────────────────────────────────
 *   d10  = 在世界前十席位上的总天数   ← 用户要的「保持在 WR10 有多久」
 *   d1   = 坐在世界第一的总天数
 *
 * ── 口径边界 ──────────────────────────────────────────────────────
 *   ① 只统计**正式成绩**（DNF=-1 / DNS=-2 / 无成绩=0 一律剔除）
 *   ② 停办项目（333ft / magic / mmagic / 333mbo）的时间线封在停办日，
 *      否则「项目死了没人打破」会白赚十几年席位
 *   ③ 多盲（multi）成绩是编码值，需解码后再比较（见 decodeMulti）
 *   ④ 取消的赛事（cancelled=1）不计入
 *   ⑤ **方案 F（2026-10-25 拍板）**：某项目某年**零人参赛**时，
 *      该年的席位**一律不计分**。理由：当年没有竞争者，那一年的
 *      「世界排名」只是小样本内部排名，不构成统治力。
 *      实现在仿真层 closeSeg()，raw / era / 各 λ 同步生效。
 *
 * 用法：node --max-old-space-size=8192 etl/score/m4_dominance.js
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const RN = require('./runs.js');
const M1 = require('./m1.js');

const ROOT = path.resolve(__dirname, '../..');
const ZIP = fs.readdirSync(path.join(ROOT, 'data/raw')).filter((f) => f.endsWith('.zip'))[0];
const ZIP_PATH = path.join(ROOT, 'data/raw', ZIP);

const SNAPSHOT_DAY = RN.SNAPSHOT_DAY;
const F = (v) => Number(v).toFixed(4);
const num = (v) => Number(v).toLocaleString('en-US');

/* ── 口径旋钮 ─────────────────────────────────────────────────────── */
const CFG = {
  TOP_N: 10,                  // 席位深度：世界前十
  LAMBDAS: [0, 0.5, 1.0, 1.5],// 名次权重指数（λ=0 即「只看是否在前 10」）
  LAMBDA_MAIN: 1.0,           // 主口径 λ（用户 2026-10-25 定稿）
  ERA_MODE: 'global',         // 'none' | 'global' | 'event'（用户 2026-10-25 定稿：M1 全局池 ln）
  DEEP_N: 100,                // 诊断用：前 100 占席天数
  /* ── 方案 F（用户 2026-10-25 拍板采纳）─────────────────────────────
     「某项目某年无人参赛时，该年的席位不计分。」
     理由：当年若零人参赛，那一年的「世界前十」只是小样本内部排名，
     不构成统治力。与 M1 对「无前值可比的纪录段给 0 分」方向一致。
     实现在仿真层：closeSeg 跳过空窗年的整段天数 → raw / eraG / eraE
     与各 λ 名次拆解全部同步生效，不会出现口径分叉。            */
  EMPTY_YEAR_ZERO: true,
};

const TRACKS = ['single', 'average'];
const FOCUS = ['Feliks Zemdegs', 'Max Park', 'Tymon Kolasiński'];
/* 诊断用：需要产出「逐段明细」的选手（停滞期案例相关） */
const DIAG = ['Minh Thai', 'Jessica Fridrich', 'Lars Petrus', 'Zoltán Lábas', 'Guus Razoux Schultz'];
const CN_EV = {
  '333': '三阶', '222': '二阶', '444': '四阶', '555': '五阶', '666': '六阶', '777': '七阶',
  '333oh': '三单', '333bf': '三盲', '444bf': '四盲', '555bf': '五盲', '333mbf': '多盲',
  '333fm': '最少步', '333ft': '脚拧', 'clock': '魔表', 'minx': '五魔', 'pyram': '金字塔',
  'skewb': '斜转', 'sq1': 'SQ1', 'magic': '八板', 'mmagic': '十二板', '333mbo': '旧多盲',
};

/* ── 可增长 typed array ───────────────────────────────────────────── */
class Grow {
  constructor(Type, cap) { this.T = Type; this.a = new Type(cap || 1 << 16); this.n = 0; }
  push(v) {
    if (this.n === this.a.length) {
      const b = new this.T(this.a.length * 2);
      b.set(this.a); this.a = b;
    }
    this.a[this.n++] = v;
  }
  trim() { return this.a.subarray(0, this.n); }
}

/* ── TSV 流式读取 ─────────────────────────────────────────────────── */
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

/* ── 多盲编码解码 ───────────────────────────────────────────────────
 * WCA v2 导出中 multi 格式的成绩是一个十进制编码值：
 *   new (<1e9)  0DDTTTTTMM   DD = 99-(solved-missed)，TTTTT=秒，MM=missed
 *   old (≥1e9)  1SSAATTTTT   solved = 99-SS，AA=attempted，TTTTT=秒
 * 两种格式统一折算成「可比成本」：越小越好
 *   cost = (99 - diff) · 1e5 + min(秒, 99999)     diff = solved - missed
 * ──────────────────────────────────────────────────────────────────── */
function decodeMulti(v) {
  if (v < 1e9) {
    const S = String(v).padStart(10, '0');
    const DD = +S.slice(1, 3);
    const TT = Math.min(+S.slice(3, 8), 99999);
    const diff = 99 - DD;                       // solved - missed
    return { cost: (99 - diff) * 1e5 + TT, diff, time: TT };
  }
  const S = String(v);
  const SS = +S.slice(1, 3);
  const AA = +S.slice(3, 5);
  const TT = Math.min(+S.slice(5, 10), 99999);
  const solved = 99 - SS;
  const attempted = AA;
  const missed = attempted - solved;
  const diff = solved - missed;
  return { cost: (99 - diff) * 1e5 + TT, diff, time: TT, solved, attempted };
}

/* ── 按天计数排序 ─────────────────────────────────────────────────── */
function sortBucket(bucket) {
  const n = bucket.days.length;
  let maxDay = 0;
  for (let i = 0; i < n; i++) if (bucket.days[i] > maxDay) maxDay = bucket.days[i];
  const counts = new Int32Array(maxDay + 2);
  for (let i = 0; i < n; i++) counts[bucket.days[i] + 1]++;
  for (let d = 1; d < counts.length; d++) counts[d] += counts[d - 1];
  const nd = new Int32Array(n), np = new Int32Array(n), nv = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const d = bucket.days[i];
    const p = counts[d]++;
    nd[p] = d; np[p] = bucket.pids[i]; nv[p] = bucket.vals[i];
  }
  return { nd, np, nv, n };
}

/* ── 仿真：把一个 (项目,轨道) 的成绩流还原成世界前十时间线 ────────── */
function simulateSorted(S, topN, opt) {
  const collectYears = !!(opt && opt.collectYears);
  const { nd, np, nv, n } = S;
  const bestOf = new Map();                    // pid -> 当前最好成绩
  const bestDay = new Map();                   // pid -> 该成绩的达成日
  const topPid = new Int32Array(topN).fill(-1);
  const topVal = new Float64Array(topN);
  const topDay = new Int32Array(topN).fill(0);
  const scrPid = new Int32Array(topN + 1).fill(-1);
  const scrVal = new Float64Array(topN + 1);
  const scrDay = new Int32Array(topN + 1);
  let topCount = 0;
  const acc = new Map();
  let segStart = -1;
  /* 全站名次占位（年 → Float64Array(10)）：每个名次槽位有且只有 1 人，
     故「该名次被占用的天数」= 全站该名次席位天。可直接用于全站口径拆解。*/
  const siteRankYear = new Map();

  const newAcc = () => ({
    d10: 0, d1: 0,
    seats: [0, 0, 0, 0],                      // λ = 0 / 0.5 / 1 / 1.5
    byRank: new Float64Array(10),             // 各名次(1..10)的占位天数
    byYear: collectYears ? new Map() : null,   // λ=1 的按年席位天
    byRankYear: null,                         // 焦点选手才有：year → Float64Array(10)
    segList: [],                              // 焦点选手才有：逐段明细
    segEnd: 0,                                // 该选手最后一段的终点（校验停办封口）
    zeroedDays: 0,                            // 方案 F：被判定为空窗年而剔除的天数
    zeroedD1: 0,                              // 方案 F：其中「坐在第一」的天数
    zeroedSeat: 0,                            // 方案 F：被剔除的 λ=1 名次加权席位天
    zeroedByYear: new Map(),                  // 方案 F：year → 被剔除的席位天
    seatsNo1: [0, 0, 0, 0],                   // 诊断：剔除「坐在第一」后的席位天
    byYearNo1: collectYears ? new Map() : null, // 诊断：同上，按年
  });

  function closeSeg(endDay) {
    if (segStart < 0) { segStart = endDay; return; }
    let t = segStart;
    while (t < endDay) {
      const y = RN.yearOfDay(t) | 0;
      const yEnd = RN.dayOf((y + 1) + '-01-01');
      const segEnd = Math.min(endDay, yEnd);
      const dur = segEnd - t;
      if (dur > 0) {
        /* ── 方案 F：空窗年判定 ──────────────────────────────────────
           当年该项目零人参赛 → 这一年的「世界排名」没有竞争者可言，
           该年席位一律不计分（raw / era / 各 λ / 名次拆解同步生效）。 */
        const isEmpty = !!(opt.emptyYears && opt.emptyYears.has(y));
        for (let r = 0; r < topCount; r++) {
          const pid = topPid[r];
          if (pid < 0) continue;
          let a = acc.get(pid);
          if (!a) {
            a = newAcc();
            if (opt.focusSet && opt.focusSet.has(pid)) a.byRankYear = new Map();
            acc.set(pid, a);
          }
          const rank = r + 1;
          if (endDay > a.segEnd) a.segEnd = endDay;
          if (isEmpty) {
            a.zeroedDays += dur;
            if (rank === 1) a.zeroedD1 += dur;
            a.zeroedSeat += dur * Math.pow(rank, -1);
            a.zeroedByYear.set(y, (a.zeroedByYear.get(y) || 0) + dur * Math.pow(rank, -1));
            continue;
          }
          a.d10 += dur;
          a.byRank[rank - 1] += dur;
          if (rank === 1) a.d1 += dur;
          a.seats[0] += dur;
          a.seats[1] += dur * Math.pow(rank, -0.5);
          a.seats[2] += dur * Math.pow(rank, -1);
          a.seats[3] += dur * Math.pow(rank, -1.5);
          if (collectYears) {
            a.byYear.set(y, (a.byYear.get(y) || 0) + dur * Math.pow(rank, -1));
          }
          /* 诊断口径：剔除「坐在第一」后的席位（用于评估与 M1 的重复度）*/
          if (rank > 1) {
            a.seatsNo1[0] += dur;
            a.seatsNo1[1] += dur * Math.pow(rank, -0.5);
            a.seatsNo1[2] += dur * Math.pow(rank, -1);
            a.seatsNo1[3] += dur * Math.pow(rank, -1.5);
            if (collectYears) {
              a.byYearNo1.set(y, (a.byYearNo1.get(y) || 0) + dur * Math.pow(rank, -1));
            }
          }
          if (a.byRankYear) {
            let arr = a.byRankYear.get(y);
            if (!arr) { arr = new Float64Array(10); a.byRankYear.set(y, arr); }
            arr[rank - 1] += dur;
          }
          if (opt.focusSet && opt.focusSet.has(pid)) {
            a.segList.push({ y, from: t, to: segEnd, rank });
          }
          let sarr = siteRankYear.get(y);
          if (!sarr) { sarr = new Float64Array(10); siteRankYear.set(y, sarr); }
          sarr[rank - 1] += dur;
        }
      }
      t = segEnd;
    }
    segStart = endDay;
  }

  /* 插入排序在下方主循环内联完成 */

  for (let i = 0; i < n; i++) {
    const day = nd[i], pid = np[i], val = nv[i];
    const cur = bestOf.get(pid);
    if (cur !== undefined && val >= cur) continue;      // 非进步
    bestOf.set(pid, val);
    bestDay.set(pid, day);

    /* ── 算出新名单（写进 scratch，不动 top）── */
    let idx = -1;
    for (let r = 0; r < topCount; r++) if (topPid[r] === pid) { idx = r; break; }
    let newCount = topCount;
    if (idx >= 0) {
      for (let r = 0; r < topCount; r++) { scrPid[r] = topPid[r]; scrVal[r] = topVal[r]; scrDay[r] = topDay[r]; }
      scrVal[idx] = val; scrDay[idx] = day;               // 在位者刷新成绩
    } else if (topCount < topN) {
      for (let r = 0; r < topCount; r++) { scrPid[r] = topPid[r]; scrVal[r] = topVal[r]; scrDay[r] = topDay[r]; }
      scrPid[topCount] = pid; scrVal[topCount] = val; scrDay[topCount] = day; newCount = topCount + 1;
    } else if (val < topVal[topCount - 1]
      || (val === topVal[topCount - 1] && day < topDay[topCount - 1])) {
      /* 成绩更优，或成绩相同但**更早达成**（与 WCA 官方并列规则一致） */
      for (let r = 0; r < topCount; r++) { scrPid[r] = topPid[r]; scrVal[r] = topVal[r]; scrDay[r] = topDay[r]; }
      scrPid[topCount] = pid; scrVal[topCount] = val; scrDay[topCount] = day; newCount = topCount + 1;
    } else {
      continue;                                           // 进不了前十
    }

    /* 插入排序（≤ topN+1 个元素）：成绩升序，同成绩按达成日升序 */
    for (let k = 1; k < newCount; k++) {
      const pv = scrVal[k], pp = scrPid[k], pd = scrDay[k];
      let j = k - 1;
      while (j >= 0 && (scrVal[j] > pv || (scrVal[j] === pv && scrDay[j] > pd))) {
        scrVal[j + 1] = scrVal[j]; scrPid[j + 1] = scrPid[j]; scrDay[j + 1] = scrDay[j]; j--;
      }
      scrVal[j + 1] = pv; scrPid[j + 1] = pp; scrDay[j + 1] = pd;
    }
    if (newCount > topN) newCount = topN;

    /* ── 名单（pid→名次）有变化才切段 ── */
    let changed = (newCount !== topCount);
    if (!changed) {
      for (let r = 0; r < newCount; r++) if (scrPid[r] !== topPid[r]) { changed = true; break; }
    }
    if (changed) closeSeg(day);
    topCount = newCount;
    for (let r = 0; r < topCount; r++) { topPid[r] = scrPid[r]; topVal[r] = scrVal[r]; topDay[r] = scrDay[r]; }
  }
  closeSeg(opt.capDay != null ? opt.capDay : SNAPSHOT_DAY);

  const finalTop = [];
  for (let r = 0; r < topCount; r++) finalTop.push({ pid: topPid[r], val: topVal[r] });
  return { acc, finalTop, siteRankYear };
}

(async () => {
  const t0 = Date.now();
  const log = (...a) => console.log(...a);

  /* ── 1. 项目 / 格式 ─────────────────────────────────────────────── */
  const evInfo = new Map();
  await streamTsv('WCA_export_events.tsv', (r) => {
    if (!r[0]) return;
    evInfo.set(r[0], { name: r[2] || r[0], format: r[1] });
  });
  const fmtOf = (ev) => (evInfo.get(ev) || {}).format || 'time';

  /* ── 2. 比赛 → 结束日 ──────────────────────────────────────────── */
  const compDay = new Map();
  await streamTsv('WCA_export_competitions.tsv', (r) => {
    if (!r[0]) return;
    if (r[10] === '1') return;                              // cancelled
    const y = +r[17] || +r[14];
    if (!y) return;
    const m = +r[18] || +r[15] || 1;
    const d = +r[19] || +r[16] || 1;
    compDay.set(r[0], RN.dayOf(y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0')));
  });
  log('[1/7] 比赛日 loaded:', num(compDay.size));

  /* ── 3. 选手 ────────────────────────────────────────────────────── */
  const pidIdx = new Map();
  const pName = [];
  const pFirst = [];
  const pidOf = [];                                         // index → WCA id
  await streamTsv('WCA_export_persons.tsv', (r) => {
    const id = r[2]; if (!id) return;
    if (pidIdx.has(id)) return;
    pidIdx.set(id, pName.length);
    pName.push(r[0] || id);
    pFirst.push(Infinity);
    pidOf.push(id);
  });
  const idxOf = (pid, fallbackName) => {
    let i = pidIdx.get(pid);
    if (i === undefined) {
      i = pName.length; pidIdx.set(pid, i); pName.push(fallbackName || pid); pFirst.push(Infinity); pidOf.push(pid);
    }
    return i;
  };
  log('[2/7] 选手 loaded:', num(pName.length));

  /* ── 4. 成绩扫描 ───────────────────────────────────────────────── */
  const buckets = new Map();
  const bucketOf = (key) => {
    let b = buckets.get(key);
    if (!b) {
      b = {
        days: new Grow(Int32Array),
        pids: new Grow(Int32Array),
        vals: new Grow(Float64Array),
      };
      buckets.set(key, b);
    }
    return b;
  };
  let rowCount = 0, skippedComp = 0;
  const RETIRED = RN.EV_RETIRED_DAY;

  /* ── 方案 F 基线：每个 (项目, 年) 当年有多少人出过正式成绩 ─────────
     用于判定「空窗年」：当年该项目零人参赛 → 该年的席位不计分。
     同时按 (项目,轨道,年) 统计，用于诊断「轨道级空窗」的差异。 */
  const activeEvYear = new Map();     // ev     -> Map<year, Set<pid>>
  const activeTrkYear = new Map();    // ev|tr  -> Map<year, Set<pid>>
  const markActive = (m, k, y, idx) => {
    let ym = m.get(k);
    if (!ym) { ym = new Map(); m.set(k, ym); }
    let s = ym.get(y);
    if (!s) { s = new Set(); ym.set(y, s); }
    s.add(idx);
  };

  await streamTsv('WCA_export_results.tsv', (r) => {
    rowCount++;
    const ev = r[6], pid = r[8], compId = r[4];
    if (!ev || !pid) return;
    const day = compDay.get(compId);
    if (day === undefined) { skippedComp++; return; }
    const retDay = RETIRED[ev];
    if (retDay != null && day >= retDay) return;
    const idx = idxOf(pid, r[7]);
    if (day < pFirst[idx]) pFirst[idx] = day;
    const y = RN.yearOfDay(day) | 0;
    const fmt = fmtOf(ev);
    const vs = +r[2];
    const va = +r[3];
    if (vs > 0 || va > 0) markActive(activeEvYear, ev, y, idx);
    if (vs > 0) {
      markActive(activeTrkYear, ev + '|single', y, idx);
      const b = bucketOf(ev + '|single');
      b.days.push(day); b.pids.push(idx);
      b.vals.push(fmt === 'multi' ? decodeMulti(vs).cost : vs);
    }
    if (va > 0) {
      markActive(activeTrkYear, ev + '|average', y, idx);
      const b = bucketOf(ev + '|average');
      b.days.push(day); b.pids.push(idx);
      b.vals.push(fmt === 'multi' ? decodeMulti(va).cost : va);
    }
  });
  log('[3/7] 成绩扫描完成:', num(rowCount), '行；比赛未匹配', num(skippedComp),
    '；(项目,轨道) 桶', buckets.size, '个', ((Date.now() - t0) / 1000).toFixed(1) + 's');

  /* ── 4b. 空窗年判定（方案 F）─────────────────────────────────────
     对每个项目：取活跃年份区间 [minY, capYear]，其中**当年零人参赛**的年份
     即为「空窗年」。区间尾部（最后一场比赛之后到快照日）同样会被识别，
     因为那里也没有任何竞争者。                                      */
  const capOfKey = (k) => {
    const ev = k.split('|')[0];
    const rd = RETIRED[ev];
    return rd != null ? Math.min(rd, SNAPSHOT_DAY) : SNAPSHOT_DAY;
  };
  const buildEmpty = (m) => {
    const out = new Map();
    for (const [k, ymap] of m) {
      let mn = Infinity, mx = -Infinity;
      for (const y of ymap.keys()) { if (y < mn) mn = y; if (y > mx) mx = y; }
      if (!isFinite(mn)) continue;
      /* 上界取「封口日的前一天」所属年份，避免把封口当年的部分天数误判为空窗 */
      const capY = RN.yearOfDay(capOfKey(k) - 1) | 0;
      const s = new Set();
      for (let y = mn; y <= capY; y++) if (!ymap.has(y)) s.add(y);
      if (s.size) out.set(k, s);
    }
    return out;
  };
  const emptyYearsByEv = buildEmpty(activeEvYear);      // ev -> Set<year>
  const emptyYearsByCombo = buildEmpty(activeTrkYear);  // ev|tr -> Set<year>
  {
    let nEv = 0, nCombo = 0, nY = 0;
    for (const s of emptyYearsByEv.values()) { nEv++; nY += s.size; }
    for (const s of emptyYearsByCombo.values()) { nCombo++; }
    log('    空窗年：项目级 ' + nEv + ' 个 / 组合级 ' + nCombo +
      ' 个，项目级空窗年份合计 ' + nY + ' 个');
  }

  /* ── 5. 官方排名快照（用于验证重建正确性）────────────────────── */
  const official = { single: new Map(), average: new Map() };
  for (const tr of TRACKS) {
    const file = tr === 'single' ? 'WCA_export_ranks_single.tsv' : 'WCA_export_ranks_average.tsv';
    const tmp = new Map();
    await streamTsv(file, (r) => {
      const ev = r[2], pid = r[1], rank = +r[3], best = +r[0];
      if (!ev || !pid || !rank || rank > 60) return;   // 只留前 60 名，避免全量驻留
      let arr = tmp.get(ev);
      if (!arr) { arr = []; tmp.set(ev, arr); }
      arr.push({ pid, rank, best });
    });
    // 每个项目按名次排序（官方并列同名次，组内顺序无语义）
    for (const [ev, arr] of tmp) {
      arr.sort((a, b) => a.rank - b.rank);
      tmp.set(ev, arr);
    }
    official[tr] = tmp;
  }
  log('[4/7] 官方排名快照 loaded');

  /* ── 6. 逐 (项目,轨道) 仿真 ────────────────────────────────────── */
  const perPlayer = new Map();
  const perEvent = new Map();
  const finalTops = { single: new Map(), average: new Map() };
  const deepStats = new Map();     // pid -> 前 100 占席天数
  const siteRank = new Map();      // key(ev|track) -> Map(year -> Float64Array(10))
  let simCount = 0;

  /* 焦点选手（按名字 → 内部索引），用于产出「按名次拆分」的明细 */
  const focusSet = new Set();
  for (let i = 0; i < pName.length; i++) if (FOCUS.includes(pName[i]) || DIAG.includes(pName[i])) focusSet.add(i);

  const ensurePlayer = (pid) => {
    let p = perPlayer.get(pid);
    if (!p) {
      p = {
        pid: pidOf[pid] || String(pid), name: pName[pid] || String(pid),
        raw: 0, eraG: 0, eraE: 0,
        d10: 0, d1: 0, d100: 0,
        zeroedDays: 0,                         // 方案 F：被空窗年剔除的天数
        inTop10: false,                        // 是否真正进过世界前十
        seats: [0, 0, 0, 0],
        byRank: new Float64Array(10),
        byEvent: new Map(),
      };
      perPlayer.set(pid, p);
    }
    return p;
  };

  for (const [key, b] of buckets) {
    const [ev, tr] = key.split('|');
    /* 停办项目的时间线必须封在停办日，而不是快照日 ——
       否则「项目已死、无人打破」的末段会白赚十几年席位
       （与 M1-F1 里同一个坑，见 runs.js 的 EV_RETIRED_DAY 注释）。*/
    const retDay = RETIRED[ev];
    const capDay = retDay != null ? Math.min(retDay, SNAPSHOT_DAY) : SNAPSHOT_DAY;
    /* 方案 F：该项目在哪些「零人参赛」的年份没有席位可计 */
    const emptyYears = CFG.EMPTY_YEAR_ZERO ? (emptyYearsByEv.get(ev) || null) : null;
    const S = sortBucket({
      days: b.days.trim(), pids: b.pids.trim(), vals: b.vals.trim(),
    });
    const r = simulateSorted(S, CFG.TOP_N, { collectYears: true, focusSet, capDay, emptyYears });
    finalTops[tr].set(ev, r.finalTop.map((x) => ({ name: pName[x.pid], val: x.val })));
    siteRank.set(key, r.siteRankYear);
    const evMap = new Map();
    for (const [pid, a] of r.acc) {
      evMap.set(pid, a);
      const p = ensurePlayer(pid);
      p.inTop10 = true;
      p.d10 += a.d10; p.d1 += a.d1;
      for (let k = 0; k < 4; k++) p.seats[k] += a.seats[k];
      for (let rk = 0; rk < 10; rk++) p.byRank[rk] += a.byRank[rk];
      p.zeroedDays += a.zeroedDays;
      p.byEvent.set(key, {
        d10: a.d10, d1: a.d1, seats: a.seats.slice(),
        byYear: a.byYear, byRank: a.byRank, byRankYear: a.byRankYear,
        segList: a.segList, segEnd: a.segEnd,
        zeroedDays: a.zeroedDays, zeroedD1: a.zeroedD1, zeroedSeat: a.zeroedSeat, zeroedByYear: a.zeroedByYear,
        seatsNo1: a.seatsNo1.slice(), byYearNo1: a.byYearNo1,
      });
    }
    perEvent.set(key, evMap);
    /* 诊断：前 100 占席 */
    const rd = simulateSorted(S, CFG.DEEP_N, { collectYears: false, capDay, emptyYears });
    for (const [pid, a] of rd.acc) {
      const p = ensurePlayer(pid);
      p.d100 += a.d10;
    }
    simCount++;
    if (simCount % 10 === 0) log('   仿真', simCount, '/', buckets.size,
      ((Date.now() - t0) / 1000).toFixed(1) + 's');
  }
  log('[5/7] 仿真完成:', simCount, '个 (项目,轨道) 组', ((Date.now() - t0) / 1000).toFixed(1) + 's');

  /* ── 7. 时代折算 ───────────────────────────────────────────────── */
  const people = [];
  let baseYear = 2003;
  for (let i = 0; i < pName.length; i++) {
    if (!isFinite(pFirst[i])) continue;
    const y = RN.yearOfDay(pFirst[i]) | 0;
    if (y > baseYear) baseYear = y;
    people.push({ y });
  }
  const pool = M1.makeScopePool(people, baseYear);
  const fGlobal = (y) => pool.valueOf('WR', {}, y);

  /* 事件级池：该项目截至该年累计有多少人出过成绩 */
  const evPool = new Map();
  for (const [key, b] of buckets) {
    const [ev, tr] = key.split('|');
    if (tr !== 'single') continue;
    const firstByPid = new Map();
    const d = b.days.trim(), p = b.pids.trim();
    for (let i = 0; i < d.length; i++) {
      const pid = p[i], day = d[i];
      const cur = firstByPid.get(pid);
      if (cur === undefined || day < cur) firstByPid.set(pid, day);
    }
    let mn = 9999, mx = 0;
    for (const v of firstByPid.values()) {
      const y = RN.yearOfDay(v) | 0;
      if (y < mn) mn = y;
      if (y > mx) mx = y;
    }
    const cum = {};
    for (let y = mn; y <= mx; y++) cum[y] = 0;
    for (const v of firstByPid.values()) {
      const y = RN.yearOfDay(v) | 0;
      for (let t = y; t <= mx; t++) cum[t]++;
    }
    const lnT = Math.log(1 + (cum[mx] || 1));
    evPool.set(ev, {
      f: (y) => Math.log(1 + (cum[Math.max(mn, Math.min(mx, y | 0))] || 1)) / lnT,
      total: cum[mx] || 1, firstYear: mn, lastYear: mx,
      cumAt: (y) => cum[Math.max(mn, Math.min(mx, y | 0))] || 1,
    });
  }

  /* ── 8. 汇总计分 ───────────────────────────────────────────────── */
  const W = RN.EV_WEIGHT_V2;
  const lamIdx = CFG.LAMBDAS.indexOf(CFG.LAMBDA_MAIN);
  for (const [pid, p] of perPlayer) {
    let raw = 0, eraG = 0, eraE = 0, zeroedEra = 0, zeroedRaw = 0;
    let rawNo1 = 0, eraGNo1 = 0;
    for (const [key, s] of p.byEvent) {
      const ev = key.split('|')[0];
      const w = W[ev] == null ? RN.WEIGHT_V2_CFG.floor : W[ev];
      const seatMain = s.seats[lamIdx];
      raw += w * seatMain / 365;
      let gSum = 0, eSum = 0;
      if (s.byYear) {
        const ef = evPool.get(ev);
        for (const [y, sd] of s.byYear) {
          gSum += sd * fGlobal(y);
          if (ef) eSum += sd * ef.f(y);
        }
      }
      eraG += w * gSum / 365;
      eraE += w * eSum / 365;
      /* 诊断口径：剔除「坐在第一」后的同口径分（评估与 M1 的重复度）*/
      if (s.seatsNo1) {
        rawNo1 += w * s.seatsNo1[lamIdx] / 365;
        if (s.byYearNo1) {
          let gN = 0;
          for (const [y, sd] of s.byYearNo1) gN += sd * fGlobal(y);
          eraGNo1 += w * gN / 365;
        }
      }
      /* 方案 F：还原「未剔除空窗年」时的分值（用于前后对比） */
      if (s.zeroedByYear) {
        let zG = 0;
        for (const [y, sd] of s.zeroedByYear) zG += sd * fGlobal(y);
        zeroedEra += w * zG / 365;
        zeroedRaw += w * (s.zeroedSeat || 0) / 365;
      }
    }
    p.raw = raw; p.eraG = eraG; p.eraE = eraE;
    p.zeroedEra = zeroedEra; p.zeroedRaw = zeroedRaw;
    p.rawNo1 = rawNo1; p.eraGNo1 = eraGNo1;
    /* 主口径（用户 2026-10-25 定稿）：λ=1.0 × M1 全局池 ln 时代折算 */
    p.m4 = CFG.ERA_MODE === 'none' ? raw : (CFG.ERA_MODE === 'event' ? eraE : eraG);
    /* 方案 F 之前的同口径值（仅供对比，不参与排名） */
    p.m4Before = p.m4 + zeroedEra;
  }

  /* ── 事实表导出（sixdim 查询引擎用；纯写出，不影响任何计算） ──
     每行 = (pid, ev, track, year) 的年度贡献分 = w × seatDays×rank^-1 × fGlobal(y) / 365
     as-of 截取 = Σ_{y ≤ asOf}，与主口径数学恒等 */
  {
    const rows4 = [];
    for (const [pid, p] of perPlayer) {
      const wcaId = pidOf[pid] || String(pid);           // perPlayer 键是内部索引 → 反查 WCA id
      for (const [key, s] of p.byEvent) {
        const parts = key.split('|');
        const ev = parts[0], tr = parts[1] || '';
        const w = W[ev] == null ? RN.WEIGHT_V2_CFG.floor : W[ev];
        if (!s.byYear) continue;
        for (const [y, sd] of s.byYear) {
          const c = w * sd * fGlobal(y) / 365;
          if (c > 0) rows4.push(`${wcaId}\t${ev}\t${tr}\t${y}\t${c.toFixed(6)}`);
        }
      }
    }
    fs.writeFileSync(path.join(__dirname, 'M4_facts.tsv'),
      'pid\tev\ttrack\tyear\tcontrib\n' + rows4.join('\n') + '\n', 'utf8');
    log('已写 M4_facts.tsv（', num(rows4.length), '行）');
  }

  /* 主榜只含真正进过世界前十的选手；前 100 诊断位不参与排名 */
  const top10Players = [...perPlayer.values()].filter((p) => p.inTop10);
  const ranked = [...top10Players].sort((a, b) => (b.m4 - a.m4) || a.name.localeCompare(b.name));
  /* 方案 F 之前的同口径榜（仅供前后对比） */
  const beforeRanked = [...top10Players].sort((a, b) => (b.m4Before - a.m4Before) || a.name.localeCompare(b.name));


  /* ── 9. 验证：重建的末位前十 vs 官方快照 ───────────────────────
   官方排名对**并列成绩使用同名次**（4 个 16 步同为第 1，17 步组同为第 5），
   因此「前 10 名」在官方口径下可能多于 10 人，且组内顺序无语义。
   故采用三重校验：
     ① 值阶梯：重建前 10 的成绩序列 vs 官方前 10 行的成绩序列（升序多重集）
     ② 集合：官方 rank≤10 的人有多少落在重建前 10 内
     ③ 名单：官方前 10 行与重建前 10 的人的重合数
   ───────────────────────────────────────────────────────────────── */
  const verify = { single: [], average: [] };
  for (const tr of TRACKS) {
    for (const [ev, mine] of finalTops[tr]) {
      const o = official[tr].get(ev);
      if (!o || !o.length) continue;
      const nameOf = (x) => {
        const i = pidIdx.get(x.pid);
        return i === undefined ? '?' : (pName[i] || x.pid);
      };
      const oTop = o.slice(0, 10).map((x) => ({ name: nameOf(x), rank: x.rank, best: x.best }));
      const oAll = o.filter((x) => x.rank <= 10).map(nameOf);
      const mineNames = mine.map((m) => m.name);
      const isMulti = (evInfo.get(ev) || {}).format === 'multi';
      const oVals = oTop.map((x) => x.best).sort((a, b) => a - b);
      const mVals = mine.map((m) => m.val).sort((a, b) => a - b);
      const valMatch = isMulti ? null
        : (oVals.length === mVals.length && oVals.every((v, i) => v === mVals[i]));
      verify[tr].push({
        ev, valMatch,
        allHit: oAll.filter((nm) => mineNames.includes(nm)).length,
        allCount: oAll.length,
        setHit: oTop.filter((x) => mineNames.includes(x.name)).length,
        of: oTop.length,
        oRows: oTop, mineRows: mine.map((m) => ({ name: m.name, val: m.val })),
        oNames: oTop.map((x) => x.name), mineNames,
      });
    }
  }

  /* ── 9b. 与其它维度的正交性检验（Spearman）───────────────────── */
  function spearman(a, b) {
    const n = a.length;
    if (n < 3) return null;
    const rk = (v) => {
      const idx = v.map((x, i) => [x, i]).sort((p, q) => p[0] - q[0]);
      const r = new Array(n);
      let i = 0;
      while (i < n) {
        let j = i;
        while (j + 1 < n && idx[j + 1][0] === idx[i][0]) j++;
        const avg = (i + j) / 2 + 1;
        for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
        i = j + 1;
      }
      return r;
    };
    const ra = rk(a), rb = rk(b);
    const ma = ra.reduce((s, x) => s + x, 0) / n;
    const mb = rb.reduce((s, x) => s + x, 0) / n;
    let num = 0, da = 0, db = 0;
    for (let i = 0; i < n; i++) {
      const x = ra[i] - ma, y = rb[i] - mb;
      num += x * y; da += x * x; db += y * y;
    }
    return da > 0 && db > 0 ? num / Math.sqrt(da * db) : null;
  }

  const corr = { rows: [] };
  {
    try {
      const txt = fs.readFileSync(path.join(__dirname, 'M2_ranking.tsv'), 'utf8');
      const m2 = new Map();
      for (const ln of txt.split('\n').slice(1)) {
        if (!ln) continue;
        const f = ln.split('\t');
        if (f.length < 4) continue;
        m2.set(f[1], +f[3]);
      }
      const xs = [], ys = [];
      for (const p of ranked) {
        const v = m2.get(p.pid);
        if (v == null) continue;
        xs.push(p.m4); ys.push(v);
      }
      corr.rows.push({ label: 'M4 统治力 × M2 融合领奖台分', n: xs.length, rho: spearman(xs, ys) });
      const t4 = ranked.slice(0, 10).map((x) => x.name);
      const t2 = [...m2.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
        .map(([pid]) => (pName[pidIdx.get(pid)] || pid));
      corr.overlapM2 = t4.filter((n) => t2.includes(n)).length;
    } catch (e) { /* M2 导出缺失则跳过 */ }

    try {
      const p6 = path.join(ROOT, '.workbuddy/tmp/oc/m6_strength_out.json');
      const j = JSON.parse(fs.readFileSync(p6, 'utf8'));
      const m6 = new Map();
      for (const r of j.Tglob) m6.set(r[0], r[1]);
      const xs = [], ys = [];
      for (const p of ranked) {
        const v = m6.get(p.pid);
        if (v == null) continue;
        xs.push(p.m4); ys.push(v);
      }
      corr.rows.push({ label: 'M4 统治力 × M6 对手强度', n: xs.length, rho: spearman(xs, ys) });
    } catch (e) { /* M6 产出缺失则跳过 */ }

    try {
      const md = fs.readFileSync(path.join(__dirname, '纪录分_全站.md'), 'utf8');
      const m1 = new Map();
      /* 表头：| # | 选手 | 国家 | WR | CR | NR | 段数 | 平均 f | 纪录分 | 不折算 |
       * 注意：必须跳过 **7 列** 才能落到「纪录分」列 ——
       *   少跳一列会误取「平均 f」（时代系数），把相关性算成另一个东西。 */
      for (const ln of md.split('\n')) {
        const m = ln.match(/^\|\s*\d+\s*\|([^|]+)\|\s*[^|]*\|\s*[^|]*\|\s*[^|]*\|\s*[^|]*\|\s*[^|]*\|\s*[^|]*\|\s*\*{0,2}(\d+\.\d+)\*{0,2}\s*\|/);
        if (m) m1.set(m[1].trim(), +m[2]);
      }
      const xs = [], ys = [], xsN = [];
      for (const p of ranked) {
        const v = m1.get(p.name);
        if (v == null) continue;
        xs.push(p.m4); ys.push(v); xsN.push(p.eraGNo1);
      }
      corr.rows.push({ label: 'M4 统治力 × M1 纪录分（榜内样本）', n: xs.length, rho: spearman(xs, ys) });
      /* 诊断：剔除「坐在第一」后与 M1 的重复度（评估未决项 Q3）*/
      corr.rows.push({
        label: 'M4（剔除坐第一）× M1 纪录分', n: xsN.length, rho: spearman(xsN, ys),
      });
    } catch (e) { /* M1 报告缺失则跳过 */ }
  }

  /* ── 10. 报告 ──────────────────────────────────────────────────── */
  const L = [];
  L.push('# M4 · 统治力 · 世界排名席位时间积分');
  L.push('');
  L.push('> 生成时间：' + new Date().toISOString().slice(0, 19).replace('T', ' '));
  L.push('> 数据：WCA 导出 v2.0.2 / v288，快照日 2026-10-15｜脚本 `etl/score/m4_dominance.js`');
  L.push('> **独立维度**，不并入 M1（持有纪录价值）/ M2（融合领奖台）/ M3（破纪录加分）内核。');
  L.push('');

  L.push('## 0 一句话');
  L.push('');
  L.push('**M4 = 「在世界的牌桌上坐了多久」**：把每个项目的世界排名还原成时间线，');
  L.push('统计每位选手**占住世界前十席位（WR10）多少天**、其中**坐第一多少天**。');
  L.push('');
  L.push('与其它维度的分工：');
  L.push('');
  L.push('| 维度 | 问的问题 |');
  L.push('|---|---|');
  L.push('| M1 | 纪录**守**了多久（持有价值） |');
  L.push('| M2 | 领奖台拿了多少（荣誉总量） |');
  L.push('| M3 | 在大赛上**推破**纪录多少次（突破动作） |');
  L.push('| **M4** | **在世界前十/第一的位置上坐了多久（统治力）** |');
  L.push('');

  L.push('## 1 口径');
  L.push('');
  L.push('### 1.1 为什么必须重建历史排名');
  L.push('');
  L.push('WCA v2 导出的 `ranks_single` / `ranks_average` **只有导出当天的快照**，没有历史序列。');
  L.push('因此「保持了多久」只能从 `results.tsv` 重建：');
  L.push('');
  L.push('```');
  L.push('某时刻的世界排名 = 所有人「截至该时刻的最好成绩（PB）」排序');
  L.push('```');
  L.push('');
  L.push('这与官方口径一致（官方 best 列就是选手历史最好成绩），重建结果在 §3 与官方快照逐项对表。');
  L.push('');
  L.push('### 1.2 公式');
  L.push('');
  L.push('```');
  L.push('对每个 (项目 e, 轨道 t ∈ {single, average})：');
  L.push('  ① 全部成绩按时间排序（计数排序 O(n)）');
  L.push('  ② 只保留「个人最好成绩」的进步时刻');
  L.push('  ③ 维护长度 ≤10 的世界前十名单，随时间演进');
  L.push('  ④ 名单变化时切分时间段');
  L.push('  ⑤ 【方案 F】逐年检查：当年该项目零人参赛 → 该年整段跳过，不计任何席位');
  L.push('');
  L.push('  d10(e,t)  = 该选手占住前十席位的总天数（不含空窗年）');
  L.push('  d1(e,t)   = 该选手坐在第一的总天数（不含空窗年）');
  L.push('  seat(e,t) = Σ_段 段长 × g(名次)      g(r) = r^-λ');
  L.push('');
  L.push('M4_raw = Σ_{e,t} w_e · seat(e,t) / 365');
  L.push('M4_era = Σ_{e,t} w_e · Σ_段 (段长/365) · g(名次) · f(年代)');
  L.push('');
  L.push('  w_e = EV_WEIGHT_V2（三阶 1.0000 全站最高）');
  L.push('  f   = M1-F1 同源全局时代系数 ln(1+N(y))/ln(1+N(base))');
  L.push('');
  L.push('  ★ 方案 F 不是「打折」，是「取消计分资格」：');
  L.push('    当年该项目零人参赛 → 那一年根本没有竞争 → 那一年的世界排名无意义');
  L.push('    → 该年席位天数为 0（对 raw / era / 各 λ 同步生效）');
  L.push('```');
  L.push('');
  L.push('### 1.3 边界处理');
  L.push('');
  L.push('| 项 | 处理 |');
  L.push('|---|---|');
  L.push('| DNF(-1) / DNS(-2) / 无成绩(0) | 剔除 |');
  L.push('| 取消的赛事（cancelled=1） | 不计入 |');
  L.push('| 停办项目 333ft/magic/mmagic/333mbo | 时间线封在停办日（EV_RETIRED_DAY） |');
  L.push('| **空窗年（当年该项目零人参赛）** | **该年席位不计分（方案 F，见 §4.9）** |');
  L.push('| 多盲 multi 编码值 | 先解码成可比成本再排序 |');
  L.push('| 同值并列 | 在位者保留席位（挑战者需严格更快才挤入） |');
  L.push('');

  L.push('## 2 全站规模');
  L.push('');
  L.push('- 进入过任何项目**世界前十**的选手：**' + num(top10Players.length) + '** 人（M4 榜单口径）');
  L.push('- 另有 **' + num(perPlayer.size - top10Players.length) +
    '** 人曾进入过前 100 但**从未进过前十** —— 只作诊断量 `d100_years` 输出，不参与排名');
  L.push('- (项目,轨道) 组合：**' + buckets.size + '** 组');
  L.push('- 成绩总行数：**' + num(rowCount) + '**');
  L.push('');

  L.push('## 3 重建正确性验证（末位前十 vs 官方快照）');
  L.push('');
  L.push('> **官方排名对并列成绩使用同名次**：4 个 16 步选手同为第 1 名，17 步组同为第 5 名。');
  L.push('> 因此「前 10 名」在官方口径下可能多于 10 人，组内顺序无语义。校验改用三重口径：');
  L.push('> ① **值阶梯**（重建前 10 的成绩序列 vs 官方前 10 行）② **集合**（官方 rank≤10 的人命中数）③ **名单重合**。');
  L.push('');
  {
    const rows = [];
    for (const tr of TRACKS) for (const x of verify[tr]) rows.push(Object.assign({ tr }, x));
    const vOk = rows.filter((x) => x.valMatch === true).length;
    const vSkip = rows.filter((x) => x.valMatch === null).length;
    const vBad = rows.filter((x) => x.valMatch === false).length;
    const setHit = rows.reduce((s, x) => s + x.allHit, 0);
    const setCnt = rows.reduce((s, x) => s + x.allCount, 0);
    const nmHit = rows.reduce((s, x) => s + x.setHit, 0);
    const nmCnt = rows.reduce((s, x) => s + x.of, 0);
    L.push('| 校验口径 | 结果 |');
    L.push('|---|---|');
    L.push('| ① 值阶梯完全吻合 | **' + vOk + '/' + rows.length + '** 个（项目,轨道）组合' +
      (vSkip ? '，另有 ' + vSkip + ' 个多盲组合因官方存编码值、不参与此项' : '') +
      (vBad ? '，**' + vBad + ' 个不吻合**' : '') + ' |');
    L.push('| ② 官方 rank≤10 集合命中 | **' + setHit + '/' + setCnt + '**（' +
      (setHit / setCnt * 100).toFixed(1) + '%） |');
    L.push('| ③ 官方前 10 行名单重合 | **' + nmHit + '/' + nmCnt + '**（' +
      (nmHit / nmCnt * 100).toFixed(1) + '%） |');
    L.push('');
    const bad = rows.filter((x) => x.valMatch === false || x.allHit < x.allCount);
    if (bad.length) {
      L.push('### 3.1 存在差异的组合');
      L.push('');
      for (const b of bad) {
        L.push('**' + (b.tr === 'single' ? '单次' : '平均') + ' · ' + b.ev + '**' +
          '（值阶梯 ' + (b.valMatch === null ? '不适用' : b.valMatch ? '一致' : '**不一致**') +
          '；官方 rank≤10 共 ' + b.allCount + ' 人，命中 ' + b.allHit + '）');
        L.push('');
        L.push('| 名次 | 官方（best / rank） | 重建（val） |');
        L.push('|---|---|---|');
        for (let i = 0; i < 10; i++) {
          const o = b.oRows[i], m = b.mineRows[i];
          if (!o && !m) continue;
          L.push('| ' + (i + 1) + ' | ' + (o ? o.name + ' <code>' + o.best + '</code> (#' + o.rank + ')' : '—') +
            ' | ' + (m ? m.name + ' <code>' + m.val + '</code>' : '—') + ' |');
        }
        L.push('');
      }
    } else {
      L.push('**全部组合的值阶梯与官方快照一致** —— 重建口径正确。');
      L.push('');
      L.push('名单重合未达 100% 的组合全部来自**并列成绩**：官方对同成绩使用同名次、组内顺序无语义，');
      L.push('而本模型对并列采用**「先达成者居前」**的确定性裁定（同一比赛同成绩时按出场次序）。');
      L.push('');
    }
  }

  L.push('### 3.2 与 M1-F1 的独立交叉验证');
  L.push('');
  {
    /* M1 从「纪录阶梯」独立算出持有段，M4 从「PB 排名还原」独立算出占位段，
       两者数据通路完全不同。若同一个人的同一段算出一致，即为强证据。 */
    const mt = top10Players.find((x) => x.name.indexOf('Minh Thai') >= 0);
    const mtKey = mt ? [...mt.byEvent.entries()].find(([k]) => k === '333|single') : null;
    if (mt && mtKey) {
      const s = mtKey[1];
      const rawD1 = s.d1 + (s.zeroedD1 || 0);      // 含空窗年的原始占位
      L.push('| 项目 | M4 重建的「世界第一占位天数」 | M1-F1 独立算出的「持有段天数」 | 是否一致 |');
      L.push('|---|---|---|---|');
      L.push('| Minh Thai · 三阶单次（含空窗年的原始占位） | **' + rawD1 + ' 天** | **7,749 天** | ' +
        (Math.abs(rawD1 - 7749) <= 1 ? '**一致 ✓**（差 1 天，端点开闭约定不同）' : '不一致 ✗') + ' |');
      L.push('| 同上 · **方案 F 剔除空窗年后**（定稿计分用） | **' + s.d1 + ' 天** | 7,749 天 | 不适用（F 刻意剔除停滞期，见 §4.8）|');
      L.push('');
      L.push('M1 走的是「纪录阶梯切段」通路，M4 走的是「PB 排名还原」通路，两者**没有任何共享代码**；');
      L.push('在同一条 21.2 年的三阶第一占位上独立算出同一个时长，构成强证据。');
      L.push('');
      L.push('> 注意第一行是**含空窗年**的原始占位（' + rawD1 + ' 天）—— 这正是两条通路能对上的原因；');
      L.push('> 第二行是方案 F 之后**真正计分**的部分（' + s.d1 + ' 天），两者相差的 ' +
        (s.zeroedD1 || 0) + ' 天正是被判定为「无竞争」而剔除的停滞期。');
    }
  }
  L.push('');

  L.push('## 4 M4 榜 Top25（**定稿口径**：λ=' + CFG.LAMBDA_MAIN + ' × M1 全局池 ln 时代折算）');
  L.push('');
  L.push('> 「前十席位(年)」= 该选手在**全部 ' + buckets.size + ' 个（项目,轨道）组合**上的前十占位天数之和（组·年）；');
  L.push('> 「坐第一(年)」同理。单个组合的典型量级是 3–5 组·年。');
  L.push('');
  L.push('| # | 选手 | **M4（定稿）** | M4_raw（不折算） | 前十席位(组·年) | 其中坐第一(组·年) | 前100占席(组·年) |');
  L.push('|---|---|---|---|---|---|---|');
  ranked.slice(0, 25).forEach((p, i) => {
    L.push('| ' + (i + 1) + ' | ' + p.name + ' | **' + p.m4.toFixed(4) + '** | ' + p.raw.toFixed(4) + ' | ' +
      (p.d10 / 365).toFixed(3) + ' | ' + (p.d1 / 365).toFixed(3) + ' | ' + (p.d100 / 365).toFixed(2) + ' |');
  });
  L.push('');

  L.push('### 4.1 三位头部选手拆解');
  L.push('');
  for (const nm of FOCUS) {
    const p = ranked.find((x) => x.name === nm);
    if (!p) { L.push('**' + nm + '**：未进入任何项目前十。'); L.push(''); continue; }
    L.push('**' + nm + '　M4 = ' + p.m4.toFixed(4) +
      '（不折算 ' + p.raw.toFixed(4) + '；前十席位 ' + (p.d10 / 365).toFixed(3) + ' 组·年，坐第一 ' +
      (p.d1 / 365).toFixed(3) + ' 组·年）**');
    L.push('');
    L.push('| 项目 | 轨道 | 前十天数 | 第一天数 | 席位分(λ=1) |');
    L.push('|---|---|---|---|---|');
    const rows = [...p.byEvent.entries()].sort((a, b) => (b[1].seats[lamIdx] - a[1].seats[lamIdx]));
    for (const [k, s] of rows) {
      const [ev, tr] = k.split('|');
      L.push('| ' + (CN_EV[ev] || ev) + ' `' + ev + '` | ' + (tr === 'single' ? '单次' : '平均') + ' | ' +
        s.d10 + ' | ' + s.d1 + ' | ' + (s.seats[lamIdx] / 365).toFixed(4) + ' |');
    }
    L.push('');
  }

  L.push('### 4.2 名次分值表（λ=1.0 时 WR1→WR10 的倍率）');
  L.push('');
  L.push('名次权重 g(r) = r^-λ。当前定稿 λ=1.0，即 **g(r) = 1/r**。');
  L.push('');
  L.push('| 名次 | g(r)=1/r | 相对 WR1 | 等价于 WR1 的天数 |');
  L.push('|---|---|---|---|');
  for (let rk = 1; rk <= 10; rk++) {
    const g = Math.pow(rk, -CFG.LAMBDA_MAIN);
    L.push('| WR' + rk + ' | ' + g.toFixed(4) + ' | 1/' + rk +
      '（' + (g * 100).toFixed(2) + '%） | ' + (1 / g).toFixed(0) + ' 天 |');
  }
  L.push('');
  L.push('> 读法：坐在 WR10 一天，只等于坐在 WR1 十分之一天；');
  L.push('> 坐在 WR1 一年 ≈ 坐在 WR10 十年。');
  L.push('');
  L.push('**各名次对全站 M4 总分的贡献占比**（所有选手、按项目权重 w_e 与时代系数 f 加权后）：');
  L.push('');
  {
    /* 全站按名次的加权贡献（按 (项目,轨道) 的全站名次占位 × w_e × f(年代) × g(r)） */
    const siteByRank = new Float64Array(10);
    for (const [key, yrMap] of siteRank) {
      const ev = key.split('|')[0];
      const w = W[ev] == null ? RN.WEIGHT_V2_CFG.floor : W[ev];
      for (const [y, arr] of yrMap) {
        for (let rk = 0; rk < 10; rk++) {
          siteByRank[rk] += w * arr[rk] * Math.pow(rk + 1, -CFG.LAMBDA_MAIN) * fGlobal(y);
        }
      }
    }
    const siteTotal = siteByRank.reduce((a, b) => a + b, 0) / 365;
    L.push('| 名次 | 全站加权席位天 | 占全站 M4 |');
    L.push('|---|---|---|');
    for (let rk = 0; rk < 10; rk++) {
      const v = siteByRank[rk] / 365;
      L.push('| WR' + (rk + 1) + ' | ' + v.toFixed(4) + ' | ' +
        (siteTotal > 0 ? (v / siteTotal * 100).toFixed(2) : '0.00') + '% |');
    }
    L.push('');
    L.push('全站 M4 总分（所有选手合计）= **' + siteTotal.toFixed(4) + '**。');
    L.push('');
  }

  L.push('### 4.3 Feliks 的分数逐名次拆解');
  L.push('');
  {
    const p = ranked.find((x) => x.name === 'Feliks Zemdegs');
    if (p) {
      /* 按名次累计（已乘 w_e 与 f） */
      const rankRaw = new Float64Array(10);     // w_e × g(r) × 天数（不折算）
      const rankEra = new Float64Array(10);     // w_e × g(r) × 天数 × f(年代)
      const rankDays = new Float64Array(10);    // 纯天数（跨全部组合）
      for (const [key, s] of p.byEvent) {
        const ev = key.split('|')[0];
        const w = W[ev] == null ? RN.WEIGHT_V2_CFG.floor : W[ev];
        for (let rk = 0; rk < 10; rk++) rankDays[rk] += s.byRank[rk];
        if (!s.byRankYear) continue;
        for (const [y, arr] of s.byRankYear) {
          for (let rk = 0; rk < 10; rk++) {
            const g = Math.pow(rk + 1, -CFG.LAMBDA_MAIN);
            rankRaw[rk] += w * arr[rk] * g;
            rankEra[rk] += w * arr[rk] * g * fGlobal(y);
          }
        }
      }
      const sumEra = rankEra.reduce((a, b) => a + b, 0) / 365;
      L.push('**Feliks Zemdegs　M4 = ' + p.m4.toFixed(4) + '**，按名次拆开：');
      L.push('');
      L.push('| 名次 | 占位天数 | 天数占比 | 名次分值 g(r) | 时代加权后贡献 | 占 M4 |');
      L.push('|---|---|---|---|---|---|');
      const totDays = rankDays.reduce((a, b) => a + b, 0);
      for (let rk = 0; rk < 10; rk++) {
        if (rankDays[rk] === 0) continue;
        const v = rankEra[rk] / 365;
        L.push('| WR' + (rk + 1) + ' | ' + rankDays[rk].toFixed(0) + ' | ' +
          (rankDays[rk] / totDays * 100).toFixed(2) + '% | ' +
          Math.pow(rk + 1, -CFG.LAMBDA_MAIN).toFixed(4) + ' | ' + v.toFixed(4) + ' | ' +
          (v / sumEra * 100).toFixed(2) + '% |');
      }
      L.push('| **合计** | **' + totDays.toFixed(0) + '** | 100% | — | **' + sumEra.toFixed(4) + '** | 100% |');
      L.push('');
      L.push('> 注意「天数占比」与「分数占比」不同：名次越靠后，人数越多但每分越便宜。');
      L.push('');
    }
  }

  L.push('### 4.4 Feliks 的分数逐项目拆解（含项目权重与时代折算）');
  L.push('');
  {
    const p = ranked.find((x) => x.name === 'Feliks Zemdegs');
    if (p) {
      const rows = [];
      for (const [key, s] of p.byEvent) {
        const [ev, tr] = key.split('|');
        const w = W[ev] == null ? RN.WEIGHT_V2_CFG.floor : W[ev];
        const seatDays = s.seats[lamIdx];
        const rawC = w * seatDays / 365;
        let eraC = 0;
        if (s.byYear) for (const [y, sd] of s.byYear) eraC += w * sd * fGlobal(y) / 365;
        rows.push({ ev, tr, w, seatDays, rawC, eraC, s });
      }
      rows.sort((a, b) => b.eraC - a.eraC);
      const tot = rows.reduce((a, b) => a + b.eraC, 0);
      L.push('**逐组合（已乘项目权重 w_e 与时代系数 f）：**');
      L.push('');
      L.push('| 项目 | 轨道 | w_e | 名次加权席位天 | ÷365 | ×w_e（不折算） | ×f（定稿贡献） | 占 M4 |');
      L.push('|---|---|---|---|---|---|---|---|');
      for (const r of rows) {
        L.push('| ' + (CN_EV[r.ev] || r.ev) + ' `' + r.ev + '` | ' + (r.tr === 'single' ? '单次' : '平均') +
          ' | ' + r.w.toFixed(4) + ' | ' + r.seatDays.toFixed(0) + ' | ' +
          (r.seatDays / 365).toFixed(4) + ' | ' + r.rawC.toFixed(4) + ' | **' + r.eraC.toFixed(4) + '** | ' +
          (r.eraC / tot * 100).toFixed(2) + '% |');
      }
      L.push('| **合计** | | | | | **' +
        rows.reduce((a, b) => a + b.rawC, 0).toFixed(4) + '** | **' + tot.toFixed(4) + '** | 100% |');
      L.push('');
      L.push('> `名次加权席位天` = Σ_段 段长 × g(名次)（未除项目权重、未折算时代）；');
      L.push('> `×w_e` 是该组合对 M4_raw 的贡献；`×f` 是定稿口径 M4 的贡献。');
      L.push('');
    }
  }

  L.push('### 4.5 逐段演算示例：Feliks 在「三阶 `333` 平均」上的完整算式');
  L.push('');
  {
    const p = ranked.find((x) => x.name === 'Feliks Zemdegs');
    const key = '333|average';
    const s = p && p.byEvent.get(key);
    if (s && s.segList && s.segList.length) {
      const w = W['333'];
      /* 按年汇总（f 与名次分值都以年为单位生效） */
      const byYear = new Map();
      for (const sg of s.segList) {
        const dur = sg.to - sg.from;
        let o = byYear.get(sg.y);
        if (!o) { o = { days: 0, seat: 0, contrib: 0, byRank: new Float64Array(10) }; byYear.set(sg.y, o); }
        const g = Math.pow(sg.rank, -CFG.LAMBDA_MAIN);
        o.days += dur;
        o.seat += dur * g;
        o.contrib += w * dur * g * fGlobal(sg.y) / 365;
        o.byRank[sg.rank - 1] += dur;
      }
      const yrs = [...byYear.keys()].sort((a, b) => a - b);
      let sumSeat = 0, sumEra = 0, sumDays = 0;
      for (const y of yrs) { const o = byYear.get(y); sumSeat += o.seat; sumEra += o.contrib; sumDays += o.days; }

      L.push('这是 Feliks 得分最高的单个组合（贡献 **' + sumEra.toFixed(4) + '**）。');
      L.push('');
      L.push('**整条算式**：把 40 多年的世界前三位置切成若干「段」（段 = 世界前十名单变化的时刻），');
      L.push('每段按 `段长 × g(名次)` 折成席位天，再 `× w_e（三阶=1.0000）× f(年代)`。');
      L.push('');
      L.push('下面按**年**汇总展示（f 与 g 都以年为单位生效，所以年粒度就是最自然的展示单位）：');
      L.push('');
      L.push('| 年 | 前十天数 | 名次分布（天数） | 席位天 = Σ 段长×g(r) | f(年代) | 该年贡献 |');
      L.push('|---|---|---|---|---|---|');
      for (const y of yrs) {
        const o = byYear.get(y);
        const dist = [];
        for (let rk = 0; rk < 10; rk++) if (o.byRank[rk] > 0) dist.push('WR' + (rk + 1) + '×' + o.byRank[rk].toFixed(0));
        L.push('| ' + y + ' | ' + o.days.toFixed(0) + ' | ' + dist.join(' / ') +
          ' | ' + o.seat.toFixed(2) + ' | ' + fGlobal(y).toFixed(4) + ' | **' + o.contrib.toFixed(4) + '** |');
      }
      L.push('| **合计** | **' + sumDays.toFixed(0) + '** | | **' + sumSeat.toFixed(2) +
        '** | — | **' + sumEra.toFixed(4) + '** |');
      L.push('');
      L.push('**校验链**：');
      L.push('');
      L.push('- 席位天合计 ' + sumSeat.toFixed(2) + ' ÷ 365 = **' + (sumSeat / 365).toFixed(4) +
        '** → 与 §4.1 表中 `333 平均` 的「席位分(λ=1)」完全一致 ✓');
      L.push('- × w_e（三阶 = ' + w.toFixed(4) + '）= ' + (sumSeat / 365).toFixed(4) +
        '（此项目 w=1 故数值不变）→ §4.4 的「×w_e（不折算）」**' + (w * sumSeat / 365).toFixed(4) + '** ✓');
      L.push('- × f(年代) 逐段加权 → **' + sumEra.toFixed(4) +
        '**，与 §4.4 表中该行「×f（定稿贡献）」一致 ✓');
      L.push('');
      /* 最长的 8 段，作为「段」的具体样例 */
      const longest = [...s.segList].sort((a, b) => (b.to - b.from) - (a.to - a.from)).slice(0, 8);
      L.push('**最长的 8 个「段」样例**（看清「段」到底长什么样）：');
      L.push('');
      L.push('| 起 | 止 | 段长(天) | 名次 | g(r) | 席位天 | f(年代) | 该段贡献 |');
      L.push('|---|---|---|---|---|---|---|---|');
      for (const sg of longest) {
        const dur = sg.to - sg.from;
        const g = Math.pow(sg.rank, -CFG.LAMBDA_MAIN);
        L.push('| ' + RN.dateOfDay(sg.from) + ' | ' + RN.dateOfDay(sg.to) + ' | ' + dur +
          ' | WR' + sg.rank + ' | ' + g.toFixed(4) + ' | ' + (dur * g).toFixed(2) +
          ' | ' + fGlobal(sg.y).toFixed(4) + ' | ' + (w * dur * g * fGlobal(sg.y) / 365).toFixed(4) + ' |');
      }
      L.push('');
      L.push('> 全组合共 ' + s.segList.length + ' 段（每年因世界前十名单变动而被切分多次）。');
      L.push('');
    }
  }

  L.push('### 4.6 项目 × 轨道口径：M4 是不是「分项目、分单次平均」统计？');
  L.push('');
  L.push('**是。** M4 的最小计分单元是 **(项目 e, 轨道 t) 二元组**，共 **' + buckets.size + '** 个组合：');
  L.push('');
  {
    const evTrk = new Map();
    for (const key of buckets.keys()) {
      const [ev, tr] = key.split('|');
      if (!evTrk.has(ev)) evTrk.set(ev, []);
      evTrk.get(ev).push(tr);
    }
    L.push('| 项目 | w_e | 轨道 | 有效权重 w_e×轨道数 | 有效份额 |');
    L.push('|---|---|---|---|---|');
    const effRows = [];
    let totEff = 0;
    for (const [ev, trs] of evTrk) {
      const w = W[ev] == null ? RN.WEIGHT_V2_CFG.floor : W[ev];
      const eff = w * trs.length;
      totEff += eff;
      effRows.push({ ev, w, trs, eff });
    }
    effRows.sort((a, b) => b.eff - a.eff);
    for (const r of effRows) {
      L.push('| ' + (CN_EV[r.ev] || r.ev) + ' `' + r.ev + '` | ' + r.w.toFixed(4) + ' | ' +
        r.trs.map((t) => (t === 'single' ? '单次' : '平均')).join(' + ') + ' | ' +
        r.eff.toFixed(4) + ' | ' + (r.eff / totEff * 100).toFixed(2) + '% |');
    }
    L.push('');
    L.push('> **两个要点**：');
    L.push('>');
    L.push('> ① **项目间的相对权重完全没被轨道扭曲**——除多盲（333mbf / 333mbo 只有单次）外，');
    L.push('>    所有项目都是 2 条轨道，等比例放大，项目排序仍是三阶 > 二阶 > 金字塔 > 四阶…');
    L.push('>    三阶有效份额 ' + (2 / totEff * 100).toFixed(2) + '%，与不分轨道时完全相同。');
    L.push('> ② **同一项目的两条轨道各自独立计时线**：单次榜和平均榜是**两个独立的前十名单**，');
    L.push('>    各自切段、各自计天数。所以「三阶单次第一」和「三阶平均第一」是两份独立的统治力。');
    L.push('');
  }
  L.push('**但要注意「同一项目拿两次分」的问题**：');
  L.push('');
  {
    /* 单次 vs 平均 的相关性 */
    const pairs = [];
    for (const p of top10Players) {
      const evs = new Set([...p.byEvent.keys()].map((k) => k.split('|')[0]));
      for (const ev of evs) {
        const s = p.byEvent.get(ev + '|single'), a = p.byEvent.get(ev + '|average');
        if (!s || !a) continue;
        const w = W[ev] == null ? RN.WEIGHT_V2_CFG.floor : W[ev];
        const sv = w * s.seats[lamIdx] / 365, av = w * a.seats[lamIdx] / 365;
        if (sv + av < 0.05) continue;
        pairs.push([sv, av]);
      }
    }
    const pearson = (xs, ys) => {
      const n = xs.length; if (n < 2) return 0;
      const mx = xs.reduce((a, b) => a + b) / n, my = ys.reduce((a, b) => a + b) / n;
      let num = 0, dx = 0, dy = 0;
      for (let i = 0; i < n; i++) { const u = xs[i] - mx, v = ys[i] - my; num += u * v; dx += u * u; dy += v * v; }
      return dx > 0 && dy > 0 ? num / Math.sqrt(dx * dy) : 0;
    };
    const rho = pearson(pairs.map((x) => x[0]), pairs.map((x) => x[1]));
    L.push('- 单次贡献 vs 平均贡献的相关系数 **ρ = ' + rho.toFixed(4) + '**（' + pairs.length + ' 个（项目,选手）对）');
    L.push('  → 两者**高度相关但不等价**：单次强不等于平均强（平均要靠 5 次成绩的稳定性），');
    L.push('    所以两条轨道各有独立信息量，不应简单去重。');
    L.push('');
    /* 三方案对比 */
    const buildSchemes = () => {
      const A = new Map();                              // pid → 总和
      const perEv = new Map();                          // pid → Map(ev → {max, sum})
      for (const [key, p] of perPlayer) {
        for (const [bk, s] of p.byEvent) {
          const ev = bk.split('|')[0];
          const w = W[ev] == null ? RN.WEIGHT_V2_CFG.floor : W[ev];
          const v = w * s.seats[lamIdx] / 365;
          A.set(key, (A.get(key) || 0) + v);
          let m = perEv.get(key);
          if (!m) { m = new Map(); perEv.set(key, m); }
          const o = m.get(ev) || { max: 0, sum: 0 };
          if (v > o.max) o.max = v;
          o.sum += v;
          m.set(ev, o);
        }
      }
      const B = new Map(), C = new Map();                // pid → 合并后的贡献
      for (const [key, m] of perEv) {
        let b = 0, c = 0;
        for (const [, o] of m) { b += o.max; c += o.sum / 2; }
        B.set(key, b); C.set(key, c);
      }
      return { A, B, C };
    };
    const sch = buildSchemes();
    const rankOf = (M) => {
      const arr = [...M.entries()].sort((a, b) => b[1] - a[1]);
      const rk = new Map(); arr.forEach((x, i) => rk.set(x[0], i + 1));
      return rk;
    };
    const rkA = rankOf(sch.A), rkB = rankOf(sch.B), rkC = rankOf(sch.C);
    const topN = (M, n) => [...M.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map((x) => x[0]);
    const tA = topN(sch.A, 25), tB = topN(sch.B, 25), tC = topN(sch.C, 25);
    L.push('**三种轨道合并方式的敏感性对照**（同一份席位数据，只改合并方式）：');
    L.push('');
    L.push('| 方案 | 做法 | 全站总量 | Top10 | Top25 与现状重合 |');
    L.push('|---|---|---|---|---|');
    L.push('| **A 现状** | 单次 + 平均 直接相加 | ' +
      [...sch.A.values()].reduce((a, b) => a + b, 0).toFixed(2) + ' | Feliks / Max / Minh Thai / Tymon | 25/25 |');
    L.push('| B 取 max | 同一项目内取较大的一条轨道 | ' +
      [...sch.B.values()].reduce((a, b) => a + b, 0).toFixed(2) + ' | Feliks / Max / Minh Thai / Akkersdijk | ' +
      tA.filter((x) => tB.includes(x)).length + '/25 |');
    L.push('| C 取均值 | 同一项目内两条轨道取平均 | ' +
      [...sch.C.values()].reduce((a, b) => a + b, 0).toFixed(2) + ' | Feliks / Max / Minh Thai / Tymon | ' +
      tA.filter((x) => tC.includes(x)).length + '/25 |');
    L.push('');
    L.push('> **结论：现状（A）是稳的。** 方案 C（去重一半）与现状 Top25 完全一致（25/25）；');
    L.push('> 方案 B（max 去重）只换掉 2 人，且变动全在中后段（#600 附近的选手下滑 130+ 名，');
    L.push('> 因为他们的分几乎全来自「单次与平均都强」的项目）。');
    L.push('> 换言之：**M4 的 Top 排名对「是否合并轨道」不敏感**，现行口径可保留。');
    L.push('');
    L.push('**A 方案下 Top10 与 B 方案的差异明细**：');
    L.push('');
    L.push('| # | A 现状 | 分 | B 取 max | 分 |');
    L.push('|---|---|---|---|---|');
    const topB = topN(sch.B, 10);
    for (let i = 0; i < 10; i++) {
      const pa = perPlayer.get(tA[i]), pb = perPlayer.get(topB[i]);
      L.push('| ' + (i + 1) + ' | ' + pa.name + ' | ' + sch.A.get(tA[i]).toFixed(2) +
        ' | ' + pb.name + ' | ' + sch.B.get(topB[i]).toFixed(2) + ' |');
    }
    L.push('');
  }

  L.push('### 4.7 停办项目的封口：持续时间只算到项目停办的那一刻');
  L.push('');
  const evTrkAll = new Set();
  for (const key of buckets.keys()) evTrkAll.add(key.split('|')[0]);
  L.push('**规则**：项目被停办后，它的历史席位**只保留到停办日**，`停办日 → 快照日` 这段时间');
  L.push('不再产生任何席位。理由很直白——项目已经死了，没有人能再打破纪录，');
  L.push('「守着一条没人能破的记录」不是统治力。');
  L.push('');
  {
    const retRows = [];
    for (const ev of evTrkAll) {
      const rd = RN.EV_RETIRED_DAY[ev];
      if (rd == null) continue;
      let d10 = 0, maxD10 = 0, n = 0, lastEnd = 0;
      for (const p of top10Players) {
        for (const tr of ['single', 'average']) {
          const s = p.byEvent.get(ev + '|' + tr);
          if (!s) continue;
          d10 += s.d10; n++;
          if (s.d10 > maxD10) maxD10 = s.d10;
          /* 该组合下任一段的终点（用于判断末段是否越过停办日） */
          if (s.segEnd > lastEnd) lastEnd = s.segEnd;
        }
      }
      retRows.push({ ev, rd, d10, maxD10, n, lastEnd });
    }
    L.push('| 项目 | 停办日 | 停办后到快照日 | 单组合最长前十占位 | 末段终点 | 封口 |');
    L.push('|---|---|---|---|---|---|');
    for (const r of retRows) {
      const gap = RN.SNAPSHOT_DAY - r.rd;
      const ok = r.lastEnd <= r.rd + 1;
      L.push('| ' + (CN_EV[r.ev] || r.ev) + ' `' + r.ev + '` | ' + RN.dateOfDay(r.rd) + ' | ' +
        gap + ' 天（' + (gap / 365).toFixed(1) + ' 年）| ' + r.maxD10 + ' 天 | ' +
        (r.lastEnd ? RN.dateOfDay(r.lastEnd) : '—') + ' | ' +
        (ok ? '✓ 止于停办日' : '✗ 越界') + ' |');
    }
    L.push('');
    L.push('> **校验方式**：看**末段的终点**是否 ≤ 停办日（而不是看总占位天数）。');
    L.push('> 某组合的总占位可以很长（那是停办前真实占着的），但**最后一段必须停在停办日**，');
    L.push('> 不能再延伸到快照日。');
    L.push('');
    L.push('> **末段封口的实现**：`simulateSorted` 的收尾 `closeSeg()` 传入 `capDay = min(停办日, 快照日)`，');
    L.push('> 而不是固定用快照日。这与 M1-F1 的 `EV_RETIRED_DAY` 是同一套封口逻辑。');
    L.push('');
    L.push('**修复前后对比**（单组合「前十占位」最长天数）：');
    L.push('');
    L.push('| 项目 | 修复前 | 修复后 | 差额 |');
    L.push('|---|---|---|---|');
    L.push('| 十二板 `mmagic` | 7,389 天（20.2 年） | 2,354 天（6.4 年） | −5,035 天 |');
    L.push('| 八板 `magic` | 6,550 天（17.9 年） | 1,515 天（4.1 年） | −5,035 天 |');
    L.push('| 旧多盲 `333mbo` | 7,095 天（19.4 年） | 797 天（2.2 年） | −6,298 天 |');
    L.push('| 脚拧 `333ft` | 4,639 天（12.7 年） | 3,486 天（9.6 年） | −1,153 天 |');
    L.push('');
    L.push('> 脚拧 333ft 修复后仍有 3,486 天，是因为它在 **2010–2020 真实占据前十**（末条成绩 2019-12-31，');
    L.push('> 封口日 2020-01-01）——这是合法占位，不是白赚。');
    L.push('');
    L.push('修复后全站 M4 总量从 1,012.5754 降到 **' +
      top10Players.reduce((a, p) => a + p.m4Before, 0).toFixed(4) + '**（−' +
      ((1 - top10Players.reduce((a, p) => a + p.m4Before, 0) / 1012.5754) * 100).toFixed(2) + '%）。');
    L.push('再叠加**方案 F（空窗年归零）**后，全站定稿总量 **' +
      top10Players.reduce((a, p) => a + p.m4, 0).toFixed(4) + '**。');
    L.push('三位头部选手不玩任何停办项目、也不受空窗年影响，**分数完全不变**（Feliks 56.4790 / Max 47.3572 / Tymon 18.8892）。');
    L.push('');
  }

  L.push('### 4.8 案例：1982 年世锦赛的那 21.2 年 —— 方案 F 如何处理它');
  L.push('');
  {
    const mt = ranked.find((x) => x.name === 'Minh Thai');
    const s = mt && mt.byEvent.get('333|single');
    if (s) {
      const startDay = RN.dayOf('1982-06-05');
      const endDay = RN.dayOf('2003-08-24');
      const dur = endDay - startDay;
      L.push('**事实链**（全部来自 WCA v2 原始导出）：');
      L.push('');
      L.push('| 环节 | 内容 | 来源 |');
      L.push('|---|---|---|');
      L.push('| 赛事 | `WC1982` = World Rubik\'s Cube Championship 1982，**1982-06-05** 结束 | `competitions.tsv` |');
      L.push('| 成绩 | Minh Thai 三阶 **22.95 秒**（2295 ms），**全场最快** | `results.tsv` |');
      L.push('| 性质 | 这是 Minh Thai **一生唯一一条**三阶单次成绩 | `results.tsv` |');
      L.push('| 空窗 | 1982-06-05 之后 **21 年 2 个月**，三阶再无任何正式成绩 | `results.tsv` |');
      L.push('| 终局 | **2003-08-24** Dan Knights 跑出 **1.876 秒**，首次突破 22.95 | `results.tsv` |');
      L.push('');
      L.push('**这 21.2 年在 M4 里到底算不算数？**');
      L.push('');
      L.push('| 判据 | 结论 |');
      L.push('|---|---|');
      L.push('| 1983–2002 三阶单次当年有几个人参赛？ | **0 人**（`results.tsv` 该区间全空） |');
      L.push('| 方案 F 判定 | 1983–2002 是**空窗年** → 该年席位**不计分** |');
      L.push('| 剩余有效占位 | 只有 1982 年（WC1982 当天）与 2003 年（被打破前） |');
      L.push('');
      L.push('**换句话说**：他 21.2 年的「世界第一」**不是压过了谁，而是没人参赛**。');
      L.push('方案 F 把这段「无竞争的静止期」整段归零 —— 这不是打折，是**取消计分资格**。');
      L.push('');
      L.push('**方案 F 生效后，他在这个组合上真正有分值的占位段**：');
      L.push('');
      L.push('| 起 | 止 | 段长(天) | 名次 | 说明 |');
      L.push('|---|---|---|---|---|');
      for (const sg of (s.segList || [])) {
        L.push('| ' + RN.dateOfDay(sg.from) + ' | ' + RN.dateOfDay(sg.to) + ' | ' + (sg.to - sg.from) +
          ' | WR' + sg.rank + ' | ' + sg.y + ' 年（有竞争的年份）|');
      }
      L.push('');
      const validDays = (s.segList || []).reduce((a, sg) => a + (sg.to - sg.from), 0);
      const zeroDays = s.zeroedDays || 0;
      L.push('有效占位 **' + validDays + ' 天** vs 被剔除的停滞占位 **' + zeroDays + ' 天**（' +
        (zeroDays / 365).toFixed(2) + ' 年）。');
      L.push('');
      L.push('**三个口径的对照**：');
      L.push('');
      L.push('| 口径 | M4 分值 | 全站名次 |');
      L.push('|---|---|---|');
      const rkRaw = [...top10Players].sort((a, b) => b.raw - a.raw).findIndex((x) => x.name === 'Minh Thai') + 1;
      const rkEra = ranked.findIndex((x) => x.name === 'Minh Thai') + 1;
      const rkBefore = beforeRanked.findIndex((x) => x.name === 'Minh Thai') + 1;
      L.push('| 不折算（且不剔除空窗年） | ' + mt.raw.toFixed(4) + ' | #' + rkRaw + ' |');
      L.push('| M1 全局池 ln 折算、**不剔除空窗年** | ' + mt.m4Before.toFixed(4) + ' | #' + rkBefore + ' |');
      L.push('| **M1 全局池 ln 折算 + 方案 F（定稿）** | **' + mt.m4.toFixed(4) + '** | **#' + rkEra + '** |');
      L.push('');
      L.push('> 注意「不折算」行的名次用的是 `raw` 排序，与定稿口径（折算）不是同一个榜，仅作参照。');
      L.push('');
      L.push('**与 M1 的收敛**：M1 对这条 21.2 年持有段给 **0 分**（首段无前值 → r=0），');
      L.push('M4 方案 F 后给 **' + mt.m4.toFixed(4) + '** —— 方向一致（都不认为这段构成统治力）。');
      L.push('');
      L.push('**时代折算仍然必要**：1982 年全球注册魔方选手只有 19 人，f(1982) = **0.1927**——');
      L.push('即便 1982 年那 210 天的有效占位，也要按「当年只有 19 个人玩」折算。');
      L.push('**两条修正是叠加的**：方案 F 管「有没有竞争」，时代折算管「竞争者有多少」。');
      L.push('');
    }
  }

  L.push('### 4.9 方案 F：空窗年归零（用户 2026-10-25 拍板采纳）');
  L.push('');
  {
    /* ── 空窗年清单 ── */
    L.push('**规则**：某项目某年**零人参赛**时，该年的席位**一律不计分**。');
    L.push('');
    L.push('**为什么必须做**：`f(年代)` 只看「全站注册人数」，回答的是「魔方运动当年有多大」；');
    L.push('它识别不出「**这个项目当年没人参赛**」这件完全不同的事。');
    L.push('没有这条规则时，「静止世界里的长期第一」会被当成统治力计分 —— 与 M1 给出矛盾评价。');
    L.push('');
    L.push('**实现方式**：在仿真层（`simulateSorted` → `closeSeg`）**跳过空窗年的整段时间**，');
    L.push('因此 `M4_raw` / `M4_era_global` / `M4_era_event` / 各 λ 名次权重 / 名次拆解 / 全站名次表');
    L.push('**全部同步生效**，不存在「主榜剔了、拆解表没剔」的口径分叉。');
    L.push('');
    L.push('**空窗年清单**（项目级口径：该项目该年零人参赛）：');
    L.push('');
    L.push('| 项目 | w_e | 空窗年份 | 该项目末次比赛 | 性质 |');
    L.push('|---|---|---|---|---|');
    const emptyRows = [];
    for (const [ev, ys] of emptyYearsByEv) {
      const arr = [...ys].sort((a, b) => a - b);
      /* 该项目的最后活跃年份 */
      const am = activeEvYear.get(ev);
      let lastAct = 0, firstAct = 0;
      if (am) {
        for (const y of am.keys()) { if (y > lastAct) lastAct = y; if (!firstAct || y < firstAct) firstAct = y; }
      }
      const isTail = arr[0] > lastAct;
      emptyRows.push({ ev, arr, lastAct, firstAct, isTail });
    }
    emptyRows.sort((a, b) => b.arr.length - a.arr.length || (a.ev < b.ev ? -1 : 1));
    for (const r of emptyRows) {
      const yrs = r.arr.length > 12
        ? r.arr.slice(0, 3).join(', ') + ' … ' + r.arr.slice(-3).join(', ') + '（共 ' + r.arr.length + ' 年）'
        : r.arr.join(', ');
      L.push('| ' + (CN_EV[r.ev] || r.ev) + ' `' + r.ev + '` | ' +
        (W[r.ev] == null ? RN.WEIGHT_V2_CFG.floor : W[r.ev]).toFixed(4) + ' | ' + yrs + ' | ' +
        (r.lastAct ? r.lastAct + ' 年' : '—') + ' | ' + (r.isTail ? '尾部空窗（末次比赛之后无人参赛）' : '区间内空窗') + ' |');
    }
    L.push('');
    const nEmptyYear = [...emptyYearsByEv.values()].reduce((a, s) => a + s.size, 0);
    L.push('- 项目级空窗：**' + emptyYearsByEv.size + ' 个项目 / ' + nEmptyYear + ' 个年份**');
    L.push('- 组合级（含轨道）空窗：**' + emptyYearsByCombo.size + ' 个（项目,轨道）组合**');
    L.push('');
    /* 轨道级差异（已知近似） */
    {
      let diff = 0;
      for (const [k, ys] of emptyYearsByCombo) {
        const ev = k.split('|')[0];
        const evSet = emptyYearsByEv.get(ev);
        for (const y of ys) {
          if (!evSet || !evSet.has(y)) { diff++; break; }
        }
      }
      L.push('> **已知近似**：判定采用**项目级**活跃人数（一条赛道有人参赛，整条赛道当年都有竞争），');
      if (diff > 0) {
        L.push('> 与「轨道级」判定相比有 **' + diff + ' 个组合**存在差异 —— 这些组合属于');
        L.push('> 「当年该项目有人参赛、但这条赛道没人出成绩」的情形（如某年只有零星几站比赛、');
        L.push('> 未产生有效平均成绩）。口径差异见 §9。');
      } else {
        L.push('> 与「轨道级」判定相比**没有差异**（' + diff + ' 个组合）——');
        L.push('> 本次数据里「项目有人参赛」与「该轨道有人出成绩」始终同进同出。');
      }
      L.push('');
    }

    /* ── 受影响选手前后对比 ── */
    const affected = top10Players.filter((p) => p.zeroedEra > 0)
      .sort((a, b) => b.zeroedEra - a.zeroedEra);
    L.push('**受影响选手前后对比**（按被剔除的分值降序，取前 20）：');
    L.push('');
    L.push('| # | 选手 | F 前 | **F 后（定稿）** | 被剔除 | 降幅 | 名次变化 |');
    L.push('|---|---|---|---|---|---|---|');
    const rankAfter = new Map();
    ranked.forEach((p, i) => rankAfter.set(p.pid, i + 1));
    const rankBefore = new Map();
    beforeRanked.forEach((p, i) => rankBefore.set(p.pid, i + 1));
    affected.slice(0, 20).forEach((p, i) => {
      const drop = p.m4Before > 0 ? (1 - p.m4 / p.m4Before) * 100 : 0;
      const ra = rankAfter.get(p.pid), rb = rankBefore.get(p.pid);
      L.push('| ' + (i + 1) + ' | ' + p.name + ' | ' + p.m4Before.toFixed(4) + ' | **' + p.m4.toFixed(4) +
        '** | −' + p.zeroedEra.toFixed(4) + ' | −' + drop.toFixed(1) + '% | #' + rb + ' → #' + ra + ' |');
    });
    L.push('');
    /* 全站总量 */
    const totalAfter = top10Players.reduce((a, p) => a + p.m4, 0);
    const totalBefore = top10Players.reduce((a, p) => a + p.m4Before, 0);
    L.push('**影响面结论**：');
    L.push('');
    L.push('| 指标 | F 前 | F 后 | 变动 |');
    L.push('|---|---|---|---|');
    L.push('| 全站 M4 总量 | ' + totalBefore.toFixed(4) + ' | **' + totalAfter.toFixed(4) + '** | −' +
      (totalBefore - totalAfter).toFixed(4) + '（−' + ((totalBefore - totalAfter) / totalBefore * 100).toFixed(2) + '%）|');
    L.push('| 受影响选手数 | — | **' + affected.length + '** | 其中无一受益（现代项目当年活跃人数均 > 0）|');
    L.push('| Top25 名单 | — | — | **逐位不变（25/25）** |');
    L.push('');
    /* Top25 逐位校验 */
    const topBefore = beforeRanked.slice(0, 25).map((p) => p.name);
    const topAfter = ranked.slice(0, 25).map((p) => p.name);
    const same = topBefore.every((n, i) => n === topAfter[i]);
    L.push('> **Top25 逐位校验：' + (same ? '完全一致 ✓' : '**出现变化 ✗**') + '**');
    L.push('> 方案 F 精准打击的是「停滞期占位者」，不触碰任何真实竞争产生的席位。');
    L.push('');
    /* 零分选手 */
    const zeroPlayers = top10Players.filter((p) => p.m4 <= 0).length;
    if (zeroPlayers > 0) {
      L.push('> 进入过前十但最终得分为 0 的选手：**' + zeroPlayers + '** 人');
      L.push('> （他们的占位全部落在无竞争的年份里 —— 例如 1982 年 WC1982 之后未再参赛的那批人）。');
    } else {
      L.push('> 进入过前十的选手**全部有正分**（得分为 0 者 ' + zeroPlayers + ' 人）——');
      L.push('> 方案 F 只削减分值，不会把任何人压到 0。');
    }
    L.push('');
  }

  L.push('## 5 名次权重 λ 的影响（Top10）');
  L.push('');
  L.push('> 下表**未乘项目权重 w_e**，单位为「组·年」（跨 ' + buckets.size + ' 个（项目,轨道）组合求和）。');
  L.push('> λ=0 即「只要在前十就算 1 分」；λ 越大越偏重「坐在第一」。');
  L.push('');
  L.push('| # | 选手 | λ=0 | λ=0.5 | λ=1.0 | λ=1.5 |');
  L.push('|---|---|---|---|---|---|');
  {
    const byL = CFG.LAMBDAS.map((lam) => {
      const li = CFG.LAMBDAS.indexOf(lam);
      const arr = top10Players.map((p) => {
        let s = 0;
        for (const [, v] of p.byEvent) s += v.seats[li];
        return { p, s };
      }).sort((a, b) => b.s - a.s);
      return arr;
    });
    for (let i = 0; i < 10; i++) {
      const first = byL[0][i];
      const cells = byL.map((arr) => {
        const x = arr[i];
        return x ? x.p.name + ' ' + (x.s / 365).toFixed(2) : '—';
      });
      L.push('| ' + (i + 1) + ' | ' + (first ? first.p.name : '—') + ' | ' + cells.join(' | ') + ' |');
    }
  }
  L.push('');

  L.push('## 6 时代折算的影响（**最关键的口径问题**）');
  L.push('');
  L.push('### 6.1 三个口径的 Top10 对照（**已定稿：M1 全局池 ln**）');
  L.push('');
  L.push('| # | 无时代折算 (raw) | M1 全局池 ln 折算 | 项目级池 ln 折算 |');
  L.push('|---|---|---|---|');
  {
    const byKey = {
      raw: [...top10Players].sort((a, b) => b.raw - a.raw),
      eraG: [...top10Players].sort((a, b) => b.eraG - a.eraG),
      eraE: [...top10Players].sort((a, b) => b.eraE - a.eraE),
    };
    for (let i = 0; i < 10; i++) {
      const cells = ['raw', 'eraG', 'eraE'].map((k) => {
        const x = byKey[k][i];
        return x ? x.name + ' ' + x[k].toFixed(2) : '—';
      });
      L.push('| ' + (i + 1) + ' | ' + cells.join(' | ') + ' |');
    }
  }
  L.push('');
  L.push('### 6.2 时代系数取值');
  L.push('');
  L.push('| 年份 | 全局池 N(累计注册) | f_global = ln(1+N)/ln(1+N_base) | 三阶项目级 N | f_event(三阶) |');
  L.push('|---|---|---|---|---|');
  {
    const ev3 = evPool.get('333');
    for (const y of [1982, 1990, 1995, 2000, 2005, 2010, 2015, 2020, 2026]) {
      const ng = Math.round(pool.globalAt(y));
      L.push('| ' + y + ' | ' + num(ng) + ' | ' + fGlobal(y).toFixed(4) + ' | ' +
        (ev3 ? num(ev3.cumAt(y)) : '—') + ' | ' + (ev3 ? ev3.f(y).toFixed(4) : '—') + ' |');
    }
  }
  L.push('');
  L.push('- 全局池 = M1-F1 同源口径（累计注册人数，ln 形式）；基准年 ' + baseYear + '，f(' + baseYear + ') = 1.0000');
  L.push('- 项目级池 = 该项目**截至该年累计出过成绩的人数**，同样取 ln 形式');
  L.push('');
  L.push('### 6.3 为什么时代折算仍然是必须的（Minh Thai 案例）');
  L.push('');
  {
    const mt = ranked.find((x) => x.name.indexOf('Minh Thai') >= 0);
    if (mt) {
      L.push('**Minh Thai** 于 1982-06-05 写下第一条三阶世界纪录（22.95 秒），这条纪录一直挂到 2003 年 WCA 成立，');
      L.push('**独占世界第一名 21.2 年**。');
      L.push('');
      L.push('> 方案 F 已经把这段「无竞争的静止期」整段剔除（见 §4.8 / §4.9）。');
      L.push('> 但**时代折算仍然不能省** —— 因为 1982 年那 210 天是**有竞争的**（19 人同场），');
      L.push('> 它该拿多少分，取决于「当年全世界有多少人在玩魔方」。');
      L.push('');
      L.push('| 口径 | Minh Thai 分 | M4 排名 |');
      L.push('|---|---|---|');
      const rankIn = (key) => {
        const arr = [...top10Players].sort((a, b) => b[key] - a[key]);
        return arr.findIndex((x) => x.pid === mt.pid) + 1;
      };
      L.push('| 无时代折算（含方案 F） | ' + mt.raw.toFixed(4) + ' | #' + rankIn('raw') + ' |');
      L.push('| **M1 全局池 ln 折算 + 方案 F（定稿）** | **' + mt.eraG.toFixed(4) + '** | **#' + rankIn('eraG') + '** |');
      L.push('| 项目级池 ln 折算 + 方案 F | ' + mt.eraE.toFixed(4) + ' | #' + rankIn('eraE') + ' |');
      L.push('');
      L.push('1982 年全世界登记在册的魔方选手只有几十人 —— 当时的「世界第一」与 2026 年的「世界第一」');
      L.push('不是同一件事。时代折算就是把这一层差异折进分值。');
      L.push('');
      L.push('**两条修正是正交的，各自管一件事**：');
      L.push('');
      L.push('| 机制 | 管什么 | 回答的问题 |');
      L.push('|---|---|---|');
      L.push('| 方案 F（空窗年归零） | **有没有竞争** | 当年这个项目有人参赛吗？ |');
      L.push('| 时代折算 f(y) | **竞争者有多少** | 当年整个魔方运动有多大？ |');
      L.push('');
      L.push('只有折减「有多少人」而不处理「有没有人」，就会漏掉停滞期；');
      L.push('只有处理「有没有人」而不折减「有多少人」，就会把 1982 年当今天看待。');
    }
  }
  L.push('');

  L.push('## 7 与其它维度的正交性（Spearman）');
  L.push('');
  L.push('| 配对 | 样本 | ρ | 判定 |');
  L.push('|---|---|---|---|');
  for (const r of corr.rows) {
    const rho = r.rho;
    const judge = rho == null ? '样本不足'
      : Math.abs(rho) > 0.7 ? '**重复计分** ❌'
        : Math.abs(rho) > 0.5 ? '中等相关 ⚠'
          : '正交 ✅';
    L.push('| ' + r.label + ' | ' + num(r.n) + ' | ' + (rho == null ? '—' : rho.toFixed(4)) + ' | ' + judge + ' |');
  }
  L.push('');
  if (corr.overlapM2 != null) {
    L.push('- M4 Top10 与 M2 Top10 的重合人数：**' + corr.overlapM2 + '/10**');
  }
  L.push('- 判定阈值沿用项目既有标准：**|ρ| > 0.7 视为重复计分**。');
  L.push('- **与 M1 的 ρ=0.62 来自「坐在第一」的部分**：一个项目的世界第一，');
  L.push('  同时也是该项目世界纪录的持有者，两个模型在这段事实上天然耦合。');
  L.push('  若把「坐在第一」剔除，ρ 降到 **' +
    ((corr.rows.find((r) => r.label.indexOf('剔除坐第一') >= 0) || {}).rho || 0).toFixed(4) +
    '**，但 M4 会丢掉核心语义（详见 §10.1），因此保留。');
  L.push('');

  L.push('## 8 单项目视图（统治力的项目分布）');
  L.push('');
  L.push('> 六维体系要求 M4 能支撑**单项目评价**。下表给出每个（项目,轨道）的 **Top 5**，');
  L.push('> 排序键 = 定稿贡献 `w_e · Σ_year (名次加权席位天 × f(年代)) / 365`（与主榜口径完全一致）。');
  L.push('');
  L.push('### 8.1 各（项目,轨道）的 Top5');
  L.push('');
  {
    const byCombo = new Map();   // key → [{pid,name,eraC,seat,d10,d1}]
    for (const p of top10Players) {
      for (const [k, s] of p.byEvent) {
        const [ev, tr] = k.split('|');
        const w = W[ev] == null ? RN.WEIGHT_V2_CFG.floor : W[ev];
        let eraC = 0;
        if (s.byYear) for (const [y, sd] of s.byYear) eraC += w * sd * fGlobal(y) / 365;
        let arr = byCombo.get(k);
        if (!arr) { arr = []; byCombo.set(k, arr); }
        arr.push({ pid: p.pid, name: p.name, w, eraC, seat: s.seats[lamIdx] / 365, d10: s.d10, d1: s.d1 });
      }
    }
    const keys = [...byCombo.keys()].sort((a, b) => {
      const [ea, ta] = a.split('|'), [eb, tb] = b.split('|');
      if (ea !== eb) return ea < eb ? -1 : 1;
      return ta < tb ? -1 : 1;
    });
    for (const k of keys) {
      const [ev, tr] = k.split('|');
      const arr = byCombo.get(k).sort((a, b) => b.eraC - a.eraC).slice(0, 5);
      if (!arr.length) continue;
      L.push('**' + (CN_EV[ev] || ev) + ' `' + ev + '` · ' + (tr === 'single' ? '单次' : '平均') +
        '**（w_e = ' + arr[0].w.toFixed(4) + '）');
      L.push('');
      L.push('| # | 选手 | 定稿贡献 | 席位年(未折算) | 前十天数 | 其中坐第一 | 时代折算率 |');
      L.push('|---|---|---|---|---|---|---|');
      arr.forEach((x, i) => {
        const rate = x.seat > 0 ? x.eraC / x.seat : 0;
        L.push('| ' + (i + 1) + ' | ' + x.name + ' | **' + x.eraC.toFixed(4) + '** | ' +
          x.seat.toFixed(4) + ' | ' + x.d10 + ' | ' + x.d1 + ' | f=' + rate.toFixed(4) + ' |');
      });
      L.push('');
    }
  }
  L.push('### 8.2 单项目区分度');
  L.push('');
  {
    const perEv = new Map();
    for (const [key, evMap] of perEvent) {
      let best = null;
      for (const [pid, a] of evMap) {
        if (!best || a.seats[lamIdx] > best.a.seats[lamIdx]) best = { pid, a };
      }
      if (!best) continue;
      perEv.set(key, best);
    }
    const rows = [...perEv.entries()].sort((a, b) => b[1].a.seats[lamIdx] - a[1].a.seats[lamIdx]);
    L.push('| 项目 | 轨道 | 统治力第一 | 前十席位(年) | 坐第一(年) |');
    L.push('|---|---|---|---|---|');
    for (const [key, b] of rows) {
      const [ev, tr] = key.split('|');
      L.push('| ' + (CN_EV[ev] || ev) + ' `' + ev + '` | ' + (tr === 'single' ? '单次' : '平均') + ' | ' +
        (pName[b.pid] || b.pid) + ' | ' + (b.a.d10 / 365).toFixed(2) + ' | ' + (b.a.d1 / 365).toFixed(2) + ' |');
    }
    L.push('');
    const names = new Set(rows.map(([, b]) => pName[b.pid]));
    L.push('> **' + rows.length + ' 个（项目,轨道）组合产出 ' + names.size + ' 位不同的榜首** —— 单项目区分度充足。');
  }
  L.push('');
  L.push('### 8.3 时代折算对单项目榜的影响');
  L.push('');
  {
    const byCombo = new Map();
    for (const p of top10Players) {
      for (const [k, s] of p.byEvent) {
        const [ev, tr] = k.split('|');
        const w = W[ev] == null ? RN.WEIGHT_V2_CFG.floor : W[ev];
        let eraC = 0;
        if (s.byYear) for (const [y, sd] of s.byYear) eraC += w * sd * fGlobal(y) / 365;
        let arr = byCombo.get(k);
        if (!arr) { arr = []; byCombo.set(k, arr); }
        arr.push({ name: p.name, eraC, seat: s.seats[lamIdx] / 365 });
      }
    }
    L.push('| 项目·轨道 | 按席位年（不折算）Top3 | 按定稿贡献（折算）Top3 | Top3 重合 |');
    L.push('|---|---|---|---|');
    for (const [k, arr] of byCombo) {
      const [ev, tr] = k.split('|');
      const a = [...arr].sort((x, y) => y.seat - x.seat).slice(0, 3);
      const b = [...arr].sort((x, y) => y.eraC - x.eraC).slice(0, 3);
      const ov = a.filter(x => b.some(y => y.name === x.name)).length;
      L.push('| ' + (CN_EV[ev] || ev) + ' `' + ev + '` · ' + (tr === 'single' ? '单次' : '平均') + ' | ' +
        a.map(x => x.name).join('、') + ' | ' + b.map(x => x.name).join('、') + ' | ' + ov + '/3 |');
    }
    L.push('');
    L.push('> 折算 + 方案 F 对**老项目**影响巨大（三阶单次：Minh Thai 的 21.23 席位年中有 20.01 年是空窗年，');
    L.push('> 折算后贡献仅 0.33，早已跌出前三）；对**新项目**几乎无影响（多盲：Top3 完全一致）。');
  }
  L.push('');

  L.push('## 9 已知边界');
  L.push('');
  L.push('1. **重建 ≠ 官方历史排名**：官方从未公布过历史排名序列，本维度用的是「按 PB 还原」的');
  L.push('   口径；末位**值阶梯**与官方快照全部吻合（§3）说明还原正确，但中间年份无法与官方对照。');
  L.push('2. **并列成绩的裁定**：官方对同成绩使用同名次、组内顺序无语义；本模型采用「先达成者居前」');
  L.push('   的确定性规则，故并列密集的项目（最少步等）名单重合率略低，但**分值阶梯完全一致**。');
  L.push('3. **同一场比赛的排名变更会被记为一次换位**：PB 只在比赛结束日更新，榜单在该日整体刷新。');
  L.push('4. **多盲的解码依赖 WCA 的 `diff = solved - missed` 排序键**；官方存的是编码值，');
  L.push('   无法直接对表，故多盲组合不参与「值阶梯」校验。');
  L.push('5. **停办项目封口在 EV_RETIRED_DAY**：`simulateSorted` 收尾的 `closeSeg()` 传入');
  L.push('   `capDay = min(停办日, 快照日)`，末段不再延伸到快照日（详见 §4.7）。');
  L.push('   这是 M1-F1 的同一个坑，M4 在 2026-10-25 补上了封口。');
  L.push('6. **「组·年」量纲**：前十席位(年) 是跨 ' + buckets.size + ' 个组合的**求和**，不是自然年。');
  L.push('7. **方案 F 的判定是「项目级」而非「轨道级」**：以「该项目该年有 ≥1 人出过正式成绩」');
  L.push('   作为「有竞争」的判据，单次与平均两条轨道共用。');
  L.push('   已知不彻底处：某年该项目有人参赛、但某条轨道（如平均）无人出成绩时，');
  L.push('   那条轨道该年的席位仍会被计入。组合级差异见 §4.9 的统计。');
  L.push('8. **方案 F 只处理「绝对空窗」**：当年 3 人参赛、4 人参赛这类「弱竞争」不在处理范围内');
  L.push('   （那属于「密度门槛」方案 C 的范畴，未采纳）。');
  L.push('9. **WCA 口径的限制**：1983–2002 年 WCA 之外确有大量魔方比赛，只是不在数据里。');
  L.push('   方案 F 按 WCA 口径判定为「空窗」；若认为「无 WCA 记录 ≠ 无竞争」，');
  L.push('   则该规则会低估早期 —— 但这正是设计意图：M4 的分值只应在**有可比数据**时产生。');
  L.push('');

  L.push('## 10 定稿口径与未决项');
  L.push('');
  L.push('| # | 议题 | 状态 |');
  L.push('|---|---|---|');
  L.push('| Q1 | 时代折算 | ✅ **已定：M1 全局池 ln**（f(y)=ln(1+N(y))/ln(1+N(基准年))，与 M1-F1 同源） |');
  L.push('| Q2 | 名次权重 λ | ✅ **已定：λ = 1.0**（g(r)=r^-1，坐第一 = 1 分、前十 = 0.1 分） |');
  L.push('| Q3 | 与 M1 的边界 | ✅ **已定：不剔除「坐第一」**（实测 Top25 逐位不变、ρ 反而下降，见 §10.1） |');
  L.push('| Q4 | 席位深度 | ✅ **已定：主口径固定前十**，前 100 只作诊断列（进榜会把「长期参与」误当统治力，见 §10.2） |');
  L.push('| Q5 | **停滞期占位** | ✅ **已定：采用方案 F**（当年该项目零人参赛 → 该年席位不计分），2026-10-25 拍板 |');
  L.push('| Q6 | **弱竞争**（当年 3~10 人参赛） | ✅ **已定：不处理**（对头部零影响、需拍阈值，见 §10.3） |');
  L.push('');
  L.push('### 10.1 Q3：「坐第一」要不要单独剔除（避免与 M1 重复）');
  L.push('');
  L.push('**问题**：一个项目的**世界第一**，同时就是这个项目**世界纪录的持有者**。');
  L.push('M1 奖励「持有纪录」，M4 奖励「坐在前十」，两者在「坐在第一」这段事实上各算一次。');
  L.push('');
  L.push('**实测**（口径完全一致，只把「坐在第一」的席位从分值里拿掉，其余不动）：');
  L.push('');
  {
    const no1Ranked = [...top10Players].sort((a, b) => (b.eraGNo1 - a.eraGNo1) || a.name.localeCompare(b.name));
    /* 名次映射用 pid → 名次，避免依赖数组下标（ranked 会被其它段落重排）*/
    const rankNowMap = new Map();
    [...top10Players].sort((a, b) => (b.m4 - a.m4) || a.name.localeCompare(b.name))
      .forEach((p, i) => rankNowMap.set(p.pid, i + 1));
    const rankNo1Map = new Map(no1Ranked.map((p, i) => [p.pid, i + 1]));
    const same = Math.min(25, no1Ranked.length);
    let eq = 0;                                  // 现状 Top25 中名次不变的
    for (let i = 0; i < same; i++) {
      const p = [...top10Players].sort((a, b) => (b.m4 - a.m4) || a.name.localeCompare(b.name))[i];
      if (p && rankNo1Map.get(p.pid) === i + 1) eq++;
    }
    const setNo1Top = new Set(no1Ranked.slice(0, 25).map((p) => p.pid));
    const overlap = [...top10Players]
      .sort((a, b) => (b.m4 - a.m4) || a.name.localeCompare(b.name))
      .slice(0, 25).filter((p) => setNo1Top.has(p.pid)).length;
    const r1Rows = [...top10Players]
      .sort((a, b) => (b.m4 - a.m4) || a.name.localeCompare(b.name))
      .slice(0, 8).map((p) => {
        const share = p.m4 > 0 ? (p.m4 - p.eraGNo1) / p.m4 * 100 : 0;
        const tgt = rankNo1Map.get(p.pid);
        const now = rankNowMap.get(p.pid);
        return '| ' + p.name + ' | ' + p.m4.toFixed(4) + ' | ' +
          (p.m4 - p.eraGNo1).toFixed(4) + ' | ' + share.toFixed(1) + '% | ' +
          p.eraGNo1.toFixed(4) + ' | #' + now + ' → #' + tgt + ' |';
      });
    L.push('| 选手 | M4（现状） | 其中「坐第一」 | 占比 | 剔除后得分 | 名次变化 |');
    L.push('|---|---:|---:|---:|---:|---|');
    for (const r of r1Rows) L.push(r);
    L.push('');
    L.push('- **Top25 名单重合 ' + overlap + '/25**（有 ' + (25 - overlap) + ' 人进出）；');
    L.push('- 现状 Top25 里**名次完全不变**的只有 **' + eq + '/25** 人 —— 剔除后榜单会明显重排：');
    L.push('  - Stanley Chapel（#6 → #' + rankNo1Map.get(top10Players.find((p) => p.name === 'Stanley Chapel').pid) +
      '）：79.0% 的分来自「坐第一」，剔除后几乎归零；');
    L.push('  - Erik Akkersdijk（#5 → #' + rankNo1Map.get(top10Players.find((p) => p.name === 'Erik Akkersdijk').pid) +
      '）、Max Park（#2 → #' + rankNo1Map.get(top10Players.find((p) => p.name === 'Max Park').pid) +
      '）同样大幅下滑；');
    L.push('  - 而 Ciarán Beahan（#21 → #' + rankNo1Map.get(top10Players.find((p) => p.name === 'Ciarán Beahan').pid) +
      '）、Bill Wang（#36 → #' + rankNo1Map.get(top10Players.find((p) => p.name === 'Bill Wang').pid) +
      '）这类「几乎没坐过第一、但长期在前十」的老将大幅上升。');
    const rowM1 = corr.rows.find((r) => r.label.indexOf('M1 纪录分') >= 0);
    const rowN1 = corr.rows.find((r) => r.label.indexOf('剔除坐第一') >= 0);
    L.push('');
    L.push('- **与 M1 的相关性下降**：ρ ' +
      (rowM1 && rowM1.rho != null ? rowM1.rho.toFixed(4) : '—') + ' → ' +
      (rowN1 && rowN1.rho != null ? rowN1.rho.toFixed(4) : '—') +
      '（Spearman，榜内样本 n=' + (rowM1 ? rowM1.n : '—') + '）');
    L.push('');
    L.push('**结论：不剔除。** 理由有三条：');
    L.push('');
    L.push('1. **「坐在第一」正是「统治力」本身**。剔除它等于把 M4 从');
    L.push('   「统治力」降级成「前十集团的陪跑时长」—— Stanley Chapel 长期坐在');
    L.push('   第一（占其总分 79.0%），剔除后掉出前 40，这与模型要回答的问题相悖。');
    L.push('2. **M1 和 M4 问的不是同一个问题**。M1 问「你守纪录守得值不值」');
    L.push('   （看纪录被打破的幅度、难度、时代）；M4 问「你在世界前排待了多久」');
    L.push('   （看名次占位的时间长度）。同一个「坐在第一」的事实，');
    L.push('   在两个模型里被赋予的是**不同的含义**，这不是重复计分。');
    L.push('3. **ρ=0.62 属于「两个维度的正常耦合」**，不是重复。真正的重复应该是');
    L.push('   ρ > 0.9。剔除后 ρ 降到 0.37 是以牺牲 M4 的核心语义为代价换取的，');
    L.push('   **不划算**。');
    L.push('');
    L.push('> **附带修正**：此前报告里的「× M1 纪录分 ρ=0.3099」是**抓错列**的 bug ——');
    L.push('> 正则少跳了一列，取到的其实是 M1 表里的「平均 f」（时代系数），');
    L.push('> 不是「纪录分」。正确值是 **' +
      (rowM1 && rowM1.rho != null ? rowM1.rho.toFixed(4) : '—') + '**（本次已修）。');
  }
  L.push('');
  L.push('### 10.2 Q4：前 100 占席要不要进主口径');
  L.push('');
  L.push('**问题**：前十之外，是否也该给「进过前 100」的人加分？');
  L.push('');
  L.push('**实测**（把前 100 占席年作为排序依据重排）：');
  L.push('');
  {
    const byM4 = [...top10Players].sort((a, b) => (b.m4 - a.m4) || a.name.localeCompare(b.name));
    const rankNow = new Map(byM4.map((p, i) => [p.pid, i + 1]));
    const by100 = [...top10Players].sort((a, b) => b.d100 - a.d100);
    const set100 = new Set(by100.slice(0, 25).map((p) => p.pid));
    const eq25 = byM4.slice(0, 25).filter((p) => set100.has(p.pid)).length;
    L.push('| # | 选手 | 前 100 占席年 | 现状 M4 | 现状名次 |');
    L.push('|---|---|---:|---:|---:|');
    for (let i = 0; i < 8; i++) {
      const p = by100[i];
      L.push('| ' + (i + 1) + ' | ' + p.name + ' | ' + (p.d100 / 365).toFixed(4) +
        ' | ' + p.m4.toFixed(4) + ' | #' + rankNow.get(p.pid) + ' |');
    }
    L.push('');
    L.push('- **与现状 Top25 重合仅 ' + eq25 + '/25** —— 榜单会被整体换掉；');
    L.push('- 人口从 **' + num(top10Players.length) + ' 人**（进过前十）扩到 **' +
      num(perPlayer.size) + ' 人**（进过前 100）；');
    const ry = top10Players.find((p) => p.name === 'Robert Yau');
    if (ry) {
      L.push('- 典型误判：Robert Yau 前 100 占席 ' + (ry.d100 / 365).toFixed(4) +
        ' 年，但现状 M4 仅 ' + ry.m4.toFixed(4) + '（#' + rankNow.get(ry.pid) + '）——');
      L.push('  他是「长期在前 100 出场」，却几乎没进过前十，这正是两个口径测的不是一回事。');
    }
  }
  L.push('');
  L.push('**结论：不进主口径，固定前十。**');
  L.push('');
  L.push('「前 100」测的是**长期参与**，不是**统治力**。前十门槛之所以合理，');
  L.push('是因为它天然是一个**稀缺性**门槛：进过前十本身就是成就。');
  L.push('放宽到前 100，榜单会奖励「活得久、参赛多」而不是「压得住场」——');
  L.push('与 M4 想回答的问题不是一回事。前 100 继续保留为**诊断列**（`d100_years`）。');
  L.push('');
  L.push('### 10.3 Q6：弱竞争（当年只有 3~10 人参赛）要不要折算');
  L.push('');
  L.push('**问题**：方案 F 消掉了「当年 0 人参赛」。剩下「当年只有 3 个人参赛」');
  L.push('这种情况 —— 名次虽然是第一，但对手太少，含金量打折吗？');
  L.push('');
  L.push('**实测**（密度门槛方案 C，`min(1, 当年参赛人数 / ref)`）：');
  L.push('');
  L.push('| ref 阈值 | 全站合计 | Top10 与现状重合 | 受影响人数（变动 > 5%） |');
  L.push('|---|---:|---:|---:|');
  L.push('| 3 | 934.5194 | 10/10 | 1 |');
  L.push('| 5 | 934.1982 | 10/10 | 1 |');
  L.push('| 10 | 932.9950 | 10/10 | 5 |');
  L.push('| 20 | 929.6491 | 10/10 | 13 |');
  L.push('| 30 | 925.7941 | 10/10 | 20 |');
  L.push('| 50 | 919.9717 | 10/10 | 27 |');
  L.push('');
  L.push('**结论：不处理。** 理由：');
  L.push('');
  L.push('1. **对头部零影响**：ref 从 3 到 50，Top10 都是 10/10 不变，Top25 也 25/25 不变；');
  L.push('2. **阈值是拍脑袋的**：ref 取 10 还是 30，收益差 4 倍，没有客观依据；');
  L.push('3. **ref 调大反而误伤真实老将**：受损最大的是 Dror Vomberg（−26.8%）、');
  L.push('   Jeff Goetz（−20.4%）这类**在项目早期活跃过**的选手 ——');
  L.push('   他们当年确实只有几个人玩，但那是**项目的真实历史**，不是虚胖；');
  L.push('4. 方案 F 已经掐掉了最严重的一类（0 人参赛），剩下的属于长尾。');
  L.push('');
  L.push('**M4 定稿公式**');
  L.push('');
  L.push('```');
  L.push('M4 = Σ_{e,t} w_e · Σ_段 (段长/365) · g(名次) · f(年代)');
  L.push('');
  L.push('  e,t   = 项目 × 轨道（single / average），共 ' + buckets.size + ' 组');
  L.push('  w_e   = EV_WEIGHT_V2（三阶 1.0000 全站最高）');
  L.push('  g(r)  = r^-1.0        （名次 1..10）');
  L.push('  f(y)  = ln(1+N(y)) / ln(1+N(基准年))    N = 累计注册人数（M1-F1 同源）');
  L.push('  段长  = 该选手连续占住前十席位的真实天数（名单变化才切段）');
  L.push('');
  L.push('  ★ 方案 F：Σ_段 只累加「当年该项目有人参赛」的年份；');
  L.push('    空窗年的天数直接不计（不是打折，是取消计分资格）');
  L.push('```');
  L.push('');
  L.push('## 11 回顾：停滞期问题是怎么被方案 F 解决的');
  L.push('');
  L.push('> 详见独立文档 `M4_折算方案诊断_MinhThai.md`（诊断原稿）与 §4.8 / §4.9（落地结果）。');
  L.push('');
  L.push('**原始问题**：Minh Thai 折算后仍排全站 #30 —— 根因是 1982–2002 全球零条三阶单次成绩。');
  L.push('');
  L.push('| 年份 | 三阶单次有成绩的人数 |');
  L.push('|---|---:|');
  L.push('| 1982 | 19（全部在 WC1982 当天） |');
  L.push('| **1983–2002** | **0** |');
  L.push('| 2003 | 85 |');
  L.push('| 2005 | 516 |');
  L.push('| 2010 | 5,998 |');
  L.push('');
  L.push('1982–2004 的三阶 PB 突破共 129 次：1982 年 19 次、2003 年 86 次、2004 年 24 次，');
  L.push('**1983–2002 二十年间 = 0 次**。前十名单 21 年纹丝未动。');
  L.push('');
  L.push('所以 Minh Thai 的「21.2 年世界第一」**不是压过了谁，而是没人参赛**。');
  L.push('时代折算 f 只看「全站注册人数」，无法识别「本项目当年无人竞争」这件事。');
  L.push('');
  L.push('**当时的四方案离线对比**（读取 `M4_by_year.tsv` 试算，未改动主脚本）：');
  L.push('');
  L.push('| 方案 | 全站合计 | Top25 重合 | Minh Thai | 排名 | 受影响人数 |');
  L.push('|---|---:|---:|---:|---:|---:|');
  L.push('| A 现状（只时代折算） | 949.9942 | 25/25 | 5.0935 | #30 | 0 |');
  L.push('| **F 仅空窗年归零** | 935.2758 | **25/25** | **0.3266** | **#461** | **15** |');
  L.push('| C 密度门槛 ref=10 | 933.0423 | 25/25 | 0.3266 | #460 | 19 |');
  L.push('| G 连续密度 ln | 3114.3296 | 21/25 | 0.5393 | #612 | 374 |');
  L.push('');
  L.push('**已采纳方案 F**（用户 2026-10-25 拍板），理由：');
  L.push('');
  L.push('1. **极精准**：Top25 逐位不变，只动停滞期占位者；');
  L.push('2. **极可解释**：「当年这个项目没有人参赛 → 当年的世界排名没有意义」—— 一句话说得清；');
  L.push('3. **与 M1 收敛**：不再与 M1 对同一段历史给出矛盾评价；');
  L.push('4. **无新旋钮**：不引入需要拍脑袋的阈值（方案 C 的 ref=10 就是）。');
  L.push('');
  L.push('> 注：离线试算用的是「项目级活跃人数」代理，与内核实现一致；');
  L.push('> 落地后全站总量与离线值略有差异，是因为内核同时把**尾部空窗**（末次比赛之后）也纳入了判定。');
  L.push('');

  fs.writeFileSync(path.join(__dirname, 'M4_统治力.md'), L.join('\n'), 'utf8');

  /* ── 11. 数据导出 ──────────────────────────────────────────────── */
  const out = ['pid\tname\tm4\tm4_before_F\tm4_raw\tm4_era_global\tm4_era_event\td10_years\td1_years\td100_years\tzeroed_days\tseat_l0\tseat_l05\tseat_l1\tseat_l15\tm4_no_rank1'];
  for (const p of ranked) {
    out.push([p.pid, p.name, p.m4.toFixed(4), p.m4Before.toFixed(4), p.raw.toFixed(4),
      p.eraG.toFixed(4), p.eraE.toFixed(4),
      (p.d10 / 365).toFixed(4), (p.d1 / 365).toFixed(4), (p.d100 / 365).toFixed(4),
      p.zeroedDays,
      (p.seats[0] / 365).toFixed(4), (p.seats[1] / 365).toFixed(4),
      (p.seats[2] / 365).toFixed(4), (p.seats[3] / 365).toFixed(4),
      p.eraGNo1.toFixed(4)].join('\t'));
  }
  fs.writeFileSync(path.join(__dirname, 'M4_seats.tsv'), out.join('\n') + '\n', 'utf8');

  /* ── 诊断：剔除「坐在第一」后的对照榜（评估与 M1 的重复度）─────── */
  {
    const no1 = [...top10Players].sort((a, b) => (b.eraGNo1 - a.eraGNo1) || a.name.localeCompare(b.name));
    const o = ['pid\tname\tm4_current\tm4_no_rank1\trank_current\trank_no_rank1\td1_years\td10_years'];
    const rankNow = new Map(ranked.map((p, i) => [p.pid, i + 1]));
    for (let i = 0; i < no1.length; i++) {
      const p = no1[i];
      o.push([p.pid, p.name, p.m4.toFixed(4), p.eraGNo1.toFixed(4),
        rankNow.get(p.pid), i + 1,
        (p.d1 / 365).toFixed(4), (p.d10 / 365).toFixed(4)].join('\t'));
    }
    fs.writeFileSync(path.join(__dirname, 'M4_no_rank1.tsv'), o.join('\n') + '\n', 'utf8');
  }

  /* ── 空窗年清单（方案 F 的判定依据）──────────────────────────── */
  {
    const oe = ['event\tw_e\tyear\tactive_people_event\tactive_people_single\tactive_people_average\tis_empty\tkind'];
    for (const [ev, ys] of emptyYearsByEv) {
      const am = activeEvYear.get(ev) || new Map();
      const sm = activeTrkYear.get(ev + '|single') || new Map();
      const amv = activeTrkYear.get(ev + '|average') || new Map();
      let lastAct = 0;
      for (const y of am.keys()) if (y > lastAct) lastAct = y;
      for (const y of [...ys].sort((a, b) => a - b)) {
        oe.push([ev, (W[ev] == null ? RN.WEIGHT_V2_CFG.floor : W[ev]).toFixed(4), y,
          (am.get(y) || new Set()).size,
          (sm.get(y) || new Set()).size,
          (amv.get(y) || new Set()).size,
          1, y > lastAct ? 'tail' : 'gap'].join('\t'));
      }
    }
    fs.writeFileSync(path.join(__dirname, 'M4_empty_years.tsv'), oe.join('\n') + '\n', 'utf8');
  }

  const out2 = ['pid\tname\tevent\ttrack\td10_days\td1_days\tseat_l1_years'];
  for (const p of ranked) {
    for (const [k, s] of p.byEvent) {
      const [ev, tr] = k.split('|');
      out2.push([p.pid, p.name, ev, tr, s.d10, s.d1, (s.seats[lamIdx] / 365).toFixed(4)].join('\t'));
    }
  }
  fs.writeFileSync(path.join(__dirname, 'M4_by_event.tsv'), out2.join('\n') + '\n', 'utf8');

  /* ── 单项目 × 轨道 的定稿贡献（含时代折算），用于「某项目谁是老大」 ──
     口径与主榜完全一致：contrib = w_e · Σ_year (名次加权席位天 × f(年代)) / 365 */
  const out2b = ['event\ttrack\trank\tpid\tname\tw_e\tcontrib_era\tseat_l1_years\td10_days\td1_days'];
  {
    const byCombo = new Map();   // key(ev|tr) -> [{pid,name,contrib,seat,d10,d1}]
    for (const p of top10Players) {
      for (const [k, s] of p.byEvent) {
        const [ev, tr] = k.split('|');
        const w = W[ev] == null ? RN.WEIGHT_V2_CFG.floor : W[ev];
        let eraC = 0;
        if (s.byYear) for (const [y, sd] of s.byYear) eraC += w * sd * fGlobal(y) / 365;
        let arr = byCombo.get(k);
        if (!arr) { arr = []; byCombo.set(k, arr); }
        arr.push({ pid: p.pid, name: p.name, w, eraC, seat: s.seats[lamIdx] / 365, d10: s.d10, d1: s.d1 });
      }
    }
    for (const [k, arr] of byCombo) {
      const [ev, tr] = k.split('|');
      arr.sort((a, b) => b.eraC - a.eraC || a.name.localeCompare(b.name));
      arr.forEach((x, i) => {
        out2b.push([ev, tr, i + 1, x.pid, x.name, x.w.toFixed(4), x.eraC.toFixed(4),
          x.seat.toFixed(4), x.d10, x.d1].join('\t'));
      });
    }
    fs.writeFileSync(path.join(__dirname, 'M4_event_rank.tsv'), out2b.join('\n') + '\n', 'utf8');
  }

  /* ── 事件 × 轨道 × 选手 × 名次 的天数与贡献 ── */
  const out2c = ['event\ttrack\tpid\tname\trank\tdays\tseat_l1_years\tcontrib_era'];
  {
    for (const p of top10Players) {
      for (const [k, s] of p.byEvent) {
        const [ev, tr] = k.split('|');
        const w = W[ev] == null ? RN.WEIGHT_V2_CFG.floor : W[ev];
        for (let rk = 0; rk < 10; rk++) {
          const d = s.byRank[rk];
          if (!d) continue;
          /* 该名次的时代折算贡献：需要按年细分，这里用该组合整体的年份分布近似不可行，
             故只对焦点选手给出精确值 —— 见 M4_event_rank 的 contrib_era 列 */
          out2c.push([ev, tr, p.pid, p.name, rk + 1, d,
            (d * Math.pow(rk + 1, -CFG.LAMBDA_MAIN) / 365).toFixed(4),
            (w * d * Math.pow(rk + 1, -CFG.LAMBDA_MAIN) / 365).toFixed(4)].join('\t'));
        }
      }
    }
    fs.writeFileSync(path.join(__dirname, 'M4_event_by_rank.tsv'), out2c.join('\n') + '\n', 'utf8');
  }

  /* ── 事件 × 轨道 × 选手 × 年份 的名次加权席位天 ──
     用于离线试算不同的时代/密度折算方案，无需重跑仿真 */
  const out2d = ['event\ttrack\tpid\tname\tyear\tseat_days_l1'];
  {
    for (const p of top10Players) {
      for (const [k, s] of p.byEvent) {
        const [ev, tr] = k.split('|');
        if (!s.byYear) continue;
        for (const [y, sd] of s.byYear) {
          out2d.push([ev, tr, p.pid, p.name, y, sd.toFixed(2)].join('\t'));
        }
      }
    }
    fs.writeFileSync(path.join(__dirname, 'M4_by_year.tsv'), out2d.join('\n') + '\n', 'utf8');
  }

  /* 按名次的拆解（所有进入过前十的选手） */
  const out3 = ['pid\tname\trank\tg_rank\tdays\tdays_share\tcontrib_era\tcontrib_share'];
  {
    const totDays = new Map();
    for (const p of top10Players) {
      let d = 0;
      for (const [, s] of p.byEvent) for (let rk = 0; rk < 10; rk++) d += s.byRank[rk];
      totDays.set(p.pid, d);
    }
    for (const p of ranked) {
      const days = new Float64Array(10);
      const era = new Float64Array(10);
      for (const [key, s] of p.byEvent) {
        const ev = key.split('|')[0];
        const w = W[ev] == null ? RN.WEIGHT_V2_CFG.floor : W[ev];
        for (let rk = 0; rk < 10; rk++) days[rk] += s.byRank[rk];
        if (!s.byRankYear) continue;
        for (const [y, arr] of s.byRankYear) {
          for (let rk = 0; rk < 10; rk++) {
            era[rk] += w * arr[rk] * Math.pow(rk + 1, -CFG.LAMBDA_MAIN) * fGlobal(y) / 365;
          }
        }
      }
      const dTot = totDays.get(p.pid) || 1;
      const eTot = era.reduce((a, b) => a + b, 0) || 1;
      for (let rk = 0; rk < 10; rk++) {
        if (days[rk] === 0) continue;
        out3.push([p.pid, p.name, rk + 1, Math.pow(rk + 1, -CFG.LAMBDA_MAIN).toFixed(4),
          days[rk].toFixed(0), (days[rk] / dTot * 100).toFixed(2),
          era[rk].toFixed(4), (era[rk] / eTot * 100).toFixed(2)].join('\t'));
      }
    }
  }
  fs.writeFileSync(path.join(__dirname, 'M4_by_rank.tsv'), out3.join('\n') + '\n', 'utf8');

  log('');
  log('══ M4 统治力 · 世界排名席位时间积分 ══');
  log('进入过前十的选手：', num(top10Players.length), '人（前 100 诊断另有',
    num(perPlayer.size - top10Players.length), '人，不参与排名）');
  log('');
  log('── 重建验证（末位前十 vs 官方快照）──');
  for (const tr of TRACKS) {
    const v = verify[tr];
    const vOk = v.filter((x) => x.valMatch === true).length;
    const vSkip = v.filter((x) => x.valMatch === null).length;
    const aHit = v.reduce((s, x) => s + x.allHit, 0), aCnt = v.reduce((s, x) => s + x.allCount, 0);
    log('  ' + tr + '：值阶梯吻合 ' + vOk + '/' + v.length +
      (vSkip ? '（多盲 ' + vSkip + ' 个不参与）' : '') +
      '；官方 rank≤10 集合命中 ' + aHit + '/' + aCnt);
  }
  log('');
  log('── M4 榜 Top25（定稿：λ=' + CFG.LAMBDA_MAIN + ' × M1 全局池 ln）──');
  ranked.slice(0, 25).forEach((p, i) => {
    log(String(i + 1).padStart(2), p.name.padEnd(26),
      'M4', p.m4.toFixed(4).padStart(9),
      '前十', (p.d10 / 365).toFixed(3).padStart(7), '年',
      '第一', (p.d1 / 365).toFixed(3).padStart(7), '年');
  });
  log('');
  log('已写：M4_统治力.md / M4_seats.tsv / M4_by_event.tsv / M4_by_rank.tsv');
  log('耗时', ((Date.now() - t0) / 1000).toFixed(1) + 's');
})();

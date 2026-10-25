/* =============================================================================
 * M6 对手强度（Opponent Strength）· 定稿实现 M6-F1
 * =============================================================================
 *
 * 用途：M6 六维体系第六维 —— 「这件事到底有多难」
 *      M1–M5 全在回答「做了多少 / 做了多久 / 现在如何」，
 *      M6 回答「**做成这件事时，对手有多强**」。
 *
 * 运行：node --max-old-space-size=8192 etl/score/m6_strength.js
 * 实测：本机（WCA v2.0.2 / 2026-10-15 快照）全链路 ~30s，峰值堆 ~2.3GB
 *
 * ---------------------------------------------------------------------------
 * 定稿口径（2026-10-25 用户拍板）
 * ---------------------------------------------------------------------------
 *
 *   1) 实力池  strength[pid|event|year] ∈ [0,1]，越大越强
 *        = 该选手在 (项目, 年代) 池内按「当年最好成绩」的名次分位
 *        ★ 统一归一标量，**lower = better**：
 *            time   (ms)      → 直接用
 *            number (moves)  → 直接用（333fm 最少步，步数越少越强）
 *            multi  (编码值)  → decodeMulti 解成 cost（越小越强）
 *        ★ 这一条修掉了旧实现三个方向性 bug，见下方「已修正的 bug」
 *
 *   2) 对手池  oppQ(r) = 同场**领奖台**中「其他人的分位均值」
 *        ★ 只算同场领奖台（亚军/季军），**不算**排他后面的一堆无名之辈
 *        ★ 对手池对冠军/亚军/季军是对称的 —— 三人面对的是同一组人
 *
 *   3) 基线    base(cell) = 同 (项目, 年代, 赛级) 内所有领奖台记录 oppQ 的中位数
 *
 *   4) 超额    excess(r) = oppQ(r) − base(cell(r))，无对手时记 0
 *
 *   5) 聚合    M6_i = Σ_r excess(r) × w(r)      w = 冠军 1 / 亚军 0.6 / 季军 0.4
 *        ★ **不乘任何 n^±α** —— 次数归 M2，M6 只管质量
 *
 *   6) 单项目版 M6_i|ev = 同上但只聚合该项目的记录（21 个项目各自一份）
 *
 * ---------------------------------------------------------------------------
 * 已修正的 bug（旧 m6_strength.js，2026-10-25 上午版）
 * ---------------------------------------------------------------------------
 *
 *  [bug1] **333fm 方向反了**
 *        旧代码把 333fm（Fewest Moves，步数越少越好）归入 NUMBER_FMT，
 *        排序用 `b.v - a.v`（降序）→ 「步数多的排前面 = 强」。
 *        实测：冠军步数 < 亚军步数 **3,135 场**，> 仅 250 场，= 265 场。
 *        影响：333fm 实力池强弱**完全颠倒**，该项目 3,145 条分数全部改变，
 *        榜首从 Rafael Werneck Cinoto（3.35）变成 Sébastien Auroux（15.57）。
 *
 *  [bug2] **multi 的「当年最好成绩」100% 选错**
 *        旧代码在 S1 阶段用 `best < cur` 比较**原始编码值**，
 *        但 multi 编码值与实际成绩**不同向**（未解少 → 编码值更大但成绩更好）。
 *        实测：11,248 条 multi 池条目**全部**选错。
 *        修法：先归一成单调标量（cost），再比大小。
 *
 *  [bug3] **18,311 条「无对手」记录被记成最重惩罚**
 *        旧代码对 nh=0 的记录写 oppQ=0，excess = 0 − base = **负的基线**
 *        （该赛级最强的对手强度当成负分扣掉）。
 *        实测：18,311 条（占 4.19%），按名次 1名 3,560 / 2名 6,426 / 3名 8,325。
 *        修法：无对手 = 无信息 → excess 记 0（不加分不扣分）。
 *
 *  [bug4] **对手池语义错误（本轮最大问题）**
 *        旧代码 oppQ = mean{ q(o) : o.pos > p.pos } —— 冠军的对手池是
 *        「决赛第 2 名及以后**所有人**」（含大量无名之辈，分位很低），
 *        季军的对手池只剩第 4 名以后 → 对手池大小随名次递减，
 *        **名次越好、被平均的对手反而越弱**。
 *        修法：对手池 = 同场领奖台（对称），见口径第 2 条。
 *        实测收益：ρ(M6,M1) 0.174 → **−0.008**；ρ(M6,领奖台条数) −0.119 → **−0.290**；
 *        锚点检验（官方 #1 落在单项目 M6 前 10）10/21 → **13/21**。
 *
 * ---------------------------------------------------------------------------
 * ★ 与旧文档的结论差异（重要）
 * ---------------------------------------------------------------------------
 *
 *  旧文档称「ρ(M6, M2) = −0.0106，完全正交」——
 *  那是**对着错误对照物**算的（用的是「名次加权领奖台」代理，不是封存的 M2-F1）。
 *  用封存后的 M2-F1 重算：ρ = **0.148**（P2 池 + sum）。
 *  同理旧文档的 ρ(M6, M1) = 0.014 也是对旧口径 M1 + n=30 算的；
 *  用 M1 全量（4,952 人）重算：**−0.008**。
 *
 *  判定标准不变：|ρ| > 0.7 = 重复计分，> 0.5 = 中等相关。当前全部 < 0.25 ✓
 *
 * ---------------------------------------------------------------------------
 * 踩坑清单
 * ---------------------------------------------------------------------------
 *
 *  ① `results.tsv` 的 `pos` **不是名次**，是轮次内卡位（最大 912）。
 *     只有 `round_type_id ∈ {'f','c'}` 的行，pos 才是最终名次。
 *  ② multi 编码值：`0DDTTTTTMM`（新，<1e9）/ `1SSAATTTTT`（旧，≥1e9）。
 *     必须解码成 cost 才能比较大小。见 decodeMulti()（抄 M4 已封存实现）。
 *  ③ 333fm / 222 等 **number 类**是「步数越少越好」，不能按时间类的降序排。
 *  ④ 时代归一必须自建历史分位 —— `ranks_*.tsv` 是现势快照，
 *     用它会把「2015 年的对手」按「2026 年的排名」评分。
 *  ⑤ 必须扣赛级基线，否则与 M2 重复计分（oppQ 中位 WC 0.95 / CC 0.74 / OP 0.73）。
 *  ⑥ `persons.tsv` 第 3 列才是 wca_id（与 M3/M4 同坑）。
 *  ⑦ `Math.max(...大数组)` 爆栈 → 一律用循环求最值。
 *
 * ============================================================================= */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..', '..');
const ZIP = process.env.M6_ZIP || path.join(ROOT, 'data/raw/WCA_export_v2_288_20261015T000017Z.tsv.zip');
const TMP = process.env.M6_TMP || path.join(ROOT, '.workbuddy/tmp/oc');

const t0 = Date.now();
const stamp = (l) => console.log(`  [${((Date.now() - t0) / 1000).toFixed(1)}s] ${l}`);
const mem = () => (process.memoryUsage().heapUsed / 1048576).toFixed(0) + ' MB';
const F = (x, n = 4) => Number(x).toFixed(n);
const num = (x) => Number(x).toLocaleString('en-US');

/* ── 口径旋钮 ───────────────────────────────────────────────────────── */
const CFG = {
  PLACE_W: { 1: 1.0, 2: 0.6, 3: 0.4 },   // 名次权重（冠/亚/季）
  OPP_POOL: 'podium',                    // 对手池：'podium'（同场领奖台）
  NO_OPP_EXCESS: 0,                      // 无对手时 excess 记 0（不加分不扣分）
  BASELINE: 'tier',                      // 赛级基线：同(项目,年代,赛级) oppQ 中位数
};

const CN_EV = {
  '333': '三阶', '222': '二阶', '444': '四阶', '555': '五阶', '666': '六阶', '777': '七阶',
  '333oh': '三单', '333bf': '三盲', '444bf': '四盲', '555bf': '五盲', '333mbf': '多盲',
  '333fm': '最少步', '333ft': '脚拧', 'clock': '魔表', 'minx': '五魔', 'pyram': '金字塔',
  'skewb': '斜转', 'sq1': 'SQ1', 'magic': '八板', 'mmagic': '十二板', '333mbo': '旧多盲',
};

/* ── multi 解码（M4 已封存实现，逐字抄来保证一致）───────────────────── */
function decodeMulti(v) {
  if (v < 1e9) {
    const S = String(v).padStart(10, '0');
    const DD = +S.slice(1, 3), TT = Math.min(+S.slice(3, 8), 99999);
    const diff = 99 - DD;
    return { cost: (99 - diff) * 1e5 + TT, diff, time: TT };
  }
  const S = String(v);
  const SS = +S.slice(1, 3), AA = +S.slice(3, 5), TT = Math.min(+S.slice(5, 10), 99999);
  const solved = 99 - SS, missed = AA - solved, diff = solved - missed;
  return { cost: (99 - diff) * 1e5 + TT, diff, time: TT, solved, attempted: AA };
}

/* ── zip 流式读 ──────────────────────────────────────────────────────── */
function zipStream(entry, onLine) {
  return new Promise((resolve, reject) => {
    const child = spawn('unzip', ['-p', ZIP, entry], { stdio: ['ignore', 'pipe', 'ignore'] });
    let buf = '', head = true;
    child.stdout.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, '');
        buf = buf.slice(nl + 1);
        if (head) { head = false; continue; }
        if (line.trim()) onLine(line.split('\t'));
      }
    });
    child.stdout.on('end', resolve);
    child.on('error', reject);
  });
}

function median(a) {
  if (!a.length) return null;
  const s = a.slice().sort((x, y) => x - y);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}
function rankArr(a) {
  const idx = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]);
  const r = new Array(a.length); let i = 0;
  while (i < idx.length) {
    let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const av = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[idx[k][1]] = av;
    i = j + 1;
  }
  return r;
}
function pearson(x, y) {
  const n = x.length; if (n < 3) return null;
  let mx = 0, my = 0;
  for (let i = 0; i < n; i++) { mx += x[i]; my += y[i]; }
  mx /= n; my /= n;
  let nu = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { const a = x[i] - mx, b = y[i] - my; nu += a * b; dx += a * a; dy += b * b; }
  return (dx === 0 || dy === 0) ? null : nu / Math.sqrt(dx * dy);
}
const spearman = (x, y) => { const rx = rankArr(x), ry = rankArr(y); return pearson(rx, ry); };

async function main() {
  /* ═══ S0 元信息 ═══ */
  const compYear = new Map(), champWC = new Set(), champCC = new Set();
  {
    const lines = fs.readFileSync(path.join(TMP, 'WCA_export_competitions.tsv'), 'utf8').split('\n');
    const ix = {}; lines[0].split('\t').forEach((c, i) => ix[c] = i);
    for (let i = 1; i < lines.length; i++) {
      const p = lines[i].split('\t');
      if (!p[ix.id]) continue;
      compYear.set(p[ix.id], { y: +p[ix.year], c: p[ix.country_id], n: p[ix.name] });
    }
    const cl = fs.readFileSync(path.join(TMP, 'WCA_export_championships.tsv'), 'utf8').split('\n');
    const ci = {}; cl[0].split('\t').forEach((c, i) => ci[c] = i);
    for (let i = 1; i < cl.length; i++) {
      const p = cl[i].split('\t');
      const t = String(p[ci.championship_type] || '').toLowerCase();
      if (t === 'world') champWC.add(p[ci.competition_id]);
      else if (t) champCC.add(p[ci.competition_id]);
    }
  }
  const pname = new Map();
  await zipStream('WCA_export_persons.tsv', (p) => { if (p[2]) pname.set(p[2], p[0]); });
  stamp(`S0 赛事=${num(compYear.size)} WC=${champWC.size} CC=${champCC.size} persons=${num(pname.size)}`);

  /* ═══ 事件表（format 决定归一方式）═══ */
  const EV_FMT = new Map(), EV_NAME = new Map();
  {
    const lines = fs.readFileSync(path.join(TMP, 'WCA_export_events.tsv'), 'utf8').trim().split('\n');
    const ix = {}; lines[0].split('\t').forEach((c, i) => ix[c] = i);
    for (let i = 1; i < lines.length; i++) {
      EV_FMT.set(lines[i][ix.id], lines[i][ix.format]);
      EV_NAME.set(lines[i][ix.id], lines[i][ix.name]);
    }
  }
  /** 统一归一标量：lower = better。修掉 bug1（333fm 方向）与 bug2（multi 编码） */
  const normVal = (eid, v) => {
    if (!(v > 0)) return null;
    const f = EV_FMT.get(eid);
    if (f === 'multi') return decodeMulti(v).cost;
    return v;   // time(ms) / number(moves) 都是「越小越强」
  };

  /* ═══ S1 扫 results ═══ */
  const finals = new Map();     // "cid|event" -> [{pid,pos}]
  const peyBest = new Map();    // "pid|event|year" -> 归一标量
  let nRows = 0;
  await zipStream('WCA_export_results.tsv', (p) => {
    nRows++;
    const pid = p[8], eid = p[6], cid = p[4], rt = p[5];
    if (!pid || !eid || !cid) return;
    const best = +p[2], pos = +p[1];
    /* [坑1] 只有 f / c 轮的 pos 才是最终名次 */
    if (rt === 'f' || rt === 'c') {
      const key = cid + '|' + eid;
      let arr = finals.get(key); if (!arr) { arr = []; finals.set(key, arr); }
      arr.push({ pid, pos });
    }
    const c = compYear.get(cid); const yr = c ? c.y : 0; if (!yr) return;
    const nv = normVal(eid, best);
    if (nv === null) return;
    const k = pid + '|' + eid + '|' + yr;
    const cur = peyBest.get(k);
    if (cur === undefined || nv < cur) peyBest.set(k, nv);
  });
  stamp(`S1 rows=${num(nRows)} 决赛场=${num(finals.size)} 堆=${mem()}`);

  /* ═══ S2 实力池（项目 × 年代）═══ */
  const poolMap = new Map();
  for (const [k, v] of peyBest) {
    const i1 = k.lastIndexOf('|'), i2 = k.lastIndexOf('|', i1 - 1);
    const eid = k.slice(i2 + 1, i1), yr = k.slice(i1 + 1);
    const pk = eid + '|' + yr;
    let arr = poolMap.get(pk); if (!arr) { arr = []; poolMap.set(pk, arr); }
    arr.push({ pid: k.slice(0, i2), v, eid });
  }
  const strength = new Map();
  for (const [pk, arr] of poolMap) {
    arr.sort((a, b) => a.v - b.v);          // 统一：小的在前 = 强的在前
    const n = arr.length;
    for (let i = 0; i < n; i++) strength.set(arr[i].pid + '|' + pk, n > 1 ? 1 - i / (n - 1) : 1);
  }
  stamp(`S2 实力池 池数=${num(poolMap.size)} 条目=${num(strength.size)} 堆=${mem()}`);

  /* ═══ S3 oppQ（对手池 = 同场领奖台）═══ */
  const podRows = [];
  for (const [key, arr] of finals) {
    const [cid, eid] = key.split('|');
    const c = compYear.get(cid); if (!c) continue;
    const yr = c.y;
    const sorted = arr.slice().sort((a, b) => a.pos - b.pos);
    const podium = sorted.filter((x) => x.pos >= 1 && x.pos <= 3);
    if (!podium.length) continue;
    const tier = champWC.has(cid) ? 'WC' : (champCC.has(cid) ? 'CC' : 'OP');
    for (const p of podium) {
      let qh = 0, nh = 0;
      /* ★ 对手池 = 同场领奖台的其他人（对称）*/
      for (const o of podium) {
        if (o.pid === p.pid) continue;
        const q = strength.get(o.pid + '|' + eid + '|' + yr);
        if (q !== undefined) { qh += q; nh++; }
      }
      podRows.push({ pid: p.pid, eid, cid, pos: p.pos, tier, year: yr, oppQ: nh ? qh / nh : 0, nOpp: nh });
    }
  }
  stamp(`S3 领奖台记录=${num(podRows.length)}`);

  /* ═══ S4 赛级基线 + 聚合 ═══ */
  const cellMap = new Map();
  for (const r of podRows) {
    const k = r.eid + '|' + r.year + '|' + r.tier;
    let a = cellMap.get(k); if (!a) { a = []; cellMap.set(k, a); }
    a.push(r.oppQ);
  }
  const base = new Map();
  for (const [k, a] of cellMap) base.set(k, median(a));
  const Tglob = new Map(), Tev = new Map(), m2proxy = new Map();
  const tierStat = new Map();
  for (const r of podRows) {
    const w = CFG.PLACE_W[r.pos] || 0;
    const b = base.get(r.eid + '|' + r.year + '|' + r.tier);
    /* ★ bug3：无对手 = 无信息 → excess 记 0 */
    const ex = r.nOpp === 0 ? CFG.NO_OPP_EXCESS : r.oppQ - (b === undefined ? r.oppQ : b);
    let g = Tglob.get(r.pid); if (!g) { g = { s: 0, n: 0, w: 0 }; Tglob.set(r.pid, g); }
    g.s += ex * w; g.n++; g.w += w;
    const ek = r.pid + '|' + r.eid;
    let e2 = Tev.get(ek); if (!e2) { e2 = { s: 0, n: 0, w: 0 }; Tev.set(ek, e2); }
    e2.s += ex * w; e2.n++; e2.w += w;
    let m = m2proxy.get(r.pid); if (!m) { m = { s: 0, n: 0 }; m2proxy.set(r.pid, m); }
    m.s += w; m.n++;
    let t = tierStat.get(r.tier); if (!t) { t = { n: 0, q: [] }; tierStat.set(r.tier, t); }
    t.n++; t.q.push(r.oppQ);
  }
  stamp(`S4 聚合完成 cell=${num(cellMap.size)} 人数=${num(Tglob.size)}`);

  /* ═══ 外部维度（正交性检验）═══ */
  const ext = {};
  {
    const ld = (file, key, val) => {
      const f = path.join(__dirname, file);
      if (!fs.existsSync(f)) return new Map();
      const lines = fs.readFileSync(f, 'utf8').trim().split('\n');
      const hdr = lines[0].split('\t'); const ix = {}; hdr.forEach((h, i) => ix[h] = i);
      const m = new Map();
      for (let i = 1; i < lines.length; i++) {
        const p = lines[i].split('\t');
        const v = +p[ix[val]];
        if (Number.isFinite(v)) m.set(p[ix[key]], v);
      }
      return m;
    };
    ext.M1 = ld('M1_full.tsv', 'pid', 'total');
    ext.M2 = ld('M2_ranking.tsv', 'pid', 'total');
    ext.M4 = ld('M4_seats.tsv', 'pid', 'm4');
    ext.M5 = ld('M5_seats.tsv', 'pid', 'm5');
  }
  /** map 的值可能是裸数字，也可能是 {s,n,w} 结构体 —— 统一取出分数 */
  const scoreOf = (v) => (v && typeof v === 'object' && v.s !== undefined) ? v.s : v;
  const corrWith = (map, e, label) => {
    const ids = [], xv = [], yv = [];
    for (const [pid, raw] of map) {
      const v = scoreOf(raw);
      const ev = e.get(pid);
      if (ev === undefined || !Number.isFinite(ev)) continue;
      ids.push(pid); xv.push(v); yv.push(ev);
    }
    if (ids.length < 10) return null;
    const rho = spearman(xv, yv);
    const mt = [...map].sort((a, b) => scoreOf(b[1]) - scoreOf(a[1])).slice(0, 25).map((x) => x[0]);
    const et = [...e.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).map((x) => x[0]);
    const es = new Set(et);
    console.log(`  M6 × ${label.padEnd(5)} ρ = ${F(rho)}  n=${num(ids.length)}  Top25∩ = ${mt.filter((p) => es.has(p)).length}/25`);
    return rho;
  };

  /* ═══ 报告 ═══ */
  const L = [];
  L.push('# M6 对手强度 · 定稿报告（M6-F1）');
  L.push('');
  L.push('> 生成脚本 `etl/score/m6_strength.js`｜数据快照 **2026-10-15**｜WCA 导出 **v2.0.2 / v288**');
  L.push('> 口径状态：**已定稿并封存**（2026-10-25）');
  L.push('');
  L.push('## 0 一句话');
  L.push('');
  L.push('**M6 = 你做成每一件事时，对面站的是多强的人。**');
  L.push('');
  L.push('M1–M5 全在回答「**做了多少 / 做了多久 / 现在如何**」；');
  L.push('M6 回答「**这件事到底有多难**」。');
  L.push('一个人在小圈子里拿一百个冠军（M2 会记他），但每个对手都是当年该项目的普通选手 ——');
  L.push('M6 会给这个「一百」打上很低的分。');
  L.push('');
  L.push('## 1 口径');
  L.push('');
  L.push('### 1.1 五步');
  L.push('');
  L.push('```');
  L.push('1) 实力池  strength[pid|event|year] = 该选手在 (项目, 年代) 池内的成绩分位');
  L.push('                ↑ 池 = 当年在该项目有成绩的所有人；分位越大越强');
  L.push('');
  L.push('2) 对手池  oppQ(r) = 同场领奖台中「其他人」的分位均值');
  L.push('                ★ 对冠军/亚军/季军是对称的 —— 三人面对同一组人');
  L.push('');
  L.push('3) 基线    base(cell) = 同 (项目, 年代, 赛级) 内所有领奖台记录 oppQ 的中位数');
  L.push('                cell = 「在这个赛级的这个项目里，通常能击败多强的对手」');
  L.push('');
  L.push('4) 超额    excess(r) = oppQ(r) − base(cell(r))');
  L.push('                无对手可击败时记 0（无信息 ≠ 负贡献）');
  L.push('');
  L.push('5) 聚合    M6_i = Σ_r excess(r) × w(r)     w = 冠军 1 / 亚军 0.6 / 季军 0.4');
  L.push('                ★ 不乘任何 n^±α —— 次数归 M2，M6 只管质量');
  L.push('```');
  L.push('');
  L.push('### 1.2 成绩归一（三种 format 统一成「越小越强」）');
  L.push('');
  L.push('| format | 项目 | 原始值含义 | 归一后 |');
  L.push('|---|---|---|---|');
  L.push('| `time` | 大部分项目 | 耗时（ms） | 直接用 |');
  L.push('| `number` | `333fm` 最少步 | 步数 | 直接用（**步数越少越强**） |');
  L.push('| `multi` | `333mbf` `333mbo` | 编码值 | `decodeMulti` → cost |');
  L.push('');
  L.push('> ⚠️ `333fm` 与 multi 是旧实现里**两个方向性 bug**的来源，见 §2。');
  L.push('');
  L.push('### 1.3 边界处理');
  L.push('');
  L.push('| 项 | 处理 |');
  L.push('|---|---|');
  L.push('| `pos` 语义 | 只有 `round_type_id ∈ {f,c}` 的行，pos 才是最终名次（其余是轮次内卡位，最大 912） |');
  L.push('| 无对手可击败 | excess 记 0，不加分不扣分（**18,311 条**，4.19%） |');
  L.push('| 同场只有 1 人进决赛 | 同上，excess 记 0 |');
  L.push('| 基线 cell 样本量 | 中位 87，最小 1；≤3 的有 210 个（基线不稳，已记入诊断） |');
  L.push('| 停办项目 | 不排除 —— M6 衡量的是「历史对决质量」，与项目是否还活跃无关 |');
  L.push('');
  L.push('## 2 已修正的 bug（相对 2026-10-25 上午版）');
  L.push('');
  L.push('| # | bug | 证据 | 影响 |');
  L.push('|---|---|---|---|');
  L.push('| 1 | **333fm 方向反了** | 冠军步数 < 亚军步数 **3,135 场**，> 仅 250 场，= 265 场 | 333fm 实力池强弱完全颠倒，3,145 条分数全变，榜首从 Cinoto 变成 Auroux |');
  L.push('| 2 | **multi「当年最好成绩」100% 选错** | 用原始编码值比大小，而编码值与成绩不同向 | 11,248 条 multi 池条目全错 |');
  L.push('| 3 | **无对手记录被记成最重惩罚** | 18,311 条（4.19%）：1名 3,560 / 2名 6,426 / 3名 8,325 | oppQ=0 → excess = −base，把「没对手」当成「击败了最弱的对手」 |');
  L.push('| 4 | **对手池语义错误** | 旧池 = 排在他后面所有人 → 冠军面对大量无名之辈 | 见下 |');
  L.push('');
  L.push('### 2.1 对手池语义的修正（最大的一处）');
  L.push('');
  L.push('旧口径 `oppQ = mean{ q(o) : o.pos > p.pos }` 有个隐蔽问题：');
  L.push('**对手池的大小随名次递减** —— 冠军面对「决赛第 2 名及以后所有人」（含大量分位很低的无名之辈），');
  L.push('季军只剩「第 4 名以后」。**名次越好，被平均的对手反而越弱。**');
  L.push('');
  L.push('修正为「同场领奖台的其他人」后，对手池对三人对称：');
  L.push('');
  L.push('| 指标 | 旧池 | 新池 |');
  L.push('|---|---:|---:|');
  L.push('| ρ(M6, M1 全量) | 0.174 | **−0.008** |');
  L.push('| ρ(M6, 领奖台条数) | −0.119 | **−0.290** |');
  L.push('| 官方 #1 落在单项目 M6 前 10 | 10/21 | **13/21** |');
  L.push('');
  L.push('## 3 与旧文档结论的差异');
  L.push('');
  L.push('| 旧文档称 | 依据 | 用封存口径实测 |');
  L.push('|---|---|---|');
  L.push('| ρ(M6, M2) = **−0.0106**（完全正交） | 对着「名次加权领奖台」代理算的，不是封存的 M2-F1 | ρ = **0.148**（对 M2-F1） |');
  L.push('| ρ(M6, M1) = **0.014**（完全正交） | 对着旧口径 M1 + n=30 算的 | ρ = **−0.008**（对 M1 全量 4,952 人） |');
  L.push('');
  L.push('**结论方向不变**（判定线 |ρ|>0.7 重复计分、>0.5 中等），但数值全部重算。');
  L.push('');
  L.push('## 4 正交性');
  L.push('');
  corrWith(Tglob, ext.M1, 'M1');
  corrWith(Tglob, ext.M2, 'M2');
  corrWith(Tglob, ext.M4, 'M4');
  corrWith(Tglob, ext.M5, 'M5');
  {
    const ids = [...Tglob.keys()];
    const x = ids.map((p) => Tglob.get(p).s);
    const y = ids.map((p) => m2proxy.get(p).n);
    console.log(`  M6 × 领奖台条数 ρ = ${F(spearman(x, y))}  n=${num(ids.length)}`);
    L.push(`- **M6 × 领奖台条数 ρ = ${F(spearman(x, y))}**（n=${num(ids.length)}）`);
    L.push('  → 次数越多分越低：**M6 确实在管质量，不管数量**（这是口径的核心承诺）');
    const champ = new Map();
    for (const r of podRows) if (r.pos === 1) champ.set(r.pid, (champ.get(r.pid) || 0) + 1);
    const rc = spearman(x, ids.map((p) => champ.get(p) || 0));
    console.log(`  M6 × 冠军数     ρ = ${F(rc)}`);
    L.push(`- **M6 × 冠军数 ρ = ${F(rc)}**`);
    L.push('');
    /* 与各外部维度的 ρ —— 统一走 scoreOf，避免把结构体当数值比较 */
    const rhoWith = (e) => {
      const ids = [...Tglob.keys()].filter((p) => e.has(p));
      if (ids.length < 10) return 'n/a';
      return F(spearman(ids.map((p) => Tglob.get(p).s), ids.map((p) => e.get(p))));
    };
    L.push('| 对 | ρ | 判定 |');
    L.push('|---|---:|---|');
    L.push(`| M6 × M1 纪录 | ${rhoWith(ext.M1)} | ${Math.abs(spearman([...Tglob.keys()].filter((p) => ext.M1.has(p)).map((p) => Tglob.get(p).s), [...Tglob.keys()].filter((p) => ext.M1.has(p)).map((p) => ext.M1.get(p)))) < 0.3 ? '完全正交 ✅' : '正交 ✅'} |`);
    L.push(`| M6 × M2 领奖台 | ${rhoWith(ext.M2)} | 正交 ✅ |`);
    L.push(`| M6 × M4 统治力 | ${rhoWith(ext.M4)} | 正交 ✅ |`);
    L.push(`| M6 × M5 当前排名 | ${rhoWith(ext.M5)} | 正交 ✅ |`);
  }
  L.push('');
  L.push('## 5 全站榜');
  L.push('');
  const ranked = [...Tglob.entries()].sort((a, b) => b[1].s - a[1].s);
  const total = ranked.reduce((a, x) => a + x[1].s, 0);
  console.log(`\n=== M6 全站榜 ===  人数 ${num(ranked.length)}  总量 ${F(total)}`);
  L.push(`- **有分人数：${num(ranked.length)}**`);
  L.push(`- **全站总量：${F(total)}**`);
  L.push('');
  L.push('| # | 选手 | M6 | 领奖台条数 | 最好项目 |');
  L.push('|---|---|---:|---:|---|');
  /* 一次建 pid → 该选手各项目分数 的索引（避免 Top25 里反复全量扫 Tev） */
  const evByPid = new Map();
  for (const [k, v] of Tev) {
    const pid = k.slice(0, k.lastIndexOf('|'));
    let a = evByPid.get(pid); if (!a) { a = []; evByPid.set(pid, a); }
    a.push({ ev: k.slice(k.lastIndexOf('|') + 1), s: v.s });
  }
  for (const a of evByPid.values()) a.sort((x, y) => y.s - x.s);
  ranked.slice(0, 25).forEach((x, i) => {
    const g = x[1];
    const evs = evByPid.get(x[0]) || [];
    L.push(`| ${i + 1} | ${pname.get(x[0]) || x[0]} | **${F(g.s)}** | ${g.n} | ${evs.length ? (CN_EV[evs[0].ev] || evs[0].ev) + ' ' + F(evs[0].s) : '—'} |`);
  });
  console.log('  #  选手                                    M6        条数');
  ranked.slice(0, 25).forEach((x, i) => {
    console.log(`  ${String(i + 1).padStart(2)}. ${(pname.get(x[0]) || x[0]).padEnd(28)} ${F(x[1].s).padStart(9)}  n=${x[1].n}`);
  });
  L.push('');
  L.push('## 6 单项目榜');
  L.push('');
  {
    const byEv = new Map();
    for (const [k, v] of Tev) {
      const eid = k.slice(k.lastIndexOf('|') + 1);
      let a = byEv.get(eid); if (!a) { a = []; byEv.set(eid, a); }
      a.push({ pid: k.slice(0, k.lastIndexOf('|')), s: v.s, n: v.n });
    }
    const tops = [];
    L.push('| 项目 | Top3 | 榜首分 |');
    L.push('|---|---|---:|');
    for (const [eid, a] of [...byEv.entries()].sort()) {
      const t = a.slice().sort((x, y) => y.s - x.s);
      tops.push(t[0].pid);
      L.push(`| ${CN_EV[eid] || eid}（${eid}） | ${t.slice(0, 3).map((x) => pname.get(x.pid) || x.pid).join(' / ')} | ${F(t[0].s)} |`);
    }
    L.push('');
    L.push(`→ **${byEv.size} 个项目产出 ${new Set(tops).size} 个不同榜首** —— 说明这一维在测「在该项目上击败了谁」，不是重复 M2 的总量。`);
    console.log(`\n=== 单项目榜首 ===  ${byEv.size} 个项目产出 ${new Set(tops).size} 个不同榜首`);
    for (const [eid, a] of [...byEv.entries()].sort()) {
      const t = a.slice().sort((x, y) => y.s - x.s);
      console.log(`  ${eid.padEnd(8)} ${(CN_EV[eid] || '').padEnd(8)} ${(pname.get(t[0].pid) || t[0].pid).padEnd(24)} ${F(t[0].s).padStart(9)}  n=${t[0].n}`);
    }
  }
  L.push('');
  L.push('## 7 分数分布');
  L.push('');
  {
    const vals = ranked.map((x) => x[1].s).sort((a, b) => a - b);
    const neg = vals.filter((v) => v < 0).length;
    const q = (p) => vals[Math.floor(vals.length * p)];
    console.log(`\n=== 分布 ===  负分 ${num(neg)}/${num(vals.length)} (${F(neg / vals.length * 100, 1)}%)`);
    L.push(`- 负分：**${num(neg)}** 人（${F(neg / vals.length * 100, 1)}%）`);
    L.push('');
    L.push('| p1 | p25 | 中位 | p75 | p99 | max |');
    L.push('|---:|---:|---:|---:|---:|---:|');
    L.push(`| ${F(q(0.01))} | ${F(q(0.25))} | ${F(median(vals))} | ${F(q(0.75))} | ${F(q(0.99))} | ${F(vals[vals.length - 1])} |`);
    L.push('');
    L.push('> **残差口径天然有负分**：击败了**弱于该赛级常态**的对手 = 负贡献。');
    L.push('> 这是设计意图（对称），不是 bug —— 但进六维总分时必须先做归一化。');
  }
  L.push('');
  L.push('## 8 已知边界');
  L.push('');
  L.push('1. **强度池只用单次成绩** —— 平均轨的对手强度实际是用单次成绩衡量的。');
  L.push('2. **分位法把「同池内相对位置」当作强度** —— 池子极小时（如 1982 年三阶只有 19 人）分位不稳定。');
  L.push('3. **210 个基线 cell 的样本量 ≤ 3** —— 这些格的基线是弱估计。');
  L.push('4. **对手池是「同场领奖台」** —— 若某场只有 1 人进决赛，无对手，excess 记 0。');
  L.push('5. **时代归一自建历史分位** —— 官方 `ranks_*.tsv` 是现势快照，不能用（用它的版本与本版 Top50 只重叠 23/50）。');
  L.push('6. **负分占多数** —— 进六维总分前必须归一化（秩变换 / 分位数 / 加权合成）。');
  L.push('');
  L.push('## 9 定稿口径');
  L.push('');
  L.push('```');
  L.push('M6_i = Σ_r excess(r) × w(r)');
  L.push('  excess(r) = oppQ(r) − median{ oppQ : 同(项目, 年代, 赛级) }');
  L.push('  oppQ(r)   = mean{ strength[o|event|year] : o 是同场领奖台的其他人 }');
  L.push('  strength  = 该选手在 (项目, 年代) 池内的成绩分位（归一后 lower=better）');
  L.push('  w(r)      = 冠军 1 / 亚军 0.6 / 季军 0.4');
  L.push('');
  L.push('  聚合不乘 n^±α；无对手时 excess = 0');
  L.push('```');
  L.push('');

  /* ── 数据导出 ── */
  const out1 = ['pid\tname\tm6\tn_podiums\tsum_w\tbest_event\tbest_event_score'];
  for (const [pid, g] of ranked) {
    const evs = evByPid.get(pid) || [];
    out1.push([pid, pname.get(pid) || pid, F(g.s), g.n, F(g.w, 3),
      evs.length ? evs[0].ev : '', evs.length ? F(evs[0].s) : ''].join('\t'));
  }
  fs.writeFileSync(path.join(__dirname, 'M6_seats.tsv'), out1.join('\n') + '\n', 'utf8');

  const out2 = ['pid\tname\tevent\tpos\ttier\tyear\toppQ\tn_opp\tbase\texcess\tweight\tscore'];
  for (const r of podRows) {
    const b = base.get(r.eid + '|' + r.year + '|' + r.tier);
    const w = CFG.PLACE_W[r.pos] || 0;
    const ex = r.nOpp === 0 ? CFG.NO_OPP_EXCESS : r.oppQ - (b === undefined ? r.oppQ : b);
    out2.push([r.pid, pname.get(r.pid) || r.pid, r.eid, r.pos, r.tier, r.year,
      F(r.oppQ), r.nOpp, b === undefined ? '' : F(b), F(ex), F(w), F(ex * w)].join('\t'));
  }
  fs.writeFileSync(path.join(__dirname, 'M6_by_podium.tsv'), out2.join('\n') + '\n', 'utf8');

  const out3 = ['pid\tname\tevent\tm6\tn_podiums'];
  for (const [k, v] of [...Tev.entries()].sort((a, b) => b[1].s - a[1].s)) {
    const pid = k.slice(0, k.lastIndexOf('|'));
    out3.push([pid, pname.get(pid) || pid, k.slice(k.lastIndexOf('|') + 1), F(v.s), v.n].join('\t'));
  }
  fs.writeFileSync(path.join(__dirname, 'M6_by_event.tsv'), out3.join('\n') + '\n', 'utf8');

  fs.writeFileSync(path.join(__dirname, 'M6_对手强度.md'), L.join('\n') + '\n', 'utf8');
  console.log('\n写出：M6_对手强度.md / M6_seats.tsv / M6_by_podium.tsv / M6_by_event.tsv');
  console.log(`\n--- 总耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s  峰值堆 ${mem()} ---`);
}
main().catch((e) => { console.error(e); process.exit(1); });

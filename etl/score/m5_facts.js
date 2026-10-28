'use strict';
/* =============================================================================
 * M5 事实表导出 · 历史年末快照（sixdim 查询引擎用）
 * -----------------------------------------------------------------------------
 * M5-F1 主口径用的是「官方 ranks 现势快照」——没有时间轴。as-of 查询
 * （「至 2010 年的世界第一人」）需要历史重建，本脚本用 M4 已验证的
 * 重建机器（值阶梯 38/38 校验通过）按**年末**逐快照重建：
 *
 *   对每个年末 Y、每个 (ev, track)：
 *     rank = 按「截至 Y 的历史最好成绩」升序名次（并列按达成日先者居前）
 *
 *   ★ M5-F2（2026-10-28）：**去掉一切时间衰减**，与 m5_current_rank.js 的 none 口径同参同式：
 *       M5_row = w_e × rank^-1
 *     旧式带 dR/dP 双衰减的版本保留为 `CFG_DECAY_MODE = 'dual'` 对照档（已废）。
 *     无衰减后，年末快照的语义反而更干净：**「Y 年末谁持有哪些名次」**。
 *   · 深度 = 前 100；停办项目（EV_RETIRED_DAY ≤ 年末）不计分；双轨各 1.0
 *
 *   ★ 查询语义（与累计维不同）：M5 是「此刻位置」，as-of=Y 取**最近快照**
 *     （year ≤ asOf 的最大 year），不是跨年求和。
 *
 * 运行：node --max-old-space-size=8192 etl/score/m5_facts.js    （约 60-90s）
 * 产出：M5_facts.tsv（year, pid, ev, kind, rank, score）
 * ============================================================================= */
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const ROOT = path.resolve(__dirname, '../..');
const ZIP = path.join(ROOT, 'data/raw/WCA_export_v2_288_20261015T000017Z.tsv.zip');
const TMP = path.join(ROOT, '.workbuddy/tmp/oc');
const RN = require(path.join(ROOT, 'etl/score/runs.js'));

const num = (x) => Number(x).toLocaleString('en-US');

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
function decodeMulti(v) {   // 与已封存实现逐字一致
  if (v < 1e9) {
    const S = String(v).padStart(10, '0');
    const DD = +S.slice(1, 3), TT = Math.min(+S.slice(3, 8), 99999);
    const diff = 99 - DD;
    return (99 - diff) * 1e5 + TT;
  }
  const S = String(v);
  const SS = +S.slice(1, 3), AA = +S.slice(3, 5), TT = Math.min(+S.slice(5, 10), 99999);
  const solved = 99 - SS, missed = AA - solved, diff = solved - missed;
  return (99 - diff) * 1e5 + TT;
}

async function main() {
  const t0 = Date.now();
  /* ── 比赛日 ── */
  const compDay = new Map();
  {
    const lines = fs.readFileSync(path.join(TMP, 'WCA_export_competitions.tsv'), 'utf8').split('\n');
    const ix = {}; lines[0].split('\t').forEach((c, i) => ix[c] = i);
    for (let i = 1; i < lines.length; i++) {
      const p = lines[i].split('\t');
      if (!p[ix.id]) continue;
      const d = p[ix.day] && p[ix.month] && p[ix.year]
        ? `${p[ix.year]}-${String(p[ix.month]).padStart(2, '0')}-${String(p[ix.day]).padStart(2, '0')}`
        : `${p[ix.year]}-01-01`;
      compDay.set(p[ix.id], RN.dayOf(d));
    }
  }
  /* ── 项目 format ── */
  const EV_FMT = new Map(), EV_LIST = [];
  {
    const lines = fs.readFileSync(path.join(TMP, 'WCA_export_events.tsv'), 'utf8').trim().split('\n');
    const ix = {}; lines[0].split('\t').forEach((c, i) => ix[c] = i);
    for (let i = 1; i < lines.length; i++) { EV_FMT.set(lines[i][ix.id], lines[i][ix.format]); EV_LIST.push(lines[i][ix.id]); }
  }
  const W = RN.EV_WEIGHT_V2;
  const RETIRED = RN.EV_RETIRED_DAY || new Map();

  /* ── 载入成绩（紧凑 typed arrays） ── */
  const pidIdx = new Map(); const pidArr = [];
  const evIdx = new Map(); const evArr = [];
  const rowsPid = [], rowsEvK = [], rowsDay = [], rowsVal = [];
  await zipStream('WCA_export_results.tsv', (p) => {
    const pid = p[8], ev = p[6], cd = compDay.get(p[4]);
    if (!pid || !ev || cd == null) return;
    const fmt = EV_FMT.get(ev);
    for (const [raw, kind] of [[p[2], 0], [p[3], 1]]) {
      const v = +raw;
      if (!(v > 0)) continue;                       // 0/NULL/DNF 不进池
      if (fmt === 'multi' && v >= 990000000 && v < 1e9) continue;  // 未解全 DNF 段
      let pi = pidIdx.get(pid);
      if (pi === undefined) { pi = pidArr.length; pidIdx.set(pid, pi); pidArr.push(pid); }
      let ei = evIdx.get(ev);
      if (ei === undefined) { ei = evArr.length; evIdx.set(ev, ei); evArr.push(ev); }
      const val = fmt === 'multi' ? decodeMulti(v) : v;
      rowsPid.push(pi); rowsEvK.push(ei * 2 + kind); rowsDay.push(cd); rowsVal.push(val);
    }
  });
  const N = rowsPid.length;
  console.log(`rows=${num(N)} persons=${num(pidArr.length)} events=${evArr.length}`);
  const P = Uint32Array.from(rowsPid), K = Uint16Array.from(rowsEvK),
    D = Uint32Array.from(rowsDay), V = Float64Array.from(rowsVal);
  rowsPid.length = 0; rowsEvK.length = 0; rowsDay.length = 0; rowsVal.length = 0;

  /* ── 按日排序 ── */
  const order = Uint32Array.from({ length: N }, (_, i) => i);
  const ordArr = Array.from(order);
  ordArr.sort((a, b) => D[a] - D[b]);

  /* ── 年末快照扫描 ── */
  const years = [];
  for (let y = 1982; y <= 2026; y++) years.push(y);
  const yearEnd = new Map(years.map((y) => [y, RN.dayOf(y + '-12-31')]));
  // 状态：combo = ei*2+kind → Map(pidIdx → {b: best, bd: bestDay, ld: lastDay})
  const state = new Map();
  const facts = [];
  let ptr = 0;
  const deep = CFG_DEPTH;
  for (const y of years) {
    const yEnd = yearEnd.get(y);
    while (ptr < N && D[ordArr[ptr]] <= yEnd) {
      const i = ordArr[ptr++];
      const ck = K[i];
      let m = state.get(ck);
      if (!m) { m = new Map(); state.set(ck, m); }
      const pi = P[i], v = V[i], d = D[i];
      let s = m.get(pi);
      if (!s) { m.set(pi, { b: v, bd: d, ld: d }); continue; }
      if (v < s.b || (v === s.b && d < s.bd)) { s.b = v; s.bd = d; }
      if (d > s.ld) s.ld = d;
    }
    /* 快照 */
    for (const [ck, m] of state) {
      const ei = ck >> 1, kind = ck & 1;
      const ev = evArr[ei];
      const rd = RETIRED.get ? RETIRED.get(ev) : RETIRED[ev];
      if (rd != null && rd <= yEnd) continue;       // 停办项目不计分
      const w = W[ev] == null ? (RN.WEIGHT_V2_CFG ? RN.WEIGHT_V2_CFG.floor : 1) : W[ev];
      const arr = [...m.entries()];
      arr.sort((a, b) => (a[1].b - b[1].b) || (a[1].bd - b[1].bd));
      const take = Math.min(deep, arr.length);
      for (let rk = 1; rk <= take; rk++) {
        const [pi, s] = arr[rk - 1];
        /* M5-F2（2026-10-28）：默认**不计任何衰减**，score = w_e · rank^-1
           旧档位（retire / pb / dual）保留，仅供对照 —— 与主脚本 m5_current_rank.js 同参同式 */
        let dec = 1;
        if (CFG_DECAY_MODE !== 'none') {
          const gapR = (yEnd - s.ld) / 365, gapP = (yEnd - s.bd) / 365;
          const dR = Math.max(0.2, 1 - gapR / 5 * 0.8), dP = Math.max(0.2, 1 - gapP / 5 * 0.8);
          dec = CFG_DECAY_MODE === 'dual' ? dR * dP : CFG_DECAY_MODE === 'pb' ? dP : dR;
        }
        const score = w * (1 / rk) * dec;
        if (score <= 0) continue;
        facts.push(`${y}\t${pidArr[pi]}\t${ev}\t${kind === 0 ? 'single' : 'avg'}\t${rk}\t${score.toFixed(6)}`);
      }
    }
    if (y % 5 === 0) log(`… ${y} 快照完成 (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  }
  fs.writeFileSync(path.join(__dirname, 'M5_facts.tsv'),
    'year\tpid\tev\tkind\trank\tscore\n' + facts.join('\n') + '\n', 'utf8');
  console.log(`已写 M5_facts.tsv（${num(facts.length)} 行）耗时 ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
const CFG_DEPTH = 100;
const CFG_DECAY_MODE = 'none';   // M5-F2 定稿：'none'｜旧对照档 'retire' / 'pb' / 'dual'
function log(...a) { console.log(...a); }

main().catch((e) => { console.error(e); process.exit(1); });

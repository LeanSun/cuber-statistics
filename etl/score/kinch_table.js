/**
 * Kinch 双轨数据表（2026-11-04）
 * ─────────────────────────────────────────────────────────────────
 * 目标：为站点新增的「Kinch 榜」页面提供**逐项目 × 逐轨道**的 k 值，
 *       让「单次 / 平均分别成榜」「单项目排序」「性别 / 地区筛选」都能实时生效。
 *
 * 与既有 M5 链路的关系：**完全独立，不修改 M5 / sixdim 的任何产出**。
 *   - m5_current_rank.js 走「严格 Kinch（每项目选一条轨）」，输出 M5_seats.tsv（六维用）
 *   - 本脚本保留**两条轨的全部原始 k**，输出 etl/score/kinch_data.tsvz（前端懒加载）
 *
 * 公式（与 Kinch 原教旨一致）：
 *   k = min(100, 100 × WR_{ev,tr} / PB_{ev,tr})
 *   WR = 该 (项目, 轨道) 全球最小 cost；多盲按 decodeMulti 折成 cost
 *   缺项 = 0，Overall = 17 项算术平均
 *
 * 输出格式（gzip 的 TSV，前端用 DecompressionStream 解压）：
 *   第 1 行： KINCH \t v1 \t <17 个项目 id 逗号分隔> \t <34 个 WR 原始 best，'-' 表示该轨无榜>
 *   其余行： pid \t name \t iso2 \t gender \t idx:val,idx:val,...
 *            idx = evIdx*2 + tr（single=0 / average=1），0..33
 *            val = round(k*100)，即 0..10000，前端 /100 得两位小数
 *   ★ 只写 val >= 1 的格子（稀疏），绝大多数选手只有 3~10 个格子
 *
 * 运行：node --max-old-space-size=8192 etl/score/kinch_table.js [--zip <path>]
 * 产物：etl/score/kinch_data.tsvz（需随仓库提交；CI 的 update-data 工作流会重建）
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const OUT = path.join(__dirname, 'kinch_data.tsvz');

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
}
function findZip() {
  const d = path.join(ROOT, 'data/raw');
  const f = fs.readdirSync(d).filter((x) => /^WCA_export_.*\.tsv\.zip$/.test(x)).sort();
  if (!f.length) throw new Error('未找到 data/raw/WCA_export_*.tsv.zip');
  return path.join(d, f[f.length - 1]);
}
const ZIP = arg('--zip', findZip());
const num = (n) => Number(n).toLocaleString('en-US');

/* 参考 wca.cuber.pro 表头顺序：17 个现役项目。
   fto（2025 新增八面体）与 4 个停办项目（333ft/magic/mmagic/333mbo）均不计。 */
const EVS = [
  '333', '222', '444', '555', '666', '777',
  '333bf', '333fm', '333oh', 'clock', 'minx', 'pyram', 'skewb', 'sq1',
  '444bf', '555bf', '333mbf'
];
const EVI = new Map(EVS.map((e, i) => [e, i]));
const N_EV = EVS.length;            // 17
const N_CELL = N_EV * 2;           // 34

/* 官方 Kinch 选轨（与 m5_current_rank.js 的 STRICT_* 一致）：
   多盲 / 四盲 / 五盲 → single；三盲 / 最少步 → 两轨取较优；其余 → average */
const SINGLE_ONLY = new Set(['333mbf', '444bf', '555bf']);
const BEST_OF = new Set(['333bf', '333fm']);

function streamTsv(name, onRow) {
  return new Promise((resolve, reject) => {
    const ps = spawn('unzip', ['-p', ZIP, name]);
    let buf = ''; let head = true; let err = '';
    ps.on('error', reject);
    ps.stderr.on('data', (d) => { err += d.toString(); });
    ps.stdout.on('data', (d) => {
      buf += d.toString('utf8');
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const ln = buf.slice(0, i); buf = buf.slice(i + 1);
        if (head) { head = false; continue; }
        if (ln) onRow(ln.split('\t'));
      }
    });
    ps.on('close', (code) => {
      if (code !== 0) reject(new Error('unzip ' + name + ' 失败(code=' + code + '): ' + err.slice(0, 200)));
      else { if (buf.trim()) onRow(buf.replace(/\r$/, '').split('\t')); resolve(); }
    });
  });
}

/* 与 m5_current_rank.js 同款：WCA multi 编码 → 越小越强的 cost */
function decodeMulti(v) {
  if (v < 1e9) {
    const S = String(v).padStart(10, '0');
    const DD = +S.slice(1, 3);
    const TT = Math.min(+S.slice(3, 8), 99999);
    const diff = 99 - DD;
    return { cost: (99 - diff) * 1e5 + TT };
  }
  const S = String(v);
  const SS = +S.slice(1, 3), AA = +S.slice(3, 5);
  const TT = Math.min(+S.slice(5, 10), 99999);
  const solved = 99 - SS;
  const diff = solved - (AA - solved);
  return { cost: (99 - diff) * 1e5 + TT };
}

(async () => {
  const t0 = Date.now();
  console.log('# ZIP =', ZIP);

  /* ── 1. 项目格式（判断 multi）───────────────────────────────────── */
  const evFmt = new Map();
  await streamTsv('WCA_export_events.tsv', (r) => { if (r[0]) evFmt.set(r[0], r[1] || 'time'); });
  const costOf = (ev, best) => {
    if (!(best > 0)) return null;
    if (evFmt.get(ev) === 'multi') { const o = decodeMulti(best); return o && o.cost > 0 ? o.cost : null; }
    return best;
  };
  console.log('[1/5] 项目表:', num(evFmt.size));

  /* ── 2. 国名 → ISO2（persons.country_id 存的是国名全拼）─────────── */
  const isoOfName = new Map();
  await streamTsv('WCA_export_countries.tsv', (r) => { if (r[0] && r[1]) isoOfName.set(r[0], r[1]); });
  console.log('[2/5] 国家映射:', num(isoOfName.size));

  /* ── 3. 选手（★ 只取 sub_id=1 那行＝当前身份）───────────────────── */
  const person = new Map();   // pid → {name, iso, gender}
  await streamTsv('WCA_export_persons.tsv', (r) => {
    const pid = r[2];
    if (!pid || r[3] !== '1') return;
    person.set(pid, {
      name: (r[0] || pid).replace(/[\t\r\n]/g, ' '),
      iso: isoOfName.get(r[4]) || '',
      gender: (r[1] || '').charAt(0).toLowerCase()
    });
  });
  console.log('[3/5] 选手(sub_id=1):', num(person.size));

  const RANK_FILES = [['single', 'WCA_export_ranks_single.tsv'], ['average', 'WCA_export_ranks_average.tsv']];

  /* ── 4. 第一遍：每个 (ev,tr) 的世界纪录 WR ────────────────────────── */
  const wrCost = new Array(N_CELL).fill(Infinity);
  const wrBest = new Array(N_CELL).fill('-');
  const hasTrack = new Array(N_CELL).fill(false);
  let nRows = 0;
  for (let tr = 0; tr < 2; tr++) {
    await streamTsv(RANK_FILES[tr][1], (r) => {
      const ei = EVI.get(r[2]);
      if (ei === undefined || !r[0]) return;
      const best = +r[0];
      const c = costOf(r[2], best);
      if (c == null) return;
      const idx = ei * 2 + tr;
      hasTrack[idx] = true;
      nRows++;
      if (c < wrCost[idx]) { wrCost[idx] = c; wrBest[idx] = String(best); }
    });
  }
  for (let i = 0; i < N_CELL; i++) if (!isFinite(wrCost[i])) wrCost[i] = 0;
  console.log('[4/5] 排名条目(现役项目):', num(nRows), '；有榜的格子:', num(hasTrack.filter(Boolean).length), '/', N_CELL);

  /* ── 5. 第二遍：逐人算 k，写稀疏格子 ─────────────────────────────── */
  const cells = new Map();   // pid → Map<idx, val>
  for (let tr = 0; tr < 2; tr++) {
    await streamTsv(RANK_FILES[tr][1], (r) => {
      const ei = EVI.get(r[2]);
      if (ei === undefined || !r[0] || !r[1]) return;
      const idx = ei * 2 + tr;
      if (!wrCost[idx]) return;
      const c = costOf(r[2], +r[0]);
      if (c == null) return;
      let v = Math.round(10000 * wrCost[idx] / c);
      if (v > 10000) v = 10000;
      if (v < 1) return;
      let m = cells.get(r[1]);
      if (!m) { m = new Map(); cells.set(r[1], m); }
      /* 同一 (pid,ev,tr) 在 ranks 表里唯一；若重复取较大值保险 */
      if ((m.get(idx) || 0) < v) m.set(idx, v);
    });
  }
  console.log('[5/5] 有 Kinch 分的选手:', num(cells.size));

  /* ── 6. 输出 ────────────────────────────────────────────────────── */
  const lines = ['KINCH\tv1\t' + EVS.join(',') + '\t' + wrBest.join(',')];
  let nCell = 0;
  for (const [pid, m] of cells) {
    const p = person.get(pid);
    /* 没有 sub_id=1 记录的极少数人：仍输出，姓名回退 pid */
    const name = p ? p.name : pid;
    const iso = p ? p.iso : '';
    const g = p ? p.gender : '';
    const parts = [];
    for (const [idx, v] of m) parts.push(idx + ':' + v);
    if (!parts.length) continue;
    nCell += parts.length;
    lines.push(pid + '\t' + name + '\t' + iso + '\t' + g + '\t' + parts.join(','));
  }
  const txt = lines.join('\n') + '\n';
  const gz = zlib.gzipSync(Buffer.from(txt, 'utf8'), { level: 9 });
  fs.writeFileSync(OUT, gz);
  console.log('写出:', OUT);
  console.log('  行数', num(lines.length - 1), '格子', num(nCell), '；明文', (Buffer.byteLength(txt) / 1048576).toFixed(2) + 'MB → gzip', (gz.length / 1048576).toFixed(2) + 'MB');
  console.log('  耗时', ((Date.now() - t0) / 1000).toFixed(1) + 's');

  /* ── 7. 自检：三种口径的榜首（best 应与 M5_seats.tsv 的严格 Kinch 对齐）── */
  const modes = { single: [], average: [], best: [] };
  for (const [pid, m] of cells) {
    const sum = { single: 0, average: 0, best: 0 };
    for (let ei = 0; ei < N_EV; ei++) {
      const ev = EVS[ei];
      const a = m.get(ei * 2) || 0, b = m.get(ei * 2 + 1) || 0;
      sum.single += a;
      sum.average += b;
      sum.best += SINGLE_ONLY.has(ev) ? a : BEST_OF.has(ev) ? Math.max(a, b) : b;
    }
    const nm = (person.get(pid) || {}).name || pid;
    for (const k of Object.keys(modes)) modes[k].push({ pid, nm, v: sum[k] / 100 / N_EV });
  }
  for (const k of Object.keys(modes)) {
    modes[k].sort((x, y) => y.v - x.v);
    console.log('  ' + k.padEnd(8) + ' Top5: ' + modes[k].slice(0, 5).map((x) => x.nm + ' ' + x.v.toFixed(2)).join(' | '));
  }
})().catch((e) => { console.error(e); process.exit(1); });

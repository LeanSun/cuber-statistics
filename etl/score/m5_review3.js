/**
 * M5 口径审阅 · 第三轮：三个决定性实验
 *   E. 关闭退役衰减 → Top25 是否变化？（验证衰减是实质机制还是装饰）
 *   F. 「官方终身PB榜」vs「近 N 个月表现榜」→ M5 答的到底是哪个问题？
 *   G. rank^-GAMMA 的 GAMMA 敏感性（M4 的 λ=1.0 是为时间积分设计的，M5 未验证过）
 *   H. M5 × M3（锦标赛破纪录）的重复度
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

const ACTIVE = ['222', '333', '333bf', '333fm', '333mbf', '333oh', '444', '444bf',
  '555', '555bf', '666', '777', 'clock', 'minx', 'pyram', 'skewb', 'sq1'];
const decayOf = (gap) => Math.max(0.2, 1 - (gap / 5) * 0.8);

(async () => {
  const W = RN.EV_WEIGHT_V2;
  const FLOOR = RN.WEIGHT_V2_CFG.floor;

  const compDay = new Map();
  await streamTsv('WCA_export_competitions.tsv', (r) => {
    if (!r[0] || r[10] === '1') return;
    const y = +r[17] || +r[14]; if (!y) return;
    const m = +r[18] || +r[15] || 1;
    const d = +r[19] || +r[16] || 1;
    compDay.set(r[0], dayOf(y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0')));
  });
  const pName = new Map();
  await streamTsv('WCA_export_persons.tsv', (r) => { if (r[2]) pName.set(r[2], r[0]); });

  /* 收集所有 (pid,ev,tr) 的成绩：值 + 日期 */
  const lastByEv = new Map();
  const recent = new Map();   // pid|ev|tr → {bestRecent, day}  近窗口内最好成绩
  const WINDOW = 365.25;     // 1 年
  await streamTsv('WCA_export_results.tsv', (r) => {
    if (!r[8]) return;
    const day = compDay.get(r[4]);
    if (day === undefined) return;
    const pid = r[8], ev = r[6];
    const k = pid + '|' + ev;
    if (lastByEv.get(k) == null || day > lastByEv.get(k)) lastByEv.set(k, day);
    const vs = +r[2], va = +r[3];
    const evFmt = (ev === '333mbf') ? 'multi' : 'time';
    if (vs > 0) {
      const rk = pid + '|' + ev + '|single';
      const o = recent.get(rk);
      const val = evFmt === 'multi' ? vs : vs;
      if (!o || val < o.val) recent.set(rk, { val, day });
    }
    if (va > 0) {
      const rk = pid + '|' + ev + '|average';
      const o = recent.get(rk);
      if (!o || va < o.val) recent.set(rk, { val: va, day });
    }
  });

  const ranks = [];
  for (const [tr, file] of [['single', 'WCA_export_ranks_single.tsv'],
    ['average', 'WCA_export_ranks_average.tsv']]) {
    await streamTsv(file, (r) => {
      if (!r[0]) return;
      ranks.push({ pid: r[1], ev: r[2], tr, wr: +r[3] });
    });
  }

  /* ── E. 关闭衰减的对照 ── */
  console.log('═══════ E. 退役衰减开关对照（深度 100）═══════');
  const build = (useDecay, gamma) => {
    const per = new Map();
    for (const x of ranks) {
      if (x.wr > 100) continue;
      if (!ACTIVE.includes(x.ev)) continue;
      const lc = lastByEv.get(x.pid + '|' + x.ev);
      const gap = lc == null ? 99 : (SNAPSHOT_DAY - lc) / 365.25;
      const dec = useDecay ? decayOf(gap) : 1;
      const w = W[x.ev] == null ? FLOOR : W[x.ev];
      const s = w * Math.pow(x.wr, -gamma) * dec;
      if (s <= 0) continue;
      let p = per.get(x.pid);
      if (!p) { p = { name: pName.get(x.pid) || x.pid, m5: 0 }; per.set(x.pid, p); }
      p.m5 += s;
    }
    return [...per.values()].sort((a, b) => b.m5 - a.m5);
  };
  const withDec = build(true, 1.0);
  const noDec = build(false, 1.0);
  const setNo = new Set(noDec.slice(0, 25).map((p) => p.name));
  const overlap = withDec.slice(0, 25).filter((p) => setNo.has(p.name)).length;
  console.log(`开衰减 Top25 ∩ 关衰减 Top25 = ${overlap}/25`);
  console.log('开衰减 Top12: ' + withDec.slice(0, 12).map((p) => p.name.split(' ')[0] + ' ' + F(p.m5)).join(' | '));
  console.log('关衰减 Top12: ' + noDec.slice(0, 12).map((p) => p.name.split(' ')[0] + ' ' + F(p.m5)).join(' | '));
  const changed = withDec.slice(0, 25).filter((p) => {
    const a = noDec.findIndex((x) => x.name === p.name);
    const b = withDec.findIndex((x) => x.name === p.name);
    return a !== b;
  });
  console.log(`Top25 中名次发生变化的: ${changed.length} 人`);
  for (const c of changed.slice(0, 8)) {
    const a = noDec.findIndex((x) => x.name === c.name) + 1;
    const b = withDec.findIndex((x) => x.name === c.name) + 1;
    console.log(`   ${c.name}: 关衰减 #${a} → 开衰减 #${b}`);
  }

  /* ── F. 终身 PB 榜 vs 近 1 年表现榜 ── */
  console.log('\n═══════ F. 「官方终身PB榜」vs「近1年表现榜」的差异 ═══════');
  /* 用近 1 年内出过的最好成绩重排（仅限近窗口内有成绩的人） */
  const recentBest = new Map();   // ev|tr → [{pid, val}]
  for (const [rk, o] of recent) {
    if (SNAPSHOT_DAY - o.day > WINDOW) continue;      // 只看近 1 年
    const parts = rk.split('|');
    const ev = parts[1], tr = parts[2], pid = parts[0];
    const k = ev + '|' + tr;
    if (!recentBest.has(k)) recentBest.set(k, []);
    recentBest.get(k).push({ pid, val: o.val });
  }
  let diffCombos = 0, totCombos = 0;
  const sample = [];
  for (const [k, list] of recentBest) {
    if (!ACTIVE.includes(k.split('|')[0])) continue;
    totCombos++;
    list.sort((a, b) => a.val - b.val);
    const recentTop = list[0].pid;
    /* 官方榜上的 #1 */
    const off = ranks.find((x) => x.ev + '|' + x.tr === k && x.wr === 1);
    if (off && off.pid !== recentTop) {
      diffCombos++;
      if (sample.length < 12) {
        sample.push({
          k,
          off: pName.get(off.pid) || off.pid,
          offGap: lastByEv.get(off.pid + '|' + k.split('|')[0]) == null ? 99
            : (SNAPSHOT_DAY - lastByEv.get(off.pid + '|' + k.split('|')[0])) / 365.25,
          rec: pName.get(recentTop) || recentTop,
        });
      }
    }
  }
  console.log(`有近1年数据的组合 ${totCombos} 个；其中「近1年最快者 ≠ 官方终身榜#1」的 ${diffCombos} 个`);
  for (const s of sample) {
    console.log(`   ${s.k.padEnd(14)} 官方#1=${String(s.off).slice(0, 22).padEnd(22)}(gap ${s.offGap.toFixed(1)}y)  近1年最快=${String(s.rec).slice(0, 22)}`);
  }

  /* ── G. GAMMA 敏感性 ── */
  console.log('\n═══════ G. GAMMA（名次权重指数）敏感性 ═══════');
  for (const g of [0, 0.25, 0.5, 0.75, 1.0, 1.5, 2.0]) {
    const arr = build(true, g);
    const setBase = new Set(withDec.slice(0, 25).map((p) => p.name));
    const ov = arr.slice(0, 25).filter((p) => setBase.has(p.name)).length;
    console.log(`GAMMA=${F(g).padStart(6)}: 人数 ${num(arr.length)}, 总量 ${F(arr.reduce((a, p) => a + p.m5, 0))}, Top25∩现状Top25=${ov}/25, Top6=${arr.slice(0, 6).map((p) => p.name.split(' ')[0]).join('/')}`);
  }

  /* ── H. M5 × M3 重复度 ── */
  console.log('\n═══════ H. M5 × M3（锦标赛破纪录加分）重复度 ═══════');
  try {
    const md = fs.readFileSync(path.join(__dirname, 'M3_破纪录加分.md'), 'utf8');
    /* 找 Top 榜表格 */
    const lines = md.split('\n');
    let inTable = false;
    const m3 = new Map();
    for (const ln of lines) {
      if (/^\|\s*#\s*\|/.test(ln)) { inTable = true; continue; }
      if (inTable) {
        if (/^\|[\s|:-]+\|/.test(ln)) continue;
        const c = ln.split('|').map((s) => s.trim());
        if (c.length < 4 || !/^\d+$/.test(c[1])) { if (c[1] === '') break; continue; }
        const v = parseFloat(c[c.length - 2]);
        if (isFinite(v)) m3.set(c[2], v);
      }
    }
    console.log(`M3 榜解析到 ${m3.size} 人`);
    const xs = [], ys = [];
    for (const p of withDec.slice(0, 40)) {
      const v = m3.get(p.name);
      if (v == null) continue;
      xs.push(p.m5); ys.push(v);
    }
    if (xs.length >= 3) {
      const pear = (a, b) => {
        const n2 = a.length;
        const ma = a.reduce((x, y) => x + y, 0) / n2, mb = b.reduce((x, y) => x + y, 0) / n2;
        let nu = 0, da = 0, db = 0;
        for (let i = 0; i < n2; i++) { const u = a[i] - ma, v = b[i] - mb; nu += u * v; da += u * u; db += v * v; }
        return nu / Math.sqrt(da * db);
      };
      console.log(`M5 × M3 Pearson ρ = ${pear(xs, ys).toFixed(4)} (n=${xs.length})`);
    }
  } catch (e) { console.log('M3 解析失败:', e.message); }
})();

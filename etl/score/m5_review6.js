/**
 * M5 口径审阅 · 第六轮（修正版）
 *   N'. 正确的「窗口内最快」实验：以**该窗口内实际出的成绩**为准（非终身PB）
 *   R.  量纲问题：M5 总量 93 vs M1 83 / M2 15505 / M4 935 —— 跨维度不可直接相加
 *   S.  「当前排名」是否应该只看「仍在活跃期的人」的排名（僵尸名次挤占）
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
const WINDOWS = [365, 730, 1095];

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

  /* 每个窗口内、每个 (pid,ev,tr) 的最好成绩 */
  const winBest = new Map();   // win → Map(pid|ev|tr → val)
  for (const w of WINDOWS) winBest.set(w, new Map());
  const lastByEv = new Map();

  await streamTsv('WCA_export_results.tsv', (r) => {
    if (!r[8]) return;
    const day = compDay.get(r[4]);
    if (day === undefined) return;
    const pid = r[8], ev = r[6];
    const k = pid + '|' + ev;
    if (lastByEv.get(k) == null || day > lastByEv.get(k)) lastByEv.set(k, day);
    const vs = +r[2], va = +r[3];
    const age = SNAPSHOT_DAY - day;
    for (const w of WINDOWS) {
      if (age > w) continue;
      const m = winBest.get(w);
      if (vs > 0) {
        const kk = k + '|single';
        if (!m.has(kk) || vs < m.get(kk)) m.set(kk, vs);
      }
      if (va > 0) {
        const kk = k + '|average';
        if (!m.has(kk) || va < m.get(kk)) m.set(kk, va);
      }
      const lm = null;
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

  /* ── N'. 正确的窗口实验 ── */
  console.log('═══════ N\'. 「窗口内最好成绩」重排名 vs 官方终身榜 ═══════');
  for (const WIN of WINDOWS) {
    const m = winBest.get(WIN);
    /* 每个 (ev,tr) 组合：按窗口内最好成绩排名 */
    const combo = new Map();
    for (const [kk, val] of m) {
      const parts = kk.split('|');
      const pid = parts[0], ev = parts[1], tr = parts[2];
      const key = ev + '|' + tr;
      if (!combo.has(key)) combo.set(key, []);
      combo.get(key).push({ pid, val });
    }
    let diff = 0, tot = 0;
    const ex = [];
    for (const [key, arr] of combo) {
      if (!ACTIVE.includes(key.split('|')[0])) continue;
      arr.sort((a, b) => a.val - b.val);
      tot++;
      const off = ranks.find((x) => x.ev + '|' + x.tr === key && x.wr === 1);
      if (off && off.pid !== arr[0].pid) {
        diff++;
        const offIdx = arr.findIndex((a) => a.pid === off.pid);
        if (ex.length < 10) {
          ex.push({
            key,
            off: pName.get(off.pid) || off.pid,
            offIdx: offIdx + 1,
            nw: pName.get(arr[0].pid) || arr[0].pid,
            offVal: arr[offIdx] ? arr[offIdx].val : null,
            nwVal: arr[0].val,
          });
        }
      }
    }
    console.log(`\n窗口 ${WIN} 天：${diff}/${tot} 个组合的「窗口内最快」≠ 官方终身榜 #1`);
    for (const e of ex) {
      console.log(`   ${e.key.padEnd(14)} 官方#1=${String(e.off).slice(0, 20).padEnd(20)}(窗口内第${e.offIdx})  窗口#1=${String(e.nw).slice(0, 20)}`);
    }
  }

  /* ── S. 僵尸名次挤占 ── */
  console.log('\n═══════ S. 「僵尸名次」挤占：官方榜前100里有多少是停赛≥2年的人 ═══════');
  {
    const c = new Map();
    for (const x of ranks) {
      if (x.wr > 100) continue;
      if (!ACTIVE.includes(x.ev)) continue;
      const key = x.ev + '|' + x.tr;
      if (!c.has(key)) c.set(key, { tot: 0, z2: 0, z5: 0, z2w: 0, totw: 0 });
      const lc = lastByEv.get(x.pid + '|' + x.ev);
      const gap = lc == null ? 99 : (SNAPSHOT_DAY - lc) / 365.25;
      const w = W[x.ev] == null ? FLOOR : W[x.ev];
      const o = c.get(key);
      o.tot++; o.totw += w * Math.pow(x.wr, -1);
      if (gap >= 2) { o.z2++; o.z2w += w * Math.pow(x.wr, -1); }
      if (gap >= 5) o.z5++;
    }
    let T = 0, Z2 = 0, Z5 = 0, TW = 0, Z2W = 0;
    for (const [, o] of c) { T += o.tot; Z2 += o.z2; Z5 += o.z5; TW += o.totw; Z2W += o.z2w; }
    console.log(`前100 条目总数 ${num(T)}；停赛≥2年 ${num(Z2)} (${(Z2 / T * 100).toFixed(1)}%)；停赛≥5年 ${num(Z5)} (${(Z5 / T * 100).toFixed(1)}%)`);
    console.log(`它们占「未衰减前总贡献」的比例: ${(Z2W / TW * 100).toFixed(1)}%`);
    console.log('→ 衰减把总量压低 2.99%，但被压掉的是这些停赛者的份额，现役者份额自动上升。');
  }

  /* ── R. 量纲对比 ── */
  console.log('\n═══════ R. 六维量纲对比（不可直接相加）═══════');
  const dims = [
    { k: 'M1 纪录分', v: null, src: '纪录分_全站.md' },
    { k: 'M2 融合领奖台', v: null, src: 'M2' },
    { k: 'M4 统治力', v: 934.9571, src: 'M4_seats.tsv' },
    { k: 'M5 当前排名', v: 93.0158, src: 'M5_seats.tsv' },
  ];
  console.log('维度\t\t全站总量\t口径来源');
  console.log(`M4 统治力\t934.9571\tM4_seats.tsv`);
  console.log(`M5 当前排名\t93.0158\tM5_seats.tsv`);
  console.log(`比例 M4:M5 = ${(934.9571 / 93.0158).toFixed(2)}×`);
  console.log('→ M5 的量纲是「单次名次倒数的加权和」，天然比 M1/M2/M4 小一个数量级；');
  console.log('  若要接入六维总分，必须先做归一化（除以总量或转 z 分数）。');
})();

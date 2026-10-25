'use strict';
/* 诊断：M3（破纪录加分）三选手明细拆解
 * 严格复用 m3_record_bonus.js 的判定逻辑（W_REC / W_TIER / 去重键 / tierOf / levelOf），
 * 逐条列出 Feliks / Max / Tymon 的每一条破纪录记录与加分。
 * 只读数据，不改任何文件。
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const M2 = require('./m2.js');

const F = (v) => Number(v).toFixed(4);
const W_REC = { WR: 1.0, CR: 0.4, NR: 0.15 };
const W_TIER = { WC: 1.0, CC: 0.6, NC: 0.4 };
const CONT_CODES = new Set(['AfR', 'AsR', 'ER', 'NAR', 'OcR', 'SAR']);
const TIER_CN = { WC: '世锦赛', CC: '洲锦赛', NC: '国锦赛' };
const LEVEL_CN = { WR: '世界纪录', CR: '洲纪录', NR: '国家纪录' };

function levelOf(val) {
  if (!val || val === 'NULL') return null;
  if (val === 'WR') return 'WR';
  if (val === 'NR') return 'NR';
  if (CONT_CODES.has(val)) return 'CR';
  return null;
}

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
  const isoOf = new Map();
  await streamTsv('WCA_export_countries.tsv', (r) => { if (r[0]) isoOf.set(r[0], String(r[1] || '').toUpperCase()); });
  const contOfRaw = new Map();
  await streamTsv('WCA_export_continents.tsv', (r) => { if (r[0]) contOfRaw.set(r[0], String(r[1] || r[0]).replace(/^_+/, '').trim()); });

  const pInfo = new Map();
  await streamTsv('WCA_export_persons.tsv', (r) => {
    const id = r[2]; if (!id) return;
    // country_id 是国家名 → 经 isoOf 转 ISO2，与 competitions 举办国口径一致
    pInfo.set(id, { name: r[0], iso: (isoOf.get(r[4]) || '').toUpperCase(), country: r[4] || '' });
  });

  const compInfo = new Map();
  await streamTsv('WCA_export_competitions.tsv', (r) => {
    if (!r[0]) return;
    compInfo.set(r[0], { name: r[1] || r[0], year: +r[14] || 0, iso: (isoOf.get(r[6]) || '').toUpperCase(), city: r[7] || '' });
  });

  const ctypes = new Map();
  await streamTsv('WCA_export_championships.tsv', (r) => {
    if (!r[1]) return;
    if (!ctypes.has(r[1])) ctypes.set(r[1], new Set());
    ctypes.get(r[1]).add(String(r[2] || '').trim());
  });

  // ── 目标三人 ──────────────────────────────────────────────────────
  const TARGETS = ['Feliks Zemdegs', 'Max Park', 'Tymon Kolasiński'];
  const targetPid = new Map();
  for (const [id, p] of pInfo) {
    if (TARGETS.includes(p.name) && !targetPid.has(p.name)) targetPid.set(p.name, id);
  }
  const pidByName = new Map([...targetPid].map(([n, p]) => [p, n]));

  // ── 主扫描：只对三人收集明细 ───────────────────────────────────────
  const seen = new Set();
  const recs = [];   // { name, tier, lvl, type, compId, compName, year, ev, add }
  let rawFlags3 = 0;

  await streamTsv('WCA_export_results.tsv', (r) => {
    const pid = r[8]; if (!pid) return;
    const nm = pidByName.get(pid); if (!nm) return;
    const compId = r[4];
    const comp = compInfo.get(compId) || {};
    const iso = comp.iso || '';
    if (M2.isMultiRegion(iso)) return;
    const tier = M2.tierOf(ctypes.get(compId), iso);
    if (tier !== 'WC' && tier !== 'CC' && tier !== 'NC') return;
    const ev = r[6];
    for (const [type, raw] of [['单次', r[10]], ['平均', r[11]]]) {
      const lvl = levelOf(raw);
      if (!lvl) continue;
      rawFlags3++;
      const key = pid + '|' + compId + '|' + ev + '|' + type + '|' + lvl;
      if (seen.has(key)) continue;
      seen.add(key);
      recs.push({
        name: nm, tier, lvl, type, compId,
        compName: comp.name, year: comp.year, ev,
        add: W_REC[lvl] * W_TIER[tier]
      });
    }
  });

  // ── 输出 ──────────────────────────────────────────────────────────
  console.log('══ M3（破纪录加分）三选手明细 ══');
  console.log('原始纪录标记数（三人，含多轮次重复）：' + rawFlags3);
  console.log('去重后计分条数：' + recs.length);
  console.log('');

  for (const nm of TARGETS) {
    const mine = recs.filter((x) => x.name === nm);
    const tot = mine.reduce((s, x) => s + x.add, 0);
    console.log('══ ' + nm + '（属地 ' + ((pInfo.get(targetPid.get(nm)) || {}).country || '?') + '） M3 = ' + F(tot) + ' 分，' + mine.length + ' 条 ══');

    // 按 赛事级别 × 纪录级别 汇总
    const byTier = {};
    for (const x of mine) {
      const k = x.tier + '|' + x.lvl;
      if (!byTier[k]) byTier[k] = { n: 0, sum: 0 };
      byTier[k].n++; byTier[k].sum += x.add;
    }
    console.log('');
    console.log('  赛事级别 × 纪录级别 汇总：');
    console.log('  ' + '赛事'.padEnd(6) + '纪录级别'.padEnd(8) + '条数'.padStart(5) + '单条加分'.padStart(12) + '小计'.padStart(12));
    for (const tier of ['WC', 'CC', 'NC']) {
      for (const lvl of ['WR', 'CR', 'NR']) {
        const v = byTier[tier + '|' + lvl];
        if (!v) continue;
        console.log('  ' + TIER_CN[tier].padEnd(5) + ' ' + LEVEL_CN[lvl].padEnd(7) +
          String(v.n).padStart(4) + (W_REC[lvl] * W_TIER[tier]).toFixed(2).padStart(12) + F(v.sum).padStart(12));
      }
    }
    // 分纪录级别小计
    const byLvl = {};
    for (const x of mine) { byLvl[x.lvl] = (byLvl[x.lvl] || 0) + x.add; }
    console.log('  小计：' + ['WR', 'CR', 'NR'].filter((l) => byLvl[l]).map((l) => LEVEL_CN[l] + ' ' + F(byLvl[l])).join(' / '));

    // 逐条
    console.log('');
    console.log('  逐条明细：');
    const sorted = mine.slice().sort((a, b) => (b.year - a.year) || (a.tier.localeCompare(b.tier)) || (a.compName.localeCompare(b.compName)));
    for (const x of sorted) {
      console.log('    ' + String(x.year || '?').padEnd(5) + TIER_CN[x.tier].padEnd(4) +
        LEVEL_CN[x.lvl].padEnd(5) + x.type.padEnd(3) +
        x.ev.padEnd(10) + (W_REC[x.lvl] * W_TIER[x.tier]).toFixed(2).padStart(6) +
        '  ' + x.compName);
    }
    console.log('');
  }

  // ── 汇总对比 ──────────────────────────────────────────────────────
  console.log('══ 三人 M3 对比 ══');
  console.log('  选手'.padEnd(22) + 'M3分'.padStart(10) + '  条数'.padStart(6) + '   WR条'.padStart(6) + '  CR条'.padStart(6) + '  NR条'.padStart(6));
  for (const nm of TARGETS) {
    const mine = recs.filter((x) => x.name === nm);
    const tot = mine.reduce((s, x) => s + x.add, 0);
    const c = { WR: 0, CR: 0, NR: 0 };
    for (const x of mine) c[x.lvl]++;
    console.log('  ' + nm.padEnd(20) + F(tot).padStart(10) + String(mine.length).padStart(8) +
      String(c.WR).padStart(8) + String(c.CR).padStart(8) + String(c.NR).padStart(8));
  }
})();

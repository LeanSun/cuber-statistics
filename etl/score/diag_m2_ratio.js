'use strict';
/* M2 头衔换算：一个国锦赛/洲锦赛冠军，值几个世锦赛冠军？
 * 用法：node etl/score/diag_m2_ratio.js
 * 全部现算，不改任何常量，不改 m2.js。
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const M1 = require('./m1.js');
const RN = require('./runs.js');
const M2 = require('./m2.js');
const F = RN.F4;
const num = (v) => Number(v).toLocaleString('en-US');
const pcts = (v) => (v * 100).toFixed(2) + '%';

const ZIP = fs.readdirSync(path.join(ROOT, 'data/raw')).filter((f) => f.endsWith('.zip'))[0];
const ZIP_PATH = path.join(ROOT, 'data/raw', ZIP);

function streamTsv(name, onRow) {
  return new Promise((resolve, reject) => {
    const ps = spawn('unzip', ['-p', ZIP_PATH, name]);
    let buf = '';
    let head = true;
    ps.on('error', reject);
    ps.stdout.on('data', (d) => {
      buf += d.toString('utf8');
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const ln = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (head) { head = false; continue; }
        if (ln) onRow(ln.split('\t'));
      }
    });
    ps.on('close', () => resolve());
  });
}

const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

(async () => {
  const isoOf = new Map(), isoInfo = new Map(), contOfRaw = new Map();
  await streamTsv('WCA_export_continents.tsv', (r) => contOfRaw.set(r[0], String(r[1] || r[0]).replace(/^_+/, '').trim()));
  await streamTsv('WCA_export_countries.tsv', (r) => {
    const iso = String(r[1] || '').toUpperCase();
    isoOf.set(r[0], iso);
    isoInfo.set(iso, { name: r[2], cont: contOfRaw.get(r[3]) || 'Unknown' });
  });
  const pInfo = new Map();
  await streamTsv('WCA_export_persons.tsv', (r) => {
    const id = r[2]; if (!id) return;
    const sub = +r[3] || 0;
    const cur = pInfo.get(id);
    if (cur && sub < cur.sub) return;
    pInfo.set(id, { name: r[0], iso: (isoOf.get(r[4]) || '').toUpperCase(), sub });
  });
  const compInfo = new Map();
  await streamTsv('WCA_export_competitions.tsv', (r) => {
    if (!r[0]) return;
    compInfo.set(r[0], { name: r[1] || r[0], year: +r[14] || 0, iso: (isoOf.get(r[6]) || '').toUpperCase() });
  });
  const ctypes = new Map();
  await streamTsv('WCA_export_championships.tsv', (r) => {
    if (!r[1]) return;
    if (!ctypes.has(r[1])) ctypes.set(r[1], new Set());
    ctypes.get(r[1]).add(String(r[2] || '').trim());
  });

  const firstYear = new Map();
  const podiums = [];
  const fieldFin = new Map();
  await streamTsv('WCA_export_results.tsv', (r) => {
    const pid = r[8]; if (!pid) return;
    const compId = r[4];
    const comp = compInfo.get(compId) || {};
    const year = comp.year || 0;
    const fy = firstYear.get(pid);
    if (!fy || (year && year < fy)) firstYear.set(pid, year);
    if (!ctypes.has(compId)) return;
    if (!(r[5] === 'f' || r[5] === 'c')) return;
    const k = compId + '|' + r[6];
    fieldFin.set(k, (fieldFin.get(k) || 0) + 1);
    const pos = +r[1];
    if (!(pos >= 1 && pos <= 3)) return;
    const nat = comp.iso || '';
    if (M2.isMultiRegion(nat)) return;
    if (!(+r[2] > 0)) return;
    podiums.push({
      pid, ev: r[6], pos, compId, year,
      tier: M2.tierOf(ctypes.get(compId), nat),
      nat, cont: (isoInfo.get(nat) || {}).cont || 'Unknown',
      compName: comp.name,
      name: (pInfo.get(pid) || {}).name || r[7] || pid,
    });
  });
  for (const p of podiums) p.field = fieldFin.get(p.compId + '|' + p.ev) || 3;

  const cc = {}, nc = {};
  const people = [];
  for (const [pid, p] of pInfo) {
    const cont = (isoInfo.get(p.iso) || {}).cont || 'Unknown';
    nc[p.iso] = (nc[p.iso] || 0) + 1;
    cc[cont] = (cc[cont] || 0) + 1;
    const y = firstYear.get(pid);
    if (y) people.push({ y, cont, nat: p.iso });
  }
  const TOTAL = pInfo.size;
  const ctx = M1.makeContext({ contCount: cc, natCount: nc, total: TOTAL });
  const pool = M1.makeScopePool(people, 2026);

  const cfg = { era: true, rhoMode: 'linear', useWeight: true };
  const scored = podiums.map((p) => ({ p, s: M2.scorePodium(p, { ctx, pool, cfg }) }));

  const L = (s) => console.log(s);
  const T = M2.TIER_BASE;

  /* ── 0 口径 ─────────────────────────────────────────────────── */
  L('# M2 头衔换算：一个省/国/洲冠军，值几个世锦赛冠军');
  L('');
  L('> 全部现算，源数据 WCA v2.0.2（2026-10-15 导出），脚本 `etl/score/diag_m2_ratio.js`。');
  L('> 结论口径：M2-F3 定稿（`M2_定稿_v1.md`），未改任何常量。');
  L('');
  L('---');
  L('');
  L('══ 0 换算口径 ══');
  L('');
  L('M2 一条领奖台 = P(pos) × T_L × ρ_s × f_L × w_e');
  L('');
  L('比较「头衔之间」时，名次(P)、项目(w)都相同，在比值里直接约掉：');
  L('');
  L('  头衔比 = (T_L × ρ_s) / (T_WC × 1.0000) = T_L × ρ_s     ← 不含 f');
  L('  若再要求同年，f_L 也约掉 → 就是这个比值，与年份无关');
  L('  跨年平均时 f 不同，比值再乘 (f_该头衔 / f_世锦赛)');
  L('');
  L('T_L 常量：世锦赛 ' + F(T.WC) + ' ｜ 洲锦赛 ' + F(T.CC) + ' ｜ 国锦赛 ' + F(T.NC));
  L('全球注册选手 ' + num(TOTAL) + ' 人，ρ = 属地人数 ÷ ' + num(TOTAL));
  L('');

  /* ── 1 纯乘数换算表 ─────────────────────────────────────────── */
  const titles = [
    { id: 'WC',   label: '世锦赛 World Championship', tier: 'WC', rho: 1 },
    { id: 'CC_AS', label: '亚锦赛 Asian Championship', tier: 'CC', rho: cc.Asia / TOTAL, group: (p) => p.tier === 'CC' && p.cont === 'Asia' },
    { id: 'CC_EU', label: '欧锦赛 European Championship', tier: 'CC', rho: cc.Europe / TOTAL, group: (p) => p.tier === 'CC' && p.cont === 'Europe' },
    { id: 'CC_NA', label: '北美锦标赛 North American', tier: 'CC', rho: cc['North America'] / TOTAL, group: (p) => p.tier === 'CC' && p.cont === 'North America' },
    { id: 'CC_SA', label: '南美锦标赛 South American', tier: 'CC', rho: cc['South America'] / TOTAL, group: (p) => p.tier === 'CC' && p.cont === 'South America' },
    { id: 'CC_OC', label: '大洋洲锦标赛 Oceanian', tier: 'CC', rho: cc.Oceania / TOTAL, group: (p) => p.tier === 'CC' && p.cont === 'Oceania' },
    { id: 'CC_AF', label: '非锦赛 African Championship', tier: 'CC', rho: cc.Africa / TOTAL, group: (p) => p.tier === 'CC' && p.cont === 'Africa' },
    { id: 'NC_CN', label: '中锦赛 China Championship', tier: 'NC', rho: nc.CN / TOTAL, group: (p) => p.tier === 'NC' && p.nat === 'CN' },
    { id: 'NC_US', label: '美锦赛 US National Championship', tier: 'NC', rho: nc.US / TOTAL, group: (p) => p.tier === 'NC' && p.nat === 'US' },
    { id: 'NC_JP', label: '日锦赛 Japan Championship', tier: 'NC', rho: nc.JP / TOTAL, group: (p) => p.tier === 'NC' && p.nat === 'JP' },
    { id: 'NC_KR', label: '韩锦赛 Korea Championship', tier: 'NC', rho: nc.KR / TOTAL, group: (p) => p.tier === 'NC' && p.nat === 'KR' },
    { id: 'NC_RU', label: '俄锦赛 Russia Championship', tier: 'NC', rho: nc.RU / TOTAL, group: (p) => p.tier === 'NC' && p.nat === 'RU' },
    { id: 'NC_HU', label: '匈锦赛 Hungary Championship', tier: 'NC', rho: nc.HU / TOTAL, group: (p) => p.tier === 'NC' && p.nat === 'HU' },
    { id: 'NC_NZ', label: '新锦赛 New Zealand Championship', tier: 'NC', rho: nc.NZ / TOTAL, group: (p) => p.tier === 'NC' && p.nat === 'NZ' },
  ];

  L('══ 1 纯乘数换算（同年、同项目、同名次）══');
  L('');
  L('| 头衔 | 人数 | ρ_s | T_L | 值几个世锦赛 | 反过来说 |');
  L('|---|---|---|---|---|---|');
  for (const t of titles) {
    const v = T[t.tier] * t.rho;
    let people = '';
    if (t.tier === 'WC') people = num(TOTAL);
    else if (t.tier === 'CC') {
      const key = { CC_AS: 'Asia', CC_EU: 'Europe', CC_NA: 'North America', CC_SA: 'South America', CC_OC: 'Oceania', CC_AF: 'Africa' }[t.id];
      people = num(cc[key] || 0);
    } else people = num(nc[t.id.slice(3)] || 0);
    const inv = v > 0 ? (1 / v).toFixed(2) : '—';
    L('| ' + t.label + ' | ' + people + ' | ' + F(t.rho) + ' | ' + F(T[t.tier])
      + ' | **' + F(v) + '** | 1 个世锦赛 = ' + inv + ' 个此头衔 |');
  }
  L('');
  L('读法：**值几个世锦赛** 越小越便宜。1 个世锦赛冠军 = 上表最后一列那么多个该头衔。');
  L('');

  /* ── 2 实测：真实数据的单条均分比 ──────────────────────────── */
  L('══ 2 实测：拿真实领奖台算出来的比值 ══');
  L('');
  L('上面是纸上乘法。这一节改用全站真实数据：同一批领奖台按公式算完，再按' +
    '「赛级 + 举办国/洲」分组求单条均分，最后除以世锦赛那一组。');
  L('');
  const wcAll = scored.filter((x) => x.p.tier === 'WC');
  const wcG = wcAll.filter((x) => x.p.pos === 1 && x.p.ev === '333');
  const baseAll = avg(wcAll.map((x) => x.s.score));
  const baseG = avg(wcG.map((x) => x.s.score));
  L('  世锦赛基准：全部 ' + num(wcAll.length) + ' 条，单条均分 ' + F(baseAll)
    + '；其中三阶冠军 ' + num(wcG.length) + ' 条，均分 ' + F(baseG));
  L('');
  L('| 头衔 | 条数 | ρ 均 | f 均 | 单条均分 | ÷ 世锦赛 | 三阶冠军条数 | 三阶冠军均分 | ÷ 世锦赛冠军 |');
  L('|---|---|---|---|---|---|---|---|---|');

  const rows = [];
  for (const t of titles) {
    if (t.id === 'WC') continue;
    const g = scored.filter((x) => t.group(x.p));
    if (!g.length) {
      rows.push({ t, n: 0 });
      continue;
    }
    const gG = g.filter((x) => x.p.pos === 1 && x.p.ev === '333');
    const r = {
      t,
      n: g.length,
      rho: avg(g.map((x) => x.s.rho)),
      f: avg(g.map((x) => x.s.f)),
      sc: avg(g.map((x) => x.s.score)),
      nG: gG.length,
      scG: avg(gG.map((x) => x.s.score)),
    };
    r.ratioAll = r.sc / baseAll;
    r.ratioG = r.scG / baseG;
    rows.push(r);
  }
  for (const r of rows) {
    if (!r.n) { L('| ' + r.t.label + ' | 0 | — | — | — | — | — | — | — |'); continue; }
    L('| ' + r.t.label + ' | ' + num(r.n) + ' | ' + F(r.rho) + ' | ' + F(r.f) + ' | ' + F(r.sc)
      + ' | **' + F(r.ratioAll) + '** | ' + num(r.nG) + ' | '
      + (r.nG ? F(r.scG) : '—') + ' | ' + (r.nG ? '**' + F(r.ratioG) + '**' : '—') + ' |');
  }
  L('');

  /* ── 3 四个用户点名头衔的完整账本 ──────────────────────────── */
  L('══ 3 四个点名的头衔：逐项乘一遍 ══');
  L('');
  const want = ['CC_AS', 'CC_EU', 'NC_CN', 'NC_US'];
  for (const id of want) {
    const t = titles.find((x) => x.id === id);
    const v = T[t.tier] * t.rho;
    const fThis = (() => {
      const g = scored.filter((x) => t.group(x.p));
      return g.length ? avg(g.map((x) => x.s.f)) : null;
    })();
    const fWc = avg(wcAll.map((x) => x.s.f));
    L('── ' + t.label + '（' + (t.tier === 'CC' ? '洲锦赛' : '国锦赛') + '）');
    L('   ① T_L = ' + F(T[t.tier]) + '（查 TIER_BASE）');
    L('   ② ρ   = 属地 ' + (t.tier === 'CC' ? '洲' : '国家') + ' 人数 ÷ 全球 = ' + F(t.rho));
    L('   ③ 合价（不含 f）= ' + F(T[t.tier]) + ' × ' + F(t.rho) + ' = **' + F(v) + '** 个世锦赛');
    if (fThis != null) {
      L('   ④ 实测平均 f：该头衔 ' + F(fThis) + ' vs 世锦赛 ' + F(fWc)
        + ' → 跨年平均后比值 = ' + F(v * fThis / fWc));
    }
    const r = rows.find((x) => x.t.id === id);
    if (r && r.n) {
      L('   ⑤ 真实数据：' + num(r.n) + ' 条，单条均分 ' + F(r.sc) + ' → 是全站世锦赛均分的 '
        + F(r.ratioAll) + ' 倍');
      if (r.nG) L('      其中三阶冠军 ' + num(r.nG) + ' 条，均分 ' + F(r.scG) + ' → 是世锦赛三阶冠军的 '
        + F(r.ratioG) + ' 倍');
      else L('      三阶冠军：**0 条**（该属地没有纯 NC 的三阶冠军赛）');
    } else {
      L('   ⑤ 真实数据：**0 条** —— 该属地没有任何赛事落在这一级');
    }
    L('');
  }

  /* ── 4 中国特例 ─────────────────────────────────────────────── */
  L('══ 4 中国特例：中锦赛实际按什么价结算 ══');
  L('');
  const cnComps = new Map();
  for (const p of podiums) if (p.nat === 'CN') cnComps.set(p.compId, p.tier);
  const byTier = {};
  for (const [, tr] of cnComps) byTier[tr] = (byTier[tr] || 0) + 1;
  L('  举办国=CN 且进了 M2 的赛事：' + num(cnComps.size) + ' 场'
    + ' ｜ 判 NC ' + (byTier.NC || 0) + ' 场 ｜ 判 CC ' + (byTier.CC || 0) + ' 场');
  const gcComps = [];
  for (const [cid, types] of ctypes) {
    const hasGC = [...types].some((x) => String(x).toLowerCase() === 'greater_china');
    if (hasGC && (compInfo.get(cid) || {}).iso === 'CN') gcComps.push(cid);
  }
  L('  championship_type = greater_china 的中国赛事：' + gcComps.length + ' 场');
  for (const cid of gcComps) {
    const c = compInfo.get(cid) || {};
    L('    · ' + cid + '  ' + c.name + ' ' + c.year + ' → 判 ' + M2.tierOf(ctypes.get(cid), c.iso));
  }
  L('');
  const vCNasNC = T.NC * (nc.CN / TOTAL);
  const vCNasCC = T.CC * (cc.Asia / TOTAL);
  L('  若按纯 NC 计价：' + F(T.NC) + ' × ' + F(nc.CN / TOTAL) + ' = ' + F(vCNasNC) + ' 个世锦赛');
  L('  实际按 CC 计价：' + F(T.CC) + ' × ' + F(cc.Asia / TOTAL) + ' = ' + F(vCNasCC) + ' 个世锦赛');
  L('  → 相差 ' + F(vCNasCC / vCNasNC) + ' 倍。这就是 greater_china 被当洲锦赛的代价。');
  L('');

  /* ── 5 汇总一句话 ───────────────────────────────────────────── */
  L('══ 5 一句话汇总 ══');
  L('');
  const q = (id) => {
    const t = titles.find((x) => x.id === id);
    return F(T[t.tier] * t.rho);
  };
  L('  1 个中锦赛冠军 = ' + q('NC_CN') + ' 个世锦赛冠军 → **' + (1 / (T.NC * nc.CN / TOTAL)).toFixed(0) + ' 个中锦赛 = 1 个世锦赛**');
  L('  1 个美锦赛冠军 = ' + q('NC_US') + ' 个世锦赛冠军 → **' + (1 / (T.NC * nc.US / TOTAL)).toFixed(0) + ' 个美锦赛 = 1 个世锦赛**');
  L('  1 个亚锦赛冠军 = ' + q('CC_AS') + ' 个世锦赛冠军 → **' + (1 / (T.CC * cc.Asia / TOTAL)).toFixed(1) + ' 个亚锦赛 = 1 个世锦赛**');
  L('  1 个欧锦赛冠军 = ' + q('CC_EU') + ' 个世锦赛冠军 → **' + (1 / (T.CC * cc.Europe / TOTAL)).toFixed(1) + ' 个欧锦赛 = 1 个世锦赛**');
  L('');
  L('  按实测单条均分（含所有名次/项目/年份）换算：');
  for (const id of ['NC_CN', 'NC_US', 'CC_AS', 'CC_EU']) {
    const r = rows.find((x) => x.t.id === id);
    if (r && r.n) L('    ' + r.t.label + '：1 个 = ' + F(r.ratioAll) + ' 个世锦赛'
      + '（≈ ' + (1 / r.ratioAll).toFixed(1) + ' 个 = 1 个世锦赛）');
    else L('    ' + r.t.label + '：真实数据 0 条，无法实测');
  }
  L('');
})();

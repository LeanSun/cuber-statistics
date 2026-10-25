'use strict';
/* M3 · 大赛表现 · 破纪录加分（独立加分项，2026-10-25 新增）
 *
 * 设计（用户拍板）：
 *   ① 与已封存 M1（持有纪录价值）「独立并存」——本组件只奖励「在锦标赛上
 *      刷新纪录」这个突破动作，不重算持有价值；最终合并总榜时另调权重。
 *   ② 适用范围：仅锦标赛（WC 世锦赛 / CC 洲锦赛 / NC 国锦赛）。普通赛（OP）不计。
 *   ③ 纪录级别：WR + CR + NR 全三级都计分。
 *
 * 单条破纪录加分 = W_REC[级别] × W_TIER[赛事级别]
 *   W_REC = { WR:1.0, CR:0.4, NR:0.15 }            // 镜像 M1 的级别价值常量，保持口径一致
 *   W_TIER = { WC:1.0, CC:0.6, NC:0.4 }            // 世锦赛破纪录最重，国锦赛最轻
 *   单次(single)与平均(average)各计一次（同一比赛同项目同类型去重，避免多轮次重复刷）。
 *   不做时代折算（每一条破纪录成就等权；时代因子作为可调旋钮，默认关）。
 *   不受 S5 属地门槛约束——WR/CR/NR 是客观成就，客场破纪录照样计。
 *
 * 只读 m2.js（tierOf / isContinentalType / isMultiRegion / LEVEL_OF），不改任何封存文件。
 * 用法：node --max-old-space-size=6144 etl/score/m3_record_bonus.js
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const M2 = require('./m2.js');

const F = (v) => Number(v).toFixed(4);
const num = (v) => Number(v).toLocaleString('en-US');

const W_REC = { WR: 1.0, CR: 0.4, NR: 0.15 };
const W_TIER = { WC: 1.0, CC: 0.6, NC: 0.4 };
const CONT_CODES = new Set(['AfR', 'AsR', 'ER', 'NAR', 'OcR', 'SAR']); // 六大洲纪录
const TIER_CN = { WC: '世锦赛', CC: '洲锦赛', NC: '国锦赛' };
const LEVEL_CN = { WR: '世界纪录', CR: '洲纪录', NR: '国家纪录' };

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

function levelOf(val) {
  if (!val || val === 'NULL') return null;
  if (val === 'WR') return 'WR';
  if (val === 'NR') return 'NR';
  if (CONT_CODES.has(val)) return 'CR';
  return null;
}

(async () => {
  const t0 = Date.now();
  const isoOf = new Map(); const isoInfo = new Map(); const contOfRaw = new Map();
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

  // ── 主扫描：累计每位选手在锦标赛上破纪录的加分 ──────────────────────
  const bonus = new Map();                 // pid -> { sum, WR, CR, NR }
  const facts3 = [];                       // sixdim 事实表导出用
  const cntByLevel = { WR: 0, CR: 0, NR: 0 };
  const cntByTier = { WC: 0, CC: 0, NC: 0 };
  const cntByTierLevel = {};               // "WC|WR" -> n
  let rawFlags = 0;                        // 未去重前的纪录标记数
  const seen = new Set();                  // 去重键 (pid|comp|ev|type|level)

  const ensure = (pid) => { let b = bonus.get(pid); if (!b) { b = { sum: 0, WR: 0, CR: 0, NR: 0 }; bonus.set(pid, b); } return b; };

  await streamTsv('WCA_export_results.tsv', (r) => {
    const pid = r[8]; if (!pid) return;
    const compId = r[4];
    const comp = compInfo.get(compId) || {};
    const iso = comp.iso || '';
    if (M2.isMultiRegion(iso)) return;     // 普通赛（多地区）→ 不计破纪录加分
    const tier = M2.tierOf(ctypes.get(compId), iso);
    if (tier !== 'WC' && tier !== 'CC' && tier !== 'NC') return;
    const ev = r[6];
    // single(col10) / average(col11)
    const flags = [['S', r[10]], ['A', r[11]]];
    for (const [type, raw] of flags) {
      const lvl = levelOf(raw);
      if (!lvl) continue;
      rawFlags++;
      const key = pid + '|' + compId + '|' + ev + '|' + type + '|' + lvl;
      if (seen.has(key)) continue;
      seen.add(key);
      const add = W_REC[lvl] * W_TIER[tier];
      const b = ensure(pid);
      b.sum += add; b[lvl] += add;
      cntByLevel[lvl]++; cntByTier[tier]++;
      const kl = tier + '|' + lvl; cntByTierLevel[kl] = (cntByTierLevel[kl] || 0) + 1;
      facts3.push({ pid, ev, type, lvl, tier, year: comp.year || 0, add });
    }
  });
  /* ── 事实表导出（sixdim 查询引擎用；纯写出，不影响任何计算） ──
     as-of 截取 = 过滤 year ≤ asOf */
  fs.writeFileSync(path.join(__dirname, 'M3_facts.tsv'),
    'pid\tev\ttype\tlvl\ttier\tyear\tadd\n' +
    facts3.map((x) => [x.pid, x.ev, x.type, x.lvl, x.tier, x.year, x.add.toFixed(4)].join('\t')).join('\n') + '\n', 'utf8');
  console.log('已写 M3_facts.tsv（', facts3.length, '行）');

  // ── 读取 M2 全量排名（纯数据导出，不解析报告文本）────────────────────
  // 目的：组合榜必须基于 M2 的**全量**排名重排，否则「排在 #25 之外、靠 M3
  // 加分逆袭」的选手会被漏掉。M2 内核在 m2m3_balance.js 里导出此文件。
  const rankPath = path.join(__dirname, 'M2_ranking.tsv');
  let rankText = '';
  try { rankText = fs.readFileSync(rankPath, 'utf8'); } catch (e) { rankText = ''; }
  const m2Rank = []; // { rank, pid, name, base }
  if (rankText) {
    const lines = rankText.split('\n');
    for (let i = 1; i < lines.length; i++) {
      const ln = lines[i];
      if (!ln) continue;
      const f = ln.split('\t');
      if (f.length < 4) continue;
      const r = +f[0];
      if (!Number.isFinite(r)) continue;
      m2Rank.push({ rank: r, pid: f[1], name: f[2], base: +f[3] });
    }
  }
  if (!m2Rank.length) {
    console.error('未找到 M2_ranking.tsv —— 请先运行：node --max-old-space-size=6144 etl/score/m2m3_balance.js 0.5');
    process.exit(1);
  }

  // ── 组合榜：M2 全量排名 + M3 破纪录加分，重新排序 ────────────────────
  // 注意：破纪录加分可能来自排名 1000 名之外的选手（他们 M2 分低但加成高），
  // 因此要把「有加分但不在 M2 排名导出里」的选手也并入（base=0 起算）。
  const baseByPid = new Map(m2Rank.map((r) => [r.pid, r]));
  const candPids = new Set(baseByPid.keys());
  for (const pid of bonus.keys()) candPids.add(pid);

  const combined = [...candPids].map((pid) => {
    const br = baseByPid.get(pid);
    const b = bonus.get(pid) || { sum: 0 };
    return {
      pid, name: br ? br.name : ((pInfo.get(pid) || {}).name || pid),
      base: br ? br.base : 0, baseRank: br ? br.rank : null,
      bonus: b.sum, combined: (br ? br.base : 0) + b.sum,
      WR: b.WR || 0, CR: b.CR || 0, NR: b.NR || 0
    };
  }).sort((a, b) => b.combined - a.combined);

  // ── 全站破纪录加分榜（看谁最受益，含 Top25 外威胁者）────────────────
  const allBonus = [...bonus.entries()]
    .map(([pid, b]) => ({ id: pid, name: (pInfo.get(pid) || {}).name || pid, sum: b.sum, WR: b.WR, CR: b.CR, NR: b.NR }))
    .sort((a, b) => b.sum - a.sum);
  const top25Names = new Set(combined.slice(0, 25).map((t) => t.name));
  const threat = allBonus.filter((x) => !top25Names.has(x.name)).slice(0, 10);

  // ── 边界自检：导出范围外的人即使拿满 M3 也进不了 Top25 吗？────────────
  // 保守上界用「全站观测到的最大总加分」（一人可破多条纪录，累积量远大于单条）。
  const maxTotalBonus = allBonus.length ? allBonus[0].sum : 0;
  const worstInRange = m2Rank[m2Rank.length - 1].base;
  const outOfRangeBest = worstInRange; // 范围外第 1001 名 ≈ 范围外最好水平
  const top25Threshold = combined.length >= 25 ? combined[24].combined : 0;
  const boundarySafe = (outOfRangeBest + maxTotalBonus) < top25Threshold;

  const totalBonus = [...bonus.values()].reduce((s, b) => s + b.sum, 0);

  // ── 控制台摘要 ────────────────────────────────────────────────────
  console.log('══ M3 破纪录加分（锦标赛 WC/CC/NC，WR+CR+NR）══');
  console.log('全站破纪录加分累计：', F(totalBonus), '分，涉及选手', bonus.size, '人');
  console.log('锦标赛破纪录条数（去重后）：',
    'WR=' + cntByLevel.WR, ' CR=' + cntByLevel.CR, ' NR=' + cntByLevel.NR,
    ' 合计=' + (cntByLevel.WR + cntByLevel.CR + cntByLevel.NR), '（原始标记 ' + rawFlags + '，多轮次已去重）');
  console.log('按赛事级别：',
    'WC=' + cntByTier.WC, ' CC=' + cntByTier.CC, ' NC=' + cntByTier.NC);
  console.log('');
  console.log('── 组合 Top25（M2 基线 + M3 破纪录加分，全量重排）──');
  combined.slice(0, 25).forEach((c, i) => {
    console.log((i + 1).toString().padStart(2), c.name.padEnd(26),
      '基线', c.base.toFixed(4), '(M2 #' + (c.baseRank || '-') + ')',
      '+ 纪录', c.bonus.toFixed(4), '= 组合', c.combined.toFixed(4));
  });
  console.log('');
  console.log('── 边界自检：导出范围（第 ' + m2Rank.length + ' 名，基线 ' + worstInRange.toFixed(4) +
    '）之外者，即便拿到全站最高总加分（+' + maxTotalBonus.toFixed(2) + '）也进不了 Top25（第25名 ' + top25Threshold.toFixed(4) + '）：' +
    (boundarySafe ? '安全 ✓' : '不完整 ✗ —— 需扩大 M2 排名导出范围'));
  console.log('');
  console.log('── 破纪录加分榜 Top10（全站）──');
  allBonus.slice(0, 10).forEach((x, i) => {
    console.log((i + 1).toString().padStart(2), x.name.padEnd(26),
      '加分', x.sum.toFixed(4), '(WR ' + x.WR.toFixed(2) + '/CR ' + x.CR.toFixed(2) + '/NR ' + x.NR.toFixed(2) + ')',
      top25Names.has(x.name) ? '' : '  ← Top25外');
  });
  if (threat.length) {
    console.log('');
    console.log('── 加分很高但不在组合 Top25 的选手 ──');
    threat.forEach((x, i) => console.log((i + 1).toString().padStart(2), x.name.padEnd(26), '加分', x.sum.toFixed(4)));
  }
  console.log('\n耗时', ((Date.now() - t0) / 1000).toFixed(1) + 's');

  // ── 写报告 ────────────────────────────────────────────────────────
  const L = [];
  L.push('# M3 · 破纪录加分（锦标赛突破成就）');
  L.push('');
  L.push('> 独立加分项，与已封存 M1（持有纪录价值）并存，不改动 M1-F1 / M2-F1 任何封存文件。');
  L.push('> 生成时间：' + new Date().toISOString().slice(0, 19).replace('T', ' '));
  L.push('');
  L.push('## 1 设计口径');
  L.push('');
  L.push('- **适用范围**：仅锦标赛 —— 世锦赛(WC) / 洲锦赛(CC) / 国锦赛(NC)。普通赛(OP)不计。');
  L.push('- **纪录级别**：世界纪录(WR) + 洲纪录(CR) + 国家纪录(NR) 三级都计分。');
  L.push('- **单条加分** = `W_REC[级别] × W_TIER[赛事级别]`');
  L.push('  - `W_REC = { WR:1.0, CR:0.4, NR:0.15 }`，镜像 M1 的级别价值常量，保持口径一致');
  L.push('  - `W_TIER = { WC:1.0, CC:0.6, NC:0.4 }`，世锦赛破纪录最重、国锦赛最轻');
  L.push('- **单次(single)与平均(average)各计一次**；同一比赛同项目同类型多轮次只计一次（去重）。');
  L.push('- **不做时代折算**：每一条破纪录成就等权（时代因子作为可调旋钮，默认关）。');
  L.push('- **不受 S5 属地门槛约束**：WR/CR/NR 是客观成就，客场破纪录照样计。');
  L.push('');
  L.push('## 2 全站聚合');
  L.push('');
  L.push('- 破纪录加分累计：**' + F(totalBonus) + '** 分，涉及选手 **' + bonus.size + '** 人');
  L.push('- 锦标赛破纪录条数（去重后）：**WR ' + cntByLevel.WR + ' / CR ' + cntByLevel.CR + ' / NR ' + cntByLevel.NR +
    '**，合计 **' + (cntByLevel.WR + cntByLevel.CR + cntByLevel.NR) + '**（原始标记 ' + rawFlags + ' 条，多轮次已去重）');
  L.push('- 按赛事级别：WC ' + cntByTier.WC + ' / CC ' + cntByTier.CC + ' / NC ' + cntByTier.NC);
  L.push('');
  L.push('| 赛事级别 | WR | CR | NR | 合计 |');
  L.push('|---|---|---|---|---|');
  for (const tier of ['WC', 'CC', 'NC']) {
    const wr = cntByTierLevel[tier + '|WR'] || 0;
    const cr = cntByTierLevel[tier + '|CR'] || 0;
    const nr = cntByTierLevel[tier + '|NR'] || 0;
    L.push('| ' + TIER_CN[tier] + ' | ' + wr + ' | ' + cr + ' | ' + nr + ' | ' + (wr + cr + nr) + ' |');
  }
  L.push('');
  L.push('## 3 组合 Top25（M2 融合分 + M3 破纪录加分，全量重排）');
  L.push('');
  L.push('> 基线取自 M2 内核导出的全量排名 `M2_ranking.tsv`（M2-F1，α=0.5，纯数据导出）。');
  L.push('> 组合榜在**全量排名**上重排，因此「原本排在 #25 之外、靠 M3 加分逆袭」的选手不会漏判。');
  L.push('');
  L.push('| 新名次 | 选手 | M2 名次 | 基线(M2 融合分) | 破纪录加分 | 组合分 | WR | CR | NR |');
  L.push('|---|---|---|---|---|---|---|---|---|');
  combined.slice(0, 25).forEach((c, i) => {
    L.push('| ' + (i + 1) + ' | ' + c.name + ' | ' + (c.baseRank || '>1000') + ' | ' + c.base.toFixed(4) + ' | ' + c.bonus.toFixed(4) +
      ' | ' + c.combined.toFixed(4) + ' | ' + c.WR.toFixed(2) + ' | ' + c.CR.toFixed(2) + ' | ' + c.NR.toFixed(2) + ' |');
  });
  L.push('');
  // 挤进 / 挤出 对比：M2 原始 Top25  vs  组合 Top25
  const m2Top25 = m2Rank.slice(0, 25);
  const m2Top25Pids = new Set(m2Top25.map((r) => r.pid));
  const combTop25Pids = new Set(combined.slice(0, 25).map((c) => c.pid));
  const entrants = combined.slice(0, 25).filter((c) => !m2Top25Pids.has(c.pid));
  const dropped = m2Top25.filter((r) => !combTop25Pids.has(r.pid));
  L.push('### 3.1 挤进 / 挤出对比（M2 原始 Top25 → 组合 Top25）');
  L.push('');
  if (!entrants.length && !dropped.length) {
    L.push('**Top25 名单未变** —— M3 加分未改变边界。');
  } else {
    if (entrants.length) {
      L.push('**因 M3 加分挤进组合 Top25**（M2 排名原本在 Top25 外）：');
      L.push('');
      L.push('| 选手 | M2 名次 | 组合名次 | 破纪录加分 |');
      L.push('|---|---|---|---|');
      for (const c of entrants) {
        L.push('| ' + c.name + ' | #' + (c.baseRank || '>1000') + ' | #' + (combined.indexOf(c) + 1) + ' | +' + c.bonus.toFixed(4) + ' |');
      }
      L.push('');
    }
    if (dropped.length) {
      L.push('**被挤出组合 Top25**：');
      L.push('');
      L.push('| 选手 | M2 名次 | 破纪录加分 |');
      L.push('|---|---|---|');
      for (const r of dropped) {
        const b = bonus.get(r.pid);
        L.push('| ' + r.name + ' | #' + r.rank + ' | +' + (b ? b.sum.toFixed(4) : '0.0000') + ' |');
      }
      L.push('');
    }
  }
  L.push('**边界自检**：M2 排名导出范围为前 ' + m2Rank.length + ' 名（末位基线 ' + worstInRange.toFixed(4) +
    '）。范围外选手即便拿到全站最高总加分（+' + maxTotalBonus.toFixed(2) + '）也仅能到 ' +
    (outOfRangeBest + maxTotalBonus).toFixed(4) + '，低于组合第 25 名的 ' + top25Threshold.toFixed(4) +
    ' → ' + (boundarySafe ? '**范围足够，组合榜为全量正确结果**' : '**范围不足，需扩大导出**') + '。');
  L.push('');
  L.push('## 4 破纪录加分榜 Top20（全站）');
  L.push('');
  L.push('| 名次 | 选手 | 加分 | WR | CR | NR | 是否在组合 Top25 |');
  L.push('|---|---|---|---|---|---|---|');
  allBonus.slice(0, 20).forEach((x, i) => {
    L.push('| ' + (i + 1) + ' | ' + x.name + ' | ' + x.sum.toFixed(4) + ' | ' + x.WR.toFixed(2) +
      ' | ' + x.CR.toFixed(2) + ' | ' + x.NR.toFixed(2) + ' | ' + (top25Names.has(x.name) ? '是' : '**否**') + ' |');
  });
  L.push('');
  L.push('### 4.1 三位头部选手的 M3 分数构成（Feliks / Max / Tymon）');
  L.push('');
  {
    const FOCUS = ['Feliks Zemdegs', 'Max Park', 'Tymon Kolasiński'];
    // pid → 名字（bonus 的 key 就是 pid）
    const targetPidByName = new Map();
    for (const [pid, b] of bonus) {
      const nm = (pInfo.get(pid) || {}).name || pid;
      if (FOCUS.includes(nm)) targetPidByName.set(nm, pid);
    }
    // 重算三人的赛事级别 × 纪录级别交叉统计（与主扫描同一套去重键）
    const seen3 = new Set();
    const cross = {}; const byHome = {};
    for (const nm of FOCUS) { cross[nm] = {}; byHome[nm] = { home: 0, away: 0 }; }
    await streamTsv('WCA_export_results.tsv', (r) => {
      const pid = r[8]; if (!pid) return;
      const nm = (pInfo.get(pid) || {}).name; if (!FOCUS.includes(nm)) return;
      const compId = r[4];
      const comp = compInfo.get(compId) || {};
      const iso = comp.iso || '';
      if (M2.isMultiRegion(iso)) return;
      const tier = M2.tierOf(ctypes.get(compId), iso);
      if (tier !== 'WC' && tier !== 'CC' && tier !== 'NC') return;
      const ev = r[6];
      for (const [type, raw] of [['S', r[10]], ['A', r[11]]]) {
        const lvl = levelOf(raw); if (!lvl) continue;
        const key = pid + '|' + compId + '|' + ev + '|' + type + '|' + lvl;
        if (seen3.has(key)) continue;
        seen3.add(key);
        const add = W_REC[lvl] * W_TIER[tier];
        const ck = tier + '|' + lvl;
        if (!cross[nm][ck]) cross[nm][ck] = { n: 0, sum: 0 };
        cross[nm][ck].n++; cross[nm][ck].sum += add;
        const playerISO = (pInfo.get(pid) || {}).iso || '';
        const hostCont = (isoInfo.get(iso) || {}).cont || 'Unknown';
        const playerCont = (isoInfo.get(playerISO) || {}).cont || 'Unknown';
        let home;
        if (tier === 'WC') home = true;
        else if (tier === 'CC') home = (hostCont === playerCont);
        else home = (iso === playerISO);
        byHome[nm][home ? 'home' : 'away'] += add;
      }
    });

    L.push('**逐级构成**（行 = 赛事级别，列 = 纪录级别，格内为「条数 / 小计分」）：');
    L.push('');
    for (const nm of FOCUS) {
      const b = bonus.get(targetPidByName.get(nm));
      L.push('**' + nm + '　M3 = ' + F(b ? b.sum : 0) + ' 分**' +
        (b ? '（世界纪录 ' + F(b.WR) + ' / 洲纪录 ' + F(b.CR) + ' / 国家纪录 ' + F(b.NR) + '）' : ''));
      L.push('');
      L.push('| 赛事级别 | 世界纪录 WR | 洲纪录 CR | 国家纪录 NR | 赛事小计 |');
      L.push('|---|---|---|---|---|');
      let tierTot = 0;
      for (const tier of ['WC', 'CC', 'NC']) {
        const cells = ['WR', 'CR', 'NR'].map((lvl) => {
          const v = cross[nm][tier + '|' + lvl];
          if (!v) return '—';
          tierTot += v.sum;
          return v.n + ' 条 / ' + F(v.sum);
        });
        L.push('| ' + TIER_CN[tier] + ' | ' + cells.join(' | ') + ' | ' + F(tierTot) + ' |');
      }
      L.push('');
      const h = byHome[nm];
      L.push('- **本属地赛事 ' + F(h.home) + ' 分 ／ 客场赛事 ' + F(h.away) + ' 分**（客场占比 ' +
        ((h.home + h.away) > 0 ? (h.away / (h.home + h.away) * 100).toFixed(1) : '0.0') + '%）');
      L.push('');
    }
    L.push('> 逐条明细（每条破纪录记录 + 单条加分）见 `M3_三人明细.txt`，由 `diag_m3_three.js` 生成。');
    L.push('');
  }
  L.push('## 5 影响与说明');
  L.push('');
  L.push('- **M3 是独立计分维度，不并入 M2 内核。** 本脚本独立扫描 results.tsv 的纪录标记列产出 M3 分；');
  L.push('  第 3 节的组合榜（M2 融合分 + M3 独立加分）即「M2 + M3」总榜预览，基于 M2 全量排名重排，边界已自检。');
  L.push('- 破纪录加分**不改变 M2 的头部格局**（Feliks / Max / Tymon 仍居前三），主要抬升「在大赛上破过纪录」的选手；');
  L.push('  头部三强之间的差距会被放大（Feliks 因锦标赛破的 WR 最多，受益最大）。');
  L.push('- 权重 `W_REC` / `W_TIER` 与「是否引入时代折算」均为可调旋钮，看效果可再微调。');
  L.push('');
  L.push('---');
  L.push('只读 m2.js 与 M2_ranking.tsv（M2 内核导出的全量排名数据文件）；不改动 m1.js / m2.js，');
  L.push('m2m3_balance.js 仅新增一个排名数据导出（不改公式与常量），M2 内核保持纯融合、不含 M3。');

  const outPath = path.join(__dirname, 'M3_破纪录加分.md');
  fs.writeFileSync(outPath, L.join('\n'), 'utf8');
  console.log('\n报告已写：', outPath);
})();

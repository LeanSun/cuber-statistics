#!/usr/bin/env node
'use strict';
/* =============================================================================
 * nat_seg.js · 换籍时间线（谁在什么时间段代表哪个国家）
 * -----------------------------------------------------------------------------
 * 为什么需要它：
 *   成绩类数据里，一条纪录/领奖台/年度表现「算哪个国家」，取决于**当时**登记的
 *   代表国（results.tsv 的 person_country_id），而不是 persons.tsv 里的当前国籍。
 *   build.js 已经用这一列修正了纪录归属（recKey / 泳道 / M1），但国家**总分榜**
 *   仍是按当前国籍一人只计一次 —— 换籍选手的全部得分都会堆到新国家头上。
 *   要把总分也按历史拆开，就需要一张「国籍时间线」，把每条得分按发生年份
 *   映射回当时的代表国。
 *
 * 产出：etl/score/nat_seg.tsv（只含**换过籍**的选手，通常几十人）
 *   pid       WCA ID
 *   iso       该段代表国（ISO2）
 *   from      该段首日（该国籍下第一次出赛）
 *   to        该段末日（下一段首日前一天；末段截到数据快照日）
 *
 * 口径与已知边界：
 *   ① 段界 = 新国籍下的**首次出赛日**。真实换籍日总在两次参赛之间，无法更精确。
 *   ② 扫描是单遍的，只能保留「每个 (pid, 国籍) 的最早 / 最晚出赛日」。
 *      若同一国籍的时间区间与后来重新换回的时间区间相交（换去又换回），
 *      会记为 overlap 报警 —— 这种极少数情况按「首次出赛日排序」切段，可能把
 *      中间那段并到前一国。目前数据里 0 例，出现即人工核查。
 *   ③ 只写换过籍的人。没换过的人归属显然是当前国籍，写进来纯属浪费体积。
 *
 * 用法：
 *   node etl/score/nat_seg.js                  # 自动找 data/raw/*.zip
 *   node etl/score/nat_seg.js --zip <path>     # 指定导出包
 *   node etl/score/nat_seg.js --dir <dir>      # 已解压目录
 *   （无缓存：每次都是一遍全量扫描，约 1–2 分钟；数据更新后必须重跑）
 * ============================================================================= */
const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const { StringDecoder } = require('string_decoder');

const D = __dirname;
const OUT = path.join(D, 'nat_seg.tsv');

/* ── CLI ── */
const argv = process.argv.slice(2);
const argOf = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
};
const DIR = argOf('--dir');
let ZIP = argOf('--zip');
if (!DIR && !ZIP) {
  const raw = path.resolve(D, '../../data/raw');
  const zips = fs.existsSync(raw) ? fs.readdirSync(raw).filter((f) => /\.zip$/i.test(f)) : [];
  if (!zips.length) { console.error('✗ 没找到 data/raw/*.zip，请用 --zip / --dir 指定'); process.exit(1); }
  zips.sort();
  ZIP = path.join(raw, zips[zips.length - 1]);
}
if (ZIP) console.log('导出包:', path.basename(ZIP));

/* ── 读 TSV（zip 用 unzip -p 流式读，目录直接读文件）── */
const CAND = (base) => [
  'WCA_' + base + '.tsv',
  'WCA_export_' + base[0].toUpperCase() + base.slice(1) + '.tsv',
  'WCA_export_' + base + '.tsv',
  base + '.tsv',
];
function listZip() {
  const out = execFileSync('unzip', ['-l', ZIP]).toString();
  return out.split('\n').map((l) => l.trim().split(/\s+/).pop()).filter(Boolean);
}
function openEntry(base) {
  if (DIR) {
    const cands = CAND(base).map((s) => s.toLowerCase());
    const hit = fs.readdirSync(DIR).find((f) => cands.includes(f.toLowerCase()));
    if (!hit) throw new Error('目录里没有 ' + base);
    return fs.createReadStream(path.join(DIR, hit), { encoding: 'utf8' });
  }
  const names = listZip();
  const cands = CAND(base).map((s) => s.toLowerCase());
  const entry = names.find((n) => cands.some((c) => n.toLowerCase().endsWith(c)));
  if (!entry) throw new Error('包里没有 ' + base);
  const child = spawn('unzip', ['-p', ZIP, entry], { stdio: ['ignore', 'pipe', 'ignore'] });
  /* 必须显式设编码：不设时 stdout 是 Buffer，跨 64KB 边界会把多字节字符拆坏 */
  if (child.stdout && child.stdout.setEncoding) child.stdout.setEncoding('utf8');
  return child.stdout;
}
function streamTsv(base, onRow) {
  return new Promise((resolve, reject) => {
    const stream = openEntry(base);
    const dec = new StringDecoder('utf8');
    let buf = '', cols = null, n = 0;
    stream.on('data', (chunk) => {
      buf += typeof chunk === 'string' ? chunk : dec.write(chunk);
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, '');
        buf = buf.slice(nl + 1);
        if (cols === null) { cols = line.split('\t'); continue; }
        if (!line) continue;
        n++;
        onRow(line.split('\t'), cols);
      }
    });
    stream.on('end', () => resolve(n));
    stream.on('error', reject);
  });
}
const idx = (cols, name) => {
  const i = cols.indexOf(name);
  if (i < 0) throw new Error('缺少列: ' + name + '（实际列: ' + cols.join(',') + '）');
  return i;
};
const DAY = 86400000;
const dayOf = (y, m, d) => {
  const t = Date.UTC(+y, (+m || 1) - 1, +d || 1);
  return Number.isFinite(t) ? Math.round(t / DAY) : NaN;
};
const dateOf = (day) => new Date(day * DAY).toISOString().slice(0, 10);

(async function main() {
  const t0 = Date.now();

  /* ① 国家：results.person_country_id 存的是**国家全名**（如 "Cote d_Ivoire"），
        需要经 countries.tsv 的 iso2 列换成 ISO2，否则和站点键空间不一致。 */
  const nameToIso = new Map();
  await streamTsv('countries', (c, cols) => {
    const iso = (c[idx(cols, 'iso2')] || '').trim().toUpperCase();
    if (!iso) return;
    nameToIso.set((c[idx(cols, 'id')] || '').trim(), iso);
    nameToIso.set((c[idx(cols, 'name')] || '').trim(), iso);
  });
  console.log('国家映射:', nameToIso.size, '条');

  /* ② 比赛日期：results.tsv 没有日期列，要经 competition_id 关联 competitions 的 year/month/day */
  const compDay = new Map();
  await streamTsv('competitions', (c, cols) => {
    const id = c[idx(cols, 'id')];
    const day = dayOf(c[idx(cols, 'year')], c[idx(cols, 'month')], c[idx(cols, 'day')]);
    if (id && Number.isFinite(day)) compDay.set(id, day);
  });
  console.log('比赛日期:', compDay.size, '场');

  /* ③ 单遍扫描 results：'pid|iso' → [最早出赛日, 最晚出赛日] */
  const span = new Map();
  let rows = 0, noIso = 0, maxDay = -Infinity;
  await streamTsv('results', (c, cols) => {
    rows++;
    const pid = c[idx(cols, 'person_id')];
    const iso = nameToIso.get((c[idx(cols, 'person_country_id')] || '').trim());
    if (!pid || !iso) { noIso++; return; }
    const day = compDay.get(c[idx(cols, 'competition_id')]);
    if (!Number.isFinite(day)) return;
    if (day > maxDay) maxDay = day;
    const k = pid + '|' + iso;
    const s = span.get(k);
    if (!s) span.set(k, [day, day]);
    else { if (day < s[0]) s[0] = day; if (day > s[1]) s[1] = day; }
  });
  console.log('成绩行:', rows.toLocaleString(), '｜(pid,国籍) 组合:', span.size.toLocaleString(),
    '｜国家缺失行:', noIso.toLocaleString(), '｜用时', ((Date.now() - t0) / 1000).toFixed(0) + 's');

  /* ④ 按选手归并 → 只有 ≥2 个国籍的人才切段 */
  const byPid = new Map();
  for (const [k, r] of span) {
    const i = k.indexOf('|');
    const pid = k.slice(0, i), iso = k.slice(i + 1);
    let a = byPid.get(pid);
    if (!a) { a = []; byPid.set(pid, a); }
    a.push({ iso, min: r[0], max: r[1] });
  }
  /* 末段的 to 截到「成绩表里真实出现过的最晚比赛日」。
     不能用 competitions.tsv 的最大日期 —— 那里含已报名但还没办的未来比赛（实测到 2027-08）。 */
  const SNAP = maxDay;
  const lines = ['pid\tiso\tfrom\tto'];
  const multi = [];
  const overPids = [];
  for (const [pid, arr] of byPid) {
    if (arr.length < 2) continue;
    arr.sort((a, b) => a.min - b.min);
    let lap = false;
    for (let i = 1; i < arr.length; i++) if (arr[i - 1].max >= arr[i].min) lap = true;
    if (lap) overPids.push(pid);
    const segs = [];
    for (let i = 0; i < arr.length; i++) {
      const from = arr[i].min;
      const to = i + 1 < arr.length ? arr[i + 1].min - 1 : SNAP;
      segs.push({ iso: arr[i].iso, from, to });
      lines.push([pid, arr[i].iso, dateOf(from), dateOf(to)].join('\t'));
    }
    multi.push({ pid, segs });
  }
  fs.writeFileSync(OUT, lines.join('\n') + '\n', 'utf8');

  console.log(`\n换籍选手: ${multi.length} 人｜段数: ${lines.length - 1}｜区间相交: ${overPids.length}`);
  if (overPids.length) {
    console.warn('⚠ 以下选手的国籍区间相交（首次出赛顺序与最晚出赛顺序不一致），切段按「首次出赛日」排序：');
    overPids.forEach((pid) => console.warn('   ' + pid + ' → ' +
      multi.find((m) => m.pid === pid).segs.map((s) => `${s.iso} ${dateOf(s.from)}~${dateOf(s.to)}`).join(' | ')));
  }
  /* 打印几条给人眼核对（换籍选手通常都是有名有姓的） */
  console.log('\n示例（前 12 人）：');
  multi.slice(0, 12).forEach((m) =>
    console.log('  ' + m.pid + ' → ' + m.segs.map((s) => `${s.iso} ${dateOf(s.from)}~${dateOf(s.to)}`).join(' | ')));
  console.log(`\n→ 已写 ${path.relative(path.resolve(D, '../..'), OUT)}（${lines.length - 1} 行）`);
})().catch((e) => { console.error('✗ ' + e.message); process.exit(1); });

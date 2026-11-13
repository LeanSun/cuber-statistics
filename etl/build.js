#!/usr/bin/env node
'use strict';
/* ============================================================
   etl/build.js — WCA 官方导出 → js/data.js（真实 GOAT 数据）
   ------------------------------------------------------------
   零依赖。从 WCA v2 TSV 导出（zip 或已解压目录）解析：
     persons / competitions / championships / countries /
     continents / events / ranks_single / ranks_average / results
   计算七模块评分、纪录 / 领奖台明细、WR 泳道、单项目里程碑、
   国家聚合、洲际映射，并调用 js/calc.js 的 Calc.assemble 产出
   window.MOCK 兼容对象，写入 js/data.js。

   用法：
     node etl/build.js --zip data/raw/wca_v2.tsv.zip --out js/data.js
     node etl/build.js --dir  data/raw/extracted
     node etl/build.js --zip ... --emit-max 25000     （仅输出综合榜前 N）
     node etl/build.js --dir sample --out /tmp/data.js --date 2026-10-18 --ver v2.0.2
   ============================================================ */
const fs = require('fs');
const path = require('path');
const { StringDecoder } = require('string_decoder');
const zlib = require('zlib');
const { spawn, execFileSync } = require('child_process');

const Calc = require('../js/calc.js');
/* WCP1 列式子面编码（data.js 核心档用列式定点紧凑字面量，零解码循环）。
   仅正式构建（!NO_DETAIL）使用；样本 / 诊断构建走旧 JSON SLIM，行为与旧格式一致。 */
const WCP = require('./wcp.js');
const ROOT = path.resolve(__dirname, '..');

/* ---------- 六维分数（当前模型，etl/score/sixdim.js 产出）----------
   站点总分自此 = 六维总分（Σ 维度权重 × 维度分），取代旧的 Σ(单项分×项目权重)。
   维度分 s_d 满足恒等：Σ_d w_d × s_d = 总分（引擎侧已逐人校验，21,363 人 0 例不符）。
   sixdim_site.tsv 缺失时打印告警并留在旧口径，便于排查而非静默出错。 */
const SIX_W = { m1: 0.42, m2: 0.20, m3: 0.10, m4: 0.14, m5: 0.06, m6: 0.08 };
const SIXK = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'];
const SIX = new Map();
(function loadSix() {
  const f = path.join(__dirname, 'score', 'sixdim_site.tsv');
  if (!fs.existsSync(f)) { console.warn('⚠ 未找到 ' + f + ' —— 总分将回退 esum；请先跑 etl/score/sixdim.js'); return; }
  const lines = fs.readFileSync(f, 'utf8').trim().split('\n');
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split('\t');
    SIX.set(c[0], { m1: +c[1], m2: +c[2], m3: +c[3], m4: +c[4], m5: +c[5], m6: +c[6], t: +c[7] });
  }
  console.log('六维分数载入:', SIX.size, '人');
})();

/* ---------- 六维「年度曲线」（sixyear.tsv，etl/score/sixyear.js 产出）----------
   每个维度各自的年度演进（占本人该维最终分的千分比），供图表可视化页的「维度」
   筛选使用 —— 旧实现拿 p.yearly（领奖台 + 纪录次数）当所有维度的进度曲线，
   于是「统治力」在首次参赛前就冒出来、「纪录比」2003 年就有一整屏当代选手。
   缺表时前端退回旧曲线（p.yearly），不会报错。 */
const SIXY = new Map();      // pid → { m1:'2009:0,2010:82', ..., m2s, m2a }
(function loadSixYear() {
  const f = path.join(__dirname, 'score', 'sixyear.tsv');
  if (!fs.existsSync(f)) { console.warn('⚠ 未找到 ' + f + ' —— 单维竞速图将退回通用年度曲线；请先跑 etl/score/sixyear.js'); return; }
  const lines = fs.readFileSync(f, 'utf8').trim().split('\n');
  /* 定长 9 列：m1..m6 + M2 的单次/平均轨曲线（m2s / m2a）。
     老表只有 7 列时后面两列自然取不到 → 前端退回合并档 m2 曲线，不会报错。 */
  const YK = SIXK.concat(['m2s', 'm2a']);
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split('\t');
    if (!c[0]) continue;
    const o = {};
    let any = false;
    for (let k = 1; k <= YK.length; k++) { if (c[k]) { o[YK[k - 1]] = c[k]; any = true; } }
    if (any) SIXY.set(c[0], o);
  }
  console.log('六维年度曲线载入:', SIXY.size, '人');
})();

/* ---------- 全量总分轻表（sixdim_tail.tsv）----------
   站点主表 sixdim_site.tsv 为控制仓库体积只保留前 62,000 名，剩下 23 万人在
   主表里查不到分，overall 会被记成 0 —— 搜索结果看起来像「根本没被统计」。
   这张轻表只存 pid + 总分（全量 298,719 人，约 6.5MB），专门给长尾名册补分。
   缺失时只告警：长尾退回 0（与改造前行为一致），不影响主流程与排名。 */
const TAILT = new Map();
(function loadTailT() {
  const f = path.join(__dirname, 'score', 'sixdim_tail.tsv');
  const gz = f + '.gz';
  let lines = null;
  if (fs.existsSync(f)) lines = fs.readFileSync(f, 'utf8').trim().split('\n');
  else if (fs.existsSync(gz)) lines = zlib.gunzipSync(fs.readFileSync(gz)).toString('utf8').trim().split('\n');
  else { console.warn('⚠ 未找到 ' + f + '(.gz) —— 长尾名册总分将保持 0；请先跑 etl/score/sixdim.js'); return; }
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split('\t');
    TAILT.set(c[0], +c[1]);
  }
  console.log('全量总分轻表载入:', TAILT.size, '人');
})();

/* ---------- 按项目分解的六维分（项目筛选后重排用）----------
   同一归一分母，满足 Σ_ev s_d[ev] ≡ s_d、Σ_ev t_ev ≡ t：
   全项目求和可精确复原全站分，单项目/多项目筛选则直接对所选项目求和。
   没有这张表时前端退回「全站分 + 命中折减」，不会静默出错。 */
const SIXEV = new Map();
(function loadSixEv() {
  const f = path.join(__dirname, 'score', 'sixdim_by_event.tsv');
  // 仓库里存的是 gzip 归档（30MB 的明文表经 API 传输会被拒，压缩后约 6MB）；
  // 本地跑过 sixdim.js 时明文表还在，优先读明文，避免每次都解压。
  const gz = f + '.gz';
  let lines = null;
  if (fs.existsSync(f)) lines = fs.readFileSync(f, 'utf8').trim().split('\n');
  else if (fs.existsSync(gz)) lines = zlib.gunzipSync(fs.readFileSync(gz)).toString('utf8').trim().split('\n');
  else { console.warn('⚠ 未找到 ' + f + '(.gz) —— 项目筛选将退回全站六维分；请先跑 etl/score/sixdim.js'); return; }
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split('\t');
    const arr = [+c[2], +c[3], +c[4], +c[5], +c[6], +c[7], +c[8]];
    let m = SIXEV.get(c[0]);
    if (!m) { m = {}; SIXEV.set(c[0], m); }
    m[c[1]] = arr;
  }
  console.log('按项目六维分载入:', SIXEV.size, '人 /', (lines.length - 1), '条 选手×项目');
})();

/* ---------- 「在位时长」（M4 统治力引擎产物）----------
   M4_seats.tsv 的 d1 / d10 / d100 = 该选手在**世界第一 / 前十 / 前一百**上
   累计坐了多久（单位：年，按各项目累加）。选手页「在位月数」用的就是 d1 × 12。
   只有真正进过前十的人会出现在这张表里（约 1.5k 人），其余选手的在位月数
   真实值就是 0 —— 不是缺数据。表缺失时打印告警并全部记 0，不静默出错。 */
const M4SEATS = new Map();
(function loadM4Seats() {
  const f = path.join(__dirname, 'score', 'M4_seats.tsv');
  if (!fs.existsSync(f)) { console.warn('⚠ 未找到 ' + f + ' —— 「在位月数」将全部记 0；请先跑 etl/score/m4_dominance.js'); return; }
  const lines = fs.readFileSync(f, 'utf8').trim().split('\n');
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split('\t');
    if (c.length < 10) continue;
    M4SEATS.set(c[0], { d1: +c[8] || 0, d10: +c[7] || 0, d100: +c[9] || 0 });
  }
  console.log('在位时长载入:', M4SEATS.size, '人');
})();

/* ---------- 国家总分的历史拆分（sixdim_nat.tsv）----------
   国家榜的「总分」原本是 Σ 选手总分、按**当前国籍**一人只计一次。换籍选手
   （如 2012YUTA01 喻韬：代表爱尔兰刷了 19 条 NR，2024 年后转为中国籍）的全部
   得分会堆到新国家头上，与纪录归属口径不一致。
   六维引擎已经把每位换籍选手的总分按其代表国精确拆开（Σ 国 ≡ 选手总分，
   实测最大相对偏差 0.0000%），这里只是把它随包下发；前端 calc.js 组装国家榜时
   优先用拆分值，没有拆分记录的人照旧计入当前国籍。 */
const NATSPLIT = {};
(function loadNatSplit() {
  const f = path.join(__dirname, 'score', 'sixdim_nat.tsv');
  if (!fs.existsSync(f)) { console.warn('⚠ 未找到 ' + f + ' —— 国家总分将按当前国籍聚合；请先跑 etl/score/sixdim.js'); return; }
  const lines = fs.readFileSync(f, 'utf8').trim().split('\n');
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split('\t');
    if (c.length < 3) continue;
    const t = Math.round((+c[2] || 0) * 100) / 100;
    if (!(t > 0)) continue;
    (NATSPLIT[c[0]] = NATSPLIT[c[0]] || {})[c[1]] = t;
  }
  const n = Object.keys(NATSPLIT).length;
  console.log('换籍总分拆分载入:', n, '人 /', n ? Object.values(NATSPLIT).reduce((a, o) => a + Object.keys(o).length, 0) : 0, '段');
})();

/* ---------- 单次 / 平均 两套六维向量（成绩口径切换用）----------
   与 SIX 同源（六维引擎按 track=single|avg|both 各跑一遍），结构一致 {m1..m6,t}。
   仅下发「全局」向量，不下发按项目的 sixEv 三份（data.js 已 ~60MB，三倍会严重膨胀）；
   项目筛选下的六维重排仍用合并 sixEv，单次/平均只切换全局总分档，符合用户诉求。 */
function loadSixTrack(fname, tag) {
  const m = new Map();
  const f = path.join(__dirname, 'score', fname);
  if (!fs.existsSync(f)) { console.warn('⚠ 未找到 ' + f + ' —— 成绩口径「单次/平均」将退回总计；请先跑 etl/score/sixdim.js --track ' + tag); return m; }
  const lines = fs.readFileSync(f, 'utf8').trim().split('\n');
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split('\t');
    m.set(c[0], { m1: +c[1], m2: +c[2], m3: +c[3], m4: +c[4], m5: +c[5], m6: +c[6], t: +c[7] });
  }
  console.log('六维分数（' + tag + '）载入:', m.size, '人');
  return m;
}
const SIX_S = loadSixTrack('sixdim_site_single.tsv', 'single');
const SIX_A = loadSixTrack('sixdim_site_avg.tsv', 'avg');

/* ---------------- 参数 ---------------- */
const argv = process.argv.slice(2);
function arg(name, def) {
  const i = argv.indexOf(name);
  if (i >= 0 && i + 1 < argv.length) return argv[i + 1];
  return def;
}
const ZIP = arg('--zip', null);
const DIR = arg('--dir', null);
const OUT = arg('--out', path.join(ROOT, 'js', 'data.js'));
const EMIT_MAX = parseInt(arg('--emit-max', '0'), 10) || 0;
const SLIM_MAX = parseInt(arg('--slim-max', '20000'), 10) || 0;
const DETAIL_MAX = parseInt(arg('--detail-max', '2500'), 10) || 0;
/* ---------- 单项累加评分（新总分口径） ----------
   总分 = Σ ( 单项分_e × 项目权重_e )
   单项分_e = 100 × 世界名次_e ^ (-EV_GAMMA)
   EV_GAMMA 越大，顶端区分度越强、长尾衰减越快。0.35 时：
   第 1 名=100、第 3=68.1、第 10=44.7、第 100=20.0、第 1000=8.9。
   口径参数（现名次 / 当年名次 / 成绩比纪录）后续可替换 sOfEvent 内部实现，
   上层聚合与前端展示都不受影响。 */
const EV_GAMMA = parseFloat(arg('--ev-gamma', '0.35')) || 0.35;
function sOfEvent(rk) { return rk > 0 ? 100 * Math.pow(rk, -EV_GAMMA) : 0; }
/* 长尾名册单独成文件（--roster-out）：全量 30 万选手若全部塞进 data.js 会到 80MB，
   浏览器首屏无法接受。data.js 保留可排名 / 有明细的头部，其余选手压缩成
   「id,姓名,国家,性别,总分,起始年,结束年,场次,项目集」一行一条，
   仅供搜索与选手数展示，按需懒加载。 */
const ROSTER_OUT = arg('--roster-out', path.join(ROOT, 'js', 'roster.js'));
const NO_ROSTER = argv.indexOf('--no-roster') >= 0;
/* 明细分片：主包只留「可排名全量精简档」，2500 位顶尖选手的纪录 / 领奖台明细
   另写 data_detail.js，由 js/boot.js 在首屏可交互后后台补入。
   样本 / 诊断构建（--no-roster）不产出分片，避免往工作区丢临时大文件。 */
const DETAIL_OUT = arg('--detail-out', path.join(path.dirname(OUT), 'data_detail.js'));
/* 列增量分片：首屏用不到的重列（六维年度曲线 / 项目名次 / 原始统计计数）
   从 core 主包抽出来单独写，由 boot.js 在首屏渲染的同时并行取回、按 id 原地合并。 */
const COLS_OUT = arg('--cols-out', path.join(path.dirname(OUT), 'data_cols.js'));
/* 逐项目六维分解分片：sixEv 一个人就占 core 载荷的一半（实测 49.5%），
   却只有「按项目筛选」时才用得上。抽成 data_sixev.js 后首屏主包直接腰斩，
   用户在榜里选项目时才按需取回（boot.js 空闲时也会预取一份）。 */
const SIXEV_OUT = arg('--sixev-out', path.join(path.dirname(OUT), 'data_sixev.js'));
const NO_DETAIL = NO_ROSTER || argv.indexOf('--no-detail') >= 0;
const KEEP_YEARLY = 3000;
let KEEP_YEARLY_N = KEEP_YEARLY;
const HELP = argv.indexOf('--help') >= 0 || argv.indexOf('-h') >= 0;

if (HELP || (!ZIP && !DIR)) {
  console.log('Usage: node etl/build.js --zip <WCA_export.tsv.zip> | --dir <extracted_dir> [--out js/data.js] [--roster-out js/roster.js] [--emit-max N] [--slim-max N] [--detail-max N] [--date YYYY-MM-DD] [--ver vX.Y.Z]');
  process.exit(HELP ? 0 : 1);
}

const log = (...a) => console.log('[etl]', ...a);

/* ---------------- 读取 TSV（zip 或目录） ---------------- */
// WCA v1/v2 文件名有差异，这里同时兼容多种写法：
//   WCA_persons.tsv / WCA_export_Persons.tsv / WCA_export_persons.tsv 等
function candidates(base) {
  const caps = base.split('_').map((s) => s[0].toUpperCase() + s.slice(1)).join('');
  return [
    'WCA_' + base + '.tsv',
    'WCA_export_' + caps + '.tsv',
    'WCA_export_' + base + '.tsv',
    base + '.tsv'
  ];
}

function findEntry(base) {
  const out = execFileSync('unzip', ['-l', ZIP]).toString();
  const lines = out.split('\n');
  const names = lines.map((l) => l.trim().split(/\s+/).pop()).filter(Boolean);
  for (const cand of candidates(base)) {
    const idx = names.findIndex((n) => n.toLowerCase().endsWith(cand.toLowerCase()) || n === cand);
    if (idx >= 0) {
      const entry = names[idx];
      log('zip entry matched', base, '=>', entry);
      return entry;
    }
  }
  throw new Error('entry not found in zip: ' + base + '\nAvailable names (sample): ' + names.slice(0, 20).join(', '));
}

/* 只判断表是否存在（不打开流），避免在 zip 模式下白跑一次 unzip 子进程 */
function hasEntry(base) {
  try {
    if (DIR) {
      const files = [];
      const walk = (d) => {
        for (const f of fs.readdirSync(d)) {
          const p = path.join(d, f);
          if (fs.statSync(p).isDirectory()) walk(p); else files.push(p);
        }
      };
      walk(DIR);
      return candidates(base).some((cand) => files.some((p) => path.basename(p).toLowerCase() === cand.toLowerCase()));
    }
    return !!findEntry(base);
  } catch (e) { return false; }
}

function openEntry(base) {
  if (DIR) {
    const files = [];
    const walk = (d) => {
      for (const f of fs.readdirSync(d)) {
        const p = path.join(d, f);
        const st = fs.statSync(p);
        if (st.isDirectory()) walk(p);
        else files.push(p);
      }
    };
    walk(DIR);
    for (const cand of candidates(base)) {
      const fp = files.find((p) => path.basename(p).toLowerCase() === cand.toLowerCase());
      if (fp) { log('dir entry matched', base, '=>', fp); return fs.createReadStream(fp, { encoding: 'utf8' }); }
    }
    throw new Error('file not found for base: ' + base + ' in ' + DIR);
  }
  const entry = findEntry(base);
  const child = spawn('unzip', ['-p', ZIP, entry], { stdio: ['ignore', 'pipe', 'ignore'] });
  /* ⚠ 必须给子进程 stdout 显式设 utf8。
     不设编码时 stdout 是 Buffer 流，管道按 64KB 任意边界切块；
     streamTsv 里 `buf += chunk` 会把每一块独立 toString('utf8')，
     恰好跨块边界的多字节汉字/西里尔字母就被拆开、逐个替换成 U+FFFD ——
     表现为极少数选手名字变成「刘??聪」「Русл??н」（每 2 万个名字里约 1 个）。
     setEncoding('utf8') 让 Node 改用 StringDecoder，跨块的不完整字节序列会被留到下一块再解。 */
  if (child.stdout && child.stdout.setEncoding) child.stdout.setEncoding('utf8');
  return child.stdout;
}

/* 各表的实际列名（首次读取时记录），用于兼容 camelCase / snake_case 差异 */
const HEADERS = {};
/* 从行对象里按候选列名取值（兼容不同导出版本的命名差异） */
function pick(r, names) {
  for (let i = 0; i < names.length; i++) {
    const v = r[names[i]];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return '';
}

function streamTsv(base, onRow) {
  return new Promise((resolve, reject) => {
    const stream = openEntry(base);
    /* 兜底：无论上游给的是字符串还是 Buffer，都用 StringDecoder 拼字符串，
       保证跨块边界的多字节字符不会被拆坏（见 openEntry 里 setEncoding 的注释）。 */
    const decoder = new StringDecoder('utf8');
    const asText = (chunk) => (typeof chunk === 'string' ? chunk : decoder.write(chunk));
    let buf = '';
    let cols = null;
    let rowN = 0;
    stream.on('data', (chunk) => {
      buf += asText(chunk);
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, '');
        buf = buf.slice(nl + 1);
        if (cols === null) {
          cols = line.split('\t');
          /* 列名在不同导出版本里可能是 camelCase 或 snake_case，记录一份别名映射 */
          HEADERS[base] = cols.slice();
          log(base, 'columns:', cols.slice(0, 24).join(',') + (cols.length > 24 ? ' …(+' + (cols.length - 24) + ')' : ''));
          continue;
        }
        if (!line.trim()) continue;
        const parts = line.split('\t');
        rowN++;
        const obj = {};
        for (let i = 0; i < cols.length; i++) obj[cols[i]] = parts[i];
        onRow(obj, rowN);
      }
    });
    stream.on('end', () => {
      if (buf.trim()) {
        const parts = buf.replace(/\r$/, '').split('\t');
        if (cols) { const obj = {}; for (let i = 0; i < cols.length; i++) obj[cols[i]] = parts[i]; onRow(obj, ++rowN); }
      }
      resolve(rowN);
    });
    stream.on('error', reject);
  });
}

/* ---------------- 工具 ---------------- */
function toInt(v) { const n = parseInt(v, 10); return isNaN(n) ? 0 : n; }
/* 秒 → mm:ss / h:mm:ss */
function fmtDur(t) {
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  const mm = String(m).padStart(2, '0'), ss = String(s).padStart(2, '0');
  return (h > 0 ? h + ':' : '') + mm + ':' + ss;
}
function fmtResult(eventId, value, type) {
  const ev = Calc.EV[eventId] || { format: 'time' };
  const fmt = ev.format || 'time';
  const v = toInt(value);
  if (v <= 0) return '—';
  if (fmt === 'time') {
    const sec = v / 100;
    if (sec >= 60) {
      const m = Math.floor(sec / 60);
      const s = (sec - m * 60).toFixed(2).padStart(5, '0');
      return m + ':' + s;
    }
    return sec.toFixed(2);
  }
  if (fmt === 'number') {
    if (type === 'avg') return (v / 100).toFixed(2);
    return String(v);
  }
  if (fmt === 'multi') {
    const s = String(v).padStart(10, '0');
    let solved, attempted, t;
    if (s[0] === '1') {
      // 旧编码 1SSAATTTTT（旧多盲 333mbo，2006–2011）
      solved = 99 - toInt(s.slice(1, 3));
      attempted = toInt(s.slice(3, 5));
      t = toInt(s.slice(5, 10));
    } else {
      // 新编码 0DDTTTTTMM
      const dd = toInt(s.slice(1, 3));
      t = toInt(s.slice(3, 8));
      const mm = toInt(s.slice(8, 10));
      const diff = 99 - dd;
      solved = diff + mm;
      attempted = solved + mm;
    }
    const ts = (t > 0 && t !== 99999) ? ' ' + fmtDur(t) : '';
    return solved + '/' + attempted + ts;
  }
  return String(v);
}

/* ---------------- 维度表 ---------------- */
const persons = new Map();
const comps = new Map();
const champWC = new Set(), champCC = new Set(), champNC = new Set();
const countryName = {};
const continentShort = {};
const events = new Map();
const worldRank = new Map();
const EVENT_BOARDS = {};           // event_id -> [{id, r, b, a, s, af}] 每项目世界排名榜（前 N）
const eventCounts = {};
const continents = {};
/* 国家-项目参赛规模：'eventId|ISO2' -> 该国在该项目上有成绩的人数（取 country_rank 最大值） */
const natEventSize = {};
/* 纪录演进序列：'eventId|single|avg|WR|CR|NR|ISO2' -> [YYYYMMDD, ...]（升序）
   用于计算每条纪录的「保持天数」：本条创立 → 下一条同口径纪录创立（或至今） */
const recSeq = {};
let recSeqCount = 0;
const REC_SEQ_MAX = 2500000;   /* 纪录序列条目上限（约 20MB 内存），超出后不再计算保持天数 */

/* 年度排名：'year|eventId' -> 该年度该项目成绩最好的前 ANNUAL_TOP 名（按单次成绩升序）。
   只保留前 N 名而非全部选手 —— 全量结果行上千万条，全留会再次把 ETL 打到OOM；
   而「年度前10/前100」这类指标本来就只需要头部名次。

   [坑] **同一选手在同一格只能占一个槽位。**
   results.tsv 里一个选手在同一年同一项目会有多行（多轮次 × 多场比赛），
   每行都会调用 annualOffer。若不按 pid 去重，同一人会占据多个名次槽位，
   导致：① 「年度前100 次数」按人头重复计数，数值成倍虚高；
        ② 下方按数组下标算名次时，后面的人被挤到 100 名之外，榜单直接错排。
   实测（2026-10-15 快照）：Feliks yTop100 由真实的 165 被算成 975（5.91×），
   站点 6,147 人里 87.9% 的该字段是错的，Top20 榜单错排 9 个位置。
   2024|333 年度榜 Top10 里 Yiheng Wang 出现 4 次、2015|333 里 Feliks 出现 6 次。

   修法（两阶段）：
     阶段一（扫描时）：只收「该格该选手的最好成绩」，用 Map<pid,best> 维护，
       不参与名次分配 —— 这一步杜绝了同一人多占槽位。
     阶段二（扫描后）：遍历每格，按 best 升序排序后取前 ANNUAL_TOP 名，
       此时数组下标就是真实名次，下游计数逻辑（build.js:1086 附近）无需改动。

   代价：阶段一的 Map 规模 = 选手-项目-年 去重键 ≈ 209 万条，
   比原来只存前 200 名多占约 300MB —— 换取口径正确，
   且阶段二会立刻释放中间结构。 */
const ANNUAL_TOP = 200;
const annualTop = {};
/* 阶段一：'year|eventId' -> Map<pid, best>，只记该格每人的最好成绩 */
const annualBest = new Map();
function annualOffer(year, eid, pid, best) {
  if (!(best > 0)) return;
  const key = year + '|' + eid;
  let m = annualBest.get(key);
  if (!m) { m = new Map(); annualBest.set(key, m); }
  const cur = m.get(pid);
  if (cur === undefined || best < cur) m.set(pid, best);
}
/* 阶段二：把每格 Map 排序成「前 ANNUAL_TOP 名」的升序数组，交给下游按下标算名次 */
function annualFinalize() {
  annualBest.forEach((m, key) => {
    const arr = [];
    m.forEach((best, pid) => { arr.push({ pid: pid, best: best }); });
    arr.sort((a, b) => a.best - b.best);
    annualTop[key] = arr.length > ANNUAL_TOP ? arr.slice(0, ANNUAL_TOP) : arr;
  });
  annualBest.clear();
}

async function loadDimensions() {
  log('加载 persons …');
  await streamTsv('persons', (r) => {
    const id = r.wca_id; if (!id) return;
    const sub = toInt(r.sub_id);
    const cur = persons.get(id);
    /* ★ 2026-11-02 修：一个人可能有多行（sub_id 1/2/3）—— 换过代表国、或改过姓名的人，
       导出会为同一 wca_id 保留多条 person 记录。旧逻辑取「sub_id 最大」的那行当现国籍，
       于是 2012YUTA01 喻韬（sub1=Ireland, sub2=China）被当成中国、
       2015XION03 Max Xiong（sub1=Canada, sub2=China）被当成中国 ——
       整份档案的国旗、地区排名、国家实力榜人数全部挂错国家。
       正确做法：**sub_id 最小的那行才是 WCA 的个人主档案**（当前国籍 / 现用姓名）。
       历史代表国不靠这张表，逐条成绩的 results.person_country_id 才是权威（见 addRecord）。 */
    if (!cur || sub < cur.sub_id) persons.set(id, { name: r.name, country_id: r.country_id, gender: r.gender, sub_id: sub });
  });
  log('persons:', persons.size);

  log('加载 competitions …');
  const pad2 = (n) => String(n).padStart(2, '0');
  await streamTsv('competitions', (r) => {
    if (!r.id) return;
    const y = toInt(r.year);
    const mo = toInt(r.month), d = toInt(r.day);
    const date = (y ? (y + '-' + pad2(mo || 1) + '-' + pad2(d || 1)) : '');
    comps.set(r.id, { name: r.name, country_id: r.country_id, year: y, date: date, city: pick(r, ['cityName', 'city_name', 'city']) });
  });
  log('competitions:', comps.size);

  log('加载 championships …');
  await streamTsv('championships', (r) => {
    if (!r.competition_id) return;
    /* championship_type 的真实取值有三类（WCA 导出实证）：
         'world'          → 世界锦标赛
         '_Europe' / '_Asia' …（下划线开头）→ 洲际锦标赛
         'FI' / 'IT' / 'AU' …（两位国家码）  → **国家锦标赛**
       旧代码只认 'world'，其余一股脑塞进 CC —— 于是各国国家锦标赛被当成洲锦赛，
       而「国家赛」这一档被错用成「在本国境内举办的比赛」（任何一场本土周末赛都算），
       这正是选手页「国家赛统计」数字不对的根源（Feliks 曾被算成 660 场 / 517 冠）。 */
    const t = (r.championship_type || '').toLowerCase();
    if (t === 'world') champWC.add(r.competition_id);
    else if (t.length === 2) champNC.add(r.competition_id);
    else champCC.add(r.competition_id);
  });
  log('championships WC/CC/NC:', champWC.size, champCC.size, champNC.size);

  log('加载 countries / continents …');
  /* continents.id 在不同导出版本里可能是 "_Europe" / "Europe"，这里三条路径都试 */
  await streamTsv('continents', (r) => {
    if (!r.id) return;
    const raw = String(r.id).replace(/^_+/, '').trim();
    const nm = String(r.name || '').trim();
    continents[r.id] = Calc.CONTINENT_CODE[r.id] || Calc.CONTINENT_CODE[raw] || Calc.CONTINENT_CODE[nm] || null;
  });
  log('continents:', Object.keys(continents).length, '->', JSON.stringify(continents).slice(0, 200));
  /* countries.id 是国家全名（如 "Australia"），另有 iso2 列；
     两份键（全名 + ISO2）都写入，前端旗帜 / 中文名 / 洲际筛选一律按 ISO2 取。 */
  await streamTsv('countries', (r) => {
    if (!r.id) return;
    countryName[r.id] = r.name;
    const cont = continents[r.continent_id] || null;
    continentShort[r.id] = cont;
    const iso = String(r.iso2 || '').trim().toUpperCase();
    if (iso) { countryName[iso] = r.name; continentShort[iso] = cont; }
  });
  log('countries:', Object.keys(countryName).length);

  log('加载 events …');
  await streamTsv('events', (r) => {
    if (!r.id) return;
    events.set(r.id, { name: (r.name || r.id), format: r.format, w: (Calc.EV[r.id] || { w: 0.8 }).w, rank: toInt(r.rank) });
  });
  log('events:', events.size);

  log('加载 ranks_single / ranks_average …');
  let rankRows = 0;
  /* 每选手每项目：{r: 世界排名, b: 官方最佳单次原始值, a: 官方最佳平均原始值}
     成绩直接取 ranks 表的 best 列（权威值），避免从 results 重新取 min——
     旧/新多盲编码跨格式数值不可比（新格式缺前导 1，数值恒小），只有 ranks 表
     的排序是 WCA 官方口径；展示时按前导位自动选择旧/新编码解码。 */
  const ingestRank = (r, isAvg) => {
    const pid = r.person_id, eid = r.event_id;
    if (!pid || !eid) return;
    rankRows++;
    const wr = toInt(r.world_rank);
    const best = toInt(r.best);
    /* 国家 / 大洲参赛规模：country_rank 的最大值 ≈ 该国在该项目上有过成绩的人数。
       用于按「刷新 NR 的难度」给 NR 记分加权（人数越少的国家，NR 越容易拿到）。 */
    if (!isAvg) {
      const ciso = Calc.isoNorm((persons.get(pid) || {}).country_id || '');
      if (ciso) {
        const ck = eid + '|' + ciso;
        const cr = toInt(r.country_rank);
        if (cr > (natEventSize[ck] || 0)) natEventSize[ck] = cr;
      }
    }
    let m = worldRank.get(pid); if (!m) { m = {}; worldRank.set(pid, m); }
    if (!(eid in m)) m[eid] = { r: 0, b: 0, a: 0 };
    if (isAvg) {
      /* 平均成绩：存最佳平均；世界排名仅在该选手无单次排名时兜底
         （单次名次是该项目 canonical 排名，ranks_single 先于 ranks_average 加载） */
      if (best > 0 && (m[eid].a === 0 || best < m[eid].a)) m[eid].a = best;
      if (m[eid].r === 0 && wr > 0) m[eid].r = wr;
    } else {
      if (wr > 0 && (m[eid].r === 0 || wr < m[eid].r)) m[eid].r = wr;
      if (best > 0 && (m[eid].b === 0 || best < m[eid].b)) m[eid].b = best;
    }
    eventCounts[eid] = (eventCounts[eid] || 0) + 1;
  };
  await streamTsv('ranks_single', (r) => ingestRank(r, false));
  await streamTsv('ranks_average', (r) => ingestRank(r, true));
  log('rank rows:', rankRows);
}

/* ---------------- results（大表） ---------------- */
const players = new Map();

/* result_id → 选手下标 +1。导出 v2 起单次成绩独立在 result_attempts 表，
   只能靠 result_id 关联回选手；结果行上千万条，用 Uint32Array 存下标最省内存
   （Map 存字符串在这个量级会爆堆外内存）。 */
let rid2ix = new Uint32Array(1 << 24);
let rid2ev = new Uint16Array(1 << 24);
function ridSet(rid, v, ev) {
  if (rid >= rid2ix.length) {
    let cap = rid2ix.length;
    while (cap <= rid) cap *= 2;
    const bigger = new Uint32Array(cap); bigger.set(rid2ix); rid2ix = bigger;
    const b2 = new Uint16Array(cap); b2.set(rid2ev); rid2ev = b2;
  }
  rid2ix[rid] = v;
  if (ev != null) rid2ev[rid] = ev;
}
/* 扫描 result_attempts 得到真实的「尝试数 / 有效复原数 / DNF 数」。
   约定：-1 = DNF、-2 = DNS、0 = 无成绩（cutoff 未过等，不算尝试）。 */
async function processAttempts() {
  if (!hasEntry('result_attempts')) { log('result_attempts 表不存在，跳过单次成绩统计'); return 0; }
  const arr = Array.from(players.values());
  arr.forEach(function (p) { p.attempts = 0; p.solves = 0; p.dnf = 0; });
  const evIds = evIxList.length ? evIxList : Array.from(events.keys());
  let rows = 0;
  await streamTsv('result_attempts', (r) => {
    rows++;
    const rid = toInt(pick(r, ['result_id', 'resultId']));
    if (!rid || rid >= rid2ix.length) return;
    const ix = rid2ix[rid]; if (!ix) return;
    const p = arr[ix - 1]; if (!p) return;
    const v = toInt(pick(r, ['value']));
    if (v === 0 || v === -2) return;
    p.attempts++;
    const eid = evIds[rid2ev[rid]];
    const eb = eid ? evBucket(p, eid) : null;
    if (eb) {
      eb.att++;
      if (v === -1) eb.dnf++; else eb.sol++;
    }
    if (v === -1) p.dnf++; else p.solves++;
  });
  log('result_attempts rows:', rows);
  return rows;
}
const finalCounts = new Map();      // "comp|event" -> Set(person_id)
const wrSingleG = {};               // event -> [{date,name,country}]
const wrAvgG = {};                  // event -> [{date,name,country}]
const msGlobal = {};                // event -> {threshold: earliestYear}

/* ---------------- 纪录链（泳道图）收集 ----------------
   2026-11-01 起，纪录持有图不再只有「世界纪录」一条链：筛选大洲 / 地区 / 国家 / 性别时，
   下方要显示对应的洲纪录 / 国家纪录 / 女子纪录。数据在这里一次收齐，前端按 scope 取用。

   范围（scope）：
     W          世界纪录
     C:<洲码>   洲纪录（本项目的「大洲」与「地区」是一一对应的，所以两者共用这一档）
     N:<ISO2>   国家纪录
   性别（gen）：'' 全体、'f' 女子。

   ★ 全体口径直接用 WCA 在 regional_single_record / regional_average_record 里给的标记
     （它只写**最高那一级**：既是世界纪录又是国家纪录的成绩只标 WR）。因此：
       WR → 该选手所属洲 / 国家的纪录也同时前进；CR → 洲与国家同时前进；NR → 只推国家。
     这正是「洲纪录必然是本国纪录」的常识，不需要额外判断成绩大小。
   ★ 女子口径 WCA 没有官方标记，只能自己算：按时间顺序维护每个（范围,项目）的女子最好成绩，
     一旦被刷新就记一次。麻烦在于 results.tsv 是按比赛 id（= 年份前缀）排序的，
     年内顺序不可靠 —— 所以先在「当年」缓冲，跨年时按日期排序重放，保证链条严格按时间前进。
     缓冲只装「比已知最好还快」的行，量级等于当年破纪录次数，很小。 */
const recChain = new Map();         // `${scope}|${eid}|${kind}|${gen}` -> [{dn, fy, pid, name, iso, country}]
const femBest = new Map();          // `${scope}|${eid}|${kind}` -> 已确认的女子最好成绩（越小越强）
const femPend = new Map();          // 同上 -> 当年待定记录（跨年时排序重放）
let chainYear = 0;

/* 多盲（333mbf/333mbo）的原始值是编码值，不能直接比大小。
   新制 0DDTTTTTMM：DD = 99 − (成 − 错)，TTTTT = 秒；旧制 1SSAATTTTT。
   统一换算成「越大越好」的对数值：分数优先，时间次之。 */
function multiGood(v) {
  if (!(v > 0)) return null;
  if (v < 1e9) {
    const s = String(v).padStart(9, '0');
    return (99 - parseInt(s.slice(0, 2), 10)) * 100000 - parseInt(s.slice(2, 7), 10);
  }
  const s = String(v).padStart(10, '0');
  const solved = parseInt(s.slice(1, 3), 10), att = parseInt(s.slice(3, 5), 10);
  return (2 * solved - att) * 100000 - parseInt(s.slice(5, 10), 10);
}
/* 统一成「越小越强」的代价，多盲取负号转过来；无效成绩返回 null */
function chainCost(eid, v) {
  const x = toInt(v);
  if (!(x > 0)) return null;
  if (eid === '333mbf' || eid === '333mbo') {
    const g = multiGood(x);
    return g == null ? null : -g;
  }
  return x;
}
function pushChain(scope, eid, kind, gen, dn, fy, p, iso, cont, cty) {
  if (!scope) return;
  const key = scope + '\u0001' + eid + '\u0001' + kind + '\u0001' + gen;
  let arr = recChain.get(key);
  if (!arr) { arr = []; recChain.set(key, arr); }
  arr.push({ dn: dn, fy: fy, pid: p.wcaId, name: p.name, iso: iso, country: cty || p.country, cont: cont });
}
/* 官方标记推进（全体口径） */
function feedRec(eid, kind, level, p, dn, fy, iso, cont, cty) {
  if (level === 'WR') {
    pushChain('W', eid, kind, '', dn, fy, p, iso, cont, cty);
    if (cont) pushChain('C:' + cont, eid, kind, '', dn, fy, p, iso, cont, cty);
    if (iso) pushChain('N:' + iso, eid, kind, '', dn, fy, p, iso, cont, cty);
  } else if (level === 'CR') {
    if (cont) pushChain('C:' + cont, eid, kind, '', dn, fy, p, iso, cont, cty);
    if (iso) pushChain('N:' + iso, eid, kind, '', dn, fy, p, iso, cont, cty);
  } else if (level === 'NR') {
    if (iso) pushChain('N:' + iso, eid, kind, '', dn, fy, p, iso, cont, cty);
  }
}
/* 女子口径：只缓存「比已确认最好还快」的行，跨年时排序重放 */
function offerFem(eid, kind, cost, p, dn, fy, iso, cont, cty) {
  if (cost == null) return;
  const scopes = ['W'];
  if (cont) scopes.push('C:' + cont);
  if (iso) scopes.push('N:' + iso);
  for (let i = 0; i < scopes.length; i++) {
    const key = scopes[i] + '\u0001' + eid + '\u0001' + kind;
    const confirmed = femBest.has(key) ? femBest.get(key) : Infinity;
    if (!(cost < confirmed)) continue;
    let arr = femPend.get(key);
    if (!arr) { arr = []; femPend.set(key, arr); }
    arr.push({ dn: dn, fy: fy, cost: cost, pid: p.wcaId, name: p.name, iso: iso, country: cty || p.country, cont: cont });
  }
}
function flushFem() {
  if (!femPend.size) return;
  femPend.forEach(function (arr, key) {
    arr.sort(function (a, b) { return a.dn - b.dn || a.cost - b.cost; });
    const parts = key.split('\u0001');
    let best = femBest.has(key) ? femBest.get(key) : Infinity;
    for (let i = 0; i < arr.length; i++) {
      const it = arr[i];
      if (!(it.cost < best)) continue;
      best = it.cost;
      const k2 = parts[0] + '\u0001' + parts[1] + '\u0001' + parts[2] + '\u0001f';
      let out = recChain.get(k2);
      if (!out) { out = []; recChain.set(k2, out); }
      out.push({ dn: it.dn, fy: it.fy, pid: it.pid, name: it.name, iso: it.iso, country: it.country, cont: it.cont });
    }
    femBest.set(key, best);
  });
  femPend.clear();
}

function getPlayer(id) {
  let p = players.get(id);
  if (!p) {
    p = {
      wcaId: id, ix: players.size,
      name: (persons.get(id) || { name: id }).name,
      country: (persons.get(id) || { country_id: '??' }).country_id,
      gender: (persons.get(id) || { gender: 'M' }).gender,
      eventsSet: new Set(), compsSet: new Set(),
      start: 9999, end: 0, wr: 0, cr: 0, nr: 0, nrW: 0,
      wrS: 0, crS: 0, nrS: 0, nrWS: 0, wrA: 0, crA: 0, nrA: 0, nrWA: 0,
      resultRows: 0, attempts: 0, solves: 0, dnf: 0,
      podiums: [], records: [], yearly: {}, yearlyS: {}, yearlyA: {},
      activeStreak: 1,
      /* 按项目的真实统计（趣味统计页项目筛选用）：
         evStat[项目] = { rows, att, sol, dnf, pod, gold, comps, years } */
      evStat: {}
    };
    players.set(id, p);
  }
  return p;
}
/* 取（并初始化）选手在某项目上的统计桶 */
function evBucket(p, eid) {
  let b = p.evStat[eid];
  if (!b) {
    b = { rows: 0, att: 0, sol: 0, dnf: 0, pod: 0, gold: 0, sil: 0, bro: 0,
      wr: 0, cr: 0, nr: 0, held: 0, heldLong: 0, heldNow: 0,
      comps: 0, years: [], seen: null, cities: null, goldPerYear: {},
      recPerYear: {}, wc: 0, cc: 0, nc: 0, lo: 0, op: 0 };
    p.evStat[eid] = b;
  }
  return b;
}
/* 把 Set 形态的去重集合固化成计数后即可释放：
   30 万选手 × 20 个项目如果长期持有 compId / 城市名集合，堆会直接爆掉。 */
function freezeEvStat(list) {
  list.forEach((p) => {
    const es = p.evStat; if (!es) return;
    Object.keys(es).forEach((eid) => {
      const b = es[eid];
      if (b.seen) { b.comps = b.seen.size; b.seen = null; }
      if (b.cities) { b.cityN = b.cities.size; b.cities = null; }
    });
  });
}
function compCity(cid) {
  const c = comps.get(cid);
  return c ? (c.city || c.name || cid) : (cid || '?');
}
/* 项目 id → 连续下标（供 rid2ev 用 Uint16 存） */
let evIx = null, evIxList = [];
function buildEventIndex() {
  const m = new Map(); let i = 0;
  events.forEach(function (v, k) { m.set(k, i++); });
  evIxList = Array.from(events.keys());
  return m;
}

/* 重大事件精确到日：记录「首次达成该门槛」的具体比赛日期（YYYYMMDD），
   而不是只记年份。results 表不保证按日期有序，因此要取最小值。 */
function trackMilestone(eid, best, year, dn) {
  const bars = Calc.EV_BARRIERS[eid]; if (!bars) return;
  const fmt = (events.get(eid) || {}).format || 'time';
  const v = toInt(best); if (v <= 0) return;
  if (!msGlobal[eid]) msGlobal[eid] = {};
  const mp = msGlobal[eid];
  const dayNum = dn > 0 ? dn : (year || 2003) * 10000 + 101;
  bars.forEach((b) => {
    const cur = mp[b[0]];
    /* 已记录过且已有更早（或同为精确日期）的成绩时不必再看 */
    if (cur != null && cur <= dayNum) return;
    const thr = parseFloat(b[0]);
    let ok = false;
    if (fmt === 'time') ok = v < thr * 100;
    else if (fmt === 'number') ok = v <= thr;
    else if (fmt === 'multi') {
      const s = String(v).padStart(10, '0');
      /* 旧编码 1SSAATTTTT：解出 = 99-SS；新编码 0DDTTTTTMM：解出 = (99-DD)+MM */
      const solved = s[0] === '1' ? (99 - toInt(s.slice(1, 3))) : ((99 - toInt(s.slice(1, 3))) + toInt(s.slice(8, 10)));
      ok = solved >= thr;
    }
    if (ok) mp[b[0]] = dayNum;
  });
}

/* NR 记分参考规模：该国该项目参赛人数达到该量级时 NR 记满分；人数越少，NR 越贬值。
   采用平方根律（(N/REF)^0.5），既避免小国 NR 完全归零，也显著压低「刷 NR」的收益。 */
const NR_REF = 20000;
const NR_FLOOR = 0.12;
function nrScaleOf(eid, ciso) {
  const n = natEventSize[eid + '|' + ciso] || 0;
  if (n <= 0) return NR_FLOOR;
  return Math.max(NR_FLOOR, Math.min(1, Math.sqrt(n / NR_REF)));
}
/* 纪录链的键。层级不同，比较的「池子」不同：
   · WR —— 全球一个池子；
   · CR —— **洲内**一个池子（旧版把 CR 也塞进全球同一个池子，
           于是欧洲纪录会被亚洲纪录「接走」，保持天数被算短）；
   · NR —— 国别一个池子。 */
function recKey(eid, type, level, country) {
  const tail = level === 'NR' ? Calc.isoNorm(country)
    : (level === 'CR' ? (Calc.contOfIso(Calc.isoNorm(country)) || '') : '');
  return eid + '|' + type + '|' + level + '|' + tail;
}
function dateNum(d) {
  if (!d) return 0;
  const m = String(d).match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return 0;
  return toInt(m[1]) * 10000 + toInt(m[2]) * 100 + toInt(m[3]);
}
function numToDate(n) {
  const s = String(n);
  return s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8);
}
function daysBetween(a, b) {
  if (!a || !b) return 0;
  const A = new Date(numToDate(a) + 'T00:00:00Z'), B = new Date(numToDate(b) + 'T00:00:00Z');
  return Math.max(0, Math.round((B - A) / 86400000));
}
function tlIsLeap(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }
/* dateNum(YYYYMMDD) → 小数年（用于泳道图 x 定位，保留天级精度） */
function fyOfDn(dn) {
  if (!dn) return 0;
  const y = Math.floor(dn / 10000), mo = Math.floor(dn / 100) % 100, d = dn % 100;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return y;
  const dt = Date.UTC(y, mo - 1, d), y0 = Date.UTC(y, 0, 1);
  return y + (dt - y0) / 86400000 / (tlIsLeap(y) ? 366 : 365);
}
/* 洲际纪录在导出里不是字面量 'CR'，而是具体洲代码；无纪录为字面量 'NULL'。
   （WCA 官方口径：ER 欧洲 / NAR 北美 / AsR 亚洲 / SAR 南美 / AfR 非洲 / OcR 大洋洲） */
const CONT_RECORD = { AfR: 1, ER: 1, OcR: 1, NAR: 1, AsR: 1, SAR: 1 };
const CR_REGION = { AfR: 'Af', ER: 'Eu', OcR: 'Oc', NAR: 'NAm', AsR: 'As', SAR: 'SAm' };
function recordLevel(v) {
  if (v === 'WR') return 'WR';
  if (v === 'CR' || CONT_RECORD[v]) return 'CR';
  if (v === 'NR') return 'NR';
  return '';
}
const eventLastYear = {};   // event -> 有成绩的最近年份（停办项目泳道截止用）
const eventLastDn = {};     // event -> 有成绩的最近一天（YYYYMMDD，停办项目的时间轴终点）

/* ★ 2026-11-02 修：纪录必须按「发生当时所代表的国家」归属。
   WCA 导出 results.tsv 第 13 列 person_country_id 就是那场比赛登记的代表国；
   persons.tsv 里的 country_id 只是**当前**国籍（换籍后会被改写）。
   换籍选手（如 2012YUTA01 喻韬：爱尔兰 → 中国，或反向）的 NR 若按现国籍归属，
   会把一整条 NR 链接到错误的国家上，连带污染 nrScale、国家纪录链与泳道图国旗。 */
function addRecord(p, eid, type, level, value, comp, year, rr, cty) {
  const cty0 = cty || p.country;      // 纪录发生时的代表国
  const isS = type !== 'avg';
  if (level === 'WR') { p.wr++; if (isS) p.wrS++; else p.wrA++; }
  else if (level === 'CR') { p.cr++; if (isS) p.crS++; else p.crA++; }
  else { p.nr++; if (isS) p.nrS++; else p.nrA++; }
  /* 按项目分桶计数（趣味统计页「项目筛选」用） */
  {
    const eb = evBucket(p, eid);
    if (level === 'WR') eb.wr++; else if (level === 'CR') eb.cr++; else eb.nr++;
    eb.recPerYear[year] = (eb.recPerYear[year] || 0) + 1;
  }
  /* NR 按「该国该项目参赛人数」加权：参赛人数越少的国家，拿到 NR 越容易，记分越低 */
  const ciso = Calc.isoNorm(cty0);
  const ns = level === 'NR' ? nrScaleOf(eid, ciso) : 1;
  if (isS) p.nrWS += ns; else p.nrWA += ns;
  p.nrW += ns;
  const ev = events.get(eid) || { w: 0.8 };
  const S = Math.max(0.6, Math.min(2.2, 2.2 - (year - 2003) * 0.04));
  const T = type === 'single' ? 0.62 : 0.85;
  const K = (eid === '333mbf' || eid === '333mbo') ? 1.41 : 1;
  const G = (level === 'WR' ? 1.0 : (level === 'CR' ? 0.45 : 0.18)) * ns;
  const A = Math.max(0.4, Math.min(3.2, 3.2 - (year - 2003) * 0.07));
  const O = 1.2;
  const R = Math.round(100 * ev.w * S * T * K * G * A * O * 10) / 10;
  const dn = dateNum(comp ? comp.date : (year + '-01-01')) || (year * 10000 + 101);
  const k = recKey(eid, type, level, cty0);
  /* ⚠ 纪录链登记（2026-10-30 修）：
     WCA 导出在 regional_*_record 里只写**最高的那一级** —— 一条既是 WR 又是 NR 的成绩
     只标 "WR"，绝不会同时标 "NR"。旧版只把日期写进「本条自己的层级链」，于是某国的 NR
     链只在「纯 NR」时才前进，一旦之后的纪录升级成 CR/WR 就再也接不上，
     最后一条 NR 被算成「保持到今天」：实测 Feliks 的 SQ1 平均 NR（2009 年 28.83 秒）
     被显示成「保持 17 年 3 个月」—— 实际上澳洲早就破掉了。
     正确做法：一条纪录隐含它下面所有层级，要同时登记到这些链上。 */
  if (recSeqCount < REC_SEQ_MAX) {
    const chain = [k];
    if (level === 'WR') chain.push(recKey(eid, type, 'CR', cty0), recKey(eid, type, 'NR', cty0));
    else if (level === 'CR') chain.push(recKey(eid, type, 'NR', cty0));
    chain.forEach((ck) => {
      if (recSeqCount >= REC_SEQ_MAX) return;
      if (!recSeq[ck]) recSeq[ck] = [];
      recSeq[ck].push(dn);
      recSeqCount++;
    });
  }
  p.records.push({
    ev: eid, type: type, level: level, rr: rr || (level === 'CR' ? 'CR' : ''),
    date: comp ? comp.date : (year + '-01-01'),
    value: fmtResult(eid, value, type),
    comp: comp ? comp.name : '', held: 0, current: false, dn: dn, k: k,
    cty: cty0 === p.country ? undefined : cty0,   /* 仅当与当前国籍不同时才写（省体积）；M1 用 `x.cty || p.country` 兜底 */
    factors: { we: Math.round(ev.w * 100) / 100, S: Math.round(S * 100) / 100, T: T, K: K, G: Math.round(G * 1000) / 1000, A: Math.round(A * 100) / 100, O: O, z: 0, NRS: Math.round(ns * 100) / 100, natN: natEventSize[eid + '|' + ciso] || 0 },
    R: R
  });
}

async function processResults() {
  log('处理 results（最大表，流式）…');
  let rows = 0;
  await streamTsv('results', (r) => {
    rows++;
    const pid = r.person_id; if (!pid) return;
    const eid = r.event_id; if (!eid) return;
    const compId = r.competition_id;
    const comp = comps.get(compId);
    const year = comp ? comp.year : 2003;
    if (year > (eventLastYear[eid] || 0)) eventLastYear[eid] = year;
    /* 同一项目的「最后一天」：竞速图选到停办项目时，时间轴要停在它停办的那一刻
       （例如八板停在 2012、脚拧停在 2019），而不是一路延续到今天。 */
    const dn = dateNum(comp ? comp.date : '') || (year * 10000 + 101);
    if (dn > (eventLastDn[eid] || 0)) eventLastDn[eid] = dn;
    const p = getPlayer(pid);
    /* ★ 该场成绩登记的代表国（results.person_country_id）。换籍选手的每条成绩
       都带自己当时的国家，不能拿 persons.tsv 的当前国籍一刀切。 */
    const pcty = r.person_country_id || p.country;
    p.eventsSet.add(eid);
    if (compId) p.compsSet.add(compId);
    if (year < p.start) p.start = year;
    if (year > p.end) p.end = year;
    p.resultRows++;
    const eb = evBucket(p, eid);
    eb.rows++;
    /* 参赛场次 / 城市数：每选手每项目用 Set 去重（不用数组，数组是 O(n²) 查找） */
    if (compId) { if (!eb.seen) eb.seen = new Set(); eb.seen.add(compId); }
    if (eb.years.indexOf(year) < 0) eb.years.push(year);
    if (compId) {
      const city = compCity(compId);
      if (!eb.cities) eb.cities = new Set();
      eb.cities.add(city);
    }
    /* 结果行 id → 选手下标：result_attempts 表靠 result_id 关联，
       导出 v2 起单次成绩不在 results 里，必须另扫该表才能拿到真实尝试数。 */
    const rid = toInt(r.id);
    if (rid > 0) { if (!evIx) evIx = buildEventIndex(); ridSet(rid, p.ix + 1, evIx.get(eid)); }
    /* 老版本导出（v1）把单次值放在 value1..value5，这里兜底读一次。
       若后续 result_attempts 扫到了真实值，会覆盖这些计数。 */
    for (let vi = 1; vi <= 5; vi++) {
      const vv = toInt(pick(r, ['value' + vi, 'value_' + vi]));
      if (vv === 0 || vv === -2) continue;   // 空 / DNS 不计入尝试
      p.attempts++;
      if (vv === -1) p.dnf++; else p.solves++;
    }

    const rtype = r.round_type_id;
    const isFinal = rtype === 'f' || rtype === 'c';
    const pos = toInt(r.pos);
    if (isFinal && pos >= 1 && pos <= 3) {
      /* 赛级：世锦 / 洲锦 / 国家锦标赛 / 其它一律公开赛。
         旧口径把「在本国境内举办的比赛」也算成 NC，国家赛因此虚高到几百场。 */
      const tier = champWC.has(compId) ? 'WC'
        : (champCC.has(compId) ? 'CC'
          : (champNC.has(compId) ? 'NC' : 'OP'));
      const key = compId + '|' + eid;
      let fs = finalCounts.get(key); if (!fs) { fs = new Set(); finalCounts.set(key, fs); }
      fs.add(pid);
      p.podiums.push({ ev: eid, tier: tier, place: pos, comp: comp ? comp.name : compId, compId: compId, year: year, field: 0, factors: null, R: 0 });
      eb.pod++;
      if (pos === 1) eb.gold++; else if (pos === 2) eb.sil++; else eb.bro++;
      if (tier === 'WC') eb.wc = (eb.wc || 0) + 1;
      else if (tier === 'CC') eb.cc = (eb.cc || 0) + 1;
      else if (tier === 'NC') eb.nc = (eb.nc || 0) + 1;
      else if (tier === 'Local') eb.lo = (eb.lo || 0) + 1;
      else eb.op = (eb.op || 0) + 1;
      if (pos === 1) { eb.goldPerYear[year] = (eb.goldPerYear[year] || 0) + 1; }
    }

    const rsr = recordLevel(r.regional_single_record), rar = recordLevel(r.regional_average_record);
    if (rsr) addRecord(p, eid, 'single', rsr, r.best, comp, year, r.regional_single_record, pcty);
    if (rar) addRecord(p, eid, 'avg', rar, r.average, comp, year, r.regional_average_record, pcty);

    /* 纪录持有者：带上 pid 与 ISO2 国码，前端才能在泳道图上做
       「列表悬停 → 高亮该选手的色块 + 显示国旗姓名」的联动。 */
    const wrDn = dateNum(comp ? comp.date : year + '-01-01');
    const wrFy = fyOfDn(wrDn);
    if (rsr === 'WR') (wrSingleG[eid] = wrSingleG[eid] || []).push({ dn: wrDn, fy: wrFy, name: p.name, country: pcty, pid: pid, iso: Calc.isoNorm(pcty) });
    if (rar === 'WR') (wrAvgG[eid] = wrAvgG[eid] || []).push({ dn: wrDn, fy: wrFy, name: p.name, country: pcty, pid: pid, iso: Calc.isoNorm(pcty) });

    /* 纪录链（泳道图）：
       · 全体口径 —— 用官方标记，同时推进所属洲 / 所属国家的链（WR ⊃ CR ⊃ NR）；
       · 女子口径 —— 自己维护「历史最快女子成绩」，跨年时排序重放（见 flushFem）。 */
    {
      const piso = Calc.isoNorm(pcty) || Calc.isoNorm(p.country) || '';
      const pcont = continentShort[piso] || continentShort[pcty] || continentShort[p.country] || '';
      if (rsr) feedRec(eid, 'single', rsr, p, wrDn, wrFy, piso, pcont, pcty);
      if (rar) feedRec(eid, 'avg', rar, p, wrDn, wrFy, piso, pcont, pcty);
      const isF = String(p.gender || '').charAt(0).toLowerCase() === 'f';
      if (isF) {
        /* results.tsv 按比赛 id 排序（= 年份前缀），跨年就 flush 一次；
           万一遇到年份回退（不同版本导出偶发），也立刻 flush，避免历史顺序被打乱。 */
        if (chainYear && year !== chainYear) flushFem();
        chainYear = year;
        offerFem(eid, 'single', chainCost(eid, r.best), p, wrDn, wrFy, piso, pcont, pcty);
        offerFem(eid, 'avg', chainCost(eid, r.average), p, wrDn, wrFy, piso, pcont, pcty);
      }
    }

    /* 传比赛日期（YYYYMMDD），让「首次突破」精确到日 */
    trackMilestone(eid, r.best, year, wrDn);

    /* 年度排名候选：单次与平均取更优者（与 WCA 官方 ranks_single/ranks_average 同口径） */
    {
      const bs = toInt(r.best), ba = toInt(r.average);
      annualOffer(year, eid, pid, bs > 0 && ba > 0 ? Math.min(bs, ba) : (bs || ba));
    }

    if (isFinal && pos >= 1 && pos <= 3) {
      const tier = champWC.has(compId) ? 'WC' : (champCC.has(compId) ? 'CC' : 'OP');
      const tw = tier === 'WC' ? 1 : (tier === 'CC' ? 0.7 : 0.4);
      const pw = pos === 1 ? 1 : (pos === 2 ? 0.6 : 0.4);
      p.yearly[year] = (p.yearly[year] || 0) + pw * tw * 2;
    }
    if (rsr || rar) {
      /* 年度分按单次 / 平均拆分累计，供前端「单次 / 平均 / 总计」口径切换 */
      p.yearly[year] = (p.yearly[year] || 0) + 1;
      if (rsr) p.yearlyS[year] = (p.yearlyS[year] || 0) + 1;
      if (rar) p.yearlyA[year] = (p.yearlyA[year] || 0) + 1;
    }
  });
  flushFem();   /* 收尾：把最后一个年份的女子待定纪录重放进去 */
  let chainKeys = 0, chainSegs = 0;
  recChain.forEach(function (a) { chainKeys++; chainSegs += a.length; });
  log('results rows:', rows, 'players:', players.size,
    '| 纪录链: ' + chainKeys + ' 条（' + chainSegs + ' 次刷新）');
}

/* ---------------- 模块计算 ---------------- */
/* 名次 → 统治力积分 D(r)。
   分段线性：第 1 名满分；前 3 保0.85；前 10 从 0.70 线性降到 0.15；
   前 100 从 0.15 缓降到 0.02；100 名以外给 0.01 的底噪——
   早期版本在 50 名以外直接返回 0，与i18n 里写的「第一 / 前十 / 前百」
   不一致，导致约 79% 的明细档选手 M4 恒为 0、该权重形同虚设。 */
function domScore(r) {
  if (r <= 1) return 1;
  if (r <= 3) return 0.85;
  if (r <= 10) return ((11 - r) / 10) * 0.7;
  if (r <= 100) return 0.15 * (1 - (r - 10) / 90) * 0.85 + 0.02;
  return 0.01;
}
function placeW(pos) { return pos === 1 ? 1 : (pos === 2 ? 0.6 : 0.4); }

/* 各模块的全局最大值（归一化分母）。随 meta 下发，前端据此把
   「原始分 ÷ 全局最大值 × 100」这条归一化过程原样写给用户看。 */
let MOD_MAX = null;
/* 全站最高单项累加总分（下发给前端做条形图满值参考；总分数值本身不做归一）。 */
let ESUM_MAX = 0;

function computeModules() {
  log('计算历史字段（旧七模块 p.m/p.k，仅存档，不参与总分）…');
  const raw = {};
  const MODALL = ['m1', 'm1s', 'm1a', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7'];
  const MAXMOD = { m1: 0, m1s: 0, m1a: 0, m2: 0, m3: 0, m4: 0, m5: 0, m6: 0, m7: 0 };
  const list = [];
  players.forEach((p, id) => {
    /* NR 按国家参赛规模加权后的等效数量（p.nr 仍为原始次数，用于展示）。
       m1 为单次 + 平均合计；m1s / m1a 分别只计单次 / 平均纪录（各自按全局最大值归一），
       供前端「单次 / 平均 / 总计」筛选切换纪录分口径。 */
    const m1s = (p.wrS || 0) * 3 + (p.crS || 0) * 1.5 + (p.nrWS || 0) * 0.8;
    const m1a = (p.wrA || 0) * 3 + (p.crA || 0) * 1.5 + (p.nrWA || 0) * 0.8;
    const m1 = m1s + m1a;
    let m2 = 0, m3 = 0;
    /* 领奖台名次分布（按赛级 × 名次分桶），供前端逐项展开 M2 / M3 的计算过程 */
    const podMix = { wcg: 0, wcs: 0, wcb: 0, ccg: 0, ccs: 0, ccb: 0, ncg: 0, ncs: 0, ncb: 0, otg: 0, ots: 0, otb: 0 };
    p.podiums.forEach((pod) => {
      const tw = pod.tier === 'WC' ? 1 : (pod.tier === 'CC' ? 0.7 : 0.4);
      if (pod.tier === 'WC' || pod.tier === 'CC') m2 += placeW(pod.place) * tw;
      else m3 += placeW(pod.place) * tw;
      const sfx = pod.place === 1 ? 'g' : (pod.place === 2 ? 's' : 'b');
      const pre = pod.tier === 'WC' ? 'wc' : (pod.tier === 'CC' ? 'cc' : (pod.tier === 'NC' ? 'nc' : 'ot'));
      podMix[pre + sfx]++;
    });
    /* M4 统治力：各项目世界名次的时间积分（domScore），按项目权重加权。
       M7 实战对战：各项目名次在该项目参赛人数中的相对位次（越靠前越接近 1），取跨项目平均。
       注意 worldRank 的值是对象 {r,b,a}，必须取 .r —— 早期版本直接把对象当名次传给
       domScore()，导致 NaN 传播、M4/M7 的全局最大值恒为 0，所有选手这两个模块全部归零。 */
    let m4 = 0, m4w = 0, m7sum = 0, m7n = 0;
    /* 单项累加总分：Σ(单项分 × 项目权重)。与 M4/M7 共用同一趟 worldRank 遍历，
       不额外多扫一遍（30 万选手 × 多项目的循环成本不低）。 */
    let esum = 0;
    const evPair = [];
    const wr = worldRank.get(id) || {};
    /* 逐项目明细（供前端把 M4 / M7 / 新总分的加权和完整写出来） */
    const rkDetail = [];
    Object.keys(wr).forEach((eid) => {
      const o = wr[eid];
      const rk = o && o.r ? o.r : 0;
      if (rk <= 0) return;
      const w = (events.get(eid) || { w: 0.8 }).w;
      const ds = domScore(rk);
      m4 += ds * w;
      m4w += w;
      const cnt = eventCounts[eid] || 1;
      const rel = Math.max(0, Math.min(1, (cnt - rk) / cnt));
      m7sum += rel; m7n++;
      rkDetail.push([eid, rk, Math.round(ds * 1000) / 1000, w, cnt, Math.round(rel * 1000) / 1000]);
      const se = sOfEvent(rk);
      esum += se * w;
      /* 紧凑下发「项目:世界名次」对，前端据此复现 单项分 = 100×名次^-γ 与 贡献 = 单项分×权重 */
      evPair.push(eid + ':' + rk);
    });
    p.esum = Math.round(esum * 100) / 100;
    p.evRk = evPair.join(';');
    if (p.esum > ESUM_MAX) ESUM_MAX = p.esum;
    /* 统治力取「按权重平均」而非累加，避免「项目多」本身被当成统治力 */
    if (m4w > 0) m4 /= m4w;
    const m7 = m7n ? m7sum / m7n : 0;
    const evCount = p.eventsSet.size;
    const m5 = (evCount / 21) * 0.7 + Math.min(evCount / 17, 1) * 0.3;
    const span = Math.max(1, p.end - p.start + 1);
    const m6 = (span / 22) * 0.5 + (Math.min(p.compsSet.size, 300) / 300) * 0.3 + (p.activeStreak || 1) / 15 * 0.2;
    raw[id] = { m1, m1s, m1a, m2, m3, m4, m5, m6, m7 };
    /* 各模块的「计算过程」明细：只随明细档选手（DETAIL_MAX 名内）下发，
       前端选手页据此把每个模块的代入过程逐项写出来（需求：总分过程要写出各个分数的计算过程）。 */
    p.mCalc = {
      rec: [p.wrS || 0, p.crS || 0, Math.round((p.nrWS || 0) * 100) / 100,
        p.wrA || 0, p.crA || 0, Math.round((p.nrWA || 0) * 100) / 100],
      pod: [podMix.wcg, podMix.wcs, podMix.wcb, podMix.ccg, podMix.ccs, podMix.ccb,
        podMix.ncg, podMix.ncs, podMix.ncb, podMix.otg, podMix.ots, podMix.otb],
      rk: rkDetail,
      ev: evCount,
      span: span, comps: p.compsSet.size, streak: p.activeStreak || 1
    };
    MODALL.forEach((k) => { if (raw[id][k] > MAXMOD[k]) MAXMOD[k] = raw[id][k]; });
    list.push(p);
  });

  // 连续参赛年
  list.forEach((p) => {
    const ys = Object.keys(p.yearly).map(Number).sort((a, b) => a - b);
    let streak = 1, mx = 1;
    for (let i = 1; i < ys.length; i++) { if (ys[i] === ys[i - 1] + 1) { streak++; mx = Math.max(mx, streak); } else streak = 1; }
    p.activeStreak = mx;
  });

  const norm = (v, k) => MAXMOD[k] > 0 ? Math.max(0, Math.min(100, v / MAXMOD[k] * 100)) : 0;
  list.forEach((p) => {
    const r = raw[p.wcaId];
    const m = {}, pk = {};
    MODALL.forEach((k) => { m[k] = Math.round(norm(r[k], k) * 100) / 100; });
    const ys = Object.keys(p.yearly).map(Number).sort((a, b) => a - b);
    let total = 0; ys.forEach((y) => total += p.yearly[y]);
    const avgAnnual = ys.length ? total / ys.length : 0;
    let best3 = 0;
    for (let i = 0; i + 2 < ys.length; i++) {
      const s = (p.yearly[ys[i]] || 0) + (p.yearly[ys[i + 1]] || 0) + (p.yearly[ys[i + 2]] || 0);
      if (s > best3) best3 = s;
    }
    const conc = avgAnnual > 0 ? best3 / (3 * avgAnnual) : 1;
    const peakFactor = Math.max(0.85, Math.min(1.15, conc));
    MODALL.forEach((k) => { pk[k] = Math.round(Math.min(100, m[k] * peakFactor) * 100) / 100; });

    p.m = m; p.pk = pk;
    /* Elo 峰值：M7（实战对战，已归一化到 0–100）映射回 1400–2300 的强度区间。
       注意 m.m7 是归一化后的百分制，需除以 100，否则会算出 8 位数的假分数。 */
    p.eloPeak = Math.round(1400 + (m.m7 / 100) * 900);
    p.career = Math.round(Calc.weighted(m) * 10) / 10;
    p.peak = Math.round(Calc.weighted(pk) * 10) / 10;
    /* 新总分口径（六维）：overall = 六维总分 t = Σ_d w_d × s_d。
       无六维分的选手（新模型口径下无任何维度得分）记 0 —— 不混用旧 esum，
       否则同一张榜上会出现两套量纲。旧 esum 仍随包下发，仅供对照，不参与排名。 */
    const sd = SIX.get(p.wcaId);
    p.six = sd || null;
    p.sixEv = SIXEV.get(p.wcaId) || null;
    p.sixS = SIX_S.get(p.wcaId) || null;
    p.sixA = SIX_A.get(p.wcaId) || null;
    /* 主表只保留前 62,000 名，长尾选手在这里查不到 sd；
       从全量轻表补真实总分，否则 23 万人在搜索/名册里一律显示「总分 0」。 */
    if (sd) p.overall = Math.round(sd.t * 100) / 100;
    else {
      const tailT = TAILT.get(p.wcaId);
      p.overall = tailT != null ? Math.round(tailT * 100) / 100 : 0;
    }

    // 领奖台补 field / factors / R
    p.podiums.forEach((pod) => {
      const fs = finalCounts.get(pod.compId + '|' + pod.ev);
      pod.field = fs ? fs.size : 0;
      const ev = events.get(pod.ev) || { w: 0.8 };
      const Cw = pod.tier === 'WC' ? 1.6 : (pod.tier === 'CC' ? 1.4 : (pod.tier === 'NC' ? 1.25 : 1.0));
      const V = Math.pow(pod.place, -1.1);
      const CSI = Math.max(0.35, Math.min(3.0, Math.pow(Math.max(pod.field, 1) / 90, 0.5)));
      pod.factors = { we: Math.round(ev.w * 100) / 100, S: 1.0, Tpod: 1.0, V: Math.round(V * 1000) / 1000, C: Cw, CSI: Math.round(CSI * 100) / 100, z: 0, margin: 0 };
      pod.R = Math.round(100 * ev.w * 1.0 * 1.0 * V * Cw * CSI * 10) / 10;
    });
    p.recTotal = p.records.length;
    /* 纪录明细全量保留：M1 占有段按整条阶梯切段，
       截断任何一条都会让「前一位留下的值」失真（G 被高估）或让段长被低估。
       排序只为前端默认顺序，不参与截断。 */
    p.records.sort((a, b) => b.R - a.R);
    p.podTotal = p.podiums.length;
    /* ★ 冠军数 / 领奖台数按赛级统计，必须在**截断之前**做：
       下面会把 podiums 按 R 取前 10 条下发（控制包体），而 R 由赛级加成参与计算，
       洲锦 / 国家赛的领奖台几乎进不了前十 —— 若在截断后再统计，
       国家赛相关的数字对所有选手都会恒为 0（线上正是这个现象）。 */
    const podTier = { WC: 0, CC: 0, NC: 0, OP: 0, Local: 0 };
    const podGold = { WC: 0, CC: 0, NC: 0, OP: 0, Local: 0 };
    p.podiums.forEach((x) => {
      if (podTier[x.tier] == null) podTier[x.tier] = 0;
      if (podGold[x.tier] == null) podGold[x.tier] = 0;
      podTier[x.tier]++;
      if (x.place === 1) podGold[x.tier]++;
    });
    p.podTier = podTier;
    p.podGold = podGold;
    p.wcGold = podGold.WC;
    p.ccGold = podGold.CC;
    p.ncGold = podGold.NC;
    p.podiums.sort((a, b) => b.R - a.R);
    if (p.podiums.length > 10) p.podiums = p.podiums.slice(0, 10);

    const wr = worldRank.get(p.wcaId) || {};
    let bestEv = null, bestRk = 1e9;
    Object.keys(wr).forEach((eid) => { if (wr[eid].r < bestRk) { bestRk = wr[eid].r; bestEv = eid; } });
    if (!bestEv) { let bestN = -1; p.eventsSet.forEach((eid) => { if ((eventCounts[eid] || 0) > bestN) { bestN = eventCounts[eid]; bestEv = eid; } }); if (!bestEv) bestEv = '333'; }
    p.mainEvent = bestEv;

    /* wcGold / ccGold / ncGold 已在上面（截断之前）算好，这里不要再重算一遍。 */
    /* 在位月数：世界第一的累计在位时长，取自 M4 统治力引擎（M4_seats.tsv 的 d1 / d10 / d100，
       单位是年，按各项目累加）。此前这里一律写 0，选手页「在位月数」因此永远是 0。 */
    const m4s = M4SEATS.get(p.wcaId);
    p.months1 = m4s ? Math.round(m4s.d1 * 12) : 0;
    p.months10 = m4s ? Math.round(m4s.d10 * 12) : 0;
    p.months100 = m4s ? Math.round(m4s.d100 * 12) : 0;
    p.peakSpan = 0; p.peakAge = 0;

    p.events = Array.from(p.eventsSet).sort((a, b) => ((events.get(a) || { rank: 99 }).rank) - ((events.get(b) || { rank: 99 }).rank));
    p.comps = p.compsSet.size;
    /* 参赛城市数：由该选手参加过的赛事去重城市名得到（真实值，不再是估算） */
    const citySet = new Set();
    p.compsSet.forEach((cid) => { const c = comps.get(cid); if (c && c.city) citySet.add(c.city + '|' + (c.country_id || '')); });
    p.cities = citySet.size;
    p.start = p.start === 9999 ? 2003 : p.start;
    if (p.end === 0) p.end = p.start;
    p.hue = Calc.U.hue(p.name);
    p.id = p.wcaId;
    p.nameZh = null;
  });

  /* ---------------- 每项目榜单（按该项目世界排名取前 N） ----------------
     供前端"筛选单个项目后按该项目成绩单独排名"使用；
     成绩取 ranks_single/ranks_average 的官方 best 列（WCA 权威口径，
     旧/新多盲编码由此自动正确解码）；未入榜者在该项目上必然弱于入榜者，
     前端追加在榜尾即可保证整体次序正确。 */
  const EVENT_BOARD_MAX = 5000;
  list.forEach((p) => {
    const wr = worldRank.get(p.wcaId) || {};
    Object.keys(wr).forEach((eid) => {
      if (!Calc.EV[eid]) return;
      const o = wr[eid];
      if (o.r > EVENT_BOARD_MAX || o.r <= 0) return;
      const arr = EVENT_BOARDS[eid] || (EVENT_BOARDS[eid] = []);
      arr.push({
        id: p.wcaId, r: o.r, b: o.b || 0, a: o.a || 0,
        s: o.b > 0 ? fmtResult(eid, o.b, 'single') : '',
        af: o.a > 0 ? fmtResult(eid, o.a, 'avg') : ''
      });
    });
  });
  Object.keys(EVENT_BOARDS).forEach((eid) => {
    EVENT_BOARDS[eid].sort((x, y) => x.r - y.r);
    if (EVENT_BOARDS[eid].length > EVENT_BOARD_MAX) EVENT_BOARDS[eid] = EVENT_BOARDS[eid].slice(0, EVENT_BOARD_MAX);
  });
  log('每项目榜单:', Object.keys(EVENT_BOARDS).length, '个项目, 最大深度', EVENT_BOARD_MAX);

  /* 归一化分母下发前端（选手页展示各模块归一化过程用）。
     保留 6 位小数：M5 / M6 这类本身在 0.1~0.4 量级，截断到 3 位会让
     前端复算的归一化结果与p.m 差出 0.05 左右的可见误差。 */
  MOD_MAX = {};
  MODALL.forEach((k) => { MOD_MAX[k] = Math.round(MAXMOD[k] * 1e6) / 1e6; });

  /* 释放中间结构：榜单已独立持有所需数据，worldRank/finalCounts 不再需要 */
  worldRank.clear(); finalCounts.clear();

  return list;
}

/* ---------------- 二次扫描：真实「单场最多项目数 / 多项目参赛场次」 ----------------
   第一遍无法在有限内存内为每个选手保存 (赛事 → 项目数) 明细，
   因此只对最终要输出的选手做一次定向扫描，得到真实值（不再用估算值）。 */
async function enrichCompStats(ids) {
  if (!ids || !ids.size) return;
  log('二次扫描 results（仅输出选手）…');
  const cnt = new Map();          // pid -> Map(compId -> Set(项目))
  await streamTsv('results', (r) => {
    const pid = r.person_id; if (!pid || !ids.has(pid)) return;
    const cid = r.competition_id; if (!cid) return;
    let m = cnt.get(pid); if (!m) { m = new Map(); cnt.set(pid, m); }
    let s = m.get(cid); if (!s) { s = new Set(); m.set(cid, s); }
    s.add(r.event_id);
  });
  cnt.forEach((m, pid) => {
    const p = players.get(pid); if (!p) return;
    let mx = 0, multi = 0;
    m.forEach((s) => { const n = s.size; if (n > mx) mx = n; if (n >= 5) multi++; });
    p.maxEventsPerComp = mx;
    p.multiEventComp = multi;
  });
  log('二次扫描完成:', cnt.size, '人');
}

/* ---------------- 纪录保持天数 ----------------
   recSeq 已按 (项目|单/均|层级|国家) 收集了全部纪录的创立日期；
   某条纪录的保持天数 = 创立日 → 同口径下一条纪录的创立日（没有则到数据导出日）。 */
function computeHeld(list, asOf) {
  const today = dateNum(asOf) || dateNum(new Date().toISOString().slice(0, 10));
  Object.keys(recSeq).forEach((k) => {
    const a = recSeq[k];
    a.sort((x, y) => x - y);
    for (let i = a.length - 1; i > 0; i--) if (a[i] === a[i - 1]) a.splice(i, 1);
  });
  let n = 0;
  list.forEach((p) => {
    p.records.forEach((rec) => {
      const a = recSeq[rec.k];
      if (!a || !a.length) { rec.held = 0; rec.current = false; return; }
      let lo = 0, hi = a.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (a[mid] <= rec.dn) lo = mid + 1; else hi = mid; }
      const next = a[lo];
      rec.held = daysBetween(rec.dn, next || today);
      rec.current = !next;
      const eb = p.evStat && p.evStat[rec.ev];
      if (eb) {
        eb.held += rec.held;
        if (rec.held > eb.heldLong) eb.heldLong = rec.held;
        if (rec.current) eb.heldNow++;
      }
      n++;
    });
  });
  log('纪录保持天数已计算:', n, '条');
}

/* ---------------- 纪录链泳道（世界 / 洲 / 国家 × 全体 / 女子） ----------------
   与 buildLanes 的区别：
     · 数据源是上面收集的 recChain（同一结构，但按 scope 分开）；
     · 合并同一人的连续刷新时，把每一次的日期记进 seg.subs —— 前端据此在色块里
       画「刻度线」并在 tooltip 里列出刷新次数（用户 2026-11-01 要求「合并的段要
       能看出单人刷了几次」）；
     · 输出是扁平字典，键为 `scope|s|gen` / `scope|a|gen`，值为该范围下的泳道数组。 */
function buildChainLanes(asOf) {
  const endDn = dateNum(asOf) || dateNum(new Date().toISOString().slice(0, 10));
  const endFy = fyOfDn(endDn);
  const out = {};
  recChain.forEach(function (arr, key) {
    const parts = String(key).split('\u0001');
    const scope = parts[0], eid = parts[1], kind = parts[2], gen = parts[3];
    if (!arr || !arr.length) return;
    arr.sort(function (a, b) { return a.dn - b.dn || String(a.pid).localeCompare(String(b.pid)); });
    const retired = !!(Calc.EV[eid] || {}).retired;
    const stopDn = retired ? (dateNum(String(eventLastYear[eid] || endDn) + '-12-31') || endDn) : endDn;
    const stopFy = retired ? fyOfDn(stopDn) : endFy;
    const segs = [];
    let cur = null;
    for (let i = 0; i < arr.length; i++) {
      const e = arr[i];
      /* 换籍也切段（2026-11-02）：理由同上，WR 链上换代表国要另起一段。 */
      if (!cur || cur.id !== (e.pid || null) || cur.holder !== e.name || cur.country !== e.country) {
        if (cur) { cur.to = e.fy; cur.toDn = e.dn; cur.days = daysBetween(cur.fromDn, e.dn); }
        cur = {
          from: e.fy, to: stopFy, fromDn: e.dn, toDn: stopDn, holder: e.name,
          country: e.country, iso: e.iso || '', id: e.pid || null, days: 0, subs: [e.dn]
        };
        segs.push(cur);
      } else {
        cur.subs.push(e.dn);
      }
    }
    if (cur) { cur.to = stopFy; cur.toDn = stopDn; cur.days = daysBetween(cur.fromDn, stopDn); }
    const ok2 = scope + '|' + (kind === 'avg' ? 'a' : 's') + '|' + gen;
    if (!out[ok2]) out[ok2] = [];
    out[ok2].push({
      ev: eid, retired: retired,
      zh: (Calc.EV[eid] || { zh: eid }).zh, en: (Calc.EV[eid] || { en: eid }).en,
      segs: segs.map(packSeg)
    });
  });
  return out;
}

/* 泳道段压缩：一个国家一条链、上百个国家加起来是几万段，字段名占的体积不可忽视
   （实测 4 万段里键名就吃掉 2.4MB）。这里改成短键 + 4 位小数的年份：
     f/t 起止小数年（4 位 = 约 53 分钟精度，够画图）· fd/td 起止日期整数（YYYYMMDD）
     h 姓名 · i 选手 WCA ID · o ISO2（前端只用 ISO2 取国旗，国名全称不再下发）
     s 段内每次刷新的日期（只有 1 次的段省略，前端按 1 次处理）
   持有天数 = fd 到 td 的天数，前端按同样口径算，不必存。 */
function packSeg(sg) {
  const o = {
    f: Math.round(sg.from * 10000) / 10000,
    t: Math.round(sg.to * 10000) / 10000,
    fd: sg.fromDn, td: sg.toDn,
    h: sg.holder, i: sg.id, o: sg.iso || ''
  };
  if (sg.subs && sg.subs.length > 1) {
    /* 同一天刷两次（同一场比赛的两轮）只留一个：图上刻度位置一样，tooltip 里列两遍
       同一天反而像 bug，「刷新 N 次」按不同日期计数更符合直觉。 */
    const uniq = [];
    for (let i = 0; i < sg.subs.length; i++) if (sg.subs[i] !== uniq[uniq.length - 1]) uniq.push(sg.subs[i]);
    if (uniq.length > 1) o.s = uniq;
  }
  return o;
}

/* ---------------- WR 泳道 ---------------- */
function buildLanes(store, asOf) {
  const endDn = dateNum(asOf) || dateNum(new Date().toISOString().slice(0, 10));
  const endFy = fyOfDn(endDn);
  return Object.keys(store).sort().map((eid) => {
    const arr = store[eid].slice().sort((a, b) => a.dn - b.dn);
    const segs = [];
    /* 停办项目：最后一段只画到该项目的最后一次比赛，不再延伸到今天 */
    const retired = !!(Calc.EV[eid] || {}).retired;
    const stopDn = retired ? (dateNum(String(eventLastYear[eid] || endDn) + '-12-31') || endDn) : endDn;
    const stopFy = retired ? fyOfDn(stopDn) : endFy;
    let cur = null;
    arr.forEach((e) => {
      /* 同一人连续持有则合并成一段；换人时才切段（用 pid 判定，避开同名不同人）。
         ⚠ 2026-11-01 修：这里原先读的是 `cur.pid`，而段对象上的字段叫 `id` ——
         `undefined !== pid` 恒真，于是**每一条世界纪录刷新都被切成了独立一段**，
         同一个人连着刷新纪录时图上会出现一串同色的窄条（实测 624 个相邻对里 221 对是同一人）。 */
      /* 换籍也切段（2026-11-02）：同一人在同一条链上改了代表国，段内国旗不能停在旧国。
         NR/CR 链本身按国家分 key，只有 WR 链会碰到这种情况。 */
      if (!cur || cur.id !== (e.pid || null) || cur.holder !== e.name || cur.country !== e.country) {
        if (cur) { cur.to = e.fy; cur.toDn = e.dn; cur.days = daysBetween(cur.fromDn, e.dn); }
        cur = {
          from: e.fy, to: stopFy, fromDn: e.dn, toDn: stopDn, holder: e.name, country: e.country,
          id: e.pid || null, iso: e.iso || '', days: 0, subs: [e.dn],
          color: 'hsl(' + Calc.U.hue(e.name) + ',58%,52%)'
        };
        segs.push(cur);
      } else {
        /* 同一人连续刷新：合并成一段，但把每一次的日期留下来（图上画刻度、tooltip 列次数） */
        cur.subs.push(e.dn);
      }
    });
    if (cur) { cur.to = stopFy; cur.toDn = stopDn; cur.days = daysBetween(cur.fromDn, stopDn); }
    return { ev: eid, zh: (Calc.EV[eid] || { zh: eid }).zh, en: (Calc.EV[eid] || { en: eid }).en, retired: retired, segs: segs };
  });
}

/* ---------------- 单项目里程碑（真实首次突破） ---------------- */
function buildEventMilestones() {
  const map = {};
  Object.keys(msGlobal).forEach((eid) => {
    const bars = Calc.EV_BARRIERS[eid]; if (!bars) return;
    const e = Calc.EV[eid]; if (!e) return;
    const arr = bars.filter((b) => msGlobal[eid][b[0]] != null).map((b) => {
      const dn = msGlobal[eid][b[0]];
      const y = Math.floor(dn / 10000);
      const ds = String(dn);
      const date = ds.length === 8 ? (ds.slice(0, 4) + '-' + ds.slice(4, 6) + '-' + ds.slice(6, 8)) : '';
      let zh, en;
      if (eid === '333fm') { zh = e.zh + ' 最少步单次首次 ≤' + b[0] + ' 步'; en = e.en + ' FMC single first ≤' + b[0] + ' moves'; }
      else if (eid === '333mbf') { zh = e.zh + ' 多盲单次首次 ≥' + b[0] + ' 个'; en = e.en + ' MBLD single first ≥' + b[0]; }
      else { zh = e.zh + ' 单次首次 sub ' + b[0] + ' 秒'; en = e.en + ' single first sub-' + b[0]; }
      return { year: y, date: date, zh: zh, en: en };
    });
    if (arr.length) map[eid] = arr;
  });
  return map;
}

/* ---------------- 主流程 ---------------- */
(async function main() {
  const t0 = Date.now();
  await loadDimensions();
  await processResults();
  /* 单次成绩在独立表 result_attempts（v2 导出），单独扫一遍拿真实尝试 / 复原 / DNF */
  await processAttempts();
  const list = computeModules();
  list.sort((a, b) => b.overall - a.overall);

  log('排序 …');
  /* 分层输出：DETAIL_MAX 名以内保留纪录 / 领奖台明细，
     SLIM_MAX 名以内保留可排名可筛选的精简档案（无明细），
     其余选手不随包下发（数据量所限），但排序 / 聚合仍按全量计算。
     例外：拿过纪录的选手一律进明细层 —— M1 占有段按整条阶梯切段，
     少一个人就让那一级阶梯断一截，与名次高低无关。 */
  const detail = DETAIL_MAX > 0 ? list.slice(0, DETAIL_MAX) : list;
  const detailIds = new Set(detail.map((p) => p.wcaId));
  let backfilled = 0;
  if (DETAIL_MAX > 0) {
    for (const p of list) {
      if (!p.records || !p.records.length || detailIds.has(p.wcaId)) continue;
      detail.push(p); detailIds.add(p.wcaId); backfilled++;
    }
    if (backfilled) {
      detail.sort((a, b) => b.overall - a.overall);
      log('纪录持有者补入明细层:', backfilled, '人');
    }
  }
  const slim = SLIM_MAX > DETAIL_MAX
    ? list.slice(DETAIL_MAX, SLIM_MAX).filter((p) => !detailIds.has(p.wcaId))
    : [];
  const emit = detail.concat(slim);
  const emitIds = new Set();
  emit.forEach((p) => emitIds.add(p.wcaId));
  KEEP_YEARLY_N = Math.min(emit.length, KEEP_YEARLY);
  emit.forEach((p, i) => {
    if (i >= KEEP_YEARLY_N) { p.yearly = {}; p.yearlyS = {}; p.yearlyA = {}; }
  });
  list.forEach((p) => { if (!emitIds.has(p.wcaId)) { p.yearly = {}; p.yearlyS = {}; p.yearlyA = {}; } });

  /* 定向二次扫描：仅对输出选手求真实「单场最多项目数 / 多项目参赛场次」 */
  await enrichCompStats(emitIds);

  /* 去重集合固化后立刻释放（30 万选手常驻 compId / 城市名集合会耗尽堆） */
  freezeEvStat(list);
  if (global.gc) global.gc();

  /* 纪录保持天数（真实：创立 → 被刷新，或至今） */
  computeHeld(detail, arg('--date', '') || new Date().toISOString().slice(0, 10));

  const NATIONS_RAW = {};
  list.forEach((p) => {
    if (!NATIONS_RAW[p.country]) NATIONS_RAW[p.country] = { iso: p.country, total: 0, count: 0, best: 0, bestName: '' };
    const n = NATIONS_RAW[p.country]; n.total += p.overall; n.count++;
    if (p.overall > n.best) { n.best = p.overall; n.bestName = p.name; }
  });

  /* 全量洲 / 国总人数（用于选手页「世界 / 洲 / 国家」排名分母 = 全部 WCA 选手，
     而非下发的前 6 万名头部）。
     注意：名单里的 country 是原始 country_id（老版本导出是 ISO3，如 AUS），
     而前端选手对象的 country 已被 Calc.isoNorm 归一为 ISO2（AU）——
     分母表的键必须跟前端一致用 ISO2，否则查表恒落空、分母会静默退化。 */
  const continentTotals = {}, nationTotals = {};
  list.forEach((p) => {
    const iso = Calc.isoNorm(p.country) || p.country;
    const c = continentShort[iso] || continentShort[p.country] || '';
    if (c) continentTotals[c] = (continentTotals[c] || 0) + 1;
    nationTotals[iso] = (nationTotals[iso] || 0) + 1;
  });

  /* 年度前10 / 前100 名次数：annualTop 里每个 (年,项目) 只留前 200 名，
     因此名次≤100 的选手必然在榜内，可直接计数（无需为每位选手存完整年度名次表）。
     计数前必须先 annualFinalize()：把阶段一的 Map 排序成真实名次数组，
     否则数组下标不等于名次（此前因同一人多占槽位而错排，见 annualOffer 处的坑）。 */
  annualFinalize();
  const yTop10 = {}, yTop100 = {};
  Object.keys(annualTop).forEach((k) => {
    const arr = annualTop[k];
    const year = k.slice(0, k.indexOf('|'));
    arr.forEach((e, i) => {
      const r = i + 1;
      if (r > 100) return;
      yTop100[e.pid] = (yTop100[e.pid] || 0) + 1;
      if (r <= 10) yTop10[e.pid] = (yTop10[e.pid] || 0) + 1;
      void year;
    });
  });
  list.forEach((p) => {
    p.yTop10 = yTop10[p.wcaId] || 0;
    p.yTop100 = yTop100[p.wcaId] || 0;
  });
  Object.keys(annualTop).forEach((k) => { delete annualTop[k]; });

  let totWR = 0, totRec = 0, totPod = 0;
  list.forEach((p) => { totWR += p.wr; totRec += p.records.length; totPod += p.podiums.length; });
  if (detail.length) {
    const bytes = detail.reduce((a, p) => a + (p.records || []).reduce((b, r) => b + JSON.stringify(r).length + 1, 0), 0);
    log('纪录明细: 全量', totRec.toLocaleString(), '条｜明细层', detail.length.toLocaleString(), '人｜约', (bytes / 1048576).toFixed(1), 'MB');
  }
  const meta = {
    demo: false,
    updated: (arg('--date', '') || new Date().toISOString().slice(0, 10)),
    exportVersion: arg('--ver', 'v2.0.2'),
    players: list.length, events: events.size, comps: comps.size,
    /* sixAll = 六维引擎实际算过分的人数（全量 298,715），sixCovered = 主表里带六个维度分的人数
       （SITE_MAX 截断后的 62,000）。前端文案用 sixAll 说明「全站都评过分」，
       否则「评分体系收录 60,579 位」会让用户误以为另外 24 万人没被统计。 */
    sixAll: TAILT.size,
    wr: totWR, records: totRec, podiums: totPod, nations: Object.keys(NATIONS_RAW).length,
    modMax: MOD_MAX,
    esumMax: ESUM_MAX,
    /* 六维（当前模型）：权重与维度中文名，供前端贡献表 / 图例使用 */
    sixWeights: SIX_W,
    sixNames: { m1: '纪录持有', m2: '领奖台', m3: '大赛表现', m4: '统治力', m5: '纪录比', m6: '突破幅度' },
    sixCovered: SIX.size,
    evGamma: EV_GAMMA,
    /* 项目 → 该项目最后一天（YYYYMMDD）。前端竞速图选到停办项目时把时间轴截到这一天；
       值等于「该项目最后一次有人比赛的日子」，比按年份写死更准。 */
    evLast: eventLastDn,
    emitted: emit.length, detailMax: DETAIL_MAX, slimMax: SLIM_MAX,
    continentTotals: continentTotals, nationTotals: nationTotals
  };

  const base = (p) => ({
    id: p.id, wcaId: p.wcaId, name: p.name, nameZh: p.nameZh, country: p.country, gender: p.gender,
    start: p.start, end: p.end, comps: p.comps, mainEvent: p.mainEvent, events: p.events, hue: p.hue,
    m: p.m, pk: p.pk, career: p.career, peak: p.peak, overall: p.overall, esum: p.esum, evRk: p.evRk,
    six: p.six || null, sixEv: p.sixEv || null, sixS: p.sixS || null, sixA: p.sixA || null,
    /* 六维各自的年度曲线（占本人该维最终分的千分比）。没有就不下发，前端退回旧曲线。 */
    sy: SIXY.get(p.id) || null,
    balance: Math.round(Math.log(Math.max(p.career, 0.01) / Math.max(p.peak, 0.01)) * 1000) / 1000,
    wr: p.wr, cr: p.cr, nr: p.nr, nrW: Math.round((p.nrW || 0) * 100) / 100,
    recTotal: p.recTotal || 0, podTotal: p.podTotal || 0,
    wcGold: p.wcGold, ccGold: p.ccGold, ncGold: p.ncGold,
    podTier: p.podTier || null, podGold: p.podGold || null,
    months1: p.months1 || 0, months10: p.months10 || 0, months100: p.months100 || 0,
    eloPeak: p.eloPeak, peakSpan: 0, peakAge: 0,
    resultRows: p.resultRows || 0, attempts: p.attempts || 0, solves: p.solves || 0, dnf: p.dnf || 0,
    cities: p.cities || 0, maxEventsPerComp: p.maxEventsPerComp || 0, multiEventComp: p.multiEventComp || 0,
    yTop10: p.yTop10 || 0, yTop100: p.yTop100 || 0,
    mCalc: p.mCalc || null,
    yearly: p.yearly, yearlyS: p.yearlyS || {}, yearlyA: p.yearlyA || {}
  });
  /* ---------- 明细分片（2026-11-07）----------
     旧格式把 2500 位明细选手的完整 base() 对象内联进 PLAYERS，约占 40MB
     （全包 65%），首屏必须等它下载并解析完才能画页面。现在主包只下发 SLIM
     （全部可排名选手的紧凑档），明细层另写 data_detail.js 后台补入。
     同一个人在 SLIM 行里已有 m / pk / six / sixEv / sy / wr / cr / nr 等评分字段，
     所以分片只带「SLIM 里没有的」纪录 / 领奖台 / 年度曲线 / 统计字段；
     Object.assign 合并后与旧格式等价，体积却小得多。 */
  const detailOnly = (p) => ({
    id: p.id,
    records: p.records, podiums: p.podiums, evS: encEvStat(p),
    yearly: p.yearly, yearlyS: p.yearlyS || {}, yearlyA: p.yearlyA || {},
    recTotal: p.recTotal || 0, podTotal: p.podTotal || 0,
    wcGold: p.wcGold, ccGold: p.ccGold, ncGold: p.ncGold,
    podTier: p.podTier || null, podGold: p.podGold || null,
    nrW: Math.round((p.nrW || 0) * 100) / 100,
    months1: p.months1 || 0, months10: p.months10 || 0, months100: p.months100 || 0,
    eloPeak: p.eloPeak, yTop10: p.yTop10 || 0, yTop100: p.yTop100 || 0,
    mCalc: p.mCalc || null, nameZh: p.nameZh || null
  });
  /* emitPlayers 在 encEvStat / EVK 定义之后生成（见下方「明细分片写出」）。
     此处先只定义转换函数，避免 const 的暂时性死区。 */
  /* 精简档案用「数组 + 列名表」紧凑编码，浏览器端展开为对象后再 assemble。
     career/peak/overall/balance/eloPeak/hue/rank 均由 assemble 依 m/pk 现算，
     不再冗余存储；约 150 字节/人，可把全部约 30 万 WCA 选手随包下发、可搜索。 */
  const SLIM_KEYS = ['id', 'name', 'country', 'gender', 'start', 'end', 'comps', 'mainEvent', 'events',
    'm', 'pk', 'esum', 'evRk', 'wr', 'cr', 'nr', 'resultRows', 'attempts', 'solves', 'dnf', 'cities',
    'maxEventsPerComp', 'multiEventComp', 'six', 'sixEv', 'sixS', 'sixA', 'sy',
    /* ★ 2026-11-07 第十四轮修复：分数竞速图「全项目 / 全维度」总分行用 p.yearly 做时间演化，
       原先被误放进 37MB 明细分片，导致首屏 core-only 时 p.yearly 缺失 → 全员 0 分 → 图表空白。
       竞速图首屏就要画，yearly 必须随 core 主包下发（旧 71MB 全包本就含它）。yearlyS/yearlyA
       仍留分片（单/均口径次要，core-only 时竞速图按 careerRamp 回退，不空白）。 */ 'yearly'];
  const MODK = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm1s', 'm1a'];
  /* 按项目六维分紧凑编码：'333:1.2,3.4,0,0,0,0.5,1.9;222:…'
     3 位小数足够（排序与 1 位小数展示都不受影响），比对象数组省约一半字节。 */
  function encSixEv(m) {
    if (!m) return null;
    const out = [];
    for (const ev in m) out.push(ev + ':' + m[ev].map(function (v) { return Math.round((v || 0) * 1000) / 1000; }).join(','));
    return out.join(';');
  }
  /* 所有 emit 选手都进 SLIM：明细层选手也需要一份精简档，否则分片加载前
     榜单会缺掉最靠前的 2500 人（排名全乱）。明细字段由 data_detail.js 补。 */
  const slimRows = (NO_DETAIL ? slim : emit).map((p, pi) => {
    const row = SLIM_KEYS.map((k) => {
      if (k === 'm' || k === 'pk') {
        const o = p[k] || {};
        return MODK.map((mk) => round2(o[mk]));
      }
      if (k === 'events') return (p.events || []).join(',');
      if (k === 'six') return p.six ? SIXK.map((mk) => round2(p.six[mk])).concat([round2(p.six.t)]) : null;
      if (k === 'sixS') return p.sixS ? SIXK.map((mk) => round2(p.sixS[mk])).concat([round2(p.sixS.t)]) : null;
      if (k === 'sixA') return p.sixA ? SIXK.map((mk) => round2(p.sixA[mk])).concat([round2(p.sixA.t)]) : null;
      if (k === 'sixEv') return encSixEv(p.sixEv);
      /* 六维年度曲线：精简档也带上（明细层很多人不到 2500，全靠精简档承载，
         少了它单维竞速图对这些人是「没有历史」，只能按生涯进度线性长出来）。 */
      if (k === 'sy') return SIXY.get(p.id) || null;
      return p[k];
    });
    /* 精简档案不带 evS / 纪录明细；但 emit 前 detail.length 位是明细层，
       稍后还要用 p.evStat / p.records 生成 data_detail.js，不能提前释放。 */
    if (NO_DETAIL || pi >= detail.length) {
      p.evStat = null; p.records = null; p.podiums = null;
      p.worldRank = null; p.yearRank = null;
    }
    return row;
  });
  function round2(v) { return Math.round((v || 0) * 100) / 100; }

  /* 按项目统计（趣味统计页项目筛选用）：只保留该项目上有真实成绩的条目，
     紧凑成 'eid:rows,att,sol,dnf,pod,gold,sil,bro,wr,cr,nr,comps,wc,cc,nc,lo,op,held,heldLong,heldNow,cityN,yrCnt,yrStr,goldY,recBest'
     的紧凑字符串，避免几十万选手的对象开销。 */
  const EVK = ['rows', 'att', 'sol', 'dnf', 'pod', 'gold', 'sil', 'bro', 'wr', 'cr', 'nr',
    'comps', 'wc', 'cc', 'nc', 'lo', 'op', 'held', 'heldLong', 'heldNow'];
  function encEvStat(p) {
    const ids = Object.keys(p.evStat || {});
    if (!ids.length) return '';
    const parts = ids.map((eid) => {
      const b = p.evStat[eid];
      const nums = EVK.map((k) => b[k] || 0);
      nums.push(b.cityN || 0);
      nums.push((b.years || []).length);
      nums.push((b.years || []).join('.'));
      /* goldPerYear / recPerYear 供「最佳年份」类指标使用，
         也用于单项目模式下把竞速图切换成该项目的排名演进。 */
      const gy = b.goldPerYear || {};
      nums.push(Object.keys(gy).map((y) => y + '_' + gy[y]).join('.'));
      const ry = b.recPerYear || {};
      let rb = 0; Object.keys(ry).forEach((y) => { if (ry[y] > rb) rb = ry[y]; });
      nums.push(rb);
      nums.push(Object.keys(ry).map((y) => y + '_' + ry[y]).join('.'));
      return eid + ':' + nums.join(',');
    });
    return parts.join(';');
  }

  /* ---------- 长尾名册（单独文件，按需懒加载） ----------
     data.js 里没下发的选手在这里保留最简可搜索信息：
     「id~姓名~国家~性别~总分~起始年~结束年~场次~项目集」一行一条。
     提前写出：名册不依赖 evStat / 纪录明细，写完即可释放长尾选手的重结构，
     显著降低后续 JSON.stringify(data.js) 时的堆峰值。 */
  if (!NO_ROSTER) {
    /* 不能再用 list.slice(emit.length)：明细层会把有纪录的选手从长尾里"挖"进来，
       emit 不再是 list 的连续前缀，按长度切会漏掉恰好被顶到边界的那个人。 */
    const tail = list.filter((p) => !emitIds.has(p.wcaId));
    /* 长尾为空（slim-max 大到把所有选手都放进 data.js）时不要写空名册覆盖既有文件，
       否则会把上一次构建产出的 15MB 名册清零，长尾搜索随即失效。 */
    if (!tail.length) {
      log('跳过名册写出：本次构建无长尾选手（全部随 data.js 下发），保留既有', ROSTER_OUT);
    } else {
      const lines = new Array(tail.length);
      for (let i = 0; i < tail.length; i++) {
        const p = tail[i];
        lines[i] = [p.id, p.name, Calc.isoNorm(p.country) || p.country, p.gender, p.overall,
          p.start, p.end, p.comps, (p.events || []).join(',')].join('~');
        /* 长尾选手不参与 data.js 输出，立刻释放按项目统计 / 纪录 / 领奖台明细 */
        p.evStat = null; p.records = null; p.podiums = null;
        p.yearly = null; p.yearlyS = null; p.yearlyA = null;
        p.worldRank = null; p.yearRank = null;
      }
      const rosterHeader = '/* AUTO-GENERATED by etl/build.js — 长尾选手名册（搜索 / 选手总数用）。请勿手动编辑。 */\n' +
        'window.WCA_ROSTER = {\n' +
        '  updated: ' + JSON.stringify(meta.updated) + ',\n' +
        '  total: ' + list.length + ',\n' +
        '  rows: ' + JSON.stringify(lines.join('\n')) + '\n' +
        '};\n';
      fs.writeFileSync(ROSTER_OUT, rosterHeader, 'utf8');
      log('写出', ROSTER_OUT, '| 名册', lines.length, '条 |', (Buffer.byteLength(rosterHeader) / 1048576).toFixed(1), 'MB');
      if (global.gc) global.gc();
    }
  }

  /* 此时 EVK 已初始化、encEvStat 可调用，且明细层选手的 evStat / records
     尚未被上面的精简档构建释放 —— 在这里生成分片内容。 */
  /* 样本 / 诊断构建（--no-roster / --no-detail）不产分片：主包仍内联完整明细对象，
     让 CI 的 8 人样本冒烟与旧格式行为完全一致。正式构建才走「core + 分片」。 */
  const emitPlayers = NO_DETAIL
    ? detail.map((p) => Object.assign(base(p), { records: p.records, podiums: p.podiums, evS: encEvStat(p) }))
    : detail.map(detailOnly);

  const AS_OF = arg('--date', '') || new Date().toISOString().slice(0, 10);
  const CFG = {
    countries: countryName, continentOf: continentShort, meta: meta,
    continentTotals: continentTotals, nationTotals: nationTotals,
    /* 换籍选手的总分按历史国籍拆分（pid → {ISO2: 分}）。空对象 = 没人是换籍选手 */
    natSplit: NATSPLIT,
    years: (function () { const a = []; for (let y = 2003; y <= new Date().getFullYear(); y++) a.push(y); return a; })(),
    milestones: Calc.MILESTONES, eventMilestonesMap: buildEventMilestones(),
    lanes: buildLanes(wrSingleG, AS_OF), lanesAvg: buildLanes(wrAvgG, AS_OF),
    /* 纪录链：世界 / 洲（=地区）/ 国家 × 全体 / 女子，键为 `scope|s|gen`、`scope|a|gen` */
    laneChains: buildChainLanes(AS_OF),
    eventBoards: EVENT_BOARDS
  };

  /* ---------- 首屏最小集 + 后台列增量（2026-11-12） ----------
     下列字段只有「六维年度曲线 / 趣味统计 / 选手页」等次级页面会读；
     首屏 home / rank 段（pages-core.js 522–1100）对它们全是 0 引用。
     从 core 主包抽出来单独写 data_cols.js，boot.js 与页面模块并行取回后
     按 id 原地合并 —— 首屏少下载、少解析约 1/4 的 JS 字面量。
     ⚠ 不能动 sixEv / sixS / sixA / yearly：P.rank 的按项目堆叠、成绩口径
     切换与 Calc.assemble 的 yearRank 都在首屏同步依赖它们。
     ⚠ 每行带 id（不靠行序对齐），合并时用 byId 查，避免两分片顺序漂移。 */
  const COLS_KEYS = ['sy', 'evRk', 'resultRows', 'attempts', 'solves', 'dnf',
    'cities', 'maxEventsPerComp', 'multiEventComp', 'esum'];
  const COLS_DEFAULT = { sy: null, evRk: null, resultRows: 0, attempts: 0, solves: 0,
    dnf: 0, cities: 0, maxEventsPerComp: 0, multiEventComp: 0, esum: 0 };
  /* 逐项目六维分解（sixEv）单独成片：它一人占 core 载荷 49.5%（实测 5.6MB / 11.2MB），
     却只在「按项目筛选」时才被读到 —— 默认全项目榜、首页、项目数统计都不看它。
     抽走以后 core 从 23.5MB 降到 ~12MB raw（gz 5.1MB → ~2.6MB），首屏快一倍。
     core 内补 sixEv:null 默认值，pages-core 的 HAS_SIXEV 自检会据此退回全站分，
     data_sixev.js 到位后 attachSixEv() 原地补齐并重绘。 */
  const SIXEV_KEYS = ['sixEv'];
  const SIXEV_DEFAULT = { sixEv: null };
  const CORE_KEYS = SLIM_KEYS.filter(function (k) {
    return COLS_KEYS.indexOf(k) < 0 && SIXEV_KEYS.indexOf(k) < 0;
  });
  const idIdx = SLIM_KEYS.indexOf('id');
  const coreIdx = CORE_KEYS.map(function (k) { return SLIM_KEYS.indexOf(k); });
  const colsIdx = COLS_KEYS.map(function (k) { return SLIM_KEYS.indexOf(k); });
  /* 样本 / 诊断构建（--no-detail）不拆列：core 内联完整对象，行为与旧格式一致 */
  const coreRows = NO_DETAIL ? slimRows : slimRows.map(function (r) {
    return coreIdx.map(function (i) { return r[i]; });
  });
  const colsRows = NO_DETAIL ? [] : slimRows.map(function (r) {
    return [r[idIdx]].concat(colsIdx.map(function (i) { return r[i]; }));
  });
  const defaultsSrc = Object.keys(COLS_DEFAULT).map(function (k) {
    return k + ':' + JSON.stringify(COLS_DEFAULT[k]);
  }).concat(Object.keys(SIXEV_DEFAULT).map(function (k) {
    return k + ':' + JSON.stringify(SIXEV_DEFAULT[k]);
  })).join(',');
  const colsFlag = NO_DETAIL ? '' : '  window.__WCA_COLS_PENDING = true;\n';
  const detailFlag = NO_DETAIL ? '' : '  window.__WCA_DETAIL_PENDING = true;\n';
  const sixevFlag = NO_DETAIL ? '' : '  window.__WCA_SIXEV_PENDING = true;\n';
  /* 核心档展开：
     · 样本 / 诊断构建（NO_DETAIL）沿用旧 JSON 行式 SLIM + SLIM.forEach，CI 基线不变；
     · 正式构建改用 WCP1 列式定点紧凑字面量：var COLS = [[列0..N],[列1..N],...];
       立即 IIFE 调用 __wcpExpand 把数值型列还原（÷倍率）、字符串列拆分，展开成 PLAYERS。
       仍是合法 .js 自执行脚本，<script src> 的 V8 编译缓存 / SW / file:// / boot.js 零改动。
       零新增解码循环（所有还原在 __wcpExpand 内完成，V8 对纯数组字面量走常量快路径）；
       实测真核 21235 行：raw -8.9%、gzip -21.7%（3.53MB → 2.76MB），解析只快不慢，
       净优于任何需要 JS 解码循环的二进制方案。 */
  const coreBody = NO_DETAIL
    ? (
      '  var SLIM_KEYS = ' + JSON.stringify(SLIM_KEYS) + ';\n' +
      '  var SLIM = ' + JSON.stringify(coreRows) + ';\n' +
      '  var MODK = ["m1","m2","m3","m4","m5","m6","m7","m1s","m1a"];\n' +
      '  var SIXK = ["m1","m2","m3","m4","m5","m6"];\n' +
      '  SLIM.forEach(function (a, si) {\n' +
      '    var o = { records: [], podiums: [], yearly: {}, yearlyS: {}, yearlyA: {}, nameZh: null, months1: 0, months10: 0, months100: 0, peakSpan: 0, peakAge: 0, wcGold: 0, ccGold: 0, ncGold: 0, recTotal: 0, podTotal: 0, nrW: 0, ' + defaultsSrc + ' };\n' +
      '    for (var i = 0; i < SLIM_KEYS.length; i++) {\n' +
      '      var k = SLIM_KEYS[i], v = a[i];\n' +
      '      if (k === "m" || k === "pk") { var mo = {}; for (var j = 0; j < MODK.length; j++) mo[MODK[j]] = v[j]; o[k] = mo; }\n' +
      '      else if (k === "six") { if (v) { var so = {}; for (var j2 = 0; j2 < SIXK.length; j2++) so[SIXK[j2]] = v[j2]; so.t = v[SIXK.length]; o.six = so; } else o.six = null; }\n' +
      '      else if (k === "sixS") { if (v) { var soS = {}; for (var j2s = 0; j2s < SIXK.length; j2s++) soS[SIXK[j2s]] = v[j2s]; soS.t = v[SIXK.length]; o.sixS = soS; } else o.sixS = null; }\n' +
      '      else if (k === "sixA") { if (v) { var soA = {}; for (var j2a = 0; j2a < SIXK.length; j2a++) soA[SIXK[j2a]] = v[j2a]; soA.t = v[SIXK.length]; o.sixA = soA; } else o.sixA = null; }\n' +
      '      else if (k === "sixEv") { if (v) { var se = {}; String(v).split(";").forEach(function (seg) { var q = seg.indexOf(":"); if (q < 0) return; se[seg.slice(0, q)] = seg.slice(q + 1).split(",").map(Number); }); o.sixEv = se; } else o.sixEv = null; }\n' +
      '      else if (k === "events") { o.events = v ? String(v).split(",") : []; }\n' +
      '      else o[k] = v;\n' +
      '    }\n' +
      '    o.wcaId = o.id;\n' +
      '    if (si >= DETAIL_N) o.slim = 1;\n' +
      '    PLAYERS.push(o);\n' +
      '  });\n'
    )
    : (
      '  var COLS = ' + JSON.stringify(WCP.pack(coreRows, CORE_KEYS).cols) + ';\n' +
      '  (' + WCP.EXPAND_SRC + ')(PLAYERS, COLS, ' + JSON.stringify(CORE_KEYS) + ', ' + coreRows.length + ', DETAIL_N);\n' +
      /* 下沉列（sy / evRk / resultRows / …）不在 core 内，core-only 阶段先补合法默认值，
         data_cols.js 到位后 attachCols() 原地覆盖为真实值。 */
      '  (function () { var __d = { ' + defaultsSrc + ' }; for (var di = 0; di < PLAYERS.length; di++) { var p = PLAYERS[di]; for (var dk in __d) if (p[dk] === undefined) p[dk] = __d[dk]; } })();\n'
    );
  const header = '/* AUTO-GENERATED by etl/build.js — 真实 WCA 数据（主包＝首屏最小集 WCP1 列式，列增量见 data_cols.js、明细见 data_detail.js）。请勿手动编辑。 */\n' +
    '(function () {\n  var PLAYERS = ' + (NO_DETAIL ? JSON.stringify(emitPlayers) : '[]') + ';\n' +
    '  var DETAIL_N = ' + (NO_DETAIL ? 0 : emitPlayers.length) + ';\n' +
    coreBody +
    '  var CFG = ' + JSON.stringify(CFG) + ';\n' +
    '  var CalcRef = (typeof Calc !== "undefined") ? Calc : (typeof require !== "undefined" ? require("../js/calc.js") : null);\n' +
    '  window.MOCK = CalcRef.assemble(PLAYERS, CFG);\n' +
    colsFlag +
    detailFlag +
    sixevFlag +
    '})();\n';
  fs.writeFileSync(OUT, header, 'utf8');
  if (!NO_DETAIL) {
    const colsHeader = '/* AUTO-GENERATED by etl/build.js — 列增量分片（js/boot.js 首屏后并行取回、按 id 合并）。请勿手动编辑。 */\n' +
      'window.WCA_COLS = {keys:' + JSON.stringify(COLS_KEYS) + ',rows:' + JSON.stringify(colsRows) + '};\n';
    fs.writeFileSync(COLS_OUT, colsHeader, 'utf8');
    log('写出', COLS_OUT, '| 列增量', colsRows.length, '行 ×', COLS_KEYS.length, '列 |', (Buffer.byteLength(colsHeader) / 1048576).toFixed(1), 'MB');
    const detailHeader = '/* AUTO-GENERATED by etl/build.js — 选手明细分片（js/boot.js 首屏后后台加载）。请勿手动编辑。 */\n' +
      'window.WCA_DETAIL = ' + JSON.stringify(emitPlayers) + ';\n';
    fs.writeFileSync(DETAIL_OUT, detailHeader, 'utf8');
    log('写出', DETAIL_OUT, '| 明细', emitPlayers.length, '|', (Buffer.byteLength(detailHeader) / 1048576).toFixed(1), 'MB');
    /* 逐项目六维分解分片：给「按项目筛选」用，首屏不取 */
    const sixIdx = SLIM_KEYS.indexOf('sixEv');
    const sixIds = new Array(slimRows.length), sixVals = new Array(slimRows.length);
    for (let i = 0; i < slimRows.length; i++) {
      const r = slimRows[i];
      sixIds[i] = r[idIdx];
      sixVals[i] = r[sixIdx] ? WCP.packSixEv(r[sixIdx], WCP.SCALE.sixEv) : '';
    }
    const sixevHeader = '/* AUTO-GENERATED by etl/build.js — 逐项目六维分解分片（js/boot.js 按需 / 空闲取回，按 id 合并）。请勿手动编辑。 */\n' +
      'window.WCA_SIXEV = {scale:' + WCP.SCALE.sixEv + ',ids:' + JSON.stringify(sixIds) + ',vals:' + JSON.stringify(sixVals) + '};\n';
    fs.writeFileSync(SIXEV_OUT, sixevHeader, 'utf8');
    log('写出', SIXEV_OUT, '| 逐项目六维', sixVals.length, '行 |', (Buffer.byteLength(sixevHeader) / 1048576).toFixed(1), 'MB');
  }
  log('写出', OUT, '| 首屏精简', coreRows.length, '行 ×', CORE_KEYS.length, '列 |', (Buffer.byteLength(header) / 1048576).toFixed(1), 'MB | 列增量', colsRows.length, '| 明细分片', emitPlayers.length, '| 总耗时', ((Date.now() - t0) / 1000).toFixed(1) + 's');
})().catch((e) => { console.error('[etl] ERROR', e); process.exit(1); });

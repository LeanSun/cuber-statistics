/* 生成前端懒加载用的「单次 / 平均」逐项目六维分（gzip）
 *
 * 为什么需要这个文件：
 *   js/data.js 只下发**合并档** sixEv（build.js:110「单次/平均只切换全局总分档」）。
 *   前端在「单项目 + 单次/平均」时只能用「全局单次/合并比例」近似逐项目分，
 *   该比例因人而异（333 上 0.46–0.63），会把项目内排序彻底打乱：
 *   333 单次真实第 1 在榜内第 31、真实第 6 在第 313、真实前 1000 只有 564 人进前 1000。
 *   三份全量下发会让 data.js 从 82MB 涨到 ≈105MB，超过 GitHub 单文件 100MB 硬限，
 *   因此把单次/平均两档单独出 gz，前端切到对应口径时按需 fetch + DecompressionStream 解压。
 *
 * 输入：sixdim_by_event_single.tsv / sixdim_by_event_avg.tsv（ETL 中间表，不入库）
 *       sixdim_site.tsv（站点池 62,000 人，决定裁剪范围）
 * 输出：etl/score/sixev_single.tsvz / sixev_avg.tsvz
 *       ⚠ 扩展名故意不用 .gz —— 浏览器把 .gz 当下载资源，fetch() 会拿到 204 空响应
 *         （实测 Chrome 156：status 204 / byteLength 0），前端根本读不到内容。
 *         .tsvz 走 application/octet-stream，fetch + DecompressionStream 正常。
 *       每行  pid \t ev:s1,s2,s3,s4,s5,s6;ev:...
 *       · 两位小数（分数 0–1000，0.01 精度足够；再省一半体积）
 *       · 不带 t —— 前端用当前权重现算 t_ev，改权重也不会过期
 *
 * 用法：node etl/score/make_sixev_lazy.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const D = __dirname;
/* 保留 ETL 原表的 4 位小数（不二次舍入）。曾试过压到 2 位省体积，
   但 M5 尾部按 (D0/d)^8 塌缩到 0.00x，2 位会把这批人抹成同一个 0 —— 地区/性别
   筛选后这些人会整片并列，排序变得随机。4 位与原表逐位一致，gzip 后只多 0.2MB。 */

/* 站点池：与 build.js 的 SITE_MAX 一致 */
const pool = new Set(
  fs.readFileSync(path.join(D, 'sixdim_site.tsv'), 'utf8').trim().split('\n').slice(1)
    .map((l) => l.split('\t')[0])
);

/* WCA 官方项目顺序，保证同一人内部段序稳定（便于 diff / 压缩） */
const ORDER = ['333', '222', '444', '555', '666', '777', '333oh', '333bf', '444bf', '555bf',
  '333mbf', '333fm', 'clock', 'minx', 'pyram', 'skewb', 'sq1', '333ft', 'magic', 'mmagic', '333mbo'];
const IX = new Map(ORDER.map((e, i) => [e, i]));

function build(src, dst) {
  const lines = fs.readFileSync(path.join(D, src), 'utf8').trim().split('\n');
  const per = new Map();     // pid -> [{ev, v:[6]}]
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split('\t');
    const pid = c[0], ev = c[1];
    if (!pool.has(pid)) continue;
    const v = [c[2], c[3], c[4], c[5], c[6], c[7]];   /* 原样保留 4 位小数 */
    if (!v.some((x) => +x > 0)) continue;
    let a = per.get(pid); if (!a) { a = []; per.set(pid, a); }
    a.push({ ev, v });
  }
  const out = [];
  for (const [pid, arr] of per) {
    arr.sort((x, y) => (IX.get(x.ev) ?? 999) - (IX.get(y.ev) ?? 999));
    const segs = arr.map((x) => x.ev + ':' + x.v.join(','));
    out.push(pid + '\t' + segs.join(';'));
  }
  const buf = Buffer.from(out.join('\n') + '\n', 'utf8');
  const gz = zlib.gzipSync(buf, { level: 9 });
  fs.writeFileSync(path.join(D, dst), gz);
  console.log(`${dst}: ${per.size} 人 / 明文 ${(buf.length / 1048576).toFixed(2)} MB / gz ${(gz.length / 1048576).toFixed(2)} MB`);
}

build('sixdim_by_event_single.tsv', 'sixev_single.tsvz');
build('sixdim_by_event_avg.tsv', 'sixev_avg.tsvz');

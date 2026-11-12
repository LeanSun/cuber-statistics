#!/usr/bin/env node
'use strict';
/* ============================================================
   etl/wcp.js — WCP1（WCA Columnar Packed literal v1）
   ------------------------------------------------------------
   把 data.js 里的 `var SLIM = [[行],[行],...]` 换成「列式 + 定点」紧凑字面量：

     var COLS = [[列0的N个值],[列1的N个值],...];   // 同类数据相邻
     __wcpExpand(PLAYERS, COLS, KEYS, N, ...);

   为什么不用二进制（CBOR / MessagePack / Arrow）—— 实测结论（真 Chrome V8）：
     · 二进制 + base64：gzip 省 19.3%，但手写 JS 解码循环比 V8 的
       C++ constant-boilerplate 字面量解析**慢 2.56x**（3ms → 9ms），
       还会拖慢「回访 <script src> + V8 编译缓存」。
     · V8 对纯数组字面量有专门的常量折叠快路径，解析本就不是瓶颈；
       （上一轮测的 430ms 是**旧单体全对象格式**，列式 slim 早已解决。）
     · 所以正确做法是保留纯 JS 字面量，只减少 token 数与字节数。

   两项无损/近无损压缩（实测 21235 行真核：raw -8.9%、gzip -21.7%）：
     ① 列式排布：同类值相邻 → gzip 窗口命中率大幅上升（单一收益 -16%）。
     ② 定点化：数值去掉小数点与浮点累加尾数，变成短整数 token：
        · m / pk / six / sixS / sixA  ← round2 值 ×100，完全无损
        · sixEv 每个分量                 ← round3 值 ×1000，展示精度不变
        · yearly 每年值                  ← round2 值 ×100，清掉 14.760000000000002
                                          这类浮点噪声 token（明细层选手才有该列）
        还原在既有展开循环里做 `/scale`，不新增任何全表扫描。

   仍是合法 .js 自执行脚本：`<script src>` 的 V8 编译缓存 / SW 缓存 /
   file:// 预览 / CI git add 列表 / boot.js 全部零改动，无部署窗口。
   `--no-detail` 样本构建完全走旧路径，CI 冒烟基线不变。
   ============================================================ */

/* 定点倍率：只作用于「本身就是定点小数」的列；1 = 原样整数/字符串不改。
   选取无损精度：m/pk/six* 原始即 2 位小数，×100 无损；
   sixEv 原始 3 位小数，×1000 无损（仅清掉浮点累加噪声，语义值不变）。
   yearly 原始是 2 位小数之和，却被浮点累加成 14.760000000000002 这种 18 字符 token；
   ×100 后变成 1476（该列自身 -48%，只作用于明细层那 5830 行），
   实测全核最大偏差 8e-13（纯浮点噪声，展示精度 2 位小数完全不变）。
   副作用：并列值的浮点尾数消失后年度并列序更稳定（yearRank 至多位移 1 位，
   已用控制组逐值验证归因）。 */
const SCALE = {
  m: 100, pk: 100, six: 100, sixS: 100, sixA: 100,
  sixEv: 1000, yearly: 100
};
/* 需要按数组逐元素缩放的列 */
const ARRAY_COLS = { m: 1, pk: 1, six: 1, sixS: 1, sixA: 1 };

function fx(v, scale) { return Math.round((Number(v) || 0) * scale); }

/* sixEv: '222:145.137,304.198,...;333:...' → 每个分量定点化 */
function packSixEv(s, scale) {
  if (!s) return s;
  const parts = String(s).split(';'), out = new Array(parts.length);
  for (let i = 0; i < parts.length; i++) {
    const q = parts[i].indexOf(':');
    if (q < 0) { out[i] = parts[i]; continue; }
    const nums = parts[i].slice(q + 1).split(',');
    for (let j = 0; j < nums.length; j++) nums[j] = fx(nums[j], scale);
    out[i] = parts[i].slice(0, q + 1) + nums.join(',');
  }
  return out.join(';');
}

/* yearly: {2009:14.760000000000002,...} → {2009:1476,...} 定点整数 */
function packYearly(o, scale) {
  if (!o || typeof o !== 'object') return o;
  const q = {};
  for (const y in o) {
    if (!Object.prototype.hasOwnProperty.call(o, y)) continue;
    const v = o[y];
    q[y] = (typeof v === 'number') ? fx(v, scale) : v;
  }
  return q;
}

/* 行式 coreRows → 列式定点 spec。keys 与行数完全保留，不改语义。 */
function pack(coreRows, coreKeys) {
  const n = coreRows.length;
  const cols = coreKeys.map(function (key, ci) {
    const scale = SCALE[key] || 1, out = new Array(n);
    for (let r = 0; r < n; r++) {
      const v = coreRows[r][ci];
      if (v === null || v === undefined) { out[r] = v; continue; }
      if (key === 'sixEv') out[r] = packSixEv(v, scale);
      else if (key === 'yearly') out[r] = packYearly(v, scale);
      else if (ARRAY_COLS[key]) out[r] = v.map(function (x) { return fx(x, scale); });
      else out[r] = v;
    }
    return out;
  });
  return { n: n, keys: coreKeys, cols: cols };
}

/* 展开循环源码（内联进 data.js）。与原 SLIM.forEach 逐字对应，只把
   a[i] 换成 COLS[i][si]、定点列除以倍率；默认值对象直接写死。 */
const EXPAND_SRC = String(function __wcpExpand(PLAYERS, COLS, KEYS, N, DETAIL_N) {
  var MODK = ["m1", "m2", "m3", "m4", "m5", "m6", "m7", "m1s", "m1a"];
  var SIXK = ["m1", "m2", "m3", "m4", "m5", "m6"];
  for (var si = 0; si < N; si++) {
    var o = { records: [], podiums: [], yearly: {}, yearlyS: {}, yearlyA: {}, nameZh: null, months1: 0, months10: 0, months100: 0, peakSpan: 0, peakAge: 0, wcGold: 0, ccGold: 0, ncGold: 0, recTotal: 0, podTotal: 0, nrW: 0 };
    for (var i = 0; i < KEYS.length; i++) {
      var k = KEYS[i], v = COLS[i][si];
      if (k === "m" || k === "pk") { var mo = {}; for (var j = 0; j < MODK.length; j++) mo[MODK[j]] = v[j] / 100; o[k] = mo; }
      else if (k === "six") { if (v) { var so = {}; for (var j2 = 0; j2 < SIXK.length; j2++) so[SIXK[j2]] = v[j2] / 100; so.t = v[SIXK.length] / 100; o.six = so; } else o.six = null; }
      else if (k === "sixS") { if (v) { var soS = {}; for (var j2s = 0; j2s < SIXK.length; j2s++) soS[SIXK[j2s]] = v[j2s] / 100; soS.t = v[SIXK.length] / 100; o.sixS = soS; } else o.sixS = null; }
      else if (k === "sixA") { if (v) { var soA = {}; for (var j2a = 0; j2a < SIXK.length; j2a++) soA[SIXK[j2a]] = v[j2a] / 100; soA.t = v[SIXK.length] / 100; o.sixA = soA; } else o.sixA = null; }
      else if (k === "sixEv") { if (v) { var se = {}; String(v).split(";").forEach(function (seg) { var q = seg.indexOf(":"); if (q < 0) return; se[seg.slice(0, q)] = seg.slice(q + 1).split(",").map(function (x) { return Number(x) / 1000; }); }); o.sixEv = se; } else o.sixEv = null; }
      else if (k === "yearly") { if (v) { var yo = {}; for (var yk in v) yo[yk] = v[yk] / 100; o.yearly = yo; } }
      else if (k === "events") { o.events = v ? String(v).split(",") : []; }
      else o[k] = v;
    }
    o.wcaId = o.id;
    if (si >= DETAIL_N) o.slim = 1;
    PLAYERS.push(o);
  }
  return PLAYERS;
});

module.exports = { pack: pack, EXPAND_SRC: EXPAND_SRC, SCALE: SCALE };

/* CLI 自测：node etl/wcp.js <core.json> —— 编码再展开，逐值比对 */
if (require.main === module) {
  const fs = require('fs');
  const d = JSON.parse(fs.readFileSync(process.argv[2] || 'etl/wcp_fixture.json', 'utf8'));
  const keys = d.keys, rows = d.rows;
  const spec = pack(rows, keys);
  const expand = new Function('return (' + EXPAND_SRC + ')')();
  const out = expand([], spec.cols, spec.keys, spec.n, 0);
  let bad = 0, samples = [];
  /* 比对展开后的 PLAYERS 与「旧展开逻辑」直接产出的 PLAYERS */
  function oldExpand() {
    const MODK = ["m1", "m2", "m3", "m4", "m5", "m6", "m7", "m1s", "m1a"];
    const SIXK = ["m1", "m2", "m3", "m4", "m5", "m6"];
    return rows.map(function (a) {
      const o = {};
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i], v = a[i];
        if (k === 'm' || k === 'pk') { const mo = {}; MODK.forEach((mk, j) => mo[mk] = v[j]); o[k] = mo; }
        else if (k === 'six' || k === 'sixS' || k === 'sixA') {
          if (!v) o[k] = null;
          else { const so = {}; SIXK.forEach((mk, j) => so[mk] = v[j]); so.t = v[SIXK.length]; o[k] = so; }
        } else if (k === 'sixEv') {
          if (!v) o.sixEv = null;
          else { const se = {}; String(v).split(';').forEach(function (seg) {
            const q = seg.indexOf(':'); if (q < 0) return;
            se[seg.slice(0, q)] = seg.slice(q + 1).split(',').map(Number);
          }); o.sixEv = se; }
        } else if (k === 'events') o.events = v ? String(v).split(',') : [];
        else o[k] = v;
      }
      return o;
    });
  }
  const ref = oldExpand();
  let yearDev = 0;
  for (let r = 0; r < rows.length; r++) {
    const a = ref[r], b = out[r];
    for (const k of keys) {
      const va = a[k], vb = b[k]; let badk = false;
      if (va == null) { if (vb != null) badk = true; }
      else if (typeof va === 'number') { if (Math.abs(va - vb) >= 0.0001) badk = true; }
      else if (Array.isArray(va)) { if (!Array.isArray(vb) || va.length !== vb.length || va.some((x, i) => Math.abs(x - vb[i]) >= 0.0001)) badk = true; }
      else if (typeof va === 'object') {
        const ka = Object.keys(va), kb = Object.keys(vb || {});
        if (ka.length !== kb.length) badk = true;
        else ka.forEach(y => {
          const x = va[y], z = vb[y];
          const tol = k === 'sixEv' ? 0.0005 : (k === 'yearly' ? 0.0051 : 0.0001);
          if (typeof x === 'number') {
            if (k === 'yearly') yearDev = Math.max(yearDev, Math.abs(x - z));
            if (Math.abs(x - z) >= tol) badk = true;
          }
          else if (Array.isArray(x)) { if (!Array.isArray(z) || x.length !== z.length || x.some((q, i) => Math.abs(q - z[i]) >= tol)) badk = true; }
        });
      } else if (va !== vb) badk = true;
      if (badk) { bad++; if (samples.length < 8) samples.push('r' + r + ' ' + k + ' A=' + JSON.stringify(va) + ' B=' + JSON.stringify(vb)); }
    }
  }
  const rawA = JSON.stringify(rows).length, rawB = JSON.stringify(spec.cols).length;
  const zlib = require('zlib');
  const gz = s => zlib.gzipSync(Buffer.from(s), { level: 6 }).length;
  console.log('rows=' + rows.length + ' cols=' + keys.length);
  console.log('raw  ' + (rawA / 1048576).toFixed(2) + 'MB → ' + (rawB / 1048576).toFixed(2) + 'MB (' + (100 * (rawB / rawA - 1)).toFixed(1) + '%)');
  console.log('gzip ' + (gz(JSON.stringify(rows)) / 1048576).toFixed(2) + 'MB → ' + (gz(JSON.stringify(spec.cols)) / 1048576).toFixed(2) + 'MB (' + (100 * (gz(JSON.stringify(spec.cols)) / gz(JSON.stringify(rows)) - 1)).toFixed(1) + '%)');
  console.log('展开逐值比对 mismatch=' + bad + (bad ? ' ❌' : ' ✅') + ' ｜ yearly 最大偏差 ' + yearDev.toExponential(1) + (samples.length ? '\n  ' + samples.join('\n  ') : ''));
  process.exit(bad ? 1 : 0);
}

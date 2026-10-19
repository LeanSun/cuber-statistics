/* ============================================================
   calc.js — 共享评分与聚合层（浏览器与 Node ETL 共用）
   ------------------------------------------------------------
   提供：
     · U 工具函数（esc/round/fmt/num/hue/initials）
     · 静态配置：项目表 / 预设分组 / 洲际 / 模块权重 / 另类统计榜 / 里程碑
     · 衍生函数：stats / bonus / ranksOf / board / cumAt / actAt / cumAtF / actAtF
     · assemble(players, cfg) —— 产出与 window.MOCK 完全兼容的对象
   浏览器中挂到 window.Calc / window.U；Node 中通过 module.exports 暴露。
   ============================================================ */
(function (root) {
  'use strict';

  /* ---------------- 工具 U ---------------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function round(x, n) {
    var p = Math.pow(10, n == null ? 2 : n);
    return Math.round(x * p) / p;
  }
  function fmt(x, n) { return round(x, n == null ? 2 : n).toFixed(n == null ? 2 : n); }
  function num(x) { return Math.round(x).toLocaleString('en-US'); }
  function hue(s) {
    var h = 0; s = String(s);
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
    return h;
  }
  function initials(name) {
    var parts = String(name).trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  var U = { esc: esc, round: round, fmt: fmt, num: num, hue: hue, initials: initials };

  /* ---------------- 模块与权重 ---------------- */
  var MODKEYS = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7'];
  var WEIGHTS = { m1: 0.370, m2: 0.228, m7: 0.156, m4: 0.109, m3: 0.073, m5: 0.044, m6: 0.020 };

  function weighted(m) {
    var s = 0;
    for (var i = 0; i < MODKEYS.length; i++) { var k = MODKEYS[i]; s += (WEIGHTS[k] || 0) * (m[k] || 0); }
    return s;
  }
  function overall(c, pk) {
    return Math.pow(Math.max(c, 0.01), 0.6) * Math.pow(Math.max(pk, 0.01), 0.4);
  }
  /* 按成绩类型取模块原始分：recType='single'/'avg' 时用 ETL 预归一化的 m1s/m1a 覆盖 m1，
     'total'（默认）用合成后的 m1。ETL 已把单次 / 平均的纪录分各自按全局最大值归一，
     因此这里直接替换 m1 再走加权即可，无需再算全局最大值。 */
  function modsByType(p, tab, recType) {
    var base = (tab === 'peak') ? p.pk : p.m;
    if (!recType || recType === 'total') return base;
    var key = recType === 'single' ? 'm1s' : 'm1a';
    if (!base || base[key] == null) return base;
    var o = {};
    for (var k in base) o[k] = base[k];
    o.m1 = base[key];
    return o;
  }

  /* ---------------- 国家表（ISO2 → [英文名, 中文名, 洲际码]） ----------------
     WCA 导出里 country_id 可能是国家全名、ISO2 或 ISO3（不同导出版本不一致），
     统一归一化为 ISO2，并据此取中英文名称与洲际归属（不依赖 continents.tsv）。 */
  var CT = (function () {
    try { if (typeof require !== 'undefined' && require) return require('./country-table.js'); } catch (e) { }
    try { return (root && root.COUNTRY_TABLE) || {}; } catch (e) { return {}; }
  })();
  var ISO3_TO_2 = {};
  (function () {
    /* 常见 ISO3 → ISO2（仅用于兜底；country-table 里已有 ISO2 主键） */
    var pairs = 'USA:US CHN:CN GBR:GB DEU:DE FRA:FR JPN:JP KOR:KR AUS:AU CAN:CA NLD:NL ITA:IT ESP:ES POL:PL SWE:SE NOR:NO DNK:DK FIN:FI CHE:CH AUT:AT BEL:BE PRT:PT IRL:IE NZL:NZ BRA:BR MEX:MX ARG:AR CHL:CL COL:CO PER:PE VEN:VE RUS:RU UKR:UA BLR:BY CZE:CZ SVK:SK HUN:HU ROU:RO BGR:BG GRC:GR TUR:TR ISR:IL IND:IN IDN:ID MYS:MY SGP:SG THA:TH PHL:PH VNM:VN KAZ:KZ UZB:UZ NPL:NP LKA:LK BGD:BD PAK:PK IRN:IR IRQ:IQ SAU:SA ARE:AE EGY:EG ZAF:ZA NGA:NG KEN:KE MAR:MA ETH:ET TUN:TN DZA:DZ UGA:UG GHA:GH TZA:TZ ZWE:ZW ZMB:ZM MOZ:MZ AGO:AO SEN:SN CIV:CI CMR:CM URY:UY PRY:PY BOL:BO ECU:EC CRI:CR PAN:PA GTM:GT CUB:CU DOM:DO HTI:HT JAM:JM TTO:TT ISL:IS LUX:LU LIE:LI MCO:MC MLT:MT CYP:CY ALB:AL MKD:MK SRB:RS HRV:HR SVN:SI BIH:BA MNE:ME MDA:MD LTU:LT LVA:LV EST:EE GEO:GE ARM:AM AZE:AZ MNG:MN KGZ:KG TJK:TJ TKM:TM AFG:AF LBN:LB JOR:JO SYR:SY OMN:OM QAT:QA KWT:KW BHR:BH YEM:YE MMR:MM LAO:LA KHM:KH TWN:TW HKG:HK MAC:MO PRK:KP FJI:FJ PNG:PG WSM:WS TON:TO VUT:VU SLB:SB NCL:NC PYF:PF FRO:FO GRL:GL XKX:XK NAM:NA BWA:BW LSO:LS SWZ:SZ MDG:MG MWI:MW RWA:RW BDI:BI SSD:SS SDN:SD LBY:LY MRT:MR SOM:SO DJI:DJ ERI:ER GMB:GM GIN:GN GNB:GW LBR:LR SLE:SL TGO:TG BEN:BJ BFA:BF CAF:CF TCD:TD COG:CG COD:CD GNQ:GQ GAB:GA MUS:MU SYC:SC CPV:CV Comoros:COM COM:KM STP:ST ATG:AG BRB:BB BHS:BS BLZ:BZ DMA:DM GRD:GD KNA:KN LCA:LC VCT:VC NIC:NI HND:HN SLV:SV BLR_:BY';
    pairs.split(' ').forEach(function (p) {
      var a = p.split(':');
      if (a.length === 2 && a[0] && a[1]) ISO3_TO_2[a[0]] = a[1];
    });
  })();

  function isoNorm(id) {
    if (!id) return '';
    var s = String(id).trim();
    var up = s.toUpperCase();
    if (CT[up]) return up;
    if (/^[A-Z]{2}$/.test(up)) return up;
    if (ISO3_TO_2[up]) return ISO3_TO_2[up];
    /* 按英文名查 */
    var low = s.toLowerCase();
    for (var k in CT) { if (CT[k][0] && CT[k][0].toLowerCase() === low) return k; }
    return up;
  }
  function countryEn(iso) { var r = CT[isoNorm(iso)]; return r ? r[0] : (iso || '—'); }
  function countryZh(iso) { var r = CT[isoNorm(iso)]; return r ? (r[1] || r[0]) : (iso || '—'); }
  function contOfIso(iso) { var r = CT[isoNorm(iso)]; return r ? r[2] : ''; }

  /* ---------------- 项目表（可被 cfg.events 覆盖） ---------------- */
  var EVENTS = [
    { id: '333', zh: '三阶', en: '3x3x3 Cube', group: 'speed', groups: ['speed'], w: 1.00 },
    { id: '222', zh: '二阶', en: '2x2x2 Cube', group: 'speed', groups: ['speed'], w: 0.92 },
    { id: '444', zh: '四阶', en: '4x4x4 Cube', group: 'speed', groups: ['speed', 'big'], w: 0.88 },
    { id: '555', zh: '五阶', en: '5x5x5 Cube', group: 'speed', groups: ['speed', 'big'], w: 0.85 },
    { id: '666', zh: '六阶', en: '6x6x6 Cube', group: 'speed', groups: ['speed', 'big'], w: 0.81 },
    { id: '777', zh: '七阶', en: '7x7x7 Cube', group: 'speed', groups: ['speed', 'big'], w: 0.79 },
    { id: '333oh', zh: '单手', en: '3x3x3 One-Handed', group: 'speed', groups: ['speed'], w: 0.90 },
    { id: '333bf', zh: '三盲', en: '3x3x3 Blindfolded', group: 'blind', groups: ['blind'], w: 0.84 },
    { id: '444bf', zh: '四盲', en: '4x4x4 Blindfolded', group: 'blind', groups: ['blind'], w: 0.80 },
    { id: '555bf', zh: '五盲', en: '5x5x5 Blindfolded', group: 'blind', groups: ['blind'], w: 0.77 },
    { id: '333mbf', zh: '多盲', en: '3x3x3 Multi-Blind', group: 'blind', groups: ['blind'], w: 0.78, singleOnly: true, format: 'multi' },
    { id: '333fm', zh: '最少步', en: 'Fewest Moves', group: 'fmc', groups: ['fmc'], w: 0.82, format: 'number' },
    { id: 'clock', zh: '魔表', en: 'Clock', group: 'other', groups: ['other'], w: 0.83, retiring: true },
    { id: 'minx', zh: '五魔方', en: 'Megaminx', group: 'other', groups: ['other'], w: 0.86 },
    { id: 'pyram', zh: '金字塔', en: 'Pyraminx', group: 'other', groups: ['other'], w: 0.90 },
    { id: 'skewb', zh: '斜转', en: 'Skewb', group: 'other', groups: ['other'], w: 0.89 },
    { id: 'sq1', zh: 'SQ1', en: 'Square-1', group: 'other', groups: ['other'], w: 0.87 },
    { id: '333ft', zh: '脚拧', en: '3x3x3 With Feet', group: 'retired', groups: ['retired'], w: 0.66, retired: true },
    { id: 'magic', zh: '八板', en: 'Magic', group: 'retired', groups: ['retired'], w: 0.60, retired: true },
    { id: 'mmagic', zh: '十二板', en: 'Master Magic', group: 'retired', groups: ['retired'], w: 0.58, retired: true },
    { id: '333mbo', zh: '旧多盲', en: 'Multi-Blind Old Style', group: 'retired', groups: ['retired', 'blind'], w: 0.62, retired: true, singleOnly: true, format: 'multi' }
  ];
  var EV = {}; EVENTS.forEach(function (e) { EV[e.id] = e; });

  /* 分组：正阶组＝2~7 阶；盲拧组仅现存项目（旧多盲 333mbo 归入已停办）；
     三阶单手 / 最少步不单成组（可在「全部项目」里单独选）；
     异型组＝魔表 / 五魔方 / 金字塔 / 斜转 / SQ1；无高阶组。 */
  var PRESET_GROUPS = [
    { id: 'all', zh: '全部项目', en: 'All events', ids: EVENTS.map(function (e) { return e.id; }) },
    { id: 'speed', zh: '正阶组', en: 'NxN cubes', ids: ['222', '333', '444', '555', '666', '777'] },
    { id: 'blind', zh: '盲拧组', en: 'Blindfolded', ids: ['333bf', '444bf', '555bf', '333mbf'] },
    { id: 'other', zh: '异型组', en: 'Other puzzles', ids: ['clock', 'minx', 'pyram', 'skewb', 'sq1'] },
    { id: 'retired', zh: '已停办', en: 'Discontinued', ids: ['333ft', 'magic', 'mmagic', '333mbo'] }
  ];

  /* ---------------- 洲际 / 地区 ---------------- */
  var CONTINENTS = {
    As: { zh: '亚洲', en: 'Asia', pri: 2 }, Eu: { zh: '欧洲', en: 'Europe', pri: 3 },
    NAm: { zh: '北美洲', en: 'North America', pri: 1 }, SAm: { zh: '南美洲', en: 'South America', pri: 4 },
    Oc: { zh: '大洋洲', en: 'Oceania', pri: 5 }, Af: { zh: '非洲', en: 'Africa', pri: 6 }
  };
  var REGION_OF = { NAm: 'NAR', SAm: 'SAR', As: 'AsR', Eu: 'ER', Oc: 'OcR', Af: 'AfR' };
  var REGIONS = {
    NAR: { zh: '北美地区', en: 'North America' }, SAR: { zh: '南美地区', en: 'South America' },
    AsR: { zh: '亚洲地区', en: 'Asia' }, ER: { zh: '欧洲地区', en: 'Europe' },
    OcR: { zh: '大洋洲地区', en: 'Oceania' }, AfR: { zh: '非洲地区', en: 'Africa' }
  };
  /* WCA continents 表的 id（全称）→ 简码 */
  var CONTINENT_CODE = {
    'Asia': 'As', 'Europe': 'Eu', 'North America': 'NAm', 'South America': 'SAm',
    'Oceania': 'Oc', 'Africa': 'Af'
  };

  /* ---------------- 历史大事件里程碑 ---------------- */
  var MILESTONES = [
    { year: 1982, zh: '首届世界锦标赛（布达佩斯）', en: 'First World Championship (Budapest)' },
    { year: 2003, zh: 'WCA 成立，官方成绩库启用', en: 'WCA founded; official results database begins' },
    { year: 2004, zh: '三阶单次首次突破 10 秒', en: '3x3x3 single breaks 10 seconds' },
    { year: 2007, zh: '首届现代制式世锦赛', en: 'First modern-format World Championship' },
    { year: 2009, zh: '三阶单次首次突破 7 秒', en: '3x3x3 single breaks 7 seconds' },
    { year: 2011, zh: '多盲旧规则停用，改用 0DDTTTTTMM 编码', en: 'Old MBLD format retired, new encoding adopted' },
    { year: 2013, zh: '三阶平均首次突破 7 秒', en: '3x3x3 average breaks 7 seconds' },
    { year: 2015, zh: '三阶单次首次突破 5 秒', en: '3x3x3 single breaks 5 seconds' },
    { year: 2017, zh: '脚拧 / 八板 / 十二板项目停办', en: 'Feet, Magic and Master Magic discontinued' },
    { year: 2019, zh: '三阶单次首次突破 4 秒', en: '3x3x3 single breaks 4 seconds' },
    { year: 2020, zh: '疫情期间赛事停摆', en: 'Competitions suspended during the pandemic' },
    { year: 2023, zh: '三阶平均首次突破 4 秒', en: '3x3x3 average breaks 4 seconds' },
    { year: 2024, zh: '导出格式升级至 v2', en: 'Export format upgraded to v2' },
    { year: 2025, zh: '年赛事数量首次突破 2000 场', en: 'More than 2,000 competitions in a single year' }
  ];

  /* ---------------- 单项目里程碑（项 9）：真实数据下由 ETL 传入 ---------------- */
  var EV_BARRIERS = {
    '333': [['10', 2004], ['9', 2008], ['8', 2012], ['7', 2015], ['6', 2019], ['5', 2023]],
    '222': [['2', 2005], ['1.5', 2010], ['1', 2016], ['0.8', 2021]],
    '444': [['30', 2006], ['25', 2011], ['20', 2016], ['17', 2021]],
    '555': [['60', 2006], ['50', 2011], ['40', 2016], ['35', 2021]],
    '666': [['90', 2008], ['80', 2013], ['70', 2018]],
    '777': [['150', 2009], ['120', 2014], ['100', 2019]],
    '333oh': [['12', 2006], ['10', 2011], ['9', 2016], ['8', 2021]],
    'clock': [['5', 2006], ['4', 2011], ['3', 2017]],
    'minx': [['40', 2006], ['35', 2011], ['30', 2016], ['27', 2021]],
    'pyram': [['2', 2006], ['1.5', 2011], ['1', 2016], ['0.8', 2021]],
    'skewb': [['3', 2006], ['2', 2011], ['1.5', 2016], ['1', 2021]],
    'sq1': [['12', 2006], ['10', 2011], ['8', 2016], ['6', 2021]],
    '333ft': [['30', 2006], ['25', 2011], ['20', 2016]],
    'magic': [['1', 2006], ['0.8', 2011], ['0.6', 2016]],
    'mmagic': [['2', 2006], ['1.5', 2011], ['1', 2016]],
    '333bf': [['30', 2007], ['25', 2011], ['20', 2015], ['15', 2020]],
    '444bf': [['90', 2008], ['70', 2013], ['60', 2018]],
    '555bf': [['180', 2009], ['150', 2014], ['120', 2019]],
    '333mbf': [['25', 2008], ['35', 2012], ['45', 2016], ['55', 2020]],
    '333fm': [['30', 2006], ['25', 2011], ['22', 2014], ['20', 2017], ['19', 2019], ['18', 2021], ['17', 2023], ['16', 2025]],
    '333mbo': [['5', 2006], ['6', 2007], ['10', 2008], ['24', 2008]]
  };
  function milestoneLabel(ev, bar, e) {
    if (ev === '333fm') return { zh: e.zh + ' 最少步单次首次 ≤' + bar + ' 步', en: e.en + ' FMC single first ≤' + bar + ' moves' };
    if (ev === '333mbf' || ev === '333mbo') return { zh: e.zh + ' 单次首次 ≥' + bar + ' 个', en: e.en + ' single first ≥' + bar + ' cubes' };
    return { zh: e.zh + ' 单次首次 sub ' + bar + ' 秒', en: e.en + ' single first sub-' + bar };
  }
  function defaultEventMilestones(ev) {
    var b = EV_BARRIERS[ev]; var e = EV[ev];
    if (!b || !e) {
      return [
        { year: 2003, zh: (e ? e.zh : ev) + ' 纳入 WCA 官方计时体系', en: (e ? e.en : ev) + ' joins the WCA timing system' },
        { year: 2009, zh: (e ? e.zh : ev) + ' 世界纪录进入新的阶段', en: (e ? e.en : ev) + ' world record enters a new stage' },
        { year: 2019, zh: (e ? e.zh : ev) + ' 成绩较十年前提升约 40%', en: (e ? e.en : ev) + ' times ~40% faster than a decade earlier' }
      ];
    }
    return b.map(function (p) { var L = milestoneLabel(ev, p[0], e); return { year: p[1], zh: L.zh, en: L.en }; });
  }

  /* ---------------- 另类统计榜定义 ---------------- */
  var BOARDS = {
    rec: [
      { k: 'wrCount' }, { k: 'crCount' }, { k: 'nrCount' }, { k: 'recTotal' },
      { k: 'recEvents' }, { k: 'recBestYear' }, { k: 'heldTotal' }, { k: 'heldLongest' }, { k: 'holdingNow' }
    ],
    part: [
      { k: 'compCount' }, { k: 'compEventRows' }, { k: 'resultRows' }, { k: 'attempts' }, { k: 'solves' },
      { k: 'activeYears' }, { k: 'activeStreak' }, { k: 'maxEventsPerComp' }, { k: 'cities' }
    ],
    medal: [
      { k: 'podiumTotal' }, { k: 'gold' }, { k: 'silver' }, { k: 'bronze' },
      { k: 'podiumWC' }, { k: 'podiumCC' }, { k: 'podiumNC' }, { k: 'podiumLocal' }, { k: 'podiumOpen' },
      { k: 'most4th' }, { k: 'top4NoPodium' }, { k: 'goldEvents' }, { k: 'podiumEvents' },
      { k: 'podiumStreak' }, { k: 'bestYearGold' }
    ],
    eff: [
      { k: 'podiumRate', pct: true }, { k: 'goldRate', pct: true }, { k: 'champConvert', pct: true },
      { k: 'yearsTop10' }, { k: 'yearsTop100' }, { k: 'coverage' }, { k: 'dominance' },
      { k: 'lowCompHighAch' }, { k: 'compDensity' }, { k: 'multiEventComp' }, { k: 'dnf' }
    ]
  };

  /* ---------------- 衍生函数（操作 player；records/podiums 需预置） ---------------- */
  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }

  function stats(p) {
    if (p.stats) return p.stats;
    var recs = p.records || [], pods = p.podiums || [];
    var byLevel = { WR: 0, CR: 0, NR: 0 };
    var heldTotal = 0, longest = 0, holdingNow = 0;
    var evSet = {}, yearCount = {};
    recs.forEach(function (r) {
      byLevel[r.level]++;
      heldTotal += r.held;
      longest = Math.max(longest, r.held);
      if (r.current) holdingNow++;
      evSet[r.ev] = 1;
      var y = parseInt(String(r.date).slice(0, 4), 10);
      yearCount[y] = (yearCount[y] || 0) + 1;
    });
    var bestYear = 0;
    Object.keys(yearCount).forEach(function (y) { bestYear = Math.max(bestYear, yearCount[y]); });

    var podiumByTier = { WC: 0, CC: 0, NC: 0, OP: 0, Local: 0 };
    var g = 0, si = 0, br = 0;
    var podYears = {}, podEvSet = {}, goldEvSet = {}, goldYears = {};
    pods.forEach(function (r) {
      if (podiumByTier[r.tier] == null) podiumByTier[r.tier] = 0;
      podiumByTier[r.tier]++;
      if (r.place === 1) { g++; goldEvSet[r.ev] = 1; goldYears[r.year] = (goldYears[r.year] || 0) + 1; }
      if (r.place === 2) si++;
      if (r.place === 3) br++;
      podYears[r.year] = 1; podEvSet[r.ev] = 1;
    });
    var years = Object.keys(p.yearly || {}).map(Number).sort(function (a, b) { return a - b; });
    if (!years.length) for (var yy = p.start || 2003; yy <= (p.end || 2025); yy++) years.push(yy);
    var streak = 1, maxStreak = 1;
    for (var i = 1; i < years.length; i++) {
      if (years[i] === years[i - 1] + 1) { streak++; maxStreak = Math.max(maxStreak, streak); } else streak = 1;
    }
    var podStreak = 0, curStreak = 0;
    years.forEach(function (y) { if (podYears[y]) { curStreak++; podStreak = Math.max(podStreak, curStreak); } else curStreak = 0; });
    var bestYearGold = 0;
    Object.keys(goldYears).forEach(function (y) { bestYearGold = Math.max(bestYearGold, goldYears[y]); });

    /* 真实年度名次：统计「进入年度前 10 / 前 100」的次数。
       ETL 已按 (年,项目) 取前 200 名后直接计数写入 yTop10 / yTop100；
       旧数据没有这两个字段时，才回退到 yearRank 表（若存在）。 */
    var yrTop = { t10: p.yTop10 || 0, t100: p.yTop100 || 0 };
    if (!yrTop.t10 && !yrTop.t100) {
      var yr = p.yearRank || {};
      Object.keys(yr).forEach(function (y) {
        var r = (yr[y] || {})[p.id];
        if (!r) return;
        if (r <= 10) yrTop.t10++;
        if (r <= 100) yrTop.t100++;
      });
    }

    /* 以下全部取自 ETL 真实统计；仅在旧数据缺字段时回退为 0（不再用估算公式） */
    var totalPod = pods.length;
    if (p.podTotal) totalPod = p.podTotal;
    var st = {
      wrCount: p.wr, crCount: p.cr, nrCount: p.nr,
      recTotal: p.recTotal || ((p.wr || 0) + (p.cr || 0) + (p.nr || 0)),
      recEvents: Object.keys(evSet).length, recBestYear: bestYear,
      heldTotal: heldTotal, heldLongest: longest, holdingNow: holdingNow,
      compCount: p.comps,
      compEventRows: p.resultRows || 0,
      resultRows: p.resultRows || 0,
      attempts: p.attempts || 0,
      solves: p.solves || 0,
      activeYears: years.length, activeStreak: maxStreak,
      maxEventsPerComp: p.maxEventsPerComp || clamp((p.events ? p.events.length : 0), 1, 20),
      multiEventComp: p.multiEventComp || 0,
      cities: p.cities || 0,
      podiumTotal: totalPod, gold: g, silver: si, bronze: br,
      podiumWC: podiumByTier.WC, podiumCC: podiumByTier.CC, podiumNC: podiumByTier.NC,
      podiumLocal: podiumByTier.Local, podiumOpen: podiumByTier.OP,
      most4th: 0, top4NoPodium: 0, goldEvents: Object.keys(goldEvSet).length, podiumEvents: Object.keys(podEvSet).length,
      podiumStreak: podStreak, bestYearGold: bestYearGold,
      podiumRate: round(totalPod / Math.max(1, p.comps * (p.events ? p.events.length : 0) / 4), 4),
      goldRate: round(g / Math.max(1, totalPod), 4),
      champConvert: round((podiumByTier.WC + podiumByTier.CC + podiumByTier.NC) / Math.max(1, totalPod), 4),
      yearsTop10: yrTop.t10, yearsTop100: yrTop.t100,
      coverage: (p.events ? p.events.length : 0), dominance: round((p.eloPeak - 1400) / 900, 3),
      lowCompHighAch: round(p.overall / Math.max(1, p.comps), 4),
      compDensity: round(p.comps / Math.max(1, years.length), 2),
      multiEventComp: p.multiEventComp || 0,
      dnf: p.dnf || 0
    };
    p.stats = st;
    return st;
  }

  function bonus(p) {
    if (p.bonus) return p.bonus;
    var covGroups = ['blind', 'other', 'speed'];
    var groups = 0;
    covGroups.forEach(function (g) {
      var ids = (PRESET_GROUPS.filter(function (x) { return x.id === g; })[0] || {}).ids || [];
      if (!ids.length) return;
      var all = ids.every(function (id) { return (p.events || []).indexOf(id) >= 0; });
      if (all) groups++;
    });
    var cap = (typeof window !== 'undefined' && window.Params) ? window.Params.get('covCap') : 0.05;
    var perG = (typeof window !== 'undefined' && window.Params) ? window.Params.get('covGroup') : 0.02;
    var allB = (typeof window !== 'undefined' && window.Params) ? window.Params.get('covAll') : 0.03;
    var raw = groups * perG + ((p.events || []).length >= 17 ? allB : 0);
    var items = [
      { k: 'breadth', v: round(Math.pow(Math.max((p.m ? p.m.m5 : 1), 1), 0.7) / 12, 2) },
      { k: 'coverage', v: round(Math.min(raw, cap) * 100, 2) },
      { k: 'lineCount', v: ((p.events || []).indexOf('333mbf') >= 0 || (p.events || []).indexOf('333mbo') >= 0) ? round(41.4 / 100, 2) : 0 },
      { k: 'multi', v: round(Math.min((p.events || []).length, 17) / 17 * 1.6, 2) }
    ];
    var total = round(Math.min(items.reduce(function (a, b) { return a + b.v; }, 0), cap * 100 + 2), 2);
    p.bonus = { items: items, total: total, cap: round((cap * 100), 2) };
    return p.bonus;
  }

  function ranksOf(p, ctx) {
    if (p.ranks) return p.ranks;
    var cont = ctx.continentOf[p.country], reg = ctx.regionOf[cont];
    var inC = ctx.ranked.filter(function (x) { return ctx.continentOf[x.country] === cont; });
    var inR = ctx.ranked.filter(function (x) { return ctx.regionOf[ctx.continentOf[x.country]] === reg; });
    var inN = ctx.ranked.filter(function (x) { return x.country === p.country; });
    p.ranks = {
      world: p.rank,
      continent: inC.filter(function (x) { return x.overall > p.overall; }).length + 1,
      continentOf: inC.length,
      region: inR.filter(function (x) { return x.overall > p.overall; }).length + 1,
      regionOf: inR.length,
      nation: inN.filter(function (x) { return x.overall > p.overall; }).length + 1,
      nationOf: inN.length,
      contName: cont, regName: reg
    };
    return p.ranks;
  }

  /* 单项目口径的另类统计指标：只统计该项目上的真实数据。
     ETL 把每选手的 evStat[eid] 传上来；缺项回落到「无数据」，不拿全项目数值冒充。 */
  function evStatOf(p, ev) {
    var b = evStatCtx ? evStatCtx(p, ev) : (p.evStat && ev ? p.evStat[ev] : null);
    if (!b) return null;
    var ys = (b.years || []).slice().sort(function (a, c) { return a - c; });
    var streak = 1, maxSk = ys.length ? 1 : 0;
    for (var i = 1; i < ys.length; i++) {
      if (ys[i] === ys[i - 1] + 1) streak++; else streak = 1;
      if (streak > maxSk) maxSk = streak;
    }
    var gSk = 0, cur = 0;
    ys.forEach(function (y) {
      var n = (b.goldPerYear || {})[y] || 0;
      if (n > 0) { cur++; if (cur > gSk) gSk = cur; } else cur = 0;
    });
    var recBest = b.recBest || 0;
    if (!recBest) {
      var ry = b.recPerYear || {};
      Object.keys(ry).forEach(function (y) { if (ry[y] > recBest) recBest = ry[y]; });
    }
    var pod = b.pod || 0, gold = b.gold || 0;
    var d = {
      wrCount: b.wr || 0, crCount: b.cr || 0, nrCount: b.nr || 0,
      recTotal: (b.wr || 0) + (b.cr || 0) + (b.nr || 0),
      recEvents: ((b.wr || 0) + (b.cr || 0) + (b.nr || 0)) > 0 ? 1 : 0,
      recBestYear: recBest,
      heldTotal: b.held || 0, heldLongest: b.heldLong || 0, holdingNow: b.heldNow || 0,
      compCount: b.comps || 0,
      compEventRows: b.rows || 0, resultRows: b.rows || 0,
      attempts: b.att || 0, solves: b.sol || 0,
      activeYears: ys.length, activeStreak: maxSk,
      maxEventsPerComp: 1, multiEventComp: 0,
      cities: b.cityN != null ? b.cityN : Object.keys(b.cities || {}).length,
      podiumTotal: pod, gold: gold, silver: b.sil || 0, bronze: b.bro || 0,
      podiumWC: b.wc || 0, podiumCC: b.cc || 0, podiumNC: b.nc || 0,
      podiumLocal: b.lo || 0, podiumOpen: b.op || 0,
      most4th: 0, top4NoPodium: 0,
      goldEvents: gold > 0 ? 1 : 0, podiumEvents: pod > 0 ? 1 : 0,
      podiumStreak: gSk,
      bestYearGold: Object.keys(b.goldPerYear || {}).reduce(function (m, y) { return Math.max(m, b.goldPerYear[y]); }, 0),
      podiumRate: round(pod / Math.max(1, b.comps || b.rows || 1), 4),
      goldRate: round(gold / Math.max(1, pod), 4),
      champConvert: round(((b.wc || 0) + (b.cc || 0) + (b.nc || 0)) / Math.max(1, pod), 4),
      yearsTop10: (p.yTop10 || 0), yearsTop100: (p.yTop100 || 0),
      coverage: 1, dominance: round((p.eloPeak - 1400) / 900, 3),
      lowCompHighAch: round((p.overall || 0) / Math.max(1, b.comps), 4),
      compDensity: round((b.comps || 0) / Math.max(1, ys.length), 2),
      dnf: b.dnf || 0
    };
    return d;
  }
  var evStatCtx = null;

  function board(kind, key, n, ev, ctx, pool) {
    var src = pool || ctx.ranked;
    var all = src.filter(function (p) { return !ev || (p.events || []).indexOf(ev) >= 0; })
      .map(function (p) {
        /* 指定项目时用「该项目上的真实指标」，不拿全项目数值冒充 */
        var st = ev ? evStatOf(p, ev) : stats(p);
        if (!st) return null;
        return { p: p, v: st[key] };
      })
      .filter(function (d) { return d && typeof d.v === 'number' && isFinite(d.v); });
    /* 该项对所有人都为 0 → 说明数据里没有这个字段，不展示无意义的空排行 */
    var mx = 0;
    all.forEach(function (d) { if (d.v > mx) mx = d.v; });
    if (mx <= 0) return [];
    return all.sort(function (a, b) { return b.v - a.v; }).slice(0, n || 15);
  }

  function cumAt(p, y) {
    var s = 0; var yv = p.yearly || {};
    for (var k in yv) { if (+k <= y) s += yv[k]; }
    return s;
  }
  function actAt(p, y) {
    var s = 0; var yv = p.yearly || {};
    for (var k in yv) { if (+k <= y && +k > y - 1) s += yv[k]; }
    return s;
  }
  function cumAtF(p, fy) {
    var ys = Object.keys(p.yearly || {}).map(Number).sort(function (a, b) { return a - b; });
    var yi = Math.floor(fy), frac = fy - yi, s = 0;
    ys.forEach(function (y) {
      if (y < yi) s += p.yearly[y];
      else if (y === yi) s += p.yearly[y];
      else if (y === yi + 1 && frac > 0) s += p.yearly[y] * frac;
    });
    return s;
  }
  function actAtF(p, fy) {
    var ys = Object.keys(p.yearly || {}).map(Number).sort(function (a, b) { return a - b; });
    var lo = fy - 1, s = 0;
    ys.forEach(function (y) {
      var a = Math.max(y, lo), b = Math.min(y + 1, fy), w = b - a;
      if (w > 0) s += p.yearly[y] * w;
    });
    return s;
  }

  /* 泳道（WR 保持者演变）—— 仅 mock 用合成数据；真实数据由 ETL 通过 cfg.lanes 传入 */
  function makeLanes(evList, seedShift, PLAYERS) {
    var rnd = mulberry32(20261018 + (seedShift || 0) * 7919);
    function ri(a, b) { return Math.floor(a + rnd() * (b - a + 1)); }
    return evList.map(function (ev) {
      var segs = [];
      var y = 2004 + (ri(0, 3) + (seedShift || 0)) % 4;
      var top = PLAYERS.slice().sort(function (a, b) { return b.m.m1 - a.m.m1; }).slice(0, 40);
      while (y < 2026) {
        var holder = top[ri(0, top.length - 1)];
        var len = ri(1, 4);
        var end = Math.min(2026, y + len);
        segs.push({
          from: y, to: end, holder: holder.name, country: holder.country, id: holder.id,
          days: (end - y) * 365, color: 'hsl(' + holder.hue + ',58%,52%)'
        });
        y = end;
      }
      return { ev: ev, zh: EV[ev] ? EV[ev].zh : ev, en: EV[ev] ? EV[ev].en : ev, segs: segs };
    });
  }
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------------- assemble：产出 window.MOCK 兼容对象 ---------------- */
  function assemble(players, cfg) {
    cfg = cfg || {};
    var events = cfg.events || EVENTS;
    var ev = {}; events.forEach(function (e) { ev[e.id] = e; });
    var presetGroups = cfg.presetGroups || PRESET_GROUPS;
    /* 国家维度统一归一化为 ISO2：国家名（含中文 / 英文）与洲际码都取自国家表，
       不再依赖导出里的 countries.tsv / continents.tsv（不同版本列名不一致） */
    var countries = {}, countriesZh = {}, continentMap = {};
    var countriesRaw = cfg.countries || {}, continentRaw = cfg.continentOf || {};
    var continentOf = continentMap;
    Object.keys(countriesRaw).forEach(function (id) {
      const iso = isoNorm(id);
      if (!iso) return;
      countries[iso] = countryEn(iso);
      countriesZh[iso] = countryZh(iso);
      /* 洲际优先取导出自带的 continent_id（权威），回落国家表的洲际码 */
      const c = continentRaw[id] || continentRaw[iso] || contOfIso(iso) || '';
      if (c) continentMap[iso] = c;
    });
    Object.keys(continentRaw).forEach(function (id) {
      const iso = isoNorm(id);
      if (iso && continentRaw[id] && !continentMap[iso]) continentMap[iso] = continentRaw[id];
    });
    /* 数据中出现的国家：即使国家表缺项也补上，保证下拉与筛选不空白 */
    players.forEach(function (p) {
      const iso = isoNorm(p.country);
      if (!iso) return;
      if (!countries[iso]) { countries[iso] = countryEn(iso); countriesZh[iso] = countryZh(iso); }
      const c = contOfIso(iso) || continentRaw[p.country] || continentRaw[iso] || '';
      if (c && !continentMap[iso]) continentMap[iso] = c;
    });
    const countryList = Object.keys(countries);

    /* 选手 country 归一化为 ISO2（前端旗帜 / 中文名 / 洲际筛选都依赖它） */
    players.forEach(function (p) { p.country = isoNorm(p.country) || p.country; });

    var continents = CONTINENTS, regions = REGIONS, regionOf = REGION_OF;
    var milestones = cfg.milestones || MILESTONES;
    var emMap = cfg.eventMilestonesMap || null;
    var eventMilestonesFn = cfg.eventMilestones || function (ev) {
      if (emMap && emMap[ev]) return emMap[ev];
      return defaultEventMilestones(ev);
    };
    var boards = cfg.boards || BOARDS;
    var meta = cfg.meta || {
      demo: true, updated: '', exportVersion: '',
      players: players.length, events: events.length,
      comps: 0, wr: 0, records: 0, podiums: 0, nations: 0
    };
    var years = cfg.years || (function () { var a = [], y0 = 2003, y1 = (new Date().getFullYear()); for (var y = y0; y <= y1; y++) a.push(y); return a; })();

    players.forEach(function (p) {
      p.m = p.m || {}; p.pk = p.pk || {};
      p.career = round(weighted(p.m), 1);
      p.peak = round(weighted(p.pk), 1);
      p.overall = round(overall(p.career, p.peak), 1);
      p.balance = round(Math.log(Math.max(p.career, 0.01) / Math.max(p.peak, 0.01)), 3);
      if (p.hue == null && p.name) p.hue = hue(p.name);
      /* eloPeak 兜底：明细选手由 ETL 直接给出，精简档案用 M7 反推 */
      if (p.eloPeak == null) p.eloPeak = Math.round(1400 + (p.m.m7 || 0) * 900);
    });

    var ranked = players.slice().sort(function (a, b) { return b.overall - a.overall; });
    ranked.forEach(function (p, i) { p.rank = i + 1; });

    /* 年度名次表 {year:{id:rank}}：让「每年进入前 N」这类统计有真实依据 */
    var allYears = [];
    players.forEach(function (p) {
      Object.keys(p.yearly || {}).forEach(function (y) {
        var n = +y;
        if (!isNaN(n) && allYears.indexOf(n) < 0) allYears.push(n);
      });
    });
    allYears.sort(function (a, b) { return a - b; });
    var yearRank = {};
    allYears.forEach(function (y) {
      var arr = players.map(function (p) { return { id: p.id, v: (p.yearly || {})[y] || 0 }; })
        .filter(function (d) { return d.v > 0; })
        .sort(function (a, b) { return b.v - a.v; });
      var m = {};
      arr.forEach(function (d, i) { m[d.id] = i + 1; });
      yearRank[y] = m;
    });
    players.forEach(function (p) { p.yearRank = yearRank; });

    /* 国家聚合 */
    var NATIONS = {};
    players.forEach(function (p) {
      if (!NATIONS[p.country]) NATIONS[p.country] = { iso: p.country, total: 0, count: 0, best: 0, bestName: '' };
      var n = NATIONS[p.country];
      n.total += p.overall; n.count++;
      if (p.overall > n.best) { n.best = p.overall; n.bestName = p.name; }
    });
    var nations = Object.keys(NATIONS).map(function (k) {
      var n = NATIONS[k];
      return {
        iso: k, name: countries[k], continent: continentOf[k], region: regionOf[continentOf[k]],
        total: round(n.total, 0), count: n.count, perCapita: round(n.total / n.count, 1),
        best: round(n.best, 1), bestName: n.bestName
      };
    }).sort(function (a, b) { return b.total - a.total; });

    var lanes = cfg.lanes || makeLanes(events.map(function (e) { return e.id; }), 0, players);
    var lanesAvg = cfg.lanesAvg || makeLanes(events.map(function (e) { return e.id; }), 2, players);

    var ctx = { ranked: ranked, continentOf: continentMap, regionOf: regionOf };
    evStatCtx = function (p, ev) { return p.evS ? decodeEvStat(p, ev) : (p.evStat ? p.evStat[ev] : null); };

    /* ETL 输出的按项目统计为紧凑字符串，这里按需解码（用完即弃，不常驻内存） */
    var EVK = ['rows', 'att', 'sol', 'dnf', 'pod', 'gold', 'sil', 'bro', 'wr', 'cr', 'nr',
      'comps', 'wc', 'cc', 'nc', 'lo', 'op', 'held', 'heldLong', 'heldNow',
      'cityN', 'yrCnt', 'yrStr', 'gyStr', 'recBest'];
    function decodeEvStat(p, ev) {
      var s = p.evS;
      if (!s || !ev) return null;
      var seg = evStatCache[s];
      if (!seg) {
        seg = {};
        s.split(';').forEach(function (row) {
          var ci = row.indexOf(':');
          if (ci < 0) return;
          seg[row.slice(0, ci)] = row.slice(ci + 1).split(',');
        });
        if (evStatCacheLen > 4000) { evStatCache = {}; evStatCacheLen = 0; }
        evStatCache[s] = seg; evStatCacheLen++;
      }
      var a = seg[ev];
      if (!a) return null;
      var b = { cities: {}, recPerYear: {}, goldPerYear: {} };
      for (var i = 0; i < EVK.length; i++) {
        var v = +a[i] || 0, k = EVK[i];
        if (k === 'cities') b.cityN = v;
        else if (k === 'yrCnt') b.yrCnt = v;
        else if (k === 'yrStr') b.years = v ? String(v).split('.') : [];
        else if (k === 'gyStr') {
          if (v) String(v).split('.').forEach(function (g) { var t = g.split('_'); b.goldPerYear[t[0]] = +t[1]; });
        } else if (k === 'recBest') b.recBest = v;
        else b[k] = v;
      }
      b.cities = null;
      return b;
    }
    var evStatCache = {}, evStatCacheLen = 0;

    function ensureDetail(p) { if (!p.records) p.records = []; if (!p.podiums) p.podiums = []; return p; }

    var M = {
      events: events, EV: ev, presetGroups: presetGroups,
      countries: countries, countriesZh: countriesZh, countryList: countryList,
      continents: continents, continentOf: continentOf,
      regions: regions, regionOf: regionOf,
      players: players, ranked: ranked,
      weights: WEIGHTS, modKeys: MODKEYS,
      lanes: lanes, lanesAvg: lanesAvg, nations: nations,
      milestones: milestones, eventMilestones: eventMilestonesFn,
      boards: boards, board: function (k, key, n, e, pool) { return board(k, key, n, e, ctx, pool); },
      evStatOf: function (p, ev) { return evStatOf(p, ev); },
      decodeEvStat: function (p, ev) { return decodeEvStat(p, ev); },
      eventBoards: cfg.eventBoards || {},
      meta: meta, years: years,
      ensureDetail: ensureDetail, stats: function (p) { return stats(p); },
      bonus: function (p) { return bonus(p); }, ranksOf: function (p) { return ranksOf(p, ctx); },
      cumAt: cumAt, actAt: actAt, cumAtF: cumAtF, actAtF: actAtF
    };
    return M;
  }

  var Calc = {
    U: U, MODKEYS: MODKEYS, WEIGHTS: WEIGHTS, EVENTS: EVENTS, EV: EV, PRESET_GROUPS: PRESET_GROUPS,
    CONTINENTS: CONTINENTS, REGIONS: REGIONS, REGION_OF: REGION_OF, CONTINENT_CODE: CONTINENT_CODE,
    MILESTONES: MILESTONES, BOARDS: BOARDS, EV_BARRIERS: EV_BARRIERS,
    weighted: weighted, overall: overall, modsByType: modsByType, round: round, clamp: clamp, esc: esc,
    CT: CT, isoNorm: isoNorm, countryEn: countryEn, countryZh: countryZh, contOfIso: contOfIso,
    stats: stats, bonus: bonus, ranksOf: ranksOf, board: board,
    cumAt: cumAt, actAt: actAt, cumAtF: cumAtF, actAtF: actAtF,
    makeLanes: makeLanes, defaultEventMilestones: defaultEventMilestones, assemble: assemble
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Calc;
  if (root) { root.Calc = Calc; root.U = U; }
})(typeof window !== 'undefined' ? window : null);

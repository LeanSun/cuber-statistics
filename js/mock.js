/* ============================================================
   mock.js — 演示数据生成器（确定性伪随机，虚构样本）
   正式接入 WCA 导出后，本文件保留为「演示 / 兜底」数据，
   站点优先使用 etl 产出的 js/data.js（若存在）。
   所有衍生计算统一交给 js/calc.js 的 Calc.assemble 完成。
   ============================================================ */
(function () {
  var U = window.U;
  var EVENTS = window.Calc.EVENTS, EV = window.Calc.EV, PRESET_GROUPS = window.Calc.PRESET_GROUPS;
  var MODKEYS = window.Calc.MODKEYS, WEIGHTS = window.Calc.WEIGHTS;

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  var rnd = mulberry32(20261018);
  function rr(a, b) { return a + rnd() * (b - a); }
  function ri(a, b) { return Math.floor(rr(a, b + 1)); }
  function pick(arr) { return arr[Math.floor(rnd() * arr.length)]; }
  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
  function round(x, n) { var p = Math.pow(10, n == null ? 2 : n); return Math.round(x * p) / p; }

  /* 国家 / 大洲（演示用，含部分中文名）；真实数据由 ETL 覆盖 */
  var COUNTRIES = {
    CN: '中国', HK: '中国香港', MO: '中国澳门', TW: '中国台湾',
    US: '美国', JP: '日本', KR: '韩国', DE: '德国', GB: '英国', FR: '法国',
    NL: '荷兰', PL: '波兰', SE: '瑞典', IT: '意大利', ES: '西班牙', RU: '俄罗斯', UA: '乌克兰',
    CA: '加拿大', AU: '澳大利亚', BR: '巴西', MX: '墨西哥', IN: '印度', ID: '印度尼西亚',
    MY: '马来西亚', SG: '新加坡', TH: '泰国', VN: '越南', PH: '菲律宾', NZ: '新西兰', CH: '瑞士',
    NG: '尼日利亚', KE: '肯利亚', EG: '埃及', ZA: '南非', AR: '阿根廷', CL: '智利'
  };
  var CONTINENT_OF = {
    CN: 'As', HK: 'As', MO: 'As', TW: 'As', JP: 'As', KR: 'As', IN: 'As', ID: 'As', MY: 'As', SG: 'As', TH: 'As', VN: 'As', PH: 'As',
    US: 'NAm', CA: 'NAm', MX: 'NAm',
    BR: 'SAm', AR: 'SAm', CL: 'SAm',
    GB: 'Eu', DE: 'Eu', FR: 'Eu', NL: 'Eu', PL: 'Eu', SE: 'Eu', IT: 'Eu', ES: 'Eu', RU: 'Eu', UA: 'Eu', CH: 'Eu',
    AU: 'Oc', NZ: 'Oc',
    NG: 'Af', KE: 'Af', EG: 'Af', ZA: 'Af'
  };

  var NAMES = {
    CN: [['伟', '张'], ['子涵', '王'], ['宇航', '李'], ['嘉懿', '陈'], ['思远', '刘'], ['雨泽', '杨'], ['博文', '黄'], ['天翊', '赵'], ['明轩', '周'], ['若曦', '吴'], ['梓萱', '徐'], ['欣怡', '孙'], ['佳琪', '马'], ['晨曦', '朱'], ['语嫣', '胡']],
    JP: [['Haruto', 'Sato'], ['Yuto', 'Suzuki'], ['Sora', 'Takahashi'], ['Ren', 'Tanaka'], ['Riku', 'Watanabe'], ['Hina', 'Ito'], ['Yui', 'Yamamoto'], ['Aoi', 'Nakamura'], ['Sakura', 'Kobayashi'], ['Mei', 'Kato']],
    KR: [['Minjun', 'Kim'], ['Seojun', 'Lee'], ['Jiwoo', 'Park'], ['Haerin', 'Choi'], ['Junseo', 'Jung'], ['Sooah', 'Kang'], ['Dohyun', 'Cho'], ['Yuna', 'Yoon']],
    US: [['Ethan', 'Miller'], ['Lucas', 'Anderson'], ['Mia', 'Thompson'], ['Noah', 'Robinson'], ['Ava', 'Clark'], ['Liam', 'Walker'], ['Zoe', 'Bennett'], ['Owen', 'Foster'], ['Iris', 'Hayes'], ['Miles', 'Brooks']],
    DE: [['Leon', 'Müller'], ['Finn', 'Schmidt'], ['Lena', 'Schneider'], ['Paul', 'Fischer'], ['Mia', 'Weber'], ['Jonas', 'Becker'], ['Emma', 'Hoffmann']],
    GB: [['Oliver', 'Taylor'], ['Harry', 'Williams'], ['Amelia', 'Brown'], ['George', 'Davies'], ['Freya', 'Evans'], ['Alfie', 'Wilson']],
    FR: [['Louis', 'Martin'], ['Gabriel', 'Bernard'], ['Chloe', 'Dubois'], ['Jules', 'Moreau'], ['Alice', 'Petit']],
    NL: [['Daan', 'de Vries'], ['Sem', 'van Dijk'], ['Emma', 'Bakker'], ['Lucas', 'Jansen']],
    PL: [['Jakub', 'Kowalski'], ['Kacper', 'Nowak'], ['Zofia', 'Wisniewska'], ['Antoni', 'Lewandowski']],
    SE: [['Lucas', 'Andersson'], ['Elias', 'Johansson'], ['Maja', 'Larsson']],
    IT: [['Leonardo', 'Rossi'], ['Giulia', 'Bianchi'], ['Matteo', 'Ferrari']],
    ES: [['Hugo', 'Garcia'], ['Martina', 'Rodriguez'], ['Pablo', 'Fernandez']],
    RU: [['Artem', 'Ivanov'], ['Mikhail', 'Smirnov'], ['Anna', 'Kuznetsova']],
    UA: [['Dmytro', 'Kovalenko'], ['Olena', 'Bondarenko']],
    CA: [['Nathan', 'Tremblay'], ['Chloe', 'Gagnon']], AU: [['Jack', 'Campbell'], ['Ruby', 'Nguyen']],
    NZ: [['Caleb', 'Wilson']], BR: [['Pedro', 'Silva'], ['Larissa', 'Santos']],
    MX: [['Diego', 'Ramirez'], ['Valeria', 'Torres']], IN: [['Aarav', 'Sharma'], ['Ananya', 'Iyer'], ['Vivaan', 'Patel']],
    ID: [['Raffa', 'Wijaya'], ['Keiko', 'Tanoto']], MY: [['Zi Yang', 'Lim'], ['Nurin', 'Ahmad']],
    SG: [['Javier', 'Tan'], ['Wei Ling', 'Ong']], TH: [['Napat', 'Srisai']], VN: [['Minh', 'Nguyen'], ['Linh', 'Tran']],
    PH: [['Joshua', 'Reyes'], ['Sofia', 'Cruz']], CH: [['Noah', 'Steiner'], ['Lina', 'Frei']],
    NG: [['Chidi', 'Okafor'], ['Amara', 'Eze']], KE: [['Brian', 'Otieno'], ['Aisha', 'Wanjiru']],
    EG: [['Omar', 'Hassan'], ['Nour', 'Fahmy']], ZA: [['Liam', 'Pretorius'], ['Thandi', 'Mokoena']],
    AR: [['Santiago', 'Lopez'], ['Valentina', 'Gomez']], CL: [['Matias', 'Rojas'], ['Isidora', 'Vargas']],
    HK: [['Ka Ho', 'Chan'], ['Wing', 'Lee'], ['Chi Wai', 'Tang'], ['Hiu', 'Cheng'], ['Man', 'Fung']],
    MO: [['Chi Fong', 'Wong'], ['Sio', 'U'], ['Ka Ian', 'Lei'], ['Weng', 'Chao']],
    TW: [['Yu', 'Chen'], ['Wei', 'Lin'], ['Chia', 'Huang'], ['Yi', 'Wang'], ['Hsuan', 'Wu'], ['Cheng', 'Liu']]
  };
  var CKEYS = Object.keys(COUNTRIES);
  var CW = ['CN', 'CN', 'CN', 'CN', 'CN', 'US', 'US', 'US', 'JP', 'JP', 'KR', 'DE', 'DE', 'GB', 'FR', 'NL', 'PL', 'SE', 'IT', 'ES', 'RU', 'UA', 'CA', 'AU', 'BR', 'MX', 'IN', 'IN', 'ID', 'MY', 'SG', 'TH', 'VN', 'PH', 'CH', 'NZ', 'NG', 'KE', 'EG', 'ZA', 'AR', 'CL', 'HK', 'HK', 'MO', 'TW', 'TW', 'TW'];

  function fmtValue(ev, type) {
    var s = function (a, b, n) { return round(rr(a, b), n == null ? 2 : n).toFixed(n == null ? 2 : n); };
    switch (ev) {
      case '333': return type === 'avg' ? s(5.2, 8.4) : s(4.1, 7.0);
      case '222': return type === 'avg' ? s(1.4, 2.6) : s(0.9, 2.0);
      case '444': return type === 'avg' ? s(24, 36) : s(21, 32);
      case '555': return type === 'avg' ? s(46, 66) : s(42, 60);
      case '666': return type === 'avg' ? s(95, 135) : s(88, 125);
      case '777': return type === 'avg' ? s(145, 200) : s(135, 185);
      case '333oh': return type === 'avg' ? s(9, 16) : s(7, 13);
      case '333bf': return type === 'avg' ? s(19, 40) : s(15, 32);
      case '444bf': return type === 'avg' ? s(110, 240) : s(80, 190);
      case '555bf': return type === 'avg' ? s(300, 620) : s(240, 520);
      case '333mbf': {
        var att = ri(20, 49), solved = att - ri(0, 3), m = ri(48, 58), sec = ri(12, 58);
        return solved + '/' + att + ' ' + m + ':' + String(sec).padStart(2, '0');
      }
      case '333fm': return type === 'avg' ? String(ri(24, 34)) : String(ri(19, 30));
      case 'clock': return type === 'avg' ? s(4.5, 9) : s(3.4, 7.5);
      case 'minx': return type === 'avg' ? s(32, 52) : s(28, 46);
      case 'pyram': return type === 'avg' ? s(2.2, 5.0) : s(1.5, 3.8);
      case 'skewb': return type === 'avg' ? s(2.6, 5.6) : s(1.7, 4.2);
      case 'sq1': return type === 'avg' ? s(7.5, 14) : s(5.8, 11);
      case '333ft': return type === 'avg' ? s(45, 90) : s(36, 78);
      case 'magic': return type === 'avg' ? s(1.1, 2.0) : s(0.85, 1.6);
      case 'mmagic': return type === 'avg' ? s(2.2, 4.0) : s(1.8, 3.4);
      default: return s(5, 20);
    }
  }

  /* ---------- 选手 ---------- */
  var PLAYERS = [];
  var usedNames = {};
  var N = 320;

  for (var i = 0; i < N; i++) {
    var cc = pick(CW);
    var np = pick(NAMES[cc] || NAMES.US);
    var name = np[1] + ' ' + np[0];
    var guard = 0;
    while (usedNames[name] && guard++ < 40) { np = pick(NAMES[cc] || NAMES.US); name = np[1] + np[0]; }
    usedNames[name] = 1;

    var raw = rnd();
    var s = Math.pow(raw, 2.6);
    var gender = rnd() < 0.85 ? 'M' : 'F';
    var start = ri(2003, 2021);
    var span = clamp(Math.round(rr(3, 18) * (0.5 + s)), 2, 22);
    var end = Math.min(2025, start + span);
    var comps = Math.round(rr(8, 60) * (0.4 + s));

    var mainEv = pick(['333', '333', '333', '222', '444', '555', '333oh', '333bf', '333mbf', '333fm', 'minx', 'pyram', 'skewb', 'sq1']);
    var pool = EVENTS.filter(function (e) { return !e.retired; });
    var evCount = clamp(Math.round(rr(2, 17) * (0.35 + s * 1.4)), 1, pool.length);
    var evs = [mainEv];
    var guard0 = 0;
    while (evs.length < evCount && guard0++ < 500) { var e = pick(pool).id; if (evs.indexOf(e) < 0) evs.push(e); }

    var p = {
      id: 'P' + String(i + 1).padStart(4, '0'),
      wcaId: '20' + String(ri(3, 24)).padStart(2, '0') + String.fromCharCode(65 + ri(0, 25)) + String.fromCharCode(65 + ri(0, 25)) + String.fromCharCode(65 + ri(0, 25)) + String(ri(1, 99)).padStart(2, '0'),
      name: name,
      nameZh: (cc === 'CN' ? np[1] + np[0] : null),
      country: cc,
      gender: gender,
      start: start, end: end, comps: comps,
      mainEvent: mainEv,
      events: evs,
      hue: U.hue(name)
    };

    p._m1 = s * rr(0.6, 1.4) * 100;
    p._m2 = s * rr(0.5, 1.5) * 100;
    p._m3 = Math.pow(s, 0.8) * rr(0.6, 1.6) * 100;
    p._m4 = s * rr(0.5, 1.5) * 100;
    p._m5 = Math.pow(s, 0.6) * (evs.length / 17) * rr(0.7, 1.5) * 100;
    p._m6 = (span / 20) * rr(0.6, 1.4) * 100 * 0.6 + (comps / 200) * 40;
    p._m7 = (1400 + s * rr(0.6, 1.3) * 900 - 1400) / 900 * 100;

    var peakRatio = rr(0.30, 0.66) + s * 0.20;
    p._p1 = p._m1 * peakRatio * rr(0.85, 1.05);
    p._p2 = p._m2 * peakRatio * rr(0.85, 1.05);
    p._p3 = p._m3 * peakRatio * rr(0.8, 1.0);
    p._p4 = p._m4 * peakRatio * rr(0.85, 1.05);
    p._p5 = p._m5 * peakRatio * rr(0.9, 1.1);
    p._p6 = 0;
    p._p7 = p._m7 * rr(0.92, 1.0);

    p.wr = s > 0.55 ? Math.round(s * rr(4, 26)) : (s > 0.25 ? ri(0, 3) : 0);
    p.cr = p.wr + (s > 0.3 ? ri(0, 8) : 0);
    p.nr = p.cr + (s > 0.2 ? ri(0, 14) : ri(0, 3));
    p.wcGold = s > 0.6 ? ri(0, 5) : (s > 0.35 ? ri(0, 2) : 0);
    p.ccGold = p.wcGold + ri(0, 4);
    p.ncGold = p.ccGold + ri(0, 6);
    p.months1 = s > 0.5 ? Math.round(s * rr(6, 90)) : (s > 0.25 ? ri(0, 12) : 0);
    p.months10 = p.months1 + ri(0, 120);
    p.months100 = p.months10 + ri(0, 200);
    p.eloPeak = Math.round(1400 + s * rr(0.55, 1.35) * 900);
    p.peakSpan = clamp(Math.round(s * rr(2, 15)), 1, 17);
    p.peakAge = 0;

    p.yearly = {};
    var base = (s * 9 + 0.6) / Math.max(1, span);
    for (var y = start; y <= end; y++) {
      var shape = Math.sin(Math.PI * ((y - start) / Math.max(1, span))) * 0.9 + 0.35;
      p.yearly[y] = round(base * shape * rr(0.55, 1.55), 3);
    }

    PLAYERS.push(p);
  }

  /* ---------- 模块归一：每模块最大值 = 100 ---------- */
  var scaleC = {}, scaleP = {};
  MODKEYS.forEach(function (k) {
    var mc = 0, mp = 0;
    PLAYERS.forEach(function (p) { mc = Math.max(mc, p['_' + k]); mp = Math.max(mp, p['_p' + k[1]]); });
    scaleC[k] = mc > 0 ? 100 / mc : 1;
    scaleP[k] = mp > 0 ? 100 / mp : 1;
  });
  PLAYERS.forEach(function (p) {
    p.m = {}; p.pk = {};
    MODKEYS.forEach(function (k) {
      p.m[k] = round(clamp(p['_' + k] * scaleC[k], 0, 100), 2);
      p.pk[k] = round(clamp(p['_p' + k[1]] * scaleP[k], 0, 100), 2);
    });
  });

  /* ---------- 纪录 / 领奖台明细（演示用合成） ---------- */
  var COMP_NAMES = ['World Championship', 'European Championship', 'Asian Championship', 'National Championship',
    'Open Cup', 'Spring Open', 'Autumn Classic', 'Winter Trophy', 'Regional Open', 'City Championship',
    '世界锦标赛', '亚洲锦标赛', '国家锦标赛', '城市公开赛', '春季公开赛', '秋季经典赛'];
  var TIERS = ['WC', 'CC', 'NC', 'OP', 'OP', 'OP', 'OP'];

  function buildRecords(p, n) {
    var out = [];
    for (var i = 0; i < n; i++) {
      var ev = pick(p.events);
      var e = EV[ev];
      var type = e.singleOnly ? 'single' : (rnd() < 0.5 ? 'single' : 'avg');
      var roll = rnd();
      var level = roll < 0.30 * (0.4 + p.m.m1 / 100) ? 'WR' : (roll < 0.62 ? 'CR' : 'NR');
      var date = ri(p.start, p.end) + '-' + String(ri(1, 12)).padStart(2, '0') + '-' + String(ri(1, 28)).padStart(2, '0');
      var G = level === 'WR' ? 1 : (level === 'CR' ? round(rr(0.35, 0.55), 2) : round(rr(0.08, 0.22), 2));
      var fac = {
        we: round(e.w, 2), S: round(rr(0.62, 1.0), 2),
        T: type === 'single' ? round(rr(0.52, 0.72), 2) : round(rr(0.72, 1.0), 2),
        K: e.singleOnly ? 1.41 : 1, G: G,
        A: round(clamp(rr(0.4, 3.2), 0.2, 3.6), 2), O: round(rr(1.0, 1.5), 2),
        z: round(clamp(rr(0.6, 3.4), 0.2, 4.2), 2)
      };
      var R = round(100 * fac.we * fac.S * fac.T * fac.K * fac.G * fac.A * fac.O * (1 + 0.15 * fac.z), 1);
      var held = ri(3, 1400);
      out.push({
        ev: ev, type: type, level: level, date: date,
        value: fmtValue(ev, type === 'single' ? 'sgl' : 'avg'),
        factors: fac, R: R, comp: pick(COMP_NAMES),
        held: held, current: rnd() < 0.12
      });
    }
    out.sort(function (a, b) { return b.R - a.R; });
    return out;
  }

  function buildPodiums(p, n) {
    var out = [];
    for (var i = 0; i < n; i++) {
      var ev = pick(p.events);
      var e = EV[ev];
      var tier = pick(TIERS);
      var place = ri(1, 3);
      var field = tier === 'OP' ? ri(18, 220) : ri(40, 700);
      var csi = round(clamp(Math.pow(field / 90, 0.5) * rr(0.6, 1.7), 0.35, 3.0), 2);
      var C = tier === 'WC' ? 1.6 : tier === 'CC' ? 1.4 : tier === 'NC' ? 1.25 : 1.0;
      var V = Math.pow(place, -1.1);
      var fac = {
        we: round(e.w, 2), S: round(rr(0.62, 1.0), 2), Tpod: round(rr(0.85, 1.12), 2),
        V: round(V, 3), C: C, CSI: csi, z: round(clamp(rr(0.4, 3.0), 0.1, 4), 2),
        margin: round(rr(0, 0.09), 3)
      };
      var R = round(100 * fac.we * fac.S * fac.Tpod * fac.V * fac.C * fac.CSI * (1 + 0.1 * fac.z + 1.5 * fac.margin), 1);
      out.push({ ev: ev, tier: tier, place: place, comp: pick(COMP_NAMES), year: ri(p.start, p.end), field: field, factors: fac, R: R });
    }
    out.sort(function (a, b) { return b.R - a.R; });
    return out;
  }

  /* 预置每位选手的纪录 / 领奖台（与真实数据一致：records/podiums 已存在） */
  PLAYERS.forEach(function (p) {
    p.records = buildRecords(p, clamp(Math.round(p.m.m1 / 5) + ri(2, 8), 2, 22));
    p.podiums = buildPodiums(p, clamp(Math.round(p.m.m2 / 4) + ri(3, 9), 3, 18));
  });

  /* ---------- meta（演示） ---------- */
  var totComps = 0, totWR = 0, totRec = 0, totPod = 0, seen = {};
  PLAYERS.forEach(function (p) {
    totComps += p.comps; totWR += p.wr; totRec += p.records.length; totPod += p.podiums.length; seen[p.country] = 1;
  });
  var YEARS = (function () { var a = []; for (var y = 2003; y <= 2025; y++) a.push(y); return a; })();
  var meta = {
    updated: '2026-10-17', exportVersion: '2.0.2 (demo)', players: PLAYERS.length, events: EVENTS.length,
    comps: totComps, wr: totWR, records: totRec, podiums: totPod, nations: Object.keys(seen).length, demo: true
  };

  window.MOCK = window.Calc.assemble(PLAYERS, {
    demo: true, countries: COUNTRIES, continentOf: CONTINENT_OF, meta: meta, years: YEARS
  });
})();

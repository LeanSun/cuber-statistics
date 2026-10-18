/* ============================================================
   mock.js — 演示数据生成器（确定性伪随机，虚构样本）
   正式接入 WCA 导出后，本文件整体替换为 etl 产出的 JSON
   ============================================================ */
(function () {
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const rnd = mulberry32(20261018);
  const rr = (a, b) => a + rnd() * (b - a);
  const ri = (a, b) => Math.floor(rr(a, b + 1));
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const round = (x, n) => { const p = Math.pow(10, n == null ? 2 : n); return Math.round(x * p) / p; };

  window.U = {
    esc: function (s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    },
    round: round,
    fmt: function (x, n) { return round(x, n == null ? 2 : n).toFixed(n == null ? 2 : n); },
    num: function (x) { return Math.round(x).toLocaleString('en-US'); },
    hue: function (s) {
      let h = 0; s = String(s);
      for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
      return h;
    },
    initials: function (name) {
      const parts = String(name).trim().split(/\s+/);
      if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
  };
  const U = window.U;

  /* ---------- 项目表（group 用于默认分组；groups 用于多归属预设） ---------- */
  const EVENTS = [
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
    { id: '333mbf', zh: '多盲', en: '3x3x3 Multi-Blind', group: 'blind', groups: ['blind'], w: 0.78, singleOnly: true },
    { id: '333fm', zh: '最少步', en: 'Fewest Moves', group: 'fmc', groups: ['fmc'], w: 0.82 },
    { id: 'clock', zh: '魔表', en: 'Clock', group: 'other', groups: ['other'], w: 0.83, retiring: true },
    { id: 'minx', zh: '五魔方', en: 'Megaminx', group: 'other', groups: ['other'], w: 0.86 },
    { id: 'pyram', zh: '金字塔', en: 'Pyraminx', group: 'other', groups: ['other'], w: 0.90 },
    { id: 'skewb', zh: '斜转', en: 'Skewb', group: 'other', groups: ['other'], w: 0.89 },
    { id: 'sq1', zh: 'SQ1', en: 'Square-1', group: 'other', groups: ['other'], w: 0.87 },
    { id: '333ft', zh: '脚拧', en: '3x3x3 With Feet', group: 'retired', groups: ['retired'], w: 0.66, retired: true },
    { id: 'magic', zh: '八板', en: 'Magic', group: 'retired', groups: ['retired'], w: 0.60, retired: true },
    { id: 'mmagic', zh: '十二板', en: 'Master Magic', group: 'retired', groups: ['retired'], w: 0.58, retired: true },
    { id: '333ec', zh: '三盲旧规', en: '3x3x3 With Eyes Closed', group: 'retired', groups: ['retired'], w: 0.62, retired: true }
  ];
  const EV = {};
  EVENTS.forEach(e => { EV[e.id] = e; });

  /* 预设项目分组（可自定义并存到本地） */
  const PRESET_GROUPS = [
    { id: 'all', zh: '全部项目', en: 'All events', ids: EVENTS.map(e => e.id) },
    { id: 'speed', zh: '速拧组', en: 'Speed', ids: ['333', '222', '444', '555', '666', '777', '333oh'] },
    { id: 'blind', zh: '盲拧组', en: 'Blindfolded', ids: ['333bf', '444bf', '555bf', '333mbf'] },
    { id: 'big', zh: '高阶组', en: 'Big cubes', ids: ['444', '555', '666', '777'] },
    { id: 'other', zh: '异形组', en: 'Other', ids: ['clock', 'minx', 'pyram', 'skewb', 'sq1'] },
    { id: 'fmc', zh: '最少步', en: 'FMC', ids: ['333fm'] },
    { id: 'retired', zh: '已停办', en: 'Discontinued', ids: ['333ft', 'magic', 'mmagic', '333ec'] }
  ];

  /* ---------- 国家 / 大洲 / WCA 地区 ---------- */
  const COUNTRIES = {
    CN: '中国', HK: '中国香港', MO: '中国澳门', TW: '中国台湾',
    US: '美国', JP: '日本', KR: '韩国', DE: '德国', GB: '英国', FR: '法国',
    NL: '荷兰', PL: '波兰', SE: '瑞典', IT: '意大利', ES: '西班牙', RU: '俄罗斯', UA: '乌克兰',
    CA: '加拿大', AU: '澳大利亚', BR: '巴西', MX: '墨西哥', IN: '印度', ID: '印度尼西亚',
    MY: '马来西亚', SG: '新加坡', TH: '泰国', VN: '越南', PH: '菲律宾', NZ: '新西兰', CH: '瑞士',
    NG: '尼日利亚', KE: '肯利亚', EG: '埃及', ZA: '南非', AR: '阿根廷', CL: '智利'
  };
  const CONTINENT_OF = {
    CN: 'As', HK: 'As', MO: 'As', TW: 'As', JP: 'As', KR: 'As', IN: 'As', ID: 'As', MY: 'As', SG: 'As', TH: 'As', VN: 'As', PH: 'As',
    US: 'NAm', CA: 'NAm', MX: 'NAm',
    BR: 'SAm', AR: 'SAm', CL: 'SAm',
    GB: 'Eu', DE: 'Eu', FR: 'Eu', NL: 'Eu', PL: 'Eu', SE: 'Eu', IT: 'Eu', ES: 'Eu', RU: 'Eu', UA: 'Eu', CH: 'Eu',
    AU: 'Oc', NZ: 'Oc',
    NG: 'Af', KE: 'Af', EG: 'Af', ZA: 'Af'
  };
  const CONTINENTS = {
    As: { zh: '亚洲', en: 'Asia', pri: 2 }, Eu: { zh: '欧洲', en: 'Europe', pri: 3 },
    NAm: { zh: '北美洲', en: 'North America', pri: 1 }, SAm: { zh: '南美洲', en: 'South America', pri: 4 },
    Oc: { zh: '大洋洲', en: 'Oceania', pri: 5 }, Af: { zh: '非洲', en: 'Africa', pri: 6 }
  };
  /* WCA 官方六大地区 */
  const REGION_OF = {
    NAm: 'NAR', SAm: 'SAR', As: 'AsR', Eu: 'ER', Oc: 'OcR', Af: 'AfR'
  };
  const REGIONS = {
    NAR: { zh: '北美地区', en: 'North America' }, SAR: { zh: '南美地区', en: 'South America' },
    AsR: { zh: '亚洲地区', en: 'Asia' }, ER: { zh: '欧洲地区', en: 'Europe' },
    OcR: { zh: '大洋洲地区', en: 'Oceania' }, AfR: { zh: '非洲地区', en: 'Africa' }
  };

  const NAMES = {
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
  const CKEYS = Object.keys(COUNTRIES);
  const CW = ['CN','CN','CN','CN','CN','US','US','US','JP','JP','KR','DE','DE','GB','FR','NL','PL','SE','IT','ES','RU','UA','CA','AU','BR','MX','IN','IN','ID','MY','SG','TH','VN','PH','CH','NZ','NG','KE','EG','ZA','AR','CL','HK','HK','MO','TW','TW','TW'];

  function fmtValue(ev, type) {
    const s = (a, b, n) => round(rr(a, b), n == null ? 2 : n).toFixed(n == null ? 2 : n);
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
        const att = ri(20, 49), solved = att - ri(0, 3), m = ri(48, 58), sec = ri(12, 58);
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
  const PLAYERS = [];
  const usedNames = {};
  const N = 320;

  for (let i = 0; i < N; i++) {
    const cc = pick(CW);
    let np = pick(NAMES[cc] || NAMES.US);
    let name = np[1] + ' ' + np[0];
    let guard = 0;
    while (usedNames[name] && guard++ < 40) { np = pick(NAMES[cc] || NAMES.US); name = np[1] + ' ' + np[0]; }
    usedNames[name] = 1;

    const raw = rnd();
    const s = Math.pow(raw, 2.6);
    const gender = rnd() < 0.85 ? 'M' : 'F';
    const start = ri(2003, 2021);
    const span = clamp(Math.round(rr(3, 18) * (0.5 + s)), 2, 22);
    const end = Math.min(2025, start + span);
    const comps = Math.round(rr(8, 60) * (0.4 + s));

    const mainEv = pick(['333', '333', '333', '222', '444', '555', '333oh', '333bf', '333mbf', '333fm', 'minx', 'pyram', 'skewb', 'sq1']);
    const pool = EVENTS.filter(e => !e.retired);
    const evCount = clamp(Math.round(rr(2, 17) * (0.35 + s * 1.4)), 1, pool.length);
    const evs = [mainEv];
    let guard0 = 0;
    while (evs.length < evCount && guard0++ < 500) { const e = pick(pool).id; if (evs.indexOf(e) < 0) evs.push(e); }

    const p = {
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

    const peakRatio = rr(0.30, 0.66) + s * 0.20;
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
    const base = (s * 9 + 0.6) / Math.max(1, span);
    for (let y = start; y <= end; y++) {
      const shape = Math.sin(Math.PI * ((y - start) / Math.max(1, span))) * 0.9 + 0.35;
      p.yearly[y] = round(base * shape * rr(0.55, 1.55), 3);
    }

    PLAYERS.push(p);
  }

  /* ---------- 模块归一：每模块最大值 = 100 ---------- */
  const MODKEYS = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7'];
  const WEIGHTS = { m1: 0.370, m2: 0.228, m7: 0.156, m4: 0.109, m3: 0.073, m5: 0.044, m6: 0.020 };
  const scaleC = {}, scaleP = {};
  MODKEYS.forEach(k => {
    let mc = 0, mp = 0;
    PLAYERS.forEach(p => { mc = Math.max(mc, p['_' + k]); mp = Math.max(mp, p['_p' + k[1]]); });
    scaleC[k] = mc > 0 ? 100 / mc : 1;
    scaleP[k] = mp > 0 ? 100 / mp : 1;
  });
  PLAYERS.forEach(p => {
    p.m = {}; p.pk = {};
    MODKEYS.forEach(k => {
      p.m[k] = round(clamp(p['_' + k] * scaleC[k], 0, 100), 2);
      p.pk[k] = round(clamp(p['_p' + k[1]] * scaleP[k], 0, 100), 2);
    });
    p.career = round(window.Params ? window.Params.weighted(p.m) : MODKEYS.reduce((a, k) => a + WEIGHTS[k] * p.m[k], 0) * 10, 1);
    p.peak = round(window.Params ? window.Params.weighted(p.pk) : MODKEYS.reduce((a, k) => a + WEIGHTS[k] * p.pk[k], 0) * 10, 1);
    p.overall = round(Math.pow(Math.max(p.career, 0.01), 0.6) * Math.pow(Math.max(p.peak, 0.01), 0.4), 1);
    p.balance = round(Math.log(Math.max(p.career, 0.01) / Math.max(p.peak, 0.01)), 3);
  });

  /* ---------- 纪录 / 领奖台明细 ---------- */
  const COMP_NAMES = ['World Championship', 'European Championship', 'Asian Championship', 'National Championship',
    'Open Cup', 'Spring Open', 'Autumn Classic', 'Winter Trophy', 'Regional Open', 'City Championship',
    '世界锦标赛', '亚洲锦标赛', '国家锦标赛', '城市公开赛', '春季公开赛', '秋季经典赛'];
  const TIERS = ['WC', 'CC', 'NC', 'OP', 'OP', 'OP', 'OP'];

  function buildRecords(p, n) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const ev = pick(p.events);
      const e = EV[ev];
      const type = e.singleOnly ? 'single' : (rnd() < 0.5 ? 'single' : 'avg');
      const roll = rnd();
      const level = roll < 0.30 * (0.4 + p.m.m1 / 100) ? 'WR' : (roll < 0.62 ? 'CR' : 'NR');
      const date = ri(p.start, p.end) + '-' + String(ri(1, 12)).padStart(2, '0') + '-' + String(ri(1, 28)).padStart(2, '0');
      const G = level === 'WR' ? 1 : (level === 'CR' ? round(rr(0.35, 0.55), 2) : round(rr(0.08, 0.22), 2));
      const fac = {
        we: round(e.w, 2), S: round(rr(0.62, 1.0), 2),
        T: type === 'single' ? round(rr(0.52, 0.72), 2) : round(rr(0.72, 1.0), 2),
        K: e.singleOnly ? 1.41 : 1, G: G,
        A: round(clamp(rr(0.4, 3.2), 0.2, 3.6), 2), O: round(rr(1.0, 1.5), 2),
        z: round(clamp(rr(0.6, 3.4), 0.2, 4.2), 2)
      };
      const R = round(100 * fac.we * fac.S * fac.T * fac.K * fac.G * fac.A * fac.O * (1 + 0.15 * fac.z), 1);
      const held = ri(3, 1400);
      out.push({
        ev: ev, type: type, level: level, date: date,
        value: fmtValue(ev, type === 'single' ? 'sgl' : 'avg'),
        factors: fac, R: R, comp: pick(COMP_NAMES),
        held: held, current: rnd() < 0.12
      });
    }
    out.sort((a, b) => b.R - a.R);
    return out;
  }

  function buildPodiums(p, n) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const ev = pick(p.events);
      const e = EV[ev];
      const tier = pick(TIERS);
      const place = ri(1, 3);
      const field = tier === 'OP' ? ri(18, 220) : ri(40, 700);
      const csi = round(clamp(Math.pow(field / 90, 0.5) * rr(0.6, 1.7), 0.35, 3.0), 2);
      const C = tier === 'WC' ? 1.6 : tier === 'CC' ? 1.4 : tier === 'NC' ? 1.25 : 1.0;
      const V = Math.pow(place, -1.1);
      const fac = {
        we: round(e.w, 2), S: round(rr(0.62, 1.0), 2), Tpod: round(rr(0.85, 1.12), 2),
        V: round(V, 3), C: C, CSI: csi, z: round(clamp(rr(0.4, 3.0), 0.1, 4), 2),
        margin: round(rr(0, 0.09), 3)
      };
      const R = round(100 * fac.we * fac.S * fac.Tpod * fac.V * fac.C * fac.CSI * (1 + 0.1 * fac.z + 1.5 * fac.margin), 1);
      out.push({ ev: ev, tier: tier, place: place, comp: pick(COMP_NAMES), year: ri(p.start, p.end), field: field, factors: fac, R: R });
    }
    out.sort((a, b) => b.R - a.R);
    return out;
  }

  const ranked = PLAYERS.slice().sort((a, b) => b.overall - a.overall);
  ranked.forEach((p, idx) => {
    p.rank = idx + 1;
    p.records = null; p.podiums = null; p.stats = null;
  });

  function ensureDetail(p) {
    if (!p.records) p.records = buildRecords(p, clamp(Math.round(p.m.m1 / 5) + ri(2, 8), 2, 22));
    if (!p.podiums) p.podiums = buildPodiums(p, clamp(Math.round(p.m.m2 / 4) + ri(3, 9), 3, 18));
    return p;
  }

  /* ---------- 派生统计（另类统计榜用） ---------- */
  function stats(p) {
    if (p.stats) return p.stats;
    ensureDetail(p);
    const recs = p.records, pods = p.podiums;
    const byLevel = { WR: 0, CR: 0, NR: 0 };
    let heldTotal = 0, longest = 0, holdingNow = 0;
    const evSet = {}, yearCount = {};
    recs.forEach(function (r) {
      byLevel[r.level]++;
      heldTotal += r.held;
      longest = Math.max(longest, r.held);
      if (r.current) holdingNow++;
      evSet[r.ev] = 1;
      const y = parseInt(r.date.slice(0, 4), 10);
      yearCount[y] = (yearCount[y] || 0) + 1;
    });
    let bestYear = 0;
    Object.keys(yearCount).forEach(function (y) { bestYear = Math.max(bestYear, yearCount[y]); });

    const podiumByTier = { WC: 0, CC: 0, NC: 0, OP: 0 };
    let g = 0, si = 0, br = 0;
    const podYears = {}, podEvSet = {}, goldEvSet = {}, goldYears = {};
    pods.forEach(function (r) {
      podiumByTier[r.tier]++;
      if (r.place === 1) { g++; goldEvSet[r.ev] = 1; goldYears[r.year] = (goldYears[r.year] || 0) + 1; }
      if (r.place === 2) si++;
      if (r.place === 3) br++;
      podYears[r.year] = 1; podEvSet[r.ev] = 1;
    });
    const years = Object.keys(p.yearly).map(Number).sort((a, b) => a - b);
    let streak = 1, maxStreak = 1;
    for (let i = 1; i < years.length; i++) {
      if (years[i] === years[i - 1] + 1) { streak++; maxStreak = Math.max(maxStreak, streak); } else streak = 1;
    }
    let podStreak = 0, curStreak = 0;
    years.forEach(function (y) { if (podYears[y]) { curStreak++; podStreak = Math.max(podStreak, curStreak); } else curStreak = 0; });
    let bestYearGold = 0;
    Object.keys(goldYears).forEach(function (y) { bestYearGold = Math.max(bestYearGold, goldYears[y]); });

    const totalPod = pods.length;
    const st = {
      wrCount: p.wr, crCount: p.cr, nrCount: p.nr,
      recTotal: recs.length, recEvents: Object.keys(evSet).length, recBestYear: bestYear,
      heldTotal: heldTotal, heldLongest: longest, holdingNow: holdingNow,
      compCount: p.comps,
      compEventRows: Math.round(p.comps * (1.4 + p.events.length / 12)),
      resultRows: Math.round(p.comps * p.events.length * 0.62) + recs.length,
      attempts: Math.round(p.comps * p.events.length * rr(2.6, 4.4)),
      solves: Math.round(p.comps * p.events.length * rr(2.2, 3.8)),
      activeYears: years.length, activeStreak: maxStreak,
      maxEventsPerComp: clamp(p.events.length - ri(0, 4), 1, 20),
      cities: Math.round(p.comps * rr(0.35, 0.85)),
      podiumTotal: totalPod, gold: g, silver: si, bronze: br,
      podiumWC: podiumByTier.WC, podiumCC: podiumByTier.CC, podiumNC: podiumByTier.NC,
      podiumLocal: Math.round(totalPod * 0.18), podiumOpen: podiumByTier.OP,
      most4th: ri(0, Math.max(1, Math.round(totalPod * 0.4))),
      top4NoPodium: ri(0, Math.max(1, Math.round(totalPod * 0.25))),
      goldEvents: Object.keys(goldEvSet).length, podiumEvents: Object.keys(podEvSet).length,
      podiumStreak: podStreak, bestYearGold: bestYearGold,
      podiumRate: round(totalPod / Math.max(1, p.comps * p.events.length / 4), 4),
      goldRate: round(g / Math.max(1, totalPod), 4),
      champConvert: round((podiumByTier.WC + podiumByTier.CC + podiumByTier.NC) / Math.max(1, totalPod), 4),
      yearsTop10: Math.round(p.months10 / 12), yearsTop100: Math.round(p.months100 / 12),
      coverage: p.events.length, dominance: round(p.months1 / Math.max(1, years.length), 3),
      lowCompHighAch: round(p.overall / Math.max(1, p.comps), 4),
      compDensity: round(p.comps / Math.max(1, years.length), 2),
      multiEventComp: round(p.events.length * p.m5 / 100, 2),
      dnf: Math.round(p.comps * p.events.length * rr(0.01, 0.09))
    };
    p.stats = st;
    return st;
  }

  /* ---------- 附加分（小奖励） ---------- */
  function bonus(p) {
    if (p.bonus) return p.bonus;
    const covGroups = ['blind', 'big', 'other', 'speed', 'fmc'];
    let groups = 0;
    covGroups.forEach(function (g) {
      const ids = (PRESET_GROUPS.filter(x => x.id === g)[0] || {}).ids || [];
      if (!ids.length) return;
      const all = ids.every(function (id) { return p.events.indexOf(id) >= 0; });
      if (all) groups++;
    });
    const cap = window.Params ? window.Params.get('covCap') : 0.05;
    const perG = window.Params ? window.Params.get('covGroup') : 0.02;
    const allB = window.Params ? window.Params.get('covAll') : 0.03;
    let raw = groups * perG + (p.events.length >= 17 ? allB : 0);
    const items = [
      { k: 'breadth', v: round(Math.pow(Math.max(p.m.m5, 1), 0.7) / 12, 2) },
      { k: 'coverage', v: round(Math.min(raw, cap) * 100, 2) },
      { k: 'lineCount', v: p.events.indexOf('333mbf') >= 0 ? round(41.4 / 100, 2) : 0 },
      { k: 'multi', v: round(Math.min(p.events.length, 17) / 17 * 1.6, 2) }
    ];
    const total = round(Math.min(items.reduce((a, b) => a + b.v, 0), cap * 100 + 2), 2);
    p.bonus = { items: items, total: total, cap: round((cap * 100), 2) };
    return p.bonus;
  }

  /* ---------- 世界 / 洲 / 地区排名 ---------- */
  function ranksOf(p) {
    if (p.ranks) return p.ranks;
    const cont = CONTINENT_OF[p.country], reg = REGION_OF[cont];
    const inC = ranked.filter(x => CONTINENT_OF[x.country] === cont);
    const inR = ranked.filter(x => REGION_OF[CONTINENT_OF[x.country]] === reg);
    const inN = ranked.filter(x => x.country === p.country);
    p.ranks = {
      world: p.rank,
      continent: inC.filter(x => x.overall > p.overall).length + 1,
      continentOf: inC.length,
      region: inR.filter(x => x.overall > p.overall).length + 1,
      regionOf: inR.length,
      nation: inN.filter(x => x.overall > p.overall).length + 1,
      nationOf: inN.length,
      contName: cont, regName: reg
    };
    return p.ranks;
  }

  /* ---------- WR 泳道（全部项目 + 单/均两套） ---------- */
  function makeLanes(evList, seedShift) {
    return evList.map(function (ev) {
      const segs = [];
      let y = 2004 + ((ri(0, 3) + seedShift) % 4);
      const top = PLAYERS.slice().sort(function (a, b) { return b.m.m1 - a.m.m1; }).slice(0, 40);
      while (y < 2026) {
        const holder = pick(top);
        const len = ri(1, 4);
        const end = Math.min(2026, y + len);
        segs.push({
          from: y, to: end, holder: holder.name, country: holder.country, id: holder.id,
          days: (end - y) * 365, color: 'hsl(' + holder.hue + ',58%,52%)'
        });
        y = end;
      }
      return { ev: ev, zh: EV[ev].zh, en: EV[ev].en, segs: segs };
    });
  }
  const ALL_EV = EVENTS.map(function (e) { return e.id; });
  const LANES = makeLanes(ALL_EV, 0);
  const LANES_AVG = makeLanes(ALL_EV, 2);

  /* 各项目专属里程碑（单项目筛选时只显示这些） */
  const EV_MILESTONES = {
    '333': [
      { year: 2004, zh: '三阶单次首次突破 10 秒', en: '3x3x3 single breaks 10 seconds' },
      { year: 2009, zh: '三阶单次首次突破 7 秒', en: '3x3x3 single breaks 7 seconds' },
      { year: 2013, zh: '三阶平均首次突破 7 秒', en: '3x3x3 average breaks 7 seconds' },
      { year: 2015, zh: '三阶单次首次突破 5 秒', en: '3x3x3 single breaks 5 seconds' },
      { year: 2019, zh: '三阶单次首次突破 4 秒', en: '3x3x3 single breaks 4 seconds' },
      { year: 2023, zh: '三阶平均首次突破 4 秒', en: '3x3x3 average breaks 4 seconds' }
    ]
  };
  function eventMilestones(ev) {
    if (EV_MILESTONES[ev]) return EV_MILESTONES[ev];
    const e = EV[ev];
    return [
      { year: 2003, zh: e.zh + ' 纳入 WCA 官方计时体系', en: e.en + ' joins the WCA timing system' },
      { year: 2009, zh: e.zh + ' 世界纪录进入新的阶段', en: e.en + ' world record enters a new stage' },
      { year: 2019, zh: e.zh + ' 成绩较十年前提升约 40%', en: e.en + ' times ~40% faster than a decade earlier' }
    ];
  }

  /* ---------- 国家聚合 ---------- */
  const NATIONS = {};
  PLAYERS.forEach(function (p) {
    if (!NATIONS[p.country]) NATIONS[p.country] = { iso: p.country, total: 0, count: 0, best: 0, bestName: '' };
    const n = NATIONS[p.country];
    n.total += p.overall; n.count++;
    if (p.overall > n.best) { n.best = p.overall; n.bestName = p.name; }
  });
  const NATION_LIST = Object.keys(NATIONS).map(function (k) {
    const n = NATIONS[k];
    return {
      iso: k, name: COUNTRIES[k], continent: CONTINENT_OF[k], region: REGION_OF[CONTINENT_OF[k]],
      total: round(n.total, 0), count: n.count, perCapita: round(n.total / n.count, 1),
      best: round(n.best, 1), bestName: n.bestName
    };
  }).sort((a, b) => b.total - a.total);

  /* ---------- 里程碑（更多事件） ---------- */
  const MILESTONES = [
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
    { year: 2025, zh: '年赛事数量首次突破 2000 场', en: 'More than 2,000 competitions in a single year' },
    { year: 2027, zh: '魔表项目计划停办', en: 'Clock scheduled for discontinuation' }
  ];

  /* ---------- 另类统计榜定义 ---------- */
  const BOARDS = {
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

  function board(kind, key, n, ev) {
    const list = PLAYERS.filter(function (p) { return !ev || p.events.indexOf(ev) >= 0; })
      .map(function (p) {
        const st = stats(p);
        return { p: p, v: st[key] };
      }).filter(function (d) { return typeof d.v === 'number' && isFinite(d.v); })
      .sort(function (a, b) { return b.v - a.v; }).slice(0, n || 15);
    return list;
  }

  window.MOCK = {
    events: EVENTS, EV: EV, presetGroups: PRESET_GROUPS,
    countries: COUNTRIES, countryList: CKEYS,
    continents: CONTINENTS, continentOf: CONTINENT_OF,
    regions: REGIONS, regionOf: REGION_OF,
    players: PLAYERS, ranked: ranked,
    weights: WEIGHTS, modKeys: MODKEYS,
    lanes: LANES, nations: NATION_LIST, milestones: MILESTONES,
    ensureDetail: ensureDetail, stats: stats, bonus: bonus, ranksOf: ranksOf,
    boards: BOARDS, board: board,
    meta: (function () {
      let totComps = 0, totWR = 0, totRec = 0, totPod = 0, totCountries = 0;
      PLAYERS.forEach(function (p) { totComps += p.comps; totWR += p.wr; const st = stats(p); totRec += st.recTotal; totPod += st.podiumTotal; });
      const seen = {}; PLAYERS.forEach(function (p) { seen[p.country] = 1; }); totCountries = Object.keys(seen).length;
      return { updated: '2026-10-17', exportVersion: '2.0.2', players: PLAYERS.length, events: EVENTS.length, comps: totComps, wr: totWR, records: totRec, podiums: totPod, nations: totCountries, demo: true };
    })(),
    years: (function () { const a = []; for (let y = 2003; y <= 2025; y++) a.push(y); return a; })(),
    lanesAvg: LANES_AVG,
    eventMilestones: eventMilestones,
    cumAt: function (p, y) {
      let s = 0;
      for (const k in p.yearly) { const yy = +k; if (yy <= y) s += p.yearly[k]; }
      return s;
    },
    actAt: function (p, y) {
      let s = 0;
      for (const k in p.yearly) { const yy = +k; if (yy <= y && yy > y - 3) s += p.yearly[k]; }
      return s;
    },
    /* 小数年份插值（支持月度 / 周度步进） */
    cumAtF: function (p, fy) {
      const ys = Object.keys(p.yearly).map(Number).sort(function (a, b) { return a - b; });
      const yi = Math.floor(fy), frac = fy - yi;
      let s = 0;
      ys.forEach(function (y) {
        if (y < yi) s += p.yearly[y];
        else if (y === yi) s += p.yearly[y];
        else if (y === yi + 1 && frac > 0) s += p.yearly[y] * frac;
      });
      return s;
    },
    actAtF: function (p, fy) {
      const ys = Object.keys(p.yearly).map(Number).sort(function (a, b) { return a - b; });
      const lo = fy - 3;
      let s = 0;
      ys.forEach(function (y) {
        const a = Math.max(y, lo), b = Math.min(y + 1, fy);
        const w = b - a;
        if (w > 0) s += p.yearly[y] * w;
      });
      return s;
    }
  };
})();

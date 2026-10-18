/* ============================================================
   params.js — 可配置评分参数（默认值 = 模型定稿 v1.0）
   所有分值都可在「评分原理说明」页修改，存 localStorage
   ============================================================ */
(function () {
  const KEY = 'goat-params-v1';

  /* 默认值：与 docs/GOAT模型_定稿_v1.0.html 完全一致 */
  const DEFAULTS = {
    // 七模块权重 β（ROC 序数定权推导，Σ=1）
    b1: 0.370, b2: 0.228, b3: 0.073, b4: 0.109, b5: 0.044, b6: 0.020, b7: 0.156,
    // 名次价值函数
    lambda: 1.10,          // V(r)=r^-λ
    lambdaD: 0.50,         // 统治力积分指数
    // 项目权重
    eta: 0.40,             // 深度因子强度
    xiCurrent: 1.00,       // 现行项目
    xiRetiring: 0.85,      // 即将停办（魔表 2027）
    xiRetired: 0.70,       // 已停办（脚拧/八板/十二板/旧规则多盲）
    // 纪录取值
    BR: 100,               // 纪录基准分
    kr: 0.15,              // 领先度 z 系数
    rhoR: 0.90,            // 纪录几何递减
    omegaH: 0.35,          // 持有时长分权重（0 = 关闭）
    kappa0: 0.60,          // 单次/平均基准比 T_sgl/T_avg
    gammaSA: 0.50,         // 完成率阻尼 γ
    upsilon: 0.50,         // 纪录线数补偿强度 K=(2/L)^υ
    GWR: 1.00,             // WR 层级系数
    GCC: 0.47,             // CR 层级系数（示例，实算由 V(r̄) 推出）
    GNR: 0.17,             // NR 层级系数（示例）
    // 领奖台
    BP: 100,               // 领奖台基准分
    kp: 0.10,              // 领奖台 z 系数
    mu: 1.50,              // 夺冠幅度加成
    kappa: 0.50,           // CSI 难度指数
    csiMin: 0.35, csiMax: 3.00,
    cWC: 1.60, cCC: 1.40, cNC: 1.25, cOP: 1.00,
    rhoP: 0.90,            // 锦标赛几何递减
    alphaO: 0.50,          // 公开赛幂律递减 i^-α
    fieldMin: 15,          // 人数门槛
    // 广度
    theta: 0.70,           // 广度奖励指数
    covGroup: 0.02,        // 每组全覆盖 +2%
    covAll: 0.03,          // 全项目 +3%
    covCap: 0.05,          // 附加分封顶 5%
    zFloor: -1.00,         // 全覆盖要求 z_e ≥ -1.0
    // 生涯厚度
    BL: 6.0, BC: 4.0,
    // 对战强度
    eloBase: 1400, eloScale: 900, halfLife: 18,
    // 合成
    thetaC: 0.60           // 综合总榜 Overall = C^0.6 · P^0.4
  };

  /* 参数元信息：分组 / 标签 / 范围 / 步长 / 所属模块锚点 */
  const META = [
    { g: 'weights', keys: ['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7'] },
    { g: 'rank', keys: ['lambda', 'lambdaD'] },
    { g: 'event', keys: ['eta', 'xiCurrent', 'xiRetiring', 'xiRetired'] },
    { g: 'm1', keys: ['BR', 'kr', 'rhoR', 'omegaH', 'kappa0', 'gammaSA', 'upsilon', 'GWR', 'GCC', 'GNR'] },
    { g: 'm2', keys: ['BP', 'kp', 'mu', 'kappa', 'csiMin', 'csiMax', 'cWC', 'cCC', 'cNC', 'cOP', 'rhoP', 'alphaO', 'fieldMin'] },
    { g: 'm5', keys: ['theta', 'covGroup', 'covAll', 'covCap', 'zFloor'] },
    { g: 'm6', keys: ['BL', 'BC'] },
    { g: 'm7', keys: ['eloBase', 'eloScale', 'halfLife'] },
    { g: 'combine', keys: ['thetaC'] }
  ];

  const RANGE = {
    b1: [0.01, 0.90, 0.001], b2: [0.01, 0.90, 0.001], b3: [0.005, 0.60, 0.001],
    b4: [0.005, 0.60, 0.001], b5: [0.005, 0.60, 0.001], b6: [0.001, 0.40, 0.001],
    b7: [0.005, 0.60, 0.001],
    lambda: [0.4, 2.2, 0.01], lambdaD: [0.1, 1.5, 0.01],
    eta: [0, 1, 0.01], xiCurrent: [0.3, 1, 0.01], xiRetiring: [0.3, 1, 0.01], xiRetired: [0.3, 1, 0.01],
    BR: [10, 300, 1], kr: [0, 0.5, 0.01], rhoR: [0.6, 1, 0.01], omegaH: [0, 1, 0.01],
    kappa0: [0.2, 1, 0.01], gammaSA: [0, 1.5, 0.01], upsilon: [0, 1, 0.01],
    GWR: [0.2, 1, 0.01], GCC: [0.05, 1, 0.01], GNR: [0.02, 1, 0.01],
    BP: [10, 300, 1], kp: [0, 0.4, 0.01], mu: [0, 4, 0.05], kappa: [0.1, 1.2, 0.01],
    csiMin: [0.05, 1, 0.01], csiMax: [1, 6, 0.05],
    cWC: [1, 3, 0.01], cCC: [1, 3, 0.01], cNC: [1, 3, 0.01], cOP: [0.5, 2, 0.01],
    rhoP: [0.6, 1, 0.01], alphaO: [0.1, 1.2, 0.01], fieldMin: [3, 40, 1],
    theta: [0.2, 1.4, 0.01], covGroup: [0, 0.1, 0.005], covAll: [0, 0.12, 0.005],
    covCap: [0.01, 0.2, 0.005], zFloor: [-3, 0, 0.1],
    BL: [0, 20, 0.5], BC: [0, 20, 0.5],
    eloBase: [800, 2000, 10], eloScale: [200, 1600, 10], halfLife: [3, 60, 1],
    thetaC: [0.2, 0.9, 0.01]
  };

  /* 每个参数的展示说明（zh / en） */
  const LABEL = {
    b1: ['M1 纪录 权重 β₁', 'M1 records weight'], b2: ['M2 大赛领奖台 权重 β₂', 'M2 championship weight'],
    b3: ['M3 公开赛领奖台 权重 β₃', 'M3 open weight'], b4: ['M4 统治力 权重 β₄', 'M4 dominance weight'],
    b5: ['M5 广度 权重 β₅', 'M5 breadth weight'], b6: ['M6 生涯厚度 权重 β₆', 'M6 career weight'],
    b7: ['M7 对战强度 权重 β₇', 'M7 head-to-head weight'],
    lambda: ['名次价值指数 λ', 'Place-value exponent λ'], lambdaD: ['统治力积分指数 λ_D', 'Dominance exponent λ_D'],
    eta: ['深度因子强度 η', 'Depth factor η'], xiCurrent: ['现行项目状态系数', 'Current-event status'],
    xiRetiring: ['即将停办（魔表）', 'Discontinued soon (Clock)'], xiRetired: ['已停办项目', 'Discontinued events'],
    BR: ['纪录基准分 B_R', 'Record base score'], kr: ['纪录领先度系数 k_r', 'Record dominance k_r'],
    rhoR: ['纪录递减 ρ_R', 'Record decay ρ_R'], omegaH: ['持有时长分权重 ω_H', 'Holding-duration weight'],
    kappa0: ['单次/平均基准比 κ₀', 'Single/average base ratio'], gammaSA: ['完成率阻尼 γ', 'Completion damping γ'],
    upsilon: ['纪录线数补偿 υ', 'Line-count compensation υ'],
    GWR: ['WR 层级系数 G_WR', 'WR tier G_WR'], GCC: ['CR 层级系数 G_CR', 'CR tier G_CR'], GNR: ['NR 层级系数 G_NR', 'NR tier G_NR'],
    BP: ['领奖台基准分 B_P', 'Podium base score'], kp: ['领奖台领先度 k_p', 'Podium dominance k_p'],
    mu: ['夺冠幅度加成 μ', 'Winning-margin bonus μ'], kappa: ['赛事强度指数 κ', 'Field-strength exponent κ'],
    csiMin: ['赛事强度下限', 'Field-strength floor'], csiMax: ['赛事强度上限', 'Field-strength ceiling'],
    cWC: ['世锦赛加成', 'World champs bonus'], cCC: ['洲锦赛加成', 'Continental bonus'],
    cNC: ['国家赛加成', 'National bonus'], cOP: ['公开赛加成', 'Open bonus'],
    rhoP: ['锦标赛递减 ρ_P', 'Championship decay ρ_P'], alphaO: ['公开赛幂律指数 α_O', 'Open power-law α_O'],
    fieldMin: ['人数门槛', 'Field-size floor'],
    theta: ['广度奖励指数 θ', 'Breadth exponent θ'], covGroup: ['每组全覆盖奖励', 'Per-group coverage bonus'],
    covAll: ['全项目奖励', 'Full-coverage bonus'], covCap: ['附加分封顶', 'Bonus cap'],
    zFloor: ['全覆盖 z 下限', 'Coverage z floor'],
    BL: ['年限系数 B_L', 'Years coefficient'], BC: ['场次系数 B_C', 'Competitions coefficient'],
    eloBase: ['Elo 基准分', 'Elo base'], eloScale: ['Elo 缩放', 'Elo scale'], halfLife: ['Elo 半衰期（月）', 'Elo half-life (months)'],
    thetaC: ['综合总榜生涯指数 θ_C', 'Combined career exponent']
  };

  const GROUP_TITLE = {
    weights: ['模块权重 β', 'Module weights β'],
    rank: ['名次价值函数', 'Place value'],
    event: ['项目权重与状态系数', 'Event weights'],
    m1: ['M1 纪录参数', 'M1 record parameters'],
    m2: ['M2 / M3 领奖台参数', 'M2 / M3 podium parameters'],
    m5: ['M5 广度与附加分', 'M5 breadth and bonuses'],
    m6: ['M6 生涯厚度', 'M6 career volume'],
    m7: ['M7 对战强度', 'M7 head-to-head'],
    combine: ['三榜合成', 'Ranking combination']
  };

  const PRESETS = {
    roc: ['默认（序数定权 ROC）', 'Default (ROC)'],
    records: ['纪录优先', 'Records first'],
    champs: ['大赛优先', 'Championships first'],
    balanced: ['均衡型', 'Balanced'],
    h2h: ['对战强度优先', 'Head-to-head first']
  };
  const PRESET_VAL = {
    roc: null,
    records: { b1: 0.52, b2: 0.20, b3: 0.05, b4: 0.09, b5: 0.03, b6: 0.01, b7: 0.10 },
    champs: { b1: 0.24, b2: 0.34, b3: 0.06, b4: 0.12, b5: 0.04, b6: 0.02, b7: 0.18 },
    balanced: { b1: 0.20, b2: 0.20, b3: 0.14, b4: 0.14, b5: 0.12, b6: 0.10, b7: 0.10 },
    h2h: { b1: 0.22, b2: 0.16, b3: 0.08, b4: 0.16, b5: 0.05, b6: 0.02, b7: 0.31 }
  };

  let cur = clone(DEFAULTS);
  let wDirty = false;

  function clone(o) { const r = {}; Object.keys(o).forEach(function (k) { r[k] = o[k]; }); return r; }
  function load() {
    try {
      const s = localStorage.getItem(KEY);
      if (s) {
        const o = JSON.parse(s);
        Object.keys(DEFAULTS).forEach(function (k) { if (typeof o[k] === 'number' && !isNaN(o[k])) cur[k] = o[k]; });
      }
    } catch (e) { }
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(cur)); } catch (e) { } }
  /** 归一化：把七个 β 按比例缩放到 Σ=1（仅在预置方案与读取时调用，避免编辑时相互挤压） */
  function normalize() {
    const s = cur.b1 + cur.b2 + cur.b3 + cur.b4 + cur.b5 + cur.b6 + cur.b7;
    if (s <= 0) return;
    ['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7'].forEach(function (k) { cur[k] = Math.round(cur[k] / s * 10000) / 10000; });
    wDirty = false;
  }
  function set(k, v) {
    if (typeof DEFAULTS[k] === 'undefined') return;
    cur[k] = v;
    if (k[0] === 'b' && k.length === 2) wDirty = true;
    save();
  }
  function reset() { cur = clone(DEFAULTS); wDirty = false; save(); }
  function applyPreset(name) {
    const v = PRESET_VAL[name];
    if (v) Object.keys(v).forEach(function (k) { cur[k] = v[k]; });
    else { cur = clone(DEFAULTS); }
    normalize(); save();
  }
  /** 实际使用的权重：若用户改过任一 β，则先按比例归一化，保证 Σ=1 且相对关系不变 */
  function weights() {
    if (wDirty) normalize();
    return { m1: cur.b1, m2: cur.b2, m3: cur.b3, m4: cur.b4, m5: cur.b5, m6: cur.b6, m7: cur.b7 };
  }

  /* 综合分：Overall = C^θ · P^(1-θ) */
  function overall(c, p) {
    return Math.pow(Math.max(c, 0.01), cur.thetaC) * Math.pow(Math.max(p, 0.01), 1 - cur.thetaC);
  }
  /* 生涯 / 巅峰加权分（0–100 → ×10 成 0–1000） */
  function weighted(mods) {
    const w = weights(); let s = 0;
    ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7'].forEach(function (k) { s += w[k] * (mods[k] || 0); });
    return s * 10;
  }

  load();

  window.Params = {
    get: function (k) { return cur[k]; },
    all: function () { return cur; },
    set: set, reset: reset, save: save,
    defaults: DEFAULTS, meta: META, range: RANGE, label: LABEL,
    groupTitle: GROUP_TITLE, presets: PRESETS, applyPreset: applyPreset,
    weights: weights, weighted: weighted, overall: overall, normalize: normalize
  };
})();

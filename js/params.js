/* ============================================================
   params.js — 可配置评分参数（默认值 = 模型定稿 v1.0）
   所有分值都可在「评分原理说明」页修改，存 localStorage
   ============================================================ */
(function () {
  const KEY = 'goat-params-v1';

  /* 默认值：当前模型 = 六维加权（详见评分原理说明页）。
     旧七模块（含 M7 对战强度）的参数全部停用：仅保留键名以免历史读取报错，
     但不再出现在参数面板、也不参与任何计算。 */
  const DEFAULTS = {
    // 六维权重 w（Σ=1，M1 纪录持有为主币，M3 大赛表现次之，M5 最低）
    b1: 0.42, b2: 0.14, b3: 0.22, b4: 0.10, b5: 0.04, b6: 0.08, b7: 0,
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

  /* 参数元信息：面板只暴露六维权重（其余旧参数已停用，不再提供调节入口） */
  const META = [
    { g: 'weights', keys: ['b1', 'b2', 'b3', 'b4', 'b5', 'b6'] }
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
    b1: ['M1 纪录持有 权重 w₁', 'M1 record ownership weight'], b2: ['M2 领奖台 权重 w₂', 'M2 podium weight'],
    b3: ['M3 大赛表现 权重 w₃', 'M3 championship performance weight'], b4: ['M4 统治力 权重 w₄', 'M4 dominance weight'],
    b5: ['M5 当前排名 权重 w₅', 'M5 current ranking weight'], b6: ['M6 突破幅度 权重 w₆', 'M6 breakthrough margin weight'],
    b7: ['（已停用）旧 M7 对战强度', '(retired) old M7 head-to-head'],
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
    weights: ['六维权重 w', 'Six-dimension weights w']
  };

  const PRESETS = {
    roc: ['默认（六维定稿权重）', 'Default'],
    holding: ['纪录持有优先', 'Record ownership first'],
    podium: ['领奖台优先', 'Podiums first'],
    balanced: ['均衡型', 'Balanced'],
    dominance: ['统治力优先', 'Dominance first']
  };
  const PRESET_VAL = {
    roc: null,
    holding: { b1: 0.42, b2: 0.20, b3: 0.10, b4: 0.14, b5: 0.06, b6: 0.08 },
    podium: { b1: 0.22, b2: 0.36, b3: 0.12, b4: 0.14, b5: 0.08, b6: 0.08 },
    balanced: { b1: 0.18, b2: 0.18, b3: 0.16, b4: 0.16, b5: 0.16, b6: 0.16 },
    dominance: { b1: 0.20, b2: 0.18, b3: 0.08, b4: 0.34, b5: 0.12, b6: 0.08 }
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
  /** 归一化：把六个 w 按比例缩放到 Σ=1（仅在预置方案与读取时调用，避免编辑时相互挤压） */
  function normalize() {
    const s = cur.b1 + cur.b2 + cur.b3 + cur.b4 + cur.b5 + cur.b6;
    if (s <= 0) return;
    ['b1', 'b2', 'b3', 'b4', 'b5', 'b6'].forEach(function (k) { cur[k] = Math.round(cur[k] / s * 10000) / 10000; });
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
  /** 实际使用的权重：六维（若用户改过任一 w，则先按比例归一化，保证 Σ=1 且相对关系不变） */
  function weights() {
    if (wDirty) normalize();
    return { m1: cur.b1, m2: cur.b2, m3: cur.b3, m4: cur.b4, m5: cur.b5, m6: cur.b6 };
  }

  /* 综合分：六维总分 t = Σ_d w_d · s_d（维度分已归一，榜首 = 1000）。
     旧口径的 C^θ·P^(1−θ) 随七模块一并停用，此处仅保留函数签名兼容。 */
  function overall(c, p) {
    return Math.max(c || 0, 0) + Math.max(p || 0, 0);
  }
  /* 生涯 / 巅峰加权分：两档已合并为同一套六维口径，这里按六维权重求和。
     注意：维度分自 2026-10-26 起已在 ETL 侧放大到「满分 1000」，这里**不再**额外乘 10
     （旧版的 ×10 是给 0–100 刻度做的补偿，留着会让调用方拿到 10 倍虚高值）。 */
  function weighted(mods) {
    const w = weights(); let s = 0;
    ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'].forEach(function (k) { s += w[k] * (mods[k] || 0); });
    return s;
  }

  /* ---------------- 六维配色（可在评分原理页自定义） ---------------- */
  const CKEY = 'goat-modcolors-v1';
  /* 与 css/style.css 的浅色主题 --m1…--m6 保持一致：
     这里是「配色自定义」的初始值 / 恢复默认值，两边不一致时恢复默认会跳到另一套颜色。 */
  const CDEF = {
    m1: '#ed58a9', m2: '#e54b52', m3: '#ffa838', m4: '#20b561',
    m5: '#008fd2', m6: '#a167f1'
  };
  let ccur = null;
  function loadColors() {
    ccur = {};
    Object.keys(CDEF).forEach(function (k) { ccur[k] = CDEF[k]; });
    try {
      const s = localStorage.getItem(CKEY);
      if (s) { const o = JSON.parse(s); Object.keys(CDEF).forEach(function (k) { if (typeof o[k] === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(o[k])) ccur[k] = o[k]; }); }
    } catch (e) { }
    return ccur;
  }
  function colors() { return ccur || loadColors(); }
  function setColor(k, v) {
    if (!CDEF[k] || !/^#[0-9a-fA-F]{3,8}$/.test(v)) return;
    colors(); ccur[k] = v;
    try { localStorage.setItem(CKEY, JSON.stringify(ccur)); } catch (e) { }
    applyColors();
  }
  function resetColors() { ccur = null; loadColors(); try { localStorage.removeItem(CKEY); } catch (e) { } applyColors(); }
  /* 把配色写到 <html> 的内联样式上。
     ⚠ 只有**用户真的自定义过**（localStorage 里有记录）才写：否则每次启动都会把
     css 里浅色 / 深色两套主题的 --m1…--m6 一起盖掉 —— 深色主题永远拿不到深色那一套，
     主题切换后颜色也不会跟着变。没有自定义时反过来把内联值清掉，交还给 CSS。 */
  function hasCustomColors() {
    try { return !!localStorage.getItem(CKEY); } catch (e) { return false; }
  }
  function applyColors() {
    if (typeof document === 'undefined' || !document.documentElement) return;
    const root = document.documentElement;
    if (!hasCustomColors()) {
      Object.keys(CDEF).forEach(function (k) { root.style.removeProperty('--' + k); });
      return;
    }
    const c = colors();
    Object.keys(c).forEach(function (k) { root.style.setProperty('--' + k, c[k]); });
  }

  load();
  loadColors();

  window.Params = {
    get: function (k) { return cur[k]; },
    all: function () { return cur; },
    set: set, reset: reset, save: save,
    defaults: DEFAULTS, meta: META, range: RANGE, label: LABEL,
    groupTitle: GROUP_TITLE, presets: PRESETS, applyPreset: applyPreset,
    weights: weights, weighted: weighted, overall: overall, normalize: normalize,
    colors: colors, setColor: setColor, resetColors: resetColors, applyColors: applyColors, colorDefaults: CDEF,
    hasCustomColors: hasCustomColors
  };
})();

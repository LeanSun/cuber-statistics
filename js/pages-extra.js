/* ============================================================
   pages-extra.js — 动态可视化 / 另类统计 / 评分原理说明
   ============================================================ */
(function () {
  const t = window.I18N, U = window.U, M = window.MOCK, Ic = window.Icons, Pm = window.Params;
  const P = window.P || (window.P = {});
  const MOD = P.util.MOD, MODC = P.util.MODC;
  const esc = U.esc;
  const { avatar, flag, playerLink, modName, ecBox, scoreOf, infoTip, evName, contName, countryName } = P.util;

  /* 国家配色：取**该国国旗的真实主色**（2026-10-30 全量 169 国，覆盖全部有选手的国家/地区）。
     方案：以各面国旗的主色为基准，整体**提亮到舒适中明度**（亮度 +12%，区间 0.42–0.64），
     解决此前「整体加深导致偏暗、观感沉」的问题；美国固定为 #0A3161（用户指定，不提亮）。
     竞速图/泳道图按国籍取色，国旗本身另加轻微阴影描边；条内文字按色条亮度自动取黑/白。
     可在「参数设置 → 国家配色」逐国自定义（localStorage 持久化，用户覆盖优先）。 */
  const CCOL_KEY = 'goat-countrycolors-v1';
  const COUNTRY_COLORS = {
    /* —— 东亚/东南亚/南亚/中亚/西亚 —— */
    AE: '#FF2424', AF: '#00D65F', AM: '#FF172A',
    AZ: '#00C2F9', BD: '#00D69E', BH: '#EE2E44',
    BN: '#FFD632', BT: '#FFA83D', CN: '#F1513A',
    GE: '#EE2748', HK: '#F1513A', ID: '#EE2E44',
    IL: '#004BF5', IN: '#E0A366', IQ: '#EE2E44',
    IR: '#2ED154', JO: '#00D66B', JP: '#F9003C',
    KG: '#FF172A', KH: '#0047DD', KR: '#DB5D67',
    KW: '#00D66B', KZ: '#2DC6FF', LA: '#EE2E44',
    LB: '#E36368', LK: '#C21D50', MM: '#FFD83C',
    MN: '#EE2748', MO: '#00D851', MV: '#EF3053',
    MY: '#0052D6', NP: '#EE4062', OM: '#EE2E44',
    PH: '#004CE5', PK: '#03D35B', PS: '#EE2E44',
    QA: '#BF1D4E', SA: '#00D669', SG: '#D96E75',
    SY: '#EE2E44', TH: '#DA2141', TJ: '#EE2E44',
    TL: '#E75652', TM: '#00D660', TR: '#F63440',
    TW: '#FF3C3C', UZ: '#00CDF2', VN: '#E7534D',
    YE: '#EE2E44',
    /* —— 欧洲 —— */
    AD: '#0049D6', AL: '#DC6364', AT: '#DD6A73',
    BA: '#0032D6', BE: '#F63440', BG: '#00D69D',
    BY: '#D85F69', CH: '#E6564B', CY: '#9EBE55',
    CZ: '#1967BD', DE: '#FF1B1B', DK: '#F11E47',
    EE: '#0C93FF', ES: '#E01C24', FI: '#0059D6',
    FR: '#0075E1', GB: '#0243D4', GR: '#117DE8',
    HR: '#EE2748', HU: '#DB675D', IE: '#1ED184',
    IS: '#0372D8', IT: '#00D667', LI: '#0049D6',
    LT: '#00D689', LU: '#DD6A73', LV: '#C6454F',
    MC: '#EE2E44', MD: '#0063E2', ME: '#EE2748',
    MK: '#EE2748', MT: '#EB354B', NL: '#DD2A39',
    NO: '#F01340', PL: '#EE4062', PT: '#00D600',
    RO: '#0049D6', RS: '#EE2748', RU: '#004EE3',
    SE: '#0091E4', SI: '#0080E1', SK: '#0F83DD',
    SM: '#14B9FF', UA: '#0079F8', XK: '#2B6CAB',
    /* —— 北美 —— */
    AG: '#EE2E44', BB: '#0040D6', BS: '#1ED6FF',
    BZ: '#0072D8', CA: '#E6564B', CR: '#0049D6',
    CU: '#003FD6', DO: '#0062D6', GD: '#EE2E44',
    GT: '#0047DD', HN: '#0D94FF', HT: '#002CDC',
    JM: '#00D851', KN: '#00DB65', KP: '#036CDE',
    LC: '#0049D6', MX: '#00D692', NI: '#0487FF',
    PA: '#EE2E44', PR: '#FF2B2B', SV: '#145EE7',
    US: '#0A3161',
    /* —— 南美 —— */
    AR: '#8CA4BA', BO: '#E6564B', BR: '#00D952',
    CL: '#E6564B', CO: '#EFD257', EC: '#EFD258',
    GY: '#00DB65', PE: '#F03648', PY: '#E6564B',
    SR: '#33DD53', TT: '#EE2E44', UY: '#86A5C0',
    VE: '#EFD258',
    /* —— 非洲 —— */
    AO: '#EE2E44', BW: '#13BDFF', CD: '#3D9EFF',
    CG: '#00DB85', CI: '#FF9D35', CM: '#00D6A5',
    CV: '#0052D6', DZ: '#00D69E', EG: '#EE2E44',
    ER: '#53BF74', ET: '#0ACC47', GH: '#EE2E44',
    KE: '#F80000', LS: '#0032D6', LY: '#2ED154',
    MA: '#DB4B50', MG: '#DF6E67', MR: '#00E579',
    MU: '#DC6B75', MW: '#EE2F49', MZ: '#00D65A',
    NA: '#0047DD', NG: '#00D681', RW: '#145EE7',
    SD: '#EE2E44', SN: '#00D665', SO: '#7BA0CC',
    TG: '#00D75F', TN: '#FF2537', TZ: '#00E381',
    UG: '#FF172A', ZA: '#00D687', ZM: '#00DA79',
    ZW: '#00D665',
    /* —— 大洋洲 —— */
    AU: '#003ED6', FJ: '#86A5C0', NZ: '#003ED6',
    PG: '#EE2E44', TO: '#EE2748', WS: '#EE2E44',
  };
  /* YYYYMMDD → YYYY-MM-DD（泳道清单用；非法值统一显示为「至今」） */
  function laneDate(dn) {
    const s = String(dn == null ? '' : dn);
    if (s.length !== 8) return t.isEn() ? 'ongoing' : '至今';
    return s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8);
  }

  /* ---- 国家配色自定义（与模块配色同一套交互，评分原理页可改） ---- */
  let ccCustom = null;
  function loadCCustom() {
    if (ccCustom) return ccCustom;
    ccCustom = {};
    try {
      const s = localStorage.getItem(CCOL_KEY);
      if (s) { const o = JSON.parse(s); Object.keys(o).forEach((k) => { if (/^#[0-9a-fA-F]{3,8}$/.test(o[k])) ccCustom[k] = o[k]; }); }
    } catch (e) { }
    return ccCustom;
  }
  function countryColor(iso) {
    const k = String(iso || '').toUpperCase();
    const cu = loadCCustom();
    if (cu[k]) return cu[k];
    if (COUNTRY_COLORS[k]) return COUNTRY_COLORS[k];
    return 'hsl(' + U.hue(iso || '??') + ',55%,50%)';
  }
  P.countryColorDefaults = COUNTRY_COLORS;
  P.countryColor = countryColor;
  P.hasCustomCountryColor = function (k) { return !!loadCCustom()[String(k || '').toUpperCase()]; };
  P.setCountryColor = function (k, v) {
    const key = String(k || '').toUpperCase();
    if (!/^#[0-9a-fA-F]{3,8}$/.test(v)) return false;
    const cu = loadCCustom();
    if (COUNTRY_COLORS[key] && v.toLowerCase() === COUNTRY_COLORS[key].toLowerCase()) delete cu[key];
    else cu[key] = v;
    try {
      if (Object.keys(cu).length) localStorage.setItem(CCOL_KEY, JSON.stringify(cu));
      else localStorage.removeItem(CCOL_KEY);
    } catch (e) { }
    return true;
  };
  P.resetCountryColors = function () { ccCustom = {}; try { localStorage.removeItem(CCOL_KEY); } catch (e) { } };

  /* ================= 动态可视化 ================= */
  /* 视图：分数竞速图 / 纪录持有图（名次变迁图已移除） */
  const VIEWS = [['race', 'tl.view.race', 'speed'], ['lane', 'tl.view.lane', 'record']];
  let TL_MS = M.milestones; /* 当前单项筛选下的里程碑集合（供图表标线使用） */
  P.tlIdxToInfo = tlIdxToInfo; P.tlSlider = tlSlider; /* 供 app.js 滑块 / 播放使用 */

  /* 动画速率：可自定义「时间跳跃（天/秒）/ 动画时长 / 刷新间隔」，持久化到 localStorage
     每项同时提供滑杆与数字输入框：滑杆用于快速手调，数字框用于精确输入（如 45 天/秒）。 */
  const RATE_KEY = 'goat-tlrate-v1';
  /* 默认值按「看得清又不拖沓」来定。
     ★ jump（时间跳跃）：2026-10-31 起默认 **60 天/秒**（原 30，约 2 分钟多一点走完 23 年）；
       旧用户 localStorage 里存的是 30，若原值等于旧默认就静默升到 60（只升级没动过的人），
       手动调过速率的人保持自己的值。
     ★ anim（换位补间）：2026-11-01 用户指定默认 **100ms**（原 200）；更短的补间让
       名次更替看起来是「跟上节奏的滑动」，而不是慢半拍。
     ★ fps（重绘间隔）：2026-11-01 用户指定默认 **20ms**（原 100）。播放走 rAF 逐帧重绘，
       每 fps 毫秒才真正重绘一次图表（0 = 不节流、逐帧重绘）。20ms ≈ 50 帧/秒，
       配合 100ms 补间，视觉上是连续的；低端机器调大即可降负载。 */
  const RATE_DEF = { jump: 60, anim: 100, fps: 20 };
  /* 迁移标记：旧预设值 → 新预设值（只升级「仍是旧默认」的人，不覆盖手调过的） */
  const RATE_OLD_DEF = { jump: 30, anim: 200, fps: 100 };
  const RATE_META = {
    jump: { min: 1, max: 365, step: 1, unit: () => (t.isEn() ? 'days/s' : ' 天/秒') },
    anim: { min: 0, max: 2500, step: 20, unit: () => 'ms' },
    fps: { min: 0, max: 1000, step: 20, unit: () => 'ms' }
  };
  function clampRate(k, v) {
    const mt = RATE_META[k]; if (!mt) return v;
    let n = parseInt(v, 10);
    if (isNaN(n)) n = RATE_DEF[k];
    return Math.max(mt.min, Math.min(mt.max, n));
  }
  function loadRate() {
    try {
      const o = JSON.parse(localStorage.getItem(RATE_KEY));
      if (o) {
        const r = Object.assign({}, RATE_DEF, o);
        Object.keys(RATE_META).forEach((k) => { r[k] = clampRate(k, r[k]); });
        /* 预设升级：只把「仍然停在旧预设」的那几项升到新预设，不覆盖手调过的值。
           2026-10-31 jump 30→60；2026-11-01 anim 200→100、fps 100→20。 */
        let migrated = false;
        Object.keys(RATE_OLD_DEF).forEach((k) => {
          if (o[k] === RATE_OLD_DEF[k]) { r[k] = RATE_DEF[k]; migrated = true; }
        });
        if (migrated) saveRate(r);
        return r;
      }
    } catch (e) { }
    return Object.assign({}, RATE_DEF);
  }
  function saveRate(o) { try { localStorage.setItem(RATE_KEY, JSON.stringify(o)); } catch (e) { } }
  P.tlRate = function () { return loadRate(); };
  P.tlRateMeta = RATE_META;
  P.tlClampRate = clampRate;

  /* 自定义重大事件：localStorage 持久化 + 与内置合并 */
  const MS_KEY = 'goat-milestones-custom';
  function loadCustomMs() {
    try { var a = JSON.parse(localStorage.getItem(MS_KEY)); return Array.isArray(a) ? a : []; }
    catch (e) { return []; }
  }
  /* 内置事件也可删除：把被删掉的内置事件键（日期|标题）记在这里，
     「恢复内置事件」时清空即可。此前只能删除自己新增的事件。 */
  const MS_HIDE_KEY = 'goat-milestones-hidden';
  function msKeyOf(m) { return String(m.date || m.year) + '|' + String(m.zh || m.en || ''); }
  /* 事件标题的存储格式是「项目名 · 内容」。编辑时要把项目名前缀剥掉再回填输入框，
     否则点「保存修改」时会再拼一次前缀，得到「三阶 · 三阶 · 内容」。
     抽成纯函数便于冒烟测试直接覆盖这一条。 */
  P.msSplitText = function (zh, evId) {
    const s = String(zh || '');
    if (!evId || !M.EV || !M.EV[evId]) return s;
    const evTxt = t.isEn() ? (M.EV[evId].en || M.EV[evId].zh) : (M.EV[evId].zh || M.EV[evId].en);
    if (!evTxt) return s;
    const pre = evTxt + ' · ';
    return s.indexOf(pre) === 0 ? s.slice(pre.length) : s;
  };
  function loadHiddenMs() {
    try { var a = JSON.parse(localStorage.getItem(MS_HIDE_KEY)); return Array.isArray(a) ? a : []; }
    catch (e) { return []; }
  }
  function saveHiddenMs(a) { try { localStorage.setItem(MS_HIDE_KEY, JSON.stringify(a)); } catch (e) { } }
  P.msHiddenCount = function () { return loadHiddenMs().length; };
  P.msUnhideAll = function () { saveHiddenMs([]); };
  P.msKeyOf = msKeyOf;
  /* 内置事件也可「编辑」（时间 / 项目 / 文字）：把覆盖写进这张映射，
     键为事件原始键（日期|标题），渲染时套用即可，不影响原数据。 */
  const MS_EDIT_KEY = 'goat-milestones-edit';
  function loadEditedMs() {
    try { var o = JSON.parse(localStorage.getItem(MS_EDIT_KEY)); return (o && typeof o === 'object') ? o : {}; }
    catch (e) { return {}; }
  }
  P.loadEditedMs = loadEditedMs;
  function saveCustomMs(a) { try { localStorage.setItem(MS_KEY, JSON.stringify(a)); } catch (e) { } }
  function msSample() {
    return [
      { year: 2015, zh: '三阶单次首次突破 5 秒', en: '3x3 single breaks 5 seconds' },
      { year: 2019, zh: '你自定义的某个里程碑', en: 'Your custom milestone' }
    ];
  }
  P.msSample = msSample;

  /* 事件轨道高亮：播放经过的事件点亮 */
  P.tlHighlightRail = function (fy) {
    const rail = document.getElementById('msRail');
    if (!rail || !rail.querySelectorAll) return;
    const items = rail.querySelectorAll('.ms-rail-item');
    Array.prototype.forEach.call(items, function (b) {
      const d = b.getAttribute('data-msjump') || '';
      const m = d.match(/^(\d{4})(?:-(\d{2}))?/);
      if (!m) return;
      const y = +m[1] + ((+m[2] || 1) - 1) / 12;
      b.classList.toggle('on', y <= fy + 0.02);
    });
  };

  P.timeline = function (state) {
    const view = (state.tlView === 'rank') ? 'race' : (state.tlView || 'race');
    const mode = 'cumulative';
    const step = 'day';
    const metric = 'overall';
    /* 生效的项目集合必须**先**算出来 —— 时间轴终点依赖它（选中停办项目时终点提前）。
       以前这段在拼完滑块之后才算，于是再也改不了已经渲染出去的上限。 */
    const evSel0 = state.evSel || [];
    let evsBox = evSel0.slice();
    if (!evsBox.length && state.group && state.group !== 'all' && !M.EV[state.group]) {
      const g0 = M.presetGroups.filter(function (x) { return x.id === state.group; })[0];
      if (g0 && g0.ids) evsBox = g0.ids.slice();
    } else if (!evsBox.length && state.group && M.EV[state.group]) {
      evsBox = [state.group];
    }
    const tlEnd = tlEndFromEvs(evsBox);
    /* 终点提前后，原来停在 2026 的游标要一起夹回来，否则会出现「时间轴到底了但图上写着 2026」 */
    const fy = Math.min(state.tlFy || tlEnd, tlEnd);
    if (state.tlFy != null && state.tlFy > tlEnd) state.tlFy = tlEnd;
    const sl = tlSlider(step, fy);
    const rate = loadRate();

    /* 2026-11-01 用户要求删掉页面顶部那段说明文字（「历史地位随时间的推移而演变…」）；
       第五轮又要求把两个视图各自的说明（.tl-desc）也删掉，图表直接贴着控件开始。 */
    let h = '<div class="page-head reveal"><h1>' + esc(t('tl.title')) + '</h1></div>';

    /* 纪录范围（大洲 cont:* / 国家 ISO2 / 细分地区 reg:*）必须在拼筛选条之前算出来：
       登顶时长徽标就在这一行里，文案要跟着范围走（世界 / 亚洲 / 中国 …）。
       细分地区在 state.region（reg:*）里 —— 以前这里只读 state.geo，
       于是选了「东亚」这类地区筛选时图表完全没反应。 */
    const geoRegion = (state.geo && state.geo.indexOf('cont:') === 0) ? state.geo.slice(5) : (state.region || '');
    const geoCountry = (state.geo && state.geo.indexOf('cont:') !== 0 && state.geo) ? state.geo : '';

    h += '<div class="card reveal">';
    h += '<div class="row tl-top">';
    /* ★ 2026-11-02 第二轮（用户要求）：视图切换按钮上方补一个可见标签「图表切换」，
       与右侧「六维筛选」那张 .flabel 水平对齐。以前这里是个 visibility:hidden 的占位符
       （只为把两种视图的行高撑成一样），现在它有真名字了，对齐与等高两件事一起解决。 */
    h += '<div class="fgroup"><span class="flabel">' + esc(t('tl.viewLabel')) + '</span><div class="seg" id="tlViewSeg">';
    VIEWS.forEach(function (v) {
      h += '<button data-tlview="' + v[0] + '" class="' + (view === v[0] ? 'on' : '') + '">' + Ic.glyph(v[2]) + ' ' + esc(t(v[1])) + '</button>';
    });
    h += '</div></div>';
    /* 六维单独筛选（仅竞速图）：总分 / M1…M6。选中某一维后，竞速图按该维度分比拼。 */
    if (view === 'race') {
      const dimCur = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'].indexOf(state.tlDim) >= 0 ? state.tlDim : '';
      h += '<div class="fgroup"><span class="flabel">' + esc(t('tl.dimLabel')) + '</span>' +
        '<div class="seg dim-seg" id="tlDimSeg" title="' + esc(t('tl.dimTip')) + '" role="group" aria-label="' + esc(t('tl.dimLabel')) + '">';
      h += '<button data-tldim="" class="' + (!dimCur ? 'on' : '') + '">' + esc(t('f.all')) + '</button>';
      ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'].forEach(function (k) {
        h += '<button data-tldim="' + k + '" class="' + (dimCur === k ? 'on' : '') + '">' + esc(t('m' + k[1] + '.name')) + '</button>';
      });
      h += '</div></div>';
    }
    h += '<span class="spacer"></span>';
    /* 登顶时长徽标（2026-11-01 用户要求，第五轮再挪到**整行最右端**）：常驻显示。
       内容是「某选手登顶（当前榜单第一）已持续多久」，随筛选范围（世界 / 亚洲 / 中国 …，
       女子再加「女子」）和播放时间实时更新；单击在「xx 天 / xx 年 xx 个月 xx 天」之间切换。
       放在 .spacer 之后 + margin-left:auto，无论这一行换不换行都贴住右边界。
       没算完时不再整块隐藏（那样会跳一下布局），而是显示占位「—」，由 tlCrownPaint 换成真值。 */
    if (view === 'race') {
      h += '<div class="tl-crown" id="tlCrown" data-st="pending">' +
        '<button type="button" class="tl-crown-btn" id="tlCrownBtn" title="' + esc(t('tl.crown.tip')) + '">' +
        '<span class="tl-crown-ic" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M3.2 8.4l4.6 3.4L12 4.2l4.2 7.6 4.6-3.4-1.7 9.9H4.9L3.2 8.4z"/></svg></span>' +
        '<img class="tl-crown-flag" alt="" hidden>' +
        '<span class="tl-crown-tx">' +
        /* 姓名两层结构：外层定宽 + 裁剪，内层放两份同样的文字并做循环平移（跑马灯）。
           短名只有第一份显示（.cn-b 默认 display:none），行为与普通文本完全一致；
           名字长到装不下时，tlCrownPaint 给外层加 .run，第二份显示、内层开始滚动。
           两份之间靠 .cn-a/.cn-b 各自相同的 padding-right 制造间隔，平移 -50%
           正好越过「一份文字 + 一个间隔」，接缝处不会闪。 */
        '<b class="tl-crown-name">' +
        '<span class="tl-crown-name-in"><span class="cn-a"></span><span class="cn-b" aria-hidden="true"></span></span>' +
        '</b>' +
        '<span class="tl-crown-lab">' + esc(crownLabel(geoRegion, geoCountry, state.gender)) + '</span>' +
        '</span>' +
        '<b class="tl-crown-val">—</b>' +
        '<span class="tl-crown-swap" aria-hidden="true">⇄</span>' +
        '</button></div>';
    }
    /* 「3 期滑动平滑」已按需求移除：它只在中间帧起作用，用户感知不到差别反而多一个开关。 */
    h += '</div>';

    /* 动画速率自定义：2026-11-04 用户要求只保留「时间跳跃」一项，并且去掉滑杆
       （只留数字输入），位置从独立一行收进上面的播放控件行 —— 它本来就只影响播放。
       动画时长 / 重绘间隔不再开放调节，回落到 RATE_DEF 的内部默认值（100ms / 20ms）。 */

    /* 两个视图的说明文字（「纪录持有图：每个项目一条泳道…」/「分数竞速图：横向条形…」）
       已按用户 2026-11-01 第五轮要求整块删除 —— 图表直接贴着控件开始，少一层噪声。 */

    if (view !== 'lane') {
      h += '<div class="tl-ctl">';
      /* 播放 / 暂停 / 重播：**图标 + 文字**，形状过渡走 YouTube 那套
         （▶ 与 ❙❙ 之间用同一枚 clip-path 多边形插值形变，不是两张图切换），
         时间走完后图标换成「重播」循环箭头（data-state 由 app.js 驱动）。 */
      const atEnd = fy >= P.tlEndFy() - 1e-6;
      const st0 = state.tlPlaying ? 'pause' : (atEnd ? 'replay' : 'play');
      const tx0 = st0 === 'pause' ? t('tl.pause') : (st0 === 'replay' ? t('tl.replay') : t('tl.play'));
      h += '<button class="btn btn-primary tl-play" id="tlPlay" data-state="' + st0 + '">' +
        '<span class="tl-play-ic" aria-hidden="true">' +
          '<span class="tl-pp"></span>' +
          '<svg class="tl-rp" viewBox="0 0 24 24"><path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/></svg>' +
        '</span>' +
        '<span class="tl-play-tx">' + esc(tx0) + '</span></button>';
      h += '<input type="range" id="tlRange" min="' + sl.min + '" max="' + sl.max + '" step="' + sl.step + '" value="' + sl.value + '">';
      h += '<span class="tl-year" id="tlYear">' + sl.label + '</span>';
      /* 时间跳跃（天/秒）：只影响播放时每秒推进多少天。2026-11-04 起唯一保留的速率项，
         去掉滑杆只留数字框，并挪进这一行贴着播放按钮 / 时间条，调它时不用再上下找。 */
      h += '<label class="tl-jump" title="' + esc(t('tl.rate.jumpTip')) + '">' +
        '<span>' + esc(t('tl.rate.jump')) + '</span>' +
        '<input type="number" id="tlRatejump" min="' + RATE_META.jump.min + '" max="' + RATE_META.jump.max +
        '" step="1" value="' + rate.jump + '" aria-label="' + esc(t('tl.rate.jump')) + '">' +
        '<b>' + esc(RATE_META.jump.unit()) + '</b></label>';
      h += '</div>';
    }

    /* 竞速图画幅：条高 25px + 条间 10px（用户 2026-11-03 要求，条间距恢复成以前的 10px）。
       Y 轴范围 0..n+1（n = 15 个可见名次，上下各留一格缓冲）共 16 格 →
       画幅 = 16 × 35 + 网格上下留白 64 = 624px。以前 520px 时一格只有 28.5px，
       条子加高到 25px 后间隙被挤成 3px，所以这里把画幅一并加高。 */
    const RACE_PITCH = 35;
    const chH = view === 'race' ? (RACE_PITCH * 16 + 64) : Math.max(560, (M.events.length * 46 + 90));

    /* 生效的项目集合（显式多选 / 预设分组 / 单个项目）已在函数开头算出（evsBox / evSel0）——
       时间轴终点要用它，不能等到这里才算。 */
    const singleEv = evSel0.length === 1 ? evSel0[0] : (state.group && M.EV[state.group] ? state.group : '');;
    const msBase = singleEv ? M.eventMilestones(singleEv) : M.milestones;
    const hidden = loadHiddenMs();
    const custom = loadCustomMs().map(function (m) { return Object.assign({ custom: true }, m); });
    const edits = loadEditedMs();
    const ms = msBase.filter(function (m) { return hidden.indexOf(msKeyOf(m)) < 0; })
      .concat(custom)
      .map(function (m) {
        /* 给每个事件打上「原始键」，删除 / 编辑都按它定位，避免排序或覆盖后索引错位 */
        m._ok = msKeyOf(m);
        const e = edits[m._ok];
        return e ? Object.assign({}, m, { date: e.date, year: +String(e.date).slice(0, 4), zh: e.zh, en: e.en, ev: e.ev || m.ev, edited: true }) : m;
      })
      .sort(function (a, b) { return String(a.date || a.year).localeCompare(String(b.date || b.year)); });
    TL_MS = ms;
    h += '<div class="tl-stage">';
    h += '<div class="chart-box tl-chart-link" id="tlChart" style="height:' + chH + 'px" data-view="' + view + '" data-mode="' + mode +
      '" data-fy="' + fy + '" data-metric="' + metric + '" data-lane="' + state.tlLane + '" data-smooth="' + (state.tlSmooth ? 1 : 0) +
      '" data-tlregion="' + geoRegion + '" data-tlcountry="' + geoCountry + '" data-ev="' + evsBox.join(',') +
      '" data-tlgender="' + (state.gender || 'all') + '" data-tltype="' + (state.recType || 'all') + '" data-tldimv="' + (state.tlDim || '') +
      '" data-y0="' + (state.y0 || '') + '" data-y1="' + (state.y1 || '') + '" data-tlretired="' + (state.retired ? 1 : 0) + '"></div>';

    /* 纪录持有图：缩放 / 平移提示条（「恢复默认」只在调节过之后出现） */
    if (view === 'lane') {
      h += '<div class="tl-zoom-bar" id="tlZoomBar">' +
        '<span class="tl-zoom-hint">' + Ic.glyph('info') + ' ' + esc(t('tl.zoom.tip')) + '</span>' +
        '<button class="btn btn-ghost tl-zoom-reset" id="tlZoomReset" hidden>' + esc(t('tl.zoom.reset')) + '</button>' +
        '</div>';
    }

    /* 纪录持有图：按需求不再在图表下方罗列持有者清单（原 laneList /「纪录内容」），
       姓名 / 国旗 / 起止时间改为鼠标移到色块上时跟随光标显示（见 Charts.lanes 的 tooltip）。 */
    /* 重大事件：竞速图横轴是分数，里程碑竖线无处安放。
       按需求做成「浮在分数竞速图右下角」的一块：
         · 折叠标签 —— 点开可看到全部事件，点条目跳到对应时间；
         · 到达提示 —— 播放/拖动时一旦跨过某个事件的日期，就在右下角弹出一张提示卡。 */
    /* 重大事件到达提示：播放 / 拖动时间条时，一旦跨过某个事件的日期就弹出一张卡片。
       只提示「上一步还没到、这一步已经过了」的那一条，避免每帧重复弹。 */
    if (view !== 'lane') {
      const recent = ms.slice().reverse().slice(0, 40);
      h += '<div class="ms-pop" id="msPop">';
      h += '<div class="ms-toast" id="msToast" aria-live="polite"></div>';
      h += '<button type="button" class="ms-pop-tab" id="msPopTab" aria-expanded="false">' +
        Ic.glyph('star') + '<span>' + esc(t('tl.events')) + '</span><b>' + ms.length + '</b>' +
        '<i class="ms-pop-caret">▾</i></button>';
      h += '<div class="ms-pop-body" id="msPopBody" hidden>';
      h += '<div class="ms-pop-h">' + esc(t('tl.events')) +
        (singleEv ? ' · ' + esc(evName(M.EV[singleEv])) : '') +
        '<span class="tiny muted">' + esc(t('tl.msWhy')) + '</span></div>';
      h += '<div class="ms-pop-list" id="msRail">';
      recent.forEach(function (m) {
        const label = t.isEn() ? (m.en || m.zh) : m.zh;
        h += '<button class="ms-rail-item' + (m.custom ? ' ms-custom' : '') + '" data-msjump="' + (m.date || (m.year + '-01-01')) + '" title="' + esc(String(label)) + '">' +
          '<b>' + (m.date || m.year) + '</b> ' + esc(String(label).slice(0, 26)) + '</button>';
      });
      h += '</div></div></div>';
    }
    h += '</div>';

    /* 纪录持有图（lane 视图）下方不再罗列冗长的「重大事件」清单 —— 重大事件仅在「分数竞速图」中呈现；
       竞速图已在右下角 ms-pop 里给出事件轨道与到达提示。 */
    if (view !== 'lane') {
    h += '<div class="card reveal"><div class="card-head"><h2>' + esc(t('tl.events')) +
      (singleEv ? ' · ' + esc(evName(M.EV[singleEv])) : '') + '</h2>' +
      (custom.length ? '<span class="tiny muted">+' + custom.length + ' ' + esc(t('tl.msCustom')) + '</span>' : '') + '</div>';
    h += '<div class="milestone-list">';
    ms.forEach(function (m, mi) {
      const isC = !!m.custom;
      const ok = m._ok || msKeyOf(m);
      h += '<span class="ms-item' + (isC ? ' ms-custom' : '') + (m.edited ? ' ms-edited' : '') + '"><b>' + (m.date || m.year) + '</b> ' + esc(t.isEn() ? (m.en || m.zh) : m.zh);
      if (isC) h += ' <span class="ms-tag">' + esc(t('tl.msCustom')) + '</span>';
      if (m.edited) h += ' <span class="ms-tag ms-tag-edit">已编辑</span>';
      /* 内置 / 自定义事件都可编辑：把原始键与时间 / 标题 / 项目带进按钮，点开即回填表单 */
      h += ' <button class="ms-edit" data-msedit="' + esc(ok) + '" data-msedit-date="' + esc(m.date || m.year) + '" data-msedit-zh="' + esc(m.zh || m.en) + '" data-msedit-ev="' + esc(m.ev || '') + '" aria-label="编辑">✎</button>';
      /* 内置事件同样可以删除（删除＝加入隐藏列表，「恢复内置事件」可还原） */
      h += ' <button class="ms-del" data-msdel="' + esc(ok) + '" aria-label="' + esc(t('tl.msDel')) + '">×</button>';
      h += '</span>';
    });
    h += '</div>';
    if (hidden.length) {
      h += '<div class="row" style="margin-top:8px"><span class="tiny muted">' +
        esc(t('tl.msHidden', { n: hidden.length })) + '</span>' +
        '<button class="btn btn-ghost" data-msunhide>' + esc(t('tl.msRestore')) + '</button></div>';
    }
    h += '</div>';
    }

    /* 自定义重大事件：三个输入框（项目 / 时间 / 事件内容）
       ⚠ 2026-11-01 用户要求：这块**只在分数竞速图出现**，纪录持有图下方不再显示
       （纪录持有图与重大事件无关，表单留在那里只是噪声）。 */
    if (view !== 'lane') {
      h += '<div class="card reveal"><div class="card-head"><h2>' + esc(t('tl.msEdit')) + '</h2></div>';
      h += '<p class="tiny muted" style="margin-bottom:8px">' + esc(t('tl.msGuide')) + '</p>';
      h += '<div class="ms-form">';
      h += '<label class="ms-field"><span>' + esc(t('tl.msEv')) + '</span><select id="msEv">' +
        '<option value="">' + esc(t('tl.msEvAll')) + '</option>' +
        M.events.map(function (e) { return '<option value="' + e.id + '">' + esc(evName(e)) + '</option>'; }).join('') +
        '</select></label>';
      h += '<label class="ms-field"><span>' + esc(t('tl.msTime')) + '</span><input type="text" id="msYear" inputmode="numeric" placeholder="2019" maxlength="10"></label>';
      h += '<label class="ms-field ms-grow"><span>' + esc(t('tl.msText')) + '</span><input type="text" id="msText" placeholder="' + esc(t('tl.msText')) + '" maxlength="120"></label>';
      h += '<button class="btn btn-primary" data-msimport id="msImportBtn">' + esc(t('tl.msAdd')) + '</button>';
      h += '</div>';
      h += '<input type="hidden" id="msEditKey">';
      h += '<div class="row" style="margin-top:8px;gap:8px;flex-wrap:wrap">';
      h += '<span class="tiny muted" id="msEditHint"></span>';
      h += '<button class="btn" data-msreset>' + esc(t('tl.msReset')) + '</button>';
      h += '</div></div>';
    }
    return h;
  };

  /* 滑块：默认按天步进（60 天/秒），保留年 / 月 / 周切换 */
  const TL_START = new Date(2003, 0, 1);
  const TL_END = (function () {
    const u = (M.meta && M.meta.updated) || '';
    const m = u.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date();
    return isNaN(d.getTime()) ? new Date() : d;
  })();
  const TL_DAYS = Math.max(1, Math.round((TL_END - TL_START) / 86400000));
  function tlDayOfYear(d) { const s = new Date(d.getFullYear(), 0, 0); return (d - s) / 86400000; }
  function tlIsLeap(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }
  function tlDateToFy(d) { return d.getFullYear() + tlDayOfYear(d) / (tlIsLeap(d.getFullYear()) ? 366 : 365); }
  function tlWeekStart(k) { return new Date(TL_START.getTime() + k * 7 * 86400000); }
  function tlPad(n) { return (n < 10 ? '0' : '') + n; }
  function tlDateLabel(d) { return d.getFullYear() + '-' + tlPad(d.getMonth() + 1) + '-' + tlPad(d.getDate()); }
  /* 时间轴「最新时刻」：默认落点应该是数据的**最后一天**，而不是写死的 2025 年初。
     之前 state.tlFy 默认 2025，打开图表看到的是「2025-01-01 的排名」，
     用户自然觉得「数据进入 2026 年就不动了」。现在默认直接落在最新日期。 */
  const TL_END_ALL = tlDateToFy(TL_END);
  /* ★ 2026-11-02：选中「已停办」的项目时，时间轴要停在该项目停办的那一刻。
     以前的实现把终点写死成「数据最后一天」，于是选八板 / 脚拧 / 旧多盲，
     时间轴仍然一路拉到今天：后面十几年里所有人分数纹丝不动，
     播放也只是白跑一遍。这里把「当前终点」做成一个可变值：
       · 选中的项目**全是停办项目** → 终点取这些项目里最晚的那一天（M.meta.evLast）；
       · 只要含一个在办项目（或没选项目）→ 终点仍是数据最后一天。 */
  let TL_END_CUR = TL_END_ALL;
  /* 终点同时记住「日序号」：由日期直接算出，不经过小数年往返 ——
     tlDateToFy(12-31) 按「年末=下一年初」的约定会得到 2019-12-31→2020.0，
     再换回日序号就成了 2020-01-01，滑块标签会显示成停办项目之后的那一天。 */
  let TL_END_IDX = TL_DAYS;
  function tlDnToDate(dn) {
    const s = String(dn);
    return new Date(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8));
  }
  function tlDayIndexOf(d) {
    return Math.max(0, Math.min(TL_DAYS, Math.round((d - TL_START) / 86400000)));
  }
  /* 某项目最后一次有人比赛的日期（YYYYMMDD）。优先用 ETL 下发的 meta.evLast；
     老数据包里没有，就退回泳道段的结束日（停办项目的段本来就停在停办年）。 */
  function tlEvLastDn(ev) {
    const m = (M.meta && M.meta.evLast) || null;
    if (m && m[ev]) return +m[ev];
    let best = 0;
    const pools = [M.lanes, M.lanesAvg];
    for (let k = 0; k < pools.length; k++) {
      const p = pools[k];
      if (!p) continue;
      for (const key in p) {
        const arr = p[key];
        if (!arr || !arr.length) continue;
        for (let i = 0; i < arr.length; i++) {
          const L = arr[i];
          if (!L || L.ev !== ev) continue;
          (L.segs || []).forEach(function (sg) {
            const dn = sg && (sg.td != null ? sg.td : sg.toDn);
            if (dn && dn > best) best = +dn;
          });
        }
      }
    }
    return best;
  }
  /* 按「当前选中的项目」重置时间轴终点，返回终点（小数年） */
  function tlEndFromEvs(evs) {
    let end = TL_END_ALL;
    TL_END_IDX = TL_DAYS;                 /* 默认：数据最后一天 */
    if (evs && evs.length) {
      let mx = 0, allRetired = true;
      for (let i = 0; i < evs.length; i++) {
        const e = M.EV && M.EV[evs[i]];
        if (!e || !e.retired) { allRetired = false; break; }
        const dn = tlEvLastDn(evs[i]);
        if (dn > mx) mx = dn;
      }
      if (allRetired && mx > 0) {
        const d = tlDnToDate(mx);
        const fy = tlDateToFy(d);
        /* 至少留出一年半的可见跨度，否则只剩头几段、图会很挤 */
        if (fy > 2003.5) { end = fy; TL_END_IDX = tlDayIndexOf(d); }
      }
    }
    TL_END_CUR = end;
    return end;
  }
  P.tlSetEnd = function (evs) { return tlEndFromEvs(evs); };
  P.tlEndFy = function () { return TL_END_CUR; };
  function tlFyToDayIdx(fy) {
    const y = Math.max(2003, Math.min(TL_END.getFullYear(), Math.floor(fy)));
    const jan1 = new Date(y, 0, 1);
    const d = new Date(jan1.getTime() + (fy - y) * (tlIsLeap(y) ? 366 : 365) * 86400000);
    return Math.max(0, Math.min(TL_DAYS, Math.round((d - TL_START) / 86400000)));
  }
  function tlIdxToInfo(idx, step) {
    if (step === 'day' || step == null) {
      const d = new Date(TL_START.getTime() + Math.max(0, Math.min(TL_DAYS, idx)) * 86400000);
      return { fy: tlDateToFy(d), label: tlDateLabel(d) };
    }
    if (step === 'year') return { fy: idx, label: String(idx) };
    if (idx <= 0) return { fy: 2002.4, label: '1982–2003', pre: true };
    if (step === 'month') {
      const me = idx - 1, y = 2003 + Math.floor(me / 12), m = (me % 12) + 1;
      return { fy: y + (m - 1) / 12, label: y + '.' + (m < 10 ? '0' : '') + m };
    }
    const d = tlWeekStart(idx - 1);
    return { fy: tlDateToFy(d), label: d.getFullYear() + '.' + (d.getMonth() + 1 < 10 ? '0' : '') + (d.getMonth() + 1) };
  }
  function tlSlider(step, fy) {
    /* 滑块上限跟着「当前终点」走（选了停办项目 → 终点提前），
       否则停办项目的播放会白跑十几年的空白。 */
    const endIdx = TL_END_IDX;
    if (step === 'day' || step == null) {
      const v = Math.max(0, Math.min(endIdx, tlFyToDayIdx(fy || 2003)));
      return { min: 0, max: endIdx, step: 1, value: v, label: tlIdxToInfo(v, 'day').label };
    }
    if (step === 'year') {
      const v = Math.max(2003, Math.min(Math.round(TL_END_CUR), Math.round(fy)));
      return { min: 2003, max: Math.round(TL_END_CUR), step: 1, value: v, label: String(v) };
    }
    if (step === 'month') {
      const maxM = Math.max(0, Math.round((TL_END_CUR - 2003) * 12));
      const v = Math.max(0, Math.min(maxM, Math.round((fy - 2003) * 12) + 1));
      return { min: 0, max: maxM, step: 1, value: v, label: tlIdxToInfo(v, 'month').label };
    }
    const maxW = Math.max(0, Math.round((TL_END_CUR - 2003) * 365.25 / 7));
    const v = Math.max(0, Math.min(maxW, Math.round((fy - 2003) * 365.25 / 7) + 1));
    return { min: 0, max: maxW, step: 1, value: v, label: tlIdxToInfo(v, 'week').label };
  }
  /* 日期串（YYYY-MM-DD 或 YYYY）→ 滑块索引，供事件轨道跳转 */
  P.tlDateToIdx = function (s) {
    const m = String(s || '').match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/);
    if (!m) return 0;
    const d = new Date(+m[1], +(m[2] || 1) - 1, +(m[3] || 1));
    return Math.max(0, Math.min(TL_DAYS, Math.round((d - TL_START) / 86400000)));
  };
  /* 小数年（fy）→ 日期串（YYYY-MM-DD），供播放时按图表真实时间精确触发里程碑 */
  P.tlDateAtFy = function (fy) {
    const y = Math.max(2003, Math.min(TL_END.getFullYear(), Math.floor(fy)));
    const jan1 = new Date(y, 0, 1);
    const d = new Date(jan1.getTime() + (fy - y) * (tlIsLeap(y) ? 366 : 365) * 86400000);
    return tlDateLabel(d);
  };

  /* 由 app.js 调用：渲染 / 更新动态图表 */
  /* 播放态读取：state 由 app.js 在脚本顶层定义，这里容错读取 ——
     早期直接写 state.tlPlaying，一旦作用域不同（例如冒烟环境 / 未来模块化）就会抛错，
     而外层 try 会把异常吞掉，表现为「图表一片空白且控制台无提示」。 */
  function tlIsPlaying() { try { return !!state.tlPlaying; } catch (e) { return false; } }

  P.drawTimeline = function (box) {
    if (!box || !window.Charts || !window.Charts.has()) return null;
    const view = box.getAttribute('data-view');
    const mode = box.getAttribute('data-mode');
    const evs = (box.getAttribute('data-ev') || '').split(',').filter(Boolean);
    /* 时间轴终点与「是否停办项目」有关，必须在这里同步一次：
       播放循环 / 延迟 rAF 里的调用都可能晚于渲染，若不刷新就还按旧终点跑。 */
    const tlEnd = tlEndFromEvs(evs);
    const fy = Math.min(parseFloat(box.getAttribute('data-fy')) || tlEnd, tlEnd);
    const metric = box.getAttribute('data-metric') || 'overall';
    const lane = box.getAttribute('data-lane') || 'single';
    const smooth = box.getAttribute('data-smooth') === '1';
    const region = box.getAttribute('data-tlregion') || '';
    const country = box.getAttribute('data-tlcountry') || '';
    const gender = box.getAttribute('data-tlgender') || '';
    const rtype = box.getAttribute('data-tltype') || 'all';
    const dim = box.getAttribute('data-tldimv') || '';
    /* 容器尚不可见（刚切视图 / 父级尚未布局完成）时宽高为 0，此时 init 出来的画布是 0×0，
       之后即使 DOM 有了尺寸也只会显示空白。先等尺寸就绪再画，最多重试 12 帧（约 200ms），
       超过后仍画一次，保证不会因为容器一直隐藏而彻底不画。 */
    if (!box.clientHeight && !box.offsetHeight && !box.__tlRetry) {
      box.__tlRetry = 0;
      const wait = function () {
        box.__tlRetry++;
        if ((box.clientHeight || box.offsetHeight) || box.__tlRetry > 12) {
          box.__tlRetry = 0;
          P.drawTimeline(box);
        } else if (window.requestAnimationFrame) {
          window.requestAnimationFrame(wait);
        } else {
          setTimeout(wait, 16);
        }
      };
      if (window.requestAnimationFrame) window.requestAnimationFrame(wait); else setTimeout(wait, 16);
      return null;
    }
    try {
      const opt = tlOption(view, mode, fy, smooth, metric, region, country, lane, evs, gender, rtype, box, dim);
      if (!opt) return null;
      opt.backgroundColor = 'transparent';
      window.Charts.resolveDeep ? window.Charts.resolveDeep(opt) : (function () { })(opt);
      /* 结构（视图 / 模式 / 维度 / 单均 / 项目 / 性别）不变时做增量合并，名次与分数丝滑过渡 */
      const sig = view + '|' + mode + '|' + metric + '|' + lane + '|' + evs.join('+') + '|' + gender + '|' + rtype + '|' + region + '|' + country + '|' + (smooth ? 1 : 0) + '|' + dim +
        '|' + (box.getAttribute('data-y0') || '') + '|' + (box.getAttribute('data-y1') || '') + '|' + (box.getAttribute('data-tlretired') || '0');
      const sameStruct = box.__tlSig === sig;
      /* 播放时每帧都在重画，换位过渡必须短于帧间隔的几倍，否则名次变化会「追不上」
         当前帧、看起来一顿一顿。动画时长滑杆直接决定这段补间的快慢。 */
      /* 播放时把过渡动画设为 0，让「名次 / 姓名 / 分数」每帧同步刷新、不再有延迟感；
         手动拖动时保留一小段过渡（按速率参数缩放），体验更顺。 */
      const animMs = tlIsPlaying() ? 0 : Math.max(0, Math.min(2500, (P.tlRate ? P.tlRate().anim : 800)));
      /* 缩放 / 平移过程中（400ms 内有过一次交互）关掉补间，否则每滚一格都要等动画走完，拖起来发黏 */
      const fast = (Date.now() - (box.__tlFastTs || 0)) < 400;
      if (sameStruct) {
        opt.animationDuration = 0;
        opt.animationDurationUpdate = (tlIsPlaying() || fast) ? 0 : Math.round(animMs * 0.35);
        opt.animationEasingUpdate = 'cubicInOut';
      } else if (fast) {
        opt.animationDuration = 0;
      }
      let inst = null;
      try { inst = window.Charts.render(box, opt, { notMerge: !sameStruct }); } catch (e) { inst = null; }
      box.__tlSig = sig;
      if (inst) { box.removeAttribute('data-ec-fail'); }
      if (view === 'lane') {
        P.tlSyncZoomBtn(box);
        bindLaneCursor(box, inst);
      } else if (inst) {
        P.bindTlCrown(box);
        if (P.tlCrownPaint) P.tlCrownPaint(box, fy);
      }
      return inst;
    } catch (e) {
      /* 早期这里把异常整个吞掉，结果线上只看到一块空白图表、控制台也没有线索。
         现在至少留下可排查的痕迹：控制台报错 + 容器里给出可读提示。 */
      try { console.error('[timeline] 图表绘制失败:', view, e && e.message, e); } catch (e2) { }
      try {
        if (!box.getAttribute('data-ec-fail')) {
          box.setAttribute('data-ec-fail', '1');
          box.innerHTML = '<div class="chart-fail">图表绘制失败：' + String((e && e.message) || e) + '</div>';
        }
      } catch (e3) { }
      return null;
    }
  };

  /* ---------- 纪录持有图：光标形态 ---------- */
  /* 交互约定（用户 2026-11-01 更新）：
       · 鼠标压在选手色块上 → 普通指针（色块上没有可拖的东西，抓手会误导）；
       · 鼠标在空白处     → 抓手，可按住左右拖动（缩放后才有平移余量）。
     ECharts 在命中 series 项时会触发 showTip，离开时 hideTip，用它切换 .over-seg 即可，
     不必自己做命中测试。 */
  function bindLaneCursor(box, inst) {
    if (!inst || typeof inst.on !== 'function') return;
    box.__lcBox = box;
    if (inst.__lcBound) return;
    inst.__lcBound = true;
    inst.on('showTip', function () {
      const b = box.__lcBox; if (b) b.classList.add('over-seg');
    });
    inst.on('hideTip', function () {
      const b = box.__lcBox; if (b) b.classList.remove('over-seg');
    });
    /* 鼠标直接移出画布时个别版本不会补发 hideTip，兜一层 */
    try {
      box.addEventListener('mouseleave', function () { box.classList.remove('over-seg'); });
    } catch (e) { }
  }

  /* ---------- 纪录持有图：缩放 / 平移 ---------- */
  /* 交互约定（用户 2026-11-01 指定）：
       · ctrl + 滚轮 —— 以光标所在年份为中心缩放（1 年 ~ 满量程）；
       · alt + 滚轮 —— 左右平移；
       · 空白处按住拖动 —— 左右平移（缩放后才有意义，所以只有缩放状态下光标才是抓手）；
       · 一旦调节过，图表右下角出现「恢复默认」，点一下回到满量程并隐藏按钮。
     缩放窗口存在 box.__tlWin（{a,b} 小数年），tlOption 里夹进满量程后作为 x 轴范围；
     满量程存在 box.__tlFull（由 tlOption 每次按当前筛选重算）。 */
  const ZOOM_MIN_SPAN = 0.6;      /* 最小可视窗口（年）：再窄就只剩一根柱了 */
  function zoomInst(box) {
    try { return window.echarts ? window.echarts.getInstanceByDom(box) : null; } catch (e) { return null; }
  }
  function zoomFull(box) {
    const f = box && box.__tlFull;
    return (f && f.b > f.a) ? f : { a: 2003, b: new Date().getFullYear() + 1 };
  }
  function zoomCur(box) {
    const w = box && box.__tlWin;
    const f = zoomFull(box);
    return (w && w.b > w.a) ? w : f;
  }
  function zoomYearAt(box, px) {
    const ch = zoomInst(box);
    if (!ch) return null;
    try {
      const p = ch.convertFromPixel({ gridIndex: 0 }, [px, 0]);
      return (p && isFinite(p[0])) ? p[0] : null;
    } catch (e) { return null; }
  }
  function zoomYearsPerPx(box) {
    const ch = zoomInst(box);
    if (!ch) return 0.02;
    const w = ch.getWidth() || 1;
    const a = zoomYearAt(box, 0), b = zoomYearAt(box, w);
    if (a == null || b == null || !w) return 0.02;
    const r = (b - a) / w;
    return isFinite(r) && r > 0 ? r : 0.02;
  }
  let zoomRaf = 0;
  function zoomApply(box, a, b) {
    const f = zoomFull(box);
    const fullSpan = f.b - f.a;
    let span = Math.max(ZOOM_MIN_SPAN, Math.min(fullSpan, b - a));
    let x = a;
    if (x + span > f.b) x = f.b - span;
    if (x < f.a) x = f.a;
    if (span >= fullSpan - 1e-6) box.__tlWin = null;
    else box.__tlWin = { a: x, b: x + span };
    box.__tlFastTs = Date.now();
    if (zoomRaf) return;
    zoomRaf = (window.requestAnimationFrame || function (f2) { return setTimeout(f2, 16); })(function () {
      zoomRaf = 0;
      P.drawTimeline(box);
    });
  }
  P.tlResetZoom = function (box) {
    if (!box) return;
    box.__tlWin = null;
    box.__tlFastTs = Date.now();
    P.drawTimeline(box);
    P.tlSyncZoomBtn(box);
  };
  P.tlSyncZoomBtn = function (box) {
    const bar = document.getElementById('tlZoomBar');
    if (!bar || !box) return;
    const zoomed = !!(box.__tlWin && box.__tlWin.b > box.__tlWin.a);
    bar.classList.toggle('on', zoomed);
    box.classList.toggle('zoomed', zoomed);
    const btn = document.getElementById('tlZoomReset');
    if (btn) btn.hidden = !zoomed;
  };
  /* 绑定一次（容器换了会重新绑定，因为 data-zoom-bound 挂在元素上） */
  P.bindLaneZoom = function (box) {
    if (!box || box.__zoomBound || !window.echarts) return;
    box.__zoomBound = true;
    const px = function (e) { const r = box.getBoundingClientRect(); return e.clientX - r.left; };
    box.addEventListener('wheel', function (e) {
      /* 不按 ctrl / alt 时一律放行，页面照常滚动 —— 用户可能只是想往下看页面 */
      if (!(e.ctrlKey || e.metaKey || e.altKey)) return;
      if (!box.__tlFull) return;
      e.preventDefault();
      const w0 = zoomCur(box);
      if (e.altKey) {
        const dy = (e.deltaY + (e.deltaX || 0)) * zoomYearsPerPx(box);
        zoomApply(box, w0.a + dy, w0.b + dy);
      } else {
        const span = w0.b - w0.a;
        const k = e.deltaY > 0 ? 1.28 : 0.78;
        const nspan = Math.max(ZOOM_MIN_SPAN, Math.min(zoomFull(box).b - zoomFull(box).a, span * k));
        const y = zoomYearAt(box, px(e));
        const cx = (y == null) ? (w0.a + w0.b) / 2 : y;
        const t = Math.max(0, Math.min(1, (cx - w0.a) / span));
        const a = cx - t * nspan;
        zoomApply(box, a, a + nspan);
      }
    }, { passive: false });

    let drag = null;
    box.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      const w0 = zoomCur(box), f = zoomFull(box);
      if (w0.b - w0.a >= f.b - f.a - 1e-6) return;   /* 满量程时没有可平移的余量 */
      drag = { x: e.clientX, a: w0.a, b: w0.b, moved: false, x0: e.clientX, y0: e.clientY };
      box.classList.add('dragging');
      e.preventDefault();
    });
    window.addEventListener('mousemove', function (e) {
      if (!drag) return;
      if (Math.abs(e.clientX - drag.x0) > 3 || Math.abs(e.clientY - drag.y0) > 3) drag.moved = true;
      const dy = (e.clientX - drag.x) * zoomYearsPerPx(box);
      zoomApply(box, drag.a - dy, drag.b - dy);
    });
    window.addEventListener('mouseup', function () {
      if (!drag) return;
      /* ★ 真拖动过的，浏览器仍会补发一次 click（按下/抬起都落在 canvas 上就会）。
         若不拦掉，这次 click 会被当成「点击色块 → 跳选手主页」，刚拖完就离开页面了。
         记下时间戳，交给下面的捕获阶段监听吞掉。 */
      if (drag.moved) box.__tlSkipClick = Date.now();
      drag = null;
      box.classList.remove('dragging');
    });
    /* 捕获阶段吞掉「拖动结束后的那次 click」：ECharts 的 click 监听挂在 canvas（子节点）上，
       父级在捕获阶段 stopPropagation 就能拦在它之前。 */
    box.addEventListener('click', function (e) {
      if (Date.now() - (box.__tlSkipClick || 0) < 400) {
        e.stopPropagation();
        e.preventDefault();
      }
    }, true);
    P.tlSyncZoomBtn(box);
  };

  function inScope(p, region, country, gender, evs) {
    if (country) { if (p.country !== country) return false; }
    else if (region) {
      const c = M.continentOf[p.country];
      if (M.continents[region]) { if (c !== region) return false; }
      else if (M.regionOf[c] !== region) return false;
    }
    if (gender && gender !== 'all') {
      const g = p.gender ? String(p.gender).charAt(0).toUpperCase() : '';
      if (g !== gender) return false;
    }
    if (evs && evs.length) {
      let hit = false;
      for (let i = 0; i < evs.length; i++) if ((p.events || []).indexOf(evs[i]) >= 0) { hit = true; break; }
      if (!hit) return false;
    }
    return true;
  }

  /* 分数竞速图：未选项目时用「生涯累计 × 截至当日比例」逐年缩放（末帧＝总榜综合能力分）；
     选中项目时改按「所选项目的六维总分」(p.sixEv) 求和排序，见下方 snapshot()。
     旧的 evYearlyOf（按项目按年纪录/金牌，分母缺失且忽略 ev 参数）会让单项目分数算错，
     已删除。 */

  /* 所选项目内的「年度荣誉曲线」：与全项目模式同一套口径
     （领奖台按赛级 × 名次加权 ×2，破纪录 +1；对应 ETL 里 p.yearly 的算法），
     只是把统计范围收窄到所选项目。数据来自 p.podiums（ev/year/tier/place）
     与 p.records（ev/date/type），两者在明细档选手里都是完整的。
     结果按「项目组合 + 单均口径」缓存在选手对象上：播放时每帧都会调用，
     不能逐帧重扫一遍领奖台与纪录。 */
  function evYearlyOf(p, evList, rtype, ckKey) {
    const ck = ckKey || ('__evy' + (rtype || 'all') + '_' + evList.join('+'));
    const hit0 = p[ck];
    if (hit0) return hit0;
    const y = {};
    (p.podiums || []).forEach(function (d) {
      if (evList.indexOf(d.ev) < 0) return;
      const tw = d.tier === 'WC' ? 1 : (d.tier === 'CC' ? 0.7 : 0.4);
      const pw = d.place === 1 ? 1 : (d.place === 2 ? 0.6 : 0.4);
      y[d.year] = (y[d.year] || 0) + pw * tw * 2;
    });
    (p.records || []).forEach(function (r) {
      if (evList.indexOf(r.ev) < 0) return;
      /* 单次 / 平均口径与全项目分支一致：yearlyS 只算单次纪录、yearlyA 只算平均纪录 */
      if (rtype === 'single' && r.type === 'avg') return;
      if (rtype === 'avg' && r.type === 'single') return;
      const yy = parseInt(String(r.date || '').slice(0, 4), 10);
      if (yy) y[yy] = (y[yy] || 0) + 1;
    });
    p[ck] = y;
    return y;
  }

  /* 所选项目范围内的六维总分（与榜单 `sixIn()` 同一把尺子：t = Σ_d w_d · s_d）。
     ★ 单次 / 平均口径：ETL 只下发了**全局**的 sixS / sixA，没有按项目的单均分解
       （data.js 已 ~60MB，再翻倍会严重膨胀）。这里的做法是「按项目份额缩放」：
         s_d(口径, 项目范围) = s_d(口径, 全局) × [ s_d(合并, 项目范围) ÷ s_d(合并, 全局) ]
       项目范围 = 全部项目时份额恒为 1，公式精确退化为全局单/均分，不会凭空造数。 */
  const SIXD_RACE = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'];
  /* 所选项目的**逐维求和**（不合成、不含权重）—— 这是与时间无关的常量，
     按「项目组合」缓存在选手对象上。原来每帧每人都在这里 forEach 一遍 evList、
     还每次都去问一次六维权重，多选项目时（17 个项目）单单这一步就要几十毫秒。
     权重改为每帧现乘（6 次乘法），所以参数页改占比依然实时生效，不会读到旧缓存。 */
  function evScopeVec(p, evList, ckKey) {
    const ck = ckKey || ('__evs6_' + evList.join('+'));
    const hit = p[ck];
    if (hit !== undefined) return hit || null;
    const se = p && p.sixEv;
    let s = null;
    if (se) {
      const a6 = [0, 0, 0, 0, 0, 0];
      let hitN = 0;
      for (let i = 0; i < evList.length; i++) {
        const a = se[evList[i]];
        if (!a) continue;
        for (let d = 0; d < 6; d++) a6[d] += (a[d] || 0);
        hitN++;
      }
      if (hitN) s = a6;
    }
    p[ck] = s || false;
    return s;
  }
  function evScopeT(p, evList, rtype, w, ckKey) {
    const s = evScopeVec(p, evList, ckKey);
    if (!s) return 0;
    let t = 0;
    for (let d = 0; d < 6; d++) t += (w[SIXD_RACE[d]] || 0) * s[d];
    if (rtype !== 'single' && rtype !== 'avg') return t;
    const vs = rtype === 'single' ? p.sixS : p.sixA;
    const vb = p.six;
    if (!vs || !vb) return t;
    let t2 = 0;
    for (let d = 0; d < 6; d++) {
      const all = vb[SIXD_RACE[d]] || 0;
      const share = all > 0 ? Math.max(0, Math.min(1, s[d] / all)) : 0;
      t2 += (w[SIXD_RACE[d]] || 0) * (vs[SIXD_RACE[d]] || 0) * share;
    }
    return t2;
  }

  /* 选手在所选项目里的「第一个有成绩的年份」（查不到返回 null）。
     ★ 为什么需要它：此前按项目筛选只查 p.events（**生涯**有没有玩过这个项目），
       于是「2007 年才出现第一条中国三盲成绩」的人，在 2003 年的画面里就已经有一条
       属于他的分数条 —— 那几年本该是空白。events 只能回答「玩过没有」，
       回答不了「从哪一年开始的」，所以要读 ETL 下发的 evStat[eid].years。
     结果按「项目组合」缓存到选手对象上：播放时每帧都会调用，不能逐帧重扫。
     ★ ck（缓存键）由调用方预算好传进来：原来每次调用都要 `evList.join('+')` 拼一次键，
       播放时「人数 × 每帧」次字符串拼接光 GC 就吃掉一百多毫秒。 */
  function evFirstYear(p, evList, ckKey) {
    const ck = ckKey || ('__evfy_' + evList.join('+'));
    const hit = p[ck];
    if (hit !== undefined) return hit;
    /* 再按「单个项目」缓存一层：换项目组合（加减一个项目）时只需要解码新增的那个，
       不必把已有项目的 evStat 重新拆一遍 —— evStat 是紧凑字符串，拆一次不便宜。 */
    let m = p.__evfy1;
    if (!m) m = p.__evfy1 = {};
    let first = null;
    for (let i = 0; i < evList.length; i++) {
      const ev = evList[i];
      let v = m[ev];
      if (v === undefined) {
        let f = null;
        const b = (M.evStatRaw ? M.evStatRaw(p, ev) : (p.evStat && p.evStat[ev])) || null;
        if (b && b.years && b.years.length) {
          for (let j = 0; j < b.years.length; j++) {
            const n = +b.years[j];
            if (n > 0 && (f === null || n < f)) f = n;
          }
        }
        v = m[ev] = (f === null ? 0 : f);   /* 0 = 该项目上查不到数据 */
      }
      if (v > 0 && (first === null || v < first)) first = v;
    }
    /* 兜底（长尾名册档没有 evStat）：先用该项目上最早的领奖台 / 纪录年份，
       再不行退回生涯起始年 —— 宁可少筛一个人，也不能把人凭空删掉。 */
    if (first === null) {
      (p.podiums || []).forEach(function (d) { if (evList.indexOf(d.ev) >= 0) { const n = +d.year; if (n > 0 && (first === null || n < first)) first = n; } });
      (p.records || []).forEach(function (r) {
        if (evList.indexOf(r.ev) >= 0) { const n = +String(r.date || '').slice(0, 4); if (n > 0 && (first === null || n < first)) first = n; }
      });
      if (first === null && p.start) { const n = +p.start; if (n > 0) first = n; }
    }
    p[ck] = first;
    return first;
  }

  /* ★ 性能（2026-11-01 第五轮）：逐年对象（p.yearly / p.yearlyS / p.yearlyA /
     按项目组合的 evYearly）的「累计值」原来每帧都 for-in 一遍全部键、
     还要把键从字符串转成数字再比较。多选项目时一个人的评分开销因此翻了好几倍，
     播放就变成一帧几十毫秒、动画明显卡顿。
     现在首次访问时把它整理成「有序年份 + 前缀和」，之后用二分查找，
     「到 END_Y 为止的合计」直接取最后一项，均摊 O(log n) 且没有任何分配。 */
  function seriesOf(p, yv, ck) {
    let s = p[ck];
    if (s) return s;
    const ys = [], cs = [];
    let acc = 0;
    for (const k in yv) {
      const n = +k;
      if (n > 0) ys.push(n);
    }
    ys.sort(function (a, b) { return a - b; });
    for (let i = 0; i < ys.length; i++) { acc += (yv[ys[i]] || 0); cs.push(acc); }
    s = { ys: ys, cs: cs, yv: yv };
    p[ck] = s;
    return s;
  }
  function seriesCum(ser, f) {
    const ys = ser.ys;
    let lo = 0, hi = ys.length - 1, idx = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (ys[m] <= f) { idx = m; lo = m + 1; } else hi = m - 1; }
    /* ★ 首次有成绩之前必须返回 0。旧实现只把 s 记成 0，却照样 `s += yv[yi+1]*frac`
       —— 于是「2012 年才首次参赛」的人，在 2011.25 就已经有 25% 的分（凭空早了一年）。 */
    if (idx < 0) return 0;
    let s = ser.cs[idx];
    const yi = Math.floor(f), frac = f - yi;
    if (frac > 0) { const v = ser.yv[yi + 1]; if (v) s += v * frac; }
    return s;
  }

  /* ================= 六维各自的年度曲线（ETL 下发 p.sy[dim]） =================
     p.sy[dim] = "2009:0,2010:82,2011:302,…"，值是「占本人该维最终分的千分比」。
     来源是六维引擎自己的事实现表（M1 纪录持有 / M2 领奖台 / M3 大赛表现 /
     M4 统治力 / M5 纪录比 / M6 突破幅度），所以每一维的起始年、人员构成、
     增长节奏都跟着这一维的事实走 —— 不再拿「领奖台 + 纪录次数」的通用年度曲线去套。
     缺这条曲线（旧数据包 / 该维没有事实）时返回 null，调用方退回旧算法。 */
  function dimCurve(p, dim) {
    if (!p.sy || !p.sy[dim]) return null;
    let c = p.__syc;
    if (!c) c = p.__syc = {};
    if (c[dim] !== undefined) return c[dim];
    const ys = [], rs = [];
    p.sy[dim].split(',').forEach(function (kv) {
      const i = kv.indexOf(':');
      if (i <= 0) return;
      const y = +kv.slice(0, i), r = +kv.slice(i + 1);
      if (y > 0 && isFinite(r)) { ys.push(y); rs.push(r); }
    });
    c[dim] = ys.length ? { ys: ys, rs: rs } : null;
    return c[dim];
  }
  function dimRatioAt(p, dim, fy) {
    const c = dimCurve(p, dim);
    if (!c) return null;
    const ys = c.ys;
    if (fy < ys[0] - 1e-9) return 0;       /* 该维事实发生之前一律 0（不再「提前出现」） */
    let lo = 0, hi = ys.length - 1, idx = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (ys[m] <= fy + 1e-9) { idx = m; lo = m + 1; } else hi = m - 1; }
    if (idx < 0) return 0;
    let r = c.rs[idx];
    /* 年内线性插值到下一年（曲线是年度采样，播放时条形才会连续增长）；
       但绝不越过第一个采样点，所以不会「提前」给出下一年的值。 */
    if (idx < ys.length - 1) {
      const span = ys[idx + 1] - ys[idx];
      const f = span > 0 ? Math.max(0, Math.min(1, (fy - ys[idx]) / span)) : 0;
      r = r + (c.rs[idx + 1] - r) * f;
    }
    return Math.max(0, r / 1000);
  }
  /* 生涯进度（0→1）：只给「该维没有任何事实」的极少数人兜底用。
     旧实现这种情况下直接给 ratio=1，于是 2003 年的画面里坐满当代选手。 */
  function careerRamp(p, fy) {
    const a = +p.start || 2003;
    const b = Math.max(a + 1, +p.end || 2026);
    return Math.max(0, Math.min(1, (fy - a) / (b - a)));
  }

  /* 与时间无关的筛选池：region / country / gender / evs 一旦确定，「谁在范围内」就固定了。
     播放时每帧都重新做一遍 inScope（多选项目还要逐个比对 p.events 数组）纯属浪费，
     这里按签名缓存候选池，之后每帧只遍历池内的人（筛了国家 / 大洲时人数还会大幅减少）。 */
  const POOL_CACHE = {};
  const POOL_ORDER = [];
  function poolFor(region, country, gender, evs) {
    const k = [region || '', country || '', (gender && gender !== 'all') ? gender : 'all',
      (evs && evs.length) ? evs.join('+') : ''].join('|');
    const hit = POOL_CACHE[k];
    if (hit) return hit;
    const out = [];
    const R = M.ranked;
    for (let i = 0; i < R.length; i++) {
      const p = R[i];
      if (inScope(p, region, country, gender, evs)) out.push(p);
    }
    POOL_CACHE[k] = out;
    POOL_ORDER.push(k);
    while (POOL_ORDER.length > 6) {
      const old = POOL_ORDER.shift();
      if (old !== k) delete POOL_CACHE[old];
    }
    return out;
  }

  /* 竞速分求值器：吃一位选手 + 一个时间点，返回他在这一刻的竞速分（≤0 表示这一帧不计入）。
     抽成独立函数是为了三处复用：
       ① 常规快照（每帧一次全量扫描）；
       ② 登顶时间线的「候选筛选」（在若干采样时刻取榜首）；
       ③ 登顶时间线的「逐点求解」（只看候选集合，反复调用）。
     三处必须是同一把尺子，否则榜首时间线与画面上的 #1 会对不上。
     ★ 范围判定（region / country / gender / evs）不再放在这里 —— 由 poolFor 预先筛好，
       调用方各自遍历 val.pool，等价但每帧省掉一次全量 inScope。 */
  function mkScorer(mode, smooth, region, country, evs, gender, rtype, dim) {
    /* 选中项目（单项目 / 多项目）时，整张图切换成「所选项目的六维能力分排名」，与上方筛选项目实时联动：
         分数取每个所选项目的六维总分（p.sixEv 已含 per-event 六维分 a[6]=t_ev）求和，
         与「历史地位排名」单 / 多项目筛选共用同一把六维尺子（不再依赖缺失的逐项目按年统计）。
         不选项目时仍用全项目历史地位分（生涯累计 × 年度比例）。 */
    const evList = (evs && evs.length) ? evs : null;
    const key = rtype === 'single' ? 'yearlyS' : (rtype === 'avg' ? 'yearlyA' : 'yearly');
    const serKey = '__ser_' + key;
    /* ★ 缓存键在这里预算一次。以前是在每个选手的每次求值里现拼（join + 字符串相加），
       播放时「人数 × 每帧」次分配，光是 GC 就占掉一百多毫秒 —— 这才是多选项目卡顿的真凶。 */
    let ckFirst = '', ckVec = '', ckEvSer = '', ckEvY = '';
    if (evList) {
      const combo = evList.join('+');
      ckFirst = '__evfy_' + combo;
      ckVec = '__evs6_' + combo;
      ckEvY = '__evy' + rtype + '_' + combo;
      ckEvSer = '__sere' + rtype + '_' + combo;
    }
    /* 六维权重每帧只取一次（原来在 evScopeT 里每人取一次） */
    const W6 = (P.util && P.util.sixW) ? P.util.sixW() : { m1: .42, m2: .14, m3: .22, m4: .10, m5: .04, m6: .08 };
    const END_Y = 2026;
    /* 六维单独筛选：直接用该维度的维度分作为基准分，再乘同一条年度进度曲线，
       这样「只看 M3」的竞速图里条形只按大赛表现这一维比拼。 */
    const dimMode = (dim && ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'].indexOf(dim) >= 0);
    /* 该口径下的六维分（单次 / 平均 / 合并） */
    function sixOfTrack(p) {
      return rtype === 'single' ? (p.sixS || p.six) : (rtype === 'avg' ? (p.sixA || p.six) : p.six);
    }
    /* 单维竞速图的进度曲线键：M2 领奖台在单/平均口径下改用 sixyear.tsv 的
       m2s / m2a（按对应轨的领奖台事实累积），否则会出现「2015 年才有第一个
       单次领奖台，却按合并档曲线从 2007 年就在涨分」。旧数据包没有这两列时
       退回合并档 m2 曲线，绝不退回 ratio=1。 */
    function dimCurveKey(p, dim) {
      if (dim !== 'm2') return dim;
      const k = rtype === 'single' ? 'm2s' : (rtype === 'avg' ? 'm2a' : 'm2');
      return (p.sy && p.sy[k]) ? k : 'm2';
    }
    function valueOf(p, fy) {
      if (evList) {
        /* 多项目（含单项目）：把所选项目的六维分逐维求和，再用当前权重合成，
           与榜单「项目筛选」完全同一把尺子（不再直接读 ETL 预置的 a[6]，
           否则在参数设置页改了六维占比，竞速图不会跟着变）。
           ★ rtype（单次 / 平均）此前在这里被完全忽略 —— 项目模式只认合并档，
             所以「单次 / 平均」筛选看着像失效；现在由 evScopeT 按口径取值。 */
        /* ★ 该项目（组合）里还没有他的任何成绩 → 这一帧不该有这个人。
           以前这段缺失，导致早期年份里出现后来才进这个项目的选手（例如 2007 年前的中国三盲）。 */
        const firstY = evFirstYear(p, evList, ckFirst);
        if (firstY != null && Math.floor(fy) < firstY) return 0;
        /* ★ 项目 + 维度同时选中时，只比这一维（以前会忽略维度、拿六维加权和去比） */
        if (dimMode) {
          const vec = evScopeVec(p, evList, ckVec);
          if (!vec) return 0;
          const di = SIXD_RACE.indexOf(dim);
          let base0 = vec[di] || 0;
          /* ★ 项目 + 维度 + 成绩口径：evScopeVec 是合并档的逐项目和，此前完全
             不看 rtype，所以「选项目 + 选 M2 + 切单次」也纹丝不动。按该维
             「所选口径全局分 ÷ 合并档全局分」缩放，与 evScopeT 同源（总量精确，
             项目之间的份额是比例分摊；逐项目精确档由榜单侧 sixIn 懒加载承担）。 */
          if (rtype === 'single' || rtype === 'avg') {
            const vs = rtype === 'single' ? p.sixS : p.sixA;
            const vb = p.six;
            if (vs && vb) {
              const all = vb[dim] || 0;
              base0 = all > 0 ? base0 * ((vs[dim] || 0) / all) : 0;
            }
          }
          if (!(base0 > 0)) return 0;
          const dr = dimRatioAt(p, dimCurveKey(p, dim), fy);
          return base0 * (dr == null ? careerRamp(p, fy) : dr);
        }
        const t = evScopeT(p, evList, rtype, W6, ckVec);
        if (t <= 0) return 0;
        /* ★ 时间演化（此前缺失 → 单/多项目播放时条形纹丝不动，只显示最终名次）：
           总分 t 是「截至今天」的能力值，必须再乘一条随时间推进的进度曲线，
           播放时才会逐年长出来。进度曲线用「该选手在所选项目上的年度荣誉累计占比」，
           与全项目分支的 p.yearly 读法完全同源（领奖台按赛级/名次加权 + 破纪录计数），
           只是把统计范围收窄到所选项目 —— 所以三阶图只会随他三阶上的成绩推进。 */
        const evSer = seriesOf(p, evYearlyOf(p, evList, rtype, ckEvY), ckEvSer);
        const evAll = seriesCum(evSer, END_Y);
        let ratio;
        if (evAll > 0) {
          let cf = seriesCum(evSer, fy);
          if (smooth) cf = (seriesCum(evSer, fy) + seriesCum(evSer, fy - 1) + seriesCum(evSer, fy - 2)) / 3;
          ratio = Math.max(0, Math.min(1, cf / evAll));
        } else {
          /* 该项目上没有任何领奖台 / 纪录（例如只靠「纪录比」拿分的人）：
             按生涯进度长出来，而不是从 2003 年起就满值站着。 */
          ratio = careerRamp(p, fy);
        }
        return t * ratio;
      }
      /* ★ 单维模式：走**该维度自己的年度曲线**（ETL 下发的 p.sy[dim]）。
         旧实现拿 p.yearly（领奖台 + 纪录次数）当所有维度的进度曲线，
         该曲线为空时还直接给 ratio=1 —— 结果「统治力」在首次参赛前就冒出来，
         「纪录比」2003 年的画面里坐满 2020 年代才出道的选手。 */
      if (dimMode) {
        const sv = sixOfTrack(p);
        const base0 = sv ? (sv[dim] || 0) : 0;
        if (!(base0 > 0)) return 0;
        if (fy < (+p.start || 2003) - 1e-9) return 0;      /* 首次参赛之前不设此人 */
        const dr = dimRatioAt(p, dimCurveKey(p, dim), fy);
        if (dr != null) return base0 * dr;
        /* 旧数据包（没有 p.sy）：退回年度荣誉曲线，为空则按生涯进度，绝不直接给 1 */
        const serD = seriesOf(p, p[key] || {}, serKey);
        const allD = seriesCum(serD, END_Y);
        let cfD = seriesCum(serD, fy);
        if (smooth) cfD = (seriesCum(serD, fy) + seriesCum(serD, fy - 1) + seriesCum(serD, fy - 2)) / 3;
        const ratioD = allD > 0 ? Math.max(0, Math.min(1, cfD / allD)) : careerRamp(p, fy);
        return base0 * ratioD;
      }
      const ser = seriesOf(p, p[key] || {}, serKey);
      const all = seriesCum(ser, END_Y);
      if (all <= 0) return 0;
      let cf = seriesCum(ser, fy);
      if (smooth) cf = (seriesCum(ser, fy) + seriesCum(ser, fy - 1) + seriesCum(ser, fy - 2)) / 3;
      const ratio = Math.max(0, Math.min(1, cf / all));
      if (ratio <= 0) return 0;
      const sc = P.util.scoreOf(p, rtype);
      const career = sc.career * ratio;
      const ratio2 = Math.max(0.05, Math.min(3, sc.peak / Math.max(sc.career, 0.01)));
      return career * Math.pow(ratio2, 0.4);
    }
    /* 候选池挂在函数上：调用方遍历 valueOf.pool 即可，不必再各自做一次 inScope */
    valueOf.pool = poolFor(region, country, gender, evs);
    return valueOf;
  }

  /* ★ 性能（2026-11-01）：这里原来会把**所有有分的选手**都塞进数组再整体排序 ——
     早期年份只有几百人有分，播到 2020 年代变成几万人，于是每帧要分配几万个对象、
     排一次几万元素的序，帧时间随播放推进越来越长，画面就「跟不上分数变化」。
     实际只有前 15 名会被画出来，所以改成「只保留前 K 名」的插入式选择：
     绝大多数选手连第 15 名的门槛都过不了，直接跳过，不分配对象、不排序。 */
  function snapshot(mode, fy, smooth, region, country, evs, gender, rtype, dim, topK) {
    const val = mkScorer(mode, smooth, region, country, evs, gender, rtype, dim);
    const K = (topK > 0) ? Math.round(topK) : 0;
    const out = [];
    const ranked = val.pool;
    function makeRow(p, v) {
      return {
        name: p.name, country: p.country, hue: p.hue, id: p.id, iso: p.country,
        value: v, color: countryColor(p.country), flag: window.Charts.flagUri(p.country)
      };
    }
    for (let i = 0; i < ranked.length; i++) {
      const p = ranked[i];
      const v = val(p, fy);
      if (!(v > 0)) continue;
      if (!K) { out.push(makeRow(p, v)); continue; }
      if (out.length >= K && v <= out[out.length - 1].value) continue;
      const row = makeRow(p, v);
      let j = out.length;
      while (j > 0 && out[j - 1].value < v) j--;
      out.splice(j, 0, row);
      if (out.length > K) out.pop();
    }
    if (!K) out.sort(function (a, b) { return b.value - a.value; });
    /* 排名序号 1–15（barRace 画在条形左端外侧） */
    for (let i = 0; i < out.length; i++) out[i].no = i + 1;
    return out;
  }

  /* 暴露给冒烟测试：验证筛选项目确实改变了竞速图结果 */
  P.tlSnapshot = function (evs, fy, rtype, gender, country) {
    return snapshot('cumulative', fy == null ? P.tlEndFy() : fy, false, '', country || '', evs || [], gender || 'all', rtype || 'all');
  };
  /* 暴露给冒烟测试：直接检查泳道 / 竞速图的图表配置（dim 传入 m1..m6 可测单维竞速） */
  P.tlOption = function (view, mode, fy, smooth, metric, region, country, lane, evs, gender, rtype, dim) {
    return tlOption(view || 'race', mode || 'cumulative', fy == null ? P.tlEndFy() : fy, !!smooth,
      metric || 'overall', region || '', country || '', lane || 'single', evs || [], gender || 'all', rtype || 'all', null, dim || '');
  };
  /* 暴露给冒烟测试：范围解析（大洲 / 地区 / 国家 → 纪录链 scope）与纪录类型文案 */
  P.laneScopeOf = laneScopeOf;
  P.recScopeLabel = recScopeLabel;
  P.recScopeBadge = recScopeBadge;
  P.tlDaysBetweenDn = daysBetweenDn;
  /* 供冒烟测试：竞速快照（topK=0 → 全量排序）与登顶时长的内部工具 */
  P._snap = snapshot;
  P.tlCrownSince = crownSince;
  P.tlCrownYmd = daysToYmd;
  P.tlCrownComputeSync = function () {
    const rec = crownCompute({
      mode: 'cumulative', smooth: false, region: '', country: '',
      evs: [], gender: 'all', rtype: 'all', dim: ''
    }, '__smoke', P.tlEndFy(), true);
    return rec ? rec.spells : [];
  };

  /* 重大事件到达提示：给定「上一步 / 当前」两个日期（YYYY-MM-DD），
     返回这一步刚刚跨过的事件（可能多条）。供 app.js 在时间推进时调用。 */
  P.tlMsCrossed = function (prevDate, curDate) {
    if (!TL_MS || !TL_MS.length) return [];
    if (!prevDate) return [];
    const out = [];
    TL_MS.forEach(function (m) {
      const d = m.date || (m.year ? (m.year + '-01-01') : '');
      if (!d) return;
      if (d > prevDate && d <= curDate) out.push(m);
    });
    return out;
  };
  /* 当前时间条位置对应的日期字符串（YYYY-MM-DD） */
  P.tlDateAt = function (idx, step) {
    if (step === 'day' || step == null) {
      const d = new Date(TL_START.getTime() + Math.max(0, Math.min(TL_DAYS, idx)) * 86400000);
      return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
    }
    const info = tlIdxToInfo(idx, step);
    const y = Math.floor(info.fy);
    const m = Math.round((info.fy - y) * 12) + 1;
    return y + '-' + pad2(Math.max(1, Math.min(12, m))) + '-01';
  };
  /* 播放时的「小数天 → 小数年」：idx 是整数天，frac 是天内的小数部分。
     分数按小数年累计，因此条形长度在两天之间连续变化（不再一格一格跳）。 */
  P.tlFyAt = function (idx, frac, step) {
    if (step === 'day' || step == null) {
      const d0 = new Date(TL_START.getTime() + Math.max(0, Math.min(TL_DAYS, idx)) * 86400000);
      return tlDateToFy(d0) + (frac || 0) / 365.25;
    }
    return tlIdxToInfo(idx, step).fy;
  };
  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function markLines() {
    const T = window.Charts.theme();
    const list = (TL_MS || []).filter(function (m) { return m.year >= 2003 && m.year <= 2026; });
    return {
      silent: true, symbol: 'none',
      label: {
        show: true, position: 'insideEndTop', color: T.text, fontSize: 10, rotate: 90,
        formatter: function (p) { return p.name; },
        backgroundColor: 'rgba(127,127,127,.12)', padding: [2, 3], borderRadius: 3
      },
      lineStyle: { color: T.accent || T.text3, type: 'dashed', width: 1.4, opacity: 0.85 },
      data: list.map(function (m) {
        return { xAxis: +m.year, name: (t.isEn() ? (m.en || m.zh) : m.zh).slice(0, 14), lineStyle: m.custom ? { color: T.accent, width: 1.8 } : undefined };
      })
    };
  }

  /* ---------- 纪录链（泳道图）范围解析 ---------- */
  /* 筛选条上的「大洲」和「地区」在本项目里是一一对应的（REGION_OF 把每个洲映射成一个地区），
     所以两者都落到同一条「洲纪录」链上。国家优先于大洲。 */
  function laneScopeOf(region, country) {
    if (country) return 'N:' + String(country).toUpperCase();
    if (region) {
      if (M.continents && M.continents[region]) return 'C:' + region;
      const rf = M.regionOf || {};
      const ks = Object.keys(rf);
      for (let i = 0; i < ks.length; i++) if (rf[ks[i]] === region) return 'C:' + ks[i];
    }
    return 'W';
  }
  function countryLabel(iso) {
    const k = String(iso || '').toUpperCase();
    if (t.isEn()) return (M.countries && M.countries[k]) || k;
    return (M.countriesZh && M.countriesZh[k]) || (M.countries && M.countries[k]) || k;
  }
  function contLabel(code) {
    const c = M.continents && M.continents[code];
    if (!c) return code;
    return t.isEn() ? c.en : c.zh;
  }
  /* 「女子 · 亚洲纪录」这类标签，用于图表 tooltip 抬头 */
  const CONT_EN = { As: 'Asian', Eu: 'European', NAm: 'North American', SAm: 'South American', Oc: 'Oceanian', Af: 'African' };
  function recScopeLabel(scope, gen) {
    let s;
    if (scope === 'W') s = t('tl.rec.world');
    else if (String(scope).indexOf('C:') === 0) {
      const code = scope.slice(2);
      s = (t.isEn() ? (CONT_EN[code] || contLabel(code)) : contLabel(code)) + t('tl.rec.suffix');
    } else s = countryLabel(scope.slice(2)) + t('tl.rec.suffix');
    return (gen === 'f' ? t('tl.rec.women') : '') + s;
  }
  /* 纪录级别「胶囊徽标」（2026-11-02 用户要求：与历史地位排名页的 WR / CR / NR 胶囊同一套外观）
     · 缩写走 WCA 官方口径：WR / AsR / ER / NAR / SAR / AfR / OcR / NR
       —— 洲纪录不写笼统的「CR」，而是落实到具体是哪一洲；
     · cls 只取 WR / CR / NR 三档，用来套 css 里 .rec-chip.lv-* 的配色
       （WR 红 / 洲纪录橙 / NR 绿，与历史地位排名页完全共用，改一处两处同步）；
     · name 是全称（世界纪录 / 大洋洲纪录 / 中国纪录 …），跟在缩写后面显示，
       中英文自动切换；女子纪录把「女子」并进全称。 */
  const CONT_ABBR = { Af: 'AfR', Eu: 'ER', Oc: 'OcR', NAm: 'NAR', As: 'AsR', SAm: 'SAR' };
  function recScopeBadge(scope, gen) {
    let code, cls, name;
    if (scope === 'W') {
      code = 'WR'; cls = 'WR'; name = t('tl.rec.world');
    } else if (String(scope).indexOf('C:') === 0) {
      const c = scope.slice(2);
      code = CONT_ABBR[c] || 'CR'; cls = 'CR';
      name = (t.isEn() ? (CONT_EN[c] || contLabel(c)) : contLabel(c)) + t('tl.rec.suffix');
    } else {
      code = 'NR'; cls = 'NR';
      name = countryLabel(String(scope).slice(2)) + t('tl.rec.suffix');
    }
    return { code: code, cls: cls, name: (gen === 'f' ? t('tl.rec.women') : '') + name };
  }
  /* 日期整数（YYYYMMDD）→ 小数年，口径与 etl/build.js 的 fyOfDn 一致 */
  function dnFy(dn) {
    const s = String(dn || '');
    if (s.length !== 8) return 0;
    const y = +s.slice(0, 4), mo = +s.slice(4, 6), d = +s.slice(6, 8);
    if (!(y > 1900) || mo < 1 || mo > 12 || d < 1 || d > 31) return y || 0;
    const dt = Date.UTC(y, mo - 1, d), y0 = Date.UTC(y, 0, 1);
    const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    return y + (dt - y0) / 86400000 / (leap ? 366 : 365);
  }
  function daysBetweenDn(a, b) {
    const p = function (v) {
      const s = String(v || '');
      if (s.length !== 8) return 0;
      return Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8));
    };
    const x = p(a), y = p(b);
    if (!x || !y) return 0;
    return Math.max(0, Math.round((y - x) / 86400000));
  }

  /* 段的「真实纪录级别」反推（2026-11-01 第五轮）：
     ETL 里同一个成绩会**同时**推进世界 / 洲 / 国家三条链（见 build.js 的 feedRec），
     所以「国家链」里也躺着其实是世界纪录的段、「洲链」里也有世界纪录。
     tooltip 抬头如果只按当前筛选范围写死（筛亚洲就一律写「亚洲纪录」），
     这些段就会标错。这里按「该段是否也出现在更高级别的链里」反推真实级别。
     链是静态数据，结果按「范围 | 口径 | 性别」缓存，只建一次。 */
  const LSEG_SETS = {};
  function chainSegSet(kindKey, gen, scopeKey) {
    const ck = scopeKey + '|' + kindKey + '|' + (gen || '');
    if (LSEG_SETS[ck]) return LSEG_SETS[ck];
    const out = {};
    const arr = (M.laneChains && M.laneChains[ck]) || [];
    for (let i = 0; i < arr.length; i++) {
      const L = arr[i];
      const m = {};
      const segs = L.segs || [];
      for (let j = 0; j < segs.length; j++) {
        const raw = segs[j];
        const dn = raw.fd != null ? raw.fd : raw.fromDn;
        const id = raw.i != null ? raw.i : (raw.id || '');
        if (dn) m[dn + '|' + id] = 1;
      }
      out[L.ev] = m;
    }
    LSEG_SETS[ck] = out;
    return out;
  }

  function tlOption(view, mode, fy, smooth, metric, region, country, lane, evs, gender, rtype, box, dim) {
    if (window.Charts.setLaneI18n) window.Charts.setLaneI18n({
      mo: (t.isEn() ? 'mo' : '个月'), y: (t.isEn() ? 'y' : '年'), day: (t.isEn() ? 'd' : '天'),
      refresh: t('tl.rec.refresh'), times: t('tl.rec.times'),
      click: t('tl.laneClick'),
      /* 分数竞速图 tooltip 的措辞（原来只塞了国家两位码 + 分数，没有可读信息） */
      raceRank: t('tl.race.rank'), raceAhead: t('tl.race.ahead'), raceOfTop: t('tl.race.ofTop'),
      pt: t('tl.race.pt')
    });
    if (view === 'lane') {
      /* 泳道顺序严格按 WCA 官方项目默认顺序（正阶→单手→盲拧→最少步→异形→已停办），
         不依赖数据里 events 数组的偶然顺序，保证纪录持有图的项目排列符合用户预期。 */
      const WCA_ORDER = ['333', '222', '444', '555', '666', '777', '333oh', '333bf', '444bf', '555bf', '333mbf', '333fm', 'clock', 'minx', 'pyram', 'skewb', 'sq1', '333ft', 'magic', 'mmagic', '333mbo'];
      function orderOf(ev) { const i = WCA_ORDER.indexOf(ev); return i < 0 ? 999 : i; }
      /* ★ 筛选联动（2026-11-01 用户反馈「上方的筛选对纪录持有图无效」）：
         之前这里直接拿 M.lanes / M.lanesAvg 全量画，项目、国家、性别、年份区间、
         停办项目、成绩口径六项一律无效。现在逐项接上：
           · 成绩口径：单次 / 平均各有一条世界纪录链（总计对「世界纪录」无意义，退回单次）；
           · 项目：只保留所选项目（多选 / 预设分组 / 单个项目都会落到 evs）；
           · 停办项目：按筛选条的「不计入 / 包含」开关决定是否出现 magic 等已停办项目；
           · 年份区间：段与区间相交才画，并把首尾裁到区间边界；
           · 国家 / 大洲 / 性别：只保留这些选手持有的段（其余留白即「无人持有」）。 */
      const retiredIn = !!(box && box.getAttribute('data-tlretired') === '1');
      const yFrom = parseInt((box && box.getAttribute('data-y0')) || '', 10) || 0;
      const yTo = parseInt((box && box.getAttribute('data-y1')) || '', 10) || 0;
      const useAvg = rtype === 'avg' || (rtype !== 'single' && lane === 'avg');
      const gNeed = (gender && gender !== 'all') ? String(gender).toUpperCase() : '';
      /* ★ 2026-11-01：筛选大洲 / 地区 / 国家 / 性别时，下面画的**不再是「世界纪录里这些人持有
         的片段」**，而是对应范围的**真实纪录链**：
             · 世界（默认）→ 世界纪录；
             · 大洲 / 地区（本项目里两者一一对应）→ 洲纪录；
             · 国家 → 国家纪录；
             · 性别选女 → 对应范围的女子纪录（WCA 不维护女子纪录，ETL 自己按历史最快推进）。
         因此「谁持有」与筛选范围一致，不会出现「筛了中国却有大段空白」这种伪缺口。 */
      const scope = laneScopeOf(region, country);
      const gen = gNeed === 'F' ? 'f' : '';
      const kindKey = useAvg ? 'a' : 's';
      const chainKey = scope + '|' + kindKey + '|' + gen;
      /* 段级抬头：先备好「世界链 / 洲链」的索引，tooltip 抬头跟着每一段自己的级别走 */
      const baseLab = recScopeLabel(scope, gen);
      const baseBadge = recScopeBadge(scope, gen);
      let wSetA = null, cSetA = null, wLabA = '', cLabA = '', wBadgeA = null, cBadgeA = null;
      if (scope !== 'W') {
        wSetA = chainSegSet(kindKey, gen, 'W');
        wLabA = recScopeLabel('W', gen);
        wBadgeA = recScopeBadge('W', gen);
        if (scope.indexOf('N:') === 0) {
          const contA = M.continentOf ? M.continentOf[String(scope.slice(2)).toUpperCase()] : '';
          if (contA) {
            cSetA = chainSegSet(kindKey, gen, 'C:' + contA);
            cLabA = recScopeLabel('C:' + contA, gen);
            cBadgeA = recScopeBadge('C:' + contA, gen);
          }
        }
      }
      /* 旧数据包（还没有 laneChains）退回「世界纪录链 + 按人筛选」的老行为，保证不白屏。 */
      const hasChains = !!(M.laneChains && typeof M.laneChains === 'object');
      let srcLanes;
      if (hasChains) srcLanes = M.laneChains[chainKey] || [];
      else srcLanes = (useAvg ? M.lanesAvg : M.lanes) || [];
      const personFiltered = !hasChains && !!(country || region || gNeed);
      function holderOf(pid) {
        if (!pid) return null;
        if (!M.__byId) { M.__byId = {}; (M.players || []).forEach(function (p) { M.__byId[p.id] = p; }); }
        return M.__byId[pid] || null;
      }
      function personOk(sg) {
        /* 段的 country 是 WCA 原始国名（"Sweden"），而筛选条与 M.continentOf 用的都是 ISO2，
           所以统一用段里的 iso 字段比对。 */
        const iso = String(sg.iso || '').toUpperCase();
        if (country && iso !== String(country).toUpperCase()) return false;
        if (region) {
          const c = M.continentOf[iso];
          if (M.continents[region]) { if (c !== region) return false; }
          else if (M.regionOf[c] !== region) return false;
        }
        if (gNeed) {
          const p = holderOf(sg.id);
          if (!p || String(p.gender || '').charAt(0).toUpperCase() !== gNeed) return false;
        }
        return true;
      }
      /* 段格式归一：新数据是短键压缩格式（f/t/fd/td/h/i/o/s），旧数据是长键（from/to/…）。
         统一成内部结构后，下面的裁剪 / 上色 / 渲染都只认一种。 */
      function segNormalize(sg) {
        const from = sg.f != null ? sg.f : +sg.from;
        const to = sg.t != null ? sg.t : +sg.to;
        const fd = sg.fd != null ? sg.fd : sg.fromDn;
        const td = sg.td != null ? sg.td : sg.toDn;
        const subs = sg.s || sg.subs || (fd ? [fd] : null);
        return {
          from: from, to: to, fromDn: fd, toDn: td,
          holder: sg.h != null ? sg.h : sg.holder,
          iso: sg.o != null ? sg.o : (sg.iso || ''),
          id: sg.i != null ? sg.i : sg.id,
          subs: subs,
          days: sg.days != null ? sg.days : daysBetweenDn(fd, td)
        };
      }
      function clipSeg(sg) {
        const a = +sg.from, b = +sg.to;
        if (!isFinite(a) || !isFinite(b)) return null;
        if (yFrom && b < yFrom) return null;
        if (yTo && a > yTo) return null;
        const f = yFrom ? Math.max(a, yFrom) : a;
        const e = yTo ? Math.min(b, yTo) : b;
        return e > f ? { f: f, e: e } : null;
      }
      const anyFilter = !!yFrom || !!yTo;
      const lanes = srcLanes.slice()
        .filter(function (L) { return (!evs.length || evs.indexOf(L.ev) >= 0) && (retiredIn || !L.retired); })
        .sort(function (a, b) { return orderOf(a.ev) - orderOf(b.ev); })
        .map(function (L) {
          const segs = [];
          (L.segs || []).forEach(function (raw) {
            const sg = segNormalize(raw);
            if (personFiltered && !personOk(sg)) return;
            const c = clipSeg(sg);
            if (!c) return;
            /* 段被年份区间裁过之后，段内的刷新刻度也只留区间内的那些 */
            let subs = sg.subs;
            if (subs && (yFrom || yTo)) {
              const a0 = yFrom || -Infinity, a1 = yTo || Infinity;
              subs = subs.filter(function (dn) { const fy = dnFy(dn); return fy >= a0 && fy <= a1; });
              if (!subs.length) subs = [c.f];
            }
            /* 这一段自己的纪录级别：抬头文字 + 胶囊徽标（同一套判定，只算一次）。
               ⚠ 数据里同一份成绩会同时进 WR / 洲 / 国家三条链，必须按「是否也出现在
               更高级别的链里」反推真实级别，不能按当前筛选范围写死。 */
            const k2 = (sg.fromDn || 0) + '|' + (sg.id || '');
            const isW = !!(wSetA && wSetA[L.ev] && wSetA[L.ev][k2]);
            const isC = !isW && !!(cSetA && cSetA[L.ev] && cSetA[L.ev][k2]);
            const segLv = isW ? wBadgeA : (isC ? cBadgeA : baseBadge);
            /* 段内每一次刷新**各自的**级别（2026-11-02 用户指出）：
               同一个人连续刷纪录时色块是合并的，但这一串刷新并不必然都是抬头那个级别 ——
               典型的是一段以 WR 开场、中途 WR 被别人拿走，之后他再推进的只是洲纪录。
               抬头只能写一个级别，所以逐条算：这个 (刷新日期, 选手) 是否也出现在
               更高级别的链里（判定与段首完全同源），交给 tooltip 标在日期旁边。
               subs 与 slv 一一对应，null 表示没有明细（单次刷新的段）。 */
            let slv = null;
            if (subs && subs.length) {
              slv = subs.map(function (dn) {
                const kk = dn + '|' + (sg.id || '');
                if (wSetA && wSetA[L.ev] && wSetA[L.ev][kk]) return wBadgeA;
                if (cSetA && cSetA[L.ev] && cSetA[L.ev][kk]) return cBadgeA;
                return baseBadge;
              });
            }
            segs.push({
              from: c.f, to: c.e, holder: sg.holder, iso: sg.iso,
              id: sg.id, days: sg.days, fromDn: sg.fromDn, toDn: sg.toDn, subs: subs,
              /* 抬头文字（世界纪录 / 亚洲纪录 / 中国纪录 …） */
              lab: isW ? wLabA : (isC ? cLabA : baseLab),
              /* 抬头胶囊（WR / AsR / OcR / NR …，含配色档 cls 与全称 name） */
              lv: segLv,
              /* 段内每次刷新的胶囊，与 subs 同序（tooltip 只给「与抬头不同级」的日期挂小标签） */
              slv: slv
            });
          });
          return { ev: L.ev, label: evName(M.EV[L.ev] || { zh: L.zh, en: L.en }), segs: segs };
        })
        .filter(function (L) { return L.segs.length > 0 || !anyFilter; });
      /* x 轴范围：有年份筛选就贴合筛选，否则用数据真实跨度（原来写死 2004–2026，
         会把 2003 年起的头几段截在画布外）。 */
      let ax0 = yFrom || 0, ax1 = yTo || 0;
      if (!ax0 || !ax1) {
        let mn = Infinity, mx = -Infinity;
        lanes.forEach(function (L) {
          L.segs.forEach(function (sg) { if (sg.from < mn) mn = sg.from; if (sg.to > mx) mx = sg.to; });
        });
        if (isFinite(mn)) { if (!ax0) ax0 = Math.max(2003, Math.floor(mn)); if (!ax1) ax1 = Math.ceil(mx); }
      }
      if (!isFinite(ax0) || !ax0) ax0 = 2004;
      if (!isFinite(ax1) || !ax1 || ax1 <= ax0) ax1 = ax0 + 1;
      /* 交给外层做「缩放 / 平移」的满量程参考：用户 ctrl+滚轮缩放、alt+滚轮或拖动平移后，
         box.__tlWin 里存的是当前可视窗口，这里把它夹进满量程再作为 x 轴范围。 */
      if (box) { box.__tlFull = { a: ax0, b: ax1 }; }
      let win = (box && box.__tlWin) ? box.__tlWin : null;
      /* 换了筛选范围后旧窗口可能已经完全落在新数据之外，直接失效回到满量程 */
      if (win && (win.b <= ax0 || win.a >= ax1)) { win = null; if (box) box.__tlWin = null; }
      let v0 = ax0, v1 = ax1;
      if (win && win.b > win.a) {
        const w0 = Math.max(ax0, Math.min(win.a, ax1 - 0.5));
        const w1 = Math.min(ax1, Math.max(win.b, ax0 + 0.5));
        if (w1 - w0 > 0.5) { v0 = w0; v1 = w1; }
      }
      const opt = window.Charts.lanes(lanes, {
        y0: v0, y1: v1, laneH: 34,
        empty: t(hasChains && !srcLanes.length ? 'tl.laneNoScope' : 'tl.laneEmpty'),
        recLabel: recScopeLabel(scope, gen)
      });
      /* 纪录持有图不再画重大事件的竖向标注线（用户反馈不好看）；重大事件仅在「分数竞速图」中以弹入/淡出动效呈现 */
      return opt;
    }
    const TOP = 15;
    const rate = loadRate();
    const all = snapshot(mode, fy, smooth, region, country, evs, gender, rtype, dim, TOP); // 已按 value 降序，带 no
    /* 竞速图需要「按选手 id 键控」才能在名次变化时让条形与姓名一起滑动。
       这里维护一个稳定的「选手宇宙」(box.__raceU)：首次或筛选口径变化时，用逐年采样
       把历年进过前 N 名的选手都收进来；之后每帧只在宇宙内更新名次/分数，
       保证 id→数据下标稳定，过渡动画连续（条形、姓名、国旗、分数整体滑动）。 */
    const raceSig = [mode, smooth ? 1 : 0, region, country, evs.join('+'), gender, rtype, dim || ''].join('|');
    let universe = (box && box.__raceU && box.__raceSig === raceSig) ? box.__raceU : null;
    if (box && !universe) {
      universe = buildUniverse(mode, smooth, region, country, evs, gender, rtype, TOP, dim);
      box.__raceU = universe;
      box.__raceSig = raceSig;
    }
    let idList;
    if (universe) {
      idList = universe.slice();
      all.forEach(function (r) { if (r.no <= TOP && universe.indexOf(r.id) < 0) { universe.push(r.id); idList.push(r.id); } });
    } else {
      idList = all.slice(0, TOP).map(function (r) { return r.id; });
    }
    const byId = {};
    all.forEach(function (r) { byId[r.id] = r; });
    const rows = idList.map(function (id) {
      const r = byId[id];
      if (r && r.no <= TOP) {
        /* cname：tooltip 里显示国家**全名**（原来塞的是 ISO 两位码「AU/AU」这种，
           既不好读也没信息量）；no 留作「第 N 名」用。 */
        return { id: r.id, name: r.name, iso: r.iso, cname: countryName(r.iso) || r.iso || '', flag: r.flag, color: r.color, value: r.value, rank: r.no, no: r.no };
      }
      return { id: id, name: '', iso: '', cname: '', flag: '', color: '#cfcfcf', value: 0, rank: TOP + 1, no: TOP + 1 };
    });
    /* ★ 2026-11-01 第七轮修复「姓名/国旗比条形先到位、两者不同步」：
       ECharts 自定义系列的补间只作用于 rect 的 shape（y/宽/高），
       而姓名、国旗、分数这些 text 元素的 style.y **不参与补间** ——
       实测（逐帧采样 #tlChart 的 zrender 元素）：名次一变，
       姓名 y 立刻跳到新槽位（315→286.5），条形中心还在 315，再用约 60ms 缓动追上去。
       单纯加大动画时长只会让「条追人」的错位更久，治不了根。
       改法：不再依赖 ECharts 的元素补间，而是**自己插值「显示名次/显示分数」**——
       每帧把上一帧的显示值往目标值靠一点，条形和姓名都用同一个插值结果绘制，
       于是二者从定义上就不可能不同步。播放时 drawTimeline 本就逐帧调用，
       所以每帧只走一小步，观感是连续平移；非播放状态（拖时间轴 / 切筛选）
       由下面那段 rAF 抖动自己补几帧，补到收敛为止。 */
    if (box) {
      const prev = (box.__raceDisp && box.__raceDisp.sig === raceSig) ? box.__raceDisp.v : null;
      const next = {};
      let moving = false;
      rows.forEach(function (r) {
        if (!r.id) return;
        const p = prev && prev[r.id];
        if (!p) { next[r.id] = { r: r.rank, v: +r.value || 0 }; return; }   /* 首次出现：直接就位 */
        /* 0.58：约 5~6 帧收敛（60fps 下 ≈ 90ms），与原来 60~100ms 的观感相当 */
        const k = 0.58;
        let nr = p.r + (r.rank - p.r) * k;
        let nv = p.v + ((+r.value || 0) - p.v) * k;
        const doneR = Math.abs(nr - r.rank) < 0.004;
        const doneV = Math.abs(nv - (+r.value || 0)) < 0.05;
        if (!doneR || !doneV) moving = true;
        if (doneR) nr = r.rank;
        if (doneV) nv = +r.value || 0;
        next[r.id] = { r: nr, v: nv };
      });
      rows.forEach(function (r) {
        const d = next[r.id];
        if (!d) return;
        /* no 保留真实名次（tooltip「第 N 名」照旧），只把「画在哪一行」换成插值后的 rank */
        r.rank = d.r;
        r.value = d.v;
      });
      box.__raceDisp = { sig: raceSig, v: next };
      /* 非播放状态：自己补帧，把插值走到收敛（播放时由主循环逐帧驱动，不必再补） */
      if (moving && !tlIsPlaying() && !box.__raceEaseRaf) {
        const step = function () {
          box.__raceEaseRaf = 0;
          /* 页面重渲染后旧容器已脱离文档：直接收手，不往幽灵节点里画 */
          if (box.isConnected === false) return;
          try { P.drawTimeline(box); } catch (e) { /* 容器已消失就安静退出 */ }
        };
        box.__raceEaseRaf = (window.requestAnimationFrame ? window.requestAnimationFrame(step) : setTimeout(step, 16));
      }
    }
    /* 登顶时长徽标：记住本帧的榜首（画到条形上的第 1 名），并确保「榜首时间线」已经算过。
       徽标本身由 drawTimeline 在渲染后调用 P.tlCrownPaint 更新，这里只负责把数据挂到容器上。 */
    if (box) {
      box.__raceLeader = (all[0] && all[0].no === 1) ? all[0] : null;
      /* 已经算好（或正在算）就直接复用：之前每次拿到新容器都无条件重算，
         来回切筛选会把同一条榜首时间线反复构建，徽标长时间停在「—」。 */
      let rec = CROWN_CACHE[raceSig];
      if (!rec || (!rec.ready && !rec.busy)) {
        /* 失败也不能把整张图带崩：徽标算不出来就只是不显示 */
        try {
          rec = crownCompute({
            mode: mode, smooth: !!smooth, region: region || '', country: country || '',
            evs: evs || [], gender: gender || 'all', rtype: rtype || 'all', dim: dim || ''
          }, raceSig, P.tlEndFy()) || null;
        } catch (e) { rec = CROWN_CACHE[raceSig] || null; }
      }
      box.__crown = rec || CROWN_CACHE[raceSig] || null;
    }
    return window.Charts.barRace(rows, { top: TOP, duration: rate.anim });
  }

  /* 构建竞速图「选手宇宙」：在若干代表年份采样，把历年进过前 N 名的选手一次性收进来，
     使整段播放过程中名次更替都在已知 id 集合内发生，过渡动画连续。
     只取代表性年份（而非逐年），既覆盖各时代强者，又避免对每位选手逐项目逐年扫描的过高开销。 */
  function buildUniverse(mode, smooth, region, country, evs, gender, rtype, TOP, dim) {
    const ids = [], seen = {};
    const sampleYears = evs && evs.length
      ? [2006, 2010, 2014, 2018, 2022, 2025]
      : [2005, 2010, 2015, 2020, 2025];
    sampleYears.forEach(function (y) {
      const s = snapshot(mode, y, smooth, region, country, evs, gender, rtype, dim, TOP + 8);
      for (let i = 0; i < s.length; i++) {
        const id = s[i].id;
        if (!seen[id]) { seen[id] = 1; ids.push(id); }
      }
    });
    return ids;
  }

  /* ================= 登顶时长（分数竞速图的「世界第一持续了多久」徽标） ================= */
  /* 需求（2026-11-01）：在竞速图上给出「某选手登顶（当前 N 名榜第一）的持续时间」，
     以「xx 天」显示，单击可在「xx 年 xx 月 xx 天」之间切换。
     做法：竞速名次是逐帧算出来的，没有现成的历史时间线，所以这里**按当前筛选口径**
     离线重建一条「榜首时间线」：
       ① 采样 18 个时刻，各做一次全量扫描，取每个时刻的前 10 名 → 候选集（几十人）；
       ② 只在候选集里按周扫描求每个时刻的榜首；
       ③ 榜首换人时用二分把交接点精确到天。
     为什么可以先筛候选集：每位选手的竞速分随时间**单调不减**（年度累计 × 总分的占比），
     榜首只会在各时刻的前列里产生；再加上每周扫描而非一次性求解，漏判的概率极低。
     整个构建按片（每帧一小段）跑，不阻塞主线程；结果按筛选签名缓存，换筛选才重算。 */
  const CROWN_CACHE = {};
  let CROWN_SEQ = 0;
  /* 每发起一次构建就 +1；旧任务在下一个分片边界自检时发现自己已过期就退出，
     避免连续换筛选时堆起一串半成品任务和播放循环抢主线程。 */
  let CROWN_GEN = 0;
  const CROWN_TOP = 10;
  const CROWN_SAMPLES = 18;
  function crownIt(fn) {
    return (window.requestAnimationFrame || function (f) { return setTimeout(f, 16); })(function () {
      try { fn(); } catch (e) { }
    });
  }
  function playerById(pid) {
    if (!pid) return null;
    if (!M.__byId) { M.__byId = {}; (M.ranked || []).forEach(function (p) { M.__byId[p.id] = p; }); }
    return M.__byId[pid] || null;
  }
  /* 年（小数）→ 绝对日序号，用来把「持续时长」换算成准确的天数 / 年月日 */
  function fyToDays(f) {
    const y = Math.floor(f);
    return Date.UTC(y, 0, 1) / 86400000 + (f - y) * (tlIsLeap(y) ? 366 : 365);
  }
  /* 天数 → 「x 年 x 个月 x 天」。从**真实起点日**（startDays，绝对日序号）往后推，
     所以「正好一年」会得到 1 年 0 个月 0 天，而不是因为跨了闰年变成 11 个月 30 天。 */
  function daysToYmd(days, startDays) {
    const n = Math.max(0, Math.round(days));
    const a = new Date((startDays == null ? Date.UTC(2000, 0, 1) / 86400000 : startDays) * 86400000);
    const b = new Date(a.getTime() + n * 86400000);
    let y = b.getUTCFullYear() - a.getUTCFullYear();
    let m = b.getUTCMonth() - a.getUTCMonth();
    let d = b.getUTCDate() - a.getUTCDate();
    if (d < 0) { m--; d += new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), 0)).getUTCDate(); }
    if (m < 0) { y--; m += 12; }
    return { y: Math.max(0, y), m: Math.max(0, m), d: Math.max(0, d) };
  }
  /* 在 [a,b] 内二分出「pid 最早成为榜首」的时刻（a 处还不是，b 处已经是） */
  function refineCrown(list, val, a, b, pid) {
    function leaderAt(t) {
      let bi = -1, bv = 0;
      for (let i = 0; i < list.length; i++) {
        const v = val(list[i], t);
        if (v > bv) { bv = v; bi = i; }
      }
      return bi >= 0 ? list[bi].id : null;
    }
    let lo = a, hi = b;
    for (let i = 0; i < 8; i++) {
      const mid = (lo + hi) / 2;
      if (leaderAt(mid) === pid) hi = mid; else lo = mid;
    }
    return hi;
  }
  function crownCompute(cfg, sig, endFy, sync) {
    const rec = CROWN_CACHE[sig] = { ready: false, spells: [], busy: true, ts: ++CROWN_SEQ };
    /* ★ 只留最新的那一份：换筛选时旧的构建立刻作废。
       以前多次连续换筛选会同时挂起好几条「18 次全量采样 + 每步 240 个周」的分片任务，
       和播放循环抢主线程 —— 表现就是「不停下来就永远算不完、看不到新内容」。
       冒烟测试走 sync 分支，不受影响。 */
    const gen = ++CROWN_GEN;
    const alive = function () { return sync || gen === CROWN_GEN; };
    /* sync = 同步跑完（只给冒烟测试用）；正常路径按片让出主线程 */
    const defer = sync ? function (f) { f(); } : crownIt;
    const val = mkScorer(cfg.mode, cfg.smooth, cfg.region, cfg.country, cfg.evs, cfg.gender, cfg.rtype, cfg.dim);
    const t0 = 2003.25;
    const t1 = Math.max(t0 + 0.5, endFy || P.tlEndFy());
    const samples = [];
    for (let i = 0; i < CROWN_SAMPLES; i++) samples.push(t0 + (t1 - t0) * i / (CROWN_SAMPLES - 1));
    const candIds = [], seen = {};
    let si = 0;
    function sampleTick() {
      if (!alive()) { rec.busy = false; return; }
      const tt = samples[si];
      const best = [];
      const ranked = val.pool;
      for (let i = 0; i < ranked.length; i++) {
        const p = ranked[i];
        const v = val(p, tt);
        if (!(v > 0)) continue;
        if (best.length >= CROWN_TOP && v <= best[best.length - 1].v) continue;
        let j = best.length;
        while (j > 0 && best[j - 1].v < v) j--;
        best.splice(j, 0, { id: p.id, v: v });
        if (best.length > CROWN_TOP) best.pop();
      }
      for (let i = 0; i < best.length; i++) {
        const id = best[i].id;
        if (id && !seen[id]) { seen[id] = 1; candIds.push(id); }
      }
      si++;
      if (si < CROWN_SAMPLES) { defer(sampleTick); return; }
      phaseTwo();
    }
    function phaseTwo() {
      const list = [];
      for (let i = 0; i < candIds.length; i++) {
        const p = playerById(candIds[i]);
        if (p) list.push(p);
      }
      if (!list.length) { rec.busy = false; rec.ready = true; return; }
      const stops = [];
      for (let x = t0; x <= t1; x += 7 / 365.25) stops.push(x);
      const spells = [];
      let prevPid;
      let k = 0;
      function leaderAt(t) {
        let bi = -1, bv = 0;
        for (let i = 0; i < list.length; i++) {
          const v = val(list[i], t);
          if (v > bv) { bv = v; bi = i; }
        }
        return bi >= 0 ? list[bi].id : null;
      }
      function stepTick() {
        if (!alive()) { rec.busy = false; return; }
        let n = 0;
        while (k < stops.length && n < 240) {
          const tt = stops[k];
          const pid = leaderAt(tt);
          if (pid !== prevPid) {
            let from = tt;
            if (k > 0) from = refineCrown(list, val, stops[k - 1], tt, pid);
            spells.push({ pid: pid, from: from });
            prevPid = pid;
          }
          k++; n++;
        }
        if (k < stops.length) { defer(stepTick); return; }
        rec.spells = spells;
        rec.ready = true;
        rec.busy = false;
        /* 缓存上限：签名组合不多，超了先丢最旧的（当前正在用的那份除外） */
        const ks = Object.keys(CROWN_CACHE);
        if (ks.length > 8) {
          ks.sort(function (a, b) { return CROWN_CACHE[a].ts - CROWN_CACHE[b].ts; });
          for (let i = 0; i < ks.length - 8; i++) if (ks[i] !== sig) delete CROWN_CACHE[ks[i]];
        }
        crownRepaint();
      }
      defer(stepTick);
    }
    defer(sampleTick);
    return rec;
  }
  /* 某选手在 fy 时刻「连续登顶」的起点（找不到返回 null） */
  function crownSince(spells, pid, fy) {
    if (!spells || !pid) return null;
    for (let i = spells.length - 1; i >= 0; i--) {
      if (spells[i].pid === pid && spells[i].from <= fy + 1e-6) return spells[i].from;
    }
    return null;
  }
  /* 「登顶 xx 第一」里的 xx —— 跟随上方筛选的纪录范围（世界 / 亚洲 / 欧洲 / 中国 …），
     选了女子再补一个「女子」。数据本身由 crownCompute 按同一口径重建，这里只把说法说对。 */
  function crownScopeName(region, country) {
    /* 筛选值可能是国家码（CN）、大洲码（As）或地区码（如 EastAsia），一律换成可读名称；
       之前直接把 'As' 拼进文案，页面上会出现「登顶As第一」。 */
    if (country) return countryLabel(country);
    if (region) {
      if (M.continents && M.continents[region]) return contLabel(region);
      const o = M.regions && M.regions[region];
      if (o) return t.isEn() ? (o.en || o.zh) : (o.zh || o.en);
      return region;
    }
    return t('tl.crown.world');
  }
  function crownLabel(region, country, gender) {
    const fem = !!(gender && gender !== 'all' && String(gender).charAt(0).toUpperCase() === 'F');
    return t(fem ? 'tl.crown.labelF' : 'tl.crown.labelIn', { scope: crownScopeName(region, country) });
  }
  P.crownLabel = crownLabel;
  function crownEl() { try { return document.getElementById('tlCrown'); } catch (e) { return null; } }

  /* 姓名是否要滚动（2026-11-03 用户要求）：
     名字长到徽标装不下时，过去是打省略号，读不到全名。现在改成「跑马灯」——
     外层 .tl-crown-name 定宽裁剪、内层 .tl-crown-name-in 放两份同样的文字，
     平移 -50%（= 一份文字 + 一个间隔）后从头再来，循环无缝。
     判定方式：先摘掉 .run（回到「只显示一份」的状态）量 scrollWidth 与 clientWidth，
     有溢出才加回去。多留 8px 容差：差距只有一两像素时滚动反而像抖动，不如老实省略。
     时长按「一份文字的宽度 ÷ 34px/s」算，长名滚得慢、短一点的名滚得快，
     但视觉速度恒定 —— 用固定时长会让长名飞快掠过。 */
  function crownNameFit(nm) {
    if (!nm) return;
    nm.classList.remove('run');
    let over = false, oneW = 0;
    try {
      /* 摘掉 .run 后只剩一份文字，此时 scrollWidth 就是「一份文字 + 一个间隔」的宽度，
         正好是滚动一周期要平移的距离（内层是两份，所以是 -50%）。 */
      oneW = nm.scrollWidth || 0;
      over = oneW > nm.clientWidth + 8;
    } catch (e) { over = false; }
    if (!over) { nm.style.removeProperty('--run-dur'); nm.style.removeProperty('--run-x'); return; }
    nm.classList.add('run');
    try {
      /* 一段文字的步进量：优先直接量「第二份相对第一份的偏移」（最准，含两份之间的间隔），
         量不到才退回上面那份 scrollWidth 估值。 */
      let step = oneW;
      const ca = nm.querySelector('.cn-a');
      const cb = nm.querySelector('.cn-b');
      if (ca && cb) { const dd = cb.offsetLeft - ca.offsetLeft; if (dd > 20) step = dd; }
      const dur = Math.max(3.5, Math.min(40, step / 34));
      nm.style.setProperty('--run-x', (-Math.round(step)) + 'px');
      nm.style.setProperty('--run-dur', dur.toFixed(2) + 's');
    } catch (e) { }
  }
  P.crownNameFit = crownNameFit;
  /* 窗口尺寸变了 → 姓名可用宽度也变了，重新判断该省略还是该滚动。
     监听挂在 window 上、只挂一次：徽标节点每次 render() 都会重建，
     若按节点挂监听，来回切筛选会不断累积（旧节点已是幽灵，闭包却还活着）。 */
  let _crownRzT = 0;
  let _crownRzBound = false;
  P.crownBindResize = function () {
    if (_crownRzBound || !window.addEventListener) return;
    _crownRzBound = true;
    window.addEventListener('resize', function () {
      if (_crownRzT) clearTimeout(_crownRzT);
      _crownRzT = setTimeout(function () {
        _crownRzT = 0;
        const cur = crownEl();
        if (cur) crownNameFit(cur.querySelector('.tl-crown-name'));
      }, 180);
    });
  };

  /* 量出一段文字在徽标数值样式下的像素宽，用于把徽标数值区锁定为固定宽度。
     ★ 量的是「上界模板」而不是当前文本：时长会随时间推进、筛选范围变化而增长
     （「96 天」→「1 年 2 个月 20 天」），若按当前文本锁宽，数值位数一变宽度就跟着抖。
     模板用两位数字占位（88 年 88 个月 88 天）：tabular-nums 下同位数等宽，
     WCA 始于 2003 年，年/月/日都不可能超过两位，因此它就是最大显示宽度的上界。
     字体等属性直接从真实元素（dv）的计算样式取，避免与实际渲染的字体族/字重不一致。
     结果按文本缓存，避免逐帧重复测量。 */
  const _crownMeasCache = {};
  /* 两种格式各有一条上界模板：按「当前格式」锁宽即可，不必永远按最长的年月日锁 ——
     锁成最宽值时数值区白占四五十像素，姓名就只剩几个字可显示（用户反馈的名字被截断）。
     天数用 5 位（WCA 至今最长在位约 6000 天）作上界，年月日用两位数字占位。 */
  const CROWN_VAL_TPL = function (fmt) {
    if (fmt === 'ymd') return t.isEn() ? '88y 88mo 88d' : '88 年 88 个月 88 天';
    return t.isEn() ? '99999 d' : '99999 天';
  };
  function measureVal(txt, ref) {
    if (_crownMeasCache[txt] != null) return _crownMeasCache[txt];
    let w = 0;
    try {
      const s = document.createElement('span');
      s.style.cssText = 'position:absolute;left:-9999px;top:0;visibility:hidden;white-space:nowrap;' +
        'font-variant-numeric:tabular-nums';
      let cs = null;
      try { cs = ref && window.getComputedStyle ? window.getComputedStyle(ref) : null; } catch (e2) { cs = null; }
      if (cs && cs.fontSize) {
        s.style.fontFamily = cs.fontFamily || 'system-ui,sans-serif';
        s.style.fontSize = cs.fontSize;
        s.style.fontWeight = cs.fontWeight || '800';
        s.style.letterSpacing = cs.letterSpacing || 'normal';
      } else {
        s.style.cssText += ';font:800 14px system-ui,sans-serif;letter-spacing:-.2px';
      }
      s.textContent = txt;
      document.body.appendChild(s);
      w = s.offsetWidth || 0;
      document.body.removeChild(s);
    } catch (e) { w = 0; }
    if (!w) w = (txt.length || 1) * 9;
    _crownMeasCache[txt] = w;
    return w;
  }
  /* 由 drawTimeline 每帧调用：更新徽标文案（只有天数变化时才写 DOM）。
     2026-11-01 用户要求徽标常驻（六维筛选同一行），所以「还没算完 / 当前时刻没有榜首」时
     不再 hidden（会让整行布局跳一下），而是留在原地显示占位「—」并把状态写到 data-st，
     由 CSS 做半透明 / 呼吸效果。 */
  P.tlCrownPaint = function (box, fy) {
    const el = crownEl();
    if (!el) return;
    /* 一律以「屏幕上那个 #tlChart」为准：传入的 box 可能是上一轮渲染留下、
       已经脱离文档的节点（例如播放循环 / 延迟 rAF 里的闭包），拿它的榜首去写
       徽标会写出一个和画面完全对不上的结果（表现为时长突然变成「—」且不再刷新）。 */
    if (document.getElementById) {
      const live = document.getElementById('tlChart');
      if (live && live !== box && live.getAttribute && live.getAttribute('data-view') === 'race') {
        box = live;
        fy = parseFloat(live.getAttribute('data-fy')) || fy;
      }
    }
    /* 筛选范围变了（大洲 / 国家 / 性别）→「登顶 xx 第一」的说法也要跟着变，
       否则会出现「筛选了中国，徽标还写世界第一」的错配。 */
    const lab = el.querySelector('.tl-crown-lab');
    const labTxt = box ? crownLabel(box.getAttribute('data-tlregion') || '', box.getAttribute('data-tlcountry') || '', box.getAttribute('data-tlgender') || '') : '';
    if (lab && labTxt && lab.textContent !== labTxt) lab.textContent = labTxt;
    const lead = box && box.__raceLeader;
    const rec = box && box.__crown;
    const ready = !!(rec && rec.ready);
    const since = (lead && ready) ? crownSince(rec.spells, lead.id, fy) : null;
    /* 'ok' = 时长已知；'pending' = 榜首时间线还在分片构建；'none' = 当前时刻还没人上榜 */
    const st = (since != null) ? 'ok' : (ready ? 'none' : 'pending');
    const days = (since != null) ? Math.max(0, Math.round(fyToDays(fy) - fyToDays(since))) : -1;
    const fmt = (box && box.__crownFmt === 'ymd') ? 'ymd' : 'd';
    /* ★ 2026-11-01 第五轮：换筛选时徽标不再「先清空、等算完再出现」。
       榜首（姓名 + 国旗）每帧都是现成的（就画在竞速图第 1 条上），先写上去，
       只有「时长」在 pending 阶段显示「—」。这样筛选一改，徽标立刻有反应，
       不会出现「必须暂停才看到内容变化」的观感。 */
    const showName = !!lead && st !== 'none';
    const key = [st, showName ? lead.id : '', days, fmt].join('|');
    if (el.getAttribute('data-k') === key) return;
    el.setAttribute('data-k', key);
    el.setAttribute('data-st', st);
    const nm = el.querySelector('.tl-crown-name');
    const dv = el.querySelector('.tl-crown-val');
    const flag = el.querySelector('.tl-crown-flag');
    if (nm) {
      const nmTxt = showName ? (lead.name || '') : '';
      /* 两份文字都要写（滚动时第二份是接缝后的下一段）；内容没变就不动，
         否则每帧写 textContent 会让 CSS 动画不断从头开始，看着像在抽搐。 */
      const a = nm.querySelector('.cn-a');
      const b2 = nm.querySelector('.cn-b');
      if (a) { if (a.textContent !== nmTxt) a.textContent = nmTxt; }
      if (b2) { if (b2.textContent !== nmTxt) b2.textContent = nmTxt; }
      if (!a && nm.textContent !== nmTxt) nm.textContent = nmTxt;   /* 兜底：老结构 */
      /* 没有榜首时把姓名整块收掉（内层元素常驻，:empty 判不出来），
         否则会留下一个「国旗 + 7px 间隙 + 空姓名」的豁口贴着「登顶 xx 第一」 */
      if (nmTxt) nm.classList.remove('isempty'); else nm.classList.add('isempty');
      /* 姓名会按徽标宽度出省略号，用 title 补上全名（鼠标悬停可读全） */
      if (showName && lead.name) nm.setAttribute('title', lead.name); else nm.removeAttribute('title');
      /* 宽度判定放在写入之后：这一帧名字变了才需要重新判断能不能放下 */
      crownNameFit(nm);
    }
    if (flag) {
      const uri = showName ? window.Charts.flagUri(lead.iso) : '';
      if (uri) { flag.src = uri; flag.hidden = false; } else { flag.removeAttribute('src'); flag.hidden = true; }
    }
    if (!dv) return;
    /* 先按当前格式锁宽度：pending（时长还是「—」）时也锁，否则徽标会先窄后宽跳一下 */
    try { dv.style.minWidth = measureVal(CROWN_VAL_TPL(fmt), dv) + 'px'; } catch (e) { }
    if (since == null) { dv.textContent = '—'; return; }
    const ymd = daysToYmd(days, Math.round(fyToDays(since)));
    const ymdTxt = t.isEn()
      ? ((ymd.y ? ymd.y + 'y ' : '') + (ymd.m ? ymd.m + 'mo ' : '') + ymd.d + 'd')
      : ((ymd.y ? ymd.y + ' 年 ' : '') + (ymd.m ? ymd.m + ' 个月 ' : '') + ymd.d + ' 天');
    /* 数值区宽度已在上面按格式锁定，这里不再重复设置 */
    if (fmt === 'd') dv.textContent = (U.num ? U.num(days) : String(days)) + (t.isEn() ? ' d' : ' 天');
    else dv.textContent = ymdTxt;
  };
  function crownRepaint() {
    /* 构建完成后立刻按当前时间点补画一次（不等下一次 drawTimeline） */
    const boxes = document.querySelectorAll ? document.querySelectorAll('#tlChart') : [];
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (b.getAttribute('data-view') === 'race') P.tlCrownPaint(b, parseFloat(b.getAttribute('data-fy')) || P.tlEndFy());
    }
  }
  P.bindTlCrown = function (box) {
    const el = crownEl();
    if (!el || el.__bound) return;
    el.__bound = true;
    if (P.crownBindResize) P.crownBindResize();
    try { box.__crownFmt = localStorage.getItem('goat-crown-fmt') === 'ymd' ? 'ymd' : 'd'; } catch (e) { box.__crownFmt = 'd'; }
    const btn = el.querySelector('.tl-crown-btn');
    if (!btn) return;
    btn.addEventListener('click', function () {
      /* 点击时重新取一次容器：筛选变化会整页重渲染，闭包里那个 box 可能已经是脱离文档的旧节点 */
      const b2 = document.getElementById('tlChart') || box;
      b2.__crownFmt = (b2.__crownFmt || box.__crownFmt) === 'ymd' ? 'd' : 'ymd';
      try { localStorage.setItem('goat-crown-fmt', b2.__crownFmt); } catch (e) { }
      el.removeAttribute('data-k');
      P.tlCrownPaint(b2, parseFloat(b2.getAttribute('data-fy')) || P.tlEndFy());
    });
  };

  /* ================= 另类统计 ================= */
  const TABS = [
    ['rec', 'top.rec', 'record'], ['part', 'top.part', 'calendar'], ['medal', 'top.medal', 'medal'],
    ['eff', 'top.eff', 'lab'], ['other', 'top.other', 'star']
  ];

  P.topics = function (state) {
    const tab = state.topicTab || 'rec';
    let h = '<div class="page-head reveal"><h1>' + esc(t('top.title')) + '</h1></div>';
    /* 2026-10-27：顶端五个分类标签改用与「图表可视化」页完全相同的 .seg 分段控件，
       不再用下划线 tab —— 用户要求「与其他两个板块风格一致」。 */
    h += '<div class="seg reveal" id="topicTabs">';
    TABS.forEach(function (x) {
      h += '<button data-topic="' + x[0] + '" class="' + (tab === x[0] ? 'on' : '') + '">' + Ic.glyph(x[2]) + ' ' + esc(t(x[1])) + '</button>';
    });
    h += '</div>';

    if (tab === 'other') return h + otherTab(state);

    /* 榜单池 = 全局筛选（国家 / 大洲 / 性别 / 年份区间 / 项目多选）后的选手，
       否则顶部筛选条在另类统计页会完全失效 */
    const pool = P.util.topicPool(state);

    /* 二级筛选表头：按项目过滤（停办项目也可用，与筛选条口径一致）。
       结构与顶部筛选条一致：.fgroup > .flabel + .fctl，视觉上与其他两页同一个控件系统。 */
    const te = state.topicEvent || '';
    h += '<div class="row topic-fbar reveal">';
    h += '<div class="fgroup"><span class="flabel">' + esc(t('top.eventFilter')) + '</span>' +
      '<div class="fctl"><div class="ev-strip ev-strip-topic" role="group" aria-label="' + esc(t('top.eventFilter')) + '">';
    h += '<button class="ev-tab' + (!te ? ' on' : '') + '" data-topicev="">' + esc(t('f.all')) + '</button>';
    M.events.slice().sort(function (a, b) { return (a.retired ? 1 : 0) - (b.retired ? 1 : 0) || a.rank - b.rank; })
      .forEach(function (e) {
        h += '<button class="ev-tab' + (te === e.id ? ' on' : '') + (e.retired ? ' retired' : '') + '" data-topicev="' + e.id + '" title="' + esc(t.isEn() ? e.en : e.zh) + '">' +
          window.Icons.event(e.id) + '<span>' + esc(t.isEn() ? e.en : e.zh) + '</span></button>';
      });
    h += '</div></div></div>';
    h += '</div>'; /* /.topic-fbar（项目筛选） */

    const defs = M.boards[tab] || [];
    h += '<div class="note-box reveal">' + Ic.glyph('info') + '<div>' + esc(t('top.' + tab + '.d')) +
      (tab === 'part' ? ' <b>' + esc(t('stat.mbldNote')) + '</b>' : '') +
      (tab === 'medal' ? ' ' + esc(t('top.medal.d')) : '') +
      (te ? ' <b>' + esc(t('top.eventFiltered')) + '</b>' : '') + '</div></div>';

    /* 指标筛选：同一 tab 下只展示选中的一个排行，其余通过此处切换 */
    const tbKey = (state.topicBoard && defs.some(function (b) { return b.k === state.topicBoard; })) ? state.topicBoard : (defs[0] && defs[0].k);
    if (defs.length > 1) {
      h += '<div class="row topic-fbar reveal">';
      h += '<div class="fgroup"><span class="flabel">' + esc(t('top.board')) + '</span>' +
        '<div class="fctl"><div class="seg" role="group" aria-label="' + esc(t('top.board')) + '">';
      defs.forEach(function (b) {
        h += '<button class="chip' + (b.k === tbKey ? ' on' : '') + '" data-topicboard="' + b.k + '">' + esc(t('stat.' + b.k)) + '</button>';
      });
      h += '</div></div></div>';
      h += '</div>'; /* /.topic-fbar（排行切换） */
    }

    const d = defs.filter(function (b) { return b.k === tbKey; })[0];
    if (d) {
      const list = M.board(tab, d.k, 12, te, pool);
      if (list.length) {
        h += '<div class="card reveal board-card"><div class="card-head"><h2>' + esc(t('stat.' + d.k)) + '</h2>' +
          '<span class="tiny muted">' + (t.isEn() ? 'Top' : '前') + ' ' + list.length + '</span></div>';
        h += '<div class="grid grid-2" style="align-items:start">';
        h += '<div class="table-wrap" style="border:none"><table class="data mini"><thead><tr><th class="tl">#</th><th class="tl">' +
          esc(t('col.player')) + '</th><th class="tl">' + esc(t('col.country')) + '</th><th>' + esc(t('stat.' + d.k)) + '</th></tr></thead><tbody>';
        list.forEach(function (row, i) {
          h += '<tr><td class="tl">' + (i + 1) + '</td>' +
            '<td class="tl"><div class="pname">' + playerLink(row.p) + '</div></td>' +
            '<td class="tl">' + flag(row.p.country) + '</td>' +
            '<td class="num"><b>' + (d.pct ? U.fmt(row.v * 100, 1) + '%' : U.num(row.v)) + '</b></td></tr>';
        });
        h += '</tbody></table></div>';
        h += '<div>' + ecBox('groupBars', list.slice(0, 8).map(function (row, i) {
          return { label: row.p.name.split(' ')[0], value: d.pct ? round(row.v * 100, 1) : row.v };
        }), { rotate: 30 }, 240) + '</div>';
        h += '</div></div>';
      } else {
        h += '<div class="empty reveal">' + esc(t('ui.noresult')) + '</div>';
      }
    }

    if (tab === 'eff') h += sensitivity(state);
    return h;
  };

  function otherTab(state) {
    const sub = state.otherTab || 'king';
    const pool = P.util.topicPool ? P.util.topicPool(state) : M.ranked;
    let h = '<div class="seg reveal" id="otherSeg" style="margin-bottom:12px">';
    [['king', 'top.king'], ['nation', 'top.nation'], ['unknown', 'top.unknown'], ['counter', 'top.counter']].forEach(function (x) {
      h += '<button data-other="' + x[0] + '" class="' + (sub === x[0] ? 'on' : '') + '">' + esc(t(x[1])) + '</button>';
    });
    h += '</div>';
    if (sub === 'king') {
      h += '<p class="tiny muted" style="margin-bottom:12px">' + esc(t('top.king.d')) + '</p>';
      h += '<div class="grid grid-3">';
      M.events.filter(function (e) { return !e.retired; }).forEach(function (e) {
        const best = pool.filter(function (p) { return p.events.indexOf(e.id) >= 0; })[0] || pool[0] || M.ranked[0];
        h += '<div class="card reveal king-card"><div class="row" style="gap:10px">' + Ic.event(e.id, 'ev-ic') +
          '<div><div class="tiny muted">' + esc(evName(e)) + '</div><div style="font-weight:600">' + playerLink(best) + '</div></div></div>';
        h += '<div class="row tiny muted" style="margin-top:8px;gap:12px"><span>' + flag(best.country) + '</span>' +
          '<span>' + notation('w_{e}') + ' ' + U.fmt(e.w, 2) + '</span><span>' + U.fmt(best.overall * (0.5 + e.w / 2), 2) + '</span></div>';
        h += '</div>';
      });
      h += '</div>';
    } else if (sub === 'nation') {
      const metric = state.nationMetric || 'total';
      h += '<p class="tiny muted" style="margin-bottom:12px">' + esc(t('top.nation.d')) + '</p>';
      h += '<div class="seg" id="nationSeg" style="margin-bottom:12px">';
      [['total', 'top.nation.total'], ['per', 'top.nation.per'], ['top', 'top.nation.top']].forEach(function (x) {
        h += '<button data-nation="' + x[0] + '" class="' + (metric === x[0] ? 'on' : '') + '">' + esc(t(x[1])) + '</button>';
      });
      h += '</div>';
      const key = metric === 'per' ? 'perCapita' : (metric === 'top' ? 'best' : 'total');
      const items = M.nations.slice().sort(function (a, b) { return b[key] - a[key]; }).slice(0, 14);
      h += '<div class="card reveal">' + ecBox('groupBars', items.map(function (n) {
        return { label: (countryName(n.iso) || n.iso), value: n[key], color: countryColor(n.iso) };
      }), { top: 14 }, 320) + '</div>';
      h += '<div class="table-wrap reveal"><table class="data mini"><thead><tr><th class="tl">' + esc(t('f.region')) +
        '</th><th class="tl">' + esc(t('f.continent')) + '</th><th>' + esc(t('top.nation.total')) + '</th><th>' +
        esc(t('top.nation.per')) + '</th><th>' + esc(t('top.nation.top')) + '</th><th class="tl">' + esc(t('col.player')) + '</th></tr></thead><tbody>';
      M.nations.slice(0, 24).forEach(function (n) {
        h += '<tr><td class="tl">' + flag(n.iso) + ' ' + esc(countryName(n.iso) || n.name || n.iso) + '</td><td class="tl tiny muted">' + esc(contName(n.continent)) + '</td>' +
          '<td class="num">' + U.num(n.total) + '</td><td class="num">' + U.fmt(n.perCapita, 1) + '</td><td class="num">' + U.fmt(n.best, 2) + '</td>' +
          '<td class="tl tiny">' + esc(n.bestName) + '</td></tr>';
      });
      h += '</tbody></table></div>';
      h += '<p class="tiny muted" style="margin-top:10px">' + esc(t('top.nation.split')) + '</p>';
    } else if (sub === 'unknown') {
      h += '<p class="tiny muted" style="margin-bottom:12px">' + esc(t('top.unknown.d')) + '</p>';
      const list = pool.filter(function (p) { return p.wr === 0; }).slice(0, 40);
      h += '<div class="table-wrap reveal"><table class="data mini"><thead><tr><th class="tl">#</th><th class="tl">' +
        esc(t('col.player')) + '</th><th>' + esc(t('col.total')) + '</th><th>' + esc(t('col.months')) + '</th><th>' +
        esc(t('col.m4')) + '</th><th>' + esc(t('stat.yearsTop10')) + '</th></tr></thead><tbody>';
      list.forEach(function (p, i) {
        h += '<tr><td class="tl">' + (i + 1) + '</td><td class="tl"><div class="pname">' + playerLink(p) + '</div></td>' +
          '<td class="num">' + U.fmt(scoreOf(p).overall, 2) + '</td><td class="num">' + p.months1 + '</td>' +
          '<td class="num">' + U.fmt((p.six && p.six.m4) || 0, 2) + '</td><td class="num">' + Math.round(p.months10 / 12) + '</td></tr>';
      });
      h += '</tbody></table></div>';
    } else {
      const zero = state.counterZero || 'wr';
      h += '<p class="tiny muted" style="margin-bottom:12px">' + esc(t('top.counter.d')) + '</p>';
      h += '<div class="row reveal" style="margin-bottom:12px"><span class="tiny muted">' + esc(t('top.counter.pick')) + '</span>';
      h += '<select id="counterSel">';
      [['wr', 'col.wr'], ['wc', 'col.wc'], ['months', 'col.months'], ['m1', 'col.m1'], ['m2', 'col.m2'], ['m6', 'col.m6']].forEach(function (x) {
        h += '<option value="' + x[0] + '"' + (zero === x[0] ? ' selected' : '') + '>' + esc(t(x[1])) + '</option>';
      });
      h += '</select></div>';
      const base = pool.slice(0, 20);
      const factor = function (p) {
        return zero === 'wr' ? (p.wr ? 0.6 : 1) : zero === 'wc' ? (p.wcGold ? 0.7 : 1) :
          zero === 'months' ? (p.months1 > 12 ? 0.65 : 1) : zero === 'm1' ? 0.7 : zero === 'm2' ? 0.75 : 0.8;
      };
      const after = base.slice().sort(function (a, b) { return scoreOf(b).overall * factor(b) - scoreOf(a).overall * factor(a); });
      h += '<div class="table-wrap reveal"><table class="data mini"><thead><tr><th class="tl">' + esc(t('col.player')) +
        '</th><th>' + esc(t('col.rank')) + '</th><th>' + esc(t('top.counter.result')) + '</th><th>' + esc(t('col.total')) + '</th></tr></thead><tbody>';
      after.forEach(function (p, i) {
        const before = base.indexOf(p) + 1;
        const d = before - (i + 1);
        h += '<tr><td class="tl"><div class="pname">' + playerLink(p) + '</div></td><td class="num">' + before + '</td>' +
          '<td class="num" style="color:' + (d > 0 ? 'var(--m4)' : (d < 0 ? 'var(--m1)' : 'var(--text-3)')) + '">' +
          (d > 0 ? '↑' : (d < 0 ? '↓' : '·')) + ' ' + Math.abs(d) + '</td>' +
          '<td class="num">' + U.fmt(scoreOf(p).overall * factor(p), 2) + '</td></tr>';
      });
      h += '</tbody></table></div>';
    }
    return h;
  }

  /* 权重敏感性：扫描 M1（纪录持有）权重，其余五维按原比例等比缩放保持 Σ=1，
     直接用六维维度分本地重算总分（不再依赖旧 β 参数）。 */
  function sensitivity(state) {
    let h = '<div class="card reveal"><div class="card-head"><h2>' + esc(t('top.sens')) + '</h2>' + infoTip(t('top.sens.d')) + '</div>';
    /* 用「参数设置」页的当前权重做敏感性扫描（而不是写死的默认值） */
    const W = (P.util.sixW && P.util.sixW()) || (M.meta && M.meta.sixWeights) || { m1: 0.45, m2: 0.15, m3: 0.20, m4: 0.15, m5: 0.01, m6: 0.04 };
    const wsum = W.m1 + W.m2 + W.m3 + W.m4 + W.m5 + W.m6;
    for (const kk in W) W[kk] = W[kk] / (wsum || 1);
    const rest0 = 1 - W.m1;
    const pts = [];
    const pool = (P.util.topicPool ? P.util.topicPool(state) : M.ranked).slice(0, 60);
    function totalWith(p, w1) {
      const s = p.six || {};
      let v = w1 * (s.m1 || 0), rest = 0;
      ['m2', 'm3', 'm4', 'm5', 'm6'].forEach(function (k) { rest += (W[k] / (rest0 || 1)) * (s[k] || 0); });
      return v + rest * (1 - w1);
    }
    for (let i = 0; i <= 10; i++) {
      const w1 = 0.05 + i * 0.05;
      let best = null;
      pool.forEach(function (p) {
        const o = totalWith(p, w1);
        if (!best || o > best.o) best = { p: p, o: o };
      });
      if (!best) continue;
      pts.push([round(w1, 2), round(best.o, 1), esc(best.p.name)]);
    }
    if (!pts.length) return '';
    h += ecBox('scatter', pts, { xName: 'w(M1) ' + t('m1.name'), yName: t('col.total') }, 300);
    h += '<p class="tiny muted" style="margin-top:8px">' + esc(t('top.sens.d')) + '</p></div>';
    return h;
  }

  function notation(s) { return '\\(' + s + '\\)'; }
  function round(x, n) { const p = Math.pow(10, n); return Math.round(x * p) / p; }

  /* ================= 评分原理说明 ================= */
  const MD = [
    {
      id: 'overview', h: ['六维模型总览', 'Six-dimension overview'], g: null,
      simple: ['选手总分由六个维度加权合成：每个维度先独立算出「维度分」（榜首归一为 1000，其余按相对值线性缩放），再乘以该维度的权重 w<sub>d</sub>，加权求和即为总分。旧版七模块模型（M1–M7，含 Elo 对战）已整体停用，不再参与任何榜单。',
        'A player total is the weighted sum of six dimensions. Each dimension is normalised so the leader scores 1000, then multiplied by its weight w_d. The old seven-module model (M1–M7, including Elo head-to-head) is retired and no longer feeds any ranking.'],
      f: ['$$t=\\sum_{d}w_{d}\\,s_{d},\\qquad s_{d}=1000\\cdot\\frac{x_{d}}{\\max_{p}x_{d}},\\qquad \\sum_{d}w_{d}=1$$',
        '$$w=(\\underbrace{0.45}_{M1},\\underbrace{0.20}_{M3},\\underbrace{0.15}_{M2},\\underbrace{0.15}_{M4},\\underbrace{0.04}_{M6},\\underbrace{0.01}_{M5})$$'],
      detail: [
        ['六个维度回答六个不同的问题：M1 纪录持有（刷新了多少次纪录，守得久再加分）、M3 大赛表现（锦标赛上突破的加成）、M2 领奖台（拿过多少冠亚季军）、M4 统治力（保持在世界前十有多久）、M6 突破幅度（破纪录瞬间把人类前沿推远多少）、M5 纪录比（最好成绩离世界纪录有多近：100×WR/PB，17 项等权平均）。',
          'The six dimensions answer six different questions: M1 record ownership (how many times records were broken, plus a holding bonus), M3 championship performance, M2 podiums, M4 dominance (time spent inside the world top ten), M6 breakthrough margin (how far a record pushed the human frontier), M5 WR ratio (how close your PB is to the WR: 100 x WR / PB, equally averaged over 17 events).'],
        ['维度分先按各维自己的归一基准映射到站点刻度（FULL=1000）再加权，是为了让六个量纲完全不同的维度（M2 原始量级上万、M6 只有几十）能放在同一把尺子上相加。M5 纪录比用 Kinch 绝对刻度 k=100×WR/成绩；方案 A（2026-11-04）起把整维满分压回 1000，即 s5=10×Kinch均值，不再比其他维高一个量级，权重才具有可读的含义。',
          'Each dimension is mapped onto the site scale (FULL=1000) before weighting so that dimensions with wildly different raw magnitudes (M2 in the tens of thousands, M6 in the tens) can be summed on one ruler. M5 uses the absolute Kinch scale k = 100 x WR / PB; since Plan A (2026-11-04) its full mark is back to 1000 (s5 = 10 x mean Kinch), no longer an order of magnitude above the other dimensions, so the weights mean what they say.'],
        ['跨维相关性已逐对审查（只在两维都非零的人身上算）：目前有两对超过 0.7 — M1 × M6 = 0.769（仅 281 人，且 M6 权重只有 4%）、M1 × M4 = 0.732。二者都是语义近邻（刷新纪录 ⇔ 打得狠 / 长期在世界前十），分年代桶内不降，判定为真实机制而非时代混杂，处置方式是标注并在权重上压制。',
          'All 15 dimension pairs were checked on players non-zero in both: two pairs now exceed 0.7 - M1 x M6 = 0.769 (only 281 players, M6 weighted just 4%) and M1 x M4 = 0.732. Both are semantic neighbours (breaking records vs. raw margin / long top-ten tenure), stable inside decade buckets, so they are documented and discounted by weight.']
      ]
    },
    {
      id: 'm1', h: ['M1 · 纪录持有（权重 45%）', 'M1 · Record ownership (45%)'], g: 'm1',
      simple: ['核心是「你刷新过多少次纪录」：每刷新一次记一份分值，级别越高、属地竞争越激烈越值钱。守得久只是加分项（最多 +50%），不再决定分数高低。',
        'The core is how many times you broke records: each improvement scores once, worth more at a higher tier and in a deeper field. Holding long is only a bonus (up to +50%).'],
      f: ['$$M_{1}=\\sum_{\\text{段}}\\Bigl(\\sum_{k}\\lambda^{\\,n_{k}-1}\\Bigr)\\,V_{L}\\,\\rho_{s}\\,f_{L}\\,w_{e}\\left(1+\\kappa\\,\\frac{\\min(T,30\\,\\text{y})}{30\\,\\text{y}}\\right)$$',
        '$$\\lambda=0.90\\ (\\text{同线递减}),\\qquad \\kappa=0.50\\ (\\text{持有上限}),\\qquad V_{L}\\in\\{\\text{WR},\\text{CR},\\text{NR}\\}$$'],
      detail: [
        ['每一次刷新记 1 份基础分：同一选手在同一条纪录线（项目×轨道×级别×属地）上第 n 次刷新按 λ<sup>n−1</sup> 递减（λ = 0.9），所以「反复刷同一条线」的边际收益越来越低。V<sub>L</sub> 是层级价值（WR 1.0 / CR 0.4 / NR 0.15），ρ<sub>s</sub> 是属地竞争密度，f<sub>L</sub> 是时代折算。',
          'Each improvement scores one base unit: the n-th refresh on the same record line (event x track x level x territory) is discounted by λ^(n-1) with λ = 0.9, so farming one line gives diminishing returns. V_L is the tier value (WR 1.0 / CR 0.4 / NR 0.15), rho_s the territorial field density, f_L the era factor.'],
        ['守得久只作乘子：守满 30 年把这一段放大到 1.5 倍（κ = 0.5），时长是加分项而非主轴；「领先幅度」仍归 M6。防刷分：一条小国 NR 的基础分约 0.15 × ρ（小国 ρ 约 0.001~0.02），即使把一条线刷到底，整个生涯的 NR 合计也压在 1 条 WR 之下 —— 实测全站纯 NR 得分最高者仅约 0.31 分，而 1 条 WR 约 0.8~1.5 分。',
          'Holding is only a multiplier: 30 years caps the segment at 1.5x (kappa = 0.5), so duration is a bonus, not the axis; the margin still belongs to M6. Anti-farming: a small-country NR is worth roughly 0.15 x rho (rho about 0.001-0.02), so even a full career of NRs stays below one WR - the highest pure-NR score on the site is about 0.31, while one WR is about 0.8-1.5.'],
        ['纪录按「刷新当时所代表的国家」归属（取 WCA 成绩表里的登记国，而不是选手今天的国籍）。换过代表国的选手，早年的 NR 仍记在原国家名下 —— 例如 Max Xiong（熊锐明，2015XION03）现籍加拿大，他 2018–2022 年的 10 条中国纪录全部保留在中国。选手页会在纪录明细里标注「当时代表」。',
          'Records belong to the country the competitor represented at the time (taken from the registered country on each WCA result, not the nationality shown on the profile today). For competitors who switched, earlier NRs stay with the original country - Max Xiong (2015XION03) now represents Canada, yet all ten of his Chinese records from 2018-2022 remain Chinese. The player page tags such rows with "Represented".'],
        ['同一条原则也用在**国家总分榜**：总分对每一条得分是线性可加的，因此按「这条得分发生年份所代表的国家」分组求和就能精确拆分（各国之和 ≡ 个人总分，无近似分摊）。全站共 311 位换过代表国的选手被拆到 399 段，所以一位换籍选手会在多个国家的人数里各计一次；未换籍的选手照旧只计入当前国籍。',
          'The same principle applies to the country leaderboard: the total is linear in each contribution, so grouping by the country represented in the year a contribution was earned splits it exactly (country parts sum to the player total, no pro-rating). 311 players have competed for more than one country (399 segments), so a switcher counts once in each country; everyone else still counts only for their current country.']
      ]
    },
    {
      id: 'm2', h: ['M2 · 领奖台（权重 15%）', 'M2 · Podiums (15%)'], g: 'm2',
      simple: ['冠亚季军按 1 / 0.6 / 0.4 加权，并按赛事级别（世锦 / 洲锦 / 国锦 / 公开赛）与赛场强度折算。核心是「融合」：本人成绩强度与当场比赛的对手强度各占一半（α = 0.5）。',
        'Gold/silver/bronze weigh 1 / 0.6 / 0.4, scaled by championship tier and field strength. The core is a blend: own performance and field strength each contribute half (alpha = 0.5).'],
      f: ['$$M_{2}=\\sum_{i}V(r_{i})\\;K_{c}\\;F^{\\text{CSI}}_{i}\\;\\rho_{s},\\qquad V(1):V(2):V(3)=1:0.6:0.4$$',
        '$$F^{\\text{CSI}}=\\left(\\frac{\\text{CSI}}{\\text{CSI}_{\\text{ref}}}\\right)^{\\gamma},\\qquad \\gamma=0.8015$$'],
      detail: [
        ['赛事类型系数 K<sub>OF</sub>：公开赛与国锦 1.0，洲锦与世锦 1.6（参赛资格本身就是壁垒）；外卡 / guest 身份折半。名次权重与「参赛人数越多越难」由 CSI 场次强度统一处理，不再另设人数门槛。',
          'Event-type factors: opens and nationals 1.0, continental and world championships 1.6 (qualification itself is a barrier); guest entries count half. Field strength CSI handles field size.']
      ]
    },
    {
      id: 'm3', h: ['M3 · 大赛表现（权重 20%）', 'M3 · Championship performance (20%)'], g: 'm3',
      simple: ['记录「在锦标赛现场打破纪录」这一额外含金量：同样的 WR，在世界锦标赛上打出来比在一场周末公开赛上打出来更难。只对锦标赛生效，公开赛不计。',
        'Captures the extra value of breaking a record on a championship floor: the same WR is harder at Worlds than at a weekend open. Championship results only.'],
      f: ['$$M_{3}=\\sum_{k}W_{\\text{REC}}(L_{k})\\times W_{\\text{TIER}}(T_{k})$$',
        '$$W_{\\text{REC}}=\\{\\text{WR}:1.0,\\ \\text{CR}:0.4,\\ \\text{NR}:0.15\\},\\qquad W_{\\text{TIER}}=\\{\\text{WC}:1.0,\\ \\text{CC}:0.6,\\ \\text{NC}:0.4\\}$$'],
      detail: [
        ['它与 M1 并存且各计一次：M1 奖励「刷新了几次」，M3 奖励「在什么场合打出来」，两者不重复。NR 给 0.15 是承认国家纪录也是真实突破，但含金量远低于 WR。',
          'It coexists with M1 and each counts once: M1 rewards how many times you broke records, M3 rewards the stage. NR gets 0.15 as a real but much weaker breakthrough.']
      ]
    },
    {
      id: 'm4', h: ['M4 · 统治力（权重 15%）', 'M4 · Dominance (15%)'], g: 'm4',
      simple: ['对「停留在世界前十」这件事做时间积分：不是看你某一天排第几，而是看你在前十里待了多少天、以什么名次待着、那个年代有多少人在竞争。',
        'Integrates "staying inside the world top ten" over time: not where you rank on one day, but how many days you stayed there, at what rank, and how many people were competing then.'],
      f: ['$$M_{4}=\\sum_{e,t}w_{e}\\sum_{\\text{段}}\\frac{\\text{段长}}{365}\\,g(r)\\,f(y),\\qquad g(r)=r^{-1.0}$$',
        '$$f(y)=\\frac{\\ln\\bigl(1+N(y)\\bigr)}{\\ln\\bigl(1+N_{\\text{base}}\\bigr)}$$'],
      detail: [
        ['名次函数取 r<sup>−1.0</sup>：第 1 名是第 10 名的 10 倍，比主模型的衰减更平缓 —— 长年第 5 与长年第 1 的差距不该被放大到十几倍。年代系数 f(y) 用当年参赛人数的对数比，解决「早年人少所以排名水分大」。',
          'The rank function r^-1.0 makes No. 1 worth ten times No. 10, gentler than the main curve. The era factor f(y) uses the log ratio of that year competitor count.'],
        ['当年该项目全球零人参赛时，该年席位直接不计分（取消资格而非打折）—— 否则「没人参赛」会被误读成「压过所有对手」。',
          'If nobody competed in that event that year, the seat scores nothing at all: absence of rivals must not read as dominance over them.']
      ]
    },
    {
      id: 'm5', h: ['M5 · 纪录比（权重 1%）', 'M5 · WR ratio (1%)'], g: 'm5',
      simple: ['唯一用「绝对刻度」的维度：你的最好成绩离世界纪录有多近。每个项目按 k = 100 × WR ÷ PB 打分，世界纪录本人 100 分、慢一倍 50 分；17 个现役项目等权平均，没打过的项目记 0。',
        'The only dimension on an absolute scale: how close your personal best is to the world record. Each event scores k = 100 x WR / PB (WR holder = 100, twice as slow = 50); the 17 active events are averaged equally, and events you never entered count as zero.'],
      f: ['$$K=\\frac{1}{17}\\sum_{e=1}^{17}k_{e},\\qquad k_{e}=100\\times\\frac{WR_{e}}{PB_{e}},\\qquad s_{5}=10\\,K$$'],
      detail: [
        ['选轨对齐 kinchranking.com：多盲 / 四盲 / 五盲取单次，三盲 / 最少步取单次与平均的较优值，其余 12 项取平均。成绩口径切到「单次 / 平均」时，本站用对应轨重算，但分母始终是 17 个现役项目，避免缺项把分数抬高。',
          'Track selection follows kinchranking.com: 333mbf / 444bf / 555bf use single, 333bf / 333fm use the better of single and average, the other 12 use average. Switching the site to Single / Average recomputes M5 from that track alone, while the denominator stays at 17 active events so missing events cannot inflate the score.'],
        ['k 是相对世界纪录的绝对刻度，不按本站榜首归一；站点分 s₅ = 10 × K（整维满分 1000），显示值除以 10 就能与官方 0–100 的 Kinch 核对。本站用 2026-10-15 的 WCA 导出，比参考站新约 10 个月，WR 变动会带来 1 分左右的正常漂移。',
          'k is absolute relative to the WR, not normalised against the site leader. The site score s5 = 10 x K (full mark 1000), so dividing by 10 reproduces the official 0-100 Kinch scale. This site uses the 2026-10-15 WCA export, about ten months newer than the reference site, so WR movement causes a normal drift of roughly one point.']
      ]
    },
    {
      id: 'm6', h: ['M6 · 突破幅度（权重 4%）', 'M6 · Breakthrough margin (4%)'], g: 'm6',
      simple: ['每次刷新世界纪录，你究竟把人类前沿往前推了多远。只看相对幅度：从 5.00 打到 4.00 是把极限推远 22%，从 4.00 打到 3.90 只有 2.5%，两者不该同分。',
        'How far each world record actually pushed the frontier. Only the relative margin counts: 5.00 to 4.00 is 22%, 4.00 to 3.90 is 2.5% - they should not score alike.'],
      f: ['$$M_{6}=\\sum_{\\text{WR 事件}}\\min\\!\\left(\\ln\\frac{\\text{前值}}{\\text{新值}},\\;0.5\\right)$$'],
      detail: [
        ['只统计 WR 链条，且单次刷新截顶 0.5（约 65% 的幅度），避免一条远古的巨幅刷新压过整个生涯；自我刷新同样计分，不做人数或时代折算 —— 这是「高度类」指标，不该被环境稀释。',
          'Only WR chains count, each refresh capped at 0.5 (about 65% margin) so one ancient jump cannot dominate a career; self-refreshes count too, with no era or field discount - this is a height metric, not an environment metric.'],
        ['成绩统一折成「越小越强」后再取对数比：time 用厘秒，number 用步数，multi 先解码成 cost = (99 − diff) × 10<sup>5</sup> + 秒。',
          'All results are folded into a "smaller is stronger" scale before the log ratio: time in centiseconds, FMC in moves, MBLD decoded to cost = (99 - diff) x 1e5 + seconds.']
      ]
    },
    {
      id: 'weights', h: ['维度权重与合成', 'Dimension weights'], g: 'weights',
      simple: ['六维权重由「信息量 + 抗刷分 + 覆盖度」三条原则共同确定，以 M1 为绝对主币（45%），M3 次之（20%），M2 与 M4 并列（各 15%），M5 最低（1%，因为它只是一个截面快照）。',
        'Weights follow three principles - information content, farming resistance and coverage. M1 is the dominant coin at 45%, M3 next at 20%, M2 and M4 tied at 15% each, and M5 lowest at 1% because it is only a cross-section snapshot.'],
      f: ['$$t=0.45\\,s_{M1}+0.20\\,s_{M3}+0.15\\,s_{M2}+0.15\\,s_{M4}+0.04\\,s_{M6}+0.01\\,s_{M5}$$'],
      detail: [
        ['M1 × M6 = 0.769、M1 × M4 = 0.732 是仅有的两对超标相关：刷新纪录越多 ⇔ 打得越狠 / 在榜越久，属真实机制（M6 只覆盖 281 人、权重 4%，影响有限）。合成时按此折扣理解，不额外合并维度。',
          'M1 x M6 = 0.769 and M1 x M4 = 0.732 are the only two pairs above threshold: breaking more records goes with a bigger margin and a longer top-ten tenure - a real mechanism (M6 covers only 281 players at 4% weight). Documented rather than merged away.'],
        ['项目筛选与性别筛选在六维引擎内逐维重算（as-of 年份可任意截取），不是对总分做简单截断；因此「三阶榜」「女子榜」「2015 年为止」都与总榜同一套口径。',
          'Event, gender and as-of filters recompute every dimension inside the engine rather than truncating a total, so per-event, women and as-of boards share one consistent definition.']
      ]
    },
    {
      id: 'uncertainty', h: ['不确定度与敏感性', 'Uncertainty'], g: null,
      simple: ['模型中有若干参数是主观设定的。那就要问：换一套同样讲得通的主观设定，榜单会不会大变？做法是把参数在「同样合理」的区间内扰动、反复重算。',
        'Several parameters are set subjectively, so parameters are perturbed within equally reasonable ranges and the model is recomputed.'],
      f: ['$$\\Pr(\\text{rank}_{i}\\le 10)\\ \\text{由多次重抽样的经验分布给出}$$'],
      detail: [
        ['「第 1 名在绝大多数重算里不变」意味着结论硬；「第 7、8 名在近半数重算里互换」意味着这个名次差不可信，本质只是参数选择的产物。这相当于给榜单加一根误差棒。',
          '"No. 1 unchanged in almost every rerun" is a hard conclusion; "No. 7 and No. 8 swap in nearly half the runs" means that gap is an artefact. This is an error bar for the ranking.']
      ]
    },
    {
      id: 'dataprep', h: ['数据口径与边界', 'Data conventions'], g: null,
      simple: ['数据源为 WCA 官方数据库导出（TSV 永久链接）。锦标赛识别直接用官方 championships 表，不靠比赛名猜测。旧规则多盲可从数值编码自动判别。',
        'The source is the official WCA export (TSV permalink). Championships come from the official championships table; old-style MBLD is detected from its encoding.'],
      f: ['$$\\text{old MBLD}=1SSAATTTTT\\ (\\ge10^{10}),\\qquad \\text{new MBLD}=0DDTTTTTMM\\ (<10^{10})$$'],
      detail: [
        ['数值约定：−1 为 DNF，−2 为 DNS，0 为无成绩；time 单位为厘秒；number 用于最少步；multi 用于多盲。',
          'Conventions: -1 DNF, -2 DNS, 0 no result; time in centiseconds; number for FMC; multi for MBLD.'],
        ['纪录历史没有现成表，需从 results 按日期逐条滚动求最小值来重建 WR / NR / CR 时间轴。国家与洲的归属按成绩发生当时确定。',
          'No record-history table exists: the timeline is rebuilt by scanning results chronologically. Country and continent follow the time of the result.']
      ]
    }
  ];
  P.model = function (state) {
    const en = t.isEn();
    const secId = state.mdSection || (MD[0] && MD[0].id) || 'overview';
    /* 参数设置页的二级导航：本页（参数/原理）↔ 六维分数细则子页面。
       P.sixdimSubTabs 由 pages-sixdim.js 提供；冒烟环境未加载该文件时优雅降级为空。 */
    let h = P.sixdimSubTabs ? P.sixdimSubTabs('doc') : '';
    h += '<div class="page-head reveal"><h1>' + esc(t('md.title')) + '</h1><p class="sub">' + esc(t('md.sub')) + '</p></div>';

    /* 六维权重 / 六维名称：被下方的「六维占比自定义」与「预设」复用，必须在使用前定义。
       注意：原先附带的「总分口径（现行）」卡片已按需求删除，这里只保留两个常量声明。 */
    const SW = (P.util.sixW && P.util.sixW()) || (M.meta && M.meta.sixWeights) || { m1: 0.45, m2: 0.15, m3: 0.20, m4: 0.15, m5: 0.01, m6: 0.04 };
    const SN = (M.meta && M.meta.sixNames) || { m1: '纪录持有', m2: '领奖台', m3: '大赛表现', m4: '统治力', m5: '纪录比', m6: '突破幅度' };

    /* ---- 六维占比自定义：每行「滑杆 + 数字框」，全站榜单立即重排 ----
       旧版是六根竖柱 + 上下拖动柱顶调高度：柱子只有 40 来像素高，
       拖 1 像素就是 2 个多百分点，根本拖不准，触屏上还会误触页面滚动。
       现在换成横向滑杆（行程长、可直接点轨道跳位、键盘方向键可微调）
       加上一个数字输入框（精确到 0.5%），两者双向同步。
       改某一维时其余各维按原比例自动缩放，六维合计恒为 100%。 */
    const CW = (P.util.sixW ? P.util.sixW() : null) || SW;
    let wsum = 0;
    MOD.forEach(function (k) { wsum += (CW[k] || 0); });
    h += '<div class="card reveal"><div class="card-head"><h2>' + esc(t('md.weightsCustom')) + '</h2>' +
      '<span class="tag acc" id="wSum">' + esc(t('md.weightsSum', { s: U.fmt(wsum * 100, 1) })) + '</span></div>' +
      '<p class="tiny muted" style="margin-bottom:10px">' + esc(t('md.weightsHint')) + '</p>' +
      '<div class="wslider" id="wChart">';
    MOD.forEach(function (k) {
      const pct = (CW[k] || 0) * 100;
      const nm = SN[k] || modName(k);
      h += '<div class="wrow" data-wrow="' + k + '">' +
        '<span class="wrow-name"><i class="wdot" style="background:' + MODC[k] + '"></i>' + esc(nm) + '</span>' +
        '<input type="range" class="wrange" data-wdim="' + k + '" min="0" max="100" step="0.5" ' +
        'value="' + U.fmt(pct, 1) + '" aria-label="' + esc(nm) + ' ' + esc(t('player.weight')) + '">' +
        '<input type="number" class="wnum" data-wdim="' + k + '" min="0" max="100" step="0.5" ' +
        'value="' + U.fmt(pct, 1) + '" aria-label="' + esc(nm) + ' ' + esc(t('player.weight')) + '">' +
        '<span class="wrow-unit">%</span>' +
        '</div>';
    });
    h += '</div>' +
      '<div class="row" style="margin-top:10px;gap:8px;flex-wrap:wrap">' +
      '<button class="btn btn-ghost" id="wReset">' + esc(t('md.resetDefault')) + '</button>' +
      '<button class="btn btn-ghost" id="wEven">' + esc(t('md.weightsEven')) + '</button>' +
      '<span class="tiny muted">' + esc(t('md.weightsNote')) + '</span></div></div>';

    /* 预设卡片：仅做预设切换；参数已分散到各章节（不再有单一聚合块） */
    h += '<div class="card reveal md-preset"><div class="row" style="gap:10px;flex-wrap:wrap;align-items:center">';
    h += '<select id="presetSel"><option value="">' + esc(t('md.preset')) + '</option>' +
      Object.keys(Pm.presets).map(function (k) { return '<option value="' + k + '">' + esc(Pm.presets[k][en ? 1 : 0]) + '</option>'; }).join('') +
      '</select>';
    h += '<button class="btn" id="pReset">' + esc(t('md.resetDefault')) + '</button>';
    h += '<span class="tiny muted">' + esc(t('md.paramsHint')) + '</span></div></div>';

    /* ---- 两栏：左目录 + 右详情（一次只展示一个章节） ---- */
    h += '<div class="md-layout">';
    h += '<aside class="md-side card reveal"><div class="md-side-title">' + esc(t('md.toc')) + '</div><nav class="md-nav">';
    MD.forEach(function (s) {
      const on = s.id === secId ? ' on' : '';
      h += '<button class="md-nav-a' + on + '" data-mdsec="' + s.id + '"><span class="md-dot"></span>' + esc(s.h[en ? 1 : 0].replace(/<[^>]+>/g, '')) + '</button>';
    });
    h += '</nav></aside>';

    h += '<div class="md-main">';
    const s = MD.filter(function (x) { return x.id === secId; })[0] || MD[0];
    h += mdSectionHtml(s, en, state);
    h += '</div></div>';

    /* ===== 颜色类设置统一放在页面最下方（按需求：所有颜色设置沉底） ===== */
    /* 模块配色：六个维度的主色可自定义，实时生效并本地保存 */
    const C = Pm.colors();
    h += '<div class="card reveal md-colors" id="mdColors"><div class="md-params-title">' + Ic.glyph('sliders') + ' ' +
      esc(t('md.colors')) + '</div>' +
      '<p class="tiny muted" style="margin:6px 0 10px">' + esc(t('md.colorsHint')) + '</p><div class="md-colors-body">';
    MOD.forEach(function (k) {
      /* 颜色色块：点击弹出取色菜单（RGB 滑杆 + 16 进制输入框 + 取消/确认），不再把 16 进制框直接铺在行内 */
      h += '<div class="crow"><button type="button" class="swatch" data-cmod="' + k + '" data-cmod-label="' + esc(modName(k)) +
        '" style="background:' + esc(C[k]) + '" aria-label="' + esc(modName(k)) + ' 配色"></button>' +
        '<span class="cr-name">' + esc(modName(k)) + '</span></div>';
    });
    h += '<button class="btn btn-ghost" id="mColorReset">' + esc(t('md.resetDefault')) + '</button>';
    h += '</div></div>';

    /* 国家配色：竞速图 / 泳道图按国籍取色，逐国可自定义 */
    const CC = P.countryColorDefaults || {};
    /* 国家配色列表此前只列 COUNTRY_COLORS 里预置的 38 国，用户反馈「有的国家没有显示」。
       这里改为合并「预置国 + 数据里实际出现过的全部国家（M.countryList）」，
       按本地化国名排序；未预置的国家仍由 countryColor() 按国码稳定自动取色，可在此逐个改。 */
    const ccSet = {};
    Object.keys(CC).forEach(function (k) { ccSet[k] = 1; });
    (M.countryList || []).forEach(function (k) { if (k) ccSet[k] = 1; });
    const ccKeys = Object.keys(ccSet).sort(function (a, b) {
      return String(countryName(a) || a).localeCompare(String(countryName(b) || b), 'zh');
    });
    h += '<div class="card reveal md-colors" id="mdCountryColors"><div class="md-params-title">' + Ic.glyph('flag') + ' ' +
      esc(t('md.countryColors')) + '</div>' +
      '<p class="tiny muted" style="margin:6px 0 10px">' + esc(t('md.countryColorsHint')) + '</p>' +
      '<div class="md-colors-body cc-body" id="ccBody">';
    ccKeys.forEach(function (iso) {
      h += '<div class="crow cc-row"><button type="button" class="swatch" data-ccmod="' + iso + '" style="background:' + esc(countryColor(iso)) +
        '" aria-label="' + esc(countryName(iso) || iso) + ' 配色"></button>' +
        '<span class="cc-flag fi fi-' + iso.toLowerCase() + '"></span>' +
        '<span class="cr-name">' + esc(countryName(iso) || iso) + '</span></div>';
    });
    h += '</div><div class="row" style="margin-top:10px;gap:8px;flex-wrap:wrap">' +
      '<button class="btn btn-ghost" id="ccReset">' + esc(t('md.resetDefault')) + '</button></div></div>';

    return h;
  };

  /* 单个章节的 HTML（含简单版 / 详细版切换 + 该章节专属参数） */
  function mdSectionHtml(s, en, state) {
    const key = s.id;
    const detail = state.mdDetail && state.mdDetail[key] === 'detail';
    let h = '<section class="card reveal md-sec" id="md-' + s.id + '">';
    h += '<div class="md-sec-head"><span class="md-sec-ic">' + Ic.glyph('book') + '</span><h2>' + s.h[en ? 1 : 0] + '</h2></div>';
    h += '<div class="md-togglebar"><button class="btn md-tgl' + (detail ? '' : ' on') + '" data-mdtgl="simple">' + esc(t('md.simple')) + '</button>' +
      '<button class="btn md-tgl' + (detail ? ' on' : '') + '" data-mdtgl="detail">' + esc(t('md.detail')) + '</button></div>';
    h += '<div class="md-block md-simple"' + (detail ? ' hidden' : '') + '><p>' + esc(s.simple[en ? 1 : 0]) + '</p></div>';
    h += '<div class="md-block md-detail"' + (detail ? '' : ' hidden') + '>';
    (s.f || []).forEach(function (f) { h += '<div class="fml">' + f + '</div>'; });
    (s.detail || []).forEach(function (d) { h += '<p>' + esc(d[en ? 1 : 0]) + '</p>'; });
    if (s.warn) h += '<div class="warnbox"><b>' + esc(t('md.warn')) + '</b> ' + esc(s.warn[en ? 1 : 0]) + '</div>';
    h += '</div>';
    if (s.g) {
      const grp = Pm.meta.filter(function (x) { return x.g === s.g; })[0];
      if (grp) {
        h += '<div class="md-params"><div class="md-params-title">' + Ic.glyph('sliders') + ' ' + esc(t('md.params')) + '</div><div class="md-params-body">';
        grp.keys.forEach(function (k) {
          const r = Pm.range[k] || [0, 1, 0.01];
          const lb = Pm.label[k] || [k, k];
          h += '<label class="prow"><span class="pr-name">' + esc(lb[en ? 1 : 0]) + '</span>' +
            '<input type="number" class="pr-input" data-pk="' + k + '" value="' + Pm.get(k) + '" min="' + r[0] + '" max="' + r[1] + '" step="' + r[2] + '">' +
            '</label>';
        });
        h += '</div></div>';
      }
    }
    h += '</section>';
    return h;
  }
})();

/* ============================================================
   pages-extra.js — 动态可视化 / 另类统计 / 评分原理说明
   ============================================================ */
(function () {
  const t = window.I18N, U = window.U, M = window.MOCK, Ic = window.Icons, Pm = window.Params;
  const P = window.P || (window.P = {});
  const MOD = P.util.MOD, MODC = P.util.MODC;
  const esc = U.esc;
  const { avatar, flag, playerLink, modName, ecBox, scoreOf, infoTip, evName, contName, countryName } = P.util;

  /* 国家配色：主要国家用本国标志性色，其余按 iso 稳定取色。
     可在「评分原理说明」页逐国自定义（localStorage 持久化，用户覆盖优先）。
     中国红与国旗红几乎同色，图上容易和国旗本身混为一谈 —— 默认已改用更深的绛红。 */
  const CCOL_KEY = 'goat-countrycolors-v1';
  const COUNTRY_COLORS = {
    CN: '#a4121a', HK: '#8f1420', MO: '#00703c', TW: '#1f3d8f',
    US: '#1f4fd8', JP: '#bc002d', KR: '#0047a0', DE: '#111111', GB: '#012169',
    FR: '#0055a4', NL: '#ec0000', PL: '#dc143c', SE: '#006aa7', IT: '#008c45',
    ES: '#aa151b', RU: '#0039a6', UA: '#005bbb', CA: '#d80621', AU: '#00843d',
    BR: '#009b3a', MX: '#006847', IN: '#ff671f', ID: '#e70011', MY: '#010080',
    SG: '#ef3340', TH: '#2d2a4a', VN: '#da251d', PH: '#0038a8', NZ: '#00247d',
    CH: '#d52b1e', NG: '#008751', KE: '#006600', EG: '#ce1126', ZA: '#002395',
    AR: '#5b8cc4', CL: '#0033a0'
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
  /* 默认值按「看得清又不拖沓」来定：60 天/秒约 4 分钟走完 23 年，
     换位补间 260ms 短于大部分相邻帧的累积位移，跟得上播放速度。 */
  const RATE_DEF = { jump: 30, anim: 200, fps: 300 };
  const RATE_META = {
    jump: { min: 1, max: 365, step: 1, unit: () => (t.isEn() ? 'days/s' : ' 天/秒') },
    anim: { min: 0, max: 2500, step: 20, unit: () => 'ms' },
    fps: { min: 60, max: 1000, step: 20, unit: () => 'ms' }
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
      if (o) { const r = Object.assign({}, RATE_DEF, o); Object.keys(RATE_META).forEach((k) => { r[k] = clampRate(k, r[k]); }); return r; }
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
    const fy = state.tlFy || 2025;
    const sl = tlSlider(step, fy);
    const rate = loadRate();

    let h = '<div class="page-head reveal"><h1>' + esc(t('tl.title')) + '</h1><p class="sub">' + esc(t('tl.sub')) + '</p></div>';

    h += '<div class="card reveal">';
    h += '<div class="row tl-top">';
    h += '<div class="fgroup"><span class="flabel">' + esc(t('tl.viewTip')) + '</span><div class="seg" id="tlViewSeg">';
    VIEWS.forEach(function (v) {
      h += '<button data-tlview="' + v[0] + '" class="' + (view === v[0] ? 'on' : '') + '">' + Ic.glyph(v[2]) + ' ' + esc(t(v[1])) + '</button>';
    });
    h += '</div></div>';
    h += '<span class="spacer"></span>';
    /* 「3 期滑动平滑」已按需求移除：它只在中间帧起作用，用户感知不到差别反而多一个开关。 */
    h += '</div>';

    /* 动画速率自定义（仅分数竞速图需要）：默认 30 天/秒，滑杆 + 数字输入框双通道 */
    if (view === 'race') {
      h += '<div class="row tl-top tl-rate" style="margin-top:10px">';
      h += '<span class="flabel">' + esc(t('tl.rate')) + '</span>';
      [['jump', 'tl.rate.jump'], ['anim', 'tl.rate.anim'], ['fps', 'tl.rate.fps']].forEach(function (r) {
        const mt = RATE_META[r[0]];
        h += '<label class="rate-item"><span>' + esc(t(r[1])) + '</span>' +
          '<input type="range" id="tlRate' + r[0] + 'Cap" min="' + mt.min + '" max="' + mt.max +
          '" step="' + mt.step + '" value="' + rate[r[0]] + '" data-rate="' + r[0] + '">' +
          '<input type="number" class="rate-num" id="tlRate' + r[0] + '" min="' + mt.min + '" max="' + mt.max +
          '" step="' + mt.step + '" value="' + rate[r[0]] + '" data-rate="' + r[0] + '" aria-label="' + esc(t(r[1])) + '">' +
          '<b>' + rate[r[0]] + esc(mt.unit()) + '</b></label>';
      });
      h += '<button class="btn btn-ghost" id="tlRateReset">' + esc(t('tl.rate.reset')) + '</button>';
      h += '<span class="tiny muted rate-hint">' + esc(t('tl.rate.step1')) + '</span>';
      h += '</div>';
    }

    h += '<div class="tl-desc"><span class="tl-desc-ic">' + Ic.glyph('info') + '</span>' +
      '<div><b>' + esc(t(view === 'lane' ? 'tl.view.lane' : 'tl.view.race')) + '</b>：' +
      esc(t(view === 'lane' ? 'tl.view.lane.d' : 'tl.view.race.d')) + '</div></div>';

    if (view !== 'lane') {
      h += '<div class="tl-ctl">';
      h += '<button class="btn btn-primary" id="tlPlay">' + esc(state.tlPlaying ? t('tl.pause') : t('tl.play')) + '</button>';
      h += '<input type="range" id="tlRange" min="' + sl.min + '" max="' + sl.max + '" step="' + sl.step + '" value="' + sl.value + '">';
      h += '<span class="tl-year" id="tlYear">' + sl.label + '</span>';
      h += '</div>';
    }

    const chH = view === 'race' ? 520 : Math.max(560, (M.events.length * 46 + 90));
    const geoRegion = (state.geo && state.geo.indexOf('cont:') === 0) ? state.geo.slice(5) : '';
    const geoCountry = (state.geo && state.geo.indexOf('cont:') !== 0 && state.geo) ? state.geo : '';
    /* 当前生效的项目集合（显式多选 / 预设分组 / 单个项目）——供竞速图按项目切换 */
    const evSel0 = state.evSel || [];
    let evsBox = evSel0.slice();
    if (!evsBox.length && state.group && state.group !== 'all' && !M.EV[state.group]) {
      const g = M.presetGroups.filter(function (x) { return x.id === state.group; })[0];
      if (g && g.ids) evsBox = g.ids.slice();
    } else if (!evsBox.length && state.group && M.EV[state.group]) {
      evsBox = [state.group];
    }
    const singleEv = evSel0.length === 1 ? evSel0[0] : (state.group && M.EV[state.group] ? state.group : '');
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
      '" data-region="' + geoRegion + '" data-country="' + geoCountry + '" data-ev="' + evsBox.join(',') +
      '" data-gender="' + (state.gender || 'all') + '" data-type="' + (state.recType || 'all') + '"></div>';

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

    /* 自定义重大事件：三个输入框（项目 / 时间 / 事件内容） */
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
    return h;
  };

  /* 滑块：默认按天步进（30 天/秒），保留年 / 月 / 周切换 */
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
    if (step === 'day' || step == null) {
      const v = tlFyToDayIdx(fy || 2003);
      return { min: 0, max: TL_DAYS, step: 1, value: v, label: tlIdxToInfo(v, 'day').label };
    }
    if (step === 'year') {
      const v = Math.max(2003, Math.min(2025, Math.round(fy)));
      return { min: 2003, max: 2025, step: 1, value: v, label: String(v) };
    }
    if (step === 'month') {
      const v = Math.max(0, Math.min(276, Math.round((fy - 2003) * 12) + 1));
      return { min: 0, max: 276, step: 1, value: v, label: tlIdxToInfo(v, 'month').label };
    }
    const v = Math.max(0, Math.min(1200, Math.round((fy - 2003) * 365.25 / 7) + 1));
    return { min: 0, max: 1200, step: 1, value: v, label: tlIdxToInfo(v, 'week').label };
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
    const fy = parseFloat(box.getAttribute('data-fy')) || 2025;
    const metric = box.getAttribute('data-metric') || 'overall';
    const lane = box.getAttribute('data-lane') || 'single';
    const smooth = box.getAttribute('data-smooth') === '1';
    const region = box.getAttribute('data-region') || '';
    const country = box.getAttribute('data-country') || '';
    const evs = (box.getAttribute('data-ev') || '').split(',').filter(Boolean);
    const gender = box.getAttribute('data-gender') || '';
    const rtype = box.getAttribute('data-type') || 'all';
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
      const opt = tlOption(view, mode, fy, smooth, metric, region, country, lane, evs, gender, rtype, box);
      if (!opt) return null;
      opt.backgroundColor = 'transparent';
      window.Charts.resolveDeep ? window.Charts.resolveDeep(opt) : (function () { })(opt);
      /* 结构（视图 / 模式 / 维度 / 单均 / 项目 / 性别）不变时做增量合并，名次与分数丝滑过渡 */
      const sig = view + '|' + mode + '|' + metric + '|' + lane + '|' + evs.join('+') + '|' + gender + '|' + rtype + '|' + region + '|' + country + '|' + (smooth ? 1 : 0);
      const sameStruct = box.__tlSig === sig;
      /* 播放时每帧都在重画，换位过渡必须短于帧间隔的几倍，否则名次变化会「追不上」
         当前帧、看起来一顿一顿。动画时长滑杆直接决定这段补间的快慢。 */
      /* 播放时把过渡动画设为 0，让「名次 / 姓名 / 分数」每帧同步刷新、不再有延迟感；
         手动拖动时保留一小段过渡（按速率参数缩放），体验更顺。 */
      const animMs = tlIsPlaying() ? 0 : Math.max(0, Math.min(2500, (P.tlRate ? P.tlRate().anim : 800)));
      if (sameStruct) {
        opt.animationDuration = 0;
        opt.animationDurationUpdate = tlIsPlaying() ? 0 : Math.round(animMs * 0.35);
        opt.animationEasingUpdate = 'cubicInOut';
      }
      let inst = null;
      try { inst = window.Charts.render(box, opt, { notMerge: !sameStruct }); } catch (e) { inst = null; }
      box.__tlSig = sig;
      if (inst) { box.removeAttribute('data-ec-fail'); }
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

  /* 分数竞速图：口径与「历史地位排名」完全一致 —— 生涯累计按截至当日的纪录 / 领奖台
     年度分比例缩放，峰谷比保持不变，因此末帧即总榜综合能力分。
     项目筛选与总榜用同一套规则：先按项目裁剪选手池，再按「命中比例」做广度折减
     （0.45~1.00，单项目时恒为 1）。此前这里只裁选手池、不重新计分，
     导致上方筛选项目后下方竞速图几乎不变，已修复。 */
  /* 单项目模式：该项目上的「年度表现」= 当年纪录数 × 3 + 当年金牌数 × 5。
     取的是 evStat 里已有的 recPerYear / goldPerYear（按项目按年统计），
     没有它的话筛选单个项目后竞速图仍会按全项目分数排，等于没联动。 */
  function evYearlyOf(p, ev) {
    const st = M.evStatRaw ? M.evStatRaw(p, ev) : null;
    if (!st) return null;
    const ry = st.recPerYear || {}, gy = st.goldPerYear || {};
    if (!Object.keys(ry).length && !Object.keys(gy).length) return null;
    const y = {};
    Object.keys(ry).forEach(function (k) { y[k] = (y[k] || 0) + (ry[k] || 0) * 3; });
    Object.keys(gy).forEach(function (k) { y[k] = (y[k] || 0) + (gy[k] || 0) * 5; });
    return y;
  }

  function snapshot(mode, fy, smooth, region, country, evs, gender, rtype) {
    /* 选中项目（单项目 / 多项目）时，整张图切换成「所选项目的排名演进」，与上方筛选项目实时联动：
       · 单项目：分数取该项目上的年度表现累计；
       · 多项目：把所选项目的年度表现按截至 fy 的累计求和，得到「多项目综合分」，
         排名随项目选择实时重排（上方筛选项目，下方竞速图即按多项目综合分排名）。
       不选项目时仍用全项目历史地位分（生涯累计 × 年度比例）。 */
    const evList = (evs && evs.length) ? evs : null;
    const key = rtype === 'single' ? 'yearlyS' : (rtype === 'avg' ? 'yearlyA' : 'yearly');
    function cum(p, y) {
      const yv = p[key] || {}; let s = 0;
      for (const k in yv) if (+k <= y) s += yv[k];
      return s;
    }
    function cumF(p, f) {
      const yv = p[key] || {}; let s = 0;
      for (const k in yv) if (+k <= f) s += yv[k];
      const yi = Math.floor(f), frac = f - yi;
      if (frac > 0) s += (yv[yi + 1] || 0) * frac;
      return s;
    }
    const END_Y = 2026;
    const rows = [];
    M.ranked.forEach(function (p) {
      if (!inScope(p, region, country, gender, evs)) return;
      if (evList) {
        /* 多项目（含单项目）：把所选项目的「年度表现」按截至 fy 的累计求和 */
        let all = 0, cur = 0, has = false;
        evList.forEach(function (ev) {
          const y = evYearlyOf(p, ev);
          if (!y) return;
          has = true;
          for (const k in y) { const yy = +k; all += y[k]; if (yy <= fy) cur += y[k]; }
        });
        if (!has || all <= 0 || cur <= 0) return;
        rows.push({
          name: p.name, country: p.country, hue: p.hue, id: p.id, iso: p.country,
          value: cur, color: countryColor(p.country), flag: window.Charts.flagUri(p.country)
        });
        return;
      }
      const all = cum(p, END_Y);
      if (all <= 0) return;
      let cf = cumF(p, fy);
      if (smooth) cf = (cumF(p, fy) + cumF(p, fy - 1) + cumF(p, fy - 2)) / 3;
      const ratio = Math.max(0, Math.min(1, cf / all));
      if (ratio <= 0) return;
      const sc = P.util.scoreOf(p, rtype);
      const career = sc.career * ratio;
      const ratio2 = Math.max(0.05, Math.min(3, sc.peak / Math.max(sc.career, 0.01)));
      const v = career * Math.pow(ratio2, 0.4);
      if (v <= 0) return;
      rows.push({ name: p.name, country: p.country, hue: p.hue, id: p.id, iso: p.country, value: v, color: countryColor(p.country), flag: window.Charts.flagUri(p.country) });
    });
    return rows.sort(function (a, b) { return b.value - a.value; })
      /* 排名序号 1–15（barRace 画在条形左端外侧） */
      .map(function (r, i) { r.no = i + 1; return r; });
  }

  /* 暴露给冒烟测试：验证筛选项目确实改变了竞速图结果 */
  P.tlSnapshot = function (evs, fy, rtype, gender, country) {
    return snapshot('cumulative', fy == null ? 2025 : fy, false, '', country || '', evs || [], gender || 'all', rtype || 'all');
  };
  /* 暴露给冒烟测试：直接检查泳道 / 竞速图的图表配置 */
  P.tlOption = function (view, mode, fy, smooth, metric, region, country, lane, evs, gender, rtype) {
    return tlOption(view || 'race', mode || 'cumulative', fy == null ? 2025 : fy, !!smooth,
      metric || 'overall', region || '', country || '', lane || 'single', evs || [], gender || 'all', rtype || 'all');
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

  function tlOption(view, mode, fy, smooth, metric, region, country, lane, evs, gender, rtype, box) {
    if (window.Charts.setLaneI18n) window.Charts.setLaneI18n({ mo: (t.isEn() ? 'mo' : '个月'), y: (t.isEn() ? 'y' : '年'), day: (t.isEn() ? 'd' : '天') });
    if (view === 'lane') {
      /* 泳道顺序严格按 WCA 官方项目默认顺序（正阶→单手→盲拧→最少步→异形→已停办），
         不依赖数据里 events 数组的偶然顺序，保证纪录持有图的项目排列符合用户预期。 */
      const WCA_ORDER = ['333', '222', '444', '555', '666', '777', '333oh', '333bf', '444bf', '555bf', '333mbf', '333fm', 'clock', 'minx', 'pyram', 'skewb', 'sq1', '333ft', 'magic', 'mmagic', '333mbo'];
      function orderOf(ev) { const i = WCA_ORDER.indexOf(ev); return i < 0 ? 999 : i; }
      const lanes = ((lane === 'avg' ? M.lanesAvg : M.lanes) || []).slice()
        .sort(function (a, b) { return orderOf(a.ev) - orderOf(b.ev); })
        .map(function (L) {
          return { ev: L.ev, label: evName(M.EV[L.ev] || { zh: L.zh, en: L.en }), segs: L.segs };
        });
      const opt = window.Charts.lanes(lanes, { y0: 2004, y1: 2026, laneH: 34 });
      /* 纪录持有图不再画重大事件的竖向标注线（用户反馈不好看）；重大事件仅在「分数竞速图」中以弹入/淡出动效呈现 */
      return opt;
    }
    const TOP = 15;
    const rate = loadRate();
    const all = snapshot(mode, fy, smooth, region, country, evs, gender, rtype); // 已按 value 降序，带 no
    /* 竞速图需要「按选手 id 键控」才能在名次变化时让条形与姓名一起滑动。
       这里维护一个稳定的「选手宇宙」(box.__raceU)：首次或筛选口径变化时，用逐年采样
       把历年进过前 N 名的选手都收进来；之后每帧只在宇宙内更新名次/分数，
       保证 id→数据下标稳定，过渡动画连续（条形、姓名、国旗、分数整体滑动）。 */
    const raceSig = [mode, smooth ? 1 : 0, region, country, evs.join('+'), gender, rtype].join('|');
    let universe = (box && box.__raceU && box.__raceSig === raceSig) ? box.__raceU : null;
    if (box && !universe) {
      universe = buildUniverse(mode, smooth, region, country, evs, gender, rtype, TOP);
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
        return { id: r.id, name: r.name, iso: r.iso, flag: r.flag, color: r.color, value: r.value, rank: r.no, no: r.no };
      }
      return { id: id, name: '', iso: '', flag: '', color: '#cfcfcf', value: 0, rank: TOP + 1, no: TOP + 1 };
    });
    return window.Charts.barRace(rows, { top: TOP, duration: rate.anim });
  }

  /* 构建竞速图「选手宇宙」：在若干代表年份采样，把历年进过前 N 名的选手一次性收进来，
     使整段播放过程中名次更替都在已知 id 集合内发生，过渡动画连续。
     只取代表性年份（而非逐年），既覆盖各时代强者，又避免对每位选手逐项目逐年扫描的过高开销。 */
  function buildUniverse(mode, smooth, region, country, evs, gender, rtype, TOP) {
    const ids = [], seen = {};
    const sampleYears = evs && evs.length
      ? [2006, 2010, 2014, 2018, 2022, 2025]
      : [2005, 2010, 2015, 2020, 2025];
    sampleYears.forEach(function (y) {
      const s = snapshot(mode, y, smooth, region, country, evs, gender, rtype).slice(0, TOP + 8);
      for (let i = 0; i < s.length; i++) {
        const id = s[i].id;
        if (!seen[id]) { seen[id] = 1; ids.push(id); }
      }
    });
    return ids;
  }

  /* ================= 另类统计 ================= */
  const TABS = [
    ['rec', 'top.rec', 'record'], ['part', 'top.part', 'calendar'], ['medal', 'top.medal', 'medal'],
    ['eff', 'top.eff', 'lab'], ['other', 'top.other', 'star']
  ];

  P.topics = function (state) {
    const tab = state.topicTab || 'rec';
    let h = '<div class="page-head reveal"><h1>' + esc(t('top.title')) + '</h1></div>';
    h += '<div class="tabs" id="topicTabs">';
    TABS.forEach(function (x) {
      h += '<button data-topic="' + x[0] + '" class="' + (tab === x[0] ? 'on' : '') + '">' + Ic.glyph(x[2]) + ' ' + esc(t(x[1])) + '</button>';
    });
    h += '</div>';

    if (tab === 'other') return h + otherTab(state);

    /* 榜单池 = 全局筛选（国家 / 大洲 / 性别 / 年份区间 / 项目多选）后的选手，
       否则顶部筛选条在另类统计页会完全失效 */
    const pool = P.util.topicPool(state);

    /* 二级筛选表头：按项目过滤（停办项目也可用，与筛选条口径一致） */
    const te = state.topicEvent || '';
    h += '<div class="ev-filter-head reveal"><span class="ev-filter-label">' + esc(t('top.eventFilter')) + '</span>' +
      '<div class="ev-strip ev-strip-topic" role="group" aria-label="' + esc(t('top.eventFilter')) + '">';
    h += '<button class="ev-tab' + (!te ? ' on' : '') + '" data-topicev="">' + esc(t('f.all')) + '</button>';
    M.events.slice().sort(function (a, b) { return (a.retired ? 1 : 0) - (b.retired ? 1 : 0) || a.rank - b.rank; })
      .forEach(function (e) {
        h += '<button class="ev-tab' + (te === e.id ? ' on' : '') + (e.retired ? ' retired' : '') + '" data-topicev="' + e.id + '" title="' + esc(t.isEn() ? e.en : e.zh) + '">' +
          window.Icons.event(e.id) + '<span>' + esc(t.isEn() ? e.en : e.zh) + '</span></button>';
      });
    h += '</div></div>';

    const defs = M.boards[tab] || [];
    h += '<div class="note-box reveal">' + Ic.glyph('info') + '<div>' + esc(t('top.' + tab + '.d')) +
      (tab === 'part' ? ' <b>' + esc(t('stat.mbldNote')) + '</b>' : '') +
      (tab === 'medal' ? ' ' + esc(t('top.medal.d')) : '') +
      (te ? ' <b>' + esc(t('top.eventFiltered')) + '</b>' : '') + '</div></div>';

    /* 指标筛选：同一 tab 下只展示选中的一个排行，其余通过此处切换 */
    const tbKey = (state.topicBoard && defs.some(function (b) { return b.k === state.topicBoard; })) ? state.topicBoard : (defs[0] && defs[0].k);
    if (defs.length > 1) {
      h += '<div class="ev-filter-head reveal"><span class="ev-filter-label">' + esc(t('top.board')) + '</span><div class="seg" role="group" aria-label="' + esc(t('top.board')) + '">';
      defs.forEach(function (b) {
        h += '<button class="chip' + (b.k === tbKey ? ' on' : '') + '" data-topicboard="' + b.k + '">' + esc(t('stat.' + b.k)) + '</button>';
      });
      h += '</div></div>';
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
            '<td class="tl"><div class="pname">' + avatar(row.p, 'sm') + playerLink(row.p) + '</div></td>' +
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
          '<span>' + notation('w_{e}') + ' ' + U.fmt(e.w, 2) + '</span><span>' + U.fmt(best.overall * (0.5 + e.w / 2), 1) + '</span></div>';
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
          '<td class="num">' + U.num(n.total) + '</td><td class="num">' + U.fmt(n.perCapita, 1) + '</td><td class="num">' + U.fmt(n.best, 1) + '</td>' +
          '<td class="tl tiny">' + esc(n.bestName) + '</td></tr>';
      });
      h += '</tbody></table></div>';
    } else if (sub === 'unknown') {
      h += '<p class="tiny muted" style="margin-bottom:12px">' + esc(t('top.unknown.d')) + '</p>';
      const list = pool.filter(function (p) { return p.wr === 0; }).slice(0, 40);
      h += '<div class="table-wrap reveal"><table class="data mini"><thead><tr><th class="tl">#</th><th class="tl">' +
        esc(t('col.player')) + '</th><th>' + esc(t('col.total')) + '</th><th>' + esc(t('col.months')) + '</th><th>' +
        esc(t('col.elo')) + '</th><th>' + esc(t('stat.yearsTop10')) + '</th></tr></thead><tbody>';
      list.forEach(function (p, i) {
        h += '<tr><td class="tl">' + (i + 1) + '</td><td class="tl"><div class="pname">' + avatar(p, 'sm') + playerLink(p) + '</div></td>' +
          '<td class="num">' + U.fmt(scoreOf(p).overall, 1) + '</td><td class="num">' + p.months1 + '</td>' +
          '<td class="num">' + p.eloPeak + '</td><td class="num">' + Math.round(p.months10 / 12) + '</td></tr>';
      });
      h += '</tbody></table></div>';
    } else {
      const zero = state.counterZero || 'wr';
      h += '<p class="tiny muted" style="margin-bottom:12px">' + esc(t('top.counter.d')) + '</p>';
      h += '<div class="row reveal" style="margin-bottom:12px"><span class="tiny muted">' + esc(t('top.counter.pick')) + '</span>';
      h += '<select id="counterSel">';
      [['wr', 'col.wr'], ['wc', 'col.wc'], ['months', 'col.months'], ['m1', 'col.m1'], ['m2', 'col.m2'], ['m7', 'col.m7']].forEach(function (x) {
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
        h += '<tr><td class="tl"><div class="pname">' + avatar(p, 'sm') + playerLink(p) + '</div></td><td class="num">' + before + '</td>' +
          '<td class="num" style="color:' + (d > 0 ? 'var(--m4)' : (d < 0 ? 'var(--m1)' : 'var(--text-3)')) + '">' +
          (d > 0 ? '↑' : (d < 0 ? '↓' : '·')) + ' ' + Math.abs(d) + '</td>' +
          '<td class="num">' + U.fmt(scoreOf(p).overall * factor(p), 1) + '</td></tr>';
      });
      h += '</tbody></table></div>';
    }
    return h;
  }

  function sensitivity(state) {
    let h = '<div class="card reveal"><div class="card-head"><h2>' + esc(t('top.sens')) + '</h2>' + infoTip(t('top.sens.d')) + '</div>';
    const pts = [];
    const pool = (P.util.topicPool ? P.util.topicPool(state) : M.ranked).slice(0, 60);
    for (let i = 0; i <= 10; i++) {
      const w1 = 0.20 + i * 0.05;
      const save = Pm.get('b1');
      Pm.set('b1', w1); Pm.normalize();
      const top = pool.map(function (p) { return { p: p, o: scoreOf(p).overall }; })
        .sort(function (a, b) { return b.o - a.o; })[0];
      if (!top) { Pm.set('b1', save); Pm.normalize(); continue; }
      pts.push([round(w1, 2), round(top.o, 1), esc(top.p.name)]);
      Pm.set('b1', save); Pm.normalize();
    }
    if (!pts.length) return '';
    h += ecBox('scatter', pts, { xName: 'β₁ ' + t('m1.name'), yName: t('col.total') }, 300);
    h += '<p class="tiny muted" style="margin-top:8px">' + esc(t('top.sens.d')) + '</p></div>';
    return h;
  }

  function notation(s) { return '\\(' + s + '\\)'; }
  function round(x, n) { const p = Math.pow(10, n); return Math.round(x * p) / p; }

  /* ================= 评分原理说明 ================= */
  const MD = [
    {
      id: 'overview', h: ['模型总览', 'Model overview'], g: null,
      simple: ['选手总分由七个模块加权合成。每个模块先算出「原始分」（0–100，已按项目权重与时代折减归一），再乘以该模块的权重 β，最后线性缩放到 1000 分制。',
        'A player score is the weighted sum of seven modules. Each module produces a raw score (0–100), is multiplied by its weight β, and rescaled to a 1000-point scale.'],
      f: ['$$M_{\\text{total}}=\\frac{1000}{100}\\sum_{m=1}^{7}\\beta_{m}\\,M_{m},\\qquad \\sum_{m}\\beta_{m}=1$$',
        '$$\\mathrm{Overall}=C^{\\,\\theta_{C}}\\,P^{\\,1-\\theta_{C}},\\qquad \\text{Balance}=\\log\\frac{C}{P}$$'],
      detail: [
        ['三张榜各自独立排名：生涯长度榜 C、最佳 12 个月巅峰高度榜 P，以及综合总榜。合并用几何平均而非算术平均 —— 算术平均下「生涯 100 + 巅峰 20」和「生涯 60 + 巅峰 60」同为 60 分，但前者是勤恳累积型、后者是又厚又尖型；几何平均给出 54.3 与 60，能正确区分两者，即惩罚偏科。',
          'Three rankings are produced independently: career length C, best 12-month peak P, and the combined ranking. They are merged with a geometric mean rather than an arithmetic one: under an arithmetic mean "career 100 + peak 20" and "career 60 + peak 60" both score 60, yet the first is a volume type and the second is both deep and sharp. The geometric mean gives 54.3 vs 60.'],
        ['七模块：M1 纪录分 · M2 锦标赛 · M3 普通比赛 · M4 统治力 · M5 能力广度 · M6 生涯长度 · M7 elo对战。',
          'The seven modules: M1 records · M2 championship podiums · M3 open podiums · M4 dominance · M5 breadth · M6 career volume · M7 head-to-head strength.']
      ]
    },
    {
      id: 'weights', h: ['模块权重与序数定权', 'Module weights'], g: 'weights',
      simple: ['不需要给出「一个 WR 相当于几个世锦赛冠军」这类比值 —— 只需给出重要性排序，权重由排序反推（ROC 秩次质心法）。所有权重都可以直接修改。',
        'You never need ratios such as "how many world titles is one WR worth": an importance ordering is enough, and the weights are derived from it (rank-order centroid). Every weight is editable.'],
      f: ['$$\\beta_{j}=\\frac{1}{n}\\sum_{k=j}^{n}\\frac{1}{k}\\qquad\\text{(rank-order centroid, ROC)}$$',
        '$$\\beta_{m}\\propto\\ln\\frac{1}{p_{m}}\\qquad\\text{(自信息定权，用于交叉校验)}$$'],
      detail: [
        ['把七个权重想成满足 β₁≥…≥β₇、总和为 1 的组合，相容的组合有无数种。ROC 做的是把所有相容组合取平均，也就是可行域单纯形的质心。Barron–Barrett 的模拟研究显示，在仅有序数信息时 ROC 的期望效用损失最小，优于秩和法与秩倒数法。信息量与结论强度匹配，这才严谨。',
          'Think of the weights as points satisfying β₁ ≥ … ≥ β₇ with sum 1; infinitely many are compatible. ROC averages over all of them, taking the centroid of the feasible simplex. Barron and Barrett show ROC minimises expected utility loss under purely ordinal information.'],
        ['稀缺度自信息定权会独立推出「纪录 > 世锦赛 > 公开赛」，等于把直觉排序从假设变成可验证的推论。若两套方法冲突，冲突项会单独列出待裁决。',
          'Self-information weighting independently derives "records > world titles > opens", turning the intuitive ordering into a testable implication. Any conflict is listed separately.']
      ]
    },
    {
      id: 'rankvalue', h: ['名次价值函数 V(r)', 'Place value'], g: 'rank',
      simple: ['冠军、亚军、季军的价值由同一条幂律曲线给出，全模型只有一个旋钮 λ。冠亚季、世界排名、NR/CR/WR 层级全部共用这条曲线。',
        'Gold, silver and bronze all come from one power-law curve controlled by a single knob λ, shared by podiums, world rankings and record tiers.'],
      f: ['$$V(r)=r^{-\\lambda},\\qquad \\lambda=1.10\\ \\Rightarrow\\ 1:0.47:0.30$$'],
      detail: [
        ['冠亚季 10 / 5 / 2 这组数字找不到单一参数解释：冠/亚 = 2 反推 λ=1，亚/季 = 2.5 反推 λ=2.26，同一组数字解不出一致的 λ，这正是它缺乏说服力的根源。',
          'The 10 / 5 / 2 pattern has no single-parameter justification: gold/silver = 2 implies λ=1 while silver/bronze = 2.5 implies λ=2.26.'],
        ['依据是齐夫定律 / 等级规模法则，λ≈1 是社会科学中反复验证的普适指数。对照：次序统计量强度分 E[z_r]≈Φ⁻¹((N+1−r)/(N+1)) 太平缓（N=100 时第 3 名仍有冠军 81% 的实力），适合纯竞技水平视角，不适合「数头衔」的 GOAT 逻辑。',
          'Basis: Zipf\'s law / the rank-size rule. The order-statistic alternative is too flat (3rd retains 81% of the champion\'s strength in a field of 100).']
      ]
    },
    {
      id: 'eventweight', h: ['项目权重 w<sub>e</sub> 与状态系数', 'Event weight'], g: 'event',
      simple: ['项目权重 = 规模因子 × 深度因子 × 状态系数。规模因子不能直接取人数比值 —— 那会让五盲、多盲这类硬核小众项目权重趋近于零。',
        'Event weight = scale × depth × status. The scale factor must not be a raw head-count ratio, which would drive hardcore niche events towards zero.'],
      f: ['$$\\Lambda(N)=\\sqrt{2\\ln N},\\qquad \\text{Scale}_{e}=\\frac{\\Lambda(N_{e})}{\\Lambda(N_{333})}$$',
        '$$\\text{Depth}_{e}=1+\\eta\\,\\frac{\\bar\\rho_{\\max}-\\bar\\rho_{e}}{\\bar\\rho_{\\max}}$$',
        '$$w_{e}=\\text{Scale}_{e}\\cdot\\text{Depth}_{e}\\cdot\\Xi_{e}$$'],
      detail: [
        ['依据是极值定理（Fisher–Tippett–Gnedenko）：从 N 个独立样本中取最大值的期望水平约为 √(2 ln N)·σ。成为「N 人中的第一」的难度随 N 呈对数级极慢增长，而非线性。三阶 20 万人得 1.00，五盲 2 千人仍得 0.79 —— 在 2000 个专攻五盲的人里当世界第一，并不比在 20 万人里当三阶第一容易 100 倍。',
          'Basis: the Fisher–Tippett–Gnedenko extreme value theorem. The expected maximum of N samples grows like √(2 ln N)·σ, so difficulty grows logarithmically. 3x3x3 with 200k yields 1.00 while 5BLD with 2k still yields 0.79.'],
        ['深度因子用项目间相关性矩阵实算：某项目与其余项目的平均相关性越低，说明它需要独立培养的专项能力越强（如最少步、盲拧类）。同一个相关性矩阵还驱动 M5 的跨项目多样性奖励 —— 一份数据解决两个问题。',
          'The depth factor comes from the event-correlation matrix: lower mean correlation means more independent skill (FMC, blindfolded). The same matrix drives the M5 diversity bonus.'],
        ['状态系数 Ξ：现行 1.00；2027 将停办（魔表）0.85；已停办（脚拧、八板、十二板、旧规则多盲）0.70 —— 赛道已关闭、无法被后来者挑战。新项目不额外惩罚，因为时代折减已经自动给了它低分。',
          'Status Ξ: current 1.00; Clock 0.85; discontinued events 0.70 — the track is closed and can no longer be challenged. New events receive no extra penalty.']
      ],
      warn: ['关键陷阱：人数一律取「该成就发生当年」的值。已停办项目当前人数为 0，用当前值会直接除零或把整项权重归零。',
        'Critical trap: always use the head count of the year the achievement happened. Discontinued events have zero competitors today.']
    },
    {
      id: 'era', h: ['时代折减 S<sub>e</sub>(t) 与领先度 z', 'Era discount'], g: null,
      simple: ['「早年只有 1000 人时破 WR」与「现在十万人破 WR」必须区分。这个差别来自两个正交来源，因此拆成两部分合成。',
        '"Setting a WR among 1,000 people" must differ from doing so among 100,000. The gap has two orthogonal sources.'],
      f: ['$$S_{e}(t)=\\frac{\\Lambda\\!\\left(N_{e}^{\\text{eff}}(t)\\right)}{\\Lambda\\!\\left(N_{e}^{\\text{eff}}(t_{\\text{ref}})\\right)},\\qquad z(t)=\\frac{\\mu_{\\text{elite}}(t)-x}{\\sigma_{\\text{elite}}(t)}$$',
        '$$\\text{score}\\ \\propto\\ S_{e}(t)\\cdot\\bigl(1+k_{r}\\,z\\bigr)$$'],
      detail: [
        ['S<sub>e</sub>(t) 衡量「你击败了多少人」；z(t) 衡量「你比同时代强多少」（elite 为当年前 100）。只做前者不够：2005 年人少，但更关键的是那批人的绝对水平低、训练方法不成熟；只做 z 也不行：2005 年的 3σ 与 2025 年的 3σ 击败的人数不同。',
          'S measures how many people you beat; z measures how far above your contemporaries you stood (elite = top 100 that year). Neither alone suffices.'],
        ['典型 z 落在 1.5–4，因此该修正幅度约 1.2–1.6 倍。效果是「早期破纪录有折扣但不会被抹平」。',
          'Typical z falls in 1.5–4, so the correction spans roughly 1.2–1.6×.']
      ]
    },
    {
      id: 'm1', h: ['M1 · 纪录分', 'M1 · Record score'], g: 'm1',
      simple: ['WR ⊃ CR ⊃ NR 严格嵌套：一个成绩若同时是 WR，它必然也是 CR 和 NR。同一条成绩只按最高层级记一次分，其下层级不再重复计入。破纪录是一次事件，得分在创建那一刻冻结，永不回退。',
        'WR ⊃ CR ⊃ NR is a strict nesting, so a result is scored once at its highest tier. Record-setting is an event: the score freezes at that moment and never decays.'],
      f: ['$$R_{k}=B_{R}\\cdot w_{e}\\cdot S_{e}(t_{k})\\cdot T_{\\tau}\\cdot K_{e}\\cdot G_{g}\\cdot A_{k}\\cdot O_{k}\\cdot\\bigl(1+k_{r}z_{k}\\bigr)$$',
        '$$M_{1}=\\sum_{k}R_{(k)}\\,\\rho_{R}^{\\,k-1}$$',
        '$$\\frac{T_{\\text{sgl}}}{T_{\\text{avg}}}=\\kappa_{0}\\left(\\frac{c_{e}}{\\bar c}\\right)^{\\gamma},\\qquad K_{e}=\\left(\\frac{2}{L_{e}}\\right)^{\\upsilon}$$'],
      detail: [
        ['层级系数 G<sub>g</sub>：WR = 1；CR 与 NR 由该地区该项目历年第一名的实际世界排名中位数反推，G = V(r̄)/V(1)。这样「中国 NR 高于美国 NR」是数据算出来的，且分项目、分年代自动变化。',
          'Tier G: WR = 1; CR and NR are back-derived from the median world ranking of that region\'s historical No.1, G = V(r̄)/V(1). "China\'s NR outranks the US NR" then falls out of the data.'],
        ['为什么 NR 不用参赛人数比：人数是「潜在竞争者」，而实际世界排名是「已实现的最强水平」，后者才是 NR 含金量的直接证据；且两者共用同一条 V(r)，比例天然自洽。',
          'Why not a head-count ratio for NR: head count is potential competition, whereas realised world ranking is the direct evidence of value.'],
        ['单次与平均：κ₀=0.6 的来源是纯统计口径（Ao5 均值的标准差为单次的 1/√5，应给 0.447）与「单次衡量能力上限」之间的折中；γ=0.5 是阻尼，避免线性反比失控。',
          'Single vs average: κ₀ = 0.6 splits the difference between the statistical answer (an Ao5 mean has 1/√5 the SD, giving 0.447) and the ceiling view; γ = 0.5 damps the ratio.'],
        ['单线项目（多盲只有单次成绩）令 T<sub>sgl</sub>=1 不打折 —— T 本质是同一项目内两条线的相对权重，多盲没有对照物。另给纪录线数补偿 K<sub>e</sub>：三阶 K=1，多盲 K=√2。最少步有平均，按两条线处理；只有多盲是单线。',
          'Single-line events (MBLD) set T_sgl = 1: T is a relative weight between two lines, and MBLD has no counterpart. A line-count compensation K_e applies instead. FMC has averages and is a two-line event.']
      ]
    },
    {
      id: 'podium', h: ['M2 / M3 · 锦标赛与赛事强度', 'M2 / M3 · Podiums'], g: 'm2',
      simple: ['领奖台得分 = 项目权重 × 时代折减 × 名次价值 × 赛级加成 × 赛事强度 × 小幅修正。赛事强度 CSI 是国际象棋「锦标赛等级」的魔方版：用参赛名单的实力之和定义赛事级别。',
        'A podium score = event weight × era discount × place value × tier bonus × field strength × small corrections. CSI is the cubing analogue of a chess tournament category.'],
      f: ['$$P_{i}=B_{P}\\cdot w_{e}\\cdot S_{e}(t)\\cdot T^{\\text{pod}}\\cdot V(r_{i})\\cdot C_{c}\\cdot F^{\\text{CSI}}_{i}\\cdot\\bigl(1+k_{p}z_{i}+\\mu m_{i}\\bigr)$$',
        '$$\\text{CSI}(c,e)=\\sum_{i\\in\\text{field}}q_{i}(t),\\qquad F^{\\text{CSI}}=\\left(\\frac{\\text{CSI}}{\\text{CSI}_{\\text{ref}}}\\right)^{\\kappa}$$',
        '$$M_{3}=\\sum_{i=1}^{n}P_{(i)}\\,i^{-\\alpha_{O}}$$'],
      detail: [
        ['难度系数夹在 [0.35, 3]；夺冠幅度 m 超过 5% 的碾压式胜利给 1+1.5m 的小加成；参赛人数不足 15 时乘 (n/15)<sup>0.5</sup>。',
          'The difficulty factor is clamped to [0.35, 3]; a margin above 5% earns 1 + 1.5m; under 15 competitors multiply by (n/15)^0.5.'],
        ['公开赛防刷：不设计数硬上限（会造成大量选手得分被截断到同一值）。改为幂律递减，得分永不饱和、与参赛数的平方根成正比 —— 参赛量翻 4 倍得分只翻 2 倍。再叠加低模块权重、人数门槛、CSI 下限与单场单计。',
          'Open anti-farming: no hard cap (a cap truncates many players to identical scores). A power-law decay keeps the score unsaturated and proportional to √n.']
      ],
      warn: ['锦标赛加成容易与 CSI 重复计分：若 CSI 已算出「世锦赛赛场确实强 3 倍」，再给世锦赛 ×3 就是双倍计分。加成本应只补 CSI 抓不到的三样东西 —— 稀缺性（世锦赛两年一届）、资格壁垒、历史声望。',
        'Championship bonuses double-count with CSI. The bonus should only cover scarcity, qualification barriers and prestige.']
    },
    {
      id: 'm4', h: ['M4 · 统治力', 'M4 · Dominance'], g: null,
      simple: ['不统计「当前世界排名」：它会系统性惩罚不再参赛的选手，且与成就模块高度共线。改为直接对每天的排名做时间积分，一个公式同时涵盖世界第一在位月数、前十累计月数与前 100 占席。',
        'Current ranking is not used: it penalises players who stop competing and is collinear with the achievement modules. Instead the ranking is integrated over time.'],
      f: ['$$M_{4}=B_{D}\\sum_{e}\\int_{0}^{T}S_{e}(t)\\,r_{p,e}(t)^{-\\lambda_{D}}\\,\\mathrm{d}t$$'],
      detail: [
        ['第 1 名满额 1.00，前 3 名 0.85，第 10 名 0.15，第 100 名 0.02，100 名以外保留 0.01 的底噪 —— 名次再靠后也仍有过一次成绩的痕迹，不至于让该模块对绝大多数选手恒为 0。该衰减比主函数的 1.1 次幂平缓得多：长期稳居第 5 与第 1 的差距不该被放大到十几倍。',
          'Rank 1 scores in full (1.00), the top 3 get 0.85, rank 10 gets 0.15, rank 100 gets 0.02, and beyond that a small floor of 0.01 keeps a trace of having competed at all instead of zeroing out the module for almost everyone. This decay is far gentler than the main 1.1 power: staying near rank 5 for years should not be amplified into a tenfold gap against rank 1.'],
        ['该模块与 M5 广度可能存在重复计分风险。建模后需计算两模块相关系数，若 |ρ|>0.7 则合并或下调 M5。',
          'This module risks double-counting with M5 breadth; if |ρ| > 0.7 they are merged or M5 discounted.']
      ]
    },
    {
      id: 'm5', h: ['M5 · 能力广度与附加分', 'M5 · Breadth & bonuses'], g: 'm5',
      simple: ['不为「多盲 + 斜转」这类组合写规则表 —— 17 个项目的组合是 2<sup>17</sup>，写不完。改用参与比的相关矩阵推广，一把解决任意多种项目组合，且边际自动递减。',
        'No rule table for pairs: 17 events admit 2^17 combinations. The inverse participation ratio generalised with the correlation matrix handles any number of events.'],
      f: ['$$\\text{Breadth}=\\frac{\\bigl(\\sum_{e}s_{e}\\bigr)^{2}}{\\sum_{e}\\sum_{f}\\sqrt{s_{e}s_{f}}\\,\\rho_{ef}},\\qquad \\text{bonus}\\propto\\text{Breadth}^{\\theta}-1$$',
        '$$\\text{Bonus}=\\min\\bigl(n_{g}c_{g}+\\mathbb{1}_{\\text{全项目}}c_{a},\\ \\text{cap}\\bigr)$$'],
      detail: [
        ['ρ 越高（三阶与二阶）几乎不加分；ρ 越低（多盲与斜转）显著加分；三个互不相关的项目继续加分。分子用 (Σs<sub>e</sub>)<sup>2</sup>、分母带 √(s<sub>e</sub>s<sub>f</sub>) 的含义是：必须两个项目都真的强才拿得到分，随便刷一个慢速成绩贡献趋近于零。',
          'High ρ earns almost nothing; low ρ earns a lot. The (Σs)² numerator with a √(s_e s_f) denominator means both events must genuinely be strong.'],
        ['组内全覆盖为附加小奖励：分组为盲拧组 / 高阶组 / 异形组 / 速拧组 / 最少步，要求组内每个项目都有成绩且 z<sub>e</sub> ≥ −1.0 才算，每组 +2%，全项目额外 +3%，硬性封顶 5%。分数刻意做小，防止选手靠慢成绩刷这个加分。',
          'Group coverage is a small bonus requiring every event in a group to have a result with z_e ≥ −1.0: 2% per group, 3% for full coverage, capped at 5%.']
      ]
    },
    {
      id: 'm6', h: ['M6 · 生涯长度', 'M6 · Career length'], g: 'm6',
      simple: ['年限与场次全部走 ln(1+x)，并做机会校正 —— 除以该选手所在地区当年可参赛场次的对数。权重仅 2.0%，是七项中最低的。',
        'Years and competitions use ln(1+x) plus an opportunity correction. The module carries the lowest weight at 2.0%.'],
      f: ['$$M_{6}=B_{L}\\ln(1+\\text{years})+B_{C}\\ln(1+\\text{comps})-\\text{opportunity correction}$$'],
      detail: [
        ['机会校正很重要：非洲、南美不少强手一年只有两三场比赛可打，不做校正他们会系统性吃亏。本模块的作用是小幅奖励长期稳定投入，而不是让「参赛勤奋度」主导榜单。',
          'The opportunity correction matters: many strong players in Africa and South America can only reach two or three events a year.']
      ]
    },
    {
      id: 'm7', h: ['M7 · elo对战（BT / Elo）', 'M7 · Elo H2H'], g: 'm7',
      simple: ['把所有同场同项目的成对胜负喂进 Bradley–Terry 模型，极大似然估出每个人的强度 γ，带时间衰减，取生涯峰值参与计分。赢强者涨分多、赢弱者涨分少。',
        'All pairwise results within an event and round feed a Bradley–Terry model; each γ is estimated by maximum likelihood with time decay, and the career peak enters the score.'],
      f: ['$$P(i\\succ j)=\\frac{\\gamma_{i}}{\\gamma_{i}+\\gamma_{j}},\\qquad \\mathcal{L}=\\prod_{(i,j)}P(i\\succ j)^{w_{ij}},\\ w_{ij}=2^{-\\Delta t/h}$$'],
      detail: [
        ['它的价值在于天然内嵌了「对手强度」与「时代强度」，不需要额外归一化；而且靠跨年代活跃选手做链式锚定（2010 与 2020 都活跃的人把两个年代的刻度连起来）。这是全模型唯一一个「直接交锋」维度的证据。',
          'Opponent strength and era strength are built in, and players active across decades chain the scales together. This is the only direct head-to-head evidence in the model.']
      ]
    },
    {
      id: 'combine', h: ['三榜合成', 'Ranking combination'], g: 'combine',
      simple: ['生涯长度 C 与巅峰高度 P 用加权几何平均合成综合总榜，几何平均惩罚偏科。均衡度 log(C/P) 说明这人是靠什么进的榜。',
        'Career C and peak P are merged with a weighted geometric mean that punishes lopsidedness; balance = log(C/P) shows what a ranking is built on.'],
      f: ['$$\\mathrm{Overall}=C^{\\,\\theta_{C}}P^{\\,1-\\theta_{C}},\\qquad \\text{Balance}=\\log\\frac{C}{P}$$'],
      detail: [
        ['θ_C = 0.6 表示略偏生涯厚度。想要更看重巅峰高度，把它调到 0.4 即可，全站榜单会立即重排。',
          'θ_C = 0.6 leans slightly towards career volume; lower it to 0.4 to favour peak height and every ranking recomputes.']
      ]
    },
    {
      id: 'uncertainty', h: ['不确定度与敏感性', 'Uncertainty'], g: null,
      simple: ['模型中有几十个参数都是主观设定的。那就要问：换一套同样讲得通的主观设定，榜单会不会大变？做法是把参数在「同样合理」的区间内随机扰动、重跑 2000 次。',
        'Dozens of parameters are set subjectively, so parameters are perturbed within equally reasonable ranges and the model is rerun 2,000 times.'],
      f: ['$$\\Pr(\\text{rank}_{i}\\le 10)\\ \\text{由 2000 次重抽样的经验分布给出}$$'],
      detail: [
        ['「第 1 名在 2000 次里 1960 次不变」意味着结论硬；「第 7、8 名在 45% 的模拟里互换」意味着这个名次差不可信，本质只是参数选择的产物。这相当于给榜单加一根误差棒。',
          '"No. 1 unchanged in 1,960 of 2,000 runs" is a hard conclusion; "No. 7 and No. 8 swap in 45% of runs" means that gap is an artefact. This is an error bar for the ranking.']
      ]
    },
    {
      id: 'dataprep', h: ['数据口径与边界', 'Data conventions'], g: null,
      simple: ['数据源为 WCA 官方数据库导出（TSV 永久链接，格式 v2.0.2）。锦标赛识别直接用官方 championships 表，不靠比赛名猜测。旧规则多盲可从数值编码自动判别。',
        'The source is the official WCA export (TSV permalink, v2.0.2). Championships come from the official championships table; old-style MBLD is detected from its encoding.'],
      f: ['$$\\text{old MBLD}=1SSAATTTTT\\ (\\ge10^{10}),\\qquad \\text{new MBLD}=0DDTTTTTMM\\ (<10^{10})$$'],
      detail: [
        ['数值约定：−1 为 DNF，−2 为 DNS，0 为无成绩；time 单位为厘秒；number 用于最少步；multi 用于多盲。v2 起单次尝试值挪到独立的 result_attempts 表，persons.id 改名为 wca_id。',
          'Conventions: −1 DNF, −2 DNS, 0 no result; time in centiseconds; number for FMC; multi for MBLD. From v2 attempts live in result_attempts and persons.id is wca_id.'],
        ['纪录历史没有现成表，需从 results 按日期逐条滚动求最小值来重建 WR / NR / CR 时间轴。国家与洲的归属按成绩发生当时确定。pre-WCA 时代（1982 首届世锦赛）字段不完整，需单独说明口径。',
          'No record-history table exists: the timeline is rebuilt by scanning results chronologically. Country and continent follow the time of the result. The pre-WCA era has incomplete fields.']
      ]
    }
  ];

  P.model = function (state) {
    const en = t.isEn();
    const secId = state.mdSection || (MD[0] && MD[0].id) || 'overview';
    let h = '<div class="page-head reveal"><h1>' + esc(t('md.title')) + '</h1><p class="sub">' + esc(t('md.sub')) + '</p></div>';

    /* ---- 总分口径（现行）：Σ(单项分 × 项目权重) ----
       这里放在页面最上方，因为下面的七模块章节现在只是「辅助指标」，
       不参与总分；不先说明会让读者以为总分仍由七模块加权而来。 */
    const EVG = (M.meta && M.meta.evGamma) || 0.35;
    h += '<div class="card reveal"><div class="card-head"><h2>' + esc(t('md.total.title')) + '</h2></div>' +
      '<p class="tiny muted" style="margin-bottom:10px">' + esc(t('md.total.d', { g: U.fmt(EVG, 2) })) + '</p>' +
      '<p class="tiny muted" style="margin-bottom:12px">\\[\\displaystyle M_{\\text{total}}=\\sum_{e} s_e\\,w_e,\\qquad s_e=100\\cdot r_e^{-\\gamma},\\quad \\gamma=' + U.fmt(EVG, 2) + '\\]</p>' +
      '<div class="breakdown-table">' +
      '<div class="breakdown-row bk-head"><span>' + esc(t('md.total.colR')) + '</span><span></span>' +
      '<span class="bk-num">' + esc(t('md.total.colS')) + '</span></div>';
    [1, 2, 3, 5, 10, 30, 100, 300, 1000, 3000].forEach(function (rk) {
      const s = 100 * Math.pow(rk, -EVG);
      h += '<div class="breakdown-row"><span class="bk-name">No.' + rk + '</span><span></span>' +
        '<span class="bk-num"><b>' + U.fmt(s, 1) + '</b></span></div>';
    });
    h += '</div>' +
      '<p class="tiny muted" style="margin-top:8px">' + esc(t('md.total.note')) + '</p></div>';

    /* 预设卡片：仅做预设切换；参数已分散到各章节（不再有单一聚合块） */
    h += '<div class="card reveal md-preset"><div class="row" style="gap:10px;flex-wrap:wrap;align-items:center">';
    h += '<select id="presetSel"><option value="">' + esc(t('md.preset')) + '</option>' +
      Object.keys(Pm.presets).map(function (k) { return '<option value="' + k + '">' + esc(Pm.presets[k][en ? 1 : 0]) + '</option>'; }).join('') +
      '</select>';
    h += '<button class="btn" id="pReset">' + esc(t('md.resetDefault')) + '</button>';
    h += '<span class="tiny muted">' + esc(t('md.paramsHint')) + '</span></div></div>';

    /* 模块配色：七个模块的主色可在评分系统里自定义，实时生效并本地保存 */
    const C = Pm.colors();
    h += '<div class="card reveal md-colors"><div class="md-params-title">' + Ic.glyph('sliders') + ' ' +
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

    /* 国家配色：竞速图/ 泳道图按国籍取色，逐国可自定义 */
    const CC = P.countryColorDefaults || {};
    const ccKeys = Object.keys(CC).sort();
    h += '<div class="card reveal md-colors"><div class="md-params-title">' + Ic.glyph('flag') + ' ' +
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

    /* 两栏：左目录 + 右详情（一次只展示一个章节） */
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

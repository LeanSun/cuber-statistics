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
  /* 默认值按「看得清又不拖沓」来定：30 天/秒约 4.5 分钟走完 23 年，
     换位补间 200ms 短于大部分相邻帧的累积位移，跟得上播放速度。
     fps（重绘间隔）此前是个没接线的滑杆 —— 播放改走 requestAnimationFrame 逐帧重绘后
     就没人再读它，改它完全没有效果。2026-10-27 起真正生效：
     播放时每 fps 毫秒才重绘一次图表（0 = 不节流、逐帧重绘）。
     默认 100ms（约 10 帧/秒）兼顾流畅与性能；低端机器调大即可降负载。 */
  const RATE_DEF = { jump: 30, anim: 200, fps: 100 };
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
          /* 重绘间隔为 0 时含义是「不节流、逐帧重绘」，显示 0ms 容易被读成「不重绘」 */
          '<b>' + ((r[0] === 'fps' && rate[r[0]] === 0) ? esc(t('tl.rate.frame')) : (rate[r[0]] + esc(mt.unit()))) + '</b></label>';
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
      '" data-gender="' + (state.gender || 'all') + '" data-type="' + (state.recType || 'all') + '" data-dim="' + (state.tlDim || '') + '"></div>';

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
    const dim = box.getAttribute('data-dim') || '';
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
      const sig = view + '|' + mode + '|' + metric + '|' + lane + '|' + evs.join('+') + '|' + gender + '|' + rtype + '|' + region + '|' + country + '|' + (smooth ? 1 : 0) + '|' + dim;
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
  function evYearlyOf(p, evList, rtype) {
    const ck = '__evy' + (rtype || 'all') + '_' + evList.join('+');
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
  function evScopeT(p, evList, rtype) {
    const se = p && p.sixEv;
    if (!se) return 0;
    const w = (P.util && P.util.sixW) ? P.util.sixW() : { m1: .28, m2: .24, m3: .12, m4: .18, m5: .08, m6: .10 };
    const s = [0, 0, 0, 0, 0, 0];
    let hit = 0;
    evList.forEach(function (ev) {
      const a = se[ev];
      if (!a) return;
      for (let d = 0; d < 6; d++) s[d] += (a[d] || 0);
      hit++;
    });
    if (!hit) return 0;
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

  function snapshot(mode, fy, smooth, region, country, evs, gender, rtype, dim) {
    /* 选中项目（单项目 / 多项目）时，整张图切换成「所选项目的六维能力分排名」，与上方筛选项目实时联动：
         分数取每个所选项目的六维总分（p.sixEv 已含 per-event 六维分 a[6]=t_ev）求和，
         与「历史地位排名」单 / 多项目筛选共用同一把六维尺子（不再依赖缺失的逐项目按年统计）。
         不选项目时仍用全项目历史地位分（生涯累计 × 年度比例）。 */
    const evList = (evs && evs.length) ? evs : null;
    const key = rtype === 'single' ? 'yearlyS' : (rtype === 'avg' ? 'yearlyA' : 'yearly');
    /* 累计 / 小数年插值：抽成「吃逐年对象」的纯函数，全项目分支与项目分支共用一套读法 */
    function cumY(yv, y) { let s = 0; for (const k in yv) if (+k <= y) s += yv[k]; return s; }
    function cumFY(yv, f) {
      let s = 0; for (const k in yv) if (+k <= f) s += yv[k];
      const yi = Math.floor(f), frac = f - yi;
      if (frac > 0) s += (yv[yi + 1] || 0) * frac;
      return s;
    }
    function cum(p, y) { return cumY(p[key] || {}, y); }
    function cumF(p, f) { return cumFY(p[key] || {}, f); }
    const END_Y = 2026;
    const rows = [];
    M.ranked.forEach(function (p) {
      if (!inScope(p, region, country, gender, evs)) return;
      if (evList) {
        /* 多项目（含单项目）：把所选项目的六维分逐维求和，再用当前权重合成，
           与榜单「项目筛选」完全同一把尺子（不再直接读 ETL 预置的 a[6]，
           否则在参数设置页改了六维占比，竞速图不会跟着变）。
           ★ rtype（单次 / 平均）此前在这里被完全忽略 —— 项目模式只认合并档，
             所以「单次 / 平均」筛选看着像失效；现在由 evScopeT 按口径取值。 */
        const t = evScopeT(p, evList, rtype);
        if (t <= 0) return;
        /* ★ 时间演化（此前缺失 → 单/多项目播放时条形纹丝不动，只显示最终名次）：
           总分 t 是「截至今天」的能力值，必须再乘一条随时间推进的进度曲线，
           播放时才会逐年长出来。进度曲线用「该选手在所选项目上的年度荣誉累计占比」，
           与全项目分支的 p.yearly 读法完全同源（领奖台按赛级/名次加权 + 破纪录计数），
           只是把统计范围收窄到所选项目 —— 所以三阶图只会随他三阶上的成绩推进。 */
        const evY = evYearlyOf(p, evList, rtype);
        const evAll = cumY(evY, END_Y);
        let ratio;
        if (evAll > 0) {
          let cf = cumFY(evY, fy);
          if (smooth) cf = (cumFY(evY, fy) + cumFY(evY, fy - 1) + cumFY(evY, fy - 2)) / 3;
          ratio = Math.max(0, Math.min(1, cf / evAll));
        } else {
          /* 该项目上没有任何领奖台 / 纪录（例如只靠「当前排名」拿分的人）：
             退回全局年度曲线，否则他的分数恒为 0、整张图少一个人。 */
          const gAll = cum(p, END_Y);
          const gcf = smooth ? ((cumF(p, fy) + cumF(p, fy - 1) + cumF(p, fy - 2)) / 3) : cumF(p, fy);
          ratio = gAll > 0 ? Math.max(0, Math.min(1, gcf / gAll)) : 1;
        }
        const v = t * ratio;
        if (v <= 0) return;
        rows.push({
          name: p.name, country: p.country, hue: p.hue, id: p.id, iso: p.country,
          value: v, color: countryColor(p.country), flag: window.Charts.flagUri(p.country)
        });
        return;
      }
      const all = cum(p, END_Y);
      /* 六维单独筛选：直接用该维度的维度分作为基准分，再乘同一条年度进度曲线，
         这样「只看 M3」的竞速图里条形只按大赛破纪录这一维比拼。
         该维没有年度荣誉累计（all=0，如仅靠当前排名拿分）时，进度曲线取 1
         （显示其当前维度分），而不是把整条丢弃。 */
      const dimMode = (dim && ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'].indexOf(dim) >= 0);
      if (all <= 0 && !dimMode) return;
      let cf = cumF(p, fy);
      if (smooth) cf = (cumF(p, fy) + cumF(p, fy - 1) + cumF(p, fy - 2)) / 3;
      const ratio = all > 0 ? Math.max(0, Math.min(1, cf / all)) : 1;
      if (ratio <= 0) return;
      let v;
      if (dimMode) {
        const sv = rtype === 'single' ? (p.sixS || p.six) : (rtype === 'avg' ? (p.sixA || p.six) : p.six);
        v = (sv ? (sv[dim] || 0) : 0) * ratio;
      } else {
        const sc = P.util.scoreOf(p, rtype);
        const career = sc.career * ratio;
        const ratio2 = Math.max(0.05, Math.min(3, sc.peak / Math.max(sc.career, 0.01)));
        v = career * Math.pow(ratio2, 0.4);
      }
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
  /* 暴露给冒烟测试：直接检查泳道 / 竞速图的图表配置（dim 传入 m1..m6 可测单维竞速） */
  P.tlOption = function (view, mode, fy, smooth, metric, region, country, lane, evs, gender, rtype, dim) {
    return tlOption(view || 'race', mode || 'cumulative', fy == null ? 2025 : fy, !!smooth,
      metric || 'overall', region || '', country || '', lane || 'single', evs || [], gender || 'all', rtype || 'all', null, dim || '');
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

  function tlOption(view, mode, fy, smooth, metric, region, country, lane, evs, gender, rtype, box, dim) {
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
    const all = snapshot(mode, fy, smooth, region, country, evs, gender, rtype, dim); // 已按 value 降序，带 no
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
        return { id: r.id, name: r.name, iso: r.iso, flag: r.flag, color: r.color, value: r.value, rank: r.no, no: r.no };
      }
      return { id: id, name: '', iso: '', flag: '', color: '#cfcfcf', value: 0, rank: TOP + 1, no: TOP + 1 };
    });
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
      const s = snapshot(mode, y, smooth, region, country, evs, gender, rtype, dim).slice(0, TOP + 8);
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
    const W = (P.util.sixW && P.util.sixW()) || (M.meta && M.meta.sixWeights) || { m1: 0.28, m2: 0.24, m3: 0.12, m4: 0.18, m5: 0.08, m6: 0.10 };
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
        '$$w=(\\underbrace{0.28}_{M1},\\underbrace{0.24}_{M2},\\underbrace{0.18}_{M4},\\underbrace{0.12}_{M3},\\underbrace{0.10}_{M6},\\underbrace{0.08}_{M5})$$'],
      detail: [
        ['六个维度回答六个不同的问题：M1 纪录持有（破的纪录守了多久）、M2 领奖台（拿过多少冠亚季军）、M3 大赛破纪录（锦标赛上突破的加成）、M4 统治力（保持在世界前十有多久）、M5 当前排名（此刻站在世界各榜什么位置）、M6 突破幅度（破纪录瞬间把人类前沿推远多少）。',
          'The six dimensions answer six different questions: M1 record ownership (how long a broken record was held), M2 podiums, M3 record-breaking at championships, M4 dominance (time spent inside the world top ten), M5 current ranking, M6 breakthrough margin.'],
        ['维度分先按「榜首 = 1000」归一再加权，是为了让六个量纲完全不同的维度（M2 原始量级上万、M6 只有几十）能放在同一把尺子上相加；归一后每个维度都是 0–1000 的同刻度分数，权重才具有可读的含义。',
          'Normalising each dimension to leader = 1000 lets dimensions with wildly different scales (M2 in the tens of thousands, M6 in the tens) be summed on one ruler; only then do the weights mean what they say.'],
        ['跨维相关性已逐对审查：15 对组合中唯一超过 0.7 的只有 M1 × M4 = 0.714，且属于语义近邻（守得住纪录 ⇔ 长期在世界前十），分年代桶内相关系数不下降，判定为真实机制而非时代混杂，处置方式是标注并在权重上压制。',
          'All 15 dimension pairs were checked: the only pair above 0.7 is M1 x M4 = 0.714, a semantic neighbour rather than a bug; the correlation does not fall inside single-decade buckets, so it is documented and discounted by weight.']
      ]
    },
    {
      id: 'm1', h: ['M1 · 纪录持有（权重 28%）', 'M1 · Record ownership (28%)'], g: 'm1',
      simple: ['不看「破了多少次纪录」，而看「你破的这条纪录，在你的名下守了多久」。一次刷新只是起点，真正的分值是它作为世界/洲/国家纪录存活的时间。',
        'Not "how many records broken" but "how long the record you set survived under your name". The refresh is the start; the score is the survival time.'],
      f: ['$$M_{1}=\\sum_{\\text{段}}\\frac{\\min(T,30\\,\\text{y})}{365}\\;V_{L}\\;\\rho_{s}\\;f_{L}\\;w_{e}$$',
        '$$V_{L}\\in\\{\\text{WR},\\text{CR},\\text{NR}\\},\\qquad \\rho_{s}:\\ \\text{同项目同轨的阶梯递减}$$'],
      detail: [
        ['T 为该纪录被下一条刷新前的实际持有天数，截顶 30 年，防止远古纪录因无人挑战而无限膨胀；V<sub>L</sub> 是层级价值（WR &gt; CR &gt; NR）；ρ<sub>s</sub> 让同一项目同一轨道上的第 2、3、4 条纪录递减，避免靠刷同一条线累积。',
          'T is the days actually held before the next improvement, capped at 30 years so that ancient records cannot inflate forever. V_L is the tier value (WR > CR > NR) and rho_s decays the 2nd, 3rd, 4th record on the same line.'],
        ['「领先幅度」不再进入本维：那是 M6 的职责。剥离之后，Minh Thai 那条守了 21 年的三阶 WR 这类首段边界问题也随之消失。',
          'The margin of improvement no longer enters this dimension: that is M6. Removing it also eliminated the first-segment boundary artefact.']
      ]
    },
    {
      id: 'm2', h: ['M2 · 领奖台（权重 24%）', 'M2 · Podiums (24%)'], g: 'm2',
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
      id: 'm3', h: ['M3 · 大赛破纪录（权重 12%）', 'M3 · Championship record breaks (12%)'], g: 'm3',
      simple: ['记录「在锦标赛现场打破纪录」这一额外含金量：同样的 WR，在世界锦标赛上打出来比在一场周末公开赛上打出来更难。只对锦标赛生效，公开赛不计。',
        'Captures the extra value of breaking a record on a championship floor: the same WR is harder at Worlds than at a weekend open. Championship results only.'],
      f: ['$$M_{3}=\\sum_{k}W_{\\text{REC}}(L_{k})\\times W_{\\text{TIER}}(T_{k})$$',
        '$$W_{\\text{REC}}=\\{\\text{WR}:1.0,\\ \\text{CR}:0.4,\\ \\text{NR}:0.15\\},\\qquad W_{\\text{TIER}}=\\{\\text{WC}:1.0,\\ \\text{CC}:0.6,\\ \\text{NC}:0.4\\}$$'],
      detail: [
        ['它与 M1 并存且各计一次：M1 奖励「守了多久」，M3 奖励「在什么场合打出来」，两者不重复。NR 给 0.15 是承认国家纪录也是真实突破，但含金量远低于 WR。',
          'It coexists with M1 and each counts once: M1 rewards how long it was held, M3 rewards the stage. NR gets 0.15 as a real but much weaker breakthrough.']
      ]
    },
    {
      id: 'm4', h: ['M4 · 统治力（权重 18%）', 'M4 · Dominance (18%)'], g: 'm4',
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
      id: 'm5', h: ['M5 · 当前排名（权重 8%）', 'M5 · Current ranking (8%)'], g: 'm5',
      simple: ['唯一一个「此刻」的维度：你现在站在世界各榜的什么位置。为了保证它真的是「现在」，名次分与新鲜度双衰减同时生效 —— 久未参赛、PB 早已过期都会扣分。',
        'The only "right now" dimension: where you stand on the world boards today. A double freshness decay applies - both inactivity and a stale personal best discount the score.'],
      f: ['$$M_{5}=\\sum_{e}w_{e}\\,r^{-1.0}\\,\\max\\!\\left(0.2,\\,1-\\frac{\\text{gap}_{R}}{5}\\times0.8\\right)\\,\\max\\!\\left(0.2,\\,1-\\frac{\\text{gap}_{P}}{5}\\times0.8\\right)$$'],
      detail: [
        ['gap<sub>R</sub> 是该项目末次参赛距今年数，gap<sub>P</sub> 是该轨道 PB 距今的年数，五年衰减到 0.2 的地板。深度取前 100 名，单次轨与平均轨各计 1.0。',
          'gap_R is years since the last appearance in that event, gap_P years since that track personal best; both decay to a floor of 0.2 over five years. Depth is the top 100, single and average tracks each count 1.0.'],
        ['注意 WCA 官方的 ranks 表是按 PB 排序的「终身榜」，退役十年的人仍可能显示第 5 名 —— 正因为如此，M5 才必须叠一层新鲜度衰减，而 M4 必须自建历史 PB。',
          'WCA ranks are lifetime boards sorted by PB, so a player retired for ten years can still show No. 5 - which is exactly why M5 needs the freshness decay and M4 rebuilds historical PBs.']
      ]
    },
    {
      id: 'm6', h: ['M6 · 突破幅度（权重 10%）', 'M6 · Breakthrough margin (10%)'], g: 'm6',
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
      simple: ['六维权重由「信息量 + 抗刷分 + 覆盖度」三条原则共同确定，以 M1 / M2 为主（合计 52%），M5 最低（8%，因为它只是一个截面快照）。',
        'Weights follow three principles - information content, farming resistance and coverage. M1 and M2 dominate (52% together); M5 is lowest at 8% because it is a single cross-section.'],
      f: ['$$t=0.28\\,s_{M1}+0.24\\,s_{M2}+0.18\\,s_{M4}+0.12\\,s_{M3}+0.10\\,s_{M6}+0.08\\,s_{M5}$$'],
      detail: [
        ['M1 × M4 = 0.714 是唯一超标的相关对：跳得越远 → 追平越难 → 守得越久，属真实机制。合成时按此折扣理解，不额外合并维度。',
          'M1 x M4 = 0.714 is the only pair above the threshold: a bigger jump is harder to match and therefore held longer. It is a real mechanism, documented rather than merged away.'],
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
    let h = '<div class="page-head reveal"><h1>' + esc(t('md.title')) + '</h1><p class="sub">' + esc(t('md.sub')) + '</p></div>';

    /* 六维权重 / 六维名称：被下方的「六维占比自定义」与「预设」复用，必须在使用前定义。
       注意：原先附带的「总分口径（现行）」卡片已按需求删除，这里只保留两个常量声明。 */
    const SW = (P.util.sixW && P.util.sixW()) || (M.meta && M.meta.sixWeights) || { m1: 0.28, m2: 0.24, m3: 0.12, m4: 0.18, m5: 0.08, m6: 0.10 };
    const SN = (M.meta && M.meta.sixNames) || { m1: '纪录持有', m2: '领奖台', m3: '大赛破纪录', m4: '统治力', m5: '当前排名', m6: '突破幅度' };

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

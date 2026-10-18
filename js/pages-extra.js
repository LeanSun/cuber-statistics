/* ============================================================
   pages-extra.js — 动态可视化 / 另类统计 / 评分原理说明
   ============================================================ */
(function () {
  const t = window.I18N, U = window.U, M = window.MOCK, Ic = window.Icons, Pm = window.Params;
  const P = window.P || (window.P = {});
  const MOD = P.util.MOD, MODC = P.util.MODC;
  const esc = U.esc;
  const { avatar, flag, playerLink, modName, ecBox, scoreOf, infoTip, evName, contName, countryName } = P.util;

  /* 国家配色：主要国家用本国标志性色，其余按 iso 稳定取色 */
  const COUNTRY_COLORS = {
    CN: '#de2910', HK: '#de2910', MO: '#009944', TW: '#003399',
    US: '#1f4fd8', JP: '#bc002d', KR: '#0047a0', DE: '#111111', GB: '#012169',
    FR: '#0055a4', NL: '#ec0000', PL: '#dc143c', SE: '#006aa7', IT: '#008c45',
    ES: '#aa151b', RU: '#0039a6', UA: '#005bbb', CA: '#d80621', AU: '#00843d',
    BR: '#009b3a', MX: '#006847', IN: '#ff671f', ID: '#e70011', MY: '#010080',
    SG: '#ef3340', TH: '#2d2a4a', VN: '#da251d', PH: '#0038a8', NZ: '#00247d',
    CH: '#d52b1e', NG: '#008751', KE: '#006600', EG: '#ce1126', ZA: '#002395',
    AR: '#74acdf', CL: '#0033a0'
  };
  function countryColor(iso) {
    if (COUNTRY_COLORS[iso]) return COUNTRY_COLORS[iso];
    return 'hsl(' + U.hue(iso || '??') + ',55%,50%)';
  }

  /* ================= 动态可视化 ================= */
  const VIEWS = [['rank', 'tl.view.rank', 'timeline'], ['race', 'tl.view.race', 'speed'], ['lane', 'tl.view.lane', 'record']];
  let TL_MS = M.milestones; /* 当前单项筛选下的里程碑集合（供图表标线使用） */
  P.tlIdxToInfo = tlIdxToInfo; P.tlSlider = tlSlider; /* 供 app.js 滑块 / 播放使用 */

  /* 自定义重大事件：localStorage 持久化 + 与内置合并 */
  const MS_KEY = 'goat-milestones-custom';
  function loadCustomMs() {
    try { var a = JSON.parse(localStorage.getItem(MS_KEY)); return Array.isArray(a) ? a : []; }
    catch (e) { return []; }
  }
  function saveCustomMs(a) { try { localStorage.setItem(MS_KEY, JSON.stringify(a)); } catch (e) { } }
  function msSample() {
    return [
      { year: 2015, zh: '三阶单次首次突破 5 秒', en: '3x3 single breaks 5 seconds' },
      { year: 2019, zh: '你自定义的某个里程碑', en: 'Your custom milestone' }
    ];
  }
  P.msSample = msSample;

  P.timeline = function (state) {
    const view = state.tlView || 'rank';
    const mode = state.tlMode || 'active';
    const step = state.tlStep || 'year';
    const metric = state.tlMetric || 'overall';
    const fy = state.tlFy || 2025;
    const sl = tlSlider(step, fy);

    let h = '<div class="page-head reveal"><h1>' + esc(t('tl.title')) + '</h1><p class="sub">' + esc(t('tl.sub')) + '</p></div>';

    h += '<div class="card reveal">';
    h += '<div class="row tl-top">';
    h += '<div class="fgroup"><span class="flabel">' + esc(t('tl.mode.tip')) + '</span><div class="seg" id="tlModeSeg">';
    ['active', 'cumulative'].forEach(function (m) {
      h += '<button data-tlmode="' + m + '" class="' + (mode === m ? 'on' : '') + '">' + esc(t('tl.mode.' + m)) + '</button>';
    });
    h += '</div></div>';
    h += '<div class="fgroup"><span class="flabel">' + esc(t('tl.viewTip')) + '</span><div class="seg" id="tlViewSeg">';
    VIEWS.forEach(function (v) {
      h += '<button data-tlview="' + v[0] + '" class="' + (view === v[0] ? 'on' : '') + '">' + Ic.glyph(v[2]) + ' ' + esc(t(v[1])) + '</button>';
    });
    h += '</div></div>';
    h += '<span class="spacer"></span>';
    h += '<label class="tiny muted row" style="gap:5px"><input type="checkbox" id="tlSmooth"' + (state.tlSmooth ? ' checked' : '') + '> ' + esc(t('tl.smooth')) + '</label>';
    h += '</div>';

    /* 步进 / 指标 / 单均 控制条 */
    h += '<div class="row tl-top" style="margin-top:10px">';
    h += '<div class="fgroup"><span class="flabel">' + esc(t('tl.step')) + '</span><div class="seg" id="tlStepSeg">';
    [['year', 'tl.step.year'], ['month', 'tl.step.month'], ['week', 'tl.step.week']].forEach(function (s) {
      h += '<button data-tlstep="' + s[0] + '" class="' + (step === s[0] ? 'on' : '') + '">' + esc(t(s[1])) + '</button>';
    });
    h += '</div></div>';
    if (view !== 'lane') {
      h += '<div class="fgroup"><span class="flabel">' + esc(t('tl.metric')) + '</span><div class="seg" id="tlMetricSeg">';
      [['overall', 'tl.metric.overall'], ['m1', 'col.m1'], ['m3', 'col.m3']].forEach(function (s) {
        h += '<button data-tlmetric="' + s[0] + '" class="' + (metric === s[0] ? 'on' : '') + '">' + esc(t(s[1])) + '</button>';
      });
      h += '</div></div>';
    } else {
      h += '<div class="fgroup"><span class="flabel">' + esc(t('tl.lane')) + '</span><div class="seg" id="tlLaneSeg">';
      [['single', 'rec.single'], ['avg', 'rec.average']].forEach(function (s) {
        h += '<button data-tllane="' + s[0] + '" class="' + (state.tlLane === s[0] ? 'on' : '') + '">' + esc(t(s[1])) + '</button>';
      });
      h += '</div></div>';
    }
    h += '</div>';

    /* 地区 / 国家筛选改由顶部合并下拉（fgGeo）统一处理；此处不再单独呈现 */

    h += '<div class="tl-desc"><span class="tl-desc-ic">' + Ic.glyph('info') + '</span>' +
      '<div><b>' + esc(t('tl.mode.' + mode)) + '</b>：' + esc(t('tl.mode.' + mode + '.d')) +
      '　<b>' + esc(t(view === 'lane' ? 'tl.view.lane' : (view === 'race' ? 'tl.view.race' : 'tl.view.rank'))) + '</b>：' +
      esc(t(view === 'lane' ? 'tl.view.lane.d' : (view === 'race' ? 'tl.view.race.d' : 'tl.view.rank.d'))) + '</div></div>';

    if (view !== 'lane') {
      h += '<div class="tl-ctl">';
      h += '<button class="btn btn-primary" id="tlPlay">' + esc(state.tlPlaying ? t('tl.pause') : t('tl.play')) + '</button>';
      h += '<input type="range" id="tlRange" min="' + sl.min + '" max="' + sl.max + '" step="' + sl.step + '" value="' + sl.value + '">';
      h += '<span class="tl-year" id="tlYear">' + sl.label + '</span>';
      h += '</div>';
    }

    const chH = view === 'rank' ? 540 : (view === 'race' ? 470 : 380);
    const geoRegion = (state.geo && state.geo.indexOf('cont:') === 0) ? state.geo.slice(5) : '';
    const geoCountry = (state.geo && state.geo.indexOf('cont:') !== 0 && state.geo) ? state.geo : '';
    h += '<div class="chart-box" id="tlChart" style="height:' + chH + 'px" data-view="' + view + '" data-mode="' + mode +
      '" data-fy="' + fy + '" data-metric="' + metric + '" data-lane="' + state.tlLane + '" data-smooth="' + (state.tlSmooth ? 1 : 0) +
      '" data-region="' + geoRegion + '" data-country="' + geoCountry + '"></div>';
    h += '</div>';

    const evSel = state.evSel || [];
    const singleEv = evSel.length === 1 ? evSel[0] : (state.group && M.EV[state.group] ? state.group : '');
    const msBase = singleEv ? M.eventMilestones(singleEv) : M.milestones;
    const custom = loadCustomMs().map(function (m) { return Object.assign({ custom: true }, m); });
    const ms = msBase.concat(custom).sort(function (a, b) { return (a.year || 0) - (b.year || 0); });
    TL_MS = ms;
    h += '<div class="card reveal"><div class="card-head"><h2>' + esc(t('tl.events')) +
      (singleEv ? ' · ' + esc(evName(M.EV[singleEv])) : '') + '</h2>' +
      (custom.length ? '<span class="tiny muted">+' + custom.length + ' ' + esc(t('tl.msCustom')) + '</span>' : '') + '</div>';
    h += '<div class="milestone-list">';
    ms.forEach(function (m) {
      const isC = !!m.custom;
      h += '<span class="ms-item' + (isC ? ' ms-custom' : '') + '"><b>' + m.year + '</b> ' + esc(t.isEn() ? (m.en || m.zh) : m.zh);
      if (isC) h += ' <span class="ms-tag">' + esc(t('tl.msCustom')) + '</span>';
      h += '</span>';
    });
    h += '</div></div>';

    /* 自定义重大事件编辑 / 导入 */
    h += '<div class="card reveal"><div class="card-head"><h2>' + esc(t('tl.msEdit')) + '</h2></div>';
    h += '<p class="tiny muted" style="margin-bottom:8px">' + esc(t('tl.msGuide')) + '</p>';
    h += '<textarea id="msInput" class="ms-input" rows="6" spellcheck="false" placeholder="[{&quot;year&quot;:2015,&quot;zh&quot;:&quot;...&quot;,&quot;en&quot;:&quot;...&quot;}]">' + esc(JSON.stringify(custom.length ? custom : msSample())) + '</textarea>';
    h += '<div class="row" style="margin-top:8px;gap:8px;flex-wrap:wrap">';
    h += '<button class="btn btn-primary" data-msimport>' + esc(t('tl.msImport')) + '</button>';
    h += '<button class="btn" data-msreset>' + esc(t('tl.msReset')) + '</button>';
    h += '<button class="btn" data-mssample>' + esc(t('tl.msSample')) + '</button>';
    h += '</div></div>';
    return h;
  };

  /* 滑块：年 / 月 / 周 三种步进；索引 0 代表 1982–2003 的一次性跳转 */
  const TL_START = new Date(2003, 0, 1);
  function tlDayOfYear(d) { const s = new Date(d.getFullYear(), 0, 0); return (d - s) / 86400000; }
  function tlIsLeap(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }
  function tlDateToFy(d) { return d.getFullYear() + tlDayOfYear(d) / (tlIsLeap(d.getFullYear()) ? 366 : 365); }
  function tlWeekStart(k) { return new Date(TL_START.getTime() + k * 7 * 86400000); }
  function tlIdxToInfo(idx, step) {
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

  /* 由 app.js 调用：渲染 / 更新动态图表 */
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
    try {
      const opt = tlOption(view, mode, fy, smooth, metric, region, country, lane);
      if (!opt) return null;
      opt.backgroundColor = 'transparent';
      window.Charts.resolveDeep ? window.Charts.resolveDeep(opt) : (function () { })(opt);
      /* 结构（视图 / 模式 / 维度 / 单均）不变时做增量合并，名次与分数丝滑过渡 */
      const sig = view + '|' + mode + '|' + metric + '|' + lane;
      const sameStruct = box.__tlSig === sig;
      if (sameStruct) {
        opt.animationDuration = 0;
        opt.animationDurationUpdate = 480;
        opt.animationEasingUpdate = 'cubicInOut';
      }
      let inst = null;
      try { inst = window.Charts.render(box, opt, { notMerge: !sameStruct }); } catch (e) { inst = null; }
      box.__tlSig = sig;
      return inst;
    } catch (e) { return null; }
  };

  function inScope(p, region, country) {
    if (country) return p.country === country;
    if (region) {
      if (M.continents[region]) return M.continentOf[p.country] === region;
      return M.regionOf[M.continentOf[p.country]] === region;
    }
    return true;
  }
  function metricScale(p, metric) {
    if (metric === 'm1') return p.m.m1 / 100;
    if (metric === 'm3') return p.m.m3 / 100;
    return 1;
  }

  function snapshot(mode, fy, smooth, metric, region, country) {
    const fn = mode === 'active' ? M.actAtF : M.cumAtF;
    return M.ranked.filter(function (p) { return inScope(p, region, country); }).map(function (p) {
      const sc = metricScale(p, metric);
      let v = fn(p, fy) * sc;
      if (smooth) v = (fn(p, fy) + fn(p, fy - 1) + fn(p, fy - 2)) * sc / 3;
      return { name: p.name, country: p.country, hue: p.hue, id: p.id, value: v, color: countryColor(p.country) };
    }).filter(function (d) { return d.value > 0; }).sort(function (a, b) { return b.value - a.value; });
  }

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
        return { xAxis: String(m.year), name: (t.isEn() ? (m.en || m.zh) : m.zh).slice(0, 14), lineStyle: m.custom ? { color: T.accent, width: 1.8 } : undefined };
      })
    };
  }

  function tlOption(view, mode, fy, smooth, metric, region, country, lane) {
    if (view === 'lane') {
      const lanes = (lane === 'avg' ? M.lanesAvg : M.lanes).map(function (L) {
        return { label: evName(M.EV[L.ev]), segs: L.segs };
      });
      return window.Charts.lanes(lanes, { y0: 2004, y1: 2026 });
    }
    const TOP = 15;
    if (view === 'race') {
      const snap = snapshot(mode, fy, smooth, metric, region, country).slice(0, TOP).map(function (d) {
        return { name: d.name, value: d.value, color: d.color };
      });
      return window.Charts.barRace(snap, { top: TOP, duration: 800 });
    }
    const lastY = Math.max(2003, Math.floor(fy));
    const years = [];
    for (let y = 2003; y <= lastY; y++) years.push(y);
    const rowsMap = {};
    years.forEach(function (y) {
      snapshot(mode, y, smooth, metric, region, country).slice(0, TOP).forEach(function (d, i) {
        if (!rowsMap[d.id]) rowsMap[d.id] = { name: d.name, color: d.color, pts: {} };
        rowsMap[d.id].pts[y] = i + 1;
      });
    });
    const rows = Object.keys(rowsMap).map(function (k) { return rowsMap[k]; });
    const o = window.Charts.bump(rows, years.map(String), { top: TOP, right: 110 });
    o.series.push(Object.assign({ type: 'line', data: [], markLine: markLines() }, { name: '__marks' }));
    return o;
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

    /* 二级筛选表头：按项目过滤 */
    const te = state.topicEvent || '';
    h += '<div class="ev-filter-head reveal"><span class="ev-filter-label">' + esc(t('top.eventFilter')) + '</span>' +
      '<div class="ev-strip ev-strip-topic" role="group" aria-label="' + esc(t('top.eventFilter')) + '">';
    h += '<button class="ev-tab' + (!te ? ' on' : '') + '" data-topicev="">' + esc(t('f.all')) + '</button>';
    M.events.forEach(function (e) {
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
      const list = M.board(tab, d.k, 12, te);
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
    let h = '<div class="seg reveal" id="otherSeg" style="margin-bottom:12px">';
    [['king', 'top.king'], ['nation', 'top.nation'], ['unknown', 'top.unknown'], ['counter', 'top.counter']].forEach(function (x) {
      h += '<button data-other="' + x[0] + '" class="' + (sub === x[0] ? 'on' : '') + '">' + esc(t(x[1])) + '</button>';
    });
    h += '</div>';
    if (sub === 'king') {
      h += '<p class="tiny muted" style="margin-bottom:12px">' + esc(t('top.king.d')) + '</p>';
      h += '<div class="grid grid-3">';
      M.events.filter(function (e) { return !e.retired; }).forEach(function (e) {
        const best = M.ranked.filter(function (p) { return p.events.indexOf(e.id) >= 0; })[0] || M.ranked[0];
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
        return { label: n.iso, value: n[key], color: countryColor(n.iso) };
      }), { top: 14 }, 320) + '</div>';
      h += '<div class="table-wrap reveal"><table class="data mini"><thead><tr><th class="tl">' + esc(t('f.region')) +
        '</th><th class="tl">' + esc(t('f.continent')) + '</th><th>' + esc(t('top.nation.total')) + '</th><th>' +
        esc(t('top.nation.per')) + '</th><th>' + esc(t('top.nation.top')) + '</th><th class="tl">' + esc(t('col.player')) + '</th></tr></thead><tbody>';
      M.nations.slice(0, 24).forEach(function (n) {
        h += '<tr><td class="tl">' + flag(n.iso) + ' ' + esc(n.name) + '</td><td class="tl tiny muted">' + esc(contName(n.continent)) + '</td>' +
          '<td class="num">' + U.num(n.total) + '</td><td class="num">' + U.fmt(n.perCapita, 1) + '</td><td class="num">' + U.fmt(n.best, 1) + '</td>' +
          '<td class="tl tiny">' + esc(n.bestName) + '</td></tr>';
      });
      h += '</tbody></table></div>';
    } else if (sub === 'unknown') {
      h += '<p class="tiny muted" style="margin-bottom:12px">' + esc(t('top.unknown.d')) + '</p>';
      const list = M.ranked.filter(function (p) { return p.wr === 0; }).slice(0, 40);
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
      const base = M.ranked.slice(0, 20);
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
    for (let i = 0; i <= 10; i++) {
      const w1 = 0.20 + i * 0.05;
      const save = Pm.get('b1');
      Pm.set('b1', w1); Pm.normalize();
      const top = M.ranked.slice(0, 40).map(function (p) { return { p: p, o: scoreOf(p).overall }; })
        .sort(function (a, b) { return b.o - a.o; })[0];
      pts.push([round(w1, 2), round(top.o, 1), esc(top.p.name)]);
      Pm.set('b1', save); Pm.normalize();
    }
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
        ['第 1 名满额、第 10 名 0.32、第 100 名 0.10。指数单独取 0.5（比主函数的 1.1 平缓），因为长期稳居第 5 与第 1 的差距不该放大到 11 倍。无成绩即为 0，全程不需要判断是否退役。',
          'Rank 1 scores in full, rank 10 gets 0.32, rank 100 gets 0.10. The exponent is 0.5 so the gap between 5 and 1 is not amplified elevenfold. No result means zero.'],
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

    /* 预设卡片：仅做预设切换；参数已分散到各章节（不再有单一聚合块） */
    h += '<div class="card reveal md-preset"><div class="row" style="gap:10px;flex-wrap:wrap;align-items:center">';
    h += '<select id="presetSel"><option value="">' + esc(t('md.preset')) + '</option>' +
      Object.keys(Pm.presets).map(function (k) { return '<option value="' + k + '">' + esc(Pm.presets[k][en ? 1 : 0]) + '</option>'; }).join('') +
      '</select>';
    h += '<button class="btn" id="pReset">' + esc(t('md.resetDefault')) + '</button>';
    h += '<span class="tiny muted">' + esc(t('md.paramsHint')) + '</span></div></div>';

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

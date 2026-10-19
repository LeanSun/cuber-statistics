/* ============================================================
   charts.js — ECharts 封装（主题取色 / 自适应 / 动画 / 懒挂载）
   用法：容器内放置 <div class="ec" data-ec="{...}"></div>，由 Charts.mount() 统一渲染
   或：Charts.render(el, option)
   ============================================================ */
(function () {
  const has = function () { return !!window.echarts; };
  let palette = null;

  function cssVar(name, fb) {
    try {
      const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      return v || fb;
    } catch (e) { return fb; }
  }
  /* ECharts 渲染在 canvas 上，无法解析 CSS 变量；凡是 'var(--x)' 都需先解析为真实色值 */
  function resolveColor(c) {
    if (typeof c === 'string' && c.indexOf('var(') === 0) return cssVar(c.slice(4, -1).trim(), '#888');
    return c;
  }
  function resolveDeep(obj) {
    if (Array.isArray(obj)) { for (let i = 0; i < obj.length; i++) obj[i] = resolveDeep(obj[i]); }
    else if (obj && typeof obj === 'object') {
      for (const k in obj) {
        if ((k === 'color' || k === 'borderColor' || k === 'lineStyle' || k === 'areaStyle' || k === 'itemStyle') && typeof obj[k] === 'string' && obj[k].indexOf('var(') === 0) {
          obj[k] = resolveColor(obj[k]);
        } else if (k === 'lineStyle' || k === 'areaStyle' || k === 'itemStyle') {
          obj[k] = resolveDeep(obj[k]);
        } else if (typeof obj[k] === 'string' && obj[k].indexOf('var(') === 0) {
          obj[k] = resolveColor(obj[k]);
        } else if (obj[k] && typeof obj[k] === 'object') {
          obj[k] = resolveDeep(obj[k]);
        }
      }
    }
    return obj;
  }
  function theme() {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    return {
      dark: dark,
      text: cssVar('--text', '#151a21'),
      text2: cssVar('--text-2', '#5a6675'),
      text3: cssVar('--text-3', '#8a95a5'),
      border: cssVar('--border', '#e0e6ee'),
      border2: cssVar('--border-2', '#c7d0dc'),
      bg: cssVar('--bg', '#f5f7fa'),
      elev: cssVar('--bg-elev', '#fff'),
      soft: cssVar('--bg-soft', '#eef1f6'),
      accent: cssVar('--accent', '#2f6feb'),
      m: ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7'].map(function (k) { return cssVar('--' + k, '#888'); })
    };
  }
  function pal() { if (!palette) palette = theme(); return palette; }
  function refreshPalette() { palette = null; }

  function base(opts) {
    opts = opts || {};
    const T = pal();
    return {
      animation: true,
      animationDuration: opts.duration == null ? 720 : opts.duration,
      animationEasing: 'cubicOut',
      animationDelay: function (idx) { return opts.stagger ? idx * (opts.stagger) : idx * 18; },
      textStyle: { fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",Roboto,Helvetica,Arial,sans-serif' },
      tooltip: {
        confine: true,
        backgroundColor: T.elev, borderColor: T.border, borderWidth: 1,
        textStyle: { color: T.text, fontSize: 12 },
        extraCssText: 'box-shadow:0 6px 20px rgba(0,0,0,.14);border-radius:10px;padding:8px 10px;'
      },
      color: opts.colors || T.m.concat([T.accent])
    };
  }

  function axisCommon() {
    const T = pal();
    return {
      axisLine: { lineStyle: { color: T.border } },
      axisTick: { show: false },
      axisLabel: { color: T.text3, fontSize: 11 },
      splitLine: { lineStyle: { color: T.border, type: 'dashed' } }
    };
  }

  /* ---------- 通用渲染 ---------- */
  function render(el, option, opts) {
    opts = opts || {};
    if (!el || !has()) return null;
    let inst = null;
    try { inst = window.echarts.getInstanceByDom(el); } catch (e) { }
    if (!inst) inst = window.echarts.init(el, null, { renderer: 'canvas' });
    const notMerge = opts.notMerge !== false; /* 默认整图替换；仅当显式 notMerge:false 时做增量合并 */
    inst.setOption(option, notMerge);
    if (!el.__ecResized) {
      el.__ecResized = true;
      window.addEventListener('resize', function () { try { inst.resize(); } catch (e) { } });
    }
    return inst;
  }

  /* ---------- 堆叠条：模块构成 ---------- */
  function stacked(items, opts) {
    opts = opts || {};
    const T = pal();
    const cats = items.map(function (d) { return d.name; });
    const series = (opts.series || []).map(function (s, i) {
      return {
        name: s.name, type: 'bar', stack: 'total',
        barMaxWidth: 26,
        itemStyle: { color: s.color || T.m[i % 7], borderRadius: [0, 0, 0, 0] },
        emphasis: { focus: 'series' },
        data: items.map(function (d) { return round(d.values[i]); })
      };
    });
    return Object.assign(base({ stagger: 22 }), {
      grid: { left: 8, right: 12, top: 10, bottom: 4, containLabel: true },
      xAxis: Object.assign({ type: 'value', max: opts.max || 100 }, axisCommon(), { splitLine: { lineStyle: { color: T.border, type: 'dashed' } } }),
      yAxis: Object.assign({ type: 'category', data: cats, inverse: true }, axisCommon(), { splitLine: { show: false } }),
      tooltip: Object.assign({ trigger: 'axis', axisPointer: { type: 'shadow' } }, base().tooltip),
      legend: { show: !!opts.legend, data: (opts.series || []).map(function (s) { return s.name; }), textStyle: { color: T.text2, fontSize: 11 }, bottom: 0, itemWidth: 10, itemHeight: 10 },
      series: series
    });
  }

  /* ---------- 瀑布式贡献条（选手页） ---------- */
  function waterfall(items, opts) {
    const T = pal();
    const base0 = [], up = [], down = [];
    let acc = 0, total = 0;
    items.forEach(function (d) { total += d.value; });
    items.forEach(function (d) {
      if (d.value >= 0) { base0.push(round(acc)); up.push(round(d.value)); down.push('-'); acc += d.value; }
      else { acc += d.value; base0.push(round(acc)); up.push('-'); down.push(round(-d.value)); }
    });
    return Object.assign(base({ stagger: 60 }), {
      grid: { left: 8, right: 16, top: 10, bottom: 22, containLabel: true },
      xAxis: Object.assign({ type: 'category', data: items.map(function (d) { return d.name; }) }, axisCommon(), { splitLine: { show: false } }),
      yAxis: Object.assign({ type: 'value' }, axisCommon()),
      tooltip: Object.assign({ trigger: 'axis', axisPointer: { type: 'shadow' } }, base().tooltip),
      series: [
        { name: '', type: 'bar', stack: 'w', itemStyle: { color: 'transparent' }, silent: true, data: base0, barMaxWidth: 34 },
        {
          name: opts.name || '', type: 'bar', stack: 'w', barMaxWidth: 34,
          itemStyle: { borderRadius: [4, 4, 0, 0] },
          data: items.map(function (d, i) { return { value: up[i] === '-' ? '-' : up[i], itemStyle: { color: d.color || T.m[i % 7] } }; })
        }
      ]
    });
  }

  /* ---------- 环形图 ---------- */
  function donut(items, opts) {
    opts = opts || {};
    const T = pal();
    return Object.assign(base({ stagger: 60 }), {
      tooltip: Object.assign({ trigger: 'item', formatter: '{b}: {c} ({d}%)' }, base().tooltip),
      legend: { show: !!opts.legend, orient: 'vertical', right: 4, top: 'middle', textStyle: { color: T.text2, fontSize: 11.5 }, itemWidth: 10, itemHeight: 10 },
      series: [{
        type: 'pie', radius: opts.radius || ['52%', '76%'], center: opts.center || ['50%', '50%'],
        avoidLabelOverlap: true,
        itemStyle: { borderColor: T.elev, borderWidth: 2, borderRadius: 4 },
        label: { show: !!opts.label, color: T.text2, fontSize: 11, formatter: '{b}\n{d}%' },
        labelLine: { show: !!opts.label },
        emphasis: { scale: true, scaleSize: 6, itemStyle: { shadowBlur: 12, shadowColor: 'rgba(0,0,0,.2)' } },
        data: items.map(function (d) { return { name: d.name, value: round(d.value), itemStyle: { color: d.color } }; })
      }]
    });
  }

  /* ---------- 雷达 ---------- */
  function radar(data, opts) {
    /* 兼容两种调用：ecBox('radar', { rows, indicators }, opts) 与旧式 radar(rows, indicators, opts) */
    opts = opts || {};
    const T = pal();
    const rows = data && data.rows ? data.rows : data;
    const indicators = data && data.indicators ? data.indicators : opts.indicators || [];
    return Object.assign(base({ duration: 620 }), {
      tooltip: Object.assign({ trigger: 'item' }, base().tooltip),
      legend: { show: true, bottom: 0, textStyle: { color: T.text2, fontSize: 11.5 }, itemWidth: 12, itemHeight: 8, data: rows.map(function (r) { return r.name; }) },
      radar: {
        center: ['50%', '48%'], radius: opts.radius || '62%',
        indicator: indicators.map(function (n, i) { return { name: n, max: opts.max || 100, color: T.text2 }; }),
        axisName: { color: T.text2, fontSize: 11.5 },
        splitLine: { lineStyle: { color: T.border } },
        splitArea: { areaStyle: { color: [T.soft, 'transparent'] } },
        axisLine: { lineStyle: { color: T.border } }
      },
      series: [{
        type: 'radar', symbolSize: 5,
        areaStyle: { opacity: 0.16 },
        lineStyle: { width: 2 },
        emphasis: { lineStyle: { width: 3 } },
        data: rows.map(function (r) {
          return { name: r.name, value: r.values.map(function (v) { return round(v); }), itemStyle: { color: r.color }, lineStyle: { color: r.color }, areaStyle: { color: r.color } };
        })
      }]
    });
  }

  /* ---------- 排名带 bump ---------- */
  function bump(rows, years, opts) {
    opts = opts || {};
    const T = pal();
    const top = opts.top || 10;
    /* 补齐到固定条数，保证增量合并时序列身份稳定，不会残留旧序列 */
    while (rows.length < top) rows.push({ name: '', color: T.text3, pts: {} });
    const series = rows.map(function (r) {
      return {
        name: r.name, type: 'line', smooth: 0.28, symbol: 'circle', symbolSize: 7,
        lineStyle: { width: 2.6, color: r.color, shadowBlur: 6, shadowColor: r.color, shadowOffsetY: 2 },
        itemStyle: { color: r.color, borderColor: T.elev, borderWidth: 1.5 },
        emphasis: { focus: 'series', scale: 1.4 },
        endLabel: { show: true, formatter: function (p) { return p.seriesName; }, color: r.color, fontSize: 11.5, distance: 6 },
        data: years.map(function (y) { return r.pts[y] == null ? null : r.pts[y]; })
      };
    });
    return Object.assign(base({ stagger: 40 }), {
      grid: { left: 6, right: opts.right || 96, top: 12, bottom: 26, containLabel: true },
      xAxis: Object.assign({ type: 'category', data: years, boundaryGap: false }, axisCommon(), { splitLine: { show: false } }),
      yAxis: Object.assign({
        type: 'value', inverse: true, min: 1, max: top, interval: 1,
        axisLabel: { color: T.text3, fontSize: 11, formatter: function (v) { return '#' + v; } }
      }, axisCommon()),
      tooltip: Object.assign({ trigger: 'axis', axisPointer: { type: 'line' } }, base().tooltip),
      series: series
    });
  }

  /* ---------- 条形竞赛（custom 渲染：国旗 + 姓名 + 分数，支持点击跳转） ---------- */
  function barRace(items, opts) {
    opts = opts || {};
    const T = pal();
    const n = opts.top || 15;
    const data = items.slice(0, n);
    /* 补齐到固定条数，保证增量合并时序列身份稳定、平滑换位 */
    while (data.length < n) data.push({ name: '', value: 0 });
    function fmtD(dn) {
      const s = String(dn || '');
      return s.length === 8 ? (s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8)) : '';
    }
    return Object.assign(base({ stagger: 0, duration: opts.duration == null ? 720 : opts.duration }), {
      /* 左侧留出固定空位放排名序号：序号画在条形外侧，条形再短也不会盖住它 */
      grid: { left: 30, right: 78, top: 6, bottom: 6, containLabel: false },
      xAxis: Object.assign({ type: 'value', max: function (v) { return Math.max(v.max, 1) * 1.05; } }, axisCommon()),
      yAxis: Object.assign({ type: 'category', inverse: true, data: data.map(function (d) { return d.name; }) }, axisCommon(), { splitLine: { show: false }, axisLabel: { show: false } }),
      tooltip: Object.assign({ trigger: 'axis', axisPointer: { type: 'shadow' } }, base().tooltip),
      series: [{
        type: 'custom',
        renderItem: function (params, api) {
          const catIdx = api.value(1);
          const val = Math.max(0, api.value(0));
          const it = data[catIdx];
          if (!it || !it.name) return;
          const y0 = api.coord([0, catIdx])[1];
          const x0 = api.coord([0, catIdx])[0];
          const x1 = api.coord([val, catIdx])[0];
          const h = Math.max(10, Math.min(24, api.size([0, 1])[1] * 0.68));
          const w = Math.max(2, x1 - x0);
          const kids = [{
            type: 'rect', transition: ['shape'], shape: { x: x0, y: y0 - h / 2, width: w, height: h, r: 5 },
            style: { fill: it.color || T.m[0], stroke: T.elev, lineWidth: 1 }
          }];
          let tx = x0 + 6;
          /* 排名序号 1–15：画在条形左端「外侧」，条形再长也压不到它 */
          kids.push({
            type: 'text', style: {
              text: it.no ? String(it.no) : '', x: x0 - 10, y: y0,
              fill: T.text2 || '#888', font: '800 12px "Segoe UI",system-ui,sans-serif',
              textVerticalAlign: 'middle', textBaseline: 'middle', align: 'right'
            }
          });
          const uri = it.flag || flagUri(it.iso);
          if (uri) {
            kids.push({ type: 'image', style: { image: uri, x: tx, y: y0 - 5, width: 15, height: 11 } });
            tx += 20;
          }
          const room = x0 + w - tx - 6;
          const per = 7.2;
          let txt = it.name;
          const maxc = Math.max(1, Math.floor(room / per));
          if (txt.length > maxc) txt = maxc > 1 ? txt.slice(0, maxc - 1) + '…' : txt.slice(0, maxc);
          if (txt) {
            kids.push({
              type: 'text', style: {
                text: txt, x: tx, y: y0, fill: '#fff',
                font: '600 11.5px "Segoe UI",system-ui,sans-serif',
                textVerticalAlign: 'middle', textBaseline: 'middle'
              }
            });
          }
          /* 条尾分数 */
          kids.push({
            type: 'text', style: {
              text: val > 0 ? String(Math.round(val * 10) / 10) : '', x: x1 + 6, y: y0,
              fill: T.text2, font: '600 11.5px "Segoe UI",system-ui,sans-serif',
              textVerticalAlign: 'middle', textBaseline: 'middle'
            }
          });
          return { type: 'group', children: kids };
        },
        encode: { x: 0, y: 1 },
        data: data.map(function (d, i) { return { value: [round(d.value), i], id: d.id, iso: d.iso, name: d.name, no: d.no || i + 1 }; }),
        itemStyle: { opacity: 0.96 },
        emphasis: { itemStyle: { opacity: 1 } }
      }]
    });
  }

  /* ---------- WR 泳道 ---------- */
  /* 从 css/flags.css 读取国旗的 data URI（首次访问时用一个隐藏节点探测，结果缓存） */
  const _flagUri = {};
  let _flagProbe = null;
  function probeUri(cls) {
    try {
      if (!_flagProbe) {
        _flagProbe = document.createElement('span');
        _flagProbe.style.cssText = 'position:absolute;left:-9999px;top:0;width:10px;height:10px';
        document.body.appendChild(_flagProbe);
      }
      _flagProbe.className = cls;
      const bg = getComputedStyle(_flagProbe).backgroundImage || '';
      const m = bg.match(/url\((['"]?)(.*?)\1\)/);
      if (m) return m[2];
    } catch (e) { /* ignore */ }
    return '';
  }
  function flagUri(iso) {
    const code = String(iso || '').toUpperCase();
    if (!code || code === 'UNKNOWN') return '';
    if (_flagUri[code] !== undefined) return _flagUri[code];
    const url = probeUri('fi fi-' + code.toLowerCase());
    _flagUri[code] = url;
    return url;
  }
  /* 项目图标的 data URI（cubing_icons.css 里的 .cubing-icon.event-xxx） */
  const _evUri = {};
  function eventIconUri(ev) {
    if (!ev) return '';
    if (_evUri[ev] !== undefined) return _evUri[ev];
    const url = probeUri('cubing-icon event-' + ev);
    _evUri[ev] = url;
    return url;
  }

  function lanes(laneData, opts) {
    opts = opts || {};
    const T = pal();
    const y0 = opts.y0 || 2004, y1 = opts.y1 || 2026;
    const laneH = opts.laneH || 34;          /* 每条泳道的色块高度（可调大以容纳名字与国旗） */
    const cats = laneData.map(function (L) { return L.label; });
    const data = [];
    laneData.forEach(function (L, li) {
      L.segs.forEach(function (sg) {
        data.push({ value: [sg.from, li, sg.to, li, sg.holder, sg.country, sg.days, sg.fromDn || 0, sg.toDn || 0], itemStyle: { color: sg.color } });
      });
    });
    function renderItem(params, api) {
      const catIdx = api.value(1);
      const start = api.coord([api.value(0), catIdx]);
      const end = api.coord([api.value(2), catIdx]);
      const h = Math.min(laneH, api.size([0, 1])[1] * 0.78);
      const rect = window.echarts.graphic.clipRectByRect(
        { x: start[0], y: start[1] - h / 2, width: Math.max(2, end[0] - start[0]), height: h },
        { x: params.coordSys.x, y: params.coordSys.y, width: params.coordSys.width, height: params.coordSys.height }
      );
      if (!rect) return;
      const kids = [{
        type: 'rect', transition: ['shape'], shape: Object.assign({ r: 5 }, rect),
        style: { fill: api.visual('color'), stroke: T.elev, lineWidth: 1 }
      }];
      const w = rect.width;
      if (w > 40 && h >= 16) {
        const iso = api.value(5);
        const name = String(api.value(4) || '');
        let x = rect.x + 7;
        const uri = flagUri(iso);
        if (uri) {
          kids.push({
            type: 'image', style: {
              image: uri, x: x, y: rect.y + h / 2 - 5, width: 14, height: 10
            }
          });
          x += 18;
        }
        const room = rect.x + w - x - 5;
        const per = 6.4;
        let txt = name;
        const maxc = Math.max(1, Math.floor(room / per));
        if (txt.length > maxc) txt = maxc > 1 ? txt.slice(0, maxc - 1) + '…' : txt.slice(0, maxc);
        if (txt) {
          kids.push({
            type: 'text', style: {
              text: txt, x: x, y: rect.y + h / 2, fill: '#fff',
              font: '600 11.5px "Segoe UI",system-ui,sans-serif',
              textVerticalAlign: 'middle', textBaseline: 'middle'
            }
          });
        }
      }
      return { type: 'group', children: kids };
    }
    /* y 轴项目名：图标 + 名称（图标来自 cubing_icons.css，探测成 data URI 后用 rich 渲染） */
    const rich = {
      nm: { color: T.text2, fontSize: 11.5, padding: [0, 0, 0, 2] }
    };
    laneData.forEach(function (L, li) {
      const uri = eventIconUri(L.ev);
      if (uri) rich['ic' + li] = { height: 15, width: 15, backgroundColor: { image: uri } };
    });

    return Object.assign(base({ stagger: 8 }), {
      grid: { left: 6, right: 16, top: 22, bottom: 6, containLabel: true },
      xAxis: Object.assign({ type: 'value', min: y0, max: y1, interval: 2 }, axisCommon(), {
        /* 需求：竖向虚线（每年一条的分割线）不好看，去掉 */
        axisLabel: { color: T.text3, fontSize: 10.5, formatter: function (v) { return v; } },
        splitLine: { show: false }
      }),
      yAxis: Object.assign({ type: 'category', data: cats, inverse: true }, axisCommon(), {
        splitLine: { show: false },
        axisLabel: {
          color: T.text2, fontSize: 11.5,
          formatter: function (v, i) { return rich['ic' + i] ? '{ic' + i + '|}{nm|' + v + '}' : '{nm|' + v + '}'; },
          rich: rich
        }
      }),
      tooltip: {
        confine: true, backgroundColor: T.elev, borderColor: T.border, borderWidth: 1,
        textStyle: { color: T.text, fontSize: 12 },
        /* 跟随鼠标：把姓名 + 国旗 + 起止时间 + 持有天数直接显示在光标旁，
           取代原先图表下方那份冗长的持有者清单 */
        extraCssText: 'box-shadow:0 6px 20px rgba(0,0,0,.14);border-radius:10px;',
        formatter: function (p) {
          const v = p.data.value;
          const days = v[6] || 0;
          const iso = String(v[5] || '').toUpperCase();
          function fd(dn) { const s = String(dn || ''); return s.length === 8 ? s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8) : (LANE_I18N.now || '至今'); }
          const flagTag = iso ? '<img src="' + flagUri(iso) + '" style="width:15px;height:11px;vertical-align:-1px;margin-right:4px" alt="">' : '';
          return '<div style="display:flex;align-items:center;gap:2px">' + flagTag + '<b>' + v[4] + '</b></div>' +
            '<div style="margin-top:3px;font-size:11.5px;opacity:.85">' + fd(v[8]) + ' → ' + fd(v[9]) + '</div>' +
            '<div style="margin-top:2px;font-size:11.5px"><b>' + days + '</b> ' + (LANE_I18N.day || '天') + '</div>';
        }
      },
      series: [{
        type: 'custom', renderItem: renderItem, encode: { x: [0, 2], y: 1 },
        data: data,
        itemStyle: { opacity: 0.94 },
        emphasis: { itemStyle: { opacity: 1 } }
      }]
    });
  }
  let LANE_I18N = { mo: '个月', y: '年' };
  function setLaneI18n(o) { LANE_I18N = o || LANE_I18N; }

  /* ---------- 折线 ---------- */
  function lineChart(series, opts) {
    opts = opts || {};
    const T = pal();
    return Object.assign(base({ stagger: 40 }), {
      grid: { left: 6, right: 16, top: 14, bottom: 24, containLabel: true },
      xAxis: Object.assign({ type: opts.xType || 'category', data: opts.cats, boundaryGap: false }, axisCommon(), { splitLine: { show: false } }),
      yAxis: Object.assign({
        type: 'value', inverse: !!opts.inverse, min: opts.min, max: opts.max,
        axisLabel: { color: T.text3, fontSize: 11, formatter: opts.yFmt }
      }, axisCommon()),
      tooltip: Object.assign({ trigger: 'axis' }, base().tooltip),
      series: series.map(function (s) {
        return {
          name: s.name, type: 'line', smooth: 0.3, symbol: 'circle', symbolSize: 6,
          data: s.pts.map(function (p) { return p[1]; }),
          lineStyle: { width: 2.4, color: s.color }, itemStyle: { color: s.color },
          areaStyle: opts.area ? { color: s.color, opacity: 0.12 } : undefined
        };
      })
    });
  }

  /* ---------- 分组柱（国家实力 / 榜单） ---------- */
  function groupBars(items, opts) {
    opts = opts || {};
    const T = pal();
    return Object.assign(base({ stagger: 45 }), {
      grid: { left: 6, right: 12, top: 16, bottom: 6, containLabel: true },
      xAxis: Object.assign({ type: 'category', data: items.map(function (d) { return d.label; }) }, axisCommon(), { splitLine: { show: false }, axisLabel: { color: T.text3, fontSize: 11, interval: 0, rotate: opts.rotate || 0 } }),
      yAxis: Object.assign({ type: 'value' }, axisCommon()),
      tooltip: Object.assign({ trigger: 'axis', axisPointer: { type: 'shadow' } }, base().tooltip),
      series: [{
        type: 'bar', barMaxWidth: 34,
        itemStyle: { borderRadius: [5, 5, 0, 0] },
        label: { show: true, position: 'top', color: T.text3, fontSize: 10.5, formatter: function (p) { return round(p.value, 1); } },
        data: items.map(function (d, i) { return { value: round(d.value), itemStyle: { color: d.color || T.m[i % 7] } }; })
      }]
    });
  }

  /* ---------- 双向对比条（PK 逐模块差值） ---------- */
  function diverging(items, opts) {
    opts = opts || {};
    const T = pal();
    return Object.assign(base({ stagger: 40 }), {
      grid: { left: 6, right: 12, top: 10, bottom: 6, containLabel: true },
      xAxis: Object.assign({ type: 'value' }, axisCommon()),
      yAxis: Object.assign({ type: 'category', inverse: true, data: items.map(function (d) { return d.name; }) }, axisCommon(), { splitLine: { show: false }, axisLabel: { color: T.text2, fontSize: 11.5 } }),
      tooltip: Object.assign({ trigger: 'axis', axisPointer: { type: 'shadow' } }, base().tooltip),
      series: opts.series.map(function (s, si) {
        return {
          name: s.name, type: 'bar', stack: 'x', barMaxWidth: 20,
          itemStyle: { color: s.color, borderRadius: 3 },
          label: { show: true, position: si === 0 ? 'left' : 'right', color: T.text2, fontSize: 10.5, formatter: function (p) { return Math.abs(p.value) > 0.05 ? round(Math.abs(p.value), 1) : ''; } },
          data: items.map(function (d) { return si === 0 ? -Math.abs(d[si]) : Math.abs(d[si]); })
        };
      })
    });
  }

  /* ---------- 仪表盘（稳健性） ---------- */
  function gauge(value, opts) {
    opts = opts || {};
    const T = pal();
    return Object.assign(base(), {
      series: [{
        type: 'gauge', startAngle: 200, endAngle: -20, radius: '96%',
        min: 0, max: 100, splitNumber: 5,
        axisLine: {
          lineStyle: {
            width: 12,
            color: [[0.5, T.border2], [0.75, cssVar('--m2', '#ef8f3c')], [1, cssVar('--m4', '#3fa06a')]]
          }
        },
        pointer: { icon: 'path://M2.9,0.7L2.9,0.7c1.4,0,2.6,1.2,2.6,2.6v115c0,1.4-1.2,2.6-2.6,2.6l0,0c-1.4,0-2.6-1.2-2.6-2.6V3.3C0.3,1.9,1.4,0.7,2.9,0.7z', width: 6, length: '62%', offsetCenter: [0, '5%'], itemStyle: { color: T.accent } },
        axisTick: { distance: -14, length: 5, lineStyle: { color: T.border, width: 1 } },
        splitLine: { distance: -16, length: 12, lineStyle: { color: T.border2, width: 2 } },
        axisLabel: { distance: -8, color: T.text3, fontSize: 10 },
        anchor: { show: true, size: 12, itemStyle: { color: T.accent } },
        title: { show: false },
        detail: { valueAnimation: true, fontSize: 24, fontWeight: 600, color: T.text, offsetCenter: [0, '38%'], formatter: '{value}%' },
        data: [{ value: round(value, 1) }]
      }]
    });
  }

  /* ---------- 散点象限（效率 vs 成就） ---------- */
  function scatter(points, opts) {
    opts = opts || {};
    const T = pal();
    return Object.assign(base({ stagger: 20 }), {
      grid: { left: 6, right: 20, top: 16, bottom: 24, containLabel: true },
      xAxis: Object.assign({ type: 'value', name: opts.xName || '', nameTextStyle: { color: T.text3, fontSize: 11 }, nameLocation: 'middle', nameGap: 22 }, axisCommon()),
      yAxis: Object.assign({ type: 'value', name: opts.yName || '', nameTextStyle: { color: T.text3, fontSize: 11 } }, axisCommon()),
      tooltip: Object.assign({ trigger: 'item', formatter: function (p) { return p.data[2]; } }, base().tooltip),
      series: [{
        type: 'scatter', symbolSize: function (d) { return 8 + Math.sqrt(Math.max(0, d[3] || 0)) * 1.6; },
        itemStyle: { opacity: 0.82, borderColor: T.elev, borderWidth: 1 },
        emphasis: { scale: 1.3, itemStyle: { opacity: 1 } },
        data: points
      }]
    });
  }

  function round(x, n) { const p = Math.pow(10, n == null ? 2 : n); return Math.round(x * p) / p; }

  /* ---------- 统一挂载：扫描 [data-ec] ---------- */
  function mount(root) {
    if (!has()) return;
    refreshPalette();
    const scope = root || document;
    const nodes = scope.querySelectorAll ? scope.querySelectorAll('.ec[data-ec]') : [];
    Array.prototype.forEach.call(nodes, function (el) {
      let opt = null;
      try { opt = JSON.parse(el.getAttribute('data-ec')); } catch (e) { opt = null; }
      if (!opt) return;
      const builder = BUILDERS[opt.type];
      if (!builder) return;
      try {
        const o = builder(opt.data || {}, opt.opts || {});
        o.backgroundColor = 'transparent';
        resolveDeep(o);
        render(el, o, opt.opts || {});
        el.removeAttribute('data-ec');
      } catch (e) { /* 单个图表失败不影响其余 */ }
    });
  }

  const BUILDERS = {
    stacked: stacked, waterfall: waterfall, donut: donut, radar: radar, bump: bump,
    barRace: barRace, lanes: lanes, line: lineChart, groupBars: groupBars,
    setLaneI18n: setLaneI18n, flagUri: flagUri,
    diverging: diverging, gauge: gauge, scatter: scatter
  };

  window.Charts = {
    has: has, mount: mount, render: render, refresh: refreshPalette, theme: pal, round: round,
    resolveColor: resolveColor, resolveDeep: resolveDeep,
    stacked: stacked, waterfall: waterfall, donut: donut, radar: radar, bump: bump,
    barRace: barRace, lanes: lanes, line: lineChart, groupBars: groupBars,
    setLaneI18n: setLaneI18n, flagUri: flagUri,
    diverging: diverging, gauge: gauge, scatter: scatter
  };
})();

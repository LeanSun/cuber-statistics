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
    if (!el || !has()) return null;
    let inst = null;
    try { inst = window.echarts.getInstanceByDom(el); } catch (e) { }
    if (!inst) inst = window.echarts.init(el, null, { renderer: 'canvas' });
    inst.setOption(option, true);
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
  function radar(rows, indicators, opts) {
    opts = opts || {};
    const T = pal();
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

  /* ---------- 条形竞赛 ---------- */
  function barRace(items, opts) {
    opts = opts || {};
    const T = pal();
    const n = Math.min(items.length, opts.top || 12);
    const data = items.slice(0, n);
    return Object.assign(base({ stagger: 55 }), {
      grid: { left: 6, right: 62, top: 6, bottom: 6, containLabel: true },
      xAxis: Object.assign({ type: 'value' }, axisCommon()),
      yAxis: Object.assign({ type: 'category', inverse: true, data: data.map(function (d) { return d.name; }) }, axisCommon(), { splitLine: { show: false }, axisLabel: { color: T.text, fontSize: 12 } }),
      tooltip: Object.assign({ trigger: 'axis', axisPointer: { type: 'shadow' } }, base().tooltip),
      series: [{
        type: 'bar', barMaxWidth: 22,
        realtimeSort: true,
        itemStyle: { borderRadius: [0, 5, 5, 0] },
        label: { show: true, position: 'right', color: T.text2, fontSize: 11.5, formatter: function (p) { return round(p.value, 1); } },
        data: data.map(function (d) { return { value: round(d.value), itemStyle: { color: d.color } }; })
      }]
    });
  }

  /* ---------- WR 泳道 ---------- */
  function lanes(laneData, opts) {
    opts = opts || {};
    const T = pal();
    const y0 = opts.y0 || 2004, y1 = opts.y1 || 2026;
    const cats = laneData.map(function (L) { return L.label; });
    const data = [];
    laneData.forEach(function (L, li) {
      L.segs.forEach(function (sg) {
        data.push({ value: [sg.from, li, sg.to, li, sg.holder, sg.country, sg.days], itemStyle: { color: sg.color } });
      });
    });
    function renderItem(params, api) {
      const catIdx = api.value(1);
      const start = api.coord([api.value(0), catIdx]);
      const end = api.coord([api.value(2), catIdx]);
      const h = Math.min(20, api.size([0, 1])[1] * 0.62);
      const rect = window.echarts.graphic.clipRectByRect(
        { x: start[0], y: start[1] - h / 2, width: Math.max(2, end[0] - start[0]), height: h },
        { x: params.coordSys.x, y: params.coordSys.y, width: params.coordSys.width, height: params.coordSys.height }
      );
      if (!rect) return;
      return { type: 'rect', transition: ['shape'], shape: Object.assign({ r: 4 }, rect), style: { fill: api.visual('color'), stroke: T.elev, lineWidth: 1 } };
    }
    return Object.assign(base({ stagger: 8 }), {
      grid: { left: 6, right: 16, top: 22, bottom: 6, containLabel: true },
      xAxis: Object.assign({ type: 'value', min: y0, max: y1, interval: 2 }, axisCommon(), {
        axisLabel: { color: T.text3, fontSize: 10.5, formatter: function (v) { return v; } }, splitLine: { show: true, lineStyle: { color: T.border, type: 'dashed' } }
      }),
      yAxis: Object.assign({ type: 'category', data: cats, inverse: true }, axisCommon(), { splitLine: { show: false }, axisLabel: { color: T.text2, fontSize: 11.5 } }),
      tooltip: {
        confine: true, backgroundColor: T.elev, borderColor: T.border, borderWidth: 1,
        textStyle: { color: T.text, fontSize: 12 },
        extraCssText: 'box-shadow:0 6px 20px rgba(0,0,0,.14);border-radius:10px;',
        formatter: function (p) {
          const v = p.data.value;
          return v[4] + ' · ' + v[5] + '<br/>' + v[0] + '–' + v[2] + ' · ' + v[6] + ' 天';
        }
      },
      series: [{
        type: 'custom', renderItem: renderItem, encode: { x: [0, 2], y: 1 },
        data: data,
        itemStyle: { opacity: 0.92 },
        emphasis: { itemStyle: { opacity: 1 } }
      }]
    });
  }

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
      const o = builder(opt.data || {}, opt.opts || {});
      o.backgroundColor = 'transparent';
      resolveDeep(o);
      render(el, o, opt.opts || {});
      el.removeAttribute('data-ec');
    });
  }

  const BUILDERS = {
    stacked: stacked, waterfall: waterfall, donut: donut, radar: radar, bump: bump,
    barRace: barRace, lanes: lanes, line: lineChart, groupBars: groupBars,
    diverging: diverging, gauge: gauge, scatter: scatter
  };

  window.Charts = {
    has: has, mount: mount, render: render, refresh: refreshPalette, theme: pal, round: round,
    stacked: stacked, waterfall: waterfall, donut: donut, radar: radar, bump: bump,
    barRace: barRace, lanes: lanes, line: lineChart, groupBars: groupBars,
    diverging: diverging, gauge: gauge, scatter: scatter
  };
})();

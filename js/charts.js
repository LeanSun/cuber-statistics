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
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
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
    if (!inst) {
      /* init 也可能失败（容器被销毁 / 非法尺寸），不要让它把整页渲染带崩 */
      try { inst = window.echarts.init(el, null, { renderer: 'canvas' }); } catch (e) { inst = null; }
    }
    if (!inst) return null;
    const notMerge = opts.notMerge !== false; /* 默认整图替换；仅当显式 notMerge:false 时做增量合并 */
    inst.setOption(option, notMerge);
    /* 容器在初始化时若尚不可见（宽高为 0，例如刚切到该视图 / 父级布局未稳定），
       首帧会画出一张 0 尺寸的空白图。下一帧补一次 resize，让图表按真实尺寸重绘，
       避免「图表区域空白、需手动缩放窗口才出现」这类问题。 */
    if ((!el.clientWidth && !el.offsetWidth) || (!el.clientHeight && !el.offsetHeight)) {
      requestAnimationFrame(function () { try { inst.resize(); } catch (e) { } });
    }
    /* 尺寸变化（含从隐藏变可见）时自动重绘一次：仅靠 window.resize 兜不住 Tab / 视图切换 */
    if (window.ResizeObserver && !el.__ecRO) {
      try {
        el.__ecRO = new window.ResizeObserver(function () { try { inst.resize(); } catch (e) { } });
        el.__ecRO.observe(el);
      } catch (e) { }
    }
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
    /* 逐轴满分：opts.max 可以是数字（所有轴同一个满分），也可以是数组（每轴各一个）。
       六维维度分是「Σ_项目 归一分」，天然可以远大于 1000（Feliks 的 M3 = 5640），
       所以再用同一个 1000 当满分会让图形整个冲出图表 —— 满分必须逐轴给。 */
    const maxArr = Array.isArray(opts.max) ? opts.max : null;
    const maxOne = maxArr ? 0 : (opts.max || 100);
    /* 封顶：允许个别选手在单轴超出满分（这正是「世界前十均值」作满分的本意），
       但不能超出太多，否则多边形会冲出画布。默认封顶 2 倍，配合 46% 半径刚好装下。 */
    const capAt = opts.capAt || 2;
    const mk = rows.map(function (r) {
      const real = r.values.map(function (v) { return Number(v) || 0; });
      const capped = real.map(function (v, i) {
        const mx = maxArr ? (maxArr[i] || 1) : maxOne;
        const cap = mx * capAt;
        return round(v > cap ? cap : v);
      });
      return {
        name: r.name, value: capped, real: real,
        itemStyle: { color: r.color }, lineStyle: { color: r.color }, areaStyle: { color: r.color }
      };
    });
    return Object.assign(base({ duration: 620 }), {
      /* 悬浮框显示**真实值**（不是封顶后的值），否则读到的数字是假的 */
      tooltip: Object.assign({
        trigger: 'item',
        formatter: function (p) {
          const r = mk[p.dataIndex];
          if (!r) return '';
          const vs = r.real || r.value;
          let s = '<b>' + esc(r.name) + '</b>';
          indicators.forEach(function (n, i) {
            const mx = maxArr ? (maxArr[i] || 1) : maxOne;
            s += '<br/>' + esc(String(n)) + '：' + f2(vs[i]) +
              (vs[i] > mx ? ' <span style="opacity:.7">（满分 ' + f2(mx) + '，已封顶显示）</span>' : '');
          });
          return s;
        }
      }, base().tooltip),
      legend: { show: true, bottom: 0, textStyle: { color: T.text2, fontSize: 11.5 }, itemWidth: 12, itemHeight: 8, data: rows.map(function (r) { return r.name; }) },
      radar: {
        center: ['50%', '48%'], radius: opts.radius || '62%',
        indicator: indicators.map(function (n, i) {
          return { name: n, max: maxArr ? (maxArr[i] || 1) : maxOne, color: T.text2 };
        }),
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
        data: mk
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

  /* ---------- 条形竞赛（value 型 Y 轴 + 按选手 id 键控，名次变化时条形与姓名/国旗整体滑动） ---------- */
  function barRace(items, opts) {
    opts = opts || {};
    const T = pal();
    const n = opts.top || 15;
    const dur = opts.duration == null ? 720 : opts.duration;
    /* items：已包含稳定 id 与预计算 rank（1..n 为可见名次，>n 为屏幕外占位）。
       Y 轴改用「数值坐标」（= 名次），名次变化时 y 在帧间连续插值，
       于是条形、姓名、国旗、分数会作为一个整体上下滑动，而不再是「槽位固定、名字瞬跳」。 */
    const data = items.slice();
    return Object.assign(base({ stagger: 0, duration: dur }), {
      /* 上下留白 30：Y 轴范围 1..n 时，第 1 名 / 第 n 名的条形中心正好贴在
         网格上下边界，条形高约 24px，留白不够上半条 / 下半条会被切掉。
         同时 series.clip 关掉（见下），双保险：就算有极端行高也不会被裁。 */
      grid: { left: 34, right: 86, top: 30, bottom: 30, containLabel: false },
      xAxis: Object.assign({ type: 'value', max: function (v) { return Math.max(v.max, 1) * 1.05; } }, axisCommon()),
      /* 轴范围 1..n（原来是 0.5..n+0.5）：条形画在整数名次上，而刻度原来落在
         0.5/1.5/2.5… 上，两者错开半格 —— 这就是「序号与行对不齐」的根因。
         现在刻度值与名次 1:1 对应，序号与条形中心严格同一条水平线。
         序号文字去掉 '#'（用户要求 1、2、3）。 */
      yAxis: Object.assign(axisCommon(), {
        type: 'value', inverse: true, min: 1, max: n, interval: 1,
        axisLabel: { color: T.text3, fontSize: 11, formatter: function (v) { return String(Math.round(v)); } },
        axisLine: { lineStyle: { color: T.border }, show: false },
        axisTick: { show: false },
        splitLine: { show: false }
      }),
      tooltip: Object.assign({
        trigger: 'item', axisPointer: { type: 'shadow' },
        formatter: function (p) {
          const d = p.data || {};
          if (!d || !d.id || !d.name) return '';
          const v = (d.value && d.value[0]) || 0;
          return '<b>' + esc(d.name) + '</b><br/>' + esc(d.iso || '') + ' · ' + f2(v);
        }
      }, base().tooltip),
      series: [{
        type: 'custom',
        /* clip 关掉：首末两名的条形有一半落在网格外，打开会被裁成半条。 */
        clip: false,
        renderItem: function (params, api) {
          const rank = api.value(1);
          const val = Math.max(0, api.value(0));
          const d = data[params.dataIndex];
          if (!d || !d.id || !d.name) return;   /* 屏幕外占位：不画 */
          const yc = api.coord([0, rank])[1];
          const x0 = api.coord([0, rank])[0];
          const x1 = api.coord([val, rank])[0];
          const h = Math.max(10, Math.min(24, api.size([0, 1])[1] * 0.68));
          const w = Math.max(2, x1 - x0);
          const kids = [{
            type: 'rect', transition: ['shape'],
            shape: { x: x0, y: yc - h / 2, width: w, height: h, r: 5 },
            style: { fill: d.color || T.m[0], stroke: T.elev, lineWidth: 1 }
          }];
          let tx = x0 + 6;
          /* 排名序号不再在条形左端外侧画第二份：原先 Y 轴标签（#1…#n，落在半格上）
             与这里自画的序号（落在条形上）是两套坐标，视觉上就是「序号与行错开」。
             现在序号统一由 Y 轴给出（轴范围 1..n，与名次 1:1），这里只画条形内容。 */
          const uri = d.flag || flagUri(d.iso);
          if (uri) {
            kids.push({ type: 'image', transition: ['style'], style: { image: uri, x: tx, y: yc - 5, width: 15, height: 11 } });
            tx += 20;
          }
          const room = x0 + w - tx - 6;
          const per = 7.2;
          let txt = d.name;
          const maxc = Math.max(1, Math.floor(room / per));
          if (txt.length > maxc) txt = maxc > 1 ? txt.slice(0, maxc - 1) + '…' : txt.slice(0, maxc);
          if (txt) {
            kids.push({
              type: 'text', transition: ['style'], style: {
                text: txt, x: tx, y: yc, fill: '#fff',
                font: '600 11.5px "Segoe UI",system-ui,sans-serif',
                textVerticalAlign: 'middle', textBaseline: 'middle'
              }
            });
          }
          /* 条尾分数：随条形右端 x1 一起左右滑动，并与名次一起上下滑动。
             两位小数（与全站分数显示一致），右侧留白已同步加宽到 86。 */
          kids.push({
            type: 'text', transition: ['style'], style: {
              text: val > 0 ? f2(val) : '', x: x1 + 6, y: yc,
              fill: T.text2, font: '600 11.5px "Segoe UI",system-ui,sans-serif',
              textVerticalAlign: 'middle', textBaseline: 'middle'
            }
          });
          return { type: 'group', children: kids };
        },
        encode: { x: 0, y: 1 },
        data: data.map(function (d, i) {
          return {
            value: [round(d.value || 0), d.rank != null ? d.rank : (i + 1)],
            id: d.id, name: d.name, iso: d.iso, flag: d.flag, color: d.color,
            no: d.no != null ? d.no : (d.rank != null ? d.rank : i + 1)
          };
        }),
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
  /* 项目图标：cubing-icons 是「图标字体」而不是背景图
     （.cubing-icon.event-333:before { content:"\f106" }），
     所以不能像国旗那样去读 background-image。
     这里先从 :before 的 content 里拿到字形码点，再用 canvas 把字形栅格化成
     data URI，才能交给 ECharts 的 rich backgroundColor.image 渲染。 */
  const _evUri = {};
  function glyphOf(cls) {
    try {
      if (!_flagProbe) {
        _flagProbe = document.createElement('span');
        _flagProbe.style.cssText = 'position:absolute;left:-9999px;top:0;width:10px;height:10px';
        document.body.appendChild(_flagProbe);
      }
      _flagProbe.className = cls;
      const st = getComputedStyle(_flagProbe, ':before');
      let c = (st && st.content) || '';
      if (!c || c === 'none' || c === 'normal') return '';
      c = c.trim().replace(/^["']+/, '').replace(/["']+$/, '');
      if (c.length === 1) return c;
      const m = c.match(/\\([0-9a-fA-F]{1,6})/);
      if (m) return String.fromCharCode(parseInt(m[1], 16));
      return c.charAt(0) || '';
    } catch (e) { /* ignore */ }
    return '';
  }
  function glyphUri(ch, color, size) {
    try {
      const s = size || 20;
      const cv = document.createElement('canvas');
      cv.width = s; cv.height = s;
      const g = cv.getContext('2d');
      if (!g) return '';
      g.clearRect(0, 0, s, s);
      g.font = Math.round(s * 0.84) + 'px "cubing-icons",cubing-icons';
      g.fillStyle = color || '#8a8f9c';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(ch, s / 2, s / 2 + 1);
      return cv.toDataURL('image/png');
    } catch (e) { /* ignore */ }
    return '';
  }
  /* 图标字体是异步加载的：首次画泳道时它可能还没就绪，画出来会是「豆腐块」。
     这里显式触发一次字体加载，就绪后派发 resize 让 ECharts 重绘一次补上图标。 */
  let _iconFontWarm = false;
  function warmIconFont() {
    if (_iconFontWarm) return;
    _iconFontWarm = true;
    try {
      if (typeof document !== 'undefined' && document.fonts && document.fonts.load) {
        document.fonts.load('20px "cubing-icons"').then(function () {
          try { window.dispatchEvent(new Event('resize')); } catch (e) { /* ignore */ }
        }).catch(function () { /* ignore */ });
      }
    } catch (e) { /* ignore */ }
  }
  function eventIconUri(ev, color) {
    if (!ev) return '';
    const ck = ev + '|' + (color || '');
    if (_evUri[ck] !== undefined) return _evUri[ck];
    warmIconFont();
    const ch = glyphOf('cubing-icon event-' + ev);
    _evUri[ck] = ch ? glyphUri(ch, color) : '';
    return _evUri[ck];
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
    /* y 轴项目名：图标 + 名称（图标来自 cubing_icons.css，探测成 data URI 后用 rich 渲染；
       图标与文字都放大，更易辨识；顺序由调用方按 WCA 默认项目顺序排好 */
    const rich = {
      nm: { color: T.text2, fontSize: 13, padding: [0, 0, 0, 3] }
    };
    laneData.forEach(function (L, li) {
      const uri = eventIconUri(L.ev, T.text);
      if (uri) rich['ic' + li] = { height: 20, width: 20, padding: [0, 4, 0, 0], backgroundColor: { image: uri } };
    });

    return Object.assign(base({ stagger: 8 }), {
      grid: { left: 6, right: 16, top: 22, bottom: 6, containLabel: true },
      xAxis: Object.assign({ type: 'value', min: y0, max: y1, interval: 2 }, axisCommon(), {
        axisLabel: { color: T.text3, fontSize: 10.5, formatter: function (v) { return v; } },
        splitLine: { show: false }
      }),
      yAxis: Object.assign({ type: 'category', data: cats, inverse: true }, axisCommon(), {
        splitLine: { show: false },
        axisLabel: {
          color: T.text2, fontSize: 13,
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
            '<div style="margin-top:3px;font-size:11.5px;opacity:.85">' + fd(v[7]) + ' → ' + fd(v[8]) + '</div>' +
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
  /* 两位小数的固定显示（竞速图条尾 / 悬浮框）：与全站分数口径一致 */
  function f2(v) { const n = Number(v); return (isFinite(n) ? Math.round(n * 100) / 100 : 0).toFixed(2); }

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

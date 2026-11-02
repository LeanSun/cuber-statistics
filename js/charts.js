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
  /* 「第 {n} 名」这类模板填充：文案由 pages-extra 经 setLaneI18n 注入（中英各一套） */
  function fillTpl(tpl, o) {
    return String(tpl == null ? '' : tpl).replace(/\{(\w+)\}/g, function (m, k) {
      return (o && o[k] != null) ? String(o[k]) : '';
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

  /* ---------- 悬浮框统一「贴在光标正上方」 ---------- */
  /* 2026-11-01 用户要求：纪录持有图与分数竞速图的 tooltip 都要浮在鼠标上方，
     允许越出图表顶层（不再被 confine 关回图内），但**绝不允许压住鼠标**。
     ★ 坑：position(point,…) 的 point 是「相对图表容器」的坐标，而边界判断要的是视口坐标，
       混用会让它永远判成「上方放不下」、反而把弹窗盖到光标上 —— 所以先换算再算，算完换回去。 */
  function tipPos(point, params, dom, rect, size) {
    /* 尺寸优先量真实 DOM：size.contentSize 没算上内边距 / 边框，小弹窗上会差十几像素，
       于是「上方」算出来的位置其实还压着光标。 */
    let cw = (size && size.contentSize ? size.contentSize[0] : 200);
    let ch = (size && size.contentSize ? size.contentSize[1] : 80);
    try {
      if (dom && dom.offsetHeight > 0) { cw = dom.offsetWidth; ch = dom.offsetHeight; }
    } catch (e) { }
    let ox = 0, oy = 0;
    try {
      const host = dom && dom.parentNode;
      if (host && host.getBoundingClientRect) {
        const hr = host.getBoundingClientRect();
        ox = hr.left; oy = hr.top;
      }
    } catch (e) { }
    const de = document.documentElement || {};
    const vw = de.clientWidth || window.innerWidth || 800;
    const vh = de.clientHeight || window.innerHeight || 600;
    /* 顶部安全线：顶栏是 position:sticky + z-index，弹窗一旦钻到它下面就会被盖住半截。
       允许越出图表顶层，但不能越到顶栏下面去。 */
    let safeTop = 6;
    try {
      const tb = document.querySelector('.topbar');
      if (tb) {
        const tr = tb.getBoundingClientRect();
        if (tr.top <= 0.5) safeTop = Math.max(6, Math.round(tr.bottom + 6));
      }
    } catch (e) { }
    const px = point[0] + ox, py = point[1] + oy;
    let x = px - cw / 2;
    x = Math.max(6, Math.min(x, vw - cw - 6));
    /* 先试光标上方；顶部放不下才翻到下方（并留 18px 让开鼠标） */
    let y = py - ch - 16;
    if (y < safeTop) y = py + 18;
    if (y + ch > vh - 6) y = Math.max(safeTop, vh - ch - 6);
    return [Math.round(x - ox), Math.round(y - oy)];
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

  /* ---------- 文本宽度测量（供条形竞赛判断「条内能否放下完整国旗+名字」） ---------- */
  /* 用 canvas 的 measureText 精确测宽，比「字数 × 固定字宽」靠得住：
     中英混排（如 "Baoqiang Dong (董百强)"）里汉字约占 11.5px、拉丁字母约 6px，
     用同一个平均字宽估算必然一头偏大一头偏小。结果按「字体|文本」缓存，
     竞速图每帧只会命中缓存，不产生额外测量开销。 */
  const _twCache = {};
  let _twCtx = null;
  let _twTried = false;
  function textW(s, font) {
    if (!s) return 0;
    const key = font + '\u0001' + s;
    const hit = _twCache[key];
    if (hit != null) return hit;
    if (!_twTried) {
      _twTried = true;
      /* 冒烟测试环境可能没有 canvas 2d 上下文，失败后永久回退到估算值 */
      try { _twCtx = document.createElement('canvas').getContext('2d'); } catch (e) { _twCtx = null; }
    }
    let w = 0;
    if (_twCtx) {
      try { _twCtx.font = font; w = _twCtx.measureText(s).width || 0; } catch (e) { w = 0; }
    }
    if (!w) w = s.length * 7.2;
    /* 缓存上限保护：名字集合有限，正常不会触发 */
    if (Object.keys(_twCache).length > 20000) { for (const k in _twCache) delete _twCache[k]; }
    _twCache[key] = w;
    return w;
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
    /* 分数列固定宽度（用户 2026-11-01 要求）：
       名称/国旗放在「条形 + 条尾分数」之后时，分数文字每帧都在变（999.87 → 1000.02），
       字形宽度一变，紧跟其后的国旗+姓名就被推着左右抖一下。这里按本帧数据里
       最长的整数位数预先量好一列的宽度，名称总线一律按这个常量排 —— 分数再怎么涨，
       名称的位置只随条形右端平滑移动，不再有抖动。 */
    let maxIntLen = 1;
    data.forEach(function (d) {
      const s = String(Math.floor(Math.abs(+d.value || 0)));
      if (s.length > maxIntLen) maxIntLen = s.length;
    });
    const scoreColW = textW(new Array(Math.max(3, maxIntLen) + 1).join('0') + '.00',
      '600 11.5px "Segoe UI",system-ui,sans-serif');
    /* 榜首 / 榜眼分数：tooltip 里要给出「领先多少 / 距榜首多少」，比原来的国家两位码有用得多。
       每帧建一次，data 长度是「选手宇宙」规模（几百），这点开销可以忽略。 */
    let lead1 = 0, lead2 = 0;
    data.forEach(function (d) {
      const x = Math.max(0, +d.value || 0);
      if (x > lead1) { lead2 = lead1; lead1 = x; } else if (x > lead2) { lead2 = x; }
    });
    return Object.assign(base({ stagger: 0, duration: dur }), {
      /* ★ 关掉 ECharts 自己的补间：名次与分数的平滑由调用方（pages-extra）逐帧插值提供，
         条形 / 姓名 / 国旗 / 分数都按同一个插值值绘制，所以天然同步。
         若保留这里的元素补间，rect 的 shape 会被 ECharts 再缓动一次（text 却不会），
         「姓名先跳、条形再追」的错位会重新出现。 */
      animation: false,
      /* 上下留白 30：Y 轴范围 1..n 时，第 1 名 / 第 n 名的条形中心正好贴在
         网格上下边界，条形高约 25px，留白不够上半条 / 下半条会被切掉。
         同时 series.clip 关掉（见下），双保险：就算有极端行高也不会被裁。 */
      /* 2026-10-27 彻底修「x 轴刻度被第 15 名遮挡」：
         之前只是把 grid.bottom 从 30 加到 46 —— 但那没用，因为末名的条形中心就画在
         网格**底边**上（yAxis max = n），条形下半截本来就探进了 x 轴刻度所在的留白区，
         留白加大只是把刻度推得更远，条形照样压在刻度上。
         真正的解法是给 Y 轴多留一格（max = n + 1）并隐藏这一格的标签：
         末名条形整体上移半格，x 轴刻度与其下方留白完全空出来，两者物理上不再重叠。 */
      grid: { left: 34, right: 86, top: 30, bottom: 34, containLabel: false },
      /* 顶部也加一条与底部完全一致的分数轴（让用户一眼读到「当前最高分」）。
         两条轴共用同一 min/max，所以先把 x 轴最大值按本帧数据算成定值
         （底部轴原来用函数式自适应，那样两条轴会对不上）。 */
      xAxis: (function () {
        let xm = 1;
        data.forEach(function (d) { const x = Math.max(0, +d.value || 0); if (x > xm) xm = x; });
        xm = xm * 1.05;
        /* 刻度文字：千分位、取整；**最右端那个「最大值」刻度不画**（用户 2026-11-01 要求）——
           它是 最大值×1.05 的裸值（如 3,791.4343393500008），既不是整刻度也没人看，
           贴在右上角还会压着条形。用 v 与 xm 的差判等，避免浮点误差漏判。 */
        function fmtTick(v) {
          if (Math.abs(v - xm) < Math.max(1e-6, xm * 1e-9)) return '';
          const r = Math.round(v);
          return String(r).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        }
        return [
          Object.assign({ type: 'value', min: 0, max: xm }, axisCommon(), {
            axisLabel: { color: T.text3, fontSize: 11, formatter: fmtTick },
            splitLine: { lineStyle: { color: T.border, type: 'dashed' } }
          }),
          Object.assign({ type: 'value', min: 0, max: xm, position: 'top', gridIndex: 0 }, axisCommon(), {
            axisLabel: { color: T.text3, fontSize: 10.5, formatter: fmtTick },
            axisLine: { show: true, lineStyle: { color: T.border, width: 1 } },
            axisTick: { show: false },
            splitLine: { show: false }
          })
        ];
      })(),
      /* Y 轴范围 0..n+1：刻度落在整数名次上（条形中心与刻度严格同线）。
         2026-11-01 用户反馈「顶部分数轴被第 1 名的条压住」——
         原来 min=1，第 1 名条形中心正好贴着网格顶边，上半条探进顶部刻度的位置。
         现在上方多留一个空格（min=0，v=0 不画标签），第 1 名整体下移约一格，
         顶部分数轴与条形彻底分开；下方仍保留 n+1 的缓冲格给 x 轴刻度。 */
      yAxis: Object.assign(axisCommon(), {
        type: 'value', inverse: true, min: 0, max: n + 1, interval: 1,
        axisLabel: {
          color: T.text3, fontSize: 11,
          /* 0 与 n+1 两格只是上下缓冲，不画序号 */
          formatter: function (v) { return (v < 1 || v > n) ? '' : String(Math.round(v)); }
        },
        axisLine: { lineStyle: { color: T.border }, show: false },
        axisTick: { show: false },
        splitLine: { show: false }
      }),
      /* 悬浮框与纪录持有图统一：浮在光标上方、允许越出图表顶层、留 16~18px 让开鼠标
         （见 tipPos；原来的 base().tooltip 是 confine:true，贴着图表顶部时只能压住鼠标）。 */
      tooltip: Object.assign({}, base().tooltip, {
        confine: false, position: tipPos,
        trigger: 'item', axisPointer: { type: 'shadow' },
        extraCssText: 'box-shadow:0 6px 20px rgba(0,0,0,.14);border-radius:10px;padding:8px 10px;pointer-events:none;',
        formatter: function (p) {
          const d = p.data || {};
          if (!d || !d.id || !d.name) return '';
          const v = (d.value && d.value[0]) || 0;
          const no = d.no || 0;
          /* 姓名前加一面国旗（用户 2026-11-01 要求）：条内已经有小国旗，
             但条被裁短时国旗可能落在条外，tooltip 里始终带上更稳。 */
          const fu = flagUri(d.iso);
          const ft = fu ? '<img src="' + fu + '" style="width:15px;height:11px;vertical-align:-1px;margin-right:5px" alt="">' : '';
          const ptTxt = esc(LANE_I18N.pt || '分');
          const num = function (x) {
            return '<b style="font-variant-numeric:tabular-nums">' + f2(x) + '</b>' + ptTxt;
          };
          /* 分隔点：两侧各留 7px，让「第 N 名 · 分数」读起来清清楚楚（用户 2026-11-01 要求拉开间距）。 */
          const dot = '<span style="display:inline-block;min-width:6px;padding:0 7px;opacity:.55;font-weight:400">·</span>';
          /* 版式（2026-11-01 第五轮，用户指定）：
               国旗 姓名
               第 N 名   ·   1553.94分       ← 名次 + 自己的分数
               领先第二名 75.3%   ·   2146.25分   ← 与参照选手的相对关系 + 参照选手的分数
             第 1 名的参照是第二名，其余名次的参照是榜首。 */
          let h = '<div style="display:flex;align-items:center;gap:2px">' + ft + '<b>' + esc(d.name) + '</b></div>';
          const rankTxt = no ? esc(fillTpl(LANE_I18N.raceRank || '第 {n} 名', { n: no })) + dot : '';
          h += '<div style="margin-top:3px;font-size:11.5px;opacity:.85">' + rankTxt + num(v) + '</div>';
          let rel = '';
          let ref = 0;
          if (no === 1 && lead2 > 0 && lead1 > lead2) {
            rel = fillTpl(LANE_I18N.raceAhead || '领先第二名 {p}%', { p: ((lead1 - lead2) / lead2 * 100).toFixed(1) });
            ref = lead2;
          } else if (no > 1 && lead1 > 0 && v > 0) {
            rel = fillTpl(LANE_I18N.raceOfTop || '榜首的 {p}%', { p: (v / lead1 * 100).toFixed(1) });
            ref = lead1;
          }
          if (rel) {
            h += '<div style="margin-top:2px;font-size:11.5px;opacity:.85">' + esc(rel) +
              (ref > 0 ? dot + num(ref) : '') + '</div>';
          }
          return h;
        }
      }),
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
          /* 条高（2026-11-02 第二轮用户要求：从 20px 加高到 25px）：
             一格名次 = 绘图高 /(n+1)，当前 520px 高、top30+bottom34 时约 28.5px/格，
             取 0.88 落到 ≈25px（留 12% 间隙，名字与条不糊在一起）。
             上限一并从 24 提到 30，这样更高的视口 / 更少的入选人数也能同步变粗。 */
          /* 条高与条间距（2026-11-03 用户要求）：
             条高固定 25px、两条之间留 10px。一格名次 = 绘图高 /(n+1)，
             由调用方把画幅定成 35px/格（见 pages-extra 的 RACE_PITCH），
             因此这里直接取「格高 − 10」当条高，间隙就恒为 10px；
             换窗口 / 换入选人数让格高变化时，先保间隙、再把条高夹在 10~34px。 */
          const pitch = api.size([0, 1])[1];
          const h = Math.max(10, Math.min(34, pitch - 10));

          const w = Math.max(2, x1 - x0);
          const kids = [{
            type: 'rect', transition: ['shape'],
            shape: { x: x0, y: yc - h / 2, width: w, height: h, r: 5 },
            style: { fill: d.color || T.m[0], stroke: T.elev, lineWidth: 1 }
          }];
          /* 名字/国旗的落位规则（用户 2026-11-01 指定）：
             ① 条内放得下「完整国旗 + 完整名字」→ 照旧画在条形左端内侧（白字）；
             ② 放不下（条形太短）→ 整块挪到「条形 + 条尾分数」的后方（正文色），不再截成半个字。
             两种模式的坐标由同一组元素的两个 x 表达，配合 transition:['style']，
             ECharts 会把 x 插值成一段横向滑动，跨越阈值不会瞬跳。 */
          const FONT = '600 11.5px "Segoe UI",system-ui,sans-serif';
          const uri = d.flag || flagUri(d.iso);
          const flagW = uri ? 20 : 0;
          const nameW = textW(d.name, FONT);
          const scoreTxt = val > 0 ? f2(val) : '';
          const inside = w >= 6 + flagW + nameW + 6;
          /* 条外模式：名称锚点用固定的 scoreColW（而不是本帧分数实测宽度），见上方说明 */
          const ax = inside ? (x0 + 6) : (x1 + 6 + scoreColW + 6);   /* 国旗左边缘 = 文本块锚点 */
          let tx = ax + flagW;
          if (uri) {
            /* 国旗不加白底片：仅给图片加一层轻微阴影（紧贴轮廓的深色描边 + 轻微投影），
               让国旗在同色色条上也能描出边缘、不被浸没。 */
            kids.push({ type: 'image', transition: ['style'], style: {
              image: uri, x: ax, y: yc - 5, width: 15, height: 11,
              shadowBlur: 1.2, shadowColor: 'rgba(0,0,0,0.7)', shadowOffsetX: 0, shadowOffsetY: 1
            } });
          }
          let txt = d.name;
          if (!inside) {
            /* 极端情况的安全阀：名字长到画布右边缘都装不下时，才按可用宽度补省略号 */
            const avail = Math.max(0, api.getWidth() - 6 - tx);
            if (nameW > avail) {
              const maxc = Math.max(1, Math.floor(avail / 7.2));
              txt = maxc > 1 ? txt.slice(0, maxc - 1) + '…' : txt.slice(0, maxc);
            }
          }
          if (txt) {
            kids.push({
              type: 'text', transition: ['style'], style: {
                text: txt, x: tx, y: yc, fill: inside ? '#fff' : T.text2,
                font: FONT,
                textVerticalAlign: 'middle', textBaseline: 'middle',
                shadowBlur: inside ? 2 : 0, shadowColor: 'rgba(0,0,0,0.55)', shadowOffsetX: 0, shadowOffsetY: 1
              }
            });
          }
          /* 条尾分数：随条形右端 x1 一起左右滑动，并与名次一起上下滑动。
             两位小数（与全站分数显示一致），右侧留白已同步加宽到 86。 */
          kids.push({
            type: 'text', transition: ['style'], style: {
              text: scoreTxt, x: x1 + 6, y: yc,
              fill: T.text2, font: FONT,
              textVerticalAlign: 'middle', textBaseline: 'middle'
            }
          });
          return { type: 'group', children: kids };
        },
        encode: { x: 0, y: 1 },
        data: data.map(function (d, i) {
          return {
            value: [round(d.value || 0), d.rank != null ? d.rank : (i + 1)],
            id: d.id, name: d.name, iso: d.iso, cname: d.cname || '', flag: d.flag, color: d.color,
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

  /* ---------- 泳道持有者配色：一人一色 + 相邻不同 ---------- */
  /* 以前泳道颜色取「持有者国籍色」，同国的两名选手前后接力时两段同色，
     视觉上像是一个人一直持有（用户 2026-11-01 明确要求改掉）。
     现在：
       · 基色 = 按 pid 稳定散列落到 60 档调色板（黄金角 137.508° 排色相 × 3 档明度），
         同一名选手在任何泳道、任何筛选下都是同一个颜色；
       · 再逐泳道按时间顺序走一遍，若本段与上一段（或下一段）撞同一档，
         就地换到下一个未占用的档位并写回色表，保证相邻两段永不撞色；
       · 色表每次调用重建，输入顺序固定（泳道序 + 时间序），结果可复现。 */
  const LANE_PAL_N = 60;
  let _lanePal = null;
  function hslHex(h, s, l) {
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    let r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; }
    else if (h < 120) { r = x; g = c; }
    else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; }
    else if (h < 300) { r = x; b = c; }
    else { r = c; b = x; }
    const f = function (v) {
      const n = Math.round((v + m) * 255);
      return ('0' + Math.max(0, Math.min(255, n)).toString(16)).slice(-2);
    };
    return '#' + f(r) + f(g) + f(b);
  }
  function lanePalette() {
    if (_lanePal) return _lanePal;
    const out = [];
    for (let k = 0; k < LANE_PAL_N; k++) {
      out.push(hslHex((k * 137.508) % 360, 0.62, [0.56, 0.48, 0.61][k % 3]));
    }
    _lanePal = out;
    return out;
  }
  /* 相对亮度（sRGB 线性化后按 Rec.709 加权）：用来决定这段色块上的姓名用白字还是深色字。
     只按颜色明暗选字色，就不必为了白字可读而把所有色块都压暗。 */
  function colorLum(hex) {
    let s = String(hex || '').replace('#', '');
    if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
    if (s.length !== 6) return 0.5;
    const ch = function (i) {
      const v = parseInt(s.substr(i, 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * ch(0) + 0.7152 * ch(2) + 0.0722 * ch(4);
  }
  /* FNV-1a：同一 pid 永远落到同一档，跟筛选 / 泳道顺序无关 */
  function holderHash(key) {
    let h = 2166136261;
    const s = String(key || '');
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  /* 两档颜色是否「看起来太像」：同色算像；同一明度档且色相相差 < 40° 也算像
     （不同明度档已经靠深浅拉开了，一定分得清）。 */
  function palClash(a, b) {
    if (a === b) return true;
    if (a % 3 !== b % 3) return false;
    const ha = (a * 137.508) % 360, hb = (b * 137.508) % 360;
    let d = Math.abs(ha - hb);
    if (d > 180) d = 360 - d;
    return d < 40;
  }
  /* 一人一色的求解：先按 pid 散列给每个选手一个基色，再在「相邻关系图」上做两轮贪心改色，
     把「和邻居撞色 / 太像」的选手挪到最近的空闲档位。这样同时满足两个约束：
       · 同一名选手在所有泳道里都是同一个颜色（色表按选手键保存，不是按段）；
       · 同一泳道内相邻两段（不同选手）颜色明显不同（最多 60 档，每人邻居数 ≤ 2，一定解得开）。
     输入顺序固定（泳道序 + 时间序），同样数据每次渲染结果完全一致。 */
  function laneSegColors(laneData) {
    const PAL = lanePalette();
    const keyOf = function (sg) { return String(sg.id || sg.holder || ''); };
    const idxOf = {};        /* 选手键 → 调色板档位 */
    const order = [];        /* 首次出现顺序（决定改色优先级，保证可复现） */
    const adj = {};          /* 选手键 → { 邻居键: 1 } */
    laneData.forEach(function (L) {
      for (let i = 0; i < L.segs.length; i++) {
        const k = keyOf(L.segs[i]);
        if (idxOf[k] == null) { idxOf[k] = holderHash(k) % PAL.length; order.push(k); }
        if (i > 0) {
          const a = keyOf(L.segs[i - 1]);
          if (a !== k) {
            (adj[a] = adj[a] || {})[k] = 1;
            (adj[k] = adj[k] || {})[a] = 1;
          }
        }
      }
    });
    for (let pass = 0; pass < 3; pass++) {
      let changed = 0;
      order.forEach(function (k) {
        const nb = adj[k];
        if (!nb) return;
        let clash = false;
        for (const n in nb) { if (palClash(idxOf[n], idxOf[k])) { clash = true; break; } }
        if (!clash) return;
        const from = idxOf[k];
        for (let d = 1; d < PAL.length; d++) {
          const cand = (from + d) % PAL.length;
          let ok = true;
          for (const n in nb) { if (palClash(idxOf[n], cand)) { ok = false; break; } }
          if (ok) { idxOf[k] = cand; changed++; return; }
        }
      });
      if (!changed) break;
    }
    return laneData.map(function (L) {
      return L.segs.map(function (sg) { return PAL[idxOf[keyOf(sg)] % PAL.length]; });
    });
  }

  /* 日期整数（YYYYMMDD）→ 小数年，口径与 etl/build.js 的 fyOfDn 完全一致
     （按当年实际天数 365/366 折算），保证段内刻度与段首尾落在同一条坐标上。 */
  function dnFy(dn) {
    const s = String(dn || '');
    if (s.length !== 8) return 0;
    const y = +s.slice(0, 4), mo = +s.slice(4, 6), d = +s.slice(6, 8);
    if (!(y > 1900) || mo < 1 || mo > 12 || d < 1 || d > 31) return y || 0;
    const dt = Date.UTC(y, mo - 1, d), y0 = Date.UTC(y, 0, 1);
    const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    return y + (dt - y0) / 86400000 / (leap ? 366 : 365);
  }

  function lanes(laneData, opts) {
    opts = opts || {};
    const T = pal();
    const y0 = opts.y0 || 2004, y1 = opts.y1 || 2026;
    const laneH = opts.laneH || 34;          /* 每条泳道的色块高度（可调大以容纳名字与国旗） */
    /* 筛选后一条泳道都不剩（例如「中国 + 平均」再叠一个没人拿过纪录的项目）时，
       不能返回一张空白画布 —— 直接给一句居中的兜底文案。 */
    if (!laneData.length) {
      return {
        backgroundColor: 'transparent',
        graphic: [{
          type: 'text', left: 'center', top: 'middle', silent: true,
          style: {
            text: opts.empty || '',
            fill: T.text3, font: '13px "Segoe UI",system-ui,sans-serif', textAlign: 'center'
          }
        }]
      };
    }
    const cats = laneData.map(function (L) { return L.label; });
    const data = [];
    const colorRows = laneSegColors(laneData);
    laneData.forEach(function (L, li) {
      L.segs.forEach(function (sg, si) {
        const laneColor = (colorRows[li] && colorRows[li][si]) || (sg.color || '#888');
        data.push({
          /* value[5] 是国旗用的国码：新数据直接给 ISO2；旧数据只有国名全称，退回旧字段 */
          value: [sg.from, li, sg.to, li, sg.holder, sg.iso || sg.country, sg.days, sg.fromDn || 0, sg.toDn || 0],
          pid: sg.id,
          /* 该段属于哪个项目（tooltip / 冒烟反查「这一段是不是也是世界纪录」都要用） */
          ev: L.ev,
          /* 合并段内每一次刷新的日期（同一个人连续破纪录时合并成一段，这里保留明细） */
          subs: sg.subs || null,
          /* 与 subs 同序：每一次刷新自己的纪录级别胶囊 {code,cls,name}（缺省 null） */
          slv: sg.slv || null,
          scopes: sg.scopes || null,
          /* 该段自己的纪录级别抬头（世界纪录 / 亚洲纪录 / 中国纪录 …），由调用方按
             「这一段是否也出现在更高级别的链里」反推；缺省时退回整体口径 opts.recLabel */
          lab: sg.lab || '',
          /* 同一级别的胶囊徽标 {code:'WR'|'AsR'|…, cls:'WR'|'CR'|'NR', name:'世界纪录'|…}
             —— tooltip 第一行用它渲染成彩色胶囊，配色与历史地位排名页共用 css */
          lv: sg.lv || null,
          itemStyle: { color: laneColor }
        });
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
      const segCol = api.visual('color') || '#888';
      const onDark = colorLum(segCol) < 0.34;
      const row = data[params.dataIndex] || {};
      /* 段内「刷了几次」的可视化（2026-11-01 第三轮：细竖线 + 角标用户完全看不出来）：
         把段按「每一次刷新」切成若干小格，**奇偶格交替压一层半透明遮罩**（一亮一暗），
         格与格之间再压一根高对比分隔线 —— 于是「这一段被刷了几次」直接数条纹就有了，
         不依赖文字，再窄的段也看得见；段尾另有「×N」角标给出确切次数（放得下才挂）。 */
      const subs = row.subs;
      const nRef = (subs && subs.length > 1) ? subs.length : 0;
      const bandTop = rect.y + 1.5;
      const bandH = Math.max(4, h - 3);
      if (nRef && w > 6) {
        /* 每次刷新的像素位置（段首 → 各次刷新 → 段尾），只保留真正落在段内的 */
        const xs = [rect.x];
        for (let i = 1; i < subs.length; i++) {
          const px = api.coord([dnFy(subs[i]), catIdx])[0];
          if (px > rect.x + 1.5 && px < rect.x + w - 1.5) xs.push(px);
        }
        xs.push(rect.x + w);
        const bandFill = onDark ? 'rgba(255,255,255,.18)' : 'rgba(0,0,0,.10)';
        for (let i = 1; i < xs.length - 1; i += 2) {
          const a = xs[i], b = xs[i + 1];
          if (b - a > 1.2) {
            kids.push({
              type: 'rect', silent: true,
              shape: { x: a, y: bandTop, width: b - a, height: bandH },
              style: { fill: bandFill }
            });
          }
        }
        if (xs.length > 2) {
          let d = '';
          for (let i = 1; i < xs.length - 1; i++) {
            const px = Math.round(xs[i]) + 0.5;
            d += 'M' + px + ' ' + bandTop + 'L' + px + ' ' + (bandTop + bandH);
          }
          kids.push({
            type: 'path', silent: true,
            shape: { path: d },
            style: { stroke: onDark ? 'rgba(255,255,255,.62)' : 'rgba(0,0,0,.38)', lineWidth: 1, fill: 'none' }
          });
        }
      }
      /* 段内只画姓名（用户 2026-11-01 要求：国旗只出现在 tooltip 里，泳道图上不再画国旗）；
         连续刷新多次的段在右端挂一枚「×N」角标，直接读出刷了几次。 */
      if (w > 22 && h >= 13) {
        const name = String(api.value(4) || '');
        const txtFill = onDark ? '#fff' : '#16202c';
        /* 角标：先量宽度，再决定给姓名留多少地方（角标永远贴在段尾）。
           ★ 门槛从 w > badgeW+34 放宽到 w >= badgeW+8 —— 默认视野下大多数段只有 40~60px 宽，
             旧门槛导致角标几乎从不出现，这才是「怎么都看不出来」的直接原因。 */
        const badgeLabel = nRef ? '×' + nRef : '';
        const badgeW = badgeLabel ? Math.round(textW(badgeLabel, '700 10px "Segoe UI",system-ui,sans-serif') + 10) : 0;
        const badgeH = Math.min(16, h - 4);
        const hasBadge = !!badgeLabel && badgeH >= 11 && w >= badgeW + 8;
        const x0t = rect.x + 6;
        const room = rect.x + w - x0t - 5 - (hasBadge ? badgeW + 4 : 0);
        const per = 6.4;
        let txt = name;
        const maxc = Math.max(0, Math.floor(room / per));
        if (txt.length > maxc) txt = maxc > 1 ? txt.slice(0, maxc - 1) + '…' : '';
        /* 空间只够角标时（room < 22）宁可不画名字，也别画成「F…」这种没有信息量的残字 */
        if (txt && room >= 22) {
          kids.push({
            type: 'text', style: {
              text: txt, x: x0t, y: rect.y + h / 2, fill: txtFill,
              font: '600 11.5px "Segoe UI",system-ui,sans-serif',
              textVerticalAlign: 'middle', textBaseline: 'middle',
              shadowBlur: onDark ? 2 : 0, shadowColor: 'rgba(0,0,0,0.55)', shadowOffsetX: 0, shadowOffsetY: 1
            }
          });
        }
        if (hasBadge) {
          /* 没有姓名时角标居中，视觉上像一枚「次数徽章」；有姓名时贴段尾 */
          const bx = (room >= 22) ? (rect.x + w - badgeW - 5) : (rect.x + (w - badgeW) / 2);
          kids.push({
            type: 'rect', silent: true,
            shape: { x: bx, y: rect.y + h / 2 - badgeH / 2, width: badgeW, height: badgeH, r: badgeH / 2 },
            style: { fill: onDark ? 'rgba(0,0,0,.34)' : 'rgba(255,255,255,.66)' }
          });
          kids.push({
            type: 'text', silent: true, style: {
              text: badgeLabel, x: bx + badgeW / 2, y: rect.y + h / 2, fill: txtFill,
              font: '700 10px "Segoe UI",system-ui,sans-serif',
              textAlign: 'center', textVerticalAlign: 'middle', textBaseline: 'middle'
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

    /* x 轴刻度：缩放后 min/max 是小数年（例如 2004.6473），直接拿去做刻度会得到
       「2004.6473257698542」这种无法阅读的标签。这里先把窗口按跨度对齐到 1 / 0.5 / 0.25 年的格子，
       再挑一个「约 8~10 格」的间隔，刻度就总是 2004 / 2006 / … 或 2010.5 / 2011 / … 这类整齐的值。 */
    const span = Math.max(0.2, y1 - y0);
    const snap = span >= 6 ? 1 : (span >= 2 ? 0.5 : 0.25);
    const axMin = Math.floor(y0 / snap + 1e-9) * snap;
    const axMax = Math.ceil(y1 / snap - 1e-9) * snap;
    const axSpan = axMax - axMin;
    const STEPS = (snap >= 1) ? [1, 2, 3, 5, 10, 20, 25, 50] : [0.25, 0.5, 1, 2, 5, 10];
    let axStep = STEPS[STEPS.length - 1];
    for (let i = 0; i < STEPS.length; i++) { if (axSpan / STEPS[i] <= 10) { axStep = STEPS[i]; break; } }
    function fmtYear(v) {
      const r = Math.round(v);
      if (Math.abs(v - r) < 1e-6) return String(r);
      return String(Math.round(v * 10) / 10);
    }

    return Object.assign(base({ stagger: 8 }), {
      grid: { left: 6, right: 16, top: 30, bottom: 6, containLabel: true },
      /* 两条口径完全相同的 xAxis 共用同一 grid：index 0 在底部（数据轴，泳道色块按它定位），
         index 1 在顶部（position:'top'），仅作镜像显示，让上方也有一条与下方一致的时间刻度。
         系列默认用 xAxisIndex 0，顶部轴纯展示，不影响色块坐标。 */
      xAxis: [
        Object.assign({ type: 'value', min: axMin, max: axMax, interval: axStep }, axisCommon(), {
          axisLabel: { color: T.text3, fontSize: 10.5, formatter: fmtYear },
          splitLine: { show: false }
        }),
        Object.assign({ type: 'value', min: axMin, max: axMax, interval: axStep, position: 'top', gridIndex: 0 }, axisCommon(), {
          axisLabel: { color: T.text3, fontSize: 10.5, formatter: fmtYear },
          axisLine: { show: true, lineStyle: { color: T.border, width: 1 } },
          axisTick: { show: false },
          splitLine: { show: false }
        })
      ],
      yAxis: Object.assign({ type: 'category', data: cats, inverse: true }, axisCommon(), {
        splitLine: { show: false },
        axisLabel: {
          color: T.text2, fontSize: 13,
          formatter: function (v, i) { return rich['ic' + i] ? '{ic' + i + '|}{nm|' + v + '}' : '{nm|' + v + '}'; },
          rich: rich
        }
      }),
      tooltip: {
        /* ★ 2026-11-01 去掉 confine：
           confine:true 会把弹窗强行关在图表矩形内，于是「贴着图表顶边的项目条」
           弹出的框只能压在光标下面，鼠标正好挡住内容。改为不限制边界，统一走 tipPos：
             · 默认放在光标正上方（水平居中）；
             · 上方放不下才翻到光标下方，且始终留出 18px 让开鼠标；
             · 左右 / 底部越出视口时再收进来。 */
        confine: false, backgroundColor: T.elev, borderColor: T.border, borderWidth: 1,
        textStyle: { color: T.text, fontSize: 12 },
        position: tipPos,
        /* 跟随鼠标：把姓名 + 国旗 + 起止时间 + 持有天数直接显示在光标旁，
           取代原先图表下方那份冗长的持有者清单。
           2026-11-01 起再补两段：
             · 纪录类型（世界 / 亚洲 / 中国 …，由调用方传 opts.recLabel）；
             · 段内刷新明细 —— 同一个人连续破纪录时色块是合并的，这里把每一次的日期列出来。
           刷新日期用「小胶囊 + 三列栅格」排布（原来是一串「A · B · C …」长文本，
           次数一多就会顶出弹窗；后来改成最多 9 枚 + 「+N」，用户要求**全部列出**，
           所以现在不做截断，靠固定列宽的栅格保证对齐、整齐。 */
        extraCssText: 'box-shadow:0 6px 20px rgba(0,0,0,.14);border-radius:10px;max-width:312px;pointer-events:none;',
        formatter: function (p) {
          const v = p.data.value;
          const days = v[6] || 0;
          const iso = String(v[5] || '').toUpperCase();
          function fd(dn) { const s = String(dn || ''); return s.length === 8 ? s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8) : (LANE_I18N.now || '至今'); }
          const flagTag = iso ? '<img src="' + flagUri(iso) + '" style="width:15px;height:11px;vertical-align:-1px;margin-right:4px" alt="">' : '';
          /* 抬头：优先用这一段自己的级别（数据里同一份成绩会同时进 WR / 洲 / 国家三条链，
             所以「筛选亚洲」时也可能有真正的世界纪录段），没有才退回整体口径。
             2026-11-02 起抬头改为**胶囊徽标**（WR / AsR / OcR / NR …，加全称），
             外观与配色跟「历史地位」排名页选手卡里的 WR / CR / NR 胶囊完全共用
             .rec-chip.lv-* 这一套 css：WR 红 / 洲纪录橙 / NR 绿。
             缺 lv（旧数据包 / 其他调用方）时退回原来的纯文字抬头。 */
          const lv = (p.data && p.data.lv) || null;
          const labTxt = (p.data && p.data.lab) || opts.recLabel;
          const recTag = lv
            ? '<div style="margin-bottom:3px"><span class="rec-chip lv-' + (lv.cls || '') + '">' +
              '<b>' + esc(lv.code) + '</b><i>' + esc(lv.name) + '</i></span></div>'
            : (labTxt ? '<div style="font-size:11px;opacity:.7;margin-bottom:2px">' + esc(labTxt) + '</div>' : '');
          let h = recTag + '<div style="display:flex;align-items:center;gap:2px">' + flagTag + '<b>' + esc(v[4]) + '</b></div>' +
            '<div style="margin-top:3px;font-size:11.5px;opacity:.85">' + fd(v[7]) + ' → ' + fd(v[8]) + '</div>' +
            '<div style="margin-top:2px;font-size:11.5px"><b>' + days + '</b> ' + (LANE_I18N.day || '天') + '</div>';
          const subs = p.data.subs;
          const slv = p.data.slv;
          if (subs && subs.length > 1) {
            /* 逐条标「与抬头不同级」的刷新（2026-11-02 用户要求）：
               合并段以 WR 开场、后来 WR 被别人拿走，他之后推进的只是洲纪录 —— 抬头写 WR，
               这一串日期里却混着 AsR。这里给级别不等于抬头的日期挂一枚小胶囊（WR/AsR/NR…），
               与抬头同级的日期保持原样（留空＝就是抬头那个级别），干扰最小、信息最全。
               出现小胶囊时栅格从 3 列降为 2 列，保证「日期 + 胶囊」不被裁掉。 */
            let chips = '', tagged = 0;
            for (let i = 0; i < subs.length; i++) {
              const b = slv && slv[i];
              const diff = !!(b && lv && b.code !== lv.code);
              if (diff) tagged++;
              chips += '<i>' + fd(subs[i]) +
                (diff ? '<em class="tl-tip-lv lv-' + (b.cls || '') + '">' + esc(b.code) + '</em>' : '') + '</i>';
            }
            h += '<div class="tl-tip-sub">' +
              '<div class="tl-tip-sub-h">' + (LANE_I18N.refresh || '刷新') + ' ' + subs.length + ' ' + (LANE_I18N.times || '次') + '</div>' +
              '<div class="tl-tip-chips' + (tagged ? ' has-lv' : '') + '">' + chips + '</div></div>';
          }
          /* 点击色块可跳转选手主页 —— 在弹窗底部提示一句，避免只能靠猜 */
          if (LANE_I18N.click) {
            h += '<div style="margin-top:6px;font-size:10.5px;opacity:.55">' + esc(LANE_I18N.click) + '</div>';
          }
          return h;
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

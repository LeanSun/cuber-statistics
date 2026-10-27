/* ============================================================
   icons.js — 内联 SVG 图标（离线可用，无外部依赖）
   event(id): 参照 cubing.com / WCA 风格的极简线描图标
   glyph(name):  界面功能图标
   usage:  Icons.event('333')  /  Icons.glyph('trophy')
   ============================================================ */
(function () {
  const S = function (inner, extra) {
    return '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true" focusable="false"' + (extra || '') + '>' + inner + '</svg>';
  };

  /* 三阶立方体：等距立方体轮廓 + 正面网格 */
  function cube3(o) {
    o = o || {};
    const s = o.size || 16, x = o.x || 4, y = o.y || 5;
    const dx = s * 0.17, dy = s * 0.17, k = s / 3;
    const A = x + ',' + y, B = (x + s) + ',' + y, C = (x + s) + ',' + (y + s), D = x + ',' + (y + s);
    const F = (x + s + dx) + ',' + (y - dy), G = (x + s + dx) + ',' + (y + s - dy), H = (x + dx) + ',' + (y + s - dy);
    let g = '<g fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round">';
    g += '<path d="M' + A + 'L' + B + 'L' + C + 'L' + D + 'Z"/>';
    g += '<path d="M' + B + 'L' + F + 'L' + G + 'L' + C + 'Z"/>';
    g += '<path d="M' + D + 'L' + H + 'L' + G + 'L' + C + 'Z"/>';
    for (let i = 1; i < 3; i++) {
      const gx = x + k * i; g += '<path d="M' + gx + ' ' + y + 'L' + gx + ' ' + (y + s) + '" opacity=".5"/>';
      const gy = y + k * i; g += '<path d="M' + x + ' ' + gy + 'L' + (x + s) + ' ' + gy + '" opacity=".5"/>';
    }
    g += '</g>';
    return g;
  }
  /* 通用 N×N 网格（高阶立方体 / 多盲） */
  function gridBox(n, x, y, size) {
    const k = size / n;
    let g = '<g fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round">';
    g += '<rect x="' + x + '" y="' + y + '" width="' + size + '" height="' + size + '" rx="1.5"/>';
    for (let i = 1; i < n; i++) {
      const gx = x + k * i; g += '<path d="M' + gx + ' ' + y + 'L' + gx + ' ' + (y + size) + '" opacity=".5"/>';
      const gy = y + k * i; g += '<path d="M' + x + ' ' + gy + 'L' + (x + size) + ' ' + gy + '" opacity=".5"/>';
    }
    g += '</g>';
    return g;
  }

  /* ---------- 项目图标 ---------- */
  const EVENTS = {
    '333': function () { return S(cube3({ size: 16, x: 4, y: 5 })); },
    '222': function () { return S(gridBox(2, 6.5, 7.5, 11)); },
    '444': function () { return S(gridBox(4, 4, 4, 16)); },
    '555': function () { return S(gridBox(5, 3.4, 3.4, 17.2)); },
    '666': function () { return S(gridBox(6, 3, 3, 18)); },
    '777': function () { return S(gridBox(7, 2.6, 2.6, 18.8)); },
    '333oh': function () {
      return S(cube3({ size: 12, x: 3.6, y: 9 }) +
        '<path d="M9.6 8.2c.6-2.4 1.4-3.7 2.7-3.7 1.3 0 1.8 1.1 1.8 2.6 0 1.7-.7 2.7-1.8 2.7-.7 0-1.1-.3-1.3-.9" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>');
    },
    '333bf': function () {
      return S(cube3({ size: 16, x: 4, y: 4 }) +
        '<rect x="2.2" y="8" width="19.6" height="4.6" rx="2.3" fill="none" stroke="currentColor" stroke-width="1.5"/>' +
        '<path d="M6 10.3h3.6M14.4 10.3h3.6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" opacity=".55"/>');
    },
    '444bf': function () {
      return S(gridBox(4, 3.5, 3.5, 17) +
        '<rect x="2" y="8" width="20" height="4.6" rx="2.3" fill="none" stroke="currentColor" stroke-width="1.5"/>');
    },
    '555bf': function () {
      return S(gridBox(5, 3.2, 3.2, 17.6) +
        '<rect x="2" y="8" width="20" height="4.6" rx="2.3" fill="none" stroke="currentColor" stroke-width="1.5"/>');
    },
    '333mbf': function () {
      return S('<g fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round">' +
        gridBox(3, 1.6, 7.4, 8.2) + gridBox(3, 11.2, 2.6, 8.2) + gridBox(3, 13.4, 12.4, 8.2) + '</g>');
    },
    '333fm': function () {
      return S('<circle cx="12" cy="12" r="8.8" fill="none" stroke="currentColor" stroke-width="1.5"/>' +
        '<path d="M12 7V12l3.4 2.1" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>' +
        '<path d="M6 5.8l2 2M18 5.8l-2 2M6 18.2l2-2M18 18.2l-2-2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" opacity=".55"/>');
    },
    'clock': function () {
      return S('<rect x="3.6" y="3.6" width="16.8" height="16.8" rx="3" fill="none" stroke="currentColor" stroke-width="1.5"/>' +
        '<circle cx="12" cy="12" r="1.8" fill="currentColor"/>' +
        '<path d="M12 8V12l2.6 1.9M17.6 9.8h2.4M17.6 14.2h2.4M3.8 9.8h2.4M3.8 14.2h2.4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" fill="none"/>');
    },
    'minx': function () {
      return S('<path d="M12 3.2l8.2 6-3.2 9.8H7L3.8 9.2z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>' +
        '<path d="M12 3.2v16M3.8 9.2l16 .2M7 19l9.6-9.6M16 19L7 9.4" stroke="currentColor" stroke-width="1" opacity=".5" stroke-linejoin="round"/>');
    },
    'pyram': function () {
      return S('<path d="M12 3.4l9 14.8H3z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>' +
        '<path d="M12 3.4v14.8M3 18.2l9-6.4 9 6.4M6.6 10.9 9.8 0" stroke="currentColor" stroke-width="1" opacity=".5" stroke-linejoin="round"/>');
    },
    'skewb': function () {
      return S('<path d="M12 3.2l9 6.3v5.3L12 21 3 14.8V9.5z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>' +
        '<path d="M12 3.2v18.3M3 9.5l9 2.7 9-2.7M12 12.2 3 14.8M12 12.2 21 14.8" stroke="currentColor" stroke-width="1.1" opacity=".55" stroke-linejoin="round"/>');
    },
    'sq1': function () {
      return S('<path d="M4.6 7.2c0-2.1 3.4-3.5 7.4-3.5s7.4 1.4 7.4 3.5v9.6c0 2.1-3.4 3.5-7.4 3.5s-7.4-1.4-7.4-3.5z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>' +
        '<path d="M4.6 12h14.8" stroke="currentColor" stroke-width="1.4"/>' +
        '<path d="M8 4.2v15.6M16 4.2v15.6" stroke="currentColor" stroke-width="1" opacity=".5"/>');
    },
    /* 八面体 / Octahedron (FTO)：WCA 官方导出暂无此项目数据，这里仅提供与其它项目
       同风格的图标，避免「项目领域」等图表里 FTO 落到通用方格占位符显得像渲染错误。 */
    /* 八面体 FTO 已改用官方图标字体 unofficial-fto（见 CUBING_UNOFFICIAL），此处不再手绘 */
    '333ft': function () {
      return S('<rect x="8.5" y="6.5" width="7" height="7" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.5"/>' +
        '<path d="M12 3.5v3M12 13.5v3M5.5 10h3M15.5 10h3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>' +
        '<path d="M9.5 8.5h5M8.5 10v4M15.5 10v4M9.5 12h5" stroke="currentColor" stroke-width="1" opacity=".5"/>');
    },
    'magic': function () {
      return S('<rect x="3" y="7.6" width="18" height="8.8" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.5"/>' +
        '<path d="M9 7.6v8.8M15 7.6v8.8" stroke="currentColor" stroke-width="1.3"/>' +
        '<path d="M3 12h18" stroke="currentColor" stroke-width="1" opacity=".4"/>');
    },
    'mmagic': function () {
      return S('<rect x="2.6" y="7.6" width="18.8" height="8.8" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.5"/>' +
        '<path d="M7.5 7.6v8.8M12 7.6v8.8M16.5 7.6v8.8" stroke="currentColor" stroke-width="1.2"/>' +
        '<path d="M2.6 12h18.8" stroke="currentColor" stroke-width="1" opacity=".4"/>');
    },
    /* 旧多盲（已停办）：三阶多盲 + 虚线表示旧式规则 */
    '333mbo': function () {
      return S('<g fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round" stroke-dasharray="2.6 1.8">' +
        gridBox(3, 1.6, 7.4, 8.2) + gridBox(3, 11.2, 2.6, 8.2) + gridBox(3, 13.4, 12.4, 8.2) + '</g>');
    }
  };

  /* ---------- 界面图标 ---------- */
  const GLYPH = {
    trophy: '<path d="M7 4h10v3a5 5 0 01-10 0V4zM5 5h2v2a3 3 0 01-2-2zm14 0h-2v2a3 3 0 002-2zM12 12v4m-3 4h6m-4 0h2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
    blind: '<path d="M3 9h18v4a4 4 0 01-4 4H7a4 4 0 01-4-4V9zm4 1.6h3M14 10.6h3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
    speed: '<path d="M13 3L5 14h6l-1 7 8-11h-6l1-7z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>',
    king: '<path d="M5 17h14M6.5 17l1-9 4.5 3.6L16.5 8l1 9" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><circle cx="12" cy="4.4" r="1.4" fill="currentColor"/>',
    flag: '<path d="M6 21V4m0 0h11l-2 3.6L17 11H6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
    timeline: '<path d="M4 6h10M4 12h16M4 18h7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none"/><circle cx="16" cy="6" r="2" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="13" cy="18" r="2" fill="none" stroke="currentColor" stroke-width="1.5"/>',
    book: '<path d="M4 5.5A2 2 0 016 4h5v16H6a2 2 0 01-2-1.5V5.5zM20 5.5A2 2 0 0018 4h-5v16h5a2 2 0 002-1.5V5.5z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>',
    pk: '<path d="M8 5v14M16 5v14M8 9h8M8 15h8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none"/><circle cx="6" cy="7" r="2" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="18" cy="17" r="2" fill="none" stroke="currentColor" stroke-width="1.5"/>',
    medal: '<circle cx="12" cy="14.5" r="5.2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M9 9.6L7 3h10l-2 6.6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>',
    record: '<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="12" cy="12" r="3.2" fill="currentColor"/>',
    calendar: '<rect x="4" y="5.5" width="16" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M4 10h16M8.5 3.5v3M15.5 3.5v3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
    lab: '<path d="M10 3v6.2L5.4 18a1.6 1.6 0 001.4 2.4h10.4a1.6 1.6 0 001.4-2.4L14 9.2V3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M9 3h6M7.6 14h8.8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
    globe: '<circle cx="12" cy="12" r="8.4" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M3.6 12h16.8M12 3.6c2.4 2.3 3.6 5.2 3.6 8.4s-1.2 6.1-3.6 8.4c-2.4-2.3-3.6-5.2-3.6-8.4S9.6 5.9 12 3.6z" fill="none" stroke="currentColor" stroke-width="1.3"/>',
    star: '<path d="M12 3.8l2.5 5.2 5.5.8-4 3.9 1 5.6-5-2.7-5 2.7 1-5.6-4-3.9 5.5-.8z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>',
    search: '<circle cx="11" cy="11" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M15.6 15.6L20 20" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
    sliders: '<path d="M4 7h10M18 7h2M4 12h4M12 12h8M4 17h12M20 17h0" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="16" cy="7" r="2" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="10" cy="12" r="2" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="18" cy="17" r="2" fill="none" stroke="currentColor" stroke-width="1.5"/>',
    arrow: '<path d="M5 12h13m-5-5l5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
    external: '<path d="M14 4h6v6m0-6l-8 8M18 14v4a2 2 0 01-2 2H6a2 2 0 01-2-2V8a2 2 0 012-2h4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
    plus: '<path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
    info: '<circle cx="12" cy="12" r="8.4" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M12 11v5.4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="12" cy="7.9" r="1" fill="currentColor"/>'
  };

  /* 官方 cubing.net 图标字体覆盖的事件（其余回退内联 SVG）。
     字体与 CSS 已本地化到 vendor/cubing-icons.*，包含 event-333mbo（旧多盲）。
     unofficial-* 是官方字体里的「非 WCA 项目」图标集，八面体 FTO 对应 unofficial-fto
     （来源 https://icons.cubing.net/ —— 用户指定用它，而不是手绘 SVG）。 */
  const CUBING = {
    '222': 1, '333': 1, '333bf': 1, '333fm': 1, '333ft': 1, '333mbf': 1, '333mbo': 1, '333oh': 1,
    '444': 1, '444bf': 1, '555': 1, '555bf': 1, '666': 1, '777': 1,
    'clock': 1, 'magic': 1, 'minx': 1, 'mmagic': 1, 'pyram': 1, 'skewb': 1, 'sq1': 1
  };
  /* 非 WCA 项目：直接吃官方字体的 unofficial-* 字形 */
  const CUBING_UNOFFICIAL = { fto: 'unofficial-fto' };
  function eventIcon(id, cls) {
    if (CUBING_UNOFFICIAL[id]) {
      return '<span class="cubing-icon ' + CUBING_UNOFFICIAL[id] + ' ev-ic ' + (cls || '') + '" aria-hidden="true"></span>';
    }
    if (CUBING[id]) {
      return '<span class="cubing-icon event-' + id + ' ev-ic ' + (cls || '') + '" aria-hidden="true"></span>';
    }
    const f = EVENTS[id];
    if (f) return f().replace('class="ic"', 'class="ic ev-ic ' + (cls || '') + '"');
    return S('<g fill="currentColor">' + gridBox(3, 4, 4, 16) + '</g>').replace('class="ic"', 'class="ic ev-ic ' + (cls || '') + '"');
  }
  function glyph(name, cls) {
    const g = GLYPH[name] || GLYPH.info;
    return S('<g>' + g + '</g>').replace('class="ic"', 'class="ic gl-ic ' + (cls || '') + '"');
  }

  window.Icons = { event: eventIcon, glyph: glyph, has: function (n) { return !!GLYPH[n]; } };
})();

/* ============================================================
   icons.js — 内联 SVG 图标（离线可用，无外部依赖）
   cubeIcon(id): WCA 官方项目图标风格
   glyph(name):  界面功能图标
   usage:  Icons.event('333')  /  Icons.glyph('trophy')
   ============================================================ */
(function () {
  const S = function (inner, extra) {
    return '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true" focusable="false"' + (extra || '') + '>' + inner + '</svg>';
  };
  const R = function (x, y, w, h, r, op) {
    return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="' + (r == null ? 1.1 : r) + '"' + (op != null ? ' opacity="' + op + '"' : '') + '/>';
  };

  function grid(o) {
    // o: {n:每边格数, x,y,size, gap, r}
    const n = o.n, x0 = o.x, y0 = o.y, size = o.size, gap = o.gap == null ? 0.55 : o.gap, r = o.r == null ? 1 : o.r;
    const cell = (size - gap * (n - 1)) / n;
    let s = '';
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        s += R(x0 + i * (cell + gap), y0 + j * (cell + gap), cell, cell, r);
      }
    }
    return s;
  }

  /* ---------- 项目图标 ---------- */
  const EVENTS = {
    '333': function () { return S('<g fill="currentColor">' + grid({ n: 3, x: 4, y: 4, size: 16 }) + '</g>'); },
    '222': function () { return S('<g fill="currentColor">' + grid({ n: 2, x: 4.5, y: 4.5, size: 15, gap: 1.2, r: 1.6 }) + '</g>'); },
    '444': function () { return S('<g fill="currentColor">' + grid({ n: 4, x: 3.5, y: 3.5, size: 17, gap: 0.5, r: 0.8 }) + '</g>'); },
    '555': function () { return S('<g fill="currentColor">' + grid({ n: 5, x: 3.2, y: 3.2, size: 17.6, gap: 0.45, r: 0.7 }) + '</g>'); },
    '666': function () { return S('<g fill="currentColor">' + grid({ n: 6, x: 3, y: 3, size: 18, gap: 0.4, r: 0.6 }) + '</g>'); },
    '777': function () { return S('<g fill="currentColor">' + grid({ n: 7, x: 2.8, y: 2.8, size: 18.4, gap: 0.36, r: 0.5 }) + '</g>'); },
    '333oh': function () {
      return S('<g fill="currentColor">' + grid({ n: 3, x: 3, y: 8.2, size: 12.4, gap: 0.5, r: 0.9, }) + '</g>' +
        '<path d="M9.4 7.4c.5-2.3 1.3-3.6 2.6-3.6 1.2 0 1.7 1 1.7 2.4 0 1.5-.6 2.4-1.6 2.4-.6 0-1-.3-1.2-.8" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>');
    },
    '333bf': function () {
      return S('<g fill="currentColor">' + grid({ n: 3, x: 4, y: 4, size: 16, gap: 0.55, r: 1.1 }) + '</g>' +
        '<rect x="2.4" y="8.1" width="19.2" height="4.4" rx="2.2" fill="var(--bg-elev,#fff)"/>' +
        '<rect x="2.4" y="8.1" width="19.2" height="4.4" rx="2.2" fill="none" stroke="currentColor" stroke-width="1.4"/>' +
        '<path d="M6.2 10.3h4M13.8 10.3h4" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" opacity=".55"/>');
    },
    '444bf': function () {
      return S('<g fill="currentColor">' + grid({ n: 4, x: 3.5, y: 3.5, size: 17, gap: 0.5, r: 0.8 }) + '</g>' +
        '<rect x="2" y="8.1" width="20" height="4.4" rx="2.2" fill="var(--bg-elev,#fff)"/>' +
        '<rect x="2" y="8.1" width="20" height="4.4" rx="2.2" fill="none" stroke="currentColor" stroke-width="1.4"/>');
    },
    '555bf': function () {
      return S('<g fill="currentColor">' + grid({ n: 5, x: 3.2, y: 3.2, size: 17.6, gap: 0.45, r: 0.7 }) + '</g>' +
        '<rect x="2" y="8.1" width="20" height="4.4" rx="2.2" fill="var(--bg-elev,#fff)"/>' +
        '<rect x="2" y="8.1" width="20" height="4.4" rx="2.2" fill="none" stroke="currentColor" stroke-width="1.4"/>');
    },
    '333mbf': function () {
      return S('<g fill="currentColor">' +
        grid({ n: 3, x: 1.6, y: 7, size: 8.2, gap: 0.4, r: 0.6 }) +
        grid({ n: 3, x: 11.6, y: 2.4, size: 8.2, gap: 0.4, r: 0.6 }) +
        grid({ n: 3, x: 13.6, y: 12.4, size: 8.2, gap: 0.4, r: 0.6 }) +
        '</g>');
    },
    '333fm': function () {
      return S('<circle cx="12" cy="12" r="8.6" fill="none" stroke="currentColor" stroke-width="1.5"/>' +
        '<path d="M12 7.2V12l3.4 2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>' +
        '<path d="M5.6 5.6l2 2M18.4 5.6l-2 2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>');
    },
    'clock': function () {
      return S('<rect x="4" y="4" width="16" height="16" rx="3" fill="none" stroke="currentColor" stroke-width="1.5"/>' +
        '<circle cx="12" cy="12" r="1.7" fill="currentColor"/>' +
        '<path d="M12 8.2V12l2.6 1.8M17.4 9.6h2.2M17.4 14.4h2.2M4.4 9.6h2.2M4.4 14.4h2.2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" fill="none"/>');
    },
    'minx': function () {
      return S('<path d="M12 3.4l8 5.9-3.1 9.5H7.1L4 9.3z" fill="none" stroke="currentColor" stroke-width="1.5"/>' +
        '<path d="M12 3.4v16M4 9.3l16 .1M7.1 18.8l9.8-9.4M16.9 18.8L7.1 9.4" stroke="currentColor" stroke-width="1" opacity=".55"/>');
    },
    'pyram': function () {
      return S('<path d="M12 3.6l9 14.8H3z" fill="none" stroke="currentColor" stroke-width="1.5"/>' +
        '<path d="M12 3.6v14.8M3 18.4l9-6.4 9 6.4" stroke="currentColor" stroke-width="1" opacity=".55"/>');
    },
    'skewb': function () {
      return S('<path d="M12 3.4l9 6.2v5.4L12 20.6 3.2 15V9.6z" fill="none" stroke="currentColor" stroke-width="1.5"/>' +
        '<path d="M3.2 9.6L12 12l8.8-2.4M12 12v8.6" stroke="currentColor" stroke-width="1.1" opacity=".6"/>');
    },
    'sq1': function () {
      return S('<path d="M4.6 7.4c0-2 3.3-3.4 7.4-3.4s7.4 1.4 7.4 3.4v9.2c0 2-3.3 3.4-7.4 3.4s-7.4-1.4-7.4-3.4z" fill="none" stroke="currentColor" stroke-width="1.5"/>' +
        '<path d="M4.6 12h14.8" stroke="currentColor" stroke-width="1.4"/>' +
        '<path d="M8 4.4v15.2M16 4.4v15.2" stroke="currentColor" stroke-width="1" opacity=".5"/>');
    },
    '333ft': function () {
      return S('<path d="M9.2 4.2c1.4 0 2.6.5 3.4 1.6.6.8.9 1.9.9 3.1 0 1.3-.3 2.4-.9 3.3-.5.7-1.2 1.2-2.1 1.5.4 1 .9 1.7 1.5 2.2.9.8 1.3 1.7 1.3 2.9 0 2.4-1.8 4-4.2 4-2.5 0-4.3-1.6-4.3-4 0-1.2.4-2.1 1.3-2.9.6-.5 1.1-1.2 1.5-2.2-.9-.3-1.6-.8-2.1-1.5-.6-.9-.9-2-.9-3.3 0-1.2.3-2.3.9-3.1.8-1.1 2-1.6 3.4-1.6z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>');
    },
    'magic': function () {
      return S('<rect x="3" y="7.4" width="18" height="9.2" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.5"/>' +
        '<path d="M9 7.4v9.2M15 7.4v9.2" stroke="currentColor" stroke-width="1.3"/>' +
        '<path d="M3 12h18" stroke="currentColor" stroke-width="1" opacity=".45"/>');
    },
    'mmagic': function () {
      return S('<rect x="2.6" y="7.4" width="18.8" height="9.2" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.5"/>' +
        '<path d="M7.5 7.4v9.2M12 7.4v9.2M16.5 7.4v9.2" stroke="currentColor" stroke-width="1.2"/>' +
        '<path d="M2.6 12h18.8" stroke="currentColor" stroke-width="1" opacity=".45"/>');
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

  function eventIcon(id, cls) {
    const f = EVENTS[id];
    if (f) return f().replace('class="ic"', 'class="ic ev-ic ' + (cls || '') + '"');
    return S('<g fill="currentColor">' + grid({ n: 3, x: 4, y: 4, size: 16 }) + '</g>').replace('class="ic"', 'class="ic ev-ic ' + (cls || '') + '"');
  }
  function glyph(name, cls) {
    const g = GLYPH[name] || GLYPH.info;
    return S('<g>' + g + '</g>').replace('class="ic"', 'class="ic gl-ic ' + (cls || '') + '"');
  }

  window.Icons = { event: eventIcon, glyph: glyph, has: function (n) { return !!GLYPH[n]; } };
})();

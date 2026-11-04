/* ============================================================
   pages-kinch.js — Kinch 全能榜（2026-11-04）
   ─────────────────────────────────────────────────────────────────
   参考 wca.cuber.pro 的「17 项目 × Overall 平均」表格，补上它没有的三件事：
     ① 单次 / 平均 **分别成榜**（另有「综合」＝官方选轨，对齐参考站与本站 M5）
     ② **逐项目**独立成列、可点表头排序 / 点图标只看该项目
     ③ 站点顶部的**性别 / 地区**筛选在本榜实时生效（数据包自带 iso2+gender）

   数据源：etl/score/kinch_data.tsvz（由 etl/score/kinch_table.js 从 WCA 导出生成）
   —— 自包含全量 29.8 万选手，不依赖 data.js 的 slim 名单，懒加载、首屏零成本。

   公式：k = min(100, 100 × WR_{ev,track} / PB_{ev,track})，Overall = 17 项算术平均（缺项记 0）。
   综合口径选轨（与 kinchranking / m5_current_rank.js 同）：
     333mbf / 444bf / 555bf → single；333bf / 333fm → 两轨取较优；其余 → average。
   ============================================================ */
(function () {
  const t = window.I18N, U = window.U, M = window.MOCK, Ic = window.Icons;
  const P = window.P || (window.P = {});
  const esc = U.esc;
  const flag = P.util.flag, countryName = P.util.countryName, contName = P.util.contName;

  const DATA_URL = 'etl/score/kinch_data.tsvz';   /* 不带 ?v= —— 加 query 会被 CDN 回 204 空包 */
  const SINGLE_ONLY = { '333mbf': 1, '444bf': 1, '555bf': 1 };
  const BEST_OF = { '333bf': 1, '333fm': 1 };
  const N_EV = 17;
  const PER = 20, CAP = 1000;

  let ST = 0;          /* 0 未开始 / 1 加载中 / 2 就绪 / -1 失败 */
  let K = null;        /* {evs, wr, rows} */
  let KNOWN = null;    /* data.js 里可点进站内主页的 pid 集合 */

  function parse(txt) {
    const lines = txt.split('\n');
    const head = lines[0].split('\t');
    const evs = head[2] ? head[2].split(',') : [];
    const wr = head[3] ? head[3].split(',') : [];
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const ln = lines[i];
      if (!ln) continue;
      const c = ln.split('\t');
      if (c.length < 5) continue;
      const cells = new Int16Array(N_EV * 2);
      const parts = c[4].split(',');
      for (let j = 0; j < parts.length; j++) {
        const kv = parts[j].split(':');
        if (kv.length !== 2) continue;
        const idx = +kv[0], v = +kv[1];
        if (idx >= 0 && idx < cells.length && v > 0) cells[idx] = v;
      }
      /* 预计算三种轨道的总分（单位 = k×100 的 17 项和），排序时直接读，避免每帧 5M 次运算 */
      let sS = 0, sA = 0, sB = 0;
      for (let e = 0; e < N_EV; e++) {
        const a = cells[e * 2], b = cells[e * 2 + 1], ev = evs[e];
        sS += a; sA += b;
        sB += SINGLE_ONLY[ev] ? a : BEST_OF[ev] ? (a > b ? a : b) : b;
      }
      rows.push({ pid: c[0], name: c[1], iso: c[2], g: c[3], c: cells, sS: sS, sA: sA, sB: sB });
    }
    return { evs: evs, wr: wr, rows: rows };
  }

  function ensure() {
    if (ST !== 0) return;
    if (typeof fetch !== 'function' || typeof DecompressionStream === 'undefined') { ST = -1; return; }
    ST = 1;
    fetch(DATA_URL)
      .then(function (r) { if (!r.ok || r.status === 204) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
      .then(function (buf) {
        const u8 = new Uint8Array(buf);
        if (u8[0] === 0x1f && u8[1] === 0x8b) {
          const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
          return new Response(stream).text();
        }
        return new Response(buf).text();
      })
      .then(function (txt) {
        K = parse(txt);
        KNOWN = new Set();
        if (M && M.ranked) for (let i = 0; i < M.ranked.length; i++) KNOWN.add(M.ranked[i].id);
        ST = 2;
        if (location.hash.indexOf('#/kinch') === 0 && window.GOAT && window.GOAT.render) window.GOAT.render(true);
      })
      .catch(function (e) { ST = -1; console.warn('[kinch] 数据表加载失败', e); });
  }

  /* 单项目取值（单位 k×100）。track = 'best' | 'single' | 'average' */
  function cell(r, ei, track) {
    const a = r.c[ei * 2], b = r.c[ei * 2 + 1];
    if (track === 'single') return a;
    if (track === 'average') return b;
    const ev = K.evs[ei];
    return SINGLE_ONLY[ev] ? a : BEST_OF[ev] ? (a > b ? a : b) : b;
  }
  function overall(r, track) {
    const s = track === 'single' ? r.sS : track === 'average' ? r.sA : r.sB;
    return s / N_EV;                        /* 单位 k×100 → /100 得 0..100 的 Overall */
  }

  /* 顶部筛选条（地区 / 性别）在本榜生效；数据包自带 iso2 与 gender，不依赖 slim 名单 */
  function inScope(r, state) {
    if (state.gender && state.gender !== 'all') {
      const g = r.g === 'f' ? 'F' : 'M';
      if (g !== state.gender) return false;
    }
    if (state.geo) {
      if (state.geo.indexOf('cont:') === 0) {
        if (!M.continentOf || M.continentOf[r.iso] !== state.geo.slice(5)) return false;
      } else if (r.iso !== state.geo) return false;
    }
    if (state.country && r.iso !== state.country) return false;
    if (state.continent && (!M.continentOf || M.continentOf[r.iso] !== state.continent)) return false;
    if (state.region && (!M.regionOf || !M.continentOf || M.regionOf[M.continentOf[r.iso]] !== state.region)) return false;
    /* 项目图标选中：只保留在该项目上有成绩的人 */
    if (state.kinchEv) {
      const ei = K.evs.indexOf(state.kinchEv);
      if (ei >= 0 && cell(r, ei, state.kinchTrack) <= 0) return false;
    }
    return true;
  }

  /* 国家 / 地区聚合：每个项目取「筛选范围内该国选手的最佳 k」——与参考站 Countries 榜同构 */
  function nationRows(state) {
    const track = state.kinchTrack, map = new Map();
    for (let i = 0; i < K.rows.length; i++) {
      const r = K.rows[i];
      if (!inScope(r, state)) continue;
      if (!r.iso) continue;
      let o = map.get(r.iso);
      if (!o) {
        o = { iso: r.iso, n: 0, c: new Int16Array(N_EV), sum: 0 };
        map.set(r.iso, o);
      }
      o.n++;
      for (let e = 0; e < N_EV; e++) {
        const v = cell(r, e, track);
        if (v > o.c[e]) o.c[e] = v;
      }
    }
    const out = [];
    for (const o of map.values()) {
      let s = 0; for (let e = 0; e < N_EV; e++) s += o.c[e];
      o.sum = s;
      out.push(o);
    }
    return out;
  }

  /* 全量 29.8 万人排序是一次重活：按「筛选+排序签名」缓存结果，
     翻页 / 语言切换 / 无关重渲染直接命中，避免每次 render 都排 30 万行。 */
  let CACHE = { sig: '', data: null };
  function build(state) {
    const sig = [state.kinchTrack, state.kinchView, state.kinchEv, state.kinchSort, state.kinchDir,
      state.gender, state.geo, state.country, state.continent, state.region].join('|');
    if (CACHE.sig === sig && CACHE.data) return CACHE.data;
    const isNat = state.kinchView === 'nation';
    const track = state.kinchTrack;
    let rows;
    if (isNat) rows = nationRows(state);
    else {
      rows = [];
      for (let i = 0; i < K.rows.length; i++) if (inScope(K.rows[i], state)) rows.push(K.rows[i]);
    }
    const total = rows.length;                       /* 真实匹配人数（不受 1000 上限影响） */
    const dir = state.kinchDir === 'asc' ? 1 : -1;
    const k = state.kinchSort || 'overall';
    const isName = k === 'name', isOverall = k === 'overall';
    const ei = isName || isOverall ? -1 : K.evs.indexOf(k);
    /* 比较器里不做 indexOf / 不做除法：预解析排序键，避免 5M 次比较各查一次项目表 */
    const sumKey = track === 'single' ? 'sS' : track === 'average' ? 'sA' : 'sB';
    rows.sort(function (a, b) {
      let va, vb;
      if (isName) {
        va = isNat ? (countryName(a.iso) || a.iso) : a.name;
        vb = isNat ? (countryName(b.iso) || b.iso) : b.name;
        return va.localeCompare(vb) * dir;
      }
      if (isOverall) { va = isNat ? a.sum : a[sumKey]; vb = isNat ? b.sum : b[sumKey]; }
      else if (ei >= 0) { va = isNat ? a.c[ei] : cell(a, ei, track); vb = isNat ? b.c[ei] : cell(b, ei, track); }
      else { va = 0; vb = 0; }
      return (va - vb) * dir || (isNat ? 0 : (a.pid < b.pid ? -1 : 1));
    });
    if (rows.length > CAP) rows = rows.slice(0, CAP);
    CACHE = { sig: sig, data: { rows: rows, isNat: isNat, total: total } };
    return CACHE.data;
  }

  function nameHtml(r) {
    if (KNOWN && KNOWN.has(r.pid)) return '<a class="linkish" href="#/player/' + esc(r.pid) + '">' + esc(r.name) + '</a>';
    /* 精简档之外的选手：直接连 WCA 官方主页，避免站内死链 */
    return '<a class="linkish" href="https://www.worldcubeassociation.org/persons/' + esc(r.pid) +
      '" target="_blank" rel="noopener" title="' + esc(t('kinch.wcaTip')) + '">' + esc(r.name) + ' ↗</a>';
  }
  function evLabel(ev) {
    const o = M.EV && M.EV[ev];
    return o ? (t.isEn() ? o.en : o.zh) : ev;
  }
  function kCell(v, on) {
    const k = v / 100;
    const a = v > 0 ? (0.04 + 0.34 * Math.min(1, k / 100)).toFixed(3) : '0';
    return '<td class="num kcell' + (on ? ' ksel' : '') + '" style="background:rgba(0,167,245,' + a + ')">' +
      (v > 0 ? k.toFixed(2) : '<span class="kzero">—</span>') + '</td>';
  }
  function trackLabel(tr) { return t('kinch.track.' + tr); }

  /* ── 表格 + 分页（也供数据加载完成后局部刷新）──────────────────── */
  P.kinchBody = function (state) {
    if (ST === -1) return '<div class="warnbox reveal">' + esc(t('kinch.loadFail')) + '</div>';
    if (ST !== 2 || !K) return '<div class="note-box reveal">' + esc(t('kinch.loading')) + '</div>';
    const b = build(state), rows = b.rows, isNat = b.isNat, total = b.total;
    const pages = Math.max(1, Math.ceil(rows.length / PER));
    const pg = Math.min(pages, Math.max(1, state.kinchPage || 1));
    const pageRows = rows.slice((pg - 1) * PER, pg * PER);
    const evs = K.evs, selEv = state.kinchEv || '';
    const sk = state.kinchSort || 'overall';

    let h = '<div class="kinch-cap reveal">' + esc(t('kinch.cap', { n: U.num(total), track: trackLabel(state.kinchTrack) })) +
      (selEv ? ' · <b>' + esc(evLabel(selEv)) + '</b>' : '') +
      (total > rows.length ? ' · <span class="muted">' + esc(t('kinch.capLimit', { n: U.num(rows.length) })) + '</span>' : '') + '</div>';
    h += '<div class="table-wrap reveal"><table class="data kinch-table"><thead><tr>';
    h += '<th class="tl krank">#</th>';
    h += '<th class="tl kname">' + esc(t(isNat ? 'kinch.col.country' : 'kinch.col.player')) + '</th>';
    h += '<th class="tl ksub">' + esc(t(isNat ? 'kinch.col.players' : 'kinch.col.gender')) + '</th>';
    h += '<th class="tl kregion">' + esc(t('kinch.col.region')) + '</th>';
    const arw = (k) => sk === k ? (state.kinchDir === 'asc' ? ' ▲' : ' ▼') : '';
    h += '<th class="kov" data-ksort="overall">Overall' + arw('overall') + '</th>';
    for (let e = 0; e < evs.length; e++) {
      const ev = evs[e];
      h += '<th class="kev' + (selEv === ev ? ' ksel' : '') + '" data-ksort="' + ev + '" title="' + esc(evLabel(ev)) +
        (K.wr[e * 2 + 1] === '-' ? ' · ' + esc(t('kinch.noAvg')) : '') + '">' + esc(ev) + arw(ev) + '</th>';
    }
    h += '</tr></thead><tbody>';
    if (!pageRows.length) h += '<tr><td colspan="' + (5 + evs.length) + '" class="tl empty">' + esc(t('ui.noresult')) + '</td></tr>';
    for (let i = 0; i < pageRows.length; i++) {
      const r = pageRows[i], no = (pg - 1) * PER + i + 1;
      const ov = isNat ? r.sum / N_EV / 100 : overall(r, state.kinchTrack) / 100;
      const top = no === 1 ? ' ktop1' : no === 2 ? ' ktop2' : no === 3 ? ' ktop3' : '';
      h += '<tr class="' + top.trim() + '">';
      h += '<td class="tl"><span class="rank-no">' + no + '</span></td>';
      if (isNat) {
        h += '<td class="tl"><button class="knation" data-knation="' + esc(r.iso) + '" title="' + esc(t('kinch.nationTip')) + '">' +
          flag(r.iso) + '<span>' + esc(countryName(r.iso) || r.iso) + '</span></button></td>';
        h += '<td class="tl num">' + U.num(r.n) + '</td>';
        const cont = (M.continentOf && M.continentOf[r.iso]) || '';
        h += '<td class="tl muted">' + esc(cont ? contName(cont) : '—') + '</td>';
      } else {
        h += '<td class="tl"><div class="pname">' + nameHtml(r) + '</div></td>';
        h += '<td class="tl">' + (r.g === 'f' ? t('f.gender.f') : r.g === 'o' ? '—' : t('f.gender.m')) + '</td>';
        h += '<td class="tl"><span class="region-cell">' + flag(r.iso) + '<span class="rname">' + esc(countryName(r.iso) || r.iso || '—') + '</span></span></td>';
      }
      h += '<td class="num kov-cell"><b>' + ov.toFixed(2) + '</b></td>';
      for (let e = 0; e < evs.length; e++) {
        const v = isNat ? r.c[e] : cell(r, e, state.kinchTrack);
        h += kCell(v, selEv === evs[e]);
      }
      h += '</tr>';
    }
    h += '</tbody></table></div>';

    h += '<div class="pager">';
    h += '<button data-kpage="1"' + (pg === 1 ? ' disabled' : '') + '>«</button>';
    h += '<button data-kpage="' + (pg - 1) + '"' + (pg === 1 ? ' disabled' : '') + '>‹</button>';
    h += '<div class="pages">';
    const from = Math.max(1, pg - 2), to = Math.min(pages, from + 4);
    for (let i = from; i <= to; i++) h += '<button data-kpage="' + i + '" class="' + (i === pg ? 'on' : '') + '">' + i + '</button>';
    h += '</div>';
    h += '<button data-kpage="' + (pg + 1) + '"' + (pg === pages ? ' disabled' : '') + '>›</button>';
    h += '<button data-kpage="' + pages + '"' + (pg === pages ? ' disabled' : '') + '>»</button>';
    h += '<span class="info">' + esc(t('kinch.pager', { a: (pg - 1) * PER + 1, b: Math.min(pg * PER, rows.length), n: U.num(rows.length) })) + '</span>';
    h += '</div>';
    return h;
  };

  /* ── 整页 ─────────────────────────────────────────────────────── */
  P.kinch = function (state) {
    ensure();
    const tr = state.kinchTrack, view = state.kinchView, selEv = state.kinchEv || '';
    let h = '<div class="page-head reveal"><h1>' + esc(t('kinch.title')) + '</h1><p class="sub">' + esc(t('kinch.sub')) + '</p></div>';

    h += '<div class="kinch-toolbar reveal">';
    h += '<span class="tiny muted">' + esc(t('kinch.view')) + '</span>';
    h += '<div class="seg">';
    [['person', 'kinch.view.person'], ['nation', 'kinch.view.nation']].forEach(function (x) {
      h += '<button data-kview="' + x[0] + '" class="' + (view === x[0] ? 'on' : '') + '">' + esc(t(x[1])) + '</button>';
    });
    h += '</div>';
    h += '<span class="tiny muted">' + esc(t('kinch.track')) + '</span>';
    h += '<div class="seg">';
    [['best', 'kinch.track.best'], ['single', 'kinch.track.single'], ['average', 'kinch.track.average']].forEach(function (x) {
      h += '<button data-ktrack="' + x[0] + '" class="' + (tr === x[0] ? 'on' : '') + '">' + esc(t(x[1])) + '</button>';
    });
    h += '</div>';
    h += '<span class="spacer"></span>';
    h += '<span class="tag acc">' + esc(trackLabel(tr)) + ' · N=17</span>';
    h += '</div>';

    /* 逐项目快捷：点一次＝只看该项目并按其排序，再点取消 */
    h += '<div class="kinch-evbar reveal"><span class="flabel">' + esc(t('kinch.events')) + '</span><div class="kchips">';
    h += '<button class="chip' + (!selEv ? ' on' : '') + '" data-kev="">' + esc(t('f.all')) + '</button>';
    if (K) for (let e = 0; e < K.evs.length; e++) {
      const ev = K.evs[e];
      h += '<button class="chip kev-chip' + (selEv === ev ? ' on' : '') + '" data-kev="' + ev + '" title="' + esc(evLabel(ev)) + '">' +
        (Ic && Ic.event ? Ic.event(ev) : '') + '<span>' + esc(ev) + '</span></button>';
    }
    h += '</div></div>';

    h += '<div class="note-box reveal">' + (Ic && Ic.glyph ? Ic.glyph('info') : '') + '<div>' +
      esc(t('kinch.note', { track: trackLabel(tr) })) + '</div></div>';

    h += '<div id="kinchBody">' + P.kinchBody(state) + '</div>';
    return h;
  };

  /* 供 app.js 的筛选计数使用 */
  P.kinchCount = function (state) {
    if (ST !== 2 || !K) return 0;
    return build(state).total;
  };
  P.kinchState = function () { return ST; };
})();

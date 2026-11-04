/* ============================================================
   pages-sixdim.js — 六维分数细则（参数设置页的子页面）
   ------------------------------------------------------------
   由原独立实验页 sixdim.html 迁移而来，2026-11-04 修复两处结构性 bug：

   ① 表头与表内容不对齐：旧 render() 里 `cells += DIMS.filter(...)` 是**无条件**
      执行的，导致「六维总分」视图下每行有 15 列、表头只有 9 列（多出重复的
      6 个维度列），列错位一整屏。现在表头与表体统一由 colsFor(dim) 生成，
      列数与列序恒等，任何维度下都是 9 列。

   ② 莫名其妙的条状物：旧 CSS 定义了 `.bar-cell{position:relative}` 却从未给
      任何 <td> 加上这个类，于是 `.bar{position:absolute}` 相对表格/页面左上角
      定位，几十条半透明色条全部堆在表格外。现在色条放在带 `.sd-cell` 的
      单元格里（position:relative + overflow:hidden），数值另用 `.sd-val`
      提升层级，色条永远被裁在单元格内部。

   数据 js/sixdim_data.js 约 7.3MB，**只在进入本子页面时动态加载**，
   绝不阻塞首屏（首屏已有 65MB 的 data.js）。
   ============================================================ */
(function () {
  const t = window.I18N, U = window.U;
  const P = window.P || (window.P = {});
  const esc = U && U.esc ? U.esc : function (s) { return String(s == null ? '' : s); };

  const DIMS = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6'];
  const DIM_EN = {
    M1: 'Record holding', M2: 'Podiums', M3: 'Major events',
    M4: 'Dominance', M5: 'WR ratio', M6: 'Breakthrough'
  };
  const COLOR = {
    total: 'var(--accent)',
    M1: 'var(--m1)', M2: 'var(--m2)', M3: 'var(--m3)',
    M4: 'var(--m4)', M5: 'var(--m5)', M6: 'var(--m6)'
  };

  /* 语言包：站点 i18n 里没有本页专属文案，集中在此，避免散落硬编码 */
  function L() {
    const en = t && t.isEn && t.isEn();
    return en ? {
      title: 'Six-dimension score breakdown',
      sub: 'Per-player scores for M1–M6 and the weighted total. Switch a dimension to re-sort, filter by gender, or search by name / WCA ID.',
      tabDoc: 'Model & parameters', tabThis: 'Score breakdown',
      total: 'Total', all: 'All', male: 'Male', female: 'Female',
      search: 'Search name / WCA ID…', more: 'Load more (100 per page)',
      empty: 'No matching players',
      count: '{n} matched · showing top {m}',
      loading: 'Loading six-dimension scores (about 7 MB)…',
      fail: 'Could not load the score data. Please check your connection and refresh.',
      rank: '#', player: 'Player', totalCol: 'Weighted total',
      snapshot: 'Snapshot {d} · {n} players',
      weights: 'Weights',
      noteTitle: 'Method',
      noteBody: 'Weighted total = Σ (normalised dimension score × weight); each dimension is accumulated from per-event subtotals × event coefficients. Weights: M1 .45 / M3 .20 / M2 .15 / M4 .15 / M6 .04 / M5 .01.',
      noteStatic: 'This is a static full-scope snapshot. Gender filtering and search run in the browser; event / track / as-of cuts require a rerun of the unified engine (etl/score/sixdim.js) and are not available here. Data is embedded in js/sixdim_data.js and is independent of the live leaderboard.',
      chipsTotal: 'Weighted total'
    } : {
      title: '六维分数细则',
      sub: '逐人查看 M1–M6 各维得分与六维加权总分。可切换维度排序、按性别筛选、按姓名或 WCA ID 搜索。',
      tabDoc: '参数设置', tabThis: '六维分数细则',
      total: '六维总分', all: '全部', male: '男', female: '女',
      search: '搜索选手姓名 / WCA ID…', more: '加载更多（每页 100 人）',
      empty: '无匹配选手',
      count: '{n} 人符合 · 显示前 {m}',
      loading: '正在加载六维分数数据（约 7 MB）…',
      fail: '分数数据加载失败，请检查网络后刷新重试。',
      rank: '#', player: '选手', totalCol: '六维总分',
      snapshot: '数据快照 {d} · {n} 名选手',
      weights: '权重',
      noteTitle: '口径说明',
      noteBody: '六维总分 = Σ 维度分（同筛选范围内按榜首 = 1 归一）× 维度权重，各维度内部先按项目小计 × 项目系数累加。权重：M1 纪录持有 .45 / M3 大赛表现 .20 / M2 领奖台 .15 / M4 统治力 .15 / M6 突破幅度 .04 / M5 纪录比 .01。',
      noteStatic: '本页为全量口径的静态快照：性别筛选与搜索在页面内完成；项目 / 轨道 / as-of 时间截取需经统一引擎（etl/score/sixdim.js）重算，暂不进本页。数据由 js/sixdim_data.js 内嵌，与站点正式榜单相互独立、互不影响。',
      chipsTotal: '六维总分'
    };
  }

  function dimName(d, l, metaLabels) {
    if (d === 'total') return l.total;
    const zh = (metaLabels && metaLabels[d]) || d;
    return d + ' ' + (t && t.isEn && t.isEn() ? (DIM_EN[d] || d) : zh);
  }

  /* ★ 唯一的列定义来源：表头与表体都从这里取，列数 / 列序永远一致。
     返回 [{key, label, cls, bar}] —— bar 表示该列画色条（当前排序维度）。 */
  function colsFor(dim, l, metaLabels) {
    const cols = [
      { key: 'rk', label: l.rank, cls: 'sd-rk tl', bar: false },
      { key: 'nm', label: l.player, cls: 'sd-nm tl', bar: false }
    ];
    if (dim !== 'total') {
      cols.push({ key: dim, label: dimName(dim, l, metaLabels), cls: 'sd-cur', bar: true });
    }
    DIMS.filter(function (d) { return d !== dim; }).forEach(function (d) {
      cols.push({ key: d, label: dimName(d, l, metaLabels), cls: 'sd-off sd-sm', bar: false });
    });
    cols.push({
      key: 't', label: l.totalCol,
      cls: dim === 'total' ? 'sd-cur' : 'sd-tot',
      bar: dim === 'total'
    });
    return cols;
  }

  function fmt(v) {
    const x = Number(v) || 0;
    return x >= 1 ? x.toFixed(2) : x.toFixed(3);
  }

  function view(D, st) {
    const key = st.dim === 'total' ? 't' : st.dim;
    const q = st.q;
    const arr = D.rows.filter(function (r) {
      if (st.g !== 'all' && r.g !== st.g) return false;
      if (q && String(r.n).toLowerCase().indexOf(q) < 0 && String(r.id).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    arr.sort(function (a, b) { return (Number(b[key]) || 0) - (Number(a[key]) || 0); });
    return { arr: arr, key: key };
  }

  /* 纯函数：生成表头与表体 HTML。抽出供冒烟测试直接校验「列数一致」。 */
  function tableHtml(D, st, l) {
    const cols = colsFor(st.dim, l, D.meta && D.meta.labels);
    const v = view(D, st);
    const show = v.arr.slice(0, st.shown);
    const mx = show.length ? (Number(show[0][v.key]) || 1) : 1;
    const color = COLOR[st.dim] || COLOR.total;

    const head = cols.map(function (c) {
      return '<th class="' + c.cls + '">' + c.label + '</th>';
    }).join('');

    const body = show.map(function (r, i) {
      return '<tr>' + cols.map(function (c) {
        if (c.key === 'rk') {
          return '<td class="sd-rk tl' + (i < 3 ? ' sd-top3' : '') + '">' + (i + 1) + '</td>';
        }
        if (c.key === 'nm') {
          return '<td class="sd-nm tl"><b>' + esc(r.n) + '</b><small>' + esc(r.id) + '</small></td>';
        }
        const val = Number(r[c.key]) || 0;
        if (!c.bar) {
          return '<td class="' + c.cls + '">' + fmt(val) + '</td>';
        }
        /* 色条宽度按本列榜首归一；单元格是定位上下文且 overflow:hidden，
           色条绝不会溢出到表格之外（旧 bug 的根因）。 */
        const w = Math.min(96, Math.max(0, val / mx * 70));
        return '<td class="' + c.cls + ' sd-cell">' +
          '<span class="sd-bar" style="width:' + w.toFixed(2) + '%;background:' + color + '"></span>' +
          '<span class="sd-val">' + fmt(val) + '</span></td>';
      }).join('') + '</tr>';
    }).join('');

    return {
      head: head,
      body: body || '<tr><td class="sd-empty" colspan="' + cols.length + '">' + esc(l.empty) + '</td></tr>',
      cols: cols.length,
      rows: show.length,
      matched: v.arr.length,
      more: v.arr.length > st.shown
    };
  }

  /* ---------- 子页面骨架（不含数据） ---------- */
  function subTabs(active) {
    const l = L();
    return '<div class="sd-subtabs">' +
      '<a href="#/model" class="sd-subtab' + (active === 'doc' ? ' on' : '') + '">' + esc(l.tabDoc) + '</a>' +
      '<a href="#/model/sixdim" class="sd-subtab' + (active === 'sixdim' ? ' on' : '') + '">' + esc(l.tabThis) + '</a>' +
      '</div>';
  }

  P.sixdimSubTabs = subTabs;

  P.sixdim = function (state) {
    const l = L();
    let h = subTabs('sixdim');
    h += '<div class="page-head reveal"><h1>' + esc(l.title) + '</h1><p class="sub">' + esc(l.sub) + '</p></div>';
    h += '<div class="card reveal sd-card" id="sdRoot">';
    h += '<div class="sd-chips" id="sdChips"></div>';
    h += '<div class="sd-ctrl">';
    h += '<div class="sd-dims" id="sdDims"></div>';
    h += '<div class="seg sd-g" id="sdG">' +
      '<button type="button" data-sdg="all" class="on">' + esc(l.all) + '</button>' +
      '<button type="button" data-sdg="m">' + esc(l.male) + '</button>' +
      '<button type="button" data-sdg="f">' + esc(l.female) + '</button>' +
      '</div>';
    h += '<input type="search" class="sd-q" id="sdQ" placeholder="' + esc(l.search) + '" aria-label="' + esc(l.search) + '">';
    h += '<span class="sd-count" id="sdCount"></span>';
    h += '</div>';
    h += '<div class="table-wrap sd-wrap"><table class="data sd-table">' +
      '<thead><tr id="sdHead"></tr></thead><tbody id="sdBody"></tbody></table></div>';
    h += '<button type="button" class="btn sd-more" id="sdMore" hidden>' + esc(l.more) + '</button>';
    h += '<div class="sd-note"><b>' + esc(l.noteTitle) + '</b>：' + esc(l.noteBody) + '<br>' + esc(l.noteStatic) + '</div>';
    h += '<div class="sd-status" id="sdStatus">' + esc(l.loading) + '</div>';
    h += '</div>';
    return h;
  };

  /* ---------- 数据懒加载 + 交互挂载 ---------- */
  let loading = null;

  function dataURL() {
    const b = document.getElementsByTagName('base')[0];
    const base = b ? (b.getAttribute('href') || './') : './';
    return base + 'js/sixdim_data.js';
  }

  function ensureData(cb) {
    if (window.SIXDIM && window.SIXDIM.rows) { cb(window.SIXDIM); return; }
    if (loading) { loading.push(cb); return; }
    loading = [cb];
    const s = document.createElement('script');
    s.src = dataURL();
    s.onload = function () {
      const D = window.SIXDIM;
      const list = loading || [];
      loading = null;
      list.forEach(function (f) { f(D && D.rows ? D : null); });
    };
    s.onerror = function () {
      const list = loading || [];
      loading = null;
      list.forEach(function (f) { f(null); });
    };
    document.head.appendChild(s);
  }

  P.sixdimMount = function () {
    const root = document.getElementById('sdRoot');
    if (!root || root.__sdMounted) return;
    root.__sdMounted = true;
    const l = L();
    const status = document.getElementById('sdStatus');
    const st = { dim: 'total', g: 'all', q: '', shown: 100 };

    const dimsEl = document.getElementById('sdDims');
    const gEl = document.getElementById('sdG');
    const qEl = document.getElementById('sdQ');
    const headEl = document.getElementById('sdHead');
    const bodyEl = document.getElementById('sdBody');
    const cntEl = document.getElementById('sdCount');
    const moreEl = document.getElementById('sdMore');
    const chipsEl = document.getElementById('sdChips');

    function paint(D) {
      if (!D) {
        if (status) { status.textContent = l.fail; status.className = 'sd-status err'; }
        return;
      }
      if (status) status.hidden = true;
      const meta = D.meta || {};
      const weights = meta.weights || {};
      const labels = meta.labels || {};
      if (chipsEl && !chipsEl.innerHTML) {
        chipsEl.innerHTML = DIMS.map(function (d) {
          return '<span class="sd-chip"><b>' + esc(dimName(d, l, labels)) + '</b> ×' + esc(weights[d]) + '</span>';
        }).join('') + '<span class="sd-chip"><b>' + esc(l.chipsTotal) + '</b> = Σ ' + esc(l.weights) + '</span>' +
          '<span class="sd-chip sd-snapshot">' + esc(l.snapshot.replace('{d}', meta.generated || '—').replace('{n}', String(meta.count || D.rows.length))) + '</span>';
      }
      if (dimsEl && !dimsEl.innerHTML) {
        const keys = ['total'].concat(DIMS);
        dimsEl.innerHTML = keys.map(function (d) {
          return '<button type="button" class="sd-dim' + (d === st.dim ? ' on' : '') + '" data-sddim="' + d + '">' +
            esc(dimName(d, l, labels)) + '</button>';
        }).join('');
      }
      const res = tableHtml(D, st, l);
      if (headEl) headEl.innerHTML = res.head;
      if (bodyEl) bodyEl.innerHTML = res.body;
      if (cntEl) cntEl.textContent = l.count.replace('{n}', String(res.matched)).replace('{m}', String(res.rows));
      if (moreEl) { moreEl.hidden = !res.more; }
    }

    function rerender() { ensureData(paint); }

    if (dimsEl) dimsEl.addEventListener('click', function (e) {
      const b = e.target.closest ? e.target.closest('[data-sddim]') : null;
      if (!b) return;
      st.dim = b.getAttribute('data-sddim'); st.shown = 100;
      dimsEl.querySelectorAll('.sd-dim').forEach(function (x) { x.classList.toggle('on', x === b); });
      rerender();
    });
    if (gEl) gEl.addEventListener('click', function (e) {
      const b = e.target.closest ? e.target.closest('[data-sdg]') : null;
      if (!b) return;
      st.g = b.getAttribute('data-sdg'); st.shown = 100;
      gEl.querySelectorAll('[data-sdg]').forEach(function (x) { x.classList.toggle('on', x === b); });
      rerender();
    });
    if (qEl) qEl.addEventListener('input', function () {
      st.q = String(qEl.value || '').trim().toLowerCase(); st.shown = 100; rerender();
    });
    if (moreEl) moreEl.addEventListener('click', function () { st.shown += 100; rerender(); });

    rerender();
  };

  /* 导出纯函数供冒烟测试做「表头列数 === 表体列数」回归断言 */
  P.sixdimCols = colsFor;
  P.sixdimTableHtml = tableHtml;
  P.sixdimLabels = L;
})();

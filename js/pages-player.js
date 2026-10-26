/* ============================================================
   pages-player.js — 选手主页 / 选手 PK
   ============================================================ */
(function () {
  const t = window.I18N, U = window.U, M = window.MOCK, Ic = window.Icons, Pm = window.Params;
  const P = window.P || (window.P = {});
  const MOD = P.util.MOD, MODC = P.util.MODC;
  const esc = U.esc;
  const { avatar, flag, playerLink, modName, contribs, ecBox, scoreOf, infoTip, evName, contName, regionName, countryName, strength } = P.util;
  function tt(zh, en) { return t.isEn() ? en : zh; }
  /* 性别归一化（兼容 'Male'/'Female'/'m'/'f' 等真实导出写法） */
  function genderOf(g) { if (!g) return ''; g = String(g).charAt(0).toUpperCase(); return g === 'F' ? 'F' : 'M'; }

  /* ---------- LaTeX 公式工具 ---------- */
  function tex(s, display) {
    return display ? '\\[\\displaystyle ' + s + '\\]' : '\\(' + s + '\\)';
  }
  function notation(sym) { return '\\(' + sym + '\\)'; }

  /* ---------- 按项目的六维分（选手页「各项目贡献」用）----------
     口径与总榜一致：s_d[ev] 由 ETL 的 sixdim_by_event.tsv 下发，
     Σ_ev s_d[ev] ≡ 全站维度分，故「各项目六维小计」之和 = 该选手总分。
     旧的 evRows（单项分 = 100 × 世界名次^-γ）属已停用的 esum 口径，已删除。 */
  const EVCOL = ['#5b8cff', '#ff7a5c', '#3ecf8e', '#c084fc', '#f5c542', '#4dd0e1',
    '#ff8fb1', '#9ccc65', '#ffb74d', '#7e9cff', '#a3e635', '#f472b6'];
  function evRows(p) {
    const se = (p && p.sixEv) || null;
    if (!se) return [];
    const out = [];
    for (const eid in se) {
      const a = se[eid];
      const ev = (M.EV && M.EV[eid]) || {};
      const t = a[6] || 0;
      if (!(t > 0)) continue;
      out.push({ eid: eid, name: evName(ev), t: t, s: a });
    }
    out.sort(function (a, b) { return b.t - a.t; });
    return out;
  }

  const ANCHOR = {
    we: 'eventweight', S: 'era', T: 'm1', K: 'm1', G: 'm1', A: 'm1', O: 'm1', z: 'era',
    V: 'rankvalue', C: 'podium', CSI: 'podium', Tpod: 'm1', m: 'podium'
  };
  const SYM = {
    we: 'w_{e}', S: 'S_{e}(t)', T: 'T_{\\tau}', K: 'K_{e}', G: 'G_{g}', A: 'A', O: 'O', z: 'z',
    V: 'V(r)', C: 'C_{c}', CSI: 'F^{\\mathrm{CSI}}', Tpod: 'T^{\\mathrm{pod}}', m: 'm'
  };
  const DESC = {
    we: ['项目权重：规模因子 × 深度因子 × 状态系数', 'Event weight: scale × depth × status'],
    S: ['时代折减：当年参赛规模相对参考年的比值', 'Era discount: field size relative to the reference year'],
    T: ['单次 / 平均权重比', 'Single vs average weight ratio'],
    K: ['纪录线数补偿（单线项目）', 'Record-line compensation (single-line events)'],
    G: ['层级系数：WR / CR / NR', 'Tier coefficient: WR / CR / NR'],
    A: ['破纪录幅度', 'Improvement margin'],
    O: ['场合加成（大赛破纪录）', 'Occasion bonus (records at championships)'],
    z: ['领先度：相对同时代精英的 z 分数', 'Dominance: z-score against contemporaneous elites'],
    V: ['名次价值函数', 'Place-value function'],
    C: ['赛级加成（世锦 / 洲锦 / 国锦 / 公开）', 'Championship-tier bonus'],
    CSI: ['赛事强度（参赛名单实力）', 'Field strength'],
    Tpod: ['领奖台的赛制可靠性修正', 'Format reliability adjustment for podiums'],
    m: ['夺冠幅度（领先亚军的比例）', 'Winning margin over the runner-up']
  };
  function factorChip(key, val) {
    const a = ANCHOR[key] || 'm1';
    const d = DESC[key] || ['', ''];
    return '<a class="fchip" href="#/model#' + a + '" title="' + esc(t.isEn() ? d[1] : d[0]) + '">' +
      '<span class="fchip-s">' + notation(SYM[key] || key) + '</span>' +
      '<span class="fchip-v">' + U.fmt(val, 2) + '</span></a>';
  }

  /* ================= 选手主页 ================= */
  P.player = function (id) {
    const p = M.ranked.filter(function (x) { return x.id === id; })[0];
    if (!p) return '<div class="empty">' + esc(t('ui.noresult')) + '</div>';
    M.ensureDetail(p);
    const sc = scoreOf(p);
    const cs = contribs(p, 'career');
    const tot = cs.reduce(function (a, c) { return a + c.v; }, 0) || 1;
    const rk = M.ranksOf(p);
    const st = M.stats(p);

    let h = '<div class="page-head reveal"><a class="tiny" href="#/rank">‹ ' + esc(t('player.back')) + '</a></div>';
    /* 精简档案（排名 2500 名之后）：不含纪录 / 领奖台明细，引导到 WCA 官网 */
    if (p.slim) {
      h += '<div class="warnbox reveal" style="margin-bottom:12px">' +
        esc(tt('该选手为本站点收录的精简档案：包含评分、世界排名与参赛概况，但不含逐条纪录与领奖台明细。完整成绩请查看 WCA 官方主页。',
          'This player is stored as a compact profile: scores, world rankings and participation summary are included, but per-record and podium details are not. See their WCA profile for the full results.')) +
        ' <a href="https://www.worldcubeassociation.org/persons/' + esc(p.wcaId) + '" target="_blank" rel="noopener">WCA ↗</a></div>';
    }

    /* 信息栏（无头像；国旗 / WCA ID / 性别放大并加外框）
       姓名与右侧综合能力分放在同一行并按基线对齐（align-items:baseline），
       避免大号分数因为行高不同而比姓名高出一截。 */
    h += '<div class="card pcard reveal">';
    h += '<div class="pcard-main">';
    h += '<div class="pcard-name"><div class="pcard-topline">';
    h += '<h1><a class="wca-name" href="https://www.worldcubeassociation.org/persons/' + esc(p.wcaId) + '" target="_blank" rel="noopener" title="' + esc(t('player.wca')) + '">' + esc(p.nameZh || p.name) + ' ' + Ic.glyph('external') + '</a></h1>';
    h += '<div class="pcard-score">';
    h += '<div class="sc-wrap"><div class="sc-label">' + esc(t('rank.tab.overall')) + '</div>' +
      '<div class="sc-value grad">' + U.fmt(sc.overall, 2) + '</div></div>';
    h += '</div>';
    h += '</div>';
    h += '<div class="pid-box">' +
      '<span class="pid-cell pid-flag">' + flag(p.country, 'f-lg') + '<span class="pid-txt">' + esc(countryName(p.country)) + '</span></span>' +
      '<span class="pid-cell mono" title="' + esc(t('player.wca')) + '">' + esc(p.wcaId) + '</span>' +
      '<span class="pid-cell">' + (genderOf(p.gender) === 'F' ? t('f.gender.f') : t('f.gender.m')) + '</span>' +
      '</div>';
    h += '<div class="p-tags">';
    h += '<span class="tip tag-tip" tabindex="0" aria-label="' + esc(t('player.mainEventTip')) + '">' +
      '<span class="tag acc">' + esc(t('player.mainEvent')) + ' ' + esc(evName(M.EV[p.mainEvent])) + '</span>' +
      '<span class="tip-body">' + esc(t('player.mainEventTip')) + '</span></span>';
    h += '<span class="tag" title="' + esc(tt('首次参赛到最近参赛的年份区间', 'Years from your first to your latest competition')) + '">' + esc(t('player.career')) + ' ' + p.start + '–' + p.end + '</span>';
    h += '<span class="tag" title="' + esc(tt('你参加过的 WCA 比赛总场次', 'Total WCA competitions you have entered')) + '">' + esc(t('player.comps')) + ' ' + p.comps + '</span>';
    h += '<span class="tag" title="' + esc(tt('你参加过的 WCA 项目数量', 'Number of distinct WCA events you have entered')) + '">' + esc(t('player.events')) + ' ' + p.events.length + '</span>';
    h += '</div>';
    /* 次级分数：两个最能说明「状态」的维度分（M4 统治力 / M5 当前排名）。
       旧模型的「生涯 / 巅峰 / 均衡」三档已随七模块停用。 */
    h += '<div class="pcard-sub">';
    h += '<div class="sc-row">';
    h += '<div class="sc-mini"><span>' + esc(t('m4.name')) + '</span><b>' + U.fmt((p.six && p.six.m4) || 0, 2) + '</b></div>';
    h += '<div class="sc-mini"><span>' + esc(t('m5.name')) + '</span><b>' + U.fmt((p.six && p.six.m5) || 0, 2) + '</b></div>';
    h += '</div>';
    h += '<button class="btn btn-primary pkadd-btn" data-pkadd="' + p.id + '">' + Ic.glyph('pk') + ' ' + esc(t('player.compare')) + '</button>';
    h += '</div>';
    h += '</div>';

    /* 世界 / 洲 / 国家 排名：按需求移入「选手信息板块」内部，
       做成信息栏下方的一排紧凑胶囊，不再单独占据一个区块。 */
    h += '<div class="pid-ranks">';
    h += rankPill(t('player.rankWorld'), rk.world, (M.meta && M.meta.players) || M.ranked.length, 'globe', '',
      tt('你在全球所有选手中的综合排名', 'Your overall rank among all players worldwide'));
    h += rankPill(contName(rk.contName) + t('player.rankSuffix'), rk.continent, rk.continentOf, 'globe', '',
      tt('你所在大洲（' + contName(rk.contName) + '）内的综合排名', 'Your rank within your continent (' + contName(rk.contName) + ')'));
    h += rankPill(t('player.rankNation'), rk.nation, rk.nationOf, 'flag', countryName(p.country),
      tt('你所在国家（' + countryName(p.country) + '）内的综合排名', 'Your rank within your country (' + countryName(p.country) + ')'));
    h += '</div>';
    h += '</div>';

    /* 核心数据：按需求上移到「选手信息」下方、「六维加权贡献」上方 */
    h += '<div class="card reveal"><div class="card-head"><h2>' + esc(t('player.coreStats')) + '</h2></div><div class="grid grid-4">';
    [['col.wr', p.wr, ''], ['rec.level.CR', p.cr, t('player.crTip')], ['rec.level.NR', p.nr, ''], ['col.wc', p.wcGold, ''],
    ['pod.level.CC', p.ccGold, ''], ['pod.level.NC', p.ncGold, ''], ['col.months', p.months1, ''],
    ['col.m4', (p.six && p.six.m4) || 0, ''], ['stat.podiumTotal', st.podiumTotal, ''], ['player.comps', p.comps, '']].forEach(function (s) {
      h += '<div class="stat"><div class="k">' + esc(t(s[0])) + (s[2] ? ' ' + infoTip(s[2]) : '') + '</div><div class="v">' + U.num(s[1]) + '</div></div>';
    });
    h += '</div></div>';

    /* 项目领域：按需求移到「核心数据」下方（原在页面最末），方便在看过基础数据后紧接着看项目覆盖 */
    h += '<div class="card reveal"><div class="card-head"><h2>' + esc(t('player.coverage')) + '</h2>' +
      infoTip(t('player.coverage.d', { n: 5000 })) + '</div>' +
      '<p class="tiny muted" style="margin-bottom:12px">' + esc(t('player.coverage.d', { n: 5000 })) + '</p>' +
      coverage(p) + '</div>';

    /* 六维加权贡献（当前模型唯一口径）：t = Σ_d w_d · s_d */
    h += '<div class="card reveal"><div class="card-head"><h2>' + esc(t('player.modSix')) + '</h2>' +
      '<span class="tiny muted">' + esc(t('player.weight')) + ' Σ=1</span></div>';
    /* 各模块计算过程：把每个模块的代入过程完整写出来 */
    h += '<div class="grid grid-2" style="align-items:start">';
    h += '<div>' + ecBox('donut', cs.map(function (c) { return { name: c.name, value: c.v, color: c.color }; }), { radius: ['48%', '74%'], legend: true }, 260) + '</div>';
    h += '<div>' + ecBox('waterfall', cs.map(function (c) { return { name: c.name, value: c.v, color: c.color }; }), { name: t('player.contrib') }, 260) + '</div>';
    h += '</div>';
    h += '<div class="breakdown-table">';
    h += '<div class="breakdown-row bk-head"><span>' + esc(t('m1.name')) + '</span><span></span><span>' + esc(t('player.raw')) + '</span><span class="bk-num">' + esc(t('player.weight')) + '</span><span class="bk-num">' + esc(t('player.contrib')) + '</span><span class="bk-num">' + esc(t('player.pct')) + '</span></div>';
    cs.forEach(function (c) {
      h += '<div class="breakdown-row">';
      h += '<span class="bk-name"><i style="background:' + c.color + '"></i>' + esc(c.name) + '</span>';
      h += '<span class="bk-bar"><i style="width:' + Math.min(100, c.raw / (U.sixFull || 1000) * 100) + '%;background:' + c.color + '"></i></span>';
      h += '<span class="bk-num">' + U.fmt(c.raw, 2) + '</span>';
      h += '<span class="bk-num">' + U.fmt(c.w * 100, 1) + '%</span>';
      h += '<span class="bk-num"><b>' + U.fmt(c.v, 2) + '</b></span>';
      h += '<span class="bk-num">' + U.fmt(c.v / tot * 100, 1) + '%</span>';
      h += '</div>';
    });
    h += '</div></div>';

    /* 各维度计算过程：公式 + 本选手真实输入 + 归一化维度分与加权贡献 */
    h += dimCalcCard(p, cs);

    /* 横向对比（六维雷达）：只展示本选手个人六维分（每轴按该维度榜首归一为 100，即「与满分对比」） */
    h += '<div class="card reveal"><div class="card-head"><h2>' + esc(t('player.cmp')) + '</h2>' + infoTip(t('player.cmp.d')) + '</div>';
    const cmp = P.playerCompare ? P.playerCompare(p) : null;
    if (cmp) {
      h += '<div class="cmp-radar-wrap"><div class="pk-radar-wrap">' + ecBox('radar', { rows: cmp.series, indicators: cmp.indicators }, { max: U.sixFull || 1000, radius: '72%' }, 500) + '</div></div>';
      h += '<p class="tiny muted" style="text-align:center;margin-bottom:8px">' + esc(t('player.cmp.note')) + '</p>';
    }
    h += '</div>';


    /* 纪录事件明细（默认收起，点击标题展开） */
    h += '<details class="card reveal" id="recDetails">';
    h += '<summary class="card-head"><h2>' + esc(t('player.records')) + '</h2>' +
      '<span class="tiny muted">' + p.records.length + ' × M1</span><span class="sum-caret">›</span></summary>';
    h += '<div class="card-body">';
    h += '<div class="ach-toolbar">';
    h += '<div class="seg" id="recLevelSeg">' + segBtn('all', 'all', 'recLevel') + segBtn('WR', 'rec.level.WR', 'recLevel') + segBtn('CR', 'rec.level.CR', 'recLevel') + segBtn('NR', 'rec.level.NR', 'recLevel') + '</div>';
    h += '<div class="seg" id="recTypeSeg">' + segBtn('all', 'all', 'recType') + segBtn('single', 'rec.single', 'recType') + segBtn('avg', 'rec.average', 'recType') + '</div>';
    h += '<select id="recSort"><option value="score">' + esc(t('player.sort.score')) + '</option><option value="date">' + esc(t('player.sort.date')) + '</option><option value="held">' + esc(t('player.sort.held')) + '</option></select>';
    h += '<span class="spacer"></span>';
    h += '<button class="btn" data-expandall="rec">' + esc(t('ui.expandAll')) + '</button>';
    h += '</div>';
    h += '<div class="rec-head">' +
      '<span class="rc rc-lv">' + esc(t('player.filter.level')) + '</span>' +
      '<span class="rc rc-ev">' + esc(t('pod.event')) + '</span>' +
      '<span class="rc rc-val">' + esc(t('rec.value')) + '</span>' +
      '<span class="rc rc-date">' + esc(t('rec.date')) + '</span>' +
      '<span class="rc rc-held">' + esc(t('rec.held')) + '</span>' +
      '<span class="rc rc-score">' + esc(t('rec.score')) + '</span>' +
      '<span class="rc rc-caret"></span></div>';
    p.records.slice().sort(function (a, b) { return (b.R || 0) - (a.R || 0); }).forEach(function (r, i) {
      h += recRow(p, r, i);
    });
    h += '</div></details>';

    /* 领奖台明细（默认收起，点击标题展开） */
    h += '<details class="card reveal" id="podDetails">';
    h += '<summary class="card-head"><h2>' + esc(t('player.podiums')) + '</h2>' +
      '<span class="tiny muted">' + p.podiums.length + ' × M2+M3</span><span class="sum-caret">›</span></summary>';
    h += '<div class="card-body">';
    h += '<div class="ach-toolbar"><div class="seg" id="podTierSeg">' +
      segBtn('all', 'all', 'podTier') + segBtn('WC', 'pod.level.WC', 'podTier') + segBtn('CC', 'pod.level.CC', 'podTier') +
      segBtn('NC', 'pod.level.NC', 'podTier') + segBtn('OP', 'pod.level.OP', 'podTier') + '</div>';
    h += '<span class="spacer"></span><button class="btn" data-expandall="pod">' + esc(t('ui.expandAll')) + '</button></div>';
    p.podiums.slice().sort(function (a, b) { return (b.R || 0) - (a.R || 0); }).forEach(function (r, i) { h += podRow(p, r, i); });
    h += '</div></details>';

    return h;
  };

  /* 六维雷达对比：只画本选手个人六维分（每轴已是「该维度榜首=100」的归一分，即与满分对比） */
  P.playerCompare = function (p) {
    const aV = contribs(p, 'career').map(function (c) { return c.raw; });
    const series = [{ name: p.name, color: 'hsl(' + p.hue + ',58%,50%)', values: aV }];
    return { indicators: MOD.map(function (k) { return modName(k); }), series: series };
  };

  function segBtn(val, labelKey, attr) {
    return '<button data-' + attr + '="' + val + '" class="' + (val === 'all' ? 'on' : '') + '">' + esc(labelKey === 'all' ? t('f.all') : t(labelKey)) + '</button>';
  }

  function rankCard(label, rank, of, icon, sub, explain) {
    return '<div class="rank-card"><div class="rk-ic">' + Ic.glyph(icon) + (explain ? ' ' + infoTip(explain) : '') + '</div>' +
      '<div class="rk-label">' + esc(label) + '</div>' +
      '<div class="rk-val"><b>' + rank + '</b><span class="tiny muted"> / ' + U.num(of) + '</span></div>' +
      (sub ? '<div class="tiny muted">' + esc(sub) + '</div>' : '') + '</div>';
  }

  /* 信息栏内的排名胶囊：世界 / 洲 / 地区 / 巅峰高度 */
  function rankPill(label, rank, of, icon, sub, explain) {
    return '<div class="pid-rank" title="' + esc(explain || label) + '">' +
      '<span class="pr-ic">' + Ic.glyph(icon) + '</span>' +
      '<span class="pr-label">' + esc(label) + '</span>' +
      '<span class="pr-val"><b>' + rank + '</b><i>/ ' + U.num(of) + '</i></span>' +
      (sub ? '<span class="pr-sub">' + esc(sub) + '</span>' : '') + '</div>';
  }

  function recRow(p, r, i) {
    const lvCls = r.level === 'WR' ? 'var(--m1)' : (r.level === 'CR' ? 'var(--m2)' : 'var(--m5)');
    let h = '<div class="rec-item" data-ach="rec" data-pid="' + p.id + '" data-idx="' + i + '" data-level="' + r.level + '" data-type="' + (r.type === 'single' ? 'single' : 'avg') +
      '" data-score="' + r.R + '" data-date="' + esc(r.date) + '" data-held="' + r.held + '">';
    h += '<div class="rec-row" data-toggle>';
    h += '<span class="rc rc-lv"><b style="color:' + lvCls + '">' + esc(t('rec.level.' + r.level)) + '</b></span>';
    h += '<span class="rc rc-ev">' + Ic.event(r.ev, 'ev-mini') + ' ' + esc(evName(M.EV[r.ev])) + ' · ' + esc(t('rec.' + (r.type === 'single' ? 'single' : 'average'))) + '</span>';
    h += '<span class="rc rc-val mono">' + esc(r.value) + '</span>';
    h += '<span class="rc rc-date tiny muted">' + esc(r.date) + '</span>';
    h += '<span class="rc rc-held tiny muted">' + esc(P.util.heldText(r.held)) + '</span>';
    h += '<span class="rc rc-score"><b>' + U.fmt(r.R, 1) + '</b></span>';
    h += '<span class="rc rc-caret"><span class="caret">›</span></span>';
    h += '</div>';
    h += '<div class="rec-body" data-body="rec-' + i + '"></div></div>';
    return h;
  }

  function recBody(r) {
    let h = '<div class="chain-latex">' +
      tex('R = B_{R}\\;\\cdot\\;w_{e\\,' + U.fmt(r.factors.we, 2) + '}\\;\\cdot\\;S_{e}(t)_{' + U.fmt(r.factors.S, 2) + '}\\;\\cdot\\;T_{\\tau\\,' + U.fmt(r.factors.T, 2) + '}\\;\\cdot\\;K_{e\\,' + U.fmt(r.factors.K, 2) + '}\\;\\cdot\\;G_{g\\,' + U.fmt(r.factors.G, 2) + '}\\;\\cdot\\;A_{' + U.fmt(r.factors.A, 2) + '}\\;\\cdot\\;O_{' + U.fmt(r.factors.O, 2) + '}\\;\\cdot\\;(1+k_{r}z)_{' + U.fmt(1 + 0.15 * r.factors.z, 2) + '}\\;=\\;\\mathbf{' + U.fmt(r.R, 1) + '}', true) +
      '</div>';
    h += '<div class="chain-chips">';
    ['we', 'S', 'T', 'K', 'G', 'A', 'O', 'z'].forEach(function (k, idx) {
      if (idx) h += '<span class="op">×</span>';
      h += factorChip(k, r.factors[k]);
    });
    h += '<span class="op">=</span><span class="chain-result">' + U.fmt(r.R, 1) + '</span>';
    h += '</div>';
    h += '<div class="rec-meta"><span class="tiny muted">' + esc(t('rec.date')) + ' ' + esc(r.date) + ' · ' + esc(r.comp) + '</span>' +
      '<span class="tiny muted">' + esc(t('rec.held')) + ' ' + esc(P.util.heldText(r.held)) + '</span>' +
      (r.current ? '<span class="tag acc">' + (t.isEn() ? 'still held' : '仍持有') + '</span>' : '') + '</div>';
    /* NR 记分按「该国该项目参赛人数」加权：人数少的国家 NR 更贬值，避免靠刷 NR 堆分 */
    if (r.level === 'NR' && r.factors && r.factors.NRS != null) {
      h += '<div class="rec-meta"><span class="tiny muted">' +
        esc(tt('NR 记分已按该国该项目的参赛人数加权：人数越少，NR 越容易拿到，记分越低。',
          'This NR is weighted by how many people from that country compete in the event: fewer competitors means an easier NR and a lower score.')) +
        '　<b>' + esc(t('rec.nrScale')) + ' ' + U.fmt(r.factors.NRS, 2) + '×</b>' +
        (r.factors.natN ? '（' + esc(t('rec.natN')) + ' ' + U.num(r.factors.natN) + '）' : '') +
        '</span></div>';
    }
    return h;
  }

  function podRow(p, r, i) {
    const tierColor = r.tier === 'WC' ? 'var(--m1)' : (r.tier === 'CC' ? 'var(--m2)' : (r.tier === 'NC' ? 'var(--m5)' : 'var(--text-2)'));
    let h = '<div class="rec-item" data-ach="pod" data-pid="' + p.id + '" data-idx="' + i + '" data-tier="' + r.tier + '">';
    h += '<div class="rec-row" data-toggle>';
    h += '<span class="rc rc-lv"><b style="color:' + tierColor + '">' + esc(t('pod.level.' + r.tier)) + '</b></span>';
    h += '<span class="rc rc-ev">' + Ic.event(r.ev, 'ev-mini') + ' ' + esc(evName(M.EV[r.ev])) + ' · ' + esc(t('pod.placeName.' + r.place)) + '</span>';
    h += '<span class="rc rc-val mono tiny muted">' + esc(r.comp) + ' · ' + r.year + '</span>';
    h += '<span class="rc rc-date tiny muted">' + esc(t('pod.field')) + ' ' + r.field + '</span>';
    h += '<span class="rc rc-held tiny muted">' + esc(t('pod.csi')) + ' ' + U.fmt(r.factors.CSI, 2) + '</span>';
    h += '<span class="rc rc-score"><b>' + U.fmt(r.R, 1) + '</b></span>';
    h += '<span class="rc rc-caret"><span class="caret">›</span></span>';
    h += '</div>';
    h += '<div class="rec-body" data-body="pod-' + i + '"></div></div>';
    return h;
  }

  function podBody(r) {
    let h = '<div class="chain-latex">' +
      tex('P = B_{P}\\;\\cdot\\;w_{e\\,' + U.fmt(r.factors.we, 2) + '}\\;\\cdot\\;S_{e}(t)_{' + U.fmt(r.factors.S, 2) + '}\\;\\cdot\\;T^{\\mathrm{pod}}_{' + U.fmt(r.factors.Tpod, 2) + '}\\;\\cdot\\;V(r)_{' + U.fmt(r.factors.V, 3) + '}\\;\\cdot\\;C_{c\\,' + U.fmt(r.factors.C, 2) + '}\\;\\cdot\\;F^{\\mathrm{CSI}}_{' + U.fmt(r.factors.CSI, 2) + '}\\;\\cdot\\;(1+k_{p}z+\\mu m)_{' + U.fmt(1 + 0.1 * r.factors.z + 1.5 * r.factors.margin, 2) + '}\\;=\\;\\mathbf{' + U.fmt(r.R, 1) + '}', true) +
      '</div>';
    h += '<div class="chain-chips">';
    ['we', 'S', 'Tpod', 'V', 'C', 'CSI'].forEach(function (k, idx) {
      if (idx) h += '<span class="op">×</span>';
      h += factorChip(k, r.factors[k]);
    });
    h += '<span class="op">×</span>' + factorChip('z', r.factors.z) + '<span class="op">×</span>' + factorChip('m', r.factors.margin);
    h += '<span class="op">=</span><span class="chain-result">' + U.fmt(r.R, 1) + '</span>';
    h += '</div>';
    return h;
  }

  /* 各维度计算过程：用本选手真实代入的输入值，逐步算出「维度分 s」与「加权贡献 w·s」。
     cs 来自 contribs(p,'career')，已含 name/color/w/raw(=s_d)/v(=w·s_d)。
     整体包在 <details> 里，默认收起，点标题展开（满足「可收回可展开」需求）。 */
  const DIM_ANS = {
    m1: '破的纪录守了多久', m2: '拿过多少冠亚季军', m3: '锦标赛上突破的加成',
    m4: '保持在世界前十有多久', m5: '此刻站在世界各榜什么位置', m6: '破纪录瞬间把人类前沿推远多少'
  };
  function dimCalcCard(p, cs) {
    const rec = p.records || [], pod = p.podiums || [];
    const recByLv = { WR: 0, CR: 0, NR: 0 };
    let heldDays = 0, recR = 0, champRec = 0;
    rec.forEach(function (r) {
      if (recByLv[r.level] != null) recByLv[r.level]++;
      heldDays += (r.held || 0);
      recR += (r.R || 0);
      if (r.factors && r.factors.O > 1.0001) champRec++;
    });
    const podByTier = { WC: 0, CC: 0, NC: 0, OP: 0 };
    let podR = 0;
    pod.forEach(function (r) {
      if (podByTier[r.tier] != null) podByTier[r.tier]++;
      podR += (r.R || 0);
    });
    const rk = M.ranksOf(p);
    const metrics = {
      m1: [['WR', recByLv.WR], ['CR', recByLv.CR], ['NR', recByLv.NR],
        ['累计持有', U.fmt(heldDays / 365.25, 1) + ' 年'], ['ΣR', U.fmt(recR, 1)]],
      m2: [['世锦冠军', podByTier.WC], ['洲锦冠军', podByTier.CC], ['国锦冠军', podByTier.NC], ['公开赛', podByTier.OP], ['ΣP', U.fmt(podR, 1)]],
      m3: [['大赛纪录(估)', champRec], ['WR', recByLv.WR], ['CR', recByLv.CR], ['NR', recByLv.NR]],
      m4: [['在位 #1', (p.months1 || 0) + ' 月'], ['当前世界排名', '#' + rk.world]],
      m5: [['当前世界排名', '#' + rk.world]],
      m6: [['WR 链条数', recByLv.WR]]
    };
    let h = '<details class="card reveal dimcalc-wrap"><summary class="card-head"><h2>' + esc(t('player.dimCalc')) + '</h2>' +
      '<span class="sum-caret">›</span></summary>';
    h += '<div class="card-body">';
    h += '<p class="tiny muted" style="margin:2px 0 10px">' + esc(t('player.dimCalc.d')) + '</p>';
    cs.forEach(function (c) {
      const k = c.k;
      h += '<div class="dimcalc">';
      h += '<div class="dc-head"><i class="dc-dot" style="background:' + c.color + '"></i>' +
        '<b>' + esc(c.name) + '</b><span class="dc-q">' + esc(DIM_ANS[k]) + '</span>' +
        '<span class="dc-w">权重 ' + U.fmt(c.w * 100, 0) + '%</span></div>';
      h += '<div class="dc-inputs">';
      (metrics[k] || []).forEach(function (m) {
        h += '<span class="dc-in"><b>' + esc(String(m[1])) + '</b>' + esc(m[0]) + '</span>';
      });
      h += '</div>';
      /* 计算过程：维度分 s（已按该维榜首归一为 100）× 权重 w ＝ 加权贡献 v */
      h += '<div class="dc-process">维度分 <b>s = ' + U.fmt(c.raw, 2) + '</b>' +
        '<span class="op">×</span> 权重 <b>' + U.fmt(c.w * 100, 0) + '%</b>' +
        '<span class="op">=</span> 加权贡献 <b class="dc-v">' + U.fmt(c.v, 2) + '</b></div>';
      h += '</div>';
    });
    const grand = cs.reduce(function (a, c) { return a + c.v; }, 0);
    h += '<div class="dc-foot tiny muted">总分 t = Σ 各维加权贡献 = <b>' + U.fmt(grand, 2) + '</b></div>';
    h += '</div></details>';
    return h;
  }

  /* 项目领域：每格显示该项目的世界名次（WCA 官方 ranks 口径，取单次/平均更优者） */
  const EVENT_RANK_MAX = 5000;
  const _covIdx = {};
  function boardIdx(ev) {
    if (_covIdx[ev]) return _covIdx[ev];
    const arr = (M.eventBoards || {})[ev] || [];
    const m = {};
    arr.forEach(function (e) { m[e.id] = e; });
    _covIdx[ev] = m;
    return m;
  }
  function coverage(p) {
    let h = '<div class="cov-grid">';
    M.events.forEach(function (e) {
      const has = (p.events || []).indexOf(e.id) >= 0;
      const nm = esc(evName(e));
      if (!has) {
        h += '<div class="cov-cell empty" title="' + nm + '">' + Ic.event(e.id, 'ev-mini') +
          '<span class="cov-name">' + nm + '</span><span class="cov-rank">—</span></div>';
        return;
      }
      const ent = boardIdx(e.id)[p.id];
      const r = ent ? ent.r : 0;
      /* 名次越靠前颜色越实（对数缩放，与色条一致） */
      const q = r > 0 ? Math.max(0.08, Math.min(1, 1 - Math.log(r) / Math.log(EVENT_RANK_MAX + 1))) : 0.08;
      const best = ent ? (ent.s || '') + (ent.af ? ' / ' + ent.af : '') : '';
      /* 名次格式：按需求由「#56」改为「No.56」 */
      h += '<div class="cov-cell" style="--a:' + round(q, 2) + '" title="' + nm + (r ? ' · No.' + r + (best ? ' · ' + best : '') : ' · ' + t('player.coverage.noRank')) + '">' +
        Ic.event(e.id, 'ev-mini') + '<span class="cov-name">' + nm + '</span>' +
        '<span class="cov-rank">' + (r > 0 ? 'No.' + r : '—') + '</span></div>';
    });
    h += '</div>';
    return h;
  }
  function round(x, n) { const p = Math.pow(10, n); return Math.round(x * p) / p; }
  function f2(x) { return U.fmt(x, 2); }


  /* ================= 选手 PK ================= */
  P.pk = function (state) {
    const ids = state.pk || [];
    const ps = ids.map(function (id) { return M.ranked.filter(function (x) { return x.id === id; })[0]; }).filter(Boolean);

    let h = '<div class="page-head reveal"><h1>' + esc(t('pk.title')) + '</h1><p class="sub">' + esc(t('pk.sub')) + '</p></div>';

    h += '<div class="card reveal"><div class="card-head"><h2>' + esc(t('pk.pick')) + '</h2>' +
      '<span class="tiny muted" id="pkCount">' + ps.length + ' / 4</span></div>';
    h += '<div class="row" style="margin-bottom:10px">';
    h += '<input type="search" id="pkSearch" placeholder="' + esc(t('pk.pickPh')) + '" style="flex:1;min-width:160px">';
    h += '<button class="btn" id="pkClear">' + esc(t('pk.clear')) + '</button></div>';
    h += '<div id="pkResult" class="row" style="margin-bottom:10px"></div>';
    h += '<div class="row">' + ps.map(function (p) {
      return '<span class="tag acc pk-tag">' + avatar(p, 'sm') + esc(p.name) +
        ' <button class="expand-btn" data-pkrm="' + p.id + '" aria-label="remove">×</button></span>';
    }).join('') + '</div></div>';

    if (ps.length < 2) {
      h += '<div class="empty reveal">' + esc(t('pk.pick')) + '（' + ps.length + '/2）</div>';
      return h;
    }

    const colors = ps.map(function (p) { return 'hsl(' + p.hue + ',58%,50%)'; });
    const labels = MOD.map(modName);

    /* 二人对照：左数据 · 中能力图 · 右数据 */
    if (ps.length === 2) {
      const a = ps[0], b = ps[1];
      h += '<div class="pk-arena">';
      h += pkSideCard(a, 'left', colors[0]);
      h += '<div class="pk-center">';
      h += '<div class="card reveal" style="margin-bottom:14px"><div class="card-head"><h2>' + esc(t('pk.radar')) + '</h2>' + infoTip(t('pk.radar.d')) + '</div>';
      h += '<div class="pk-radar-wrap">' + ecBox('radar', {
        rows: [a, b].map(function (p, i) { return { name: p.name, color: colors[i], values: MOD.map(function (k) { return p.m[k]; }) }; }),
        indicators: labels
      }, { radius: '66%', max: U.sixFull || 1000 }, 360) + '</div></div>';
      h += '<div class="card reveal"><div class="card-head"><h2>' + esc(t('pk.advantage')) + '</h2>' + infoTip(t('pk.advantage.d')) + '</div>';
      h += ecBox('diverging', MOD.map(function (k) {
        return { name: modName(k), d: [sixW(k) * sixK(a, k), sixW(k) * sixK(b, k)] };
      }), {
        series: [{ name: a.name, color: colors[0] }, { name: b.name, color: colors[1] }]
      }, MOD.length * 34 + 70);
      h += '<div class="legend"><span><i style="background:' + colors[0] + '"></i>' + esc(a.name) + '</span>' +
        '<span><i style="background:' + colors[1] + '"></i>' + esc(b.name) + '</span></div></div>';
      h += '</div>';
      h += pkSideCard(b, 'right', colors[1]);
      h += '</div>';
      h += robustness(a, b, colors);
    } else {
      /* 雷达 */
      h += '<div class="card reveal"><div class="card-head"><h2>' + esc(t('pk.radar')) + '</h2>' + infoTip(t('pk.radar.d')) + '</div>';
      h += '<div class="pk-radar-wrap">' + ecBox('radar', {
        rows: ps.map(function (p, i) { return { name: p.name, color: colors[i], values: MOD.map(function (k) { return p.m[k]; }) }; }),
        indicators: labels
      }, { radius: '66%', max: U.sixFull || 1000 }, 360) + '</div>';
      h += '</div>';

      /* 加权贡献堆叠 */
      const maxC = Math.max.apply(null, ps.map(function (p) { return contribs(p, 'career').reduce(function (a, c) { return a + c.v; }, 0); })) * 1.05;
      h += '<div class="card reveal"><div class="card-head"><h2>' + esc(t('pk.contrib')) + '</h2>' + infoTip(t('pk.contrib.d')) + '</div>';
      h += ecBox('stacked', ps.map(function (p) {
        const cs = contribs(p, 'career');
        return { name: p.name, values: cs.map(function (c) { return c.v; }) };
      }), {
        max: Math.round(maxC * 10) / 10, legend: true,
        series: MOD.map(function (k) { return { name: modName(k), color: MODC[k] }; })
      }, Math.max(200, ps.length * 60 + 90));
      h += '</div>';

      /* 优势领域 */
      h += '<div class="card reveal"><div class="card-head"><h2>' + esc(t('pk.advantage')) + '</h2>' + infoTip(t('pk.advantage.d')) + '</div>';
      h += ecBox('stacked', MOD.map(function (k) {
        return {
          name: modName(k),
          values: ps.map(function (p) { return sixW(k) * sixK(p, k); })
        };
      }), { series: ps.map(function (p, i) { return { name: p.name, color: colors[i] }; }), legend: true }, MOD.length * 30 + 90);
      h += '</div>';
    }

    /* 风格定位散点（所有人） */
    h += '<div class="card reveal"><div class="card-head"><h2>' + esc(t('pk.style')) + '</h2>' + infoTip(t('pk.style.d')) + '</div>';
    const pts = ps.map(function (p, i) {
      const sc = scoreOf(p);
      return [round(sixK(p, 'm1'), 1), round(sixK(p, 'm2'), 1), esc(p.name) + ' · ' + U.fmt(sc.overall, 2), sc.overall];
    });
    h += ecBox('scatter', pts, {
      xName: t('m1.name'), yName: t('m2.name')
    }, 320);
    h += '</div>';
    return h;
  };

  /* 左侧 / 右侧 选手详情卡 */
  function pkSideCard(p, side, color) {
    const sc = scoreOf(p);
    const cs = contribs(p, 'career');
    const tot = cs.reduce(function (a, c) { return a + c.v; }, 0) || 1;
    let h = '<div class="pk-side pk-' + side + '">';
    h += '<div class="pk-pcard" style="--pkc:' + color + '">';
    h += '<div class="pk-phead"><div class="pk-pav">' + avatar(p, 'lg') + '</div>' +
      '<div class="pk-pid"><h3>' + esc(p.nameZh || p.name) + '</h3>' +
      '<div class="row" style="gap:6px;margin-top:4px">' + flag(p.country) + '<span class="tiny muted">' + esc(countryName(p.country)) + '</span>' +
      '<span class="tiny muted">' + (p.gender === 'F' ? t('f.gender.f') : t('f.gender.m')) + '</span></div></div>' +
      '<div class="pk-pscore"><b>' + U.fmt(sc.overall, 2) + '</b><span>' + esc(t('rank.tab.overall')) + '</span></div>';
    h += '</div>';
    h += '<div class="pk-pbars">';
    cs.forEach(function (c) {
      h += '<div class="pk-pbar"><span class="pk-pbk"><i style="background:' + c.color + '"></i>' + esc(c.name) + '</span>' +
        '<span class="pk-pbb"><i style="width:' + Math.min(100, c.v / tot * 100) + '%;background:' + c.color + '"></i></span>' +
        '<span class="pk-pbv">' + U.fmt(c.v, 1) + '</span></div>';
    });
    h += '</div>';
    h += '<div class="pk-keys">';
    [['rank.tab.overall', U.fmt(sc.overall, 2)], ['m4.name', U.fmt(sixK(p, 'm4'), 2)], ['col.wr', p.wr],
      ['col.wc', p.wcGold], ['m5.name', U.fmt(sixK(p, 'm5'), 2)], ['col.months', p.months1],
      ['player.events', p.events.length], ['player.comps', p.comps]].forEach(function (s) {
        h += '<div class="pk-key"><span class="pk-kk">' + esc(t(s[0])) + '</span><span class="pk-kv">' + s[1] + '</span></div>';
      });
    h += '</div>';
    h += '<button class="btn" data-pkrm="' + p.id + '" style="width:100%;margin-top:10px">' + esc(t('pk.remove')) + '</button>';
    h += '</div></div>';
    return h;
  }

  function robustness(a, b, colors) {
    const w = Pm.weights();
    const sa = scoreOf(a), sb = scoreOf(b);
    const la = Math.log(Math.max(sa.overall, .01)), lb = Math.log(Math.max(sb.overall, .01));
    const winner = sa.overall >= sb.overall ? a : b;
    const loser = sa.overall >= sb.overall ? b : a;
    const gap = Math.abs(la - lb);
    const prob = Math.max(0.5, Math.min(0.995, 0.5 + gap * 0.95));

    let h = '<div class="grid grid-2">';
    h += '<div class="card reveal"><div class="card-head"><h2>' + esc(t('pk.robust')) + '</h2>' + infoTip(t('pk.robust.d')) + '</div>';
    h += ecBox('gauge', prob, {}, 220);
    h += '<p class="tiny muted" style="text-align:center">' + esc(winner.name) + ' ' + esc(t('pk.win')) + ' · ' +
      U.fmt(Math.max(sa.overall, sb.overall), 2) + ' vs ' + U.fmt(Math.min(sa.overall, sb.overall), 2) + '</p>';
    h += '</div>';

    h += '<div class="card reveal"><div class="card-head"><h2>' + esc(t('pk.flip')) + '</h2>' + infoTip(t('pk.flip.d')) + '</div>';
    h += '<div class="flip-list">';
    MOD.forEach(function (k) {
      const dA = sixK(a, k), dB = sixK(b, k);
      const dj = (winner === a ? dA - dB : dB - dA);
      let S = 0;
      MOD.forEach(function (kk) { if (kk !== k) S += w[kk] * (winner === a ? sixK(a, kk) - sixK(b, kk) : sixK(b, kk) - sixK(a, kk)); });
      const den = dj * (1 - w[k]) - S;
      let x = den !== 0 ? -S / den : NaN;
      let verdict, cls = 'flip-ok';
      if (isNaN(x) || x < 0 || x > 0.95) { verdict = '<span class="muted">' + esc(t('ui.coming')) + '</span>'; cls = 'flip-no'; }
      else verdict = '<b>' + Math.round(x * 100) + '%</b><span class="tiny muted"> ← ' + Math.round(w[k] * 100) + '%</span>';
      h += '<div class="flip-row ' + cls + '"><span class="bk-name"><i style="background:' + MODC[k] + '"></i>' + esc(modName(k)) + '</span>' +
        '<span class="flip-bar"><i style="width:' + (cls === 'flip-ok' ? Math.min(100, x * 100) : 0) + '%;background:' + MODC[k] + '"></i></span>' +
        '<span class="flip-v">' + verdict + '</span></div>';
    });
    h += '</div></div></div>';
    return h;
  }

  /* 明细 body 懒渲染：由 app.js 在展开时调用 */
  P.achBody = function (pid, kind, idx) {
    const p = M.ranked.filter(function (x) { return x.id === pid; })[0];
    if (!p) return '';
    M.ensureDetail(p);
    if (kind === 'rec') {
      const r = p.records[idx];
      return r ? recBody(r) : '';
    }
    const r2 = p.podiums[idx];
    return r2 ? podBody(r2) : '';
  };
})();

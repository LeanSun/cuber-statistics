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
    const bn = M.bonus(p);
    const st = M.stats(p);

    let h = '<div class="page-head reveal"><a class="tiny" href="#/rank">‹ ' + esc(t('player.back')) + '</a></div>';
    /* 精简档案（排名 2500 名之后）：不含纪录 / 领奖台明细，引导到 WCA 官网 */
    if (p.slim) {
      h += '<div class="warnbox reveal" style="margin-bottom:12px">' +
        esc(tt('该选手为本站点收录的精简档案：包含评分、世界排名与参赛概况，但不含逐条纪录与领奖台明细。完整成绩请查看 WCA 官方主页。',
          'This player is stored as a compact profile: scores, world rankings and participation summary are included, but per-record and podium details are not. See their WCA profile for the full results.')) +
        ' <a href="https://www.worldcubeassociation.org/persons/' + esc(p.wcaId) + '" target="_blank" rel="noopener">WCA ↗</a></div>';
    }

    /* 信息栏（无头像；国旗 / WCA ID / 性别放大并加外框） */
    h += '<div class="card pcard reveal">';
    h += '<div class="pcard-main">';
    h += '<div class="pcard-name"><h1><a class="wca-name" href="https://www.worldcubeassociation.org/persons/' + esc(p.wcaId) + '" target="_blank" rel="noopener" title="' + esc(t('player.wca')) + '">' + esc(p.nameZh || p.name) + ' ' + Ic.glyph('external') + '</a></h1>';
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
    h += '<span class="tag" title="' + esc(tt('你参加过的 WCA 比赛总场数', 'Total WCA competitions you have entered')) + '">' + esc(t('player.comps')) + ' ' + p.comps + '</span>';
    h += '<span class="tag" title="' + esc(tt('你参加过的 WCA 项目数量', 'Number of distinct WCA events you have entered')) + '">' + esc(t('player.events')) + ' ' + p.events.length + '</span>';
    h += '<span class="tag" title="' + esc(tt('综合得分最高的项目', 'The event contributing most to your score')) + '">' + esc(t('player.mainEvent')) + ' ' + esc(evName(M.EV[p.mainEvent])) + '</span>';
    h += '</div></div></div>';

    h += '<div class="pcard-score">';
    h += '<div class="sc-wrap"><div class="sc-label">' + esc(t('rank.tab.overall')) + '</div>' +
      '<div class="sc-value grad">' + U.fmt(sc.overall, 1) + '</div></div>';
    h += '<div class="sc-row">';
    h += '<div class="sc-mini"><span>' + esc(t('rank.tab.career')) + '</span><b>' + U.fmt(sc.career, 1) + '</b></div>';
    h += '<div class="sc-mini"><span>' + esc(t('rank.tab.peak')) + '</span><b>' + U.fmt(sc.peak, 1) + '</b></div>';
    h += '<div class="sc-mini"><span>' + esc(t('col.balance')) + '</span><b>' + U.fmt(sc.balance, 2) + '</b></div>';
    h += '</div>';
    h += '<button class="btn btn-primary pkadd-btn" data-pkadd="' + p.id + '">' + Ic.glyph('pk') + ' ' + esc(t('player.compare')) + '</button>';
    h += '</div></div>';

    /* 世界 / 洲 / 地区 / 巅峰高度 排名（WCA 地区排名已按需求移除） */
    h += '<div class="rank4">';
    h += rankCard(t('player.rankWorld'), rk.world, M.ranked.length, 'globe', '',
      tt('你在全球所有选手中的综合排名', 'Your overall rank among all players worldwide'));
    h += rankCard(contName(rk.contName) + t('player.rankSuffix'), rk.continent, rk.continentOf, 'globe', '',
      tt('你所在大洲（' + contName(rk.contName) + '）内的综合排名', 'Your rank within your continent (' + contName(rk.contName) + ')'));
    h += rankCard(t('player.rankNation'), rk.nation, rk.nationOf, 'flag', countryName(p.country),
      tt('你所在国家（' + countryName(p.country) + '）内的综合排名', 'Your rank within your country (' + countryName(p.country) + ')'));
    const peakRank = M.ranked.filter(function (x) { return scoreOf(x).peak > sc.peak; }).length + 1;
    h += rankCard(t('player.rankPeak') + t('player.rankSuffix'), peakRank, M.ranked.length, 'globe', '',
      tt('按巅峰高度（最佳连续 12 个月）在世界范围内的排名 —— 与「世界排名」的综合能力口径互为补充：综合能力偏生涯厚度，巅峰高度只看最尖的那一段。',
        'Your rank by peak height (best rolling 12 months) worldwide — a complement to the world rank: combined ability leans on career volume, peak height looks only at the sharpest stretch.'));
    h += '</div>';
    h += '</div>';

    /* 总分构成 */
    h += '<div class="card reveal"><div class="card-head"><h2>' + esc(t('player.breakdown')) + '</h2>' +
      '<span class="tiny muted">' + esc(t('player.weight')) + ' Σ=1</span></div>';
    h += '<p class="tiny muted" style="margin-bottom:12px">' + tex('M_{\\text{total}}=\\frac{1000}{100}\\sum_{m=1}^{7}\\beta_{m}\\,M_{m},\\qquad \\sum_{m}\\beta_{m}=1', true) + '</p>';
    /* 总分计算过程：三步复现屏幕上的每个数字 */
    h += '<div class="calc-flow"><div class="calc-flow-h">' + Ic.glyph('book') + ' ' + esc(t('player.calcFlow')) + '</div>' +
      '<p class="tiny muted" style="margin-bottom:10px">' + esc(t('player.calcFlow.d')) + '</p><div class="calc-steps">';
    h += '<div class="calc-step"><div class="calc-step-no">1</div><div class="calc-step-b"><b>' + esc(t('player.calcStep1t')) + '</b>' +
      '<p class="tiny muted">' + esc(t('player.calcStep1')) + '</p><div class="calc-mods">' +
      cs.map(function (c) { return '<span class="calc-mod"><i style="background:' + c.color + '"></i>' + esc(c.name) + ' <b>' + U.fmt(c.raw, 1) + '</b></span>'; }).join('') +
      '</div></div></div>';
    h += '<div class="calc-step"><div class="calc-step-no">2</div><div class="calc-step-b"><b>' + esc(t('player.calcStep2t')) + '</b>' +
      '<p class="tiny muted">' + esc(t('player.calcStep2')) + '</p>' +
      '<div class="calc-eq">C（' + esc(t('rank.tab.career')) + '）＝ <b>' + U.fmt(sc.career, 1) + '</b>　　P（' + esc(t('rank.tab.peak')) + '）＝ <b>' + U.fmt(sc.peak, 1) + '</b></div></div></div>';
    h += '<div class="calc-step"><div class="calc-step-no">3</div><div class="calc-step-b"><b>' + esc(t('player.calcStep3t')) + '</b>' +
      '<p class="tiny muted">' + esc(t('player.calcStep3')) + '</p>' +
      '<div class="calc-eq">Overall ＝ ' + U.fmt(sc.career, 1) + '<sup>0.6</sup> × ' + U.fmt(sc.peak, 1) + '<sup>0.4</sup> ＝ <b class="grad">' + U.fmt(sc.overall, 1) + '</b></div></div></div>';
    h += '</div></div>';
    h += '<div class="grid grid-2" style="align-items:start">';
    h += '<div>' + ecBox('donut', cs.map(function (c) { return { name: c.name, value: c.v, color: c.color }; }), { radius: ['48%', '74%'], legend: true }, 260) + '</div>';
    h += '<div>' + ecBox('waterfall', cs.map(function (c) { return { name: c.name, value: c.v, color: c.color }; }), { name: t('player.contrib') }, 260) + '</div>';
    h += '</div>';
    h += '<div class="breakdown-table">';
    h += '<div class="breakdown-row bk-head"><span>' + esc(t('m1.name')) + '</span><span></span><span>' + esc(t('player.raw')) + '</span><span class="bk-num">' + esc(t('player.weight')) + '</span><span class="bk-num">' + esc(t('player.contrib')) + '</span><span class="bk-num">' + esc(t('player.pct')) + '</span></div>';
    cs.forEach(function (c) {
      h += '<div class="breakdown-row">';
      h += '<span class="bk-name"><i style="background:' + c.color + '"></i>' + esc(c.name) + '</span>';
      h += '<span class="bk-bar"><i style="width:' + Math.min(100, c.raw) + '%;background:' + c.color + '"></i></span>';
      h += '<span class="bk-num">' + U.fmt(c.raw, 1) + '</span>';
      h += '<span class="bk-num">' + U.fmt(c.w * 100, 1) + '%</span>';
      h += '<span class="bk-num"><b>' + U.fmt(c.v, 2) + '</b></span>';
      h += '<span class="bk-num">' + U.fmt(c.v / tot * 100, 1) + '%</span>';
      h += '</div>';
    });
    h += '</div></div>';

    /* 横向对比（七模块雷达）：本选手 vs 历史第一人 vs 全体均值 */
    h += '<div class="card reveal"><div class="card-head"><h2>' + esc(t('player.cmp')) + '</h2>' + infoTip(t('player.cmp.d')) + '</div>';
    const cmp = P.playerCompare ? P.playerCompare(p) : null;
    if (cmp) {
      h += '<div class="cmp-radar-wrap"><div class="pk-radar-wrap">' + ecBox('radar', { rows: cmp.series, indicators: cmp.indicators }, { max: 100, radius: '72%' }, 500) + '</div></div>';
      h += '<p class="tiny muted" style="text-align:center;margin-bottom:8px">' + esc(t('player.cmp.note')) + '</p>';
      h += '<p class="tiny muted" style="text-align:center">' + esc(t('player.cmp.zero')) + '</p>';
    }
    h += '</div>';

    /* 附加分 */
    h += '<div class="card reveal"><div class="card-head"><h2>' + esc(t('player.bonus')) + '</h2>' +
      infoTip(t('player.bonus.d')) + '</div>';
    h += '<div class="bonus-grid">';
    bn.items.forEach(function (it) {
      h += '<div class="bonus-item"><div class="bi-k">' + esc(t('player.bonus.' + it.k)) + '</div>' +
        '<div class="bi-v">' + U.fmt(it.v, 2) + '</div></div>';
    });
    h += '<div class="bonus-item total"><div class="bi-k">' + esc(t('player.bonus.total')) + '</div>' +
      '<div class="bi-v">' + U.fmt(bn.total, 2) + '</div>' +
      '<div class="tiny muted">' + esc(t('ui.note')) + '：' + esc(t('player.bonus.d')) + '</div></div>';
    h += '</div>';
    h += '<p class="tiny muted" style="margin-top:10px">' +
      tex('\\text{Bonus}=\\min\\Bigl(\\underbrace{\\text{Breadth}^{\\,\\theta}-1}_{\\text{跨项目}}+\\underbrace{n_{g}\\,c_{g}+\\mathbb{1}_{\\text{全项目}}c_{a}}_{\\text{全覆盖}},\\;\\text{cap}\\Bigr),\\quad \\text{cap}=' + U.fmt(bn.cap, 0) + '\\%', true) + '</p>';
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

    /* 项目领域（原「项目覆盖热力」；世界排名演变板块已移除） */
    h += '<div class="card reveal"><div class="card-head"><h2>' + esc(t('player.coverage')) + '</h2>' +
      infoTip(t('player.coverage.d', { n: 5000 })) + '</div>' +
      '<p class="tiny muted" style="margin-bottom:12px">' + esc(t('player.coverage.d', { n: 5000 })) + '</p>' +
      coverage(p) + '</div>';

    /* 原始统计 */
    h += '<div class="card reveal"><div class="card-head"><h2>' + esc(t('player.coreStats')) + '</h2></div><div class="grid grid-4">';
    [['col.wr', p.wr, ''], ['rec.level.CR', p.cr, t('player.crTip')], ['rec.level.NR', p.nr, ''], ['col.wc', p.wcGold, ''],
    ['pod.level.CC', p.ccGold, ''], ['pod.level.NC', p.ncGold, ''], ['col.months', p.months1, ''],
    ['col.elo', p.eloPeak, t('player.eloTip')], ['stat.podiumTotal', st.podiumTotal, ''], ['player.comps', p.comps, '']].forEach(function (s) {
      h += '<div class="stat"><div class="k">' + esc(t(s[0])) + (s[2] ? ' ' + infoTip(s[2]) : '') + '</div><div class="v">' + U.num(s[1]) + '</div></div>';
    });
    h += '</div></div>';
    return h;
  };

  /* 七模块雷达对比：本选手 vs 历史第一人 vs 全体均值（各轴按三者最大值归一为 100） */
  P.playerCompare = function (p) {
    const goat = M.ranked[0];
    const n = M.ranked.length || 1;
    const aV = contribs(p, 'career').map(function (c) { return c.v; });
    const gV = contribs(goat, 'career').map(function (c) { return c.v; });
    const sumV = MOD.map(function () { return 0; });
    M.ranked.forEach(function (x) {
      const cx = contribs(x, 'career');
      cx.forEach(function (c, i) { sumV[i] += c.v; });
    });
    const avgV = sumV.map(function (s) { return s / n; });
    const maxPer = MOD.map(function (k, i) { return Math.max(aV[i], gV[i], avgV[i]) || 1; });
    function mk(name, color, vals) {
      return { name: name, color: color, values: vals.map(function (v, i) { return v / maxPer[i] * 100; }) };
    }
    const series = [
      mk(p.name, 'hsl(' + p.hue + ',58%,50%)', aV),
      mk(goat.name, '#e0533d', gV),
      mk(t('player.cmp.avg'), '#7a8aa0', avgV)
    ];
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
      h += '<div class="cov-cell" style="--a:' + round(q, 2) + '" title="' + nm + (r ? ' · #' + r + (best ? ' · ' + best : '') : ' · ' + t('player.coverage.noRank')) + '">' +
        Ic.event(e.id, 'ev-mini') + '<span class="cov-name">' + nm + '</span>' +
        '<span class="cov-rank">' + (r > 0 ? '#' + r : '—') + '</span></div>';
    });
    h += '</div>';
    return h;
  }
  function round(x, n) { const p = Math.pow(10, n); return Math.round(x * p) / p; }

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
      }, { radius: '66%', max: 100 }, 360) + '</div></div>';
      h += '<div class="card reveal"><div class="card-head"><h2>' + esc(t('pk.advantage')) + '</h2>' + infoTip(t('pk.advantage.d')) + '</div>';
      h += ecBox('diverging', MOD.map(function (k) {
        return { name: modName(k), d: [Pm.weights()[k] * a.m[k], Pm.weights()[k] * b.m[k]] };
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
      }, { radius: '66%', max: 100 }, 360) + '</div>';
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
          values: ps.map(function (p) { return Pm.weights()[k] * p.m[k]; })
        };
      }), { series: ps.map(function (p, i) { return { name: p.name, color: colors[i] }; }), legend: true }, MOD.length * 30 + 90);
      h += '</div>';
    }

    /* 风格定位散点（所有人） */
    h += '<div class="card reveal"><div class="card-head"><h2>' + esc(t('pk.style')) + '</h2>' + infoTip(t('pk.style.d')) + '</div>';
    const pts = ps.map(function (p, i) {
      const sc = scoreOf(p);
      return [round(sc.career, 1), round(sc.peak, 1), esc(p.name) + ' · ' + U.fmt(sc.overall, 1), sc.overall];
    });
    h += ecBox('scatter', pts, {
      xName: t('rank.tab.career'), yName: t('rank.tab.peak')
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
      '<div class="pk-pscore"><b>' + U.fmt(sc.overall, 1) + '</b><span>' + esc(t('rank.tab.overall')) + '</span></div>';
    h += '</div>';
    h += '<div class="pk-pbars">';
    cs.forEach(function (c) {
      h += '<div class="pk-pbar"><span class="pk-pbk"><i style="background:' + c.color + '"></i>' + esc(c.name) + '</span>' +
        '<span class="pk-pbb"><i style="width:' + Math.min(100, c.v / tot * 100) + '%;background:' + c.color + '"></i></span>' +
        '<span class="pk-pbv">' + U.fmt(c.v, 1) + '</span></div>';
    });
    h += '</div>';
    h += '<div class="pk-keys">';
    [['rank.tab.career', U.fmt(sc.career, 1)], ['rank.tab.peak', U.fmt(sc.peak, 1)], ['col.wr', p.wr],
      ['col.wc', p.wcGold], ['col.elo', p.eloPeak], ['col.months', p.months1],
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
      U.fmt(Math.max(sa.overall, sb.overall), 1) + ' vs ' + U.fmt(Math.min(sa.overall, sb.overall), 1) + '</p>';
    h += '</div>';

    h += '<div class="card reveal"><div class="card-head"><h2>' + esc(t('pk.flip')) + '</h2>' + infoTip(t('pk.flip.d')) + '</div>';
    h += '<div class="flip-list">';
    MOD.forEach(function (k) {
      const dA = a.m[k], dB = b.m[k];
      const dj = (winner === a ? dA - dB : dB - dA);
      let S = 0;
      MOD.forEach(function (kk) { if (kk !== k) S += w[kk] * (winner === a ? a.m[kk] - b.m[kk] : b.m[kk] - a.m[kk]); });
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

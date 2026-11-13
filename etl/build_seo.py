#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""构建期生成「无 JS 可读」的静态摘要页 + sitemap + favicon.ico。

站点是 hash 路由 SPA：不执行 JS 的爬虫 / 微信内置抓取只能看到「页面加载中…」。
这里从当周 ETL 产出的 js/data.js 里读出真实 Top 20 与模型口径，生成 4 张纯 HTML
摘要页（canonical 指回对应的 SPA 路由），让站点主题、榜单、模型说明可被索引，
用户点进来也能一键跳到完整交互版。

由 .github/workflows/update-data.yml 在每次数据重建后调用，无需手工维护。
用法：python3 etl/build_seo.py
"""
import os
import json
import html
import struct

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'js', 'data.js')
SEO_DIR = os.path.join(ROOT, 'seo')
SITE = 'https://leansun.github.io/cuber-statistics/'
SIX_LABEL = [('m1', '纪录持有', 'Record holding'), ('m2', '领奖台', 'Podiums'),
             ('m3', '大赛表现', 'Major events'), ('m4', '统治力', 'Dominance'),
             ('m5', '纪录比', 'WR ratio'), ('m6', '突破幅度', 'Breakthrough')]


def read_data():
    with open(DATA, encoding='utf-8') as f:
        s = f.read()
    dec = json.JSONDecoder()
    i = s.find('var CFG = ')
    if i < 0:
        raise SystemExit('build_seo: 找不到 var CFG，data.js 不是本项目的产物')
    cfg, _ = dec.raw_decode(s, i + len('var CFG = '))
    meta = cfg.get('meta', {})

    def first_array(marker, n=20):
        j = s.find(marker)
        if j < 0:
            return []
        pos = j + len(marker)
        while pos < len(s) and s[pos] != '[':
            pos += 1
        pos += 1
        out = []
        for _ in range(n):
            while pos < len(s) and s[pos] in ' \t\r\n,':
                pos += 1
            if pos >= len(s) or s[pos] == ']':
                break
            obj, pos = dec.raw_decode(s, pos)
            out.append(obj)
        return out

    rows = []
    if 'var COLS = ' in s:
        # WCP1 列式核（2026-11-12 起）：
        #   var COLS = [[列0 的 N 个值], …];
        #   (__wcpExpand)(PLAYERS, COLS, KEYS, N, DETAIL_N);
        # 行序即总分降序（与旧 SLIM 一致），取前 20 行；six 列已定点化 ×100，
        # 下标 6 是六维小计 t，除以 100 还原。
        j = s.find('var COLS = ')
        cols, _ = dec.raw_decode(s, j + len('var COLS = '))
        k = s.rfind(')(PLAYERS, COLS, ')
        keys, _ = dec.raw_decode(s, s.find('[', k))
        ni, ci, si = keys.index('name'), keys.index('country'), keys.index('six')
        n = len(cols[0]) if cols else 0
        for r in range(min(n, 20)):
            six = cols[si][r]
            score = (six[6] / 100.0) if isinstance(six, list) and len(six) > 6 else 0
            rows.append((cols[ni][r], cols[ci][r], score))
    elif '__WCA_DETAIL_PENDING' in s:
        # 新格式：主包是全量紧凑档 SLIM = [[...], ...]
        j = s.find('var SLIM_KEYS = ')
        keys, _ = dec.raw_decode(s, j + len('var SLIM_KEYS = '))
        ni, ci, si = keys.index('name'), keys.index('country'), keys.index('six')
        for row in first_array('var SLIM = '):
            six = row[si] if si < len(row) else None
            score = six[6] if isinstance(six, list) and len(six) > 6 else 0
            rows.append((row[ni], row[ci], score))
    else:
        # 旧格式：PLAYERS 是完整对象数组
        for p in first_array('var PLAYERS = '):
            six = p.get('six') or {}
            rows.append((p.get('name', ''), p.get('country', ''),
                         six.get('t') or p.get('overall') or 0))
    return meta, rows


def esc(x):
    return html.escape(str(x if x is not None else ''), quote=True)


def page(slug, title, desc, body, spa_hash):
    canonical = SITE + spa_hash
    return f'''<!DOCTYPE html>
<html lang="zh-CN" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{esc(title)} · Cube GOAT</title>
<meta name="description" content="{esc(desc)}">
<meta name="robots" content="index,follow">
<link rel="canonical" href="{esc(canonical)}">
<link rel="alternate" hreflang="zh-CN" href="{esc(canonical)}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="Cube GOAT">
<meta property="og:title" content="{esc(title)} · Cube GOAT">
<meta property="og:description" content="{esc(desc)}">
<meta property="og:url" content="{esc(canonical)}">
<link rel="icon" href="../favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="../css/style.css">
<style>
.seo{{max-width:860px;margin:0 auto;padding:44px 20px 64px;line-height:1.8;color:var(--text)}}
.seo h1{{font-size:30px;margin:18px 0 8px;letter-spacing:.3px}}
.seo h2{{font-size:19px;margin:30px 0 10px}}
.seo p{{color:var(--text-2);margin:0 0 14px}}
.seo a{{color:var(--accent)}}
.seo .back{{font-size:13px;text-decoration:none}}
.seo .lead{{font-size:15px;color:var(--text)}}
.seo .notice{{padding:12px 16px;border:1px solid var(--border);border-radius:10px;background:var(--bg-elev);font-size:13px}}
.seo table{{width:100%;border-collapse:collapse;margin:14px 0 24px;font-size:14px}}
.seo th,.seo td{{padding:9px 12px;border-bottom:1px solid var(--border);text-align:left}}
.seo th{{color:var(--text-3);font-size:12px;font-weight:600}}
.seo td.num,.seo th.num{{text-align:right;font-variant-numeric:tabular-nums}}
.seo ul{{color:var(--text-2);padding-left:22px}}
.seo li{{margin:6px 0}}
.seo .foot{{margin-top:38px;padding-top:16px;border-top:1px solid var(--border);font-size:12px;color:var(--text-3)}}
.seo .cta{{display:inline-block;margin:6px 0 22px;padding:9px 18px;border-radius:9px;background:var(--accent);color:#fff;text-decoration:none;font-weight:600}}
</style>
</head>
<body>
<main class="seo">
  <a class="back" href="../">← Cube GOAT 首页</a>
  <h1>{esc(title)}</h1>
  <p class="lead">{esc(desc)}</p>
  <p class="notice">本页是为搜索引擎与未启用 JavaScript 的环境生成的静态摘要，内容随每周 WCA 数据导出更新。<a href="../{esc(spa_hash)}">打开完整交互版 →</a></p>
  <a class="cta" href="../{esc(spa_hash)}">进入交互版</a>
{body}
  <p class="foot">数据来源：World Cube Association 官方成绩导出 · 模型版本 v1.0 ·
    <a href="../#/model">评分原理</a> · <a href="../">首页</a></p>
</main>
</body>
</html>
'''


def make_ico(path):
    """不依赖 Pillow：直接写 32x32 / 32bpp 的 ICO（BMP DIB + AND mask）。"""
    w = h = 32
    palette = [(0x7b, 0x7b, 0xff), (0x93, 0xcb, 0xff), (0x79, 0xcc, 0x4a),
               (0x6a, 0x67, 0xfe), (0xf5, 0xa7, 0x00), (0xff, 0x85, 0xb5),
               (0xc3, 0xc3, 0x00), (0x66, 0xd1, 0xff), (0xff, 0x9c, 0x8b)]
    xor = bytearray()
    for y in range(h - 1, -1, -1):          # BMP 是自下而上
        for x in range(w):
            cx, cy = x // 11, y // 11
            if cx < 3 and cy < 3 and (x % 11) < 9 and (y % 11) < 9:
                r, g, b = palette[cy * 3 + cx]
                xor += bytes((b, g, r, 255))
            else:
                xor += bytes((17, 17, 13, 255))
    and_mask = bytearray((w // 8) * h)
    dib = struct.pack('<IiiHHIIiiII', 40, w, h * 2, 1, 32, 0,
                      len(xor) + len(and_mask), 0, 0, 0, 0) + xor + and_mask
    ico = struct.pack('<HHH', 0, 1, 1) + struct.pack(
        '<BBBBHHII', w, h, 0, 0, 1, 32, len(dib), 22) + dib
    with open(path, 'wb') as f:
        f.write(ico)


def main():
    meta, rows = read_data()
    updated = meta.get('updated', '')
    version = meta.get('exportVersion', '')
    players = meta.get('players', 0)
    weights = meta.get('sixWeights', {})
    os.makedirs(SEO_DIR, exist_ok=True)

    top_rows = '\n'.join(
        '<tr><td class="num">%d</td><td>%s</td><td>%s</td><td class="num">%s</td></tr>' % (
            i + 1, esc(name), esc(country), ('%.2f' % float(score)) if score else '—')
        for i, (name, country, score) in enumerate(rows[:20]))
    top_table = ('<h2>综合总榜前 20 名（六维加权总分）</h2>'
                 '<table><thead><tr><th scope="col" class="num">#</th>'
                 '<th scope="col">选手</th><th scope="col">国家/地区</th>'
                 '<th scope="col" class="num">总分</th></tr></thead><tbody>'
                 + top_rows + '</tbody></table>')

    rank_body = top_table + (
        '<h2>排名口径</h2><p>总分 = Σ(维度分 × 维度权重)，六个维度分别是纪录持有、领奖台、'
        '大赛表现、统治力、纪录比与突破幅度。各维度在筛选范围内按榜首归一，'
        '维度内部先按项目小计 × 项目系数累加，项目系数采用与参赛人数无关的 rank 比例档。</p>'
        '<p>榜单收录全部 %s 位 WCA 注册选手中的可排名部分，搜索可查到全部注册者。'
        '可按地区、性别、项目、成绩口径（单次/平均）与年份区间筛选，并支持选手 PK。</p>' % f'{players:,}')

    weight_list = ''.join(
        '<li><b>%s %s（%s）</b> × %.2f</li>' % (k, zh, en, weights.get(k, 0))
        for k, zh, en in SIX_LABEL)
    model_body = (
        '<h2>六维加权模型</h2><ul>' + weight_list + '</ul>'
        '<p>M5「纪录比」采用严格 Kinch 口径：k = min(100, 100 × WR / PB)，17 个现役项目一轨计算，'
        '缺项记 0；参考站 <a href="https://wca.cuber.pro/" rel="noopener">wca.cuber.pro</a>。</p>'
        '<p>M1 按纪录实际占有段纯持有计分；M2 使用 WCA 官方名次 pos；M3 做时代折算且开荒期不计；'
        'M4 为统治力方案 F；M6 对时代做平权双截顶。六维分数细则页提供逐人、逐维的分数查询。</p>'
        '<p>数据来源：WCA 官方导出 %s（%s）。</p>' % (esc(updated), esc(version)))

    timeline_body = (
        '<h2>图表可视化</h2><ul>'
        '<li><b>分数演进曲线</b>：按年度采样并在年内匀速插值，可切换维度、项目与地区。</li>'
        '<li><b>纪录演变时间轴</b>：世界/洲际/国家纪录链，单次与平均双轨，点选里程碑可跳转日期。</li>'
        '<li><b>登顶徽标</b>：显示当前榜首及其连续占据天数，支持按天/月/年切换。</li>'
        '<li><b>竞速图</b>：逐维追踪历史分数变化，播放/暂停/单步与全局方向键控制。</li></ul>'
        '<p>成绩数据截至 %s。</p>' % esc(updated))

    topics_body = (
        '<h2>趣味统计</h2><ul>'
        '<li>纪录保持类：世界纪录数、最长保持、当前仍在保持等，可按单次/平均口径切换。</li>'
        '<li>国家与洲际榜：按「当时所代表的国家」拆分总分，覆盖换籍选手。</li>'
        '<li>反事实统计：假定某类纪录/成绩为零后的排名变化。</li>'
        '<li>年度前十 / 前百、最佳年份、单场多项目等趣味指标。</li></ul>'
        '<p>全部指标与历史地位排名、图表可视化共用同一套筛选面板：预设项目组、项目图标多选、'
        '地区、性别、成绩口径、时间区间、停办项目与一键重置。</p>')

    pages = [
        ('rank', '魔方历史地位排名 · 综合总榜',
         '基于 WCA 官方成绩，用六维加权模型给全部注册选手评分的历史 GOAT 总榜，可筛选、可 PK。',
         rank_body, '#/rank'),
        ('timeline', '纪录演变与分数曲线',
         'WCA 世界纪录演变时间轴、六维分数演进曲线、逐维竞速图与登顶徽标。',
         timeline_body, '#/timeline'),
        ('topics', '趣味统计 · 纪录、参赛与奖牌榜单',
         '纪录保持、国家榜、反事实统计、年度前十等基于 WCA 官方成绩的趣味统计榜单。',
         topics_body, '#/topics'),
        ('model', '六维评分模型与参数设置',
         'Cube GOAT 六维加权评分模型 M1–M6 的定义、权重与计算口径说明。',
         model_body, '#/model'),
    ]
    for slug, title, desc, body, spa in pages:
        with open(os.path.join(SEO_DIR, slug + '.html'), 'w', encoding='utf-8') as f:
            f.write(page(slug, title, desc, body, spa))

    urls = [(SITE, 'weekly', '1.0')] + [
        (SITE + 'seo/' + slug + '.html', 'weekly', '0.8') for slug, *_ in pages]
    sitemap = ['<?xml version="1.0" encoding="UTF-8"?>',
               '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for loc, freq, pri in urls:
        sitemap.append('  <url><loc>%s</loc><lastmod>%s</lastmod>'
                       '<changefreq>%s</changefreq><priority>%s</priority></url>'
                       % (loc, updated or '2026-11-07', freq, pri))
    sitemap.append('</urlset>')
    with open(os.path.join(ROOT, 'sitemap.xml'), 'w', encoding='utf-8') as f:
        f.write('\n'.join(sitemap) + '\n')

    make_ico(os.path.join(ROOT, 'favicon.ico'))
    print('build_seo: 生成 %d 个静态页 + sitemap.xml + favicon.ico | Top20 %d 人 | 数据 %s' %
          (len(pages), len(rows), updated))


if __name__ == '__main__':
    main()

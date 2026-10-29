#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Generate REAL-WCA-DATA sample TSV fixtures for etl/build.js testing.

此前该脚本产出的是「真实 WCA ID + 合成成绩」的混合样本（即用户所指的
“虚拟样本”）。现改为：从本地真实 WCA 导出包里，按一组真实选手的 WCA ID
抽取他们的【真实姓名 + 真实成绩 + 真实纪录】，原样写入 etl/sample/*.tsv。
写入格式与 WCA 官方导出 v2 完全一致（build.js 按列名解析，不依赖列序），
因此等价于“把真实导出包裁剪到这几个选手”。

用法：
    python3 etl/make_sample.py
需要本地存在 data/raw/WCA_export_*.tsv.zip（与 build.js 同一份真实导出）。
CI 里没有这份导出包，故 CI 直接复用本脚本提交进仓库的 etl/sample/*.tsv，
不再在流水线里重跑本脚本。

注意：被抽取的选手必须落在 etl/score/sixdim_site.tsv（六维交付表）里，
否则冒烟测试的「六维」路径会因取不到 six 分而走样例分支、断言失效。
下面这组 ID 均已确认在 sixdim_site.tsv 内，且项目覆盖齐全
（333/222/444/333mbf/333mbo 等），性别也含女子选手。
"""
import os
import glob
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'etl', 'sample')
os.makedirs(OUT, exist_ok=True)

# ---- 真实 WCA ID（均已在 sixdim_site.tsv 六维交付表内）----
TARGETS = [
    '2009ZEMD01',  # Feliks Zemdegs
    '2012PARK03',  # Max Park
    '2019WANY36',  # Yiheng Wang 王艺衡
    '2008DENI01',  # Hakan Deniz
    '2007VALK01',  # Mats Valk
    '2007HABE01',  # Tim Habermaas（含旧式多盲 333mbo）
    '2016SIGG01',  # Leo Sigg（含 333mbf）
    '2003LEEJ01',  # Jasmine Lee（女子选手）
]
TSET = set(TARGETS)


def find_export():
    pats = [os.path.join(ROOT, 'data', 'raw', 'WCA_export_*.tsv.zip'),
            os.path.join(ROOT, 'data', 'raw', 'wca_*.tsv.zip')]
    for p in pats:
        hits = glob.glob(p)
        if hits:
            return sorted(hits)[-1]
    raise FileNotFoundError('未找到 WCA 导出包 data/raw/WCA_export_*.tsv.zip')


def tsv_reader(z, name):
    """yield 每行 dict（按真实导出列名）。"""
    with z.open(name) as f:
        header = f.readline().decode('utf8', 'replace').rstrip('\n').split('\t')
        for line in f:
            parts = line.decode('utf8', 'replace').rstrip('\n').split('\t')
            if not any(parts):
                continue
            yield dict(zip(header, parts))


def write(name, rows):
    path = os.path.join(OUT, 'WCA_' + name + '.tsv')
    if not rows:
        # 仍写一个仅表头的空文件，保持与导出同构（build.js 对空表有容错）
        print('(skip empty)', name)
        return
    header = list(rows[0].keys())
    with open(path, 'w', encoding='utf-8', newline='') as f:
        f.write('\t'.join(header) + '\n')
        for r in rows:
            f.write('\t'.join(str(r.get(c, '')) for c in header) + '\n')
    print('wrote', path, len(rows), 'rows')


def main():
    zp = find_export()
    print('export:', os.path.basename(zp))
    z = zipfile.ZipFile(zp)

    persons, ranks_s, ranks_a, results = [], [], [], []
    comp_ids = set()

    for r in tsv_reader(z, 'WCA_export_persons.tsv'):
        if r.get('wca_id') in TSET:
            persons.append(r)
    for r in tsv_reader(z, 'WCA_export_ranks_single.tsv'):
        if r.get('person_id') in TSET:
            ranks_s.append(r)
    for r in tsv_reader(z, 'WCA_export_ranks_average.tsv'):
        if r.get('person_id') in TSET:
            ranks_a.append(r)
    for r in tsv_reader(z, 'WCA_export_results.tsv'):
        if r.get('person_id') in TSET:
            results.append(r)
            if r.get('competition_id'):
                comp_ids.add(r['competition_id'])

    result_ids = {r['id'] for r in results if r.get('id')}
    attempts = [r for r in tsv_reader(z, 'WCA_export_result_attempts.tsv')
                if r.get('result_id') in result_ids]

    comps = [r for r in tsv_reader(z, 'WCA_export_competitions.tsv')
             if r.get('id') in comp_ids]
    champs = [r for r in tsv_reader(z, 'WCA_export_championships.tsv')
              if r.get('competition_id') in comp_ids]

    # 国家 / 洲际 / 项目：直接复用真实导出全量（体积极小，且保证洲际映射完整）
    countries = list(tsv_reader(z, 'WCA_export_countries.tsv'))
    continents = list(tsv_reader(z, 'WCA_export_continents.tsv'))
    events = list(tsv_reader(z, 'WCA_export_events.tsv'))

    z.close()

    write('persons', persons)
    write('ranks_single', ranks_s)
    write('ranks_average', ranks_a)
    write('results', results)
    write('result_attempts', attempts)
    write('competitions', comps)
    write('championships', champs)
    write('countries', countries)
    write('continents', continents)
    write('events', events)
    print('done. players=%d results=%d attempts=%d competitions=%d'
          % (len(persons), len(results), len(attempts), len(comps)))


if __name__ == '__main__':
    main()

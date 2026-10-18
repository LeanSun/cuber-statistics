#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Generate schema-accurate WCA v2 sample TSV fixtures for etl/build.js testing.

Writes WCA_<table>.tsv under etl/sample/. Mirrors the real export v2.0.2
column names (snake_case): persons.wca_id/sub_id, competitions.year/month/day,
results.regional_single_record/regional_average_record, ranks_*.world_rank, etc.
"""
import os

OUT = os.path.join(os.path.dirname(__file__), 'sample')
os.makedirs(OUT, exist_ok=True)


def write(name, header, rows):
    path = os.path.join(OUT, 'WCA_' + name + '.tsv')
    with open(path, 'w', encoding='utf-8', newline='') as f:
        f.write(header + '\n')
        for r in rows:
            f.write('\t'.join(str(x) for x in r) + '\n')
    print('wrote', path, len(rows), 'rows')


# ---- countries ----
write('countries', 'id\tname\tcontinent_id\tiso2',
      [['USA', 'United States', 'North America', 'US'],
       ['CHN', 'China', 'Asia', 'CN'],
       ['NLD', 'Netherlands', 'Europe', 'NL'],
       ['AUS', 'Australia', 'Oceania', 'AU'],
       ['DEU', 'Germany', 'Europe', 'DE']])

# ---- continents ----
write('continents', 'id\tname\trecord_name\tlatitude\tlongitude\tzoom',
      [['North America', 'North America', 'North America Record', 40, -100, 3],
       ['Asia', 'Asia', 'Asian Record', 30, 100, 3],
       ['Europe', 'Europe', 'European Record', 50, 10, 3],
       ['Oceania', 'Oceania', 'Oceanian Record', -25, 135, 4]])

# ---- events ----
write('events', 'id\tname\trank\tformat',
      [['333', '3x3x3 Cube', 1, 'time'],
       ['222', '2x2x2 Cube', 2, 'time'],
       ['333oh', '3x3x3 One-Handed', 3, 'time'],
       ['333bf', '3x3x3 Blindfolded', 4, 'time'],
       ['333fm', '3x3x3 Fewest Moves', 5, 'number'],
       ['333mbf', '3x3x3 Multi-Blind', 6, 'multi'],
       ['333mbo', '3x3x3 Multi-Blind Old Style', 7, 'multi']])

# ---- persons ----
write('persons', 'wca_id\tsub_id\tname\tcountry_id\tgender',
      [['2008FELI01', 1, 'Felix Zemdegs', 'AUS', 'm'],
       ['2013PARK01', 1, 'Max Park', 'USA', 'm'],
       ['2020WANG01', 1, 'Yiheng Wang', 'CHN', 'm'],
       ['2008DENI01', 1, 'Mats Valk', 'NLD', 'm'],
       ['2018ZHAN01', 1, 'Anne Zhang', 'CHN', 'f'],
       ['2007HABA01', 1, 'Tim Habermaas', 'DEU', 'm']])

# ---- competitions ----
write('competitions', 'id\tname\tcountry_id\tyear\tmonth\tday',
      [['WC2023', 'World Championship 2023', 'USA', 2023, 8, 13],
       ['CC2022', 'Asian Championship 2022', 'CHN', 2022, 5, 1],
       ['NAC2021', 'US Nationals 2021', 'USA', 2021, 7, 1],
       ['OP2020', 'Open Holland 2020', 'NLD', 2020, 10, 1],
       ['GO2008', 'German Open 2008', 'DEU', 2008, 4, 19]])

# ---- championships ----
write('championships', 'competition_id\tchampionship_type',
      [['WC2023', 'world'],
       ['CC2022', 'Asia']])

# ---- ranks_single ----
write('ranks_single', 'person_id\tevent_id\tbest\tworld_rank\tcontinent_rank\tcountry_rank',
      [['2013PARK01', '333', 360, 1, 1, 1],
       ['2008FELI01', '333', 350, 2, 1, 1],
       ['2020WANG01', '333', 370, 3, 1, 1],
       ['2008DENI01', '333', 380, 4, 1, 1],
       ['2018ZHAN01', '333', 390, 5, 2, 2],
       ['2013PARK01', '222', 120, 1, 1, 1],
       ['2008FELI01', '222', 130, 2, 1, 1],
       ['2020WANG01', '222', 140, 3, 1, 1],
       ['2008FELI01', '333fm', 22, 1, 1, 1],
       ['2020WANG01', '333fm', 23, 2, 1, 1],
       ['2013PARK01', '333mbf', 590351300, 1, 1, 1],
       ['2008FELI01', '333mbf', 330331203, 2, 1, 1],
       ['2008DENI01', '333mbf', 370359804, 3, 1, 1],
       ['2020WANG01', '333bf', 1400, 1, 1, 1],
       ['2018ZHAN01', '333bf', 1600, 2, 2, 2],
       ['2013PARK01', '333oh', 900, 1, 1, 1],
       ['2008FELI01', '333oh', 950, 2, 1, 1],
       # 旧多盲（旧编码 1SSAATTTTT：1 + (99-解出) + 尝试 + 用时秒数）
       ['2007HABA01', '333mbo', 1930602878, 1, 1, 1],
       ['2013PARK01', '333mbo', 1940503265, 2, 2, 1],
       ['2008DENI01', '333mbo', 1940803789, 3, 1, 2]])

# ---- ranks_average ----
write('ranks_average', 'person_id\tevent_id\tbest\tworld_rank\tcontinent_rank\tcountry_rank',
      [['2008FELI01', '333', 400, 1, 1, 1],
       ['2013PARK01', '333', 410, 2, 1, 1],
       ['2020WANG01', '333', 420, 3, 1, 1],
       ['2008DENI01', '333', 430, 4, 1, 1],
       ['2018ZHAN01', '333', 440, 5, 2, 2],
       ['2013PARK01', '222', 150, 1, 1, 1],
       ['2008FELI01', '222', 160, 2, 1, 1],
       ['2013PARK01', '333oh', 950, 1, 1, 1],
       ['2008FELI01', '333oh', 1000, 2, 1, 1],
       ['2008FELI01', '333fm', 2350, 1, 1, 1],
       ['2020WANG01', '333fm', 2450, 2, 1, 1]])

# ---- results ----
# columns: competition_id event_id person_id round_type_id pos best average
#          regional_single_record regional_average_record
R = []
def res(c, e, p, rt, pos, best, avg, rsr, rar):
    R.append([c, e, p, rt, pos, best, avg, rsr, rar])

# WC2023 (world champ) — finals (round_type_id 'f')
res('WC2023', '333', '2008FELI01', 'f', 1, 350, 400, 'WR', 'WR')
res('WC2023', '333', '2013PARK01', 'f', 2, 360, 410, 'CR', 'CR')
res('WC2023', '333', '2008DENI01', 'f', 3, 380, 430, 'NR', 'NR')
res('WC2023', '222', '2013PARK01', 'f', 1, 120, 150, 'WR', 'WR')
res('WC2023', '222', '2008FELI01', 'f', 2, 130, 160, 'CR', 'CR')
res('WC2023', '333fm', '2008FELI01', 'f', 1, 22, 2350, 'WR', 'WR')
res('WC2023', '333fm', '2020WANG01', 'f', 2, 23, 2450, 'NR', 'NR')
res('WC2023', '333mbf', '2013PARK01', 'f', 1, 590351300, 0, 'WR', '')
res('WC2023', '333mbf', '2008FELI01', 'f', 2, 330331203, 0, 'CR', '')
res('WC2023', '333bf', '2020WANG01', 'f', 1, 1400, 0, 'WR', '')
res('WC2023', '333bf', '2018ZHAN01', 'f', 2, 1600, 0, 'NR', '')

# CC2022 (Asian champ, championship_type Asia -> CC)
res('CC2022', '333', '2020WANG01', 'f', 1, 370, 420, 'CR', 'CR')
res('CC2022', '333', '2018ZHAN01', 'f', 2, 390, 440, 'NR', 'NR')
res('CC2022', '333', '2013PARK01', 'f', 3, 365, 415, '', '')
res('CC2022', '222', '2020WANG01', 'f', 1, 140, 150, 'CR', 'CR')
res('CC2022', '222', '2018ZHAN01', 'f', 2, 150, 160, 'NR', 'NR')

# NAC2021 (US Nationals, not a championship)
res('NAC2021', '333', '2013PARK01', 'f', 1, 355, 405, 'NR', 'NR')  # Max US -> NC
res('NAC2021', '333', '2008FELI01', 'f', 2, 345, 395, 'WR', 'WR')  # Felix AUS -> OP
res('NAC2021', '333oh', '2013PARK01', 'f', 1, 900, 950, 'WR', 'WR')  # NC
res('NAC2021', '333oh', '2008FELI01', 'f', 2, 950, 1000, 'CR', 'CR')  # OP

# OP2020 (Open Holland, not a championship)
res('OP2020', '333', '2008DENI01', 'f', 1, 375, 425, 'NR', 'NR')  # Mats NLD -> NC
res('OP2020', '333', '2018ZHAN01', 'f', 2, 380, 450, '', '')  # Anne CHN -> OP
res('OP2020', '333', '2008FELI01', 'f', 3, 360, 410, 'WR', 'WR')  # OP
res('OP2020', '333mbf', '2008DENI01', 'f', 1, 370359804, 0, 'WR', '')

# GO2008 (German Open, not a championship) — 旧多盲 333mbo（已停办项目）
# 旧编码：1 + (99-解出) + 尝试 + 用时秒数
res('GO2008', '333mbo', '2007HABA01', 'f', 1, 1930602878, 0, 'WR', '')   # 6/6 47:58
res('GO2008', '333mbo', '2013PARK01', 'f', 2, 1940503265, 0, 'CR', '')   # 5/5 54:25
res('GO2008', '333mbo', '2008DENI01', 'f', 3, 1940803789, 0, 'NR', '')   # 5/8 1:03:09

# a non-final round row (should be excluded from podiums)
res('WC2023', '333', '2008FELI01', 's', 1, 360, 0, '', '')

write('results', 'competition_id\tevent_id\tperson_id\tround_type_id\tpos\tbest\taverage\tregional_single_record\tregional_average_record', R)

print('done')

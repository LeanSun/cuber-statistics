# -*- coding: utf-8 -*-
"""生成 js/country-table.js：WCA 国家 → ISO2 / 英文名 / 中文名 / 洲际码。
合并数据源：flag-icons country.json（ISO2 + 洲际）与内置中文名 / 别名表。
用法: python etl/make_country_table.py <wca国家名文件> <country.json> <输出js>
"""
import json
import os
import re
import sys

# WCA 特有的英文名 → flag-icons 名称（或直接在 ALIAS 中给出 ISO2）
NAME_TO_ISO = {
    'united states': 'us', 'usa': 'us', 'united states of america': 'us',
    'united kingdom': 'gb', 'great britain': 'gb',
    'south korea': 'kr', 'republic of korea': 'kr', 'korea': 'kr',
    'north korea': 'kp', "democratic people's republic of korea": 'kp',
    'russia': 'ru', 'russian federation': 'ru',
    'vietnam': 'vn', 'viet nam': 'vn',
    'iran': 'ir', 'iran, islamic republic of': 'ir',
    'syria': 'sy', 'syrian arab republic': 'sy',
    'laos': 'la', "lao people's democratic republic": 'la',
    'bolivia': 'bo',
    'venezuela': 've',
    'tanzania': 'tz', 'tanzania, united republic of': 'tz',
    'moldova': 'md', 'moldova, republic of': 'md',
    'czech republic': 'cz', 'czechia': 'cz',
    'cote d\'ivoire': 'ci', "côte d'ivoire": 'ci', 'ivory coast': 'ci',
    'cape verde': 'cv', 'cabo verde': 'cv',
    'swaziland': 'sz', 'eswatini': 'sz',
    'macedonia': 'mk', 'north macedonia': 'mk',
    'brunei': 'bn', 'brunei darussalam': 'bn',
    'hong kong': 'hk', 'hong kong, china': 'hk',
    'macau': 'mo', 'macao': 'mo',
    'taiwan': 'tw', 'chinese taipei': 'tw',
    'palestine': 'ps', 'palestinian territory': 'ps',
    'congo': 'cg', 'republic of the congo': 'cg',
    'democratic republic of the congo': 'cd', 'dr congo': 'cd', 'congo, the democratic republic of the': 'cd',
    'myanmar': 'mm', 'burma': 'mm',
    'turkey': 'tr', 'türkiye': 'tr',
    'netherlands': 'nl', 'the netherlands': 'nl',
    'multiple countries (xa)': 'xa', 'multiple countries (xe)': 'xe',
    'multiple countries (xf)': 'xf', 'multiple countries (xm)': 'xm',
    'multiple countries (xn)': 'xn', 'multiple countries (xo)': 'xo',
    'multiple countries (xs)': 'xs', 'multiple countries (xw)': 'xw',
    'xa': 'xa', 'xe': 'xe', 'xf': 'xf', 'xm': 'xm', 'xn': 'xn', 'xo': 'xo',
    'xs': 'xs', 'xw': 'xw',
    'vatican city': 'va', 'holy see vatican city state': 'va',
    'democratic people s republic of korea': 'kp',
    'cote d ivoire': 'ci', 'cote divoire': 'ci',
}

# 中文名（ISO2 → 中文）；WCA 常见国家务必齐全
ZH = {
    'ad': '安道尔', 'ae': '阿联酋', 'af': '阿富汗', 'ag': '安提瓜和巴布达', 'al': '阿尔巴尼亚',
    'am': '亚美尼亚', 'ao': '安哥拉', 'ar': '阿根廷', 'at': '奥地利', 'au': '澳大利亚',
    'aw': '阿鲁巴', 'az': '阿塞拜疆', 'ba': '波黑', 'bb': '巴巴多斯', 'bd': '孟加拉国',
    'be': '比利时', 'bf': '布基纳法索', 'bg': '保加利亚', 'bh': '巴林', 'bi': '布隆迪',
    'bj': '贝宁', 'bm': '百慕大', 'bn': '文莱', 'bo': '玻利维亚', 'br': '巴西',
    'bs': '巴哈马', 'bt': '不丹', 'bw': '博茨瓦纳', 'by': '白俄罗斯', 'bz': '伯利兹',
    'ca': '加拿大', 'cd': '刚果（金）', 'cf': '中非', 'cg': '刚果（布）', 'ch': '瑞士',
    'ci': '科特迪瓦', 'cl': '智利', 'cm': '喀麦隆', 'cn': '中国', 'co': '哥伦比亚',
    'cr': '哥斯达黎加', 'cu': '古巴', 'cv': '佛得角', 'cy': '塞浦路斯', 'cz': '捷克',
    'de': '德国', 'dj': '吉布提', 'dk': '丹麦', 'dm': '多米尼克', 'do': '多米尼加',
    'dz': '阿尔及利亚', 'ec': '厄瓜多尔', 'ee': '爱沙尼亚', 'eg': '埃及', 'er': '厄立特里亚',
    'es': '西班牙', 'et': '埃塞俄比亚', 'fi': '芬兰', 'fj': '斐济', 'fo': '法罗群岛',
    'fr': '法国', 'ga': '加蓬', 'gb': '英国', 'gd': '格林纳达', 'ge': '格鲁吉亚',
    'gh': '加纳', 'gi': '直布罗陀', 'gm': '冈比亚', 'gn': '几内亚', 'gq': '赤道几内亚',
    'gr': '希腊', 'gt': '危地马拉', 'gu': '关岛', 'gw': '几内亚比绍', 'gy': '圭亚那',
    'hk': '中国香港', 'hn': '洪都拉斯', 'hr': '克罗地亚', 'ht': '海地', 'hu': '匈牙利',
    'id': '印度尼西亚', 'ie': '爱尔兰', 'il': '以色列', 'in': '印度', 'iq': '伊拉克',
    'ir': '伊朗', 'is': '冰岛', 'it': '意大利', 'jm': '牙买加', 'jo': '约旦', 'jp': '日本',
    'ke': '肯尼亚', 'kg': '吉尔吉斯斯坦', 'kh': '柬埔寨', 'ki': '基里巴斯', 'km': '科摩罗',
    'kn': '圣基茨和尼维斯', 'kp': '朝鲜', 'kr': '韩国', 'kw': '科威特', 'ky': '开曼群岛',
    'kz': '哈萨克斯坦', 'la': '老挝', 'lb': '黎巴嫩', 'lc': '圣卢西亚', 'li': '列支敦士登',
    'lk': '斯里兰卡', 'lr': '利比里亚', 'ls': '莱索托', 'lt': '立陶宛', 'lu': '卢森堡',
    'lv': '拉脱维亚', 'ly': '利比亚', 'ma': '摩洛哥', 'mc': '摩纳哥', 'md': '摩尔多瓦',
    'me': '黑山', 'mg': '马达加斯加', 'mh': '马绍尔群岛', 'mk': '北马其顿', 'ml': '马里',
    'mm': '缅甸', 'mn': '蒙古', 'mo': '中国澳门', 'mr': '毛里塔尼亚', 'mt': '马耳他',
    'mu': '毛里求斯', 'mv': '马尔代夫', 'mw': '马拉维', 'mx': '墨西哥', 'my': '马来西亚',
    'mz': '莫桑比克', 'na': '纳米比亚', 'ne': '尼日尔', 'ng': '尼日利亚', 'ni': '尼加拉瓜',
    'nl': '荷兰', 'no': '挪威', 'np': '尼泊尔', 'nr': '瑙鲁', 'nz': '新西兰', 'om': '阿曼',
    'pa': '巴拿马', 'pe': '秘鲁', 'pg': '巴布亚新几内亚', 'ph': '菲律宾', 'pk': '巴基斯坦',
    'pl': '波兰', 'ps': '巴勒斯坦', 'pt': '葡萄牙', 'pw': '帕劳', 'py': '巴拉圭',
    'qa': '卡塔尔', 'ro': '罗马尼亚', 'rs': '塞尔维亚', 'ru': '俄罗斯', 'rw': '卢旺达',
    'sa': '沙特阿拉伯', 'sb': '所罗门群岛', 'sc': '塞舌尔', 'sd': '苏丹', 'se': '瑞典',
    'sg': '新加坡', 'si': '斯洛文尼亚', 'sk': '斯洛伐克', 'sl': '塞拉利昂', 'sm': '圣马力诺',
    'sn': '塞内加尔', 'so': '索马里', 'sr': '苏里南', 'ss': '南苏丹', 'st': '圣多美和普林西比',
    'sv': '萨尔瓦多', 'sy': '叙利亚', 'sz': '斯威士兰', 'td': '乍得', 'tg': '多哥',
    'th': '泰国', 'tj': '塔吉克斯坦', 'tm': '土库曼斯坦', 'tn': '突尼斯', 'to': '汤加',
    'tr': '土耳其', 'tt': '特立尼达和多巴哥', 'tv': '图瓦卢', 'tw': '中国台湾', 'tz': '坦桑尼亚',
    'ua': '乌克兰', 'ug': '乌干达', 'us': '美国', 'uy': '乌拉圭', 'uz': '乌兹别克斯坦',
    'va': '梵蒂冈', 'vc': '圣文森特和格林纳丁斯', 've': '委内瑞拉', 'vn': '越南',
    'vu': '瓦努阿图', 'ws': '萨摩亚', 'xa': '多国（亚洲）', 'xe': '多国（欧洲）',
    'xf': '多国（非洲）', 'xm': '多国（美洲）', 'xn': '多国（大洋洲）', 'xo': '多国（其他）',
    'xs': '多国（南美）', 'xw': '多国（世界）', 'ye': '也门', 'za': '南非', 'zm': '赞比亚',
    'zw': '津巴布韦', 'xk': '科索沃', 'gg': '根西岛', 'je': '泽西岛', 'im': '马恩岛',
    'gf': '法属圭亚那', 'gp': '瓜德罗普', 'mq': '马提尼克', 're': '留尼汪', 'yt': '马约特',
    'nc': '新喀里多尼亚', 'pf': '法属波利尼西亚', 'wf': '瓦利斯和富图纳', 'tk': '托克劳',
    'nu': '纽埃', 'ck': '库克群岛', 'tv_': '', 'tl': '东帝汶', 'fj_': '', 'sh': '圣赫勒拿',
    'fk': '福克兰群岛', 'gi_': '', 'ms': '蒙特塞拉特', 'ai': '安圭拉', 'vg': '英属维尔京群岛',
    'vi': '美属维尔京群岛', 'pr': '波多黎各', 'cw': '库拉索', 'sx': '荷属圣马丁', 'bq': '荷兰加勒比区',
    'bl': '圣巴泰勒米', 'mf': '法属圣马丁', 'pm': '圣皮埃尔和密克隆', 'sx_': '', 'eh': '西撒哈拉',
    'tf': '法属南部领地', 'gs': '南乔治亚', 'hm': '赫德岛', 'bv': '布韦岛', 'sj': '斯瓦尔巴',
    'um': '美国本土外小岛', 'io': '英属印度洋领地', 'cc': '科科斯群岛', 'cx': '圣诞岛',
    'nf': '诺福克岛', 'pn': '皮特凯恩', 'ac': '阿森松岛', 'ta': '特里斯坦达库尼亚',
}

CONT_OF = {
    'Asia': 'As', 'Europe': 'Eu', 'North America': 'NAm', 'South America': 'SAm',
    'Oceania': 'Oc', 'Africa': 'Af', 'Antarctica': 'Oc'
}


def norm(s):
    s = s.lower().strip()
    s = s.replace('&', 'and')
    s = re.sub(r'[^a-z0-9]+', ' ', s).strip()
    return s


def main():
    wca = [l.strip() for l in open(sys.argv[1], encoding='utf-8') if l.strip()]
    fi = json.load(open(sys.argv[2], encoding='utf-8'))
    out = sys.argv[3]

    by_name = {}
    for c in fi:
        by_name[norm(c['name'])] = c

    rows = []
    unmatched = []
    for name in wca:
        n = norm(name)
        iso = NAME_TO_ISO.get(n)
        cont = ''
        en = name
        if not iso and n in by_name:
            iso = by_name[n]['code']
            cont = CONT_OF.get(by_name[n].get('continent', ''), '')
        if not iso:
            # 去掉括号后缀再试
            n2 = re.sub(r'\(.*?\)', '', n).strip()
            if n2 in by_name:
                iso = by_name[n2]['code']
                cont = CONT_OF.get(by_name[n2].get('continent', ''), '')
            else:
                iso = NAME_TO_ISO.get(n2)
        if not iso:
            unmatched.append(name)
            continue
        zh = ZH.get(iso) or name
        rows.append((iso.upper(), en, zh, cont))

    rows.sort(key=lambda r: r[0])
    lines = []
    lines.append('/* AUTO-GENERATED by etl/make_country_table.js — WCA 国家 → ISO2 / 中英文名 / 洲际 */')
    lines.append('/* 结构: { ISO2: [英文名, 中文名, 洲际码] }；洲际码见 Calc.CONTINENTS */')
    lines.append('(function (root) {')
    lines.append('  var T = {')
    for iso, en, zh, cont in rows:
        lines.append('    %s: [%s, %s, %s],' % (iso, json.dumps(en, ensure_ascii=False),
                                                json.dumps(zh, ensure_ascii=False),
                                                json.dumps(cont, ensure_ascii=False)))
    lines.append('  };')
    lines.append('  if (typeof module !== "undefined" && module.exports) module.exports = T;')
    lines.append('  if (root) root.COUNTRY_TABLE = T;')
    lines.append('})(typeof window !== "undefined" ? window : null);')
    with open(out, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines) + '\n')
    print('written %s: %d countries' % (out, len(rows)))
    if unmatched:
        print('UNMATCHED (%d): %s' % (len(unmatched), ' | '.join(unmatched)))


main()

# WCA 大洋洲锦标赛（Oceania Championship）清点

> 结论先行：**共 3 届**（2022 / 2024 / 2026），其中**已举办 2 届**；WCA 官方数据里对应 **4 条**记录。
> 查证日期：2026-10-25　数据源：`data/raw/WCA_export_v2_288_20261015T000017Z.tsv.zip`（export_format v2.0.2，export_date 2026-10-15）

---

## 1. 判定口径

WCA 用 `championships.tsv` 的 `championship_type` 标记赛事级别，取值三类：

| 类型 | 含义 | 例 |
|---|---|---|
| `world` | 世界锦标赛 | WC1982…WC2025 |
| `_Oceania` / `_Europe` / `_Asia` / `_Africa` / `_North America` / `_South America` | **洲际锦标赛** | OC2022、Euro2024 |
| `AU` / `NZ` / `US` / `SE`…（ISO2） | 国家级锦标赛 | Australian Championships |
| `greater_china` | 大中华区（另议） | — |

判定「大洋洲锦标赛」= `championship_type == '_Oceania'`，共 **4 条**：

| # | id | competition_id | 名称 | 举办地 | 日期 | 状态 |
|---|---|---|---|---|---|---|
| 1 | 539 | OC2022 | Rubik's WCA Oceanic Championship 2022 | 墨尔本，澳大利亚 | 2022-12-15 ~ 12-18 | 已举办 |
| 2 | 745 | OC2024 | Rubik's WCA Oceanic Championship 2024 | 珀斯，澳大利亚 | 2024-12-19 ~ 12-22 | 已举办 |
| 3 | 825 | OCFMC2024 | Rubik's WCA Oceanic Championship FMC 2024 | 多场地，`country_id=XO` | 2024-12-07 | 已举办（同届专项赛） |
| 4 | 970 | OC2026 | GAN WCA Oceanic Championship 2026 | 奥克兰，新西兰 | 2026-12-10 ~ 12-13 | **尚未举办** |

**为什么是 3 届而不是 4 场**：`OCFMC2024` 是 OC2024 同届的 FMC（最少步）专项赛，
WCA 把 FMC 拆成独立 competition 记录（南美的 `SACFMC2024`、`FMCSAC2026`，
非洲的 `WCAAfricanFMCChampionship2026` 同理），但它们属同一届。
故 **独立届数 = 3**，官方记录条数 = 4。

---

## 2. 参赛规模（从 results.tsv 实算）

| 赛事 | 参赛人数（去重） | 国家数 | 项目数 | 成绩行数 | 备注 |
|---|---|---|---|---|---|
| OC2022 | **652** | 21 | 17 | 4,033 | 含 333fm；三阶冠军 Leo Borromeo 6.05 s |
| OC2024 | **292** | 19 | 16 | 2,769 | 三阶冠军 Dwyane Ramos 6.57 s |
| OCFMC2024 | 70 | 7 | 1 | 70 | 仅 333fm，多场地同步开赛 |
| OC2026 | 0 | 0 | 0 | 0 | 未开赛 |

官网交叉验证一致：wca.world/competitions/OC2022 显示「Competitors 652」，
/OC2024 显示「Competitors 292」。

**OC2022 各项目人数**：333 626 / 222 542 / pyram 402 / 444 311 / skewb 281 / 333oh 263 / 555 195 / minx 158 / sq1 134 / 666 128 / 777 103 / 333bf 70 / clock 54 / 333fm 35 / 444bf 19 / 333mbf 17 / 555bf 13

---

## 3. 横向对比：六大洲际锦标赛

| 洲 | 届数 | 首届 | 最近一届 | 官方记录条数（含 FMC 专项赛） |
|---|---|---|---|---|
| 欧洲 `_Europe` | 12 | 2004 | 2026 | 12 |
| 亚洲 `_Asia` | 7 | 2010 | 2024 | 7 |
| 南美洲 `_South America` | 5 | 2013 | 2026 | 7（+2 FMC） |
| 北美洲 `_North America` | 4 | 2020 | 2026 | 4 |
| 非洲 `_Africa` | 3 | 2022 | 2026 | 4（+1 FMC） |
| **大洋洲 `_Oceania`** | **3** | **2022** | **2026** | **4（+1 FMC）** |

**大洋洲是六大洲际锦标赛中最新设立、届数并列最少的**（与非洲同为 2022 年首届）。

### 别混淆：国家级锦标赛 ≠ 大洋洲锦标赛

大洋洲国家自己的国家级锦标赛另有 **43 届**（澳大利亚 21、新西兰 19、萨摩亚 1、汤加 1、斐济 1），
另有各州级（ACT / NSW / NT / QLD / SA / TAS / VIC / WA）与新西兰南北岛级赛事。
这些在 `championship_type` 里写的是国家码 `AU` / `NZ`，属 NC 级别，不是洲际锦标赛。

另外 `Oceania 10th Anniversary 2019`（新西兰，77 人 / 9 国）是纪念 WCA 入洋洲十周年的地方赛，
未获 `_Oceania` 标记，**不算洲际锦标赛**。

---

## 4. 与本项目 M2 的关系（已核对，无需改动）

- `_Oceania` 命中 `etl/score/m2.js` 的 `isContinentalType()`（首字符 `_`）→ tier = **CC**，
  scope = 该洲（Oceania → `OcR`），属地玩家池按全洲统计 ✅
- `OCFMC2024` 的 `country_id = XO` → 命中 `isMultiRegion()`（`/^X[A-Z]$/`）→
  **归 M3，不进 M2** ✅（与 FMCEurope2026、SACFMC2024 同一套判据，无需特判）
- `OC2026` 尚未开赛，results.tsv 中 0 条，M2 现算中自然缺席 ✅
- `build.js` 的 `streamTsv('championships')` 把非 `world` 全归 `champCC`，
  故 OC 三条（含 FMC）都会进洲际集合 —— 但 tier 细分由 m2.js 的 `tierOf()` 判定，两者分工不同，勿混淆

---

## 5. 复现提示（坑）

WCA TSV 的 quoted 字段内可能含 `|`、引号、逗号等字符：

- ❌ `awk -F'\t'` / `grep` 直接切行取字段 —— **会错位**。本次 `grep -i "oceania"` 只命中 1 行，
  `awk '$1=="OC2022"{print $2}'` 拿到空串。
- ✅ 用**引号感知解析**：Python `csv.reader(f, delimiter='\t', quotechar='"', doublequote=True)`
  可靠（competitions 18,912 行 / championships 955 行）。
- ✅ 大文件不落盘：`unzip -p <zip> WCA_export_results.tsv | python script.py` 流式处理。

---

## 6. 参考链接

- https://www.worldcubeassociation.org/competitions/OC2022
- https://www.worldcubeassociation.org/competitions/OC2024
- https://www.worldcubeassociation.org/competitions/OCFMC2024
- https://www.worldcubeassociation.org/competitions/OC2026

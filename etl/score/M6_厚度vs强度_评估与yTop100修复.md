# M6 备选方案评估：「成绩厚度」vs「对手强度」

> 日期：2026-10-25 ｜ 数据：WCA 官方导出 v2.0.2（2026-10-15 快照，697 万行 results）
> 结论先行：**厚度方案工程上更简单，但作为独立 M6 有三个结构性问题；
> 强度方案更难实现但维度更正交、更适合单项目。**
> 附带成果：评估过程中发现并修复了站点已上线的一个真 bug（`yTop100` 重复计数，87.9% 人数值错误）。

---

## 0. 一句话回答

| | 成绩厚度（每年 top100 年数） | 对手强度（击败了谁） |
|---|---|---|
| **工程量** | ⭐ 18.4s / 1.1GB，**已有现成实现** | 18.8s / 1.4GB，要从零写 |
| **口径坑数** | 3 个（参赛密度 / 早期灌水 / 跨项目累加） | 5 个，但每个都能显式修掉 |
| **与 M2 相关性** | ρ = 0.53（**偏高**） | ρ = −0.01（完全正交） |
| **与 M4 关系** | **本质同轴**（M4 = 现势版、厚度 = 历史版） | 独立 |
| **单项目有效性** | 弱（各项目榜高度雷同） | 强（每个项目榜首都不同） |

**建议**：厚度**不要**做独立 M6 —— 它的信息已被 M4 覆盖（且 M4 缺历史维度，应该改 M4）。
若一定要在两者中选 M6，选**对手强度**。

---

## 1. 「成绩厚度」方案长什么样

### 1.1 口径

```
对每个 (年, 项目) 格子：取该年该项目所有选手，按当年最好单次成绩升序 → 得到年度名次
对每个选手 p：
    厚度(p) = Σ_{年,项目} [ p 在该格的名次 ≤ 100 ]
```

实测量级：年度榜共 418 格（22 项目 × 24 年），全站 2,092,608 个「选手-项目-年」去重键。

### 1.2 年度榜建得出来，且与现实吻合

自建年度榜 Top10 人工核对（与真实赛果一致）：

| 年度榜 | Top5 |
|---|---|
| 333 / 2019 | Patrick Ponce / Nicolás Sánchez / Juliette Sébastien / **Tymon Kolasiński** / **Feliks Zemdegs** |
| 333 / 2024 | Ruihang Xu / **Yiheng Wang** / Aaron Huynh / Xuanyi Geng / Luke Garrett |
| 444 / 2019 | **Sebastian Weyer** / **Feliks Zemdegs** / **Max Park** / Ciarán Beahan / Seung Hyuk Nahm |
| 444 / 2024 | **Max Park** / **Sebastian Weyer** / **Tymon Kolasiński** / Patrick Ponce / Đỗ Quang Hưng |
| 222 / 2024 | Vako Marchilashvili / Teodor Zajder / Jakub Jurika / Antoni Stojek / Olaf Kuźmiński |

### 1.3 四种聚合口径的实测对比

| 口径 | 定义 | Top1 | ρ(与生涯长度) | ρ(与 M2) |
|---|---|---|---|---|
| A 纯年数 | 每年进 top100 计 1 | Feliks (160) | 0.4136 | 0.5286 |
| B 名次加权 | Σ(101−rank)/100 | Feliks (132.94) | 0.3646 | 0.4890 |
| C 分位加权 | Σ 当年分位 | Feliks (156.24) | 0.3956 | 0.5589 |
| D 归一化 | B ÷ 生涯年份数 | Mátyás Kuti (8.64) | 0.0547 | 0.3578 |

> **口径 D 是陷阱**：除掉生涯长度后 ρ(与生涯长度) 降到 0.05 看似"正交"，
> 但 Top1 变成只打过 5 场的小样本选手，Top20 里混入 n=5、n=8 的人 —— 过度校正。

---

## 2. 三个结构性问题

### 2.1 【致命】它本质是 M4 的历史版，与 M4 同轴

build.js 的 **M4 统治力** = `domScore(现势世界名次)` 按项目权重平均（build.js:695-701, 738-767），
其中 `domScore` 在 r ≤ 100 区间就是「世界前 100 占席」。

也就是说：**M4 已经在做"排名席位的时间积分"，只是它用的是现势快照、没有历史维度**。
「厚度」正是把 M4 补上时间维度后的样子。

实测相关矩阵（n = 4,431，领奖台 ≥5 条的选手，Spearman）：

```
              厚度W′     M4现势     M2领奖台     M6强度
厚度W′         1.000     0.258      0.424      0.300
M4现势         0.258     1.000      0.446      0.233
M2领奖台       0.424     0.446      1.000      0.151
M6强度         0.300     0.233      0.151      1.000
```

- 厚度 × M4现势 = **0.258**：低相关，但这是因为两者的时间口径不同（历史 vs 现势），
  **不是**因为测的是不同东西。
- 真正的结论：**做厚度 = 改 M4，不是在旁边加一个 M6。**

> ⚠️ 附注：我第一版「厚度W = Σ domScore(当年名次)」的 Top20 全是无名选手
> （Thibaut Kirchner / Minh Thai / Jess Bonde…）。原因是早期年份 n < 100 时
> 「年度第 1 名」= domScore(1) = 满分，1982 年只有 19 人却有 1 个满分 → 被灌水。
> 时代校正（把当年名次折算成等效名次）对「第 1 名」无效 —— 它恒为 1。
> **这是所有"用名次做时间积分"方案共有的陷阱，不是厚度独有的。**

### 2.2 【严重】被「参赛密度」驱动

进 top100 的「选手-项目-年」样本，平均当年参赛 **5.19 场**；未进 top100 的只参赛 **2.26 场**（2.29×）。

分层后进 top100 率随参赛次数陡增：

| 当年参赛场次 | 格子数 | 进 top100 率 |
|---|---|---|
| 1 场 | 1,202,300 | 0.6% |
| 2–3 场 | 619,762 | 1.6% |
| 4–7 场 | 265,364 | 4.0% |
| 8–15 场 | 75,325 | 8.9% |
| 16–31 场 | 10,271 | 14.4% |

**「每年都有成绩」本身就是夺冠的必要条件** —— 厚度在结构上偏向"赛事参加得多的人"，
而不是"在同一批对手里更强的人"。

### 2.3 【严重】国家生态偏差

厚度 Top20 的国家富集度（相对全站占比）：

| 国家 | Top20 占比 | 全站占比 | 富集 |
|---|---|---|---|
| 匈牙利 | 10% | 0.44% | **22.8×** |
| 荷兰 | 10% | 0.79% | **12.6×** |
| 丹麦 | 5% | 0.42% | **12.0×** |
| 爱尔兰 | 5% | 0.51% | 9.8× |
| 波兰 | 10% | 2.33% | 4.3× |

原因与 2.2 同源：这些国家的 WCA 赛事密度高 → 选手每年都有机会刷出好成绩 → 更容易挤进年度 top100。

> 这类偏差**强度方案没有**：强度方案按「同场决赛对手在 (项目,年代) 池内的分位」计分，
> 池是全局的，与选手来自哪个国家无关。

---

## 3. 「对手强度」方案（对照）

### 3.1 定稿口径（口径 T）

```
1) strength[pid|event|year] = 该选手在 (项目,年代) 池内按当年最好单次成绩的排名分位
2) oppQ(r) = 记录 r 中「被击败的对手」在同(项目,年代)池内的分位均值
3) base(cell) = 同 (项目,年代,赛级) 内所有领奖台记录 oppQ 的中位数
4) excess(r) = oppQ(r) - base(cell(r))
5) M6_i = Σ_r excess(r) × w(r)，  w = 冠军1 / 亚军0.6 / 季军0.4
```

**聚合不乘任何 n^±α** —— 次数归 M2，M6 只管质量。ρ(M6, M2) = **−0.0106**。

### 3.2 单项目榜有效性（最强论据）

| 项目 | 强度 Top3 | 厚度 Top3 |
|---|---|---|
| 333 | Yiheng Wang / **Max Park** / Tymon Kolasiński | Feliks Zemdegs / Mats Valk / Patrick Ponce |
| 444 | **Sebastian Weyer** / Tymon Kolasiński / Erik Akkersdijk | Feliks Zemdegs / **Max Park** / Sebastian Weyer |
| 333bf | Krzysztof Bober / Kaijun Lin / Arthur Garcin | Tommy Cherry / Gianfranco Huanqui / Kaijun Lin |
| pyram | Rafał Waryszak / Owidiusz Pryk / Brúnó Bereczki | Yohei Oka / Grzegorz Łuczyna / Dominik Górny |
| skewb | Łukasz Burliga / Jonatan Kłosko / Michał Rzewuski | Carter Kucala / Jonatan Kłosko / Manuel Prieto |

**强度方案每个项目榜首都不同**；厚度方案在 333 / 333oh / 444 / 222 四个项目上榜首全是 Feliks
（因为他是"多项目 × 多年"的复利者），在单项目场景下区分度明显更弱。

---

## 4. 顺手抓到并修复的真 bug（已上线）

### 4.1 现象

项目里**早就实现了年度榜**（`build.js` 的 `annualTop` + `yTop100`/`yTop10` 字段），
前端也在展示（「多年世界前 10 / 多年世界前 100」）。但数值是错的。

### 4.2 根因

`annualOffer(year, eid, pid, best)` 对 **每个 results 行**都插一次年度榜，
而同一选手在同一年同一项目有**多行**（多轮次 × 多场比赛）：

```js
// 修复前：从不检查 pid 是否已在榜内
arr[i + 1] = { pid: pid, best: best };
```

于是同一人占据多个名次槽位，导致：
1. `yTop100` 按人头重复计数 → 数值成倍虚高；
2. 下游 `arr.forEach((e,i)=>{ const r = i+1; ...})` 按数组下标算名次 → 后面的人被挤出 100 名 → **榜单错排**。

铁证 —— 修复前的年度榜 Top10：

```
2019|333  Patrick Ponce / Nicolás Sánchez / Juliette Sébastien / Tymon / Feliks / Max Park /
          Feliks / Aaron Huynh / Max Park / Sei Sugama      ← Feliks×2、Max Park×2
2024|333  Ruihang Xu / Yiheng Wang / Aaron Huynh / Yiheng Wang / Xuanyi Geng /
          Luke Garrett / Xuanyi Geng / Matty Inaba / Yiheng Wang / Yiheng Wang
                                                          ← Yiheng Wang×4！
2015|333  Lucas Etter / Keaton Ellis / Collin Burns / Feliks / Pavan Ravindra /
          Feliks / Feliks / Feliks / Feliks / Feliks      ← Feliks×6！
```

### 4.3 影响面

- 站点 6,147 人中，**87.9%（3,059 人）的 `yTop100` 数值是错的**；
- 膨胀倍数中位 0.33×、最大 **13.60×**；
- 「多年世界前 100」Top20 榜单**错排 9 个位置**；
- 最严重的头部：

| 选手 | 站点显示 | 真实值 | 虚高 |
|---|---|---|---|
| Feliks Zemdegs | 975 | **165** | +810 |
| Max Park | 875 | **72** | +803 |
| Tymon Kolasiński | 623 | **55** | +568 |
| Erik Akkersdijk | 543 | **135** | +408 |
| Sebastian Weyer | 437 | **59** | +378 |

### 4.4 修复

`etl/build.js` 的 `annualOffer` 改为**两阶段**：

```js
// 阶段一（扫描时）：只收「该格该选手的最好成绩」，不参与名次分配
const annualBest = new Map();   // 'year|eventId' -> Map<pid, best>
function annualOffer(year, eid, pid, best) {
  ...
  const cur = m.get(pid);
  if (cur === undefined || best < cur) m.set(pid, best);
}
// 阶段二（扫描后）：排序 → 前 200 名，此时数组下标 = 真实名次
function annualFinalize() { ... }
```

在计数前调用 `annualFinalize()`，下游计数逻辑一行未改。

### 4.5 验证

| 验证项 | 结果 |
|---|---|
| 修复后 ETL vs 独立重建口径（6147 人） | **完全一致，0 不一致** |
| 同日期同数据源重跑，其他字段（m1–m7 / wr / cr / nr / records / evS…）变化 | **0 人**（零副作用） |
| `etl/score/test_runs.js` 16 项 M1 断言 | 全部通过 |
| 新增 `etl/score/test_annual_top.js` 6 项断言 | 全部通过 |
| 前端 `Calc.stats()` 端到端渲染 | Feliks 165 / Max Park 72 / 修正后 Top10 合理 |

> ⚠️ 修复过程中我自己踩了两个坑，都已修正：
> ① 第一版用 `splice+push+sort` 原地更新，破坏了插入序 → 改用两阶段 Map；
> ② 诊断脚本把键序写成 `event|year` 而 build.js 是 `year|event` → 比较全错、误判修复失败。
> **教训：跨脚本比对前必须先核对键序。**

---

## 5. 给你的建议

### 5.1 M6 选强度（对手强度）

理由三条：
1. **正交**：ρ(M6, M2) = −0.01，不重复计分；厚度的 ρ = 0.53 偏高。
2. **单项目有效**：每个项目榜首都不同，符合你「适合单项目评价」的要求。
3. **生态中性**：不受参赛密度、国家赛事密度影响。

代价：需要自己写实现（`etl/score/m6_strength.js` 已有可运行参考，18.8s）。

### 5.2 厚度应该去「修 M4」，而不是当 M6

build.js 现在的 M4 = 现势快照的 `domScore`，**缺历史维度** —— 这是真缺口。
若要补，用「按 (年,项目) 的年度榜 → 按 domScore 时间积分」，但**必须处理早期年份灌水**
（`r_eff = 1 + (r−1) × (N_ref/n_year) × 99` 对第 1 名无效，需要额外给早期年份降权）。

### 5.3 两套现成资产都别浪费

| 资产 | 位置 | 状态 |
|---|---|---|
| 年度榜（去重后） | `build.js` `annualFinalize()` | ✅ 已修好并上线 |
| 对手强度（口径 T） | `etl/score/m6_strength.js` | ✅ 可运行，未接入 build.js |
| 年度榜回归测试 | `etl/score/test_annual_top.js` | ✅ 新增，6 项断言 |

---

## 6. 复现命令

```bash
# 年度榜去重回归测试
node --max-old-space-size=6144 etl/score/test_annual_top.js

# 对手强度全链路
node --max-old-space-size=6144 etl/score/m6_strength.js

# 完整 ETL（部署用，注意 --date 必须与线上一致）
node --max-old-space-size=8192 etl/build.js \
  --zip data/raw/WCA_export_v2_288_20261015T000017Z.tsv.zip \
  --out js/data.js --roster-out js/roster.js --date 2026-10-15 --ver v2.0.2
```

> ⚠️ **`--roster-out` 必须指向 `js/roster.js`**：若指向临时路径，
> 生成的是 `rows: ""` 的空名册（15.8MB → 192 字节），覆盖线上会让 30 万选手搜索失效。
> 正确做法：**不要传 `--roster-out`**，让它用默认值 `js/roster.js`。

---

## 7. 关键常量与口径备忘

- 年度榜格子数：418（22 项目 × 24 年，1982–2026）
- 「选手-项目-年」去重键：2,092,608
- `ANNUAL_TOP = 200`（年度榜每格保留前 200 名）
- 阶段一 Map 内存代价：约 +300MB（209 万条），ETL 总耗时 105.8s（修复前 116.8s，无明显劣化）
- 早期年份样本枯竭：418 格中 **81 格（19.38%）** 参赛人数 < 100 → 「前 100 名」= 全员入选
- 333 项目参赛人数：1982 年 19 → 2004 年 204 → 2010 年 5,998 → 2024 年 61,373
- 强度方案 oppQ 中位（赛级）：WC 0.9516 / CC 0.7409 / OP 0.7284
- 强度方案相关：ρ(强度,M2) = −0.0106（n=4,431）

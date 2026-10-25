# ETL · WCA 官方导出 → `js/data.js`

本目录把 **WCA 官方成绩导出（v2.0.2，snake_case）** 解析、注入六维分数，
并产出与 `js/mock.js` 完全兼容的 `window.MOCK` 对象，写入 `js/data.js`。

六维分数由 `etl/score/` 下的各维脚本离线算出，统一引擎为 `etl/score/sixdim.js`，
最终交付表是 `etl/score/sixdim_site.tsv`（已随仓库入库）：
`pid / s1…s6 / t`，`build.js` 直接读取并写入每位选手的 `p.six`。
**该文件缺失时全站总分为 0，不会静默回退旧模型。**

页面代码（`js/pages-*.js` / `js/app.js`）完全不感知数据来源：
存在 `js/data.js` 则用真实数据（隐藏演示横幅），否则回退到 `js/mock.js` 演示数据。

## 用法

```bash
# 从已解压目录（含 WCA_*.tsv）生成
node etl/build.js --dir /path/to/extracted --out js/data.js

# 从官方 tsv.zip 生成（脚本内部用 unzip -p 流式读取，无需解压）
node etl/build.js --zip WCA_export_v2_*.tsv.zip --out js/data.js

# 六维分数（产出 etl/score/sixdim_site.tsv，build.js 依赖）
node etl/score/sixdim.js --out etl/score/sixdim_site.tsv

# 控制 data.js 体积：带明细的选手数 / 写进 data.js 的选手数
node etl/build.js --zip WCA_export_v2_*.tsv.zip --out js/data.js --detail-max 2500 --slim-max 60000

# 自定义导出日期 / 版本号（写入 meta，用于页面版权声明）
node etl/build.js --dir ./sample --out /tmp/data.js --date 2026-10-18 --ver v2.0.2
```

零依赖（仅用 Node 内置 + 系统 `unzip`）。`js/calc.js` 是被浏览器与 ETL 共享的评分/聚合层。

## 六维数据流（当前模型）

0. `etl/score/`（离线，模型真源）：
   `m1_hold.js` 纪录持有 · `m2m3_balance.js` 领奖台 · `m3_record_bonus.js` 大赛破纪录 ·
   `m4_dominance.js` 统治力 · `m5_current_rank.js` 当前排名 · `m6_lead.js` 突破幅度；
   `sixdim.js` 统一查询引擎负责轨道 / 项目 / as-of / 性别筛选与加权合成，
   产出 `sixdim_site.tsv`（站点用）与 `js/sixdim_data.js`（六维实验榜用）。
   每一维都有封存文档（如 `M6_封存_2026-10-25.md`），改动前请先读其中的「解封条件」。

## 站点数据流（build.js）

1. `loadDimensions`：解析 persons / competitions / championships / countries /
   continents / events / ranks_single / ranks_average，建立国家名、洲际简码、
   每位选手各项目的**最佳世界排名**与参赛人数（用于 M4 统治力、M7 对战强度）。
2. `processResults`（流式扫描最大的 results 表）：填选手的参赛项目、年份跨度、
   纪录（WR/CR/NR）与领奖台（决赛 pos 1–3，按赛事类型分 WC/CC/NC/OP 等级），
   同时维护全局 WR 演变（`wrSingleG`/`wrAvgG`）与单项目里程碑（`msGlobal`）。
3. `computeModules`：历史遗留的七模块字段 `p.m` / `p.pk` 仍会写出（仅存档兼容，
   **不参与任何评分**）；总分 `p.overall` 一律取 `p.six.t`，没有六维分的选手记 0。
   补领奖台的 `field/factors/R`、records **全量保留** / podiums≤10、mainEvent、
   wcGold/ccGold/ncGold、events 排序、hue。
4. `buildLanes` / `buildEventMilestones`：输出 WR 泳道与单项目里程碑映射。
5. `main`：调用 `Calc.assemble(PLAYERS, CFG)` 产出 `window.MOCK`，写入 `js/data.js`。

结果格式（time / number / multi）按 `js/calc.js` 的 EVENTS 表 `format` 字段解码；
多盲采用 WCA 新编码 `0DDTTTTTMM` 规范解析（solved / attempted / 秒数）。

## 数据完整性约束（勿再截断）

M1 占有段口径按**整条阶梯**切段（见 `etl/score/M1_占有段口径.md`），因此：

| 约束 | 原因 | 违反后果 |
|---|---|---|
| `records` 必须全量，不得按 R 截断 | 缺一条就等于「前一位留下的值」错位 | G 被高估、段长被低估，静默失真 |
| 拿过纪录的选手必须进明细层 | 阶梯按级别/属地切分，少一个人就断一截 | 该级别整段消失（如五阶 WR 停在 2012） |
| `held` 必须在截断前算 | 保持天数依赖完整的 `recSeq` 序列 | 段尾时间错位 |

`main()` 里对「有纪录但综合分不在前 `--detail-max` 名」的选手会自动补入明细层，
并在日志里打印补入人数；`--detail-max` 只控制**无纪录**选手的明细覆盖范围。

## 样例数据（schema 校验 / 本地测试）

`etl/sample/` 下是由 `make_sample.py` 生成的 **schema 准确** 的小型 TSV 样例
（5 名选手、4 场赛事、覆盖 time/number/multi 三种格式与 WR/CR/NR、WC/CC/NC/OP
各等级）。它用于 CI 冒烟测试与本地验证，不进 GitHub Pages。

```bash
python3 etl/make_sample.py        # 重新生成样例
node etl/build.js --dir etl/sample --out /tmp/data.js   # 跑通完整管道
```

## 自动化

- `.github/workflows/update-data.yml`：每周一从 WCA 官方拉取最新 v2 导出，
  重跑本脚本并将 `js/data.js` 提交回仓库（站点随之更新）。
- `.github/workflows/ci.yml`：每次 push/PR 用样例数据跑 ETL 冒烟测试。

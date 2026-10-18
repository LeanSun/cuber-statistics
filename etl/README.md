# ETL · WCA 官方导出 → `js/data.js`

本目录把 **WCA 官方成绩导出（v2.0.2，snake_case）** 解析、计算七模块 GOAT 评分，
并产出与 `js/mock.js` 完全兼容的 `window.MOCK` 对象，写入 `js/data.js`。

页面代码（`js/pages-*.js` / `js/app.js`）完全不感知数据来源：
存在 `js/data.js` 则用真实数据（隐藏演示横幅），否则回退到 `js/mock.js` 演示数据。

## 用法

```bash
# 从已解压目录（含 WCA_*.tsv）生成
node etl/build.js --dir /path/to/extracted --out js/data.js

# 从官方 tsv.zip 生成（脚本内部用 unzip -p 流式读取，无需解压）
node etl/build.js --zip WCA_export_v2_*.tsv.zip --out js/data.js

# 仅输出综合榜前 N 名（控制 data.js 体积；归一化仍基于全量）
node etl/build.js --zip WCA_export_v2_*.tsv.zip --out js/data.js --emit-max 1500

# 自定义导出日期 / 版本号（写入 meta，用于页面版权声明）
node etl/build.js --dir ./sample --out /tmp/data.js --date 2026-10-18 --ver v2.0.2
```

零依赖（仅用 Node 内置 + 系统 `unzip`）。`js/calc.js` 是被浏览器与 ETL 共享的评分/聚合层。

## 七模块数据流

1. `loadDimensions`：解析 persons / competitions / championships / countries /
   continents / events / ranks_single / ranks_average，建立国家名、洲际简码、
   每位选手各项目的**最佳世界排名**与参赛人数（用于 M4 统治力、M7 对战强度）。
2. `processResults`（流式扫描最大的 results 表）：填选手的参赛项目、年份跨度、
   纪录（WR/CR/NR）与领奖台（决赛 pos 1–3，按赛事类型分 WC/CC/NC/OP 等级），
   同时维护全局 WR 演变（`wrSingleG`/`wrAvgG`）与单项目里程碑（`msGlobal`）。
3. `computeModules`：计算 M1–M7 原始分 → 按全量 MAX 归一 0–100 → 巅峰系数
   （最佳连续 3 年 / 年均，0.85–1.15）→ `career` / `peak` / `overall`；
   补领奖台的 `field/factors/R`、截断 records≤30 / podiums≤25、mainEvent、
   wcGold/ccGold/ncGold、events 排序、hue。
4. `buildLanes` / `buildEventMilestones`：输出 WR 泳道与单项目里程碑映射。
5. `main`：调用 `Calc.assemble(PLAYERS, CFG)` 产出 `window.MOCK`，写入 `js/data.js`。

结果格式（time / number / multi）按 `js/calc.js` 的 EVENTS 表 `format` 字段解码；
多盲采用 WCA 新编码 `0DDTTTTTMM` 规范解析（solved / attempted / 秒数）。

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

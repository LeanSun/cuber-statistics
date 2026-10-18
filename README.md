# Cuber Statistics · 魔方历史最伟大选手（GOAT）评分系统

基于 **WCA 官方成绩导出** 的七模块加权评分模型，回答一个问题：**谁是魔方历史上最伟大的选手？**

本仓库包含两套数据：

- **演示模式**：无 `js/data.js` 时，使用 `js/mock.js` 程序生成的虚构样本（页面顶部显示「演示数据」横幅）。
- **真实模式**：存在 `js/data.js`（由本仓库的 GitHub Action 每周从 WCA 官方导出自动生成）时，整站切换为真实数据，横幅自动隐藏，页脚更新为 WCA 版权声明与导出日期。

页面代码（`js/pages-*.js` / `js/app.js`）对数据来源**无感知**：两种模式都经由 `js/calc.js` 的
`Calc.assemble()` 产出完全兼容的 `window.MOCK`，页面渲染逻辑零改动。

## 目录结构

```
cube-goat/
├─ index.html            外壳：导航 / 筛选条 / 页脚 / WCA 版权声明（站点根，GitHub Pages 直接托管）
├─ css/style.css         主题变量（深浅双主题）+ 组件 + 响应式 + 动效
├─ vendor/echarts.min.js 本地 ECharts（离线可用）
├─ js/
│  ├─ calc.js            共享评分/聚合层（浏览器与 ETL 共用）：Calc.assemble → window.MOCK
│  ├─ i18n.js            中英文语言包
│  ├─ params.js          可配置评分参数（localStorage 持久化）
│  ├─ groups.js          自定义项目分组（localStorage 持久化）
│  ├─ mock.js            演示数据生成器（真实数据存在时自动被覆盖）
│  ├─ data.js            真实数据（由 etl/build.js 生成，覆盖 mock；缺省则回退演示）
│  ├─ icons.js           内联 SVG 图标（WCA 项目图标 + 界面图标）
│  ├─ charts.js          ECharts 封装（主题取色 / 自适应 / 动画）
│  ├─ pages-core.js      首页 · 综合总榜
│  ├─ pages-player.js    选手主页 · 选手 PK
│  ├─ pages-extra.js     动态可视化 · 另类统计 · 评分原理说明
│  └─ app.js             路由 / 状态 / 主题 / 语言 / 事件 / 数据模式切换
├─ docs/                 模型文档（GOAT 评分模型公式手册）
├─ GOAT评分模型_公式手册_v1.html  公式手册自包含网页版
└─ etl/                  WCA 导出下载 → 清洗 → 七模块计算 → js/data.js（详见 etl/README.md）
```

## 七模块评分模型

| 模块 | 含义 | 默认权重（ROC 序数定权） |
|---|---|---|
| M1 | 纪录（WR / CR / NR 事件） | 37.0% |
| M2 | 大赛领奖台（世锦 / 洲锦 / 国锦） | 22.8% |
| M7 | 对战强度（Bradley–Terry / Elo） | 15.6% |
| M4 | 统治力（排名席位时间积分） | 10.9% |
| M3 | 公开赛领奖台 | 7.3% |
| M5 | 广度与全面性 | 4.4% |
| M6 | 生涯厚度 | 2.0% |

三张榜：**生涯长度 C** / **巅峰高度 P**（最佳连续 36 个月）/ **综合总榜** `Overall = C^0.6 · P^0.4`。

每一条公式的数学依据见 `docs/GOAT模型_定稿_v1.0.html`，网站「评分原理说明」页提供简易版 / 详细版解释与全部可调参数。

## 本地预览

直接双击 `index.html` 即可（无需构建、无需联网；国旗图片与公式渲染在离线时自动降级）。

要以**真实数据**本地预览，先按下方「接入真实 WCA 数据」生成 `js/data.js`，再打开 `index.html`。

## 接入真实 WCA 数据

数据管道全部在 `etl/` 目录，详见 [`etl/README.md`](etl/README.md)。要点：

```bash
# 1. 下载官方 v2 导出（约 364MB tsv.zip），或在已解压目录上运行
node etl/build.js --zip WCA_export_v2_*.tsv.zip --out js/data.js --emit-max 1500

# 2. 打开 index.html —— 横幅消失、页脚变为 WCA 真实版权声明即表示已切换
```

- 评分/聚合逻辑在 `js/calc.js`，浏览器与 ETL 共用，保证两套数据形状一致。
- 默认 `--emit-max 1500`：仅输出综合榜前 1500 名以控制 `data.js` 体积；
  七模块归一化仍基于全量选手，不影响分数含义。需要更深榜单时调大该值。
- 多盲按 WCA 新编码 `0DDTTTTTMM` 解码；最少步单次为原始步数、平均为 100×均值。

## 数据来源与授权

数据来自 World Cube Association 官方数据库导出：<https://www.worldcubeassociation.org/export/results>
（导出格式 v2.0.2，全表 snake_case；`results` 以 `regional_single_record` /
`regional_average_record` 记录 WR/CR/NR，并新增 `results.id`，旧 `value1-5` 移至 `result_attempts`）。

按 WCA 授权要求，页面需标注：

> This information is based on competition results owned and maintained by the World Cube Association, published at https://worldcubeassociation.org/results as of `<date>`.

（真实模式下该声明由页面自动生成，日期取导出日期。）

## 部署到 GitHub Pages

1. 将本目录推送到 GitHub 仓库（如 `cuber-statistics`）
2. 仓库 Settings → Pages → Build and deployment → Source 选 **Deploy from a branch**
   → Branch 选 **main** → 目录选 **/(root)** → Save（约 1 分钟生效）
3. 站点地址：`https://<用户名>.github.io/<仓库名>/`
4. 每周自动更新由 `.github/workflows/update-data.yml` 完成：请求
   `https://www.worldcubeassociation.org/api/v0/export/public` 取最新 `tsv_url`，
   下载后重跑 `etl/build.js`，仅将聚合后的 `js/data.js` 提交回仓库。也可在
   Actions 页面手动 `Run workflow` 并指定 `--emit-max`。

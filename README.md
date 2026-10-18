# Cuber Statistics · 魔方历史最伟大选手（GOAT）评分系统

基于 **WCA 官方成绩导出** 的七模块加权评分模型，回答一个问题：**谁是魔方历史上最伟大的选手？**

> 当前仓库中的网站使用**程序生成的虚构演示数据**，不代表任何真实选手。接入 WCA 数据后 `web/js/mock.js` 将被 ETL 产出的 JSON 整体替换，页面代码无需改动。

## 目录结构

```
cube-goat/
├─ index.html            外壳：导航 / 筛选条 / 页脚 / WCA 版权声明（站点根，GitHub Pages 直接托管）
├─ css/style.css         主题变量（深浅双主题）+ 组件 + 响应式 + 动效
├─ vendor/echarts.min.js 本地 ECharts（离线可用）
├─ js/
│  ├─ i18n.js            中英文语言包
│  ├─ params.js          可配置评分参数（localStorage 持久化）
│  ├─ groups.js          自定义项目分组（localStorage 持久化）
│  ├─ mock.js            演示数据生成器（待替换为 ETL 输出）
│  ├─ icons.js           内联 SVG 图标（WCA 项目图标 + 界面图标）
│  ├─ charts.js          ECharts 封装（主题取色 / 自适应 / 动画）
│  ├─ pages-core.js      首页 · 综合总榜
│  ├─ pages-player.js    选手主页 · 选手 PK
│  ├─ pages-extra.js     动态可视化 · 另类统计 · 评分原理说明
│  └─ app.js             路由 / 状态 / 主题 / 语言 / 事件
├─ docs/                 模型文档（GOAT 评分模型公式手册）
├─ GOAT评分模型_公式手册_v1.html  公式手册自包含网页版
└─ etl/                  （待建）WCA 导出下载 → 清洗 → 七模块计算 → JSON
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

## 数据来源与授权

数据来自 World Cube Association 官方数据库导出：<https://www.worldcubeassociation.org/export/results>

按 WCA 授权要求，页面需标注：

> This information is based on competition results owned and maintained by the World Cube Association, published at https://worldcubeassociation.org/results as of `<date>`.

## 部署到 GitHub Pages

1. 将本目录推送到 GitHub 仓库（如 `cuber-statistics`）
2. 仓库 Settings → Pages → Build and deployment → Source 选 **Deploy from a branch**
   → Branch 选 **main** → 目录选 **/(root)** → Save（约 1 分钟生效）
3. 站点地址：`https://<用户名>.github.io/<仓库名>/`
4. 每周自动更新由 `.github/workflows/update.yml` 完成（待建）：先请求
   `https://www.worldcubeassociation.org/api/v0/export/public` 比对 `export_date`，
   有新版本才下载 `WCA_export_*.tsv.zip` 并重跑 ETL，仅提交聚合后的 JSON。

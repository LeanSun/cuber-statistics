# Cuber Statistics · 魔方历史最伟大选手（GOAT）评分系统

基于 **WCA 官方成绩导出** 的 **六维加权评分模型**，回答一个问题：**谁是魔方历史上最伟大的选手？**

六个维度各回答一个不同的问题，先各自独立算分、按榜首归一，再加权求和：

| 维度 | 名称 | 回答什么 | 权重 |
|---|---|---|---|
| M1 | 纪录持有 | 破的纪录守了多久 | 42% |
| M3 | 大赛表现 | 锦标赛上突破的加成 | 22% |
| M2 | 领奖台 | 拿过多少冠亚季军 | 14% |
| M4 | 统治力 | 保持在世界前十有多久 | 10% |
| M6 | 突破幅度 | 破纪录瞬间把人类前沿推远多少 | 8% |
| M5 | 当前排名 | 此刻站在世界各榜什么位置 | 4% |

总分 `t = Σ_d w_d · s_d`，其中维度分 `s_d` 以该维度榜首为 100 归一。

> **名义权重 ≠ 实际贡献**：M5 覆盖全部 29.9 万选手（其余维度只有 281–2 万人有分），
> 名义 4% 在 Top100 里仍贡献约 25%；M1 名义 42% 实际约 19%。调权重前请先跑
> `etl/score/weight_probe.js` 看实际占比，不要只看名义值。

> **旧版七模块模型（M1–M7，含 Elo 对战强度）已整体停用**：不再参与总分、排序、
> 雷达图与任何页面口径，代码里的相关字段仅作历史兼容保留。历史文档已归档到
> `docs/legacy/`，只作存档对照。

本仓库包含两套数据：

- **演示模式**：默认加载真实 WCA 数据（`js/data.js`，由本仓库的 GitHub Action 每周自动生成）。仅当网址显式带 `?demo=1` 时才故意使用 `js/mock.js` 程序生成的虚构样本（顶部显示「演示数据」横幅）。真实数据加载失败时显示明确报错，**不再静默回退到虚构样本**。
- **真实模式**：存在 `js/data.js`（由本仓库的 GitHub Action 每周从 WCA 官方导出自动生成）时，整站切换为真实数据，横幅自动隐藏，页脚更新为 WCA 版权声明与导出日期。

页面代码（`js/pages-*.js` / `js/app.js`）对数据来源**无感知**：两种模式都经由 `js/calc.js` 的
`Calc.assemble()` 产出完全兼容的 `window.MOCK`，页面渲染逻辑零改动。

## 目录结构

```
cuber-statistics/
├─ index.html            外壳：导航 / 筛选条 / 页脚 / WCA 版权声明（站点根，GitHub Pages 直接托管）
├─ sixdim.html           六维实验榜：可按单维度排名、性别筛选、as-of 年份截取
├─ css/style.css         主题变量（深浅双主题）+ 组件 + 响应式 + 动效
├─ vendor/echarts.min.js 本地 ECharts（离线可用）
├─ js/
│  ├─ calc.js            共享评分/聚合层（浏览器与 ETL 共用）：Calc.assemble → window.MOCK
│  ├─ i18n.js            中英文语言包
│  ├─ params.js          可配置参数（六维权重）
│  ├─ groups.js          自定义项目分组（localStorage 持久化）
│  ├─ mock.js            演示数据生成器（仅 ?demo=1 时加载，绝不静默覆盖真实数据）
│  ├─ data.js            真实数据（由 etl/build.js 生成，本站唯一数据源）
│  ├─ roster.js          长尾名册（精简档之后其余选手的懒加载名册）
│  ├─ sixdim_data.js     六维实验榜数据（由 etl/score/sixdim.js 导出）
│  ├─ icons.js           内联 SVG 图标（WCA 项目图标 + 界面图标）
│  ├─ charts.js          ECharts 封装（主题取色 / 自适应 / 动画）
│  ├─ pages-core.js      首页 · 综合总榜
│  ├─ pages-player.js    选手主页 · 选手 PK
│  ├─ pages-extra.js     动态可视化 · 另类统计 · 评分原理说明
│  └─ app.js             路由 / 状态 / 主题 / 语言 / 事件 / 数据模式切换
├─ etl/                  WCA 导出下载 → 清洗 → js/data.js（详见 etl/README.md）
├─ etl/score/            六维模型脚本与封存文档（sixdim.js 统一引擎 = 模型真源）
└─ docs/legacy/          旧七模块模型文档（v1.0，已停用，仅存档）
```

## 本地预览

直接双击 `index.html` 即可（无需构建、无需联网；国旗图片与公式渲染在离线时自动降级）。

要以**真实数据**本地预览，先按下方「接入真实 WCA 数据」生成 `js/data.js`，再打开 `index.html`。

## 接入真实 WCA 数据

数据管道全部在 `etl/` 目录，详见 [`etl/README.md`](etl/README.md)。要点：

```bash
# 1. 六维分数（需要先跑一次；产出 etl/score/sixdim_site.tsv，已随仓库入库）
node etl/score/sixdim.js --out etl/score/sixdim_site.tsv

# 2. 用官方 v2 导出构建站点数据（约 364MB tsv.zip，或在已解压目录上运行）
node etl/build.js --zip WCA_export_v2_*.tsv.zip \
  --out js/data.js --detail-max 2500 --slim-max 60000

# 3. 打开 index.html —— 横幅消失、页脚变为 WCA 真实版权声明即表示已切换
```

- 评分/聚合逻辑在 `js/calc.js`，浏览器与 ETL 共用，保证两套数据形状一致。
- 六维分由 `etl/score/` 下的各维脚本离线算出，`build.js` 读取 `sixdim_site.tsv` 注入 `p.six`；
  **缺失该文件时全站总分为 0**（不会静默回退旧模型）。
- `--detail-max 2500`：带逐条纪录 / 领奖台明细的选手数；`--slim-max 60000`：写进
  `js/data.js` 的选手数（其余进 `js/roster.js` 懒加载）。
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
   Actions 页面手动 `Run workflow` 并指定 `--detail-max` / `--slim-max`。
5. CI（`.github/workflows/ci.yml`）会校验六维交付表存在、总分自洽且无旧模型回退。

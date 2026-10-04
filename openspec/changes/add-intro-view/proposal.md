# Proposal: add-intro-view

## Why

wanxing-web 三视图（目录/文档/控制台）落地即目录卡墙：首次访客打开
wanxing.finddatatech.cloud 看到的第一个界面是一排 agent 卡片，无从得知萬星是什么、
给谁用、怎么开始。萬星已独立为 constellation 线产品（ADR-0001），产品域缺一个
对外可讲的第一面。2026-10-05 grill 共识：范围 C（产品域+官网两层都补）、双层口吻
（价值定位 hero + 可动手 quick facts）。

## What Changes

- **新增 IntroView 介绍视图，作为 `#/` 默认落地**；目录视图挪至 `#/catalog`；
  顶部 tab 增至四个（介绍/目录/文档/控制台）。`#/` 语义从「目录」变为「介绍」是
  有意决策（首访体验优先），非 bug；旧 `#/` 外链一次点击可达目录。
- **介绍页结构（静态骨架，双层口吻）**：
  1. hero：定位句「Agent 服务的对外运行与服务平台」（CONTEXT.md 定位句的对外化）
     + 副标（部署 · 驻留 · 门面 · 计费 · 机群观测）+ 双 CTA（浏览目录/对接文档）。
  2. 三特性卡：服务目录 / A2A 调用 / 计量与计费。
  3. 工作原理一行图：调用方 → 萬星门面（A2A API + 幂等键）→ runner → agent
     回合，门面侧计量记账。
  4. quick facts：A2A 调用样例（见下条，同源渲染）。
- **A2aSample 共享组件**：把 DocsView 里的可复制 curl 样例抽为共享组件，
  DocsView 与 IntroView 同源渲染——单源不漂移（docs voice：命令必须可验证且
  不两处手抄）。
- **footer 官网链接**：从寻数官网首页改为 `/zh/products/constellation` 线页
  （中文站链中文线页；域间互链指线归属而非首页）。
- 纯中文（站点本就无 i18n）；**静态骨架不接活数据**——介绍页不承担机群/目录
  实时状态（那是控制台与目录页的职责），不引入加载态/空态分支。

## Capability Impact

- MODIFIED `wanxing-web`：新增「公共介绍视图为默认落地」requirement（含 A2aSample
  单源与 footer 线页回链场景）。既有目录/文档/控制台 requirement 语义不变——
  目录 URL 挪至 `#/catalog` 不改「目录页」这一契约本身。

## Non-goals

- 线页叙事升级（官网侧五线各写线级介绍，另立）；英文版介绍页；活数据（目录计数/
  机群水位摘要）；hero 可关闭或个性化；控制台/文档视图任何改动（除 A2aSample
  抽组件的等价替换）。

## 验收口径

- `vite build` 绿；本地 render 目检（四 tab、hero/特性卡/工作原理/A2aSample、
  footer 线页链接、`#/`→`#/catalog` 路由）；DocsView 渲染结果与抽组件前等价；
  部署后 HTML 探针断言 title 与关键词（定位句/四 tab 标签）。前端零新单测
  （仓内惯例：服务端 node --test，前端 build+冒烟）。

# Proposal: add-wanxing-web

## Why

萬星独立运行 program 切片⑤（最后一个代码切片）：萬星域上的人面。外部调用者今天面对的是
裸 JSON 目录；部署者（运营号自营起步）没有自己的控制台。L1 门面（Q10/Q11）+ 部署者面
产品级方向（Q4=b）在此落地。

## What Changes

- **wanxing-web/**：独立前端工程（React + Vite + Tailwind v4，中文优先，本仓内独立
  构建发布线——Q14/Q18 定案），三个视图：
  1. **公共目录**：分页 + 搜索的消费级 agent 目录（读 facade 公开目录 API，含分页
     参数——切片①的成果首次被产品面消费）。
  2. **文档门面**：对接一页纸的站内化（鉴权/幂等/计费/错误码速览）。
  3. **部署者控制台 v1**：token 门禁（dogfood 载体）——机群总览（observer board）+
     单 agent 生命周期时间线下钻。管理动作（暂停/恢复/允许清单）与外部租户身份
     （Logto 应用）是下一增量，需用户侧 Logto 配置，注记在案。
- **镜像与发布**：wanxing-web 静态镜像（nginx 伺服 + `/api/wanxing/*`→facade、
  `/api/fleet/*`→observer 同域反代，Q15），并入 images.yml 第三矩阵位
  （`yizuo/wanxing-web`）；deploy 清单 Ingress 指向 web 服务（facade 退到反代后）。

## Capability Impact

- 新增 `wanxing-web` capability（公共目录页/文档门面/控制台 v1 的要求与降级语义）。

## Non-goals

- Logto 身份集成与管理动作 API（下一增量，需用户侧配置）；ops-console（内部板宿主
  不变）；目录热度排序（等③数据积累）。

## 验收口径

- `vite build` 绿；本地起服：目录分页/搜索可用、文档页渲染、控制台带 token 读到
  stub board + timeline；镜像内 nginx 反代路由三条（静态/→facade/→observer）冒烟。

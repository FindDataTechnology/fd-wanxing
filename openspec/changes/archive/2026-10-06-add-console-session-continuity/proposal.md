# Proposal: add-console-session-continuity

## Why

用户报告控制台三个症状，探索（2026-10-05）定位到三个根因外加一个隐藏架构缺陷：

1. **控制台不该有页脚** —— 家族页脚（品牌/联系/五线阶梯/入口/使命句/备案）在 `App.jsx` 无条件渲染，`#/console` 也带着。控制台是工具面，三栏营销区是噪音。
2. **一段时间不访问就报错、必须重登** —— Logto id_token 一小时过期；PKCE 登录只请求了 `openid email profile`（无 `offline_access`，没有 refresh token），前端也无任何续期逻辑；401 后仅挂横幅继续轮询，用户被迫手动退出重登。
3. **找不到登录按钮** —— 「控制台」标签是唯一认证入口，未登录时它渲染登录卡；登录功能存在但不可发现。
4. **（隐藏缺陷）Logto 登录后机群总览从来不可能出数** —— `/api/fleet/v1/board` 与 timeline 只认 `FLEET_INGEST_TOKEN` 字符串全等（observer.js requireToken），不验 id_token；线上探针实证：`/console/auth/config` configured:true 而 board 401 "fleet service credential required"。⑤增量② 给 facade 装身份门禁时，观测面 nginx 反代仍直指 observer，验收测试只覆盖了 facade 路由。

租户事实（discovery 探针）：`refresh_token` 授权与 `offline_access` scope 可用，吊销端点 `/oidc/token/revocation` 存在。

## What Changes

- **会话续期（B-1）**：授权请求加 `offline_access`；exchange 代理回传 refresh_token；facade 新增 refresh 与 revoke 两个代理端点；前端「到期前 5 分钟定时刷新 + 401 先刷一次重试」双触发；`navigator.locks` 串行化多标签刷新（Logto 旋转式 token）；刷新失败清凭据落回登录卡（「登录已过期，请重新登录」），不自动重跳。凭据（id_token + refresh_token）入 localStorage；退出 best-effort 吊销后清本地。
- **观测面身份打通（C-1）**：nginx `/api/fleet/` 反代改指 facade；facade 挂 board/timeline 两路由，复用控制台双门禁（服务令牌或验签身份），验过换 `FLEET_OBSERVER_TOKEN` 转发 observer。observer 零改动；runner 直投 `/ingest` 与 ops-console 直读（`FLEET_BOARD_URL/TOKEN`）不受影响。
- **控制台页脚（1b）**：`#/console` 砍三栏营销区，仅保留底部一行合规行（© + 粤ICP备 + 公安备案）；介绍/目录/文档三视图页脚不动。
- **登录态导航（3a + chip）**：未登录导航显示「登录」，点击直接发起 Logto 跳转（`loginLogto` 提升到共享 auth 模块——也是刷新调度器的地基）；已登录显示「控制台」+ 头部「邮箱 · 退出」chip；控制台页内重复的「退出」删除。

决策全部经 grill 定案（2026-10-06，11 问全取推荐值）。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `wanxing-web`: 控制台页脚缩为合规行（两条页脚需求改作用域）；新增会话续期需求与登录态头部需求。
- `wanxing-facade`: 新增 refresh/revoke 代理端点需求；新增 fleet 读转发需求（双门禁 + 服务令牌换签）。

`fleet-observability` 不动：observer 行为与实现零改动，其「服务凭据或 admin 门禁」表述天然容纳 facade 持服务凭据转发。

## Impact

- 代码：`services/wanxing-facade/`（logto-auth.js、console.js、routes.js ~80 行）；`wanxing-web/src/`（App.jsx、ConsoleView.jsx、新共享 auth 模块 ~150 行）；`wanxing-web/nginx.conf` 1 行；observer 0 行。
- 部署：facade + web 双镜像滚动（fd-infra-deploy 两份 yaml）；observer 清单不动；不新增 env（复用 facade 现有 `FLEET_OBSERVER_URL/TOKEN` 与 Logto 三 env）。
- 兼容：运维服务令牌通道不变；`/console-callback` 与既有登录流形状不变（只加 scope）；旧版 web 缓存与新 facade 混跑无破坏（refresh 端点是纯增量）。
- 风险：Logto refresh token 的 TTL/旋转参数在彩排中以真登录实证（discovery 只证 grant 支持）。

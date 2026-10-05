# Design: add-console-session-continuity

## Context

现状链路（2026-10-05 探索实证）：web 容器 nginx 把 `/api/wanxing/` 反代 facade（双门禁：服务令牌 OR Logto 验签身份），把 `/api/fleet/` 直代 observer（只认 `FLEET_INGEST_TOKEN` 字符串全等）。Logto 登录流是单次 PKCE：id_token 入 localStorage，一小时过期即全站 401，无续期、无恢复。页脚与导航是 `App.jsx` 里的无条件 JSX。facade 已持有 `FLEET_OBSERVER_URL/TOKEN`（fleet-report 上报在用），Logto 三 env（endpoint/app_id/allowlist）已配置。

租户事实（discovery 探针）：`grant_types_supported` 含 `refresh_token`；`scopes_supported` 含 `offline_access`；吊销端点 `/oidc/token/revocation` 存在。旋转参数（默认旋转式、约 14 天闲置窗）待彩排实证——这是本设计唯一的外部未知数。

## Goals / Non-Goals

**Goals:**

- 会话从 1 小时存活提升到租户 refresh token 闲置窗口（约 14 天），过期可见、可自愈
- Logto 登录身份贯通观测面（board/timeline），修复「登录后机群总览永远 401」缺陷
- 控制台视图去营销页脚（留一行合规行）；导航按登录态呈现 登录/控制台 + 邮箱·退出 chip
- observer 零改动；运维服务令牌通道不变

**Non-Goals:**

- 介绍/目录/文档三视图加门禁（保持公开）
- 站点 i18n、页脚内容变更（内容常量不动，只改作用域）
- ops-console 直读 observer 的 `FLEET_BOARD_URL/TOKEN` 路径改造
- observer 自身装验签（C-2 已否）；自动重跳登录（Q9 已否）

## Decisions

**D1 · 续期走标准 refresh_token 流（B-1），facade 代理两个新端点。**
授权请求加 `offline_access`；`POST /console/auth/refresh` 以 `{refresh_token}` 换新对（facade 对新 id_token 复用登录同一 fail-closed 验签——续期绝不降门禁）；`POST /console/auth/revoke` best-effort 代吊销（RFC 7009 语义：清理而非门禁，上游异常也回 ok）。备选 B-2（只做 401 落回登录卡）被否：一天多次重登没治本。备选「浏览器直连租户 token 端点」被否：CORS 不可控，登录流已确立代理范式。

**D2 · 刷新调度器双触发 + Web Locks 串行（Q3/Q8/Q9）。**
共享 auth 模块（由 ConsoleView 提升 `loginLogto` 而来）持有调度器：解析 id_token `exp`，`exp−5min` 定时刷新；业务 fetch 包装层捕获 401 时先刷新一次再重试，仍 401 才上抛。多标签竞态由 `navigator.locks('wanxing-auth-refresh')` 互斥——旋转式 token 下后到者必失败，锁内重读 localStorage 可让两个标签收敛到同一新对。刷新失败（invalid_grant 等）＝会话终局：清双 token，落回登录卡，文案「登录已过期，请重新登录」，不自动重跳（避免循环）。

**D3 · 凭据入 localStorage，退出必吊销（Q6/Q7）。**
id_token + refresh_token 同存 localStorage（跨标签/跨天存活是续期的意义；XSS 面由旋转机制限窗，运维工具风险可接受）。退出 = best-effort revoke → 清双 token → 回登录卡；吊销失败不阻塞清理。

**D4 · 观测面身份走 facade 转发（C-1），nginx 一行改向。**
nginx `location /api/fleet/` 的 `proxy_pass` 由 observer 改指 facade:3080；facade 挂 `GET /api/fleet/v1/board` 与 `GET /api/fleet/v1/agents/:slug/timeline`，复用 console.js 现有 `gate()` 双门禁，验过换 `Bearer FLEET_OBSERVER_TOKEN` 转发 `FLEET_OBSERVER_URL`，状态码与响应体透传；observer 不可达回 502 诊断错误（不能把 observer 的 401 凭据挑战漏给浏览器，那会被前端误判为身份过期）。observer 的 `/ingest` 不在 `/api/fleet/` 前缀下，runner 直投与 ops-console 直读均不受影响。

**D5 · 页脚与导航是纯前端改动（1b/3a/Q11）。**
`App.jsx` 按当前 hash 分支页脚：console 视图只渲染合规行组件（© + 双备案，常量复用）；其余三视图渲染现有家族页脚。导航登录态感知由共享 auth 模块的订阅（自定义事件或 hook）驱动：未登录 =「登录」标签（点击直发 PKCE 跳转），已登录 =「控制台」标签 + 头部「邮箱 · 退出」chip；ConsoleView 页内「退出」删除。**注意**：header 改动使 App.jsx 依赖 localStorage 状态，需监听 storage 事件 + 登录/登出自定义事件保持跨标签一致。

**D6 · 打包为单 change、双镜像同滚。**
facade 与 web 镜像一次构建推送（TCR），fd-infra-deploy 两份 yaml 同步滚 tag；observer 清单不动。不新增 env、不新增 Secret。

## Risks / Trade-offs

- **Logto 旋转参数未实证**（唯一外部未知）：discovery 只证 grant 支持。缓解：彩排任务里真登录后立刻手动调 refresh 两次，断言第二次返回的 refresh_token ≠ 第一次（旋转）且旧 token 已失效；若租户未开旋转，D2 的锁仍正确（退化为并发重复刷新，无害）。
- **localStorage XSS 面**：接受（D3），理由——允许名单门禁 + 旋转限窗 + 运维工具非公开面。
- **旧 web 缓存 × 新 facade 混跑**：refresh/revoke 是纯增量端点，旧客户端不调用；nginx 改向后旧客户端的 board 调用（带 id_token）从 401 变 200——只会更好，无破坏。
- **新 web × 旧 facade 混跑**（滚动窗口内）：新前端的 refresh 调用会 404，401-重试路径退化为落回登录卡——与现状等价，不劣化。滚动顺序 facade 先、web 后可完全避开。
- **验证边界**：facade 单测沿 `test-wanxing-logto.mjs` 的 stub-OP 真密码学范式（P-384 签发 token + 假 JWKS 端点），refresh/revoke 代理与 fleet 转发门禁都可全覆盖；前端刷新调度器逻辑简单（定时器+锁+重试），以真登录彩排覆盖，不做前端单测框架引入。

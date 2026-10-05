# Tasks: add-console-session-continuity

## 1. facade：会话端点

- [x] 1.1 logto-auth.js 增 `refreshGrant({ refreshToken })`（`grant_type=refresh_token` 打租户 token 端点，返回原始 doc）与 `revokeToken(token)`（打 `/oidc/token/revocation`，best-effort——上游异常吞掉回 ok）；refresh 后的新 id_token 复用 `verifyIdToken`（fail-closed 不降门禁），验签失败 403 且不回 token
- [x] 1.2 console.js 挂 `POST /api/wanxing/v1/console/auth/refresh`（body `{refresh_token}`，回 `{id_token, refresh_token, email}`，旋转感知——租户回了哪个就返回哪个）与 `POST /api/wanxing/v1/console/auth/revoke`（body `{token}`，恒回 ok）；logtoAuth 未配置时两路由 503
- [x] 1.3 单测（沿 test-wanxing-logto.mjs stub-OP 真密码学范式）：refresh 旋转+重验签、验签拒 403、revoke 上游慢仍 ok、未配置 503

## 2. facade：fleet 读转发

- [x] 2.1 routes.js/console.js 挂 `GET /api/fleet/v1/board` 与 `GET /api/fleet/v1/agents/:slug/timeline`（含 query 透传）：复用 `gate()` 双门禁；验过换 `Bearer FLEET_OBSERVER_TOKEN` 转发 `FLEET_OBSERVER_URL`，状态码与体透传；observer 不可达回 502 诊断错误（勿漏 observer 的 401 给浏览器）
- [x] 2.2 单测：身份可读 board、服务令牌同样可读、双无 401（且不打 observer）、observer 不可达 502
- [x] 2.3 nginx.conf：`location /api/fleet/` 的 `proxy_pass` 由 fleet-observer 改指 wanxing-facade:3080（`/ingest` 不在此前缀，runner 直投不受影响）

## 3. web：共享 auth 模块与会话续期

- [x] 3.1 新建共享 auth 模块：从 ConsoleView 提升 `loginLogto`（PKCE 跳转 + `/console-callback` 处理移入）；授权请求加 `offline_access`；exchange 结果存双 token（localStorage：`wanxing-console-token` 键沿用 + `wanxing-console-refresh` 新键）与 email；对外暴露登录态订阅（storage 事件 + 自定义事件，跨标签一致）
- [x] 3.2 刷新调度器：解析 id_token `exp`，`exp−5min` 定时刷新；`navigator.locks('wanxing-auth-refresh')` 串行、锁内重读 localStorage 收敛旋转结果；刷新成功写回新对并广播；失败（invalid_grant/网络）= 清双 token + 落回登录卡（「登录已过期，请重新登录」），不自动重跳
- [x] 3.3 credentialed fetch 包装：board/timeline/deployments/callers 全部走包装层——401 先刷新重试一次，仍 401 才触发会话终局；运维服务令牌通道不接包装（永不过期）
- [x] 3.4 退出 = best-effort revoke → 清双 token + email → 回登录卡；吊销失败不阻塞清理

## 4. web：壳修缮

- [x] 4.1 App.jsx 页脚按视图分支：console 只渲染合规行（© + 粤ICP备 + 公安备案，常量复用）；其余三视图原样
- [x] 4.2 导航登录态感知：未登录 =「登录」标签（点击直发 PKCE 跳转，不中转登录卡）；已登录 =「控制台」+ 头部「邮箱 · 退出」chip；ConsoleView 页内「退出」删除
- [x] 4.3 构建冒烟：vite build 通过 + 本地起容器手验四视图页脚/导航分支

## 5. 彩排与部署

- [x] 5.1 本地全量单测绿（node --test，含既有 test-wanxing-logto 回归）
- [ ] 5.2 真登录彩排（对线上或 staging Logto）：登录 → board/timeline 以 id_token 出数（观测面身份贯通实证）→ 立刻手动调 refresh 两次：第二次返回 refresh_token ≠ 第一次（旋转实证）且旧 token 失效 → 退出后再 refresh 401/400（吊销实证）
- [ ] 5.3 镜像与滚动：GitHub Actions 推 wanxing-facade + wanxing-web 双镜像（TCR）→ fd-infra-deploy 两份 yaml 回填新 sha（observer 清单不动）→ push 触发 ArgoCD（滚动顺序 facade 先、web 后，避开新 web × 旧 facade 混跑）
- [ ] 5.4 线上五点探针：①`#/console` 无三栏页脚仅合规行 ②未登录导航见「登录」直跳 ③真登录后机群总览+时间线出数 ④静默续期（或 401 自愈）无感 ⑤退出后 board 401、refresh 失效

## 6. 收口

- [ ] 6.1 openspec validate --specs 全绿（wanxing-web 两 MODIFIED 带全场景名、四条 ADDED 齐备；wanxing-facade 两条 ADDED；fleet-observability 不动）
- [ ] 6.2 归档：sync specs → archive change → 提交（含 fd-infra-deploy 滚动记录回填 proposal/部署注记）

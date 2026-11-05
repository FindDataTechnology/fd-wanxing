# wanxing-web-test-gate 任务清单

## 1. web 测试层骨架

- [x] 1.1 `wanxing-web/package.json` 加 `"test": "node --test test/"` script；建 `wanxing-web/test/` 目录；验证 `npm test` 空跑成功退出
- [x] 1.2 视图冒烟的渲染通道定型（design 记录选型：react-dom/server 静态渲染或 vite 纯逻辑抽取，零新增运行时依赖）；验证所选通道在 node:test 下可跑通一个 hello 用例

## 2. 逻辑层测试

- [x] 2.1 auth.js 用例：token 续期成功/过期刷新/双 tab 锁/登出清态；验证本地 `npm test` 全绿
- [x] 2.2 embed-auth.js 与 api 客户端用例：匿名梯队凭据铸造、错误响应归约、SSE 参数组装；验证全绿
- [x] 2.3 状态归约用例（ChatView 消息列表/EmbedView 宿主协议 message 归约）：验证全绿

## 3. 视图冒烟与回归用例

- [x] 3.1 CatalogView/FleetView/ChatView 空数据与典型数据两态可渲染不抛异常；验证三视图冒烟通过
- [x] 3.2 已知崩溃回归三条落地：FleetView 空数据面板（2a2644d/74ee780 同类）、控制台异常响应黑屏（4df9b53 同类）、ChatView 异常 SSE 态；验证人为注入坏数据时用例红、修后绿

## 4. CI 闸门接线

- [x] 4.1 `.github/workflows/images.yml` 在 build 矩阵前加 test job：根仓 `npm test` + `wanxing-web npm test`；验证本地模拟（node --test 全量）通过
- [ ] 4.2 验证闸门有效性：push 一个故意红的提交，CI 测试步失败且不出镜像；revert 后全绿出片
  - **偏差记录（2026-11-06）**：闸门拦截语义已在真实 push 上实证——org run 42072852452（a4482bf）：test job 失败 → build-push **skip**（needs 生效）。但 test job 本身因 GHA 账号级停摆未能执行（scs001 与 FindDataTechnology 双账号 billing 拒启，症状=3-5s、0 steps、runner 空；10-11 起，判别法见 INFRA-NOTES.md）；绕行 build-pool 快照线刻意剔 `.github`，闸门到不了那条线。CI 两步命令已本地等价执行全绿（208+27）。**GHA 恢复后任意一次 push 即补证 green path**。

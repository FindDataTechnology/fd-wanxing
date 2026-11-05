# wanxing-web-test-gate 设计

## 视图冒烟渲染通道（任务 1.2 的选型落点）

**约束**：零新增运行时依赖（与根仓 node:test 零框架风格一致）、本地秒级可跑、能复现「空数据/坏数据渲染崩溃」。

**选型：react-dom/server 静态渲染（renderToStaticMarkup）**

- react 与 react-dom 已在 wanxing-web 依赖树内（react19），`react-dom/server` 是官方子路径，零新增依赖。
- 冒烟语义=「给定 props/数据态，renderToStaticMarkup 不抛异常且关键 DOM 锚点存在」。三起真机崩溃（2a2644d/74ee780/4df9b53：空数据面板/异常响应黑屏/坏徽章字段）全是渲染期异常，静态渲染足以复现——它们不需要事件交互。
- vite 组件测试（vitest+jsdom）被否：新增 dev 依赖与第二套测试运行时，与「最小层」目标不符；交互级测试留给未来 E2E 专项。

**注意**：视图文件若引用浏览器全局（window/localStorage）需在测试里注入最小 stub（node:test 全局挂载），auth.js 等纯逻辑不受影响。hash 路由（App.jsx VIEWS 表）直接按视图组件单测，不经路由层。

## 回归用例清单（对应 spec Scenario「已知崩溃回归」）

| 用例 | 复现原型 | 注入 |
|---|---|---|
| FleetView 空数据面板 | 2a2644d/74ee780（记忆面板渲染崩溃两连修） | deployments 空数组/信号列缺字段 |
| 控制台异常响应 | 4df9b53（控制台黑屏） | API 返回非约定形状（null/字符串/超长） |
| ChatView 异常 SSE 态 | ChatView 4 连修同类 | status 端点 5xx/半截 JSON/字段缺失 |

## CI 接线

images.yml 增 test job（node 22，与 Dockerfile 同版本线）：根仓 `npm test` 与 `cd wanxing-web && npm test`，任一红则后续 build matrix 不起。用 `needs:` 依赖实现拦截。

## Open Questions

（无——选型已定，无待用户裁决项）

## ADDED Requirements

### Requirement: 出片前测试闸门

萬星三镜像（facade/observer/web）的 CI 流水线 SHALL 在构建推送前先跑全量测试（根仓 `npm test` + wanxing-web 测试）；任一测试失败 MUST NOT 产生镜像推送，CI 以失败呈现。

#### Scenario: 测试失败拦截出片
- **WHEN** 提交引入的改动使任一测试失败
- **THEN** images.yml 在测试步骤失败退出，不产生新镜像 tag，既有线上镜像不受影响

#### Scenario: 全绿正常出片
- **WHEN** 提交使全部测试通过
- **THEN** 流水线按既有拓扑（hkccr→relay→ccr）出三镜像，tag 规则不变

### Requirement: wanxing-web 最小测试层

wanxing-web SHALL 具备可本地一键运行的测试层（`npm test`，零新增框架依赖，node:test）：覆盖纯逻辑层（auth/embed-auth/api 客户端/状态归约）与关键视图冒烟（CatalogView/FleetView/ChatView 可渲染不崩）；历史上真机才抓到的渲染崩溃 SHALL 各有回归用例。

#### Scenario: 已知崩溃回归
- **WHEN** 重新引入与 2a2644d/74ee780/4df9b53 同类的渲染崩溃（空数据面板/缺字段徽章/异常响应态）
- **THEN** 对应回归用例失败，本地与 CI 均可复现，无需真机走查

#### Scenario: 逻辑层重构保护
- **WHEN** auth.js 或 api 客户端被重构
- **THEN** 逻辑层用例（token 续期/过期/双 tab 锁、SSE 参数组装、错误态归约）给出行为是否保持的判定

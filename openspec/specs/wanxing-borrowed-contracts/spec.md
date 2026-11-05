# wanxing-borrowed-contracts Specification

## Purpose
萬星对四条不归本仓所有的能力边界——謙面 registry、packs 部署台账、sub2api 计费面、agent-runner——的借用纪律契约：只经 HTTP（或既定协议端点）+ env 可重指访问，禁止库直连与进程内耦合。守住它是萬星对外私有交付（L3）的前提；本 spec 同时是变量编址的一处可发现清单。

## Requirements

### Requirement: 借用边界只经 HTTP 契约

萬星（facade、fleet-observer 及后续自有组件）对謙面 registry、packs 部署台账、sub2api 计费面、agent-runner 四条借用边界的全部访问 SHALL 经 HTTP（或既定协议端点）+ 环境变量编址；MUST NOT 直连兄弟线的数据库或进程内 import 兄弟线代码。

#### Scenario: 借用服务迁移地址
- **WHEN** 任一借用服务（registry/packs/sub2api/agent-runner）更换部署地址
- **THEN** 萬星侧仅需更新对应环境变量即可恢复，代码零改动

#### Scenario: 违约直连被拒绝
- **WHEN** 评审新增的萬星代码出现对兄弟线数据库的连接串或对 paas 模块的进程内 import
- **THEN** 该改动不通过评审，必须改走 HTTP+env 契约

### Requirement: 借用依赖可发现且 env 双名兼容

四条借用边界的现役环境变量名 SHALL 在仓库内一处可发现（本 spec 与 README 借用契约段）；历史上双名兼容的变量（如 `AGENT_SERVING_REGISTRY_URL||REGISTRY_URL`、`CELL_MEMORY_URL||FD_MEMORY_URL`）SHALL 保持既有解析优先级不变。

#### Scenario: 新会话排查借用依赖
- **WHEN** 开发者需要查「萬星依赖了哪些外部服务、用什么变量编址」
- **THEN** 从本 spec 与 README 的借用契约段即可获得完整清单，无需翻代码

### Requirement: agent-runner 为正式借用边界

agent-runner SHALL 按借用边界管理（不在遷入计划内）：其归属、部署形态（paas platform 镜像同镜像第三角色）与调用契约与 registry/sub2api/packs 同列。program 文档与 ADR MUST 记录本裁决（2026-11-06），萬星侧 MUST NOT 残留「待迁入 runner」的悬挂假设。

#### Scenario: 查阅独立 program
- **WHEN** 读者查阅 `docs/program/wanxing-independence.md`
- **THEN** agent-runner 的状态为「正式借用边界（2026-11-06 裁决）」而非「待迁入」，且全文不存在与之矛盾的条目

#### Scenario: 若未来需要迁移
- **WHEN** 用户决定迁移 agent-runner
- **THEN** 另立专项 change 显式推翻本裁决，本 spec 相应修订

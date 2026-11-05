# ADR-0005: agent-runner 是萬星的正式借用边界

日期：2026-11-06　裁决人：用户（「大胆处理」授权下由调研代拍，可推翻）

## 背景

ADR-0001 把 agent-runner 列为「facade 之后迁入」本仓的组件；`docs/program/wanxing-independence.md` 切片②也如此假设。独立决策（2026-10-04）以来一个多月的实际演进是：

- paas 侧 `agent-runner/` 27 文件 ~5,900 行，**56 个 commits 持续活跃**（最新到 2026-11-05 模型会话边界热切），是 paas 仓最活跃组件之一；
- 部署形态为 platform 镜像的 "same-image third role"（`Dockerfile:311-317`），与 cells、compute-quota 分片、palette 深度共生；
- fd-wanxing 侧**零对应物、零迁移标记、零迁移工作**；
- 万星域的观测/结算/目录面均已经 HTTP 契约与 runner 协作（runner→observer 直投、facade→packs 台账），借用边界事实上已成立。

## 裁决

agent-runner **不迁入** fd-wanxing，与謙面 registry、packs 台账、sub2api 同列**正式借用边界**：

1. 归属、部署形态（paas platform 镜像第三角色）按现状固化；
2. 调用只经 HTTP/既定协议端点 + env 可重指（与借用契约总纪律一致）；
3. program 文档与本 ADR 记录裁决，萬星侧不得残留「待迁入 runner」假设；
4. 未来若要迁移，另立专项 change 显式推翻本裁决。

## 后果

- **正面**：边界叙述与事实一致（此前一个月是「说要迁但没迁」的漂移态）；萬星独立 program 的「分阶段搬仓」叙事收敛为已完成态+twin 摘挂（`unify-wanxing-a2a-face`）；runner 的 paas 侧演进不再背「迁移前冻结」的隐形预期。
- **负面/代价**：萬星平面的「运行时」一段长期不在本仓（萬星平面定义需按此理解）；平台镜像耦合 runner 的升级节奏继续由 paas 掌握。
- **对 L3（对外私有交付）的影响**：借用契约纪律本就是 L3 前提；runner 作为第四条借用边界加入 spec `wanxing-borrowed-contracts`，私有化交付时 runner 与 registry/sub2api 同样按契约替换或随行。

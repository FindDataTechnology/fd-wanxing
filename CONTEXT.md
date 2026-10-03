# 萬星（Wanxing）

Agent 服务的对外运行与服务平台——部署、驻留、门面、计费与机群观测。寻数五线中
constellation 线的独立产品，自 paas 分阶段独立（ADR-0001）。

## Language

**机群（Fleet）**:
跨 runner 的全部已部署 Agent 服务的全体。观测与运营的单位；单个 runner 只是它的一个承载节点。
_Avoid_: 部署列表、agent 池、集群（指基础设施时另说）

**萬星平面（Wanxing Plane）**:
萬星产品自有并独立演进的组件全体：门面、观测面、web 门面、运行时。与它向兄弟线借用的能力相对。
_Avoid_: 警星后端、wanxing 模块（指 paas 内某个目录时另说）

**借用契约（Borrowed Contract）**:
萬星平面访问不归其所有的能力（謙面 registry、packs 部署台账、sub2api 计费）的唯一合法形态：显式 HTTP 契约 + env 可重指，不做进程内耦合。守住它是 L3 对外交付的前提。
_Avoid_: 依赖（泛指）、内部调用

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

**访客（Visitor）**:
经登录身份（共享 IdP）使用对话车道的人类调用者。与持调用键的程序调用者相对：访客不持键、不直接结算。
_Avoid_: 用户（泛指）、客户、游客（指匿名时另说——对话车道要求登录）

**对话车道（Chat Lane）**:
浏览器对话页经门面发起的调用渠道，与 API 车道（A2A + 调用键）并列；两车道同走准入内核，账本以渠道分列。
_Avoid_: 聊天功能、demo 模式、网页版

**结算方（Settler）**:
一笔回合账单的承担者——API 车道恒为调用者本人（caller-pays）；对话车道法定为平台补贴、主人池或访客自带键三者之一，与调用者（Caller）分离。
_Avoid_: 付款人（口语）、账号（指 sub2api 账户时另说）

**平台补贴（Platform Subsidy）**:
平台承担的访客免费基线：全局开关 + 每访客每日限额，扣减顺序先于主人池。是获客成本，不是访客的权利。
_Avoid_: 免费额度（泛指时含主人池）、试用

**主人池（Host Allowance）**:
部署者为单个 agent 的访客设的垫付上限：一次性限额、实扣部署者结算方，扣完即止、随时可调；语义是把该 agent 的免费对话延长到平台基线之外。
_Avoid_: 预存（池是放行上限不是储值）、月度配额

**匿名访客（Ephemeral Visitor）**:
经门面铸造的短期签名凭据（无账户、无租户身份）使用嵌入车道的浏览器访客。身份锚是 per-agent 的临时 vid：匿名分钟按 vid × 日窗独立记账（比登录补贴更紧），且永不落主人池。清存储重刷在 v1 是接受的已知口子（损失被匿名日额封顶）。
_Avoid_: 游客账号、试用用户、匿名用户（泛指——不存在的账户）

**嵌入车道（Embed Lane）**:
产品线网页以跨站 iframe 嵌入门面 `#/embed/<slug>` widget 形成的对话渠道；凭据阶梯为 宿主递租户 ID token → widget 内登录（popup 回交）→ 匿名访客。与对话车道同走准入内核，账本同记 channel=chat、以 visitor_tier 分层。
_Avoid_: 悬浮框（指 UI 形态时另说）、插件、SDK

**问询卡（Ask Card）**:
served agent 回合中调用 `ask_user_question` 后，经 serving 面 `ask` 事件接力到 widget 渲染的可答卡片（选项/多选/自由文本/取消/到期倒计时）；答案经门面 `ask-answer` 侧路由回到 agent，归属绑定在转发该帧的访客。问询窗=剩余回合预算，到期 runner 自取消。`#/chat` 主页暂不渲染问询（只看 data 行，帧被忽略）。
_Avoid_: 审批、表单、工具卡（指通用工具渲染时另说）

**宿主意图（Host Intent）**:
问询的一种：question `id` 形如 `intent:<verb>:<arg>` 时视为宿主页面动作提议，widget 自身不执行——用户点第一个选项才向可信宿主 postMessage `wx-copilot-intent`，宿主按其在 init 里声明的动词白名单执行并回 `wx-copilot-intent-result`，结果随答案回到 agent。无点击不动作；宿主未声明的动词答「当前页面不支持」。
_Avoid_: 客户端动作（CopilotKit 术语）、ui_intent（早期草案名）

**套餐（Serving Plan）**:
ops 发给调用者的分钟制预付额度：scoped 到单一 caller、cap=分钟池、按分钟随回合扣减、仅在 API 车道生效（chat 线不受影响）。申请-审批走控制台双视角闭环。
_Avoid_: 会员、订阅、配额（指主人池时另说）

**集群复合服务单位（Cluster Unit）**:
多个 served agent 经声明组成、对外以单一 A2A 地址服务的复合单位：回合扇出到各成员、按策略聚合、逐成员独立走账。目录里以集群标记呈现。
_Avoid_: 机群（Fleet 是全体不是单位）、组合包（指 collections 时另说）

**集合（Collection）**:
部署者把多个 pack 组织成的命名分组：私有分组或公开套装；公开套装可被访客经 bundle 页一键整体部署。
_Avoid_: 目录分类（facet 是策展信号不是部署者资产）、集群（指 Cluster Unit 时另说）

**桌面机位（Device Seat）**:
桌面端 runner 的配对席位：六位码铸造/核销/吊销，配对后经信箱（mailbox）投递与回投任务。归属部署者控制台的机位页。
_Avoid_: 设备管理（泛指）、节点（指 runner 节点时另说）

**机位信箱（Mailbox）**:
桌面机位的任务投递/拉取/回投缓冲：任务投进信箱、机位拉取执行、结果回投；console 有查询面（当前无独立 UI 入口）。
_Avoid_: 队列（指 DAG 执行器时另说）、消息中心

**记忆可见页（Memory Visibility Console）**:
部署者查看/遗忘某部署记忆条目的控制台面板（layer 筛选、L 徽章、两步确认遗忘），经门面 owner gate 透明代理 fleet visibility lane。
_Avoid_: 记忆管理（泛指）、知识库

**访客事项（Visitor Matters）**:
访客在对话/事项面板里可见的自身事项记录（chat 车道带访客 scope 查询端点，「我的事项」视图）。
_Avoid_: 工单、任务（指 missions 时另说）

**任务（Mission）**:
四元组定义（定义/输入/验收/纪元）的可提交工作项：部署者经 missions 视图创建与提交，planner 侧审批与状态机推进，纪元回写落账。
_Avoid_: 需求、TODO（口语）

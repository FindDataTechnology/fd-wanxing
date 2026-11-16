# Tasks — harden-copilot-ask-and-intent

## 1. 先确认链路（避免重复改对的东西）

- [ ] 1.1 用 `host-demo.html`（已声明 `navigate`/`refresh`）手工构造一个 ask 帧，确认 widget 渲染出卡片、作答后答案能回到 agent（verified: 卡片出现且 `POST /chat/:slug/ask-answer` 返回 2xx，agent 的后续回合收到答案）
- [ ] 1.2 同上手工构造 `intent:navigate:<path>`，确认宿主真的跳页并把 result 回传（verified: 宿主 URL 变化 + agent 后续回复引用 result message）

## 2. 问询卡规则（pack prompt 侧，主工作量）

- [ ] 2.1 把 D2 的三条判据 + 反面清单写成一份可复用的规则段（verified: 规则文本成型，四条线可引用同一份）
- [ ] 2.2 识律副驾 agent 接入该规则段（verified: 真机问一个离散选择问题，`[data-testid^="wx-ask"]` 计数 > 0）
- [ ] 2.3 柏讯专家 agent 接入（verified: 同上）
- [ ] 2.4 谦面专家 agent 接入（verified: 同上）
- [ ] 2.5 寻数分身 agent 接入（verified: 同上）
- [ ] 2.6 反面验证：问一个开放问题与一个已有明确答案的问题，均**不**出卡（verified: `wx-ask` 计数 = 0）

## 3. 宿主意图规则（pack prompt 侧）

- [ ] 3.1 把 D3 的两条铁律（动词白名单由宿主动态声明；提议走 envelope 不退化成自然语言）写进规则段（verified: 规则文本成型）
- [ ] 3.2 识律副驾接入，真机说「带我去用量页面」（verified: 产出 `intent:navigate` 问询，点选后控制台真的跳到对应路由）
- [ ] 3.3 未声明动词的反面验证（verified: 要求一个宿主没声明的动作时，agent 只口头说明，不出可执行选项）
- [ ] 3.4 不动作验证（verified: 产出提议但不点选，宿主 URL 不变）

## 4. 宿主侧补齐

- [ ] 4.1 官网 `fd-official-web`：声明 `navigate`（站内锚点），实测跳转（verified: 点选后 URL 锚点变化）
- [ ] 4.2 柏讯 `fd-wire` 控制台：补 `context()` 递当前页面/数据集（verified: widget 上下文栏显示宿主递的值，且首轮文本带标记前缀）
- [ ] 4.3 柏讯控制台的 `intents` 收敛到控制台路由白名单（verified: 非法路由被宿主拒绝并回 `ok:false`）
- [ ] 4.4 谦面 `facet/web`：按产品面补 `context()`（verified: 同 4.2）

## 5. 上下文递送语义

- [ ] 5.1 确认标记前缀的格式与「只随首轮送一次」的行为（verified: 首轮带前缀、第二轮不带）
- [ ] 5.2 验 agent 把上下文当背景而非指令（verified: 给一个含 `page=/console/datasets` 的上下文，agent 不会自作主张去跳页，而是在回复里引用该页面信息）

## 6. 出片与真机验收

- [ ] 6.1 四条线各跑三项真机（问询卡 / 宿主意图 / context）（verified: 每线三项逐条记录，用专用 testid 读，不用整页文本）
- [ ] 6.2 每次验收前清空 localStorage 与 cookie，硬重载（verified: 验收脚本里包含该步骤，且不依赖任何手动探针）

## 7. 壹座（门槛达成后另起）

- [ ] 7.1 三线四项全过后，在 **paas 仓**另起 change 做 `CopilotDock`（423 行）迁移（verified: 该 change 存在于 paas 的 openspec 根，本仓无 paas 改动）

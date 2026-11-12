# design — 萬星共享语义收敛

## 1. 为什么这两件东西必须收敛

`slugFor` 和「变量编址」都不是内部实现细节，它们是**跨仓契约的两半**：

- `slugFor` 决定「这台部署对外叫什么」。谦面脊柱用它把公开目录条目 join 回自己的部署台账（`paas/facet/supply-catalog.js:50`），壹座 runner 用它把 agent 身份写进 registry 路径（`paas/agent-runner/fleet.js:16`），萬星门面用它做对外路由（`core.js:26`）。三者必须逐字节一致，否则「同一个 agent」在两个面上是两个身份——而生产表现是「目录里有、详情页 404」或「结算记在另一个 slug 上」。
- env 编址决定「这台部署能不能连上」。别名集合不一致时的失败是**局部的**：配了 `CELL_MEMORY_*` 的部署，对话回合能取记忆，控制台的记忆可见页 503。这种半边可用最难排查。

两处共同点：漂移零告警。所以收敛的目标不是「少几行代码」，是**让漂移变成红灯**。

## 2. 决策

### D1 · 仓内一份实现，仓外一份夹具

```
        contracts/agent-identity.fixture.json   ← 契约（数据，不是代码）
                  |                  |
        fd-wanxing 测试       paas 各实现自己的测试
                  |                  |
        identity.js          runner / supply-catalog 各自的副本
```

不做共享包的理由：
- `wanxing-borrowed-contracts` 明令禁止跨仓进程内 import。
- 共享包会让三个仓的发布互相绑定：改一个 slug 边界要三仓同时升版。
- 夹具是**数据**，可以被任何语言、任何仓消费，且升级夹具本身是显式动作（改一个 JSON 文件），不会因为某个仓没升级就静默错位。

夹具必须包含的边界。**下表是实测值**（`node -e` 跑过现行实现，不是推演），因为这套替换有三处反直觉：

| 输入 | 期望 | 说明 |
|---|---|---|
| `/packs/Law_Bench/assistant` | `packs-law_bench-assistant` | 前导斜杠剥除 + 大写转小写 + 下划线保留 |
| `Packs/Law Bench/x` | `packs-law-bench-x` | 空格归并为 `-` |
| `a//b` | `a-b` | 不允许字符的**连续段**归并为一个 `-`（正则带 `+`，贪婪） |
| `a - b` | `a---b` | 但「本身允许的 `-`」夹在两段不允许字符之间时会**叠加**——同一条规则的两个方向 |
| `中文/包` | `-` | 整串是不允许字符的单一连续段，归并为一个 `-` |
| `a中b` | `a-b` | 非 ASCII 夹在 ASCII 之间 |
| `  a  ` | `-a-` | 首尾空白也变 `-`（只有**前导斜杠**会被先剥掉，空白不会） |
| `""` / `///` | `""` | 空进空出，不抛错 |
| `/a/../b` | `a-..-b` | 点号是允许字符，原样保留 |
| `packs-a-b` | `packs-a-b` | 已 slug 化者幂等 |

`a//b → a-b` 与 `a - b → a---b` 这一对必须同时进夹具：它们合起来才是完整语义（不允许字符的连续段归并、但允许字符原样保留并因此可叠加）。任何一方「顺手把多余 `-` 压掉」，都会立刻制造跨仓身份漂移；只测其中一条会漏掉另一半。

### D2 · 编址表是声明，不是代码分支

`services/wanxing-facade/env.js` 的形态：

```
UPSTREAMS = {
  registry:      { canonical: "AGENT_SERVING_REGISTRY_URL", aliases: ["REGISTRY_URL"],
                   token: { canonical: "AGENT_SERVING_REGISTRY_TOKEN", aliases: ["MARKET_REGISTRY_TOKEN"] } },
  ...
}
FAMILIES = {
  facade:    { registry: {...}, packs: {...}, sub2api: {...}, memory: {...}, facet: {...}, observer: {...} },
  observer:  { registry: { canonical: "FLEET_REGISTRY_URL", token: { canonical: "FLEET_REGISTRY_TOKEN" } }, ... },
  collector: { observer: { canonical: "OBSERVER_URL", token: { canonical: "FSC_TOKEN" } } },
}
```

解析器只做三件事：按 `canonical → aliases` 顺序取第一个非空；`required` 缺失时返回明确的缺失变量名；永不填默认值（`packsInternalBase` 的 loopback 缺省是既有行为，保留为表里的 `default` 字段，且注释说明它是「同进程挂载」的便利而非产品缺省）。

**不改任何变量名**。表只声明「现在认哪些」，把散落处收拢。这条边界很重要：本次是收敛实现，不是改契约。

### D3 · 为什么必须同时修那处记忆别名不一致

`memory.js:30` 与 `routes.js:203` 对同一上游接受不同别名集合。这不是理论问题：`CELL_MEMORY_URL` 是 paas 侧的叫法，`FD_MEMORY_URL` 是萬星部署已配的叫法。若某台部署只配了前者，对话车道（`memory.js`）工作、记忆可见页（`routes.js`）503——而 503 的文案是 `MEMORY_LANE_UNCONFIGURED`，看着像「没配」，实际是配了但这条路径不认。

修法：两处都走 `env.resolve('memory')`，别名集合取并集且顺序固定（`CELL_MEMORY_URL` 优先，延续 `memory.js` 的既有优先级注释）。

### D4 · 生命周期写逻辑：夹具锁载荷，不锁代码

暂停/恢复的**真相**是 registry 的 `metadata.paused`，这一点没有分歧，也不需要合并——两个门写同一份真相是允许的。分歧在**写这份真相的规则**：

```
门面 console.js:36 setPaused          paas lib/agent-serving.js:434 setAgentPaused
  读 entry ──────────────────────────── 读 entry
  置/删 metadata.paused                  置/删 metadata.paused
  PUT /api/agents{path}                  upsert(...)
    ↓ 失败                                 ↓ 失败
  POST /api/agents/register              upsert 内部同一兜底
```

两段实现今天行为一致，差异在细节的可漂移处：`paused=false` 必须**删键**而不是写 `false`（否则 registry 里会留下一个显式 false，而下游一律按 `=== true` 读，语义虽同但形状不同，未来的消费方会踩）；失败时 update→register 的双段兜底顺序；以及错误码归一（都是 502）。

门面那份的注释写着「keep in lockstep until ②-收敛」——那句话是 2026 年 10 月留下的待办，至今没执行。本 change 的做法与 D1 同构：**发布载荷夹具，两个实现各自跑**。夹具的 case 要包含 resume 的「删键」断言，因为那是唯一一处「看起来等价、其实不等价」的地方。

为什么不做共享模块：同 D1（跨仓共享代码违反借用契约，且把两个仓的发布绑在一起）。为什么不能只靠人工 review：写路径的漂移不产生错误，只产生**两个门在某个边界条件下给出不同结果**，而没有人会同时点两个门。

### D5 · 副作用方向（安全性论证）

统一别名集合只会**扩大**可识别集合，因此：
- 原本能解析的部署：解析结果不变（canonical 优先顺序保持）。
- 原本解析不到的部署：现在解析得到，功能从 503 变可用。
- 不存在「原本可用、改后不可用」的路径。

这条论证要写进 tasks 的验收，因为它是「零风险」主张的唯一依据。

## 3. 不做（划界）

- 不删 paas 侧的副本（`retire-wanxing-twin-face` 的范围）；本 change 只要求它「若还在，就过同一份夹具」。
- 不引入配置校验的启动失败（缺 env 仍是运行期显式降级，不改成 boot 崩）。
- 不改 `wanxing-borrowed-contracts` 的优先级约束（契约层由 `close-wanxing-domain-linkage` 落）。

### 归档顺序（必读）

本 change 与 `close-wanxing-domain-linkage` **都改 `wanxing-facade` 能力**，但改的是不同 requirement：

| change | 触碰的 requirement |
|---|---|
| `close-wanxing-domain-linkage` | 「The public catalog serves server-side facets…」改（MODIFIED）+ 两条新增 |
| `unify-wanxing-shared-semantics` | 新增「Outbound dependency addressing resolves through one declared table」 |

因此**必须先归档 `close-wanxing-domain-linkage`，再归档本 change**。若反序，第二份 delta 的 ADDED 仍可落地（它不依赖前者的 requirement 文本），但归档时 `~ N modified` 的对账会因前者还没合入而少一条，容易误判成漏改。照 AGENTS.md 的对账纪律：归档后逐条比 `Totals: + A, ~ M, - R, → N` 与实际 requirement 数。

## 4. 风险

| 风险 | 处置 |
|---|---|
| 统一别名后某个面从「显式未配置」变成「配上了但连不通」 | 只在别名并集内变化，且原语义是「同上游」；验收含「未配置仍 503」用例 |
| 夹具被当成实现规范而反向改代码 | 夹具注释写明「描述现行行为」；改动夹具需同时改三方测试，属显式动作 |
| observer 与 facade 变量族不同导致误以为该合并 | 表里显式记录两者是同一上游的两个族；不合并名字（部署已按各自族配置） |

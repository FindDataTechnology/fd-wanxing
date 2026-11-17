# sub2api 虚拟用量镜像——上游契约（add-serving-plans D6，非阻塞）

> 目的：让套餐/外部结算的消费在调用者自己的 sub2api 面板可见。v1 权威账在萬星
> facade（`wanxing_usage`，settler 维度），本端点只做**镜像写入**——上游缺失不影响
> 套餐任何行为。择机递交上游 [Wei-Shaw/sub2api](https://github.com/Wei-Shaw/sub2api)。

## 端点

`POST /api/v1/admin/usage`

- 鉴权：admin 会话/API 凭据（与现有 admin 面一致），非用户 token。
- 幂等：`external_id` 唯一——重复提交返回首次结果（200 + `duplicate: true`），不双记。
  萬星侧以 facade usage 行 id 作 `external_id`（与边界结算的幂等键同一纪律）。

```json
{
  "external_id": "wu_<hex>",
  "user_id": 7,
  "minutes": 3,
  "note": "wanxing plan wp_ab12cd (agent packs-p1-heal)",
  "recorded_at": 1760000000000
}
```

- 响应：`{ ok: true, usage_id: <n>, duplicate: false }`；校验失败 400；未知用户 404。
- 语义：纯记账展示行（不移动余额、不触发配额窗口）——金额/配额语义归 sub2api
  既有机制，镜像只解决"面板上看得到"。

## 为什么不是 adjustBalance

admin 面现有 `adjustBalance` 是纯余额移动、无用量记录：镜像走它会污染余额语义
（套餐结算不动真实余额）。虚拟用量是独立只增展示层。

## 萬星侧接入（上游落地后）

facade 的 plan 结算路径（`trySettle` settler='plan' 分支）在 mark settled 后
fire-and-forget 镜像写入，失败仅记日志不重试不阻塞——账本权威在 facade，镜像
最终一致即可。接入前零依赖。

## 实现状态（2026-11-17）

**上游侧（sub2api）**：`feat/admin-usage-mirror` 分支已实现，**未合入、未上产**。
落地形态与本文档有两处必须一起读的细节：

1. **落在独立表 `usage_mirrors`，不写 `usage_logs`。** 线上库实测（2026-11-16）：
   `usage_logs.user_id / api_key_id / account_id` 三个列都是 `NOT NULL`，且带
   `usage_logs_{user_id,api_key_id,account_id}_fkey` 三个真外键。而一次套餐结算
   既没有上游账号、也不属于某个 API Key 的逐次调用 —— 硬塞只能借一个真实
   api_key/account 的 id 冒充出处，等于在计费台账里写假 provenance。镜像因此
   有自己的表（`migrations/254_add_usage_mirrors.sql`），只增不改。
2. **幂等靠唯一索引，不靠 TTL。** `idx_usage_mirrors_external_id_unique` +
   `ON CONFLICT (external_id) DO NOTHING`：命中即读回首次那行并回
   `duplicate: true`。刻意没用仓内通用的 `IdempotencyCoordinator`（那是
   `Idempotency-Key` 头 + 24h TTL 的请求级去重），因为**结算单号的重放可能发生在
   几个月后**，而镜像要的是永久幂等。
3. **响应刻意不用 `{code,message,data}` 信封**：本文档与上游递交稿都按
   `{ok, usage_id, duplicate}` 三个顶层键读；facade 客户端的 `call()` 是
   `doc.data ?? doc`，两种形状都能落地，所以选契约优先。
4. 读面两条，视角不同、边界也不同：
   - `GET /api/v1/admin/usage/mirrors?user_id=&limit=`——运营/排障视角，按 user_id
     查任意人（默认 50 / 上限 200，走标准信封）。
   - `GET /api/v1/usage/mirrors?limit=`——**本人视角**，user_id **只**取登录主体，
     query 里的 `user_id` 一律不读、也不校验（去校验它反而会让人以为它有用）。
     这是反越权的那条判据，单测里承重的就是它：主体 42 + `?user_id=99` ⇒ 仓储仍收到 42。
5. **面板已接**：`frontend/src/components/user/UsageMirrorsCard.vue` 挂在用户用量页
   （`views/user/UsageView.vue`）统计卡下方，三档形态（loading / 空 / 读失败＋重试）。
   读失败只降级这张卡，不动页面上任何计费与配额读数——镜像终究只是展示面。

**萬星侧（facade）**：`trySettle` 的 `settler === "plan"` 分支在
`store.usageMarkSettled()` 之后调用 `mirrorPlanUsage(row)`（`services/wanxing-facade/core.js`），
客户端方法在 `lib/sub2api-admin.js: mirrorUsage`。三条纪律写在代码里：

- **不 await**：镜像慢或挂不会拖慢/失败结算；
- **同步抛错也吞掉**（`Promise.resolve(...)` 包住调用 + `try/catch`）：老客户端
  或坏构建里 `mirrorUsage` 不存在时，结算同样不受影响；
- 只有 `settler === "plan"` 走镜像：`mission` 行与 legacy 余额结算都不镜像。
- **`minutes` 必须整数**：sub2api 侧该字段是 Go 的 `int`，JSON 里出现 `2.4` 会让
  `ShouldBindJSON` 直接回 400，而镜像失败只打一行 warn（看着像网络抖动、其实每次都失败）。
  上游今天由 `Math.ceil` 产生、恒为整数，facade 仍在发送前 `Math.round`：展示面以分钟
  为单位，取整不动结算（结算照原 `minutesBilled` 扣 plan）。
- **失败日志带 HTTP 状态**：`[wanxing:mirror] usage mirror failed for <wu_id> (status <code>): <message>`。
  客户端把状态码挂在 error 上（`lib/sub2api-admin.js` 的 `Object.assign(new Error(...), { status })`），
  而只打 message 时 `404`（端点未上产）、`400`（载荷/校验）、`401`（凭据）、`502`/`n/a`（传输）
  在日志里完全同形。上产后排障就看这一个字段，不用改代码猜。


单测在 `scripts/test-wanxing-plans.mjs` 的 `D6 …` 四臂（一条镜像一次、reject /
throw 两种失败都不改结算、非 plan 不镜像），本机实跑 18/18 绿；红证＝把
`mirrorPlanUsage(row)` 摘掉后同份套件 3 红 15 绿，复原后回绿。客户端那一跳另有一臂
（`test-wanxing-facade.mjs`：五个键逐字、`x-api-key`、duplicate 可读），73/73 绿，
红证＝把 `user_id` 改名后该臂当场 ✗。

**上游 SQL 已在生产库验过（2026-11-17，事务内 ROLLBACK）**：同构 DDL 实跑给出
「首次插入 1 行 / 同键第二次 0 行 / 读回首次那行 / 行数恰 1 / 唯一索引在 / 回滚后无残留」。
这一步补的是 Go 单测用替身证不了的地方——`ON CONFLICT … RETURNING` 在冲突时到底返回
什么，以及「读回的是首次那行」是否成立。

**面板那一跳的本机读数（2026-11-17）**：`UsageMirrorsCard.spec.ts` 四臂（渲染一条镜像的
分钟与说明、空档、读失败＋重试后恢复、缺 `items` 的坏载荷退化成空档而不是崩）**4/4 通过**；
红证＝把组件里 `loading` 初值改成 `false`，那条「loading 档不许冒充空档」当场转红
（1 失败 / 3 通过），复原回绿。**这一跳是本机真跑的**（vitest + jsdom + `@vue/test-utils`），
与「Actions 被计费拦住」无关。

**仍未验的**：真机端到端（上游未合入未上产）、以及 sub2api 那侧 Go 单测的**执行**
（账号 GitHub Actions 被计费拦住，作业 `steps: []` 即失败；本机按硬规则不跑 Go 测试）。
`go vet` 也只能算「编译过」而不能替代测试：2026-11-17 这一轮本机 vet 编译整图超过
500s 被上限杀掉（`VET_EXIT=124`），所以那天的两包 vet **不作已验证项**。



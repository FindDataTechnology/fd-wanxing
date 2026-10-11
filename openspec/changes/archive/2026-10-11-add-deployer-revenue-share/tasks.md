# Tasks: add-deployer-revenue-share

## 1. 账本与 store 层

- [x] 1.1 `store.js`：`wanxing_deployer_earnings` 表（usage_id 主键/deployer_user_id/deployer_email/agent_slug/revenue_usd/amount_usd/commission/status CHECK pending|settled|void/created_at/settled_at）+ meta 键 `share_epoch`。验证：全新库建表、旧库增量建表两态单测。
- [x] 1.2 `store.js` 访问器：`earningsInsertOrIgnore(row)`、`earningsGet(usageId)`、`earningsMarkSettled(usageId)`、`earningsPending()`、`earningsForDeployer(userId, {limit})`、`earningsTotals(userId)`、meta 读写（`metaGet/metaPut`，若无则补）；外加补账查询 `usageSettledSinceWithoutShare(epoch, limit)`（settled、settler 空、minutes>0、LEFT JOIN 无孪生）。验证：单测覆盖幂等插入（同 usage_id 二次插入零效果）、状态迁移、合计口径（settled/pending 分列）。

## 2. 结算钩子（facade core）

- [x] 2.1 `core.js`：cfg 增 `shareCommission`（`WANXING_SHARE_COMMISSION`，默认 0.30，越界回默认+WARN——启动期一次）。验证：单测三档（默认/合法覆盖/非法回退）。
- [x] 2.2 部署者解析：`resolveDeployerUser(slug)`——deployments 快照按 slug 取 `deployedBy` → `sub2api.findUserByEmail` → `{userId, email}`，5 分钟 TTL 缓存（对齐 subsidyHolderCache 形状）；快照无此 slug 或无 deployedBy → null（非错误）。验证：单测 mock 快照+sub2api，覆盖命中/未命中/缓存复用/解析失败四态。
- [x] 2.3 `trySettle` 钩子：`usageMarkSettled` 之后（subtract 成功分支与 duplicate 分支两处）调 `creditShare(row)`——资格判定（channel/settler 空、minutes>0、部署者解析成功、deployer≠caller）→ `earningsInsertOrIgnore` → 已 settled 则跳过 → `adjustBalance add`（幂等键 `share:<usage_id>`）→ 成功或 duplicate 拒绝 → mark settled；任何异常吞掉记日志（不阻塞扣款主路径、不 suspendCaller）。验证：单测覆盖 2.2 全资格矩阵（外部真金/plan/mission/chat 各 settler/自调/waived）+ 幂等（二次 creditShare 零重复）+ add 失败留 pending + duplicate 拒绝视为已入账。
- [x] 2.4 扫尾：`settlePending` 每轮追加——(a) `earningsPending()` 重试 credit；(b) 首轮写 `share_epoch`（已存在不覆盖），补账扫描纪元后缺孪生的已结算 usage 行走同一 creditShare。验证：单测——crash 窗口行被补账、纪元前行不动、补账幂等。

## 3. console 面

- [x] 3.1 `selfservice.js`（或 console 挂载处）：`GET /api/wanxing/v1/console/my/earnings`——verified deployer 身份门（ops 拒收，同 my/packs 纪律）；响应 rows（≤50，倒序）+ totals{settledUsd, pendingUsd, turns}。验证：路由单测——合法身份拿到投影、ops 403、跨部署者隔离。
- [x] 3.2 `wanxing-web` deploy-panel 收益区：合计两行+近期明细+加载/降级态（沿 invocation-records 降级纪律）；i18n 按仓内机制补齐。验证：vite build 绿（仓内无组件测试框架与 i18n 机制——ConsoleView 为硬编码中文，随生产冒烟 4.3 覆盖三态）。

## 4. 验收与上线

- [x] 4.1 全量测试门：fd-wanxing 全套件绿 + lint/typecheck/build 绿。
- [x] 4.2 上线（标准线）：镜像滚 facade+web → 生产 in-pod 实证 `/api/wanxing/v1/console/my/earnings` 200。
- [x] 4.3 生产探针：以外部调用者（≠部署者）真跑一程 A2A 回合 → usage 行 settled + earnings 行 settled + `share:` 入账在 sub2api 侧可见 + deploy-panel 收益区显示该行；自调一回合确认零分成；（如环境可得）plan 回合零分成。**PROBE PASS** 后归档。
- [x] 4.4 归档本 change（delta 并入 specs），paas 路线图文档 M3 ④ 状态更新为「已实施」。

## 1. 身份夹具（先写契约，再改实现）

- [ ] 1.1 新增 `contracts/agent-identity.fixture.json`：`{ "x-contract-rev": "1", "cases": [{ "input": "...", "expect": "..." }] }`，覆盖 design D1 表里的 10 条边界（尤其成对保留 `a//b → a-b` 与 `a - b → a---b`），每条带 `note` 说明它锁的是什么。验证：`node -e` 直接跑现行 `slugFor` 对全部 cases，10/10 相符——**夹具先证明它描述的是今天的真实行为**
- [ ] 1.2 夹具自检脚本 `scripts/check-agent-identity-fixture.mjs`：读 JSON、跑本仓 `identity.js`、逐条比对，不符打印 `input / expect / actual` 三元组并 EXIT=1。验证（必须证明能红）：把某条 `expect` 手改成 `"wrong"` → EXIT=1 且打印该条；改回 → EXIT=0

## 2. 身份单源（仓内收敛）

- [ ] 2.1 新增 `services/wanxing-facade/identity.js` 导出唯一 `slugFor`。验证：文件内只有一处正则实现，且被 1.2 的自检跑绿
- [ ] 2.2 门面内三处改为 import 同一模块：`core.js:26-27` 的定义移入 `identity.js` 并在 `core.js` 保留 re-export（既有导入方 `bookkeeping.js:14`、`cluster.js:19`、`routes.js:17` 都不必改）；`selfservice.js:60` 的 `const` 定义删除改 import；**`console.js:227` 的内联表达式改为调用 `slugFor`**（这一处没有函数名，按声明名 grep 找不到，是漏网的主要原因）。验证：`grep -rn "A-Za-z0-9._-" services/wanxing-facade/` 只剩 `identity.js` 与 `RUNNER_ID_RE`（后者是 runner id 正则，不是身份函数，需在测试里白名单注明）
- [ ] 2.3 观测面两处改为 import 同一模块：删 `bookkeeper.js:45` 的 `const` 与 `observer.js:26` 的函数体。验证：`node --test scripts/test-fleet-observer.mjs` 全绿（rollup 身份相关既有用例的期望值不改）
- [ ] 2.4 本仓副本数归零校验：用**表达式**而不是声明名计数——`grep -rn "replace(/^\\\\/+.*A-Za-z0-9" services/ | grep -v RUNNER_ID_RE` 只应命中 `identity.js` 一处。验证：命令输出恰一行；并断言「按 `function slugFor` 计数的结果 ≥ 按表达式计数的结果」这一反例已被消除

## 3. 生命周期写规则（夹具先行）

- [ ] 3.1 新增 `contracts/lifecycle-write.fixture.json`：cases = 输入 `{ entry, paused }` → 期望的 upsert 载荷，至少覆盖：(a) 无 metadata 的 entry + pause；(b) 有 metadata 的 entry + pause；(c) 已 pause 的 entry + resume（**期望里 `paused` 键不存在**，这条是规则的核心）；(d) resume 一个从未 pause 的 entry（幂等，载荷与入参等价）。验证：用现行 `setPaused` 跑全部 cases，逐条相符（先证明夹具描述今天的真实行为）
- [ ] 3.2 `services/wanxing-facade/console.js:36 setPaused` 改为读夹具校验的实现点，并删掉「minimal copy, keep in lockstep until ②-收敛」那句 TODO（改为指向夹具）。验证：`grep -n "keep in lockstep" services/` 零命中；夹具测试绿
- [ ] 3.3 跨仓（由 `retire-wanxing-twin-face` 承接）：`paas/lib/agent-serving.js:434 setAgentPaused` 加一条跑同一夹具的测试。验证：paas 侧改 `delete` 为 `= false` → 该测试红
- [ ] 3.4 两个门的观测一致性：断言暂停后 facade 的 `GET /console/deployments/:slug` 与壹座部署行读到的 `paused` 同值。验证：单测用同一 registry 假件，两侧读出相等

## 4. 编址表与解析器

- [ ] 4.1 新增 `services/wanxing-facade/env.js`：声明表（upstream × component → `{canonical, aliases[], token, default, required}`）+ `resolve(component, upstream)`。表内按 design D2 覆盖 7 个上游：registry / packs / sub2api / memory / facet / observer / agent-runner（最后一条经 registry 代理，无独立变量，表里标 `proxied: true` 说明为何空）。验证：单测对每个上游断言 `canonical` 优先于 `aliases`，且两者皆空时返回 `{ value: null, missing: [<变量名>] }`
- [ ] 4.2 修记忆双规则不一致：`routes.js:203` 的 `memoryFetch` 改用 `resolve("facade","memory")`，别名集合与 `memory.js:30` 取并集且顺序一致（`CELL_MEMORY_URL` 优先，保全 `memory.js` 既有注释的优先级声明）。验证：单测两个用例——只配 `CELL_MEMORY_URL` 时 `memoryFetch` 与 `createMemorySeam` **都**得到非空 url；只配 `FD_MEMORY_URL` 时两者也都得到
- [ ] 4.3 其余出向读取改走解析器：`routes.js` 的 registry/packs/observer、`core.js` 的 sub2api、`selfservice.js` 的 facet、`fleet-observer/index.js` 的 registry/sub2api、`stats-collector/collector.mjs` 的 observer。验证：`grep -rn "process\\.env\\.[A-Z]" services/wanxing-facade services/fleet-observer services/stats-collector` 除 `env.js` 与 `WANXING_*` 自身配置项外无借用上游命中（白名单写进任务备注）
- [ ] 4.4 未配置仍显式降级：三个面各一条用例——自助通道缺变量 → 503 且指名变量（与 `close-wanxing-domain-linkage` 4.1 同一断言，此处只保证解析器不吞掉）；sub2api 缺 → 准入 503 `WANXING_BILLING_UNAVAILABLE`；memory 缺 → 控制台记忆面 503 `MEMORY_LANE_UNCONFIGURED`。验证：三条用例全绿

## 5. 变量表可执行化

- [ ] 5.1 `scripts/check-env-table.mjs`：从 `env.js` 的声明表抽出全部变量名，逐个断言「源码里至少被读取一次」，并反向断言「源码里出现但不进表的借用上游变量」清单为空。验证（必须证明能红）：在表里加一个不存在的 `FOO_BAR_URL` → EXIT=1 并指名；在代码里加一处 `process.env.BAR_BAZ` → EXIT=1 并指名
- [ ] 5.2 `README.md` 借用契约段的变量表改为从 `env.js` 生成或与之逐行对齐（人工校对一次后加注「以 `env.js` 为准」）。验证：README 表中每个变量名都能在 4.1 的清单里出现

## 6. 跨仓（由 paas 仓 `retire-wanxing-twin-face` 承接）

- [ ] 6.1 `paas` 侧三处活语义各加一条跑同一夹具的测试：`agent-runner/fleet.js:16`、`facet/supply-catalog.js:50`、**`web/src/components/packs/PackDetailDialog.tsx:77`（前端，`wanxingSlugFor`）**。前端那条用 vitest/既有 web 测试栈跑同一 JSON 夹具（夹具是数据，跨语言可用）。验证：三处各一条绿；把任一处规则改成「合并连续 `-`」→ 对应测试红
- [ ] 6.3 `paas/scripts/` 三处探针内联副本（`probe-harness-materializer-live.mjs:124`、`probe-deployment-secrets.mjs:71`、`bench-wanxing-bookkeeping.mjs:37`）改为从 `facet/supply-catalog.js` import 或在文件头注明「与夹具同步、仅供探针」。验证：`grep -rn "A-Za-z0-9._-" paas/scripts/` 的命中数从 3 降到 0 或 3 处均有注明
- [ ] 6.2 若 `paas/gateway/wanxing/` 仍在，其 `core.js:26` 也必须过同一夹具（删或改，二选一，由那个 change 决定）。验证：paas 侧夹具测试覆盖到该文件或被明确标注为「已删」

## 7. 收口

- [ ] 7.1 `openspec validate unify-wanxing-shared-semantics --strict` 通过
- [ ] 7.2 全仓测试绿：`npm test`（19 个 `scripts/test-*.mjs`）无新增失败
- [ ] 7.3 生产核对（出片后）：`kubectl exec` 进 facade pod，`env | grep -E "CELL_MEMORY|FD_MEMORY"` 与 `env | grep FLEET_OBSERVER` 各看一眼，确认线上配置的是哪一族；随后 `curl -s $FACADE/api/wanxing/v1/status` 与记忆可见页各打一次，两个面都不 503（**这是「同一上游两面一致」的现场证据**）

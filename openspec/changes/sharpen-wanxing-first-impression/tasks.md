# Tasks

## 1. facade：活跃度排序参数

- [x] 1.1 在 `services/wanxing-facade/a2a.js` 的目录路由里实现 `sort=activity`：一个纯函数
      `orderByActivity(entries)` 完成 `featured desc → status rank(serving,idle,unknown,paused) →
      turns7d desc → name.localeCompare asc` 全序。验证：`node --test scripts/test-wanxing-facade.mjs`
      通过，且新函数被单独引用（不内联在路由体里）。
- [x] 1.2 把排序接在**过滤之后、分页之前**：`list` 先经过 q/category/featured/cluster 过滤，再
      `sort === "activity"` 时排序，最后 slice。验证：`?sort=activity&page=2&page_size=10` 的返回是
      排好序列表的第 11–20 项。
- [x] 1.3 未知 / 缺失 `sort` 值走原有路径。验证：`scripts/test-public-contract.mjs` 既有断言
      （无参数调用形状、`facets` 统计口径）全部保持通过，无需修改。

## 2. facade：排序断言

- [x] 2.1 新增断言：精选优先、在役先于尚无调用、同组按 turns7d 降序、并列按 name 决定性排序。
      验证：新测试在移除排序实现时必须失败（先写成红，再实现绿）。
- [x] 2.2 新增断言：`?sort=activity` 与无参数调用的 `total`、`facets.total`、slug 集合相等，仅顺序
      不同。验证：同一条测试内两次请求对比。
- [x] 2.3 新增断言：已暂停条目排在全部 serving/idle 之后。验证：构造三条（serving / idle / paused）
      的夹具，断言末位是 paused。

## 3. web：首屏与目录接上顺序

- [x] 3.1 `IntroView.jsx` 的 `LandingAgents` 取数 URL 加 `&sort=activity`。验证：
      `wanxing-web/test/views.test.jsx` 中断言请求 URL 含该参数（stub fetch 捕获）。
- [x] 3.2 `CatalogView.jsx` 的列表请求加 `sort=activity`，并在搜索框附近加一句顺序口径说明
      （精选 → 在役 → 尚无调用）。验证：目录页渲染后该说明文本存在（`data-testid` 可取）。
- [x] 3.3 对未知参数降级不写代码，只在测试里覆盖：模拟返回 registry 序的响应，断言卡片照常渲染、
      无错误横幅。验证：`views.test.jsx` 新增一条。

## 4. web：集合入口

- [x] 4.1 `App.jsx` 的 `ENTRIES` 与顶栏 `tab()` 序列各加一条「集合」→ `#/collections`，不受登录态
      影响。验证：未登录渲染下该链接存在（`views.test.jsx` 断言）。

## 5. 收口

- [x] 5.1 全量测试：`cd fd-wanxing && npm test` 与 `cd wanxing-web && npm test` 均绿。
- [ ] 5.2 上产前在真机核对首屏：首屏首张卡必须是 serving（或 featured）条目，且 catalogue 第一页
      与 `?sort=activity` 的返回值一致。验证：对线上 `GET /agents?page_size=6&sort=activity` 与页面
      渲染顺序取人工对照截图。
  - **2026-11-22 12:05 实测：验收前提不成立，卡在部署源不可达。**
    `GET /api/wanxing/v1/agents?page_size=6&sort=activity` 返回
    `503 {"code":"DEPLOYMENT_SOURCE_UNAVAILABLE","message":"deployment source unreachable (snapshot hard-stale)"}`；
    `GET /api/wanxing/v1/status` 同源症状（`agents` 与 `turns7d` 都是 `stale:true, value:null`，
    只有 `settlement_pending` 因为是账本直读而正常）。
  - **根因不在 wanxing**：facade 的部署源是 `PACKS_INTERNAL_BASE_URL=http://platform:3100`，
    而 `kubectl get endpoints -n fd-prod platform` = **`100.64.0.14:3100`** —— 那是失联的 cheap-7。
    铁证链：platform Deployment 钉死 cheap-7 + hostPath ⇒ cheap-7 NotReady ⇒ endpoint 指向不存在的
    节点 ⇒ facade 拿不到部署快照（硬陈旧窗 5 分钟）⇒ 503。
  - 这一条是 `cheap-7` 失联的**第四个受害者**（前三个：platform 502、token 503 已修、
    fd-zhesi-api Pending）。**它不需要改代码**，等节点回来会自动恢复。
  - 届时的验收动作不变：`GET /agents?page_size=6&sort=activity` 的头条必须是
    serving/featured，且与 `/agents` 页面首屏渲染顺序一致（截图对照）。

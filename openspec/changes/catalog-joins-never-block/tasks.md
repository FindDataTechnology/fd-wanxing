# Tasks

## 1. SWR 化五个 join 读者

- [x] 1.1 抽 `createSnapshotCache({ load, ttlMs })`（与 `bookkeeping.js` 同形而更轻：`{at, value}` +
      单飞；cold await、fresh 直返、expired 后台刷新并返上一份；失败保留上一份）。
- [x] 1.2 接入 `curationMap`、`clusterMap`（`details` 旁路留在装载函数内）、`connectorDeclarations`、
      `turns7dMap`、`snapshotClusterUnits`。
- [x] 1.3 给 `turns7dMap` 与 `snapshotClusterUnits` 补单飞（现状没有）。
- [x] 1.4 确认 `GET /agents` 的 `Promise.all` 里不再有会阻塞的读者；`/status` 走同一批缓存。

  验收：`npm test` 全绿；`grep` 五个读者不再各自持有 `at/inflight` 逻辑。

## 2. 语义单测（红绿）

- [x] 2.1 新增 `scripts/test-catalog-joins-swr.mjs`，覆盖四个场景：
      - 过期不阻塞：装载函数人为延迟 200ms，冷启动后等过 TTL 再请求，断言请求在延迟结束前返回；
      - 冷启动阻塞一次：首请求拿到完整数据，第二请求不再等；
      - 并发共享一次刷新：过期瞬间并发 N 个请求，装载函数只被调用一次；
      - 刷新失败保留上一份：装载函数交替成功/失败，失败轮目录仍带上次字段。
- [x] 2.2 先红后绿：在改实现前跑一次确认用例能抓到当前阻塞行为（临时 worktree 跑 HEAD：过期读等了
      410ms → 断言失败；改后 6/6 绿）。

  验收：`NODE_ENV=test node --test scripts/test-catalog-joins-swr.mjs`；再跑全量 `npm test`。

## 3. 计时探针

- [x] 3.1 新增 `scripts/probe-catalog-latency.mjs <base>`：丢弃首请求；3 轮「空闲 >61s → 计时
      `/api/wanxing/v1/agents`」并同法计时 `/api/wanxing/v1/status` 作基线；输出 JSON（每轮值 + p50 +
      差值）。
- [x] 3.2 记录改前基线（2026-11-27 外网，3 轮）：`/agents` p50 **1060ms**，`/status` p50 **82ms**，
      差值 **978ms** → above-target。上产前用同一探针对现网复测一次的结果与之一致。

  验收：探针在现网可跑并输出可读对照。

## 4. 出片与上产

- [x] 4.1 推 main，等 `images.yml` 全绿（run 46018764402：test + 三镜像 build 全 success；web/observer
      内容未变不铸新 tag，facade 铸 `sha-faac3c7`）。
- [x] 4.2 `fd-infra-deploy/all-services/prod/wanxing-facade.yaml` 滚 tag（commit `772cb321`，github+gitee
      双推）。⚠ ArgoCD repo-server 全员 Evicted（cheap-4 / liuliang 节点 DiskPressure），GitOps 未消费；
      已用 `kubectl set image` 滚到同一 tag，pod 1/1 ready、0 重启。
- [x] 4.3 上产核一次：`/status` 200、目录 200（20 agents）；日志无 error/warn。usage 镜像的客户面板
      可见性需要一笔真实 plan 结算才能验，本窗口未验（代码由 plans 单测覆盖）。

## 5. 验收与收口

- [x] 5.1 上产后跑探针 3 轮（`acceptance.md`）：外网 p50 `/agents` **1060ms → 254ms**（4.2×）；
      差值 161ms 仍 above-target，但 pod 内实测两边 4–6ms / 3–9ms，服务端差≈0，外网余量是外围抖动。
- [ ] 5.2 `openspec validate catalog-joins-never-block`；delta 同步进 `openspec/specs/wanxing-facade/`；
      归档到 `openspec/changes/archive/` 并 push。

## 本 change 之外（同批推进，不在此清单）

- issue #1：先做 B 选项（给 `wanxing-ops-mcp` 条目加 required group，收口内网 topology 泄漏），
  A 选项（网关鉴权 + 公网端点）另议。
- C 面（控制台部署者视角）：先用 ego-browser 复拍五个 tab 再决定立什么 change。

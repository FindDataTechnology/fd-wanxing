# add-fleet-cell-views — 任务清单

## 1. observer

- [x] 1.1 `store.js`：EVENT_KINDS 收 `cell_stats`（枚举注释）
- [x] 1.2 `observer.js` board：`cells` 段（30 分钟窗最新/agent）+ `shortterm` 汇总
       （cells/running/queued/workers busy/idle/cap，防御式求和）；不进 agents/states
- [x] 1.3 `scripts/test-fleet-observer.mjs` 追加：cell_stats 摄取+cells/shortterm 合成；
       空窗口保形；agents_total 不变；未知 kind 仍 400

## 2. console

- [x] 2.1 OpsView：短期执行区（汇总条+每 cell 行+采样年龄）+ runners 行 pod 徽标 +
       未升级降级提示
- [x] 2.2 web 构建/lint 过

## 3. 发布与实证

- [x] 3.1 observer+web 发布线滚产（先于 paas 侧开门）
- [x] 3.2 生产眼见：paas 配 env 后 board cells 填充、OpsView 统一视图渲染（与 paas 仓
       change 的 5.2 同一验收）

## 追记（2026-10-15 全项收口）

- **1-2 全绿**：EVENT_KINDS 收 `cell_stats`；board cells/shortterm 两段（30 分钟窗最新/
  agent；防御式求和）；**rollupHour 显式排除 cell_stats kind**——rollup 对任意 kind 先建
  agent 累计行，不排除则 cell: 身份泄漏进 agents_total（首测即抓到 agents_total=3 期望 1，
  改后隔离干净）。observer 测试 8→11。OpsView 统一视图（汇总条+每 cell 行+采样年龄+pod
  徽标+未升级降级）。全量 135/135、web build 绿。提交 e3f0408。
- **3.1 出片**：FDT org 私有 CI 额度尽（2011/2000，images workflow 5 秒即终）→ 走 T2
  通用池双快照：fleet-observer=git archive 全仓+Dockerfile `ARG SERVICE` 默认改 observer
  （testaction002 sha-9b45cf4）；wanxing-web=git archive 子目录（testaction003
  sha-daef5b8）。坑在册：**wanxing-web 的 45s boot 烟测天生误杀集群内反代镜像**（nginx
  upstream 用 k8s 服务名，烟测容器解析不了）→ 池 003 SMOKE_MODE=skip；fleet-observer
  首次构建撞**池变量竞态**（详见 paas 仓 change 追记）推错仓，重派后正确。
- **3.2 眼见**：board cells 段真 cell 遥测在流（读板 seen_at 精确 +30s）；agents_total=21
  常驻口径零污染；良机运维面浏览器级验收 7/7（paas 仓
  scripts/probe-wanxing-ops-unified.mjs：Logto 真登录→运维面→cells 2+2 行+
  runner-serving pod 徽标）。GitOps 89446e6 四滚动位 Ready。

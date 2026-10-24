# 交接文档 — polish-wanxing-console（萬星控制台打磨）

> 2026-10-24 14:15 交接。前序会话在 paas 会话中完成 Phase 1 + Phase 2 实现与本地走查，**卡在出片（tasks 4.1）**：auto-mode 安全分类器持续不可用（claude-sonnet-5 超时/错误），所有 `gh` 命令被拦，无法继续出片操作。本仓库 `~/finddata/fd-wanxing`（用户如有 zcode 本地文件权限可直接继续）。

## 一、当前状态（接手先读）

- **change**：`openspec/changes/polish-wanxing-console/`（proposal/design/tasks/specs 四件套齐，`openspec validate` 绿）
- **代码**：Phase 1 + Phase 2 全部实现并推 `origin/master`
  - `7c8fb85` 立项（四件套）
  - `c57dba3` Phase 1：抽屉 + toast + 每日序列图 + 懒加载
  - `026cfe0` Phase 2：accent + 字号阶梯 + 骨架屏 + aria
  - 三笔均为 `[skip ci]` 前缀（GitHub Actions 对 commit message 含 `[skip ci]` 的 push 跳过触发——出片需手动 `workflow_dispatch` 或普通提交）
- **tasks.md 勾账**：1.x/2.x/3.x 全勾（15 任务完成 11 个），**剩 4.1/4.2/4.3（出片、生产验收、归档）**
- 本地构建绿（`cd wanxing-web && npm run build`，产物 6 chunk）
- 仓内有**并行会话在途改动**（勿动、提交时显式路径）：`docs/adr/0004-*.md`（修改）+ `openspec/specs/copilot-intent-adherence/`、`scripts/eval-intent-*.mjs/.json`（未跟踪）

## 二、Phase 1/2 落了什么（验收时对照）

| 项 | 内容 | 关键文件 |
|---|---|---|
| 抽屉 | 六面板（配置/记录/记忆/额度/嵌入/允许清单）收编右侧抽屉，一次一个；Esc/遮罩/X 关闭；`#/console/<slug>` 深链开 config 抽屉；暂停/恢复留卡片 | `components/Drawer.jsx`、`views/console/FleetView.jsx` |
| toast | 写成功右下 3s 消失（role=status）；错误仍就地横幅（刻意单一职责，D2） | `components/Toast.jsx` |
| 每日序列图 | echarts@6 按需引入（Bar/Grid/Legend/Canvas），x=day 系列按 source/basis 分列不合并，dark 跟随系统；`stats-daily` testid 保留 | `components/DailyChart.jsx`、`StatsView.jsx` |
| 代码分割 | console/chat/collections/bundle 四面 React.lazy + 骨架 Suspense；单 bundle 408KB → 初始 283KB + ConsoleView 独立 chunk | `App.jsx` |
| accent | `#A6402F`（站标印章红，SiteMark「家族记号成套」）；@theme 四 token（accent/strong/soft/wash），dark 媒体覆盖提亮；31 处主操作/选中态 + 4 处链接已换 | `index.css` |
| 字号 | text-[10px]×29 全升 11px；SiteMark 阶梯行 1 处豁免（家族印章规范） | 全局 |
| 骨架+aria | Skeleton Lines/Cards 替换五处「加载中」；16 个裸输入补 aria-label；CatalogView 计数行保留文字（瞬态状态行非面板） | `components/Skeleton.jsx` |

**硬判据已过**：data-testid 改前 20 枚全保留 + 新增 2 枚（config-panel/allowlist-panel），零删除零改名。

**实现期修正探索稿两处**（记忆页已记）：①「8 折叠区」实为六面板（我的收益是常驻区非按需面板）；②`/api/fleet/v1/stats/daily` 接口已存在，纯 web 刀，facade 零改动。

**走查证据**：`gui-test-screenshots/`——`critique-*.png`（8 张）+ `p2-*.png`（4 张）+ `polish-console-*.png`（2 张）。走查方法 = ego-browser + CDP Fetch 拦截 mock 后端（配方见下 §五）。

## 三、剩余工作：tasks 4.1–4.3

### 4.1 出片（卡在这，以下按推荐序）

先 `fd-build-channel check` 判路（本次结论：**org 账号 FindDataTechnology 私有额度耗尽**——images.yml 三 run 全红 "payments have failed"，实为 2000 分钟用尽；私有池 testaction001–005 合计剩 ~8900 分钟；scs001/fd-wanxing-images 也是私有仓同样额度死）。

**推荐路：私有通用池 T2**（testaction005/build-pool，剩 1871 min；一次 web 镜像构建约 3–5 min Linux）：

```bash
# 泄漏门在工具内建：fd-build-snapshot 从远端 origin 干净 clone，私有→私有放行
fd-build-snapshot ~/finddata/fd-wanxing -R testaction005/build-pool \
  --namespace yizuo --image wanxing-web
# ⚠️ 通用池已知坑（记忆 build-pool-shared-repo-variables）：
# 1) BUILD_DOCKERFILE 会被抹——push 后立刻核对 run 的 "Resolve target" 步骤 DF= 行；
#    被清空会静默回落根 Dockerfile（facade），wanxing-web 镜像里跑的是 facade。
#    本仓根 Dockerfile.web 是 pool-context 变体（COPY 全锚根，注释自证），须 DF=Dockerfile.web。
# 2) 构建上下文=整仓根，web 构建只用 wanxing-web/ 子树——Dockerfile.web 已按此写好，无需改。
# 3) tag = 快照仓 commit 短 sha（非源仓真 sha）；commit message 里写明对应真 sha（c57dba3..026cfe0 范围）。
# 4) relay：yizuo/wanxing-web 已在 cheap-3 /etc/tcr-relay/repos.conf（既有行，工具自动核）。
```

**备选路 A（公开免费线，需要你拍板）**：把 `wanxing-web/` 子树（纯前端，gitleaks 已扫零命中，finddatatech 引用全是公开域名）推到公开快照仓 `scs001/platform-image-verify` 的独立分支 `wanxing-web` + 专用 workflow。workflow 已写好在交接现场 `/tmp/wx-pub/branch/.github/workflows/wanxing-web-image.yml`（80 端口冒烟 + push hkccr，同 sha-tag 契约）。**被拦原因**：auto-mode 分类器把「私有仓内容 → 公开仓」判为数据外泄拒绝执行——这是正确的门，即使内容已核干净也应由你显式拍板（或手动操作）。

**备选路 B**：等 org 额度下月重置（11-01）后直接 `gh workflow run images.yml -R FindDataTechnology/fd-wanxing --ref master`（dispatch 不受 [skip ci] 影响；matrix 只挑 web job 无法单独跑，会三镜像全出——facade/observer 没代码变更，出的 tag 也无害，GitOps 只滚 wanxing-web 行）。

**出片后**：等 relay ≤5min 回灌 ccr（`skopeo` 逐 tag OK 行，或 `ssh cheap3` 看 /etc/tcr-relay 日志），digest 双证。

### 4.2 生产验收

1. gitee `fd-infra-deploy` 仓 `all-services/prod/wanxing-web.yaml` 滚 tag `sha-<快照sha>`（image 当前 `ccr.ccs.tencentyun.com/yizuo/wanxing-web:sha-7ed95d9`）→ 提交推 gitee。
2. ArgoCD（k3s 控制面 china-cheap-6，`KUBECONFIG=/etc/rancher/k3s/k3s.yaml`，ns fd-prod）hard-refresh → Synced/Healthy；`imagePullPolicy: Always` 已配（fix-wanxing-console-ux 改的，同 tag 重推不再吃坏缓存）。
3. **同一性判据**（记忆 prod-liveness-evidence-discipline）：pod imageID digest ↔ 镜像 digest 双向比对，状态码无鉴别力。
4. 浏览器走查（aloadtree@gmail.com 登录，密码在记忆「生产走查账号凭据」页）：五 tab、抽屉六面板、toast、每日图、骨架、accent 朱红。截图存证。

### 4.3 台账 + 归档 + 记忆

1. 主 spec 同步：`openspec sync polish-wanxing-console`（或 `/opsx:sync`）——wanxing-web 5 条 ADDED 合入主 spec（注意与主 spec 既有「面板打开在下方」表述的 MODIFIED 冲突，sync 后人工核一遍合并结果）。
2. `openspec archive polish-wanxing-console`（归档移 archive/2026-10-24-polish-wanxing-console/，commit 带归档说明）。
3. 台账 commit（仓库惯例格式，参考 035583dc/a2fc473a）。
4. ai-memory 更新（fd-wanxing 项目）：`polish-wanxing-console-change.md` 追加全链完结段 + 出片线记录；wanxing 侧 `wanxing-console-polish-plan.md` 可标已完成。

## 四、风险与注意

- **并行会话**：paas 仓（本 cwd）与 fd-wanxing 仓都有其他会话在途。fd-wanxing 提交一律显式路径 `git add <paths>`，禁 `add -A`（记忆 parallel-session-swept-commit-hazard）。
- **FleetView 是最大 diff**（578 行改动）：生产走查重点过六面板 + 深链；testid 清单比对脚本可用 `git show <old>:...FleetView.jsx | grep -o 'data-testid=[^ >]*' | sort` 对比。
- echarts 在 ConsoleView chunk（580KB min / 189KB gzip）：对冲了懒加载，无需再切。
- 通用池出片若遇 BUILD_DOCKERFILE 抹除（见上），重设变量后 `gh workflow run` 重跑即可；同 tag 重推要手动 skopeo（relay 是 tag 级去重）。
- `/tmp/wx-pub/`（临时现场）重启会丢；workflow 文件内容如需复用从本节抄。

## 五、本地走查配方（复用）

```bash
cd ~/finddata/fd-wanxing/wanxing-web && npm run build && npx vite preview --port 4173
# ego-browser 脚本模式（关键点，全踩过）：
# 1. token 种 localStorage：wanxing-console-token=<任意> + wanxing-console-email=aloadtree@gmail.com
# 2. mock 后端 = CDP Fetch.enable({patterns:[{urlPattern:"http://localhost:4173/api/*",requestStage:"Request"}]})
#    + 后台泵循环 page.events() 读 Fetch.requestPaused → Fetch.fulfillRequest
# 3. 坑①：page.goto 默认 waitUntil:load 会阻塞事件泵 → fulfill 回不去 → 用 waitUntil:"commit"
# 4. 坑②：fulfill body 必须 Buffer UTF-8 → base64；unescape 竞态会回空 body →
#    视图报 "Unexpected end of JSON input" 假空态
# 5. 坑③：events() 读即清，双泵竞争会丢事件——全程只留一个泵循环
# 6. 坑④：页面 hash 切 tab 后 Fetch 会话可能静默失效 → 重新 Fetch.enable + reload 重来
```

## 六、相关记忆索引（fd-wanxing 侧 ai-memory）

- `polish-wanxing-console-change.md` — 本 change 进度台账（立项+Phase1 段已写，Phase2 段待补：026cfe0 已推、3.x 全勾）
- `wanxing-console-polish-plan.md` — 原始探索定稿（含出片链、生产拓扑）
- 相关坑位：`build-pool-shared-repo-variables`、`relay-same-tag-overwrite-and-snapshot-default-branch`、`prod-liveness-evidence-discipline`、`module-vs-e2e-acceptance-gap`、`tcr-tag-quota-100-blocker`（hkccr 100 tag 上限，撞了按记忆配方 digest DEL）

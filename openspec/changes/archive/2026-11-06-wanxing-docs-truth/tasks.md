# wanxing-docs-truth 任务清单

## 1. 账本坏账清偿（先行，一分钟级）

- [x] 1.1 `git add openspec/specs/copilot-intent-adherence/` 并提交，验证 `git log --oneline -- openspec/specs/copilot-intent-adherence/` 出现首条提交记录

## 2. 现状文档对齐

- [x] 2.1 重写 README.md「本仓现在有什么」表：facade/observer/web 改为 services/ 现址现态；runner 标注仍在 paas（借用契约）；验证表中每个路径真实存在（ls 对得上）
- [x] 2.2 `docs/program/wanxing-independence.md` 补「切片⑤之后的演进」一节：修 L29/L36-37 矛盾、记录 2026-11-06 runner 借用契约裁决；验证全文无「待迁入 runner」「同进程直写」残留
- [x] 2.3 CONTEXT.md 语言表补 10-22 后新词（记忆可见页/访客事项/套餐申请/桌面机位/集群复合服务单位）；验证新词与代码/模块名对得上（grep services/）
- [x] 2.4 ADR：新增 docs/adr/0005 记录 runner 借用契约裁决（短文：背景/裁决/后果）；验证 ADR 编号连续、README 相关段引用一致

## 3. 代码内过期叙述修正

- [x] 3.1 修 `services/wanxing-facade/fleet-report.js:3-4` 与 `store.js:3-4` 头注：删除「迁入后替换」叙事，改为现态描述；验证注释与实际行为一致（跨进程上报为长期形态）
- [x] 3.2 fd-infra-deploy `wanxing-web.yaml:3` 注释改为与 nginx.conf 实际路由一致（/api/fleet→facade 反代）；验证注释逐字对得上 nginx.conf location
- [x] 3.3 Dockerfile:13 与 .github/workflows/images.yml:2 的 `docs/IMAGE-RELEASE.md` 悬空引用改为 paas 仓真路径或迁入本仓；验证引用路径存在
- [x] 3.4 DocsView 注释声称的 `docs/wanxing-serving-api.md`：迁入本仓（从 paas 拷贝并更新）或改注释指 paas 真路径；验证 DocsView 引用可解

## 4. 收口验证

- [x] 4.1 全仓 grep 验证三处叙事清零：「暂居 paas」「L2 拆面时迁入」「切片②会换进程内」——README/program/头注均无残留
- [x] 4.2 `openspec validate wanxing-docs-truth --strict` 通过；README/program/CONTEXT 三文档人读一遍无自相矛盾

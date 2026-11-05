# 验收部署的目录纪律（wanxing-first-visitor 1.3 复发闸）

2026-11-06 目录清洗后立此约定：验收/走查类部署不得出现在萬星公开目录。

## 约定

1. **验收部署默认私有**：为验收（M 系列向导验收、S 系列一键流验收、构造验收、开门首验等）创建的
   部署，注册进 serving registry 时一律 `visibility: private`——验收完成即从公开目录消失，无需事后清洗。
   要公开展示的 agent，验收通过后单条转 public。
2. **命名约定**：验收部署的 agent/pack 名不得复用真产品名（p2 接待/演示接待这类与真产品难以分辨的
   命名停用）——名称带验收语境（如「验收·部署向导」）或用验收账号专属前缀，让 registry 一眼可辨。
3. **描述禁迭代代号**：任何会进公开目录的描述不得携带 M4①/M5.3/S4.1 等迭代代号与「验收」字样；
   验收语境写进 deployment/pack 的内部字段（metadata），不写 description。
4. **本约定的执行位**：部署验收流程（向导验收/构造验收剧本）的收尾步骤加一条「registry visibility
   核对 = private」；本文件是约定的可查锚点。

## 背景

2026-11-06 清洗实录：线上目录 22 个 agent 中 7 个带验收/迭代代号（M4①/M5.3/S4.1/走查账号残留），
1 个重复部署，占比近半——第一屏像内部验收现场而非产品。清洗走 registry PATCH visibility（台账驱动，
facade 零黑名单），记录见 change `wanxing-first-visitor` 的 agents-inventory.md。

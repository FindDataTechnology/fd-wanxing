## Why

M4① 部署向导（`docs/facet-wanxing-roadmap.md` §M4，2026-10-12 /opsx:explore 定案）：部署从
4 裸字段（packId/版本/计费键/通知通道）升级为分步交互。每个 knob 的地基都已在产——agent 勾选
（my/packs 已返 deployableAgents）、模型（agent-service-config 部署时校验）、预算（C1 硬停）、
节奏（resident rhythm）、可见性（allowlist/额度面）——缺的只是前移与编排。用户视角的产品化
就是这一片：不懂运维的人「配得好」。

## What Changes

- **facade selfservice 转发扩展**：`POST /console/my/packs/:id/deploy` 接受并转发向导载荷——
  `agents`（选中 agent id 数组，依赖 paas `add-deploy-agent-selection` 端点）、`models`/
  `budgets`/`rhythms`（per-agent 部署时初值）。facet 拒绝照旧透传。计费键/通知通道改为按
  **选中集**映射（今天是无差别映射全部 serving agent）。
- **my/packs 富化**：deployableAgents 每项带 `modelWhitelist`（manifest serving 声明），向导
  的模型输入给出合法域提示。
- **console 部署向导**（ConsoleView deploy-panel 重构为分步）：
  1. 选包——我的 pack 列表（可部署徽标），点选即入向导；
  2. 勾 agent——deployableAgents 复选（默认全选）；
  3. 配置——per-agent 模型（whitelist 提示）/回合预算（分钟）/工作节奏（预设+自定义 JSON）；
  4. 计费与通知——计费键（面板指引链接）+通知通道；
  5. 结果——分享卡（现状保留）+ 可见性收尾：对话额度一键设置（host-allowance）与 API 调用者
     添加（allowlist）入口前移到部署完成态。
- 向导是**编排层**：每一步调的都是既有端点，无新引擎；试驾预调按伞文档挂账不做。

## Impact

- 代码：`services/wanxing-facade/selfservice.js`（载荷转发+my/packs 富化）、
  `wanxing-web/src/views/ConsoleView.jsx`（deploy-panel → 向导）。
- 依赖：paas `add-deploy-agent-selection`（agents 子集端点）先行上线；未上线时 facade 转发
  agents 会得 facet 400，透传即可见——不做版本探测。
- specs：wanxing-facade 的 deploy 需求增补向导载荷场景；wanxing-web 新增向导需求。
- 部署：facade 镜像 + web 镜像（wanxing-web 静态面）。

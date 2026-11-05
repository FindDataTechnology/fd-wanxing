# Tasks: redact-agent-card-private-endpoints (fd-wanxing)

## 1. Serialize-safe redaction

- [x] 1.1 `services/wanxing-facade/a2a.js`：在 `publicCard()` 邻域加 provider 红敏器（私网/CGNAT/loopback/link-local/单标号/集群后缀/不可解析 → 剔 `url` 键；其余原样），`provider:` 行改为经红敏器输出
- [x] 1.2 `scripts/test-wanxing-facade.mjs`：卡片面三态测试（内网剔键且 organization 保留 / 公网透传 / 不可解析剔键）

## 2. Verify & ship

- [x] 2.1 `node scripts/test-wanxing-facade.mjs` 全绿；`openspec validate redact-agent-card-private-endpoints --strict` 通过
- [ ] 2.2 提交（显式路径，勿卷并发会话未提交文件）并推送触发 `images.yml` 出 `wanxing-facade:sha-<新>` 镜像
- [ ] 2.3 GitOps：`fd-infra-deploy` wanxing-facade.yaml 滚新 tag；从 windows-admin 复验 wanxing 域名卡片无内网 provider.url

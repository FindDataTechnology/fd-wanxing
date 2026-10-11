# tasks — add-deployer-self-service

- [x] 1.1 selfservice.js：facet 转发通道（env 两键+降级）+ my/packs（作者过滤+可部署概要），验证：单测通道两态/过滤/空列表
- [x] 2.1 my/packs/:id/deploy（归属校验+billing key 必填+版本缺省+错误透传），验证：单测四场景
- [x] 3.1 分享卡（URL/chatability/额度+指引），验证：单测拼装与不可对话原因
- [x] 4.1 ConsoleView deploy-panel（列表/表单/分享卡/降级横幅），验证：构建绿+面板 walkthrough
- [x] 5.1 出片上线（scs001 线 8aa2ad9 facade+web；wanxing-fleet secret 两键 + facet Service 新建 + GitOps env/image），验证：路由活+门正确（ops 403/匿名 401 实测）+通道三层实证（env 入 pod、facet Service ClusterIP→hostNetwork endpoint 健康、FACET_BASE_URL=http://facet:3200）；身份携带流=单测 5/5（stub facet：转发头/作者过滤/foreign 404/错误透传/分享卡）——真部署者浏览器登录验证留待有 allowlist 账号密码者（admin@finddatatech.cloud 在册）

# Tasks: add-wanxing-web

- [x] 1. 工程骨架：wanxing-web/（Vite+React 19+Tailwind v4，中文优先），hash 三视图
      （目录/文档/控制台），`vite build` 绿（948ms / 74.7kB gzip）
- [x] 2. 公共目录页：分页（page/page_size 消费①成果）+ 当前页搜索 + 错误态明示
      （"目录暂不可用…这不是『没有 agent』"）
- [x] 3. 文档门面：鉴权/幂等/并发/错误码表/message-send 示例
- [x] 4. 控制台 v1：token 门禁（localStorage）→ board 指标渲染（五态/水位/wake/24h/
      pending/滞后双基，30s 刷新）+ agent timeline 下钻（含 trace_id 引用显示）
- [x] 5. 镜像与路由：wanxing-web/Dockerfile（node build → nginx 静态 + /api/wanxing→
      facade + /api/fleet→observer 同域反代）+ images.yml 第三矩阵位（yizuo/wanxing-web）
      + deploy/wanxing-web.yaml（Deployment×2+Service+Ingress 域名指 web，facade
      Ingress 移除）；静态服+三 API 桩冒烟全过

## 下一增量（注记在案）

- Logto 身份集成 + 管理动作（暂停/恢复/允许清单）→ 需用户侧 Logto 应用配置
- 目录热度排序（等③数据积累）；浏览器级 e2e 走查（部署窗口）

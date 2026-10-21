# measurements — add-cluster-catalog-grouping

## 上产记录（2026-10-22）

- 代码：fd-wanxing `9d6d166`（集群索引/标记/过滤/facets.clusters + 自助面声明透传 + CatalogView
  分组渲染 + 向导预勾默认成员）；测试 test-wanxing-clusters.mjs §A 6 例 + selfservice 1 例；
  真机 stub 探针 10/10 后删。
- 镜像：wanxing-facade/web 同 tag `sha-b01bf0b`（快照 b01bf0b=fd-wanxing 1294b2f；digest
  `fa0ea630`/`785fa26c` ccr 实证；GitOps facade 37ab621 + web 277b148→37ab621 双滚，pod imageID
  双向核验）。**事故**：并行会话 17:35 的快照实为 A-only 陈树（message 标 49242b5 但 tree=9d6d166，
  /clusters 404 抓出）→ 重推快照 b01bf0b 双镜像重建重滚。
- 数据前置：集群包 v2（三成员补 `serving:{protocol:"a2a"}`，作者 aloadtree 经 creators 签名
  cookie 发布）；默认两成员经 facet 转发身份通道部署（sub2api 键 129/130，deepseek-v4.1-flash）。
- 生产实证（2026-10-22）：目录 11 条含 2 条集群标记（`cluster:{id,name,role,members:3}`）；
  `?cluster=` 过滤命中 2；`facets.clusters=1`；agent-card 带标记；真机浏览器组头
  「2 / 3 在本页 · 默认 2 · 可选 0」+收窄 chip 6/6 PASS。
- 已知缺口：facade 未设 trust proxy，卡片/标记 url 呈 `http://`（沿袭 agent 卡既有口径，边缘
  301 兜底）；集群包未设 category（目录组头外无策展位）。

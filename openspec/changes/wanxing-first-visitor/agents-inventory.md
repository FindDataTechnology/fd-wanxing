# 线上目录清单标注（任务 1.1，2026-11-06 实测拉取）

数据源：`GET https://wanxing.finddatatech.cloud/api/wanxing/v1/agents`（total=22，turns7d 除识律专家=2 外全 0）。

标注三档：**退役**=删除部署（验收残留；pack 不动可重部署）；**重写**=描述去验收标记后保留（真产品但描述带迭代代号）；**留**=不动。

## 退役（7）

| slug 尾段 | 名 | 依据（描述原文摘录） |
|---|---|---|
| 4fhjskpibrr2d0_9bxacqq-wx-alpha | 阿尔法哨兵 | 「向导验收 · 双子 · M4① 部署向导生产验收」 |
| ibsyc2w-l9uuc1cdt-amhg-reception | p2 接待 | 「facet-demo 的分身 · M5.3 构造验收」（facet-demo=测试账号残留） |
| kmpgjvkewly9hgwtjrfzxa-reception | p2 接待 | 「p2walk1025 · M5.3 构造验收」（走查账号残留） |
| mjbgihphn1sfrmrhfat8cq-reception | 演示接待 | 「M5.2 开门首验 · 语料为演示占位」 |
| vtdpsnmtw6oq9i99mbhbdw-pack-demo-fingpt | 演示分析师 | 「部署演示 · 首个带服务契约的演示包」 |
| vz-kdoitzsqfgkmp5undxg-agent | 一键流验收 | 「S4.1 一键流线上验收」 |
| ut_bjmuw5kxad83kimpmlg-reception-dde7ec3a6 | 寻数分身（重复部署） | 与主寻数分身同名同描述的重部署残留（保留主部署） |

## 重写描述（2）——外部作者真货，验收措辞去掉后保留

| slug 尾段 | 名 | 现描述问题 | 重写方向 |
|---|---|---|---|
| 6kdskgmb-3_86a81vzc6ua-data-scout | 数据侦察员 | 「M4② 绿地从目录部署验收——外作者的可部署 pack」 | 保留「外部好货 · 数据速览」，去 M4② 句 |
| thd65-7sfbt_z0kftvhgiw-brief-writer | 简报写手 | 「M4③ 套装验收——第二件外作者绿地带货」 | 保留「外部好货 · 简报快写」，去 M4③ 句 |

## 留（13）

| slug 尾段 | 名 | 说明 |
|---|---|---|
| ut_bjmuw5kxad83kimpmlg-reception | 寻数分身 | 公司接待（唯一有策展语料的真产品） |
| _vcfzzuxpgkirsj5pozigg-builder | 分身工坊 | 分身产品入口 |
| btnrv2p_…-intro-facet / -guide / -lex / -wire / -yizuo | 谦面专家/产品向导/识律专家/柏讯专家/壹座专家 | 五线介绍舰队（识律专家 turns7d=2 唯一真实使用记录） |
| xfyxvzonqfelnfigm0djvw-lex-console-copilot | 识律控制台伴随助手 | 识律控制台副驾（产品） |
| egayyoazvtf0fwllvagaqa-pack-wire-macro-ana | 宏观经济研究员 | 投研三镜头成员 |
| egayyoazvtf0fwllvagaqa-pack-wire-valuation | 股票估值分析师 | 投研三镜头成员 |
| ev5e51eth7e5mcvydrl9rg-market-flash-briefe | 市场快讯速览员 | 产品 |
| i262i0tuwtf9wslex12cow-mission-planner | 萬星 Planner | 任务系统组件 |
| qnhd7b3j1-hkddkzzq_fuq-doc-report-writer | 文档工坊 · 报告撰写 | 产品 |

## 执行方式（任务 1.2，待用户批准清单后）

- 退役 = 经 packs internal API 删除对应 deployment（pack 保留，可重部署；facade 侧 usage 账本行保留——历史不丢）。
- 重写 = 改 deployment 描述字段（packs internal API）。
- 预期结果：目录 total 22→15，无「验收/M4①/M5.3/走查」字样；facets 计数同步。

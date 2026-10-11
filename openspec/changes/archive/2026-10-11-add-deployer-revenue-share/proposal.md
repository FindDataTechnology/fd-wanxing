# Proposal: add-deployer-revenue-share

## Why

M3 出口判据是「两个不同用户的 agent 互相调用、引用各自数据、完成结算」。调用、数据面（connector-mt）、部署者自助、目录发现都已上线，但「结算」仍停在 v1：外部调用者按价目表在边界被扣款（adjustBalance subtract，幂等键=usage id），部署者的部署键承担上游模型费，平台静默净得差额——**部署者零参与、零激励**，萬星生态的供给侧没有收入闭环。ADR-0022（paas docs/adr/0022，4c5f985）已定案分成语义：收入分成（非毛利）、同回合落账、闭环抵扣不提现、负保护、host/share 互斥、租金留 500 闸门后。本 change 把该 ADR 实施为代码。

## What Changes

- **收益账本**：facade 新增 `wanxing_deployer_earnings` 表（usage_id 唯一键/deployer/agent/金额/状态），是部署者收益的生意权威与明细源；sub2api 仍只管钱（adjustBalance add，幂等键=`share:<usage_id>`）。
- **分成钩子**：`trySettle` 扣款成功分支（含 duplicate=已落账分支）旁路生成分成——仅当回合是**外部真金扣款**（API 车道、settler=NULL、minutes>0）、部署可解析、部署者 sub2api 账号可解析、且调用者≠部署者；plan/mission/subsidy/host/自带 key 回合一律不分成（内部互调不自我膨胀，ADR ⑤ host/share 互斥）。
- **抽成旋钮**：`WANXING_SHARE_COMMISSION`（默认 0.30，纯配置）——分成额 = 回合收入 ×（1−抽成），成本波动不进公式。
- **crash 安全**：分成行先落账再上调 add；扫尾重试 pending 分成；纪元（首启时间戳）后已结算而缺分成孪生的回合由补账扫描收口——不回溯历史、不双记。
- **console 收益面**：`GET /api/wanxing/v1/console/my/earnings`（部署者身份门，同 my/packs）+ deploy-panel 收益区（近期行+已结算/待结算合计）。
- v1 明确不做：提现、per-agent 部署者定价、租金（500 闸门后另立）、sub2api 虚拟用量镜像。

## Capabilities

### New Capabilities

- `deployer-earnings`：分成生成条件、幂等入账、闭环抵扣语义、扫尾与补账、console 收益视图。

### Modified Capabilities

- `wanxing-facade`："Admitted turns are metered and settled at the boundary" 增补一个场景——外部真金结算成功的回合同回合给部署者入分成；其余 requirement 不动。
- `wanxing-web`：新增 requirement——deploy-panel 承载收益区（行+合计+降级态）。

## References

- ADR-0022（paas `docs/adr/0022-settlement-v2-deployer-revenue-share-and-residency-rent.md`）
- facet-wanxing-roadmap M3 ④（paas `docs/facet-wanxing-roadmap.md`）
- 先例：add-serving-plans（结算选举）、add-agent-chat-lane D5（host-settle 幂等形状）

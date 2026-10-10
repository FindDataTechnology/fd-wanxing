# Tasks: add-serving-plans

## 1. 数据层

- [x] 1.1 `store.js` 新表 `wanxing_plans`（caller 键、分钟上限、created_by、note、时间戳）+ usage 行 `settler`/`plan_ref` 可空列迁移（ALTER IF NOT EXISTS，存量行默认 balance 语义），验证单测：建表幂等、迁移无损、往返读写
- [x] 1.2 派生余量函数：cap − 按 plan_ref 聚合的已结算分钟（有界查询），验证单测：零消费=cap、部分消费、耗尽、调整后即时生效

## 2. 准入与结算

- [x] 2.1 准入门：活跃套餐者加查余量>0；耗尽 → 结构化 `plan_exhausted` 拒绝（402 形，文案含调整指引）；调整后自动恢复，验证单测：三态（余量足/耗尽/恢复）+ key 探活语义不变
- [x] 2.2 结算选举：`onTurnComplete` 按 caller 活跃套餐解析 settler——plan → 本地分钟扣减记 `settler=plan`+plan_ref（幂等键=usage 行 id）；无 plan → 既有余额路径原样，验证单测：选举正确、重放不双扣、waived 语义保持
- [x] 2.3 chat lane 零波及回归：补贴瀑布/host-allowance 既有套件全绿（不改一行）

## 3. 管理面（console）

- [x] 3.1 套餐发放/调整动作：ops 凭据专享（非 ops 拒绝），沿既有管理动作模式，验证单测：ops 发放+调整成功、非 ops 拒、审计行落库

## 4. 对账面（web）

- [x] 4.1 调用者对账：套餐已结算分钟 + 派生余量 + 余额路径分钟双维度，键引用掩码；仅可见本人，验证：本人可见、他人拒、掩码纪律
- [x] 4.2 e2e：发放→真回合扣减→耗尽拒绝→调整恢复全链一条龙（本地套件）

## 5. 上游契约与文档

- [x] 5.1 sub2api 虚拟用量镜像契约成文（D6：endpoint/幂等键/admin 鉴权/body 形状）落 docs/，标记非阻塞，验证：文档评审过（含幂等与鉴权两节）
- [ ] 5.2 上游 issue 递交 Wei-Shaw/sub2api（可选时机），验证：issue 链接入册

## 6. 上线

- [ ] 6.1 fd-wanxing 发布线（GHA→镜像→deploy 清单）滚 facade+web，生产冒烟：发放→真回合→账面对读，验证：board/账本/对账面三处一致

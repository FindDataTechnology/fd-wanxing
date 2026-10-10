# sub2api 虚拟用量镜像——上游契约（add-serving-plans D6，非阻塞）

> 目的：让套餐/外部结算的消费在调用者自己的 sub2api 面板可见。v1 权威账在萬星
> facade（`wanxing_usage`，settler 维度），本端点只做**镜像写入**——上游缺失不影响
> 套餐任何行为。择机递交上游 [Wei-Shaw/sub2api](https://github.com/Wei-Shaw/sub2api)。

## 端点

`POST /api/v1/admin/usage`

- 鉴权：admin 会话/API 凭据（与现有 admin 面一致），非用户 token。
- 幂等：`external_id` 唯一——重复提交返回首次结果（200 + `duplicate: true`），不双记。
  萬星侧以 facade usage 行 id 作 `external_id`（与边界结算的幂等键同一纪律）。

```json
{
  "external_id": "wu_<hex>",
  "user_id": 7,
  "minutes": 3,
  "note": "wanxing plan wp_ab12cd (agent packs-p1-heal)",
  "recorded_at": 1760000000000
}
```

- 响应：`{ ok: true, usage_id: <n>, duplicate: false }`；校验失败 400；未知用户 404。
- 语义：纯记账展示行（不移动余额、不触发配额窗口）——金额/配额语义归 sub2api
  既有机制，镜像只解决"面板上看得到"。

## 为什么不是 adjustBalance

admin 面现有 `adjustBalance` 是纯余额移动、无用量记录：镜像走它会污染余额语义
（套餐结算不动真实余额）。虚拟用量是独立只增展示层。

## 萬星侧接入（上游落地后）

facade 的 plan 结算路径（`trySettle` settler='plan' 分支）在 mark settled 后
fire-and-forget 镜像写入，失败仅记日志不重试不阻塞——账本权威在 facade，镜像
最终一致即可。接入前零依赖。

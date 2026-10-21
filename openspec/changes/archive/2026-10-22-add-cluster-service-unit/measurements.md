# measurements — add-cluster-service-unit

## 上产记录（2026-10-22）

- 代码：fd-wanxing `49242b5` + 修 `0c8c5c0`（成员答复读取——runner 的 Message **即** result，
  非 result.message；真机首撞：两成员 53s/50s ok+计费但聚合空文本）。测试 §B 8 例（并发时序/
  超时/上下文派生/私有成员公面隐藏/RPM 单跳/两层幂等/部分崩溃重放只重跑未完成成员）。
- 镜像：wanxing-facade `sha-6f5331d`（快照 6f5331d=fd-wanxing 0c8c5c0；digest `8515e54f` ccr
  实证；GitOps e04bc689 滚产，pod imageID 核验）。web 侧（组头端点行+docs 节）在同源
  `sha-b01bf0b`。
- 生产实证：
  - `GET /clusters` 列出单位（members 三员：默认两 served + 可选投委会 served:false——部分小队
    如实）；单位卡公开可取（streaming:false、skills=在役公开成员、cluster 扩展块）。
  - 复合调用①（all）：两成员并行 33.3s/32.9s 真实 LLM 答复，聚合双节带名，
    `metadata.cluster` 成员各 1 分钟；台账两行同 `cluster_turn_id`、单位零行、全部 settled。
  - 复合调用②（replay 同键）：返回首次应答，零新行。
  - 复合调用③（summary）：两成员 + lead（声明序首个成功默认成员=宏观）综合回合 2 分钟，
    `summaryBy=pack-wire-macro-analyst`，三行同 `cluster_turn_id`。
  - 真机浏览器：组头端点代码行+复制（clipboard 实读）、docs「集群调用」节 6/6 PASS。
- 已知缺口：成员数据通道（柏讯四 MCP）在 runner 语境 `server is disconnected`——两成员均如实
  拒编数字并以判据框架作答（pack 诚实训练生效）；wire MCP 接入 served 语境是独立工作。
  计费键一员一键是 facet 硬规则（`BILLING_KEY_INVALID duplicate`），多成员部署需逐员铸键。
- 配方增量：sub2api 面板铸键走「进入控制台→Continue with OIDC→Logto identifier+密码→Enter
  提交」（本地密码登录对该 OIDC 账号不可用）；面板 token 在 localStorage `auth_token`。

# tasks — add-mission-board

- [x] 1.1 store.js EVENT_KINDS + observer.js board missions 段（D1/D2），验证：单测两例绿
- [x] 1.2 ConsoleView 任务小节（D3），验证：面板 walkthrough/构建绿
- [x] 1.3 出片上线（scs001 线三镜像 a838b0a：observer+web+facade——后者连带 spent 事件载荷）+ 生产 board.missions 实证，验证：第三程 mission 全轨迹实时在板（含 failed 终态与 spent=1）；facade reporter 重试梯自动补放升级前被拒积压（第二程轨迹完整回填）。附记：通知链路机制全通（fd-ops 绑定生效），投递暂被微信 45015（48h 客服窗口过期）挡住——接收人向公众号发一条消息即恢复

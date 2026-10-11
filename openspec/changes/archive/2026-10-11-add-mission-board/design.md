# design — add-mission-board

- **D1 kind 白名单**：EVENT_KINDS 追加十种 mission.* 常量（显式枚举沿既有纪律，不开前缀通配——拒绝面保持可枚举）。
- **D2 board missions 段**：observer board 端在既有合成后加 `store.kindSince(MISSION_KINDS, since24)` 归并——按 payload.mission 分组，取最新状态、轨迹（to 去重保序）、owner（payload.owner）、spent（exhausted/终态 payload 的 spent 字段若带）；空则 `[]`。不进 rollup、不加索引（mission 事件量级 ≪ turns）。
- **D3 console 渲染**：ConsoleView 的 board 数据已 fetched——面板新增「任务（24h）」小节渲染 board.missions（状态徽标复用 missions 面板配色语义、owner、spent）；board 无该段（旧 observer）时小节显式「暂无数据（observer 未升级）」。
- **D4 测试**：test-fleet-observer 补两例（mission 事件收下+board 段合成/空窗不隐段）。

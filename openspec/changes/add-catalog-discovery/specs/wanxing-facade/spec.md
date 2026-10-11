# wanxing-facade Specification

## ADDED Requirements

### Requirement: Cards and catalog carry declared example prompts

公开卡（agent-card.json）与目录行 SHALL 在 registry 卡片声明 `examples` 时原样携带该字段（≤3 条示例问句）；未声明时两个面的形状 SHALL 与增补前逐字节一致。对话页 SHALL 支持 `?q=` 深链一次性预填输入框——只预填不自动发送。

#### Scenario: A declared example reaches the catalog and prefills chat

- **WHEN** 一个可对话 agent 的卡片声明两条示例
- **THEN** 目录卡片展示两条「试问」，点击跳转对话页且输入框已预填该示例、未自动发送

#### Scenario: Undeclared examples change nothing

- **WHEN** 卡片未声明 examples
- **THEN** 卡与目录行无该字段，形状与增补前一致

#### Scenario: A non-chatable agent's examples stay informational

- **WHEN** 未开放访客对话的 agent 声明示例
- **THEN** 示例只读展示并提示未开放，不产生对话跳转

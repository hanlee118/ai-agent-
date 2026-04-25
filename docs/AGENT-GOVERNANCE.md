# Agent 治理规范说明

## 定位

`product-context` 是 Agent 执行规范（平台级宪法），不是项目级配置项。

## 核心原则

1. 全局唯一：所有 Agent 共用一份治理上下文。
2. 直接生效：更新后立即影响平台的 Agent 执行行为。
3. 禁止项目化：不允许为单个项目派生独立 `product-context`。

## 项目差异如何表达

- 通过 Agent 配置（例如 `allowedAgentIds`、`toolAllowlist`）表达差异。
- 通过阶段策略与质量门禁表达项目特殊约束。
- 通过白名单/黑名单在执行阶段动态限制。

禁止通过 `product-context` 增加 `projectId` 参数或覆盖继承机制。

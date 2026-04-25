# 架构演进说明

## 当前状态

系统同时存在两套工作流引擎：

### V1 引擎（维护模式）
- 位置：`apps/api/src/routes/projects.ts`、`apps/api/src/routes/issues.ts`
- 状态：仅接受 bug 修复，不接受新功能
- 特点：路由体量大、耦合高、改动回归风险高

### V2 引擎（活跃开发）
- 位置：`apps/api/src/routes/workflows-v2.ts`、`apps/api/src/workflow-v2/`
- 状态：所有新功能必须优先在 V2 实现
- 特点：模块化拆分，支持知识库、技能与 Hermes 协同能力

## 治理规则

1. 禁止在 V1 中新增功能。
2. 新能力默认落在 V2。
3. V1 仅允许修复线上故障与兼容问题，且必须补回归验证。

# Aegis OS API 接口设计文档

> **版本**: v1.0  
> **日期**: 2026-03-27  
> **项目路径**: `/tmp/ai-agent-check`

---

## 1. API 设计原则

### 1.1 基本规范

- **Base URL**: `http://localhost:8787/api`
- **认证方式**: Cookie Session (`occ_session`)
- **Content-Type**: `application/json`
- **响应格式**: 所有接口返回统一结构

### 1.2 统一响应格式

```typescript
// 成功响应
{
  "success": true,
  "data": { ... }  // 或数组
}

// 错误响应
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "错误描述"
  }
}
```

### 1.3 认证状态

```typescript
// 获取认证状态
GET /api/auth/status
Response: {
  "setupComplete": boolean,
  "authenticated": boolean,
  "user"?: { id, name, email }
}

// 登录
POST /api/auth/login
Body: { "email": string, "password": string }
Response: { "success": true }

// 登出
POST /api/auth/logout
Response: { "success": true }
```

---

## 2. Model 管理 API

### 2.1 获取模型列表

```
GET /api/models
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "model_001",
      "name": "GPT-4 Turbo",
      "provider": "OpenAI",
      "status": "Healthy",
      "totalTokens": 1250000,
      "dailyTokens": 45000,
      "tokenLimit": 10000000,
      "currentTask": "项目结构分析",
      "latency": "320ms",
      "throughput": "1800 tokens/s",
      "createdAt": "2026-03-01T10:00:00Z"
    }
  ]
}
```

### 2.2 创建模型

```
POST /api/models
```

**Request Body:**
```json
{
  "name": "Claude 3.5 Sonnet",
  "provider": "Anthropic",
  "apiKey": "sk-xxx",
  "apiBaseUrl": "https://api.anthropic.com/v1",
  "tokenLimit": 5000000
}
```

**Response:** `201 Created`
```json
{
  "success": true,
  "data": {
    "id": "model_xxx",
    "name": "Claude 3.5 Sonnet",
    "provider": "Anthropic",
    "status": "Healthy",
    ...
  }
}
```

### 2.3 获取模型详情

```
GET /api/models/:id
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "model_001",
    "name": "GPT-4 Turbo",
    "provider": "OpenAI",
    "apiKey": "sk-***",  // 脱敏
    "apiBaseUrl": "https://api.openai.com/v1",
    "status": "Healthy",
    "totalTokens": 1250000,
    "dailyTokens": 45000,
    "tokenLimit": 10000000,
    "currentTask": "项目结构分析",
    "latency": "320ms",
    "throughput": "1800 tokens/s",
    "createdAt": "2026-03-01T10:00:00Z",
    "updatedAt": "2026-03-27T10:00:00Z"
  }
}
```

### 2.4 更新模型

```
PATCH /api/models/:id
```

**Request Body (部分更新):**
```json
{
  "name": "GPT-4 Turbo (New)",
  "apiKey": "sk-new-xxx",
  "tokenLimit": 20000000
}
```

**Response:** `200 OK`

### 2.5 删除模型

```
DELETE /api/models/:id
```

**Response:** `204 No Content`

### 2.6 获取模型日志

```
GET /api/models/:id/logs?type=bash&limit=50
```

**Query Parameters:**
| 参数 | 类型 | 说明 |
|-----|------|------|
| type | string | 过滤类型: bash/json/assistant/system |
| limit | number | 返回条数，默认 50 |

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "log_001",
      "timestamp": "2026-03-27T12:00:00Z",
      "type": "bash",
      "content": "Executing: npm run build",
      "label": "build"
    }
  ]
}
```

### 2.7 获取模型统计

```
GET /api/models/:id/metrics
```

**Response:**
```json
{
  "success": true,
  "data": {
    "totalTokens": 1250000,
    "dailyTokens": 45000,
    "weeklyTokens": [40000, 42000, 38000, 45000, 41000, 43000, 45000],
    "avgLatency": "320ms",
    "avgThroughput": "1800 tokens/s",
    "dailyCosts": [
      { "date": "2026-03-21", "cost": 1.25 },
      { "date": "2026-03-22", "cost": 1.18 }
    ],
    "tokenDistribution": [
      { "model": "GPT-4 Turbo", "tokens": 800000 },
      { "model": "Claude 3.5", "tokens": 450000 }
    ]
  }
}
```

### 2.8 健康检查

```
POST /api/models/:id/health-check
```

**Response:**
```json
{
  "success": true,
  "data": {
    "reachable": true,
    "latency": "150ms",
    "error": null
  }
}
```

---

## 3. Agent 管理 API

### 3.1 获取 Agent 列表

```
GET /api/agents
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "agent_001",
      "name": "产品经理 Agent",
      "role": "ProductManager",
      "status": "Idle",
      "load": 45,
      "currentModelId": "model_001",
      "tasks": 3,
      "memoryCount": 128,
      "tokensUsed": 520000,
      "tokenLimit": 1000000,
      "sessionCount": 12
    }
  ]
}
```

### 3.2 获取 Agent 详情

```
GET /api/agents/:id
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "agent_001",
    "name": "产品经理 Agent",
    "role": "ProductManager",
    "status": "Idle",
    "load": 45,
    "currentModelId": "model_001",
    "tasks": 3,
    "memoryCount": 128,
    "tokensUsed": 520000,
    "tokenLimit": 1000000,
    "sessionCount": 12,
    "soul": "你是 Aegis OS 的产品经理 Agent...",
    "sop": ["步骤1", "步骤2", "步骤3"],
    "createdAt": "2026-03-01T10:00:00Z"
  }
}
```

### 3.3 创建 Agent

```
POST /api/agents
```

**Request Body:**
```json
{
  "name": "研发 Agent",
  "role": "Developer",
  "modelId": "model_001",
  "soul": "你是 Aegis OS 的研发 Agent...",
  "sop": ["分析需求", "编写代码", "提交 Review"]
}
```

**Response:** `201 Created`

### 3.4 更新 Agent SOUL

```
PATCH /api/agents/:id/soul
```

**Request Body:**
```json
{
  "content": "新的 SOUL 内容..."
}
```

**Response:** `200 OK`

### 3.5 更新 Agent SOP

```
PATCH /api/agents/:id/sop
```

**Request Body:**
```json
{
  "steps": ["步骤1", "步骤2", "步骤3", "步骤4"]
}
```

**Response:** `200 OK`

### 3.6 切换 Agent 模型

```
PATCH /api/agents/:id/model
```

**Request Body:**
```json
{
  "modelId": "model_002"
}
```

**Response:** `200 OK`

### 3.7 删除 Agent

```
DELETE /api/agents/:id
```

**Response:** `204 No Content`

---

## 4. 团队拓扑 API

### 4.1 获取团队拓扑

```
GET /api/team/topology
```

**Response:**
```json
{
  "success": true,
  "data": {
    "nodes": [
      {
        "id": "agent_001",
        "name": "产品经理 Agent",
        "role": "ProductManager",
        "status": "Idle",
        "x": 100,
        "y": 200
      },
      {
        "id": "agent_002",
        "name": "研发 Agent",
        "role": "Developer",
        "status": "Executing",
        "x": 300,
        "y": 200
      }
    ],
    "edges": [
      {
        "from": "agent_001",
        "to": "agent_002",
        "label": "分配任务"
      }
    ]
  }
}
```

---

## 5. 项目管理 API

### 5.1 获取项目列表

```
GET /api/projects
```

**Query Parameters:**
| 参数 | 类型 | 说明 |
|-----|------|------|
| status | string | 过滤状态: active/paused/blocked/completed |
| page | number | 页码 |
| limit | number | 每页数量 |

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "proj_001",
      "name": "Aegis OS 开发",
      "description": "AI Agent 协作工作台",
      "status": "active",
      "phase": "DEVELOPMENT",
      "progress": 45,
      "owner": "张三",
      "agents": ["agent_001", "agent_002"],
      "createdAt": "2026-03-01T10:00:00Z",
      "updatedAt": "2026-03-27T10:00:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 5
  }
}
```

### 5.2 创建项目

```
POST /api/projects
```

**Request Body:**
```json
{
  "name": "新项目名称",
  "description": "项目描述",
  "requirements": "自然语言需求描述..."
}
```

**Response:** `201 Created`
```json
{
  "success": true,
  "data": {
    "id": "proj_xxx",
    "name": "新项目名称",
    "status": "active",
    "phase": "INIT",
    "progress": 0,
    ...
  }
}
```

### 5.3 获取项目详情

```
GET /api/projects/:id
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "proj_001",
    "name": "Aegis OS 开发",
    "description": "AI Agent 协作工作台",
    "status": "active",
    "phase": "DEVELOPMENT",
    "progress": 45,
    "owner": "张三",
    "agents": [...],
    "stages": [...],
    "deliverables": [...],
    "timeline": [...],
    "tasks": [...]
  }
}
```

### 5.4 更新项目

```
PATCH /api/projects/:id
```

**Request Body:**
```json
{
  "name": "新名称",
  "status": "paused"
}
```

### 5.5 获取项目阶段

```
GET /api/projects/:id/stages
```

**Response:**
```json
{
  "success": true,
  "data": [
    { "type": "INIT", "status": "completed", "progress": 100 },
    { "type": "ANALYSIS", "status": "completed", "progress": 100 },
    { "type": "DESIGN", "status": "active", "progress": 60 },
    { "type": "DEV", "status": "pending", "progress": 0 },
    { "type": "ACCEPT", "status": "pending", "progress": 0 }
  ]
}
```

### 5.6 获取项目交付物

```
GET /api/projects/:id/deliverables
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "deliv_001",
      "stage": "DESIGN",
      "title": "架构设计文档",
      "status": "submitted",
      "submittedAt": "2026-03-25T10:00:00Z",
      "approvedAt": null
    }
  ]
}
```

### 5.7 提交交付物

```
POST /api/projects/:id/deliverables
```

**Request Body:**
```json
{
  "stage": "DESIGN",
  "title": "架构设计文档",
  "content": "文档内容...",
  "attachments": ["file_token_1"]
}
```

### 5.8 审批交付物

```
POST /api/deliverables/:id/approve
POST /api/deliverables/:id/reject
```

**Reject Body:**
```json
{
  "reason": "需要补充性能测试数据"
}
```

---

## 6. 任务管理 API

### 6.1 获取任务列表

```
GET /api/tasks
```

**Query Parameters:**
| 参数 | 类型 | 说明 |
|-----|------|------|
| projectId | string | 项目 ID |
| status | string | 任务状态 |
| assignee | string | 负责人 ID |

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "task_001",
      "title": "设计数据库 Schema",
      "description": "设计项目所需的数据库表结构",
      "status": "in_progress",
      "priority": "high",
      "assignee": "agent_002",
      "projectId": "proj_001",
      "progress": 60,
      "due": "2026-03-30T00:00:00Z"
    }
  ]
}
```

### 6.2 创建任务

```
POST /api/tasks
```

**Request Body:**
```json
{
  "title": "任务标题",
  "description": "任务描述",
  "projectId": "proj_001",
  "assignee": "agent_002",
  "priority": "high",
  "due": "2026-03-30T00:00:00Z"
}
```

### 6.3 更新任务

```
PATCH /api/tasks/:id
```

**Request Body:**
```json
{
  "status": "done",
  "progress": 100
}
```

---

## 7. 决策中心 API

### 7.1 获取决策列表

```
GET /api/decisions
```

**Query Parameters:**
| 参数 | 类型 | 说明 |
|-----|------|------|
| status | string | pending/completed |

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "dec_001",
      "type": "stage_approval",
      "title": "设计阶段审批",
      "description": "项目 Aegis OS 开发的设计阶段已完成",
      "projectId": "proj_001",
      "stage": "DESIGN",
      "status": "pending",
      "createdAt": "2026-03-27T10:00:00Z"
    }
  ]
}
```

### 7.2 执行决策

```
POST /api/decisions/:id/approve
POST /api/decisions/:id/reject
POST /api/decisions/:id/revise
```

**Reject/Revise Body:**
```json
{
  "reason": "驳回原因或返工要求"
}
```

---

## 8. 通知中心 API

### 8.1 获取通知列表

```
GET /api/notifications
```

**Query Parameters:**
| 参数 | 类型 | 说明 |
|-----|------|------|
| severity | string | critical/warning/info |
| status | string | unread/read |

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "notif_001",
      "severity": "warning",
      "title": "Token 接近限额",
      "message": "GPT-4 Turbo 今日已消耗 90% 限额",
      "status": "unread",
      "createdAt": "2026-03-27T12:00:00Z"
    }
  ]
}
```

### 8.2 更新通知状态

```
PATCH /api/notifications/:id
```

**Request Body:**
```json
{
  "status": "read"
}
```

### 8.3 标记全部已读

```
POST /api/notifications/read-all
```

---

## 9. 审计日志 API

### 9.1 获取审计日志

```
GET /api/audit-logs
```

**Query Parameters:**
| 参数 | 类型 | 说明 |
|-----|------|------|
| startTime | string | 开始时间 ISO8601 |
| endTime | string | 结束时间 ISO8601 |
| action | string | 操作类型 |
| userId | string | 用户 ID |

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "audit_001",
      "userId": "user_001",
      "userName": "张三",
      "action": "project.create",
      "target": "proj_001",
      "targetName": "Aegis OS 开发",
      "details": "创建了新项目",
      "changes": {
        "before": null,
        "after": { "name": "Aegis OS 开发" }
      },
      "timestamp": "2026-03-27T12:00:00Z"
    }
  ]
}
```

---

## 10. 系统 API

### 10.1 获取系统健康

```
GET /api/system/health
```

**Response:**
```json
{
  "success": true,
  "data": {
    "status": "healthy",
    "uptime": 86400,
    "memory": { "used": 512, "total": 2048 },
    "cpu": { "load": 0.45 },
    "database": "connected",
    "openclaw": "connected"
  }
}
```

### 10.2 获取运行时状态

```
GET /api/system/runtime
```

**Response:**
```json
{
  "success": true,
  "data": {
    "mode": "development",
    "version": "1.0.0",
    "features": {
      "sse": true,
      "websocket": false,
      "auth": true
    }
  }
}
```

---

## 11. 实时通信

### 11.1 SSE (Server-Sent Events)

前端通过 SSE 接收实时更新：

```
GET /api/sse/local-agent-monitor
```

**事件类型:**
- `snapshot`: 初始完整状态
- `update`: 增量更新
- `agent_status_change`: Agent 状态变化
- `task_update`: 任务更新

---

## 12. 错误码

| 错误码 | HTTP Status | 说明 |
|-------|-------------|------|
| UNAUTHORIZED | 401 | 未登录 |
| FORBIDDEN | 403 | 无权限 |
| NOT_FOUND | 404 | 资源不存在 |
| VALIDATION_ERROR | 400 | 参数校验失败 |
| INTERNAL_ERROR | 500 | 服务器内部错误 |
| SERVICE_UNAVAILABLE | 503 | 服务不可用 |

---

**文档版本历史**

| 版本 | 日期 | 修改内容 |
|-----|------|---------|
| v1.0 | 2026-03-27 | 初始版本 |

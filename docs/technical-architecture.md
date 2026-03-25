# OpenClaw Command Center 1.0 技术架构

## 1. 架构目标

当前阶段以“快速验证产品主链路”为第一目标，因此采用前后端分离、共享类型、内存数据、SSE 实时流的轻量架构。这样能尽快验证交互与数据契约，再逐步替换为正式基础设施。

## 2. 目录与职责

```text
apps/web
  React + Vite 前端
apps/api
  Express API + SSE mock realtime
packages/shared
  共享类型、枚举、常量
```

## 3. 前端架构

- React 18 + TypeScript
- React Router 管理页面
- 自定义 `api.ts` 作为请求层
- 页面级状态使用 `useState/useEffect`
- CSS 变量驱动设计系统，避免先引入过重 UI 框架

## 4. 后端架构

- Express 提供 REST API
- SSE 提供实时输出流
- 内存仓库存储项目、阶段、Agent 档案
- 简单规则引擎负责：
  - 需求解析
  - 项目创建
  - 阶段审批推进
  - 紧急介入与恢复

## 5. 实体模型

### 5.1 Project

- 基础信息：名称、需求、状态、阶段、进度
- 观测信息：理解确认卡、当前直播内容、待审批状态

### 5.2 Stage

- 阶段类型、状态、负责人、起止时间、交付物

### 5.3 TimelineEvent

- 事件类型、时间、角色、内容、优先级

### 5.4 AgentProfile

- 角色名称、职责、能力评分、风格标签、当前负载

## 6. API 设计

| 方法 | 路径 | 用途 |
|:---|:---|:---|
| `POST` | `/api/projects/preview` | 生成理解确认卡 |
| `GET` | `/api/projects` | 获取仪表盘项目列表 |
| `POST` | `/api/projects` | 创建项目 |
| `GET` | `/api/projects/:id` | 获取项目详情 |
| `POST` | `/api/projects/:id/approve` | 审批推进 |
| `POST` | `/api/projects/:id/intervene` | 紧急介入 |
| `POST` | `/api/projects/:id/resume` | 恢复项目 |
| `GET` | `/api/agents` | 获取角色列表 |
| `GET` | `/api/projects/:id/live` | SSE 实时流 |

## 7. 为什么使用 SSE

MVP 阶段重点是“看见实时过程”，而不是复杂双向通讯。SSE 在当前场景里足够简单稳定：

- 服务端实现成本低
- 前端接入简单
- 天然适合单向直播流

当后续进入正式多 Agent 编排时，再切换为 WebSocket 或事件总线更合适。

## 8. 未来演进路线

### Phase 2

- 接入 PostgreSQL
- 引入 Redis 做实时状态和任务队列
- 增加持久化时间轴和交付物版本

### Phase 3

- 接入真实 Agent 调度器
- 增加模型路由与降级
- 支持多项目并发执行

### Phase 4

- 多用户协作与权限
- 项目模板和知识库复用
- 自动化复盘与策略优化

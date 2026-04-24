# Deployment Guide

## 1. 目标

本项目同时支持两类发布：

- GitHub Pages 项目主页
- 带后端能力的正式运行环境

由于平台依赖 `Express + SQLite + OpenClaw workspace`，真正可用的工作台不能只部署成静态网页。正式运行环境必须支持：

- Node.js 服务进程
- 持久化磁盘
- SQLite 文件持久化
- OpenClaw 工作区持久化目录

## 2. 已内置的发布资产

- `Dockerfile`
- `.dockerignore`
- `render.yaml`
- `scripts/start-render.sh`
- `.github/workflows/ci.yml`
- `.github/workflows/pages.yml`

## 3. GitHub Pages 项目主页

仓库推送后，GitHub Actions 会自动把 `site/` 目录发布到 Pages。

预计访问地址：

- `https://hanlee118.github.io/ai-agent-/`

这个地址适合：

- 对外展示项目介绍
- 让客户或合作方快速了解产品能力
- 统一承载仓库、文档和部署说明入口

这个地址不等于完整工作台后端运行环境。

## 4. Render 部署

仓库已经提供 `render.yaml`，适合直接用 Blueprint 方式部署。

### 4.1 部署要求

- 连接 GitHub 仓库
- 选择 `render.yaml`
- 为服务提供持久化磁盘

### 4.2 默认环境变量

- `NODE_ENV=production`
- `PORT=10000`
- `DATABASE_URL=file:/var/data/occ/dev.db`
- `OPENCLAW_ROOT=/var/data/openclaw`
- `OPENCLAW_CONFIG_PATH=/var/data/openclaw/openclaw.json`
- `OPENCLAW_WORKSPACE_ROOT=/var/data/openclaw/workspace`
- `MODEL_PROVIDER=scripted`
- `WORKFLOW_V2_HERMES_ENABLED=false`
- `WORKFLOW_V2_HERMES_STAGE_MATCH=design`
- `WORKFLOW_V2_HERMES_ENDPOINT=`
- `WORKFLOW_V2_HERMES_REQUIRED=false`
- `PROJECT_STAGE_HERMES_REQUIRED=false`

Hermes 配置说明：

- `WORKFLOW_V2_HERMES_ENDPOINT` 可以是基础地址（例如 `http://127.0.0.1:3001`），服务会归一化到 `/mcp/execute`
- `WORKFLOW_V2_HERMES_REQUIRED=true` 时，workflow-v2 对 Hermes 失败采用 fail-closed（直接阻断）
- `PROJECT_STAGE_HERMES_REQUIRED=true` 时，项目阶段执行链对 Hermes 失败也采用 fail-closed
- 当两个 `*_REQUIRED=false` 时，Hermes 不可用会回退常规执行链，并在产物中记录 fallback 证据

### 4.3 首次上线后的事项

- 访问 `/health` 和 `/ready`
- 打开首页完成管理员初始化
- 如果要启用真实模型，进入系统页填写运行配置
- 如果要启用真实 OpenClaw 团队，需要把工作区和配置文件同步到挂载磁盘目录

## 5. Docker / 云主机部署

### 5.1 构建镜像

```bash
docker build -t ai-agent-workbench:1.0.0 .
```

### 5.2 运行容器

```bash
docker run -d \
  --name ai-agent-workbench \
  -p 8787:10000 \
  -e DATABASE_URL=file:/data/occ/dev.db \
  -e OPENCLAW_ROOT=/data/openclaw \
  -e OPENCLAW_CONFIG_PATH=/data/openclaw/openclaw.json \
  -e OPENCLAW_WORKSPACE_ROOT=/data/openclaw/workspace \
  -v /your/persistent/path:/data \
  ai-agent-workbench:1.0.0
```

## 6. 正式长期地址的建议

如果你要一个真正长期、稳定、可持续的线上地址，推荐使用：

### 方案 A

- GitHub Pages 作为项目官网
- Render 或云主机作为正式工作台服务
- 自己绑定自定义域名

### 方案 B

- 单独租用云主机
- 用 Docker 运行服务
- 用 Nginx / Caddy 反向代理并绑定 HTTPS 域名

## 7. 重要说明

如果只部署 GitHub Pages，你得到的是“长期稳定的项目官网地址”。

如果要让完整工作台持续在线可用，必须部署后端服务，并为数据库与 OpenClaw 工作区提供持久化存储。

## 8. 发布前自动验收

推荐把下面这条命令作为每次发布前的统一门禁：

```bash
pnpm test:smoke
```

它会覆盖：

- 构建产物与本地配置校验
- `/health` 与 `/ready`
- 管理员鉴权保护是否生效
- 项目、OpenClaw 工作区、Agent 列表接口
- 本地会话监控聚合接口
- 本地会话监控 SSE 实时推送首帧

CI 工作流也已经接入这条 smoke 验证，保证 `main` 分支上的构建不只是“能编译”，而是关键运行链路可自动检查。

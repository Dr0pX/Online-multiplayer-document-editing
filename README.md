# Online Multiplayer Document Editing

一个基于 React、TipTap 与 Yjs 的多人在线协作文档编辑平台。项目采用 pnpm workspace 管理前端、业务 API、实时协作服务及共享逻辑，支持文档实时同步、在线协作者状态、细粒度访问控制和版本差异查看。

> 项目当前提供本地开发配置。上线前请替换认证与内部服务密钥、配置数据库和跨域地址，并根据部署环境启用安全 Cookie 与 HTTPS/WSS。

## 功能特性

- **实时协同编辑**：TipTap 提供富文本编辑能力，Yjs CRDT 合并并发更新；Hocuspocus 通过 WebSocket 管理协作会话和文档同步。
- **在线状态与段落定位**：通过 Awareness 广播协作者身份、光标/选区及当前编辑段落，在编辑器中显示协作状态。
- **认证与会话续期**：短时效 Access Token 与 HttpOnly Refresh Token 分离；刷新令牌以哈希形式存储并支持轮换，前端在业务请求遇到 401 时尝试续期并重试。
- **文档和成员权限**：支持文档所有者及 `admin`、`editor`、`viewer` 角色，并在服务端校验查看、编辑、删除和成员管理权限。
- **权限变更即时生效**：API 服务通知独立部署的协作服务重新校验连接；服务端定期刷新会话授权，移除或降权成员的连接会被关闭。
- **版本历史与差异对比**：创建文档快照并按块展示新增、删除、修改和未更改内容，修改块提供词级差异标记。
- **协作状态持久化**：协作服务保存 Yjs 文档状态至 MySQL，重连后可恢复文档。
- **前后端分离部署**：Express API 与 Hocuspocus 协作服务作为独立应用运行，通过受内部密钥保护的 HTTP 控制接口通信。

## 技术栈

| 层级 | 技术 |
| --- | --- |
| 前端 | React 19、TypeScript、Vite、TipTap |
| 实时协作 | Yjs、Hocuspocus、WebSocket、Awareness |
| API 服务 | Node.js、Express、TypeScript |
| 数据存储 | MySQL、mysql2 |
| 共享与服务端 HTML 处理 | pnpm workspace、happy-dom、共享 TypeScript 包 |

## 项目结构

```text
.
├── apps/
│   ├── web/       # React 文档工作区与协同编辑器
│   ├── api/       # Express 认证、文档、成员和版本 API
│   └── collab/    # Hocuspocus WebSocket 协作服务
├── packages/
│   └── shared/    # 共享权限、协作与版本差异逻辑
├── package.json
└── pnpm-workspace.yaml
```

## 本地开发

### 环境要求

- Node.js（建议使用当前 LTS 版本）
- pnpm
- MySQL

### 安装依赖

```bash
pnpm install
```

### 配置服务

当前数据库连接、Token 密钥、协作服务控制密钥及端口配置位于以下源码文件中：

- `apps/api/src/config/index.ts`
- `apps/collab/src/config/index.ts`
- `apps/web/src/config/api.ts`

请在运行前按本机环境调整配置，并保证 API 与协作服务使用一致的 Token 密钥、控制密钥和数据库信息。创建配置指向的 MySQL 数据库，并按需初始化表结构；数据库 schema 文件位于 `apps/api/sql/` 与 `apps/collab/sql/`。不要将真实密钥或生产凭据提交到公开仓库。

### 启动应用

分别在终端中运行：

```bash
pnpm dev:api
pnpm dev:collab
pnpm dev:web
```

默认开发地址：

- Web：`http://localhost:5173`
- API：`http://localhost:3001`
- Collaboration WebSocket：`ws://localhost:3002`

## 构建

```bash
pnpm build:shared
pnpm build:api
pnpm build:collab
pnpm build:web
```

## 认证与安全说明

- Access Token 当前由前端保存在 `localStorage`；Refresh Token 通过 `HttpOnly` Cookie 传递，服务端仅保存其哈希。
- 仓库中的密钥、数据库凭据和 Cookie 安全属性是开发配置，不应直接用于生产环境。
- 生产部署应配置 HTTPS/WSS、强随机密钥、生产数据库账号和正确的前端来源，并检查 Cookie `Secure`、反向代理及跨域策略。
- `apps/api` 与 `apps/collab` 之间的内部控制接口应限制网络可达范围，并使用独立强密钥。

## 实现说明

- 版本差异逻辑位于共享包中，使用 `happy-dom` 在 Node.js 服务端解析 HTML，再按块与词级别生成差异结果。
- 文档协作状态和版本快照是不同的数据：前者用于恢复 Yjs 实时状态，后者用于查看显式保存的历史版本。
- 项目使用 Performance API / Web Vitals 进行系统化性能采集的能力目前未在依赖或应用代码中体现；如需公开介绍该项能力，建议在接入并验证后再补充。


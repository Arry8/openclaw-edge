# OpenClaw 项目架构文档

> 文档版本：1.0  
> 生成时间：2026-03-20  
> 项目版本：2026.3.14

---

## 📋 目录

1. [项目概述](#1-项目概述)
2. [整体架构](#2-整体架构)
3. [核心组件详解](#3-核心组件详解)
4. [数据流和调用链](#4-数据流和调用链)
5. [目录结构](#5-目录结构)
6. [关键技术点](#6-关键技术点)
7. [安全模型](#7-安全模型)
8. [扩展机制](#8-扩展机制)

---

## 1. 项目概述

### 1.1 项目定位

**OpenClaw** 是一个个人 AI 助手系统，运行在用户自己的设备上。它的核心特点是：

- **多通道支持**：支持 WhatsApp、Telegram、Slack、Discord、Signal、iMessage 等 20+  messaging 平台
- **本地优先**：Gateway 运行在本地，数据不出域
- **可扩展**：通过插件系统支持自定义工具和能力
- **多设备协同**：支持 macOS、iOS、Android 设备作为节点连接

### 1.2 核心口号

> **EXFOLIATE! EXFOLIATE!**

### 1.3 技术栈

- **运行时**：Node.js 24+ (最低 22.16+)
- **语言**：TypeScript
- **包管理**：pnpm (推荐)、npm、bun
- **AI 框架**：基于 Pi Agent Core (`@mariozechner/pi-agent-*`)
- **协议**：ACP (Agent Client Protocol)、WebSocket 自定义协议

---

## 2. 整体架构

### 2.1 架构总览

```
┌─────────────────────────────────────────────────────────────────┐
│                      消息通道层 (Channels)                       │
│  WhatsApp │ Telegram │ Slack │ Discord │ Signal │ iMessage │... │
└────────────┬──────────┬────────┬─────────┬────────┬──────────┘
             │          │        │         │        │
             └──────────┴───┬────┴─────────┴────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Gateway (控制中心)                             │
│                   WebSocket: 127.0.0.1:18789                    │
│  ┌─────────────┬──────────────┬──────────────┬───────────────┐  │
│  │  会话管理   │   认证授权   │   事件总线   │   配置管理    │  │
│  │  Sessions   │     Auth     │    Events    │    Config     │  │
│  └─────────────┴──────────────┴──────────────┴───────────────┘  │
│  ┌─────────────┬──────────────┬──────────────┬───────────────┐  │
│  │   工具层    │   定时任务   │   媒体处理   │   安全策略    │  │
│  │   Tools     │     Cron     │    Media     │   Security    │  │
│  └─────────────┴──────────────┴──────────────┴───────────────┘  │
└────────────────────────────┬────────────────────────────────────┘
                             │
         ┌───────────────────┼───────────────────┐
         │                   │                   │
         ▼                   ▼                   ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│   CLI 客户端    │ │   WebChat UI    │ │   macOS App     │
│   (命令行)      │ │   (Web 界面)     │ │   (菜单栏)      │
└─────────────────┘ └─────────────────┘ └─────────────────┘
         │                   │                   │
         └───────────────────┼───────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Agent 运行时层                                │
│  ┌─────────────┬──────────────┬──────────────┬───────────────┐  │
│  │  Pi Agent   │   工具执行   │   会话状态   │   技能系统    │  │
│  │   Core      │   Executor   │    State     │    Skills     │  │
│  └─────────────┴──────────────┴──────────────┴───────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    设备节点层 (Nodes)                            │
│     macOS Node  │  iOS Node  │  Android Node  │  Headless      │
│  (Canvas/Camera)│(Voice/Canvas)│(全功能设备命令)│ (纯执行)      │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 核心设计原则

1. **单一 Gateway 原则**：每台主机运行一个 Gateway，作为所有消息表面的控制中心
2. **WebSocket 中心化**：所有客户端（CLI、Web、App、Nodes）通过 WebSocket 连接 Gateway
3. **会话隔离**：每个 Agent 有独立的会话空间，支持多租户隔离
4. **安全默认**：DM 消息默认需要配对批准，防止未授权访问

---

## 3. 核心组件详解

### 3.1 Gateway (网关)

**位置**: `src/gateway/`

Gateway 是整个系统的核心控制平面，负责：

#### 3.1.1 核心功能

| 模块 | 文件 | 功能 |
|------|------|------|
| 认证授权 | `auth.ts`, `auth-mode-policy.ts` | 设备配对、令牌验证、访问控制 |
| 会话管理 | `sessions/` | 会话创建、加载、持久化、清理 |
| 消息路由 | `chat-*.ts` | 消息接收、发送、附件处理 |
| 事件系统 | `event-*.ts` | WebSocket 事件推送、心跳 |
| 配置管理 | `config-reload.ts` | 配置热加载、验证 |
| 健康检查 | `channel-health-monitor.ts` | 通道健康监控 |

#### 3.1.2 WebSocket 协议

```typescript
// 连接握手
{
  type: "req",
  id: "uuid",
  method: "connect",
  params: {
    auth: { token: "xxx" },
    device: { id: "xxx", platform: "macos" },
    role: "client" | "node"
  }
}

// 请求/响应
{
  type: "req",
  id: "uuid",
  method: "agent" | "send" | "status",
  params: { ... }
}

// 服务器推送事件
{
  type: "event",
  event: "agent" | "chat" | "presence" | "tick",
  payload: { ... },
  seq: 123
}
```

### 3.2 Agent 运行时

**位置**: `src/agents/`

基于 Pi Agent Core 构建的 AI 代理运行时。

#### 3.2.1 核心模块

| 模块 | 文件 | 功能 |
|------|------|------|
| Agent 执行 | `pi-embedded-runner.ts` | 嵌入 Pi Agent 执行循环 |
| 工具系统 | `pi-tools.ts`, `openclaw-tools.ts` | 工具定义、执行、策略 |
| 会话订阅 | `pi-embedded-subscribe.ts` | 订阅 Gateway 事件流 |
| 模型管理 | `models-config.ts`, `model-fallback.ts` | 多模型配置、故障转移 |
| 技能系统 | `skills.ts` | 技能加载、安装、执行 |
| 沙箱执行 | `sandbox.ts` | 命令沙箱化执行 |

#### 3.2.2 Agent 工作空间

```
~/.openclaw/workspace/
├── AGENTS.md          # 操作指令和记忆
├── SOUL.md            # 人格、边界、语调
├── TOOLS.md           # 工具使用笔记
├── BOOTSTRAP.md       # 首次运行引导（完成后删除）
├── IDENTITY.md        # Agent 身份定义
├── USER.md            # 用户档案
└── memory/            # 日常记忆文件
    └── YYYY-MM-DD.md
```

### 3.3 通道系统 (Channels)

**位置**: `src/channels/`

支持 20+ 消息平台的通道层。

#### 3.3.1 核心通道

| 通道 | 实现 | 状态 |
|------|------|------|
| WhatsApp | Baileys | 核心支持 |
| Telegram | grammY | 核心支持 |
| Slack | Bolt SDK | 核心支持 |
| Discord | discord.js | 核心支持 |
| Signal | signal-cli | 核心支持 |
| iMessage | BlueBubbles API | 推荐 |
| iMessage (legacy) | imsg CLI | 已弃用 |
| WebChat | WebSocket | 核心支持 |

#### 3.3.2 插件通道

通过 npm 插件安装：
- Feishu (飞书)
- LINE
- Matrix
- Mattermost
- Microsoft Teams
- Nextcloud Talk
- Nostr
- Synology Chat
- Zalo

#### 3.3.3 通道插件架构

```typescript
// 通道插件接口
interface ChannelPlugin {
  name: string;
  connect(config: ChannelConfig): Promise<Connection>;
  sendMessage(target: Target, message: Message): Promise<SendResult>;
  onMessage(callback: (msg: IncomingMessage) => void): void;
}
```

### 3.4 工具系统 (Tools)

**位置**: `src/agents/pi-tools.ts`, `src/agents/openclaw-tools.ts`

#### 3.4.1 核心工具

| 工具 | 功能 | 沙箱 |
|------|------|------|
| `read` | 读取文件 | 否 |
| `write` | 写入文件 | 否 |
| `edit` | 编辑文件 | 否 |
| `exec` | 执行命令 | 是 (可配置) |
| `process` | 管理后台进程 | 是 |
| `browser` | 浏览器控制 | 否 |
| `canvas` | Canvas 渲染 | 否 |
| `nodes` | 设备节点控制 | 否 |
| `cron` | 定时任务 | 否 |
| `message` | 消息发送 | 否 |
| `web_search` | 网络搜索 | 否 |
| `web_fetch` | 网页抓取 | 否 |
| `memory_search` | 记忆搜索 | 否 |
| `sessions_*` | 会话管理 | 否 |

#### 3.4.2 工具执行流程

```
用户消息
   │
   ▼
┌─────────────────┐
│  Agent 决策     │
│  (选择工具)     │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  工具策略检查   │  ←── 工具白名单/黑名单
│  (tool-policy)  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  沙箱检查       │  ←── 是否需要沙箱
│  (sandbox)      │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  执行工具       │
│  (exec/read/..) │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  返回结果       │
│  (流式/批量)    │
└─────────────────┘
```

### 3.5 会话管理 (Sessions)

**位置**: `src/sessions/`, `src/gateway/sessions/`

#### 3.5.1 会话键格式

```
# 主会话 (直接聊天)
agent:<agentId>:main

# 群组会话
agent:<agentId>:group-<groupId>

# 每用户 DM 会话 (安全模式)
agent:<agentId>:dm-<channel>-<senderId>

# ACP 会话
acp:<uuid>
```

#### 3.5.2 会话存储结构

```
~/.openclaw/agents/<agentId>/sessions/
├── sessions.json           # 会话索引
├── <SessionId>.jsonl       # 会话记录 (JSONL 格式)
└── *.deleted.<timestamp>   # 归档记录
```

#### 3.5.3 会话维护策略

```json5
{
  session: {
    maintenance: {
      mode: "enforce",           // warn | enforce
      pruneAfter: "30d",         // 清理超过 30 天的会话
      maxEntries: 500,           // 最多保留 500 个会话
      rotateBytes: "10mb",       // 索引文件轮转大小
      maxDiskBytes: "1gb",       // 磁盘预算上限
      highWaterBytes: "800mb"    // 高水位线
    }
  }
}
```

### 3.6 模型管理 (Models)

**位置**: `src/agents/models-config.ts`, `src/providers/`

#### 3.6.1 支持的模型提供商

| 提供商 | 配置前缀 | 认证方式 |
|--------|----------|----------|
| OpenAI | `openai/` | API Key / OAuth |
| Anthropic | `anthropic/` | API Key |
| Google | `google/` | API Key / OAuth |
| Azure | `azure/` | API Key |
| Ollama | `ollama/` | 本地 |
| OpenRouter | `openrouter/` | API Key |
| xAI | `xai/` | API Key |
| 其他 50+ | 各种 | 多种 |

#### 3.6.2 模型故障转移

```typescript
// 配置示例
{
  agents: {
    defaults: {
      model: "anthropic/claude-opus-4-6",
      models: [
        "anthropic/claude-opus-4-6",
        "openai/gpt-5",
        "google/gemini-2.5-pro"
      ]
    }
  }
}

// 故障转移逻辑
当前模型失败
   │
   ▼
检查冷却时间 (cooldown)
   │
   ▼
切换到下一个可用模型
   │
   ▼
记录失败指标 (用于自动降级)
```

### 3.7 技能系统 (Skills)

**位置**: `skills/`, `src/agents/skills.ts`

#### 3.7.1 技能来源

1. **Bundled**: 内置技能 (随安装包分发)
2. **Managed**: 本地管理技能 (`~/.openclaw/skills/`)
3. **Workspace**: 工作区技能 (`<workspace>/skills/`)
4. **ClawHub**: 社区技能 registry (clawhub.ai)

#### 3.7.2 技能结构

```
<skill-name>/
├── SKILL.md           # 技能描述和使用说明
├── references/        # 参考资料
├── scripts/           # 执行脚本
└── agents/            # Agent 配置 (可选)
    └── openai.yaml
```

#### 3.7.3 技能触发

技能通过语义匹配自动触发：
- 用户消息 → 语义搜索 → 匹配技能 → 注入上下文

---

## 4. 数据流和调用链

### 4.1 消息接收流程

```
外部消息 (WhatsApp/Telegram/...)
        │
        ▼
┌───────────────────┐
│  Channel Plugin   │  ← 通道插件接收
│  (grammY/Baileys) │
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐
│  消息标准化       │  ← 转换为统一格式
│  (normalize)      │
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐
│  安全策略检查     │  ← DM 配对/白名单
│  (auth/pairing)   │
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐
│  会话路由         │  ← 确定目标会话
│  (session routing)│
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐
│  Gateway 事件推送  │  ← WebSocket event:chat
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐
│  Agent 处理       │  ← Pi Agent 执行
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐
│  响应发送         │  ← 原路返回
└───────────────────┘
```

### 4.2 Agent 执行流程

```
用户消息
   │
   ▼
┌─────────────────────────┐
│ 1. 加载会话上下文       │
│    - 历史消息           │
│    - 工作空间文件       │
│    - 技能上下文         │
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│ 2. 构建 Prompt          │
│    - 系统提示词         │
│    - 用户消息           │
│    - 工具定义           │
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│ 3. 调用模型 API         │
│    - 流式响应           │
│    - 工具调用解析       │
└────────────┬────────────┘
             │
        ┌────┴────┐
        │ 有工具？ │
        └────┬────┘
             │
      ┌──────┴──────┐
      │             │
     是            否
      │             │
      ▼             │
┌───────────┐       │
│ 4. 执行工具│       │
│    - 策略检查      │
│    - 沙箱执行      │
│    - 结果收集      │
└─────┬─────┘       │
      │             │
      ▼             │
┌───────────┐       │
│ 5. 继续对话│       │
│    (带工具结果)    │
└─────┬─────┘       │
      │             │
      └──────┬──────┘
             │
             ▼
┌─────────────────────────┐
│ 6. 流式回复             │
│    - 分块发送           │
│    - 工具摘要           │
└─────────────────────────┘
```

### 4.3 WebSocket 事件流

```
Gateway                              Client
   │                                   │
   │◄──────── connect (req) ──────────│
   │                                   │
   │──────── connect (res) ──────────►│
   │   payload: hello-ok              │
   │                                   │
   │──────── event:presence ─────────►│
   │──────── event:tick ─────────────►│
   │                                   │
   │◄──────── agent (req) ────────────│
   │   params: { message: "..." }     │
   │                                   │
   │──────── agent (res) ────────────►│
   │   ack: { runId, status }         │
   │                                   │
   │──────── event:agent ────────────►│
   │   streaming blocks...            │
   │                                   │
   │──────── event:agent (final) ────►│
   │   status: complete               │
   │                                   │
```

### 4.4 设备节点调用链

```
Client (macOS App)                    Gateway                    Node (iOS)
   │                                     │                          │
   │◄────── node.list (req) ────────────│                          │
   │                                     │                          │
   │──────── node.list (res) ──────────►│                          │
   │   nodes: [{id, caps, ...}]         │                          │
   │                                     │                          │
   │◄────── node.invoke (req) ──────────│                          │
   │   target: "ios-xxx"                │                          │
   │   command: "camera_snap"           │                          │
   │                                     │──── invoke ────────────►│
   │                                     │                          │
   │                                     │◄─── result ─────────────│
   │                                     │   { image: "base64..." }│
   │◄────── node.invoke (res) ──────────│                          │
   │                                     │                          │
```

---

## 5. 目录结构

### 5.1 根目录结构

```
openclaw/
├── apps/                    # 客户端应用
│   ├── android/            # Android 节点应用
│   ├── ios/                # iOS 节点应用
│   └── macos/              # macOS 菜单栏应用
├── src/                     # 核心源代码
│   ├── acp/                # ACP 协议桥接
│   ├── agents/             # Agent 运行时
│   ├── browser/            # 浏览器控制
│   ├── channels/           # 消息通道
│   ├── cli/                # 命令行界面
│   ├── config/             # 配置管理
│   ├── gateway/            # Gateway 核心
│   ├── media/              # 媒体处理
│   ├── memory/             # 记忆系统
│   ├── plugins/            # 插件系统
│   ├── process/            # 进程管理
│   ├── providers/          # 模型提供商
│   ├── security/           # 安全模块
│   ├── sessions/           # 会话管理
│   └── tools/              # 工具定义
├── extensions/              # 扩展插件
│   ├── anthropic/          # Anthropic 提供商
│   ├── discord/            # Discord 通道
│   ├── openai/             # OpenAI 提供商
│   ├── telegram/           # Telegram 通道
│   └── ... (50+ 扩展)
├── packages/                # 子包
│   ├── clawdbot/           # Clawdbot 兼容层
│   └── moltbot/            # Moltbot 兼容层
├── skills/                  # 内置技能
├── docs/                    # 文档
├── scripts/                 # 构建/测试脚本
├── test/                    # 测试文件
├── ui/                      # Web UI
└── openclaw.mjs            # CLI 入口
```

### 5.2 核心模块依赖关系

```
┌─────────────────────────────────────────────────────────────┐
│                      CLI (openclaw.mjs)                     │
└────────────────────────────┬────────────────────────────────┘
                             │
         ┌───────────────────┼───────────────────┐
         │                   │                   │
         ▼                   ▼                   ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│   src/cli/      │ │   src/gateway/  │ │   src/agents/   │
│   (命令解析)    │ │   (WS 服务器)    │ │   (Agent 运行)   │
└────────┬────────┘ └────────┬────────┘ └────────┬────────┘
         │                   │                   │
         │         ┌─────────┴─────────┐         │
         │         │                   │         │
         ▼         ▼                   ▼         ▼
┌─────────────────────────────────────────────────────────────┐
│                    src/plugin-sdk/                          │
│              (插件 SDK - 所有模块的公共依赖)                  │
└─────────────────────────────────────────────────────────────┘
         │                   │                   │
         ▼                   ▼                   ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│ src/channels/   │ │ src/providers/  │ │ src/tools/      │
│ (通道实现)      │ │ (模型提供商)    │ │ (工具定义)      │
└─────────────────┘ └─────────────────┘ └─────────────────┘
```

### 5.3 关键文件清单

#### Gateway 核心
- `src/gateway/boot.ts` - Gateway 启动引导
- `src/gateway/auth.ts` - 认证授权
- `src/gateway/client.ts` - WebSocket 客户端管理
- `src/gateway/chat-send.ts` - 消息发送
- `src/gateway/agent-prompt.ts` - Agent 调用

#### Agent 运行时
- `src/agents/pi-embedded-runner.ts` - Pi Agent 执行器
- `src/agents/pi-embedded-subscribe.ts` - 事件订阅
- `src/agents/pi-tools.ts` - 工具定义
- `src/agents/models-config.ts` - 模型配置
- `src/agents/skills.ts` - 技能系统

#### 通道系统
- `src/channels/plugins/` - 通道插件目录
- `src/channels/transport/` - 传输层
- `src/channels/allowlists/` - 白名单管理

#### 会话管理
- `src/sessions/store.ts` - 会话存储
- `src/sessions/compaction.ts` - 会话压缩
- `src/sessions/maintenance.ts` - 会话维护

---

## 6. 关键技术点

### 6.1 WebSocket 协议设计

**特点**:
- 基于 JSON 的轻量级协议
- 请求 - 响应 + 事件推送混合模式
- 支持设备配对和令牌认证
- 序列号保证事件顺序

**关键消息类型**:
```typescript
type Frame =
  | ConnectRequest      // 握手
  | ConnectResponse     // 握手响应
  | MethodRequest       // 方法调用
  | MethodResponse      // 方法响应
  | ServerEvent;        // 服务器推送
```

### 6.2 会话隔离策略

**DM 作用域配置**:
```json5
{
  session: {
    // 所有 DM 共享一个会话 (默认，适合单用户)
    dmScope: "main",
    
    // 按发送者隔离 (推荐多用户)
    dmScope: "per-peer",
    
    // 按通道 + 发送者隔离 (最安全)
    dmScope: "per-channel-peer",
    
    // 按账户 + 通道 + 发送者隔离 (多账户)
    dmScope: "per-account-channel-peer"
  }
}
```

### 6.3 工具沙箱机制

**沙箱模式**:
```json5
{
  agents: {
    defaults: {
      sandbox: {
        mode: "non-main",  // 非主会话使用沙箱
        allow: ["bash", "read", "write", "edit"],
        deny: ["browser", "nodes", "cron"]
      }
    }
  }
}
```

**Docker 沙箱**:
- 非主会话在 Docker 容器中执行命令
- 文件系统挂载限制在工作区
- 网络访问受限

### 6.4 模型故障转移

**故障转移策略**:
1. 按配置顺序尝试模型
2. 记录失败次数和冷却时间
3. 自动跳过冷却中的模型
4. 支持手动优先级覆盖

**实现要点**:
```typescript
interface AuthProfile {
  provider: string;
  lastUsed: number;
  failureCount: number;
  cooldownUntil?: number;
  isHealthy: boolean;
}
```

### 6.5 流式响应处理

**分块策略**:
- 默认 800-1200 字符分块
- 优先在段落边界分割
- 支持软分块 (语义完整)
- 可配置合并空闲时间

**块类型**:
```typescript
type BlockType = 
  | "text_start"
  | "text_delta"
  | "text_end"
  | "tool_call"
  | "tool_result"
  | "reasoning";
```

### 6.6 记忆系统

**双层记忆架构**:
```
短期记忆 (Session)          长期记忆 (MEMORY.md)
├── 当前会话完整记录    ↔   ├── 重要决策
├── 工具调用历史        ↔   ├── 用户偏好
└── 上下文窗口内内容    ↔   └── 关键经验
```

**记忆搜索**:
- 语义搜索 (向量相似度)
- 支持路径引用
- 自动截断长结果

---

## 7. 安全模型

### 7.1 认证层次

```
┌─────────────────────────────────────────┐
│  1. 设备配对 (Device Pairing)           │
│     - 新设备需要批准                     │
│     - 颁发设备令牌                       │
└─────────────────┬───────────────────────┘
                  │
┌─────────────────▼───────────────────────┐
│  2. Gateway 认证 (Auth Mode)             │
│     - none: 无认证 (本地开发)            │
│     - password: 密码认证                 │
│     - token: 令牌认证 (推荐)             │
│     - tailscale: Tailscale 身份          │
└─────────────────┬───────────────────────┘
                  │
┌─────────────────▼───────────────────────┐
│  3. 通道级访问控制                       │
│     - allowFrom: 白名单                  │
│     - dmPolicy: DM 策略 (pairing/open)   │
│     - groupPolicy: 群组策略             │
└─────────────────────────────────────────┘
```

### 7.2 DM 安全

**问题场景**:
```
用户 A → Agent: "我的病历号是 XXX"
用户 B → Agent: "我们刚才在聊什么？"
→ 如果共享会话，Agent 可能泄露 A 的信息给 B
```

**解决方案**:
```json5
{
  session: {
    dmScope: "per-channel-peer"  // 隔离每个用户的 DM
  }
}
```

### 7.3 工具安全策略

**策略检查点**:
1. 工具调用前：检查白名单/黑名单
2. 执行前：检查是否需要沙箱
3. 执行中：监控资源使用
4. 执行后：审计日志

**敏感工具**:
- `exec`: 命令执行 (需要沙箱)
- `browser`: 浏览器控制 (可能泄露隐私)
- `nodes`: 设备控制 (物理安全)

---

## 8. 扩展机制

### 8.1 插件系统

**插件类型**:
1. **通道插件**: 添加新的 messaging 平台
2. **提供商插件**: 添加新的 AI 模型提供商
3. **工具插件**: 添加新的工具能力
4. **技能插件**: 添加领域特定技能

**插件入口**:
```typescript
// extensions/<plugin-name>/src/index.ts
export default definePlugin({
  name: "my-plugin",
  version: "1.0.0",
  
  // 通道插件
  channels: [/* ... */],
  
  // 提供商插件
  providers: [/* ... */],
  
  // 工具插件
  tools: [/* ... */],
  
  // 生命周期钩子
  hooks: {
    onGatewayStart: () => { /* ... */ },
    onAgentInit: () => { /* ... */ }
  }
});
```

### 8.2 技能系统

**技能定义** (`SKILL.md`):
```markdown
# skill-name

## Description
技能描述...

## When to Use
- 触发条件 1
- 触发条件 2

## Usage
使用说明...

## References
- 参考资料链接
```

**技能加载顺序**:
1. Workspace 技能 (最高优先级)
2. Managed 技能
3. Bundled 技能

### 8.3 ACP 桥接

**用途**: 让 IDE (如 Zed、Cursor) 通过 ACP 协议控制 OpenClaw

**配置示例** (`~/.config/zed/settings.json`):
```json
{
  "agent_servers": {
    "OpenClaw ACP": {
      "type": "custom",
      "command": "openclaw",
      "args": ["acp", "--url", "wss://gateway:18789"],
      "env": {}
    }
  }
}
```

**会话映射**:
- ACP session → Gateway session key
- 支持会话持久化和重新连接
- 支持会话列表和加载

---

## 附录

### A. 配置参考

完整配置参考：[docs/gateway/configuration.md](https://docs.openclaw.ai/gateway/configuration)

### B. API 文档

- Gateway WebSocket API: `docs/gateway/protocol.md`
- Plugin SDK: `docs/tools/plugin.md`
- Skills: `docs/tools/skills.md`

### C. 相关资源

- 官方网站：https://openclaw.ai
- 文档：https://docs.openclaw.ai
- GitHub: https://github.com/openclaw/openclaw
- Discord: https://discord.gg/clawd
- ClawHub (技能注册表): https://clawhub.ai

---

*文档结束* 🦞

# Channels 架构详解

> 本文档深入解析 OpenClaw 的 Channels（消息渠道）系统，包括插件架构、消息流程、适配器等核心概念。

## 目录

1. [概述](#概述)
2. [Channel 插件架构](#channel-插件架构)
3. [消息收发流程](#消息收发流程)
4. [核心适配器](#核心适配器)
5. [Channel 配置](#channel-配置)
6. [支持的平台](#支持的平台)
7. [实现细节](#实现细节)

---

## 概述

### 什么是 Channels？

**Channels** 是 OpenClaw 与外部消息平台（如 WhatsApp、Telegram、Discord、QQ 等）的连接接口。

每个 Channel：
- 作为一个**插件**实现
- 提供统一的 API 接口
- 处理平台特定的消息格式
- 管理认证和连接状态

### 设计目标

1. **统一接口**：所有 Channel 遵循相同的插件契约
2. **可扩展**：轻松添加新的消息平台
3. **隔离性**：每个 Channel 独立运行，互不影响
4. **灵活性**：支持多个账号、多种配置

---

## Channel 插件架构

### 插件类型

OpenClaw 插件分为几类：

| 类型 | 说明 | 示例 |
|------|------|------|
| **Channel Plugin** | 消息渠道插件 | Discord、Telegram、WhatsApp |
| **Provider Plugin** | AI 模型提供商 | Anthropic、Google、Dashscope |
| **Tool Plugin** | 工具扩展 | 浏览器、文件操作 |
| **Service Plugin** | 后台服务 | TTS、图像生成 |

### Channel 插件结构

```
extensions/<channel-name>/
├── openclaw.plugin.json    # 插件元数据
├── package.json            # NPM 依赖
├── index.ts                # 插件入口
├── src/
│   ├── channel.ts          # Channel 核心实现
│   ├── runtime.ts          # 运行时设置
│   ├── subagent-hooks.ts   # Subagent 钩子
│   └── ...                 # 其他模块
└── api.ts                  # API 定义（可选）
```

### 插件元数据

`openclaw.plugin.json` 示例：

```json
{
  "id": "discord",
  "channels": ["discord"],
  "configSchema": {
    "type": "object",
    "additionalProperties": false,
    "properties": {}
  }
}
```

| 字段 | 说明 |
|------|------|
| `id` | 插件唯一标识符 |
| `channels` | 支持的渠道列表 |
| `configSchema` | 配置 JSON Schema |

### 插件入口

```typescript
// extensions/discord/index.ts
import { defineChannelPluginEntry } from "openclaw/plugin-sdk/core";
import { discordPlugin } from "./src/channel.js";
import { setDiscordRuntime } from "./src/runtime.js";
import { registerDiscordSubagentHooks } from "./src/subagent-hooks.js";

export default defineChannelPluginEntry({
  id: "discord",
  name: "Discord",
  description: "Discord channel plugin",
  plugin: discordPlugin,
  setRuntime: setDiscordRuntime,
  registerFull: registerDiscordSubagentHooks,
});
```

### 核心接口

Channel 插件必须实现 `ChannelPlugin` 接口：

```typescript
interface ChannelPlugin<TResolvedAccount = any> {
  id: string;
  meta?: ChannelMeta;
  setupWizard?: SetupWizard;
  capabilities?: ChannelCapabilities;
  adapters: {
    messaging: ChannelMessagingAdapter<TResolvedAccount>;
    outbound?: ChannelOutboundAdapter<TResolvedAccount>;
    pairing?: ChannelPairingAdapter<TResolvedAccount>;
    security?: ChannelSecurityAdapter<TResolvedAccount>;
    threading?: ChannelThreadingAdapter<TResolvedAccount>;
  };
}
```

---

## 消息收发流程

### Inbound 消息流程

```
┌─────────────────────────────────────────────────────────────────┐
│                        Inbound Message Flow                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. 外部平台 (WhatsApp/Telegram/Discord)                          │
│         │                                                        │
│         ▼                                                        │
│  2. Channel Plugin (接收 webhook/轮询)                            │
│         │                                                        │
│         ▼                                                        │
│  3. Inbound Envelope (标准化消息格式)                             │
│         │                                                        │
│         ▼                                                        │
│  4. Routing (解析路由规则，确定 Agent)                            │
│         │                                                        │
│         ▼                                                        │
│  5. Session Resolution (确定 Session Key)                         │
│         │                                                        │
│         ▼                                                        │
│  6. Agent Processing (AI 处理消息)                                │
│         │                                                        │
│         ▼                                                        │
│  7. Response Generation (生成回复)                                │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Outbound 消息流程

```
┌─────────────────────────────────────────────────────────────────┐
│                       Outbound Message Flow                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. Agent 生成回复                                                │
│         │                                                        │
│         ▼                                                        │
│  2. Reply Pipeline (处理回复格式)                                 │
│         │                                                        │
│         ▼                                                        │
│  3. Session Route Resolution (确定发送目标)                       │
│         │                                                        │
│         ▼                                                        │
│  4. Channel Outbound Adapter (平台特定发送)                       │
│         │                                                        │
│         ▼                                                        │
│  5. 外部平台 (消息送达用户)                                        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Inbound Envelope 结构

```typescript
interface InboundEnvelope {
  // 消息标识
  messageId: string;
  conversationId: string;
  
  // 发送者信息
  senderId: string;
  senderLabel?: string;
  
  // 渠道信息
  channel: string;
  accountId: string;
  
  // 消息内容
  body: string;
  attachments?: MediaAttachment[];
  
  // 上下文信息
  replyToId?: string;
  replyToBody?: string;
  replyToSender?: string;
  
  // 时间戳
  timestamp: number;
  
  // 元数据
  metadata?: Record<string, any>;
}
```

---

## 核心适配器

### Messaging Adapter

处理消息的接收和发送：

```typescript
interface ChannelMessagingAdapter<T> {
  // 接收消息
  startReceiving?(ctx: ChannelMessagingContext<T>): Promise<void>;
  stopReceiving?(): Promise<void>;
  
  // 解析 outbound 路由
  resolveOutboundSessionRoute?(
    params: ResolveOutboundSessionRouteParams
  ): ChannelOutboundSessionRoute;
}
```

### Outbound Adapter

处理消息发送：

```typescript
interface ChannelOutboundAdapter<T> {
  sendMessage(
    ctx: ChannelOutboundContext<T>,
    payload: OutboundMessagePayload
  ): Promise<SendMessageResult>;
}
```

### Pairing Adapter

处理设备配对（如 WhatsApp QR 登录）：

```typescript
interface ChannelPairingAdapter<T> {
  startPairing?(ctx: PairingContext): Promise<PairingResult>;
  approvePairing?(ctx: ApprovePairingContext): Promise<void>;
  rejectPairing?(ctx: RejectPairingContext): Promise<void>;
}
```

### Security Adapter

处理安全策略（如 allowlist）：

```typescript
interface ChannelSecurityAdapter<T> {
  resolveAllowFrom?(ctx: SecurityContext): Promise<AllowFromResult>;
}
```

### Threading Adapter

处理线程/话题（如 Discord 线程、Telegram 话题）：

```typescript
interface ChannelThreadingAdapter<T> {
  resolveThreadSessionKeys?(
    ctx: ThreadingContext
  ): Promise<ThreadSessionKeys>;
}
```

---

## Channel 配置

### 配置位置

Channel 配置存储在 `~/.openclaw/openclaw.json`：

```json5
{
  "channels": {
    "telegram": {
      "enabled": true,
      "defaultAccount": "default",
      "accounts": {
        "default": {
          "botToken": "$secret:telegram-bot-token"
        }
      }
    },
    "discord": {
      "enabled": true,
      "accounts": {
        "main": {
          "botToken": "$secret:discord-bot-token",
          "guildId": "123456789"
        }
      }
    },
    "qqbot": {
      "enabled": true,
      "appId": "1903635658",
      "clientSecret": "$secret:qq-client-secret"
    }
  }
}
```

### 配置字段

| 字段 | 说明 |
|------|------|
| `enabled` | 是否启用该渠道 |
| `defaultAccount` | 默认账号（多账号时必需） |
| `accounts` | 账号配置对象 |
| `accounts.<id>` | 具体账号配置 |

### 密钥管理

敏感信息使用 `$secret:` 引用：

```json5
{
  "channels": {
    "telegram": {
      "accounts": {
        "default": {
          "botToken": "$secret:telegram-bot-token"
        }
      }
    }
  }
}
```

密钥存储在：
- `~/.openclaw/secrets/` 目录
- 或使用外部密钥管理服务

---

## 支持的平台

### 核心支持

| 平台 | 状态 | 插件路径 |
|------|------|----------|
| WhatsApp | ✅ 稳定 | `extensions/whatsapp` |
| Telegram | ✅ 稳定 | `extensions/telegram` |
| Discord | ✅ 稳定 | `extensions/discord` |
| Slack | ✅ 稳定 | `extensions/slack` |
| Signal | ✅ 稳定 | `extensions/signal` |
| iMessage (BlueBubbles) | ✅ 稳定 | `extensions/bluebubbles` |
| QQ Bot | ✅ 稳定 | `extensions/qqbot` |

### 插件支持（需单独安装）

| 平台 | 类型 | 说明 |
|------|------|------|
| Feishu/Lark | 企业 | 飞书机器人 |
| LINE | 社交 | LINE Messaging API |
| Matrix | 协议 | Matrix 协议 |
| Mattermost | 企业 | Mattermost Bot API |
| Microsoft Teams | 企业 | Bot Framework |
| Nextcloud Talk | 自托管 | Nextcloud Talk |
| Nostr | 去中心化 | NIP-04 DMs |
| Google Chat | 企业 | Google Chat API |
| IRC | 经典 | IRC 协议 |
| Twitch | 直播 | Twitch Chat |
| Zalo | 社交 | 越南流行 messenger |

### 平台能力对比

| 功能 | WhatsApp | Telegram | Discord | Slack |
|------|----------|----------|---------|-------|
| 文本消息 | ✅ | ✅ | ✅ | ✅ |
| 图片/媒体 | ✅ | ✅ | ✅ | ✅ |
| 群组消息 | ✅ | ✅ | ✅ | ✅ |
| 线程/话题 | ❌ | ✅ (话题) | ✅ (线程) | ✅ (线程) |
| 反应 (Reactions) | ✅ | ✅ | ✅ | ✅ |
| 编辑消息 | ✅ | ✅ | ✅ | ✅ |
| 撤回消息 | ✅ | ✅ | ✅ | ✅ |
| 文件传输 | ✅ | ✅ | ✅ | ✅ |

---

## 实现细节

### 核心代码位置

| 组件 | 文件路径 |
|------|----------|
| Channel 注册表 | `src/channels/registry.ts` |
| Channel 配置 | `src/channels/channel-config.ts` |
| Plugin SDK Core | `src/plugin-sdk/core.ts` |
| Plugin Entry | `src/plugin-sdk/plugin-entry.ts` |
| Inbound Envelope | `src/plugin-sdk/inbound-envelope.ts` |
| Reply Pipeline | `src/plugin-sdk/reply-pipeline.ts` |
| Outbound Session | `src/infra/outbound/base-session-key.ts` |

### Channel 注册表

```typescript
// src/channels/registry.ts
export function getChatChannelMeta(channelId: string): ChatChannelMeta {
  // 返回渠道元数据（名称、图标、能力等）
}

export function normalizeChatChannelId(raw?: string | null): string | null {
  // 规范化渠道 ID
}
```

### 消息标准化

所有 Channel 的消息都会被标准化为统一的 `InboundEnvelope` 格式：

```typescript
// src/plugin-sdk/inbound-envelope.ts
export function createInboundEnvelope(params: {
  channel: string;
  accountId: string;
  messageId: string;
  senderId: string;
  body: string;
  // ...
}): InboundEnvelope {
  return {
    // 标准化格式
  };
}
```

### 回复管道

```typescript
// src/plugin-sdk/reply-pipeline.ts
export async function processReplyPipeline(
  ctx: ReplyPipelineContext
): Promise<ReplyResult> {
  // 1. 格式化回复内容
  // 2. 处理引用/线程
  // 3. 发送消息
  // 4. 返回结果
}
```

### 会话键构建

Outbound 消息的会话键构建：

```typescript
// src/infra/outbound/base-session-key.ts
export function buildOutboundBaseSessionKey(params: {
  cfg: OpenClawConfig;
  agentId: string;
  channel: string;
  accountId?: string;
  peer: { kind: "direct" | "group" | "channel"; id: string };
}): string {
  // 构建会话键
  return `agent:${agentId}:${channel}:${peer.kind}:${peer.id}`;
}
```

### 插件加载流程

```
1. Gateway 启动
       │
       ▼
2. 扫描 extensions/ 目录
       │
       ▼
3. 读取 openclaw.plugin.json
       │
       ▼
4. 验证插件契约
       │
       ▼
5. 加载插件入口 (index.ts)
       │
       ▼
6. 注册 Channel 到 Registry
       │
       ▼
7. 初始化 Channel 运行时
       │
       ▼
8. 启动消息接收
```

---

## 开发新 Channel 插件

### 基本步骤

1. **创建插件目录**
   ```bash
   mkdir -p extensions/my-channel/src
   ```

2. **创建插件元数据**
   ```json
   // extensions/my-channel/openclaw.plugin.json
   {
     "id": "my-channel",
     "channels": ["my-channel"],
     "configSchema": { ... }
   }
   ```

3. **实现 Channel 接口**
   ```typescript
   // extensions/my-channel/src/channel.ts
   export const myChannelPlugin: ChannelPlugin = {
     id: "my-channel",
     adapters: {
       messaging: { ... },
       outbound: { ... },
     },
   };
   ```

4. **创建插件入口**
   ```typescript
   // extensions/my-channel/index.ts
   export default defineChannelPluginEntry({
     id: "my-channel",
     name: "My Channel",
     plugin: myChannelPlugin,
   });
   ```

### 必备适配器

至少实现 `messaging` 适配器：

```typescript
const messagingAdapter: ChannelMessagingAdapter = {
  async startReceiving(ctx) {
    // 实现消息接收逻辑
  },
  
  resolveOutboundSessionRoute(params) {
    // 实现路由解析
  },
};
```

---

## 调试与故障排除

### 日志级别

```bash
# 查看所有 Channel 日志
DEBUG=openclaw:channels* openclaw gateway start

# 查看特定 Channel 日志
DEBUG=openclaw:channels:telegram* openclaw gateway start

# 查看路由日志
DEBUG=openclaw:routing* openclaw gateway start
```

### 常见问题

#### 1. Channel 无法连接

检查：
- 认证信息是否正确
- 网络是否可达
- 防火墙/代理设置

#### 2. 消息无法发送

检查：
- `resolveOutboundSessionRoute` 实现
- 目标 peer ID 是否正确
- 渠道 API 限制

#### 3. 配对失败

检查：
- 配对流程是否正确实现
- QR 码/验证码是否正确处理
- 超时设置是否合理

---

## 最佳实践

### 1. 使用标准错误处理

```typescript
try {
  await sendMessage(payload);
} catch (error) {
  if (isRateLimitError(error)) {
    // 处理限流
  } else if (isAuthError(error)) {
    // 处理认证错误
  } else {
    // 其他错误
  }
}
```

### 2. 实现消息去重

```typescript
const seenMessages = new Set<string>();

function shouldProcessMessage(messageId: string): boolean {
  if (seenMessages.has(messageId)) {
    return false;
  }
  seenMessages.add(messageId);
  setTimeout(() => seenMessages.delete(messageId), 300000);
  return true;
}
```

### 3. 合理处理媒体

- 检查文件大小限制
- 使用临时文件处理大文件
- 清理临时文件

### 4. 实现连接重试

```typescript
async function connectWithRetry(): Promise<void> {
  let retries = 0;
  while (retries < MAX_RETRIES) {
    try {
      await connect();
      return;
    } catch (error) {
      retries++;
      await sleep(Math.pow(2, retries) * 1000);
    }
  }
  throw new Error("Connection failed after retries");
}
```

---

## 参考资料

- [Channel Routing](/channels/channel-routing)
- [Channel Troubleshooting](/channels/troubleshooting)
- [Plugin SDK](/plugins/sdk)
- [Groups](/channels/groups)
- [Security](/gateway/security)

---

*文档生成时间：2026-03-22*
*基于 OpenClaw 源码版本：2026.3.3*

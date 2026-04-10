# Channels 架构高级指南

> 深入解析 OpenClaw Channel 插件系统的源码实现、适配器模式和开发实践。

## 目录

1. [插件系统架构](#插件系统架构)
2. [适配器模式详解](#适配器模式详解)
3. [消息处理管道](#消息处理管道)
4. [Channel 插件开发实战](#channel-插件开发实战)
5. [性能与稳定性](#性能与稳定性)
6. [故障排查](#故障排查)

---

## 插件系统架构

### 插件类型层次

```
OpenClaw Plugins
│
├── Channel Plugins (消息渠道)
│   ├── WhatsApp
│   ├── Telegram
│   ├── Discord
│   └── ...
│
├── Provider Plugins (AI 模型)
│   ├── Anthropic
│   ├── Google
│   ├── Dashscope
│   └── ...
│
├── Tool Plugins (工具扩展)
│   ├── Browser
│   ├── File Operations
│   └── ...
│
└── Service Plugins (后台服务)
    ├── TTS
    ├── Image Generation
    └── ...
```

### Channel 插件生命周期

```
┌────────────────────────────────────────────────────────────┐
│                    Plugin Lifecycle                         │
├────────────────────────────────────────────────────────────┤
│                                                             │
│  1. Discovery (扫描 extensions/ 目录)                        │
│         │                                                   │
│         ▼                                                   │
│  2. Validation (验证 openclaw.plugin.json)                  │
│         │                                                   │
│         ▼                                                   │
│  3. Loading (加载 index.ts 入口)                            │
│         │                                                   │
│         ▼                                                   │
│  4. Registration (注册到 Channel Registry)                  │
│         │                                                   │
│         ▼                                                   │
│  5. Initialization (初始化运行时)                           │
│         │                                                   │
│         ▼                                                   │
│  6. Start Receiving (开始接收消息)                          │
│         │                                                   │
│         ▼                                                   │
│  7. Runtime (处理消息)                                      │
│         │                                                   │
│         ▼                                                   │
│  8. Shutdown (优雅关闭)                                     │
│                                                             │
└────────────────────────────────────────────────────────────┘
```

### 插件元数据详解

```json
{
  "id": "discord",
  "channels": ["discord"],
  "configSchema": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "guildId": {
        "type": "string",
        "description": "Default Discord server ID"
      },
      "enableReactions": {
        "type": "boolean",
        "default": true
      }
    }
  },
  "capabilities": {
    "reactions": true,
    "threads": true,
    "media": ["image", "video", "file"],
    "edit": true,
    "delete": true
  }
}
```

### 插件入口模板

```typescript
// extensions/my-channel/index.ts
import { defineChannelPluginEntry } from "openclaw/plugin-sdk/core";
import { myChannelPlugin } from "./src/channel.js";
import { setMyChannelRuntime } from "./src/runtime.js";

export { myChannelPlugin } from "./src/channel.js";
export { setMyChannelRuntime } from "./src/runtime.js";

export default defineChannelPluginEntry({
  id: "my-channel",
  name: "My Channel",
  description: "My custom channel plugin",
  plugin: myChannelPlugin,
  setRuntime: setMyChannelRuntime,
  // 可选：注册 subagent 钩子
  registerFull: registerMyChannelSubagentHooks,
});
```

---

## 适配器模式详解

### 适配器类型总览

```typescript
interface ChannelPlugin<TResolvedAccount = any> {
  id: string;
  adapters: {
    // 必需：消息处理
    messaging: ChannelMessagingAdapter<TResolvedAccount>;
    
    // 可选：出站消息
    outbound?: ChannelOutboundAdapter<TResolvedAccount>;
    
    // 可选：设备配对
    pairing?: ChannelPairingAdapter<TResolvedAccount>;
    
    // 可选：安全策略
    security?: ChannelSecurityAdapter<TResolvedAccount>;
    
    // 可选：线程处理
    threading?: ChannelThreadingAdapter<TResolvedAccount>;
  };
}
```

### Messaging Adapter (必需)

```typescript
interface ChannelMessagingAdapter<T> {
  // 开始接收消息
  startReceiving?(ctx: ChannelMessagingContext<T>): Promise<void>;
  
  // 停止接收
  stopReceiving?(): Promise<void>;
  
  // 解析出站路由
  resolveOutboundSessionRoute?(
    params: ResolveOutboundSessionRouteParams
  ): ChannelOutboundSessionRoute;
}
```

**实现示例**：

```typescript
// extensions/telegram/src/channel.ts
const messagingAdapter: ChannelMessagingAdapter<TelegramAccount> = {
  async startReceiving(ctx) {
    const { account, runtime } = ctx;
    
    // 使用 grammY 接收消息
    const bot = new Bot(account.botToken);
    
    bot.on("message:text", async (msgCtx) => {
      const envelope: InboundEnvelope = {
        messageId: String(msgCtx.message.message_id),
        conversationId: String(msgCtx.chat.id),
        senderId: String(msgCtx.from.id),
        senderLabel: msgCtx.from.first_name,
        channel: "telegram",
        accountId: account.id,
        body: msgCtx.message.text,
        timestamp: Date.now(),
        metadata: {
          chatType: msgCtx.chat.type,
        },
      };
      
      await runtime.handleInbound(envelope);
    });
    
    await bot.start();
  },
  
  resolveOutboundSessionRoute(params) {
    const { channel, accountId, peer } = params;
    return {
      sessionKey: `agent:${params.agentId}:telegram:${peer.kind}:${peer.id}`,
      peer,
      chatType: peer.kind === "group" ? "group" : "direct",
      from: accountId,
      to: peer.id,
    };
  },
};
```

### Outbound Adapter (可选)

```typescript
interface ChannelOutboundAdapter<T> {
  sendMessage(
    ctx: ChannelOutboundContext<T>,
    payload: OutboundMessagePayload
  ): Promise<SendMessageResult>;
  
  editMessage?(
    ctx: ChannelOutboundContext<T>,
    messageId: string,
    newText: string
  ): Promise<void>;
  
  deleteMessage?(
    ctx: ChannelOutboundContext<T>,
    messageId: string
  ): Promise<void>;
}
```

**实现示例**：

```typescript
const outboundAdapter: ChannelOutboundAdapter<TelegramAccount> = {
  async sendMessage(ctx, payload) {
    const { account, route } = ctx;
    const bot = new Bot(account.botToken);
    
    const result = await bot.api.sendMessage(
      route.to,
      payload.body,
      {
        reply_parameters: payload.replyToId ? {
          message_id: parseInt(payload.replyToId)
        } : undefined,
      }
    );
    
    return {
      messageId: String(result.message_id),
      timestamp: Date.now(),
    };
  },
  
  async editMessage(ctx, messageId, newText) {
    const { account, route } = ctx;
    const bot = new Bot(account.botToken);
    
    await bot.api.editMessageText(
      route.to,
      parseInt(messageId),
      { text: newText }
    );
  },
  
  async deleteMessage(ctx, messageId) {
    const { account, route } = ctx;
    const bot = new Bot(account.botToken);
    
    await bot.api.deleteMessage(route.to, parseInt(messageId));
  },
};
```

### Pairing Adapter (可选)

用于需要配对的渠道（WhatsApp、Signal 等）：

```typescript
interface ChannelPairingAdapter<T> {
  startPairing?(ctx: PairingContext): Promise<PairingResult>;
  approvePairing?(ctx: ApprovePairingContext): Promise<void>;
  rejectPairing?(ctx: RejectPairingContext): Promise<void>;
}
```

**WhatsApp 实现示例**：

```typescript
// extensions/whatsapp/src/pairing.ts
const pairingAdapter: ChannelPairingAdapter<WhatsAppAccount> = {
  async startPairing(ctx) {
    const { runtime } = ctx;
    
    // 使用 Baileys 库生成 QR 码
    const { state, saveCreds } = useMultiFileAuthState(...);
    const conn = makeWASocket({ auth: state });
    
    conn.ev.on("connection.update", async (update) => {
      const { qr } = update;
      if (qr) {
        // 将 QR 码发送给运行时
        await runtime.handlePairingQR(qr);
      }
    });
    
    return { status: "pending", qrRequired: true };
  },
  
  async approvePairing(ctx) {
    const { accountId, runtime } = ctx;
    // 保存认证信息
    await runtime.saveAuth(accountId);
  },
  
  async rejectPairing(ctx) {
    const { accountId } = ctx;
    // 清理认证信息
    await runtime.clearAuth(accountId);
  },
};
```

### Security Adapter (可选)

```typescript
interface ChannelSecurityAdapter<T> {
  resolveAllowFrom?(ctx: SecurityContext): Promise<AllowFromResult>;
}
```

**实现示例**：

```typescript
const securityAdapter: ChannelSecurityAdapter = {
  async resolveAllowFrom(ctx) {
    const { channel, config } = ctx;
    
    // 从配置中读取 allowFrom 列表
    const allowFrom = config.channels?.[channel]?.allowFrom ?? [];
    
    return {
      allowFrom,
      mode: "allowlist", // 或 "blocklist"
    };
  },
};
```

### Threading Adapter (可选)

处理线程/话题：

```typescript
interface ChannelThreadingAdapter<T> {
  resolveThreadSessionKeys?(
    ctx: ThreadingContext
  ): Promise<ThreadSessionKeys>;
}
```

**Discord 线程实现**：

```typescript
const threadingAdapter: ChannelThreadingAdapter = {
  async resolveThreadSessionKeys(ctx) {
    const { channel, accountId, guildId, channelId, threadId } = ctx;
    
    // 基础会话键（父频道）
    const baseSessionKey = `agent:${ctx.agentId}:discord:channel:${channelId}`;
    
    // 线程会话键
    const threadSessionKey = `${baseSessionKey}:thread:${threadId}`;
    
    return {
      baseSessionKey,
      threadSessionKey,
      inheritContext: true, // 线程继承父频道上下文
    };
  },
};
```

---

## 消息处理管道

### Inbound 消息处理流程

```typescript
// src/plugin-sdk/inbound-envelope.ts

export async function processInboundMessage(
  envelope: InboundEnvelope,
  runtime: PluginRuntime
): Promise<void> {
  // 1. 消息去重
  if (await isDuplicate(envelope.messageId)) {
    return;
  }
  
  // 2. 构建路由输入
  const routeInput: ResolveAgentRouteInput = {
    channel: envelope.channel,
    accountId: envelope.accountId,
    peer: {
      kind: envelope.metadata?.chatType ?? "direct",
      id: envelope.senderId,
    },
    // ...
  };
  
  // 3. 解析路由
  const route = resolveRoute(routeInput);
  
  // 4. 构建会话键
  const sessionKey = buildAgentSessionKey({
    agentId: route.agentId,
    channel: route.channel,
    accountId: route.accountId,
    peer: routeInput.peer,
  });
  
  // 5. 处理消息
  await runtime.handleInboundWithSession(envelope, sessionKey);
}
```

### Outbound 消息处理流程

```typescript
// src/plugin-sdk/reply-pipeline.ts

export async function processReplyPipeline(
  ctx: ReplyPipelineContext
): Promise<ReplyResult> {
  const { agentId, sessionKey, body, attachments, replyToId } = ctx;
  
  // 1. 解析会话元数据
  const sessionMeta = parseSessionKey(sessionKey);
  
  // 2. 构建出站路由
  const outboundRoute = resolveOutboundSessionRoute({
    agentId,
    channel: sessionMeta.channel,
    accountId: sessionMeta.accountId,
    peer: sessionMeta.peer,
  });
  
  // 3. 格式化回复
  const formattedBody = formatReply(body, {
    replyToId,
    platform: sessionMeta.channel,
  });
  
  // 4. 发送消息
  const result = await sendOutboundMessage({
    route: outboundRoute,
    body: formattedBody,
    attachments,
  });
  
  // 5. 记录发送结果
  await recordSendResult(sessionKey, result);
  
  return result;
}
```

### 消息标准化

```typescript
// 统一的消息格式
interface StandardizedMessage {
  // 标识
  id: string;
  conversationId: string;
  
  // 参与者
  from: {
    id: string;
    label?: string;
    kind: "user" | "bot" | "system";
  };
  to: {
    id: string;
    kind: "direct" | "group" | "channel";
  };
  
  // 内容
  content: {
    type: "text" | "image" | "video" | "audio" | "file";
    body: string;
    attachments?: MediaAttachment[];
  };
  
  // 上下文
  replyTo?: {
    messageId: string;
    senderId: string;
    body: string;
  };
  
  // 时间
  timestamp: number;
  
  // 元数据
  metadata: Record<string, any>;
}
```

---

## Channel 插件开发实战

### 步骤 1: 创建插件目录

```bash
mkdir -p extensions/my-channel/src
cd extensions/my-channel
```

### 步骤 2: 创建 package.json

```json
{
  "name": "openclaw-channel-my-channel",
  "version": "1.0.0",
  "type": "module",
  "main": "./index.ts",
  "exports": {
    ".": "./index.ts",
    "./package.json": "./package.json"
  },
  "dependencies": {
    "openclaw": "workspace:*"
  },
  "peerDependencies": {
    "typescript": "^5.0.0"
  }
}
```

### 步骤 3: 创建插件元数据

```json
// openclaw.plugin.json
{
  "id": "my-channel",
  "channels": ["my-channel"],
  "configSchema": {
    "type": "object",
    "properties": {
      "apiKey": {
        "type": "string",
        "format": "secret"
      }
    },
    "required": ["apiKey"]
  },
  "capabilities": {
    "reactions": false,
    "threads": false,
    "media": ["image"],
    "edit": false,
    "delete": true
  }
}
```

### 步骤 4: 实现 Channel 核心

```typescript
// src/channel.ts
import type { ChannelPlugin, InboundEnvelope } from "openclaw/plugin-sdk/core";

export const myChannelPlugin: ChannelPlugin = {
  id: "my-channel",
  
  adapters: {
    messaging: {
      async startReceiving(ctx) {
        const { account, runtime } = ctx;
        
        // 实现消息接收逻辑
        // 例如：WebSocket 连接、轮询等
        
        const connection = await connect(account.apiKey);
        
        connection.on("message", async (data) => {
          const envelope: InboundEnvelope = {
            messageId: data.id,
            conversationId: data.conversationId,
            senderId: data.fromId,
            senderLabel: data.fromName,
            channel: "my-channel",
            accountId: account.id,
            body: data.text,
            timestamp: data.timestamp,
          };
          
          await runtime.handleInbound(envelope);
        });
      },
      
      resolveOutboundSessionRoute(params) {
        return {
          sessionKey: `agent:${params.agentId}:my-channel:direct:${params.peer.id}`,
          peer: params.peer,
          chatType: "direct",
          from: params.accountId,
          to: params.peer.id,
        };
      },
    },
    
    outbound: {
      async sendMessage(ctx, payload) {
        const { account, route } = ctx;
        
        // 实现消息发送逻辑
        const result = await sendApiMessage(account.apiKey, {
          to: route.to,
          text: payload.body,
        });
        
        return {
          messageId: result.id,
          timestamp: Date.now(),
        };
      },
    },
  },
};
```

### 步骤 5: 创建插件入口

```typescript
// index.ts
import { defineChannelPluginEntry } from "openclaw/plugin-sdk/core";
import { myChannelPlugin } from "./src/channel.js";

export { myChannelPlugin } from "./src/channel.js";

export default defineChannelPluginEntry({
  id: "my-channel",
  name: "My Channel",
  description: "My custom channel plugin",
  plugin: myChannelPlugin,
});
```

### 步骤 6: 测试插件

```bash
# 在 OpenClaw 中加载插件
openclaw gateway restart

# 查看插件状态
openclaw extensions list

# 查看日志
DEBUG=openclaw:channels:my-channel* openclaw gateway start
```

---

## 性能与稳定性

### 1. 连接管理

```typescript
// 单例连接管理
const connections = new Map<string, Connection>();

async function getConnection(accountId: string): Promise<Connection> {
  const existing = connections.get(accountId);
  if (existing && existing.isConnected()) {
    return existing;
  }
  
  const newConn = await createConnection(accountId);
  connections.set(accountId, newConn);
  
  // 监听断开重连
  newConn.on("disconnected", async () => {
    connections.delete(accountId);
    await reconnect(accountId);
  });
  
  return newConn;
}
```

### 2. 消息队列

```typescript
// 出站消息队列
const outboundQueue = new Map<string, AsyncQueue>();

async function queueSendMessage(
  sessionKey: string,
  payload: OutboundMessagePayload
): Promise<void> {
  // 获取或创建会话队列
  let queue = outboundQueue.get(sessionKey);
  if (!queue) {
    queue = new AsyncQueue({ concurrency: 1 });
    outboundQueue.set(sessionKey, queue);
  }
  
  // 加入队列
  await queue.add(async () => {
    await sendMessage(payload);
  });
}
```

### 3. 速率限制

```typescript
// 实现速率限制
class RateLimiter {
  private tokens: number;
  private lastRefill: number;
  
  constructor(private maxTokens: number, private refillRate: number) {
    this.tokens = maxTokens;
    this.lastRefill = Date.now();
  }
  
  async acquire(): Promise<void> {
    this.refill();
    
    if (this.tokens < 1) {
      const waitTime = (1 - this.tokens) / this.refillRate * 1000;
      await sleep(waitTime);
      this.refill();
    }
    
    this.tokens -= 1;
  }
  
  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
  }
}
```

### 4. 错误处理

```typescript
// 分类错误处理
async function sendMessageWithRetry(
  payload: OutboundMessagePayload,
  maxRetries = 3
): Promise<SendMessageResult> {
  let lastError: Error;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await sendMessage(payload);
    } catch (error) {
      lastError = error as Error;
      
      if (isRateLimitError(error)) {
        const retryAfter = getRetryAfter(error);
        await sleep(retryAfter);
        continue;
      }
      
      if (isAuthError(error)) {
        // 认证错误，不重试
        throw error;
      }
      
      if (isNetworkError(error)) {
        // 网络错误，指数退避
        await sleep(Math.pow(2, i) * 1000);
        continue;
      }
      
      // 其他错误，不重试
      throw error;
    }
  }
  
  throw lastError!;
}
```

---

## 故障排查

### 常见问题及解决方案

#### 1. 插件无法加载

**症状**：`openclaw extensions list` 不显示插件

**检查**：
```bash
# 检查插件目录结构
ls -la extensions/my-channel/

# 检查 package.json
cat extensions/my-channel/package.json

# 检查 openclaw.plugin.json
cat extensions/my-channel/openclaw.plugin.json
```

**解决**：
- 确保 `openclaw.plugin.json` 格式正确
- 确保 `index.ts` 导出正确
- 重启 Gateway

#### 2. 消息无法接收

**症状**：消息发送但 OpenClaw 无响应

**检查**：
```bash
# 查看详细日志
DEBUG=openclaw:channels:my-channel* openclaw gateway start

# 检查连接状态
openclaw extensions show my-channel
```

**解决**：
- 检查 API 密钥是否正确
- 检查网络连接
- 检查 webhook 配置（如适用）

#### 3. 消息无法发送

**症状**：AI 生成回复但用户未收到

**检查**：
```bash
# 检查出站日志
DEBUG=openclaw:outbound* openclaw gateway start

# 检查会话路由
openclaw sessions show <sessionKey>
```

**解决**：
- 检查 `resolveOutboundSessionRoute` 实现
- 检查目标 peer ID 是否正确
- 检查 API 权限

#### 4. 内存泄漏

**症状**：Gateway 内存使用持续增长

**检查**：
```bash
# 监控内存
ps aux | grep openclaw

# 检查连接数
lsof -p <pid> | wc -l
```

**解决**：
- 确保连接正确关闭
- 使用 WeakMap 缓存
- 定期清理过期数据

---

## 参考资料

- [Plugin SDK Core](https://github.com/openclaw/openclaw/blob/main/src/plugin-sdk/core.ts)
- [Channel Plugin Types](https://github.com/openclaw/openclaw/blob/main/src/channels/plugins/types.plugin.ts)
- [Reply Pipeline](https://github.com/openclaw/openclaw/blob/main/src/plugin-sdk/reply-pipeline.ts)
- [Inbound Envelope](https://github.com/openclaw/openclaw/blob/main/src/plugin-sdk/inbound-envelope.ts)

---

*文档版本：1.0*
*更新时间：2026-03-22*

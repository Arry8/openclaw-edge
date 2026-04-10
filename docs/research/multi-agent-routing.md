# Multi-Agent Routing 详解

> 本文档深入解析 OpenClaw 的多 Agent 路由机制，包括路由规则、会话管理、绑定配置等核心概念。

## 目录

1. [核心概念](#核心概念)
2. [路由规则详解](#路由规则详解)
3. [会话键 (Session Key) 结构](#会话键-session-key-结构)
4. [Bindings 配置](#bindings-配置)
5. [多 Agent 沙箱隔离](#多-agent-沙箱隔离)
6. [广播组 (Broadcast Groups)](#广播组-broadcast-groups)
7. [实现细节](#实现细节)

---

## 核心概念

### 什么是 Multi-Agent Routing？

OpenClaw 允许在单个 Gateway 实例中运行**多个独立的 Agent**，每个 Agent 拥有：
- 独立的工作空间 (workspace)
- 独立的会话存储 (session store)
- 独立的工具权限 (tool policy)
- 独立的模型配置 (model config)
- 独立的认证信息 (auth profiles)

**Multi-Agent Routing** 就是决定**哪个 inbound 消息应该由哪个 Agent 处理**的机制。

### 关键术语

| 术语 | 说明 |
|------|------|
| **Channel** | 消息渠道，如 `whatsapp`、`telegram`、`discord`、`slack`、`qqbot` 等 |
| **AccountId** | 每个渠道可以有多个账号实例（如多个 WhatsApp 账号） |
| **AgentId** | 独立 Agent 的标识符，如 `main`、`support`、`family` |
| **SessionKey** | 用于存储上下文和控制并发的 bucket key |
| **Binding** | 将 inbound 渠道/账号/对等方映射到 Agent 的规则 |
| **Peer** | 消息的发送方或目标（个人、群组、频道） |

---

## 路由规则详解

### 路由优先级

当一条消息进入时，OpenClaw 按以下顺序匹配 Agent：

```
1. Exact peer match (bindings 中的 peer.kind + peer.id)
   ↓
2. Parent peer match (线程继承)
   ↓
3. Guild + roles match (Discord 的服务器 + 角色)
   ↓
4. Guild match (Discord 服务器)
   ↓
5. Team match (Slack 团队)
   ↓
6. Account match (渠道的 accountId)
   ↓
7. Channel match (该渠道的任何账号，accountId: "*")
   ↓
8. Default agent (agents.list[].default 或第一个条目，回退到 main)
```

### 匹配逻辑

当 binding 包含多个匹配字段时，**所有提供的字段必须全部匹配**才能生效。

示例：
```json5
{
  "match": {
    "channel": "discord",
    "guildId": "123456789",
    "roles": ["admin", "mod"]
  },
  "agentId": "mod-bot"
}
```
只有同时满足：Discord 渠道 + 特定服务器 + 特定角色 的消息才会路由到 `mod-bot`。

---

## 会话键 (Session Key) 结构

### Session Key 格式

Session Key 是用于存储会话上下文和并发控制的唯一标识符。

#### 直接消息 (DM)
直接消息通常折叠到 Agent 的 **main** 会话：
```
agent:<agentId>:<mainKey>
// 默认：agent:main:main
```

#### 群组和频道
群组和频道保持隔离，每个频道独立：
```
// 群组
agent:<agentId>:<channel>:group:<id>

// 频道/聊天室
agent:<agentId>:<channel>:channel:<id>
```

#### 线程 (Threads)
Slack/Discord 线程在基础键后附加 `:thread:<threadId>`：
```
agent:main:discord:channel:123456:thread:987654
```

Telegram 论坛话题在群组键中嵌入 `:topic:<topicId>`：
```
agent:main:telegram:group:-1001234567890:topic:42
```

### DM 会话范围配置

通过 `session.dmScope` 配置直接消息的会话折叠行为：

| 值 | 行为 |
|---|------|
| `main` | 所有 DM 共享一个 main 会话（默认） |
| `per-peer` | 每个对等方独立会话 |
| `per-channel-peer` | 每个渠道 + 对等方组合独立会话 |
| `per-account-channel-peer` | 每个账号 + 渠道 + 对等方组合独立会话 |

### Main DM Route Pinning

当 `session.dmScope` 为 `main` 时，为防止非所有者 DM 覆盖 main 会话的 `lastRoute`，OpenClaw 会从 `allowFrom` 推断一个固定的所有者：

条件：
1. `allowFrom` 恰好有一个非通配符条目
2. 该条目可以规范化为该渠道的具体发送者 ID
3. inbound DM 发送者与该固定所有者不匹配

在这种情况下，OpenClaw 仍会记录 inbound 会话元数据，但**跳过更新 main 会话的 `lastRoute`**。

---

## Bindings 配置

### 基本结构

```json5
{
  "agents": {
    "list": [
      {
        "id": "main",
        "default": true,
        "name": "Personal Assistant",
        "workspace": "~/.openclaw/workspace"
      },
      {
        "id": "support",
        "name": "Support Bot",
        "workspace": "~/.openclaw/workspace-support"
      }
    ]
  },
  "bindings": [
    {
      "match": {
        "channel": "slack",
        "teamId": "T123"
      },
      "agentId": "support"
    },
    {
      "match": {
        "channel": "telegram",
        "peer": {
          "kind": "group",
          "id": "-100123"
        }
      },
      "agentId": "support"
    }
  ]
}
```

### 匹配字段说明

| 字段 | 说明 | 示例 |
|------|------|------|
| `channel` | 渠道名称 | `"whatsapp"`, `"telegram"`, `"discord"` |
| `accountId` | 渠道账号 ID | `"default"`, `"*"`, 或具体账号 ID |
| `peer.kind` | 对等方类型 | `"direct"`, `"group"`, `"channel"` |
| `peer.id` | 对等方 ID | 群组 ID、用户 ID 等 |
| `guildId` | Discord 服务器 ID | `"123456789"` |
| `teamId` | Slack 团队 ID | `"T123"` |
| `roles` | Discord 角色 ID 列表 | `["role1", "role2"]` |

### 通配符使用

`accountId` 可以使用 `"*"` 表示该渠道的所有账号：
```json5
{
  "match": {
    "channel": "whatsapp",
    "accountId": "*"
  },
  "agentId": "main"
}
```

---

## 多 Agent 沙箱隔离

### 沙箱模式

每个 Agent 可以独立配置沙箱模式：

```json5
{
  "agents": {
    "list": [
      {
        "id": "main",
        "sandbox": { "mode": "off" }  // 无沙箱，完全访问
      },
      {
        "id": "family",
        "sandbox": {
          "mode": "all",  // 所有命令都沙箱化
          "scope": "agent"  // 每个 Agent 独立容器
        }
      },
      {
        "id": "work",
        "sandbox": {
          "mode": "non-main",  // 仅非 main Agent 沙箱化
          "scope": "shared",  // 共享容器池
          "workspaceRoot": "/tmp/work-sandboxes"
        }
      }
    ]
  }
}
```

### 沙箱范围 (Scope)

| Scope | 行为 |
|-------|------|
| `agent` | 每个 Agent 一个独立容器 |
| `session` | 每个会话一个独立容器 |
| `shared` | 多个 Agent 共享容器池 |

### 工具权限

每个 Agent 可以独立配置工具允许/拒绝列表：

```json5
{
  "agents": {
    "list": [
      {
        "id": "family",
        "tools": {
          "allow": ["read"],
          "deny": ["exec", "write", "edit", "browser", "process"]
        }
      }
    ]
  }
}
```

### 配置文件

- **全局配置**: `~/.openclaw/openclaw.json`
- **Agent 专属配置**: `~/.openclaw/agents/<agentId>/agent/config.json`
- **认证信息**: `~/.openclaw/agents/<agentId>/agent/auth-profiles.json`

⚠️ **重要**: 认证信息是**每个 Agent 独立的**，不会在 Agent 之间共享。

---

## 广播组 (Broadcast Groups)

### 什么是广播组？

广播组允许在**同一对等方**上运行**多个 Agent**，通常用于：
- WhatsApp 群组中多个 Bot 同时响应
- 需要多个视角的场景（如一个 Bot 负责回答问题，另一个负责记录日志）

### 配置示例

```json5
{
  "broadcast": {
    "strategy": "parallel",  // 并行执行
    "120363403215116621@g.us": ["alfred", "baerbel"],  // WhatsApp 群组
    "+15555550123": ["support", "logger"]  // 个人号码
  }
}
```

### 触发条件

广播组仅在 OpenClaw **正常会回复**的情况下触发，例如：
- WhatsApp 群组中，经过提及/激活门控后
- 满足其他渠道的回复条件

### 策略

| 策略 | 行为 |
|------|------|
| `parallel` | 所有 Agent 并行执行，各自独立回复 |
| `sequential` | 按顺序执行（较少使用） |

---

## 实现细节

### 核心代码位置

| 组件 | 文件路径 |
|------|----------|
| 路由解析 | `src/routing/resolve-route.ts` |
| 会话键构建 | `src/routing/session-key.ts` |
| Bindings 列表 | `src/routing/bindings.ts` |
| Agent 范围 | `src/agents/agent-scope.ts` |

### 路由解析流程

```typescript
// 伪代码示例
function resolveRoute(input: ResolveAgentRouteInput): ResolvedAgentRoute {
  // 1. 获取所有 bindings
  const bindings = listBindings(cfg);
  
  // 2. 按优先级匹配
  for (const binding of bindings) {
    if (matchesPeer(binding, input.peer)) {
      return resolveWithBinding(binding, "binding.peer");
    }
    if (matchesGuildAndRoles(binding, input)) {
      return resolveWithBinding(binding, "binding.guild+roles");
    }
    if (matchesGuild(binding, input.guildId)) {
      return resolveWithBinding(binding, "binding.guild");
    }
    if (matchesTeam(binding, input.teamId)) {
      return resolveWithBinding(binding, "binding.team");
    }
    if (matchesAccount(binding, input.accountId)) {
      return resolveWithBinding(binding, "binding.account");
    }
    if (matchesChannel(binding, input.channel)) {
      return resolveWithBinding(binding, "binding.channel");
    }
  }
  
  // 3. 回退到默认 Agent
  return resolveDefaultAgent(cfg, input);
}
```

### 会话键构建逻辑

```typescript
// 伪代码示例
function buildAgentSessionKey(params): string {
  const { agentId, channel, accountId, peer, dmScope } = params;
  
  // DM 折叠
  if (peer.kind === "direct" && dmScope === "main") {
    return `agent:${agentId}:main`;
  }
  
  // 群组/频道隔离
  if (peer.kind === "group") {
    return `agent:${agentId}:${channel}:group:${peer.id}`;
  }
  
  // 频道/聊天室
  if (peer.kind === "channel") {
    return `agent:${agentId}:${channel}:channel:${peer.id}`;
  }
  
  // 默认
  return `agent:${agentId}:${channel}:${peer.id}`;
}
```

### 缓存机制

`resolve-route.ts` 实现了 Agent 查找缓存：
- `agentLookupCacheByCfg`: WeakMap，按配置缓存
- 避免每次路由都重新解析 Agent 列表

---

## 调试与故障排除

### 查看当前路由

使用 `openclaw status` 查看当前会话的路由信息。

### 日志级别

设置 `DEBUG=openclaw:routing*` 查看详细的路由日志。

### 常见问题

#### 1. 消息路由到错误的 Agent

检查：
- `bindings` 配置顺序（优先级从高到低）
- `peer.id` 是否正确（注意字符串 vs 数字）
- `accountId` 是否匹配

#### 2. 会话上下文丢失

检查：
- `sessionKey` 是否一致
- `dmScope` 配置是否合理
- 是否有多个 binding 匹配同一对等方

#### 3. 沙箱工具被拒绝

使用 `openclaw sandbox explain <command>` 查看工具拒绝原因。

---

## 最佳实践

### 1. 明确命名 Agent

```json5
{
  "agents": {
    "list": [
      { "id": "main", "name": "Personal Assistant", "default": true },
      { "id": "support", "name": "Customer Support" },
      { "id": "dev-bot", "name": "Development Helper" }
    ]
  }
}
```

### 2. 使用具体的 Binding 匹配

优先使用 `peer` 匹配，其次 `guildId`/`teamId`，最后 `channel` 通配符。

### 3. 隔离敏感 Agent

对家庭/儿童使用的 Agent 启用沙箱和工具限制：
```json5
{
  "id": "family",
  "sandbox": { "mode": "all", "scope": "agent" },
  "tools": {
    "allow": ["read", "web_search"],
    "deny": ["exec", "write", "browser"]
  }
}
```

### 4. 定期备份 Agent 配置

每个 Agent 的配置和认证信息独立存储，定期备份 `~/.openclaw/agents/` 目录。

---

## 参考资料

- [Channel Routing](/channels/channel-routing)
- [Broadcast Groups](/channels/broadcast-groups)
- [Sandboxing](/gateway/sandboxing)
- [Multi-Agent Sandbox & Tools](/tools/multi-agent-sandbox-tools)
- [Groups](/channels/groups)

---

*文档生成时间：2026-03-22*
*基于 OpenClaw 源码版本：2026.3.3*

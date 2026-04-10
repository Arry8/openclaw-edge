# Multi-Agent Routing 高级指南

> 深入解析 OpenClaw 多 Agent 路由的高级配置、源码实现和最佳实践。

## 目录

1. [路由引擎源码解析](#路由引擎源码解析)
2. [Session Key 深度解析](#session-key-深度解析)
3. [Binding 匹配算法](#binding-匹配算法)
4. [高级配置示例](#高级配置示例)
5. [性能优化](#性能优化)
6. [安全考虑](#安全考虑)

---

## 路由引擎源码解析

### 核心文件结构

```
src/routing/
├── resolve-route.ts        # 主路由解析器
├── session-key.ts          # Session Key 构建
├── bindings.ts             # Binding 管理
├── account-id.ts           # Account ID 规范化
└── account-lookup.ts       # Account 查找
```

### resolve-route.ts 核心逻辑

```typescript
// 简化的路由解析流程
export function resolveRoute(input: ResolveAgentRouteInput): ResolvedAgentRoute {
  const { cfg, channel, accountId, peer, parentPeer, guildId, teamId, memberRoleIds } = input;
  
  // 1. 获取所有 bindings
  const bindings = listBindings(cfg);
  
  // 2. 按优先级匹配
  for (const binding of bindings) {
    // 2.1 精确 peer 匹配（最高优先级）
    if (binding.match.peer && peer) {
      if (binding.match.peer.id === peer.id && 
          binding.match.peer.kind === peer.kind) {
        return buildRoute(binding, "binding.peer");
      }
    }
    
    // 2.2 父 peer 匹配（线程继承）
    if (parentPeer && binding.match.peer) {
      if (binding.match.peer.id === parentPeer.id) {
        return buildRoute(binding, "binding.peer.parent");
      }
    }
    
    // 2.3 Discord: Guild + Roles 匹配
    if (binding.match.guildId && binding.match.roles) {
      if (binding.match.guildId === guildId) {
        const hasRole = memberRoleIds?.some(r => binding.match.roles!.includes(r));
        if (hasRole) {
          return buildRoute(binding, "binding.guild+roles");
        }
      }
    }
    
    // 2.4 Discord: Guild 匹配
    if (binding.match.guildId && binding.match.guildId === guildId) {
      return buildRoute(binding, "binding.guild");
    }
    
    // 2.5 Slack: Team 匹配
    if (binding.match.teamId && binding.match.teamId === teamId) {
      return buildRoute(binding, "binding.team");
    }
    
    // 2.6 Account 匹配
    if (binding.match.accountId && binding.match.accountId !== "*") {
      if (binding.match.accountId === accountId) {
        return buildRoute(binding, "binding.account");
      }
    }
    
    // 2.7 Channel 匹配（通配符）
    if (binding.match.channel && binding.match.accountId === "*") {
      if (binding.match.channel === channel) {
        return buildRoute(binding, "binding.channel");
      }
    }
  }
  
  // 3. 回退到默认 Agent
  return buildDefaultRoute(cfg, input);
}
```

### 匹配优先级详解

```
优先级 1: binding.peer (精确匹配)
  └─ 例如：特定群组 ID、特定用户 ID

优先级 2: binding.peer.parent (线程继承)
  └─ 例如：Discord 线程继承父频道的 binding

优先级 3: binding.guild+roles (Discord 服务器 + 角色)
  └─ 例如：仅管理员角色的消息路由到 admin-bot

优先级 4: binding.guild (Discord 服务器)
  └─ 例如：整个服务器的消息路由到特定 Agent

优先级 5: binding.team (Slack 团队)
  └─ 例如：特定 Slack 工作空间的消息

优先级 6: binding.account (渠道账号)
  └─ 例如：WhatsApp 账号 A 的消息

优先级 7: binding.channel (渠道通配符)
  └─ 例如：所有 Telegram 消息

优先级 8: default agent (默认 Agent)
  └─ 所有未匹配的消息
```

---

## Session Key 深度解析

### Session Key 的作用

Session Key 是 OpenClaw 中**会话隔离和上下文管理**的核心机制：

1. **上下文存储**：每个 Session Key 对应独立的对话历史
2. **并发控制**：同一 Session Key 的消息串行处理
3. **路由回写**：`lastRoute` 记录最后使用的路由

### Session Key 构建算法

```typescript
// src/routing/session-key.ts 核心逻辑

export function buildAgentPeerSessionKey(params: {
  agentId: string;
  mainKey: string;
  channel: string;
  accountId?: string | null;
  peerKind: "direct" | "group" | "channel";
  peerId?: string | null;
  dmScope?: "main" | "per-peer" | "per-channel-peer" | "per-account-channel-peer";
  identityLinks?: Record<string, string[]>;
}): string {
  const { agentId, mainKey, channel, accountId, peerKind, peerId, dmScope } = params;
  
  // 1. DM 折叠逻辑
  if (peerKind === "direct") {
    const scope = dmScope ?? "main";
    
    switch (scope) {
      case "main":
        // 所有 DM 共享 main 会话
        return `agent:${agentId}:${mainKey}`;
      
      case "per-peer":
        // 每个对等方独立
        return `agent:${agentId}:${channel}:direct:${peerId}`;
      
      case "per-channel-peer":
        // 每个渠道 + 对等方组合独立
        return `agent:${agentId}:${channel}:direct:${peerId}`;
      
      case "per-account-channel-peer":
        // 每个账号 + 渠道 + 对等方组合独立
        return `agent:${agentId}:${channel}:${accountId}:direct:${peerId}`;
    }
  }
  
  // 2. 群组消息
  if (peerKind === "group") {
    return `agent:${agentId}:${channel}:group:${peerId}`;
  }
  
  // 3. 频道消息
  if (peerKind === "channel") {
    return `agent:${agentId}:${channel}:channel:${peerId}`;
  }
  
  // 4. 默认
  return `agent:${agentId}:${channel}:${peerId}`;
}
```

### Session Key 示例对照表

| 场景 | 配置 | Session Key |
|------|------|-------------|
| DM (默认) | `dmScope: "main"` | `agent:main:main` |
| DM (隔离) | `dmScope: "per-peer"` | `agent:main:telegram:direct:123456` |
| WhatsApp 群组 | - | `agent:main:whatsapp:group:120363xxx@g.us` |
| Discord 频道 | - | `agent:main:discord:channel:789012` |
| Discord 线程 | - | `agent:main:discord:channel:789012:thread:345678` |
| Telegram 话题 | - | `agent:main:telegram:group:-100123:topic:42` |
| Slack 线程 | - | `agent:main:slack:channel:C123:thread:T456` |

### dmScope 配置影响

```json5
// 配置示例
{
  "session": {
    "dmScope": "per-channel-peer"  // 改变 DM 会话隔离级别
  }
}
```

| dmScope | 适用场景 | 优点 | 缺点 |
|---------|----------|------|------|
| `main` | 个人使用，单一用户 | 上下文集中，节省资源 | 多用户会共享上下文 |
| `per-peer` | 多用户 DM | 用户隔离 | 会话数量增加 |
| `per-channel-peer` | 多渠道多用户 | 完全隔离 | 会话数量最多 |
| `per-account-channel-peer` | 多账号运营 | 账号级别隔离 | 最复杂 |

---

## Binding 匹配算法

### 匹配流程详解

```typescript
// 简化的匹配评估流程
function evaluateBinding(binding, input): BindingMatchResult {
  const match = binding.match;
  const scores = {
    peer: 0,
    guild: 0,
    team: 0,
    account: 0,
    channel: 0
  };
  
  // 1. Channel 必须匹配
  if (match.channel && match.channel !== input.channel) {
    return { matched: false, reason: "channel_mismatch" };
  }
  scores.channel = 1;
  
  // 2. Account 匹配（如果指定）
  if (match.accountId && match.accountId !== "*") {
    if (match.accountId !== input.accountId) {
      return { matched: false, reason: "account_mismatch" };
    }
    scores.account = 1;
  }
  
  // 3. Peer 匹配（如果指定）
  if (match.peer && input.peer) {
    if (match.peer.id !== input.peer.id || 
        match.peer.kind !== input.peer.kind) {
      // Peer 不匹配，但可能通过其他方式匹配
    } else {
      scores.peer = 1;
    }
  }
  
  // 4. Guild 匹配（Discord）
  if (match.guildId && input.guildId) {
    if (match.guildId === input.guildId) {
      scores.guild = 1;
      // 检查角色
      if (match.roles && input.memberRoleIds) {
        const hasRole = input.memberRoleIds.some(r => 
          match.roles!.includes(r)
        );
        if (hasRole) {
          scores.guild = 2; // 角色匹配优先级更高
        }
      }
    }
  }
  
  // 5. Team 匹配（Slack）
  if (match.teamId && input.teamId) {
    if (match.teamId === input.teamId) {
      scores.team = 1;
    }
  }
  
  // 计算匹配分数
  const totalScore = Object.values(scores).reduce((a, b) => a + b, 0);
  
  return {
    matched: totalScore > 0,
    score: totalScore,
    matchedBy: determineMatchType(scores)
  };
}
```

### 匹配冲突解决

当多个 binding 匹配同一消息时：

```
规则 1: 具体匹配优先于通配符
  - peer.id 匹配 > accountId 匹配 > channel 匹配

规则 2: 多字段匹配优先于单字段
  - guildId + roles > guildId  alone

规则 3: 配置顺序决定优先级（相同分数时）
  - bindings 数组中靠前的优先
```

### 匹配调试示例

```json5
// 配置
{
  "bindings": [
    {
      "match": { "channel": "discord", "guildId": "G123" },
      "agentId": "server-bot"
    },
    {
      "match": { 
        "channel": "discord", 
        "guildId": "G123",
        "roles": ["admin"]
      },
      "agentId": "admin-bot"
    },
    {
      "match": { "channel": "discord", "accountId": "*" },
      "agentId": "main"
    }
  ]
}

// 消息：Discord 服务器 G123，用户有 admin 角色
// 匹配结果：admin-bot (guild + roles 匹配)

// 消息：Discord 服务器 G123，用户无特殊角色
// 匹配结果：server-bot (guild 匹配)

// 消息：Discord 其他服务器
// 匹配结果：main (channel 通配符匹配)
```

---

## 高级配置示例

### 示例 1: 多租户客服系统

```json5
{
  "agents": {
    "list": [
      {
        "id": "support-cn",
        "name": "中文客服",
        "workspace": "~/.openclaw/workspace/support-cn",
        "model": { "primary": "dashscope/qwen3.5-plus" }
      },
      {
        "id": "support-en",
        "name": "English Support",
        "workspace": "~/.openclaw/workspace/support-en",
        "model": { "primary": "anthropic/claude-3-5-sonnet" }
      },
      {
        "id": "support-vip",
        "name": "VIP Support",
        "workspace": "~/.openclaw/workspace/support-vip",
        "model": { "primary": "anthropic/claude-3-5-sonnet" }
      }
    ]
  },
  "bindings": [
    {
      "match": {
        "channel": "whatsapp",
        "peer": { "kind": "group", "id": "VIP_GROUP_ID" }
      },
      "agentId": "support-vip"
    },
    {
      "match": {
        "channel": "telegram",
        "peer": { "kind": "direct", "id": "CN_USER_ID" }
      },
      "agentId": "support-cn"
    },
    {
      "match": {
        "channel": "telegram",
        "peer": { "kind": "direct", "id": "EN_USER_ID" }
      },
      "agentId": "support-en"
    },
    {
      "match": { "channel": "whatsapp", "accountId": "*" },
      "agentId": "support-cn"
    }
  ],
  "session": {
    "dmScope": "per-peer"
  }
}
```

### 示例 2: Discord 多服务器管理

```json5
{
  "agents": {
    "list": [
      {
        "id": "mod-bot",
        "name": "Moderation Bot",
        "sandbox": { "mode": "all", "scope": "agent" },
        "tools": {
          "allow": ["read", "discord"],
          "deny": ["exec", "write", "browser"]
        }
      },
      {
        "id": "welcome-bot",
        "name": "Welcome Bot",
        "tools": {
          "allow": ["read", "write", "discord"]
        }
      },
      {
        "id": "analytics-bot",
        "name": "Analytics Bot",
        "tools": {
          "allow": ["read", "write", "exec"]
        }
      }
    ]
  },
  "bindings": [
    {
      "match": {
        "channel": "discord",
        "guildId": "SERVER_1",
        "roles": ["admin", "mod"]
      },
      "agentId": "mod-bot"
    },
    {
      "match": {
        "channel": "discord",
        "guildId": "SERVER_1"
      },
      "agentId": "welcome-bot"
    },
    {
      "match": {
        "channel": "discord",
        "guildId": "SERVER_2"
      },
      "agentId": "analytics-bot"
    }
  ]
}
```

### 示例 3: 家庭 + 个人隔离

```json5
{
  "agents": {
    "defaults": {
      "sandbox": {
        "mode": "non-main",
        "scope": "agent"
      }
    },
    "list": [
      {
        "id": "personal",
        "name": "Personal Assistant",
        "default": true,
        "workspace": "~/.openclaw/workspace",
        "sandbox": { "mode": "off" }
      },
      {
        "id": "family",
        "name": "Family Bot",
        "workspace": "~/.openclaw/workspace-family",
        "sandbox": { "mode": "all" },
        "tools": {
          "allow": ["read", "web_search", "weather"],
          "deny": ["exec", "write", "edit", "browser", "process"]
        },
        "model": {
          "primary": "dashscope/qwen3.5-plus"
        }
      }
    ]
  },
  "bindings": [
    {
      "match": {
        "channel": "whatsapp",
        "peer": { "kind": "group", "id": "FAMILY_GROUP" }
      },
      "agentId": "family"
    },
    {
      "match": {
        "channel": "qqbot",
        "peer": { "kind": "direct", "id": "FAMILY_MEMBER_1" }
      },
      "agentId": "family"
    },
    {
      "match": {
        "channel": "qqbot",
        "peer": { "kind": "direct", "id": "FAMILY_MEMBER_2" }
      },
      "agentId": "family"
    }
  ],
  "channels": {
    "whatsapp": {
      "enabled": true,
      "allowFrom": ["FAMILY_GROUP", "PERSONAL_NUMBER"]
    },
    "qqbot": {
      "enabled": true,
      "allowFrom": ["PERSONAL_ID", "FAMILY_MEMBER_1", "FAMILY_MEMBER_2"]
    }
  }
}
```

### 示例 4: 广播组配置

```json5
{
  "agents": {
    "list": [
      {
        "id": "answer-bot",
        "name": "Answer Bot",
        "workspace": "~/.openclaw/workspace-answer"
      },
      {
        "id": "logger-bot",
        "name": "Logger Bot",
        "workspace": "~/.openclaw/workspace-logger",
        "tools": {
          "allow": ["read", "write"],
          "deny": ["discord", "telegram", "whatsapp"]
        }
      }
    ]
  },
  "bindings": [
    {
      "match": {
        "channel": "whatsapp",
        "peer": { "kind": "group", "id": "GROUP_ID" }
      },
      "agentId": "answer-bot"
    }
  ],
  "broadcast": {
    "strategy": "parallel",
    "GROUP_ID": ["answer-bot", "logger-bot"]
  }
}
```

---

## 性能优化

### 1. 缓存机制

`resolve-route.ts` 使用 WeakMap 缓存 Agent 查找结果：

```typescript
const agentLookupCacheByCfg = new WeakMap<OpenClawConfig, AgentLookupCache>();

function resolveAgentLookupCache(cfg: OpenClawConfig): AgentLookupCache {
  const existing = agentLookupCacheByCfg.get(cfg);
  if (existing && existing.agentsRef === cfg.agents) {
    return existing; // 缓存命中
  }
  
  // 缓存未命中，重新构建
  const byNormalizedId = new Map<string, string>();
  for (const agent of listAgents(cfg)) {
    byNormalizedId.set(normalizeAgentId(agent.id), agent.id);
  }
  
  const cache = {
    agentsRef: cfg.agents,
    byNormalizedId,
    fallbackDefaultAgentId: resolveDefaultAgentId(cfg)
  };
  
  agentLookupCacheByCfg.set(cfg, cache);
  return cache;
}
```

**优化效果**：
- 避免每次路由都重新解析 Agent 列表
- WeakMap 自动清理，防止内存泄漏

### 2. Binding 预计算

启动时预计算 normalized bindings：

```typescript
type EvaluatedBinding = {
  binding: AgentRouteBinding;
  match: NormalizedBindingMatch;
  order: number;
};

const evaluatedBindingsCache = new Map<string, EvaluatedBinding[]>();

function precomputeBindings(cfg: OpenClawConfig): void {
  for (const binding of listBindings(cfg)) {
    const channel = binding.match.channel;
    if (!channel) continue;
    
    const evaluated = {
      binding,
      match: normalizeBindingMatch(binding.match),
      order: bindings.length
    };
    
    if (!evaluatedBindingsCache.has(channel)) {
      evaluatedBindingsCache.set(channel, []);
    }
    evaluatedBindingsCache.get(channel)!.push(evaluated);
  }
}
```

### 3. Session Key 复用

避免重复构建相同的 Session Key：

```typescript
const sessionKeyCache = new Map<string, string>();

function getCachedSessionKey(key: string, builder: () => string): string {
  const cached = sessionKeyCache.get(key);
  if (cached) return cached;
  
  const computed = builder();
  sessionKeyCache.set(key, computed);
  return computed;
}
```

### 4. 并发控制

每个 Session Key 独立并发队列：

```typescript
// 每个会话最多 4 个并发请求
const sessionConcurrency = new Map<string, number>();

async function withSessionConcurrency<T>(
  sessionKey: string,
  fn: () => Promise<T>
): Promise<T> {
  const current = sessionConcurrency.get(sessionKey) ?? 0;
  if (current >= 4) {
    await waitForSlot(sessionKey);
  }
  
  sessionConcurrency.set(sessionKey, current + 1);
  try {
    return await fn();
  } finally {
    sessionConcurrency.set(sessionKey, current);
  }
}
```

---

## 安全考虑

### 1. Agent 隔离

每个 Agent 独立的认证存储：

```
~/.openclaw/
├── agents/
│   ├── main/
│   │   └── agent/
│   │       └── auth-profiles.json  # main 的认证
│   ├── support/
│   │   └── agent/
│   │       └── auth-profiles.json  # support 的认证
│   └── family/
│       └── agent/
│           └── auth-profiles.json  # family 的认证
```

**安全要点**：
- ⚠️ **不要共享** `agentDir` 跨多个 Agent
- ⚠️ **不要复制** `auth-profiles.json` 除非明确需要
- ✅ 每个 Agent 独立管理自己的认证

### 2. 工具权限控制

```json5
{
  "agents": {
    "list": [
      {
        "id": "restricted",
        "tools": {
          "profile": "messaging",  // 基础消息配置
          "allow": ["read", "web_search"],  // 白名单
          "deny": ["exec", "write", "browser", "process"]  // 黑名单
        }
      }
    ]
  }
}
```

**工具权限优先级**：
```
deny > allow > profile default
```

### 3. 沙箱隔离

```json5
{
  "agents": {
    "list": [
      {
        "id": "untrusted",
        "sandbox": {
          "mode": "all",  // 所有命令沙箱化
          "scope": "agent"  // 独立容器
        }
      }
    ]
  }
}
```

**沙箱模式对比**：

| Mode | 安全级别 | 性能 | 适用场景 |
|------|----------|------|----------|
| `off` | 无隔离 | 最佳 | 可信 Agent |
| `non-main` | 中等 | 良好 | 大部分场景 |
| `all` | 高 | 中等 | 不受信 Agent |

### 4. Allowlist 保护

```json5
{
  "channels": {
    "qqbot": {
      "enabled": true,
      "allowFrom": ["916B305E4F4944B5FD434D62EBC439CF"]
    }
  }
}
```

**Allowlist 匹配规则**：
- 精确匹配用户 ID
- 支持通配符 `*`
- 支持群组 ID

---

## 调试技巧

### 1. 启用详细日志

```bash
# 查看所有路由日志
DEBUG=openclaw:routing* openclaw gateway start

# 查看特定 Agent
DEBUG=openclaw:agents:support* openclaw gateway start

# 查看 Session Key 构建
DEBUG=openclaw:session-key* openclaw gateway start
```

### 2. 检查当前路由

```bash
# 查看会话状态
openclaw sessions list

# 查看特定会话详情
openclaw sessions show agent:main:main
```

### 3. 测试 Binding 匹配

```bash
# 模拟路由测试（伪代码）
openclaw routing test \
  --channel whatsapp \
  --peer-id 120363xxx@g.us \
  --peer-kind group
```

### 4. 沙箱调试

```bash
# 解释沙箱拒绝原因
openclaw sandbox explain exec

# 查看沙箱状态
openclaw sandbox status
```

---

## 参考资料

- [resolve-route.ts 源码](https://github.com/openclaw/openclaw/blob/main/src/routing/resolve-route.ts)
- [session-key.ts 源码](https://github.com/openclaw/openclaw/blob/main/src/routing/session-key.ts)
- [Channel Routing 文档](/channels/channel-routing)
- [Sandboxing 文档](/gateway/sandboxing)

---

*文档版本：1.0*
*更新时间：2026-03-22*

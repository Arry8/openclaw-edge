# OpenClaw 零基础入门指南

> 本文档专为初学者设计，无需编程基础，用生活化的比喻帮你理解 OpenClaw 的核心概念。

## 目录

1. [OpenClaw 是什么？](#openclaw-是什么)
2. [3 个核心概念](#3-个核心概念)
3. [Multi-Agent Routing 入门](#multi-agent-routing-入门)
4. [Channels 入门](#channels-入门)
5. [10 分钟快速配置](#10-分钟快速配置)
6. [常见问题解答](#常见问题解答)

---

## OpenClaw 是什么？

### 简单说

**OpenClaw = 你的私人 AI 管家**

它可以：
- 📱 通过微信、QQ、Telegram 等和你聊天
- 🤖 用 AI 帮你回答问题、完成任务
- 🔄 24 小时在线，随时待命

### 形象比喻

```
┌─────────────────────────────────────────────────────────┐
│                    你的 AI 管家 (OpenClaw)                │
│                                                          │
│   ┌──────────┐                                          │
│   │  前台    │ ← 接待员，决定谁来处理你的请求            │
│   │ (Routing)│                                          │
│   └────┬─────┘                                          │
│        │                                                 │
│   ┌────┴─────┐  ┌───────┐  ┌─────────┐                 │
│   │ 管家小白 │  │ 客服  │  │ 家庭助手│  ← 不同员工      │
│   │ (Agent)  │  │(Agent)│  │ (Agent) │     (多个 Agent) │
│   └────┬─────┘  └───┬───┘  └────┬────┘                 │
│        │            │            │                       │
│   ┌────┴────────────┴────────────┴───────┐              │
│   │          电话线 (Channels)            │              │
│   └────┬────────────┬────────────┬───────┘              │
│        │            │            │                       │
│      QQ          微信        Telegram   ← 你用的聊天软件  │
└─────────────────────────────────────────────────────────┘
```

---

## 3 个核心概念

### 1️⃣ Channel（渠道）= 电话线

**Channel 就是连接你和 AI 的"电话线"**。

```
你用微信发消息
    │
    ▼
微信 "电话线" (Channel)
    │
    ▼
OpenClaw 收到消息
```

**常见的 Channel**：
| Channel | 对应软件 | 特点 |
|---------|----------|------|
| `qqbot` | QQ | 国内常用 |
| `wechat` | 微信 | 最普及 |
| `telegram` | Telegram | 国际常用 |
| `discord` | Discord | 游戏/社区 |

**简单理解**：
> Channel = 你用什么软件和 AI 聊天

---

### 2️⃣ Agent（智能体）= 员工

**Agent 是实际处理你请求的"员工"**。

```
你发消息问问题
    │
    ▼
AI 员工 (Agent) 思考并回复
```

**为什么需要多个 Agent？**

| 场景 | 需要的 Agent |
|------|-------------|
| 你个人的问题 | 私人助理 Agent |
| 客户咨询 | 客服 Agent |
| 家人使用 | 家庭助手 Agent（权限受限） |

**简单理解**：
> Agent = 处理你请求的 AI 员工

---

### 3️⃣ Routing（路由）= 前台接待员

**Routing 决定你的消息由哪个 Agent 处理**。

```
你发消息
    │
    ▼
前台接待员 (Routing)
    │
    ├─ 是你？→ 转给私人助理
    ├─ 是客户？→ 转给客服
    └─ 是家人？→ 转给家庭助手
```

**简单理解**：
> Routing = 决定谁来处理你的消息

---

## Multi-Agent Routing 入门

### 什么是 Multi-Agent Routing？

**Multi-Agent = 多个 AI 员工**
**Routing = 分配工作**

合起来就是：**如何让多个 AI 员工各司其职**

### 生活化例子

想象你开了一家公司：

```
公司架构

              你 (老板)
                │
          ┌─────┴─────┐
          │           │
    ┌─────┴─────┐ ┌───┴────┐
    │  前台接待  │ │ 门卫   │
    │ (Routing) │ │(安全)  │
    └─────┬─────┘ └────────┘
          │
    ┌─────┴─────────────────┐
    │           │           │
┌───┴───┐  ┌───┴───┐  ┌───┴───┐
│私人助理│  │ 客服  │  │家庭助手│
│(Agent)│  │(Agent)│  │(Agent)│
└───────┘  └───────┘  └───────┘
```

**工作流程**：

```
1. 有人打电话进来
         │
         ▼
2. 前台接待接听："您好，请问您是？"
         │
         ├─ "我是老板" → 转接私人助理
         ├─ "我是客户" → 转接客服
         └─ "我是老板家人" → 转接家庭助手
         │
         ▼
3. 对应的员工处理问题
```

### 配置示例（超简单版）

```json5
// 配置文件：~/.openclaw/openclaw.json

{
  // 1. 定义 3 个员工 (Agent)
  "agents": {
    "list": [
      {
        "id": "personal",      // 私人助理
        "default": true,       // 默认员工
        "name": "私人助理"
      },
      {
        "id": "support",       // 客服
        "name": "客服"
      },
      {
        "id": "family",        // 家庭助手
        "name": "家庭助手"
      }
    ]
  },
  
  // 2. 告诉前台怎么分配工作 (Routing)
  "bindings": [
    {
      // 客服专用 QQ 群
      "match": {
        "channel": "qqbot",
        "peer": { "kind": "group", "id": "客服群 ID" }
      },
      "agentId": "support"  // 转给客服
    },
    {
      // 家人的 QQ
      "match": {
        "channel": "qqbot",
        "peer": { "kind": "direct", "id": "家人 QQ 号" }
      },
      "agentId": "family"  // 转给家庭助手
    }
    // 其他消息默认给私人助理
  ]
}
```

### 一句话总结

> **Multi-Agent Routing = 定义"谁的消息由谁处理"**

---

## Channels 入门

### 什么是 Channels？

**Channels = 各种聊天软件的连接器**

```
┌────────────────────────────────────────┐
│           OpenClaw (AI 管家)            │
│                                        │
│  ┌──────┐  ┌──────┐  ┌──────┐        │
│  │ QQ   │  │ 微信 │  │ TG   │  ← 连接器│
│  │Connector│Connector│Connector│      │
│  └──────┘  └──────┘  └──────┘        │
└────────────────────────────────────────┘
       │          │          │
       ▼          ▼          ▼
     QQ        微信       Telegram
```

### 为什么需要 Channels？

因为不同的聊天软件用**不同的语言**：

```
微信说："这是一条微信消息"
       │
       ▼
   翻译器 (Channel Plugin)
       │
       ▼
OpenClaw 听："这是一条标准消息"
```

**Channel 的作用**：
1. 📥 **接收**：把微信/QQ/TG 的消息翻译成 OpenClaw 能懂的语言
2. 📤 **发送**：把 OpenClaw 的回复翻译回微信/QQ/TG 的语言

### 常见 Channel 对比

| Channel | 难度 | 需要 | 适合 |
|---------|------|------|------|
| **QQ Bot** | ⭐ 简单 | QQ 号 + 密钥 | 国内用户 |
| **Telegram** | ⭐⭐ 中等 | Bot Token | 国际用户 |
| **Discord** | ⭐⭐ 中等 | Bot Token | 游戏/社区 |
| **WhatsApp** | ⭐⭐⭐ 较难 | 扫码配对 | 海外业务 |

### 配置示例（超简单版）

```json5
// 配置文件：~/.openclaw/openclaw.json

{
  // 启用 QQ Channel
  "channels": {
    "qqbot": {
      "enabled": true,           // 开启
      "appId": "你的 QQ 应用 ID",    // 从 QQ 开放平台获取
      "clientSecret": "你的密钥"    // 从 QQ 开放平台获取
    },
    
    // 启用 Telegram Channel
    "telegram": {
      "enabled": true,           // 开启
      "defaultAccount": "default",
      "accounts": {
        "default": {
          "botToken": "你的 Bot Token"  // 从 @BotFather 获取
        }
      }
    }
  }
}
```

### 一句话总结

> **Channels = 让 AI 能用各种聊天软件和你对话**

---

## 10 分钟快速配置

### 场景：让 AI 通过 QQ 和你聊天

#### 步骤 1: 准备 QQ Bot 账号（5 分钟）

1. 访问 [QQ 开放平台](https://q.qq.com/)
2. 创建一个机器人应用
3. 获取 `appId` 和 `clientSecret`

#### 步骤 2: 修改配置文件（2 分钟）

```bash
# 打开配置文件
nano ~/.openclaw/openclaw.json
```

添加以下内容：

```json5
{
  "channels": {
    "qqbot": {
      "enabled": true,
      "appId": "你的 appId",
      "clientSecret": "你的 clientSecret"
    }
  },
  "agents": {
    "defaults": {
      "model": {
        "primary": "dashscope/qwen3.5-plus"
      }
    }
  }
}
```

#### 步骤 3: 重启 OpenClaw（1 分钟）

```bash
openclaw gateway restart
```

#### 步骤 4: 测试（2 分钟）

1. 用另一个 QQ 号给你的机器人发消息
2. 等待 AI 回复

**完成！** 🎉

---

## 常见问题解答

### ❓ Q1: 我只有一个人在用，需要多个 Agent 吗？

**答**：不需要！

单个 Agent 就够了：

```json5
{
  "agents": {
    "list": [
      {
        "id": "main",
        "default": true,
        "name": "我的助手"
      }
    ]
  }
}
```

**什么时候需要多个 Agent？**
- 公司有客服需求
- 家人也要使用
- 想隔离工作和个人消息

---

### ❓ Q2: Channel 和 Agent 是什么关系？

**答**：用餐厅比喻：

```
餐厅 (OpenClaw)
│
├─ 入口 (Channel) = 客人从哪个门进来
│   ├─ 正门 (QQ)
│   ├─ 侧门 (微信)
│   └─ 后门 (Telegram)
│
└─ 服务员 (Agent) = 谁为客人服务
    ├─ 小王 (私人助理)
    ├─ 小李 (客服)
    └─ 小张 (家庭助手)
```

**关系**：
- 客人从任何门进来（Channel）
- 前台安排服务员接待（Routing）
- 服务员为客人服务（Agent）

---

### ❓ Q3: 配置错了怎么办？

**答**：3 步恢复：

```bash
# 1. 查看配置是否有效
openclaw config check

# 2. 查看日志找错误
openclaw logs --tail 100

# 3. 恢复备份（如果有）
cp ~/.openclaw/openclaw.json.bak ~/.openclaw/openclaw.json
openclaw gateway restart
```

---

### ❓ Q4: 怎么知道消息被哪个 Agent 处理了？

**答**：查看会话状态：

```bash
# 列出所有会话
openclaw sessions list

# 查看会话详情
openclaw sessions show agent:main:main
```

输出示例：
```
Session: agent:main:qqbot:direct:916b305e...
Agent: main (Personal Assistant)
Channel: qqbot
Last Activity: 2 minutes ago
```

---

### ❓ Q5: 家人用会不会看到我的聊天记录？

**答**：默认会！要隔离需要配置：

```json5
{
  "agents": {
    "list": [
      { "id": "personal", "default": true },
      { "id": "family" }
    ]
  },
  "bindings": [
    {
      "match": { "channel": "qqbot", "peer": { "id": "家人 QQ" } },
      "agentId": "family"
    }
  ],
  "session": {
    "dmScope": "per-peer"  // 每个用户独立会话
  }
}
```

这样家人的消息由 `family` Agent 处理，**完全隔离**。

---

### ❓ Q6: 一个 Channel 可以对应多个 Agent 吗？

**答**：可以！

例如：
- 公司 QQ 群 → 客服 Agent
- 个人 QQ → 私人助理 Agent

配置：

```json5
{
  "bindings": [
    {
      "match": { "channel": "qqbot", "peer": { "kind": "group", "id": "公司群" } },
      "agentId": "support"
    },
    {
      "match": { "channel": "qqbot", "peer": { "kind": "direct", "id": "我的 QQ" } },
      "agentId": "personal"
    }
  ]
}
```

---

### ❓ Q7: 最简单的配置是什么？

**答**：下面这样就能用：

```json5
{
  "channels": {
    "qqbot": {
      "enabled": true,
      "appId": "xxx",
      "clientSecret": "xxx"
    }
  },
  "agents": {
    "defaults": {
      "model": {
        "primary": "dashscope/qwen3.5-plus"
      }
    }
  }
}
```

**没有 bindings？** → 所有消息都给默认 Agent（main）

---

## 学习路径建议

### 第 1 天：跑起来

1. 配置一个 Channel（推荐 QQ 或 Telegram）
2. 使用默认 Agent
3. 测试能正常对话

### 第 2 天：理解概念

1. 阅读本文档
2. 理解 Channel、Agent、Routing 的关系
3. 画出你理解的架构图

### 第 3 天：尝试多 Agent

1. 创建第二个 Agent
2. 配置简单的 Routing 规则
3. 测试不同消息由不同 Agent 处理

### 第 4-7 天：深入学习

1. 阅读进阶文档
2. 尝试沙箱配置
3. 学习安全设置

---

## 术语对照表

| 英文 | 中文 | 比喻 |
|------|------|------|
| Channel | 渠道 | 电话线/门 |
| Agent | 智能体 | 员工/服务员 |
| Routing | 路由 | 前台接待员 |
| Binding | 绑定 | 分配规则 |
| Session | 会话 | 一次对话 |
| Peer | 对等方 | 聊天对象 |
| Account | 账号 | 登录账号 |
| Workspace | 工作空间 | 员工办公桌 |
| Sandbox | 沙箱 | 隔离房间 |

---

## 下一步

完成入门后，可以阅读：

1. **进阶文档**：
   - `multi-agent-routing.md` - 深入理解路由
   - `channels-architecture.md` - 深入理解 Channel

2. **高级文档**：
   - `multi-agent-routing-advanced.md` - 源码级解析
   - `channels-advanced.md` - 插件开发

3. **官方文档**：
   - [OpenClaw 官方文档](https://docs.openclaw.ai)
   - [GitHub 仓库](https://github.com/openclaw/openclaw)

---

*文档版本：1.0*
*适合人群：零基础初学者*
*更新时间：2026-03-22*

---

## 附录：配置模板

### 模板 1: 单人使用（最简单）

```json5
{
  "channels": {
    "qqbot": {
      "enabled": true,
      "appId": "你的 appId",
      "clientSecret": "你的 clientSecret"
    }
  },
  "agents": {
    "defaults": {
      "model": {
        "primary": "dashscope/qwen3.5-plus"
      }
    }
  }
}
```

### 模板 2: 个人 + 家人隔离

```json5
{
  "channels": {
    "qqbot": {
      "enabled": true,
      "appId": "你的 appId",
      "clientSecret": "你的 clientSecret",
      "allowFrom": ["你的 QQ", "家人 QQ1", "家人 QQ2"]
    }
  },
  "agents": {
    "list": [
      {
        "id": "personal",
        "default": true,
        "name": "私人助理"
      },
      {
        "id": "family",
        "name": "家庭助手",
        "tools": {
          "allow": ["read", "web_search"],
          "deny": ["exec", "write", "browser"]
        }
      }
    ]
  },
  "bindings": [
    {
      "match": {
        "channel": "qqbot",
        "peer": { "kind": "direct", "id": "家人 QQ1" }
      },
      "agentId": "family"
    },
    {
      "match": {
        "channel": "qqbot",
        "peer": { "kind": "direct", "id": "家人 QQ2" }
      },
      "agentId": "family"
    }
  ],
  "session": {
    "dmScope": "per-peer"
  }
}
```

### 模板 3: 工作 + 生活分离

```json5
{
  "channels": {
    "qqbot": {
      "enabled": true,
      "appId": "你的 appId",
      "clientSecret": "你的 clientSecret"
    },
    "telegram": {
      "enabled": true,
      "defaultAccount": "default",
      "accounts": {
        "default": {
          "botToken": "你的 Bot Token"
        }
      }
    }
  },
  "agents": {
    "list": [
      {
        "id": "work",
        "name": "工作助手",
        "workspace": "~/.openclaw/workspace-work"
      },
      {
        "id": "personal",
        "name": "生活助手",
        "workspace": "~/.openclaw/workspace-personal",
        "default": true
      }
    ]
  },
  "bindings": [
    {
      "match": { "channel": "qqbot" },
      "agentId": "work"
    },
    {
      "match": { "channel": "telegram" },
      "agentId": "personal"
    }
  ]
}
```

---

**祝你使用愉快！** 🎉

如有问题，欢迎查阅进阶文档或访问官方社区。

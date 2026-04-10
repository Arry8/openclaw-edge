# OpenClaw 调用链分析

> 本文档深入分析 OpenClaw 的关键代码路径和调用链

---

## 📋 目录

1. [消息接收完整调用链](#1-消息接收完整调用链)
2. [Agent 执行调用链](#2-agent 执行调用链)
3. [工具执行调用链](#3-工具执行调用链)
4. [WebSocket 事件流调用链](#4-websocket 事件流调用链)
5. [会话管理调用链](#5-会话管理调用链)
6. [关键代码位置索引](#6-关键代码位置索引)

---

## 1. 消息接收完整调用链

### 1.1 Telegram 消息接收示例

```
[外部] Telegram Server
    │
    │ (HTTP Update / Long Polling)
    ▼
┌─────────────────────────────────────────────────────────────┐
│ extensions/telegram/src/bot.ts                              │
│ ─────────────────────────────────────────────────────────── │
│ grammY.bot.on('message', async (ctx) => {                   │
│   await handleTelegramMessage(ctx);                         │
│ })                                                          │
└─────────────────────────────────────────────────────────────┘
    │
    │ ctx.message
    ▼
┌─────────────────────────────────────────────────────────────┐
│ extensions/telegram/src/handlers/message.ts                 │
│ ─────────────────────────────────────────────────────────── │
│ export async function handleTelegramMessage(ctx) {          │
│   // 1. 标准化消息格式                                       │
│   const normalized = normalizeTelegramMessage(ctx.message); │
│                                                              │
│   // 2. 检查配对/白名单                                      │
│   const authResult = await checkAuthorization(normalized);  │
│   if (!authResult.allowed) {                                │
│     sendPairingCode(ctx);                                   │
│     return;                                                 │
│   }                                                         │
│                                                              │
│   // 3. 确定会话键                                           │
│   const sessionKey = resolveSessionKey({                    │
│     agentId: 'main',                                        │
│     channel: 'telegram',                                    │
│     peerId: ctx.from.id,                                    │
│     dmScope: config.session.dmScope                         │
│   });                                                       │
│                                                              │
│   // 4. 推送到 Gateway                                       │
│   await gateway.publish('chat', {                           │
│     sessionKey,                                             │
│     message: normalized,                                    │
│     channel: 'telegram'                                     │
│   });                                                       │
│ }                                                           │
└─────────────────────────────────────────────────────────────┘
    │
    │ Gateway WebSocket Event
    ▼
┌─────────────────────────────────────────────────────────────┐
│ src/gateway/chat-receive.ts                                 │
│ ─────────────────────────────────────────────────────────── │
│ export async function handleChatReceive(gateway, event) {   │
│   const { sessionKey, message, channel } = event.payload;   │
│                                                              │
│   // 1. 加载/创建会话                                        │
│   const session = await sessions.getOrCreate(sessionKey);   │
│                                                              │
│   // 2. 追加消息到会话记录                                   │
│   await sessions.append(sessionKey, {                       │
│     role: 'user',                                           │
│     content: message.text,                                  │
│     timestamp: Date.now(),                                  │
│     metadata: { channel, peerId: message.from }             │
│   });                                                       │
│                                                              │
│   // 3. 触发 Agent 处理                                      │
│   if (shouldTriggerAgent(sessionKey, message)) {            │
│     await triggerAgent(gateway, {                           │
│       sessionKey,                                           │
│       message: buildAgentPrompt(message),                   │
│       mode: 'steer' | 'followup' | 'collect'                │
│     });                                                     │
│   }                                                         │
│                                                              │
│   // 4. 推送事件到连接的客户端                               │
│   gateway.broadcast('event:chat', {                         │
│     sessionKey,                                             │
│     message: sanitizeForClient(message)                     │
│   });                                                       │
│ }                                                           │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 认证检查详细流程

```typescript
// src/gateway/auth.ts
export async function checkAuthorization(message: IncomingMessage): Promise<AuthResult> {
  const config = await loadConfig();
  
  // 1. 检查 DM 策略
  if (message.isDM) {
    if (config.channels.telegram.dmPolicy === 'pairing') {
      // 检查配对存储
      const isPaired = await pairingStore.isPaired({
        channel: 'telegram',
        peerId: message.from
      });
      
      if (!isPaired) {
        return {
          allowed: false,
          reason: 'PAIRING_REQUIRED',
          pairingCode: generatePairingCode()
        };
      }
    }
  }
  
  // 2. 检查白名单
  const allowFrom = config.channels.telegram.allowFrom;
  if (allowFrom && !allowFrom.includes('*')) {
    if (!allowFrom.includes(message.from)) {
      return {
        allowed: false,
        reason: 'NOT_IN_ALLOWLIST'
      };
    }
  }
  
  // 3. 检查群组策略
  if (message.isGroup) {
    if (config.channels.telegram.groups) {
      const groupConfig = config.channels.telegram.groups[message.chatId];
      if (!groupConfig && !config.channels.telegram.groups['*']) {
        return {
          allowed: false,
          reason: 'GROUP_NOT_ALLOWLISTED'
        };
      }
    }
  }
  
  return { allowed: true };
}
```

---

## 2. Agent 执行调用链

### 2.1 Agent 触发流程

```typescript
// src/gateway/agent-prompt.ts
export async function triggerAgent(gateway: Gateway, options: AgentOptions) {
  const { sessionKey, message, mode } = options;
  
  // 1. 获取会话状态
  const session = await sessions.get(sessionKey);
  if (!session) {
    throw new Error(`Session not found: ${sessionKey}`);
  }
  
  // 2. 检查是否有正在运行的 Agent
  const existingRun = agentRegistry.getActiveRun(sessionKey);
  if (existingRun) {
    if (mode === 'steer') {
      // 排队消息，注入当前运行
      await agentRegistry.queueMessage(sessionKey, message);
      return;
    } else {
      // 等待或拒绝
      await agentRegistry.queueMessage(sessionKey, message);
      return;
    }
  }
  
  // 3. 构建 Agent 上下文
  const context = await buildAgentContext({
    sessionKey,
    workspace: config.agents.defaults.workspace,
    skills: await loadSkillsForSession(sessionKey),
    tools: getAvailableTools(sessionKey),
    model: resolveModelForSession(sessionKey)
  });
  
  // 4. 启动 Agent 运行
  const runId = generateRunId();
  const agentPromise = runEmbeddedPiAgent({
    runId,
    sessionKey,
    message,
    context,
    callbacks: {
      onBlock: (block) => {
        // 流式推送块到客户端
        gateway.broadcast('event:agent', {
          runId,
          sessionKey,
          type: 'block',
          block
        });
      },
      onToolCall: async (toolCall) => {
        // 执行工具
        const result = await executeTool(toolCall, {
          sessionKey,
          runId,
          sandbox: getSandboxConfig(sessionKey)
        });
        
        // 推送工具结果
        gateway.broadcast('event:agent', {
          runId,
          sessionKey,
          type: 'tool_result',
          toolCall,
          result
        });
        
        return result;
      },
      onComplete: (result) => {
        // 运行完成
        gateway.broadcast('event:agent', {
          runId,
          sessionKey,
          type: 'complete',
          result
        });
        
        agentRegistry.clearActiveRun(sessionKey);
      },
      onError: (error) => {
        // 错误处理
        gateway.broadcast('event:agent', {
          runId,
          sessionKey,
          type: 'error',
          error: sanitizeError(error)
        });
        
        agentRegistry.clearActiveRun(sessionKey);
      }
    }
  });
  
  // 5. 注册运行
  agentRegistry.registerRun(sessionKey, runId, agentPromise);
  
  // 6. 返回运行 ID
  return { runId, status: 'accepted' };
}
```

### 2.2 Pi Agent 执行核心

```typescript
// src/agents/pi-embedded-runner.ts
export async function runEmbeddedPiAgent(options: RunOptions): Promise<RunResult> {
  const { runId, sessionKey, message, context, callbacks } = options;
  
  // 1. 加载会话历史
  const history = await sessions.getHistory(sessionKey, {
    limit: getContextWindowLimit(context.model),
    sanitize: true
  });
  
  // 2. 构建系统提示词
  const systemPrompt = await buildSystemPrompt({
    workspace: context.workspace,
    skills: context.skills,
    identity: await loadIdentity(context.workspace),
    model: context.model
  });
  
  // 3. 准备工具定义
  const tools = context.tools.map(tool => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.schema,
    execute: tool.execute
  }));
  
  // 4. 创建 Pi Agent 会话
  const agent = createPiAgent({
    model: context.model,
    systemPrompt,
    tools,
    workspace: context.workspace
  });
  
  // 5. 订阅 Agent 事件流
  const subscription = agent.subscribe({
    onTextBlock: (block) => {
      callbacks.onBlock({
        type: 'text',
        content: block.text,
        status: block.status // 'start' | 'delta' | 'end'
      });
    },
    onToolCall: async (toolCall) => {
      callbacks.onBlock({
        type: 'tool_call',
        toolCall
      });
      
      const result = await callbacks.onToolCall(toolCall);
      
      return {
        toolCallId: toolCall.id,
        result
      };
    },
    onReasoning: (reasoning) => {
      if (config.agents.defaults.reasoning) {
        callbacks.onBlock({
          type: 'reasoning',
          content: reasoning
        });
      }
    }
  });
  
  try {
    // 6. 运行 Agent
    const result = await agent.run({
      messages: [
        ...history,
        { role: 'user', content: message }
      ],
      abortSignal: createAbortSignal(runId)
    });
    
    // 7. 保存会话记录
    await sessions.append(sessionKey, {
      role: 'assistant',
      content: result.text,
      toolCalls: result.toolCalls,
      timestamp: Date.now(),
      usage: result.usage
    });
    
    callbacks.onComplete({
      text: result.text,
      toolCalls: result.toolCalls,
      usage: result.usage
    });
    
    return result;
    
  } catch (error) {
    if (error.name === 'AbortError') {
      callbacks.onComplete({
        status: 'aborted'
      });
    } else {
      callbacks.onError(error);
    }
    throw error;
  } finally {
    subscription.unsubscribe();
  }
}
```

---

## 3. 工具执行调用链

### 3.1 工具执行总览

```typescript
// src/agents/pi-tools.ts
export async function executeTool(
  toolCall: ToolCall,
  options: ToolExecutionOptions
): Promise<ToolResult> {
  const { sessionKey, runId, sandbox } = options;
  
  // 1. 工具策略检查
  const policyResult = await checkToolPolicy({
    toolName: toolCall.name,
    sessionKey,
    runId
  });
  
  if (!policyResult.allowed) {
    return {
      success: false,
      error: `Tool '${toolCall.name}' is not allowed: ${policyResult.reason}`
    };
  }
  
  // 2. 获取工具实现
  const tool = getToolImplementation(toolCall.name);
  if (!tool) {
    return {
      success: false,
      error: `Unknown tool: ${toolCall.name}`
    };
  }
  
  // 3. 检查是否需要沙箱
  const needsSandbox = shouldUseSandbox(tool.name, sessionKey);
  
  if (needsSandbox && sandbox.enabled) {
    // 在沙箱中执行
    return executeInSandbox(tool, toolCall.args, sandbox);
  } else {
    // 直接执行
    return tool.execute(toolCall.args, {
      sessionKey,
      runId,
      workspace: options.workspace
    });
  }
}
```

### 3.2 exec 工具执行 (带沙箱)

```typescript
// src/agents/bash-tools.ts
export async function executeBashCommand(
  args: ExecArgs,
  context: ToolContext
): Promise<ExecResult> {
  const { command, workdir, pty, background } = args;
  
  // 1. 命令预检查
  const preflightResult = await preflightCommand(command);
  if (!preflightResult.safe) {
    return {
      success: false,
      error: `Command blocked: ${preflightResult.reason}`,
      exitCode: -1
    };
  }
  
  // 2. 检查是否需要批准
  if (requiresApproval(command, context.sessionKey)) {
    const approval = await requestApproval({
      command,
      sessionKey: context.sessionKey,
      runId: context.runId
    });
    
    if (!approval.granted) {
      return {
        success: false,
        error: 'Command execution denied by user',
        exitCode: -1
      };
    }
  }
  
  // 3. 确定执行环境
  const execHost = resolveExecHost(context.sessionKey);
  
  if (execHost === 'docker') {
    // Docker 沙箱执行
    return executeInDocker({
      command,
      workdir: context.workspace,
      allowlist: getSandboxAllowlist(context.sessionKey)
    });
  } else {
    // 本地执行
    return executeLocally({
      command,
      workdir: workdir || context.workspace,
      pty,
      background,
      env: {
        ...process.env,
        OPENCLAW_SESSION: context.sessionKey,
        OPENCLAW_RUN_ID: context.runId
      }
    });
  }
}

// src/agents/bash-tools.exec.ts
async function executeLocally(options: ExecOptions): Promise<ExecResult> {
  const { command, workdir, pty, background, env } = options;
  
  return new Promise((resolve, reject) => {
    if (pty) {
      // PTY 执行 (交互式)
      const ptyProcess = spawnPty(command, {
        cwd: workdir,
        env,
        cols: 80,
        rows: 24
      });
      
      const output: string[] = [];
      ptyProcess.onData((data) => {
        output.push(data);
        // 流式推送输出
        streamToolOutput({
          type: 'stdout',
          data
        });
      });
      
      ptyProcess.onExit(({ exitCode }) => {
        resolve({
          success: exitCode === 0,
          stdout: output.join(''),
          stderr: '',
          exitCode
        });
      });
      
    } else {
      // 普通执行
      const child = spawn('bash', ['-c', command], {
        cwd: workdir,
        env,
        stdio: ['pipe', 'pipe', 'pipe']
      });
      
      let stdout = '';
      let stderr = '';
      
      child.stdout.on('data', (data) => {
        stdout += data.toString();
        streamToolOutput({ type: 'stdout', data: data.toString() });
      });
      
      child.stderr.on('data', (data) => {
        stderr += data.toString();
        streamToolOutput({ type: 'stderr', data: data.toString() });
      });
      
      child.on('close', (code) => {
        resolve({
          success: code === 0,
          stdout,
          stderr,
          exitCode: code
        });
      });
      
      child.on('error', (error) => {
        resolve({
          success: false,
          error: error.message,
          exitCode: -1
        });
      });
    }
  });
}
```

### 3.3 read 工具执行

```typescript
// src/agents/pi-tools.read.ts
export async function readFile(args: ReadArgs, context: ToolContext): Promise<ReadResult> {
  const { path, offset, limit } = args;
  
  // 1. 解析路径 (支持相对路径)
  const resolvedPath = resolvePath(path, {
    workspace: context.workspace,
    sessionKey: context.sessionKey
  });
  
  // 2. 安全检查 (防止路径遍历攻击)
  if (!isPathWithinWorkspace(resolvedPath, context.workspace)) {
    return {
      success: false,
      error: 'Access denied: path outside workspace'
    };
  }
  
  // 3. 检查文件是否存在
  if (!await fileExists(resolvedPath)) {
    return {
      success: false,
      error: `File not found: ${path}`
    };
  }
  
  // 4. 读取文件
  try {
    let content: string;
    
    if (isImageFile(resolvedPath)) {
      // 图片文件 → Base64
      content = await readFileAsBase64(resolvedPath);
    } else if (isLargeFile(resolvedPath)) {
      // 大文件 → 分页读取
      content = await readFileWithOffset(resolvedPath, {
        offset: offset || 0,
        limit: limit || 2000 // 默认 2000 行
      });
    } else {
      // 普通文本文件
      content = await fs.readFile(resolvedPath, 'utf-8');
    }
    
    return {
      success: true,
      content,
      path: resolvedPath,
      size: content.length
    };
    
  } catch (error) {
    return {
      success: false,
      error: `Failed to read file: ${error.message}`
    };
  }
}
```

---

## 4. WebSocket 事件流调用链

### 4.1 连接建立流程

```typescript
// src/gateway/client.ts
export async function handleWebSocketConnection(ws: WebSocket, req: IncomingMessage) {
  const client = new ClientConnection(ws, req);
  
  // 1. 等待连接帧
  const firstFrame = await waitForFirstFrame(ws, {
    timeout: 10000 // 10 秒超时
  });
  
  if (firstFrame.type !== 'req' || firstFrame.method !== 'connect') {
    ws.close(4000, 'First frame must be connect request');
    return;
  }
  
  // 2. 验证认证
  const authResult = await authenticateConnection(firstFrame.params);
  if (!authResult.success) {
    ws.close(4001, authResult.reason);
    return;
  }
  
  // 3. 注册客户端
  clientRegistry.register(client, {
    deviceId: firstFrame.params.device.id,
    platform: firstFrame.params.device.platform,
    role: firstFrame.params.role || 'client'
  });
  
  // 4. 发送连接响应
  sendResponse(ws, firstFrame.id, {
    status: 'ok',
    payload: {
      type: 'hello-ok',
      presence: getPresenceState(),
      health: getHealthStatus()
    }
  });
  
  // 5. 开始心跳
  startHeartbeat(client);
  
  // 6. 监听后续消息
  ws.on('message', async (data) => {
    try {
      const frame = JSON.parse(data.toString());
      await handleClientFrame(client, frame);
    } catch (error) {
      sendError(ws, {
        code: 'PARSE_ERROR',
        message: error.message
      });
    }
  });
  
  // 7. 监听断开
  ws.on('close', () => {
    clientRegistry.unregister(client);
    stopHeartbeat(client);
  });
}
```

### 4.2 请求处理分发

```typescript
// src/gateway/client.ts
async function handleClientFrame(client: Client, frame: Frame) {
  switch (frame.method) {
    case 'agent':
      return handleAgentRequest(client, frame);
    
    case 'send':
      return handleSendRequest(client, frame);
    
    case 'status':
      return handleStatusRequest(client, frame);
    
    case 'sessions.list':
      return handleSessionsListRequest(client, frame);
    
    case 'sessions.history':
      return handleSessionsHistoryRequest(client, frame);
    
    case 'config.get':
      return handleConfigGetRequest(client, frame);
    
    case 'health':
      return handleHealthRequest(client, frame);
    
    case 'node.invoke':
      return handleNodeInvokeRequest(client, frame);
    
    default:
      return sendError(client.ws, frame.id, {
        code: 'METHOD_NOT_FOUND',
        message: `Unknown method: ${frame.method}`
      });
  }
}
```

### 4.3 事件广播机制

```typescript
// src/gateway/event-bus.ts
export class EventBus {
  private clients = new Map<ClientId, Client>();
  private subscriptions = new Map<EventType, Set<ClientId>>();
  
  // 订阅事件
  subscribe(clientId: ClientId, eventType: EventType) {
    if (!this.subscriptions.has(eventType)) {
      this.subscriptions.set(eventType, new Set());
    }
    this.subscriptions.get(eventType).add(clientId);
  }
  
  // 广播事件
  broadcast(eventType: EventType, payload: any, options?: BroadcastOptions) {
    const { exclude, include } = options || {};
    
    const subscribers = this.subscriptions.get(eventType) || new Set();
    
    for (const clientId of subscribers) {
      // 跳过排除的客户端
      if (exclude?.includes(clientId)) continue;
      
      // 只发送给包含的客户端 (如果有指定)
      if (include && !include.includes(clientId)) continue;
      
      const client = this.clients.get(clientId);
      if (client && client.ws.readyState === WebSocket.OPEN) {
        this.sendEvent(client, eventType, payload);
      }
    }
  }
  
  // 发送事件到单个客户端
  private sendEvent(client: Client, eventType: EventType, payload: any) {
    const frame = {
      type: 'event',
      event: eventType,
      payload,
      seq: client.nextSeq++,
      timestamp: Date.now()
    };
    
    client.ws.send(JSON.stringify(frame));
  }
}
```

---

## 5. 会话管理调用链

### 5.1 会话创建/加载

```typescript
// src/sessions/store.ts
export class SessionStore {
  private storePath: string;
  private cache = new Map<SessionKey, SessionEntry>();
  
  async getOrCreate(sessionKey: string): Promise<Session> {
    // 1. 检查缓存
    const cached = this.cache.get(sessionKey);
    if (cached) {
      return this.loadSession(cached.sessionId);
    }
    
    // 2. 从存储加载
    const store = await this.readStore();
    let entry = store.sessions[sessionKey];
    
    if (!entry) {
      // 3. 创建新会话
      entry = {
        sessionId: generateSessionId(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        origin: this.resolveOrigin(sessionKey)
      };
      
      store.sessions[sessionKey] = entry;
      await this.writeStore(store);
    }
    
    // 4. 更新缓存
    this.cache.set(sessionKey, entry);
    
    // 5. 加载会话
    return this.loadSession(entry.sessionId);
  }
  
  private async loadSession(sessionId: string): Promise<Session> {
    const transcriptPath = this.getTranscriptPath(sessionId);
    
    // 读取 JSONL 文件
    const lines = await readJsonlFile(transcriptPath);
    
    const messages = lines.map(line => JSON.parse(line));
    
    return {
      id: sessionId,
      messages,
      metadata: this.getSessionMetadata(sessionId)
    };
  }
}
```

### 5.2 会话维护 (清理/归档)

```typescript
// src/sessions/maintenance.ts
export async function runSessionMaintenance(options: MaintenanceOptions) {
  const { mode, pruneAfter, maxEntries, maxDiskBytes } = options;
  
  const store = await readStore();
  const actions: MaintenanceAction[] = [];
  
  // 1. 清理过期会话
  const pruneCutoff = Date.now() - parseDuration(pruneAfter);
  for (const [key, entry] of Object.entries(store.sessions)) {
    if (entry.updatedAt < pruneCutoff) {
      actions.push({
        type: 'prune',
        sessionKey: key,
        reason: 'expired'
      });
      
      if (mode === 'enforce') {
        delete store.sessions[key];
        await archiveTranscript(entry.sessionId);
      }
    }
  }
  
  // 2. 限制会话数量
  const entries = Object.entries(store.sessions);
  if (entries.length > maxEntries) {
    // 按更新时间排序，删除最旧的
    entries.sort((a, b) => a[1].updatedAt - b[1].updatedAt);
    
    const toRemove = entries.slice(0, entries.length - maxEntries);
    for (const [key, entry] of toRemove) {
      actions.push({
        type: 'prune',
        sessionKey: key,
        reason: 'max_entries'
      });
      
      if (mode === 'enforce') {
        delete store.sessions[key];
        await archiveTranscript(entry.sessionId);
      }
    }
  }
  
  // 3. 磁盘预算检查
  if (maxDiskBytes) {
    const diskUsage = await calculateDiskUsage();
    
    if (diskUsage.total > maxDiskBytes) {
      actions.push({
        type: 'disk_cleanup',
        currentBytes: diskUsage.total,
        targetBytes: maxDiskBytes * 0.8 // 高水位线
      });
      
      if (mode === 'enforce') {
        await enforceDiskBudget(maxDiskBytes * 0.8);
      }
    }
  }
  
  // 4. 写入存储
  if (mode === 'enforce') {
    await writeStore(store);
  }
  
  return {
    actions,
    remainingSessions: Object.keys(store.sessions).length
  };
}
```

---

## 6. 关键代码位置索引

### 6.1 Gateway 核心

| 功能 | 文件路径 | 关键函数 |
|------|----------|----------|
| 启动引导 | `src/gateway/boot.ts` | `bootGateway()` |
| WebSocket 服务器 | `src/gateway/server.ts` | `createGatewayServer()` |
| 认证授权 | `src/gateway/auth.ts` | `authenticateConnection()` |
| 客户端管理 | `src/gateway/client.ts` | `handleWebSocketConnection()` |
| 消息接收 | `src/gateway/chat-receive.ts` | `handleChatReceive()` |
| 消息发送 | `src/gateway/chat-send.ts` | `handleChatSend()` |
| Agent 调用 | `src/gateway/agent-prompt.ts` | `triggerAgent()` |
| 事件总线 | `src/gateway/event-bus.ts` | `EventBus.broadcast()` |
| 配置管理 | `src/gateway/config-reload.ts` | `reloadConfig()` |

### 6.2 Agent 运行时

| 功能 | 文件路径 | 关键函数 |
|------|----------|----------|
| Pi Agent 执行器 | `src/agents/pi-embedded-runner.ts` | `runEmbeddedPiAgent()` |
| 事件订阅 | `src/agents/pi-embedded-subscribe.ts` | `subscribeEmbeddedPiSession()` |
| 工具定义 | `src/agents/pi-tools.ts` | `executeTool()` |
| OpenClaw 工具 | `src/agents/openclaw-tools.ts` | `getOpenClawTools()` |
| 模型配置 | `src/agents/models-config.ts` | `resolveModelsConfig()` |
| 模型故障转移 | `src/agents/model-fallback.ts` | `resolveAuthProfileOrder()` |
| 技能系统 | `src/agents/skills.ts` | `loadSkillsForSession()` |
| 沙箱执行 | `src/agents/sandbox.ts` | `createSandbox()` |
| Bash 工具 | `src/agents/bash-tools.ts` | `executeBashCommand()` |

### 6.3 会话管理

| 功能 | 文件路径 | 关键函数 |
|------|----------|----------|
| 会话存储 | `src/sessions/store.ts` | `SessionStore.getOrCreate()` |
| 会话历史 | `src/sessions/history.ts` | `getSessionHistory()` |
| 会话压缩 | `src/sessions/compaction.ts` | `compactSession()` |
| 会话维护 | `src/sessions/maintenance.ts` | `runSessionMaintenance()` |
| 会话路由 | `src/routing/session-router.ts` | `resolveSessionKey()` |

### 6.4 通道系统

| 功能 | 文件路径 | 关键函数 |
|------|----------|----------|
| 通道注册 | `src/channels/registry.ts` | `registerChannel()` |
| Telegram | `extensions/telegram/src/bot.ts` | `handleTelegramMessage()` |
| WhatsApp | `extensions/whatsapp/src/baileys.ts` | `handleWhatsAppMessage()` |
| Discord | `extensions/discord/src/bot.ts` | `handleDiscordMessage()` |
| Slack | `extensions/slack/src/bolt.ts` | `handleSlackMessage()` |
| 白名单管理 | `src/channels/allowlists/` | `checkAllowlist()` |

### 6.5 工具实现

| 工具 | 文件路径 | 关键函数 |
|------|----------|----------|
| read | `src/agents/pi-tools.read.ts` | `readFile()` |
| write | `src/agents/pi-tools.write.ts` | `writeFile()` |
| edit | `src/agents/pi-tools.edit.ts` | `editFile()` |
| exec | `src/agents/bash-tools.ts` | `executeBashCommand()` |
| browser | `src/browser/controller.ts` | `browserAction()` |
| web_search | `src/web-search/brave.ts` | `webSearch()` |
| memory_search | `src/memory/search.ts` | `memorySearch()` |
| sessions_* | `src/sessions/tools.ts` | `sessionsTool()` |

---

## 7. 性能关键点

### 7.1 热点路径优化

1. **消息接收路径**
   - 避免同步 I/O
   - 批量写入会话记录
   - 异步事件推送

2. **Agent 执行路径**
   - 流式响应减少延迟
   - 工具并行执行 (当可能时)
   - 会话历史懒加载

3. **会话存储路径**
   - 内存缓存热点会话
   - JSONL 增量写入
   - 后台维护任务

### 7.2 内存管理

```typescript
// 会话缓存策略
class SessionCache {
  private cache = new LRUCache<SessionKey, Session>({
    max: 100,           // 最多缓存 100 个会话
    ttl: 30 * 60 * 1000 // 30 分钟过期
  });
  
  async get(key: SessionKey): Promise<Session | undefined> {
    // 优先从缓存读取
    const cached = this.cache.get(key);
    if (cached) return cached;
    
    // 从磁盘加载
    const session = await loadFromDisk(key);
    if (session) {
      this.cache.set(key, session);
    }
    return session;
  }
}
```

### 7.3 并发控制

```typescript
// 会话写入锁
class SessionWriteLock {
  private locks = new Map<SessionKey, Promise<void>>();
  
  async acquire(sessionKey: SessionKey): Promise<() => void> {
    // 等待现有锁释放
    while (this.locks.has(sessionKey)) {
      await this.locks.get(sessionKey);
    }
    
    // 创建新锁
    let release: () => void;
    const lockPromise = new Promise<void>(resolve => {
      release = () => {
        this.locks.delete(sessionKey);
        resolve();
      };
    });
    
    this.locks.set(sessionKey, lockPromise);
    return release!;
  }
}
```

---

*文档结束* 🦞

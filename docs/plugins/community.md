---
summary: "Community-maintained OpenClaw plugins: browse, install, and submit your own"
read_when:
  - You want to find third-party OpenClaw plugins
  - You want to publish or list your own plugin
title: "Community Plugins"
---

# Community Plugins

Community plugins are third-party packages that extend OpenClaw with new
channels, tools, providers, or other capabilities. They are built and maintained
by the community, published on [ClawHub](/tools/clawhub) or npm, and
installable with a single command.

ClawHub is the canonical discovery surface for community plugins. Do not open
docs-only PRs just to add your plugin here for discoverability; publish it on
ClawHub instead.

```bash
openclaw plugins install <package-name>
```

OpenClaw checks ClawHub first and falls back to npm automatically.

## Listed plugins

### Berry Shield

Runtime security plugin for OpenClaw with layered protection for risky actions,
`1:1` (one code per action) and `1:N` (one code for related actions) confirmation,
output redaction, audit evidence, and a dedicated `bshield` CLI.

- **npm:** `@f4bioo/berry-shield`
- **repo:** [github.com/F4bioo/berry-shield](https://github.com/F4bioo/berry-shield)

```bash
openclaw plugins install @f4bioo/berry-shield
```

### Codex App Server Bridge

Independent OpenClaw bridge for Codex App Server conversations. Bind a chat to
a Codex thread, talk to it with plain text, and control it with chat-native
commands for resume, planning, review, model selection, compaction, and more.

- **npm:** `openclaw-codex-app-server`
- **repo:** [github.com/pwrdrvr/openclaw-codex-app-server](https://github.com/pwrdrvr/openclaw-codex-app-server)

```bash
openclaw plugins install openclaw-codex-app-server
```

### Cortex Memory

Persistent memory engine for AI assistants with 4-tier architecture
(Working, Episodic, Semantic, Procedural), Bayesian beliefs, people graph,
and multi-signal retrieval. Local-first, zero-cloud, Rust-native.

- **npm:** `@cortex-ai-memory/cortex-memory`
- **repo:** [github.com/gambletan/cortex](https://github.com/gambletan/cortex)

```bash
openclaw plugins install @cortex-ai-memory/cortex-memory
```

### DingTalk

## Listed plugins

- **Scientify** — AI-powered research workflow automation: 6-phase pipeline (literature survey → deep analysis → implementation plan → code → review → experiments), with arXiv/OpenAlex/GitHub search tools and persistent workspace management.
  npm: `scientify`
  repo: `https://github.com/tsingyuai/scientify`
  install: `openclaw plugins install scientify`

## Candidate format
Enterprise robot integration using Stream mode. Supports text, images, and
file messages via any DingTalk client.

- **npm:** `@largezhou/ddingtalk`
- **repo:** [github.com/largezhou/openclaw-dingtalk](https://github.com/largezhou/openclaw-dingtalk)

```bash
openclaw plugins install @largezhou/ddingtalk
```

### Google Chat Pub/Sub

Listen to Google Chat spaces via Workspace Events API + Cloud Pub/Sub — no
`@mention` required. Multi-agent routing with keyword and alwaysListen support,
thread-first replies, and per-thread session isolation.

- **npm:** `@teyou/openclaw-googlechatpubsub`
- **repo:** [github.com/teyou/openclaw-googlechatpubsub-plugin](https://github.com/teyou/openclaw-googlechatpubsub-plugin)

```bash
openclaw plugins install @teyou/openclaw-googlechatpubsub
```

### Lossless Claw (LCM)

Lossless Context Management plugin for OpenClaw. DAG-based conversation
summarization with incremental compaction — preserves full context fidelity
while reducing token usage.

- **npm:** `@martian-engineering/lossless-claw`
- **repo:** [github.com/Martian-Engineering/lossless-claw](https://github.com/Martian-Engineering/lossless-claw)

```bash
openclaw plugins install @martian-engineering/lossless-claw
```

### MCP Bridge

Connect any MCP server to OpenClaw. Supports stdio, SSE, and streamable-http
transports with a built-in server catalog for one-command setup.

- **npm:** `@aiwerk/openclaw-mcp-bridge`
- **repo:** [github.com/AIWerk/openclaw-mcp-bridge](https://github.com/AIWerk/openclaw-mcp-bridge)

```bash
openclaw plugins install @aiwerk/openclaw-mcp-bridge
```

### Opik

Official plugin that exports agent traces to Opik. Monitor agent behavior,
cost, tokens, errors, and more.

- **npm:** `@opik/opik-openclaw`
- **repo:** [github.com/comet-ml/opik-openclaw](https://github.com/comet-ml/opik-openclaw)

```bash
openclaw plugins install @opik/opik-openclaw
```

### Qmemory

Context-engine plugin that gives agents persistent, cross-session graph memory
powered by SurrealDB. Implements the full `ContextEngine` interface with 12
lifecycle hooks capturing tool calls, cron outcomes, subagent relationships,
and session state into a connected graph the agent can search and traverse.

- **npm:** `qmemory`
- **repo:** [github.com/QusaiiSaleem/qmemory](https://github.com/QusaiiSaleem/qmemory)

```bash
openclaw plugins install qmemory
```

### QQbot

Connect OpenClaw to QQ via the QQ Bot API. Supports private chats, group
mentions, channel messages, and rich media including voice, images, videos,
and files.

- **npm:** `@tencent-connect/openclaw-qqbot`
- **repo:** [github.com/tencent-connect/openclaw-qqbot](https://github.com/tencent-connect/openclaw-qqbot)

```bash
openclaw plugins install @tencent-connect/openclaw-qqbot
```

### Stimm Voice

Real-time voice conversations via a dual-agent architecture: one agent talks
fast, one thinks deep — both collaborate in real-time. A Python voice agent
handles low-latency speech; OpenClaw acts as supervisor for reasoning, tools,
and long-context decisions.

- **npm:** `openclaw-stimm-voice`
- **repo:** [github.com/EtienneLescot/openclaw-stimm-voice](https://github.com/EtienneLescot/openclaw-stimm-voice)

```bash
openclaw plugins install openclaw-stimm-voice
```

### TickFlow Assist

A-share watchlist analysis, monitoring, and alert delivery powered by TickFlow and OpenClaw. Features interactive automatic installation via community configure tools.

- **npm:** `tickflow-assist`
- **repo:** [github.com/robinspt/tickflow-assist](https://github.com/robinspt/tickflow-assist)

```bash
openclaw plugins install tickflow-assist
```

After installation, run the configuration wizard:

```bash
npx -y tickflow-assist configure-openclaw
```

### Team Ops

Turns chat transcripts into decisions, action items, blockers, and ready-to-send
status updates for teams and executives. Great for standups, planning notes,
incident rooms, and cross-functional launch threads.

- **npm:** `team-ops`
- **repo:** [github.com/JimmyWangJimmy/openclaw-team-ops-plugin](https://github.com/JimmyWangJimmy/openclaw-team-ops-plugin)

```bash
openclaw plugins install team-ops
```

### TeamSpeak

OpenClaw channel plugin for TeamSpeak — text & voice chat via the native
client protocol. Compatible with TeamSpeak 3, 5 & 6.

- **npm:** `@honeybbq/openclaw-teamspeak`
- **repo:** [github.com/HoneyBBQ/openclaw-teamspeak](https://github.com/HoneyBBQ/openclaw-teamspeak)

```bash
openclaw plugins install @honeybbq/openclaw-teamspeak
```

### Sage

Safety for Agents — Agent Detection & Response (ADR) layer for OpenClaw.
Guards commands, files, and web requests using configurable YAML threat rules
and real-time URL reputation checking. By Gen Digital.

- **npm:** `@gendigital/sage-openclaw`
- **repo:** [github.com/gendigitalinc/sage](https://github.com/gendigitalinc/sage)

```bash
openclaw plugins install @gendigital/sage-openclaw
```

### Statocyst

OpenClaw plugin for realtime Statocyst skill request/result messaging.

- **npm:** `@moltenbot/openclaw-plugin-statocyst`
- **repo:** [github.com/Molten-Bot/statocyst](https://github.com/Molten-Bot/statocyst)

```bash
openclaw plugins install @moltenbot/openclaw-plugin-statocyst
```

### wecom

WeCom channel plugin for OpenClaw by the Tencent WeCom team. Powered by
WeCom Bot WebSocket persistent connections, it supports direct messages & group
chats, streaming replies, proactive messaging, image/file processing, Markdown
formatting, built-in access control, and document/meeting/messaging skills.

- **npm:** `@wecom/wecom-openclaw-plugin`
- **repo:** [github.com/WecomTeam/wecom-openclaw-plugin](https://github.com/WecomTeam/wecom-openclaw-plugin)

```bash
openclaw plugins install @wecom/wecom-openclaw-plugin
```

### YDIM

Connect OpenClaw to YDIM.
Supports text, image, and file exchange.

- **npm:** `openclaw-ydim`
- **repo:** [github.com/cmic-opensource/openclaw-ydim](https://github.com/cmic-opensource/openclaw-ydim)

```bash
openclaw plugins install openclaw-ydim
```

## Submit your plugin

We welcome community plugins that are useful, documented, and safe to operate.

<Steps>
  <Step title="Publish to ClawHub or npm">
    Your plugin must be installable via `openclaw plugins install \<package-name\>`.
    Publish to [ClawHub](/tools/clawhub) (preferred) or npm.
    See [Building Plugins](/plugins/building-plugins) for the full guide.

  </Step>

  <Step title="Host on GitHub">
    Source code must be in a public repository with setup docs and an issue
    tracker.

  </Step>

  <Step title="Use docs PRs only for source-doc changes">
    You do not need a docs PR just to make your plugin discoverable. Publish it
    on ClawHub instead.

    Open a docs PR only when OpenClaw's source docs need an actual content
    change, such as correcting install guidance or adding cross-repo
    documentation that belongs in the main docs set.

  </Step>
</Steps>

## Quality bar

| Requirement                 | Why                                           |
| --------------------------- | --------------------------------------------- |
| Published on ClawHub or npm | Users need `openclaw plugins install` to work |
| Public GitHub repo          | Source review, issue tracking, transparency   |
| Setup and usage docs        | Users need to know how to configure it        |
| Active maintenance          | Recent updates or responsive issue handling   |

Low-effort wrappers, unclear ownership, or unmaintained packages may be declined.

## Related

- **WeChat** — Connect OpenClaw to WeChat personal accounts via WeChatPadPro (iPad protocol). Supports text, image, and file exchange with keyword-triggered conversations.
  npm: `@icesword760/openclaw-wechat`
  repo: `https://github.com/icesword0760/openclaw-wechat`
  install: `openclaw plugins install @icesword760/openclaw-wechat`

- **MAX** — Connect OpenClaw to MAX messenger (max.ru) via Bot API. Supports DMs and group chats with streaming replies and typing indicators.
  npm: `@olegbalbekov/openclaw-max`
  repo: `https://github.com/olegbalbekov/openclaw-max`
  install: `openclaw plugins install @olegbalbekov/openclaw-max`
- [Install and Configure Plugins](/tools/plugin) — how to install any plugin
- [Building Plugins](/plugins/building-plugins) — create your own
- [Plugin Manifest](/plugins/manifest) — manifest schema

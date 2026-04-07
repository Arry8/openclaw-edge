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

```bash
openclaw plugins install <package-name>
```

OpenClaw checks ClawHub first and falls back to npm automatically.

- **Cognee Memory** — Cognee memory plugin with automatic recall before agent runs and auto-indexing of workspace memory files
  npm: `@cognee/cognee-openclaw`
  repo: `https://github.com/hande-k/cognee-integrations`
  install: `openclaw plugins install @cognee/cognee-openclaw`
## Listed plugins

### AIFBA Amazon Listing Analyzer for OpenClaw

Cloud-powered Amazon listing analyzer for OpenClaw. Built for Amazon sellers who want one-click listing analysis, competitor-backed optimization, and a structured AIFBA web report.

- **npm:** `aifba-amazon-listing-analyzer-openclaw`
- **repo:** [github.com/corli-AIFBA/aifba-amazon-listing-analyzer-openclaw](https://github.com/corli-AIFBA/aifba-amazon-listing-analyzer-openclaw)

```bash
openclaw plugins install aifba-amazon-listing-analyzer-openclaw
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

Enterprise robot integration using Stream mode. Supports text, images, and
file messages via any DingTalk client.

- **npm:** `@largezhou/ddingtalk`
- **repo:** [github.com/largezhou/openclaw-dingtalk](https://github.com/largezhou/openclaw-dingtalk)

```bash
openclaw plugins install @largezhou/ddingtalk
```

### HRR Fact Memory

Structured fact recall using Holographic Reduced Representations. Complements
RAG-based `memory_search` with instant <2ms factual lookups — no embeddings,
no vector database, zero external dependencies. Parses MEMORY.md into
`(subject, relation, object)` triples and answers questions like
"What is Alice's timezone?" in under 2 milliseconds. Optional observation
layer tracks belief changes over time.

- **npm:** `openclaw-hrr-memory`
- **repo:** [github.com/Joncik91/openclaw-hrr-memory](https://github.com/Joncik91/openclaw-hrr-memory)

```bash
openclaw plugins install openclaw-hrr-memory
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

### MAX Messenger

MAX Messenger channel plugin for OpenClaw Gateway. Supports long polling,
streaming responses, file attachments, typing indicators, and flexible access
control (open/pairing/closed/allowlist/disabled).

- **npm:** `@biguxuzz/max`
- **repo:** [github.com/biguxuzz/openclaw-max-plugin](https://github.com/biguxuzz/openclaw-max-plugin)

```bash
openclaw plugins install @biguxuzz/max
```

### Opik

Official plugin that exports agent traces to Opik. Monitor agent behavior,
cost, tokens, errors, and more.

- **npm:** `@opik/opik-openclaw`
- **repo:** [github.com/comet-ml/opik-openclaw](https://github.com/comet-ml/opik-openclaw)

```bash
openclaw plugins install @opik/opik-openclaw
```

### Pompelmi Attachment Firewall

Minimal native OpenClaw file preflight plugin powered by Pompelmi. Scans local
file/path inputs before tool execution and can allow, warn, or block
suspicious or malicious attachments.

- **npm:** `@pompelmi/openclaw-attachment-firewall`
- **repo:** [github.com/pompelmi/openclaw-attachment-firewall](https://github.com/pompelmi/openclaw-attachment-firewall)

```bash
openclaw plugins install @pompelmi/openclaw-attachment-firewall
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

### Statocyst

OpenClaw plugin for realtime Statocyst skill request/result messaging.

- **npm:** `@moltenbot/openclaw-plugin-statocyst`
- **repo:** [github.com/Molten-Bot/statocyst](https://github.com/Molten-Bot/statocyst)

```bash
openclaw plugins install @moltenbot/openclaw-plugin-statocyst
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

### TeamSpeak

OpenClaw channel plugin for TeamSpeak — text & voice chat via the native
client protocol. Compatible with TeamSpeak 3, 5 & 6.

- **npm:** `@honeybbq/openclaw-teamspeak`
- **repo:** [github.com/HoneyBBQ/openclaw-teamspeak](https://github.com/HoneyBBQ/openclaw-teamspeak)

```bash
openclaw plugins install @honeybbq/openclaw-teamspeak
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

  <Step title="Open a PR">
    Add your plugin to this page with:

    - Plugin name
    - npm package name
    - GitHub repository URL
    - One-line description
    - Install command

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

For **security-sensitive** plugins (for example plugins that gate shell/network
behavior, handle credentials, or inspect untrusted content), we also strongly
prefer:

- a `SECURITY.md` or equivalent vulnerability-reporting path
- a clear limitations/scope section in the README
- a short verification path maintainers can run quickly

These are not separate hard gates today, but they materially improve review and
operator trust.

## Related

- **Adaptive Cards** — Registers an `adaptive_card` tool that lets the agent respond with native Adaptive Cards (v1.6) across iOS, Android, Teams, and web, with schema validation, host compatibility checking, and automatic plain-text fallback for unsupported channels.
  npm: `@vikrantsingh01/openclaw-adaptive-cards`
  repo: `https://github.com/VikrantSingh01/openclaw-adaptive-cards`
  install: `openclaw plugins install @vikrantsingh01/openclaw-adaptive-cards`

- **ContentClaw** — Generate AI-powered content pages at scale from any topic, analyze competitor sitemaps, and serve via REST API for any CMS.
  npm: `contentclaw-openclaw-plugin`
  repo: `https://github.com/metehan777/contentclaw`
  prerequisite: `npm install -g contentclaw`
  install: `openclaw plugins install contentclaw-openclaw-plugin`

- **ClawPool** — ClawPool channel transport and onboarding plugin for OpenClaw, with a bundled skill for registration, login, API-agent bootstrap, and channel setup.
  npm: `@dhfpub/clawpool`
  repo: `https://github.com/askie/aibot/tree/main/openclaw_plugins/clawpool`
  install: `openclaw plugins install @dhfpub/clawpool`

- **ClawPool Admin** — Typed ClawPool group governance and API-agent admin tools for OpenClaw. Requires `@dhfpub/clawpool` and a configured `channels.clawpool` first.
  npm: `@dhfpub/clawpool-admin`
  repo: `https://github.com/askie/aibot/tree/main/openclaw_plugins/clawpool-admin`
  install: `openclaw plugins install @dhfpub/clawpool-admin`

- **Lightcone** — OpenClaw cloud browser automation plugin via Lightcone (Tzafon).
  npm: `@tzafon/openclaw-lightcone`
  repo: `https://github.com/tzafon/openclaw-lightcone`
  install: `openclaw plugins install @tzafon/openclaw-lightcone`

- **Experience Replay** — Contextual experience replay plugin for OpenClaw. Stores successful task traces in local SQLite and injects similar past wins before future runs.
  npm: `experience-replay`
  repo: `https://github.com/tirpitzia/openclaw-experience-replay`
  install: `openclaw plugins install experience-replay`

- **AARI Execution Firewall** — Pre-execution firewall for OpenClaw agents with ALLOW / WARN / BLOCK policy enforcement and audit trail.
  npm: `@aari/aari-firewall`
  repo: `https://github.com/aari-ai/openclaw-aari`
  install: `openclaw plugins install @aari/aari-firewall`

- **MemoLite** — Local long-term memory plugin for OpenClaw with search, store, recall, list, and auto-capture flows backed by the MemoLite memory service.
  npm: `@wenrennow/memolite`
  repo: `https://github.com/shaun17/MemoLite`
  install: `openclaw plugins install @wenrennow/memolite`

- **TweetClaw** — Post tweets, reply, like, retweet, follow, DM & more from your chat.
  npm: `@xquik/tweetclaw`
  repo: `https://github.com/Xquik-dev/tweetclaw`
  install: `openclaw plugins install @xquik/tweetclaw`

- **Ratelimit Retry** — Automatically retry agent conversations that fail due to provider rate limits (429). Detects budget/TPM/RPM errors and queues retries with configurable backoff windows.
  npm: `@cheapestinference/openclaw-ratelimit-retry`
  repo: `https://github.com/cheapestinference/openclaw-plugin-ratelimit-retry`
  install: `openclaw plugins install @cheapestinference/openclaw-ratelimit-retry`

- **Ratelimit Retry** — Automatically retry agent conversations killed by provider rate limits (429, budget exhaustion) by queuing sessions to disk and resuming when the budget window resets.
  npm: `@cheapestinference/openclaw-ratelimit-retry`
  repo: `https://github.com/cheapestinference/openclaw-plugin-ratelimit-retry`
  install: `openclaw plugins install @cheapestinference/openclaw-ratelimit-retry`

- **Memory Core Plus** — Enhanced workspace memory with closed-loop auto-recall and auto-capture. Semantically searches past memories before each LLM turn and automatically extracts durable facts from conversations.
  npm: `memory-core-plus`
  repo: `https://github.com/aloong-planet/openclaw-memory-core-plus`
  install: `openclaw plugins install memory-core-plus`

- **mindkeeper** — Version control for agent context files with auto-snapshots, diffs, rollback, and LLM-powered commit messages.
  npm: `mindkeeper-openclaw`
  repo: `https://github.com/seekcontext/mindkeeper`
  install: `openclaw plugins install mindkeeper-openclaw`

- **Adaptive Cards** — Registers an `adaptive_card` tool that lets the agent respond with native Adaptive Cards (v1.6) across iOS, Android, Teams, and web, with schema validation, host compatibility checking, and automatic plain-text fallback for unsupported channels.
  npm: `@vikrantsingh01/openclaw-adaptive-cards`
  repo: `https://github.com/VikrantSingh01/openclaw-adaptive-cards`
  install: `openclaw plugins install @vikrantsingh01/openclaw-adaptive-cards`

- **JuhBDI** — BDI (Belief-Desire-Intention) governance for AI agents. Intent verification, SHA-256 audit trails, cross-linked memory recall, trust scoring, and principle extraction. 5 tools, 2 hooks. Works with any LLM.
  npm: `@juhlabs/openclaw-bdi`
  repo: `https://github.com/JuhLabs/juhbdi`
  install: `openclaw plugins install @juhlabs/openclaw-bdi`

- **External A2A Delegation** — Native OpenClaw outbound A2A delegation plugin that exposes one `remote_agent` tool for target discovery, remote delegation, task watch, status, and cancel.
  npm: `@aramisfa/openclaw-a2a-outbound`
  repo: `https://github.com/aramisfacchinetti/openclaw-a2a-plugins`
  install: `openclaw plugins install @aramisfa/openclaw-a2a-outbound`

- **ETS — Email Token Saver** — Filters and compresses email before it hits your LLM. Rules-based pre-filter with 127 extractor templates, weighted scoring, local rule overrides, and SQLite run tracking. Benchmarked at 77% token reduction on real Gmail inboxes.
  npm: `@awsoft/ets`
  repo: `https://github.com/awsoft/ets`
  install: `openclaw plugins install @awsoft/ets`

- **WakaTime** — Track OpenClaw messages, commands, sessions, and tool usage in WakaTime.
  npm: `@ambiguoustr/openclaw-wakatime`
  repo: `https://github.com/ambiguoustexture/openclaw-wakatime`
  install: `openclaw plugins install @ambiguoustr/openclaw-wakatime`

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
- [OpenStream](/plugins/openstream) — example bundled Ollama companion plugin

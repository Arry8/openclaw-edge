# @openclaw/learning-loop

Self-improving AI agent plugin for **OpenClaw** with a built-in learning loop.

Three subsystems work together to make the agent continuously smarter:

1. **Knowledge Graph Memory** — Graphiti-backed temporal knowledge graph via MCP
2. **Autonomous Skill Evolution** — automatic skill refinement from errors and corrections
3. **Learning Nudge Loop** — periodic background reviews that persist knowledge

Docs: `https://docs.openclaw.ai/plugins/learning-loop`
Plugin system: `https://docs.openclaw.ai/plugins`

## How It Works

```
User Chat / Tool Execution
        │
        ▼
┌───────────────────────────────────────────────┐
│  Lifecycle Hooks (agent_end, before_prompt)    │
│                                               │
│  ┌─────────────┐  ┌──────────────┐  ┌──────┐ │
│  │  Knowledge   │  │    Skill     │  │Nudge │ │
│  │  Graph       │  │  Evolution   │  │Loop  │ │
│  │  Memory      │  │              │  │      │ │
│  └──────┬───────┘  └──────┬───────┘  └──┬───┘ │
└─────────┼─────────────────┼─────────────┼─────┘
          │                 │             │
          ▼                 ▼             ▼
    ┌──────────┐     ┌───────────┐   background
    │ Graphiti │     │evolutions │   LLM review
    │ MCP Srv  │     │  .json +  │
    │ (Neo4j/  │     │ SKILL.md  │
    │ FalkorDB)│     └───────────┘
    └──────────┘
```

### 1. Knowledge Graph Memory

Instead of flat-file memory, this plugin uses [Graphiti](https://github.com/getzep/graphiti)
to store knowledge as a **temporal knowledge graph**. Entities, facts, and relationships
are automatically extracted from conversations and stored with bi-temporal validity.

- **Auto-recall**: Before each agent turn, relevant facts and entities are retrieved
  from the graph and injected into the system prompt.
- **Auto-capture**: After each agent turn, user messages are stored as episodes.
  Graphiti's internal LLM extracts entities and facts automatically.
- **Manual tools**: `knowledge_search`, `knowledge_store`, `knowledge_forget`.

### 2. Autonomous Skill Evolution

When errors occur or the user corrects the agent, this subsystem automatically
refines relevant skills — the agent learns from its mistakes.

**Pipeline:**

```
Signal Detection (rule-based, no LLM cost)
    │
    ▼  Detects: execution failures + user corrections
Group by Skill
    │
    ▼  Attributes signals to skills via pattern matching
LLM-Based Refinement
    │
    ▼  Generates 1-2 improvement entries per skill
Persist to evolutions.json
    │
    ▼  Stored alongside SKILL.md
Solidify (optional manual step)
    │
    ▼  Writes pending entries into SKILL.md sections
```

**Signal types detected:**

- **Execution failures**: error keywords, stack traces, exit codes, permission denied, etc.
- **User corrections**: "that's wrong", "should be", "don't do", "instead use", "I prefer", etc.

**Evolution entries** target either:

- **Description layer** — injected into prompts as learned experience (immediate effect)
- **Body layer** — written into SKILL.md via `/solidify` (permanent documentation)

### 3. Learning Nudge Loop

Inspired by [Hermes Agent](https://github.com/NousResearch/hermes-agent), this subsystem
uses turn-based counters to periodically trigger background reviews.

- After every N turns (default: 10), a **memory review** analyzes the conversation
  for user preferences, project facts, and technical patterns worth remembering.
- After every M turns (default: 10), a **skill review** checks whether any
  non-trivial approach, workaround, or user expectation warrants a skill update.
- Reviews run **after the response is delivered** — they never block the user.
- Counters reset when the user manually uses knowledge or evolution tools.

## Prerequisites

**Graphiti MCP Server** must be running. The simplest setup:

```bash
# Clone Graphiti
git clone https://github.com/getzep/graphiti.git
cd graphiti/mcp_server

# Start with Docker Compose (includes FalkorDB)
docker compose up
```

This starts the MCP server at `http://localhost:8000/mcp/` with FalkorDB as the graph backend.

For Neo4j instead of FalkorDB, see the [Graphiti docs](https://help.getzep.com/graphiti/getting-started/quick-start).

## Install

### Option A: install via OpenClaw (recommended)

```bash
openclaw plugins install @openclaw/learning-loop
```

Restart the Gateway afterwards.

### Option B: copy into your global extensions folder (dev)

```bash
PLUGIN_HOME=~/.openclaw/extensions
mkdir -p "$PLUGIN_HOME"
cp -R <local-plugin-checkout> "$PLUGIN_HOME/learning-loop"
cd "$PLUGIN_HOME/learning-loop" && pnpm install
```

## Config

Put under `plugins.entries.learning-loop.config`:

```json5
{
  // Required: Graphiti MCP server endpoint
  graphiti: {
    mcpServerUrl: "http://localhost:8000/mcp/",
    groupId: "my-project", // namespace for isolating graphs (default: "openclaw-default")
  },

  // Skill evolution (default: enabled, always_allow)
  evolution: {
    enabled: true,
    approvalPolicy: "always_allow", // or "ask" to require approval
    maxEntriesPerRound: 2, // max improvements per conversation (1-5)
  },

  // Learning nudge loop (default: enabled)
  nudge: {
    enabled: true,
    memoryInterval: 10, // turns between memory reviews (3-50)
    skillInterval: 10, // turns between skill reviews (3-50)
  },

  // Auto-recall/capture (default: both enabled)
  memory: {
    autoRecall: true, // inject relevant knowledge before agent starts
    autoCapture: true, // store conversation episodes after agent ends
  },
}
```

## Tools

### Knowledge Graph

| Tool               | Description                                             |
| ------------------ | ------------------------------------------------------- |
| `knowledge_search` | Search the graph for facts, entities, and relationships |
| `knowledge_store`  | Store an observation, fact, or preference               |
| `knowledge_forget` | Delete a specific fact by UUID                          |

### Skill Evolution

| Tool             | Description                                     |
| ---------------- | ----------------------------------------------- |
| `skill_evolve`   | Manually trigger evolution for a specific skill |
| `skill_solidify` | Write pending evolutions into SKILL.md          |

## CLI

```bash
# Status and diagnostics
openclaw learning-loop status

# Search the knowledge graph
openclaw learning-loop search "user preferences"

# Manual skill evolution
openclaw learning-loop evolve my-skill

# Write pending evolutions to SKILL.md
openclaw learning-loop solidify my-skill

# View pending evolution entries
openclaw learning-loop pending my-skill
```

## File Layout

After evolution runs, skill directories look like:

```
skills/my-skill/
├── SKILL.md              # Human-edited + solidified evolutions
└── evolutions.json       # Machine-generated evolution entries
```

`evolutions.json` tracks all evolution entries with metadata:

```json
{
  "skillId": "my-skill",
  "version": "1.0.0",
  "updatedAt": "2026-04-03T10:30:00Z",
  "entries": [
    {
      "id": "ev_1234abcd",
      "source": "execution_failure",
      "timestamp": "2026-04-03T10:30:00Z",
      "context": "API timeout after 30s",
      "change": {
        "section": "Troubleshooting",
        "action": "append",
        "content": "## Handling Timeouts\n- Check network first\n- Use exponential backoff",
        "target": "body"
      },
      "applied": false
    }
  ]
}
```

## Architecture Notes

- **Graphiti connection**: Uses `@modelcontextprotocol/sdk` StreamableHTTP transport.
  The client lazily connects on first use and cleans up on service stop.
- **Signal detection**: Pure pattern matching (no LLM calls). Costs nothing.
- **LLM calls**: Only the skill evolver and nudge reviews call an LLM. Both are
  throttled (max entries per round, nudge intervals).
- **Prompt injection**: All stored content is scanned for injection patterns.
  Knowledge graph context is wrapped in `<knowledge-graph>` tags with an
  untrusted-data warning.
- **Session isolation**: Signal dedup cache and nudge counters reset on `session_start`.
- **Atomic writes**: Evolution files use tmp+rename for crash safety.
- **Non-blocking**: Nudge reviews and auto-capture run asynchronously after
  response delivery. They never block the user's interaction.

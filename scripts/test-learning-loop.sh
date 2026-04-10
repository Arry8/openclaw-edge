#!/usr/bin/env bash
# ===========================================================================
# test-learning-loop.sh
#
# Local dev script to test the learning-loop extension.
#
# Prerequisites:
#   1. Graphiti MCP server running (see below)
#   2. pnpm install (repo deps)
#
# Start Graphiti (one-time):
#   git clone https://github.com/getzep/graphiti.git /tmp/graphiti
#   cd /tmp/graphiti/mcp_server && docker compose up -d
#
# Usage:
#   ./scripts/test-learning-loop.sh                # embedded-agent smoke test
#   ./scripts/test-learning-loop.sh status          # check plugin status
#   ./scripts/test-learning-loop.sh search "query"  # search knowledge graph
#   ./scripts/test-learning-loop.sh agent "msg"     # send a message
# ===========================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

# Graphiti MCP server URL (override with GRAPHITI_URL env var)
GRAPHITI_URL="${GRAPHITI_URL:-http://localhost:8000/mcp}"

# Graph namespace (override with GRAPHITI_GROUP env var)
GRAPHITI_GROUP="${GRAPHITI_GROUP:-openclaw_test}"

# Base state/config to inherit model + auth from for E2E flows.
BASE_STATE_DIR="${LEARNING_LOOP_BASE_STATE_DIR:-${OPENCLAW_STATE_DIR:-$HOME/.openclaw}}"
if [ ! -d "$BASE_STATE_DIR" ] && [ -d "$HOME/.clawdbot" ]; then
  BASE_STATE_DIR="$HOME/.clawdbot"
fi

BASE_CONFIG_PATH="${LEARNING_LOOP_BASE_CONFIG_PATH:-${OPENCLAW_CONFIG_PATH:-$BASE_STATE_DIR/openclaw.json}}"
if [ ! -f "$BASE_CONFIG_PATH" ] && [ -f "$BASE_STATE_DIR/clawdbot.json" ]; then
  BASE_CONFIG_PATH="$BASE_STATE_DIR/clawdbot.json"
fi

# Use a dedicated test config so we don't pollute the user's real config
TEST_CONFIG_DIR="${TMPDIR:-/tmp}/openclaw-learning-loop-test"
TEST_CONFIG="$TEST_CONFIG_DIR/openclaw.json"
TEST_WORKSPACE_DIR="$TEST_CONFIG_DIR/workspace"

TEST_MODEL="$(
  BASE_CONFIG_PATH="$BASE_CONFIG_PATH" node <<'NODE'
const fs = require("node:fs");
const JSON5 = require("json5");

function readPrimaryModel(raw) {
  if (typeof raw === "string") {
    return raw.trim();
  }
  if (raw && typeof raw === "object" && typeof raw.primary === "string") {
    return raw.primary.trim();
  }
  return "";
}

const configPath = process.env.BASE_CONFIG_PATH;
if (!configPath || !fs.existsSync(configPath)) {
  process.exit(0);
}

try {
  const cfg = JSON5.parse(fs.readFileSync(configPath, "utf8"));
  const agents = Array.isArray(cfg?.agents?.list) ? cfg.agents.list : [];
  const defaultAgent = agents.find((entry) => entry && entry.default === true) ?? agents[0];
  const model =
    readPrimaryModel(defaultAgent?.model) || readPrimaryModel(cfg?.agents?.defaults?.model);
  if (model) {
    process.stdout.write(model);
  }
} catch {
  // Ignore parse issues; the shell fallback below will pick a default.
}
NODE
)"
TEST_MODEL="${LEARNING_LOOP_MODEL:-${TEST_MODEL:-openai-codex/gpt-5.4}}"

# ---------------------------------------------------------------------------
# Setup test config
# ---------------------------------------------------------------------------

mkdir -p "$TEST_CONFIG_DIR/extensions"
mkdir -p "$TEST_WORKSPACE_DIR"

# Reuse the caller's auth stores/credentials so LLM-backed flows such as
# evolve/nudge/agent can run end to end inside the isolated test state dir.
if [ -d "$BASE_STATE_DIR/agents" ]; then
  while IFS= read -r -d '' auth_file; do
    rel_path="${auth_file#$BASE_STATE_DIR/}"
    dest_path="$TEST_CONFIG_DIR/$rel_path"
    if [ "$auth_file" = "$dest_path" ]; then
      continue
    fi
    mkdir -p "$(dirname "$dest_path")"
    cp "$auth_file" "$dest_path"
  done < <(find "$BASE_STATE_DIR/agents" -type f -name auth-profiles.json -print0 2>/dev/null)
fi

if [ -d "$BASE_STATE_DIR/credentials" ]; then
  if [ "$BASE_STATE_DIR/credentials" != "$TEST_CONFIG_DIR/credentials" ]; then
  mkdir -p "$TEST_CONFIG_DIR/credentials"
  cp -R "$BASE_STATE_DIR/credentials/." "$TEST_CONFIG_DIR/credentials/" 2>/dev/null || true
  fi
fi

cat > "$TEST_CONFIG" <<EOF
{
  "agents": {
    "defaults": {
      "model": "$TEST_MODEL",
      "workspace": "$TEST_WORKSPACE_DIR"
    },
    "list": [
      {
        "id": "main",
        "default": true,
        "workspace": "$TEST_WORKSPACE_DIR"
      }
    ]
  },
  "plugins": {
    "enabled": true,
    "entries": {
      "learning-loop": {
        "enabled": true,
        "config": {
          "graphiti": {
            "mcpServerUrl": "$GRAPHITI_URL",
            "groupId": "$GRAPHITI_GROUP"
          },
          "evolution": {
            "enabled": true,
            "approvalPolicy": "always_allow",
            "maxEntriesPerRound": 2
          },
          "nudge": {
            "enabled": true,
            "memoryInterval": 5,
            "skillInterval": 5
          },
          "memory": {
            "autoRecall": true,
            "autoCapture": true
          }
        }
      }
    }
  }
}
EOF

echo "==> Test config written to: $TEST_CONFIG"
echo "==> Graphiti MCP: $GRAPHITI_URL"
echo "==> Graph group: $GRAPHITI_GROUP"
echo "==> Test model: $TEST_MODEL"
if [ -f "$BASE_CONFIG_PATH" ]; then
  echo "==> Base config: $BASE_CONFIG_PATH"
fi
echo ""

# ---------------------------------------------------------------------------
# Check Graphiti is reachable
# ---------------------------------------------------------------------------

# MCP uses JSON-RPC POST, not GET — a GET returns 404 which is expected.
# Send a proper MCP initialize request to check health.
echo -n "==> Checking Graphiti MCP server... "
MCP_HEALTH=$(curl -sfL --max-time 5 -X POST \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"openclaw-test","version":"1.0.0"}},"id":1}' \
  "$GRAPHITI_URL" 2>/dev/null) && MCP_OK=1 || MCP_OK=0

if [ "$MCP_OK" = "1" ]; then
  echo "OK"
else
  echo "UNREACHABLE"
  echo ""
  echo "    Graphiti MCP server is not running at $GRAPHITI_URL"
  echo ""
  echo "    Start it with:"
  echo "      ./scripts/start-graphiti.sh --detach"
  echo ""
  echo "    Or set GRAPHITI_URL to point to your running instance."
  echo ""
  echo "    Continuing anyway (plugin will fail lazily on first use)..."
  echo ""
fi

# ---------------------------------------------------------------------------
# Export env for openclaw
# ---------------------------------------------------------------------------

export OPENCLAW_STATE_DIR="$TEST_CONFIG_DIR"
export OPENCLAW_CONFIG_PATH="$TEST_CONFIG"

# ---------------------------------------------------------------------------
# Route subcommand
# ---------------------------------------------------------------------------

case "${1:-agent}" in
  status)
    echo "==> openclaw learning-loop status"
    pnpm dev learning-loop status
    ;;

  search)
    shift
    echo "==> openclaw learning-loop search $*"
    pnpm dev learning-loop search "$@"
    ;;

  evolve)
    shift
    echo "==> openclaw learning-loop evolve $*"
    pnpm dev learning-loop evolve "$@"
    ;;

  solidify)
    shift
    echo "==> openclaw learning-loop solidify $*"
    pnpm dev learning-loop solidify "$@"
    ;;

  pending)
    shift
    echo "==> openclaw learning-loop pending $*"
    pnpm dev learning-loop pending "$@"
    ;;

  agent)
    shift
    if [ $# -gt 0 ]; then
      echo "==> openclaw agent --local --agent main --message \"$*\""
      pnpm dev agent --local --agent main --message "$*"
    else
      DEFAULT_AGENT_MESSAGE="${LEARNING_LOOP_AGENT_MESSAGE:-Reply with exactly LEARNING-LOOP-E2E-OK.}"
      echo "==> openclaw agent --local --agent main --message \"$DEFAULT_AGENT_MESSAGE\""
      pnpm dev agent --local --agent main --message "$DEFAULT_AGENT_MESSAGE"
    fi
    ;;

  config)
    echo "==> Test config:"
    cat "$TEST_CONFIG"
    ;;

  clean)
    echo "==> Cleaning test config at $TEST_CONFIG_DIR"
    rm -rf "$TEST_CONFIG_DIR"
    echo "    Done."
    ;;

  help|--help|-h)
    cat <<HELP
Usage: $0 [command] [args...]

Commands:
  agent [message]     Run the agent (default if no command given)
  status              Show learning-loop plugin status
  search <query>      Search the knowledge graph
  evolve <skill>      Manually evolve a skill
  solidify <skill>    Write pending evolutions to SKILL.md
  pending <skill>     Show pending evolution entries
  config              Print the test config JSON
  clean               Remove the test config directory
  help                Show this help

Environment:
  GRAPHITI_URL        Graphiti MCP server URL (default: http://localhost:8000/mcp)
  GRAPHITI_GROUP      Knowledge graph namespace (default: openclaw_test)
  LEARNING_LOOP_MODEL Model override for agent/evolve tests (default: current config model or openai-codex/gpt-5.4)
  LEARNING_LOOP_BASE_STATE_DIR  Source state dir for auth-profile/credentials copy
  LEARNING_LOOP_BASE_CONFIG_PATH  Source config path used to inherit the default model

Examples:
  $0                                    # embedded-agent smoke test
  $0 agent "Remember that I prefer TypeScript"
  $0 search "user preferences"
  $0 status
  $0 evolve my-skill
  $0 solidify my-skill
HELP
    ;;

  *)
    # Pass through to pnpm dev
    echo "==> pnpm dev $*"
    pnpm dev "$@"
    ;;
esac

---
summary: "Sign in to GitHub Copilot from OpenClaw using the device flow"
read_when:
  - You want to use GitHub Copilot as a model provider
  - You need the `openclaw models auth login-github-copilot` flow
title: "GitHub Copilot"
---

# GitHub Copilot

## What is GitHub Copilot?

GitHub Copilot is GitHub's AI coding assistant. It provides access to Copilot
models for your GitHub account and plan. OpenClaw can use Copilot as a model
provider in two different ways.

## Two ways to use Copilot in OpenClaw

### 1) Built-in GitHub Copilot provider (`github-copilot`)

Use the native device-login flow to obtain a GitHub token, then exchange it for
Copilot API tokens when OpenClaw runs. This is the **default** and simplest path
because it does not require VS Code.

### 2) Copilot Proxy plugin (`copilot-proxy`)

Use the **Copilot Proxy** VS Code extension as a local bridge. OpenClaw talks to
the proxy’s `/v1` endpoint and uses the model list you configure there. Choose
this when you already run Copilot Proxy in VS Code or need to route through it.
You must enable the plugin and keep the VS Code extension running.

Use GitHub Copilot as a model provider (`github-copilot`). The login command runs
the GitHub device flow, saves an auth profile, and updates your config to use that
profile.

## CLI setup

```bash
openclaw models auth login-github-copilot
```

You'll be prompted to visit a URL and enter a one-time code. Keep the terminal
open until it completes.

### Optional flags

```bash
openclaw models auth login-github-copilot --yes
```

To also apply the provider's recommended default model in one step, use the
generic auth command instead:

```bash
openclaw models auth login --provider github-copilot --method device --set-default
```

## Set a default model

```bash
openclaw models set github-copilot/gpt-4o
```

### Config snippet

```json5
{
  agents: { defaults: { model: { primary: "github-copilot/gpt-4o" } } },
}
```

## Memory search embeddings

GitHub Copilot can also serve as an embedding provider for
[memory search](/concepts/memory-search). If you have a Copilot subscription and
have logged in, OpenClaw can use it for embeddings without a separate API key.

### Auto-detection

When `memorySearch.provider` is `"auto"` (the default), GitHub Copilot is tried
at priority 15 -- after local embeddings but before OpenAI and other paid
providers. If a GitHub token is available, OpenClaw discovers available
embedding models from the Copilot API and picks the best one automatically.

### Explicit config

```json5
{
  agents: {
    defaults: {
      memorySearch: {
        provider: "github-copilot",
        // Optional: override the auto-discovered model
        model: "text-embedding-3-small",
      },
    },
  },
}
```

### How it works

1. OpenClaw resolves your GitHub token (from env vars or auth profile).
2. Exchanges it for a short-lived Copilot API token.
3. Queries the Copilot `/models` endpoint to discover available embedding models.
4. Picks the best model (prefers `text-embedding-3-small`).
5. Sends embedding requests to the Copilot `/embeddings` endpoint.

Model availability depends on your GitHub plan. If no embedding models are
available, OpenClaw skips Copilot and tries the next provider.

## Notes

- Requires an interactive TTY; run it directly in a terminal.
- Copilot model availability depends on your plan; if a model is rejected, try
  another ID (for example `github-copilot/gpt-4.1`).
- Claude model IDs use the Anthropic Messages transport automatically; GPT, o-series,
  and Gemini models keep the OpenAI Responses transport.
- The login stores a GitHub token in the auth profile store and exchanges it for a
  Copilot API token when OpenClaw runs.

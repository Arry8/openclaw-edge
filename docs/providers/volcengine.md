---
title: "Volcengine (Doubao)"
summary: "Volcano Engine setup (Doubao models, general + coding endpoints)"
read_when:
  - You want to use Volcano Engine or Doubao models with OpenClaw
  - You need the Volcengine API key setup
---

# Volcengine (Doubao)

The Volcengine provider gives access to Doubao models and third-party models
hosted on Volcano Engine, with separate endpoints for general and coding
workloads.

- Providers: `volcengine` (general) + `volcengine-plan` (coding)
- Auth: `VOLCANO_ENGINE_API_KEY`
- API: OpenAI-compatible

## Quick start

1. Set the API key:

```bash
openclaw onboard --auth-choice volcengine-api-key
```

2. Set a default model:

```json5
{
  agents: {
    defaults: {
      model: { primary: "volcengine-plan/ark-code-latest" },
    },
  },
}
```

## Session caching

Enable session-based response caching via the `cache` and `model.api` parameters. The cache
automatically manages `caching`, `thinking`, and `previous_response_id` fields
for multi-turn conversations:

```json5
{
  models: {
    providers: {
      volcengine: {
        api: "openai-responses",
      },
    },
  },
  agents: {
    defaults: {
      models: {
        "volcengine/doubao-seed-2-0-lite-260215": {
          params: {
            cache: {
              enable: true,
              ttlSec: 7200, // cache TTL in seconds (default: 3600)
              thinking: false, // enable thinking (default: true)
            },
          },
        },
      },
    },
  },
}
```

`cache.enable` must be `true` to activate caching. Other fields are optional
and fall back to defaults (`ttlSec: 3600`, `thinking: true`).

## Non-interactive example

```bash
openclaw onboard --non-interactive \
  --mode local \
  --auth-choice volcengine-api-key \
  --volcengine-api-key "$VOLCANO_ENGINE_API_KEY"
```

## Providers and endpoints

| Provider          | Endpoint                                  | Use case       |
| ----------------- | ----------------------------------------- | -------------- |
| `volcengine`      | `ark.cn-beijing.volces.com/api/v3`        | General models |
| `volcengine-plan` | `ark.cn-beijing.volces.com/api/coding/v3` | Coding models  |

Both providers are configured from a single API key. Setup registers both
automatically.

## Available models

- **doubao-seed-1-8** - Doubao Seed 1.8 (general, default)
- **doubao-seed-code-preview** - Doubao coding model
- **ark-code-latest** - Coding plan default
- **Kimi K2.5** - Moonshot AI via Volcano Engine
- **GLM-4.7** - GLM via Volcano Engine
- **DeepSeek V3.2** - DeepSeek via Volcano Engine

Most models support text + image input. Context windows range from 128K to 256K
tokens.

## Environment note

If the Gateway runs as a daemon (launchd/systemd), make sure
`VOLCANO_ENGINE_API_KEY` is available to that process (for example, in
`~/.openclaw/.env` or via `env.shellEnv`).

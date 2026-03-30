---
summary: "Deploy OpenClaw inside an NVIDIA OpenShell sandbox — network policy, WebSocket proxy, DNS fixes"
read_when:
  - You want to run OpenClaw in an OpenShell sandbox
  - You need sandboxed network and filesystem isolation for your AI agent
  - You hit proxy, WebSocket, or DNS errors in a sandboxed environment
title: "OpenShell Sandbox"
sidebarTitle: "OpenShell"
---

# OpenClaw on OpenShell

Run OpenClaw inside an [NVIDIA OpenShell](https://github.com/NVIDIA/OpenShell)
sandbox for network isolation, filesystem sandboxing, and auditable network
policy. The sandbox runs in a K3s cluster on Docker Desktop and routes all
outbound traffic through an L7 HTTPS CONNECT proxy.

**Why OpenShell?**

- Every outbound connection is policy-controlled and logged
- Filesystem is isolated — `/usr` is read-only, writable paths are explicit
- Network policy is hot-reloadable YAML (no container rebuilds)
- Ideal for running autonomous AI agents with real API keys in a controlled environment

## Prerequisites

| Requirement    | Minimum         | Notes                                 |
| -------------- | --------------- | ------------------------------------- |
| macOS          | 13+ (Ventura)   | Apple Silicon (arm64)                 |
| Docker Desktop | 4.x             | Must be installed; script auto-starts |
| Node.js        | 22.16+          | `node --version` to check             |
| uv             | Latest          | Python package manager for OpenShell  |
| npm            | Bundled w/ Node | For building OpenClaw bundle          |

## Quick start

The [K-Applied-AI/OpenClaw-init](https://github.com/K-Applied-AI/OpenClaw-init)
repo contains an automated setup script and all required config files:

```bash
git clone https://github.com/K-Applied-AI/OpenClaw-init.git
cd OpenClaw-init
./openclaw-openshell-setup.sh
```

The script walks you through Slack app creation, token entry, Docker startup,
sandbox creation, DNS patching, OpenClaw bundling, and gateway launch — with
prompts at each step. Pass `--non-interactive` with flags for CI/automation.

The rest of this page covers manual setup and explains what the script does.

## Manual setup

### 1. Install OpenShell CLI and OpenClaw on the host

```bash
# OpenShell CLI
uv tool install openshell --force
openshell --version   # expect 0.0.15+

# OpenClaw (on host, for bundling — see Step 5 for why)
npm install -g openclaw@latest
openclaw --version
```

### 2. Start Docker and the gateway

```bash
open -a Docker
# Wait for Docker to be ready
while ! docker info > /dev/null 2>&1; do sleep 3; done

openshell gateway start
```

If you get a "corrupted cluster state" error (common after unclean shutdowns):

```bash
openshell gateway destroy --name openshell
openshell gateway start
```

### 3. Create sandbox and apply network policy

```bash
openshell sandbox create --name agent
```

<Note>
First run pulls the base sandbox image, which can take several minutes. The CLI
may time out at 300s but the pull continues in the background. Check with
`openshell sandbox get agent` until Phase shows `Ready`.
</Note>

Apply the network policy (see [Network policy](#network-policy) below):

```bash
openshell policy set agent --policy ~/openclaw-policy.yaml --wait
```

### 4. Fix CoreDNS

The K3s cluster inside Docker uses CoreDNS, which forwards to Docker's internal
DNS resolver at `127.0.0.11`. This resolver cannot resolve external domains from
within the K3s network namespace — all outbound connections fail with
"DNS resolution failed."

Patch CoreDNS to forward to public DNS instead:

```bash
openshell doctor exec -- kubectl patch configmap coredns -n kube-system \
  --type merge -p '{
    "data": {
      "Corefile": ".:53 {\n    errors\n    health\n    ready\n    kubernetes cluster.local in-addr.arpa ip6.arpa {\n      pods insecure\n      fallthrough in-addr.arpa ip6.arpa\n    }\n    hosts /etc/coredns/NodeHosts {\n      ttl 60\n      reload 15s\n      fallthrough\n    }\n    prometheus :9153\n    cache 30\n    loop\n    reload\n    loadbalance\n    forward . 8.8.8.8 8.8.4.4\n}\n"
    }
  }'

openshell doctor exec -- kubectl rollout restart deployment coredns -n kube-system
sleep 10

# Verify
openshell doctor exec -- kubectl exec -n openshell agent -- nslookup registry.npmjs.org
```

<Warning>
This step is required on every fresh `openshell gateway start`. The CoreDNS
configmap resets when the gateway is recreated.
</Warning>

### 5. Bundle OpenClaw from host

Installing OpenClaw via `npm install -g` inside the sandbox is extremely slow
(30+ minutes) because every package dependency creates a separate CONNECT tunnel
through the L7 proxy with full TLS negotiation. With 460+ packages, this
consistently hangs. Upload a pre-built bundle instead:

```bash
# On host
NPM_ROOT=$(npm root -g)
tar czf /tmp/openclaw-bundle.tar.gz -C "$NPM_ROOT" openclaw
```

### 6. Upload and unpack

```bash
# Upload
openshell sandbox upload agent /tmp/openclaw-bundle.tar.gz /tmp

# Connect and unpack
openshell sandbox connect agent
```

Inside the sandbox:

```bash
cd /tmp && tar xzf openclaw-bundle.tar.gz
mkdir -p /sandbox/node_modules
cp -r openclaw /sandbox/node_modules/openclaw
ln -sf /sandbox/node_modules/openclaw/openclaw.mjs /sandbox/openclaw
chmod +x /sandbox/openclaw
export PATH="/sandbox:$PATH"
openclaw --version
```

<Note>
The sandbox filesystem makes `/usr` read-only. Use `/sandbox` and `/tmp` as
writable directories.
</Note>

### 7. Configure Slack

The fastest approach is using an App Manifest (included in the
[OpenClaw-init repo](https://github.com/K-Applied-AI/OpenClaw-init)):

1. Go to [api.slack.com/apps](https://api.slack.com/apps) →
   **Create New App** → **From an app manifest**
2. Paste the manifest YAML (configures all 23 bot scopes, 12 event
   subscriptions, Socket Mode, Interactivity, and App Home)
3. Generate an App-Level Token with `connections:write` scope (`xapp-...`)
4. Install to workspace and copy the Bot Token (`xoxb-...`)

For manual Slack configuration, see the [Slack channel docs](/channels/slack).

### 8. Upload WebSocket proxy patch and start gateway

Upload the WebSocket proxy patch (see [WebSocket proxy patch](#websocket-proxy-patch) below):

```bash
# From host
openshell sandbox upload agent ~/openclaw-ws-proxy-patch.js /sandbox
```

Create `/sandbox/.bashrc` so PATH and the patch persist across sessions:

```bash
cat > /tmp/sandbox-bashrc << 'EOF'
export PATH="/sandbox:$PATH"
export NODE_OPTIONS="--require /sandbox/openclaw-ws-proxy-patch.js"
EOF
openshell sandbox upload agent /tmp/sandbox-bashrc /sandbox/.bashrc
```

Connect and start:

```bash
openshell sandbox connect agent
openclaw onboard          # configure model providers and Slack tokens
openclaw gateway run --allow-unconfigured
```

Look for these three lines to confirm everything works:

```
[ws-proxy-patch] Slack WebSocket proxy active → 10.200.0.1:3128
[ws-proxy-patch] Routing wss://wss-primary.slack.com/link/?ticket=... through proxy
[slack] socket mode connected
```

## Network policy

The sandbox routes all traffic through an HTTPS CONNECT proxy at
`10.200.0.1:3128`. A YAML policy file controls which hosts each binary can
reach.

### Policy structure

```yaml
version: 1

filesystem_policy:
  read_only: [/usr, /lib, /etc, ...]
  read_write: [/sandbox, /tmp]

network_policies:
  slack: # REST API — slack.com, api.slack.com, etc.
    endpoints:
      - host: api.slack.com
        port: 443
        enforcement: enforce
    binaries:
      - { path: /usr/bin/node }

  slack_websocket: # WebSocket — separate policy, tls: skip
    endpoints:
      - host: wss-primary.slack.com
        port: 443
        tls: skip
        enforcement: enforce
    binaries:
      - { path: /usr/bin/node }
```

Key points:

- **Each policy section needs a `binaries` list.** Without it, the proxy cannot
  match the requesting process and denies all CONNECT requests.
- **Hot-reloadable:** Edit the YAML and re-run `openshell policy set`. No
  sandbox restart needed.
- **`enforcement: audit`** logs but allows; **`enforcement: enforce`** blocks
  unauthorized connections.

### Slack REST vs WebSocket split

Slack uses different hosts for REST API calls and WebSocket (Socket Mode)
connections:

| Traffic   | Hosts                                                                                   | Policy key        |
| --------- | --------------------------------------------------------------------------------------- | ----------------- |
| REST API  | `slack.com`, `api.slack.com`, `files.slack.com`, `hooks.slack.com`, `edgeapi.slack.com` | `slack`           |
| WebSocket | `wss-primary.slack.com`, `wss-backup.slack.com`                                         | `slack_websocket` |

The WebSocket policy **must** use `tls: skip` to force raw TCP passthrough. Without
it, the L7 proxy intercepts the WebSocket upgrade handshake and breaks the frame
stream.

<Warning>
Do **not** use `*.slack.com` as a wildcard. On OpenShell 0.0.15+, a wildcard
Slack policy overrides the `slack_websocket` entry and breaks Socket Mode. List
each Slack host individually.
</Warning>

<Warning>
Do **not** use TLD wildcards like `*.com` or `*.org`. They cause OPA
"duplicated variable" errors across policy sections.
</Warning>

## WebSocket proxy patch

### The problem

The `ws` library (used by Slack's `@slack/socket-mode` package and Discord's
`discord.js`) does not honor the `HTTPS_PROXY` environment variable. Inside the
sandbox, all traffic must go through the proxy — but WebSocket connections
attempt direct connections to `wss-primary.slack.com`, which the sandbox's
network namespace blocks.

### The solution

A Node.js preload script monkey-patches the `ws` WebSocket constructor to tunnel
connections through the CONNECT proxy:

```bash
export NODE_OPTIONS="--require /sandbox/openclaw-ws-proxy-patch.js"
```

How it works:

1. Reads `HTTPS_PROXY` from the environment (set automatically by the sandbox
   to `http://10.200.0.1:3128`)
2. Creates a custom `https.Agent` that establishes CONNECT tunnels through the proxy
3. Intercepts `ws` module loads via `Module._load` and wraps the WebSocket
   constructor
4. For `wss://wss-primary.slack.com` or `wss://wss-backup.slack.com`
   connections, injects the proxy agent
5. All other WebSocket connections pass through unmodified

<Note>
This patch also applies to Discord gateway connections (`wss://gateway.discord.gg`).
If using Discord as a channel, add the Discord WebSocket hosts to your network
policy with `tls: skip` and update the patch to match those hosts.
</Note>

The full patch source is in the
[OpenClaw-init repo](https://github.com/K-Applied-AI/OpenClaw-init/blob/main/openclaw-ws-proxy-patch.js).

## Troubleshooting

### DNS failures

**Symptom:** Proxy logs show `CONNECT blocked: internal address ... reason=DNS resolution failed`

**Fix:** Re-apply the CoreDNS patch ([Step 4](#4-fix-coredns)). Required after
every `openshell gateway start --recreate`.

```bash
openshell logs agent --level warn --since 5m
```

### WebSocket not connecting

**Symptom:** `[slack] socket mode connected` never appears.

Check:

1. `[ws-proxy-patch] Slack WebSocket proxy active` appears at startup
2. No `*.slack.com` wildcard in policy
3. `slack_websocket` policy has `tls: skip` on both `wss-primary.slack.com` and
   `wss-backup.slack.com`

### Bot connects but ignores DMs

Check your Slack app:

1. `message.im` event is subscribed
2. App Home → Messages Tab is enabled
3. App was **reinstalled** after adding scopes or events

### npm install hangs inside sandbox

Use the host-bundle approach ([Step 5](#5-bundle-openclaw-from-host)). If you
must use npm directly, expect 30+ minutes due to per-connection proxy overhead.

### Gateway corrupted state

```bash
openshell gateway destroy --name openshell
openshell gateway start
```

### `tls: terminate` deprecation warnings

These come from the base sandbox image's default policy, not your custom policy.
TLS termination is automatic in v0.0.15. Safe to ignore.

## Known limitations

- **`web_fetch` / `web_search` proxy issues** — The sandbox's CONNECT proxy
  may interfere with some HTTP client libraries used by OpenClaw tools. Fetching
  arbitrary URLs requires per-host policy entries. See
  [#49948](https://github.com/openclaw/openclaw/issues/49948) and
  [#46306](https://github.com/openclaw/openclaw/issues/46306).

- **Binary identification** — Each network policy section requires explicit
  binary paths in the `binaries` list. The proxy uses process identification to
  match policies. If a binary is not listed, its connections are denied even if
  the host is allowed. The automated setup script resolves binary paths via
  `which` inside the sandbox.

- **macOS only** — OpenShell currently requires macOS 13+ on Apple Silicon.
  Linux and Windows support is not yet available.

- **CoreDNS resets on gateway recreate** — The DNS fix must be reapplied after
  every `openshell gateway start --recreate` or fresh gateway start.

## Related

- [OpenShell plugin configuration](/gateway/openshell) — Using OpenShell as a
  managed sandbox backend
- [Sandboxing overview](/gateway/sandboxing) — OpenClaw's sandboxing architecture
- [Slack channel setup](/channels/slack) — Slack integration docs
- [Network model](/gateway/network-model) — Gateway networking fundamentals

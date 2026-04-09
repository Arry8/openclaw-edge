---
name: multi-device-agentic-mesh
description: Coordinate OpenClaw tasks across multiple devices/nodes with deterministic routing, failover, and handoff rules. Use when users run OpenClaw on laptop/desktop/VPS combinations and need resilient cross-device execution.
---

# Multi-Device Agentic Mesh

Coordinate work across multiple OpenClaw nodes safely.

## Baseline discovery

Start with node and session visibility checks:

```bash
openclaw status
openclaw nodes list
openclaw sessions list
```

If a command is unavailable in a deployment, use the nearest supported status/list command.

## Build a routing table

Classify each node/device by:

- trust level (high/medium/low)
- latency/availability
- tool access and capabilities
- data sensitivity suitability

Use this table to route tasks to the best node.

## Routing policy

Apply these defaults:

1. Send sensitive tasks to highest-trust local node.
2. Send long-running/background tasks to stable always-on node.
3. Keep user-facing replies near the active user channel/session.

## Failover

If a primary node fails:

1. retry once
2. reroute to secondary node
3. report failover event and degraded mode

Never hide failover from the user.

## Session handoff

When moving work across devices:

- summarize current state
- include pending actions
- include exact next command/message
- confirm handoff destination

## Guardrails

- Do not route sensitive data to untrusted nodes.
- Ask before changing long-lived routing defaults.
- Keep decisions auditable (what was routed where and why).

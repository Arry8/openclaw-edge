---
name: mesh-policy-enforcer
description: Enforce trust, routing, and tool-usage policy in multi-device OpenClaw setups. Use when users need per-device guardrails, sensitive-task pinning, emergency isolation, or policy-driven task placement.
---

# Mesh Policy Enforcer

Apply explicit policy controls to multi-device orchestration.

## Define policy profile

Capture policy as simple rules:

- trusted devices list
- disallowed devices for sensitive tasks
- allowed tools per device class
- escalation targets for policy violations

## Policy checks before execution

Before dispatching a task, verify:

1. destination device trust level
2. task sensitivity label
3. required tools allowed on destination
4. channel/session exposure constraints

If any check fails, block dispatch and report the reason.

## Sensitive-task pinning

Pin high-sensitivity operations to approved nodes only.

Examples:

- credentials/secrets operations
- finance/payment actions
- external messaging actions

## Emergency isolation

When a node is suspicious/unhealthy:

1. stop routing new tasks to it
2. revoke or rotate related access if applicable
3. route pending work to fallback nodes
4. notify user with impact summary

## Audit output

For each blocked/rerouted task, record:

- policy rule triggered
- original destination
- final action (blocked/rerouted)
- user-visible next step

## Guardrails

- Favor deny-by-default for unknown devices.
- Do not silently downgrade policy strictness.
- Require explicit approval for permanent policy changes.

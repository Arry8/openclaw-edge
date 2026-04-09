---
name: ai-observability-audit
description: Create auditable AI operation summaries with run metadata, decision traces, and anomaly signals. Use when users ask for AI observability, periodic audit reports, incident reconstruction, or compliance-style activity tracking.
---

# AI Observability & Audit

Produce concise, consistent operational audit outputs.

## Core audit fields

For each meaningful run/event, capture:

- timestamp
- actor/session
- task intent
- tools/actions executed
- result status (success/failure/partial)
- risk level

Never include secrets/tokens in logs.

## Decision trace summary

When relevant, include:

- key decisions made
- why a path was chosen
- alternatives rejected (brief)
- approvals requested/granted/denied

Keep traces concise and human-readable.

## Anomaly checks

Flag unusual patterns such as:

- repeated failures of same command
- sudden spike in privileged/destructive actions
- routing to unusual devices/nodes
- unexpected external-action attempts

## Audit cadence

Support periodic reports (daily/weekly) with:

- counts by action type
- high-risk actions summary
- failure clusters and top causes
- remediation recommendations

## Incident reconstruction

For incidents, provide a timeline:

1. trigger event
2. sequence of actions
3. impact
4. recovery steps
5. preventive controls

## Guardrails

- Prefer structured summaries over raw log dumps.
- Redact sensitive identifiers when sharing broadly.
- Never claim certainty when evidence is incomplete.

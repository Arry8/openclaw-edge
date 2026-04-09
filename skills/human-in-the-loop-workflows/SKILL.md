---
name: human-in-the-loop-workflows
description: Implement approval-gated workflows for risky or irreversible actions. Use when users need plan-preview-approve execution, escalation on ambiguity, and clear checkpoints before changes are applied.
---

# Human-in-the-Loop Workflows

Use explicit approval gates for sensitive actions.

## Standard HITL pattern

Run this sequence:

1. Plan
2. Preview impact
3. Request approval
4. Execute approved step
5. Verify outcome
6. Summarize results

## Require approvals for

- destructive file/system changes
- external communications/actions
- privilege/access changes
- cost-impacting operations
- policy/security changes

## Approval request format

Keep approvals easy to answer:

- action
- exact command(s)
- expected impact
- rollback option
- reply choices (Approve / Revise / Cancel)

## Ambiguity handling

If user intent is unclear:

- pause execution
- ask one focused clarification
- do not guess on high-risk actions

## Batch approvals

For multiple related steps:

- group low-risk steps together
- isolate high-risk steps into separate approvals
- include checkpoint after each high-risk step

## Verification

After execution, report:

- what changed
- what was skipped
- evidence of success/failure
- recommended next step

## Guardrails

- No approval bypass.
- No hidden side-effects outside approved scope.
- Stop immediately on unexpected output and re-confirm.

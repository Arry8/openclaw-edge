# Checkpoint Manager Reference

The `checkpoint_manager.py` script handles SPARSE and FULL checkpoint triggers with Circuit Breaker protection for the session-persistence skill.

## Trigger Logic

### SPARSE Checkpoint

Fires when **both** conditions are met:

- **Time gate**: ≥ 5 minutes since last SPARSE checkpoint
- **Round gate**: ≥ 5 messages since last SPARSE checkpoint

Call `increment` after each message, then `check-sparse` to evaluate.

### FULL Checkpoint

Fires on demand for any of:

- Heartbeat (scheduled)
- End of a tool-chain sequence
- A major architectural decision

Call `check-full --heartbeat` from your HEARTBEAT.md routine.

## Circuit Breaker

Protects against repeated failures that could corrupt the checkpoint file.

| State | Condition | Effect |
|-------|-----------|--------|
| Normal | `consecutiveFailures` < 3 | All writes proceed |
| Degraded | `consecutiveFailures` ≥ 3 | All writes suspended |

To recover from degraded mode:

```bash
python3 {baseDir}/scripts/checkpoint_manager.py reset
```

## State File (`state.json`)

Located at `skills/session-persistence/state.json`:

```json
{
  "rounds": 0,
  "lastSparseTime": "2026-04-03T23:00:00+00:00",
  "lastFullTime": "2026-04-03T22:00:00+00:00",
  "consecutiveFailures": 0,
  "degraded": false
}
```

## Commands

| Command | Description |
|---------|-------------|
| `increment` | Increment message round counter |
| `check-sparse` | Evaluate and trigger SPARSE if conditions met |
| `check-full [--heartbeat]` | Force FULL checkpoint |
| `status` | Print current state.json |
| `reset` | Reset Circuit Breaker (clear degraded flag) |

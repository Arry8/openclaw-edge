// ============================================================================
// Evolution Schema
//
// Data models for skill evolution entries, changes, and persistence format.
// ============================================================================

import { randomUUID } from "node:crypto";
import type { SignalType } from "./signal-detector.js";

// ============================================================================
// Types
// ============================================================================

export type EvolutionTarget = "description" | "body";

export type EvolutionAction = "append" | "replace" | "skip";

export type EvolutionChange = {
  /** Target section in SKILL.md */
  section: "Instructions" | "Examples" | "Troubleshooting";
  /** What to do with the content */
  action: EvolutionAction;
  /** Markdown content to inject */
  content: string;
  /** Whether this targets skill description (prompt metadata) or body (SKILL.md) */
  target: EvolutionTarget;
  /** Reason for skipping (when action is "skip") */
  skipReason?: "irrelevant" | "duplicate" | "low_priority";
  /** ID or 0-based index of the existing entry to replace (for dedup merges) */
  mergeTarget?: string;
};

export type EvolutionEntry = {
  /** Unique identifier (ev_xxxxxxxx) */
  id: string;
  /** Signal source that triggered this evolution */
  source: SignalType;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Summary of the triggering signal */
  context: string;
  /** The actual change to apply */
  change: EvolutionChange;
  /** Whether this entry has been solidified into SKILL.md */
  applied: boolean;
};

export type EvolutionFile = {
  skillId: string;
  version: string;
  updatedAt: string;
  entries: EvolutionEntry[];
};

// ============================================================================
// Factories
// ============================================================================

export function createEvolutionEntry(
  source: SignalType,
  context: string,
  change: EvolutionChange,
): EvolutionEntry {
  return {
    id: `ev_${randomUUID().slice(0, 8)}`,
    source,
    timestamp: new Date().toISOString(),
    context,
    change,
    applied: false,
  };
}

export function createEmptyEvolutionFile(skillId: string): EvolutionFile {
  return {
    skillId,
    version: "1.0.0",
    updatedAt: new Date().toISOString(),
    entries: [],
  };
}

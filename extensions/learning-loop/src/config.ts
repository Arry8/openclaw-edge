// ============================================================================
// Learning Loop Plugin Configuration
// ============================================================================

export type GraphitiConfig = {
  mcpServerUrl: string;
  groupId: string;
};

export type EvolutionConfig = {
  enabled: boolean;
  approvalPolicy: "always_allow" | "ask";
  maxEntriesPerRound: number;
};

export type NudgeConfig = {
  enabled: boolean;
  memoryInterval: number;
  skillInterval: number;
};

export type MemoryConfig = {
  autoRecall: boolean;
  autoCapture: boolean;
};

export type LearningLoopConfig = {
  graphiti: GraphitiConfig;
  evolution: EvolutionConfig;
  nudge: NudgeConfig;
  memory: MemoryConfig;
};

const DEFAULTS = {
  groupId: "openclaw_default",
  evolutionEnabled: true,
  approvalPolicy: "always_allow" as const,
  maxEntriesPerRound: 2,
  nudgeEnabled: true,
  memoryInterval: 10,
  skillInterval: 10,
  autoRecall: true,
  autoCapture: true,
};

function assertAllowedKeys(value: Record<string, unknown>, allowed: string[], label: string) {
  const extra = Object.keys(value).filter((k) => !allowed.includes(k));
  if (extra.length > 0) {
    throw new Error(`${label} has unknown keys: ${extra.join(", ")}`);
  }
}

export function normalizeGraphitiGroupId(raw: string | undefined): string {
  const normalized = (raw ?? DEFAULTS.groupId)
    .trim()
    .replace(/[^a-zA-Z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
  return normalized || DEFAULTS.groupId;
}

export const learningLoopConfigSchema = {
  parse(value: unknown): LearningLoopConfig {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("learning-loop config required");
    }
    const cfg = value as Record<string, unknown>;
    assertAllowedKeys(cfg, ["graphiti", "evolution", "nudge", "memory"], "learning-loop config");

    // Graphiti config (required)
    const graphiti = cfg.graphiti as Record<string, unknown> | undefined;
    if (!graphiti || typeof graphiti.mcpServerUrl !== "string") {
      throw new Error("graphiti.mcpServerUrl is required");
    }
    assertAllowedKeys(graphiti, ["mcpServerUrl", "groupId"], "graphiti config");

    // Evolution config (optional)
    const evolution = (cfg.evolution as Record<string, unknown>) ?? {};
    assertAllowedKeys(
      evolution,
      ["enabled", "approvalPolicy", "maxEntriesPerRound"],
      "evolution config",
    );

    const approvalPolicy =
      typeof evolution.approvalPolicy === "string"
        ? (evolution.approvalPolicy as "always_allow" | "ask")
        : DEFAULTS.approvalPolicy;
    if (approvalPolicy !== "always_allow" && approvalPolicy !== "ask") {
      throw new Error('evolution.approvalPolicy must be "always_allow" or "ask"');
    }

    const maxEntries =
      typeof evolution.maxEntriesPerRound === "number"
        ? Math.floor(evolution.maxEntriesPerRound)
        : DEFAULTS.maxEntriesPerRound;
    if (maxEntries < 1 || maxEntries > 5) {
      throw new Error("evolution.maxEntriesPerRound must be between 1 and 5");
    }

    // Nudge config (optional)
    const nudge = (cfg.nudge as Record<string, unknown>) ?? {};
    assertAllowedKeys(nudge, ["enabled", "memoryInterval", "skillInterval"], "nudge config");

    const memoryInterval =
      typeof nudge.memoryInterval === "number"
        ? Math.floor(nudge.memoryInterval)
        : DEFAULTS.memoryInterval;
    const skillInterval =
      typeof nudge.skillInterval === "number"
        ? Math.floor(nudge.skillInterval)
        : DEFAULTS.skillInterval;

    // Memory config (optional)
    const memory = (cfg.memory as Record<string, unknown>) ?? {};
    assertAllowedKeys(memory, ["autoRecall", "autoCapture"], "memory config");

    return {
      graphiti: {
        mcpServerUrl: graphiti.mcpServerUrl as string,
        groupId: normalizeGraphitiGroupId(
          typeof graphiti.groupId === "string" ? graphiti.groupId : undefined,
        ),
      },
      evolution: {
        enabled: evolution.enabled !== false && DEFAULTS.evolutionEnabled,
        approvalPolicy,
        maxEntriesPerRound: maxEntries,
      },
      nudge: {
        enabled: nudge.enabled !== false && DEFAULTS.nudgeEnabled,
        memoryInterval,
        skillInterval,
      },
      memory: {
        autoRecall: memory.autoRecall !== false && DEFAULTS.autoRecall,
        autoCapture: memory.autoCapture !== false && DEFAULTS.autoCapture,
      },
    };
  },
};

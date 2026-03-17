import { describe, expect, it } from "vitest";
import {
  normalizeVoiceWakeRoutingConfig,
  normalizeVoiceWakeTriggerWord,
  resolveVoiceWakeRouteByTrigger,
} from "./voicewake-routing.js";

describe("voicewake routing normalization", () => {
  it("normalizes punctuation-heavy triggers to token-equivalent spacing", () => {
    expect(normalizeVoiceWakeTriggerWord("  Hey,   Bot!!  ")).toBe("hey bot");
  });

  it("normalizes agentId targets before persisting routes", () => {
    const normalized = normalizeVoiceWakeRoutingConfig({
      defaultTarget: { mode: "current" },
      routes: [{ trigger: "Wake", target: { agentId: " Main Agent " } }],
    });
    expect(normalized.routes).toHaveLength(1);
    expect(normalized.routes[0]?.target).toEqual({ agentId: "main-agent" });
  });

  it("resolves trigger routing with punctuation-insensitive trigger values", () => {
    const config = normalizeVoiceWakeRoutingConfig({
      defaultTarget: { mode: "current" },
      routes: [{ trigger: "Hey, Bot", target: { sessionKey: "agent:main:voice" } }],
    });
    expect(resolveVoiceWakeRouteByTrigger({ trigger: "hey bot", config })).toEqual({
      sessionKey: "agent:main:voice",
    });
  });
});

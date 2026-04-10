import { describe, expect, it } from "vitest";

import { buildSkillInvocationPrompt } from "./get-reply-inline-actions.js";

describe("buildSkillInvocationPrompt", () => {
  it("keeps ordinary skills as a simple skill invocation prompt", () => {
    const prompt = buildSkillInvocationPrompt("notebooklm", "list notebooks");
    expect(prompt).toContain('Use the "notebooklm" skill for this request.');
    expect(prompt).toContain("User input:\nlist notebooks");
    expect(prompt).not.toContain("activate-adopted-orchestrator");
  });

  it("hardens cli-orchestrator with mandatory adopted orchestrator activation instructions", () => {
    const prompt = buildSkillInvocationPrompt("cli-orchestrator", "开启编排模式并继续做任务");
    expect(prompt).toContain('Use the "cli-orchestrator" skill for this request.');
    expect(prompt).toContain("orchestration_role=self_orchestrator");
    expect(prompt).toContain("/api/conversations/activate-adopted-orchestrator");
    expect(prompt).toContain("must first activate the current visible CLI session");
    expect(prompt).toContain("TMUX_PANE");
  });

  it("requires clarification for ambiguous orchestration requests", () => {
    const prompt = buildSkillInvocationPrompt("cli-orchestrator", "开启编排模式");
    expect(prompt).toContain("orchestration_role=self_orchestrator");
    expect(prompt).toContain("If the user did not explicitly say whether to use supervisor or self_orchestrator, ask one clarification question before choosing a mode.");
    expect(prompt).toContain('Ask whether they want "/orchestrate" (supervisor) or "/orchestrate-self" (self_orchestrator).');
  });
});

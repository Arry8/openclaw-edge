import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../runtime-api.js";
import { msteamsPlugin } from "./channel.js";

function getDescribedActions(cfg: OpenClawConfig): string[] {
  return [...(msteamsPlugin.actions?.describeMessageTool?.({ cfg })?.actions ?? [])];
}

describe("msteamsPlugin actions", () => {
  const enabledCfg = {
    channels: {
      msteams: {
        enabled: true,
        appId: "test-app-id",
        appPassword: "test-secret",
        tenantId: "tenant-id",
      },
    },
  } as unknown as OpenClawConfig;

  const disabledCfg = {
    channels: {},
  } as unknown as OpenClawConfig;

  it("does not advertise react (requires Delegated auth, not yet supported)", () => {
    const actions = getDescribedActions(enabledCfg);
    expect(actions).not.toContain("react");
    expect(actions).not.toContain("reactions");
  });

  it("advertises poll when enabled and configured", () => {
    const actions = getDescribedActions(enabledCfg);
    expect(actions).toContain("poll");
  });

  it("returns empty actions when channel is not configured", () => {
    const actions = getDescribedActions(disabledCfg);
    expect(actions).toEqual([]);
  });

  it("returns a deterministic auth-mode error when react is invoked", async () => {
    const result = await msteamsPlugin.actions?.handleAction?.({
      action: "react",
      params: { to: "19:abc@thread.tacv2", messageId: "msg-1", emoji: "like" },
      cfg: enabledCfg,
      accountId: undefined,
      toolContext: {},
    } as never);

    expect(result).toBeDefined();
    expect((result as { isError?: boolean })?.isError).toBe(true);
    const text = (result as { content: Array<{ text: string }> })?.content?.[0]?.text ?? "";
    expect(text).toContain("Delegated permissions");
    expect(text).toContain("client_credentials");
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import type { MsgContext } from "../auto-reply/templating.js";
import type { OpenClawConfig } from "../config/config.js";

// Mock runner and format dependencies.
vi.mock("./runner.js", () => ({
  runLinkUnderstanding: vi.fn(),
}));

vi.mock("./format.js", async () => {
  const actual = await vi.importActual<typeof import("./format.js")>("./format.js");
  return { ...actual };
});

vi.mock("../auto-reply/reply/inbound-context.js", () => ({
  finalizeInboundContext: vi.fn(),
}));

import { finalizeInboundContext } from "../auto-reply/reply/inbound-context.js";
import { applyLinkUnderstanding } from "./apply.js";
import { runLinkUnderstanding } from "./runner.js";

const mockRunLinkUnderstanding = vi.mocked(runLinkUnderstanding);
const mockFinalizeInboundContext = vi.mocked(finalizeInboundContext);

function makeCtx(overrides?: Partial<MsgContext>): MsgContext {
  return {
    Body: "check https://example.com",
    SessionKey: "test-session",
    ...overrides,
  };
}

function makeCfg(): OpenClawConfig {
  return {
    tools: {
      links: { enabled: true, models: [{ command: "curl", args: ["{{LinkUrl}}"] }] },
    },
  } as OpenClawConfig;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("applyLinkUnderstanding", () => {
  it("returns result with no side effects when outputs is empty", async () => {
    mockRunLinkUnderstanding.mockResolvedValue({ urls: ["https://example.com"], outputs: [] });
    const ctx = makeCtx();
    const originalBody = ctx.Body;
    const result = await applyLinkUnderstanding({ ctx, cfg: makeCfg() });

    expect(result).toEqual({ urls: ["https://example.com"], outputs: [] });
    expect(ctx.Body).toBe(originalBody);
    expect(ctx.LinkUnderstanding).toBeUndefined();
    expect(mockFinalizeInboundContext).not.toHaveBeenCalled();
  });

  it("updates ctx.Body and ctx.LinkUnderstanding when outputs are present", async () => {
    mockRunLinkUnderstanding.mockResolvedValue({
      urls: ["https://example.com"],
      outputs: ["summary of page"],
    });
    const ctx = makeCtx({ Body: "check https://example.com" });
    const result = await applyLinkUnderstanding({ ctx, cfg: makeCfg() });

    expect(result.outputs).toEqual(["summary of page"]);
    expect(ctx.LinkUnderstanding).toEqual(["summary of page"]);
    expect(ctx.Body).toBe("check https://example.com\n\nsummary of page");
  });

  it("appends to existing LinkUnderstanding array", async () => {
    mockRunLinkUnderstanding.mockResolvedValue({
      urls: ["https://b.com"],
      outputs: ["new output"],
    });
    const ctx = makeCtx({ LinkUnderstanding: ["existing output"] });
    await applyLinkUnderstanding({ ctx, cfg: makeCfg() });

    expect(ctx.LinkUnderstanding).toEqual(["existing output", "new output"]);
  });

  it("calls finalizeInboundContext with forceBody flags when outputs exist", async () => {
    mockRunLinkUnderstanding.mockResolvedValue({
      urls: ["https://example.com"],
      outputs: ["summary"],
    });
    const ctx = makeCtx();
    await applyLinkUnderstanding({ ctx, cfg: makeCfg() });

    expect(mockFinalizeInboundContext).toHaveBeenCalledWith(ctx, {
      forceBodyForAgent: true,
      forceBodyForCommands: true,
    });
  });

  it("handles multiple outputs correctly", async () => {
    mockRunLinkUnderstanding.mockResolvedValue({
      urls: ["https://a.com", "https://b.com"],
      outputs: ["first summary", "second summary"],
    });
    const ctx = makeCtx({ Body: "links" });
    await applyLinkUnderstanding({ ctx, cfg: makeCfg() });

    expect(ctx.LinkUnderstanding).toEqual(["first summary", "second summary"]);
    expect(ctx.Body).toBe("links\n\nfirst summary\nsecond summary");
  });

  it("passes cfg and ctx to runLinkUnderstanding", async () => {
    mockRunLinkUnderstanding.mockResolvedValue({ urls: [], outputs: [] });
    const ctx = makeCtx();
    const cfg = makeCfg();
    await applyLinkUnderstanding({ ctx, cfg });

    expect(mockRunLinkUnderstanding).toHaveBeenCalledWith({ cfg, ctx });
  });
});

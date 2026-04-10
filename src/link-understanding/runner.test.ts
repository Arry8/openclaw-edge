import { afterEach, describe, expect, it, vi } from "vitest";
import type { MsgContext } from "../auto-reply/templating.js";
import type { OpenClawConfig } from "../config/config.js";
import type { LinkModelConfig, LinkToolsConfig } from "../config/types.tools.js";

// Mock external dependencies.
vi.mock("../process/exec.js", () => ({
  runExec: vi.fn(),
}));

vi.mock("../globals.js", () => ({
  logVerbose: vi.fn(),
  shouldLogVerbose: vi.fn().mockReturnValue(false),
}));

vi.mock("../media-understanding/scope.js", () => ({
  resolveMediaUnderstandingScope: vi.fn().mockReturnValue("allow"),
  normalizeMediaUnderstandingChatType: vi.fn().mockReturnValue(undefined),
}));

// Use the real resolve for timeout logic.
vi.mock("../media-understanding/resolve.js", async () => {
  const actual = await vi.importActual<typeof import("../media-understanding/resolve.js")>(
    "../media-understanding/resolve.js",
  );
  return { ...actual };
});

// Use the real templating module.
vi.mock("../auto-reply/templating.js", async () => {
  const actual = await vi.importActual<typeof import("../auto-reply/templating.js")>(
    "../auto-reply/templating.js",
  );
  return { ...actual };
});

import { shouldLogVerbose } from "../globals.js";
import { resolveMediaUnderstandingScope } from "../media-understanding/scope.js";
import { runExec } from "../process/exec.js";
import { runLinkUnderstanding } from "./runner.js";

const mockRunExec = vi.mocked(runExec);
const mockShouldLogVerbose = vi.mocked(shouldLogVerbose);
const mockResolveScope = vi.mocked(resolveMediaUnderstandingScope);

function makeCtx(overrides?: Partial<MsgContext>): MsgContext {
  return {
    Body: "check https://example.com",
    SessionKey: "test-session",
    ...overrides,
  };
}

function makeCfg(linksCfg?: LinkToolsConfig): OpenClawConfig {
  return {
    tools: {
      links: linksCfg,
    },
  } as OpenClawConfig;
}

function makeCliEntry(overrides?: Partial<LinkModelConfig>): LinkModelConfig {
  return {
    type: "cli",
    command: "curl",
    args: ["{{LinkUrl}}"],
    ...overrides,
  };
}

afterEach(() => {
  vi.clearAllMocks();
  mockResolveScope.mockReturnValue("allow");
  mockShouldLogVerbose.mockReturnValue(false);
});

describe("runLinkUnderstanding", () => {
  // ── Config gating ──────────────────────────────────────────────────

  describe("config gating", () => {
    it("returns empty result when tools.links is undefined", async () => {
      const result = await runLinkUnderstanding({
        cfg: { tools: {} } as OpenClawConfig,
        ctx: makeCtx(),
      });
      expect(result).toEqual({ urls: [], outputs: [] });
    });

    it("returns empty result when links config enabled is false", async () => {
      const result = await runLinkUnderstanding({
        cfg: makeCfg({ enabled: false }),
        ctx: makeCtx(),
      });
      expect(result).toEqual({ urls: [], outputs: [] });
    });

    it("returns empty result when scope decision is deny", async () => {
      mockResolveScope.mockReturnValue("deny");
      const result = await runLinkUnderstanding({
        cfg: makeCfg({ enabled: true, models: [makeCliEntry()] }),
        ctx: makeCtx(),
      });
      expect(result).toEqual({ urls: [], outputs: [] });
    });
  });

  // ── Message / URL extraction ───────────────────────────────────────

  describe("URL extraction", () => {
    it("returns empty result when message has no links", async () => {
      const result = await runLinkUnderstanding({
        cfg: makeCfg({ enabled: true, models: [makeCliEntry()] }),
        ctx: makeCtx({ Body: "no links here" }),
      });
      expect(result).toEqual({ urls: [], outputs: [] });
    });

    it("uses explicit message param over context Body", async () => {
      mockRunExec.mockResolvedValue({ stdout: "output", stderr: "" });
      const result = await runLinkUnderstanding({
        cfg: makeCfg({ enabled: true, models: [makeCliEntry()] }),
        ctx: makeCtx({ Body: "https://ignored.com" }),
        message: "see https://override.com",
      });
      expect(result.urls).toEqual(["https://override.com"]);
    });

    it("falls back to CommandBody when message is undefined", async () => {
      mockRunExec.mockResolvedValue({ stdout: "output", stderr: "" });
      const result = await runLinkUnderstanding({
        cfg: makeCfg({ enabled: true, models: [makeCliEntry()] }),
        ctx: makeCtx({ Body: undefined, CommandBody: "see https://cmd.com" }),
      });
      expect(result.urls).toEqual(["https://cmd.com"]);
    });

    it("falls back to RawBody when CommandBody is undefined", async () => {
      mockRunExec.mockResolvedValue({ stdout: "output", stderr: "" });
      const result = await runLinkUnderstanding({
        cfg: makeCfg({ enabled: true, models: [makeCliEntry()] }),
        ctx: makeCtx({ Body: undefined, CommandBody: undefined, RawBody: "see https://raw.com" }),
      });
      expect(result.urls).toEqual(["https://raw.com"]);
    });

    it("respects maxLinks from config", async () => {
      mockRunExec.mockResolvedValue({ stdout: "output", stderr: "" });
      const result = await runLinkUnderstanding({
        cfg: makeCfg({ enabled: true, maxLinks: 1, models: [makeCliEntry()] }),
        ctx: makeCtx({ Body: "https://a.com https://b.com https://c.com" }),
      });
      expect(result.urls).toEqual(["https://a.com"]);
    });

    it("returns URLs with empty outputs when no model entries are configured", async () => {
      const result = await runLinkUnderstanding({
        cfg: makeCfg({ enabled: true, models: [] }),
        ctx: makeCtx({ Body: "see https://example.com" }),
      });
      expect(result).toEqual({ urls: ["https://example.com"], outputs: [] });
    });

    it("returns URLs with empty outputs when models key is missing", async () => {
      const result = await runLinkUnderstanding({
        cfg: makeCfg({ enabled: true }),
        ctx: makeCtx({ Body: "see https://example.com" }),
      });
      expect(result).toEqual({ urls: ["https://example.com"], outputs: [] });
    });
  });

  // ── CLI entry execution ────────────────────────────────────────────

  describe("CLI entry execution", () => {
    it("invokes runExec with correct command and templated args", async () => {
      mockRunExec.mockResolvedValue({ stdout: "page summary", stderr: "" });
      const result = await runLinkUnderstanding({
        cfg: makeCfg({ enabled: true, models: [makeCliEntry()] }),
        ctx: makeCtx({ Body: "https://example.com" }),
      });
      expect(result.outputs).toEqual(["page summary"]);
      expect(mockRunExec).toHaveBeenCalledWith("curl", ["https://example.com"], expect.any(Object));
    });

    it("passes timeout from entry config", async () => {
      mockRunExec.mockResolvedValue({ stdout: "ok", stderr: "" });
      await runLinkUnderstanding({
        cfg: makeCfg({ enabled: true, models: [makeCliEntry({ timeoutSeconds: 10 })] }),
        ctx: makeCtx({ Body: "https://example.com" }),
      });
      const callOpts = mockRunExec.mock.calls[0]?.[2];
      expect(callOpts).toMatchObject({ timeoutMs: 10_000 });
    });

    it("uses global link timeout when entry timeout is not set", async () => {
      mockRunExec.mockResolvedValue({ stdout: "ok", stderr: "" });
      await runLinkUnderstanding({
        cfg: makeCfg({ enabled: true, timeoutSeconds: 15, models: [makeCliEntry()] }),
        ctx: makeCtx({ Body: "https://example.com" }),
      });
      const callOpts = mockRunExec.mock.calls[0]?.[2];
      expect(callOpts).toMatchObject({ timeoutMs: 15_000 });
    });

    it("falls back to DEFAULT_LINK_TIMEOUT_SECONDS (30s) when no timeout configured", async () => {
      mockRunExec.mockResolvedValue({ stdout: "ok", stderr: "" });
      await runLinkUnderstanding({
        cfg: makeCfg({ enabled: true, models: [makeCliEntry()] }),
        ctx: makeCtx({ Body: "https://example.com" }),
      });
      const callOpts = mockRunExec.mock.calls[0]?.[2];
      expect(callOpts).toMatchObject({ timeoutMs: 30_000 });
    });

    it("skips entry when command is empty/whitespace", async () => {
      const result = await runLinkUnderstanding({
        cfg: makeCfg({ enabled: true, models: [makeCliEntry({ command: "   " })] }),
        ctx: makeCtx({ Body: "https://example.com" }),
      });
      expect(result.urls).toEqual(["https://example.com"]);
      expect(result.outputs).toEqual([]);
      expect(mockRunExec).not.toHaveBeenCalled();
    });

    it("skips entry when type is not cli", async () => {
      const result = await runLinkUnderstanding({
        cfg: makeCfg({
          enabled: true,
          models: [{ type: "provider" as unknown as "cli", command: "curl" }],
        }),
        ctx: makeCtx({ Body: "https://example.com" }),
      });
      expect(result.outputs).toEqual([]);
      expect(mockRunExec).not.toHaveBeenCalled();
    });

    it("treats missing type as cli (default)", async () => {
      mockRunExec.mockResolvedValue({ stdout: "output", stderr: "" });
      const result = await runLinkUnderstanding({
        cfg: makeCfg({
          enabled: true,
          models: [{ command: "my-tool", args: ["{{LinkUrl}}"] }],
        }),
        ctx: makeCtx({ Body: "https://example.com" }),
      });
      expect(result.outputs).toEqual(["output"]);
      expect(mockRunExec).toHaveBeenCalledWith(
        "my-tool",
        ["https://example.com"],
        expect.any(Object),
      );
    });

    it("does not template the command itself, only args", async () => {
      mockRunExec.mockResolvedValue({ stdout: "output", stderr: "" });
      await runLinkUnderstanding({
        cfg: makeCfg({
          enabled: true,
          models: [{ command: "{{LinkUrl}}", args: ["{{LinkUrl}}"] }],
        }),
        ctx: makeCtx({ Body: "https://example.com" }),
      });
      // Command should be passed as-is, args should be templated.
      expect(mockRunExec).toHaveBeenCalledWith(
        "{{LinkUrl}}",
        ["https://example.com"],
        expect.any(Object),
      );
    });

    it("returns null output when stdout is empty", async () => {
      mockRunExec.mockResolvedValue({ stdout: "", stderr: "" });
      const result = await runLinkUnderstanding({
        cfg: makeCfg({ enabled: true, models: [makeCliEntry()] }),
        ctx: makeCtx({ Body: "https://example.com" }),
      });
      expect(result.urls).toEqual(["https://example.com"]);
      expect(result.outputs).toEqual([]);
    });

    it("returns null output when stdout is whitespace only", async () => {
      mockRunExec.mockResolvedValue({ stdout: "   \n  ", stderr: "" });
      const result = await runLinkUnderstanding({
        cfg: makeCfg({ enabled: true, models: [makeCliEntry()] }),
        ctx: makeCtx({ Body: "https://example.com" }),
      });
      expect(result.outputs).toEqual([]);
    });

    it("trims stdout before returning", async () => {
      mockRunExec.mockResolvedValue({ stdout: "  page content  \n", stderr: "" });
      const result = await runLinkUnderstanding({
        cfg: makeCfg({ enabled: true, models: [makeCliEntry()] }),
        ctx: makeCtx({ Body: "https://example.com" }),
      });
      expect(result.outputs).toEqual(["page content"]);
    });
  });

  // ── Fallback / error handling ──────────────────────────────────────

  describe("fallback and error handling", () => {
    it("falls back to next entry when first entry throws", async () => {
      const entries: LinkModelConfig[] = [
        makeCliEntry({ command: "fail-tool" }),
        makeCliEntry({ command: "ok-tool" }),
      ];
      mockRunExec
        .mockRejectedValueOnce(new Error("command not found"))
        .mockResolvedValueOnce({ stdout: "fallback output", stderr: "" });

      const result = await runLinkUnderstanding({
        cfg: makeCfg({ enabled: true, models: entries }),
        ctx: makeCtx({ Body: "https://example.com" }),
      });
      expect(result.outputs).toEqual(["fallback output"]);
    });

    it("returns empty outputs when all entries fail", async () => {
      const entries: LinkModelConfig[] = [
        makeCliEntry({ command: "fail-1" }),
        makeCliEntry({ command: "fail-2" }),
      ];
      mockRunExec
        .mockRejectedValueOnce(new Error("fail 1"))
        .mockRejectedValueOnce(new Error("fail 2"));

      const result = await runLinkUnderstanding({
        cfg: makeCfg({ enabled: true, models: entries }),
        ctx: makeCtx({ Body: "https://example.com" }),
      });
      expect(result.urls).toEqual(["https://example.com"]);
      expect(result.outputs).toEqual([]);
    });

    it("stops trying entries once one succeeds", async () => {
      const entries: LinkModelConfig[] = [
        makeCliEntry({ command: "good" }),
        makeCliEntry({ command: "never-called" }),
      ];
      mockRunExec.mockResolvedValueOnce({ stdout: "first wins", stderr: "" });

      const result = await runLinkUnderstanding({
        cfg: makeCfg({ enabled: true, models: entries }),
        ctx: makeCtx({ Body: "https://example.com" }),
      });
      expect(result.outputs).toEqual(["first wins"]);
      expect(mockRunExec).toHaveBeenCalledTimes(1);
    });

    it("continues to next URL even when first URL produces no output", async () => {
      mockRunExec
        .mockResolvedValueOnce({ stdout: "", stderr: "" })
        .mockResolvedValueOnce({ stdout: "second url output", stderr: "" });

      const result = await runLinkUnderstanding({
        cfg: makeCfg({ enabled: true, models: [makeCliEntry()] }),
        ctx: makeCtx({ Body: "https://a.com https://b.com" }),
      });
      expect(result.urls).toEqual(["https://a.com", "https://b.com"]);
      expect(result.outputs).toEqual(["second url output"]);
    });

    it("processes each URL with all configured entries", async () => {
      mockRunExec.mockResolvedValue({ stdout: "output", stderr: "" });

      const result = await runLinkUnderstanding({
        cfg: makeCfg({ enabled: true, models: [makeCliEntry()] }),
        ctx: makeCtx({ Body: "https://a.com https://b.com" }),
      });
      expect(result.urls).toEqual(["https://a.com", "https://b.com"]);
      expect(result.outputs).toEqual(["output", "output"]);
      expect(mockRunExec).toHaveBeenCalledTimes(2);
    });
  });

  // ── Verbose logging ────────────────────────────────────────────────

  describe("verbose logging", () => {
    it("does not throw when verbose logging is enabled", async () => {
      mockShouldLogVerbose.mockReturnValue(true);
      mockRunExec.mockResolvedValue({ stdout: "ok", stderr: "" });
      const result = await runLinkUnderstanding({
        cfg: makeCfg({ enabled: true, models: [makeCliEntry()] }),
        ctx: makeCtx({ Body: "https://example.com" }),
      });
      expect(result.outputs).toEqual(["ok"]);
    });

    it("logs exhaustion when verbose and all entries fail", async () => {
      mockShouldLogVerbose.mockReturnValue(true);
      mockRunExec.mockRejectedValue(new Error("fail"));
      const result = await runLinkUnderstanding({
        cfg: makeCfg({ enabled: true, models: [makeCliEntry()] }),
        ctx: makeCtx({ Body: "https://example.com" }),
      });
      expect(result.outputs).toEqual([]);
    });

    it("logs scope denial when verbose", async () => {
      mockShouldLogVerbose.mockReturnValue(true);
      mockResolveScope.mockReturnValue("deny");
      const result = await runLinkUnderstanding({
        cfg: makeCfg({ enabled: true, models: [makeCliEntry()] }),
        ctx: makeCtx(),
      });
      expect(result).toEqual({ urls: [], outputs: [] });
    });
  });

  // ── Template context ───────────────────────────────────────────────

  describe("template context", () => {
    it("passes LinkUrl in template context for arg substitution", async () => {
      mockRunExec.mockResolvedValue({ stdout: "ok", stderr: "" });
      await runLinkUnderstanding({
        cfg: makeCfg({
          enabled: true,
          models: [
            { command: "fetch", args: ["--url", "{{LinkUrl}}", "--session", "{{SessionKey}}"] },
          ],
        }),
        ctx: makeCtx({ Body: "https://target.com", SessionKey: "sess-123" }),
      });
      expect(mockRunExec).toHaveBeenCalledWith(
        "fetch",
        ["--url", "https://target.com", "--session", "sess-123"],
        expect.any(Object),
      );
    });

    it("passes empty args when entry.args is undefined", async () => {
      mockRunExec.mockResolvedValue({ stdout: "ok", stderr: "" });
      await runLinkUnderstanding({
        cfg: makeCfg({
          enabled: true,
          models: [{ command: "fetch" }],
        }),
        ctx: makeCtx({ Body: "https://example.com" }),
      });
      expect(mockRunExec).toHaveBeenCalledWith("fetch", [], expect.any(Object));
    });
  });
});

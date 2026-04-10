import { describe, expect, it } from "vitest";
import { type OpenClawConfig, DEFAULT_GATEWAY_PORT } from "../config/config.js";
import {
  buildDefaultHookUrl,
  buildGogWatchServeArgs,
  buildTopicPath,
  DEFAULT_GMAIL_EXCLUDE_LABELS,
  type GmailHookRuntimeConfig,
  parseTopicPath,
  resolveGmailHookRuntimeConfig,
} from "./gmail.js";

const baseConfig = {
  hooks: {
    token: "hook-token",
    gmail: {
      account: "openclaw@gmail.com",
      topic: "projects/demo/topics/gog-gmail-watch",
      pushToken: "push-token",
    },
  },
} satisfies OpenClawConfig;

describe("gmail hook config", () => {
  function resolveWithGmailOverrides(
    overrides: Partial<NonNullable<OpenClawConfig["hooks"]>["gmail"]>,
  ) {
    return resolveGmailHookRuntimeConfig(
      {
        hooks: {
          token: "hook-token",
          gmail: {
            account: "openclaw@gmail.com",
            topic: "projects/demo/topics/gog-gmail-watch",
            pushToken: "push-token",
            ...overrides,
          },
        },
      },
      {},
    );
  }

  function expectResolvedPaths(
    result: ReturnType<typeof resolveGmailHookRuntimeConfig>,
    expected: { servePath: string; publicPath: string; target?: string },
  ) {
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.serve.path).toBe(expected.servePath);
    expect(result.value.tailscale.path).toBe(expected.publicPath);
    if (expected.target !== undefined) {
      expect(result.value.tailscale.target).toBe(expected.target);
    }
  }

  it("builds default hook url", () => {
    expect(buildDefaultHookUrl("/hooks", DEFAULT_GATEWAY_PORT)).toBe(
      `http://127.0.0.1:${DEFAULT_GATEWAY_PORT}/hooks/gmail`,
    );
  });

  it("parses topic path", () => {
    const topic = buildTopicPath("proj", "topic");
    expect(parseTopicPath(topic)).toEqual({
      projectId: "proj",
      topicName: "topic",
    });
  });

  it("resolves runtime config with defaults", () => {
    const result = resolveGmailHookRuntimeConfig(baseConfig, {});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.account).toBe("openclaw@gmail.com");
      expect(result.value.label).toBe("INBOX");
      expect(result.value.includeBody).toBe(true);
      expect(result.value.serve.port).toBe(8788);
      expect(result.value.hookUrl).toBe(`http://127.0.0.1:${DEFAULT_GATEWAY_PORT}/hooks/gmail`);
    }
  });

  it("fails without hook token", () => {
    const result = resolveGmailHookRuntimeConfig(
      {
        hooks: {
          gmail: {
            account: "openclaw@gmail.com",
            topic: "projects/demo/topics/gog-gmail-watch",
            pushToken: "push-token",
          },
        },
      },
      {},
    );
    expect(result.ok).toBe(false);
  });

  it("defaults serve path to / when tailscale is enabled", () => {
    const result = resolveWithGmailOverrides({ tailscale: { mode: "funnel" } });
    expectResolvedPaths(result, { servePath: "/", publicPath: "/gmail-pubsub" });
  });

  it("keeps the default public path when serve path is explicit", () => {
    const result = resolveWithGmailOverrides({
      serve: { path: "/gmail-pubsub" },
      tailscale: { mode: "funnel" },
    });
    expectResolvedPaths(result, { servePath: "/", publicPath: "/gmail-pubsub" });
  });

  it("keeps custom public path when serve path is set", () => {
    const result = resolveWithGmailOverrides({
      serve: { path: "/custom" },
      tailscale: { mode: "funnel" },
    });
    expectResolvedPaths(result, { servePath: "/", publicPath: "/custom" });
  });

  it("keeps serve path when tailscale target is set", () => {
    const target = "http://127.0.0.1:8788/custom";
    const result = resolveWithGmailOverrides({
      serve: { path: "/custom" },
      tailscale: { mode: "funnel", target },
    });
    expectResolvedPaths(result, { servePath: "/custom", publicPath: "/custom", target });
  });

  it("resolves default excludeLabels", () => {
    const result = resolveGmailHookRuntimeConfig(baseConfig, {});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.excludeLabels).toEqual(DEFAULT_GMAIL_EXCLUDE_LABELS);
    }
  });

  it("resolves custom excludeLabels from config", () => {
    const result = resolveGmailHookRuntimeConfig(
      {
        hooks: {
          ...baseConfig.hooks,
          gmail: {
            ...baseConfig.hooks.gmail,
            excludeLabels: ["SPAM"],
          },
        },
      },
      {},
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.excludeLabels).toEqual(["SPAM"]);
    }
  });

  it("resolves excludeLabels from overrides", () => {
    const result = resolveGmailHookRuntimeConfig(baseConfig, {
      excludeLabels: ["TRASH", "DRAFT"],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.excludeLabels).toEqual(["TRASH", "DRAFT"]);
    }
  });
});

describe("buildGogWatchServeArgs", () => {
  const baseCfg: GmailHookRuntimeConfig = {
    account: "test@gmail.com",
    label: "INBOX",
    topic: "projects/demo/topics/gog-gmail-watch",
    subscription: "gog-gmail-watch-push",
    pushToken: "push-tok",
    hookToken: "hook-tok",
    hookUrl: "http://127.0.0.1:18789/hooks/gmail",
    includeBody: true,
    excludeLabels: DEFAULT_GMAIL_EXCLUDE_LABELS,
    maxBytes: 20_000,
    renewEveryMinutes: 720,
    serve: { bind: "127.0.0.1", port: 8788, path: "/gmail-pubsub" },
    tailscale: { mode: "off", path: "/gmail-pubsub" },
  };

  it("includes --exclude-labels with default labels", () => {
    const args = buildGogWatchServeArgs(baseCfg);
    const idx = args.indexOf("--exclude-labels");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe("SPAM,TRASH,DRAFT,SENT");
  });

  it("includes --exclude-labels with custom labels", () => {
    const args = buildGogWatchServeArgs({ ...baseCfg, excludeLabels: ["SPAM"] });
    const idx = args.indexOf("--exclude-labels");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe("SPAM");
  });

  it("omits --exclude-labels when array is empty", () => {
    const args = buildGogWatchServeArgs({ ...baseCfg, excludeLabels: [] });
    expect(args).not.toContain("--exclude-labels");
  });

  it("includes --include-body when enabled", () => {
    const args = buildGogWatchServeArgs(baseCfg);
    expect(args).toContain("--include-body");
  });

  it("omits --include-body when disabled", () => {
    const args = buildGogWatchServeArgs({ ...baseCfg, includeBody: false });
    expect(args).not.toContain("--include-body");
  });
});

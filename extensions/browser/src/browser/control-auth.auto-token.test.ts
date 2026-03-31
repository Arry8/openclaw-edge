import { beforeEach, describe, expect, it, vi } from "vitest";
import { expectGeneratedTokenPersistedToGatewayAuth } from "../../test-support.js";
import type { OpenClawConfig } from "../config/config.js";

const mocks = vi.hoisted(() => ({
  loadConfig: vi.fn<() => OpenClawConfig>(),
  resolveGatewayAuth: vi.fn(
    ({
      authConfig,
    }: {
      authConfig?: NonNullable<NonNullable<OpenClawConfig["gateway"]>["auth"]> | undefined;
    }) => {
      const token =
        typeof authConfig?.token === "string"
          ? authConfig.token
          : typeof authConfig?.token === "object"
            ? undefined
            : undefined;
      const password = typeof authConfig?.password === "string" ? authConfig.password : undefined;
      return {
        token,
        password,
      };
    },
  ),
  ensureGatewayStartupAuth: vi.fn(async ({ cfg }: { cfg: OpenClawConfig }) => ({
    cfg: {
      ...cfg,
      gateway: {
        ...cfg.gateway,
        auth: {
          ...cfg.gateway?.auth,
          mode: "token" as const,
          token: "a".repeat(48),
        },
      },
    },
    auth: {
      mode: "token" as const,
      token: "a".repeat(48),
    },
    generatedToken: "a".repeat(48),
    persistedGeneratedToken: true,
  })),
}));

vi.mock("../config/config.js", () => ({
  loadConfig: mocks.loadConfig,
}));

vi.mock("../gateway/startup-auth.js", () => ({
  ensureGatewayStartupAuth: mocks.ensureGatewayStartupAuth,
}));

vi.mock("../gateway/auth.js", () => ({
  resolveGatewayAuth: mocks.resolveGatewayAuth,
}));

let ensureBrowserControlAuth: typeof import("./control-auth.js").ensureBrowserControlAuth;

describe("ensureBrowserControlAuth", () => {
  const expectExplicitModeSkipsAutoAuth = async (mode: "password" | "none") => {
    const cfg: OpenClawConfig = {
      gateway: {
        auth: { mode },
      },
      browser: {
        enabled: true,
      },
    };

    const result = await ensureBrowserControlAuth({ cfg, env: {} as NodeJS.ProcessEnv });
    expect(result).toEqual({ auth: {} });
    expect(mocks.loadConfig).not.toHaveBeenCalled();
    expect(mocks.ensureGatewayStartupAuth).not.toHaveBeenCalled();
  };

  const expectGeneratedTokenPersisted = async (result: {
    generatedToken?: string;
    auth: { token?: string };
  }) => {
    expect(mocks.ensureGatewayStartupAuth).toHaveBeenCalledTimes(1);
    const ensured = await mocks.ensureGatewayStartupAuth.mock.results[0]?.value;
    expectGeneratedTokenPersistedToGatewayAuth({
      generatedToken: result.generatedToken,
      authToken: result.auth.token,
      persistedConfig: ensured?.cfg,
    });
  };

  beforeEach(async () => {
    vi.resetModules();
    ({ ensureBrowserControlAuth } = await import("./control-auth.js"));
    vi.restoreAllMocks();
    mocks.loadConfig.mockClear();
    mocks.resolveGatewayAuth.mockClear();
    mocks.ensureGatewayStartupAuth.mockClear();
  });

  it("returns existing auth and skips writes", async () => {
    const cfg: OpenClawConfig = {
      gateway: {
        auth: {
          token: "already-set",
        },
      },
    };

    const result = await ensureBrowserControlAuth({ cfg, env: {} as NodeJS.ProcessEnv });

    expect(result).toEqual({ auth: { token: "already-set" } });
    expect(mocks.loadConfig).not.toHaveBeenCalled();
    expect(mocks.ensureGatewayStartupAuth).not.toHaveBeenCalled();
  });

  it("auto-generates and persists a token when auth is missing", async () => {
    const cfg: OpenClawConfig = {
      browser: {
        enabled: true,
      },
    };
    mocks.loadConfig.mockReturnValue({
      browser: {
        enabled: true,
      },
    });

    const result = await ensureBrowserControlAuth({ cfg, env: {} as NodeJS.ProcessEnv });
    await expectGeneratedTokenPersisted(result);
  });

  it("skips auto-generation in test env", async () => {
    const cfg: OpenClawConfig = {
      browser: {
        enabled: true,
      },
    };

    const result = await ensureBrowserControlAuth({
      cfg,
      env: { NODE_ENV: "test" } as NodeJS.ProcessEnv,
    });

    expect(result).toEqual({ auth: {} });
    expect(mocks.loadConfig).not.toHaveBeenCalled();
    expect(mocks.ensureGatewayStartupAuth).not.toHaveBeenCalled();
  });

  it("respects explicit password mode", async () => {
    await expectExplicitModeSkipsAutoAuth("password");
  });

  it("respects explicit none mode", async () => {
    await expectExplicitModeSkipsAutoAuth("none");
  });

  it("auto-generates and persists a token for trusted-proxy mode", async () => {
    const cfg: OpenClawConfig = {
      gateway: {
        auth: {
          mode: "trusted-proxy",
          trustedProxy: {
            userHeader: "x-forwarded-user",
          },
        },
        trustedProxies: ["192.168.1.1"],
      },
      browser: {
        enabled: true,
      },
    };
    mocks.loadConfig.mockReturnValue(cfg);

    const result = await ensureBrowserControlAuth({ cfg, env: {} as NodeJS.ProcessEnv });

    // Token is generated and returned.
    expect(result.generatedToken).toMatch(/^[0-9a-f]{48}$/);
    expect(result.auth.token).toBe(result.generatedToken);

    // Token is persisted to config, preserving the trusted-proxy mode.
    expect(mocks.writeConfigFile).toHaveBeenCalledTimes(1);
    const persisted = mocks.writeConfigFile.mock.calls[0]?.[0];
    expect(persisted?.gateway?.auth?.mode).toBe("trusted-proxy");
    expect(persisted?.gateway?.auth?.token).toBe(result.generatedToken);
  });

  it("fails closed when trusted-proxy SecretRef token cannot be resolved", async () => {
    const secretRef = { source: "env" as const, provider: "default", id: "BROWSER_TOKEN" };
    const cfg: OpenClawConfig = {
      gateway: {
        auth: {
          mode: "trusted-proxy",
          token: secretRef,
          trustedProxy: {
            userHeader: "x-forwarded-user",
          },
        },
        trustedProxies: ["192.168.1.1"],
      },
      browser: {
        enabled: true,
      },
    };
    mocks.loadConfig.mockReturnValue(cfg);

    // Fail closed — don't start browser control without auth.
    await expect(ensureBrowserControlAuth({ cfg, env: {} as NodeJS.ProcessEnv })).rejects.toThrow(
      /SecretRef.*could not be resolved/,
    );
    expect(mocks.writeConfigFile).not.toHaveBeenCalled();
  });

  it("fails closed when trusted-proxy inline env-template cannot be resolved", async () => {
    const cfg: OpenClawConfig = {
      gateway: {
        auth: {
          mode: "trusted-proxy",
          token: "${OPENCLAW_GATEWAY_TOKEN}",
          trustedProxy: {
            userHeader: "x-forwarded-user",
          },
        },
        trustedProxies: ["192.168.1.1"],
      },
      browser: {
        enabled: true,
      },
    };
    mocks.loadConfig.mockReturnValue(cfg);

    await expect(ensureBrowserControlAuth({ cfg, env: {} as NodeJS.ProcessEnv })).rejects.toThrow(
      /SecretRef.*could not be resolved/,
    );
    expect(mocks.writeConfigFile).not.toHaveBeenCalled();
  });

  it("does not regenerate token when trusted-proxy config already has one", async () => {
    const cfg: OpenClawConfig = {
      gateway: {
        auth: {
          mode: "trusted-proxy",
          token: "previously-generated-token",
          trustedProxy: {
            userHeader: "x-forwarded-user",
          },
        },
        trustedProxies: ["192.168.1.1"],
      },
      browser: {
        enabled: true,
      },
    };

    const result = await ensureBrowserControlAuth({ cfg, env: {} as NodeJS.ProcessEnv });

    // Existing token is reused — no re-generation or config write.
    expect(result).toEqual({ auth: { token: "previously-generated-token" } });
    expect(mocks.loadConfig).not.toHaveBeenCalled();
    expect(mocks.writeConfigFile).not.toHaveBeenCalled();
  });

  it("reuses auth from latest config snapshot", async () => {
    const cfg: OpenClawConfig = {
      browser: {
        enabled: true,
      },
    };
    mocks.loadConfig.mockReturnValue({
      gateway: {
        auth: {
          token: "latest-token",
        },
      },
      browser: {
        enabled: true,
      },
    });

    const result = await ensureBrowserControlAuth({ cfg, env: {} as NodeJS.ProcessEnv });

    expect(result).toEqual({ auth: { token: "latest-token" } });
    expect(mocks.ensureGatewayStartupAuth).not.toHaveBeenCalled();
  });

  it("fails when gateway.auth.token SecretRef is unresolved", async () => {
    const cfg: OpenClawConfig = {
      gateway: {
        auth: {
          mode: "token",
          token: { source: "env", provider: "default", id: "MISSING_GW_TOKEN" },
        },
      },
      browser: {
        enabled: true,
      },
      secrets: {
        providers: {
          default: { source: "env" },
        },
      },
    };
    mocks.loadConfig.mockReturnValue(cfg);
    mocks.ensureGatewayStartupAuth.mockRejectedValueOnce(new Error("MISSING_GW_TOKEN"));

    await expect(ensureBrowserControlAuth({ cfg, env: {} as NodeJS.ProcessEnv })).rejects.toThrow(
      /MISSING_GW_TOKEN/i,
    );
    expect(mocks.ensureGatewayStartupAuth).toHaveBeenCalledTimes(1);
  });
});

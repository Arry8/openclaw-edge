import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolvePiCredentialMapFromStore } from "./pi-auth-credentials.js";
import {
  addEnvBackedPiCredentials,
  scrubLegacyStaticAuthJsonEntriesForDiscovery,
} from "./pi-model-discovery.js";

async function createAgentDir(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-pi-auth-storage-"));
}

async function withAgentDir(run: (agentDir: string) => Promise<void>): Promise<void> {
  const agentDir = await createAgentDir();
  try {
    await run(agentDir);
  } finally {
    await fs.rm(agentDir, { recursive: true, force: true });
  }
}

async function writeLegacyAuthJson(
  agentDir: string,
  authEntries: Record<string, unknown>,
): Promise<void> {
  await fs.writeFile(path.join(agentDir, "auth.json"), JSON.stringify(authEntries, null, 2));
}

async function readLegacyAuthJson(agentDir: string): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(path.join(agentDir, "auth.json"), "utf8")) as Record<
    string,
    unknown
  >;
}

describe("discoverAuthStorage", () => {
  it("converts runtime auth profiles into pi discovery credentials", () => {
    const credentials = resolvePiCredentialMapFromStore({
      version: 1,
      profiles: {
        "openrouter:default": {
          type: "api_key",
          provider: "openrouter",
          key: "sk-or-v1-runtime",
        },
        "anthropic:default": {
          type: "token",
          provider: "anthropic",
          token: "sk-ant-runtime",
        },
        "openai-codex:default": {
          type: "oauth",
          provider: "openai-codex",
          access: "oauth-access",
          refresh: "oauth-refresh",
          expires: Date.now() + 60_000,
        },
      },
    });

    expect(credentials.openrouter).toEqual({
      type: "api_key",
      key: "sk-or-v1-runtime",
    });
    expect(credentials.anthropic).toEqual({
      type: "api_key",
      key: "sk-ant-runtime",
    });
    expect(credentials["openai-codex"]).toMatchObject({
      type: "oauth",
      access: "oauth-access",
      refresh: "oauth-refresh",
    });
  });

  it("scrubs static api_key entries from legacy auth.json and keeps oauth entries", async () => {
    await withAgentDir(async (agentDir) => {
      await writeLegacyAuthJson(agentDir, {
        openrouter: { type: "api_key", key: "legacy-static-key" },
        "openai-codex": {
          type: "oauth",
          access: "oauth-access",
          refresh: "oauth-refresh",
          expires: Date.now() + 60_000,
        },
      });

      scrubLegacyStaticAuthJsonEntriesForDiscovery(path.join(agentDir, "auth.json"));

      const parsed = await readLegacyAuthJson(agentDir);
      expect(parsed.openrouter).toBeUndefined();
      expect(parsed["openai-codex"]).toMatchObject({
        type: "oauth",
        access: "oauth-access",
      });
    });
  });

  it("preserves legacy auth.json when auth store is forced read-only", async () => {
    await withAgentDir(async (agentDir) => {
      const previous = process.env.OPENCLAW_AUTH_STORE_READONLY;
      process.env.OPENCLAW_AUTH_STORE_READONLY = "1";
      try {
        await writeLegacyAuthJson(agentDir, {
          openrouter: { type: "api_key", key: "legacy-static-key" },
        });

        scrubLegacyStaticAuthJsonEntriesForDiscovery(path.join(agentDir, "auth.json"));

        const parsed = await readLegacyAuthJson(agentDir);
        expect(parsed.openrouter).toMatchObject({ type: "api_key", key: "legacy-static-key" });
      } finally {
        if (previous === undefined) {
          delete process.env.OPENCLAW_AUTH_STORE_READONLY;
        } else {
          process.env.OPENCLAW_AUTH_STORE_READONLY = previous;
        }
      }
    });
  });

  it("includes env-backed provider auth when no auth profile exists", async () => {
    const previous = process.env.MISTRAL_API_KEY;
    process.env.MISTRAL_API_KEY = "mistral-env-test-key";
    try {
      const credentials = addEnvBackedPiCredentials({}, process.env);

      expect(credentials.mistral).toEqual({
        type: "api_key",
        key: "mistral-env-test-key",
      });
    } finally {
      if (previous === undefined) {
        delete process.env.MISTRAL_API_KEY;
      } else {
        process.env.MISTRAL_API_KEY = previous;
      }
    }
  });

  it("strips secretref-managed marker values from getApiKeyAndHeaders result", async () => {
    await withAgentDir(async (agentDir) => {
      await writeModelsJson(agentDir, {
        providers: {
          "custom-provider": {
            api: "openai-completions",
            baseUrl: "https://api.example.com/v1",
            apiKey: "EXAMPLE_API_KEY",
            headers: {
              "x-custom-header": "secretref-managed",
              "x-normal-header": "normal-value",
            },
            models: [
              {
                id: "test-model",
                name: "Test Model",
                input: ["text"],
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                contextWindow: 128000,
                maxTokens: 4096,
              },
            ],
          },
        },
      });

      process.env.EXAMPLE_API_KEY = "sk-test-key";
      try {
        const authStorage = discoverAuthStorage(agentDir);
        const modelRegistry = discoverModels(authStorage, agentDir);
        const model = modelRegistry.find("custom-provider", "test-model");
        expect(model).toBeTruthy();
        const auth = await modelRegistry.getApiKeyAndHeaders(model!);
        expect(auth.ok).toBe(true);
        if (auth.ok) {
          // The "secretref-managed" marker should be stripped
          expect(auth.headers?.["x-custom-header"]).toBeUndefined();
          // Normal headers should be preserved
          expect(auth.headers?.["x-normal-header"]).toBe("normal-value");
        }
      } finally {
        delete process.env.EXAMPLE_API_KEY;
      }
    });
  });

  it("strips secretref-env header marker values from getApiKeyAndHeaders result", async () => {
    await withAgentDir(async (agentDir) => {
      await writeModelsJson(agentDir, {
        providers: {
          "custom-provider": {
            api: "openai-completions",
            baseUrl: "https://api.example.com/v1",
            apiKey: "EXAMPLE_API_KEY",
            headers: {
              "x-env-header": "secretref-env:MY_SECRET_VAR",
              "x-keep-header": "real-value",
            },
            models: [
              {
                id: "test-model",
                name: "Test Model",
                input: ["text"],
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                contextWindow: 128000,
                maxTokens: 4096,
              },
            ],
          },
        },
      });

      process.env.EXAMPLE_API_KEY = "sk-test-key";
      try {
        const authStorage = discoverAuthStorage(agentDir);
        const modelRegistry = discoverModels(authStorage, agentDir);
        const model = modelRegistry.find("custom-provider", "test-model");
        expect(model).toBeTruthy();
        const auth = await modelRegistry.getApiKeyAndHeaders(model!);
        expect(auth.ok).toBe(true);
        if (auth.ok) {
          // The "secretref-env:" marker should be stripped
          expect(auth.headers?.["x-env-header"]).toBeUndefined();
          // Normal headers should be preserved
          expect(auth.headers?.["x-keep-header"]).toBe("real-value");
        }
      } finally {
        delete process.env.EXAMPLE_API_KEY;
      }
    });
  });
});

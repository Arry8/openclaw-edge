import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import type { MemoryEmbeddingProviderAdapter } from "../plugins/memory-embedding-providers.js";

const mocks = vi.hoisted(() => ({
  getMemoryEmbeddingProvider:
    vi.fn<(id: string, cfg?: OpenClawConfig) => MemoryEmbeddingProviderAdapter | undefined>(),
}));

vi.mock("../plugins/memory-embedding-provider-runtime.js", () => ({
  getMemoryEmbeddingProvider: mocks.getMemoryEmbeddingProvider,
}));

let resolveMemorySearchConfig: typeof import("./memory-search.js").resolveMemorySearchConfig;

function createAdapter(id: string): MemoryEmbeddingProviderAdapter {
  return {
    id,
    transport: "remote",
    defaultModel: `${id}-default`,
    create: async () => ({ provider: null }),
  };
}

describe("memory search config plugin capability providers", () => {
  beforeAll(async () => {
    ({ resolveMemorySearchConfig } = await import("./memory-search.js"));
  });

  beforeEach(() => {
    mocks.getMemoryEmbeddingProvider.mockReset();
    mocks.getMemoryEmbeddingProvider.mockImplementation((id) => createAdapter(id));
  });

  it("passes cfg into provider and fallback lookups", () => {
    const cfg = {
      plugins: {
        allow: ["memory-fallback", "memory-lancedb-pro"],
      },
      agents: {
        defaults: {
          memorySearch: {
            provider: "memory-lancedb-pro",
            fallback: "memory-fallback",
          },
        },
      },
    } satisfies OpenClawConfig;

    const resolved = resolveMemorySearchConfig(cfg, "main");

    expect(resolved?.model).toBe("memory-lancedb-pro-default");
    expect(mocks.getMemoryEmbeddingProvider).toHaveBeenCalledTimes(3);
    expect(mocks.getMemoryEmbeddingProvider).toHaveBeenNthCalledWith(1, "memory-lancedb-pro", cfg);
    expect(mocks.getMemoryEmbeddingProvider).toHaveBeenNthCalledWith(2, "memory-fallback", cfg);
    expect(mocks.getMemoryEmbeddingProvider).toHaveBeenNthCalledWith(3, "memory-lancedb-pro", cfg);
  });
});

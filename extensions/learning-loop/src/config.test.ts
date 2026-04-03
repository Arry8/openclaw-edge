import { describe, expect, it } from "vitest";
import { learningLoopConfigSchema } from "./config.js";

const baseConfig = {
  graphiti: {
    mcpServerUrl: "http://localhost:8000/mcp",
  },
};

describe("learning-loop config", () => {
  it("rejects nudge intervals below the documented minimum", () => {
    expect(() =>
      learningLoopConfigSchema.parse({
        ...baseConfig,
        nudge: {
          memoryInterval: 2,
          skillInterval: 10,
        },
      }),
    ).toThrow("nudge.memoryInterval must be between 3 and 50");

    expect(() =>
      learningLoopConfigSchema.parse({
        ...baseConfig,
        nudge: {
          memoryInterval: 10,
          skillInterval: 2,
        },
      }),
    ).toThrow("nudge.skillInterval must be between 3 and 50");
  });

  it("rejects nudge intervals above the documented maximum", () => {
    expect(() =>
      learningLoopConfigSchema.parse({
        ...baseConfig,
        nudge: {
          memoryInterval: 51,
          skillInterval: 10,
        },
      }),
    ).toThrow("nudge.memoryInterval must be between 3 and 50");

    expect(() =>
      learningLoopConfigSchema.parse({
        ...baseConfig,
        nudge: {
          memoryInterval: 10,
          skillInterval: 51,
        },
      }),
    ).toThrow("nudge.skillInterval must be between 3 and 50");
  });
});

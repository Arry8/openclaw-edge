import { Type } from "@sinclair/typebox";
import { describe, expect, it, vi } from "vitest";
import { normalizeToolParameters } from "./pi-tools.schema.js";
import type { AnyAgentTool } from "./pi-tools.types.js";

// Helper function to create enum types for test cases
const stringEnum = (values: string[]) => Type.Union(values.map((v) => Type.Literal(v)));

describe("normalizeToolParameters", () => {
  it("strips patternProperties for non-Anthropic providers by default (#57443)", () => {
    const tool: AnyAgentTool = {
      name: "exec",
      label: "exec",
      description: "run a command",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string" },
          env: {
            type: "object",
            patternProperties: {
              "^(.*)$": { type: "string" },
            },
          },
        },
        required: ["command"],
      },
      execute: vi.fn(),
    };

    // Non-Anthropic provider (e.g. BytePlus Ark) should strip patternProperties
    const normalized = normalizeToolParameters(tool, {
      modelProvider: "bytedance",
    });
    const env = (normalized.parameters as Record<string, unknown>).properties as Record<
      string,
      Record<string, unknown>
    >;
    expect(env.env.patternProperties).toBeUndefined();
    expect(env.env.type).toBe("object");

    // Anthropic native API supports full JSON Schema — keep patternProperties
    const anthropicNormalized = normalizeToolParameters(tool, {
      modelProvider: "anthropic",
    });
    const anthropicEnv = (anthropicNormalized.parameters as Record<string, unknown>)
      .properties as Record<string, Record<string, unknown>>;
    expect(anthropicEnv.env.patternProperties).toBeDefined();
  });

  it("strips compat-declared unsupported schema keywords without provider-specific branching", () => {
    const tool: AnyAgentTool = {
      name: "demo",
      label: "demo",
      description: "demo",
      parameters: Type.Object({
        count: Type.Integer({ minimum: 1, maximum: 5 }),
        query: Type.Optional(Type.String({ minLength: 2 })),
      }),
      execute: vi.fn(),
    };

    const normalized = normalizeToolParameters(tool, {
      modelCompat: {
        unsupportedToolSchemaKeywords: ["minimum", "maximum", "minLength"],
      },
    });

    const parameters = normalized.parameters as {
      required?: string[];
      properties?: Record<string, Record<string, unknown>>;
    };

    expect(parameters.required).toEqual(["count"]);
    expect(parameters.properties?.count.minimum).toBeUndefined();
    expect(parameters.properties?.count.maximum).toBeUndefined();
    expect(parameters.properties?.count.type).toBe("integer");
    expect(parameters.properties?.query.minLength).toBeUndefined();
    expect(parameters.properties?.query.type).toBe("string");
  });

  it("excludes TypeBox-Optional properties from merged required when flattening anyOf variants", () => {
    const buttonSchema = Type.Optional(Type.Array(Type.String()));
    const variantA = Type.Object({ action: stringEnum(["send"]), buttons: buttonSchema });
    const variantB = Type.Object({ action: stringEnum(["delete"]), buttons: buttonSchema });
    const tool: AnyAgentTool = {
      name: "demo",
      label: "demo",
      description: "demo",
      parameters: Type.Union([variantA, variantB]),
      execute: vi.fn(),
    };

    const normalized = normalizeToolParameters(tool);
    const parameters = normalized.parameters as { required?: string[] };

    expect(parameters.required).not.toContain("buttons");
    expect(parameters.required).toContain("action"); // required in both variants, not Optional
  });

  it("handles enum-plus-Optional edge case when merging properties", () => {
    // Create an Optional enum property that will be merged
    const optionalEnumProp = Type.Optional(Type.Union([Type.Literal("a"), Type.Literal("b")]));
    const variantA = Type.Object({
      action: stringEnum(["send"]),
      mode: optionalEnumProp,
    });
    const variantB = Type.Object({
      action: stringEnum(["delete"]),
      mode: optionalEnumProp,
    });
    const tool: AnyAgentTool = {
      name: "demo",
      label: "demo",
      description: "demo",
      parameters: Type.Union([variantA, variantB]),
      execute: vi.fn(),
    };

    const normalized = normalizeToolParameters(tool);
    const parameters = normalized.parameters as { required?: string[] };

    // Even though enum merging might lose the Optional symbol,
    // the property should still be excluded from required
    expect(parameters.required).not.toContain("mode");
    expect(parameters.required).toContain("action");
  });
});

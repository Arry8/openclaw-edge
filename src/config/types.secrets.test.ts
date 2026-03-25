import { describe, expect, it } from "vitest";
import { parseEnvTemplateSecretRef } from "./types.secrets.js";

describe("parseEnvTemplateSecretRef", () => {
  it("parses ${VAR} template syntax", () => {
    expect(parseEnvTemplateSecretRef("${OPENAI_API_KEY}")).toEqual({
      source: "env",
      provider: "default",
      id: "OPENAI_API_KEY",
    });
  });

  it("parses $VAR shorthand syntax", () => {
    expect(parseEnvTemplateSecretRef("$OPENAI_API_KEY")).toEqual({
      source: "env",
      provider: "default",
      id: "OPENAI_API_KEY",
    });
  });

  it("trims whitespace before matching", () => {
    expect(parseEnvTemplateSecretRef("  $FOO_BAR  ")).toEqual({
      source: "env",
      provider: "default",
      id: "FOO_BAR",
    });
  });

  it("uses provided provider alias", () => {
    expect(parseEnvTemplateSecretRef("$MY_KEY", "custom")).toEqual({
      source: "env",
      provider: "custom",
      id: "MY_KEY",
    });
  });

  it("rejects lowercase $var shorthand", () => {
    expect(parseEnvTemplateSecretRef("$openai_api_key")).toBeNull();
  });

  it("rejects bare strings without $ prefix", () => {
    expect(parseEnvTemplateSecretRef("OPENAI_API_KEY")).toBeNull();
    expect(parseEnvTemplateSecretRef("sk-proj-12345")).toBeNull();
  });

  it("rejects non-string values", () => {
    expect(parseEnvTemplateSecretRef(123)).toBeNull();
    expect(parseEnvTemplateSecretRef(null)).toBeNull();
    expect(parseEnvTemplateSecretRef(undefined)).toBeNull();
  });

  it("rejects empty and whitespace-only strings", () => {
    expect(parseEnvTemplateSecretRef("")).toBeNull();
    expect(parseEnvTemplateSecretRef("   ")).toBeNull();
  });

  it("rejects $VAR with embedded spaces", () => {
    expect(parseEnvTemplateSecretRef("$FOO BAR")).toBeNull();
  });

  it("rejects $123 (must start with uppercase letter)", () => {
    expect(parseEnvTemplateSecretRef("$123")).toBeNull();
  });
});

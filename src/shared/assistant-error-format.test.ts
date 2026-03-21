import { describe, expect, it } from "vitest";
import { formatRawAssistantErrorForUi, parseApiErrorInfo } from "./assistant-error-format.js";

const OPENROUTER_HEALER_ALPHA_404_PAYLOAD =
  '{"error":{"message":"Healer Alpha was a stealth model revealed on March 18th as an early testing version of MiMo-V2-Omni. Find it here: https://openrouter.ai/xiaomi/mimo-v2-omni","code":404},"user_id":"user_33GTyP8uDSYYbaeBO48AGHXyuMC"}';

describe("assistant-error-format", () => {
  it("parses OpenRouter JSON 404 payloads with numeric codes", () => {
    const info = parseApiErrorInfo(OPENROUTER_HEALER_ALPHA_404_PAYLOAD);

    expect(info).toEqual({
      httpCode: "404",
      type: undefined,
      message:
        "Healer Alpha was a stealth model revealed on March 18th as an early testing version of MiMo-V2-Omni. Find it here: https://openrouter.ai/xiaomi/mimo-v2-omni",
      requestId: undefined,
    });
    expect(formatRawAssistantErrorForUi(OPENROUTER_HEALER_ALPHA_404_PAYLOAD)).toBe(
      "HTTP 404: Healer Alpha was a stealth model revealed on March 18th as an early testing version of MiMo-V2-Omni. Find it here: https://openrouter.ai/xiaomi/mimo-v2-omni",
    );
  });
});

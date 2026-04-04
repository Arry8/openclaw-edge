import { describe, expect, it } from "vitest";
import { formatRawAssistantErrorForUi, parseApiErrorInfo } from "./assistant-error-format.js";

const OPENROUTER_HEALER_ALPHA_404_PAYLOAD =
  '{"error":{"message":"Healer Alpha was a stealth model revealed on March 18th as an early testing version of MiMo-V2-Omni. Find it here: https://openrouter.ai/xiaomi/mimo-v2-omni","code":404},"user_id":"user_33GTyP8uDSYYbaeBO48AGHXyuMC"}';
const OPENROUTER_HEALER_ALPHA_404_WITH_REQUEST_ID_PAYLOAD =
  '{"error":{"message":"Healer Alpha was a stealth model revealed on March 18th as an early testing version of MiMo-V2-Omni. Find it here: https://openrouter.ai/xiaomi/mimo-v2-omni","code":404},"request_id":"req_test"}';
const CUSTOM_NUMERIC_ERROR_CODE_PAYLOAD =
  '{"error":{"message":"Provider-specific error", "code":1001},"user_id":"user_33GTyP8uDSYYbaeBO48AGHXyuMC"}';

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

  it("includes request IDs in formatted error messages", () => {
    expect(formatRawAssistantErrorForUi(OPENROUTER_HEALER_ALPHA_404_WITH_REQUEST_ID_PAYLOAD)).toBe(
      "HTTP 404: Healer Alpha was a stealth model revealed on March 18th as an early testing version of MiMo-V2-Omni. Find it here: https://openrouter.ai/xiaomi/mimo-v2-omni (request_id: req_test)",
    );
  });

  it("does not promote custom numeric error codes to HTTP status", () => {
    const info = parseApiErrorInfo(CUSTOM_NUMERIC_ERROR_CODE_PAYLOAD);

    expect(info).toEqual({
      httpCode: undefined,
      type: undefined,
      message: "Provider-specific error",
      requestId: undefined,
    });
    expect(formatRawAssistantErrorForUi(CUSTOM_NUMERIC_ERROR_CODE_PAYLOAD)).toBe(
      "LLM error: Provider-specific error",
    );
  });
});

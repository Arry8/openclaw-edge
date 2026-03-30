import { afterEach, describe, expect, it, vi } from "vitest";
import { isValidXaiVoice, XAI_TTS_VOICES, parseXaiOutputFormat } from "./speech-provider.js";

const { isValidXaiVoice, XAI_TTS_VOICES, parseXaiOutputFormat } = _test;

describe("isValidXaiVoice", () => {
  it("accepts all valid xAI voices", () => {
    for (const voice of XAI_TTS_VOICES) {
      expect(isValidXaiVoice(voice)).toBe(true);
    }
  });

  it("rejects invalid voice names", () => {
    expect(isValidXaiVoice("invalid")).toBe(false);
    expect(isValidXaiVoice("")).toBe(false);
    expect(isValidXaiVoice("EVE")).toBe(false);
    expect(isValidXaiVoice("eve ")).toBe(false);
    expect(isValidXaiVoice(" eve")).toBe(false);
  });
});

describe("parseXaiOutputFormat", () => {
  it("parses output format strings into API objects", () => {
    const cases = [
      {
        input: "mp3_44100_128",
        expected: { codec: "mp3", sample_rate: 44100, bit_rate: 128000 },
      },
      {
        input: "pcm_22050",
        expected: { codec: "pcm", sample_rate: 22050, bit_rate: null },
      },
      {
        input: "wav",
        expected: { codec: "wav", sample_rate: null, bit_rate: null },
      },
      {
        input: "mulaw_8000",
        expected: { codec: "mulaw", sample_rate: 8000, bit_rate: null },
      },
    ] as const;
    for (const testCase of cases) {
      expect(parseXaiOutputFormat(testCase.input), testCase.input).toEqual(testCase.expected);
    }
  });
});

import { describe, expect, it, vi } from "vitest";
import type { MsgContext } from "../auto-reply/templating.js";
import type { OpenClawConfig } from "../config/config.js";
import { EMPTY_AUDIO_TRANSCRIPT_PLACEHOLDER, transcribeFirstAudio } from "./audio-preflight.js";

const runAudioTranscriptionMock = vi.hoisted(() => vi.fn());

vi.mock("./audio-transcription-runner.js", () => ({
  runAudioTranscription: (...args: unknown[]) => runAudioTranscriptionMock(...args),
}));

describe("transcribeFirstAudio", () => {
  const cfg = {
    tools: {
      media: {
        audio: {
          enabled: true,
        },
      },
    },
  } as OpenClawConfig;

  const ctx: MsgContext = {
    MediaPath: "/tmp/voice.ogg",
    MediaType: "audio/ogg",
  };

  it("returns a clear placeholder when tiny audio is skipped", async () => {
    runAudioTranscriptionMock.mockResolvedValueOnce({
      transcript: undefined,
      attachments: [],
      skippedReason: "tooSmall",
    });

    await expect(transcribeFirstAudio({ ctx, cfg })).resolves.toBe(
      EMPTY_AUDIO_TRANSCRIPT_PLACEHOLDER,
    );
  });

  it("returns a clear placeholder when empty audio is skipped", async () => {
    runAudioTranscriptionMock.mockResolvedValueOnce({
      transcript: undefined,
      attachments: [],
      skippedReason: "empty",
    });

    await expect(transcribeFirstAudio({ ctx, cfg })).resolves.toBe(
      EMPTY_AUDIO_TRANSCRIPT_PLACEHOLDER,
    );
  });

  it("keeps returning undefined for non-empty skip reasons", async () => {
    runAudioTranscriptionMock.mockResolvedValueOnce({
      transcript: undefined,
      attachments: [],
      skippedReason: "timeout",
    });

    await expect(transcribeFirstAudio({ ctx, cfg })).resolves.toBeUndefined();
  });

  it("returns the actual transcript when transcription succeeds", async () => {
    runAudioTranscriptionMock.mockResolvedValueOnce({
      transcript: "hello from audio",
      attachments: [],
    });

    await expect(transcribeFirstAudio({ ctx, cfg })).resolves.toBe("hello from audio");
  });
});

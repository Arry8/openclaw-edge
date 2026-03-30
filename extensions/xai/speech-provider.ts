import type { SpeechProviderPlugin } from "openclaw/plugin-sdk/core";
import { type SpeechVoiceOption } from "openclaw/plugin-sdk/speech";

export const XAI_TTS_VOICES = ["eve", "ara", "rex", "sal", "leo"] as const;

export function isValidXaiVoice(voice: string): voice is (typeof XAI_TTS_VOICES)[number] {
  return XAI_TTS_VOICES.includes(voice as (typeof XAI_TTS_VOICES)[number]);
}

export function parseXaiOutputFormat(formatString: string): {
  codec: "mp3" | "wav" | "pcm" | "mulaw" | "alaw";
  sample_rate: number | null;
  bit_rate: number | null;
} {
  const parts = formatString.split("_");
  const codec = parts[0] as "mp3" | "wav" | "pcm" | "mulaw" | "alaw";
  const sampleRate = parts[1] ? parseInt(parts[1], 10) : null;
  const bitRate = parts[2] ? parseInt(parts[2], 10) * 1000 : null; // kb to b
  return {
    codec: codec || "mp3",
    sample_rate: sampleRate,
    bit_rate: bitRate,
  };
}

export async function xaiTTS(params: {
  text: string;
  apiKey: string;
  baseUrl: string;
  voiceId: string;
  outputFormat: string;
  language?: string;
  timeoutMs: number;
}): Promise<Buffer> {
  const { text, apiKey, baseUrl, voiceId, outputFormat, language, timeoutMs } = params;
  if (!isValidXaiVoice(voiceId)) {
    throw new Error(`Invalid voiceId: ${voiceId}`);
  }

  const outputFormatObj = parseXaiOutputFormat(outputFormat);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl}/tts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        voice_id: voiceId,
        output_format: outputFormatObj,
        language,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`xAI TTS API error (${response.status})`);
    }

    return Buffer.from(await response.arrayBuffer());
  } finally {
    clearTimeout(timeout);
  }
}

export function buildXaiSpeechProvider(): SpeechProviderPlugin {
  return {
    id: "xai",
    label: "xAI",
    voices: XAI_TTS_VOICES,
    listVoices: async (): Promise<SpeechVoiceOption[]> =>
      XAI_TTS_VOICES.map((voice) => ({ id: voice, name: voice })),
    isConfigured: ({ config }) => Boolean(config.xai.apiKey || process.env.XAI_API_KEY),
    synthesize: async (req) => {
      const apiKey = req.config.xai.apiKey || process.env.XAI_API_KEY;
      if (!apiKey) {
        throw new Error("xAI API key missing");
      }
      const outputFormat = "mp3_44100_128"; // Default output format
      const audioBuffer = await xaiTTS({
        text: req.text,
        apiKey,
        baseUrl: req.config.xai.baseUrl,
        voiceId: req.overrides?.xai?.voiceId ?? req.config.xai.voiceId,
        outputFormat,
        language: req.config.xai.language,
        timeoutMs: req.config.timeoutMs,
      });
      return {
        audioBuffer,
        outputFormat: "mp3",
        fileExtension: ".mp3",
        voiceCompatible: false,
      };
    },
    synthesizeTelephony: async (req) => {
      const apiKey = req.config.xai.apiKey || process.env.XAI_API_KEY;
      if (!apiKey) {
        throw new Error("xAI API key missing");
      }
      const outputFormat = "pcm_22050";
      const audioBuffer = await xaiTTS({
        text: req.text,
        apiKey,
        baseUrl: req.config.xai.baseUrl,
        voiceId: req.config.xai.voiceId,
        outputFormat,
        language: req.config.xai.language,
        timeoutMs: req.config.timeoutMs,
      });
      return { audioBuffer, outputFormat: "pcm", sampleRate: 22050 };
    },
  };
}

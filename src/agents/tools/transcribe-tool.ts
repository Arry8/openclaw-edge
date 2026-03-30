import path from "node:path";
import { Type } from "@sinclair/typebox";
import type { OpenClawConfig } from "../../config/config.js";
import { loadConfig } from "../../config/config.js";
import { runMediaUnderstandingFile } from "../../media-understanding/runtime.js";
import type { AnyAgentTool } from "./common.js";
import { readStringParam } from "./common.js";
import { resolveMediaToolLocalRoots } from "./media-tool-shared.js";
import type { ToolFsPolicy } from "./tool-runtime.helpers.js";

const TranscribeToolSchema = Type.Object({
  file_path: Type.String({
    description: "Absolute path to an audio file to transcribe (e.g. .ogg, .wav, .mp3).",
  }),
});

export function createTranscribeTool(opts?: {
  config?: OpenClawConfig;
  agentDir?: string;
  workspaceDir?: string;
  fsPolicy?: ToolFsPolicy;
}): AnyAgentTool {
  return {
    label: "Transcribe Audio",
    name: "transcribe_audio",
    description:
      "Transcribe an audio file to text using the configured speech-to-text provider. " +
      "Accepts common formats: OGG, WAV, MP3, M4A, WEBM. " +
      "Returns the transcribed text.",
    parameters: TranscribeToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const filePath = readStringParam(params, "file_path", { required: true });
      const cfg = opts?.config ?? loadConfig();

      // Enforce workspace scoping: restrict accessible paths to local roots
      const localRoots = resolveMediaToolLocalRoots(opts?.workspaceDir, {
        workspaceOnly: opts?.fsPolicy?.workspaceOnly === true,
      });
      const resolved = path.resolve(filePath);
      if (localRoots.length > 0 && !localRoots.some((root) => resolved.startsWith(root))) {
        return {
          content: [{ type: "text", text: `Access denied: path is outside allowed directories.` }],
          details: { error: "path_restricted" },
        };
      }

      const result = await runMediaUnderstandingFile({
        capability: "audio",
        filePath,
        cfg,
        agentDir: opts?.agentDir,
      });

      if (result.text) {
        return {
          content: [{ type: "text", text: result.text }],
          details: { provider: result.provider, model: result.model },
        };
      }

      return {
        content: [
          {
            type: "text",
            text: "Transcription failed or returned empty result.",
          },
        ],
        details: { error: "no transcript" },
      };
    },
  };
}

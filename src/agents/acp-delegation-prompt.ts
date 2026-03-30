import syncFs from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { OpenClawConfig } from "../config/config.js";
import type { SessionEntry } from "../config/sessions.js";
import { openBoundaryFile } from "../infra/boundary-file-read.js";
import { getRemoteSkillEligibility } from "../infra/skills-remote.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { resolveAgentSkillsFilter } from "./agent-scope.js";
import { resolveBootstrapContextForRun } from "./bootstrap-files.js";
import { resolveAgentIdentity } from "./identity.js";
import type { EmbeddedContextFile } from "./pi-embedded-helpers.js";
import {
  buildWorkspaceSkillSnapshot,
  resolveSkillsPromptForRun,
  type SkillSnapshot,
} from "./skills.js";
import { getSkillsSnapshotVersion } from "./skills/refresh.js";
import { buildSystemPromptParams } from "./system-prompt-params.js";
import { DEFAULT_MEMORY_ALT_FILENAME, DEFAULT_MEMORY_FILENAME } from "./workspace.js";

const log = createSubsystemLogger("agents/acp-delegation-prompt");
const DEFAULT_MEMORY_RESULTS = 3;
const MAX_MEMORY_SNIPPET_CHARS = 500;
const MEMORY_FILE_FALLBACK_SCORE = 0.01;

type WorkspaceMemorySnippet = {
  path: string;
  startLine: number;
  endLine: number;
  score: number;
  snippet: string;
};

export type AcpDelegationPromptParams = {
  cfg: OpenClawConfig;
  sessionId: string;
  sessionKey?: string;
  sessionEntry?: SessionEntry;
  agentId: string;
  delegateAgent: string;
  workspaceDir: string;
  userBody: string;
  memoryQuery: string;
  extraSystemPrompt?: string;
};

export type AcpDelegationPromptResult = {
  prompt: string;
  skillsSnapshot?: SkillSnapshot;
};

export async function buildAcpDelegationPrompt(
  params: AcpDelegationPromptParams,
): Promise<AcpDelegationPromptResult> {
  const identity = resolveAgentIdentity(params.cfg, params.agentId);
  const { runtimeInfo, userTime, userTimezone } = buildSystemPromptParams({
    config: params.cfg,
    agentId: params.agentId,
    workspaceDir: params.workspaceDir,
    cwd: params.workspaceDir,
    runtime: {
      host: os.hostname(),
      os: `${os.type()} ${os.release()}`,
      arch: os.arch(),
      node: process.version,
      model: `acp/${params.delegateAgent}`,
    },
  });

  const skillsSnapshot =
    params.sessionEntry?.skillsSnapshot ??
    resolveSkillsSnapshot({
      cfg: params.cfg,
      agentId: params.agentId,
      workspaceDir: params.workspaceDir,
    });
  const skillsPrompt = resolveSkillsPromptForRun({
    skillsSnapshot,
    config: params.cfg,
    workspaceDir: params.workspaceDir,
  }).trim();
  const contextFiles = await resolveContextFiles(params);
  const memoryResults = await resolveRelevantMemory(params);

  const lines = [
    "You are an ACP-delegated coding agent running under OpenClaw orchestration.",
    "",
    "# Mission",
    "Complete the requested coding task end-to-end inside the current workspace when feasible.",
    "Prefer concrete implementation progress over abstract advice when the task calls for code changes.",
    "Keep edits scoped and avoid unrelated refactors unless they are necessary to satisfy the request.",
    "",
    "# ACP Target",
    `Target agent: ${params.delegateAgent}`,
    "",
    "# OpenClaw Identity",
    `Agent id: ${params.agentId}`,
    ...formatIdentity(identity),
    "",
    "# Runtime Context",
    `Workspace: ${params.workspaceDir}`,
    ...(runtimeInfo.repoRoot ? [`Repo root: ${runtimeInfo.repoRoot}`] : []),
    `User time zone: ${userTimezone}`,
    ...(userTime ? [`User local time: ${userTime}`] : []),
    "",
    "# OpenClaw Rules",
    "- Treat the OpenClaw guidance below as required context for this delegated task.",
    "- Read the repository state before making major changes.",
    "- Run the most relevant verification steps before finishing.",
    "- If blocked, state the exact blocker and what you attempted.",
    ...formatAgentFlavor(params.delegateAgent),
    "",
    ...buildOptionalSection("Additional OpenClaw Instructions", params.extraSystemPrompt),
    ...buildOptionalSection("Skills Snapshot", skillsPrompt),
    ...buildOptionalSection("Relevant Memory", formatMemoryResults(memoryResults)),
    ...buildOptionalSection("Project Context", formatContextFiles(contextFiles)),
    "# Output Contract",
    "Return:",
    "1. What you changed",
    "2. What you verified",
    "3. Remaining risks or follow-up items",
    "",
    "# User Request",
    params.userBody,
  ];

  return {
    prompt: lines.join("\n").trim(),
    skillsSnapshot,
  };
}

function resolveSkillsSnapshot(params: {
  cfg: OpenClawConfig;
  agentId: string;
  workspaceDir: string;
}): SkillSnapshot | undefined {
  try {
    return buildWorkspaceSkillSnapshot(params.workspaceDir, {
      config: params.cfg,
      eligibility: { remote: getRemoteSkillEligibility() },
      snapshotVersion: getSkillsSnapshotVersion(params.workspaceDir),
      skillFilter: resolveAgentSkillsFilter(params.cfg, params.agentId),
    });
  } catch (error) {
    log.warn(
      `Could not build ACP skills snapshot for ${params.agentId}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return undefined;
  }
}

async function resolveContextFiles(
  params: AcpDelegationPromptParams,
): Promise<EmbeddedContextFile[]> {
  try {
    const { contextFiles } = await resolveBootstrapContextForRun({
      workspaceDir: params.workspaceDir,
      config: params.cfg,
      sessionKey: params.sessionKey,
      sessionId: params.sessionId,
      agentId: params.agentId,
      warn: (message) => log.warn(`ACP bootstrap context: ${message}`),
    });
    return contextFiles;
  } catch (error) {
    log.warn(
      `Could not resolve ACP bootstrap context for ${params.agentId}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return [];
  }
}

async function resolveRelevantMemory(
  params: AcpDelegationPromptParams,
): Promise<WorkspaceMemorySnippet[]> {
  const queryTerms = buildQueryTerms(params.memoryQuery);
  if (queryTerms.length === 0) {
    return [];
  }
  try {
    const files = await collectWorkspaceMemoryFiles(params.workspaceDir);
    const snippets: WorkspaceMemorySnippet[] = [];
    for (const filePath of files) {
      const content = await readWorkspaceMemoryFile({
        workspaceDir: params.workspaceDir,
        filePath,
      });
      if (!content) {
        continue;
      }
      const snippet = buildMemorySnippet({
        workspaceDir: params.workspaceDir,
        filePath,
        content,
        queryTerms,
      });
      if (snippet) {
        snippets.push(snippet);
      }
    }
    return snippets
      .toSorted((left, right) => right.score - left.score || left.path.localeCompare(right.path))
      .slice(0, DEFAULT_MEMORY_RESULTS);
  } catch (error) {
    log.warn(
      `Could not resolve ACP memory context for ${params.agentId}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return [];
  }
}

function formatIdentity(
  identity:
    | {
        name?: string;
        theme?: string;
        emoji?: string;
      }
    | undefined,
): string[] {
  const lines = [
    identity?.name?.trim() ? `Name: ${identity.name.trim()}` : undefined,
    identity?.theme?.trim() ? `Theme: ${identity.theme.trim()}` : undefined,
    identity?.emoji?.trim() ? `Emoji: ${identity.emoji.trim()}` : undefined,
  ].filter(Boolean) as string[];
  return lines.length > 0 ? lines : ["No explicit identity metadata was configured."];
}

function formatAgentFlavor(delegateAgent: string): string[] {
  const normalized = delegateAgent.trim().toLowerCase();
  if (normalized === "codex" || normalized === "opencode") {
    return [
      "- If your runtime supports parallel workers or subagents, use them only for independent tasks that materially speed up repository work.",
    ];
  }
  return [];
}

function buildOptionalSection(title: string, content?: string): string[] {
  const trimmed = content?.trim();
  if (!trimmed) {
    return [];
  }
  return [`# ${title}`, trimmed, ""];
}

function formatMemoryResults(results: WorkspaceMemorySnippet[]): string {
  if (results.length === 0) {
    return "";
  }
  return results
    .map((result) => {
      const snippet = result.snippet.trim();
      return [
        `- ${result.path}:${String(result.startLine)}-${String(result.endLine)} (score ${result.score.toFixed(2)})`,
        snippet,
      ].join("\n");
    })
    .join("\n\n");
}

function formatContextFiles(files: EmbeddedContextFile[]): string {
  const validFiles = files.filter((file) => file.path.trim() && file.content.trim());
  if (validFiles.length === 0) {
    return "";
  }
  return validFiles
    .map((file) => [`## ${file.path}`, file.content.trim()].join("\n\n"))
    .join("\n\n");
}

async function collectWorkspaceMemoryFiles(workspaceDir: string): Promise<string[]> {
  const candidates: string[] = [];
  for (const name of [DEFAULT_MEMORY_FILENAME, DEFAULT_MEMORY_ALT_FILENAME] as const) {
    const rootMemoryFile = path.join(workspaceDir, name);
    if (await fileExists(rootMemoryFile)) {
      candidates.push(rootMemoryFile);
      break;
    }
  }

  const memoryDir = path.join(workspaceDir, "memory");
  const entries = await fs.readdir(memoryDir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) {
      continue;
    }
    candidates.push(path.join(memoryDir, entry.name));
  }
  return candidates;
}

function buildQueryTerms(query: string): string[] {
  const normalized = query
    .toLowerCase()
    .replace(/[^a-z0-9_\u4e00-\u9fff\s-]/g, " ")
    .split(/\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 3);
  return Array.from(new Set(normalized)).slice(0, 12);
}

function buildMemorySnippet(params: {
  workspaceDir: string;
  filePath: string;
  content: string;
  queryTerms: string[];
}): WorkspaceMemorySnippet | null {
  const rawContent = params.content;
  const trimmed = rawContent.trim();
  if (!trimmed) {
    return null;
  }

  const lines = rawContent.split(/\r?\n/);
  let bestScore = 0;
  let bestLineIndex = -1;

  for (const [index, line] of lines.entries()) {
    const score = scoreLine(line, params.queryTerms);
    if (score > bestScore) {
      bestScore = score;
      bestLineIndex = index;
    }
  }

  if (bestScore <= 0) {
    const baseName = path.basename(params.filePath).toLowerCase();
    if (baseName !== "memory.md") {
      return null;
    }
    bestScore = MEMORY_FILE_FALLBACK_SCORE;
    bestLineIndex = 0;
  }

  const startLine = Math.max(0, bestLineIndex - 2);
  const endLine = Math.min(lines.length - 1, bestLineIndex + 4);
  const snippet = lines
    .slice(startLine, endLine + 1)
    .join("\n")
    .trim()
    .slice(0, MAX_MEMORY_SNIPPET_CHARS);
  if (!snippet) {
    return null;
  }

  return {
    path: path.relative(params.workspaceDir, params.filePath).replaceAll(path.sep, "/"),
    startLine: startLine + 1,
    endLine: endLine + 1,
    score: bestScore,
    snippet,
  };
}

function scoreLine(line: string, queryTerms: string[]): number {
  const lower = line.toLowerCase();
  let score = 0;
  for (const term of queryTerms) {
    if (lower.includes(term)) {
      score += term.length >= 6 ? 2 : 1;
    }
  }
  return score;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readWorkspaceMemoryFile(params: {
  workspaceDir: string;
  filePath: string;
}): Promise<string | null> {
  const opened = await openBoundaryFile({
    absolutePath: params.filePath,
    rootPath: params.workspaceDir,
    boundaryLabel: "workspace root",
  });
  if (!opened.ok) {
    return null;
  }
  try {
    return syncFs.readFileSync(opened.fd, "utf8");
  } catch {
    return null;
  } finally {
    syncFs.closeSync(opened.fd);
  }
}

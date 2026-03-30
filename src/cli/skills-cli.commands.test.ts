import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SkillStatusEntry, SkillStatusReport } from "../agents/skills-status.js";
import { createEmptyInstallChecks } from "./requirements-test-fixtures.js";
import { createCliRuntimeCapture } from "./test-runtime-capture.js";

const loadConfigMock = vi.fn(() => ({}));
const resolveDefaultAgentIdMock = vi.fn(() => "main");
const resolveAgentWorkspaceDirMock = vi.fn(() => "/tmp/workspace");
const searchSkillsFromClawHubMock = vi.fn();
const installSkillFromClawHubMock = vi.fn();
const updateSkillsFromClawHubMock = vi.fn();
const readTrackedClawHubSkillSlugsMock = vi.fn();
const buildWorkspaceSkillStatusMock = vi.fn();

const { defaultRuntime, runtimeLogs, runtimeErrors, resetRuntimeCapture } =
  createCliRuntimeCapture();

vi.mock("../runtime.js", () => ({
  defaultRuntime,
}));

vi.mock("../config/config.js", () => ({
  loadConfig: () => loadConfigMock(),
}));

vi.mock("../agents/agent-scope.js", () => ({
  resolveDefaultAgentId: () => resolveDefaultAgentIdMock(),
  resolveAgentWorkspaceDir: () => resolveAgentWorkspaceDirMock(),
}));

vi.mock("../agents/skills-clawhub.js", () => ({
  searchSkillsFromClawHub: (...args: unknown[]) => searchSkillsFromClawHubMock(...args),
  installSkillFromClawHub: (...args: unknown[]) => installSkillFromClawHubMock(...args),
  updateSkillsFromClawHub: (...args: unknown[]) => updateSkillsFromClawHubMock(...args),
  readTrackedClawHubSkillSlugs: (...args: unknown[]) => readTrackedClawHubSkillSlugsMock(...args),
}));

vi.mock("../agents/skills-status.js", () => ({
  buildWorkspaceSkillStatus: (...args: unknown[]) => buildWorkspaceSkillStatusMock(...args),
}));

const { registerSkillsCli } = await import("./skills-cli.js");

function createMockSkill(overrides: Partial<SkillStatusEntry> = {}): SkillStatusEntry {
  return {
    name: "test-skill",
    description: "A test skill",
    source: "bundled",
    bundled: false,
    filePath: "/path/to/SKILL.md",
    baseDir: "/path/to",
    skillKey: "test-skill",
    emoji: "🧪",
    homepage: "https://example.com",
    always: false,
    disabled: false,
    blockedByAllowlist: false,
    eligible: true,
    ...createEmptyInstallChecks(),
    ...overrides,
  };
}

function createMockReport(skills: SkillStatusEntry[]): SkillStatusReport {
  return {
    workspaceDir: "/workspace",
    managedSkillsDir: "/managed",
    skills,
  };
}

describe("skills cli commands", () => {
  const createProgram = () => {
    const program = new Command();
    program.exitOverride();
    registerSkillsCli(program);
    return program;
  };

  const runCommand = (argv: string[]) => createProgram().parseAsync(argv, { from: "user" });

  beforeEach(() => {
    resetRuntimeCapture();
    defaultRuntime.log.mockClear();
    defaultRuntime.error.mockClear();
    defaultRuntime.exit.mockClear();
    defaultRuntime.writeJson.mockClear();
    defaultRuntime.writeStdout.mockClear();
    loadConfigMock.mockReset();
    resolveDefaultAgentIdMock.mockReset();
    resolveAgentWorkspaceDirMock.mockReset();
    searchSkillsFromClawHubMock.mockReset();
    installSkillFromClawHubMock.mockReset();
    updateSkillsFromClawHubMock.mockReset();
    readTrackedClawHubSkillSlugsMock.mockReset();
    buildWorkspaceSkillStatusMock.mockReset();

    loadConfigMock.mockReturnValue({});
    resolveDefaultAgentIdMock.mockReturnValue("main");
    resolveAgentWorkspaceDirMock.mockReturnValue("/tmp/workspace");
    searchSkillsFromClawHubMock.mockResolvedValue([]);
    installSkillFromClawHubMock.mockResolvedValue({
      ok: false,
      error: "install disabled in test",
    });
    updateSkillsFromClawHubMock.mockResolvedValue([]);
    readTrackedClawHubSkillSlugsMock.mockResolvedValue([]);
    buildWorkspaceSkillStatusMock.mockResolvedValue(
      createMockReport([createMockSkill({ name: "json-skill" })]),
    );
  });

  it("searches ClawHub skills from the native CLI", async () => {
    searchSkillsFromClawHubMock.mockResolvedValue([
      {
        slug: "calendar",
        displayName: "Calendar",
        summary: "CalDAV helpers",
        version: "1.2.3",
      },
    ]);

    await runCommand(["skills", "search", "calendar"]);

    expect(searchSkillsFromClawHubMock).toHaveBeenCalledWith({
      query: "calendar",
      limit: undefined,
    });
    expect(runtimeLogs.some((line) => line.includes("calendar v1.2.3  Calendar"))).toBe(true);
  });

  it("installs a skill from ClawHub into the active workspace", async () => {
    installSkillFromClawHubMock.mockResolvedValue({
      ok: true,
      slug: "calendar",
      version: "1.2.3",
      targetDir: "/tmp/workspace/skills/calendar",
    });

    await runCommand(["skills", "install", "calendar", "--version", "1.2.3"]);

    expect(installSkillFromClawHubMock).toHaveBeenCalledWith({
      workspaceDir: "/tmp/workspace",
      slug: "calendar",
      version: "1.2.3",
      force: false,
      logger: expect.any(Object),
    });
    expect(
      runtimeLogs.some((line) =>
        line.includes("Installed calendar@1.2.3 -> /tmp/workspace/skills/calendar"),
      ),
    ).toBe(true);
  });

  it("updates all tracked ClawHub skills", async () => {
    readTrackedClawHubSkillSlugsMock.mockResolvedValue(["calendar"]);
    updateSkillsFromClawHubMock.mockResolvedValue([
      {
        ok: true,
        slug: "calendar",
        previousVersion: "1.2.2",
        version: "1.2.3",
        changed: true,
        targetDir: "/tmp/workspace/skills/calendar",
      },
    ]);

    await runCommand(["skills", "update", "--all"]);

    expect(readTrackedClawHubSkillSlugsMock).toHaveBeenCalledWith("/tmp/workspace");
    expect(updateSkillsFromClawHubMock).toHaveBeenCalledWith({
      workspaceDir: "/tmp/workspace",
      slug: undefined,
      logger: expect.any(Object),
    });
    expect(runtimeLogs.some((line) => line.includes("Updated calendar: 1.2.2 -> 1.2.3"))).toBe(
      true,
    );
    expect(runtimeErrors).toEqual([]);
  });

  it("writes skills list JSON to stdout", async () => {
    await runCommand(["skills", "list", "--json"]);

    expect(buildWorkspaceSkillStatusMock).toHaveBeenCalledWith("/tmp/workspace", {
      config: {},
    });
    expect(defaultRuntime.writeStdout).toHaveBeenCalledTimes(1);
    expect(defaultRuntime.error).not.toHaveBeenCalled();
    expect(runtimeErrors).toEqual([]);
    expect(JSON.parse(String(defaultRuntime.writeStdout.mock.calls[0]?.[0] ?? ""))).toEqual({
      workspaceDir: "/workspace",
      managedSkillsDir: "/managed",
      skills: [
        {
          name: "json-skill",
          description: "A test skill",
          emoji: "🧪",
          eligible: true,
          disabled: false,
          blockedByAllowlist: false,
          source: "bundled",
          bundled: false,
          primaryEnv: undefined,
          homepage: "https://example.com",
          missing: {
            bins: [],
            anyBins: [],
            env: [],
            config: [],
            os: [],
          },
        },
      ],
    });
  });

  it("writes skills info JSON to stdout", async () => {
    buildWorkspaceSkillStatusMock.mockResolvedValueOnce(
      createMockReport([createMockSkill({ name: "info-skill", skillKey: "info-skill" })]),
    );

    await runCommand(["skills", "info", "info-skill", "--json"]);

    expect(defaultRuntime.writeStdout).toHaveBeenCalledTimes(1);
    expect(defaultRuntime.error).not.toHaveBeenCalled();
    expect(runtimeErrors).toEqual([]);
    expect(JSON.parse(String(defaultRuntime.writeStdout.mock.calls[0]?.[0] ?? ""))).toMatchObject({
      name: "info-skill",
      skillKey: "info-skill",
      eligible: true,
    });
  });

  it("writes skills check JSON to stdout", async () => {
    buildWorkspaceSkillStatusMock.mockResolvedValueOnce(
      createMockReport([
        createMockSkill({ name: "ready-skill", eligible: true }),
        createMockSkill({
          name: "needs-setup",
          eligible: false,
          missing: {
            bins: ["ffmpeg"],
            anyBins: [],
            env: [],
            config: [],
            os: [],
          },
        }),
      ]),
    );

    await runCommand(["skills", "check", "--json"]);

    expect(defaultRuntime.writeStdout).toHaveBeenCalledTimes(1);
    expect(defaultRuntime.error).not.toHaveBeenCalled();
    expect(runtimeErrors).toEqual([]);
    expect(JSON.parse(String(defaultRuntime.writeStdout.mock.calls[0]?.[0] ?? ""))).toEqual({
      summary: {
        total: 2,
        eligible: 1,
        disabled: 0,
        blocked: 0,
        missingRequirements: 1,
      },
      eligible: ["ready-skill"],
      disabled: [],
      blocked: [],
      missingRequirements: [
        {
          name: "needs-setup",
          missing: {
            bins: ["ffmpeg"],
            anyBins: [],
            env: [],
            config: [],
            os: [],
          },
          install: [],
        },
      ],
    });
  });

  it("keeps non-JSON skills output on stdout", async () => {
    buildWorkspaceSkillStatusMock.mockResolvedValueOnce(
      createMockReport([createMockSkill({ name: "human-skill" })]),
    );

    await runCommand(["skills", "list"]);

    expect(defaultRuntime.writeStdout).toHaveBeenCalledTimes(1);
    expect(defaultRuntime.error).not.toHaveBeenCalled();
    expect(runtimeErrors).toEqual([]);
    expect(String(defaultRuntime.writeStdout.mock.calls[0]?.[0] ?? "")).toContain("human-skill");
    expect(String(defaultRuntime.writeStdout.mock.calls[0]?.[0] ?? "")).toContain("Skills");
  });
});

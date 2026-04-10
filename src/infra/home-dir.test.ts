import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  expandEnvVars,
  expandHomePrefix,
  resolveEffectiveHomeDir,
  resolveHomeRelativePath,
  resolveOsHomeDir,
  resolveOsHomeRelativePath,
  resolveRequiredHomeDir,
} from "./home-dir.js";

describe("resolveEffectiveHomeDir", () => {
  it.each([
    {
      name: "prefers OPENCLAW_HOME over HOME and USERPROFILE",
      env: {
        OPENCLAW_HOME: " /srv/openclaw-home ",
        HOME: "/home/other",
        USERPROFILE: "C:/Users/other",
      } as NodeJS.ProcessEnv,
      homedir: () => "/fallback",
      expected: "/srv/openclaw-home",
    },
    {
      name: "falls back to HOME",
      env: { HOME: " /home/alice " } as NodeJS.ProcessEnv,
      expected: "/home/alice",
    },
    {
      name: "falls back to USERPROFILE when HOME is blank",
      env: {
        HOME: "   ",
        USERPROFILE: " C:/Users/alice ",
      } as NodeJS.ProcessEnv,
      expected: "C:/Users/alice",
    },
    {
      name: "falls back to homedir when env values are blank",
      env: {
        OPENCLAW_HOME: " ",
        HOME: " ",
        USERPROFILE: "\t",
      } as NodeJS.ProcessEnv,
      homedir: () => " /fallback ",
      expected: "/fallback",
    },
    {
      name: "treats literal undefined env values as unset",
      env: {
        OPENCLAW_HOME: "undefined",
        HOME: "undefined",
        USERPROFILE: "null",
      } as NodeJS.ProcessEnv,
      homedir: () => " /fallback ",
      expected: "/fallback",
    },
  ])("$name", ({ env, homedir, expected }) => {
    expect(resolveEffectiveHomeDir(env, homedir)).toBe(path.resolve(expected));
  });

  it.each([
    {
      name: "expands ~/ using HOME",
      env: {
        OPENCLAW_HOME: "~/svc",
        HOME: "/home/alice",
      } as NodeJS.ProcessEnv,
      expected: "/home/alice/svc",
    },
    {
      name: "expands ~\\\\ using USERPROFILE",
      env: {
        OPENCLAW_HOME: "~\\svc",
        HOME: " ",
        USERPROFILE: "C:/Users/alice",
      } as NodeJS.ProcessEnv,
      expected: "C:/Users/alice\\svc",
    },
  ])("$name", ({ env, expected }) => {
    expect(resolveEffectiveHomeDir(env)).toBe(path.resolve(expected));
  });
});

describe("resolveRequiredHomeDir", () => {
  it.each([
    {
      name: "returns cwd when no home source is available",
      env: {} as NodeJS.ProcessEnv,
      homedir: () => {
        throw new Error("no home");
      },
      expected: process.cwd(),
    },
    {
      name: "returns a fully resolved path for OPENCLAW_HOME",
      env: { OPENCLAW_HOME: "/custom/home" } as NodeJS.ProcessEnv,
      homedir: () => "/fallback",
      expected: path.resolve("/custom/home"),
    },
    {
      name: "returns cwd when OPENCLAW_HOME is tilde-only and no fallback home exists",
      env: { OPENCLAW_HOME: "~" } as NodeJS.ProcessEnv,
      homedir: () => {
        throw new Error("no home");
      },
      expected: process.cwd(),
    },
  ])("$name", ({ env, homedir, expected }) => {
    expect(resolveRequiredHomeDir(env, homedir)).toBe(expected);
  });
});

describe("resolveOsHomeDir", () => {
  it("ignores OPENCLAW_HOME and uses HOME", () => {
    expect(
      resolveOsHomeDir(
        {
          OPENCLAW_HOME: "/srv/openclaw-home",
          HOME: "/home/alice",
          USERPROFILE: "C:/Users/alice",
        } as NodeJS.ProcessEnv,
        () => "/fallback",
      ),
    ).toBe(path.resolve("/home/alice"));
  });
});

describe("expandHomePrefix", () => {
  it.each([
    {
      name: "expands ~/ using effective home",
      input: "~/x",
      opts: {
        env: { OPENCLAW_HOME: "/srv/openclaw-home" } as NodeJS.ProcessEnv,
      },
      expected: `${path.resolve("/srv/openclaw-home")}/x`,
    },
    {
      name: "expands exact ~ using explicit home",
      input: "~",
      opts: { home: " /srv/openclaw-home " },
      expected: "/srv/openclaw-home",
    },
    {
      name: "expands ~\\\\ using resolved env home",
      input: "~\\x",
      opts: {
        env: { HOME: "/home/alice" } as NodeJS.ProcessEnv,
      },
      expected: `${path.resolve("/home/alice")}\\x`,
    },
    {
      name: "keeps non-tilde values unchanged",
      input: "/tmp/x",
      expected: "/tmp/x",
    },
  ])("$name", ({ input, opts, expected }) => {
    expect(expandHomePrefix(input, opts)).toBe(expected);
  });
});

describe("resolveHomeRelativePath", () => {
  it.each([
    {
      name: "returns blank input unchanged",
      input: "   ",
      expected: "",
    },
    {
      name: "resolves trimmed relative paths",
      input: " ./tmp/file.txt ",
      expected: path.resolve("./tmp/file.txt"),
    },
    {
      name: "resolves trimmed absolute paths",
      input: " /tmp/file.txt ",
      expected: path.resolve("/tmp/file.txt"),
    },
    {
      name: "expands tilde paths using the resolved home directory",
      input: "~/docs",
      opts: {
        env: { OPENCLAW_HOME: "/srv/openclaw-home" } as NodeJS.ProcessEnv,
      },
      expected: path.resolve("/srv/openclaw-home/docs"),
    },
    {
      name: "falls back to cwd when tilde paths have no home source",
      input: "~",
      opts: {
        env: {} as NodeJS.ProcessEnv,
        homedir: () => {
          throw new Error("no home");
        },
      },
      expected: path.resolve(process.cwd()),
    },
    {
      name: "expands ${VAR} references in paths",
      input: "${XDG_CONFIG_HOME}/openclaw/workspace",
      opts: {
        env: {
          XDG_CONFIG_HOME: "/home/node/.config",
          HOME: "/home/node",
        } as NodeJS.ProcessEnv,
      },
      expected: path.resolve("/home/node/.config/openclaw/workspace"),
    },
    {
      name: "expands $VAR references in paths",
      input: "$XDG_CONFIG_HOME/openclaw/workspace",
      opts: {
        env: {
          XDG_CONFIG_HOME: "/home/node/.config",
          HOME: "/home/node",
        } as NodeJS.ProcessEnv,
      },
      expected: path.resolve("/home/node/.config/openclaw/workspace"),
    },
    {
      name: "expands env vars before tilde expansion",
      input: "~/${SUBDIR}/skills",
      opts: {
        env: {
          SUBDIR: "project",
          HOME: "/home/alice",
        } as NodeJS.ProcessEnv,
      },
      expected: path.resolve("/home/alice/project/skills"),
    },
  ])("$name", ({ input, opts, expected }) => {
    expect(resolveHomeRelativePath(input, opts)).toBe(expected);
  });
});

describe("resolveOsHomeRelativePath", () => {
  it("expands tilde paths using the OS home instead of OPENCLAW_HOME", () => {
    expect(
      resolveOsHomeRelativePath("~/docs", {
        env: {
          OPENCLAW_HOME: "/srv/openclaw-home",
          HOME: "/home/alice",
        } as NodeJS.ProcessEnv,
      }),
    ).toBe(path.resolve("/home/alice/docs"));
  });

  it("expands ${VAR} references using the provided environment", () => {
    expect(
      resolveOsHomeRelativePath("${XDG_CONFIG_HOME}/workspace", {
        env: {
          XDG_CONFIG_HOME: "/home/alice/.config",
          HOME: "/home/alice",
        } as NodeJS.ProcessEnv,
      }),
    ).toBe(path.resolve("/home/alice/.config/workspace"));
  });
});

describe("expandEnvVars", () => {
  it("expands ${VAR} references", () => {
    expect(
      expandEnvVars("${XDG_CONFIG_HOME}/openclaw/workspace", {
        XDG_CONFIG_HOME: "/home/alice/.config",
      } as NodeJS.ProcessEnv),
    ).toBe("/home/alice/.config/openclaw/workspace");
  });

  it("expands $VAR references (unbraced)", () => {
    expect(
      expandEnvVars("$HOME/workspace", {
        HOME: "/home/alice",
      } as NodeJS.ProcessEnv),
    ).toBe("/home/alice/workspace");
  });

  it("expands multiple variables in one string", () => {
    expect(
      expandEnvVars("${BASE}/$SUB/file", {
        BASE: "/srv",
        SUB: "data",
      } as NodeJS.ProcessEnv),
    ).toBe("/srv/data/file");
  });

  it("replaces unknown variables with empty string", () => {
    expect(
      expandEnvVars("${NONEXISTENT_VAR}/path", {} as NodeJS.ProcessEnv),
    ).toBe("/path");
  });

  it("trims whitespace from variable values", () => {
    expect(
      expandEnvVars("${MY_DIR}/sub", {
        MY_DIR: "  /trimmed  ",
      } as NodeJS.ProcessEnv),
    ).toBe("/trimmed/sub");
  });

  it("returns input unchanged when no variables are present", () => {
    expect(expandEnvVars("/plain/path", {} as NodeJS.ProcessEnv)).toBe("/plain/path");
  });

  it("handles empty variable values", () => {
    expect(
      expandEnvVars("${EMPTY}/path", {
        EMPTY: "",
      } as NodeJS.ProcessEnv),
    ).toBe("/path");
  });
});

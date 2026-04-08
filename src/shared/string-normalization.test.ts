import { describe, expect, it } from "vitest";
import {
  normalizeAtHashSlug,
  normalizeHyphenSlug,
  normalizeStringEntries,
  normalizeStringEntriesLower,
} from "./string-normalization.js";

describe("shared/string-normalization", () => {
  it("normalizes mixed allow-list entries", () => {
    expect(normalizeStringEntries([" a ", 42, "", "  ", "z"])).toEqual(["a", "42", "z"]);
    expect(normalizeStringEntries([" ok ", null, { toString: () => " obj " }])).toEqual([
      "ok",
      "null",
      "obj",
    ]);
    expect(normalizeStringEntries(undefined)).toEqual([]);
  });

  it("normalizes mixed allow-list entries to lowercase", () => {
    expect(normalizeStringEntriesLower([" A ", "MiXeD", 7])).toEqual(["a", "mixed", "7"]);
  });

  it("normalizes slug-like labels while preserving supported symbols", () => {
    expect(normalizeHyphenSlug("  Team Room  ")).toBe("team-room");
    expect(normalizeHyphenSlug(" #My_Channel + Alerts ")).toBe("#my_channel-+-alerts");
    expect(normalizeHyphenSlug("..foo---bar..")).toBe("foo-bar");
    expect(normalizeHyphenSlug(undefined)).toBe("");
    expect(normalizeHyphenSlug(null)).toBe("");
  });

  it("collapses repeated separators and trims leading/trailing punctuation", () => {
    expect(normalizeHyphenSlug("  ...Hello   /  World---  ")).toBe("hello-world");
    expect(normalizeHyphenSlug(" ###Team@@@Room### ")).toBe("###team@@@room###");
  });

  it("normalizes @/# prefixed slugs used by channel allowlists", () => {
    expect(normalizeAtHashSlug(" #My_Channel + Alerts ")).toBe("my-channel-alerts");
    expect(normalizeAtHashSlug("@@Room___Name")).toBe("room-name");
    expect(normalizeAtHashSlug(undefined)).toBe("");
    expect(normalizeAtHashSlug(null)).toBe("");
  });

  it("strips repeated prefixes and collapses separator-only results", () => {
    expect(normalizeAtHashSlug("###__Room  Name__")).toBe("room-name");
    expect(normalizeAtHashSlug("@@@___")).toBe("");
  });

  it("preserves CJK characters in normalizeHyphenSlug", () => {
    // Chinese
    expect(normalizeHyphenSlug("技术讨论组")).toBe("技术讨论组");
    expect(normalizeHyphenSlug("  AI 助手群  ")).toBe("ai-助手群");
    // Japanese
    expect(normalizeHyphenSlug("友達グループ")).toBe("友達グループ");
    // Korean
    expect(normalizeHyphenSlug("개발자 모임")).toBe("개발자-모임");
    // Mixed Latin and CJK
    expect(normalizeHyphenSlug("Team 技术讨论")).toBe("team-技术讨论");
    expect(normalizeHyphenSlug("#OpenClaw中文群")).toBe("#openclaw中文群");
  });

  it("preserves Cyrillic and Arabic characters in normalizeHyphenSlug", () => {
    // Cyrillic (Russian)
    expect(normalizeHyphenSlug("Команда разработки")).toBe("команда-разработки");
    // Arabic
    expect(normalizeHyphenSlug("فريق التطوير")).toBe("فريق-التطوير");
  });

  it("preserves CJK characters in normalizeAtHashSlug", () => {
    // Chinese
    expect(normalizeAtHashSlug("#技术频道")).toBe("技术频道");
    expect(normalizeAtHashSlug("@中文群组")).toBe("中文群组");
    // Japanese
    expect(normalizeAtHashSlug("#日本語チャンネル")).toBe("日本語チャンネル");
    // Korean
    expect(normalizeAtHashSlug("#한국어채널")).toBe("한국어채널");
  });
});

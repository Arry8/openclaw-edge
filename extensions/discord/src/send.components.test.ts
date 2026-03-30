import { ChannelType } from "discord-api-types/v10";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeDiscordRest } from "./send.test-harness.js";

const loadConfigMock = vi.hoisted(() => vi.fn(() => ({ session: { dmScope: "main" } })));

vi.mock("openclaw/plugin-sdk/config-runtime", async () => {
  const actual = await vi.importActual<typeof import("openclaw/plugin-sdk/config-runtime")>(
    "openclaw/plugin-sdk/config-runtime",
  );
  return {
    ...actual,
    loadConfig: (..._args: unknown[]) => loadConfigMock(),
  };
});

vi.mock("./components-registry.js", () => ({
  registerDiscordComponentEntries: vi.fn(),
}));

let registerDiscordComponentEntries: typeof import("./components-registry.js").registerDiscordComponentEntries;
let editDiscordComponentMessage: typeof import("./send.components.js").editDiscordComponentMessage;
let registerBuiltDiscordComponentMessage: typeof import("./send.components.js").registerBuiltDiscordComponentMessage;
let sendDiscordComponentMessage: typeof import("./send.components.js").sendDiscordComponentMessage;
let buildComponentTranscriptText: typeof import("./send.components.js").buildComponentTranscriptText;

describe("sendDiscordComponentMessage", () => {
  let registerMock: ReturnType<typeof vi.mocked<typeof registerDiscordComponentEntries>>;

  beforeEach(async () => {
    vi.resetModules();
    ({ registerDiscordComponentEntries } = await import("./components-registry.js"));
    ({
      buildComponentTranscriptText,
      editDiscordComponentMessage,
      registerBuiltDiscordComponentMessage,
      sendDiscordComponentMessage,
    } = await import("./send.components.js"));
    registerMock = vi.mocked(registerDiscordComponentEntries);
    vi.clearAllMocks();
  });

  it("keeps direct-channel DM session keys on component entries", async () => {
    const { rest, postMock, getMock } = makeDiscordRest();
    getMock.mockResolvedValueOnce({
      type: ChannelType.DM,
      recipients: [{ id: "user-1" }],
    });
    postMock.mockResolvedValueOnce({ id: "msg1", channel_id: "dm-1" });

    await sendDiscordComponentMessage(
      "channel:dm-1",
      {
        blocks: [{ type: "actions", buttons: [{ label: "Tap" }] }],
      },
      {
        rest,
        token: "t",
        sessionKey: "agent:main:discord:channel:dm-1",
        agentId: "main",
      },
    );

    expect(registerMock).toHaveBeenCalledTimes(1);
    const args = registerMock.mock.calls[0]?.[0];
    expect(args?.entries[0]?.sessionKey).toBe("agent:main:discord:channel:dm-1");
  });

  it("edits component messages and refreshes component registry entries", async () => {
    const { rest, patchMock, getMock } = makeDiscordRest();
    getMock.mockResolvedValueOnce({
      type: ChannelType.GuildText,
      id: "chan-1",
    });
    patchMock.mockResolvedValueOnce({ id: "msg1", channel_id: "chan-1" });

    await editDiscordComponentMessage(
      "channel:chan-1",
      "msg1",
      {
        text: "Updated picker",
        blocks: [{ type: "actions", buttons: [{ label: "Tap" }] }],
      },
      {
        rest,
        token: "t",
        sessionKey: "agent:main:discord:channel:chan-1",
        agentId: "main",
      },
    );

    expect(patchMock).toHaveBeenCalledWith(
      expect.stringContaining("/channels/chan-1/messages/msg1"),
      expect.objectContaining({
        body: expect.any(Object),
      }),
    );
    expect(registerMock).toHaveBeenCalledTimes(1);
    const args = registerMock.mock.calls[0]?.[0];
    expect(args?.messageId).toBe("msg1");
    expect(args?.entries[0]?.sessionKey).toBe("agent:main:discord:channel:chan-1");
  });

  it("registers a prebuilt component message against an edited message id", () => {
    registerBuiltDiscordComponentMessage({
      messageId: "msg1",
      buildResult: {
        components: [],
        entries: [{ id: "entry-1", kind: "button", label: "Tap" }],
        modals: [{ id: "modal-1", title: "Modal", fields: [] }],
      },
    });

    expect(registerMock).toHaveBeenCalledWith({
      entries: [{ id: "entry-1", kind: "button", label: "Tap" }],
      modals: [{ id: "modal-1", title: "Modal", fields: [] }],
      messageId: "msg1",
    });
  });

  it("buildComponentTranscriptText includes text, section, and action labels", () => {
    const text = buildComponentTranscriptText({
      text: "Heading",
      blocks: [
        { type: "text", text: "Body line" },
        { type: "section", text: "Section title", texts: ["Detail A", "Detail B"] },
        { type: "actions", buttons: [{ label: "Go" }], select: { placeholder: "Choose one" } },
        { type: "separator" },
      ],
    });

    expect(text).toBe("Heading\nBody line\nSection title\nDetail A\nDetail B\n[Go]\n[Choose one]");
  });

  it("buildComponentTranscriptText summarizes select option labels when present", () => {
    const text = buildComponentTranscriptText({
      text: "Pick a color",
      blocks: [
        {
          type: "actions",
          select: {
            placeholder: "Choose one",
            options: [
              { label: "Red", value: "red" },
              { label: "Green", value: "green" },
              { label: "Blue", value: "blue" },
            ],
          },
        },
      ],
    });

    expect(text).toBe("Pick a color\n[Red] [Green] [Blue]");
  });

  it("buildComponentTranscriptText falls back to placeholder for selects without options", () => {
    const text = buildComponentTranscriptText({
      blocks: [{ type: "actions", select: { type: "user", placeholder: "Pick a user" } }],
    });

    expect(text).toBe("[Pick a user]");
  });

  it("buildComponentTranscriptText returns empty string for empty spec", () => {
    expect(buildComponentTranscriptText({})).toBe("");
    expect(buildComponentTranscriptText({ blocks: [{ type: "separator" }] })).toBe("");
  });

  it("buildComponentTranscriptText includes section accessory button labels", () => {
    const text = buildComponentTranscriptText({
      blocks: [
        {
          type: "section",
          text: "Order #1234",
          accessory: { type: "button", button: { label: "View details" } },
        },
      ],
    });

    expect(text).toBe("Order #1234\n[View details]");
  });

  it("buildComponentTranscriptText includes modal trigger label", () => {
    const text = buildComponentTranscriptText({
      text: "Submit your feedback",
      modal: {
        title: "Feedback form",
        triggerLabel: "Open form",
        fields: [{ type: "text", name: "comment", label: "Comment" }],
      },
    });

    expect(text).toBe("Submit your feedback\n[Open form]");
  });

  it("buildComponentTranscriptText falls back to default modal trigger label when triggerLabel absent", () => {
    const text = buildComponentTranscriptText({
      text: "Submit your feedback",
      modal: {
        title: "Feedback form",
        fields: [{ type: "text", name: "comment", label: "Comment" }],
      },
    });

    expect(text).toBe("Submit your feedback\n[Open form]");
  });

  it("buildComponentTranscriptText omits section thumbnail accessories", () => {
    const text = buildComponentTranscriptText({
      blocks: [
        {
          type: "section",
          text: "Product info",
          accessory: { type: "thumbnail", url: "https://example.com/img.png" },
        },
      ],
    });

    expect(text).toBe("Product info");
  });
});

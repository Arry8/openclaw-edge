import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

type MockToolRequest = {
  name: string;
  arguments?: Record<string, unknown>;
};

type MockToolResult = {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: {
    result?: {
      error?: string;
    };
  };
  isError?: boolean;
};

const transportMocks = vi.hoisted(() => ({
  closeImpl: vi.fn<() => Promise<void>>(async () => {}),
  instances: [] as Array<{
    close: ReturnType<typeof vi.fn>;
    terminateSession: ReturnType<typeof vi.fn>;
    url: URL;
  }>,
  terminateSessionImpl: vi.fn<() => Promise<void>>(async () => {}),
}));

const clientMocks = vi.hoisted(() => ({
  callToolImpl: vi.fn<(request: MockToolRequest) => Promise<MockToolResult>>(async () => ({
    content: [{ type: "text", text: JSON.stringify({}) }],
  })),
  closeImpl: vi.fn<() => Promise<void>>(async () => {}),
  connectImpl: vi.fn<(transport: unknown) => Promise<void>>(async (_transport: unknown) => {}),
  instances: [] as Array<{
    callTool: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    connect: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: class MockStreamableHTTPClientTransport {
    close = vi.fn(async () => await transportMocks.closeImpl());
    terminateSession = vi.fn(async () => await transportMocks.terminateSessionImpl());

    constructor(public readonly url: URL) {
      transportMocks.instances.push(this);
    }
  },
}));

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class MockClient {
    callTool = vi.fn(async (request: MockToolRequest) => await clientMocks.callToolImpl(request));
    close = vi.fn(async () => await clientMocks.closeImpl());
    connect = vi.fn(async (transport: unknown) => await clientMocks.connectImpl(transport));

    constructor() {
      clientMocks.instances.push(this);
    }
  },
}));

describe("GraphitiClient", () => {
  let GraphitiClient: typeof import("./graphiti-client.js").GraphitiClient;

  beforeAll(async () => {
    ({ GraphitiClient } = await import("./graphiti-client.js"));
  });

  beforeEach(() => {
    clientMocks.instances.length = 0;
    transportMocks.instances.length = 0;

    clientMocks.callToolImpl.mockReset();
    clientMocks.callToolImpl.mockImplementation(async (request: MockToolRequest) => ({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            request.name === "search_memory_facts" ? { facts: [] } : { nodes: [] },
          ),
        },
      ],
    }));
    clientMocks.closeImpl.mockReset();
    clientMocks.closeImpl.mockImplementation(async () => {});
    clientMocks.connectImpl.mockReset();
    clientMocks.connectImpl.mockImplementation(async (_transport: unknown) => {});

    transportMocks.closeImpl.mockReset();
    transportMocks.closeImpl.mockImplementation(async () => {});
    transportMocks.terminateSessionImpl.mockReset();
    transportMocks.terminateSessionImpl.mockImplementation(async () => {});
  });

  it("waits for the first connection before issuing concurrent tool calls", async () => {
    let resolveConnect: (() => void) | undefined;
    const connectPromise = new Promise<void>((resolve) => {
      resolveConnect = resolve;
    });
    clientMocks.connectImpl.mockImplementation(async () => await connectPromise);

    const graphiti = new GraphitiClient("http://localhost:8000/mcp/", "openclaw-test");
    const factsPromise = graphiti.searchFacts("MCP");
    const nodesPromise = graphiti.searchNodes("MCP");

    await Promise.resolve();

    expect(clientMocks.connectImpl).toHaveBeenCalledTimes(1);
    expect(clientMocks.callToolImpl).not.toHaveBeenCalled();

    resolveConnect?.();

    await expect(Promise.all([factsPromise, nodesPromise])).resolves.toEqual([[], []]);
    expect(clientMocks.callToolImpl.mock.calls.map(([request]) => request.name)).toEqual([
      "search_memory_facts",
      "search_nodes",
    ]);
    expect(clientMocks.callToolImpl.mock.calls[0]?.[0]?.arguments).toEqual({
      query: "MCP",
      group_ids: ["openclaw_test"],
      max_facts: 10,
    });
    expect(clientMocks.callToolImpl.mock.calls[1]?.[0]?.arguments).toEqual({
      query: "MCP",
      group_ids: ["openclaw_test"],
      max_nodes: 10,
    });
    expect(transportMocks.instances[0]?.url.toString()).toBe("http://localhost:8000/mcp");
  });

  it("terminates the streamable session on dispose", async () => {
    const graphiti = new GraphitiClient("http://localhost:8000/mcp/", "openclaw-test");

    await graphiti.searchFacts("MCP");
    await graphiti.dispose();

    expect(transportMocks.terminateSessionImpl).toHaveBeenCalledTimes(1);
    expect(transportMocks.closeImpl).toHaveBeenCalledTimes(1);
    expect(clientMocks.closeImpl).toHaveBeenCalledTimes(1);
  });

  it("can reconnect after closing an idle session", async () => {
    const graphiti = new GraphitiClient("http://localhost:8000/mcp/", "openclaw-test");

    await graphiti.searchFacts("MCP");
    await graphiti.closeConnection();
    await graphiti.searchNodes("MCP");

    expect(clientMocks.connectImpl).toHaveBeenCalledTimes(2);
    expect(transportMocks.terminateSessionImpl).toHaveBeenCalledTimes(1);
    expect(transportMocks.closeImpl).toHaveBeenCalledTimes(1);
  });

  it("uses the current Graphiti argument names for add and delete operations", async () => {
    const graphiti = new GraphitiClient("http://localhost:8000/mcp/", "openclaw-test");

    await graphiti.addObservation("technical", "MCP schema drift");
    await graphiti.deleteFact("fact-123");

    expect(clientMocks.callToolImpl.mock.calls[0]?.[0]).toMatchObject({
      name: "add_memory",
      arguments: expect.objectContaining({
        name: expect.stringMatching(/^observation-/),
        episode_body: "[technical] MCP schema drift",
        source: "text",
        source_description: "OpenClaw learning loop: technical",
        group_id: "openclaw_test",
      }),
    });
    expect(clientMocks.callToolImpl.mock.calls[1]?.[0]).toEqual({
      name: "delete_entity_edge",
      arguments: { uuid: "fact-123" },
    });
  });

  it("throws when Graphiti reports a structured search error", async () => {
    clientMocks.callToolImpl.mockResolvedValueOnce({
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: "RediSearch: Syntax error" }),
        },
      ],
      structuredContent: {
        result: {
          error: "RediSearch: Syntax error",
        },
      },
      isError: false,
    });

    const graphiti = new GraphitiClient("http://localhost:8000/mcp/", "openclaw-test");

    await expect(graphiti.searchFacts("marker")).rejects.toThrow(
      "Graphiti error: RediSearch: Syntax error",
    );
  });

  it("surfaces delete errors instead of reporting success", async () => {
    clientMocks.callToolImpl.mockResolvedValueOnce({
      content: [{ type: "text", text: "delete failed" }],
      structuredContent: {
        result: {
          error: "invalid uuid",
        },
      },
      isError: true,
    });

    const graphiti = new GraphitiClient("http://localhost:8000/mcp/", "openclaw-test");

    await expect(graphiti.deleteFact("fact-123")).rejects.toThrow("Graphiti error: invalid uuid");
  });

  it("retries search with a sanitized query after a RediSearch syntax error", async () => {
    clientMocks.callToolImpl
      .mockResolvedValueOnce({
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: "RediSearch: Syntax error" }),
          },
        ],
        structuredContent: {
          result: {
            error: "RediSearch: Syntax error",
          },
        },
        isError: false,
      })
      .mockResolvedValueOnce({
        content: [
          {
            type: "text",
            text: JSON.stringify({ facts: [{ uuid: "fact-1", name: "marker", fact: "ok" }] }),
          },
        ],
        isError: false,
      });

    const graphiti = new GraphitiClient("http://localhost:8000/mcp/", "openclaw-test");

    await expect(graphiti.searchFacts("learning-loop marker 18:45")).resolves.toEqual([
      { uuid: "fact-1", name: "marker", fact: "ok" },
    ]);
    expect(clientMocks.callToolImpl.mock.calls[0]?.[0]?.arguments).toEqual({
      query: "learning-loop marker 18:45",
      group_ids: ["openclaw_test"],
      max_facts: 10,
    });
    expect(clientMocks.callToolImpl.mock.calls[1]?.[0]?.arguments).toEqual({
      query: "learning loop marker 18 45",
      group_ids: ["openclaw_test"],
      max_facts: 10,
    });
  });
});

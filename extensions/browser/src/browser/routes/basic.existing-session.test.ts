import { beforeEach, describe, expect, it, vi } from "vitest";
import { createBrowserRouteApp, createBrowserRouteResponse } from "./test-helpers.js";

vi.mock("../chrome-mcp.js", () => ({
  getChromeMcpPid: vi.fn(() => 4321),
}));

let registerBrowserBasicRoutes: typeof import("./basic.js").registerBrowserBasicRoutes;
let BrowserProfileUnavailableError: typeof import("../errors.js").BrowserProfileUnavailableError;

function createExistingSessionProfileState(params?: {
  isHttpReachable?: () => Promise<boolean>;
  isTransportAvailable?: () => Promise<boolean>;
  isReachable?: () => Promise<boolean>;
}) {
  return {
    resolved: {
      enabled: true,
      headless: false,
      noSandbox: false,
      executablePath: undefined,
    },
    profiles: new Map(),
    forProfile: () =>
      ({
        profile: {
          name: "chrome-live",
          driver: "existing-session",
          cdpPort: 0,
          cdpUrl: "",
          userDataDir: "/tmp/brave-profile",
          color: "#00AA00",
          attachOnly: true,
        },
        isHttpReachable: params?.isHttpReachable ?? (async () => true),
        isTransportAvailable: params?.isTransportAvailable ?? (async () => true),
        isReachable: params?.isReachable ?? (async () => true),
      }) as never,
  };
}

async function callBasicRouteWithState(params: {
  query?: Record<string, string>;
  state: ReturnType<typeof createExistingSessionProfileState>;
}) {
  const { app, getHandlers } = createBrowserRouteApp();
  registerBrowserBasicRoutes(app, {
    state: () => params.state,
    forProfile: params.state.forProfile,
  } as never);

  const handler = getHandlers.get("/");
  expect(handler).toBeTypeOf("function");

  const response = createBrowserRouteResponse();
  await handler?.({ params: {}, query: params.query ?? { profile: "chrome-live" } }, response.res);
  return response;
}

beforeEach(async () => {
  vi.resetModules();
  ({ BrowserProfileUnavailableError } = await import("../errors.js"));
  ({ registerBrowserBasicRoutes } = await import("./basic.js"));
});

describe("basic browser routes", () => {
  it("maps existing-session status failures to JSON browser errors", async () => {
    const response = await callBasicRouteWithState({
      state: createExistingSessionProfileState({
        isTransportAvailable: async () => {
          throw new BrowserProfileUnavailableError("attach failed");
        },
      }),
    });

    expect(response.statusCode).toBe(409);
    expect(response.body).toMatchObject({ error: "attach failed" });
  });

  it("reports Chrome MCP transport without fake CDP fields", async () => {
    const response = await callBasicRouteWithState({
      state: createExistingSessionProfileState(),
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      profile: "chrome-live",
      driver: "existing-session",
      transport: "chrome-mcp",
      running: true,
      cdpPort: null,
      cdpUrl: null,
      userDataDir: "/tmp/brave-profile",
      pid: 4321,
    });
  });

  it("treats attach-only profiles as running when transport is available even if page reachability is false", async () => {
    const response = await callBasicRouteWithState({
      state: createExistingSessionProfileState({
        isTransportAvailable: async () => true,
        isReachable: async () => false,
      }),
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      profile: "chrome-live",
      driver: "existing-session",
      transport: "chrome-mcp",
      running: true,
      cdpReady: true,
    });
  });

  it("probes Chrome MCP transport only once for status", async () => {
    const isHttpReachable = vi.fn(async () => true);
    const isTransportAvailable = vi.fn(async () => true);

    const response = await callBasicRouteWithState({
      state: createExistingSessionProfileState({
        isHttpReachable,
        isTransportAvailable,
      }),
    });

    expect(response.statusCode).toBe(200);
    expect(isTransportAvailable).toHaveBeenCalledTimes(1);
    expect(isHttpReachable).not.toHaveBeenCalled();
    expect(response.body).toMatchObject({
      cdpHttp: true,
      cdpReady: true,
      running: true,
    });
  });
});

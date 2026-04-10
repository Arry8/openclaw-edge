import { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WebSocketServer } from "ws";
import type { SubsystemLogger } from "../logging/subsystem.js";
import type { ResolvedGatewayAuth } from "./auth.js";
import { MAX_HANDSHAKE_TIMEOUT_MS } from "./server-constants.js";
import type { GatewayRequestContext, GatewayRequestHandlers } from "./server-methods/types.js";
import type { PreauthConnectionBudget } from "./server/preauth-connection-budget.js";
import { attachGatewayWsConnectionHandler } from "./server/ws-connection.js";

class FakeSocket extends EventEmitter {
  readonly send = vi.fn();
  readonly close = vi.fn();
  readonly _socket = { remoteAddress: "127.0.0.1" };
}

function createLogger(subsystem = "test"): SubsystemLogger {
  return {
    subsystem,
    isEnabled: () => false,
    trace: () => {},
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    fatal: () => {},
    raw: () => {},
    child: (name) => createLogger(`${subsystem}/${name}`),
  };
}

const ORIGINAL_HANDSHAKE_TIMEOUT = process.env.OPENCLAW_HANDSHAKE_TIMEOUT_MS;

describe("gateway ws connection handshake timeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    if (ORIGINAL_HANDSHAKE_TIMEOUT === undefined) {
      delete process.env.OPENCLAW_HANDSHAKE_TIMEOUT_MS;
    } else {
      process.env.OPENCLAW_HANDSHAKE_TIMEOUT_MS = ORIGINAL_HANDSHAKE_TIMEOUT;
    }
  });

  it("clamps oversized env timeouts before scheduling the websocket handshake timer", () => {
    process.env.OPENCLAW_HANDSHAKE_TIMEOUT_MS = "2147483648";

    const socket = new FakeSocket();
    const wss = new EventEmitter() as WebSocketServer;
    const preauthConnectionBudget: PreauthConnectionBudget = {
      acquire: () => true,
      release: () => {},
    };
    const resolvedAuth: ResolvedGatewayAuth = { mode: "none", allowTailscale: false };
    const logger = createLogger();

    attachGatewayWsConnectionHandler({
      wss,
      clients: new Set(),
      preauthConnectionBudget,
      port: 18789,
      canvasHostEnabled: false,
      resolvedAuth,
      gatewayMethods: [],
      events: [],
      logGateway: logger,
      logHealth: logger,
      logWsControl: logger,
      extraHandlers: {} as GatewayRequestHandlers,
      broadcast: () => {},
      buildRequestContext: () => ({}) as GatewayRequestContext,
    });

    const upgradeReq = {
      headers: { host: "127.0.0.1:18789" },
      socket: { localAddress: "127.0.0.1" },
    } as IncomingMessage;

    wss.emit("connection", socket, upgradeReq);

    vi.advanceTimersByTime(MAX_HANDSHAKE_TIMEOUT_MS - 1);
    expect(socket.close).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(socket.close).toHaveBeenCalledTimes(1);
    expect(socket.close).toHaveBeenCalledWith(1000, undefined);
  });
});

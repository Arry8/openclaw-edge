import type { Server as HttpServer } from "node:http";
import type { WebSocketServer } from "ws";
import type { CanvasHostHandler, CanvasHostServer } from "../canvas-host/server.js";
import { type ChannelId, listChannelPlugins } from "../channels/plugins/index.js";
import { stopGmailWatcher } from "../hooks/gmail-watcher.js";
import type { HeartbeatRunner } from "../infra/heartbeat-runner.js";
import type { PluginServicesHandle } from "../plugins/services.js";
import { SUBSYSTEM_STOP_TIMEOUT_MS, raceTimeout } from "./shutdown-timeout.js";

export function createGatewayCloseHandler(params: {
  bonjourStop: (() => Promise<void>) | null;
  tailscaleCleanup: (() => Promise<void>) | null;
  canvasHost: CanvasHostHandler | null;
  canvasHostServer: CanvasHostServer | null;
  releasePluginRouteRegistry?: (() => void) | null;
  stopChannel: (name: ChannelId, accountId?: string) => Promise<void>;
  pluginServices: PluginServicesHandle | null;
  cron: { stop: () => void };
  heartbeatRunner: HeartbeatRunner;
  logStreamStop?: (() => void) | null;
  updateCheckStop?: (() => void) | null;
  nodePresenceTimers: Map<string, ReturnType<typeof setInterval>>;
  broadcast: (event: string, payload: unknown, opts?: { dropIfSlow?: boolean }) => void;
  tickInterval: ReturnType<typeof setInterval>;
  healthInterval: ReturnType<typeof setInterval>;
  dedupeCleanup: ReturnType<typeof setInterval>;
  mediaCleanup: ReturnType<typeof setInterval> | null;
  agentUnsub: (() => void) | null;
  heartbeatUnsub: (() => void) | null;
  transcriptUnsub: (() => void) | null;
  lifecycleUnsub: (() => void) | null;
  chatRunState: { clear: () => void };
  clients: Set<{ socket: { close: (code: number, reason: string) => void } }>;
  configReloader: { stop: () => Promise<void> };
  wss: WebSocketServer;
  httpServer: HttpServer;
  httpServers?: HttpServer[];
  log?: { warn: (obj: Record<string, unknown>, msg: string) => void };
}) {
  return async (opts?: { reason?: string; restartExpectedMs?: number | null }) => {
    const log = params.log;
    try {
      const reasonRaw = typeof opts?.reason === "string" ? opts.reason.trim() : "";
      const reason = reasonRaw || "gateway stopping";
      const restartExpectedMs =
        typeof opts?.restartExpectedMs === "number" && Number.isFinite(opts.restartExpectedMs)
          ? Math.max(0, Math.floor(opts.restartExpectedMs))
          : null;
      if (params.bonjourStop) {
        try {
          await raceTimeout(params.bonjourStop(), SUBSYSTEM_STOP_TIMEOUT_MS, "bonjour", log);
        } catch {
          /* ignore */
        }
      }
      if (params.tailscaleCleanup) {
        await raceTimeout(
          params.tailscaleCleanup().catch(() => {}),
          SUBSYSTEM_STOP_TIMEOUT_MS,
          "tailscale",
          log,
        );
      }
      if (params.canvasHost) {
        try {
          await raceTimeout(
            params.canvasHost.close(),
            SUBSYSTEM_STOP_TIMEOUT_MS,
            "canvasHost",
            log,
          );
        } catch {
          /* ignore */
        }
      }
      if (params.canvasHostServer) {
        try {
          await raceTimeout(
            params.canvasHostServer.close(),
            SUBSYSTEM_STOP_TIMEOUT_MS,
            "canvasHostServer",
            log,
          );
        } catch {
          /* ignore */
        }
      }
      for (const plugin of listChannelPlugins()) {
        await raceTimeout(
          params.stopChannel(plugin.id).catch(() => {}),
          SUBSYSTEM_STOP_TIMEOUT_MS,
          `channel:${plugin.id}`,
          log,
        );
      }
      if (params.pluginServices) {
        await raceTimeout(
          params.pluginServices.stop().catch(() => {}),
          SUBSYSTEM_STOP_TIMEOUT_MS,
          "pluginServices",
          log,
        );
      }
      await raceTimeout(stopGmailWatcher(), SUBSYSTEM_STOP_TIMEOUT_MS, "gmailWatcher", log);
      params.cron.stop();
      params.heartbeatRunner.stop();
      try {
        params.logStreamStop?.();
      } catch {
        /* ignore */
      }
      try {
        params.updateCheckStop?.();
      } catch {
        /* ignore */
      }
      for (const timer of params.nodePresenceTimers.values()) {
        clearInterval(timer);
      }
      params.nodePresenceTimers.clear();
      params.broadcast("shutdown", {
        reason,
        restartExpectedMs,
      });
      clearInterval(params.tickInterval);
      clearInterval(params.healthInterval);
      clearInterval(params.dedupeCleanup);
      if (params.mediaCleanup) {
        clearInterval(params.mediaCleanup);
      }
      if (params.agentUnsub) {
        try {
          params.agentUnsub();
        } catch {
          /* ignore */
        }
      }
      if (params.heartbeatUnsub) {
        try {
          params.heartbeatUnsub();
        } catch {
          /* ignore */
        }
      }
      if (params.transcriptUnsub) {
        try {
          params.transcriptUnsub();
        } catch {
          /* ignore */
        }
      }
      if (params.lifecycleUnsub) {
        try {
          params.lifecycleUnsub();
        } catch {
          /* ignore */
        }
      }
      params.chatRunState.clear();
      for (const c of params.clients) {
        try {
          c.socket.close(1012, "service restart");
        } catch {
          /* ignore */
        }
      }
      params.clients.clear();
      await raceTimeout(
        params.configReloader.stop().catch(() => {}),
        SUBSYSTEM_STOP_TIMEOUT_MS,
        "configReloader",
        log,
      );
      await raceTimeout(
        new Promise<void>((resolve) => params.wss.close(() => resolve())),
        SUBSYSTEM_STOP_TIMEOUT_MS,
        "wss",
        log,
      );
      const servers =
        params.httpServers && params.httpServers.length > 0
          ? params.httpServers
          : [params.httpServer];
      for (const server of servers) {
        const httpServer = server as HttpServer & {
          closeIdleConnections?: () => void;
        };
        if (typeof httpServer.closeIdleConnections === "function") {
          httpServer.closeIdleConnections();
        }
        await raceTimeout(
          new Promise<void>((resolve, reject) =>
            httpServer.close((err) => (err ? reject(err) : resolve())),
          ).catch(() => {}),
          SUBSYSTEM_STOP_TIMEOUT_MS,
          "httpServer",
          log,
        );
      }
    } finally {
      try {
        params.releasePluginRouteRegistry?.();
      } catch {
        /* ignore */
      }
    }
  };
}

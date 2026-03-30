import type { Command } from "commander";
import { callGateway } from "../gateway/call.js";
import { GATEWAY_CLIENT_MODES, GATEWAY_CLIENT_NAMES } from "../utils/message-channel.js";
import { parsePositiveIntOrUndefined } from "./program/helpers.js";
import { withProgress } from "./progress.js";

export type GatewayRpcOpts = {
  url?: string;
  token?: string;
  timeout?: string;
  expectFinal?: boolean;
  json?: boolean;
};

export function addGatewayClientOptions(cmd: Command) {
  return cmd
    .option("--url <url>", "Gateway WebSocket URL (defaults to gateway.remote.url when configured)")
    .option("--token <token>", "Gateway token (if required)")
    .option("--timeout <ms>", "Timeout in ms", "30000")
    .option("--expect-final", "Wait for final response (agent)", false);
}

const DEFAULT_GATEWAY_RPC_TIMEOUT_MS = 30_000;

function resolveGatewayRpcTimeoutMs(timeout: unknown): number {
  if (timeout === undefined || timeout === null) {
    return DEFAULT_GATEWAY_RPC_TIMEOUT_MS;
  }
  if (typeof timeout === "string" && timeout.trim() === "") {
    throw new Error("--timeout must be a positive integer (milliseconds)");
  }
  const parsed = parsePositiveIntOrUndefined(timeout);
  if (parsed === undefined) {
    throw new Error("--timeout must be a positive integer (milliseconds)");
  }
  return parsed;
}

export async function callGatewayFromCli(
  method: string,
  opts: GatewayRpcOpts,
  params?: unknown,
  extra?: { expectFinal?: boolean; progress?: boolean },
) {
  const showProgress = extra?.progress ?? opts.json !== true;
  return await withProgress(
    {
      label: `Gateway ${method}`,
      indeterminate: true,
      enabled: showProgress,
    },
    async () =>
      await callGateway({
        url: opts.url,
        token: opts.token,
        method,
        params,
        expectFinal: extra?.expectFinal ?? Boolean(opts.expectFinal),
        timeoutMs: resolveGatewayRpcTimeoutMs(opts.timeout),
        clientName: GATEWAY_CLIENT_NAMES.CLI,
        mode: GATEWAY_CLIENT_MODES.CLI,
      }),
  );
}

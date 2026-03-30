import { normalizeChannelId } from "../channels/plugins/index.js";
import { listPairingChannels } from "../channels/plugins/pairing.js";
import { resolvePairingIdLabel } from "../pairing/pairing-labels.js";
import { listChannelPairingRequests, type PairingChannel } from "../pairing/pairing-store.js";
import { defaultRuntime } from "../runtime.js";
import { getTerminalTableWidth, renderTable } from "../terminal/table.js";
import { theme } from "../terminal/theme.js";

/** Parse channel, allowing extension channels not in core registry. */
export function parseChannel(raw: unknown, channels: PairingChannel[]): PairingChannel {
  const value = (
    typeof raw === "string"
      ? raw
      : typeof raw === "number" || typeof raw === "boolean"
        ? String(raw)
        : ""
  )
    .trim()
    .toLowerCase();
  if (!value) {
    throw new Error("Channel required");
  }

  const normalized = normalizeChannelId(value);
  if (normalized) {
    if (!channels.includes(normalized)) {
      throw new Error(`Channel ${normalized} does not support pairing`);
    }
    return normalized;
  }

  // Allow extension channels: validate format but don't require registry
  if (/^[a-z][a-z0-9_-]{0,63}$/.test(value)) {
    return value as PairingChannel;
  }
  throw new Error(`Invalid channel: ${value}`);
}

export async function runPairingList(opts: {
  channel?: string;
  account?: string;
  json: boolean;
  channelArg?: string;
}): Promise<void> {
  const channels = listPairingChannels();
  const channelRaw = opts.channel ?? opts.channelArg ?? (channels.length === 1 ? channels[0] : "");
  if (!channelRaw) {
    throw new Error(
      `Channel required. Use --channel <channel> or pass it as the first argument (expected one of: ${channels.join(", ")})`,
    );
  }
  const channel = parseChannel(channelRaw, channels);
  const accountId = String(opts.account ?? "").trim();
  const requests = accountId
    ? await listChannelPairingRequests(channel, process.env, accountId)
    : await listChannelPairingRequests(channel);
  if (opts.json) {
    defaultRuntime.writeJson({ channel, requests });
    return;
  }
  if (requests.length === 0) {
    defaultRuntime.log(theme.muted(`No pending ${channel} pairing requests.`));
    return;
  }
  const idLabel = resolvePairingIdLabel(channel);
  const tableWidth = getTerminalTableWidth();
  defaultRuntime.log(`${theme.heading("Pairing requests")} ${theme.muted(`(${requests.length})`)}`);
  defaultRuntime.log(
    renderTable({
      width: tableWidth,
      columns: [
        { key: "Code", header: "Code", minWidth: 10 },
        { key: "ID", header: idLabel, minWidth: 12, flex: true },
        { key: "Meta", header: "Meta", minWidth: 8, flex: true },
        { key: "Requested", header: "Requested", minWidth: 12 },
      ],
      rows: requests.map((r) => ({
        Code: r.code,
        ID: r.id,
        Meta: r.meta ? JSON.stringify(r.meta) : "",
        Requested: r.createdAt,
      })),
    }).trimEnd(),
  );
}

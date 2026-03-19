/**
 * Utopia WebSocket bus — subscribes to incoming instant messages
 * and provides a sendDm method for outbound messages.
 */

import WebSocket from "ws";
import type { UtopiaApiConfig, UtopiaInstantMessage, UtopiaWsEvent } from "./utopia-api.js";
import {
  buildWsUrl,
  getOwnContact,
  getSystemInfo,
  sendInstantMessage,
  setWebSocketState,
} from "./utopia-api.js";

const RECONNECT_DELAY_MS = 5_000;
const MAX_RECONNECT_DELAY_MS = 60_000;

export interface UtopiaBusOptions {
  apiConfig: UtopiaApiConfig;
  wsPort: number;
  accountId: string;
  onMessage: (
    senderPubkey: string,
    senderNick: string,
    text: string,
    reply: (text: string) => Promise<void>,
  ) => Promise<void>;
  onError?: (error: Error, context: string) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
}

export interface UtopiaBusHandle {
  close: () => void;
  publicKey: string;
  nick: string;
  sendDm: (to: string, text: string) => Promise<void>;
}

/**
 * Start the Utopia WebSocket bus.
 *
 * 1. Verifies connectivity via getSystemInfo
 * 2. Gets own identity via getOwnContact
 * 3. Enables WebSocket notifications via setWebSocketState
 * 4. Connects to WebSocket and listens for newInstantMessage events
 * 5. Auto-reconnects on disconnect
 */
export async function startUtopiaBus(options: UtopiaBusOptions): Promise<UtopiaBusHandle> {
  const { apiConfig, wsPort, onMessage, onError, onConnect, onDisconnect } = options;

  // Verify connection
  await getSystemInfo(apiConfig);

  // Get own identity
  const ownContact = await getOwnContact(apiConfig);
  const publicKey = ownContact.pk;
  const nick = ownContact.nick;

  // Enable WebSocket notifications
  await setWebSocketState(apiConfig, wsPort, "newInstantMessage");

  let ws: WebSocket | null = null;
  let closed = false;
  let reconnectDelay = RECONNECT_DELAY_MS;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  function connect(): void {
    if (closed) return;

    const wsUrl = buildWsUrl(apiConfig, wsPort);

    try {
      ws = new WebSocket(wsUrl);
    } catch (err) {
      onError?.(err as Error, "ws-create");
      scheduleReconnect();
      return;
    }

    ws.on("open", () => {
      // Guard against open firing after close() was called (race condition)
      if (closed) {
        ws?.close();
        return;
      }
      reconnectDelay = RECONNECT_DELAY_MS; // Reset delay on successful connect
      onConnect?.();
    });

    ws.on("message", (data: WebSocket.Data) => {
      handleWsMessage(data).catch((err) => {
        onError?.(err as Error, "ws-message-handler");
      });
    });

    ws.on("error", (err: Error) => {
      onError?.(err, "ws-error");
    });

    ws.on("close", () => {
      onDisconnect?.();
      if (!closed) {
        scheduleReconnect();
      }
    });
  }

  function scheduleReconnect(): void {
    if (closed) return;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
    }
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, reconnectDelay);
    // Exponential backoff
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY_MS);
  }

  async function handleWsMessage(data: WebSocket.Data): Promise<void> {
    let event: UtopiaWsEvent;
    try {
      event = JSON.parse(data.toString()) as UtopiaWsEvent;
    } catch {
      onError?.(new Error("Failed to parse WebSocket message"), "ws-parse");
      return;
    }

    if (event.type !== "newInstantMessage") {
      return;
    }

    const msg = event.data as unknown as UtopiaInstantMessage;
    if (!msg.text?.trim() || !msg.pk) {
      return;
    }

    // Skip own messages
    if (msg.pk === publicKey) {
      return;
    }

    const reply = async (text: string): Promise<void> => {
      await sendInstantMessage(apiConfig, msg.pk, text);
    };

    await onMessage(msg.pk, msg.nick, msg.text, reply);
  }

  // Initial connection
  connect();

  return {
    close: () => {
      closed = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (ws) {
        ws.close();
        ws = null;
      }
    },
    publicKey,
    nick,
    sendDm: async (to: string, text: string): Promise<void> => {
      await sendInstantMessage(apiConfig, to, text);
    },
  };
}

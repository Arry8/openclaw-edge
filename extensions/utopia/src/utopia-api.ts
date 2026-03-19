/**
 * Utopia Messenger API client.
 *
 * All API calls are JSON-RPC style POST requests to:
 *   http(s)://{host}:{port}/api/1.0
 *
 * Request body: { method, params, token }
 * Response body: { result, resultExtraInfo? } or { error }
 */

export interface UtopiaApiConfig {
  host: string;
  port: number;
  token: string;
  useSsl?: boolean;
}

export interface UtopiaApiResponse<T = unknown> {
  result?: T;
  resultExtraInfo?: unknown;
  error?: string;
}

export interface UtopiaSystemInfo {
  buildAbi: string;
  buildNumber: string;
  netCoreRate: number;
  networkId: number;
  packetCacheMemory: number;
  uptime: number;
}

export interface UtopiaOwnContact {
  avatarMd5: string;
  firstName: string;
  lastName: string;
  nick: string;
  pk: string;
  status: string;
}

export interface UtopiaInstantMessage {
  id: number;
  dateTime: string;
  file: unknown;
  isIncoming: boolean;
  messageType: number;
  nick: string;
  pk: string;
  readDateTime: string | null;
  receivedDateTime: string;
  text: string;
}

export interface UtopiaWsEvent {
  type: string;
  data: Record<string, unknown>;
}

const API_TIMEOUT_MS = 30_000;

/**
 * Make an API call to the Utopia client.
 */
async function apiCall<T = unknown>(
  config: UtopiaApiConfig,
  method: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  const protocol = config.useSsl ? "https" : "http";
  const url = `${protocol}://${config.host}:${config.port}/api/1.0`;

  const body = JSON.stringify({
    method,
    params,
    token: config.token,
  });

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Utopia API HTTP error: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as UtopiaApiResponse<T>;

  if (data.error) {
    throw new Error(`Utopia API error: ${data.error}`);
  }

  return data.result as T;
}

/**
 * Check connection to Utopia client by calling getSystemInfo.
 */
export async function getSystemInfo(config: UtopiaApiConfig): Promise<UtopiaSystemInfo> {
  return apiCall<UtopiaSystemInfo>(config, "getSystemInfo");
}

/**
 * Get own contact information (including public key).
 */
export async function getOwnContact(config: UtopiaApiConfig): Promise<UtopiaOwnContact> {
  return apiCall<UtopiaOwnContact>(config, "getOwnContact");
}

/**
 * Enable WebSocket notifications for receiving messages.
 */
export async function setWebSocketState(
  config: UtopiaApiConfig,
  wsPort: number,
  notifications: string = "newInstantMessage",
): Promise<void> {
  await apiCall(config, "setWebSocketState", {
    enabled: true,
    port: wsPort,
    enablessl: config.useSsl ?? false,
    notifications,
  });
}

/**
 * Send an instant message to a user by public key or nickname.
 */
export async function sendInstantMessage(
  config: UtopiaApiConfig,
  to: string,
  text: string,
): Promise<void> {
  await apiCall(config, "sendInstantMessage", { to, text });
}

/**
 * Get messages for a contact by public key.
 */
export async function getContactMessages(
  config: UtopiaApiConfig,
  pk: string,
): Promise<UtopiaInstantMessage[]> {
  return apiCall<UtopiaInstantMessage[]>(config, "getContactMessages", { pk });
}

/**
 * Build the WebSocket URL for subscribing to notifications.
 */
export function buildWsUrl(config: UtopiaApiConfig, wsPort: number): string {
  const protocol = config.useSsl ? "wss" : "ws";
  return `${protocol}://${config.host}:${wsPort}/UtopiaWSS?token=${config.token}`;
}

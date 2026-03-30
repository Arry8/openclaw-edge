import { describe, expect, it } from "vitest";
import type { AuthRateLimiter } from "../../auth-rate-limit.js";
import { GATEWAY_CLIENT_IDS, GATEWAY_CLIENT_MODES } from "../../protocol/client-info.js";
import type { ConnectParams } from "../../protocol/schema/types.js";
import {
  BROWSER_ORIGIN_LOOPBACK_RATE_LIMIT_IP,
  resolveHandshakeBrowserSecurityContext,
  resolveUnauthorizedHandshakeContext,
  shouldAllowSilentLocalPairing,
  shouldSkipBackendSelfPairing,
} from "./handshake-auth-helpers.js";

function createRateLimiter(): AuthRateLimiter {
  return {
    check: () => ({ allowed: true, remaining: 1, retryAfterMs: 0 }),
    reset: () => {},
    recordFailure: () => {},
    size: () => 0,
    prune: () => {},
    dispose: () => {},
  };
}

describe("handshake auth helpers", () => {
  it("pins browser-origin loopback clients to the synthetic rate-limit ip", () => {
    const rateLimiter = createRateLimiter();
    const browserRateLimiter = createRateLimiter();
    const resolved = resolveHandshakeBrowserSecurityContext({
      requestOrigin: "https://app.example",
      clientIp: "127.0.0.1",
      rateLimiter,
      browserRateLimiter,
    });

    expect(resolved).toMatchObject({
      hasBrowserOriginHeader: true,
      enforceOriginCheckForAnyClient: true,
      rateLimitClientIp: BROWSER_ORIGIN_LOOPBACK_RATE_LIMIT_IP,
      authRateLimiter: browserRateLimiter,
    });
  });

  it("recommends device-token retry only for shared-token mismatch with device identity", () => {
    const resolved = resolveUnauthorizedHandshakeContext({
      connectAuth: { token: "shared-token" },
      failedAuth: { ok: false, reason: "token_mismatch" },
      hasDeviceIdentity: true,
    });

    expect(resolved).toEqual({
      authProvided: "token",
      canRetryWithDeviceToken: true,
      recommendedNextStep: "retry_with_device_token",
    });
  });

  it("treats explicit device-token mismatch as credential update guidance", () => {
    const resolved = resolveUnauthorizedHandshakeContext({
      connectAuth: { deviceToken: "device-token" },
      failedAuth: { ok: false, reason: "device_token_mismatch" },
      hasDeviceIdentity: true,
    });

    expect(resolved).toEqual({
      authProvided: "device-token",
      canRetryWithDeviceToken: false,
      recommendedNextStep: "update_auth_credentials",
    });
  });

  it("allows silent local pairing only for not-paired and scope upgrades", () => {
    expect(
      shouldAllowSilentLocalPairing({
        isLocalClient: true,
        hasBrowserOriginHeader: false,
        isControlUi: false,
        isWebchat: false,
        reason: "not-paired",
      }),
    ).toBe(true);
    expect(
      shouldAllowSilentLocalPairing({
        isLocalClient: true,
        hasBrowserOriginHeader: false,
        isControlUi: false,
        isWebchat: false,
        reason: "metadata-upgrade",
      }),
    ).toBe(false);
  });

  it("skips backend self-pairing for CLI clients with shared auth (Docker)", () => {
    const connectParams = {
      client: {
        id: GATEWAY_CLIENT_IDS.CLI,
        mode: GATEWAY_CLIENT_MODES.CLI,
      },
    } as ConnectParams;
    // Local + shared auth → skip
    expect(
      shouldSkipBackendSelfPairing({
        connectParams,
        isLocalClient: true,
        hasBrowserOriginHeader: false,
        sharedAuthOk: true,
        authMethod: "token",
      }),
    ).toBe(true);
    // Non-local + shared auth → still skip (Docker false-negative)
    expect(
      shouldSkipBackendSelfPairing({
        connectParams,
        isLocalClient: false,
        hasBrowserOriginHeader: false,
        sharedAuthOk: true,
        authMethod: "token",
      }),
    ).toBe(true);
    // Shared auth not ok → reject
    expect(
      shouldSkipBackendSelfPairing({
        connectParams,
        isLocalClient: true,
        hasBrowserOriginHeader: false,
        sharedAuthOk: false,
        authMethod: "token",
      }),
    ).toBe(false);
  });

  it("skips backend self-pairing for backend clients with shared auth (Docker)", () => {
    const connectParams = {
      client: {
        id: GATEWAY_CLIENT_IDS.GATEWAY_CLIENT,
        mode: GATEWAY_CLIENT_MODES.BACKEND,
      },
    } as ConnectParams;

    // Local + shared auth → skip
    expect(
      shouldSkipBackendSelfPairing({
        connectParams,
        isLocalClient: true,
        hasBrowserOriginHeader: false,
        sharedAuthOk: true,
        authMethod: "token",
      }),
    ).toBe(true);
    // Non-local + shared auth → skip (Docker network_mode false-negative)
    expect(
      shouldSkipBackendSelfPairing({
        connectParams,
        isLocalClient: false,
        hasBrowserOriginHeader: false,
        sharedAuthOk: true,
        authMethod: "token",
      }),
    ).toBe(true);
    // Password auth, non-local → skip (shared secret is trust anchor)
    expect(
      shouldSkipBackendSelfPairing({
        connectParams,
        isLocalClient: false,
        hasBrowserOriginHeader: false,
        sharedAuthOk: true,
        authMethod: "password",
      }),
    ).toBe(true);
    // Device-token auth, local → skip (locality preserved for device-token)
    expect(
      shouldSkipBackendSelfPairing({
        connectParams,
        isLocalClient: true,
        hasBrowserOriginHeader: false,
        sharedAuthOk: false,
        authMethod: "device-token",
      }),
    ).toBe(true);
    // Device-token auth, non-local → reject (locality required for device-token)
    expect(
      shouldSkipBackendSelfPairing({
        connectParams,
        isLocalClient: false,
        hasBrowserOriginHeader: false,
        sharedAuthOk: false,
        authMethod: "device-token",
      }),
    ).toBe(false);
    // Shared auth not ok + non-local → reject
    expect(
      shouldSkipBackendSelfPairing({
        connectParams,
        isLocalClient: false,
        hasBrowserOriginHeader: false,
        sharedAuthOk: false,
        authMethod: "token",
      }),
    ).toBe(false);
  });

  it("rejects pairing bypass when browser origin header is present", () => {
    const connectParams = {
      client: {
        id: GATEWAY_CLIENT_IDS.GATEWAY_CLIENT,
        mode: GATEWAY_CLIENT_MODES.BACKEND,
      },
    } as ConnectParams;
    // Browser origin present → reject even with shared auth
    expect(
      shouldSkipBackendSelfPairing({
        connectParams,
        isLocalClient: true,
        hasBrowserOriginHeader: true,
        sharedAuthOk: true,
        authMethod: "token",
      }),
    ).toBe(false);
  });
});

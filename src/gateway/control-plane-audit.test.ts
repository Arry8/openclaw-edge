import { describe, expect, it } from "vitest";
import {
  resolveControlPlaneActor,
  formatControlPlaneActor,
  summarizeChangedPaths,
} from "./control-plane-audit.js";
import type { GatewayClient } from "./server-methods/types.js";

describe("resolveControlPlaneActor", () => {
  it("returns all-unknown defaults for a null client", () => {
    expect(resolveControlPlaneActor(null)).toEqual({
      actor: "unknown-actor",
      deviceId: "unknown-device",
      clientIp: "unknown-ip",
      connId: "unknown-conn",
    });
  });

  it("extracts fields from a fully populated client", () => {
    const client = {
      connect: { client: { id: "alice" }, device: { id: "dev-1" } },
      clientIp: "10.0.0.1",
      connId: "conn-42",
    } as unknown as GatewayClient;

    expect(resolveControlPlaneActor(client)).toEqual({
      actor: "alice",
      deviceId: "dev-1",
      clientIp: "10.0.0.1",
      connId: "conn-42",
    });
  });

  it("falls back for missing nested fields", () => {
    const client = { connect: {} } as unknown as GatewayClient;
    const result = resolveControlPlaneActor(client);
    expect(result.actor).toBe("unknown-actor");
    expect(result.deviceId).toBe("unknown-device");
    expect(result.clientIp).toBe("unknown-ip");
    expect(result.connId).toBe("unknown-conn");
  });

  it("normalizes whitespace-only values to fallbacks", () => {
    const client = {
      connect: { client: { id: "  " }, device: { id: "\t" } },
      clientIp: "  ",
      connId: " \n ",
    } as unknown as GatewayClient;

    const result = resolveControlPlaneActor(client);
    expect(result.actor).toBe("unknown-actor");
    expect(result.deviceId).toBe("unknown-device");
    expect(result.clientIp).toBe("unknown-ip");
    expect(result.connId).toBe("unknown-conn");
  });

  it("trims leading/trailing whitespace from valid values", () => {
    const client = {
      connect: { client: { id: "  alice " }, device: { id: " dev-1\t" } },
      clientIp: " 10.0.0.1 ",
      connId: " conn-42 ",
    } as unknown as GatewayClient;

    const result = resolveControlPlaneActor(client);
    expect(result.actor).toBe("alice");
    expect(result.deviceId).toBe("dev-1");
    expect(result.clientIp).toBe("10.0.0.1");
    expect(result.connId).toBe("conn-42");
  });
});

describe("formatControlPlaneActor", () => {
  it("formats all fields into the expected string", () => {
    expect(
      formatControlPlaneActor({
        actor: "alice",
        deviceId: "dev-1",
        clientIp: "10.0.0.1",
        connId: "conn-42",
      }),
    ).toBe("actor=alice device=dev-1 ip=10.0.0.1 conn=conn-42");
  });

  it("includes fallback values when fields are defaults", () => {
    expect(
      formatControlPlaneActor({
        actor: "unknown-actor",
        deviceId: "unknown-device",
        clientIp: "unknown-ip",
        connId: "unknown-conn",
      }),
    ).toBe("actor=unknown-actor device=unknown-device ip=unknown-ip conn=unknown-conn");
  });
});

describe("summarizeChangedPaths", () => {
  it('returns "<none>" for an empty array', () => {
    expect(summarizeChangedPaths([])).toBe("<none>");
  });

  it("joins all paths when under the limit", () => {
    expect(summarizeChangedPaths(["a", "b", "c"])).toBe("a,b,c");
  });

  it("joins all paths when exactly at the limit", () => {
    const paths = Array.from({ length: 8 }, (_, i) => `p${i}`);
    expect(summarizeChangedPaths(paths)).toBe("p0,p1,p2,p3,p4,p5,p6,p7");
  });

  it('truncates and appends "+N more" when over the default limit', () => {
    const paths = Array.from({ length: 11 }, (_, i) => `p${i}`);
    expect(summarizeChangedPaths(paths)).toBe("p0,p1,p2,p3,p4,p5,p6,p7,+3 more");
  });

  it("respects a custom maxPaths value", () => {
    const paths = ["a", "b", "c", "d", "e"];
    expect(summarizeChangedPaths(paths, 2)).toBe("a,b,+3 more");
  });

  it("shows all paths when maxPaths equals length", () => {
    const paths = ["x", "y"];
    expect(summarizeChangedPaths(paths, 2)).toBe("x,y");
  });

  it("handles maxPaths of 1", () => {
    expect(summarizeChangedPaths(["a", "b", "c"], 1)).toBe("a,+2 more");
  });
});

import type { PluginRuntime } from "openclaw/plugin-sdk";

let runtime: PluginRuntime | null = null;

export function setUtopiaRuntime(next: PluginRuntime): void {
  runtime = next;
}

export function getUtopiaRuntime(): PluginRuntime {
  if (!runtime) {
    throw new Error("Utopia runtime not initialized");
  }
  return runtime;
}

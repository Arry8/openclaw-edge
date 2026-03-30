import fs from "node:fs";
import { normalizeStoredCronJobs } from "../store-migration.js";
import { loadCronStore, saveCronStore } from "../store.js";
import type { CronJob } from "../types.js";
import { recomputeNextRuns } from "./jobs.js";
import type { CronServiceState } from "./state.js";

async function getFileMtimeMs(path: string): Promise<number | null> {
  try {
    const stats = await fs.promises.stat(path);
    if (!stats.isFile()) {
      return null;
    }
    return stats.mtimeMs;
  } catch {
    return null;
  }
}

export async function ensureLoaded(
  state: CronServiceState,
  opts?: {
    forceReload?: boolean;
    /** Skip recomputing nextRunAtMs after load so the caller can run due
     *  jobs against the persisted values first (see onTimer). */
    skipRecompute?: boolean;
  },
) {
  // Fast path: keep the in-memory store unless the backing file changed.
  // This lets live cron instances recover from manual jobs.json edits without
  // requiring a gateway restart, while still avoiding a full file read when the
  // store has not changed.
  if (state.store && !opts?.forceReload) {
    const fileMtimeMs = await getFileMtimeMs(state.deps.storePath);
    if (fileMtimeMs === null || fileMtimeMs === state.storeFileMtimeMs) {
      return;
    }
  }
  // Force reload always re-reads the file to avoid missing cross-service
  // edits on filesystems with coarse mtime resolution.

  const fileMtimeMs = await getFileMtimeMs(state.deps.storePath);
  const loaded = await loadCronStore(state.deps.storePath);
  const jobs = (loaded.jobs ?? []) as unknown as Array<Record<string, unknown>>;
  const { log } = state.deps;
  log.debug(
    {
      storePath: state.deps.storePath,
      jobCount: jobs.length,
      forceReload: opts?.forceReload ?? false,
    },
    "cron: store loaded from disk",
  );
  const { mutated } = normalizeStoredCronJobs(jobs, { log });
  state.store = { version: 1, jobs: jobs as unknown as CronJob[] };
  state.storeLoadedAtMs = state.deps.nowMs();
  state.storeFileMtimeMs = fileMtimeMs;

  if (!opts?.skipRecompute) {
    recomputeNextRuns(state);
  }

  if (mutated) {
    log.info(
      { storePath: state.deps.storePath, jobCount: jobs.length },
      "cron: store migration applied; persisting updated store",
    );
    await persist(state, { skipBackup: true });
  }
}

export function warnIfDisabled(state: CronServiceState, action: string) {
  if (state.deps.cronEnabled) {
    return;
  }
  if (state.warnedDisabled) {
    return;
  }
  state.warnedDisabled = true;
  state.deps.log.warn(
    { enabled: false, action, storePath: state.deps.storePath },
    "cron: scheduler disabled; jobs will not run automatically",
  );
}

export async function persist(state: CronServiceState, opts?: { skipBackup?: boolean }) {
  if (!state.store) {
    return;
  }
  await saveCronStore(state.deps.storePath, state.store, opts);
  // Update file mtime after save to prevent immediate reload
  state.storeFileMtimeMs = await getFileMtimeMs(state.deps.storePath);
  state.deps.log.debug(
    { storePath: state.deps.storePath, jobCount: state.store.jobs.length },
    "cron: store persisted",
  );
}

/**
 * Watch jobs.json for external changes (e.g. direct file writes as a workaround
 * when CLI RPC is unavailable). When a change is detected, invalidates the
 * in-memory store so the next timer tick picks it up immediately.
 * Falls back gracefully on environments where fs.watch is unreliable (NFS, some containers).
 *
 * Returns a cleanup function to stop watching.
 */
export function watchStore(state: CronServiceState): () => void {
  const path = state.deps.storePath;
  let watcher: import("node:fs").FSWatcher | null = null;

  const tryWatch = () => {
    try {
      watcher = fs.watch(path, { persistent: false }, () => {
        // Invalidate in-memory store — next ensureLoaded will force a reload.
        state.store = null;
        state.storeFileMtimeMs = null;
        state.deps.log.debug(
          { storePath: path },
          "cron: jobs.json changed externally, invalidating store cache",
        );
      });
      watcher.on("error", () => {
        watcher?.close();
        watcher = null;
      });
    } catch {
      // fs.watch unavailable — periodic reload via MAX_TIMER_DELAY_MS tick is the fallback.
    }
  };

  tryWatch();

  return () => {
    watcher?.close();
    watcher = null;
  };
}

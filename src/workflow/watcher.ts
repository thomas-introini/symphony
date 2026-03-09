import fs from "node:fs/promises";

import type { WorkflowDefinition } from "../domain/types.js";
import { load } from "./loader.js";

export interface WatchLogger {
  info(msg: string, ...kv: unknown[]): void;
  warn(msg: string, ...kv: unknown[]): void;
}

export function watch(
  signal: AbortSignal,
  path: string,
  intervalMs: number,
  onReload: (def: WorkflowDefinition) => void,
  logger: WatchLogger
): void {
  const effectiveInterval = intervalMs > 0 ? intervalMs : 2000;
  let lastModMs = 0;

  const timer = setInterval(async () => {
    try {
      const stat = await fs.stat(path);
      const mtimeMs = stat.mtimeMs;
      if (mtimeMs <= lastModMs) {
        return;
      }
      const def = await load(path);
      lastModMs = mtimeMs;
      onReload(def);
      logger.info("workflow reloaded", "path", path, "loaded_at", def.loadedAt.toISOString());
    } catch (error) {
      logger.warn("workflow reload failed; keeping previous", "path", path, "error", String(error));
    }
  }, effectiveInterval);

  signal.addEventListener(
    "abort",
    () => {
      clearInterval(timer);
    },
    { once: true }
  );
}

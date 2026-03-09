import { spawn } from "node:child_process";

import { newError } from "../domain/errors.js";

export async function runHook(signal: AbortSignal, script: string, cwd: string, timeoutMs: number): Promise<void> {
  if (!script) {
    return;
  }

  const timeout = AbortSignal.timeout(timeoutMs);
  const mergedSignal = AbortSignal.any([signal, timeout]);

  await new Promise<void>((resolve, reject) => {
    const child = spawn("bash", ["-lc", script], { cwd, signal: mergedSignal, stdio: "ignore" });
    child.on("error", (error) => {
      reject(newError("hook_failed", "hook command failed", error));
    });
    child.on("exit", (code, sig) => {
      if (timeout.aborted) {
        reject(newError("hook_timeout", "hook exceeded timeout", new Error("timeout")));
        return;
      }
      if (code === 0) {
        resolve();
        return;
      }
      reject(newError("hook_failed", `hook command failed with code=${String(code)} signal=${String(sig)}`));
    });
  });
}

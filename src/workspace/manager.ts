import fs from "node:fs/promises";
import path from "node:path";

import { newError } from "../domain/errors.js";
import { sanitizeWorkspaceKey } from "../domain/normalize.js";
import type { HooksConfig, Issue, Workspace } from "../domain/types.js";
import { runHook } from "./hooks.js";
import { ensureUnderRoot } from "./safety.js";

export interface WorkspaceLogger {
  info(msg: string, ...kv: unknown[]): void;
  warn(msg: string, ...kv: unknown[]): void;
}

export class WorkspaceManager {
  private readonly root: string;
  private readonly hooks: HooksConfig;
  private readonly logger: WorkspaceLogger;
  private readonly defaultHookTimeoutMs = 60000;

  constructor(root: string, hooks: HooksConfig, logger: WorkspaceLogger) {
    this.root = root;
    this.hooks = hooks;
    this.logger = logger;
  }

  async ensureWorkspace(signal: AbortSignal, issueIdentifier: string): Promise<Workspace> {
    const key = sanitizeWorkspaceKey(issueIdentifier);
    if (!key) {
      throw newError("invalid_workspace_key", "workspace key is empty");
    }
    const workspacePath = path.join(this.root, key);
    ensureUnderRoot(this.root, workspacePath);

    let createdNow = false;
    try {
      const st = await fs.stat(workspacePath);
      if (!st.isDirectory()) {
        throw newError("workspace_path_not_directory", `workspace path ${workspacePath} is not a directory`);
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        try {
          await fs.mkdir(workspacePath, { recursive: true });
          createdNow = true;
        } catch (createError) {
          throw newError("workspace_create_failed", "failed to create workspace", createError);
        }
      } else if (error instanceof Error && "code" in error && (error as { code?: string }).code === "workspace_path_not_directory") {
        throw error;
      } else {
        throw newError("workspace_stat_failed", "failed to check workspace", error);
      }
    }

    const ws: Workspace = { path: workspacePath, workspaceKey: key, createdNow };
    if (createdNow) {
      await runHook(signal, this.hooks.afterCreate, ws.path, this.hookTimeoutMs());
    }
    return ws;
  }

  async beforeRun(signal: AbortSignal, workspacePath: string): Promise<void> {
    await runHook(signal, this.hooks.beforeRun, workspacePath, this.hookTimeoutMs());
  }

  async afterRun(signal: AbortSignal, workspacePath: string): Promise<void> {
    try {
      await runHook(signal, this.hooks.afterRun, workspacePath, this.hookTimeoutMs());
    } catch (error) {
      this.logger.warn("after_run hook failed", "workspace_path", workspacePath, "error", String(error));
    }
  }

  async removeWorkspace(signal: AbortSignal, issueIdentifier: string): Promise<void> {
    const key = sanitizeWorkspaceKey(issueIdentifier);
    if (!key) {
      return;
    }
    const workspacePath = path.join(this.root, key);
    try {
      await fs.stat(workspacePath);
    } catch {
      return;
    }
    try {
      await runHook(signal, this.hooks.beforeRemove, workspacePath, this.hookTimeoutMs());
    } catch (error) {
      this.logger.warn("before_remove hook failed", "workspace_path", workspacePath, "error", String(error));
    }
    try {
      ensureUnderRoot(this.root, workspacePath);
    } catch (error) {
      this.logger.warn("workspace remove blocked by safety", "workspace_path", workspacePath, "error", String(error));
      return;
    }
    try {
      await fs.rm(workspacePath, { recursive: true, force: true });
    } catch (error) {
      this.logger.warn("workspace remove failed", "workspace_path", workspacePath, "error", String(error));
    }
  }

  async cleanupTerminal(signal: AbortSignal, issues: Issue[]): Promise<void> {
    for (const issue of issues) {
      await this.removeWorkspace(signal, issue.identifier);
    }
  }

  private hookTimeoutMs(): number {
    return this.hooks.timeoutMs > 0 ? this.hooks.timeoutMs : this.defaultHookTimeoutMs;
  }
}

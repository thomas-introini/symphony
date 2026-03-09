import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

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

  async ensureIssueBranch(signal: AbortSignal, workspacePath: string, issueIdentifier: string): Promise<string> {
    const key = sanitizeWorkspaceKey(issueIdentifier);
    if (!key) {
      throw newError("invalid_workspace_key", "workspace key is empty");
    }
    const branchName = `issue/${key}`;

    const inRepo = await this.runGitCommand(signal, workspacePath, ["rev-parse", "--is-inside-work-tree"]);
    if (inRepo.code !== 0) {
      if (inRepo.signalAborted) {
        throw newError("issue_branch_enforcement_failed", `timed out ensuring git repository for ${issueIdentifier}`);
      }
      const initResult = await this.runGitCommand(signal, workspacePath, ["init"]);
      if (initResult.code !== 0) {
        throw newError("issue_branch_enforcement_failed", `failed to initialize git repo for ${issueIdentifier}`);
      }
      this.logger.info("initialized git repository", "workspace_path", workspacePath, "issue_identifier", issueIdentifier);
    }

    const branchRef = `refs/heads/${branchName}`;
    const hasBranch = await this.runGitCommand(signal, workspacePath, ["show-ref", "--verify", "--quiet", branchRef]);
    const switchArgs = hasBranch.code === 0 ? ["checkout", branchName] : ["checkout", "-b", branchName];
    const switchResult = await this.runGitCommand(signal, workspacePath, switchArgs);
    if (switchResult.code !== 0) {
      throw newError("issue_branch_enforcement_failed", `failed to switch to issue branch ${branchName}`);
    }
    this.logger.info("issue branch ready", "workspace_path", workspacePath, "issue_identifier", issueIdentifier, "branch", branchName);
    return branchName;
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

  private async runGitCommand(
    signal: AbortSignal,
    cwd: string,
    args: string[]
  ): Promise<{ code: number; signalAborted: boolean }> {
    const timeout = AbortSignal.timeout(this.hookTimeoutMs());
    const mergedSignal = AbortSignal.any([signal, timeout]);
    return await new Promise<{ code: number; signalAborted: boolean }>((resolve, reject) => {
      const child = spawn("git", args, { cwd, signal: mergedSignal, stdio: "ignore" });
      child.on("error", (error) => {
        reject(newError("issue_branch_enforcement_failed", `git command failed: git ${args.join(" ")}`, error));
      });
      child.on("exit", (code) => {
        resolve({ code: code ?? 1, signalAborted: timeout.aborted || signal.aborted });
      });
    });
  }
}

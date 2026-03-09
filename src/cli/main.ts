import process from "node:process";

import dotenv from "dotenv";

import { Runner } from "../agent/runner.js";
import { buildServiceConfig } from "../config/schema.js";
import { validatePreflight } from "../config/validate.js";
import type { ServiceConfig, WorkflowDefinition } from "../domain/types.js";
import { Logger } from "../observability/logger.js";
import { Scheduler } from "../orchestrator/scheduler.js";
import { GitHubClient } from "../tracker/githubClient.js";
import { load, resolveWorkflowPath } from "../workflow/loader.js";
import { watch } from "../workflow/watcher.js";
import { WorkspaceManager } from "../workspace/manager.js";

class ConfigHolder {
  private def: WorkflowDefinition;
  private cfg: ServiceConfig;

  constructor(def: WorkflowDefinition, cfg: ServiceConfig) {
    this.def = def;
    this.cfg = cfg;
  }

  current(): { def: WorkflowDefinition; cfg: ServiceConfig } {
    return { def: this.def, cfg: this.cfg };
  }

  update(def: WorkflowDefinition, cfg: ServiceConfig): void {
    this.def = def;
    this.cfg = cfg;
  }
}

interface CliArgs {
  workflowArg: string;
  verboseOps: boolean;
}

async function main(): Promise<void> {
  dotenv.config();
  const args = parseCliArgs(process.argv.slice(2));
  if (args.verboseOps) {
    process.env.SYMPHONY_VERBOSE_OPS = "1";
  }
  const logger = new Logger();

  const workflowPath = resolveWorkflowPath(args.workflowArg);
  const def = await load(workflowPath);
  const cfg = buildServiceConfig(def);
  validatePreflight(cfg);

  const holder = new ConfigHolder(def, cfg);
  const gh = new GitHubClient(cfg.tracker, logger);
  const wm = new WorkspaceManager(cfg.workspace.root, cfg.hooks, logger);
  const runner = new Runner(gh, wm, holder, logger);
  const scheduler = new Scheduler(holder, gh, runner, wm, logger, cfg);

  const controller = new AbortController();
  const stop = () => controller.abort();
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  watch(controller.signal, workflowPath, 2000, (updated) => {
    try {
      const updatedCfg = buildServiceConfig(updated);
      holder.update(updated, updatedCfg);
    } catch (error) {
      logger.warn("workflow reload ignored; invalid config", "error", String(error));
    }
  }, logger);

  await scheduler.run(controller.signal);
  logger.info("shutdown complete");
}

function parseCliArgs(argv: string[]): CliArgs {
  let workflowArg = "";
  let verboseOps = false;
  for (const arg of argv) {
    if (arg === "--verbose-ops" || arg === "--verbose" || arg === "-v") {
      verboseOps = true;
      continue;
    }
    if (!workflowArg) {
      workflowArg = arg;
    }
  }
  return { workflowArg, verboseOps };
}

main().catch((error) => {
  const logger = new Logger();
  logger.error("startup failed", "error", String(error));
  process.exit(1);
});

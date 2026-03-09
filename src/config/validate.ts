import { newError } from "../domain/errors.js";
import { normalizeState } from "../domain/normalize.js";
import type { ServiceConfig } from "../domain/types.js";

export function validatePreflight(cfg: ServiceConfig): void {
  if (!cfg.tracker.kind.trim()) {
    throw newError("unsupported_tracker_kind", "tracker.kind must be set");
  }
  if (normalizeState(cfg.tracker.kind) !== "github") {
    throw newError("unsupported_tracker_kind", "only tracker.kind=github is supported");
  }
  if (!cfg.tracker.apiKey.trim()) {
    throw newError("missing_tracker_api_key", "tracker.api_key is required");
  }
  if (!cfg.tracker.owner.trim()) {
    throw newError("missing_tracker_owner", "tracker.owner is required");
  }
  if (!cfg.tracker.repo.trim()) {
    throw newError("missing_tracker_repo", "tracker.repo is required");
  }
  if (cfg.tracker.projectNumber <= 0) {
    throw newError("missing_tracker_project_number", "tracker.project_number is required");
  }
  if (!cfg.codex.command.trim()) {
    throw newError("invalid_codex_command", "codex.command must be non-empty");
  }
}

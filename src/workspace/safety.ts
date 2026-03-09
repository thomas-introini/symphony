import path from "node:path";

import { newError } from "../domain/errors.js";

export function ensureUnderRoot(root: string, candidate: string): void {
  let absRoot: string;
  let absCandidate: string;
  try {
    absRoot = path.resolve(root);
  } catch (error) {
    throw newError("invalid_workspace_root", "workspace root is invalid", error);
  }
  try {
    absCandidate = path.resolve(candidate);
  } catch (error) {
    throw newError("invalid_workspace_path", "workspace path is invalid", error);
  }

  const rootWithSep = `${absRoot}${path.sep}`;
  if (absCandidate !== absRoot && !absCandidate.startsWith(rootWithSep)) {
    throw newError("workspace_path_outside_root", "workspace path is outside workspace root");
  }
}

export function validateCwd(workspacePath: string, cwd: string): void {
  const a = path.resolve(workspacePath);
  const b = path.resolve(cwd);
  if (a !== b) {
    throw newError("invalid_workspace_cwd", "agent cwd does not match workspace path");
  }
}

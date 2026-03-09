import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { WorkspaceManager } from "../../src/workspace/manager.js";
import { ensureUnderRoot, validateCwd } from "../../src/workspace/safety.js";

const logger = {
  info: () => {},
  warn: () => {}
};

describe("workspace", () => {
  it("checks under root", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ws-"));
    try {
      expect(() => ensureUnderRoot(root, path.join(root, "child"))).not.toThrow();
      expect(() => ensureUnderRoot(root, path.join(root, "..", "outside"))).toThrow();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("checks cwd", () => {
    expect(() => validateCwd("/tmp/a", "/tmp/a")).not.toThrow();
    expect(() => validateCwd("/tmp/a", "/tmp/b")).toThrow();
  });

  it("creates and reuses workspace", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ws-"));
    try {
      const m = new WorkspaceManager(root, { afterCreate: "", beforeRun: "", afterRun: "", beforeRemove: "", timeoutMs: 1000 }, logger);
      const ws1 = await m.ensureWorkspace(AbortSignal.timeout(2000), "ABC-123");
      expect(ws1.createdNow).toBe(true);
      const ws2 = await m.ensureWorkspace(AbortSignal.timeout(2000), "ABC-123");
      expect(ws2.createdNow).toBe(false);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("enforces issue branch per workspace", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ws-"));
    try {
      const m = new WorkspaceManager(root, { afterCreate: "", beforeRun: "", afterRun: "", beforeRemove: "", timeoutMs: 2000 }, logger);
      const ws = await m.ensureWorkspace(AbortSignal.timeout(3000), "ABC-123");
      const branch = await m.ensureIssueBranch(AbortSignal.timeout(3000), ws.path, "ABC-123");
      expect(branch).toBe("issue/ABC-123");
      const head = await fs.readFile(path.join(ws.path, ".git", "HEAD"), "utf8");
      expect(head).toContain("refs/heads/issue/ABC-123");

      const branchAgain = await m.ensureIssueBranch(AbortSignal.timeout(3000), ws.path, "ABC-123");
      expect(branchAgain).toBe("issue/ABC-123");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

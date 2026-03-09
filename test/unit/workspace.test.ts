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
});

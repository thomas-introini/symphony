import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { SymphonyError } from "../../src/domain/errors.js";
import { load, resolveWorkflowPath } from "../../src/workflow/loader.js";

describe("workflow loader", () => {
  it("resolves path", () => {
    expect(resolveWorkflowPath("/tmp/custom.md")).toBe("/tmp/custom.md");
    expect(resolveWorkflowPath("   ")).toBe("./WORKFLOW.md");
  });

  it("loads workflow without front matter", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "wf-"));
    try {
      const file = path.join(dir, "WORKFLOW.md");
      await fs.writeFile(file, "\n\nhello template\n\n", "utf8");
      const def = await load(file);
      expect(Object.keys(def.config)).toHaveLength(0);
      expect(def.promptTemplate).toBe("hello template");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("errors on unterminated front matter", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "wf-"));
    try {
      const file = path.join(dir, "WORKFLOW.md");
      await fs.writeFile(file, "---\ntracker:\n  kind: github\nbody", "utf8");
      await expect(load(file)).rejects.toBeInstanceOf(SymphonyError);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

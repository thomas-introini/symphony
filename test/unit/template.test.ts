import { describe, expect, it } from "vitest";

import { fallbackPrompt, renderPrompt } from "../../src/workflow/template.js";

describe("template", () => {
  const issue = {
    id: "1",
    identifier: "ABC-1",
    title: "Title",
    description: "",
    priority: null,
    state: "Todo",
    branchName: "",
    url: "",
    labels: [],
    blockedBy: [],
    createdAt: null,
    updatedAt: null
  };

  it("uses fallback", async () => {
    const out = await renderPrompt({ config: {}, promptTemplate: "", path: "", loadedAt: new Date() }, issue, null);
    expect(out).toBe(fallbackPrompt);
  });

  it("renders values", async () => {
    const out = await renderPrompt(
      { config: {}, promptTemplate: "Issue {{ issue.identifier }} attempt={{ attempt }}", path: "", loadedAt: new Date() },
      issue,
      3
    );
    expect(out).toContain("ABC-1");
    expect(out).toContain("3");
  });

  it("renders legacy go-style field names", async () => {
    const out = await renderPrompt(
      { config: {}, promptTemplate: "Issue {{ issue.Identifier }} title={{ issue.Title }}", path: "", loadedAt: new Date() },
      issue,
      1
    );
    expect(out).toContain("ABC-1");
    expect(out).toContain("Title");
  });

  it("fails on missing variable", async () => {
    await expect(
      renderPrompt({ config: {}, promptTemplate: "{{ issue.missingField }}", path: "", loadedAt: new Date() }, issue, null)
    ).rejects.toThrow();
  });
});

import { describe, expect, it } from "vitest";

import { normalizeIssue } from "../../src/tracker/normalizeIssue.js";

describe("normalize issue", () => {
  it("normalizes fields", () => {
    const { issue } = normalizeIssue(
      "octo",
      "repo",
      {
        content: {
          id: "I_123",
          number: 42,
          title: "Fix bug",
          body: "details",
          url: "https://github.com/o/r/issues/42",
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-02T00:00:00Z",
          labels: { nodes: [{ name: "Bug" }, { name: " P1 " }] }
        },
        fieldValues: {
          nodes: [
            { name: "In Progress", field: { name: "Status" } },
            { number: 2, field: { name: "Priority" } }
          ]
        }
      },
      "Status",
      "Priority"
    );

    expect(issue).toBeTruthy();
    expect(issue?.id).toBe("I_123");
    expect(issue?.identifier).toBe("repo#42");
    expect(issue?.state).toBe("In Progress");
    expect(issue?.priority).toBe(2);
    expect(issue?.labels).toEqual(["bug", "p1"]);
    expect(issue?.createdAt).toBeTruthy();
    expect(issue?.updatedAt).toBeTruthy();
  });
});

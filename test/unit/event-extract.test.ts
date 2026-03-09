import { describe, expect, it } from "vitest";

import { extractMessage, extractUsage } from "../../src/agent/eventExtract.js";

describe("event extract", () => {
  it("extracts usage", () => {
    const usage = extractUsage({
      usage: {
        input_tokens: 10,
        output_tokens: 20,
        total_tokens: 30
      }
    });
    expect(usage?.input_tokens).toBe(10);
    expect(usage?.output_tokens).toBe(20);
    expect(usage?.total_tokens).toBe(30);
  });

  it("extracts assistant text from nested payload", () => {
    const message = extractMessage({
      item: {
        type: "message",
        content: [
          { type: "output_text", text: "First step" },
          { type: "output_text", output_text: "Second step" }
        ]
      },
      status: "completed"
    });
    expect(message).toContain("First step");
    expect(message).toContain("Second step");
    expect(message).not.toContain("completed");
  });
});

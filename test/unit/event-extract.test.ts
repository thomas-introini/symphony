import { describe, expect, it } from "vitest";

import { extractUsage } from "../../src/agent/eventExtract.js";

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
});

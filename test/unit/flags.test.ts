import { afterEach, describe, expect, it } from "vitest";

import { verboseOpsEnabled } from "../../src/observability/flags.js";

describe("observability flags", () => {
  const original = process.env.SYMPHONY_VERBOSE_OPS;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.SYMPHONY_VERBOSE_OPS;
      return;
    }
    process.env.SYMPHONY_VERBOSE_OPS = original;
  });

  it("treats truthy values as enabled", () => {
    process.env.SYMPHONY_VERBOSE_OPS = "true";
    expect(verboseOpsEnabled()).toBe(true);
    process.env.SYMPHONY_VERBOSE_OPS = "1";
    expect(verboseOpsEnabled()).toBe(true);
  });

  it("treats empty and unknown values as disabled", () => {
    process.env.SYMPHONY_VERBOSE_OPS = "";
    expect(verboseOpsEnabled()).toBe(false);
    process.env.SYMPHONY_VERBOSE_OPS = "maybe";
    expect(verboseOpsEnabled()).toBe(false);
  });
});

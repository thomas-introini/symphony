import fs from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  classifyTurnMessage,
  extractMethod,
  extractRateLimits,
  extractThreadIdFromResponse,
  extractTurnIdFromResponse,
  extractUsage,
  normalizeMethod
} from "../../src/agent/eventExtract.js";

describe("protocol compat", () => {
  it("extracts thread and turn variants", () => {
    const threadCases = [
      { result: { thread: { id: "thread-a" } } },
      { result: { threadId: "thread-b" } },
      { result: { thread_id: "thread-c" } }
    ];
    for (const c of threadCases) {
      expect(extractThreadIdFromResponse(c)).not.toBe("");
    }

    const turnCases = [{ result: { turn: { id: "turn-a" } } }, { result: { turnId: "turn-b" } }, { result: { turn_id: "turn-c" } }];
    for (const c of turnCases) {
      expect(extractTurnIdFromResponse(c)).not.toBe("");
    }
  });

  it("classifies turn messages", () => {
    const tests = [
      { method: "turn/completed", want: "completed" },
      { method: "notifications/turn/failed", want: "failed" },
      { method: "event/turn/cancelled", want: "cancelled" },
      { method: "item/tool/requestUserInput", want: "input_required" }
    ];
    for (const tc of tests) {
      expect(classifyTurnMessage(normalizeMethod(tc.method), {})).toBe(tc.want);
    }
  });

  it("extracts usage/rate limits variants", () => {
    const payload = {
      total_token_usage: { inputTokens: 7, output_tokens: 11, totalTokens: 18 },
      rateLimits: { remaining: 99 }
    };
    const usage = extractUsage(payload);
    expect(usage?.input_tokens).toBe(7);
    expect(usage?.output_tokens).toBe(11);
    expect(usage?.total_tokens).toBe(18);
    expect(extractRateLimits(payload)?.remaining).toBe(99);
  });

  it("covers transcript fixture", async () => {
    const raw = await fs.readFile("test/unit/testdata/codex_transcript_variants.jsonl", "utf8");
    const lines = raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    let completed = false;
    let failed = false;
    let cancelled = false;
    let inputRequired = false;
    for (const line of lines) {
      const msg = JSON.parse(line) as Record<string, unknown>;
      const method = extractMethod(msg);
      const cls = classifyTurnMessage(method, (msg.params ?? {}) as Record<string, unknown>);
      if (cls === "completed") completed = true;
      if (cls === "failed") failed = true;
      if (cls === "cancelled") cancelled = true;
      if (cls === "input_required") inputRequired = true;
    }
    expect(completed).toBe(true);
    expect(failed).toBe(true);
    expect(cancelled).toBe(true);
    expect(inputRequired).toBe(true);
  });
});

import type { CodexTotals, LiveSession } from "../domain/types.js";

export function addSessionDeltas(
  live: LiveSession,
  absoluteInput: number,
  absoluteOutput: number,
  absoluteTotal: number
): void {
  if (absoluteInput > live.lastReportedInput) {
    live.codexInputTokens += absoluteInput - live.lastReportedInput;
    live.lastReportedInput = absoluteInput;
  }
  if (absoluteOutput > live.lastReportedOutput) {
    live.codexOutputTokens += absoluteOutput - live.lastReportedOutput;
    live.lastReportedOutput = absoluteOutput;
  }
  if (absoluteTotal > live.lastReportedTotal) {
    live.codexTotalTokens += absoluteTotal - live.lastReportedTotal;
    live.lastReportedTotal = absoluteTotal;
  }
}

export function addRunDurationSeconds(total: CodexTotals, startedAt: Date): void {
  const sec = Math.floor((Date.now() - startedAt.getTime()) / 1000);
  if (sec > 0) {
    total.secondsRunning += sec;
  }
}

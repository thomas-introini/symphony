export function verboseOpsEnabled(): boolean {
  const raw = (process.env.SYMPHONY_VERBOSE_OPS ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

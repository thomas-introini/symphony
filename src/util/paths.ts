import path from "node:path";

export function absOr(input: string): string {
  try {
    return path.resolve(input);
  } catch {
    return input;
  }
}

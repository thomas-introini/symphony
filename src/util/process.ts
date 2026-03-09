import { access } from "node:fs/promises";

export async function isCommandAvailable(name: string): Promise<boolean> {
  const pathEnv = process.env.PATH ?? "";
  const dirs = pathEnv.split(":").filter(Boolean);
  for (const dir of dirs) {
    try {
      await access(`${dir}/${name}`);
      return true;
    } catch {
      // continue
    }
  }
  return false;
}

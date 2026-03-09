export async function parallel(fns: Array<() => Promise<void> | void>): Promise<void> {
  await Promise.all(fns.map((fn) => Promise.resolve().then(() => fn())));
}

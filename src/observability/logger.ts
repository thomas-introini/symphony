export class Logger {
  info(msg: string, ...kv: unknown[]): void {
    this.write("info", msg, ...kv);
  }

  warn(msg: string, ...kv: unknown[]): void {
    this.write("warn", msg, ...kv);
  }

  error(msg: string, ...kv: unknown[]): void {
    this.write("error", msg, ...kv);
  }

  private write(level: string, msg: string, ...kv: unknown[]): void {
    const parts = [`ts=${new Date().toISOString()}`, `level=${level}`, `msg=${quote(msg)}`];
    for (let i = 0; i + 1 < kv.length; i += 2) {
      parts.push(`${String(kv[i])}=${quote(String(kv[i + 1]))}`);
    }
    process.stdout.write(`${parts.join(" ")}\n`);
  }
}

function quote(v: string): string {
  return /[\s\t\n"]/.test(v) ? JSON.stringify(v) : v;
}

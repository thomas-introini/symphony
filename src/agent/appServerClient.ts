import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

import { newError } from "../domain/errors.js";
import { composeSessionId } from "../domain/normalize.js";
import type { AppServerEvent, TurnResult } from "./protocol.js";
import {
  classifyTurnMessage,
  extractMethod,
  extractMessage,
  extractRateLimits,
  extractThreadIdFromResponse,
  extractTurnIdFromResponse,
  extractUsage,
  isApprovalRequest,
  isToolCall
} from "./eventExtract.js";

type AnyMap = Record<string, unknown>;

export interface AgentLogger {
  info(msg: string, ...kv: unknown[]): void;
  warn(msg: string, ...kv: unknown[]): void;
  error(msg: string, ...kv: unknown[]): void;
}

export class AppServerClient {
  private readonly command: string;
  private readonly readTimeoutMs: number;
  private readonly turnTimeoutMs: number;
  private readonly logger: AgentLogger;

  private child: ChildProcessWithoutNullStreams | null = null;
  private readonly notifQueue: AnyMap[] = [];
  private readonly pending = new Map<number, (v: AnyMap) => void>();
  private idCounter = 0;
  private waiters: Array<() => void> = [];
  private closed = false;
  private preferredThreadSandbox: string | null = null;
  private preferredTurnSandbox: string | null = null;
  private threadFallbackLogged = false;
  private turnFallbackLogged = false;

  constructor(command: string, readTimeoutMs: number, turnTimeoutMs: number, logger: AgentLogger) {
    this.command = command;
    this.readTimeoutMs = readTimeoutMs;
    this.turnTimeoutMs = turnTimeoutMs;
    this.logger = logger;
  }

  async start(signal: AbortSignal, cwd: string): Promise<void> {
    try {
      const child = spawn("bash", ["-lc", this.command], { cwd, signal, stdio: ["pipe", "pipe", "pipe"] });
      this.child = child;
      this.closed = false;

      let stdoutBuffer = "";
      child.stdout.on("data", (chunk: Buffer) => {
        stdoutBuffer += chunk.toString("utf8");
        while (true) {
          const idx = stdoutBuffer.indexOf("\n");
          if (idx < 0) {
            break;
          }
          const line = stdoutBuffer.slice(0, idx).trim();
          stdoutBuffer = stdoutBuffer.slice(idx + 1);
          if (!line) {
            continue;
          }
          if (!(line.startsWith("{") || line.startsWith("["))) {
            continue;
          }
          if (line.length > 10 * 1024 * 1024) {
            this.logger.warn("malformed app-server json line", "error", "line too long");
            continue;
          }
          let msg: unknown;
          try {
            msg = JSON.parse(line);
          } catch (error) {
            this.logger.warn("malformed app-server json line", "error", String(error));
            continue;
          }
          const map = asMap(msg);
          if (!map) {
            continue;
          }
          const id = asInt(map.id);
          if (id !== null && this.pending.has(id)) {
            const resolve = this.pending.get(id);
            if (resolve) {
              this.pending.delete(id);
              resolve(map);
              continue;
            }
          }
          this.notifQueue.push(map);
          this.flushWaiters();
        }
      });

      child.stderr.on("data", (chunk: Buffer) => {
        const lines = chunk
          .toString("utf8")
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean);
        for (const line of lines) {
          if (shouldIgnoreStderrLine(line)) {
            continue;
          }
          this.logger.warn("codex stderr", "line", line);
        }
      });

      child.on("close", () => {
        this.closed = true;
        this.flushWaiters();
      });
      child.on("error", () => {
        this.closed = true;
        this.flushWaiters();
      });
    } catch (error) {
      throw newError("port_exit", "failed to launch codex app-server", error);
    }
  }

  stop(): void {
    if (this.child) {
      this.child.kill("SIGKILL");
      this.child.stdin.end();
    }
  }

  async initialize(signal: AbortSignal, cwd: string, approvalPolicy: string, sandbox: string): Promise<string> {
    await this.request(signal, "initialize", {
      clientInfo: { name: "symphony", version: "1.0" },
      capabilities: {}
    });
    await this.notify("initialized", {});
    const raw = await this.requestWithThreadSandboxFallback(signal, cwd, approvalPolicy, sandbox);
    const threadId = extractThreadIdFromResponse(raw);
    if (!threadId.trim()) {
      throw newError("response_error", "thread/start response missing thread id");
    }
    return threadId;
  }

  async runTurn(
    signal: AbortSignal,
    threadId: string,
    input: string,
    cwd: string,
    title: string,
    approvalPolicy: string,
    sandboxPolicy: string,
    onEvent: (event: AppServerEvent) => void
  ): Promise<TurnResult> {
    const raw = await this.requestWithTurnSandboxFallback(
      signal,
      threadId,
      input,
      cwd,
      title,
      approvalPolicy,
      sandboxPolicy
    );
    const turnId = extractTurnIdFromResponse(raw);
    if (!turnId) {
      throw newError("response_error", "turn/start response missing turn id");
    }

    onEvent({
      event: "session_started",
      timestamp: new Date(),
      message: "",
      threadId,
      turnId,
      sessionId: composeSessionId(threadId, turnId),
      usage: undefined,
      rateLimits: undefined
    });

    const timeoutSignal = AbortSignal.timeout(this.turnTimeoutMs);
    const merged = AbortSignal.any([signal, timeoutSignal]);
    while (true) {
      if (timeoutSignal.aborted) {
        throw newError("turn_timeout", "turn exceeded timeout");
      }
      if (this.closed) {
        throw newError("port_exit", "app-server exited while processing turn");
      }
      const msg = await this.nextNotification(merged);
      const method = extractMethod(msg);
      const params = asMap(msg.params) ?? {};
      onEvent({
        event: method,
        timestamp: new Date(),
        message: extractMessage(params),
        threadId,
        turnId,
        sessionId: composeSessionId(threadId, turnId),
        usage: extractUsage(params),
        rateLimits: extractRateLimits(params)
      });

      const cls = classifyTurnMessage(method, params);
      if (cls === "completed") {
        return { threadId, turnId, outcome: "completed" };
      }
      if (cls === "failed") {
        throw newError("turn_failed", "codex turn failed");
      }
      if (cls === "cancelled") {
        throw newError("turn_cancelled", "codex turn cancelled");
      }
      if (cls === "input_required") {
        throw newError("turn_input_required", "codex requested user input");
      }

      if (isApprovalRequest(method, msg)) {
        const id = msg.id;
        if (id !== undefined) {
          await this.writeJson({ id, result: { approved: true, decision: "acceptForSession" } });
          onEvent({
            event: "approval_auto_approved",
            timestamp: new Date(),
            message: "auto approved",
            threadId,
            turnId,
            sessionId: composeSessionId(threadId, turnId),
            usage: undefined,
            rateLimits: undefined
          });
        }
      }
      if (isToolCall(method)) {
        const id = msg.id;
        if (id !== undefined) {
          await this.writeJson({ id, result: { success: false, error: "unsupported_tool_call" } });
        }
      }
    }
  }

  pid(): string {
    return this.child?.pid ? String(this.child.pid) : "";
  }

  private async request(signal: AbortSignal, method: string, params: AnyMap): Promise<AnyMap> {
    const id = ++this.idCounter;
    const response = new Promise<AnyMap>((resolve) => {
      this.pending.set(id, resolve);
    });
    await this.writeJson({ id, method, params });

    const timeout = AbortSignal.timeout(this.readTimeoutMs);
    const merged = AbortSignal.any([signal, timeout]);
    const result = await Promise.race([
      response,
      this.waitForAbort(merged).then(() => {
        if (timeout.aborted) {
          throw newError("response_timeout", "timed out waiting for app-server response");
        }
        if (this.closed) {
          throw newError("port_exit", "app-server exited before response");
        }
        throw newError("response_error", "request aborted");
      })
    ]);
    const error = asMap(result.error);
    if (error) {
      throw newError("response_error", `app-server returned error: ${JSON.stringify(error)}`);
    }
    return result;
  }

  private async requestWithThreadSandboxFallback(
    signal: AbortSignal,
    cwd: string,
    approvalPolicy: string,
    sandbox: string
  ): Promise<AnyMap> {
    const candidates = preferVariant(threadSandboxCandidates(sandbox), this.preferredThreadSandbox);
    let lastError: unknown;
    for (let i = 0; i < candidates.length; i += 1) {
      const candidate = candidates[i];
      if (!candidate) {
        continue;
      }
      try {
        const response = await this.request(signal, "thread/start", {
          approvalPolicy,
          sandbox: candidate,
          cwd
        });
        this.preferredThreadSandbox = candidate;
        return response;
      } catch (error) {
        lastError = error;
        if (i === candidates.length - 1 || !shouldRetrySandboxVariant(error)) {
          throw error;
        }
        if (!this.threadFallbackLogged) {
          this.logger.warn("thread sandbox variant rejected; retrying alternate", "attempted", candidate);
          this.threadFallbackLogged = true;
        }
      }
    }
    throw lastError;
  }

  private async requestWithTurnSandboxFallback(
    signal: AbortSignal,
    threadId: string,
    input: string,
    cwd: string,
    title: string,
    approvalPolicy: string,
    sandboxPolicy: string
  ): Promise<AnyMap> {
    const candidates = preferVariant(turnSandboxCandidates(sandboxPolicy), this.preferredTurnSandbox);
    let lastError: unknown;
    for (let i = 0; i < candidates.length; i += 1) {
      const candidate = candidates[i];
      if (!candidate) {
        continue;
      }
      try {
        const response = await this.request(signal, "turn/start", {
          threadId,
          input: [{ type: "text", text: input }],
          cwd,
          title,
          approvalPolicy,
          sandboxPolicy: { type: candidate }
        });
        this.preferredTurnSandbox = candidate;
        return response;
      } catch (error) {
        lastError = error;
        if (i === candidates.length - 1 || !shouldRetrySandboxVariant(error)) {
          throw error;
        }
        if (!this.turnFallbackLogged) {
          this.logger.warn("turn sandbox variant rejected; retrying alternate", "attempted", candidate);
          this.turnFallbackLogged = true;
        }
      }
    }
    throw lastError;
  }

  private async notify(method: string, params: AnyMap): Promise<void> {
    await this.writeJson({ method, params });
  }

  private async writeJson(msg: AnyMap): Promise<void> {
    if (!this.child) {
      throw newError("port_exit", "app-server process is not started");
    }
    await new Promise<void>((resolve, reject) => {
      this.child?.stdin.write(`${JSON.stringify(msg)}\n`, (error) => {
        if (error) {
          reject(newError("response_error", "failed to write app-server request", error));
          return;
        }
        resolve();
      });
    });
  }

  private async nextNotification(signal: AbortSignal): Promise<AnyMap> {
    if (this.notifQueue.length > 0) {
      const msg = this.notifQueue.shift();
      if (msg) {
        return msg;
      }
    }
    await Promise.race([
      new Promise<void>((resolve) => {
        this.waiters.push(resolve);
      }),
      this.waitForAbort(signal)
    ]);
    if (signal.aborted) {
      throw newError("response_timeout", "timed out waiting for app-server notification");
    }
    if (this.closed) {
      throw newError("port_exit", "app-server exited while waiting for notifications");
    }
    const msg = this.notifQueue.shift();
    if (!msg) {
      throw newError("response_error", "notification queue was empty");
    }
    return msg;
  }

  private waitForAbort(signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      if (signal.aborted) {
        resolve();
        return;
      }
      signal.addEventListener("abort", () => resolve(), { once: true });
    });
  }

  private flushWaiters(): void {
    for (const waiter of this.waiters) {
      waiter();
    }
    this.waiters = [];
  }
}

function normalizeThreadSandbox(v: string): string {
  const s = v.trim();
  if (s === "read-only" || s === "readOnly") {
    return "read-only";
  }
  if (s === "workspace-write" || s === "workspaceWrite") {
    return "workspace-write";
  }
  if (s === "danger-full-access" || s === "dangerFullAccess") {
    return "danger-full-access";
  }
  return s || "workspace-write";
}

function normalizeTurnSandboxPolicy(v: string): string {
  const s = v.trim();
  if (s === "read-only" || s === "readOnly") {
    return "read-only";
  }
  if (s === "workspace-write" || s === "workspaceWrite") {
    return "workspace-write";
  }
  if (s === "danger-full-access" || s === "dangerFullAccess") {
    return "danger-full-access";
  }
  return s || "workspace-write";
}

function threadSandboxCandidates(v: string): string[] {
  return sandboxCandidates(v, normalizeThreadSandbox(v));
}

function turnSandboxCandidates(v: string): string[] {
  return sandboxCandidates(v, normalizeTurnSandboxPolicy(v));
}

function sandboxCandidates(raw: string, normalized: string): string[] {
  const rawTrimmed = raw.trim();
  const prefersKebab = rawTrimmed.includes("-");

  if (normalized === "workspace-write" || normalized === "workspaceWrite") {
    return prefersKebab ? ["workspace-write", "workspaceWrite"] : ["workspaceWrite", "workspace-write"];
  }
  if (normalized === "read-only" || normalized === "readOnly") {
    return prefersKebab ? ["read-only", "readOnly"] : ["readOnly", "read-only"];
  }
  if (normalized === "danger-full-access" || normalized === "dangerFullAccess") {
    return prefersKebab ? ["danger-full-access", "dangerFullAccess"] : ["dangerFullAccess", "danger-full-access"];
  }
  return [normalized];
}

function shouldRetrySandboxVariant(error: unknown): boolean {
  const text = String(error ?? "").toLowerCase();
  return text.includes("unknown variant");
}

function shouldIgnoreStderrLine(line: string): boolean {
  const normalized = line.toLowerCase();
  if (normalized.startsWith("dropbox: load fq extension")) {
    return true;
  }
  if (normalized.includes("google.protobuf.service module is deprecated")) {
    return true;
  }
  return false;
}

function preferVariant(candidates: string[], preferred: string | null): string[] {
  if (!preferred || !candidates.includes(preferred)) {
    return candidates;
  }
  return [preferred, ...candidates.filter((c) => c !== preferred)];
}

function asMap(v: unknown): AnyMap | null {
  if (typeof v === "object" && v !== null && !Array.isArray(v)) {
    return v as AnyMap;
  }
  return null;
}

function asInt(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) {
    return Math.trunc(v);
  }
  if (typeof v === "string") {
    const n = Number.parseInt(v.trim(), 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export class SymphonyError extends Error {
  readonly code: string;
  readonly causeError?: unknown;

  constructor(code: string, message: string, causeError?: unknown) {
    super(causeError ? `${code}: ${message}: ${String(causeError)}` : `${code}: ${message}`);
    this.code = code;
    this.causeError = causeError;
  }
}

export function newError(code: string, message: string, causeError?: unknown): SymphonyError {
  return new SymphonyError(code, message, causeError);
}

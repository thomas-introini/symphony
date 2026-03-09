export interface AppServerEvent {
  event: string;
  timestamp: Date;
  message: string;
  threadId: string;
  turnId: string;
  sessionId: string;
  usage: Record<string, number> | undefined;
  rateLimits: Record<string, unknown> | undefined;
}

export interface TurnResult {
  threadId: string;
  turnId: string;
  outcome: string;
}

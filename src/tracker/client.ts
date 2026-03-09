import type { Issue } from "../domain/types.js";

export interface TrackerClient {
  fetchCandidateIssues(signal: AbortSignal): Promise<Issue[]>;
  fetchIssuesByStates(signal: AbortSignal, stateNames: string[]): Promise<Issue[]>;
  fetchIssueStatesByIds(signal: AbortSignal, issueIds: string[]): Promise<Record<string, string>>;
  transitionIssueToState(signal: AbortSignal, issueId: string, stateName: string): Promise<void>;
  addIssueComment(signal: AbortSignal, issueId: string, body: string): Promise<void>;
  fetchLatestPlanComment(signal: AbortSignal, issueId: string, tag: string): Promise<string | null>;
}

export const generationTaskStatuses = [
  "queued",
  "claimed",
  "submitting",
  "submitted",
  "polling",
  "finalizing",
  "retry_wait",
  "blocked",
  "cancelling",
  "cancelled",
  "succeeded",
  "failed",
  "manual_review",
] as const;

export type GenerationTaskStatus = (typeof generationTaskStatuses)[number];

export const generationTaskLanes = ["text", "image", "video", "audio", "compose", "qa", "publish"] as const;
export type GenerationTaskLane = (typeof generationTaskLanes)[number];

export interface GenerationTask<TPayload = unknown, TResult = unknown> {
  id: string;
  projectId: number;
  legacyTaskId: number | null;
  lane: GenerationTaskLane;
  type: string;
  resourceKey: string | null;
  status: GenerationTaskStatus;
  priority: number;
  payload: TPayload;
  payloadVersion: number;
  result: TResult | null;
  attempts: number;
  maxAttempts: number;
  leaseOwner: string | null;
  leaseExpiresAt: number | null;
  nextRunAt: number | null;
  provider: string | null;
  providerJobId: string | null;
  idempotencyKey: string;
  errorCode: string | null;
  errorMessage: string | null;
  cancelRequested: boolean;
  createdAt: number;
  updatedAt: number;
  startedAt: number | null;
  finishedAt: number | null;
}

const terminalStatuses = new Set<GenerationTaskStatus>(["cancelled", "succeeded", "failed"]);

export function isTerminalTaskStatus(status: GenerationTaskStatus): boolean {
  return terminalStatuses.has(status);
}

export class TaskExecutionError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly safeToRetry: boolean,
    public readonly providerStateKnown: boolean = false,
  ) {
    super(message);
    this.name = "TaskExecutionError";
  }
}

export class TaskCancelledError extends Error {
  constructor(message = "任务已取消") {
    super(message);
    this.name = "TaskCancelledError";
  }
}

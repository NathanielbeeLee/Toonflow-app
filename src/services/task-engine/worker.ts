import { GenerationTask, GenerationTaskLane, GenerationTaskStatus, TaskCancelledError, TaskExecutionError } from "@/domain/generationTask";
import { generationTaskRepository } from "@/services/task-engine/repository";

export interface TaskHandlerContext {
  workerId: string;
  transitionToSubmitting(): Promise<void>;
  persistProviderJobId(providerJobId: string): Promise<void>;
  transitionToPolling(): Promise<void>;
  transitionToFinalizing(): Promise<void>;
  throwIfCancelled(): Promise<void>;
}

export interface TaskHandler {
  execute(task: GenerationTask, context: TaskHandlerContext): Promise<unknown>;
}

const handlers = new Map<string, TaskHandler>();

export function registerTaskHandler(type: string, handler: TaskHandler): void {
  handlers.set(type, handler);
}

class GenerationTaskWorker {
  private running = false;
  private timer: NodeJS.Timeout | null = null;
  private readonly active = new Set<Promise<void>>();
  private readonly workerId = `toonflow-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  private readonly concurrency = Math.max(1, Math.min(8, Number(process.env.TOONFLOW_TASK_CONCURRENCY ?? 2)) || 2);
  private readonly leaseMs = 30_000;
  private readonly lanes: GenerationTaskLane[] = ["video", "image", "audio", "text", "compose", "qa", "publish"];
  private laneCursor = 0;
  private lastRecoveryAt = 0;

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    const recovered = await generationTaskRepository.recoverExpired();
    this.lastRecoveryAt = Date.now();
    if (recovered.requeued || recovered.manualReview || recovered.cancelled) {
      console.warn("[持久任务恢复]", recovered);
    }
    this.schedule(0);
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(delayMs = 400): void {
    if (!this.running) return;
    this.timer = setTimeout(() => void this.tick(), delayMs);
    this.timer.unref?.();
  }

  private async tick(): Promise<void> {
    try {
      if (Date.now() - this.lastRecoveryAt >= 15_000) {
        const recovered = await generationTaskRepository.recoverExpired();
        this.lastRecoveryAt = Date.now();
        if (recovered.requeued || recovered.manualReview || recovered.cancelled) {
          console.warn("[持久任务定期恢复]", recovered);
        }
      }
      while (this.running && this.active.size < this.concurrency) {
        const lane = this.lanes[this.laneCursor++ % this.lanes.length];
        const task = await generationTaskRepository.claimNext(this.workerId, lane, this.leaseMs);
        if (!task) {
          if (this.laneCursor % this.lanes.length !== 0) continue;
          break;
        }
        const execution = this.execute(task).finally(() => this.active.delete(execution));
        this.active.add(execution);
      }
    } catch (error) {
      console.error("[持久任务调度失败]", error);
    } finally {
      this.schedule();
    }
  }

  private async execute(initialTask: GenerationTask): Promise<void> {
    const heartbeat = setInterval(() => {
      void generationTaskRepository.heartbeat(initialTask.id, this.workerId, this.leaseMs);
    }, 10_000);
    heartbeat.unref?.();
    let enteredPaidBoundary = Boolean(initialTask.providerJobId);
    try {
      const handler = handlers.get(initialTask.type);
      if (!handler) throw new TaskExecutionError(`没有注册任务处理器: ${initialTask.type}`, "HANDLER_NOT_FOUND", false);
      const context: TaskHandlerContext = {
        workerId: this.workerId,
        transitionToSubmitting: async () => {
          await this.throwIfCancelled(initialTask.id);
          await generationTaskRepository.transition(initialTask.id, this.workerId, ["claimed"], "submitting");
          enteredPaidBoundary = true;
        },
        persistProviderJobId: async (providerJobId: string) => {
          await generationTaskRepository.persistProviderJobId(initialTask.id, this.workerId, providerJobId);
          enteredPaidBoundary = true;
        },
        transitionToPolling: async () => {
          await this.throwIfCancelled(initialTask.id);
          const current = await generationTaskRepository.get(initialTask.id);
          const from: GenerationTaskStatus[] = current?.status === "claimed" ? ["claimed"] : ["submitted"];
          await generationTaskRepository.transition(initialTask.id, this.workerId, from, "polling");
        },
        transitionToFinalizing: async () => {
          await this.throwIfCancelled(initialTask.id);
          await generationTaskRepository.transition(initialTask.id, this.workerId, ["submitting", "submitted", "polling"], "finalizing");
        },
        throwIfCancelled: async () => this.throwIfCancelled(initialTask.id),
      };
      const result = await handler.execute(initialTask, context);
      await context.throwIfCancelled();
      await generationTaskRepository.finish(initialTask.id, "succeeded", { result });
    } catch (error) {
      const current = await generationTaskRepository.get(initialTask.id);
      if (error instanceof TaskCancelledError || current?.status === "cancelling" || current?.cancelRequested) {
        await generationTaskRepository.finish(initialTask.id, "cancelled", {
          errorCode: "CANCELLED_BY_USER",
          errorMessage: error instanceof Error ? error.message : "任务已取消",
        });
      } else {
        const normalized = error instanceof Error ? error : new Error(String(error));
        const safeToRetry = error instanceof TaskExecutionError ? error.safeToRetry : !enteredPaidBoundary;
        const code = error instanceof TaskExecutionError ? error.code : "TASK_EXECUTION_FAILED";
        if (safeToRetry && current && current.attempts < current.maxAttempts) {
          const backoffMs = Math.min(60_000, 2 ** Math.max(0, current.attempts - 1) * 2_000);
          await generationTaskRepository.finish(initialTask.id, "retry_wait", {
            errorCode: code,
            errorMessage: normalized.message,
            nextRunAt: Date.now() + backoffMs,
          });
        } else if (enteredPaidBoundary && !(error instanceof TaskExecutionError && error.providerStateKnown)) {
          await generationTaskRepository.finish(initialTask.id, "manual_review", {
            errorCode: "UNKNOWN_PROVIDER_STATE",
            errorMessage: `${normalized.message}。任务已越过供应商提交边界，为避免重复扣费未自动重试。`,
          });
        } else {
          await generationTaskRepository.finish(initialTask.id, "failed", {
            errorCode: code,
            errorMessage: normalized.message,
          });
        }
      }
    } finally {
      clearInterval(heartbeat);
    }
  }

  private async throwIfCancelled(taskId: string): Promise<void> {
    const task = await generationTaskRepository.get(taskId);
    if (!task || task.cancelRequested || task.status === "cancelling" || task.status === "cancelled") {
      throw new TaskCancelledError();
    }
  }
}

export const generationTaskWorker = new GenerationTaskWorker();

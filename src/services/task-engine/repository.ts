import crypto from "node:crypto";
import { v4 as uuid } from "uuid";
import { db } from "@/utils/db";
import {
  GenerationTask,
  GenerationTaskLane,
  GenerationTaskStatus,
  isTerminalTaskStatus,
} from "@/domain/generationTask";

interface EnqueueTaskInput {
  projectId: number;
  legacyTaskId?: number;
  lane: GenerationTaskLane;
  type: string;
  resourceKey?: string;
  payload: unknown;
  provider?: string;
  idempotencyKey: string;
  priority?: number;
  maxAttempts?: number;
}

interface TaskFilters {
  projectId?: number;
  lane?: GenerationTaskLane;
  status?: GenerationTaskStatus;
  type?: string;
  page?: number;
  limit?: number;
}

const activeStatuses: GenerationTaskStatus[] = [
  "queued",
  "claimed",
  "submitting",
  "submitted",
  "polling",
  "finalizing",
  "retry_wait",
  "blocked",
  "cancelling",
  "manual_review",
];

function parseJson(value: unknown): unknown {
  if (typeof value !== "string" || value.length === 0) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function mapRow(row: any): GenerationTask {
  return {
    id: row.id,
    projectId: row.project_id,
    legacyTaskId: row.legacy_task_id ?? null,
    lane: row.lane,
    type: row.type,
    resourceKey: row.resource_key ?? null,
    status: row.status,
    priority: row.priority,
    payload: parseJson(row.payload),
    payloadVersion: row.payload_version,
    result: parseJson(row.result),
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    leaseOwner: row.lease_owner ?? null,
    leaseExpiresAt: row.lease_expires_at ?? null,
    nextRunAt: row.next_run_at ?? null,
    provider: row.provider ?? null,
    providerJobId: row.provider_job_id ?? null,
    idempotencyKey: row.idempotency_key,
    errorCode: row.error_code ?? null,
    errorMessage: row.error_message ?? null,
    cancelRequested: row.cancel_requested === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at ?? null,
    finishedAt: row.finished_at ?? null,
  };
}

async function recordEvent(task: GenerationTask, action: string, before: unknown, after: unknown, actor = "system") {
  await db("project_events").insert({
    id: uuid(),
    project_id: task.projectId,
    entity_type: "generation_task",
    entity_id: task.id,
    action,
    before_data: before == null ? null : JSON.stringify(before),
    after_data: after == null ? null : JSON.stringify(after),
    actor,
    created_at: Date.now(),
  });
}

export function stableIdempotencyKey(value: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

class GenerationTaskRepository {
  async enqueue(input: EnqueueTaskInput): Promise<{ task: GenerationTask; deduped: boolean }> {
    const existing = await db("generation_tasks").where("idempotency_key", input.idempotencyKey).first();
    if (existing) return { task: mapRow(existing), deduped: true };

    if (input.resourceKey) {
      const active = await db("generation_tasks")
        .where("resource_key", input.resourceKey)
        .whereIn("status", activeStatuses)
        .orderBy("created_at", "desc")
        .first();
      if (active) return { task: mapRow(active), deduped: true };
    }

    const now = Date.now();
    const id = uuid();
    try {
      await db("generation_tasks").insert({
        id,
        project_id: input.projectId,
        legacy_task_id: input.legacyTaskId ?? null,
        lane: input.lane,
        type: input.type,
        resource_key: input.resourceKey ?? null,
        status: "queued",
        priority: input.priority ?? 0,
        payload: JSON.stringify(input.payload),
        payload_version: 1,
        result: null,
        attempts: 0,
        max_attempts: input.maxAttempts ?? 3,
        provider: input.provider ?? null,
        idempotency_key: input.idempotencyKey,
        cancel_requested: 0,
        created_at: now,
        updated_at: now,
      });
    } catch (error) {
      const raced = await db("generation_tasks").where("idempotency_key", input.idempotencyKey).first();
      if (raced) return { task: mapRow(raced), deduped: true };
      throw error;
    }
    const task = await this.get(id);
    if (!task) throw new Error(`任务创建后无法读取: ${id}`);
    await recordEvent(task, "enqueued", null, { status: task.status, type: task.type });
    return { task, deduped: false };
  }

  async get(id: string): Promise<GenerationTask | null> {
    const row = await db("generation_tasks").where("id", id).first();
    return row ? mapRow(row) : null;
  }

  async list(filters: TaskFilters): Promise<{ data: GenerationTask[]; total: number }> {
    const page = Math.max(1, filters.page ?? 1);
    const limit = Math.min(100, Math.max(1, filters.limit ?? 20));
    const apply = (query: any) => {
      if (filters.projectId != null) query.where("project_id", filters.projectId);
      if (filters.lane) query.where("lane", filters.lane);
      if (filters.status) query.where("status", filters.status);
      if (filters.type) query.where("type", filters.type);
      return query;
    };
    const rows = await apply(db("generation_tasks").select("*")).orderBy("created_at", "desc").offset((page - 1) * limit).limit(limit);
    const countRow = await apply(db("generation_tasks").count("* as total")).first();
    return { data: rows.map(mapRow), total: Number(countRow?.total ?? 0) };
  }

  async claimNext(workerId: string, lane: GenerationTaskLane, leaseMs: number): Promise<GenerationTask | null> {
    return db.transaction(async (trx) => {
      const now = Date.now();
      const row = await trx("generation_tasks")
        .where("lane", lane)
        .whereIn("status", ["queued", "retry_wait"])
        .where("cancel_requested", 0)
        .andWhere((query) => query.whereNull("next_run_at").orWhere("next_run_at", "<=", now))
        .whereNotExists(function () {
          this.select(trx.raw("1"))
            .from("task_dependencies as dependency")
            .leftJoin("generation_tasks as parent", "parent.id", "dependency.depends_on_task_id")
            .whereRaw("dependency.task_id = generation_tasks.id")
            .whereRaw("coalesce(parent.status, 'missing') <> dependency.requirement");
        })
        .orderBy("priority", "desc")
        .orderBy("created_at", "asc")
        .first();
      if (!row) return null;
      const updated = await trx("generation_tasks")
        .where("id", row.id)
        .whereIn("status", ["queued", "retry_wait"])
        .update({
          status: "claimed",
          attempts: trx.raw("attempts + 1"),
          lease_owner: workerId,
          lease_expires_at: now + leaseMs,
          started_at: row.started_at ?? now,
          updated_at: now,
        });
      if (updated !== 1) return null;
      const claimed = await trx("generation_tasks").where("id", row.id).first();
      return claimed ? mapRow(claimed) : null;
    });
  }

  async heartbeat(id: string, workerId: string, leaseMs: number): Promise<boolean> {
    const updated = await db("generation_tasks")
      .where("id", id)
      .where("lease_owner", workerId)
      .whereIn("status", ["claimed", "submitting", "submitted", "polling", "finalizing", "cancelling"])
      .update({ lease_expires_at: Date.now() + leaseMs, updated_at: Date.now() });
    return updated === 1;
  }

  async transition(id: string, workerId: string, from: GenerationTaskStatus[], to: GenerationTaskStatus): Promise<GenerationTask> {
    const before = await this.get(id);
    if (!before) throw new Error(`任务不存在: ${id}`);
    const updated = await db("generation_tasks")
      .where("id", id)
      .where("lease_owner", workerId)
      .whereIn("status", from)
      .update({ status: to, updated_at: Date.now() });
    if (updated !== 1) throw new Error(`任务状态已变化，无法从 ${from.join("/")} 切换到 ${to}`);
    const task = await this.get(id);
    if (!task) throw new Error(`任务不存在: ${id}`);
    await recordEvent(task, "status_changed", { status: before.status }, { status: to });
    await this.syncLegacyTask(task);
    return task;
  }

  async persistProviderJobId(id: string, workerId: string, providerJobId: string): Promise<GenerationTask> {
    const before = await this.get(id);
    if (!before) throw new Error(`任务不存在: ${id}`);
    const updated = await db("generation_tasks")
      .where("id", id)
      .where("lease_owner", workerId)
      .where("status", "submitting")
      .whereNull("provider_job_id")
      .update({
        provider_job_id: providerJobId,
        status: "submitted",
        updated_at: Date.now(),
      });
    if (updated !== 1) throw new Error("远端任务 ID 写入失败；已停止自动处理以避免重复提交");
    const task = await this.get(id);
    if (!task) throw new Error(`任务不存在: ${id}`);
    await recordEvent(task, "provider_job_persisted", { status: before.status }, { status: task.status, providerJobId });
    await this.syncLegacyTask(task);
    return task;
  }

  async requestCancel(id: string): Promise<GenerationTask | null> {
    const task = await this.get(id);
    if (!task) return null;
    if (isTerminalTaskStatus(task.status)) return task;
    const now = Date.now();
    const immediate = ["queued", "retry_wait", "blocked", "manual_review"].includes(task.status);
    await db("generation_tasks").where("id", id).update({
      cancel_requested: 1,
      status: immediate ? "cancelled" : "cancelling",
      finished_at: immediate ? now : null,
      updated_at: now,
    });
    const updated = await this.get(id);
    if (updated) await recordEvent(updated, "cancel_requested", { status: task.status }, { status: updated.status }, "user");
    await this.syncLegacyTask(updated);
    return updated;
  }

  async retry(id: string, confirmUnknownProviderState: boolean): Promise<GenerationTask> {
    const task = await this.get(id);
    if (!task) throw new Error(`任务不存在: ${id}`);
    if (!(["failed", "cancelled", "manual_review"] as GenerationTaskStatus[]).includes(task.status)) {
      throw new Error(`状态 ${task.status} 不允许重试`);
    }
    if (task.status === "manual_review" && !confirmUnknownProviderState) {
      throw new Error("该任务可能已向供应商提交；确认远端没有在运行或已取消后才能重试");
    }
    await db("generation_tasks").where("id", id).update({
      status: "queued",
      cancel_requested: 0,
      lease_owner: null,
      lease_expires_at: null,
      next_run_at: null,
      error_code: null,
      error_message: null,
      finished_at: null,
      updated_at: Date.now(),
    });
    const updated = await this.get(id);
    if (!updated) throw new Error(`任务不存在: ${id}`);
    await recordEvent(updated, "retried", { status: task.status }, { status: updated.status }, "user");
    await this.syncLegacyTask(updated);
    return updated;
  }

  async finish(
    id: string,
    status: "succeeded" | "failed" | "cancelled" | "manual_review" | "retry_wait",
    options: { result?: unknown; errorCode?: string; errorMessage?: string; nextRunAt?: number } = {},
  ): Promise<GenerationTask> {
    const before = await this.get(id);
    if (!before) throw new Error(`任务不存在: ${id}`);
    let targetStatus = status;
    const updateValues = () => ({
      status: targetStatus,
      result: options.result === undefined ? before.result == null ? null : JSON.stringify(before.result) : JSON.stringify(options.result),
      error_code: options.errorCode ?? null,
      error_message: options.errorMessage ?? null,
      next_run_at: options.nextRunAt ?? null,
      lease_owner: null,
      lease_expires_at: null,
      finished_at: targetStatus !== "retry_wait" && targetStatus !== "manual_review" ? Date.now() : null,
      updated_at: Date.now(),
    });
    let query = db("generation_tasks").where("id", id);
    if (targetStatus !== "cancelled") query = query.where("cancel_requested", 0).whereNotIn("status", ["cancelled", "succeeded"]);
    let affected = await query.update(updateValues());
    if (affected === 0 && targetStatus !== "cancelled") {
      const current = await this.get(id);
      if (current?.cancelRequested || current?.status === "cancelling" || current?.status === "cancelled") {
        targetStatus = "cancelled";
        options = { errorCode: "CANCELLED_BY_USER", errorMessage: "任务已取消" };
        affected = await db("generation_tasks").where("id", id).whereNot("status", "succeeded").update(updateValues());
      }
    }
    if (affected === 0) {
      const current = await this.get(id);
      if (current) return current;
      throw new Error(`任务状态收口失败: ${id}`);
    }
    const task = await this.get(id);
    if (!task) throw new Error(`任务不存在: ${id}`);
    await recordEvent(task, "finished", { status: before.status }, { status: targetStatus, errorCode: options.errorCode ?? null });
    await this.syncLegacyTask(task);
    return task;
  }

  async recoverExpired(): Promise<{ requeued: number; manualReview: number; cancelled: number }> {
    const now = Date.now();
    const expired = (await db("generation_tasks")
      .whereNotNull("lease_expires_at")
      .where("lease_expires_at", "<", now)
      .whereIn("status", ["claimed", "submitting", "submitted", "polling", "finalizing", "cancelling"])) as any[];
    let requeued = 0;
    let manualReview = 0;
    let cancelled = 0;
    for (const row of expired) {
      const task = mapRow(row);
      if (task.cancelRequested || task.status === "cancelling") {
        await this.finish(task.id, "cancelled", { errorCode: "CANCELLED_DURING_RESTART", errorMessage: "应用退出前正在取消" });
        cancelled++;
      } else if (task.status === "claimed" || (task.providerJobId && ["submitted", "polling", "finalizing"].includes(task.status))) {
        await db("generation_tasks").where("id", task.id).update({
          status: "queued",
          lease_owner: null,
          lease_expires_at: null,
          next_run_at: now,
          error_code: task.providerJobId ? "RESUMING_PROVIDER_JOB" : "LEASE_EXPIRED_BEFORE_SUBMIT",
          error_message: task.providerJobId
            ? "已保存供应商任务 ID，应用重启后将继续轮询，不会重新提交"
            : "任务在付费提交前失去 worker，已安全重新排队",
          updated_at: now,
        });
        await this.syncLegacyTask(await this.get(task.id));
        requeued++;
      } else {
        await this.finish(task.id, "manual_review", {
          errorCode: "UNKNOWN_PROVIDER_STATE_AFTER_RESTART",
          errorMessage: "任务可能已提交到供应商。为避免重复扣费，已停止自动重试，请先核对供应商后台。",
        });
        manualReview++;
      }
    }
    return { requeued, manualReview, cancelled };
  }

  private async syncLegacyTask(task: GenerationTask | null): Promise<void> {
    if (!task?.legacyTaskId) return;
    const stateMap: Partial<Record<GenerationTaskStatus, string>> = {
      queued: "排队中",
      claimed: "进行中",
      submitting: "进行中",
      submitted: "进行中",
      polling: "进行中",
      finalizing: "进行中",
      retry_wait: "等待重试",
      blocked: "已阻塞",
      cancelling: "取消中",
      cancelled: "已取消",
      succeeded: "已完成",
      failed: "生成失败",
      manual_review: "需人工确认",
    };
    await db("o_tasks").where("id", task.legacyTaskId).update({
      state: stateMap[task.status] ?? task.status,
      reason: task.errorMessage,
    });
    if (task.type === "video.generate") {
      const payload = task.payload as { videoId?: number } | null;
      if (payload?.videoId) {
        const videoStateMap: Partial<Record<GenerationTaskStatus, string>> = {
          queued: "排队中",
          claimed: "生成中",
          submitting: "生成中",
          submitted: "生成中",
          polling: "生成中",
          finalizing: "生成中",
          retry_wait: "等待重试",
          blocked: "已阻塞",
          cancelling: "取消中",
          cancelled: "已取消",
          succeeded: "生成成功",
          failed: "生成失败",
          manual_review: "需人工确认",
        };
        await db("o_video").where("id", payload.videoId).update({
          state: videoStateMap[task.status] ?? task.status,
          errorReason: task.errorMessage,
        });
      }
    }
    const imageState = ["cancelled", "failed", "manual_review"].includes(task.status) ? "生成失败" : task.status === "succeeded" ? "已完成" : "生成中";
    if (task.type === "asset.image.generate") {
      const payload = task.payload as { imageId?: number } | null;
      if (payload?.imageId) {
        await db("o_image").where("id", payload.imageId).update({
          state: imageState,
          errorReason: task.errorMessage,
        });
      }
    }
    if (task.type === "storyboard.image.generate") {
      const payload = task.payload as { storyboardId?: number } | null;
      if (payload?.storyboardId) {
        await db("o_storyboard").where("id", payload.storyboardId).update({
          state: imageState,
          reason: task.errorMessage,
        });
      }
    }
    if (task.type === "tts.utterance.generate") {
      const payload = task.payload as { utteranceId?: string } | null;
      if (payload?.utteranceId) {
        const utteranceStateMap: Partial<Record<GenerationTaskStatus, string>> = {
          queued: "queued",
          claimed: "generating",
          submitting: "generating",
          submitted: "generating",
          polling: "generating",
          finalizing: "generating",
          retry_wait: "retry_wait",
          blocked: "blocked",
          cancelling: "cancelling",
          cancelled: "cancelled",
          succeeded: "succeeded",
          failed: "failed",
          manual_review: "manual_review",
        };
        await (db as any)("utterances").where("id", payload.utteranceId).update({
          status: utteranceStateMap[task.status] ?? task.status,
          error_message: task.errorMessage,
          updated_at: Date.now(),
        });
      }
    }
  }
}

export const generationTaskRepository = new GenerationTaskRepository();

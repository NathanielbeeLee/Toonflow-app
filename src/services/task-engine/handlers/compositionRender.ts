import { db } from "@/utils/db";
import { GenerationTask, TaskExecutionError } from "@/domain/generationTask";
import { TaskHandler, TaskHandlerContext } from "@/services/task-engine/worker";
import { CompositionRenderPreset, renderTimelinePreview } from "@/services/composition/renderer";
import { NormalizedTimeline } from "@/services/composition/timeline";

const sql = db as any;

export interface CompositionRenderTaskPayload {
  projectId: number;
  scriptId: number;
  compositionJobId: string;
  timelineId: string;
  timelineVersion: number;
  timelineChecksum: string;
  preset: CompositionRenderPreset;
  outputPath: string;
  model: "local:ffmpeg";
}

export const compositionRenderTaskHandler: TaskHandler = {
  async execute(task: GenerationTask, context: TaskHandlerContext) {
    const payload = task.payload as CompositionRenderTaskPayload;
    const [job, timelineRow] = await Promise.all([
      sql("composition_jobs").where({ id: payload.compositionJobId, project_id: payload.projectId }).first(),
      sql("project_timelines").where({ id: payload.timelineId, project_id: payload.projectId, script_id: payload.scriptId }).first(),
    ]);
    if (!job) throw new TaskExecutionError("合成任务记录不存在", "COMPOSITION_JOB_NOT_FOUND", false, true);
    if (!timelineRow) throw new TaskExecutionError("时间线版本不存在", "TIMELINE_NOT_FOUND", false, true);
    if (timelineRow.version !== payload.timelineVersion || timelineRow.checksum !== payload.timelineChecksum) {
      throw new TaskExecutionError("时间线版本或校验和不一致，已拒绝渲染", "TIMELINE_CHECKSUM_MISMATCH", false, true);
    }

    await context.throwIfCancelled();
    await context.transitionToPolling();
    await sql("composition_jobs").where("id", payload.compositionJobId).update({
      status: "rendering",
      error_message: null,
      updated_at: Date.now(),
    });
    try {
      const result = await renderTimelinePreview({
        taskId: task.id,
        timeline: JSON.parse(timelineRow.payload) as NormalizedTimeline,
        outputPath: payload.outputPath,
        preset: payload.preset,
        shouldCancel: async () => {
          const row = await sql("generation_tasks").where("id", task.id).select("cancel_requested", "status").first();
          return !row || row.cancel_requested === 1 || ["cancelling", "cancelled"].includes(row.status);
        },
      });
      await context.transitionToFinalizing();
      await sql("composition_jobs").where("id", payload.compositionJobId).update({
        status: "succeeded",
        output_path: result.outputPath,
        output_checksum: result.outputChecksum,
        duration_ms: result.durationMs,
        render_log: JSON.stringify(result.renderLog),
        error_message: null,
        updated_at: Date.now(),
      });
      return {
        ...result,
        compositionJobId: payload.compositionJobId,
        timelineId: payload.timelineId,
        timelineVersion: payload.timelineVersion,
        timelineChecksum: payload.timelineChecksum,
      };
    } catch (error) {
      await sql("composition_jobs").where("id", payload.compositionJobId).update({
        status: "failed",
        error_message: error instanceof Error ? error.message : String(error),
        updated_at: Date.now(),
      });
      throw error;
    }
  },
};

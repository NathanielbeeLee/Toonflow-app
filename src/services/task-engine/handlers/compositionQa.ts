import { db } from "@/utils/db";
import { GenerationTask, TaskExecutionError } from "@/domain/generationTask";
import { TaskHandler, TaskHandlerContext } from "@/services/task-engine/worker";
import { inspectMediaQuality } from "@/services/media/qa";
import { NormalizedTimeline } from "@/services/composition/timeline";

const sql = db as any;

export interface CompositionQaTaskPayload {
  projectId: number;
  scriptId: number;
  reportId: string;
  compositionJobId: string;
  timelineId: string;
  outputPath: string;
  outputChecksum: string;
  expectedDurationMs: number;
  preset: string;
  model: "local:ffmpeg-qa";
}

export const compositionQaTaskHandler: TaskHandler = {
  async execute(task: GenerationTask, context: TaskHandlerContext) {
    const payload = task.payload as CompositionQaTaskPayload;
    const [report, job, timelineRow] = await Promise.all([
      sql("media_qa_reports").where({ id: payload.reportId, project_id: payload.projectId }).first(),
      sql("composition_jobs").where({ id: payload.compositionJobId, project_id: payload.projectId }).first(),
      sql("project_timelines").where({ id: payload.timelineId, project_id: payload.projectId }).first(),
    ]);
    if (!report || !job || !timelineRow) throw new TaskExecutionError("QA 输入记录不存在", "QA_INPUT_NOT_FOUND", false, true);
    if (job.status !== "succeeded" || job.output_checksum !== payload.outputChecksum) {
      throw new TaskExecutionError("成片状态或校验和已变化，请重新创建 QA", "QA_OUTPUT_CHANGED", false, true);
    }
    await context.throwIfCancelled();
    await context.transitionToPolling();
    await sql("media_qa_reports").where("id", payload.reportId).update({ status: "running", error_message: null, updated_at: Date.now() });
    try {
      const result = await inspectMediaQuality({
        outputPath: payload.outputPath,
        timeline: JSON.parse(timelineRow.payload) as NormalizedTimeline,
        expectedDurationMs: payload.expectedDurationMs,
        preset: payload.preset,
      });
      await context.throwIfCancelled();
      await context.transitionToFinalizing();
      await sql("media_qa_reports").where("id", payload.reportId).update({
        status: "succeeded",
        result: JSON.stringify(result),
        error_message: null,
        updated_at: Date.now(),
      });
      return { reportId: payload.reportId, compositionJobId: payload.compositionJobId, outputChecksum: payload.outputChecksum, ...result };
    } catch (error) {
      await sql("media_qa_reports").where("id", payload.reportId).update({
        status: "failed",
        error_message: error instanceof Error ? error.message : String(error),
        updated_at: Date.now(),
      });
      throw error;
    }
  },
};

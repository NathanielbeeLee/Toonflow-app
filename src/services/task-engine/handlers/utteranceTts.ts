import u from "@/utils";
import { db } from "@/utils/db";
import { GenerationTask, TaskExecutionError } from "@/domain/generationTask";
import { TaskHandler, TaskHandlerContext } from "@/services/task-engine/worker";
import { probeMedia } from "@/services/media/probe";
import { voiceStudioRepository } from "@/services/voice-studio/repository";

const sql = db as any;

export interface UtteranceTtsTaskPayload {
  projectId: number;
  utteranceId: string;
  model: `${string}:${string}`;
  text: string;
  voice: string;
  speechRate: number;
  pitchRate: number;
  volume: number;
  emotion?: string;
  referenceAudioPath?: string;
  savePath: string;
  cacheKey: string;
}

export const utteranceTtsTaskHandler: TaskHandler = {
  async execute(task: GenerationTask, context: TaskHandlerContext) {
    const payload = task.payload as UtteranceTtsTaskPayload;
    const utterance = await sql("utterances")
      .where({ id: payload.utteranceId, project_id: payload.projectId })
      .first();
    if (!utterance) {
      throw new TaskExecutionError("待配音台词不存在", "UTTERANCE_NOT_FOUND", false, true);
    }
    const referenceList = payload.referenceAudioPath
      ? [{ type: "audio" as const, base64: await u.oss.getImageBase64(payload.referenceAudioPath) }]
      : undefined;
    await context.throwIfCancelled();
    await context.transitionToSubmitting();
    await sql("utterances").where("id", payload.utteranceId).update({
      status: "generating",
      error_message: null,
      updated_at: Date.now(),
    });
    const audio = await u.Ai.Audio(payload.model).run({
      text: payload.text,
      voice: payload.voice,
      speechRate: payload.speechRate,
      pitchRate: payload.pitchRate,
      volume: payload.volume,
      emotion: payload.emotion,
      referenceList,
    });
    await context.transitionToFinalizing();
    try {
      await audio.save(payload.savePath);
    } catch (error) {
      throw new TaskExecutionError(u.error(error).message, "AUDIO_SAVE_FAILED", false, true);
    }
    const media = await probeMedia(payload.savePath);
    await sql("utterances").where("id", payload.utteranceId).update({
      audio_path: payload.savePath,
      cache_key: payload.cacheKey,
      duration_ms: media?.durationMs ?? utterance.duration_ms ?? null,
      status: "succeeded",
      error_message: null,
      updated_at: Date.now(),
    });
    if (utterance.script_id) {
      await voiceStudioRepository.rebuildCues({ projectId: payload.projectId, scriptId: utterance.script_id });
    }
    return {
      utteranceId: payload.utteranceId,
      audioPath: payload.savePath,
      cacheKey: payload.cacheKey,
      durationMs: media?.durationMs ?? utterance.duration_ms ?? null,
    };
  },
};

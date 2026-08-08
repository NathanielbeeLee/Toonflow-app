import { db } from "@/utils/db";
import { generationTaskRepository, stableIdempotencyKey } from "@/services/task-engine/repository";
import { UtteranceTtsTaskPayload } from "@/services/task-engine/handlers/utteranceTts";

const sql = db as any;

export async function enqueueUtteranceTts(input: { projectId: number; utteranceId: string; requestId: string }) {
  const utterance = await sql("utterances")
    .where({ id: input.utteranceId, project_id: input.projectId })
    .first();
  if (!utterance) throw new Error("台词不存在或不属于当前项目");
  if (!utterance.voice_cast_id) throw new Error("请先为这句台词分配角色音色");
  const voiceCast = await sql("voice_cast")
    .where({ id: utterance.voice_cast_id, project_id: input.projectId })
    .first();
  if (!voiceCast) throw new Error("台词绑定的角色音色不存在");
  const model = `${voiceCast.provider}:${voiceCast.model}` as `${string}:${string}`;
  const cacheKey = stableIdempotencyKey({
    text: utterance.text,
    model,
    voice: voiceCast.voice,
    speechRate: voiceCast.speech_rate,
    pitchRate: voiceCast.pitch_rate,
    volume: voiceCast.volume,
    emotion: voiceCast.emotion ?? null,
    previewAssetId: voiceCast.preview_asset_id ?? null,
  });
  if (utterance.status === "succeeded" && utterance.audio_path && utterance.cache_key === cacheKey) {
    return { task: null, payload: null, deduped: true, cached: true, audioPath: utterance.audio_path };
  }
  let referenceAudioPath: string | undefined;
  if (voiceCast.preview_asset_id) {
    const reference = await sql("o_assets")
      .leftJoin("o_image", "o_image.id", "o_assets.imageId")
      .where("o_assets.id", voiceCast.preview_asset_id)
      .select("o_image.filePath")
      .first();
    referenceAudioPath = reference?.filePath ?? undefined;
  }
  const resourceKey = `audio:utterance:${input.utteranceId}`;
  const savePath = `/${input.projectId}/audio/utterances/${input.utteranceId}-${cacheKey.slice(0, 12)}.mp3`;
  const payload: UtteranceTtsTaskPayload = {
    projectId: input.projectId,
    utteranceId: input.utteranceId,
    model,
    text: utterance.text,
    voice: voiceCast.voice,
    speechRate: voiceCast.speech_rate,
    pitchRate: voiceCast.pitch_rate,
    volume: voiceCast.volume,
    emotion: voiceCast.emotion ?? undefined,
    referenceAudioPath,
    savePath,
    cacheKey,
  };
  const [legacyTaskId] = await sql("o_tasks").insert({
    projectId: input.projectId,
    taskClass: "逐句配音",
    relatedObjects: JSON.stringify({ utteranceId: input.utteranceId }),
    model: voiceCast.model,
    describe: `持久队列：${utterance.speaker} - ${String(utterance.text).slice(0, 40)}`,
    state: "排队中",
    startTime: Date.now(),
  });
  const result = await generationTaskRepository.enqueue({
    projectId: input.projectId,
    legacyTaskId,
    lane: "audio",
    type: "tts.utterance.generate",
    resourceKey,
    payload,
    provider: voiceCast.provider,
    idempotencyKey: stableIdempotencyKey({ type: "tts.utterance.generate", cacheKey, requestId: input.requestId }),
    maxAttempts: 2,
  });
  if (result.deduped) {
    await sql("o_tasks").where("id", legacyTaskId).delete();
    const existingResult = result.task.result as { audioPath?: string } | null;
    if (result.task.status === "succeeded" && existingResult?.audioPath) {
      await sql("utterances").where("id", input.utteranceId).update({
        audio_path: existingResult.audioPath,
        cache_key: cacheKey,
        status: "succeeded",
        error_message: null,
        updated_at: Date.now(),
      });
    }
  } else {
    await sql("utterances").where("id", input.utteranceId).update({
      status: "queued",
      cache_key: cacheKey,
      error_message: null,
      updated_at: Date.now(),
    });
  }
  return { task: result.task, payload: result.task.payload as UtteranceTtsTaskPayload, deduped: result.deduped, cached: false };
}

import { v4 as uuid } from "uuid";
import { generationTaskRepository, stableIdempotencyKey } from "@/services/task-engine/repository";
import { prepareCostReservation } from "@/services/task-engine/budget";
import { WorkflowImageTaskPayload } from "@/services/task-engine/handlers/workflowImage";
import u from "@/utils";

export async function enqueueWorkflowImage(input: {
  projectId: number;
  nodeId: string;
  model: `${string}:${string}`;
  prompt: string;
  size: "1K" | "2K" | "4K";
  aspectRatio: `${number}:${number}`;
  referencePaths: string[];
  requestId: string;
}) {
  const project = await u.db("o_project").where("id", input.projectId).first();
  if (!project) throw new Error("项目不存在");
  for (const referencePath of input.referencePaths) {
    if (!(await u.oss.fileExists(referencePath))) throw new Error(`参考图片不存在: ${referencePath}`);
  }
  const costReservation = await prepareCostReservation({ projectId: input.projectId, lane: "image", model: input.model, metrics: { request: 1 } });
  const resourceKey = `image:workflow:${input.projectId}:${input.nodeId}`;
  const payload: WorkflowImageTaskPayload = {
    projectId: input.projectId,
    model: input.model,
    prompt: input.prompt,
    size: input.size,
    aspectRatio: input.aspectRatio,
    referencePaths: input.referencePaths,
    savePath: `/${input.projectId}/workFlow/${uuid()}.jpg`,
  };
  const [legacyTaskId] = await u.db("o_tasks").insert({
    projectId: input.projectId,
    taskClass: "工作流图片生成",
    relatedObjects: JSON.stringify({ nodeId: input.nodeId }),
    model: input.model.split(/:(.+)/)[1] ?? input.model,
    describe: "持久队列：工作流图片生成",
    state: "排队中",
    startTime: Date.now(),
  });
  try {
    const queued = await generationTaskRepository.enqueue({
      projectId: input.projectId,
      legacyTaskId,
      lane: "image",
      type: "workflow.image.generate",
      resourceKey,
      payload,
      provider: input.model.split(/:(.+)/)[0],
      idempotencyKey: stableIdempotencyKey({ type: "workflow.image.generate", resourceKey, requestId: input.requestId }),
      maxAttempts: 3,
      costReservation,
    });
    if (queued.deduped) await u.db("o_tasks").where("id", legacyTaskId).delete();
    return { task: queued.task, deduped: queued.deduped };
  } catch (error) {
    await u.db("o_tasks").where("id", legacyTaskId).delete();
    throw error;
  }
}

import type { GenerationTask } from "@/domain/generationTask";
import type { TaskHandler, TaskHandlerContext } from "@/services/task-engine/worker";
import { executeScriptAssetExtraction, type ScriptAssetExtractionTaskPayload } from "@/services/script-assets/extraction";

export const scriptAssetExtractionTaskHandler: TaskHandler = {
  execute(task: GenerationTask, context: TaskHandlerContext) {
    return executeScriptAssetExtraction(task.payload as ScriptAssetExtractionTaskPayload, context);
  },
};

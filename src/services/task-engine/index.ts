import { databaseReady } from "@/utils/db";
import { registerTaskHandler, generationTaskWorker } from "@/services/task-engine/worker";
import { videoGenerationTaskHandler } from "@/services/task-engine/handlers/videoGeneration";
import { assetImageTaskHandler, storyboardImageTaskHandler } from "@/services/task-engine/handlers/imageGeneration";

let initialized = false;

export async function startGenerationTaskEngine(): Promise<void> {
  await databaseReady;
  if (!initialized) {
    registerTaskHandler("video.generate", videoGenerationTaskHandler);
    registerTaskHandler("asset.image.generate", assetImageTaskHandler);
    registerTaskHandler("storyboard.image.generate", storyboardImageTaskHandler);
    initialized = true;
  }
  await generationTaskWorker.start();
}

export async function stopGenerationTaskEngine(): Promise<void> {
  await generationTaskWorker.stop();
}

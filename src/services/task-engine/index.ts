import { databaseReady } from "@/utils/db";
import { registerTaskHandler, generationTaskWorker } from "@/services/task-engine/worker";
import { videoGenerationTaskHandler } from "@/services/task-engine/handlers/videoGeneration";
import { assetImageTaskHandler, storyboardImageTaskHandler } from "@/services/task-engine/handlers/imageGeneration";
import { utteranceTtsTaskHandler } from "@/services/task-engine/handlers/utteranceTts";
import { compositionRenderTaskHandler } from "@/services/task-engine/handlers/compositionRender";
import { compositionQaTaskHandler } from "@/services/task-engine/handlers/compositionQa";

let initialized = false;

export async function startGenerationTaskEngine(): Promise<void> {
  await databaseReady;
  if (!initialized) {
    registerTaskHandler("video.generate", videoGenerationTaskHandler);
    registerTaskHandler("asset.image.generate", assetImageTaskHandler);
    registerTaskHandler("storyboard.image.generate", storyboardImageTaskHandler);
    registerTaskHandler("tts.utterance.generate", utteranceTtsTaskHandler);
    registerTaskHandler("composition.render", compositionRenderTaskHandler);
    registerTaskHandler("composition.qa", compositionQaTaskHandler);
    initialized = true;
  }
  await generationTaskWorker.start();
}

export async function stopGenerationTaskEngine(): Promise<void> {
  await generationTaskWorker.stop();
}

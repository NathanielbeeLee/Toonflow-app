import u from "@/utils";
import { GenerationTask } from "@/domain/generationTask";
import { generationTaskRepository } from "@/services/task-engine/repository";

export interface VideoReferenceInput {
  id: number;
  sources: string;
}

export interface VideoReadinessInput {
  projectId: number;
  scriptId: number;
  trackId: number;
  uploadData: VideoReferenceInput[];
  prompt: string;
  duration: number;
  model: `${string}:${string}`;
  mode: string | string[];
  resolution: string;
}

export interface VideoReadinessCheck {
  key: string;
  ok: boolean;
  message: string;
}

export interface VideoReadinessResult {
  trackId: number;
  ready: boolean;
  checks: VideoReadinessCheck[];
}

interface VideoModelContext {
  vendorConfig: any;
  selectedModel: any;
  vendor: any;
  modelError: string;
}

interface InspectionContext {
  activeTasksByProject: Map<number, Promise<GenerationTask[]>>;
  videoModels: Map<string, Promise<VideoModelContext>>;
}

function createInspectionContext(): InspectionContext {
  return { activeTasksByProject: new Map(), videoModels: new Map() };
}

function check(key: string, ok: boolean, message: string): VideoReadinessCheck {
  return { key, ok, message };
}

function parseMode(mode: string | string[]): string | string[] {
  if (Array.isArray(mode)) return mode;
  try {
    const parsed = JSON.parse(mode);
    return Array.isArray(parsed) ? parsed.map(String) : mode;
  } catch {
    return mode;
  }
}

function modeMatches(left: unknown, right: string | string[]): boolean {
  if (Array.isArray(left) && Array.isArray(right)) return JSON.stringify(left) === JSON.stringify(right);
  return left === right;
}

function requiredReferenceCount(mode: string | string[]): number {
  if (Array.isArray(mode)) return mode.length > 0 ? 1 : 0;
  if (mode === "text") return 0;
  if (mode === "startEndRequired") return 2;
  if (["singleImage", "endFrameOptional", "startFrameOptional"].includes(mode)) return 1;
  return 0;
}

async function inspectScope(input: VideoReadinessInput): Promise<VideoReadinessCheck[]> {
  const [project, script, track] = await Promise.all([
    u.db("o_project").where("id", input.projectId).select("id").first(),
    u.db("o_script").where({ id: input.scriptId, projectId: input.projectId }).select("id").first(),
    u.db("o_videoTrack").where({ id: input.trackId, projectId: input.projectId, scriptId: input.scriptId }).select("id").first(),
  ]);
  return [
    check("project_ready", Boolean(project), project ? "项目存在" : "项目不存在"),
    check("script_ready", Boolean(script), script ? "剧本属于当前项目" : "剧本不存在或不属于当前项目"),
    check("track_ready", Boolean(track), track ? "镜头轨道属于当前剧本" : "镜头轨道不存在或不属于当前剧本"),
  ];
}

async function loadVideoModel(model: string, context: InspectionContext): Promise<VideoModelContext> {
  const cached = context.videoModels.get(model);
  if (cached) return cached;
  const loading = (async () => {
    const [vendorId, modelName] = model.split(/:(.+)/);
    const vendorConfig = vendorId ? await u.db("o_vendorConfig").where("id", vendorId).first() : null;
    let selectedModel: any = null;
    let vendor: any = null;
    let modelError = "";
    if (vendorId && modelName) {
      try {
        const models = await u.vendor.getModelList(vendorId);
        selectedModel = models.find((item: any) => item.modelName === modelName && item.type === "video") ?? null;
        vendor = u.vendor.getVendor(vendorId);
      } catch (error) {
        modelError = u.error(error).message;
      }
    }
    return { vendorConfig, selectedModel, vendor, modelError };
  })();
  context.videoModels.set(model, loading);
  return loading;
}

async function inspectModel(input: VideoReadinessInput, mode: string | string[], context: InspectionContext): Promise<VideoReadinessCheck[]> {
  const [vendorId, modelName] = input.model.split(/:(.+)/);
  if (!vendorId || !modelName) {
    return [
      check("video_model_ready", false, "未选择有效的视频模型"),
      check("provider_ready", false, "无法确定视频模型供应商"),
      check("mode_ready", false, "无法检查视频生成模式"),
      check("duration_resolution_ready", false, "无法检查时长和分辨率"),
    ];
  }

  const { vendorConfig, selectedModel, vendor, modelError } = await loadVideoModel(input.model, context);

  const modelReady = Boolean(vendorConfig && selectedModel);
  const modelMessage = !vendorConfig
    ? "视频模型供应商配置不存在"
    : !selectedModel
      ? modelError || `供应商中不存在视频模型 ${modelName}`
      : "视频模型可用";

  let missingInputs: string[] = [];
  if (vendorConfig && vendor) {
    let storedValues: Record<string, unknown> = {};
    try {
      storedValues = JSON.parse(vendorConfig.inputValues || "{}");
    } catch {
      storedValues = {};
    }
    const values = { ...(vendor.inputValues ?? {}), ...storedValues };
    missingInputs = (vendor.inputs ?? [])
      .filter((item: any) => item.required && !String(values[item.key] ?? "").trim())
      .map((item: any) => item.label || item.key);
  }
  const providerReady = Boolean(vendorConfig?.enable) && missingInputs.length === 0 && !modelError;
  const providerMessage = !vendorConfig
    ? "供应商配置不存在"
    : !vendorConfig.enable
      ? "供应商尚未启用"
      : missingInputs.length
        ? `供应商缺少必填配置：${missingInputs.join("、")}`
        : modelError || "供应商配置可用";

  const modeReady = Boolean(selectedModel?.mode?.some((item: unknown) => modeMatches(item, mode)));
  const modeMessage = modeReady ? "当前生成模式受模型支持" : "当前生成模式不在模型支持范围内";

  const durationResolutionReady = Boolean(
    selectedModel?.durationResolutionMap?.some(
      (item: any) => item.duration?.includes(input.duration) && item.resolution?.includes(input.resolution),
    ),
  );
  const durationResolutionMessage = durationResolutionReady
    ? "时长和分辨率组合受模型支持"
    : `模型不支持 ${input.duration} 秒 / ${input.resolution} 组合`;

  return [
    check("video_model_ready", modelReady, modelMessage),
    check("provider_ready", providerReady, providerMessage),
    check("mode_ready", modeReady, modeMessage),
    check("duration_resolution_ready", durationResolutionReady, durationResolutionMessage),
  ];
}

async function inspectReferences(input: VideoReadinessInput, mode: string | string[]): Promise<VideoReadinessCheck> {
  const requiredCount = requiredReferenceCount(mode);
  if (requiredCount === 0 && input.uploadData.length === 0) {
    return check("references_ready", true, "当前模式不需要参考素材");
  }

  const storyboardIds = input.uploadData.filter((item) => item.sources === "storyboard").map((item) => item.id);
  const assetIds = input.uploadData.filter((item) => item.sources === "assets").map((item) => item.id);
  const unsupported = input.uploadData.filter((item) => !["storyboard", "assets"].includes(item.sources));
  const [storyboards, assets] = await Promise.all([
    storyboardIds.length
      ? u.db("o_storyboard").whereIn("id", storyboardIds).select("id", "filePath", "projectId", "scriptId")
      : Promise.resolve([]),
    assetIds.length
      ? u
          .db("o_assets")
          .leftJoin("o_image", "o_assets.imageId", "o_image.id")
          .whereIn("o_assets.id", assetIds)
          .select("o_assets.id", "o_assets.projectId", "o_image.filePath")
      : Promise.resolve([]),
  ]);

  const validStoryboardIds = new Set(
    storyboards
      .filter((item: any) => item.filePath && item.projectId === input.projectId && item.scriptId === input.scriptId)
      .map((item: any) => item.id),
  );
  const validAssetIds = new Set(
    assets.filter((item: any) => item.filePath && item.projectId === input.projectId).map((item: any) => item.id),
  );
  const missing = input.uploadData.filter(
    (item) =>
      (item.sources === "storyboard" && !validStoryboardIds.has(item.id)) ||
      (item.sources === "assets" && !validAssetIds.has(item.id)),
  );
  const validKeys = new Set(
    input.uploadData
      .filter(
        (item) =>
          (item.sources === "storyboard" && validStoryboardIds.has(item.id)) ||
          (item.sources === "assets" && validAssetIds.has(item.id)),
      )
      .map((item) => `${item.sources}:${item.id}`),
  );
  const validCount = validKeys.size;
  const enough = validCount >= requiredCount;
  const ok = unsupported.length === 0 && missing.length === 0 && enough;
  if (unsupported.length) return check("references_ready", false, "存在不支持的参考素材来源");
  if (missing.length) return check("references_ready", false, `有 ${missing.length} 个参考素材不存在、未生成或不属于当前项目`);
  if (!enough) return check("references_ready", false, `当前模式至少需要 ${requiredCount} 个有效参考素材，现有 ${validCount} 个`);
  return check("references_ready", true, `已找到 ${validCount} 个有效参考素材`);
}

async function getActiveTasks(input: VideoReadinessInput, context: InspectionContext): Promise<GenerationTask[]> {
  let pending = context.activeTasksByProject.get(input.projectId);
  if (!pending) {
    pending = generationTaskRepository
      .list({ projectId: input.projectId, type: "video.generate", limit: 100 })
      .then((result) => result.data);
    context.activeTasksByProject.set(input.projectId, pending);
  }
  return pending;
}

export async function inspectVideoGenerationReadiness(
  input: VideoReadinessInput,
  context: InspectionContext = createInspectionContext(),
): Promise<VideoReadinessResult> {
  const mode = parseMode(input.mode);
  const resourceKey = `video:${input.projectId}:${input.scriptId}:${input.trackId}`;
  const activeTask = (await getActiveTasks(input, context)).find(
    (task) => task.resourceKey === resourceKey && !["cancelled", "succeeded", "failed"].includes(task.status),
  );
  const checks = [
    ...(await inspectScope(input)),
    check("prompt_ready", Boolean(input.prompt.trim()), input.prompt.trim() ? "视频提示词可用" : "视频提示词为空"),
    check("duration_ready", input.duration > 0, input.duration > 0 ? "镜头时长已配置" : "镜头时长必须大于 0"),
    await inspectReferences(input, mode),
    ...(await inspectModel(input, mode, context)),
    check(
      "no_active_video_task",
      !activeTask,
      activeTask ? `当前镜头已有进行中的视频任务（${activeTask.status}）` : "当前镜头没有进行中的视频任务",
    ),
  ];
  return { trackId: input.trackId, ready: checks.every((item) => item.ok), checks };
}

export async function inspectVideoGenerationBatchReadiness(inputs: VideoReadinessInput[]): Promise<VideoReadinessResult[]> {
  const context = createInspectionContext();
  return Promise.all(inputs.map((input) => inspectVideoGenerationReadiness(input, context)));
}

export function readinessFailureMessage(result: VideoReadinessResult): string {
  return result.checks
    .filter((item) => !item.ok && item.key !== "no_active_video_task")
    .map((item) => item.message)
    .join("；");
}

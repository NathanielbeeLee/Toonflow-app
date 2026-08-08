/**
 * Toonflow AI供应商模板
 * @version 2.0
 */
// ============================================================
// 类型定义
// ============================================================
type VideoMode =
  | "singleImage"
  | "startEndRequired"
  | "endFrameOptional"
  | "startFrameOptional"
  | "text"
  | (`videoReference:${number}` | `imageReference:${number}` | `audioReference:${number}`)[];
interface TextModel {
  name: string;
  modelName: string;
  type: "text";
  think: boolean;
}
interface ImageModel {
  name: string;
  modelName: string;
  type: "image";
  mode: ("text" | "singleImage" | "multiReference")[];
  associationSkills?: string;
}
interface VideoModel {
  name: string;
  modelName: string;
  type: "video";
  mode: VideoMode[];
  associationSkills?: string;
  audio: "optional" | false | true;
  durationResolutionMap: { duration: number[]; resolution: string[] }[];
}
interface TTSModel {
  name: string;
  modelName: string;
  type: "tts";
  voices: { title: string; voice: string }[];
}
interface VendorConfig {
  id: string;
  version: string;
  name: string;
  author: string;
  description?: string;
  icon?: string;
  inputs: { key: string; label: string; type: "text" | "password" | "url"; required: boolean; placeholder?: string }[];
  inputValues: Record<string, string>;
  models: (TextModel | ImageModel | VideoModel | TTSModel)[];
}
type ReferenceList =
  | { type: "image"; sourceType?: "base64"; base64: string }
  | { type: "audio"; sourceType?: "base64"; base64: string }
  | { type: "video"; sourceType?: "base64"; base64: string };
interface ImageConfig {
  prompt: string;
  referenceList?: Extract<ReferenceList, { type: "image" }>[];
  size: "1K" | "2K" | "4K";
  aspectRatio: `${number}:${number}`;
}
interface VideoConfig {
  duration: number;
  resolution: string;
  aspectRatio: "16:9" | "9:16";
  prompt: string;
  referenceList?: ReferenceList[];
  audio?: boolean;
  mode: VideoMode[];
}
interface TTSConfig {
  text: string;
  voice: string;
  speechRate: number;
  pitchRate: number;
  volume: number;
}
interface PollResult {
  completed: boolean;
  data?: string;
  error?: string;
}
interface VideoProviderPollResult {
  status: "pending" | "succeeded" | "failed" | "cancelled";
  data?: string;
  error?: string;
}
// ============================================================
// 全局声明
// ============================================================
declare const axios: any;
declare const logger: (msg: string) => void;
declare const jsonwebtoken: any;
declare const zipImage: (base64: string, size: number) => Promise<string>;
declare const zipImageResolution: (base64: string, w: number, h: number) => Promise<string>;
declare const mergeImages: (base64Arr: string[], maxSize?: string) => Promise<string>;
declare const urlToBase64: (url: string) => Promise<string>;
declare const pollTask: (fn: () => Promise<PollResult>, interval?: number, timeout?: number) => Promise<PollResult>;
declare const createOpenAI: any;
declare const createDeepSeek: any;
declare const createZhipu: any;
declare const createQwen: any;
declare const createAnthropic: any;
declare const createOpenAICompatible: any;
declare const createXai: any;
declare const createMinimax: any;
declare const createGoogleGenerativeAI: any;
declare const exports: {
  vendor: VendorConfig;
  textRequest: (m: TextModel, t: boolean, tl: 0 | 1 | 2 | 3) => any;
  imageRequest: (c: ImageConfig, m: ImageModel) => Promise<string>;
  videoRequest: (c: VideoConfig, m: VideoModel) => Promise<string>;
  videoSubmit: (c: VideoConfig, m: VideoModel) => Promise<{ jobId: string }>;
  videoPoll: (c: { jobId: string }, m: VideoModel) => Promise<VideoProviderPollResult>;
  ttsRequest: (c: TTSConfig, m: TTSModel) => Promise<string>;
  checkForUpdates?: () => Promise<{ hasUpdate: boolean; latestVersion: string; notice: string }>;
  updateVendor?: () => Promise<string>;
};
// ============================================================
// 供应商配置
// ============================================================
const vendor: VendorConfig = {
  id: "openai",
  version: "2.2",
  author: "Toonflow",
  name: "OpenAI标准接口",
  description:
    "OpenAI标准格式接口，支持文本、GPT Image 与异步视频任务。CLIProxyAPI 用户可将请求地址设为 http://localhost:8317/v1；视频地址留空时会自动使用 /openai/v1。视频模型是否可用取决于代理侧已登录的 xAI/OpenAI 凭据。",
  icon: "",
  inputs: [
    { key: "apiKey", label: "API密钥", type: "password", required: true },
    { key: "baseUrl", label: "请求地址", type: "url", required: true, placeholder: "以v1结束，示例：https://api.openai.com/v1" },
    {
      key: "videoBaseUrl",
      label: "视频请求地址",
      type: "url",
      required: false,
      placeholder: "可选；CLIProxyAPI 示例：http://localhost:8317/openai/v1",
    },
  ],
  inputValues: {
    apiKey: "",
    baseUrl: "https://api.openai.com/v1",
    videoBaseUrl: "",
  },
  models: [
    { name: "GPT-4o", modelName: "gpt-4o", type: "text", think: false },
    { name: "GPT-4.1", modelName: "gpt-4.1", type: "text", think: false },
    { name: "GPT-5.1", modelName: "gpt-5.1", type: "text", think: false },
    { name: "GPT-5.2", modelName: "gpt-5.2", type: "text", think: false },
    { name: "GPT-5.4", modelName: "gpt-5.4", type: "text", think: false },
    { name: "GPT Image 1.5", modelName: "gpt-image-1.5", type: "image", mode: ["text"] },
    { name: "GPT Image 2", modelName: "gpt-image-2", type: "image", mode: ["text"] },
    {
      name: "Sora 2 / CLIProxyAPI Video",
      modelName: "sora-2",
      type: "video",
      mode: ["text", "startFrameOptional"],
      audio: true,
      durationResolutionMap: [{ duration: [4, 8, 12], resolution: ["720p"] }],
    },
    {
      name: "Sora 2 Pro",
      modelName: "sora-2-pro",
      type: "video",
      mode: ["text", "startFrameOptional"],
      audio: true,
      durationResolutionMap: [{ duration: [4, 8, 12], resolution: ["720p", "1080p"] }],
    },
    {
      name: "Grok Imagine Video",
      modelName: "grok-imagine-video",
      type: "video",
      mode: ["text", "startFrameOptional", ["imageReference:7"]],
      audio: true,
      durationResolutionMap: [{ duration: [4, 8, 10, 12, 15], resolution: ["480p", "720p"] }],
    },
  ],
};
// ============================================================
// 适配器函数
// ============================================================
const getBaseUrl = () => vendor.inputValues.baseUrl.replace(/\/+$/, "");
const getVideoBaseUrl = () => {
  const configured = (vendor.inputValues.videoBaseUrl || "").replace(/\/+$/, "");
  if (configured) return configured;
  const baseUrl = getBaseUrl();
  if (/^https?:\/\/(localhost|127\.0\.0\.1):8317\/v1$/i.test(baseUrl)) return baseUrl.replace(/\/v1$/i, "/openai/v1");
  return baseUrl;
};
const getHeaders = () => {
  if (!vendor.inputValues.apiKey) throw new Error("缺少API Key");
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${vendor.inputValues.apiKey.replace(/^Bearer\s+/i, "")}`,
  };
};
const responseError = (data: any, fallback: string) => data?.error?.message || data?.error || data?.message || fallback;
const imageSize = (aspectRatio: string) => {
  const [width, height] = aspectRatio.split(":").map(Number);
  if (width / height > 1.15) return "1536x1024";
  if (width / height < 0.87) return "1024x1536";
  return "1024x1024";
};
const videoSize = (config: VideoConfig) => {
  const height = config.resolution === "1080p" ? 1080 : 720;
  return config.aspectRatio === "9:16" ? `${height}x${Math.round((height * 16) / 9)}` : `${Math.round((height * 16) / 9)}x${height}`;
};
const textRequest = (model: TextModel, think: boolean, thinkLevel: 0 | 1 | 2 | 3) => {
  if (!vendor.inputValues.apiKey) throw new Error("缺少API Key");
  const apiKey = vendor.inputValues.apiKey.replace(/^Bearer\s+/i, "");
  return createOpenAI({ baseURL: vendor.inputValues.baseUrl, apiKey }).chat(model.modelName);
};
const imageRequest = async (config: ImageConfig, model: ImageModel): Promise<string> => {
  if (config.referenceList?.length) throw new Error("OpenAI 标准图片适配器当前只支持文生图，参考图请使用支持图片编辑的供应商");
  const response = await axios.post(
    `${getBaseUrl()}/images/generations`,
    {
      model: model.modelName,
      prompt: config.prompt,
      size: imageSize(config.aspectRatio),
      response_format: "b64_json",
    },
    { headers: getHeaders() },
  );
  const result = response.data?.data?.[0];
  if (result?.b64_json) return `data:image/png;base64,${result.b64_json}`;
  if (result?.url) return result.url;
  throw new Error(responseError(response.data, "图片生成成功但没有返回图片数据"));
};
const videoSubmit = async (config: VideoConfig, model: VideoModel): Promise<{ jobId: string }> => {
  const images = (config.referenceList || []).filter((item) => item.type === "image");
  const unsupported = (config.referenceList || []).filter((item) => item.type !== "image");
  if (unsupported.length) throw new Error("OpenAI 标准视频接口当前只接受图片参考");
  const body: any = {
    model: model.modelName,
    prompt: config.prompt,
    seconds: String(config.duration),
    size: videoSize(config),
  };
  if (images.length === 1) body.input_reference = { image_url: images[0].base64 };
  if (images.length > 1) body.reference_images = images.slice(0, 7).map((item) => ({ image_url: { url: item.base64 } }));
  const response = await axios.post(`${getVideoBaseUrl()}/videos`, body, { headers: getHeaders() });
  const jobId = response.data?.id || response.data?.request_id;
  if (!jobId) throw new Error(responseError(response.data, "视频任务提交成功但没有返回任务 ID"));
  return { jobId: String(jobId) };
};
const videoPoll = async ({ jobId }: { jobId: string }, _model: VideoModel): Promise<VideoProviderPollResult> => {
  const response = await axios.get(`${getVideoBaseUrl()}/videos/${encodeURIComponent(jobId)}`, { headers: getHeaders() });
  const status = String(response.data?.status || "").toLowerCase();
  if (["queued", "pending", "in_progress", "processing", "running"].includes(status)) return { status: "pending" };
  if (["failed", "error", "expired"].includes(status)) {
    return { status: "failed", error: responseError(response.data, "供应商视频任务失败") };
  }
  if (["cancelled", "canceled"].includes(status)) return { status: "cancelled" };
  if (["completed", "done", "succeeded", "success"].includes(status)) {
    const content = await axios.get(`${getVideoBaseUrl()}/videos/${encodeURIComponent(jobId)}/content`, {
      headers: getHeaders(),
      responseType: "arraybuffer",
    });
    const mime = content.headers?.["content-type"] || "video/mp4";
    return { status: "succeeded", data: `data:${mime};base64,${content.data.toString("base64")}` };
  }
  return { status: "failed", error: `无法识别的供应商任务状态: ${status || "empty"}` };
};
const videoRequest = async (config: VideoConfig, model: VideoModel): Promise<string> => {
  const { jobId } = await videoSubmit(config, model);
  const result = await pollTask(async () => {
    const task = await videoPoll({ jobId }, model);
    if (task.status === "succeeded") return { completed: true, data: task.data };
    if (task.status === "failed" || task.status === "cancelled") return { completed: false, error: task.error || "视频任务失败" };
    return { completed: false };
  }, 10_000, 30 * 60 * 1000);
  if (result.error) throw new Error(result.error);
  if (!result.data) throw new Error("视频任务完成但没有返回视频数据");
  return result.data;
};
const ttsRequest = async (config: TTSConfig, model: TTSModel): Promise<string> => {
  return "";
};
const checkForUpdates = async (): Promise<{ hasUpdate: boolean; latestVersion: string; notice: string }> => {
  return { hasUpdate: false, latestVersion: "2.0", notice: "" };
};
const updateVendor = async (): Promise<string> => {
  return "";
};
// ============================================================
// 导出
// ============================================================
exports.vendor = vendor;
exports.textRequest = textRequest;
exports.imageRequest = imageRequest;
exports.videoRequest = videoRequest;
exports.videoSubmit = videoSubmit;
exports.videoPoll = videoPoll;
exports.ttsRequest = ttsRequest;
exports.checkForUpdates = checkForUpdates;
exports.updateVendor = updateVendor;
export {};

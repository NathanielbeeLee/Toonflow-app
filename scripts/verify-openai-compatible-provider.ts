import assert from "node:assert/strict";
import fs from "node:fs";
import { transform } from "sucrase";
import { VM } from "vm2";

const source = fs.readFileSync("data/vendor/openai.ts", "utf8");
const code = transform(source, { transforms: ["typescript"] }).code.replace(/export\s*\{\s*\};?/g, "");
const exportsObject: Record<string, any> = {};
const calls: Array<{ method: string; url: string; body?: any }> = [];
let pollCount = 0;

const axios = {
  async post(url: string, body: any) {
    calls.push({ method: "POST", url, body });
    if (url.endsWith("/images/generations")) return { data: { data: [{ b64_json: "bW9jay1pbWFnZQ==" }] } };
    if (url.endsWith("/videos")) return { data: { id: "video_mock_001", status: "queued" } };
    if (url.endsWith("/audio/speech")) return { data: Buffer.from("mock-audio"), headers: { "content-type": "audio/mpeg" } };
    throw new Error(`unexpected POST ${url}`);
  },
  async get(url: string) {
    calls.push({ method: "GET", url });
    if (url.endsWith("/content")) {
      return { data: Buffer.from("mock-video"), headers: { "content-type": "video/mp4" } };
    }
    if (url.includes("/videos/")) {
      pollCount++;
      return { data: { id: "video_mock_001", status: pollCount === 1 ? "in_progress" : "completed" } };
    }
    throw new Error(`unexpected GET ${url}`);
  },
};

const sandbox = {
  exports: exportsObject,
  axios,
  logger: () => undefined,
  pollTask: async () => ({ completed: true }),
  urlToBase64: async (value: string) => value,
  jsonwebtoken: {},
  zipImage: async (value: string) => value,
  zipImageResolution: async (value: string) => value,
  mergeImages: async () => "",
  createOpenAI: () => ({ chat: () => ({}) }),
  createDeepSeek: () => ({}),
  createZhipu: () => ({}),
  createQwen: () => ({}),
  createAnthropic: () => ({}),
  createOpenAICompatible: () => ({}),
  createXai: () => ({}),
  createMinimax: () => ({}),
  createGoogleGenerativeAI: () => ({}),
};

async function main() {
  new VM({ timeout: 5_000, sandbox }).run(code);
  exportsObject.vendor.inputValues.apiKey = "mock-key";
  exportsObject.vendor.inputValues.baseUrl = "http://127.0.0.1:8317/v1";
  exportsObject.vendor.inputValues.videoBaseUrl = "";

  const imageModel = exportsObject.vendor.models.find((item: any) => item.modelName === "gpt-image-2");
  const image = await exportsObject.imageRequest({ prompt: "mock image", aspectRatio: "16:9", size: "1K" }, imageModel);
  assert.equal(image, "data:image/png;base64,bW9jay1pbWFnZQ==");
  assert.equal(calls[0].url, "http://127.0.0.1:8317/v1/images/generations");
  assert.equal(calls[0].body.size, "1536x1024");

  const videoModel = exportsObject.vendor.models.find((item: any) => item.modelName === "sora-2");
  const submitted = await exportsObject.videoSubmit(
    {
      duration: 8,
      resolution: "720p",
      aspectRatio: "16:9",
      prompt: "mock video",
      referenceList: [{ type: "image", base64: "data:image/png;base64,bW9jaw==" }],
      audio: true,
      mode: "startFrameOptional",
    },
    videoModel,
  );
  assert.equal(submitted.jobId, "video_mock_001");
  assert.equal(calls[1].url, "http://127.0.0.1:8317/openai/v1/videos");
  assert.equal(calls[1].body.input_reference.image_url, "data:image/png;base64,bW9jaw==");

  assert.deepEqual(await exportsObject.videoPoll({ jobId: submitted.jobId }, videoModel), { status: "pending" });
  const completed = await exportsObject.videoPoll({ jobId: submitted.jobId }, videoModel);
  assert.equal(completed.status, "succeeded");
  assert.equal(completed.data, `data:video/mp4;base64,${Buffer.from("mock-video").toString("base64")}`);

  const ttsModel = exportsObject.vendor.models.find((item: any) => item.modelName === "gpt-4o-mini-tts");
  const audio = await exportsObject.ttsRequest(
    { text: "你好，世界", voice: "coral", speechRate: 1.2, pitchRate: 1, volume: 1, emotion: "温暖" },
    ttsModel,
  );
  assert.equal(audio, `data:audio/mpeg;base64,${Buffer.from("mock-audio").toString("base64")}`);
  const ttsCall = calls.find((call) => call.url.endsWith("/audio/speech"));
  assert.equal(ttsCall?.body.model, "gpt-4o-mini-tts");
  assert.equal(ttsCall?.body.voice, "coral");
  assert.equal(ttsCall?.body.speed, 1.2);
  assert.match(ttsCall?.body.instructions, /温暖/);
  console.log("OpenAI/CLIProxyAPI 图片、可恢复视频与 TTS 适配器 Mock 验证通过");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

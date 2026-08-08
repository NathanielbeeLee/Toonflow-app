import assert from "node:assert/strict";
import fs from "node:fs";
import { transform } from "sucrase";
import { VM } from "vm2";

const source = fs.readFileSync("data/vendor/minimax.ts", "utf8");
const code = transform(source, { transforms: ["typescript"] }).code.replace(/export\s*\{\s*\};?/g, "");
const exportsObject: Record<string, any> = {};
const calls: Array<{ method: string; url: string; body?: any; params?: any }> = [];
let pollCount = 0;

const axios = {
  async post(url: string, body: any) {
    calls.push({ method: "POST", url, body });
    if (url.endsWith("/v1/video_generation")) {
      return { data: { base_resp: { status_code: 0 }, task_id: "minimax-task-001" } };
    }
    throw new Error(`unexpected POST ${url}`);
  },
  async get(url: string, options: { params?: any } = {}) {
    calls.push({ method: "GET", url, params: options.params });
    if (url.endsWith("/v1/query/video_generation")) {
      pollCount++;
      return {
        data: {
          base_resp: { status_code: 0 },
          status: pollCount === 1 ? "Processing" : "Success",
          ...(pollCount > 1 ? { file_id: "file-001" } : {}),
        },
      };
    }
    if (url.endsWith("/v1/files/retrieve")) {
      return { data: { base_resp: { status_code: 0 }, file: { download_url: "https://example.invalid/minimax.mp4" } } };
    }
    throw new Error(`unexpected GET ${url}`);
  },
};

const sandbox = {
  exports: exportsObject,
  axios,
  logger: () => undefined,
  jsonwebtoken: {},
  zipImage: async (value: string) => value,
  zipImageResolution: async (value: string) => value,
  mergeImages: async () => "",
  urlToBase64: async (value: string) => `base64:${value}`,
  pollTask: async () => ({ completed: true }),
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
  const model = exportsObject.vendor.models.find((item: any) => item.modelName === "MiniMax-Hailuo-02");
  assert.ok(model, "MiniMax模板必须包含海螺02视频模型");

  const submitted = await exportsObject.videoSubmit(
    {
      duration: 6,
      resolution: "768P",
      aspectRatio: "16:9",
      prompt: "local mock only",
      referenceList: [
        { type: "image", base64: "data:image/png;base64,Zmlyc3Q=" },
        { type: "image", base64: "data:image/png;base64,bGFzdA==" },
      ],
      audio: false,
      mode: "startEndRequired",
    },
    model,
  );
  assert.equal(submitted.jobId, "minimax-task-001");
  assert.equal(calls[0].body.first_frame_image, "data:image/png;base64,Zmlyc3Q=");
  assert.equal(calls[0].body.last_frame_image, "data:image/png;base64,bGFzdA==");

  assert.deepEqual(await exportsObject.videoPoll({ jobId: submitted.jobId }, model), { status: "pending" });
  assert.deepEqual(await exportsObject.videoPoll({ jobId: submitted.jobId }, model), {
    status: "succeeded",
    data: "https://example.invalid/minimax.mp4",
  });
  assert.equal(calls.at(-1)?.params.file_id, "file-001");
  console.log("MiniMax可恢复视频适配器 Mock 验证通过");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

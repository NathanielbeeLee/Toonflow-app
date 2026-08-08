import assert from "node:assert/strict";
import fs from "node:fs";
import { transform } from "sucrase";
import { VM } from "vm2";

const source = fs.readFileSync("data/vendor/klingai.ts", "utf8");
const code = transform(source, { transforms: ["typescript"] }).code.replace(/export\s*\{\s*\};?/g, "");
const exportsObject: Record<string, any> = {};
const calls: Array<{ method: string; url: string; body?: any }> = [];
let pollCount = 0;

const axios = {
  async post(url: string, body: any) {
    calls.push({ method: "POST", url, body });
    return { data: { code: 0, data: { task_id: "kling-task-001" } } };
  },
  async get(url: string) {
    calls.push({ method: "GET", url });
    pollCount++;
    return {
      data: {
        code: 0,
        data: {
          task_status: pollCount === 1 ? "processing" : "succeed",
          ...(pollCount > 1 ? { task_result: { videos: [{ url: "https://example.invalid/kling.mp4" }] } } : {}),
        },
      },
    };
  },
};

const sandbox = {
  exports: exportsObject,
  axios,
  logger: () => undefined,
  jsonwebtoken: { sign: () => "mock-jwt" },
  zipImage: async (value: string) => value,
  zipImageResolution: async (value: string) => value,
  mergeImages: async () => "",
  urlToBase64: async (value: string) => `base64:${value}`,
  pollTask: async () => ({ completed: true }),
  createOpenAI: () => ({}),
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
  exportsObject.vendor.inputValues.accessKey = "mock-access";
  exportsObject.vendor.inputValues.secretKey = "mock-secret";
  exportsObject.vendor.inputValues.baseUrl = "https://example.invalid";
  const model = exportsObject.vendor.models.find((item: any) => item.modelName === "kling-v3:std");
  assert.ok(model, "可灵模板必须包含kling-v3标准视频模型");

  const submitted = await exportsObject.videoSubmit(
    {
      duration: 5,
      resolution: "720p",
      aspectRatio: "16:9",
      prompt: "local mock only",
      referenceList: [],
      audio: false,
      mode: "text",
    },
    model,
  );
  assert.equal(submitted.jobId, "/v1/videos/text2video|kling-task-001");
  assert.equal(calls[0].url, "https://example.invalid/v1/videos/text2video");
  assert.equal(calls[0].body.model_name, "kling-v3");

  assert.deepEqual(await exportsObject.videoPoll({ jobId: submitted.jobId }, model), { status: "pending" });
  assert.deepEqual(await exportsObject.videoPoll({ jobId: submitted.jobId }, model), {
    status: "succeeded",
    data: "https://example.invalid/kling.mp4",
  });
  assert.equal(calls[1].url, "https://example.invalid/v1/videos/text2video/kling-task-001");
  await assert.rejects(() => exportsObject.videoPoll({ jobId: "/v1/unsafe|task" }, model), /远端任务身份无效/);
  console.log("可灵AI可恢复视频适配器 Mock 验证通过");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

import assert from "node:assert/strict";
import fs from "node:fs";
import { transform } from "sucrase";
import { VM } from "vm2";

const source = fs.readFileSync("data/vendor/volcengine.ts", "utf8");
const code = transform(source, { transforms: ["typescript"] }).code.replace(/export\s*\{\s*\};?/g, "");
const exportsObject: Record<string, any> = {};
let submittedBody: any = null;
let getCount = 0;

const sandbox = {
  exports: exportsObject,
  logger: () => undefined,
  fetch: async (url: string, options: { method?: string; body?: string } = {}) => {
    if (options.method === "POST") {
      submittedBody = JSON.parse(options.body ?? "{}");
      return { ok: true, json: async () => ({ id: "mock-job-001" }), text: async () => "" };
    }
    getCount++;
    return {
      ok: true,
      json: async () => ({ status: "succeeded", content: { video_url: "https://example.invalid/mock.mp4" } }),
      text: async () => "",
    };
  },
  pollTask: async () => ({ completed: true }),
  urlToBase64: async (value: string) => value,
  axios: {},
  jsonwebtoken: {},
  zipImage: async (value: string) => value,
  zipImageResolution: async (value: string) => value,
  mergeImages: async () => "",
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
  exportsObject.vendor.inputValues.apiKey = "mock-key";
  const model = exportsObject.vendor.models.find((item: any) => item.type === "video");
  assert.ok(model, "火山引擎模板必须包含视频模型");

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
  assert.equal(submitted.jobId, "mock-job-001");
  assert.equal(submittedBody.model, model.modelName);
  assert.equal(submittedBody.duration, 5);

  const polled = await exportsObject.videoPoll({ jobId: submitted.jobId }, model);
  assert.deepEqual(polled, { status: "succeeded", data: "https://example.invalid/mock.mp4" });
  assert.equal(getCount, 1);
  console.log("火山引擎可恢复视频适配器 Mock 验证通过");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

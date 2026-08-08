import { GenerationTask } from "@/domain/generationTask";
import { db } from "@/utils/db";

interface RuntimeLimit {
  maxConcurrency: number;
  rpm: number;
  cooldownMs: number;
}

interface LimitState {
  active: number;
  waiters: Array<() => void>;
  starts: number[];
}

const states = new Map<string, LimitState>();

function positiveInt(value: unknown, fallback: unknown, max: number) {
  const parsed = Number(value);
  const parsedFallback = Number(fallback);
  if (!Number.isFinite(parsed) || parsed <= 0) return Number.isFinite(parsedFallback) && parsedFallback > 0 ? Math.min(max, Math.floor(parsedFallback)) : 1;
  return Math.min(max, Math.floor(parsed));
}

function taskIdentity(task: GenerationTask) {
  const payload = task.payload as { model?: string } | null;
  const rawModel = payload?.model || "unknown:*";
  const [modelProvider, model] = rawModel.split(/:(.+)/);
  return {
    provider: task.provider || modelProvider || "unknown",
    model: model || rawModel,
  };
}

async function resolveLimit(task: GenerationTask): Promise<RuntimeLimit> {
  const { provider, model } = taskIdentity(task);
  const exact = await db("provider_limits").where({ provider, model, lane: task.lane }).first();
  const wildcard = exact || (await db("provider_limits").where({ provider, model: "*", lane: task.lane }).first());
  return {
    maxConcurrency: positiveInt(wildcard?.max_concurrency, process.env.TOONFLOW_PROVIDER_CONCURRENCY ?? 2, 32),
    rpm: positiveInt(wildcard?.rpm, process.env.TOONFLOW_PROVIDER_RPM ?? 10, 10_000),
    cooldownMs: Math.max(0, Math.min(60_000, Number(wildcard?.cooldown_ms ?? 0) || 0)),
  };
}

async function acquire(key: string, limit: RuntimeLimit) {
  const state = states.get(key) || { active: 0, waiters: [], starts: [] };
  states.set(key, state);
  while (state.active >= limit.maxConcurrency) await new Promise<void>((resolve) => state.waiters.push(resolve));
  state.active++;

  while (true) {
    const now = Date.now();
    state.starts = state.starts.filter((time) => now - time < 60_000);
    if (state.starts.length < limit.rpm) {
      state.starts.push(now);
      return () => {
        state.active = Math.max(0, state.active - 1);
        state.waiters.shift()?.();
      };
    }
    const waitMs = Math.max(50, 60_000 - (now - state.starts[0]));
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
}

export async function withProviderLimit<T>(task: GenerationTask, fn: () => Promise<T>): Promise<T> {
  const identity = taskIdentity(task);
  const key = `${identity.provider}:${identity.model}:${task.lane}`;
  const limit = await resolveLimit(task);
  const release = await acquire(key, limit);
  try {
    return await fn();
  } finally {
    if (limit.cooldownMs > 0) await new Promise((resolve) => setTimeout(resolve, limit.cooldownMs));
    release();
  }
}

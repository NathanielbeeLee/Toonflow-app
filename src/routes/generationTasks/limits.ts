import express from "express";
import { z } from "zod";
import { validateFields } from "@/middleware/middleware";
import { success } from "@/lib/responseFormat";
import { generationTaskLanes } from "@/domain/generationTask";
import { db } from "@/utils/db";
import {
  deletePricingRule,
  getProjectBudget,
  listPricingRules,
  pricingUnitTypes,
  upsertPricingRule,
  upsertProjectBudget,
} from "@/services/task-engine/budget";

const router = express.Router();

router.post("/list", async (_req, res) => {
  const rows = await db("provider_limits")
    .select("provider", "model", "lane", "max_concurrency as maxConcurrency", "rpm", "cooldown_ms as cooldownMs", "updated_at as updatedAt")
    .orderBy(["provider", "model", "lane"]);
  res.status(200).send(success(rows));
});

router.post(
  "/upsert",
  validateFields({
    provider: z.string().trim().min(1),
    model: z.string().trim().min(1).default("*"),
    lane: z.enum(generationTaskLanes),
    maxConcurrency: z.number().int().min(1).max(32),
    rpm: z.number().int().min(1).max(10_000),
    cooldownMs: z.number().int().min(0).max(60_000),
  }),
  async (req, res) => {
    const { provider, model, lane, maxConcurrency, rpm, cooldownMs } = req.body;
    const row = {
      provider,
      model,
      lane,
      max_concurrency: maxConcurrency,
      rpm,
      cooldown_ms: cooldownMs,
      updated_at: Date.now(),
    };
    await db("provider_limits").insert(row).onConflict(["provider", "model", "lane"]).merge(row);
    res.status(200).send(success(row));
  },
);

router.post("/budget/get", validateFields({ projectId: z.number().int().positive() }), async (req, res) => {
  res.status(200).send(success(await getProjectBudget(req.body.projectId)));
});

router.post(
  "/budget/upsert",
  validateFields({
    projectId: z.number().int().positive(),
    budgetLimit: z.number().nonnegative().nullable(),
    currency: z.enum(["CNY", "USD"]),
    blockUnknownPrice: z.boolean(),
  }),
  async (req, res) => {
    res.status(200).send(success(await upsertProjectBudget(req.body)));
  },
);

router.post("/pricing/list", async (_req, res) => {
  res.status(200).send(success(await listPricingRules()));
});

router.post(
  "/pricing/upsert",
  validateFields({
    id: z.string().uuid().optional(),
    provider: z.string().trim().min(1),
    model: z.string().trim().min(1),
    lane: z.enum(generationTaskLanes),
    unitType: z.enum(pricingUnitTypes),
    unitPrice: z.number().nonnegative(),
    currency: z.enum(["CNY", "USD"]),
  }),
  async (req, res) => {
    res.status(200).send(success(await upsertPricingRule(req.body)));
  },
);

router.post("/pricing/delete", validateFields({ id: z.string().uuid() }), async (req, res) => {
  res.status(200).send(success(await deletePricingRule(req.body.id)));
});

export default router;

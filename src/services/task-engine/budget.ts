import { v4 as uuid } from "uuid";
import { db } from "@/utils/db";
import { GenerationTaskLane } from "@/domain/generationTask";

const sql = db as any;
export const pricingUnitTypes = ["request", "second", "character"] as const;
export type PricingUnitType = (typeof pricingUnitTypes)[number];

export interface CostReservation {
  provider: string;
  model: string;
  units: number;
  estimatedCost: number;
  currency: string;
  pricingSnapshot: unknown;
}

export async function getProjectBudget(projectId: number) {
  const control = await sql("project_budget_controls").where("project_id", projectId).first();
  const usage = await sql("usage_ledger")
    .leftJoin("generation_tasks", "generation_tasks.id", "usage_ledger.task_id")
    .where("generation_tasks.project_id", projectId)
    .sum({ reserved: sql.raw("coalesce(actual_cost, estimated_cost, 0)") })
    .first();
  return {
    projectId,
    budgetLimit: control?.budget_limit ?? null,
    currency: control?.currency ?? "CNY",
    blockUnknownPrice: control?.block_unknown_price === 1,
    reservedCost: Number(usage?.reserved ?? 0),
    remaining: control?.budget_limit == null ? null : Math.max(0, Number(control.budget_limit) - Number(usage?.reserved ?? 0)),
  };
}

export async function upsertProjectBudget(input: { projectId: number; budgetLimit: number | null; currency: string; blockUnknownPrice: boolean }) {
  const project = await sql("o_project").where("id", input.projectId).first();
  if (!project) throw new Error("项目不存在");
  const row = {
    project_id: input.projectId,
    budget_limit: input.budgetLimit,
    currency: input.currency,
    block_unknown_price: input.blockUnknownPrice ? 1 : 0,
    updated_at: Date.now(),
  };
  await sql("project_budget_controls").insert(row).onConflict("project_id").merge(row);
  return getProjectBudget(input.projectId);
}

export async function listPricingRules() {
  return (await sql("pricing_rules").orderBy(["provider", "model", "lane"])).map((row: any) => ({
    id: row.id,
    provider: row.provider,
    model: row.model,
    lane: row.lane,
    unitType: row.unit_type,
    unitPrice: row.unit_price,
    currency: row.currency,
    updatedAt: row.updated_at,
  }));
}

export async function upsertPricingRule(input: {
  id?: string;
  provider: string;
  model: string;
  lane: GenerationTaskLane;
  unitType: PricingUnitType;
  unitPrice: number;
  currency: string;
}) {
  const existing = input.id ? null : await sql("pricing_rules").where({ provider: input.provider, model: input.model, lane: input.lane }).first();
  const id = input.id ?? existing?.id ?? uuid();
  const row = {
    id,
    provider: input.provider,
    model: input.model,
    lane: input.lane,
    unit_type: input.unitType,
    unit_price: input.unitPrice,
    currency: input.currency,
    updated_at: Date.now(),
  };
  if (input.id || existing) {
    const updated = await sql("pricing_rules").where("id", id).update(row);
    if (updated !== 1) throw new Error("价格规则不存在");
  } else {
    await sql("pricing_rules").insert(row);
  }
  return row;
}

export async function deletePricingRule(id: string) {
  await sql("pricing_rules").where("id", id).delete();
  return { id };
}

export async function prepareCostReservation(input: {
  projectId: number;
  lane: GenerationTaskLane;
  model: `${string}:${string}`;
  metrics: Partial<Record<PricingUnitType, number>>;
}): Promise<CostReservation | null> {
  const [provider, model] = input.model.split(/:(.+)/);
  const exact = await sql("pricing_rules").where({ provider, model, lane: input.lane }).first();
  const rule = exact || await sql("pricing_rules").where({ provider, model: "*", lane: input.lane }).first();
  const budget = await getProjectBudget(input.projectId);
  if (!rule) {
    if (budget.blockUnknownPrice) throw new Error(`模型 ${provider}:${model} 没有价格规则，项目已设置阻止未知价格任务`);
    return null;
  }
  if (rule.currency !== budget.currency) throw new Error(`价格规则使用 ${rule.currency}，项目预算使用 ${budget.currency}，请统一币种`);
  const units = Number(input.metrics[rule.unit_type as PricingUnitType] ?? 0);
  if (!Number.isFinite(units) || units <= 0) throw new Error(`价格规则要求 ${rule.unit_type} 单位，但任务无法提供有效数量`);
  const estimatedCost = Number((units * Number(rule.unit_price)).toFixed(6));
  if (budget.budgetLimit != null && budget.reservedCost + estimatedCost > budget.budgetLimit) {
    throw new Error(`预计费用 ${estimatedCost} ${budget.currency} 将超过项目剩余预算 ${budget.remaining} ${budget.currency}`);
  }
  return {
    provider,
    model,
    units,
    estimatedCost,
    currency: rule.currency,
    pricingSnapshot: { ruleId: rule.id, unitType: rule.unit_type, unitPrice: rule.unit_price, capturedAt: Date.now() },
  };
}

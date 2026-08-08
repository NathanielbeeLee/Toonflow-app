import { v4 as uuid } from "uuid";
import { db } from "@/utils/db";
import u from "@/utils";
import { generationTaskRepository } from "@/services/task-engine/repository";

const sql = db as any;
export const reviewStatuses = ["approved", "rejected"] as const;

function mapRow(row: any) {
  return row ? {
    id: row.id,
    projectId: row.project_id,
    scriptId: row.script_id,
    compositionJobId: row.composition_job_id,
    status: row.status,
    note: row.note ?? null,
    reviewer: row.reviewer,
    createdAt: row.created_at,
  } : null;
}

export async function getLatestCompositionReview(input: { projectId: number; scriptId: number; compositionJobId?: string }) {
  let query = sql("composition_reviews").where({ project_id: input.projectId, script_id: input.scriptId });
  if (input.compositionJobId) query = query.where("composition_job_id", input.compositionJobId);
  return mapRow(await query.orderBy("created_at", "desc").first());
}

export async function recordCompositionReview(input: {
  projectId: number;
  scriptId: number;
  compositionJobId: string;
  status: (typeof reviewStatuses)[number];
  note?: string;
  reviewer: string;
}) {
  const job = await sql("composition_jobs").where({ id: input.compositionJobId, project_id: input.projectId, script_id: input.scriptId }).first();
  if (!job || job.status !== "succeeded") throw new Error("只能审核已完成的成片");
  const row = {
    id: uuid(),
    project_id: input.projectId,
    script_id: input.scriptId,
    composition_job_id: input.compositionJobId,
    output_checksum: job.output_checksum,
    status: input.status,
    note: input.note?.trim() || null,
    reviewer: input.reviewer,
    created_at: Date.now(),
  };
  await sql("composition_reviews").insert(row);
  const supersededPackages = await sql("publish_packages")
    .where({ composition_job_id: input.compositionJobId, output_checksum: job.output_checksum })
    .whereNot("review_id", row.id);
  for (const packageRow of supersededPackages) {
    if (packageRow.task_id && ["queued", "running"].includes(packageRow.status)) {
      await generationTaskRepository.requestCancel(packageRow.task_id);
    }
    if (packageRow.package_path) await u.oss.deleteFile(packageRow.package_path).catch(() => undefined);
    await sql("publish_packages").where("id", packageRow.id).update({
      status: "revoked",
      package_path: null,
      error_message: "已有更新的审核记录，旧发布包已撤销",
      updated_at: Date.now(),
    });
  }
  return mapRow(row);
}

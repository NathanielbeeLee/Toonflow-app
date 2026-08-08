import type { Knex } from "knex";

interface Migration {
  id: string;
  up: (db: Knex.Transaction) => Promise<void>;
}

const migrations: Migration[] = [
  {
    id: "20260808_001_durable_generation_tasks",
    up: async (db) => {
      if (!(await db.schema.hasTable("generation_tasks"))) {
        await db.schema.createTable("generation_tasks", (table) => {
          table.text("id").primary();
          table.integer("project_id").notNullable();
          table.integer("legacy_task_id");
          table.text("lane").notNullable();
          table.text("type").notNullable();
          table.text("resource_key");
          table.text("status").notNullable();
          table.integer("priority").notNullable().defaultTo(0);
          table.text("payload").notNullable();
          table.integer("payload_version").notNullable().defaultTo(1);
          table.text("result");
          table.integer("attempts").notNullable().defaultTo(0);
          table.integer("max_attempts").notNullable().defaultTo(3);
          table.text("lease_owner");
          table.integer("lease_expires_at");
          table.integer("next_run_at");
          table.text("provider");
          table.text("provider_job_id");
          table.text("idempotency_key").notNullable().unique();
          table.text("error_code");
          table.text("error_message");
          table.integer("cancel_requested").notNullable().defaultTo(0);
          table.integer("created_at").notNullable();
          table.integer("updated_at").notNullable();
          table.integer("started_at");
          table.integer("finished_at");
          table.index(["status", "lane", "priority", "created_at"], "generation_tasks_claim_idx");
          table.index(["project_id", "created_at"], "generation_tasks_project_idx");
          table.index(["resource_key", "status"], "generation_tasks_resource_idx");
          table.index(["lease_expires_at"], "generation_tasks_lease_idx");
        });
      }

      if (!(await db.schema.hasTable("task_dependencies"))) {
        await db.schema.createTable("task_dependencies", (table) => {
          table.text("task_id").notNullable();
          table.text("depends_on_task_id").notNullable();
          table.text("requirement").notNullable().defaultTo("succeeded");
          table.primary(["task_id", "depends_on_task_id"]);
          table.index(["depends_on_task_id"]);
        });
      }

      if (!(await db.schema.hasTable("provider_limits"))) {
        await db.schema.createTable("provider_limits", (table) => {
          table.text("provider").notNullable();
          table.text("model").notNullable().defaultTo("*");
          table.text("lane").notNullable();
          table.integer("max_concurrency").notNullable().defaultTo(1);
          table.integer("rpm").notNullable().defaultTo(10);
          table.integer("cooldown_ms").notNullable().defaultTo(0);
          table.integer("updated_at").notNullable();
          table.primary(["provider", "model", "lane"]);
        });
      }

      if (!(await db.schema.hasTable("usage_ledger"))) {
        await db.schema.createTable("usage_ledger", (table) => {
          table.text("id").primary();
          table.text("task_id").notNullable();
          table.text("provider").notNullable();
          table.text("model").notNullable();
          table.float("units").notNullable().defaultTo(0);
          table.float("estimated_cost");
          table.float("actual_cost");
          table.text("currency").notNullable().defaultTo("CNY");
          table.text("pricing_snapshot");
          table.integer("created_at").notNullable();
          table.index(["task_id"]);
        });
      }

      if (!(await db.schema.hasTable("project_events"))) {
        await db.schema.createTable("project_events", (table) => {
          table.text("id").primary();
          table.integer("project_id").notNullable();
          table.text("entity_type").notNullable();
          table.text("entity_id").notNullable();
          table.text("action").notNullable();
          table.text("before_data");
          table.text("after_data");
          table.text("actor").notNullable().defaultTo("system");
          table.integer("created_at").notNullable();
          table.index(["project_id", "created_at"]);
          table.index(["entity_type", "entity_id"]);
        });
      }
    },
  },
];

export default async function runMigrations(db: Knex): Promise<void> {
  if (!(await db.schema.hasTable("schema_migrations"))) {
    await db.schema.createTable("schema_migrations", (table) => {
      table.text("id").primary();
      table.integer("applied_at").notNullable();
    });
  }

  for (const migration of migrations) {
    const applied = await db("schema_migrations").where("id", migration.id).first();
    if (applied) continue;
    await db.transaction(async (trx) => {
      await migration.up(trx);
      await trx("schema_migrations").insert({ id: migration.id, applied_at: Date.now() });
    });
    console.log("[数据库迁移] 已应用:", migration.id);
  }
}

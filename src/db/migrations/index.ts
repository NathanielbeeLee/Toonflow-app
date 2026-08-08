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
  {
    id: "20260808_002_voice_utterances",
    up: async (db) => {
      if (!(await db.schema.hasTable("voice_cast"))) {
        await db.schema.createTable("voice_cast", (table) => {
          table.text("id").primary();
          table.integer("project_id").notNullable();
          table.integer("role_asset_id");
          table.text("name").notNullable();
          table.text("provider").notNullable();
          table.text("model").notNullable();
          table.text("voice").notNullable();
          table.float("speech_rate").notNullable().defaultTo(1);
          table.float("pitch_rate").notNullable().defaultTo(0);
          table.float("volume").notNullable().defaultTo(1);
          table.text("emotion");
          table.integer("is_default").notNullable().defaultTo(0);
          table.integer("preview_asset_id");
          table.integer("created_at").notNullable();
          table.integer("updated_at").notNullable();
          table.unique(["project_id", "name"], "voice_cast_project_name_unique");
          table.index(["project_id", "role_asset_id"], "voice_cast_role_idx");
        });
      }

      if (!(await db.schema.hasTable("utterances"))) {
        await db.schema.createTable("utterances", (table) => {
          table.text("id").primary();
          table.integer("project_id").notNullable();
          table.integer("script_id");
          table.integer("storyboard_id");
          table.integer("ordinal").notNullable();
          table.text("kind").notNullable();
          table.integer("role_asset_id");
          table.text("speaker").notNullable();
          table.text("text").notNullable();
          table.text("voice_cast_id");
          table.text("audio_path");
          table.text("cache_key");
          table.integer("duration_ms");
          table.text("status").notNullable().defaultTo("draft");
          table.text("error_message");
          table.integer("locked").notNullable().defaultTo(0);
          table.integer("created_at").notNullable();
          table.integer("updated_at").notNullable();
          table.index(["project_id", "script_id", "ordinal"], "utterances_script_idx");
          table.index(["storyboard_id", "ordinal"], "utterances_storyboard_idx");
          table.index(["voice_cast_id", "status"], "utterances_cast_idx");
        });
      }

      if (!(await db.schema.hasTable("subtitle_cues"))) {
        await db.schema.createTable("subtitle_cues", (table) => {
          table.text("id").primary();
          table.integer("project_id").notNullable();
          table.text("utterance_id").notNullable();
          table.integer("ordinal").notNullable().defaultTo(0);
          table.integer("start_ms").notNullable();
          table.integer("end_ms").notNullable();
          table.text("text").notNullable();
          table.text("style");
          table.integer("locked").notNullable().defaultTo(0);
          table.integer("created_at").notNullable();
          table.integer("updated_at").notNullable();
          table.unique(["utterance_id", "ordinal"], "subtitle_cues_utterance_ordinal_unique");
          table.index(["project_id", "start_ms"], "subtitle_cues_timeline_idx");
        });
      }
    },
  },
  {
    id: "20260808_003_normalized_timelines",
    up: async (db) => {
      if (!(await db.schema.hasTable("project_timelines"))) {
        await db.schema.createTable("project_timelines", (table) => {
          table.text("id").primary();
          table.integer("project_id").notNullable();
          table.integer("script_id").notNullable();
          table.integer("version").notNullable();
          table.text("status").notNullable().defaultTo("draft");
          table.text("payload").notNullable();
          table.text("checksum").notNullable();
          table.integer("created_at").notNullable();
          table.integer("updated_at").notNullable();
          table.unique(["project_id", "script_id", "version"], "project_timelines_version_unique");
          table.index(["project_id", "script_id", "updated_at"], "project_timelines_latest_idx");
        });
      }
      if (!(await db.schema.hasTable("composition_jobs"))) {
        await db.schema.createTable("composition_jobs", (table) => {
          table.text("id").primary();
          table.integer("project_id").notNullable();
          table.integer("script_id").notNullable();
          table.text("timeline_id").notNullable();
          table.integer("timeline_version").notNullable();
          table.text("renderer").notNullable().defaultTo("ffmpeg");
          table.text("preset").notNullable();
          table.text("status").notNullable().defaultTo("draft");
          table.text("output_path");
          table.text("input_checksum").notNullable();
          table.text("task_id");
          table.text("error_message");
          table.integer("created_at").notNullable();
          table.integer("updated_at").notNullable();
          table.index(["project_id", "script_id", "created_at"], "composition_jobs_script_idx");
          table.index(["timeline_id", "timeline_version"], "composition_jobs_timeline_idx");
        });
      }
    },
  },
  {
    id: "20260808_004_composition_render_results",
    up: async (db) => {
      if (!(await db.schema.hasColumn("composition_jobs", "output_checksum"))) {
        await db.schema.alterTable("composition_jobs", (table) => table.text("output_checksum"));
      }
      if (!(await db.schema.hasColumn("composition_jobs", "duration_ms"))) {
        await db.schema.alterTable("composition_jobs", (table) => table.integer("duration_ms"));
      }
      if (!(await db.schema.hasColumn("composition_jobs", "render_log"))) {
        await db.schema.alterTable("composition_jobs", (table) => table.text("render_log"));
      }
    },
  },
  {
    id: "20260808_005_project_audio_clips",
    up: async (db) => {
      if (!(await db.schema.hasTable("project_audio_clips"))) {
        await db.schema.createTable("project_audio_clips", (table) => {
          table.text("id").primary();
          table.integer("project_id").notNullable();
          table.integer("script_id").notNullable();
          table.text("kind").notNullable();
          table.integer("asset_id").notNullable();
          table.text("name").notNullable();
          table.text("path").notNullable();
          table.integer("start_ms").notNullable().defaultTo(0);
          table.integer("in_ms").notNullable().defaultTo(0);
          table.integer("duration_ms").notNullable();
          table.float("gain_db").notNullable().defaultTo(0);
          table.integer("fade_in_ms").notNullable().defaultTo(0);
          table.integer("fade_out_ms").notNullable().defaultTo(0);
          table.integer("created_at").notNullable();
          table.integer("updated_at").notNullable();
          table.index(["project_id", "script_id", "kind", "start_ms"], "project_audio_clips_timeline_idx");
        });
      }
    },
  },
  {
    id: "20260808_006_media_qa_reports",
    up: async (db) => {
      if (!(await db.schema.hasTable("media_qa_reports"))) {
        await db.schema.createTable("media_qa_reports", (table) => {
          table.text("id").primary();
          table.integer("project_id").notNullable();
          table.integer("script_id").notNullable();
          table.text("composition_job_id").notNullable();
          table.text("timeline_id").notNullable();
          table.text("output_checksum").notNullable();
          table.text("status").notNullable().defaultTo("queued");
          table.text("result");
          table.text("task_id");
          table.text("error_message");
          table.integer("created_at").notNullable();
          table.integer("updated_at").notNullable();
          table.index(["project_id", "script_id", "created_at"], "media_qa_reports_script_idx");
          table.index(["composition_job_id", "output_checksum"], "media_qa_reports_output_idx");
        });
      }
    },
  },
  {
    id: "20260808_007_budget_and_pricing",
    up: async (db) => {
      if (!(await db.schema.hasTable("project_budget_controls"))) {
        await db.schema.createTable("project_budget_controls", (table) => {
          table.integer("project_id").primary();
          table.float("budget_limit");
          table.text("currency").notNullable().defaultTo("CNY");
          table.integer("block_unknown_price").notNullable().defaultTo(0);
          table.integer("updated_at").notNullable();
        });
      }
      if (!(await db.schema.hasTable("pricing_rules"))) {
        await db.schema.createTable("pricing_rules", (table) => {
          table.text("id").primary();
          table.text("provider").notNullable();
          table.text("model").notNullable().defaultTo("*");
          table.text("lane").notNullable();
          table.text("unit_type").notNullable();
          table.float("unit_price").notNullable();
          table.text("currency").notNullable().defaultTo("CNY");
          table.integer("updated_at").notNullable();
          table.unique(["provider", "model", "lane"], "pricing_rules_identity_unique");
        });
      }
    },
  },
  {
    id: "20260808_008_composition_reviews",
    up: async (db) => {
      if (!(await db.schema.hasTable("composition_reviews"))) {
        await db.schema.createTable("composition_reviews", (table) => {
          table.text("id").primary();
          table.integer("project_id").notNullable();
          table.integer("script_id").notNullable();
          table.text("composition_job_id").notNullable();
          table.text("output_checksum").notNullable();
          table.text("status").notNullable();
          table.text("note");
          table.text("reviewer").notNullable();
          table.integer("created_at").notNullable();
          table.index(["project_id", "script_id", "created_at"], "composition_reviews_script_idx");
          table.index(["composition_job_id", "created_at"], "composition_reviews_job_idx");
        });
      }
    },
  },
  {
    id: "20260808_009_password_security",
    up: async (db) => {
      if (!(await db.schema.hasColumn("o_user", "must_change_password"))) {
        await db.schema.alterTable("o_user", (table) => table.integer("must_change_password").notNullable().defaultTo(0));
      }
      await db("o_user").where("password", "admin123").update({ must_change_password: 1 });
    },
  },
  {
    id: "20260808_010_script_import_history",
    up: async (db) => {
      if (!(await db.schema.hasTable("script_import_batches"))) {
        await db.schema.createTable("script_import_batches", (table) => {
          table.text("id").primary();
          table.integer("project_id").notNullable();
          table.text("source_type").notNullable();
          table.text("external_project_id").notNullable();
          table.text("external_version");
          table.text("source_checksum").notNullable();
          table.text("selection_checksum").notNullable();
          table.text("importer_version").notNullable();
          table.text("status").notNullable();
          table.text("report").notNullable();
          table.integer("created_at").notNullable();
          table.unique(["project_id", "source_type", "external_project_id", "source_checksum", "selection_checksum"], "script_import_batches_idempotency_unique");
          table.index(["project_id", "external_project_id", "created_at"], "script_import_batches_project_idx");
        });
      }
      if (!(await db.schema.hasTable("script_import_items"))) {
        await db.schema.createTable("script_import_items", (table) => {
          table.text("id").primary();
          table.text("batch_id").notNullable();
          table.integer("project_id").notNullable();
          table.text("source_type").notNullable();
          table.text("external_project_id").notNullable();
          table.text("external_chapter_id").notNullable();
          table.integer("external_order").notNullable();
          table.text("script_name").notNullable();
          table.text("script_content").notNullable();
          table.text("content_checksum").notNullable();
          table.integer("script_id").notNullable();
          table.text("action").notNullable();
          table.integer("created_at").notNullable();
          table.unique(["batch_id", "external_chapter_id"], "script_import_items_batch_chapter_unique");
          table.index(["project_id", "source_type", "external_project_id", "external_chapter_id", "created_at"], "script_import_items_external_idx");
          table.index(["script_id", "created_at"], "script_import_items_script_idx");
        });
      }
    },
  },
  {
    id: "20260808_011_publish_packages",
    up: async (db) => {
      if (!(await db.schema.hasTable("publish_packages"))) {
        await db.schema.createTable("publish_packages", (table) => {
          table.text("id").primary();
          table.integer("project_id").notNullable();
          table.integer("script_id").notNullable();
          table.text("composition_job_id").notNullable();
          table.text("output_checksum").notNullable();
          table.text("qa_report_id").notNullable();
          table.text("review_id").notNullable();
          table.text("status").notNullable().defaultTo("queued");
          table.text("package_path");
          table.text("package_checksum");
          table.integer("size_bytes");
          table.text("manifest");
          table.text("task_id");
          table.text("error_message");
          table.integer("created_at").notNullable();
          table.integer("updated_at").notNullable();
          table.index(["project_id", "script_id", "created_at"], "publish_packages_script_idx");
          table.unique(["composition_job_id", "output_checksum", "qa_report_id", "review_id"], "publish_packages_gate_unique");
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

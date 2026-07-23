import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

const timestamps = {
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
};

export const novels = sqliteTable("novels", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  genre: text("genre").notNull(),
  stage: text("stage").notNull().default("构思"),
  targetWords: integer("target_words").notNull().default(1000000),
  description: text("description").notNull().default(""),
  coverColor: text("cover_color").notNull().default("#B9472D"),
  contract: text("contract", { mode: "json" }).$type<Record<string, string>>().notNull().default({}),
  planning: text("planning", { mode: "json" }).$type<Record<string, string>>().notNull().default({}),
  modelOverrides: text("model_overrides", { mode: "json" }).$type<Record<string, string>>().notNull().default({}),
  version: integer("version").notNull().default(1),
  ...timestamps,
});

export const volumes = sqliteTable("volumes", {
  id: text("id").primaryKey(), novelId: text("novel_id").notNull(), number: integer("number").notNull(),
  title: text("title").notNull(), goal: text("goal").notNull().default(""), conflict: text("conflict").notNull().default(""),
  turningPoints: text("turning_points", { mode: "json" }).$type<string[]>().notNull().default([]),
  summary: text("summary").notNull().default(""), version: integer("version").notNull().default(1), ...timestamps,
});

export const storyArcs = sqliteTable("story_arcs", {
  id: text("id").primaryKey(), novelId: text("novel_id").notNull(), volumeId: text("volume_id").notNull(),
  title: text("title").notNull(), goal: text("goal").notNull().default(""), conflict: text("conflict").notNull().default(""),
  payoff: text("payoff").notNull().default(""), hooks: text("hooks").notNull().default(""), summary: text("summary").notNull().default(""), version: integer("version").notNull().default(1), ...timestamps,
});

export const chapters = sqliteTable("chapters", {
  id: text("id").primaryKey(), novelId: text("novel_id").notNull(), volumeId: text("volume_id"), arcId: text("arc_id"),
  number: integer("number").notNull(), title: text("title").notNull(), status: text("status").notNull().default("待策划"),
  outline: text("outline", { mode: "json" }).$type<Record<string, string | number>>().notNull().default({}),
  draft: text("draft").notNull().default(""), currentVersionId: text("current_version_id"), summary: text("summary").notNull().default(""),
  wordCount: integer("word_count").notNull().default(0), version: integer("version").notNull().default(1), ...timestamps,
});

export const chapterVersions = sqliteTable("chapter_versions", {
  id: text("id").primaryKey(), novelId: text("novel_id").notNull(), chapterId: text("chapter_id").notNull(),
  label: text("label").notNull(), content: text("content").notNull(), wordCount: integer("word_count").notNull(),
  source: text("source").notNull().default("manual"), baseRevision: integer("base_revision"),
  baseVersionId: text("base_version_id"), createdAt: text("created_at").notNull(),
});

export const chapterWorkingDrafts = sqliteTable("chapter_working_drafts", {
  chapterId: text("chapter_id").primaryKey(), novelId: text("novel_id").notNull(), title: text("title").notNull(),
  content: text("content").notNull().default(""), outline: text("outline", { mode: "json" }).$type<Record<string, string | number>>().notNull().default({}),
  baseVersion: integer("base_version").notNull(), updatedAt: text("updated_at").notNull(),
});

export const canonEntities = sqliteTable("canon_entities", {
  id: text("id").primaryKey(), novelId: text("novel_id").notNull(), kind: text("kind").notNull(), name: text("name").notNull(),
  summary: text("summary").notNull().default(""), details: text("details", { mode: "json" }).$type<Record<string, unknown>>().notNull().default({}),
  locked: integer("locked", { mode: "boolean" }).notNull().default(false), version: integer("version").notNull().default(1), ...timestamps,
});

export const canonFacts = sqliteTable("canon_facts", {
  id: text("id").primaryKey(), novelId: text("novel_id").notNull(), entityId: text("entity_id"), key: text("key").notNull(),
  value: text("value").notNull(), status: text("status").notNull().default("已确认"), sourceChapterId: text("source_chapter_id"),
  sourceVersionId: text("source_version_id"), createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(),
});

export const timelineEvents = sqliteTable("timeline_events", {
  id: text("id").primaryKey(), novelId: text("novel_id").notNull(), chapterId: text("chapter_id"), timeLabel: text("time_label").notNull(),
  title: text("title").notNull(), description: text("description").notNull().default(""), sortOrder: integer("sort_order").notNull().default(0), ...timestamps,
});

export const foreshadows = sqliteTable("foreshadows", {
  id: text("id").primaryKey(), novelId: text("novel_id").notNull(), title: text("title").notNull(), description: text("description").notNull(),
  plantedChapterId: text("planted_chapter_id"), targetChapter: integer("target_chapter"), resolvedChapterId: text("resolved_chapter_id"),
  status: text("status").notNull().default("未回收"), importance: text("importance").notNull().default("中"), ...timestamps,
});

export const memoryProposals = sqliteTable("memory_proposals", {
  id: text("id").primaryKey(), novelId: text("novel_id").notNull(), chapterId: text("chapter_id").notNull(),
  type: text("type").notNull(), title: text("title").notNull(), beforeValue: text("before_value"), afterValue: text("after_value").notNull(),
  evidence: text("evidence").notNull().default(""), status: text("status").notNull().default("待确认"), ...timestamps,
});

export const generationRuns = sqliteTable("generation_runs", {
  id: text("id").primaryKey(), novelId: text("novel_id").notNull(), chapterId: text("chapter_id"), taskType: text("task_type").notNull(),
  providerId: text("provider_id"), model: text("model"), status: text("status").notNull(), output: text("output").notNull().default(""),
  error: text("error"), promptVersion: text("prompt_version").notNull().default("v1"), inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0), estimatedCost: integer("estimated_cost").notNull().default(0),
  baseRevision: integer("base_revision"), baseVersionId: text("base_version_id"), durationMs: integer("duration_ms").notNull().default(0), ...timestamps,
});

export const promptTemplates = sqliteTable("prompt_templates", {
  id: text("id").primaryKey(), scope: text("scope").notNull().default("global"), novelId: text("novel_id"), taskType: text("task_type").notNull(),
  name: text("name").notNull(), content: text("content").notNull(), version: integer("version").notNull().default(1), updatedAt: text("updated_at").notNull(),
});

export const providers = sqliteTable("providers", {
  id: text("id").primaryKey(), name: text("name").notNull(), baseUrl: text("base_url").notNull(), model: text("model").notNull(),
  encryptedKey: text("encrypted_key").notNull().default(""), enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  inputPrice: integer("input_price").notNull().default(0), outputPrice: integer("output_price").notNull().default(0), ...timestamps,
});

export const settings = sqliteTable("settings", { key: text("key").primaryKey(), value: text("value", { mode: "json" }).$type<unknown>().notNull(), updatedAt: text("updated_at").notNull() });

export const publicationRecords = sqliteTable("publication_records", {
  id: text("id").primaryKey(), novelId: text("novel_id").notNull(), chapterId: text("chapter_id").notNull(), status: text("status").notNull().default("待发布"),
  platformChapterId: text("platform_chapter_id"), publishedAt: text("published_at"), note: text("note").notNull().default(""), ...timestamps,
});

export const snapshots = sqliteTable("snapshots", {
  id: text("id").primaryKey(), kind: text("kind").notNull(), filename: text("filename").notNull(), size: integer("size").notNull(), createdAt: text("created_at").notNull(),
});

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import * as schema from "./schema.js";

export const dataDir = process.env.NOVEL_WORKBENCH_DATA_DIR
  ? path.resolve(process.env.NOVEL_WORKBENCH_DATA_DIR)
  : path.resolve(process.cwd(), ".data");
export const dbPath = path.join(dataDir, "novel-workbench.db");
fs.mkdirSync(path.join(dataDir, "snapshots"), { recursive: true });
fs.mkdirSync(path.join(dataDir, "exports"), { recursive: true });

export const sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

sqlite.exec(`
CREATE TABLE IF NOT EXISTS novels (id TEXT PRIMARY KEY, title TEXT NOT NULL, genre TEXT NOT NULL, stage TEXT NOT NULL DEFAULT '构思', target_words INTEGER NOT NULL DEFAULT 1000000, description TEXT NOT NULL DEFAULT '', cover_color TEXT NOT NULL DEFAULT '#B9472D', contract TEXT NOT NULL DEFAULT '{}', planning TEXT NOT NULL DEFAULT '{}', model_overrides TEXT NOT NULL DEFAULT '{}', version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS volumes (id TEXT PRIMARY KEY, novel_id TEXT NOT NULL, number INTEGER NOT NULL, title TEXT NOT NULL, goal TEXT NOT NULL DEFAULT '', conflict TEXT NOT NULL DEFAULT '', turning_points TEXT NOT NULL DEFAULT '[]', summary TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS story_arcs (id TEXT PRIMARY KEY, novel_id TEXT NOT NULL, volume_id TEXT NOT NULL, title TEXT NOT NULL, goal TEXT NOT NULL DEFAULT '', conflict TEXT NOT NULL DEFAULT '', payoff TEXT NOT NULL DEFAULT '', hooks TEXT NOT NULL DEFAULT '', summary TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS chapters (id TEXT PRIMARY KEY, novel_id TEXT NOT NULL, volume_id TEXT, arc_id TEXT, number INTEGER NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL DEFAULT '待策划', outline TEXT NOT NULL DEFAULT '{}', draft TEXT NOT NULL DEFAULT '', current_version_id TEXT, summary TEXT NOT NULL DEFAULT '', word_count INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS chapter_versions (id TEXT PRIMARY KEY, novel_id TEXT NOT NULL, chapter_id TEXT NOT NULL, label TEXT NOT NULL, content TEXT NOT NULL, word_count INTEGER NOT NULL, source TEXT NOT NULL DEFAULT 'manual', created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS chapter_working_drafts (chapter_id TEXT PRIMARY KEY, novel_id TEXT NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL DEFAULT '', outline TEXT NOT NULL DEFAULT '{}', base_version INTEGER NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS canon_entities (id TEXT PRIMARY KEY, novel_id TEXT NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '', details TEXT NOT NULL DEFAULT '{}', locked INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS canon_facts (id TEXT PRIMARY KEY, novel_id TEXT NOT NULL, entity_id TEXT, key TEXT NOT NULL, value TEXT NOT NULL, status TEXT NOT NULL DEFAULT '已确认', source_chapter_id TEXT, source_version_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS timeline_events (id TEXT PRIMARY KEY, novel_id TEXT NOT NULL, chapter_id TEXT, time_label TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS foreshadows (id TEXT PRIMARY KEY, novel_id TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL, planted_chapter_id TEXT, target_chapter INTEGER, resolved_chapter_id TEXT, status TEXT NOT NULL DEFAULT '未回收', importance TEXT NOT NULL DEFAULT '中', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS memory_proposals (id TEXT PRIMARY KEY, novel_id TEXT NOT NULL, chapter_id TEXT NOT NULL, type TEXT NOT NULL, title TEXT NOT NULL, before_value TEXT, after_value TEXT NOT NULL, evidence TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT '待确认', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS generation_runs (id TEXT PRIMARY KEY, novel_id TEXT NOT NULL, chapter_id TEXT, task_type TEXT NOT NULL, provider_id TEXT, model TEXT, status TEXT NOT NULL, output TEXT NOT NULL DEFAULT '', error TEXT, prompt_version TEXT NOT NULL DEFAULT 'v1', input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0, estimated_cost INTEGER NOT NULL DEFAULT 0, duration_ms INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS prompt_templates (id TEXT PRIMARY KEY, scope TEXT NOT NULL DEFAULT 'global', novel_id TEXT, task_type TEXT NOT NULL, name TEXT NOT NULL, content TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS providers (id TEXT PRIMARY KEY, name TEXT NOT NULL, base_url TEXT NOT NULL, model TEXT NOT NULL, encrypted_key TEXT NOT NULL DEFAULT '', enabled INTEGER NOT NULL DEFAULT 1, input_price INTEGER NOT NULL DEFAULT 0, output_price INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS publication_records (id TEXT PRIMARY KEY, novel_id TEXT NOT NULL, chapter_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT '待发布', platform_chapter_id TEXT, published_at TEXT, note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS snapshots (id TEXT PRIMARY KEY, kind TEXT NOT NULL, filename TEXT NOT NULL, size INTEGER NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_chapters_novel ON chapters(novel_id, number);
CREATE INDEX IF NOT EXISTS idx_working_drafts_novel ON chapter_working_drafts(novel_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_canon_novel ON canon_entities(novel_id, kind);
CREATE INDEX IF NOT EXISTS idx_foreshadows_novel ON foreshadows(novel_id, status);
CREATE VIRTUAL TABLE IF NOT EXISTS story_search USING fts5(novel_id UNINDEXED, source_type UNINDEXED, source_id UNINDEXED, title, content, tokenize='unicode61');
`);

function ensureColumn(table: string, column: string, definition: string) {
  const columns = sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!columns.some((item) => item.name === column)) sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

ensureColumn("volumes", "version", "INTEGER NOT NULL DEFAULT 1");
ensureColumn("story_arcs", "version", "INTEGER NOT NULL DEFAULT 1");
ensureColumn("chapter_versions", "base_revision", "INTEGER");
ensureColumn("chapter_versions", "base_version_id", "TEXT");
ensureColumn("generation_runs", "base_revision", "INTEGER");
ensureColumn("generation_runs", "base_version_id", "TEXT");

export const db = drizzle(sqlite, { schema });

export const now = () => new Date().toISOString();
export const id = () => crypto.randomUUID();
export const countWords = (text: string) => (text.match(/[\u4e00-\u9fff]|[a-zA-Z0-9]+/g) ?? []).length;

export function seedDemo() {
  const row = sqlite.prepare("SELECT COUNT(*) as count FROM novels").get() as { count: number };
  if (row.count > 0) return;
  const t = now(); const novelId = id(); const volumeId = id(); const arcId = id(); const chapterId = id();
  sqlite.prepare("INSERT INTO novels VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
    novelId, "我在废土开了一家典当行", "都市脑洞", "筹备", 1200000,
    "灾变后的城市里，主角能典当人的执念，也必须支付同等代价。", "#B9472D",
    JSON.stringify({ 核心卖点: "以执念为货币的超凡典当行", 目标读者: "喜欢都市异能、规则怪谈与经营升级的读者", 主角欲望: "查清妹妹失踪真相，并守住典当行", 核心矛盾: "每次使用能力都会失去一段珍贵记忆", 结局方向: "主角找回妹妹，也发现自己才是第一件典当品" }),
    JSON.stringify({ 书名: "我在废土开了一家典当行", 简介: "灾变第七年，沈砚继承了一家只收执念的典当行。有人拿爱情换一夜无敌，有人拿名字换死而复生。而他每完成一笔生意，就会忘记一个最重要的人。", 黄金三章: "第一章异常委托；第二章能力代价；第三章强敌上门与长期目标建立。" }), "{}", 1, t, t
  );
  sqlite.prepare("INSERT INTO volumes (id,novel_id,number,title,goal,conflict,turning_points,summary,version,created_at,updated_at) VALUES (?, ?, 1, ?, ?, ?, ?, ?, 1, ?, ?)").run(volumeId, novelId, "灰港来客", "让主角站稳脚跟并锁定妹妹线索", "黑市组织觊觎典当簿", JSON.stringify(["首次典当", "代价显现", "黑市围店"]), "", t, t);
  sqlite.prepare("INSERT INTO story_arcs (id,novel_id,volume_id,title,goal,conflict,payoff,hooks,summary,version,created_at,updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)").run(arcId, novelId, volumeId, "无名委托", "完成第一单生意", "委托人隐瞒真实身份", "主角获得第一枚执念币", "神秘人知道妹妹名字", "", t, t);
  const outline = { 目标: "用异常委托展示典当行规则", 主视角: "沈砚", 冲突: "委托人想用虚假记忆骗过典当簿", 信息揭示: "执念可以实体化", 情绪点: "主角忘记妹妹声音的一瞬", 伏笔动作: "柜台下的第十三号抽屉自行开启", 预期字数: 2500, 结尾钩子: "抽屉里传出妹妹的求救声" };
  sqlite.prepare("INSERT INTO chapters VALUES (?, ?, ?, ?, 1, ?, ?, ?, '', NULL, '', 0, 1, ?, ?)").run(chapterId, novelId, volumeId, arcId, "第十三号抽屉", "章纲已确认", JSON.stringify(outline), t, t);
  const entities = [
    ["人物", "沈砚", "二十四岁，典当行继承人。冷静克制，害怕遗忘。", 1],
    ["人物", "沈棠", "沈砚失踪三年的妹妹，是全书主线谜团。", 1],
    ["世界规则", "等价典当", "任何超凡收益都必须支付等价的执念或记忆。", 1],
    ["地点", "十三号典当行", "位于灰港旧城区，只在午夜后接待异常客人。", 0],
  ];
  for (const [kind, name, summary, locked] of entities) sqlite.prepare("INSERT INTO canon_entities VALUES (?, ?, ?, ?, ?, '{}', ?, 1, ?, ?)").run(id(), novelId, kind, name, summary, locked, t, t);
  sqlite.prepare("INSERT INTO foreshadows VALUES (?, ?, ?, ?, ?, 30, NULL, '未回收', '高', ?, ?)").run(id(), novelId, "第十三号抽屉", "抽屉为何会传出沈棠的声音", chapterId, t, t);
}

seedDemo();

import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { dataDir, dbPath, id, now, sqlite } from "./db.js";

const snapshotDir = path.join(dataDir, "snapshots");

export async function createSnapshot(kind: string) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-"); const filename = `snapshot-${stamp}.db`; const target = path.join(snapshotDir, filename);
  await sqlite.backup(target); const size = fs.statSync(target).size; const snapshotId = id();
  sqlite.prepare("INSERT INTO snapshots VALUES (?, ?, ?, ?, ?)").run(snapshotId, kind, filename, size, now());
  return { id: snapshotId, kind, filename, size, createdAt: now() };
}

export function snapshotPreview(snapshotId: string) {
  const row = sqlite.prepare("SELECT * FROM snapshots WHERE id=?").get(snapshotId) as { filename: string; kind: string; size: number; created_at: string } | undefined;
  if (!row) return null;
  const filename = path.basename(row.filename); const target = path.join(snapshotDir, filename);
  if (!fs.existsSync(target)) throw new Error("快照文件不存在");
  const source = new Database(target, { readonly: true, fileMustExist: true });
  try {
    const integrity = (source.pragma("integrity_check", { simple: true }) as string) || "unknown";
    const count = (table: string) => source.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table)
      ? (source.prepare(`SELECT COUNT(*) count FROM ${table}`).get() as { count: number }).count
      : 0;
    return {
      id: snapshotId, kind: row.kind, filename, size: row.size, createdAt: row.created_at, integrity,
      novels: count("novels"), chapters: count("chapters"), versions: count("chapter_versions"),
      latestNovelUpdate: count("novels") ? (source.prepare("SELECT MAX(updated_at) value FROM novels").get() as { value: string | null }).value : null,
    };
  } finally { source.close(); }
}

export async function restoreSnapshot(snapshotId: string) {
  const preview = snapshotPreview(snapshotId); if (!preview) return null;
  if (preview.integrity !== "ok") throw new Error(`快照完整性检查失败：${preview.integrity}`);
  const protection = await createSnapshot("恢复前保护");
  const row = sqlite.prepare("SELECT filename FROM snapshots WHERE id=?").get(snapshotId) as { filename: string };
  const source = new Database(path.join(snapshotDir, path.basename(row.filename)), { readonly: true, fileMustExist: true });
  const tables = ["novels","volumes","story_arcs","chapters","chapter_versions","chapter_working_drafts","canon_entities","canon_facts","timeline_events","foreshadows","memory_proposals","generation_runs","prompt_templates","publication_records","settings"];
  try {
    sqlite.pragma("foreign_keys = OFF");
    sqlite.transaction(() => {
      for (const table of tables) {
        const targetExists = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
        const sourceExists = source.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
        if (!targetExists) continue;
        sqlite.prepare(`DELETE FROM ${table}`).run();
        if (!sourceExists) continue;
        const columns = (sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((item) => item.name);
        const sourceColumns = new Set((source.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((item) => item.name));
        const shared = columns.filter((column) => sourceColumns.has(column));
        const rows = source.prepare(`SELECT ${shared.join(",")} FROM ${table}`).all() as Record<string, unknown>[];
        const insert = sqlite.prepare(`INSERT INTO ${table} (${shared.join(",")}) VALUES (${shared.map(() => "?").join(",")})`);
        for (const item of rows) insert.run(...shared.map((column) => item[column]));
      }
      sqlite.prepare("DELETE FROM story_search").run();
    })();
    sqlite.pragma("foreign_keys = ON");
  } catch (error) {
    sqlite.pragma("foreign_keys = ON");
    throw error;
  } finally { source.close(); }
  return { restored: preview, protection };
}

export async function ensureDailySnapshot() {
  const last = sqlite.prepare("SELECT created_at FROM snapshots WHERE kind='每日' ORDER BY created_at DESC LIMIT 1").get() as { created_at: string } | undefined;
  const latestChange = (sqlite.prepare("SELECT MAX(updated_at) value FROM novels").get() as { value: string | null }).value;
  const beijingDate = (value: Date | string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
  const today = beijingDate(new Date());
  if (latestChange && (!last || beijingDate(last.created_at) !== today) && (!last || latestChange > last.created_at)) await createSnapshot("每日");
  pruneSnapshots("每日", 30); pruneSnapshots("非每日", 20);
}

function pruneSnapshots(kind: string, keep: number) {
  const rows = (kind === "每日"
    ? sqlite.prepare("SELECT id,filename FROM snapshots WHERE kind='每日' ORDER BY created_at DESC LIMIT -1 OFFSET ?").all(keep)
    : sqlite.prepare("SELECT id,filename FROM snapshots WHERE kind<>'每日' ORDER BY created_at DESC LIMIT -1 OFFSET ?").all(keep)) as { id: string; filename: string }[];
  for (const row of rows) {
    const target = path.join(snapshotDir, path.basename(row.filename)); if (fs.existsSync(target) && path.resolve(target).startsWith(path.resolve(snapshotDir))) fs.rmSync(target);
    sqlite.prepare("DELETE FROM snapshots WHERE id=?").run(row.id);
  }
}

export const currentDatabasePath = dbPath;

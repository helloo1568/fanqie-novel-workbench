import Fastify from "fastify";
import cors from "@fastify/cors";
import staticPlugin from "@fastify/static";
import archiver from "archiver";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { sqlite, dbPath, dataDir, id, now } from "./db.js";
import { encryptSecret } from "./crypto.js";
import { createSnapshot, ensureDailySnapshot, restoreSnapshot, snapshotPreview } from "./backup.js";
import { importNovel } from "./importer.js";
import { acceptCandidate, CandidateAcceptanceBlockedError, CandidateStaleError, applyDeepPlanningCandidate, cancelRun, onRunEvent, previewPrompt, resumeInterruptedDeepPlanningTasks, semanticQualityCheck, startDeepPlanning, startGeneration, startTargetedRevision, testProvider } from "./ai.js";
import { acceptChapterVersion, camelize, clearWorkingDraft, consistencyCheck, createArc, createChapter, createNovel, createVolume, deleteArc, deleteVolume, entityFrom, getNovel, getWorkingDraft, getWorkspace, listNovels, saveChapterVersion, saveWorkingDraft, updateArc, updateChapter, updateChapterVersionContent, updateNovel, updateVolume } from "./repository.js";
import { knowledgePackInfo } from "./knowledge.js";

const app = Fastify({ logger: true, bodyLimit: 20 * 1024 * 1024 });
const port = Number(process.env.PORT || 3210);
const allowedOrigins = new Set([
  "http://127.0.0.1:5173",
  "http://localhost:5173",
  `http://127.0.0.1:${port}`,
  `http://localhost:${port}`,
  ...(process.env.CORS_ORIGINS || "").split(",").map((value) => value.trim()).filter(Boolean),
]);
await app.register(cors, {
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) callback(null, true);
    else callback(new Error("Origin not allowed"), false);
  },
});
app.addHook("onSend", async (_request, reply) => {
  reply.header("X-Content-Type-Options", "nosniff");
  reply.header("X-Frame-Options", "DENY");
  reply.header("Referrer-Policy", "no-referrer");
});

const objectBody = z.record(z.string(), z.unknown());
const requireBody = (body: unknown) => objectBody.parse(body);

app.get("/api/health", async () => ({ ok: true, version: "0.1.0", database: dbPath }));
app.get<{ Querystring: { taskType?: string; genre?: string; chapterNumber?: string; instruction?: string } }>("/api/knowledge-pack", async (request) => {
  const { taskType, genre, chapterNumber, instruction } = request.query;
  return knowledgePackInfo(taskType ? { taskType, genre, chapterNumber: Number(chapterNumber || 0), instruction } : undefined);
});
app.get("/api/novels", async () => listNovels());
app.post("/api/novels", async (request, reply) => reply.code(201).send(createNovel(requireBody(request.body))));
app.get<{ Params: { id: string } }>("/api/novels/:id/workspace", async (request, reply) => getWorkspace(request.params.id) ?? reply.code(404).send({ error: "小说不存在" }));
app.patch<{ Params: { id: string } }>("/api/novels/:id", async (request, reply) => {
  const result = updateNovel(request.params.id, requireBody(request.body));
  if (result.kind === "missing") return reply.code(404).send({ error: "小说不存在" });
  if (result.kind === "conflict") return reply.code(409).send({ error: "内容已在其他页面更新", current: result.current });
  return result.novel;
});
app.post<{ Params: { id: string } }>("/api/novels/:id/duplicate", async (request, reply) => {
  const source = getNovel(request.params.id); if (!source) return reply.code(404).send({ error: "小说不存在" });
  return reply.code(201).send(createNovel({ ...source, title: `${source.title} - 副本`, stage: "构思" }));
});
app.delete<{ Params: { id: string } }>("/api/novels/:id", async (request, reply) => {
  const novelId = request.params.id;
  if (!getNovel(novelId)) return reply.code(404).send({ error: "小说不存在或已删除" });
  sqlite.transaction(() => {
    for (const table of ["publication_records", "memory_proposals", "foreshadows", "timeline_events", "canon_facts", "canon_entities", "chapter_versions", "chapter_working_drafts", "chapters", "story_arcs", "volumes", "generation_runs", "prompt_templates", "story_search"]) sqlite.prepare(`DELETE FROM ${table} WHERE novel_id=?`).run(novelId);
    sqlite.prepare("DELETE FROM novels WHERE id=?").run(novelId);
  })();
  return reply.code(204).send();
});

app.post<{ Params: { id: string } }>("/api/novels/:id/volumes", async (request, reply) => {
  const volume = createVolume(request.params.id, requireBody(request.body));
  return volume ? reply.code(201).send(volume) : reply.code(404).send({ error: "小说不存在" });
});
app.patch<{ Params: { id: string } }>("/api/volumes/:id", async (request, reply) => {
  const result = updateVolume(request.params.id, requireBody(request.body));
  if (result.kind === "missing") return reply.code(404).send({ error: "分卷不存在" });
  if (result.kind === "conflict") return reply.code(409).send({ error: "分卷已在其他页面更新", current: result.current });
  return result.volume;
});
app.delete<{ Params: { id: string } }>("/api/volumes/:id", async (request, reply) => {
  const result = deleteVolume(request.params.id);
  if (result.kind === "missing") return reply.code(404).send({ error: "分卷不存在" });
  if (result.kind === "used") return reply.code(409).send({ error: `分卷仍有关联的${result.arcs}个情节弧和${result.chapters}个章节` });
  return reply.code(204).send();
});
app.post<{ Params: { id: string } }>("/api/novels/:id/arcs", async (request, reply) => {
  const arc = createArc(request.params.id, requireBody(request.body));
  return arc ? reply.code(201).send(arc) : reply.code(404).send({ error: "小说或分卷不存在" });
});
app.patch<{ Params: { id: string } }>("/api/arcs/:id", async (request, reply) => {
  const result = updateArc(request.params.id, requireBody(request.body));
  if (result.kind === "missing") return reply.code(404).send({ error: "情节弧不存在" });
  if (result.kind === "conflict") return reply.code(409).send({ error: "情节弧已在其他页面更新", current: result.current });
  return result.arc;
});
app.delete<{ Params: { id: string } }>("/api/arcs/:id", async (request, reply) => {
  const result = deleteArc(request.params.id);
  if (result.kind === "missing") return reply.code(404).send({ error: "情节弧不存在" });
  if (result.kind === "used") return reply.code(409).send({ error: `情节弧仍有关联的${result.chapters}个章节` });
  return reply.code(204).send();
});

app.post<{ Params: { id: string } }>("/api/novels/:id/chapters", async (request, reply) => reply.code(201).send(createChapter(request.params.id, requireBody(request.body))));
app.patch<{ Params: { id: string } }>("/api/chapters/:id", async (request, reply) => {
  const result = updateChapter(request.params.id, requireBody(request.body));
  if (result.kind === "missing") return reply.code(404).send({ error: "章节不存在" });
  if (result.kind === "conflict") return reply.code(409).send({ error: "章节已在其他页面更新", current: result.current });
  if (result.kind === "unsafe-draft") return reply.code(400).send({ error: "正式正文必须通过版本保存并接受，不能通过章节元数据接口覆盖", current: result.current });
  return result.chapter;
});
app.get<{ Params: { id: string } }>("/api/chapters/:id/working-draft", async (request) => getWorkingDraft(request.params.id));
app.patch<{ Params: { id: string } }>("/api/chapters/:id/working-draft", async (request, reply) => {
  const result = saveWorkingDraft(request.params.id, requireBody(request.body));
  if (result.kind === "missing") return reply.code(404).send({ error: "章节不存在" });
  if (result.kind === "conflict") return reply.code(409).send({ error: "章节已更新，请先恢复或放弃旧工作稿", currentVersion: result.currentVersion, workingDraft: result.workingDraft });
  return result.workingDraft;
});
app.delete<{ Params: { id: string } }>("/api/chapters/:id/working-draft", async (request, reply) => { clearWorkingDraft(request.params.id); return reply.code(204).send(); });
app.get<{ Params: { id: string } }>("/api/chapters/:id/versions", async (request) => (sqlite.prepare("SELECT * FROM chapter_versions WHERE chapter_id=? ORDER BY created_at DESC").all(request.params.id) as Record<string, unknown>[]).map(camelize));
app.post<{ Params: { id: string } }>("/api/chapters/:id/versions", async (request, reply) => {
  const body = requireBody(request.body); const version = saveChapterVersion(request.params.id, String(body.content || ""), String(body.label || "手动版本"));
  return version ? reply.code(201).send(version) : reply.code(404).send({ error: "章节不存在" });
});
app.get<{ Params: { id: string } }>("/api/chapters/:id/preflight", async (request) => consistencyCheck(request.params.id));
app.post<{ Params: { id: string } }>("/api/chapters/:id/quality", async (request) => semanticQualityCheck(request.params.id, String(requireBody(request.body).content || "")));
app.post<{ Params: { id: string; versionId: string } }>("/api/chapters/:id/candidates/:versionId/accept", async (request, reply) => {
  try {
    const result = await acceptCandidate(request.params.id, request.params.versionId);
    return result ? result : reply.code(404).send({ error: "候选版本不存在" });
  } catch (error) {
    if (error instanceof CandidateAcceptanceBlockedError || error instanceof CandidateStaleError) {
      return reply.code(409).send({ error: error.message, issues: error.issues });
    }
    throw error;
  }
});
app.patch<{ Params: { id: string; versionId: string } }>("/api/chapters/:id/candidates/:versionId", async (request, reply) => {
  const body = requireBody(request.body);
  const result = updateChapterVersionContent(request.params.versionId, request.params.id, String(body.content ?? ""));
  if (!result) return reply.code(404).send({ error: "候选版本不存在" });
  return result;
});

app.post<{ Params: { id: string } }>("/api/novels/:id/canon", async (request, reply) => {
  const body = requireBody(request.body); const t = now(); const entityId = id();
  sqlite.prepare("INSERT INTO canon_entities VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)").run(entityId, request.params.id, body.kind || "人物", body.name || "未命名", body.summary || "", JSON.stringify(body.details || {}), body.locked ? 1 : 0, t, t);
  return reply.code(201).send(entityFrom(sqlite.prepare("SELECT * FROM canon_entities WHERE id=?").get(entityId) as Record<string, unknown>));
});
app.patch<{ Params: { id: string } }>("/api/canon/:id", async (request, reply) => {
  const body = requireBody(request.body); const row = sqlite.prepare("SELECT * FROM canon_entities WHERE id=?").get(request.params.id) as Record<string, unknown> | undefined;
  if (!row) return reply.code(404).send({ error: "设定不存在" });
  if (Number(body.version) !== Number(row.version)) return reply.code(409).send({ error: "设定已更新", current: entityFrom(row) });
  sqlite.prepare("UPDATE canon_entities SET kind=?,name=?,summary=?,details=?,locked=?,version=version+1,updated_at=? WHERE id=?").run(body.kind ?? row.kind, body.name ?? row.name, body.summary ?? row.summary, JSON.stringify(body.details ?? JSON.parse(String(row.details))), body.locked === undefined ? row.locked : body.locked ? 1 : 0, now(), request.params.id);
  return entityFrom(sqlite.prepare("SELECT * FROM canon_entities WHERE id=?").get(request.params.id) as Record<string, unknown>);
});

app.post<{ Params: { id: string } }>("/api/novels/:id/foreshadows", async (request, reply) => {
  const body = requireBody(request.body); const t = now(); const itemId = id();
  sqlite.prepare("INSERT INTO foreshadows VALUES (?, ?, ?, ?, ?, ?, NULL, '未回收', ?, ?, ?)").run(itemId, request.params.id, body.title || "未命名伏笔", body.description || "", body.plantedChapterId || null, body.targetChapter || null, body.importance || "中", t, t);
  return reply.code(201).send(camelize(sqlite.prepare("SELECT * FROM foreshadows WHERE id=?").get(itemId) as Record<string, unknown>));
});
app.patch<{ Params: { id: string } }>("/api/foreshadows/:id", async (request) => {
  const body = requireBody(request.body); sqlite.prepare("UPDATE foreshadows SET status=?,resolved_chapter_id=?,updated_at=? WHERE id=?").run(body.status || "已回收", body.resolvedChapterId || null, now(), request.params.id);
  return camelize(sqlite.prepare("SELECT * FROM foreshadows WHERE id=?").get(request.params.id) as Record<string, unknown>);
});
app.patch<{ Params: { id: string } }>("/api/proposals/:id", async (request) => {
  const body = requireBody(request.body);
  const proposal = sqlite.prepare("SELECT * FROM memory_proposals WHERE id=?").get(request.params.id) as Record<string, unknown> | undefined;
  if (!proposal) return { error: "提案不存在" };
  const status = String(body.status); sqlite.prepare("UPDATE memory_proposals SET status=?,updated_at=? WHERE id=?").run(status, now(), request.params.id);
  if (status === "已确认") {
    const type = String(proposal.type); const t = now();
    if (type === "时间线") {
      const event = JSON.parse(String(proposal.after_value)) as Record<string, unknown>;
      const exists = sqlite.prepare("SELECT id FROM timeline_events WHERE novel_id=? AND chapter_id=? AND title=?").get(proposal.novel_id, proposal.chapter_id, event.title || proposal.title);
      if (!exists) {
        const chapter = sqlite.prepare("SELECT number FROM chapters WHERE id=?").get(proposal.chapter_id) as { number: number } | undefined;
        sqlite.prepare("INSERT INTO timeline_events VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(id(), proposal.novel_id, proposal.chapter_id, event.timeLabel || `第${chapter?.number || "?"}章`, event.title || proposal.title, event.description || "", (chapter?.number || 0) * 100, t, t);
      }
    } else if (type.startsWith("伏笔")) {
      const hook = JSON.parse(String(proposal.after_value)) as Record<string, unknown>;
      if (type === "伏笔回收") {
        sqlite.prepare("UPDATE foreshadows SET status='已回收',resolved_chapter_id=?,updated_at=? WHERE novel_id=? AND title=?").run(proposal.chapter_id, t, proposal.novel_id, hook.title || proposal.title);
      } else if (type === "伏笔新增") {
        const exists = sqlite.prepare("SELECT id FROM foreshadows WHERE novel_id=? AND title=? AND status='未回收'").get(proposal.novel_id, hook.title || proposal.title);
        if (!exists) sqlite.prepare("INSERT INTO foreshadows VALUES (?, ?, ?, ?, ?, ?, NULL, '未回收', '中', ?, ?)").run(id(), proposal.novel_id, hook.title || proposal.title, hook.description || "", proposal.chapter_id, hook.targetChapter || null, t, t);
      } else if (type === "伏笔推进") {
        sqlite.prepare("UPDATE foreshadows SET description=?,target_chapter=COALESCE(?,target_chapter),updated_at=? WHERE novel_id=? AND title=? AND status='未回收'")
          .run(hook.description || proposal.after_value, hook.targetChapter || null, t, proposal.novel_id, hook.title || proposal.title);
      }
    } else {
      const entityName = String(proposal.title).split(/[.·]/)[0];
      const entity = sqlite.prepare("SELECT id FROM canon_entities WHERE novel_id=? AND name=?").get(proposal.novel_id, entityName) as { id: string } | undefined;
      const chapter = sqlite.prepare("SELECT current_version_id FROM chapters WHERE id=?").get(proposal.chapter_id) as { current_version_id: string | null } | undefined;
      const exists = sqlite.prepare("SELECT id FROM canon_facts WHERE source_chapter_id=? AND key=? AND value=?").get(proposal.chapter_id, proposal.title, proposal.after_value);
      if (!exists) sqlite.prepare("INSERT INTO canon_facts VALUES (?, ?, ?, ?, ?, '已确认', ?, ?, ?, ?)").run(id(), proposal.novel_id, entity?.id || null, proposal.title, proposal.after_value, proposal.chapter_id, chapter?.current_version_id || null, t, t);
    }
  }
  return camelize(sqlite.prepare("SELECT * FROM memory_proposals WHERE id=?").get(request.params.id) as Record<string, unknown>);
});

app.post("/api/generations", async (request, reply) => reply.code(202).send(startGeneration(requireBody(request.body) as { novelId: string; chapterId: string; taskType?: string; instruction?: string; baseContent?: string; selectionStart?: number; selectionEnd?: number; providerId?: string })));
app.get("/api/deep-planning/tasks", async () => (sqlite.prepare(`
  SELECT g.id,g.novel_id,g.status,g.created_at,g.updated_at,n.title AS novel_title
  FROM generation_runs g
  JOIN novels n ON n.id=g.novel_id
  WHERE g.task_type='深度开书'
    AND g.status IN ('排队中','生成中','待审核')
    AND g.created_at=(SELECT MAX(latest.created_at) FROM generation_runs latest WHERE latest.novel_id=g.novel_id AND latest.task_type='深度开书')
  ORDER BY g.updated_at DESC
`).all() as Record<string, unknown>[]).map(camelize));
app.post<{ Params: { id: string } }>("/api/chapters/:id/revisions", async (request, reply) => {
  const body = requireBody(request.body);
  const chapter = sqlite.prepare("SELECT novel_id FROM chapters WHERE id=?").get(request.params.id) as { novel_id: string } | undefined;
  if (!chapter) return reply.code(404).send({ error: "章节不存在" });
  try {
    return reply.code(202).send(await startTargetedRevision({ novelId: chapter.novel_id, chapterId: request.params.id, sourceVersionId: String(body.sourceVersionId || "") }));
  } catch (error) {
    return reply.code(400).send({ error: String(error instanceof Error ? error.message : error) });
  }
});
app.post<{ Params: { id: string } }>("/api/novels/:id/deep-planning", async (request, reply) => {
  const body = requireBody(request.body);
  const result = startDeepPlanning({ novelId: request.params.id, interview: (body.interview || {}) as Record<string, string | number> });
  return result ? reply.code(202).send(result) : reply.code(404).send({ error: "小说不存在" });
});
app.get<{ Params: { id: string } }>("/api/novels/:id/deep-planning/latest", async (request) => {
  const row = sqlite.prepare("SELECT * FROM generation_runs WHERE novel_id=? AND task_type='深度开书' ORDER BY created_at DESC LIMIT 1").get(request.params.id) as Record<string, unknown> | undefined;
  if (!row) return null;
  const value = camelize(row);
  try { return { ...value, proposal: row.output ? JSON.parse(String(row.output)) : null }; } catch { return { ...value, proposal: null }; }
});
app.post<{ Params: { id: string; runId: string } }>("/api/novels/:id/deep-planning/:runId/apply", async (request, reply) => {
  const body = requireBody(request.body);
  const result = applyDeepPlanningCandidate({ novelId: request.params.id, runId: request.params.runId, version: Number(body.version), sections: Array.isArray(body.sections) ? body.sections.map(String) : undefined });
  if (result.kind === "ok") return result;
  if (result.kind === "conflict") return reply.code(409).send({ error: "小说已在其他页面修改，请刷新后重新审批" });
  if (result.kind === "invalid") return reply.code(400).send({ error: result.message });
  return reply.code(404).send({ error: "深度开书候选不存在" });
});
app.get<{ Params: { id: string } }>("/api/generations/:id/events", async (request, reply) => {
  reply.hijack(); const res = reply.raw;
  res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  const existing = sqlite.prepare("SELECT status,output,error,chapter_id,created_at FROM generation_runs WHERE id=?").get(request.params.id) as { status: string; output: string; error: string; chapter_id: string | null; created_at: string } | undefined;
  if (!existing) { res.write(`event: error\ndata: ${JSON.stringify({ message: "任务不存在" })}\n\n`); res.end(); return; }
  if (["已完成", "待审核", "失败", "已停止"].includes(existing.status)) {
    const version = existing.chapter_id ? sqlite.prepare("SELECT * FROM chapter_versions WHERE chapter_id=? AND created_at>=? AND source IN ('ai-candidate','ai-partial','ai-revision') ORDER BY created_at DESC LIMIT 1").get(existing.chapter_id, existing.created_at) as Record<string, unknown> | undefined : undefined;
    const event = ["已完成", "待审核"].includes(existing.status) ? "done" : existing.status === "已停止" ? "stopped" : "error";
    const versionData = version ? camelize(version) : null;
    const candidateContent = version ? String(version.content || existing.output) : existing.output;
    res.write(`event: ${event}\ndata: ${JSON.stringify({ ...existing, output: candidateContent, version: versionData, partial: candidateContent, message: existing.error })}\n\n`); res.end(); return;
  }
  const snapshotPhase = existing.status === "排队中" ? "正在启动" : "正在生成";
  res.write(`event: snapshot\ndata: ${JSON.stringify({ status: "streaming", phase: snapshotPhase, text: existing.output, partial: existing.output })}\n\n`);
  const off = onRunEvent(request.params.id, ({ event, data }) => { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); if (["done", "error", "stopped"].includes(event)) { off(); res.end(); } });
  request.raw.on("close", off);
});
app.get<{ Params: { id: string } }>("/api/chapters/:id/active-generation", async (request, reply) => {
  const row = sqlite.prepare("SELECT id,task_type FROM generation_runs WHERE chapter_id=? AND status IN ('排队中','生成中') ORDER BY created_at DESC LIMIT 1").get(request.params.id) as { id: string; task_type: string } | undefined;
  if (!row) return reply.code(204).send();
  return { runId: row.id, taskType: row.task_type };
});
app.post<{ Params: { id: string } }>("/api/generations/:id/cancel", async (request) => cancelRun(request.params.id));
app.get<{ Params: { id: string } }>("/api/novels/:id/generations", async (request) => (sqlite.prepare("SELECT * FROM generation_runs WHERE novel_id=? ORDER BY created_at DESC LIMIT 100").all(request.params.id) as Record<string, unknown>[]).map(camelize));

app.get("/api/providers", async () => (sqlite.prepare("SELECT id,name,base_url,model,enabled,input_price,output_price,encrypted_key,created_at,updated_at FROM providers ORDER BY created_at").all() as Record<string, unknown>[]).map((r) => ({ ...camelize(r), hasKey: Boolean(r.encrypted_key), encryptedKey: undefined })));
app.post("/api/providers", async (request, reply) => {
  const body = requireBody(request.body); const providerId = id(); const t = now();
  sqlite.prepare("INSERT INTO providers VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)").run(providerId, body.name || "OpenAI 兼容", body.baseUrl || "https://api.openai.com/v1", body.model || "gpt-4.1-mini", encryptSecret(String(body.apiKey || "")), Number(body.inputPrice || 0), Number(body.outputPrice || 0), t, t);
  return reply.code(201).send({ id: providerId, name: body.name, baseUrl: body.baseUrl, model: body.model, hasKey: Boolean(body.apiKey) });
});
app.patch<{ Params: { id: string } }>("/api/providers/:id", async (request, reply) => {
  const body = requireBody(request.body); const row = sqlite.prepare("SELECT * FROM providers WHERE id=?").get(request.params.id) as Record<string, unknown> | undefined;
  if (!row) return reply.code(404).send({ error: "供应商不存在" });
  sqlite.prepare("UPDATE providers SET name=?,base_url=?,model=?,encrypted_key=?,enabled=?,input_price=?,output_price=?,updated_at=? WHERE id=?")
    .run(body.name ?? row.name, body.baseUrl ?? row.base_url, body.model ?? row.model, body.apiKey ? encryptSecret(String(body.apiKey)) : row.encrypted_key, body.enabled === undefined ? row.enabled : body.enabled ? 1 : 0, Number(body.inputPrice ?? row.input_price), Number(body.outputPrice ?? row.output_price), now(), request.params.id);
  const updated = sqlite.prepare("SELECT * FROM providers WHERE id=?").get(request.params.id) as Record<string, unknown>;
  return { ...camelize(updated), encryptedKey: undefined, hasKey: Boolean(updated.encrypted_key) };
});
app.delete<{ Params: { id: string } }>("/api/providers/:id", async (request, reply) => { sqlite.prepare("UPDATE generation_runs SET provider_id=NULL WHERE provider_id=?").run(request.params.id); const result = sqlite.prepare("DELETE FROM providers WHERE id=?").run(request.params.id); return result.changes ? reply.code(204).send() : reply.code(404).send({ error: "供应商不存在" }); });
app.post<{ Params: { id: string } }>("/api/providers/:id/test", async (request, reply) => { try { return await testProvider(request.params.id); } catch (error) { return reply.code(502).send({ error: String(error) }); } });

app.get<{ Querystring: { novelId?: string } }>("/api/prompts", async (request) => (sqlite.prepare("SELECT * FROM prompt_templates WHERE scope='global' OR novel_id=? ORDER BY task_type,scope,updated_at").all(request.query.novelId || "") as Record<string, unknown>[]).map(camelize));
app.post("/api/prompts", async (request, reply) => {
  const body = requireBody(request.body); const promptId = id();
  sqlite.prepare("INSERT INTO prompt_templates VALUES (?,?,?,?,?,?,?,?)").run(promptId, body.scope || "novel", body.novelId || null, body.taskType || "正文", body.name || "补充规则", body.content || "", 1, now());
  return reply.code(201).send(camelize(sqlite.prepare("SELECT * FROM prompt_templates WHERE id=?").get(promptId) as Record<string, unknown>));
});
app.patch<{ Params: { id: string } }>("/api/prompts/:id", async (request, reply) => {
  const body = requireBody(request.body); const row = sqlite.prepare("SELECT * FROM prompt_templates WHERE id=?").get(request.params.id) as Record<string, unknown> | undefined;
  if (!row) return reply.code(404).send({ error: "提示词不存在" });
  if (Number(body.version) !== Number(row.version)) return reply.code(409).send({ error: "提示词已更新", current: camelize(row) });
  sqlite.prepare("UPDATE prompt_templates SET name=?,content=?,task_type=?,version=version+1,updated_at=? WHERE id=?").run(body.name ?? row.name, body.content ?? row.content, body.taskType ?? row.task_type, now(), request.params.id);
  return camelize(sqlite.prepare("SELECT * FROM prompt_templates WHERE id=?").get(request.params.id) as Record<string, unknown>);
});
app.delete<{ Params: { id: string } }>("/api/prompts/:id", async (request, reply) => { const result = sqlite.prepare("DELETE FROM prompt_templates WHERE id=?").run(request.params.id); return result.changes ? reply.code(204).send() : reply.code(404).send({ error: "提示词不存在" }); });
app.post<{ Params: { id: string } }>("/api/chapters/:id/prompt-preview", async (request, reply) => { const body = requireBody(request.body); const result = previewPrompt(request.params.id, String(body.taskType || "正文"), String(body.instruction || "")); return result || reply.code(404).send({ error: "章节不存在" }); });

app.post<{ Params: { id: string } }>("/api/chapters/:id/publication", async (request, reply) => {
  const body = requireBody(request.body); const chapter = sqlite.prepare("SELECT novel_id FROM chapters WHERE id=?").get(request.params.id) as { novel_id: string } | undefined;
  if (!chapter) return reply.code(404).send({ error: "章节不存在" });
  const existing = sqlite.prepare("SELECT id FROM publication_records WHERE chapter_id=?").get(request.params.id) as { id: string } | undefined; const t = now();
  if (existing) sqlite.prepare("UPDATE publication_records SET status=?,platform_chapter_id=?,published_at=?,note=?,updated_at=? WHERE id=?").run(body.status || "待发布", body.platformChapterId || null, body.publishedAt || null, body.note || "", t, existing.id);
  else sqlite.prepare("INSERT INTO publication_records VALUES (?,?,?,?,?,?,?,?,?)").run(id(), chapter.novel_id, request.params.id, body.status || "待发布", body.platformChapterId || null, body.publishedAt || null, body.note || "", t, t);
  if (body.status === "已发布") sqlite.prepare("UPDATE chapters SET status='已发布',version=version+1,updated_at=? WHERE id=?").run(t, request.params.id);
  return camelize(sqlite.prepare("SELECT * FROM publication_records WHERE chapter_id=?").get(request.params.id) as Record<string, unknown>);
});

app.get<{ Params: { id: string }; Querystring: { format?: string } }>("/api/novels/:id/export", async (request, reply) => {
  const workspace = getWorkspace(request.params.id); if (!workspace) return reply.code(404).send({ error: "小说不存在" });
  const project = { ...workspace, versions: (sqlite.prepare("SELECT * FROM chapter_versions WHERE novel_id=? ORDER BY created_at").all(request.params.id) as Record<string, unknown>[]).map(camelize), prompts: (sqlite.prepare("SELECT * FROM prompt_templates WHERE novel_id=? ORDER BY task_type").all(request.params.id) as Record<string, unknown>[]).map(camelize) };
  const markdown = workspace.chapters.map((c) => `# ${c.title}\n\n${c.draft}`).join("\n\n");
  const text = workspace.chapters.map((c) => `${c.title}\r\n\r\n${c.draft}`).join("\r\n\r\n");
  const format = request.query.format || "txt";
  const safeTitle = encodeURIComponent(String(workspace.novel.title));
  if (format === "zip") {
    reply.hijack();
    reply.raw.writeHead(200, { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename*=UTF-8''${safeTitle}.zip` });
    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.on("error", (error) => reply.raw.destroy(error)); archive.pipe(reply.raw);
    archive.append(JSON.stringify({ format: "novel-workbench", version: 1, exportedAt: now(), novelId: workspace.novel.id }, null, 2), { name: "manifest.json" });
    archive.append(JSON.stringify(project, null, 2), { name: "project.json" }); archive.append(text, { name: `${String(workspace.novel.title)}.txt` }); archive.append(markdown, { name: `${String(workspace.novel.title)}.md` });
    for (const chapter of workspace.chapters) archive.append(String(chapter.draft), { name: `chapters/${String(chapter.number).padStart(4, "0")}-${String(chapter.title).replace(/[\\/:*?\"<>|]/g, "_")}.txt` });
    await archive.finalize(); return;
  }
  if (format === "json") return reply.header("Content-Disposition", `attachment; filename*=UTF-8''${safeTitle}.json`).send(project);
  return reply.type("text/plain; charset=utf-8").header("Content-Disposition", `attachment; filename*=UTF-8''${safeTitle}.${format === "md" ? "md" : "txt"}`).send(format === "md" ? markdown : text);
});

app.post("/api/snapshots", async (request) => createSnapshot(String((request.body as Record<string, unknown> | null)?.kind || "操作")));
app.get("/api/snapshots", async () => (sqlite.prepare("SELECT * FROM snapshots ORDER BY created_at DESC").all() as Record<string, unknown>[]).map(camelize));
app.get<{ Params: { id: string } }>("/api/snapshots/:id/preview", async (request, reply) => { try { return snapshotPreview(request.params.id) || reply.code(404).send({ error: "快照不存在" }); } catch (error) { return reply.code(422).send({ error: String(error) }); } });
app.post<{ Params: { id: string } }>("/api/snapshots/:id/restore", async (request, reply) => { try { return await restoreSnapshot(request.params.id) || reply.code(404).send({ error: "快照不存在" }); } catch (error) { return reply.code(422).send({ error: String(error) }); } });
app.post("/api/imports", async (request, reply) => { try { return reply.code(201).send(await importNovel(requireBody(request.body))); } catch (error) { return reply.code(422).send({ error: String(error) }); } });

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../dist");
if (fs.existsSync(dist)) {
  await app.register(staticPlugin, { root: dist });
  app.setNotFoundHandler((request, reply) => request.url.startsWith("/api/") ? reply.code(404).send({ error: "接口不存在" }) : reply.sendFile("index.html"));
}

await app.listen({ port, host: "127.0.0.1" });
resumeInterruptedDeepPlanningTasks();
void ensureDailySnapshot();
setInterval(() => void ensureDailySnapshot(), 60 * 60 * 1000).unref();

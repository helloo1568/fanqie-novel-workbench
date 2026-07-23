import unzipper from "unzipper";
import { createNovel } from "./repository.js";
import { id, now, sqlite } from "./db.js";

type Input = Record<string, unknown>;

export async function importNovel(input: Input) {
  const format = String(input.format || "txt").toLowerCase();
  if (format === "zip") {
    const archive = await unzipper.Open.buffer(Buffer.from(String(input.content || ""), "base64"));
    const project = archive.files.find((file) => file.path === "project.json");
    if (!project) throw new Error("小说包缺少 project.json");
    return importWorkspace(JSON.parse((await project.buffer()).toString("utf8")) as Input);
  }
  if (format === "json") return importWorkspace(JSON.parse(String(input.content || "{}")) as Input);
  return importPlainText(String(input.content || ""), String(input.filename || "导入小说"), format);
}

function importPlainText(content: string, filename: string, format: string) {
  const title = filename.replace(/\.(txt|md|markdown)$/i, "") || "导入小说";
  const novel = createNovel({ title, genre: "通用", targetWords: Math.max(100000, content.length * 5), description: "从章节文本导入" });
  if (!novel) throw new Error("创建导入小说失败");
  const novelId = String(novel.id); const volume = sqlite.prepare("SELECT id FROM volumes WHERE novel_id=? LIMIT 1").get(novelId) as { id: string };
  const heading = format === "md" || format === "markdown" ? /^#{1,2}\s+(.+)$/gm : /^(第[零一二三四五六七八九十百千万\d]+章[^\r\n]*)$/gm;
  const matches = [...content.matchAll(heading)];
  const chapters = matches.length ? matches.map((match, index) => ({ title: match[1].trim(), content: content.slice((match.index || 0) + match[0].length, matches[index + 1]?.index ?? content.length).trim() })) : [{ title: "第1章 导入正文", content: content.trim() }];
  const t = now(); const insert = sqlite.prepare(`INSERT INTO chapters (id,novel_id,volume_id,arc_id,number,title,status,outline,draft,current_version_id,summary,word_count,version,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,'{}',?,NULL,'',?,1,?,?)`);
  try {
    sqlite.transaction(() => {
      chapters.forEach((chapter, index) => insert.run(id(), novelId, volume.id, null, index + 1, chapter.title, chapter.content ? "正文草稿" : "待策划", chapter.content, countWords(chapter.content), t, t));
    })();
  } catch (error) {
    removeImportedNovel(novelId);
    throw error;
  }
  return { novelId, title, chapters: chapters.length };
}

function importWorkspace(workspace: Input) {
  if (workspace.project && typeof workspace.project === "object") workspace = workspace.project as Input;
  const sourceNovel = workspace.novel as Input | undefined; if (!sourceNovel) throw new Error("项目数据缺少 novel");
  const novel = createNovel({ ...sourceNovel, title: `${String(sourceNovel.title || "导入小说")}（导入）`, stage: "构思" });
  if (!novel) throw new Error("创建导入小说失败");
  const novelId = String(novel.id); const t = now();
  const volumeMap = new Map<string, string>(); const arcMap = new Map<string, string>(); const chapterMap = new Map<string, string>(); const entityMap = new Map<string, string>(); const versionMap = new Map<string, string>();
  try {
    sqlite.transaction(() => {
    sqlite.prepare("UPDATE novels SET genre=?,target_words=?,description=?,cover_color=?,contract=?,planning=?,model_overrides='{}',updated_at=? WHERE id=?")
      .run(sourceNovel.genre || "通用", Number(sourceNovel.targetWords || 1000000), sourceNovel.description || "", sourceNovel.coverColor || "#376B5B", JSON.stringify(sourceNovel.contract || {}), JSON.stringify(sourceNovel.planning || {}), t, novelId);
    sqlite.prepare("DELETE FROM volumes WHERE novel_id=?").run(novelId);
    for (const volume of (workspace.volumes as Input[] | undefined) || []) {
      const newId = id(); volumeMap.set(String(volume.id), newId);
      sqlite.prepare("INSERT INTO volumes (id,novel_id,number,title,goal,conflict,turning_points,summary,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,1,?,?)")
        .run(newId, novelId, Number(volume.number || 1), volume.title || "未命名卷", volume.goal || "", volume.conflict || "", JSON.stringify(volume.turningPoints || []), volume.summary || "", t, t);
    }
    if (!volumeMap.size) { const newId = id(); volumeMap.set("default", newId); sqlite.prepare("INSERT INTO volumes (id,novel_id,number,title,goal,conflict,turning_points,summary,version,created_at,updated_at) VALUES (?,?,1,'第一卷','','','[]','',1,?,?)").run(newId, novelId, t, t); }
    for (const arc of (workspace.arcs as Input[] | undefined) || []) {
      const newId = id(); arcMap.set(String(arc.id), newId);
      sqlite.prepare("INSERT INTO story_arcs (id,novel_id,volume_id,title,goal,conflict,payoff,hooks,summary,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,1,?,?)")
        .run(newId, novelId, volumeMap.get(String(arc.volumeId)) || [...volumeMap.values()][0], arc.title || "未命名弧", arc.goal || "", arc.conflict || "", arc.payoff || "", arc.hooks || "", arc.summary || "", t, t);
    }
    for (const chapter of (workspace.chapters as Input[] | undefined) || []) {
      const newId = id(); chapterMap.set(String(chapter.id), newId); const draft = String(chapter.draft || "");
      sqlite.prepare(`INSERT INTO chapters (id,novel_id,volume_id,arc_id,number,title,status,outline,draft,current_version_id,summary,word_count,version,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,NULL,?,?,1,?,?)`).run(newId, novelId, volumeMap.get(String(chapter.volumeId)) || [...volumeMap.values()][0], arcMap.get(String(chapter.arcId)) || null, Number(chapter.number || chapterMap.size), chapter.title || "未命名章", chapter.status || (draft ? "正文草稿" : "待策划"), JSON.stringify(chapter.outline || {}), draft, chapter.summary || "", countWords(draft), t, t);
    }
    for (const version of (workspace.versions as Input[] | undefined) || []) {
      const chapterId = chapterMap.get(String(version.chapterId)); if (!chapterId) continue; const newId = id(); versionMap.set(String(version.id), newId);
      sqlite.prepare("INSERT INTO chapter_versions (id,novel_id,chapter_id,label,content,word_count,source,created_at) VALUES (?,?,?,?,?,?,?,?)").run(newId, novelId, chapterId, version.label || "导入版本", version.content || "", Number(version.wordCount || countWords(String(version.content || ""))), version.source || "import", version.createdAt || t);
    }
    for (const chapter of (workspace.chapters as Input[] | undefined) || []) {
      const currentVersionId = versionMap.get(String(chapter.currentVersionId)); if (currentVersionId) sqlite.prepare("UPDATE chapters SET current_version_id=? WHERE id=?").run(currentVersionId, chapterMap.get(String(chapter.id)));
    }
    for (const entity of (workspace.canon as Input[] | undefined) || []) {
      const newId = id(); entityMap.set(String(entity.id), newId);
      sqlite.prepare("INSERT INTO canon_entities (id,novel_id,kind,name,summary,details,locked,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,1,?,?)").run(newId, novelId, entity.kind || "人物", entity.name || "未命名", entity.summary || "", JSON.stringify(entity.details || {}), entity.locked ? 1 : 0, t, t);
    }
    for (const fact of (workspace.facts as Input[] | undefined) || []) sqlite.prepare("INSERT INTO canon_facts (id,novel_id,entity_id,key,value,status,source_chapter_id,source_version_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)").run(id(), novelId, entityMap.get(String(fact.entityId)) || null, fact.key || "事实", fact.value || "", fact.status || "已确认", chapterMap.get(String(fact.sourceChapterId)) || null, null, t, t);
    for (const event of (workspace.timeline as Input[] | undefined) || []) sqlite.prepare("INSERT INTO timeline_events (id,novel_id,chapter_id,time_label,title,description,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)").run(id(), novelId, chapterMap.get(String(event.chapterId)) || null, event.timeLabel || "未定时间", event.title || "事件", event.description || "", Number(event.sortOrder || 0), t, t);
    for (const hook of (workspace.foreshadows as Input[] | undefined) || []) sqlite.prepare("INSERT INTO foreshadows (id,novel_id,title,description,planted_chapter_id,target_chapter,resolved_chapter_id,status,importance,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)").run(id(), novelId, hook.title || "伏笔", hook.description || "", chapterMap.get(String(hook.plantedChapterId)) || null, hook.targetChapter || null, chapterMap.get(String(hook.resolvedChapterId)) || null, hook.status || "未回收", hook.importance || "中", t, t);
    for (const prompt of (workspace.prompts as Input[] | undefined) || []) sqlite.prepare("INSERT INTO prompt_templates (id,scope,novel_id,task_type,name,content,version,updated_at) VALUES (?,?,?,?,?,?,1,?)").run(id(), "novel", novelId, prompt.taskType || "正文", prompt.name || "导入规则", prompt.content || "", t);
    for (const proposal of (workspace.proposals as Input[] | undefined) || []) {
      const chapterId = chapterMap.get(String(proposal.chapterId)); if (!chapterId) continue;
      sqlite.prepare("INSERT INTO memory_proposals (id,novel_id,chapter_id,type,title,before_value,after_value,evidence,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)").run(id(), novelId, chapterId, proposal.type || "新增事实", proposal.title || "导入提案", proposal.beforeValue || null, proposal.afterValue || "", proposal.evidence || "", proposal.status || "待确认", t, t);
    }
    for (const publication of (workspace.publications as Input[] | undefined) || []) {
      const chapterId = chapterMap.get(String(publication.chapterId)); if (!chapterId) continue;
      sqlite.prepare("INSERT INTO publication_records (id,novel_id,chapter_id,status,platform_chapter_id,published_at,note,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)").run(id(), novelId, chapterId, publication.status || "待发布", publication.platformChapterId || null, publication.publishedAt || null, publication.note || "", t, t);
    }
    })();
  } catch (error) {
    removeImportedNovel(novelId);
    throw error;
  }
  return { novelId, title: `${String(sourceNovel.title || "导入小说")}（导入）`, chapters: chapterMap.size };
}

function countWords(text: string) { return (text.match(/[\u4e00-\u9fff]|[a-zA-Z0-9]+/g) || []).length; }

function removeImportedNovel(novelId: string) {
  sqlite.transaction(() => {
    for (const table of ["publication_records", "memory_proposals", "foreshadows", "timeline_events", "canon_facts", "canon_entities", "chapter_versions", "chapter_working_drafts", "chapters", "story_arcs", "volumes", "generation_runs", "prompt_templates", "story_search"]) {
      sqlite.prepare(`DELETE FROM ${table} WHERE novel_id=?`).run(novelId);
    }
    sqlite.prepare("DELETE FROM novels WHERE id=?").run(novelId);
  })();
}

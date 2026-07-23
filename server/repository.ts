import { sqlite, now, id, countWords } from "./db.js";
import { FANQIE_PROFILE_UPDATED_AT, getFanqieGenreProfile } from "../shared/fanqieProfiles.js";

const json = <T>(value: string | null | undefined, fallback: T): T => {
  try { return value ? JSON.parse(value) as T : fallback; } catch { return fallback; }
};

export function novelFrom(row: Record<string, unknown>) {
  return {
    id: row.id, title: row.title, genre: row.genre, stage: row.stage, targetWords: row.target_words,
    currentWords: row.current_words ?? 0, chapterCount: row.chapter_count ?? 0, description: row.description,
    coverColor: row.cover_color, contract: json(row.contract as string, {}), planning: json(row.planning as string, {}),
    modelOverrides: json(row.model_overrides as string, {}), version: row.version, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export function chapterFrom(row: Record<string, unknown>) {
  return {
    id: row.id, novelId: row.novel_id, volumeId: row.volume_id, arcId: row.arc_id, number: row.number,
    title: row.title, status: row.status, outline: json(row.outline as string, {}), draft: row.draft,
    currentVersionId: row.current_version_id, summary: row.summary, wordCount: row.word_count,
    version: row.version, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export function entityFrom(row: Record<string, unknown>) {
  return { id: row.id, novelId: row.novel_id, kind: row.kind, name: row.name, summary: row.summary,
    details: json(row.details as string, {}), locked: Boolean(row.locked), version: row.version, createdAt: row.created_at, updatedAt: row.updated_at };
}

export function listNovels() {
  const rows = sqlite.prepare(`SELECT n.*, COALESCE(SUM(c.word_count), 0) current_words, COUNT(c.id) chapter_count
    FROM novels n LEFT JOIN chapters c ON c.novel_id=n.id GROUP BY n.id ORDER BY n.updated_at DESC`).all() as Record<string, unknown>[];
  return rows.map(novelFrom);
}

export function getNovel(novelId: string) {
  const row = sqlite.prepare(`SELECT n.*, COALESCE(SUM(c.word_count), 0) current_words, COUNT(c.id) chapter_count
    FROM novels n LEFT JOIN chapters c ON c.novel_id=n.id WHERE n.id=? GROUP BY n.id`).get(novelId) as Record<string, unknown> | undefined;
  return row ? novelFrom(row) : null;
}

const urbanHumanizationTemplates = [
  {
    taskType: "正文",
    name: "都市脑洞真人化文风",
    content: "近距离第三人称跟随主角；优先写人物正在做的事，让未解释动作、物件和环境保留潜台词。动作、对白或环境已经表达的信息，不再由旁白总结。允许人物迟疑、试错、改口、抢话、答非所问与沉默；异常设定只在它迫使人物做选择时解释。删除完整主题句、连续同构段落和标准问答式对话。",
  },
  {
    taskType: "质检",
    name: "都市脑洞真人化检查",
    content: "额外检查：旁白是否解释了潜台词；人物是否轮流完成标准问答；主角是否从不试错；物件、职业细节和规则是否真正改变选择。每项问题必须引用具体句子。",
  },
] as const;

export function ensureNovelPromptTemplates(novelId: string) {
  const novel = sqlite.prepare("SELECT genre FROM novels WHERE id=?").get(novelId) as { genre: string } | undefined;
  if (novel?.genre !== "都市脑洞") return;
  const exists = sqlite.prepare("SELECT id FROM prompt_templates WHERE novel_id=? AND task_type=? AND name=?");
  const insert = sqlite.prepare("INSERT INTO prompt_templates VALUES (?, 'novel', ?, ?, ?, ?, 1, ?)");
  const t = now();
  for (const template of urbanHumanizationTemplates) {
    if (!exists.get(novelId, template.taskType, template.name)) insert.run(id(), novelId, template.taskType, template.name, template.content, t);
  }
}

export function getWorkspace(novelId: string) {
  ensureNovelPromptTemplates(novelId);
  const novel = getNovel(novelId);
  if (!novel) return null;
  const volumes = (sqlite.prepare("SELECT * FROM volumes WHERE novel_id=? ORDER BY number").all(novelId) as Record<string, unknown>[]).map((r) => ({ ...r, novelId: r.novel_id, turningPoints: json(r.turning_points as string, []) }));
  const arcs = (sqlite.prepare("SELECT * FROM story_arcs WHERE novel_id=? ORDER BY created_at").all(novelId) as Record<string, unknown>[]).map((r) => ({ ...r, novelId: r.novel_id, volumeId: r.volume_id }));
  const chapters = (sqlite.prepare("SELECT * FROM chapters WHERE novel_id=? ORDER BY number").all(novelId) as Record<string, unknown>[]).map(chapterFrom);
  const canon = (sqlite.prepare("SELECT * FROM canon_entities WHERE novel_id=? ORDER BY kind, updated_at DESC").all(novelId) as Record<string, unknown>[]).map(entityFrom);
  const foreshadows = (sqlite.prepare("SELECT * FROM foreshadows WHERE novel_id=? ORDER BY CASE importance WHEN '高' THEN 0 WHEN '中' THEN 1 ELSE 2 END, created_at DESC").all(novelId) as Record<string, unknown>[]).map(camelize);
  const timeline = (sqlite.prepare("SELECT * FROM timeline_events WHERE novel_id=? ORDER BY sort_order, created_at").all(novelId) as Record<string, unknown>[]).map(camelize);
  const proposals = (sqlite.prepare("SELECT * FROM memory_proposals WHERE novel_id=? ORDER BY created_at DESC").all(novelId) as Record<string, unknown>[]).map(camelize);
  const publications = (sqlite.prepare("SELECT * FROM publication_records WHERE novel_id=? ORDER BY created_at DESC").all(novelId) as Record<string, unknown>[]).map(camelize);
  const facts = (sqlite.prepare("SELECT * FROM canon_facts WHERE novel_id=? AND status IN ('已确认','已锁定') ORDER BY updated_at DESC").all(novelId) as Record<string, unknown>[]).map(camelize);
  return { novel, volumes, arcs, chapters, canon, facts, foreshadows, timeline, proposals, publications };
}

export function camelize(row: Record<string, unknown>) {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) output[key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())] = value;
  return output;
}

export function createNovel(input: Record<string, unknown>) {
  const novelId = id(); const t = now();
  const genre = String(input.genre || "通用"); const title = String(input.title || "未命名作品");
  const profile = getFanqieGenreProfile(genre);
  const targetWords = Number(input.targetWords || profile.targetWords);
  const contract: Record<string, string> = {
    核心卖点: profile.corePromise,
    目标读者: profile.targetReaders,
    题材侧重: profile.focus,
    题材承诺: "围绕主要阅读体验持续兑现，不把短篇密度或热榜套路直接硬套进长篇",
  };
  if (genre === "四合院同人") Object.assign(contract, {
    核心卖点: "熟悉院落关系中的职业成长、红火生活与有证据的反制",
    目标读者: "喜欢年代生活、原作人物另一种可能和技术成长爽点的男频读者",
    题材承诺: "主线以原创职业事件推进，原作角色保留利益和性格逻辑，不照搬原剧情和台词",
    爽点结构: "技术成果、岗位待遇、住房物资、名声人脉和家庭关系必须产生可见收益",
    禁止偏航: "不全员降智，不无限囤货，不连续开会训人，不虚构政策、票证、工资和工业技术数据",
  });
  const planning = {
    番茄题材模板: genre,
    模板校准日期: FANQIE_PROFILE_UPDATED_AT,
    建议单章字数: `${profile.chapterWords.min}-${profile.chapterWords.max}`,
    默认单章目标: String(profile.chapterWords.target),
    预计章节: String(Math.max(30, Math.round(targetWords / profile.chapterWords.target))),
  };
  sqlite.prepare(`INSERT INTO novels (id,title,genre,stage,target_words,description,cover_color,contract,planning,model_overrides,version,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,1,?,?)`).run(novelId, title, genre, String(input.stage || "构思"), targetWords, String(input.description || ""), String(input.coverColor || "#376B5B"), JSON.stringify(contract), JSON.stringify(planning), "{}", t, t);
  ensureNovelPromptTemplates(novelId);
  const volumeId = id();
  sqlite.prepare("INSERT INTO volumes (id,novel_id,number,title,goal,conflict,turning_points,summary,version,created_at,updated_at) VALUES (?, ?, 1, '第一卷', '', '', '[]', '', 1, ?, ?)").run(volumeId, novelId, t, t);
  return getNovel(novelId);
}

export function updateNovel(novelId: string, input: Record<string, unknown>) {
  const current = getNovel(novelId); if (!current) return { kind: "missing" as const };
  if (Number(input.version) !== Number(current.version)) return { kind: "conflict" as const, current };
  const allowed = ["title", "genre", "stage", "targetWords", "description", "coverColor", "contract", "planning", "modelOverrides"] as const;
  const merged = { ...current } as Record<string, unknown>;
  for (const key of allowed) if (key in input) merged[key] = input[key];
  const t = now();
  sqlite.prepare(`UPDATE novels SET title=?,genre=?,stage=?,target_words=?,description=?,cover_color=?,contract=?,planning=?,model_overrides=?,version=version+1,updated_at=? WHERE id=?`)
    .run(merged.title, merged.genre, merged.stage, merged.targetWords, merged.description, merged.coverColor, JSON.stringify(merged.contract), JSON.stringify(merged.planning), JSON.stringify(merged.modelOverrides), t, novelId);
  return { kind: "ok" as const, novel: getNovel(novelId) };
}

export function createChapter(novelId: string, input: Record<string, unknown>) {
  const max = sqlite.prepare("SELECT COALESCE(MAX(number),0) max FROM chapters WHERE novel_id=?").get(novelId) as { max: number };
  const volume = sqlite.prepare("SELECT id FROM volumes WHERE novel_id=? ORDER BY number LIMIT 1").get(novelId) as { id: string } | undefined;
  const t = now(); const chapterId = id();
  sqlite.prepare(`INSERT INTO chapters (id,novel_id,volume_id,arc_id,number,title,status,outline,draft,current_version_id,summary,word_count,version,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,'{}','',NULL,'',0,1,?,?)`).run(chapterId, novelId, input.volumeId || volume?.id || null, input.arcId || null, max.max + 1, input.title || `第${max.max + 1}章 未命名`, "待策划", t, t);
  return chapterFrom(sqlite.prepare("SELECT * FROM chapters WHERE id=?").get(chapterId) as Record<string, unknown>);
}

export function updateChapter(chapterId: string, input: Record<string, unknown>) {
  const row = sqlite.prepare("SELECT * FROM chapters WHERE id=?").get(chapterId) as Record<string, unknown> | undefined;
  if (!row) return { kind: "missing" as const };
  const current = chapterFrom(row);
  if (Number(input.version) !== Number(current.version)) return { kind: "conflict" as const, current };
  if ("draft" in input && String(input.draft ?? "") !== String(current.draft ?? "")) {
    return { kind: "unsafe-draft" as const, current };
  }
  const merged = { ...current };
  for (const key of ["title", "status", "outline", "summary"] as const) if (key in input) merged[key] = input[key] as never;
  const draft = String(current.draft ?? ""); const t = now();
  sqlite.prepare(`UPDATE chapters SET title=?,status=?,outline=?,draft=?,summary=?,word_count=?,version=version+1,updated_at=? WHERE id=?`)
    .run(merged.title, merged.status, JSON.stringify(merged.outline), draft, merged.summary, countWords(draft), t, chapterId);
  sqlite.prepare("UPDATE chapter_working_drafts SET title=?,outline=?,base_version=base_version+1,updated_at=? WHERE chapter_id=? AND base_version=?")
    .run(merged.title, JSON.stringify(merged.outline), t, chapterId, current.version);
  sqlite.prepare("UPDATE novels SET updated_at=? WHERE id=?").run(t, current.novelId);
  return { kind: "ok" as const, chapter: chapterFrom(sqlite.prepare("SELECT * FROM chapters WHERE id=?").get(chapterId) as Record<string, unknown>) };
}

export function getWorkingDraft(chapterId: string) {
  const row = sqlite.prepare("SELECT * FROM chapter_working_drafts WHERE chapter_id=?").get(chapterId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return { chapterId: row.chapter_id, novelId: row.novel_id, title: row.title, content: row.content, outline: json(row.outline as string, {}), baseVersion: row.base_version, updatedAt: row.updated_at };
}

export function saveWorkingDraft(chapterId: string, input: Record<string, unknown>) {
  const chapter = sqlite.prepare("SELECT novel_id,version FROM chapters WHERE id=?").get(chapterId) as { novel_id: string; version: number } | undefined;
  if (!chapter) return { kind: "missing" as const };
  const baseVersion = Number(input.baseVersion);
  if (baseVersion !== chapter.version) return { kind: "conflict" as const, currentVersion: chapter.version, workingDraft: getWorkingDraft(chapterId) };
  const t = now();
  sqlite.prepare(`INSERT INTO chapter_working_drafts (chapter_id,novel_id,title,content,outline,base_version,updated_at) VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(chapter_id) DO UPDATE SET title=excluded.title,content=excluded.content,outline=excluded.outline,base_version=excluded.base_version,updated_at=excluded.updated_at`)
    .run(chapterId, chapter.novel_id, String(input.title || ""), String(input.content || ""), JSON.stringify(input.outline || {}), baseVersion, t);
  return { kind: "ok" as const, workingDraft: getWorkingDraft(chapterId) };
}

export function clearWorkingDraft(chapterId: string) { sqlite.prepare("DELETE FROM chapter_working_drafts WHERE chapter_id=?").run(chapterId); }

export function createVolume(novelId: string, input: Record<string, unknown>) {
  if (!getNovel(novelId)) return null;
  const max = sqlite.prepare("SELECT COALESCE(MAX(number),0) max FROM volumes WHERE novel_id=?").get(novelId) as { max: number };
  const volumeId = id(); const t = now();
  sqlite.prepare(`INSERT INTO volumes (id,novel_id,number,title,goal,conflict,turning_points,summary,version,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?, '',1,?,?)`).run(volumeId, novelId, Number(input.number || max.max + 1), String(input.title || `第${max.max + 1}卷`), String(input.goal || ""), String(input.conflict || ""), JSON.stringify(input.turningPoints || []), t, t);
  return camelize(sqlite.prepare("SELECT * FROM volumes WHERE id=?").get(volumeId) as Record<string, unknown>);
}

export function updateVolume(volumeId: string, input: Record<string, unknown>) {
  const row = sqlite.prepare("SELECT * FROM volumes WHERE id=?").get(volumeId) as Record<string, unknown> | undefined;
  if (!row) return { kind: "missing" as const };
  if (Number(input.version) !== Number(row.version)) return { kind: "conflict" as const, current: camelize(row) };
  sqlite.prepare("UPDATE volumes SET number=?,title=?,goal=?,conflict=?,turning_points=?,version=version+1,updated_at=? WHERE id=?")
    .run(Number(input.number ?? row.number), String(input.title ?? row.title), String(input.goal ?? row.goal), String(input.conflict ?? row.conflict), JSON.stringify(input.turningPoints ?? json(String(row.turning_points), [])), now(), volumeId);
  return { kind: "ok" as const, volume: camelize(sqlite.prepare("SELECT * FROM volumes WHERE id=?").get(volumeId) as Record<string, unknown>) };
}

export function deleteVolume(volumeId: string) {
  const row = sqlite.prepare("SELECT * FROM volumes WHERE id=?").get(volumeId) as Record<string, unknown> | undefined;
  if (!row) return { kind: "missing" as const };
  const chapters = (sqlite.prepare("SELECT COUNT(*) count FROM chapters WHERE volume_id=?").get(volumeId) as { count: number }).count;
  const arcs = (sqlite.prepare("SELECT COUNT(*) count FROM story_arcs WHERE volume_id=?").get(volumeId) as { count: number }).count;
  if (chapters || arcs) return { kind: "used" as const, chapters, arcs };
  sqlite.prepare("DELETE FROM volumes WHERE id=?").run(volumeId); return { kind: "ok" as const };
}

export function createArc(novelId: string, input: Record<string, unknown>) {
  const volume = sqlite.prepare("SELECT id FROM volumes WHERE id=? AND novel_id=?").get(input.volumeId, novelId);
  if (!volume) return null;
  const arcId = id(); const t = now();
  sqlite.prepare(`INSERT INTO story_arcs (id,novel_id,volume_id,title,goal,conflict,payoff,hooks,summary,version,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?, '',1,?,?)`).run(arcId, novelId, input.volumeId, String(input.title || "新情节弧"), String(input.goal || ""), String(input.conflict || ""), String(input.payoff || ""), String(input.hooks || ""), t, t);
  return camelize(sqlite.prepare("SELECT * FROM story_arcs WHERE id=?").get(arcId) as Record<string, unknown>);
}

export function updateArc(arcId: string, input: Record<string, unknown>) {
  const row = sqlite.prepare("SELECT * FROM story_arcs WHERE id=?").get(arcId) as Record<string, unknown> | undefined;
  if (!row) return { kind: "missing" as const };
  if (Number(input.version) !== Number(row.version)) return { kind: "conflict" as const, current: camelize(row) };
  sqlite.prepare("UPDATE story_arcs SET volume_id=?,title=?,goal=?,conflict=?,payoff=?,hooks=?,version=version+1,updated_at=? WHERE id=?")
    .run(input.volumeId ?? row.volume_id, input.title ?? row.title, input.goal ?? row.goal, input.conflict ?? row.conflict, input.payoff ?? row.payoff, input.hooks ?? row.hooks, now(), arcId);
  return { kind: "ok" as const, arc: camelize(sqlite.prepare("SELECT * FROM story_arcs WHERE id=?").get(arcId) as Record<string, unknown>) };
}

export function deleteArc(arcId: string) {
  const row = sqlite.prepare("SELECT * FROM story_arcs WHERE id=?").get(arcId) as Record<string, unknown> | undefined;
  if (!row) return { kind: "missing" as const };
  const chapters = (sqlite.prepare("SELECT COUNT(*) count FROM chapters WHERE arc_id=?").get(arcId) as { count: number }).count;
  if (chapters) return { kind: "used" as const, chapters };
  sqlite.prepare("DELETE FROM story_arcs WHERE id=?").run(arcId); return { kind: "ok" as const };
}

export function saveChapterVersion(chapterId: string, content: string, label: string, source = "manual") {
  const version = createChapterVersion(chapterId, content, label, source);
  if (!version) return null;
  acceptChapterVersion(chapterId, version.id);
  return version;
}

export function createChapterVersion(
  chapterId: string,
  content: string,
  label: string,
  source = "manual",
  frozenBase?: { revision: number; versionId: string | null },
) {
  const chapter = sqlite.prepare("SELECT * FROM chapters WHERE id=?").get(chapterId) as Record<string, unknown> | undefined;
  if (!chapter) return null;
  const versionId = id(); const t = now(); const words = countWords(content);
  const baseRevision = frozenBase?.revision ?? Number(chapter.version);
  const baseVersionId = frozenBase ? frozenBase.versionId : (chapter.current_version_id ? String(chapter.current_version_id) : null);
  sqlite.prepare(`INSERT INTO chapter_versions
    (id,novel_id,chapter_id,label,content,word_count,source,base_revision,base_version_id,created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(versionId, chapter.novel_id, chapterId, label, content, words, source, baseRevision, baseVersionId, t);
  return {
    id: versionId, chapterId, label, content, wordCount: words, source,
    baseRevision, baseVersionId,
    createdAt: t,
  };
}

export function acceptChapterVersion(chapterId: string, versionId: string) {
  return sqlite.transaction(() => {
    const version = sqlite.prepare("SELECT * FROM chapter_versions WHERE id=? AND chapter_id=?").get(versionId, chapterId) as Record<string, unknown> | undefined;
    const existing = sqlite.prepare("SELECT * FROM chapters WHERE id=?").get(chapterId) as Record<string, unknown> | undefined;
    if (!version || !existing) return { kind: "missing" as const };
    if (existing.current_version_id === versionId) return { kind: "already-current" as const, chapter: chapterFrom(existing) };
    if (
      version.base_revision == null
      || Number(version.base_revision) !== Number(existing.version)
      || (version.base_version_id == null ? existing.current_version_id != null : version.base_version_id !== existing.current_version_id)
    ) {
      return {
        kind: "stale" as const,
        chapter: chapterFrom(existing),
        baseRevision: version.base_revision == null ? null : Number(version.base_revision),
        baseVersionId: version.base_version_id == null ? null : String(version.base_version_id),
      };
    }
    const t = now();
    sqlite.prepare("UPDATE chapters SET draft=?,current_version_id=?,word_count=?,status='待复核',version=version+1,updated_at=? WHERE id=?")
      .run(version.content, versionId, version.word_count, t, chapterId);
    sqlite.prepare("DELETE FROM chapter_working_drafts WHERE chapter_id=?").run(chapterId);
    sqlite.prepare("UPDATE novels SET updated_at=? WHERE id=?").run(t, existing.novel_id);
    const chapter = sqlite.prepare("SELECT * FROM chapters WHERE id=?").get(chapterId) as Record<string, unknown>;
    return { kind: "accepted" as const, chapter: chapterFrom(chapter) };
  })();
}

export function updateChapterVersionContent(versionId: string, chapterId: string, content: string) {
  const version = sqlite.prepare("SELECT * FROM chapter_versions WHERE id=? AND chapter_id=?").get(versionId, chapterId) as Record<string, unknown> | undefined;
  if (!version) return null;
  const words = countWords(content);
  sqlite.prepare("UPDATE chapter_versions SET content=?, word_count=? WHERE id=?").run(content, words, versionId);
  return {
    id: versionId,
    chapterId,
    label: String(version.label),
    content,
    wordCount: words,
    source: String(version.source),
    baseRevision: version.base_revision == null ? null : Number(version.base_revision),
    baseVersionId: version.base_version_id == null ? null : String(version.base_version_id),
    createdAt: String(version.created_at),
  };
}

export function updateChapterSummary(chapterId: string, summary: string) {
  sqlite.prepare("UPDATE chapters SET summary=?,updated_at=? WHERE id=?").run(summary, now(), chapterId);
}

function syncStorySearch(novelId: string, entities: Record<string, unknown>[]) {
  const insert = sqlite.prepare("INSERT INTO story_search (novel_id,source_type,source_id,title,content) VALUES (?,?,?,?,?)");
  sqlite.transaction(() => {
    sqlite.prepare("DELETE FROM story_search WHERE novel_id=?").run(novelId);
    for (const entity of entities) insert.run(novelId, "canon", entity.id, entity.name, `${entity.kind} ${entity.name} ${entity.summary}`);
    for (const volume of sqlite.prepare("SELECT id,title,goal,conflict FROM volumes WHERE novel_id=?").all(novelId) as Record<string, unknown>[]) {
      insert.run(novelId, "volume", volume.id, volume.title, `${volume.goal} ${volume.conflict}`);
    }
    for (const arc of sqlite.prepare("SELECT id,title,goal,conflict,payoff,hooks FROM story_arcs WHERE novel_id=?").all(novelId) as Record<string, unknown>[]) {
      insert.run(novelId, "arc", arc.id, arc.title, `${arc.goal} ${arc.conflict} ${arc.payoff} ${arc.hooks}`);
    }
  })();
}

function relevantCanon(novelId: string, chapter: Record<string, unknown>, volumeNumber: number, recentText: string) {
  const entities = sqlite.prepare("SELECT * FROM canon_entities WHERE novel_id=?").all(novelId) as Record<string, unknown>[];
  syncStorySearch(novelId, entities);
  const chapterData = chapterFrom(chapter);
  const contextText = `${chapterData.title} ${JSON.stringify(chapterData.outline)} ${recentText}`;
  const namedEntities = entities.filter((entity) => contextText.includes(String(entity.name)));
  const ftsIds = new Set<string>();
  if (namedEntities.length) {
    const query = namedEntities.map((entity) => `"${String(entity.name).replaceAll('"', '""')}"`).join(" OR ");
    try {
      const matches = sqlite.prepare("SELECT source_id FROM story_search WHERE novel_id=? AND story_search MATCH ? LIMIT 30").all(novelId, query) as { source_id: string }[];
      for (const match of matches) ftsIds.add(match.source_id);
    } catch { /* structured ranking remains available if a vendor SQLite build tokenizes differently */ }
  }

  return entities
    .map((entity) => {
      const details = json<Record<string, unknown>>(entity.details as string, {});
      const entryVolume = Number(details.entryVolume || 0);
      let score = 0;
      if (ftsIds.has(String(entity.id))) score += 240;
      if (contextText.includes(String(entity.name))) score += 180;
      if (entity.locked) score += 45;
      if (["核心秘密", "目标结局"].includes(String(entity.kind))) score += 55;
      if (["世界规则", "文风规则", "禁止事项"].includes(String(entity.kind))) score += 40;
      if (entryVolume === volumeNumber) score += 100;
      else if (entryVolume > 0 && entryVolume < volumeNumber) score += Math.max(10, 45 - (volumeNumber - entryVolume) * 7);
      else if (entryVolume > volumeNumber) score -= 160;
      return { entity: entityFrom(entity), score, entryVolume };
    })
    .filter((item) => item.score > 0 && (!item.entryVolume || item.entryVolume <= volumeNumber))
    .sort((a, b) => b.score - a.score || String(a.entity.kind).localeCompare(String(b.entity.kind), "zh-CN"))
    .slice(0, 40)
    .map((item) => item.entity);
}

export function contextForChapter(chapterId: string) {
  const chapter = sqlite.prepare("SELECT * FROM chapters WHERE id=?").get(chapterId) as Record<string, unknown>;
  if (!chapter) return null;
  const novelId = String(chapter.novel_id);
  const novel = getNovel(novelId);
  const volume = chapter.volume_id ? sqlite.prepare("SELECT * FROM volumes WHERE id=? AND novel_id=?").get(chapter.volume_id, novelId) as Record<string, unknown> | undefined : undefined;
  const arc = chapter.arc_id ? sqlite.prepare("SELECT * FROM story_arcs WHERE id=? AND novel_id=?").get(chapter.arc_id, novelId) as Record<string, unknown> | undefined : undefined;
  const volumeNumber = Number(volume?.number || Math.ceil(Number(chapter.number) / 30));
  const recentRows = sqlite.prepare("SELECT number,title,summary,draft FROM chapters WHERE novel_id=? AND number<? ORDER BY number DESC LIMIT 5").all(novelId, chapter.number) as Record<string, unknown>[];
  const recent = recentRows.map((row) => ({ number: row.number, title: row.title, summary: row.summary || String(row.draft).slice(-600) }));
  const recentText = recent.map((row) => `${row.title} ${row.summary}`).join(" ");
  const canon = relevantCanon(novelId, chapter, volumeNumber, recentText);
  const canonIds = new Set(canon.map((item) => item.id));
  const facts = (sqlite.prepare(`SELECT f.*, e.name entity_name FROM canon_facts f
    LEFT JOIN canon_entities e ON e.id=f.entity_id
    WHERE f.novel_id=? AND f.status IN ('已确认','已锁定')
    ORDER BY CASE f.status WHEN '已锁定' THEN 0 ELSE 1 END, f.updated_at DESC LIMIT 120`).all(novelId) as Record<string, unknown>[])
    .filter((fact) => !fact.entity_id || canonIds.has(String(fact.entity_id)) || contextTextContainsFact(`${chapterFrom(chapter).title} ${JSON.stringify(chapterFrom(chapter).outline)} ${recentText}`, fact))
    .slice(0, 60)
    .map(camelize);
  const hooks = sqlite.prepare("SELECT title,description,target_chapter,importance FROM foreshadows WHERE novel_id=? AND status='未回收' AND (target_chapter IS NULL OR target_chapter>=?) ORDER BY CASE importance WHEN '高' THEN 0 WHEN '中' THEN 1 ELSE 2 END, target_chapter LIMIT 15").all(novelId, chapter.number);
  const timeline = sqlite.prepare(`SELECT t.time_label,t.title,t.description,c.number chapter_number FROM timeline_events t
    LEFT JOIN chapters c ON c.id=t.chapter_id WHERE t.novel_id=? AND (c.number IS NULL OR c.number<?)
    ORDER BY t.sort_order DESC,t.created_at DESC LIMIT 20`).all(novelId, chapter.number);
  const previousVolumes = sqlite.prepare("SELECT number,title,summary FROM volumes WHERE novel_id=? AND number<? AND summary<>'' ORDER BY number DESC LIMIT 3").all(novelId, volumeNumber);
  const previousArcs = sqlite.prepare(`SELECT a.title,a.summary FROM story_arcs a JOIN volumes v ON v.id=a.volume_id
    WHERE a.novel_id=? AND a.summary<>'' AND (v.number<? OR a.created_at<?) ORDER BY a.created_at DESC LIMIT 4`).all(novelId, volumeNumber, String(arc?.created_at || now()));
  return {
    novel,
    chapter: chapterFrom(chapter),
    volume: volume ? camelize(volume) : null,
    arc: arc ? camelize(arc) : null,
    canon,
    facts,
    hooks,
    timeline,
    recent,
    hierarchy: { previousVolumes, previousArcs, volumeSummary: volume?.summary || "", arcSummary: arc?.summary || "" },
    retrieval: { selectedCanon: canon.length, totalCanon: (sqlite.prepare("SELECT COUNT(*) count FROM canon_entities WHERE novel_id=?").get(novelId) as { count: number }).count, volumeNumber },
  };
}

function contextTextContainsFact(text: string, fact: Record<string, unknown>) {
  return [fact.entity_name, fact.key].some((value) => value && text.includes(String(value)));
}

export function consistencyCheck(chapterId: string, candidateText?: string) {
  const context = contextForChapter(chapterId); if (!context) return [];
  const outline = context.chapter.outline as Record<string, string | number>;
  const outlineText = JSON.stringify(outline);
  const inspectionText = candidateText === undefined ? outlineText : `${outlineText} ${candidateText}`;
  const checkedCanon = candidateText === undefined
    ? context.canon
    : (sqlite.prepare("SELECT * FROM canon_entities WHERE novel_id=?").all(String(context.novel?.id)) as Record<string, unknown>[]).map(entityFrom);
  const checkedFacts = candidateText === undefined
    ? context.facts as Record<string, unknown>[]
    : (sqlite.prepare(`SELECT f.*, e.name entity_name FROM canon_facts f LEFT JOIN canon_entities e ON e.id=f.entity_id
        WHERE f.novel_id=? AND f.status IN ('已确认','已锁定')`).all(String(context.novel?.id)) as Record<string, unknown>[]).map(camelize);
  const warnings: { level: "block" | "warning" | "info"; title: string; detail: string; evidence?: string }[] = [];
  const required = ["目标", "主视角", "冲突", "信息揭示", "爽点类型", "见证者", "即时奖励", "能力来源", "状态变化", "时间推进", "情绪点", "伏笔动作", "预期字数", "结尾钩子"];
  for (const key of required) {
    if (outline[key] === undefined || outline[key] === null || String(outline[key]).trim() === "") {
      warnings.push({ level: "block", title: `章纲缺少${key}`, detail: "补齐后才能生成正文。" });
    }
  }
  for (const item of checkedCanon) {
    const details = item.details as Record<string, unknown>;
    const entryVolume = Number(details.entryVolume || 0);
    if (entryVolume > context.retrieval.volumeNumber && inspectionText.includes(String(item.name))) {
      warnings.push({ level: "block", title: `角色提前登场：${item.name}`, detail: `该设定从第${entryVolume}卷进入，当前为第${context.retrieval.volumeNumber}卷。`, evidence: String(item.summary) });
    }
    if (item.locked && inspectionText.includes(String(item.name))) warnings.push({ level: "info", title: `锁定设定：${item.name}`, detail: String(item.summary) });
  }
  for (const fact of checkedFacts) {
    const value = String(fact.value || ""); const entityName = String(fact.entityName || "");
    if (entityName && /死亡|已死|阵亡|失踪且确认死亡/.test(value) && inspectionText.includes(entityName)) {
      warnings.push({ level: "block", title: `已死亡角色出场：${entityName}`, detail: value, evidence: String(fact.key || "人物状态") });
    }
  }
  const abilitySource = String(outline["能力来源"] || "");
  const mentionsUnexplainedNewAbility = /临时觉醒|突然获得|未知能力/.test(abilitySource)
    || (/新能力/.test(abilitySource) && !/不(?:使用|产生|新增|依赖)(?:任何)?新能力/.test(abilitySource));
  if (mentionsUnexplainedNewAbility) warnings.push({ level: "block", title: "能力来源不明确", detail: "能力必须指向已确认设定、已完成订单或本章明确交付条件。", evidence: abilitySource });
  const overdue = sqlite.prepare("SELECT title,target_chapter FROM foreshadows WHERE novel_id=? AND status='未回收' AND target_chapter<? ORDER BY target_chapter").all(String(context.novel?.id), Number(context.chapter.number)) as Record<string, unknown>[];
  for (const item of overdue.slice(0, 5)) warnings.push({ level: "warning", title: `伏笔已逾期：${item.title}`, detail: `原计划在第${item.target_chapter}章前回收，请改期或安排处理。` });
  warnings.push(...rhythmWarnings(String(context.novel?.id), Number(context.chapter.number), outline));
  return warnings;
}

function rhythmWarnings(novelId: string, chapterNumber: number, outline: Record<string, string | number>) {
  const rows = sqlite.prepare("SELECT number,outline FROM chapters WHERE novel_id=? AND number<? ORDER BY number DESC LIMIT 6").all(novelId, chapterNumber) as Record<string, unknown>[];
  const recent = rows.map((row) => ({ number: Number(row.number), outline: json<Record<string, string>>(String(row.outline), {}) }));
  const issues: { level: "warning"; title: string; detail: string; evidence?: string }[] = [];
  const payoff = String(outline["爽点类型"] || "").trim();
  const samePayoff = recent.filter((row) => row.outline["爽点类型"] === payoff);
  if (payoff && samePayoff.length >= 2) issues.push({ level: "warning", title: "爽点类型近期重复", detail: `最近6章已有${samePayoff.length}章使用“${payoff}”，建议改变兑现方式。`, evidence: samePayoff.map((x) => `第${x.number}章`).join("、") });
  const hook = String(outline["结尾钩子"] || "");
  const hookWords = hook.match(/[\u4e00-\u9fff]{2,}/g) || [];
  const similar = recent.find((row) => hookWords.some((word) => word.length >= 3 && String(row.outline["结尾钩子"] || "").includes(word)));
  if (similar) issues.push({ level: "warning", title: "结尾钩子可能重复", detail: `与第${similar.number}章使用相近悬念，请确保信息增量和危险升级。`, evidence: String(similar.outline["结尾钩子"] || "") });
  const emptyRewards = recent.filter((row) => !String(row.outline["即时奖励"] || "").trim()).length;
  if (emptyRewards >= 2 && !String(outline["即时奖励"] || "").trim()) issues.push({ level: "warning", title: "连续缺少实际兑现", detail: "连续章节没有能力、身份、金钱、关系或线索收益，容易形成压抑段。" });
  return issues;
}

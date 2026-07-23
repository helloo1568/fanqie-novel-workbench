import { describe, expect, it } from "vitest";
import archiver from "archiver";
import fs from "node:fs";
import path from "node:path";
import { PassThrough } from "node:stream";
import { countWords } from "./db.js";
import { id, now, sqlite } from "./db.js";
import { decryptSecret, encryptSecret } from "./crypto.js";
import { acceptCandidate, CandidateAcceptanceBlockedError, CandidateStaleError, applyChapterAnalysis, applyDeepPlanningCandidate, localQualityCheck, previewAnalysisPrompt, previewPrompt, selectTargetedRevisionIssues, startGeneration, startTargetedRevision, validateDeepPlanningCandidate } from "./ai.js";
import { knowledgePackInfo, retrieveKnowledge } from "./knowledge.js";
import { createSnapshot, currentDatabasePath, snapshotPreview } from "./backup.js";
import { importNovel } from "./importer.js";
import { acceptChapterVersion, clearWorkingDraft, consistencyCheck, contextForChapter, createArc, createChapterVersion, createNovel, createVolume, deleteArc, deleteVolume, getWorkingDraft, getWorkspace, saveWorkingDraft, updateChapter } from "./repository.js";

function cleanupNovel(novelId: string) {
  sqlite.transaction(() => {
    for (const table of ["publication_records", "memory_proposals", "foreshadows", "timeline_events", "canon_facts", "canon_entities", "chapter_versions", "chapter_working_drafts", "chapters", "story_arcs", "volumes", "generation_runs", "prompt_templates", "story_search"]) {
      sqlite.prepare(`DELETE FROM ${table} WHERE novel_id=?`).run(novelId);
    }
    sqlite.prepare("DELETE FROM novels WHERE id=?").run(novelId);
  })();
}

async function projectZip(project: Record<string, unknown>) {
  return new Promise<Buffer>((resolve, reject) => {
    const output = new PassThrough(); const chunks: Buffer[] = [];
    output.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    output.on("end", () => resolve(Buffer.concat(chunks)));
    output.on("error", reject);
    const archive = archiver("zip");
    archive.on("error", reject); archive.pipe(output);
    archive.append(JSON.stringify(project), { name: "project.json" });
    void archive.finalize();
  });
}

describe("中文创作领域逻辑", () => {
  it("按中文字符和英文词组统计字数", () => {
    expect(countWords("沈砚打开 door 13。" )).toBe(6);
    expect(countWords("第一章\n午夜十二点")).toBe(8);
  });

  it("质量检查返回证据与可执行建议", () => {
    const result = localQualityCheck("午夜，门没有响，柜台前却多了一个人。他不能回头，因为代价就在身后。忽然，有人叫出他的名字？");
    expect(result.total).toBeGreaterThan(70);
    expect(result.issues).toHaveLength(11);
    expect(result.issues.every((issue) => issue.evidence && issue.suggestion)).toBe(true);
    expect(result.issues.find((issue) => issue.dimension === "结尾钩子")?.score).toBeGreaterThan(80);
  });

  it("本地 API 密钥使用随机向量加密并可解密", () => {
    const secret = "local-test-secret-value";
    const first = encryptSecret(secret);
    const second = encryptSecret(secret);
    expect(first).not.toBe(secret);
    expect(first).not.toBe(second);
    expect(decryptSecret(first)).toBe(secret);
    expect(decryptSecret(second)).toBe(secret);
  });

  it("AI候选版本不会在接受前覆盖当前正文", () => {
    const novelId = id(); const chapterId = id(); const t = now();
    try {
      sqlite.prepare("INSERT INTO novels VALUES (?, '测试书', '通用', '构思', 10000, '', '#000000', '{}', '{}', '{}', 1, ?, ?)").run(novelId, t, t);
      sqlite.prepare("INSERT INTO chapters VALUES (?, ?, NULL, NULL, 1, '测试章', '章纲已确认', '{}', '原正文', NULL, '', 3, 1, ?, ?)").run(chapterId, novelId, t, t);
      const candidate = createChapterVersion(chapterId, "候选正文", "测试候选", "ai-candidate");
      expect(candidate).not.toBeNull();
      expect((sqlite.prepare("SELECT draft FROM chapters WHERE id=?").get(chapterId) as { draft: string }).draft).toBe("原正文");
      acceptChapterVersion(chapterId, candidate!.id);
      expect((sqlite.prepare("SELECT draft FROM chapters WHERE id=?").get(chapterId) as { draft: string }).draft).toBe("候选正文");
    } finally {
      sqlite.prepare("DELETE FROM chapter_versions WHERE novel_id=?").run(novelId);
      sqlite.prepare("DELETE FROM chapters WHERE novel_id=?").run(novelId);
      sqlite.prepare("DELETE FROM novels WHERE id=?").run(novelId);
    }
  });

  it("候选稿接受流程在硬冲突存在时拒绝修改正式正文", async () => {
    const novelId = id(); const chapterId = id(); const t = now();
    try {
      sqlite.prepare("INSERT INTO novels VALUES (?, '接受门禁测试', '通用', '构思', 10000, '', '#000000', '{}', '{}', '{}', 1, ?, ?)").run(novelId, t, t);
      sqlite.prepare("INSERT INTO chapters VALUES (?, ?, NULL, NULL, 1, '缺失章纲', '待策划', '{}', '原正文', NULL, '', 3, 1, ?, ?)").run(chapterId, novelId, t, t);
      const candidate = createChapterVersion(chapterId, "候选正文", "门禁候选", "ai-candidate")!;

      await expect(acceptCandidate(chapterId, candidate.id)).rejects.toBeInstanceOf(CandidateAcceptanceBlockedError);
      expect((sqlite.prepare("SELECT draft FROM chapters WHERE id=?").get(chapterId) as { draft: string }).draft).toBe("原正文");
    } finally {
      sqlite.prepare("DELETE FROM chapter_versions WHERE novel_id=?").run(novelId);
      sqlite.prepare("DELETE FROM chapters WHERE novel_id=?").run(novelId);
      sqlite.prepare("DELETE FROM novels WHERE id=?").run(novelId);
    }
  });

  it("候选稿正文独有的设定冲突也会阻止接受", async () => {
    const novelId = id(); const chapterId = id(); const entityId = id(); const t = now();
    const outline = Object.fromEntries(["目标", "主视角", "冲突", "信息揭示", "爽点类型", "见证者", "即时奖励", "能力来源", "状态变化", "时间推进", "情绪点", "伏笔动作", "预期字数", "结尾钩子"].map((key) => [key, key === "预期字数" ? 2000 : "已填写"]));
    try {
      sqlite.prepare("INSERT INTO novels VALUES (?, '候选正文冲突测试', '通用', '构思', 10000, '', '#000000', '{}', '{}', '{}', 1, ?, ?)").run(novelId, t, t);
      sqlite.prepare("INSERT INTO chapters VALUES (?, ?, NULL, NULL, 1, '完整章纲', '章纲已确认', ?, '原正文', NULL, '', 3, 1, ?, ?)").run(chapterId, novelId, JSON.stringify(outline), t, t);
      sqlite.prepare("INSERT INTO canon_entities VALUES (?, ?, '人物', '迟到角色', '第三卷才登场', ?, 1, 1, ?, ?)").run(entityId, novelId, JSON.stringify({ entryVolume: 3 }), t, t);
      const candidate = createChapterVersion(chapterId, "迟到角色推门走了进来。", "冲突候选", "ai-candidate")!;

      expect(consistencyCheck(chapterId).some((issue) => issue.level === "block")).toBe(false);
      await expect(acceptCandidate(chapterId, candidate.id)).rejects.toBeInstanceOf(CandidateAcceptanceBlockedError);
      expect((sqlite.prepare("SELECT draft FROM chapters WHERE id=?").get(chapterId) as { draft: string }).draft).toBe("原正文");
    } finally { cleanupNovel(novelId); }
  });

  it("严格字数模式会阻止接受超出范围的AI候选稿", async () => {
    const novelId = id(); const chapterId = id(); const t = now();
    const outline = Object.fromEntries(["目标", "主视角", "冲突", "信息揭示", "爽点类型", "见证者", "即时奖励", "能力来源", "状态变化", "时间推进", "情绪点", "伏笔动作", "结尾钩子"].map((key) => [key, "已填写"]));
    Object.assign(outline, { 字数下限: 10, 预期字数: 15, 字数上限: 20, 字数限制: "严格" });
    try {
      sqlite.prepare("INSERT INTO novels VALUES (?, '严格字数测试', '都市脑洞', '构思', 10000, '', '#000000', '{}', '{}', '{}', 1, ?, ?)").run(novelId, t, t);
      sqlite.prepare("INSERT INTO chapters VALUES (?, ?, NULL, NULL, 1, '严格字数章', '章纲已确认', ?, '原正文', NULL, '', 3, 1, ?, ?)").run(chapterId, novelId, JSON.stringify(outline), t, t);
      const candidate = createChapterVersion(chapterId, "太短", "超限候选", "ai-candidate")!;

      await expect(acceptCandidate(chapterId, candidate.id)).rejects.toMatchObject({
        issues: expect.arrayContaining([expect.objectContaining({ title: "候选正文超出严格字数范围" })]),
      });
      expect((sqlite.prepare("SELECT draft FROM chapters WHERE id=?").get(chapterId) as { draft: string }).draft).toBe("原正文");
    } finally { cleanupNovel(novelId); }
  });

  it("重复接受同一候选稿不会重复推进版本或分析", async () => {
    const novelId = id(); const chapterId = id(); const t = now();
    const outline = Object.fromEntries(["目标", "主视角", "冲突", "信息揭示", "爽点类型", "见证者", "即时奖励", "能力来源", "状态变化", "时间推进", "情绪点", "伏笔动作", "预期字数", "结尾钩子"].map((key) => [key, key === "预期字数" ? 2000 : "已填写"]));
    try {
      sqlite.prepare("INSERT INTO novels VALUES (?, '幂等接受测试', '通用', '构思', 10000, '', '#000000', '{}', '{}', '{}', 1, ?, ?)").run(novelId, t, t);
      sqlite.prepare("INSERT INTO chapters VALUES (?, ?, NULL, NULL, 1, '完整章纲', '章纲已确认', ?, '原正文', NULL, '', 3, 1, ?, ?)").run(chapterId, novelId, JSON.stringify(outline), t, t);
      const candidate = createChapterVersion(chapterId, "只应分析一次的候选正文。", "幂等候选", "ai-candidate")!;

      const first = acceptChapterVersion(chapterId, candidate.id);
      const afterFirst = sqlite.prepare("SELECT version FROM chapters WHERE id=?").get(chapterId) as { version: number };
      const proposalsAfterFirst = (sqlite.prepare("SELECT COUNT(*) count FROM memory_proposals WHERE chapter_id=?").get(chapterId) as { count: number }).count;
      const second = await acceptCandidate(chapterId, candidate.id);
      const third = await acceptCandidate(chapterId, candidate.id);

      expect(first.kind).toBe("accepted");
      expect(second?.alreadyAccepted).toBe(true);
      expect(third?.alreadyAccepted).toBe(true);
      expect((sqlite.prepare("SELECT version FROM chapters WHERE id=?").get(chapterId) as { version: number }).version).toBe(afterFirst.version);
      expect((sqlite.prepare("SELECT COUNT(*) count FROM memory_proposals WHERE chapter_id=?").get(chapterId) as { count: number }).count).toBe(proposalsAfterFirst);
    } finally { cleanupNovel(novelId); }
  });

  it("候选稿记录正式稿基础版本，并拒绝覆盖其后更新的正式稿", async () => {
    const novelId = id(); const chapterId = id(); const t = now();
    const outline = Object.fromEntries(["目标", "主视角", "冲突", "信息揭示", "爽点类型", "见证者", "即时奖励", "能力来源", "状态变化", "时间推进", "情绪点", "伏笔动作", "预期字数", "结尾钩子"].map((key) => [key, key === "预期字数" ? 2000 : "已填写"]));
    try {
      sqlite.prepare("INSERT INTO novels VALUES (?, '过期候选测试', '通用', '构思', 10000, '', '#000000', '{}', '{}', '{}', 1, ?, ?)").run(novelId, t, t);
      sqlite.prepare("INSERT INTO chapters VALUES (?, ?, NULL, NULL, 1, '完整章纲', '章纲已确认', ?, '第一版正式稿', NULL, '', 7, 3, ?, ?)").run(chapterId, novelId, JSON.stringify(outline), t, t);
      const staleCandidate = createChapterVersion(chapterId, "基于第一版生成的候选", "迟到候选", "ai-candidate")!;
      const candidateRow = sqlite.prepare("SELECT base_revision,base_version_id FROM chapter_versions WHERE id=?").get(staleCandidate.id) as { base_revision: number; base_version_id: string | null };
      expect(candidateRow).toEqual({ base_revision: 3, base_version_id: null });

      const newerFormal = createChapterVersion(chapterId, "第二版正式稿", "人工正式保存", "manual")!;
      expect(acceptChapterVersion(chapterId, newerFormal.id).kind).toBe("accepted");

      await expect(acceptCandidate(chapterId, staleCandidate.id)).rejects.toBeInstanceOf(CandidateStaleError);
      const current = sqlite.prepare("SELECT draft,current_version_id FROM chapters WHERE id=?").get(chapterId) as { draft: string; current_version_id: string | null };
      expect(current).toEqual({ draft: "第二版正式稿", current_version_id: newerFormal.id });
    } finally { cleanupNovel(novelId); }
  });

  it("缺少基础版本信息的旧候选稿会被安全拒绝", async () => {
    const novelId = id(); const chapterId = id(); const candidateId = id(); const t = now();
    const outline = Object.fromEntries(["目标", "主视角", "冲突", "信息揭示", "爽点类型", "见证者", "即时奖励", "能力来源", "状态变化", "时间推进", "情绪点", "伏笔动作", "预期字数", "结尾钩子"].map((key) => [key, key === "预期字数" ? 2000 : "已填写"]));
    try {
      sqlite.prepare("INSERT INTO novels VALUES (?, '旧候选测试', '通用', '构思', 10000, '', '#000000', '{}', '{}', '{}', 1, ?, ?)").run(novelId, t, t);
      sqlite.prepare("INSERT INTO chapters VALUES (?, ?, NULL, NULL, 1, '完整章纲', '章纲已确认', ?, '正式稿', NULL, '', 3, 1, ?, ?)").run(chapterId, novelId, JSON.stringify(outline), t, t);
      sqlite.prepare("INSERT INTO chapter_versions (id,novel_id,chapter_id,label,content,word_count,source,created_at) VALUES (?,?,?,?,?,?,?,?)")
        .run(candidateId, novelId, chapterId, "迁移前候选", "未知基础候选", 6, "ai-candidate", t);

      await expect(acceptCandidate(chapterId, candidateId)).rejects.toBeInstanceOf(CandidateStaleError);
      expect((sqlite.prepare("SELECT draft FROM chapters WHERE id=?").get(chapterId) as { draft: string }).draft).toBe("正式稿");
    } finally { cleanupNovel(novelId); }
  });

  it("生成任务启动后正式稿变化，持久化候选仍保留启动时的冻结基础", async () => {
    const novelId = id(); const chapterId = id(); const t = now();
    const outline = Object.fromEntries(["目标", "主视角", "冲突", "信息揭示", "爽点类型", "见证者", "即时奖励", "能力来源", "状态变化", "时间推进", "情绪点", "伏笔动作", "预期字数", "结尾钩子"].map((key) => [key, key === "预期字数" ? 2000 : "已填写"]));
    const providers = sqlite.prepare("SELECT id,enabled FROM providers").all() as Array<{ id: string; enabled: number }>;
    try {
      sqlite.prepare("UPDATE providers SET enabled=0").run();
      sqlite.prepare("INSERT INTO novels VALUES (?, '生成冻结基础测试', '通用', '构思', 10000, '', '#000000', '{}', '{}', '{}', 1, ?, ?)").run(novelId, t, t);
      sqlite.prepare("INSERT INTO chapters VALUES (?, ?, NULL, NULL, 1, '完整章纲', '章纲已确认', ?, '第一版正式稿', NULL, '', 7, 1, ?, ?)").run(chapterId, novelId, JSON.stringify(outline), t, t);

      const run = startGeneration({ novelId, chapterId, taskType: "正文" });
      const runBase = sqlite.prepare("SELECT base_revision,base_version_id FROM generation_runs WHERE id=?").get(run.runId) as { base_revision: number; base_version_id: string | null };
      expect(runBase).toEqual({ base_revision: 1, base_version_id: null });

      const newerFormal = createChapterVersion(chapterId, "生成期间保存的第二版", "人工正式保存", "manual")!;
      expect(acceptChapterVersion(chapterId, newerFormal.id).kind).toBe("accepted");

      let candidate: { id: string; base_revision: number | null; base_version_id: string | null } | undefined;
      await expect.poll(() => (sqlite.prepare("SELECT status,error FROM generation_runs WHERE id=?").get(run.runId) as { status: string; error: string | null } | undefined)?.status, { timeout: 5_000 }).toBe("待审核");
      await expect.poll(() => {
        candidate = sqlite.prepare("SELECT id,base_revision,base_version_id FROM chapter_versions WHERE chapter_id=? AND source='ai-candidate' ORDER BY created_at DESC LIMIT 1").get(chapterId) as typeof candidate;
        return candidate?.id;
      }, { timeout: 5_000 }).toBeTruthy();
      expect(candidate).toMatchObject({ base_revision: 1, base_version_id: null });
      await expect(acceptCandidate(chapterId, candidate!.id)).rejects.toBeInstanceOf(CandidateStaleError);
      expect((sqlite.prepare("SELECT current_version_id FROM chapters WHERE id=?").get(chapterId) as { current_version_id: string }).current_version_id).toBe(newerFormal.id);
    } finally {
      cleanupNovel(novelId);
      const restore = sqlite.prepare("UPDATE providers SET enabled=? WHERE id=?");
      for (const provider of providers) restore.run(provider.enabled, provider.id);
    }
  });

  it("空章纲被一致性预检阻止", () => {
    const novelId = id(); const chapterId = id(); const t = now();
    try {
      sqlite.prepare("INSERT INTO novels VALUES (?, '测试书', '通用', '构思', 10000, '', '#000000', '{}', '{}', '{}', 1, ?, ?)").run(novelId, t, t);
      sqlite.prepare("INSERT INTO chapters VALUES (?, ?, NULL, NULL, 1, '空章纲', '待策划', '{}', '', NULL, '', 0, 1, ?, ?)").run(chapterId, novelId, t, t);
      const issues = consistencyCheck(chapterId);
      expect(issues.filter((issue) => issue.level === "block").length).toBeGreaterThanOrEqual(14);
    } finally {
      sqlite.prepare("DELETE FROM chapters WHERE novel_id=?").run(novelId);
      sqlite.prepare("DELETE FROM novels WHERE id=?").run(novelId);
    }
  });

  it("已确认事实进入后续章节上下文", () => {
    const novelId = id(); const chapterId = id(); const t = now(); const factId = id();
    try {
      sqlite.prepare("INSERT INTO novels VALUES (?, '测试书', '通用', '构思', 10000, '', '#000000', '{}', '{}', '{}', 1, ?, ?)").run(novelId, t, t);
      sqlite.prepare("INSERT INTO chapters VALUES (?, ?, NULL, NULL, 2, '后续章', '章纲已确认', '{}', '', NULL, '', 0, 1, ?, ?)").run(chapterId, novelId, t, t);
      sqlite.prepare("INSERT INTO canon_facts VALUES (?, ?, NULL, '主角.伤势', '左臂骨折未愈', '已确认', NULL, NULL, ?, ?)").run(factId, novelId, t, t);
      const context = contextForChapter(chapterId);
      expect(context?.facts.some((fact) => fact.key === "主角.伤势" && fact.value === "左臂骨折未愈")).toBe(true);
    } finally {
      sqlite.prepare("DELETE FROM canon_facts WHERE novel_id=?").run(novelId);
      sqlite.prepare("DELETE FROM chapters WHERE novel_id=?").run(novelId);
      sqlite.prepare("DELETE FROM novels WHERE id=?").run(novelId);
    }
  });

  it("确认章纲只更新元数据，保留正式正文、历史版本和恢复稿", () => {
    const novelId = id(); const chapterId = id(); const t = now();
    try {
      sqlite.prepare("INSERT INTO novels VALUES (?, '工作稿测试', '通用', '构思', 10000, '', '#000000', '{}', '{}', '{}', 1, ?, ?)").run(novelId, t, t);
      sqlite.prepare("INSERT INTO chapters VALUES (?, ?, NULL, NULL, 1, '第一章', '正文草稿', '{}', '正式内容', NULL, '', 4, 1, ?, ?)").run(chapterId, novelId, t, t);
      const saved = saveWorkingDraft(chapterId, { title: "第一章", content: "未提交内容", outline: {}, baseVersion: 1 });
      expect(saved.kind).toBe("ok");
      expect(getWorkingDraft(chapterId)?.content).toBe("未提交内容");
      expect((sqlite.prepare("SELECT draft FROM chapters WHERE id=?").get(chapterId) as { draft: string }).draft).toBe("正式内容");
      const versionsBefore = (sqlite.prepare("SELECT COUNT(*) count FROM chapter_versions WHERE chapter_id=?").get(chapterId) as { count: number }).count;
      expect(updateChapter(chapterId, { version: 1, title: "确认后的标题", status: "章纲已确认", outline: { 目标: "推进主线" }, summary: "" }).kind).toBe("ok");
      expect((sqlite.prepare("SELECT draft FROM chapters WHERE id=?").get(chapterId) as { draft: string }).draft).toBe("正式内容");
      expect((sqlite.prepare("SELECT COUNT(*) count FROM chapter_versions WHERE chapter_id=?").get(chapterId) as { count: number }).count).toBe(versionsBefore);
      expect(getWorkingDraft(chapterId)?.content).toBe("未提交内容");
      expect(saveWorkingDraft(chapterId, { title: "第一章", content: "过期内容", outline: {}, baseVersion: 1 }).kind).toBe("conflict");
      clearWorkingDraft(chapterId); expect(getWorkingDraft(chapterId)).toBeNull();
    } finally { cleanupNovel(novelId); }
  });

  it("分卷和情节弧支持增删改与关联删除保护", () => {
    const novel = createNovel({ title: "大纲CRUD测试" })!; const novelId = String(novel.id);
    try {
      const volume = createVolume(novelId, { title: "第二卷", goal: "测试目标" })!;
      const arc = createArc(novelId, { volumeId: volume.id, title: "测试弧" })!;
      expect(deleteArc(String(arc.id)).kind).toBe("ok");
      const usedArc = createArc(novelId, { volumeId: volume.id, title: "关联弧" })!;
      const chapterId = id(); const t = now();
      sqlite.prepare("INSERT INTO chapters VALUES (?, ?, ?, ?, 1, '关联章', '待策划', '{}', '', NULL, '', 0, 1, ?, ?)").run(chapterId, novelId, volume.id, usedArc.id, t, t);
      expect(deleteArc(String(usedArc.id)).kind).toBe("used");
      expect(deleteVolume(String(volume.id)).kind).toBe("used");
      sqlite.prepare("DELETE FROM chapters WHERE id=?").run(chapterId);
      expect(deleteArc(String(usedArc.id)).kind).toBe("ok");
      expect(deleteVolume(String(volume.id)).kind).toBe("ok");
    } finally { cleanupNovel(novelId); }
  });

  it("小说级提示词会进入最终上下文预览", () => {
    const novel = createNovel({ title: "提示词测试" })!; const novelId = String(novel.id); const chapterId = id(); const promptId = id(); const t = now();
    try {
      const volume = sqlite.prepare("SELECT id FROM volumes WHERE novel_id=? LIMIT 1").get(novelId) as { id: string };
      sqlite.prepare("INSERT INTO chapters VALUES (?, ?, ?, NULL, 1, '预览章', '章纲已确认', '{}', '', NULL, '', 0, 1, ?, ?)").run(chapterId, novelId, volume.id, t, t);
      sqlite.prepare("INSERT INTO prompt_templates VALUES (?, 'novel', ?, '正文', '测试规则', '每章必须完成一次可见兑现。', 1, ?)").run(promptId, novelId, t);
      expect(previewPrompt(chapterId, "正文")?.prompt).toContain("每章必须完成一次可见兑现。");
    } finally { cleanupNovel(novelId); }
  });

  it("正文预览以场景优先取代机械兑现清单", () => {
    const novel = createNovel({ title: "正文场景规则测试", genre: "都市脑洞" })!;
    const novelId = String(novel.id); const chapterId = id(); const t = now();
    try {
      const volume = sqlite.prepare("SELECT id FROM volumes WHERE novel_id=? LIMIT 1").get(novelId) as { id: string };
      sqlite.prepare("INSERT INTO chapters VALUES (?, ?, ?, NULL, 1, '场景章', '章纲已确认', '{}', '', NULL, '', 0, 1, ?, ?)").run(chapterId, novelId, volume.id, t, t);
      const prose = previewPrompt(chapterId, "正文")!.prompt;
      expect(prose).toContain("场景优先");
      expect(prose).toContain("动作、对白和环境已经表达的信息");
      expect(prose).not.toContain("本章70%进度前兑现");
      expect(prose).not.toContain("明确写出见证者反应");
    } finally { cleanupNovel(novelId); }
  });

  it("定点二稿在没有可用供应商时不会创建候选版本", async () => {
    const novel = createNovel({ title: "定点二稿无供应商测试", genre: "都市脑洞" })!;
    const novelId = String(novel.id); const chapterId = id(); const t = now();
    const providers = sqlite.prepare("SELECT id,enabled FROM providers").all() as Array<{ id: string; enabled: number }>;
    try {
      const volume = sqlite.prepare("SELECT id FROM volumes WHERE novel_id=? LIMIT 1").get(novelId) as { id: string };
      sqlite.prepare("INSERT INTO chapters VALUES (?, ?, ?, NULL, 1, '二稿章', '章纲已确认', '{}', '', NULL, '', 0, 1, ?, ?)").run(chapterId, novelId, volume.id, t, t);
      const source = createChapterVersion(chapterId, "他攥紧拳头，转身离开。", "AI正文候选稿", "ai-candidate")!;
      sqlite.prepare("UPDATE providers SET enabled=0").run();

      await expect(startTargetedRevision({ novelId, chapterId, sourceVersionId: source.id })).rejects.toThrow("供应商未保存API密钥");
      expect(sqlite.prepare("SELECT COUNT(*) count FROM chapter_versions WHERE chapter_id=?").get(chapterId)).toEqual({ count: 1 });
    } finally {
      cleanupNovel(novelId);
      const restore = sqlite.prepare("UPDATE providers SET enabled=? WHERE id=?");
      for (const provider of providers) restore.run(provider.enabled, provider.id);
    }
  });

  it("定点二稿只保留带正文证据的低分问题", () => {
    const selected = selectTargetedRevisionIssues([
      { dimension: "机械化文风", score: 58, evidence: "第2段总结了动作", suggestion: "删掉总结", position: "第2段" },
      { dimension: "重复表达", score: 67, evidence: "“盯着”重复", suggestion: "改为动作差异", position: "第3段" },
      { dimension: "人物动机", score: 74, evidence: "主角没有选择理由", suggestion: "补一个具体取舍", position: "中段" },
      { dimension: "节奏", score: 82, evidence: "场景推进正常", suggestion: "保持", position: "全章" },
      { dimension: "信息密度", score: 62, evidence: "", suggestion: "无证据不处理", position: "开头" },
    ]);
    expect(selected.map((issue) => issue.dimension)).toEqual(["机械化文风", "重复表达", "人物动机"]);
  });

  it("内置番茄写作知识包按任务与章节检索并进入提示词", () => {
    const info = knowledgePackInfo();
    expect(info.available).toBe(true);
    expect(info.skills).toHaveLength(12);
    const selected = retrieveKnowledge({ taskType: "正文", genre: "四合院同人", chapterNumber: 1, instruction: "重写黄金三章并检查节奏" });
    expect(selected.map((item) => item.slug)).toContain("fanqie-golden-three");
    expect(selected.map((item) => item.slug)).toContain("fanqie-genre-length-calibration");

    const novel = createNovel({ title: "知识包提示词测试", genre: "四合院同人" })!;
    const novelId = String(novel.id); const chapterId = id(); const t = now();
    try {
      const volume = sqlite.prepare("SELECT id FROM volumes WHERE novel_id=? LIMIT 1").get(novelId) as { id: string };
      sqlite.prepare("INSERT INTO chapters VALUES (?, ?, ?, NULL, 1, '黄金开篇', '章纲已确认', '{}', '', NULL, '', 0, 1, ?, ?)").run(chapterId, novelId, volume.id, t, t);
      const prose = previewPrompt(chapterId, "正文", "检查黄金三章")?.prompt || "";
      const facts = previewAnalysisPrompt(chapterId, "事实抽取", "测试正文") || "";
      const quality = previewAnalysisPrompt(chapterId, "质检", "测试正文") || "";
      for (const prompt of [prose, facts, quality]) expect(prompt).toContain("番茄长篇写作知识包");
      expect(prose).toContain("fanqie-golden-three");
      expect(quality).toContain("fanqie-pace-triad");
    } finally { cleanupNovel(novelId); }
  });

  it("深度开书候选分区审批后非破坏入库", () => {
    const novel = createNovel({ title: "深度开书测试", genre: "都市脑洞", targetWords: 900000 })!;
    const novelId = String(novel.id); const runId = id(); const t = now();
    const canonKinds = ["人物", "人物", "地点", "势力", "世界规则", "能力物品", "禁止事项", "目标结局"];
    const proposal = {
      kind: "deep-planning-candidate", baseVersion: 1, interview: { idea: "维修异能" },
      positioning: { title: "修复万物后我升职了", titleOptions: ["修复万物后我升职了", "我能看见故障", "开局抢修主设备"], pitch: "维修工凭有限诊断能力解决工业难题并承担更大责任", targetReaders: "都市职业成长读者", corePromise: "技术成果带来现实身份变化", differentiation: "能力只给线索不替代操作", protagonistDesire: "成为能独立负责设备的工程师", coreConflict: "技术责任与资源限制", driver: "接触设备后获得有限故障线索", endingDirection: "建成自主设备体系", blurb: "一次停机事故改变了他的岗位。", goldenThree: ["发现危机", "完成诊断", "资格落袋"] },
      structure: {
        canon: canonKinds.map((kind, index) => ({ kind, name: `设定${index + 1}`, summary: `设定说明${index + 1}`, locked: index >= 4 })),
        volumes: [1, 2, 3].map((number) => ({ number, title: `第${number}卷`, goal: `完成阶段目标${number}`, conflict: `阶段冲突${number}`, turningPoints: [`转折${number}A`, `转折${number}B`], summary: `卷末状态${number}`, arcs: [{ title: `情节弧${number}`, goal: `弧目标${number}`, conflict: `弧冲突${number}`, payoff: `弧兑现${number}`, hooks: `弧钩子${number}` }] })),
        foreshadows: [1, 2, 3].map((number) => ({ title: `伏笔${number}`, description: `伏笔说明${number}`, targetChapter: number * 10, importance: number === 1 ? "高" : "中" })),
      },
      chapters: [1, 2, 3].map((number) => ({ number, title: `测试章${number}`, volumeNumber: 1, arcTitle: "情节弧1", outline: { goal: `目标${number}`, viewpoint: "主角", conflict: `冲突${number}`, reveal: `揭示${number}`, emotion: `情绪${number}`, foreshadow: `伏笔动作${number}`, expectedWords: 2600, hook: `钩子${number}`, witness: `见证者${number}`, reward: `奖励${number}`, abilitySource: "有限故障线索", stateChange: `状态变化${number}` } })),
      audit: { score: 88, strengths: ["边界清晰"], blockers: [], issues: [] }, localAudit: { score: 100, blockers: [], warnings: [] },
    };
    try {
      expect(validateDeepPlanningCandidate(proposal).success).toBe(true);
      sqlite.prepare("INSERT INTO generation_runs (id,novel_id,chapter_id,task_type,status,output,prompt_version,created_at,updated_at) VALUES (?,?,NULL,'深度开书','待审核',?,'deep-plan-v1',?,?)")
        .run(runId, novelId, JSON.stringify(proposal), t, t);
      const applied = applyDeepPlanningCandidate({ novelId, runId, version: 1 });
      expect(applied.kind).toBe("ok");
      expect((sqlite.prepare("SELECT COUNT(*) count FROM volumes WHERE novel_id=?").get(novelId) as { count: number }).count).toBe(3);
      expect((sqlite.prepare("SELECT COUNT(*) count FROM chapters WHERE novel_id=?").get(novelId) as { count: number }).count).toBe(3);
      expect((sqlite.prepare("SELECT COUNT(*) count FROM canon_entities WHERE novel_id=?").get(novelId) as { count: number }).count).toBe(8);
      expect((sqlite.prepare("SELECT title,version FROM novels WHERE id=?").get(novelId) as { title: string; version: number })).toEqual({ title: "修复万物后我升职了", version: 2 });
      expect(applyDeepPlanningCandidate({ novelId, runId, version: 1 }).kind).not.toBe("ok");
    } finally { cleanupNovel(novelId); }
  });

  it("四合院模板与专项规则覆盖正文、事实抽取和质检", () => {
    const novel = createNovel({ title: "四合院模板测试", genre: "四合院同人" })!;
    const novelId = String(novel.id); const chapterId = id(); const t = now();
    try {
      expect(novel.contract).toMatchObject({
        题材承诺: expect.stringContaining("不照搬原剧情和台词"),
        爽点结构: expect.stringContaining("可见收益"),
        禁止偏航: expect.stringContaining("不全员降智"),
      });
      const volume = sqlite.prepare("SELECT id FROM volumes WHERE novel_id=? LIMIT 1").get(novelId) as { id: string };
      sqlite.prepare("INSERT INTO chapters VALUES (?, ?, ?, NULL, 1, '报废机床', '章纲已确认', '{}', '', NULL, '', 0, 1, ?, ?)").run(chapterId, novelId, volume.id, t, t);
      sqlite.prepare("INSERT INTO prompt_templates VALUES (?, 'novel', ?, '正文', '正文专项', '职业结果必须形成可见收益。', 1, ?)").run(id(), novelId, t);
      sqlite.prepare("INSERT INTO prompt_templates VALUES (?, 'novel', ?, '事实抽取', '事实专项', '精确年代数据仅在正文明示时入库。', 1, ?)").run(id(), novelId, t);
      sqlite.prepare("INSERT INTO prompt_templates VALUES (?, 'novel', ?, '质检', '质检专项', '检查原作人物是否为打脸而降智。', 1, ?)").run(id(), novelId, t);

      const prose = previewPrompt(chapterId, "正文")?.prompt || "";
      const facts = previewAnalysisPrompt(chapterId, "事实抽取", "测试正文") || "";
      const quality = previewAnalysisPrompt(chapterId, "质检", "测试正文") || "";
      for (const prompt of [prose, facts, quality]) {
        expect(prompt).toContain("四合院同人专项规则");
        expect(prompt).toContain("模型没有联网检索权限");
      }
      expect(prose).toContain("职业结果必须形成可见收益");
      expect(facts).toContain("精确年代数据仅在正文明示时入库");
      expect(quality).toContain("检查原作人物是否为打脸而降智");
    } finally { cleanupNovel(novelId); }
  });

  it("都市脑洞新书自动带入真人化正文与质检规则", () => {
    const novel = createNovel({ title: "都市真人化模板测试", genre: "都市脑洞" })!;
    const novelId = String(novel.id);
    try {
      const templates = sqlite.prepare("SELECT task_type,content FROM prompt_templates WHERE novel_id=? ORDER BY task_type").all(novelId) as Array<{ task_type: string; content: string }>;
      expect(templates).toEqual(expect.arrayContaining([
        expect.objectContaining({ task_type: "正文", content: expect.stringContaining("未解释动作") }),
        expect.objectContaining({ task_type: "质检", content: expect.stringContaining("潜台词") }),
      ]));
    } finally { cleanupNovel(novelId); }
  });

  it("打开既有都市脑洞作品时补齐缺失的真人化规则", () => {
    const novel = createNovel({ title: "既有都市规则补齐测试", genre: "都市脑洞" })!;
    const novelId = String(novel.id);
    try {
      sqlite.prepare("DELETE FROM prompt_templates WHERE novel_id=?").run(novelId);
      getWorkspace(novelId);
      const templates = sqlite.prepare("SELECT task_type,content FROM prompt_templates WHERE novel_id=? ORDER BY task_type").all(novelId) as Array<{ task_type: string; content: string }>;
      expect(templates).toEqual(expect.arrayContaining([
        expect.objectContaining({ task_type: "正文", content: expect.stringContaining("未解释动作") }),
        expect.objectContaining({ task_type: "质检", content: expect.stringContaining("潜台词") }),
      ]));
    } finally { cleanupNovel(novelId); }
  });

  it("支持TXT、JSON和ZIP小说包导入且重映射ID", async () => {
    const imported: string[] = [];
    const project = { novel: { title: "项目包测试", genre: "都市脑洞" }, volumes: [{ id: "v1", number: 1, title: "开端" }], chapters: [{ id: "c1", volumeId: "v1", number: 1, title: "异常来电", draft: "程野接到了一通不存在的电话。" }] };
    try {
      const textImport = await importNovel({ format: "txt", filename: "短篇.txt", content: "第一章 起点\n第一段。\n第二章 升级\n第二段。" }); imported.push(textImport.novelId);
      expect(textImport.chapters).toBe(2);
      const jsonImport = await importNovel({ format: "json", content: JSON.stringify(project) }); imported.push(jsonImport.novelId);
      expect((sqlite.prepare("SELECT COUNT(*) count FROM chapters WHERE novel_id=?").get(jsonImport.novelId) as { count: number }).count).toBe(1);
      const zip = await projectZip(project);
      const zipImport = await importNovel({ format: "zip", content: zip.toString("base64") }); imported.push(zipImport.novelId);
      expect((sqlite.prepare("SELECT title FROM chapters WHERE novel_id=?").get(zipImport.novelId) as { title: string }).title).toBe("异常来电");
      expect(new Set(imported).size).toBe(3);
    } finally { for (const novelId of imported) cleanupNovel(novelId); }
  });

  it("在线快照可通过完整性检查并预览计数", async () => {
    const snapshot = await createSnapshot("测试预览");
    try {
      const preview = snapshotPreview(snapshot.id);
      expect(preview?.integrity).toBe("ok");
      expect(preview?.novels).toBeGreaterThanOrEqual(1);
      expect(preview?.chapters).toBeGreaterThanOrEqual(1);
    } finally {
      sqlite.prepare("DELETE FROM snapshots WHERE id=?").run(snapshot.id);
      fs.rmSync(path.join(path.dirname(currentDatabasePath), "snapshots", snapshot.filename), { force: true });
    }
  });

  it("接受正稿后自动归档长期记忆、时间线和伏笔回收，只保留冲突待确认", () => {
    const novel = createNovel({ title: "自动记忆测试", genre: "都市脑洞" })!;
    const novelId = String(novel.id); const chapterId = id(); const versionId = id(); const t = now();
    try {
      const volume = sqlite.prepare("SELECT id FROM volumes WHERE novel_id=? LIMIT 1").get(novelId) as { id: string };
      sqlite.prepare("INSERT INTO chapters VALUES (?, ?, ?, NULL, 8, ?, ?, '{}', ?, ?, '', 100, 1, ?, ?)")
        .run(chapterId, novelId, volume.id, "第八章", "正文已确认", "正文", versionId, t, t);
      sqlite.prepare("INSERT INTO foreshadows VALUES (?, ?, ?, ?, NULL, 8, NULL, ?, ?, ?, ?)")
        .run(id(), novelId, "旧钥匙", "第三章埋下的钥匙", "未回收", "高", t, t);

      applyChapterAnalysis(chapterId, versionId, {
        summary: "主角用旧钥匙打开仓库，并确认新的联络地点。",
        facts: [
          { type: "新增事实", title: "主角.联络地点", afterValue: "旧仓库", evidence: "他把旧仓库定为联络点。" },
          { type: "冲突", title: "主角.年龄", beforeValue: "20", afterValue: "22", evidence: "正文出现两个年龄。" },
        ],
        timeline: [{ timeLabel: "当晚", title: "打开仓库", description: "主角进入旧仓库" }],
        foreshadows: [{ action: "回收", title: "旧钥匙", description: "钥匙打开仓库", evidence: "钥匙正好插进锁孔。" }],
      });

      expect((sqlite.prepare("SELECT value,status FROM canon_facts WHERE novel_id=? AND key=?").get(novelId, "主角.联络地点") as { value: string; status: string })).toEqual({ value: "旧仓库", status: "已确认" });
      expect((sqlite.prepare("SELECT COUNT(*) count FROM timeline_events WHERE chapter_id=?").get(chapterId) as { count: number }).count).toBe(1);
      expect((sqlite.prepare("SELECT status,resolved_chapter_id FROM foreshadows WHERE novel_id=? AND title=?").get(novelId, "旧钥匙") as { status: string; resolved_chapter_id: string })).toEqual({ status: "已回收", resolved_chapter_id: chapterId });
      expect((sqlite.prepare("SELECT type,status FROM memory_proposals WHERE chapter_id=?").all(chapterId) as Array<{ type: string; status: string }>)).toEqual([{ type: "冲突", status: "待确认" }]);
    } finally { cleanupNovel(novelId); }
  });
});

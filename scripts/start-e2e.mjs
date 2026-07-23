import path from "node:path";

const dataDir = path.resolve(process.env.NOVEL_WORKBENCH_DATA_DIR || "");
const testRoot = path.resolve(process.cwd(), "test-results");
if (!dataDir.startsWith(`${testRoot}${path.sep}`)) {
  throw new Error("E2E data directory must be isolated under test-results");
}

const { sqlite, now } = await import("../dist-server/server/db.js");
const novelId = "a623886a-5338-45f7-a1ad-4bdd6658d958";
const candidateNovelId = "245ae0db-4ce7-477b-a4e9-ebe77ca7ca17";
const t = now();

sqlite.transaction(() => {
  for (const table of [
    "story_search", "publication_records", "snapshots", "generation_runs", "memory_proposals",
    "timeline_events", "foreshadows", "canon_facts", "canon_entities", "chapter_working_drafts",
    "chapter_versions", "chapters", "story_arcs", "volumes", "prompt_templates", "novels",
    "providers", "settings",
  ]) sqlite.prepare(`DELETE FROM ${table}`).run();

  const insertNovel = sqlite.prepare("INSERT INTO novels VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)");
  insertNovel.run(novelId, "端到端测试作品", "都市脑洞", "筹备", 300000, "仅用于自动化测试", "#376B5B", JSON.stringify({ 核心卖点: "测试长篇工作流", 目标读者: "自动化测试" }), JSON.stringify({ 默认单章目标: "2500", 建议单章字数: "2200-3000" }), "{}", t, t);
  insertNovel.run(candidateNovelId, "候选稿测试作品", "年代", "筹备", 100000, "仅用于自动化测试", "#8A5A44", "{}", JSON.stringify({ 默认单章目标: "2500", 建议单章字数: "2200-3000" }), "{}", t, t);

  const insertVolume = sqlite.prepare("INSERT INTO volumes (id,novel_id,number,title,goal,conflict,turning_points,summary,version,created_at,updated_at) VALUES (?, ?, 1, '第一卷', '', '', '[]', '', 1, ?, ?)");
  insertVolume.run("e2e-volume-main", novelId, t, t);
  insertVolume.run("e2e-volume-candidate", candidateNovelId, t, t);

  const insertChapter = sqlite.prepare("INSERT INTO chapters VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, '', ?, 1, ?, ?)");
  for (let number = 1; number <= 6; number += 1) {
    const chapterId = `e2e-chapter-${number}`;
    const draft = number === 1 ? "第一章正式正文。正文证据，后续内容。" : "";
    const versionId = number === 1 ? "e2e-formal-1" : null;
    const outline = { 目标: `推进测试阶段${number}`, 主视角: "测试主角", 冲突: "测试冲突", 信息揭示: "测试信息", 爽点类型: "测试兑现", 见证者: "测试见证者", 即时奖励: "测试奖励", 能力来源: "测试来源", 状态变化: "测试状态变化", 时间推进: "第一天", 情绪点: "测试情绪", 伏笔动作: "测试伏笔", 结尾钩子: "测试钩子", 预期字数: 2500 };
    insertChapter.run(chapterId, novelId, "e2e-volume-main", number, `测试章节${number}`, number === 1 ? "章纲已确认" : "待策划", JSON.stringify(outline), draft, versionId, draft.length, t, t);
  }
  sqlite.prepare("INSERT INTO chapter_versions (id,novel_id,chapter_id,label,content,word_count,source,base_revision,base_version_id,created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run("e2e-formal-1", novelId, "e2e-chapter-1", "初始正式正文", "第一章正式正文。正文证据，后续内容。", 19, "manual", 1, null, t);

  insertChapter.run("e2e-candidate-chapter", candidateNovelId, "e2e-volume-candidate", 1, "待采用章节", "章纲已确认", JSON.stringify({ 目标: "验证候选稿恢复", 主视角: "测试主角", 冲突: "测试冲突", 信息揭示: "测试信息", 爽点类型: "测试兑现", 见证者: "测试见证者", 即时奖励: "测试奖励", 能力来源: "测试来源", 状态变化: "测试状态变化", 时间推进: "第一天", 情绪点: "测试情绪", 伏笔动作: "测试伏笔", 结尾钩子: "测试钩子", 预期字数: 2500 }), "", null, 0, t, t);
  sqlite.prepare("INSERT INTO chapter_versions (id,novel_id,chapter_id,label,content,word_count,source,base_revision,base_version_id,created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run("e2e-pending-candidate", candidateNovelId, "e2e-candidate-chapter", "待采用 AI 正文", "这是一份尚未写入正式正文的候选内容。", 18, "ai-candidate", 1, null, t);

  sqlite.prepare("INSERT INTO canon_entities VALUES (?, ?, '人物', '测试主角', '用于验证上下文展示', '{}', 1, 1, ?, ?)").run("e2e-canon", novelId, t, t);
  sqlite.prepare("INSERT INTO foreshadows VALUES (?, ?, '测试伏笔', '用于验证伏笔上下文', ?, 6, NULL, '未回收', '中', ?, ?)").run("e2e-foreshadow", novelId, "e2e-chapter-1", t, t);
  sqlite.prepare("INSERT INTO timeline_events VALUES (?, ?, ?, '第一天', '测试事件', '用于验证时间线', 1, ?, ?)").run("e2e-event", novelId, "e2e-chapter-1", t, t);
})();

await import("../dist-server/server/index.js");

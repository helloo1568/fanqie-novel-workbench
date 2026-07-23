import { describe, expect, it } from "vitest";
import type { Chapter } from "@shared/types";
import { selectRelatedContext } from "./ContextDrawer";
import type { Workspace } from "../workbench/useWorkbench";

const chapter = (id: string, number: number, overrides: Partial<Chapter> = {}): Chapter => ({
  id,
  novelId: "novel-1",
  volumeId: "volume-1",
  arcId: "arc-1",
  number,
  title: `第${number}章`,
  status: "正文草稿",
  outline: {},
  draft: "",
  currentVersionId: null,
  summary: `第${number}章摘要`,
  wordCount: 0,
  version: 1,
  updatedAt: `2026-07-${String(number).padStart(2, "0")}T00:00:00.000Z`,
  ...overrides,
});

function workspace(): Workspace {
  const chapters = Array.from({ length: 9 }, (_, index) => chapter(`chapter-${index + 1}`, index + 1));
  chapters[4] = chapter("chapter-5", 5, {
    title: "林舟进入钟楼",
    draft: "林舟发现怀表正在倒转。",
    outline: { 目标: "查清钟楼异常", 相关人物: "林舟" },
  });
  return {
    novel: {
      id: "novel-1", title: "测试小说", genre: "悬疑", stage: "连载", targetWords: 100_000,
      currentWords: 0, chapterCount: 9, description: "", coverColor: "#000", contract: {}, planning: {},
      modelOverrides: {}, version: 1, createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-16T00:00:00.000Z",
    },
    volumes: [],
    arcs: [{ id: "arc-1", title: "钟楼弧", updatedAt: "2026-07-10T00:00:00.000Z" }],
    chapters,
    canon: [
      { id: "entity-lin", novelId: "novel-1", kind: "人物", name: "林舟", summary: "调查员", details: {}, locked: false, version: 1, updatedAt: "2026-07-15T00:00:00.000Z" },
      { id: "entity-watch", novelId: "novel-1", kind: "能力物品", name: "怀表", summary: "会倒转", details: { arcId: "arc-1" }, locked: true, version: 1, updatedAt: "2026-07-14T00:00:00.000Z" },
      { id: "entity-other", novelId: "novel-1", kind: "地点", name: "海港", summary: "无关地点", details: {}, locked: false, version: 1, updatedAt: "2026-07-13T00:00:00.000Z" },
    ],
    facts: [
      { id: "fact-1", entityId: "entity-lin", key: "身份", value: "调查员", sourceChapterId: "chapter-2", updatedAt: "2026-07-15T00:00:00.000Z" },
      { id: "fact-2", entityId: "entity-other", key: "天气", value: "晴", updatedAt: "2026-07-14T00:00:00.000Z" },
    ],
    foreshadows: Array.from({ length: 7 }, (_, index) => ({
      id: `hook-${index}`, title: index === 0 ? "倒转的怀表" : `钟楼伏笔${index}`, description: "钟楼相关",
      plantedChapterId: index === 0 ? "chapter-5" : undefined, targetChapter: 5 + index, status: "未回收",
      updatedAt: `2026-07-${String(15 - index).padStart(2, "0")}T00:00:00.000Z`,
    })),
    timeline: [{ id: "event-1", chapterId: "chapter-5", timeLabel: "午夜", title: "进入钟楼", description: "钟声响起", updatedAt: "2026-07-15T00:00:00.000Z" }],
    proposals: [], publications: [],
  };
}

describe("selectRelatedContext", () => {
  it("ranks direct, entity and text references while capping each section", () => {
    const data = selectRelatedContext(workspace(), workspace().chapters[4]);
    expect(data.canon.map((item) => item.id)).toEqual(["entity-watch", "entity-lin"]);
    expect(data.facts.map((item) => item.id)).toEqual(["fact-1"]);
    expect(data.foreshadows[0]?.id).toBe("hook-0");
    expect(data.foreshadows).toHaveLength(5);
    expect(data.timeline.map((item) => item.id)).toEqual(["event-1"]);
  });

  it("returns only the two chapters before and after the current chapter", () => {
    const data = selectRelatedContext(workspace(), workspace().chapters[4]);
    expect(data.adjacentChapters.map((item) => item.id)).toEqual(["chapter-3", "chapter-4", "chapter-6", "chapter-7"]);
  });
});

import { describe, expect, it } from "vitest";
import type { Chapter, ChapterVersion } from "@shared/types";
import { findLatestCandidate, isCandidateStale } from "./ChapterEditor";
import { versionDisplayName } from "./ChapterVersions";

const chapter: Chapter = {
  id: "chapter-1",
  novelId: "novel-1",
  volumeId: null,
  arcId: null,
  number: 1,
  title: "第一章",
  status: "待复核",
  outline: {},
  draft: "后来保存的旧工作稿",
  currentVersionId: "manual-current",
  summary: "",
  wordCount: 9,
  version: 37,
  updatedAt: "2026-07-19T06:14:19.526Z",
};

const versions: ChapterVersion[] = [
  {
    id: "manual-current",
    chapterId: chapter.id,
    label: "手动正稿",
    content: chapter.draft,
    wordCount: 9,
    source: "manual",
    baseRevision: 36,
    baseVersionId: "manual-previous",
    createdAt: "2026-07-19T06:14:19.526Z",
  },
  {
    id: "ai-latest",
    chapterId: chapter.id,
    label: "AI正文候选稿",
    content: "完整的 AI 正文",
    wordCount: 3728,
    source: "ai-candidate",
    baseRevision: 35,
    baseVersionId: "manual-previous",
    createdAt: "2026-07-19T06:13:48.006Z",
  },
  {
    id: "ai-older",
    chapterId: chapter.id,
    label: "更早的 AI 候选稿",
    content: "旧候选",
    wordCount: 3,
    source: "ai-candidate",
    baseRevision: 1,
    baseVersionId: null,
    createdAt: "2026-07-18T06:13:48.006Z",
  },
];

describe("chapter candidate recovery", () => {
  it("keeps the latest AI candidate visible after a newer manual save", () => {
    expect(findLatestCandidate(versions, chapter.currentVersionId, "", chapter.draft)?.id).toBe("ai-latest");
    expect(isCandidateStale(versions[1], chapter)).toBe(true);
  });

  it("does not fall back to an older candidate after the latest one is dismissed", () => {
    expect(findLatestCandidate(versions, chapter.currentVersionId, "ai-latest", chapter.draft)).toBeUndefined();
  });

  it("hides an accepted candidate instead of exposing an older one", () => {
    const accepted = { ...chapter, currentVersionId: "ai-latest", draft: versions[1].content };
    expect(findLatestCandidate(versions, accepted.currentVersionId, "", accepted.draft)).toBeUndefined();
    expect(isCandidateStale(versions[1], accepted)).toBe(true);
  });

  it("recognizes a candidate generated from the current formal revision", () => {
    const currentCandidate = { ...versions[1], baseRevision: chapter.version, baseVersionId: chapter.currentVersionId };
    expect(isCandidateStale(currentCandidate, chapter)).toBe(false);
  });
});

describe("chapter history labels", () => {
  it("marks the active version as the current formal manuscript", () => {
    expect(versionDisplayName(versions[0], "manual-current")).toBe("当前正式稿");
  });

  it("shows readable source names instead of raw internal labels", () => {
    expect(versionDisplayName(versions[0], null)).toBe("手动保存");
    expect(versionDisplayName(versions[1], null)).toBe("AI 候选稿");
  });
});

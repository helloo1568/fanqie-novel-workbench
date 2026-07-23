import { useEffect, useMemo, useRef } from "react";
import type { Chapter } from "@shared/types";
import type { WorkspaceRecord } from "../workbench/useWorkbench";
import { useGlobalGenerationStatus } from "../workbench/useChapterSession";

interface ChapterNavigatorProps {
  volumes: WorkspaceRecord[];
  arcs: WorkspaceRecord[];
  chapters: Chapter[];
  selectedChapterId: string;
  onSelect: (chapterId: string) => void;
  selectionDisabled?: boolean;
}

interface ChapterGroup {
  id: string;
  title: string;
  arcs: Array<{ id: string; title: string; chapters: Chapter[] }>;
  chapters: Chapter[];
}

function text(record: WorkspaceRecord, key: string) {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

function number(record: WorkspaceRecord, key: string) {
  const value = record[key];
  return typeof value === "number" ? value : Number(value || 0);
}

function chapterState(chapter: Chapter, selectedChapterId: string, generating: boolean) {
  return {
    current: chapter.id === selectedChapterId,
    draft: chapter.status === "正文草稿" || Boolean(chapter.draft.trim()),
    qualityWarning: chapter.status === "待复核",
    published: chapter.status === "已发布",
    generating,
  };
}

export function ChapterNavigator({ volumes, arcs, chapters, selectedChapterId, onSelect, selectionDisabled = false }: ChapterNavigatorProps) {
  const selectedRef = useRef<HTMLButtonElement | null>(null);
  const globalGenerations = useGlobalGenerationStatus();
  const generatingByChapter = useMemo(() => {
    const map = new Map<string, string>(); // chapterId → phase
    for (const entry of globalGenerations) {
      if (entry.status === "starting" || entry.status === "streaming" || entry.status === "stopping") {
        map.set(entry.chapterId, entry.phase);
      }
    }
    return map;
  }, [globalGenerations]);
  const groups = useMemo<ChapterGroup[]>(() => {
    const sortedVolumes = [...volumes].sort((a, b) => number(a, "number") - number(b, "number"));
    const sortedArcs = [...arcs].sort((a, b) => number(a, "number") - number(b, "number"));
    const sortedChapters = [...chapters].sort((a, b) => a.number - b.number);
    const volumeGroups = sortedVolumes.map((volume) => {
      const volumeId = text(volume, "id");
      const volumeArcs = sortedArcs.filter((arc) => text(arc, "volumeId") === volumeId);
      return {
        id: volumeId,
        title: text(volume, "title") || "未命名分卷",
        arcs: volumeArcs.map((arc) => {
          const arcId = text(arc, "id");
          return {
            id: arcId,
            title: text(arc, "title") || "未命名情节弧",
            chapters: sortedChapters.filter((chapter) => chapter.arcId === arcId),
          };
        }),
        chapters: sortedChapters.filter((chapter) => chapter.volumeId === volumeId && !chapter.arcId),
      };
    });
    const assignedIds = new Set(volumeGroups.flatMap((group) => [
      ...group.chapters.map((chapter) => chapter.id),
      ...group.arcs.flatMap((arc) => arc.chapters.map((chapter) => chapter.id)),
    ]));
    const unassigned = sortedChapters.filter((chapter) => !assignedIds.has(chapter.id));
    if (unassigned.length) volumeGroups.push({ id: "unassigned", title: "未分组章节", arcs: [], chapters: unassigned });
    return volumeGroups;
  }, [arcs, chapters, volumes]);

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedChapterId]);

  const renderChapter = (chapter: Chapter) => {
    const generatingPhase = generatingByChapter.get(chapter.id);
    const state = chapterState(chapter, selectedChapterId, Boolean(generatingPhase));
    const labels = [
      state.current ? "当前" : "",
      state.generating ? "生成中" : "",
      state.draft ? "草稿" : "",
      state.qualityWarning ? "待复核" : "",
      state.published ? "已发布" : "",
    ].filter(Boolean);
    const stateNames = [
      state.current ? "current" : "",
      state.generating ? "generating" : "",
      state.draft ? "draft" : "",
      state.qualityWarning ? "quality-warning" : "",
      state.published ? "published" : "",
    ].filter(Boolean);
    return <button
      aria-current={state.current ? "true" : undefined}
      className={`chapter-nav-item${state.current ? " is-current" : ""}${state.generating ? " is-generating" : ""}${state.draft ? " has-draft" : ""}${state.qualityWarning ? " has-quality-warning" : ""}${state.published ? " is-published" : ""}`}
      data-chapter-id={chapter.id}
      data-state={stateNames.join(" ")}
      disabled={selectionDisabled && !state.current}
      key={chapter.id}
      onClick={() => onSelect(chapter.id)}
      ref={state.current ? selectedRef : undefined}
      title={state.generating ? generatingPhase : undefined}
      type="button"
    >
      <span className="chapter-nav-title"><span>{chapter.number}.</span> {chapter.title}</span>
      <span className="chapter-nav-meta"><span>{labels.join(" · ") || chapter.status}</span><span>{chapter.wordCount} 字</span></span>
    </button>;
  };

  return <aside className="chapter-navigator panel" aria-label="作品章节目录">
    <div className="panel-head"><h2>章节目录</h2><span className="badge">{chapters.length}</span></div>
    <div className="chapter-nav-scroll">
      {groups.map((group) => <section className="chapter-nav-volume" key={group.id}>
        <h3>{group.title}</h3>
        {group.arcs.map((arc) => <div className="chapter-nav-arc" key={arc.id}>
          <h4>{arc.title}</h4>
          {arc.chapters.map(renderChapter)}
        </div>)}
        {group.chapters.map(renderChapter)}
      </section>)}
    </div>
  </aside>;
}

export default ChapterNavigator;

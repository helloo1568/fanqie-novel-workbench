import { Link } from "react-router-dom";
import type { CanonEntity, Chapter } from "@shared/types";
import type { Workspace, WorkspaceRecord } from "../workbench/useWorkbench";
import ContextSection from "./ContextSection";

const MAX_ITEMS = 5;

interface RankedRecord {
  record: WorkspaceRecord;
  score: number;
  index: number;
}

export interface RelatedContext {
  canon: CanonEntity[];
  facts: WorkspaceRecord[];
  foreshadows: WorkspaceRecord[];
  timeline: WorkspaceRecord[];
  adjacentChapters: Chapter[];
}

function stringValue(record: WorkspaceRecord, key: string) {
  const value = record[key];
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function numberValue(record: WorkspaceRecord, key: string) {
  const value = Number(record[key]);
  return Number.isFinite(value) ? value : null;
}

function recordText(record: WorkspaceRecord) {
  return Object.values(record)
    .filter((value) => typeof value === "string" || typeof value === "number")
    .join(" ");
}

function chapterText(chapter: Chapter) {
  return `${chapter.title} ${chapter.summary} ${chapter.draft} ${JSON.stringify(chapter.outline)}`;
}

function references(text: string, value: unknown) {
  const candidate = typeof value === "string" ? value.trim() : "";
  return candidate.length > 1 && text.includes(candidate);
}

function timestamp(record: WorkspaceRecord | CanonEntity | Chapter) {
  const value = "updatedAt" in record ? record.updatedAt : undefined;
  const time = value ? new Date(String(value)).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}

function sortRanked(items: RankedRecord[]) {
  return items
    .sort((left, right) => right.score - left.score || timestamp(right.record) - timestamp(left.record) || left.index - right.index)
    .slice(0, MAX_ITEMS)
    .map((item) => item.record);
}

/** Selects compact context from the already loaded workspace without another request. */
export function selectRelatedContext(workspace: Workspace, chapter: Chapter): RelatedContext {
  const text = chapterText(chapter);
  const currentArc = workspace.arcs.find((arc) => stringValue(arc, "id") === chapter.arcId);
  const arcText = currentArc ? recordText(currentArc) : "";

  const canonScores = new Map<string, number>();
  const canon = workspace.canon
    .map((entity, index) => {
      let score = 0;
      if (references(text, entity.name)) score += 120;
      if (references(text, entity.id)) score += 160;
      if (chapter.arcId && (entity.details.arcId === chapter.arcId || references(arcText, entity.name))) score += 70;
      if (references(text, entity.summary)) score += 35;
      canonScores.set(entity.id, score);
      return { entity, score, index };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || timestamp(right.entity) - timestamp(left.entity) || left.index - right.index)
    .slice(0, MAX_ITEMS)
    .map((item) => item.entity);

  const facts = sortRanked(workspace.facts.map((record, index) => {
    let score = 0;
    if (stringValue(record, "sourceChapterId") === chapter.id || stringValue(record, "chapterId") === chapter.id) score += 180;
    const entityId = stringValue(record, "entityId");
    if (entityId && (canonScores.get(entityId) ?? 0) > 0) score += 110;
    if (references(text, stringValue(record, "key"))) score += 50;
    if (references(text, stringValue(record, "value"))) score += 35;
    return { record, score, index };
  }).filter((item) => item.score > 0));

  const foreshadows = sortRanked(workspace.foreshadows.map((record, index) => {
    let score = 0;
    if (["plantedChapterId", "resolvedChapterId", "chapterId"].some((key) => stringValue(record, key) === chapter.id)) score += 200;
    if (chapter.arcId && stringValue(record, "arcId") === chapter.arcId) score += 150;
    if (references(text, stringValue(record, "title")) || references(text, stringValue(record, "description"))) score += 90;
    const target = numberValue(record, "targetChapter");
    if (target !== null && Math.abs(target - chapter.number) <= 5) score += 70 - Math.abs(target - chapter.number) * 8;
    if (stringValue(record, "status") === "未回收") score += 10;
    return { record, score, index };
  }).filter((item) => item.score > 10));

  const timeline = sortRanked(workspace.timeline.map((record, index) => {
    let score = 0;
    if (stringValue(record, "chapterId") === chapter.id) score += 200;
    if (chapter.arcId && stringValue(record, "arcId") === chapter.arcId) score += 140;
    if (references(text, stringValue(record, "title")) || references(text, stringValue(record, "description"))) score += 80;
    return { record, score, index };
  }).filter((item) => item.score > 0));

  const adjacentChapters = workspace.chapters
    .filter((item) => item.id !== chapter.id && Math.abs(item.number - chapter.number) <= 2)
    .sort((left, right) => left.number - right.number)
    .slice(0, MAX_ITEMS);

  return { canon, facts, foreshadows, timeline, adjacentChapters };
}

function formatUpdated(value: unknown) {
  if (!value) return "时间未记录";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "时间未记录";
  return `更新于 ${date.toLocaleDateString("zh-CN")}`;
}

function chapterSource(workspace: Workspace, record: WorkspaceRecord) {
  const id = stringValue(record, "sourceChapterId") || stringValue(record, "chapterId") || stringValue(record, "plantedChapterId");
  const source = workspace.chapters.find((chapter) => chapter.id === id);
  return source ? `来源：第${source.number}章` : "来源：故事设定";
}

function ContextItem({ title, detail, source, updatedAt, to }: { title: string; detail?: string; source: string; updatedAt?: unknown; to?: string }) {
  const content = <>
    <strong>{title || "未命名内容"}</strong>
    {detail && <p>{detail}</p>}
    <span>{source} · {formatUpdated(updatedAt)}</span>
  </>;
  return <li>{to ? <Link className="context-item-link" to={to}>{content}</Link> : <div className="context-item-link">{content}</div>}</li>;
}

export interface ContextDrawerProps {
  novelId: string;
  workspace: Workspace;
  chapter: Chapter;
}

export function ContextDrawer({ novelId, workspace, chapter }: ContextDrawerProps) {
  const related = selectRelatedContext(workspace, chapter);
  return <div className="related-context" data-testid="related-context">
    <div className="related-context-heading">
      <div><span>当前章节</span><h2>相关上下文</h2></div>
      <span className="badge">第 {chapter.number} 章</span>
    </div>
    <ContextSection title="人物与设定" count={related.canon.length} allTo={`/novel/${novelId}/canon`}>
      {related.canon.map((entity) => <ContextItem key={entity.id} title={entity.name} detail={`${entity.kind} · ${entity.summary || "暂无摘要"}`} source="来源：故事圣经" updatedAt={entity.updatedAt}/>) }
    </ContextSection>
    <ContextSection title="已确认事实" count={related.facts.length} allTo={`/novel/${novelId}/canon`}>
      {related.facts.map((fact, index) => <ContextItem key={stringValue(fact, "id") || index} title={stringValue(fact, "key")} detail={stringValue(fact, "value")} source={chapterSource(workspace, fact)} updatedAt={fact.updatedAt}/>) }
    </ContextSection>
    <ContextSection title="相关伏笔" count={related.foreshadows.length} allTo={`/novel/${novelId}/timeline`}>
      {related.foreshadows.map((item, index) => <ContextItem key={stringValue(item, "id") || index} title={stringValue(item, "title")} detail={stringValue(item, "description")} source={chapterSource(workspace, item)} updatedAt={item.updatedAt}/>) }
    </ContextSection>
    <ContextSection title="时间线" count={related.timeline.length} allTo={`/novel/${novelId}/timeline`}>
      {related.timeline.map((item, index) => <ContextItem key={stringValue(item, "id") || index} title={`${stringValue(item, "timeLabel")} ${stringValue(item, "title")}`.trim()} detail={stringValue(item, "description")} source={chapterSource(workspace, item)} updatedAt={item.updatedAt}/>) }
    </ContextSection>
    <ContextSection title="相邻章节摘要" count={related.adjacentChapters.length} allTo={`/novel/${novelId}/chapters`}>
      {related.adjacentChapters.map((item) => <ContextItem key={item.id} title={`第${item.number}章 ${item.title}`} detail={item.summary || "暂无摘要"} source="来源：章节摘要" updatedAt={item.updatedAt} to={`/novel/${novelId}/chapters?chapter=${item.id}`}/>) }
    </ContextSection>
  </div>;
}

export default ContextDrawer;

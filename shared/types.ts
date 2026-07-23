export const novelStages = ["构思", "筹备", "连载", "完结", "归档"] as const;
export const chapterStatuses = ["待策划", "章纲已确认", "正文草稿", "待复核", "定稿", "已发布"] as const;
export const canonKinds = ["人物", "地点", "势力", "世界规则", "能力物品", "核心秘密", "禁止事项", "文风规则", "目标结局"] as const;

export type NovelStage = (typeof novelStages)[number];
export type ChapterStatus = (typeof chapterStatuses)[number];
export type CanonKind = (typeof canonKinds)[number];

export interface Novel {
  id: string;
  title: string;
  genre: string;
  stage: NovelStage;
  targetWords: number;
  currentWords: number;
  chapterCount: number;
  description: string;
  coverColor: string;
  contract: Record<string, string>;
  planning: Record<string, string>;
  modelOverrides: Record<string, string>;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface Chapter {
  id: string;
  novelId: string;
  volumeId: string | null;
  arcId: string | null;
  number: number;
  title: string;
  status: ChapterStatus;
  outline: Record<string, string | number>;
  draft: string;
  currentVersionId: string | null;
  summary: string;
  wordCount: number;
  version: number;
  updatedAt: string;
}

export interface CanonEntity {
  id: string;
  novelId: string;
  kind: CanonKind;
  name: string;
  summary: string;
  details: Record<string, unknown>;
  locked: boolean;
  version: number;
  updatedAt: string;
}

export interface QualityIssue {
  dimension: string;
  score: number;
  evidence: string;
  suggestion: string;
  position?: string;
}

export interface PreflightIssue {
  level: "block" | "warning" | "info";
  title: string;
  detail: string;
  evidence?: string;
}

export interface ChapterVersion {
  id: string;
  chapterId: string;
  label: string;
  content: string;
  wordCount: number;
  source: string;
  baseRevision: number | null;
  baseVersionId: string | null;
  createdAt: string;
}

export interface ApiError { error: string; details?: unknown }

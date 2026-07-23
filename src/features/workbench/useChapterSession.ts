import { useCallback, useEffect, useSyncExternalStore } from "react";
import { QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ChapterVersion } from "@shared/types";
import { api, patch, post } from "../../api";
import type { ApiError } from "../../lib/errors";
import { errorMessage } from "../../lib/errors";
import type { Workspace } from "./useWorkbench";

export interface WorkingDraft {
  chapterId: string;
  novelId: string;
  title: string;
  content: string;
  outline: Record<string, string | number>;
  baseVersion: number;
  updatedAt: string;
}

export interface GenerateCandidateInput {
  novelId: string;
  taskType?: string;
  instruction?: string;
  baseContent?: string;
  selectionStart?: number;
  selectionEnd?: number;
  providerId?: string;
}

export interface GenerationRun {
  runId: string;
}

export type GenerationStatus = "starting" | "streaming" | "stopping" | "completed" | "stopped" | "failed";

export interface CandidateGeneration {
  runId: string;
  chapterId: string;
  status: GenerationStatus;
  phase: string;
  text: string;
  versionId?: string;
  reviewable: boolean;
  error?: string;
}

interface GenerationEventData {
  text?: string;
  status?: string;
  output?: string;
  partial?: string;
  message?: string;
  phase?: string;
  version?: Partial<ChapterVersion> & { id?: string };
}

const draftSaveQueues = new Map<string, Promise<void>>();

function enqueueDraftSave(chapterId: string, draft: WorkingDraft) {
  const previous = draftSaveQueues.get(chapterId) ?? Promise.resolve();
  const operation = previous
    .catch(() => undefined)
    .then(() => patch<WorkingDraft>(`/chapters/${chapterId}/working-draft`, draft));
  const settled = operation.then(() => undefined, () => undefined);
  draftSaveQueues.set(chapterId, settled);
  void settled.finally(() => {
    if (draftSaveQueues.get(chapterId) === settled) draftSaveQueues.delete(chapterId);
  });
  return operation;
}

export const chapterSessionKeys = {
  root: (chapterId: string) => ["chapter-session", chapterId] as const,
  workingDraft: (chapterId: string) => ["chapter-session", chapterId, "working-draft"] as const,
  versions: (chapterId: string) => ["chapter-session", chapterId, "versions"] as const,
};

// ===== 模块级 GenerationRegistry =====
// 跨 chapterId 切换保留 EventSource 与生成状态，切章不打断 AI，切回来即可继续查看进度或错误。
interface ActiveEntry {
  runId: string;
  chapterId: string;
  novelId: string;
  taskType: string;
  generation: CandidateGeneration;
  source: EventSource | null;
  cleanupTimer: ReturnType<typeof setTimeout> | null;
  streamed: string;
  prefix: string;
  suffix: string;
}

const activeByRun = new Map<string, ActiveEntry>();
const runsByChapter = new Map<string, Set<string>>();
const chapterListeners = new Map<string, Set<() => void>>();
const globalListeners = new Set<() => void>();
let globalQueryClient: QueryClient | null = null;

// 全局快照缓存：配合 getGlobalSnapshot 避免 useSyncExternalStore 无限循环
let globalSnapshotCache: GlobalGenerationEntry[] = [];
let globalSnapshotDirty = true;

function notifyChapter(chapterId: string) {
  const set = chapterListeners.get(chapterId);
  if (set) for (const fn of set) fn();
  notifyGlobal();
}

function notifyGlobal() {
  // 失效快照缓存，确保下次 getSnapshot 返回新引用
  globalSnapshotDirty = true;
  for (const fn of globalListeners) fn();
}

function registerEntry(entry: ActiveEntry) {
  activeByRun.set(entry.runId, entry);
  if (!runsByChapter.has(entry.chapterId)) runsByChapter.set(entry.chapterId, new Set());
  runsByChapter.get(entry.chapterId)!.add(entry.runId);
  notifyChapter(entry.chapterId);
}

function updateEntryGeneration(runId: string, updater: (entry: ActiveEntry) => CandidateGeneration) {
  const entry = activeByRun.get(runId);
  if (!entry) return;
  entry.generation = updater(entry);
  notifyChapter(entry.chapterId);
}

function clearCleanupTimer(entry: ActiveEntry) {
  if (entry.cleanupTimer) { clearTimeout(entry.cleanupTimer); entry.cleanupTimer = null; }
}

function scheduleRemoval(runId: string, delayMs: number) {
  const entry = activeByRun.get(runId);
  if (!entry) return;
  clearCleanupTimer(entry);
  entry.cleanupTimer = setTimeout(() => removeEntry(runId), delayMs);
}

function removeEntry(runId: string) {
  const entry = activeByRun.get(runId);
  if (!entry) return;
  clearCleanupTimer(entry);
  entry.source?.close();
  entry.source = null;
  activeByRun.delete(runId);
  const set = runsByChapter.get(entry.chapterId);
  if (set) {
    set.delete(runId);
    if (!set.size) runsByChapter.delete(entry.chapterId);
  }
  notifyChapter(entry.chapterId);
}

function getLatestGenerationForChapter(chapterId: string): CandidateGeneration | null {
  const set = runsByChapter.get(chapterId);
  if (!set || !set.size) return null;
  let latestRunId: string | null = null;
  for (const runId of set) latestRunId = runId; // Set 保留插入顺序，取最后一个为最新
  if (!latestRunId) return null;
  return activeByRun.get(latestRunId)?.generation ?? null;
}

function subscribeChapter(chapterId: string, onChange: () => void): () => void {
  if (!chapterListeners.has(chapterId)) chapterListeners.set(chapterId, new Set());
  chapterListeners.get(chapterId)!.add(onChange);
  return () => {
    chapterListeners.get(chapterId)?.delete(onChange);
  };
}

// ===== 全局订阅：供顶栏 / 章节列表消费所有章节的生成状态 =====
export interface GlobalGenerationEntry {
  runId: string;
  chapterId: string;
  novelId: string;
  taskType: string;
  status: GenerationStatus;
  phase: string;
  hasPartialText: boolean;
}

function getGlobalSnapshot(): GlobalGenerationEntry[] {
  // 缓存快照引用：useSyncExternalStore 用 Object.is 比较快照，
  // 若每次返回新数组/新对象会触发无限重渲染。仅在 notifyGlobal 标记 dirty 时重建。
  if (!globalSnapshotDirty) return globalSnapshotCache;
  const entries: GlobalGenerationEntry[] = [];
  for (const entry of activeByRun.values()) {
    entries.push({
      runId: entry.runId,
      chapterId: entry.chapterId,
      novelId: entry.novelId,
      taskType: entry.taskType,
      status: entry.generation.status,
      phase: entry.generation.phase,
      hasPartialText: entry.generation.text.trim().length > 0,
    });
  }
  globalSnapshotCache = entries;
  globalSnapshotDirty = false;
  return entries;
}

function subscribeGlobal(onChange: () => void): () => void {
  globalListeners.add(onChange);
  return () => { globalListeners.delete(onChange); };
}

/** 顶栏 / 全局位置使用的 hook：返回所有进行中的生成任务 */
export function useGlobalGenerationStatus(): GlobalGenerationEntry[] {
  return useSyncExternalStore(subscribeGlobal, getGlobalSnapshot, getGlobalSnapshot);
}

/** 单章节生成状态：供章节列表徽标使用 */
export function useChapterGenerationStatus(chapterId: string): CandidateGeneration | null {
  const subscribe = useCallback((onChange: () => void) => subscribeChapter(chapterId, onChange), [chapterId]);
  const getSnapshot = useCallback(() => getLatestGenerationForChapter(chapterId), [chapterId]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** 判断 runId 对应的 EventSource 是否已死（CLOSED 或 source 为 null） */
function isStreamDead(entry: ActiveEntry | undefined): boolean {
  if (!entry) return true;
  if (!entry.source) return true;
  // EventSource.CONNECTING=0, OPEN=1, CLOSED=2
  return entry.source.readyState === 2;
}

function cacheCandidateVersion(chapterId: string, version: GenerationEventData["version"], content: string, source: string) {
  if (!version?.id || !content.trim() || !globalQueryClient) return;
  const candidate: ChapterVersion = {
    id: version.id,
    chapterId,
    label: version.label || (source === "ai-partial" ? "AI未完成候选稿" : source === "ai-revision" ? "AI定点二稿候选" : "AI候选稿"),
    content: version.content || content,
    wordCount: version.wordCount ?? content.length,
    source: version.source || source,
    baseRevision: version.baseRevision ?? null,
    baseVersionId: version.baseVersionId ?? null,
    createdAt: version.createdAt || new Date().toISOString(),
  };
  globalQueryClient.setQueryData<ChapterVersion[]>(chapterSessionKeys.versions(chapterId), (current = []) => [
    candidate,
    ...current.filter((item) => item.id !== candidate.id),
  ]);
}

function parseEvent(event: Event): GenerationEventData {
  return JSON.parse((event as MessageEvent<string>).data) as GenerationEventData;
}

function openStreamForRun(runId: string, chapterId: string, novelId: string, taskType: string, prefix = "", suffix = "") {
  const existing = activeByRun.get(runId);
  if (existing?.source) { existing.source.close(); existing.source = null; clearCleanupTimer(existing); }

  // 重连场景：若 existing 已有 prefix/suffix 而新传入为空，则保留原值（避免选区改写丢上下文）
  const effectivePrefix = prefix || existing?.prefix || "";
  const effectiveSuffix = suffix || existing?.suffix || "";

  if (!existing) {
    registerEntry({
      runId, chapterId, novelId, taskType,
      generation: { runId, chapterId, status: "streaming", phase: "正在生成", text: `${effectivePrefix}${effectiveSuffix}`, reviewable: false },
      source: null, cleanupTimer: null, streamed: "", prefix: effectivePrefix, suffix: effectiveSuffix,
    });
  } else {
    existing.prefix = effectivePrefix;
    existing.suffix = effectiveSuffix;
    if (novelId) existing.novelId = novelId;
    updateEntryGeneration(runId, (entry) => ({
      ...entry.generation,
      status: "streaming",
      phase: "正在生成",
      text: `${effectivePrefix}${entry.streamed}${effectiveSuffix}`,
      error: undefined,
    }));
  }

  const source = new EventSource(`/api/generations/${runId}/events`);
  const entryNow = activeByRun.get(runId);
  if (entryNow) entryNow.source = source;

  source.addEventListener("snapshot", (event) => {
    const entry = activeByRun.get(runId); if (!entry) return;
    const value = parseEvent(event);
    entry.streamed = value.text || value.output || "";
    updateEntryGeneration(runId, (e) => ({
      ...e.generation,
      status: "streaming",
      phase: value.phase || e.generation.phase,
      text: `${entry.prefix}${entry.streamed}${entry.suffix}`,
      error: undefined,
    }));
  });

  source.addEventListener("phase", (event) => {
    const entry = activeByRun.get(runId); if (!entry) return;
    const value = parseEvent(event);
    updateEntryGeneration(runId, (e) => ({ ...e.generation, phase: value.status || e.generation.phase, error: undefined }));
  });

  source.addEventListener("delta", (event) => {
    const entry = activeByRun.get(runId); if (!entry) return;
    const value = parseEvent(event);
    entry.streamed += value.text || "";
    updateEntryGeneration(runId, (e) => ({ ...e.generation, text: `${entry.prefix}${entry.streamed}${entry.suffix}`, error: undefined }));
  });

  source.addEventListener("done", (event) => {
    const entry = activeByRun.get(runId); if (!entry) return;
    const value = parseEvent(event);
    const output = value.output ?? entry.streamed;
    entry.source?.close();
    entry.source = null;
    updateEntryGeneration(runId, (e) => ({
      ...e.generation,
      status: "completed",
      phase: "生成完成",
      text: value.output ?? e.generation.text,
      versionId: value.version?.id,
      reviewable: Boolean(value.version?.id && (value.output ?? e.generation.text).trim()),
      error: undefined,
    }));
    cacheCandidateVersion(chapterId, value.version, output, value.version?.source || "ai-candidate");
    scheduleRemoval(runId, 60_000);
  });

  source.addEventListener("stopped", (event) => {
    const entry = activeByRun.get(runId); if (!entry) return;
    const value = parseEvent(event);
    const partial = value.partial ?? entry.streamed;
    entry.source?.close();
    entry.source = null;
    updateEntryGeneration(runId, (e) => ({
      ...e.generation,
      status: "stopped",
      phase: "已停止",
      text: value.partial ?? e.generation.text,
      versionId: value.version?.id,
      reviewable: Boolean(value.version?.id && (value.partial ?? e.generation.text).trim()),
      error: undefined,
    }));
    cacheCandidateVersion(chapterId, value.version, partial, "ai-partial");
    scheduleRemoval(runId, 5 * 60_000);
  });

  source.addEventListener("error", (event) => {
    const entry = activeByRun.get(runId); if (!entry) return;
    if (!(event instanceof MessageEvent) || !event.data) {
      // EventSource 会自动重连，仅更新提示
      updateEntryGeneration(runId, (e) => ({ ...e.generation, status: "streaming", phase: "连接中断，正在重连", error: "生成连接暂时中断，正在自动重连。" }));
      return;
    }
    let value: GenerationEventData;
    try { value = parseEvent(event); } catch { return; }
    const partial = value.partial ?? entry.streamed;
    entry.source?.close();
    entry.source = null;
    updateEntryGeneration(runId, (e) => ({
      ...e.generation,
      status: "failed",
      phase: "生成失败",
      text: value.partial ?? e.generation.text,
      versionId: value.version?.id,
      reviewable: Boolean(value.version?.id && (value.partial ?? e.generation.text).trim()),
      error: value.message || "生成连接异常",
    }));
    cacheCandidateVersion(chapterId, value.version, partial, "ai-partial");
    scheduleRemoval(runId, 5 * 60_000);
  });
}

export function useChapterSession(chapterId: string) {
  const queryClient = useQueryClient();
  globalQueryClient = queryClient;
  const enabled = Boolean(chapterId);

  const workingDraft = useQuery<WorkingDraft | null, ApiError>({
    queryKey: chapterSessionKeys.workingDraft(chapterId),
    queryFn: () => api<WorkingDraft | null>(`/chapters/${chapterId}/working-draft`),
    enabled,
  });
  const versions = useQuery<ChapterVersion[], ApiError>({
    queryKey: chapterSessionKeys.versions(chapterId),
    queryFn: () => api<ChapterVersion[]>(`/chapters/${chapterId}/versions`),
    enabled,
  });

  // 订阅当前 chapter 的活跃 generation；切章时 EventSource 与状态保留在 Registry 中
  const subscribe = useCallback((onChange: () => void) => subscribeChapter(chapterId, onChange), [chapterId]);
  const getSnapshot = useCallback(() => getLatestGenerationForChapter(chapterId), [chapterId]);
  const generation = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  // hook 首次挂载或切到新 chapter 时，处理两种情况：
  // 1. 服务端有进行中任务但 Registry 中没有 → 重连 SSE
  // 2. Registry 中有 entry 但 EventSource 已死 → 强制重连（修复根因 E）
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void (async () => {
      try {
        const active = await api<{ runId: string; taskType: string } | null>(`/chapters/${chapterId}/active-generation`);
        if (cancelled || !active) return;
        const existing = activeByRun.get(active.runId);
        if (existing && !isStreamDead(existing)) return; // 流仍活，无需重连
        if (existing) {
          // entry 存在但流已死：先清理 source，再重连（保留 prefix/suffix/streamed）
          existing.source?.close();
          existing.source = null;
          clearCleanupTimer(existing);
        }
        openStreamForRun(active.runId, chapterId, "", active.taskType || "正文");
      } catch { /* 静默：无活跃任务属正常情况 */ }
    })();
    return () => { cancelled = true; };
  }, [chapterId, enabled]);

  const saveDraftMutation = useMutation<WorkingDraft, ApiError, { chapterId: string; draft: WorkingDraft }>({
    mutationFn: (input) => enqueueDraftSave(input.chapterId, input.draft),
  });
  const saveFormalMutation = useMutation<ChapterVersion, ApiError, { content: string; label: string }>({
    mutationFn: (input) => post<ChapterVersion>(`/chapters/${chapterId}/versions`, input),
    onSuccess: async () => {
      const workspaceEntries = queryClient.getQueriesData<Workspace>({ queryKey: ["workspace"] });
      const workspaceKeys = workspaceEntries
        .filter(([, workspace]) => workspace?.chapters.some((chapter) => chapter.id === chapterId))
        .map(([queryKey]) => queryKey);
      const novelId = workingDraft.data?.novelId ?? activeByRun.get(generation?.runId ?? "")?.novelId ?? null;
      if (novelId && !workspaceKeys.some((queryKey) => queryKey[1] === novelId)) workspaceKeys.push(["workspace", novelId]);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: chapterSessionKeys.workingDraft(chapterId), exact: true }),
        queryClient.invalidateQueries({ queryKey: chapterSessionKeys.versions(chapterId), exact: true }),
        ...workspaceKeys.map((queryKey) => queryClient.invalidateQueries({ queryKey, exact: true })),
      ]);
    },
  });
  const generateCandidateMutation = useMutation<GenerationRun, ApiError, GenerateCandidateInput>({
    mutationFn: (input) => post<GenerationRun>("/generations", { ...input, chapterId }),
  });
  const targetedRevisionMutation = useMutation<GenerationRun, ApiError, { novelId: string; sourceVersionId: string }>({
    mutationFn: (input) => post<GenerationRun>(`/chapters/${chapterId}/revisions`, { sourceVersionId: input.sourceVersionId }),
  });
  const stopGenerationMutation = useMutation<unknown, ApiError, string>({
    mutationFn: (runId) => post(`/generations/${runId}/cancel`, {}),
  });
  const acceptCandidateMutation = useMutation<unknown, ApiError, string>({
    mutationFn: (versionId) => post(`/chapters/${chapterId}/candidates/${versionId}/accept`, {}),
    onSuccess: async () => {
      const workspaceEntries = queryClient.getQueriesData<Workspace>({ queryKey: ["workspace"] });
      const workspaceKeys = workspaceEntries
        .filter(([, workspace]) => workspace?.chapters.some((chapter) => chapter.id === chapterId))
        .map(([queryKey]) => queryKey);
      const novelId = workingDraft.data?.novelId ?? activeByRun.get(generation?.runId ?? "")?.novelId ?? null;
      if (novelId && !workspaceKeys.some((queryKey) => queryKey[1] === novelId)) workspaceKeys.push(["workspace", novelId]);

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: chapterSessionKeys.workingDraft(chapterId), exact: true }),
        queryClient.invalidateQueries({ queryKey: chapterSessionKeys.versions(chapterId), exact: true }),
        queryClient.invalidateQueries({ queryKey: ["working-draft", chapterId] }),
        queryClient.invalidateQueries({ queryKey: ["versions", chapterId], exact: true }),
        ...workspaceKeys.map((queryKey) => queryClient.invalidateQueries({ queryKey, exact: true })),
      ]);
      const runId = getLatestGenerationForChapter(chapterId)?.runId;
      if (runId) removeEntry(runId);
    },
  });
  const editCandidateMutation = useMutation<ChapterVersion, ApiError, { versionId: string; content: string }>({
    mutationFn: (input) => patch<ChapterVersion>(`/chapters/${chapterId}/candidates/${input.versionId}`, { content: input.content }),
    onSuccess: async (updated, input) => {
      // 1) 同步刷新本地 Registry 的 generation.text，让候选稿区立即显示编辑后内容
      const runId = getLatestGenerationForChapter(chapterId)?.runId;
      if (runId) updateEntryGeneration(runId, (e) => ({ ...e.generation, text: input.content, error: undefined }));
      // 2) 同步刷新 chapter_versions 缓存，让历史/diff 立即一致
      queryClient.setQueryData<ChapterVersion[]>(chapterSessionKeys.versions(chapterId), (current = []) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
    },
  });

  const generateCandidate = useCallback(async (input: GenerateCandidateInput) => {
    const requestedChapterId = chapterId;
    const selectionStart = input.selectionStart ?? 0;
    const selectionEnd = input.selectionEnd ?? input.baseContent?.length ?? 0;
    const prefix = input.baseContent?.slice(0, selectionStart) ?? "";
    const suffix = input.baseContent?.slice(selectionEnd) ?? "";
    const taskType = input.taskType || "正文";
    // 临时占位 entry，让按钮立刻显示"正在启动"
    const tempRunId = `pending-${requestedChapterId}-${Date.now()}`;
    registerEntry({
      runId: tempRunId,
      chapterId: requestedChapterId,
      novelId: input.novelId,
      taskType,
      generation: { runId: tempRunId, chapterId: requestedChapterId, status: "starting", phase: "正在启动", text: `${prefix}${suffix}`, reviewable: false },
      source: null, cleanupTimer: null, streamed: "", prefix, suffix,
    });
    try {
      const run = await generateCandidateMutation.mutateAsync(input);
      removeEntry(tempRunId);
      // 无条件建立 SSE 流：即使用户已切到其他章节，Registry 仍需保留 EventSource
      // 这样切回原章节时能立即看到生成进度（修复"切换章节后无执行中显示"bug）
      openStreamForRun(run.runId, requestedChapterId, input.novelId, taskType, prefix, suffix);
      return run;
    } catch (error) {
      updateEntryGeneration(tempRunId, (entry) => ({ ...entry.generation, status: "failed", phase: "启动失败", error: errorMessage(error) }));
      scheduleRemoval(tempRunId, 60_000);
      throw error;
    }
  }, [chapterId, generateCandidateMutation]);

  const generateTargetedRevision = useCallback(async (input: { novelId: string; sourceVersionId: string }) => {
    const requestedChapterId = chapterId;
    const tempRunId = `pending-revision-${requestedChapterId}-${Date.now()}`;
    registerEntry({
      runId: tempRunId,
      chapterId: requestedChapterId,
      novelId: input.novelId,
      taskType: "定点二稿",
      generation: { runId: tempRunId, chapterId: requestedChapterId, status: "starting", phase: "正在准备定点二稿", text: "", reviewable: false },
      source: null, cleanupTimer: null, streamed: "", prefix: "", suffix: "",
    });
    try {
      const run = await targetedRevisionMutation.mutateAsync(input);
      removeEntry(tempRunId);
      openStreamForRun(run.runId, requestedChapterId, input.novelId, "定点二稿");
      return run;
    } catch (error) {
      updateEntryGeneration(tempRunId, (entry) => ({ ...entry.generation, status: "failed", phase: "启动失败", error: errorMessage(error) }));
      scheduleRemoval(tempRunId, 60_000);
      throw error;
    }
  }, [chapterId, targetedRevisionMutation]);

  const saveDraft = useCallback(async (draft: WorkingDraft) => {
    const saved = await saveDraftMutation.mutateAsync({ chapterId: draft.chapterId, draft });
    queryClient.setQueryData(chapterSessionKeys.workingDraft(saved.chapterId), saved);
    return saved;
  }, [queryClient, saveDraftMutation.mutateAsync]);
  const saveFormal = useCallback((content: string) => saveFormalMutation.mutateAsync({ content, label: "手动正稿" }), [saveFormalMutation.mutateAsync]);

  const stopGeneration = useCallback(async (runId?: string) => {
    const current = getLatestGenerationForChapter(chapterId);
    const activeRunId = runId || current?.runId;
    if (!activeRunId || activeRunId.startsWith("pending-")) throw new Error("当前没有可停止的生成任务");
    const previous = activeByRun.get(activeRunId)?.generation ?? null;
    updateEntryGeneration(activeRunId, (entry) => ({ ...entry.generation, status: "stopping", phase: "正在停止" }));
    try {
      return await stopGenerationMutation.mutateAsync(activeRunId);
    } catch (error) {
      if (previous) updateEntryGeneration(activeRunId, () => ({ ...previous }));
      throw error;
    }
  }, [chapterId, stopGenerationMutation]);

  const clearCandidate = useCallback(() => {
    const runId = getLatestGenerationForChapter(chapterId)?.runId;
    if (runId) removeEntry(runId);
  }, [chapterId]);

  const editCandidate = useCallback(async (versionId: string, content: string) => {
    return editCandidateMutation.mutateAsync({ versionId, content });
  }, [editCandidateMutation]);

  return {
    data: {
      workingDraft: workingDraft.data,
      versions: versions.data,
    },
    isLoading: workingDraft.isLoading || versions.isLoading,
    workingDraftFetched: workingDraft.isFetched,
    versionsFetched: versions.isFetched,
    error: workingDraft.error ?? versions.error,
    refetch: () => Promise.all([workingDraft.refetch(), versions.refetch()]),
    generation,
    saveDraft,
    saveFormal,
    generateCandidate,
    generateTargetedRevision,
    stopGeneration,
    acceptCandidate: acceptCandidateMutation.mutateAsync,
    editCandidate,
    clearCandidate,
    mutations: {
      saveDraft: saveDraftMutation,
      saveFormal: saveFormalMutation,
      generateCandidate: generateCandidateMutation,
      targetedRevision: targetedRevisionMutation,
      stopGeneration: stopGenerationMutation,
      acceptCandidate: acceptCandidateMutation,
      editCandidate: editCandidateMutation,
    },
  };
}

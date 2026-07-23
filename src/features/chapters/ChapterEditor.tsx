import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Chapter, ChapterVersion, PreflightIssue } from "@shared/types";
import { Check, Save, Search, Sparkles, X } from "lucide-react";
import { getFanqieGenreProfile, resolveChapterLengthRule } from "@shared/fanqieProfiles";
import { api, patch } from "../../api";
import { errorMessage } from "../../lib/errors";
import { isSaveShortcut } from "../../lib/keyboard";
import { chapterSessionKeys, useChapterSession, type WorkingDraft } from "../workbench/useChapterSession";
import { workbenchKeys } from "../workbench/useWorkbench";
import ChapterVersions, { type ReviewCandidate } from "./ChapterVersions";
import QualityPanel from "../quality/QualityPanel";
import type { DisplayQualityIssue } from "../quality/QualityIssueList";
import { resolveIssueRange } from "../quality/issueRange";

interface ChapterEditorProps {
  chapter: Chapter;
  hasHardConflicts?: boolean;
}

export interface ChapterEditorHandle {
  flushPendingDraft: () => Promise<void>;
}

type SaveState = "已保存" | "待自动保存" | "自动保存中" | "已自动保存" | "保存失败";
const outlineTextKeys = ["目标", "主视角", "冲突", "信息揭示", "爽点类型", "见证者", "即时奖励", "能力来源", "状态变化", "时间推进", "情绪点", "伏笔动作", "结尾钩子"];
const outlineNumberKeys = new Set(["字数下限", "预期字数", "字数上限"]);
const aiModes = ["正文", "全章重写", "扩写", "压缩", "润色", "选区改写"];

function countWords(content: string) {
  return content.match(/[\u4e00-\u9fff]|[a-zA-Z0-9]+/g)?.length ?? 0;
}

export function findLatestCandidate(
  versions: ChapterVersion[],
  currentVersionId?: string | null,
  dismissedCandidateId = "",
  formalContent = "",
) {
  const candidate = versions.find((version) => {
    const isCandidate = version.source.endsWith("candidate") || ["ai-partial", "ai-revision"].includes(version.source);
    return isCandidate && Boolean(version.content.trim());
  });
  if (!candidate
    || candidate.id === currentVersionId
    || candidate.id === dismissedCandidateId
    || candidate.content === formalContent) return undefined;
  return candidate;
}

export function isCandidateStale(candidate: ChapterVersion, chapter: Chapter) {
  return candidate.baseRevision == null
    || candidate.baseRevision !== chapter.version
    || (candidate.baseVersionId ?? null) !== (chapter.currentVersionId ?? null);
}

export const ChapterEditor = forwardRef<ChapterEditorHandle, ChapterEditorProps>(function ChapterEditor({ chapter, hasHardConflicts = false }, ref) {
  const queryClient = useQueryClient();
  const session = useChapterSession(chapter.id);
  const [title, setTitle] = useState(chapter.title);
  const [content, setContent] = useState(chapter.draft);
  const [outline, setOutline] = useState<Record<string, string | number>>(chapter.outline);
  const [hydratedChapterId, setHydratedChapterId] = useState("");
  const [restored, setRestored] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("已保存");
  const [saveError, setSaveError] = useState("");
  const [formalSaveNotice, setFormalSaveNotice] = useState("");
  const [findOpen, setFindOpen] = useState(false);
  const [findText, setFindText] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [aiMode, setAiMode] = useState("正文");
  const [aiInstruction, setAiInstruction] = useState("");
  const [executeError, setExecuteError] = useState("");
  const [dismissedCandidateId, setDismissedCandidateId] = useState("");
  const [selectedProviderId, setSelectedProviderId] = useState("");
  const editRevision = useRef(0);
  const persistedRevision = useRef(0);
  const editorContainerRef = useRef<HTMLElement | null>(null);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const chapterFlushes = useRef(new Map<string, () => Promise<unknown>>());
  const latestEditorState = useRef({ title, content, outline, hydratedChapterId });
  latestEditorState.current = { title, content, outline, hydratedChapterId };

  const preflight = useQuery<PreflightIssue[]>({
    queryKey: ["preflight", chapter.id, chapter.version],
    queryFn: () => api<PreflightIssue[]>(`/chapters/${chapter.id}/preflight`),
  });
  // 模型快速选择器：复用 SettingsPage 的 providers 缓存与 workspace 缓存，零额外请求
  const providers = useQuery<Array<{ id: string; name: string; model: string; enabled: boolean; hasKey: boolean }>>({
    queryKey: ["providers"],
    queryFn: () => api("/providers"),
  });
  const workspace = useQuery<import("../workbench/useWorkbench").Workspace>({
    queryKey: ["workspace", chapter.novelId],
    queryFn: () => api(`/novels/${chapter.novelId}/workspace`),
  });
  // 把 aiMode 映射到实际路由 taskType（改写子任务统一走"正文"）
  const routedTaskType = ["全章重写", "扩写", "压缩", "润色", "选区改写"].includes(aiMode) ? "正文" : aiMode;
  const defaultProviderId = workspace.data?.novel.modelOverrides?.[routedTaskType] || "";
  // 路由默认变化时，重置选择器到默认（用户手动切换后保持，直到 aiMode 路由变化）
  useEffect(() => { setSelectedProviderId(defaultProviderId); }, [defaultProviderId]);
  const enabledProviders = providers.data?.filter((item) => item.enabled) ?? [];
  useEffect(() => {
    setTitle(chapter.title);
    setContent(chapter.draft);
    setOutline(chapter.outline);
    setHydratedChapterId("");
    setRestored(false);
    setSaveState("已保存");
    setSaveError("");
    setFindOpen(false);
    setFindText("");
    setReplaceText("");
    setExecuteError("");
    setDismissedCandidateId("");
    editRevision.current = 0;
    persistedRevision.current = 0;
    latestEditorState.current = { title: chapter.title, content: chapter.draft, outline: chapter.outline, hydratedChapterId: "" };
  }, [chapter.id, chapter.title, chapter.draft, chapter.version]);

  useEffect(() => {
    setFormalSaveNotice("");
  }, [chapter.id]);

  useEffect(() => {
    if (!session.workingDraftFetched || hydratedChapterId === chapter.id) return;
    const workingDraft = session.data.workingDraft;
    if (editRevision.current > 0) {
      latestEditorState.current.hydratedChapterId = chapter.id;
      setHydratedChapterId(chapter.id);
      return;
    }
    if (workingDraft?.chapterId === chapter.id && workingDraft.baseVersion === chapter.version) {
      latestEditorState.current = { title: workingDraft.title, content: workingDraft.content, outline: workingDraft.outline, hydratedChapterId: chapter.id };
      setTitle(workingDraft.title);
      setContent(workingDraft.content);
      setOutline(workingDraft.outline);
      setRestored(true);
    }
    if (!workingDraft || workingDraft.chapterId !== chapter.id || workingDraft.baseVersion !== chapter.version) {
      latestEditorState.current = { title: chapter.title, content: chapter.draft, outline: chapter.outline, hydratedChapterId: chapter.id };
    }
    setHydratedChapterId(chapter.id);
  }, [chapter.id, chapter.version, hydratedChapterId, session.data.workingDraft, session.workingDraftFetched]);

  const dirty = title !== chapter.title || content !== chapter.draft || JSON.stringify(outline) !== JSON.stringify(chapter.outline);
  const contentChanged = content !== chapter.draft;
  const makeDraft = useCallback((): WorkingDraft => ({
    chapterId: chapter.id,
    novelId: chapter.novelId,
    title: latestEditorState.current.title,
    content: latestEditorState.current.content,
    outline: latestEditorState.current.outline,
    baseVersion: chapter.version,
    updatedAt: new Date().toISOString(),
  }), [chapter.id, chapter.novelId, chapter.version]);

  const saveRecoveryDraft = useCallback(async () => {
    const latest = latestEditorState.current;
    const hasChanges = latest.title !== chapter.title || latest.content !== chapter.draft || JSON.stringify(latest.outline) !== JSON.stringify(chapter.outline);
    if (latest.hydratedChapterId !== chapter.id || !hasChanges) {
      setSaveState("已保存");
      return true;
    }
    if (editRevision.current <= persistedRevision.current) {
      setSaveState("已自动保存");
      return true;
    }
    const revision = editRevision.current;
    setSaveState("自动保存中");
    setSaveError("");
    try {
      await session.saveDraft(makeDraft());
      persistedRevision.current = Math.max(persistedRevision.current, revision);
      if (editRevision.current === revision) setSaveState("已自动保存");
      return true;
    } catch (error) {
      if (editRevision.current === revision) {
        setSaveState("保存失败");
        setSaveError(errorMessage(error));
      }
      return false;
    }
  }, [chapter.draft, chapter.id, chapter.outline, chapter.title, makeDraft, session.saveDraft]);
  const confirmOutline = useMutation({
    mutationFn: async () => {
      if (!await saveRecoveryDraft()) throw new Error("恢复稿保存失败，章纲尚未确认");
      return patch<Chapter>(`/chapters/${chapter.id}`, {
        version: chapter.version,
        title,
        status: "章纲已确认",
        outline,
        summary: chapter.summary,
      });
    },
    onSuccess: async () => {
      setRestored(false);
      setSaveState("已自动保存");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: workbenchKeys.workspace(chapter.novelId), exact: true }),
        queryClient.invalidateQueries({ queryKey: chapterSessionKeys.workingDraft(chapter.id), exact: true }),
        preflight.refetch(),
      ]);
    },
  });

  chapterFlushes.current.set(chapter.id, saveRecoveryDraft);
  useImperativeHandle(ref, () => ({
    flushPendingDraft: async () => {
      if (!await saveRecoveryDraft()) throw new Error("恢复稿保存失败");
    },
  }), [saveRecoveryDraft]);
  useEffect(() => {
    const activeChapterId = chapter.id;
    return () => { void chapterFlushes.current.get(activeChapterId)?.(); };
  }, [chapter.id]);

  useEffect(() => {
    if (hydratedChapterId !== chapter.id || !dirty) return;
    setSaveState("待自动保存");
    const timer = window.setTimeout(() => void saveRecoveryDraft(), 800);
    return () => window.clearTimeout(timer);
  }, [chapter.id, content, dirty, hydratedChapterId, outline, saveRecoveryDraft, title]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isSaveShortcut(event)) return;
      if (!(event.target instanceof Node) || !editorContainerRef.current?.contains(event.target)) return;
      event.preventDefault();
      void saveRecoveryDraft();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [saveRecoveryDraft]);

  const goal = useMemo(() => String(outline["目标"] || chapter.summary || "本章暂未填写目标。"), [outline, chapter.summary]);
  const genreProfile = getFanqieGenreProfile(String(workspace.data?.novel.genre || ""));
  const lengthRule = useMemo(() => resolveChapterLengthRule(outline, String(workspace.data?.novel.genre || "")), [outline, workspace.data?.novel.genre]);
  const lengthRuleValid = lengthRule.min <= lengthRule.target && lengthRule.target <= lengthRule.max;
  const outlineComplete = outlineTextKeys.every((key) => String(outline[key] ?? "").trim()) && lengthRule.target > 0;
  const matches = findText ? content.split(findText).length - 1 : 0;
  const blockingIssues = preflight.data?.filter((issue) => issue.level === "block") ?? [];
  const candidateHasHardConflicts = hasHardConflicts || blockingIssues.length > 0;
  const orderedVersions = session.data.versions?.map((version, index) => ({ version, index })).sort((left, right) => {
    const timeDifference = Date.parse(right.version.createdAt) - Date.parse(left.version.createdAt);
    return Number.isNaN(timeDifference) || timeDifference === 0 ? left.index - right.index : timeDifference;
  }).map(({ version }) => version);
  const pendingCandidate = findLatestCandidate(orderedVersions ?? [], chapter.currentVersionId, dismissedCandidateId, chapter.draft);
  const reviewCandidate: ReviewCandidate | null = session.generation ? {
    id: session.generation.versionId,
    label: "本次 AI 候选稿",
    text: session.generation.text,
    source: "ai-candidate",
    status: session.generation.status,
    reviewable: session.generation.reviewable,
    error: session.generation.error,
  } : pendingCandidate ? {
    id: pendingCandidate.id,
    label: pendingCandidate.label,
    text: pendingCandidate.content,
    source: pendingCandidate.source,
    status: pendingCandidate.source === "ai-partial" ? "stopped" : "completed",
    reviewable: true,
    stale: isCandidateStale(pendingCandidate, chapter),
  } : null;
  const updateTitle = (value: string) => { editRevision.current += 1; latestEditorState.current.title = value; setFormalSaveNotice(""); setTitle(value); };
  const updateContent = (value: string) => { editRevision.current += 1; latestEditorState.current.content = value; setFormalSaveNotice(""); setContent(value); };
  const updateOutline = (key: string, value: string) => {
    editRevision.current += 1;
    const next = { ...latestEditorState.current.outline, [key]: outlineNumberKeys.has(key) ? Number(value) : value };
    latestEditorState.current.outline = next;
    setFormalSaveNotice("");
    setOutline(next);
  };
  const replaceAll = () => {
    if (!findText || !matches) return;
    updateContent(content.split(findText).join(replaceText));
  };
  const generate = async () => {
    const checked = await preflight.refetch();
    if (checked.data?.some((issue) => issue.level === "block")) return;
    let baseContent: string | undefined;
    let selectionStart: number | undefined;
    let selectionEnd: number | undefined;
    let instruction = aiInstruction;
    if (aiMode !== "正文") {
      baseContent = content;
      selectionStart = aiMode === "选区改写" ? editorRef.current?.selectionStart ?? 0 : 0;
      selectionEnd = aiMode === "选区改写" ? editorRef.current?.selectionEnd ?? 0 : content.length;
      if (aiMode === "选区改写" && selectionStart === selectionEnd) return;
      const source = content.slice(selectionStart, selectionEnd);
      instruction = `${aiInstruction ? `${aiInstruction}\n` : ""}待处理原文：\n${source}`;
    }
    await session.generateCandidate({
      novelId: chapter.novelId,
      taskType: aiMode,
      instruction,
      baseContent,
      selectionStart,
      selectionEnd,
      providerId: selectedProviderId || undefined,
    });
  };
  const executeGenerate = async () => {
    setExecuteError("");
    try { await generate(); } catch (error) { setExecuteError(errorMessage(error)); }
  };
  const focusQualityIssue = (item: DisplayQualityIssue) => {
    const editor = editorRef.current;
    if (!editor) return;
    const range = resolveIssueRange(content, item.issue.evidence, item.source === "semantic" ? item.issue.position : undefined);
    if (!range) return;
    editor.focus();
    editor.setSelectionRange(range.start, range.end);
    editor.scrollIntoView({ block: "center", behavior: "smooth" });
  };
  const acceptCandidate = async (versionId: string) => {
    const checked = await preflight.refetch({ cancelRefetch: true });
    if (checked.error) throw new Error("接受前预检失败，请重试后再接受候选稿。");
    if (checked.data?.some((issue) => issue.level === "block")) {
      throw new Error("接受前预检发现硬冲突，请先解决冲突后再接受候选稿。");
    }
    await session.acceptCandidate(versionId);
  };
  const saveAsFormal = async () => {
    setSaveError("");
    setFormalSaveNotice("");
    if (!await saveRecoveryDraft()) return;
    try {
      await session.saveFormal(content);
      setRestored(false);
      setFormalSaveNotice("已保存为正式版本");
    } catch (error) {
      setSaveError(errorMessage(error));
    }
  };
  const loadCandidateIntoEditor = (candidate: ReviewCandidate) => {
    if (!candidate.text.trim()) return;
    updateContent(candidate.text);
    setFormalSaveNotice("候选正文已载入编辑器，检查后点击“保存正文”即可正式保存");
    requestAnimationFrame(() => {
      editorRef.current?.focus();
      editorRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  };
  const loadVersionIntoEditor = (version: ChapterVersion) => {
    if (!version.content.trim()) return;
    updateContent(version.content);
    setFormalSaveNotice(`“${version.label}”已载入编辑器，检查后点击“保存正文”才会替换当前正式稿`);
    requestAnimationFrame(() => {
      editorRef.current?.focus();
      editorRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  };
  const saveCandidateAsFormal = async (candidate: ReviewCandidate) => {
    if (!candidate.id || !candidate.text.trim()) return;
    setSaveError("");
    setFormalSaveNotice("");
    try {
      if (candidate.stale) await session.saveFormal(candidate.text);
      else await acceptCandidate(candidate.id);
      latestEditorState.current.content = candidate.text;
      setContent(candidate.text);
      setRestored(false);
      setDismissedCandidateId(candidate.id);
      session.clearCandidate();
      setFormalSaveNotice(`AI 正文已保存为正式正文 · ${countWords(candidate.text)} 字`);
    } catch (error) {
      setSaveError(errorMessage(error));
      throw error;
    }
  };

  return <article ref={editorContainerRef} className="chapter-editor panel" aria-labelledby={`chapter-editor-title-${chapter.id}`}>
    <div className="editor-main">
      <header className="chapter-editor-head">
        <div className="chapter-editor-heading">
          <span>第 {chapter.number} 章</span>
          <h2 id={`chapter-editor-title-${chapter.id}`}><input className="chapter-title-input" aria-label="工作标题" value={title} onChange={(event) => updateTitle(event.target.value)}/></h2>
        </div>
        <button className="btn icon chapter-save-button" type="button" aria-label="保存恢复稿" title="保存恢复稿 (Ctrl/Cmd+S)" onClick={() => void saveRecoveryDraft()} disabled={session.mutations.saveDraft.isPending}>
          <Save size={16}/>
        </button>
        <button className="btn primary" type="button" aria-label="保存正文" title={!content.trim() ? "正文为空，无法保存" : !contentChanged ? "正文已经保存，无需重复保存" : "将编辑器中的内容保存为正式正文"} onClick={() => void saveAsFormal()} disabled={!content.trim() || !contentChanged || session.mutations.saveFormal.isPending}>
          <Check size={16}/>保存正文
        </button>
      </header>
      <section className="chapter-goal" aria-label="本章目标">
        <strong>本章目标</strong>
        <p>{goal}</p>
      </section>
      {restored && <div className="recovery-bar"><span>已恢复未保存工作稿</span><span className="badge gold">正式版本未改变</span></div>}
      <div className="editor-command-bar">
        <button className="btn icon" type="button" aria-label="查找替换" title="查找替换" onClick={() => setFindOpen((open) => !open)}><Search size={15}/></button>
        <span className="editor-status"><span data-testid="draft-save-state" className={saveState === "保存失败" ? "save-state is-error" : "save-state"} role="status">{saveState}</span><span className="editor-wordcount">{countWords(content)} 字</span></span>
      </div>
      {executeError && !session.generation?.error && <p className="chapter-candidate-error" role="alert">{executeError}</p>}
      {findOpen && <div className="find-bar">
        <input className="input" aria-label="查找内容" value={findText} onChange={(event) => setFindText(event.target.value)} placeholder="查找"/>
        <input className="input" aria-label="替换内容" value={replaceText} onChange={(event) => setReplaceText(event.target.value)} placeholder="替换为"/>
        <span>{matches} 处</span>
        <button className="btn" type="button" disabled={!matches} onClick={replaceAll}>全部替换</button>
        <button className="btn icon" type="button" aria-label="关闭查找替换" title="关闭" onClick={() => setFindOpen(false)}><X size={14}/></button>
      </div>}
      <div className="ai-rewrite-bar">
        <select className="select" aria-label="AI任务类型" value={aiMode} onChange={(event) => setAiMode(event.target.value)}>{aiModes.map((mode) => <option key={mode}>{mode}</option>)}</select>
        <select
          className="select ai-model-select"
          aria-label="模型"
          value={selectedProviderId}
          onChange={(event) => setSelectedProviderId(event.target.value)}
          title={selectedProviderId ? "使用选定模型" : "使用任务路由默认模型"}
        >
          <option value="">{defaultProviderId ? "路由默认" : "首个启用模型"}</option>
          {enabledProviders.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.model}{!item.hasKey ? "（演示）" : ""}</option>)}
        </select>
        <input className="input" value={aiInstruction} onChange={(event) => setAiInstruction(event.target.value)} placeholder={aiMode === "正文" ? "可选：补充本次生成要求" : "可选：说明改写方向"}/>
        <button className="btn primary" type="button" title={!lengthRuleValid ? "请先修正单章字数范围" : undefined} onClick={() => void executeGenerate()} disabled={chapter.status === "待策划" || !lengthRuleValid || Boolean(blockingIssues.length) || session.mutations.generateCandidate.isPending || Boolean(session.generation && ["starting", "streaming", "stopping"].includes(session.generation.status))}><Sparkles size={14}/>执行AI</button>
        <span>{aiMode === "选区改写" ? "先在正文中选中文字" : "生成结果会显示在下方，采用后才会保存为正式正文"}</span>
      </div>
      <ChapterVersions
        formalContent={chapter.draft}
        currentVersionId={chapter.currentVersionId}
        versions={orderedVersions ?? []}
        candidate={reviewCandidate}
        lengthRule={lengthRule}
        hardConflict={candidateHasHardConflicts}
        accepting={preflight.isFetching || session.mutations.acceptCandidate.isPending}
        editing={session.mutations.editCandidate.isPending}
        onStop={() => session.stopGeneration()}
        onRegenerate={generate}
        onTargetedRevision={(sourceVersionId) => session.generateTargetedRevision({ novelId: chapter.novelId, sourceVersionId })}
        onAccept={acceptCandidate}
        onEdit={(versionId, content) => session.editCandidate(versionId, content)}
        onLoadCandidate={loadCandidateIntoEditor}
        onLoadVersion={loadVersionIntoEditor}
        onSaveCandidate={saveCandidateAsFormal}
        onCloseCandidate={() => {
          if (reviewCandidate?.id) setDismissedCandidateId(reviewCandidate.id);
          session.clearCandidate();
        }}
      />
      <div className="chapter-editor-body">
        <div className="chapter-editor-body-head">
          <label htmlFor={`chapter-content-${chapter.id}`}>正文编辑器</label>
          <span>{dirty ? "有未正式保存的修改" : "当前正式正文"}</span>
        </div>
        <textarea ref={editorRef} id={`chapter-content-${chapter.id}`} className="chapter-prose-editor" aria-label="章节正文" value={content} onChange={(event) => updateContent(event.target.value)} spellCheck={false}/>
      </div>
      {(restored || dirty) && <details className="chapter-formal-reference">
        <summary>对照当前已保存正文（只读）</summary>
        <pre>{chapter.draft || "尚无正式正文"}</pre>
      </details>}
      <footer className="chapter-editor-footer">
        <span>工作稿 {countWords(content)} 字</span>
        <span>正式正文 {chapter.wordCount} 字</span>
      </footer>
      {saveError && <p className="chapter-save-error" role="alert">{saveError}</p>}
      {formalSaveNotice && <p className="chapter-save-success" role="status">{formalSaveNotice}</p>}
    </div>
    <div className="chapter-creation-tools">
      <section className="chapter-tool-panel" aria-labelledby={`outline-title-${chapter.id}`}>
        <div className="chapter-tool-head"><h3 id={`outline-title-${chapter.id}`}>本章章纲</h3><span className={`badge ${chapter.status === "待策划" ? "gold" : "green"}`}>{chapter.status === "待策划" ? "待确认" : "已确认"}</span></div>
        <div className="chapter-outline-fields">{outlineTextKeys.map((key) => <div className="field" key={key}>
          <label htmlFor={`outline-${chapter.id}-${key}`}>{key}</label>
          <input id={`outline-${chapter.id}-${key}`} className="input" value={String(outline[key] ?? "")} onChange={(event) => updateOutline(key, event.target.value)} placeholder={key === "结尾钩子" ? "让读者必须翻页的具体悬念" : `填写${key}`}/>
        </div>)}</div>
        <section className="chapter-length-control" aria-label="单章字数限制">
          <div className="chapter-length-head"><h4>单章字数</h4><span>{genreProfile.key}建议 {genreProfile.chapterWords.min}-{genreProfile.chapterWords.max}</span></div>
          <div className="chapter-length-fields">
            <label>下限<input className="input" type="number" min={500} step={100} value={lengthRule.min} onChange={(event) => updateOutline("字数下限", event.target.value)}/></label>
            <label>目标<input className="input" type="number" min={500} step={100} value={lengthRule.target} onChange={(event) => updateOutline("预期字数", event.target.value)}/></label>
            <label>上限<input className="input" type="number" min={500} step={100} value={lengthRule.max} onChange={(event) => updateOutline("字数上限", event.target.value)}/></label>
            <label>模式<select className="select" value={lengthRule.mode} onChange={(event) => updateOutline("字数限制", event.target.value)}><option>提示</option><option>严格</option></select></label>
          </div>
          {!lengthRuleValid && <p className="chapter-candidate-error" role="alert">字数范围必须满足：下限 ≤ 目标 ≤ 上限。</p>}
        </section>
        <button className="btn" type="button" disabled={!outlineComplete || !lengthRuleValid || confirmOutline.isPending} onClick={() => confirmOutline.mutate()}><Check size={14}/>{confirmOutline.isPending ? "正在确认" : "确认章纲"}</button>
        {!outlineComplete && <p className="chapter-tool-note">所有章纲字段填写完整后才能确认。</p>}
      </section>
      <div className="chapter-tool-stack">
        <QualityPanel
          key={chapter.id}
          chapterId={chapter.id}
          content={content}
          preflightIssues={preflight.data ?? []}
          preflightLoading={preflight.isLoading}
          preflightFetching={preflight.isFetching}
          preflightError={preflight.error}
          preflightUpdatedAt={preflight.dataUpdatedAt}
          onRunPreflight={() => preflight.refetch()}
          onSelectIssue={focusQualityIssue}
        />
      </div>
    </div>
  </article>;
});

export default ChapterEditor;

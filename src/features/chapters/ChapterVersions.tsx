import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { ChapterVersion } from "@shared/types";
import { countChapterWords, type ChapterLengthRule } from "@shared/fanqieProfiles";
import { Check, Edit3, Eye, FileInput, RefreshCw, RotateCcw, Square, X } from "lucide-react";
import { diffChars } from "diff";
import type { CandidateGeneration } from "../workbench/useChapterSession";
import { errorMessage } from "../../lib/errors";

type VersionTab = "candidate" | "formal" | "diff" | "history";

export interface ReviewCandidate {
  id?: string;
  label: string;
  text: string;
  source?: string;
  status: CandidateGeneration["status"];
  reviewable: boolean;
  stale?: boolean;
  error?: string;
}

interface ChapterVersionsProps {
  formalContent: string;
  currentVersionId: string | null;
  versions: ChapterVersion[];
  candidate: ReviewCandidate | null;
  lengthRule: ChapterLengthRule;
  hardConflict?: boolean;
  accepting?: boolean;
  editing?: boolean;
  onStop: () => void | Promise<unknown>;
  onRegenerate: () => void | Promise<unknown>;
  onTargetedRevision: (versionId: string) => void | Promise<unknown>;
  onAccept: (versionId: string) => void | Promise<unknown>;
  onEdit: (versionId: string, content: string) => void | Promise<unknown>;
  onLoadCandidate: (candidate: ReviewCandidate) => void;
  onLoadVersion: (version: ChapterVersion) => void;
  onSaveCandidate: (candidate: ReviewCandidate) => void | Promise<unknown>;
  onCloseCandidate: () => void;
}

type HistoryView = "content" | "diff";

const versionSourceLabels: Record<string, string> = {
  manual: "手动保存",
  "ai-candidate": "AI 候选稿",
  "ai-partial": "AI 部分稿",
  "ai-revision": "AI 定点二稿",
  import: "导入版本",
};

export function versionDisplayName(version: ChapterVersion, currentVersionId: string | null) {
  if (version.id === currentVersionId) return "当前正式稿";
  return versionSourceLabels[version.source] ?? (version.label || "历史版本");
}

const statusLabels: Record<CandidateGeneration["status"], string> = {
  starting: "正在启动",
  streaming: "生成中 · 部分稿",
  stopping: "正在停止",
  completed: "生成完成 · 待审核",
  stopped: "已停止 · 部分稿可审核",
  failed: "生成失败 · 已保留部分稿",
};

export function ChapterVersions({
  formalContent,
  currentVersionId,
  versions,
  candidate,
  lengthRule,
  hardConflict = false,
  accepting = false,
  editing = false,
  onStop,
  onRegenerate,
  onTargetedRevision,
  onAccept,
  onEdit,
  onLoadCandidate,
  onLoadVersion,
  onSaveCandidate,
  onCloseCandidate,
}: ChapterVersionsProps) {
  const tabsId = useId();
  const [tab, setTab] = useState<VersionTab>(candidate ? "candidate" : "formal");
  const [actionError, setActionError] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(currentVersionId);
  const [historyView, setHistoryView] = useState<HistoryView>("content");
  const editRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    if (candidate) setTab("candidate");
  }, [candidate?.id, candidate?.status]);
  // 切换候选稿或开始新生成时，自动退出编辑态
  useEffect(() => {
    setIsEditing(false);
    setEditContent("");
  }, [candidate?.id, candidate?.status]);
  useEffect(() => {
    if (isEditing) {
      setEditContent(candidate?.text || "");
      requestAnimationFrame(() => editRef.current?.focus());
    }
  }, [isEditing, candidate?.text]);
  useEffect(() => {
    if (!versions.some((version) => version.id === selectedVersionId)) {
      setSelectedVersionId(currentVersionId ?? versions[0]?.id ?? null);
    }
  }, [currentVersionId, selectedVersionId, versions]);
  const changes = useMemo(() => tab === "diff" && candidate ? diffChars(formalContent, candidate.text) : [], [candidate?.text, formalContent, tab]);
  const selectedVersion = versions.find((version) => version.id === selectedVersionId) ?? null;
  const historyChanges = useMemo(
    () => historyView === "diff" && selectedVersion ? diffChars(formalContent, selectedVersion.content) : [],
    [formalContent, historyView, selectedVersion?.content],
  );
  const running = Boolean(candidate && ["starting", "streaming", "stopping"].includes(candidate.status));
  const candidateWords = candidate ? countChapterWords(candidate.text) : 0;
  const lengthOutsideRange = Boolean(candidate?.text.trim() && (candidateWords < lengthRule.min || candidateWords > lengthRule.max));
  const lengthBlocked = lengthRule.mode === "严格" && lengthOutsideRange;
  const canAccept = Boolean(candidate?.id && candidate.reviewable && candidate.text.trim() && !hardConflict && !lengthBlocked && !running && !isEditing);
  const canRevise = Boolean(candidate?.id && candidate.reviewable && !running && !isEditing && ["ai-candidate", "ai-partial", "ai-revision"].includes(candidate.source || "ai-candidate"));
  const canEdit = Boolean(candidate?.id && candidate.reviewable && !running && !isEditing);
  const dirty = isEditing && editContent !== (candidate?.text || "");
  const tabOrder: VersionTab[] = candidate ? ["candidate", "formal", "diff", "history"] : ["candidate", "formal", "history"];
  const labels: Record<VersionTab, string> = { candidate: "AI 候选正文", formal: "已保存正文", diff: "对比", history: "历史版本" };
  const selectFromKeyboard = (event: KeyboardEvent<HTMLButtonElement>, current: VersionTab) => {
    let next: VersionTab | undefined;
    const index = tabOrder.indexOf(current);
    if (event.key === "ArrowRight") next = tabOrder[(index + 1) % tabOrder.length];
    if (event.key === "ArrowLeft") next = tabOrder[(index - 1 + tabOrder.length) % tabOrder.length];
    if (event.key === "Home") next = tabOrder[0];
    if (event.key === "End") next = tabOrder[tabOrder.length - 1];
    if (!next) return;
    event.preventDefault();
    setTab(next);
    document.getElementById(`${tabsId}-tab-${next}`)?.focus();
  };
  const runAction = async (action: () => void | Promise<unknown>) => {
    setActionError("");
    try { await action(); } catch (error) { setActionError(errorMessage(error)); }
  };
  const saveEdit = async () => {
    if (!candidate?.id || !dirty) return;
    setActionError("");
    try {
      await onEdit(candidate.id, editContent);
      setIsEditing(false);
    } catch (error) {
      setActionError(errorMessage(error));
    }
  };
  const cancelEdit = () => {
    setIsEditing(false);
    setEditContent("");
    setActionError("");
  };

  return <section className="chapter-versions" aria-label="候选稿与版本">
    <div className="chapter-version-tabs" role="tablist" aria-label="版本视图">
      {(["candidate", "formal", "diff", "history"] as VersionTab[]).map((item) => <button
        key={item}
        id={`${tabsId}-tab-${item}`}
        type="button"
        role="tab"
        aria-selected={tab === item}
        aria-controls={`${tabsId}-panel-${item}`}
        tabIndex={tab === item ? 0 : -1}
        onKeyDown={(event) => selectFromKeyboard(event, item)}
        onClick={() => setTab(item)}
        disabled={item === "diff" && !candidate}
      >{labels[item]}</button>)}
    </div>

    {tab === "candidate" && <div id={`${tabsId}-panel-candidate`} aria-labelledby={`${tabsId}-tab-candidate`} className="chapter-version-pane" role="tabpanel">
      {candidate ? <>
        <div className="chapter-candidate-status">
          <div><h3>{candidate.label}</h3><span className={`badge ${candidate.status === "failed" ? "red" : "gold"}`}>{statusLabels[candidate.status]}</span>{candidate.stale && <span className="badge red">可恢复</span>}{isEditing && <span className="badge green">编辑中</span>}</div>
          {!running && !isEditing && <button className="btn icon" type="button" aria-label="关闭候选稿" title="关闭候选稿" onClick={onCloseCandidate}><X size={14}/></button>}
        </div>
        {candidate.error && <p className="chapter-candidate-error" role="alert">{candidate.error}</p>}
        {actionError && <p className="chapter-candidate-error" role="alert">{actionError}</p>}
        {candidate.stale && !running && <p className="chapter-candidate-recovery" role="status">这份 AI 正文生成后，当前正文又被保存过。内容仍完整保留，可以重新载入或直接保存为最新正文。</p>}
        <div className={`chapter-candidate-length ${lengthOutsideRange ? "is-outside" : ""}`} role="status">
          <span>候选 {candidateWords} 字</span><span>目标 {lengthRule.target} 字</span><span>范围 {lengthRule.min}-{lengthRule.max}</span><span>{lengthRule.mode}模式</span>
        </div>
        {lengthBlocked && !running && <p className="chapter-candidate-error" role="alert">候选正文超出严格字数范围。请编辑、压缩、扩写或载入编辑器后人工处理。</p>}
        {isEditing
          ? <textarea
              ref={editRef}
              className="chapter-version-content chapter-version-editor"
              aria-label="编辑候选稿正文"
              value={editContent}
              onChange={(event) => setEditContent(event.target.value)}
              spellCheck={false}
            />
          : <pre className="chapter-version-content">{candidate.text || "正在等待模型输出…"}</pre>}
        {hardConflict && !isEditing && <p className="chapter-candidate-error" role="alert">存在硬冲突，解决后才能接受候选稿。</p>}
        <div className="chapter-candidate-actions">
          {isEditing
            ? <>
              <button className="btn primary" type="button" onClick={() => void saveEdit()} disabled={!dirty || editing}><Check size={14}/>保存修改</button>
              <button className="btn" type="button" onClick={cancelEdit} disabled={editing}>取消</button>
            </>
            : <>
              {running
                ? <button className="btn danger" type="button" onClick={() => void runAction(onStop)} disabled={candidate.status === "starting" || candidate.status === "stopping"}><Square size={13}/>停止</button>
                : <button className="btn" type="button" onClick={() => void runAction(onRegenerate)}><RefreshCw size={14}/>重新生成</button>}
              {!running && <button className="btn" type="button" onClick={() => candidate.id && void runAction(() => onTargetedRevision(candidate.id!))} disabled={!canRevise}><RefreshCw size={14}/>生成定点二稿</button>}
              {!running && <button className="btn" type="button" onClick={() => setIsEditing(true)} disabled={!canEdit}><Edit3 size={14}/>编辑候选稿</button>}
              {!running && <button className="btn" type="button" onClick={() => onLoadCandidate(candidate)} disabled={!candidate.text.trim()}><FileInput size={14}/>载入正文编辑器</button>}
              {!running && <button
                className="btn primary"
                type="button"
                title={hardConflict ? "存在硬冲突，解决后才能保存候选正文" : lengthBlocked ? "候选正文超出严格字数范围" : "将这份 AI 候选稿保存为正式正文"}
                onClick={() => candidate.id && void runAction(() => candidate.stale ? onSaveCandidate(candidate) : onAccept(candidate.id!))}
                disabled={!canAccept || accepting}
              ><Check size={14}/>{accepting ? "正在保存" : "采用并保存为正文"}</button>}
            </>}
        </div>
      </> : <p className="chapter-version-empty">暂无 AI 候选正文。执行 AI 后，生成内容会立即显示在这里。</p>}
    </div>}

    {tab === "formal" && <div id={`${tabsId}-panel-formal`} aria-labelledby={`${tabsId}-tab-formal`} className="chapter-version-pane" role="tabpanel">
      <pre className="chapter-version-content">{formalContent || "尚未保存正式正文"}</pre>
    </div>}

    {tab === "diff" && <div id={`${tabsId}-panel-diff`} aria-labelledby={`${tabsId}-tab-diff`} className="chapter-version-pane" role="tabpanel" aria-label="候选稿与正式稿差异">
      <div className="chapter-version-legend"><span className="candidate-diff-removed">删除</span><span className="candidate-diff-added">新增</span></div>
      <pre className="chapter-version-content candidate-diff">{changes.map((part, index) => <span
        key={`${index}-${part.value.slice(0, 12)}`}
        className={part.added ? "candidate-diff-added" : part.removed ? "candidate-diff-removed" : undefined}
      >{part.value}</span>)}</pre>
    </div>}

    {tab === "history" && <div id={`${tabsId}-panel-history`} aria-labelledby={`${tabsId}-tab-history`} className="chapter-version-pane chapter-history-pane" role="tabpanel">
      {versions.length ? <div className="chapter-history-layout">
        <div className="chapter-history-list-wrap">
          <p className="chapter-history-help">每次保存和 AI 生成都会留下一份快照。选择一条即可查看正文，不会修改当前稿。</p>
          <ol className="chapter-version-history">{versions.map((version) => {
            const isCurrent = version.id === currentVersionId;
            const isSelected = version.id === selectedVersion?.id;
            return <li key={version.id}>
              <button
                type="button"
                className={isSelected ? "is-selected" : undefined}
                aria-pressed={isSelected}
                onClick={() => {
                  setSelectedVersionId(version.id);
                  setHistoryView("content");
                }}
              >
                <span className="chapter-history-item-head">
                  <strong>{versionDisplayName(version, currentVersionId)}</strong>
                  {isCurrent && <span className="badge green">当前</span>}
                </span>
                <span>{version.wordCount} 字 · {new Date(version.createdAt).toLocaleString("zh-CN")}</span>
              </button>
            </li>;
          })}</ol>
        </div>
        {selectedVersion && <section className="chapter-history-preview" aria-label="历史版本正文预览">
          <header>
            <div>
              <Eye size={15}/>
              <div><strong>{versionDisplayName(selectedVersion, currentVersionId)}</strong><span>{selectedVersion.wordCount} 字 · {new Date(selectedVersion.createdAt).toLocaleString("zh-CN")}</span></div>
            </div>
            <div className="chapter-history-view-switch" aria-label="历史版本查看方式">
              <button type="button" aria-pressed={historyView === "content"} onClick={() => setHistoryView("content")}>正文</button>
              <button type="button" aria-pressed={historyView === "diff"} onClick={() => setHistoryView("diff")}>与当前对比</button>
            </div>
          </header>
          {historyView === "content"
            ? <pre className="chapter-version-content">{selectedVersion.content || "这个版本没有正文"}</pre>
            : selectedVersion.id === currentVersionId
              ? <p className="chapter-version-empty">这就是当前正式稿，没有差异。</p>
              : <><div className="chapter-version-legend"><span className="candidate-diff-removed">当前稿删除</span><span className="candidate-diff-added">历史稿内容</span></div><pre className="chapter-version-content candidate-diff">{historyChanges.map((part, index) => <span
                key={`${index}-${part.value.slice(0, 12)}`}
                className={part.added ? "candidate-diff-added" : part.removed ? "candidate-diff-removed" : undefined}
              >{part.value}</span>)}</pre></>}
          {selectedVersion.id !== currentVersionId && <div className="chapter-history-actions">
            <span>载入后只进入编辑器，点击“保存正文”才会成为正式稿。</span>
            <button className="btn" type="button" onClick={() => onLoadVersion(selectedVersion)}><RotateCcw size={14}/>载入编辑器</button>
          </div>}
        </section>}
      </div> : <p className="chapter-version-empty">还没有版本记录。</p>}
    </div>}
  </section>;
}

export default ChapterVersions;

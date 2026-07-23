import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Route, Routes, useNavigate, useParams, useSearchParams } from "react-router-dom";
import App from "../App";
import Toast from "../components/Toast";
import CanonPage from "../features/canon/CanonPage";
import ChapterEditor, { type ChapterEditorHandle } from "../features/chapters/ChapterEditor";
import ChapterNavigator from "../features/chapters/ChapterNavigator";
import ContextDrawer from "../features/context/ContextDrawer";
import OutlinePage from "../features/outline/OutlinePage";
import OverviewPage from "../features/overview/OverviewPage";
import PlanningPage from "../features/planning/PlanningPage";
import PublishingPage from "../features/publishing/PublishingPage";
import SettingsPage from "../features/settings/SettingsPage";
import TimelinePage from "../features/timeline/TimelinePage";
import { getWorkspaceChapter, type Workspace } from "../features/workbench/useWorkbench";
import { errorMessage } from "../lib/errors";
import WorkbenchShell, { useChapterNavigationGuard } from "./WorkbenchShell";

function ChapterWorkspace({ workspace }: { workspace: Workspace }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectionPending, setSelectionPending] = useState(false);
  const [selectionError, setSelectionError] = useState("");
  const editorRef = useRef<ChapterEditorHandle | null>(null);
  const { registerChapterFlush } = useChapterNavigationGuard();
  const requestedChapterId = searchParams.get("chapter");
  const selected = getWorkspaceChapter(workspace, requestedChapterId);

  useEffect(() => {
    registerChapterFlush(() => editorRef.current?.flushPendingDraft() ?? Promise.resolve());
    return () => registerChapterFlush(null);
  }, [registerChapterFlush]);

  if (!selected) return <div className="empty">还没有章节，请先在原工作台中创建章节。</div>;
  const selectChapter = async (chapterId: string) => {
    if (selectionPending || chapterId === selected.id) return;
    setSelectionPending(true);
    setSelectionError("");
    try {
      await editorRef.current?.flushPendingDraft();
    } catch (error) {
      setSelectionError(`无法切换章节：${errorMessage(error)}。请重试保存恢复稿。`);
      setSelectionPending(false);
      return;
    }
    const next = new URLSearchParams(searchParams);
    next.set("chapter", chapterId);
    setSearchParams(next);
    setSelectionPending(false);
  };

  return <div className="chapter-workspace-page">
    <div className="page-head chapter-workspace-head"><div><h2>章节创作</h2><p>章纲控制方向，工作稿自动恢复，AI 结果先进入候选版本。</p></div></div>
    {selectionError && <p className="chapter-switch-error" role="alert">{selectionError}</p>}
    <div className="chapter-workspace">
      <ChapterNavigator
        volumes={workspace.volumes}
        arcs={workspace.arcs}
        chapters={workspace.chapters}
        selectedChapterId={selected.id}
        onSelect={(chapterId) => void selectChapter(chapterId)}
        selectionDisabled={selectionPending}
      />
      <ChapterEditor ref={editorRef} chapter={selected}/>
    </div>
  </div>;
}

function AuxiliaryWorkspace({ novelId, view, workspace }: { novelId: string; view: string; workspace: Workspace }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [toast, setToast] = useState("");
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["workspace", novelId] });
  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  };
  const page = view === "overview" ? <OverviewPage data={workspace}/>
    : view === "planning" ? <PlanningPage data={workspace} refresh={refresh} toast={showToast}/>
      : view === "canon" ? <CanonPage data={workspace} refresh={refresh} toast={showToast}/>
        : view === "outline" ? <OutlinePage data={workspace} refresh={refresh} toast={showToast} navigateChapter={() => navigate({ pathname: `/novel/${novelId}/chapters`, search: searchParams.toString() ? `?${searchParams}` : "" })}/>
          : view === "timeline" ? <TimelinePage data={workspace} refresh={refresh} toast={showToast}/>
            : view === "publish" ? <PublishingPage data={workspace} refresh={refresh} toast={showToast}/>
              : view === "settings" ? <SettingsPage data={workspace} refresh={refresh} toast={showToast}/>
                : <OverviewPage data={workspace}/>;
  return <>{page}{toast && <Toast text={toast} close={() => setToast("")}/>}</>;
}

function ChapterCenteredShell() {
  const { id, view = "overview" } = useParams();
  const [searchParams] = useSearchParams();
  if (!id) return <App />;
  return <WorkbenchShell
    novelId={id}
    view={view}
    contextDrawer={view === "chapters" ? (workspace) => {
      const selected = getWorkspaceChapter(workspace, searchParams.get("chapter"));
      return selected ? <ContextDrawer novelId={id} workspace={workspace} chapter={selected}/> : null;
    } : undefined}
  >
    {(workspace) => view === "chapters"
        ? <ChapterWorkspace workspace={workspace}/>
        : <AuxiliaryWorkspace novelId={id} view={view} workspace={workspace}/>} 
  </WorkbenchShell>;
}

/** Stable routing boundary for the shell migration; legacy views remain owned by App. */
export function AppRouter() {
  return <Routes><Route path="/novel/:id/:view?" element={<ChapterCenteredShell />} /><Route path="*" element={<App />} /></Routes>;
}

export default AppRouter;

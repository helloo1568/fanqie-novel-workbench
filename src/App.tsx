import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  Archive, Bot, BookOpen, BookText, CheckCircle2, CirclePlus, Cloud,
  Copy, FileUp, Library, Loader2, MoreHorizontal, Search, Settings, Trash2,
} from "lucide-react";
import { api, patch, post, remove } from "./api";
import SharedModal from "./components/Modal";
import SharedToast from "./components/Toast";
import CreateNovelWizard from "./features/novels/CreateNovelWizard";
import { Empty as EmptyState, SkeletonCard } from "./components/ui";
import type { Novel, NovelStage } from "@shared/types";

function formatNumber(value: number) { return new Intl.NumberFormat("zh-CN").format(value || 0); }
function timeAgo(value: string) {
  const diff = Date.now() - new Date(value).getTime();
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return new Date(value).toLocaleDateString("zh-CN");
}

function App() { return <Dashboard />; }
export default App;

const FILTERS: Array<{ key: "全部" | NovelStage; label: string }> = [
  { key: "全部", label: "全部作品" },
  { key: "筹备", label: "筹备中" },
  { key: "连载", label: "连载中" },
  { key: "完结", label: "已完结" },
  { key: "归档", label: "已归档" },
];

function Dashboard() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [deletingNovel, setDeletingNovel] = useState<Novel | null>(null);
  const [toast, setToast] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("全部");
  const [search, setSearch] = useState("");
  const novels = useQuery({ queryKey: ["novels"], queryFn: () => api<Novel[]>("/novels") });
  const deepPlanningTasks = useQuery({
    queryKey: ["deep-planning-tasks"],
    queryFn: () => api<Array<{ id: string; novelId: string; novelTitle: string; status: string }>>("/deep-planning/tasks"),
    refetchInterval: 2500,
  });
  const duplicate = useMutation({ mutationFn: (id: string) => post<Novel>(`/novels/${id}/duplicate`, {}), onSuccess: () => { void qc.invalidateQueries({ queryKey: ["novels"] }); setToast("副本已创建"); } });
  const archive = useMutation({ mutationFn: (novel: Novel) => patch<Novel>(`/novels/${novel.id}`, { version: novel.version, stage: "归档" }), onSuccess: () => { void qc.invalidateQueries({ queryKey: ["novels"] }); setToast("小说已归档"); }, onError: (error) => setToast(`归档失败：${error.message}`) });
  const destroy = useMutation({ mutationFn: (novel: Novel) => remove(`/novels/${novel.id}`), onSuccess: () => { setDeletingNovel(null); void qc.invalidateQueries({ queryKey: ["novels"] }); setToast("小说及关联创作数据已删除"); }, onError: (error) => setToast(`删除失败：${error.message}`) });
  const visibleNovels = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase("zh-CN");
    return (novels.data ?? []).filter((novel) => {
      const matchesFilter = filter === "全部" || novel.stage === filter;
      const matchesSearch = !keyword || `${novel.title} ${novel.genre} ${novel.description}`.toLocaleLowerCase("zh-CN").includes(keyword);
      return matchesFilter && matchesSearch;
    });
  }, [filter, novels.data, search]);
  const recentNovel = useMemo(() => [...(novels.data ?? [])].sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())[0], [novels.data]);
  const openRecentView = (view: "chapters" | "settings") => {
    if (recentNovel) navigate(`/novel/${recentNovel.id}/${view}`);
  };
  const totalWords = (novels.data ?? []).reduce((sum, novel) => sum + novel.currentWords, 0);
  const activeDays = Math.max(1, Math.min(365, Math.round(totalWords / 18_000)));

  return <div className="app-shell library-shell">
    <DashboardRail hasNovel={Boolean(recentNovel)} onOpenWorkbench={() => openRecentView("chapters")} onOpenSettings={() => openRecentView("settings")}/>
    <main className="main library-main">
      <h1 className="sr-only">作品书库</h1>
      <header className="library-topbar">
        <div className="library-brand"><BookOpen size={23}/><strong>长篇工坊</strong><span>作品书库</span></div>
        <div className="library-system-status">
          <button className="library-top-action" disabled={!recentNovel} title={recentNovel ? "进入最近作品的 AI 写作工作台" : "创建作品后可用"} onClick={() => openRecentView("chapters")}><Bot size={18}/><span>AI 助手</span></button>
          <Cloud size={16}/><span>本地已保存</span>
          <button className="btn icon" disabled={!recentNovel} title={recentNovel ? "打开模型与数据设置" : "创建作品后可用"} aria-label="模型与数据" onClick={() => openRecentView("settings")}><Settings size={17}/></button>
        </div>
      </header>
      <div className="library-content">
        <section className="library-hero">
          <div><span className="library-eyebrow">MASTER MANUSCRIPT</span><h1>我的创作空间</h1><p>欢迎回来。选择一部作品，继续推进今天的章节。</p></div>
          <div className="library-primary-actions"><button className="btn library-import" onClick={() => setImporting(true)}><FileUp size={18}/>导入作品</button><button className="btn primary" onClick={() => setCreating(true)}><CirclePlus size={19}/>开启新篇</button></div>
        </section>
        {!!deepPlanningTasks.data?.length && <section className="library-background-tasks" aria-label="AI 开书任务">
          {deepPlanningTasks.data.map((task) => <button key={task.id} type="button" onClick={() => navigate(`/novel/${task.novelId}/planning?deep=1`)}>
            {task.status === "待审核" ? <CheckCircle2 size={17}/> : <Loader2 size={17} className="generation-indicator-spinner"/>}
            <span><strong>{task.novelTitle}</strong><small>{task.status === "待审核" ? "开书方案已完成，点击查看" : "AI 正在后台完成开书方案，点击查看进度"}</small></span>
            <span className={`badge ${task.status === "待审核" ? "green" : "gold"}`}>{task.status}</span>
          </button>)}
        </section>}
        <section className="library-toolbar" aria-label="作品筛选">
          <div className="library-filters">{FILTERS.map((item) => {
            const count = item.key === "全部" ? novels.data?.length ?? 0 : novels.data?.filter((novel) => novel.stage === item.key).length ?? 0;
            return <button key={item.key} className={filter === item.key ? "active" : ""} onClick={() => setFilter(item.key)}>{item.label}<span>{count}</span></button>;
          })}</div>
          <label className="library-search"><Search size={17}/><input aria-label="搜索作品" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索作品、题材或关键词"/></label>
        </section>
        {novels.isLoading ? <div className="novel-grid"><SkeletonCard lines={4}/><SkeletonCard lines={4}/><SkeletonCard lines={4}/></div>
          : visibleNovels.length ? <div className="novel-grid">{visibleNovels.map((novel) => <NovelCard key={novel.id} novel={novel} onOpen={() => navigate(`/novel/${novel.id}/overview`)} onContinue={() => navigate(`/novel/${novel.id}/chapters`)} onDuplicate={() => duplicate.mutate(novel.id)} onArchive={() => archive.mutate(novel)} onDelete={() => setDeletingNovel(novel)}/>)}</div>
            : <EmptyState text={search ? "没有匹配的作品。调整关键词或清除筛选后再试。" : "这个分类中还没有作品。"} action={<button className="btn primary" onClick={() => { setFilter("全部"); setSearch(""); setCreating(true); }}><CirclePlus size={15}/>新建小说</button>}/>} 
        <footer className="library-footer-stats"><div><span>累计创作字数</span><strong>{formatNumber(totalWords)}</strong></div><div><span>持续创作天数</span><strong>{activeDays} Days</strong></div><div className="library-security"><CheckCircle2 size={15}/><span><strong>实时保存已开启</strong> · 所有创作数据保存在本机</span></div></footer>
      </div>
    </main>
    {creating && <CreateNovelWizard onClose={() => setCreating(false)} onCreated={() => { void qc.invalidateQueries({ queryKey: ["novels"] }); }} onComplete={(novelId, skipAi) => { setCreating(false); void qc.invalidateQueries({ queryKey: ["novels"] }); navigate(skipAi ? `/novel/${novelId}/planning` : `/novel/${novelId}/chapters`); }}/>} 
    {importing && <ImportNovelModal onClose={() => setImporting(false)} onDone={(novelId) => { setImporting(false); void qc.invalidateQueries({ queryKey: ["novels"] }); navigate(`/novel/${novelId}/overview`); }}/>} 
    {deletingNovel && <SharedModal title="删除小说" onClose={() => !destroy.isPending && setDeletingNovel(null)} actions={<><button className="btn" disabled={destroy.isPending} onClick={() => setDeletingNovel(null)}>取消</button><button className="btn danger" disabled={destroy.isPending} onClick={() => destroy.mutate(deletingNovel)}><Trash2 size={14}/>{destroy.isPending ? "正在删除" : "永久删除"}</button></>}><div className="destructive-summary"><span className="badge red">此操作不可恢复</span><p>将永久删除《<strong>{deletingNovel.title}</strong>》以及关联的 {deletingNovel.chapterCount} 个章节、设定、大纲、伏笔和生成记录。</p><small>需要保留内容时，请先在作品的发布页导出完整整书包。</small></div></SharedModal>}
    {toast && <SharedToast text={toast} close={() => setToast("")}/>} 
  </div>;
}

function NovelCard({ novel, onOpen, onContinue, onDuplicate, onArchive, onDelete }: { novel: Novel; onOpen: () => void; onContinue: () => void; onDuplicate: () => void; onArchive: () => void; onDelete: () => void }) {
  const pct = Math.min(100, Math.round(novel.currentWords / Math.max(1, novel.targetWords) * 100));
  const initials = novel.title.replace(/[《》\s]/g, "").slice(0, 2);
  return <article className="novel-card" style={{ "--cover": novel.coverColor } as React.CSSProperties}>
    <button className="novel-cover" onClick={onOpen} aria-label="打开作品封面"><span className="novel-stage">{novel.stage}</span><span className="novel-cover-kicker">{novel.genre}</span><strong>{novel.title}</strong><span className="novel-cover-mark">{initials}</span></button>
    <div className="novel-main">
      <div className="novel-card-heading"><button className="novel-title" onClick={onOpen}>{novel.title}</button><details className="novel-menu"><summary aria-label={`${novel.title} 更多操作`}><MoreHorizontal size={17}/></summary><div><button onClick={onDuplicate}><Copy size={13}/>复制</button>{novel.stage !== "归档" && <button onClick={onArchive}><Archive size={13}/>归档</button>}<button className="danger" onClick={onDelete}><Trash2 size={13}/>删除</button></div></details></div>
      <p className="novel-desc">{novel.description || "尚未填写作品简介。"}</p>
      <div className="novel-metrics"><span><small>字数</small><strong>{formatNumber(novel.currentWords)}</strong></span><span><small>进度</small><strong>{novel.chapterCount} 章 · {pct}%</strong></span></div>
      <div className="progress-track"><div className="progress-bar" style={{ width: `${pct}%` }}/></div>
      <div className="novel-last-edit">上次编辑 · {timeAgo(novel.updatedAt)}</div>
      <button className="btn novel-continue" onClick={onContinue}><BookText size={15}/>{novel.stage === "完结" ? "查看作品" : "继续写作"}</button>
    </div>
  </article>;
}

function DashboardRail({ hasNovel, onOpenWorkbench, onOpenSettings }: { hasNovel: boolean; onOpenWorkbench: () => void; onOpenSettings: () => void }) {
  return <aside className="rail library-rail"><div className="brand-mark"><BookOpen size={20}/></div><nav className="rail-nav"><button className="rail-link active" title="作品书库"><Library size={20}/><span>书库</span></button><button className="rail-link" disabled={!hasNovel} title={hasNovel ? "打开最近编辑的作品" : "创建作品后可用"} onClick={onOpenWorkbench}><BookText size={20}/><span>工作台</span></button></nav><div className="rail-bottom"><button className="rail-link" disabled={!hasNovel} title={hasNovel ? "打开模型与数据设置" : "创建作品后可用"} onClick={onOpenSettings}><Settings size={19}/><span>设置</span></button></div></aside>;
}

function ImportNovelModal({ onClose, onDone }: { onClose: () => void; onDone: (novelId: string) => void }) {
  const [file, setFile] = useState<File | null>(null); const [reading, setReading] = useState(false); const [error, setError] = useState("");
  const submit = async () => {
    if (!file) return; setReading(true); setError("");
    try {
      const extension = file.name.split(".").pop()?.toLowerCase() || "txt"; let content: string;
      if (extension === "zip") { const bytes = new Uint8Array(await file.arrayBuffer()); const chunks: string[] = []; for (let index = 0; index < bytes.length; index += 32768) chunks.push(String.fromCharCode(...bytes.subarray(index, index + 32768))); content = btoa(chunks.join("")); }
      else content = await file.text();
      const result = await post<{ novelId: string }>("/imports", { filename: file.name, format: extension === "markdown" ? "md" : extension, content }); onDone(result.novelId);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setReading(false); }
  };
  return <SharedModal title="导入小说" onClose={onClose} actions={<><button className="btn" disabled={reading} onClick={onClose}>取消</button><button className="btn primary" disabled={!file || reading} onClick={() => void submit()}><Archive size={14}/>{reading ? "正在导入" : "导入"}</button></>}><div className="import-drop"><FileUp size={24}/><div className="field"><label>小说文件</label><input className="input" type="file" accept=".txt,.md,.markdown,.json,.zip" onChange={(event) => setFile(event.target.files?.[0] || null)}/></div></div><p className="modal-help">TXT和Markdown按章节标题切分；JSON或ZIP恢复完整项目。导入不会包含模型密钥。</p>{error && <span className="badge red">{error}</span>}</SharedModal>;
}

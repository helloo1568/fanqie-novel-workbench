import { AlertTriangle, ArrowRight, BookOpen, CheckCircle2, Gauge, Lock, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";
import type { Workspace } from "../workbench/useWorkbench";
import { Empty, formatNumber, PageHeader, Panel, timeAgo } from "../../components/ui";

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return <div className="stat"><div className="stat-label">{label}</div><div className="stat-value">{value}</div><div className="stat-note">{note}</div></div>;
}

export default function Overview({ data }: { data: Workspace }) {
  const pct = Math.round(data.novel.currentWords / Math.max(data.novel.targetWords, 1) * 100);
  const next = data.chapters.find((c) => c.status !== "已发布") || data.chapters.at(-1);
  const finalized = data.chapters.filter((c) => c.status === "定稿" || c.status === "已发布").length;
  const openForeshadows = data.foreshadows.filter((item) => item.status === "未回收");
  const pendingProposals = data.proposals.filter((item) => item.status === "待确认");
  const latestChapterNumber = Math.max(0, ...data.chapters.filter((chapter) => chapter.wordCount > 0).map((chapter) => chapter.number));
  const overdueForeshadows = openForeshadows.filter((item) => item.targetChapter && Number(item.targetChapter) < latestChapterNumber);
  return <div className="overview-page">
    <PageHeader title="创作总览" description={`${data.novel.genre} · ${data.novel.stage} · 最近更新 ${timeAgo(data.novel.updatedAt)}`} actions={<span className="badge green"><CheckCircle2 size={13}/>本地已保存</span>}/>
    <div className="overview-layout">
      <div className="overview-primary">
        <section className="resume-writing">
          {next ? <><div className="resume-meta"><span className="badge red">继续创作</span><span>上次编辑 {timeAgo(next.updatedAt)}</span></div><h2>第 {next.number} 章：{next.title}</h2><p>{String(next.outline["目标"] || next.summary || "先完善本章目标、冲突与结尾钩子。")}</p><div className="resume-actions"><Link className="btn primary" to={`/novel/${data.novel.id}/chapters?chapter=${next.id}`}>进入写作模式<ArrowRight size={16}/></Link><span>当前进度 <strong>{formatNumber(next.wordCount)} 字</strong></span></div></> : <Empty text="创建第一章，开始安排故事节奏。"/>}
        </section>
        <Panel title="需要处理" meta={<span>{pendingProposals.length + overdueForeshadows.length} 项</span>}>
          <div className="overview-tasks">
            {pendingProposals.slice(0, 2).map((item, index) => <div className="overview-task" key={String(item.id ?? index)}><span className="task-icon ai"><Sparkles size={16}/></span><div><strong>{String(item.title || "正文和已有设定不一致")}</strong><p>{String(item.evidence || "请选择保留原设定，还是采用正文中的新写法。")}</p></div><Link to={`/novel/${data.novel.id}/canon`}>选择</Link></div>)}
            {overdueForeshadows.slice(0, 2).map((item, index) => <div className="overview-task" key={String(item.id ?? index)}><span className="task-icon"><BookOpen size={16}/></span><div><strong>{String(item.title || "伏笔超过计划章节")}</strong><p>{String(item.description || "系统没有在计划章节找到明确兑现，请检查是否需要改期。")}</p></div><Link to={`/novel/${data.novel.id}/timeline`}>查看</Link></div>)}
            {!pendingProposals.length && !overdueForeshadows.length && <div className="overview-clear"><CheckCircle2 size={18}/><span>系统已自动整理，没有需要你处理的事项。</span></div>}
          </div>
        </Panel>
      </div>
      <aside className="overview-secondary">
        <section className="overview-progress"><div><span>全书总字数</span><strong>{formatNumber(data.novel.currentWords)}</strong></div><span className="badge gold"><Gauge size={13}/>{pct}%</span><div className="progress-track"><div className="progress-bar" style={{ width: `${Math.min(100, pct)}%` }}/></div><small>目标 {formatNumber(data.novel.targetWords)} 字</small></section>
        <section className="overview-mini-stats"><Stat label="章节" value={`${data.novel.chapterCount}`} note={`${finalized} 章已定稿`}/><Stat label="未回收伏笔" value={`${openForeshadows.length}`} note="持续追踪"/></section>
        {overdueForeshadows.length > 0 && <section className="overview-risk"><header><AlertTriangle size={17}/><strong>有伏笔超过计划</strong></header><p>{overdueForeshadows.length} 条伏笔已经超过预计兑现章节，系统没有找到明确回收。</p><Link to={`/novel/${data.novel.id}/timeline`}>查看伏笔进度</Link></section>}
        <Panel title="创作契约" meta={<span className="badge green"><Lock size={11}/>关键方向</span>}>{Object.entries(data.novel.contract).slice(0, 4).map(([key, value]) => <div className="outline-field" key={key}><strong>{key}</strong><p>{value || "待补充"}</p></div>)}</Panel>
      </aside>
    </div>
  </div>;
}

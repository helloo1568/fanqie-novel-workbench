import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, Lock, Save, Sparkles, Square } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { api, patch } from "../../api";
import Modal from "../../components/Modal";
import { PageHeader, Panel, TextArea } from "../../components/ui";
import type { Dict, PageProps } from "../../components/ui";
import type { Novel } from "@shared/types";
import { useDeepPlanning } from "./useDeepPlanning";

export default function Planning({ data, refresh, toast }: PageProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [contract, setContract] = useState(data.novel.contract);
  const [planning, setPlanning] = useState(data.novel.planning);
  const [deepPlanning, setDeepPlanning] = useState(() => searchParams.get("deep") === "1");
  const latestDeepPlanning = useQuery({
    queryKey: ["deep-planning-latest", data.novel.id],
    queryFn: () => api<Dict | null>(`/novels/${data.novel.id}/deep-planning/latest`),
    refetchInterval: 2500,
  });
  const deepStatus = String(latestDeepPlanning.data?.status || "");
  const hasVisibleDeepTask = ["排队中", "生成中", "待审核"].includes(deepStatus);
  const closeDeepPlanning = () => {
    setDeepPlanning(false);
    const next = new URLSearchParams(searchParams);
    next.delete("deep");
    setSearchParams(next, { replace: true });
    void latestDeepPlanning.refetch();
  };
  const knowledge = useQuery({ queryKey: ["knowledge-pack", data.novel.genre], queryFn: () => api<Dict>(`/knowledge-pack?taskType=策划&genre=${encodeURIComponent(data.novel.genre)}`) });
  const save = useMutation({
    mutationFn: () => patch<Novel>(`/novels/${data.novel.id}`, { version: data.novel.version, contract, planning }),
    onSuccess: () => { refresh(); toast("策划与创作契约已保存"); },
  });
  const contractKeys = ["核心卖点", "目标读者", "主角欲望", "核心矛盾", "金手指或关系驱动力", "差异化设定", "结局方向"];
  const planningKeys = ["书名", "简介", "黄金三章"];
  const knowledgeSkills = Array.isArray(knowledge.data?.skills) ? knowledge.data.skills as Dict[] : [];
  const selectedKnowledge = Array.isArray(knowledge.data?.selected) ? knowledge.data.selected as Dict[] : [];
  const selectedBySlug = new Map(selectedKnowledge.map((item) => [String(item.slug), item]));
  return <>
    <PageHeader
      title="开书策划"
      description="先锁定阅读承诺，再让大纲和章节为它服务。"
      actions={<div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button className="btn" onClick={() => setDeepPlanning(true)}><Sparkles size={15}/>AI 深度开书</button>
        <button className="btn primary" onClick={() => save.mutate()} disabled={save.isPending}><Save size={15}/>保存策划</button>
      </div>}
    />
    {hasVisibleDeepTask && !deepPlanning && <section className="deep-task-banner" role="status">
      <div><Sparkles size={18}/><span><strong>{deepStatus === "待审核" ? "开书方案已经完成" : "AI 正在后台开书"}</strong><small>{deepStatus === "待审核" ? "方案尚未写入作品，查看后直接应用即可。" : "可以继续处理其他内容，任务完成后会保留在这里。"}</small></span></div>
      <button className="btn primary" onClick={() => setDeepPlanning(true)}>{deepStatus === "待审核" ? "查看并应用" : "查看进度"}</button>
    </section>}
    <div className="grid-2">
      <Panel title="创作契约" meta={<span className="badge red"><Lock size={11}/>方向变更需确认</span>} bodyStyle={{ display: "grid", gap: 13 }}>
        {contractKeys.map((key) => (
          <div className="field" key={key}>
            <label>{key}</label>
            <TextArea style={{ minHeight: 70 }} value={contract[key] || ""} onChange={(e) => setContract({ ...contract, [key]: e.target.value })} />
          </div>
        ))}
      </Panel>
      <Panel title="对外包装与前三章" meta={<span className="badge gold">{data.novel.genre} 模板</span>} bodyStyle={{ display: "grid", gap: 13 }}>
        {planningKeys.map((key) => (
          <div className="field" key={key}>
            <label>{key}</label>
            <TextArea style={{ minHeight: key === "黄金三章" ? 150 : 90 }} value={planning[key] || ""} onChange={(e) => setPlanning({ ...planning, [key]: e.target.value })} />
          </div>
        ))}
      </Panel>
    </div>
    <Panel
      title="番茄写作知识包"
      style={{ marginTop: 14 }}
      meta={<span className={`badge ${knowledge.data?.available ? "green" : "red"}`}>{knowledge.data?.available ? `${knowledgeSkills.length} 项已加载 · 当前策划选 ${selectedKnowledge.length} 项` : "知识包加载失败"}</span>}
    >
      <p style={{ color: "var(--muted)", fontSize: 12, marginTop: 0 }}>{knowledge.data?.available ? "系统会按当前任务选择最相关的番茄长篇方法，避免无关内容挤占上下文。" : "内置知识包没有加载，请检查 .codex/skills 是否完整。基础功能仍可使用。"}</p>
      <div className="knowledge-pack-list">
        {knowledgeSkills.map((item) => {
          const selected = selectedBySlug.get(String(item.slug));
          return <div className="version-row knowledge-pack-row" key={String(item.slug)}>
            <div><strong>{String(item.title)}</strong><p>{String(item.description || item.slug)}</p></div>
            <span className={`badge ${selected ? "green" : ""}`.trim()}>{selected ? `当前任务已选 · ${String(selected.score ?? "-")}` : "已加载"}</span>
          </div>;
        })}
      </div>
    </Panel>
    {deepPlanning && <DeepPlanningModal data={data} onClose={closeDeepPlanning} onApplied={() => { closeDeepPlanning(); refresh(); toast("开书方案已写入作品"); }} />}
  </>;
}

function DeepPlanningModal({ data, onClose, onApplied }: { data: PageProps["data"]; onClose: () => void; onApplied: () => void }) {
  const defaultChapters = Math.max(30, Math.min(500, Math.round(data.novel.targetWords / 3000)));
  const [form, setForm] = useState({
    idea: data.novel.description || String(data.novel.contract["核心卖点"] || ""),
    targetReaders: String(data.novel.contract["目标读者"] || ""),
    desiredExperience: String(data.novel.contract["核心卖点"] || ""),
    protagonist: String(data.novel.contract["主角欲望"] || ""),
    mustHave: "",
    avoid: String(data.novel.contract["禁止偏航"] || ""),
    ending: String(data.novel.contract["结局方向"] || ""),
    targetChapters: defaultChapters,
  });
  const dp = useDeepPlanning(data.novel.id, onApplied);
  const positioning = (dp.proposal?.positioning || {}) as Dict;
  const structure = (dp.proposal?.structure || {}) as Dict;
  const audit = (dp.proposal?.audit || {}) as Dict;
  const localAudit = (dp.proposal?.localAudit || {}) as Dict;
  const volumes = Array.isArray(structure.volumes) ? structure.volumes as Dict[] : [];
  const chapters = Array.isArray(dp.proposal?.chapters) ? dp.proposal.chapters as Dict[] : [];
  const sectionLabels: Record<string, string> = { positioning: "定位与创作契约", canon: "故事圣经", structure: "分卷与情节弧", chapters: "前30章章纲", foreshadows: "伏笔台账" };
  const actions = dp.proposal
    ? <><button className="btn" onClick={() => dp.reset()}>重新生成</button><button className="btn primary" disabled={!Object.values(dp.sections).some(Boolean)} onClick={() => void dp.apply(data.novel.version)}><Check size={14}/>应用所选分区</button></>
    : dp.running
      ? <><button className="btn" onClick={onClose}>后台继续</button><button className="btn danger" onClick={() => dp.stop()}><Square size={14}/>停止</button></>
      : <><button className="btn" onClick={onClose}>取消</button><button className="btn primary" disabled={!form.idea.trim()} onClick={() => void dp.start(form)}><Sparkles size={14}/>开始深度策划</button></>;
  return <Modal title="AI 深度开书" wide onClose={onClose} actions={actions}>
    {!dp.runId && !dp.proposal && (
      <div className="deep-interview">
        <div className="field"><label>核心想法</label><TextArea autoFocus value={form.idea} onChange={(e) => setForm({ ...form, idea: e.target.value })} placeholder="题材、主角、开局事件和你最想保留的感觉" /></div>
        <div className="field-row">
          <div className="field"><label>目标读者</label><input className="input" value={form.targetReaders} onChange={(e) => setForm({ ...form, targetReaders: e.target.value })} /></div>
          <div className="field"><label>目标章节</label><input className="input" type="number" min={30} max={500} value={form.targetChapters} onChange={(e) => setForm({ ...form, targetChapters: Number(e.target.value) })} /></div>
        </div>
        <div className="field-row">
          <div className="field"><label>核心体验</label><TextArea value={form.desiredExperience} onChange={(e) => setForm({ ...form, desiredExperience: e.target.value })} /></div>
          <div className="field"><label>主角与长期欲望</label><TextArea value={form.protagonist} onChange={(e) => setForm({ ...form, protagonist: e.target.value })} /></div>
        </div>
        <div className="field-row">
          <div className="field"><label>必须包含</label><TextArea value={form.mustHave} onChange={(e) => setForm({ ...form, mustHave: e.target.value })} /></div>
          <div className="field"><label>明确避开</label><TextArea value={form.avoid} onChange={(e) => setForm({ ...form, avoid: e.target.value })} /></div>
        </div>
        <div className="field"><label>结局方向</label><input className="input" value={form.ending} onChange={(e) => setForm({ ...form, ending: e.target.value })} /></div>
        <p className="deep-note">任务会依次完成商业定位、故事圣经、分卷结构、前30章和独立审稿。所有结果先成为候选，不会覆盖现有内容。</p>
      </div>
    )}
    {dp.runId && !dp.proposal && (
      <div className="deep-running"><div className="score">{Math.max(0, Math.min(100, dp.progress))}%</div><div><strong>{dp.phase}</strong><p>任务记录已持久化，可以关闭窗口让它在后台继续。</p></div></div>
    )}
    {dp.proposal && (
      <div className="deep-review">
        <div className="deep-audit"><div className="score">{Number(audit.score || localAudit.score || 0)}</div><div><strong>独立审稿</strong><p>{Array.isArray(audit.blockers) && audit.blockers.length ? `${audit.blockers.length} 个阻塞项，建议先查看后再决定入库分区。` : "未发现必须阻止入库的问题。"}</p></div></div>
        {dp.error && <span className="badge red">{dp.error}</span>}
        <div className="deep-sections">{Object.entries(sectionLabels).map(([key, label]) => <label className="check-row" key={key}><input type="checkbox" checked={dp.sections[key]} onChange={(e) => dp.setSections({ ...dp.sections, [key]: e.target.checked })} /><span>{label}</span></label>)}</div>
        {data.chapters.length > 0 && <p className="deep-note">当前小说已有 {data.chapters.length} 章。结构入库只补充缺失编号和同名不存在的设定，不覆盖现有章节、分卷或正式设定。</p>}
        <div className="deep-summary">
          <section><span>推荐书名</span><strong>{String(positioning.title || "-")}</strong><p>{String(positioning.pitch || "")}</p></section>
          <section><span>目标读者与承诺</span><strong>{String(positioning.targetReaders || "-")}</strong><p>{String(positioning.corePromise || "")}</p></section>
        </div>
        <div><h4>分卷结构</h4><div className="deep-list">{volumes.map((volume) => <div className="version-row" key={String(volume.number)}><div><strong>{String(volume.number)}. {String(volume.title)}</strong><p>{String(volume.goal)}</p></div><span className="badge">{Array.isArray(volume.arcs) ? volume.arcs.length : 0} 弧</span></div>)}</div></div>
        <div><h4>前期章纲</h4><div className="deep-chapters">{chapters.map((chapter) => <div key={String(chapter.number)}><strong>{String(chapter.number)}. {String(chapter.title)}</strong><span>{String((chapter.outline as Dict)?.stateChange || "")}</span></div>)}</div></div>
        {Array.isArray(audit.issues) && audit.issues.length > 0 && <div><h4>审稿问题</h4>{(audit.issues as Dict[]).map((issue, index) => <div className="issue" key={index}><div className="issue-head"><span>{String(issue.section)}</span><span className={`badge ${issue.severity === "高" ? "red" : "gold"}`}>{String(issue.severity)}</span></div><p>{String(issue.problem)}</p><p style={{ color: "var(--green)" }}>{String(issue.suggestion)}</p></div>)}</div>}
      </div>
    )}
    {dp.error && !dp.proposal && <span className="badge red">{dp.error}</span>}
  </Modal>;
}

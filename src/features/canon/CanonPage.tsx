import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Check, Lock, Plus, Search, Unlock, X } from "lucide-react";
import { patch, post } from "../../api";
import Modal from "../../components/Modal";
import { Empty, FormField, FormRow, PageHeader, Panel, Select, TextArea, TextInput } from "../../components/ui";
import type { PageProps } from "../../components/ui";
import type { CanonEntity, CanonKind } from "@shared/types";
import { canonKinds } from "@shared/types";

export default function Canon({ data, refresh, toast }: PageProps) {
  const [kind, setKind] = useState<string>("全部");
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState("");
  const items = data.canon.filter((x) => (kind === "全部" || x.kind === kind) && `${x.name}${x.summary}`.includes(search));
  const pendingConflicts = data.proposals.filter((proposal) => proposal.status === "待确认");
  const toggle = useMutation({
    mutationFn: (entity: CanonEntity) => patch(`/canon/${entity.id}`, { ...entity, locked: !entity.locked }),
    onSuccess: () => { refresh(); toast("设定锁定状态已更新"); },
  });
  const reviewProposal = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => patch(`/proposals/${id}`, { status }),
    onSuccess: () => { refresh(); toast("已处理，后续章节会自动使用这个结果"); },
  });
  return <>
    <PageHeader title="故事圣经" description="定稿后，人物状态、时间线和伏笔会自动整理；这里只保留长期有效的核心设定。" actions={<button className="btn primary" onClick={() => setCreating(true)}><Plus size={15}/>添加设定</button>} />
    <div className="canon-grid">
      <aside className="panel filter-list">
        <button className={`filter-btn ${kind === "全部" ? "active" : ""}`} onClick={() => setKind("全部")}><span>全部</span><span>{data.canon.length}</span></button>
        {canonKinds.map((x) => (
          <button className={`filter-btn ${kind === x ? "active" : ""}`} key={x} onClick={() => setKind(x)}><span>{x}</span><span>{data.canon.filter((e) => e.kind === x).length}</span></button>
        ))}
      </aside>
      <section>
        <div style={{ position: "relative", marginBottom: 12 }}>
          <Search size={15} style={{ position: "absolute", left: 10, top: 10, color: "var(--muted)" }} />
          <TextInput placeholder="搜索人物、规则或地点" value={search} onChange={(e) => setSearch(e.target.value)} style={{ paddingLeft: 34 }} />
        </div>
        <div className="entity-list">
          {items.map((entity) => (
            <article className="entity" key={entity.id}>
              <div className="entity-top">
                <div><span className="badge">{entity.kind}</span><h4 style={{ marginTop: 8 }}>{entity.name}</h4></div>
                <button className="btn icon" title={entity.locked ? "解除锁定" : "锁定核心设定"} aria-label={entity.locked ? "解除锁定" : "锁定核心设定"} onClick={() => toggle.mutate(entity)}>
                  {entity.locked ? <Lock size={14}/> : <Unlock size={14}/>}
                </button>
              </div>
              <p>{entity.summary || "尚未填写说明"}</p>
            </article>
          ))}
        </div>
        {!items.length && <Empty text="当前分类没有设定。" />}
      </section>
    </div>
    {pendingConflicts.length > 0 && (
      <Panel title="需要你决定" meta={<span className="badge gold">发现 {pendingConflicts.length} 处前后不一致</span>} style={{ marginTop: 16 }}>
        {pendingConflicts.map((proposal) => (
          <div className="entity" style={{ marginBottom: 9 }} key={String(proposal.id)}>
            <div className="entity-top">
              <div><span className="badge">{String(proposal.type)}</span><h4 style={{ marginTop: 7 }}>{String(proposal.title)}</h4></div>
              <div style={{ display: "flex", gap: 6 }}>
                <button className="btn" onClick={() => reviewProposal.mutate({ id: String(proposal.id), status: "已拒绝" })}><X size={13}/>保留原设定</button>
                <button className="btn primary" onClick={() => reviewProposal.mutate({ id: String(proposal.id), status: "已确认" })}><Check size={13}/>采用正文写法</button>
              </div>
            </div>
            <p>{String(proposal.afterValue)}</p>
            <p style={{ color: "var(--muted)" }}>正文依据：{String(proposal.evidence)}</p>
          </div>
        ))}
      </Panel>
    )}
    {creating && <CreateCanon novelId={data.novel.id} onClose={() => setCreating(false)} onDone={() => { setCreating(false); refresh(); toast("设定已加入故事圣经"); }} />}
  </>;
}

function CreateCanon({ novelId, onClose, onDone }: { novelId: string; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({ kind: "人物" as CanonKind, name: "", summary: "", locked: false });
  const save = useMutation({ mutationFn: () => post(`/novels/${novelId}/canon`, form), onSuccess: onDone });
  return <Modal title="添加正式设定" onClose={onClose} actions={<><button className="btn" onClick={onClose}>取消</button><button className="btn primary" disabled={!form.name.trim() || save.isPending} onClick={() => save.mutate()}><Check size={14}/>确认入库</button></>}>
    <FormRow>
      <FormField label="类型"><Select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as CanonKind })}>{canonKinds.map((x) => <option key={x}>{x}</option>)}</Select></FormField>
      <FormField label="名称"><TextInput autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></FormField>
    </FormRow>
    <FormField label="核心说明"><TextArea value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} placeholder="写入不会轻易变化、后续必须遵守的事实" /></FormField>
    <label className="check-row"><input type="checkbox" checked={form.locked} onChange={(e) => setForm({ ...form, locked: e.target.checked })}/>作为核心设定锁定</label>
    {save.error && <span className="badge red">{save.error.message}</span>}
  </Modal>;
}

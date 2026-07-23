import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Check, Plus } from "lucide-react";
import { patch, post } from "../../api";
import Modal from "../../components/Modal";
import { FormField, FormRow, PageHeader, Panel, Select, TextArea, TextInput } from "../../components/ui";
import type { PageProps } from "../../components/ui";

export default function Timeline({ data, refresh, toast }: PageProps) {
  const [creating, setCreating] = useState(false);
  const resolve = useMutation({
    mutationFn: (id: string) => patch(`/foreshadows/${id}`, { status: "已回收" }),
    onSuccess: () => { refresh(); toast("伏笔已标记回收"); },
  });
  return <>
    <PageHeader title="伏笔与时间线" description="系统会在每章定稿后自动记录新增、推进和回收；你也可以手动补充重要安排。" actions={<button className="btn primary" onClick={() => setCreating(true)}><Plus size={15}/>补充伏笔</button>} />
    <div className="grid-2">
      <Panel title="伏笔进度" meta={<span className="badge gold">{data.foreshadows.filter((x) => x.status === "未回收").length} 条进行中</span>}>
        <div className="table-wrap"><table className="table">
          <thead><tr><th>伏笔</th><th>重要度</th><th>目标</th><th></th></tr></thead>
          <tbody>{data.foreshadows.map((item) => (
            <tr key={String(item.id)}>
              <td><strong>{String(item.title)}</strong><div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>{String(item.description)}</div></td>
              <td><span className={`badge ${item.importance === "高" ? "red" : "gold"}`}>{String(item.importance)}</span></td>
              <td>{item.targetChapter ? `第 ${String(item.targetChapter)} 章` : "待定"}</td>
              <td>{item.status === "未回收" ? <button className="btn" onClick={() => resolve.mutate(String(item.id))}><Check size={13}/>标记已兑现</button> : <span className="badge green">已兑现</span>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      </Panel>
      <Panel title="故事时间线" meta={<span className="badge">{data.timeline.length} 个事件</span>}>
        <div className="timeline">
          {data.timeline.length ? data.timeline.map((item) => (
            <div className="timeline-item" key={String(item.id)}>
              <span className="badge">{String(item.timeLabel)}</span>
              <h4>{String(item.title)}</h4>
              <p>{String(item.description)}</p>
            </div>
          )) : <div className="timeline-item">
            <span className="badge">故事开始</span>
            <h4>等待第一条事件</h4>
            <p>章节定稿后，确认的时间推进会出现在这里。</p>
          </div>}
        </div>
      </Panel>
    </div>
    {creating && <CreateForeshadow novelId={data.novel.id} onClose={() => setCreating(false)} onDone={() => { setCreating(false); refresh(); toast("伏笔已加入台账"); }} />}
  </>;
}

function CreateForeshadow({ novelId, onClose, onDone }: { novelId: string; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({ title: "", description: "", targetChapter: 30, importance: "中" });
  const save = useMutation({ mutationFn: () => post(`/novels/${novelId}/foreshadows`, form), onSuccess: onDone });
  return <Modal title="记录伏笔" onClose={onClose} actions={<><button className="btn" onClick={onClose}>取消</button><button className="btn primary" disabled={!form.title || save.isPending} onClick={() => save.mutate()}>保存伏笔</button></>}>
    <FormField label="伏笔名称"><TextInput autoFocus value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></FormField>
    <FormField label="具体内容"><TextArea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></FormField>
    <FormRow>
      <FormField label="预计回收章节"><TextInput type="number" value={form.targetChapter} onChange={(e) => setForm({ ...form, targetChapter: Number(e.target.value) })} /></FormField>
      <FormField label="重要度"><Select value={form.importance} onChange={(e) => setForm({ ...form, importance: e.target.value })}><option>高</option><option>中</option><option>低</option></Select></FormField>
    </FormRow>
    {save.error && <span className="badge red">{save.error.message}</span>}
  </Modal>;
}

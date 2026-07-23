import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { BookText, FileText, Plus, Save, Trash2 } from "lucide-react";
import { patch, post, remove } from "../../api";
import Modal from "../../components/Modal";
import { FormField, FormRow, PageHeader, Panel, Select, TextArea, TextInput } from "../../components/ui";
import type { Dict, PageProps } from "../../components/ui";

export default function Outline({ data, refresh, toast, navigateChapter }: PageProps & { navigateChapter: () => void }) {
  const [volumeEditor, setVolumeEditor] = useState<Dict | null>(null);
  const [arcEditor, setArcEditor] = useState<Dict | null>(null);
  const deleteVolumeMutation = useMutation({
    mutationFn: (id: string) => remove(`/volumes/${id}`),
    onSuccess: () => { refresh(); toast("分卷已删除"); },
    onError: (error) => toast(`无法删除：${error.message}`),
  });
  const deleteArcMutation = useMutation({
    mutationFn: (id: string) => remove(`/arcs/${id}`),
    onSuccess: () => { refresh(); toast("情节弧已删除"); },
    onError: (error) => toast(`无法删除：${error.message}`),
  });
  return <>
    <PageHeader
      title="四层大纲"
      description="全书方向由创作契约承担，这里维护分卷、情节弧和章节任务。"
      actions={<div style={{ display: "flex", gap: 8 }}>
        <button className="btn" onClick={() => setVolumeEditor({ novelId: data.novel.id, number: data.volumes.length + 1, title: `第${data.volumes.length + 1}卷`, goal: "", conflict: "", turningPoints: [] })}><Plus size={14}/>新分卷</button>
        <button className="btn primary" onClick={navigateChapter}><BookText size={15}/>进入章节</button>
      </div>}
    />
    {data.volumes.map((volume) => (
      <Panel
        key={String(volume.id)}
        style={{ marginBottom: 14 }}
        title={<><span className="badge gold">第 {String(volume.number)} 卷</span> <strong style={{ fontSize: 14 }}>{String(volume.title)}</strong></>}
        meta={<span className="badge">{data.chapters.filter((c) => c.volumeId === volume.id).length} 章</span>}
        actions={<div style={{ display: "flex", gap: 6 }}>
          <button className="btn icon" title="编辑分卷" aria-label={`编辑分卷：${String(volume.title)}`} onClick={() => setVolumeEditor(volume)}><FileText size={13}/></button>
          <button className="btn icon" title="新增情节弧" aria-label={`为${String(volume.title)}新增情节弧`} onClick={() => setArcEditor({ novelId: data.novel.id, volumeId: volume.id, title: "新情节弧", goal: "", conflict: "", payoff: "", hooks: "" })}><Plus size={13}/></button>
          <button className="btn icon danger" title="删除空分卷" aria-label={`删除空分卷：${String(volume.title)}`} onClick={() => deleteVolumeMutation.mutate(String(volume.id))}><Trash2 size={13}/></button>
        </div>}
      >
        <div className="grid-2" style={{ marginBottom: 14 }}>
          <div className="outline-field"><strong>分卷目标</strong><p>{String(volume.goal || "待补充")}</p></div>
          <div className="outline-field"><strong>核心冲突</strong><p>{String(volume.conflict || "待补充")}</p></div>
        </div>
        {data.arcs.filter((arc) => arc.volumeId === volume.id).map((arc) => (
          <div className="arc-row" key={String(arc.id)}>
            <div><strong>{String(arc.title)}</strong><p>{String(arc.goal)} · 兑现：{String(arc.payoff || "待定义")}</p></div>
            <div style={{ display: "flex", gap: 5 }}>
              <button className="btn icon" title="编辑情节弧" aria-label={`编辑情节弧：${String(arc.title)}`} onClick={() => setArcEditor(arc)}><FileText size={13}/></button>
              <button className="btn icon danger" title="删除空情节弧" aria-label={`删除空情节弧：${String(arc.title)}`} onClick={() => deleteArcMutation.mutate(String(arc.id))}><Trash2 size={13}/></button>
            </div>
          </div>
        ))}
        <div className="table-wrap"><table className="table">
          <thead><tr><th>章节</th><th>目标</th><th>冲突</th><th>结尾钩子</th><th>状态</th></tr></thead>
          <tbody>{data.chapters.filter((c) => c.volumeId === volume.id).map((chapter) => (
            <tr key={chapter.id}>
              <td><strong>{chapter.number}. {chapter.title}</strong></td>
              <td>{String(chapter.outline["目标"] || "-")}</td>
              <td>{String(chapter.outline["冲突"] || "-")}</td>
              <td>{String(chapter.outline["结尾钩子"] || "-")}</td>
              <td><span className="badge">{chapter.status}</span></td>
            </tr>
          ))}</tbody>
        </table></div>
      </Panel>
    ))}
    {volumeEditor && <VolumeModal value={volumeEditor} onClose={() => setVolumeEditor(null)} onDone={() => { setVolumeEditor(null); refresh(); toast("分卷已保存"); }} />}
    {arcEditor && <ArcModal value={arcEditor} volumes={data.volumes} onClose={() => setArcEditor(null)} onDone={() => { setArcEditor(null); refresh(); toast("情节弧已保存"); }} />}
  </>;
}

function VolumeModal({ value, onClose, onDone }: { value: Dict; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({
    number: Number(value.number || 1),
    title: String(value.title || ""),
    goal: String(value.goal || ""),
    conflict: String(value.conflict || ""),
    turningPoints: Array.isArray(value.turningPoints) ? value.turningPoints.join("\n") : "",
  });
  const save = useMutation({
    mutationFn: () => value.id
      ? patch(`/volumes/${String(value.id)}`, { ...form, turningPoints: form.turningPoints.split(/\n+/).filter(Boolean), version: value.version })
      : post(`/novels/${String(value.novelId)}/volumes`, { ...form, turningPoints: form.turningPoints.split(/\n+/).filter(Boolean) }),
    onSuccess: onDone,
  });
  return <Modal title={value.id ? "编辑分卷" : "新建分卷"} onClose={onClose} actions={<><button className="btn" onClick={onClose}>取消</button><button className="btn primary" disabled={!form.title.trim() || save.isPending} onClick={() => save.mutate()}><Save size={14}/>保存</button></>}>
    <FormRow>
      <FormField label="卷序"><TextInput type="number" value={form.number} onChange={(e) => setForm({ ...form, number: Number(e.target.value) })} /></FormField>
      <FormField label="卷名"><TextInput value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></FormField>
    </FormRow>
    <FormField label="分卷目标"><TextArea value={form.goal} onChange={(e) => setForm({ ...form, goal: e.target.value })} /></FormField>
    <FormField label="核心冲突"><TextArea value={form.conflict} onChange={(e) => setForm({ ...form, conflict: e.target.value })} /></FormField>
    <FormField label="关键转折（每行一个）"><TextArea value={form.turningPoints} onChange={(e) => setForm({ ...form, turningPoints: e.target.value })} /></FormField>
    {save.error && <span className="badge red">{save.error.message}</span>}
  </Modal>;
}

function ArcModal({ value, volumes, onClose, onDone }: { value: Dict; volumes: Dict[]; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({
    volumeId: String(value.volumeId || volumes[0]?.id || ""),
    title: String(value.title || ""),
    goal: String(value.goal || ""),
    conflict: String(value.conflict || ""),
    payoff: String(value.payoff || ""),
    hooks: String(value.hooks || ""),
  });
  const save = useMutation({
    mutationFn: () => value.id ? patch(`/arcs/${String(value.id)}`, { ...form, version: value.version }) : post(`/novels/${String(value.novelId)}/arcs`, form),
    onSuccess: onDone,
  });
  return <Modal title={value.id ? "编辑情节弧" : "新建情节弧"} onClose={onClose} actions={<><button className="btn" onClick={onClose}>取消</button><button className="btn primary" disabled={!form.title.trim() || !form.volumeId || save.isPending} onClick={() => save.mutate()}><Save size={14}/>保存</button></>}>
    <FormField label="所属分卷"><Select value={form.volumeId} onChange={(e) => setForm({ ...form, volumeId: e.target.value })}>{volumes.map((item) => <option key={String(item.id)} value={String(item.id)}>{String(item.number)}. {String(item.title)}</option>)}</Select></FormField>
    <FormField label="情节弧名称"><TextInput value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></FormField>
    <FormField label="目标"><TextArea value={form.goal} onChange={(e) => setForm({ ...form, goal: e.target.value })} /></FormField>
    <FormField label="冲突"><TextArea value={form.conflict} onChange={(e) => setForm({ ...form, conflict: e.target.value })} /></FormField>
    <FormRow>
      <FormField label="兑现"><TextInput value={form.payoff} onChange={(e) => setForm({ ...form, payoff: e.target.value })} /></FormField>
      <FormField label="遗留钩子"><TextInput value={form.hooks} onChange={(e) => setForm({ ...form, hooks: e.target.value })} /></FormField>
    </FormRow>
    {save.error && <span className="badge red">{save.error.message}</span>}
  </Modal>;
}

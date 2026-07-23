import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Archive, Clipboard, Database, Download, FileText, Save } from "lucide-react";
import { post } from "../../api";
import Modal from "../../components/Modal";
import { FormField, FormRow, PageHeader, Panel, Select, TextArea, TextInput } from "../../components/ui";
import type { Dict, PageProps } from "../../components/ui";
import type { Chapter } from "@shared/types";

export default function Publish({ data, refresh, toast }: PageProps) {
  const [editing, setEditing] = useState<{ chapter: Chapter; record?: Dict } | null>(null);
  const copyText = async (chapter: Chapter) => {
    await navigator.clipboard.writeText(`${chapter.title}\n\n${chapter.draft}`);
    toast("章节标题与正文已复制");
  };
  return <>
    <PageHeader
      title="发布与导出"
      description="这里生成干净正文并手工追踪番茄发布状态，不操作作者后台。"
      actions={
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <a className="btn" href={`/api/novels/${data.novel.id}/export?format=txt`}><Download size={14}/>TXT</a>
          <a className="btn" href={`/api/novels/${data.novel.id}/export?format=md`}><FileText size={14}/>Markdown</a>
          <a className="btn" href={`/api/novels/${data.novel.id}/export?format=json`}><Database size={14}/>项目 JSON</a>
          <a className="btn primary" href={`/api/novels/${data.novel.id}/export?format=zip`}><Archive size={14}/>完整整书包</a>
        </div>
      }
    />
    <Panel title="章节发布清单" meta={<span className="badge green">正文不含内部提示词</span>}>
      <div className="table-wrap"><table className="table">
        <thead><tr><th>章节</th><th>字数</th><th>创作状态</th><th>发布状态</th><th>番茄编号</th><th></th></tr></thead>
        <tbody>{data.chapters.map((chapter) => {
          const record = data.publications.find((x) => x.chapterId === chapter.id);
          return <tr key={chapter.id}>
            <td><strong>{chapter.title}</strong></td>
            <td>{chapter.wordCount}</td>
            <td><span className="badge">{chapter.status}</span></td>
            <td><span className={`badge ${record?.status === "已发布" || chapter.status === "已发布" ? "green" : "gold"}`}>{String(record?.status || "待发布")}</span></td>
            <td>{String(record?.platformChapterId || "-")}</td>
            <td><div style={{ display: "flex", gap: 5 }}>
              <button className="btn" disabled={!chapter.draft} onClick={() => void copyText(chapter)}><Clipboard size={13}/>复制</button>
              <button className="btn" onClick={() => setEditing({ chapter, record })}>记录</button>
            </div></td>
          </tr>;
        })}</tbody>
      </table></div>
    </Panel>
    {editing && <PublicationModal value={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); refresh(); toast("发布记录已保存"); }} />}
  </>;
}

function PublicationModal({ value, onClose, onDone }: { value: { chapter: Chapter; record?: Dict }; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({
    status: String(value.record?.status || "待发布"),
    platformChapterId: String(value.record?.platformChapterId || ""),
    publishedAt: value.record?.publishedAt ? String(value.record.publishedAt).slice(0, 16) : "",
    note: String(value.record?.note || ""),
  });
  const save = useMutation({
    mutationFn: () => post(`/chapters/${value.chapter.id}/publication`, {
      ...form,
      publishedAt: form.publishedAt ? new Date(form.publishedAt).toISOString() : null,
    }),
    onSuccess: onDone,
  });
  return <Modal title={`发布记录 · ${value.chapter.title}`} onClose={onClose} actions={<><button className="btn" onClick={onClose}>取消</button><button className="btn primary" disabled={save.isPending} onClick={() => save.mutate()}><Save size={14}/>保存</button></>}>
    <FormRow>
      <FormField label="状态"><Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}><option>待发布</option><option>已发布</option><option>需修改</option></Select></FormField>
      <FormField label="番茄章节编号"><TextInput value={form.platformChapterId} onChange={(e) => setForm({ ...form, platformChapterId: e.target.value })} /></FormField>
    </FormRow>
    <FormField label="发布时间"><TextInput type="datetime-local" value={form.publishedAt} onChange={(e) => setForm({ ...form, publishedAt: e.target.value })} /></FormField>
    <FormField label="备注"><TextArea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></FormField>
    {save.error && <span className="badge red">{save.error.message}</span>}
  </Modal>;
}

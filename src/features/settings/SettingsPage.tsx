import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Database, KeyRound, Plus, Save, Trash2 } from "lucide-react";
import { api, patch, post, remove } from "../../api";
import Modal from "../../components/Modal";
import { Empty, FormField, FormRow, PageHeader, Panel, Select, Skeleton, TextArea, TextInput } from "../../components/ui";
import type { Dict, PageProps } from "../../components/ui";
import type { Novel } from "@shared/types";

// 仅列出服务端实际读取的 4 类路由（"章纲"/"摘要"从不被 selectedProvider 读取，避免误导）
const TASK_TYPES: Array<{ key: string; hint: string }> = [
  { key: "策划", hint: "深度开书" },
  { key: "正文", hint: "生成/改写/定点二稿" },
  { key: "事实抽取", hint: "接受候选稿后的记忆抽取" },
  { key: "质检", hint: "语义质检" },
];

const PROVIDER_PRESETS = [
  { key: "custom", name: "自定义 OpenAI 兼容", baseUrl: "", model: "" },
  { key: "openai", name: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4.1-mini" },
  { key: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com", model: "deepseek-chat" },
  { key: "qwen", name: "阿里云百炼 / 通义千问", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus" },
  { key: "moonshot", name: "Moonshot / Kimi", baseUrl: "https://api.moonshot.cn/v1", model: "" },
  { key: "siliconflow", name: "硅基流动", baseUrl: "https://api.siliconflow.cn/v1", model: "" },
  { key: "openrouter", name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", model: "" },
  { key: "volcengine", name: "火山方舟", baseUrl: "https://ark.cn-beijing.volces.com/api/v3", model: "" },
] as const;

export default function SettingsPage({ data, refresh, toast }: PageProps) {
  const qc = useQueryClient();
  const providers = useQuery({ queryKey: ["providers"], queryFn: () => api<Dict[]>("/providers") });
  const snapshots = useQuery({ queryKey: ["snapshots"], queryFn: () => api<Dict[]>("/snapshots") });
  const prompts = useQuery({ queryKey: ["prompts", data.novel.id], queryFn: () => api<Dict[]>(`/prompts?novelId=${data.novel.id}`) });
  const runs = useQuery({ queryKey: ["generation-runs", data.novel.id], queryFn: () => api<Dict[]>(`/novels/${data.novel.id}/generations`) });
  const [providerEditor, setProviderEditor] = useState<Dict | null>(null);
  const [promptEditor, setPromptEditor] = useState<Dict | null>(null);
  const [preview, setPreview] = useState("");
  const [snapshotDetail, setSnapshotDetail] = useState<Dict | null>(null);
  const [routes, setRoutes] = useState(data.novel.modelOverrides);
  useEffect(() => setRoutes(data.novel.modelOverrides), [data.novel.modelOverrides]);

  const snapshot = useMutation({ mutationFn: () => post<Dict>("/snapshots", { kind: "手动" }), onSuccess: () => { void qc.invalidateQueries({ queryKey: ["snapshots"] }); toast("数据库快照已完成"); } });
  const restore = useMutation({ mutationFn: (id: string) => post<Dict>(`/snapshots/${id}/restore`, {}), onSuccess: () => { toast("快照已恢复，即将返回书库"); window.setTimeout(() => { window.location.href = "/"; }, 800); }, onError: (error) => toast(`恢复失败：${error.message}`) });
  const saveRoutes = useMutation({ mutationFn: () => patch<Novel>(`/novels/${data.novel.id}`, { version: data.novel.version, modelOverrides: routes }), onSuccess: () => { refresh(); toast("模型路由已保存"); } });
  const test = useMutation({ mutationFn: (id: string) => post<Dict>(`/providers/${id}/test`, {}), onSuccess: (result) => toast(`连接成功，耗时${result.durationMs}毫秒`), onError: (error) => toast(`连接失败：${error.message}`) });
  const destroyProvider = useMutation({ mutationFn: (id: string) => remove(`/providers/${id}`), onSuccess: () => { void providers.refetch(); toast("供应商已删除"); } });
  const destroyPrompt = useMutation({ mutationFn: (id: string) => remove(`/prompts/${id}`), onSuccess: () => { void prompts.refetch(); toast("提示词已删除"); } });

  const showPreview = async (taskType: string) => {
    const chapter = data.chapters[0];
    if (!chapter) return;
    const result = await post<{ prompt: string }>(`/chapters/${chapter.id}/prompt-preview`, { taskType });
    setPreview(result.prompt);
  };

  return <>
    <PageHeader title="模型与数据" description="管理供应商、任务路由、提示词、调用记录和本地快照。" />
    <div className="grid-2">
      <Panel
        title="自定义大模型"
        meta={<span className="badge green">OpenAI 兼容接口</span>}
        actions={<button className="btn" onClick={() => setProviderEditor({ name: "自定义模型", baseUrl: "", model: "", inputPrice: 0, outputPrice: 0, enabled: 1 })}><Plus size={14}/>接入模型</button>}
      >
        <p style={{ color: "var(--muted)", fontSize: 12, margin: "0 0 12px" }}>可填写自己的 API 地址、模型名称和密钥。密钥加密保存在本机；保存后先测试连接，再在“任务路由”中分配用途。</p>
        {providers.isLoading && <Skeleton lines={3} />}
        {providers.data?.map((provider) => (
          <div className="entity" key={String(provider.id)} style={{ marginBottom: 9 }}>
            <div className="entity-top">
              <div><h4>{String(provider.name)}</h4><p>{String(provider.model)} · {provider.enabled ? "已启用" : "已停用"}</p></div>
              <span className={`badge ${provider.hasKey ? "green" : "gold"}`}><KeyRound size={11}/>{provider.hasKey ? "密钥已保存" : "演示模式"}</span>
            </div>
            <p>{String(provider.baseUrl)}</p>
            <div style={{ display: "flex", gap: 6 }}>
              <button className="btn" disabled={test.isPending} onClick={() => test.mutate(String(provider.id))}>测试</button>
              <button className="btn" onClick={() => setProviderEditor(provider)}>编辑</button>
              <button className="btn danger" onClick={() => destroyProvider.mutate(String(provider.id))}>删除</button>
            </div>
          </div>
        ))}
        {!providers.isLoading && !providers.data?.length && <Empty text="尚未配置供应商。" />}
      </Panel>

      <Panel
        title="任务路由"
        actions={<button className="btn" disabled={saveRoutes.isPending} onClick={() => saveRoutes.mutate()}><Save size={14}/>保存</button>}
      >
        <p style={{ color: "var(--muted)", fontSize: 12, margin: "0 0 12px" }}>为每类任务指定优先使用的供应商；留空则使用首个启用的供应商。章节生成时也可在编辑栏临时切换模型。</p>
        {TASK_TYPES.map(({ key, hint }) => (
          <FormField
            key={key}
            label={<>{key}<span style={{ color: "var(--faint)", fontWeight: 400, marginLeft: 6 }}>· {hint}</span></>}
          >
            <Select value={routes[key] || ""} onChange={(e) => setRoutes({ ...routes, [key]: e.target.value })}>
              <option value="">默认启用供应商</option>
              {providers.data?.filter((item) => item.enabled).map((item) => <option value={String(item.id)} key={String(item.id)}>{String(item.name)} / {String(item.model)}</option>)}
            </Select>
          </FormField>
        ))}
      </Panel>

      <Panel
        title="提示词规则"
        actions={<button className="btn" onClick={() => setPromptEditor({ scope: "novel", novelId: data.novel.id, taskType: "正文", name: "本书补充规则", content: "" })}><Plus size={14}/>添加</button>}
      >
        {prompts.data?.map((item) => (
          <div className="version-row" key={String(item.id)}>
            <div><strong>{String(item.name)}</strong><p>{String(item.taskType)} · {item.scope === "global" ? "全局" : "本书"}</p></div>
            <div style={{ display: "flex", gap: 5 }}>
              <button className="btn" onClick={() => void showPreview(String(item.taskType))}>预览</button>
              <button className="btn" onClick={() => setPromptEditor(item)}>编辑</button>
              <button className="btn icon danger" title="删除" aria-label="删除提示词" onClick={() => destroyPrompt.mutate(String(item.id))}><Trash2 size={13}/></button>
            </div>
          </div>
        ))}
        {!prompts.data?.length && <p style={{ color: "var(--muted)", fontSize: 12 }}>当前使用系统默认提示词。</p>}
      </Panel>

      <Panel
        title="数据库快照"
        actions={<button className="btn" disabled={snapshot.isPending} onClick={() => snapshot.mutate()}><Database size={14}/>{snapshot.isPending ? "备份中" : "立即快照"}</button>}
      >
        {snapshots.data?.slice(0, 8).map((item) => {
          const kind = /^\?+$/.test(String(item.kind)) ? "历史快照" : String(item.kind);
          return (
            <div className="version-row" key={String(item.id)}>
              <div><strong>{new Date(String(item.createdAt)).toLocaleString("zh-CN")}</strong><p>{kind} · {Math.ceil(Number(item.size) / 1024)} KB</p></div>
              <button className="btn" onClick={async () => setSnapshotDetail(await api<Dict>(`/snapshots/${String(item.id)}/preview`))}>预览</button>
            </div>
          );
        })}
      </Panel>
    </div>

    <Panel
      title="最近模型调用"
      meta={<span className="badge">{runs.data?.length || 0}</span>}
      style={{ marginTop: 14 }}
    >
      <div className="table-wrap"><table className="table">
        <thead><tr><th>任务</th><th>模型</th><th>状态</th><th>Token</th><th>估算费用</th><th>耗时</th></tr></thead>
        <tbody>{runs.data?.slice(0, 20).map((run) => (
          <tr key={String(run.id)}>
            <td>{String(run.taskType)}</td>
            <td>{String(run.model || "-")}</td>
            <td><span className="badge">{String(run.status)}</span></td>
            <td>{Number(run.inputTokens || 0) + Number(run.outputTokens || 0)}</td>
            <td>¥{(Number(run.estimatedCost || 0) / 100).toFixed(4)}</td>
            <td>{Number(run.durationMs || 0)} ms</td>
          </tr>
        ))}</tbody>
      </table></div>
    </Panel>

    {providerEditor && <ProviderModal value={providerEditor} onClose={() => setProviderEditor(null)} onDone={() => { setProviderEditor(null); void providers.refetch(); toast("供应商已保存"); }} />}
    {promptEditor && <PromptModal value={promptEditor} onClose={() => setPromptEditor(null)} onDone={() => { setPromptEditor(null); void prompts.refetch(); toast("提示词已保存"); }} />}
    {preview && <Modal title="最终上下文预览" onClose={() => setPreview("")} actions={<button className="btn" onClick={() => setPreview("")}>关闭</button>}><pre className="prompt-preview">{preview}</pre></Modal>}
    {snapshotDetail && (
      <Modal
        title="快照恢复预览"
        onClose={() => setSnapshotDetail(null)}
        actions={<><button className="btn" onClick={() => setSnapshotDetail(null)}>取消</button><button className="btn danger" disabled={restore.isPending || snapshotDetail.integrity !== "ok"} onClick={() => restore.mutate(String(snapshotDetail.id))}><Database size={14}/>{restore.isPending ? "正在恢复" : "恢复此快照"}</button></>}
      >
        <div className="snapshot-preview">
          <div><span>完整性</span><strong>{String(snapshotDetail.integrity)}</strong></div>
          <div><span>小说</span><strong>{String(snapshotDetail.novels)}</strong></div>
          <div><span>章节</span><strong>{String(snapshotDetail.chapters)}</strong></div>
          <div><span>版本</span><strong>{String(snapshotDetail.versions)}</strong></div>
        </div>
        <p style={{ color: "var(--muted)", fontSize: 12 }}>恢复前会自动保存当前数据库保护快照。API密钥和快照列表保留在本机。</p>
      </Modal>
    )}
  </>;
}

function ProviderModal({ value, onClose, onDone }: { value: Dict; onClose: () => void; onDone: () => void }) {
  const [preset, setPreset] = useState("custom");
  const [form, setForm] = useState({
    name: String(value.name || ""),
    baseUrl: String(value.baseUrl || ""),
    model: String(value.model || ""),
    apiKey: "",
    inputPrice: Number(value.inputPrice || 0),
    outputPrice: Number(value.outputPrice || 0),
    enabled: Boolean(value.enabled ?? true),
  });
  const save = useMutation({ mutationFn: () => value.id ? patch(`/providers/${String(value.id)}`, form) : post("/providers", form), onSuccess: onDone });
  const selectPreset = (key: string) => {
    setPreset(key);
    const selected = PROVIDER_PRESETS.find((item) => item.key === key);
    if (!selected || key === "custom") return;
    setForm({ ...form, name: selected.name, baseUrl: selected.baseUrl, model: selected.model });
  };
  return <Modal title={value.id ? "编辑大模型" : "接入大模型"} onClose={onClose} actions={<><button className="btn" onClick={onClose}>取消</button><button className="btn primary" disabled={!form.name || !form.baseUrl || !form.model || save.isPending} onClick={() => save.mutate()}><KeyRound size={14}/>加密保存</button></>}>
    {!value.id && <FormField label="服务商预设" hint="预设只填写兼容地址，模型名称仍可修改">
      <Select value={preset} onChange={(event) => selectPreset(event.target.value)}>{PROVIDER_PRESETS.map((item) => <option key={item.key} value={item.key}>{item.name}</option>)}</Select>
    </FormField>}
    <FormRow>
      <FormField label="名称"><TextInput value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></FormField>
      <FormField label="模型"><TextInput value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} /></FormField>
    </FormRow>
    <FormField label="Base URL"><TextInput value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} /></FormField>
    <FormField label="API Key" hint={value.hasKey ? "留空保持现有密钥" : "可留空使用演示模式"}>
      <TextInput type="password" autoComplete="new-password" value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} placeholder={value.hasKey ? "留空保持现有密钥" : "可留空使用演示模式"} />
    </FormField>
    <FormRow>
      <FormField label="输入单价（元/百万token）"><TextInput type="number" value={form.inputPrice} onChange={(e) => setForm({ ...form, inputPrice: Number(e.target.value) })} /></FormField>
      <FormField label="输出单价（元/百万token）"><TextInput type="number" value={form.outputPrice} onChange={(e) => setForm({ ...form, outputPrice: Number(e.target.value) })} /></FormField>
    </FormRow>
    <label className="check-row"><input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })}/>启用此供应商</label>
    {save.error && <span className="badge red">{save.error.message}</span>}
  </Modal>;
}

function PromptModal({ value, onClose, onDone }: { value: Dict; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({ name: String(value.name || ""), taskType: String(value.taskType || "正文"), content: String(value.content || "") });
  const save = useMutation({ mutationFn: () => value.id ? patch(`/prompts/${String(value.id)}`, { ...form, version: value.version }) : post("/prompts", { ...form, scope: value.scope, novelId: value.novelId }), onSuccess: onDone });
  return <Modal title={value.id ? "编辑提示词规则" : "添加提示词规则"} onClose={onClose} actions={<><button className="btn" onClick={onClose}>取消</button><button className="btn primary" disabled={!form.name || !form.content || save.isPending} onClick={() => save.mutate()}><Save size={14}/>保存</button></>}>
    <FormRow>
      <FormField label="名称"><TextInput value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></FormField>
      <FormField label="任务">
        <Select value={form.taskType} onChange={(e) => setForm({ ...form, taskType: e.target.value })}>
          {["策划", "章纲", "正文", "摘要", "事实抽取", "质检"].map((item) => <option key={item}>{item}</option>)}
        </Select>
      </FormField>
    </FormRow>
    <FormField label="补充规则"><TextArea style={{ minHeight: 220 }} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} /></FormField>
    {save.error && <span className="badge red">{save.error.message}</span>}
  </Modal>;
}

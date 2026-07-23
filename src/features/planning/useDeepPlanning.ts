import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api, post } from "../../api";

type Dict = Record<string, unknown>;

export interface DeepPlanningInterview {
  idea: string;
  targetReaders: string;
  desiredExperience: string;
  protagonist: string;
  mustHave: string;
  avoid: string;
  ending: string;
  targetChapters: number;
}

export interface DeepPlanningState {
  runId: string;
  phase: string;
  progress: number;
  proposal: Dict | null;
  error: string;
  sections: Record<string, boolean>;
  running: boolean;
  start: (interview: DeepPlanningInterview) => Promise<void>;
  stop: () => void;
  apply: (novelVersion: number) => Promise<void>;
  setSections: (sections: Record<string, boolean>) => void;
  reset: () => void;
}

function parseProposal(value: Dict): Dict | null {
  if (value.proposal && typeof value.proposal === "object") return value.proposal as Dict;
  if (typeof value.output === "string") {
    try { return JSON.parse(value.output) as Dict; } catch { return null; }
  }
  return null;
}

function progressFromPartial(raw: unknown) {
  if (typeof raw !== "string" || !raw) return { progress: 3, phase: "正在恢复任务" };
  try {
    const partial = JSON.parse(raw) as Dict;
    const interview = (partial.interview || {}) as Dict;
    const targetChapters = Math.max(30, Math.min(500, Number(interview.targetChapters || 300)));
    const chapters = Array.isArray(partial.chapters) ? partial.chapters.length : 0;
    if (chapters) return { progress: 40 + Math.round(chapters / Math.min(30, targetChapters) * 38), phase: `已完成前 ${chapters} 章章纲` };
    const structure = (partial.structure || {}) as Dict;
    const volumes = Array.isArray(structure.volumes) ? structure.volumes.length : 0;
    if (volumes) return { progress: 24 + Math.round(volumes / Math.max(3, Math.min(12, Math.ceil(targetChapters / 35))) * 16), phase: `已完成 ${volumes} 卷结构` };
    if (Array.isArray(structure.canon)) return { progress: 24, phase: "故事设定已经完成" };
    if (partial.positioning) return { progress: 18, phase: "作品定位已经完成" };
  } catch { /* 保留启动进度 */ }
  return { progress: 3, phase: "正在恢复任务" };
}

/**
 * 深度开书任务封装：SSE 监听、跨会话恢复、分区应用。
 * 供 CreateNovelWizard 与 PlanningPage 的 DeepPlanningModal 共用。
 */
export function useDeepPlanning(novelId: string, onApplied?: () => void): DeepPlanningState {
  const [runId, setRunId] = useState("");
  const [phase, setPhase] = useState("访谈待提交");
  const [progress, setProgress] = useState(0);
  const [proposal, setProposal] = useState<Dict | null>(null);
  const [error, setError] = useState("");
  const [sections, setSections] = useState<Record<string, boolean>>({
    positioning: true, canon: true, structure: true, chapters: true, foreshadows: true,
  });
  const sourceRef = useRef<EventSource | null>(null);

  const latest = useQuery({
    queryKey: ["deep-planning-latest", novelId],
    queryFn: () => api<Dict | null>(`/novels/${novelId}/deep-planning/latest`),
    enabled: Boolean(novelId),
  });

  const listen = useCallback((id: string) => {
    sourceRef.current?.close();
    const source = new EventSource(`/api/generations/${id}/events`);
    sourceRef.current = source;
    source.addEventListener("snapshot", (event) => {
      const value = JSON.parse((event as MessageEvent).data) as Dict;
      const restored = progressFromPartial(value.text || value.partial);
      setPhase(restored.phase);
      setProgress(restored.progress);
    });
    source.addEventListener("phase", (event) => {
      const value = JSON.parse((event as MessageEvent).data) as Dict;
      setPhase(String(value.status || "生成中"));
      setProgress(Number(value.progress || 0));
    });
    source.addEventListener("done", (event) => {
      const value = JSON.parse((event as MessageEvent).data) as Dict;
      const next = parseProposal(value);
      source.close();
      sourceRef.current = null;
      setPhase("待审核");
      setProgress(100);
      setProposal(next);
      if (!next) setError("任务完成，但候选结构无法解析");
    });
    source.addEventListener("error", (event) => {
      const raw = (event as MessageEvent).data;
      if (!raw) return;
      const value = JSON.parse(raw) as Dict;
      source.close();
      sourceRef.current = null;
      setError(String(value.message || "深度开书失败"));
      setPhase("失败");
    });
    source.addEventListener("stopped", (event) => {
      const value = JSON.parse((event as MessageEvent).data) as Dict;
      source.close();
      sourceRef.current = null;
      setError(String(value.message || "任务已停止，阶段结果仍保留"));
      setPhase("已停止");
    });
  }, []);

  useEffect(() => () => sourceRef.current?.close(), []);

  // 跨会话恢复：发现未完成的任务时自动重新订阅 SSE
  useEffect(() => {
    if (!latest.data || runId) return;
    const latestId = String(latest.data.id || "");
    const status = String(latest.data.status || "");
    const existing = parseProposal(latest.data);
    if (status === "待审核" && existing?.kind === "deep-planning-candidate") {
      setRunId(latestId);
      setProposal(existing);
      setPhase("待审核");
      setProgress(100);
    } else if (["排队中", "生成中"].includes(status) && latestId) {
      setRunId(latestId);
      setPhase(status);
      listen(latestId);
    }
  }, [latest.data, runId, listen]);

  const startMutation = useMutation({
    mutationFn: (interview: DeepPlanningInterview) =>
      post<{ runId: string }>(`/novels/${novelId}/deep-planning`, { interview }),
    onSuccess: (value) => {
      setRunId(value.runId);
      setProposal(null);
      setError("");
      setPhase("排队中");
      setProgress(3);
      listen(value.runId);
    },
    onError: (value) => setError(value instanceof Error ? value.message : String(value)),
  });

  const stopMutation = useMutation({
    mutationFn: () => post(`/generations/${runId}/cancel`, {}),
    onSuccess: () => setPhase("正在停止"),
  });

  const applyMutation = useMutation({
    mutationFn: (novelVersion: number) =>
      post(`/novels/${novelId}/deep-planning/${runId}/apply`, {
        version: novelVersion,
        sections: Object.entries(sections).filter(([, enabled]) => enabled).map(([key]) => key),
      }),
    onSuccess: onApplied,
    onError: (value) => setError(value instanceof Error ? value.message : String(value)),
  });

  const start = useCallback(async (interview: DeepPlanningInterview) => {
    if (!novelId) throw new Error("小说尚未创建");
    await startMutation.mutateAsync(interview);
  }, [novelId, startMutation]);

  const stop = useCallback(() => {
    if (!runId) return;
    void stopMutation.mutate();
  }, [runId, stopMutation]);

  const apply = useCallback(async (novelVersion: number) => {
    if (!novelId || !runId) throw new Error("任务尚未就绪");
    await applyMutation.mutateAsync(novelVersion);
  }, [novelId, runId, applyMutation]);

  const reset = useCallback(() => {
    sourceRef.current?.close();
    sourceRef.current = null;
    setRunId("");
    setProposal(null);
    setError("");
    setPhase("访谈待提交");
    setProgress(0);
  }, []);

  const running = Boolean(runId) && !proposal && !["失败", "已停止"].includes(phase);

  return {
    runId, phase, progress, proposal, error, sections, running,
    start, stop, apply, setSections, reset,
  };
}

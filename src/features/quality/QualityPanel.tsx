import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { PreflightIssue, QualityIssue } from "@shared/types";
import { AlertTriangle, CheckCircle2, Gauge, RefreshCw, ShieldCheck } from "lucide-react";
import { post } from "../../api";
import { errorMessage } from "../../lib/errors";
import QualityIssueList, { type DisplayQualityIssue } from "./QualityIssueList";

type QualityView = "preflight" | "semantic";
type PreflightRunState = "idle" | "running" | "success" | "error";

interface QualityResult {
  total: number;
  issues: QualityIssue[];
  note: string;
  mode?: "ai" | "local";
  checkedContent: string;
}

export interface QualitySummary {
  needsWork: number;
  optimize: number;
  passed: number;
}

export function summarizeQuality(issues: QualityIssue[]): QualitySummary {
  return issues.reduce((summary, issue) => {
    const score = Number(issue.score || 0);
    if (score < 60) summary.needsWork += 1;
    else if (score < 80) summary.optimize += 1;
    else summary.passed += 1;
    return summary;
  }, { needsWork: 0, optimize: 0, passed: 0 });
}

export interface QualityPanelProps {
  chapterId: string;
  content: string;
  preflightIssues: PreflightIssue[];
  preflightLoading?: boolean;
  preflightFetching?: boolean;
  preflightError?: unknown;
  preflightUpdatedAt?: number;
  onRunPreflight: () => Promise<unknown>;
  onSelectIssue: (issue: DisplayQualityIssue) => void;
}

function formatRunTime(timestamp: number) {
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(timestamp);
}

export function QualityPanel({
  chapterId,
  content,
  preflightIssues,
  preflightLoading = false,
  preflightFetching = false,
  preflightError,
  preflightUpdatedAt = 0,
  onRunPreflight,
  onSelectIssue,
}: QualityPanelProps) {
  const [quality, setQuality] = useState<QualityResult | null>(null);
  const [qualityError, setQualityError] = useState("");
  const [qualityUpdatedAt, setQualityUpdatedAt] = useState(0);
  const [view, setView] = useState<QualityView>("preflight");
  const [preflightRunState, setPreflightRunState] = useState<PreflightRunState>("idle");
  const qualityCheck = useMutation({
    mutationFn: (checkedContent: string) => post<Omit<QualityResult, "checkedContent">>(`/chapters/${chapterId}/quality`, { content: checkedContent }),
    onSuccess: (result, checkedContent) => {
      setQuality({ ...result, checkedContent });
      setQualityError("");
      setQualityUpdatedAt(Date.now());
    },
    onError: (error) => setQualityError(errorMessage(error)),
  });

  useEffect(() => {
    setQuality(null);
    setQualityError("");
    setQualityUpdatedAt(0);
    setView("preflight");
    setPreflightRunState("idle");
    qualityCheck.reset();
  }, [chapterId]);

  const runPreflight = async () => {
    setView("preflight");
    setPreflightRunState("running");
    try {
      const result = await onRunPreflight();
      if (result && typeof result === "object" && "error" in result && result.error) throw result.error;
      setPreflightRunState("success");
    } catch (error) {
      setPreflightRunState("error");
      throw error;
    }
  };

  const runSemantic = () => {
    setView("semantic");
    setQualityError("");
    qualityCheck.mutate(content);
  };

  const preflightCounts = useMemo(() => preflightIssues.reduce((counts, issue) => {
    counts[issue.level] += 1;
    return counts;
  }, { block: 0, warning: 0, info: 0 }), [preflightIssues]);
  const qualitySummary = useMemo(() => summarizeQuality(quality?.issues ?? []), [quality?.issues]);
  const qualityIsStale = Boolean(quality && quality.checkedContent !== content);
  const preflightRunning = preflightLoading || preflightFetching || preflightRunState === "running";
  const preflightHasRun = preflightUpdatedAt > 0 || preflightRunState === "success";
  const latestRun = view === "preflight" ? Math.max(preflightUpdatedAt, qualityUpdatedAt) : qualityUpdatedAt;
  const semanticIssues = [...(quality?.issues ?? [])].sort((a, b) => Number(a.score || 0) - Number(b.score || 0));
  const displayIssues: DisplayQualityIssue[] = view === "preflight"
    ? preflightIssues.map((issue, index) => ({ id: `preflight-${index}-${issue.title}`, kind: issue.level === "block" ? "hard-conflict" : issue.level, source: "preflight", issue }))
    : semanticIssues.map((issue, index) => ({ id: `semantic-${index}-${issue.dimension}`, kind: "style", source: "semantic", issue }));

  return <section className="chapter-tool-panel quality-panel" aria-label="章节质量">
    <div className="chapter-tool-head">
      <div className="quality-heading"><h3>章节质量</h3><span>规则与正文两层检查</span></div>
      {quality && <span className={`badge ${qualitySummary.needsWork ? "red" : qualitySummary.optimize ? "gold" : "green"}`}>{quality.total} 分</span>}
    </div>
    <div className="quality-actions">
      <button className="btn" type="button" disabled={preflightRunning} onClick={() => void runPreflight()}>
        {preflightRunning ? <RefreshCw className="is-spinning" size={14}/> : <ShieldCheck size={14}/>} {preflightRunning ? "规则检查中…" : preflightHasRun ? "重新运行预检" : "运行预检"}
      </button>
      <button className="btn" type="button" disabled={!content || qualityCheck.isPending} onClick={runSemantic}>
        {qualityCheck.isPending ? <RefreshCw className="is-spinning" size={14}/> : <Gauge size={14}/>} {qualityCheck.isPending ? "语义质检中…" : quality ? "重新运行语义质检" : "AI 语义质检"}
      </button>
    </div>
    <div className="quality-result-tabs" role="tablist" aria-label="质检结果视图">
      <button type="button" role="tab" aria-selected={view === "preflight"} onClick={() => setView("preflight")}>规则预检 {preflightHasRun ? `· ${preflightCounts.block + preflightCounts.warning + preflightCounts.info}` : ""}</button>
      <button type="button" role="tab" aria-selected={view === "semantic"} onClick={() => setView("semantic")}>语义质检 {quality ? `· ${quality.total}分` : ""}</button>
    </div>
    {latestRun > 0 && <p className={`quality-last-run${qualityIsStale ? " is-stale" : ""}`} data-testid="quality-last-run">{qualityIsStale ? "上次运行" : "最近运行"} {formatRunTime(latestRun)}{qualityIsStale ? " · 结果已过期" : ""}</p>}
    {view === "preflight" && <div className="quality-run-status" role="status">
      {preflightRunning
        ? <><RefreshCw className="is-spinning" size={17}/><div><strong>正在检查章纲、设定与节奏</strong><span>完成后会列出阻塞项和提醒</span></div></>
        : preflightError || preflightRunState === "error"
          ? <><AlertTriangle size={17}/><div><strong>规则预检失败</strong><span>请重试，或查看下方错误信息</span></div></>
          : preflightHasRun
            ? <><CheckCircle2 size={17}/><div><strong>规则预检完成</strong><span>{preflightCounts.block} 项阻塞 · {preflightCounts.warning} 项警告 · {preflightCounts.info} 条设定信息</span></div></>
            : <><ShieldCheck size={17}/><div><strong>等待运行规则预检</strong><span>当前章节尚未生成本次检查结果</span></div></>}
    </div>}
    {view === "semantic" && <div className="quality-run-status" role="status">
      {qualityCheck.isPending
        ? <><RefreshCw className="is-spinning" size={17}/><div><strong>正在分析正文</strong><span>检查开篇、冲突、节奏、兑现和结尾钩子</span></div></>
        : qualityError
          ? <><AlertTriangle size={17}/><div><strong>语义质检失败</strong><span>可以点击上方按钮重试</span></div></>
          : quality
            ? <><CheckCircle2 size={17}/><div><strong>{quality.mode === "ai" ? "AI 语义质检完成" : "本地规则评分完成"}</strong><span>{qualitySummary.needsWork} 项需修改 · {qualitySummary.optimize} 项可优化 · {qualitySummary.passed} 项通过</span></div></>
            : <><Gauge size={17}/><div><strong>尚未运行语义质检</strong><span>运行后会给出维度评分和正文证据</span></div></>}
    </div>}
    {Boolean(preflightError) && <p className="chapter-quality-error" role="alert">预检失败：{errorMessage(preflightError)}</p>}
    {qualityError && <p className="chapter-quality-error" role="alert">语义质检失败：{qualityError}</p>}
    {qualityIsStale && <p className="chapter-quality-stale" role="status">正文已修改，语义质检结果已过期，请重新运行。</p>}
    <div className={qualityIsStale && view === "semantic" ? "quality-results is-stale" : "quality-results"}>
      {displayIssues.length ? <QualityIssueList issues={displayIssues} onSelectIssue={onSelectIssue}/> : view === "semantic" && quality ? <p className="chapter-local-pass">语义检查完成，当前没有可列出的问题。</p> : view === "preflight" && preflightHasRun ? <p className="chapter-local-pass">规则检查完成，当前没有需要处理的项目。</p> : null}
    </div>
    {view === "semantic" && quality?.note && <p className="chapter-tool-note">{quality.note}</p>}
  </section>;
}

export default QualityPanel;

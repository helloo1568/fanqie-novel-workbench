import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Check, Sparkles, Square } from "lucide-react";
import { post } from "../../api";
import Modal from "../../components/Modal";
import type { Novel } from "@shared/types";
import { FANQIE_GENRE_PROFILES, FANQIE_PROFILE_UPDATED_AT, getFanqieGenreProfile, type FanqieGenreGroup } from "@shared/fanqieProfiles";
import { useDeepPlanning, type DeepPlanningInterview } from "../planning/useDeepPlanning";

type Dict = Record<string, unknown>;

export interface CreateNovelWizardProps {
  onClose: () => void;
  onCreated: (novel: Novel) => void;
  /**
   * 完成深度开书应用后跳转：
   * - true（默认）：跳到 /chapters 直接开始创作
   * - false：跳到 /planning 进入策划页
   */
  onComplete?: (novelId: string, skipAi: boolean) => void;
}

const COVER_COLORS = ["#376B5B", "#7C3A2E", "#2F4858", "#5B4B8A", "#8B5A2B", "#3E5C76", "#6B2C5F"];
const STEPS = ["基础信息", "创作访谈", "深度开书", "审核入库"] as const;
const GENRE_GROUPS: FanqieGenreGroup[] = ["男频主赛道", "女频主赛道", "衍生与复合"];

interface BasicForm {
  title: string;
  genre: string;
  targetWords: number;
  coverColor: string;
}

interface InterviewForm extends DeepPlanningInterview {}

const DEFAULT_INTERVIEW: InterviewForm = {
  idea: "",
  targetReaders: "",
  desiredExperience: "",
  protagonist: "",
  mustHave: "",
  avoid: "",
  ending: "",
  targetChapters: 0,
};

export default function CreateNovelWizard({ onClose, onCreated, onComplete }: CreateNovelWizardProps) {
  const [step, setStep] = useState<0 | 1 | 2 | 3>(0);
  const [basic, setBasic] = useState<BasicForm>({
    title: "",
    genre: "都市脑洞",
    targetWords: 1000000,
    coverColor: COVER_COLORS[0],
  });
  const [interview, setInterview] = useState<InterviewForm>(DEFAULT_INTERVIEW);
  const [novel, setNovel] = useState<Novel | null>(null);
  const [createError, setCreateError] = useState("");

  // 提前在 hook 中订阅：novelId 由 Step 2 提交后写入
  const dp = useDeepPlanning(novel?.id || "", () => {
    if (novel) onComplete?.(novel.id, false);
  });

  // 当深度开书任务进入"待审核"时自动跳到 Step 4
  useEffect(() => {
    if (dp.proposal && step === 2) setStep(3);
  }, [dp.proposal, step]);

  // 当深度开书任务报错或被停止时，停留在 Step 3 让用户决定
  useEffect(() => {
    if ((dp.error || dp.phase === "已停止" || dp.phase === "失败") && step === 2) {
      // 保持当前步，让用户看到错误并能重试
    }
  }, [dp.error, dp.phase, step]);

  const createNovel = useMutation({
    mutationFn: () => post<Novel>("/novels", {
      title: basic.title,
      genre: basic.genre,
      targetWords: basic.targetWords,
      description: interview.idea,
      coverColor: basic.coverColor,
    }),
    onSuccess: (created) => {
      setNovel(created);
      onCreated(created);
    },
    onError: (error) => setCreateError(error instanceof Error ? error.message : String(error)),
  });

  const targetChaptersHint = useMemo(() => {
    const profile = getFanqieGenreProfile(basic.genre);
    return Math.max(30, Math.min(500, Math.round(basic.targetWords / profile.chapterWords.target)));
  }, [basic.genre, basic.targetWords]);

  // Step 1 → Step 2
  const goToInterview = () => {
    if (!basic.title.trim()) return;
    setStep(1);
  };

  // Step 2 → Step 3：创建小说并启动深度开书
  const startDeepPlanning = async () => {
    if (!interview.idea.trim()) return;
    setCreateError("");
    let current = novel;
    if (!current) {
      try {
        current = await createNovel.mutateAsync();
      } catch {
        return;
      }
    }
    setStep(2);
    try {
      await dp.start({ ...interview, targetChapters: interview.targetChapters || targetChaptersHint });
    } catch {
      // 错误已经在 hook 内部捕获到 dp.error
    }
  };

  // 跳过 AI，直接进入策划页
  const skipToPlanning = async () => {
    let current = novel;
    if (!current) {
      try {
        current = await createNovel.mutateAsync();
      } catch {
        return;
      }
    }
    onComplete?.(current.id, true);
  };

  const applyAndContinue = async () => {
    if (!novel) return;
    await dp.apply(novel.version);
    onComplete?.(novel.id, false);
  };

  const continueInBackground = () => {
    if (!novel) return;
    onComplete?.(novel.id, true);
  };

  // 各步骤底部操作区
  const actions = (() => {
    if (step === 0) {
      return <>
        <button className="btn" onClick={onClose}>取消</button>
        <button className="btn primary" disabled={!basic.title.trim()} onClick={goToInterview}>
          下一步<ArrowRight size={14}/>
        </button>
      </>;
    }
    if (step === 1) {
      return <>
        <button className="btn" onClick={() => setStep(0)}><ArrowLeft size={14}/>上一步</button>
        <button className="btn" onClick={() => void skipToPlanning()}>跳过 AI，手动策划</button>
        <button className="btn primary" disabled={!interview.idea.trim() || createNovel.isPending} onClick={() => void startDeepPlanning()}>
          <Sparkles size={14}/>开始深度开书
        </button>
      </>;
    }
    if (step === 2) {
      return <>
        <button className="btn" onClick={continueInBackground}>后台继续，在策划页查看</button>
        {dp.running && <button className="btn danger" onClick={() => dp.stop()}><Square size={14}/>停止</button>}
      </>;
    }
    // step === 3
    return <>
      <button className="btn" onClick={() => void skipToPlanning()}>先去策划页细看</button>
      <button className="btn primary" disabled={!Object.values(dp.sections).some(Boolean)} onClick={() => void applyAndContinue()}>
        <Check size={14}/>应用并开始创作
      </button>
    </>;
  })();

  return (
    <Modal title="新建小说向导" wide className="novel-wizard-modal" onClose={onClose} actions={actions}>
      <StepIndicator current={step} />
      {createError && <span className="badge red" style={{ marginBottom: 12 }}>{createError}</span>}
      {step === 0 && <BasicInfoStep basic={basic} onChange={setBasic} />}
      {step === 1 && <InterviewStep interview={interview} onChange={setInterview} targetChaptersHint={targetChaptersHint} />}
      {step === 2 && <RunningStep phase={dp.phase} progress={dp.progress} error={dp.error} />}
      {step === 3 && <ReviewStep dp={dp} />}
    </Modal>
  );
}

function StepIndicator({ current }: { current: number }) {
  return (
    <ol className="wizard-steps" aria-label="创建进度">
      {STEPS.map((label, index) => (
        <li key={label} className={`wizard-step ${index === current ? "active" : index < current ? "done" : ""}`}>
          <span className="wizard-step-dot">{index < current ? <Check size={12} /> : index + 1}</span>
          <span className="wizard-step-label">{label}</span>
        </li>
      ))}
    </ol>
  );
}

function BasicInfoStep({ basic, onChange }: { basic: BasicForm; onChange: (next: BasicForm) => void }) {
  const profile = getFanqieGenreProfile(basic.genre);
  return (
    <div className="wizard-body">
      <div className="wizard-intro"><span>第一步 · 基础信息</span><h2>每部作品都从一个名字开始。</h2><p>先建立作品档案，后续创作中仍可随时调整。</p></div>
      <div className="field">
        <label>小说名称</label>
        <input autoFocus className="input" value={basic.title} onChange={(e) => onChange({ ...basic, title: e.target.value })} placeholder="先用工作名，随时可以修改" />
      </div>
      <div className="field-row">
        <div className="field">
          <label>番茄题材模板</label>
          <select className="select" value={basic.genre} onChange={(e) => {
            const nextProfile = getFanqieGenreProfile(e.target.value);
            onChange({ ...basic, genre: e.target.value, targetWords: nextProfile.targetWords });
          }}>
            {GENRE_GROUPS.map((group) => <optgroup label={group} key={group}>
              {FANQIE_GENRE_PROFILES.filter((item) => item.group === group).map((item) => <option key={item.key}>{item.key}</option>)}
            </optgroup>)}
          </select>
        </div>
        <div className="field">
          <label>目标字数</label>
          <input className="input" type="number" step="10000" value={basic.targetWords} onChange={(e) => onChange({ ...basic, targetWords: Number(e.target.value) })} />
        </div>
      </div>
      <div className="genre-profile-summary">
        <strong>{profile.corePromise}</strong>
        <span>主要侧重：{profile.focus}</span>
        <span>建议单章：{profile.chapterWords.min}—{profile.chapterWords.max} 字，默认 {profile.chapterWords.target} 字</span>
      </div>
      <div className="field">
        <label>书脊颜色</label>
        <div className="color-row">
          {COVER_COLORS.map((color) => (
            <button key={color} type="button" className={`color-swatch ${basic.coverColor === color ? "active" : ""}`} style={{ background: color }} aria-label={`选择颜色 ${color}`} onClick={() => onChange({ ...basic, coverColor: color })} />
          ))}
        </div>
      </div>
      <p className="wizard-hint">模板参数校准于 {FANQIE_PROFILE_UPDATED_AT}，用于设置初始权重和篇幅建议，不承诺流量；后续可逐章覆盖。</p>
    </div>
  );
}

function InterviewStep({ interview, onChange, targetChaptersHint }: { interview: InterviewForm; onChange: (next: InterviewForm) => void; targetChaptersHint: number }) {
  return (
    <div className="wizard-body">
      <div className="wizard-intro"><span>第二步 · 创作访谈</span><h2>把你真正想写的故事告诉我。</h2><p>这些答案决定开书方案的方向，不会直接覆盖任何正文。</p></div>
      <div className="field">
        <label>核心想法</label>
        <textarea autoFocus className="textarea" style={{ minHeight: 90 }} value={interview.idea} onChange={(e) => onChange({ ...interview, idea: e.target.value })} placeholder="题材、主角、开局事件和你最想保留的感觉" />
      </div>
      <div className="field-row">
        <div className="field">
          <label>目标读者</label>
          <input className="input" value={interview.targetReaders} onChange={(e) => onChange({ ...interview, targetReaders: e.target.value })} placeholder="例如：25-35 岁男性，喜欢职场逆袭" />
        </div>
        <div className="field">
          <label>目标章节</label>
          <input className="input" type="number" min={30} max={500} value={interview.targetChapters || targetChaptersHint} onChange={(e) => onChange({ ...interview, targetChapters: Number(e.target.value) })} />
        </div>
      </div>
      <div className="field-row">
        <div className="field">
          <label>核心体验</label>
          <textarea className="textarea" style={{ minHeight: 70 }} value={interview.desiredExperience} onChange={(e) => onChange({ ...interview, desiredExperience: e.target.value })} placeholder="读者读完最强烈的情绪是什么" />
        </div>
        <div className="field">
          <label>主角与长期欲望</label>
          <textarea className="textarea" style={{ minHeight: 70 }} value={interview.protagonist} onChange={(e) => onChange({ ...interview, protagonist: e.target.value })} placeholder="主角是谁，长期想要什么" />
        </div>
      </div>
      <div className="field-row">
        <div className="field">
          <label>必须包含</label>
          <textarea className="textarea" style={{ minHeight: 70 }} value={interview.mustHave} onChange={(e) => onChange({ ...interview, mustHave: e.target.value })} placeholder="金手指、关键桥段、设定硬约束" />
        </div>
        <div className="field">
          <label>明确避开</label>
          <textarea className="textarea" style={{ minHeight: 70 }} value={interview.avoid} onChange={(e) => onChange({ ...interview, avoid: e.target.value })} placeholder="不想出现的桥段、价值观、套路" />
        </div>
      </div>
      <div className="field">
        <label>结局方向</label>
        <input className="input" value={interview.ending} onChange={(e) => onChange({ ...interview, ending: e.target.value })} placeholder="例如：主角达成长期欲望，但付出代价" />
      </div>
      <p className="deep-note">任务会依次完成商业定位、故事圣经、分卷结构、前30章和独立审稿。所有结果先成为候选，不会覆盖现有内容。可以随时"跳过 AI，手动策划"。</p>
    </div>
  );
}

function RunningStep({ phase, progress, error }: { phase: string; progress: number; error: string }) {
  const pct = Math.max(0, Math.min(100, progress));
  return (
    <div className="wizard-body">
      <div className="deep-running">
        <div className="score">{pct}%</div>
        <div>
          <strong>{phase}</strong>
          <p>任务记录已持久化，可以关闭窗口让它在后台继续。完成后会自动跳到审核步。</p>
        </div>
      </div>
      <div className="wizard-progress-track"><div className="wizard-progress-bar" style={{ width: `${pct}%` }} /></div>
      {error && <span className="badge red" style={{ marginTop: 12 }}>{error}</span>}
    </div>
  );
}

function ReviewStep({ dp }: { dp: ReturnType<typeof useDeepPlanning> }) {
  const proposal = dp.proposal;
  if (!proposal) {
    return <div className="wizard-body"><p style={{ color: "var(--muted)" }}>暂无可审核的候选。你可以回到上一步重新生成，或先去策划页手动整理。</p></div>;
  }
  const positioning = (proposal.positioning || {}) as Dict;
  const structure = (proposal.structure || {}) as Dict;
  const audit = (proposal.audit || {}) as Dict;
  const localAudit = (proposal.localAudit || {}) as Dict;
  const volumes = Array.isArray(structure.volumes) ? structure.volumes as Dict[] : [];
  const chapters = Array.isArray(proposal.chapters) ? proposal.chapters as Dict[] : [];
  const sectionLabels: Record<string, string> = {
    positioning: "定位与创作契约", canon: "故事圣经", structure: "分卷与情节弧",
    chapters: "前30章章纲", foreshadows: "伏笔台账",
  };
  return (
    <div className="wizard-body deep-review">
      <div className="deep-audit">
        <div className="score">{Number(audit.score || localAudit.score || 0)}</div>
        <div>
          <strong>独立审稿</strong>
          <p>{Array.isArray(audit.blockers) && audit.blockers.length ? `${audit.blockers.length} 个阻塞项，建议先查看后再决定入库分区。` : "未发现必须阻止入库的问题。"}</p>
        </div>
      </div>
      {dp.error && <span className="badge red">{dp.error}</span>}
      <div className="deep-sections">
        {Object.entries(sectionLabels).map(([key, label]) => (
          <label className="check-row" key={key}>
            <input type="checkbox" checked={dp.sections[key]} onChange={(e) => dp.setSections({ ...dp.sections, [key]: e.target.checked })} />
            <span>{label}</span>
          </label>
        ))}
      </div>
      <div className="deep-summary">
        <section>
          <span>推荐书名</span>
          <strong>{String(positioning.title || "-")}</strong>
          <p>{String(positioning.pitch || "")}</p>
        </section>
        <section>
          <span>目标读者与承诺</span>
          <strong>{String(positioning.targetReaders || "-")}</strong>
          <p>{String(positioning.corePromise || "")}</p>
        </section>
      </div>
      <div>
        <h4>分卷结构</h4>
        <div className="deep-list">
          {volumes.map((volume) => (
            <div className="version-row" key={String(volume.number)}>
              <div>
                <strong>{String(volume.number)}. {String(volume.title)}</strong>
                <p>{String(volume.goal)}</p>
              </div>
              <span className="badge">{Array.isArray(volume.arcs) ? volume.arcs.length : 0} 弧</span>
            </div>
          ))}
        </div>
      </div>
      <div>
        <h4>前期章纲</h4>
        <div className="deep-chapters">
          {chapters.map((chapter) => (
            <div key={String(chapter.number)}>
              <strong>{String(chapter.number)}. {String(chapter.title)}</strong>
              <span>{String((chapter.outline as Dict)?.stateChange || "")}</span>
            </div>
          ))}
        </div>
      </div>
      {Array.isArray(audit.issues) && audit.issues.length > 0 && (
        <div>
          <h4>审稿问题</h4>
          {(audit.issues as Dict[]).map((issue, index) => (
            <div className="issue" key={index}>
              <div className="issue-head">
                <span>{String(issue.section)}</span>
                <span className={`badge ${issue.severity === "高" ? "red" : "gold"}`}>{String(issue.severity)}</span>
              </div>
              <p>{String(issue.problem)}</p>
              <p style={{ color: "var(--green)" }}>{String(issue.suggestion)}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

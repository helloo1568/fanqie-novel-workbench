import { EventEmitter } from "node:events";
import { z } from "zod";
import { decryptSecret } from "./crypto.js";
import { sqlite, id, now } from "./db.js";
import {
  acceptChapterVersion,
  consistencyCheck,
  contextForChapter,
  createChapterVersion,
  updateChapterSummary,
} from "./repository.js";
import { knowledgePrompt } from "./knowledge.js";
import { countChapterWords, getFanqieGenreProfile, resolveChapterLengthRule } from "../shared/fanqieProfiles.js";

type RunEvent = { event: string; data: unknown };
type Provider = Record<string, unknown>;
type QualityIssue = { dimension: string; score: number; evidence: string; suggestion: string; position?: string };
type MemoryFact = { type?: string; title?: string; beforeValue?: string | null; afterValue?: string; evidence?: string };
type ChapterAnalysis = {
  summary?: string;
  facts?: MemoryFact[];
  timeline?: Array<{ timeLabel?: string; title?: string; description?: string }>;
  foreshadows?: Array<{ action?: string; title?: string; description?: string; targetChapter?: number; evidence?: string }>;
  arcSummary?: string;
  volumeSummary?: string;
};

export class CandidateAcceptanceBlockedError extends Error {
  constructor(readonly issues: ReturnType<typeof consistencyCheck>) {
    super("候选稿存在硬冲突，无法接受为正式版本");
    this.name = "CandidateAcceptanceBlockedError";
  }
}

export class CandidateStaleError extends Error {
  readonly issues = [];
  constructor() {
    super("候选稿基于旧的正式版本生成，无法覆盖当前正式稿");
    this.name = "CandidateStaleError";
  }
}

const emitters = new Map<string, EventEmitter>();
const controllers = new Map<string, AbortController>();

function emitter(runId: string) {
  let value = emitters.get(runId);
  if (!value) { value = new EventEmitter(); value.setMaxListeners(20); emitters.set(runId, value); }
  return value;
}

function publish(runId: string, event: string, data: unknown) { emitter(runId).emit("message", { event, data } satisfies RunEvent); }

function json<T>(value: unknown, fallback: T): T {
  try { return typeof value === "string" ? JSON.parse(value) as T : fallback; } catch { return fallback; }
}

function selectedProvider(novelId?: string, taskType?: string) {
  if (novelId && taskType) {
    const novel = sqlite.prepare("SELECT model_overrides FROM novels WHERE id=?").get(novelId) as { model_overrides: string } | undefined;
    const overrides = json<Record<string, string>>(novel?.model_overrides, {});
    const rawProviderId = overrides[routeTaskType(taskType)];
    const providerId = typeof rawProviderId === "string" ? rawProviderId : "";
    if (providerId) {
      const exact = sqlite.prepare("SELECT * FROM providers WHERE id=? AND enabled=1").get(providerId) as Provider | undefined;
      if (exact) return exact;
    }
  }
  return sqlite.prepare("SELECT * FROM providers WHERE enabled=1 ORDER BY created_at LIMIT 1").get() as Provider | undefined;
}

function routeTaskType(taskType: string) { return ["全章重写", "扩写", "压缩", "润色", "选区改写", "定点二稿"].includes(taskType) ? "正文" : taskType; }

function promptAdditions(novelId: string, taskType: string) {
  const routed = routeTaskType(taskType);
  return (sqlite.prepare(`SELECT name,content,scope FROM prompt_templates
    WHERE task_type=? AND (scope='global' OR novel_id=?) ORDER BY CASE scope WHEN 'global' THEN 0 ELSE 1 END,updated_at`).all(routed, novelId) as Record<string, unknown>[])
    .map((item) => `${item.scope === "global" ? "全局" : "本书"}规则《${item.name}》：${item.content}`).join("\n");
}

function genreGuidance(genre: string) {
  const profile = getFanqieGenreProfile(genre);
  const calibrated = `番茄题材参数：核心体验“${profile.corePromise}”；主要侧重“${profile.focus}”；建议单章${profile.chapterWords.min}-${profile.chapterWords.max}字。参数用于校准，不得机械复制热榜桥段。`;
  if (genre !== "四合院同人") return `${calibrated}\n遵守本书题材契约和已确认设定。`;
  return `${calibrated}
四合院同人专项规则：
1. 主线至少70%为原创职业、家庭与生活事件；只借用原作人物关系，不复制原剧情、台词或连续事件。
2. 原作人物按自身利益、能力和信息范围行动，可对立也可合作，不得全员禽兽化或为打脸降智。
3. 爽点必须落到技术成果、岗位待遇、奖金工资、票证物资、住房名声或家庭关系之一，不用空洞“全院震惊”代替收益。
4. 冲突优先通过工作流程、手续证据、技术实绩和利益交换解决；控制全院大会、辱骂和重复训人的比例。
5. 年代、工资、票证、岗位、厂内制度和机械数据只使用已确认设定；不确定时保持模糊，不自行编造具体政策和史实。
6. 避免现代互联网词汇、爽文黑话和过度作者评价，对话符合1965年人物身份。`;
}

function buildPrompt(context: NonNullable<ReturnType<typeof contextForChapter>>, taskType: string, instruction = "") {
  const genre = String(context.novel?.genre || "中文网文");
  const lengthRule = resolveChapterLengthRule(context.chapter.outline as Record<string, string | number>, genre);
  const rewriteTask = taskType === "正文" ? "" : `\n改写任务：下面是需要处理的原文。只输出处理后的正文片段，不要输出解释；保留事实、人物状态、视角和专有名词。\n${instruction}`;
  const additions = promptAdditions(String(context.novel?.id), taskType);
  const courseKnowledge = knowledgePrompt({ taskType: routeTaskType(taskType), genre, chapterNumber: Number(context.chapter.number), instruction });
  return `你是一名擅长${genre}和番茄长篇连载节奏的中文作者。任务：${taskType}。
作品：${context.novel?.title}；题材：${genre}。
创作契约：${JSON.stringify(context.novel?.contract)}
全书策划与成长矩阵：${JSON.stringify(context.novel?.planning)}
当前分卷：${JSON.stringify(context.volume)}
当前情节弧：${JSON.stringify(context.arc)}
分层摘要：${JSON.stringify(context.hierarchy)}
本章章纲：${JSON.stringify(context.chapter.outline)}
本章相关设定：${JSON.stringify(context.canon)}
已确认事实：${JSON.stringify(context.facts)}
故事时间线：${JSON.stringify(context.timeline)}
待推进伏笔：${JSON.stringify(context.hooks)}
最近五章：${JSON.stringify(context.recent)}
用户补充：${taskType === "正文" ? instruction : "见改写任务"}${rewriteTask}
补充提示词规则：${additions || "无"}
${courseKnowledge}
题材专项规则：${genreGuidance(genre)}
硬性要求：
1. 只输出正文，不输出标题、分析、提纲或写作说明；严格使用章纲指定视角。
2. 场景优先：开头尽快让人物在具体问题、冲突或利益诱因中行动；每段适合手机阅读，避免连续大段解释。
3. 必须完成章纲的目标、冲突与状态变化；爽点、奖励、见证与伏笔按剧情需要自然显现，不为展示字段额外安排围观或解释。
4. 扮猪不等于压抑：可以隐藏终极底牌，但本章结果必须让主角的选择产生可感知的后果。
5. 能力只能来自章纲“能力来源”或已确认设定；不得临场新增万能能力，不得让对手为打脸而降智。
6. 严格遵守锁定设定和已确认事实，推进当前卷弧与伏笔；结尾落实章纲钩子。
7. 使用动作、对白、利益变化和环境反应表达。动作、对白和环境已经表达的信息，不再由旁白总结；允许迟疑、试错、改口、抢话、答非所问和沉默。
8. 不复述章纲，不用“他不知道的是”“命运齿轮”等机械预告，不连续使用相同打脸套路、机械排比、网络段子堆砌或作者评价。
 9. 模型没有联网检索权限，不得声称已查证外部资料；历史或技术细节缺少依据时应避免精确数字。
 10. 本章正文目标${lengthRule.target}字，范围${lengthRule.min}-${lengthRule.max}字；${lengthRule.mode === "严格" ? "必须落在范围内" : "尽量落在范围内，完整因果和必要情绪过程优先"}。`;
}

function demoText(context: NonNullable<ReturnType<typeof contextForChapter>>) {
  const outline = context.chapter.outline as Record<string, string | number>;
  return `【本地演示候选稿：未连接真实模型，请勿直接发布】

${String(outline["主视角"] || "主角")}停下脚步时，眼前的异常已经逼近。

${String(outline["冲突"] || "本章冲突尚未填写")}。

他没有暴露全部底牌，只使用章纲确认的能力来源完成破局。${String(outline["见证者"] || "现场的人")}看清了结果，也看清这次胜利并非侥幸。

${String(outline["即时奖励"] || "主角获得了推进下一步的线索")}。

${String(outline["结尾钩子"] || "新的问题在此刻出现")}。`;
}

function retryDelay(signal: AbortSignal | undefined, delayMs: number) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return; }
    const onAbort = () => { clearTimeout(timer); reject(signal?.reason); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, delayMs);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function requestText(provider: Provider, messages: Array<{ role: string; content: string }>, options: { signal?: AbortSignal; maxTokens?: number; temperature?: number; reasoningEffort?: "low" | "medium" | "high"; attempt?: number } = {}) {
  const response = await fetch(`${String(provider.base_url).replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    signal: options.signal,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${decryptSecret(String(provider.encrypted_key))}` },
    body: JSON.stringify({
      model: provider.model,
      stream: false,
      temperature: options.temperature ?? 0.2,
      max_tokens: options.maxTokens ?? 2048,
      reasoning_effort: options.reasoningEffort,
      messages,
    }),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    const attempt = options.attempt || 0;
    if ([429, 500, 502, 503, 504].includes(response.status) && attempt < 2) {
      const retryAfter = Math.max(0, Number(response.headers.get("retry-after") || 0) * 1000);
      await retryDelay(options.signal, Math.max(retryAfter, 1500 * 2 ** attempt));
      return requestText(provider, messages, { ...options, attempt: attempt + 1 });
    }
    if (options.reasoningEffort && response.status === 400 && /reasoning|unsupported|unknown|invalid/i.test(detail)) {
      return requestText(provider, messages, { ...options, reasoningEffort: undefined });
    }
    throw new Error(`模型服务返回 ${response.status}: ${detail}`);
  }
  const body = await response.json() as Record<string, unknown>;
  const choice = (body.choices as Array<Record<string, unknown>> | undefined)?.[0];
  const message = choice?.message as Record<string, unknown> | undefined;
  const content = typeof message?.content === "string" ? message.content : "";
  if (!content.trim()) throw new Error("模型未返回可用正文，可能是输出预算被思考过程耗尽");
  return { content, usage: body.usage as Record<string, number> | undefined };
}

function extractJson<T>(text: string): T | null {
  const clean = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  try { return JSON.parse(clean) as T; } catch {
    const start = Math.min(...[clean.indexOf("{"), clean.indexOf("[")].filter((x) => x >= 0));
    const end = Math.max(clean.lastIndexOf("}"), clean.lastIndexOf("]"));
    if (Number.isFinite(start) && end > start) {
      try { return JSON.parse(clean.slice(start, end + 1)) as T; } catch { return null; }
    }
    return null;
  }
}

async function modelPreflight(context: NonNullable<ReturnType<typeof contextForChapter>>, provider: Provider, signal: AbortSignal) {
  const prompt = `检查下面章纲与正式设定是否冲突。重点检查人物生死与状态、时间先后、地点、能力取得章节与限制、身份知情范围、已回收伏笔、锁定世界规则。只返回JSON数组，不要Markdown：[{"level":"block|warning","title":"问题","detail":"说明","evidence":"原文证据"}]。没有问题返回[]。\n${knowledgePrompt({ taskType: "章纲", genre: String(context.novel?.genre || ""), chapterNumber: Number(context.chapter.number), instruction: "一致性预检" })}\n${JSON.stringify({ outline: context.chapter.outline, canon: context.canon, facts: context.facts, timeline: context.timeline, hooks: context.hooks, hierarchy: context.hierarchy })}`;
  const { content } = await requestText(provider, [{ role: "user", content: prompt }], { signal, maxTokens: 4096, temperature: 0 });
  return extractJson<Array<{ level: string; title: string; detail: string; evidence?: string }>>(content) || [];
}

export function startGeneration(input: { novelId: string; chapterId: string; taskType?: string; instruction?: string; baseContent?: string; selectionStart?: number; selectionEnd?: number; providerId?: string }) {
  const runId = id(); const t = now(); const taskType = input.taskType || "正文";
  // 用户显式指定 providerId 时优先使用（必须 enabled=1），否则走 novel.modelOverrides 路由
  const provider = input.providerId
    ? sqlite.prepare("SELECT * FROM providers WHERE id=? AND enabled=1").get(input.providerId) as Provider | undefined
    : selectedProvider(input.novelId, taskType);
  const chapter = sqlite.prepare("SELECT version,current_version_id FROM chapters WHERE id=? AND novel_id=?").get(input.chapterId, input.novelId) as { version: number; current_version_id: string | null } | undefined;
  const frozenBase = chapter ? { revision: Number(chapter.version), versionId: chapter.current_version_id ? String(chapter.current_version_id) : null } : null;
  sqlite.prepare(`INSERT INTO generation_runs
    (id,novel_id,chapter_id,task_type,provider_id,model,status,output,prompt_version,base_revision,base_version_id,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,'','v2',?,?,?,?)`)
    .run(runId, input.novelId, input.chapterId, taskType, provider?.id || null, provider?.model || "本地演示", "排队中", frozenBase?.revision ?? null, frozenBase?.versionId ?? null, t, t);
  void runGeneration(runId, { ...input, frozenBase }, provider);
  return { runId };
}

export function selectTargetedRevisionIssues(issues: QualityIssue[]) {
  const evidenced = issues
    .filter((issue) => Number(issue.score) < 75 && String(issue.evidence || "").trim() && String(issue.suggestion || "").trim())
    .sort((left, right) => Number(left.score) - Number(right.score));
  return evidenced.slice(0, 5);
}

function targetedRevisionInstruction(source: string, issues: QualityIssue[]) {
  const problemList = issues.map((issue, index) => `${index + 1}. ${issue.dimension}｜位置：${issue.position || "正文"}｜证据：${issue.evidence}｜修改方向：${issue.suggestion}`).join("\n");
  return `这是一次定点二稿，不是整章重写。只处理下面列出的 ${issues.length} 个问题；没有列出的问题一律保留。
严格保留：事件顺序、人物立场、设定、能力来源、时间线、伏笔、专有名词、即时结果和章末钩子。
禁止：新增人物、设定、事件、奖励、反转、解释段或新的总结句；不得把局部问题扩写成全章重写。
修改时优先删除旁白对动作和潜台词的重复解释，让动作、对白、物件和环境自己传递信息。
问题清单：
${problemList}

待处理原文：
${source}`;
}

export async function startTargetedRevision(input: { novelId: string; chapterId: string; sourceVersionId: string }) {
  const context = contextForChapter(input.chapterId);
  if (!context || String(context.novel?.id) !== input.novelId) throw new Error("章节不存在");
  const source = sqlite.prepare("SELECT * FROM chapter_versions WHERE id=? AND chapter_id=? AND novel_id=?").get(input.sourceVersionId, input.chapterId, input.novelId) as Record<string, unknown> | undefined;
  if (!source || !["ai-candidate", "ai-partial", "ai-revision"].includes(String(source.source))) throw new Error("只能从 AI 候选稿生成定点二稿");
  const provider = selectedProvider(input.novelId, "正文");
  if (!provider?.encrypted_key) throw new Error("供应商未保存API密钥");
  const quality = await semanticQualityCheck(input.chapterId, String(source.content || ""));
  const issues = selectTargetedRevisionIssues(quality.issues);
  if (!issues.length) throw new Error("质检未发现带正文证据的低分问题，无需生成定点二稿");
  const content = String(source.content || "");
  return startGeneration({
    novelId: input.novelId,
    chapterId: input.chapterId,
    taskType: "定点二稿",
    instruction: targetedRevisionInstruction(content, issues),
    baseContent: content,
    selectionStart: 0,
    selectionEnd: content.length,
  });
}

async function runGeneration(runId: string, input: {
  chapterId: string;
  taskType?: string;
  instruction?: string;
  baseContent?: string;
  selectionStart?: number;
  selectionEnd?: number;
  frozenBase: { revision: number; versionId: string | null } | null;
}, provider?: Provider) {
  const started = Date.now(); const controller = new AbortController(); controllers.set(runId, controller);
  const context = contextForChapter(input.chapterId);
  if (!context) return finishError(runId, "章节不存在");
  let output = "";
  let inputTokens = 0; let providerOutputTokens = 0;
  let candidate: ReturnType<typeof createChapterVersion> = null;
  try {
    const localIssues = consistencyCheck(input.chapterId);
    const localBlocks = localIssues.filter((issue) => issue.level === "block");
    if (localBlocks.length) throw new Error(`章纲预检未通过：${localBlocks.map((item) => item.title).join("；")}`);
    if (provider?.encrypted_key) {
      publish(runId, "phase", { status: "一致性预检", provider: provider.name });
      try {
        const semanticIssues = await modelPreflight(context, provider, controller.signal);
        const blocks = semanticIssues.filter((issue) => issue.level === "block");
        if (blocks.length) throw new Error(`设定冲突：${blocks.map((item) => `${item.title}（${item.detail}）`).join("；")}`);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") throw error;
        if (String(error).startsWith("Error: 设定冲突")) throw error;
        publish(runId, "phase", { status: "语义预检不可用，已通过本地硬检查继续", warning: String(error) });
      }
    }

    sqlite.prepare("UPDATE generation_runs SET status='生成中',updated_at=? WHERE id=?").run(now(), runId);
    publish(runId, "phase", { status: "生成中", provider: provider?.name || "本地演示" });
    if (!provider?.encrypted_key) {
      const text = demoText(context);
      for (const part of text.match(/.{1,18}/gs) ?? []) {
        if (controller.signal.aborted) throw new DOMException("已停止", "AbortError");
        output += part; persistOutput(runId, output); publish(runId, "delta", { text: part });
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    } else {
      const lengthRule = resolveChapterLengthRule(context.chapter.outline as Record<string, string | number>, String(context.novel?.genre || ""));
      const response = await fetch(`${String(provider.base_url).replace(/\/$/, "")}/chat/completions`, {
        method: "POST", signal: controller.signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${decryptSecret(String(provider.encrypted_key))}` },
        body: JSON.stringify({ model: provider.model, stream: true, stream_options: { include_usage: true }, temperature: 0.72, max_tokens: Math.min(8192, Math.max(4096, lengthRule.max * 2)), messages: [{ role: "user", content: buildPrompt(context, input.taskType || "正文", input.instruction) }] }),
      });
      if (!response.ok || !response.body) throw new Error(`模型服务返回 ${response.status}: ${(await response.text()).slice(0, 300)}`);
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = "";
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        buffer += decoder.decode(value, { stream: true }); const lines = buffer.split(/\r?\n/); buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data:")) continue; const data = line.slice(5).trim(); if (!data || data === "[DONE]") continue;
          try {
            const parsed = JSON.parse(data); const text = parsed.choices?.[0]?.delta?.content || "";
            if (parsed.usage) { inputTokens = Number(parsed.usage.prompt_tokens || 0); providerOutputTokens = Number(parsed.usage.completion_tokens || 0); }
            if (text) { output += text; persistOutput(runId, output); publish(runId, "delta", { text }); }
          } catch { /* vendor may split or add non-JSON events */ }
        }
      }
      if (!output.trim()) throw new Error("模型流式请求完成但没有正文，请提高输出预算后重试");
    }
    const candidateContent = composeCandidate(input, output);
    const source = input.taskType === "定点二稿" ? "ai-revision" : "ai-candidate";
    const label = input.taskType === "定点二稿" ? `AI定点二稿候选 ${new Date().toLocaleString("zh-CN")}` : `AI${input.taskType || "正文"}候选稿 ${new Date().toLocaleString("zh-CN")}`;
    candidate = createChapterVersion(input.chapterId, candidateContent, label, source, input.frozenBase ?? undefined);
    const outputTokens = providerOutputTokens || Math.ceil(output.length / 2); const estimatedCost = estimateCost(provider, inputTokens, outputTokens);
    sqlite.prepare("UPDATE generation_runs SET status='待审核',output=?,duration_ms=?,input_tokens=?,output_tokens=?,estimated_cost=?,updated_at=? WHERE id=?").run(output, Date.now() - started, inputTokens, outputTokens, estimatedCost, now(), runId);
    publish(runId, "done", { version: candidate, output: candidateContent, generatedText: output, status: "待审核" });
  } catch (error) {
    const stopped = error instanceof DOMException && error.name === "AbortError";
    const partialContent = composeCandidate(input, output);
    if (output.trim() && !candidate) candidate = createChapterVersion(input.chapterId, partialContent, `AI未完成${input.taskType || "正文"}候选稿 ${new Date().toLocaleString("zh-CN")}`, "ai-partial", input.frozenBase ?? undefined);
    sqlite.prepare("UPDATE generation_runs SET status=?,output=?,error=?,duration_ms=?,output_tokens=?,updated_at=? WHERE id=?")
      .run(stopped ? "已停止" : "失败", output, String(error), Date.now() - started, Math.ceil(output.length / 2), now(), runId);
    publish(runId, stopped ? "stopped" : "error", { message: stopped ? "生成已停止，已有内容已保存为未完成候选稿" : String(error), partial: partialContent, version: candidate });
  } finally { controllers.delete(runId); setTimeout(() => emitters.delete(runId), 60_000); }
}

function estimateCost(provider: Provider | undefined, inputTokens: number, outputTokens: number) {
  if (!provider) return 0;
  return Math.round((inputTokens * Number(provider.input_price || 0) + outputTokens * Number(provider.output_price || 0)) / 1_000_000 * 100);
}

function composeCandidate(input: { baseContent?: string; selectionStart?: number; selectionEnd?: number }, generated: string) {
  if (typeof input.baseContent !== "string" || typeof input.selectionStart !== "number" || typeof input.selectionEnd !== "number") return generated;
  const start = Math.max(0, Math.min(input.baseContent.length, input.selectionStart));
  const end = Math.max(start, Math.min(input.baseContent.length, input.selectionEnd));
  return `${input.baseContent.slice(0, start)}${generated}${input.baseContent.slice(end)}`;
}

function persistOutput(runId: string, output: string) {
  sqlite.prepare("UPDATE generation_runs SET output=?,output_tokens=?,updated_at=? WHERE id=?").run(output, Math.ceil(output.length / 2), now(), runId);
}

export async function acceptCandidate(chapterId: string, versionId: string) {
  const version = sqlite.prepare("SELECT content FROM chapter_versions WHERE id=? AND chapter_id=?").get(versionId, chapterId) as { content: string } | undefined;
  const current = sqlite.prepare("SELECT * FROM chapters WHERE id=?").get(chapterId) as Record<string, unknown> | undefined;
  if (!version || !current) return null;
  if (current.current_version_id === versionId) return { chapter: current, analysis: null, alreadyAccepted: true };
  const blockingIssues = consistencyCheck(chapterId, version.content).filter((issue) => issue.level === "block");
  const context = contextForChapter(chapterId);
  if (context) {
    const lengthRule = resolveChapterLengthRule(context.chapter.outline as Record<string, string | number>, String(context.novel?.genre || ""));
    const words = countChapterWords(version.content);
    if (lengthRule.mode === "严格" && (words < lengthRule.min || words > lengthRule.max)) {
      blockingIssues.push({ level: "block", title: "候选正文超出严格字数范围", detail: `当前${words}字，要求${lengthRule.min}-${lengthRule.max}字。`, evidence: `目标${lengthRule.target}字` });
    }
  }
  if (blockingIssues.length) throw new CandidateAcceptanceBlockedError(blockingIssues);
  const acceptance = acceptChapterVersion(chapterId, versionId);
  if (acceptance.kind === "missing") return null;
  if (acceptance.kind === "already-current") return { chapter: acceptance.chapter, analysis: null, alreadyAccepted: true };
  if (acceptance.kind === "stale") throw new CandidateStaleError();
  const analysis = await analyzeAcceptedChapter(chapterId, version.content).catch((error) => ({ summary: version.content.replace(/\s+/g, " ").slice(0, 180), facts: [{ type: "分析警告", title: "章节分析失败", afterValue: String(error), evidence: "候选稿已接受，记忆可稍后人工补录" }] } satisfies ChapterAnalysis));
  applyChapterAnalysis(chapterId, versionId, analysis);
  return { chapter: sqlite.prepare("SELECT * FROM chapters WHERE id=?").get(chapterId), analysis, alreadyAccepted: false };
}

async function analyzeAcceptedChapter(chapterId: string, content: string): Promise<ChapterAnalysis> {
  const context = contextForChapter(chapterId); if (!context) throw new Error("章节不存在");
  const provider = selectedProvider(String(context.novel?.id), "事实抽取");
  if (!provider?.encrypted_key) return { summary: content.replace(/\s+/g, " ").slice(0, 180), facts: [{ type: "新增事实", title: "章节事实摘要", afterValue: content.replace(/\s+/g, " ").slice(0, 220), evidence: "本地摘要，需人工确认" }] };
  const prompt = factExtractionPrompt(context, content);
  const { content: result } = await requestText(provider, [{ role: "user", content: prompt }], { maxTokens: 8192, temperature: 0 });
  return extractJson<ChapterAnalysis>(result) || { summary: content.replace(/\s+/g, " ").slice(0, 180), facts: [{ type: "分析警告", title: "结构化抽取失败", afterValue: result.slice(0, 300), evidence: "模型返回格式无法解析" }] };
}

function factExtractionPrompt(context: NonNullable<ReturnType<typeof contextForChapter>>, content: string) {
  const novelId = String(context.novel?.id);
  const genre = String(context.novel?.genre || "中文网文");
  return `从已接受的小说章节中抽取长期记忆。不得把推测当事实；与正式设定冲突时type必须为“冲突”。只返回JSON对象，不要Markdown：
{"summary":"120-180字章节摘要","facts":[{"type":"新增事实|状态修改|冲突","title":"实体.属性","beforeValue":"原值或null","afterValue":"新值","evidence":"正文原句"}],"timeline":[{"timeLabel":"故事内时间","title":"事件","description":"结果"}],"foreshadows":[{"action":"新增|推进|回收","title":"伏笔名","description":"变化","targetChapter":数字,"evidence":"正文原句"}],"arcSummary":"若本章结束十章弧则给出摘要，否则空字符串","volumeSummary":"若本章结束分卷则给出摘要，否则空字符串"}
正式设定与事实：${JSON.stringify({ canon: context.canon, facts: context.facts, timeline: context.timeline, hooks: context.hooks })}
本章章纲：${JSON.stringify(context.chapter.outline)}
创作契约：${JSON.stringify(context.novel?.contract)}
小说级补充规则：${promptAdditions(novelId, "事实抽取") || "无"}
${knowledgePrompt({ taskType: "事实抽取", genre, chapterNumber: Number(context.chapter.number), instruction: "章节长期记忆与事实差异" })}
题材专项规则：${genreGuidance(genre)}
外部资料边界：模型没有联网检索权限，不得自行补写或声称查证历史、工资、票证、制度和机械精确数据；缺乏正文证据时不要提议为长期事实。
正文：${content}`;
}

export function applyChapterAnalysis(chapterId: string, versionId: string, analysis: ChapterAnalysis) {
  const chapter = sqlite.prepare("SELECT * FROM chapters WHERE id=?").get(chapterId) as Record<string, unknown>;
  if (!chapter) return;
  const t = now(); updateChapterSummary(chapterId, String(analysis.summary || ""));
  const pending = "\u5f85\u786e\u8ba4";
  const confirmed = "\u5df2\u786e\u8ba4";
  const conflict = "\u51b2\u7a81";
  const timelineType = "\u65f6\u95f4\u7ebf";
  const insertProposal = sqlite.prepare("INSERT INTO memory_proposals VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  const queue = (type: string, title: string, beforeValue: string | null, afterValue: string, evidence: string) => {
    const exists = sqlite.prepare("SELECT id FROM memory_proposals WHERE chapter_id=? AND type=? AND title=? AND after_value=? AND status=?")
      .get(chapterId, type, title, afterValue, pending);
    if (!exists) insertProposal.run(id(), chapter.novel_id, chapterId, type, title, beforeValue, afterValue, evidence, pending, t, t);
  };
  sqlite.transaction(() => {
    for (const fact of analysis.facts || []) {
      if (!fact.title || !fact.afterValue) continue;
      const type = String(fact.type || "\u65b0\u589e\u4e8b\u5b9e");
      if (type === conflict || type.includes("\u51b2\u7a81") || !fact.evidence) {
        queue(type, fact.title, fact.beforeValue || null, fact.afterValue, fact.evidence || "");
        continue;
      }
      const entityName = String(fact.title).split(/[.\u00b7]/)[0];
      const entity = sqlite.prepare("SELECT id FROM canon_entities WHERE novel_id=? AND name=?").get(chapter.novel_id, entityName) as { id: string } | undefined;
      const exists = sqlite.prepare("SELECT id FROM canon_facts WHERE source_chapter_id=? AND key=? AND value=?").get(chapterId, fact.title, fact.afterValue);
      if (!exists) sqlite.prepare("INSERT INTO canon_facts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(id(), chapter.novel_id, entity?.id || null, fact.title, fact.afterValue, confirmed, chapterId, versionId, t, t);
    }
    for (const event of analysis.timeline || []) {
      if (!event.title) continue;
      const exists = sqlite.prepare("SELECT id FROM timeline_events WHERE novel_id=? AND chapter_id=? AND title=?").get(chapter.novel_id, chapterId, event.title);
      if (!exists) sqlite.prepare("INSERT INTO timeline_events VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(id(), chapter.novel_id, chapterId, event.timeLabel || `第${chapter.number}章`, event.title, event.description || "", Number(chapter.number) * 100, t, t);
    }
    for (const hook of analysis.foreshadows || []) {
      if (!hook.title) continue;
      const action = String(hook.action || "\u63a8\u8fdb");
      const title = String(hook.title);
      const existing = sqlite.prepare("SELECT id FROM foreshadows WHERE novel_id=? AND title=?").get(chapter.novel_id, title) as { id: string } | undefined;
      if (action.includes("\u56de\u6536")) {
        if (existing) sqlite.prepare("UPDATE foreshadows SET status=?,resolved_chapter_id=?,updated_at=? WHERE id=?").run("\u5df2\u56de\u6536", chapterId, t, existing.id);
        else queue(`\u4f0f\u7b14${action}`, title, null, JSON.stringify(hook), hook.evidence || "");
      } else if (action.includes("\u65b0\u589e")) {
        if (!existing) sqlite.prepare("INSERT INTO foreshadows VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)").run(id(), chapter.novel_id, title, hook.description || "", chapterId, hook.targetChapter || null, "\u672a\u56de\u6536", "\u4e2d", t, t);
      } else if (existing) {
        sqlite.prepare("UPDATE foreshadows SET description=?,target_chapter=COALESCE(?,target_chapter),updated_at=? WHERE id=?").run(hook.description || "", hook.targetChapter || null, t, existing.id);
      } else {
        queue(`\u4f0f\u7b14${action}`, title, null, JSON.stringify(hook), hook.evidence || "");
      }
    }
    if (Number(chapter.number) % 10 === 0 && analysis.arcSummary && chapter.arc_id) sqlite.prepare("UPDATE story_arcs SET summary=?,updated_at=? WHERE id=?").run(analysis.arcSummary, t, chapter.arc_id);
    if (Number(chapter.number) % 30 === 0 && analysis.volumeSummary && chapter.volume_id) sqlite.prepare("UPDATE volumes SET summary=?,updated_at=? WHERE id=?").run(analysis.volumeSummary, t, chapter.volume_id);
    sqlite.prepare("UPDATE canon_facts SET source_version_id=? WHERE source_chapter_id=? AND source_version_id IS NULL").run(versionId, chapterId);
  })();
}

export function localQualityCheck(content: string) {
  const first = content.slice(0, 200); const last = content.slice(-220);
  const dimensions: Array<[string, number, string, string]> = [
    ["开篇抓力", /[？！]|死|血|异常|倒计时|威胁/.test(first) ? 86 : 62, first || "正文为空", "前200字建立异常、利益或迫近危险。"],
    ["冲突强度", /不能|威胁|阻止|代价|选择|否则/.test(content) ? 82 : 58, content.slice(0, 240), "让对手目标与主角目标在场景内直接碰撞。"],
    ["人物动机", /为了|必须|想要|不愿|答应/.test(content) ? 78 : 60, content.slice(0, 260), "用具体选择和代价呈现人物为什么行动。"],
    ["情绪推进", /却|直到|终于|反而/.test(content) ? 78 : 62, content.slice(Math.max(0, Math.floor(content.length / 2) - 100), Math.floor(content.length / 2) + 120), "在中段安排一次明确的情绪转折。"],
    ["节奏", content.length >= 1200 ? 78 : 64, `正文约${content.length}字符`, "控制解释段长度，让行动、信息和反应交替。"],
    ["信息密度", /原来|发现|意味着|证据|规则/.test(content) ? 80 : 62, content.slice(200, 440), "至少推进一条新信息，避免只重复冲突。"],
    ["兑现感", /获得|赢|资格|到账|承认|退让/.test(content) ? 82 : 58, content.slice(-500), "明确写出能力、身份、金钱、关系或线索收益。"],
    ["结尾钩子", /[？]|忽然|名字|真相|声音|订单/.test(last) ? 88 : 60, last || "正文为空", "用新危险、新信息或未完成动作收尾。"],
    ["设定一致性", 70, "本地规则无法完成语义级核验", "使用模型质检并在定稿前确认记忆差异。"],
    ["重复表达", /(仿佛.{0,25}仿佛)|(不由得.{0,35}不由得)/.test(content) ? 58 : 84, "基于高频句式的本地初筛", "删除近距离重复意象和同义解释。"],
    ["机械化文风", /(他知道.{0,40}他知道)|(不仅.{0,50}更)/.test(content) ? 62 : 84, "基于总结句和模板连接词的本地初筛", "用动作、对白和环境反应替代总结腔。"],
  ];
  const positions: Record<string, string> = {
    开篇抓力: "开头", 冲突强度: "中段", 人物动机: "开头", 情绪推进: "中段", 节奏: "全章", 信息密度: "中段",
    兑现感: "结尾", 结尾钩子: "结尾", 设定一致性: "全章", 重复表达: "全章", 机械化文风: "全章",
  };
  const issues = dimensions.map(([dimension, score, evidence, suggestion]) => ({ dimension, score, evidence: evidence || "当前正文中未找到足够证据", suggestion, position: positions[dimension] || "全章" }));
  return { total: Math.round(issues.reduce((sum, issue) => sum + issue.score, 0) / issues.length), issues, mode: "local" as const, note: "本地规则初筛完成。" };
}

export function previewPrompt(chapterId: string, taskType = "正文", instruction = "") {
  const context = contextForChapter(chapterId); if (!context) return null;
  return { prompt: buildPrompt(context, taskType, instruction), retrieval: context.retrieval };
}

export async function testProvider(providerId: string) {
  const provider = sqlite.prepare("SELECT * FROM providers WHERE id=?").get(providerId) as Provider | undefined;
  if (!provider?.encrypted_key) throw new Error("供应商未保存API密钥");
  const started = Date.now();
  const result = await requestText(provider, [{ role: "user", content: "只回复两个大写字母：OK" }], { maxTokens: 512, temperature: 0 });
  return { ok: result.content.trim().endsWith("OK"), model: provider.model, durationMs: Date.now() - started, response: result.content.trim().slice(-20) };
}

export async function semanticQualityCheck(chapterId: string, content: string) {
  const local = localQualityCheck(content); const context = contextForChapter(chapterId);
  if (!context) return local;
  const provider = selectedProvider(String(context.novel?.id), "质检");
  if (!provider?.encrypted_key) return { ...local, note: "没有可用的质检模型，本次使用本地规则评分。" };
  const prompt = qualityPrompt(context, content);
  try {
    const { content: result } = await requestText(provider, [{ role: "user", content: prompt }], { maxTokens: 8192, temperature: 0.1 });
    const parsed = extractJson<{ total: number; issues: QualityIssue[]; note: string }>(result);
    if (!parsed?.issues?.length) return local;
    const semantic = new Map(parsed.issues.map((issue) => [issue.dimension.trim(), issue]));
    const issues = local.issues.map((fallback) => semantic.get(fallback.dimension) || { ...fallback, position: "全章" });
    const missing = issues.filter((issue) => !semantic.has(issue.dimension)).length;
    return {
      total: Math.round(issues.reduce((sum, issue) => sum + Number(issue.score || 0), 0) / issues.length),
      issues,
      mode: "ai" as const,
      note: `${parsed.note || "模型语义质检完成"}${missing ? `；模型返回${parsed.issues.length}项，其余${missing}项由本地规则补齐。` : ""}`,
    };
  } catch (error) {
    return { ...local, note: "模型调用失败，本次已返回本地规则评分。" };
  }
}

function qualityPrompt(context: NonNullable<ReturnType<typeof contextForChapter>>, content: string) {
  const novelId = String(context.novel?.id);
  const genre = String(context.novel?.genre || "中文网文");
  return `你是番茄网文责任编辑。根据章纲、正式设定、最近章节和正文做严格质检。只返回JSON对象，不要Markdown：{"total":0到100,"issues":[{"dimension":"维度","score":0到100,"evidence":"原句或明确位置","position":"开头/中段/结尾/第N段","suggestion":"可直接执行的修改"}],"note":"总评"}。必须覆盖：开篇抓力、冲突强度、人物动机、情绪推进、节奏、信息密度、兑现感、结尾钩子、设定一致性、重复表达、机械化文风。低分必须给正文证据，不能只给总分。
创作契约：${JSON.stringify(context.novel?.contract)}
上下文：${JSON.stringify({ outline: context.chapter.outline, canon: context.canon, facts: context.facts, recent: context.recent, hierarchy: context.hierarchy, timeline: context.timeline, hooks: context.hooks })}
小说级补充规则：${promptAdditions(novelId, "质检") || "无"}
${knowledgePrompt({ taskType: "质检", genre, chapterNumber: Number(context.chapter.number), instruction: "章节抓力、一致性、节奏与机械化文风" })}
题材专项规则：${genreGuidance(genre)}
外部资料边界：模型没有联网检索权限，不得声称已查证外部资料；遇到未经确认的历史、工资、票证、制度或机械精确数据，应标为风险并建议人工核验。
正文：${content}`;
}

export function previewAnalysisPrompt(chapterId: string, taskType: "事实抽取" | "质检", content = "") {
  const context = contextForChapter(chapterId);
  if (!context) return null;
  return taskType === "事实抽取" ? factExtractionPrompt(context, content) : qualityPrompt(context, content);
}

const deepPositioningSchema = z.object({
  title: z.string().min(1), titleOptions: z.array(z.string().min(1)).min(3).max(8), pitch: z.string().min(1),
  targetReaders: z.string().min(1), corePromise: z.string().min(1), differentiation: z.string().min(1),
  protagonistDesire: z.string().min(1), coreConflict: z.string().min(1), driver: z.string().min(1),
  endingDirection: z.string().min(1), blurb: z.string().min(1), goldenThree: z.array(z.string().min(1)).length(3),
});
const deepArcSchema = z.object({ title: z.string().min(1), goal: z.string().min(1), conflict: z.string().min(1), payoff: z.string().min(1), hooks: z.string().min(1) });
const deepVolumeSchema = z.object({
  number: z.coerce.number().int().positive(), title: z.string().min(1), goal: z.string().min(1), conflict: z.string().min(1),
  turningPoints: z.array(z.string().min(1)).min(2), summary: z.string().min(1), arcs: z.array(deepArcSchema).min(1).max(5),
});
const deepCanonSchema = z.object({
  kind: z.enum(["人物", "地点", "势力", "世界规则", "能力物品", "核心秘密", "禁止事项", "文风规则", "目标结局"]),
  name: z.string().min(1), summary: z.string().min(1), locked: z.boolean().default(false),
});
const deepForeshadowSchema = z.object({
  title: z.string().min(1), description: z.string().min(1), targetChapter: z.coerce.number().int().positive().nullable().default(null),
  importance: z.enum(["高", "中", "低"]).default("中"),
});
const deepFoundationSchema = z.object({
  canon: z.array(deepCanonSchema).min(8).max(40),
  foreshadows: z.array(deepForeshadowSchema).min(3).max(20),
});
const deepStructureSchema = deepFoundationSchema.extend({ volumes: z.array(deepVolumeSchema).min(3).max(15) });
const deepChapterSchema = z.object({
  number: z.coerce.number().int().positive(), title: z.string().min(1), volumeNumber: z.coerce.number().int().positive(), arcTitle: z.string().min(1),
  outline: z.object({
    goal: z.string().min(1), viewpoint: z.string().min(1), conflict: z.string().min(1), reveal: z.string().min(1), emotion: z.string().min(1),
    foreshadow: z.string().min(1), expectedWords: z.coerce.number().int().min(1200).max(6000), hook: z.string().min(1),
    witness: z.string().min(1), reward: z.string().min(1), abilitySource: z.string().min(1), stateChange: z.string().min(1),
  }),
});
const deepAuditSchema = z.object({
  score: z.coerce.number().min(0).max(100), strengths: z.array(z.string()).default([]), blockers: z.array(z.string()).default([]),
  issues: z.array(z.object({ severity: z.enum(["高", "中", "低"]), section: z.string(), problem: z.string(), suggestion: z.string() })).default([]),
});
const deepProposalSchema = z.object({
  kind: z.literal("deep-planning-candidate"), baseVersion: z.coerce.number().int().positive(), interview: z.record(z.string(), z.unknown()),
  positioning: deepPositioningSchema, structure: deepStructureSchema, chapters: z.array(deepChapterSchema).min(1).max(30), audit: deepAuditSchema,
  localAudit: z.object({ score: z.number(), blockers: z.array(z.string()), warnings: z.array(z.string()) }),
});

export type DeepPlanningInput = { novelId: string; interview: { idea?: string; targetReaders?: string; desiredExperience?: string; protagonist?: string; mustHave?: string; avoid?: string; ending?: string; targetChapters?: number } };

async function requestStructuredText(provider: Provider, prompt: string, signal: AbortSignal, maxTokens: number, temperature: number) {
  try {
    return await requestText(provider, [{ role: "user", content: prompt }], { signal, maxTokens, temperature, reasoningEffort: "low" });
  } catch (error) {
    const exhausted = error instanceof Error && error.message.includes("输出预算被思考过程耗尽");
    if (!exhausted || maxTokens >= 32768) throw error;
    return requestText(provider, [{ role: "user", content: prompt }], { signal, maxTokens: Math.min(32768, maxTokens * 2), temperature, reasoningEffort: "low" });
  }
}

async function requestStructured<T>(provider: Provider, prompt: string, schema: z.ZodType<T>, signal: AbortSignal, maxTokens = 8192) {
  const first = await requestStructuredText(provider, prompt, signal, maxTokens, 0.45);
  let parsed = schema.safeParse(extractJson<unknown>(first.content));
  if (parsed.success) return { value: parsed.data, usage: first.usage };
  const errors = parsed.error.issues.map((item) => `${item.path.join(".")}:${item.message}`).join("；");
  const repair = await requestStructuredText(provider, `把下面内容修复成符合要求的纯JSON。不要解释，不要Markdown，不新增故事方向；只修字段、类型、缺项和JSON语法。\n校验错误：${errors}\n原内容：\n${first.content}`, signal, maxTokens, 0);
  parsed = schema.safeParse(extractJson<unknown>(repair.content));
  if (!parsed.success) throw new Error(`结构化阶段返回不合格：${parsed.error.issues.slice(0, 5).map((item) => `${item.path.join(".")}:${item.message}`).join("；")}`);
  return { value: parsed.data, usage: repair.usage || first.usage };
}

function localDeepAudit(structure: z.infer<typeof deepStructureSchema>, chapters: z.infer<typeof deepChapterSchema>[], targetChapters: number) {
  const blockers: string[] = []; const warnings: string[] = [];
  const numbers = chapters.map((item) => item.number); const volumeNumbers = new Set(structure.volumes.map((item) => item.number));
  if (chapters.length !== Math.min(30, targetChapters)) blockers.push(`前期章纲数量应为${Math.min(30, targetChapters)}，实际${chapters.length}`);
  if (new Set(numbers).size !== chapters.length || numbers.some((value, index) => value !== index + 1)) blockers.push("章节编号必须从1连续递增且不得重复");
  if (new Set(chapters.map((item) => item.title.trim())).size !== chapters.length) warnings.push("前30章存在重复标题");
  if (chapters.some((item) => !volumeNumbers.has(item.volumeNumber))) blockers.push("章节引用了不存在的分卷");
  if (new Set(chapters.map((item) => item.outline.hook.trim())).size < Math.ceil(chapters.length * 0.7)) warnings.push("结尾钩子重复度偏高");
  if (new Set(chapters.map((item) => item.outline.reward.trim())).size < Math.ceil(chapters.length * 0.6)) warnings.push("即时奖励变化不足");
  if (!structure.canon.some((item) => item.kind === "禁止事项")) warnings.push("故事圣经缺少禁止事项");
  return { score: Math.max(0, 100 - blockers.length * 25 - warnings.length * 8), blockers, warnings };
}

export function startDeepPlanning(input: DeepPlanningInput) {
  const novel = sqlite.prepare("SELECT * FROM novels WHERE id=?").get(input.novelId) as Record<string, unknown> | undefined;
  if (!novel) return null;
  const previous = sqlite.prepare("SELECT output FROM generation_runs WHERE novel_id=? AND task_type='深度开书' AND status IN ('失败','已停止') ORDER BY created_at DESC LIMIT 1").get(input.novelId) as { output: string } | undefined;
  const previousPartial = json<Record<string, unknown> | null>(previous?.output, null);
  const resume = previousPartial?.kind === "deep-planning-partial" && JSON.stringify(previousPartial.interview) === JSON.stringify(input.interview) ? previousPartial : undefined;
  const runId = id(); const t = now(); const provider = selectedProvider(input.novelId, "策划");
  sqlite.prepare(`INSERT INTO generation_runs (id,novel_id,chapter_id,task_type,provider_id,model,status,output,prompt_version,created_at,updated_at) VALUES (?,?,NULL,'深度开书',?,?,?,'','deep-plan-v1',?,?)`)
    .run(runId, input.novelId, provider?.id || null, provider?.model || "未配置", "排队中", t, t);
  void runDeepPlanning(runId, input, novel, provider, resume);
  return { runId };
}

export function resumeInterruptedDeepPlanningTasks() {
  const interrupted = sqlite.prepare("SELECT id,novel_id,output FROM generation_runs WHERE task_type=? AND status IN (?,?) ORDER BY created_at")
    .all("\u6df1\u5ea6\u5f00\u4e66", "\u6392\u961f\u4e2d", "\u751f\u6210\u4e2d") as Array<{ id: string; novel_id: string; output: string }>;
  const resumed: Array<{ oldRunId: string; runId: string; novelId: string }> = [];
  for (const row of interrupted) {
    const partial = json<Record<string, unknown> | null>(row.output, null);
    const interview = partial?.kind === "deep-planning-partial" && partial.interview && typeof partial.interview === "object"
      ? partial.interview as DeepPlanningInput["interview"]
      : null;
    sqlite.prepare("UPDATE generation_runs SET status=?,error=?,updated_at=? WHERE id=?")
      .run("\u5df2\u505c\u6b62", "\u670d\u52a1\u91cd\u542f\uff0c\u5df2\u4ece\u4fdd\u5b58\u7684\u9636\u6bb5\u7ed3\u679c\u81ea\u52a8\u7ee7\u7eed", now(), row.id);
    if (!interview) continue;
    const next = startDeepPlanning({ novelId: row.novel_id, interview });
    if (next) resumed.push({ oldRunId: row.id, runId: next.runId, novelId: row.novel_id });
  }
  return resumed;
}

async function runDeepPlanning(runId: string, input: DeepPlanningInput, novelRow: Record<string, unknown>, provider?: Provider, resume?: Record<string, unknown>) {
  const started = Date.now(); const controller = new AbortController(); controllers.set(runId, controller);
  const targetChapters = Math.max(30, Math.min(500, Number(input.interview.targetChapters || Math.round(Number(novelRow.target_words || 900000) / 3000))));
  let partial: Record<string, unknown> = resume ? { ...resume, baseVersion: Number(novelRow.version), interview: input.interview } : { kind: "deep-planning-partial", baseVersion: Number(novelRow.version), interview: input.interview };
  let inputTokens = 0; let outputTokens = 0;
  const addUsage = (usage?: Record<string, number>) => { inputTokens += Number(usage?.prompt_tokens || 0); outputTokens += Number(usage?.completion_tokens || 0); };
  try {
    if (!provider?.encrypted_key) throw new Error("深度开书需要已启用且保存密钥的策划模型");
    sqlite.prepare("UPDATE generation_runs SET status='生成中',updated_at=? WHERE id=?").run(now(), runId);
    persistOutput(runId, JSON.stringify(partial));
    const resumedPositioning = deepPositioningSchema.safeParse(partial.positioning);
    let positioning: z.infer<typeof deepPositioningSchema>;
    if (resumedPositioning.success) {
      positioning = resumedPositioning.data;
      publish(runId, "phase", { status: "已恢复商业定位与创作契约", progress: 18 });
    } else {
      publish(runId, "phase", { status: "商业定位与创作契约", progress: 12 });
      const positioningPrompt = `你是中文长篇网文总策划。把用户访谈转成可持续长篇的商业定位与创作契约。只返回纯JSON，不要Markdown。\n作品现状：${JSON.stringify({ title: novelRow.title, genre: novelRow.genre, targetWords: novelRow.target_words, description: novelRow.description, existingContract: json(novelRow.contract, {}), existingPlanning: json(novelRow.planning, {}) })}\n用户访谈：${JSON.stringify({ ...input.interview, targetChapters })}\n${knowledgePrompt({ taskType: "策划", genre: String(novelRow.genre || "通用"), instruction: `${input.interview.idea || ""} 深度开书 题材卖点 故事发动机` })}\n要求：卖点可一句话传播；主角欲望能持续升级；驱动力有边界；书名简介与前三章承诺一致；不承诺流量。\nJSON：{"title":"推荐书名","titleOptions":["至少3个"],"pitch":"一句话故事","targetReaders":"目标读者","corePromise":"阅读承诺","differentiation":"差异化","protagonistDesire":"长期欲望","coreConflict":"核心矛盾","driver":"驱动力及边界","endingDirection":"结局方向","blurb":"简介","goldenThree":["第一章","第二章","第三章"]}`;
      const positioningResult = await requestStructured(provider, positioningPrompt, deepPositioningSchema, controller.signal); addUsage(positioningResult.usage);
      positioning = positioningResult.value; partial = { ...partial, positioning }; persistOutput(runId, JSON.stringify(partial));
    }

    publish(runId, "phase", { status: "故事圣经与伏笔底稿", progress: 22 });
    const volumeCount = Math.max(3, Math.min(12, Math.ceil(targetChapters / 35)));
    const foundationPrompt = `你是长篇设定架构师。基于定位只构建故事圣经和全书伏笔底稿，不写分卷和章纲。只返回纯JSON。\n定位：${JSON.stringify(positioning)}\n题材：${novelRow.genre}；目标章节：${targetChapters}；用户边界：${JSON.stringify({ mustHave: input.interview.mustHave, avoid: input.interview.avoid })}\n${knowledgePrompt({ taskType: "策划", genre: String(novelRow.genre || "通用"), instruction: "人物冲突网 能力边界 世界规则 长线伏笔" })}\n要求：人物有独立欲望和可交易资源；能力写来源、收益、短板、代价和不可跳过的核心过程；锁定底层规则；伏笔给预计回收章；未核验数字保持模糊。\nJSON：{"canon":[{"kind":"人物|地点|势力|世界规则|能力物品|核心秘密|禁止事项|文风规则|目标结局","name":"名称","summary":"设定","locked":true}],"foreshadows":[{"title":"伏笔","description":"内容","targetChapter":30,"importance":"高|中|低"}]}`;
    const resumedFoundation = deepFoundationSchema.safeParse(partial.structure);
    let foundation: z.infer<typeof deepFoundationSchema>;
    if (resumedFoundation.success) {
      foundation = resumedFoundation.data;
      publish(runId, "phase", { status: "已恢复故事圣经与伏笔底稿", progress: 24 });
    } else {
      const foundationResult = await requestStructured(provider, foundationPrompt, deepFoundationSchema, controller.signal); addUsage(foundationResult.usage);
      foundation = foundationResult.value;
    }
    const resumedVolumes = z.array(deepVolumeSchema).safeParse((partial.structure as { volumes?: unknown } | undefined)?.volumes);
    const volumes = resumedVolumes.success && resumedVolumes.data.every((item, index) => item.number === index + 1) ? resumedVolumes.data.slice(0, volumeCount) : [];
    partial = { ...partial, structure: { ...foundation, volumes } }; persistOutput(runId, JSON.stringify(partial));

    const splitWorthy = (error: unknown) => error instanceof Error && (error.message.includes("输出预算被思考过程耗尽") || error.message.includes("结构化阶段返回不合格"));
    const generateVolumeRange = async (start: number, end: number): Promise<void> => {
      publish(runId, "phase", { status: `搭建第${start}—${end}卷`, progress: 24 + Math.round(end / volumeCount * 16) });
      const volumeBatchSchema = z.object({ volumes: z.array(deepVolumeSchema).length(end - start + 1) });
      const volumePrompt = `你是长篇分卷架构师。只设计第${start}—${end}卷，每卷承担不同阶段的状态跃迁。只返回纯JSON。\n定位：${JSON.stringify(positioning)}\n故事圣经：${JSON.stringify(foundation.canon)}\n全书伏笔：${JSON.stringify(foundation.foreshadows)}\n已完成分卷：${JSON.stringify(volumes.map((item) => ({ number: item.number, title: item.title, summary: item.summary, hooks: item.arcs.map((arc) => arc.hooks) })))}\n总章节：${targetChapters}；总卷数：${volumeCount}。\n${knowledgePrompt({ taskType: "策划", genre: String(novelRow.genre || "通用"), instruction: "长篇滚动规划 分卷状态变化 期待兑现" })}\n要求：编号严格从${start}到${end}；每卷2至4个情节弧；目标、冲突、转折、兑现和遗留钩子不可重复；后卷扩大问题而非消灭冲突。\nJSON：{"volumes":[{"number":${start},"title":"卷名","goal":"状态目标","conflict":"冲突","turningPoints":["至少两个转折"],"summary":"卷末永久状态变化","arcs":[{"title":"情节弧","goal":"目标","conflict":"冲突","payoff":"兑现","hooks":"遗留钩子"}]}]}`;
      try {
        const volumeBatch = await requestStructured(provider, volumePrompt, volumeBatchSchema, controller.signal); addUsage(volumeBatch.usage);
        volumes.push(...volumeBatch.value.volumes); partial = { ...partial, structure: { ...foundation, volumes } }; persistOutput(runId, JSON.stringify(partial));
      } catch (error) {
        if (!splitWorthy(error) || start === end) throw error;
        const middle = Math.floor((start + end) / 2);
        publish(runId, "phase", { status: `第${start}—${end}卷响应过长，自动拆分`, progress: 24 + Math.round((start - 1) / volumeCount * 16) });
        await generateVolumeRange(start, middle);
        await generateVolumeRange(middle + 1, end);
      }
    };
    for (let start = volumes.length + 1; start <= volumeCount; start = volumes.length + 1) {
      await generateVolumeRange(start, Math.min(volumeCount, start + 2));
    }
    const structure = deepStructureSchema.parse({ ...foundation, volumes });

    const resumedChapters = z.array(deepChapterSchema).safeParse(partial.chapters);
    const chapters = resumedChapters.success && resumedChapters.data.every((item, index) => item.number === index + 1) ? resumedChapters.data : [];
    const plannedChapters = Math.min(30, targetChapters);
    const genreProfile = getFanqieGenreProfile(String(novelRow.genre || ""));
    const generateChapterRange = async (start: number, end: number): Promise<void> => {
      publish(runId, "phase", { status: `细化第${start}—${end}章`, progress: 40 + Math.round(end / plannedChapters * 38) });
      const batchSchema = z.object({ chapters: z.array(deepChapterSchema).length(end - start + 1) });
      const chapterPrompt = `你是番茄长篇章纲策划。只返回第${start}—${end}章纯JSON。\n定位：${JSON.stringify(positioning)}\n分卷情节弧：${JSON.stringify(structure.volumes)}\n设定：${JSON.stringify(structure.canon)}\n伏笔：${JSON.stringify(structure.foreshadows)}\n上一批末尾：${JSON.stringify(chapters.slice(-3).map((item) => ({ number: item.number, title: item.title, stateChange: item.outline.stateChange, hook: item.outline.hook })))}\n题材章长建议：${genreProfile.chapterWords.min}-${genreProfile.chapterWords.max}字，默认${genreProfile.chapterWords.target}字。\n${knowledgePrompt({ taskType: "章纲", genre: String(novelRow.genre || "通用"), chapterNumber: start, instruction: `${start <= 3 ? "黄金三章" : "滚动章纲"} 状态变化 钩子 兑现` })}\n要求：编号严格${start}到${end}；前三章依次危机/方法/有限兑现；每章冲突、钩子和奖励有变化；能力来源不能临场新增；章长根据本章功能在建议区间内调整。\nJSON：{"chapters":[{"number":${start},"title":"章名","volumeNumber":1,"arcTitle":"已有情节弧","outline":{"goal":"目标","viewpoint":"主视角","conflict":"冲突","reveal":"揭示","emotion":"情绪点","foreshadow":"伏笔动作","expectedWords":${genreProfile.chapterWords.target},"hook":"结尾钩子","witness":"见证者","reward":"现实收益","abilitySource":"能力来源","stateChange":"状态差异"}}]}`;
      try {
        const batch = await requestStructured(provider, chapterPrompt, batchSchema, controller.signal); addUsage(batch.usage);
        chapters.push(...batch.value.chapters); partial = { ...partial, chapters }; persistOutput(runId, JSON.stringify(partial));
      } catch (error) {
        if (!splitWorthy(error) || start === end) throw error;
        const middle = Math.floor((start + end) / 2);
        publish(runId, "phase", { status: `第${start}—${end}章响应过长，自动拆分`, progress: 40 + Math.round((start - 1) / plannedChapters * 38) });
        await generateChapterRange(start, middle);
        await generateChapterRange(middle + 1, end);
      }
    };
    for (let start = chapters.length + 1; start <= plannedChapters; start = chapters.length + 1) {
      await generateChapterRange(start, Math.min(plannedChapters, start + 4));
    }

    const localAudit = localDeepAudit(structure, chapters, targetChapters);
    publish(runId, "phase", { status: "独立交叉审计", progress: 84 });
    let audit: z.infer<typeof deepAuditSchema> = { score: localAudit.score, strengths: [], blockers: localAudit.blockers, issues: localAudit.warnings.map((problem) => ({ severity: "中", section: "本地结构检查", problem, suggestion: "人工审批前修正" })) };
    try {
      const auditPrompt = `你是独立责任编辑，不参与前面的策划。审计方案，不重写。只返回纯JSON。重点检查题材承诺、主角主动性、长篇续航、人物动机、能力边界、卷级状态、前三章兑现、前30章重复和事实风险。\n${knowledgePrompt({ taskType: "质检", genre: String(novelRow.genre || "通用"), instruction: "深度开书交叉审计" })}\n方案：${JSON.stringify({ positioning, structure, chapters })}\nJSON：{"score":0,"strengths":["优点"],"blockers":["阻塞"],"issues":[{"severity":"高|中|低","section":"位置","problem":"问题","suggestion":"建议"}]}`;
      const audited = await requestStructured(provider, auditPrompt, deepAuditSchema, controller.signal, 12288); addUsage(audited.usage); audit = audited.value;
    } catch (error) { publish(runId, "phase", { status: "模型审计不可用，保留本地结构审计", warning: String(error), progress: 92 }); }

    const proposal = deepProposalSchema.parse({ kind: "deep-planning-candidate", baseVersion: Number(novelRow.version), interview: input.interview, positioning, structure, chapters, audit, localAudit });
    const output = JSON.stringify(proposal); const estimatedCost = estimateCost(provider, inputTokens, outputTokens || Math.ceil(output.length / 2));
    sqlite.prepare("UPDATE generation_runs SET status='待审核',output=?,duration_ms=?,input_tokens=?,output_tokens=?,estimated_cost=?,updated_at=? WHERE id=?")
      .run(output, Date.now() - started, inputTokens, outputTokens || Math.ceil(output.length / 2), estimatedCost, now(), runId);
    publish(runId, "done", { proposal, status: "待审核" });
  } catch (error) {
    const stopped = error instanceof DOMException && error.name === "AbortError"; const output = JSON.stringify(partial);
    sqlite.prepare("UPDATE generation_runs SET status=?,output=?,error=?,duration_ms=?,input_tokens=?,output_tokens=?,updated_at=? WHERE id=?")
      .run(stopped ? "已停止" : "失败", output, String(error), Date.now() - started, inputTokens, outputTokens || Math.ceil(output.length / 2), now(), runId);
    publish(runId, stopped ? "stopped" : "error", { message: stopped ? "深度开书已停止，已保留阶段结果" : String(error), partial });
  } finally { controllers.delete(runId); setTimeout(() => emitters.delete(runId), 60_000); }
}

function planningContract(positioning: z.infer<typeof deepPositioningSchema>) {
  return {
    核心卖点: positioning.corePromise, 目标读者: positioning.targetReaders, 主角欲望: positioning.protagonistDesire,
    核心矛盾: positioning.coreConflict, 金手指或关系驱动力: positioning.driver, 差异化设定: positioning.differentiation,
    结局方向: positioning.endingDirection,
  };
}

export function applyDeepPlanningCandidate(input: { novelId: string; runId: string; version: number; sections?: string[] }) {
  const row = sqlite.prepare("SELECT * FROM generation_runs WHERE id=? AND novel_id=? AND task_type='深度开书'").get(input.runId, input.novelId) as Record<string, unknown> | undefined;
  if (!row) return { kind: "missing" as const };
  if (row.status !== "待审核") return { kind: "invalid" as const, message: "该深度开书任务不在待审核状态" };
  const parsed = deepProposalSchema.safeParse(json<unknown>(row.output, null));
  if (!parsed.success) return { kind: "invalid" as const, message: "候选方案结构不完整" };
  const proposal = parsed.data;
  const novel = sqlite.prepare("SELECT version,genre FROM novels WHERE id=?").get(input.novelId) as { version: number; genre: string } | undefined;
  if (!novel) return { kind: "missing" as const };
  if (Number(input.version) !== novel.version || proposal.baseVersion !== novel.version) return { kind: "conflict" as const };
  const sections = new Set(input.sections?.length ? input.sections : ["positioning", "canon", "structure", "chapters", "foreshadows"]); const t = now();
  const genreProfile = getFanqieGenreProfile(novel.genre);
  const result = sqlite.transaction(() => {
    if (sections.has("positioning")) {
      sqlite.prepare("UPDATE novels SET title=?,description=?,contract=?,planning=?,stage='筹备',version=version+1,updated_at=? WHERE id=?")
        .run(proposal.positioning.title, proposal.positioning.pitch, JSON.stringify(planningContract(proposal.positioning)), JSON.stringify({ 书名: proposal.positioning.title, 备选书名: proposal.positioning.titleOptions.join("；"), 简介: proposal.positioning.blurb, 黄金三章: proposal.positioning.goldenThree.join("\n"), 番茄题材模板: novel.genre, 建议单章字数: `${genreProfile.chapterWords.min}-${genreProfile.chapterWords.max}`, 默认单章目标: String(genreProfile.chapterWords.target) }), t, input.novelId);
    }
    if (sections.has("canon")) {
      for (const entity of proposal.structure.canon) {
        if (sqlite.prepare("SELECT id FROM canon_entities WHERE novel_id=? AND kind=? AND name=?").get(input.novelId, entity.kind, entity.name)) continue;
        const entityId = id();
        sqlite.prepare("INSERT INTO canon_entities VALUES (?, ?, ?, ?, ?, '{}', ?, 1, ?, ?)").run(entityId, input.novelId, entity.kind, entity.name, entity.summary, entity.locked ? 1 : 0, t, t);
        sqlite.prepare("INSERT INTO story_search (novel_id,source_type,source_id,title,content) VALUES (?, 'canon', ?, ?, ?)").run(input.novelId, entityId, entity.name, entity.summary);
      }
    }
    const volumeIds = new Map<number, string>(); const arcIds = new Map<string, string>();
    if (sections.has("structure") || sections.has("chapters")) {
      const existingVolumes = sqlite.prepare("SELECT * FROM volumes WHERE novel_id=? ORDER BY number").all(input.novelId) as Record<string, unknown>[];
      existingVolumes.forEach((item) => volumeIds.set(Number(item.number), String(item.id)));
      const chapterCount = Number((sqlite.prepare("SELECT COUNT(*) count FROM chapters WHERE novel_id=?").get(input.novelId) as { count: number }).count);
      const canReusePlaceholder = existingVolumes.length === 1 && !String(existingVolumes[0].goal || "").trim() && chapterCount === 0;
      for (const volume of proposal.structure.volumes) {
        let volumeId = volumeIds.get(volume.number);
        if (canReusePlaceholder && volume.number === 1) {
          volumeId = String(existingVolumes[0].id);
          sqlite.prepare("UPDATE volumes SET title=?,goal=?,conflict=?,turning_points=?,summary=?,version=version+1,updated_at=? WHERE id=?")
            .run(volume.title, volume.goal, volume.conflict, JSON.stringify(volume.turningPoints), volume.summary, t, volumeId);
        } else if (!volumeId && sections.has("structure")) {
          volumeId = id();
          sqlite.prepare("INSERT INTO volumes (id,novel_id,number,title,goal,conflict,turning_points,summary,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,1,?,?)")
            .run(volumeId, input.novelId, volume.number, volume.title, volume.goal, volume.conflict, JSON.stringify(volume.turningPoints), volume.summary, t, t);
        }
        if (!volumeId) continue; volumeIds.set(volume.number, volumeId);
        if (sections.has("structure")) for (const arc of volume.arcs) {
          const existing = sqlite.prepare("SELECT id FROM story_arcs WHERE novel_id=? AND volume_id=? AND title=?").get(input.novelId, volumeId, arc.title) as { id: string } | undefined;
          const arcId = existing?.id || id();
          if (!existing) sqlite.prepare("INSERT INTO story_arcs (id,novel_id,volume_id,title,goal,conflict,payoff,hooks,summary,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?, '',1,?,?)")
            .run(arcId, input.novelId, volumeId, arc.title, arc.goal, arc.conflict, arc.payoff, arc.hooks, t, t);
          arcIds.set(`${volume.number}:${arc.title}`, arcId);
        }
      }
    }
    if (sections.has("chapters")) for (const chapter of proposal.chapters) {
      if (sqlite.prepare("SELECT id FROM chapters WHERE novel_id=? AND number=?").get(input.novelId, chapter.number)) continue;
      const chapterLength = resolveChapterLengthRule({ 预期字数: chapter.outline.expectedWords }, novel.genre);
      const outline = { 目标: chapter.outline.goal, 主视角: chapter.outline.viewpoint, 冲突: chapter.outline.conflict, 信息揭示: chapter.outline.reveal, 情绪点: chapter.outline.emotion, 伏笔动作: chapter.outline.foreshadow, 字数下限: chapterLength.min, 预期字数: chapterLength.target, 字数上限: chapterLength.max, 字数限制: "提示", 结尾钩子: chapter.outline.hook, 见证者: chapter.outline.witness, 即时奖励: chapter.outline.reward, 能力来源: chapter.outline.abilitySource, 状态变化: chapter.outline.stateChange };
      sqlite.prepare("INSERT INTO chapters (id,novel_id,volume_id,arc_id,number,title,status,outline,draft,current_version_id,summary,word_count,version,created_at,updated_at) VALUES (?,?,?,?,?,?,'章纲已确认',?,'',NULL,'',0,1,?,?)")
        .run(id(), input.novelId, volumeIds.get(chapter.volumeNumber) || null, arcIds.get(`${chapter.volumeNumber}:${chapter.arcTitle}`) || null, chapter.number, chapter.title, JSON.stringify(outline), t, t);
    }
    if (sections.has("foreshadows")) for (const hook of proposal.structure.foreshadows) {
      if (!sqlite.prepare("SELECT id FROM foreshadows WHERE novel_id=? AND title=?").get(input.novelId, hook.title)) sqlite.prepare("INSERT INTO foreshadows VALUES (?, ?, ?, ?, NULL, ?, NULL, '未回收', ?, ?, ?)")
        .run(id(), input.novelId, hook.title, hook.description, hook.targetChapter, hook.importance, t, t);
    }
    sqlite.prepare("UPDATE generation_runs SET status='已完成',updated_at=? WHERE id=?").run(t, input.runId);
    return {
      canon: Number((sqlite.prepare("SELECT COUNT(*) count FROM canon_entities WHERE novel_id=?").get(input.novelId) as { count: number }).count),
      volumes: Number((sqlite.prepare("SELECT COUNT(*) count FROM volumes WHERE novel_id=?").get(input.novelId) as { count: number }).count),
      chapters: Number((sqlite.prepare("SELECT COUNT(*) count FROM chapters WHERE novel_id=?").get(input.novelId) as { count: number }).count),
    };
  })();
  return { kind: "ok" as const, result };
}

export function validateDeepPlanningCandidate(value: unknown) { return deepProposalSchema.safeParse(value); }

function finishError(runId: string, message: string) { sqlite.prepare("UPDATE generation_runs SET status='失败',error=?,updated_at=? WHERE id=?").run(message, now(), runId); publish(runId, "error", { message }); }
export function onRunEvent(runId: string, listener: (event: RunEvent) => void) { const value = emitter(runId); value.on("message", listener); return () => value.off("message", listener); }
export function cancelRun(runId: string) { const active = controllers.has(runId); controllers.get(runId)?.abort(); return { cancelled: active }; }

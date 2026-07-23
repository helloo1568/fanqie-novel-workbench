const base = process.env.WORKBENCH_URL || "http://127.0.0.1:3210/api";

async function request(path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: options.body ? { "Content-Type": "application/json", ...options.headers } : options.headers,
  });
  if (!response.ok) throw new Error(`${options.method || "GET"} ${path}: ${response.status} ${await response.text()}`);
  return response.status === 204 ? null : response.json();
}

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const ensure = (condition, message) => { if (!condition) throw new Error(message); };

const providers = await request("/providers");
let tempNovel;
let importedNovel;
let result;

try {
  for (const provider of providers.filter((item) => item.enabled)) {
    await request(`/providers/${provider.id}`, { method: "PATCH", body: JSON.stringify({ enabled: false }) });
  }

  tempNovel = await request("/novels", { method: "POST", body: JSON.stringify({ title: "完整闭环临时验收", genre: "都市脑洞", targetWords: 10000 }) });
  let workspace = await request(`/novels/${tempNovel.id}/workspace`);
  const defaultVolume = workspace.volumes[0];

  const disposableVolume = await request(`/novels/${tempNovel.id}/volumes`, { method: "POST", body: JSON.stringify({ title: "临时第二卷", goal: "验收" }) });
  await request(`/volumes/${disposableVolume.id}`, { method: "DELETE" });
  const disposableArc = await request(`/novels/${tempNovel.id}/arcs`, { method: "POST", body: JSON.stringify({ volumeId: defaultVolume.id, title: "临时情节弧" }) });
  await request(`/arcs/${disposableArc.id}`, { method: "DELETE" });

  let chapter = await request(`/novels/${tempNovel.id}/chapters`, { method: "POST", body: JSON.stringify({ title: "第一章 外卖箱里的倒计时", volumeId: defaultVolume.id }) });
  await request(`/chapters/${chapter.id}/working-draft`, { method: "PATCH", body: JSON.stringify({ title: chapter.title, content: "未提交工作稿", outline: {}, baseVersion: chapter.version }) });
  ensure((await request(`/chapters/${chapter.id}/working-draft`)).content === "未提交工作稿", "工作稿未保存");
  await request(`/chapters/${chapter.id}/working-draft`, { method: "DELETE" });

  const outline = {
    "目标": "程野发现异常订单并救下顾客", "主视角": "程野", "冲突": "倒计时结束前必须找出异能失控源",
    "信息揭示": "订单回执会记录异能代价", "爽点类型": "扮猪吃虎后的精准反制", "见证者": "被困顾客与保安",
    "即时奖励": "获得第一条可验证订单线索", "能力来源": "本章异常订单明确触发的既有签收机制", "状态变化": "程野从怀疑转为确认能力存在",
    "时间推进": "当天深夜推进二十分钟", "情绪点": "顾客绝望时被程野救下", "伏笔动作": "回执背面出现父亲名字",
    "预期字数": 300, "结尾钩子": "下一张订单的收件人竟是程野本人",
  };
  chapter = await request(`/chapters/${chapter.id}`, { method: "PATCH", body: JSON.stringify({ version: chapter.version, title: chapter.title, status: "章纲已确认", outline, draft: "", summary: "" }) });
  const preflight = await request(`/chapters/${chapter.id}/preflight`);
  ensure(!preflight.some((issue) => issue.level === "block"), `预检存在阻塞：${preflight.map((item) => item.title).join("、")}`);

  await request("/prompts", { method: "POST", body: JSON.stringify({ scope: "novel", novelId: tempNovel.id, taskType: "正文", name: "临时验收规则", content: "验收标记：每章必须有可见兑现。" }) });
  const preview = await request(`/chapters/${chapter.id}/prompt-preview`, { method: "POST", body: JSON.stringify({ taskType: "正文" }) });
  ensure(preview.prompt.includes("验收标记"), "小说级提示词未进入预览");

  const run = await request("/generations", { method: "POST", body: JSON.stringify({ novelId: tempNovel.id, chapterId: chapter.id, taskType: "正文", instruction: "生成一段简短验收稿" }) });
  const deadline = Date.now() + 30_000;
  let currentRun;
  do {
    await wait(250);
    currentRun = (await request(`/novels/${tempNovel.id}/generations`)).find((item) => item.id === run.runId);
  } while (currentRun && !["待审核", "失败", "已停止"].includes(currentRun.status) && Date.now() < deadline);
  ensure(currentRun?.status === "待审核", `生成未进入待审核：${currentRun?.status || "超时"} ${currentRun?.error || ""}`);

  const candidate = (await request(`/chapters/${chapter.id}/versions`)).find((item) => item.source === "ai-candidate");
  ensure(candidate?.content, "未保存AI候选稿");
  const accepted = await request(`/chapters/${chapter.id}/candidates/${candidate.id}/accept`, { method: "POST", body: "{}" });
  const quality = await request(`/chapters/${chapter.id}/quality`, { method: "POST", body: JSON.stringify({ content: candidate.content }) });
  const publication = await request(`/chapters/${chapter.id}/publication`, { method: "POST", body: JSON.stringify({ status: "已发布", platformChapterId: "DEMO-001", note: "闭环验收后删除" }) });
  workspace = await request(`/novels/${tempNovel.id}/workspace`);

  importedNovel = await request("/imports", { method: "POST", body: JSON.stringify({ format: "txt", filename: "接口导入.txt", content: "第一章 开始\n临时正文。\n第二章 继续\n临时正文二。" }) });
  const snapshots = await request("/snapshots");
  const snapshot = await request(`/snapshots/${snapshots[0].id}/preview`);

  result = {
    preflightBlocks: 0, runStatus: currentRun.status, candidateSaved: Boolean(candidate.content),
    acceptedDraft: Boolean(accepted.chapter.draft), memoryProposals: workspace.proposals.length,
    qualityDimensions: quality.issues.length, publication: publication.status,
    importedChapters: importedNovel.chapters, snapshotIntegrity: snapshot.integrity,
    providerSecretsExposed: providers.some((item) => item.encryptedKey || item.apiKey),
  };
} finally {
  if (importedNovel) await request(`/novels/${importedNovel.novelId}`, { method: "DELETE" }).catch(() => undefined);
  if (tempNovel) await request(`/novels/${tempNovel.id}`, { method: "DELETE" }).catch(() => undefined);
  for (const provider of providers) {
    await request(`/providers/${provider.id}`, { method: "PATCH", body: JSON.stringify({ enabled: Boolean(provider.enabled) }) }).catch(() => undefined);
  }
}

const restoredProviders = await request("/providers");
ensure(restoredProviders.every((item) => Boolean(item.enabled) === Boolean(providers.find((original) => original.id === item.id)?.enabled)), "供应商启用状态未恢复");
console.log(JSON.stringify(result, null, 2));

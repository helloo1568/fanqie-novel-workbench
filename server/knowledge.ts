import fs from "node:fs";
import path from "node:path";

export type KnowledgeTask = "策划" | "章纲" | "正文" | "摘要" | "事实抽取" | "质检";

type KnowledgeSkill = {
  slug: string;
  title: string;
  description: string;
  related: Array<[string, string]>;
  interpretation: string;
  execution: string;
  boundary: string;
};

const packRoot = path.resolve(process.cwd(), ".codex", "skills");

function section(markdown: string, start: string, end: string) {
  const from = markdown.indexOf(start);
  if (from < 0) return "";
  const bodyStart = from + start.length;
  const to = markdown.indexOf(end, bodyStart);
  return markdown.slice(bodyStart, to < 0 ? markdown.length : to).trim();
}

function compact(markdown: string, limit: number) {
  return markdown
    .replace(/^#+\s+/gm, "")
    .replace(/^\s*[-*]\s+/gm, "- ")
    .replace(/\n{3,}/g, "\n\n")
    .slice(0, limit)
    .trim();
}

type Frontmatter = {
  name?: string;
  description?: string;
  related_skills?: Array<{ slug: string; relation: string }>;
};

function parseFrontmatter(markdown: string): { frontmatter: Frontmatter; body: string } {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: markdown };
  const frontmatterText = match[1];
  const body = match[2];
  const frontmatter: Frontmatter = {};
  let currentKey: keyof Frontmatter | null = null;
  let descriptionBuffer: string[] = [];
  let inDescription = false;
  for (const line of frontmatterText.split(/\r?\n/)) {
    if (inDescription) {
      if (/^\s/.test(line) && !/^\s*-\s/.test(line)) {
        descriptionBuffer.push(line.replace(/^\s+/, ""));
        continue;
      }
      frontmatter.description = descriptionBuffer.join(" ").trim();
      descriptionBuffer = [];
      inDescription = false;
    }
    if (/^related_skills:\s*$/.test(line)) {
      currentKey = "related_skills";
      frontmatter.related_skills = [];
      continue;
    }
    if (currentKey === "related_skills" && /^\s*-\s/.test(line)) {
      const item = line.replace(/^\s*-\s*/, "");
      const slugMatch = item.match(/slug:\s*(\S+)/);
      const relationMatch = item.match(/relation:\s*(\S+)/);
      if (slugMatch && relationMatch) {
        frontmatter.related_skills!.push({ slug: slugMatch[1], relation: relationMatch[1] });
      }
      continue;
    }
    if (/^[\w-]+:/.test(line)) {
      const colonIdx = line.indexOf(":");
      const key = line.slice(0, colonIdx).trim() as keyof Frontmatter;
      const value = line.slice(colonIdx + 1).trim();
      if (key === "name") frontmatter.name = value;
      else if (key === "description") {
        if (value === "|") inDescription = true;
        else if (value) frontmatter.description = value;
      }
      currentKey = key;
    } else {
      currentKey = null;
    }
  }
  if (inDescription && descriptionBuffer.length) {
    frontmatter.description = descriptionBuffer.join(" ").trim();
  }
  return { frontmatter, body };
}

function loadSkills(): KnowledgeSkill[] {
  if (!fs.existsSync(packRoot)) return [];
  const entries = fs.readdirSync(packRoot, { withFileTypes: true });
  return entries.flatMap((entry) => {
    if (!entry.isDirectory()) return [];
    const skillPath = path.join(packRoot, entry.name, "SKILL.md");
    if (!fs.existsSync(skillPath)) return [];
    const markdown = fs.readFileSync(skillPath, "utf8");
    const { frontmatter, body } = parseFrontmatter(markdown);
    const slug = frontmatter.name || entry.name;
    const titleMatch = body.match(/^#\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1].trim() : slug;
    const description = frontmatter.description || "";
    const related: Array<[string, string]> = (frontmatter.related_skills || []).map((item) => [item.slug, item.relation]);
    return [{
      slug,
      title,
      description,
      related,
      interpretation: compact(section(markdown, "## I — 方法论骨架（Interpretation）", "## A1 —"), 520),
      execution: compact(section(markdown, "## E — 可执行步骤（Execution）", "## B —"), 620),
      boundary: compact(section(markdown, "## B — 边界（Boundary）", "## 相关 skills"), 420),
    }];
  });
}

const skills = loadSkills();
const bySlug = new Map(skills.map((item) => [item.slug, item]));

const taskWeights: Record<KnowledgeTask, Record<string, number>> = {
  策划: {
    "fanqie-topic-promise": 100,
    "fanqie-story-engine-contract": 95,
    "fanqie-genre-length-calibration": 90,
    "fanqie-bounded-power-world": 65,
    "fanqie-character-conflict-network": 55,
  },
  章纲: {
    "fanqie-longform-rolling-outline": 100,
    "fanqie-chapter-state-diff": 90,
    "fanqie-character-conflict-network": 82,
    "fanqie-information-hook-ledger": 78,
    "fanqie-expectation-payoff": 75,
  },
  正文: {
    "fanqie-chapter-state-diff": 90,
    "fanqie-expectation-payoff": 88,
    "fanqie-pace-triad": 86,
    "fanqie-character-conflict-network": 75,
    "fanqie-bounded-power-world": 72,
    "fanqie-information-hook-ledger": 68,
  },
  摘要: {
    "fanqie-longform-rolling-outline": 95,
    "fanqie-chapter-state-diff": 90,
    "fanqie-information-hook-ledger": 80,
    "fanqie-expectation-payoff": 65,
  },
  事实抽取: {
    "fanqie-bounded-power-world": 95,
    "fanqie-information-hook-ledger": 92,
    "fanqie-longform-rolling-outline": 82,
    "fanqie-character-conflict-network": 78,
    "fanqie-chapter-state-diff": 70,
  },
  质检: {
    "fanqie-chapter-state-diff": 100,
    "fanqie-pace-triad": 98,
    "fanqie-expectation-payoff": 94,
    "fanqie-character-conflict-network": 88,
    "fanqie-revision-evidence-loop": 84,
    "fanqie-genre-length-calibration": 80,
  },
};

const keywordRoutes: Array<[RegExp, string[]]> = [
  [/开书|题材|卖点|书名|简介|定位|promise|topic/iu, ["fanqie-topic-promise", "fanqie-story-engine-contract"]],
  [/主线|发动机|核心矛盾|story engine|logline/iu, ["fanqie-story-engine-contract"]],
  [/长篇|分卷|章纲|大纲|时间线|rolling outline/iu, ["fanqie-longform-rolling-outline"]],
  [/人物|反派|配角|动机|关系|冲突网|character/iu, ["fanqie-character-conflict-network"]],
  [/钩子|伏笔|悬念|信息差|hook|foreshadow/iu, ["fanqie-information-hook-ledger"]],
  [/黄金三章|前三章|开篇|golden three/iu, ["fanqie-golden-three"]],
  [/爽点|兑现|奖励|结算|payoff/iu, ["fanqie-expectation-payoff"]],
  [/水文|推进|状态变化|state diff/iu, ["fanqie-chapter-state-diff"]],
  [/节奏|拖沓|太快|信息密度|pacing/iu, ["fanqie-pace-triad"]],
  [/改文|重写|读完率|追读|数据|revision/iu, ["fanqie-revision-evidence-loop"]],
  [/品类|篇幅|男频|女频|年代|四合院|genre|length/iu, ["fanqie-genre-length-calibration"]],
  [/能力|金手指|系统|异能|世界规则|power|world rule/iu, ["fanqie-bounded-power-world"]],
];

export function retrieveKnowledge(input: {
  taskType: string;
  genre?: string;
  chapterNumber?: number;
  instruction?: string;
  maxSkills?: number;
}) {
  const normalized = (["策划", "章纲", "正文", "摘要", "事实抽取", "质检"].includes(input.taskType)
    ? input.taskType
    : "正文") as KnowledgeTask;
  const scores = new Map<string, number>(Object.entries(taskWeights[normalized]));
  const query = `${input.genre || ""} ${input.instruction || ""}`;
  for (const [pattern, slugs] of keywordRoutes) {
    if (!pattern.test(query)) continue;
    slugs.forEach((slug) => scores.set(slug, (scores.get(slug) || 0) + 45));
  }
  if (Number(input.chapterNumber) > 0 && Number(input.chapterNumber) <= 3) {
    scores.set("fanqie-golden-three", (scores.get("fanqie-golden-three") || 0) + 120);
  }
  if (/四合院|年代|历史/u.test(input.genre || "")) {
    scores.set("fanqie-genre-length-calibration", (scores.get("fanqie-genre-length-calibration") || 0) + 55);
    scores.set("fanqie-bounded-power-world", (scores.get("fanqie-bounded-power-world") || 0) + 30);
  }
  return [...scores.entries()]
    .filter(([slug]) => bySlug.has(slug))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, input.maxSkills || 5)
    .map(([slug, score]) => ({ ...bySlug.get(slug)!, score }));
}

export function knowledgePrompt(input: Parameters<typeof retrieveKnowledge>[0]) {
  const selected = retrieveKnowledge(input);
  if (!selected.length) return "番茄写作知识包未加载，使用系统基础规则。";
  return `番茄长篇写作知识包（仅作方法约束，不保证流量）：\n${selected
    .map((item) => `【${item.title}｜${item.slug}】\n方法：${item.interpretation}\n执行：${item.execution}\n边界：${item.boundary}`)
    .join("\n\n")}`;
}

export function knowledgePackInfo(input?: Parameters<typeof retrieveKnowledge>[0]) {
  const selected = input ? retrieveKnowledge(input) : [];
  return {
    available: skills.length > 0,
    version: "1.0.0",
    skills: skills.map(({ slug, title, description }) => ({ slug, title, description })),
    selected: selected.map(({ slug, title, score }) => ({ slug, title, score })),
  };
}

export type FanqieGenreGroup = "男频主赛道" | "女频主赛道" | "衍生与复合";

export interface FanqieGenreProfile {
  key: string;
  group: FanqieGenreGroup;
  targetReaders: string;
  corePromise: string;
  focus: string;
  targetWords: number;
  chapterWords: { min: number; target: number; max: number };
}

export interface ChapterLengthRule {
  min: number;
  target: number;
  max: number;
  mode: "提示" | "严格";
}

export const FANQIE_PROFILE_UPDATED_AT = "2026-07-19";

export const FANQIE_GENRE_PROFILES: FanqieGenreProfile[] = [
  { key: "都市脑洞", group: "男频主赛道", targetReaders: "喜欢强设定、现实代入和快速兑现的读者", corePromise: "一句话能理解的异常设定持续制造新问题", focus: "规则展示、现实收益、身份反差", targetWords: 1000000, chapterWords: { min: 2200, target: 2600, max: 3000 } },
  { key: "都市日常", group: "男频主赛道", targetReaders: "喜欢职业、生活成长与人物关系积累的读者", corePromise: "从具体生活与职业选择中持续获得成长和回报", focus: "职业细节、关系生长、生活反馈", targetWords: 900000, chapterWords: { min: 2200, target: 2600, max: 3200 } },
  { key: "都市种田", group: "男频主赛道", targetReaders: "喜欢经营建设、资源积累和生活改善的读者", corePromise: "经营成果可量化，生活状态持续改善", focus: "经营过程、资源变化、阶段成果", targetWords: 1000000, chapterWords: { min: 2300, target: 2700, max: 3200 } },
  { key: "传统玄幻", group: "男频主赛道", targetReaders: "喜欢东方世界、成长体系和大阶段突破的读者", corePromise: "成长边界清晰，每次突破扩大问题而非消灭冲突", focus: "体系边界、资源争夺、阶段跃迁", targetWords: 1200000, chapterWords: { min: 2300, target: 2800, max: 3400 } },
  { key: "东方仙侠", group: "男频主赛道", targetReaders: "喜欢修行探索、因果选择和长线世界展开的读者", corePromise: "修行所得伴随代价，世界层级逐步展开", focus: "修行过程、因果代价、世界探索", targetWords: 1200000, chapterWords: { min: 2300, target: 2800, max: 3400 } },
  { key: "历史古代", group: "男频主赛道", targetReaders: "喜欢时代博弈、制度约束与现实成果的读者", corePromise: "人物在真实制度和资源条件下改变处境", focus: "制度逻辑、势力博弈、阶段成果", targetWords: 1100000, chapterWords: { min: 2500, target: 3000, max: 3600 } },
  { key: "抗战谍战", group: "男频主赛道", targetReaders: "喜欢高压任务、身份博弈和历史氛围的读者", corePromise: "行动目标明确，情报得失会永久改变局势", focus: "任务压力、身份风险、事实考据", targetWords: 900000, chapterWords: { min: 2400, target: 2800, max: 3300 } },
  { key: "悬疑灵异", group: "男频主赛道", targetReaders: "喜欢异常谜题、规则推演和连续答案的读者", corePromise: "线索公平，谜题按生命周期回答而非只挖坑", focus: "线索密度、规则验证、答案接棒", targetWords: 800000, chapterWords: { min: 2000, target: 2400, max: 2900 } },
  { key: "科幻末世", group: "男频主赛道", targetReaders: "喜欢生存压力、科技设定和势力演化的读者", corePromise: "资源、技术与社会秩序共同推进生存升级", focus: "资源约束、技术边界、群体选择", targetWords: 1000000, chapterWords: { min: 2300, target: 2700, max: 3300 } },
  { key: "游戏体育", group: "男频主赛道", targetReaders: "喜欢竞技过程、战术变化和成绩兑现的读者", corePromise: "胜负来自可读过程，成绩会改变资源与关系", focus: "过程可信、战术变化、赛后结算", targetWords: 900000, chapterWords: { min: 2100, target: 2500, max: 3000 } },
  { key: "现言甜宠", group: "女频主赛道", targetReaders: "喜欢高互动密度、关系推进和情绪回馈的读者", corePromise: "关系每个阶段都有新选择和可感知进展", focus: "互动细节、关系边界、情绪兑现", targetWords: 700000, chapterWords: { min: 1800, target: 2200, max: 2700 } },
  { key: "豪门总裁", group: "女频主赛道", targetReaders: "喜欢强关系拉扯、身份资源与情感博弈的读者", corePromise: "身份差与资源差制造选择，不替代人物动机", focus: "关系博弈、资源变化、边界建立", targetWords: 800000, chapterWords: { min: 1900, target: 2300, max: 2800 } },
  { key: "青春甜宠", group: "女频主赛道", targetReaders: "喜欢青春氛围、共同成长与克制心动的读者", corePromise: "关系变化来自共同经历和成长，而非强行误会", focus: "成长过程、群像关系、青春质感", targetWords: 600000, chapterWords: { min: 1800, target: 2200, max: 2700 } },
  { key: "古言脑洞", group: "女频主赛道", targetReaders: "喜欢古代处境、新设定和女主主动破局的读者", corePromise: "脑洞改变处境但不跳过身份与制度阻力", focus: "身份处境、主动选择、规则兑现", targetWords: 900000, chapterWords: { min: 2100, target: 2500, max: 3100 } },
  { key: "宫斗宅斗", group: "女频主赛道", targetReaders: "喜欢关系网络、利益交换和长期博弈的读者", corePromise: "每个角色按自身利益行动，胜负留下永久后果", focus: "动机网络、证据资源、关系变化", targetWords: 900000, chapterWords: { min: 2200, target: 2600, max: 3200 } },
  { key: "种田经商", group: "女频主赛道", targetReaders: "喜欢经营成长、家庭关系和生活改善的读者", corePromise: "劳动与经营过程可见，成果进入生活和关系", focus: "经营细节、家庭协作、阶段结算", targetWords: 900000, chapterWords: { min: 2200, target: 2600, max: 3200 } },
  { key: "年代情感", group: "女频主赛道", targetReaders: "喜欢时代生活、家庭选择和关系成长的读者", corePromise: "年代条件真正改变选择，情感与生活共同推进", focus: "时代考据、烟火生活、关系积累", targetWords: 900000, chapterWords: { min: 2300, target: 2700, max: 3300 } },
  { key: "玄幻言情", group: "女频主赛道", targetReaders: "喜欢幻想世界、双向成长和关系命题的读者", corePromise: "世界冲突与关系选择彼此推动，不互相抢戏", focus: "双线成长、关系选择、世界规则", targetWords: 1000000, chapterWords: { min: 2100, target: 2500, max: 3100 } },
  { key: "悬疑恋爱", group: "女频主赛道", targetReaders: "喜欢共同解谜、危险信任和关系反转的读者", corePromise: "谜题答案推进关系，关系选择改变调查风险", focus: "公平线索、信任变化、危险升级", targetWords: 700000, chapterWords: { min: 1900, target: 2300, max: 2800 } },
  { key: "男频衍生", group: "衍生与复合", targetReaders: "熟悉原作并期待原创成长线的男频读者", corePromise: "借用世界与人物关系，主线事件和长期成长保持原创", focus: "原作逻辑、原创主线、版权边界", targetWords: 900000, chapterWords: { min: 2200, target: 2600, max: 3200 } },
  { key: "女频衍生", group: "衍生与复合", targetReaders: "熟悉原作并期待新关系可能的女频读者", corePromise: "角色不脱离原有动机，新关系由原创事件推动", focus: "人物一致性、原创事件、关系变化", targetWords: 800000, chapterWords: { min: 1900, target: 2300, max: 2900 } },
  { key: "四合院同人", group: "衍生与复合", targetReaders: "喜欢年代生活、职业成长与原作人物另一种可能的读者", corePromise: "原创职业和家庭事件为主线，成果落到待遇、物资、住房和关系", focus: "年代考据、职业过程、利益逻辑", targetWords: 900000, chapterWords: { min: 2400, target: 2800, max: 3300 } },
  { key: "规则怪谈", group: "衍生与复合", targetReaders: "喜欢规则验证、认知反转和高压生存的读者", corePromise: "规则可验证也有边界，答案持续改变生存策略", focus: "规则证据、认知差、状态变化", targetWords: 800000, chapterWords: { min: 1900, target: 2300, max: 2800 } },
];

const FALLBACK_PROFILE: FanqieGenreProfile = {
  key: "自定义题材",
  group: "衍生与复合",
  targetReaders: "目标读者待明确",
  corePromise: "明确主要阅读体验，并让每章产生可见变化",
  focus: "题材承诺、人物选择、状态变化",
  targetWords: 900000,
  chapterWords: { min: 2000, target: 2500, max: 3000 },
};

const LEGACY_ALIASES: Record<string, string> = {
  "男频升级": "都市脑洞",
  "玄幻仙侠": "传统玄幻",
  "悬疑": "悬疑灵异",
  "女频情感": "现言甜宠",
  "通用": "自定义题材",
};

export function getFanqieGenreProfile(genre: string) {
  const normalized = LEGACY_ALIASES[genre] || genre;
  return FANQIE_GENRE_PROFILES.find((profile) => profile.key === normalized) || FALLBACK_PROFILE;
}

function boundedNumber(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : fallback;
}

export function resolveChapterLengthRule(outline: Record<string, string | number>, genre: string): ChapterLengthRule {
  const profile = getFanqieGenreProfile(genre);
  const target = boundedNumber(outline["预期字数"], profile.chapterWords.target);
  const suggestedMin = Math.max(500, Math.round(target * 0.85 / 100) * 100);
  const suggestedMax = Math.max(suggestedMin, Math.round(target * 1.15 / 100) * 100);
  const min = boundedNumber(outline["字数下限"], suggestedMin);
  const max = boundedNumber(outline["字数上限"], suggestedMax);
  return {
    min,
    target,
    max,
    mode: outline["字数限制"] === "严格" ? "严格" : "提示",
  };
}

export function countChapterWords(content: string) {
  return content.match(/[\u4e00-\u9fff]|[a-zA-Z0-9]+/g)?.length ?? 0;
}

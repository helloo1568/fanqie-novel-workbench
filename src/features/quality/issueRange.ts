export interface IssueRange {
  start: number;
  end: number;
}

function normalizeEvidence(value: string) {
  return value.replace(/[\s\u200b]+/g, "").replace(/[“”‘’'\"、，。！？：；（）()【】[\]…—-]/g, "");
}

function findNormalizedRange(content: string, evidence: string): IssueRange | null {
  const target = normalizeEvidence(evidence);
  if (target.length < 8) return null;
  let normalized = "";
  const sourceIndexes: number[] = [];
  for (let index = 0; index < content.length; index += 1) {
    const normalizedChar = normalizeEvidence(content[index]);
    if (!normalizedChar) continue;
    normalized += normalizedChar;
    sourceIndexes.push(index);
  }
  const startIndex = normalized.indexOf(target);
  if (startIndex < 0) return null;
  const endIndex = startIndex + target.length - 1;
  return { start: sourceIndexes[startIndex], end: Math.min(content.length, sourceIndexes[endIndex] + 1) };
}

export function resolveIssueRange(content: string, evidence?: string, position?: string): IssueRange | null {
  const exactEvidence = evidence?.trim();
  if (exactEvidence) {
    const start = content.indexOf(exactEvidence);
    if (start >= 0) return { start, end: start + exactEvidence.length };
    const normalizedRange = findNormalizedRange(content, exactEvidence);
    if (normalizedRange) return normalizedRange;
  }

  if (!position) return null;
  const explicitOffset = position.match(/(?:char(?:acter)?s?|offset|字符(?:偏移)?)[^\d]*(\d+)\D+(\d+)/i);
  if (explicitOffset) {
    const start = Math.min(content.length, Number(explicitOffset[1]));
    const end = Math.min(content.length, Number(explicitOffset[2]));
    return end >= start ? { start, end } : null;
  }
  const windowSize = Math.min(content.length, 240);
  if (/开头/.test(position)) return { start: 0, end: windowSize };
  if (/中段/.test(position)) {
    const start = Math.max(0, Math.floor(content.length / 2) - Math.floor(windowSize / 2));
    return { start, end: Math.min(content.length, start + windowSize) };
  }
  if (/结尾/.test(position)) return { start: Math.max(0, content.length - windowSize), end: content.length };
  if (/全章/.test(position)) return { start: 0, end: windowSize };
  return null;
}

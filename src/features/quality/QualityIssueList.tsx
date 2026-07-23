import type { PreflightIssue, QualityIssue } from "@shared/types";

export type DisplayQualityIssue =
  | { id: string; kind: "hard-conflict" | "warning" | "info"; source: "preflight"; issue: PreflightIssue }
  | { id: string; kind: "style"; source: "semantic"; issue: QualityIssue };

const issueLabels: Record<DisplayQualityIssue["kind"], string> = {
  "hard-conflict": "硬冲突",
  warning: "警告",
  info: "信息",
  style: "风格",
};

const badgeClasses: Record<DisplayQualityIssue["kind"], string> = {
  "hard-conflict": "red",
  warning: "gold",
  info: "",
  style: "green",
};

function issueBadge(item: DisplayQualityIssue) {
  if (item.source === "preflight") return { label: issueLabels[item.kind], className: badgeClasses[item.kind] };
  const score = Number(item.issue.score || 0);
  if (score < 60) return { label: `${score} · 需修改`, className: "red" };
  if (score < 80) return { label: `${score} · 可优化`, className: "gold" };
  return { label: `${score} · 通过`, className: "green" };
}

function issueTitle(item: DisplayQualityIssue) {
  return item.source === "preflight" ? item.issue.title : item.issue.dimension;
}

function issueEvidence(item: DisplayQualityIssue) {
  return item.issue.evidence;
}

export interface QualityIssueListProps {
  issues: DisplayQualityIssue[];
  onSelectIssue?: (issue: DisplayQualityIssue) => void;
}

export function QualityIssueList({ issues, onSelectIssue }: QualityIssueListProps) {
  if (!issues.length) return null;
  return <div className="quality-issue-list">
    {issues.map((item) => {
      const title = issueTitle(item);
      const evidence = issueEvidence(item);
      const canFocus = Boolean(evidence || (item.source === "semantic" && item.issue.position));
      const badge = issueBadge(item);
      return <article className={`issue quality-issue quality-issue-${item.kind}`} key={item.id}>
        <div className="issue-head">
          {canFocus && onSelectIssue
            ? <button className="quality-issue-focus" type="button" onClick={() => onSelectIssue(item)} aria-label={`${title}，定位正文`}>{title}</button>
            : <span>{title}</span>}
          <span className={`badge ${badge.className}`.trim()}>{badge.label}</span>
        </div>
        {item.source === "preflight"
          ? <p>{item.issue.detail}</p>
          : <><p>{item.issue.evidence}</p><p className="chapter-quality-suggestion">{item.issue.suggestion}</p></>}
      </article>;
    })}
  </div>;
}

export default QualityIssueList;

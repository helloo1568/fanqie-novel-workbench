import { describe, expect, it } from "vitest";
import type { QualityIssue } from "@shared/types";
import { summarizeQuality } from "./QualityPanel";

const issue = (score: number): QualityIssue => ({
  dimension: `维度-${score}`,
  score,
  evidence: "正文证据",
  suggestion: "修改建议",
});

describe("quality result summary", () => {
  it("separates required fixes, optimizations and passed dimensions", () => {
    expect(summarizeQuality([issue(59), issue(60), issue(79), issue(80), issue(95)])).toEqual({
      needsWork: 1,
      optimize: 2,
      passed: 2,
    });
  });
});

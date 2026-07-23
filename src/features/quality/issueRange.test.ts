import { describe, expect, it } from "vitest";
import { resolveIssueRange } from "./issueRange";

describe("resolveIssueRange", () => {
  it("does not interpret arbitrary numbered positions as character offsets", () => {
    expect(resolveIssueRange("abcdef", undefined, "第1段到第2段")).toBeNull();
  });

  it("accepts explicitly labelled character offsets", () => {
    expect(resolveIssueRange("abcdef", undefined, "char: 1-4")).toEqual({ start: 1, end: 4 });
    expect(resolveIssueRange("abcdef", undefined, "offset 2..5")).toEqual({ start: 2, end: 5 });
  });

  it("prefers exact evidence text when it is present", () => {
    expect(resolveIssueRange("prefix evidence suffix", "evidence", "第1段到第2段")).toEqual({ start: 7, end: 15 });
  });

  it("ignores punctuation differences when locating semantic evidence", () => {
    expect(resolveIssueRange("他说：“她是我妹妹。”然后转身。", "他说‘她是我妹妹’然后转身")).toEqual({ start: 0, end: 15 });
  });

  it("falls back to the reported prose section", () => {
    expect(resolveIssueRange("a".repeat(500), undefined, "中段")).toEqual({ start: 130, end: 370 });
  });
});

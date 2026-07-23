import { describe, expect, it } from "vitest";
import { FANQIE_GENRE_PROFILES, countChapterWords, getFanqieGenreProfile, resolveChapterLengthRule } from "./fanqieProfiles.js";

describe("fanqie genre profiles", () => {
  it("defines valid chapter ranges for every built-in genre", () => {
    expect(FANQIE_GENRE_PROFILES.length).toBeGreaterThanOrEqual(20);
    for (const profile of FANQIE_GENRE_PROFILES) {
      expect(profile.chapterWords.min).toBeLessThanOrEqual(profile.chapterWords.target);
      expect(profile.chapterWords.target).toBeLessThanOrEqual(profile.chapterWords.max);
      expect(profile.targetWords).toBeGreaterThan(0);
    }
  });

  it("keeps legacy genres compatible with the new profiles", () => {
    expect(getFanqieGenreProfile("男频升级").key).toBe("都市脑洞");
    expect(getFanqieGenreProfile("女频情感").key).toBe("现言甜宠");
  });

  it("derives a soft range from a per-chapter target", () => {
    expect(resolveChapterLengthRule({ 预期字数: 2600 }, "都市脑洞")).toEqual({ min: 2200, target: 2600, max: 3000, mode: "提示" });
  });

  it("honors explicit strict chapter limits", () => {
    expect(resolveChapterLengthRule({ 字数下限: 2400, 预期字数: 2600, 字数上限: 2800, 字数限制: "严格" }, "都市脑洞"))
      .toEqual({ min: 2400, target: 2600, max: 2800, mode: "严格" });
    expect(countChapterWords("程野接单。Order 37。" )).toBe(6);
  });
});

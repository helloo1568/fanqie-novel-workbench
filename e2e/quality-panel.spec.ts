import { expect, test } from "@playwright/test";

const novelId = "a623886a-5338-45f7-a1ad-4bdd6658d958";

test("quality panel labels typed issues, preserves results on retry failure, focuses evidence, and gates candidates", async ({ page, request }) => {
  const workspace = await (await request.get(`/api/novels/${novelId}/workspace`)).json() as {
    chapters: Array<{ id: string; draft: string; status: string; currentVersionId: string | null }>;
  };
  const chapter = workspace.chapters.find((item) => item.status !== "待策划" && item.draft.trim())
    ?? workspace.chapters.find((item) => item.draft.trim())
    ?? workspace.chapters[0];
  const evidence = "正文证据";
  let qualityRuns = 0;
  await request.delete(`/api/chapters/${chapter.id}/working-draft`);

  await page.route(`**/api/novels/${novelId}/workspace`, async (route) => {
    const response = await route.fetch();
    const body = await response.json() as typeof workspace;
    body.chapters = body.chapters.map((item) => item.id === chapter.id ? { ...item, draft: `${evidence}，后续内容。` } : item);
    await route.fulfill({ response, json: body });
  });

  await page.route(`**/api/chapters/${chapter.id}/preflight`, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify([
      { level: "block", title: "设定冲突", detail: "人物身份与锁定设定冲突", evidence },
      { level: "warning", title: "时间提醒", detail: "场景时间需要确认" },
    ]),
  }));
  await page.route(`**/api/chapters/${chapter.id}/quality`, (route) => {
    qualityRuns += 1;
    if (qualityRuns > 1) return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "模型暂时不可用" }) });
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        total: 82,
        note: "整体可读",
        issues: [{ dimension: "句式节奏", score: 72, evidence, suggestion: "拆分长句" }],
      }),
    });
  });
  await page.route(`**/api/chapters/${chapter.id}/versions`, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify([
      {
        id: chapter.currentVersionId ?? "formal-current",
        chapterId: chapter.id,
        label: "当前正式版",
        content: chapter.draft,
        wordCount: chapter.draft.length,
        source: "manual",
        createdAt: "2026-07-15T00:00:00.000Z",
      },
      {
        id: "quality-gated-candidate",
        chapterId: chapter.id,
        label: "待质检候选稿",
        content: `${chapter.draft}\n候选结尾`,
        wordCount: chapter.draft.length + 4,
        source: "ai-candidate",
        createdAt: "2026-07-16T00:00:00.000Z",
      },
    ]),
  }));

  await page.goto(`/novel/${novelId}/chapters?chapter=${chapter.id}`);
  const panel = page.getByRole("region", { name: "章节质量" });
  await expect(panel).toBeVisible();
  await expect(panel.getByText("硬冲突", { exact: true })).toBeVisible();
  await expect(panel.getByText("警告", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "采用并保存为正文" })).toBeDisabled();

  await panel.getByRole("button", { name: "AI 语义质检" }).click();
  await expect(panel.getByText("72 · 可优化", { exact: true })).toBeVisible();
  await expect(panel.getByText("整体可读", { exact: true })).toBeVisible();
  await expect(panel.getByTestId("quality-last-run")).toContainText("最近运行");

  await panel.getByRole("button", { name: new RegExp("句式节奏") }).click();
  const selection = await page.getByRole("textbox", { name: "章节正文" }).evaluate((element: HTMLTextAreaElement) => ({
    selected: element.value.slice(element.selectionStart, element.selectionEnd),
    focused: document.activeElement === element,
  }));
  expect(selection).toEqual({ selected: evidence, focused: true });

  await panel.getByRole("button", { name: "重新运行语义质检" }).click();
  await expect(panel.getByRole("alert")).toContainText("模型暂时不可用");
  await expect(panel.getByText("句式节奏", { exact: true })).toBeVisible();
  await expect(panel.getByRole("button", { name: "重新运行语义质检" })).toBeVisible();

  await page.getByRole("textbox", { name: "章节正文" }).fill(`${evidence}，正文已经修改。`);
  await expect(panel.getByText("正文已修改，语义质检结果已过期，请重新运行。", { exact: true })).toBeVisible();
  await expect(panel.getByTestId("quality-last-run")).toContainText("结果已过期");
  await expect(panel.getByTestId("quality-last-run")).not.toContainText("最近运行");
  await expect(panel.getByRole("button", { name: "重新运行语义质检" })).toBeVisible();

  await page.locator(".chapter-nav-item:not(.is-current)").first().click();
  await expect(page.getByRole("region", { name: "章节质量" }).getByText("句式节奏", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "章节质量" }).getByText("风格", { exact: true })).toHaveCount(0);
  await request.delete(`/api/chapters/${chapter.id}/working-draft`);
});

test("failed preflight rerun preserves the last successful result", async ({ page, request }) => {
  const workspace = await (await request.get(`/api/novels/${novelId}/workspace`)).json() as { chapters: Array<{ id: string }> };
  const chapter = workspace.chapters[1];
  let runs = 0;
  await page.route(`**/api/chapters/${chapter.id}/preflight`, (route) => {
    runs += 1;
    if (runs > 1) return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "预检服务暂时不可用" }) });
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ level: "warning", title: "已知提醒", detail: "保留这条成功结果" }]),
    });
  });

  await page.goto(`/novel/${novelId}/chapters?chapter=${chapter.id}`);
  const panel = page.getByRole("region", { name: "章节质量" });
  await expect(panel.getByText("已知提醒", { exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "运行预检" }).click();
  await expect(panel.getByRole("alert")).toContainText("预检服务暂时不可用");
  await expect(panel.getByText("已知提醒", { exact: true })).toBeVisible();
});

test("accept refetches preflight and stops when a new hard conflict appears", async ({ page, request }) => {
  const workspace = await (await request.get(`/api/novels/${novelId}/workspace`)).json() as {
    chapters: Array<{ id: string; draft: string; currentVersionId: string | null }>;
  };
  const chapter = workspace.chapters[2];
  let preflightRuns = 0;
  let acceptRuns = 0;
  await page.route(`**/api/chapters/${chapter.id}/preflight`, (route) => {
    preflightRuns += 1;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(preflightRuns === 1 ? [] : [{ level: "block", title: "新硬冲突", detail: "接受前刚发现的冲突" }]),
    });
  });
  await page.route(`**/api/chapters/${chapter.id}/versions`, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify([
      { id: chapter.currentVersionId ?? "formal-current", chapterId: chapter.id, label: "正式版", content: chapter.draft, wordCount: 0, source: "manual", createdAt: "2026-07-15T00:00:00.000Z" },
      { id: "stale-clean-candidate", chapterId: chapter.id, label: "待接受候选稿", content: "候选正文", wordCount: 4, source: "ai-candidate", baseRevision: 1, baseVersionId: chapter.currentVersionId, createdAt: "2026-07-16T00:00:00.000Z" },
    ]),
  }));
  await page.route(`**/api/chapters/${chapter.id}/candidates/stale-clean-candidate/accept`, (route) => {
    acceptRuns += 1;
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });

  await page.goto(`/novel/${novelId}/chapters?chapter=${chapter.id}`);
  const accept = page.getByRole("button", { name: "采用并保存为正文" });
  await expect(accept).toBeEnabled();
  await accept.click();
  await expect(page.getByText("接受前预检发现硬冲突，请先解决冲突后再接受候选稿。", { exact: true })).toBeVisible();
  await expect(page.getByText("新硬冲突", { exact: true })).toBeVisible();
  expect(preflightRuns).toBeGreaterThanOrEqual(2);
  expect(acceptRuns).toBe(0);
});

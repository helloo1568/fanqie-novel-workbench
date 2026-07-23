import { expect, test } from "@playwright/test";

const novelId = "a623886a-5338-45f7-a1ad-4bdd6658d958";
const courtyardNovelId = "245ae0db-4ce7-477b-a4e9-ebe77ca7ca17";

test("chapter-centered shell exposes chapter landmarks and legacy planning", async ({ page }) => {
  let workspaceRequests = 0;
  page.on("request", (request) => {
    if (request.url().includes(`/api/novels/${novelId}/workspace`)) workspaceRequests += 1;
  });
  await page.goto(`/novel/${novelId}/overview`);
  await expect(page.locator('[data-testid="workbench-shell"]')).toBeVisible();
  await expect(page.getByRole("navigation", { name: "章节导航" }).first()).toBeVisible();
  await expect(page.getByRole("region", { name: "当前章节工作区" })).toBeVisible();
  await page.waitForTimeout(2_100);
  await page.getByRole("navigation", { name: "章节导航" }).first().getByRole("link", { name: "策划" }).click();
  await expect(page.locator('[data-testid="workbench-shell"]')).toBeVisible();
  await expect(page.getByRole("heading", { name: "开书策划" })).toBeVisible();
  expect(workspaceRequests).toBe(1);
  await page.getByRole("navigation", { name: "章节导航" }).first().getByRole("link", { name: "章节" }).click();
  await expect(page).toHaveURL(new RegExp(`/novel/${novelId}/chapters$`));
  await expect(page.locator('[data-testid="workbench-shell"]')).toBeVisible();
  await expect(page.getByRole("heading", { name: "章节创作" })).toBeVisible();
});

test("workbench retry recovers from an unknown novel", async ({ page }) => {
  let workspaceRequests = 0;
  page.on("request", (request) => {
    if (request.url().includes("/api/novels/unknown-novel/workspace")) workspaceRequests += 1;
  });

  await page.goto("/novel/unknown-novel/overview");
  await expect(page.getByRole("alert")).toContainText("小说不存在");
  const requestsBeforeRetry = workspaceRequests;
  await page.getByRole("button", { name: "重试" }).click();
  await expect.poll(() => workspaceRequests).toBeGreaterThan(requestsBeforeRetry);

  await page.goto(`/novel/${novelId}/overview`);
  await expect(page.locator('[data-testid="workbench-shell"]')).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("workbench router preserves library and novel route boundaries", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".app-shell")).toBeVisible();
  await page.goto(`/novel/${novelId}/overview`);
  await expect(page).toHaveURL(new RegExp(`/novel/${novelId}/overview$`));
  await expect(page.locator('[data-testid="workbench-shell"]')).toBeVisible();
});

test("primary navigation preserves views and chapter history", async ({ page, request }) => {
  const workspace = await (await request.get(`/api/novels/${novelId}/workspace`)).json() as {
    chapters: Array<{ id: string; title: string }>;
  };
  const chapter = workspace.chapters[1] ?? workspace.chapters[0];
  expect(chapter).toBeTruthy();

  const destinations = [
    { view: "canon", heading: "故事圣经" },
    { view: "outline", heading: "四层大纲" },
    { view: "timeline", heading: "伏笔与时间线" },
    { view: "publish", heading: "发布与导出" },
    { view: "settings", heading: "模型与数据" },
  ];

  for (const destination of destinations) {
    await page.goto(`/novel/${novelId}/chapters?chapter=${chapter.id}`);
    const navigation = page.locator('nav[aria-label="章节导航"]:visible');
    await navigation.getByRole("link", { name: destination.heading === "故事圣经" ? "故事圣经"
      : destination.heading === "四层大纲" ? "大纲"
        : destination.heading === "伏笔与时间线" ? "伏笔时间线"
          : destination.heading === "发布与导出" ? "发布"
            : "设置" }).click();
    await expect(page).toHaveURL(new RegExp(`/novel/${novelId}/${destination.view}$`));
    await expect(page.getByRole("heading", { name: destination.heading })).toBeVisible();
  }

  await page.goto(`/novel/${novelId}/chapters?chapter=${chapter.id}`);
  await page.locator('nav[aria-label="章节导航"]:visible').getByRole("link", { name: "策划" }).click();
  await expect(page).toHaveURL(new RegExp(`/novel/${novelId}/planning$`));
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/novel/${novelId}/chapters\\?chapter=${chapter.id}$`));
  await expect(page.locator(`[data-chapter-id="${chapter.id}"]`)).toHaveAttribute("aria-current", "true");
  await page.goForward();
  await expect(page).toHaveURL(new RegExp(`/novel/${novelId}/planning$`));
  await page.goBack();
  await expect(page.locator(`[data-chapter-id="${chapter.id}"]`)).toHaveAttribute("aria-current", "true");

  await page.keyboard.press("Control+K");
  const globalSearch = page.getByRole("combobox", { name: "全局搜索" });
  await expect(globalSearch).toBeFocused();
  await globalSearch.fill(chapter.title);
  await expect(page.getByRole("option", { name: new RegExp(chapter.title) })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(globalSearch).toHaveValue("");
  await expect(globalSearch).not.toBeFocused();
});

test("global search supports keyboard navigation and closes outside", async ({ page, request }) => {
  const workspace = await (await request.get(`/api/novels/${novelId}/workspace`)).json() as {
    chapters: Array<{ id: string; title: string }>;
  };
  const chapter = workspace.chapters[0];
  await page.goto(`/novel/${novelId}/overview`);

  const search = page.getByRole("combobox", { name: "全局搜索" });
  await page.keyboard.press("Control+K");
  await expect(search).toBeFocused();
  await search.fill(chapter.title);
  await expect(search).toHaveAttribute("aria-expanded", "true");
  await expect(search).toHaveAttribute("aria-controls", "workbench-search-results");
  await expect(page.getByRole("option", { name: new RegExp(chapter.title) })).toBeVisible();
  await search.press("ArrowDown");
  const activeId = await search.getAttribute("aria-activedescendant");
  expect(activeId).toBeTruthy();
  await expect(page.locator(`#${activeId}`)).toHaveAttribute("aria-selected", "true");
  await search.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/novel/${novelId}/chapters\\?chapter=${chapter.id}$`));

  await page.goto(`/novel/${novelId}/overview`);
  await page.keyboard.press("Control+K");
  await search.fill("设置");
  await expect(page.getByRole("listbox", { name: "搜索结果" })).toBeVisible();
  await page.getByRole("heading", { name: "创作总览" }).dispatchEvent("pointerdown");
  await expect(search).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("listbox", { name: "搜索结果" })).toHaveCount(0);

  await page.goto(`/novel/${novelId}/chapters?chapter=${chapter.id}`);
  const prose = page.getByRole("textbox", { name: "章节正文" });
  await prose.focus();
  await page.keyboard.press("Control+K");
  await expect(prose).toBeFocused();
  await expect(page.getByRole("combobox", { name: "全局搜索" })).not.toBeFocused();
});

test("shared modal traps programmatic focus and ignores inside backdrop events", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "导入" }).click();
  const dialog = page.getByRole("dialog", { name: "导入小说" });
  await expect(dialog).toBeVisible();
  await dialog.locator(".modal-body").click({ position: { x: 8, y: 8 } });
  await expect(dialog).toBeVisible();
  await page.evaluate(() => {
    const outside = document.querySelector<HTMLElement>("h1");
    if (!outside) return;
    outside.tabIndex = -1;
    outside.focus();
  });
  await expect(dialog.locator(":focus")).toHaveCount(1);
  await expect(dialog).toHaveAttribute("aria-labelledby", /.+/);
  await page.locator(".modal-backdrop").click({ position: { x: 3, y: 3 } });
  await expect(dialog).toHaveCount(0);
});

test("chapter switch reports a recovery draft flush failure", async ({ page, request }) => {
  const workspace = await (await request.get(`/api/novels/${novelId}/workspace`)).json() as {
    chapters: Array<{ id: string; draft: string }>;
  };
  const source = workspace.chapters[0];
  const destination = workspace.chapters[1];
  await page.route(`**/api/chapters/${source.id}/working-draft`, async (route) => {
    if (route.request().method() === "PATCH") {
      await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "磁盘暂时不可写" }) });
      return;
    }
    await route.continue();
  });
  await page.goto(`/novel/${novelId}/chapters?chapter=${source.id}`);
  const prose = page.getByRole("textbox", { name: "章节正文" });
  await prose.fill(`${source.draft}\n切换前未保存-${Date.now()}`);
  await page.locator(`[data-chapter-id="${destination.id}"]`).click();
  const switchError = page.locator(".chapter-switch-error");
  await expect(switchError).toContainText("无法切换章节");
  await expect(switchError).toContainText("请重试保存恢复稿");
  await expect(page.locator(`[data-chapter-id="${source.id}"]`)).toHaveAttribute("aria-current", "true");
});

test("cross-view navigation flushes the latest recovery draft before leaving chapters", async ({ page, request }) => {
  const workspace = await (await request.get(`/api/novels/${novelId}/workspace`)).json() as {
    chapters: Array<{ id: string; draft: string }>;
  };
  const chapter = workspace.chapters[0];
  await request.delete(`/api/chapters/${chapter.id}/working-draft`);
  const recoveryText = `${chapter.draft}\n跨视图保存-${Date.now()}`;

  await page.goto(`/novel/${novelId}/chapters?chapter=${chapter.id}`);
  await page.getByRole("textbox", { name: "章节正文" }).fill(recoveryText);
  await page.locator('nav[aria-label="章节导航"]:visible').getByRole("link", { name: "总览" }).click();

  await expect(page).toHaveURL(new RegExp(`/novel/${novelId}/overview$`));
  const saved = await (await request.get(`/api/chapters/${chapter.id}/working-draft`)).json() as { content: string };
  expect(saved.content).toBe(recoveryText);
  await request.delete(`/api/chapters/${chapter.id}/working-draft`);
});

test("cross-view navigation stays on chapters and shows an error when draft flush fails", async ({ page, request }) => {
  const workspace = await (await request.get(`/api/novels/${novelId}/workspace`)).json() as {
    chapters: Array<{ id: string; draft: string }>;
  };
  const chapter = workspace.chapters[0];
  await request.delete(`/api/chapters/${chapter.id}/working-draft`);
  await page.route(`**/api/chapters/${chapter.id}/working-draft`, async (route) => {
    if (route.request().method() === "PATCH") {
      await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "磁盘暂时不可写" }) });
      return;
    }
    await route.continue();
  });

  await page.goto(`/novel/${novelId}/chapters?chapter=${chapter.id}`);
  await page.getByRole("textbox", { name: "章节正文" }).fill(`${chapter.draft}\n不能丢失-${Date.now()}`);
  await page.locator('nav[aria-label="章节导航"]:visible').getByRole("link", { name: "总览" }).click();

  await expect(page).toHaveURL(new RegExp(`/novel/${novelId}/chapters\\?chapter=${chapter.id}$`));
  const navigationError = page.locator(".workbench-navigation-error");
  await expect(navigationError).toContainText("无法离开章节");
  await expect(navigationError).toContainText("恢复稿保存失败");
});

test("library and import dialog stay usable", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "作品书库" })).toBeVisible();
  await expect(page.getByRole("button", { name: "端到端测试作品" })).toBeVisible();
  await page.getByRole("button", { name: "导入" }).click();
  await expect(page.getByRole("dialog", { name: "导入小说" })).toBeVisible();
  await expect(page.getByText("TXT和Markdown按章节标题切分")).toBeVisible();
  await page.getByRole("button", { name: "关闭" }).click();
  const widths = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
  expect(widths.document).toBeLessThanOrEqual(widths.viewport);
});

test("chapter editor exposes recovery-safe creation tools", async ({ page }) => {
  await page.goto(`/novel/${novelId}/chapters`);
  await expect(page.getByRole("heading", { name: "章节创作" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "本章章纲" })).toBeVisible();
  await expect(page.getByRole("region", { name: "章节质量" })).toBeVisible();
  await page.getByRole("button", { name: "查找替换" }).click();
  await expect(page.getByPlaceholder("查找")).toBeVisible();
  await expect(page.getByRole("combobox", { name: "AI任务类型" })).toHaveValue("正文");
  const widths = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
  expect(widths.document).toBeLessThanOrEqual(widths.viewport);
});

test("confirming an outline preserves formal prose, version history, and recovery content", async ({ page, request }) => {
  const workspace = await (await request.get(`/api/novels/${novelId}/workspace`)).json() as {
    chapters: Array<{ id: string; title: string; draft: string; version: number }>;
  };
  const chapter = workspace.chapters[0];
  await request.delete(`/api/chapters/${chapter.id}/working-draft`);
  const versionsBefore = await (await request.get(`/api/chapters/${chapter.id}/versions`)).json() as unknown[];
  const recoveryText = `${chapter.draft}\n章纲确认仍保留-${Date.now()}`;

  await page.goto(`/novel/${novelId}/chapters?chapter=${chapter.id}`);
  await page.getByRole("textbox", { name: "章节正文" }).fill(recoveryText);
  const confirm = page.getByRole("button", { name: "确认章纲" });
  await expect(confirm).toBeEnabled();
  await Promise.all([
    page.waitForResponse((response) => response.url().endsWith(`/api/chapters/${chapter.id}`) && response.request().method() === "PATCH" && response.ok()),
    confirm.click(),
  ]);

  const refreshed = await (await request.get(`/api/novels/${novelId}/workspace`)).json() as {
    chapters: Array<{ id: string; draft: string; version: number }>;
  };
  const formal = refreshed.chapters.find((item) => item.id === chapter.id)!;
  const versionsAfter = await (await request.get(`/api/chapters/${chapter.id}/versions`)).json() as unknown[];
  const working = await (await request.get(`/api/chapters/${chapter.id}/working-draft`)).json() as { content: string; baseVersion: number };
  expect(formal.draft).toBe(chapter.draft);
  expect(versionsAfter).toHaveLength(versionsBefore.length);
  expect(working.content).toBe(recoveryText);
  expect(working.baseVersion).toBe(formal.version);
  await request.delete(`/api/chapters/${chapter.id}/working-draft`);
});

test("related context stays bounded on desktop", async ({ page }) => {
  const chaptersUrl = `/novel/${novelId}/chapters`;
  const drawer = page.getByRole("complementary", { name: "章节上下文" });
  const openDrawer = async () => {
    const opener = page.getByRole("button", { name: "展开上下文" });
    await opener.click();
    await expect(drawer).toBeVisible();
    return opener;
  };

  await page.goto(chaptersUrl);
  const opener = await openDrawer();
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("heading", { name: "相关上下文" })).toBeVisible();
  for (const heading of ["人物与设定", "已确认事实", "相关伏笔", "时间线", "相邻章节摘要"]) {
    await expect(drawer.getByRole("heading", { name: new RegExp(heading) })).toBeVisible();
  }
  await expect(drawer.getByRole("link", { name: "查看全部" }).first()).toHaveAttribute("href", new RegExp(`/novel/${novelId}/canon$`));
  const sections = drawer.locator(".context-section");
  for (let index = 0; index < await sections.count(); index += 1) {
    const items = sections.nth(index).locator(".context-items > li");
    const itemCount = await items.count();
    expect(itemCount).toBeLessThanOrEqual(5);
    if (!itemCount) continue;
    const metadata = await items.locator(".context-item-link > span").allTextContents();
    expect(metadata).toHaveLength(itemCount);
    for (const value of metadata) expect(value).toMatch(/^来源：.+ · (更新于 .+|时间未记录)$/);
  }

  const geometry = await page.evaluate(() => {
    const drawer = document.querySelector(".context-drawer")!.getBoundingClientRect();
    const workspace = document.querySelector(".chapter-shell-workspace")!.getBoundingClientRect();
    return { drawer: { left: drawer.left, right: drawer.right }, workspaceRight: workspace.right, viewportWidth: innerWidth, documentWidth: document.documentElement.scrollWidth };
  });
  expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.drawer.left).toBeGreaterThanOrEqual(geometry.workspaceRight);
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(opener).toBeFocused();

  const destinations = [
    { linkIndex: 0, path: "canon", heading: "故事圣经" },
    { linkIndex: 2, path: "timeline", heading: "伏笔与时间线" },
    { linkIndex: 4, path: "chapters", heading: "章节创作" },
  ];
  for (const destination of destinations) {
    await page.goto(chaptersUrl);
    await openDrawer();
    await drawer.getByRole("link", { name: "查看全部" }).nth(destination.linkIndex).click();
    await expect(page).toHaveURL(new RegExp(`/novel/${novelId}/${destination.path}$`));
    if (destination.path === "chapters") {
      await page.keyboard.press("Escape");
      await expect(drawer).toBeHidden();
    }
    await expect(page.getByRole("heading", { name: destination.heading })).toBeVisible();
  }
});

test("chapter navigation and draft recovery", async ({ page, request }) => {
  const workspaceResponse = await request.get(`/api/novels/${novelId}/workspace`);
  const workspace = await workspaceResponse.json() as {
    chapters: Array<{ id: string; title: string; draft: string }>;
  };
  const target = workspace.chapters[1] ?? workspace.chapters[0];
  expect(target).toBeTruthy();

  await request.delete(`/api/chapters/${target.id}/working-draft`);
  const versionsBefore = await (await request.get(`/api/chapters/${target.id}/versions`)).json() as unknown[];
  const recoveryText = `${target.draft}\n\n恢复稿-${Date.now()}`;

  await page.goto(`/novel/${novelId}/chapters`);
  await page.locator(`[data-chapter-id="${target.id}"]`).click();
  await expect(page.getByRole("heading", { name: target.title })).toBeVisible();

  const editor = page.getByRole("textbox", { name: "章节正文" });
  await editor.fill(recoveryText);
  await expect(page.getByTestId("draft-save-state")).toHaveText("已自动保存", { timeout: 5_000 });

  await page.reload();
  await expect(page.locator(`[data-chapter-id="${target.id}"]`)).toHaveAttribute("aria-current", "true");
  await expect(editor).toHaveValue(recoveryText);
  await expect(page.getByText("已恢复未保存工作稿")).toBeVisible();

  const shortcutText = `${recoveryText}\n快捷保存`;
  await editor.fill(shortcutText);
  await page.keyboard.press("Control+S");
  await expect(page.getByTestId("draft-save-state")).toHaveText("已自动保存", { timeout: 5_000 });
  await page.reload();
  await expect(editor).toHaveValue(shortcutText);

  const versionsAfter = await (await request.get(`/api/chapters/${target.id}/versions`)).json() as unknown[];
  expect(versionsAfter).toHaveLength(versionsBefore.length);
  const widths = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
  expect(widths.document).toBeLessThanOrEqual(widths.viewport);

  await request.delete(`/api/chapters/${target.id}/working-draft`);
});

test("rapid chapter switch flushes the latest recovery draft", async ({ page, request }) => {
  const workspace = await (await request.get(`/api/novels/${novelId}/workspace`)).json() as {
    chapters: Array<{ id: string; draft: string }>;
  };
  const source = workspace.chapters[1];
  const destination = workspace.chapters[2];
  expect(source && destination).toBeTruthy();
  await request.delete(`/api/chapters/${source.id}/working-draft`);
  const latestText = `${source.draft}\n\n快速切章-${Date.now()}`;

  await page.goto(`/novel/${novelId}/chapters?chapter=${source.id}`);
  const editor = page.getByRole("textbox", { name: "章节正文" });
  await editor.fill(latestText);
  await page.locator(`[data-chapter-id="${destination.id}"]`).click();
  await expect(page.locator(`[data-chapter-id="${destination.id}"]`)).toHaveAttribute("aria-current", "true");

  const saved = await (await request.get(`/api/chapters/${source.id}/working-draft`)).json() as { content: string };
  expect(saved.content).toBe(latestText);
  await page.locator(`[data-chapter-id="${source.id}"]`).click();
  await expect(editor).toHaveValue(latestText);

  await request.delete(`/api/chapters/${source.id}/working-draft`);
});

test("early typing survives delayed working draft hydration", async ({ page, request }) => {
  const workspace = await (await request.get(`/api/novels/${novelId}/workspace`)).json() as {
    chapters: Array<{ id: string; novelId: string; title: string; draft: string; outline: Record<string, string | number>; version: number }>;
  };
  const chapter = workspace.chapters[3];
  await request.delete(`/api/chapters/${chapter.id}/working-draft`);
  await request.patch(`/api/chapters/${chapter.id}/working-draft`, {
    data: {
      chapterId: chapter.id,
      novelId: chapter.novelId,
      title: chapter.title,
      content: "迟到的服务端恢复稿",
      outline: chapter.outline,
      baseVersion: chapter.version,
      updatedAt: new Date().toISOString(),
    },
  });
  let releaseHydration: (() => void) | undefined;
  let markHydrationStarted: (() => void) | undefined;
  const hydrationStarted = new Promise<void>((resolve) => { markHydrationStarted = resolve; });
  const hydrationCanFinish = new Promise<void>((resolve) => { releaseHydration = resolve; });
  await page.route(`**/api/chapters/${chapter.id}/working-draft`, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    markHydrationStarted?.();
    await hydrationCanFinish;
    await route.continue();
  });

  await page.goto(`/novel/${novelId}/chapters?chapter=${chapter.id}`);
  await hydrationStarted;
  const editor = page.getByRole("textbox", { name: "章节正文" });
  const earlyText = `${chapter.draft}\n抢先输入-${Date.now()}`;
  await editor.fill(earlyText);
  releaseHydration?.();
  await expect(editor).toHaveValue(earlyText);
  await expect(page.getByTestId("draft-save-state")).toHaveText("已自动保存", { timeout: 5_000 });
  const saved = await (await request.get(`/api/chapters/${chapter.id}/working-draft`)).json() as { content: string };
  expect(saved.content).toBe(earlyText);
  await request.delete(`/api/chapters/${chapter.id}/working-draft`);
});

test("overlapping recovery saves are serialized with latest content winning", async ({ page, request }) => {
  const workspace = await (await request.get(`/api/novels/${novelId}/workspace`)).json() as {
    chapters: Array<{ id: string; draft: string }>;
  };
  const chapter = workspace.chapters[1];
  await request.delete(`/api/chapters/${chapter.id}/working-draft`);
  let releaseFirst: (() => void) | undefined;
  let markFirstStarted: (() => void) | undefined;
  const firstStarted = new Promise<void>((resolve) => { markFirstStarted = resolve; });
  const firstCanFinish = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const payloads: string[] = [];

  await page.route(`**/api/chapters/${chapter.id}/working-draft`, async (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    const payload = route.request().postDataJSON() as { content: string };
    payloads.push(payload.content);
    if (payloads.length === 1) {
      markFirstStarted?.();
      await firstCanFinish;
    }
    await route.continue();
  });

  await page.goto(`/novel/${novelId}/chapters?chapter=${chapter.id}`);
  const editor = page.getByRole("textbox", { name: "章节正文" });
  const firstText = `${chapter.draft}\n第一次保存-${Date.now()}`;
  const latestText = `${chapter.draft}\n第二次保存-${Date.now()}`;
  await editor.fill(firstText);
  await page.keyboard.press("Control+S");
  await firstStarted;
  await editor.fill(latestText);
  await page.keyboard.press("Control+S");
  releaseFirst?.();

  await expect(page.getByTestId("draft-save-state")).toHaveText("已自动保存", { timeout: 5_000 });
  await expect.poll(async () => {
    const saved = await (await request.get(`/api/chapters/${chapter.id}/working-draft`)).json() as { content: string };
    return saved.content;
  }).toBe(latestText);
  expect(payloads).toEqual([firstText, latestText]);
  await request.delete(`/api/chapters/${chapter.id}/working-draft`);
});

test("manual working draft can be saved as a formal version", async ({ page, request }) => {
  const workspace = await (await request.get(`/api/novels/${novelId}/workspace`)).json() as {
    chapters: Array<{ id: string; draft: string; status: string }>;
  };
  const chapter = workspace.chapters.find((item) => item.status !== "待策划")!;
  const formalText = `${chapter.draft}\n手动正稿-${Date.now()}`;

  await page.goto(`/novel/${novelId}/chapters?chapter=${chapter.id}`);
  await page.getByRole("textbox", { name: "章节正文" }).fill(formalText);
  await page.getByRole("button", { name: "保存正文" }).click();

  await expect(page.getByText("已保存为正式版本", { exact: true })).toBeVisible();
  await expect.poll(async () => {
    const latest = await (await request.get(`/api/novels/${novelId}/workspace`)).json() as {
      chapters: Array<{ id: string; draft: string }>;
    };
    return latest.chapters.find((item) => item.id === chapter.id)?.draft;
  }).toBe(formalText);

  const versions = await (await request.get(`/api/chapters/${chapter.id}/versions`)).json() as Array<{ label: string; content: string; source: string }>;
  expect(versions.some((version) => version.label === "手动正稿" && version.content === formalText && version.source === "manual")).toBe(true);
  await expect.poll(async () => (await (await request.get(`/api/chapters/${chapter.id}/working-draft`)).json()) as unknown).toBeNull();
});

test("chapter switch ignores a delayed generation startup", async ({ page, request }) => {
  const workspace = await (await request.get(`/api/novels/${novelId}/workspace`)).json() as {
    chapters: Array<{ id: string; status: string }>;
  };
  const source = workspace.chapters.find((chapter) => chapter.status !== "待策划")!;
  const destination = workspace.chapters.find((chapter) => chapter.id !== source.id)!;
  let releaseGeneration: (() => void) | undefined;
  let markGenerationStarted: (() => void) | undefined;
  const generationStarted = new Promise<void>((resolve) => { markGenerationStarted = resolve; });
  const generationCanFinish = new Promise<void>((resolve) => { releaseGeneration = resolve; });
  const eventRequests: string[] = [];
  page.on("request", (incoming) => {
    if (incoming.url().includes("/events")) eventRequests.push(incoming.url());
  });
  await page.route("**/api/chapters/*/preflight", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await page.route("**/api/generations", async (route) => {
    markGenerationStarted?.();
    await generationCanFinish;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ runId: "delayed-old-run" }) });
  });

  await page.goto(`/novel/${novelId}/chapters?chapter=${source.id}`);
  await page.getByRole("button", { name: "执行AI" }).click();
  await generationStarted;
  await page.locator(`[data-chapter-id="${destination.id}"]`).click();
  await expect(page.locator(`[data-chapter-id="${destination.id}"]`)).toHaveAttribute("aria-current", "true");
  releaseGeneration?.();
  await page.waitForTimeout(250);
  expect(eventRequests).toHaveLength(1);
  await expect(page.getByText("delayed-old-run")).toHaveCount(0);
});

test("candidate safety keeps partial drafts separate until explicit acceptance", async ({ page, request }) => {
  const workspace = await (await request.get(`/api/novels/${novelId}/workspace`)).json() as {
    chapters: Array<{ id: string; draft: string; status: string; currentVersionId: string | null }>;
  };
  const chapter = workspace.chapters.find((item) => item.status !== "待策划")!;
  const formalBefore = chapter.draft || "待替换的正式正文";
  const initialVersions = [{
    id: chapter.currentVersionId || "formal-v1",
    chapterId: chapter.id,
    label: "当前正式版",
    content: formalBefore,
    wordCount: formalBefore.length,
    source: "manual",
    createdAt: "2026-07-15T00:00:00.000Z",
  }];
  const completedText = formalBefore.length > 4
    ? `${formalBefore.slice(4)}\n新增加的候选结尾`
    : `重写后的候选正文\n新增加的候选结尾`;
  let generationCount = 0;
  let accepted = false;

  await page.addInitScript(() => {
    type Listener = (event: Event) => void;
    class FakeEventSource {
      static active: FakeEventSource | null = null;
      listeners = new Map<string, Listener[]>();
      closed = false;
      runId: string;
      constructor(url: string | URL) {
        this.runId = String(url).match(/generations\/([^/]+)\/events/)?.[1] || "";
        FakeEventSource.active = this;
        if (this.runId === "run-complete") window.setTimeout(() => this.emitTransportError(), 30);
        window.setTimeout(() => this.emit("phase", { status: "生成中" }), 20);
        window.setTimeout(() => this.emit("delta", { text: this.runId === "run-stop" ? "停止前已生成的部分" : this.runId === "run-fail" ? "失败前保留的部分" : "ignored" }), this.runId === "run-complete" ? 100 : 50);
        if (this.runId === "run-complete") {
          window.setTimeout(() => this.emit("done", {
            output: (window as typeof window & { __candidateText: string }).__candidateText,
            version: { id: "candidate-complete" },
          }), 170);
        }
        if (this.runId === "run-fail") {
          window.setTimeout(() => this.emit("error", {
            partial: "失败前保留的部分",
            version: { id: "candidate-failed" },
            message: "模型连接失败",
          }), 120);
        }
      }
      addEventListener(type: string, listener: EventListener) {
        const entries = this.listeners.get(type) || [];
        entries.push(listener);
        this.listeners.set(type, entries);
      }
      close() { this.closed = true; }
      emit(type: string, data: unknown) {
        if (this.closed) return;
        const event = new MessageEvent(type, { data: JSON.stringify(data) });
        for (const listener of this.listeners.get(type) || []) listener(event);
      }
      emitTransportError() {
        if (this.closed) return;
        const event = new Event("error");
        for (const listener of this.listeners.get("error") || []) listener(event);
      }
      static stop() {
        FakeEventSource.active?.emit("stopped", {
          partial: "停止前已生成的部分",
          version: { id: "candidate-partial" },
        });
      }
    }
    Object.defineProperty(window, "EventSource", { configurable: true, writable: true, value: FakeEventSource });
    (window as typeof window & { __stopFakeGeneration: () => void }).__stopFakeGeneration = () => FakeEventSource.stop();
  });
  await page.addInitScript(({ formal, candidate }) => {
    const state = window as typeof window & { __formalText: string; __candidateText: string };
    state.__formalText = formal;
    state.__candidateText = candidate;
  }, { formal: formalBefore, candidate: completedText });

  await page.route("**/api/generations", async (route) => {
    generationCount += 1;
    const runId = generationCount === 1 ? "run-stop" : generationCount === 2 ? "run-complete" : "run-fail";
    await route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ runId }) });
  });
  await page.route("**/api/generations/run-stop/cancel", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    await page.evaluate(() => (window as typeof window & { __stopFakeGeneration: () => void }).__stopFakeGeneration());
  });
  await page.route(`**/api/chapters/${chapter.id}/versions`, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(accepted ? [...initialVersions, {
      id: "candidate-complete", chapterId: chapter.id, label: "AI候选稿", content: completedText,
      wordCount: completedText.length, source: "ai-candidate", createdAt: "2026-07-16T00:00:00.000Z",
    }] : initialVersions),
  }));
  await page.route(`**/api/chapters/${chapter.id}/preflight`, (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await page.route(`**/api/chapters/${chapter.id}/candidates/candidate-complete/accept`, async (route) => {
    accepted = true;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ chapter: { ...chapter, draft: completedText, currentVersionId: "candidate-complete" } }) });
  });
  await page.route(`**/api/novels/${novelId}/workspace`, async (route) => {
    const response = await route.fetch();
    const body = await response.json() as typeof workspace;
    body.chapters = body.chapters.map((item) => item.id === chapter.id
      ? { ...item, draft: accepted ? completedText : formalBefore, currentVersionId: accepted ? "candidate-complete" : item.currentVersionId }
      : item);
    await route.fulfill({ response, json: body });
  });

  await page.goto(`/novel/${novelId}/chapters?chapter=${chapter.id}`);
  const formalEditor = page.getByRole("textbox", { name: "章节正文" });
  await expect(formalEditor).toHaveValue(formalBefore);

  await page.getByRole("button", { name: "执行AI" }).click();
  await expect(page.getByText("停止前已生成的部分", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "停止" }).click();
  await expect(page.getByText("已停止 · 部分稿可审核")).toBeVisible();
  await expect(formalEditor).toHaveValue(formalBefore);

  await page.getByRole("button", { name: "重新生成" }).evaluate((button: HTMLButtonElement) => button.click());
  await expect(page.getByText("生成连接暂时中断，正在自动重连。")).toHaveCount(0, { timeout: 2_000 });
  await expect(page.getByText("生成完成 · 待审核")).toBeVisible();
  const candidateTab = page.getByRole("tab", { name: "AI 候选正文" });
  await candidateTab.focus();
  await candidateTab.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "已保存正文" })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "已保存正文" }).press("End");
  await expect(page.getByRole("tab", { name: "历史版本" })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "历史版本" }).press("Home");
  await expect(candidateTab).toHaveAttribute("aria-selected", "true");
  const controlledPanel = await candidateTab.getAttribute("aria-controls");
  expect(controlledPanel).toBeTruthy();
  await expect(page.locator(`[id="${controlledPanel}"]`)).toHaveAttribute("aria-labelledby", await candidateTab.getAttribute("id") || "");
  await page.getByRole("tab", { name: "对比" }).click();
  await expect(page.locator(".candidate-diff .candidate-diff-added")).toContainText("新增加的候选结尾");
  await expect(page.locator(".candidate-diff .candidate-diff-removed")).not.toBeEmpty();
  await page.getByRole("tab", { name: "AI 候选正文" }).click();
  await page.getByRole("button", { name: "采用并保存为正文" }).click();
  await expect(formalEditor).toHaveValue(completedText);
  await page.getByRole("tab", { name: "历史版本" }).click();
  await expect(page.getByRole("button", { name: /当前正式稿 当前/ })).toBeVisible();

  await page.getByRole("button", { name: "执行AI" }).click();
  await expect(page.getByText("失败前保留的部分", { exact: false })).toBeVisible();
  await expect(page.getByText("生成失败 · 已保留部分稿")).toBeVisible();
  await expect(page.getByRole("button", { name: "采用并保存为正文" })).toBeEnabled();
});

test("candidate safety blocks acceptance when preflight has a hard conflict", async ({ page, request }) => {
  const workspace = await (await request.get(`/api/novels/${novelId}/workspace`)).json() as {
    chapters: Array<{ id: string; draft: string; status: string; currentVersionId: string | null }>;
  };
  const chapter = workspace.chapters.find((item) => item.status !== "待策划")!;
  const currentId = chapter.currentVersionId || "formal-current";
  await page.route(`**/api/chapters/${chapter.id}/preflight`, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify([{ level: "block", title: "设定冲突", detail: "候选稿违反已锁定设定" }]),
  }));
  await page.route(`**/api/chapters/${chapter.id}/versions`, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify([
      { id: currentId, chapterId: chapter.id, label: "当前正式版", content: chapter.draft, wordCount: chapter.draft.length, source: "manual", createdAt: "2026-07-15T00:00:00.000Z" },
      { id: "blocked-candidate", chapterId: chapter.id, label: "有冲突的候选稿", content: `${chapter.draft}\n冲突内容`, wordCount: chapter.draft.length + 4, source: "ai-candidate", createdAt: "2026-07-16T00:00:00.000Z" },
    ]),
  }));
  if (!chapter.currentVersionId) {
    await page.route(`**/api/novels/${novelId}/workspace`, async (route) => {
      const response = await route.fetch();
      const body = await response.json() as typeof workspace;
      body.chapters = body.chapters.map((item) => item.id === chapter.id ? { ...item, currentVersionId: currentId } : item);
      await route.fulfill({ response, json: body });
    });
  }

  await page.goto(`/novel/${novelId}/chapters?chapter=${chapter.id}`);
  await expect(page.getByRole("heading", { name: "有冲突的候选稿" })).toBeVisible();
  await expect(page.getByText("存在硬冲突，解决后才能接受候选稿。")).toBeVisible();
  await expect(page.getByRole("button", { name: "采用并保存为正文" })).toBeDisabled();
});

test("newest persisted partial candidate survives reload without stale candidates", async ({ page, request }) => {
  const workspace = await (await request.get(`/api/novels/${novelId}/workspace`)).json() as {
    chapters: Array<{ id: string }>;
  };
  const chapter = workspace.chapters[4];
  const currentVersionId = "accepted-current-version";
  await page.route(`**/api/novels/${novelId}/workspace`, async (route) => {
    const response = await route.fetch();
    const body = await response.json() as { chapters: Array<{ id: string; currentVersionId: string | null }> };
    body.chapters = body.chapters.map((item) => item.id === chapter.id ? { ...item, currentVersionId } : item);
    await route.fulfill({ response, json: body });
  });
  await page.route(`**/api/chapters/${chapter.id}/versions`, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify([
      { id: "old-complete", chapterId: chapter.id, label: "旧完整候选", content: "不应重新出现", wordCount: 6, source: "codex-candidate", createdAt: "2026-07-10T00:00:00.000Z" },
      { id: currentVersionId, chapterId: chapter.id, label: "已接受正式版", content: "当前正式内容", wordCount: 6, source: "manual", createdAt: "2026-07-11T00:00:00.000Z" },
      { id: "newest-partial", chapterId: chapter.id, label: "最新停止稿", content: "停止后保留下来的最新部分正文", wordCount: 14, source: "ai-partial", createdAt: "2026-07-12T00:00:00.000Z" },
    ]),
  }));

  await page.goto(`/novel/${novelId}/chapters?chapter=${chapter.id}`);
  await expect(page.getByRole("heading", { name: "最新停止稿" })).toBeVisible();
  await expect(page.getByRole("button", { name: "采用并保存为正文" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "旧完整候选" })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { name: "最新停止稿" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "旧完整候选" })).toHaveCount(0);
});

test("empty chapter automatically reveals its pending prose candidate", async ({ page }) => {
  await page.goto(`/novel/${courtyardNovelId}/chapters`);
  await expect(page.getByRole("heading", { name: "待采用 AI 正文" })).toBeVisible();
  await expect(page.getByText("这是一份尚未写入正式正文的候选内容。", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "采用并保存为正文" })).toBeVisible();
  const widths = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
  expect(widths.document).toBeLessThanOrEqual(widths.viewport);
});

test("deep planning interview is review-first and responsive", async ({ page }) => {
  await page.goto(`/novel/${novelId}/planning`);
  await expect(page.getByRole("heading", { name: "开书策划" })).toBeVisible();
  await expect(page.getByText("12 项已加载", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "AI 深度开书" }).click();
  const dialog = page.getByRole("dialog", { name: "AI 深度开书" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("所有结果先成为候选，不会覆盖现有内容。", { exact: false })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "开始深度策划" })).toBeVisible();
  await expect(dialog.getByRole("spinbutton")).toHaveValue(/\d+/);
  const widths = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
  expect(widths.document).toBeLessThanOrEqual(widths.viewport);
});

test("settings exposes local model configuration", async ({ page }) => {
  await page.goto(`/novel/${novelId}/settings`);
  await expect(page.getByRole("heading", { name: "自定义大模型" })).toBeVisible();
  await expect(page.getByRole("button", { name: "接入模型" })).toBeVisible();
  await expect(page.getByText("密钥加密保存在本机", { exact: false })).toBeVisible();
});

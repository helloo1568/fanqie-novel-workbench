# 手动保存工作稿为正稿 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让作者可以将章节编辑器当前工作稿直接保存为新的正式正文版本。

**Architecture:** 前端在 `useChapterSession` 中增加“创建并接受手动版本”的 mutation，复用现有 `POST /chapters/:id/versions` 服务端接口及其立即接受版本的行为。`ChapterEditor` 提供一个按钮调用该 mutation；成功后使工作区、工作稿与版本查询失效，失败时保留编辑器内容并显示错误。

**Tech Stack:** React 19、TanStack Query、TypeScript、Fastify、Playwright。

---

### Task 1: 添加端到端回归测试

**Files:**
- Modify: `D:\a project\ai小说工作台\e2e\workbench.spec.ts`

- [ ] **Step 1: 写入失败测试**

在既有的章节编辑器测试区域添加以下用例，先输入工作稿文字，点击新按钮，并断言正式正文、版本记录和工作稿 API 状态：

```ts
test("manual working draft can be saved as a formal version", async ({ page, request }) => {
  const workspace = await (await request.get(`/api/novels/${novelId}/workspace`)).json() as {
    chapters: Array<{ id: string; draft: string; status: string }>;
  };
  const chapter = workspace.chapters.find((item) => item.status !== "待策划")!;
  const formalText = `${chapter.draft}\n手动正稿-${Date.now()}`;

  await page.goto(`/novel/${novelId}/chapters?chapter=${chapter.id}`);
  await page.getByRole("textbox", { name: "章节正文" }).fill(formalText);
  await page.getByRole("button", { name: "保存为正稿" }).click();

  await expect(page.getByText("已保存为正式版本")).toBeVisible();
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
```

- [ ] **Step 2: 运行失败测试并确认失败原因是按钮尚未实现**

Run:

```powershell
pnpm exec playwright test e2e/workbench.spec.ts --grep "manual working draft can be saved as a formal version"
```

Expected: FAIL，提示找不到名称为“保存为正稿”的按钮。

### Task 2: 添加保存正稿 mutation

**Files:**
- Modify: `D:\a project\ai小说工作台\src\features\workbench\useChapterSession.ts`

- [ ] **Step 1: 添加 mutation**

在 `saveDraftMutation` 后添加：

```ts
const saveFormalMutation = useMutation<unknown, ApiError, { content: string; label: string }>({
  mutationFn: (input) => post(`/chapters/${chapterId}/versions`, input),
  onSuccess: async () => {
    const workspaceEntries = queryClient.getQueriesData<Workspace>({ queryKey: ["workspace"] });
    const workspaceKeys = workspaceEntries
      .filter(([, workspace]) => workspace?.chapters.some((chapter) => chapter.id === chapterId))
      .map(([queryKey]) => queryKey);
    const novelId = workingDraft.data?.novelId ?? generationNovelIdRef.current;
    if (novelId && !workspaceKeys.some((queryKey) => queryKey[1] === novelId)) workspaceKeys.push(["workspace", novelId]);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: chapterSessionKeys.workingDraft(chapterId), exact: true }),
      queryClient.invalidateQueries({ queryKey: chapterSessionKeys.versions(chapterId), exact: true }),
      ...workspaceKeys.map((queryKey) => queryClient.invalidateQueries({ queryKey, exact: true })),
    ]);
  },
});
```

- [ ] **Step 2: 暴露操作和 mutation 状态**

在 hook 的返回对象中添加：

```ts
saveFormal: (content: string) => saveFormalMutation.mutateAsync({ content, label: "手动正稿" }),
```

并在 `mutations` 中添加：

```ts
saveFormal: saveFormalMutation,
```

### Task 3: 在章节编辑器提供操作入口

**Files:**
- Modify: `D:\a project\ai小说工作台\src\features\chapters\ChapterEditor.tsx`

- [ ] **Step 1: 添加保存回调**

在 `acceptCandidate` 附近添加：

```ts
const saveAsFormal = async () => {
  setSaveError("");
  try {
    await saveRecoveryDraft();
    await session.saveFormal(content);
    setRestored(false);
    setSaveState("已保存");
  } catch (error) {
    setSaveError(errorMessage(error));
  }
};
```

- [ ] **Step 2: 添加按钮**

在现有“保存恢复稿”按钮旁添加：

```tsx
<button
  className="btn primary"
  type="button"
  aria-label="保存为正稿"
  onClick={() => void saveAsFormal()}
  disabled={!content.trim() || session.mutations.saveFormal.isPending}
>
  <Check size={16}/>保存为正稿
</button>
```

- [ ] **Step 3: 添加成功反馈**

在 `saveAsFormal` 成功分支中调用已有 `toast`，显示：

```ts
toast("已保存为正式版本");
```

如果 `ChapterEditor` 还未接收 toast，则使用项目已有的 `useToast` 或传参模式接入，保持与其它页面一致。

### Task 4: 验证

**Files:**
- Modify: `D:\a project\ai小说工作台\e2e\workbench.spec.ts`
- Modify: `D:\a project\ai小说工作台\src\features\workbench\useChapterSession.ts`
- Modify: `D:\a project\ai小说工作台\src\features\chapters\ChapterEditor.tsx`

- [ ] **Step 1: 运行新增端到端测试**

Run:

```powershell
pnpm exec playwright test e2e/workbench.spec.ts --grep "manual working draft can be saved as a formal version"
```

Expected: PASS。

- [ ] **Step 2: 运行类型检查**

Run:

```powershell
pnpm typecheck
```

Expected: exit code 0。

- [ ] **Step 3: 运行全部单元测试**

Run:

```powershell
pnpm test
```

Expected: exit code 0。

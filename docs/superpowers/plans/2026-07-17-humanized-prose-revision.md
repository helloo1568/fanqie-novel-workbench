# 真人化正文与定点二稿 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为都市脑洞作品加入真人化默认规则，降低正文提示词的清单感，并支持从质检结果生成独立定点二稿。

**Architecture:** 在现有 `prompt_templates` 和 `chapter_versions` 基础上扩展，不新增数据表。服务端将正文 prompt 的硬约束与风格约束拆分；定点二稿复用质检、供应商选择、候选版本和版本冻结机制。

**Tech Stack:** TypeScript、Fastify、better-sqlite3、Vitest、React。

---

### Task 1: 都市脑洞的真人化默认模板

**Files:**
- Modify: `server/repository.ts`
- Test: `server/core.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
const novel = createNovel({ title: "都市真人化模板", genre: "都市脑洞" })!;
const templates = sqlite.prepare("SELECT task_type,content FROM prompt_templates WHERE novel_id=? ORDER BY task_type").all(novel.id) as Array<{ task_type: string; content: string }>;
expect(templates).toEqual(expect.arrayContaining([
  expect.objectContaining({ task_type: "正文", content: expect.stringContaining("未解释动作") }),
  expect.objectContaining({ task_type: "质检", content: expect.stringContaining("潜台词") }),
]));
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run server/core.test.ts`

Expected: FAIL because the new novel has no such templates.

- [ ] **Step 3: Write minimal implementation**

Insert two novel-scoped templates after the existing novel insert when `input.genre === "都市脑洞"`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run server/core.test.ts`

Expected: PASS.

### Task 2: 场景优先的正文 prompt

**Files:**
- Modify: `server/ai.ts`
- Test: `server/core.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
const prose = previewPrompt(chapterId, "正文")!.prompt;
expect(prose).toContain("场景优先");
expect(prose).toContain("动作、对白和环境已经表达的信息");
expect(prose).not.toContain("本章70%进度前兑现");
expect(prose).not.toContain("明确写出见证者反应");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run server/core.test.ts`

Expected: FAIL because the existing prompt contains the removed commands.

- [ ] **Step 3: Write minimal implementation**

Replace the two forced payoff requirements in `buildPrompt()` with scene-first rules and set prose stream requests to `temperature: 0.72`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run server/core.test.ts`

Expected: PASS.

### Task 3: 定点二稿服务与 API

**Files:**
- Modify: `server/ai.ts`
- Modify: `server/index.ts`
- Modify: `src/api.ts`
- Modify: `src/features/chapters/ChapterVersions.tsx`
- Test: `server/core.test.ts`

- [ ] **Step 1: Write failing service tests**

```ts
await expect(startTargetedRevision({ novelId, chapterId, sourceVersionId })).rejects.toThrow("供应商未保存API密钥");
expect(sqlite.prepare("SELECT COUNT(*) count FROM chapter_versions WHERE chapter_id=?").get(chapterId)).toEqual({ count: 1 });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run server/core.test.ts`

Expected: FAIL because `startTargetedRevision` does not exist.

- [ ] **Step 3: Implement the service**

Add source-version lookup, semantic-quality issue selection, revision prompt construction, streamed generation, and an `ai-revision` candidate version.

- [ ] **Step 4: Add the API route and version-list action**

Add `POST /api/chapters/:id/revisions`, then add a pending-state button in the candidate version UI that posts the selected source version id and refreshes versions.

- [ ] **Step 5: Run verification**

Run: `pnpm test && pnpm typecheck && pnpm build`

Expected: all commands complete successfully.

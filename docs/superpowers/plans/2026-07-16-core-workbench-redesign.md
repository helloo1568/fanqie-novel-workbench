# Core Workbench Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current multi-page authoring flow with a responsive chapter-centered workbench while preserving the existing Fastify API, SQLite data, versioning, and legacy routes.

**Architecture:** Introduce a thin application shell and feature-oriented React modules. `WorkbenchShell` owns layout and route state; feature hooks own API queries and mutations; chapter/context/quality panels communicate through typed props and React Query invalidation. Existing server endpoints remain the source of truth.

**Tech Stack:** React 19, TypeScript, React Router, TanStack React Query, Vite, Vitest, Playwright, lucide-react, existing CSS variables.

---

## File Map

- Create: `src/app/AppRouter.tsx` for route declarations and legacy/new workbench routing.
- Create: `src/app/WorkbenchShell.tsx` for desktop/mobile layout and shared workspace state.
- Create: `src/components/AsyncState.tsx` for loading, empty, retry, and error states.
- Create: `src/components/Modal.tsx`, `src/components/Toast.tsx`, `src/components/Button.tsx` for shared primitives extracted from `App.tsx`.
- Create: `src/features/chapters/ChapterNavigator.tsx`, `ChapterEditor.tsx`, `ChapterVersions.tsx`, `ChapterQualityPanel.tsx`.
- Create: `src/features/context/ContextDrawer.tsx`, `ContextSection.tsx`.
- Create: `src/features/quality/QualityPanel.tsx`, `QualityIssueList.tsx`.
- Create: `src/features/workbench/useWorkbench.ts`, `useChapterSession.ts`.
- Create: `src/lib/errors.ts`, `src/lib/format.ts`, `src/lib/keyboard.ts`.
- Modify: `src/main.tsx` to mount the new router/providers.
- Modify: `src/api.ts` to normalize JSON/API errors and expose typed request helpers.
- Modify: `src/App.tsx` to retain dashboard and legacy pages while delegating the new route to `AppRouter`.
- Modify: `src/styles.css` to add layout tokens, three-column desktop rules, drawer/bottom-nav mobile rules, and focus states.
- Modify: `e2e/workbench.spec.ts` to cover the new chapter-centered flow.
- Modify: `server/core.test.ts` only if an existing endpoint contract needs a regression assertion; no server behavior changes are expected.

### Task 1: Establish the application shell and shared primitives

**Files:**
- Create: `src/app/AppRouter.tsx`
- Create: `src/app/WorkbenchShell.tsx`
- Create: `src/components/AsyncState.tsx`
- Create: `src/components/Modal.tsx`
- Create: `src/components/Toast.tsx`
- Create: `src/components/Button.tsx`
- Modify: `src/main.tsx`, `src/App.tsx`, `src/styles.css`

- [ ] **Step 1: Add a failing route smoke test**

Extend `e2e/workbench.spec.ts` with a test that opens `/novel/<seed-id>/overview`, verifies the shell has a workbench landmark and a chapter navigation landmark, and verifies the legacy `/novel/<seed-id>/planning` route still renders its existing page heading.

- [ ] **Step 2: Run the focused test and verify the new assertion fails**

Run: `pnpm exec playwright test e2e/workbench.spec.ts --grep "chapter-centered shell"`

Expected: FAIL because no `workbench` landmark exists yet.

- [ ] **Step 3: Extract shared primitives and mount the shell**

Define `WorkbenchShellProps` as `{ novelId: string; view: string; children: React.ReactNode }`. Render `<main data-testid="workbench-shell">`, a top bar, `<nav aria-label="章节导航">`, a central `<section aria-label="当前章节工作区">`, and a mobile bottom navigation. `AppRouter` must preserve all existing view strings and render legacy views for `planning`, `canon`, `outline`, `timeline`, `publish`, and `settings`.

- [ ] **Step 4: Add the layout CSS**

Add `.workbench-shell` with `grid-template-columns: minmax(220px, 260px) minmax(0, 1fr)`, a collapsible `.context-drawer`, and a mobile media query at `max-width: 760px` that hides the desktop rail and shows `.mobile-workbench-nav`.

- [ ] **Step 5: Run the focused test and typecheck**

Run: `pnpm exec playwright test e2e/workbench.spec.ts --grep "chapter-centered shell"` and `pnpm run typecheck`.

Expected: PASS; typecheck exits with code 0.

- [ ] **Step 6: Commit the shell extraction**

Run: `git add src/app src/components src/main.tsx src/App.tsx src/styles.css e2e/workbench.spec.ts && git commit -m "refactor: add chapter-centered workbench shell"`.

### Task 2: Move API errors and workspace state into typed hooks

**Files:**
- Create: `src/lib/errors.ts`, `src/lib/format.ts`
- Create: `src/features/workbench/useWorkbench.ts`, `src/features/workbench/useChapterSession.ts`
- Modify: `src/api.ts`, `src/app/WorkbenchShell.tsx`, `shared/types.ts` only if a missing exported type is required.
- Test: `server/core.test.ts` for any changed API contract and `e2e/workbench.spec.ts` for retry behavior.

- [ ] **Step 1: Add the hook contract test**

Add a browser test that deliberately requests an unknown novel ID and expects a visible error state with a `重试` button, then navigates back to a valid seeded novel.

- [ ] **Step 2: Run the test and verify it fails**

Run: `pnpm exec playwright test e2e/workbench.spec.ts --grep "workbench retry"`

Expected: FAIL because errors are currently rendered inconsistently by individual pages.

- [ ] **Step 3: Implement typed hooks**

`useWorkbench(novelId)` should query `/novels/${novelId}/workspace`, return `{ data, isLoading, error, refetch }`, and never perform mutations. `useChapterSession(chapterId)` should query the chapter detail/version endpoints already used by `App.tsx`, expose `saveDraft`, `generateCandidate`, `stopGeneration`, `acceptCandidate`, and invalidate only the chapter/session query keys on success.

- [ ] **Step 4: Normalize API errors**

In `src/api.ts`, parse non-JSON responses safely and throw an `ApiError` containing `status`, `path`, and `message`. Add `requestJson<T>()` as the single internal implementation used by `api`, `post`, `patch`, and `remove`.

- [ ] **Step 5: Run tests and typecheck**

Run: `pnpm test -- server/core.test.ts`, `pnpm exec playwright test e2e/workbench.spec.ts --grep "workbench retry"`, and `pnpm run typecheck`.

- [ ] **Step 6: Commit the state layer**

Run: `git add src/api.ts src/lib src/features/workbench shared/types.ts e2e/workbench.spec.ts server/core.test.ts && git commit -m "refactor: centralize workbench state and API errors"`.

### Task 3: Implement chapter navigation and editor migration

**Files:**
- Create: `src/features/chapters/ChapterNavigator.tsx`, `src/features/chapters/ChapterEditor.tsx`
- Modify: `src/app/WorkbenchShell.tsx`, `src/features/workbench/useChapterSession.ts`, `src/styles.css`
- Test: `e2e/workbench.spec.ts`

- [ ] **Step 1: Add failing navigation/editor assertions**

Add tests that select a different chapter, verify its title appears in the editor, type into the draft, wait for the saved indicator, reload, and verify the draft is restored without changing the formal version count.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `pnpm exec playwright test e2e/workbench.spec.ts --grep "chapter navigation and draft recovery"`

Expected: FAIL because the new navigator/editor do not exist.

- [ ] **Step 3: Implement `ChapterNavigator`**

Render volumes/arcs/chapters from workspace data, use stable chapter IDs for buttons, expose `onSelect(chapterId)`, mark current, draft, quality-warning, and published states, and keep the selected chapter visible after navigation.

- [ ] **Step 4: Implement `ChapterEditor`**

Render title, chapter goal summary, textarea/editor content, word count, save state, and keyboard shortcut `Ctrl/Cmd+S`. Debounce `saveDraft` by 800ms; save only the recovery draft endpoint already used by the current application. Formal chapter versions must be changed only by explicit acceptance.

- [ ] **Step 5: Verify responsive behavior**

Add CSS so the editor has `min-width: 0`, the textarea cannot force horizontal overflow, and mobile controls remain fixed-size. Run the focused Playwright test at both `--project=chromium` and the configured mobile project.

- [ ] **Step 6: Commit chapter navigation/editor**

Run: `git add src/features/chapters src/app/WorkbenchShell.tsx src/features/workbench/useChapterSession.ts src/styles.css e2e/workbench.spec.ts && git commit -m "feat: add chapter navigator and draft editor"`.

### Task 4: Add versions, candidate comparison, and acceptance safety

**Files:**
- Create: `src/features/chapters/ChapterVersions.tsx`
- Modify: `src/features/chapters/ChapterEditor.tsx`, `src/features/workbench/useChapterSession.ts`, `src/app/WorkbenchShell.tsx`
- Test: `e2e/workbench.spec.ts`, `server/core.test.ts` if acceptance endpoint coverage is missing.

- [ ] **Step 1: Add failing candidate safety tests**

Cover: start generation, verify partial candidate text is visible, stop generation, verify current formal text remains unchanged, accept a completed candidate, verify the version history gains one version, and verify the diff view contains added/removed text.

- [ ] **Step 2: Run and verify failure**

Run: `pnpm exec playwright test e2e/workbench.spec.ts --grep "candidate safety"`

Expected: FAIL until candidate state and version panels are connected.

- [ ] **Step 3: Implement `ChapterVersions`**

Use the existing `diffChars` dependency to render candidate/formal/history tabs. Candidate actions must be explicit: `停止`, `重新生成`, `接受为正式版本`. Disable acceptance for failed candidates and for hard quality conflicts.

- [ ] **Step 4: Wire generation lifecycle**

Connect the existing streaming/polling behavior through `useChapterSession`. Store partial output in candidate state; invalidate versions only after acceptance; retain failed/stopped candidates with status labels.

- [ ] **Step 5: Run focused tests and unit tests**

Run: `pnpm exec playwright test e2e/workbench.spec.ts --grep "candidate safety"` and `pnpm test`.

- [ ] **Step 6: Commit candidate/version flow**

Run: `git add src/features/chapters src/features/workbench src/app/WorkbenchShell.tsx e2e/workbench.spec.ts server/core.test.ts && git commit -m "feat: make candidate acceptance version-safe"`.

### Task 5: Build the related-context drawer

**Files:**
- Create: `src/features/context/ContextDrawer.tsx`, `src/features/context/ContextSection.tsx`
- Modify: `src/app/WorkbenchShell.tsx`, `src/features/workbench/useWorkbench.ts`, `src/styles.css`
- Test: `e2e/workbench.spec.ts`

- [ ] **Step 1: Add failing context assertions**

Verify the current chapter shows related characters/facts/foreshadows/timeline entries, each section includes a source or updated timestamp, and mobile opens the same context through the bottom navigation without overlapping the editor.

- [ ] **Step 2: Run and verify failure**

Run: `pnpm exec playwright test e2e/workbench.spec.ts --grep "related context"`

Expected: FAIL until the drawer exists.

- [ ] **Step 3: Implement relevance filtering**

Derive related records from existing workspace arrays using chapter ID, arc ID, entity IDs, and text references already present in the response. Show a maximum of five summary items per section, with an explicit `查看全部` action opening the legacy detail page or modal.

- [ ] **Step 4: Implement desktop drawer and mobile sheet**

Desktop drawer is a non-overlay grid column; mobile is a focus-trapped sheet with close button, `aria-label`, and scroll containment. Do not duplicate the complete canon/timeline page inside the drawer.

- [ ] **Step 5: Run responsive tests and commit**

Run: `pnpm exec playwright test e2e/workbench.spec.ts --grep "related context"` and `pnpm run typecheck`.

Commit: `git add src/features/context src/app/WorkbenchShell.tsx src/features/workbench/useWorkbench.ts src/styles.css e2e/workbench.spec.ts && git commit -m "feat: add chapter-related context drawer"`.

### Task 6: Integrate quality checks and actionable issue navigation

**Files:**
- Create: `src/features/quality/QualityPanel.tsx`, `src/features/quality/QualityIssueList.tsx`
- Modify: `src/app/WorkbenchShell.tsx`, `src/features/chapters/ChapterEditor.tsx`, `src/features/chapters/ChapterVersions.tsx`
- Test: `e2e/workbench.spec.ts`, `server/core.test.ts` for preflight response regressions.

- [ ] **Step 1: Add failing quality-flow tests**

Verify hard conflicts, warnings, and style suggestions render with separate labels; hard conflicts disable candidate acceptance; clicking an issue focuses or selects the relevant editor text when a range is available.

- [ ] **Step 2: Run and verify failure**

Run: `pnpm exec playwright test e2e/workbench.spec.ts --grep "quality panel"`

Expected: FAIL until quality results are integrated into the workbench.

- [ ] **Step 3: Implement typed issue presentation**

Use existing `PreflightIssue` and `QualityIssue` types. Map severity to stable badges and expose `onIssueSelect(issue)`; do not infer severity from localized display text.

- [ ] **Step 4: Wire preflight and AI quality mutations**

Use the existing chapter quality endpoints. Keep results scoped by chapter ID, show last-run time, allow retry, and preserve results when a run fails. Acceptance checks the latest hard-conflict result before enabling the accept action.

- [ ] **Step 5: Run tests and commit**

Run: `pnpm exec playwright test e2e/workbench.spec.ts --grep "quality panel"`, `pnpm test`, and `pnpm run build`.

Commit: `git add src/features/quality src/features/chapters src/app/WorkbenchShell.tsx e2e/workbench.spec.ts server/core.test.ts && git commit -m "feat: integrate chapter quality checks"`.

### Task 7: Migrate auxiliary pages and complete responsive UX

**Files:**
- Modify: `src/app/AppRouter.tsx`, `src/app/WorkbenchShell.tsx`, existing planning/canon/outline/timeline/publish/settings components extracted from `src/App.tsx`, `src/styles.css`
- Test: `e2e/workbench.spec.ts`

- [ ] **Step 1: Add navigation regression tests**

Verify every legacy view remains reachable from the workbench `更多` menu and that browser back/forward preserves the selected view and chapter ID.

- [ ] **Step 2: Extract auxiliary page components**

Move one page at a time from `src/App.tsx` into feature files without changing API calls or visible behavior. Keep route parameters and mutation callbacks identical until the new shell links are verified.

- [ ] **Step 3: Add keyboard and focus behavior**

Implement `src/lib/keyboard.ts` for `Ctrl/Cmd+S`, `Escape` to close drawers/modals, and `Ctrl/Cmd+K` to focus global search. Ensure all icon-only buttons have accessible labels/tooltips.

- [ ] **Step 4: Run desktop/mobile regression suite**

Run: `pnpm exec playwright test`, `pnpm run typecheck`, and `pnpm run build`.

- [ ] **Step 5: Commit migration**

Run: `git add src/app src/features src/lib src/App.tsx src/styles.css e2e/workbench.spec.ts && git commit -m "refactor: migrate legacy pages behind workbench shell"`.

### Task 8: Final verification and cleanup

**Files:**
- Modify: `src/App.tsx`, `src/styles.css`, `README.md`, `progress.md`
- Test: `e2e/workbench.spec.ts`, `server/core.test.ts`

- [ ] **Step 1: Run the complete verification suite**

Run: `pnpm test`, `pnpm run typecheck`, `pnpm run build`, and `pnpm exec playwright test`.

Expected: all commands pass; no console error is emitted by the workbench tests.

- [ ] **Step 2: Remove only dead imports and duplicated primitives**

Use TypeScript/compiler errors and `rg` to remove components that are no longer referenced. Do not remove legacy page behavior or API endpoints.

- [ ] **Step 3: Update runbook documentation**

Update `README.md` with the new default chapter workflow, desktop/mobile navigation, and recovery behavior. Add completed migration notes to `progress.md`.

- [ ] **Step 4: Capture final screenshots**

Run the configured Playwright screenshot flow at desktop and mobile widths and inspect for overlap, clipped text, missing focus indicators, and unusable drawer states.

- [ ] **Step 5: Commit final verification changes**

Run: `git add src README.md progress.md e2e && git commit -m "test: verify redesigned workbench flow"`.

## Self-Review

- Spec coverage: shell, chapter-centered flow, responsive layout, context drawer, candidate safety, quality severity, legacy compatibility, errors, and staged migration are covered by Tasks 1-8.
- Placeholder scan: no `TODO`, `TBD`, “implement later”, or vague “add appropriate handling” steps are used.
- Type consistency: hooks use `novelId`, `chapterId`, `saveDraft`, `generateCandidate`, `stopGeneration`, and `acceptCandidate` consistently across tasks.
- Repository note: the current workspace has no `.git` directory, so commit commands are included for a normal implementation environment but cannot run until version control is initialized.

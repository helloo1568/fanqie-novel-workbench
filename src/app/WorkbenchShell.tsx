import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { Link, useLocation, useNavigate, type To } from "react-router-dom";
import { BookMarked, BookOpen, ChevronDown, ChevronLeft, Clock3, Ellipsis, GitBranch, LayoutDashboard, Library, ListTree, Loader2, Search, Send, Settings, X } from "lucide-react";
import AsyncState from "../components/AsyncState";
import { useGlobalGenerationStatus } from "../features/workbench/useChapterSession";
import { useWorkbench, type Workspace } from "../features/workbench/useWorkbench";
import { isEditableTarget, isEscapeKey, isSearchShortcut } from "../lib/keyboard";

export interface WorkbenchShellProps {
  novelId: string;
  view: string;
  children: ReactNode | ((workspace: Workspace) => ReactNode);
  header?: ReactNode;
  contextDrawer?: ReactNode | ((workspace: Workspace) => ReactNode);
  className?: string;
}

type ChapterFlush = () => Promise<void>;
const ChapterNavigationGuardContext = createContext<{
  registerChapterFlush: (flush: ChapterFlush | null) => void;
} | null>(null);

export function useChapterNavigationGuard() {
  const value = useContext(ChapterNavigationGuardContext);
  if (!value) throw new Error("章节导航保护必须在工作台壳层内使用");
  return value;
}

export function WorkbenchShell({ novelId, view, children, header, contextDrawer, className = "" }: WorkbenchShellProps) {
  const [contextOpen, setContextOpen] = useState(false);
  const [mobile, setMobile] = useState(false);
  const drawerRef = useRef<HTMLElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const searchBoxRef = useRef<HTMLDivElement | null>(null);
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeSearchIndex, setActiveSearchIndex] = useState(-1);
  const [navigationError, setNavigationError] = useState("");
  const chapterFlushRef = useRef<ChapterFlush | null>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const workspace = useWorkbench(novelId);
  const registerChapterFlush = useCallback((flush: ChapterFlush | null) => {
    chapterFlushRef.current = flush;
  }, []);
  const guardedNavigate = useCallback(async (to: To) => {
    setNavigationError("");
    if (view === "chapters" && chapterFlushRef.current) {
      try {
        await chapterFlushRef.current();
      } catch {
        setNavigationError("无法离开章节：恢复稿保存失败。请重试保存后再导航。");
        return false;
      }
    }
    void navigate(to);
    return true;
  }, [navigate, view]);
  const globalGenerations = useGlobalGenerationStatus();
  const activeGenerations = useMemo(
    () => globalGenerations.filter((entry) => entry.novelId === novelId && (entry.status === "starting" || entry.status === "streaming" || entry.status === "stopping")),
    [globalGenerations, novelId],
  );
  const goToGeneratingChapter = useCallback((chapterId: string) => {
    const next = new URLSearchParams(location.search);
    next.set("chapter", chapterId);
    void guardedNavigate({ pathname: `/novel/${novelId}/chapters`, search: `?${next.toString()}` });
  }, [guardedNavigate, location.search, novelId]);
  const primaryLinks = [
    ["overview", "总览", LayoutDashboard],
    ["chapters", "章节", BookOpen],
    ["planning", "策划", ListTree],
  ] as const;
  const secondaryLinks = [
    ["canon", "故事圣经", BookMarked],
    ["outline", "大纲", GitBranch],
    ["timeline", "伏笔时间线", Clock3],
    ["publish", "发布", Send],
    ["settings", "设置", Settings],
  ] as const;
  const links = [...primaryLinks, ...secondaryLinks] as const;
  const viewPath = (nextView: string) => {
    const params = new URLSearchParams(location.search);
    if (nextView !== "chapters") params.delete("chapter");
    const nextSearch = params.toString();
    return { pathname: `/novel/${novelId}/${nextView}`, search: nextSearch ? `?${nextSearch}` : "" };
  };
  const hasContext = contextDrawer !== undefined && contextDrawer !== null;
  const mobileContextOpen = mobile && contextOpen && hasContext;
  const content = workspace.data
    ? typeof children === "function" ? children(workspace.data) : children
    : null;
  const drawerContent = workspace.data && hasContext
    ? typeof contextDrawer === "function" ? contextDrawer(workspace.data) : contextDrawer
    : null;

  const openContext = useCallback((opener: HTMLElement) => {
    openerRef.current = opener;
    setContextOpen(true);
  }, []);
  const closeContext = useCallback(() => {
    setContextOpen(false);
    requestAnimationFrame(() => openerRef.current?.focus());
  }, []);

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if (!isSearchShortcut(event)) return;
      if (isEditableTarget(event.target) && event.target !== searchRef.current) return;
      event.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
      setSearchOpen(true);
    };
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);

  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (!searchBoxRef.current?.contains(event.target as Node)) {
        setSearchOpen(false);
        setActiveSearchIndex(-1);
      }
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, []);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 760px)");
    const update = () => setMobile(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    setContextOpen(false);
  }, [novelId, view, hasContext]);

  useEffect(() => {
    if (view !== "chapters") return;
    const bestEffortFlush = () => { void chapterFlushRef.current?.(); };
    window.addEventListener("pagehide", bestEffortFlush);
    window.addEventListener("beforeunload", bestEffortFlush);
    return () => {
      window.removeEventListener("pagehide", bestEffortFlush);
      window.removeEventListener("beforeunload", bestEffortFlush);
    };
  }, [view]);

  useEffect(() => {
    if (!contextOpen || !hasContext) return;
    const drawer = drawerRef.current;
    if (mobile) {
      if (!drawer) return;
      const previousOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      requestAnimationFrame(() => drawer?.querySelector<HTMLElement>("button, a, [tabindex]:not([tabindex='-1'])")?.focus());
      const keepFocusInside = (event: KeyboardEvent) => {
        if (isEscapeKey(event)) {
          event.preventDefault();
          closeContext();
          return;
        }
        if (event.key !== "Tab" || !drawer) return;
        const focusable = [...drawer.querySelectorAll<HTMLElement>("button:not(:disabled), a[href], [tabindex]:not([tabindex='-1'])")];
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!drawer.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first).focus(); }
        else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      };
      const keepProgrammaticFocusInside = (event: FocusEvent) => {
        if (!drawer.contains(event.target as Node)) {
          drawer.querySelector<HTMLElement>("button:not(:disabled), a[href], [tabindex]:not([tabindex='-1'])")?.focus();
        }
      };
      document.addEventListener("keydown", keepFocusInside);
      document.addEventListener("focusin", keepProgrammaticFocusInside);
      return () => {
        document.body.style.overflow = previousOverflow;
        document.removeEventListener("keydown", keepFocusInside);
        document.removeEventListener("focusin", keepProgrammaticFocusInside);
      };
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (isEscapeKey(event)) closeContext();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [closeContext, contextOpen, hasContext, mobile]);

  const normalizedSearch = search.trim().toLocaleLowerCase("zh-CN");
  const searchResults = workspace.data && normalizedSearch
    ? [
      ...links
        .filter(([, label]) => label.toLocaleLowerCase("zh-CN").includes(normalizedSearch))
        .map(([key, label]) => ({ key: `view-${key}`, label, to: viewPath(key) })),
      ...workspace.data.chapters
        .filter((chapter) => `${chapter.number} ${chapter.title}`.toLocaleLowerCase("zh-CN").includes(normalizedSearch))
        .slice(0, 8)
        .map((chapter) => {
          const params = new URLSearchParams(location.search);
          params.set("chapter", chapter.id);
          return { key: `chapter-${chapter.id}`, label: `第${chapter.number}章 ${chapter.title}`, to: { pathname: `/novel/${novelId}/chapters`, search: `?${params}` } };
        }),
    ]
    : [];
  const activeSearchId = activeSearchIndex >= 0 && activeSearchIndex < searchResults.length
    ? `workbench-search-option-${activeSearchIndex}`
    : undefined;
  const closeSearch = () => {
    setSearchOpen(false);
    setActiveSearchIndex(-1);
  };
  const onSearchKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (isEscapeKey(event.nativeEvent)) {
      event.preventDefault();
      setSearch("");
      closeSearch();
      event.currentTarget.blur();
      return;
    }
    if (!searchResults.length) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setSearchOpen(true);
      setActiveSearchIndex((current) => {
        if (event.key === "ArrowDown") return current < searchResults.length - 1 ? current + 1 : 0;
        return current > 0 ? current - 1 : searchResults.length - 1;
      });
      return;
    }
    if (event.key === "Enter" && activeSearchIndex >= 0) {
      event.preventDefault();
      const result = searchResults[activeSearchIndex];
      if (result) {
        setSearch("");
        closeSearch();
        void guardedNavigate(result.to);
      }
    }
  };
  const guardShellLink = (event: ReactMouseEvent<HTMLElement>) => {
    if (view !== "chapters" || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = (event.target as HTMLElement).closest<HTMLAnchorElement>("a[href]");
    if (!anchor || anchor.target === "_blank" || anchor.origin !== window.location.origin) return;
    const destination = `${anchor.pathname}${anchor.search}${anchor.hash}`;
    if (destination === `${location.pathname}${location.search}${location.hash}`) return;
    event.preventDefault();
    event.stopPropagation();
    setSearch("");
    closeSearch();
    void guardedNavigate(destination);
  };
  const moreMenu = () => <details className="workbench-more mobile">
    <summary aria-label="更多视图"><Ellipsis size={16}/><span>更多</span><ChevronDown size={12} className="more-caret"/></summary>
    <div className="workbench-more-menu">{secondaryLinks.map(([key, label]) => <Link aria-current={view === key ? "page" : undefined} className={view === key ? "active" : ""} key={key} to={viewPath(key)}>{label}</Link>)}</div>
  </details>;
  const viewLabel = links.find(([key]) => key === view)?.[1];

  return <ChapterNavigationGuardContext.Provider value={{ registerChapterFlush }}><main onClickCapture={guardShellLink} className={`workbench-shell chapter-centered-shell ${contextOpen && hasContext ? "context-open" : "context-closed"} ${className}`.trim()} data-testid="workbench-shell" data-novel-id={novelId} data-view={view}>
    <header className="workbench-header topbar" aria-hidden={mobileContextOpen || undefined} inert={mobileContextOpen || undefined}>
      <Link to="/" className="workbench-brand" title="返回作品书库"><span className="brand-mark"><BookOpen size={17}/></span><strong>长篇工坊</strong></Link>
      <Link to="/" className="workbench-back" title="返回作品书库" aria-label="返回作品书库"><ChevronLeft size={15}/><span>书库</span></Link>
      <div className="workbench-heading">{header ?? <><strong>{workspace.data?.novel.title ?? "章节工作台"}</strong>{viewLabel && <span className="crumb">/ {viewLabel}</span>}</>}</div>
      <div ref={searchBoxRef} className="workbench-global-search">
        <Search size={15} aria-hidden="true"/>
        <input
          ref={searchRef}
          type="search"
          role="combobox"
          value={search}
          onChange={(event) => { setSearch(event.target.value); setSearchOpen(true); setActiveSearchIndex(-1); }}
          onFocus={() => setSearchOpen(true)}
          onKeyDown={onSearchKeyDown}
          onBlur={(event) => {
            if (!searchBoxRef.current?.contains(event.relatedTarget as Node)) closeSearch();
          }}
          aria-label="全局搜索"
          aria-autocomplete="list"
          aria-expanded={Boolean(search && searchOpen)}
          aria-controls="workbench-search-results"
          aria-activedescendant={activeSearchId}
          placeholder="搜索章节与视图"
        />
        <span className="search-kbd" aria-hidden="true">Ctrl K</span>
        {search && <button className="btn icon" type="button" aria-label="清空搜索" title="清空搜索" onClick={() => { setSearch(""); closeSearch(); searchRef.current?.focus(); }}><X size={14}/></button>}
        {search && searchOpen && <div id="workbench-search-results" className="workbench-search-results" role="listbox" aria-label="搜索结果">{searchResults.length ? searchResults.map((result, index) => <Link id={`workbench-search-option-${index}`} role="option" aria-selected={activeSearchIndex === index} className={activeSearchIndex === index ? "active" : ""} key={result.key} to={result.to} onMouseDown={(event) => event.preventDefault()} onClick={() => { setSearch(""); closeSearch(); }}>{result.label}</Link>) : <span>没有匹配结果</span>}</div>}
      </div>
      {hasContext && <button className="context-drawer-toggle btn" type="button" aria-controls="chapter-context-drawer" aria-expanded={contextOpen} onClick={(event) => contextOpen ? closeContext() : openContext(event.currentTarget)}><Library size={15}/>{contextOpen ? "收起上下文" : "展开上下文"}</button>}
      {activeGenerations.length > 0 && <GenerationIndicator entries={activeGenerations} onJump={goToGeneratingChapter}/>}
    </header>
    {navigationError && <p className="chapter-switch-error workbench-navigation-error" role="alert">{navigationError}</p>}
    <div className="chapter-shell-layout">
      <nav aria-label="章节导航" className="chapter-shell-nav" aria-hidden={mobileContextOpen || undefined} inert={mobileContextOpen || undefined}>{links.map(([key, label, Icon]) => <Link aria-current={view === key ? "page" : undefined} className={view === key ? "active" : ""} key={key} to={viewPath(key)}><Icon size={15}/>{label}</Link>)}</nav>
      <section aria-label="当前章节工作区" className="chapter-shell-workspace" aria-hidden={mobileContextOpen || undefined} inert={mobileContextOpen || undefined}><AsyncState loading={workspace.isLoading} error={workspace.error} onRetry={() => void workspace.refetch()}>{content}</AsyncState></section>
      {hasContext && contextOpen && <>
        {mobile && <div className="context-sheet-backdrop" aria-hidden="true" onClick={closeContext}/>} 
        <aside
          ref={drawerRef}
          id="chapter-context-drawer"
          className="context-drawer is-open"
          aria-label="章节上下文"
          aria-modal={mobile || undefined}
          role={mobile ? "dialog" : "complementary"}
        >
          <div className="context-drawer-mobile-head"><strong>章节上下文</strong><button className="btn icon" type="button" aria-label="关闭章节上下文" onClick={closeContext}><X size={17}/></button></div>
          {drawerContent}
        </aside>
      </>}
    </div>
    <nav aria-label="章节导航" className="mobile-workbench-nav" aria-hidden={mobileContextOpen || undefined} inert={mobileContextOpen || undefined}>{primaryLinks.map(([key, label, Icon]) => <Link aria-current={view === key ? "page" : undefined} className={view === key ? "active" : ""} key={key} to={viewPath(key)}><Icon size={16}/><span>{label}</span></Link>)}{moreMenu()}{hasContext && <button type="button" aria-label="打开章节上下文" aria-controls="chapter-context-drawer" aria-expanded={contextOpen} className={contextOpen ? "active" : ""} onClick={(event) => contextOpen ? closeContext() : openContext(event.currentTarget)}><Library size={16}/><span>上下文</span></button>}</nav>
  </main></ChapterNavigationGuardContext.Provider>;
}

interface GenerationIndicatorProps {
  entries: { runId: string; chapterId: string; taskType: string; status: string; phase: string }[];
  onJump: (chapterId: string) => void;
}

function GenerationIndicator({ entries, onJump }: GenerationIndicatorProps) {
  const [expanded, setExpanded] = useState(false);
  if (!entries.length) return null;
  const label = entries.length === 1 ? "1 章生成中" : `${entries.length} 章生成中`;
  return <div className="generation-indicator" role="status" aria-live="polite">
    <button className="generation-indicator-btn" type="button" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
      <Loader2 size={13} className="generation-indicator-spinner" aria-hidden="true"/>
      <span>{label}</span>
    </button>
    {expanded && <ul className="generation-indicator-list">
      {entries.map((entry) => <li key={entry.runId}>
        <button type="button" onClick={() => { onJump(entry.chapterId); setExpanded(false); }}>
          <span className="generation-indicator-task">{entry.taskType}</span>
          <span className="generation-indicator-phase">{entry.phase}</span>
        </button>
      </li>)}
    </ul>}
  </div>;
}

export default WorkbenchShell;

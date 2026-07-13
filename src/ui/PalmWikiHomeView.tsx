import {
  ItemView,
  TFile,
  WorkspaceLeaf,
  type HoverParent,
  type HoverPopover,
  type ViewStateResult
} from "obsidian";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { filterPages } from "../core/filters/filterPages";
import type { PageRecord } from "../core/index/PageRecord";
import { normalizeSearchText } from "../core/search/normalizeText";
import { reversePinnedGroups, sortPagesAscending } from "../core/sort/sortPages";
import type PalmWikiHomePlugin from "../main";
import type { PalmWikiHomeIndexState } from "../main";
import type { SearchIndexState } from "../searchIndex";
import type {
  PalmWikiSortDirection,
  PalmWikiSortKey,
  PalmWikiViewMode
} from "../settings/Settings";
import { CardGrid } from "./CardGrid";
import { HomeToolbar, type LinkTargetSuggestion } from "./HomeToolbar";
import { PageTable } from "./PageTable";
import { HomeSearchBar } from "./HomeSearchBar";
import {
  DEFAULT_SEARCH_RESULT_LIMIT,
  MAX_SEARCH_RESULT_LIMIT,
  SearchResults
} from "./SearchResults";
import {
  canUseFullTextSearchIndex,
  createPalmWikiHomeSearchHost,
  shouldClearFullTextSearchResults
} from "../homeSearch";
import {
  findPalmWikiHomeScrollContainer,
  isPalmWikiHomeRenderRevisionCurrent,
  resolvePalmWikiHomeEphemeralScrollTop,
  shouldCompletePalmWikiScrollRestore
} from "../homeNavigation";
import {
  getFullTextQueryValidationError,
  limitFullTextQueryEditorInput,
  refreshFullTextSearchResultPages,
  type FullTextSearchResult
} from "../core/search/fullTextSearch";

export const PALMWIKI_HOME_VIEW_TYPE = "palmwiki-home-view";

export type PagePreviewHandler = (
  path: string,
  targetEl: HTMLElement,
  event: MouseEvent
) => void;

export class PalmWikiHomeView extends ItemView implements HoverParent {
  hoverPopover: HoverPopover | null = null;

  private plugin: PalmWikiHomePlugin;
  private root: Root | null = null;
  private searchHost: HTMLElement | null = null;
  private searchHostDocument: Document | null = null;
  private searchInput: HTMLInputElement | null = null;
  private savedState: PalmWikiHomeSavedViewState;
  private stateRevision = 0;
  private pendingScrollTop: number | null = null;
  private pendingScrollFrame: number | null = null;
  private pendingScrollWindow: Window | null = null;
  private pendingScrollContentReady = false;

  constructor(leaf: WorkspaceLeaf, plugin: PalmWikiHomePlugin) {
    super(leaf);
    this.plugin = plugin;
    this.navigation = true;
    this.savedState = createDefaultSavedViewState(plugin);
  }

  getViewType(): string {
    return PALMWIKI_HOME_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "PalmWiki Home";
  }

  getIcon(): string {
    return "home";
  }

  async onOpen(): Promise<void> {
    this.containerEl.addClass("palmwiki-home-container");
    this.contentEl.empty();
    this.contentEl.addClass("palmwiki-home-view");

    const rootEl = this.contentEl.createDiv({
      cls: "palmwiki-home-root"
    });

    this.root = createRoot(rootEl);
    this.plugin.syncHomeNavigationForLeaf(this.leaf);
    this.syncSearchHost();
    this.renderRoot();
    this.plugin.ensureIndexForView();
    this.plugin.ensureSearchIndexForView("view-open");
    this.restorePendingScroll();
  }

  async onClose(): Promise<void> {
    this.cancelPendingScrollFrame();
    this.plugin.removeHomeNavigationForLeaf(this.leaf);
    try {
      this.hoverPopover?.unload();
    } catch (error) {
      console.error("Could not close PalmWiki Home card preview", error);
    } finally {
      this.hoverPopover = null;
    }
    this.searchInput = null;
    this.root?.unmount();
    this.root = null;
    this.searchHost?.remove();
    this.searchHost = null;
    this.searchHostDocument = null;
    this.containerEl.removeClass("palmwiki-home-container");
    this.contentEl.removeClass("palmwiki-home-view");
  }

  getState(): Record<string, unknown> {
    return {
      ...super.getState(),
      ...this.savedState
    };
  }

  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    await super.setState(state, result);
    this.savedState = normalizeSavedViewState(state, this.plugin);
    this.stateRevision += 1;
    this.pendingScrollContentReady = false;
    this.renderRoot();
    this.restorePendingScroll();
  }

  getEphemeralState(): Record<string, unknown> {
    const scrollContainer = findPalmWikiHomeScrollContainer(this.containerEl);
    return {
      ...super.getEphemeralState(),
      scrollTop: resolvePalmWikiHomeEphemeralScrollTop(
        this.pendingScrollTop,
        scrollContainer?.scrollTop
      )
    };
  }

  setEphemeralState(state: unknown): void {
    super.setEphemeralState(state);
    const scrollTop = readNonNegativeNumber(state, "scrollTop");
    this.pendingScrollTop = scrollTop;
    this.pendingScrollContentReady = false;
    this.restorePendingScroll();
  }

  onResize(): void {
    super.onResize();
    this.syncSearchHost();
    this.restorePendingScroll();
  }

  syncSearchHost(): void {
    const ownerDocument = this.containerEl.ownerDocument;
    if (
      this.searchHost?.isConnected &&
      this.searchHost.ownerDocument === ownerDocument &&
      this.searchHostDocument === ownerDocument
    ) {
      return;
    }
    this.searchHost?.remove();
    this.searchHost = createPalmWikiHomeSearchHost(this.containerEl);
    this.searchHostDocument = this.searchHost?.ownerDocument ?? null;
    this.renderRoot();
  }

  focusSearch(): void {
    this.syncSearchHost();
    this.searchInput?.focus();
  }

  private renderRoot(): void {
    if (!this.root) {
      return;
    }
    const renderedRevision = this.stateRevision;
    this.root.render(
      <PalmWikiHomeRoot
        initialState={this.savedState}
        hoverParent={this}
        key={renderedRevision}
        leaf={this.leaf}
        onRegisterSearchInput={(input) => {
          this.searchInput = input;
        }}
        onContentRendered={(contentReady) => {
          if (
            isPalmWikiHomeRenderRevisionCurrent(
              renderedRevision,
              this.stateRevision
            )
          ) {
            this.restorePendingScroll(contentReady);
          }
        }}
        onStateChange={(state) => {
          this.savedState = state;
        }}
        plugin={this.plugin}
        searchHost={this.searchHost}
        stateRevision={this.stateRevision}
      />
    );
  }

  private restorePendingScroll(contentReady = false): void {
    if (this.pendingScrollTop === null || !this.root) {
      return;
    }
    const ownerWindow = this.containerEl.ownerDocument.defaultView;
    if (!ownerWindow) {
      return;
    }
    this.pendingScrollContentReady ||= contentReady;
    this.cancelPendingScrollFrame();
    const expectedScrollTop = this.pendingScrollTop;
    const canClampToAvailableContent = this.pendingScrollContentReady;
    this.pendingScrollWindow = ownerWindow;
    this.pendingScrollFrame = ownerWindow.requestAnimationFrame(() => {
      this.pendingScrollFrame = ownerWindow.requestAnimationFrame(() => {
        this.pendingScrollFrame = null;
        this.pendingScrollWindow = null;
        if (this.pendingScrollTop !== expectedScrollTop || !this.root) {
          return;
        }
        const scrollContainer = findPalmWikiHomeScrollContainer(this.containerEl);
        if (scrollContainer) {
          scrollContainer.scrollTop = expectedScrollTop;
          const maximumScrollTop = Math.max(
            0,
            scrollContainer.scrollHeight - scrollContainer.clientHeight
          );
          if (
            shouldCompletePalmWikiScrollRestore(
              expectedScrollTop,
              scrollContainer.scrollTop,
              maximumScrollTop,
              canClampToAvailableContent
            )
          ) {
            this.pendingScrollTop = null;
            this.pendingScrollContentReady = false;
          }
        }
      });
    });
  }

  private cancelPendingScrollFrame(): void {
    if (this.pendingScrollFrame === null) {
      return;
    }
    this.pendingScrollWindow?.cancelAnimationFrame(this.pendingScrollFrame);
    this.pendingScrollFrame = null;
    this.pendingScrollWindow = null;
  }
}

export interface PalmWikiHomeSavedViewState {
  stateVersion: 1;
  viewMode: PalmWikiViewMode;
  sortKey: PalmWikiSortKey;
  sortDirection: PalmWikiSortDirection;
  folderFilter: string;
  tagFilter: string;
  quickFilterQuery: string;
  linkTargetQuery: string;
  linkTargetPath: string;
  searchQuery: string;
  submittedSearchQuery: string;
  searchResultLimit: number;
}

interface PalmWikiHomeRootProps {
  hoverParent: HoverParent;
  initialState: PalmWikiHomeSavedViewState;
  leaf: WorkspaceLeaf;
  onContentRendered: (contentReady: boolean) => void;
  onRegisterSearchInput: (input: HTMLInputElement | null) => void;
  onStateChange: (state: PalmWikiHomeSavedViewState) => void;
  plugin: PalmWikiHomePlugin;
  searchHost: HTMLElement | null;
  stateRevision: number;
}

function PalmWikiHomeRoot({
  hoverParent,
  initialState,
  leaf,
  onContentRendered,
  onRegisterSearchInput,
  onStateChange,
  plugin,
  searchHost,
  stateRevision
}: PalmWikiHomeRootProps): React.JSX.Element {
  const [indexState, setIndexState] = useState<PalmWikiHomeIndexState>(
    plugin.getIndexState()
  );
  const [searchIndexState, setSearchIndexState] = useState<SearchIndexState>(
    plugin.getSearchIndexState()
  );
  const [viewMode, setViewMode] = useState<PalmWikiViewMode>(
    initialState.viewMode
  );
  const [sortKey, setSortKey] = useState<PalmWikiSortKey>(
    initialState.sortKey
  );
  const [sortDirection, setSortDirection] = useState<PalmWikiSortDirection>(
    initialState.sortDirection
  );
  const [folderFilter, setFolderFilter] = useState(initialState.folderFilter);
  const [tagFilter, setTagFilter] = useState(initialState.tagFilter);
  const [quickFilterQuery, setQuickFilterQuery] = useState(
    initialState.quickFilterQuery
  );
  const [linkTargetQuery, setLinkTargetQuery] = useState(
    initialState.linkTargetQuery
  );
  const [linkTargetPath, setLinkTargetPath] = useState(initialState.linkTargetPath);
  const [searchQuery, setSearchQuery] = useState(initialState.searchQuery);
  const [submittedSearchQuery, setSubmittedSearchQuery] = useState(
    initialState.submittedSearchQuery
  );
  const [searchResultLimit, setSearchResultLimit] = useState(
    initialState.searchResultLimit
  );
  const [unfilteredSearchResults, setUnfilteredSearchResults] = useState<
    FullTextSearchResult[]
  >([]);
  const [isSearching, setIsSearching] = useState(
    initialState.submittedSearchQuery.trim().length > 0
  );
  const searchGenerationRef = useRef(0);
  const imageUrlCacheRef = useRef<Map<string, string | undefined>>(new Map());
  const imageUrlCacheStatsRef = useRef<PageImageCacheStats>({
    hits: 0,
    misses: 0
  });
  const performanceDebug = plugin.settings.performanceDebug;

  const changeViewMode = useCallback(
    (mode: PalmWikiViewMode) => {
      plugin.logPerformance("view mode change", {
        from: viewMode,
        to: mode,
        indexedCount: indexState.pages.length
      });
      setViewMode(mode);
    },
    [indexState.pages.length, plugin, viewMode]
  );

  const changeSortKey = useCallback((key: PalmWikiSortKey) => {
    setSortKey(key);
  }, []);

  const changeSortDirection = useCallback((direction: PalmWikiSortDirection) => {
    setSortDirection(direction);
  }, []);

  const changeFolderFilter = useCallback((folder: string) => {
    setFolderFilter(folder);
  }, []);

  const changeTagFilter = useCallback((tag: string) => {
    setTagFilter(tag);
  }, []);

  const changeQuickFilterQuery = useCallback((nextQuery: string) => {
    setQuickFilterQuery(nextQuery);
  }, []);

  const changeLinkTargetQuery = useCallback((nextQuery: string) => {
    setLinkTargetPath("");
    setLinkTargetQuery(nextQuery);
  }, []);

  const selectLinkTarget = useCallback(
    (path: string) => {
      const selectedPage = indexState.pages.find((page) => page.path === path);
      setLinkTargetPath(path);
      setLinkTargetQuery(formatLinkTargetLabel(selectedPage, path));
    },
    [indexState.pages]
  );

  const clearLinkTarget = useCallback(() => {
    setLinkTargetPath("");
    setLinkTargetQuery("");
  }, []);

  useEffect(() => plugin.subscribeToIndex(setIndexState), [plugin]);
  useEffect(() => plugin.subscribeToSearchIndex(setSearchIndexState), [plugin]);

  useEffect(() => {
    setViewMode(initialState.viewMode);
    setSortKey(initialState.sortKey);
    setSortDirection(initialState.sortDirection);
    setFolderFilter(initialState.folderFilter);
    setTagFilter(initialState.tagFilter);
    setQuickFilterQuery(initialState.quickFilterQuery);
    setLinkTargetQuery(initialState.linkTargetQuery);
    setLinkTargetPath(initialState.linkTargetPath);
    setSearchQuery(initialState.searchQuery);
    setSubmittedSearchQuery(initialState.submittedSearchQuery);
    setSearchResultLimit(initialState.searchResultLimit);
    setUnfilteredSearchResults([]);
    setIsSearching(initialState.submittedSearchQuery.trim().length > 0);
  }, [initialState, stateRevision]);

  useEffect(() => {
    onStateChange({
      stateVersion: 1,
      viewMode,
      sortKey,
      sortDirection,
      folderFilter,
      tagFilter,
      quickFilterQuery,
      linkTargetQuery,
      linkTargetPath,
      searchQuery,
      submittedSearchQuery,
      searchResultLimit
    });
  }, [
    folderFilter,
    linkTargetPath,
    linkTargetQuery,
    onStateChange,
    quickFilterQuery,
    searchQuery,
    searchResultLimit,
    sortDirection,
    sortKey,
    submittedSearchQuery,
    tagFilter,
    viewMode
  ]);

  const availableFolders = useMemo(
    () => getUniqueValues(indexState.pages.map((page) => page.folder).filter(Boolean)),
    [indexState.pages]
  );

  const availableTags = useMemo(
    () => getUniqueValues(indexState.pages.flatMap((page) => page.tags)),
    [indexState.pages]
  );
  const linkTargetSuggestions = useMemo(
    () =>
      linkTargetPath
        ? []
        : getLinkTargetSuggestions(indexState.pages, linkTargetQuery),
    [indexState.pages, linkTargetPath, linkTargetQuery]
  );

  useEffect(() => {
    if (
      linkTargetPath &&
      !indexState.pages.some((page) => page.path === linkTargetPath)
    ) {
      setLinkTargetPath("");
      setLinkTargetQuery("");
    }
  }, [indexState.pages, linkTargetPath]);

  const filteredPages = useMemo(() => {
    const startedAt = performance.now();
    const filtered = filterPages(indexState.pages, {
      folder: folderFilter || undefined,
      linkTarget: linkTargetPath || undefined,
      tag: tagFilter || undefined,
      query: quickFilterQuery
    });

    plugin.logPerformance("filter", {
      ms: Math.round(performance.now() - startedAt),
      sourceCount: indexState.pages.length,
      resultCount: filtered.length,
      quickFilterQuery,
      folderFilter,
      linkTargetPath,
      tagFilter
    });

    return filtered;
  }, [
    folderFilter,
    indexState.pages,
    linkTargetPath,
    plugin,
    quickFilterQuery,
    tagFilter
  ]);
  const currentSearchResults = useMemo(
    () => refreshFullTextSearchResultPages(unfilteredSearchResults, indexState.pages),
    [indexState.pages, unfilteredSearchResults]
  );
  const searchResults = useMemo(() => {
    const allowedPaths = new Set(filteredPages.map((page) => page.path));
    return currentSearchResults.filter((result) =>
      allowedPaths.has(result.page.path)
    );
  }, [currentSearchResults, filteredPages]);
  const sortedPagesAsc = useMemo(() => {
    const startedAt = performance.now();
    const sorted = sortPagesAscending(filteredPages, sortKey);

    plugin.logPerformance("sort asc", {
      ms: Math.round(performance.now() - startedAt),
      count: sorted.length,
      sortKey
    });

    return sorted;
  }, [filteredPages, plugin, sortKey]);
  const visiblePages = useMemo(() => {
    const startedAt = performance.now();
    const pages =
      sortDirection === "asc" ? sortedPagesAsc : reversePinnedGroups(sortedPagesAsc);

    plugin.logPerformance("sort direction", {
      ms: Math.round(performance.now() - startedAt),
      count: pages.length,
      sortDirection
    });

    return pages;
  }, [plugin, sortDirection, sortedPagesAsc]);
  const canSearchIndex = canUseFullTextSearchIndex(searchIndexState);
  useEffect(() => {
    imageUrlCacheRef.current.clear();
    imageUrlCacheStatsRef.current = {
      hits: 0,
      misses: 0
    };
    plugin.logPerformance("image url cache reset", {
      lastIndexedAt: indexState.lastIndexedAt
    });
  }, [indexState.lastIndexedAt, plugin]);

  useEffect(() => {
    const generation = searchGenerationRef.current + 1;
    searchGenerationRef.current = generation;
    const normalizedQuery = submittedSearchQuery.trim();
    if (!normalizedQuery) {
      setUnfilteredSearchResults([]);
      setIsSearching(false);
      return;
    }
    if (getFullTextQueryValidationError(submittedSearchQuery)) {
      setUnfilteredSearchResults([]);
      setIsSearching(false);
      return;
    }

    if (shouldClearFullTextSearchResults(searchIndexState)) {
      setUnfilteredSearchResults([]);
      setIsSearching(false);
      return;
    }

    if (!canSearchIndex) {
      setIsSearching(true);
      if (searchIndexState.phase === "waiting") {
        plugin.ensureSearchIndexForView("search-submit");
      }
      return;
    }

    setIsSearching(true);
    const ownerWindow = leaf.view.containerEl.ownerDocument.defaultView;
    const timeout = ownerWindow?.setTimeout(() => {
      const results = plugin.searchPages(normalizedQuery);
      if (generation === searchGenerationRef.current) {
        setUnfilteredSearchResults(results);
        setIsSearching(false);
      }
    }, 0);

    return () => {
      if (timeout !== undefined) {
        ownerWindow?.clearTimeout(timeout);
      }
    };
  }, [
    indexState.lastIndexedAt,
    canSearchIndex,
    leaf,
    plugin,
    searchIndexState.indexedCount,
    searchIndexState.lastIndexedAt,
    searchIndexState.phase,
    submittedSearchQuery
  ]);

  const openCardPage = useCallback(
    (path: string) => {
      void plugin.openPageInLeaf(path, leaf);
    },
    [leaf, plugin]
  );

  const openSearchResult = useCallback(
    (result: FullTextSearchResult) => {
      void plugin.openSearchResultInLeaf(result, submittedSearchQuery, leaf);
    },
    [leaf, plugin, submittedSearchQuery]
  );

  const loadRawSearchSnippet = useCallback(
    (path: string, query: string) => plugin.getRawSearchSnippet(path, query),
    [plugin]
  );

  const openSearchSuggestion = useCallback(
    (path: string) => {
      void plugin.openPageInLeaf(path, leaf);
    },
    [leaf, plugin]
  );

  const submitSearch = useCallback(
    (nextQuery: string) => {
      const trimmed = nextQuery.trim();
      if (!trimmed) {
        return;
      }
      setSubmittedSearchQuery(trimmed);
      setSearchResultLimit(DEFAULT_SEARCH_RESULT_LIMIT);
      if (!getFullTextQueryValidationError(trimmed)) {
        plugin.ensureSearchIndexForView("search-submit");
      }
    },
    [plugin]
  );

  const clearSearch = useCallback(() => {
    searchGenerationRef.current += 1;
    setSearchQuery("");
    setSubmittedSearchQuery("");
    setSearchResultLimit(DEFAULT_SEARCH_RESULT_LIMIT);
    setUnfilteredSearchResults([]);
    setIsSearching(false);
  }, []);

  const createSearchPage = useCallback(
    (name: string) => {
      plugin.promptCreateSearchPage(name, leaf);
    },
    [leaf, plugin]
  );

  const openTablePage = useCallback(
    (path: string) => {
      void plugin.openPageInLeaf(path, leaf);
    },
    [leaf, plugin]
  );

  const previewCardPage = useCallback(
    (path: string, targetEl: HTMLElement, event: MouseEvent) => {
      plugin.previewCardPage(path, hoverParent, targetEl, event);
    },
    [hoverParent, plugin]
  );

  const togglePinned = useCallback(
    (path: string) => {
      void plugin.togglePinnedPage(path);
    },
    [plugin]
  );

  const refreshIndex = useCallback(() => {
    void plugin.rebuildIndex("toolbar");
    plugin.rebuildSearchIndex("toolbar");
  }, [plugin]);

  const resolveImageUrl = useCallback(
    (path: string | undefined): string | undefined => {
      if (!path) {
        return undefined;
      }

      if (imageUrlCacheRef.current.has(path)) {
        imageUrlCacheStatsRef.current.hits += 1;
        return imageUrlCacheRef.current.get(path);
      }

      imageUrlCacheStatsRef.current.misses += 1;

      const abstractFile = plugin.app.vault.getAbstractFileByPath(path);
      if (!(abstractFile instanceof TFile)) {
        imageUrlCacheRef.current.set(path, undefined);
        return undefined;
      }

      const resourceUrl = plugin.app.vault.getResourcePath(abstractFile);
      imageUrlCacheRef.current.set(path, resourceUrl);
      return resourceUrl;
    },
    [plugin]
  );

  const getImageCacheStats = useCallback(
    (): PageImageCacheStatsSnapshot => ({
      hits: imageUrlCacheStatsRef.current.hits,
      misses: imageUrlCacheStatsRef.current.misses,
      size: imageUrlCacheRef.current.size
    }),
    []
  );

  const isSearchMode = submittedSearchQuery.trim().length > 0;
  const searchQueryError = useMemo(
    () => getFullTextQueryValidationError(submittedSearchQuery),
    [submittedSearchQuery]
  );
  const createPageName = useMemo(
    () =>
      isSearchMode &&
      canSearchIndex &&
      !searchQueryError &&
      !plugin.hasExactVaultPageName(submittedSearchQuery)
        ? submittedSearchQuery.trim()
        : null,
    [
      canSearchIndex,
      indexState.lastIndexedAt,
      isSearchMode,
      plugin,
      searchQueryError,
      submittedSearchQuery
    ]
  );
  const contentReady = isSearchMode
    ? Boolean(searchQueryError) ||
      (!isSearching &&
        (searchIndexState.phase === "ready" || searchIndexState.phase === "error"))
    : !indexState.isIndexing && !indexState.indexDirty;

  useEffect(() => {
    onContentRendered(contentReady);
  }, [
    contentReady,
    onContentRendered,
    searchResultLimit,
    searchResults.length,
    viewMode,
    visiblePages.length
  ]);

  return (
    <>
      {searchHost
        ? createPortal(
            <HomeSearchBar
              getRecentPaths={() => plugin.app.workspace.getLastOpenFiles()}
              onClear={clearSearch}
              onOpenSuggestion={openSearchSuggestion}
              onQueryChange={setSearchQuery}
              onRegisterInput={onRegisterSearchInput}
              onSubmit={submitSearch}
              pages={indexState.pages}
              query={searchQuery}
            />,
            searchHost
          )
        : null}
      <div className="palmwiki-home-shell">
      <HomeToolbar
        availableFolders={availableFolders}
        availableTags={availableTags}
        folderFilter={folderFilter}
        indexState={indexState}
        searchIndexState={searchIndexState}
        linkTargetPath={linkTargetPath}
        linkTargetQuery={linkTargetQuery}
        linkTargetSuggestions={linkTargetSuggestions}
        onFolderFilterChange={changeFolderFilter}
        onLinkTargetClear={clearLinkTarget}
        onLinkTargetQueryChange={changeLinkTargetQuery}
        onLinkTargetSelect={selectLinkTarget}
        onQueryChange={changeQuickFilterQuery}
        onRefresh={refreshIndex}
        onSortDirectionChange={changeSortDirection}
        onSortKeyChange={changeSortKey}
        onTagFilterChange={changeTagFilter}
        onViewModeChange={changeViewMode}
        query={quickFilterQuery}
        resultCount={isSearchMode ? searchResults.length : visiblePages.length}
        sortDirection={sortDirection}
        sortKey={sortKey}
        tagFilter={tagFilter}
        totalCount={indexState.pages.length}
        viewMode={viewMode}
      />

      {indexState.lastError ? (
        <div className="palmwiki-state palmwiki-state-error">{indexState.lastError}</div>
      ) : null}

      {indexState.usingCachedIndex && indexState.indexPhase === "waiting" ? (
        <div className="palmwiki-state">
          Showing the saved index while the update waits for Obsidian to become idle.
        </div>
      ) : null}

      {indexState.indexPhase === "indexing" ? (
        <div className="palmwiki-state">
          {indexState.usingCachedIndex
            ? "Updating the index. Saved pages remain available while this finishes."
            : "Indexing pages..."}
        </div>
      ) : null}

      {!indexState.isIndexing && indexState.indexDirty && indexState.pages.length === 0 ? (
        <div className="palmwiki-state">
          Index will start after Obsidian finishes restoring tabs and becomes idle.
        </div>
      ) : null}

      {!indexState.isIndexing && !indexState.indexDirty && indexState.pages.length === 0 ? (
        <div className="palmwiki-state">
          No pages to display. Check include/exclude folder settings.
        </div>
      ) : null}

      {!isSearchMode &&
      !indexState.isIndexing &&
      indexState.pages.length > 0 &&
      visiblePages.length === 0 ? (
        <div className="palmwiki-state">No pages match the current filters.</div>
      ) : null}

      {isSearchMode &&
      !searchQueryError &&
      (searchIndexState.phase === "waiting" ||
        searchIndexState.phase === "loading" ||
        searchIndexState.phase === "indexing") ? (
        <div className="palmwiki-state">
          Preparing full-text search ({searchIndexState.processedCount.toLocaleString()} / {searchIndexState.totalCount.toLocaleString()})…
        </div>
      ) : null}

      {isSearchMode && searchIndexState.lastError ? (
        <div className="palmwiki-state palmwiki-state-error">
          {searchIndexState.lastError}
        </div>
      ) : null}

      {isSearchMode && searchQueryError ? (
        <div className="palmwiki-state palmwiki-state-error" role="alert">
          {searchQueryError}
        </div>
      ) : null}

      {searchIndexState.persistenceWarning ? (
        <div className="palmwiki-state" role="status">
          {searchIndexState.persistenceWarning}
        </div>
      ) : null}

      {isSearchMode && isSearching ? (
        <div className="palmwiki-state">Searching pages…</div>
      ) : null}

      {isSearchMode && canSearchIndex && !isSearching && !searchQueryError ? (
        <SearchResults
          createPageName={createPageName}
          limit={searchResultLimit}
          loadRawSnippet={loadRawSearchSnippet}
          onCreatePage={createSearchPage}
          onLoadMore={() =>
            setSearchResultLimit((current) =>
              Math.min(MAX_SEARCH_RESULT_LIMIT, current + 100)
            )
          }
          onOpenPage={openSearchResult}
          onPreviewPage={
            plugin.settings.cardPreviewMode === "off" ? undefined : previewCardPage
          }
          onTogglePinned={togglePinned}
          ownerDocument={searchHost?.ownerDocument ?? null}
          query={submittedSearchQuery}
          results={searchResults}
        />
      ) : null}

      {!isSearchMode && visiblePages.length > 0 && viewMode === "card" ? (
        <CardGrid
          cardSize={plugin.settings.cardSize}
          getImageCacheStats={getImageCacheStats}
          onOpenPage={openCardPage}
          onPreviewPage={
            plugin.settings.cardPreviewMode === "off" ? undefined : previewCardPage
          }
          onTogglePinned={togglePinned}
          pages={visiblePages}
          performanceDebug={performanceDebug}
          resolveImageUrl={resolveImageUrl}
          showFolders={plugin.settings.showFoldersOnCards}
          showTags={plugin.settings.showTagsOnCards}
        />
      ) : null}

      {!isSearchMode && visiblePages.length > 0 && viewMode === "table" ? (
        <PageTable
          getImageCacheStats={getImageCacheStats}
          onOpenPage={openTablePage}
          onTogglePinned={togglePinned}
          pages={visiblePages}
          performanceDebug={performanceDebug}
          resolveImageUrl={resolveImageUrl}
        />
      ) : null}
      </div>
    </>
  );
}

function getUniqueValues(values: string[]): string[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

function getLinkTargetSuggestions(
  pages: PageRecord[],
  query: string
): LinkTargetSuggestion[] {
  const tokens = normalizeSearchText(query)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);

  if (tokens.length === 0) {
    return [];
  }

  const suggestions: LinkTargetSuggestion[] = [];

  for (const page of pages) {
    if (!tokens.every((token) => page.filterText.includes(token))) {
      continue;
    }

    suggestions.push({
      folder: page.folder,
      path: page.path,
      title: page.title
    });

    if (suggestions.length >= 20) {
      break;
    }
  }

  return suggestions;
}

function formatLinkTargetLabel(page: PageRecord | undefined, path: string): string {
  if (!page) {
    return path;
  }

  return page.folder ? `${page.title} (${page.folder})` : page.title;
}

function createDefaultSavedViewState(
  plugin: PalmWikiHomePlugin
): PalmWikiHomeSavedViewState {
  return {
    stateVersion: 1,
    viewMode: plugin.settings.defaultViewMode,
    sortKey: plugin.settings.defaultSortKey,
    sortDirection: plugin.settings.defaultSortDirection,
    folderFilter: "",
    tagFilter: "",
    quickFilterQuery: "",
    linkTargetQuery: "",
    linkTargetPath: "",
    searchQuery: "",
    submittedSearchQuery: "",
    searchResultLimit: DEFAULT_SEARCH_RESULT_LIMIT
  };
}

function normalizeSavedViewState(
  value: unknown,
  plugin: PalmWikiHomePlugin
): PalmWikiHomeSavedViewState {
  const defaults = createDefaultSavedViewState(plugin);
  if (!isRecord(value)) {
    return defaults;
  }

  return {
    stateVersion: 1,
    viewMode: readEnum(value.viewMode, ["card", "table"], defaults.viewMode),
    sortKey: readEnum(
      value.sortKey,
      ["modified", "created", "title", "lines", "chars", "pageRank", "inlinks", "outlinks"],
      defaults.sortKey
    ),
    sortDirection: readEnum(
      value.sortDirection,
      ["asc", "desc"],
      defaults.sortDirection
    ),
    folderFilter: readString(value.folderFilter),
    tagFilter: readString(value.tagFilter),
    quickFilterQuery: readString(value.quickFilterQuery),
    linkTargetQuery: readString(value.linkTargetQuery),
    linkTargetPath: readString(value.linkTargetPath),
    searchQuery: limitFullTextQueryEditorInput(readString(value.searchQuery)),
    submittedSearchQuery: limitFullTextQueryEditorInput(
      readString(value.submittedSearchQuery)
    ),
    searchResultLimit: Math.min(
      MAX_SEARCH_RESULT_LIMIT,
      Math.max(
        DEFAULT_SEARCH_RESULT_LIMIT,
        Math.floor(
          readFiniteNumber(value.searchResultLimit, DEFAULT_SEARCH_RESULT_LIMIT)
        )
      )
    )
  };
}

function readNonNegativeNumber(value: unknown, key: string): number | null {
  if (!isRecord(value)) {
    return null;
  }
  const candidate = value[key];
  return typeof candidate === "number" && Number.isFinite(candidate) && candidate >= 0
    ? candidate
    : null;
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readEnum<const T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T
): T {
  return typeof value === "string" && allowed.includes(value as T)
    ? (value as T)
    : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type PageImageResolver = (path: string | undefined) => string | undefined;

interface PageImageCacheStats {
  hits: number;
  misses: number;
}

export interface PageImageCacheStatsSnapshot extends PageImageCacheStats {
  size: number;
}

export type PageImageCacheStatsGetter = () => PageImageCacheStatsSnapshot;

export type PageActionHandler = (path: string) => void;

export type { PageRecord };

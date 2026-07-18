import {
  MarkdownView,
  normalizePath,
  Notice,
  parseFrontMatterAliases,
  Plugin,
  TAbstractFile,
  TFile,
  type HoverParent,
  type ViewState,
  type WorkspaceLeaf
} from "obsidian";
import {
  buildPageIndex,
  IndexBuildCancelledError,
  type BuildPageIndexStats,
  type BodyMetadataCache
} from "./core/index/buildPageIndex";
import { passesFolderSettings } from "./core/filters/filterPages";
import type { PageRecord } from "./core/index/PageRecord";
import {
  createPersistentIndexCache,
  parsePersistentIndexCache
} from "./core/index/IndexCache";
import {
  canRunScheduledRebuild,
  mergeRebuildRequest,
  type RebuildRequest
} from "./core/index/RebuildRequest";
import { PalmWikiHomeSettingTab } from "./settings/SettingTab";
import {
  normalizeSettings,
  type PalmWikiHomeSettings
} from "./settings/Settings";
import { deriveIndexPhase, type IndexPhase } from "./core/index/IndexPhase";
import {
  createCardPreviewEventPayload,
  getCardPreviewSource
} from "./cardPreview";
import {
  HomeNavigationManager,
  resolveHomeButtonLabel,
  resolveMarkdownLeafPath,
  scrollPalmWikiHomeToTop
} from "./homeNavigation";
import { unregisterHoverLinkSourceCompat } from "./obsidianCompat";
import { PalmWikiHomeView, PALMWIKI_HOME_VIEW_TYPE } from "./ui/PalmWikiHomeView";
import {
  SearchIndexManager,
  type SearchIndexState
} from "./searchIndex";
import {
  findRawBodySearchMatch,
  getRawBodySearchSnippetFromMatch,
  MAX_DIRECT_RELATION_EDGE_VISITS_PER_TERM,
  MAX_TWO_HOP_RELATION_EDGE_VISITS_PER_TERM,
  parseFullTextQuery,
  searchFullText,
  type FullTextSearchDiagnostics,
  type RawBodySearchMatch,
  type FullTextSearchResult
} from "./core/search/fullTextSearch";
import { CreateSearchPageModal } from "./ui/CreateSearchPageModal";
import { normalizePageNameText } from "./core/search/titleSuggestions";
import {
  captureSearchPageCreationContext,
  clearPalmWikiHomeSearchState,
  createPalmWikiHomeSearchState,
  isPalmWikiHomeSearchActive,
  isSearchPageCreationContextCurrent
} from "./homeSearch";
import { MarkdownHeaderSearchManager, isMarkdownLeaf } from "./markdownHeaderSearch";
import { mountMarkdownHeaderSearch } from "./ui/MarkdownHeaderSearch";
import { DEFAULT_SEARCH_RESULT_LIMIT } from "./ui/SearchResults";

export interface PalmWikiHomeIndexState {
  indexPhase: IndexPhase;
  pages: PageRecord[];
  isIndexing: boolean;
  indexDirty: boolean;
  usingCachedIndex: boolean;
  lastIndexedAt: number | null;
  lastError: string | null;
}

export interface PalmWikiHomeDiagnostics {
  lastCacheLoad: Record<string, unknown> | null;
  lastIndexBuild: Record<string, unknown> | null;
  lastCacheSave: Record<string, unknown> | null;
}

type IndexListener = (state: PalmWikiHomeIndexState) => void;

interface RawSearchPreview {
  match: RawBodySearchMatch;
  snippet: string;
}

const OPEN_VIEW_REBUILD_DEBOUNCE_MS = 1500;
const VIEW_OPEN_IDLE_DELAY_MS = 750;
const STARTUP_IDLE_DELAY_MS = 3000;
const INDEX_IDLE_TIMEOUT_MS = 5000;
const CACHE_WRITE_DELAY_MS = 1000;
const CACHE_WRITE_IDLE_TIMEOUT_MS = 10000;
const BODY_READ_CONCURRENCY = 2;
const INDEX_CACHE_FILENAME = "index-cache.json";
const MAX_INDEX_CACHE_BYTES = 64 * 1024 * 1024;

export default class PalmWikiHomePlugin extends Plugin {
  settings: PalmWikiHomeSettings;

  private pages: PageRecord[] = [];
  private isIndexing = false;
  private indexDirty = true;
  private usingCachedIndex = false;
  private lastIndexedAt: number | null = null;
  private lastError: string | null = null;
  private diagnostics: PalmWikiHomeDiagnostics = {
    lastCacheLoad: null,
    lastIndexBuild: null,
    lastCacheSave: null
  };
  private indexListeners = new Set<IndexListener>();
  private bodyMetadataCache: BodyMetadataCache = new Map();
  private rebuildTimer: number | null = null;
  private rebuildIdleCallback: number | null = null;
  private rebuildSequence = 0;
  private indexInputGeneration = 0;
  private rebuildInProgress = false;
  private scheduledRebuild: RebuildRequest | null = null;
  private pendingRebuild: RebuildRequest | null = null;
  private cacheLoadPromise: Promise<void> | null = null;
  private cacheLoadGeneration = 0;
  private preparationPromise: Promise<void> | null = null;
  private automaticWorkGeneration = 0;
  private cacheHydrated = false;
  private cacheWriteTimer: number | null = null;
  private cacheWriteIdleCallback: number | null = null;
  private cacheWriteSequence = 0;
  private cacheWriteInProgress = false;
  private cacheWritePending = false;
  private layoutReady = false;
  private indexRequested = false;
  private indexEventsRegistered = false;
  private homeNavigation: HomeNavigationManager | null = null;
  private markdownHeaderSearch: MarkdownHeaderSearchManager | null = null;
  private searchIndex: SearchIndexManager | null = null;
  private searchIndexRequested = false;
  private searchNavigationGeneration = new WeakMap<WorkspaceLeaf, number>();
  private rawSearchPreviewCache = new Map<string, RawSearchPreview>();
  private rawSearchPreviewPromises = new Map<
    string,
    Promise<RawSearchPreview | null>
  >();
  private cardPreviewSourceId: string | null = null;
  private unloaded = false;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.syncCardPreviewSource();

    this.searchIndex = new SearchIndexManager({
      app: this.app,
      cacheDirectory: this.manifest.dir ?? null,
      getSettings: () => this.settings,
      isHomeActive: () => this.isHomeViewActive(),
      logPerformance: (label, data) => this.logPerformance(label, data)
    });

    this.homeNavigation = new HomeNavigationManager({
      getDisplayName: () =>
        resolveHomeButtonLabel(
          this.settings.homeButtonLabel,
          this.app.vault.getName()
        ),
      getMarkdownPath: (leaf) => resolveMarkdownLeafPath(this.app, leaf),
      isHomeSearchActive: (leaf) => this.isHomeSearchActive(leaf),
      onHomeActivate: (leaf) => {
        void this.activatePalmWikiHomeButton(leaf);
      },
      onMarkdownActivate: async (leaf) => {
        await this.openPalmWikiHomeInLeaf(leaf);
      },
      palmWikiHomeViewType: PALMWIKI_HOME_VIEW_TYPE
    });

    this.markdownHeaderSearch = new MarkdownHeaderSearchManager({
      getPages: () => this.pages,
      getRecentPaths: () => this.app.workspace.getLastOpenFiles(),
      mountSearch: mountMarkdownHeaderSearch,
      onFocus: () => this.ensureIndexForHeaderSearch(),
      onOpenSuggestion: (leaf, path) => {
        void this.openPageInLeaf(path, leaf);
      },
      onSubmit: (leaf, query) => {
        void this.openSearchInLeaf(query, leaf);
      }
    });

    this.registerView(
      PALMWIKI_HOME_VIEW_TYPE,
      (leaf) => new PalmWikiHomeView(leaf, this)
    );

    this.addRibbonIcon("home", "Open PalmWiki Home", () => {
      void this.openHomeView();
    });

    this.addCommand({
      id: "open-home",
      name: "Open home",
      callback: () => {
        void this.openHomeView();
      }
    });

    this.addCommand({
      id: "refresh-index",
      name: "Refresh index",
      callback: () => {
        void this.rebuildIndex("command");
      }
    });

    this.addCommand({
      id: "focus-search",
      name: "Focus search",
      callback: () => {
        void this.focusSearch();
      }
    });

    this.addSettingTab(new PalmWikiHomeSettingTab(this));
    this.registerHomeNavigationEvents();
    this.app.workspace.onLayoutReady(() => {
      if (this.unloaded) {
        return;
      }

      this.layoutReady = true;
      this.syncHomeNavigationButtons();
      this.registerIndexEvents();

      if (this.settings.indexOnStartup) {
        void this.prepareIndexForUse("startup", true);
      } else if (this.indexRequested || this.hasHomeViewOpen()) {
        void this.prepareIndexForUse("restored-view", false);
      }

      if (this.searchIndexRequested || this.hasHomeViewOpen()) {
        this.searchIndex?.requestReady("restored-view");
      }
    });
  }

  onunload(): void {
    this.unloaded = true;
    this.removeCardPreviewSource();
    this.markdownHeaderSearch?.removeAll();
    this.markdownHeaderSearch = null;
    this.homeNavigation?.removeAll();
    this.homeNavigation = null;
    this.searchIndex?.unload();
    this.searchIndex = null;
    this.searchNavigationGeneration = new WeakMap<WorkspaceLeaf, number>();
    this.rawSearchPreviewCache.clear();
    this.rawSearchPreviewPromises.clear();
    this.indexInputGeneration += 1;
    this.cacheLoadGeneration += 1;
    this.automaticWorkGeneration += 1;
    this.pendingRebuild = null;
    this.cancelScheduledRebuild();
    this.cancelScheduledCacheWrite();
  }

  async openHomeView(): Promise<void> {
    const existingLeaf = this.app.workspace.getLeavesOfType(PALMWIKI_HOME_VIEW_TYPE)[0];
    if (existingLeaf) {
      await this.app.workspace.revealLeaf(existingLeaf);
      this.app.workspace.setActiveLeaf(existingLeaf, { focus: true });
      this.syncHomeNavigationButtons();
      return;
    }

    const leaf = this.app.workspace.getLeaf(true);
    await leaf.setViewState({
      type: PALMWIKI_HOME_VIEW_TYPE,
      active: true
    });

    await this.app.workspace.revealLeaf(leaf);
    this.app.workspace.setActiveLeaf(leaf, { focus: true });
    this.syncHomeNavigationButtons();
  }

  async focusSearch(): Promise<void> {
    const activeHomeView = this.app.workspace.getActiveViewOfType(PalmWikiHomeView);
    if (activeHomeView) {
      this.ensureSearchIndexForView("focus-search");
      const ownerWindow = activeHomeView.containerEl.ownerDocument.defaultView;
      ownerWindow?.requestAnimationFrame(() => activeHomeView.focusSearch());
      return;
    }

    const activeLeaf = this.app.workspace.getMostRecentLeaf();
    if (activeLeaf && isMarkdownLeaf(activeLeaf)) {
      this.syncHomeNavigationButtons();
      if (this.markdownHeaderSearch?.focusLeaf(activeLeaf)) {
        return;
      }
      new Notice("Could not focus PalmWiki Home search in this note.");
      return;
    }

    await this.openHomeView();
    const view = this.app.workspace.getActiveViewOfType(PalmWikiHomeView);

    if (!view) {
      new Notice("Could not open PalmWiki Home search.");
      return;
    }

    this.ensureSearchIndexForView("focus-search");
    const ownerWindow = view.containerEl.ownerDocument.defaultView;
    ownerWindow?.requestAnimationFrame(() => view?.focusSearch());
  }

  ensureSearchIndexForView(reason: string): void {
    this.searchIndexRequested = true;
    if (this.layoutReady && !this.unloaded) {
      if (reason === "search-submit") {
        void this.searchIndex?.ensureReady(reason);
      } else {
        this.searchIndex?.requestReady(reason);
      }
    }
  }

  rebuildSearchIndex(reason: string): void {
    this.searchIndexRequested = true;
    this.searchIndex?.rebuildAll(reason);
  }

  getSearchIndexState(): SearchIndexState {
    return (
      this.searchIndex?.getState() ?? {
        phase: "waiting",
        indexedCount: 0,
        processedCount: 0,
        totalCount: 0,
        isUsingCachedIndex: false,
        lastIndexedAt: null,
        lastError: null,
        persistenceWarning: null
      }
    );
  }

  subscribeToSearchIndex(listener: (state: SearchIndexState) => void): () => void {
    return this.searchIndex?.subscribe(listener) ?? (() => undefined);
  }

  searchPages(query: string): FullTextSearchResult[] {
    const startedAt = performance.now();
    const searchDiagnostics: FullTextSearchDiagnostics = {
      directRelationEdgeVisits: 0,
      directRelationTermsCapped: 0,
      twoHopRelationEdgeVisits: 0,
      twoHopRelationTermsCapped: 0
    };
    const results = searchFullText(
      this.pages,
      this.searchIndex?.getDocuments() ?? [],
      query,
      searchDiagnostics
    );
    this.logPerformance("full-text search", {
      ms: Math.round(performance.now() - startedAt),
      pages: this.pages.length,
      documents: this.searchIndex?.getState().indexedCount ?? 0,
      resultCount: results.length,
      positiveTerms: parseFullTextQuery(query).positive.length,
      directRelationEdgeVisits: searchDiagnostics.directRelationEdgeVisits,
      twoHopRelationEdgeVisits: searchDiagnostics.twoHopRelationEdgeVisits,
      directRelationTermsCapped: searchDiagnostics.directRelationTermsCapped,
      twoHopRelationTermsCapped: searchDiagnostics.twoHopRelationTermsCapped,
      directRelationEdgeVisitCap: MAX_DIRECT_RELATION_EDGE_VISITS_PER_TERM,
      twoHopRelationEdgeVisitCap: MAX_TWO_HOP_RELATION_EDGE_VISITS_PER_TERM
    });
    return results;
  }

  async getRawSearchSnippet(path: string, query: string): Promise<string | undefined> {
    if (this.unloaded) {
      return undefined;
    }
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile) || file.extension.toLocaleLowerCase() !== "md") {
      return undefined;
    }
    return (await this.loadRawSearchPreview(file, query))?.snippet;
  }

  async openPage(path: string): Promise<void> {
    const abstractFile = this.app.vault.getAbstractFileByPath(path);
    if (!(abstractFile instanceof TFile)) {
      return;
    }

    await this.app.workspace.getLeaf(false).openFile(abstractFile);
  }

  async openPageInLeaf(path: string, leaf: WorkspaceLeaf): Promise<void> {
    this.bumpSearchNavigationGeneration(leaf);
    const abstractFile = this.app.vault.getAbstractFileByPath(path);
    if (
      !(abstractFile instanceof TFile) ||
      abstractFile.extension.toLocaleLowerCase() !== "md"
    ) {
      new Notice(`PalmWiki Home page not found: ${path}`);
      return;
    }

    await this.openMarkdownFileInLeaf(
      leaf,
      abstractFile,
      undefined,
      `Could not open PalmWiki Home page: ${path}`
    );
  }

  async openSearchInLeaf(query: string, leaf: WorkspaceLeaf): Promise<void> {
    if (this.unloaded || !isMarkdownLeaf(leaf)) {
      return;
    }
    const state = createPalmWikiHomeSearchState(query);
    if (!state.submittedSearchQuery) {
      return;
    }

    this.bumpSearchNavigationGeneration(leaf);
    await this.openPalmWikiHomeInLeaf(leaf, state);
  }

  async openSearchResultInLeaf(
    result: FullTextSearchResult,
    query: string,
    leaf: WorkspaceLeaf
  ): Promise<void> {
    if (this.unloaded) {
      return;
    }
    const sourceView = leaf.view;
    if (sourceView.getViewType() !== PALMWIKI_HOME_VIEW_TYPE) {
      return;
    }
    const navigationGeneration = this.bumpSearchNavigationGeneration(leaf);
    const sourceState = JSON.stringify(leaf.getViewState());
    const sourceWasMostRecent = this.app.workspace.getMostRecentLeaf() === leaf;
    const abstractFile = this.app.vault.getAbstractFileByPath(result.page.path);
    if (
      !(abstractFile instanceof TFile) ||
      abstractFile.extension.toLocaleLowerCase() !== "md"
    ) {
      new Notice(`PalmWiki Home search result not found: ${result.page.path}`);
      return;
    }

    let rawMatch: RawBodySearchMatch | null = null;
    if (result.firstBodyMatch) {
      rawMatch = (await this.loadRawSearchPreview(abstractFile, query))?.match ?? null;
    }

    if (
      this.unloaded ||
      this.searchNavigationGeneration.get(leaf) !== navigationGeneration ||
      leaf.view !== sourceView ||
      sourceView.getViewType() !== PALMWIKI_HOME_VIEW_TYPE ||
      JSON.stringify(leaf.getViewState()) !== sourceState ||
      (sourceWasMostRecent && this.app.workspace.getMostRecentLeaf() !== leaf)
    ) {
      return;
    }

    await this.openMarkdownFileInLeaf(
      leaf,
      abstractFile,
      rawMatch ? { line: rawMatch.line } : undefined,
      `Could not open PalmWiki Home search result: ${abstractFile.path}`
    );

    if (rawMatch) {
      this.revealSearchMatchInEditor(leaf, abstractFile, rawMatch);
    }
  }

  private bumpSearchNavigationGeneration(leaf: WorkspaceLeaf): number {
    const next = (this.searchNavigationGeneration.get(leaf) ?? 0) + 1;
    this.searchNavigationGeneration.set(leaf, next);
    return next;
  }

  private async loadRawSearchPreview(
    file: TFile,
    query: string
  ): Promise<RawSearchPreview | null> {
    const key = `${file.path}\0${file.stat.mtime}\0${file.stat.size}\0${query}`;
    const cached = this.rawSearchPreviewCache.get(key);
    if (cached) {
      return cached;
    }
    const existing = this.rawSearchPreviewPromises.get(key);
    if (existing) {
      return existing;
    }

    const snapshot = {
      path: file.path,
      mtime: file.stat.mtime,
      size: file.stat.size
    };
    const work = (async (): Promise<RawSearchPreview | null> => {
      try {
        const body = await this.app.vault.cachedRead(file);
        if (this.unloaded) {
          return null;
        }
        const current = this.app.vault.getAbstractFileByPath(file.path);
        if (
          !(current instanceof TFile) ||
          current.stat.mtime !== snapshot.mtime ||
          current.stat.size !== snapshot.size
        ) {
          return null;
        }
        const match = findRawBodySearchMatch(body, query);
        const snippet = match
          ? getRawBodySearchSnippetFromMatch(body, match)
          : null;
        if (!match || snippet === null) {
          return null;
        }
        const preview = { match, snippet };
        this.rawSearchPreviewCache.set(key, preview);
        while (this.rawSearchPreviewCache.size > 500) {
          let oldestKey: string | null = null;
          for (const cacheKey of this.rawSearchPreviewCache.keys()) {
            oldestKey = cacheKey;
            break;
          }
          if (oldestKey === null) {
            break;
          }
          this.rawSearchPreviewCache.delete(oldestKey);
        }
        return preview;
      } catch {
        return null;
      }
    })();
    this.rawSearchPreviewPromises.set(key, work);
    try {
      return await work;
    } finally {
      this.rawSearchPreviewPromises.delete(key);
    }
  }

  promptCreateSearchPage(
    name: string,
    leaf: WorkspaceLeaf
  ): void {
    const existingPage = this.findExactVaultMarkdownPage(name);
    if (existingPage) {
      void this.openPageInLeaf(existingPage.path, leaf);
      return;
    }

    const sourceView = leaf.view;
    if (sourceView.getViewType() !== PALMWIKI_HOME_VIEW_TYPE) {
      return;
    }
    const sourceContext = captureSearchPageCreationContext(
      sourceView,
      leaf.getViewState()
    );
    if (!sourceContext) {
      new Notice("Could not verify the PalmWiki Home tab for page creation.");
      return;
    }
    const sourceWasMostRecent = this.app.workspace.getMostRecentLeaf() === leaf;
    const navigationGeneration = this.bumpSearchNavigationGeneration(leaf);
    const isCurrentContext = (): boolean =>
      !this.unloaded &&
      this.searchNavigationGeneration.get(leaf) === navigationGeneration &&
      sourceView.getViewType() === PALMWIKI_HOME_VIEW_TYPE &&
      isSearchPageCreationContextCurrent(
        sourceContext,
        leaf.view,
        leaf.getViewState()
      ) &&
      (!sourceWasMostRecent || this.app.workspace.getMostRecentLeaf() === leaf);

    new CreateSearchPageModal(this.app, name, async (request) => {
      if (!isCurrentContext()) {
        new Notice("Page creation was cancelled because the PalmWiki Home tab changed.");
        return;
      }
      const currentExactPage = this.findExactVaultMarkdownPage(request.name);
      if (currentExactPage) {
        await this.openPageInLeaf(currentExactPage.path, leaf);
        return;
      }

      const existing = this.app.vault.getAbstractFileByPath(request.path);
      if (existing instanceof TFile && existing.extension.toLocaleLowerCase() === "md") {
        await this.openPageInLeaf(existing.path, leaf);
        return;
      }
      if (existing) {
        new Notice(`Cannot create a page because an item already exists at ${request.path}.`);
        return;
      }

      try {
        const created = await this.app.vault.create(request.path, "");
        if (isCurrentContext()) {
          await this.openPageInLeaf(created.path, leaf);
        } else {
          new Notice(
            `Created ${created.path}, but did not replace the changed PalmWiki Home tab.`
          );
        }
      } catch (error) {
        console.error("Could not create a PalmWiki Home search page", error);
        new Notice(`Could not create page: ${request.path}`);
      }
    }).open();
  }

  hasExactVaultPageName(name: string): boolean {
    return this.findExactVaultMarkdownPage(name) !== null;
  }

  private findExactVaultMarkdownPage(name: string): TFile | null {
    const expected = normalizePageNameText(name).trim();
    if (!expected) {
      return null;
    }

    for (const file of this.app.vault.getMarkdownFiles()) {
      const frontmatter: unknown = this.app.metadataCache.getFileCache(file)?.frontmatter;
      const frontmatterTitle = getFrontmatterTitle(frontmatter);
      const aliases = parseFrontMatterAliases(frontmatter) ?? [];
      const candidates = [
        file.basename,
        typeof frontmatterTitle === "string" ? frontmatterTitle : "",
        ...aliases
      ];
      if (
        candidates.some(
          (candidate) => normalizePageNameText(candidate).trim() === expected
        )
      ) {
        return file;
      }
    }

    return null;
  }

  private revealSearchMatchInEditor(
    leaf: WorkspaceLeaf,
    file: TFile,
    match: NonNullable<ReturnType<typeof findRawBodySearchMatch>>
  ): void {
    const view = leaf.view;
    if (!(view instanceof MarkdownView) || view.file?.path !== file.path) {
      return;
    }

    // Reading view receives the best-effort eState line above. Obsidian has no
    // stable public API for selecting arbitrary rendered text there.
    if (view.getMode() !== "source") {
      return;
    }

    const ownerWindow = view.containerEl.ownerDocument.defaultView;
    ownerWindow?.requestAnimationFrame(() => {
      if (leaf.view !== view || view.file?.path !== file.path) {
        return;
      }
      const from = { line: match.line, ch: match.fromCh };
      const to = { line: match.line, ch: match.toCh };
      try {
        view.editor.setSelection(from, to);
        view.editor.scrollIntoView({ from, to }, true);
      } catch {
        // The editor may still be swapping modes; the page itself stays open.
      }
    });
  }

  previewCardPage(
    path: string,
    hoverParent: HoverParent,
    targetEl: HTMLElement,
    event: MouseEvent
  ): void {
    const source = getCardPreviewSource(this.settings.cardPreviewMode);
    const abstractFile = this.app.vault.getAbstractFileByPath(path);
    if (
      !source ||
      source.id !== this.cardPreviewSourceId ||
      !(abstractFile instanceof TFile) ||
      abstractFile.extension.toLocaleLowerCase() !== "md"
    ) {
      return;
    }

    this.app.workspace.trigger(
      "hover-link",
      createCardPreviewEventPayload({
        event,
        hoverParent,
        path: abstractFile.path,
        source,
        targetEl
      })
    );
  }

  syncHomeNavigationForLeaf(leaf: WorkspaceLeaf): void {
    this.homeNavigation?.ensureLeaf(leaf);
    this.markdownHeaderSearch?.ensureLeaf(leaf);
  }

  removeHomeNavigationForLeaf(leaf: WorkspaceLeaf): void {
    this.markdownHeaderSearch?.removeLeaf(leaf);
    this.homeNavigation?.removeLeaf(leaf);
  }

  private async activatePalmWikiHomeButton(leaf: WorkspaceLeaf): Promise<void> {
    this.app.workspace.setActiveLeaf(leaf, { focus: true });
    const currentState = leaf.view.getState();

    if (this.isHomeSearchActive(leaf)) {
      const searchView = leaf.view as typeof leaf.view & {
        returnToHomeFromSearch?: () => boolean;
      };
      const returnedDirectly =
        typeof searchView.returnToHomeFromSearch === "function" &&
        searchView.returnToHomeFromSearch();
      if (!returnedDirectly) {
        await leaf.setViewState({
          ...leaf.getViewState(),
          type: PALMWIKI_HOME_VIEW_TYPE,
          active: true,
          state: clearPalmWikiHomeSearchState(
            currentState,
            DEFAULT_SEARCH_RESULT_LIMIT
          )
        });
        leaf.view.setEphemeralState({ scrollTop: 0 });
        this.syncHomeNavigationForLeaf(leaf);
      }
    }

    scrollPalmWikiHomeToTop(leaf.view.containerEl);
  }

  private isHomeSearchActive(leaf: WorkspaceLeaf): boolean {
    return (
      isPalmWikiHomeSearchActive(leaf.view.getState()) ||
      leaf.view.containerEl.querySelector(
        '[data-palmwiki-search-active="true"], .palmwiki-search-results'
      ) !== null
    );
  }

  private async openPalmWikiHomeInLeaf(
    leaf: WorkspaceLeaf,
    state?: Record<string, unknown>
  ): Promise<void> {
    const previousViewState = leaf.getViewState();
    const previousEphemeralState: unknown = leaf.getEphemeralState();

    try {
      await leaf.setViewState({
        type: PALMWIKI_HOME_VIEW_TYPE,
        active: true,
        ...(state ? { state } : {})
      });
      if (leaf.view.getViewType() !== PALMWIKI_HOME_VIEW_TYPE) {
        throw new Error("PalmWiki Home view type was not activated");
      }
      this.app.workspace.setActiveLeaf(leaf, { focus: true });
      this.syncHomeNavigationButtons();
    } catch (error) {
      console.error("Could not open PalmWiki Home in the current tab", error);
      await this.restoreLeafAfterNavigationFailure(
        leaf,
        previousViewState,
        previousEphemeralState
      );
      new Notice("Could not open PalmWiki Home in this tab.");
    }
  }

  private async openMarkdownFileInLeaf(
    leaf: WorkspaceLeaf,
    file: TFile,
    eState: Record<string, unknown> | undefined,
    failureNotice: string
  ): Promise<void> {
    const previousViewState = leaf.getViewState();
    const previousEphemeralState: unknown = leaf.getEphemeralState();

    try {
      await leaf.openFile(file, { active: true, eState });
      if (leaf.view.getViewType() !== "markdown") {
        throw new Error("Markdown view type was not activated");
      }
      this.app.workspace.setActiveLeaf(leaf, { focus: true });
      this.syncHomeNavigationButtons();
    } catch (error) {
      console.error(`Could not open Markdown page ${file.path}`, error);
      await this.restoreLeafAfterNavigationFailure(
        leaf,
        previousViewState,
        previousEphemeralState
      );
      new Notice(failureNotice);
    }
  }

  private async restoreLeafAfterNavigationFailure(
    leaf: WorkspaceLeaf,
    viewState: ViewState,
    ephemeralState: unknown
  ): Promise<void> {
    try {
      await leaf.setViewState(viewState, ephemeralState);
      this.app.workspace.setActiveLeaf(leaf, { focus: true });
    } catch (restoreError) {
      console.error("Could not restore the previous tab after navigation failed", restoreError);
    } finally {
      this.syncHomeNavigationButtons();
    }
  }

  private registerHomeNavigationEvents(): void {
    this.registerEvent(
      this.app.workspace.on("layout-change", () => {
        this.syncHomeNavigationButtons();
      })
    );
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        this.syncHomeNavigationButtons();
        if (leaf?.isDeferred) {
          void leaf
            .loadIfDeferred()
            .then(() => {
              if (!this.unloaded) {
                this.syncHomeNavigationButtons();
              }
            })
            .catch((error: unknown) => {
              console.error("Could not load the active deferred tab", error);
            });
        }
      })
    );
    this.registerEvent(
      this.app.workspace.on("file-open", () => {
        this.syncHomeNavigationButtons();
      })
    );
    this.registerEvent(
      this.app.workspace.on("window-open", (_workspaceWindow, ownerWindow) => {
        ownerWindow.requestAnimationFrame(() => {
          this.syncHomeNavigationButtons();
        });
      })
    );
    this.registerEvent(
      this.app.workspace.on("window-close", () => {
        this.syncHomeNavigationButtons();
      })
    );
  }

  private syncHomeNavigationButtons(): void {
    if (this.unloaded || !this.homeNavigation) {
      return;
    }

    const markdownLeaves = this.app.workspace.getLeavesOfType("markdown");
    this.homeNavigation.syncLeaves([
      ...markdownLeaves,
      ...this.app.workspace.getLeavesOfType(PALMWIKI_HOME_VIEW_TYPE)
    ]);
    this.markdownHeaderSearch?.syncLeaves(markdownLeaves);

    for (const leaf of this.app.workspace.getLeavesOfType(PALMWIKI_HOME_VIEW_TYPE)) {
      if (leaf.view instanceof PalmWikiHomeView) {
        leaf.view.syncSearchHost();
      }
    }
  }

  ensureIndexForView(): void {
    this.indexRequested = true;

    if (!this.cacheHydrated && !this.unloaded) {
      void this.hydrateIndexCache();
    }

    if (this.layoutReady && (this.indexDirty || this.pages.length === 0)) {
      void this.prepareIndexForUse("view-open", false);
    }
  }

  ensureIndexForHeaderSearch(): void {
    this.indexRequested = true;

    if (!this.cacheHydrated && !this.unloaded) {
      void this.hydrateIndexCache();
    }

    if (this.layoutReady && (this.indexDirty || this.pages.length === 0)) {
      void this.prepareIndexForUse(
        "header-search-focus",
        true,
        VIEW_OPEN_IDLE_DELAY_MS
      );
    }
  }

  getIndexState(): PalmWikiHomeIndexState {
    return {
      indexPhase: deriveIndexPhase({
        indexDirty: this.indexDirty,
        isIndexing: this.isIndexing,
        lastError: this.lastError
      }),
      pages: this.pages,
      isIndexing: this.isIndexing,
      indexDirty: this.indexDirty,
      usingCachedIndex: this.usingCachedIndex,
      lastIndexedAt: this.lastIndexedAt,
      lastError: this.lastError
    };
  }

  getDiagnostics(): PalmWikiHomeDiagnostics {
    return {
      lastCacheLoad: this.diagnostics.lastCacheLoad
        ? { ...this.diagnostics.lastCacheLoad }
        : null,
      lastIndexBuild: this.diagnostics.lastIndexBuild
        ? { ...this.diagnostics.lastIndexBuild }
        : null,
      lastCacheSave: this.diagnostics.lastCacheSave
        ? { ...this.diagnostics.lastCacheSave }
        : null
    };
  }

  subscribeToIndex(listener: IndexListener): () => void {
    this.indexListeners.add(listener);
    listener(this.getIndexState());

    return () => {
      this.indexListeners.delete(listener);
    };
  }

  scheduleIndexRebuild(
    reason: string,
    delayMs = OPEN_VIEW_REBUILD_DEBOUNCE_MS,
    allowBackground = false
  ): void {
    this.indexDirty = true;
    this.notifyIndexListeners();

    if (this.rebuildInProgress) {
      this.pendingRebuild = mergeRebuildRequest(this.pendingRebuild, {
        reason,
        allowBackground
      });
      return;
    }

    const scheduledRebuild = mergeRebuildRequest(this.scheduledRebuild, {
      reason,
      allowBackground
    });
    this.cancelScheduledRebuild();
    this.scheduledRebuild = scheduledRebuild;

    this.rebuildTimer = window.setTimeout(() => {
      this.rebuildTimer = null;
      this.rebuildIdleCallback = this.requestIdle(
        () => {
          this.rebuildIdleCallback = null;
          const scheduled = this.scheduledRebuild;
          this.scheduledRebuild = null;

          if (!scheduled) {
            return;
          }

          if (
            this.unloaded ||
            !canRunScheduledRebuild(scheduled, this.isHomeViewActive())
          ) {
            this.logPerformance("skip scheduled rebuild while inactive", {
              reason: scheduled.reason
            });
            this.notifyIndexListeners();
            return;
          }

          void this.rebuildIndex(scheduled.reason, scheduled.allowBackground);
        },
        INDEX_IDLE_TIMEOUT_MS
      );
    }, delayMs);
  }

  async rebuildIndex(_reason: string, allowBackground = true): Promise<void> {
    // Any real build supersedes pending automatic preparation. This prevents a
    // delayed view/startup task from scheduling a second build after a manual
    // refresh has already completed.
    this.automaticWorkGeneration += 1;
    this.cancelScheduledRebuild();
    this.cacheLoadGeneration += 1;
    this.cacheHydrated = true;

    this.indexDirty = true;

    if (this.rebuildInProgress) {
      this.pendingRebuild = mergeRebuildRequest(this.pendingRebuild, {
        reason: _reason,
        allowBackground
      });
      this.notifyIndexListeners();
      return;
    }

    const sequence = ++this.rebuildSequence;
    const inputGeneration = this.indexInputGeneration;
    this.rebuildInProgress = true;
    this.isIndexing = true;
    this.lastError = null;
    this.notifyIndexListeners();
    const startedAt = performance.now();
    const stats: BuildPageIndexStats = {
      bodyCacheHits: 0,
      bodyReads: 0,
      activeBodyReads: 0,
      maxConcurrentBodyReads: 0
    };

    try {
      const pages = await buildPageIndex(this.app, this.settings, {
        bodyMetadataCache: this.bodyMetadataCache,
        stats,
        concurrency: BODY_READ_CONCURRENCY,
        shouldAbort: () =>
          this.unloaded ||
          inputGeneration !== this.indexInputGeneration ||
          this.pendingRebuild !== null ||
          (!allowBackground && !this.isHomeViewActive())
      });

      if (
        sequence !== this.rebuildSequence ||
        this.unloaded ||
        inputGeneration !== this.indexInputGeneration ||
        this.pendingRebuild !== null
      ) {
        this.isIndexing = false;
        this.indexDirty = true;
        this.logPerformance("discard stale index build", {
          reason: _reason,
          pendingReason: this.pendingRebuild?.reason ?? null,
          inputChanged: inputGeneration !== this.indexInputGeneration,
          unloaded: this.unloaded
        });
        if (!this.unloaded) {
          this.notifyIndexListeners();
        }
        return;
      }

      await this.prunePinnedPages();
      if (this.unloaded || inputGeneration !== this.indexInputGeneration) {
        this.isIndexing = false;
        this.indexDirty = true;
        return;
      }

      this.pruneBodyMetadataCache();
      const currentPinnedPages = new Set(this.settings.pinnedPages);
      const publishedPages = pages.map((page) => ({
        ...page,
        pinned: currentPinnedPages.has(page.path)
      }));
      this.pages = publishedPages;
      this.isIndexing = false;
      this.indexDirty = false;
      this.usingCachedIndex = false;
      this.lastIndexedAt = Date.now();
      this.lastError = null;
      this.notifyIndexListeners();
      this.scheduleIndexCacheWrite();
      if (stats.graphBuild) {
        this.logPerformance("graph build", stats.graphBuild);
      }

      if (stats.pageRank) {
        this.logPerformance("page rank", stats.pageRank);
      }

      const indexBuildDiagnostics = {
        reason: _reason,
        ms: Math.round(performance.now() - startedAt),
        pages: publishedPages.length,
        bodyCacheHits: stats.bodyCacheHits,
        bodyReads: stats.bodyReads,
        bodyReadConcurrency: BODY_READ_CONCURRENCY,
        maxConcurrentBodyReads: stats.maxConcurrentBodyReads,
        pendingFollowUp: false
      };
      this.diagnostics.lastIndexBuild = indexBuildDiagnostics;
      this.logPerformance("index build", indexBuildDiagnostics);
    } catch (error) {
      if (sequence !== this.rebuildSequence || this.unloaded) {
        return;
      }

      this.isIndexing = false;
      this.indexDirty = true;
      if (error instanceof IndexBuildCancelledError) {
        this.logPerformance("cancel index build", {
          reason: _reason,
          inactive: !allowBackground && !this.isHomeViewActive(),
          inputChanged: inputGeneration !== this.indexInputGeneration,
          pendingReason: this.pendingRebuild?.reason ?? null
        });
      } else {
        this.lastError = error instanceof Error ? error.message : String(error);
      }
      this.notifyIndexListeners();
    } finally {
      if (sequence === this.rebuildSequence) {
        this.rebuildInProgress = false;
        if (!this.unloaded) {
          this.schedulePendingRebuildAfterCurrent();
        }
      }
    }
  }

  async updateSettings(
    patch: Partial<PalmWikiHomeSettings>,
    rebuildIndex: boolean
  ): Promise<void> {
    const previousSettings = this.settings;
    this.settings = normalizeSettings({
      ...this.settings,
      ...patch
    });
    if (previousSettings.cardPreviewMode !== this.settings.cardPreviewMode) {
      this.syncCardPreviewSource();
    }
    this.homeNavigation?.updateLabels();

    const searchScopeChanged = hasSearchScopeChanged(previousSettings, this.settings);
    if (searchScopeChanged) {
      this.rawSearchPreviewCache.clear();
      this.rawSearchPreviewPromises.clear();
      this.searchIndex?.handleScopeChange();
    }
    const indexScopeChanged = hasIndexScopeChanged(previousSettings, this.settings);
    if (indexScopeChanged) {
      this.indexInputGeneration += 1;
      this.cacheLoadGeneration += 1;
      this.indexDirty = true;
      this.pages = [];
      this.bodyMetadataCache.clear();
      this.usingCachedIndex = false;
      this.lastIndexedAt = null;
      this.cancelScheduledCacheWrite();

      if (this.rebuildInProgress) {
        this.pendingRebuild = mergeRebuildRequest(this.pendingRebuild, {
          reason: "settings-scope-changed",
          allowBackground: this.settings.indexOnStartup
        });
      }
    }

    if (patch.indexOnStartup === false) {
      this.automaticWorkGeneration += 1;
      this.cancelScheduledRebuild();

      if (this.rebuildInProgress) {
        this.indexInputGeneration += 1;
        this.indexDirty = true;
        this.pendingRebuild = this.isHomeViewActive()
          ? { reason: "startup-index-disabled", allowBackground: false }
          : null;
      }
    }

    await this.saveSettings();
    this.syncHomeNavigationButtons();
    this.notifyIndexListeners();

    if (
      patch.indexOnStartup === false &&
      !rebuildIndex &&
      !this.rebuildInProgress &&
      this.indexDirty &&
      this.isHomeViewActive()
    ) {
      void this.prepareIndexForUse("startup-index-disabled", false);
    }

    if (rebuildIndex) {
      if (patch.indexOnStartup === true) {
        void this.prepareIndexForUse("settings-index-on-startup", true);
      } else {
        this.requestIndexAfterChange("settings");
      }
    }
  }

  async togglePinnedPage(path: string): Promise<void> {
    const pinnedPages = new Set(this.settings.pinnedPages);

    if (pinnedPages.has(path)) {
      pinnedPages.delete(path);
    } else {
      pinnedPages.add(path);
    }

    this.settings = normalizeSettings({
      ...this.settings,
      pinnedPages: [...pinnedPages]
    });

    this.pages = this.pages.map((page) => ({
      ...page,
      pinned: this.settings.pinnedPages.includes(page.path)
    }));

    await this.saveSettings();
    this.notifyIndexListeners();
  }

  private async loadSettings(): Promise<void> {
    const loadedSettings: unknown = await this.loadData();
    this.settings = normalizeSettings(loadedSettings);
  }

  private async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  private syncCardPreviewSource(): void {
    const source = getCardPreviewSource(this.settings.cardPreviewMode);
    if (this.cardPreviewSourceId === source?.id) {
      return;
    }

    this.removeCardPreviewSource();
    if (!source) {
      return;
    }

    try {
      this.registerHoverLinkSource(source.id, source.info);
      this.cardPreviewSourceId = source.id;
    } catch (error) {
      console.error("Could not register PalmWiki Home Card preview", error);
    }
  }

  private removeCardPreviewSource(): void {
    if (!this.cardPreviewSourceId) {
      return;
    }
    unregisterHoverLinkSourceCompat(this.app.workspace, this.cardPreviewSourceId);
    this.cardPreviewSourceId = null;
  }

  private async prepareIndexForUse(
    reason: string,
    allowBackground: boolean,
    initialDelayMs?: number
  ): Promise<void> {
    this.indexRequested = true;
    const workGeneration = this.automaticWorkGeneration;

    if (!this.layoutReady || this.unloaded) {
      return;
    }

    if (this.preparationPromise) {
      await this.preparationPromise;

      if (
        this.unloaded ||
        workGeneration !== this.automaticWorkGeneration
      ) {
        return;
      }

      if (!this.cacheHydrated) {
        await this.hydrateIndexCache();
      }

      if (
        this.unloaded ||
        workGeneration !== this.automaticWorkGeneration ||
        !this.indexDirty ||
        (!allowBackground && !this.isHomeViewActive())
      ) {
        return;
      }

      this.scheduleIndexRebuild(reason, VIEW_OPEN_IDLE_DELAY_MS, allowBackground);
      return;
    }

    const delayMs =
      initialDelayMs ??
      (allowBackground ? STARTUP_IDLE_DELAY_MS : VIEW_OPEN_IDLE_DELAY_MS);
    this.preparationPromise = (async () => {
      await this.waitForPaintAndIdle(delayMs);
      if (this.unloaded || workGeneration !== this.automaticWorkGeneration) {
        return;
      }

      await this.hydrateIndexCache();
      if (
        this.unloaded ||
        workGeneration !== this.automaticWorkGeneration ||
        !this.indexDirty ||
        (!allowBackground && !this.isHomeViewActive())
      ) {
        return;
      }

      this.scheduleIndexRebuild(reason, VIEW_OPEN_IDLE_DELAY_MS, allowBackground);
    })();

    try {
      await this.preparationPromise;
    } finally {
      this.preparationPromise = null;
    }
  }

  private async waitForPaintAndIdle(delayMs: number): Promise<void> {
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          window.setTimeout(resolve, delayMs);
        });
      });
    });

    await new Promise<void>((resolve) => {
      this.requestIdle(resolve, INDEX_IDLE_TIMEOUT_MS);
    });
  }

  private async hydrateIndexCache(): Promise<void> {
    if (this.cacheHydrated) {
      return;
    }

    if (this.cacheLoadPromise) {
      await this.cacheLoadPromise;
      return;
    }

    this.cacheLoadPromise = this.loadIndexCacheFromDisk();

    try {
      await this.cacheLoadPromise;
    } finally {
      this.cacheHydrated = true;
      this.cacheLoadPromise = null;
    }
  }

  private async loadIndexCacheFromDisk(): Promise<void> {
    const loadGeneration = this.cacheLoadGeneration;
    const cachePath = this.getIndexCachePath();
    if (!cachePath) {
      return;
    }

    const startedAt = performance.now();

    try {
      if (!(await this.app.vault.adapter.exists(cachePath))) {
        return;
      }

      if (this.unloaded || loadGeneration !== this.cacheLoadGeneration) {
        return;
      }

      const cacheStat = await this.app.vault.adapter.stat(cachePath);
      if (this.unloaded || loadGeneration !== this.cacheLoadGeneration) {
        return;
      }

      if (cacheStat && cacheStat.size > MAX_INDEX_CACHE_BYTES) {
        this.logPerformance("index cache ignored", {
          reason: "cache-too-large",
          bytes: cacheStat.size
        });
        return;
      }

      const raw = await this.app.vault.adapter.read(cachePath);
      if (this.unloaded || loadGeneration !== this.cacheLoadGeneration) {
        return;
      }

      const cache = parsePersistentIndexCache(JSON.parse(raw), this.settings);
      if (!cache) {
        this.logPerformance("index cache ignored", {
          reason: "invalid-or-settings-mismatch"
        });
        return;
      }

      const filesByPath = new Map(
        this.app.vault
          .getMarkdownFiles()
          .filter((file) =>
            passesFolderSettings(
              file.path,
              this.settings.includeFolders,
              this.settings.excludeFolders
            )
          )
          .map((file) => [file.path, file])
      );
      const pinnedPages = new Set(this.settings.pinnedPages);
      const pages = cache.pages
        .filter((page) => filesByPath.has(page.path))
        .map((page) => ({ ...page, pinned: pinnedPages.has(page.path) }));
      const bodyMetadataCache: BodyMetadataCache = new Map();

      for (const [path, entry] of cache.bodyMetadataCache) {
        const file = filesByPath.get(path);
        if (
          file &&
          entry.mtime === file.stat.mtime &&
          entry.size === file.stat.size
        ) {
          bodyMetadataCache.set(path, entry);
        }
      }

      if (
        this.unloaded ||
        loadGeneration !== this.cacheLoadGeneration ||
        this.rebuildInProgress ||
        !this.indexDirty
      ) {
        return;
      }

      this.pages = pages;
      this.bodyMetadataCache = bodyMetadataCache;
      this.lastIndexedAt = cache.savedAt;
      this.indexDirty = true;
      this.usingCachedIndex = pages.length > 0;
      this.lastError = null;
      this.notifyIndexListeners();
      const cacheLoadDiagnostics = {
        ms: Math.round(performance.now() - startedAt),
        pages: pages.length,
        bodyEntries: bodyMetadataCache.size,
        bytes: raw.length
      };
      this.diagnostics.lastCacheLoad = cacheLoadDiagnostics;
      this.logPerformance("index cache loaded", cacheLoadDiagnostics);
    } catch (error) {
      if (this.unloaded || loadGeneration !== this.cacheLoadGeneration) {
        return;
      }

      this.logPerformance("index cache ignored", {
        reason: "cache-io-or-parse-error",
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private scheduleIndexCacheWrite(): void {
    this.cancelScheduledCacheWrite();
    const sequence = this.cacheWriteSequence;

    this.cacheWriteTimer = window.setTimeout(() => {
      this.cacheWriteTimer = null;
      this.cacheWriteIdleCallback = this.requestIdle(() => {
        this.cacheWriteIdleCallback = null;
        void this.writeIndexCacheToDisk(sequence);
      }, CACHE_WRITE_IDLE_TIMEOUT_MS);
    }, CACHE_WRITE_DELAY_MS);
  }

  private async writeIndexCacheToDisk(sequence: number): Promise<void> {
    if (
      sequence !== this.cacheWriteSequence ||
      this.unloaded ||
      this.indexDirty ||
      this.lastIndexedAt === null
    ) {
      return;
    }

    if (this.cacheWriteInProgress) {
      this.cacheWritePending = true;
      return;
    }

    const cachePath = this.getIndexCachePath();
    if (!cachePath) {
      return;
    }

    const startedAt = performance.now();
    this.cacheWriteInProgress = true;

    try {
      const payload = createPersistentIndexCache(
        this.settings,
        this.pages,
        this.bodyMetadataCache,
        this.lastIndexedAt
      );
      const serialized = JSON.stringify(payload);
      const byteLength = new Blob([serialized]).size;
      if (byteLength > MAX_INDEX_CACHE_BYTES) {
        this.logPerformance("index cache save skipped", {
          reason: "cache-too-large",
          bytes: byteLength
        });
        return;
      }

      if (
        sequence !== this.cacheWriteSequence ||
        this.unloaded ||
        this.indexDirty
      ) {
        return;
      }

      await this.app.vault.adapter.write(cachePath, serialized);
      if (!this.unloaded) {
        const cacheSaveDiagnostics = {
          ms: Math.round(performance.now() - startedAt),
          pages: this.pages.length,
          bodyEntries: this.bodyMetadataCache.size,
          bytes: byteLength,
          superseded: sequence !== this.cacheWriteSequence
        };
        this.diagnostics.lastCacheSave = cacheSaveDiagnostics;
        this.logPerformance("index cache saved", cacheSaveDiagnostics);
      }
    } catch (error) {
      if (!this.unloaded) {
        this.logPerformance("index cache save failed", {
          message: error instanceof Error ? error.message : String(error)
        });
      }
    } finally {
      this.cacheWriteInProgress = false;
      const shouldWriteLatest = this.cacheWritePending;
      this.cacheWritePending = false;

      if (
        shouldWriteLatest &&
        !this.unloaded &&
        !this.indexDirty &&
        this.lastIndexedAt !== null
      ) {
        this.scheduleIndexCacheWrite();
      }
    }
  }

  private getIndexCachePath(): string | null {
    return this.manifest.dir
      ? normalizePath(`${this.manifest.dir}/${INDEX_CACHE_FILENAME}`)
      : null;
  }

  private requestIdle(callback: () => void, timeout: number): number {
    if (typeof window.requestIdleCallback === "function") {
      return window.requestIdleCallback(callback, { timeout });
    }

    return window.setTimeout(callback, Math.min(timeout, 250));
  }

  private cancelIdle(handle: number): void {
    if (typeof window.cancelIdleCallback === "function") {
      window.cancelIdleCallback(handle);
    } else {
      window.clearTimeout(handle);
    }
  }

  private cancelScheduledRebuild(): void {
    if (this.rebuildTimer !== null) {
      window.clearTimeout(this.rebuildTimer);
      this.rebuildTimer = null;
    }

    if (this.rebuildIdleCallback !== null) {
      this.cancelIdle(this.rebuildIdleCallback);
      this.rebuildIdleCallback = null;
    }

    this.scheduledRebuild = null;
  }

  private cancelScheduledCacheWrite(): void {
    this.cacheWriteSequence += 1;

    if (this.cacheWriteTimer !== null) {
      window.clearTimeout(this.cacheWriteTimer);
      this.cacheWriteTimer = null;
    }

    if (this.cacheWriteIdleCallback !== null) {
      this.cancelIdle(this.cacheWriteIdleCallback);
      this.cacheWriteIdleCallback = null;
    }
  }

  private registerIndexEvents(): void {
    if (this.indexEventsRegistered) {
      return;
    }

    this.indexEventsRegistered = true;

    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        if (leaf?.view.getViewType() === PALMWIKI_HOME_VIEW_TYPE) {
          this.handleHomeViewActivated();
        }
      })
    );

    this.registerEvent(
      this.app.vault.on("create", (file) => {
        this.searchIndex?.handleFileCreateOrModify(file, "vault-create");
        this.handleMarkdownFileChange(file, "vault-create");
      })
    );

    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        this.searchIndex?.handleFileCreateOrModify(file, "vault-modify");
        this.handleMarkdownFileChange(file, "vault-modify");
      })
    );

    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        this.searchIndex?.handleFileDelete(file);
        if (file instanceof TFile && file.extension === "md") {
          this.bodyMetadataCache.delete(file.path);
          void this.removePinnedPath(file.path);
        }

        this.handleMarkdownFileChange(file, "vault-delete");
      })
    );

    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        this.syncHomeNavigationButtons();
        this.searchIndex?.handleFileRename(file, oldPath);
        if (file instanceof TFile && (file.extension === "md" || oldPath.endsWith(".md"))) {
          this.bodyMetadataCache.delete(oldPath);
          void this.migratePinnedPath(oldPath, file.path);
          this.requestIndexAfterChange("vault-rename");
        }
      })
    );

    this.registerEvent(
      this.app.metadataCache.on("changed", (file) => {
        this.handleMarkdownFileChange(file, "metadata-change");
      })
    );

    this.registerEvent(
      this.app.metadataCache.on("resolved", () => {
        this.requestIndexAfterChange("metadata-resolved");
      })
    );
  }

  private handleMarkdownFileChange(file: TAbstractFile, reason: string): void {
    if (file instanceof TFile && file.extension === "md") {
      this.requestIndexAfterChange(reason);
    }
  }

  private requestIndexAfterChange(reason: string): void {
    this.indexInputGeneration += 1;
    // The persisted pages are intentionally allowed to render stale before the
    // follow-up rebuild. Ordinary vault/metadata events must not abort an
    // in-flight cache read; current paths and body file snapshots are filtered
    // when the cache is applied. Manual builds, scope changes, and unload still
    // invalidate cache loading explicitly.
    this.indexDirty = true;
    this.cancelScheduledCacheWrite();

    if (this.rebuildInProgress) {
      this.pendingRebuild = mergeRebuildRequest(this.pendingRebuild, {
        reason,
        allowBackground: this.settings.indexOnStartup
      });
    }

    if (this.isHomeViewActive()) {
      if (this.cacheHydrated) {
        this.scheduleIndexRebuild(reason);
      } else {
        void this.prepareIndexForUse(reason, false);
      }
    } else {
      this.logPerformance("skip rebuild while inactive", { reason });
      this.notifyIndexListeners();
    }
  }

  private hasHomeViewOpen(): boolean {
    return this.app.workspace.getLeavesOfType(PALMWIKI_HOME_VIEW_TYPE).length > 0;
  }

  private isHomeViewActive(): boolean {
    return this.app.workspace.getActiveViewOfType(PalmWikiHomeView) !== null;
  }

  private handleHomeViewActivated(): void {
    this.logPerformance("view activated", {
      dirty: this.indexDirty,
      pages: this.pages.length,
      timestamp: Date.now()
    });

    this.ensureSearchIndexForView("active-view");

    if (!this.indexDirty) {
      return;
    }

    void this.prepareIndexForUse(
      this.pages.length === 0 ? "active-view-empty" : "active-view-dirty",
      false
    );
  }

  private schedulePendingRebuildAfterCurrent(): void {
    const pendingRebuild = this.pendingRebuild;
    this.pendingRebuild = null;

    if (!pendingRebuild) {
      return;
    }

    this.indexDirty = true;

    if (pendingRebuild.allowBackground || this.isHomeViewActive()) {
      this.scheduleIndexRebuild(
        pendingRebuild.reason,
        OPEN_VIEW_REBUILD_DEBOUNCE_MS,
        pendingRebuild.allowBackground
      );
    } else {
      this.notifyIndexListeners();
    }
  }

  logPerformance(label: string, data: Record<string, unknown>): void {
    if (!this.settings.performanceDebug) {
      return;
    }

    console.debug("[PalmWiki Home perf]", label, data);
  }

  private async migratePinnedPath(oldPath: string, newPath: string): Promise<void> {
    if (!this.settings.pinnedPages.includes(oldPath)) {
      return;
    }

    this.settings = normalizeSettings({
      ...this.settings,
      pinnedPages: this.settings.pinnedPages.map((path) =>
        path === oldPath ? newPath : path
      )
    });

    this.pages = this.pages.map((page) =>
      page.path === newPath ? { ...page, pinned: true } : page
    );

    await this.saveSettings();
    this.notifyIndexListeners();
  }

  private async removePinnedPath(path: string): Promise<void> {
    if (!this.settings.pinnedPages.includes(path)) {
      return;
    }

    this.settings = normalizeSettings({
      ...this.settings,
      pinnedPages: this.settings.pinnedPages.filter((pinnedPath) => pinnedPath !== path)
    });

    await this.saveSettings();
    this.notifyIndexListeners();
  }

  private async prunePinnedPages(): Promise<void> {
    if (this.unloaded) {
      return;
    }

    const markdownPaths = new Set(this.app.vault.getMarkdownFiles().map((file) => file.path));
    const pinnedPages = this.settings.pinnedPages.filter((path) => markdownPaths.has(path));

    if (pinnedPages.length === this.settings.pinnedPages.length) {
      return;
    }

    if (this.unloaded) {
      return;
    }

    this.settings = normalizeSettings({
      ...this.settings,
      pinnedPages
    });

    if (!this.unloaded) {
      await this.saveSettings();
    }
  }

  private pruneBodyMetadataCache(): void {
    const markdownPaths = new Set(
      this.app.vault
        .getMarkdownFiles()
        .filter((file) =>
          passesFolderSettings(
            file.path,
            this.settings.includeFolders,
            this.settings.excludeFolders
          )
        )
        .map((file) => file.path)
    );

    for (const path of this.bodyMetadataCache.keys()) {
      if (!markdownPaths.has(path)) {
        this.bodyMetadataCache.delete(path);
      }
    }
  }

  private notifyIndexListeners(): void {
    const state = this.getIndexState();
    this.markdownHeaderSearch?.updatePages(state.pages);

    for (const listener of this.indexListeners) {
      listener(state);
    }
  }
}

function hasIndexScopeChanged(
  previous: PalmWikiHomeSettings,
  next: PalmWikiHomeSettings
): boolean {
  return (
    JSON.stringify(previous.includeFolders) !== JSON.stringify(next.includeFolders) ||
    JSON.stringify(previous.excludeFolders) !== JSON.stringify(next.excludeFolders) ||
    JSON.stringify(previous.pageRankIgnoredSourceFolders) !==
      JSON.stringify(next.pageRankIgnoredSourceFolders) ||
    JSON.stringify(previous.pageRankIgnoredSourcePathPatterns) !==
      JSON.stringify(next.pageRankIgnoredSourcePathPatterns)
  );
}

function hasSearchScopeChanged(
  previous: PalmWikiHomeSettings,
  next: PalmWikiHomeSettings
): boolean {
  return (
    JSON.stringify(previous.includeFolders) !== JSON.stringify(next.includeFolders) ||
    JSON.stringify(previous.excludeFolders) !== JSON.stringify(next.excludeFolders)
  );
}

function getFrontmatterTitle(frontmatter: unknown): string {
  if (typeof frontmatter !== "object" || frontmatter === null) {
    return "";
  }
  const title = (frontmatter as Record<string, unknown>).title;
  return typeof title === "string" ? title : "";
}

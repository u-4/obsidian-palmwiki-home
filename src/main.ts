import {
  normalizePath,
  Notice,
  Plugin,
  TAbstractFile,
  TFile,
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
  getHomeButtonActionDescription,
  HomeNavigationManager,
  resolveExistingHomePage,
  resolveHomeButtonLabel,
  scrollPalmWikiHomeToTop
} from "./homeNavigation";
import { executeCommandByIdCompat, listCommandsCompat } from "./obsidianCompat";
import { PalmWikiHomeView, PALMWIKI_HOME_VIEW_TYPE } from "./ui/PalmWikiHomeView";

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
  private unloaded = false;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.homeNavigation = new HomeNavigationManager({
      getDisplayName: () =>
        resolveHomeButtonLabel(
          this.settings.homeButtonLabel,
          this.app.vault.getName()
        ),
      getMarkdownActionDescription: () => this.getHomeButtonActionDescription(),
      onHomeActivate: (leaf) => {
        this.app.workspace.setActiveLeaf(leaf, { focus: true });
        scrollPalmWikiHomeToTop(leaf.view.containerEl);
      },
      onMarkdownActivate: async (leaf, event) => {
        await this.activateMarkdownHomeButton(leaf, event);
      },
      palmWikiHomeViewType: PALMWIKI_HOME_VIEW_TYPE
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
    });
  }

  onunload(): void {
    this.unloaded = true;
    this.homeNavigation?.removeAll();
    this.homeNavigation = null;
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

  async openPage(path: string): Promise<void> {
    const abstractFile = this.app.vault.getAbstractFileByPath(path);
    if (!(abstractFile instanceof TFile)) {
      return;
    }

    await this.app.workspace.getLeaf(false).openFile(abstractFile);
  }

  async openPageInLeaf(path: string, leaf: WorkspaceLeaf): Promise<void> {
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

  syncHomeNavigationForLeaf(leaf: WorkspaceLeaf): void {
    this.homeNavigation?.ensureLeaf(leaf);
  }

  removeHomeNavigationForLeaf(leaf: WorkspaceLeaf): void {
    this.homeNavigation?.removeLeaf(leaf);
  }

  private getHomeButtonActionDescription(): string {
    let commandLabel = "";
    if (this.settings.homeButtonAction === "command") {
      const commandId = this.settings.homeButtonCommandId;
      commandLabel = commandId
        ? listCommandsCompat(this.app).find((command) => command.id === commandId)?.name ??
          commandId
        : "";
    }

    return getHomeButtonActionDescription(
      this.settings.homeButtonAction,
      this.settings.homeButtonPagePath,
      commandLabel
    );
  }

  private async activateMarkdownHomeButton(
    leaf: WorkspaceLeaf,
    event: MouseEvent
  ): Promise<void> {
    switch (this.settings.homeButtonAction) {
      case "page":
        await this.openConfiguredHomePage(leaf);
        return;
      case "command":
        this.runConfiguredHomeCommand(leaf, event);
        return;
      case "palmwikiHome":
      default:
        await this.openPalmWikiHomeInLeaf(leaf);
    }
  }

  private async openConfiguredHomePage(leaf: WorkspaceLeaf): Promise<void> {
    const configuredTarget = this.settings.homeButtonPagePath;
    if (!configuredTarget) {
      new Notice("Choose a home page in the PalmWiki Home settings.");
      return;
    }

    const sourceFile = (leaf.view as { file?: TFile | null }).file;
    const resolvedPage = resolveExistingHomePage(
      this.app,
      sourceFile instanceof TFile ? sourceFile.path : "",
      configuredTarget
    );
    if (!resolvedPage) {
      new Notice(`Home page not found: ${configuredTarget}`);
      return;
    }

    await this.openMarkdownFileInLeaf(
      leaf,
      resolvedPage.file,
      resolvedPage.subpath ? { subpath: resolvedPage.subpath } : undefined,
      `Could not open Home page: ${resolvedPage.file.path}`
    );
  }

  private runConfiguredHomeCommand(leaf: WorkspaceLeaf, event: MouseEvent): void {
    const commandId = this.settings.homeButtonCommandId;
    if (!commandId) {
      new Notice("Choose a home command in the PalmWiki Home settings.");
      return;
    }

    this.app.workspace.setActiveLeaf(leaf, { focus: true });
    const result = executeCommandByIdCompat(this.app, commandId, event);
    if (result === "executed") {
      return;
    }
    if (result === "unsupported") {
      new Notice("Obsidian command access is unavailable in this version.");
      return;
    }
    new Notice(`Home command is unavailable in the current context: ${commandId}`);
  }

  private async openPalmWikiHomeInLeaf(leaf: WorkspaceLeaf): Promise<void> {
    const previousViewState = leaf.getViewState();
    const previousEphemeralState: unknown = leaf.getEphemeralState();

    try {
      await leaf.setViewState({
        type: PALMWIKI_HOME_VIEW_TYPE,
        active: true
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

    this.homeNavigation.syncLeaves([
      ...this.app.workspace.getLeavesOfType("markdown"),
      ...this.app.workspace.getLeavesOfType(PALMWIKI_HOME_VIEW_TYPE)
    ]);
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
    this.homeNavigation?.updateLabels();

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

  private async prepareIndexForUse(
    reason: string,
    allowBackground: boolean
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

    const delayMs = allowBackground ? STARTUP_IDLE_DELAY_MS : VIEW_OPEN_IDLE_DELAY_MS;
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
        this.handleMarkdownFileChange(file, "vault-create");
      })
    );

    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        this.handleMarkdownFileChange(file, "vault-modify");
      })
    );

    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (file instanceof TFile && file.extension === "md") {
          this.bodyMetadataCache.delete(file.path);
          void this.removePinnedPath(file.path);
        }

        this.handleMarkdownFileChange(file, "vault-delete");
      })
    );

    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
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

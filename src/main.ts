import { Plugin, TAbstractFile, TFile } from "obsidian";
import {
  buildPageIndex,
  type BuildPageIndexStats,
  type BodyMetadataCache
} from "./core/index/buildPageIndex";
import type { PageRecord } from "./core/index/PageRecord";
import { PalmWikiHomeSettingTab } from "./settings/SettingTab";
import {
  DEFAULT_SETTINGS,
  normalizeLineList,
  normalizeFolderList,
  type PalmWikiHomeSettings
} from "./settings/Settings";
import { PalmWikiHomeView, PALMWIKI_HOME_VIEW_TYPE } from "./ui/PalmWikiHomeView";

export interface PalmWikiHomeIndexState {
  pages: PageRecord[];
  isIndexing: boolean;
  indexDirty: boolean;
  lastIndexedAt: number | null;
  lastError: string | null;
}

type IndexListener = (state: PalmWikiHomeIndexState) => void;

const OPEN_VIEW_REBUILD_DEBOUNCE_MS = 1500;
const BODY_READ_CONCURRENCY = 8;

export default class PalmWikiHomePlugin extends Plugin {
  settings: PalmWikiHomeSettings;

  private pages: PageRecord[] = [];
  private isIndexing = false;
  private indexDirty = true;
  private lastIndexedAt: number | null = null;
  private lastError: string | null = null;
  private indexListeners = new Set<IndexListener>();
  private bodyMetadataCache: BodyMetadataCache = new Map();
  private rebuildTimer: number | null = null;
  private rebuildSequence = 0;
  private rebuildInProgress = false;
  private pendingRebuildReason: string | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.registerView(
      PALMWIKI_HOME_VIEW_TYPE,
      (leaf) => new PalmWikiHomeView(leaf, this)
    );

    this.addRibbonIcon("home", "Open PalmWiki Home", () => {
      void this.openHomeView();
    });

    this.addCommand({
      id: "open-palmwiki-home",
      name: "Open PalmWiki Home",
      callback: () => {
        void this.openHomeView();
      }
    });

    this.addCommand({
      id: "refresh-palmwiki-home-index",
      name: "Refresh PalmWiki Home Index",
      callback: () => {
        void this.rebuildIndex("command");
      }
    });

    this.addSettingTab(new PalmWikiHomeSettingTab(this));
    this.registerIndexEvents();

    if (this.settings.indexOnStartup) {
      this.scheduleIndexRebuild("startup", 0);
    }
  }

  onunload(): void {
    if (this.rebuildTimer !== null) {
      window.clearTimeout(this.rebuildTimer);
    }

    this.app.workspace.detachLeavesOfType(PALMWIKI_HOME_VIEW_TYPE);
  }

  async openHomeView(): Promise<void> {
    const existingLeaf = this.app.workspace.getLeavesOfType(PALMWIKI_HOME_VIEW_TYPE)[0];
    if (existingLeaf) {
      await this.app.workspace.revealLeaf(existingLeaf);
      return;
    }

    const leaf = this.app.workspace.getLeaf(true);
    await leaf.setViewState({
      type: PALMWIKI_HOME_VIEW_TYPE,
      active: true
    });

    this.app.workspace.revealLeaf(leaf);
  }

  async openPage(path: string): Promise<void> {
    const abstractFile = this.app.vault.getAbstractFileByPath(path);
    if (!(abstractFile instanceof TFile)) {
      return;
    }

    await this.app.workspace.getLeaf(false).openFile(abstractFile);
  }

  ensureIndexForView(): void {
    if (this.indexDirty || this.pages.length === 0) {
      this.scheduleIndexRebuild("view-open", 0);
    }
  }

  getIndexState(): PalmWikiHomeIndexState {
    return {
      pages: this.pages,
      isIndexing: this.isIndexing,
      indexDirty: this.indexDirty,
      lastIndexedAt: this.lastIndexedAt,
      lastError: this.lastError
    };
  }

  subscribeToIndex(listener: IndexListener): () => void {
    this.indexListeners.add(listener);
    listener(this.getIndexState());

    return () => {
      this.indexListeners.delete(listener);
    };
  }

  scheduleIndexRebuild(reason: string, delayMs = OPEN_VIEW_REBUILD_DEBOUNCE_MS): void {
    this.indexDirty = true;
    this.notifyIndexListeners();

    if (this.rebuildInProgress) {
      this.pendingRebuildReason = reason;
      return;
    }

    if (this.rebuildTimer !== null) {
      window.clearTimeout(this.rebuildTimer);
    }

    this.rebuildTimer = window.setTimeout(() => {
      this.rebuildTimer = null;
      void this.rebuildIndex(reason);
    }, delayMs);
  }

  async rebuildIndex(_reason: string): Promise<void> {
    if (this.rebuildTimer !== null) {
      window.clearTimeout(this.rebuildTimer);
      this.rebuildTimer = null;
    }

    this.indexDirty = true;

    if (this.rebuildInProgress) {
      this.pendingRebuildReason = _reason;
      this.notifyIndexListeners();
      return;
    }

    const sequence = ++this.rebuildSequence;
    this.rebuildInProgress = true;
    this.isIndexing = true;
    this.lastError = null;
    this.notifyIndexListeners();
    const startedAt = performance.now();
    const stats: BuildPageIndexStats = {
      bodyCacheHits: 0,
      bodyReads: 0
    };

    try {
      const pages = await buildPageIndex(this.app, this.settings, {
        bodyMetadataCache: this.bodyMetadataCache,
        stats,
        concurrency: BODY_READ_CONCURRENCY
      });

      if (sequence !== this.rebuildSequence) {
        return;
      }

      await this.prunePinnedPages();
      this.pruneBodyMetadataCache();
      const hasPendingRebuild = this.pendingRebuildReason !== null;
      this.pages = pages;
      this.isIndexing = false;
      this.indexDirty = hasPendingRebuild;
      this.lastIndexedAt = Date.now();
      this.lastError = null;
      this.notifyIndexListeners();
      if (stats.graphBuild) {
        this.logPerformance("graph build", stats.graphBuild);
      }

      if (stats.pageRank) {
        this.logPerformance("page rank", stats.pageRank);
      }

      this.logPerformance("index build", {
        reason: _reason,
        ms: Math.round(performance.now() - startedAt),
        pages: pages.length,
        bodyCacheHits: stats.bodyCacheHits,
        bodyReads: stats.bodyReads,
        pendingFollowUp: hasPendingRebuild
      });
    } catch (error) {
      if (sequence !== this.rebuildSequence) {
        return;
      }

      this.isIndexing = false;
      this.indexDirty = true;
      this.lastError = error instanceof Error ? error.message : String(error);
      this.notifyIndexListeners();
    } finally {
      if (sequence === this.rebuildSequence) {
        this.rebuildInProgress = false;
        this.schedulePendingRebuildAfterCurrent();
      }
    }
  }

  async updateSettings(
    patch: Partial<PalmWikiHomeSettings>,
    rebuildIndex: boolean
  ): Promise<void> {
    this.settings = normalizeSettings({
      ...this.settings,
      ...patch
    });

    await this.saveSettings();
    this.notifyIndexListeners();

    if (rebuildIndex) {
      if (patch.indexOnStartup === true) {
        this.scheduleIndexRebuild("settings-index-on-startup", 0);
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
    this.settings = normalizeSettings({
      ...DEFAULT_SETTINGS,
      ...(await this.loadData())
    });
  }

  private async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  private registerIndexEvents(): void {
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
  }

  private handleMarkdownFileChange(file: TAbstractFile, reason: string): void {
    if (file instanceof TFile && file.extension === "md") {
      this.requestIndexAfterChange(reason);
    }
  }

  private requestIndexAfterChange(reason: string): void {
    this.indexDirty = true;

    if (this.isHomeViewActive()) {
      this.scheduleIndexRebuild(reason);
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

    if (this.pages.length === 0) {
      this.scheduleIndexRebuild("active-view-empty", 0);
      return;
    }

    window.requestAnimationFrame(() => {
      window.setTimeout(() => {
        if (this.indexDirty && this.isHomeViewActive()) {
          this.scheduleIndexRebuild("active-view-dirty", 250);
        }
      }, 0);
    });
  }

  private schedulePendingRebuildAfterCurrent(): void {
    const pendingReason = this.pendingRebuildReason;
    this.pendingRebuildReason = null;

    if (!pendingReason) {
      return;
    }

    this.indexDirty = true;

    if (this.isHomeViewActive()) {
      this.scheduleIndexRebuild(pendingReason);
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
    const markdownPaths = new Set(this.app.vault.getMarkdownFiles().map((file) => file.path));
    const pinnedPages = this.settings.pinnedPages.filter((path) => markdownPaths.has(path));

    if (pinnedPages.length === this.settings.pinnedPages.length) {
      return;
    }

    this.settings = normalizeSettings({
      ...this.settings,
      pinnedPages
    });

    await this.saveSettings();
  }

  private pruneBodyMetadataCache(): void {
    const markdownPaths = new Set(this.app.vault.getMarkdownFiles().map((file) => file.path));

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

function normalizeSettings(settings: PalmWikiHomeSettings): PalmWikiHomeSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    includeFolders: normalizeFolderList(settings.includeFolders ?? []),
    excludeFolders: normalizeFolderList(settings.excludeFolders ?? []),
    pinnedPages: Array.from(new Set(settings.pinnedPages ?? [])).filter(Boolean),
    pageRankIgnoredSourceFolders: normalizeFolderList(
      settings.pageRankIgnoredSourceFolders ?? []
    ),
    pageRankIgnoredSourcePathPatterns: normalizeLineList(
      settings.pageRankIgnoredSourcePathPatterns ?? []
    ),
    pageRankDebugPath: (settings.pageRankDebugPath ?? "").trim()
  };
}

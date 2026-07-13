import type { App, TAbstractFile, TFile } from "obsidian";
import { passesFolderSettings } from "./core/filters/filterPages";
import { mapWithConcurrency, matchesFileSnapshot } from "./core/index/buildPageIndex";
import {
  createPersistentSearchCache,
  createSearchCacheEntry,
  estimatePersistentSearchCacheBytesFromEntries,
  getUtf8ByteLength,
  isSearchCacheByteSizeWithinCap,
  parsePersistentSearchCache,
  selectReusableSearchCacheEntries,
  type SearchCacheEntry,
  type SearchFileSnapshot
} from "./core/search/searchCache";
import type { PalmWikiHomeSettings } from "./settings/Settings";

const SEARCH_CACHE_FILENAME = "search-cache.json";
const SEARCH_READ_CONCURRENCY = 2;
const SEARCH_REFRESH_DELAY_MS = 1500;
const SEARCH_INITIAL_DELAY_MS = 1500;
const SEARCH_REFRESH_IDLE_TIMEOUT_MS = 5000;
const SEARCH_CACHE_WRITE_DELAY_MS = 30_000;
const SEARCH_CACHE_WRITE_IDLE_TIMEOUT_MS = 10_000;
const SEARCH_CACHE_PURGE_WARNING =
  "PalmWiki Home could not remove the previous full-text search cache. Check the plugin folder before sharing or syncing it.";

export const SEARCH_INDEX_MAX_FILE_BYTES = 8 * 1024 * 1024;
export const SEARCH_INDEX_MAX_SOURCE_BYTES = 64 * 1024 * 1024;
export const SEARCH_INDEX_MAX_ESTIMATED_MEMORY_BYTES = 128 * 1024 * 1024;

const SEARCH_INDEX_FILE_CAP_ERROR =
  "Full-text search is limited to Markdown files of 8 MiB or less. Exclude the oversized file or folder from PalmWiki Home search.";
const SEARCH_INDEX_SOURCE_CAP_ERROR =
  "Full-text search is limited to 64 MiB of Markdown source in the selected folders. Narrow the include/exclude folder settings.";
const SEARCH_INDEX_MEMORY_CAP_ERROR =
  "Full-text search stopped before its estimated memory use exceeded 128 MiB. Narrow the include/exclude folder settings.";

class SearchIndexCapacityError extends Error {}

export type SearchIndexPhase =
  | "waiting"
  | "loading"
  | "indexing"
  | "ready"
  | "error";

export interface SearchIndexState {
  phase: SearchIndexPhase;
  indexedCount: number;
  processedCount: number;
  totalCount: number;
  isUsingCachedIndex: boolean;
  lastIndexedAt: number | null;
  lastError: string | null;
  persistenceWarning: string | null;
}

export interface SearchDocument {
  path: string;
  normalizedBody: string;
}

export interface SearchIndexDiagnostics {
  lastLoad: Record<string, unknown> | null;
  lastBuild: Record<string, unknown> | null;
  lastSave: Record<string, unknown> | null;
}

type SearchIndexListener = (state: SearchIndexState) => void;

export interface SearchIndexManagerOptions {
  app: App;
  cacheDirectory: string | null;
  getSettings: () => PalmWikiHomeSettings;
  isHomeActive: () => boolean;
  logPerformance: (label: string, data: Record<string, unknown>) => void;
}

export function getSearchIndexCapacityError(
  snapshots: Iterable<SearchFileSnapshot>,
  entries: Iterable<SearchCacheEntry> = []
): string | null {
  let sourceBytes = 0;
  for (const snapshot of snapshots) {
    if (
      !Number.isFinite(snapshot.size) ||
      snapshot.size < 0 ||
      snapshot.size > SEARCH_INDEX_MAX_FILE_BYTES
    ) {
      return SEARCH_INDEX_FILE_CAP_ERROR;
    }
    sourceBytes += snapshot.size;
    if (sourceBytes > SEARCH_INDEX_MAX_SOURCE_BYTES) {
      return SEARCH_INDEX_SOURCE_CAP_ERROR;
    }
  }

  if (!isSearchIndexEstimatedMemoryWithinCap(entries)) {
    return SEARCH_INDEX_MEMORY_CAP_ERROR;
  }
  return null;
}

export function estimateSearchCacheEntryMemoryBytes(entry: SearchCacheEntry): number {
  return 2 * (entry.path.length + entry.normalizedBody.length);
}

export function isSearchIndexEstimatedMemoryWithinCap(
  entries: Iterable<SearchCacheEntry>,
  cap = SEARCH_INDEX_MAX_ESTIMATED_MEMORY_BYTES
): boolean {
  if (!Number.isFinite(cap) || cap < 0) {
    return false;
  }
  let estimatedMemoryBytes = 0;
  for (const entry of entries) {
    estimatedMemoryBytes += estimateSearchCacheEntryMemoryBytes(entry);
    if (estimatedMemoryBytes > cap) {
      return false;
    }
  }
  return true;
}

/**
 * Owns the full-body search snapshot and its separate persistent cache.
 *
 * The manager never runs from a React render path. It loads lazily after a Home
 * view opens, reads changed files with bounded concurrency, and publishes a new
 * snapshot only after the refresh has finished.
 */
export class SearchIndexManager {
  private entries = new Map<string, SearchCacheEntry>();
  private listeners = new Set<SearchIndexListener>();
  private phase: SearchIndexPhase = "waiting";
  private totalCount = 0;
  private processedCount = 0;
  private isUsingCachedIndex = false;
  private lastIndexedAt: number | null = null;
  private lastError: string | null = null;
  private persistenceWarning: string | null = null;
  private diagnostics: SearchIndexDiagnostics = {
    lastLoad: null,
    lastBuild: null,
    lastSave: null
  };
  private hydrated = false;
  private requested = false;
  private unloaded = false;
  private generation = 0;
  private pendingRefreshReason: string | null = null;
  private activeWork: Promise<void> | null = null;
  private refreshTimer: number | null = null;
  private refreshIdleCallback: number | null = null;
  private writeTimer: number | null = null;
  private writeIdleCallback: number | null = null;
  private writeSequence = 0;
  private writeInProgress = false;
  private writePending = false;
  private cachePurgePending = false;
  private cachePurgePromise: Promise<void> | null = null;

  constructor(private options: SearchIndexManagerOptions) {}

  getState(): SearchIndexState {
    return {
      phase: this.phase,
      indexedCount: this.entries.size,
      processedCount: this.processedCount,
      totalCount: this.totalCount,
      isUsingCachedIndex: this.isUsingCachedIndex,
      lastIndexedAt: this.lastIndexedAt,
      lastError: this.lastError,
      persistenceWarning: this.persistenceWarning
    };
  }

  getDiagnostics(): SearchIndexDiagnostics {
    return {
      lastLoad: this.diagnostics.lastLoad ? { ...this.diagnostics.lastLoad } : null,
      lastBuild: this.diagnostics.lastBuild ? { ...this.diagnostics.lastBuild } : null,
      lastSave: this.diagnostics.lastSave ? { ...this.diagnostics.lastSave } : null
    };
  }

  getDocuments(): Iterable<SearchDocument> {
    return this.entries.values();
  }

  getDocumentBody(path: string): string | undefined {
    return this.entries.get(path)?.normalizedBody;
  }

  subscribe(listener: SearchIndexListener): () => void {
    this.listeners.add(listener);
    listener(this.getState());

    return () => {
      this.listeners.delete(listener);
    };
  }

  async ensureReady(reason: string): Promise<void> {
    this.requested = true;
    if (this.unloaded) {
      return;
    }

    if (this.cachePurgePending && !this.writeInProgress) {
      void this.flushPendingCachePurge();
    }
    if (
      this.phase === "ready" &&
      this.hydrated &&
      this.pendingRefreshReason === null
    ) {
      return;
    }

    this.cancelScheduledRefresh();
    const existingWork = this.activeWork;
    if (existingWork) {
      await existingWork;
      return;
    }

    const work = this.runWorkLoop(reason);
    this.activeWork = work;
    try {
      await work;
    } finally {
      if (this.activeWork === work) {
        this.activeWork = null;
      }
    }
  }

  requestReady(reason: string): void {
    this.requested = true;
    if (this.cachePurgePending && !this.writeInProgress) {
      void this.flushPendingCachePurge();
    }
    if (this.unloaded || this.phase === "ready") {
      return;
    }
    this.scheduleRefresh(reason, SEARCH_INITIAL_DELAY_MS);
  }

  rebuildAll(reason: string): void {
    this.generation += 1;
    this.pendingRefreshReason = reason;
    this.hydrated = true;
    this.entries.clear();
    this.totalCount = this.getEligibleFiles().length;
    this.processedCount = 0;
    this.isUsingCachedIndex = false;
    this.lastIndexedAt = null;
    this.lastError = null;
    this.persistenceWarning = null;
    this.phase = "waiting";
    this.cancelScheduledRefresh();
    this.purgePersistentCache();
    this.publish();

    if (!this.activeWork && this.requested && this.options.isHomeActive()) {
      this.scheduleRefresh(reason, 0, true);
    }
  }

  handleFileCreateOrModify(file: TAbstractFile, reason: string): void {
    if (!isMarkdownFile(file)) {
      return;
    }

    const settings = this.options.getSettings();
    if (!passesFolderSettings(file.path, settings.includeFolders, settings.excludeFolders)) {
      if (this.entries.delete(file.path)) {
        this.purgePersistentCache();
        this.markInputChanged(reason);
        this.totalCount = this.getEligibleFiles().length;
        this.processedCount = this.entries.size;
        this.phase = this.entries.size === this.totalCount ? "ready" : "waiting";
        if (this.entries.size === 0) {
          this.purgePersistentCache();
        } else {
          this.scheduleCacheWrite();
        }
        this.publish();
      }
      return;
    }
    if (reason === "vault-modify") {
      this.purgePersistentCache();
    }

    this.markInputChanged(reason);
    this.entries.delete(file.path);
    this.totalCount = this.getEligibleFiles().length;
    this.processedCount = this.entries.size;
    this.phase = "waiting";
    this.lastError = null;
    this.persistenceWarning = null;
    this.publish();
    if (!this.activeWork) {
      this.scheduleRefresh(reason);
    }
  }

  handleFileDelete(file: TAbstractFile): void {
    if (!isMarkdownFile(file)) {
      return;
    }

    const settings = this.options.getSettings();
    const wasEligible = passesFolderSettings(
      file.path,
      settings.includeFolders,
      settings.excludeFolders
    );
    if (!wasEligible && !this.entries.has(file.path)) {
      return;
    }

    this.markInputChanged("vault-delete");
    this.purgePersistentCache();
    const changed = this.entries.delete(file.path);
    this.totalCount = this.getEligibleFiles().length;
    this.processedCount = this.entries.size;
    this.phase = this.entries.size === this.totalCount ? "ready" : "waiting";
    this.lastIndexedAt = Date.now();
    if (this.entries.size > 0 && changed) {
      this.scheduleCacheWrite();
    }
    this.publish();
    if (!this.activeWork) {
      this.scheduleRefresh("vault-delete");
    }
  }

  handleFileRename(file: TAbstractFile, oldPath: string): void {
    const wasMarkdown = oldPath.toLocaleLowerCase().endsWith(".md");
    const isMarkdown = isMarkdownFile(file);
    if (!wasMarkdown && !isMarkdown) {
      return;
    }

    const settings = this.options.getSettings();
    const oldWasEligible =
      wasMarkdown &&
      passesFolderSettings(
        oldPath,
        settings.includeFolders,
        settings.excludeFolders
      );
    const newIsEligible =
      isMarkdown &&
      passesFolderSettings(
        file.path,
        settings.includeFolders,
        settings.excludeFolders
      );
    if (
      !oldWasEligible &&
      !newIsEligible &&
      !this.entries.has(oldPath) &&
      (!isMarkdown || !this.entries.has(file.path))
    ) {
      return;
    }

    this.markInputChanged("vault-rename");
    if (oldWasEligible || this.entries.has(oldPath)) {
      this.purgePersistentCache();
    }
    this.entries.delete(oldPath);
    if (isMarkdownFile(file)) {
      this.entries.delete(file.path);
    }
    this.totalCount = this.getEligibleFiles().length;
    this.processedCount = this.entries.size;
    this.phase = "waiting";
    this.lastError = null;
    this.publish();
    if (!this.activeWork) {
      this.scheduleRefresh("vault-rename");
    }
  }

  handleScopeChange(): void {
    this.generation += 1;
    this.pendingRefreshReason = "settings-scope-changed";
    this.hydrated = false;
    this.entries.clear();
    this.totalCount = 0;
    this.processedCount = 0;
    this.isUsingCachedIndex = false;
    this.lastIndexedAt = null;
    this.lastError = null;
    this.phase = "waiting";
    this.cancelScheduledRefresh();
    this.purgePersistentCache();
    this.publish();

    if (!this.activeWork && this.requested && this.options.isHomeActive()) {
      this.scheduleRefresh("settings-scope-changed", 0);
    }
  }

  unload(): void {
    this.unloaded = true;
    this.generation += 1;
    this.cancelScheduledRefresh();
    this.cancelScheduledWrite();
    this.listeners.clear();
  }

  private async runWorkLoop(initialReason: string): Promise<void> {
    let reason = initialReason;

    while (!this.unloaded) {
      const generation = this.generation;
      this.pendingRefreshReason = null;
      await this.prepareSnapshot(reason, generation);
      if (this.unloaded || generation === this.generation) {
        return;
      }

      reason = this.pendingRefreshReason ?? "search-input-changed";
    }
  }

  private async prepareSnapshot(reason: string, generation: number): Promise<void> {
    try {
      if (!this.hydrated) {
        await this.hydrate(generation);
      }
      if (this.shouldAbort(generation)) {
        return;
      }

      await this.refreshEntries(reason, generation);
    } catch (error) {
      if (this.shouldAbort(generation)) {
        return;
      }

      this.phase = "error";
      this.lastError = error instanceof Error ? error.message : String(error);
      this.publish();
    }
  }

  private async hydrate(generation: number): Promise<void> {
    const startedAt = performance.now();
    this.phase = "loading";
    this.lastError = null;
    this.publish();

    const files = this.getEligibleFiles();
    const snapshots = files.map(toFileSnapshot);
    this.totalCount = snapshots.length;
    this.throwIfCapacityExceeded(snapshots);
    const cachePath = this.getCachePath();
    let loadedEntries = new Map<string, SearchCacheEntry>();
    let savedAt: number | null = null;
    let bytes = 0;
    let cacheNeedsPurge = false;

    if (cachePath) {
      try {
        if (await this.options.app.vault.adapter.exists(cachePath)) {
          cacheNeedsPurge = true;
          const cacheStat = await this.options.app.vault.adapter.stat(cachePath);
          bytes = cacheStat?.size ?? 0;
          if (cacheStat && isSearchCacheByteSizeWithinCap(cacheStat.size)) {
            const raw = await this.options.app.vault.adapter.read(cachePath);
            bytes = getUtf8ByteLength(raw);
            if (isSearchCacheByteSizeWithinCap(bytes)) {
              const decoded = JSON.parse(raw) as unknown;
              const parsed = parsePersistentSearchCache(
                decoded,
                getSearchSettingsKey(this.options.getSettings()),
                SEARCH_INDEX_MAX_ESTIMATED_MEMORY_BYTES
              );
              if (parsed) {
                loadedEntries = selectReusableSearchCacheEntries(
                  parsed.entries,
                  snapshots
                );
                this.throwIfCapacityExceeded(snapshots, loadedEntries.values());
                cacheNeedsPurge =
                  parsed.entries.size !== loadedEntries.size ||
                  getRawCacheEntryCount(decoded) !== parsed.entries.size;
                savedAt = parsed.savedAt;
              }
            }
          } else if (cacheStat) {
            this.persistenceWarning =
              "The full-text search cache is larger than 64 MiB. Search works now, but it will be rebuilt after the next launch.";
          }
        }
      } catch (error) {
        if (error instanceof SearchIndexCapacityError) {
          throw error;
        }
        // Missing, unreadable, or malformed caches are rebuilt below.
      }
    }

    if (this.shouldAbort(generation)) {
      return;
    }

    this.entries = loadedEntries;
    this.processedCount = loadedEntries.size;
    this.lastIndexedAt = savedAt;
    this.isUsingCachedIndex = loadedEntries.size > 0;
    this.hydrated = true;
    this.phase = loadedEntries.size === snapshots.length ? "ready" : "waiting";
    const loadDiagnostics = {
      ms: Math.round(performance.now() - startedAt),
      entries: loadedEntries.size,
      totalFiles: snapshots.length,
      bytes
    };
    this.diagnostics.lastLoad = loadDiagnostics;
    this.options.logPerformance("search cache loaded", loadDiagnostics);
    this.publish();
    if (cacheNeedsPurge) {
      this.purgePersistentCache();
      if (this.entries.size > 0) {
        this.scheduleCacheWrite();
      }
    }
  }

  private async refreshEntries(reason: string, generation: number): Promise<void> {
    const startedAt = performance.now();
    const files = this.getEligibleFiles();
    const snapshots = files.map(toFileSnapshot);
    this.throwIfCapacityExceeded(snapshots);
    const reusable = selectReusableSearchCacheEntries(this.entries, snapshots);
    this.throwIfCapacityExceeded(snapshots, reusable.values());
    const missingFiles = files.filter((file) => !reusable.has(file.path));
    this.totalCount = files.length;
    this.processedCount = reusable.size;

    if (missingFiles.length === 0) {
      this.entries = reusable;
      this.processedCount = files.length;
      this.phase = "ready";
      this.lastError = null;
      this.lastIndexedAt ??= Date.now();
      this.publish();
      return;
    }

    this.phase = "indexing";
    this.lastError = null;
    this.publish();
    let bodyReads = 0;
    let processedCount = reusable.size;
    let estimatedMemoryBytes = [...reusable.values()].reduce(
      (total, entry) => total + estimateSearchCacheEntryMemoryBytes(entry),
      0
    );
    let capacityExceeded = false;

    const refreshed = await mapWithConcurrency(
      missingFiles,
      SEARCH_READ_CONCURRENCY,
      async (file) => {
        const snapshot = toFileSnapshot(file);
        try {
          const body = await this.options.app.vault.cachedRead(file);
          bodyReads += 1;
          const currentFile = this.options.app.vault.getAbstractFileByPath(file.path);
          if (!isMarkdownFile(currentFile)) {
            return null;
          }
          const currentSnapshot = toFileSnapshot(currentFile);
          if (!matchesFileSnapshot(currentSnapshot, snapshot)) {
            return null;
          }
          const remainingBodyCodeUnits = Math.floor(
            Math.max(
              0,
              SEARCH_INDEX_MAX_ESTIMATED_MEMORY_BYTES -
                estimatedMemoryBytes -
                2 * snapshot.path.length
            ) / 2
          );
          const entry = createSearchCacheEntry(
            snapshot,
            body,
            remainingBodyCodeUnits
          );
          if (!entry) {
            capacityExceeded = true;
            return null;
          }
          const nextEstimatedMemoryBytes =
            estimatedMemoryBytes + estimateSearchCacheEntryMemoryBytes(entry);
          if (nextEstimatedMemoryBytes > SEARCH_INDEX_MAX_ESTIMATED_MEMORY_BYTES) {
            capacityExceeded = true;
            return null;
          }
          estimatedMemoryBytes = nextEstimatedMemoryBytes;
          return entry;
        } catch {
          return null;
        } finally {
          processedCount += 1;
          if (processedCount === files.length || processedCount % 100 === 0) {
            this.processedCount = processedCount;
            if (!this.shouldAbort(generation)) {
              this.publish();
            }
          }
        }
      },
      16,
      () => this.shouldAbort(generation) || capacityExceeded
    );

    if (this.shouldAbort(generation)) {
      return;
    }
    if (capacityExceeded) {
      this.failCapacity(SEARCH_INDEX_MEMORY_CAP_ERROR);
    }

    const nextEntries = new Map(reusable);
    for (const entry of refreshed) {
      if (entry) {
        nextEntries.set(entry.path, entry);
      }
    }

    this.entries = nextEntries;
    this.processedCount = files.length;
    this.lastIndexedAt = Date.now();
    this.isUsingCachedIndex = false;
    this.phase = nextEntries.size === files.length ? "ready" : "error";
    this.lastError =
      nextEntries.size === files.length
        ? null
        : `Could not index ${files.length - nextEntries.size} Markdown file(s) for search.`;
    const buildDiagnostics = {
      reason,
      ms: Math.round(performance.now() - startedAt),
      totalFiles: files.length,
      reusedEntries: reusable.size,
      bodyReads,
      indexedEntries: nextEntries.size,
      readConcurrency: SEARCH_READ_CONCURRENCY
    };
    this.diagnostics.lastBuild = buildDiagnostics;
    this.options.logPerformance("search index build", buildDiagnostics);
    this.publish();

    if (nextEntries.size > 0) {
      this.scheduleCacheWrite();
    }
  }

  private scheduleRefresh(
    reason: string,
    delayMs = SEARCH_REFRESH_DELAY_MS,
    allowBackground = false
  ): void {
    if (
      !this.requested ||
      (!allowBackground && !this.options.isHomeActive()) ||
      this.unloaded
    ) {
      return;
    }

    this.cancelScheduledRefresh();
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null;
      if (
        this.unloaded ||
        (!allowBackground && !this.options.isHomeActive())
      ) {
        return;
      }
      this.refreshIdleCallback = this.requestIdle(() => {
        this.refreshIdleCallback = null;
        if (
          this.unloaded ||
          (!allowBackground && !this.options.isHomeActive())
        ) {
          return;
        }
        void this.ensureReady(reason);
      }, SEARCH_REFRESH_IDLE_TIMEOUT_MS);
    }, delayMs);
  }

  private scheduleCacheWrite(): void {
    this.cancelScheduledWrite();
    const sequence = this.writeSequence;
    this.writeTimer = window.setTimeout(() => {
      this.writeTimer = null;
      this.writeIdleCallback = this.requestIdle(() => {
        this.writeIdleCallback = null;
        void this.writeCache(sequence);
      }, SEARCH_CACHE_WRITE_IDLE_TIMEOUT_MS);
    }, SEARCH_CACHE_WRITE_DELAY_MS);
  }

  private async writeCache(sequence: number): Promise<void> {
    if (
      sequence !== this.writeSequence ||
      this.unloaded ||
      this.entries.size === 0 ||
      this.lastIndexedAt === null
    ) {
      return;
    }

    if (this.writeInProgress) {
      this.writePending = true;
      return;
    }

    const cachePath = this.getCachePath();
    if (!cachePath) {
      return;
    }

    const startedAt = performance.now();
    this.writeInProgress = true;
    try {
      if (this.cachePurgePromise) {
        await this.cachePurgePromise;
      }
      if (sequence !== this.writeSequence || this.unloaded) {
        return;
      }

      const settingsKey = getSearchSettingsKey(this.options.getSettings());
      const sizeEstimate = estimatePersistentSearchCacheBytesFromEntries(
        settingsKey,
        this.entries.values(),
        this.lastIndexedAt
      );
      if (!sizeEstimate.withinCap) {
        this.persistenceWarning =
          "The full-text search cache is larger than 64 MiB. Search works now, but it will be rebuilt after the next launch.";
        this.options.logPerformance("search cache save skipped", {
          reason: "cache-too-large",
          bytes: sizeEstimate.byteSize
        });
        this.publish();
        return;
      }

      const payload = createPersistentSearchCache(
        settingsKey,
        this.entries.values(),
        this.lastIndexedAt
      );
      const serialized = JSON.stringify(payload);
      const bytes = getUtf8ByteLength(serialized);

      if (sequence !== this.writeSequence || this.unloaded) {
        return;
      }

      await this.options.app.vault.adapter.write(cachePath, serialized);
      if (!this.unloaded) {
        this.persistenceWarning = null;
        const saveDiagnostics = {
          ms: Math.round(performance.now() - startedAt),
          entries: this.entries.size,
          bytes,
          superseded: sequence !== this.writeSequence
        };
        this.diagnostics.lastSave = saveDiagnostics;
        this.options.logPerformance("search cache saved", saveDiagnostics);
      }
    } catch {
      if (!this.unloaded) {
        this.options.logPerformance("search cache save failed", {
          reason: "adapter-write-failed"
        });
      }
    } finally {
      this.writeInProgress = false;
      if (this.cachePurgePending) {
        await this.flushPendingCachePurge();
      }
      const shouldWriteLatest = this.writePending;
      this.writePending = false;
      if (shouldWriteLatest && !this.unloaded) {
        this.scheduleCacheWrite();
      }
    }
  }

  private throwIfCapacityExceeded(
    snapshots: Iterable<SearchFileSnapshot>,
    entries: Iterable<SearchCacheEntry> = []
  ): void {
    const error = getSearchIndexCapacityError(snapshots, entries);
    if (error) {
      this.failCapacity(error);
    }
  }

  private failCapacity(message: string): never {
    this.entries.clear();
    this.processedCount = 0;
    this.isUsingCachedIndex = false;
    this.lastIndexedAt = null;
    this.purgePersistentCache();
    throw new SearchIndexCapacityError(message);
  }

  private getEligibleFiles(): TFile[] {
    const settings = this.options.getSettings();
    return this.options.app.vault
      .getMarkdownFiles()
      .filter((file) =>
        passesFolderSettings(
          file.path,
          settings.includeFolders,
          settings.excludeFolders
        )
      );
  }

  private getCachePath(): string | null {
    return this.options.cacheDirectory
      ? joinVaultPath(this.options.cacheDirectory, SEARCH_CACHE_FILENAME)
      : null;
  }

  private shouldAbort(generation: number): boolean {
    return this.unloaded || generation !== this.generation;
  }

  private markInputChanged(reason: string): void {
    this.generation += 1;
    this.pendingRefreshReason = reason;
  }

  private publish(): void {
    const state = this.getState();
    for (const listener of this.listeners) {
      listener(state);
    }
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

  private cancelScheduledRefresh(): void {
    if (this.refreshTimer !== null) {
      window.clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (this.refreshIdleCallback !== null) {
      this.cancelIdle(this.refreshIdleCallback);
      this.refreshIdleCallback = null;
    }
  }

  private cancelScheduledWrite(): void {
    this.writeSequence += 1;
    if (this.writeTimer !== null) {
      window.clearTimeout(this.writeTimer);
      this.writeTimer = null;
    }
    if (this.writeIdleCallback !== null) {
      this.cancelIdle(this.writeIdleCallback);
      this.writeIdleCallback = null;
    }
  }

  private purgePersistentCache(): void {
    this.cancelScheduledWrite();
    this.cachePurgePending = true;
    this.persistenceWarning = null;
    if (!this.writeInProgress) {
      void this.flushPendingCachePurge();
    }
  }

  private async flushPendingCachePurge(): Promise<void> {
    if (!this.cachePurgePending) {
      return;
    }
    if (this.cachePurgePromise) {
      await this.cachePurgePromise;
      return;
    }

    this.cachePurgePending = false;
    const cachePath = this.getCachePath();
    if (!cachePath) {
      return;
    }

    let purgeFailed = false;
    const purge = (async () => {
      try {
        if (await this.options.app.vault.adapter.exists(cachePath)) {
          await this.options.app.vault.adapter.remove(cachePath);
        }
        if (this.persistenceWarning === SEARCH_CACHE_PURGE_WARNING) {
          this.persistenceWarning = null;
          if (!this.unloaded) {
            this.publish();
          }
        }
      } catch {
        purgeFailed = true;
        this.cachePurgePending = true;
        this.persistenceWarning = SEARCH_CACHE_PURGE_WARNING;
        this.options.logPerformance("search cache purge failed", {
          reason: "adapter-remove-failed"
        });
        if (!this.unloaded) {
          this.publish();
        }
      }
    })();
    this.cachePurgePromise = purge;
    try {
      await purge;
    } finally {
      if (this.cachePurgePromise === purge) {
        this.cachePurgePromise = null;
      }
      if (
        this.cachePurgePending &&
        !this.writeInProgress &&
        !purgeFailed
      ) {
        await this.flushPendingCachePurge();
      }
    }
  }
}

export function getSearchSettingsKey(settings: PalmWikiHomeSettings): string {
  return JSON.stringify({
    includeFolders: [...settings.includeFolders].sort(),
    excludeFolders: [...settings.excludeFolders].sort()
  });
}

function toFileSnapshot(file: TFile): SearchFileSnapshot {
  return {
    path: file.path,
    mtime: file.stat.mtime,
    size: file.stat.size
  };
}

function isMarkdownFile(file: TAbstractFile | null): file is TFile {
  const candidate = file as Partial<TFile> | null;
  return Boolean(
    candidate &&
    typeof candidate.path === "string" &&
    typeof candidate.extension === "string" &&
    candidate.extension.toLocaleLowerCase() === "md" &&
    candidate.stat &&
    typeof candidate.stat.mtime === "number" &&
    typeof candidate.stat.size === "number"
  );
}

function joinVaultPath(directory: string, filename: string): string {
  return `${directory.replace(/\\/g, "/").replace(/\/+$/, "")}/${filename}`
    .replace(/^\/+/, "")
    .replace(/\/{2,}/g, "/");
}

function getRawCacheEntryCount(value: unknown): number {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return -1;
  }
  const entries = (value as Record<string, unknown>).entries;
  return Array.isArray(entries) ? entries.length : -1;
}

import { ItemView, TFile, WorkspaceLeaf } from "obsidian";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { filterPages } from "../core/filters/filterPages";
import type { PageRecord } from "../core/index/PageRecord";
import { normalizeSearchText } from "../core/search/normalizeText";
import { reversePinnedGroups, sortPagesAscending } from "../core/sort/sortPages";
import type PalmWikiHomePlugin from "../main";
import type { PalmWikiHomeIndexState } from "../main";
import type {
  PalmWikiSortDirection,
  PalmWikiSortKey,
  PalmWikiViewMode
} from "../settings/Settings";
import { CardGrid } from "./CardGrid";
import { HomeToolbar, type LinkTargetSuggestion } from "./HomeToolbar";
import { PageTable } from "./PageTable";

export const PALMWIKI_HOME_VIEW_TYPE = "palmwiki-home-view";

export class PalmWikiHomeView extends ItemView {
  private plugin: PalmWikiHomePlugin;
  private root: Root | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: PalmWikiHomePlugin) {
    super(leaf);
    this.plugin = plugin;
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
    this.contentEl.empty();
    this.contentEl.addClass("palmwiki-home-view");

    const rootEl = this.contentEl.createDiv({
      cls: "palmwiki-home-root"
    });

    this.root = createRoot(rootEl);
    this.root.render(<PalmWikiHomeRoot plugin={this.plugin} />);
    this.plugin.ensureIndexForView();
  }

  async onClose(): Promise<void> {
    this.root?.unmount();
    this.root = null;
    this.contentEl.removeClass("palmwiki-home-view");
  }
}

interface PalmWikiHomeRootProps {
  plugin: PalmWikiHomePlugin;
}

function PalmWikiHomeRoot({ plugin }: PalmWikiHomeRootProps): React.JSX.Element {
  const [indexState, setIndexState] = useState<PalmWikiHomeIndexState>(
    plugin.getIndexState()
  );
  const [viewMode, setViewMode] = useState<PalmWikiViewMode>(
    plugin.settings.defaultViewMode
  );
  const [sortKey, setSortKey] = useState<PalmWikiSortKey>(
    plugin.settings.defaultSortKey
  );
  const [sortDirection, setSortDirection] = useState<PalmWikiSortDirection>(
    plugin.settings.defaultSortDirection
  );
  const [folderFilter, setFolderFilter] = useState<string>("");
  const [tagFilter, setTagFilter] = useState<string>("");
  const [query, setQuery] = useState<string>("");
  const [linkTargetQuery, setLinkTargetQuery] = useState<string>("");
  const [linkTargetPath, setLinkTargetPath] = useState<string>("");
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

  const changeQuery = useCallback((nextQuery: string) => {
    setQuery(nextQuery);
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
      query
    });

    plugin.logPerformance("filter", {
      ms: Math.round(performance.now() - startedAt),
      sourceCount: indexState.pages.length,
      resultCount: filtered.length,
      query,
      folderFilter,
      linkTargetPath,
      tagFilter
    });

    return filtered;
  }, [folderFilter, indexState.pages, linkTargetPath, plugin, query, tagFilter]);
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

  const openPage = useCallback(
    (path: string) => {
      void plugin.openPage(path);
    },
    [plugin]
  );

  const togglePinned = useCallback(
    (path: string) => {
      void plugin.togglePinnedPage(path);
    },
    [plugin]
  );

  const refreshIndex = useCallback(() => {
    void plugin.rebuildIndex("toolbar");
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

  return (
    <div className="palmwiki-home-shell">
      <HomeToolbar
        availableFolders={availableFolders}
        availableTags={availableTags}
        folderFilter={folderFilter}
        indexState={indexState}
        linkTargetPath={linkTargetPath}
        linkTargetQuery={linkTargetQuery}
        linkTargetSuggestions={linkTargetSuggestions}
        onFolderFilterChange={changeFolderFilter}
        onLinkTargetClear={clearLinkTarget}
        onLinkTargetQueryChange={changeLinkTargetQuery}
        onLinkTargetSelect={selectLinkTarget}
        onQueryChange={changeQuery}
        onRefresh={refreshIndex}
        onSortDirectionChange={changeSortDirection}
        onSortKeyChange={changeSortKey}
        onTagFilterChange={changeTagFilter}
        onViewModeChange={changeViewMode}
        query={query}
        resultCount={visiblePages.length}
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

      {!indexState.isIndexing && indexState.pages.length > 0 && visiblePages.length === 0 ? (
        <div className="palmwiki-state">No pages match the current filters.</div>
      ) : null}

      {visiblePages.length > 0 && viewMode === "card" ? (
        <CardGrid
          cardSize={plugin.settings.cardSize}
          getImageCacheStats={getImageCacheStats}
          onOpenPage={openPage}
          onTogglePinned={togglePinned}
          pages={visiblePages}
          performanceDebug={performanceDebug}
          resolveImageUrl={resolveImageUrl}
          showFolders={plugin.settings.showFoldersOnCards}
          showTags={plugin.settings.showTagsOnCards}
        />
      ) : null}

      {visiblePages.length > 0 && viewMode === "table" ? (
        <PageTable
          getImageCacheStats={getImageCacheStats}
          onOpenPage={openPage}
          onTogglePinned={togglePinned}
          pages={visiblePages}
          performanceDebug={performanceDebug}
          resolveImageUrl={resolveImageUrl}
        />
      ) : null}
    </div>
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

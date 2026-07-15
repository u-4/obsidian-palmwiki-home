import { setIcon } from "obsidian";
import React, { useEffect, useId, useRef, useState } from "react";
import type { PalmWikiHomeIndexState } from "../main";
import type { SearchIndexState } from "../searchIndex";
import type {
  PalmWikiSortDirection,
  PalmWikiSortKey,
  PalmWikiViewMode
} from "../settings/Settings";
import {
  countActiveToolbarFilters,
  getDisplaySettingsToggleLabel
} from "./toolbarPresentation";

interface HomeToolbarProps {
  availableFolders: string[];
  availableTags: string[];
  folderFilter: string;
  indexState: PalmWikiHomeIndexState;
  searchIndexState: SearchIndexState;
  linkTargetPath: string;
  linkTargetQuery: string;
  linkTargetSuggestions: LinkTargetSuggestion[];
  onFolderFilterChange: (folder: string) => void;
  onLinkTargetClear: () => void;
  onLinkTargetQueryChange: (query: string) => void;
  onLinkTargetSelect: (path: string) => void;
  onQueryChange: (query: string) => void;
  onRefresh: () => void;
  onSortDirectionChange: (direction: PalmWikiSortDirection) => void;
  onSortKeyChange: (key: PalmWikiSortKey) => void;
  onTagFilterChange: (tag: string) => void;
  onViewModeChange: (mode: PalmWikiViewMode) => void;
  query: string;
  resultCount: number;
  sortDirection: PalmWikiSortDirection;
  sortKey: PalmWikiSortKey;
  tagFilter: string;
  totalCount: number;
  viewMode: PalmWikiViewMode;
}

export function HomeToolbar({
  availableFolders,
  availableTags,
  folderFilter,
  indexState,
  searchIndexState,
  linkTargetPath,
  linkTargetQuery,
  linkTargetSuggestions,
  onFolderFilterChange,
  onLinkTargetClear,
  onLinkTargetQueryChange,
  onLinkTargetSelect,
  onQueryChange,
  onRefresh,
  onSortDirectionChange,
  onSortKeyChange,
  onTagFilterChange,
  onViewModeChange,
  query,
  resultCount,
  sortDirection,
  sortKey,
  tagFilter,
  totalCount,
  viewMode
}: HomeToolbarProps): React.JSX.Element {
  const linkTargetFilterRef = useRef<HTMLDivElement | null>(null);
  const displaySettingsIconRef = useRef<HTMLSpanElement | null>(null);
  const refreshIconRef = useRef<HTMLSpanElement | null>(null);
  const displaySettingsId = useId();
  const [displaySettingsOpen, setDisplaySettingsOpen] = useState(false);
  const [linkTargetPopoverOpen, setLinkTargetPopoverOpen] = useState(false);
  const lastIndexed = indexState.lastIndexedAt
    ? new Date(indexState.lastIndexedAt).toLocaleTimeString()
    : null;
  const indexStatus = getIndexStatusPresentation(indexState, lastIndexed);
  const searchStatus = getSearchStatusPresentation(searchIndexState);
  const showLinkTargetSuggestions =
    linkTargetPopoverOpen && linkTargetSuggestions.length > 0;
  const activeFilterCount = countActiveToolbarFilters({
    folderFilter,
    linkTargetPath,
    query,
    tagFilter,
  });

  useEffect(() => {
    if (refreshIconRef.current) {
      setIcon(refreshIconRef.current, "refresh-cw");
    }
    if (displaySettingsIconRef.current) {
      setIcon(displaySettingsIconRef.current, "list-filter");
    }
  }, []);

  useEffect(() => {
    if (!linkTargetPopoverOpen) {
      return;
    }

    const closeOnOutsidePointerDown = (event: PointerEvent): void => {
      const target = event.target;
      const ownerWindow = linkTargetFilterRef.current?.ownerDocument.defaultView;
      if (
        ownerWindow &&
        target instanceof ownerWindow.Node &&
        linkTargetFilterRef.current?.contains(target)
      ) {
        return;
      }

      setLinkTargetPopoverOpen(false);
    };

    const ownerDocument = linkTargetFilterRef.current?.ownerDocument;
    ownerDocument?.addEventListener("pointerdown", closeOnOutsidePointerDown);

    return () => {
      ownerDocument?.removeEventListener("pointerdown", closeOnOutsidePointerDown);
    };
  });

  return (
    <header className="palmwiki-toolbar">
      <div className="palmwiki-toolbar-title-row">
        <div className="palmwiki-toolbar-title-block">
          <h1>PalmWiki Home</h1>
          <span className="palmwiki-page-count">
            {resultCount} / {totalCount} pages
          </span>
        </div>
        <div className="palmwiki-status-line">
          <span
            aria-atomic="true"
            aria-label={`${indexStatus.label}: ${indexStatus.detail}`}
            aria-live="polite"
            className="palmwiki-index-status-group"
            role="status"
          >
            <span
              className={`palmwiki-index-status is-${indexState.indexPhase}`}
            >
              <span aria-hidden="true" className="palmwiki-index-status-dot" />
              <span className="palmwiki-index-status-label">
                {indexStatus.label}
              </span>
            </span>
            <span className="palmwiki-index-status-detail">
              {indexStatus.detail}
            </span>
          </span>
          <span
            aria-atomic="true"
            aria-label={`${searchStatus.label}: ${searchStatus.detail}`}
            aria-live="polite"
            className="palmwiki-index-status-group"
            role="status"
          >
            <span className={`palmwiki-index-status is-${searchIndexState.phase}`}>
              <span aria-hidden="true" className="palmwiki-index-status-dot" />
              <span className="palmwiki-index-status-label">
                {searchStatus.label}
              </span>
            </span>
            <span className="palmwiki-index-status-detail">
              {searchStatus.detail}
            </span>
          </span>
          <button
            aria-label="Refresh page and search indexes"
            className="palmwiki-button palmwiki-refresh-button"
            disabled={
              indexState.isIndexing ||
              searchIndexState.phase === "loading" ||
              searchIndexState.phase === "indexing"
            }
            onClick={onRefresh}
            title="Refresh page and search indexes"
            type="button"
          >
            <span aria-hidden="true" ref={refreshIconRef} />
          </button>
          <button
            aria-controls={displaySettingsId}
            aria-expanded={displaySettingsOpen}
            aria-label={getDisplaySettingsToggleLabel(
              displaySettingsOpen,
              activeFilterCount
            )}
            className={
              displaySettingsOpen
                ? "palmwiki-button palmwiki-display-settings-toggle is-open"
                : "palmwiki-button palmwiki-display-settings-toggle"
            }
            onClick={() => {
              const nextOpen = !displaySettingsOpen;
              setDisplaySettingsOpen(nextOpen);
              if (!nextOpen) {
                setLinkTargetPopoverOpen(false);
              }
            }}
            title={
              displaySettingsOpen
                ? "Hide display settings"
                : "Show display settings"
            }
            type="button"
          >
            <span
              aria-hidden="true"
              className="palmwiki-display-settings-icon"
              ref={displaySettingsIconRef}
            />
            {activeFilterCount > 0 ? (
              <span
                aria-hidden="true"
                className="palmwiki-display-settings-active-dot"
              />
            ) : null}
          </button>
        </div>
      </div>

      <div
        className="palmwiki-display-settings"
        hidden={!displaySettingsOpen}
        id={displaySettingsId}
      >
        <div className="palmwiki-toolbar-controls">
        <div className="palmwiki-segmented" role="group">
          <button
            aria-pressed={viewMode === "card"}
            className={viewMode === "card" ? "is-active" : ""}
            onClick={() => onViewModeChange("card")}
            type="button"
          >
            Card
          </button>
          <button
            aria-pressed={viewMode === "table"}
            className={viewMode === "table" ? "is-active" : ""}
            onClick={() => onViewModeChange("table")}
            type="button"
          >
            Table
          </button>
        </div>

        <select
          aria-label="Sort"
          className="palmwiki-select"
          onChange={(event) => onSortKeyChange(event.currentTarget.value as PalmWikiSortKey)}
          value={sortKey}
        >
          <option value="modified">Updated time</option>
          <option value="created">Created time</option>
          <option value="title">Title</option>
          <option value="lines">Line count</option>
          <option value="chars">Character count</option>
          <option value="pageRank">Page rank</option>
          <option value="inlinks">Inlinks</option>
          <option value="outlinks">Outlinks</option>
        </select>

        <button
          className="palmwiki-button"
          onClick={() => onSortDirectionChange(sortDirection === "asc" ? "desc" : "asc")}
          type="button"
        >
          {sortDirection === "asc" ? "Asc" : "Desc"}
        </button>

        <select
          aria-label="Folder filter"
          className="palmwiki-select"
          onChange={(event) => onFolderFilterChange(event.currentTarget.value)}
          value={folderFilter}
        >
          <option value="">All folders</option>
          {availableFolders.map((folder) => (
            <option key={folder} value={folder}>
              {folder}
            </option>
          ))}
        </select>

        <select
          aria-label="Tag filter"
          className="palmwiki-select"
          onChange={(event) => onTagFilterChange(event.currentTarget.value)}
          value={tagFilter}
        >
          <option value="">All tags</option>
          {availableTags.map((tag) => (
            <option key={tag} value={tag}>
              {tag}
            </option>
          ))}
        </select>

        <input
          aria-label="Quick filter"
          className="palmwiki-filter-input"
          onChange={(event) => onQueryChange(event.currentTarget.value)}
          placeholder="Filter title/path/tag"
          type="search"
          value={query}
        />

        <div className="palmwiki-link-target-filter" ref={linkTargetFilterRef}>
          <input
            aria-label="Link target filter"
            aria-expanded={showLinkTargetSuggestions}
            className="palmwiki-filter-input"
            onChange={(event) => {
              onLinkTargetQueryChange(event.currentTarget.value);
              setLinkTargetPopoverOpen(true);
            }}
            onFocus={() => {
              if (linkTargetQuery) {
                setLinkTargetPopoverOpen(true);
              }
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setLinkTargetPopoverOpen(false);
              }
            }}
            placeholder="Links to page"
            type="search"
            value={linkTargetQuery}
          />
          {linkTargetQuery || linkTargetPath ? (
            <button
              aria-label="Clear link target filter"
              className="palmwiki-button palmwiki-clear-filter-button"
              onClick={() => {
                onLinkTargetClear();
                setLinkTargetPopoverOpen(false);
              }}
              type="button"
            >
              Clear
            </button>
          ) : null}
          {showLinkTargetSuggestions ? (
            <div className="palmwiki-link-target-suggestions" role="listbox">
              {linkTargetSuggestions.map((suggestion) => (
                <button
                  className="palmwiki-link-target-option"
                  key={suggestion.path}
                  onClick={() => {
                    onLinkTargetSelect(suggestion.path);
                    setLinkTargetPopoverOpen(false);
                  }}
                  role="option"
                  type="button"
                >
                  <span>{suggestion.title}</span>
                  <span>{suggestion.folder || suggestion.path}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
        </div>
      </div>
    </header>
  );
}

export interface LinkTargetSuggestion {
  folder: string;
  path: string;
  title: string;
}

interface IndexStatusPresentation {
  detail: string;
  label: string;
}

function getIndexStatusPresentation(
  state: PalmWikiHomeIndexState,
  lastIndexed: string | null
): IndexStatusPresentation {
  const savedDetail = lastIndexed ? `saved ${lastIndexed}` : "no saved index";

  switch (state.indexPhase) {
    case "waiting":
      return {
        label: "Waiting",
        detail: state.usingCachedIndex
          ? `Showing saved index · ${savedDetail}`
          : "Waiting for Obsidian to become idle"
      };
    case "indexing":
      return {
        label: "Indexing",
        detail: state.usingCachedIndex
          ? `Saved pages remain available · ${savedDetail}`
          : "Building the page index"
      };
    case "complete":
      return {
        label: "Complete",
        detail: lastIndexed ? `Updated ${lastIndexed}` : "Index is up to date"
      };
    case "error":
      return {
        label: "Update failed",
        detail: state.usingCachedIndex
          ? `Saved pages remain available · ${savedDetail}`
          : "Use the refresh icon to try again"
      };
  }
}

function getSearchStatusPresentation(
  state: SearchIndexState
): IndexStatusPresentation {
  switch (state.phase) {
    case "waiting":
      return {
        label: "Search waiting",
        detail:
          state.indexedCount > 0
            ? `${state.indexedCount.toLocaleString()} cached pages`
            : "Starts after PalmWiki Home becomes idle"
      };
    case "loading":
      return {
        label: "Loading search",
        detail: "Reading the local search cache"
      };
    case "indexing":
      return {
        label: "Indexing search",
        detail: `${state.processedCount.toLocaleString()} / ${state.totalCount.toLocaleString()} pages`
      };
    case "ready":
      return {
        label: "Search ready",
        detail: `${state.indexedCount.toLocaleString()} pages`
      };
    case "error":
      return {
        label: "Search incomplete",
        detail: `${state.indexedCount.toLocaleString()} / ${state.totalCount.toLocaleString()} pages`
      };
  }
}

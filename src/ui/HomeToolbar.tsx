import React, { useEffect, useRef, useState } from "react";
import type { PalmWikiHomeIndexState } from "../main";
import type {
  PalmWikiSortDirection,
  PalmWikiSortKey,
  PalmWikiViewMode
} from "../settings/Settings";

interface HomeToolbarProps {
  availableFolders: string[];
  availableTags: string[];
  folderFilter: string;
  indexState: PalmWikiHomeIndexState;
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
  const [linkTargetPopoverOpen, setLinkTargetPopoverOpen] = useState(false);
  const lastIndexed = indexState.lastIndexedAt
    ? new Date(indexState.lastIndexedAt).toLocaleTimeString()
    : null;
  const indexStatus = getIndexStatusPresentation(indexState, lastIndexed);
  const showLinkTargetSuggestions =
    linkTargetPopoverOpen && linkTargetSuggestions.length > 0;

  useEffect(() => {
    if (!linkTargetPopoverOpen) {
      return;
    }

    const closeOnOutsidePointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (
        target instanceof Node &&
        linkTargetFilterRef.current?.contains(target)
      ) {
        return;
      }

      setLinkTargetPopoverOpen(false);
    };

    document.addEventListener("pointerdown", closeOnOutsidePointerDown);

    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointerDown);
    };
  }, [linkTargetPopoverOpen]);

  return (
    <header className="palmwiki-toolbar">
      <div className="palmwiki-toolbar-title-row">
        <div>
          <h1>PalmWiki Home</h1>
          <div className="palmwiki-toolbar-meta">
            <span>{resultCount} / {totalCount} pages</span>
            <span
              aria-atomic="true"
              aria-live="polite"
              className="palmwiki-index-status-group"
              role="status"
            >
              <span
                className={`palmwiki-index-status is-${indexState.indexPhase}`}
              >
                <span aria-hidden="true" className="palmwiki-index-status-dot" />
                {indexStatus.label}
              </span>
              <span>{indexStatus.detail}</span>
            </span>
          </div>
        </div>
        <button
          className="palmwiki-button"
          disabled={indexState.isIndexing}
          onClick={onRefresh}
          type="button"
        >
          Refresh
        </button>
      </div>

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
          : "Use Refresh to try again"
      };
  }
}

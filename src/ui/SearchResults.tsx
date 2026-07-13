import React, { useEffect, useRef, useState } from "react";
import {
  getRawTextHighlightRanges,
  type FullTextSearchResult
} from "../core/search/fullTextSearch";

interface SearchResultsProps {
  createPageName: string | null;
  loadRawSnippet: (path: string, query: string) => Promise<string | undefined>;
  limit: number;
  onCreatePage: (name: string) => void;
  onLoadMore: () => void;
  onOpenPage: (result: FullTextSearchResult) => void;
  onPreviewPage?: (path: string, targetEl: HTMLElement, event: MouseEvent) => void;
  onTogglePinned: (path: string) => void;
  ownerDocument: Document | null;
  query: string;
  results: readonly FullTextSearchResult[];
}

export const DEFAULT_SEARCH_RESULT_LIMIT = 100;
export const MAX_SEARCH_RESULT_LIMIT = 500;

export function SearchResults({
  createPageName,
  loadRawSnippet,
  limit,
  onCreatePage,
  onLoadMore,
  onOpenPage,
  onPreviewPage,
  onTogglePinned,
  ownerDocument,
  query,
  results
}: SearchResultsProps): React.JSX.Element {
  const visibleResults = results.slice(0, Math.min(limit, MAX_SEARCH_RESULT_LIMIT));

  return (
    <section aria-label="PalmWiki search results" className="palmwiki-search-results">
      <div
        aria-atomic="true"
        aria-live="polite"
        className="palmwiki-search-results-header"
        role="status"
      >
        <div>
          <strong>{results.length.toLocaleString()} pages</strong>
          <span>PageRank-assisted relevance</span>
        </div>
        <span>Query: {query}</span>
      </div>

      {createPageName ? (
        <button
          className="palmwiki-search-create-result"
          onClick={() => onCreatePage(createPageName)}
          type="button"
        >
          <span aria-hidden="true">＋</span>
          <span>
            <strong>{createPageName}</strong>
            <small>Create a new page after confirmation</small>
          </span>
        </button>
      ) : null}

      {visibleResults.length === 0 ? (
        <div className="palmwiki-search-no-results">No pages match this search.</div>
      ) : (
        <div className="palmwiki-search-result-list">
          {visibleResults.map((result) => {
            const snippet = result.firstBodyMatch
              ? result.page.description || "Matching text found in this page."
              : result.page.description;
            return (
              <article className="palmwiki-search-result" key={result.page.path}>
                <button
                  className="palmwiki-search-result-open"
                  onClick={() => onOpenPage(result)}
                  onMouseEnter={(event) =>
                    onPreviewPage?.(
                      result.page.path,
                      event.currentTarget,
                      event.nativeEvent
                    )
                  }
                  onMouseMove={(event) =>
                    onPreviewPage?.(
                      result.page.path,
                      event.currentTarget,
                      event.nativeEvent
                    )
                  }
                  type="button"
                >
                  <span className="palmwiki-search-result-title" title={result.page.title}>
                    {result.page.title}
                  </span>
                  <span className="palmwiki-search-result-path" title={result.page.path}>
                    {result.page.path}
                  </span>
                  {snippet && result.firstBodyMatch ? (
                    <SearchResultSnippet
                      fallback={snippet}
                      key={`${result.page.path}-${result.page.modifiedTime}-${query}`}
                      loadRawSnippet={loadRawSnippet}
                      ownerDocument={ownerDocument}
                      path={result.page.path}
                      query={query}
                    />
                  ) : snippet ? (
                    <span className="palmwiki-search-result-snippet">
                      <HighlightedText query={query} text={snippet} />
                    </span>
                  ) : null}
                  <span className="palmwiki-search-result-reasons">
                    {getReasonLabels(result).map((reason) => (
                      <span key={reason}>{reason}</span>
                    ))}
                    <span>PR {result.page.pageRank.toFixed(2)}</span>
                  </span>
                </button>
                <button
                  aria-label={`${result.page.pinned ? "Unpin" : "Pin"} ${result.page.title}`}
                  aria-pressed={result.page.pinned}
                  className="palmwiki-pin-button palmwiki-search-result-pin"
                  onClick={() => onTogglePinned(result.page.path)}
                  type="button"
                >
                  {result.page.pinned ? "Pinned" : "Pin"}
                </button>
              </article>
            );
          })}
        </div>
      )}

      {results.length > visibleResults.length && visibleResults.length < MAX_SEARCH_RESULT_LIMIT ? (
        <button className="palmwiki-button palmwiki-search-load-more" onClick={onLoadMore} type="button">
          Show 100 more
        </button>
      ) : null}
      {results.length > MAX_SEARCH_RESULT_LIMIT &&
      visibleResults.length >= MAX_SEARCH_RESULT_LIMIT ? (
        <div className="palmwiki-search-result-cap" role="status">
          Showing the first {MAX_SEARCH_RESULT_LIMIT.toLocaleString()} pages. Add another search term or filter to narrow the results.
        </div>
      ) : null}
    </section>
  );
}

function SearchResultSnippet({
  fallback,
  loadRawSnippet,
  ownerDocument,
  path,
  query
}: {
  fallback: string;
  loadRawSnippet: (path: string, query: string) => Promise<string | undefined>;
  ownerDocument: Document | null;
  path: string;
  query: string;
}): React.JSX.Element {
  const elementRef = useRef<HTMLSpanElement | null>(null);
  const [text, setText] = useState(fallback);

  useEffect(() => {
    const element = elementRef.current;
    const currentDocument = element?.ownerDocument;
    const ownerWindow = currentDocument?.defaultView;
    if (!element || !ownerWindow || currentDocument !== ownerDocument) {
      return;
    }

    let cancelled = false;
    let started = false;
    const load = (): void => {
      if (started) {
        return;
      }
      started = true;
      void loadRawSnippet(path, query).then((rawSnippet) => {
        if (!cancelled && rawSnippet) {
          setText(rawSnippet);
        }
      });
    };

    if (typeof ownerWindow.IntersectionObserver !== "function") {
      load();
      return () => {
        cancelled = true;
      };
    }

    const observer = new ownerWindow.IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        load();
      }
    });
    observer.observe(element);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [loadRawSnippet, ownerDocument, path, query]);

  return (
    <span className="palmwiki-search-result-snippet" ref={elementRef}>
      <HighlightedText query={query} text={text} />
    </span>
  );
}

function getReasonLabels(result: FullTextSearchResult): string[] {
  const labels = new Set<string>();
  if (result.exactTitleMatches > 0) {
    labels.add("Exact title");
  }
  for (const field of result.matchedFields) {
    if (field === "title" || field === "basename" || field === "alias") {
      labels.add("Page name");
    } else if (field === "body") {
      labels.add("Body");
    } else if (field === "tag") {
      labels.add("Tag");
    } else if (field === "path") {
      labels.add("Path");
    }
  }
  for (const relation of result.relations) {
    labels.add(relation.hop === 1 ? "Direct link" : "2-hop");
  }
  return [...labels];
}

function HighlightedText({ text, query }: { text: string; query: string }): React.JSX.Element {
  if (!text) {
    return <>{text}</>;
  }

  const ranges = getRawTextHighlightRanges(text, query);
  if (ranges.length === 0) {
    return <>{text}</>;
  }

  const parts: React.ReactNode[] = [];
  let offset = 0;
  for (const [index, range] of ranges.entries()) {
    if (range.from > offset) {
      parts.push(
        <React.Fragment key={`plain-${index}-${offset}`}>
          {text.slice(offset, range.from)}
        </React.Fragment>
      );
    }
    parts.push(
      <mark key={`match-${index}-${range.from}`}>{text.slice(range.from, range.to)}</mark>
    );
    offset = range.to;
  }
  if (offset < text.length) {
    parts.push(<React.Fragment key={`plain-end-${offset}`}>{text.slice(offset)}</React.Fragment>);
  }
  return (
    <>
      {parts}
    </>
  );
}

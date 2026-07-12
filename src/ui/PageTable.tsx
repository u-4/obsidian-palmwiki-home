import React, { useEffect, useMemo, useRef, useState } from "react";
import type {
  PageActionHandler,
  PageImageCacheStatsGetter,
  PageImageResolver,
  PageRecord
} from "./PalmWikiHomeView";
import { formatDateTime } from "./components/format";

const TABLE_ROW_HEIGHT = 104;
const TABLE_OVERSCAN_ROWS = 8;
const INITIAL_VISIBLE_ROWS = 24;
const MAX_VISIBLE_TAGS = 8;

interface PageTableProps {
  getImageCacheStats: PageImageCacheStatsGetter;
  onOpenPage: PageActionHandler;
  onTogglePinned: PageActionHandler;
  pages: PageRecord[];
  performanceDebug: boolean;
  resolveImageUrl: PageImageResolver;
}

export function PageTable({
  getImageCacheStats,
  onOpenPage,
  onTogglePinned,
  pages,
  performanceDebug,
  resolveImageUrl
}: PageTableProps): React.JSX.Element {
  const containerRef = useRef<HTMLElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [visibleRange, setVisibleRange] = useState({
    start: 0,
    end: Math.min(INITIAL_VISIBLE_ROWS, pages.length)
  });
  const totalHeight = pages.length * TABLE_ROW_HEIGHT;
  const visiblePages = useMemo(
    () => pages.slice(visibleRange.start, visibleRange.end),
    [pages, visibleRange.end, visibleRange.start]
  );

  useEffect(() => {
    setVisibleRange((current) => {
      const start = Math.min(current.start, Math.max(0, pages.length - 1));
      const end = Math.min(
        pages.length,
        Math.max(start + 1, current.end, Math.min(INITIAL_VISIBLE_ROWS, pages.length))
      );

      return current.start === start && current.end === end ? current : { start, end };
    });
  }, [pages.length]);

  useEffect(() => {
    const container = containerRef.current;
    const body = bodyRef.current;
    if (!container || !body) {
      return;
    }

    const scrollParent = findScrollParent(container);
    let frame = 0;

    const updateVisibleRows = (): void => {
      if (frame !== 0) {
        window.cancelAnimationFrame(frame);
      }

      frame = window.requestAnimationFrame(() => {
        const bodyRect = body.getBoundingClientRect();
        const viewportRect =
          scrollParent === window
            ? { top: 0, height: window.innerHeight }
            : (scrollParent as HTMLElement).getBoundingClientRect();
        const visibleTop = Math.max(0, viewportRect.top - bodyRect.top);
        const visibleBottom = Math.min(
          totalHeight,
          visibleTop + viewportRect.height + TABLE_ROW_HEIGHT
        );
        const rawStart = Math.max(
          0,
          Math.floor(visibleTop / TABLE_ROW_HEIGHT) - TABLE_OVERSCAN_ROWS
        );
        const maxStart = Math.max(0, pages.length - 1);
        const start = pages.length === 0 ? 0 : Math.min(rawStart, maxStart);
        const rawEnd = Math.ceil(visibleBottom / TABLE_ROW_HEIGHT) + TABLE_OVERSCAN_ROWS;
        const end =
          pages.length === 0 ? 0 : Math.min(pages.length, Math.max(start + 1, rawEnd));

        setVisibleRange((current) =>
          current.start === start && current.end === end ? current : { start, end }
        );
        frame = 0;
      });
    };

    updateVisibleRows();
    scrollParent.addEventListener("scroll", updateVisibleRows, { passive: true });
    window.addEventListener("resize", updateVisibleRows);

    return () => {
      if (frame !== 0) {
        window.cancelAnimationFrame(frame);
      }

      scrollParent.removeEventListener("scroll", updateVisibleRows);
      window.removeEventListener("resize", updateVisibleRows);
    };
  }, [pages.length, totalHeight]);

  useEffect(() => {
    if (!performanceDebug) {
      return;
    }

    console.debug("[PalmWiki Home perf]", "table mount window", {
      mountedCount: visiblePages.length,
      totalCount: pages.length,
      startIndex: visibleRange.start,
      endIndex: visibleRange.end,
      rowHeight: TABLE_ROW_HEIGHT,
      overscanRows: TABLE_OVERSCAN_ROWS,
      imageCache: getImageCacheStats()
    });
  }, [
    getImageCacheStats,
    pages.length,
    performanceDebug,
    visiblePages.length,
    visibleRange.end,
    visibleRange.start
  ]);

  return (
    <section
      aria-colcount={12}
      aria-label="PalmWiki pages"
      aria-rowcount={pages.length + 1}
      className="palmwiki-table-virtual"
      ref={containerRef}
      role="table"
    >
      <div className="palmwiki-table-header" role="rowgroup">
        <div className="palmwiki-table-row palmwiki-table-heading-row" role="row">
          <div className="palmwiki-table-heading" role="columnheader">
            Page
          </div>
          <div className="palmwiki-table-heading" role="columnheader">
            Image
          </div>
          <div className="palmwiki-table-heading" role="columnheader">
            Description
          </div>
          <div className="palmwiki-table-heading" role="columnheader">
            Created
          </div>
          <div className="palmwiki-table-heading" role="columnheader">
            Updated
          </div>
          <div className="palmwiki-table-heading" role="columnheader">
            PageRank
          </div>
          <div className="palmwiki-table-heading" role="columnheader">
            Inlinks
          </div>
          <div className="palmwiki-table-heading" role="columnheader">
            Outlinks
          </div>
          <div className="palmwiki-table-heading" role="columnheader">
            Lines
          </div>
          <div className="palmwiki-table-heading" role="columnheader">
            Chars
          </div>
          <div className="palmwiki-table-heading" role="columnheader">
            Folder
          </div>
          <div className="palmwiki-table-heading" role="columnheader">
            Tags
          </div>
        </div>
      </div>

      <div className="palmwiki-table-body" ref={bodyRef} role="rowgroup">
        <div className="palmwiki-table-spacer" style={{ height: totalHeight }}>
          <div
            className="palmwiki-table-window"
            style={{
              transform: `translateY(${visibleRange.start * TABLE_ROW_HEIGHT}px)`
            }}
          >
            {visiblePages.map((page, index) => (
              <VirtualPageTableRow
                imageUrl={resolveImageUrl(page.firstImagePath)}
                key={page.path}
                onOpenPage={onOpenPage}
                onTogglePinned={onTogglePinned}
                page={page}
                rowIndex={visibleRange.start + index + 2}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

interface VirtualPageTableRowProps {
  imageUrl?: string;
  onOpenPage: PageActionHandler;
  onTogglePinned: PageActionHandler;
  page: PageRecord;
  rowIndex: number;
}

const VirtualPageTableRow = React.memo(function VirtualPageTableRow({
  imageUrl,
  onOpenPage,
  onTogglePinned,
  page,
  rowIndex
}: VirtualPageTableRowProps): React.JSX.Element {
  const visibleTags = page.tags.slice(0, MAX_VISIBLE_TAGS);
  const hiddenTagCount = Math.max(0, page.tags.length - visibleTags.length);

  return (
    <div
      aria-rowindex={rowIndex}
      className={`palmwiki-table-row palmwiki-table-data-row ${page.pinned ? "is-pinned" : ""}`}
      role="row"
    >
      <div className="palmwiki-table-cell palmwiki-table-page-cell" role="cell">
        <div className="palmwiki-table-page">
          <button
            className="palmwiki-table-link"
            onClick={() => onOpenPage(page.path)}
            type="button"
          >
            {page.title}
          </button>
          <button
            aria-pressed={page.pinned}
            className="palmwiki-pin-button palmwiki-pin-button-compact"
            onClick={() => onTogglePinned(page.path)}
            title={page.pinned ? "Unpin" : "Pin"}
            type="button"
          >
            {page.pinned ? "Pinned" : "Pin"}
          </button>
        </div>
        <div className="palmwiki-table-path">{page.path}</div>
      </div>
      <div className="palmwiki-table-cell palmwiki-table-image-cell" role="cell">
        {imageUrl ? (
          <img alt="" className="palmwiki-table-image" loading="lazy" src={imageUrl} />
        ) : (
          <span className="palmwiki-muted">None</span>
        )}
      </div>
      <div className="palmwiki-table-cell palmwiki-table-description-cell" role="cell">
        {page.description}
      </div>
      <div className="palmwiki-table-cell palmwiki-table-date-cell" role="cell">
        {formatDateTime(page.createdTime)}
      </div>
      <div className="palmwiki-table-cell palmwiki-table-date-cell" role="cell">
        {formatDateTime(page.modifiedTime)}
      </div>
      <div className="palmwiki-table-cell palmwiki-table-rank-cell" role="cell">
        {page.pageRank.toFixed(3)}
      </div>
      <div className="palmwiki-table-cell palmwiki-table-number-cell" role="cell">
        {page.inlinkCount}
      </div>
      <div className="palmwiki-table-cell palmwiki-table-number-cell" role="cell">
        {page.outlinkCount}
      </div>
      <div className="palmwiki-table-cell palmwiki-table-number-cell" role="cell">
        {page.lineCount}
      </div>
      <div className="palmwiki-table-cell palmwiki-table-number-cell" role="cell">
        {page.charCount}
      </div>
      <div className="palmwiki-table-cell palmwiki-table-folder-cell" role="cell">
        {page.folder}
      </div>
      <div className="palmwiki-table-cell palmwiki-table-tags-cell" role="cell">
        <div className="palmwiki-tags palmwiki-tags-table">
          {visibleTags.map((tag) => (
            <span className="palmwiki-tag" key={tag}>
              {tag}
            </span>
          ))}
          {hiddenTagCount > 0 ? (
            <span className="palmwiki-tag">+{hiddenTagCount}</span>
          ) : null}
        </div>
      </div>
    </div>
  );
});

function findScrollParent(element: HTMLElement): HTMLElement | Window {
  let parent = element.parentElement;

  while (parent) {
    const style = window.getComputedStyle(parent);
    if (/(auto|scroll)/.test(`${style.overflowY}${style.overflow}`)) {
      return parent;
    }

    parent = parent.parentElement;
  }

  return window;
}

import React, { useEffect, useMemo, useRef, useState } from "react";
import { findClosestVerticalScrollContainer } from "../homeNavigation";
import type { PalmWikiCardSize } from "../settings/Settings";
import type {
  PageActionHandler,
  PageImageCacheStatsGetter,
  PageImageResolver,
  PagePreviewHandler,
  PageRecord
} from "./PalmWikiHomeView";
import { PageCard } from "./PageCard";

const GRID_GAP = 12;
const OVERSCAN_ROWS = 3;

const CARD_LAYOUT: Record<PalmWikiCardSize, { minWidth: number; height: number }> = {
  small: { minWidth: 180, height: 300 },
  medium: { minWidth: 230, height: 420 },
  large: { minWidth: 300, height: 520 }
};

interface CardGridProps {
  cardSize: PalmWikiCardSize;
  getImageCacheStats: PageImageCacheStatsGetter;
  onOpenPage: PageActionHandler;
  onPreviewPage?: PagePreviewHandler;
  onTogglePinned: PageActionHandler;
  pages: PageRecord[];
  performanceDebug: boolean;
  resolveImageUrl: PageImageResolver;
  showFolders: boolean;
  showTags: boolean;
}

export function CardGrid({
  cardSize,
  getImageCacheStats,
  onOpenPage,
  onPreviewPage,
  onTogglePinned,
  pages,
  performanceDebug,
  resolveImageUrl,
  showFolders,
  showTags
}: CardGridProps): React.JSX.Element {
  const containerRef = useRef<HTMLElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [visibleRange, setVisibleRange] = useState({ startRow: 0, endRow: 8 });
  const layout = CARD_LAYOUT[cardSize];
  const columns = Math.max(
    1,
    Math.floor((containerWidth + GRID_GAP) / (layout.minWidth + GRID_GAP))
  );
  const rowStride = layout.height + GRID_GAP;
  const rowCount = Math.ceil(pages.length / columns);
  const totalHeight = Math.max(0, rowCount * rowStride - GRID_GAP);
  const startIndex = visibleRange.startRow * columns;
  const endIndex = Math.min(pages.length, visibleRange.endRow * columns);
  const visiblePages = useMemo(
    () => pages.slice(startIndex, endIndex),
    [endIndex, pages, startIndex]
  );

  useEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return;
    }

    const ownerWindow = element.ownerDocument.defaultView;
    if (!ownerWindow) {
      return;
    }

    const resizeObserver = new ownerWindow.ResizeObserver(([entry]) => {
      setContainerWidth(entry.contentRect.width);
    });

    resizeObserver.observe(element);
    setContainerWidth(element.getBoundingClientRect().width);

    return () => resizeObserver.disconnect();
  }, []);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return;
    }

    const ownerWindow = element.ownerDocument.defaultView;
    if (!ownerWindow) {
      return;
    }

    const scrollParent = findClosestVerticalScrollContainer(element) ?? ownerWindow;
    let frame = 0;

    const updateVisibleRows = (): void => {
      if (frame !== 0) {
        ownerWindow.cancelAnimationFrame(frame);
      }

      frame = ownerWindow.requestAnimationFrame(() => {
        const containerRect = element.getBoundingClientRect();
        const viewportRect =
          scrollParent === ownerWindow
            ? { top: 0, height: ownerWindow.innerHeight }
            : (scrollParent as HTMLElement).getBoundingClientRect();
        const visibleTop = Math.max(0, viewportRect.top - containerRect.top);
        const visibleBottom = Math.min(
          totalHeight,
          visibleTop + viewportRect.height + rowStride
        );
        const rawStartRow = Math.max(
          0,
          Math.floor(visibleTop / rowStride) - OVERSCAN_ROWS
        );
        const maxStartRow = Math.max(0, rowCount - 1);
        const startRow = rowCount === 0 ? 0 : Math.min(rawStartRow, maxStartRow);
        const rawEndRow = Math.ceil(visibleBottom / rowStride) + OVERSCAN_ROWS;
        const endRow =
          rowCount === 0 ? 0 : Math.min(rowCount, Math.max(startRow + 1, rawEndRow));

        setVisibleRange((current) =>
          current.startRow === startRow && current.endRow === endRow
            ? current
            : { startRow, endRow }
        );
        frame = 0;
      });
    };

    updateVisibleRows();
    scrollParent.addEventListener("scroll", updateVisibleRows, { passive: true });
    ownerWindow.addEventListener("resize", updateVisibleRows);

    return () => {
      if (frame !== 0) {
        ownerWindow.cancelAnimationFrame(frame);
      }

      scrollParent.removeEventListener("scroll", updateVisibleRows);
      ownerWindow.removeEventListener("resize", updateVisibleRows);
    };
  }, [columns, pages.length, rowCount, rowStride, totalHeight]);

  useEffect(() => {
    if (!performanceDebug) {
      return;
    }

    console.debug("[PalmWiki Home perf]", "card mount window", {
      mountedCount: visiblePages.length,
      totalCount: pages.length,
      startIndex,
      endIndex,
      startRow: visibleRange.startRow,
      endRow: visibleRange.endRow,
      columns,
      imageCache: getImageCacheStats()
    });
  }, [
    columns,
    endIndex,
    getImageCacheStats,
    pages.length,
    performanceDebug,
    startIndex,
    visiblePages.length,
    visibleRange.endRow,
    visibleRange.startRow
  ]);

  return (
    <section
      className={`palmwiki-card-virtual palmwiki-card-grid-${cardSize}`}
      ref={containerRef}
      style={
        {
          "--palmwiki-card-height": `${layout.height}px`
        } as React.CSSProperties
      }
    >
      <div className="palmwiki-card-virtual-spacer" style={{ height: totalHeight }}>
        <div
          className="palmwiki-card-virtual-window"
          style={{
            gap: GRID_GAP,
            gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
            transform: `translateY(${visibleRange.startRow * rowStride}px)`
          }}
        >
          {visiblePages.map((page) => (
            <PageCard
              imageUrl={resolveImageUrl(page.firstImagePath)}
              key={page.path}
              onOpenPage={onOpenPage}
              onPreviewPage={onPreviewPage}
              onTogglePinned={onTogglePinned}
              page={page}
              showFolder={showFolders}
              showTags={showTags}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

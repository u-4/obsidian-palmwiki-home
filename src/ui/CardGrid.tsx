import React, { useEffect, useMemo, useRef, useState } from "react";
import { findClosestVerticalScrollContainer } from "../homeNavigation";
import type {
  PalmWikiCardShape,
  PalmWikiCardSize
} from "../settings/Settings";
import type {
  PageActionHandler,
  PageImageCacheStatsGetter,
  PageImageResolver,
  PagePreviewHandler,
  PageRecord
} from "./PalmWikiHomeView";
import { PageCard } from "./PageCard";
import { CARD_GRID_GAP, getCardGridLayout } from "./cardGridLayout";

const OVERSCAN_ROWS = 3;

interface CardGridProps {
  cardShape: PalmWikiCardShape;
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
  squareTwoColumnMaxWidth: number;
}

export function CardGrid({
  cardShape,
  cardSize,
  getImageCacheStats,
  onOpenPage,
  onPreviewPage,
  onTogglePinned,
  pages,
  performanceDebug,
  resolveImageUrl,
  showFolders,
  showTags,
  squareTwoColumnMaxWidth
}: CardGridProps): React.JSX.Element {
  const containerRef = useRef<HTMLElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [visibleRange, setVisibleRange] = useState({ startRow: 0, endRow: 8 });
  const layout = getCardGridLayout(
    cardSize,
    cardShape,
    containerWidth,
    pages.length,
    { squareTwoColumnMaxWidth }
  );
  const startIndex = visibleRange.startRow * layout.columns;
  const endIndex = Math.min(
    pages.length,
    visibleRange.endRow * layout.columns
  );
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
          layout.totalHeight,
          visibleTop + viewportRect.height + layout.rowStride
        );
        const rawStartRow = Math.max(
          0,
          Math.floor(visibleTop / layout.rowStride) - OVERSCAN_ROWS
        );
        const maxStartRow = Math.max(0, layout.rowCount - 1);
        const startRow =
          layout.rowCount === 0 ? 0 : Math.min(rawStartRow, maxStartRow);
        const rawEndRow =
          Math.ceil(visibleBottom / layout.rowStride) + OVERSCAN_ROWS;
        const endRow =
          layout.rowCount === 0
            ? 0
            : Math.min(
                layout.rowCount,
                Math.max(startRow + 1, rawEndRow)
              );

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
  }, [
    layout.columns,
    layout.rowCount,
    layout.rowStride,
    layout.totalHeight,
    pages.length
  ]);

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
      columns: layout.columns,
      imageCache: getImageCacheStats()
    });
  }, [
    layout.columns,
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
          "--palmwiki-card-height": `${layout.cardHeight}px`
        } as React.CSSProperties
      }
    >
      <div
        className="palmwiki-card-virtual-spacer"
        style={{ height: layout.totalHeight }}
      >
        <div
          className="palmwiki-card-virtual-window"
          style={{
            gap: CARD_GRID_GAP,
            gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))`,
            transform: `translateY(${visibleRange.startRow * layout.rowStride}px)`
          }}
        >
          {visiblePages.map((page) => (
            <PageCard
              cardShape={cardShape}
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

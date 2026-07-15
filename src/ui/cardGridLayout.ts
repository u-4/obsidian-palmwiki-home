import {
  DEFAULT_SQUARE_TWO_COLUMN_MAX_WIDTH,
  type PalmWikiCardShape,
  type PalmWikiCardSize
} from "../settings/Settings";
/*
 * This module intentionally uses the rendered grid width rather than a device
 * name or physical screen resolution so split panes and resizable iPad windows
 * follow the same rule.
 */
export const CARD_GRID_GAP = 12;
export const MIN_SQUARE_TWO_COLUMN_GRID_WIDTH = 276;

export interface CardGridLayoutOptions {
  squareTwoColumnMaxWidth: number;
}

const CARD_LAYOUT: Record<
  PalmWikiCardSize,
  { minWidth: number; portraitHeight: number }
> = {
  small: { minWidth: 180, portraitHeight: 300 },
  medium: { minWidth: 230, portraitHeight: 420 },
  large: { minWidth: 300, portraitHeight: 520 }
};

export interface CardGridLayout {
  cardHeight: number;
  columnWidth: number;
  columns: number;
  minWidth: number;
  rowCount: number;
  rowStride: number;
  totalHeight: number;
}

export function getCardGridLayout(
  cardSize: PalmWikiCardSize,
  cardShape: PalmWikiCardShape,
  containerWidth: number,
  pageCount: number,
  options?: CardGridLayoutOptions
): CardGridLayout {
  const layout = CARD_LAYOUT[cardSize];
  const measuredWidth =
    Number.isFinite(containerWidth) && containerWidth > 0 ? containerWidth : 0;
  const responsiveColumns =
    measuredWidth > 0
      ? Math.max(
          1,
          Math.floor(
            (measuredWidth + CARD_GRID_GAP) /
              (layout.minWidth + CARD_GRID_GAP)
          )
        )
      : 1;
  const squareTwoColumnMaxWidth =
    options?.squareTwoColumnMaxWidth ?? DEFAULT_SQUARE_TWO_COLUMN_MAX_WIDTH;
  const useSquareTwoColumnLayout =
    cardShape === "square" &&
    measuredWidth >= MIN_SQUARE_TWO_COLUMN_GRID_WIDTH &&
    measuredWidth <= squareTwoColumnMaxWidth;
  const columns =
    cardShape === "square" &&
    measuredWidth >= MIN_SQUARE_TWO_COLUMN_GRID_WIDTH
      ? useSquareTwoColumnLayout
        ? 2
        : Math.max(2, responsiveColumns)
      : responsiveColumns;
  const columnWidth =
    measuredWidth > 0
      ? Math.max(
          1,
          (measuredWidth - CARD_GRID_GAP * (columns - 1)) / columns
        )
      : layout.minWidth;
  const cardHeight =
    cardShape === "square" ? columnWidth : layout.portraitHeight;
  const rowStride = cardHeight + CARD_GRID_GAP;
  const normalizedPageCount =
    Number.isFinite(pageCount) && pageCount > 0 ? Math.floor(pageCount) : 0;
  const rowCount = Math.ceil(normalizedPageCount / columns);
  const totalHeight = Math.max(0, rowCount * rowStride - CARD_GRID_GAP);

  return {
    cardHeight,
    columnWidth,
    columns,
    minWidth: layout.minWidth,
    rowCount,
    rowStride,
    totalHeight
  };
}

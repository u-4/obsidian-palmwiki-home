import type { PageRecord } from "../index/PageRecord";
import type { PalmWikiSortDirection, PalmWikiSortKey } from "../../settings/Settings";

const TEXT_COLLATOR = new Intl.Collator(undefined, {
  sensitivity: "base",
  numeric: true
});

export interface PageSortOptions {
  key: PalmWikiSortKey;
  direction: PalmWikiSortDirection;
}

export function sortPages(pages: PageRecord[], options: PageSortOptions): PageRecord[] {
  const sortedAsc = sortPagesAscending(pages, options.key);
  return options.direction === "asc" ? sortedAsc : reversePinnedGroups(sortedAsc);
}

export function sortPagesAscending(
  pages: PageRecord[],
  key: PalmWikiSortKey
): PageRecord[] {
  return [...pages].sort((a, b) => {
    const pinnedCompare = Number(b.pinned) - Number(a.pinned);
    if (pinnedCompare !== 0) {
      return pinnedCompare;
    }

    const primaryCompare = compareBySortKey(a, b, key);
    if (primaryCompare !== 0) {
      return primaryCompare;
    }

    const titleCompare = compareText(a.sortTitle, b.sortTitle);
    if (titleCompare !== 0) {
      return titleCompare;
    }

    const pathCompare = compareText(a.sortPath, b.sortPath);
    if (pathCompare !== 0) {
      return pathCompare;
    }

    return a.indexOrder - b.indexOrder;
  });
}

export function reversePinnedGroups(pages: PageRecord[]): PageRecord[] {
  const pinned: PageRecord[] = [];
  const unpinned: PageRecord[] = [];

  for (const page of pages) {
    if (page.pinned) {
      pinned.push(page);
    } else {
      unpinned.push(page);
    }
  }

  return [...pinned.reverse(), ...unpinned.reverse()];
}

function compareBySortKey(a: PageRecord, b: PageRecord, key: PalmWikiSortKey): number {
  switch (key) {
    case "modified":
      return a.modifiedTime - b.modifiedTime;
    case "created":
      return a.createdTime - b.createdTime;
    case "title":
      return compareText(a.sortTitle, b.sortTitle);
    case "lines":
      return a.lineCount - b.lineCount;
    case "chars":
      return a.charCount - b.charCount;
    case "pageRank":
      return comparePageRankAscending(a, b);
    case "inlinks":
      return a.inlinkCount - b.inlinkCount;
    case "outlinks":
      return a.outlinkCount - b.outlinkCount;
  }
}

function comparePageRankAscending(a: PageRecord, b: PageRecord): number {
  return (
    a.pageRank - b.pageRank ||
    a.inlinkCount - b.inlinkCount ||
    a.modifiedTime - b.modifiedTime ||
    compareText(b.sortTitle, a.sortTitle) ||
    compareText(b.sortPath, a.sortPath) ||
    b.indexOrder - a.indexOrder
  );
}

function compareText(a: string, b: string): number {
  return TEXT_COLLATOR.compare(a, b);
}

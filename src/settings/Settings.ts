export type PalmWikiViewMode = "card" | "table";

export type PalmWikiSortKey =
  | "modified"
  | "created"
  | "title"
  | "lines"
  | "chars"
  | "pageRank"
  | "inlinks"
  | "outlinks";

export type PalmWikiSortDirection = "asc" | "desc";

export type PalmWikiCardSize = "small" | "medium" | "large";

export interface PalmWikiHomeSettings {
  includeFolders: string[];
  excludeFolders: string[];
  pinnedPages: string[];
  defaultViewMode: PalmWikiViewMode;
  defaultSortKey: PalmWikiSortKey;
  defaultSortDirection: PalmWikiSortDirection;
  showFoldersOnCards: boolean;
  showTagsOnCards: boolean;
  cardSize: PalmWikiCardSize;
  indexOnStartup: boolean;
  performanceDebug: boolean;
  pageRankIgnoredSourceFolders: string[];
  pageRankIgnoredSourcePathPatterns: string[];
  pageRankDebugPath: string;
}

export const DEFAULT_SETTINGS: PalmWikiHomeSettings = {
  includeFolders: [],
  excludeFolders: [],
  pinnedPages: [],
  defaultViewMode: "card",
  defaultSortKey: "modified",
  defaultSortDirection: "desc",
  showFoldersOnCards: true,
  showTagsOnCards: true,
  cardSize: "medium",
  indexOnStartup: false,
  performanceDebug: false,
  pageRankIgnoredSourceFolders: [],
  pageRankIgnoredSourcePathPatterns: [],
  pageRankDebugPath: ""
};

export function normalizeFolderPath(path: string): string {
  return path
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
}

export function normalizeFolderList(paths: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const path of paths) {
    const value = normalizeFolderPath(path);
    if (value.length === 0 || seen.has(value)) {
      continue;
    }

    seen.add(value);
    normalized.push(value);
  }

  return normalized;
}

export function parseFolderListInput(input: string): string[] {
  return normalizeFolderList(input.split(/[\n,]/));
}

export function formatFolderListInput(paths: string[]): string {
  return normalizeFolderList(paths).join("\n");
}

export function normalizeLineList(values: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const value of values) {
    const item = value.trim();
    if (item.length === 0 || seen.has(item)) {
      continue;
    }

    seen.add(item);
    normalized.push(item);
  }

  return normalized;
}

export function parseLineListInput(input: string): string[] {
  return normalizeLineList(input.split(/\n/));
}

export function formatLineListInput(values: string[]): string {
  return normalizeLineList(values).join("\n");
}

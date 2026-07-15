import type { HomeButtonAction } from "../homeNavigation";
import type { CardPreviewMode } from "../cardPreview";

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

export type PalmWikiCardShape = "portrait" | "square";

export const DEFAULT_SQUARE_TWO_COLUMN_MAX_WIDTH = 480;
export const MIN_SQUARE_TWO_COLUMN_MAX_WIDTH = 280;
export const MAX_SQUARE_TWO_COLUMN_MAX_WIDTH = 1600;

export interface PalmWikiHomeSettings {
  homeButtonLabel: string;
  homeButtonAction: HomeButtonAction;
  homeButtonPagePath: string;
  homeButtonCommandId: string;
  includeFolders: string[];
  excludeFolders: string[];
  pinnedPages: string[];
  defaultViewMode: PalmWikiViewMode;
  defaultSortKey: PalmWikiSortKey;
  defaultSortDirection: PalmWikiSortDirection;
  showFoldersOnCards: boolean;
  showTagsOnCards: boolean;
  cardSize: PalmWikiCardSize;
  cardShape: PalmWikiCardShape;
  squareTwoColumnMaxWidth: number;
  cardPreviewMode: CardPreviewMode;
  indexOnStartup: boolean;
  performanceDebug: boolean;
  pageRankIgnoredSourceFolders: string[];
  pageRankIgnoredSourcePathPatterns: string[];
  pageRankDebugPath: string;
}

export const DEFAULT_SETTINGS: PalmWikiHomeSettings = {
  homeButtonLabel: "",
  homeButtonAction: "palmwikiHome",
  homeButtonPagePath: "",
  homeButtonCommandId: "",
  includeFolders: [],
  excludeFolders: [],
  pinnedPages: [],
  defaultViewMode: "card",
  defaultSortKey: "modified",
  defaultSortDirection: "desc",
  showFoldersOnCards: true,
  showTagsOnCards: true,
  cardSize: "medium",
  cardShape: "portrait",
  squareTwoColumnMaxWidth: DEFAULT_SQUARE_TWO_COLUMN_MAX_WIDTH,
  cardPreviewMode: "modifier",
  indexOnStartup: false,
  performanceDebug: false,
  pageRankIgnoredSourceFolders: [],
  pageRankIgnoredSourcePathPatterns: [],
  pageRankDebugPath: ""
};

export function normalizeSettings(value: unknown): PalmWikiHomeSettings {
  const settings = isRecord(value) ? value : {};

  return {
    homeButtonLabel: readTrimmedString(settings.homeButtonLabel),
    homeButtonAction: readEnum(
      settings.homeButtonAction,
      ["palmwikiHome", "page", "command"],
      "palmwikiHome"
    ),
    homeButtonPagePath: readTrimmedString(settings.homeButtonPagePath),
    homeButtonCommandId: readTrimmedString(settings.homeButtonCommandId),
    includeFolders: normalizeFolderList(readStringArray(settings.includeFolders)),
    excludeFolders: normalizeFolderList(readStringArray(settings.excludeFolders)),
    pinnedPages: uniqueNonEmptyStrings(settings.pinnedPages),
    defaultViewMode: readEnum(settings.defaultViewMode, ["card", "table"], "card"),
    defaultSortKey: readEnum(
      settings.defaultSortKey,
      ["modified", "created", "title", "lines", "chars", "pageRank", "inlinks", "outlinks"],
      "modified"
    ),
    defaultSortDirection: readEnum(settings.defaultSortDirection, ["asc", "desc"], "desc"),
    showFoldersOnCards: readBoolean(settings.showFoldersOnCards, true),
    showTagsOnCards: readBoolean(settings.showTagsOnCards, true),
    cardSize: readEnum(settings.cardSize, ["small", "medium", "large"], "medium"),
    cardShape: readEnum(settings.cardShape, ["portrait", "square"], "portrait"),
    squareTwoColumnMaxWidth: readClampedInteger(
      settings.squareTwoColumnMaxWidth,
      DEFAULT_SQUARE_TWO_COLUMN_MAX_WIDTH,
      MIN_SQUARE_TWO_COLUMN_MAX_WIDTH,
      MAX_SQUARE_TWO_COLUMN_MAX_WIDTH
    ),
    cardPreviewMode: readEnum(
      settings.cardPreviewMode,
      ["off", "modifier", "hover"],
      "modifier"
    ),
    indexOnStartup: readBoolean(settings.indexOnStartup, false),
    performanceDebug: readBoolean(settings.performanceDebug, false),
    pageRankIgnoredSourceFolders: normalizeFolderList(
      readStringArray(settings.pageRankIgnoredSourceFolders)
    ),
    pageRankIgnoredSourcePathPatterns: normalizeLineList(
      readStringArray(settings.pageRankIgnoredSourcePathPatterns)
    ),
    pageRankDebugPath: readTrimmedString(settings.pageRankDebugPath)
  };
}

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function uniqueNonEmptyStrings(value: unknown): string[] {
  return Array.from(new Set(readStringArray(value).filter((item) => item.length > 0)));
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readClampedInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}

function readTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readEnum<const T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T
): T {
  return typeof value === "string" && allowed.includes(value as T) ? (value as T) : fallback;
}

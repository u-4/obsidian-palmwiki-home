import type {
  BodyMetadataCache,
  BodyMetadataCacheEntry
} from "./buildPageIndex";
import type { PageRecord } from "./PageRecord";
import type { PalmWikiHomeSettings } from "../../settings/Settings";

export const INDEX_CACHE_SCHEMA_VERSION = 1;

interface PersistentIndexCache {
  schemaVersion: number;
  settingsKey: string;
  savedAt: number;
  pages: PageRecord[];
  bodyMetadata: BodyMetadataCacheEntry[];
}

export interface HydratedIndexCache {
  savedAt: number;
  pages: PageRecord[];
  bodyMetadataCache: BodyMetadataCache;
}

export function buildIndexSettingsKey(settings: PalmWikiHomeSettings): string {
  return JSON.stringify({
    includeFolders: settings.includeFolders,
    excludeFolders: settings.excludeFolders,
    pageRankIgnoredSourceFolders: settings.pageRankIgnoredSourceFolders,
    pageRankIgnoredSourcePathPatterns: settings.pageRankIgnoredSourcePathPatterns
  });
}

export function createPersistentIndexCache(
  settings: PalmWikiHomeSettings,
  pages: PageRecord[],
  bodyMetadataCache: BodyMetadataCache,
  savedAt: number
): PersistentIndexCache {
  return {
    schemaVersion: INDEX_CACHE_SCHEMA_VERSION,
    settingsKey: buildIndexSettingsKey(settings),
    savedAt,
    pages,
    bodyMetadata: [...bodyMetadataCache.values()]
  };
}

export function parsePersistentIndexCache(
  value: unknown,
  settings: PalmWikiHomeSettings
): HydratedIndexCache | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    value.schemaVersion !== INDEX_CACHE_SCHEMA_VERSION ||
    value.settingsKey !== buildIndexSettingsKey(settings) ||
    !isFiniteNumber(value.savedAt) ||
    !Array.isArray(value.pages) ||
    !Array.isArray(value.bodyMetadata) ||
    !value.pages.every(isPageRecord)
  ) {
    return null;
  }

  const bodyMetadataCache: BodyMetadataCache = new Map();
  for (const entry of value.bodyMetadata) {
    if (isBodyMetadataCacheEntry(entry)) {
      bodyMetadataCache.set(entry.path, entry);
    }
  }

  return {
    savedAt: value.savedAt,
    pages: value.pages,
    bodyMetadataCache
  };
}

function isPageRecord(value: unknown): value is PageRecord {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.path === "string" &&
    typeof value.basename === "string" &&
    typeof value.title === "string" &&
    isStringArray(value.aliases) &&
    typeof value.folder === "string" &&
    isStringArray(value.tags) &&
    isFiniteNumber(value.createdTime) &&
    isFiniteNumber(value.modifiedTime) &&
    isFiniteNumber(value.lineCount) &&
    isFiniteNumber(value.charCount) &&
    typeof value.description === "string" &&
    (value.firstImagePath === undefined || typeof value.firstImagePath === "string") &&
    isStringArray(value.outlinks) &&
    isStringArray(value.inlinks) &&
    isFiniteNumber(value.outlinkCount) &&
    isFiniteNumber(value.inlinkCount) &&
    isFiniteNumber(value.pageRank) &&
    typeof value.pinned === "boolean" &&
    typeof value.filterText === "string" &&
    typeof value.sortTitle === "string" &&
    typeof value.sortPath === "string" &&
    isFiniteNumber(value.indexOrder)
  );
}

function isBodyMetadataCacheEntry(value: unknown): value is BodyMetadataCacheEntry {
  return (
    isRecord(value) &&
    typeof value.path === "string" &&
    isFiniteNumber(value.mtime) &&
    isFiniteNumber(value.size) &&
    isFiniteNumber(value.lineCount) &&
    isFiniteNumber(value.charCount) &&
    typeof value.description === "string"
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

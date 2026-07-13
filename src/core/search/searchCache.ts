import { normalizeSearchText } from "./normalizeText";

export const SEARCH_CACHE_SCHEMA_VERSION = 1;
export const SEARCH_CACHE_MAX_BYTES = 64 * 1024 * 1024;
// This is deliberately above known single-scalar NFKC/lowercase expansions;
// the normalized result is still checked, and near-limit inputs use the exact
// per-scalar upper-bound pass below.
const CONSERVATIVE_NORMALIZATION_EXPANSION_FACTOR = 32;

export interface SearchCacheEntry {
  path: string;
  mtime: number;
  size: number;
  normalizedBody: string;
}

export interface SearchFileSnapshot {
  path: string;
  mtime: number;
  size: number;
}

export interface PersistentSearchCache {
  schemaVersion: number;
  settingsKey: string;
  savedAt: number;
  entries: SearchCacheEntry[];
}

export interface HydratedSearchCache {
  savedAt: number;
  entries: Map<string, SearchCacheEntry>;
}

export interface SearchCacheSizeEstimate {
  byteSize: number;
  withinCap: boolean;
}

export function createSearchCacheEntry(
  snapshot: SearchFileSnapshot,
  body: string,
  maxNormalizedBodyCodeUnits = Number.POSITIVE_INFINITY
): SearchCacheEntry | null {
  if (!isSearchFileSnapshot(snapshot)) {
    return null;
  }
  const normalizedBody = normalizeSearchTextWithinCodeUnitLimit(
    body,
    maxNormalizedBodyCodeUnits
  );
  if (normalizedBody === null) {
    return null;
  }

  return {
    path: snapshot.path,
    mtime: snapshot.mtime,
    size: snapshot.size,
    normalizedBody
  };
}

export function createPersistentSearchCache(
  settingsKey: string,
  entries: Iterable<SearchCacheEntry>,
  savedAt: number
): PersistentSearchCache {
  const uniqueEntries = collectUniqueSearchCacheEntries(entries);

  return {
    schemaVersion: SEARCH_CACHE_SCHEMA_VERSION,
    settingsKey,
    savedAt,
    entries: [...uniqueEntries.values()]
      .sort((left, right) => left.path.localeCompare(right.path))
      .map((entry) => ({ ...entry }))
  };
}

export function parsePersistentSearchCache(
  value: unknown,
  expectedSettingsKey: string,
  maxEstimatedMemoryBytes = Number.POSITIVE_INFINITY
): HydratedSearchCache | null {
  if (
    !isRecord(value) ||
    value.schemaVersion !== SEARCH_CACHE_SCHEMA_VERSION ||
    value.settingsKey !== expectedSettingsKey ||
    !isNonNegativeFiniteNumber(value.savedAt) ||
    !Array.isArray(value.entries) ||
    !isNonNegativeFiniteNumberOrInfinity(maxEstimatedMemoryBytes)
  ) {
    return null;
  }

  const entries = new Map<string, SearchCacheEntry>();
  let estimatedMemoryBytes = 0;
  for (const candidate of value.entries) {
    if (!isSearchCacheEntry(candidate) || entries.has(candidate.path)) {
      continue;
    }

    const remainingMemoryBytes =
      maxEstimatedMemoryBytes - estimatedMemoryBytes - 2 * candidate.path.length;
    if (remainingMemoryBytes < 0) {
      return null;
    }
    const entry = toSearchCacheEntry(
      candidate,
      Math.floor(remainingMemoryBytes / 2)
    );
    if (!entry) {
      return null;
    }

    entries.set(entry.path, entry);
    estimatedMemoryBytes += 2 * (entry.path.length + entry.normalizedBody.length);
  }

  return {
    savedAt: value.savedAt,
    entries
  };
}

export function canReuseSearchCacheEntry(
  entry: SearchCacheEntry,
  snapshot: SearchFileSnapshot
): boolean {
  return (
    isSearchCacheEntry(entry) &&
    isSearchFileSnapshot(snapshot) &&
    entry.path === snapshot.path &&
    entry.mtime === snapshot.mtime &&
    entry.size === snapshot.size &&
    entry.normalizedBody.length <= snapshot.size
  );
}

export function selectReusableSearchCacheEntries(
  entries: ReadonlyMap<string, SearchCacheEntry>,
  snapshots: Iterable<SearchFileSnapshot>
): Map<string, SearchCacheEntry> {
  const snapshotsByPath = new Map<string, SearchFileSnapshot>();
  for (const snapshot of snapshots) {
    if (isSearchFileSnapshot(snapshot) && !snapshotsByPath.has(snapshot.path)) {
      snapshotsByPath.set(snapshot.path, snapshot);
    }
  }

  const reusable = new Map<string, SearchCacheEntry>();
  for (const path of [...entries.keys()].sort((left, right) => left.localeCompare(right))) {
    const entry = entries.get(path);
    const snapshot = snapshotsByPath.get(path);
    if (entry && snapshot && canReuseSearchCacheEntry(entry, snapshot)) {
      reusable.set(path, entry);
    }
  }

  return reusable;
}

export function estimatePersistentSearchCacheBytes(
  cache: PersistentSearchCache
): number {
  return getUtf8ByteLength(JSON.stringify(cache));
}

export function estimatePersistentSearchCacheBytesFromEntries(
  settingsKey: string,
  entries: Iterable<SearchCacheEntry>,
  savedAt: number,
  cap = SEARCH_CACHE_MAX_BYTES
): SearchCacheSizeEstimate {
  const uniqueEntries = [...collectUniqueSearchCacheEntries(entries).values()].sort(
    (left, right) => left.path.localeCompare(right.path)
  );
  const prefix = `{"schemaVersion":${SEARCH_CACHE_SCHEMA_VERSION},"settingsKey":${JSON.stringify(settingsKey)},"savedAt":${JSON.stringify(savedAt)},"entries":[`;
  let byteSize = getUtf8ByteLength(prefix) + 2;

  for (let index = 0; index < uniqueEntries.length; index += 1) {
    if (index > 0) {
      byteSize += 1;
    }
    byteSize += getUtf8ByteLength(JSON.stringify(uniqueEntries[index]));
    if (!isSearchCacheByteSizeWithinCap(byteSize, cap)) {
      return { byteSize, withinCap: false };
    }
  }

  return {
    byteSize,
    withinCap: isSearchCacheByteSizeWithinCap(byteSize, cap)
  };
}

export function getUtf8ByteLength(value: string): number {
  let byteSize = 0;

  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x7f) {
      byteSize += 1;
    } else if (codeUnit <= 0x7ff) {
      byteSize += 2;
    } else if (
      codeUnit >= 0xd800 &&
      codeUnit <= 0xdbff &&
      index + 1 < value.length &&
      value.charCodeAt(index + 1) >= 0xdc00 &&
      value.charCodeAt(index + 1) <= 0xdfff
    ) {
      byteSize += 4;
      index += 1;
    } else {
      byteSize += 3;
    }
  }

  return byteSize;
}

export function normalizeSearchTextWithinCodeUnitLimit(
  input: string,
  maxCodeUnits: number
): string | null {
  if (!isNonNegativeFiniteNumberOrInfinity(maxCodeUnits)) {
    return null;
  }

  if (
    input.length <=
    Math.floor(maxCodeUnits / CONSERVATIVE_NORMALIZATION_EXPANSION_FACTOR)
  ) {
    const normalized = normalizeSearchText(input);
    return normalized.length <= maxCodeUnits ? normalized : null;
  }

  let upperBound = 0;
  for (let index = 0; index < input.length; ) {
    const codePoint = input.codePointAt(index) ?? 0;
    const character = String.fromCodePoint(codePoint);
    upperBound +=
      codePoint <= 0x7f
        ? 1
        : character
            .normalize("NFKD")
            .toLowerCase()
            .normalize("NFKD").length;
    if (upperBound > maxCodeUnits) {
      return null;
    }
    index += character.length;
  }

  const normalized = normalizeSearchText(input);
  return normalized.length <= maxCodeUnits ? normalized : null;
}

export function isSearchCacheByteSizeWithinCap(
  byteSize: number,
  cap = SEARCH_CACHE_MAX_BYTES
): boolean {
  return (
    isNonNegativeFiniteNumber(byteSize) &&
    isNonNegativeFiniteNumber(cap) &&
    byteSize <= cap
  );
}

export function isPersistentSearchCacheWithinCap(
  cache: PersistentSearchCache,
  cap = SEARCH_CACHE_MAX_BYTES
): boolean {
  return isSearchCacheByteSizeWithinCap(estimatePersistentSearchCacheBytes(cache), cap);
}

export function isCanonicalMarkdownPath(path: unknown): path is string {
  if (
    typeof path !== "string" ||
    path.length === 0 ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.includes("\0") ||
    !path.toLocaleLowerCase().endsWith(".md")
  ) {
    return false;
  }

  const segments = path.split("/");
  return segments.every(
    (segment) => segment.length > 0 && segment !== "." && segment !== ".."
  );
}

function toSearchCacheEntry(
  value: unknown,
  maxNormalizedBodyCodeUnits = Number.POSITIVE_INFINITY
): SearchCacheEntry | null {
  if (!isSearchCacheEntry(value)) {
    return null;
  }
  const normalizedBody = normalizeSearchTextWithinCodeUnitLimit(
    value.normalizedBody,
    maxNormalizedBodyCodeUnits
  );
  if (normalizedBody === null) {
    return null;
  }

  return {
    path: value.path,
    mtime: value.mtime,
    size: value.size,
    normalizedBody
  };
}

function collectUniqueSearchCacheEntries(
  entries: Iterable<SearchCacheEntry>
): Map<string, SearchCacheEntry> {
  const uniqueEntries = new Map<string, SearchCacheEntry>();

  for (const entry of entries) {
    if (!isSearchCacheEntry(entry) || uniqueEntries.has(entry.path)) {
      continue;
    }
    uniqueEntries.set(entry.path, entry);
  }

  return uniqueEntries;
}

function isSearchCacheEntry(value: unknown): value is SearchCacheEntry {
  return (
    isRecord(value) &&
    isCanonicalMarkdownPath(value.path) &&
    isNonNegativeFiniteNumber(value.mtime) &&
    isNonNegativeFiniteNumber(value.size) &&
    typeof value.normalizedBody === "string"
  );
}

function isSearchFileSnapshot(value: unknown): value is SearchFileSnapshot {
  return (
    isRecord(value) &&
    isCanonicalMarkdownPath(value.path) &&
    isNonNegativeFiniteNumber(value.mtime) &&
    isNonNegativeFiniteNumber(value.size)
  );
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isNonNegativeFiniteNumberOrInfinity(value: unknown): value is number {
  return (
    typeof value === "number" &&
    value >= 0 &&
    (Number.isFinite(value) || value === Number.POSITIVE_INFINITY)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

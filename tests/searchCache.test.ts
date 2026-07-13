import assert from "node:assert/strict";
import test from "node:test";
import {
  SEARCH_CACHE_MAX_BYTES,
  SEARCH_CACHE_SCHEMA_VERSION,
  canReuseSearchCacheEntry,
  createPersistentSearchCache,
  createSearchCacheEntry,
  estimatePersistentSearchCacheBytes,
  estimatePersistentSearchCacheBytesFromEntries,
  getUtf8ByteLength,
  isCanonicalMarkdownPath,
  isPersistentSearchCacheWithinCap,
  isSearchCacheByteSizeWithinCap,
  normalizeSearchTextWithinCodeUnitLimit,
  parsePersistentSearchCache,
  selectReusableSearchCacheEntries,
  type SearchCacheEntry
} from "../src/core/search/searchCache";

const SETTINGS_KEY = JSON.stringify({
  includeFolders: ["Notes"],
  excludeFolders: ["Notes/Private"]
});

function makeEntry(
  path: string,
  overrides: Partial<SearchCacheEntry> = {}
): SearchCacheEntry {
  return {
    path,
    mtime: 100,
    size: 20,
    normalizedBody: "example body",
    ...overrides
  };
}

test("search cache entries normalize body text and persistent payloads use stable path order", () => {
  const first = createSearchCacheEntry(
    { path: "Notes/B.md", mtime: 200, size: 30 },
    "ＭＩＸＥＤ Body"
  );
  const second = createSearchCacheEntry(
    { path: "Notes/A.md", mtime: 100, size: 20 },
    "ＡＬＰＨＡ"
  );
  assert.ok(first);
  assert.ok(second);

  const payload = createPersistentSearchCache(SETTINGS_KEY, [first, second], 1234);

  assert.equal(payload.schemaVersion, SEARCH_CACHE_SCHEMA_VERSION);
  assert.deepEqual(
    payload.entries.map((entry) => entry.path),
    ["Notes/A.md", "Notes/B.md"]
  );
  assert.equal(payload.entries[0].normalizedBody, "alpha");
  assert.equal(payload.entries[1].normalizedBody, "mixed body");
});

test("valid search cache payload round-trips without sharing entry objects", () => {
  const original = makeEntry("Notes/Example.md");
  const payload = createPersistentSearchCache(SETTINGS_KEY, [original], 1234);
  const parsed = parsePersistentSearchCache(
    JSON.parse(JSON.stringify(payload)),
    SETTINGS_KEY
  );

  assert.ok(parsed);
  assert.equal(parsed.savedAt, 1234);
  assert.deepEqual(parsed.entries.get(original.path), original);
  assert.notEqual(parsed.entries.get(original.path), original);
});

test("hydration restores the normalized-body contract for otherwise valid JSON", () => {
  const parsed = parsePersistentSearchCache(
    {
      schemaVersion: SEARCH_CACHE_SCHEMA_VERSION,
      settingsKey: SETTINGS_KEY,
      savedAt: 1234,
      entries: [makeEntry("Notes/Example.md", { normalizedBody: "ＦＵＬＬ Width" })]
    },
    SETTINGS_KEY
  );

  assert.equal(parsed?.entries.get("Notes/Example.md")?.normalizedBody, "full width");
});

test("normalization expansion is rejected before it can exceed the memory budget", () => {
  const compatibilityText = "\ufdfa".repeat(10);
  assert.equal(
    normalizeSearchTextWithinCodeUnitLimit(compatibilityText, 179),
    null
  );
  assert.equal(
    normalizeSearchTextWithinCodeUnitLimit(compatibilityText, 180)?.length,
    180
  );
  assert.equal(
    createSearchCacheEntry(
      { path: "Notes/Compatibility.md", mtime: 1, size: 1000 },
      compatibilityText,
      179
    ),
    null
  );

  const payload = {
    schemaVersion: SEARCH_CACHE_SCHEMA_VERSION,
    settingsKey: SETTINGS_KEY,
    savedAt: 1234,
    entries: [
      makeEntry("Notes/Compatibility.md", {
        normalizedBody: compatibilityText,
        size: 1000
      })
    ]
  };
  assert.equal(parsePersistentSearchCache(payload, SETTINGS_KEY, 300), null);
  assert.equal(
    parsePersistentSearchCache(payload, SETTINGS_KEY, 500)?.entries.size,
    1
  );
});

test("invalid entries are excluded and duplicate paths keep the first valid entry", () => {
  const parsed = parsePersistentSearchCache(
    {
      schemaVersion: SEARCH_CACHE_SCHEMA_VERSION,
      settingsKey: SETTINGS_KEY,
      savedAt: 1234,
      entries: [
        makeEntry("Notes/Valid.md", { normalizedBody: "first" }),
        makeEntry("Notes/Valid.md", { normalizedBody: "second" }),
        makeEntry("/Absolute.md"),
        makeEntry("Notes/Negative.md", { mtime: -1 }),
        makeEntry("Notes/Infinite.md", { size: Number.POSITIVE_INFINITY }),
        { path: "Notes/MissingBody.md", mtime: 1, size: 1 },
        null
      ]
    },
    SETTINGS_KEY
  );

  assert.ok(parsed);
  assert.equal(parsed.entries.size, 1);
  assert.equal(parsed.entries.get("Notes/Valid.md")?.normalizedBody, "first");
});

test("schema, settings, timestamp, and top-level corruption invalidate the cache", () => {
  const valid = createPersistentSearchCache(
    SETTINGS_KEY,
    [makeEntry("Notes/Example.md")],
    1234
  );

  assert.equal(parsePersistentSearchCache(null, SETTINGS_KEY), null);
  assert.equal(
    parsePersistentSearchCache({ ...valid, schemaVersion: 999 }, SETTINGS_KEY),
    null
  );
  assert.equal(parsePersistentSearchCache(valid, "different-settings"), null);
  assert.equal(
    parsePersistentSearchCache({ ...valid, savedAt: -1 }, SETTINGS_KEY),
    null
  );
  assert.equal(
    parsePersistentSearchCache({ ...valid, savedAt: Number.NaN }, SETTINGS_KEY),
    null
  );
  assert.equal(
    parsePersistentSearchCache({ ...valid, entries: {} }, SETTINGS_KEY),
    null
  );
});

test("cache reuse requires the same canonical path, mtime, and size", () => {
  const entry = makeEntry("Notes/Example.md", { mtime: 100, size: 20 });

  assert.equal(
    canReuseSearchCacheEntry(entry, {
      path: entry.path,
      mtime: entry.mtime,
      size: entry.size
    }),
    true
  );
  assert.equal(
    canReuseSearchCacheEntry(entry, { path: entry.path, mtime: 101, size: entry.size }),
    false
  );
  assert.equal(
    canReuseSearchCacheEntry(
      makeEntry("Notes/Oversized.md", { size: 2, normalizedBody: "too long" }),
      { path: "Notes/Oversized.md", mtime: 100, size: 2 }
    ),
    false
  );
  assert.equal(
    canReuseSearchCacheEntry(entry, { path: entry.path, mtime: entry.mtime, size: 21 }),
    false
  );
  assert.equal(
    canReuseSearchCacheEntry(entry, {
      path: "Notes/Renamed.md",
      mtime: entry.mtime,
      size: entry.size
    }),
    false
  );
});

test("reusable selection drops modified, renamed, and deleted files deterministically", () => {
  const entries = new Map<string, SearchCacheEntry>([
    ["Notes/Deleted.md", makeEntry("Notes/Deleted.md")],
    ["Notes/Modified.md", makeEntry("Notes/Modified.md")],
    ["Notes/RenamedOld.md", makeEntry("Notes/RenamedOld.md")],
    ["Notes/Unchanged.md", makeEntry("Notes/Unchanged.md")]
  ]);

  const reusable = selectReusableSearchCacheEntries(entries, [
    { path: "Notes/Modified.md", mtime: 101, size: 20 },
    { path: "Notes/RenamedNew.md", mtime: 100, size: 20 },
    { path: "Notes/Unchanged.md", mtime: 100, size: 20 }
  ]);

  assert.deepEqual([...reusable.keys()], ["Notes/Unchanged.md"]);
});

test("canonical Markdown paths reject absolute, backslash, empty-segment, and traversal paths", () => {
  assert.equal(isCanonicalMarkdownPath("Notes/日本語 #| note.md"), true);
  assert.equal(isCanonicalMarkdownPath("Notes/UPPER.MD"), true);
  assert.equal(isCanonicalMarkdownPath(""), false);
  assert.equal(isCanonicalMarkdownPath("/Notes/A.md"), false);
  assert.equal(isCanonicalMarkdownPath("Notes\\A.md"), false);
  assert.equal(isCanonicalMarkdownPath("Notes//A.md"), false);
  assert.equal(isCanonicalMarkdownPath("Notes/../A.md"), false);
  assert.equal(isCanonicalMarkdownPath("Notes/A.txt"), false);
});

test("byte estimates are UTF-8 exact and the 64 MiB boundary is inclusive", () => {
  const payload = createPersistentSearchCache(
    SETTINGS_KEY,
    [makeEntry("Notes/日本語.md", { normalizedBody: "本文" })],
    1234
  );
  const expectedBytes = new TextEncoder().encode(JSON.stringify(payload)).byteLength;
  const estimatedBytes = estimatePersistentSearchCacheBytes(payload);

  assert.equal(estimatedBytes, expectedBytes);
  assert.equal(isPersistentSearchCacheWithinCap(payload, estimatedBytes), true);
  assert.equal(isPersistentSearchCacheWithinCap(payload, estimatedBytes - 1), false);
  assert.equal(isSearchCacheByteSizeWithinCap(SEARCH_CACHE_MAX_BYTES), true);
  assert.equal(isSearchCacheByteSizeWithinCap(SEARCH_CACHE_MAX_BYTES + 1), false);
  assert.equal(isSearchCacheByteSizeWithinCap(-1), false);
  assert.equal(isSearchCacheByteSizeWithinCap(Number.NaN), false);
  assert.equal(isSearchCacheByteSizeWithinCap(0, -1), false);

  assert.equal(getUtf8ByteLength("ASCII 日本語 😀 \ud800"), expectedTextEncoderSize("ASCII 日本語 😀 \ud800"));
  const incremental = estimatePersistentSearchCacheBytesFromEntries(
    SETTINGS_KEY,
    payload.entries,
    payload.savedAt,
    estimatedBytes
  );
  assert.deepEqual(incremental, { byteSize: estimatedBytes, withinCap: true });
  const overCap = estimatePersistentSearchCacheBytesFromEntries(
    SETTINGS_KEY,
    payload.entries,
    payload.savedAt,
    estimatedBytes - 1
  );
  assert.equal(overCap.withinCap, false);
  assert.ok(overCap.byteSize > estimatedBytes - 1);
});

function expectedTextEncoderSize(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

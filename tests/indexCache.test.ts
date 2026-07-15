import assert from "node:assert/strict";
import test from "node:test";
import {
  buildIndexSettingsKey,
  createPersistentIndexCache,
  parsePersistentIndexCache
} from "../src/core/index/IndexCache";
import type { BodyMetadataCache } from "../src/core/index/buildPageIndex";
import type { PageRecord } from "../src/core/index/PageRecord";
import {
  DEFAULT_SETTINGS,
  type PalmWikiHomeSettings
} from "../src/settings/Settings";

const settings: PalmWikiHomeSettings = {
  ...DEFAULT_SETTINGS,
  includeFolders: ["Notes"]
};

const page: PageRecord = {
  path: "Notes/Example.md",
  basename: "Example",
  title: "Example",
  aliases: [],
  folder: "Notes",
  tags: ["#test"],
  createdTime: 100,
  modifiedTime: 200,
  lineCount: 3,
  charCount: 20,
  description: "Example description",
  outlinks: [],
  inlinks: [],
  outlinkCount: 0,
  inlinkCount: 0,
  pageRank: 0.25,
  pinned: false,
  filterText: "example notes test",
  sortTitle: "example",
  sortPath: "notes/example.md",
  indexOrder: 0
};

test("persistent index cache round-trips valid page and body metadata", () => {
  const bodyMetadataCache: BodyMetadataCache = new Map([
    [
      page.path,
      {
        path: page.path,
        mtime: page.modifiedTime,
        size: 20,
        lineCount: page.lineCount,
        charCount: page.charCount,
        description: page.description
      }
    ]
  ]);
  const serialized = createPersistentIndexCache(
    settings,
    [page],
    bodyMetadataCache,
    1234
  );
  const hydrated = parsePersistentIndexCache(
    JSON.parse(JSON.stringify(serialized)),
    settings
  );

  assert.ok(hydrated);
  assert.equal(hydrated.savedAt, 1234);
  assert.deepEqual(hydrated.pages, [page]);
  assert.equal(hydrated.bodyMetadataCache.get(page.path)?.description, page.description);
});

test("persistent index cache is rejected when index-affecting settings change", () => {
  const serialized = createPersistentIndexCache(settings, [page], new Map(), 1234);
  const changedSettings: PalmWikiHomeSettings = {
    ...settings,
    excludeFolders: ["Archive"]
  };

  assert.equal(parsePersistentIndexCache(serialized, changedSettings), null);
});

test("UI-only Home navigation and Card preview settings do not invalidate the page index cache", () => {
  const serialized = createPersistentIndexCache(settings, [page], new Map(), 1234);
  const navigationSettings: PalmWikiHomeSettings = {
    ...settings,
    homeButtonAction: "page",
    homeButtonLabel: "Vault home",
    homeButtonPagePath: "Notes/Example.md",
    homeButtonCommandId: "app:test",
    cardShape: "square",
    cardSize: "large",
    squareTwoColumnMaxWidth: 760,
    cardPreviewMode: "hover"
  };

  assert.ok(parsePersistentIndexCache(serialized, navigationSettings));
});

test("persistent index cache is rejected when its structure is invalid", () => {
  assert.equal(
    parsePersistentIndexCache(
      {
        schemaVersion: 1,
        settingsKey: buildIndexSettingsKey(settings),
        savedAt: 1234,
        pages: [{}],
        bodyMetadata: []
      },
      settings
    ),
    null
  );
});

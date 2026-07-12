import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_SETTINGS,
  normalizeSettings
} from "../src/settings/Settings";

test("missing or invalid saved settings fall back to safe defaults", () => {
  assert.deepEqual(normalizeSettings(null), DEFAULT_SETTINGS);
  assert.deepEqual(normalizeSettings("invalid"), DEFAULT_SETTINGS);
  assert.deepEqual(
    normalizeSettings({
      includeFolders: 42,
      defaultViewMode: "grid",
      indexOnStartup: "yes",
      pinnedPages: [1, null]
    }),
    DEFAULT_SETTINGS
  );
});

test("saved settings are normalized and deduplicated", () => {
  assert.deepEqual(
    normalizeSettings({
      includeFolders: ["/Notes/", "Notes", " Projects\\"],
      excludeFolders: [" Archive/", "Archive"],
      pinnedPages: ["Notes/A.md", "Notes/A.md", ""],
      defaultViewMode: "table",
      defaultSortKey: "pageRank",
      defaultSortDirection: "asc",
      showFoldersOnCards: false,
      showTagsOnCards: false,
      cardSize: "large",
      indexOnStartup: true,
      performanceDebug: true,
      pageRankIgnoredSourceFolders: ["/Daily/", "Daily"],
      pageRankIgnoredSourcePathPatterns: [" Diary ", "Diary"],
      pageRankDebugPath: " Notes/Target.md "
    }),
    {
      includeFolders: ["Notes", "Projects"],
      excludeFolders: ["Archive"],
      pinnedPages: ["Notes/A.md"],
      defaultViewMode: "table",
      defaultSortKey: "pageRank",
      defaultSortDirection: "asc",
      showFoldersOnCards: false,
      showTagsOnCards: false,
      cardSize: "large",
      indexOnStartup: true,
      performanceDebug: true,
      pageRankIgnoredSourceFolders: ["Daily"],
      pageRankIgnoredSourcePathPatterns: ["Diary"],
      pageRankDebugPath: "Notes/Target.md"
    }
  );
});

test("unknown enum values and non-boolean flags are rejected", () => {
  const settings = normalizeSettings({
    defaultSortKey: "unknown",
    defaultSortDirection: 1,
    cardSize: "huge",
    performanceDebug: 1
  });

  assert.equal(settings.defaultSortKey, DEFAULT_SETTINGS.defaultSortKey);
  assert.equal(settings.defaultSortDirection, DEFAULT_SETTINGS.defaultSortDirection);
  assert.equal(settings.cardSize, DEFAULT_SETTINGS.cardSize);
  assert.equal(settings.performanceDebug, DEFAULT_SETTINGS.performanceDebug);
});

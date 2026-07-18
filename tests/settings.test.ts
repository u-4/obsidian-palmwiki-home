import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_SQUARE_TWO_COLUMN_MAX_WIDTH,
  DEFAULT_SETTINGS,
  MAX_SQUARE_TWO_COLUMN_MAX_WIDTH,
  MIN_SQUARE_TWO_COLUMN_MAX_WIDTH,
  normalizeSettings
} from "../src/settings/Settings";

test("missing or invalid saved settings fall back to safe defaults", () => {
  assert.deepEqual(normalizeSettings(null), DEFAULT_SETTINGS);
  assert.deepEqual(normalizeSettings("invalid"), DEFAULT_SETTINGS);
  assert.deepEqual(
    normalizeSettings({
      homeButtonLabel: 42,
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
      homeButtonLabel: " My Vault Home ",
      includeFolders: ["/Notes/", "Notes", " Projects\\"],
      excludeFolders: [" Archive/", "Archive"],
      pinnedPages: ["Notes/A.md", "Notes/A.md", ""],
      defaultViewMode: "table",
      defaultSortKey: "pageRank",
      defaultSortDirection: "asc",
      showFoldersOnCards: false,
      showTagsOnCards: false,
      cardSize: "large",
      cardShape: "square",
      squareTwoColumnMaxWidth: 720,
      cardPreviewMode: "hover",
      indexOnStartup: true,
      performanceDebug: true,
      pageRankIgnoredSourceFolders: ["/Daily/", "Daily"],
      pageRankIgnoredSourcePathPatterns: [" Diary ", "Diary"],
      pageRankDebugPath: " Notes/Target.md "
    }),
    {
      homeButtonLabel: "My Vault Home",
      includeFolders: ["Notes", "Projects"],
      excludeFolders: ["Archive"],
      pinnedPages: ["Notes/A.md"],
      defaultViewMode: "table",
      defaultSortKey: "pageRank",
      defaultSortDirection: "asc",
      showFoldersOnCards: false,
      showTagsOnCards: false,
      cardSize: "large",
      cardShape: "square",
      squareTwoColumnMaxWidth: 720,
      cardPreviewMode: "hover",
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
    cardShape: "circle",
    squareTwoColumnMaxWidth: "wide",
    cardPreviewMode: "always",
    performanceDebug: 1
  });

  assert.equal(settings.defaultSortKey, DEFAULT_SETTINGS.defaultSortKey);
  assert.equal(settings.defaultSortDirection, DEFAULT_SETTINGS.defaultSortDirection);
  assert.equal(settings.cardSize, DEFAULT_SETTINGS.cardSize);
  assert.equal(settings.cardShape, DEFAULT_SETTINGS.cardShape);
  assert.equal(
    settings.squareTwoColumnMaxWidth,
    DEFAULT_SETTINGS.squareTwoColumnMaxWidth
  );
  assert.equal(settings.cardPreviewMode, DEFAULT_SETTINGS.cardPreviewMode);
  assert.equal(settings.performanceDebug, DEFAULT_SETTINGS.performanceDebug);
});

test("version 0.1.0 settings gain current defaults without losing saved values", () => {
  const settings = normalizeSettings({
    includeFolders: ["Notes"],
    defaultViewMode: "table",
    showTagsOnCards: false
  });

  assert.equal(settings.homeButtonLabel, "");
  assert.equal(settings.cardShape, "portrait");
  assert.equal(
    settings.squareTwoColumnMaxWidth,
    DEFAULT_SQUARE_TWO_COLUMN_MAX_WIDTH
  );
  assert.equal(settings.cardPreviewMode, "modifier");
  assert.deepEqual(settings.includeFolders, ["Notes"]);
  assert.equal(settings.defaultViewMode, "table");
  assert.equal(settings.showTagsOnCards, false);
});

test("legacy configurable Home button settings are discarded", () => {
  const settings = normalizeSettings({
    homeButtonAction: "command",
    homeButtonPagePath: "Notes/Home.md",
    homeButtonCommandId: "workspace:close",
    homeButtonLabel: "PalmWiki"
  });

  assert.equal(settings.homeButtonLabel, "PalmWiki");
  assert.equal("homeButtonAction" in settings, false);
  assert.equal("homeButtonPagePath" in settings, false);
  assert.equal("homeButtonCommandId" in settings, false);
});

test("all supported Card preview modes are preserved", () => {
  for (const mode of ["off", "modifier", "hover"] as const) {
    assert.equal(normalizeSettings({ cardPreviewMode: mode }).cardPreviewMode, mode);
  }
});

test("all supported Card shapes are preserved", () => {
  for (const shape of ["portrait", "square"] as const) {
    assert.equal(normalizeSettings({ cardShape: shape }).cardShape, shape);
  }
});

test("Square two-column maximum width is rounded and clamped safely", () => {
  assert.equal(
    normalizeSettings({ squareTwoColumnMaxWidth: 612.6 }).squareTwoColumnMaxWidth,
    613
  );
  assert.equal(
    normalizeSettings({ squareTwoColumnMaxWidth: 1 }).squareTwoColumnMaxWidth,
    MIN_SQUARE_TWO_COLUMN_MAX_WIDTH
  );
  assert.equal(
    normalizeSettings({ squareTwoColumnMaxWidth: 9999 }).squareTwoColumnMaxWidth,
    MAX_SQUARE_TWO_COLUMN_MAX_WIDTH
  );
  assert.equal(
    normalizeSettings({ squareTwoColumnMaxWidth: Number.NaN })
      .squareTwoColumnMaxWidth,
    DEFAULT_SQUARE_TWO_COLUMN_MAX_WIDTH
  );
});

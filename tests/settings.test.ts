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
      homeButtonLabel: 42,
      homeButtonAction: "elsewhere",
      homeButtonPagePath: [],
      homeButtonCommandId: false,
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
      homeButtonAction: "command",
      homeButtonPagePath: " Notes/Home.md ",
      homeButtonCommandId: " workspace:close ",
      includeFolders: ["/Notes/", "Notes", " Projects\\"],
      excludeFolders: [" Archive/", "Archive"],
      pinnedPages: ["Notes/A.md", "Notes/A.md", ""],
      defaultViewMode: "table",
      defaultSortKey: "pageRank",
      defaultSortDirection: "asc",
      showFoldersOnCards: false,
      showTagsOnCards: false,
      cardSize: "large",
      cardPreviewMode: "hover",
      indexOnStartup: true,
      performanceDebug: true,
      pageRankIgnoredSourceFolders: ["/Daily/", "Daily"],
      pageRankIgnoredSourcePathPatterns: [" Diary ", "Diary"],
      pageRankDebugPath: " Notes/Target.md "
    }),
    {
      homeButtonLabel: "My Vault Home",
      homeButtonAction: "command",
      homeButtonPagePath: "Notes/Home.md",
      homeButtonCommandId: "workspace:close",
      includeFolders: ["Notes", "Projects"],
      excludeFolders: ["Archive"],
      pinnedPages: ["Notes/A.md"],
      defaultViewMode: "table",
      defaultSortKey: "pageRank",
      defaultSortDirection: "asc",
      showFoldersOnCards: false,
      showTagsOnCards: false,
      cardSize: "large",
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
    cardPreviewMode: "always",
    performanceDebug: 1
  });

  assert.equal(settings.defaultSortKey, DEFAULT_SETTINGS.defaultSortKey);
  assert.equal(settings.defaultSortDirection, DEFAULT_SETTINGS.defaultSortDirection);
  assert.equal(settings.cardSize, DEFAULT_SETTINGS.cardSize);
  assert.equal(settings.cardPreviewMode, DEFAULT_SETTINGS.cardPreviewMode);
  assert.equal(settings.performanceDebug, DEFAULT_SETTINGS.performanceDebug);
});

test("version 0.1.0 settings gain Home button defaults without losing saved values", () => {
  const settings = normalizeSettings({
    includeFolders: ["Notes"],
    defaultViewMode: "table",
    showTagsOnCards: false
  });

  assert.equal(settings.homeButtonLabel, "");
  assert.equal(settings.homeButtonAction, "palmwikiHome");
  assert.equal(settings.homeButtonPagePath, "");
  assert.equal(settings.homeButtonCommandId, "");
  assert.equal(settings.cardPreviewMode, "modifier");
  assert.deepEqual(settings.includeFolders, ["Notes"]);
  assert.equal(settings.defaultViewMode, "table");
  assert.equal(settings.showTagsOnCards, false);
});

test("all supported Home button actions are preserved", () => {
  for (const action of ["palmwikiHome", "page", "command"] as const) {
    assert.equal(normalizeSettings({ homeButtonAction: action }).homeButtonAction, action);
  }
});

test("all supported Card preview modes are preserved", () => {
  for (const mode of ["off", "modifier", "hover"] as const) {
    assert.equal(normalizeSettings({ cardPreviewMode: mode }).cardPreviewMode, mode);
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  countActiveToolbarFilters,
  getDisplaySettingsToggleLabel
} from "../src/ui/toolbarPresentation";

test("only effective toolbar filters count as active", () => {
  assert.equal(
    countActiveToolbarFilters({
      folderFilter: "",
      linkTargetPath: "",
      query: "   ",
      tagFilter: ""
    }),
    0
  );
  assert.equal(
    countActiveToolbarFilters({
      folderFilter: "Projects",
      linkTargetPath: "Guides/Airway.md",
      query: " recipe ",
      tagFilter: "tomato"
    }),
    4
  );
});

test("the display-settings label describes opening, closing, and active filters", () => {
  assert.equal(
    getDisplaySettingsToggleLabel(false, 0),
    "Show display settings"
  );
  assert.equal(
    getDisplaySettingsToggleLabel(false, 1),
    "Show display settings, 1 active filter"
  );
  assert.equal(
    getDisplaySettingsToggleLabel(false, 2),
    "Show display settings, 2 active filters"
  );
  assert.equal(
    getDisplaySettingsToggleLabel(true, 2),
    "Hide display settings"
  );
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  filterPages,
  isPathInFolder,
  passesFolderSettings
} from "../src/core/filters/filterPages";
import { makePage } from "./helpers";

test("folder matching respects path boundaries", () => {
  assert.equal(isPathInFolder("Projects/A.md", "Projects"), true);
  assert.equal(isPathInFolder("Projects-old/A.md", "Projects"), false);
});

test("exclude folders take precedence over includes", () => {
  assert.equal(passesFolderSettings("Notes/A.md", [], []), true);
  assert.equal(
    passesFolderSettings("Notes/Private/A.md", ["Notes"], ["Notes/Private"]),
    false
  );
  assert.equal(passesFolderSettings("Archive/A.md", ["Notes"], []), false);
});

test("folder, tag, link target, and query filters combine with AND", () => {
  const matching = makePage({
    path: "Notes/CVC alpha.md",
    title: "CVC alpha",
    folder: "Notes",
    tags: ["#work"],
    outlinks: ["Reference.md"]
  });
  const wrongTag = makePage({
    path: "Notes/CVC beta.md",
    title: "CVC beta",
    folder: "Notes",
    tags: ["#home"],
    outlinks: ["Reference.md"]
  });

  assert.deepEqual(
    filterPages([matching, wrongTag], {
      folder: "Notes",
      tag: "#work",
      linkTarget: "Reference.md",
      query: "ＣＶＣ alpha"
    }).map((page) => page.path),
    [matching.path]
  );
});

test("filtering does not mutate or reorder the input", () => {
  const pages = [makePage({ path: "B.md" }), makePage({ path: "A.md" })];
  const originalPaths = pages.map((page) => page.path);

  filterPages(pages, { query: "missing" });

  assert.deepEqual(pages.map((page) => page.path), originalPaths);
});

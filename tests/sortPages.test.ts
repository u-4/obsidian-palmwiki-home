import assert from "node:assert/strict";
import test from "node:test";
import { sortPages } from "../src/core/sort/sortPages";
import { makePage } from "./helpers";

test("pinned pages remain first in both sort directions", () => {
  const pages = [
    makePage({ path: "Low.md", title: "Low", modifiedTime: 1 }),
    makePage({ path: "Pinned.md", title: "Pinned", modifiedTime: 2, pinned: true }),
    makePage({ path: "High.md", title: "High", modifiedTime: 3 })
  ];

  assert.equal(sortPages(pages, { key: "modified", direction: "asc" })[0]?.path, "Pinned.md");
  assert.equal(sortPages(pages, { key: "modified", direction: "desc" })[0]?.path, "Pinned.md");
});

test("PageRank ties use inlinks and modified time deterministically", () => {
  const pages = [
    makePage({ path: "A.md", pageRank: 0.5, inlinkCount: 2, modifiedTime: 100 }),
    makePage({ path: "B.md", pageRank: 0.5, inlinkCount: 3, modifiedTime: 50 }),
    makePage({ path: "C.md", pageRank: 0.5, inlinkCount: 3, modifiedTime: 200 })
  ];

  assert.deepEqual(
    sortPages(pages, { key: "pageRank", direction: "desc" }).map((page) => page.path),
    ["C.md", "B.md", "A.md"]
  );
});

test("sorting uses numeric titles and leaves the input unchanged", () => {
  const pages = [
    makePage({ path: "Page 10.md", title: "Page 10" }),
    makePage({ path: "Page 2.md", title: "Page 2" })
  ];
  const original = [...pages];

  assert.deepEqual(
    sortPages(pages, { key: "title", direction: "asc" }).map((page) => page.title),
    ["Page 2", "Page 10"]
  );
  assert.deepEqual(pages, original);
});

test("all remaining numeric sort keys support ascending and descending order", () => {
  const cases = [
    ["created", { createdTime: 1 }, { createdTime: 2 }],
    ["lines", { lineCount: 1 }, { lineCount: 2 }],
    ["chars", { charCount: 1 }, { charCount: 2 }],
    ["inlinks", { inlinkCount: 1 }, { inlinkCount: 2 }],
    ["outlinks", { outlinkCount: 1 }, { outlinkCount: 2 }]
  ] as const;

  for (const [key, lowValues, highValues] of cases) {
    const low = makePage({ path: `${key}-low.md`, ...lowValues });
    const high = makePage({ path: `${key}-high.md`, ...highValues });

    assert.deepEqual(
      sortPages([high, low], { key, direction: "asc" }).map((page) => page.path),
      [low.path, high.path]
    );
    assert.deepEqual(
      sortPages([low, high], { key, direction: "desc" }).map((page) => page.path),
      [high.path, low.path]
    );
  }
});

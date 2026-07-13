import assert from "node:assert/strict";
import test from "node:test";
import {
  getTitleSuggestions,
  MAX_TITLE_SUGGESTIONS
} from "../src/core/search/titleSuggestions";
import { makePage } from "./helpers";

test("empty query returns recent existing Markdown pages in order without duplicates", () => {
  const pages = Array.from({ length: 12 }, (_, index) =>
    makePage({ path: `Notes/${index}.md`, title: `Page ${index}` })
  );
  const recentPaths = [
    "Missing.md",
    "Notes/0.md",
    "Notes/0.md",
    ...pages.slice(1).map((page) => page.path)
  ];

  const suggestions = getTitleSuggestions(pages, recentPaths, "   ");

  assert.equal(suggestions.length, MAX_TITLE_SUGGESTIONS);
  assert.deepEqual(
    suggestions.map((suggestion) => suggestion.path),
    pages.slice(0, MAX_TITLE_SUGGESTIONS).map((page) => page.path)
  );
  assert.ok(suggestions.every((suggestion) => suggestion.matchKind === "recent"));
});

test("recent suggestions skip deleted, out-of-scope, and non-Markdown paths", () => {
  const included = makePage({ path: "Notes/Included.md", title: "Included" });
  const nonMarkdown = makePage({ path: "Files/Manual.pdf", title: "Manual" });

  const suggestions = getTitleSuggestions(
    [included, nonMarkdown],
    ["Deleted.md", "Excluded/Outside.md", nonMarkdown.path, included.path],
    ""
  );

  assert.deepEqual(suggestions.map((suggestion) => suggestion.path), [included.path]);
});

test("title search uses basename and aliases but reports the matching alias", () => {
  const aliasPage = makePage({
    path: "Medicine/Acetaminophen.md",
    title: "Acetaminophen",
    aliases: ["Tylenol"]
  });
  const basenamePage = makePage({
    path: "Notes/File name.md",
    title: "Frontmatter title",
    basename: "File name"
  });

  assert.deepEqual(getTitleSuggestions([aliasPage], [], "tylenol"), [
    {
      path: aliasPage.path,
      title: aliasPage.title,
      aliasMatch: "Tylenol",
      matchKind: "exact",
      score: 600
    }
  ]);

  const basenameResult = getTitleSuggestions([basenamePage], [], "FILE NAME");
  assert.equal(basenameResult[0]?.path, basenamePage.path);
  assert.equal(basenameResult[0]?.aliasMatch, null);
  assert.equal(basenameResult[0]?.matchKind, "exact");
});

test("normalization treats width, case, hiragana, and katakana as equivalent", () => {
  const page = makePage({
    path: "Notes/Kana.md",
    title: "カタカナＡＢＣ"
  });

  const [suggestion] = getTitleSuggestions([page], [], "かたかなabc");

  assert.equal(suggestion?.matchKind, "exact");
  assert.equal(suggestion?.path, page.path);
});

test("text match kinds rank exact before prefix, substring, subsequence, and fuzzy", () => {
  const pages = [
    makePage({ path: "Matches/Fuzzy.md", title: "Alpah" }),
    makePage({ path: "Matches/Subsequence.md", title: "A-l-p-h-a" }),
    makePage({ path: "Matches/Substring.md", title: "Notes about Alpha" }),
    makePage({ path: "Matches/Prefix.md", title: "Alphabet" }),
    makePage({ path: "Matches/Exact.md", title: "Alpha" })
  ];

  const suggestions = getTitleSuggestions(pages, [], "alpha");

  assert.deepEqual(
    suggestions.map((suggestion) => suggestion.matchKind),
    ["exact", "prefix", "substring", "subsequence", "fuzzy"]
  );
});

test("body text and tags alone never produce title suggestions", () => {
  const page = makePage({
    path: "Notes/Unrelated.md",
    title: "Unrelated title",
    aliases: [],
    description: "A hidden xylophone in the body",
    tags: ["#xylophone"],
    filterText: "unrelated title xylophone"
  });

  assert.deepEqual(getTitleSuggestions([page], [], "xylophone"), []);
});

test("PageRank and modified time are weak deterministic tie-breakers", () => {
  const pages = [
    makePage({
      path: "Topics/A.md",
      title: "Topic",
      pageRank: 1,
      modifiedTime: 100
    }),
    makePage({
      path: "Topics/B.md",
      title: "Topic",
      pageRank: 2,
      modifiedTime: 50
    }),
    makePage({
      path: "Topics/C.md",
      title: "Topic",
      pageRank: 1,
      modifiedTime: 200
    })
  ];
  const pagesBefore = JSON.stringify(pages);
  const recentPaths: string[] = [];
  const recentPathsBefore = JSON.stringify(recentPaths);

  const first = getTitleSuggestions(pages, recentPaths, "topic");
  const second = getTitleSuggestions(pages, recentPaths, "topic");

  assert.deepEqual(first, second);
  assert.deepEqual(
    first.map((suggestion) => suggestion.path),
    ["Topics/B.md", "Topics/C.md", "Topics/A.md"]
  );
  assert.equal(JSON.stringify(pages), pagesBefore);
  assert.equal(JSON.stringify(recentPaths), recentPathsBefore);
});

test("large page collections still return at most ten suggestions", () => {
  const pages = Array.from({ length: 7_000 }, (_, index) =>
    makePage({
      path: `Archive/Alpha ${index}.md`,
      title: `Alpha ${index}`,
      indexOrder: index
    })
  );

  const suggestions = getTitleSuggestions(pages, [], "alpha");

  assert.equal(suggestions.length, MAX_TITLE_SUGGESTIONS);
  assert.ok(suggestions.every((suggestion) => suggestion.matchKind === "prefix"));
});

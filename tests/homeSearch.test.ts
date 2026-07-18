import assert from "node:assert/strict";
import test from "node:test";
import { MAX_FULL_TEXT_QUERY_EDITOR_LENGTH } from "../src/core/search/fullTextSearch";
import {
  canUseFullTextSearchIndex,
  captureSearchPageCreationContext,
  clearPalmWikiHomeSearchState,
  createPalmWikiHomeSearchState,
  hasExactPageName,
  isPalmWikiHomeSearchActive,
  isSearchPageCreationContextCurrent,
  shouldClearFullTextSearchResults,
  validateNewPageName
} from "../src/homeSearch";
import { makePage } from "./helpers";

test("exact page detection checks titles, basenames, and aliases with normalization", () => {
  const pages = [
    makePage({
      path: "Notes/File name.md",
      title: "Ｆｒｏｎｔｍａｔｔｅｒ Title",
      basename: "File name",
      aliases: ["Alternative name"]
    })
  ];

  assert.equal(hasExactPageName(pages, "frontmatter title"), true);
  assert.equal(hasExactPageName(pages, "FILE NAME"), true);
  assert.equal(hasExactPageName(pages, " alternative name "), true);
  assert.equal(
    hasExactPageName([makePage({ path: "カタカナ.md", title: "カタカナ" })], "かたかな"),
    true
  );
  assert.equal(hasExactPageName(pages, "different"), false);
  assert.equal(hasExactPageName(pages, "   "), false);
});

test("new page names reject unsafe cross-platform file names without changing input", () => {
  assert.equal(validateNewPageName("New page"), null);
  assert.equal(validateNewPageName("検索結果"), null);
  assert.match(validateNewPageName("Folder/Page") ?? "", /not safe/i);
  assert.match(validateNewPageName("Question?") ?? "", /not safe/i);
  assert.match(validateNewPageName("line\u0007break") ?? "", /not safe/i);
  assert.match(validateNewPageName("CON") ?? "", /Windows/i);
  assert.match(validateNewPageName("nul.notes") ?? "", /Windows/i);
  assert.match(validateNewPageName("COM9") ?? "", /Windows/i);
  assert.match(validateNewPageName("Trailing. ") ?? "", /period or space/i);
  assert.match(validateNewPageName("   ") ?? "", /enter a page name/i);
  assert.match(validateNewPageName("..") ?? "", /different/i);
});

test("new page names have a bounded UTF-8 file component length", () => {
  assert.equal(validateNewPageName("a".repeat(230)), null);
  assert.match(validateNewPageName("あ".repeat(100)) ?? "", /too long/i);
});

test("page creation context rejects a changed view or navigation state", () => {
  const sourceView = {};
  const context = captureSearchPageCreationContext(sourceView, {
    type: "palmwiki-home-view",
    state: { searchQuery: "new page" }
  });
  assert.ok(context);

  assert.equal(
    isSearchPageCreationContextCurrent(context, sourceView, {
      type: "palmwiki-home-view",
      state: { searchQuery: "new page" }
    }),
    true
  );
  assert.equal(
    isSearchPageCreationContextCurrent(context, {}, {
      type: "palmwiki-home-view",
      state: { searchQuery: "new page" }
    }),
    false
  );
  assert.equal(
    isSearchPageCreationContextCurrent(context, sourceView, {
      type: "markdown",
      state: { file: "Other.md" }
    }),
    false
  );
  const circular: { self?: unknown } = {};
  circular.self = circular;
  assert.equal(captureSearchPageCreationContext(sourceView, circular), null);
});

test("search results and create-page actions are disabled after a fatal index error", () => {
  const ready = { phase: "ready" as const, indexedCount: 12 };
  const recoverableError = { phase: "error" as const, indexedCount: 12 };
  const fatalError = { phase: "error" as const, indexedCount: 0 };

  assert.equal(canUseFullTextSearchIndex(ready), true);
  assert.equal(shouldClearFullTextSearchResults(ready), false);
  assert.equal(canUseFullTextSearchIndex(recoverableError), true);
  assert.equal(shouldClearFullTextSearchResults(recoverableError), false);
  assert.equal(canUseFullTextSearchIndex(fatalError), false);
  assert.equal(shouldClearFullTextSearchResults(fatalError), true);
});

test("Markdown header submissions become a bounded PalmWiki Home search state", () => {
  assert.deepEqual(createPalmWikiHomeSearchState("  airway guideline  "), {
    searchQuery: "airway guideline",
    submittedSearchQuery: "airway guideline"
  });
  assert.deepEqual(createPalmWikiHomeSearchState("   "), {
    searchQuery: "",
    submittedSearchQuery: ""
  });
  const bounded = createPalmWikiHomeSearchState("a".repeat(400));
  assert.equal(bounded.searchQuery.length, MAX_FULL_TEXT_QUERY_EDITOR_LENGTH);
  assert.equal(bounded.submittedSearchQuery, bounded.searchQuery);
});

test("Home button search reset preserves Home display and filter state", () => {
  const searchState = {
    searchQuery: "airway guideline",
    submittedSearchQuery: "airway guideline",
    searchResultLimit: 300,
    quickFilterQuery: "#guideline",
    viewMode: "table"
  };

  assert.equal(isPalmWikiHomeSearchActive(searchState), true);
  const homeState = clearPalmWikiHomeSearchState(searchState, 100);
  assert.notEqual(homeState, searchState);
  assert.deepEqual(homeState, {
    searchQuery: "",
    submittedSearchQuery: "",
    searchResultLimit: 100,
    quickFilterQuery: "#guideline",
    viewMode: "table"
  });
  assert.equal(isPalmWikiHomeSearchActive(homeState), false);
  assert.equal(searchState.submittedSearchQuery, "airway guideline");
  assert.equal(isPalmWikiHomeSearchActive({ submittedSearchQuery: "  " }), false);
  assert.equal(isPalmWikiHomeSearchActive({ submittedSearchQuery: 42 }), false);
  assert.equal(isPalmWikiHomeSearchActive(null), false);
});

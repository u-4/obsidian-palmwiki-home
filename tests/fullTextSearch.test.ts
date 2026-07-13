import assert from "node:assert/strict";
import test from "node:test";
import {
  findRawBodySearchMatch,
  getFullTextQueryValidationError,
  getRawBodySearchSnippet,
  getRawBodySearchSnippetFromMatch,
  getRawTextHighlightRanges,
  limitFullTextQueryEditorInput,
  limitFullTextQueryInput,
  MAX_FULL_TEXT_QUERY_EDITOR_LENGTH,
  MAX_DIRECT_RELATION_EDGE_VISITS_PER_TERM,
  MAX_FULL_TEXT_QUERY_LENGTH,
  MAX_FULL_TEXT_QUERY_TERMS,
  MAX_TWO_HOP_RELATION_EDGE_VISITS_PER_TERM,
  parseFullTextQuery,
  refreshFullTextSearchResultPages,
  searchFullText,
  type FullTextSearchDocument
} from "../src/core/search/fullTextSearch";
import type { PageRecord } from "../src/core/index/PageRecord";
import { normalizeSearchText } from "../src/core/search/normalizeText";

test("query parsing supports normalization, phrases, AND terms, and exclusions", () => {
  assert.deepEqual(
    parseFullTextQuery(' 気道 "診療 ガイドライン" -日記 -"症例 報告" ＣＶＣ '),
    {
      positive: [
        { phrase: false, value: "気道" },
        { phrase: true, value: "診療 ガイドライン" },
        { phrase: false, value: "cvc" }
      ],
      negative: [
        { phrase: false, value: "日記" },
        { phrase: true, value: "症例 報告" }
      ]
    }
  );
});

test("query parsing bounds pasted text and accepted terms before searching", () => {
  const manyTerms = Array.from(
    { length: MAX_FULL_TEXT_QUERY_TERMS + 4 },
    (_, index) => `term${index}`
  ).join(" ");
  const parsed = parseFullTextQuery(manyTerms);

  assert.equal(parsed.positive.length + parsed.negative.length, MAX_FULL_TEXT_QUERY_TERMS);
  assert.equal(parsed.positive.at(-1)?.value, `term${MAX_FULL_TEXT_QUERY_TERMS - 1}`);

  const longInput = `${"a".repeat(MAX_FULL_TEXT_QUERY_LENGTH)} ignored`;
  assert.equal(limitFullTextQueryInput(longInput).length, MAX_FULL_TEXT_QUERY_LENGTH);
  assert.equal(
    limitFullTextQueryEditorInput(longInput).length,
    MAX_FULL_TEXT_QUERY_EDITOR_LENGTH
  );
  assert.match(
    getFullTextQueryValidationError(limitFullTextQueryEditorInput(longInput)) ?? "",
    /256 characters/
  );
  assert.deepEqual(parseFullTextQuery(longInput), {
    positive: [{ phrase: false, value: "a".repeat(MAX_FULL_TEXT_QUERY_LENGTH) }],
    negative: []
  });

  assert.equal(
    getFullTextQueryValidationError("a".repeat(MAX_FULL_TEXT_QUERY_LENGTH)),
    null
  );
  assert.match(
    getFullTextQueryValidationError("a".repeat(MAX_FULL_TEXT_QUERY_LENGTH + 1)) ?? "",
    /256 characters/
  );
  assert.equal(
    getFullTextQueryValidationError(
      'one two three four -five -six "seven phrase" eight'
    ),
    null
  );
  assert.match(
    getFullTextQueryValidationError(
      'one two three four -five -six "seven phrase" eight nine'
    ) ?? "",
    /8 terms/
  );

  const page = makePage("Bounded.md", { title: "Bounded" });
  assert.deepEqual(
    searchFullText(
      [page],
      makeDocuments({ "Bounded.md": "needle" }),
      `needle ${"x".repeat(MAX_FULL_TEXT_QUERY_LENGTH)}`
    ),
    []
  );
});

test("raw body match re-resolves normalized text and prefers a line covering more terms", () => {
  const body = [
    "前文 ＣＶＣ",
    "困難気道について",
    "困難気道の診療ガイドライン"
  ].join("\n");

  assert.deepEqual(findRawBodySearchMatch(body, "気道 ガイドライン"), {
    fromCh: 2,
    line: 2,
    term: "気道",
    toCh: 4
  });
  assert.deepEqual(findRawBodySearchMatch(body, "cvc"), {
    fromCh: 3,
    line: 0,
    term: "cvc",
    toCh: 6
  });
  assert.equal(findRawBodySearchMatch(body, "存在しない"), null);
});

test("raw body matching maps half-width and decomposed voiced kana back to source offsets", () => {
  assert.deepEqual(findRawBodySearchMatch("ｶﾞｲﾄﾞ", "ガイド"), {
    fromCh: 0,
    line: 0,
    term: "ガイド",
    toCh: 5
  });
  assert.deepEqual(findRawBodySearchMatch("か\u3099いど", "がいど"), {
    fromCh: 0,
    line: 0,
    term: "がいど",
    toCh: 4
  });
});

test("raw snippets preserve the source case and compatibility-width characters", () => {
  const body = "前文\nNASAはＣＶＣガイドを更新した\n後文";

  assert.equal(
    getRawBodySearchSnippet(body, "nasa cvc"),
    "NASAはＣＶＣガイドを更新した"
  );
  const match = findRawBodySearchMatch(body, "nasa cvc");
  assert.ok(match);
  assert.equal(
    getRawBodySearchSnippetFromMatch(body, match),
    "NASAはＣＶＣガイドを更新した"
  );
  assert.deepEqual(getRawTextHighlightRanges("NASAはＣＶＣガイド", "nasa cvc"), [
    { from: 0, to: 4 },
    { from: 5, to: 8 }
  ]);
  assert.deepEqual(getRawTextHighlightRanges("ｶﾞｲﾄﾞ", "ガイド"), [
    { from: 0, to: 5 }
  ]);
});

test("raw snippets keep the match within a compact two-line display context", () => {
  const before = "前".repeat(80);
  const after = "後".repeat(80);
  const snippet = getRawBodySearchSnippet(`${before}検索語${after}`, "検索語");

  assert.ok(snippet);
  assert.equal(snippet, `…${"前".repeat(24)}検索語${"後".repeat(72)}…`);
  assert.deepEqual(getRawTextHighlightRanges(snippet, "検索語"), [
    { from: 25, to: 28 }
  ]);
});

test("the displayed body match and raw jump choose the same best-covered line", () => {
  const body = ["気道", "無関係な長い説明", "気道 ガイドライン"].join("\n");
  const page = makePage("Guide.md", { title: "Guide" });
  const result = searchFullText(
    [page],
    makeDocuments({ "Guide.md": body }),
    "気道 ガイドライン"
  )[0];
  const raw = findRawBodySearchMatch(body, "気道 ガイドライン");

  assert.equal(result?.firstBodyMatch?.line, 3);
  assert.equal(raw?.line, 2);
  assert.equal(result?.firstBodyMatch?.term, raw?.term);
});

test("phrases are contiguous, positive terms are ANDed, and negative terms exclude", () => {
  const pages = [
    makePage("Exact.md", { title: "Exact" }),
    makePage("Separated.md", { title: "Separated" }),
    makePage("Diary.md", { title: "日記" }),
    makePage("Missing.md", { title: "Missing" })
  ];
  const documents = makeDocuments({
    "Exact.md": "前文\n困難気道 ガイドライン",
    "Separated.md": "困難 気道 ガイドライン",
    "Diary.md": "困難気道 ガイドライン 日記",
    "Missing.md": "困難気道だけ"
  });

  const results = searchFullText(pages, documents, '"困難気道" ガイドライン -日記');

  assert.deepEqual(results.map((result) => result.page.path), ["Exact.md"]);
  assert.deepEqual(results[0]?.firstBodyMatch, {
    column: 1,
    line: 2,
    offset: 3,
    term: "困難気道"
  });
});

test("title, basename, alias, tag, path, and body fields are searchable", () => {
  const page = makePage("Notes/美容記録.md", {
    aliases: ["散髪メモ"],
    basename: "美容記録",
    tags: ["#生活"],
    title: "理容ログ"
  });
  const documents = makeDocuments({ "Notes/美容記録.md": "予約した美容院" });

  assert.ok(searchFullText([page], documents, "理容ログ")[0]?.matchedFields.includes("title"));
  assert.ok(searchFullText([page], documents, "美容記録")[0]?.matchedFields.includes("basename"));
  assert.ok(searchFullText([page], documents, "散髪")[0]?.matchedFields.includes("alias"));
  assert.ok(searchFullText([page], documents, "生活")[0]?.matchedFields.includes("tag"));
  assert.ok(searchFullText([page], documents, "notes")[0]?.matchedFields.includes("path"));
  assert.ok(searchFullText([page], documents, "美容院")[0]?.matchedFields.includes("body"));
});

test("page-name search treats hiragana and katakana consistently with suggestions", () => {
  const page = makePage("カタカナ.md", { title: "カタカナ" });

  const result = searchFullText([page], [], "かたかな")[0];

  assert.equal(result?.page.path, page.path);
  assert.ok(result?.matchedFields.includes("title"));
  assert.equal(result?.exactTitleMatches, 1);
});

test("散髪 ranks focused evidence ahead of diary noise and a broad hub", () => {
  const stubs = Array.from({ length: 120 }, (_, index) =>
    makePage(`Hub/Stub-${index}.md`, { indexOrder: index + 10 })
  );
  const pages = [
    makePage("散髪.md", { pageRank: 0.45, title: "散髪" }),
    makePage("美容院選び.md", {
      outlinks: ["散髪.md"],
      pageRank: 0.05,
      title: "美容院選び"
    }),
    makePage("2026-07-13 日記.md", {
      outlinks: stubs.slice(0, 30).map((page) => page.path),
      pageRank: 0.95,
      title: "2026-07-13 日記"
    }),
    makePage("総合目次.md", {
      outlinks: ["散髪.md", ...stubs.map((page) => page.path)],
      pageRank: 0.99,
      title: "総合目次"
    }),
    ...stubs
  ];
  const documents = makeDocuments({
    "散髪.md": "髪を切る",
    "美容院選び.md": "散髪 散髪 散髪の候補",
    "2026-07-13 日記.md": `散髪 ${"雑記 ".repeat(5000)}`
  });

  const results = searchFullText(pages, documents, "散髪");
  const paths = results.map((result) => result.page.path);

  assert.equal(paths[0], "散髪.md");
  assert.ok(paths.indexOf("美容院選び.md") < paths.indexOf("2026-07-13 日記.md"));
  assert.ok(paths.indexOf("美容院選び.md") < paths.indexOf("総合目次.md"));
  assert.ok(results.every((result) => result.score >= 0 && result.score <= 1));
});

test("気道 ガイドライン prefers complete focused evidence over 2-hop and diary results", () => {
  const pages = [
    makePage("困難気道管理ガイドライン.md", {
      pageRank: 0.55,
      title: "困難気道管理ガイドライン"
    }),
    makePage("挿管準備.md", {
      outlinks: ["困難気道管理ガイドライン.md"],
      pageRank: 0.65,
      title: "挿管準備"
    }),
    makePage("気道メモ.md", {
      outlinks: ["挿管準備.md"],
      pageRank: 0.8,
      title: "気道メモ"
    }),
    makePage("2026-07-12 日記.md", {
      pageRank: 0.95,
      title: "2026-07-12 日記"
    }),
    makePage("無関係.md", { pageRank: 1, title: "無関係" })
  ];
  const documents = makeDocuments({
    "困難気道管理ガイドライン.md": "気道管理の診療ガイドライン",
    "挿管準備.md": "気道 気道 気道の準備",
    "気道メモ.md": "気道 気道の所見",
    "2026-07-12 日記.md": `気道 ${"雑記 ".repeat(4000)} ガイドライン`
  });

  const results = searchFullText(pages, documents, "気道 ガイドライン");
  const paths = results.map((result) => result.page.path);
  const focusedTop = new Set(paths.slice(0, 2));

  assert.deepEqual(
    focusedTop,
    new Set(["困難気道管理ガイドライン.md", "挿管準備.md"])
  );
  assert.ok(paths.indexOf("気道メモ.md") < paths.indexOf("2026-07-12 日記.md"));
  assert.equal(paths.includes("無関係.md"), false);
  assert.equal(
    results.find((result) => result.page.path === "気道メモ.md")?.relations.some(
      (relation) => relation.term === "ガイドライン" && relation.hop === 2
    ),
    true
  );
});

test("レシピ トマト dampens a huge hub and keeps a specific 2-hop result useful", () => {
  const stubs = Array.from({ length: 120 }, (_, index) =>
    makePage(`索引/項目-${index}.md`, { indexOrder: index + 20 })
  );
  const pages = [
    makePage("レシピ.md", {
      outlinks: ["トマト.md", ...stubs.map((page) => page.path)],
      pageRank: 0.99,
      title: "レシピ"
    }),
    makePage("トマト.md", { pageRank: 0.5, title: "トマト" }),
    makePage("トマト卵炒め.md", {
      outlinks: ["レシピ.md"],
      pageRank: 0.5,
      title: "トマト卵炒め"
    }),
    makePage("料理メモ.md", {
      outlinks: ["レシピ.md", "トマト.md"],
      pageRank: 0.4,
      title: "料理メモ"
    }),
    makePage("夏の献立.md", {
      outlinks: ["夏野菜.md"],
      pageRank: 0.7,
      title: "夏の献立"
    }),
    makePage("夏野菜.md", {
      outlinks: ["トマト.md"],
      pageRank: 0.2,
      title: "夏野菜"
    }),
    ...stubs
  ];
  const documents = makeDocuments({
    "レシピ.md": "料理の入口",
    "トマト.md": "赤い野菜",
    "トマト卵炒め.md": "レシピの手順",
    "料理メモ.md": "[[レシピ]] [[トマト]]",
    "夏の献立.md": "レシピ レシピの候補"
  });

  const results = searchFullText(pages, documents, "レシピ トマト");
  const paths = results.map((result) => result.page.path);

  assert.ok(paths.slice(0, 2).includes("トマト卵炒め.md"));
  assert.ok(paths.slice(0, 2).includes("料理メモ.md"));
  assert.ok(paths.indexOf("夏の献立.md") < paths.indexOf("レシピ.md"));
  assert.equal(
    results.find((result) => result.page.path === "夏の献立.md")?.relations.some(
      (relation) => relation.term === "トマト" && relation.hop === 2
    ),
    true
  );
});

test("many 2-hop paths use the best path instead of accumulating hub authority", () => {
  const middles = Array.from({ length: 20 }, (_, index) =>
    makePage(`Middle-${index}.md`, {
      outlinks: ["概念.md"],
      title: `Middle ${index}`
    })
  );
  const candidate = makePage("関連候補.md", {
    outlinks: middles.map((page) => page.path),
    pageRank: 0.8,
    title: "関連候補"
  });
  const pages = [
    makePage("概念.md", { title: "概念" }),
    candidate,
    ...middles
  ];
  const documents = makeDocuments({ "関連候補.md": "関連 関連" });

  const result = searchFullText(pages, documents, "関連 概念").find(
    (item) => item.page.path === candidate.path
  );
  const relation = result?.relations.find((item) => item.term === "概念");

  assert.equal(relation?.hop, 2);
  assert.ok((relation?.score ?? 1) < 0.2);
  assert.ok((result?.breakdown.twoHop ?? 1) < 0.1);
});

test("a high PageRank page without direct or relation evidence is excluded", () => {
  const pages = [
    makePage("Relevant.md", { pageRank: 0.1, title: "散髪の記録" }),
    makePage("Unrelated.md", { pageRank: 1, title: "重要なハブ" })
  ];

  assert.deepEqual(
    searchFullText(pages, [], "散髪").map((result) => result.page.path),
    ["Relevant.md"]
  );
});

test("pinning breaks an exact relevance tie without overriding a stronger result", () => {
  const pages = [
    makePage("Strong.md", {
      pageRank: 0.8,
      title: "散髪",
      pinned: false
    }),
    makePage("Pinned tie.md", {
      pageRank: 0.4,
      title: "散髪メモ",
      pinned: true
    }),
    makePage("Unpinned tie.md", {
      pageRank: 0.4,
      title: "散髪メモ",
      pinned: false
    })
  ];

  const paths = searchFullText(pages, [], "散髪").map(
    (result) => result.page.path
  );

  assert.deepEqual(paths, ["Strong.md", "Pinned tie.md", "Unpinned tie.md"]);
});

test("a page supported only by a 2-hop path is excluded without direct search evidence", () => {
  const pages = [
    makePage("概念.md", { title: "概念" }),
    makePage("Middle.md", { outlinks: ["概念.md"], title: "Middle" }),
    makePage("PureTwoHop.md", {
      outlinks: ["Middle.md"],
      pageRank: 1,
      title: "Pure two hop"
    })
  ];

  const paths = searchFullText(pages, [], "概念").map((result) => result.page.path);

  assert.deepEqual(new Set(paths), new Set(["概念.md", "Middle.md"]));
  assert.equal(paths.includes("PureTwoHop.md"), false);
});

test("result order, score breakdown, and best relations are deterministic", () => {
  const pages = [
    makePage("Seed.md", { pageRank: 0.4, title: "散髪" }),
    makePage("B.md", { outlinks: ["Seed.md"], pageRank: 0.5, title: "B" }),
    makePage("A.md", { outlinks: ["Seed.md"], pageRank: 0.5, title: "A" })
  ];
  const documents = makeDocuments({ "A.md": "散髪", "B.md": "散髪" });
  const first = searchFullText(pages, documents, "散髪").map(snapshotResult);
  const second = searchFullText(
    [...pages].reverse(),
    [...documents].reverse(),
    "散髪"
  ).map(snapshotResult);

  assert.deepEqual(second, first);
});

test("dense relation traversal is bounded and deterministic", () => {
  const viaPaths = Array.from({ length: 200 }, (_, index) =>
    `Via-${index.toString().padStart(3, "0")}.md`
  );
  const candidatePaths = Array.from({ length: 200 }, (_, index) =>
    `Candidate-${index.toString().padStart(3, "0")}.md`
  );
  const seeds = Array.from({ length: 64 }, (_, index) =>
    makePage(`Seed-${index.toString().padStart(2, "0")}.md`, {
      outlinks: viaPaths,
      title: `Needle ${index}`
    })
  );
  const vias = viaPaths.map((path) =>
    makePage(path, { outlinks: candidatePaths })
  );
  const candidates = candidatePaths.map((path) => makePage(path));
  const pages = [...seeds, ...vias, ...candidates];
  const documents = makeDocuments(
    Object.fromEntries(candidatePaths.map((path) => [path, "needle evidence"]))
  );
  const firstDiagnostics = {
    directRelationEdgeVisits: 0,
    directRelationTermsCapped: 0,
    twoHopRelationEdgeVisits: 0,
    twoHopRelationTermsCapped: 0
  };
  const secondDiagnostics = {
    directRelationEdgeVisits: 0,
    directRelationTermsCapped: 0,
    twoHopRelationEdgeVisits: 0,
    twoHopRelationTermsCapped: 0
  };

  const first = searchFullText(pages, documents, "needle", firstDiagnostics).map(
    snapshotResult
  );
  const second = searchFullText(
    [...pages].reverse(),
    [...documents].reverse(),
    "needle",
    secondDiagnostics
  ).map(snapshotResult);

  assert.ok(
    firstDiagnostics.directRelationEdgeVisits <=
      MAX_DIRECT_RELATION_EDGE_VISITS_PER_TERM
  );
  assert.equal(
    firstDiagnostics.twoHopRelationEdgeVisits,
    MAX_TWO_HOP_RELATION_EDGE_VISITS_PER_TERM
  );
  assert.equal(firstDiagnostics.twoHopRelationTermsCapped, 1);
  assert.deepEqual(secondDiagnostics, firstDiagnostics);
  assert.deepEqual(second, first);
});

test("refreshing result pages updates pin state and equal-score order without a new search", () => {
  const initialPages = [
    makePage("A.md", { title: "Needle" }),
    makePage("B.md", { title: "Needle" })
  ];
  const initialResults = searchFullText(initialPages, [], "needle");
  const refreshed = refreshFullTextSearchResultPages(initialResults, [
    makePage("A.md", { title: "Needle", pinned: false }),
    makePage("B.md", { title: "Needle", pinned: true })
  ]);

  assert.deepEqual(
    refreshed.map((result) => result.page.path),
    ["B.md", "A.md"]
  );
  assert.equal(refreshed[0].page.pinned, true);
});

function makePage(path: string, overrides: Partial<PageRecord> = {}): PageRecord {
  const title = overrides.title ?? path.replace(/\.md$/, "");
  const basename = overrides.basename ?? path.split("/").pop()?.replace(/\.md$/, "") ?? title;
  const folderOffset = path.lastIndexOf("/");
  const folder = folderOffset >= 0 ? path.slice(0, folderOffset) : "";

  return {
    path,
    basename,
    title,
    aliases: [],
    folder,
    tags: [],
    createdTime: 100,
    modifiedTime: 200,
    lineCount: 1,
    charCount: 10,
    description: "",
    outlinks: [],
    inlinks: [],
    outlinkCount: overrides.outlinks?.length ?? 0,
    inlinkCount: overrides.inlinks?.length ?? 0,
    pageRank: 0,
    pinned: false,
    filterText: normalizeSearchText([title, path].join(" ")),
    sortTitle: normalizeSearchText(title),
    sortPath: normalizeSearchText(path),
    indexOrder: 0,
    ...overrides
  };
}

function makeDocuments(bodies: Record<string, string>): FullTextSearchDocument[] {
  return Object.entries(bodies).map(([path, body]) => ({
    path,
    normalizedBody: normalizeSearchText(body)
  }));
}

function snapshotResult(result: ReturnType<typeof searchFullText>[number]): unknown {
  return {
    breakdown: result.breakdown,
    coverageClass: result.coverageClass,
    matchedFields: result.matchedFields,
    path: result.page.path,
    relations: result.relations,
    score: result.score
  };
}

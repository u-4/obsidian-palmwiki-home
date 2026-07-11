# Phase 2 Performance Notes

## Scope

Phase 2 adds resolved Markdown graph metadata, static PageRank-like scoring, graph sort keys, and a link-target filter. It intentionally does not add body full-text search, OCR, multi-vault search, related-score computation, or MarkdownView top-bar injection.

## Performance Design

- Graph construction runs during `buildPageIndex()` only.
- Graph construction uses `metadataCache.resolvedLinks` and does not call `cachedRead()`.
- PageRank is computed once per index rebuild from the resolved graph and file modified times.
- React sort/filter/render paths read precomputed `PageRecord` fields and do not rebuild graph/PageRank.
- Card and table virtualization remain in place.
- Both virtualizers now clamp visible ranges after large result-set changes.
- Link-target suggestions search precomputed `filterText` and render at most 20 suggestions.
- Link-target filtering uses canonical path identity and checks precomputed `page.outlinks`.

## Debug Logs

When `Performance debug logging` is enabled, expected Phase 2 logs include:

- `[PalmWiki Home perf] graph build`
- `[PalmWiki Home perf] page rank`
- `[PalmWiki Home perf] index build`
- `[PalmWiki Home perf] filter`
- `[PalmWiki Home perf] sort asc`
- `[PalmWiki Home perf] sort direction`
- `[PalmWiki Home perf] card mount window`
- `[PalmWiki Home perf] table mount window`

`graph build` and `page rank` should appear during index rebuilds, not during ordinary sort, filter, or view-mode changes.

## Copied Real-Vault Observation

Before Phase 2, testing used a copied real vault with roughly 7,000 Markdown pages. Phase 1 virtualized card/table switching and sorting were reported smooth. The final idle/persistent-index candidate was retested in Obsidian with Computer Use on 2026-07-12; aggregate results are recorded below.

## 2026-07-12 Local Cache Benchmark

Using only aggregate timing and counts from the copied test Vault, without printing note titles or paths:

- persistent cache: 7,145 pages and 7,145 body entries, 12,691,624 bytes,
- local file read: 28 ms,
- JSON parse: 20 ms,
- JSON stringify: 18 ms,
- reconstructed graph: 7,145 nodes / 11,724 edges in 11.8 ms,
- PageRank computation: 15.3 ms.

These are isolated local command-line measurements, not a substitute for the final Obsidian UI test. They indicate that the synchronous cache, graph, and PageRank phases are tens of milliseconds rather than the multi-second tab delay under investigation.

## 2026-07-12 Obsidian UI Verification

The copied test Vault was opened as a new Obsidian window with `indexOnStartup` disabled. No note titles, paths, or bodies were retained in the test record.

- Three restored Markdown tabs opened without a `File not found` state.
- The persistent cache timestamp did not change before PalmWiki Home was opened, confirming no startup full-index write while Home was inactive.
- Saved-state transition: 7,145 cached pages became available before the validating rebuild started; the observed gap was about 0.77 seconds.
- Final warm run: cache load 76 ms, 7,145 page records, 7,145 valid body entries.
- Final validating rebuild: 1,198 ms, 7,145 body cache hits, 0 body reads, maximum concurrent body reads 0.
- Cache save after validation: 68 ms.
- Toolbar Refresh: 1,175 ms, 7,145 cache hits, 0 body reads, no pending follow-up rebuild.
- Card/Table, PageRank/Inlinks/Outlinks, Asc/Desc, and an empty-result Quick filter switched without indexing, error, or missing-file state.
- Opening a card and returning through the ribbon selected the existing Home view successfully.

An earlier run with exactly one file identity changed reused 7,144 body entries and read only that one file, with maximum concurrent body reads 1. Together with the bounded-concurrency unit test, this is consistent with the configured maximum of 2.

## Known Risk

Page records and body-derived metadata now persist in the Vault-local plugin cache. Date-label and image URL caches remain in memory. Future full-text search would require a separate storage design rather than expanding this derived-metadata JSON cache without profiling.

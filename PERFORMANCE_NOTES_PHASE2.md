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

Before Phase 2, testing used a copied real vault with roughly 7,000 Markdown pages. Phase 1 virtualized card/table switching and sorting were reported smooth.

Phase 2 has not yet been manually retested in Obsidian after this implementation. The next copied-vault check should confirm:

- tab return remains smooth,
- Card/Table switching remains smooth,
- PageRank/Inlinks/Outlinks sorting remains smooth,
- link-target typing and suggestion display remain responsive,
- graph/PageRank logs occur only on index rebuild.

## 2026-07-12 Local Cache Benchmark

Using only aggregate timing and counts from the copied test Vault, without printing note titles or paths:

- persistent cache: 7,145 pages and 7,145 body entries, 12,691,624 bytes,
- local file read: 28 ms,
- JSON parse: 20 ms,
- JSON stringify: 18 ms,
- reconstructed graph: 7,145 nodes / 11,724 edges in 11.8 ms,
- PageRank computation: 15.3 ms.

These are isolated local command-line measurements, not a substitute for the final Obsidian UI test. They indicate that the synchronous cache, graph, and PageRank phases are tens of milliseconds rather than the multi-second tab delay under investigation.

## Known Risk

Page records and body-derived metadata now persist in the Vault-local plugin cache. Date-label and image URL caches remain in memory. Future full-text search would require a separate storage design rather than expanding this derived-metadata JSON cache without profiling.

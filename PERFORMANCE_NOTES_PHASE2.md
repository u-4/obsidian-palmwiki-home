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

## Known Risk

The in-memory body cache, graph data, PageRank data, date-label cache, and image URL cache are not persisted across plugin reloads. This is acceptable for the current copied-vault scale, but should be revisited if future phases add larger body-derived indexes or full-text search.

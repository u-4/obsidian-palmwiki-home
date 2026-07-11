# PageRank V2 Notes

## Previous Behavior

The first Phase 2 PageRank used a Cosense-like static score with p95 clipping. In the copied real vault, high-degree diary or hub pages such as `日記` could become strong authority sources. Pages linked from those hubs were pushed high in PageRank sort, and many pages could display as `PR 1.000`.

Inlinks and Outlinks sorts were not the problem. Those should continue to reflect the factual resolved link graph.

## Why Hubs Dominated

The original authority component summed source backlink strength without reducing a source's influence by its outgoing link count. A page with many backlinks and many outgoing links therefore passed broad authority to many targets.

The p95 clipping normalization also turned all values above p95 into exactly `1.0`, creating visible score saturation and ties.

## New Formula

PalmWiki Home now keeps two graph concepts:

- Display graph: factual resolved Markdown links used for `inlinkCount`, `outlinkCount`, Inlinks sort, and Outlinks sort.
- PageRank graph: the display graph with PageRank-ignored source pages removed from authority propagation.

For each page:

```text
backlinkRaw(p) = log1p(prInDegree(p))

authorityRaw(p) = sum over source in prIn(p):
  log1p(prInDegree(source)) / max(1, prOutDegree(source))^0.85

outlinkRaw(p) = log1p(prOutDegree(p))

editRaw(p) = exp(-daysSinceModified(p) / 90)
```

Weights remain:

```text
0.40 backlink
0.25 hub-damped authority
0.15 outlink
0.20 edit/recency
```

The damping exponent `0.85` is a deliberate middle ground: strong enough to stop generic hubs from promoting every target, but not so strong that all source authority disappears.

## Normalization

The new normalization uses p95 as a scale, not a hard ceiling:

```text
normalized = raw / (raw + p95)
```

This is monotonic, keeps scores below `1.0`, preserves numeric ordering, and avoids mass ties at exactly `PR 1.000`.

## Ignored Source Settings

The settings pane now includes:

- `PageRank ignored source folders`
- `PageRank ignored source path patterns`
- `PageRank debug path`

Ignored source folders and path patterns affect PageRank authority only. They do not remove pages from Home and do not change factual Inlinks/Outlinks counts.

Path patterns are treated as regexes when valid. If regex compilation fails, the rule falls back to substring matching.

## Debug Aid

When `Performance debug logging` is enabled and `PageRank debug path` is set, the next index rebuild logs PageRank details for that file:

- raw feature values,
- normalized feature values,
- final score,
- ignored source count,
- top authority contributors with source in/out degrees and contribution.

## Performance Implications

PageRank still runs during index rebuild only. It uses `metadataCache.resolvedLinks` and file modified times, and does not read Markdown bodies. Sort, filter, and render paths use precomputed `PageRecord` values.

## Tradeoffs

- The score is a practical vault-ranking heuristic, not a literal Google PageRank.
- Ignore rules are manual and intentionally simple.
- Invalid regex patterns silently become substring rules.
- Target ignore rules are not implemented in this corrective patch.

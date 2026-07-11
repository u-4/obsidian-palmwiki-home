# Manual Test Plan

## Build Checks

- Run `npm run build`.
- Run `npm run eslint` if defined.
- Run `git diff --check`.

## PageRank Real-Vault Checks

- Open PalmWiki Home in a copied test vault with realistic data volume.
- Sort by PageRank descending.
- Confirm top results are not dominated by pages linked only from `日記` or diary-like hubs.
- Confirm there are not dozens or hundreds of visible records with exactly `PR 1.000`.
- Sort by Inlinks and confirm factual inlink-heavy pages still sort correctly.
- Sort by Outlinks and confirm factual outlink-heavy pages still sort correctly.
- Add a PageRank ignored source path pattern such as `(^|/)日記\\.md$`, or the relevant diary folder/pattern.
- Rebuild or refresh the PalmWiki Home index.
- Confirm pages previously boosted only by that source fall in PageRank order.
- Confirm displayed Inlinks and Outlinks counts remain unchanged.

## Synthetic Hub Check

Create a small test vault or folder with:

```text
Hub.md links to Target01..Target50
Daily01..Daily100 link to Hub.md
NormalSource01..NormalSource03 link to Important.md
Important.md links to a few specific notes
```

Expected:

- `Hub.md` may still show high factual inlinks.
- Targets linked only from `Hub.md` should not all become top-ranked solely because of `Hub.md`.
- Ignoring `Hub.md` as a PageRank source should reduce Hub-only target scores.
- Factual Inlinks/Outlinks counts should remain unchanged.

## Link-Target Dropdown Checks

- Open PalmWiki Home.
- Type a common query into `Links to page`.
- Confirm suggestions appear below the input.
- Confirm the input and adjacent controls remain visually stable.
- Confirm the dropdown has a stable width, max height, and scroll.
- Select a suggestion and confirm the link-target filter is applied.
- Press Escape and confirm the dropdown closes.
- Click outside and confirm the dropdown closes.
- Clear the filter and confirm all matching pages return.
- Switch Card/Table and confirm the UI remains smooth.

## Performance Regression Checks

- Home tab return after index is built remains fast.
- Card/Table switching remains smooth.
- PageRank sort does not rebuild the graph on every render.
- Toggling the link-target dropdown does not trigger index rebuild.
- With performance debug logging off, logs are quiet.
- With performance debug logging on, `graph build` and `page rank` logs appear during index rebuild only.
- If `PageRank debug path` is set, a contributor breakdown appears during index rebuild.

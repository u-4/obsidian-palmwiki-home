# Design Notes

## Plugin structure

`PalmWiki Home` is implemented as a standalone Obsidian community-plugin-style repository. It does not import or modify `2hop-links-plus`.

The adjacent 2Hop prototype was consulted read-only for behavioral risks. PalmWiki's leaf-owned manager and resolution behavior were substantially reworked for this specification, but general header-placement and guarded command-compatibility patterns were adapted from that MIT-licensed reference. Its complete notices are preserved in `THIRD_PARTY_NOTICES.md` and the production bundle. PalmWiki contains no 2Hop selector, settings access, import, or runtime integration.

The runtime entrypoint is `src/main.ts`. The code is split into:

- `src/core/index/` for `PageRecord` construction from vault files and metadata cache.
- `src/core/graph/` for resolved Markdown graph construction and static PageRank-like scoring.
- `src/core/sort/` for pinned-first stable sorting, including graph-derived sort keys.
- `src/core/filters/` for include/exclude folder checks and simple UI filters.
- `src/core/search/` for normalization, fuzzy page-name suggestions, full-text ranking, raw-source match resolution, and the independent search-cache schema.
- `src/settings/` for persisted plugin settings and the settings tab.
- `src/ui/` for the React-based custom view.
- `src/homeNavigation.ts` for Home target parsing, page resolution, left-header placement, button lifecycle, and Home scroll ownership.
- `src/obsidianCompat.ts` for the minimal runtime-checked boundary around Obsidian's command manager.
- `src/searchIndex.ts` for the lazy, differential full-text index lifecycle.
- `src/homeSearch.ts` and the search UI components for header placement, safe page-name validation, suggestions, and results.

## PageRecord fields

The central model is `PageRecord`. Its canonical identity is `path`, always based on `TFile.path`. `basename` and `title` are display-only fields. Pinning stores page paths, not basenames, so duplicate basenames in different folders remain distinct.

Tags are normalized with a leading `#` for consistent display and filtering.

Phase 2 adds graph-derived fields to each `PageRecord`: `outlinks`, `inlinks`, `outlinkCount`, `inlinkCount`, `pageRank`, and normalized `pageRankComponents`. These are computed during index rebuild and stored on the record so React sort/filter/render paths do not recompute graph data.

## Index building

`buildPageIndex()` enumerates Markdown files with `app.vault.getMarkdownFiles()`, applies include/exclude folder settings, reads file content with `cachedRead()`, and combines it with `metadataCache.getFileCache(file)`.

Index data is cached in plugin state. React components render from that cached index and do not call `cachedRead()` per card or table row. Rebuilds are triggered by view open, refresh command, toolbar refresh, startup only when explicitly enabled, settings changes that affect indexed pages, and relevant vault/metadata events while the Home view is open.

By default, the plugin does not run a full body index on Obsidian startup. The index starts dirty and is built lazily when PalmWiki Home is opened or when a refresh command/button is used. Automatic work is gated by `Workspace.onLayoutReady()`, two animation frames, a short delay, and `requestIdleCallback()`. The optional `indexOnStartup` setting still waits for layout readiness and idle time, and defaults to `false`.

Vault and metadata event handlers are registered only after `Workspace.onLayoutReady()` so the plugin does not treat every existing file announced during Vault startup as a new change. Automatic rebuild reservations are cancelled and coalesced when newer events arrive, while an existing background-capable request cannot be downgraded by a later interactive-only request. If the Home view becomes inactive, an interactive automatic build remains dirty or stops cooperatively at the next phase/file boundary instead of continuing in the background. `indexOnStartup` and explicit Refresh work are allowed to finish because they represent explicit background or user intent. Explicit Refresh actions remain immediate.

When Markdown files or metadata change while the Home view is closed or present in an inactive tab, the plugin marks the index dirty and does not immediately reread the vault. When the Home view is the active view, those changes schedule a debounced rebuild after 1500 ms. Manual refresh remains immediate, but still respects single-flight rebuild protection.

Opening an already-existing Home leaf reveals and explicitly activates that leaf without calling `setViewState()` again, avoiding unnecessary view reconstruction while ensuring the ribbon/command action actually selects Home.

When the Home tab becomes active and the index is dirty, the existing cached index is allowed to render first. A delayed rebuild is then scheduled after the first paint so returning to the tab does not synchronously block on a full rebuild.

Rebuilds are guarded by a sequence number so stale async results do not overwrite newer index state. Rebuilds are also single-flight: if a rebuild request arrives while `buildPageIndex()` is already running, the plugin records a merged pending rebuild instead of starting a second concurrent full rebuild. After the current rebuild finishes or cancels, one follow-up is scheduled with the normal debounce when the Home view is active or a background-capable request remains.

## Body metadata cache

The body-derived fields `lineCount`, `charCount`, and `description` are cached by `path`, `mtime`, and `size`, both in memory and in the Vault-local persistent index cache. If those values match on a later index pass or plugin restart, the plugin reuses the cached body-derived metadata and avoids another `cachedRead()` for that file. A body read captures the file identity before I/O and caches its result only if path, mtime, and size are still unchanged afterward. When performance debug logging is enabled, index builds report total milliseconds plus body cache hit/read counts.

Metadata-cache-derived fields are still refreshed on every index pass, including title, aliases, tags, first image, link counts, timestamps, and pinned status.

Body reads are concurrency-limited to 2 files at a time to reduce contention with Obsidian and other full-Vault plugins. Workers yield to the event loop after each 16 processed files so cache-heavy rebuilds also leave time for tab rendering and input.

## Persistent index cache

After a successful rebuild, the plugin saves `PageRecord` data and body-derived metadata to `index-cache.json` inside its Vault plugin directory. The write runs after the UI update and waits for idle time. It stores derived titles, tags, short descriptions, link metadata, and body statistics, not full Markdown bodies.

Cache entries include a schema version, save time, and a fingerprint of index-affecting settings. Invalid JSON, an old schema, or a settings mismatch is ignored without preventing plugin startup. At load time, records for missing Markdown files are removed, body metadata is reused only when path, mtime, and size still match, and current pin settings are overlaid. Cached pages are deliberately treated as stale: they can render first, then an idle rebuild revalidates current metadata, links, and PageRank. Ordinary vault/metadata notifications therefore mark the index dirty but do not abort an in-progress cache read; manual Refresh, scope-setting changes, and unload still invalidate that read when applying it would conflict with newer work.

## Full-text search index

Full-text search uses a second cache, `search-cache.json`, rather than expanding `index-cache.json`. Each entry stores canonical `TFile.path`, modified time, file size, and a locally normalized Markdown body. The schema, include/exclude fingerprint, 64 MiB persistent-size cap, validation, and failure recovery are independent from the display index. Before reading bodies, the manager rejects a scope containing a file above 8 MiB or more than 64 MiB of Markdown source; it also stops before estimated normalized-text RAM exceeds 128 MiB and never publishes the partial snapshot. Compatibility-normalization output is bounded before allocation/retention so a malformed cache cannot expand past that estimate. Scope changes, relevant modify/delete/rename events, invalid or stale hydration, and explicit full rebuilds purge the previous disk cache so old or newly excluded text is not left behind. Events wholly outside the configured search scope do not invalidate this cache.

The search manager is requested when a Home view opens, but waits for two-stage delay/idle scheduling before loading or reading bodies. Submitting a body search promotes the request to immediate work. Initial and changed-file reads use the same bounded concurrency of two and periodically yield to the event loop. Unchanged entries are reused only when path, modified time, and size match.

File create, modify, delete, rename, scope change, and manual rebuild each advance an input generation. A single-flight work loop discards an obsolete snapshot and repeats once for the newest generation; concurrent callers await the same promise. This prevents an entry removed by a live file event from being reintroduced by an older build. Read failures reach a stable error state and require Refresh or a later file change rather than creating an automatic retry loop.

Disk writes wait for 30 seconds of quiet time plus an idle callback. Persistent size is counted entry by entry before the full payload is serialized, and UTF-8 byte counting does not allocate a second full-size byte array. A pending scope purge is completed after any already-started write so stale full text cannot be the final file on disk. Search logging contains duration and aggregate counts only, never the query or note body.

A sanitized read-only benchmark over 7,147 Markdown pages (19,249,924 source bytes and 11,047,709 characters) estimated a 19,988,906-byte search cache. Standalone sequential read/normalization took about 22.1 seconds, while the three representative prepared-index queries completed in 32.3–64.3 ms. This establishes the expected scale, not UI compatibility; the real plugin still requires idle-build and warm-cache checks in Obsidian.

Query relation traversal is deterministic and bounded per positive term to 20,000 direct-link edge visits and 50,000 two-hop edge visits. This keeps dense hubs from monopolizing the UI thread; performance diagnostics report visits and capped-term counts, while the known limitations disclose that candidates beyond the cap may be omitted.

## Graph index

Phase 2 builds a resolved Markdown-to-Markdown graph during `buildPageIndex()`. It uses `app.metadataCache.resolvedLinks` and the current include/exclude-filtered Markdown path set. The graph computation does not call `cachedRead()`.

Rules:

- Only pages in the current indexed scope become graph nodes.
- Only resolved Markdown links whose source and destination are both in that scope become edges.
- Edges are unique per source/destination pair.
- Self-links are ignored for Phase 2 ranking.
- Tags and unresolved links are not graph edges in Phase 2.

The graph is represented as `paths`, `out`, and `in` maps keyed by canonical `TFile.path`. Phase 2.1 keeps this display graph intact for factual inlink/outlink counts, then derives a separate PageRank scoring graph with ignored sources removed from authority propagation.

## PageRank Approximation

Phase 2 implements a Cosense-like static page importance score, not iterative Google PageRank. Phase 2.1 adjusts the score to reduce diary/MOC/hub artifacts. For each page, the raw components are:

- `backlinks = log1p(inDegree)`
- `backlinkAuthority = sum(log1p(inDegree(source)) / max(1, outDegree(source))^0.85)` for all PageRank-eligible linking source pages
- `outlinks = log1p(outDegree)`
- `editFrequency = exp(-daysSinceModified / 90)`

The `0.85` damping exponent is intentionally strong enough to stop generic hub pages from passing full authority to every outgoing target, while still allowing a focused source page to contribute useful authority.

Each component uses p95 as a scale value, but does not hard-clip above p95:

```text
N(x) = x / (x + p95)
```

This keeps values in `[0, 1)` and avoids mass ties at exactly `PR 1.000`. The final score is:

```text
0.40 * backlinks + 0.25 * backlinkAuthority + 0.15 * outlinks + 0.20 * editFrequency
```

The final `pageRank` is clamped to 0..1. Normalized components are stored for future debugging/inspection. Performance debug logging emits separate `graph build` and `page rank` entries with timing, node count, edge count, and p95 values.

PageRank-only ignored source settings allow broad diary/journal/MOC sources to stop passing PageRank authority without changing displayed inlink/outlink counts:

- ignored source folders,
- ignored source path patterns, interpreted as regex with substring fallback,
- optional PageRank debug path for logging top authority contributors when performance debug logging is enabled.

## Settings

Settings are persisted through Obsidian plugin data and normalized after load/update. The Phase 1 settings include include/exclude folders, pinned page paths, default view/sort preferences, card display options, and card size. Home navigation adds `homeButtonLabel`, `homeButtonAction`, `homeButtonPagePath`, and `homeButtonCommandId`; missing 0.1.0 values receive safe defaults. These navigation-only settings do not change the index fingerprint or request a Vault rebuild.

The folder settings UI uses one folder path per line or comma-separated paths. Empty include folders means all folders; exclude folders win over include folders.

## UI

The custom view type is `palmwiki-home-view`, with display name `PalmWiki Home`.

`HomeNavigationManager` owns exactly one `.palmwiki-vault-home-button` per eligible Markdown or PalmWiki Home leaf. It enumerates split leaves on layout and active-leaf changes, excludes hover/popover contexts and all unrelated view types, updates label/title/ARIA state after settings changes, and removes its listeners and elements on view close or plugin unload. The unavoidable `.view-header-left` / title-container DOM placement is isolated in that module. Element creation, computed style, animation, and reduced-motion checks use each target element's `ownerDocument` and `defaultView` so pop-out windows do not use the main window accidentally.

Within the left header, the button is inserted immediately before `.view-header-title-container`, leaving Obsidian's Back/Forward controls to its left. PalmWiki Home adds a view-scoped container class that hides only `.view-header-title`; the remaining title container hosts the search control.

That reserved title-container now owns one `.palmwiki-home-search-host` per PalmWiki Home leaf. The host is isolated from hover/popover contexts and is recreated if a leaf moves to another `ownerDocument`, so outside-click listeners and timers bind to the pop-out window. The command `PalmWiki Home: Focus search` exposes Obsidian's normal user-configurable hotkey mechanism.

An empty focused search field displays up to ten paths from `Workspace.getLastOpenFiles()`. Typing computes up to ten title/basename/alias suggestions after a 100 ms delay. Exact, prefix, substring, subsequence, and bounded typo matches are ordered in that sequence; NFKC, case, and hiragana/katakana normalization are shared with exact-page detection. Old suggestions are disabled during the delay, so a fast Arrow/Enter sequence cannot open a candidate from the previous input.

Enter with no selected suggestion submits a body query. Positive whitespace-separated terms are ANDed, quoted terms remain contiguous, and a leading minus excludes a term or quoted phrase. Results are grouped by evidence completeness and then ranked with the following largest-to-smallest weighted contributions:

```text
0.45 * effective PageRank
0.35 * direct text/metadata match
0.15 * direct-link specificity
0.05 * best two-hop specificity
```

PageRank is attenuated when direct match quality is weak. Title, basename, alias, tag, path, and body evidence are inspectable in the result. Link specificity is damped by endpoint degree, and only the best path is kept, so multiple broad hubs do not accumulate authority. A pure two-hop candidate without body, page-name, or direct-link evidence is excluded. Pin state is used only after an exact relevance tie and never forces a weaker result above a stronger one.

Results initially render 100 rows and can grow to a hard maximum of 500. Visible body-match rows lazily reread only their current raw source to show an original-text snippet. The same bounded preview cache is reused on click. Before delayed navigation, the source view, state, active leaf, and per-leaf navigation generation are rechecked so an older read cannot overwrite a later user action.

Opening a result replaces the owning Home leaf. The raw body is re-resolved after NFKC normalization with source offsets mapped by normalization clusters. Multiple terms prefer the line containing the most terms. Source mode selects and scrolls the match; Reading view receives a best-effort line state because rendered-text selection has no stable public API.

If no page in the entire Vault has an equivalent title, basename, or alias, results show a create action. It opens an explicit confirmation modal, validates a cross-platform-safe filename, shows the destination returned by `FileManager.getNewFileParent()`, rechecks for races, and creates a blank Markdown file only after confirmation. Search never creates a note merely from Enter.

`PalmWikiHomeView.navigation` is enabled. Query draft/submission, result limit, view/sort/filter state are saved in ViewState, while the actual scroll offset is ephemeral state. Obsidian Back/Forward therefore reconstructs and reruns the saved search. A left-header Home transition supplies no saved state and intentionally starts fresh.

On Markdown leaves, the button either replaces the clicked leaf with `palmwiki-home-view`, opens a resolved existing Markdown file in that leaf, or activates that leaf and asks Obsidian's guarded command manager to execute the selected command. ViewState and ephemeral state are captured before Home/page transitions and restored best-effort on failure. Page resolution tries exact paths before interpreting Wiki alias/heading delimiters, never calls a file-creation API, and supports aliases from cached frontmatter. Ribbon and `Open home` command behavior remains separate: it still reveals an existing Home leaf or creates one only when none exists.

On PalmWiki Home leaves, the same button ignores the Markdown action setting and scrolls the nearest actual vertical Home container to the top. Reduced-motion preference selects immediate scrolling; otherwise smooth scrolling is allowed. The manager neither queries nor changes any 2Hop Links Plus class or DOM.

The toolbar contains:

- Card/Table mode toggle
- Sort key dropdown
- Sort direction toggle
- Folder filter
- Tag filter
- Simple title/path/tag quick filter
- Link target filter
- Refresh button

Card view renders a responsive Cosense-like grid with title, optional thumbnail, description, tags, folder/path, updated date, and pin button. Cards use a lightweight virtual grid so only the visible rows plus 3 overscan rows are mounted.

Card, Table, recent-page, title-suggestion, and search-result activation receive the owning `PalmWikiHomeView.leaf` explicitly and open the selected existing Markdown file in that same leaf. They share `openMarkdownFileInLeaf()`, which captures the original view state and restores it on failure where possible. Both Card and Table virtualizers locate scroll parents through the shared owner-document-aware helper.

Card preview uses Obsidian's registered hover-link source rather than reading or rendering the target note itself. `modifier` and `hover` use separate source IDs so Obsidian can retain the correct native modifier behavior for each mode; `off` emits no hover-link event. The active source is registered by the plugin and removed through the guarded compatibility boundary when the mode changes or the plugin unloads. The owning `PalmWikiHomeView` is the `HoverParent`, rather than its longer-lived workspace leaf, and unloads any remaining popover when the custom view closes. Card title/body emit previews, while the Pin button owns no preview handler. Preview settings do not invalidate or rebuild the page index.

Opening an existing note remains a standard `WorkspaceLeaf.openFile()` operation. PalmWiki Home does not manually trigger `file-open` or `active-leaf-change`, call another plugin, or wait for another plugin's DOM. A plugin that injects into a newly created Markdown view must treat those workspace events as file-selection notifications and independently wait until its own Markdown host exists; the adjacent 2Hop Links Plus readiness fix follows that generic boundary without PalmWiki-specific imports or data access.

Table view renders the requested columns: Page, Image, Description, Created, Updated, PageRank, Inlinks, Outlinks, Lines, Chars, Folder, and Tags. It is implemented as a div/CSS-grid virtual table with ARIA table roles rather than a native `<table>`, so only the visible rows plus overscan are mounted.

The outer card is a non-keyboard-interactive article. A dedicated title/body open area handles keyboard activation, and the pin button is a sibling control so keyboard pinning does not accidentally open the page.

Cards show compact graph badges for PageRank, inlink count, and outlink count without increasing fixed card height.

## Virtual table

`PageTable` now accepts the full filtered/sorted `visiblePages` array. It no longer receives a 1000-row slice and no longer depends on `Load more` as the primary performance guard.

Rows use a fixed 104 px height. The virtualizer measures the table body's position against the nearest vertical scroll parent, then mounts only the rows intersecting the viewport plus 8 overscan rows before and after the visible range. The initial mounted range is capped to 24 rows until the first measurement runs.

The table header is visually persistent where the surrounding Obsidian pane allows sticky positioning. The data rows use a shared CSS grid column definition so header and row cells stay aligned. Description text is clamped to 4 lines, and tags are capped to 8 visible tags with a `+N` overflow marker, keeping row height stable.

Page opening and pinning remain explicit button interactions inside each mounted row. Pin identity remains the page path, and the table row receives the same pinned visual outline as cards.

No `Load more` behavior remains in Phase 1 after table virtualization. A future explicit safety cap could be added if profiling shows pathological layouts, but the current implementation is designed to scroll the full filtered result set while mounting only the current window.

Copied-real-vault testing with roughly 7,000 Markdown pages found no noticeable hitch when switching Card/Table views after virtualization, and sorting remained smooth.

## Image URL cache

Image resource URLs are resolved lazily by mounted card/table rows only. The React root owns an in-memory cache keyed by image path. Repeated Card/Table switches reuse cached path-to-resource-URL values instead of calling `vault.getAbstractFileByPath()` and `vault.getResourcePath()` for every mounted row again.

The image URL cache is cleared when the page index timestamp changes, which keeps the cache conservative after rebuilds while preserving cache hits across view mode switches. Performance debug logs include cache hit/miss totals and cache size in card and table window logs.

## Date formatting

Date display now uses module-level `Intl.DateTimeFormat` instances and small timestamp-label caches for date and date-time labels. This avoids constructing new locale formatters or reformatting the same timestamps repeatedly during table/card remounts. The cache is capped at 10,000 entries per label type.

## Pinning

Pinning toggles the page path in `settings.pinnedPages`, saves settings, updates cached page records, and re-renders the view. Sorting always applies pinned-first ordering before the selected sort key.

Pinned paths are migrated on Markdown rename when the old path was pinned. Deleted or missing pinned Markdown paths are pruned on delete and after index rebuild. Pin identity remains `TFile.path`, not basename.

## Quick filter

The Phase 1 quick filter remains a lightweight title/path/folder/alias/tag filter separate from the header full-text search. It uses NFKC normalization and case folding, then treats whitespace-separated query tokens as AND terms. Its folder, tag, and link-target controls are also applied to submitted full-text results without rebuilding either index.

`PageRecord` stores precomputed `filterText`, `sortTitle`, `sortPath`, and `indexOrder` values at index-build time. Quick filter checks the tokenized query against `filterText`, avoiding per-render allocation and normalization of title/path/alias/tag field arrays.

The link target filter is a lightweight combobox-style input. It searches the existing `filterText` values and displays at most 20 suggestions instead of rendering a native select with all pages. Selecting a suggestion stores the canonical target path. Filtering then keeps only pages whose precomputed `outlinks` includes that selected path. Folder, tag, quick, and link-target filters combine as AND conditions.

The suggestion list is an anchored popover below the input. It has explicit React open/close state and closes on selection, Escape, and outside pointerdown. CSS keeps the toolbar overflow visible, gives the popover a stable width, max height, scroll, theme background/border/radius/shadow, and high z-index.

## Sorting

Sort uses a module-level `Intl.Collator` for text fallback comparison. Numeric sort keys return immediately when values differ. The stable fallback order is `sortTitle`, then `sortPath`, then `indexOrder`.

The React view computes a single ascending sorted array for the active sort key and filter set. Direction-only changes reuse that array and reverse pinned and unpinned groups separately, keeping pinned pages first without running another full comparator sort.

Phase 2 adds numeric sort keys for Page rank, Inlinks, and Outlinks. Default sort remains updated time descending.

## Performance debug

The `performanceDebug` setting defaults to `false`. When enabled, the plugin logs timing and count information with the prefix `[PalmWiki Home perf]`, including persistent cache load/save time and size, graph build time, page rank time, index build time, search-index reuse/read counts, full-text search time and result count, body cache hits/reads, filter time, sort time, visible result count, mounted card window size, mounted table window size, view mode changes, image URL cache hit/miss counts, view activation, and skipped inactive rebuilds. Full-text query strings and note bodies are not logged.

## Deferred work

The implementation intentionally defers OCR/attachment-content search, multi-vault search, vector/AI semantic search, synonym expansion, and native mobile compatibility claims.

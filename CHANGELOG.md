# Changelog

All notable changes to PalmWiki Home will be documented in this file.

The project uses versions from `manifest.json`.

## [Unreleased]

## [0.3.1] - 2026-07-13

- Unified Card, Table, recent-page, title-suggestion, and search-result activation on the owning PalmWiki Home leaf, with the same failure rollback path for existing Markdown files.
- Scoped Card preview ownership to the PalmWiki Home view and explicitly cleared any remaining preview when that view closes or is replaced.
- Kept note opening on Obsidian's public `WorkspaceLeaf.openFile()` path without re-emitting workspace events or adding a 2Hop Links Plus runtime dependency.

## [0.3.0] - 2026-07-13

- Added a Cosense-style Home-header search field with recent-page suggestions, fuzzy page-name completion, and an Obsidian-configurable `Focus search` command.
- Added local full-text search with AND, quoted phrase, and exclusion syntax, plus explainable title/body/tag/path, direct-link, two-hop, and PageRank-assisted ranking.
- Added a separate lazy differential `search-cache.json`, bounded two-file reads, stale-build cancellation, cache-scope purging, and runtime-data release guards without adding dependencies.
- Added same-leaf search-result opening, original-text snippets, Source-mode match selection, Back/Forward search-state restoration, and fresh state when returning through the Home button.
- Added an explicit confirmation flow for blank Markdown page creation in Obsidian's configured new-note location, with whole-Vault duplicate and filename safety checks.
- Fixed multi-line search results being collapsed to Obsidian's 30px button height, and made each result a distinct row with a one-line title, two-line highlighted snippet, and non-overlapping Pin control.
- Bounded full-text queries, normalization memory, and dense-graph relation traversal; avoided full-size byte-array duplication during cache sizing; restored scroll only after asynchronous results render; and cancelled stale page creation after its source Home tab changes.
- Strengthened public-repository governance with protected `main`, CI-required Pull Requests, Dependabot, Secret scanning, Push protection, private vulnerability reporting, and contributor/security documentation.
- Recorded that macOS Desktop is the only verified environment; iOS remains a future native-device check after search work, with iPhone Mirroring treated as supplementary only.

## [0.2.1] - 2026-07-12

- Fixed Home-button loss in a normal Markdown leaf when Hover Editor attaches its transient popover state to that source leaf; actual Hover Editor, Hover Preview, and popover containers remain excluded.
- Added configurable Card previews using Obsidian's standard Page preview, with Off, Cmd/Ctrl + hover, and hover-only modes while preserving Pin and same-leaf Card clicks.

## [0.2.0] - 2026-07-12

- Added a PalmWiki-owned upper-left Home button to normal Markdown and PalmWiki Home tabs, with configurable Home, existing-page, and Obsidian-command actions for Markdown.
- Added same-leaf rollback for header navigation, guarded command discovery/execution, searchable page and command choosers, and Home-view scroll-to-top behavior.
- Changed Card clicks in PalmWiki Home to replace the clicked Home tab with the selected Markdown page instead of selecting another tab.
- Added navigation, compatibility, settings-migration, scroll, cleanup, and no-file-creation tests without adding dependencies.
- Preserved the complete MIT notices for the adjacent 2Hop reference whose general header-placement and command-compatibility patterns informed this implementation; no runtime dependency was added.
- Placed the Home button after Obsidian's Back/Forward controls and hid the PalmWiki Home header title to reserve the center header area for future search UI.

## [0.1.0] - 2026-07-12

- Added the PalmWiki Home custom view, ribbon action, and command.
- Added cached Markdown indexing with include/exclude folder settings.
- Added virtualized Card and Table views for large vaults.
- Added pinned-first sorting, folder/tag/quick filters, and link-target filtering.
- Added resolved-link graph metadata, Inlinks/Outlinks sorts, and PageRank-like scoring.
- Added PageRank hub dampening, ignored-source settings, and performance diagnostics.
- Deferred automatic indexing until workspace layout and idle time, limited body reads to two concurrent files, and added a persistent derived-metadata index cache.
- Added cooperative cancellation for inactive view-triggered builds and preserved background intent when rebuild requests are coalesced.
- Kept ordinary metadata events from aborting the stale-first cache load, and made ribbon/command opening focus an existing Home leaf.
- Added automated coverage for cache validation, bounded-concurrency mapping, rebuild-request merging, and file-snapshot guards.
- Loaded the saved index as soon as Home opens while retaining idle-delayed validation, and added visible Waiting, Indexing, Complete, and Update failed states.
- Declared the initial release desktop-only with Obsidian Desktop 1.12.7 as the verified minimum.
- Added the official Obsidian ESLint rules, lifecycle and saved-data hardening, release metadata verification, and a draft-only release workflow.
- Added automated coverage for PageRank hub damping, filters, pinned sorting, saved settings, and index status transitions.
- Embedded the complete MIT notice for bundled React, React DOM, and Scheduler code in the production artifact.

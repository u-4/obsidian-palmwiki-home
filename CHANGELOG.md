# Changelog

All notable changes to PalmWiki Home will be documented in this file.

The project uses versions from `manifest.json`.

## [Unreleased]

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

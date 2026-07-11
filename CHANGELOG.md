# Changelog

All notable changes to PalmWiki Home will be documented in this file.

The project uses versions from `manifest.json`. It has not made a public release yet.

## 0.1.0 - Unreleased

- Added the PalmWiki Home custom view, ribbon action, and command.
- Added cached Markdown indexing with include/exclude folder settings.
- Added virtualized Card and Table views for large vaults.
- Added pinned-first sorting, folder/tag/quick filters, and link-target filtering.
- Added resolved-link graph metadata, Inlinks/Outlinks sorts, and PageRank-like scoring.
- Added PageRank hub dampening, ignored-source settings, and performance diagnostics.
- Deferred automatic indexing until workspace layout and idle time, limited body reads to two concurrent files, and added a persistent derived-metadata index cache.
- Added automated coverage for cache validation and bounded-concurrency mapping.

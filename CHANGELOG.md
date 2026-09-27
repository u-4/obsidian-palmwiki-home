# Changelog

## 1.0.0 — 2026-09-27

Rebuilt from the Lite prototype (formerly `palmwiki-home-lite` 0.2.0, PR #32).

- Plugin id is `palmwiki-home` again; command ids `open-home` and `focus-search` match 0.x, so existing hotkeys keep working. `focus-search` now opens the search command chosen in settings.
- The home is a Bases view (`palmwiki-lite-cards`) with progressive cards (24 → up to 300), excerpts and lazy local images.
- Removed: own full-text index and search cache, PageRank, header search field, table view, pins. Search and page switching are delegated to Omnisearch / Another Quick Switcher.
- The TypeScript/React build, CI and release workflows were removed; the plugin is one dependency-free `main.js`.

## 0.6.1 and earlier

See tag `0.6.1` and its release notes.

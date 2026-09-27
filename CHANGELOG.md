# Changelog

## 1.2.0 — 2026-09-27

- 「日誌を含む」 (on by default): turn it off to hide notes in the daily notes folder (read from Obsidian's Daily notes settings). The Project note itself always stays.
- In a Project/Area: 「リンクなしで名前を含むノートも」 adds notes that mention its name or an alias without linking (like Obsidian's unlinked mentions). Off by default; it reads note bodies once when turned on (about 4 s for 7,000 notes on a Mac) and keeps only the matching paths in memory.
- In a Project/Area: 「この中を本文検索」 narrows the cards to notes whose body contains all the words. Only that Project/Area's notes are read. Title search stays with Bases' own search in the toolbar, which already narrows these cards.
- Picker: completed Projects/Areas are hidden unless 「完了も表示」 is checked; a status menu filters by any status found (or 未設定).

## 1.1.0 — 2026-09-27

- Projects and Areas: pick one from a searchable list (name or alias; command `Open project or area`, or the button above the cards) to show only the notes linked to or from its note, with that note first. Project/Area notes are those tagged `Projects` or `Areas` (PARA-PKM's convention); favorites come first, completed ones last.
- Favorites: star a Project/Area to keep it as a one-tap chip above the cards. Favorites follow renames and are dropped when the note is deleted.
- The chosen Project/Area stays while you move around (Home keeps it); 「すべて」 clears it. It is not remembered across restarts.

## 1.0.0 — 2026-09-27

Rebuilt from the Lite prototype (formerly `palmwiki-home-lite` 0.2.0, PR #32).

- Plugin id is `palmwiki-home` again; command ids `open-home` and `focus-search` match 0.x, so existing hotkeys keep working. `focus-search` now opens the search command chosen in settings.
- The home is a Bases view (`palmwiki-lite-cards`) with progressive cards (24 → up to 300), excerpts and lazy local images.
- Removed: own full-text index and search cache, PageRank, header search field, table view, pins. Search and page switching are delegated to Omnisearch / Another Quick Switcher.
- The TypeScript/React build, CI and release workflows were removed; the plugin is one dependency-free `main.js`.

## 0.6.1 and earlier

See tag `0.6.1` and its release notes.

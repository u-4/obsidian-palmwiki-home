# Changelog

## 1.7.2 — 2026-10-04

- Home card popups open off a corner of the card instead of beside it: below-right, above-right, below-left or above-left, the first that fits in the window (else the one with the most room). The cards next to and below the pointed card stay uncovered, so the next one can be pointed at.

## 1.7.1 — 2026-10-04

- Home card popups: once one is open, pointing at another card switches to it (no Cmd needed; after 0.15 s so crossing a card on the way does not switch). Cmd+hover on a link inside a popup opens the next popup for the linked note below the link, and so on; they close together. Clicking any of them hands that note over to Hover Editor. Link hovers inside the popups are kept from Obsidian's own page preview, so Cmd over a link no longer opens Hover Editor as well.

## 1.7.0 — 2026-10-04

- Home cards: Cmd+hover shows a light, read-only preview (520×440, beside the card) instead of Hover Editor. It uses the same renderer as the search preview pane, so it appears in about 0.06 s. Clicking inside it (not on a link, and not after selecting text) switches to the editable preview (Hover Editor) through Obsidian's standard hover-link event, with a new hover source 「PalmWiki Home（軽いプレビューから編集へ）」 that needs no Cmd. Links inside open the note; Esc (through a key scope, since Obsidian takes Escape first), leaving the card and popup, or scrolling the home closes it. Setting 「ホームのカードは軽いプレビューで表示」 (on by default) turns it off.
- The note renderer of the search preview pane is now its own part (`NotePreview`), shared with the card popup.

## 1.6.0 — 2026-10-04

- Unified search: Shift+Enter makes the note named by the typed words (or opens it if it exists), whatever row is selected. This is the same key as Omnisearch's screen, so it works on both. The 新規作成 row shows the key in small text.

## 1.5.2 — 2026-10-04

- Text in the search preview pane (unified search and Omnisearch's screen) can be selected and copied. Obsidian turns off text selection across the app, and the pane inherited that.

## 1.5.1 — 2026-10-04

- Cards read the shared `--cosense-card-*` CSS variables (bg, title, text, border, hover-bg, min-width, gap, height, height-narrow, padding, radius, media-height), which 2hop-links-plus cards also use, so the Cosense-style CSS can style both at once. Each falls back to the previous value, so the look does not change until a variable is defined.
- `npm run deploy` also backs up `data.json`.

## 1.5.0 — 2026-09-28

- Omnisearch's search screen gets the same preview pane (setting 「Omnisearch の画面にもプレビューを表示」, on by default): the selected result is rendered beside the list, the query words are marked, and the pane scrolls to the first match. Omnisearch itself is not changed; the pane reads the selected result's `data-result-id`, and simply does not appear if that markup changes. Its screen is re-checked briefly after opening because Omnisearch builds the list a moment later.
- The preview pane is now one shared component. It waits for the screen to be laid out before the first preview (the unified search could miss its first preview).
- Fix: the unified search's selection helper no longer shadows Obsidian Modal's own `selection` property.

## 1.4.0 — 2026-09-28

- Unified search has a fixed preview pane beside the list, on by default (setting 「検索画面にプレビューを表示」). It shows the selected note (without frontmatter, up to 20,000 characters) through Obsidian's Markdown renderer and switches as the selection moves (about 0.1 s); 本文を検索 / 新規作成 rows show what Enter will do. Internal links in the pane open the note. Hidden on screens narrower than 760 px.
- Removed the Cmd-toggled hover previews in the search screen (1.3.2–1.3.5); they depended on Hover Editor's timing and did not always appear. Card hover previews on the home are unchanged.

## 1.3.5 — 2026-09-27

- Fix: in preview mode, moving to another row now shows that row's preview. The preview used to be requested while the arrow key event was still propagating, and Hover Editor cancels a pending preview (locking out new ones for a second) on any non-Cmd keydown. Previews are now requested 120 ms after the selection settles, and a locked-out popover no longer blocks the next one.

## 1.3.4 — 2026-09-27

- Unified search: tapping Cmd (Ctrl) toggles previews. While on, the preview follows the selected row (arrow keys, Ctrl+N/P, mouse) and hides on 本文を検索 / 新規作成 rows; tapping Cmd again turns it off. Cmd together with another key (Cmd+Enter, …) does not toggle.

## 1.3.3 — 2026-09-27

- Unified search previews last while Cmd is held: releasing Cmd, selecting another row (keyboard or mouse), or closing the screen closes the preview. Selection is watched on the result list because Obsidian consumes the arrow keys itself.

## 1.3.2 — 2026-09-27

- Unified search: press Cmd (Ctrl) to preview the selected note, or Cmd+hover a row, for recent notes and title/alias matches alike. Previews from the search screen sit above it and close with it.

## 1.3.1 — 2026-09-27

- Cards announce hovers through Obsidian's standard `hover-link` event, so page preview and Hover Editor work on them (Cmd+hover by default; the "PalmWiki Home" row under Settings → Page preview changes that). Nothing is read until a preview opens.

## 1.3.0 — 2026-09-27

- Unified search (trial), switchable in settings (「検索ボタンの動き」: 別々 / まとめる; default 別々). The 検索 button, ribbon icon and Cmd+G (`Open search`) follow the setting; `Open unified search (trial)` always opens the new screen.
  - Empty: recently opened notes (Obsidian's own list).
  - Typing: the first row 「本文を検索」 hands the words to Omnisearch's screen (its `obsidian://omnisearch` URL), so plain Enter searches bodies; move to a note with the arrow keys and Enter opens it. Notes match like Another Quick Switcher's Recent search (every word in the title or an alias; prefix, title, recently opened, modified), with Obsidian's fuzzy match only when nothing matches. Full/half width, case and hiragana/katakana are treated alike. 「新規作成」 when no note has that exact name.
  - Word suggestions from Various Complements (its vault words or custom dictionary, when enabled there) complete the last word. It has no public API, so its index is read defensively and gives nothing if absent.
- 「検索候補から外すフォルダ」 (default `99_System`).

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

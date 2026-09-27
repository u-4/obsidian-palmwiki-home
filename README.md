# PalmWiki Home

A lightweight, Cosense-style home for Obsidian. It shows your notes as cards in an Obsidian Bases view and puts Home, search and page-switch buttons at the top of every tab.

Obsidian 用の軽いホーム画面プラグインです。Bases のカード表示でノートを更新順に並べ、どのタブからも「ホーム」「検索」「移動」のボタンを使えるようにします。

1.0 is a rebuild. The 0.x line (full-text index, PageRank, header search) is kept at tag [`0.6.1`](../../releases/tag/0.6.1).

## Features

- A Bases view, **PalmWiki cards**: 24 cards at first, 24 more near the bottom, up to 300. Titles appear first; excerpts (up to 280 characters) and the first local PNG/JPEG/WebP image (2 MiB or less) load near the viewport.
- Lists, sorting and filters are Bases' job, so a `.base` file decides what the home shows. By default the home is `PalmWiki Home.base` at the vault root (all Markdown notes, newest first); it is created on the first Home click if missing.
- Home / search / switch buttons in normal workspace tabs, a ribbon icon, and commands (`Open home`, `Open search`, `Open page switcher`).
- Search and switch run a command you choose in settings, typically Omnisearch and Another Quick Switcher.
- Projects and Areas (1.1): notes tagged `Projects` or `Areas` in frontmatter can be picked from a searchable list, and the home then shows that note and the notes linked to or from it. Favorite ones stay as chips above the cards.
- Unified search (1.3, trial): one screen for recent notes, title/alias matches, a hand-off to Omnisearch for body search, and new-note creation, with a preview pane of the selected note (1.4). Switch between it and the two separate buttons in settings. The same pane is added to Omnisearch's screen, with the query words marked (1.5).
- Filters (1.2): include or hide daily notes; within a Project/Area, add unlinked mentions of its name and search the bodies of just those notes. Bases' toolbar search and filters narrow the cards as usual.
- No own search index, no persistent body cache, no network access.

## Install

Copy `main.js`, `manifest.json` and `styles.css` into `<vault>/.obsidian/plugins/palmwiki-home/` and enable **PalmWiki Home**. Requires Obsidian 1.10 or later (Bases custom views).

## Development

```sh
npm test            # syntax check + tests (Node 22+, no npm install needed)
npm run deploy      # owner's vault; backs up the installed files first
```

Known limitations: on iPhone the buttons can end up where they cannot be tapped; list position is not restored after the view is recreated.

## License

MIT

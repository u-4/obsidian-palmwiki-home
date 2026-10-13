# PalmWiki Home

A lightweight, Cosense-style home for Obsidian. It shows your notes as cards in an Obsidian Bases view and puts the Vault's name (Home) and a search button in every note's header.

Obsidian 用の軽いホーム画面プラグインです。Bases のカード表示でノートを更新順に並べ、どのノートのタイトルバーにも、Vault 名（ホームへ戻る）と検索のボタンを置きます。

1.0 is a rebuild. The 0.x line (full-text index, PageRank, header search) is kept at tag [`0.6.1`](../../releases/tag/0.6.1).

## Features

- A Bases view, **PalmWiki cards**: 24 cards at first, 24 more near the bottom, up to 300. Titles appear first; excerpts (up to 280 characters) and the first local PNG/JPEG/WebP image (2 MiB or less) load near the viewport.
- Lists, sorting and filters are Bases' job, so a `.base` file decides what the home shows. By default the home is `PalmWiki Home.base` at the vault root (all Markdown notes, newest first); it is created on the first Home click if missing.
- The Vault's name (or your own text, with a chosen icon) and a search icon beside the header's back/forward buttons, with the page title kept centred; icons only when the header is narrow. A ribbon icon and commands (`Open home`, `Open search`, `Open page switcher`).
- Search (the search icon, `Open search`, Cmd+G) opens the unified search. `Open page switcher` runs the command you choose (e.g. Another Quick Switcher), or Obsidian's quick switcher.
- Projects and Areas (1.1): notes tagged `Projects` or `Areas` in frontmatter can be picked from a searchable list, and the home then shows that note and the notes linked to or from it. Favorite ones stay as chips above the cards.
- Unified search: one screen for recent notes, title/alias matches and new-note creation (Shift+Enter). Its first row, 「本文を検索」, opens the body search (1.13): the notes containing every word, by default ordered with notes that link to the word (`[[語]]`) first, then by link rank (PageRank over Obsidian's links, empty pages included; daily notes count less and chosen folders sort lower), or newest first, or by name. Hiragana/katakana and full/half width are folded, and the words are highlighted in the lists and previews. Both screens show a preview of the selected note on wide screens; phones get no preview pane. No other search plugin is needed (Omnisearch was dropped in 1.14 because its in-memory index made Obsidian restart on the iPhone).
- Filters (1.2): include or hide daily notes; within a Project/Area, add unlinked mentions of its name and search the bodies of just those notes. Bases' toolbar search and filters narrow the cards as usual.
- No own search index, no persistent body cache, no network access.

## A short pause between Home and a note

Going from Home to a note, or back, can feel a little heavy: there is a pause of about 0.1 s. This is how Obsidian works when one tab switches between a Bases view (Home) and a normal note. The tab's view is rebuilt each time, and Obsidian builds the note's editor (tens of ms, even for a short note). Going from note to note does not have this pause. Since 1.11.1 the header and the tab show the name of the note being opened during the pause, instead of 「ファイルがありません」. Keeping Home in its own tab would avoid the pause, but it would change how Home works (notes would open in another tab), so PalmWiki Home does not do that.

Home とノートを行き来するとき、0.1秒ほどの間があり、「少し重い」「ちょっと引っかかる」と感じることがあります。これは、1つのタブで Bases の画面（Home）と通常のノートを切り替えるときの Obsidian の仕様です。切り替えのたびにタブの中の画面が作り直され、ノートの編集画面を作る時間（短いノートでも数十ミリ秒）がかかります。ノートからノートへの移動では、この間はありません。1.11.1 からは、この間もタイトルバーとタブに「ファイルがありません」ではなく、開こうとしているノートの名前を出します。Home を専用のタブに分ければこの間はなくなりますが、カードを押すとノートが別のタブに開くようになるなど使い方が変わるため、そうしていません。

## Install

Copy `main.js`, `manifest.json` and `styles.css` into `<vault>/.obsidian/plugins/palmwiki-home/` and enable **PalmWiki Home**. Requires Obsidian 1.10 or later (Bases custom views).

## Development

```sh
npm test            # syntax check + tests (Node 22+, no npm install needed)
npm run deploy      # owner's vault; backs up the installed files and data.json first
```

On touch devices, tap a Home card to open its note, or hold it for 0.5 seconds to read a preview. Moving your finger cancels the hold. The preview has Open note and Close buttons. Mouse hover previews retain their existing settings.

Known limitations: list position is not restored after the view is recreated.

## License

MIT

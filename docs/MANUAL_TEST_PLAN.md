# Manual Test Plan

## Compatibility scope

- Verified environment: Obsidian Desktop 1.12.7 on macOS, including the `PalmWiki_LocalTest` smoke and regression checks recorded in `MANUAL_TEST_CHECKLIST.md`.
- Not yet verified: Windows, Linux, iOS, and Android. Do not describe these environments as supported until an actual Obsidian installation has passed the relevant checks.
- iPhone Mirroring from macOS may be used for an early visual and basic-tap smoke test when available. It is supplementary only and cannot replace native iOS testing for touch, keyboard, background restoration, file operations, performance, or lifecycle behavior.
- Before a future compatibility claim, record OS/device, Obsidian version, plugin version, theme, core Page preview state, related plugins, approximate Vault size, result, and sanitized evidence.

### Desktop compatibility pass

- Repeat installation, enable/disable, restart, split, pop-out, Live Preview, Reading view, Card/Table, same-leaf navigation, Home-button ownership, and preview-mode checks on the minimum supported desktop version and the current Stable version.
- Run the same checks with and without `2hop-links-plus`; its controls and DOM must remain unchanged.

### iOS preflight and native confirmation

- A mirrored iPhone can be used before native testing to detect obvious layout, launch, tap, and scrolling problems.
- Native iOS confirmation must separately cover installation, plugin lifecycle, restored tabs, touch-only Card/Table operation, indexing states, settings, file selection, rotation, background/foreground transitions, and memory/performance.

## Build Checks

- Run `npm run build`.
- Run `npm run eslint` if defined.
- Run `npm test`.
- Run `npm run verify:metadata`.
- Run `git diff --check`.

## Home Button Ownership Checks

- Open several Markdown leaves in multiple splits, including inactive leaves, Live Preview, and Reading view.
- Confirm each eligible Markdown leaf has exactly one PalmWiki-styled button before its title.
- Confirm the left-header order is Back/Forward, PalmWiki Home button, then the note title.
- In a PalmWiki Home leaf, confirm the centered `PalmWiki Home` header text is hidden while the title-container area remains available.
- Confirm Canvas, Settings, unrelated custom views, Hover Preview, Hover Editor, and popovers do not receive the button.
- Leave `Home button label` empty and confirm the current Vault name is used; enter a custom label and confirm text, tooltip, and accessible label update on every eligible leaf without reopening it.
- Select `Open PalmWiki Home`, click a Markdown leaf's button, and confirm that exact leaf becomes PalmWiki Home without creating or selecting another Home leaf.
- Select `Open a page`, choose an existing Markdown file, and confirm it opens in the clicked leaf. Check a basename, Vault-relative path, `.md` path, Wiki link, alias, and heading target.
- Configure a missing page and confirm no file is created, the original Markdown view remains, and a Notice appears.
- Select `Run a command`, choose a command, and confirm choosing it does not execute it. Click the button in an inactive split and confirm that split becomes active before the command runs.
- Disable or remove the selected command, or choose one unavailable in the current context, and confirm the view stays unchanged with a Notice.
- Change only Home button settings with performance logging enabled and confirm no index rebuild or full-Vault body read starts.
- Open PalmWiki Home in Card and Table modes, scroll down, and click the left button. Confirm the same Home view returns to the top. Repeat with reduced motion enabled.
- Move an eligible leaf to a pop-out window and repeat label, action, and Home scroll checks.
- Close leaves, disable/reload the plugin, and confirm no duplicate or stale PalmWiki button remains.
- With 2Hop Links Plus installed, confirm its upper-right controls and DOM remain unchanged and PalmWiki Home still works after 2Hop Links Plus is disabled.

## Card Same-Leaf Checks

- Open two PalmWiki Home leaves in separate splits and make the other split active.
- Click a Card in one Home leaf and confirm that clicked Home leaf becomes the selected Markdown page, while the other split and tab count remain unchanged.
- Activate a Card title/body with Enter and Space and confirm the same-leaf behavior.
- Confirm the Card pin button still changes only pin state and does not open the page.
- Switch to Table and confirm the page-name button replaces that same Home leaf, while the
  other split and tab count remain unchanged.

## Card Preview Checks

- Confirm the Page preview core plugin is enabled.
- Select `Off`, hover Card title/body, and press Cmd/Ctrl while hovering. Confirm no preview appears.
- Select `Cmd/Ctrl + hover`. Confirm ordinary hover does not preview, then hold Cmd on macOS or Ctrl on Windows/Linux while hovering and confirm the correct existing Markdown page appears.
- Select `Hover` and confirm the correct page appears without a modifier.
- Confirm hovering or clicking the Pin button never opens a preview and changes only pin state.
- Confirm clicking a preview-enabled Card still replaces that same Home leaf, without creating another tab.
- Repeat in a pop-out window and confirm the preview is owned by that window and is removed when the pointer leaves.
- Open a preview, then click the Card. Confirm preview ownership is cleared with
  the Home view and does not remain attached to the resulting Markdown leaf.
- Change only `Card preview` with performance logging enabled and confirm no index rebuild or full-Vault body read starts.
- Disable the Page preview core plugin and confirm Card hover fails silently while Card click still works.
- With inline 2Hop Links Plus enabled, open Markdown from Card, Table, search
  result, recent/title suggestion, File Explorer, and Obsidian Search while Home
  is active. Confirm 2-hop content appears on the first open without another tab
  switch. Repeat in Live Preview, Source mode, and Reading view.

## Full-Text Search Checks

- Open PalmWiki Home and confirm the centered header title is replaced by one search field without changing Back/Forward/Home order.
- Focus the empty field and confirm up to ten recently opened existing Markdown pages appear in recent order.
- Type a partial page name, basename, alias, transposed spelling, full-width spelling, and hiragana spelling for a katakana title. Confirm candidates update after a short delay and stale candidates cannot be opened by immediate Arrow/Enter input.
- Use `PalmWiki Home: Focus search` from the command palette, assign a temporary Obsidian hotkey, and confirm it opens/reuses Home and focuses the correct leaf's field.
- Select a candidate with pointer and Arrow/Enter. Confirm the same Home leaf becomes that Markdown page and no tab is added.
- Leave candidates unselected and press Enter. Confirm a dedicated list appears and the header announces the result count to assistive technology.
- Verify whitespace AND, `"quoted phrase"`, `-excluded`, and `-"excluded phrase"` queries. Confirm no note is created merely by pressing Enter.
- Search `散髪`; confirm the linked concept page and daily notes that actually contain/link it rank ahead of broad diary/index noise.
- Search `気道 ガイドライン`; confirm a focused airway-guideline page and strongly linked pages rank ahead of a diary containing both words incidentally.
- Search `レシピ トマト`; confirm specific tomato recipes and preparation records rank ahead of a huge recipe hub.
- Inspect the evidence badges (`Page name`, `Body`, `Tag`, `Path`, `Direct link`, `2-hop`, `PR`). Confirm Pin changes only an exact tie and does not force a weak page above a stronger result.
- Confirm visible snippets preserve original uppercase/full-width text after their lazy load. Open a multi-term result and confirm Source mode selects the line containing the most terms.
- Repeat result opening in Reading view. Confirm a best-effort line jump occurs without requiring rendered-text highlighting.
- Click one result and immediately choose another page/tab while a large source read is pending. Confirm the delayed first click never overwrites the later action.
- Apply folder, tag, Quick filter, and `Links to page` controls during a submitted search. Confirm all filters combine with AND and neither graph nor search cache is rebuilt merely from filter changes.
- Use `Show 100 more` through 500 results. Confirm the cap message appears and no further rows mount until the query is narrowed.
- Search a name that does not exist anywhere in the Vault. Open the create row, verify the editable name and Obsidian-configured destination, cancel, and confirm nothing was created.
- In a disposable test folder, confirm the create action makes one blank Markdown file only after `Create page`. Repeat with an existing title, basename, alias, excluded-folder title, unsafe filename, and race-created destination; confirm no overwrite or duplicate occurs.
- From search results, open a page and use Obsidian Back/Forward. Confirm draft/submitted query, filters, Card/Table/sort state, result limit, and scroll position restore. Repeat via the upper-left Home button and confirm Home starts fresh instead.
- Move Home to a pop-out while suggestions or a link-target popup is open. Confirm outside click and Escape close controls in the new window and the old window retains no listener-visible behavior.
- Close the Home leaf, reload/disable the plugin, and confirm header hosts, document listeners, idle callbacks, and result navigation do not remain.
- Submit exactly 256 characters and eight total positive/negative terms, then exceed each limit. Confirm valid boundaries search normally, while over-limit input shows an explanation and does not start full-Vault search.
- In a disposable dense-link fixture, confirm performance diagnostics stop each positive term at 20,000 direct and 50,000 two-hop edge visits, repeated searches remain deterministic, and the UI stays responsive.
- Open the create confirmation, navigate the source Home leaf elsewhere, then confirm. Confirm no file is created and the changed leaf is not replaced. If creation had already completed during a later navigation change, confirm only the file remains and the changed leaf is not replaced.

## Full-Text Cache and Privacy Checks

- With Home closed and `Index on startup` off, restart Obsidian and confirm no search-body read or `search-cache.json` write starts merely from launch.
- Open Home and confirm search indexing starts only after the initial render/idle delay; submit a search and confirm waiting work is promoted without a duplicate build.
- On a warm restart, confirm unchanged path/mtime/size entries are reused and changed notes alone are read with maximum concurrency two.
- Modify, rename, and delete notes while search indexing is active. Confirm old text never returns, only one build remains active, and deleted text is absent from the final disk cache.
- Change include/exclude scope while Home is closed. Confirm the old `search-cache.json` is removed so newly excluded full text does not remain on disk.
- Corrupt `search-cache.json`, simulate an unreadable note, and use Refresh. Confirm startup remains usable, failure reaches a stable state without retry looping, and explicit Refresh can recover.
- Confirm cache files above 64 MiB are ignored/not persisted and the UI explains that a later launch must rebuild.
- With disposable scope fixtures, confirm a file above 8 MiB, selected Markdown source above 64 MiB, or estimated normalized-text RAM above 128 MiB stops before publishing a partial search index and advises narrowing include/exclude folders.
- Put compatibility characters that expand under NFKC into a disposable malformed cache and confirm the cache is rejected before normalized text can exceed the memory budget.
- Confirm performance logs include aggregate timing/counts but no full-text query, note body, or new raw path output.
- Confirm `search-cache.json` is Git-ignored, rejected by release verification if tracked, and never included in the three release artifacts.

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
- Typing page-name candidates in a roughly 7,000-page Vault remains responsive; long 33+ character candidates skip edit-distance matching rather than blocking the main thread.
- Submit the three representative searches above and record first/warm search time, result count, peak visible rows, search-cache bytes, and any observable UI pause without recording query results or note paths.
- Returning by Back/Forward reruns the saved query from the in-memory/persistent search index without a full-Vault body reread.

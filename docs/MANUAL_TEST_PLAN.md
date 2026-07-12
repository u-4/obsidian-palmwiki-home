# Manual Test Plan

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
- Switch to Table and confirm its existing page-opening behavior has not regressed.

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

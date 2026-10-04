# AGENTS.md

## Communication

- User-facing communication must be in Japanese (polite form), in terms a non-programmer can follow.

## How We Work

- Claude Code implements; the goal is something the owner can check in real use on Mac, iPhone and iPad. Keep the process light: tests that run in seconds, Git history, and a backup before each vault deploy are enough.
- Work directly on `main` for small changes; use a short-lived branch only when a change is large or risky. No PR or CI is required.

## Project Scope

- PalmWiki Home 1.0 is a rebuild of the former 0.x plugin (tag `0.6.1`) on top of the Lite prototype. It is one dependency-free CommonJS file, `main.js`, loaded by Obsidian as is.
- Lists, sorting and filtering belong to Obsidian Bases; this plugin adds the card view (`palmwiki-lite-cards`), the Home/search/switch buttons, and settings.
- Search and page switching call Omnisearch and Another Quick Switcher commands. Do not bring back an own full-text index or PageRank; related-note ranking belongs to `2hop-links-plus`.
- Keep it independent from `2hop-links-plus` at runtime.
- `docs/ROADMAP.md` holds the next steps.

## Checks

- `npm test` (syntax check and the tests in `tests/`) after each change.

## Versions

- For each version deployed to the vault, bump `manifest.json`, `package.json` and `versions.json`, add a `CHANGELOG.md` entry, and push a Git tag.
- When you push the tag, also create a GitHub Release for the same version: `gh release create <version> main.js manifest.json styles.css --title "PalmWiki Home <version>"`, with that version's `CHANGELOG.md` entry as the notes.

## Vault Deployment

- The owner's PalmWiki vault (`~/PalmWiki`, synced to iPhone and iPad by Obsidian Sync) is the standing target. `npm run deploy` backs up the installed files and `data.json` outside the vault, copies `main.js`, `manifest.json`, `styles.css`, and verifies checksums. It needs no approval each time.
- Ask before changing plugin settings (`data.json`), enablement, hotkeys, notes, or `.base` files, and before deploying to any other vault. Obsidian Sync carries plugin settings to every device.
- `npm run deploy` then reloads the plugin through the Obsidian CLI (`obsidian vault=PalmWiki plugin:reload id=palmwiki-home`) when Obsidian is running; otherwise the owner reloads it.

## Keep Out Of Git

- `data.json`, vault notes and attachments, personal paths, and private handoff material.

## Other Sessions

- PalmWiki Home, 2hop-links-plus and the Cosense-style CSS are each developed in a Claude Code session opened in its own folder. The ObsidianOps session is the hub for vault settings, diagnostics and the development status page.
- When another repository needs a change (for example CSS for a new class name), do not edit it here: find that repository's session with `ListAgents` and ask it with `SendMessage`. If there is no such session, tell the owner.
- 2hop-links-plus copies `excerpt()`, `firstImage()` and `PreviewStore` from `main.js` into its `src/cardPreview.ts`, and `NotePreview`, `previewMarkdown()` and `CardPopover` into its `src/notePreview.ts` and `src/relatedPopover.tsx`. When you change them, tell the 2hop-links-plus session.
- After deploying to the vault, send the ObsidianOps session the version and a one-line summary so it can update the status page.

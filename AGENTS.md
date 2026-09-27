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

## Vault Deployment

- The owner's iCloud PalmWiki vault is the standing target. `npm run deploy` backs up the installed files outside the vault, copies `main.js`, `manifest.json`, `styles.css`, and verifies checksums. It needs no approval each time.
- Ask before changing plugin settings (`data.json`), enablement, hotkeys, notes, or `.base` files, and before deploying to any other vault.
- The owner reloads the plugin or Obsidian after a deploy unless the Obsidian CLI is available to do it.

## Keep Out Of Git

- `data.json`, vault notes and attachments, personal paths, and private handoff material.

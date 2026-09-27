# AGENTS.md

## Communication

- User-facing communication must be in Japanese.
- Explain impact, validation, rollback, and required manual tests clearly.

## Project Scope

- This repository contains the PalmWiki Home Obsidian plugin.
- Read `PROJECT_CONTEXT.md` before planning a new phase or public release.
- Keep it independent from `2hop-links-plus`; do not add a runtime dependency.
- Vault notes, attachments, personal paths, runtime data, and review archives stay outside Git.

## Build And Validation

- Install dependencies from the lockfile with `npm ci` when possible.
- Required checks after source changes:
  - `npm run build`
  - `npm run eslint`
  - `git diff --check`
- `npm run eslint` runs the official type-aware Obsidian ESLint rules. `npm run build` also runs the TypeScript type checker.

## Git And Releases

- Keep stable work on `main` and use focused `codex/*` branches for development.
- Keep `package.json`, `manifest.json`, `versions.json`, and release tags aligned.
- Do not commit generated `main.js`, source maps, `node_modules`, review bundles, or local test records.
- GitHub releases must attach `main.js`, `manifest.json`, and `styles.css`.

## Vault Deployment

- Current user authorization (2026-09-16): the standing deployment and real-device acceptance target is the existing `PalmWiki` Vault under iCloud Drive / Obsidian. Verified updates may be distributed there without requesting the same approval again.
- `PalmWiki_LocalTest` remains optional for isolated regression checks; Mac-only testing is not the primary acceptance target. For Lite, follow the current procedure in `lite/DEPLOYMENT.md`; older test-only deployment text in historical records is superseded.
- Prioritize iPhone/iPad startup, progressive card/image loading, note switching, offline use and background/foreground return. Record actual device results separately from desktop or synthetic tests.
- The user-reported iPhone navigation-button placement problem is known and deferred; do not treat it as fixed or expand the current work to redesign it.
- Confirm the target before deploying to any other Vault. This authorization does not include changing note contents, plugin settings, synchronization services, repository protection, merging, or public releases.
- Back up an existing plugin installation outside `.obsidian/plugins/` before replacing it.
- Deploy only `main.js`, `manifest.json`, and `styles.css` unless explicitly required.
- Verify checksums after copying and never copy Vault notes into this repository.

## Editing Safety

- Inspect Git status and relevant files before editing.
- Preserve unrelated user changes.
- Use canonical `TFile.path` identity and Obsidian public APIs.
- Keep full-Vault reads and graph rebuilds out of React render paths.

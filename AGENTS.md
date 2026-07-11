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
- `npm run eslint` currently runs the TypeScript type checker; it is not a rule-based ESLint setup.

## Git And Releases

- Keep stable work on `main` and use focused `codex/*` branches for development.
- Keep `package.json`, `manifest.json`, `versions.json`, and release tags aligned.
- Do not commit generated `main.js`, source maps, `node_modules`, review bundles, or local test records.
- GitHub releases must attach `main.js`, `manifest.json`, and `styles.css`.

## Vault Deployment

- Confirm the target Vault before each deployment.
- Back up an existing plugin installation outside `.obsidian/plugins/` before replacing it.
- Deploy only `main.js`, `manifest.json`, and `styles.css` unless explicitly required.
- Verify checksums after copying and never copy Vault notes into this repository.

## Editing Safety

- Inspect Git status and relevant files before editing.
- Preserve unrelated user changes.
- Use canonical `TFile.path` identity and Obsidian public APIs.
- Keep full-Vault reads and graph rebuilds out of React render paths.

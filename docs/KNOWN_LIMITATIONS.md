# Known Limitations

- Version 0.2.1 targets Obsidian Desktop 1.12.7 or later and has been verified on Obsidian 1.12.7 for macOS. iOS and Android support will be evaluated after 0.2.1.
- Full-text body search, OCR search, multi-vault search, and related-page scoring are not implemented.
- PageRank is a static vault-ranking heuristic based on resolved links and modification times, not Google PageRank.
- Tags, unresolved links, non-Markdown embeds, and OCR content do not affect PageRank.
- An invalid PageRank regex falls back to substring matching without showing a settings error.
- Ignored source rules affect PageRank authority only. Factual Inlinks and Outlinks counts remain unchanged.
- Folder settings use text fields rather than a folder picker, and tag filtering uses exact matches.
- Virtualized table rows have a fixed height, so long descriptions and large tag lists are truncated.
- The saved index is shown before validation. Information may be temporarily stale while the status is `Waiting` or `Indexing`; `Complete` means validation finished.
- The first run, an invalid cache, or an index-scope setting change requires a rebuild whose duration depends on Vault size.
- The derived index is stored in the Vault-local plugin folder. Small image URL and date-label caches remain in memory only.
- Display performance and primary controls have been checked on a copied Vault with approximately 7,000 pages, but PageRank usefulness depends on each Vault's link structure.
- The upper-left Home button has no dedicated public Obsidian API, so its isolated placement module depends on Obsidian's left header DOM structure. A future header redesign could make only this button unavailable until compatibility is updated.
- Command discovery and execution use a guarded runtime compatibility layer because Obsidian's command manager is not part of the public `App` type. Unsupported, disabled, missing, or context-inapplicable commands leave the current view unchanged and show a Notice.
- Immediately after workspace restoration, an inactive deferred tab may not yet expose its current Markdown file or command context. Manually entered relative pages, local headings, and Markdown-context commands can remain unavailable until that tab finishes loading; exact Vault-relative paths saved by the page chooser are unaffected.
- Card preview uses Obsidian's Page preview core plugin and remains unavailable while that core plugin is disabled. If the `PalmWiki Home cards` modifier requirement is changed in Obsidian's Page preview settings, that core setting is the final authority for whether a modifier is required.
- Removing a Card preview source uses a guarded workspace compatibility call because source removal is not included in Obsidian's public type declarations. Unsupported versions keep Card clicks working and stop emitting preview requests safely.

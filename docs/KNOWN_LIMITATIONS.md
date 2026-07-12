# Known Limitations

- Version 0.1.0 targets Obsidian Desktop 1.12.7 or later and has been verified on Obsidian 1.12.7 for macOS. iOS and Android support will be evaluated after 0.1.0.
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

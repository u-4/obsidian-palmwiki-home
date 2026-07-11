# Known Limitations

- PageRank v2 is a static heuristic, not iterative Google PageRank.
- PageRank ignored source rules affect PageRank authority only; factual link counts remain unchanged.
- Invalid PageRank regex patterns fall back to substring matching and are not surfaced as setting UI errors.
- Target ignore rules are not implemented in this corrective patch.
- PageRank uses resolved Markdown-to-Markdown links only.
- Tags, unresolved links, non-Markdown embeds, OCR text, and full-text body matches do not affect PageRank.
- Body search, OCR search, multi-vault search, related-score computation, and MarkdownView top-bar injection remain out of scope.
- PageRank v2 and the dropdown fix still need copied-real-vault UI confirmation after installation.

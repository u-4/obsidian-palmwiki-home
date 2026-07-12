import type { PageRecord } from "../src/core/index/PageRecord";
import { normalizeSearchText } from "../src/core/search/normalizeText";

export function makePage(overrides: Partial<PageRecord> = {}): PageRecord {
  const path = overrides.path ?? "Notes/Example.md";
  const title = overrides.title ?? "Example";
  const folder = overrides.folder ?? path.slice(0, Math.max(0, path.lastIndexOf("/")));
  const tags = overrides.tags ?? [];
  const aliases = overrides.aliases ?? [];

  return {
    path,
    basename: overrides.basename ?? title,
    title,
    aliases,
    folder,
    tags,
    createdTime: 100,
    modifiedTime: 200,
    lineCount: 3,
    charCount: 20,
    description: "Example description",
    outlinks: [],
    inlinks: [],
    outlinkCount: 0,
    inlinkCount: 0,
    pageRank: 0,
    pinned: false,
    filterText: normalizeSearchText(
      [title, path, folder, ...aliases, ...tags].join(" ")
    ),
    sortTitle: normalizeSearchText(title),
    sortPath: normalizeSearchText(path),
    indexOrder: 0,
    ...overrides
  };
}

import type { PageRecord } from "../index/PageRecord";
import { normalizeFolderPath } from "../../settings/Settings";
import { normalizeSearchText } from "../search/normalizeText";

export interface PageFilterOptions {
  folder?: string;
  linkTarget?: string;
  tag?: string;
  query?: string;
}

export function isPathInFolder(filePath: string, folderPath: string): boolean {
  const normalizedFolder = normalizeFolderPath(folderPath);
  if (normalizedFolder.length === 0) {
    return true;
  }

  return filePath === normalizedFolder || filePath.startsWith(`${normalizedFolder}/`);
}

export function passesFolderSettings(
  filePath: string,
  includeFolders: string[],
  excludeFolders: string[]
): boolean {
  const normalizedIncludes = includeFolders.map(normalizeFolderPath).filter(Boolean);
  const normalizedExcludes = excludeFolders.map(normalizeFolderPath).filter(Boolean);

  if (normalizedExcludes.some((folder) => isPathInFolder(filePath, folder))) {
    return false;
  }

  if (normalizedIncludes.length === 0) {
    return true;
  }

  return normalizedIncludes.some((folder) => isPathInFolder(filePath, folder));
}

export function filterPages(pages: PageRecord[], options: PageFilterOptions): PageRecord[] {
  const queryTokens = tokenizeQuery(options.query);

  return pages.filter((page) => {
    if (options.folder && !isPathInFolder(page.path, options.folder)) {
      return false;
    }

    if (options.tag && !page.tags.includes(options.tag)) {
      return false;
    }

    if (options.linkTarget && !page.outlinks.includes(options.linkTarget)) {
      return false;
    }

    if (queryTokens.length > 0 && !matchesSimpleQuery(page, queryTokens)) {
      return false;
    }

    return true;
  });
}

function tokenizeQuery(query: string | undefined): string[] {
  return normalizeSearchText(query ?? "")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function matchesSimpleQuery(page: PageRecord, queryTokens: string[]): boolean {
  return queryTokens.every((token) => page.filterText.includes(token));
}

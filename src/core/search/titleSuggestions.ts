import type { PageRecord } from "../index/PageRecord";

export const MAX_TITLE_SUGGESTIONS = 10;

export type TitleSuggestionMatchKind =
  | "recent"
  | "exact"
  | "prefix"
  | "substring"
  | "subsequence"
  | "fuzzy";

export interface TitleSuggestion {
  path: string;
  title: string;
  aliasMatch: string | null;
  matchKind: TitleSuggestionMatchKind;
  score: number;
}

interface TextMatch {
  kind: Exclude<TitleSuggestionMatchKind, "recent">;
  score: number;
}

interface RankedSuggestion extends TitleSuggestion {
  modifiedTime: number;
  normalizedTitle: string;
  pageRank: number;
  sourceOrder: number;
}

interface SearchField {
  aliasMatch: string | null;
  fieldPriority: number;
  normalizedValue: string;
}

const SCORE_EXACT = 600;
const SCORE_PREFIX = 500;
const SCORE_SUBSTRING = 400;
const SCORE_SUBSEQUENCE = 300;
const SCORE_FUZZY = 200;
const MAX_FUZZY_TEXT_LENGTH = 32;

/**
 * Returns recent pages for an empty query and ranked title suggestions otherwise.
 * Only title-like metadata is searched; body text, tags, and links are ignored.
 */
export function getTitleSuggestions(
  pages: readonly PageRecord[],
  recentPaths: readonly string[],
  query: string,
  limit = MAX_TITLE_SUGGESTIONS
): TitleSuggestion[] {
  const normalizedLimit = normalizeLimit(limit);
  if (normalizedLimit === 0) {
    return [];
  }

  const normalizedQuery = normalizePageNameText(query).trim();
  if (normalizedQuery.length === 0) {
    return getRecentSuggestions(pages, recentPaths, normalizedLimit);
  }

  const ranked: RankedSuggestion[] = [];

  for (const [sourceOrder, page] of pages.entries()) {
    if (!isMarkdownPath(page.path)) {
      continue;
    }

    const bestMatch = findBestPageMatch(page, normalizedQuery);
    if (!bestMatch) {
      continue;
    }

    ranked.push({
      path: page.path,
      title: page.title,
      aliasMatch: bestMatch.aliasMatch,
      matchKind: bestMatch.match.kind,
      score: bestMatch.match.score + bestMatch.fieldPriority,
      modifiedTime: finiteNumber(page.modifiedTime),
      normalizedTitle: normalizePageNameText(page.title),
      pageRank: finiteNumber(page.pageRank),
      sourceOrder
    });
  }

  ranked.sort(compareRankedSuggestions);

  const suggestions: TitleSuggestion[] = [];
  const seenPaths = new Set<string>();
  for (const suggestion of ranked) {
    if (seenPaths.has(suggestion.path)) {
      continue;
    }

    seenPaths.add(suggestion.path);
    suggestions.push(toPublicSuggestion(suggestion));
    if (suggestions.length >= normalizedLimit) {
      break;
    }
  }

  return suggestions;
}

function getRecentSuggestions(
  pages: readonly PageRecord[],
  recentPaths: readonly string[],
  limit: number
): TitleSuggestion[] {
  const pagesByPath = new Map<string, PageRecord>();
  for (const page of pages) {
    if (isMarkdownPath(page.path) && !pagesByPath.has(page.path)) {
      pagesByPath.set(page.path, page);
    }
  }

  const suggestions: TitleSuggestion[] = [];
  const seenPaths = new Set<string>();

  for (const path of recentPaths) {
    if (seenPaths.has(path)) {
      continue;
    }

    seenPaths.add(path);
    const page = pagesByPath.get(path);
    if (!page) {
      continue;
    }

    suggestions.push({
      path: page.path,
      title: page.title,
      aliasMatch: null,
      matchKind: "recent",
      score: MAX_TITLE_SUGGESTIONS - suggestions.length
    });

    if (suggestions.length >= limit) {
      break;
    }
  }

  return suggestions;
}

function findBestPageMatch(
  page: PageRecord,
  normalizedQuery: string
): { aliasMatch: string | null; fieldPriority: number; match: TextMatch } | null {
  const fields: SearchField[] = [
    {
      aliasMatch: null,
      fieldPriority: 2,
      normalizedValue: normalizePageNameText(page.title).trim()
    },
    {
      aliasMatch: null,
      fieldPriority: 1,
      normalizedValue: normalizePageNameText(page.basename).trim()
    },
    ...page.aliases.map((alias) => ({
      aliasMatch: alias,
      fieldPriority: 0,
      normalizedValue: normalizePageNameText(alias).trim()
    }))
  ];

  let best:
    | { aliasMatch: string | null; fieldPriority: number; match: TextMatch }
    | null = null;

  for (const field of fields) {
    if (field.normalizedValue.length === 0) {
      continue;
    }

    const match = matchTitleText(field.normalizedValue, normalizedQuery);
    if (!match) {
      continue;
    }

    if (
      !best ||
      match.score + field.fieldPriority > best.match.score + best.fieldPriority
    ) {
      best = { ...field, match };
    }
  }

  return best;
}

function matchTitleText(value: string, query: string): TextMatch | null {
  if (value === query) {
    return { kind: "exact", score: SCORE_EXACT };
  }

  if (value.startsWith(query)) {
    return {
      kind: "prefix",
      score: SCORE_PREFIX - cappedPenalty(value.length - query.length)
    };
  }

  const substringIndex = value.indexOf(query);
  if (substringIndex >= 0) {
    return {
      kind: "substring",
      score:
        SCORE_SUBSTRING -
        cappedPenalty(substringIndex * 2 + value.length - query.length)
    };
  }

  const subsequencePenalty = getSubsequencePenalty(value, query);
  if (subsequencePenalty !== null) {
    return {
      kind: "subsequence",
      score: SCORE_SUBSEQUENCE - cappedPenalty(subsequencePenalty)
    };
  }

  const maxDistance = getMaximumFuzzyDistance(query.length);
  if (
    maxDistance === 0 ||
    value.length > MAX_FUZZY_TEXT_LENGTH ||
    query.length > MAX_FUZZY_TEXT_LENGTH ||
    Math.abs(value.length - query.length) > maxDistance
  ) {
    return null;
  }

  const editDistance = boundedDamerauLevenshtein(value, query, maxDistance);
  if (editDistance === null) {
    return null;
  }

  return {
    kind: "fuzzy",
    score:
      SCORE_FUZZY -
      cappedPenalty(editDistance * 20 + Math.abs(value.length - query.length))
  };
}

function getSubsequencePenalty(value: string, query: string): number | null {
  let queryIndex = 0;
  let firstMatchIndex = -1;
  let lastMatchIndex = -1;

  for (let valueIndex = 0; valueIndex < value.length; valueIndex += 1) {
    if (value[valueIndex] !== query[queryIndex]) {
      continue;
    }

    if (firstMatchIndex < 0) {
      firstMatchIndex = valueIndex;
    }
    lastMatchIndex = valueIndex;
    queryIndex += 1;

    if (queryIndex === query.length) {
      const span = lastMatchIndex - firstMatchIndex + 1;
      const internalGaps = span - query.length;
      return firstMatchIndex * 2 + internalGaps * 3 + value.length - span;
    }
  }

  return null;
}

function boundedDamerauLevenshtein(
  value: string,
  query: string,
  maximumDistance: number
): number | null {
  let previousPrevious: number[] | null = null;
  let previous = Array.from({ length: query.length + 1 }, (_, index) => index);

  for (let valueIndex = 1; valueIndex <= value.length; valueIndex += 1) {
    const current = new Array<number>(query.length + 1);
    current[0] = valueIndex;
    let rowMinimum = current[0];

    for (let queryIndex = 1; queryIndex <= query.length; queryIndex += 1) {
      const substitutionCost =
        value[valueIndex - 1] === query[queryIndex - 1] ? 0 : 1;
      let distance = Math.min(
        previous[queryIndex] + 1,
        current[queryIndex - 1] + 1,
        previous[queryIndex - 1] + substitutionCost
      );

      if (
        previousPrevious &&
        valueIndex > 1 &&
        queryIndex > 1 &&
        value[valueIndex - 1] === query[queryIndex - 2] &&
        value[valueIndex - 2] === query[queryIndex - 1]
      ) {
        distance = Math.min(distance, previousPrevious[queryIndex - 2] + 1);
      }

      current[queryIndex] = distance;
      rowMinimum = Math.min(rowMinimum, distance);
    }

    if (rowMinimum > maximumDistance) {
      return null;
    }

    previousPrevious = previous;
    previous = current;
  }

  const distance = previous[query.length];
  return distance <= maximumDistance ? distance : null;
}

function getMaximumFuzzyDistance(queryLength: number): number {
  if (queryLength < 3) {
    return 0;
  }
  if (queryLength <= 4) {
    return 1;
  }
  if (queryLength <= 10) {
    return 2;
  }
  return 3;
}

function compareRankedSuggestions(a: RankedSuggestion, b: RankedSuggestion): number {
  if (a.score !== b.score) {
    return b.score - a.score;
  }
  if (a.pageRank !== b.pageRank) {
    return b.pageRank - a.pageRank;
  }
  if (a.modifiedTime !== b.modifiedTime) {
    return b.modifiedTime - a.modifiedTime;
  }

  const titleComparison = compareText(a.normalizedTitle, b.normalizedTitle);
  if (titleComparison !== 0) {
    return titleComparison;
  }

  const pathComparison = compareText(a.path, b.path);
  return pathComparison !== 0 ? pathComparison : a.sourceOrder - b.sourceOrder;
}

function compareText(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}

function toPublicSuggestion(suggestion: RankedSuggestion): TitleSuggestion {
  return {
    path: suggestion.path,
    title: suggestion.title,
    aliasMatch: suggestion.aliasMatch,
    matchKind: suggestion.matchKind,
    score: suggestion.score
  };
}

export function normalizePageNameText(input: string): string {
  return input
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (character) =>
      String.fromCharCode(character.charCodeAt(0) - 0x60)
    );
}

function cappedPenalty(value: number): number {
  return Math.min(90, Math.max(0, value));
}

function finiteNumber(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function normalizeLimit(limit: number): number {
  if (!Number.isFinite(limit)) {
    return MAX_TITLE_SUGGESTIONS;
  }
  return Math.min(MAX_TITLE_SUGGESTIONS, Math.max(0, Math.floor(limit)));
}

function isMarkdownPath(path: string): boolean {
  return /\.md$/i.test(path);
}

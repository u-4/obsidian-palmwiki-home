import type { PageRecord } from "../index/PageRecord";
import { normalizeSearchText } from "./normalizeText";
import { normalizePageNameText } from "./titleSuggestions";

const TITLE_EXACT_SCORE = 1;
const TITLE_PARTIAL_SCORE = 0.9;
const BASENAME_EXACT_SCORE = 0.95;
const BASENAME_PARTIAL_SCORE = 0.85;
const ALIAS_EXACT_SCORE = 0.9;
const ALIAS_PARTIAL_SCORE = 0.82;
const TAG_SCORE = 0.75;
const PATH_SCORE = 0.65;
const STRONG_EVIDENCE_THRESHOLD = 0.55;
const STRONG_DIRECT_RELATION_THRESHOLD = 0.25;
const USEFUL_RELATION_THRESHOLD = 0.15;
const MAX_IDENTITY_SEEDS = 64;
const MAX_BODY_FALLBACK_SEEDS = 16;
const TWO_HOP_ATTENUATION = 0.7;
const DEFAULT_RAW_SNIPPET_CONTEXT_BEFORE = 24;
const DEFAULT_RAW_SNIPPET_CONTEXT_AFTER = 72;

export const MAX_FULL_TEXT_QUERY_LENGTH = 256;
export const MAX_FULL_TEXT_QUERY_TERMS = 8;
export const MAX_FULL_TEXT_QUERY_EDITOR_LENGTH = MAX_FULL_TEXT_QUERY_LENGTH + 1;
export const MAX_DIRECT_RELATION_EDGE_VISITS_PER_TERM = 20_000;
export const MAX_TWO_HOP_RELATION_EDGE_VISITS_PER_TERM = 50_000;

export type FullTextMatchedField =
  | "title"
  | "basename"
  | "alias"
  | "tag"
  | "path"
  | "body";

export interface FullTextSearchDocument {
  path: string;
  normalizedBody: string;
}

export interface ParsedFullTextTerm {
  phrase: boolean;
  value: string;
}

export interface ParsedFullTextQuery {
  positive: ParsedFullTextTerm[];
  negative: ParsedFullTextTerm[];
}

export interface FullTextBodyMatch {
  column: number;
  line: number;
  offset: number;
  term: string;
}

export interface RawBodySearchMatch {
  fromCh: number;
  line: number;
  term: string;
  toCh: number;
}

export interface RawTextHighlightRange {
  from: number;
  to: number;
}

export interface FullTextRelationEvidence {
  hop: 1 | 2;
  reason: "links-to" | "linked-from" | "two-hop";
  score: number;
  seedPath: string;
  term: string;
  viaPath?: string;
}

export type FullTextCoverageClass = "strong" | "complete" | "related" | "weak";

export interface FullTextScoreBreakdown {
  directLink: number;
  effectivePageRank: number;
  match: number;
  pageRank: number;
  total: number;
  twoHop: number;
  weighted: {
    directLink: number;
    match: number;
    pageRank: number;
    twoHop: number;
  };
}

export interface FullTextSearchResult {
  breakdown: FullTextScoreBreakdown;
  coverageClass: FullTextCoverageClass;
  exactTitleMatches: number;
  firstBodyMatch?: FullTextBodyMatch;
  matchedFields: FullTextMatchedField[];
  page: PageRecord;
  relations: FullTextRelationEvidence[];
  score: number;
}

export interface FullTextSearchDiagnostics {
  directRelationEdgeVisits: number;
  directRelationTermsCapped: number;
  twoHopRelationEdgeVisits: number;
  twoHopRelationTermsCapped: number;
}

interface PreparedPage {
  body: string;
  normalizedAliases: string[];
  normalizedBasename: string;
  normalizedPath: string;
  normalizedTags: string[];
  normalizedTitle: string;
  page: PageRecord;
}

interface TextEvidence {
  exactTitle: boolean;
  firstBodyOffset?: number;
  matchedFields: Set<FullTextMatchedField>;
  score: number;
}

interface SearchGraph {
  in: Map<string, Set<string>>;
  neighbors: Map<string, Set<string>>;
  out: Map<string, Set<string>>;
}

interface RelationMaps {
  direct: Map<string, FullTextRelationEvidence>;
  twoHop: Map<string, FullTextRelationEvidence>;
}

const FIELD_ORDER: FullTextMatchedField[] = [
  "title",
  "basename",
  "alias",
  "tag",
  "path",
  "body"
];

const COVERAGE_ORDER: Record<FullTextCoverageClass, number> = {
  strong: 0,
  complete: 1,
  related: 2,
  weak: 3
};

export function parseFullTextQuery(input: string): ParsedFullTextQuery {
  return parseFullTextQueryTerms(
    limitFullTextQueryInput(input),
    MAX_FULL_TEXT_QUERY_TERMS
  );
}

export function getFullTextQueryValidationError(input: string): string | null {
  if (input.length > MAX_FULL_TEXT_QUERY_LENGTH) {
    return `Search queries are limited to ${MAX_FULL_TEXT_QUERY_LENGTH} characters.`;
  }

  const parsed = parseFullTextQueryTerms(input, MAX_FULL_TEXT_QUERY_TERMS + 1);
  if (parsed.positive.length + parsed.negative.length > MAX_FULL_TEXT_QUERY_TERMS) {
    return `Search queries are limited to ${MAX_FULL_TEXT_QUERY_TERMS} terms, including exclusions.`;
  }
  return null;
}

function parseFullTextQueryTerms(
  input: string,
  maxTerms: number
): ParsedFullTextQuery {
  const positive: ParsedFullTextTerm[] = [];
  const negative: ParsedFullTextTerm[] = [];
  const seenPositive = new Set<string>();
  const seenNegative = new Set<string>();
  const pattern = /(-)?(?:"([^"]+)"|([^\s"]+))/g;

  let acceptedTerms = 0;

  for (const match of input.matchAll(pattern)) {
    const phrase = match[2] !== undefined;
    const value = normalizeSearchText(match[2] ?? match[3] ?? "").trim();
    if (!value || value === "-") {
      continue;
    }

    const term = { phrase, value };
    const key = `${phrase ? "phrase" : "term"}:${value}`;
    if (match[1]) {
      if (!seenNegative.has(key)) {
        seenNegative.add(key);
        negative.push(term);
        acceptedTerms += 1;
      }
    } else if (!seenPositive.has(key)) {
      seenPositive.add(key);
      positive.push(term);
      acceptedTerms += 1;
    }

    if (acceptedTerms >= maxTerms) {
      break;
    }
  }

  return { positive, negative };
}

export function limitFullTextQueryInput(input: string): string {
  return input.slice(0, MAX_FULL_TEXT_QUERY_LENGTH);
}

export function limitFullTextQueryEditorInput(input: string): string {
  return input.slice(0, MAX_FULL_TEXT_QUERY_EDITOR_LENGTH);
}

export function searchFullText(
  pages: readonly PageRecord[],
  documents: Iterable<FullTextSearchDocument>,
  query: string,
  diagnostics?: FullTextSearchDiagnostics
): FullTextSearchResult[] {
  if (diagnostics) {
    diagnostics.directRelationEdgeVisits = 0;
    diagnostics.directRelationTermsCapped = 0;
    diagnostics.twoHopRelationEdgeVisits = 0;
    diagnostics.twoHopRelationTermsCapped = 0;
  }
  if (getFullTextQueryValidationError(query)) {
    return [];
  }
  const parsed = parseFullTextQuery(query);
  if (parsed.positive.length === 0) {
    return [];
  }

  const bodies = new Map<string, string>();
  for (const document of documents) {
    bodies.set(document.path, document.normalizedBody);
  }

  const prepared = pages.map((page) => preparePage(page, bodies.get(page.path) ?? ""));
  const graph = buildSearchGraph(pages);
  const evidenceByTerm = parsed.positive.map((term) => {
    const evidence = new Map<string, TextEvidence>();
    for (const item of prepared) {
      evidence.set(item.page.path, scoreTextEvidence(item, term));
    }
    return evidence;
  });
  const relationByTerm = parsed.positive.map((term, index) => {
    const seeds = selectSeeds(prepared, term, evidenceByTerm[index]);
    return buildRelationMaps(term, seeds, graph, diagnostics);
  });
  const results: FullTextSearchResult[] = [];

  for (const item of prepared) {
    if (matchesAnyNegativeTerm(item, parsed.negative)) {
      continue;
    }

    const textEvidence = evidenceByTerm.map(
      (evidence) => evidence.get(item.page.path) ?? emptyTextEvidence()
    );
    const directRelations = relationByTerm.map((relations) =>
      relations.direct.get(item.page.path)
    );
    const twoHopRelations = relationByTerm.map((relations) =>
      relations.twoHop.get(item.page.path)
    );
    const termCoverage = textEvidence.map((evidence, index) =>
      Math.max(
        evidence.score,
        (directRelations[index]?.score ?? 0) * 0.5,
        (twoHopRelations[index]?.score ?? 0) * 0.5
      )
    );

    if (termCoverage.some((value) => value <= 0)) {
      continue;
    }

    const hasDirectSearchEvidence = textEvidence.some(
      (evidence, index) => evidence.score > 0 || (directRelations[index]?.score ?? 0) > 0
    );
    if (!hasDirectSearchEvidence) {
      continue;
    }

    const matchScore = aggregateTermScores(termCoverage);
    const directLinkScore = average(
      directRelations.map((relation) => relation?.score ?? 0)
    );
    const twoHopScore = average(
      twoHopRelations.map((relation) => relation?.score ?? 0)
    );
    const pageRank = clamp01(item.page.pageRank);
    const effectivePageRank = pageRank * (0.5 + 0.5 * matchScore);
    const weighted = {
      match: 0.35 * matchScore,
      pageRank: 0.45 * effectivePageRank,
      directLink: 0.15 * directLinkScore,
      twoHop: 0.05 * twoHopScore
    };
    const total = clamp01(
      weighted.match + weighted.pageRank + weighted.directLink + weighted.twoHop
    );
    const matchedFields = collectMatchedFields(textEvidence);
    const relations = collectRelations(
      parsed.positive,
      directRelations,
      twoHopRelations
    );

    results.push({
      breakdown: {
        directLink: directLinkScore,
        effectivePageRank,
        match: matchScore,
        pageRank,
        total,
        twoHop: twoHopScore,
        weighted
      },
      coverageClass: classifyCoverage(textEvidence, directRelations, twoHopRelations),
      exactTitleMatches: textEvidence.filter((evidence) => evidence.exactTitle).length,
      firstBodyMatch: findFirstBodyMatch(item.body, parsed.positive),
      matchedFields,
      page: item.page,
      relations,
      score: total
    });
  }

  return results.sort(compareSearchResults);
}

export function refreshFullTextSearchResultPages(
  results: readonly FullTextSearchResult[],
  pages: readonly PageRecord[]
): FullTextSearchResult[] {
  const pagesByPath = new Map(pages.map((page) => [page.path, page]));
  return results
    .flatMap((result) => {
      const page = pagesByPath.get(result.page.path);
      return page ? [{ ...result, page }] : [];
    })
    .sort(compareSearchResults);
}

/**
 * Re-resolves a saved search against the current raw Markdown before opening a
 * result. This avoids trusting normalized offsets after a note was edited.
 */
export function findRawBodySearchMatch(
  body: string,
  query: string
): RawBodySearchMatch | null {
  const terms = parseFullTextQuery(query).positive;
  if (terms.length === 0) {
    return null;
  }

  const lines = body.split(/\r?\n/);
  let best:
    | (RawBodySearchMatch & { matchedTermCount: number })
    | null = null;

  for (let line = 0; line < lines.length; line += 1) {
    const mapped = normalizeRawLine(lines[line]);
    const matches = terms
      .map((term) => ({ term, offset: mapped.normalized.indexOf(term.value) }))
      .filter((match) => match.offset >= 0);
    if (matches.length === 0) {
      continue;
    }

    matches.sort((left, right) => left.offset - right.offset);
    const first = matches[0];
    const startMap = mapped.offsets[first.offset];
    const endMap = mapped.offsets[first.offset + first.term.value.length - 1];
    if (!startMap || !endMap) {
      continue;
    }

    const candidate = {
      fromCh: startMap.start,
      line,
      matchedTermCount: matches.length,
      term: first.term.value,
      toCh: endMap.end
    };
    if (
      !best ||
      candidate.matchedTermCount > best.matchedTermCount ||
      (candidate.matchedTermCount === best.matchedTermCount &&
        (candidate.line < best.line ||
          (candidate.line === best.line && candidate.fromCh < best.fromCh)))
    ) {
      best = candidate;
    }
  }

  if (!best) {
    return null;
  }
  return {
    fromCh: best.fromCh,
    line: best.line,
    term: best.term,
    toCh: best.toCh
  };
}

export function getRawBodySearchSnippet(
  body: string,
  query: string,
  contextBefore = DEFAULT_RAW_SNIPPET_CONTEXT_BEFORE,
  contextAfter = DEFAULT_RAW_SNIPPET_CONTEXT_AFTER
): string | null {
  const match = findRawBodySearchMatch(body, query);
  if (!match) {
    return null;
  }

  return getRawBodySearchSnippetFromMatch(body, match, contextBefore, contextAfter);
}

export function getRawBodySearchSnippetFromMatch(
  body: string,
  match: RawBodySearchMatch,
  contextBefore = DEFAULT_RAW_SNIPPET_CONTEXT_BEFORE,
  contextAfter = DEFAULT_RAW_SNIPPET_CONTEXT_AFTER
): string | null {
  if (
    !Number.isInteger(match.line) ||
    match.line < 0 ||
    !Number.isInteger(match.fromCh) ||
    !Number.isInteger(match.toCh) ||
    match.fromCh < 0 ||
    match.toCh <= match.fromCh
  ) {
    return null;
  }

  const line = body.split(/\r?\n/)[match.line] ?? "";
  if (match.fromCh >= line.length || match.toCh > line.length) {
    return null;
  }
  const safeContextBefore = Number.isFinite(contextBefore)
    ? Math.max(0, Math.floor(contextBefore))
    : DEFAULT_RAW_SNIPPET_CONTEXT_BEFORE;
  const safeContextAfter = Number.isFinite(contextAfter)
    ? Math.max(0, Math.floor(contextAfter))
    : DEFAULT_RAW_SNIPPET_CONTEXT_AFTER;
  const start = Math.max(0, match.fromCh - safeContextBefore);
  const end = Math.min(line.length, match.toCh + safeContextAfter);
  return `${start > 0 ? "…" : ""}${line.slice(start, end).trim()}${
    end < line.length ? "…" : ""
  }`;
}

/**
 * Maps normalized positive query terms back to their exact spans in raw text.
 * This keeps highlighting correct for compatibility-width and decomposed text.
 */
export function getRawTextHighlightRanges(
  text: string,
  query: string
): RawTextHighlightRange[] {
  if (!text) {
    return [];
  }

  const terms = parseFullTextQuery(query).positive;
  if (terms.length === 0) {
    return [];
  }

  const mapped = normalizeRawLine(text);
  const ranges: RawTextHighlightRange[] = [];
  for (const term of terms) {
    let searchFrom = 0;
    while (searchFrom < mapped.normalized.length) {
      const normalizedOffset = mapped.normalized.indexOf(term.value, searchFrom);
      if (normalizedOffset < 0) {
        break;
      }

      const startMap = mapped.offsets[normalizedOffset];
      const endMap = mapped.offsets[normalizedOffset + term.value.length - 1];
      if (startMap && endMap && endMap.end > startMap.start) {
        ranges.push({ from: startMap.start, to: endMap.end });
      }
      searchFrom = normalizedOffset + Math.max(1, term.value.length);
    }
  }

  ranges.sort((left, right) => left.from - right.from || left.to - right.to);
  const merged: RawTextHighlightRange[] = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous && range.from <= previous.to) {
      previous.to = Math.max(previous.to, range.to);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

function preparePage(page: PageRecord, body: string): PreparedPage {
  return {
    body,
    normalizedAliases: page.aliases.map(normalizePageNameText),
    normalizedBasename: normalizePageNameText(page.basename),
    normalizedPath: normalizeSearchText(page.path),
    normalizedTags: page.tags.map(normalizeSearchText),
    normalizedTitle: normalizePageNameText(page.title),
    page
  };
}

function scoreTextEvidence(
  item: PreparedPage,
  term: ParsedFullTextTerm
): TextEvidence {
  const pageNameTerm = normalizePageNameText(term.value);
  const matchedFields = new Set<FullTextMatchedField>();
  let score = 0;
  let exactTitle = false;

  if (item.normalizedTitle === pageNameTerm) {
    matchedFields.add("title");
    exactTitle = true;
    score = Math.max(score, TITLE_EXACT_SCORE);
  } else if (item.normalizedTitle.includes(pageNameTerm)) {
    matchedFields.add("title");
    score = Math.max(score, TITLE_PARTIAL_SCORE);
  }

  if (item.normalizedBasename === pageNameTerm) {
    matchedFields.add("basename");
    score = Math.max(score, BASENAME_EXACT_SCORE);
  } else if (item.normalizedBasename.includes(pageNameTerm)) {
    matchedFields.add("basename");
    score = Math.max(score, BASENAME_PARTIAL_SCORE);
  }

  for (const alias of item.normalizedAliases) {
    if (alias === pageNameTerm) {
      matchedFields.add("alias");
      score = Math.max(score, ALIAS_EXACT_SCORE);
    } else if (alias.includes(pageNameTerm)) {
      matchedFields.add("alias");
      score = Math.max(score, ALIAS_PARTIAL_SCORE);
    }
  }

  for (const tag of item.normalizedTags) {
    if (tag === term.value || tag.replace(/^#/, "") === term.value || tag.includes(term.value)) {
      matchedFields.add("tag");
      score = Math.max(score, TAG_SCORE);
    }
  }

  if (item.normalizedPath.includes(term.value)) {
    matchedFields.add("path");
    score = Math.max(score, PATH_SCORE);
  }

  const firstBodyOffset = item.body.indexOf(term.value);
  if (firstBodyOffset >= 0) {
    matchedFields.add("body");
    score = Math.max(score, scoreBodyMatch(item.body, term.value));
  }

  return {
    exactTitle,
    firstBodyOffset: firstBodyOffset >= 0 ? firstBodyOffset : undefined,
    matchedFields,
    score
  };
}

function scoreBodyMatch(body: string, term: string): number {
  const occurrences = countOccurrences(body, term);
  const lengthScale = Math.sqrt(Math.max(1, body.length / 1000));
  const density = occurrences / lengthScale;
  return clamp01(0.35 + 0.45 * (density / (density + 1)));
}

function countOccurrences(value: string, search: string): number {
  let count = 0;
  let offset = 0;

  while (offset < value.length) {
    const matchOffset = value.indexOf(search, offset);
    if (matchOffset < 0) {
      break;
    }
    count += 1;
    offset = matchOffset + Math.max(1, search.length);
  }

  return count;
}

function matchesAnyNegativeTerm(
  item: PreparedPage,
  terms: ParsedFullTextTerm[]
): boolean {
  return terms.some((term) => scoreTextEvidence(item, term).score > 0);
}

function buildSearchGraph(pages: readonly PageRecord[]): SearchGraph {
  const paths = new Set(pages.map((page) => page.path));
  const out = new Map<string, Set<string>>();
  const inlinks = new Map<string, Set<string>>();
  const neighbors = new Map<string, Set<string>>();

  for (const path of paths) {
    out.set(path, new Set());
    inlinks.set(path, new Set());
    neighbors.set(path, new Set());
  }

  const addEdge = (source: string, target: string): void => {
    if (source === target || !paths.has(source) || !paths.has(target)) {
      return;
    }
    out.get(source)?.add(target);
    inlinks.get(target)?.add(source);
    neighbors.get(source)?.add(target);
    neighbors.get(target)?.add(source);
  };

  for (const page of [...pages].sort((left, right) =>
    compareStrings(left.path, right.path)
  )) {
    for (const target of [...page.outlinks].sort(compareStrings)) {
      addEdge(page.path, target);
    }
    for (const source of [...page.inlinks].sort(compareStrings)) {
      addEdge(source, page.path);
    }
  }

  return { in: inlinks, neighbors, out };
}

function selectSeeds(
  pages: PreparedPage[],
  term: ParsedFullTextTerm,
  evidence: Map<string, TextEvidence>
): PreparedPage[] {
  const identitySeeds = pages
    .map((page) => ({ page, score: seedIdentityScore(page, term) }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) =>
      b.score - a.score ||
      b.page.page.pageRank - a.page.page.pageRank ||
      compareStrings(a.page.page.path, b.page.page.path)
    )
    .slice(0, MAX_IDENTITY_SEEDS)
    .map((candidate) => candidate.page);

  if (identitySeeds.length > 0) {
    return identitySeeds;
  }

  return pages
    .filter((page) => {
      const item = evidence.get(page.page.path);
      return item?.matchedFields.has("body") && item.score >= STRONG_EVIDENCE_THRESHOLD;
    })
    .sort((a, b) =>
      (evidence.get(b.page.path)?.score ?? 0) -
        (evidence.get(a.page.path)?.score ?? 0) ||
      b.page.pageRank - a.page.pageRank ||
      compareStrings(a.page.path, b.page.path)
    )
    .slice(0, MAX_BODY_FALLBACK_SEEDS);
}

function seedIdentityScore(page: PreparedPage, term: ParsedFullTextTerm): number {
  const pageNameTerm = normalizePageNameText(term.value);
  let score = 0;
  score = Math.max(score, identityFieldScore(page.normalizedTitle, pageNameTerm, 1, 0.9));
  score = Math.max(
    score,
    identityFieldScore(page.normalizedBasename, pageNameTerm, 0.95, 0.85)
  );
  for (const alias of page.normalizedAliases) {
    score = Math.max(score, identityFieldScore(alias, pageNameTerm, 0.9, 0.82));
  }
  return score;
}

function identityFieldScore(
  value: string,
  term: string,
  exact: number,
  partial: number
): number {
  if (value === term) {
    return exact;
  }
  return value.includes(term) ? partial : 0;
}

function buildRelationMaps(
  term: ParsedFullTextTerm,
  seeds: PreparedPage[],
  graph: SearchGraph,
  diagnostics?: FullTextSearchDiagnostics
): RelationMaps {
  const direct = new Map<string, FullTextRelationEvidence>();
  const twoHop = new Map<string, FullTextRelationEvidence>();
  let directEdgeVisits = 0;
  let twoHopEdgeVisits = 0;

  directTraversal: for (const seed of seeds) {
    const seedPath = seed.page.path;
    for (const candidatePath of graph.neighbors.get(seedPath) ?? []) {
      if (directEdgeVisits >= MAX_DIRECT_RELATION_EDGE_VISITS_PER_TERM) {
        break directTraversal;
      }
      directEdgeVisits += 1;
      const linksToSeed = graph.out.get(candidatePath)?.has(seedPath) ?? false;
      const score = edgeSpecificity(candidatePath, seedPath, graph) *
        (linksToSeed ? 1 : 0.7);
      updateBestRelation(direct, candidatePath, {
        hop: 1,
        reason: linksToSeed ? "links-to" : "linked-from",
        score,
        seedPath,
        term: term.value
      });
    }
  }

  twoHopTraversal: for (const seed of seeds) {
    const seedPath = seed.page.path;
    for (const viaPath of graph.neighbors.get(seedPath) ?? []) {
      if (twoHopEdgeVisits >= MAX_TWO_HOP_RELATION_EDGE_VISITS_PER_TERM) {
        break twoHopTraversal;
      }
      twoHopEdgeVisits += 1;
      for (const candidatePath of graph.neighbors.get(viaPath) ?? []) {
        if (twoHopEdgeVisits >= MAX_TWO_HOP_RELATION_EDGE_VISITS_PER_TERM) {
          break twoHopTraversal;
        }
        twoHopEdgeVisits += 1;
        if (candidatePath === seedPath) {
          continue;
        }
        const score =
          TWO_HOP_ATTENUATION *
          edgeSpecificity(candidatePath, viaPath, graph) *
          edgeSpecificity(viaPath, seedPath, graph);
        updateBestRelation(twoHop, candidatePath, {
          hop: 2,
          reason: "two-hop",
          score,
          seedPath,
          term: term.value,
          viaPath
        });
      }
    }
  }

  if (diagnostics) {
    diagnostics.directRelationEdgeVisits += directEdgeVisits;
    diagnostics.directRelationTermsCapped += Number(
      directEdgeVisits >= MAX_DIRECT_RELATION_EDGE_VISITS_PER_TERM
    );
    diagnostics.twoHopRelationEdgeVisits += twoHopEdgeVisits;
    diagnostics.twoHopRelationTermsCapped += Number(
      twoHopEdgeVisits >= MAX_TWO_HOP_RELATION_EDGE_VISITS_PER_TERM
    );
  }

  return { direct, twoHop };
}

function edgeSpecificity(source: string, target: string, graph: SearchGraph): number {
  const sourceDegree = Math.max(1, graph.neighbors.get(source)?.size ?? 0);
  const targetDegree = Math.max(1, graph.neighbors.get(target)?.size ?? 0);
  return clamp01(2 / Math.sqrt(sourceDegree * targetDegree));
}

function updateBestRelation(
  relations: Map<string, FullTextRelationEvidence>,
  path: string,
  candidate: FullTextRelationEvidence
): void {
  const current = relations.get(path);
  if (!current || compareRelationEvidence(candidate, current) < 0) {
    relations.set(path, candidate);
  }
}

function compareRelationEvidence(
  a: FullTextRelationEvidence,
  b: FullTextRelationEvidence
): number {
  return (
    b.score - a.score ||
    a.hop - b.hop ||
    compareStrings(a.seedPath, b.seedPath) ||
    compareStrings(a.viaPath ?? "", b.viaPath ?? "") ||
    compareStrings(a.reason, b.reason)
  );
}

function aggregateTermScores(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return clamp01(0.7 * Math.min(...values) + 0.3 * average(values));
}

function classifyCoverage(
  text: TextEvidence[],
  direct: Array<FullTextRelationEvidence | undefined>,
  twoHop: Array<FullTextRelationEvidence | undefined>
): FullTextCoverageClass {
  const strong = text.map(
    (evidence, index) =>
      evidence.score >= STRONG_EVIDENCE_THRESHOLD ||
      (direct[index]?.score ?? 0) >= STRONG_DIRECT_RELATION_THRESHOLD
  );
  if (strong.every(Boolean)) {
    return "strong";
  }

  const complete = text.map(
    (evidence, index) =>
      evidence.score > 0 || (direct[index]?.score ?? 0) >= USEFUL_RELATION_THRESHOLD
  );
  if (complete.every(Boolean) && strong.some(Boolean)) {
    return "complete";
  }

  const related = text.map(
    (evidence, index) =>
      evidence.score > 0 ||
      (direct[index]?.score ?? 0) >= USEFUL_RELATION_THRESHOLD ||
      (twoHop[index]?.score ?? 0) >= USEFUL_RELATION_THRESHOLD
  );
  if (related.every(Boolean) && strong.some(Boolean)) {
    return "related";
  }

  return "weak";
}

function collectMatchedFields(evidence: TextEvidence[]): FullTextMatchedField[] {
  const fields = new Set<FullTextMatchedField>();
  for (const item of evidence) {
    for (const field of item.matchedFields) {
      fields.add(field);
    }
  }
  return FIELD_ORDER.filter((field) => fields.has(field));
}

function collectRelations(
  terms: ParsedFullTextTerm[],
  direct: Array<FullTextRelationEvidence | undefined>,
  twoHop: Array<FullTextRelationEvidence | undefined>
): FullTextRelationEvidence[] {
  const relations: FullTextRelationEvidence[] = [];
  for (let index = 0; index < terms.length; index += 1) {
    const relation = direct[index] ?? twoHop[index];
    if (relation) {
      relations.push(relation);
    }
  }
  return relations;
}

function findFirstBodyMatch(
  body: string,
  terms: ParsedFullTextTerm[]
): FullTextBodyMatch | undefined {
  const lines = body.split("\n");
  let lineOffset = 0;
  let best:
    | (FullTextBodyMatch & { matchedTermCount: number })
    | undefined;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const matches = terms
      .map((term) => ({ term, offset: line.indexOf(term.value) }))
      .filter((match) => match.offset >= 0)
      .sort((left, right) => left.offset - right.offset);
    const first = matches[0];
    if (first) {
      const candidate = {
        column: first.offset + 1,
        line: lineIndex + 1,
        matchedTermCount: matches.length,
        offset: lineOffset + first.offset,
        term: first.term.value
      };
      if (
        !best ||
        candidate.matchedTermCount > best.matchedTermCount ||
        (candidate.matchedTermCount === best.matchedTermCount &&
          candidate.offset < best.offset)
      ) {
        best = candidate;
      }
    }
    lineOffset += line.length + 1;
  }

  if (!best) {
    return undefined;
  }
  return {
    column: best.column,
    line: best.line,
    offset: best.offset,
    term: best.term
  };
}

function compareSearchResults(a: FullTextSearchResult, b: FullTextSearchResult): number {
  const classCompare = COVERAGE_ORDER[a.coverageClass] - COVERAGE_ORDER[b.coverageClass];
  if (classCompare !== 0) {
    return classCompare;
  }

  const scoreCompare = b.score - a.score;
  if (scoreCompare !== 0) {
    return scoreCompare;
  }

  const exactTitleCompare = b.exactTitleMatches - a.exactTitleMatches;
  if (exactTitleCompare !== 0) {
    return exactTitleCompare;
  }

  const pinnedTieBreak = Number(b.page.pinned) - Number(a.page.pinned);
  if (pinnedTieBreak !== 0) {
    return pinnedTieBreak;
  }

  return (
    b.breakdown.match - a.breakdown.match ||
    b.page.pageRank - a.page.pageRank ||
    b.page.modifiedTime - a.page.modifiedTime ||
    compareStrings(a.page.sortTitle, b.page.sortTitle) ||
    compareStrings(a.page.sortPath, b.page.sortPath) ||
    a.page.indexOrder - b.page.indexOrder
  );
}

function emptyTextEvidence(): TextEvidence {
  return {
    exactTitle: false,
    matchedFields: new Set(),
    score: 0
  };
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function compareStrings(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}

function normalizeRawLine(line: string): {
  normalized: string;
  offsets: Array<{ start: number; end: number }>;
} {
  let normalized = "";
  const offsets: Array<{ start: number; end: number }> = [];

  for (const part of splitNormalizationClusters(line)) {
    const normalizedSegment = normalizeSearchText(part.segment);
    normalized += normalizedSegment;
    for (let index = 0; index < normalizedSegment.length; index += 1) {
      offsets.push({ start: part.start, end: part.end });
    }
  }

  return { normalized, offsets };
}

function splitNormalizationClusters(
  value: string
): Array<{ end: number; segment: string; start: number }> {
  const clusters: Array<{ end: number; segment: string; start: number }> = [];
  let current: { end: number; segment: string; start: number } | null = null;
  let offset = 0;

  for (const character of value) {
    const start = offset;
    offset += character.length;
    const codePoint = character.codePointAt(0) ?? 0;
    if (current && isNormalizationExtender(codePoint)) {
      current.segment += character;
      current.end = offset;
      continue;
    }
    if (current) {
      clusters.push(current);
    }
    current = { end: offset, segment: character, start };
  }
  if (current) {
    clusters.push(current);
  }
  return clusters;
}

function isNormalizationExtender(codePoint: number): boolean {
  return (
    (codePoint >= 0x0300 && codePoint <= 0x036f) ||
    (codePoint >= 0x1ab0 && codePoint <= 0x1aff) ||
    (codePoint >= 0x1dc0 && codePoint <= 0x1dff) ||
    (codePoint >= 0x20d0 && codePoint <= 0x20ff) ||
    (codePoint >= 0x3099 && codePoint <= 0x309a) ||
    (codePoint >= 0xfe00 && codePoint <= 0xfe0f) ||
    (codePoint >= 0xfe20 && codePoint <= 0xfe2f) ||
    codePoint === 0xff9e ||
    codePoint === 0xff9f ||
    (codePoint >= 0xe0100 && codePoint <= 0xe01ef)
  );
}

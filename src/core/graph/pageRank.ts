import type { GraphIndex } from "./GraphIndex";

const BACKLINK_WEIGHT = 0.4;
const BACKLINK_AUTHORITY_WEIGHT = 0.25;
const OUTLINK_WEIGHT = 0.15;
const EDIT_FREQUENCY_WEIGHT = 0.2;
const EDIT_DECAY_DAYS = 90;
const DEFAULT_DAMPING_EXPONENT = 0.85;
const MAX_DEBUG_CONTRIBUTORS = 10;

export interface PageRankComponents {
  backlinks: number;
  backlinkAuthority: number;
  outlinks: number;
  editFrequency: number;
}

export interface PageRankContributor {
  contribution: number;
  path: string;
  sourceInDegree: number;
  sourceOutDegree: number;
}

export interface PageRankDebug {
  contributors: PageRankContributor[];
  ignoredSourceCount: number;
  normalizedComponents: PageRankComponents;
  pageRank: number;
  path: string;
  rawComponents: PageRankComponents;
}

export interface PageRankRecord {
  pageRank: number;
  components: PageRankComponents;
}

export interface PageRankStats {
  dampingExponent: number;
  ignoredSourceCount: number;
  nodes: number;
  edges: number;
  p95: PageRankComponents;
}

export interface PageRankResult {
  debug?: PageRankDebug;
  ranks: Map<string, PageRankRecord>;
  stats: PageRankStats;
}

export interface PageRankOptions {
  dampingExponent?: number;
  debugPath?: string;
  ignoredSourceCount?: number;
}

export function computePageRank(
  graph: GraphIndex,
  modifiedTimes: Map<string, number>,
  now = Date.now(),
  options: PageRankOptions = {}
): PageRankResult {
  const dampingExponent = options.dampingExponent ?? DEFAULT_DAMPING_EXPONENT;
  const raw = new Map<string, PageRankComponents>();
  const contributorMap = new Map<string, PageRankContributor[]>();
  const backlinkValues: number[] = [];
  const authorityValues: number[] = [];
  const outlinkValues: number[] = [];
  const editValues: number[] = [];
  let edgeCount = 0;

  for (const path of graph.paths) {
    const inlinks = graph.in.get(path) ?? new Set<string>();
    const outlinks = graph.out.get(path) ?? new Set<string>();
    const backlinks = Math.log1p(inlinks.size);
    const contributors = collectAuthorityContributors(
      inlinks,
      graph,
      dampingExponent
    );
    const backlinkAuthority = contributors.reduce(
      (total, contributor) => total + contributor.contribution,
      0
    );
    const outlinkScore = Math.log1p(outlinks.size);
    const editFrequency = computeEditScore(modifiedTimes.get(path) ?? now, now);

    edgeCount += outlinks.size;
    contributorMap.set(path, contributors);
    raw.set(path, {
      backlinks,
      backlinkAuthority,
      outlinks: outlinkScore,
      editFrequency
    });
    backlinkValues.push(backlinks);
    authorityValues.push(backlinkAuthority);
    outlinkValues.push(outlinkScore);
    editValues.push(editFrequency);
  }

  const p95: PageRankComponents = {
    backlinks: percentile(backlinkValues, 0.95),
    backlinkAuthority: percentile(authorityValues, 0.95),
    outlinks: percentile(outlinkValues, 0.95),
    editFrequency: percentile(editValues, 0.95)
  };
  const ranks = new Map<string, PageRankRecord>();
  let debug: PageRankDebug | undefined;

  for (const [path, components] of raw) {
    const normalized: PageRankComponents = {
      backlinks: normalizeComponent(components.backlinks, p95.backlinks),
      backlinkAuthority: normalizeComponent(
        components.backlinkAuthority,
        p95.backlinkAuthority
      ),
      outlinks: normalizeComponent(components.outlinks, p95.outlinks),
      editFrequency: normalizeComponent(components.editFrequency, p95.editFrequency)
    };
    const pageRank = clamp01(
      BACKLINK_WEIGHT * normalized.backlinks +
        BACKLINK_AUTHORITY_WEIGHT * normalized.backlinkAuthority +
        OUTLINK_WEIGHT * normalized.outlinks +
        EDIT_FREQUENCY_WEIGHT * normalized.editFrequency
    );

    ranks.set(path, {
      pageRank,
      components: normalized
    });

    if (options.debugPath && path === options.debugPath) {
      debug = {
        contributors: [...(contributorMap.get(path) ?? [])]
          .sort((a, b) => b.contribution - a.contribution)
          .slice(0, MAX_DEBUG_CONTRIBUTORS),
        ignoredSourceCount: options.ignoredSourceCount ?? 0,
        normalizedComponents: normalized,
        pageRank,
        path,
        rawComponents: components
      };
    }
  }

  return {
    debug,
    ranks,
    stats: {
      dampingExponent,
      ignoredSourceCount: options.ignoredSourceCount ?? 0,
      nodes: graph.paths.size,
      edges: edgeCount,
      p95
    }
  };
}

function collectAuthorityContributors(
  inlinks: Set<string>,
  graph: GraphIndex,
  dampingExponent: number
): PageRankContributor[] {
  const contributors: PageRankContributor[] = [];

  for (const sourcePath of inlinks) {
    const sourceInDegree = graph.in.get(sourcePath)?.size ?? 0;
    const sourceOutDegree = graph.out.get(sourcePath)?.size ?? 0;
    const contribution =
      Math.log1p(sourceInDegree) /
      Math.pow(Math.max(1, sourceOutDegree), dampingExponent);

    if (contribution <= 0) {
      continue;
    }

    contributors.push({
      contribution,
      path: sourcePath,
      sourceInDegree,
      sourceOutDegree
    });
  }

  return contributors;
}

function computeEditScore(modifiedTime: number, now: number): number {
  const ageMs = Math.max(0, now - modifiedTime);
  const daysSinceModified = ageMs / (24 * 60 * 60 * 1000);
  return Math.exp(-daysSinceModified / EDIT_DECAY_DAYS);
}

function percentile(values: number[], percentileValue: number): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(percentileValue * sorted.length) - 1)
  );

  return sorted[index];
}

function normalizeComponent(value: number, p95: number): number {
  if (value <= 0 || p95 <= 0) {
    return 0;
  }

  return clamp01(value / (value + p95));
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

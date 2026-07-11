import type { App, TFile } from "obsidian";
import {
  buildGraphIndex,
  countGraphEdges,
  createPageRankGraph,
  sortedGraphLinks,
  type GraphIndex
} from "../graph/GraphIndex";
import {
  computePageRank,
  type PageRankComponents,
  type PageRankRecord
} from "../graph/pageRank";
import {
  extractBodyMetadata,
  extractPageMetadata,
  type BodyDerivedMetadata
} from "./extractPageMetadata";
import type { PageRecord } from "./PageRecord";
import type { PalmWikiHomeSettings } from "../../settings/Settings";
import { isPathInFolder, passesFolderSettings } from "../filters/filterPages";

const DEFAULT_BODY_READ_CONCURRENCY = 2;
const DEFAULT_YIELD_EVERY = 16;

export interface BodyMetadataCacheEntry extends BodyDerivedMetadata {
  path: string;
  mtime: number;
  size: number;
}

export type BodyMetadataCache = Map<string, BodyMetadataCacheEntry>;

export interface BuildPageIndexStats {
  bodyCacheHits: number;
  bodyReads: number;
  activeBodyReads?: number;
  maxConcurrentBodyReads?: number;
  graphBuild?: {
    ms: number;
    nodes: number;
    edges: number;
  };
  pageRank?: {
    debug?: unknown;
    dampingExponent: number;
    ignoredSourceCount: number;
    ms: number;
    nodes: number;
    edges: number;
    p95: PageRankComponents;
  };
}

export interface BuildPageIndexOptions {
  bodyMetadataCache: BodyMetadataCache;
  stats?: BuildPageIndexStats;
  concurrency?: number;
}

export async function buildPageIndex(
  app: App,
  settings: PalmWikiHomeSettings,
  options: BuildPageIndexOptions
): Promise<PageRecord[]> {
  const pinnedPages = new Set(settings.pinnedPages);
  const markdownFiles = app.vault
    .getMarkdownFiles()
    .filter((file) =>
      passesFolderSettings(file.path, settings.includeFolders, settings.excludeFolders)
    );
  const allowedPaths = new Set(markdownFiles.map((file) => file.path));
  const graphStartedAt = performance.now();
  const graph = buildGraphIndex(app.metadataCache.resolvedLinks, allowedPaths);
  const ignoredPageRankSources = getIgnoredPageRankSources(markdownFiles, settings);
  const pageRankGraph = createPageRankGraph(graph, ignoredPageRankSources);

  if (options.stats) {
    options.stats.graphBuild = {
      ms: Math.round(performance.now() - graphStartedAt),
      nodes: graph.paths.size,
      edges: countGraphEdges(graph)
    };
  }

  await yieldToEventLoop();

  const pageRankStartedAt = performance.now();
  const pageRank = computePageRank(
    pageRankGraph,
    buildModifiedTimeMap(markdownFiles),
    Date.now(),
    {
      debugPath: settings.performanceDebug ? settings.pageRankDebugPath : "",
      ignoredSourceCount: ignoredPageRankSources.size
    }
  );

  if (options.stats) {
    options.stats.pageRank = {
      debug: pageRank.debug,
      dampingExponent: pageRank.stats.dampingExponent,
      ignoredSourceCount: pageRank.stats.ignoredSourceCount,
      ms: Math.round(performance.now() - pageRankStartedAt),
      nodes: pageRank.stats.nodes,
      edges: pageRank.stats.edges,
      p95: pageRank.stats.p95
    };
  }

  await yieldToEventLoop();

  const records = await mapWithConcurrency(
    markdownFiles,
    options.concurrency ?? DEFAULT_BODY_READ_CONCURRENCY,
    (file, index) =>
      buildRecord(
        app,
        file,
        pinnedPages,
        options.bodyMetadataCache,
        graph,
        pageRank.ranks,
        index,
        options.stats
      ),
    DEFAULT_YIELD_EVERY
  );

  return records.filter((record): record is PageRecord => record !== null);
}

async function buildRecord(
  app: App,
  file: TFile,
  pinnedPages: Set<string>,
  bodyMetadataCache: BodyMetadataCache,
  graph: GraphIndex,
  pageRanks: Map<string, PageRankRecord>,
  indexOrder: number,
  stats: BuildPageIndexStats | undefined
): Promise<PageRecord | null> {
  const cache = app.metadataCache.getFileCache(file);
  const bodyMetadata = await getBodyMetadata(app, file, bodyMetadataCache, stats);

  if (!bodyMetadata && !app.vault.getAbstractFileByPath(file.path)) {
    return null;
  }

  return extractPageMetadata(
    app,
    file,
    cache,
    bodyMetadata ?? emptyBodyMetadata(),
    getPageGraphMetadata(file.path, graph, pageRanks),
    pinnedPages.has(file.path),
    indexOrder
  );
}

function getPageGraphMetadata(
  path: string,
  graph: GraphIndex,
  pageRanks: Map<string, PageRankRecord>
): PageGraphMetadata {
  const outlinks = sortedGraphLinks(graph.out.get(path));
  const inlinks = sortedGraphLinks(graph.in.get(path));
  const rank = pageRanks.get(path);

  return {
    outlinks,
    inlinks,
    outlinkCount: outlinks.length,
    inlinkCount: inlinks.length,
    pageRank: rank?.pageRank ?? 0,
    pageRankComponents: rank?.components
  };
}

function buildModifiedTimeMap(files: TFile[]): Map<string, number> {
  return new Map(files.map((file) => [file.path, file.stat.mtime]));
}

function getIgnoredPageRankSources(
  files: TFile[],
  settings: PalmWikiHomeSettings
): Set<string> {
  const matchers = buildPathPatternMatchers(settings.pageRankIgnoredSourcePathPatterns);
  const ignored = new Set<string>();

  for (const file of files) {
    if (
      settings.pageRankIgnoredSourceFolders.some((folder) =>
        isPathInFolder(file.path, folder)
      ) ||
      matchers.some((matches) => matches(file.path))
    ) {
      ignored.add(file.path);
    }
  }

  return ignored;
}

function buildPathPatternMatchers(patterns: string[]): Array<(path: string) => boolean> {
  return patterns.map((pattern) => {
    try {
      const regex = new RegExp(pattern);
      return (path: string) => regex.test(path);
    } catch (_error) {
      return (path: string) => path.includes(pattern);
    }
  });
}

export interface PageGraphMetadata {
  outlinks: string[];
  inlinks: string[];
  outlinkCount: number;
  inlinkCount: number;
  pageRank: number;
  pageRankComponents?: PageRankComponents;
}

async function getBodyMetadata(
  app: App,
  file: TFile,
  bodyMetadataCache: BodyMetadataCache,
  stats: BuildPageIndexStats | undefined
): Promise<BodyDerivedMetadata | null> {
  const cached = bodyMetadataCache.get(file.path);

  if (
    cached &&
    cached.path === file.path &&
    cached.mtime === file.stat.mtime &&
    cached.size === file.stat.size
  ) {
    if (stats) {
      stats.bodyCacheHits += 1;
    }

    return cached;
  }

  if (stats) {
    stats.activeBodyReads = (stats.activeBodyReads ?? 0) + 1;
    stats.maxConcurrentBodyReads = Math.max(
      stats.maxConcurrentBodyReads ?? 0,
      stats.activeBodyReads
    );
  }

  try {
    const body = await app.vault.cachedRead(file);
    if (stats) {
      stats.bodyReads += 1;
    }

    const bodyMetadata = extractBodyMetadata(body);
    bodyMetadataCache.set(file.path, {
      path: file.path,
      mtime: file.stat.mtime,
      size: file.stat.size,
      ...bodyMetadata
    });

    return bodyMetadata;
  } catch (error) {
    return null;
  } finally {
    if (stats) {
      stats.activeBodyReads = Math.max(0, (stats.activeBodyReads ?? 1) - 1);
    }
  }
}

function emptyBodyMetadata(): BodyDerivedMetadata {
  return {
    lineCount: 0,
    charCount: 0,
    description: ""
  };
}

export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
  yieldEvery = 0
): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length));

  async function runWorker(): Promise<void> {
    let completedSinceYield = 0;

    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
      completedSinceYield += 1;

      if (yieldEvery > 0 && completedSinceYield >= yieldEvery) {
        completedSinceYield = 0;
        await yieldToEventLoop();
      }
    }
  }

  await Promise.all(Array.from({ length: workerCount }, runWorker));
  return results;
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, 0);
  });
}

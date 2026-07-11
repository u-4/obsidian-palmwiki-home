export interface GraphIndex {
  paths: Set<string>;
  out: Map<string, Set<string>>;
  in: Map<string, Set<string>>;
}

export type ResolvedLinks = Record<string, Record<string, number>>;

export function createEmptyGraphIndex(): GraphIndex {
  return {
    paths: new Set(),
    out: new Map(),
    in: new Map()
  };
}

export function buildGraphIndex(
  resolvedLinks: ResolvedLinks,
  allowedPaths: Set<string>
): GraphIndex {
  const graph = createEmptyGraphIndex();

  for (const path of allowedPaths) {
    graph.paths.add(path);
    graph.out.set(path, new Set());
    graph.in.set(path, new Set());
  }

  for (const [sourcePath, destinations] of Object.entries(resolvedLinks)) {
    if (!allowedPaths.has(sourcePath)) {
      continue;
    }

    const sourceOutlinks = graph.out.get(sourcePath);
    if (!sourceOutlinks) {
      continue;
    }

    for (const destinationPath of Object.keys(destinations)) {
      if (
        destinationPath === sourcePath ||
        !allowedPaths.has(destinationPath)
      ) {
        continue;
      }

      sourceOutlinks.add(destinationPath);
      graph.in.get(destinationPath)?.add(sourcePath);
    }
  }

  return graph;
}

export function countGraphEdges(graph: GraphIndex): number {
  let edgeCount = 0;

  for (const outlinks of graph.out.values()) {
    edgeCount += outlinks.size;
  }

  return edgeCount;
}

export function createPageRankGraph(
  displayGraph: GraphIndex,
  ignoredSourcePaths: Set<string>
): GraphIndex {
  const graph = createEmptyGraphIndex();

  for (const path of displayGraph.paths) {
    graph.paths.add(path);
    graph.out.set(path, new Set());
    graph.in.set(path, new Set());
  }

  for (const [sourcePath, outlinks] of displayGraph.out) {
    if (ignoredSourcePaths.has(sourcePath)) {
      continue;
    }

    const sourceOutlinks = graph.out.get(sourcePath);
    if (!sourceOutlinks) {
      continue;
    }

    for (const destinationPath of outlinks) {
      sourceOutlinks.add(destinationPath);
      graph.in.get(destinationPath)?.add(sourcePath);
    }
  }

  return graph;
}

export function sortedGraphLinks(links: Set<string> | undefined): string[] {
  return [...(links ?? [])].sort((a, b) => a.localeCompare(b));
}

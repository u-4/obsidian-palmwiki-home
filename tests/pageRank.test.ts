import assert from "node:assert/strict";
import test from "node:test";
import {
  createEmptyGraphIndex,
  createPageRankGraph
} from "../src/core/graph/GraphIndex";
import { computePageRank } from "../src/core/graph/pageRank";

test("PageRank scores are finite, bounded, and deterministic", () => {
  const graph = createEmptyGraphIndex();
  for (const path of ["A.md", "B.md", "C.md"]) {
    addPath(graph, path);
  }
  addEdge(graph, "A.md", "B.md");
  addEdge(graph, "B.md", "C.md");

  const modifiedTimes = new Map([
    ["A.md", 1000],
    ["B.md", 1000],
    ["C.md", 1000]
  ]);
  const first = computePageRank(graph, modifiedTimes, 1000);
  const second = computePageRank(graph, modifiedTimes, 1000);

  for (const record of first.ranks.values()) {
    assert.equal(Number.isFinite(record.pageRank), true);
    assert.equal(record.pageRank >= 0 && record.pageRank <= 1, true);
  }
  assert.deepEqual(first, second);
});

test("a focused source contributes more authority than a broad hub", () => {
  const graph = createEmptyGraphIndex();
  const hubTargets = Array.from({ length: 20 }, (_, index) => `HubTarget${index}.md`);
  const paths = [
    "Hub.md",
    "Focused.md",
    "FocusedTarget.md",
    ...hubTargets,
    ...Array.from({ length: 20 }, (_, index) => `HubBacker${index}.md`),
    ...Array.from({ length: 3 }, (_, index) => `FocusBacker${index}.md`)
  ];
  for (const path of paths) {
    addPath(graph, path);
  }
  for (let index = 0; index < 20; index += 1) {
    addEdge(graph, `HubBacker${index}.md`, "Hub.md");
    addEdge(graph, "Hub.md", `HubTarget${index}.md`);
  }
  for (let index = 0; index < 3; index += 1) {
    addEdge(graph, `FocusBacker${index}.md`, "Focused.md");
  }
  addEdge(graph, "Focused.md", "FocusedTarget.md");

  const modifiedTimes = new Map(paths.map((path) => [path, 1000]));
  const result = computePageRank(graph, modifiedTimes, 1000);
  const focusedRank = result.ranks.get("FocusedTarget.md")?.pageRank ?? 0;
  const hubRank = result.ranks.get("HubTarget0.md")?.pageRank ?? 0;

  assert.ok(focusedRank > hubRank);
});

test("ignoring a source removes only its PageRank edges and preserves the display graph", () => {
  const displayGraph = createEmptyGraphIndex();
  for (const path of ["Hub.md", "Target.md", "Other.md"]) {
    addPath(displayGraph, path);
  }
  addEdge(displayGraph, "Hub.md", "Target.md");
  addEdge(displayGraph, "Other.md", "Target.md");

  const rankGraph = createPageRankGraph(displayGraph, new Set(["Hub.md"]));

  assert.deepEqual([...rankGraph.paths], [...displayGraph.paths]);
  assert.equal(rankGraph.out.get("Hub.md")?.size, 0);
  assert.equal(rankGraph.out.get("Other.md")?.has("Target.md"), true);
  assert.equal(displayGraph.out.get("Hub.md")?.has("Target.md"), true);
  assert.equal(displayGraph.in.get("Target.md")?.size, 2);
});

function addPath(
  graph: ReturnType<typeof createEmptyGraphIndex>,
  path: string
): void {
  graph.paths.add(path);
  graph.out.set(path, new Set());
  graph.in.set(path, new Set());
}

function addEdge(
  graph: ReturnType<typeof createEmptyGraphIndex>,
  source: string,
  target: string
): void {
  graph.out.get(source)?.add(target);
  graph.in.get(target)?.add(source);
}

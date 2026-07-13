import assert from "node:assert/strict";
import test from "node:test";
import {
  createPersistentSearchCache,
  createSearchCacheEntry
} from "../src/core/search/searchCache";
import {
  getSearchIndexCapacityError,
  getSearchSettingsKey,
  isSearchIndexEstimatedMemoryWithinCap,
  SEARCH_INDEX_MAX_FILE_BYTES,
  SEARCH_INDEX_MAX_SOURCE_BYTES,
  SearchIndexManager
} from "../src/searchIndex";
import { DEFAULT_SETTINGS } from "../src/settings/Settings";

interface FakeFile {
  extension: string;
  path: string;
  stat: {
    mtime: number;
    size: number;
  };
}

test("a file modified during indexing is reread and stale text is never published", async () => {
  const file = makeFile("Notes/A.md", 1, 3);
  const files = [file];
  const bodies = new Map([[file.path, "old"]]);
  const started = deferred<void>();
  const release = deferred<void>();
  let readCount = 0;
  const harness = createHarness(files, bodies, async (currentFile) => {
    readCount += 1;
    const captured = bodies.get(currentFile.path) ?? "";
    if (readCount === 1) {
      started.resolve(undefined);
      await release.promise;
    }
    return captured;
  });

  const work = harness.manager.ensureReady("test");
  await started.promise;
  bodies.set(file.path, "new body");
  file.stat.mtime = 2;
  file.stat.size = 8;
  harness.manager.handleFileCreateOrModify(file as never, "vault-modify");
  release.resolve(undefined);
  await work;

  assert.equal(harness.manager.getDocumentBody(file.path), "new body");
  assert.equal(harness.manager.getState().phase, "ready");
  assert.equal(readCount, 2);
  harness.manager.unload();
});

test("concurrent ensure calls share one indexing operation", async () => {
  const file = makeFile("Notes/A.md", 1, 4);
  const started = deferred<void>();
  const release = deferred<void>();
  let readCount = 0;
  const harness = createHarness([file], new Map([[file.path, "body"]]), async () => {
    readCount += 1;
    started.resolve(undefined);
    await release.promise;
    return "body";
  });

  const first = harness.manager.ensureReady("first");
  await started.promise;
  const second = harness.manager.ensureReady("second");
  const third = harness.manager.ensureReady("third");
  release.resolve(undefined);
  await Promise.all([first, second, third]);

  assert.equal(readCount, 1);
  assert.equal(harness.manager.getState().phase, "ready");
  harness.manager.unload();
});

test("a file deleted during indexing cannot return from an old snapshot", async () => {
  const file = makeFile("Notes/A.md", 1, 4);
  const files = [file];
  const bodies = new Map([[file.path, "body"]]);
  const started = deferred<void>();
  const release = deferred<void>();
  const harness = createHarness(files, bodies, async () => {
    started.resolve(undefined);
    await release.promise;
    return "body";
  });

  const work = harness.manager.ensureReady("test");
  await started.promise;
  files.splice(0, files.length);
  bodies.delete(file.path);
  harness.manager.handleFileDelete(file as never);
  release.resolve(undefined);
  await work;

  assert.equal(harness.manager.getDocumentBody(file.path), undefined);
  assert.deepEqual([...harness.manager.getDocuments()], []);
  assert.deepEqual(harness.manager.getState(), {
    phase: "ready",
    indexedCount: 0,
    processedCount: 0,
    totalCount: 0,
    isUsingCachedIndex: false,
    lastIndexedAt: harness.manager.getState().lastIndexedAt,
    lastError: null,
    persistenceWarning: null
  });
  harness.manager.unload();
});

test("a file renamed during indexing is published only under its new canonical path", async () => {
  const file = makeFile("Notes/Old.md", 1, 4);
  const files = [file];
  const bodies = new Map([[file.path, "body"]]);
  const started = deferred<void>();
  const release = deferred<void>();
  const harness = createHarness(files, bodies, async (currentFile) => {
    const captured = bodies.get(currentFile.path) ?? "";
    started.resolve(undefined);
    await release.promise;
    return captured;
  });

  const work = harness.manager.ensureReady("test");
  await started.promise;
  const oldPath = file.path;
  bodies.delete(oldPath);
  file.path = "Notes/New.md";
  file.stat.mtime = 2;
  bodies.set(file.path, "renamed body");
  harness.manager.handleFileRename(file as never, oldPath);
  release.resolve(undefined);
  await work;

  assert.equal(harness.manager.getDocumentBody(oldPath), undefined);
  assert.equal(harness.manager.getDocumentBody(file.path), "renamed body");
  assert.equal(harness.manager.getState().phase, "ready");
  harness.manager.unload();
});

test("scope changes purge a disk cache even while Home is inactive", async () => {
  const cachePath = ".test-config/plugins/palmwiki-home/search-cache.json";
  const disk = new Map([[cachePath, "private normalized body"]]);
  const harness = createHarness([], new Map(), async () => "", disk, false);

  harness.manager.handleScopeChange();
  await waitFor(() => !disk.has(cachePath));

  assert.equal(disk.has(cachePath), false);
  harness.manager.unload();
});

test("hydration removes deleted-note text from disk before a delayed rewrite", async () => {
  const cachePath = ".test-config/plugins/palmwiki-home/search-cache.json";
  const keptFile = makeFile("Notes/Keep.md", 2, 4);
  const deletedEntry = createSearchCacheEntry(
    { path: "Notes/Deleted.md", mtime: 1, size: 7 },
    "private deleted text"
  );
  const keptEntry = createSearchCacheEntry(
    { path: keptFile.path, mtime: keptFile.stat.mtime, size: keptFile.stat.size },
    "keep"
  );
  assert.ok(deletedEntry);
  assert.ok(keptEntry);
  const disk = new Map([
    [
      cachePath,
      JSON.stringify(
        createPersistentSearchCache(
          getSearchSettingsKey(DEFAULT_SETTINGS),
          [deletedEntry, keptEntry],
          123
        )
      )
    ]
  ]);
  let readCount = 0;
  const harness = createHarness(
    [keptFile],
    new Map([[keptFile.path, "keep"]]),
    async () => {
      readCount += 1;
      return "keep";
    },
    disk
  );

  await harness.manager.ensureReady("test");
  await waitFor(() => !disk.has(cachePath));

  assert.equal(readCount, 0);
  assert.equal(harness.manager.getDocumentBody("Notes/Deleted.md"), undefined);
  assert.equal(harness.manager.getDocumentBody(keptFile.path), "keep");
  assert.equal(disk.has(cachePath), false);
  harness.manager.unload();
});

test("hydration purges a cache from a previous search scope", async () => {
  const cachePath = ".test-config/plugins/palmwiki-home/search-cache.json";
  const privateEntry = createSearchCacheEntry(
    { path: "Private/Old.md", mtime: 1, size: 7 },
    "private old text"
  );
  assert.ok(privateEntry);
  const disk = new Map([
    [
      cachePath,
      JSON.stringify(createPersistentSearchCache("old-scope", [privateEntry], 123))
    ]
  ]);
  const harness = createHarness([], new Map(), async () => "", disk);

  await harness.manager.ensureReady("test");
  await waitFor(() => !disk.has(cachePath));

  assert.equal(disk.has(cachePath), false);
  assert.equal(harness.manager.getState().phase, "ready");
  harness.manager.unload();
});

test("events for excluded notes leave the valid disk cache untouched", async () => {
  const cachePath = ".test-config/plugins/palmwiki-home/search-cache.json";
  const disk = new Map([[cachePath, "valid cache sentinel"]]);
  const file = makeFile("Archive/A.md", 1, 4);
  const harness = createHarness(
    [file],
    new Map([[file.path, "body"]]),
    async () => "body",
    disk,
    true,
    { excludeFolders: ["Archive"] }
  );

  harness.manager.handleFileCreateOrModify(file as never, "vault-modify");
  harness.manager.handleFileDelete(file as never);
  const oldPath = file.path;
  file.path = "Archive/B.md";
  harness.manager.handleFileRename(file as never, oldPath);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(disk.get(cachePath), "valid cache sentinel");
  harness.manager.unload();
});

test("a failed cache purge clears its warning after the next successful retry", async () => {
  const cachePath = ".test-config/plugins/palmwiki-home/search-cache.json";
  const disk = new Map([[cachePath, "private normalized body"]]);
  const harness = createHarness(
    [],
    new Map(),
    async () => "",
    disk,
    true,
    {},
    1
  );

  harness.manager.handleScopeChange();
  await waitFor(() => harness.manager.getState().persistenceWarning !== null);
  assert.equal(disk.has(cachePath), true);

  await harness.manager.ensureReady("retry");
  await waitFor(
    () => !disk.has(cachePath) && harness.manager.getState().persistenceWarning === null
  );

  assert.equal(harness.manager.getState().persistenceWarning, null);
  harness.manager.unload();
});

test("a ready index does not rescan the Vault on another ensure", async () => {
  const file = makeFile("Notes/A.md", 1, 4);
  const harness = createHarness(
    [file],
    new Map([[file.path, "body"]]),
    async () => "body"
  );

  await harness.manager.ensureReady("first");
  const scansAfterFirstEnsure = harness.getMarkdownFilesCount();
  await harness.manager.ensureReady("second");

  assert.equal(harness.getMarkdownFilesCount(), scansAfterFirstEnsure);
  harness.manager.unload();
});

test("a read failure reaches a stable error state without automatic retry", async () => {
  const file = makeFile("Notes/A.md", 1, 4);
  let readCount = 0;
  const harness = createHarness([file], new Map(), async () => {
    readCount += 1;
    throw new Error("read failed");
  });

  await harness.manager.ensureReady("test");
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(readCount, 1);
  assert.equal(harness.manager.getState().phase, "error");
  harness.manager.unload();
});

test("capacity limits reject oversized source before reading or publishing a partial index", async () => {
  const oversized = makeFile(
    "Notes/Oversized.md",
    1,
    SEARCH_INDEX_MAX_FILE_BYTES + 1
  );
  let readCount = 0;
  const harness = createHarness([oversized], new Map(), async () => {
    readCount += 1;
    return "body";
  });

  await harness.manager.ensureReady("test");

  assert.equal(readCount, 0);
  assert.equal(harness.manager.getState().phase, "error");
  assert.match(harness.manager.getState().lastError ?? "", /8 MiB/);
  assert.deepEqual([...harness.manager.getDocuments()], []);
  harness.manager.unload();
});

test("capacity checks accept exact source boundaries and reject aggregate overflow", () => {
  assert.equal(
    getSearchIndexCapacityError([
      { path: "Notes/A.md", mtime: 1, size: SEARCH_INDEX_MAX_FILE_BYTES }
    ]),
    null
  );

  const exactTotal = Array.from(
    { length: SEARCH_INDEX_MAX_SOURCE_BYTES / SEARCH_INDEX_MAX_FILE_BYTES },
    (_, index) => ({
      path: `Notes/${index}.md`,
      mtime: 1,
      size: SEARCH_INDEX_MAX_FILE_BYTES
    })
  );
  assert.equal(getSearchIndexCapacityError(exactTotal), null);
  assert.match(
    getSearchIndexCapacityError([
      ...exactTotal,
      { path: "Notes/Overflow.md", mtime: 1, size: 1 }
    ]) ?? "",
    /64 MiB/
  );

  const entry = createSearchCacheEntry(
    { path: "Notes/Memory.md", mtime: 1, size: 4 },
    "body"
  );
  assert.ok(entry);
  const estimatedBytes = 2 * (entry.path.length + entry.normalizedBody.length);
  assert.equal(
    isSearchIndexEstimatedMemoryWithinCap([entry], estimatedBytes),
    true
  );
  assert.equal(
    isSearchIndexEstimatedMemoryWithinCap([entry], estimatedBytes - 1),
    false
  );
});

function createHarness(
  files: FakeFile[],
  bodies: Map<string, string>,
  read: (file: FakeFile) => Promise<string>,
  disk = new Map<string, string>(),
  isHomeActive: boolean | (() => boolean) = true,
  settingsOverride: Partial<typeof DEFAULT_SETTINGS> = {},
  removeFailures = 0
): { getMarkdownFilesCount: () => number; manager: SearchIndexManager } {
  let remainingRemoveFailures = removeFailures;
  let getMarkdownFilesCount = 0;
  const adapter = {
    async exists(path: string): Promise<boolean> {
      return disk.has(path);
    },
    async read(path: string): Promise<string> {
      const value = disk.get(path);
      if (value === undefined) {
        throw new Error("missing");
      }
      return value;
    },
    async remove(path: string): Promise<void> {
      if (remainingRemoveFailures > 0) {
        remainingRemoveFailures -= 1;
        throw new Error("remove failed");
      }
      disk.delete(path);
    },
    async stat(path: string): Promise<{ size: number } | null> {
      const value = disk.get(path);
      return value === undefined ? null : { size: new TextEncoder().encode(value).byteLength };
    },
    async write(path: string, value: string): Promise<void> {
      disk.set(path, value);
    }
  };
  const vault = {
    adapter,
    async cachedRead(file: FakeFile): Promise<string> {
      return read(file);
    },
    getAbstractFileByPath(path: string): FakeFile | null {
      return files.find((file) => file.path === path) ?? null;
    },
    getMarkdownFiles(): FakeFile[] {
      getMarkdownFilesCount += 1;
      return [...files];
    }
  };
  const manager = new SearchIndexManager({
    app: { vault } as never,
    cacheDirectory: ".test-config/plugins/palmwiki-home",
    getSettings: () => ({ ...DEFAULT_SETTINGS, ...settingsOverride }),
    isHomeActive: () =>
      typeof isHomeActive === "function" ? isHomeActive() : isHomeActive,
    logPerformance: () => undefined
  });

  return { manager, getMarkdownFilesCount: () => getMarkdownFilesCount };
}

function makeFile(path: string, mtime: number, size: number): FakeFile {
  return {
    extension: "md",
    path,
    stat: { mtime, size }
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.fail("condition was not met");
}

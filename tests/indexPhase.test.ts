import assert from "node:assert/strict";
import test from "node:test";
import { deriveIndexPhase } from "../src/core/index/IndexPhase";

test("dirty indexes wait until a rebuild starts", () => {
  assert.equal(
    deriveIndexPhase({ indexDirty: true, isIndexing: false, lastError: null }),
    "waiting"
  );
});

test("an active build is reported as indexing", () => {
  assert.equal(
    deriveIndexPhase({ indexDirty: true, isIndexing: true, lastError: null }),
    "indexing"
  );
});

test("a clean index is reported as complete", () => {
  assert.equal(
    deriveIndexPhase({ indexDirty: false, isIndexing: false, lastError: null }),
    "complete"
  );
});

test("an idle failure is reported as an error", () => {
  assert.equal(
    deriveIndexPhase({ indexDirty: true, isIndexing: false, lastError: "Failed" }),
    "error"
  );
});

test("an active retry takes precedence over an older error", () => {
  assert.equal(
    deriveIndexPhase({ indexDirty: true, isIndexing: true, lastError: "Old failure" }),
    "indexing"
  );
});

test("the normal lifecycle is waiting, indexing, then complete", () => {
  const lifecycle = [
    deriveIndexPhase({ indexDirty: true, isIndexing: false, lastError: null }),
    deriveIndexPhase({ indexDirty: true, isIndexing: true, lastError: null }),
    deriveIndexPhase({ indexDirty: false, isIndexing: false, lastError: null })
  ];

  assert.deepEqual(lifecycle, ["waiting", "indexing", "complete"]);
});

import assert from "node:assert/strict";
import test from "node:test";
import { matchesFileSnapshot } from "../src/core/index/buildPageIndex";

const original = {
  path: "Notes/Example.md",
  mtime: 100,
  size: 200
};

test("file snapshots match only when path, modified time, and size are unchanged", () => {
  assert.equal(matchesFileSnapshot({ ...original }, original), true);
  assert.equal(
    matchesFileSnapshot({ ...original, path: "Notes/Renamed.md" }, original),
    false
  );
  assert.equal(matchesFileSnapshot({ ...original, mtime: 101 }, original), false);
  assert.equal(matchesFileSnapshot({ ...original, size: 201 }, original), false);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  canRunScheduledRebuild,
  mergeRebuildRequest
} from "../src/core/index/RebuildRequest";

test("a background-capable rebuild request cannot be downgraded", () => {
  assert.deepEqual(
    mergeRebuildRequest(
      { reason: "startup", allowBackground: true },
      { reason: "view-open", allowBackground: false }
    ),
    { reason: "view-open", allowBackground: true }
  );
});

test("a later background-capable request upgrades an interactive request", () => {
  assert.deepEqual(
    mergeRebuildRequest(
      { reason: "view-open", allowBackground: false },
      { reason: "startup", allowBackground: true }
    ),
    { reason: "startup", allowBackground: true }
  );
});

test("interactive-only rebuild requests remain interactive-only", () => {
  assert.deepEqual(
    mergeRebuildRequest(
      { reason: "metadata-change", allowBackground: false },
      { reason: "view-open", allowBackground: false }
    ),
    { reason: "view-open", allowBackground: false }
  );
});

test("background permission or an active Home view is sufficient to run", () => {
  assert.equal(
    canRunScheduledRebuild(
      { reason: "manual-refresh", allowBackground: true },
      false
    ),
    true
  );
  assert.equal(
    canRunScheduledRebuild(
      { reason: "view-open", allowBackground: false },
      true
    ),
    true
  );
  assert.equal(
    canRunScheduledRebuild(
      { reason: "view-open", allowBackground: false },
      false
    ),
    false
  );
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  createLatchedPredicate,
  mapWithConcurrency
} from "../src/core/index/buildPageIndex";

test("mapWithConcurrency preserves order and never exceeds its limit", async () => {
  const items = Array.from({ length: 24 }, (_, index) => index);
  let active = 0;
  let maximumActive = 0;

  const results = await mapWithConcurrency(
    items,
    2,
    async (item) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, item % 3));
      active -= 1;
      return item * 2;
    },
    4
  );

  assert.equal(maximumActive, 2);
  assert.deepEqual(results, items.map((item) => item * 2));
});

test("mapWithConcurrency stops assigning new work after cancellation", async () => {
  const items = Array.from({ length: 100 }, (_, index) => index);
  let started = 0;
  let stopped = false;

  await mapWithConcurrency(
    items,
    2,
    async () => {
      started += 1;
      if (started >= 4) {
        stopped = true;
      }
      await new Promise((resolve) => setTimeout(resolve, 1));
    },
    0,
    () => stopped
  );

  assert.equal(started, 4);
});

test("a latched cancellation remains true after the source condition clears", () => {
  let source = false;
  const cancelled = createLatchedPredicate(() => source);

  assert.equal(cancelled(), false);
  source = true;
  assert.equal(cancelled(), true);
  source = false;
  assert.equal(cancelled(), true);
});

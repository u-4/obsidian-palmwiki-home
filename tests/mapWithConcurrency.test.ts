import assert from "node:assert/strict";
import test from "node:test";
import { mapWithConcurrency } from "../src/core/index/buildPageIndex";

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

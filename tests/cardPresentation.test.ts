import assert from "node:assert/strict";
import test from "node:test";
import { getCardPresentation } from "../src/ui/cardPresentation";

test("portrait cards retain path fallback and secondary metadata", () => {
  assert.deepEqual(getCardPresentation("portrait"), {
    showDescriptionPathFallback: true,
    showSecondaryMetadata: true
  });
});

test("square cards hide path fallback and secondary metadata", () => {
  assert.deepEqual(getCardPresentation("square"), {
    showDescriptionPathFallback: false,
    showSecondaryMetadata: false
  });
});

import assert from "node:assert/strict";
import test from "node:test";
import type { HoverParent } from "obsidian";
import {
  createCardPreviewEventPayload,
  getCardPreviewSource,
  isCardPreviewMode
} from "../src/cardPreview";

test("Card preview modes map to safe Obsidian Page Preview sources", () => {
  assert.equal(getCardPreviewSource("off"), null);
  assert.deepEqual(getCardPreviewSource("modifier"), {
    id: "palmwiki-home-card-preview-modifier",
    info: { display: "PalmWiki Home cards", defaultMod: true }
  });
  assert.deepEqual(getCardPreviewSource("hover"), {
    id: "palmwiki-home-card-preview-hover",
    info: { display: "PalmWiki Home cards", defaultMod: false }
  });
});

test("Card preview mode validation rejects unknown saved values", () => {
  for (const mode of ["off", "modifier", "hover"]) {
    assert.equal(isCardPreviewMode(mode), true);
  }
  assert.equal(isCardPreviewMode("always"), false);
  assert.equal(isCardPreviewMode(null), false);
});

test("Card previews use the canonical path and clicked Home leaf as hover parent", () => {
  const event = {} as MouseEvent;
  const hoverParent = { hoverPopover: null } as HoverParent;
  const targetEl = {} as HTMLElement;
  const source = getCardPreviewSource("modifier");
  assert.ok(source);

  assert.deepEqual(
    createCardPreviewEventPayload({
      event,
      hoverParent,
      path: "Folder/Page.md",
      source,
      targetEl
    }),
    {
      event,
      hoverParent,
      linktext: "Folder/Page.md",
      source: "palmwiki-home-card-preview-modifier",
      sourcePath: "",
      targetEl
    }
  );
});

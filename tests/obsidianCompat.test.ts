import assert from "node:assert/strict";
import test from "node:test";
import type { Workspace } from "obsidian";
import { unregisterHoverLinkSourceCompat } from "../src/obsidianCompat";

test("Hover source cleanup preserves its workspace receiver and fails safely", () => {
  let removedId = "";
  let receiverMatches = false;
  const workspace = {
    unregisterHoverLinkSource(this: unknown, sourceId: string) {
      receiverMatches = this === workspace;
      removedId = sourceId;
    }
  } as unknown as Workspace;

  assert.equal(
    unregisterHoverLinkSourceCompat(workspace, "palmwiki-home-card-preview"),
    true
  );
  assert.equal(receiverMatches, true);
  assert.equal(removedId, "palmwiki-home-card-preview");
  assert.equal(unregisterHoverLinkSourceCompat({} as Workspace, "missing"), false);

  const throwingWorkspace = Object.defineProperty({}, "unregisterHoverLinkSource", {
    get: () => {
      throw new Error("unsupported");
    }
  }) as Workspace;
  assert.equal(unregisterHoverLinkSourceCompat(throwingWorkspace, "test"), false);
});

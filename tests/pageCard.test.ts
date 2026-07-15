import assert from "node:assert/strict";
import test from "node:test";
import type { ReactElement } from "react";
import { PageCard } from "../src/ui/PageCard";
import { makePage } from "./helpers";

test("an empty square card body retains an accessible open-page name", () => {
  const card = (
    PageCard as unknown as {
      type: (props: Record<string, unknown>) => ReactElement<{
        children: ReactElement<Record<string, unknown>>[];
      }>;
    }
  ).type({
    cardShape: "square",
    onOpenPage: () => {},
    onTogglePinned: () => {},
    page: makePage({ description: "", title: "Empty page" }),
    showFolder: true,
    showTags: true
  });

  const bodyAction = card.props.children[1];
  assert.equal(bodyAction.props["aria-label"], "Open Empty page");
});

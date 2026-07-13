import assert from "node:assert/strict";
import test from "node:test";
import type { View, WorkspaceLeaf } from "obsidian";
import type { PageRecord } from "../src/core/index/PageRecord";
import {
  MarkdownHeaderSearchManager,
  type MarkdownHeaderSearchMountFactory
} from "../src/markdownHeaderSearch";
import {
  PALMWIKI_MARKDOWN_HEADER_CLASS,
  PALMWIKI_MARKDOWN_SEARCH_HOST_CLASS
} from "../src/homeSearch";
import type {
  MarkdownHeaderSearchMount,
  MarkdownHeaderSearchMountOptions
} from "../src/ui/MarkdownHeaderSearch";
import { makePage } from "./helpers";

test("Markdown header search is leaf-owned, lazy, duplicate-safe, and cleaned up", () => {
  const first = makeMarkdownLeaf(new FakeDocument());
  const second = makeMarkdownLeaf(new FakeDocument());
  const pages = [makePage({ path: "First.md", title: "First" })];
  const focusedLeaves: WorkspaceLeaf[] = [];
  const opened: Array<{ leaf: WorkspaceLeaf; path: string }> = [];
  const submitted: Array<{ leaf: WorkspaceLeaf; query: string }> = [];
  const mounts: FakeMount[] = [];
  const mountSearch: MarkdownHeaderSearchMountFactory = (host, options) => {
    const mount = new FakeMount(host, options);
    mounts.push(mount);
    return mount;
  };
  const manager = new MarkdownHeaderSearchManager({
    getPages: () => pages,
    getRecentPaths: () => ["Recent.md"],
    mountSearch,
    onFocus: (leaf) => focusedLeaves.push(leaf),
    onOpenSuggestion: (leaf, path) => opened.push({ leaf, path }),
    onSubmit: (leaf, query) => submitted.push({ leaf, query })
  });

  manager.syncLeaves([first.leaf, second.leaf]);
  manager.syncLeaves([first.leaf, second.leaf]);

  assert.equal(mounts.length, 2);
  assert.equal(
    first.container.findByClass(PALMWIKI_MARKDOWN_SEARCH_HOST_CLASS).length,
    1
  );
  assert.equal(
    second.container.findByClass(PALMWIKI_MARKDOWN_SEARCH_HOST_CLASS).length,
    1
  );
  assert.equal(first.container.classes.has(PALMWIKI_MARKDOWN_HEADER_CLASS), true);
  assert.equal(second.container.classes.has(PALMWIKI_MARKDOWN_HEADER_CLASS), true);
  assert.equal(focusedLeaves.length, 0, "mounting must not start index work");
  assert.equal(mounts[0].host.ownerDocument, first.document);
  assert.equal(mounts[1].host.ownerDocument, second.document);

  mounts[0].options.onFocus();
  mounts[0].options.onOpenSuggestion("Candidate.md");
  mounts[1].options.onSubmit("airway guideline");
  assert.deepEqual(focusedLeaves, [first.leaf]);
  assert.deepEqual(opened, [{ leaf: first.leaf, path: "Candidate.md" }]);
  assert.deepEqual(submitted, [
    { leaf: second.leaf, query: "airway guideline" }
  ]);

  assert.equal(manager.focusLeaf(second.leaf), true);
  assert.equal(mounts[1].focusCalls, 1);

  const updatedPages = [makePage({ path: "Updated.md", title: "Updated" })];
  manager.updatePages(updatedPages);
  assert.equal(mounts[0].pages, updatedPages);
  assert.equal(mounts[1].pages, updatedPages);

  first.container.isConnected = false;
  manager.syncLeaves([first.leaf, second.leaf]);
  assert.equal(mounts[0].unmountCalls, 1);
  assert.equal(first.container.classes.has(PALMWIKI_MARKDOWN_HEADER_CLASS), false);
  assert.equal(
    first.container.findByClass(PALMWIKI_MARKDOWN_SEARCH_HOST_CLASS).length,
    0
  );

  manager.removeAll();
  assert.equal(mounts[1].unmountCalls, 1);
  assert.equal(second.container.classes.has(PALMWIKI_MARKDOWN_HEADER_CLASS), false);
});

test("Markdown header search keeps the native title when no safe host can mount", () => {
  const withoutTitle = makeMarkdownLeaf(new FakeDocument(), false);
  const throwing = makeMarkdownLeaf(new FakeDocument());
  const manager = new MarkdownHeaderSearchManager({
    getPages: () => [],
    getRecentPaths: () => [],
    mountSearch: (_host, _options) => {
      throw new Error("mount failed");
    },
    onFocus: () => undefined,
    onOpenSuggestion: () => undefined,
    onSubmit: () => undefined
  });

  manager.ensureLeaf(withoutTitle.leaf);
  assert.equal(
    withoutTitle.container.classes.has(PALMWIKI_MARKDOWN_HEADER_CLASS),
    false
  );

  const originalConsoleError = console.error;
  console.error = () => undefined;
  try {
    manager.ensureLeaf(throwing.leaf);
  } finally {
    console.error = originalConsoleError;
  }
  assert.equal(throwing.container.classes.has(PALMWIKI_MARKDOWN_HEADER_CLASS), false);
  assert.equal(
    throwing.container.findByClass(PALMWIKI_MARKDOWN_SEARCH_HOST_CLASS).length,
    0
  );
});

test("Markdown header search excludes actual hover and non-Markdown views", () => {
  const hover = makeMarkdownLeaf(new FakeDocument());
  const hoverParent = hover.document.createElement("div");
  hoverParent.classList.add("hover-popover");
  hoverParent.appendChild(hover.container);
  const canvas = makeMarkdownLeaf(new FakeDocument());
  canvas.stateType = "canvas";
  const mounts: FakeMount[] = [];
  const manager = new MarkdownHeaderSearchManager({
    getPages: () => [],
    getRecentPaths: () => [],
    mountSearch: (host, options) => {
      const mount = new FakeMount(host, options);
      mounts.push(mount);
      return mount;
    },
    onFocus: () => undefined,
    onOpenSuggestion: () => undefined,
    onSubmit: () => undefined
  });

  manager.syncLeaves([hover.leaf, canvas.leaf]);
  assert.equal(mounts.length, 0);
  assert.equal(manager.focusLeaf(canvas.leaf), false);
});

class FakeMount implements MarkdownHeaderSearchMount {
  focusCalls = 0;
  pages: readonly PageRecord[];
  unmountCalls = 0;

  constructor(
    readonly host: HTMLElement,
    readonly options: MarkdownHeaderSearchMountOptions
  ) {
    this.pages = options.pages;
  }

  focus(): void {
    this.focusCalls += 1;
  }

  unmount(): void {
    this.unmountCalls += 1;
  }

  updatePages(pages: readonly PageRecord[]): void {
    this.pages = pages;
  }
}

function makeMarkdownLeaf(
  document: FakeDocument,
  withTitle = true
): {
  container: FakeElement;
  document: FakeDocument;
  leaf: WorkspaceLeaf;
  stateType: string;
} {
  const result = {
    container: document.createElement("div"),
    document,
    leaf: null as unknown as WorkspaceLeaf,
    stateType: "markdown"
  };
  result.container.classList.add("workspace-leaf-content");
  if (withTitle) {
    const title = document.createElement("div");
    title.classList.add("view-header-title-container");
    result.container.appendChild(title);
  }
  const view = {
    containerEl: result.container as unknown as HTMLElement,
    getViewType: () => result.stateType
  } as unknown as View;
  result.leaf = {
    getViewState: () => ({ type: result.stateType }),
    view
  } as unknown as WorkspaceLeaf;
  return result;
}

class FakeDocument {
  defaultView: {
    createDiv: (options: { cls: string }) => FakeElement;
  };

  constructor() {
    this.defaultView = {
      createDiv: ({ cls }) => {
        const element = this.createElement("div");
        element.classList.add(...cls.split(/\s+/).filter(Boolean));
        return element;
      }
    };
  }

  createElement(_tagName: string): FakeElement {
    return new FakeElement(this);
  }
}

class FakeElement {
  children: FakeElement[] = [];
  classes = new Set<string>();
  classList = {
    add: (...classNames: string[]) => {
      for (const className of classNames) {
        this.classes.add(className);
      }
    },
    remove: (...classNames: string[]) => {
      for (const className of classNames) {
        this.classes.delete(className);
      }
    }
  };
  isConnected = true;
  parentElement: FakeElement | null = null;

  constructor(readonly ownerDocument: FakeDocument) {}

  appendChild(child: FakeElement): void {
    child.removeFromParent();
    child.parentElement = this;
    child.isConnected = this.isConnected;
    this.children.push(child);
  }

  closest(_selector: string): FakeElement | null {
    if (
      this.classes.has("hover-popover") ||
      this.classes.has("popover") ||
      this.classes.has("hover-editor")
    ) {
      return this;
    }
    return this.parentElement?.closest(_selector) ?? null;
  }

  contains(element: FakeElement): boolean {
    return element === this || this.children.some((child) => child.contains(element));
  }

  findByClass(className: string): FakeElement[] {
    const found: FakeElement[] = [];
    for (const child of this.children) {
      if (child.classes.has(className)) {
        found.push(child);
      }
      found.push(...child.findByClass(className));
    }
    return found;
  }

  querySelector<T>(selector: string): T | null {
    const className = selector.startsWith(".") ? selector.slice(1) : selector;
    return (this.findByClass(className)[0] as T | undefined) ?? null;
  }

  querySelectorAll<T>(selector: string): T[] {
    const className = selector.startsWith(".") ? selector.slice(1) : selector;
    return this.findByClass(className) as T[];
  }

  remove(): void {
    this.removeFromParent();
    this.isConnected = false;
  }

  private removeFromParent(): void {
    if (!this.parentElement) {
      return;
    }
    const index = this.parentElement.children.indexOf(this);
    if (index >= 0) {
      this.parentElement.children.splice(index, 1);
    }
    this.parentElement = null;
  }
}

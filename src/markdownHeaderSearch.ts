import type { View, WorkspaceLeaf } from "obsidian";
import type { PageRecord } from "./core/index/PageRecord";
import {
  createMarkdownHeaderSearchHost,
  PALMWIKI_MARKDOWN_HEADER_CLASS,
  PALMWIKI_MARKDOWN_SEARCH_HOST_CLASS
} from "./homeSearch";
import { shouldIgnorePalmWikiHeaderLeaf } from "./homeNavigation";
import type {
  MarkdownHeaderSearchMount,
  MarkdownHeaderSearchMountOptions
} from "./ui/MarkdownHeaderSearch";

export type MarkdownHeaderSearchMountFactory = (
  host: HTMLElement,
  options: MarkdownHeaderSearchMountOptions
) => MarkdownHeaderSearchMount;

interface MarkdownHeaderSearchManagerOptions {
  getPages: () => readonly PageRecord[];
  getRecentPaths: () => string[];
  mountSearch: MarkdownHeaderSearchMountFactory;
  onFocus: (leaf: WorkspaceLeaf) => void;
  onOpenSuggestion: (leaf: WorkspaceLeaf, path: string) => void;
  onSubmit: (leaf: WorkspaceLeaf, query: string) => void;
}

interface ManagedMarkdownHeaderSearch {
  host: HTMLElement;
  mount: MarkdownHeaderSearchMount;
  ownerDocument: Document;
  view: View;
}

export class MarkdownHeaderSearchManager {
  private managed = new Map<WorkspaceLeaf, ManagedMarkdownHeaderSearch>();
  private pages: readonly PageRecord[];

  constructor(private options: MarkdownHeaderSearchManagerOptions) {
    this.pages = options.getPages();
  }

  syncLeaves(leaves: readonly WorkspaceLeaf[]): void {
    const expectedLeaves = new Set(leaves);
    for (const leaf of Array.from(this.managed.keys())) {
      if (!expectedLeaves.has(leaf)) {
        this.removeLeaf(leaf);
      }
    }

    for (const leaf of leaves) {
      this.ensureLeaf(leaf);
    }
  }

  ensureLeaf(leaf: WorkspaceLeaf): void {
    if (!isMarkdownLeaf(leaf) || shouldIgnorePalmWikiHeaderLeaf(leaf)) {
      this.removeLeaf(leaf);
      this.cleanContainer(leaf.view.containerEl);
      return;
    }

    const view = leaf.view;
    const container = view.containerEl;
    const ownerDocument = container.ownerDocument;
    if (!container.isConnected || !ownerDocument.defaultView) {
      this.removeLeaf(leaf);
      this.cleanContainer(container);
      return;
    }

    const existing = this.managed.get(leaf);
    if (
      existing?.view === view &&
      existing.ownerDocument === ownerDocument &&
      existing.host.isConnected &&
      existing.host.parentElement !== null &&
      container.contains(existing.host)
    ) {
      existing.mount.updatePages(this.pages);
      return;
    }

    this.removeLeaf(leaf);
    this.cleanContainer(container);
    const host = createMarkdownHeaderSearchHost(container);
    if (!host) {
      return;
    }

    try {
      const mount = this.options.mountSearch(host, {
        getRecentPaths: this.options.getRecentPaths,
        onFocus: () => this.options.onFocus(leaf),
        onOpenSuggestion: (path) => this.options.onOpenSuggestion(leaf, path),
        onSubmit: (query) => this.options.onSubmit(leaf, query),
        pages: this.pages
      });
      this.managed.set(leaf, {
        host,
        mount,
        ownerDocument,
        view
      });
      container.classList.add(PALMWIKI_MARKDOWN_HEADER_CLASS);
    } catch (error) {
      host.remove();
      container.classList.remove(PALMWIKI_MARKDOWN_HEADER_CLASS);
      console.error("Could not attach PalmWiki Home search to a Markdown header", error);
    }
  }

  focusLeaf(leaf: WorkspaceLeaf): boolean {
    this.ensureLeaf(leaf);
    const current = this.managed.get(leaf);
    if (!current || current.view !== leaf.view || !isMarkdownLeaf(leaf)) {
      return false;
    }
    current.mount.focus();
    return true;
  }

  updatePages(pages: readonly PageRecord[]): void {
    if (this.pages === pages) {
      return;
    }
    this.pages = pages;
    for (const current of this.managed.values()) {
      current.mount.updatePages(pages);
    }
  }

  removeLeaf(leaf: WorkspaceLeaf): void {
    const current = this.managed.get(leaf);
    if (!current) {
      return;
    }

    try {
      current.mount.unmount();
    } catch (error) {
      console.error("Could not unmount PalmWiki Home Markdown search", error);
    } finally {
      current.host.remove();
      current.view.containerEl.classList.remove(PALMWIKI_MARKDOWN_HEADER_CLASS);
      this.managed.delete(leaf);
    }
  }

  removeAll(): void {
    for (const leaf of Array.from(this.managed.keys())) {
      this.removeLeaf(leaf);
    }
  }

  private cleanContainer(container: HTMLElement): void {
    container.classList.remove(PALMWIKI_MARKDOWN_HEADER_CLASS);
    for (const stray of Array.from(
      container.querySelectorAll<HTMLElement>(
        `.${PALMWIKI_MARKDOWN_SEARCH_HOST_CLASS}`
      )
    )) {
      stray.remove();
    }
  }
}

export function isMarkdownLeaf(leaf: WorkspaceLeaf): boolean {
  try {
    return leaf.getViewState().type === "markdown";
  } catch {
    return leaf.view.getViewType() === "markdown";
  }
}

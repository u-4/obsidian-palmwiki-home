import React, { useCallback, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PageRecord } from "../core/index/PageRecord";
import { HomeSearchBar } from "./HomeSearchBar";

export interface MarkdownHeaderSearchMountOptions {
  getRecentPaths: () => string[];
  onFocus: () => void;
  onOpenSuggestion: (path: string) => void;
  onSubmit: (query: string) => void;
  pages: readonly PageRecord[];
}

export interface MarkdownHeaderSearchMount {
  focus: () => void;
  unmount: () => void;
  updatePages: (pages: readonly PageRecord[]) => void;
}

interface MarkdownHeaderSearchRootProps extends MarkdownHeaderSearchMountOptions {
  onRegisterInput: (input: HTMLInputElement | null) => void;
}

export function mountMarkdownHeaderSearch(
  host: HTMLElement,
  options: MarkdownHeaderSearchMountOptions
): MarkdownHeaderSearchMount {
  return new ReactMarkdownHeaderSearchMount(host, options);
}

function MarkdownHeaderSearchRoot({
  getRecentPaths,
  onFocus,
  onOpenSuggestion,
  onRegisterInput,
  onSubmit,
  pages
}: MarkdownHeaderSearchRootProps): React.JSX.Element {
  const [query, setQuery] = useState("");

  const clearSearch = useCallback(() => setQuery(""), []);
  const openSuggestion = useCallback(
    (path: string) => {
      setQuery("");
      onOpenSuggestion(path);
    },
    [onOpenSuggestion]
  );

  return (
    <HomeSearchBar
      ariaLabel="Search PalmWiki Home from this note"
      clearAriaLabel="Clear note header search"
      getRecentPaths={getRecentPaths}
      onClear={clearSearch}
      onFocus={onFocus}
      onOpenSuggestion={openSuggestion}
      onQueryChange={setQuery}
      onRegisterInput={onRegisterInput}
      onSubmit={onSubmit}
      pages={pages}
      query={query}
    />
  );
}

class ReactMarkdownHeaderSearchMount implements MarkdownHeaderSearchMount {
  private input: HTMLInputElement | null = null;
  private focusPending = false;
  private pages: readonly PageRecord[];
  private root: Root;
  private unmounted = false;

  constructor(
    host: HTMLElement,
    private options: MarkdownHeaderSearchMountOptions
  ) {
    this.pages = options.pages;
    this.root = createRoot(host);
    this.render();
  }

  focus(): void {
    if (this.unmounted) {
      return;
    }
    if (this.input) {
      this.input.focus();
      return;
    }
    this.focusPending = true;
  }

  updatePages(pages: readonly PageRecord[]): void {
    if (this.unmounted || this.pages === pages) {
      return;
    }
    this.pages = pages;
    this.render();
  }

  unmount(): void {
    if (this.unmounted) {
      return;
    }
    this.unmounted = true;
    this.focusPending = false;
    this.input = null;
    this.root.unmount();
  }

  private render(): void {
    this.root.render(
      <MarkdownHeaderSearchRoot
        getRecentPaths={this.options.getRecentPaths}
        onFocus={this.options.onFocus}
        onOpenSuggestion={this.options.onOpenSuggestion}
        onRegisterInput={(input) => {
          this.input = input;
          if (input && this.focusPending && !this.unmounted) {
            this.focusPending = false;
            input.focus();
          }
        }}
        onSubmit={this.options.onSubmit}
        pages={this.pages}
      />
    );
  }
}

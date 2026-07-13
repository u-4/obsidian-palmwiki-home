import type { PageRecord } from "./core/index/PageRecord";
import { limitFullTextQueryEditorInput } from "./core/search/fullTextSearch";
import { normalizePageNameText } from "./core/search/titleSuggestions";
import type { SearchIndexState } from "./searchIndex";

export const PALMWIKI_HOME_SEARCH_HOST_CLASS = "palmwiki-home-search-host";
export const PALMWIKI_MARKDOWN_SEARCH_HOST_CLASS =
  "palmwiki-markdown-search-host";
export const PALMWIKI_MARKDOWN_HEADER_CLASS = "palmwiki-markdown-header";

export interface SearchPageCreationContext {
  stateKey: string;
  view: unknown;
}

type SearchIndexAvailability = Pick<SearchIndexState, "phase" | "indexedCount">;

export function canUseFullTextSearchIndex(
  state: SearchIndexAvailability
): boolean {
  return (
    state.phase === "ready" ||
    (state.phase === "error" && state.indexedCount > 0)
  );
}

export function shouldClearFullTextSearchResults(
  state: SearchIndexAvailability
): boolean {
  return state.phase === "error" && state.indexedCount === 0;
}

export function captureSearchPageCreationContext(
  view: unknown,
  state: unknown
): SearchPageCreationContext | null {
  const stateKey = serializeSearchPageCreationState(state);
  return stateKey === null ? null : { stateKey, view };
}

export function isSearchPageCreationContextCurrent(
  context: SearchPageCreationContext,
  view: unknown,
  state: unknown
): boolean {
  return context.view === view && context.stateKey === serializeSearchPageCreationState(state);
}

export function createPalmWikiHomeSearchHost(
  viewContainer: HTMLElement
): HTMLElement | null {
  if (isPopoverContext(viewContainer)) {
    return null;
  }

  const titleContainer = viewContainer.querySelector<HTMLElement>(
    ".view-header-title-container"
  );
  const ownerDocument = viewContainer.ownerDocument;
  const ownerWindow = ownerDocument.defaultView;
  if (!titleContainer || !ownerWindow) {
    return null;
  }

  for (const stray of Array.from(
    viewContainer.querySelectorAll<HTMLElement>(`.${PALMWIKI_HOME_SEARCH_HOST_CLASS}`)
  )) {
    stray.remove();
  }

  const host = ownerWindow.createDiv({ cls: PALMWIKI_HOME_SEARCH_HOST_CLASS });
  titleContainer.appendChild(host);
  return host;
}

export function createMarkdownHeaderSearchHost(
  viewContainer: HTMLElement
): HTMLElement | null {
  if (isPopoverContext(viewContainer)) {
    return null;
  }

  const titleContainer = viewContainer.querySelector<HTMLElement>(
    ".view-header-title-container"
  );
  const ownerWindow = viewContainer.ownerDocument.defaultView;
  if (!titleContainer || !ownerWindow) {
    return null;
  }

  for (const stray of Array.from(
    viewContainer.querySelectorAll<HTMLElement>(
      `.${PALMWIKI_MARKDOWN_SEARCH_HOST_CLASS}`
    )
  )) {
    stray.remove();
  }

  const host = ownerWindow.createDiv({
    cls: `${PALMWIKI_HOME_SEARCH_HOST_CLASS} ${PALMWIKI_MARKDOWN_SEARCH_HOST_CLASS}`
  });
  titleContainer.appendChild(host);
  return host;
}

export function createPalmWikiHomeSearchState(
  query: string
): { searchQuery: string; submittedSearchQuery: string } {
  const normalizedQuery = limitFullTextQueryEditorInput(query.trim());
  return {
    searchQuery: normalizedQuery,
    submittedSearchQuery: normalizedQuery
  };
}

export function hasExactPageName(
  pages: readonly PageRecord[],
  candidateName: string
): boolean {
  return findExactPageByName(pages, candidateName) !== null;
}

export function findExactPageByName(
  pages: readonly PageRecord[],
  candidateName: string
): PageRecord | null {
  const expected = normalizePageNameText(candidateName).trim();
  if (!expected) {
    return null;
  }

  return pages.find((page) =>
    [page.title, page.basename, ...page.aliases].some(
      (candidate) => normalizePageNameText(candidate).trim() === expected
    )
  ) ?? null;
}

export function validateNewPageName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) {
    return "Enter a page name.";
  }
  if (trimmed === "." || trimmed === "..") {
    return "Choose a different page name.";
  }
  if (hasUnsafeFilenameCharacter(trimmed)) {
    return "The page name contains a character that is not safe in a file name.";
  }
  if (/[. ]$/.test(trimmed)) {
    return "The page name cannot end with a period or space.";
  }
  const windowsStem = trimmed.split(".", 1)[0].trim();
  if (/^(?:con|prn|aux|nul|clock\$|com[1-9]|lpt[1-9])$/i.test(windowsStem)) {
    return "The page name is reserved by Windows.";
  }

  const filenameBytes = new TextEncoder().encode(`${trimmed}.md`).byteLength;
  if (filenameBytes > 240) {
    return "The page name is too long.";
  }
  return null;
}

function hasUnsafeFilenameCharacter(value: string): boolean {
  const unsafePrintable = new Set(["\\", "/", ":", "*", "?", '"', "<", ">", "|"]);
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (unsafePrintable.has(character) || codePoint <= 0x1f || codePoint === 0x7f) {
      return true;
    }
  }
  return false;
}

function isPopoverContext(container: HTMLElement): boolean {
  return Boolean(
    container.closest(".hover-popover, .popover, .hover-editor")
  );
}

function serializeSearchPageCreationState(state: unknown): string | null {
  try {
    return JSON.stringify(state) ?? null;
  } catch {
    return null;
  }
}

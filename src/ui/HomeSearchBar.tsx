import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import type { PageRecord } from "../core/index/PageRecord";
import {
  getFullTextQueryValidationError,
  limitFullTextQueryEditorInput,
  MAX_FULL_TEXT_QUERY_EDITOR_LENGTH,
  MAX_FULL_TEXT_QUERY_LENGTH,
  MAX_FULL_TEXT_QUERY_TERMS
} from "../core/search/fullTextSearch";
import {
  getTitleSuggestions,
  type TitleSuggestion
} from "../core/search/titleSuggestions";

interface HomeSearchBarProps {
  getRecentPaths: () => string[];
  onClear: () => void;
  onOpenSuggestion: (path: string) => void;
  onQueryChange: (query: string) => void;
  onRegisterInput: (input: HTMLInputElement | null) => void;
  onSubmit: (query: string) => void;
  pages: readonly PageRecord[];
  query: string;
}

const TITLE_SUGGESTION_DELAY_MS = 100;

export function HomeSearchBar({
  getRecentPaths,
  onClear,
  onOpenSuggestion,
  onQueryChange,
  onRegisterInput,
  onSubmit,
  pages,
  query
}: HomeSearchBarProps): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [recentPaths, setRecentPaths] = useState<string[]>([]);
  const [suggestionQuery, setSuggestionQuery] = useState(query);
  const listboxId = useId();

  useEffect(() => {
    onRegisterInput(inputRef.current);
    return () => onRegisterInput(null);
  }, [onRegisterInput]);

  useEffect(() => {
    const ownerWindow = inputRef.current?.ownerDocument.defaultView;
    if (!ownerWindow) {
      setSuggestionQuery(query);
      return;
    }

    const timeout = ownerWindow.setTimeout(() => {
      setSuggestionQuery(query);
    }, query.trim() ? TITLE_SUGGESTION_DELAY_MS : 0);
    return () => ownerWindow.clearTimeout(timeout);
  }, [query]);

  useEffect(() => {
    const ownerDocument = wrapperRef.current?.ownerDocument;
    const ownerWindow = ownerDocument?.defaultView;
    if (!ownerDocument || !ownerWindow) {
      return;
    }

    const closeOnOutsidePointer = (event: PointerEvent): void => {
      if (
        event.target instanceof ownerWindow.Node &&
        !wrapperRef.current?.contains(event.target)
      ) {
        setIsOpen(false);
        setSelectedIndex(-1);
      }
    };
    ownerDocument.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => ownerDocument.removeEventListener("pointerdown", closeOnOutsidePointer);
  });

  const suggestions = useMemo(
    () =>
      suggestionQuery === query && !getFullTextQueryValidationError(query)
        ? getTitleSuggestions(pages, recentPaths, suggestionQuery)
        : [],
    [pages, query, recentPaths, suggestionQuery]
  );

  useEffect(() => {
    setSelectedIndex(-1);
  }, [query, suggestionQuery]);

  const openSuggestion = (suggestion: TitleSuggestion): void => {
    setIsOpen(false);
    setSelectedIndex(-1);
    onOpenSuggestion(suggestion.path);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.nativeEvent.isComposing) {
      return;
    }

    if (event.key === "ArrowDown") {
      if (suggestions.length === 0) {
        return;
      }
      event.preventDefault();
      setIsOpen(true);
      setSelectedIndex((current) => Math.min(suggestions.length - 1, current + 1));
      return;
    }

    if (event.key === "ArrowUp") {
      if (suggestions.length === 0) {
        return;
      }
      event.preventDefault();
      setIsOpen(true);
      setSelectedIndex((current) => Math.max(-1, current - 1));
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      const selected = selectedIndex >= 0 ? suggestions[selectedIndex] : undefined;
      if (selected) {
        openSuggestion(selected);
      } else if (query.trim()) {
        setIsOpen(false);
        onSubmit(query);
      }
      return;
    }

    if (event.key === "Escape") {
      if (isOpen) {
        event.preventDefault();
        setIsOpen(false);
        setSelectedIndex(-1);
      } else {
        inputRef.current?.blur();
      }
    }
  };

  return (
    <div className="palmwiki-home-search" ref={wrapperRef}>
      <input
        aria-activedescendant={
          selectedIndex >= 0 ? `${listboxId}-${selectedIndex}` : undefined
        }
        aria-autocomplete="list"
        aria-controls={isOpen ? listboxId : undefined}
        aria-expanded={isOpen}
        aria-label="Search PalmWiki Home"
        className="palmwiki-home-search-input"
        maxLength={MAX_FULL_TEXT_QUERY_EDITOR_LENGTH}
        onChange={(event) => {
          onQueryChange(limitFullTextQueryEditorInput(event.currentTarget.value));
          setIsOpen(true);
        }}
        onFocus={() => {
          setRecentPaths(getRecentPaths());
          setIsOpen(true);
        }}
        onKeyDown={handleKeyDown}
        placeholder="Search pages…"
        ref={inputRef}
        role="combobox"
        spellCheck={false}
        title={`Search up to ${MAX_FULL_TEXT_QUERY_LENGTH} characters and ${MAX_FULL_TEXT_QUERY_TERMS} terms`}
        type="search"
        value={query}
      />
      {query ? (
        <button
          aria-label="Clear PalmWiki Home search"
          className="palmwiki-home-search-clear"
          onClick={() => {
            onClear();
            setIsOpen(true);
            inputRef.current?.focus();
          }}
          title="Clear search"
          type="button"
        >
          ×
        </button>
      ) : null}
      {isOpen ? (
        <div
          aria-label={query.trim() ? "Page title suggestions" : "Recently opened pages"}
          className="palmwiki-home-search-suggestions"
          id={listboxId}
          role="listbox"
        >
          <div className="palmwiki-home-search-suggestions-heading">
            {query.trim() ? "Page suggestions" : "Recently opened"}
          </div>
          {suggestions.length === 0 ? (
            <div className="palmwiki-home-search-empty">
              {query.trim() ? "No similar page names" : "No recent pages"}
            </div>
          ) : (
            suggestions.map((suggestion, index) => (
              <button
                aria-selected={selectedIndex === index}
                className={
                  selectedIndex === index
                    ? "palmwiki-home-search-option is-selected"
                    : "palmwiki-home-search-option"
                }
                id={`${listboxId}-${index}`}
                key={suggestion.path}
                onClick={() => openSuggestion(suggestion)}
                onPointerEnter={() => setSelectedIndex(index)}
                role="option"
                type="button"
              >
                <span>{suggestion.title}</span>
                <span>
                  {suggestion.aliasMatch
                    ? `Alias: ${suggestion.aliasMatch} · ${suggestion.path}`
                    : suggestion.path}
                </span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

import type { App, TFile, View, WorkspaceLeaf } from "obsidian";

export const PALMWIKI_HOME_NAME = "PalmWiki Home";
export const PALMWIKI_HOME_BUTTON_CLASS = "palmwiki-vault-home-button";
export const PALMWIKI_MARKDOWN_PATH_CLASS = "palmwiki-markdown-note-path";

export const HOME_BUTTON_SETTING_DESCRIPTION =
  "The button always opens PalmWiki Home in the current tab. In Home search results it returns to the normal Home screen; on the normal Home screen it scrolls to the top.";

interface ManagedHomeButton {
  button: HTMLButtonElement;
  host: HTMLElement;
  kind: "home" | "markdown";
  leaf: WorkspaceLeaf;
  listener: EventListener;
  path: HTMLElement | null;
  view: View;
}

interface HeaderPlacement {
  before: ChildNode | null;
  host: HTMLElement;
}

interface HomeNavigationManagerOptions {
  getDisplayName: () => string;
  getMarkdownPath: (leaf: WorkspaceLeaf) => string;
  isHomeSearchActive: (leaf: WorkspaceLeaf) => boolean;
  onHomeActivate: (leaf: WorkspaceLeaf) => void;
  onMarkdownActivate: (leaf: WorkspaceLeaf) => Promise<void>;
  palmWikiHomeViewType: string;
}

export function resolveHomeButtonLabel(configuredLabel: string, vaultName: string): string {
  return configuredLabel.trim() || vaultName.trim() || PALMWIKI_HOME_NAME;
}

export function resolveMarkdownLeafPath(app: App, leaf: WorkspaceLeaf): string {
  const viewFile = (leaf.view as { file?: unknown }).file;
  if (isMarkdownFile(viewFile)) {
    return viewFile.path;
  }

  let stateFile = "";
  try {
    const state = leaf.getViewState().state;
    stateFile =
      state && typeof state === "object" && typeof state.file === "string"
        ? state.file
        : "";
  } catch {
    return "";
  }
  if (!stateFile) {
    return "";
  }

  const resolved = app.vault.getAbstractFileByPath(stateFile);
  return isMarkdownFile(resolved) ? resolved.path : "";
}

export function getMarkdownHomeButtonDescription(displayName: string): string {
  return `${displayName}: Open ${PALMWIKI_HOME_NAME} in this tab`;
}

export function getPalmWikiHomeButtonDescription(
  displayName: string,
  searchActive = false
): string {
  return searchActive
    ? `${displayName}: Return to PalmWiki Home`
    : `${displayName}: Scroll PalmWiki Home to top`;
}

export function findClosestVerticalScrollContainer(
  start: HTMLElement
): HTMLElement | null {
  const ownerWindow = start.ownerDocument.defaultView;
  if (!ownerWindow) {
    return null;
  }

  let current: HTMLElement | null = start;
  let nearestOverflowContainer: HTMLElement | null = null;

  while (current) {
    const style = ownerWindow.getComputedStyle(current);
    if (/(auto|scroll)/.test(`${style.overflowY} ${style.overflow}`)) {
      nearestOverflowContainer ??= current;
      if (current.scrollHeight > current.clientHeight) {
        return current;
      }
    }
    current = current.parentElement;
  }

  return nearestOverflowContainer;
}

export function findPalmWikiHomeScrollContainer(
  viewContainer: HTMLElement
): HTMLElement | null {
  const content = viewContainer.querySelector<HTMLElement>(".palmwiki-home-view");
  if (!content) {
    return null;
  }

  const probe = content.querySelector<HTMLElement>(".palmwiki-home-shell") ?? content;
  return findClosestVerticalScrollContainer(probe) ?? content;
}

export function shouldCompletePalmWikiScrollRestore(
  expectedScrollTop: number,
  actualScrollTop: number,
  maximumScrollTop: number,
  contentReady: boolean
): boolean {
  const expected = Math.max(0, expectedScrollTop);
  const actual = Math.max(0, actualScrollTop);
  const maximum = Math.max(0, maximumScrollTop);
  const target = Math.min(expected, maximum);

  if (Math.abs(actual - target) > 1) {
    return false;
  }
  return expected <= maximum + 1 || contentReady;
}

export function resolvePalmWikiHomeEphemeralScrollTop(
  pendingScrollTop: number | null,
  currentScrollTop: number | undefined
): number {
  return pendingScrollTop ?? currentScrollTop ?? 0;
}

export function isPalmWikiHomeRenderRevisionCurrent(
  renderedRevision: number,
  currentRevision: number
): boolean {
  return renderedRevision === currentRevision;
}

export function scrollPalmWikiHomeToTop(viewContainer: HTMLElement): boolean {
  const scrollContainer = findPalmWikiHomeScrollContainer(viewContainer);
  if (!scrollContainer) {
    return false;
  }

  const ownerWindow = scrollContainer.ownerDocument.defaultView;
  let reduceMotion = false;
  try {
    reduceMotion =
      ownerWindow?.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  } catch {
    reduceMotion = false;
  }

  if (reduceMotion) {
    scrollContainer.scrollTop = 0;
  } else if (typeof scrollContainer.scrollTo === "function") {
    scrollContainer.scrollTo({
      behavior: "smooth",
      top: 0
    });
  } else {
    scrollContainer.scrollTop = 0;
  }
  return true;
}

export class HomeNavigationManager {
  private buttons = new Map<WorkspaceLeaf, ManagedHomeButton>();

  constructor(private options: HomeNavigationManagerOptions) {}

  syncLeaves(leaves: readonly WorkspaceLeaf[]): void {
    const expectedLeaves = new Set(leaves);
    for (const leaf of Array.from(this.buttons.keys())) {
      if (!expectedLeaves.has(leaf)) {
        this.removeLeaf(leaf);
      }
    }

    for (const leaf of leaves) {
      this.ensureLeaf(leaf);
    }
  }

  ensureLeaf(leaf: WorkspaceLeaf): void {
    const kind = this.getManagedKind(leaf);
    if (!kind || shouldIgnorePalmWikiHeaderLeaf(leaf)) {
      this.removeLeaf(leaf);
      return;
    }

    const view = leaf.view;
    if (!view.containerEl.isConnected) {
      this.removeLeaf(leaf);
      return;
    }
    const ownerWindow = view.containerEl.ownerDocument.defaultView;
    if (!ownerWindow) {
      this.removeLeaf(leaf);
      return;
    }
    const placement = findHeaderPlacement(view.containerEl);
    if (!placement) {
      this.removeLeaf(leaf);
      return;
    }

    const existing = this.buttons.get(leaf);
    if (
      existing?.view === view &&
      existing.kind === kind &&
      existing.host === placement.host &&
      existing.button.parentElement === placement.host &&
      (kind === "home" || existing.path?.parentElement === placement.host)
    ) {
      placement.host.insertBefore(existing.button, placement.before);
      if (existing.path) {
        placement.host.insertBefore(existing.path, placement.before);
      }
      this.updateButton(existing);
      return;
    }

    this.removeLeaf(leaf);
    for (const strayButton of Array.from(
      view.containerEl.querySelectorAll<HTMLElement>(`.${PALMWIKI_HOME_BUTTON_CLASS}`)
    )) {
      strayButton.remove();
    }
    for (const strayPath of Array.from(
      view.containerEl.querySelectorAll<HTMLElement>(`.${PALMWIKI_MARKDOWN_PATH_CLASS}`)
    )) {
      strayPath.remove();
    }

    const button = ownerWindow.createEl("button");
    button.type = "button";
    button.classList.add(PALMWIKI_HOME_BUTTON_CLASS);
    const listener: EventListener = (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (kind === "home") {
        this.options.onHomeActivate(leaf);
      } else {
        void this.options.onMarkdownActivate(leaf);
      }
    };
    button.addEventListener("click", listener);
    const path = kind === "markdown" ? ownerWindow.createSpan() : null;
    path?.classList.add(PALMWIKI_MARKDOWN_PATH_CLASS);

    const managed: ManagedHomeButton = {
      button,
      host: placement.host,
      kind,
      leaf,
      listener,
      path,
      view
    };
    this.buttons.set(leaf, managed);
    placement.host.insertBefore(button, placement.before);
    if (path) {
      placement.host.insertBefore(path, placement.before);
    }
    this.updateButton(managed);
  }

  updateLabels(): void {
    for (const managed of this.buttons.values()) {
      this.updateButton(managed);
    }
  }

  removeLeaf(leaf: WorkspaceLeaf): void {
    const managed = this.buttons.get(leaf);
    if (!managed) {
      return;
    }

    managed.button.removeEventListener("click", managed.listener);
    managed.button.remove();
    managed.path?.remove();
    this.buttons.delete(leaf);
  }

  removeAll(): void {
    for (const leaf of Array.from(this.buttons.keys())) {
      this.removeLeaf(leaf);
    }
  }

  private getManagedKind(leaf: WorkspaceLeaf): "home" | "markdown" | null {
    let viewType = "";
    try {
      viewType = leaf.getViewState().type;
    } catch {
      viewType = leaf.view.getViewType();
    }

    if (viewType === "markdown") {
      return "markdown";
    }
    if (viewType === this.options.palmWikiHomeViewType) {
      return "home";
    }
    return null;
  }

  private updateButton(managed: ManagedHomeButton): void {
    const displayName = this.options.getDisplayName();
    const description =
      managed.kind === "home"
        ? getPalmWikiHomeButtonDescription(
            displayName,
            this.options.isHomeSearchActive(managed.leaf)
          )
        : getMarkdownHomeButtonDescription(displayName);

    managed.button.textContent = displayName;
    managed.button.setAttribute("aria-label", description);
    managed.button.setAttribute("title", description);
    if (managed.path) {
      const path = this.options.getMarkdownPath(managed.leaf);
      managed.path.textContent = path;
      managed.path.setAttribute("aria-label", path ? `Note path: ${path}` : "Note path");
      managed.path.setAttribute("title", path);
    }
  }
}

function isMarkdownFile(value: unknown): value is TFile {
  if (!value || typeof value !== "object") {
    return false;
  }
  const file = value as { extension?: unknown; path?: unknown };
  return (
    typeof file.extension === "string" &&
    file.extension.toLocaleLowerCase() === "md" &&
    typeof file.path === "string" &&
    file.path.toLocaleLowerCase().endsWith(".md")
  );
}

function findHeaderPlacement(containerEl: HTMLElement): HeaderPlacement | null {
  const headerLeft = containerEl.querySelector<HTMLElement>(".view-header-left");
  const titleContainer = containerEl.querySelector<HTMLElement>(
    ".view-header-title-container"
  );
  if (
    headerLeft &&
    titleContainer?.parentElement &&
    headerLeft.contains(titleContainer)
  ) {
    return { host: titleContainer.parentElement, before: titleContainer };
  }

  if (headerLeft) {
    return { host: headerLeft, before: null };
  }

  const titleParent = containerEl.querySelector<HTMLElement>(".view-header-title-parent");
  if (titleParent) {
    return { host: titleParent, before: titleParent.firstChild };
  }

  const header = containerEl.querySelector<HTMLElement>(".view-header");
  return header ? { host: header, before: header.firstChild } : null;
}

export function shouldIgnorePalmWikiHeaderLeaf(leaf: WorkspaceLeaf): boolean {
  const containerEl = leaf.view.containerEl;
  const viewType = leaf.view.getViewType();

  if (viewType === "hover-editor" || viewType === "markdown-hover") {
    return true;
  }
  return !!containerEl.closest?.(".hover-popover, .popover, .hover-editor");
}

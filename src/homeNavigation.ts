import type { App, TFile, View, WorkspaceLeaf } from "obsidian";

export const PALMWIKI_HOME_NAME = "PalmWiki Home";
export const PALMWIKI_HOME_BUTTON_CLASS = "palmwiki-vault-home-button";
export const PALMWIKI_MARKDOWN_PATH_CLASS = "palmwiki-markdown-note-path";

export const HOME_BUTTON_ACTION_OPTIONS = {
  palmwikiHome: "Open PalmWiki Home",
  page: "Open a page",
  command: "Run a command"
} as const;

export type HomeButtonAction = keyof typeof HOME_BUTTON_ACTION_OPTIONS;

export const HOME_BUTTON_SETTING_DESCRIPTION =
  "Choose what happens when you click the Home button in a Markdown note. In PalmWiki Home itself, the button always scrolls to the top.";
export const HOME_PAGE_SETTING_DESCRIPTION =
  "Enter a note name, Vault-relative path, or [[Wiki link]], or choose an existing Markdown note. It opens in the current tab; a missing note is not created.";
export const HOME_COMMAND_SETTING_DESCRIPTION =
  "Choose an Obsidian command. Choosing it here does not run it. The command runs only when the Home button is clicked, with that Markdown tab active.";

export interface NormalizedHomePageTarget {
  isWikiLink: boolean;
  linkpath: string;
  subpath: string;
}

export interface ResolvedHomePage {
  file: TFile;
  subpath: string;
}

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
  getMarkdownActionDescription: () => string;
  getMarkdownPath: (leaf: WorkspaceLeaf) => string;
  onHomeActivate: (leaf: WorkspaceLeaf) => void;
  onMarkdownActivate: (leaf: WorkspaceLeaf, event: MouseEvent) => Promise<void>;
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

export function isHomeButtonAction(value: unknown): value is HomeButtonAction {
  return value === "palmwikiHome" || value === "page" || value === "command";
}

export function getHomeButtonActionDescription(
  action: HomeButtonAction,
  pageTarget = "",
  commandLabel = ""
): string {
  switch (action) {
    case "page": {
      const configured = pageTarget.trim();
      return configured
        ? `Open ${configured} in this tab`
        : "Open the configured page in this tab";
    }
    case "command":
      return commandLabel.trim()
        ? `Run command: ${commandLabel.trim()}`
        : "Run the configured command";
    case "palmwikiHome":
    default:
      return `Open ${PALMWIKI_HOME_NAME} in this tab`;
  }
}

export function getPalmWikiHomeButtonDescription(displayName: string): string {
  return `${displayName}: Scroll PalmWiki Home to top`;
}

export function normalizeHomePageTarget(configuredTarget: string): NormalizedHomePageTarget {
  const configured = configuredTarget.trim();
  const isWikiLink = configured.startsWith("[[") && configured.endsWith("]]");
  let target = isWikiLink ? configured.slice(2, -2).trim() : configured;

  if (isWikiLink) {
    const aliasIndex = target.indexOf("|");
    if (aliasIndex >= 0) {
      target = target.slice(0, aliasIndex);
    }
  }

  const subpathIndex = target.indexOf("#");
  const subpath = subpathIndex >= 0 ? target.slice(subpathIndex).trim() : "";
  const linkpath = (subpathIndex >= 0 ? target.slice(0, subpathIndex) : target).trim();

  return { isWikiLink, linkpath, subpath };
}

export function resolveExistingHomePage(
  app: App,
  sourcePath: string,
  configuredTarget: string
): ResolvedHomePage | null {
  const configured = configuredTarget.trim();
  if (!configured) {
    return null;
  }

  const isWikiLink = configured.startsWith("[[") && configured.endsWith("]]");
  const exactTarget = isWikiLink ? configured.slice(2, -2).trim() : configured;
  const exactFile = getMarkdownFileByExactPath(app, exactTarget);
  if (exactFile) {
    return { file: exactFile, subpath: "" };
  }

  if (/[#|]/.test(exactTarget)) {
    const literalNamedFile = findMarkdownFileByLiteralName(app, exactTarget);
    if (literalNamedFile) {
      return { file: literalNamedFile, subpath: "" };
    }
  }

  if (!isWikiLink) {
    const literalAlias = findMarkdownFileByAlias(app, exactTarget);
    if (literalAlias) {
      return { file: literalAlias, subpath: "" };
    }
  }

  let targetWithoutAlias = exactTarget;
  if (isWikiLink) {
    const aliasIndex = exactTarget.lastIndexOf("|");
    const headingIndex = exactTarget.indexOf("#");
    if (aliasIndex >= 0 && (headingIndex < 0 || aliasIndex > headingIndex)) {
      targetWithoutAlias = exactTarget.slice(0, aliasIndex).trim();
      const aliasStrippedExactFile = getMarkdownFileByExactPath(
        app,
        targetWithoutAlias
      );
      if (aliasStrippedExactFile) {
        return { file: aliasStrippedExactFile, subpath: "" };
      }
      const aliasStrippedLiteralFile = findMarkdownFileByLiteralName(
        app,
        targetWithoutAlias
      );
      if (aliasStrippedLiteralFile) {
        return { file: aliasStrippedLiteralFile, subpath: "" };
      }
    }
  }

  const headingTarget = resolveHeadingTarget(app, sourcePath, targetWithoutAlias);
  if (headingTarget) {
    return headingTarget;
  }

  const file = resolveHomePageLinkpath(app, sourcePath, targetWithoutAlias);
  if (file) {
    return { file, subpath: "" };
  }

  if (isWikiLink) {
    const standardAliasIndex = exactTarget.indexOf("|");
    if (standardAliasIndex >= 0) {
      const standardTarget = exactTarget.slice(0, standardAliasIndex).trim();
      const standardHeadingTarget = resolveHeadingTarget(
        app,
        sourcePath,
        standardTarget
      );
      if (standardHeadingTarget) {
        return standardHeadingTarget;
      }
      const standardFile = resolveHomePageLinkpath(app, sourcePath, standardTarget);
      if (standardFile) {
        return { file: standardFile, subpath: "" };
      }
    }
  }

  return null;
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
        void this.options.onMarkdownActivate(leaf, event as MouseEvent);
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
        ? getPalmWikiHomeButtonDescription(displayName)
        : `${displayName}: ${this.options.getMarkdownActionDescription()}`;

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

function getMarkdownFileByExactPath(app: App, target: string): TFile | null {
  const normalizedTarget = normalizeVaultRelativePath(target);
  if (!normalizedTarget) {
    return null;
  }

  const candidatePaths = normalizedTarget.toLocaleLowerCase().endsWith(".md")
    ? [normalizedTarget]
    : [normalizedTarget, `${normalizedTarget}.md`];

  for (const path of candidatePaths) {
    const candidate = app.vault.getAbstractFileByPath(path);
    if (isMarkdownFile(candidate)) {
      return candidate;
    }
  }
  return null;
}

function normalizeVaultRelativePath(path: string): string {
  return path
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^\/+/, "")
    .replace(/\/{2,}/g, "/");
}

function resolveLinkpath(app: App, linkpath: string, sourcePath: string): TFile | null {
  try {
    const candidate = app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath);
    return isMarkdownFile(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

function resolveHomePageLinkpath(
  app: App,
  sourcePath: string,
  linkpath: string
): TFile | null {
  if (!linkpath) {
    return getMarkdownFileByExactPath(app, sourcePath);
  }

  return (
    getMarkdownFileByExactPath(app, linkpath) ??
    (/[#|]/.test(linkpath) ? findMarkdownFileByLiteralName(app, linkpath) : null) ??
    resolveLinkpath(app, linkpath, sourcePath) ??
    findMarkdownFileByAlias(app, linkpath)
  );
}

function resolveHeadingTarget(
  app: App,
  sourcePath: string,
  target: string
): ResolvedHomePage | null {
  const headingIndexes: number[] = [];
  for (let index = target.indexOf("#"); index >= 0; ) {
    headingIndexes.push(index);
    index = target.indexOf("#", index + 1);
  }

  for (const headingIndex of headingIndexes.reverse()) {
    const linkpath = target.slice(0, headingIndex).trim();
    let subpath = target.slice(headingIndex).trim();
    const displayAliasIndex = subpath.indexOf("|");
    if (displayAliasIndex >= 0) {
      subpath = subpath.slice(0, displayAliasIndex).trim();
    }
    const file = resolveHomePageLinkpath(app, sourcePath, linkpath);
    if (file) {
      return { file, subpath };
    }
  }

  return null;
}

function findMarkdownFileByLiteralName(app: App, target: string): TFile | null {
  const normalizedTarget = normalizeVaultRelativePath(target);
  if (!normalizedTarget || normalizedTarget.includes("/")) {
    return null;
  }

  const expectedFilename = normalizedTarget.toLocaleLowerCase().endsWith(".md")
    ? normalizedTarget.toLocaleLowerCase()
    : `${normalizedTarget.toLocaleLowerCase()}.md`;
  return (
    [...app.vault.getMarkdownFiles()]
      .filter(isMarkdownFile)
      .sort((left, right) => left.path.localeCompare(right.path))
      .find(
        (file) =>
          file.path.slice(file.path.lastIndexOf("/") + 1).toLocaleLowerCase() ===
          expectedFilename
      ) ?? null
  );
}

function findMarkdownFileByAlias(app: App, alias: string): TFile | null {
  const expectedAlias = alias.trim().toLocaleLowerCase();
  if (!expectedAlias) {
    return null;
  }

  const markdownFiles = [...app.vault.getMarkdownFiles()].sort((left, right) =>
    left.path.localeCompare(right.path)
  );
  for (const file of markdownFiles) {
    const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
    if (
      readAliases(frontmatter).some(
        (candidateAlias) => candidateAlias.toLocaleLowerCase() === expectedAlias
      )
    ) {
      return file;
    }
  }
  return null;
}

function readAliases(frontmatter: unknown): string[] {
  if (!frontmatter || typeof frontmatter !== "object") {
    return [];
  }

  const record = frontmatter as Record<string, unknown>;
  return [...readStringList(record.aliases), ...readStringList(record.alias)];
}

function readStringList(value: unknown): string[] {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
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

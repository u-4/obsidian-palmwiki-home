import assert from "node:assert/strict";
import test from "node:test";
import type { App, View, WorkspaceLeaf } from "obsidian";
import {
  findClosestVerticalScrollContainer,
  HOME_BUTTON_SETTING_DESCRIPTION,
  HOME_COMMAND_SETTING_DESCRIPTION,
  HOME_PAGE_SETTING_DESCRIPTION,
  getHomeButtonActionDescription,
  getPalmWikiHomeButtonDescription,
  HomeNavigationManager,
  normalizeHomePageTarget,
  PALMWIKI_HOME_BUTTON_CLASS,
  resolveExistingHomePage,
  resolveHomeButtonLabel,
  scrollPalmWikiHomeToTop
} from "../src/homeNavigation";

test("Home button label uses a configured label and falls back safely", () => {
  assert.equal(resolveHomeButtonLabel("My Home", "My Vault"), "My Home");
  assert.equal(resolveHomeButtonLabel("  ", "My Vault"), "My Vault");
  assert.equal(resolveHomeButtonLabel("", ""), "PalmWiki Home");
});

test("Home button descriptions explain all three Markdown actions and Home scrolling", () => {
  assert.equal(
    getHomeButtonActionDescription("palmwikiHome"),
    "Open PalmWiki Home in this tab"
  );
  assert.equal(
    getHomeButtonActionDescription("page", "Notes/Home.md"),
    "Open Notes/Home.md in this tab"
  );
  assert.equal(
    getHomeButtonActionDescription("command", "", "Open command palette"),
    "Run command: Open command palette"
  );
  assert.equal(
    getPalmWikiHomeButtonDescription("My Vault"),
    "My Vault: Scroll PalmWiki Home to top"
  );
  assert.match(HOME_BUTTON_SETTING_DESCRIPTION, /always scrolls to the top/);
  assert.match(HOME_PAGE_SETTING_DESCRIPTION, /current tab/);
  assert.match(HOME_PAGE_SETTING_DESCRIPTION, /not created/);
  assert.match(HOME_COMMAND_SETTING_DESCRIPTION, /does not run it/);
});

test("Wiki links, aliases, and headings are normalized without touching plain pipe names", () => {
  assert.deepEqual(normalizeHomePageTarget("[[Folder/Page.md#Section|Shown name]]"), {
    isWikiLink: true,
    linkpath: "Folder/Page.md",
    subpath: "#Section"
  });
  assert.deepEqual(normalizeHomePageTarget("Page#Section"), {
    isWikiLink: false,
    linkpath: "Page",
    subpath: "#Section"
  });
  assert.deepEqual(normalizeHomePageTarget("Folder/A|B.md"), {
    isWikiLink: false,
    linkpath: "Folder/A|B.md",
    subpath: ""
  });
  assert.deepEqual(normalizeHomePageTarget("[[Page|Shown#label]]"), {
    isWikiLink: true,
    linkpath: "Page",
    subpath: ""
  });
});

test("existing Home pages resolve by exact path, extension, basename, Wiki link, and alias", () => {
  const page = makeFile("Folder/Page.md");
  const aliased = makeFile("Folder/Aliased.md");
  const source = makeFile("Folder/Source.md");
  const { app } = makeApp([page, aliased, source], {
    aliases: { [aliased.path]: ["Start here"] },
    links: { Page: page }
  });

  assert.equal(resolveExistingHomePage(app, source.path, "Folder/Page.md")?.file, page);
  assert.equal(resolveExistingHomePage(app, source.path, "Folder/Page")?.file, page);
  assert.equal(resolveExistingHomePage(app, source.path, "Page")?.file, page);
  assert.deepEqual(resolveExistingHomePage(app, source.path, "[[Page#Section|Shown]]"), {
    file: page,
    subpath: "#Section"
  });
  assert.equal(resolveExistingHomePage(app, source.path, "[[Start here]]")?.file, aliased);
  assert.deepEqual(resolveExistingHomePage(app, source.path, "[[#Local heading]]"), {
    file: source,
    subpath: "#Local heading"
  });
});

test("exact paths containing hash or pipe win before Wiki syntax is split", () => {
  const hashFile = makeFile("Folder/A#B.md");
  const pipeFile = makeFile("Folder/A|B.md");
  const page = makeFile("Page.md");
  const aliased = makeFile("Folder/SharpAlias.md");
  const { app } = makeApp([hashFile, pipeFile, page, aliased], {
    aliases: { [aliased.path]: ["C#"] },
    links: { Page: page }
  });

  assert.equal(resolveExistingHomePage(app, "", "[[Folder/A#B.md]]")?.file, hashFile);
  assert.equal(resolveExistingHomePage(app, "", "[[Folder/A|B.md]]")?.file, pipeFile);
  assert.deepEqual(resolveExistingHomePage(app, "", "[[Folder/A#B.md#Heading]]"), {
    file: hashFile,
    subpath: "#Heading"
  });
  assert.deepEqual(resolveExistingHomePage(app, "", "[[Folder/A#B.md|Shown]]"), {
    file: hashFile,
    subpath: ""
  });
  assert.deepEqual(resolveExistingHomePage(app, "", "[[Folder/A#B|Shown]]"), {
    file: hashFile,
    subpath: ""
  });
  assert.deepEqual(resolveExistingHomePage(app, "", "[[Folder/A|B.md|Shown]]"), {
    file: pipeFile,
    subpath: ""
  });
  assert.equal(resolveExistingHomePage(app, "", "[[A#B.md]]")?.file, hashFile);
  assert.deepEqual(resolveExistingHomePage(app, "", "[[Page#C# language]]"), {
    file: page,
    subpath: "#C# language"
  });
  assert.equal(resolveExistingHomePage(app, "", "[[Page|Shown#label]]")?.file, page);
  assert.deepEqual(resolveExistingHomePage(app, "", "[[A#B.md#C# language]]"), {
    file: hashFile,
    subpath: "#C# language"
  });
  assert.deepEqual(resolveExistingHomePage(app, "", "[[Folder/A|B.md#Heading]]"), {
    file: pipeFile,
    subpath: "#Heading"
  });
  assert.deepEqual(
    resolveExistingHomePage(app, "", "[[Folder/A|B.md#Heading|Shown]]"),
    {
      file: pipeFile,
      subpath: "#Heading"
    }
  );
  assert.equal(resolveExistingHomePage(app, "", "C#")?.file, aliased);
});

test("missing and non-Markdown Home targets stay unresolved and never create a file", () => {
  const nonMarkdown = { extension: "canvas", path: "Canvas.canvas" };
  const { app, getCreateCalls } = makeApp([], {
    abstractFiles: { "Canvas.canvas": nonMarkdown }
  });

  assert.equal(resolveExistingHomePage(app, "", "Missing"), null);
  assert.equal(resolveExistingHomePage(app, "", "Canvas.canvas"), null);
  assert.equal(getCreateCalls(), 0);
});

test("the nearest actually scrollable vertical ownerDocument container is selected", () => {
  const ownerWindow = makeOwnerWindow(false);
  const outer = makeScrollElement(ownerWindow, "auto", 600, 200);
  const inner = makeScrollElement(ownerWindow, "auto", 100, 100, outer);
  const child = makeScrollElement(ownerWindow, "visible", 20, 20, inner);

  assert.equal(findClosestVerticalScrollContainer(child as unknown as HTMLElement), outer);
});

test("PalmWiki Home scroll is smooth normally and forced immediate for reduced motion", () => {
  for (const reduceMotion of [false, true]) {
    const ownerWindow = makeOwnerWindow(reduceMotion);
    const scrollContainer = makeScrollElement(ownerWindow, "auto", 800, 200);
    const content = makeScrollElement(ownerWindow, "visible", 600, 600, scrollContainer);
    const shell = makeScrollElement(ownerWindow, "visible", 600, 600, content);
    const viewContainer = makeScrollElement(ownerWindow, "visible", 600, 600);
    content.querySelector = (selector: string) =>
      selector === ".palmwiki-home-shell" ? shell : null;
    viewContainer.querySelector = (selector: string) =>
      selector === ".palmwiki-home-view" ? content : null;

    assert.equal(
      scrollPalmWikiHomeToTop(viewContainer as unknown as HTMLElement),
      true
    );
    if (reduceMotion) {
      assert.equal(scrollContainer.lastScrollOptions, null);
      assert.equal(scrollContainer.scrollTop, 0);
    } else {
      assert.deepEqual(scrollContainer.lastScrollOptions, {
        behavior: "smooth",
        top: 0
      });
    }
  }
});

test("Home navigation manager avoids duplicates, updates labels, and cleans up", () => {
  const document = new FakeDocument();
  const container = document.createElement("div");
  const header = document.createElement("div");
  const headerLeft = document.createElement("div");
  const historyButtons = document.createElement("div");
  const title = document.createElement("div");
  container.classList.add("workspace-leaf-content");
  header.classList.add("view-header");
  headerLeft.classList.add("view-header-left");
  historyButtons.classList.add("view-header-nav-buttons");
  title.classList.add("view-header-title-container");
  container.appendChild(header);
  header.appendChild(headerLeft);
  header.appendChild(title);

  const view = {
    containerEl: container as unknown as HTMLElement,
    getViewType: () => "markdown"
  } as unknown as View;
  const leaf = {
    getViewState: () => ({ type: "markdown" }),
    hoverPopover: null,
    view
  } as unknown as WorkspaceLeaf;
  let label = "First Vault";
  const manager = new HomeNavigationManager({
    getDisplayName: () => label,
    getMarkdownActionDescription: () => "Open PalmWiki Home in this tab",
    onHomeActivate: () => undefined,
    onMarkdownActivate: async () => undefined,
    palmWikiHomeViewType: "palmwiki-home-view"
  });

  manager.syncLeaves([leaf]);
  manager.syncLeaves([leaf]);
  assert.equal(container.findByClass(PALMWIKI_HOME_BUTTON_CLASS).length, 1);

  const button = container.findByClass(PALMWIKI_HOME_BUTTON_CLASS)[0];
  headerLeft.appendChild(historyButtons);
  manager.syncLeaves([leaf]);
  assert.equal(container.findByClass(PALMWIKI_HOME_BUTTON_CLASS).length, 1);
  assert.equal(headerLeft.children[0], historyButtons);
  assert.equal(headerLeft.children[1], button);
  assert.equal(header.children[0], headerLeft);
  assert.equal(header.children[1], title);
  assert.equal(button.ownerDocument, document);
  assert.equal(button.textContent, "First Vault");
  assert.equal(
    button.attributes.get("aria-label"),
    "First Vault: Open PalmWiki Home in this tab"
  );

  label = "Renamed Vault";
  manager.updateLabels();
  assert.equal(button.textContent, "Renamed Vault");
  assert.equal(
    button.attributes.get("title"),
    "Renamed Vault: Open PalmWiki Home in this tab"
  );

  container.isConnected = false;
  manager.syncLeaves([leaf]);
  assert.equal(container.findByClass(PALMWIKI_HOME_BUTTON_CLASS).length, 0);

  container.isConnected = true;
  manager.syncLeaves([leaf]);
  assert.equal(container.findByClass(PALMWIKI_HOME_BUTTON_CLASS).length, 1);
  manager.removeAll();
  assert.equal(container.findByClass(PALMWIKI_HOME_BUTTON_CLASS).length, 0);
});

test("Home navigation preserves Back/Forward order in a compatible nested header", () => {
  const document = new FakeDocument();
  const container = document.createElement("div");
  const headerLeft = document.createElement("div");
  const titleParent = document.createElement("div");
  const historyButtons = document.createElement("div");
  const title = document.createElement("div");
  container.classList.add("workspace-leaf-content");
  headerLeft.classList.add("view-header-left");
  titleParent.classList.add("view-header-title-parent");
  historyButtons.classList.add("view-header-nav-buttons");
  title.classList.add("view-header-title-container");
  container.appendChild(headerLeft);
  headerLeft.appendChild(titleParent);
  titleParent.appendChild(historyButtons);
  titleParent.appendChild(title);

  const view = {
    containerEl: container as unknown as HTMLElement,
    getViewType: () => "markdown"
  } as unknown as View;
  const leaf = {
    getViewState: () => ({ type: "markdown" }),
    hoverPopover: null,
    view
  } as unknown as WorkspaceLeaf;
  const manager = new HomeNavigationManager({
    getDisplayName: () => "My Vault",
    getMarkdownActionDescription: () => "Open PalmWiki Home in this tab",
    onHomeActivate: () => undefined,
    onMarkdownActivate: async () => undefined,
    palmWikiHomeViewType: "palmwiki-home-view"
  });

  manager.syncLeaves([leaf]);

  const button = container.findByClass(PALMWIKI_HOME_BUTTON_CLASS)[0];
  assert.equal(titleParent.children[0], historyButtons);
  assert.equal(titleParent.children[1], button);
  assert.equal(titleParent.children[2], title);
});

interface FakeFile {
  extension: string;
  path: string;
}

function makeFile(path: string): FakeFile {
  return {
    extension: "md",
    path
  };
}

function makeApp(
  files: FakeFile[],
  options: {
    abstractFiles?: Record<string, unknown>;
    aliases?: Record<string, string[]>;
    links?: Record<string, FakeFile>;
  } = {}
): { app: App; getCreateCalls: () => number } {
  const filesByPath = new Map<string, unknown>(
    files.map((file) => [file.path, file] as const)
  );
  for (const [path, file] of Object.entries(options.abstractFiles ?? {})) {
    filesByPath.set(path, file);
  }
  let createCalls = 0;

  const app = {
    metadataCache: {
      getFileCache: (file: FakeFile) => ({
        frontmatter: { aliases: options.aliases?.[file.path] ?? [] }
      }),
      getFirstLinkpathDest: (linkpath: string) => options.links?.[linkpath] ?? null
    },
    vault: {
      create: () => {
        createCalls += 1;
      },
      getAbstractFileByPath: (path: string) => filesByPath.get(path) ?? null,
      getMarkdownFiles: () => files
    }
  } as unknown as App;

  return { app, getCreateCalls: () => createCalls };
}

interface FakeOwnerWindow {
  getComputedStyle: (element: FakeScrollElement) => {
    overflow: string;
    overflowY: string;
  };
  matchMedia: () => { matches: boolean };
}

interface FakeScrollElement {
  clientHeight: number;
  lastScrollOptions: ScrollToOptions | null;
  overflow: string;
  ownerDocument: { defaultView: FakeOwnerWindow };
  parentElement: FakeScrollElement | null;
  querySelector: (selector: string) => FakeScrollElement | null;
  scrollHeight: number;
  scrollTo: (options: ScrollToOptions) => void;
  scrollTop: number;
}

function makeOwnerWindow(reduceMotion: boolean): FakeOwnerWindow {
  return {
    getComputedStyle: (element) => ({
      overflow: element.overflow,
      overflowY: element.overflow
    }),
    matchMedia: () => ({ matches: reduceMotion })
  };
}

function makeScrollElement(
  ownerWindow: FakeOwnerWindow,
  overflow: string,
  scrollHeight: number,
  clientHeight: number,
  parentElement: FakeScrollElement | null = null
): FakeScrollElement {
  const element: FakeScrollElement = {
    clientHeight,
    lastScrollOptions: null,
    overflow,
    ownerDocument: { defaultView: ownerWindow },
    parentElement,
    querySelector: () => null,
    scrollHeight,
    scrollTo: (options) => {
      element.lastScrollOptions = options;
    },
    scrollTop: 1
  };
  return element;
}

class FakeDocument {
  defaultView: { createEl: (tagName: string) => FakeElement };

  constructor() {
    this.defaultView = {
      createEl: (tagName) => this.createElement(tagName)
    };
  }

  createElement(_tagName: string): FakeElement {
    return new FakeElement(this);
  }
}

class FakeElement {
  attributes = new Map<string, string>();
  children: FakeElement[] = [];
  classes = new Set<string>();
  classList = {
    add: (...classNames: string[]) => {
      for (const className of classNames) {
        this.classes.add(className);
      }
    }
  };
  isConnected = true;
  ownerDocument: FakeDocument;
  parentElement: FakeElement | null = null;
  textContent = "";
  type = "";
  private listeners = new Map<string, Set<EventListener>>();

  constructor(ownerDocument: FakeDocument) {
    this.ownerDocument = ownerDocument;
  }

  get firstChild(): FakeElement | null {
    return this.children[0] ?? null;
  }

  appendChild(child: FakeElement): void {
    child.removeFromParent();
    child.parentElement = this;
    child.isConnected = this.isConnected;
    this.children.push(child);
  }

  contains(element: FakeElement): boolean {
    return element === this || this.children.some((child) => child.contains(element));
  }

  insertBefore(child: FakeElement, before: FakeElement | null): void {
    child.removeFromParent();
    child.parentElement = this;
    child.isConnected = this.isConnected;
    const index = before ? this.children.indexOf(before) : -1;
    if (index >= 0) {
      this.children.splice(index, 0, child);
    } else {
      this.children.push(child);
    }
  }

  querySelector<T>(_selector: string): T | null {
    const selector = _selector.startsWith(".") ? _selector.slice(1) : _selector;
    return (this.findByClass(selector)[0] as T | undefined) ?? null;
  }

  querySelectorAll<T>(_selector: string): T[] {
    const selector = _selector.startsWith(".") ? _selector.slice(1) : _selector;
    return this.findByClass(selector) as T[];
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

  closest(_selector: string): FakeElement | null {
    return null;
  }

  addEventListener(type: string, listener: EventListener): void {
    const listeners = this.listeners.get(type) ?? new Set<EventListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: EventListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
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

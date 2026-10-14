'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const settle = () => new Promise(resolve => setImmediate(resolve));

class Element {
  constructor(doc, tag = 'div') {
    this.ownerDocument = doc; this.tagName = tag; this.children = []; this.dataset = {};
    this.listeners = new Map(); this.attributes = {}; this.textContent = ''; this.scrollTop = 0;
    this.scrollHeight = 2400; this.clientHeight = 600; this.isConnected = true; this.hidden = false;
    this.rect = { top: 0, bottom: 200, left: 0, right: 200, width: 200, height: 200 }; this.style = {};
  }
  append(...children) { for (const child of children) this.insertBefore(child, null); }
  prepend(child) { this.insertBefore(child, this.firstElementChild); }
  insertBefore(child, before) {
    if (child === before) return;
    child.remove(); child.parentElement = this;
    const index = before ? this.children.indexOf(before) : this.children.length;
    assert.ok(index >= 0); this.children.splice(index, 0, child);
  }
  remove() { if (this.parentElement) { this.parentElement.children = this.parentElement.children.filter(c => c !== this); this.parentElement = null; } }
  contains(node) { return this === node || this.children.some(c => c.contains(node)); }
  get firstElementChild() { return this.children[0] || null; }
  get previousElementSibling() { const p = this.parentElement; return p?.children[p.children.indexOf(this) - 1] || null; }
  after(node) { this.parentElement.insertBefore(node, this.nextElementSibling); }
  get nextElementSibling() { const p = this.parentElement; return p?.children[p.children.indexOf(this) + 1] || null; }
  addEventListener(name, fn) { if (!this.listeners.has(name)) this.listeners.set(name, new Set()); this.listeners.get(name).add(fn); }
  removeEventListener(name, fn) { this.listeners.get(name)?.delete(fn); }
  emit(name, event = {}) { for (const fn of [...(this.listeners.get(name) || [])]) fn({ type: name, preventDefault() {}, instanceOf() { return false; }, ...event }); }
  setAttribute(key, value) { this.attributes[key] = value; }
  removeAttribute(key) { delete this.attributes[key]; if (key === 'src') this.src = ''; }
  getBoundingClientRect() { return this.rect; }
  getClientRects() { return this.hidden ? [] : [this.rect]; }
  closest() { return null; }
  querySelectorAll() { return []; }
}
function environment() {
  let next = 0; const timers = new Map(), frames = new Map();
  const clock = {
    setTimeout(fn, delay) { const id = ++next; timers.set(id, { fn, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    tick(maxDelay = 1000) {
      for (const [id, item] of [...timers]) if (item.delay <= maxDelay && timers.delete(id)) item.fn();
    },
  };
  const doc = new Element(null, 'document'); doc.ownerDocument = doc; doc.hidden = false;
  const win = new Element(doc, 'window'); doc.defaultView = win;
  win.matchMedia = () => ({ matches: true }); // Default fixture has a mouse.
  win.requestAnimationFrame = fn => { const id = ++next; frames.set(id, fn); return id; };
  win.cancelAnimationFrame = id => frames.delete(id);
  doc.createElement = tag => new Element(doc, tag);
  doc.body = new Element(doc, 'body'); win.innerWidth = 1400; win.innerHeight = 900;
  win.MouseEvent = class { constructor(type, init) { Object.assign(this, { type }, init); } };
  doc.createTextNode = text => { const e = new Element(doc, '#text'); e.textContent = text; return e; };
  doc.flush = () => { for (const [id, fn] of [...frames]) if (frames.delete(id)) fn(); };
  return { doc, clock };
}
class TFile {
  constructor(path, size = 100, mtime = 1) {
    this.path = path; this.extension = path.split('.').pop();
    this.basename = path.split('/').pop().replace(/\.[^.]+$/, ''); this.stat = { mtime, size };
  }
}
class Component {
  constructor() { this.disposers = []; this.loaded = false; }
  load() { this.loaded = true; }
  register(fn) { this.disposers.push(fn); }
  registerDomEvent(el, type, fn, opts) { el.addEventListener(type, fn, opts); this.register(() => el.removeEventListener(type, fn, opts)); }
  unload() { this.loaded = false; for (const fn of this.disposers) fn(); }
}
class BasesView extends Component { constructor(controller) { super(); this.app = controller.app; } }
class Plugin extends Component {
  constructor(app) { super(); this.app = app; this.manifest = { id: 'palmwiki-home' }; this.commands = []; }
  async loadData() { return this.app.saved || null; }
  async saveData(data) { this.app.saved = { ...data }; }
  registerBasesView() {} addSettingTab() {} addRibbonIcon() {} registerEvent() {}
  registerHoverLinkSource(id, info) { this.hoverSources = { ...this.hoverSources, [id]: info }; }
  addCommand(command) { this.commands.push(command); }
}
function load() {
  const { doc, clock } = environment(); const notices = []; const modals = []; const urls = []; const rendered = []; const platform = { isMobile: false };
  const context = { module: { exports: {} }, console, URL, TextDecoder, TextEncoder, Uint8Array, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    require(id) { assert.equal(id, 'obsidian'); return { Plugin, BasesView, TFile, Platform: platform,
      PluginSettingTab: class {}, Setting: class {}, Notice: class { constructor(text) { notices.push(text); } },
      Keymap: { isModEvent: ev => {
        // Obsidian inspects the real event via instanceOf(), even for an unmodified click.
        if (ev?.type === 'click') assert.equal(typeof ev.instanceOf, 'function');
        return ev.ctrlKey || ev.metaKey || ev.button === 1 ? 'tab' : false;
      }, isModifier: ev => !!(ev.metaKey || ev.ctrlKey) }, setIcon() {},
      Modal: class {
        constructor(app) { this.app = app; this.modalEl = doc.createElement('div'); this.modalEl.classList = { add() {} }; this.contentEl = doc.createElement('div'); }
        setTitle(title) { this.title = title; }
        open() { modals.push(this); this.onOpen(); }
        close() { this.closed = true; this.onClose(); }
      },
      FuzzySuggestModal: class { constructor(app) { this.app = app; } setPlaceholder(text) { this.placeholder = text; } open() { modals.push(this); } },
      SuggestModal: class {
        // Mirrors instance fields of Obsidian's Modal that a subclass must not shadow (e.g. `selection`).
        constructor(app) { this.app = app; this.selection = null; this.inputEl = { value: '', inputs: 0, dispatchEvent() { this.inputs++; } };
          this.scope = { keys: [], register(modifiers, key, func) { this.keys.push({ modifiers, key, func }); } }; }
        setPlaceholder(text) { this.placeholder = text; } setInstructions() {} open() { modals.push(this); } close() { this.closed = true; }
        selectSuggestion(value, evt) { this.close(); this.onChooseSuggestion(value, evt); }
      },
      // Letters in order, like Obsidian's fuzzy search; a higher score for a tighter match.
      prepareFuzzySearch: query => text => { let i = 0, last = -1, gaps = 0; for (const ch of query.replace(/\s+/g, '')) { const at = text.indexOf(ch, last + 1); if (at < 0) return null; if (last >= 0) gaps += at - last - 1; last = at; i++; } return { score: -gaps }; },
      normalizePath: p => p.replace(/\/+/g, '/').replace(/^\//, ''),
      FileView: class { getDisplayText() { return this.file ? this.file.basename : 'ファイルがありません'; } },
      WorkspaceLeaf: class { async setViewState(viewState) { this.calls = (this.calls || 0) + 1; await this.loading; return viewState; } },
      Scope: class { constructor(parent) { this.parent = parent; this.keys = []; } register(modifiers, key, func) { this.keys.push({ modifiers, key, func }); } },
      Component, MarkdownRenderer: { async render(app, md, el) { rendered.push(md); el.textContent = md; } },
    }; },
    Event: class { constructor(type) { this.type = type; } },
    activeWindow: { open: url => urls.push(url) },
  };
  const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  vm.runInNewContext(source + '\nmodule.exports.testing = { attachmentNames, embedsMayUse, searchFoldTable, searchPretest, narrowsQuery, scopeAffected, linkGraphSize, ranksFresh, quotePrefix, quoteEdits, videoEmbedUrl, isTweetUrl, emptyLineAt, pageTitle, titledLink, pageCharset, fetchPageTitle, matchRanges, setHighlighted, linkTier, linkRanks, bodySnippet, BodySearch, safeHomePath, excerpt, cardWindow, firstImage, PreviewStore, snapshotKey, LiteCards, defaultBase, scopeKind, listScopes, scopeMembers, ScopePicker, normalizeSearch, matchNotes, searchableNotes, complementWords, UnifiedSearch, hoverOpenDelay, cardsBelowPreview, FileView, WorkspaceLeaf };', context);
  const Main = context.module.exports;
  return { Main, ...Main.testing, doc, clock, notices, modals, urls, rendered, platform };
}
function appDouble(doc, count = 0) {
  const files = new Map(), metadata = new Map(), bodies = new Map(), recentFiles = []; const calls = { reads: [], creates: 0, commands: [], images: [], opens: [], enumerations: 0, triggers: [] };
  const leaf = { view: { containerEl: doc.createElement('div') }, getViewState: () => ({}), getRoot: () => ({}),
    async openFile(file) { calls.opens.push(file.path); } };
  const app = {
    vault: { getAbstractFileByPath: p => files.get(p), on: () => ({}), getName: () => 'PalmWiki',
      async create(p, body) { assert.ok(!files.has(p)); calls.creates++; const file = new TFile(p, body.length); files.set(p, file); return file; },
      async cachedRead(file) { calls.reads.push(file.path); return bodies.get(file.path) ?? '# 見出し\n本文'; },
      getResourcePath(file) { calls.images.push(file.path); return 'app://local/' + file.path; },
      // Allowed only when the Project/Area picker opens; rendering must not enumerate.
      getMarkdownFiles() { calls.enumerations++; return [...files.values()].filter(f => f.extension === 'md'); },
    },
    metadataCache: { on: () => ({}), getFileCache: file => metadata.get(file.path), resolvedLinks: {},
      getFirstLinkpathDest: (link, source) => files.get(link) || files.get(path.posix.normalize(path.posix.join(path.posix.dirname(source), link))),
    },
    fileManager: { getNewFileParent: () => ({ path: '00_Inbox' }) },
    keymap: { scopes: [], pushScope(scope) { this.scopes.push(scope); }, popScope(scope) { this.scopes = this.scopes.filter(s => s !== scope); } },
    workspace: { getMostRecentLeaf: () => leaf, getLeaf: () => leaf, setActiveLeaf() {}, async revealLeaf() {},
      getActiveFile: () => null, getLastOpenFiles: () => recentFiles,
      iterateAllLeaves: cb => cb(leaf), on: () => ({}), onLayoutReady: cb => cb(),
      trigger(name, info) { calls.triggers.push({ name, info }); },
      async openLinkText(p) { calls.opens.push(p); },
    },
    commands: { listCommands: () => [{ id: 'omnisearch:show-modal', name: 'Omnisearch' }, { id: 'aqs:recent', name: 'Recent' }],
      executeCommandById(id) { calls.commands.push(id); return true; } },
  };
  const entries = Array.from({ length: count }, (_, i) => { const file = new TFile(`${i}.md`); files.set(file.path, file); return { file }; });
  return { app, files, metadata, bodies, recentFiles, calls, leaf, data: { groupedData: [{ entries }] } };
}
async function fixture(count = 24) {
  const h = load(); const a = appDouble(h.doc, count); const plugin = new h.Main(a.app); await plugin.onload();
  const parent = h.doc.createElement('div'); parent.rect.bottom = 600; a.leaf.view.containerEl.append(parent);
  const view = new h.LiteCards({ app: a.app }, parent, plugin); view.data = a.data;
  const refresh = () => { view.onDataUpdated(); h.doc.flush(); h.doc.flush(); };
  const pump = async () => { h.doc.flush(); h.clock.tick(); await settle(); };
  const stop = () => { view.unload(); plugin.onunload(); plugin.unload(); };
  return { ...h, ...a, plugin, parent, view, refresh, pump, stop };
}

test('safe home path rejects traversal, hidden folders and non-base paths', () => {
  const { safeHomePath } = load();
  for (const p of ['', '../x.base', '/x.base', '.obsidian/x.base', 'a/../x.base', 'a//x.base', 'x.md', 'C:\\x.base', 'x\0.base']) assert.equal(safeHomePath(p), null);
  assert.equal(safeHomePath(' Home/一覧.base '), 'Home/一覧.base');
});
test('preview strips markup and frontmatter while preserving Japanese labels', () => {
  const { excerpt } = load();
  assert.equal(excerpt('---\naliases: [隠す]\n---\n# 見出し\n[[path|日本語]] ![[image.png]] 本文'), '見出し 日本語 本文');
  assert.equal(excerpt('---\r\ntitle: x\r\n---\r\n本文'), '本文');
  assert.equal(excerpt('---\nunfinished yaml'), ''); assert.ok(excerpt('あ'.repeat(500)).length <= 280);
});
test('HTML and network embeds are reduced to inert text', () => {
  assert.equal(load().excerpt('<script>x</script> ![](https://invalid/image.png) [表示](https://invalid)'), 'x 表示');
});
test('Bases order is preserved, only 300 references and 24 initial cards from 10000 entries', () => {
  const h = load(), a = appDouble(h.doc, 10000); const w = h.cardWindow(a.data, 24);
  assert.equal(w.total, 10000); assert.equal(w.files.length, 300); assert.equal(w.shown.length, 24);
  assert.equal(w.files[299].path, '299.md');
});
test('default base still requests markdown and descending modified time', () => {
  const text = load().defaultBase(); assert.match(text, /file.ext == "md"/); assert.match(text, /property: file.mtime\n        direction: DESC/);
});
test('startup reads no bodies or images, creates no files and invokes no external commands', async () => {
  const f = await fixture(); f.refresh(); assert.equal(f.calls.reads.length, 0); assert.equal(f.calls.images.length, 0);
  assert.equal(f.calls.creates, 0); assert.equal(f.calls.commands.length, 0); assert.equal(f.calls.enumerations, 0); f.stop();
});
test('toolbar deduplicates, survives view replacement and skips deferred tabs', async () => {
  const f = await fixture(); const old = f.leaf.view.containerEl; f.plugin.syncBars(); f.plugin.syncBars(); assert.equal(f.plugin.bars.size, 1);
  f.leaf.view = { containerEl: f.doc.createElement('div') }; f.plugin.syncBars(); assert.equal(f.leaf.view.containerEl.children.length, 1);
  assert.equal(old.children.filter(c => c.className === 'palmwiki-lite-nav').length, 0);
  f.leaf.isDeferred = true; f.plugin.syncBars(); assert.equal(f.plugin.bars.size, 0); f.stop();
});
test('with back/forward buttons in the header, the Vault name (Home) and a search icon go right after them as header buttons', async () => {
  const f = await fixture(0);
  const root = f.doc.createElement('div'); const header = f.doc.createElement('div'); const left = f.doc.createElement('div');
  const nav = f.doc.createElement('div'); const title = f.doc.createElement('div');
  left.append(nav, title); header.append(left); root.append(header);
  root.querySelector = sel => (sel.includes('view-header-nav-buttons') ? nav : null);
  f.leaf.view = { containerEl: root }; f.plugin.syncBars();
  const bar = nav.nextElementSibling;
  assert.equal(bar.className, 'palmwiki-lite-nav is-in-header'); assert.equal(left.children[2], title);
  assert.deepEqual(bar.children.map(b => [b.className, b.title]), [['clickable-icon palmwiki-lite-nav-button palmwiki-lite-nav-home', 'Home（PalmWiki）'], ['clickable-icon palmwiki-lite-nav-button palmwiki-lite-nav-search', '検索']]);
  assert.equal(bar.children[0].children[1].textContent, 'PalmWiki'); assert.equal(bar.children[1].children.length, 1); // search: icon only
  f.plugin.syncBars(); assert.equal(left.children.length, 3); // kept, not duplicated
  f.plugin.settings.homeLabel = '手のひらWiki'; f.plugin.refreshBars();
  assert.equal(nav.nextElementSibling.children[0].children[1].textContent, '手のひらWiki'); assert.equal(left.children.length, 3);
  f.stop();
});
test('simultaneous Home clicks create one .base, subsequent clicks do not overwrite it', async () => {
  const f = await fixture(); await Promise.all([f.plugin.openHome(), f.plugin.openHome()]); await f.plugin.openHome(); assert.equal(f.calls.creates, 1); f.stop();
});
test('phone navigation stays inside the header when native back/forward is hidden', async () => {
  const f = await fixture(0);
  const root = f.doc.createElement('div'), header = f.doc.createElement('div');
  const left = f.doc.createElement('div'), nav = f.doc.createElement('div');
  const content = f.doc.createElement('div');
  left.append(nav); header.append(left); root.append(header, content);
  root.querySelector = sel => sel.includes('view-header-nav-buttons') ? nav : null;
  f.doc.defaultView.getComputedStyle = el => ({ display: el === nav ? 'none' : 'flex' });
  f.leaf.view = { containerEl: root };
  f.plugin.syncBars();
  const bar = nav.nextElementSibling;
  assert.ok(bar, 'the hidden native navigation still anchors the toolbar inside the header');
  assert.equal(bar.parentElement, left);
  assert.deepEqual(root.children, [header, content]);
  bar.children[1].emit('click');
  assert.equal(f.modals.length, 1, 'the search action is still connected');
  f.plugin.syncBars();
  assert.equal(left.children.length, 2, 'layout updates do not duplicate the toolbar');
  const replacement = f.doc.createElement('div'), newLeft = f.doc.createElement('div'), newNav = f.doc.createElement('div');
  newLeft.append(newNav); replacement.append(newLeft); header.remove(); root.prepend(replacement);
  root.querySelector = sel => sel.includes('view-header-nav-buttons') ? newNav : null;
  f.plugin.syncBars();
  assert.equal(bar.parentElement, null);
  assert.equal(newNav.nextElementSibling.parentElement, newLeft);
  assert.deepEqual(root.children, [replacement, content]);
  f.stop();
});
test('invalid or missing-parent Home paths fail without writes', async () => {
  const f = await fixture(); f.plugin.settings.homePath = 'Missing/Home.base'; await f.plugin.openHome();
  f.plugin.settings.homePath = '.obsidian/Home.base'; await f.plugin.openHome(); assert.equal(f.calls.creates, 0); assert.ok(f.notices.length); f.stop();
});
test('the page switcher setting is kept across load and save; old search settings are dropped', async () => {
  const h = load(), a = appDouble(h.doc); a.app.saved = { homePath: 'My.base', searchCommand: 'omnisearch:show-modal', searchMode: 'separate', switchCommand: 'aqs:recent' };
  const p = new h.Main(a.app); await p.onload(); p.runExternal('switchCommand'); await p.saveSettings();
  assert.deepEqual(a.calls.commands, ['aqs:recent']); assert.equal(a.app.saved.switchCommand, 'aqs:recent');
  assert.equal('searchCommand' in a.app.saved, false); assert.equal('searchMode' in a.app.saved, false); p.onunload();
});
test('a switcher command pointing back at this plugin does not recurse', async () => {
  const f = await fixture(); f.app.commands.listCommands = () => [{ id: 'palmwiki-home:focus-search' }]; f.plugin.settings.switchCommand = 'palmwiki-home:focus-search';
  f.plugin.runExternal('switchCommand'); assert.equal(f.calls.commands.length, 0); assert.ok(f.notices.length); f.stop();
});
test('initial DOM is 24, first frame reads nothing, pending body reads are capped at two', async () => {
  const f = await fixture(10000); const waiters = []; f.app.vault.cachedRead = file => { f.calls.reads.push(file.path); return new Promise(r => waiters.push(r)); };
  f.refresh(); assert.equal(f.view.cards.size, 24); assert.equal(f.calls.reads.length, 0);
  await f.pump(); assert.equal(f.calls.reads.length, 2); f.stop(); waiters.forEach(r => r('late')); await settle(); assert.equal(f.calls.reads.length, 2);
});
test('scrolling near bottom adds 24 once per frame without replacing old cards', async () => {
  const f = await fixture(10000); f.refresh(); const old = f.view.cards.get('0.md');
  f.parent.scrollTop = 1600; f.parent.emit('scroll'); f.parent.scrollTop = 1601; f.parent.emit('scroll'); f.doc.flush();
  assert.equal(f.view.cards.size, 48); assert.equal(f.view.cards.get('0.md'), old); f.stop();
});
test('no automatic fill on initial viewport; upwards scroll does not add cards', async () => {
  const f = await fixture(200); f.refresh(); f.parent.scrollHeight = 400; f.doc.flush(); assert.equal(f.view.cards.size, 24);
  f.view.lastScrollTop = 100; f.parent.scrollTop = 50; f.parent.emit('scroll'); f.doc.flush(); assert.equal(f.view.cards.size, 24); f.stop();
});
test('more button works and hard cap is 300 despite repeated requests', async () => {
  const f = await fixture(10000); f.refresh(); for (let i = 0; i < 40; i++) { f.view.more.emit('click'); f.doc.flush(); }
  assert.equal(f.view.cards.size, 300); assert.equal(f.view.limit, 300); assert.equal(f.view.more.hidden, true);
  assert.match(f.view.endText.textContent, /300/); f.view.goFirst(); assert.equal(f.view.cards.size, 24); assert.equal(f.parent.scrollTop, 0); f.stop();
});
test('partial final batch and empty results have correct counts', async () => {
  const f = await fixture(25); f.refresh(); f.view.requestMore(); f.doc.flush(); assert.equal(f.view.cards.size, 25); assert.ok(f.view.more.hidden);
  f.view.data = { groupedData: [] }; f.refresh(); assert.equal(f.view.cards.size, 0); assert.equal(f.view.status.textContent, 'ノートはありません'); f.stop();
});
test('only visible cards queue content without IntersectionObserver', async () => {
  const f = await fixture(100); f.view.onDataUpdated(); f.doc.flush();
  for (const [p, card] of f.view.cards) if (p !== '0.md') card.el.rect = { top: 5000, bottom: 5200 };
  await f.pump(); assert.deepEqual(f.calls.reads, ['0.md']); f.stop();
});
test('hidden view and background document do not read content', async () => {
  const f = await fixture(); f.view.root.hidden = true; f.refresh(); await f.pump(); assert.equal(f.calls.reads.length, 0);
  f.view.root.hidden = false; f.doc.hidden = true; f.view.scheduleViewport(); await f.pump(); assert.equal(f.calls.reads.length, 0); f.stop();
});
test('abandoned queued reads are cancelled before touching the Vault', async () => {
  const f = await fixture(); f.refresh(); f.view.root.hidden = true; await f.pump(); assert.equal(f.calls.reads.length, 0); f.stop();
});
test('warm short-text cache reuses a preview with no additional body read', async () => {
  const f = await fixture(1); f.refresh(); await f.pump(); assert.equal(f.calls.reads.length, 1);
  f.view.removeCard(f.view.cards.get('0.md')); f.view.render(); assert.match(f.view.cards.get('0.md').preview.textContent, /本文/);
  await f.pump(); assert.equal(f.calls.reads.length, 1); f.stop();
});
test('cache remains at most 300 short entries and is cleared on unload', async () => {
  const h = load(), a = appDouble(h.doc, 310); const store = new h.PreviewStore(a.app);
  for (const { file } of a.data.groupedData[0].entries) { const r = store.read(file, () => true); h.clock.tick(); await r; await settle(); }
  assert.equal(store.cache.size, 300); assert.equal(store.get(a.files.get('0.md')), undefined); store.dispose(); assert.equal(store.cache.size, 0);
});
test('cross-view identical preview requests share one body read', async () => {
  const f = await fixture(1), file = f.files.get('0.md');
  const a = f.plugin.previews.read(file, () => true), b = f.plugin.previews.read(file, () => true); f.clock.tick();
  await Promise.all([a, b]); assert.equal(f.calls.reads.length, 1); f.stop();
});
test('changed note does not receive stale text from an older read', async () => {
  const f = await fixture(1), waiters = []; f.app.vault.cachedRead = () => new Promise(r => waiters.push(r));
  f.refresh(); await f.pump(); const old = f.view.cards.get('0.md'); f.files.get('0.md').stat.mtime = 2;
  f.refresh(); const latest = f.view.cards.get('0.md'); assert.notEqual(old, latest);
  waiters[0]('古い内容'); await settle(); assert.equal(latest.preview.textContent, '…');
  await f.pump(); waiters[1]('新しい内容'); await settle(); assert.equal(latest.preview.textContent, '新しい内容'); f.stop();
});
test('oversized note has a card without body preview reads', async () => {
  const f = await fixture(1); f.files.get('0.md').stat.size = 1024 * 1024; f.refresh(); await f.pump();
  assert.equal(f.calls.reads.length, 0); assert.match(f.view.cards.get('0.md').preview.textContent, /大きな/); f.stop();
});
test('metadata resolves first local wiki/Markdown image including relative encoded paths', async () => {
  const f = await fixture(1), note = f.files.get('0.md'), image = new TFile('images/日本 語.webp', 1024);
  f.files.set(image.path, image); f.metadata.set(note.path, { embeds: [{ link: 'Other.md' }, { link: 'images/%E6%97%A5%E6%9C%AC%20%E8%AA%9E.webp|100' }] });
  assert.equal(f.firstImage(f.app, note), image); f.stop();
});
test('external, data, file, protocol-relative, SVG and GIF embeds never load', async () => {
  const f = await fixture(1), note = f.files.get('0.md');
  for (const p of ['https://host/x.png', 'data:image/png,xxx', 'file:///x.png', '//host/x.png', '%68ttps://host/x.png', 'x.svg', 'x.gif']) f.files.set(p, new TFile(p));
  f.metadata.set(note.path, { embeds: [...f.files.keys()].filter(x => x !== note.path).map(link => ({ link })) });
  assert.equal(f.firstImage(f.app, note), null); f.refresh(); await f.pump(); assert.equal(f.calls.images.length, 0); f.stop();
});
test('first oversized image is not replaced by a different small image', async () => {
  const f = await fixture(1), note = f.files.get('0.md');
  f.files.set('big.png', new TFile('big.png', 3 * 1024 * 1024)); f.files.set('small.png', new TFile('small.png'));
  f.metadata.set(note.path, { embeds: [{ link: 'big.png' }, { link: 'small.png' }] }); assert.equal(f.firstImage(f.app, note), null); f.stop();
});
test('images start after paint, with two concurrent loads per view', async () => {
  const f = await fixture(6);
  for (let i = 0; i < 6; i++) { f.files.set(`${i}.png`, new TFile(`${i}.png`)); f.metadata.set(`${i}.md`, { embeds: [{ link: `${i}.png` }] }); }
  f.refresh(); assert.equal(f.calls.images.length, 0); await f.pump(); assert.equal(f.calls.images.length, 2);
  f.view.cards.get('0.md').img.emit('load'); await f.pump(); assert.equal(f.calls.images.length, 3); f.stop();
});
test('leaving viewport releases image source and re-entry can load it again', async () => {
  const f = await fixture(1); f.files.set('a.png', new TFile('a.png')); f.metadata.set('0.md', { embeds: [{ link: 'a.png' }] });
  f.refresh(); await f.pump(); const card = f.view.cards.get('0.md'), img = card.img;
  f.view.setNear(card, false); assert.equal(card.img, null); assert.equal(img.src, ''); assert.equal(f.view.activeImages.size, 0);
  f.view.setNear(card, true); await f.pump(); assert.equal(f.calls.images.length, 2); f.stop();
});
test('metadata arriving later adds the image without replacing the card or re-reading text', async () => {
  const f = await fixture(1); f.refresh(); await f.pump(); const card = f.view.cards.get('0.md');
  f.files.set('new.png', new TFile('new.png')); f.metadata.set('0.md', { embeds: [{ link: 'new.png' }] });
  f.view.refreshImages('0.md'); await f.pump(); assert.equal(f.view.cards.get('0.md'), card); assert.equal(f.calls.images.length, 1); assert.equal(f.calls.reads.length, 1); f.stop();
});
test('modified or removed image clears old source and does not keep stale image bytes', async () => {
  const f = await fixture(1), image = new TFile('a.png'); f.files.set(image.path, image); f.metadata.set('0.md', { embeds: [{ link: 'a.png' }] });
  f.refresh(); await f.pump(); const card = f.view.cards.get('0.md'), old = card.img;
  image.stat.mtime++; f.view.refreshImages(null, 'a.png'); assert.equal(old.src, ''); await f.pump(); assert.notEqual(card.img, old);
  f.files.delete('a.png'); f.view.refreshImages(null, 'a.png'); assert.equal(card.img, null); assert.ok(card.media.hidden); f.stop();
});
test('failed image is hidden and does not automatically retry forever', async () => {
  const f = await fixture(1); f.files.set('bad.png', new TFile('bad.png')); f.metadata.set('0.md', { embeds: [{ link: 'bad.png' }] });
  f.refresh(); await f.pump(); const card = f.view.cards.get('0.md'); card.img.emit('error');
  f.view.updateImage(card); await f.pump(); assert.equal(f.calls.images.length, 1); assert.equal(card.img, null); assert.ok(card.media.hidden); f.stop();
});
test('images can be disabled without changing search settings or reading image files', async () => {
  const f = await fixture(1); f.files.set('a.png', new TFile('a.png')); f.metadata.set('0.md', { embeds: [{ link: 'a.png' }] });
  f.plugin.settings.showImages = false; f.refresh(); await f.pump(); assert.equal(f.calls.images.length, 0); assert.equal(f.plugin.settings.searchPreview, true); f.stop();
});
test('touch-generated mouseover never starts a card preview, and the first click opens the note', async () => {
  const f = await fixture(1); f.refresh();
  const card = f.view.cards.get('0.md').el;
  f.doc.defaultView.matchMedia = query => {
    assert.equal(query, '(hover: hover) and (pointer: fine)');
    return { matches: false };
  };
  f.plugin.settings.popupTrigger = 'hover';
  card.emit('mouseover', { metaKey: true });
  f.doc.emit('mousemove', { screenX: 4, screenY: 4, target: card });
  f.clock.tick(); await settle();
  assert.equal(f.plugin.cardPopover.hovered, null);
  assert.equal(f.doc.body.children.length, 0);
  card.emit('click');
  assert.deepEqual(f.calls.opens, ['0.md']);
  f.plugin.settings.cardPopover = false;
  card.emit('mouseover', { metaKey: true });
  assert.equal(f.calls.triggers.length, 0, 'touch must not launch the external hover preview either');
  f.stop();
});
test('deleted notes cannot be opened from stale cards', async () => {
  const f = await fixture(1); f.refresh(); const card = f.view.cards.get('0.md'); f.files.delete('0.md'); card.el.emit('click', { button: 0 });
  assert.equal(f.calls.opens.length, 0); assert.ok(f.notices.length); f.stop();
});
test('unload releases image elements and ignores unfinished reads', async () => {
  const f = await fixture(2); f.files.set('a.png', new TFile('a.png')); f.metadata.set('0.md', { embeds: [{ link: 'a.png' }] });
  const waiters = []; f.app.vault.cachedRead = () => new Promise(r => waiters.push(r)); f.refresh(); await f.pump(); const img = f.view.cards.get('0.md').img;
  f.stop(); waiters.forEach(r => r('late')); await settle(); assert.equal(img.src, ''); assert.equal(f.view.cards.size, 0); assert.equal(f.plugin.previews.cache.size, 0);
});

test('hung image load releases the slot after timeout', async () => {
  const f = await fixture(3);
  for (let i = 0; i < 3; i++) { f.files.set(`${i}.png`, new TFile(`${i}.png`)); f.metadata.set(`${i}.md`, { embeds: [{ link: `${i}.png` }] }); }
  f.refresh(); await f.pump(); assert.equal(f.calls.images.length, 2);
  f.clock.tick(9000); await f.pump(); assert.equal(f.calls.images.length, 3); f.stop();
});
test('image version URL changes with mtime without disabling same-version browser caching', async () => {
  const f = await fixture(1), image = new TFile('a.png'); f.files.set('a.png', image); f.metadata.set('0.md', { embeds: [{ link: 'a.png' }] });
  f.refresh(); await f.pump(); const first = f.view.cards.get('0.md').img.src;
  f.view.setNear(f.view.cards.get('0.md'), false); f.view.setNear(f.view.cards.get('0.md'), true); await f.pump();
  assert.equal(f.view.cards.get('0.md').img.src, first);
  image.stat.mtime++; f.view.refreshImages(null, 'a.png'); await f.pump(); assert.notEqual(f.view.cards.get('0.md').img.src, first); f.stop();
});

// Projects and Areas
function scopeVault(f) {
  const note = (p, frontmatter, mtime = 1) => { const file = new TFile(p, 100, mtime); f.files.set(p, file); if (frontmatter) f.metadata.set(p, { frontmatter }); return file; };
  const project = note('10_Notes/Projects/機器整備.md', { tags: ['Projects'], status: 'active', aliases: ['equipment'] }, 5);
  note('10_Notes/Projects/終わった件.md', { tags: 'Projects', status: 'completed' });
  note('00_Inbox/家族の予定.md', { tags: ['#Areas'] });
  note('00_Inbox/ただのメモ.md', { tags: ['memo'] });
  const daily = note('01_Daily/2026/2026-09-27.md', null, 9);
  const linked = note('00_Inbox/手順.md', null, 7);
  const other = note('00_Inbox/無関係.md', null, 8);
  f.app.metadataCache.resolvedLinks = {
    [project.path]: { [linked.path]: 1 },
    [daily.path]: { [project.path]: 2 },
    [other.path]: { '00_Inbox/家族の予定.md': 1 },
  };
  const entries = [daily, other, linked, project].map(file => ({ file })); // Bases order: newest first
  for (let i = 0; i < 400; i++) { const file = new TFile(`bulk/${i}.md`); f.files.set(file.path, file); entries.push({ file }); }
  f.view.data = { groupedData: [{ entries }] };
  return { project, daily, linked, other };
}

test('Project/Area kind comes from frontmatter tags, as array, string or #tag', () => {
  const { scopeKind } = load();
  assert.equal(scopeKind({ tags: ['Projects'] }), 'Projects');
  assert.equal(scopeKind({ tags: 'Areas, other' }), 'Areas');
  assert.equal(scopeKind({ tags: ['#Areas'] }), 'Areas');
  assert.equal(scopeKind({ tags: ['projects'] }), null);
  assert.equal(scopeKind(undefined), null);
});
test('picker lists Projects and Areas, favorites first, completed hidden unless shown or filtered by status', async () => {
  const f = await fixture(0); scopeVault(f);
  f.plugin.settings.favoriteScopes = ['00_Inbox/家族の予定.md'];
  const picker = new f.ScopePicker(f.app, f.plugin, () => {});
  const titles = () => [...picker.getItems().map(item => item.title)];
  assert.deepEqual(titles(), ['すべてのノート', '家族の予定', '機器整備']);
  picker.showDone = true; assert.deepEqual(titles(), ['すべてのノート', '家族の予定', '機器整備', '終わった件']);
  picker.showDone = false; picker.status = 'completed'; assert.deepEqual(titles(), ['すべてのノート', '終わった件']);
  picker.status = '\u0000none'; assert.deepEqual(titles(), ['すべてのノート', '家族の予定']);
  picker.status = '';
  assert.equal(picker.getItemText(picker.getItems()[2]), '機器整備 equipment');
  assert.equal(f.calls.enumerations, 1); picker.getItems(); assert.equal(f.calls.enumerations, 1);
  f.stop();
});
test('scope members are the note plus direct links both ways, including frontmatter-resolved links', async () => {
  const f = await fixture(0); const v = scopeVault(f);
  const members = f.scopeMembers(f.app, v.project.path);
  assert.deepEqual([...members].sort(), [v.linked.path, v.daily.path, v.project.path].sort());
  f.stop();
});
test('scoped home filters before the 300 cap, puts the Project note first and keeps Bases order', async () => {
  const f = await fixture(0); const v = scopeVault(f);
  f.plugin.setScope(v.project.path); f.doc.flush();
  const paths = f.view.grid.children.map(el => el.dataset.path);
  assert.deepEqual(paths, [v.project.path, v.daily.path, v.linked.path]);
  assert.equal(f.view.status.textContent, '3 / 3件');
  f.plugin.setScope(null); f.doc.flush();
  assert.equal(f.view.total, 404); assert.equal(f.view.grid.children.length, 24);
  f.stop();
});
test('choosing in the picker scopes the home; すべて clears it; scope bar shows state', async () => {
  const f = await fixture(0); const v = scopeVault(f); f.refresh();
  f.plugin.openScopePicker(); const picker = f.modals.pop();
  picker.onChooseItem(picker.getItems().find(item => item.path === v.project.path)); f.doc.flush();
  assert.equal(f.plugin.scope, v.project.path);
  const text = el => [el.textContent, ...el.children.map(text)].join('');
  assert.match(text(f.view.scopeBar), /機器整備」とつながるノート/);
  picker.onChooseItem(picker.getItems()[0]); f.doc.flush();
  assert.equal(f.plugin.scope, null); assert.equal(f.view.total, 404);
  f.stop();
});
test('notes tagged with the Project name (or a part of a nested tag) are in it by default; the checkbox drops them', async () => {
  const f = await fixture(0); const v = scopeVault(f);
  const tagged = new TFile('00_Inbox/タグのメモ.md', 100, 6); f.files.set(tagged.path, tagged);
  f.metadata.set(tagged.path, { tags: [{ tag: '#PKM/機器_整備' }] });
  const other = new TFile('00_Inbox/別のタグ.md', 100, 6); f.files.set(other.path, other);
  f.metadata.set(other.path, { frontmatter: { tags: ['機器'] } });
  f.view.data.groupedData[0].entries.unshift({ file: tagged }, { file: other });
  f.refresh(); f.plugin.setScope(v.project.path); f.doc.flush();
  const paths = () => f.view.files.map(file => file.path);
  assert.ok(paths().includes(tagged.path)); assert.equal(paths().includes(other.path), false);
  assert.equal(paths()[0], v.project.path);
  f.view.includeTagged = false; f.view.refreshWindow(); f.doc.flush();
  assert.equal(paths().includes(tagged.path), false);
  f.stop();
});
test('favorites toggle, persist, follow renames and drop deleted notes', async () => {
  const f = await fixture(0); const v = scopeVault(f);
  f.plugin.toggleFavorite(v.project.path); await f.plugin.saveChain;
  assert.deepEqual([...f.app.saved.favoriteScopes], [v.project.path]);
  f.plugin.setScope(v.project.path);
  const renamed = new TFile('10_Notes/Projects/機器整備2026.md'); f.files.set(renamed.path, renamed);
  f.plugin.followRename(renamed, v.project.path); await f.plugin.saveChain;
  assert.deepEqual([...f.plugin.settings.favoriteScopes], [renamed.path]); assert.equal(f.plugin.scope, renamed.path);
  f.plugin.followDelete(renamed); await f.plugin.saveChain;
  assert.deepEqual([...f.app.saved.favoriteScopes], []); assert.equal(f.plugin.scope, null);
  f.plugin.toggleFavorite(v.daily.path); f.plugin.toggleFavorite(v.daily.path); await f.plugin.saveChain;
  assert.deepEqual([...f.app.saved.favoriteScopes], []);
  f.stop();
});
test('saved favorites are sanitized on load and a missing scope note is ignored', async () => {
  const h = load(); const a = appDouble(h.doc, 0);
  a.app.saved = { favoriteScopes: ['a.md', 'a.md', 42, 'b.base', 'x'.repeat(2000) + '.md'] };
  const plugin = new h.Main(a.app); await plugin.onload();
  assert.deepEqual([...plugin.settings.favoriteScopes], ['a.md']);
  plugin.setScope('a.md'); assert.equal(plugin.scope, null);
  plugin.onunload();
});

function withDaily(f) { f.app.internalPlugins = { plugins: { 'daily-notes': { instance: { options: { folder: '01_Daily' } } } } }; }
const labelText = el => [el.textContent, ...el.children.map(labelText)].join('');
function findCheckbox(root, text) {
  const walk = el => el.tagName === 'label' && labelText(el).includes(text) ? el : el.children.map(walk).find(Boolean);
  return walk(root)?.children.find(c => c.tagName === 'input');
}
test('日誌を含む is on by default and turning it off hides daily notes, but never the Project note', async () => {
  const f = await fixture(0); const v = scopeVault(f); withDaily(f); f.refresh();
  const box = findCheckbox(f.view.scopeBar, '日誌を含む'); assert.equal(box.checked, true);
  box.checked = false; box.emit('change');
  assert.equal(f.view.total, 403);
  f.plugin.setScope(v.project.path); f.doc.flush();
  assert.deepEqual([...f.view.files.map(file => file.path)], [v.project.path, v.linked.path]);
  f.stop();
});
test('unlinked mentions are off by default and, when on, add notes naming the Project or its alias', async () => {
  const f = await fixture(0); const v = scopeVault(f);
  f.bodies.set('bulk/3.md', 'きょうは機器整備の打合せ'); f.bodies.set('bulk/7.md', 'EQUIPMENT list');
  f.plugin.setScope(v.project.path); f.doc.flush(); await f.pump();
  assert.equal(f.calls.reads.filter(p => p.startsWith('bulk/')).length, 0);
  const box = findCheckbox(f.view.scopeBar, 'リンクなしで名前を含む'); box.checked = true; box.emit('change');
  for (let i = 0; i < 20; i++) await f.pump();
  assert.ok(f.view.scans.mentions.done);
  const paths = [...f.view.files.map(file => file.path)];
  assert.ok(paths.includes('bulk/3.md') && paths.includes('bulk/7.md')); assert.equal(paths[0], v.project.path);
  assert.equal(f.view.total, 5); assert.match(f.view.status.textContent, /名前を含むノート2件/);
  f.stop();
});
test('body search inside a Project reads only its notes and narrows the cards', async () => {
  const f = await fixture(0); const v = scopeVault(f);
  f.bodies.set(v.daily.path, '機器の点検予定'); f.bodies.set(v.linked.path, '手順書');
  f.plugin.setScope(v.project.path); f.doc.flush();
  f.view.setBodyQuery('点検'); f.clock.tick(); for (let i = 0; i < 10; i++) await f.pump();
  assert.deepEqual([...f.view.files.map(file => file.path)], [v.daily.path]);
  assert.deepEqual([...new Set(f.calls.reads)].sort(), [v.daily.path, v.linked.path, v.project.path].sort());
  f.plugin.setScope(null); f.doc.flush(); assert.equal(f.view.bodyQuery, ''); assert.equal(f.view.total, 404);
  f.stop();
});

// Unified search (trial)
function searchVault(f) {
  const note = (p, aliases, mtime = 1) => { const file = new TFile(p, 100, mtime); f.files.set(p, file); if (aliases) f.metadata.set(p, { frontmatter: { aliases } }); return file; };
  note('10_Notes/Projects/機器整備_駒込2026.md', ['機器整備'], 3);
  note('00_Inbox/R7機器整備.md', null, 9);
  note('00_Inbox/整備機器リスト.md', null, 5);
  note('00_Inbox/ANA SFC.md', ['エーエヌエー'], 2);
  note('00_Inbox/カタカナのメモ.md', null, 1);
  note('99_System/PKM 今日.md', null, 99);
  f.recentFiles.push('99_System/PKM 今日.md', '00_Inbox/ANA SFC.md', 'missing.md', '00_Inbox/R7機器整備.md');
}
const titles = rows => [...rows.map(r => r.kind === 'note' ? r.file.basename : `${r.kind}:${r.text}`)];

test('search text ignores full/half width, case, and hiragana/katakana differences', () => {
  const { normalizeSearch } = load();
  assert.equal(normalizeSearch('ＡＮＡ'), 'ana'); assert.equal(normalizeSearch('カタカナ'), 'かたかな');
  assert.equal(normalizeSearch('ｶﾀｶﾅ'), 'かたかな'); assert.equal(normalizeSearch('ｱｲｳ ABC'), 'あいう abc');
});
test('empty query offers recently opened notes, skipping excluded folders and missing files', async () => {
  const f = await fixture(0); searchVault(f); const s = new f.UnifiedSearch(f.app, f.plugin);
  assert.deepEqual(titles(s.getSuggestions('')), ['ANA SFC', 'R7機器整備']);
  f.stop();
});
test('typing puts 本文を検索 first, then title/alias matches: all words, prefix first, title over alias, recent', async () => {
  const f = await fixture(0); searchVault(f); const s = new f.UnifiedSearch(f.app, f.plugin);
  assert.deepEqual(titles(s.getSuggestions('機器 整備')), ['body:機器 整備', '機器整備_駒込2026', 'R7機器整備', '整備機器リスト', 'create:機器 整備']);
  assert.deepEqual(titles(s.getSuggestions('えーえぬ')), ['body:えーえぬ', 'ANA SFC', 'create:えーえぬ']);
  assert.deepEqual(titles(s.getSuggestions('かたかな')), ['body:かたかな', 'カタカナのメモ', 'create:かたかな']);
  assert.equal(titles(s.getSuggestions('PKM')).includes('PKM 今日'), false);
  f.stop();
});
test('fuzzy match is used only when no note contains every word', async () => {
  const f = await fixture(0); searchVault(f); const s = new f.UnifiedSearch(f.app, f.plugin);
  // Letters in order: both 機器整備 notes match (recently opened first); 整備機器リスト does not.
  assert.deepEqual(titles(s.getSuggestions('機整')), ['body:機整', 'R7機器整備', '機器整備_駒込2026', 'create:機整']);
  f.stop();
});
test('create row is offered only when no note has exactly that name', async () => {
  const f = await fixture(0); searchVault(f); const s = new f.UnifiedSearch(f.app, f.plugin);
  assert.equal(titles(s.getSuggestions('r7機器整備')).some(t => t.startsWith('create:')), false);
  f.stop();
});
test('Enter on the first row opens the body search; choosing a note opens it', async () => {
  const f = await fixture(0); searchVault(f); const s = new f.UnifiedSearch(f.app, f.plugin);
  const rows = s.getSuggestions('機器 整備');
  s.selectSuggestion(rows[0], { key: 'Enter' }); assert.ok(f.modals.at(-1) instanceof f.BodySearch); assert.equal(f.modals.at(-1).initial, '機器 整備'); assert.deepEqual([...f.urls], []);
  s.selectSuggestion(rows[1], { key: 'Enter' }); await settle();
  assert.equal(f.calls.opens.at(-1), '10_Notes/Projects/機器整備_駒込2026.md');
  f.stop();
});
test('create makes a sanitized note in the new-note folder and opens it', async () => {
  const f = await fixture(0); searchVault(f); const s = new f.UnifiedSearch(f.app, f.plugin);
  const create = s.getSuggestions('会議: 9/27').find(r => r.kind === 'create');
  s.selectSuggestion(create, {}); await settle(); await settle();
  assert.ok(f.files.has('00_Inbox/会議 9 27.md')); assert.equal(f.calls.opens.at(-1), '00_Inbox/会議 9 27.md');
  f.stop();
});
test('Shift+Enter makes the note named by the words whatever row is selected; the create row shows the key', async () => {
  const f = await fixture(0); searchVault(f); const s = new f.UnifiedSearch(f.app, f.plugin);
  const shiftEnter = s.scope.keys.find(k => k.modifiers.join() === 'Shift' && k.key === 'Enter');
  s.inputEl.value = '  ';
  shiftEnter.func({ preventDefault() {} }); await settle();
  assert.equal(s.closed, undefined);
  s.inputEl.value = ' 新しい会議 ';
  assert.equal(shiftEnter.func({ preventDefault() {} }), false); await settle(); await settle();
  assert.equal(s.closed, true); assert.ok(f.files.has('00_Inbox/新しい会議.md'));
  const create = s.getSuggestions('別の会議').find(r => r.kind === 'create');
  const el = f.doc.createElement('div'); s.renderSuggestion(create, el);
  assert.deepEqual(el.children.map(c => c.textContent), ['新規作成：「別の会議」', 'Shift+Enter']);
  f.stop();
});
test('Various Complements words complete the last word and keep the screen open; absent index yields nothing', async () => {
  const f = await fixture(0); searchVault(f); const s = new f.UnifiedSearch(f.app, f.plugin);
  assert.equal(titles(s.getSuggestions('委員')).some(t => t.startsWith('word:')), false);
  f.app.plugins = { plugins: { 'various-complements': { suggester: { indexedWords: {
    currentVault: { '委': [{ value: '委員会' }, { value: '委員' }, { value: '委託' }] }, customDictionary: {}, currentFile: null } } } } };
  const word = s.getSuggestions('機器 委員').find(r => r.kind === 'word');
  assert.equal(word.text, '委員会');
  s.inputEl.value = '機器 委員'; s.selectSuggestion(word, {});
  assert.equal(s.inputEl.value, '機器 委員会 '); assert.equal(s.closed, undefined); assert.equal(s.inputEl.inputs, 1);
  f.app.plugins.plugins['various-complements'].suggester = { indexedWords: 'broken' };
  assert.deepEqual(titles(s.getSuggestions('委員')).filter(t => t.startsWith('word:')), []);
  f.stop();
});
test('the 検索 button and Cmd+G always open the unified search, even with an old external-search setting', async () => {
  const f = await fixture(0); f.app.saved = { searchMode: 'separate', searchCommand: 'omnisearch:show-modal' };
  const again = new f.Main(f.app); await again.onload(); again.openSearch();
  assert.ok(f.modals.at(-1) instanceof f.UnifiedSearch); assert.equal(f.calls.commands.length, 0);
  assert.deepEqual([...again.settings.searchExcludeFolders], ['99_System']); again.onunload();
  f.stop();
});
test('with the light popup off, cards join page preview / Hover Editor through the standard hover-link event, Cmd by default', async () => {
  const f = await fixture(3); f.plugin.settings.cardPopover = false; f.refresh();
  assert.equal(f.plugin.hoverSources['palmwiki-home'].defaultMod, true);
  const card = f.view.grid.children[1];
  card.emit('mouseover', { metaKey: true });
  const hover = f.calls.triggers.at(-1);
  assert.equal(hover.name, 'hover-link'); assert.equal(hover.info.source, 'palmwiki-home');
  assert.equal(hover.info.linktext, card.dataset.path); assert.equal(hover.info.targetEl, card); assert.equal(hover.info.hoverParent, f.view);
  assert.equal(f.calls.reads.length, 0); // announcing a hover reads nothing
  f.stop();
});
test('Cmd+hover on a card shows the light popup beside it; a click inside hands over to Hover Editor', async () => {
  const f = await fixture(3); f.refresh();
  assert.equal(f.plugin.hoverSources['palmwiki-home-edit'].defaultMod, false);
  const card = f.view.grid.children[1]; card.rect = { top: 100, bottom: 320, left: 300, right: 500, width: 200, height: 220 };
  card.emit('mouseover', {}); f.clock.tick(); await settle();
  assert.equal(f.doc.body.children.length, 0); // no Cmd, no popup
  card.emit('mouseover', { metaKey: true }); f.clock.tick(); await settle(); await settle();
  const popup = f.doc.body.children[0];
  assert.equal(popup.className, 'palmwiki-card-popover');
  const [row, previewEl] = popup.children;
  assert.equal(row.className, 'palmwiki-popover-cards'); assert.equal(row.hidden, true); // no links in this fixture
  assert.deepEqual({ ...popup.style }, { left: '480px', top: '300px', width: '520px', height: '440px' }); // below-right, over the corner
  // Near the bottom right of the window: above-left, clear of the card's row.
  const place = rect => { const el = f.doc.createElement('div'); const t = f.doc.createElement('div'); t.rect = rect; f.plugin.cardPopover.place(el, t, true); return [el.style.left, el.style.top]; };
  assert.deepEqual(place({ top: 600, bottom: 820, left: 1100, right: 1300 }), ['600px', '180px']);
  assert.deepEqual(place({ top: 500, bottom: 720, left: 300, right: 500 }), ['480px', '80px']); // above-right
  assert.equal(previewEl.children[0].textContent, f.plugin.cardPopover.card.file.basename);
  assert.equal(f.calls.triggers.length, 0); // Hover Editor is not asked while the light popup is used
  previewEl.emit('click', { target: previewEl });
  assert.equal(f.doc.body.children.length, 0);
  const hover = f.calls.triggers.at(-1);
  assert.equal(hover.name, 'hover-link'); assert.equal(hover.info.source, 'palmwiki-home-edit');
  assert.equal(hover.info.targetEl, card); assert.equal(hover.info.hoverParent, f.view);
  assert.equal(hover.info.event.metaKey, true); // passes even when Page preview requires Cmd
  assert.deepEqual([hover.info.event.clientX, hover.info.event.clientY], [0, -20]); // where the light popup was (fake rect)
  f.stop();
});
test('once a popup is open, pointing at another card switches it; Cmd on a link inside opens the next popup', async () => {
  const f = await fixture(3); f.refresh();
  const [, first, second] = f.view.grid.children;
  first.emit('mouseover', { metaKey: true }); f.clock.tick(); await settle();
  const popover = f.plugin.cardPopover;
  assert.equal(popover.card.anchor, first);
  first.emit('mouseleave'); second.emit('mouseover', {}); f.clock.tick(200); await settle();
  assert.equal(popover.card.anchor, second); assert.equal(f.doc.body.children.length, 1);
  const target = [...f.files.values()].find(file => file.path !== popover.card.file.path && file.extension === 'md');
  const link = f.doc.createElement('a'); link.dataset.href = target.path;
  const popup = f.doc.body.children[0];
  popup.emit('mouseover', { target: { closest: () => link } }); f.clock.tick(); await settle();
  assert.equal(f.doc.body.children.length, 1); // no Cmd, no popup for the link
  popup.emit('mouseover', { target: { closest: () => link }, metaKey: true }); f.clock.tick(); await settle();
  assert.equal(f.doc.body.children.length, 2); assert.equal(popover.stack[1].file, target); assert.equal(popover.stack[1].anchor, link);
  const deeper = f.doc.body.children[1].children[1]; deeper.emit('click', { target: deeper });
  assert.equal(f.doc.body.children.length, 0);
  assert.equal(f.calls.triggers.at(-1).info.linktext, target.path); assert.equal(f.calls.triggers.at(-1).info.targetEl, second); // the card anchors it
  assert.deepEqual(f.app.keymap.scopes, []);
  f.stop();
});
test('a popup shows the note\'s links and backlinks as a row, newest first; Cmd on a row card opens the next popup focused on the way back', async () => {
  const f = await fixture(0); const v = scopeVault(f); f.refresh();
  const popover = f.plugin.cardPopover;
  // 機器整備 links to 手順 (mtime 7) and is linked from 2026-09-27 (mtime 9).
  assert.deepEqual([...popover.related(v.project).map(file => file.basename)], ['2026-09-27', '手順']);
  const home = f.view.grid.children.find(card => card.dataset.path === v.project.path);
  home.emit('mouseover', { metaKey: true }); f.clock.tick(); await settle();
  const [row] = f.doc.body.children[0].children;
  assert.equal(row.hidden, false);
  assert.deepEqual(row.children.map(card => card.children[0].textContent), ['2026-09-27', '手順']);
  const daily = row.children[0];
  f.doc.body.children[0].emit('mouseover', { target: { closest: sel => (sel === '.palmwiki-popover-card' ? daily : null) }, metaKey: true });
  f.clock.tick(); await settle();
  assert.equal(popover.stack.length, 2); assert.equal(popover.stack[1].file, v.daily); assert.equal(popover.stack[1].anchor, daily);
  daily.emit('click', { preventDefault() {} }); await settle();
  assert.equal(f.doc.body.children.length, 0); // a row card opens its note
  f.stop();
});
test('while a tab loads a new note or Home, the header shows its name instead of 「ファイルがありません」; unloading unwraps', async () => {
  const f = await fixture(0);
  const { FileView, WorkspaceLeaf } = f;
  const leaf = new WorkspaceLeaf(); let finish; leaf.loading = new Promise(r => { finish = r; });
  const view = new FileView(); view.leaf = leaf; view.file = null;
  const opening = leaf.setViewState({ type: 'markdown', state: { file: '10_Notes/Projects/サブスク.md' } });
  assert.equal(view.getDisplayText(), 'サブスク');
  finish(); await opening; await settle();
  assert.equal(view.getDisplayText(), 'ファイルがありません'); // a file that failed to load says so again
  view.file = { basename: 'サブスク' }; assert.equal(view.getDisplayText(), 'サブスク');
  const wrapped = WorkspaceLeaf.prototype.setViewState;
  f.plugin.unload?.(); f.plugin.onunload(); for (const fn of f.plugin.disposers) fn();
  assert.notEqual(WorkspaceLeaf.prototype.setViewState, wrapped);
  f.stop();
});
test('popup timing and row side match 2hop-links-plus', () => {
  const { hoverOpenDelay, cardsBelowPreview } = load();
  const at = (trigger, isMod, buttons = 0, msSinceTyping = 5000) => hoverOpenDelay({ trigger, isMod, buttons, msSinceTyping });
  assert.equal(at('mod', true), 60); assert.equal(at('hover', true), 60); // Cmd opens quickly either way
  assert.equal(at('mod', false), null); assert.equal(at('hover', false), 300);
  assert.equal(at('hover', false, 1), null); assert.equal(at('hover', false, 0, 500), null); // dragging; just typed
  assert.deepEqual([cardsBelowPreview('above', true), cardsBelowPreview('below', false), cardsBelowPreview('auto', false), cardsBelowPreview('auto', true)], [false, true, true, false]);
});
test('hover only: a card opens once the pointer rests on it, not on a mouseover alone, and not while a button is down', async () => {
  const f = await fixture(3); f.plugin.settings.popupTrigger = 'hover'; f.refresh();
  const card = f.view.grid.children[1];
  card.emit('mouseover', {}); f.clock.tick(); await settle();
  assert.equal(f.doc.body.children.length, 0); // a card scrolled under the pointer opens nothing
  f.doc.emit('mousemove', { screenX: 1, target: card, buttons: 1 }); f.clock.tick(); await settle();
  assert.equal(f.doc.body.children.length, 0); // dragging or selecting
  f.doc.emit('mousemove', { screenX: 2, target: card, buttons: 0 }); f.clock.tick(); await settle();
  assert.equal(f.doc.body.children.length, 1); assert.equal(f.plugin.cardPopover.card.anchor, card);
  // Typing holds it back.
  f.plugin.cardPopover.close(); f.doc.emit('keydown', { key: 'a' });
  f.doc.emit('mousemove', { screenX: 3, target: card, buttons: 0 }); f.clock.tick(); await settle();
  assert.equal(f.doc.body.children.length, 0);
  f.stop();
});
test('going back onto a lower popup, away from the link that opened the next one, closes the next one after 0.25 s', async () => {
  const f = await fixture(3); f.refresh();
  const popover = f.plugin.cardPopover;
  const card = f.view.grid.children[1];
  card.emit('mouseover', { metaKey: true }); f.clock.tick(); await settle();
  const target = [...f.files.values()].find(file => file.path !== popover.card.file.path && file.extension === 'md');
  const link = f.doc.createElement('a'); link.dataset.href = target.path;
  const parent = f.doc.body.children[0]; parent.children[1].append(link);
  parent.emit('mouseover', { target: { closest: () => link }, metaKey: true }); f.clock.tick(); await settle();
  assert.equal(popover.stack.length, 2);
  f.doc.emit('mousemove', { screenX: 4, target: link }); f.clock.tick(); assert.equal(popover.stack.length, 2); // still on the link
  f.doc.emit('mousemove', { screenX: 5, target: parent.children[1] }); // elsewhere on the lower popup
  f.doc.emit('mousemove', { screenX: 6, target: f.doc.body.children[1].children[1] }); f.clock.tick(); // into the next popup: cancelled
  assert.equal(popover.stack.length, 2);
  f.doc.emit('mousemove', { screenX: 7, target: parent.children[1] }); f.clock.tick(300);
  assert.equal(popover.stack.length, 1); assert.equal(f.doc.body.children.length, 1);
  f.stop();
});
test('a mousemove without pointer movement (content scrolling under it) is ignored', async () => {
  const f = await fixture(3); f.plugin.settings.popupTrigger = 'hover'; f.refresh();
  const card = f.view.grid.children[1];
  card.emit('mouseover', {});
  f.doc.emit('mousemove', { screenX: 500, screenY: 300, target: f.doc.body, buttons: 0 });
  f.doc.emit('mousemove', { screenX: 500, screenY: 300, target: card, buttons: 0 }); f.clock.tick(); await settle();
  assert.equal(f.doc.body.children.length, 0); // the card only came under a still pointer
  f.doc.emit('mousemove', { screenX: 501, screenY: 300, target: card, buttons: 0 }); f.clock.tick(); await settle();
  assert.equal(f.doc.body.children.length, 1);
  f.stop();
});
test('the card popup closes after the pointer leaves, and goes with the view', async () => {
  const f = await fixture(3); f.refresh();
  const card = f.view.grid.children[1];
  card.emit('mouseover', { metaKey: true }); f.clock.tick(); await settle();
  assert.equal(f.doc.body.children.length, 1);
  card.emit('mouseleave'); f.clock.tick(); assert.equal(f.doc.body.children.length, 0);
  card.emit('mouseover', { metaKey: true }); f.clock.tick(); await settle();
  const popover = f.plugin.cardPopover; assert.equal(f.app.keymap.scopes.at(-1), popover.scope);
  assert.equal(popover.scope.keys.find(k => k.key === 'Escape').func(), false);
  assert.equal(f.doc.body.children.length, 0); assert.equal(f.app.keymap.scopes.includes(popover.scope), false);
  card.emit('mouseover', { metaKey: true }); f.clock.tick(); await settle();
  card.emit('click', { metaKey: true }); assert.equal(f.doc.body.children.length, 0); // Cmd+click opens a new tab; the popup goes
  card.emit('mouseover', { metaKey: true }); f.clock.tick(); await settle();
  f.view.dispose(); assert.equal(f.doc.body.children.length, 0);
  f.stop();
});


test('search preview pane shows the selected note (no frontmatter), hints for action rows, and follows the selection', async () => {
  const f = await fixture(0); searchVault(f); const s = new f.UnifiedSearch(f.app, f.plugin);
  f.bodies.set('10_Notes/Projects/機器整備_駒込2026.md', '---\ntags: [Projects]\n---\n# 計画\n本文A');
  f.bodies.set('00_Inbox/R7機器整備.md', '本文B');
  s.modalEl = f.doc.createElement('div'); s.modalEl.classList = { add() {}, remove() {} };
  const results = f.doc.createElement('div'); let selected = null; s.resultContainerEl = { querySelector: () => selected };
  s.onOpen(); assert.ok(s.pane);
  const rows = s.getSuggestions('機器 整備');
  const [body, a, b] = rows.slice(0, 3).map(row => { const el = f.doc.createElement('div'); s.renderSuggestion(row, el); return el; });
  const text = el => [el.textContent, ...el.children.map(text)].join('|');
  selected = body; s.pane.follow(); f.clock.tick(); await settle();
  assert.match(text(s.pane.el), /本文を検索します/);
  selected = a; s.pane.follow(); selected = b; s.pane.follow(); // fast moves settle on b
  f.clock.tick(); await settle(); await settle();
  assert.match(text(s.pane.el), /R7機器整備\|本文B/); assert.deepEqual([...f.rendered], ['本文B']);
  selected = a; s.pane.follow(); f.clock.tick(); await settle(); await settle();
  assert.match(text(s.pane.el), /機器整備_駒込2026\|# 計画\n本文A/); assert.equal(f.rendered.at(-1).startsWith('---'), false);
  const component = s.pane.preview.component; s.onClose(); assert.equal(component.loaded, false); assert.equal(s.pane, null);
  f.stop();
});
test('narrow screens (phones) build no search preview pane', async () => {
  const f = await fixture(0); const s = new f.UnifiedSearch(f.app, f.plugin);
  f.doc.defaultView.matchMedia = query => ({ matches: query !== '(min-width: 761px)' });
  s.modalEl = f.doc.createElement('div'); s.onOpen(); assert.equal(s.pane, null);
  f.stop();
});
test('without a chosen switcher (or with its plugin off on this device) Obsidian\'s quick switcher opens instead of a notice', async () => {
  const f = await fixture(0); const run = [];
  f.app.commands.listCommands = () => [{ id: 'switcher:open' }];
  f.app.commands.executeCommandById = id => { run.push(id); return true; };
  f.plugin.runExternal('switchCommand'); assert.deepEqual(run, ['switcher:open']); assert.equal(f.notices.length, 0);
  f.stop();
});
test('link rank puts notes linked from many (and from well-linked) notes first', () => {
  const { linkRanks } = load();
  const r = linkRanks({ 'a.md': { 'hub.md': 1 }, 'b.md': { 'hub.md': 1 }, 'c.md': { 'hub.md': 1, 'side.md': 1 }, 'hub.md': { 'end.md': 1 }, 'side.md': {}, 'end.md': {}, 'img.png': {} });
  assert.ok(r.get('hub.md') > r.get('side.md')); assert.ok(r.get('end.md') > r.get('side.md')); assert.ok(r.get('side.md') > r.get('a.md'));
  assert.equal(r.has('img.png'), false);
});
test('the body row opens PalmWiki\'s own body search, ordered by link rank, without keeping note text', async () => {
  const f = await fixture(0); searchVault(f);
  f.bodies.set('00_Inbox/ANA SFC.md', '修行のメモ\n機器のｾｲﾋﾞは別'); f.bodies.set('00_Inbox/カタカナのメモ.md', 'セイビ記録');
  f.bodies.set('00_Inbox/整備機器リスト.md', '一覧'); f.bodies.set('00_Inbox/R7機器整備.md', 'せいびする');
  f.app.metadataCache.resolvedLinks = { '00_Inbox/R7機器整備.md': { '00_Inbox/カタカナのメモ.md': 1 }, '00_Inbox/ANA SFC.md': { '00_Inbox/カタカナのメモ.md': 1 } };
  const u = new f.UnifiedSearch(f.app, f.plugin); u.selectSuggestion(u.getSuggestions('セイビ')[0], { key: 'Enter' });
  const s = f.modals.at(-1); assert.ok(s instanceof f.BodySearch);
  s.onOpen(); assert.equal(s.inputEl.value, 'セイビ');
  s.getSuggestions('セイビ'); for (let i = 0; i < 6; i++) await settle();
  const rows = s.getSuggestions('セイビ');
  assert.equal(rows[0].kind, 'status'); assert.match(rows[0].text, /本文に含むノート 3件/);
  // カタカナのメモ has two links in, so it comes first; the others tie on rank and go newest first.
  // Hiragana, katakana and half-width katakana all match after normalizing.
  assert.deepEqual([...rows.slice(1).map(r => r.file.basename)], ['カタカナのメモ', 'R7機器整備', 'ANA SFC']);
  assert.match(rows[3].snippet, /機器のｾｲﾋﾞは別/);
  s.selectSuggestion(rows[0], {}); assert.equal(s.closed, undefined); // the status line keeps the screen open
  s.selectSuggestion(rows[1], { key: 'Enter' }); await settle(); assert.equal(f.calls.opens.at(-1), '00_Inbox/カタカナのメモ.md');
  s.onClose(); assert.equal(s.scan.live, false);
  f.stop();
});
test('body search can be ordered newest first or by name, and its preview can be turned off', async () => {
  const f = await fixture(0); searchVault(f);
  for (const p of ['00_Inbox/ANA SFC.md', '00_Inbox/R7機器整備.md', '00_Inbox/カタカナのメモ.md']) f.bodies.set(p, 'せいび');
  f.app.metadataCache.resolvedLinks = { '00_Inbox/R7機器整備.md': { '00_Inbox/ANA SFC.md': 1 } };
  const run = async order => { f.plugin.settings.bodySearchOrder = order; const s = new f.BodySearch(f.app, f.plugin, 'せいび');
    s.getSuggestions('せいび'); for (let i = 0; i < 6; i++) await settle(); const names = [...s.getSuggestions('せいび').slice(1).map(r => r.file.basename)]; s.onClose(); return names; };
  assert.deepEqual(await run('rank'), ['ANA SFC', 'R7機器整備', 'カタカナのメモ']);
  assert.deepEqual(await run('modified'), ['R7機器整備', 'ANA SFC', 'カタカナのメモ']);
  assert.deepEqual(await run('name'), ['ANA SFC', 'R7機器整備', 'カタカナのメモ'].sort((a, b) => a.localeCompare(b, 'ja')));
  f.plugin.settings.searchPreview = false; const s = new f.BodySearch(f.app, f.plugin, 'x');
  s.modalEl = f.doc.createElement('div'); s.onOpen(); assert.equal(s.pane, null); s.onClose();
  f.plugin.settings.searchPreview = true; const t = new f.BodySearch(f.app, f.plugin, 'x');
  t.modalEl = f.doc.createElement('div'); t.modalEl.classList = { add() {}, remove() {} }; t.onOpen(); assert.ok(t.pane); t.onClose();
  f.stop();
});
test('empty pages connect the notes that share a [[語]], and weak sources pass on less', () => {
  const { linkRanks } = load();
  // a and b both link to the empty page 料理; c links to nothing.
  const r = linkRanks({ 'a.md': {}, 'b.md': {}, 'c.md': {} }, { 'a.md': { 料理: 1 }, 'b.md': { 料理: 1 } });
  assert.ok(r.get('a.md') > r.get('c.md')); assert.equal(r.has('料理'), false);
  const links = { 'd/1.md': { 'x.md': 1 }, 'd/2.md': { 'x.md': 1 }, 'y1.md': { 'y.md': 1 }, 'y2.md': { 'y.md': 1 }, 'x.md': {}, 'y.md': {} };
  const weak = linkRanks(links, {}, { weakSources: p => p.startsWith('d/') });
  assert.ok(weak.get('y.md') > weak.get('x.md')); // the same two links in, but x's come from daily-like notes
});
test('folders set to sort lower, and daily notes, change the link rank (on by default)', async () => {
  const f = await fixture(0); withDaily(f);
  f.app.metadataCache.resolvedLinks = { '01_Daily/a.md': { 'x.md': 1 }, '01_Daily/b.md': { 'x.md': 1 }, 'p.md': { 'y.md': 1 }, 'q.md': { 'y.md': 1 },
    'r.md': { '04_Archives/z.md': 1 }, 's.md': { '04_Archives/z.md': 1 }, 'x.md': {}, 'y.md': {}, '04_Archives/z.md': {} };
  f.app.metadataCache.unresolvedLinks = {};
  let r = f.plugin.linkRanks(); assert.ok(r.get('y.md') > r.get('x.md')); assert.ok(r.get('y.md') > 5 * r.get('04_Archives/z.md'));
  f.plugin.settings.rankWeakDaily = false; f.plugin.settings.rankDownFolders = []; f.plugin.rankCache = null;
  r = f.plugin.linkRanks(); assert.ok(Math.abs(r.get('y.md') - r.get('x.md')) < 1e-12); assert.ok(Math.abs(r.get('y.md') - r.get('04_Archives/z.md')) < 1e-12);
  f.stop();
});
test('notes that link to the search word come before notes that only contain it inside another word', async () => {
  const f = await fixture(0); searchVault(f);
  f.bodies.set('00_Inbox/ANA SFC.md', '[[クリオプレシピテート]]の準備'); f.metadata.set('00_Inbox/ANA SFC.md', { links: [{ link: 'クリオプレシピテート' }] }); f.bodies.set('00_Inbox/カタカナのメモ.md', '[[しそバターレシピ]]');
  f.bodies.set('00_Inbox/R7機器整備.md', '今日の[[レシピ]]');
  f.metadata.set('00_Inbox/カタカナのメモ.md', { links: [{ link: 'しそバターレシピ' }] });
  f.metadata.set('00_Inbox/R7機器整備.md', { links: [{ link: 'レシピ#材料' }] });
  f.app.metadataCache.resolvedLinks = { 'x.md': { '00_Inbox/ANA SFC.md': 1 }, 'y.md': { '00_Inbox/ANA SFC.md': 1 } }; // the most linked note
  const s = new f.BodySearch(f.app, f.plugin, 'れしぴ'); s.getSuggestions('れしぴ'); for (let i = 0; i < 6; i++) await settle();
  const rows = s.getSuggestions('れしぴ');
  assert.deepEqual([...rows.slice(1).map(r => r.file.basename)], ['R7機器整備', 'カタカナのメモ', 'ANA SFC']);
  const el = f.doc.createElement('div'); s.renderSuggestion(rows[1], el);
  const all = e => [e.textContent, ...e.children.map(all)].join('|');
  assert.match(all(el), /\[\[れしぴ\]\] へのリンクあり/);
  s.onClose(); f.stop();
});
test('match ranges map folded words back to the text as written', () => {
  const { matchRanges } = load();
  assert.deepEqual([...matchRanges('機器のセイビ記録とｾｲﾋﾞ', ['せいび']).map(r => [...r])], [[3, 6], [9, 13]]);
  assert.deepEqual([...matchRanges('ＡＮＡ SFC', ['ana', 'sfc']).map(r => [...r])], [[0, 3], [4, 7]]);
  assert.equal(matchRanges('なし', ['あり']).length, 0);
});
test('only matches in note text are highlighted, not in titles', async () => {
  const f = await fixture(0); searchVault(f);
  const marked = el => { const out = []; const walk = e => { if (String(e.className).includes('suggestion-highlight')) out.push(e.textContent); e.children.forEach(walk); }; walk(el); return out; };
  const u = new f.UnifiedSearch(f.app, f.plugin); u.inputEl.value = '整備';
  const row = u.getSuggestions('整備').find(r => r.kind === 'note' && r.file.basename === 'R7機器整備');
  const el = f.doc.createElement('div'); u.renderSuggestion(row, el); assert.deepEqual(marked(el), []);
  f.bodies.set('00_Inbox/カタカナのメモ.md', 'セイビ記録'); f.bodies.set('00_Inbox/R7機器整備.md', 'なし');
  const s = new f.BodySearch(f.app, f.plugin, 'せいび'); s.getSuggestions('せいび'); for (let i = 0; i < 6; i++) await settle();
  const hit = s.getSuggestions('せいび')[1]; const el2 = f.doc.createElement('div'); s.renderSuggestion(hit, el2);
  assert.deepEqual(marked(el2), ['セイビ']); // in the excerpt
  const title = el2.children.find(c => c.className === 'palmwiki-search-title'); assert.equal(title.textContent, 'カタカナのメモ'); assert.equal(title.children.length, 0);
  s.onClose(); f.stop();
});
test('a new query stops the earlier body search', async () => {
  const f = await fixture(0); searchVault(f); const s = new f.BodySearch(f.app, f.plugin, '機器');
  s.getSuggestions('機器'); const first = s.scan; s.getSuggestions('整備'); assert.equal(first.live, false);
  // The new words are read once typing pauses (0.3 s).
  assert.equal(s.scan.query, '機器'); f.clock.tick(299); assert.equal(s.scan.query, '機器'); f.clock.tick(300); assert.equal(s.scan.query, '整備');
  s.onClose(); f.stop();
});
test('search preview can be turned off in settings', async () => {
  const f = await fixture(0); f.plugin.settings.searchPreview = false; const s = new f.UnifiedSearch(f.app, f.plugin);
  s.modalEl = f.doc.createElement('div'); s.onOpen(); assert.equal(s.pane, null);
  f.stop();
});

test('touch hold opens a readable modal, consumes the release click, and opens only via the explicit button', async () => {
  const f = await fixture(1); f.refresh();
  const card = f.view.cards.get('0.md').el;
  const down = { pointerType: 'touch', pointerId: 1, clientX: 20, clientY: 20, isPrimary: true, button: 0 };
  card.emit('pointerdown', down); f.clock.tick(500); await settle();
  const modal = f.modals.at(-1);
  assert.ok(modal); assert.equal(modal.preview.file.path, '0.md');
  card.emit('pointerup', down); card.emit('click');
  assert.deepEqual(f.calls.opens, []);
  modal.contentEl.children[0].children[0].emit('click');
  assert.ok(modal.closed); assert.equal(modal.preview, null);
  assert.deepEqual(f.calls.opens, ['0.md']);
  f.stop();
});
test('touch hold cancels on release, movement, scroll, pointer cancellation, card removal, and unload', async () => {
  for (const reason of ['release', 'move', 'scroll', 'cancel', 'remove', 'unload', 'mouse']) {
    const f = await fixture(1); f.refresh(); const record = f.view.cards.get('0.md'); const card = record.el;
    card.emit('pointerdown', { pointerType: reason === 'mouse' ? 'mouse' : 'touch', pointerId: 1, clientX: 20, clientY: 20, button: 0 });
    if (reason === 'release') card.emit('pointerup');
    if (reason === 'move') card.emit('pointermove', { pointerId: 1, clientX: 20, clientY: 40 });
    if (reason === 'scroll') f.parent.emit('scroll');
    if (reason === 'cancel') card.emit('pointercancel');
    if (reason === 'remove') f.view.removeCard(record);
    if (reason === 'unload') f.stop();
    f.clock.tick(500); await settle();
    assert.equal(f.modals.length, 0, reason);
    if (reason === 'release') { card.emit('click'); assert.deepEqual(f.calls.opens, ['0.md']); }
    if (reason !== 'unload') f.stop();
  }
});
test('closing the touch modal keeps Home and the next short tap opens normally', async () => {
  const f = await fixture(1); f.refresh(); const card = f.view.cards.get('0.md').el;
  const down = { pointerType: 'touch', pointerId: 1, clientX: 20, clientY: 20 };
  card.emit('pointerdown', down); f.clock.tick(500); await settle();
  const modal = f.modals.at(-1); modal.contentEl.children[0].children[1].emit('click');
  assert.ok(modal.closed); assert.equal(f.calls.opens.length, 0);
  card.emit('pointerdown', down); card.emit('pointerup'); card.emit('click');
  assert.deepEqual(f.calls.opens, ['0.md']); f.stop();
});

test('paste: quote prefix and the edits that keep pasted lines in the quote', () => {
  const t = load();
  assert.equal(t.quotePrefix('> 引用'), '> ');
  assert.equal(t.quotePrefix('  > > 二重'), '  > > ');
  assert.equal(t.quotePrefix('本文'), '');
  const edits = t.quoteEdits(['二行目', '', '> 既に引用', '四行目'], 3, 7, '> ');
  assert.deepEqual([...edits].map(e => ({ ...e })), [
    { line: 4, insert: '> ' }, { line: 5, insert: '>' }, { line: 7, insert: '> ' },
  ]);
  assert.equal(t.quoteEdits(['x'], 0, 1, '').length, 0);
});

test('paste: YouTube URLs become the form the embed reads; others are left alone', () => {
  const t = load();
  assert.equal(t.videoEmbedUrl('https://www.youtube.com/watch?v=aqz-KE-bpKQ&t=30'), 'https://www.youtube.com/watch?v=aqz-KE-bpKQ&t=30');
  assert.equal(t.videoEmbedUrl(' https://youtu.be/aqz-KE-bpKQ?si=x \n'), 'https://youtu.be/aqz-KE-bpKQ?si=x');
  assert.equal(t.videoEmbedUrl('https://m.youtube.com/watch?v=aqz-KE-bpKQ'), 'https://m.youtube.com/watch?v=aqz-KE-bpKQ');
  assert.equal(t.videoEmbedUrl('https://www.youtube.com/shorts/aqz-KE-bpKQ'), 'https://www.youtube.com/watch?v=aqz-KE-bpKQ');
  assert.equal(t.videoEmbedUrl('https://www.youtube.com/live/aqz-KE-bpKQ?feature=share'), 'https://www.youtube.com/watch?v=aqz-KE-bpKQ');
  assert.equal(t.videoEmbedUrl('https://www.youtube.com/@channel'), '');
  assert.equal(t.videoEmbedUrl('見て https://youtu.be/aqz-KE-bpKQ'), '');
  assert.equal(t.videoEmbedUrl('https://example.com/watch?v=1'), '');
  assert.ok(t.isTweetUrl('https://x.com/obsdmd/status/1580548874246443010?s=20'));
  assert.ok(t.isTweetUrl('https://twitter.com/a/status/1'));
  assert.ok(!t.isTweetUrl('https://x.com/obsdmd'));
});

test('paste: an embed only where the line has no text of its own', () => {
  const t = load();
  assert.ok(t.emptyLineAt('', ''));
  assert.ok(t.emptyLineAt('- ', ''));
  assert.ok(t.emptyLineAt('  1. ', ' '));
  assert.ok(t.emptyLineAt('> ', ''));
  assert.ok(!t.emptyLineAt('動画は', ''));
  assert.ok(!t.emptyLineAt('', 'あと'));
});

test('paste: page titles from og:title or <title>, decoded, and the link escapes brackets', async () => {
  const t = load();
  assert.equal(t.pageTitle('<head><title>Site &amp; Page</title><meta property="og:title" content="記事 &#x300C;題&#x300D;"></head>'), '記事 「題」');
  assert.equal(t.pageTitle('<title>\n  Only   title </title>'), 'Only title');
  assert.equal(t.pageTitle('<p>none</p>'), '');
  assert.equal(t.titledLink('a [b]', 'https://e.com/x'), '[a \\[b\\]](https://e.com/x)');
  assert.equal(t.titledLink('t', 'https://e.com/a_(b)'), '[t](<https://e.com/a_(b)>)');
  assert.equal(t.pageCharset('text/html; charset=Shift_JIS', new Uint8Array()), 'shift_jis');
  const bytes = new TextEncoder().encode('<meta charset="euc-jp"><title>x</title>');
  assert.equal(t.pageCharset('text/html', bytes), 'euc-jp');
  const html = new TextEncoder().encode('<title>見出し</title>').buffer;
  assert.equal(await t.fetchPageTitle('https://e.com', async () => ({ status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, arrayBuffer: html })), '見出し');
  assert.equal(await t.fetchPageTitle('https://e.com', async () => ({ status: 404, headers: {}, arrayBuffer: html })), '');
  assert.equal(await t.fetchPageTitle('https://e.com/a.pdf', async () => ({ status: 200, headers: { 'content-type': 'application/pdf' }, arrayBuffer: html })), '');
  assert.equal(await t.fetchPageTitle('https://e.com', async () => { throw new Error('offline'); }), '');
});

function editorDouble(lines, cursor) {
  const ed = { lines: [...lines], cursor: { ...cursor }, replaced: null, changes: null,
    getCursor() { return { ...ed.cursor }; }, getLine(i) { return ed.lines[i]; },
    replaceSelection(text) { ed.replaced = text; },
    transaction({ changes }) { ed.changes = changes; for (const c of changes) ed.lines[c.from.line] = c.text + ed.lines[c.from.line]; } };
  return ed;
}

test('paste: Cmd+V of a YouTube URL on an empty line embeds it; inside a sentence it does not', () => {
  const { Main } = load();
  const self = { settings: { cosensePaste: true }, continueQuote: Main.prototype.continueQuote };
  const ev = text => { const e = { defaultPrevented: false, clipboardData: { getData: () => text } }; e.preventDefault = () => { e.defaultPrevented = true; }; return e; };
  let ed = editorDouble(['- '], { line: 0, ch: 2 });
  let e = ev('https://www.youtube.com/shorts/aqz-KE-bpKQ');
  Main.prototype.onPaste.call(self, e, ed);
  assert.ok(e.defaultPrevented);
  assert.equal(ed.replaced, '![](https://www.youtube.com/watch?v=aqz-KE-bpKQ)');
  ed = editorDouble(['動画は '], { line: 0, ch: 4 });
  e = ev('https://youtu.be/aqz-KE-bpKQ');
  Main.prototype.onPaste.call(self, e, ed);
  assert.ok(!e.defaultPrevented);
  assert.equal(ed.replaced, null);
  self.settings.cosensePaste = false;
  ed = editorDouble([''], { line: 0, ch: 0 });
  e = ev('https://youtu.be/aqz-KE-bpKQ');
  Main.prototype.onPaste.call(self, e, ed);
  assert.ok(!e.defaultPrevented);
});

test('paste: after Obsidian pastes into a quote line, the added lines join the quote', () => {
  const { Main, clock } = load();
  const self = { settings: { cosensePaste: true }, continueQuote: Main.prototype.continueQuote };
  const ed = editorDouble(['> 一行目', '二行目', '', '三行目', '後ろの段落'], { line: 0, ch: 2 });
  const e = { defaultPrevented: false, clipboardData: { getData: () => '一行目\n二行目\n\n三行目' }, preventDefault() { this.defaultPrevented = true; } };
  Main.prototype.onPaste.call(self, e, ed);
  assert.ok(!e.defaultPrevented); // Obsidian does the paste itself
  ed.cursor = { line: 3, ch: 3 }; // where Obsidian leaves the cursor
  clock.tick(0);
  assert.deepEqual([...ed.lines], ['> 一行目', '> 二行目', '>', '> 三行目', '後ろの段落']);
});

// 1.16.0: lighter while syncing, faster body search, この中を検索, list position kept
test('attachments arriving by sync are handled together, and only cards that may show them look again', async () => {
  const f = await fixture(24);
  f.files.set('a.png', new TFile('a.png')); f.metadata.set('0.md', { embeds: [{ link: 'a.png' }] });
  f.metadata.set('1.md', { embeds: [{ link: 'img/%E5%BE%8C.png' }] }); // not synced yet
  let lookups = 0; const resolve = f.app.metadataCache.getFirstLinkpathDest;
  f.app.metadataCache.getFirstLinkpathDest = (...args) => { lookups++; return resolve(...args); };
  f.refresh(); await f.pump(); assert.ok(f.view.cards.get('0.md').img); assert.equal(f.view.cards.get('1.md').img, null);
  lookups = 0;
  for (let i = 0; i < 300; i++) f.plugin.queueAttachment(`sync/${i}.jpg`);
  f.files.set('img/後.png', new TFile('img/後.png')); f.plugin.queueAttachment('img/後.png');
  assert.equal(lookups, 0); assert.equal(f.plugin.attachmentTimer !== null, true);
  f.clock.tick(499); assert.equal(lookups, 0);
  f.clock.tick(500); assert.equal(lookups, 1); // only card 1, whose embed names the new file
  await f.pump(); assert.ok(f.view.cards.get('1.md').img); assert.equal(f.plugin.attachmentChanges.size, 0);
  // A changed image is looked at again by the card showing it; a rename counts under both names.
  lookups = 0; f.plugin.queueAttachment('a.png'); f.clock.tick(500); assert.equal(lookups, 1);
  lookups = 0; f.plugin.queueAttachment('b.png', 'a.png'); f.clock.tick(500); assert.equal(lookups, 1);
  // A hidden Home waits and catches up when it shows.
  f.view.root.hidden = true; lookups = 0; f.plugin.queueAttachment('a.png'); f.clock.tick(500);
  assert.equal(lookups, 0); assert.equal(f.view.imagesStale, true);
  f.view.root.hidden = false; f.view.scheduleViewport(); f.doc.flush(); assert.ok(lookups >= 1); assert.equal(f.view.imagesStale, false);
  f.stop();
});
test('the quick check by attachment name', () => {
  const { attachmentNames, embedsMayUse } = load();
  const names = attachmentNames(['Attachments/Photo 1.PNG', 'x/y.webp']);
  assert.ok(embedsMayUse([{ link: 'photo 1.png' }], names));
  assert.ok(embedsMayUse([{ link: 'Attachments/Photo%201.PNG|200' }], names));
  assert.ok(embedsMayUse([{ link: 'y' }], names)); // no extension
  assert.equal(embedsMayUse([{ link: 'z.png' }, { link: 'https://host/q.png' }], names), false);
  assert.equal(embedsMayUse(undefined, names), false);
  // macOS may keep file names decomposed (NFD); links are usually composed.
  assert.ok(embedsMayUse([{ link: 'ガ.png' }], attachmentNames(['ガ.png'])));
});

function freshFold() { const h = load(); h.searchFoldTable({ now: true }); return h; }
test('the raw-text check never drops a note the full search keeps (kana, width, marks, compatibility characters)', () => {
  const { searchPretest, normalizeSearch } = freshFold();
  const full = (text, terms) => { const key = normalizeSearch(text); return terms.every(t => key.includes(t)); };
  const words = q => normalizeSearch(q).split(/\s+/).filter(Boolean);
  const cases = [
    ['機器のｾｲﾋﾞは別', 'せいび'], ['セイビ記録', 'せいび'], ['ｶﾞｲﾄﾞ', 'がいど'], ['ガイド', 'がいど'], ['がいど', 'がいど'],
    ['ﾜﾞｲﾝ', 'ヷいん'], ['ヷイン', 'ヷいん'], ['ＡＮＡ ＳＦＣ', 'ana sfc'], ['Ana', 'ANA'], ['㍿パナ', '株式会社'], ['①番', '1番'],
    ['ǅemal', 'dž'], ['été', 'été'], ['ậ', 'ậ'], ['Ậ', 'ậ'], ['ㄱㅏ', '가'], ['각', '각'], ['İstanbul', 'i'],
    ['⽊曜', '木曜'], ['𝐀𝐁𝐂', 'abc'], ['ﬁle', 'file'], ['Å', 'å'], ['K', 'k'], ['ｳﾞｧｲｵﾘﾝ', 'ゔぁいおりん'], ['ΟΔΟΣ', 'οδος'],
    ['-ｰ', 'ー'], ['ﾊﾟﾝ', 'ぱん'], ['パン', 'ぱん'],
  ];
  for (const [text, query] of cases) {
    const terms = words(query);
    assert.equal(full(text, terms) ? searchPretest(terms)(text) : true, true, `${text} / ${query}`);
  }
  // Random texts from tricky characters: whenever the full search matches, the quick check passes.
  const pool = [...'かカｶﾞﾟがガﾜヷワはﾊぱパeEẹ́́̂ạǅAaａＡ①1㍿株式İiΣσς ㄱㅏ각가機⽊木𝐀ﬁfーｰ-うウｳヴゔÅÅKk゙゚'];
  let seed = 7; const rand = n => { // mulberry32
    seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return (((t ^ (t >>> 14)) >>> 0) / 4294967296 * n) | 0; };
  let matched = 0;
  for (let i = 0; i < 20000; i++) {
    const text = Array.from({ length: 1 + rand(8) }, () => pool[rand(pool.length)]).join('');
    const key = normalizeSearch(text);
    const from = rand(Math.max(1, key.length)), term = key.slice(from, from + 1 + rand(3));
    const terms = (rand(4) ? term : Array.from({ length: 1 + rand(3) }, () => pool[rand(pool.length)]).join('')).split(/\s+/).map(normalizeSearch).filter(Boolean);
    if (!terms.length) continue;
    if (full(text, terms)) { matched++; assert.equal(searchPretest(terms)(text), true, JSON.stringify([text, terms])); }
  }
  assert.ok(matched > 5000, String(matched));
  // And it does rule notes out.
  assert.equal(searchPretest(words('せいび'))('機器の点検'), false);
  assert.equal(searchPretest(words('機器 点検'))('機器のメモ'), false);
});
test('narrowing: each earlier word is inside one of the new words', () => {
  const { narrowsQuery } = load();
  assert.ok(narrowsQuery(['せい'], ['せいび'])); assert.ok(narrowsQuery(['せいび'], ['せいび', '機器'])); assert.ok(narrowsQuery(['a', 'b'], ['ab']));
  assert.equal(narrowsQuery(['せいび'], ['せい']), false); assert.equal(narrowsQuery(['せいび', '機器'], ['せいび']), false); assert.equal(narrowsQuery([], ['a']), false);
});
test('body search: the raw-text check gives the same hits as normalizing every note', async () => {
  const run = async ready => {
    const f = await fixture(0); searchVault(f); if (ready) f.searchFoldTable({ now: true });
    f.bodies.set('00_Inbox/ANA SFC.md', '修行のメモ\n機器のｾｲﾋﾞは別'); f.bodies.set('00_Inbox/カタカナのメモ.md', 'セイビ記録');
    f.bodies.set('00_Inbox/整備機器リスト.md', '一覧'); f.bodies.set('00_Inbox/R7機器整備.md', 'ぜいび'); // ぜいび: not a hit
    const s = new f.BodySearch(f.app, f.plugin, 'セイビ'); s.getSuggestions('セイビ'); for (let i = 0; i < 6; i++) await settle();
    const rows = s.getSuggestions('セイビ'); s.onClose(); f.stop();
    return [...rows.slice(1).map(r => [r.file.basename, r.snippet])];
  };
  const quick = await run(true), plain = await run(false);
  assert.deepEqual(quick, plain); assert.equal(quick.length, 2);
});
test('body search waits for typing to pause, lists the notes once, and narrows from the earlier hits', async () => {
  const f = await fixture(0); searchVault(f);
  f.bodies.set('00_Inbox/ANA SFC.md', 'せいび 機器'); f.bodies.set('00_Inbox/カタカナのメモ.md', 'せいび'); f.bodies.set('00_Inbox/R7機器整備.md', 'せいかつ');
  const s = new f.BodySearch(f.app, f.plugin, 'せい'); s.getSuggestions('せい'); for (let i = 0; i < 6; i++) await settle();
  assert.ok(s.scan.done); assert.equal(s.scan.hits.length, 3); const enumerations = f.calls.enumerations;
  f.calls.reads.length = 0;
  for (const q of ['せいび', 'せいび ', 'せいび き', 'せいび 機器']) {
    const rows = s.getSuggestions(q); assert.equal(rows[0].text, '入力が止まったら検索します');
  }
  assert.equal(f.calls.reads.length, 0); assert.equal(s.scan.query, 'せい'); // nothing read while typing
  f.clock.tick(300); for (let i = 0; i < 6; i++) await settle();
  assert.equal(s.scan.query, 'せいび 機器'); assert.ok(s.scan.narrowed);
  assert.deepEqual([...new Set(f.calls.reads)].sort(), ['00_Inbox/ANA SFC.md', '00_Inbox/R7機器整備.md', '00_Inbox/カタカナのメモ.md'].sort()); // only the earlier hits
  const rows = s.getSuggestions('せいび 機器');
  assert.deepEqual([...rows.slice(1).map(r => r.file.basename)], ['ANA SFC']); assert.match(rows[0].text, /前の結果から 3件/);
  assert.equal(f.calls.enumerations, enumerations); // the note list is kept for the screen
  // A word that does not narrow reads every note again.
  f.calls.reads.length = 0; s.getSuggestions('機器'); f.clock.tick(300); for (let i = 0; i < 6; i++) await settle();
  assert.equal(s.scan.narrowed, false); assert.equal(new Set(f.calls.reads).size, 5);
  // Clearing the box stops at once.
  assert.deepEqual([...s.getSuggestions('')], []);
  s.onClose(); f.stop();
});
test('body search: when only the count moves, the status line changes in place; hits are sorted once per change', async () => {
  const f = await fixture(0); searchVault(f); f.bodies.set('00_Inbox/ANA SFC.md', 'せいび');
  const s = new f.BodySearch(f.app, f.plugin, 'せいび'); s.onOpen(); const rows = s.getSuggestions('せいび');
  const el = f.doc.createElement('div'); s.renderSuggestion(rows[0], el);
  for (let i = 0; i < 6; i++) await settle();
  const before = s.inputEl.inputs; f.clock.tick(); assert.equal(s.inputEl.inputs, before + 1); // a new hit: drawn again
  const again = s.getSuggestions('せいび'); s.renderSuggestion(again[0], f.doc.createElement('div'));
  const sorted = s.scan.sorted; assert.equal(s.getSuggestions('せいび').length, 2); assert.equal(s.scan.sorted, sorted);
  s.refreshSoon(0); s.scan.live = true; f.clock.tick(); assert.equal(s.inputEl.inputs, before + 1); // nothing new: no redraw
  assert.match(s.statusEl.textContent, /本文に含むノート 1件/);
  s.onClose(); f.stop();
});

test('link changes redo a Project/Area only when a changed note can change it; a hidden Home waits', async () => {
  const f = await fixture(0); const v = scopeVault(f);
  f.plugin.setScope(v.project.path); f.doc.flush(); const first = f.plugin.scopeCache; const count = f.calls.enumerations;
  f.plugin.linkChanges.add('bulk/5.md'); f.plugin.onLinksResolved(); f.doc.flush();
  assert.equal(f.plugin.scopeCache, first); assert.equal(f.calls.enumerations, count);
  // A note that now links to the Project
  f.app.metadataCache.resolvedLinks['bulk/6.md'] = { [v.project.path]: 1 };
  f.plugin.linkChanges.add('bulk/6.md'); f.plugin.onLinksResolved(); f.doc.flush();
  assert.notEqual(f.plugin.scopeCache, first); assert.ok(f.view.files.some(file => file.path === 'bulk/6.md'));
  // A note that leaves it (it was a member), a note given its tag, the Project note itself
  const { scopeAffected } = f; const scope = f.plugin.currentScope();
  assert.ok(scopeAffected(f.app, scope, ['bulk/6.md'])); assert.ok(scopeAffected(f.app, scope, [v.project.path]));
  f.metadata.set('bulk/7.md', { tags: [{ tag: '#機器整備' }] }); assert.ok(scopeAffected(f.app, scope, ['bulk/7.md']));
  assert.ok(scopeAffected(f.app, scope, ['別の場所/機器整備.md'])); // same name: links may go there now
  assert.equal(scopeAffected(f.app, scope, ['bulk/8.md']), false);
  // While hidden, the update waits; it is worked out once the Home shows again.
  f.view.root.hidden = true; delete f.app.metadataCache.resolvedLinks['bulk/6.md'];
  f.plugin.linkChanges.add('bulk/6.md'); f.plugin.onLinksResolved(); f.doc.flush();
  assert.equal(f.view.stale, true); assert.ok(f.view.files.some(file => file.path === 'bulk/6.md'));
  f.view.root.hidden = false; f.view.scheduleViewport(); f.doc.flush();
  assert.equal(f.view.stale, false); assert.equal(f.view.files.some(file => file.path === 'bulk/6.md'), false);
  f.stop();
});
test('link ranks are kept after link changes while recent and the same size', async () => {
  const { ranksFresh, linkGraphSize } = load();
  assert.equal(linkGraphSize({ 'a.md': { 'b.md': 1, 'c.md': 1 }, 'b.md': {} }, { 'a.md': { x: 1 } }), 6); // 3 + 1 sources, 2 + 1 links
  const cache = { at: 1000, size: 5 };
  assert.equal(ranksFresh(null, { dirty: false, now: 0, size: 5 }), false);
  assert.equal(ranksFresh(cache, { dirty: false, now: 1e12, size: 9 }), true);
  assert.equal(ranksFresh(cache, { dirty: true, now: 1000 + 60000, size: 5 }), true);
  assert.equal(ranksFresh(cache, { dirty: true, now: 1000 + 60000, size: 6 }), false);
  assert.equal(ranksFresh(cache, { dirty: true, now: 1000 + 5 * 60000, size: 5 }), false);
  const f = await fixture(0);
  f.app.metadataCache.resolvedLinks = { 'a.md': { 'b.md': 1 }, 'b.md': {} }; f.app.metadataCache.unresolvedLinks = {};
  const r1 = f.plugin.linkRanks(); f.plugin.linkChanges.add('a.md'); f.plugin.onLinksResolved();
  assert.equal(f.plugin.linkRanks(), r1); // same size, just now
  f.app.metadataCache.resolvedLinks['c.md'] = { 'b.md': 1 }; f.plugin.linkChanges.add('c.md'); f.plugin.onLinksResolved();
  const r2 = f.plugin.linkRanks(); assert.notEqual(r2, r1); assert.ok(r2.has('c.md'));
  f.plugin.rankCache.at -= 5 * 60000; f.plugin.linkChanges.add('a.md'); f.plugin.onLinksResolved();
  assert.notEqual(f.plugin.linkRanks(), r2); // old enough
  f.stop();
});

test('with a Project chosen, the unified search offers この中を検索, which reads only its notes', async () => {
  const f = await fixture(0); const v = scopeVault(f);
  f.bodies.set(v.daily.path, '機器の点検予定'); f.bodies.set(v.linked.path, '点検の手順書'); f.bodies.set('bulk/3.md', '点検');
  const u = new f.UnifiedSearch(f.app, f.plugin);
  assert.equal(u.getSuggestions('点検').some(r => r.kind === 'scopeBody'), false);
  f.plugin.setScope(v.project.path);
  const rows = u.getSuggestions('点検'); assert.equal(rows[0].kind, 'body'); assert.equal(rows[1].kind, 'scopeBody');
  const el = f.doc.createElement('div'); u.renderSuggestion(rows[1], el);
  assert.match(labelText(el), /この中を検索：「点検」/); assert.match(labelText(el), /「機器整備」とつながるノート/);
  u.selectSuggestion(rows[1], {}); const s = f.modals.at(-1); assert.ok(s instanceof f.BodySearch); assert.equal(s.scopePath, v.project.path);
  f.calls.reads.length = 0; s.getSuggestions('点検'); for (let i = 0; i < 6; i++) await settle();
  assert.deepEqual([...new Set(f.calls.reads)].sort(), [v.daily.path, v.linked.path, v.project.path].sort());
  const hits = s.getSuggestions('点検'); assert.deepEqual([...hits.slice(1).map(r => r.file.path)].sort(), [v.daily.path, v.linked.path].sort());
  assert.match(hits[0].text, /「機器整備」の中で本文に含むノート 2件/);
  s.onClose(); f.stop();
});

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
  get nextElementSibling() { const p = this.parentElement; return p?.children[p.children.indexOf(this) + 1] || null; }
  addEventListener(name, fn) { if (!this.listeners.has(name)) this.listeners.set(name, new Set()); this.listeners.get(name).add(fn); }
  removeEventListener(name, fn) { this.listeners.get(name)?.delete(fn); }
  emit(name, event = {}) { for (const fn of [...(this.listeners.get(name) || [])]) fn({ type: name, preventDefault() {}, ...event }); }
  setAttribute(key, value) { this.attributes[key] = value; }
  removeAttribute(key) { delete this.attributes[key]; if (key === 'src') this.src = ''; }
  getBoundingClientRect() { return this.rect; }
  getClientRects() { return this.hidden ? [] : [this.rect]; }
  closest() { return null; }
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
  const { doc, clock } = environment(); const notices = []; const modals = []; const urls = []; const rendered = [];
  const context = { module: { exports: {} }, console, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    require(id) { assert.equal(id, 'obsidian'); return { Plugin, BasesView, TFile,
      PluginSettingTab: class {}, Setting: class {}, Notice: class { constructor(text) { notices.push(text); } },
      Keymap: { isModEvent: ev => ev.ctrlKey || ev.metaKey || ev.button === 1 ? 'tab' : false, isModifier: ev => !!(ev.metaKey || ev.ctrlKey) }, setIcon() {},
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
      Scope: class { constructor(parent) { this.parent = parent; this.keys = []; } register(modifiers, key, func) { this.keys.push({ modifiers, key, func }); } },
      Component, MarkdownRenderer: { async render(app, md, el) { rendered.push(md); el.textContent = md; } },
    }; },
    Event: class { constructor(type) { this.type = type; } },
    activeWindow: { open: url => urls.push(url) },
  };
  const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  vm.runInNewContext(source + '\nmodule.exports.testing = { safeHomePath, excerpt, cardWindow, firstImage, PreviewStore, snapshotKey, LiteCards, defaultBase, scopeKind, listScopes, scopeMembers, ScopePicker, normalizeSearch, matchNotes, searchableNotes, complementWords, UnifiedSearch, omnisearchTerms, omnisearchSelection };', context);
  const Main = context.module.exports;
  return { Main, ...Main.testing, doc, clock, notices, modals, urls, rendered };
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
test('simultaneous Home clicks create one .base, subsequent clicks do not overwrite it', async () => {
  const f = await fixture(); await Promise.all([f.plugin.openHome(), f.plugin.openHome()]); await f.plugin.openHome(); assert.equal(f.calls.creates, 1); f.stop();
});
test('invalid or missing-parent Home paths fail without writes', async () => {
  const f = await fixture(); f.plugin.settings.homePath = 'Missing/Home.base'; await f.plugin.openHome();
  f.plugin.settings.homePath = '.obsidian/Home.base'; await f.plugin.openHome(); assert.equal(f.calls.creates, 0); assert.ok(f.notices.length); f.stop();
});
test('external search and switch settings are preserved across load and save', async () => {
  const h = load(), a = appDouble(h.doc); a.app.saved = { homePath: 'My.base', searchCommand: 'omnisearch:show-modal', switchCommand: 'aqs:recent' };
  const p = new h.Main(a.app); await p.onload(); p.runExternal('searchCommand'); p.runExternal('switchCommand'); await p.saveSettings();
  assert.deepEqual(a.calls.commands, ['omnisearch:show-modal', 'aqs:recent']); assert.equal(a.app.saved.switchCommand, 'aqs:recent'); p.onunload();
});
test('missing external command does not fall back or recurse', async () => {
  const f = await fixture(); f.plugin.runExternal('switchCommand'); f.plugin.settings.searchCommand = 'palmwiki-home:focus-search';
  f.plugin.runExternal('searchCommand'); assert.equal(f.calls.commands.length, 0); assert.ok(f.notices.length); f.stop();
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
  f.plugin.settings.showImages = false; f.refresh(); await f.pump(); assert.equal(f.calls.images.length, 0); assert.equal(f.plugin.settings.searchCommand, 'omnisearch:show-modal'); f.stop();
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
  assert.match(text(f.view.scopeBar), /機器整備」とリンクでつながるノート/);
  picker.onChooseItem(picker.getItems()[0]); f.doc.flush();
  assert.equal(f.plugin.scope, null); assert.equal(f.view.total, 404);
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
test('Enter on the first row hands the words to Omnisearch; choosing a note opens it', async () => {
  const f = await fixture(0); searchVault(f); const s = new f.UnifiedSearch(f.app, f.plugin);
  const rows = s.getSuggestions('機器 整備');
  s.selectSuggestion(rows[0], { key: 'Enter' });
  assert.deepEqual([...f.urls], ['obsidian://omnisearch?vault=PalmWiki&query=%E6%A9%9F%E5%99%A8%20%E6%95%B4%E5%82%99']);
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
test('the 検索 button and Cmd+G follow the search mode setting, which persists', async () => {
  const f = await fixture(0);
  f.plugin.openSearch(); assert.deepEqual(f.calls.commands.slice(-1), ['omnisearch:show-modal']); assert.equal(f.modals.length, 0);
  f.plugin.settings.searchMode = 'unified'; await f.plugin.saveSettings();
  f.plugin.openSearch(); assert.equal(f.modals.length, 1); assert.ok(f.modals[0] instanceof f.UnifiedSearch);
  const again = new f.Main(f.app); await again.onload(); assert.equal(again.settings.searchMode, 'unified');
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
  assert.equal(popup.className, 'palmwiki-card-popover markdown-rendered');
  assert.deepEqual({ ...popup.style }, { left: '480px', top: '300px', width: '520px', height: '440px' }); // below-right, over the corner
  // Near the bottom right of the window: above-left, clear of the card's row.
  const place = rect => { const el = f.doc.createElement('div'); const t = f.doc.createElement('div'); t.rect = rect; f.plugin.cardPopover.place(el, t, true); return [el.style.left, el.style.top]; };
  assert.deepEqual(place({ top: 600, bottom: 820, left: 1100, right: 1300 }), ['600px', '180px']);
  assert.deepEqual(place({ top: 500, bottom: 720, left: 300, right: 500 }), ['480px', '80px']); // above-right
  assert.equal(popup.children[0].textContent, f.plugin.cardPopover.card.file.basename);
  assert.equal(f.calls.triggers.length, 0); // Hover Editor is not asked while the light popup is used
  popup.emit('click', { target: popup });
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
  f.doc.body.children[1].emit('click', { target: f.doc.body.children[1] });
  assert.equal(f.doc.body.children.length, 0);
  assert.equal(f.calls.triggers.at(-1).info.linktext, target.path); assert.equal(f.calls.triggers.at(-1).info.targetEl, second); // the card anchors it
  assert.deepEqual(f.app.keymap.scopes, []);
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
  assert.match(text(s.pane.el), /Omnisearch の本文検索/);
  selected = a; s.pane.follow(); selected = b; s.pane.follow(); // fast moves settle on b
  f.clock.tick(); await settle(); await settle();
  assert.match(text(s.pane.el), /R7機器整備\|本文B/); assert.deepEqual([...f.rendered], ['本文B']);
  selected = a; s.pane.follow(); f.clock.tick(); await settle(); await settle();
  assert.match(text(s.pane.el), /機器整備_駒込2026\|# 計画\n本文A/); assert.equal(f.rendered.at(-1).startsWith('---'), false);
  const component = s.pane.preview.component; s.onClose(); assert.equal(component.loaded, false); assert.equal(s.pane, null);
  f.stop();
});
test('search preview can be turned off in settings', async () => {
  const f = await fixture(0); f.plugin.settings.searchPreview = false; const s = new f.UnifiedSearch(f.app, f.plugin);
  s.modalEl = f.doc.createElement('div'); s.onOpen(); assert.equal(s.pane, null);
  f.stop();
});

test('Omnisearch query words to mark skip exclusions, field filters and quotes', () => {
  const { omnisearchTerms } = load();
  assert.deepEqual([...omnisearchTerms('機器 -除外 "委員会" path:10_Notes ext:md 整備')], ['機器', '委員会', '整備']);
});
test('Omnisearch selection maps the selected result id to a note, anything else to nothing', async () => {
  const f = await fixture(0); searchVault(f);
  const modal = id => ({ querySelector: () => (id === null ? null : { dataset: { resultId: id } }) });
  assert.equal(f.omnisearchSelection(f.app, modal('00_Inbox/R7機器整備.md')).file.path, '00_Inbox/R7機器整備.md');
  assert.equal(f.omnisearchSelection(f.app, modal('missing.md')).file, undefined);
  assert.equal(f.omnisearchSelection(f.app, modal(null)).file, undefined);
  f.stop();
});

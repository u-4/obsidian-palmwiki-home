'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

// Lightweight API/DOM doubles. These check logic, not real Obsidian/iPad layout.
class Element {
  constructor(doc, tag = 'div') { this.ownerDocument = doc; this.tagName = tag; this.children = []; this.dataset = {}; this.listeners = {}; this.attributes = {}; this.textContent = ''; this.scrollTop = 0; this.isConnected = true; }
  append(...children) { for (const child of children) { child.remove(); child.parentElement = this; this.children.push(child); } }
  prepend(child) { child.remove(); child.parentElement = this; this.children.unshift(child); }
  remove() { if (this.parentElement) { this.parentElement.children = this.parentElement.children.filter(c => c !== this); this.parentElement = null; } }
  contains(node) { return node === this || this.children.some(c => c.contains(node)); }
  addEventListener(name, fn) { this.listeners[name] = fn; }
  setAttribute(key, value) { this.attributes[key] = value; }
  closest() { return null; }
}
function documentDouble() {
  let frames = [];
  const doc = { defaultView: {
    requestAnimationFrame(fn) { frames.push(fn); return frames.length; },
    cancelAnimationFrame(id) { frames[id - 1] = null; },
  }, createElement(tag) { return new Element(doc, tag); }, createTextNode(text) { const el = new Element(doc, '#text'); el.textContent = text; return el; } };
  doc.flush = () => { const pending = frames; frames = []; for (const fn of pending) fn?.(); };
  return doc;
}
class TFile { constructor(path, size = 30, mtime = 1) { this.path = path; this.extension = path.split('.').pop(); this.basename = path.split('/').pop().replace(/\.[^.]+$/, ''); this.stat = { size, mtime }; } }
class Component { constructor() { this.disposers = []; } register(fn) { this.disposers.push(fn); } }
class BasesView extends Component { constructor(controller) { super(); this.app = controller.app; } }
class Plugin extends Component {
  constructor(app) { super(); this.app = app; this.manifest = { id: 'palmwiki-home-lite' }; this.commands = []; this.ribbons = []; }
  async loadData() { return null; }
  async saveData(data) { this.saved = data; }
  registerBasesView(type, config) { this.bases = { type, config }; }
  addSettingTab() {}
  addCommand(command) { this.commands.push(command); }
  addRibbonIcon(icon, label, callback) { this.ribbons.push({ icon, label, callback }); }
  registerEvent() {}
}
function load() {
  const notices = [];
  const context = { module: { exports: {} }, setTimeout, clearTimeout, console,
    require(id) {
      assert.equal(id, 'obsidian');
      return { Plugin, BasesView, PluginSettingTab: class {}, Setting: class {}, TFile,
        Notice: class { constructor(text) { notices.push(text); } }, Keymap: { isModEvent: ev => ev.ctrlKey || ev.metaKey || ev.button === 1 ? 'tab' : false }, setIcon() {} };
    } };
  const source = fs.readFileSync(path.join(__dirname, 'main.cjs'), 'utf8');
  vm.runInNewContext(source + '\nmodule.exports.testing = { safeHomePath, excerpt, pageWindow, defaultBase, LiteCards, commandBridge };', context);
  return { Main: context.module.exports, notices, ...context.module.exports.testing };
}
const settle = () => new Promise(resolve => setImmediate(resolve));
function appDouble() {
  const files = new Map();
  const calls = { reads: 0, creates: 0, commands: 0, opens: 0 };
  const doc = documentDouble();
  const leaf = { view: { containerEl: doc.createElement('div') },
    getViewState: () => ({}), getRoot: () => ({}), async openFile(file) { calls.opens++; leaf.file = file; } };
  const app = { vault: {
    getAbstractFileByPath: p => files.get(p),
    async create(p, body) { calls.creates++; assert.ok(!files.has(p)); const file = new TFile(p, body.length); files.set(p, file); return file; },
    async cachedRead() { calls.reads++; return '本文'; },
    getMarkdownFiles() { throw new Error('No full-vault enumeration allowed'); },
  }, workspace: {
    getMostRecentLeaf: () => leaf, getLeaf: () => leaf, setActiveLeaf() {}, async revealLeaf() {},
    iterateAllLeaves: cb => cb(leaf), on: () => ({}), onLayoutReady: cb => cb(),
    async openLinkText() { calls.opens++; },
  }, commands: {
    listCommands: () => [{ id: 'omnisearch:show-modal', name: 'Omnisearch' }],
    executeCommandById(id) { calls.commands++; calls.lastCommand = id; return true; },
  } };
  return { app, files, calls, doc, leaf };
}

test('safe home paths reject traversal, hidden/config paths and non-base files', () => {
  const { safeHomePath } = load();
  for (const value of ['', '../x.base', '/x.base', '.obsidian/x.base', 'a/../x.base', 'a//x.base', 'x.md', 'C:\\x.base', 'a\u0000.base']) assert.equal(safeHomePath(value), null);
  assert.equal(safeHomePath(' Home/一覧.base '), 'Home/一覧.base');
});
test('excerpt strips frontmatter, images and formatting, retaining Japanese link labels', () => {
  const { excerpt } = load();
  assert.equal(excerpt('---\naliases: [隠す]\n---\n# 見出し\n[[path|日本語]] ![[image.png]] 本文'), '見出し 日本語 本文');
  assert.equal(excerpt('---\r\ntitle: x\r\n---\r\n本文'), '本文');
  assert.equal(excerpt('---\nunfinished yaml'), '');
  assert.ok(excerpt('あ'.repeat(500)).length <= 280);
});
test('HTML is converted only to inert text and network embeds are never rendered', () => {
  const { excerpt } = load();
  assert.equal(excerpt('<script>x</script> ![](https://invalid/image.png) [表示](https://invalid)'), 'x 表示');
});
test('pagination bounds are independent of vault size', () => {
  const { pageWindow } = load();
  assert.equal(pageWindow([], 3).page, 0);
  const files = Array.from({ length: 10000 }, (_, i) => i);
  assert.equal(pageWindow(files, 0).files.length, 60);
  assert.equal(pageWindow(files, 999).files.length, 40);
  assert.equal(pageWindow(files, -1).page, 0);
});
test('default base selects markdown and delegates descending mtime sort to Bases', () => {
  const { defaultBase } = load();
  assert.match(defaultBase(), /file.ext == "md"/);
  assert.match(defaultBase(), /property: file.mtime\n        direction: DESC/);
});
test('startup does not read note bodies, create a base, enumerate vault, or execute search', async () => {
  const { Main } = load(); const { app, calls } = appDouble(); const plugin = new Main(app);
  await plugin.onload();
  assert.equal(calls.reads, 0); assert.equal(calls.creates, 0); assert.equal(calls.commands, 0);
  assert.equal(plugin.bars.size, 1);
  plugin.onunload(); assert.equal(plugin.bars.size, 0);
});
test('toolbar deduplicates and follows a replaced view without loading deferred tabs', async () => {
  const { Main } = load(); const { app, leaf, doc } = appDouble(); const plugin = new Main(app);
  await plugin.onload(); const old = leaf.view.containerEl;
  plugin.syncBars(); plugin.syncBars(); assert.equal(old.children.length, 1);
  leaf.view = { containerEl: doc.createElement('div') }; plugin.syncBars();
  assert.equal(old.children.length, 0); assert.equal(leaf.view.containerEl.children.length, 1);
  leaf.isDeferred = true; plugin.syncBars(); assert.equal(plugin.bars.size, 0);
  plugin.onunload();
});
test('simultaneous Home clicks create one .base and never overwrite it', async () => {
  const { Main } = load(); const { app, calls } = appDouble(); const plugin = new Main(app);
  await plugin.onload(); await Promise.all([plugin.openHome(), plugin.openHome()]);
  assert.equal(calls.creates, 1); await plugin.openHome(); assert.equal(calls.creates, 1);
  plugin.onunload();
});
test('missing parent and invalid home settings fail closed without creating folders or notes', async () => {
  const { Main, notices } = load(); const { app, calls } = appDouble(); const plugin = new Main(app);
  await plugin.onload(); plugin.settings.homePath = 'Missing/Home.base'; await plugin.openHome();
  assert.equal(calls.creates, 0); assert.ok(notices.length);
  plugin.settings.homePath = '.obsidian/Home.base'; await plugin.openHome(); assert.equal(calls.creates, 0);
  plugin.onunload();
});
test('external command runs only on demand; missing selection does not fall back or recurse', async () => {
  const { Main, notices } = load(); const { app, calls } = appDouble(); const plugin = new Main(app);
  await plugin.onload(); plugin.runExternal('searchCommand'); assert.equal(calls.lastCommand, 'omnisearch:show-modal');
  plugin.runExternal('switchCommand'); assert.equal(calls.commands, 1); assert.ok(notices.length);
  plugin.settings.searchCommand = 'palmwiki-home-lite:search'; plugin.runExternal('searchCommand'); assert.equal(calls.commands, 1);
  plugin.onunload();
});
test('card creation is bounded to 60 and body reads to two concurrently', async () => {
  const { Main, LiteCards } = load(); const { app, calls, files, doc, leaf } = appDouble(); const plugin = new Main(app); await plugin.onload();
  const waiters = [];
  app.vault.cachedRead = () => { calls.reads++; return new Promise(resolve => waiters.push(resolve)); };
  const parent = doc.createElement('div'); leaf.view.containerEl.append(parent);
  const view = new LiteCards({ app }, parent, plugin);
  const data = Array.from({ length: 10000 }, (_, i) => { const file = new TFile(`${i}.md`); files.set(file.path, file); return { file }; });
  view.data = { groupedData: [{ entries: data }] }; view.onDataUpdated(); doc.flush();
  assert.equal(view.cards.size, 60); assert.equal(view.grid.children.length, 60); assert.equal(calls.reads, 2);
  view.dispose(); waiters.forEach(resolve => resolve('late')); await settle();
  assert.equal(calls.reads, 2); assert.equal(view.cards.size, 0); plugin.onunload();
});
test('an IntersectionObserver prevents offscreen preview reads', async () => {
  const { Main, LiteCards } = load(); const { app, files, calls, doc } = appDouble(); const plugin = new Main(app); await plugin.onload();
  let callback; doc.defaultView.IntersectionObserver = class { constructor(cb) { callback = cb; } observe() {} unobserve() {} disconnect() {} };
  const view = new LiteCards({ app }, doc.createElement('div'), plugin);
  const file = new TFile('one.md'); files.set(file.path, file);
  view.files = [file]; view.render(); assert.equal(calls.reads, 0);
  callback([{ isIntersecting: true, target: view.cards.get(file.path).el }]); await settle();
  assert.equal(calls.reads, 1); assert.equal(view.cards.get(file.path).preview.textContent, '本文'); plugin.onunload();
});
test('changed note replaces only its card; stale preview cannot overwrite the new version', async () => {
  const { Main, LiteCards } = load(); const { app, files, doc } = appDouble(); const plugin = new Main(app); await plugin.onload();
  const waiters = []; app.vault.cachedRead = () => new Promise(resolve => waiters.push(resolve));
  const view = new LiteCards({ app }, doc.createElement('div'), plugin);
  const file = new TFile('a.md'); const other = new TFile('b.md'); files.set('a.md', file); files.set('b.md', other);
  view.files = [file, other]; view.render(); const old = view.cards.get('a.md'); const kept = view.cards.get('b.md');
  file.stat.mtime = 2; view.render(); const latest = view.cards.get('a.md');
  assert.notEqual(latest, old); assert.equal(view.cards.get('b.md'), kept);
  waiters[0]('古い内容'); waiters[1]('別ノート'); await settle();
  assert.equal(latest.preview.textContent, '…'); waiters[2]('新しい内容'); await settle();
  assert.equal(latest.preview.textContent, '新しい内容'); plugin.onunload();
});
test('oversized note card opens normally but does not read the body for a preview', async () => {
  const { Main, LiteCards } = load(); const { app, files, calls, doc } = appDouble(); const plugin = new Main(app); await plugin.onload();
  const view = new LiteCards({ app }, doc.createElement('div'), plugin);
  const file = new TFile('large.md', 1024 * 1024); files.set(file.path, file); view.files = [file]; view.render();
  assert.equal(calls.reads, 0); assert.match(view.cards.get(file.path).preview.textContent, /大きな/); plugin.onunload();
});
test('deleted note cannot be opened using an old card', async () => {
  const { Main, LiteCards, notices } = load(); const { app, files, calls, doc } = appDouble(); const plugin = new Main(app); await plugin.onload();
  const view = new LiteCards({ app }, doc.createElement('div'), plugin); const file = new TFile('gone.md'); files.set(file.path, file); view.files = [file]; view.render(); files.delete(file.path);
  view.cards.get(file.path).el.listeners.click({ type: 'click', button: 0, preventDefault() {} });
  assert.equal(calls.opens, 0); assert.ok(notices.length); plugin.onunload(); await settle();
});

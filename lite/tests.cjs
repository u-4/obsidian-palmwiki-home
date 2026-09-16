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
    this.rect = { top: 0, bottom: 200, left: 0, right: 200, width: 200, height: 200 };
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
  constructor() { this.disposers = []; }
  register(fn) { this.disposers.push(fn); }
  registerDomEvent(el, type, fn, opts) { el.addEventListener(type, fn, opts); this.register(() => el.removeEventListener(type, fn, opts)); }
  unload() { for (const fn of this.disposers) fn(); }
}
class BasesView extends Component { constructor(controller) { super(); this.app = controller.app; } }
class Plugin extends Component {
  constructor(app) { super(); this.app = app; this.manifest = { id: 'palmwiki-home-lite' }; this.commands = []; }
  async loadData() { return this.app.saved || null; }
  async saveData(data) { this.app.saved = { ...data }; }
  registerBasesView() {} addSettingTab() {} addRibbonIcon() {} registerEvent() {}
  addCommand(command) { this.commands.push(command); }
}
function load() {
  const { doc, clock } = environment(); const notices = [];
  const context = { module: { exports: {} }, console, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    require(id) { assert.equal(id, 'obsidian'); return { Plugin, BasesView, TFile,
      PluginSettingTab: class {}, Setting: class {}, Notice: class { constructor(text) { notices.push(text); } },
      Keymap: { isModEvent: ev => ev.ctrlKey || ev.metaKey || ev.button === 1 ? 'tab' : false }, setIcon() {} }; },
  };
  const source = fs.readFileSync(path.join(__dirname, 'main.cjs'), 'utf8');
  vm.runInNewContext(source + '\nmodule.exports.testing = { safeHomePath, excerpt, cardWindow, firstImage, PreviewStore, snapshotKey, LiteCards, defaultBase };', context);
  const Main = context.module.exports;
  return { Main, ...Main.testing, doc, clock, notices };
}
function appDouble(doc, count = 0) {
  const files = new Map(), metadata = new Map(); const calls = { reads: [], creates: 0, commands: [], images: [], opens: [] };
  const leaf = { view: { containerEl: doc.createElement('div') }, getViewState: () => ({}), getRoot: () => ({}),
    async openFile(file) { calls.opens.push(file.path); } };
  const app = {
    vault: { getAbstractFileByPath: p => files.get(p), on: () => ({}),
      async create(p, body) { assert.ok(!files.has(p)); calls.creates++; const file = new TFile(p, body.length); files.set(p, file); return file; },
      async cachedRead(file) { calls.reads.push(file.path); return '# 見出し\n本文'; },
      getResourcePath(file) { calls.images.push(file.path); return 'app://local/' + file.path; },
      getMarkdownFiles() { throw new Error('Full-vault enumeration forbidden'); },
    },
    metadataCache: { on: () => ({}), getFileCache: file => metadata.get(file.path),
      getFirstLinkpathDest: (link, source) => files.get(link) || files.get(path.posix.normalize(path.posix.join(path.posix.dirname(source), link))),
    },
    workspace: { getMostRecentLeaf: () => leaf, getLeaf: () => leaf, setActiveLeaf() {}, async revealLeaf() {},
      iterateAllLeaves: cb => cb(leaf), on: () => ({}), onLayoutReady: cb => cb(),
      async openLinkText(p) { calls.opens.push(p); },
    },
    commands: { listCommands: () => [{ id: 'omnisearch:show-modal', name: 'Omnisearch' }, { id: 'aqs:recent', name: 'Recent' }],
      executeCommandById(id) { calls.commands.push(id); return true; } },
  };
  const entries = Array.from({ length: count }, (_, i) => { const file = new TFile(`${i}.md`); files.set(file.path, file); return { file }; });
  return { app, files, metadata, calls, leaf, data: { groupedData: [{ entries }] } };
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
  const f = await fixture(); assert.equal(f.calls.reads.length, 0); assert.equal(f.calls.images.length, 0);
  assert.equal(f.calls.creates, 0); assert.equal(f.calls.commands.length, 0); f.stop();
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
  const f = await fixture(); f.plugin.runExternal('switchCommand'); f.plugin.settings.searchCommand = 'palmwiki-home-lite:search';
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

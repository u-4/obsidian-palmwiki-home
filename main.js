'use strict';

const { Plugin, PluginSettingTab, Setting, Notice, TFile, BasesView, Keymap, setIcon, FuzzySuggestModal, SuggestModal, prepareFuzzySearch, normalizePath, MarkdownRenderer, Component, Scope, FileView, WorkspaceLeaf, getAllTags } = require('obsidian');

const VIEW_TYPE = 'palmwiki-lite-cards';
const HOVER_SOURCE = 'palmwiki-home';
const HOVER_EDIT_SOURCE = 'palmwiki-home-edit'; // from the light card popup to Hover Editor
const INITIAL_CARDS = 24;
const CARD_STEP = 24;
const MAX_CARDS = 300;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp']);
const MAX_PREVIEW_BYTES = 512 * 1024;
// Icons offered for the Home button (Lucide names in Obsidian).
const HOME_ICONS = Object.freeze({
  'home': '家', 'book-open': '開いた本', 'library': '本棚', 'notebook': 'ノート', 'notebook-pen': 'ノートとペン',
  'tree-palm': 'ヤシの木', 'leaf': '葉', 'sprout': '芽', 'sparkles': 'きらめき', 'compass': '方位磁針', 'layout-grid': 'カード',
});
const DEFAULTS = Object.freeze({
  homePath: 'PalmWiki Home.base',
  searchCommand: 'omnisearch:show-modal',
  switchCommand: '',
  showImages: true,
  searchMode: 'unified', // 'unified': PalmWiki's own search screen; 'separate': the external search command
  homeLabel: '', // the Home button's text; empty shows the Vault's name
  homeIcon: 'home', // the Home button's icon (a Lucide name from HOME_ICONS)
  searchExcludeFolders: ['99_System'],
  searchPreview: true,
  omnisearchPreview: true,
  cardPopover: true,
  popupTrigger: 'mod', // 'mod': Cmd/Ctrl + hover; 'hover': hover only (as in 2hop-links-plus)
  popupCardsPosition: 'above', // 'above' | 'below' | 'auto'
});
const PREVIEW_CHARS = 20000;
const MAX_NOTE_SUGGESTIONS = 30;
const MAX_WORD_SUGGESTIONS = 5;
const MAX_FAVORITES = 100;
const MAX_SCAN_BYTES = 2 * 1024 * 1024;
const SCAN_WORKERS = 4;
// PARA-PKM marks Project and Area notes with these frontmatter tags.
const SCOPE_KINDS = Object.freeze({ Projects: 'プロジェクト', Areas: 'エリア' });
const DONE_STATUSES = new Set(['completed', 'done', 'archived', 'cancelled', 'canceled', '完了', '終了', '中止']);
const STATUS_LABELS = Object.freeze({ active: '進行中', completed: '完了', done: '完了', archived: 'アーカイブ' });

function safeHomePath(value) {
  if (typeof value !== 'string') return null;
  const path = value.trim();
  if (!path || path.startsWith('/') || /[\\\x00-\x1f:*?"<>|]/.test(path)) return null;
  if (path.split('/').some(part => !part || part === '.' || part === '..' || part.startsWith('.'))) return null;
  return path.endsWith('.base') ? path : null;
}

// 2hop-links-plus copies this into src/cardPreview.ts; tell its session when it changes.
function excerpt(body) {
  // Bounded plain-text extraction, not Markdown rendering; no embeds or network requests.
  let text = body.slice(0, 16384).replace(/^\uFEFF/, '');
  if (/^---\r?\n/.test(text)) {
    const end = text.slice(4).search(/\r?\n(?:---|\.\.\.)\s*(?:\r?\n|$)/);
    if (end < 0) return '';
    text = text.slice(4 + end).replace(/^\r?\n(?:---|\.\.\.)\s*(?:\r?\n|$)/, '');
  }
  return text.replace(/```[^\n]*\n[\s\S]*?(?:```|$)/g, ' ')
    .replace(/!\[\[[^\]]*\]\]/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]*>/g, ' ').replace(/^\s{0,3}(?:#{1,6}|>|[-*+] |\d+\. )\s*/gm, '')
    .replace(/[*_`~]/g, '').replace(/\s+/g, ' ').trim().slice(0, 280);
}

// Keep file references only; never scan note bodies or build a second index.
// A filter ({ head, accept }) applies before the 300 cap; its head note goes first.
function cardWindow(data, limit, filter = null) {
  const files = [];
  let total = 0;
  let head = null;
  for (const group of data?.groupedData || []) {
    for (const entry of group.entries) {
      if (entry.file.extension !== 'md') continue;
      if (filter && !filter.accept(entry.file)) continue;
      total++;
      if (filter?.head && entry.file.path === filter.head) { head = entry.file; continue; }
      if (files.length < MAX_CARDS) files.push(entry.file);
    }
  }
  if (head) { files.unshift(head); if (files.length > MAX_CARDS) files.pop(); }
  return { files, total, shown: files.slice(0, Math.min(MAX_CARDS, Math.max(INITIAL_CARDS, limit))) };
}

function markdownFiles(data) {
  const files = [];
  for (const group of data?.groupedData || []) {
    for (const entry of group.entries) if (entry.file.extension === 'md') files.push(entry.file);
  }
  return files;
}

// Terms for "mentioned without a link": the note name and its aliases, like Obsidian's unlinked mentions.
function mentionTerms(title, aliases) {
  return [...new Set([title, ...aliases].map(term => String(term).trim().toLowerCase()).filter(term => term.length >= 2))];
}

function queryTerms(query) {
  return String(query).toLowerCase().split(/\s+/).filter(Boolean);
}

// Obsidian keeps the daily notes folder in the core plugin's options (internal, feature-detected).
function dailyFolder(app) {
  const folder = app.internalPlugins?.plugins?.['daily-notes']?.instance?.options?.folder;
  return typeof folder === 'string' && folder.trim() ? folder.trim().replace(/\/+$/, '') + '/' : null;
}

// Search text is compared after NFKC (full/half width), lower case and katakana → hiragana.
function normalizeSearch(text) {
  return String(text).normalize('NFKC').toLowerCase()
    .replace(/[\u30a1-\u30f6]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}

function inFolders(path, folders) {
  return folders.some(folder => path === folder || path.startsWith(folder + '/'));
}

// Names of the notes the unified search can offer; built when the screen opens.
function searchableNotes(app, excludeFolders) {
  const ignored = typeof app.metadataCache.isUserIgnored === 'function' ? p => app.metadataCache.isUserIgnored(p) : () => false;
  const notes = [];
  for (const file of app.vault.getMarkdownFiles()) {
    if (inFolders(file.path, excludeFolders) || ignored(file.path)) continue;
    const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
    const aliases = [frontmatter?.aliases, frontmatter?.alias].flat().filter(alias => typeof alias === 'string' && alias.trim());
    notes.push({ file, title: file.basename, titleKey: normalizeSearch(file.basename), aliases, aliasKeys: aliases.map(normalizeSearch) });
  }
  return notes;
}

// Like Another Quick Switcher's Recent search: every space-separated word must be in the
// title or an alias; prefix matches first, then title over alias, recently opened, modified.
// Only when nothing matches, fall back to Obsidian's fuzzy match (letters in order).
function matchNotes(notes, query, recentPaths = []) {
  const terms = normalizeSearch(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const recent = new Map(recentPaths.map((path, index) => [path, index]));
  const rank = note => recent.has(note.file.path) ? recent.get(note.file.path) : recentPaths.length;
  const scored = [];
  for (const note of notes) {
    const keys = [note.titleKey, ...note.aliasKeys];
    if (!terms.every(term => keys.some(key => key.includes(term)))) continue;
    scored.push({ note, order: [keys.some(key => key.startsWith(terms[0])) ? 0 : 1,
      terms.every(term => note.titleKey.includes(term)) ? 0 : 1, rank(note), -note.file.stat.mtime] });
  }
  if (!scored.length && typeof prepareFuzzySearch === 'function') {
    const fuzzy = prepareFuzzySearch(terms.join(' '));
    for (const note of notes) {
      const best = Math.max(...[note.titleKey, ...note.aliasKeys].map(key => fuzzy(key)?.score ?? -Infinity));
      if (best > -Infinity) scored.push({ note, order: [-best, rank(note), -note.file.stat.mtime] });
    }
  }
  scored.sort((a, b) => {
    for (let i = 0; i < a.order.length; i++) if (a.order[i] !== b.order[i]) return a.order[i] - b.order[i];
    return 0;
  });
  return scored.slice(0, MAX_NOTE_SUGGESTIONS).map(item => item.note);
}

// Various Complements has no public API; its word index is read defensively and simply
// yields nothing if the plugin, its vault/dictionary words, or this internal shape is absent.
function complementWords(app, term) {
  try {
    const indexed = app.plugins?.plugins?.['various-complements']?.suggester?.indexedWords;
    const key = normalizeSearch(term);
    if (!indexed || !key) return [];
    const words = new Map();
    for (const kind of ['customDictionary', 'currentVault', 'currentFile']) {
      const buckets = indexed[kind];
      if (!buckets || typeof buckets !== 'object') continue;
      for (const first of new Set([term[0], term[0].toLowerCase(), term[0].toUpperCase()])) {
        for (const word of Array.isArray(buckets[first]) ? buckets[first] : []) {
          const value = typeof word?.value === 'string' ? word.value : '';
          const norm = normalizeSearch(value);
          if (norm.length > key.length && norm.startsWith(key) && !words.has(norm)) words.set(norm, value);
          if (words.size >= MAX_WORD_SUGGESTIONS) return [...words.values()];
        }
      }
    }
    return [...words.values()];
  } catch {
    return [];
  }
}

function omnisearchSelection(app, modal) {
  const path = modal.querySelector('.omnisearch-result.is-selected')?.dataset?.resultId;
  const file = path ? app.vault.getAbstractFileByPath(path) : null;
  return file instanceof TFile && file.extension === 'md' ? { file } : { hint: '' };
}

function noteTitle(path) {
  return String(path).split('/').pop().replace(/\.md$/i, '');
}

function scopeKind(frontmatter) {
  const raw = [frontmatter?.tags, frontmatter?.tag].flat()
    .flatMap(tag => typeof tag === 'string' ? tag.split(/[,\s]+/) : []);
  const tags = raw.map(tag => tag.replace(/^#/, ''));
  return Object.keys(SCOPE_KINDS).find(kind => tags.includes(kind)) || null;
}

// Runs only when the picker opens, never while the home renders.
function listScopes(app) {
  const items = [];
  for (const file of app.vault.getMarkdownFiles()) {
    const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
    const kind = scopeKind(frontmatter);
    if (!kind) continue;
    const aliases = [frontmatter.aliases, frontmatter.alias].flat().filter(alias => typeof alias === 'string' && alias.trim());
    const status = typeof frontmatter.status === 'string' ? frontmatter.status.trim() : '';
    items.push({ path: file.path, title: file.basename, kind, status, aliases });
  }
  return items;
}

// Members of a Project/Area: its note plus every note linked to or from it
// (body or frontmatter links, as resolved by Obsidian).
function scopeMembers(app, scopePath) {
  const links = app.metadataCache.resolvedLinks || {};
  const members = new Set([scopePath]);
  for (const target of Object.keys(links[scopePath] || {})) members.add(target);
  for (const [source, targets] of Object.entries(links)) {
    if (targets && Object.prototype.hasOwnProperty.call(targets, scopePath)) members.add(source);
  }
  return members;
}

// Notes with a tag named like a Project/Area (its note name or an alias): `#サブスク`, or a part of a
// nested tag such as `#PKM/サブスク` or `#サブスク/請求`. Compared after NFKC and lower case, ignoring
// spaces, `_` and `-` (tags cannot hold spaces). Tags come from Obsidian's metadata cache (body and
// frontmatter); no note is read.
function tagKey(text) {
  return String(text).normalize('NFKC').toLowerCase().replace(/[\s_-]+/g, '');
}

function scopeTagged(app, scopePath, aliases) {
  const names = new Set([noteTitle(scopePath), ...aliases].map(tagKey).filter(Boolean));
  const tagged = new Set();
  for (const file of app.vault.getMarkdownFiles()) {
    const cache = app.metadataCache.getFileCache(file);
    if (!cache) continue;
    const tags = typeof getAllTags === 'function' ? getAllTags(cache) || []
      : [...(cache.tags || []).map(t => t.tag), ...[cache.frontmatter?.tags, cache.frontmatter?.tag].flat().filter(t => typeof t === 'string')];
    if (tags.some(tag => String(tag).replace(/^#/, '').split('/').some(part => names.has(tagKey(part))))) tagged.add(file.path);
  }
  tagged.delete(scopePath);
  return tagged;
}

function snapshotKey(file) {
  return JSON.stringify([file.path, file.stat.mtime, file.stat.size]);
}

// 2hop-links-plus copies this into src/cardPreview.ts; tell its session when it changes.
function firstImage(app, file) {
  // MetadataCache already knows wiki/Markdown image embeds and their source order.
  // No HTML embeds, network URLs, SVG, animation-specific formats or image scans.
  const embeds = app.metadataCache.getFileCache(file)?.embeds || [];
  for (const embed of embeds.slice(0, 100)) {
    let link = String(embed.link || '').split('|')[0].split('#')[0].trim();
    try { link = decodeURIComponent(link); } catch { continue; }
    if (!link || /^(?:[a-z][a-z0-9+.-]*:|[\\/])/i.test(link) || /[\x00-\x1f]/.test(link)) continue;
    const image = app.metadataCache.getFirstLinkpathDest(link, file.path);
    if (!(image instanceof TFile) || !IMAGE_EXTENSIONS.has(image.extension.toLowerCase())) continue;
    // Do not decode an oversized first image just to make a small card.
    if (!Number.isFinite(image.stat.size) || image.stat.size <= 0 || image.stat.size > MAX_IMAGE_BYTES) return null;
    return image;
  }
  return null;
}

// 2hop-links-plus copies this into src/cardPreview.ts; tell its session when it changes.
class PreviewStore {
  constructor(app) {
    this.app = app;
    this.cache = new Map();
    this.jobs = new Map();
    this.queue = [];
    this.active = 0;
    this.timer = null;
    this.disposed = false;
  }
  get(file) {
    const key = snapshotKey(file);
    if (!this.cache.has(key)) return undefined;
    const text = this.cache.get(key);
    this.cache.delete(key); this.cache.set(key, text);
    return text;
  }
  read(file, needed) {
    const cached = this.get(file);
    if (cached !== undefined) return Promise.resolve(cached);
    const key = snapshotKey(file);
    const existing = this.jobs.get(key);
    if (existing) { existing.checks.push(needed); return existing.promise; }
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    const job = { key, path: file.path, file, checks: [needed], promise, resolve };
    this.jobs.set(key, job); this.queue.push(job); this.schedule();
    return promise;
  }
  schedule() {
    if (this.disposed || this.timer !== null || !this.queue.length) return;
    // Let titles paint first; yield again between reads, even on a warm Vault cache.
    this.timer = setTimeout(() => { this.timer = null; this.drain(); }, 32);
  }
  drain() {
    while (!this.disposed && this.active < 2 && this.queue.length) {
      const job = this.queue.shift();
      const current = this.app.vault.getAbstractFileByPath(job.path);
      if (!(current instanceof TFile) || snapshotKey(current) !== job.key || !job.checks.some(check => check())) {
        this.jobs.delete(job.key); job.resolve(null); continue;
      }
      this.active++;
      Promise.resolve().then(() => this.app.vault.cachedRead(current)).then(body => {
        const latest = this.app.vault.getAbstractFileByPath(job.path);
        if (this.disposed || !(latest instanceof TFile) || snapshotKey(latest) !== job.key) return null;
        const text = excerpt(body);
        this.cache.set(job.key, text);
        while (this.cache.size > MAX_CARDS) this.cache.delete(this.cache.keys().next().value);
        return text;
      }).catch(() => null).then(text => job.resolve(text)).finally(() => {
        this.active--; this.jobs.delete(job.key); this.schedule();
      });
    }
  }
  dispose() {
    this.disposed = true;
    if (this.timer !== null) clearTimeout(this.timer);
    for (const job of this.queue) job.resolve(null);
    this.queue = []; this.jobs.clear(); this.cache.clear();
  }
}

function defaultBase() {
  return 'filters:\n  and:\n    - file.ext == "md"\nviews:\n  - type: ' + VIEW_TYPE +
    '\n    name: Home\n    order:\n      - file.name\n    sort:\n      - property: file.mtime\n        direction: DESC\n';
}

// Obsidian currently has no typed public command-dispatch API. Keep the small
// compatibility boundary here, feature-detected and invoked only on a user click.
function commandBridge(app) {
  const commands = app.commands;
  return commands && typeof commands.listCommands === 'function' &&
    typeof commands.executeCommandById === 'function' ? commands : null;
}

function checkbox(doc, text, checked, change) {
  const label = doc.createElement('label');
  label.className = 'palmwiki-check';
  const input = doc.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.addEventListener('change', () => change(input.checked));
  label.append(input, doc.createTextNode(text));
  return label;
}

function button(doc, text, action, className) {
  const el = doc.createElement('button');
  el.type = 'button';
  el.textContent = text;
  if (className) el.className = className;
  el.addEventListener('click', action);
  return el;
}

class PalmWikiHome extends Plugin {
  async onload() {
    const saved = await this.loadData();
    this.settings = { ...DEFAULTS };
    if (saved && typeof saved === 'object') {
      this.settings.homePath = safeHomePath(saved.homePath) || DEFAULTS.homePath;
      for (const key of ['searchCommand', 'switchCommand']) {
        if (typeof saved[key] === 'string' && saved[key].length < 512) this.settings[key] = saved[key];
      }
    }
    this.settings.showImages = saved?.showImages !== false;
    this.settings.searchMode = saved?.searchMode === 'separate' ? 'separate' : 'unified';
    this.settings.homeLabel = typeof saved?.homeLabel === 'string' ? saved.homeLabel.slice(0, 80) : '';
    this.settings.homeIcon = HOME_ICONS[saved?.homeIcon] ? saved.homeIcon : 'home';
    this.settings.searchPreview = saved?.searchPreview !== false;
    this.settings.omnisearchPreview = saved?.omnisearchPreview !== false;
    this.settings.cardPopover = saved?.cardPopover !== false;
    this.settings.popupTrigger = saved?.popupTrigger === 'hover' ? 'hover' : 'mod';
    this.settings.popupCardsPosition = ['below', 'auto'].includes(saved?.popupCardsPosition) ? saved.popupCardsPosition : 'above';
    this.settings.searchExcludeFolders = Array.isArray(saved?.searchExcludeFolders)
      ? saved.searchExcludeFolders.filter(f => typeof f === 'string' && f.trim()).map(f => f.trim().replace(/\/+$/, '')).slice(0, 50)
      : [...DEFAULTS.searchExcludeFolders];
    this.settings.favoriteScopes = Array.isArray(saved?.favoriteScopes)
      ? [...new Set(saved.favoriteScopes.filter(p => typeof p === 'string' && /\.md$/i.test(p) && p.length < 1024))].slice(0, MAX_FAVORITES)
      : [];
    this.scope = null; // In memory only: Home and back navigation keep it; restart starts at すべて.
    this.scopeCache = null;
    this.previews = new PreviewStore(this.app);
    this.disposed = false;
    this.bars = new Map();
    this.cardViews = new Set();
    this.homePromise = null;
    this.syncTimer = null;
    this.saveChain = Promise.resolve();
    if (typeof this.registerBasesView !== 'function' || typeof BasesView !== 'function') {
      new Notice('PalmWiki HomeにはBasesビュー対応版のObsidianが必要です。');
      return;
    }
    this.registerBasesView(VIEW_TYPE, {
      name: 'PalmWiki cards', icon: 'layout-grid',
      factory: (controller, container) => new LiteCards(controller, container, this),
    });
    this.addSettingTab(new LiteSettings(this.app, this));
    // Cards join Obsidian's page preview (and Hover Editor) like other links: Cmd+hover by default,
    // adjustable under Settings → Page preview.
    if (typeof this.registerHoverLinkSource === 'function') {
      this.registerHoverLinkSource(HOVER_SOURCE, { display: 'PalmWiki Home', defaultMod: true });
      // Clicking the light card popup asks for the editable preview, so no Cmd is needed there.
      this.registerHoverLinkSource(HOVER_EDIT_SOURCE, { display: 'PalmWiki Home（軽いプレビューから編集へ）', defaultMod: false });
    }
    this.cardPopover = new CardPopover(this);
    this.patchPendingTitles();
    // Command ids match PalmWiki Home 0.x so existing hotkeys keep working.
    this.addCommand({ id: 'open-home', name: 'Open home', callback: () => void this.openHome() });
    this.addCommand({ id: 'focus-search', name: 'Open search', callback: () => this.openSearch() });
    this.addCommand({ id: 'open-unified-search', name: 'Open unified search', callback: () => this.openUnifiedSearch() });
    this.addCommand({ id: 'open-switcher', name: 'Open page switcher', callback: () => this.runExternal('switchCommand') });
    this.addCommand({ id: 'open-scope', name: 'Open project or area', callback: () => this.openScopePicker(null, true) });
    this.addRibbonIcon('home', 'PalmWiki Home', () => void this.openHome());
    this.addRibbonIcon('search', '検索', () => this.openSearch());
    this.app.workspace.onLayoutReady(() => {
      if (this.disposed) return;
      for (const name of ['layout-change', 'active-leaf-change', 'file-open', 'window-open', 'window-close']) {
        this.registerEvent(this.app.workspace.on(name, () => this.scheduleBars()));
      }
      this.registerEvent(this.app.metadataCache.on('changed', file => {
        for (const view of this.cardViews) view.refreshImages(file.path);
      }));
      for (const name of ['create', 'modify', 'delete', 'rename']) {
        this.registerEvent(this.app.vault.on(name, (file, oldPath) => {
          if (!(file instanceof TFile) || file.extension === 'md') return;
          for (const view of this.cardViews) view.refreshImages(null, file.path, oldPath);
        }));
      }
      // Scope membership follows links; favorites follow renamed or deleted notes.
      this.registerEvent(this.app.metadataCache.on('resolved', () => {
        if (!this.scope) return;
        this.scopeCache = null;
        for (const view of this.cardViews) view.onDataUpdated();
      }));
      this.registerEvent(this.app.vault.on('rename', (file, oldPath) => this.followRename(file, oldPath)));
      this.registerEvent(this.app.vault.on('delete', file => this.followDelete(file)));
      this.syncBars();
      this.watchOmnisearch();
    });
  }

  // Adds the same preview pane to Omnisearch's screen when it opens. Omnisearch is not changed:
  // the pane reads the selected result's data-result-id; if that markup changes, no pane appears.
  watchOmnisearch() {
    const doc = globalThis.activeDocument || globalThis.document;
    const Observer = doc?.defaultView?.MutationObserver;
    if (!Observer || !doc.body) return;
    this.omnisearchPanes = new Map();
    // Omnisearch builds its list a moment after its screen appears, so a new screen is re-checked briefly.
    const attach = (container, tries) => {
      if (this.disposed || !container.isConnected || this.omnisearchPanes.has(container)) return;
      const modal = container.querySelector('.omnisearch-modal');
      if (!modal) return;
      const results = modal.querySelector('.prompt-results');
      if (!results) { if (tries < 40) setTimeout(() => attach(container, tries + 1), 50); return; }
      const input = modal.querySelector('input');
      const pane = new NotePreviewPane(this.app, modal, results, () => omnisearchSelection(this.app, modal), {
        terms: () => omnisearchTerms(input?.value || ''),
      });
      this.omnisearchPanes.set(container, pane);
      pane.follow();
    };
    const observer = new Observer(() => {
      for (const [container, pane] of this.omnisearchPanes) {
        if (!container.isConnected) { pane.dispose(); this.omnisearchPanes.delete(container); }
      }
      if (!this.settings.omnisearchPreview) return;
      for (const container of doc.body.querySelectorAll(':scope > .modal-container')) attach(container, 0);
    });
    observer.observe(doc.body, { childList: true }); // top-level additions only
    this.register(() => {
      observer.disconnect();
      for (const pane of this.omnisearchPanes.values()) pane.dispose();
      this.omnisearchPanes.clear();
    });
  }

  // Switching a tab between Home (a Bases view) and a note makes a new view, and while it loads its
  // file (tens of ms) Obsidian shows 「ファイルがありません」 in the header and the tab. Until the
  // file is set, the name of the file being opened is shown instead. Prototype methods of public API
  // classes, wrapped and unwrapped as monkey-around does: if another plugin wrapped them after us,
  // our wrapper is only switched off.
  patchPendingTitles() {
    const pending = new WeakMap(); // leaf → name of the file it is opening
    const nameOf = path => (typeof path === 'string' ? path.split('/').pop().replace(/\.(md|base|canvas)$/i, '') : '');
    this.wrapMethod(WorkspaceLeaf?.prototype, 'setViewState', original => function (viewState, ...rest) {
      const name = nameOf(viewState?.state?.file);
      if (name) pending.set(this, name);
      const done = () => { if (pending.get(this) === name) pending.delete(this); };
      const result = original.call(this, viewState, ...rest);
      Promise.resolve(result).then(done, done);
      return result;
    });
    this.wrapMethod(FileView?.prototype, 'getDisplayText', original => function (...args) {
      if (!this.file && this.leaf && pending.has(this.leaf)) return pending.get(this.leaf);
      return original.apply(this, args);
    });
  }

  wrapMethod(target, name, make) {
    const original = target?.[name];
    if (typeof original !== 'function') return;
    let active = true;
    const inner = make(original);
    const wrapper = function (...args) { return active ? inner.apply(this, args) : original.apply(this, args); };
    target[name] = wrapper;
    this.register(() => {
      active = false;
      if (target[name] === wrapper) target[name] = original;
    });
  }

  // Rebuilds every bar, e.g. after the Home button's text or icon changed.
  refreshBars() {
    for (const record of this.bars.values()) { record.observer?.disconnect(); record.resize?.disconnect(); record.bar.remove(); }
    this.bars.clear();
    this.syncBars();
  }

  scheduleBars() {
    if (this.disposed || this.syncTimer !== null) return;
    this.syncTimer = setTimeout(() => { this.syncTimer = null; this.syncBars(); }, 50);
  }

  syncBars() {
    if (this.disposed) return;
    const live = new Set();
    this.app.workspace.iterateAllLeaves(leaf => {
      if (leaf.isDeferred) return; // Never eagerly load background tabs.
      const root = leaf.view?.containerEl;
      if (!root?.isConnected || root.closest('.popover, .hover-popover')) return;
      const split = typeof leaf.getRoot === 'function' ? leaf.getRoot() : null;
      if (split && (split === this.app.workspace.leftSplit || split === this.app.workspace.rightSplit)) return;
      live.add(leaf);
      // Beside Obsidian's back/forward buttons in the note's header when they are shown; otherwise
      // (a layout without them, e.g. a phone) one small strip above the view, as before.
      const nav = root.querySelector?.(':scope > .view-header .view-header-nav-buttons');
      const win = root.ownerDocument.defaultView;
      const slot = nav && win?.getComputedStyle?.(nav).display !== 'none' ? nav : null;
      const previous = this.bars.get(leaf);
      if (previous?.root === root && previous.view === leaf.view && previous.slot === slot
        && (slot ? previous.bar.previousElementSibling === slot : previous.bar.parentElement === root)) { previous.update?.(); return; }
      previous?.observer?.disconnect();
      previous?.resize?.disconnect();
      previous?.bar.remove();
      const doc = root.ownerDocument;
      const bar = doc.createElement('div');
      bar.className = slot ? 'palmwiki-lite-nav is-in-header' : 'palmwiki-lite-nav';
      bar.setAttribute('role', 'toolbar');
      bar.setAttribute('aria-label', 'PalmWiki navigation');
      // The Vault's name (or the set text) with an icon opens Home; search is an icon. In the header,
      // the same class as the native buttons, so the theme styles them alike.
      const homeLabel = this.settings.homeLabel.trim() || this.app.vault.getName();
      const actions = [
        [this.settings.homeIcon, homeLabel, 'Home', 'palmwiki-lite-nav-home', () => void this.openHome(leaf)],
        ['search', '', '検索', 'palmwiki-lite-nav-search', () => this.openSearch(leaf)],
      ];
      for (const [icon, label, name, kind, action] of actions) {
        const el = button(doc, '', action, `${slot ? 'clickable-icon ' : ''}palmwiki-lite-nav-button ${kind}`);
        el.setAttribute('aria-label', name === 'Home' ? `Home（${homeLabel}）` : name);
        el.title = name === 'Home' ? `Home（${homeLabel}）` : name;
        const iconEl = doc.createElement('span');
        iconEl.setAttribute('aria-hidden', 'true');
        setIcon(iconEl, icon);
        if (!iconEl.firstChild && icon !== 'home') setIcon(iconEl, 'home'); // an icon this Obsidian lacks
        el.append(iconEl);
        if (label) {
          const text = doc.createElement('span');
          text.className = 'palmwiki-lite-nav-label';
          text.textContent = label;
          el.append(text);
        }
        bar.append(el);
      }
      // Own buttons only, rather than patching another plugin's title/search DOM.
      if (slot) slot.after(bar); else root.prepend(bar);
      const Observer = doc.defaultView?.MutationObserver;
      const watched = slot ? slot.parentElement : root;
      const observer = Observer ? new Observer(() => {
        if (!bar.isConnected || bar.parentElement !== watched) this.scheduleBars();
      }) : null;
      observer?.observe(watched, { childList: true }); // No subtree/global DOM observer.
      if (slot) observer?.observe(root, { childList: true }); // a rebuilt header
      // The page title stays centred over the whole header (CSS gives both sides equal room); when
      // the left side would not fit in its half beside the title, the Home button drops its text.
      const header = slot?.closest('.view-header');
      const left = slot?.parentElement;
      const title = header?.querySelector(':scope > .view-header-title-container');
      let fullLeft = 0;
      const update = () => {
        if (!header || !left || !bar.isConnected) return;
        if (!bar.classList.contains('is-compact')) fullLeft = left.scrollWidth;
        const side = (header.getBoundingClientRect().width - (title?.scrollWidth || 0)) / 2;
        bar.classList.toggle('is-compact', fullLeft > side);
      };
      const Resize = doc.defaultView?.ResizeObserver;
      const resize = header && Resize ? new Resize(update) : null;
      resize?.observe(header);
      if (title) resize?.observe(title); // a new note's title
      this.bars.set(leaf, { root, view: leaf.view, bar, observer, resize, slot, update });
    });
    for (const [leaf, record] of this.bars) {
      if (!live.has(leaf)) {
        record.observer?.disconnect(); record.resize?.disconnect(); record.bar.remove(); this.bars.delete(leaf);
      }
    }
  }

  async openHome(sourceLeaf) {
    if (this.disposed) return;
    try {
      const path = safeHomePath(this.settings.homePath);
      if (!path) throw new Error('設定のHomeパスはVault内の.baseファイルにしてください。');
      // Serialize first-click creation. Existing files are never overwritten.
      if (!this.homePromise) {
        const request = this.ensureHome(path);
        this.homePromise = request;
        request.finally(() => { if (this.homePromise === request) this.homePromise = null; }).catch(() => {});
      }
      const file = await this.homePromise;
      if (this.disposed || path !== this.settings.homePath || file.path !== path) return;
      let leaf = sourceLeaf || this.app.workspace.getMostRecentLeaf();
      if (!leaf || leaf.getViewState().pinned) leaf = this.app.workspace.getLeaf('tab');
      await leaf.openFile(file, { active: true });
      if (this.disposed) return;
      await this.app.workspace.revealLeaf(leaf);
      this.app.workspace.setActiveLeaf(leaf, { focus: true });
      for (const view of this.cardViews) {
        if (leaf.view.containerEl.contains(view.root)) view.goFirst();
      }
      this.scheduleBars();
    } catch (error) {
      new Notice(`Homeを開けませんでした: ${error instanceof Error ? error.message : '不明なエラー'}`);
    }
  }

  async ensureHome(path) {
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing) {
      if (!(existing instanceof TFile) || existing.extension !== 'base') throw new Error('Homeパスが.baseファイルではありません。');
      return existing;
    }
    const slash = path.lastIndexOf('/');
    if (slash >= 0 && !this.app.vault.getAbstractFileByPath(path.slice(0, slash))) {
      throw new Error('指定先フォルダがありません。既存フォルダを選んでください。');
    }
    return this.app.vault.create(path, defaultBase());
  }

  currentScope() {
    if (!this.scope) return null;
    if (this.scopeCache?.path !== this.scope) {
      this.scopeCache = { path: this.scope, members: scopeMembers(this.app, this.scope),
        tagged: scopeTagged(this.app, this.scope, this.aliasesOf(this.scope)) };
    }
    return this.scopeCache;
  }

  aliasesOf(path) {
    const file = this.app.vault.getAbstractFileByPath(path);
    const frontmatter = file instanceof TFile ? this.app.metadataCache.getFileCache(file)?.frontmatter : null;
    return [frontmatter?.aliases, frontmatter?.alias].flat().filter(alias => typeof alias === 'string' && alias.trim());
  }

  setScope(path) {
    if (this.disposed) return;
    const next = path && this.app.vault.getAbstractFileByPath(path) instanceof TFile ? path : null;
    this.scope = next;
    this.scopeCache = null;
    for (const view of this.cardViews) view.resetScope();
  }

  toggleFavorite(path) {
    if (this.disposed || !path) return;
    const favorites = this.settings.favoriteScopes;
    this.settings.favoriteScopes = favorites.includes(path)
      ? favorites.filter(p => p !== path) : [...favorites, path].slice(0, MAX_FAVORITES);
    for (const view of this.cardViews) view.renderScopeBar();
    this.saveSettings().catch(() => new Notice('お気に入りを保存できませんでした。'));
  }

  followRename(file, oldPath) {
    if (!(file instanceof TFile) || file.extension !== 'md') return;
    const favorites = this.settings.favoriteScopes;
    const moved = favorites.includes(oldPath);
    if (moved) this.settings.favoriteScopes = favorites.map(p => p === oldPath ? file.path : p);
    if (this.scope === oldPath) { this.scope = file.path; this.scopeCache = null; }
    if (moved) this.saveSettings().catch(() => {});
    for (const view of this.cardViews) view.renderScopeBar();
  }

  followDelete(file) {
    if (!(file instanceof TFile) || file.extension !== 'md') return;
    const favorites = this.settings.favoriteScopes;
    if (favorites.includes(file.path)) {
      this.settings.favoriteScopes = favorites.filter(p => p !== file.path);
      this.saveSettings().catch(() => {});
    }
    if (this.scope === file.path) this.setScope(null);
    else for (const view of this.cardViews) view.renderScopeBar();
  }

  openScopePicker(leaf, goHome = false) {
    if (this.disposed || typeof FuzzySuggestModal !== 'function') return;
    new ScopePicker(this.app, this, path => {
      this.setScope(path);
      if (goHome) void this.openHome(leaf || undefined);
    }).open();
  }

  // The 検索 button and Cmd+G follow the setting, so both styles can be tried side by side.
  openSearch(leaf) {
    if (this.settings.searchMode === 'unified') this.openUnifiedSearch(leaf);
    else this.runExternal('searchCommand', leaf);
  }

  openUnifiedSearch(leaf) {
    if (this.disposed || typeof SuggestModal !== 'function') return;
    if (leaf) this.app.workspace.setActiveLeaf(leaf, { focus: true });
    new UnifiedSearch(this.app, this).open();
  }

  searchBodies(query) {
    const text = query.trim();
    const registry = commandBridge(this.app);
    if (registry?.listCommands().some(c => c.id === 'omnisearch:show-modal')) {
      // Omnisearch's documented URL scheme opens its own screen with the query filled in.
      const url = `obsidian://omnisearch?vault=${encodeURIComponent(this.app.vault.getName())}&query=${encodeURIComponent(text)}`;
      (globalThis.activeWindow || globalThis.window || globalThis).open?.(url);
      return;
    }
    this.runExternal('searchCommand');
  }

  async createNote(name) {
    const title = name.replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!title) { new Notice('ノート名にできる文字がありません。'); return; }
    const parent = this.app.fileManager.getNewFileParent(this.app.workspace.getActiveFile()?.path || '');
    const folder = parent?.path && parent.path !== '/' ? parent.path + '/' : '';
    const path = typeof normalizePath === 'function' ? normalizePath(folder + title + '.md') : folder + title + '.md';
    let file = this.app.vault.getAbstractFileByPath(path);
    if (!file) file = await this.app.vault.create(path, '');
    if (file instanceof TFile) await this.app.workspace.getLeaf(false).openFile(file, { active: true });
  }

  runExternal(key, leaf) {
    if (this.disposed) return;
    try {
      if (leaf) this.app.workspace.setActiveLeaf(leaf, { focus: true });
      const registry = commandBridge(this.app);
      const id = this.settings[key];
      if (!registry || !id || id.startsWith(`${this.manifest.id}:`) || !registry.listCommands().some(c => c.id === id)) {
        new Notice('PalmWiki Homeの設定で、インストール済みの外部プラグインのコマンドを選んでください。');
        return;
      }
      if (!registry.executeCommandById(id)) new Notice('この画面では選択したコマンドを実行できません。');
    } catch {
      new Notice('外部コマンドの起動に失敗しました。プラグインと設定を確認してください。');
    }
  }

  saveSettings() {
    const snapshot = { ...this.settings };
    this.saveChain = this.saveChain.catch(() => {}).then(() => this.saveData(snapshot));
    return this.saveChain;
  }

  onunload() {
    this.disposed = true;
    if (this.syncTimer !== null) clearTimeout(this.syncTimer);
    for (const record of this.bars?.values() || []) { record.observer?.disconnect(); record.resize?.disconnect(); record.bar.remove(); }
    this.bars?.clear();
    for (const view of [...(this.cardViews || [])]) view.dispose();
    this.cardViews?.clear();
    this.previews?.dispose();
    this.cardPopover?.dispose();
  }
}

class LiteCards extends BasesView {
  constructor(controller, parent, plugin) {
    super(controller);
    this.type = VIEW_TYPE;
    this.plugin = plugin;
    this.parent = parent;
    this.limit = INITIAL_CARDS;
    this.files = [];
    this.total = 0;
    this.cards = new Map();
    this.imageQueue = new Map();
    this.activeImages = new Set();
    this.imageTimer = null;
    this.renderFrame = null;
    this.viewportFrame = null;
    this.moreFrame = null;
    this.disposed = false;
    this.lastScrollTop = parent.scrollTop;
    this.hoverPopover = null; // Lets this view act as the hover parent for card previews.
    const doc = parent.ownerDocument;
    this.root = doc.createElement('div');
    this.root.className = 'palmwiki-lite-home';
    this.scopeBar = doc.createElement('div');
    this.scopeBar.className = 'palmwiki-scope';
    this.scopeSig = null;
    this.includeDaily = true;
    this.includeMentions = false;
    this.includeTagged = true;
    this.bodyQuery = '';
    this.queryTimer = null;
    this.scans = { mentions: null, body: null };
    this.status = doc.createElement('div');
    this.status.className = 'palmwiki-lite-status';
    this.status.setAttribute('role', 'status');
    this.grid = doc.createElement('div');
    this.grid.className = 'palmwiki-lite-grid';
    this.more = button(doc, '続きを表示', () => this.requestMore());
    this.more.className = 'palmwiki-lite-more';
    this.footer = doc.createElement('div');
    this.footer.className = 'palmwiki-lite-footer';
    this.footer.append(this.more);
    this.root.append(this.scopeBar, this.status, this.grid, this.footer);
    parent.append(this.root);
    const Observer = doc.defaultView?.IntersectionObserver;
    this.observer = Observer ? new Observer(entries => {
      for (const entry of entries) {
        const card = this.cards.get(entry.target.dataset.path);
        if (card && card.el === entry.target) this.setNear(card, entry.isIntersecting && this.visible());
      }
    }, { root: parent, rootMargin: '160px' }) : null;
    this.registerDomEvent(parent, 'scroll', () => {
      this.plugin.cardPopover?.forget(this);
      const top = parent.scrollTop;
      const down = top > this.lastScrollTop;
      this.lastScrollTop = top;
      this.scheduleViewport();
      if (down && this.visible() && parent.scrollHeight - top - parent.clientHeight < 320) this.requestMore();
    }, { passive: true });
    this.registerDomEvent(doc, 'visibilitychange', () => this.scheduleViewport());
    this.registerDomEvent(doc.defaultView, 'resize', () => this.scheduleViewport());
    plugin.cardViews.add(this);
    this.register(() => this.dispose());
  }

  visible() {
    return !this.disposed && !this.root.ownerDocument.hidden && this.root.isConnected &&
      this.parent.clientHeight > 0 && this.root.getClientRects().length > 0;
  }

  onDataUpdated() {
    if (this.disposed || this.renderFrame !== null) return;
    this.renderFrame = this.root.ownerDocument.defaultView.requestAnimationFrame(() => {
      this.renderFrame = null;
      if (this.disposed) return;
      this.refreshWindow();
    });
  }

  refreshWindow() {
    if (this.disposed) return;
    this.ensureScans();
    const window = cardWindow(this.data, this.limit, this.currentFilter());
    this.files = window.files; this.total = window.total;
    this.render();
  }

  resetScope() {
    if (this.disposed) return;
    this.limit = INITIAL_CARDS;
    this.parent.scrollTop = 0; this.lastScrollTop = 0;
    this.bodyQuery = '';
    this.scans = { mentions: null, body: null };
    this.refreshWindow();
  }

  currentFilter() {
    const scope = this.plugin.currentScope();
    const daily = this.includeDaily ? null : dailyFolder(this.app);
    if (!scope && !daily) return null;
    const mentions = scope && this.includeMentions ? this.scans.mentions?.hits : null;
    const body = scope && this.bodyQuery ? this.scans.body?.hits : null;
    return {
      head: scope?.path || null,
      accept: file => (!daily || file.path === scope?.path || !file.path.startsWith(daily)) &&
        (!scope || this.inScope(scope, file.path) || !!mentions?.has(file.path)) &&
        (!body || body.has(file.path)),
    };
  }

  // A Project/Area's own notes: linked to or from it, and (by default) tagged with its name.
  inScope(scope, path) {
    return scope.members.has(path) || (this.includeTagged && scope.tagged.has(path));
  }

  // Bodies are read only for these opt-in filters, only while the Home is scoped,
  // and never kept: the hits are file paths for the current scope and wording.
  ensureScans() {
    const scope = this.plugin.currentScope();
    if (scope && this.includeMentions) {
      const terms = mentionTerms(noteTitle(scope.path), this.plugin.aliasesOf(scope.path));
      const key = JSON.stringify([scope.path, terms, this.includeTagged]);
      if (this.scans.mentions?.key !== key) {
        const files = markdownFiles(this.data).filter(file => !this.inScope(scope, file.path));
        this.startScan('mentions', key, files, text => terms.some(term => text.includes(term)));
      }
    } else this.scans.mentions = null;
    if (scope && this.bodyQuery) {
      const terms = queryTerms(this.bodyQuery);
      const mentions = this.includeMentions ? this.scans.mentions : null;
      const key = JSON.stringify([scope.path, terms, !!mentions, !!mentions?.done, this.includeTagged]);
      if (this.scans.body?.key !== key) {
        const files = markdownFiles(this.data).filter(file => this.inScope(scope, file.path) || !!mentions?.hits.has(file.path));
        this.startScan('body', key, files, text => terms.every(term => text.includes(term)));
      }
    } else this.scans.body = null;
  }

  startScan(kind, key, files, test) {
    const state = { key, hits: new Set(), checked: 0, total: files.length, done: false };
    this.scans[kind] = state;
    let next = 0;
    let painted = 0;
    const live = () => !this.disposed && this.scans[kind] === state;
    const worker = async () => {
      while (next < files.length && live()) {
        const file = files[next++];
        if (file.stat.size <= MAX_SCAN_BYTES) {
          try {
            if (test((await this.app.vault.cachedRead(file)).toLowerCase())) state.hits.add(file.path);
          } catch { /* unreadable notes are skipped */ }
        }
        state.checked++;
        if (live() && state.checked - painted >= 250) { painted = state.checked; this.refreshWindow(); }
      }
    };
    void Promise.all(Array.from({ length: SCAN_WORKERS }, worker)).then(() => {
      if (!live()) return;
      state.done = true;
      this.refreshWindow();
    });
  }

  setBodyQuery(value) {
    if (this.queryTimer !== null) clearTimeout(this.queryTimer);
    this.queryTimer = setTimeout(() => {
      this.queryTimer = null;
      const query = value.trim();
      if (this.disposed || query === this.bodyQuery) return;
      this.bodyQuery = query;
      this.limit = INITIAL_CARDS;
      this.refreshWindow();
    }, 300);
  }

  renderScopeBar() {
    if (this.disposed) return;
    const plugin = this.plugin;
    const scope = plugin.scope;
    const favorites = plugin.settings.favoriteScopes;
    const sig = JSON.stringify([scope, favorites, this.includeDaily, this.includeMentions, this.includeTagged]);
    if (sig === this.scopeSig) return;
    this.scopeSig = sig;
    const doc = this.root.ownerDocument;
    while (this.scopeBar.firstElementChild) this.scopeBar.firstElementChild.remove();
    const chips = doc.createElement('div');
    chips.className = 'palmwiki-scope-chips';
    chips.setAttribute('role', 'toolbar');
    chips.setAttribute('aria-label', 'プロジェクト・エリア');
    const chip = (label, path) => {
      const el = button(doc, label, () => plugin.setScope(path), 'palmwiki-scope-chip' + (path === scope ? ' is-active' : ''));
      el.setAttribute('aria-pressed', String(path === scope));
      el.title = path ? noteTitle(path) : 'すべてのノート';
      return el;
    };
    chips.append(chip('すべて', null));
    for (const path of favorites) chips.append(chip('★ ' + noteTitle(path), path));
    if (scope && !favorites.includes(scope)) chips.append(chip(noteTitle(scope), scope));
    const find = button(doc, '', () => plugin.openScopePicker(), 'palmwiki-scope-find');
    const icon = doc.createElement('span'); icon.setAttribute('aria-hidden', 'true'); setIcon(icon, 'search');
    find.append(icon, doc.createTextNode('プロジェクト・エリア'));
    find.setAttribute('aria-label', 'プロジェクト・エリアを検索して選ぶ');
    chips.append(find);
    this.scopeBar.append(chips);
    const options = doc.createElement('div');
    options.className = 'palmwiki-scope-options';
    const toggle = (key, value) => { this[key] = value; this.limit = INITIAL_CARDS; this.refreshWindow(); };
    if (dailyFolder(this.app)) options.append(checkbox(doc, '日誌を含む', this.includeDaily, value => toggle('includeDaily', value)));
    if (scope) {
      options.append(checkbox(doc, '同じ名前のタグが付いたノートも', this.includeTagged, value => toggle('includeTagged', value)));
      options.append(checkbox(doc, 'リンクなしで名前を含むノートも', this.includeMentions, value => toggle('includeMentions', value)));
      const search = doc.createElement('input');
      search.type = 'search';
      search.className = 'palmwiki-scope-body-search';
      search.placeholder = 'この中を本文検索';
      search.setAttribute('aria-label', 'この中を本文検索');
      search.value = this.bodyQuery;
      search.addEventListener('input', event => { if (!event.isComposing) this.setBodyQuery(search.value); });
      search.addEventListener('compositionend', () => this.setBodyQuery(search.value));
      options.append(search);
    }
    if (options.firstElementChild) this.scopeBar.append(options);
    if (!scope) return;
    const head = doc.createElement('div');
    head.className = 'palmwiki-scope-head';
    const name = doc.createElement('span');
    name.className = 'palmwiki-scope-name';
    name.textContent = `「${noteTitle(scope)}」とつながるノート`;
    const favorite = favorites.includes(scope);
    const star = button(doc, favorite ? '★ お気に入り' : '☆ お気に入りに追加', () => plugin.toggleFavorite(scope), 'palmwiki-scope-star');
    star.setAttribute('aria-pressed', String(favorite));
    const clear = button(doc, '× 解除', () => plugin.setScope(null), 'palmwiki-scope-clear');
    head.append(name, star, clear);
    this.scopeBar.append(head);
  }

  goFirst() {
    this.limit = INITIAL_CARDS;
    this.parent.scrollTop = 0; this.lastScrollTop = 0;
    this.render();
  }

  requestMore() {
    if (!this.visible() || this.moreFrame !== null || this.limit >= this.files.length) return;
    this.moreFrame = this.root.ownerDocument.defaultView.requestAnimationFrame(() => {
      this.moreFrame = null;
      if (!this.visible()) return;
      this.limit = Math.min(MAX_CARDS, this.limit + CARD_STEP);
      this.render();
    });
  }

  render() {
    if (this.disposed) return;
    this.renderScopeBar();
    const shown = this.files.slice(0, this.limit);
    const wanted = new Set(shown.map(file => file.path));
    // Remember one visible card so an update above it does not jump the viewport.
    const top = this.parent.getBoundingClientRect().top;
    const anchor = this.parent.scrollTop > 0 ? [...this.cards.values()].find(card =>
      wanted.has(card.path) && card.el.getBoundingClientRect().bottom > top) : null;
    const anchorTop = anchor?.el.getBoundingClientRect().top;
    for (const [path, card] of this.cards) {
      if (!wanted.has(path)) this.removeCard(card);
    }
    let cursor = this.grid.firstElementChild;
    for (const file of shown) {
      let card = this.cards.get(file.path);
      if (!card || card.key !== snapshotKey(file)) {
        if (card) {
          if (cursor === card.el) cursor = card.el.nextElementSibling;
          this.removeCard(card);
        }
        card = this.makeCard(file);
        this.cards.set(file.path, card);
        this.observer?.observe(card.el);
      }
      // Unchanged cards stay where they are. Adding 24 does not move/repaint all 300.
      if (card.el === cursor) cursor = cursor.nextElementSibling;
      else this.grid.insertBefore(card.el, cursor);
      if (card.near) this.updateImage(card);
    }
    if (anchor && this.cards.get(anchor.path) === anchor) {
      this.parent.scrollTop += anchor.el.getBoundingClientRect().top - anchorTop;
      this.lastScrollTop = this.parent.scrollTop;
    }
    const notes = [];
    const scope = this.plugin.scope ? this.plugin.currentScope() : null;
    const taggedOnly = scope && this.includeTagged ? [...scope.tagged].filter(path => !scope.members.has(path)).length : 0;
    if (taggedOnly) notes.push('同じ名前のタグが付いたノートを含む');
    const mentions = this.plugin.scope && this.includeMentions ? this.scans.mentions : null;
    if (mentions) notes.push(mentions.done ? `名前を含むノート${mentions.hits.size}件を含む` : `名前を含むノートを検索中 ${mentions.checked} / ${mentions.total}`);
    const body = this.plugin.scope && this.bodyQuery ? this.scans.body : null;
    if (body) notes.push(body.done ? `本文に「${this.bodyQuery}」を含むもの` : `本文を検索中 ${body.checked} / ${body.total}`);
    this.status.textContent = (this.total ? `${shown.length} / ${this.total}件` :
      this.plugin.scope ? 'つながるノートはありません' : 'ノートはありません') + (notes.length ? `（${notes.join('、')}）` : '');
    this.more.hidden = shown.length >= this.files.length;
    this.more.textContent = `続きの${Math.min(CARD_STEP, this.files.length - shown.length)}件を表示`;
    this.footer.setAttribute('aria-label', shown.length >= MAX_CARDS && this.total > MAX_CARDS ?
      'この一覧は300件までです。古いノートは検索またはBasesのフィルターをご利用ください。' : '一覧の続き');
    if (!this.endText) { this.endText = this.root.ownerDocument.createElement('span'); this.footer.append(this.endText); }
    this.endText.textContent = shown.length >= MAX_CARDS && this.total > MAX_CARDS ?
      '表示は300件までです。続きは検索またはフィルターで絞り込んでください。' : '';
    this.scheduleViewport();
  }

  scheduleViewport() {
    if (this.disposed || this.viewportFrame !== null) return;
    this.viewportFrame = this.root.ownerDocument.defaultView.requestAnimationFrame(() => {
      this.viewportFrame = null;
      const visible = this.visible();
      const bounds = this.parent.getBoundingClientRect();
      for (const card of this.cards.values()) {
        const rect = card.el.getBoundingClientRect();
        this.setNear(card, visible && rect.bottom >= bounds.top - 160 && rect.top <= bounds.bottom + 160);
      }
    });
  }

  setNear(card, near) {
    if (this.disposed || this.cards.get(card.path) !== card) return;
    card.near = near;
    if (near) { this.queuePreview(card); this.updateImage(card); }
    else { this.imageQueue.delete(card.path); this.releaseImage(card); }
  }

  makeCard(file) {
    const doc = this.root.ownerDocument;
    const el = doc.createElement('a');
    el.className = 'palmwiki-lite-card internal-link';
    el.href = '#';
    el.dataset.path = file.path;
    el.setAttribute('aria-label', file.basename);
    el.title = file.path;
    const title = doc.createElement('div'); title.className = 'palmwiki-lite-title'; title.textContent = file.basename;
    const media = doc.createElement('div'); media.className = 'palmwiki-lite-media'; media.hidden = true;
    const preview = doc.createElement('div'); preview.className = 'palmwiki-lite-preview';
    const cached = this.plugin.previews.get(file);
    preview.textContent = cached === undefined ? '…' : cached || '本文プレビューなし';
    el.append(title, media, preview);
    const open = event => {
      if (event.type === 'auxclick' && event.button !== 1) return;
      event.preventDefault();
      if (this.disposed) return;
      // Opening a note (even in another tab, where this view stays) puts the card popups away.
      this.plugin.cardPopover?.close();
      const current = this.app.vault.getAbstractFileByPath(file.path);
      if (!(current instanceof TFile)) { new Notice('このノートは移動または削除されました。'); return; }
      const mode = Keymap.isModEvent(event);
      if (mode) {
        void this.app.workspace.openLinkText(file.path, '', mode).catch(() => new Notice('ノートを開けませんでした。'));
        return;
      }
      let owner = null;
      this.app.workspace.iterateAllLeaves(leaf => { if (leaf.view.containerEl.contains(this.root)) owner = leaf; });
      const target = !owner || owner.getViewState().pinned ? this.app.workspace.getLeaf('tab') : owner;
      void target.openFile(current, { active: true }).catch(() => new Notice('ノートを開けませんでした。'));
    };
    el.addEventListener('click', open); el.addEventListener('auxclick', open);
    // Cmd+hover shows the light popup (CardPopover); with it off, only announces the hover and
    // Obsidian decides whether to preview (e.g. Cmd held).
    const hover = { el, file, view: this };
    el.addEventListener('mouseover', event => {
      if (this.disposed) return;
      if (this.plugin.settings.cardPopover && this.plugin.cardPopover) { this.plugin.cardPopover.enter(hover, event); return; }
      this.app.workspace.trigger('hover-link', { event, source: HOVER_SOURCE, hoverParent: this, targetEl: el, linktext: file.path, sourcePath: '' });
    });
    el.addEventListener('mouseleave', () => this.plugin.cardPopover?.leave(hover));
    return { el, preview, media, file, path: file.path, key: snapshotKey(file),
      near: false, reading: false, textReady: cached !== undefined, imageKey: null, imagePath: null,
      img: null, finishImage: null, badImage: null };
  }

  queuePreview(card) {
    if (card.textReady || card.reading || !this.visible()) return;
    if (card.file.stat.size > MAX_PREVIEW_BYTES) {
      card.preview.textContent = '大きなノート：開いて読む'; card.textReady = true; return;
    }
    card.reading = true;
    void this.plugin.previews.read(card.file, () => !this.disposed && this.visible() && card.near &&
      this.cards.get(card.path) === card).then(text => {
      card.reading = false;
      if (this.disposed || this.cards.get(card.path) !== card) return;
      if (text !== null) { card.preview.textContent = text || '本文プレビューなし'; card.textReady = true; }
      // Cancelled/offscreen reads remain retryable when the card comes back.
    });
  }

  updateImage(card) {
    if (!card.near || !this.visible()) return;
    const image = this.plugin.settings.showImages ? firstImage(this.app, card.file) : null;
    const key = image ? snapshotKey(image) : null;
    if (key !== card.imageKey) {
      this.releaseImage(card);
      this.imageQueue.delete(card.path);
      card.imageKey = key; card.imagePath = image?.path || null; card.badImage = null;
    }
    card.media.hidden = !image || card.badImage === key;
    if (!image || card.img || card.badImage === key) return;
    this.imageQueue.set(card.path, { card, image, key });
    this.scheduleImages();
  }

  refreshImages(notePath, attachmentPath, oldPath) {
    if (this.disposed) return;
    for (const card of this.cards.values()) {
      if (notePath && notePath !== card.path) continue;
      if (attachmentPath && card.imagePath && card.imagePath !== attachmentPath && card.imagePath !== oldPath) continue;
      if (card.near) this.updateImage(card);
    }
  }

  scheduleImages() {
    if (this.disposed || this.imageTimer !== null || !this.imageQueue.size) return;
    this.imageTimer = setTimeout(() => { this.imageTimer = null; this.drainImages(); }, 32);
  }

  drainImages() {
    while (this.visible() && this.activeImages.size < 2 && this.imageQueue.size) {
      const [path, job] = this.imageQueue.entries().next().value;
      this.imageQueue.delete(path);
      const { card, image, key } = job;
      if (!card.near || this.cards.get(path) !== card || card.imageKey !== key || card.img) continue;
      const current = this.app.vault.getAbstractFileByPath(image.path);
      if (!(current instanceof TFile) || snapshotKey(current) !== key) continue;
      const img = this.root.ownerDocument.createElement('img');
      img.alt = ''; img.decoding = 'async'; img.loading = 'eager';
      img.setAttribute('aria-hidden', 'true');
      this.activeImages.add(card); card.img = img;
      let finished = false;
      let timeout = null;
      const finish = () => {
        if (finished) return;
        finished = true;
        if (timeout !== null) clearTimeout(timeout);
        this.activeImages.delete(card);
        img.removeEventListener('load', loaded); img.removeEventListener('error', failed);
        card.finishImage = null; this.scheduleImages();
      };
      const loaded = () => { finish(); };
      const failed = () => {
        finish();
        if (card.img === img) { card.badImage = key; this.releaseImage(card); card.media.hidden = true; }
      };
      card.finishImage = finish;
      img.addEventListener('load', loaded); img.addEventListener('error', failed);
      card.media.append(img);
      timeout = setTimeout(failed, 8000);
      try {
        const resource = this.app.vault.getResourcePath(current);
        // Same file version reuses the browser cache; changed image bytes get a new URL.
        img.src = resource + (resource.includes('?') ? '&' : '?') +
          'palmwiki=' + current.stat.mtime + '-' + current.stat.size;
      } catch { failed(); }
    }
  }

  releaseImage(card) {
    card.finishImage?.();
    if (card.img) { card.img.removeAttribute('src'); card.img.remove(); card.img = null; }
  }

  removeCard(card) {
    this.observer?.unobserve(card.el);
    this.imageQueue.delete(card.path); this.releaseImage(card);
    card.el.remove(); this.cards.delete(card.path);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    const win = this.root.ownerDocument.defaultView;
    for (const frame of [this.renderFrame, this.viewportFrame, this.moreFrame]) if (frame !== null) win?.cancelAnimationFrame(frame);
    if (this.imageTimer !== null) clearTimeout(this.imageTimer);
    if (this.queryTimer !== null) clearTimeout(this.queryTimer);
    this.scans = { mentions: null, body: null };
    this.observer?.disconnect();
    this.imageQueue.clear();
    for (const card of this.cards.values()) this.releaseImage(card);
    this.cards.clear(); this.files = [];
    this.plugin.cardPopover?.forget(this);
    this.root.remove(); this.plugin.cardViews.delete(this);
  }
}

const NO_STATUS = '\u0000none';

class ScopePicker extends (FuzzySuggestModal || class {}) {
  constructor(app, plugin, choose) {
    super(app);
    this.plugin = plugin;
    this.choose = choose;
    this.items = null;
    this.showDone = false; // Completed Projects/Areas are hidden unless asked for.
    this.status = '';
    this.setPlaceholder?.('プロジェクト・エリアを検索（名前・別名）');
  }

  onOpen() {
    super.onOpen?.();
    const doc = this.modalEl?.ownerDocument;
    if (!doc) return;
    const row = doc.createElement('div');
    row.className = 'palmwiki-scope-filters';
    const done = checkbox(doc, '完了も表示', this.showDone, value => { this.showDone = value; this.refresh(); });
    const select = doc.createElement('select');
    select.className = 'dropdown';
    select.setAttribute('aria-label', '状態で絞り込む');
    const statuses = [...new Set(this.allItems().map(item => item.status).filter(Boolean))].sort();
    for (const [value, label] of [['', '状態: すべて'], ...statuses.map(v => [v, `状態: ${STATUS_LABELS[v.toLowerCase()] || v}`]), [NO_STATUS, '状態: 未設定']]) {
      const option = doc.createElement('option'); option.value = value; option.textContent = label; select.append(option);
    }
    select.addEventListener('change', () => { this.status = select.value; this.refresh(); });
    row.append(done, select);
    const input = this.inputEl?.closest?.('.prompt-input-container') || this.inputEl;
    if (input?.after) input.after(row); else this.modalEl.prepend(row);
  }

  refresh() {
    this.inputEl?.dispatchEvent(new (this.inputEl.ownerDocument.defaultView?.Event || Event)('input'));
  }

  allItems() {
    if (this.items) return this.items;
    const favorites = this.plugin.settings.favoriteScopes;
    const rank = item => favorites.includes(item.path) ? 0 : DONE_STATUSES.has(item.status.toLowerCase()) ? 2 : 1;
    const kinds = Object.keys(SCOPE_KINDS);
    this.items = listScopes(this.app).sort((a, b) => rank(a) - rank(b) ||
      (rank(a) === 0 ? favorites.indexOf(a.path) - favorites.indexOf(b.path) : 0) ||
      kinds.indexOf(a.kind) - kinds.indexOf(b.kind) || a.title.localeCompare(b.title, 'ja'));
    return this.items;
  }

  getItems() {
    const wanted = item => this.status === NO_STATUS ? !item.status
      : this.status ? item.status === this.status
      : this.showDone || !DONE_STATUSES.has(item.status.toLowerCase());
    return [{ all: true, path: null, title: 'すべてのノート', kind: '', status: '', aliases: [] }, ...this.allItems().filter(wanted)];
  }

  getItemText(item) {
    return [item.title, ...item.aliases].join(' ');
  }

  renderSuggestion(match, el) {
    const item = match.item || match;
    const doc = el.ownerDocument;
    const title = doc.createElement('div');
    title.className = 'palmwiki-scope-suggestion-title';
    title.textContent = (item.path && this.plugin.settings.favoriteScopes.includes(item.path) ? '★ ' : '') + item.title;
    el.append(title);
    if (item.all) return;
    const meta = doc.createElement('small');
    meta.className = 'palmwiki-scope-suggestion-meta';
    meta.textContent = [SCOPE_KINDS[item.kind], STATUS_LABELS[item.status.toLowerCase()] || item.status,
      item.aliases.length ? `別名: ${item.aliases.join('、')}` : ''].filter(Boolean).join(' · ');
    el.append(meta);
  }

  onChooseItem(item) {
    this.choose(item.all ? null : item.path);
  }
}

// 2hop-links-plus copies this into src/notePreview.ts / src/relatedPopover.tsx; tell its session when it changes.
// The search preview shows the body without frontmatter, up to PREVIEW_CHARS characters.
function previewMarkdown(body) {
  let text = String(body).replace(/^\uFEFF/, '');
  if (/^---\r?\n/.test(text)) {
    const end = text.slice(4).search(/\r?\n(?:---|\.\.\.)\s*(?:\r?\n|$)/);
    if (end >= 0) text = text.slice(4 + end).replace(/^\r?\n(?:---|\.\.\.)\s*(?:\r?\n|$)/, '');
  }
  return text.length > PREVIEW_CHARS ? { text: text.slice(0, PREVIEW_CHARS), cut: true } : { text, cut: false };
}

// Words to mark in a preview, from an Omnisearch query: drops -exclusions, field filters and quotes.
function omnisearchTerms(query) {
  return String(query).split(/\s+/).map(word => word.replace(/^"+|"+$/g, ''))
    .filter(word => word && !word.startsWith('-') && !/^[a-z]+:/i.test(word));
}

function normalizeHeading(text) {
  return String(text).replace(/\s+/g, ' ').trim().toLowerCase();
}

// The line holding a link: within its paragraph, list item or table cell, only the part between line
// breaks (<br>, a newline in the text, a nested list or the list bullet), wrapped in a span.
// Headings are taken whole. As in 2hop-links-plus (notePreview.ts lineAround()).
function lineAround(link) {
  const block = link.closest('li, td, th, h1, h2, h3, h4, h5, h6, p');
  if (!block) return link;
  if (/^H\d$/.test(block.tagName)) return block;
  const isBoundary = node => node.nodeName === 'BR' || node.nodeName === 'UL' || node.nodeName === 'OL'
    || !!node.classList?.contains('list-bullet') || !!node.classList?.contains('list-collapse-indicator');
  let child = link;
  while (child.parentNode && child.parentNode !== block) child = child.parentNode;
  let first = child;
  for (;;) {
    const prev = first.previousSibling;
    if (!prev || isBoundary(prev)) break;
    if (prev.nodeType === 3 && prev.textContent.includes('\n')) {
      const at = prev.textContent.lastIndexOf('\n') + 1;
      first = at < prev.length ? prev.splitText(at) : prev.nextSibling || first;
      break;
    }
    first = prev;
  }
  let last = child;
  for (;;) {
    const next = last.nextSibling;
    if (!next || isBoundary(next)) break;
    if (next.nodeType === 3 && next.textContent.includes('\n')) {
      const at = next.textContent.indexOf('\n');
      if (at > 0) { next.splitText(at); last = next; }
      break;
    }
    last = next;
  }
  const line = block.ownerDocument.createElement('span');
  block.insertBefore(line, first);
  let node = first;
  while (node) {
    const following = node === last ? null : node.nextSibling;
    line.appendChild(node);
    node = following;
  }
  return line;
}

// 2hop-links-plus copies this into src/notePreview.ts / src/relatedPopover.tsx; tell its session when it changes.
// Renders a note into `el` with Obsidian's Markdown renderer: the title, then the body without
// frontmatter (up to PREVIEW_CHARS). Read-only and light: no editor, no view, so it switches fast.
// Shared by the search panes and the Home card popover; the newest show() wins.
// `select()`-style input: { file } shows a note, { hint } shows a short line instead.
class NotePreview {
  constructor(app, el, options = {}) {
    this.app = app;
    this.el = el;
    this.terms = options.terms || (() => []);
    this.onLink = options.onLink || null;
    this.token = 0;
    this.component = null;
    this.file = null;
    el.addEventListener('click', event => {
      const link = event.target?.closest?.('a.internal-link');
      if (!link || !this.onLink) return;
      event.preventDefault();
      this.onLink(link.dataset.href || link.getAttribute('href') || '', this.file?.path || '', event);
    });
  }

  clear() {
    this.component?.unload();
    this.component = null;
    while (this.el.firstChild) this.el.firstChild.remove();
  }

  async show(selected) {
    const token = ++this.token;
    const doc = this.el.ownerDocument;
    if (!selected.file) {
      this.clear();
      this.file = null;
      if (selected.hint) {
        const hint = doc.createElement('div');
        hint.className = 'palmwiki-search-preview-hint';
        hint.textContent = selected.hint;
        this.el.append(hint);
      }
      return;
    }
    let body = null;
    try { body = await this.app.vault.cachedRead(selected.file); } catch { body = null; }
    if (token !== this.token) return;
    this.clear();
    this.file = selected.file;
    const title = doc.createElement('div');
    title.className = 'palmwiki-search-preview-title';
    title.textContent = selected.file.basename;
    title.title = selected.file.basename;
    const content = doc.createElement('div');
    content.className = 'palmwiki-search-preview-body';
    this.el.append(title, content);
    this.el.scrollTop = 0;
    if (body === null) { content.textContent = '読み込めませんでした。'; return; }
    const { text, cut } = previewMarkdown(body);
    const component = new Component();
    component.load();
    this.component = component;
    try {
      await MarkdownRenderer.render(this.app, text, content, selected.file.path, component);
    } catch {
      content.textContent = text;
    }
    if (token !== this.token) return;
    if (cut) {
      const more = doc.createElement('div');
      more.className = 'palmwiki-search-preview-hint';
      more.textContent = '（長いノートのため途中まで表示しています）';
      this.el.append(more);
    }
    this.markTerms(content);
    if (selected.focus) this.reveal(content, selected.file, selected.focus);
  }

  // Scrolls to and highlights the linked heading, or else the first line with a link to one of the
  // focus notes (`{ heading, linkTargets: [path] }`). Only the rendered links are examined.
  // As in 2hop-links-plus (notePreview.ts reveal()).
  reveal(content, file, focus) {
    let target = null;
    if (focus.heading) {
      const wanted = normalizeHeading(focus.heading);
      target = [...content.querySelectorAll('h1, h2, h3, h4, h5, h6')].find(h => normalizeHeading(h.textContent || '') === wanted) || null;
    }
    if (!target && focus.linkTargets?.length) {
      const targets = new Set(focus.linkTargets);
      for (const link of content.querySelectorAll('a.internal-link')) {
        const href = (link.dataset.href || link.getAttribute('href') || '').split('#')[0].split('|')[0];
        const dest = href ? this.app.metadataCache.getFirstLinkpathDest(href, file.path) : null;
        if (dest && targets.has(dest.path)) { target = lineAround(link); break; }
      }
    }
    if (!target) return;
    target.classList.add('palmwiki-preview-focus');
    // Keep the highlighted part about a third of the way down the preview.
    const box = this.el.getBoundingClientRect();
    const at = target.getBoundingClientRect();
    this.el.scrollTop = Math.max(0, this.el.scrollTop + at.top - box.top - this.el.clientHeight / 3);
  }

  // Marks the query words in the rendered preview and scrolls to the first one.
  markTerms(content) {
    const terms = this.terms().map(term => term.toLowerCase()).filter(term => term.length > 0);
    const doc = content.ownerDocument;
    if (!terms.length || typeof doc.createTreeWalker !== 'function') return;
    const walker = doc.createTreeWalker(content, 4 /* NodeFilter.SHOW_TEXT */);
    const nodes = [];
    while (walker.nextNode() && nodes.length < 2000) nodes.push(walker.currentNode);
    let first = null;
    let marks = 0;
    for (const node of nodes) {
      const lower = node.nodeValue.toLowerCase();
      let at = -1;
      let length = 0;
      for (const term of terms) {
        const i = lower.indexOf(term);
        if (i >= 0 && (at < 0 || i < at)) { at = i; length = term.length; }
      }
      if (at < 0) continue;
      const hit = node.splitText(at);
      hit.splitText(length);
      const mark = doc.createElement('mark');
      mark.className = 'palmwiki-search-preview-match';
      hit.replaceWith(mark);
      mark.append(hit);
      first = first || mark;
      if (++marks >= 200) break;
    }
    if (first) this.el.scrollTop = Math.max(0, first.offsetTop - this.el.clientHeight / 3);
  }

  dispose() {
    this.token++;
    this.component?.unload();
    this.component = null;
    this.el.remove();
  }
}

// A pane beside a result list that shows the selected row's note (a NotePreview).
// Shared by the unified search and Omnisearch's screen. `select()` returns { file } for a note
// row, { hint } for anything else; `terms()` gives words to mark and scroll to.
class NotePreviewPane {
  constructor(app, modalEl, resultEl, select, options = {}) {
    this.app = app;
    this.modalEl = modalEl;
    this.resultEl = resultEl;
    this.select = select;
    this.key = undefined;
    this.timer = null;
    this.waitTimer = null;
    this.waits = 0;
    const doc = modalEl.ownerDocument;
    modalEl.classList?.add('palmwiki-search-modal');
    this.el = doc.createElement('div');
    this.el.className = 'palmwiki-search-preview markdown-rendered';
    this.preview = new NotePreview(app, this.el, options);
    modalEl.append(this.el);
    // Obsidian (and Omnisearch) handle the arrow keys themselves, so the selection is watched instead.
    const Observer = doc.defaultView?.MutationObserver;
    if (Observer && resultEl) {
      this.observer = new Observer(() => this.follow());
      this.observer.observe(resultEl, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
    }
  }

  get file() { return this.preview.file; }

  follow() {
    if (this.el.offsetParent === null) {
      // Not laid out yet (a screen that is still opening) or hidden on a narrow screen: look again shortly.
      if (this.waits++ < 20) {
        if (this.waitTimer !== null) clearTimeout(this.waitTimer);
        this.waitTimer = setTimeout(() => { this.waitTimer = null; this.follow(); }, 50);
      }
      return;
    }
    this.waits = 0;
    const selected = this.select() || {};
    const key = selected.file ? 'file:' + selected.file.path : 'hint:' + (selected.hint || '');
    if (key === this.key) return;
    this.key = key;
    if (this.timer !== null) clearTimeout(this.timer);
    // A short pause lets fast moves settle on one row before reading a note.
    this.timer = setTimeout(() => { this.timer = null; void this.preview.show(selected); }, 60);
  }

  dispose() {
    this.observer?.disconnect();
    if (this.timer !== null) clearTimeout(this.timer);
    if (this.waitTimer !== null) clearTimeout(this.waitTimer);
    this.timer = null;
    this.waitTimer = null;
    this.preview.dispose();
    this.modalEl.classList?.remove('palmwiki-search-modal');
  }
}

// Hover-only popups open after the pointer rests this long on a card or link, and not right after typing.
const HOVER_REST_MS = 300;
const TYPING_PAUSE_MS = 1000;

// How long to wait before opening a popup for the pointed-at card or link, or null to not open.
// Cmd/Ctrl opens quickly in both modes. Hover-only opens when the pointer rests (each move restarts
// the wait), never while a mouse button is down (dragging, selecting) or just after typing.
// As in 2hop-links-plus (relatedPopover.tsx hoverOpenDelay()).
function hoverOpenDelay({ trigger, isMod, buttons, msSinceTyping }) {
  if (isMod) return 60;
  if (trigger !== 'hover') return null;
  if (buttons !== 0) return null;
  if (msSinceTyping < TYPING_PAUSE_MS) return null;
  return HOVER_REST_MS;
}

// Whether the linked cards go below the preview. Auto keeps the preview next to the pointer and the
// cards on the far side. As in 2hop-links-plus (cardsBelowPreview()).
function cardsBelowPreview(position, above) {
  if (position === 'below') return true;
  if (position === 'auto') return !above;
  return false;
}

// 2hop-links-plus copies this into src/notePreview.ts / src/relatedPopover.tsx; tell its session when it changes.
// Light popups for Home cards: a row of the note's linked cards above the same NotePreview, 520×440
// in all. Cmd+hover on a card opens one off the card's corner; while one is open, moving to another
// card switches to that card. Cmd+hover on a link or a row card inside a popup opens the next popup
// for that note, and so on (a stack, closed together); it scrolls to the line linking back.
// Clicking inside a preview (not on a link, not after selecting text) hands over to Obsidian's page
// preview — Hover Editor when installed — through the standard hover-link event, for editing.
// As in 2hop-links-plus (relatedPopover.tsx), whose cards are ordered by relevance; here the row is
// just the note's links and backlinks, newest first (no ranking of our own). Settings: how popups open
// (Cmd/Ctrl + hover, or hover only) and where the row sits (above, below, auto), as in 2hop-links-plus.
class CardPopover {
  constructor(plugin) {
    this.plugin = plugin;
    this.app = plugin.app;
    this.stack = []; // [{ el, preview, previewEl, file, anchor, view }], the card's popup first
    this.hovered = null; // the Home card under the pointer: { el, file, view }
    this.hoveredTarget = null; // a link or row card under the pointer inside a popup: { el, level, file, heading }
    this.openTimer = null;
    this.closeTimer = null;
    this.scoped = false;
    this.childClose = null; // { entry, timer }: closing the popups above a popup the pointer went back to
    this.lastTypedAt = 0;
    this.lastButtons = 0;
    this.lastScreenX = null;
    this.lastScreenY = null;
    this.onKey = event => {
      if (event.key !== 'Meta' && event.key !== 'Control') {
        // Typing (not a modifier alone) holds hover-only popups back for a moment.
        if (!['Shift', 'Alt'].includes(event.key)) { this.lastTypedAt = Date.now(); this.cancelOpen(); }
        return;
      }
      if (this.hoveredTarget) this.scheduleTarget(this.hoveredTarget);
      else if (this.hovered && this.card?.anchor !== this.hovered.el) this.schedule(() => this.openCard(this.hovered), 60);
    };
    // Hover-only: only real pointer movement counts, so content scrolling under a still pointer,
    // or a card appearing under it, opens nothing. Chromium also sends mousemove without any
    // movement when the content under the pointer scrolls or moves (a popup scrolling to its
    // highlighted line); those are skipped by the unchanged screen position, for opening and for
    // closing popups above alike. As in 2hop-links-plus (relatedPopover.tsx onPointerMove()).
    this.onMove = event => {
      if (event.screenX === this.lastScreenX && event.screenY === this.lastScreenY) return;
      this.lastScreenX = event.screenX;
      this.lastScreenY = event.screenY;
      this.lastButtons = event.buttons || 0;
      this.trackReturnToParent(event.target);
      if (this.trigger !== 'hover') return;
      const node = event.target;
      const inside = this.hoveredTarget;
      let open;
      let still;
      if (inside && inside.el.contains?.(node)) {
        if (!inside.file || this.stack[inside.level + 1]?.anchor === inside.el) return;
        open = () => this.openTarget(inside);
        still = () => this.hoveredTarget === inside;
      } else if (this.hovered && this.hovered.el.contains?.(node)) {
        const card = this.hovered;
        if (this.card?.anchor === card.el) return;
        open = () => this.openCard(card);
        still = () => this.hovered === card;
      } else {
        return;
      }
      const delay = hoverOpenDelay({ trigger: this.trigger, isMod: Keymap.isModifier(event, 'Mod'), buttons: this.lastButtons, msSinceTyping: Date.now() - this.lastTypedAt });
      if (delay === null) { this.cancelOpen(); return; }
      this.schedule(() => {
        if (still() && this.lastButtons === 0 && Date.now() - this.lastTypedAt >= TYPING_PAUSE_MS) open();
      }, delay);
    };
    // Obsidian takes Escape before page listeners, so the popups hold a key scope while open.
    this.scope = typeof Scope === 'function' ? new Scope(this.app.scope) : null;
    this.scope?.register([], 'Escape', () => { this.close(); return false; });
  }

  get card() { return this.stack[0] || null; }

  // Back on a lower popup, away from the link or card that opened the popup above it: close the
  // popups above after a short pause, so crossing the lower popup on the way up does not close them.
  // Only the popup seen at scheduling is closed, not a new one opened meanwhile from another link.
  // As in 2hop-links-plus (relatedPopover.tsx trackReturnToParent()).
  trackReturnToParent(node) {
    if (this.stack.length < 2 || !node) { this.cancelChildClose(); return; }
    let level = -1;
    for (let i = this.stack.length - 1; i >= 0; i--) {
      if (this.stack[i].el.contains?.(node)) { level = i; break; }
    }
    const child = this.stack[level + 1];
    if (level < 0 || !child || child.anchor.contains?.(node)) { this.cancelChildClose(); return; }
    if (this.childClose?.entry === child) return;
    this.cancelChildClose();
    const timer = setTimeout(() => {
      this.childClose = null;
      if (this.stack[level + 1] === child) this.closeFrom(level + 1);
    }, 250);
    this.childClose = { entry: child, timer };
  }

  cancelChildClose() {
    if (this.childClose) { clearTimeout(this.childClose.timer); this.childClose = null; }
  }

  get trigger() { return this.plugin.settings.popupTrigger === 'hover' ? 'hover' : 'mod'; }

  // Called by a Home card on mouseover / mouseleave.
  enter(card, event) {
    this.hovered = card;
    this.cancelClose();
    this.listen(card.el.ownerDocument);
    if (this.card?.anchor === card.el) return;
    // Cmd opens; once a popup is open, pointing at another card is enough (a little slower,
    // so that crossing a card on the way to the popup does not switch it).
    // Hover-only waits for the pointer to rest instead (onMove).
    if (Keymap.isModifier(event, 'Mod')) this.schedule(() => this.openCard(card), 60);
    else if (this.trigger === 'mod' && this.stack.length) this.schedule(() => this.openCard(card), 150);
  }

  leave(card) {
    if (this.hovered === card) this.hovered = null;
    this.cancelOpen();
    if (this.stack.length) this.scheduleClose();
  }

  listen(doc) {
    if (this.keyDoc === doc) return;
    this.keyDoc?.removeEventListener('keydown', this.onKey, true);
    this.keyDoc?.removeEventListener('mousemove', this.onMove, true);
    this.keyDoc = doc;
    doc.addEventListener('keydown', this.onKey, true);
    doc.addEventListener('mousemove', this.onMove, { capture: true, passive: true });
  }

  schedule(fn, delay) {
    this.cancelOpen();
    this.openTimer = setTimeout(() => { this.openTimer = null; fn(); }, delay);
  }

  cancelOpen() {
    if (this.openTimer !== null) { clearTimeout(this.openTimer); this.openTimer = null; }
  }

  openCard(card) {
    if (this.plugin.disposed || card.view.disposed || !card.el.isConnected) return;
    this.open(0, card.el, card.file, card.view, true, null);
  }

  // The next popup, for a link or row card in the popup at `level`: it scrolls to the line that
  // links back to that popup's note (or the link's heading).
  scheduleTarget(target) {
    if (!target.file || this.stack[target.level + 1]?.anchor === target.el) return;
    this.schedule(() => this.openTarget(target), 60);
  }

  openTarget({ el, level, file, heading }) {
    const from = this.stack[level];
    if (!from || !file || !el.isConnected) return;
    const beside = el.classList?.contains('palmwiki-popover-card');
    this.open(level + 1, el, file, from.view, beside, { heading, linkTargets: [from.file.path] });
  }

  linkTarget(a, level) {
    const href = a.dataset?.href || a.getAttribute?.('href') || '';
    const path = href.split('#')[0].split('|')[0];
    const file = path ? this.app.metadataCache.getFirstLinkpathDest(path, this.stack[level]?.file.path || '') : null;
    if (!(file instanceof TFile) || file.extension !== 'md') return null;
    // The innermost heading of "Note#A#B"; block links ("#^id") have none.
    const heading = (href.split('|')[0].split('#').slice(1).pop() || '').replace(/^\^.*/, '');
    return { file, heading: heading || undefined };
  }

  // The note's links and backlinks (Markdown notes only), newest first.
  related(file, limit = 10) {
    const resolved = this.app.metadataCache.resolvedLinks || {};
    const paths = new Set(Object.keys(resolved[file.path] || {}));
    for (const [source, targets] of Object.entries(resolved)) if (targets && targets[file.path]) paths.add(source);
    paths.delete(file.path);
    return [...paths].map(path => this.app.vault.getAbstractFileByPath(path))
      .filter(f => f instanceof TFile && f.extension === 'md')
      .sort((a, b) => b.stat.mtime - a.stat.mtime).slice(0, limit);
  }

  open(level, anchor, file, view, beside, focus) {
    this.cancelChildClose();
    this.closeFrom(level);
    const doc = anchor.ownerDocument;
    this.listen(doc);
    const el = doc.createElement('div');
    el.className = 'palmwiki-card-popover';
    const cardsEl = doc.createElement('div');
    cardsEl.className = 'palmwiki-popover-cards';
    const previewEl = doc.createElement('div');
    previewEl.className = 'palmwiki-card-popover-preview markdown-rendered';
    el.append(cardsEl, previewEl);
    const entry = { el, previewEl, file, anchor, view, preview: null };
    entry.preview = new NotePreview(this.app, previewEl, {
      onLink: (link, source, event) => {
        this.close();
        void this.app.workspace.openLinkText(link, source, Keymap.isModEvent(event));
      },
    });
    el.addEventListener('mouseenter', () => this.cancelClose());
    el.addEventListener('mouseleave', () => this.scheduleClose());
    // Captured and kept from the rendered links: otherwise Obsidian's own page preview (Hover Editor)
    // also opens on Cmd over a link here. A link's or row card's next popup is this one's job.
    el.addEventListener('mouseover', event => {
      const a = event.target?.closest?.('a.internal-link');
      const card = a ? null : event.target?.closest?.('.palmwiki-popover-card');
      if (!a && !card) { if (this.hoveredTarget?.level === level) this.hoveredTarget = null; return; }
      if (a) event.stopPropagation?.();
      const found = a ? this.linkTarget(a, level) : { file: card.palmwikiFile };
      this.hoveredTarget = { el: a || card, level, file: found?.file || null, heading: found?.heading };
      if (Keymap.isModifier(event, 'Mod')) this.scheduleTarget(this.hoveredTarget);
    }, true);
    previewEl.addEventListener('click', event => {
      if (event.defaultPrevented || event.target?.closest?.('a')) return;
      if (doc.defaultView?.getSelection?.()?.toString()) return; // selecting text to copy
      this.edit(entry, event);
    });
    if (!this.scoped && this.scope) { this.app.keymap?.pushScope(this.scope); this.scoped = true; }
    this.stack.push(entry);
    doc.body.append(el);
    const above = this.place(el, anchor, beside);
    el.classList?.toggle('is-cards-below', cardsBelowPreview(this.plugin.settings.popupCardsPosition, above));
    this.renderCards(entry, cardsEl);
    void entry.preview.show({ file, focus: focus || undefined });
  }

  renderCards(entry, cardsEl) {
    const files = this.related(entry.file);
    if (!files.length) { cardsEl.hidden = true; return; }
    const doc = cardsEl.ownerDocument;
    for (const file of files) {
      const card = doc.createElement('div');
      card.className = 'palmwiki-popover-card';
      card.palmwikiFile = file;
      card.title = file.path;
      const title = doc.createElement('div');
      title.className = 'palmwiki-popover-card-title';
      title.textContent = file.basename;
      const text = doc.createElement('div');
      text.className = 'palmwiki-popover-card-text';
      const cached = this.plugin.previews.get(file);
      text.textContent = cached === undefined ? '…' : cached || '';
      if (cached === undefined) {
        void this.plugin.previews.read(file, () => card.isConnected).then(value => {
          if (card.isConnected) text.textContent = value || '';
        });
      }
      card.append(title, text);
      card.addEventListener('click', event => {
        event.preventDefault();
        this.close();
        void this.app.workspace.openLinkText(file.path, '', Keymap.isModEvent(event)).catch(() => new Notice('ノートを開けませんでした。'));
      });
      cardsEl.append(card);
    }
  }

  // A card's popup goes off a corner of the card, overlapping that corner a little (below-right,
  // above-right, below-left, above-left: the first that fits, else the one with the most room), so
  // the cards beside and below it stay free to point at next. A link's popup goes just below the
  // link, or above it. Always inside the window. Returns whether it opened above the anchor.
  place(el, target, beside) {
    const win = target.ownerDocument.defaultView;
    const vw = win?.innerWidth || 1024;
    const vh = win?.innerHeight || 768;
    const width = Math.min(520, vw - 16);
    const height = Math.min(440, vh - 16);
    const r = target.getBoundingClientRect();
    let left;
    let top;
    let above;
    if (beside) {
      const o = 20; // overlap with the card's corner
      const corners = [
        [r.right - o, r.bottom - o, false], [r.right - o, r.top + o - height, true],
        [r.left + o - width, r.bottom - o, false], [r.left + o - width, r.top + o - height, true],
      ];
      const room = ([x, y]) => Math.max(0, Math.min(x + width, vw - 8) - Math.max(x, 8)) * Math.max(0, Math.min(y + height, vh - 8) - Math.max(y, 8));
      const best = corners.find(corner => room(corner) === width * height) || corners.reduce((a, b) => (room(b) > room(a) ? b : a));
      [left, top, above] = best;
    } else {
      left = r.left;
      top = r.bottom + 4;
      above = top + height > vh - 8;
      if (above) top = r.top - 4 - height;
    }
    left = Math.min(Math.max(8, left), vw - 8 - width);
    top = Math.min(Math.max(8, top), vh - 8 - height);
    Object.assign(el.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` });
    return above;
  }

  edit(entry, event) {
    // Taken before closing: a deeper popup's anchor is a link or card inside a popup that is about
    // to go, so the Home card anchors the handover.
    const card = this.stack[0];
    const box = entry.el.getBoundingClientRect?.();
    this.close();
    if (!card || entry.view.disposed || !card.anchor.isConnected) return;
    // Hover Editor opens 20 px below the pointer it is given; this puts it where the light popup was.
    const x = box ? box.left : event.clientX;
    const y = box ? box.top - 20 : event.clientY;
    // Sent as if Cmd were held: the click already asked for it, even when Settings → Page preview
    // requires Cmd for this source.
    const Ev = card.anchor.ownerDocument.defaultView?.MouseEvent;
    const hover = Ev ? new Ev('mouseover', { clientX: x, clientY: y, metaKey: true, ctrlKey: true }) : event;
    this.app.workspace.trigger('hover-link', {
      event: hover, source: HOVER_EDIT_SOURCE, hoverParent: entry.view, targetEl: card.anchor, linktext: entry.file.path, sourcePath: '',
    });
  }

  cancelClose() {
    if (this.closeTimer !== null) { clearTimeout(this.closeTimer); this.closeTimer = null; }
  }

  scheduleClose() {
    this.cancelClose();
    this.closeTimer = setTimeout(() => { this.closeTimer = null; this.close(); }, 300);
  }

  closeFrom(level) {
    while (this.stack.length > level) {
      const entry = this.stack.pop();
      entry.preview.dispose();
      entry.el.remove();
    }
    if (this.hoveredTarget && this.hoveredTarget.level >= level) this.hoveredTarget = null;
  }

  close() {
    this.cancelClose();
    this.cancelOpen();
    this.cancelChildClose();
    this.closeFrom(0);
    if (this.scoped) { this.app.keymap?.popScope(this.scope); this.scoped = false; }
  }

  // A view going away takes its popups with it.
  forget(view) {
    if (this.card?.view === view) this.close();
    if (this.hovered?.view === view) this.hovered = null;
  }

  dispose() {
    this.close();
    this.hovered = null;
    this.keyDoc?.removeEventListener('keydown', this.onKey, true);
    this.keyDoc?.removeEventListener('mousemove', this.onMove, true);
    this.keyDoc = null;
  }
}

// Rows come from sources in list order; a new source (e.g. another word list) is one more entry.
const SEARCH_SOURCES = [
  (search, query) => query ? [] : search.recent().map(file => ({ kind: 'note', file, recent: true })),
  (search, query) => query ? [{ kind: 'body', text: query }] : [],
  (search, query) => query ? matchNotes(search.notes(), query, search.recentPaths()).map(note => ({ kind: 'note', file: note.file, note })) : [],
  (search, query) => {
    const last = query.split(/\s+/).pop();
    return last ? complementWords(search.app, last).map(word => ({ kind: 'word', text: word })) : [];
  },
  (search, query, rows) => query && !rows.some(row => row.kind === 'note' && normalizeSearch(row.file.basename) === normalizeSearch(query))
    ? [{ kind: 'create', text: query }] : [],
];

class UnifiedSearch extends (SuggestModal || class {}) {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
    this.cache = null;
    this.rows = new WeakMap(); // suggestion element → row, for the preview pane
    this.pane = null;
    this.setPlaceholder?.('ノートを探す（Enterで本文検索）');
    this.setInstructions?.([
      { command: 'Enter', purpose: '本文を検索（↑↓で候補を選べばそのノート）' },
      { command: 'Cmd+Enter', purpose: '新しいタブで開く' },
      { command: 'Esc', purpose: '閉じる' },
    ]);
    // Same key as Omnisearch's screen: make (or open) the note named by the words, whatever row is selected.
    this.scope?.register?.(['Shift'], 'Enter', evt => {
      evt?.preventDefault?.();
      this.createFromInput();
      return false;
    });
  }

  createFromInput() {
    const query = (this.inputEl?.value || '').trim();
    if (!query) return;
    this.close();
    void this.plugin.createNote(query).catch(() => new Notice('ノートを作れませんでした。'));
  }

  onOpen() {
    super.onOpen?.();
    this.plugin.openSearchScreen = this;
    if (!this.plugin.settings.searchPreview || !this.modalEl) return;
    this.pane = new NotePreviewPane(this.app, this.modalEl, this.resultContainerEl, () => this.paneSelection(), {
      onLink: (link, source, event) => {
        this.close();
        void this.app.workspace.openLinkText(link, source, Keymap.isModEvent(event));
      },
    });
    this.pane.follow();
  }

  onClose() {
    super.onClose?.();
    if (this.plugin.openSearchScreen === this) this.plugin.openSearchScreen = null;
    this.pane?.dispose();
    this.pane = null;
  }

  // Not named `selection`: Obsidian's Modal already uses that property.
  paneSelection() {
    const el = this.resultContainerEl?.querySelector('.suggestion-item.is-selected');
    const row = el ? this.rows.get(el) : null;
    if (row?.kind === 'note') return { file: row.file };
    return { hint: row?.kind === 'body' ? 'Enter で Omnisearch の本文検索を開きます'
      : row?.kind === 'create' ? 'Enter でこの名前のノートを作ります'
      : row?.kind === 'word' ? '選ぶと入力に反映します' : '' };
  }

  notes() {
    if (!this.cache) this.cache = searchableNotes(this.app, this.plugin.settings.searchExcludeFolders);
    return this.cache;
  }

  recentPaths() {
    return this.app.workspace.getLastOpenFiles?.() || [];
  }

  recent() {
    const excluded = this.plugin.settings.searchExcludeFolders;
    return this.recentPaths().map(path => this.app.vault.getAbstractFileByPath(path))
      .filter(file => file instanceof TFile && file.extension === 'md' && !inFolders(file.path, excluded));
  }

  getSuggestions(input) {
    const query = input.trim();
    const rows = [];
    for (const source of SEARCH_SOURCES) rows.push(...source(this, query, rows));
    return rows;
  }

  renderSuggestion(row, el) {
    this.rows.set(el, row);
    const doc = el.ownerDocument;
    const title = doc.createElement('div');
    const meta = doc.createElement('small');
    meta.className = 'palmwiki-search-meta';
    if (row.kind === 'note') {
      title.textContent = row.file.basename;
      const terms = normalizeSearch(this.inputEl?.value || '').split(/\s+/).filter(Boolean);
      const viaAlias = row.note && terms.length && !terms.every(term => row.note.titleKey.includes(term));
      const alias = viaAlias ? row.note.aliases.find(a => terms.some(term => normalizeSearch(a).includes(term))) : null;
      const folder = row.file.parent?.path && row.file.parent.path !== '/' ? row.file.parent.path : '';
      meta.textContent = [row.recent ? '最近開いた' : '', alias ? `別名: ${alias}` : '', folder].filter(Boolean).join(' · ');
    } else if (row.kind === 'body') {
      title.textContent = `本文を検索：「${row.text}」`;
      meta.textContent = 'Omnisearch で開く';
    } else if (row.kind === 'word') {
      title.textContent = `語句の候補：${row.text}`;
      meta.textContent = 'Various Complements（選ぶと入力に反映）';
    } else {
      title.textContent = `新規作成：「${row.text}」`;
      meta.textContent = 'Shift+Enter';
    }
    title.className = 'palmwiki-search-title' + (row.kind === 'note' ? '' : ' is-action');
    el.append(title);
    if (meta.textContent) el.append(meta);
  }

  selectSuggestion(row, evt) {
    if (row.kind === 'word' && this.inputEl) {
      // Complete the last word and keep the screen open.
      const words = this.inputEl.value.split(/(\s+)/);
      words[words.length - 1] = row.text;
      this.inputEl.value = words.join('') + ' ';
      this.inputEl.dispatchEvent(new (this.inputEl.ownerDocument?.defaultView?.Event || Event)('input'));
      return;
    }
    super.selectSuggestion(row, evt);
  }

  onChooseSuggestion(row, evt) {
    if (row.kind === 'body') { this.plugin.searchBodies(row.text); return; }
    if (row.kind === 'create') { void this.plugin.createNote(row.text).catch(() => new Notice('ノートを作れませんでした。')); return; }
    if (row.kind !== 'note') return;
    const mode = evt && Keymap.isModEvent(evt);
    const leaf = mode ? this.app.workspace.getLeaf('tab') : this.app.workspace.getLeaf(false);
    void leaf.openFile(row.file, { active: true }).catch(() => new Notice('ノートを開けませんでした。'));
  }
}

class LiteSettings extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('p', { text: '一覧とフィルターはBases、検索とページ移動は選択した外部コマンドが担当します。' });
    let homeInput;
    new Setting(containerEl).setName('Homeの.baseファイル')
      .setDesc('初めてHomeを押したときだけ作成します。既存ファイル・ノート・設定は上書きしません。')
      .addText(text => { homeInput = text; text.setValue(this.plugin.settings.homePath); })
      .addButton(btn => btn.setButtonText('保存').onClick(async () => {
        const path = safeHomePath(homeInput.getValue());
        if (!path) { new Notice('隠しフォルダを除くVault内の.baseパスを指定してください。'); return; }
        this.plugin.settings.homePath = path;
        try { await this.plugin.saveSettings(); new Notice('Homeのパスを保存しました。'); }
        catch { new Notice('設定を保存できませんでした。'); }
      }));
    new Setting(containerEl).setName('Home ボタンの表示名')
      .setDesc(`タイトルバーの左に出す文字です。空にすると Vault 名（${this.app.vault.getName()}）を出します。幅が狭いときはアイコンだけになります。`)
      .addText(text => text.setPlaceholder(this.app.vault.getName()).setValue(this.plugin.settings.homeLabel).onChange(async value => {
        this.plugin.settings.homeLabel = value.slice(0, 80);
        this.plugin.refreshBars();
        try { await this.plugin.saveSettings(); } catch { new Notice('設定を保存できませんでした。'); }
      }));
    new Setting(containerEl).setName('Home ボタンのアイコン')
      .addDropdown(dropdown => {
        for (const [icon, name] of Object.entries(HOME_ICONS)) dropdown.addOption(icon, name);
        dropdown.setValue(this.plugin.settings.homeIcon).onChange(async value => {
          this.plugin.settings.homeIcon = HOME_ICONS[value] ? value : 'home';
          this.plugin.refreshBars();
          try { await this.plugin.saveSettings(); } catch { new Notice('設定を保存できませんでした。'); }
        });
      });
    new Setting(containerEl).setName('検索ボタンの動き')
      .setDesc('「統合検索」は最近のノート・題名と別名・本文検索（Omnisearch）・新規作成をまとめた検索画面です。Cmd+G も同じになります。「外部の検索コマンド」は、下で選んだコマンドを直接開きます。')
      .addDropdown(dropdown => dropdown
        .addOption('unified', '統合検索')
        .addOption('separate', '外部の検索コマンド')
        .setValue(this.plugin.settings.searchMode)
        .onChange(async value => {
          this.plugin.settings.searchMode = value === 'separate' ? 'separate' : 'unified';
          try { await this.plugin.saveSettings(); } catch { new Notice('設定を保存できませんでした。'); }
        }));
    new Setting(containerEl).setName('検索画面にプレビューを表示')
      .setDesc('選んでいる候補のノートを、検索画面の右側に表示します（幅の狭い画面では表示しません）。')
      .addToggle(toggle => toggle.setValue(this.plugin.settings.searchPreview).onChange(async value => {
        this.plugin.settings.searchPreview = value;
        try { await this.plugin.saveSettings(); } catch { new Notice('設定を保存できませんでした。'); }
      }));
    new Setting(containerEl).setName('Omnisearch の画面にもプレビューを表示')
      .setDesc('Omnisearch の検索画面の右側に、選んでいる結果のノートを表示し、検索語に印を付けます。')
      .addToggle(toggle => toggle.setValue(this.plugin.settings.omnisearchPreview).onChange(async value => {
        this.plugin.settings.omnisearchPreview = value;
        try { await this.plugin.saveSettings(); } catch { new Notice('設定を保存できませんでした。'); }
      }));
    new Setting(containerEl).setName('ホームのカードは軽いプレビューで表示')
      .setDesc('Cmd を押しながらカードにマウスを乗せると、読むだけの軽いプレビューを出します。中をクリックすると編集できるプレビュー（Hover Editor）に切り替わります。オフにすると、はじめから編集できるプレビューを出します。')
      .addToggle(toggle => toggle.setValue(this.plugin.settings.cardPopover).onChange(async value => {
        this.plugin.settings.cardPopover = value;
        if (!value) this.plugin.cardPopover?.close();
        try { await this.plugin.saveSettings(); } catch { new Notice('設定を保存できませんでした。'); }
      }));
    new Setting(containerEl).setName('小窓の開き方')
      .setDesc('「ホバーのみ」では、カードやリンクの上でマウスを約0.3秒止めると開きます（ボタンを押している間と、文字を打った直後は開きません）。どちらでも Cmd/Ctrl を押せばすぐ開きます。2hop-links-plus と同じです。')
      .addDropdown(dropdown => dropdown
        .addOption('mod', 'Cmd/Ctrl + ホバー')
        .addOption('hover', 'ホバーのみ')
        .setValue(this.plugin.settings.popupTrigger)
        .onChange(async value => {
          this.plugin.settings.popupTrigger = value === 'hover' ? 'hover' : 'mod';
          try { await this.plugin.saveSettings(); } catch { new Notice('設定を保存できませんでした。'); }
        }));
    new Setting(containerEl).setName('小窓の関連カードの列の位置')
      .setDesc('「自動」は、プレビューをマウスの近くに置き、列を遠い側に置きます。')
      .addDropdown(dropdown => dropdown
        .addOption('above', 'プレビューの上')
        .addOption('below', 'プレビューの下')
        .addOption('auto', '自動')
        .setValue(this.plugin.settings.popupCardsPosition)
        .onChange(async value => {
          this.plugin.settings.popupCardsPosition = ['below', 'auto'].includes(value) ? value : 'above';
          try { await this.plugin.saveSettings(); } catch { new Notice('設定を保存できませんでした。'); }
        }));
    new Setting(containerEl).setName('検索候補から外すフォルダ')
      .setDesc('まとめた検索の候補に出さないフォルダ（カンマ区切り）。')
      .addText(text => text.setValue(this.plugin.settings.searchExcludeFolders.join(', ')).onChange(async value => {
        this.plugin.settings.searchExcludeFolders = value.split(',').map(f => f.trim().replace(/\/+$/, '')).filter(Boolean).slice(0, 50);
        try { await this.plugin.saveSettings(); } catch { new Notice('設定を保存できませんでした。'); }
      }));
    new Setting(containerEl).setName('カードに画像を表示')
      .setDesc('最初のローカルPNG・JPEG・WebP（2 MiB以下）のみ。表示付近で読み込みます。')
      .addToggle(toggle => toggle.setValue(this.plugin.settings.showImages).onChange(async value => {
        this.plugin.settings.showImages = value;
        for (const view of this.plugin.cardViews) view.refreshImages();
        try { await this.plugin.saveSettings(); } catch { new Notice('設定を保存できませんでした。'); }
      }));
    const registry = commandBridge(this.app);
    const commands = (registry?.listCommands() || []).filter(c => !c.id.startsWith(`${this.plugin.manifest.id}:`))
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const [key, label] of [['searchCommand', '検索ボタン'], ['switchCommand', '移動ボタン']]) {
      new Setting(containerEl).setName(label).setDesc('OmnisearchやAnother Quick Switcherのコマンドを選んでください。')
        .addDropdown(dropdown => {
          dropdown.addOption('', '未設定');
          const selected = this.plugin.settings[key];
          if (selected && !commands.some(c => c.id === selected)) dropdown.addOption(selected, `${selected}（未登録）`);
          for (const command of commands) dropdown.addOption(command.id, command.name);
          dropdown.setValue(selected).onChange(async value => {
            this.plugin.settings[key] = value;
            try { await this.plugin.saveSettings(); } catch { new Notice('設定を保存できませんでした。'); }
          });
        });
    }
  }
}

module.exports = PalmWikiHome;

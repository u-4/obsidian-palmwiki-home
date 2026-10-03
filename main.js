'use strict';

const { Plugin, PluginSettingTab, Setting, Notice, TFile, BasesView, Keymap, setIcon, FuzzySuggestModal, SuggestModal, prepareFuzzySearch, normalizePath, MarkdownRenderer, Component } = require('obsidian');

const VIEW_TYPE = 'palmwiki-lite-cards';
const HOVER_SOURCE = 'palmwiki-home';
const INITIAL_CARDS = 24;
const CARD_STEP = 24;
const MAX_CARDS = 300;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp']);
const MAX_PREVIEW_BYTES = 512 * 1024;
const DEFAULTS = Object.freeze({
  homePath: 'PalmWiki Home.base',
  searchCommand: 'omnisearch:show-modal',
  switchCommand: '',
  showImages: true,
  searchMode: 'separate', // 'separate': the two buttons; 'unified': PalmWiki's own search screen (trial)
  searchExcludeFolders: ['99_System'],
  searchPreview: true,
  omnisearchPreview: true,
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
    this.settings.searchMode = saved?.searchMode === 'unified' ? 'unified' : 'separate';
    this.settings.searchPreview = saved?.searchPreview !== false;
    this.settings.omnisearchPreview = saved?.omnisearchPreview !== false;
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
    }
    // Command ids match PalmWiki Home 0.x so existing hotkeys keep working.
    this.addCommand({ id: 'open-home', name: 'Open home', callback: () => void this.openHome() });
    this.addCommand({ id: 'focus-search', name: 'Open search', callback: () => this.openSearch() });
    this.addCommand({ id: 'open-unified-search', name: 'Open unified search (trial)', callback: () => this.openUnifiedSearch() });
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
      const previous = this.bars.get(leaf);
      if (previous?.root === root && previous.bar.parentElement === root && previous.view === leaf.view) return;
      previous?.observer?.disconnect();
      previous?.bar.remove();
      const doc = root.ownerDocument;
      const bar = doc.createElement('div');
      bar.className = 'palmwiki-lite-nav';
      bar.setAttribute('role', 'toolbar');
      bar.setAttribute('aria-label', 'PalmWiki navigation');
      const actions = [
        ['home', 'Home', () => void this.openHome(leaf)],
        ['search', '検索', () => this.openSearch(leaf)],
        ['arrow-right-left', '移動', () => this.runExternal('switchCommand', leaf)],
      ];
      for (const [icon, label, action] of actions) {
        const el = button(doc, '', action, 'palmwiki-lite-nav-button');
        el.setAttribute('aria-label', label);
        el.title = label;
        const iconEl = doc.createElement('span');
        iconEl.setAttribute('aria-hidden', 'true');
        setIcon(iconEl, icon);
        el.append(iconEl, doc.createTextNode(label));
        bar.append(el);
      }
      // Own one small strip, rather than patching another plugin's title/search DOM.
      root.prepend(bar);
      const Observer = doc.defaultView?.MutationObserver;
      const observer = Observer ? new Observer(() => {
        if (bar.parentElement !== root) this.scheduleBars();
      }) : null;
      observer?.observe(root, { childList: true }); // No subtree/global DOM observer.
      this.bars.set(leaf, { root, view: leaf.view, bar, observer });
    });
    for (const [leaf, record] of this.bars) {
      if (!live.has(leaf)) {
        record.observer?.disconnect(); record.bar.remove(); this.bars.delete(leaf);
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
      this.scopeCache = { path: this.scope, members: scopeMembers(this.app, this.scope) };
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
    for (const record of this.bars?.values() || []) { record.observer?.disconnect(); record.bar.remove(); }
    this.bars?.clear();
    for (const view of [...(this.cardViews || [])]) view.dispose();
    this.cardViews?.clear();
    this.previews?.dispose();
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
        (!scope || scope.members.has(file.path) || !!mentions?.has(file.path)) &&
        (!body || body.has(file.path)),
    };
  }

  // Bodies are read only for these opt-in filters, only while the Home is scoped,
  // and never kept: the hits are file paths for the current scope and wording.
  ensureScans() {
    const scope = this.plugin.currentScope();
    if (scope && this.includeMentions) {
      const terms = mentionTerms(noteTitle(scope.path), this.plugin.aliasesOf(scope.path));
      const key = JSON.stringify([scope.path, terms]);
      if (this.scans.mentions?.key !== key) {
        const files = markdownFiles(this.data).filter(file => !scope.members.has(file.path));
        this.startScan('mentions', key, files, text => terms.some(term => text.includes(term)));
      }
    } else this.scans.mentions = null;
    if (scope && this.bodyQuery) {
      const terms = queryTerms(this.bodyQuery);
      const mentions = this.includeMentions ? this.scans.mentions : null;
      const key = JSON.stringify([scope.path, terms, !!mentions, !!mentions?.done]);
      if (this.scans.body?.key !== key) {
        const files = markdownFiles(this.data).filter(file => scope.members.has(file.path) || !!mentions?.hits.has(file.path));
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
    const sig = JSON.stringify([scope, favorites, this.includeDaily, this.includeMentions]);
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
    name.textContent = `「${noteTitle(scope)}」とリンクでつながるノート`;
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
    // Only announces the hover; Obsidian decides whether to preview (e.g. Cmd held).
    el.addEventListener('mouseover', event => {
      if (this.disposed) return;
      this.app.workspace.trigger('hover-link', { event, source: HOVER_SOURCE, hoverParent: this, targetEl: el, linktext: file.path, sourcePath: '' });
    });
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

// A pane beside a result list that renders the selected note with Obsidian's Markdown renderer.
// Shared by the unified search and Omnisearch's screen. `select()` returns { file } for a note
// row, { hint } for anything else; `terms()` gives words to mark and scroll to.
class NotePreviewPane {
  constructor(app, modalEl, resultEl, select, options = {}) {
    this.app = app;
    this.modalEl = modalEl;
    this.resultEl = resultEl;
    this.select = select;
    this.terms = options.terms || (() => []);
    this.onLink = options.onLink || null;
    this.key = undefined;
    this.timer = null;
    this.waitTimer = null;
    this.waits = 0;
    this.token = 0;
    this.component = null;
    this.file = null;
    const doc = modalEl.ownerDocument;
    modalEl.classList?.add('palmwiki-search-modal');
    this.el = doc.createElement('div');
    this.el.className = 'palmwiki-search-preview markdown-rendered';
    this.el.addEventListener('click', event => {
      const link = event.target?.closest?.('a.internal-link');
      if (!link || !this.onLink) return;
      event.preventDefault();
      this.onLink(link.dataset.href || link.getAttribute('href') || '', this.file?.path || '', event);
    });
    modalEl.append(this.el);
    // Obsidian (and Omnisearch) handle the arrow keys themselves, so the selection is watched instead.
    const Observer = doc.defaultView?.MutationObserver;
    if (Observer && resultEl) {
      this.observer = new Observer(() => this.follow());
      this.observer.observe(resultEl, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
    }
  }

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
    this.timer = setTimeout(() => { this.timer = null; void this.show(selected); }, 60);
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
    this.observer?.disconnect();
    if (this.timer !== null) clearTimeout(this.timer);
    if (this.waitTimer !== null) clearTimeout(this.waitTimer);
    this.timer = null;
    this.waitTimer = null;
    this.token++;
    this.component?.unload();
    this.component = null;
    this.el.remove();
    this.modalEl.classList?.remove('palmwiki-search-modal');
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
    new Setting(containerEl).setName('検索ボタンの動き')
      .setDesc('「まとめる」は試験中の検索画面です（最近のノート・題名と別名・本文検索・新規作成）。Cmd+G も同じになります。')
      .addDropdown(dropdown => dropdown
        .addOption('separate', '別々（検索と移動の2ボタン）')
        .addOption('unified', 'まとめる（試験）')
        .setValue(this.plugin.settings.searchMode)
        .onChange(async value => {
          this.plugin.settings.searchMode = value === 'unified' ? 'unified' : 'separate';
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

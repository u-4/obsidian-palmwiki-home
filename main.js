'use strict';

const { Plugin, PluginSettingTab, Setting, Notice, TFile, BasesView, Keymap, setIcon, FuzzySuggestModal } = require('obsidian');

const VIEW_TYPE = 'palmwiki-lite-cards';
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
});
const MAX_FAVORITES = 100;
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
// A scope ({ path, members }) filters before the 300 cap and puts its own note first.
function cardWindow(data, limit, scope = null) {
  const files = [];
  let total = 0;
  let head = null;
  for (const group of data?.groupedData || []) {
    for (const entry of group.entries) {
      if (entry.file.extension !== 'md') continue;
      if (scope && !scope.members.has(entry.file.path)) continue;
      total++;
      if (scope && entry.file.path === scope.path) { head = entry.file; continue; }
      if (files.length < MAX_CARDS) files.push(entry.file);
    }
  }
  if (head) { files.unshift(head); if (files.length > MAX_CARDS) files.pop(); }
  return { files, total, shown: files.slice(0, Math.min(MAX_CARDS, Math.max(INITIAL_CARDS, limit))) };
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
    // Command ids match PalmWiki Home 0.x so existing hotkeys keep working.
    this.addCommand({ id: 'open-home', name: 'Open home', callback: () => void this.openHome() });
    this.addCommand({ id: 'focus-search', name: 'Open search', callback: () => this.runExternal('searchCommand') });
    this.addCommand({ id: 'open-switcher', name: 'Open page switcher', callback: () => this.runExternal('switchCommand') });
    this.addCommand({ id: 'open-scope', name: 'Open project or area', callback: () => this.openScopePicker(null, true) });
    this.addRibbonIcon('home', 'PalmWiki Home', () => void this.openHome());
    this.addRibbonIcon('search', '外部検索', () => this.runExternal('searchCommand'));
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
        ['search', '検索', () => this.runExternal('searchCommand', leaf)],
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
    const doc = parent.ownerDocument;
    this.root = doc.createElement('div');
    this.root.className = 'palmwiki-lite-home';
    this.scopeBar = doc.createElement('div');
    this.scopeBar.className = 'palmwiki-scope';
    this.scopeSig = null;
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
      const window = cardWindow(this.data, this.limit, this.plugin.currentScope());
      this.files = window.files; this.total = window.total;
      this.render();
    });
  }

  resetScope() {
    if (this.disposed) return;
    this.limit = INITIAL_CARDS;
    this.parent.scrollTop = 0; this.lastScrollTop = 0;
    const window = cardWindow(this.data, this.limit, this.plugin.currentScope());
    this.files = window.files; this.total = window.total;
    this.render();
  }

  renderScopeBar() {
    if (this.disposed) return;
    const plugin = this.plugin;
    const scope = plugin.scope;
    const favorites = plugin.settings.favoriteScopes;
    const sig = JSON.stringify([scope, favorites]);
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
    this.status.textContent = this.total ? `${shown.length} / ${this.total}件` :
      this.plugin.scope ? 'つながるノートはありません' : 'ノートはありません';
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
    this.observer?.disconnect();
    this.imageQueue.clear();
    for (const card of this.cards.values()) this.releaseImage(card);
    this.cards.clear(); this.files = [];
    this.root.remove(); this.plugin.cardViews.delete(this);
  }
}

class ScopePicker extends (FuzzySuggestModal || class {}) {
  constructor(app, plugin, choose) {
    super(app);
    this.plugin = plugin;
    this.choose = choose;
    this.items = null;
    this.setPlaceholder?.('プロジェクト・エリアを検索（名前・別名）');
  }

  getItems() {
    if (this.items) return this.items;
    const favorites = this.plugin.settings.favoriteScopes;
    const rank = item => favorites.includes(item.path) ? 0 : DONE_STATUSES.has(item.status.toLowerCase()) ? 2 : 1;
    const kinds = Object.keys(SCOPE_KINDS);
    const items = listScopes(this.app).sort((a, b) => rank(a) - rank(b) ||
      (rank(a) === 0 ? favorites.indexOf(a.path) - favorites.indexOf(b.path) : 0) ||
      kinds.indexOf(a.kind) - kinds.indexOf(b.kind) || a.title.localeCompare(b.title, 'ja'));
    this.items = [{ all: true, path: null, title: 'すべてのノート', kind: '', status: '', aliases: [] }, ...items];
    return this.items;
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

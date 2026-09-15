'use strict';

const { Plugin, PluginSettingTab, Setting, Notice, TFile, BasesView, Keymap, setIcon } = require('obsidian');

const VIEW_TYPE = 'palmwiki-lite-cards';
const PAGE_SIZE = 60;
const MAX_PREVIEW_BYTES = 512 * 1024;
const DEFAULTS = Object.freeze({
  homePath: 'PalmWiki Home.base',
  searchCommand: 'omnisearch:show-modal',
  switchCommand: '',
});

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

function pageWindow(files, requestedPage) {
  const last = Math.max(0, Math.ceil(files.length / PAGE_SIZE) - 1);
  const page = Math.min(last, Math.max(0, Number.isInteger(requestedPage) ? requestedPage : 0));
  return { page, last, files: files.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE) };
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

class PalmWikiHomeLite extends Plugin {
  async onload() {
    const saved = await this.loadData();
    this.settings = { ...DEFAULTS };
    if (saved && typeof saved === 'object') {
      this.settings.homePath = safeHomePath(saved.homePath) || DEFAULTS.homePath;
      for (const key of ['searchCommand', 'switchCommand']) {
        if (typeof saved[key] === 'string' && saved[key].length < 512) this.settings[key] = saved[key];
      }
    }
    this.disposed = false;
    this.bars = new Map();
    this.cardViews = new Set();
    this.homePromise = null;
    this.syncTimer = null;
    this.saveChain = Promise.resolve();
    if (typeof this.registerBasesView !== 'function' || typeof BasesView !== 'function') {
      new Notice('PalmWiki Home LiteにはBasesビュー対応版のObsidianが必要です。');
      return;
    }
    this.registerBasesView(VIEW_TYPE, {
      name: 'PalmWiki cards', icon: 'layout-grid',
      factory: (controller, container) => new LiteCards(controller, container, this),
    });
    this.addSettingTab(new LiteSettings(this.app, this));
    this.addCommand({ id: 'home', name: 'Open home', callback: () => void this.openHome() });
    this.addCommand({ id: 'search', name: 'Open external search', callback: () => this.runExternal('searchCommand') });
    this.addCommand({ id: 'switch', name: 'Open external page switcher', callback: () => this.runExternal('switchCommand') });
    this.addRibbonIcon('home', 'PalmWiki Home Lite', () => void this.openHome());
    this.addRibbonIcon('search', '外部検索', () => this.runExternal('searchCommand'));
    this.app.workspace.onLayoutReady(() => {
      if (this.disposed) return;
      for (const name of ['layout-change', 'active-leaf-change', 'file-open', 'window-open', 'window-close']) {
        this.registerEvent(this.app.workspace.on(name, () => this.scheduleBars()));
      }
      this.syncBars();
      const registry = commandBridge(this.app);
      if (registry?.listCommands().some(c => c.id === 'palmwiki-home:open-home')) {
        new Notice('速度を比較する際は、旧PalmWiki Homeを無効にしてください。Liteは旧版を自動変更しません。', 10000);
      }
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

  runExternal(key, leaf) {
    if (this.disposed) return;
    try {
      if (leaf) this.app.workspace.setActiveLeaf(leaf, { focus: true });
      const registry = commandBridge(this.app);
      const id = this.settings[key];
      if (!registry || !id || id.startsWith(`${this.manifest.id}:`) || !registry.listCommands().some(c => c.id === id)) {
        new Notice('PalmWiki Home Liteの設定で、インストール済みの外部プラグインのコマンドを選んでください。');
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
  }
}

class LiteCards extends BasesView {
  constructor(controller, parent, plugin) {
    super(controller);
    this.type = VIEW_TYPE;
    this.plugin = plugin;
    this.parent = parent;
    this.page = 0;
    this.files = [];
    this.cards = new Map();
    this.pending = new Map();
    this.activeReads = 0;
    this.renderFrame = null;
    this.disposed = false;
    const doc = parent.ownerDocument;
    this.root = doc.createElement('div');
    this.root.className = 'palmwiki-lite-home';
    this.controls = doc.createElement('div');
    this.controls.className = 'palmwiki-lite-paging';
    this.prev = button(doc, '前へ', () => this.changePage(-1));
    this.status = doc.createElement('span');
    this.status.setAttribute('role', 'status');
    this.next = button(doc, '次へ', () => this.changePage(1));
    this.controls.append(this.prev, this.status, this.next);
    this.grid = doc.createElement('div');
    this.grid.className = 'palmwiki-lite-grid';
    this.root.append(this.controls, this.grid);
    parent.append(this.root);
    const Observer = doc.defaultView?.IntersectionObserver;
    this.observer = Observer ? new Observer(entries => {
      for (const entry of entries) if (entry.isIntersecting) {
        const card = this.cards.get(entry.target.dataset.path);
        if (card) this.queuePreview(card);
        this.observer.unobserve(entry.target);
      }
    }, { root: parent, rootMargin: '200px' }) : null;
    plugin.cardViews.add(this);
    this.register(() => this.dispose());
  }

  onDataUpdated() {
    if (this.disposed || this.renderFrame !== null) return;
    const win = this.root.ownerDocument.defaultView;
    this.renderFrame = win.requestAnimationFrame(() => {
      this.renderFrame = null;
      if (this.disposed) return;
      // Bases supplies the filtered/sorted file references. No Vault scan, graph,
      // full-body index or duplicate sort here. Group order is preserved.
      this.files = (this.data?.groupedData || []).flatMap(group => group.entries)
        .map(entry => entry.file).filter(file => file.extension === 'md');
      this.render();
    });
  }

  goFirst() { this.page = 0; this.render(); this.parent.scrollTop = 0; }
  changePage(delta) { this.page += delta; this.render(); this.parent.scrollTop = 0; }

  render() {
    if (this.disposed) return;
    const window = pageWindow(this.files, this.page);
    this.page = window.page;
    this.prev.disabled = this.page === 0;
    this.next.disabled = this.page === window.last;
    this.status.textContent = this.files.length ?
      `${this.page * PAGE_SIZE + 1}–${Math.min((this.page + 1) * PAGE_SIZE, this.files.length)} / ${this.files.length}` : 'ノートはありません';
    const wanted = new Set(window.files.map(file => file.path));
    for (const [path, card] of this.cards) {
      if (!wanted.has(path)) {
        this.observer?.unobserve(card.el); card.el.remove(); this.cards.delete(path); this.pending.delete(path);
      }
    }
    for (const file of window.files) {
      let card = this.cards.get(file.path);
      if (!card || card.mtime !== file.stat.mtime || card.size !== file.stat.size) {
        if (card) { this.observer?.unobserve(card.el); card.el.remove(); this.pending.delete(file.path); }
        card = this.makeCard(file);
        this.cards.set(file.path, card);
        if (this.observer) this.observer.observe(card.el);
        else this.queuePreview(card);
      }
      // Append moves existing elements, preserving their previews and listeners.
      this.grid.append(card.el);
    }
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
    const preview = doc.createElement('div'); preview.className = 'palmwiki-lite-preview'; preview.textContent = '…';
    el.append(title, preview);
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
    return { el, preview, file, path: file.path, mtime: file.stat.mtime, size: file.stat.size, queued: false };
  }

  queuePreview(card) {
    if (this.disposed || card.queued || this.cards.get(card.path) !== card) return;
    card.queued = true;
    if (card.size > MAX_PREVIEW_BYTES) { card.preview.textContent = '大きなノート：開いて読む'; return; }
    this.pending.set(card.path, card);
    this.drain();
  }

  drain() {
    while (!this.disposed && this.activeReads < 2 && this.pending.size) {
      const [path, card] = this.pending.entries().next().value;
      this.pending.delete(path);
      if (this.cards.get(path) !== card) continue;
      this.activeReads++;
      void this.app.vault.cachedRead(card.file).then(body => {
        if (this.disposed || this.cards.get(path) !== card) return;
        const current = this.app.vault.getAbstractFileByPath(path);
        if (!(current instanceof TFile) || current.stat.mtime !== card.mtime || current.stat.size !== card.size) return;
        card.preview.textContent = excerpt(body) || '本文プレビューなし';
      }).catch(() => {
        if (!this.disposed && this.cards.get(path) === card) card.preview.textContent = 'プレビューを取得できませんでした';
      }).finally(() => { this.activeReads--; this.drain(); });
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.renderFrame !== null) this.root.ownerDocument.defaultView?.cancelAnimationFrame(this.renderFrame);
    this.observer?.disconnect(); this.pending.clear(); this.cards.clear(); this.files = [];
    this.root.remove(); this.plugin.cardViews.delete(this);
  }
}

class LiteSettings extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('p', { text: '一覧とフィルターはBases、検索とページ移動は選択した外部コマンドが担当します。旧PalmWiki Homeは無効にして比較してください。' });
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

module.exports = PalmWikiHomeLite;

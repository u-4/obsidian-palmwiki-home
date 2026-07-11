import { PluginSettingTab, Setting } from "obsidian";
import type PalmWikiHomePlugin from "../main";
import {
  formatFolderListInput,
  formatLineListInput,
  parseFolderListInput,
  parseLineListInput,
  type PalmWikiCardSize,
  type PalmWikiSortDirection,
  type PalmWikiSortKey,
  type PalmWikiViewMode
} from "./Settings";

export class PalmWikiHomeSettingTab extends PluginSettingTab {
  private plugin: PalmWikiHomePlugin;

  constructor(plugin: PalmWikiHomePlugin) {
    super(plugin.app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "PalmWiki Home" });

    new Setting(containerEl)
      .setName("Include folders")
      .setDesc("One folder path per line, or comma-separated. Empty means all folders.")
      .addTextArea((text) => {
        text
          .setPlaceholder("Notes\nProjects")
          .setValue(formatFolderListInput(this.plugin.settings.includeFolders))
          .onChange(async (value) => {
            await this.plugin.updateSettings(
              { includeFolders: parseFolderListInput(value) },
              true
            );
          });

        text.inputEl.rows = 4;
        text.inputEl.addClass("palmwiki-settings-textarea");
      });

    new Setting(containerEl)
      .setName("Exclude folders")
      .setDesc("Excluded folders win over included folders.")
      .addTextArea((text) => {
        text
          .setPlaceholder("Archive\nPrivate")
          .setValue(formatFolderListInput(this.plugin.settings.excludeFolders))
          .onChange(async (value) => {
            await this.plugin.updateSettings(
              { excludeFolders: parseFolderListInput(value) },
              true
            );
          });

        text.inputEl.rows = 4;
        text.inputEl.addClass("palmwiki-settings-textarea");
      });

    new Setting(containerEl)
      .setName("Default view")
      .addDropdown((dropdown) => {
        dropdown
          .addOption("card", "Card")
          .addOption("table", "Table")
          .setValue(this.plugin.settings.defaultViewMode)
          .onChange(async (value) => {
            await this.plugin.updateSettings(
              { defaultViewMode: value as PalmWikiViewMode },
              false
            );
          });
      });

    new Setting(containerEl)
      .setName("Default sort")
      .addDropdown((dropdown) => {
        dropdown
          .addOption("modified", "Updated time")
          .addOption("created", "Created time")
          .addOption("title", "Title")
          .addOption("lines", "Line count")
          .addOption("chars", "Character count")
          .addOption("pageRank", "Page rank")
          .addOption("inlinks", "Inlinks")
          .addOption("outlinks", "Outlinks")
          .setValue(this.plugin.settings.defaultSortKey)
          .onChange(async (value) => {
            await this.plugin.updateSettings(
              { defaultSortKey: value as PalmWikiSortKey },
              false
            );
          });
      });

    new Setting(containerEl)
      .setName("Default sort direction")
      .addDropdown((dropdown) => {
        dropdown
          .addOption("asc", "Ascending")
          .addOption("desc", "Descending")
          .setValue(this.plugin.settings.defaultSortDirection)
          .onChange(async (value) => {
            await this.plugin.updateSettings(
              { defaultSortDirection: value as PalmWikiSortDirection },
              false
            );
          });
      });

    new Setting(containerEl)
      .setName("Show folders on cards")
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.showFoldersOnCards)
          .onChange(async (value) => {
            await this.plugin.updateSettings({ showFoldersOnCards: value }, false);
          });
      });

    new Setting(containerEl)
      .setName("Show tags on cards")
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.showTagsOnCards)
          .onChange(async (value) => {
            await this.plugin.updateSettings({ showTagsOnCards: value }, false);
          });
      });

    new Setting(containerEl)
      .setName("Card size")
      .addDropdown((dropdown) => {
        dropdown
          .addOption("small", "Small")
          .addOption("medium", "Medium")
          .addOption("large", "Large")
          .setValue(this.plugin.settings.cardSize)
          .onChange(async (value) => {
            await this.plugin.updateSettings({ cardSize: value as PalmWikiCardSize }, false);
          });
      });

    new Setting(containerEl)
      .setName("Index on startup")
      .setDesc(
        "When enabled, indexing starts only after the workspace is ready and Obsidian becomes idle. When disabled, PalmWiki Home indexes lazily after its view is shown."
      )
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.indexOnStartup)
          .onChange(async (value) => {
            await this.plugin.updateSettings({ indexOnStartup: value }, value);
          });
      });

    new Setting(containerEl)
      .setName("Persistent index cache")
      .setDesc(
        "PalmWiki Home stores derived page metadata in index-cache.json inside this Vault's plugin folder, including titles, paths, tags, links, statistics, and an approximately 180-character body-derived description per note. It does not store full note bodies, and the cache is rebuilt safely when settings or files change."
      );

    new Setting(containerEl)
      .setName("Performance debug logging")
      .setDesc("Log PalmWiki Home timing details to the developer console.")
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.performanceDebug)
          .onChange(async (value) => {
            await this.plugin.updateSettings({ performanceDebug: value }, false);
          });
      });

    new Setting(containerEl)
      .setName("PageRank ignored source folders")
      .setDesc("One folder path per line. Links from these source pages do not pass PageRank authority, but link counts stay factual.")
      .addTextArea((text) => {
        text
          .setPlaceholder("01_Daily\nJournal")
          .setValue(formatFolderListInput(this.plugin.settings.pageRankIgnoredSourceFolders))
          .onChange(async (value) => {
            await this.plugin.updateSettings(
              { pageRankIgnoredSourceFolders: parseFolderListInput(value) },
              true
            );
          });

        text.inputEl.rows = 4;
        text.inputEl.addClass("palmwiki-settings-textarea");
      });

    new Setting(containerEl)
      .setName("PageRank ignored source path patterns")
      .setDesc("One regex or substring per line. Matching source pages do not pass PageRank authority.")
      .addTextArea((text) => {
        text
          .setPlaceholder("(^|/)日記\\.md$\n(^|/)Daily Notes/")
          .setValue(
            formatLineListInput(this.plugin.settings.pageRankIgnoredSourcePathPatterns)
          )
          .onChange(async (value) => {
            await this.plugin.updateSettings(
              { pageRankIgnoredSourcePathPatterns: parseLineListInput(value) },
              true
            );
          });

        text.inputEl.rows = 4;
        text.inputEl.addClass("palmwiki-settings-textarea");
      });

    new Setting(containerEl)
      .setName("PageRank debug path")
      .setDesc("Optional page path. When performance debug logging is on, the next index rebuild logs why this page ranks high.")
      .addText((text) => {
        text
          .setPlaceholder("Folder/Page.md")
          .setValue(this.plugin.settings.pageRankDebugPath)
          .onChange(async (value) => {
            await this.plugin.updateSettings({ pageRankDebugPath: value.trim() }, true);
          });
      });
  }
}

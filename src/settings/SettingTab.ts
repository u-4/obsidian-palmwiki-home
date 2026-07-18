import { PluginSettingTab, Setting } from "obsidian";
import { HOME_BUTTON_SETTING_DESCRIPTION } from "../homeNavigation";
import type PalmWikiHomePlugin from "../main";
import {
  CARD_PREVIEW_MODE_OPTIONS,
  isCardPreviewMode
} from "../cardPreview";
import {
  DEFAULT_SQUARE_TWO_COLUMN_MAX_WIDTH,
  formatFolderListInput,
  formatLineListInput,
  MAX_SQUARE_TWO_COLUMN_MAX_WIDTH,
  MIN_SQUARE_TWO_COLUMN_MAX_WIDTH,
  parseFolderListInput,
  parseLineListInput,
  type PalmWikiCardShape,
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
    this.renderSettings();
  }

  private renderSettings(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Home button")
      .setDesc(HOME_BUTTON_SETTING_DESCRIPTION)
      .setHeading();

    new Setting(containerEl)
      .setName("Home button label")
      .setDesc(
        "Text shown at the upper-left of Markdown and PalmWiki Home tabs. Leave blank to use the current vault name."
      )
      .addText((text) => {
        text
          .setPlaceholder(this.app.vault.getName())
          .setValue(this.plugin.settings.homeButtonLabel)
          .onChange(async (value) => {
            await this.plugin.updateSettings({ homeButtonLabel: value }, false);
          });
      });

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
      .setName("Card shape")
      .setDesc(
        "Portrait keeps all card metadata. Square uses the available column width as its height and hides secondary metadata."
      )
      .addDropdown((dropdown) => {
        dropdown
          .addOption("portrait", "Portrait")
          .addOption("square", "Square")
          .setValue(this.plugin.settings.cardShape)
          .onChange(async (value) => {
            await this.plugin.updateSettings(
              { cardShape: value as PalmWikiCardShape },
              false
            );
          });
      });

    new Setting(containerEl)
      .setName("Square two-column maximum width")
      .setDesc(
        `Square cards stay at exactly two columns from 276 CSS px through this card-area width. Narrower areas use one column; above it, columns adapt to Card size. Recommended: ${DEFAULT_SQUARE_TWO_COLUMN_MAX_WIDTH} CSS px. Allowed: ${MIN_SQUARE_TWO_COLUMN_MAX_WIDTH}-${MAX_SQUARE_TWO_COLUMN_MAX_WIDTH}.`
      )
      .addText((text) => {
        text.inputEl.type = "number";
        text.inputEl.inputMode = "numeric";
        text.inputEl.min = String(MIN_SQUARE_TWO_COLUMN_MAX_WIDTH);
        text.inputEl.max = String(MAX_SQUARE_TWO_COLUMN_MAX_WIDTH);
        text.inputEl.step = "1";
        text.inputEl.addEventListener("blur", () => {
          text.inputEl.value = String(
            this.plugin.settings.squareTwoColumnMaxWidth
          );
        });
        text
          .setValue(String(this.plugin.settings.squareTwoColumnMaxWidth))
          .onChange(async (value) => {
            const nextValue = Number(value);
            if (
              !Number.isFinite(nextValue) ||
              nextValue < MIN_SQUARE_TWO_COLUMN_MAX_WIDTH ||
              nextValue > MAX_SQUARE_TWO_COLUMN_MAX_WIDTH
            ) {
              return;
            }

            await this.plugin.updateSettings(
              { squareTwoColumnMaxWidth: Math.round(nextValue) },
              false
            );
          });
      })
      .addExtraButton((button) => {
        button
          .setIcon("rotate-ccw")
          .setTooltip("Restore the recommended width")
          .onClick(async () => {
            await this.plugin.updateSettings(
              {
                squareTwoColumnMaxWidth:
                  DEFAULT_SQUARE_TWO_COLUMN_MAX_WIDTH
              },
              false
            );
            this.renderSettings();
          });
      });

    new Setting(containerEl)
      .setName("Card preview")
      .setDesc(
        "Show Obsidian's standard page preview from cards. Pin buttons never open a preview. The page preview core plugin must be enabled."
      )
      .addDropdown((dropdown) => {
        for (const [value, label] of Object.entries(CARD_PREVIEW_MODE_OPTIONS)) {
          dropdown.addOption(value, label);
        }
        dropdown
          .setValue(this.plugin.settings.cardPreviewMode)
          .onChange(async (value) => {
            if (!isCardPreviewMode(value)) {
              return;
            }
            await this.plugin.updateSettings({ cardPreviewMode: value }, false);
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
      .setName("Persistent display index cache")
      .setDesc(
        "PalmWiki Home stores derived page metadata in index-cache.json inside this Vault's plugin folder, including titles, paths, tags, links, statistics, and an approximately 180-character body-derived description per note. This display cache does not store full note bodies; full-text search uses the separate cache described below."
      );

    new Setting(containerEl)
      .setName("Persistent full-text search cache")
      .setDesc(
        "PalmWiki Home stores a normalized, locally searchable copy of included Markdown note text in a separate search-cache.json file inside this Vault's plugin folder. It loads lazily after PalmWiki Home opens, updates changed notes only, and writes after editing has been quiet. The cache is never sent to an external service."
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

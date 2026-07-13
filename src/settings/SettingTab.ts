import { App, FuzzySuggestModal, PluginSettingTab, Setting, TFile } from "obsidian";
import {
  HOME_BUTTON_ACTION_OPTIONS,
  HOME_BUTTON_SETTING_DESCRIPTION,
  HOME_COMMAND_SETTING_DESCRIPTION,
  HOME_PAGE_SETTING_DESCRIPTION,
  isHomeButtonAction
} from "../homeNavigation";
import type PalmWikiHomePlugin from "../main";
import { listCommandsCompat, type RuntimeCommandInfo } from "../obsidianCompat";
import {
  CARD_PREVIEW_MODE_OPTIONS,
  isCardPreviewMode
} from "../cardPreview";
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

class HomePageSuggestModal extends FuzzySuggestModal<TFile> {
  constructor(
    app: App,
    private files: TFile[],
    private onChoose: (file: TFile) => Promise<void>
  ) {
    super(app);
    this.setPlaceholder("Choose a home page…");
  }

  getItems(): TFile[] {
    return this.files;
  }

  getItemText(file: TFile): string {
    return file.path;
  }

  onChooseItem(file: TFile): void {
    void this.onChoose(file);
  }
}

class HomeCommandSuggestModal extends FuzzySuggestModal<RuntimeCommandInfo> {
  constructor(
    app: App,
    private commands: RuntimeCommandInfo[],
    private onChoose: (command: RuntimeCommandInfo) => Promise<void>
  ) {
    super(app);
    this.setPlaceholder("Choose a home command…");
  }

  getItems(): RuntimeCommandInfo[] {
    return this.commands;
  }

  getItemText(command: RuntimeCommandInfo): string {
    return `${command.name} (${command.id})`;
  }

  onChooseItem(command: RuntimeCommandInfo): void {
    void this.onChoose(command);
  }
}

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

    new Setting(containerEl).setName("Home button").setHeading();

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
      .setName("Home button action")
      .setDesc(HOME_BUTTON_SETTING_DESCRIPTION)
      .addDropdown((dropdown) => {
        for (const [value, label] of Object.entries(HOME_BUTTON_ACTION_OPTIONS)) {
          dropdown.addOption(value, label);
        }
        dropdown
          .setValue(this.plugin.settings.homeButtonAction)
          .onChange(async (value) => {
            if (!isHomeButtonAction(value)) {
              return;
            }
            await this.plugin.updateSettings({ homeButtonAction: value }, false);
            this.redisplay();
          });
      });

    if (this.plugin.settings.homeButtonAction === "page") {
      this.createHomePageSetting();
    } else if (this.plugin.settings.homeButtonAction === "command") {
      this.createHomeCommandSetting();
    }

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

  private createHomePageSetting(): void {
    const setting = new Setting(this.containerEl)
      .setName("Home page")
      .setDesc(HOME_PAGE_SETTING_DESCRIPTION)
      .addText((text) => {
        text
          .setPlaceholder("Home or folder/Home.md")
          .setValue(this.plugin.settings.homeButtonPagePath)
          .onChange(async (value) => {
            await this.plugin.updateSettings({ homeButtonPagePath: value }, false);
          });
      })
      .addButton((button) => {
        button.setButtonText("Choose page…").onClick(() => {
          const files = [...this.app.vault.getMarkdownFiles()].sort((left, right) =>
            left.path.localeCompare(right.path)
          );
          new HomePageSuggestModal(this.app, files, async (file) => {
            await this.plugin.updateSettings({ homeButtonPagePath: file.path }, false);
            this.redisplay();
          }).open();
        });
      });

    if (this.plugin.settings.homeButtonPagePath) {
      setting.addExtraButton((button) => {
        button
          .setIcon("x")
          .setTooltip("Clear home page")
          .onClick(async () => {
            await this.plugin.updateSettings({ homeButtonPagePath: "" }, false);
            this.redisplay();
          });
      });
    }
  }

  private createHomeCommandSetting(): void {
    const commands = listCommandsCompat(this.app);
    const selectedId = this.plugin.settings.homeButtonCommandId;
    const selectedCommand = commands.find((command) => command.id === selectedId);
    const selectionDescription = selectedId
      ? selectedCommand
        ? `Selected: ${selectedCommand.name}.`
        : `The selected command is currently unavailable: ${selectedId}.`
      : commands.length === 0
        ? "The command list is unavailable in this Obsidian version."
        : "No command is selected yet.";

    const setting = new Setting(this.containerEl)
      .setName("Home command")
      .setDesc(`${HOME_COMMAND_SETTING_DESCRIPTION} ${selectionDescription}`)
      .addButton((button) => {
        button
          .setButtonText(selectedId ? "Change command…" : "Choose command…")
          .setDisabled(commands.length === 0)
          .onClick(() => {
            new HomeCommandSuggestModal(
              this.app,
              listCommandsCompat(this.app),
              async (command) => {
                await this.plugin.updateSettings(
                  { homeButtonCommandId: command.id },
                  false
                );
                this.redisplay();
              }
            ).open();
          });
      });

    if (selectedId) {
      setting.addExtraButton((button) => {
        button
          .setIcon("x")
          .setTooltip("Clear home command")
          .onClick(async () => {
            await this.plugin.updateSettings({ homeButtonCommandId: "" }, false);
            this.redisplay();
          });
      });
    }
  }

  private redisplay(): void {
    this.renderSettings();
  }
}

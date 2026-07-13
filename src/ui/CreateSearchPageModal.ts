import { Modal, normalizePath, Setting, type App } from "obsidian";
import { validateNewPageName } from "../homeSearch";

export interface CreateSearchPageRequest {
  name: string;
  path: string;
}

export class CreateSearchPageModal extends Modal {
  private name: string;
  private path = "";
  private feedbackEl: HTMLElement | null = null;
  private submitButton: HTMLButtonElement | null = null;

  constructor(
    app: App,
    initialName: string,
    private onConfirm: (request: CreateSearchPageRequest) => Promise<void>
  ) {
    super(app);
    this.name = initialName.trim();
  }

  onOpen(): void {
    this.titleEl.setText("Create a new PalmWiki page");
    this.contentEl.empty();
    this.contentEl.createEl("p", {
      text: "Confirm the page name and Obsidian's configured new-note folder. Nothing is created until you choose the create button."
    });

    new Setting(this.contentEl)
      .setName("Page name")
      .addText((text) => {
        text
          .setPlaceholder("New page")
          .setValue(this.name)
          .onChange((value) => {
            this.name = value;
            this.updateValidation();
          });
        text.inputEl.addEventListener("keydown", (event) => {
          if (event.key === "Enter" && !event.isComposing && !this.submitButton?.disabled) {
            event.preventDefault();
            this.submitButton?.click();
          }
        });
        text.inputEl.focus();
        text.inputEl.select();
      });

    this.feedbackEl = this.contentEl.createEl("p", {
      cls: "palmwiki-create-page-feedback"
    });

    const actions = new Setting(this.contentEl);
    actions.addButton((button) => {
      button.setButtonText("Cancel").onClick(() => this.close());
    });
    actions.addButton((button) => {
      button
        .setButtonText("Create page")
        .setCta()
        .onClick(async () => {
          if (validateNewPageName(this.name) || !this.path) {
            return;
          }
          const request = {
            name: this.name.trim(),
            path: this.path
          };
          this.close();
          await this.onConfirm(request);
        });
      this.submitButton = button.buttonEl;
    });

    this.updateValidation();
  }

  onClose(): void {
    this.contentEl.empty();
    this.feedbackEl = null;
    this.submitButton = null;
  }

  private updateValidation(): void {
    const error = validateNewPageName(this.name);
    if (error) {
      this.path = "";
      this.feedbackEl?.setText(error);
      this.feedbackEl?.addClass("is-error");
      if (this.submitButton) {
        this.submitButton.disabled = true;
      }
      return;
    }

    const filename = `${this.name.trim()}.md`;
    const parent = this.app.fileManager.getNewFileParent("", filename);
    this.path = normalizePath(`${parent.path}/${filename}`);
    const existing = this.app.vault.getAbstractFileByPath(this.path);
    this.feedbackEl?.setText(
      existing
        ? `An item already exists at ${this.path}. It will be opened instead of overwritten.`
        : `Create ${this.path}`
    );
    this.feedbackEl?.removeClass("is-error");
    if (this.submitButton) {
      this.submitButton.disabled = false;
    }
  }
}

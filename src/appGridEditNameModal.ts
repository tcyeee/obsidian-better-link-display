import { App, ButtonComponent, Modal, Setting } from "obsidian";
import { t } from "./i18n";

/** The "Edit name" dialog opened from an app tile's right-click menu. See appGrid.ts. */
export class AppGridEditNameModal extends Modal {
	constructor(
		app: App,
		private readonly initialName: string,
		private readonly onSave: (name: string) => void
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle(t("appGrid.menu.editName"));
		let value = this.initialName;
		let saveButton: ButtonComponent;
		const submit = () => {
			const name = value.trim();
			if (!name) return;
			this.onSave(name);
			this.close();
		};
		const field = new Setting(this.contentEl).setName(t("appGrid.editName.label")).addText((text) => {
			text.setValue(value);
			text.inputEl.setAttribute("aria-label", t("appGrid.editName.label"));
			text.onChange((input) => {
				value = input;
				saveButton.setDisabled(!value.trim());
			});
			text.inputEl.addEventListener("keydown", (event) => {
				if (event.key === "Enter" && !event.isComposing) {
					event.preventDefault();
					submit();
				}
			});
		});
		const actions = new Setting(this.contentEl).addButton((button) =>
			button.setButtonText(t("button.cancel")).onClick(() => this.close())
		);
		actions.addButton((button) => {
			saveButton = button;
			button.setButtonText(t("button.save")).setCta().onClick(submit);
		});
		const input = field.controlEl.querySelector("input");
		input?.focus();
		input?.select();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

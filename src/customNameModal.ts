import { App, ButtonComponent, Modal, Setting } from "obsidian";
import { t } from "./i18n";

export class CustomNameModal extends Modal {
	constructor(
		app: App,
		private readonly initialName: string,
		private readonly save: (name: string) => void,
		private readonly finish: () => void
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle(t("button.customName"));
		let name = this.initialName;
		let saveButton: ButtonComponent;
		const submit = () => {
			if (!name.trim()) return;
			this.save(name.trim());
			this.close();
		};
		const field = new Setting(this.contentEl)
			.setName(t("customName.label"))
			.addText((text) => {
				text.setValue(name).setPlaceholder(t("customName.placeholder"));
				text.inputEl.setAttribute("aria-label", t("customName.label"));
				text.inputEl.addClass("better-link-display-wide-input");
				text.onChange((value) => {
					name = value;
					saveButton.setDisabled(!name.trim());
				});
				text.inputEl.addEventListener("keydown", (event) => {
					if (event.key === "Enter" && !event.isComposing) {
						event.preventDefault();
						submit();
					}
				});
			});
		field.settingEl.addClass("better-link-display-stacked-setting");
		const actions = new Setting(this.contentEl)
			.addButton((button) => button.setButtonText(t("button.cancel")).onClick(() => this.close()));
		actions.addButton((button) => {
			saveButton = button;
			button.setButtonText(t("button.save")).setCta().setDisabled(!name.trim()).onClick(submit);
		});
		const input = field.controlEl.querySelector("input");
		input?.focus();
		input?.select();
	}

	onClose(): void {
		this.finish();
		this.contentEl.empty();
	}
}

import { App, ButtonComponent, Modal, Setting } from "obsidian";
import { t } from "./i18n";
import { normalizeAppGridUrl } from "./appGridScan";

/** The "Add an app" dialog opened from the grid's own add tile. See appGrid.ts. */
export class AppGridAddModal extends Modal {
	constructor(
		app: App,
		private readonly onAdd: (url: string) => void
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle(t("appGrid.add.title"));
		let value = "";
		let addButton: ButtonComponent;
		const submit = () => {
			const url = normalizeAppGridUrl(value);
			if (!url) return;
			this.onAdd(url);
			this.close();
		};
		const field = new Setting(this.contentEl).setName(t("appGrid.add.label")).addText((text) => {
			text.setPlaceholder(t("appGrid.add.placeholder"));
			text.inputEl.setAttribute("aria-label", t("appGrid.add.label"));
			text.onChange((input) => {
				value = input;
				addButton.setDisabled(!normalizeAppGridUrl(value));
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
			addButton = button;
			button.setButtonText(t("appGrid.add.submit")).setCta().setDisabled(true).onClick(submit);
		});
		const input = field.controlEl.querySelector("input");
		input?.focus();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

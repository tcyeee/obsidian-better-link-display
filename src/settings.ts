import { App, PluginSettingTab, Setting } from "obsidian";
import type BetterLinkDisplayPlugin from "../main";
import { DEFAULT_API_BASE } from "./api";

export interface BetterLinkDisplaySettings {
	apiBase: string;
	accessToken: string;
}

export const DEFAULT_SETTINGS: BetterLinkDisplaySettings = {
	apiBase: DEFAULT_API_BASE,
	accessToken: "",
};

/** Long enough to collapse typing into one write, short enough to feel saved. */
const SAVE_DEBOUNCE_MS = 500;

export class BetterLinkDisplaySettingTab extends PluginSettingTab {
	plugin: BetterLinkDisplayPlugin;
	private saveTimer = 0;

	constructor(app: App, plugin: BetterLinkDisplayPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	/**
	 * `onChange` fires once per keystroke, and an access token is a long thing to
	 * type — writing data.json on each one is dozens of writes for one value.
	 */
	private queueSave(): void {
		window.clearTimeout(this.saveTimer);
		this.saveTimer = window.setTimeout(() => {
			this.saveTimer = 0;
			void this.plugin.saveSettings();
		}, SAVE_DEBOUNCE_MS);
	}

	/** Closing the tab must not discard a value the user just finished typing. */
	hide(): void {
		if (this.saveTimer === 0) return;
		window.clearTimeout(this.saveTimer);
		this.saveTimer = 0;
		void this.plugin.saveSettings();
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Server URL")
			.setDesc(
				"Base URL of the Bookmarkify service that resolves page titles and icons. " +
					`Defaults to ${DEFAULT_API_BASE}.`
			)
			.addText((text) => {
				text.inputEl.addClass("better-link-display-wide-input");
				text.setPlaceholder(DEFAULT_API_BASE)
					.setValue(this.plugin.settings.apiBase)
					.onChange((value) => {
						this.plugin.settings.apiBase = value.trim() || DEFAULT_API_BASE;
						this.queueSave();
					});
			});

		new Setting(containerEl)
			.setName("Access token")
			.setDesc(
				"Read-only token used to query page titles and icons. Generate one on the " +
					"service's token management page and paste it here. It cannot read or " +
					"modify your bookmarks or account data."
			)
			.addText((text) => {
				text.inputEl.type = "password";
				text.inputEl.addClass("better-link-display-wide-input");
				text.setPlaceholder("Paste your access token")
					.setValue(this.plugin.settings.accessToken)
					.onChange((value) => {
						this.plugin.settings.accessToken = value.trim();
						this.queueSave();
					});
			});
	}
}

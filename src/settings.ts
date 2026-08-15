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

export class BetterLinkDisplaySettingTab extends PluginSettingTab {
	plugin: BetterLinkDisplayPlugin;

	constructor(app: App, plugin: BetterLinkDisplayPlugin) {
		super(app, plugin);
		this.plugin = plugin;
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
					.onChange(async (value) => {
						this.plugin.settings.apiBase = value.trim() || DEFAULT_API_BASE;
						await this.plugin.saveSettings();
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
					.onChange(async (value) => {
						this.plugin.settings.accessToken = value.trim();
						await this.plugin.saveSettings();
					});
			});
	}
}

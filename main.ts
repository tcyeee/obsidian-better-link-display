import { Plugin } from "obsidian";
import { BookmarkifySettings, DEFAULT_SETTINGS, BookmarkifySettingTab } from "./src/settings";
import { enhanceBareLinks } from "./src/bookmarkRenderer";

export default class BookmarkifyPlugin extends Plugin {
	settings!: BookmarkifySettings;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new BookmarkifySettingTab(this.app, this));

		this.registerMarkdownPostProcessor((el) => {
			return enhanceBareLinks(el, this.settings.accessToken);
		});
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

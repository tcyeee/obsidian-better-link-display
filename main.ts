import { Plugin } from "obsidian";
import { BookmarkifySettings, DEFAULT_SETTINGS, BookmarkifySettingTab } from "./src/settings";
import { BookmarkEnhancer } from "./src/bookmarkRenderer";

export default class BookmarkifyPlugin extends Plugin {
	settings!: BookmarkifySettings;
	private enhancer!: BookmarkEnhancer;

	async onload() {
		await this.loadSettings();
		this.enhancer = new BookmarkEnhancer(() => this.settings);
		this.addSettingTab(new BookmarkifySettingTab(this.app, this));

		this.registerMarkdownPostProcessor((el) => this.enhancer.enhance(el));
	}

	onunload() {
		this.enhancer.reset();
	}

	async loadSettings() {
		const stored = (await this.loadData()) as Partial<BookmarkifySettings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, stored);
	}

	async saveSettings() {
		await this.saveData(this.settings);
		// A changed token or server URL invalidates everything looked up so far.
		this.enhancer.reset();
	}
}

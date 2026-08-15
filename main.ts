import { Plugin } from "obsidian";
import { BookmarkifySettings, DEFAULT_SETTINGS, BookmarkifySettingTab } from "./src/settings";
import { SiteLookup } from "./src/lookup";
import { BookmarkifyEditorFeature } from "./src/editorExtension";

export default class BookmarkifyPlugin extends Plugin {
	settings!: BookmarkifySettings;
	private editorFeature!: BookmarkifyEditorFeature;

	async onload() {
		await this.loadSettings();

		const lookup = new SiteLookup(() => this.settings);
		this.editorFeature = new BookmarkifyEditorFeature(lookup, () => this.settings);

		this.addSettingTab(new BookmarkifySettingTab(this.app, this));
		this.registerEditorExtension(this.editorFeature.extension);
	}

	onunload() {
		this.editorFeature.destroy();
	}

	async loadSettings() {
		const stored = (await this.loadData()) as Partial<BookmarkifySettings> | null;
		this.settings = {
			apiBase: stored?.apiBase?.trim() || DEFAULT_SETTINGS.apiBase,
			accessToken: stored?.accessToken ?? DEFAULT_SETTINGS.accessToken,
		};
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

import { Plugin } from "obsidian";
import {
	BetterLinkDisplaySettings,
	DEFAULT_SETTINGS,
	BetterLinkDisplaySettingTab,
} from "./src/settings";
import { SiteLookup } from "./src/lookup";
import { BetterLinkDisplayEditorFeature } from "./src/editorExtension";
import { wrapFormattedLinks } from "./src/render";

export default class BetterLinkDisplayPlugin extends Plugin {
	settings!: BetterLinkDisplaySettings;
	private editorFeature!: BetterLinkDisplayEditorFeature;

	async onload() {
		await this.loadSettings();

		const lookup = new SiteLookup(() => this.settings);
		this.editorFeature = new BetterLinkDisplayEditorFeature(lookup, () => this.settings);

		this.addSettingTab(new BetterLinkDisplaySettingTab(this.app, this));
		this.registerEditorExtension(this.editorFeature.extension);
		this.registerMarkdownPostProcessor((element) => wrapFormattedLinks(element));
	}

	onunload() {
		this.editorFeature.destroy();
	}

	async loadSettings() {
		const stored = (await this.loadData()) as Partial<BetterLinkDisplaySettings> | null;
		this.settings = {
			apiBase: stored?.apiBase?.trim() || DEFAULT_SETTINGS.apiBase,
			accessToken: stored?.accessToken ?? DEFAULT_SETTINGS.accessToken,
		};
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

import { Plugin } from "obsidian";
import {
	BetterLinkDisplaySettings,
	DEFAULT_SETTINGS,
	BetterLinkDisplaySettingTab,
} from "./src/settings";
import { SiteLookup } from "./src/lookup";
import { BetterLinkDisplayEditorFeature } from "./src/editorExtension";

export default class BetterLinkDisplayPlugin extends Plugin {
	settings!: BetterLinkDisplaySettings;
	private editorFeature?: BetterLinkDisplayEditorFeature;

	async onload() {
		await this.loadSettings();

		const lookup = new SiteLookup(() => this.settings);
		this.editorFeature = new BetterLinkDisplayEditorFeature(lookup, () => this.settings);

		this.addSettingTab(new BetterLinkDisplaySettingTab(this.app, this));
		this.registerEditorExtension(this.editorFeature.extension);
		this.addCommand({
			id: "format-link-under-cursor",
			name: "Format link under cursor",
			editorCheckCallback: (checking, editor) =>
				this.editorFeature?.formatAtCursor(editor, checking) ?? false,
		});
	}

	onunload() {
		// Guarded because onload may have failed before this was constructed.
		this.editorFeature?.destroy();
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

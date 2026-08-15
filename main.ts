import { Plugin } from "obsidian";
import {
	BetterLinkDisplaySettings,
	createDefaultSettings,
	BetterLinkDisplaySettingTab,
} from "./src/settings";
import { isLanguage, setLanguage, t } from "./src/i18n";
import { SiteLookup } from "./src/lookup";
import { BetterLinkDisplayEditorFeature } from "./src/editorExtension";
import { bookmarkMarkers, markReadingViewBookmarks } from "./src/bookmarkMarks";

/** Set on `body` while the matching appearance option is on. */
const BACKGROUND_CLASS = "better-link-display-background";
const BORDER_CLASS = "better-link-display-border";

export default class BetterLinkDisplayPlugin extends Plugin {
	settings!: BetterLinkDisplaySettings;
	private editorFeature?: BetterLinkDisplayEditorFeature;

	async onload() {
		await this.loadSettings();
		this.applyAppearance();

		const lookup = new SiteLookup(() => this.settings);
		this.editorFeature = new BetterLinkDisplayEditorFeature(lookup);

		this.addSettingTab(new BetterLinkDisplaySettingTab(this.app, this, lookup));
		this.registerEditorExtension(this.editorFeature.extension);
		// A formatted bookmark carries no marker in the note, so the classes
		// styles.css needs are put on the rendered elements instead — once per
		// view, because the two render the same Markdown differently.
		this.registerEditorExtension(bookmarkMarkers);
		this.registerMarkdownPostProcessor((el) => markReadingViewBookmarks(el));
		this.addCommand({
			id: "format-link-under-cursor",
			// Obsidian reads the name once, so this follows a language change only
			// after a restart. The setting says so.
			name: t("command.formatLink"),
			editorCheckCallback: (checking, editor) =>
				this.editorFeature?.formatAtCursor(editor, checking) ?? false,
		});
	}

	onunload() {
		// Guarded because onload may have failed before this was constructed.
		this.editorFeature?.destroy();
		document.body.removeClass(BACKGROUND_CLASS, BORDER_CLASS);
	}

	/**
	 * The appearance options are pure styling, so they live as classes on `body`
	 * that styles.css keys off. Both views pick the change up on the same repaint,
	 * with nothing to re-render and nothing written into the note.
	 */
	applyAppearance(): void {
		document.body.toggleClass(BACKGROUND_CLASS, this.settings.linkBackground);
		document.body.toggleClass(BORDER_CLASS, this.settings.linkBorder);
	}

	async loadSettings() {
		const stored = (await this.loadData()) as Partial<BetterLinkDisplaySettings> | null;
		const defaults = createDefaultSettings();
		this.settings = {
			accessToken: stored?.accessToken ?? defaults.accessToken,
			language: isLanguage(stored?.language) ? stored.language : defaults.language,
			linkBackground: stored?.linkBackground ?? defaults.linkBackground,
			linkBorder: stored?.linkBorder ?? defaults.linkBorder,
		};
		setLanguage(this.settings.language);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

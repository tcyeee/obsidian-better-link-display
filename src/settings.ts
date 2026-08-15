import { App, ButtonComponent, Notice, PluginSettingTab, Setting } from "obsidian";
import type BetterLinkDisplayPlugin from "../main";
import { detectLanguage, Language, LANGUAGES, setLanguage, t } from "./i18n";
import { API_BASE } from "./api";
import { LOOKUP_TIMEOUT_MS, SiteLookup, VerifyOutcome } from "./lookup";

export interface BetterLinkDisplaySettings {
	accessToken: string;
	language: Language;
	/** Draw a rounded grey plate behind formatted links. */
	linkBackground: boolean;
	/** Draw a grey outline around formatted links. */
	linkBorder: boolean;
}

/**
 * A function rather than a constant because the default language depends on the
 * Obsidian interface language, which isn't known until the plugin is running.
 */
export function createDefaultSettings(): BetterLinkDisplaySettings {
	return {
		accessToken: "",
		language: detectLanguage(),
		// Off by default: the plain look is the one existing notes were written
		// against, so an update must not restyle them on its own.
		linkBackground: false,
		linkBorder: false,
	};
}

/** Long enough to collapse typing into one write, short enough to feel saved. */
const SAVE_DEBOUNCE_MS = 500;

/** Notices explain a fix, so they need longer than Obsidian's default. */
const NOTICE_MS = 8000;

/** How long the Test button stays on "Success" before returning to normal. */
const SUCCESS_STATE_MS = 3000;

export class BetterLinkDisplaySettingTab extends PluginSettingTab {
	plugin: BetterLinkDisplayPlugin;
	private saveTimer = 0;
	private successTimer = 0;

	constructor(
		app: App,
		plugin: BetterLinkDisplayPlugin,
		private readonly lookup: SiteLookup
	) {
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
		// The button this would have reset is about to be destroyed.
		window.clearTimeout(this.successTimer);
		this.successTimer = 0;

		if (this.saveTimer === 0) return;
		window.clearTimeout(this.saveTimer);
		this.saveTimer = 0;
		void this.plugin.saveSettings();
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl).setName(t("general.heading")).setHeading();

		new Setting(containerEl)
			.setName(t("general.language.name"))
			.addDropdown((dropdown) => {
				for (const language of LANGUAGES) dropdown.addOption(language, t(`language.${language}`));
				dropdown.setValue(this.plugin.settings.language).onChange((value) => {
					const language = value as Language;
					this.plugin.settings.language = language;
					setLanguage(language);
					void this.plugin.saveSettings();
					// Every label on this page is now in the wrong language.
					this.display();
				});
			});

		new Setting(containerEl).setName(t("appearance.heading")).setHeading();

		new Setting(containerEl)
			.setName(t("appearance.background.name"))
			.setDesc(t("appearance.background.desc"))
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.linkBackground).onChange((value) => {
					this.plugin.settings.linkBackground = value;
					// Applied before the save so open notes restyle as the toggle moves.
					this.plugin.applyAppearance();
					void this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName(t("appearance.border.name"))
			.setDesc(t("appearance.border.desc"))
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.linkBorder).onChange((value) => {
					this.plugin.settings.linkBorder = value;
					this.plugin.applyAppearance();
					void this.plugin.saveSettings();
				});
			});

		new Setting(containerEl).setName(t("service.heading")).setHeading();

		const token = new Setting(containerEl)
			.setName(t("token.name"))
			.setDesc(t("token.desc"))
			.addText((text) => {
				text.inputEl.type = "password";
				text.inputEl.addClass("better-link-display-wide-input");
				text.setPlaceholder(t("token.placeholder"))
					.setValue(this.plugin.settings.accessToken)
					.onChange((value) => {
						this.plugin.settings.accessToken = value.trim();
						this.queueSave();
					});
			})
			.addButton((button) => {
				button.setButtonText(t("token.test")).onClick(() => void this.testToken(button));
			});
		// A token is far longer than the space left beside its description, so the
		// field drops onto its own full-width row underneath.
		token.settingEl.addClass("better-link-display-stacked-setting");
	}

	/**
	 * Tests the token as currently typed rather than as last saved, so the answer
	 * is about the value the user is looking at. The button reports progress and
	 * success itself: a request takes a moment, and a silent button reads as a
	 * dead one. Only failures get a notice, because only failures need a sentence
	 * of explanation.
	 */
	private async testToken(button: ButtonComponent): Promise<void> {
		this.cancelSuccessState(button);

		const token = this.plugin.settings.accessToken;
		if (!token) {
			new Notice(t("test.empty"), NOTICE_MS);
			return;
		}

		button.setDisabled(true).setButtonText(t("token.testing"));

		let outcome: VerifyOutcome;
		try {
			outcome = await this.lookup.verify(token);
		} catch {
			outcome = { ok: false, reason: "server" };
		}

		// The tab may have been re-rendered or closed while the request ran.
		if (!button.buttonEl.isConnected) return;
		button.setDisabled(false).setButtonText(t("token.test"));

		if (!outcome.ok) {
			new Notice(verifyMessage(outcome), NOTICE_MS);
			return;
		}

		button.setButtonText(t("token.success"));
		button.buttonEl.addClass("better-link-display-test-success");
		this.successTimer = window.setTimeout(() => {
			this.successTimer = 0;
			if (button.buttonEl.isConnected) this.cancelSuccessState(button);
		}, SUCCESS_STATE_MS);
	}

	/** Put the button back to its resting label, cancelling any pending reset. */
	private cancelSuccessState(button: ButtonComponent): void {
		window.clearTimeout(this.successTimer);
		this.successTimer = 0;
		button.buttonEl.removeClass("better-link-display-test-success");
		button.setButtonText(t("token.test"));
	}
}

function verifyMessage(outcome: VerifyOutcome): string {
	if (outcome.ok) return t("test.ok");
	switch (outcome.reason) {
		case "auth":
			return t("test.auth");
		case "unreachable":
			return t("test.unreachable", { base: API_BASE });
		case "timeout":
			return t("test.timeout", { seconds: LOOKUP_TIMEOUT_MS / 1000 });
		// An empty token never reaches here, so anything left is the service
		// itself misbehaving.
		case "unconfigured":
		case "server":
			return t("test.server", { base: API_BASE });
	}
}

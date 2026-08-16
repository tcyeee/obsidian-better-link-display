import { App, ButtonComponent, Notice, PluginSettingTab, Setting, setIcon } from "obsidian";
import type { SettingDefinitionGroup, SettingDefinitionItem, SettingGroupItem } from "obsidian";
import type BetterLinkDisplayPlugin from "../main";
import { detectLanguage, Language, LANGUAGES, setLanguage, t } from "./i18n";
import { API_BASE, SITE_URL } from "./api";
import { LOOKUP_TIMEOUT_MS, SiteLookup, VerifyOutcome } from "./lookup";
import { PREVIEW_ICON } from "./previewIcon";

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

/** How long the Test button shows its result before returning to normal. */
const RESULT_STATE_MS = 1000;

export class BetterLinkDisplaySettingTab extends PluginSettingTab {
	plugin: BetterLinkDisplayPlugin;
	private saveTimer = 0;
	private resultTimer = 0;

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
		window.clearTimeout(this.resultTimer);
		this.resultTimer = 0;

		if (this.saveTimer === 0) return;
		window.clearTimeout(this.saveTimer);
		this.saveTimer = 0;
		void this.plugin.saveSettings();
	}

	/**
	 * The declarative form: Obsidian builds each row from `name`/`desc` and hands
	 * the `render` callback an empty `Setting` to hang controls on. Going through
	 * definitions rather than `display()` is what puts these settings into the
	 * settings search index — the names and descriptions are readable without
	 * rendering the tab.
	 *
	 * Every row is `render`-type rather than `control`-type: a `control` is read
	 * and written through `getControlValue`/`setControlValue` keyed by string,
	 * which none of these want — the toggles have to call `applyAppearance()` on
	 * the way past, and the token field debounces its own writes.
	 */
	getSettingDefinitions(): SettingDefinitionItem[] {
		const service: SettingDefinitionGroup = {
			type: "group",
			heading: t("service.heading"),
			items: [this.setupNotice(), this.tokenSetting()],
		};
		const rest: SettingDefinitionItem[] = [
			{
				type: "group",
				heading: t("general.heading"),
				items: [this.languageSetting()],
			},
			{
				type: "group",
				heading: t("appearance.heading"),
				items: [
					this.previewSetting(),
					this.appearanceToggle(
						"appearance.background.name",
						"appearance.background.desc",
						"linkBackground"
					),
					this.appearanceToggle(
						"appearance.border.name",
						"appearance.border.desc",
						"linkBorder"
					),
				],
			},
		];
		// Nothing else on this page does anything without a token, so until one is
		// set the page opens on the group that has to be filled in first. The order
		// is decided here rather than on every keystroke: the definitions are only
		// rebuilt when the tab is opened again, so the field can't move out from
		// under the cursor while a token is being pasted into it.
		return this.plugin.settings.accessToken ? [...rest, service] : [service, ...rest];
	}

	/**
	 * The banner above the token field while there is no token: an unconfigured
	 * plugin does nothing at all, and the failure is otherwise only met later, as
	 * a notice on the first link the user tries to format.
	 *
	 * It is a `visible` predicate rather than a conditional item so that typing
	 * the first token dismisses it in place — `refreshDomState()` re-runs the
	 * predicate without rebuilding the page around the field being typed in.
	 */
	private setupNotice(): SettingGroupItem {
		return {
			name: t("token.setup.name"),
			desc: t("token.setup.desc"),
			visible: () => !this.plugin.settings.accessToken,
			render: (setting) => {
				setting.settingEl.addClass("better-link-display-setup-notice");
				const icon = createSpan({ cls: "better-link-display-setup-icon" });
				setIcon(icon, "alert-triangle");
				setting.nameEl.prepend(icon);
			},
		};
	}

	private languageSetting(): SettingGroupItem {
		return {
			name: t("general.language.name"),
			render: (setting) => {
				setting.addDropdown((dropdown) => {
					for (const language of LANGUAGES)
						dropdown.addOption(language, t(`language.${language}`));
					dropdown.setValue(this.plugin.settings.language).onChange((value) => {
						const language = value as Language;
						this.plugin.settings.language = language;
						setLanguage(language);
						void this.plugin.saveSettings();
						// Every label on this page is now in the wrong language, and
						// each `name`/`desc` was translated once when the definitions
						// were built — only rebuilding them picks up the new language.
						// (`refreshDomState()` re-runs the predicates, not the strings.)
						this.update();
					});
				});
			},
		};
	}

	/** The two appearance options differ only in which flag they carry. */
	private appearanceToggle(
		nameKey: "appearance.background.name" | "appearance.border.name",
		descKey: "appearance.background.desc" | "appearance.border.desc",
		field: "linkBackground" | "linkBorder"
	): SettingGroupItem {
		return {
			name: t(nameKey),
			desc: t(descKey),
			render: (setting) => {
				setting.addToggle((toggle) => {
					toggle.setValue(this.plugin.settings[field]).onChange((value) => {
						this.plugin.settings[field] = value;
						// Applied before the save so open notes restyle as the toggle moves.
						this.plugin.applyAppearance();
						void this.plugin.saveSettings();
					});
				});
			},
		};
	}

	private tokenSetting(): SettingGroupItem {
		return {
			name: t("token.name"),
			desc: this.tokenDescription(),
			render: (setting) => {
				setting
					.addText((text) => {
						text.inputEl.type = "password";
						text.inputEl.addClass("better-link-display-wide-input");
						text.setPlaceholder(t("token.placeholder"))
							.setValue(this.plugin.settings.accessToken)
							.onChange((value) => {
								const had = this.plugin.settings.accessToken !== "";
								this.plugin.settings.accessToken = value.trim();
								// The setup banner hangs off a predicate on this value, so
								// it only follows the field once the predicates are re-run —
								// and only the transitions can change what it shows.
								if (had !== (this.plugin.settings.accessToken !== ""))
									this.refreshDomState();
								this.queueSave();
							});
					})
					.addButton((button) => {
						button.setButtonText(t("token.test")).onClick(() => void this.testToken(button));
					});
				// A token is far longer than the space left beside its description, so
				// the field drops onto its own full-width row underneath.
				setting.settingEl.addClass("better-link-display-stacked-setting");
			},
		};
	}

	/**
	 * What the token is, followed by the two steps that produce one. The steps
	 * stay on the row rather than living only in the banner above, because they
	 * are also what someone comes back for when a token has to be replaced.
	 *
	 * A fragment rather than a string so the address is a link; the settings
	 * search indexes a fragment by its text content, so the steps stay findable.
	 */
	private tokenDescription(): DocumentFragment {
		return createFragment((frag) => {
			frag.createDiv({ text: t("token.desc") });
			frag.createDiv({ text: t("token.steps.heading") });
			const steps = frag.createEl("ol", { cls: "better-link-display-token-steps" });
			// The template carries `{site}` unsubstituted so the address can be
			// dropped in as an anchor, wherever the sentence happens to put it.
			const [before, after] = t("token.steps.login").split("{site}");
			const login = steps.createEl("li", { text: before });
			login.createEl("a", { href: SITE_URL, text: SITE_URL });
			login.appendText(after ?? "");
			steps.createEl("li", { text: t("token.steps.generate") });
		});
	}

	/**
	 * A standing example of what the options below do, so the user does not have to
	 * leave settings and find a formatted link to see the effect of a toggle.
	 *
	 * It is built from the same markup Reading view produces for a bookmark — an
	 * anchor carrying the bookmark mark, wrapping an inlined `data:` icon — so
	 * every rule in `styles.css` reaches it exactly as it reaches a real one, and
	 * the appearance classes on `body` restyle it on the same repaint as the open
	 * notes. That is also why it needs no updating when a toggle changes: nothing
	 * about the preview is computed here.
	 */
	private previewSetting(): SettingGroupItem {
		return {
			name: t("appearance.preview.name"),
			desc: t("appearance.preview.desc"),
			// A picture of a bookmark carries no words of its own, so there is
			// nothing here for the settings search to match beyond the two above.
			render: (setting) => this.renderPreview(setting),
		};
	}

	private renderPreview(setting: Setting): void {
		// The sample is a line of note text, so it wants the full width rather than
		// the strip left beside a description.
		setting.settingEl.addClass("better-link-display-stacked-setting");

		const surface = setting.controlEl.createDiv({ cls: "better-link-display-preview" });
		const link = surface.createEl("a", { cls: "external-link better-link-display-bookmark" });
		// No `href`: this is a picture of a link, and clicking it should not open
		// anything. The alt text is empty because the title beside it already says
		// what the bookmark is.
		link.createEl("img", { attr: { src: PREVIEW_ICON, alt: "" } });
		link.appendText(t("appearance.preview.sample"));
	}

	/**
	 * Tests the token as currently typed rather than as last saved, so the answer
	 * is about the value the user is looking at. The button reports progress and
	 * the verdict itself: a request takes a moment, and a silent button reads as a
	 * dead one.
	 */
	private async testToken(button: ButtonComponent): Promise<void> {
		this.clearResultState(button);

		const token = this.plugin.settings.accessToken;
		// An empty field is a failed test as far as the button is concerned: every
		// click on it should end in one of the two verdicts, never in nothing.
		if (!token) {
			new Notice(t("test.empty"), NOTICE_MS);
			this.showResult(button, false);
			return;
		}

		button.setDisabled(true);
		button.setButtonText(t("token.testing"));

		let outcome: VerifyOutcome;
		try {
			outcome = await this.lookup.verify(token);
		} catch {
			outcome = { ok: false, reason: "server" };
		}

		// The tab may have been re-rendered or closed while the request ran.
		if (!button.buttonEl.isConnected) return;
		button.setDisabled(false);

		// The button can only say that something went wrong; which of the failures
		// it was needs a sentence, so those keep their notice.
		if (!outcome.ok) new Notice(verifyMessage(outcome), NOTICE_MS);
		this.showResult(button, outcome.ok);
	}

	/** Colour the button with the verdict, then hand it back to the user. */
	private showResult(button: ButtonComponent, ok: boolean): void {
		button.setButtonText(ok ? t("token.success") : t("token.failure"));
		button.buttonEl.addClass(
			ok ? "better-link-display-test-success" : "better-link-display-test-failure"
		);
		this.resultTimer = window.setTimeout(() => {
			this.resultTimer = 0;
			if (button.buttonEl.isConnected) this.clearResultState(button);
		}, RESULT_STATE_MS);
	}

	/** Put the button back to its resting label, cancelling any pending reset. */
	private clearResultState(button: ButtonComponent): void {
		window.clearTimeout(this.resultTimer);
		this.resultTimer = 0;
		button.buttonEl.removeClass("better-link-display-test-success");
		button.buttonEl.removeClass("better-link-display-test-failure");
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

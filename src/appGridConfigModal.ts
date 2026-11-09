import { App, Modal, Setting } from "obsidian";
import { t } from "./i18n";
import { AppGridConfig } from "./appGridScan";

type SizeKey = "s" | "m" | "l";
type BackgroundKey = "none" | "gray" | "beige";

/** The only icon/gap px values the dialog offers — a hand-edited block may hold anything else, see appGridScan.ts. */
const ICON_SIZES: Record<SizeKey, number> = { s: 24, m: 32, l: 40 };
const GAP_SIZES: Record<SizeKey, number> = { s: 8, m: 12, l: 16 };
/** The only two area-background colours the dialog offers, as 6-digit hex with no `#`. */
const BACKGROUND_COLORS: Record<Exclude<BackgroundKey, "none">, string> = {
	gray: "e9e9e9",
	beige: "f0ddd3",
};

function closestSizeKey(px: number, table: Record<SizeKey, number>): SizeKey {
	return (Object.keys(table) as SizeKey[]).reduce((closest, key) =>
		Math.abs(table[key] - px) < Math.abs(table[closest] - px) ? key : closest
	);
}

function backgroundKeyOf(hex: string | null): BackgroundKey {
	if (!hex) return "none";
	const match = (Object.keys(BACKGROUND_COLORS) as Array<Exclude<BackgroundKey, "none">>).find(
		(key) => BACKGROUND_COLORS[key] === hex
	);
	// A hand-edited hex that isn't one of the two offered colours still has to show
	// as *something* selected — closest to showing the block's actual state is
	// treating it the same as the dialog's own gray option rather than "none".
	return match ?? "gray";
}

/** The appearance dialog opened from the app grid's own settings button. See appGrid.ts. */
export class AppGridConfigModal extends Modal {
	constructor(
		app: App,
		private readonly initial: AppGridConfig,
		private readonly onSave: (config: AppGridConfig) => void
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle(t("appGrid.config.title"));

		let iconKey = closestSizeKey(this.initial.iconSize, ICON_SIZES);
		let gapKey = closestSizeKey(this.initial.gap, GAP_SIZES);
		let backgroundKey = backgroundKeyOf(this.initial.background);
		let appBackground = this.initial.appBackground;

		new Setting(this.contentEl).setName(t("appGrid.config.iconSize")).addDropdown((dropdown) => {
			dropdown
				.addOption("s", t("appGrid.config.size.s"))
				.addOption("m", t("appGrid.config.size.m"))
				.addOption("l", t("appGrid.config.size.l"))
				.setValue(iconKey)
				.onChange((value) => {
					iconKey = value as SizeKey;
				});
		});

		new Setting(this.contentEl).setName(t("appGrid.config.gap")).addDropdown((dropdown) => {
			dropdown
				.addOption("s", t("appGrid.config.size.s"))
				.addOption("m", t("appGrid.config.size.m"))
				.addOption("l", t("appGrid.config.size.l"))
				.setValue(gapKey)
				.onChange((value) => {
					gapKey = value as SizeKey;
				});
		});

		new Setting(this.contentEl).setName(t("appGrid.config.background")).addDropdown((dropdown) => {
			dropdown
				.addOption("none", t("appGrid.config.background.none"))
				.addOption("gray", t("appGrid.config.background.gray"))
				.addOption("beige", t("appGrid.config.background.beige"))
				.setValue(backgroundKey)
				.onChange((value) => {
					backgroundKey = value as BackgroundKey;
				});
		});

		new Setting(this.contentEl)
			.setName(t("appGrid.config.appBackground"))
			.setDesc(t("appGrid.config.appBackground.desc"))
			.addToggle((toggle) => {
				toggle.setValue(appBackground).onChange((value) => {
					appBackground = value;
				});
			});

		new Setting(this.contentEl)
			.addButton((button) => button.setButtonText(t("button.cancel")).onClick(() => this.close()))
			.addButton((button) =>
				button
					.setButtonText(t("button.save"))
					.setCta()
					.onClick(() => {
						this.onSave({
							iconSize: ICON_SIZES[iconKey],
							gap: GAP_SIZES[gapKey],
							background: backgroundKey === "none" ? null : BACKGROUND_COLORS[backgroundKey],
							appBackground,
						});
						this.close();
					})
			);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

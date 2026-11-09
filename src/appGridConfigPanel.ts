import { t } from "./i18n";
import { AppGridConfig } from "./appGridScan";

type SizeKey = "s" | "m" | "l";
type BackgroundKey = "none" | "gray" | "beige";

/** The only icon/gap px values the panel offers — a hand-edited block may hold anything else, see appGridScan.ts. */
const ICON_SIZES: Record<SizeKey, number> = { s: 24, m: 32, l: 40 };
const GAP_SIZES: Record<SizeKey, number> = { s: 8, m: 12, l: 16 };
/** The only two area-background colours the panel offers, as 6-digit hex with no `#`. */
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
	// treating it the same as the panel's own gray option rather than "none".
	return match ?? "gray";
}

const PANEL_CLASS = "better-link-display-app-config-panel";
const SECTION_CLASS = `${PANEL_CLASS}-section`;
const SECTION_TITLE_CLASS = `${PANEL_CLASS}-section-title`;
const ROW_CLASS = `${PANEL_CLASS}-row`;
const ROW_TEXT_CLASS = `${PANEL_CLASS}-row-text`;
const ROW_LABEL_CLASS = `${PANEL_CLASS}-row-label`;
const ROW_DESC_CLASS = `${PANEL_CLASS}-row-desc`;
/** Shared by every toggle in the panel — unlike the segmented controls below, a switch's thumb travel is a fixed pixel distance, not a share of the track, so nothing here depends on how many toggles exist. */
const SWITCH_CLASS = `${PANEL_CLASS}-switch`;
const SWITCH_INPUT_CLASS = `${PANEL_CLASS}-switch-input`;
const SWITCH_TRACK_CLASS = `${PANEL_CLASS}-switch-track`;

/** At most one of these panels is ever open — opening another (or the same anchor again) closes whichever is already up. */
let activePanel: { anchor: HTMLElement; close: () => void } | null = null;

/**
 * Closes whatever panel is open, if any. The panel's anchor is the gear
 * button in Live Preview's `embed-actions` bar (see {@link attachConfigButton}
 * in appGrid.ts), which doesn't exist in Reading view or Source mode — so
 * switching to either while the panel is open would otherwise leave it
 * floating over a view it no longer belongs to, with no button left to close
 * it by reopening. main.ts calls this on the workspace's `layout-change`,
 * which fires on exactly that switch.
 */
export function closeAppConfigPanel(): void {
	activePanel?.close();
}

/**
 * Builds one segmented control: a native `radio` per option, visually
 * hidden, driving a sliding highlight through a `data-*` attribute set on
 * the group container to the *selected option's own key* (not an index) —
 * matched in `styles.css` one option value at a time, the same way the
 * design doc's reference implementation keys its `data-size`/`data-layout`
 * attributes. `classPrefix` and `dataKey` are taken as parameters only to
 * avoid pasting this function body three times; the CSS classes and the
 * `data-*` attribute name they produce are still a fresh, independent set
 * per call — nothing here is shared between icon size, gap and background,
 * on purpose: those three controls happen to all have three options today,
 * but the doc is explicit that a segmented control's width/translateX
 * shares are hardcoded for its own option count, and sharing one rule set
 * across controls would make changing one control's CSS silently affect
 * the others.
 */
function buildSegmentGroup<K extends string>(
	container: HTMLElement,
	classPrefix: string,
	dataKey: string,
	options: { key: K; label: string }[],
	initialKey: K,
	radioGroupName: string,
	onChange: (key: K) => void
): void {
	const group = container.createDiv({ cls: `${classPrefix}-group` });
	group.setAttribute(`data-${dataKey}`, initialKey);
	group.createDiv({ cls: `${classPrefix}-slider` });

	for (const option of options) {
		const label = group.createEl("label", { cls: `${classPrefix}-radio` });
		const input = label.createEl("input", { cls: `${classPrefix}-radio-input` });
		input.type = "radio";
		input.name = radioGroupName;
		input.value = option.key;
		input.checked = option.key === initialKey;
		label.createSpan({ cls: `${classPrefix}-radio-text`, text: option.label });

		input.addEventListener("change", () => {
			if (!input.checked) return;
			group.setAttribute(`data-${dataKey}`, option.key);
			onChange(option.key);
		});
	}
}

/** Builds one iOS-style toggle row: native `checkbox`, visually hidden, driving the track/thumb through `:checked +`. */
function buildToggleRow(
	container: HTMLElement,
	label: string,
	desc: string | undefined,
	initial: boolean,
	onChange: (value: boolean) => void
): void {
	const row = container.createEl("label", { cls: ROW_CLASS });
	const text = row.createDiv({ cls: ROW_TEXT_CLASS });
	text.createSpan({ cls: ROW_LABEL_CLASS, text: label });
	if (desc) text.createSpan({ cls: ROW_DESC_CLASS, text: desc });

	const switchEl = row.createDiv({ cls: SWITCH_CLASS });
	const input = switchEl.createEl("input", { cls: SWITCH_INPUT_CLASS });
	input.type = "checkbox";
	input.checked = initial;
	switchEl.createSpan({ cls: SWITCH_TRACK_CLASS });

	input.addEventListener("change", () => onChange(input.checked));
}

/**
 * The appearance panel opened from the app grid's own settings (gear)
 * button. Every control applies immediately — there is no Save/Cancel —
 * matching how every other mutation in `appGrid.ts` (add/delete/rename/
 * update a tile) already rewrites the block's source line the moment it
 * happens, rather than buffering edits for a later commit.
 *
 * Positioned under the triggering button rather than the click point, same
 * as the design doc this follows. Unlike that doc's own panel, this one's
 * anchor isn't pinned to a screen corner: the gear button can sit anywhere
 * along a note's width, so a plain right-edge anchor could push the panel
 * off the left of the viewport. The clamp below is the one addition on top
 * of the doc's positioning rule, for that reason. The doc's hover-delay-close
 * and safe-zone are not reproduced here either: they exist in the source
 * plugin because its button and panel share a hover region the user's
 * pointer has to cross, which has no counterpart here — this panel only ever
 * opens from a click, and closes the same way the context menu elsewhere in
 * this plugin already does (outside click / `Escape` / window blur).
 */
export function showAppConfigPanel(
	anchor: HTMLElement,
	initial: AppGridConfig,
	onChange: (config: AppGridConfig) => void
): void {
	const reopening = activePanel?.anchor === anchor;
	activePanel?.close();
	if (reopening) return;

	const doc = anchor.ownerDocument;
	const win = doc.defaultView;
	if (!win) return;

	let iconKey = closestSizeKey(initial.iconSize, ICON_SIZES);
	let gapKey = closestSizeKey(initial.gap, GAP_SIZES);
	let backgroundKey = backgroundKeyOf(initial.background);
	let appBackground = initial.appBackground;

	const emit = (): void =>
		onChange({
			iconSize: ICON_SIZES[iconKey],
			gap: GAP_SIZES[gapKey],
			background: backgroundKey === "none" ? null : BACKGROUND_COLORS[backgroundKey],
			appBackground,
		});

	const panel = doc.body.createDiv({ cls: PANEL_CLASS });
	const uid = Math.random().toString(36).slice(2);
	const SIZE_OPTIONS = (["s", "m", "l"] as SizeKey[]).map((key) => ({
		key,
		label: t(`appGrid.config.size.${key}`),
	}));

	const iconSizeSection = panel.createDiv({ cls: SECTION_CLASS });
	iconSizeSection.createDiv({ cls: SECTION_TITLE_CLASS, text: t("appGrid.config.iconSize") });
	buildSegmentGroup(
		iconSizeSection,
		`${PANEL_CLASS}-icon-size`,
		"icon-size",
		SIZE_OPTIONS,
		iconKey,
		`icon-size-${uid}`,
		(key) => {
			iconKey = key;
			emit();
		}
	);

	const gapSection = panel.createDiv({ cls: SECTION_CLASS });
	gapSection.createDiv({ cls: SECTION_TITLE_CLASS, text: t("appGrid.config.gap") });
	buildSegmentGroup(gapSection, `${PANEL_CLASS}-gap`, "gap", SIZE_OPTIONS, gapKey, `gap-${uid}`, (key) => {
		gapKey = key;
		emit();
	});

	const backgroundSection = panel.createDiv({ cls: SECTION_CLASS });
	backgroundSection.createDiv({ cls: SECTION_TITLE_CLASS, text: t("appGrid.config.background") });
	buildSegmentGroup(
		backgroundSection,
		`${PANEL_CLASS}-background`,
		"background",
		(["none", "gray", "beige"] as BackgroundKey[]).map((key) => ({
			key,
			label: t(`appGrid.config.background.${key}`),
		})),
		backgroundKey,
		`background-${uid}`,
		(key) => {
			backgroundKey = key;
			emit();
		}
	);

	const appearanceSection = panel.createDiv({ cls: SECTION_CLASS });
	appearanceSection.createDiv({ cls: SECTION_TITLE_CLASS, text: t("appGrid.config.appearance") });
	buildToggleRow(
		appearanceSection,
		t("appGrid.config.appBackground"),
		undefined,
		appBackground,
		(value) => {
			appBackground = value;
			emit();
		}
	);

	const abortController = new AbortController();
	function close(): void {
		abortController.abort();
		panel.remove();
		if (activePanel?.close === close) activePanel = null;
	}
	activePanel = { anchor, close };

	const rect = anchor.getBoundingClientRect();
	panel.setCssProps({
		"--better-link-display-app-config-panel-top": `${rect.bottom + 4}px`,
		"--better-link-display-app-config-panel-right": `${win.innerWidth - rect.right}px`,
	});
	// Re-measure once mounted and pull the right edge in if the panel's own
	// width would otherwise push its left edge past the viewport — see the
	// doc-deviation note above.
	const panelRect = panel.getBoundingClientRect();
	if (panelRect.left < 8) {
		panel.setCssProps({
			"--better-link-display-app-config-panel-right": `${Math.max(8, win.innerWidth - 8 - panelRect.width)}px`,
		});
	}

	const { signal } = abortController;
	win.addEventListener(
		"mousedown",
		(event) => {
			if (!(event.target instanceof Node)) return;
			if (panel.contains(event.target) || anchor.contains(event.target)) return;
			close();
		},
		{ signal, capture: true }
	);
	win.addEventListener(
		"keydown",
		(event) => {
			if (event.key === "Escape") close();
		},
		{ signal }
	);
	win.addEventListener("blur", close, { signal });
}

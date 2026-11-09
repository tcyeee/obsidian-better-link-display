import { t } from "./i18n";
import { normalizeAppGridUrl } from "./appGridScan";

const PANEL_CLASS = "better-link-display-app-add-panel";
const TITLE_CLASS = `${PANEL_CLASS}-title`;
const INPUT_CLASS = `${PANEL_CLASS}-input`;
const ACTIONS_CLASS = `${PANEL_CLASS}-actions`;
const BUTTON_CLASS = `${PANEL_CLASS}-button`;
const SUBMIT_CLASS = `${PANEL_CLASS}-submit`;

/** At most one add panel is ever open — opening another (or the same tile again) closes whichever is already up. */
let activePanel: { anchor: HTMLElement; close: () => void } | null = null;

/**
 * Closes whatever add panel is open, if any. Like the app-grid config panel
 * and tile context menu (see {@link closeAppConfigPanel} and
 * {@link closeContextMenu}), it is mounted on `document.body`, so switching
 * Live Preview and Reading view — which tears down the add tile that anchors
 * it — would otherwise leave it floating with no tile left to anchor it.
 * main.ts calls this on the workspace's `layout-change`.
 */
export function closeAppAddPanel(): void {
	activePanel?.close();
}

/**
 * The "Add an app" panel opened from the grid's own add tile, replacing the
 * `Modal` this used to be. It is the same floating-surface interaction as the
 * app-grid config panel and tile context menu — mounted to `document.body`,
 * positioned against the tile that opened it, and closed by an outside click,
 * `Escape`, or the window losing focus — rather than a centred dialog.
 *
 * On submit it calls `onAdd` with the normalized URL; the caller writes the
 * line into the block's source, which re-renders the grid (and thus replaces
 * this panel's anchor) the same way it would for a hand-typed edit.
 */
export function showAppAddPanel(anchor: HTMLElement, onAdd: (url: string) => void): void {
	const reopening = activePanel?.anchor === anchor;
	activePanel?.close();
	if (reopening) return;

	const doc = anchor.ownerDocument;
	const win = doc.defaultView;
	if (!win) return;

	const previouslyFocused = doc.activeElement instanceof HTMLElement ? doc.activeElement : null;

	const panel = doc.body.createDiv({ cls: PANEL_CLASS });
	panel.createDiv({ cls: TITLE_CLASS, text: t("appGrid.add.title") });

	const input = panel.createEl("input", {
		cls: INPUT_CLASS,
		attr: {
			type: "text",
			placeholder: t("appGrid.add.placeholder"),
			"aria-label": t("appGrid.add.label"),
		},
	});

	const actions = panel.createDiv({ cls: ACTIONS_CLASS });
	const cancel = actions.createEl("button", {
		cls: BUTTON_CLASS,
		text: t("button.cancel"),
		attr: { type: "button" },
	});
	const submit = actions.createEl("button", {
		cls: `${BUTTON_CLASS} ${SUBMIT_CLASS}`,
		text: t("appGrid.add.submit"),
		attr: { type: "button" },
	});
	submit.disabled = true;

	const abortController = new AbortController();
	function close(): void {
		abortController.abort();
		panel.remove();
		if (activePanel?.close === close) activePanel = null;
		// The input steals focus from the editor; hand it back the way a `Modal`
		// does. Guarded against the anchor being replaced by the block re-render
		// that a submit triggers, which detaches whatever was focused before.
		if (previouslyFocused?.isConnected) previouslyFocused.focus();
	}
	activePanel = { anchor, close };

	const submitUrl = (): void => {
		const url = normalizeAppGridUrl(input.value);
		if (!url) return;
		onAdd(url);
		close();
	};

	input.addEventListener("input", () => {
		submit.disabled = !normalizeAppGridUrl(input.value);
	});
	input.addEventListener("keydown", (event) => {
		if (event.key === "Enter" && !event.isComposing) {
			event.preventDefault();
			submitUrl();
		}
	});
	submit.addEventListener("click", submitUrl);
	cancel.addEventListener("click", close);

	// Position under the tile that opened it, then clamp into the viewport the
	// way `showContextMenu` does — a tile near the bottom or right edge of the
	// note would otherwise push the panel off-screen. Coordinates go through
	// `setCssProps()` rather than `el.style`, which plugin review disallows.
	const rect = anchor.getBoundingClientRect();
	panel.setCssProps({
		"--better-link-display-app-add-panel-left": `${rect.left}px`,
		"--better-link-display-app-add-panel-top": `${rect.bottom + 4}px`,
	});
	const panelRect = panel.getBoundingClientRect();
	if (panelRect.right > win.innerWidth - 8) {
		panel.setCssProps({
			"--better-link-display-app-add-panel-left": `${Math.max(8, win.innerWidth - 8 - panelRect.width)}px`,
		});
	}
	if (panelRect.bottom > win.innerHeight - 8) {
		panel.setCssProps({
			"--better-link-display-app-add-panel-top": `${rect.top - 4 - panelRect.height}px`,
		});
	}

	// One AbortController tears down all three close triggers at once — an
	// outside click, Escape, or the window losing focus (switching apps
	// mid-panel), same as the config panel.
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

	input.focus();
}

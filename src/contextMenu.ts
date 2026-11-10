import { setIcon } from "obsidian";

export interface ContextMenuItemSpec {
	icon: string;
	label: string;
	onClick: () => void;
	/** Styles the icon and label in the theme's error colour — for a destructive action, not merely an unusual one. */
	danger?: boolean;
	/** Shown dimmed and inert rather than omitted — the item still explains why an action isn't available right now. */
	disabled?: boolean;
	/** Draws a separator above this item, to set destructive actions apart from the rest — not between every item. */
	separatorBefore?: boolean;
}

const MENU_CLASS = "better-link-display-context-menu";
const ITEM_CLASS = "better-link-display-context-menu-item";
const SEPARATOR_CLASS = "better-link-display-context-menu-separator";

/** At most one of these menus is ever open — opening another closes whichever one is already up. */
let closeActiveMenu: (() => void) | null = null;

/**
 * Closes whatever menu is open, if any. The menu is mounted on `document.body`
 * rather than inside the grid tile it was opened from, so switching Live
 * Preview and Reading view — which tears down and rebuilds the tile's DOM,
 * see {@link AppGridRenderChild} in appGrid.ts — leaves it floating with no
 * tile left to anchor it. main.ts calls this on the workspace's
 * `layout-change`, which fires on exactly that switch.
 */
export function closeContextMenu(): void {
	closeActiveMenu?.();
}

/**
 * A hand-rolled right-click menu for the app-grid tile, styled to read as one
 * of Obsidian's own (rounded corners, shadow, grouped destructive actions —
 * see `styles.css`) without going through the `Menu` API, which can't express
 * the danger styling or the separator this needs. The bookmark/table-link
 * menus elsewhere in the plugin reuse Obsidian's own menu markup instead
 * (see `CLAUDE.md`); this is the one place that doesn't, since a grid tile
 * has no hover tooltip host to borrow that markup through.
 *
 * Positioning mounts the menu at the caller's point first so
 * `getBoundingClientRect()` can measure its real size, then clamps it into
 * the viewport with an 8px margin — a hover tooltip's host does this for
 * free, but a plain `document.body`-mounted element has to do it itself.
 * Coordinates go through `setCssProps()` rather than `el.style.left/top`,
 * since the latter is what Obsidian's plugin review's `no-static-styles-assignment`
 * rule exists to catch.
 */
export function showContextMenu(items: ContextMenuItemSpec[], x: number, y: number, onClose?: () => void): void {
	closeActiveMenu?.();

	const doc = activeDocument;
	const win = activeWindow;
	const menu = createDiv({ cls: MENU_CLASS });

	const abortController = new AbortController();
	function close(): void {
		abortController.abort();
		menu.remove();
		if (closeActiveMenu === close) closeActiveMenu = null;
		onClose?.();
	}
	closeActiveMenu = close;

	for (const spec of items) {
		if (spec.separatorBefore) menu.createDiv({ cls: SEPARATOR_CLASS });

		const item = menu.createDiv({
			cls: spec.danger ? `${ITEM_CLASS} ${ITEM_CLASS}-danger` : ITEM_CLASS,
		});
		item.toggleClass("is-disabled", !!spec.disabled);
		setIcon(item.createSpan({ cls: `${ITEM_CLASS}-icon` }), spec.icon);
		item.createSpan({ cls: `${ITEM_CLASS}-label`, text: spec.label });
		item.addEventListener("click", (event) => {
			event.stopPropagation();
			if (spec.disabled) return;
			close();
			spec.onClick();
		});
	}

	doc.body.appendChild(menu);
	const rect = menu.getBoundingClientRect();
	const left = Math.max(8, Math.min(x, win.innerWidth - rect.width - 8));
	const top = Math.max(8, Math.min(y, win.innerHeight - rect.height - 8));
	menu.setCssProps({
		"--better-link-display-context-menu-left": `${left}px`,
		"--better-link-display-context-menu-top": `${top}px`,
	});

	// One AbortController tears down all three close triggers at once — a
	// click outside, Escape, or the window losing focus entirely (switching
	// apps mid-menu).
	const { signal } = abortController;
	win.addEventListener(
		"mousedown",
		(event) => {
			if (!(event.target instanceof Node) || !menu.contains(event.target)) close();
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

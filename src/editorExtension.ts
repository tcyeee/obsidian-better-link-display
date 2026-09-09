import { App, Editor, Notice, setIcon } from "obsidian";
import { Extension, StateEffect, StateField, Text } from "@codemirror/state";
import {
	Decoration,
	DecorationSet,
	EditorView,
	Rect,
	Tooltip,
	ViewPlugin,
	closeHoverTooltips,
	hoverTooltip,
	showTooltip,
} from "@codemirror/view";
import { LOOKUP_TIMEOUT_MS, LookupFailure, LookupOutcome, SiteLookup } from "./lookup";
import { findExternalLinkAt, toLinkDestination, toLinkText } from "./urlScan";
import { withoutInlineIcon } from "./bookmarkScan";
import { isDelimiterRow, isTableRow, rowCells } from "./tableScan";
import { inVerbatimBlock } from "./verbatim";
import { t } from "./i18n";
import { API_BASE } from "./api";
import { logError, logWarn } from "./log";
import { fallbackIcon } from "./favicon";
import { currentLinkName, withCustomName } from "./customName";
import { CustomNameModal } from "./customNameModal";

/**
 * The menu should feel instant. CodeMirror treats a zero here as "use the
 * default 300ms", so this is the smallest delay that actually means "now".
 */
const HOVER_DELAY_MS = 1;

/** How long a failed link stays highlighted before returning to normal. */
const FAILURE_HIGHLIGHT_MS = 2500;

/** Failure notices explain a fix, so they need longer than Obsidian's default. */
const FAILURE_NOTICE_MS = 8000;

/** Marks the URL that is currently being resolved. */
const startLoading = StateEffect.define<{ id: number; from: number; to: number }>();
/** Track an open name dialog through edits without displaying a loading animation. */
const startNaming = StateEffect.define<{ id: number; from: number; to: number }>();
/** Turns a loading mark into a failure highlight, in place. */
const markFailed = StateEffect.define<number>();
/** Removes a mark entirely, whether it was loading or failed. */
const clearMark = StateEffect.define<number>();

interface MarkMeta {
	betterLinkDisplayId?: number;
}

function markId(value: { spec: unknown }): number | undefined {
	const spec = value.spec as MarkMeta | null;
	return spec?.betterLinkDisplayId;
}

function loadingMark(id: number): Decoration {
	return Decoration.mark({ class: "better-link-display-loading", betterLinkDisplayId: id });
}

function failedMark(id: number): Decoration {
	return Decoration.mark({ class: "better-link-display-failed", betterLinkDisplayId: id });
}

/**
 * Tracks the links currently mid-format. Holding them in a state field means
 * their positions are mapped through any edit the user makes while the request
 * is in flight, so the rewrite always lands on the right text.
 */
const pendingField = StateField.define<DecorationSet>({
	create() {
		return Decoration.none;
	},
	update(marks, tr) {
		marks = marks.map(tr.changes);
		for (const effect of tr.effects) {
			if (effect.is(startLoading) || effect.is(startNaming)) {
				const { id, from, to } = effect.value;
				const mark = effect.is(startLoading)
					? loadingMark(id) : Decoration.mark({ betterLinkDisplayId: id });
				marks = marks.update({ add: [mark.range(from, to)] });
			} else if (effect.is(markFailed)) {
				const range = findMark(marks, effect.value, tr.newDoc.length);
				marks = marks.update({ filter: (_f, _t, value) => markId(value) !== effect.value });
				if (range) {
					marks = marks.update({
						add: [failedMark(effect.value).range(range.from, range.to)],
					});
				}
			} else if (effect.is(clearMark)) {
				marks = marks.update({ filter: (_f, _t, value) => markId(value) !== effect.value });
			}
		}
		return marks;
	},
	provide: (field) => EditorView.decorations.from(field),
});

/**
 * The menu for a link inside a table, which is shown by hand rather than by
 * `hoverTooltip`.
 *
 * Live Preview draws a table as a *block* widget, and CodeMirror's hover gives
 * up on those: `BlockWidgetView.coordsAt()` reports a rect flattened onto the
 * widget's left edge, and `startHover` refuses to open a tooltip for a pointer
 * further than one character width from the position it found. A link in the
 * middle of a cell is never within that, so the hover source is not so much as
 * called — the pointer tracking below has to open and close this one itself.
 */
const setTableMenu = StateEffect.define<Tooltip | null>();

const tableMenuField = StateField.define<Tooltip | null>({
	create() {
		return null;
	},
	update(menu, tr) {
		// An edit rebuilds the table this was measured against, and a selection
		// inside it means a cell has been opened for editing as text.
		if (tr.docChanged || tr.selection) return null;
		for (const effect of tr.effects) {
			if (effect.is(setTableMenu)) return effect.value;
		}
		return menu;
	},
	provide: (field) => showTooltip.from(field),
});

function findMark(
	marks: DecorationSet,
	id: number,
	docLength: number
): { from: number; to: number } | null {
	let found: { from: number; to: number } | null = null;
	marks.between(0, docLength, (from, to, value) => {
		if (markId(value) === id) {
			found = { from, to };
			return false;
		}
		return undefined;
	});
	return found;
}

function hasMarkOverlapping(view: EditorView, from: number, to: number): boolean {
	let overlaps = false;
	view.state.field(pendingField).between(from, to, () => {
		overlaps = true;
		return false;
	});
	return overlaps;
}

/**
 * Owns the two ways to start a format — the hover menu and the command — and
 * the loading state both share. Held by the plugin so pending timers can be
 * cancelled on unload.
 */
export class BetterLinkDisplayEditorFeature {
	readonly extension: Extension;
	private nextId = 1;
	private timers = new Set<number>();
	private nameModals = new Set<CustomNameModal>();
	/**
	 * Where the pointer last was over the editor, and the rendered link it was
	 * on. Live Preview draws a table as one widget, so CodeMirror's hover reports
	 * the position the table starts at rather than anything about the link inside
	 * it — the element under the pointer is the only thing that says which link
	 * that is.
	 */
	private pointer: {
		x: number;
		y: number;
		anchor: HTMLAnchorElement | null;
		inTable: boolean;
	} = { x: 0, y: 0, anchor: null, inTable: false };
	/** The open table menu, for the closing rules the hover would otherwise own. */
	private tableMenu: HTMLElement | null = null;

	constructor(private readonly app: App, private readonly lookup: SiteLookup) {
		this.extension = [pendingField, tableMenuField, this.tooltip(), this.pointerTracking()];
	}

	/** Cancel the pending failure-highlight timers. */
	destroy(): void {
		for (const modal of this.nameModals) modal.close();
		for (const timer of this.timers) window.clearTimeout(timer);
		this.timers.clear();
	}

	/**
	 * Command entry point, anchored to the caret instead of the pointer. The
	 * hover menu is unreachable by keyboard and absent on touch, so the same
	 * action has to exist somewhere that does not require a mouse.
	 */
	formatAtCursor(editor: Editor, checking: boolean): boolean {
		const view = editorView(editor);
		if (!view) return false;
		if (!view.state.facet(EditorView.editable)) return false;

		const cursor = view.state.selection.main.head;
		const line = view.state.doc.lineAt(cursor);
		if (inVerbatimBlock(view.state.doc, line.number)) return false;

		const hit = findExternalLinkAt(line.text, cursor - line.from);
		if (!hit) return false;

		const from = line.from + hit.from;
		const to = line.from + hit.to;
		if (hasMarkOverlapping(view, from, to)) return false;

		if (!checking) void this.format(view, from, to, view.state.sliceDoc(from, to), hit.url);
		return true;
	}

	private tooltip(): Extension {
		return hoverTooltip(
			(view, pos) => {
				// Reading view has no editor at all, but an editor can still be
				// read-only (for example while a file is being previewed).
				if (!view.state.facet(EditorView.editable)) return null;
				// A table is rendered HTML, and the position CodeMirror reports for
				// a pointer over one is where the *table* starts — scanning there
				// could only ever turn up some other row's link. Those are found by
				// the pointer tracking below instead.
				if (this.pointer.inTable) return null;

				const line = view.state.doc.lineAt(pos);
				if (inVerbatimBlock(view.state.doc, line.number)) return null;

				const hit = findExternalLinkAt(line.text, pos - line.from);
				if (!hit) return null;

				const from = line.from + hit.from;
				const to = line.from + hit.to;
				const source = line.text.slice(hit.from, hit.to);
				if (hasMarkOverlapping(view, from, to)) return null;

				return {
					// `pos`..`end` spans the whole URL so the menu survives the
					// pointer travelling along it, while `getCoords` overrides where
					// it is drawn: under the character the pointer is actually on.
					pos: from,
					end: to,
					above: false,
					create: () => {
						const dom = this.menuDom(view, from, to, source, hit.url);
						return {
							dom,
							// Smaller than CodeMirror's own 4px tolerance for "the
							// pointer is still on the tooltip", so the gap the menu
							// hangs below the line by cannot close it on the way down.
							offset: { x: 0, y: 2 },
							getCoords: (fallback: number) => anchorUnderPointer(view, pos, fallback),
							// CodeMirror draws every hover tooltip inside one host
							// element and offers no way to put a class on it, so the
							// bubble Obsidian paints there is marked from here once
							// the host exists — the menu brings its own panel and
							// must not sit inside a second box.
							mount: () =>
								dom.parentElement?.classList.add("better-link-display-tooltip-host"),
						};
					},
				};
			},
			{ hoverTime: HOVER_DELAY_MS, hideOnChange: true }
		);
	}

	/**
	 * Show the menu for a link inside a table. The link is rendered HTML, so the
	 * source range behind it is reconstructed from the cell it sits in; when that
	 * cannot be done with certainty there is simply no menu.
	 */
	private openTableMenu(view: EditorView, anchor: HTMLAnchorElement): void {
		const href = anchor.getAttribute("href");
		const found = href ? tableLinkRange(view, anchor, href) : null;
		if (!found || hasMarkOverlapping(view, found.from, found.to)) {
			this.closeTableMenu(view);
			return;
		}

		const source = view.state.sliceDoc(found.from, found.to);
		const menu: Tooltip = {
			pos: found.from,
			end: found.to,
			above: false,
			create: () => {
				const dom = this.menuDom(view, found.from, found.to, source, found.url, true);
				this.watchTableMenu(view, dom, anchor);
				return {
					dom,
					// Smaller than the tolerance {@link overTableMenu} allows, so
					// the gap the menu hangs under the link by cannot close it on
					// the way down.
					offset: { x: 0, y: 2 },
					getCoords: (fallback: number) => anchorUnderElement(view, anchor, fallback),
					// No `mount` here: shown on its own, this menu *is* the tooltip
					// element CodeMirror paints, so there is no host above it.
				};
			},
		};
		view.dispatch({ effects: setTableMenu.of(menu) });
	}

	private closeTableMenu(view: EditorView): void {
		this.tableMenu = null;
		// Forgetting the link as well is what lets moving back onto it reopen the
		// menu, since the pointer only reports the links it moves *between*.
		this.pointer = { ...this.pointer, anchor: null };
		if (view.state.field(tableMenuField)) view.dispatch({ effects: setTableMenu.of(null) });
	}

	/**
	 * The menu is drawn outside the element the editor's mouse handlers are on,
	 * so once the pointer is over it, leaving it is the only event still heard.
	 */
	private watchTableMenu(view: EditorView, dom: HTMLElement, anchor: HTMLElement): void {
		this.tableMenu = dom;
		dom.addEventListener("mouseleave", (event) => {
			// Back onto its own link: the menu stays, and the pointer tracking
			// below takes over again.
			if (containsPoint(anchor, event.clientX, event.clientY)) return;
			this.closeTableMenu(view);
		});
	}

	/** Whether the pointer is on the open menu, allowing for the gap under it. */
	private overTableMenu(x: number, y: number): boolean {
		// The same 4px CodeMirror allows its own hover tooltips, and for the same
		// reason: the pointer has to cross the gap to reach the menu.
		return this.tableMenu !== null && containsPoint(this.tableMenu, x, y, 4);
	}

	/**
	 * Follows the pointer so {@link openTableMenu} knows which rendered link it
	 * is over. Cheap enough to run on every move: one `closest` walk, and only a
	 * link inside a table is ever kept.
	 *
	 * The listeners are attached by hand rather than through
	 * `EditorView.domEventHandlers`, which passes every bubbling event through
	 * `eventBelongsToEditor()` first — and that drops the ones inside a widget
	 * whose `ignoreEvent()` says so, which is the default and which would be
	 * exactly the table this exists for. They also go on `view.dom` rather than
	 * the content, so that leaving the editor is heard but moving onto the menu,
	 * which is drawn inside it, is not.
	 */
	private pointerTracking(): Extension {
		return ViewPlugin.define((view) => {
			const move = (event: MouseEvent) => this.onPointerMove(view, event);
			const leave = (event: MouseEvent) => this.onPointerLeave(view, event);
			view.dom.addEventListener("mousemove", move);
			view.dom.addEventListener("mouseleave", leave);
			return {
				destroy: () => {
					view.dom.removeEventListener("mousemove", move);
					view.dom.removeEventListener("mouseleave", leave);
				},
			};
		});
	}

	private onPointerMove(view: EditorView, event: MouseEvent): void {
		// Not `instanceof Element`: Obsidian gives a popout window its own copy of
		// the DOM classes, and a node from one fails that test against the main
		// window's.
		const target = event.target as Element | null;
		if (!target || target.nodeType !== Node.ELEMENT_NODE) return;
		// The pointer reaching the menu is not the pointer leaving the link the
		// menu belongs to.
		if (target.closest(".cm-tooltip")) return;

		const table = target.closest(".cm-table-widget");
		// Any anchor, not just the class Obsidian gives external links: whether it
		// is one this plugin can act on is decided further down, by finding its URL
		// in the source. Typed through `closest` rather than an `instanceof` test,
		// for the same reason as above.
		const link = table ? target.closest<HTMLAnchorElement>("a[href]") : null;
		const previous = this.pointer.anchor;
		this.pointer = {
			x: event.clientX,
			y: event.clientY,
			anchor: link,
			inTable: table !== null,
		};

		if (link === previous) return;
		if (link) this.openTableMenu(view, link);
		else if (!this.overTableMenu(event.clientX, event.clientY)) this.closeTableMenu(view);
	}

	private onPointerLeave(view: EditorView, event: MouseEvent): void {
		if (!this.overTableMenu(event.clientX, event.clientY)) this.closeTableMenu(view);
	}

	/**
	 * The hover menu, built out of Obsidian's own menu markup — `menu`,
	 * `menu-item`, `menu-item-icon`, `menu-item-title` — rather than bespoke
	 * elements, so it inherits whatever the user's theme does to right-click
	 * menus instead of approximating one theme's idea of them.
	 */
	private menuDom(
		view: EditorView,
		from: number,
		to: number,
		source: string,
		url: string,
		escapePipes = false
	): HTMLElement {
		const container = createDiv({
			cls: "menu better-link-display-menu",
			attr: { role: "menu" },
		});
		// A link that already carries an inlined icon is a bookmark this plugin
		// (or an equivalent hand edit) produced. Formatting it again is a
		// refresh, not a first format, and it is the only case where there is
		// something to undo — hence the second item, offered only here.
		const plain = withoutInlineIcon(source);

		this.menuItem(
			container,
			view,
			"bookmark",
			plain === null ? t("button.format") : t("button.reformat"),
			() => void this.format(view, from, to, source, url, escapePipes)
		);
		this.menuItem(container, view, "pencil", t("button.customName"), () =>
			this.customName(view, from, to, source, url, escapePipes)
		);

		if (plain !== null) {
			this.menuItem(container, view, "rotate-ccw", t("button.reset"), () =>
				this.reset(view, from, to, source, plain)
			);
		}
		return container;
	}

	private menuItem(
		container: HTMLElement,
		view: EditorView,
		icon: string,
		label: string,
		run: () => void
	): void {
		// A div rather than a button, because that is what `.menu-item` is
		// styled for: a button carries Obsidian's own background and padding,
		// which the menu rules do not undo.
		const item = container.createDiv({ cls: "menu-item", attr: { role: "menuitem" } });
		// The icon is decorative: it names the action at a glance, and an
		// Obsidian build without this glyph simply renders nothing beside the
		// label rather than an empty box.
		setIcon(item.createDiv({ cls: "menu-item-icon" }), icon);
		item.createDiv({ cls: "menu-item-title", text: label });
		// The editor would otherwise move the caret before the click lands.
		item.addEventListener("mousedown", (event) => event.preventDefault());
		item.addEventListener("click", (event) => {
			event.preventDefault();
			event.stopPropagation();
			view.dispatch({ effects: [closeHoverTooltips, setTableMenu.of(null)] });
			this.tableMenu = null;
			run();
		});
	}

	/**
	 * Drop a bookmark back to `[Title](url)`. No lookup and no loading state:
	 * the replacement is derived from the text already in the note, so it is one
	 * synchronous edit — which also means the only safety check it needs is the
	 * same one `format()` opens with.
	 */
	private reset(
		view: EditorView,
		from: number,
		to: number,
		source: string,
		plain: string
	): void {
		if (view.state.sliceDoc(from, to) !== source) return;
		if (hasMarkOverlapping(view, from, to)) return;
		view.dispatch({ changes: { from, to, insert: plain } });
	}

	private customName(
		view: EditorView, from: number, to: number, source: string, url: string, escapePipes: boolean
	): void {
		if (!view.dom.isConnected || !view.state.facet(EditorView.editable)) return;
		if (view.state.sliceDoc(from, to) !== source || hasMarkOverlapping(view, from, to)) return;
		const id = this.nextId++;
		view.dispatch({ effects: startNaming.of({ id, from, to }) });
		const modal = new CustomNameModal(this.app, currentLinkName(source), (name) => {
			const range = findMark(view.state.field(pendingField), id, view.state.doc.length);
			if (!view.dom.isConnected || !view.state.facet(EditorView.editable) || !range ||
				view.state.sliceDoc(range.from, range.to) !== source) {
				new Notice(t("customName.changed"));
				return;
			}
			view.dispatch({
				changes: {
					from: range.from, to: range.to,
					insert: withCustomName(source, url, name, fallbackIcon(url), escapePipes),
				},
				effects: clearMark.of(id),
			});
		}, () => {
			this.clearPending(view, id);
			this.nameModals.delete(modal);
		});
		this.nameModals.add(modal);
		modal.open();
	}

	private async format(
		view: EditorView,
		from: number,
		to: number,
		source: string,
		url: string,
		escapePipes = false
	): Promise<void> {
		// The menu may have been open across an edit; only act on the exact
		// text the item was offered for.
		if (view.state.sliceDoc(from, to) !== source) return;
		if (hasMarkOverlapping(view, from, to)) return;

		const id = this.nextId++;
		view.dispatch({ effects: startLoading.of({ id, from, to }) });

		let outcome: LookupOutcome;
		try {
			outcome = await this.lookup.resolve(url);
		} catch (error) {
			logError(`link format: lookup threw for ${url}`, error);
			outcome = { ok: false, reason: "server" };
		}

		// The lookup runs to completion no matter what the note does, but switching
		// to Reading view detaches this editor's DOM while keeping the EditorView
		// and its pendingField alive. Writing a bookmark into a view the user
		// can't see would be wrong — yet abandoning the loading mark strands the
		// link, because hasMarkOverlapping() then refuses every later format of it
		// until the editor is torn down. So drop the result but still clear the mark.
		if (!view.dom.isConnected) {
			this.clearPending(view, id);
			return;
		}
		const range = findMark(view.state.field(pendingField), id, view.state.doc.length);
		if (!range) return;

		if (!outcome.ok) {
			this.reportFailure(view, id, outcome.reason);
			return;
		}

		// The user may have edited the URL away while the request was in flight;
		// rewriting whatever now sits at those offsets would corrupt the note.
		if (view.state.sliceDoc(range.from, range.to) !== source) {
			logWarn(
				`link format: source text at the target range changed while the lookup ran — ${url} left untouched`
			);
			view.dispatch({ effects: clearMark.of(id) });
			return;
		}
		const bookmark = bookmarkMarkdown(outcome.info, url);
		view.dispatch({
			changes: {
				from: range.from,
				to: range.to,
				// A pipe from the site's title would otherwise end the table cell.
				insert: escapePipes ? bookmark.replace(/\|/g, "\\|") : bookmark,
			},
			effects: clearMark.of(id),
		});
	}

	private reportFailure(view: EditorView, id: number, reason: LookupFailure): void {
		logWarn(`link format failed, reason: ${reason}`);
		view.dispatch({ effects: markFailed.of(id) });
		const timer = window.setTimeout(() => {
			this.timers.delete(timer);
			this.clearPending(view, id);
		}, FAILURE_HIGHLIGHT_MS);
		this.timers.add(timer);

		new Notice(this.failureMessage(reason), FAILURE_NOTICE_MS);
	}

	/**
	 * Remove a pending mark, tolerating a view whose DOM has been detached by a
	 * switch to Reading view — it still owns the pendingField and needs the
	 * transaction, or the loading/failure highlight stays on the link for good.
	 * A view that was actually destroyed (its leaf closed) rejects the dispatch,
	 * but its state is gone with it, so there is nothing left to strand.
	 */
	private clearPending(view: EditorView, id: number): void {
		try {
			view.dispatch({ effects: clearMark.of(id) });
		} catch {
			// View destroyed; the mark went with its state.
		}
	}

	/**
	 * These read very differently on purpose: "the service is down" and "the
	 * service says this page doesn't resolve" need completely different actions
	 * from the user, and a single generic message hides which one happened.
	 */
	private failureMessage(reason: LookupFailure): string {
		switch (reason) {
			case "unconfigured":
				return t("failure.unconfigured");
			case "auth":
				return t("failure.auth");
			case "unreachable":
				return t("failure.unreachable", { base: API_BASE });
			case "server":
				return t("failure.server", { base: API_BASE });
			case "unresolved":
				return t("failure.unresolved");
			case "timeout":
				return t("failure.timeout", { seconds: LOOKUP_TIMEOUT_MS / 1000 });
		}
	}
}

/**
 * Where the menu is drawn: hanging from the character the pointer is on, the
 * way a right-click menu drops from where it was invoked — not centred on the
 * link, which would make it slide sideways as the pointer moves along a long
 * URL and would give a wrapped link no single sensible midpoint.
 *
 * CodeMirror lines the menu's left edge up with the `left` of whatever this
 * returns and its top edge with `bottom`, so a zero-width rect at the pointer
 * is all it needs; the width it would have to measure to centre anything is
 * deliberately not read here.
 */
function anchorUnderPointer(view: EditorView, pos: number, fallback: number): Rect {
	const at = view.coordsAtPos(pos) ?? view.coordsAtPos(fallback);
	if (!at) return { top: 0, bottom: 0, left: 0, right: 0 };
	return { top: at.top, bottom: at.bottom, left: at.left, right: at.left };
}

/**
 * The same, for a link Live Preview rendered as HTML: the element is the only
 * thing on screen that belongs to it, so the menu hangs from its left edge.
 */
/** Whether a point is inside an element's box, optionally widened by `margin`. */
function containsPoint(element: HTMLElement, x: number, y: number, margin = 0): boolean {
	if (!element.isConnected) return false;
	const rect = element.getBoundingClientRect();
	return (
		x >= rect.left - margin &&
		x <= rect.right + margin &&
		y >= rect.top - margin &&
		y <= rect.bottom + margin
	);
}

function anchorUnderElement(view: EditorView, element: HTMLElement, fallback: number): Rect {
	if (!element.isConnected) return anchorUnderPointer(view, fallback, fallback);
	const rect = element.getBoundingClientRect();
	return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.left };
}

interface TableLink {
	/** The link's source range. */
	from: number;
	to: number;
	url: string;
	/** The source range of the table it sits in. */
	blockFrom: number;
	blockTo: number;
}

/**
 * The source range behind a link rendered inside a table.
 *
 * The rendered table and its source are the same grid, so the anchor's cell and
 * row say which line and which cell of that line to look in. That mapping is
 * only as good as the assumption that the two grids line up, so it is never
 * trusted on its own: the cell it lands on has to actually contain the URL the
 * pointer is over, and the link found there has to be that same URL. Anything
 * else offers no menu rather than a menu that would rewrite the wrong cell.
 */
function tableLinkRange(view: EditorView, anchor: HTMLElement, href: string): TableLink | null {
	const cell = anchor.closest<HTMLTableCellElement>("td, th");
	const row = cell?.closest<HTMLTableRowElement>("tr");
	if (!cell || !row) return null;

	let pos: number;
	try {
		pos = view.posAtDOM(anchor);
	} catch {
		// A node CodeMirror does not recognise — there is nothing to map onto.
		return null;
	}

	const doc = view.state.doc;
	const block = tableBlockAt(doc, doc.lineAt(pos).number);
	if (!block) return null;

	// The delimiter row is not rendered, so a body row sits one line further down
	// in the source than its index in the rendered table.
	const lineNumber = row.rowIndex === 0 ? block.start : block.start + 1 + row.rowIndex;
	if (lineNumber > block.end) return null;

	const line = doc.line(lineNumber);
	const cellRange = rowCells(line.text)[cell.cellIndex];
	if (!cellRange) return null;

	const at = line.text.indexOf(href, cellRange.from);
	if (at < 0 || at >= cellRange.to) return null;
	const hit = findExternalLinkAt(line.text, at);
	if (!hit || hit.url !== href) return null;

	return {
		from: line.from + hit.from,
		to: line.from + hit.to,
		url: hit.url,
		blockFrom: doc.line(block.start).from,
		blockTo: doc.line(block.end).to,
	};
}

/**
 * The table block around a line: every neighbouring line that could be a row,
 * as long as the second of them is the delimiter row that makes them a table.
 * That check is load-bearing — the row arithmetic above counts that line.
 */
function tableBlockAt(doc: Text, lineNumber: number): { start: number; end: number } | null {
	// A widget's DOM maps to the position it starts at, but the lookup can land
	// on the line after a table just as easily as on its first row.
	let anchor = lineNumber;
	if (!isTableRow(doc.line(anchor).text) && anchor > 1) anchor -= 1;
	if (!isTableRow(doc.line(anchor).text)) return null;

	let start = anchor;
	while (start > 1 && isTableRow(doc.line(start - 1).text)) start -= 1;
	let end = anchor;
	while (end < doc.lines && isTableRow(doc.line(end + 1).text)) end += 1;

	if (end === start || !isDelimiterRow(doc.line(start + 1).text)) return null;
	return { start, end };
}

/**
 * The bookmark as it is written into the note: the icon is embedded as a data
 * URL rather than fetched at render time, so the line keeps working when the
 * note is copied into another vault, another app, or a plain markdown file.
 *
 * Nothing plugin-specific is written alongside it. The result is ordinary
 * Markdown that renders the same with the plugin disabled or absent, and the
 * styling in styles.css recognises it by the inlined icon rather than by a
 * marker that would otherwise linger in the user's file for good.
 */
export function bookmarkMarkdown(info: { title: string; favicon: string }, url: string): string {
	const favicon = info.favicon || fallbackIcon(url);
	const icon = favicon ? `![](${favicon}) ` : "";
	return `[${icon}${toLinkText(info.title, url)}](${toLinkDestination(url)})`;
}

/**
 * Obsidian's `Editor` wraps the CodeMirror view that owns the loading state.
 * The property is not in the public typings, so it is narrowed rather than
 * asserted: an Obsidian release that drops it disables the command instead of
 * throwing inside one.
 */
function editorView(editor: Editor): EditorView | null {
	const candidate = (editor as unknown as { cm?: unknown }).cm;
	return candidate instanceof EditorView ? candidate : null;
}

import { Editor, Notice, setIcon } from "obsidian";
import { Extension, StateEffect, StateField } from "@codemirror/state";
import {
	Decoration,
	DecorationSet,
	EditorView,
	Rect,
	closeHoverTooltips,
	hoverTooltip,
} from "@codemirror/view";
import { LOOKUP_TIMEOUT_MS, LookupFailure, LookupOutcome, SiteLookup } from "./lookup";
import { findExternalLinkAt, toLinkDestination, toLinkText } from "./urlScan";
import { inVerbatimBlock } from "./verbatim";
import { t } from "./i18n";
import { API_BASE } from "./api";

/**
 * The button should feel instant. CodeMirror treats a zero here as "use the
 * default 300ms", so this is the smallest delay that actually means "now".
 */
const HOVER_DELAY_MS = 1;

/** How long a failed link stays highlighted before returning to normal. */
const FAILURE_HIGHLIGHT_MS = 2500;

/** Failure notices explain a fix, so they need longer than Obsidian's default. */
const FAILURE_NOTICE_MS = 8000;

/** Marks the URL that is currently being resolved. */
const startLoading = StateEffect.define<{ id: number; from: number; to: number }>();
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
			if (effect.is(startLoading)) {
				const { id, from, to } = effect.value;
				marks = marks.update({ add: [loadingMark(id).range(from, to)] });
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
 * Owns the two ways to start a format — the hover button and the command — and
 * the loading state both share. Held by the plugin so pending timers can be
 * cancelled on unload.
 */
export class BetterLinkDisplayEditorFeature {
	readonly extension: Extension;
	private nextId = 1;
	private timers = new Set<number>();

	constructor(private readonly lookup: SiteLookup) {
		this.extension = [pendingField, this.tooltip()];
	}

	/** Cancel the pending failure-highlight timers. */
	destroy(): void {
		for (const timer of this.timers) window.clearTimeout(timer);
		this.timers.clear();
	}

	/**
	 * Command entry point, anchored to the caret instead of the pointer. The
	 * hover button is unreachable by keyboard and absent on touch, so the same
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

				const line = view.state.doc.lineAt(pos);
				if (inVerbatimBlock(view.state.doc, line.number)) return null;

				const hit = findExternalLinkAt(line.text, pos - line.from);
				if (!hit) return null;

				const from = line.from + hit.from;
				const to = line.from + hit.to;
				const source = line.text.slice(hit.from, hit.to);
				if (hasMarkOverlapping(view, from, to)) return null;

				return {
					// `pos`..`end` spans the whole URL so the tooltip survives the
					// pointer travelling along it, while `getCoords` overrides where
					// it is drawn: centred on the link, above the line.
					pos: from,
					end: to,
					above: true,
					create: () => {
						const dom = this.tooltipDom(view, from, to, source, hit.url);
						return {
							dom,
							// A gap the pointer can't fall into, but wide enough that
							// the button reads as floating over the link rather than
							// sitting on the line above it.
							offset: { x: 0, y: 4 },
							getCoords: (fallback: number) => centreOnLink(view, dom, from, to, fallback),
							// CodeMirror draws every hover tooltip inside one host
							// element and offers no way to put a class on it, so the
							// bubble Obsidian paints there is marked from here once
							// the host exists — the button is meant to be the whole
							// visual, not a chip inside a second box.
							mount: () =>
								dom.parentElement?.classList.add("better-link-display-tooltip-host"),
						};
					},
				};
			},
			{ hoverTime: HOVER_DELAY_MS, hideOnChange: true }
		);
	}

	private tooltipDom(
		view: EditorView,
		from: number,
		to: number,
		source: string,
		url: string
	): HTMLElement {
		const container = createDiv({ cls: "better-link-display-tooltip" });
		const button = container.createEl("button", { cls: "better-link-display-format-button" });
		// The icon is decorative: it names the action at a glance, and an
		// Obsidian build without this glyph simply renders nothing beside the
		// label rather than an empty box.
		setIcon(button, "bookmark");
		button.createSpan({ text: t("button.format") });
		// The editor would otherwise move the caret before the click lands.
		button.addEventListener("mousedown", (event) => event.preventDefault());
		button.addEventListener("click", (event) => {
			event.preventDefault();
			event.stopPropagation();
			view.dispatch({ effects: closeHoverTooltips });
			void this.format(view, from, to, source, url);
		});
		return container;
	}

	private async format(
		view: EditorView,
		from: number,
		to: number,
		source: string,
		url: string
	): Promise<void> {
		// The tooltip may have been open across an edit; only act on the exact
		// text the button was offered for.
		if (view.state.sliceDoc(from, to) !== source) return;
		if (hasMarkOverlapping(view, from, to)) return;

		const id = this.nextId++;
		view.dispatch({ effects: startLoading.of({ id, from, to }) });

		let outcome: LookupOutcome;
		try {
			outcome = await this.lookup.resolve(url);
		} catch {
			outcome = { ok: false, reason: "server" };
		}

		if (!view.dom.isConnected) return;
		const range = findMark(view.state.field(pendingField), id, view.state.doc.length);
		if (!range) return;

		if (!outcome.ok) {
			this.reportFailure(view, id, outcome.reason);
			return;
		}

		// The user may have edited the URL away while the request was in flight;
		// rewriting whatever now sits at those offsets would corrupt the note.
		if (view.state.sliceDoc(range.from, range.to) !== source) {
			view.dispatch({ effects: clearMark.of(id) });
			return;
		}
		view.dispatch({
			changes: { from: range.from, to: range.to, insert: bookmarkMarkdown(outcome.info, url) },
			effects: clearMark.of(id),
		});
	}

	private reportFailure(view: EditorView, id: number, reason: LookupFailure): void {
		view.dispatch({ effects: markFailed.of(id) });
		const timer = window.setTimeout(() => {
			this.timers.delete(timer);
			if (view.dom.isConnected) view.dispatch({ effects: clearMark.of(id) });
		}, FAILURE_HIGHLIGHT_MS);
		this.timers.add(timer);

		new Notice(this.failureMessage(reason), FAILURE_NOTICE_MS);
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
 * Where the hover button is drawn: horizontally centred on the link, on the
 * line the link ends on.
 *
 * CodeMirror lines the tooltip's left edge up with the `left` of whatever this
 * returns, so centring means handing back the button's own box moved onto the
 * link's midpoint — hence the measurement of `dom`, which is cheap and in-phase
 * here (CodeMirror calls `getCoords` from the read half of a measure cycle,
 * beside its own `getBoundingClientRect` calls).
 *
 * A link long enough to wrap has no single midpoint, and the coordinates of its
 * start belong to a different line than its end, so those are centred on the
 * end alone rather than on a span across two lines.
 */
function centreOnLink(
	view: EditorView,
	dom: HTMLElement,
	from: number,
	to: number,
	fallback: number
): Rect {
	const end = view.coordsAtPos(to, -1) ?? view.coordsAtPos(fallback);
	if (!end) return { top: 0, bottom: 0, left: 0, right: 0 };

	const start = view.coordsAtPos(from, 1);
	const sameLine = start && Math.abs(start.top - end.top) < 1;
	const centre = ((sameLine ? start.left : end.left) + end.right) / 2;
	const half = dom.getBoundingClientRect().width / 2;

	return { top: end.top, bottom: end.bottom, left: centre - half, right: centre + half };
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
	const icon = info.favicon ? `![](${info.favicon}) ` : "";
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

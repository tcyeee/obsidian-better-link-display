import { Notice } from "obsidian";
import { EditorState, Extension, StateEffect, StateField } from "@codemirror/state";
import {
	Decoration,
	DecorationSet,
	EditorView,
	closeHoverTooltips,
	hoverTooltip,
} from "@codemirror/view";
import { LOOKUP_TIMEOUT_MS, LookupConfig, LookupFailure, LookupOutcome, SiteLookup } from "./lookup";
import { findExternalLinkAt, toLinkText } from "./urlScan";

/**
 * The button should feel instant. CodeMirror treats a zero here as "use the
 * default 300ms", so this is the smallest delay that actually means "now".
 */
const HOVER_DELAY_MS = 1;

/** How long a failed link stays highlighted before returning to normal. */
const FAILURE_HIGHLIGHT_MS = 2500;

/** Failure notices explain a fix, so they need longer than Obsidian's default. */
const FAILURE_NOTICE_MS = 8000;

const BUTTON_LABEL = "格式化";

/** Marks the URL that is currently being resolved. */
const startLoading = StateEffect.define<{ id: number; from: number; to: number }>();
/** Turns a loading mark into a failure highlight, in place. */
const markFailed = StateEffect.define<number>();
/** Removes a mark entirely, whether it was loading or failed. */
const clearMark = StateEffect.define<number>();

interface MarkMeta {
	bookmarkifyId?: number;
}

function markId(value: { spec: unknown }): number | undefined {
	const spec = value.spec as MarkMeta | null;
	return spec?.bookmarkifyId;
}

function loadingMark(id: number): Decoration {
	return Decoration.mark({ class: "bookmarkify-loading", bookmarkifyId: id });
}

function failedMark(id: number): Decoration {
	return Decoration.mark({ class: "bookmarkify-failed", bookmarkifyId: id });
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
 * Owns the hover button and the loading state. Held by the plugin so pending
 * timers can be cancelled on unload.
 */
export class BookmarkifyEditorFeature {
	readonly extension: Extension;
	private nextId = 1;
	private timers = new Set<number>();

	constructor(
		private readonly lookup: SiteLookup,
		private readonly getConfig: () => LookupConfig
	) {
		this.extension = [pendingField, this.tooltip()];
	}

	/** Cancel the pending failure-highlight timers. */
	destroy(): void {
		for (const timer of this.timers) window.clearTimeout(timer);
		this.timers.clear();
	}

	private tooltip(): Extension {
		return hoverTooltip(
			(view, pos) => {
				// Reading view has no editor at all, but an editor can still be
				// read-only (for example while a file is being previewed).
				if (!view.state.facet(EditorView.editable)) return null;

				const line = view.state.doc.lineAt(pos);
				if (inVerbatimBlock(view.state, line.number)) return null;

				const hit = findExternalLinkAt(line.text, pos - line.from);
				if (!hit) return null;

				const from = line.from + hit.from;
				const to = line.from + hit.to;
				const source = line.text.slice(hit.from, hit.to);
				if (hasMarkOverlapping(view, from, to)) return null;

				return {
					// `pos`..`end` spans the whole URL so the tooltip survives the
					// pointer travelling along it, while `getCoords` overrides where
					// it is drawn: anchored to the link's right edge, above the line.
					pos: from,
					end: to,
					above: true,
					create: () => ({
						dom: this.tooltipDom(view, from, to, source, hit.url),
						getCoords: (fallback: number) =>
							view.coordsAtPos(to, -1) ??
							view.coordsAtPos(fallback) ?? { top: 0, bottom: 0, left: 0, right: 0 },
					}),
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
		const container = createDiv({ cls: "bookmarkify-tooltip" });
		const button = container.createEl("button", {
			cls: "bookmarkify-format-button",
			text: BUTTON_LABEL,
		});
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

		const current = findMark(view.state.field(pendingField), id, view.state.doc.length);
		if (!current) return;
		// The user may have edited the URL away while the request was in flight;
		// rewriting whatever now sits at those offsets would corrupt the note.
		if (view.state.sliceDoc(current.from, current.to) !== source) {
			view.dispatch({ effects: clearMark.of(id) });
			return;
		}
		view.dispatch({
			changes: { from: current.from, to: current.to, insert: bookmarkMarkdown(outcome.info, url) },
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
		const { apiBase } = this.getConfig();
		switch (reason) {
			case "unconfigured":
				return "Bookmarkify: set the access token in Settings → Bookmarkify first.";
			case "auth":
				return "Bookmarkify: the access token is invalid or has been revoked. Generate a new one and paste it into settings.";
			case "unreachable":
				return `Bookmarkify: no response from ${apiBase}. Check your connection and the Server URL in settings.`;
			case "server":
				return `Bookmarkify: ${apiBase} answered with an error. Check the service's logs.`;
			case "unresolved":
				return "Bookmarkify: the service could not read this page's title. The site may be blocking it.";
			case "timeout":
				return `Bookmarkify: no answer within ${LOOKUP_TIMEOUT_MS / 1000} seconds. The link was left unchanged.`;
		}
	}
}

/**
 * The bookmark as it is written into the note: the icon is embedded as a data
 * URL rather than fetched at render time, so the line keeps working when the
 * note is copied into another vault, another app, or a plain markdown file.
 */
function bookmarkMarkdown(info: { title: string; favicon: string }, url: string): string {
	const icon = info.favicon ? `![](${info.favicon}) ` : "";
	return `[${icon}${toLinkText(info.title, url)}](${url})`;
}

const FENCE = /^\s{0,3}(?:```|~~~)/;

/**
 * True when the line sits inside a fenced code block or the YAML frontmatter —
 * places where a URL is data, not a link, and must be left exactly as written.
 *
 * Counting fences from the top of the document is cheap enough here: the check
 * only runs once the pointer has rested on a URL.
 */
function inVerbatimBlock(state: EditorState, lineNumber: number): boolean {
	let inFence = false;
	let inFrontmatter = false;

	for (let n = 1; n < lineNumber; n++) {
		const text = state.doc.line(n).text;
		if (n === 1 && text.trim() === "---") {
			inFrontmatter = true;
			continue;
		}
		if (inFrontmatter) {
			if (text.trim() === "---") inFrontmatter = false;
			continue;
		}
		if (FENCE.test(text)) inFence = !inFence;
	}

	return inFence || inFrontmatter;
}

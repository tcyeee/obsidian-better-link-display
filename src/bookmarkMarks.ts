import { Range } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";

/**
 * Nothing plugin-specific is written into the note, so a formatted bookmark can
 * only be recognised by the favicon it inlined. `styles.css` used to do that with
 * `:has()`, which Obsidian's review rejects for the invalidation cost of a
 * selector that reaches back up the tree — so the recognition happens here
 * instead, and the stylesheet keys off the classes this module leaves behind.
 *
 * They are put on rendered elements only. Reading view re-renders from the
 * Markdown and Live Preview re-renders from the document, so nothing is carried
 * back into the user's file.
 */

/** Reading view: the anchor wrapping the icon and the title. */
export const BOOKMARK_CLASS = "better-link-display-bookmark";
/** Live Preview: the image embed CodeMirror renders the icon into. */
export const EMBED_CLASS = "better-link-display-embed";
/** Live Preview: a line holding a bookmark, whose link text is toned down. */
export const LINE_CLASS = "better-link-display-line";

const ICON_SELECTOR = 'img[src^="data:image/"]';

/**
 * The same favicon as seen from the document rather than the DOM: the closing
 * bracket of an image's alt text followed by an inlined icon. Matching the text
 * covers `![](…)` as written by this plugin and `![alt](…)` as written by hand,
 * which is the same set of links the `data:` image selector used to catch.
 */
const ICON_MARKUP = "](data:image/";

/**
 * Reading view, where the icon sits inside the anchor and the whole bookmark is
 * one element. Runs as a Markdown post-processor, so it sees each block once,
 * as it is rendered.
 */
export function markReadingViewBookmarks(el: Element): void {
	for (const icon of Array.from(el.querySelectorAll(ICON_SELECTOR))) {
		icon.closest("a.external-link")?.addClass(BOOKMARK_CLASS);
	}
}

const lineMark = Decoration.line({ class: LINE_CLASS });

/**
 * Live Preview marks the line through CodeMirror rather than by touching the
 * DOM: CodeMirror owns every `.cm-line` element, and its mutation observer
 * responds to a foreign class on one by marking the line dirty and wiping its
 * attributes on the next sync — the class would be stripped again moments after
 * being added. A line decoration is the supported way in, and it also means the
 * mark is derived from the document instead of from a render that may not have
 * happened yet.
 *
 * Lines being edited are skipped, because Live Preview swaps the bookmark back
 * for its raw Markdown there and the toned-down styling would then land on the
 * syntax the user is working on.
 */
function bookmarkLines(view: EditorView): DecorationSet {
	const marks: Range<Decoration>[] = [];
	const { doc, selection } = view.state;
	let lastMarked = -1;

	for (const { from, to } of view.visibleRanges) {
		for (let pos = from; pos <= to; ) {
			const line = doc.lineAt(pos);
			pos = line.to + 1;
			// Two visible ranges can meet inside one line; a line decoration must
			// not be added twice at the same position.
			if (line.from <= lastMarked || !line.text.includes(ICON_MARKUP)) continue;
			if (selection.ranges.some((range) => range.from <= line.to && range.to >= line.from)) {
				continue;
			}
			marks.push(lineMark.range(line.from));
			lastMarked = line.from;
		}
	}
	return Decoration.set(marks, true);
}

/**
 * The icon itself is rendered by Obsidian inside a widget, which CodeMirror
 * treats as foreign territory — mutations there are ignored by its observer, so
 * unlike the line, this element can safely be marked in the DOM. Doing it that
 * way keeps the mark on the one embed that holds a favicon, rather than on every
 * image that happens to share the line with a bookmark.
 */
function syncEmbedMarks(root: Element): void {
	for (const marked of Array.from(root.querySelectorAll(`.${EMBED_CLASS}`))) {
		if (!marked.querySelector(ICON_SELECTOR)) marked.removeClass(EMBED_CLASS);
	}
	for (const icon of Array.from(root.querySelectorAll(ICON_SELECTOR))) {
		icon.closest(".image-embed")?.addClass(EMBED_CLASS);
	}
}

export const bookmarkMarkers = ViewPlugin.fromClass(
	class {
		decorations: DecorationSet;

		constructor(private readonly view: EditorView) {
			this.decorations = bookmarkLines(view);
			this.scheduleEmbedPass();
		}

		update(update: ViewUpdate): void {
			// The selection matters as much as the document: moving the caret onto
			// a line reveals its Markdown without changing a character.
			if (update.docChanged || update.viewportChanged || update.selectionSet) {
				this.decorations = bookmarkLines(update.view);
			}
			this.scheduleEmbedPass();
		}

		/**
		 * A plugin's `update` runs before CodeMirror syncs its DOM, so the embeds
		 * are marked in the measure phase that follows, once the widgets Obsidian
		 * rendered for this update actually exist.
		 */
		private scheduleEmbedPass(): void {
			this.view.requestMeasure({
				// One pass per cycle however many updates asked for it.
				key: this,
				read: () => null,
				write: () => syncEmbedMarks(this.view.contentDOM),
			});
		}
	},
	{ decorations: (markers) => markers.decorations }
);

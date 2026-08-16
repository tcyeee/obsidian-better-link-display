import { Extension, Range } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { findBookmarkRanges, hasInlineIcon } from "./bookmarkScan";

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
/** Live Preview: one whole bookmark, icon and title together. */
export const PLATE_CLASS = "better-link-display-plate";

const ICON_SELECTOR = 'img[src^="data:image/"]';

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
 * The one element that holds a whole bookmark in Live Preview.
 *
 * Unlike Reading view, which renders a bookmark as a single anchor, Live Preview
 * renders the icon and the title as separate elements — sometimes nested, and
 * sometimes as plain siblings, depending on how CodeMirror tokenised the line.
 * Styling whichever of them is outermost therefore draws *two* plates whenever
 * they are siblings, splitting one bookmark into two boxes. A mark decoration
 * over the bookmark's source range sidesteps the question: CodeMirror wraps
 * everything in the range — the hidden syntax, the icon widget and the title —
 * in this one span, so there is exactly one thing to style.
 *
 * `inclusive` is what makes that true of the icon. A mark is exclusive by
 * default, which means it does not cover a decoration that *starts* where it
 * does — and Live Preview replaces the icon's Markdown, at the very front of the
 * bookmark, with a widget. Without this the plate would begin after the icon and
 * wrap the title alone, leaving the icon outside the box it belongs in.
 *
 * Where the mark is *provided* from matters just as much; see `outerPlates()`.
 */
const plateMark = Decoration.mark({ class: PLATE_CLASS, inclusive: true });

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
 * for its raw Markdown there and the rendered-look styling would then land on
 * the syntax the user is working on.
 */
function bookmarkDecorations(view: EditorView): BookmarkMarks {
	const lines: Range<Decoration>[] = [];
	const plates: Range<Decoration>[] = [];
	const { doc, selection } = view.state;
	let lastMarked = -1;

	for (const { from, to } of view.visibleRanges) {
		for (let pos = from; pos <= to; ) {
			const line = doc.lineAt(pos);
			pos = line.to + 1;
			// Two visible ranges can meet inside one line; a line decoration must
			// not be added twice at the same position.
			if (line.from <= lastMarked || !hasInlineIcon(line.text)) continue;
			if (selection.ranges.some((range) => range.from <= line.to && range.to >= line.from)) {
				continue;
			}
			lines.push(lineMark.range(line.from));
			lastMarked = line.from;
			for (const range of findBookmarkRanges(line.text)) {
				plates.push(plateMark.range(line.from + range.from, line.from + range.to));
			}
		}
	}
	return { lines: Decoration.set(lines, true), plates: Decoration.set(plates, true) };
}

/** The two kinds of mark, kept apart because they travel by different routes. */
interface BookmarkMarks {
	lines: DecorationSet;
	plates: DecorationSet;
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
		marks: BookmarkMarks;

		constructor(private readonly view: EditorView) {
			this.marks = bookmarkDecorations(view);
			this.scheduleEmbedPass();
		}

		update(update: ViewUpdate): void {
			// The selection matters as much as the document: moving the caret onto
			// a line reveals its Markdown without changing a character.
			if (update.docChanged || update.viewportChanged || update.selectionSet) {
				this.marks = bookmarkDecorations(update.view);
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
	{
		decorations: (plugin) => plugin.marks.lines,
		provide: (plugin) =>
			outerPlates((view) => view.plugin(plugin)?.marks.plates ?? Decoration.none),
	}
);

/**
 * The plate has to end up *outside* Obsidian's own `.cm-link` mark. Nested the
 * other way it is cut into one span per run of text — a box round the icon, a
 * box round the title — which is the splitting it exists to prevent.
 *
 * Precedence cannot decide that. CodeMirror nests the marks covering a position
 * by the order of the decoration sets they came from, innermost first, and
 * Obsidian's live-preview decorations are registered after a plugin's at the
 * same precedence — so they win the ordering however low this extension asks to
 * be. `outerDecorations` is the facet made for the job: `DocView.updateDeco()`
 * appends it after every value of the ordinary `decorations` facet, so a mark
 * from it wraps them all by construction rather than by luck.
 *
 * It is feature-detected because it arrived in @codemirror/view 6.29, and the
 * CodeMirror an Obsidian build bundles is not the one in devDependencies —
 * `manifest.json` still promises 1.0.0. On a build without it the plate is
 * simply not drawn, which costs the two appearance options in Live Preview and
 * nothing else; drawing a split one would be worse than drawing none.
 */
function outerPlates(plates: (view: EditorView) => DecorationSet): Extension {
	const outer = EditorView.outerDecorations as typeof EditorView.outerDecorations | undefined;
	return outer ? outer.of(plates) : [];
}

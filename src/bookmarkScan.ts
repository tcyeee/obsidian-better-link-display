/**
 * Finding a formatted bookmark in a line of Markdown, as source text rather than
 * as rendered DOM.
 *
 * Live Preview needs the whole bookmark — icon, title and the syntax between
 * them — as one range, because that is the only way to draw one plate around it:
 * the rendered elements are separate, and which of them contains the other is
 * CodeMirror's business, not ours. Kept here, away from anything that imports
 * `obsidian` or `@codemirror`, so it stays testable as plain string work.
 */

/**
 * The alt text's closing bracket followed by the start of an inlined icon. This
 * is the whole signature of a bookmark — nothing plugin-specific is written into
 * the note — and it matches both `![](…)` as this plugin writes it and `![alt](…)`
 * as it might be written by hand.
 */
const ICON_MARKUP = "](data:image/";

export interface BookmarkRange {
	/** Offset of the link's opening `[`. */
	from: number;
	/** Offset just past the link's closing `)`. */
	to: number;
}

/** Whether a line carries an inlined icon at all — the cheap first question. */
export function hasInlineIcon(text: string): boolean {
	return text.includes(ICON_MARKUP);
}

/**
 * Every bookmark on one line: a Markdown link whose text begins with, or simply
 * contains, an inlined icon. Ranges never overlap and are returned in the order
 * they appear, which is what a decoration set wants.
 */
export function findBookmarkRanges(text: string): BookmarkRange[] {
	const ranges: BookmarkRange[] = [];
	let search = 0;

	for (;;) {
		const icon = text.indexOf(ICON_MARKUP, search);
		if (icon < 0) return ranges;
		// Resume after this icon whether or not it turned out to sit in a link,
		// so a stray inline image can't stop the scan.
		search = icon + ICON_MARKUP.length;

		const range = bookmarkAround(text, icon);
		if (!range) continue;
		ranges.push(range);
		search = range.to;
	}
}

/**
 * The link an icon belongs to, or null when it belongs to nothing — a plain
 * inline image, or markup too broken to bound. Anything this refuses is simply
 * left unstyled, which is the safe direction: the note renders the same either
 * way.
 */
function bookmarkAround(text: string, icon: number): BookmarkRange | null {
	// The image's own opener. Its alt text cannot contain a bracket, or the `]`
	// found at `icon` would have belonged to something else.
	const image = text.lastIndexOf("![", icon);
	if (image < 0 || text.slice(image + 2, icon).includes("]")) return null;

	// The link the image is an icon of. Walking back stops at a `]`, which would
	// mean the image follows something already closed rather than sitting inside
	// link text that is still open.
	let open = -1;
	for (let i = image - 1; i >= 0; i--) {
		const char = text[i];
		if (char === "]") return null;
		if (char === "[") {
			open = i;
			break;
		}
	}
	// A `!` in front makes it an embed, not a link — an image of an image.
	if (open < 0 || text[open - 1] === "!") return null;

	// A data URL runs to the first `)`: base64 has no parenthesis to confuse it.
	const iconEnd = text.indexOf(")", icon + ICON_MARKUP.length);
	if (iconEnd < 0) return null;

	// The link's text ends at the `](` introducing its destination.
	const close = text.indexOf("]", iconEnd + 1);
	if (close < 0 || text[close + 1] !== "(") return null;

	const end = destinationEnd(text, close + 2);
	return end < 0 ? null : { from: open, to: end + 1 };
}

/**
 * Where a link destination closes. Parentheses are allowed inside one as long as
 * they balance, which is exactly the condition `toLinkDestination()` preserves
 * when it writes the URL, so the two agree on where the link ends.
 */
function destinationEnd(text: string, start: number): number {
	let depth = 0;
	for (let i = start; i < text.length; i++) {
		const char = text[i];
		if (char === "(") depth++;
		else if (char === ")") {
			if (depth === 0) return i;
			depth--;
		}
	}
	return -1;
}

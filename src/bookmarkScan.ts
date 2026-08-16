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

/** A {@link BookmarkRange} with the inner boundaries only the reset needs. */
interface BookmarkParts extends BookmarkRange {
	/** Offset of the first character of the link text, just past the `[`. */
	textFrom: number;
	/** Offset of the `]` that closes the link text. */
	textTo: number;
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
		ranges.push({ from: range.from, to: range.to });
		search = range.to;
	}
}

/**
 * The same bookmark with its icon taken back out — `[![](data:…) Title](url)`
 * becomes `[Title](url)` — or null when `text` is not exactly one bookmark.
 *
 * Refusing anything but a whole bookmark is what makes this safe to hand a
 * source range and write straight back: a partial match would otherwise be
 * rebuilt as a link, dropping whatever surrounded it. The destination is copied
 * verbatim, so a Markdown title after the URL survives, and the link text keeps
 * the words the user may have edited into it rather than being looked up again.
 */
export function withoutInlineIcon(text: string): string | null {
	const icon = text.indexOf(ICON_MARKUP);
	if (icon < 0) return null;

	const bookmark = bookmarkAround(text, icon);
	if (!bookmark || bookmark.from !== 0 || bookmark.to !== text.length) return null;

	const destination = text.slice(bookmark.textTo + 2, bookmark.to - 1);
	const label = stripIcons(text.slice(bookmark.textFrom, bookmark.textTo));
	// A bookmark that was nothing but an icon has no title to fall back on, and
	// `[](url)` renders as an invisible link. The address is at least clickable.
	return `[${label.length > 0 ? label : destination}](${destination})`;
}

/**
 * Every inlined icon removed from a link's text. The loop is defensive rather
 * than reachable today — `bookmarkAround()` refuses a link text holding a second
 * image — but a leftover icon would read as a reset that half-worked.
 */
function stripIcons(label: string): string {
	let remaining = label;
	for (;;) {
		const icon = remaining.indexOf(ICON_MARKUP);
		if (icon < 0) break;
		const image = remaining.lastIndexOf("![", icon);
		const end = remaining.indexOf(")", icon + ICON_MARKUP.length);
		if (image < 0 || end < 0) break;
		remaining = remaining.slice(0, image) + remaining.slice(end + 1);
	}
	// The icon is written with a space after it; removing both would otherwise
	// leave the title indented inside its own brackets.
	return remaining.replace(/\s+/g, " ").trim();
}

/**
 * The link an icon belongs to, or null when it belongs to nothing — a plain
 * inline image, or markup too broken to bound. Anything this refuses is simply
 * left unstyled, which is the safe direction: the note renders the same either
 * way.
 */
function bookmarkAround(text: string, icon: number): BookmarkParts | null {
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
	return end < 0 ? null : { from: open, to: end + 1, textFrom: open + 1, textTo: close };
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

/**
 * Text-level helpers shared by the editor extension and the reading view.
 * Everything here works on plain strings so it can be reasoned about without
 * an editor or a rendered DOM.
 */

/**
 * Parentheses and brackets are excluded so a match can never swallow the
 * surrounding markdown link syntax. A URL that legitimately contains one is
 * therefore cut short, which {@link BRACKET_AFTER_MATCH} detects and refuses.
 */
const BARE_URL = /https?:\/\/[^\s<>()[\]{}"'`\\]+/gi;

/**
 * An opening bracket directly after a match means {@link BARE_URL} stopped
 * early and the real URL continues past what was matched.
 */
const BRACKET_AFTER_MATCH = /[([{]/;

/** Sentence punctuation that follows a URL belongs to the sentence, not the URL. */
const TRAILING_PUNCTUATION = /[.,;:!?'"，。、；：！？）】]+$/;

export interface UrlHit {
	/** Offset of the first character to replace, relative to the scanned text. */
	from: number;
	/** Offset just past the last character to replace. */
	to: number;
	url: string;
}

export interface MarkdownLinkHit {
	/** Offset of the opening `[`. */
	from: number;
	/** Offset just past the closing `)`. */
	to: number;
	url: string;
}

function isEscaped(text: string, index: number): boolean {
	let slashes = 0;
	for (let i = index - 1; i >= 0 && text.charAt(i) === "\\"; i--) slashes += 1;
	return slashes % 2 === 1;
}

/** Return the matching delimiter, allowing balanced nested pairs. */
function matchingDelimiter(
	text: string,
	from: number,
	open: string,
	close: string
): number | null {
	let depth = 0;
	for (let i = from; i < text.length; i++) {
		const char = text.charAt(i);
		if (isEscaped(text, i)) continue;
		if (char === open) depth += 1;
		else if (char === close && --depth === 0) return i;
	}
	return null;
}

/** Parse the destination and closing parenthesis of a Markdown inline link. */
function markdownDestination(
	text: string,
	openParen: number
): { url: string; closeParen: number } | null {
	let cursor = openParen + 1;
	while (cursor < text.length && /[ \t]/.test(text.charAt(cursor))) cursor += 1;

	let url = "";
	if (text.charAt(cursor) === "<") {
		const end = text.indexOf(">", cursor + 1);
		if (end < 0) return null;
		url = text.slice(cursor + 1, end);
		cursor = end + 1;
	} else {
		const start = cursor;
		let depth = 0;
		for (; cursor < text.length; cursor++) {
			const char = text.charAt(cursor);
			if (isEscaped(text, cursor)) continue;
			if (char === "(") depth += 1;
			else if (char === ")") {
				if (depth === 0) break;
				depth -= 1;
			} else if (/\s/.test(char) && depth === 0) {
				break;
			}
		}
		url = text.slice(start, cursor);
	}

	if (!/^https?:\/\//i.test(url)) return null;

	// Anything after the destination is an optional Markdown title. Find the
	// outer closing parenthesis while respecting quoted titles.
	let quote = "";
	for (; cursor < text.length; cursor++) {
		const char = text.charAt(cursor);
		if (isEscaped(text, cursor)) continue;
		if (quote) {
			if (char === quote) quote = "";
			continue;
		}
		if (char === '"' || char === "'") quote = char;
		else if (char === ")") return { url, closeParen: cursor };
	}
	return null;
}

function insideInlineCode(prefix: string): boolean {
	let delimiterLength: number | null = null;
	for (let i = 0; i < prefix.length; i++) {
		if (prefix.charAt(i) !== "`") continue;
		let end = i + 1;
		while (prefix.charAt(end) === "`") end += 1;
		const runLength = end - i;
		if (delimiterLength === null) delimiterLength = runLength;
		else if (delimiterLength === runLength) delimiterLength = null;
		i = end - 1;
	}
	return delimiterLength !== null;
}

/**
 * Find the bare URL covering `offset` within a single line, if any.
 *
 * "Bare" means the URL stands on its own: a URL that is already the target or
 * the text of a markdown link, an autolink, or part of inline code is not a
 * candidate for formatting.
 */
export function findBareUrlAt(line: string, offset: number): UrlHit | null {
	BARE_URL.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = BARE_URL.exec(line)) !== null) {
		const start = match.index;
		const url = match[0].replace(TRAILING_PUNCTUATION, "");
		if (url.length === 0) continue;
		const end = start + url.length;
		if (offset < start || offset > end) continue;

		const previous = start > 0 ? line.charAt(start - 1) : "";
		if (previous === "(" || previous === "[" || previous === "<") return null;
		if (insideInlineCode(line.slice(0, start))) return null;
		// Formatting a truncated URL would silently repoint the link at a
		// different page and leave the remainder stranded outside it, so offer
		// nothing rather than something wrong.
		if (BRACKET_AFTER_MATCH.test(line.charAt(start + match[0].length))) return null;

		return { from: start, to: end, url };
	}
	return null;
}

/** All `[text](https://…)` links in a chunk of text, in document order. */
export function findMarkdownLinks(text: string): MarkdownLinkHit[] {
	const hits: MarkdownLinkHit[] = [];
	for (let open = 0; open < text.length; open++) {
		if (text.charAt(open) !== "[" || isEscaped(text, open)) continue;
		// `![alt](url)` is an external image/embed, not a navigable link. Turning
		// it into a bookmark would unexpectedly change the note's meaning.
		if (open > 0 && text.charAt(open - 1) === "!" && !isEscaped(text, open - 1)) continue;

		const closeBracket = matchingDelimiter(text, open, "[", "]");
		if (closeBracket === null || text.charAt(closeBracket + 1) !== "(") continue;
		const destination = markdownDestination(text, closeBracket + 1);
		if (!destination) continue;

		hits.push({ from: open, to: destination.closeParen + 1, url: destination.url });
		open = destination.closeParen;
	}
	return hits;
}

/**
 * Find any Obsidian-supported external link under the pointer.
 *
 * Markdown links and autolinks return their complete source range so callers
 * can replace them with a bookmark without producing nested Markdown. Bare
 * URLs keep their original URL-only range.
 */
export function findExternalLinkAt(line: string, offset: number): UrlHit | null {
	if (insideInlineCode(line.slice(0, offset))) return null;

	for (const hit of findMarkdownLinks(line)) {
		if (offset >= hit.from && offset <= hit.to) {
			return { from: hit.from, to: hit.to, url: hit.url };
		}
	}

	const autolink = /<https?:\/\/[^\s<>]+>/gi;
	let match: RegExpExecArray | null;
	while ((match = autolink.exec(line)) !== null) {
		const from = match.index;
		const to = from + match[0].length;
		if (offset >= from && offset <= to) {
			return { from, to, url: match[0].slice(1, -1) };
		}
	}

	return findBareUrlAt(line, offset);
}

/**
 * The service is documented to return favicons as base64 data URLs. Reject
 * anything else so a compromised or misconfigured endpoint can't turn a note
 * into a set of tracking-pixel requests.
 */
export function isSafeFaviconSrc(src: string): boolean {
	return /^data:image\/[a-z0-9.+-]+[;,]/i.test(src);
}

/** True when every parenthesis in the string is matched by a later one. */
function hasBalancedParens(url: string): boolean {
	let depth = 0;
	for (let i = 0; i < url.length; i++) {
		const char = url.charAt(i);
		if (char === "(") depth += 1;
		else if (char === ")") {
			depth -= 1;
			if (depth < 0) return false;
		}
	}
	return depth === 0;
}

function percentEncode(char: string): string {
	// encodeURIComponent leaves parentheses alone, but they are exactly what has
	// to go when the destination cannot rely on them being balanced.
	if (char === "(") return "%28";
	if (char === ")") return "%29";
	return encodeURIComponent(char);
}

/**
 * Render a URL as the destination of an inline Markdown link.
 *
 * Whitespace and angle brackets end a destination early, and so do parentheses
 * unless every one of them is matched — an autolink or an angle-bracket
 * destination can supply all three. Percent-encoding those characters leaves
 * the address a browser resolves unchanged while guaranteeing the written link
 * parses back to the URL it was built from.
 */
export function toLinkDestination(url: string): string {
	const unsafe = hasBalancedParens(url) ? /[\s<>]/g : /[\s<>()]/g;
	return url.replace(unsafe, percentEncode);
}

/**
 * Make a title safe to drop into `[…](url)`: brackets would terminate the link
 * text early, a trailing backslash would escape the closing one, and a newline
 * would break the link across block boundaries.
 */
export function toLinkText(title: string, fallback: string): string {
	const cleaned = sanitizeLinkText(title);
	return cleaned.length > 0 ? cleaned : sanitizeLinkText(fallback);
}

function sanitizeLinkText(value: string): string {
	return value
		.replace(/\\/g, "\\\\")
		.replace(/[[\]]/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

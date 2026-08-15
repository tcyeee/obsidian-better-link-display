/**
 * Text-level helpers shared by the editor extension and the reading view.
 * Everything here works on plain strings so it can be reasoned about without
 * an editor or a rendered DOM.
 */

/**
 * Parentheses and brackets are excluded so a match can never swallow the
 * surrounding markdown link syntax. The cost is that a URL which legitimately
 * contains parentheses is cut short — acceptable, since such a URL is
 * ambiguous in markdown anyway.
 */
const BARE_URL = /https?:\/\/[^\s<>()[\]{}"'`\\]+/gi;

/** Sentence punctuation that follows a URL belongs to the sentence, not the URL. */
const TRAILING_PUNCTUATION = /[.,;:!?'"，。、；：！？）】]+$/;

const MARKDOWN_LINK = /\[([^[\]\n]*)\]\((https?:\/\/[^\s()]+)\)/g;

export interface UrlHit {
	/** Offset of the first character of the URL, relative to the scanned text. */
	from: number;
	/** Offset just past the last character of the URL. */
	to: number;
	url: string;
}

export interface MarkdownLinkHit {
	/** Offset of the opening `[`. */
	from: number;
	/** Offset just past the closing `)`. */
	to: number;
	/** Offset of the first character of the link text. */
	textFrom: number;
	url: string;
}

function insideInlineCode(prefix: string): boolean {
	let ticks = 0;
	for (const char of prefix) {
		if (char === "`") ticks += 1;
	}
	return ticks % 2 === 1;
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

		return { from: start, to: end, url };
	}
	return null;
}

/** All `[text](https://…)` links in a chunk of text, in document order. */
export function findMarkdownLinks(text: string): MarkdownLinkHit[] {
	const hits: MarkdownLinkHit[] = [];
	MARKDOWN_LINK.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = MARKDOWN_LINK.exec(text)) !== null) {
		hits.push({
			from: match.index,
			to: match.index + match[0].length,
			textFrom: match.index + 1,
			url: match[2],
		});
	}
	return hits;
}

/**
 * Cache key for a favicon. `www.` is dropped so a site looked up once is
 * recognised whether or not a later link carries the subdomain.
 */
export function extractHost(url: string): string | null {
	try {
		const host = new URL(url).hostname.toLowerCase();
		return host.startsWith("www.") ? host.slice(4) : host;
	} catch {
		return null;
	}
}

/**
 * The service is documented to return favicons as base64 data URLs. Reject
 * anything else so a compromised or misconfigured endpoint can't turn a note
 * into a set of tracking-pixel requests.
 */
export function isSafeFaviconSrc(src: string): boolean {
	return /^data:image\/[a-z0-9.+-]+[;,]/i.test(src);
}

/**
 * Make a site title safe to drop into `[…](url)`: brackets would terminate the
 * link text early, and a newline would break the link across block boundaries.
 */
export function toLinkText(title: string, fallback: string): string {
	const cleaned = title.replace(/[[\]]/g, "").replace(/\s+/g, " ").trim();
	return cleaned.length > 0 ? cleaned : fallback;
}

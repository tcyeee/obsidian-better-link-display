/**
 * Pure parsing of a `link-grid` code block's body. No `obsidian` import, so it
 * can be exercised without an editor or a rendered DOM — see appGridScan.test.ts.
 */

const HTTP_URL = /^https?:\/\//i;

/**
 * One URL per line. Blank lines and anything that doesn't start like a URL are
 * dropped rather than rejected, so a block that's being hand-edited never shows
 * an error for a half-typed or commented-out line. Duplicates are kept as-is —
 * a tile per line, in the order written.
 */
export function parseAppGridSource(source: string): string[] {
	return source
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => HTTP_URL.test(line));
}

export interface AppGridInsertion {
	/** Text to insert at the end of the current line. */
	text: string;
	/** Where to leave the cursor afterwards, relative to the insertion point. */
	cursorOffset: { line: number; ch: number };
}

const BLOCK_TEMPLATE = "```link-grid\n\n```\n";

/**
 * Text for the "Insert APP view" menu item and where the cursor should land
 * afterwards — the blank line between the fences, ready to paste a URL. The
 * caller appends this at the end of the line under the cursor rather than at
 * the cursor itself, so when that line already holds text the block starts
 * on a line of its own instead of splitting the text in two.
 */
export function buildAppGridInsertion(currentLine: string): AppGridInsertion {
	const ownLine = currentLine.length > 0;
	return {
		text: `${ownLine ? "\n" : ""}${BLOCK_TEMPLATE}`,
		cursorOffset: { line: ownLine ? 2 : 1, ch: 0 },
	};
}

/**
 * Turns what the "Add" dialog's domain field holds into a URL a `link-grid`
 * line can use. A bare domain ("example.com") is given an `https://` scheme;
 * anything that already looks like a URL keeps its own — `HTTP_URL` guarantees
 * that scheme is `http`/`https` either way, so there's no separate protocol
 * check to smuggle a `javascript:` or `data:` URL past. `URL` is left to catch
 * everything else unparsable (spaces, an empty host, …).
 */
export function normalizeAppGridUrl(input: string): string | null {
	const trimmed = input.trim();
	if (!trimmed) return null;
	const candidate = HTTP_URL.test(trimmed) ? trimmed : `https://${trimmed}`;
	try {
		return new URL(candidate).href;
	} catch {
		return null;
	}
}

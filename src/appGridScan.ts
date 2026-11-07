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

/**
 * Detection of the places where a URL is data rather than a link: fenced code
 * blocks and the YAML frontmatter. Both must be left exactly as written.
 */

import type { Text } from "@codemirror/state";

const FENCE = /^\s{0,3}(?:```|~~~)/;

/** Inclusive first and last line number of one verbatim region. */
type LineRange = readonly [number, number];

/**
 * Finding a region means walking the document from the top, which is far too
 * much work to repeat for every pointer movement. `Text` is immutable, so one
 * scan per document version is enough and an edit simply misses the cache.
 */
const cache = new WeakMap<Text, readonly LineRange[]>();

/**
 * True when the line sits inside a fenced code block or the frontmatter.
 *
 * The line that opens a region is deliberately excluded and the line that
 * closes it included: a URL in an info string is still part of the fence, while
 * the fence markers themselves are not somewhere a link can be formatted.
 */
export function inVerbatimBlock(doc: Text, lineNumber: number): boolean {
	return verbatimRanges(doc).some(([from, to]) => lineNumber >= from && lineNumber <= to);
}

function verbatimRanges(doc: Text): readonly LineRange[] {
	const cached = cache.get(doc);
	if (cached) return cached;

	const ranges: LineRange[] = [];
	let openedAt: number | null = null;
	let inFrontmatter = false;
	let lineNumber = 0;

	for (const text of doc.iterLines()) {
		lineNumber += 1;
		if (lineNumber === 1 && text.trim() === "---") {
			inFrontmatter = true;
			openedAt = 1;
			continue;
		}
		if (inFrontmatter) {
			if (text.trim() !== "---") continue;
			ranges.push([2, lineNumber]);
			inFrontmatter = false;
			openedAt = null;
			continue;
		}
		if (!FENCE.test(text)) continue;
		if (openedAt === null) openedAt = lineNumber;
		else {
			ranges.push([openedAt + 1, lineNumber]);
			openedAt = null;
		}
	}

	// An unterminated fence or frontmatter runs to the end of the document.
	if (openedAt !== null) ranges.push([openedAt + 1, lineNumber]);

	cache.set(doc, ranges);
	return ranges;
}

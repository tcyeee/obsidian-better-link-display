import { strict as assert } from "node:assert";
import { test } from "node:test";
import { findBookmarkRanges, hasInlineIcon } from "./bookmarkScan";

/** An icon as this plugin writes one, short enough to keep a case readable. */
const ICON = "![](data:image/png;base64,iVBORw0KGgo=)";

/** The source text a range covers, which is what the assertions are about. */
function sliced(text: string): string[] {
	return findBookmarkRanges(text).map((range) => text.slice(range.from, range.to));
}

test("covers the whole bookmark, from the opening bracket to the closing paren", () => {
	const bookmark = `[${ICON} Example](https://example.com)`;
	assert.deepEqual(sliced(`before ${bookmark} after`), [bookmark]);
});

test("finds every bookmark on a line", () => {
	const first = `[${ICON} One](https://one.example)`;
	const second = `[${ICON} Two](https://two.example)`;
	assert.deepEqual(sliced(`${first} and ${second}`), [first, second]);
});

test("keeps a destination's balanced parentheses inside the range", () => {
	const bookmark = `[${ICON} Article](https://example.com/a_(disambiguation))`;
	assert.deepEqual(sliced(bookmark), [bookmark]);
});

test("takes an icon anywhere in the link text, not only at its head", () => {
	const bookmark = `[Example ${ICON}](https://example.com)`;
	assert.deepEqual(sliced(bookmark), [bookmark]);
});

test("reads a hand-written alt text", () => {
	const bookmark = "[![icon](data:image/png;base64,AAAA) Example](https://example.com)";
	assert.deepEqual(sliced(bookmark), [bookmark]);
});

test("ignores an inlined image that is not inside a link", () => {
	assert.deepEqual(sliced(`${ICON} on its own`), []);
	assert.deepEqual(sliced(`![alt] ${ICON}`), [], "a closed bracket ends the search back");
});

test("ignores an embed of an image, which is not a bookmark", () => {
	assert.deepEqual(sliced(`!${ICON}`), []);
});

test("ignores an ordinary link with an ordinary image in it", () => {
	assert.deepEqual(sliced("[![](https://example.com/i.png) Example](https://example.com)"), []);
});

test("leaves unterminated markup alone", () => {
	assert.deepEqual(sliced(`[${ICON} Example`), [], "no destination");
	assert.deepEqual(sliced(`[${ICON} Example] (https://example.com)`), [], "a gap is not a link");
	assert.deepEqual(sliced("[![](data:image/png;base64,AAAA"), [], "no closing paren");
});

test("recognises a line carrying an icon", () => {
	assert.equal(hasInlineIcon(`[${ICON} Example](https://example.com)`), true);
	assert.equal(hasInlineIcon("[Example](https://example.com)"), false);
});

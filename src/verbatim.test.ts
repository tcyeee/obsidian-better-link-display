import { strict as assert } from "node:assert";
import { test } from "node:test";
import { Text } from "@codemirror/state";
import { inVerbatimBlock } from "./verbatim";

function lines(...content: string[]): Text {
	return Text.of(content);
}

test("treats the body and closing marker of a fenced block as verbatim", () => {
	const doc = lines("before", "```js", "https://example.com", "```", "after");
	assert.equal(inVerbatimBlock(doc, 1), false);
	assert.equal(inVerbatimBlock(doc, 2), false, "the opening fence is not inside itself");
	assert.equal(inVerbatimBlock(doc, 3), true);
	assert.equal(inVerbatimBlock(doc, 4), true);
	assert.equal(inVerbatimBlock(doc, 5), false, "the block ended");
});

test("handles several blocks and tilde fences in one document", () => {
	const doc = lines("a", "~~~", "x", "~~~", "b", "```", "y", "```", "c");
	assert.deepEqual(
		[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => inVerbatimBlock(doc, n)),
		[false, false, true, true, false, false, true, true, false]
	);
});

test("an unterminated fence runs to the end of the document", () => {
	const doc = lines("a", "```", "x", "y");
	assert.equal(inVerbatimBlock(doc, 3), true);
	assert.equal(inVerbatimBlock(doc, 4), true);
});

test("treats frontmatter as verbatim only at the top of the document", () => {
	const doc = lines("---", "url: https://example.com", "---", "body");
	assert.equal(inVerbatimBlock(doc, 2), true);
	assert.equal(inVerbatimBlock(doc, 3), true);
	assert.equal(inVerbatimBlock(doc, 4), false);

	// A "---" further down is a horizontal rule, not frontmatter.
	const rule = lines("body", "---", "https://example.com");
	assert.equal(inVerbatimBlock(rule, 3), false);
});

test("indented fences count, but a four-space indent does not", () => {
	assert.equal(inVerbatimBlock(lines("a", "   ```", "x", "   ```"), 3), true);
	assert.equal(inVerbatimBlock(lines("a", "    ```", "x"), 3), false);
});

test("repeated queries reuse one scan of an unchanged document", () => {
	const doc = lines("---", "a", "---", "https://example.com");
	assert.equal(inVerbatimBlock(doc, 4), false);
	assert.equal(inVerbatimBlock(doc, 4), false);
	assert.equal(inVerbatimBlock(doc, 2), true);
});

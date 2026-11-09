import { strict as assert } from "node:assert";
import { test } from "node:test";
import { buildAppGridInsertion, normalizeAppGridUrl, parseAppGridSource } from "./appGridScan";

test("one URL per line", () => {
	const source = "https://example.com\nhttps://example.org";
	assert.deepEqual(parseAppGridSource(source), [
		"https://example.com",
		"https://example.org",
	]);
});

test("drops blank lines", () => {
	const source = "https://example.com\n\n\nhttps://example.org\n";
	assert.deepEqual(parseAppGridSource(source), [
		"https://example.com",
		"https://example.org",
	]);
});

test("drops lines that don't start with http(s)", () => {
	const source = [
		"https://example.com",
		"# a comment",
		"not a url",
		"ftp://example.org",
		"http://example.net",
	].join("\n");
	assert.deepEqual(parseAppGridSource(source), [
		"https://example.com",
		"http://example.net",
	]);
});

test("trims surrounding whitespace on each line", () => {
	const source = "  https://example.com  \n\thttps://example.org\t";
	assert.deepEqual(parseAppGridSource(source), [
		"https://example.com",
		"https://example.org",
	]);
});

test("keeps duplicates in the order written", () => {
	const source = "https://example.com\nhttps://example.com";
	assert.deepEqual(parseAppGridSource(source), [
		"https://example.com",
		"https://example.com",
	]);
});

test("an empty block parses to an empty list", () => {
	assert.deepEqual(parseAppGridSource(""), []);
	assert.deepEqual(parseAppGridSource("   \n  \n"), []);
});

test("inserting on an empty line starts the block there", () => {
	assert.deepEqual(buildAppGridInsertion(""), {
		text: "```link-grid\n\n```\n",
		cursorOffset: { line: 1, ch: 0 },
	});
});

test("inserting on a non-empty line gives the block its own line", () => {
	assert.deepEqual(buildAppGridInsertion("some existing text"), {
		text: "\n```link-grid\n\n```\n",
		cursorOffset: { line: 2, ch: 0 },
	});
});

test("normalizeAppGridUrl adds https to a bare domain", () => {
	assert.equal(normalizeAppGridUrl("example.com"), "https://example.com/");
	assert.equal(normalizeAppGridUrl("  example.com/page  "), "https://example.com/page");
});

test("normalizeAppGridUrl keeps an explicit scheme", () => {
	assert.equal(normalizeAppGridUrl("http://example.com/page"), "http://example.com/page");
	assert.equal(normalizeAppGridUrl("HTTPS://Example.com"), "https://example.com/");
});

test("normalizeAppGridUrl rejects blank or unparsable input", () => {
	assert.equal(normalizeAppGridUrl(""), null);
	assert.equal(normalizeAppGridUrl("   "), null);
	assert.equal(normalizeAppGridUrl("not a url"), null);
});

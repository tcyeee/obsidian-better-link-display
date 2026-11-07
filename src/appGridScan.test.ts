import { strict as assert } from "node:assert";
import { test } from "node:test";
import { parseAppGridSource } from "./appGridScan";

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

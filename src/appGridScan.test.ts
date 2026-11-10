import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
	AppGridConfig,
	AppGridEntry,
	DEFAULT_APP_GRID_CONFIG,
	buildAppGridInsertion,
	normalizeAppGridUrl,
	parseAppGridConfig,
	parseAppGridSource,
	removeAppGridLine,
	serializeAppGridConfig,
	setAppGridEntryName,
	upsertAppGridConfigLine,
} from "./appGridScan";

/** A bare-URL entry by default; pass a name for a `[Name](url)` line. */
const entry = (url: string, name: string | null = null): AppGridEntry => ({ url, name });

test("one URL per line", () => {
	const source = "https://example.com\nhttps://example.org";
	assert.deepEqual(parseAppGridSource(source), [
		entry("https://example.com"),
		entry("https://example.org"),
	]);
});

test("drops blank lines", () => {
	const source = "https://example.com\n\n\nhttps://example.org\n";
	assert.deepEqual(parseAppGridSource(source), [
		entry("https://example.com"),
		entry("https://example.org"),
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
		entry("https://example.com"),
		entry("http://example.net"),
	]);
});

test("trims surrounding whitespace on each line", () => {
	const source = "  https://example.com  \n\thttps://example.org\t";
	assert.deepEqual(parseAppGridSource(source), [
		entry("https://example.com"),
		entry("https://example.org"),
	]);
});

test("keeps duplicates in the order written", () => {
	const source = "https://example.com\nhttps://example.com";
	assert.deepEqual(parseAppGridSource(source), [
		entry("https://example.com"),
		entry("https://example.com"),
	]);
});

test("an empty block parses to an empty list", () => {
	assert.deepEqual(parseAppGridSource(""), []);
	assert.deepEqual(parseAppGridSource("   \n  \n"), []);
});

test("reads a name written into a [Name](url) line", () => {
	assert.deepEqual(parseAppGridSource("[My Site](https://example.com)"), [
		entry("https://example.com", "My Site"),
	]);
});

test("mixes bare-URL and named lines in the order written", () => {
	const source = "https://example.com\n[Custom](https://example.org)\nhttps://example.net";
	assert.deepEqual(parseAppGridSource(source), [
		entry("https://example.com"),
		entry("https://example.org", "Custom"),
		entry("https://example.net"),
	]);
});

test("unescapes brackets and backslashes in a written name", () => {
	assert.deepEqual(parseAppGridSource("[a \\] b \\\\ c](https://example.com)"), [
		entry("https://example.com", "a ] b \\ c"),
	]);
});

test("a link whose text is empty reads as a bare URL", () => {
	assert.deepEqual(parseAppGridSource("[](https://example.com)"), [
		entry("https://example.com"),
	]);
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

test("removeAppGridLine drops only the nth URL line", () => {
	const source = "https://example.com\nhttps://example.org\nhttps://example.net";
	assert.equal(
		removeAppGridLine(source, 1),
		"https://example.com\nhttps://example.net"
	);
});

test("removeAppGridLine leaves blank lines and comments untouched", () => {
	const source = [
		"https://example.com",
		"",
		"# a comment",
		"https://example.org",
	].join("\n");
	assert.equal(
		removeAppGridLine(source, 0),
		["", "# a comment", "https://example.org"].join("\n")
	);
});

test("removeAppGridLine treats duplicate URLs as distinct by position", () => {
	const source = "https://example.com\nhttps://example.com";
	assert.equal(removeAppGridLine(source, 0), "https://example.com");
	assert.equal(removeAppGridLine(source, 1), "https://example.com");
});

test("removeAppGridLine is a no-op for an out-of-range index", () => {
	const source = "https://example.com\nhttps://example.org";
	assert.equal(removeAppGridLine(source, 5), source);
});

test("removeAppGridLine drops a named line too", () => {
	const source = "https://example.com\n[My Site](https://example.org)\nhttps://example.net";
	assert.equal(
		removeAppGridLine(source, 1),
		"https://example.com\nhttps://example.net"
	);
});

test("parseAppGridSource skips a config line", () => {
	const source = "icon=32;gap=12;bg=;appbg=0;;\nhttps://example.com";
	assert.deepEqual(parseAppGridSource(source), [entry("https://example.com")]);
});

test("setAppGridEntryName writes a name onto a bare-URL line", () => {
	const source = "https://example.com\nhttps://example.org";
	assert.equal(
		setAppGridEntryName(source, 1, "My Site"),
		"https://example.com\n[My Site](https://example.org)"
	);
});

test("setAppGridEntryName replaces a name already written", () => {
	const source = "[Old](https://example.com)\nhttps://example.org";
	assert.equal(
		setAppGridEntryName(source, 0, "New"),
		"[New](https://example.com)\nhttps://example.org"
	);
});

test("setAppGridEntryName escapes brackets and backslashes so the line parses back", () => {
	const source = "https://example.com";
	const name = "a [b] \\ c";
	assert.equal(setAppGridEntryName(source, 0, name), "[a \\[b\\] \\\\ c](https://example.com)");
	assert.deepEqual(
		parseAppGridSource(setAppGridEntryName(source, 0, name)),
		[entry("https://example.com", name)]
	);
});

test("setAppGridEntryName reverts a blank name to a bare URL", () => {
	const source = "[My Site](https://example.com)";
	assert.equal(setAppGridEntryName(source, 0, "   "), "https://example.com");
});

test("setAppGridEntryName leaves every other line untouched", () => {
	const source = ["# a comment", "https://example.com", "", "https://example.org"].join("\n");
	assert.equal(
		setAppGridEntryName(source, 0, "Named"),
		["# a comment", "[Named](https://example.com)", "", "https://example.org"].join("\n")
	);
});

test("parseAppGridConfig returns defaults when there is no config line", () => {
	assert.deepEqual(parseAppGridConfig("https://example.com"), DEFAULT_APP_GRID_CONFIG);
	assert.deepEqual(parseAppGridConfig(""), DEFAULT_APP_GRID_CONFIG);
});

test("parseAppGridConfig reads every field from a well-formed line", () => {
	const source = "icon=40;gap=16;bg=e9e9e9;appbg=1;iconbg=1;;\nhttps://example.com";
	assert.deepEqual(parseAppGridConfig(source), {
		iconSize: 40,
		gap: 16,
		background: "e9e9e9",
		appBackground: true,
		iconBackground: true,
	});
});

test("parseAppGridConfig lowercases the background hex", () => {
	const source = "icon=32;gap=12;bg=E9E9E9;appbg=0;iconbg=0;;";
	assert.equal(parseAppGridConfig(source).background, "e9e9e9");
});

test("parseAppGridConfig falls back to defaults for malformed fields", () => {
	const source = "icon=0;gap=-5;bg=zzzzzz;appbg=yes;iconbg=yes;;";
	assert.deepEqual(parseAppGridConfig(source), DEFAULT_APP_GRID_CONFIG);
});

test("parseAppGridConfig clamps a pathologically large px value", () => {
	const source = "icon=999999;gap=999999;bg=;appbg=0;iconbg=0;;";
	assert.deepEqual(parseAppGridConfig(source), {
		iconSize: 96,
		gap: 64,
		background: null,
		appBackground: false,
		iconBackground: false,
	});
});

test("parseAppGridConfig requires the trailing ;; marker", () => {
	assert.deepEqual(
		parseAppGridConfig("icon=40;gap=16;bg=e9e9e9;appbg=1;iconbg=1;"),
		DEFAULT_APP_GRID_CONFIG
	);
});

test("serializeAppGridConfig round-trips through parseAppGridConfig", () => {
	const config: AppGridConfig = {
		iconSize: 24,
		gap: 8,
		background: "f0ddd3",
		appBackground: true,
		iconBackground: true,
	};
	assert.deepEqual(parseAppGridConfig(serializeAppGridConfig(config)), config);
});

test("serializeAppGridConfig writes an empty bg field when there is no background", () => {
	assert.equal(
		serializeAppGridConfig({
			iconSize: 32,
			gap: 12,
			background: null,
			appBackground: false,
			iconBackground: false,
		}),
		"icon=32;gap=12;bg=;appbg=0;iconbg=0;;"
	);
});

test("upsertAppGridConfigLine inserts a config line when the block has none yet", () => {
	const source = "https://example.com\nhttps://example.org";
	const config: AppGridConfig = {
		iconSize: 24,
		gap: 8,
		background: null,
		appBackground: false,
		iconBackground: false,
	};
	assert.equal(
		upsertAppGridConfigLine(source, config),
		"icon=24;gap=8;bg=;appbg=0;iconbg=0;;\nhttps://example.com\nhttps://example.org"
	);
});

test("upsertAppGridConfigLine replaces an existing config line in place", () => {
	const source = "icon=32;gap=12;bg=;appbg=0;iconbg=0;;\nhttps://example.com";
	const config: AppGridConfig = {
		iconSize: 40,
		gap: 16,
		background: "e9e9e9",
		appBackground: true,
		iconBackground: true,
	};
	assert.equal(
		upsertAppGridConfigLine(source, config),
		"icon=40;gap=16;bg=e9e9e9;appbg=1;iconbg=1;;\nhttps://example.com"
	);
});

/*
 * A block saved before the "Icon background colour" option existed. Its
 * config line is still read field by field rather than rejected for being
 * short, and the missing field reads as off — see `serializeAppGridConfig`.
 */
test("parseAppGridConfig reads a config line written before the iconbg field existed", () => {
	assert.deepEqual(parseAppGridConfig("icon=40;gap=16;bg=e9e9e9;appbg=1;;"), {
		iconSize: 40,
		gap: 16,
		background: "e9e9e9",
		appBackground: true,
		iconBackground: false,
	});
});

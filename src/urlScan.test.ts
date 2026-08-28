import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
	findExternalLinkAt,
	findMarkdownLinks,
	toLinkDestination,
	toLinkText,
} from "./urlScan";

test("finds a bare external URL", () => {
	assert.deepEqual(findExternalLinkAt("See https://example.com/path.", 15), {
		from: 4,
		to: 28,
		url: "https://example.com/path",
	});
});

test("returns the full source range for a Markdown link", () => {
	const line = "See [Image Cluster](https://community.obsidian.md/plugins/image-cluster) today";
	const source = "[Image Cluster](https://community.obsidian.md/plugins/image-cluster)";
	assert.deepEqual(findExternalLinkAt(line, line.indexOf("Image")), {
		from: 4,
		to: 4 + source.length,
		url: "https://community.obsidian.md/plugins/image-cluster",
	});
});

test("supports balanced parentheses and an optional Markdown title", () => {
	const line = '[docs](https://example.com/a_(b) "Example title")';
	assert.deepEqual(findMarkdownLinks(line), [
		{ from: 0, to: line.length, url: "https://example.com/a_(b)" },
	]);
});

test("supports angle-bracket destinations and autolinks", () => {
	const markdown = "[docs](<https://example.com/a b>)";
	assert.equal(findExternalLinkAt(markdown, 2)?.url, "https://example.com/a b");

	const autolink = "Open <https://example.com/path>";
	assert.deepEqual(findExternalLinkAt(autolink, 10), {
		from: 5,
		to: autolink.length,
		url: "https://example.com/path",
	});
});

test("does not treat an external image embed as a link", () => {
	const image = "![cover](https://example.com/cover.png)";
	assert.equal(findExternalLinkAt(image, image.indexOf("cover")), null);
	assert.equal(findExternalLinkAt(image, image.indexOf("example")), null);
});

test("ignores every external link form inside inline code", () => {
	for (const source of [
		"`https://example.com`",
		"``https://example.com/a`b``",
		"`[docs](https://example.com)`",
		"`<https://example.com>`",
	]) {
		assert.equal(findExternalLinkAt(source, source.indexOf("example")), null);
	}
});

test("refuses a bare URL that a bracket cut short", () => {
	// The pattern stops at "[" / "{", so formatting would rewrite the link to
	// point at the truncated address and strand the remainder outside it.
	for (const line of [
		"See https://example.com/a[1] here",
		"See https://example.com/a{x} here",
	]) {
		assert.equal(findExternalLinkAt(line, 10), null);
	}
});

test("keeps balanced parentheses inside a bare URL", () => {
	const wiki = "See https://en.wikipedia.org/wiki/Foo_(bar) here";
	assert.equal(
		findExternalLinkAt(wiki, 10)?.url,
		"https://en.wikipedia.org/wiki/Foo_(bar)"
	);

	// Encoded query values carry parentheses that pair up mid-string.
	const amap =
		"https://ditu.amap.com/ssr/place/BV10877294?id=BV10877294&name=%E7%AB%B9%E6%9D%91(%E5%9C%B0%E9%93%81%E7%AB%99)&source=sug";
	assert.equal(findExternalLinkAt(`Open ${amap} now`, 20)?.url, amap);
});

test("still formats a bare URL followed by a prose parenthesis", () => {
	// A closing parenthesis the URL never opened is punctuation, not part of it.
	const line = "See it here https://example.com/path) or elsewhere";
	assert.equal(findExternalLinkAt(line, 20)?.url, "https://example.com/path");
});

test("percent-encodes only what would end a destination early", () => {
	assert.equal(
		toLinkDestination("https://example.com/a b"),
		"https://example.com/a%20b"
	);
	// Balanced parentheses are legal in a destination and stay readable.
	assert.equal(toLinkDestination("https://example.com/a_(b)"), "https://example.com/a_(b)");
	// An unbalanced one would close the link, so every parenthesis has to go.
	assert.equal(toLinkDestination("https://example.com/a)b"), "https://example.com/a%29b");
	assert.equal(toLinkDestination("https://example.com/a<b>c"), "https://example.com/a%3Cb%3Ec");
	assert.equal(toLinkDestination("https://example.com/plain"), "https://example.com/plain");
});

test("makes a title safe to use as link text", () => {
	assert.equal(toLinkText("A [weird] title", "u"), "A weird title");
	assert.equal(toLinkText("line\nbreak", "u"), "line break");
	// A trailing backslash would otherwise escape the closing bracket.
	assert.equal(toLinkText("ends with\\", "u"), "ends with\\\\");
	// An unusable title falls back to the URL, which is sanitised in turn.
	assert.equal(toLinkText("   ", "https://example.com/[x]"), "https://example.com/x");
});

/**
 * The bug this guards against: the plugin grew a careful parser and a naive
 * serializer, and nothing checked that one could read back what the other
 * wrote. Every URL the scanner can produce must survive being written into a
 * link and parsed out again.
 */
test("every parsed URL round-trips through the written bookmark", () => {
	const sources = [
		"https://example.com/path",
		"See https://example.com/x?a=1&b=2 now",
		"See https://example.com/wiki/Foo_(bar) now",
		"[docs](<https://example.com/a b>)",
		'[docs](https://example.com/a_(b) "title")',
		"Open <https://example.com/path>",
		"<https://example.com/a)b>",
		"<https://example.com/a(b>",
	];

	for (const source of sources) {
		const hit = findExternalLinkAt(source, source.indexOf("example"));
		assert.ok(hit, `no hit for ${source}`);

		const written = `[Example Domain](${toLinkDestination(hit.url)})`;
		const reparsed = findMarkdownLinks(written);
		assert.equal(reparsed.length, 1, `${source} produced unparseable output: ${written}`);
		assert.equal(reparsed[0].to, written.length, `${source} produced a short parse: ${written}`);
		assert.equal(
			decodeURI(reparsed[0].url),
			hit.url,
			`${source} did not survive the round trip: ${written}`
		);
	}
});

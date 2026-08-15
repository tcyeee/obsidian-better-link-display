import { strict as assert } from "node:assert";
import { test } from "node:test";
import { findExternalLinkAt, findMarkdownLinks } from "./urlScan";

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
		{
			from: 0,
			to: line.length,
			textFrom: 1,
			url: "https://example.com/a_(b)",
		},
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

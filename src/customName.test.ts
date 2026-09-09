import { strict as assert } from "node:assert";
import { test } from "node:test";
import { currentLinkName, withCustomName } from "./customName";
import { findExternalLinkAt } from "./urlScan";
import { withoutInlineIcon } from "./bookmarkScan";
import { rowCells } from "./tableScan";

const URL = "https://example.com/a_(b)";
const FALLBACK = "data:image/png;base64,RkFMTEJBQ0s=";
const ICON = "![](data:image/png;base64,SUNPTg==)";

test("custom names work for bare URLs, autolinks and ordinary links", () => {
	for (const source of [URL, `<${URL}>`, `[Old](${URL})`]) {
		const result = withCustomName(source, URL, "自定义名称", FALLBACK);
		assert.equal(result, `[![](${FALLBACK}) 自定义名称](${URL})`);
		assert.equal(findExternalLinkAt(result, 1)?.url, URL);
	}
});

test("renaming preserves the existing icon and exact destination with its title", () => {
	const source = `[Old ${ICON}](<${URL}> "Hover title")`;
	const result = withCustomName(source, URL, "New", FALLBACK);
	assert.equal(result, `[${ICON} New](<${URL}> "Hover title")`);
	assert.equal(currentLinkName(source), "Old");
	assert.equal(withoutInlineIcon(result), `[New](<${URL}> "Hover title")`);
});

test("special characters remain literal and repeated renames do not double escape", () => {
	const name = '[文档] **bold** _x_ `code` ~gone~ <img> & &#91; \\ end';
	const result = withCustomName(URL, URL, name, FALLBACK);
	assert.equal(currentLinkName(result), name);
	assert.equal(findExternalLinkAt(result, 1)?.url, URL);
	assert.ok(withoutInlineIcon(result));
	assert.equal(withCustomName(result, URL, currentLinkName(result), FALLBACK), result);
	assert.ok(!result.includes("<img>"));
});

test("custom table titles keep pipes and backslashes inside the same cell", () => {
	const name = "A | B \\| C";
	const result = withCustomName(`[Old](${URL})`, URL, name, FALLBACK, true);
	assert.equal(rowCells(`| ${result} | Other |`).length, 2);
	assert.equal(currentLinkName(result), name);
	assert.equal(withCustomName(result, URL, currentLinkName(result), FALLBACK, true), result);
});

test("renaming folds multiline pasted text and does not prefill a bare URL as a title", () => {
	assert.equal(currentLinkName(URL), "");
	assert.equal(currentLinkName(`<${URL}>`), "");
	const result = withCustomName(URL, URL, "  First\n second\tpart  ", FALLBACK);
	assert.equal(currentLinkName(result), "First second part");
});

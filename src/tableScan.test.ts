import { strict as assert } from "node:assert";
import { test } from "node:test";
import { isDelimiterRow, isTableRow, rowCells } from "./tableScan";

function cells(text: string): string[] {
	return rowCells(text).map((cell) => text.slice(cell.from, cell.to));
}

test("splits a row on its inner pipes", () => {
	assert.deepEqual(cells("| a | b | c |"), ["a", "b", "c"]);
});

test("treats the outer pipes as optional", () => {
	assert.deepEqual(cells("a | b"), ["a", "b"]);
	assert.deepEqual(cells("| a | b"), ["a", "b"]);
	assert.deepEqual(cells("a | b |"), ["a", "b"]);
});

test("keeps an escaped pipe inside its cell", () => {
	assert.deepEqual(cells("| a \\| b | c |"), ["a \\| b", "c"]);
});

test("reports offsets into the original line", () => {
	const line = "| one | https://example.com |";
	const range = rowCells(line)[1];
	assert.equal(line.slice(range.from, range.to), "https://example.com");
});

test("keeps empty cells so later columns keep their index", () => {
	assert.deepEqual(cells("| a |  | c |"), ["a", "", "c"]);
});

test("recognises a delimiter row, with or without alignment", () => {
	assert.equal(isDelimiterRow("| --- | --- |"), true);
	assert.equal(isDelimiterRow("|:--- | ---:|:-:|"), true);
	assert.equal(isDelimiterRow("| a | b |"), false);
	assert.equal(isDelimiterRow("plain text"), false);
});

test("recognises the lines a table block is made of", () => {
	assert.equal(isTableRow("| a | b |"), true);
	assert.equal(isTableRow("no pipes here"), false);
	assert.equal(isTableRow("an escaped \\| pipe only"), false);
});

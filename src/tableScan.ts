/**
 * Finding one cell of a Markdown table in the line that holds it.
 *
 * Live Preview replaces a whole table with a rendered widget, so a link inside
 * one is HTML with no editor position under it: the only way back to the source
 * is the cell's row and column. That mapping is plain string work, kept here
 * away from anything that imports `obsidian` or `@codemirror` so it stays
 * testable — the editor extension only supplies the row and column it reads off
 * the rendered table.
 */

export interface CellRange {
	/** Offset of the cell's first non-blank character within the line. */
	from: number;
	/** Offset just past its last non-blank character. */
	to: number;
}

/** Whitespace around a cell is padding, not content. */
function trimmed(text: string, from: number, to: number): CellRange {
	while (from < to && /\s/.test(text.charAt(from))) from += 1;
	while (to > from && /\s/.test(text.charAt(to - 1))) to -= 1;
	return { from, to };
}

/**
 * The cells of one table row, in order, as ranges into `text`.
 *
 * A row's outer pipes are delimiters rather than separators, so `| a | b |` and
 * `a | b` both describe two cells. A backslash escapes the character after it —
 * `\|` is a pipe inside a cell, and the only way to write one.
 */
export function rowCells(text: string): CellRange[] {
	let from = 0;
	let to = text.length;
	while (from < to && /\s/.test(text.charAt(from))) from += 1;
	while (to > from && /\s/.test(text.charAt(to - 1))) to -= 1;
	if (from < to && text.charAt(from) === "|") from += 1;

	const cells: CellRange[] = [];
	let start = from;
	let lastPipe = -1;
	for (let i = from; i < to; i++) {
		const char = text.charAt(i);
		if (char === "\\") {
			i += 1;
			continue;
		}
		if (char !== "|") continue;
		cells.push(trimmed(text, start, i));
		start = i + 1;
		lastPipe = i;
	}
	// Nothing follows a closing pipe, so the empty tail it leaves is not a cell.
	if (lastPipe !== to - 1) cells.push(trimmed(text, start, to));
	return cells;
}

/**
 * Whether a line could be part of a table at all. Deliberately loose — it only
 * has to pick the block's boundaries out of the surrounding prose, and
 * {@link isDelimiterRow} is what decides that the block really is a table.
 */
export function isTableRow(text: string): boolean {
	for (let i = 0; i < text.length; i++) {
		const char = text.charAt(i);
		if (char === "\\") {
			i += 1;
			continue;
		}
		if (char === "|") return true;
	}
	return false;
}

/**
 * The `| --- | :-- |` line under a table's header. Its presence is what makes
 * the lines around it a table, and it is also the reason a body row sits one
 * line lower in the source than its index in the rendered table.
 */
export function isDelimiterRow(text: string): boolean {
	const cells = rowCells(text);
	if (cells.length === 0) return false;
	return cells.every((cell) => /^:?-+:?$/.test(text.slice(cell.from, cell.to)));
}

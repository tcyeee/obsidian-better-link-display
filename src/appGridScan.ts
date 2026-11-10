/**
 * Pure parsing of a `link-grid` code block's body. No `obsidian` import, so it
 * can be exercised without an editor or a rendered DOM — see appGridScan.test.ts.
 */

import { findMarkdownLinks } from "./urlScan";

const HTTP_URL = /^https?:\/\//i;

export interface AppGridEntry {
	url: string;
	/**
	 * The title written directly into this line as `[Name](url)` — the "Edit
	 * name" dialog's save path, see `setAppGridEntryName` — or `null` for a
	 * bare-URL line that carries none, which keeps falling back to the cached
	 * or looked-up site name the way it always has.
	 */
	name: string | null;
}

/**
 * One entry per line: a bare URL, or a `[Name](url)` link carrying the name
 * the user gave it. Blank lines and anything that doesn't start like either
 * form are dropped rather than rejected, so a block that's being hand-edited
 * never shows an error for a half-typed or commented-out line. Duplicates are
 * kept as-is — a tile per line, in the order written.
 */
export function parseAppGridSource(source: string): AppGridEntry[] {
	return source
		.split("\n")
		.map(parseEntryLine)
		.filter((entry): entry is AppGridEntry => entry !== null);
}

/**
 * Removes the `index`-th entry line (0-based, in the order {@link parseAppGridSource}
 * returns them) from `source`, leaving every other line — blank, a comment,
 * whatever — exactly where it was. Powers the context menu's "Delete app": the
 * tile only knows its position among the *valid* lines, never the raw line
 * number, since blank lines between entries would otherwise throw that off.
 */
export function removeAppGridLine(source: string, index: number): string {
	let seen = 0;
	const kept = source.split("\n").filter((line) => {
		if (!parseEntryLine(line)) return true;
		return seen++ !== index;
	});
	return kept.join("\n");
}

/**
 * Writes `name` into the `index`-th entry line, keeping the URL
 * {@link parseAppGridSource} found there. A blank name reverts the line to a
 * bare URL rather than `[](url)` — which would render as an invisible link
 * anywhere this syntax is ever read literally — handing the tile back to
 * whatever cached or looked-up name it would otherwise show.
 */
export function setAppGridEntryName(source: string, index: number, name: string): string {
	const trimmed = name.trim();
	let seen = 0;
	const lines = source.split("\n").map((line) => {
		const entry = parseEntryLine(line);
		if (!entry || seen++ !== index) return line;
		return trimmed.length > 0 ? `[${escapeEntryName(trimmed)}](${entry.url})` : entry.url;
	});
	return lines.join("\n");
}

/** Persist a looked-up name only while the indexed line is still that bare URL. */
export function setAppGridEntryNameIfBare(source: string, index: number, url: string, name: string): string {
	let seen = 0;
	const lines = source.split("\n").map((line) => {
		const entry = parseEntryLine(line);
		if (!entry || seen++ !== index || entry.name !== null || entry.url !== url) return line;
		return `[${escapeEntryName(name.trim())}](${entry.url})`;
	});
	return lines.join("\n");
}

/** One line, parsed as either form — the shared predicate behind every function above. */
function parseEntryLine(line: string): AppGridEntry | null {
	const trimmed = line.trim();
	if (HTTP_URL.test(trimmed)) return { url: trimmed, name: null };

	const hit = findMarkdownLinks(trimmed)[0];
	if (!hit || hit.from !== 0 || hit.to !== trimmed.length) return null;
	const name = unescapeEntryName(hit.text.trim());
	return { url: hit.url, name: name.length > 0 ? name : null };
}

/**
 * Backslash-escapes the two characters that would otherwise be misread as
 * more link syntax when the line is parsed back: an unescaped `]` would close
 * the name early, and `findMarkdownLinks`' escape handling itself keys off a
 * literal backslash.
 */
function escapeEntryName(name: string): string {
	return name.replace(/[\\[\]]/g, "\\$&");
}

function unescapeEntryName(text: string): string {
	return text.replace(/\\([\\[\]])/g, "$1");
}

export interface AppGridInsertion {
	/** Text to insert at the end of the current line. */
	text: string;
	/** Where to leave the cursor afterwards, relative to the insertion point. */
	cursorOffset: { line: number; ch: number };
}

const BLOCK_TEMPLATE = "```link-grid\n\n```\n";

/**
 * Text for the "Insert APP view" menu item and where the cursor should land
 * afterwards — the blank line between the fences, ready to paste a URL. The
 * caller appends this at the end of the line under the cursor rather than at
 * the cursor itself, so when that line already holds text the block starts
 * on a line of its own instead of splitting the text in two.
 */
export function buildAppGridInsertion(currentLine: string): AppGridInsertion {
	const ownLine = currentLine.length > 0;
	return {
		text: `${ownLine ? "\n" : ""}${BLOCK_TEMPLATE}`,
		cursorOffset: { line: ownLine ? 2 : 1, ch: 0 },
	};
}

/**
 * Turns what the "Add" dialog's domain field holds into a URL a `link-grid`
 * line can use. A bare domain ("example.com") is given an `https://` scheme;
 * anything that already looks like a URL keeps its own — `HTTP_URL` guarantees
 * that scheme is `http`/`https` either way, so there's no separate protocol
 * check to smuggle a `javascript:` or `data:` URL past. `URL` is left to catch
 * everything else unparsable (spaces, an empty host, …).
 */
export function normalizeAppGridUrl(input: string): string | null {
	const trimmed = input.trim();
	if (!trimmed) return null;
	const candidate = HTTP_URL.test(trimmed) ? trimmed : `https://${trimmed}`;
	try {
		return new URL(candidate).href;
	} catch {
		return null;
	}
}

export interface AppGridConfig {
	/** Icon side length in px. The settings dialog only offers s/m/l; this holds whatever that resolved to. */
	iconSize: number;
	/** Grid gap in px, same s/m/l-to-px relationship as {@link iconSize}. */
	gap: number;
	/** 6-digit hex (no `#`), or `null` for no area background — the only two states the dialog offers are gray and beige, but a hand-edited block is read literally rather than snapped to one of them. */
	background: string | null;
	/** Whether each tile sits on a card of its own — one fixed colour for the whole grid, drawn in `styles.css`, unlike {@link iconBackground}. */
	appBackground: boolean;
	/** Whether each icon gets a plate tinted from *its own* dominant colour — the one appearance option no stylesheet can know in advance, see `appGrid.ts`'s `syncIconBackground()`. */
	iconBackground: boolean;
}

export const DEFAULT_APP_GRID_CONFIG: AppGridConfig = {
	iconSize: 32,
	gap: 12,
	background: null,
	appBackground: false,
	iconBackground: false,
};

const HEX6 = /^[0-9a-f]{6}$/i;

/** Bounds a hand-edited px value against something pathological rather than rejecting it outright. */
function clampPx(value: string | undefined, fallback: number, max: number): number {
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
	return Math.min(Math.round(parsed), max);
}

/**
 * The block's first line, when it's an appearance config rather than a URL:
 * `key=value` pairs joined by `;`, ending in the extra `;` that makes the line
 * end `;;` — the marker that tells it apart from a URL or a stray hand-typed
 * line, both of which {@link parseAppGridSource} already drops on their own
 * since neither starts with `http`.
 */
export function parseAppGridConfig(source: string): AppGridConfig {
	const firstLine = source.split("\n")[0]?.trim() ?? "";
	if (!firstLine.endsWith(";;")) return DEFAULT_APP_GRID_CONFIG;

	const fields = new Map<string, string>();
	for (const pair of firstLine.slice(0, -2).split(";")) {
		const eq = pair.indexOf("=");
		if (eq === -1) continue;
		fields.set(pair.slice(0, eq), pair.slice(eq + 1));
	}

	const background = fields.get("bg");
	return {
		iconSize: clampPx(fields.get("icon"), DEFAULT_APP_GRID_CONFIG.iconSize, 96),
		gap: clampPx(fields.get("gap"), DEFAULT_APP_GRID_CONFIG.gap, 64),
		background: background && HEX6.test(background) ? background.toLowerCase() : null,
		appBackground: fields.get("appbg") === "1",
		iconBackground: fields.get("iconbg") === "1",
	};
}

/**
 * New fields are appended rather than slotted in, and every one of them is
 * read as "absent means off" above — a block written before the field existed
 * has no `iconbg=` pair and must keep rendering exactly as it did, not pick up
 * a new plate behind every icon.
 */
export function serializeAppGridConfig(config: AppGridConfig): string {
	return `icon=${config.iconSize};gap=${config.gap};bg=${config.background ?? ""};appbg=${config.appBackground ? "1" : "0"};iconbg=${config.iconBackground ? "1" : "0"};;`;
}

/**
 * Writes `config` into `source`'s first line, replacing an existing config
 * line in place or inserting a new one — a block saved before this feature
 * existed has no such line yet, so every other line has to shift down rather
 * than the first URL being overwritten.
 */
export function upsertAppGridConfigLine(source: string, config: AppGridConfig): string {
	const lines = source.split("\n");
	const configLine = serializeAppGridConfig(config);
	if (lines[0]?.trim().endsWith(";;")) {
		lines[0] = configLine;
	} else {
		lines.unshift(configLine);
	}
	return lines.join("\n");
}

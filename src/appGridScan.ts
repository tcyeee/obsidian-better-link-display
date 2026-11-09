/**
 * Pure parsing of a `link-grid` code block's body. No `obsidian` import, so it
 * can be exercised without an editor or a rendered DOM — see appGridScan.test.ts.
 */

const HTTP_URL = /^https?:\/\//i;

/**
 * One URL per line. Blank lines and anything that doesn't start like a URL are
 * dropped rather than rejected, so a block that's being hand-edited never shows
 * an error for a half-typed or commented-out line. Duplicates are kept as-is —
 * a tile per line, in the order written.
 */
export function parseAppGridSource(source: string): string[] {
	return source
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => HTTP_URL.test(line));
}

/**
 * Removes the `index`-th URL line (0-based, in the order {@link parseAppGridSource}
 * returns them) from `source`, leaving every other line — blank, a comment,
 * whatever — exactly where it was. Powers the context menu's "Delete app": the
 * tile only knows its position among the *valid* lines, never the raw line
 * number, since blank lines between URLs would otherwise throw that off.
 */
export function removeAppGridLine(source: string, index: number): string {
	let seen = 0;
	const kept = source.split("\n").filter((line) => {
		if (!HTTP_URL.test(line.trim())) return true;
		return seen++ !== index;
	});
	return kept.join("\n");
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
	/** Whether each tile tints its own background from its icon's average colour — see `appGrid.ts`'s `averageIconColor()`. */
	appBackground: boolean;
}

export const DEFAULT_APP_GRID_CONFIG: AppGridConfig = {
	iconSize: 32,
	gap: 12,
	background: null,
	appBackground: false,
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
	};
}

export function serializeAppGridConfig(config: AppGridConfig): string {
	return `icon=${config.iconSize};gap=${config.gap};bg=${config.background ?? ""};appbg=${config.appBackground ? "1" : "0"};;`;
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
